// The skill market — how the company gets better at things it already does.
//
// Memory records what happened and distils lessons. A lesson is a sentence; a
// skill is a procedure. When an employee has done the same kind of work enough
// times to have a way of doing it, it proposes that way as a named recipe. The
// recipe is then measured against the golden set the same way a model change is
// measured, and it is adopted only if it beats what everyone is doing now.
//
// Two rules keep this from turning into folklore. A skill is never adopted on
// the strength of its author's confidence — only on a score. And the incumbent
// is always in the comparison, so "better" means better than the current way,
// not better than nothing.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { openPii } from './erasure.js';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/** An employee proposes a way of working. Proposing costs nothing; adoption is earned. */
export function proposeSkill({ title, taskType, body, proposedBy, actor = null }) {
  if (!title || !body || !taskType) throw new Error('a skill needs a title, a task type and a body');
  const slug = slugify(title);
  const prev = one('SELECT MAX(version) AS v FROM skills WHERE slug = ?', slug);
  const version = (prev?.v || 0) + 1;
  const incumbent = one("SELECT score FROM skills WHERE task_type = ? AND state = 'adopted' ORDER BY score DESC LIMIT 1", taskType);
  const r = exec(
    'INSERT INTO skills (slug, title, task_type, body, version, proposed_by, baseline) VALUES (?,?,?,?,?,?,?)',
    slug, title, taskType, body, version, proposedBy, incumbent?.score ?? null,
  );
  audit({
    actorType: proposedBy?.startsWith('AGT') ? 'agent' : 'human', actorId: proposedBy || actor || 'system:skills',
    action: 'skill.proposed', subjectType: 'skill', subjectId: Number(r.lastInsertRowid), payload: { title, taskType, version },
  });
  return one('SELECT * FROM skills WHERE id = ?', Number(r.lastInsertRowid));
}

/**
 * Put a proposed skill through the golden set. The trial is a real run, judged
 * by an employee that did not write the skill.
 */
export function trialSkill(id, { actor = 'human:admin' } = {}) {
  const s = one('SELECT * FROM skills WHERE id = ?', id);
  if (!s) throw new Error('no such skill');
  if (s.state === 'adopted') throw new Error('that skill is already in use');
  exec("UPDATE skills SET state = 'testing', trials = trials + 1 WHERE id = ?", id);
  const judge = one(
    "SELECT id FROM agents WHERE role_group = 'assure' AND status = 'active' AND id != ? ORDER BY random() LIMIT 1",
    s.proposed_by,
  ) || one("SELECT id FROM agents WHERE status = 'active' AND id != ? ORDER BY random() LIMIT 1", s.proposed_by);
  if (!judge) throw new Error('there is nobody free to judge this');
  const runId = enqueueRun({
    agentId: judge.id, taskType: 'skill_trial', actor: `human:${actor}`,
    input: {
      instruction: 'Judge a proposed way of working. Return JSON: {"score": 0-100, "beatsIncumbent": true|false, "why": "...", "risks": ["..."]}. Score on whether following this recipe would produce better work than the current default, not on how well it is written.',
      skill: { title: s.title, taskType: s.task_type, body: s.body },
      incumbentScore: s.baseline,
    },
  });
  audit({ actorType: 'human', actorId: actor, action: 'skill.trialled', subjectType: 'skill', subjectId: id, payload: { runId, judge: judge.id } });
  return { ok: true, runId, judge: judge.id };
}

/** Read trial verdicts off finished runs and settle the skills they belong to. */
export function syncSkills() {
  let settled = 0;
  for (const s of q("SELECT * FROM skills WHERE state = 'testing'")) {
    const run = one(
      "SELECT * FROM runs WHERE task_type = 'skill_trial' AND state = 'done' AND input LIKE ? ORDER BY id DESC LIMIT 1",
      `%${s.title.slice(0, 40)}%`,
    );
    if (!run?.output) continue;
    let verdict;
    try {
      const out = JSON.parse(openPii(run.output));
      verdict = out.parsed || out;
      if (typeof verdict === 'string') verdict = JSON.parse(verdict);
    } catch { continue; }
    const score = Number(verdict.score);
    if (!Number.isFinite(score)) continue;
    const beats = verdict.beatsIncumbent === true || (s.baseline !== null && score > s.baseline);
    if (beats && score >= 70) {
      exec("UPDATE skills SET state = 'retired' WHERE task_type = ? AND state = 'adopted'", s.task_type);
      exec("UPDATE skills SET state = 'adopted', score = ?, adopted_at = datetime('now') WHERE id = ?", score, s.id);
      audit({ actorType: 'system', actorId: 'system:skills', action: 'skill.adopted', subjectType: 'skill', subjectId: s.id, payload: { score, taskType: s.task_type, why: String(verdict.why || '').slice(0, 300) } });
    } else {
      exec("UPDATE skills SET state = 'rejected', score = ? WHERE id = ?", score, s.id);
      audit({ actorType: 'system', actorId: 'system:skills', action: 'skill.rejected', subjectType: 'skill', subjectId: s.id, payload: { score, why: String(verdict.why || '').slice(0, 300) } });
    }
    settled++;
  }
  return settled;
}

/** The adopted recipe for a kind of work, if there is one. Used in prompts. */
export function skillFor(taskType) {
  const s = one("SELECT title, body, score FROM skills WHERE task_type = ? AND state = 'adopted' ORDER BY score DESC LIMIT 1", taskType);
  return s ? `ADOPTED METHOD — "${s.title}" (scored ${s.score}). Follow it unless it contradicts the task:\n${s.body}` : null;
}

/**
 * An employee that has done the same task ten times without proposing anything
 * is asked to write down how it does it. This is where most skills come from.
 */
export function inviteProposals(limit = 2) {
  const candidates = q(`SELECT agent_id, task_type, COUNT(*) AS n FROM runs
    WHERE state = 'done' GROUP BY agent_id, task_type HAVING n >= 10 ORDER BY n DESC LIMIT 20`);
  let asked = 0;
  for (const c of candidates) {
    if (asked >= limit) break;
    if (one('SELECT id FROM skills WHERE proposed_by = ? AND task_type = ?', c.agent_id, c.task_type)) continue;
    if (one("SELECT id FROM runs WHERE agent_id = ? AND task_type = 'skill_propose' AND created_at >= datetime('now','-3 days')", c.agent_id)) continue;
    enqueueRun({
      agentId: c.agent_id, taskType: 'skill_propose', actor: 'system:skills',
      input: {
        instruction: `You have completed ${c.n} tasks of type "${c.task_type}". Write down the method you actually use, as a recipe another employee could follow. Return JSON: {"title": "...", "body": "step-by-step method", "whenNotToUse": "..."}. Be specific about what you check and in what order. Do not describe the obvious.`,
        taskType: c.task_type, completed: c.n,
      },
    });
    asked++;
  }
  return asked;
}

/** Turn finished skill_propose runs into proposals. */
export function harvestProposals() {
  let made = 0;
  for (const run of q("SELECT * FROM runs WHERE task_type = 'skill_propose' AND state = 'done' AND output IS NOT NULL ORDER BY id DESC LIMIT 10")) {
    let spec;
    try {
      const out = JSON.parse(openPii(run.output));
      spec = out.parsed || out;
      if (typeof spec === 'string') spec = JSON.parse(spec);
    } catch { continue; }
    if (!spec?.title || !spec?.body) continue;
    const input = run.input ? JSON.parse(run.input) : {};
    if (one('SELECT id FROM skills WHERE slug = ?', slugify(spec.title))) continue;
    proposeSkill({
      title: String(spec.title).slice(0, 120), taskType: input.taskType || 'general',
      body: String(spec.body).slice(0, 4000), proposedBy: run.agent_id,
    });
    made++;
  }
  return made;
}

// ---------------------------------------------------------- tournaments ---
// Which model actually wins which kind of work — measured, not assumed. The
// data is already there: every run records its provider, its model, its cost
// and, where an audit happened, a score.

export function runTournament(taskType, { actor = 'human:admin' } = {}) {
  const rows = q(`SELECT mc.provider, mc.model,
                         COUNT(*) AS calls,
                         ROUND(AVG(mc.cost_usd), 5) AS avg_cost,
                         ROUND(AVG(mc.latency_ms), 0) AS avg_ms,
                         SUM(mc.ok = 0) AS errors
                  FROM model_calls mc
                  JOIN runs r ON r.id = mc.run_id
                  WHERE r.task_type = ?
                  GROUP BY mc.provider, mc.model HAVING calls >= 3`, taskType);
  if (!rows.length) throw new Error(`no measured history for ${taskType} yet`);

  const scored = rows.map((r) => {
    // Quality comes from the auditor's own verdicts on work this model served.
    const quality = one(
      `SELECT ROUND(AVG(CASE a.verdict WHEN 'pass' THEN 100 WHEN 'revise' THEN 60 ELSE 20 END), 1) AS s
       FROM audits a
       JOIN model_calls m2 ON m2.run_id = a.run_id
       JOIN runs r2 ON r2.id = a.run_id
       WHERE r2.task_type = ? AND m2.model = ?`, taskType, r.model,
    )?.s;
    const reliability = 100 - (r.errors / r.calls) * 100;
    const q100 = quality ?? reliability;
    // Value is quality per dollar, but a free local model must not win purely
    // by being free, so cost is floored before dividing.
    const value = q100 / Math.max(0.0002, r.avg_cost || 0.0002);
    return { ...r, quality: q100, reliability: Number(reliability.toFixed(1)), value: Number(value.toFixed(0)) };
  }).sort((a, b) => b.quality - a.quality || a.avg_cost - b.avg_cost);

  const winner = scored[0];
  const r = exec(
    "INSERT INTO tournaments (task_type, state, entrants, results, winner, ended_at) VALUES (?,'done',?,?,?,datetime('now'))",
    taskType, JSON.stringify(rows.map((x) => `${x.provider}/${x.model}`)), JSON.stringify(scored), `${winner.provider}/${winner.model}`,
  );
  audit({ actorType: 'human', actorId: actor, action: 'tournament.run', subjectType: 'tournament', subjectId: Number(r.lastInsertRowid), payload: { taskType, winner: `${winner.provider}/${winner.model}`, entrants: rows.length } });
  return { id: Number(r.lastInsertRowid), taskType, winner, table: scored };
}

export function skillsOverview() {
  return {
    skills: q('SELECT * FROM skills ORDER BY state, task_type, version DESC LIMIT 100'),
    counts: {
      proposed: one("SELECT COUNT(*) AS n FROM skills WHERE state = 'proposed'").n,
      testing: one("SELECT COUNT(*) AS n FROM skills WHERE state = 'testing'").n,
      adopted: one("SELECT COUNT(*) AS n FROM skills WHERE state = 'adopted'").n,
      rejected: one("SELECT COUNT(*) AS n FROM skills WHERE state = 'rejected'").n,
    },
    adopted: q("SELECT task_type, title, score, adopted_at, proposed_by FROM skills WHERE state = 'adopted' ORDER BY score DESC"),
    tournaments: q('SELECT * FROM tournaments ORDER BY id DESC LIMIT 12').map((t) => ({ ...t, results: JSON.parse(t.results || '[]'), entrants: JSON.parse(t.entrants || '[]') })),
    taskTypes: q("SELECT task_type, COUNT(*) AS runs FROM runs WHERE state = 'done' GROUP BY task_type ORDER BY runs DESC LIMIT 20"),
  };
}
