// THE SELF-IMPROVEMENT LOOP — the Grader scores, the Coach rewrites, and only
// what helps is kept.
//
// A loop takes a set of employees and a handful of tasks each: their golden
// cases where they have them, and otherwise prompts they were really given.
// Every round, each task is run again as a real run, and the Grader scores
// the answer against a fixed rubric — valid JSON, every field of the
// employee's own output contract, no guard tripped, the expected answer where
// a golden case states one, confidence above the employee's floor. No model
// grades; the rubric is code, so a score cannot be talked up.
//
// For every employee that failed something, the Coach reads the failures and
// its playbook and proposes rules to add or remove. A rewrite is a new version
// of the playbook — the employee's working notes, never its role or its
// guards — kept with the one it replaced. The next round is the test: a
// rewrite after which the employee scored lower is reverted, automatically. In
// "ask" mode a person accepts each rewrite first. The loop stops at the target
// pass rate or the last round, whichever comes first.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { agentsConfig, ROOT } from './env.js';
import { enqueueRun } from './workflow.js';
import { parseAgentJson } from './router.js';
import { readRun } from './markets/fold.js';
import { peekGuards } from './guards.js';
import { readPlaybook, writePlaybook } from './memory.js';
import { openPii } from './erasure.js';
import { laneFor } from './nightshift.js';
import { getSetting } from './settings.js';
import fs from 'node:fs';
import path from 'node:path';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const SYSTEM = 'system:selfimprove';
const COACH = 'AGT-COACH-001';
const SECTION = '## Rules from the coach';

let golden = null;
const goldenSets = () => {
  if (!golden) {
    try { golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'golden-sets.json'), 'utf8')).sets; } catch { golden = {}; }
  }
  return golden;
};
const spec = (id) => agentsConfig.agents.find((a) => a.id === id);

/** The top-level keys of an employee's own output contract, read from its role. */
export function contractKeys(system) {
  const at = String(system || '').lastIndexOf('Output JSON:');
  if (at < 0) return [];
  const s = system.slice(at);
  const start = s.indexOf('{');
  if (start < 0) return [];
  const keys = [];
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) break; } else if (c === '"' && depth === 1) {
      const m = s.slice(i).match(/^"([A-Za-z_]\w*)"\s*:/);
      if (m) { keys.push(m[1]); i += m[0].length - 1; } else { const end = s.indexOf('"', i + 1); i = end < 0 ? s.length : end; }
    }
  }
  return [...new Set(keys)];
}

export const RUBRIC = [
  { id: 'json', label: 'Answers in valid JSON' },
  { id: 'contract', label: 'Every field of its output contract' },
  { id: 'guards', label: 'No guard tripped' },
  { id: 'expected', label: 'The expected answer, where a golden case states one' },
  { id: 'confidence', label: 'Confidence at or above its floor' },
];

/** Score one answer. Pure, given the guards: the same answer always scores the same. */
export function grade(agentId, answer, expect = null) {
  const s = spec(agentId) || {};
  const text = String(answer?.raw ?? '');
  const parsed = answer?.parsed ?? parseAgentJson(text);
  const keys = contractKeys(s.system);
  const checks = { json: parsed !== null && typeof parsed === 'object' };
  const missing = parsed ? keys.filter((k) => !(k in parsed)) : keys;
  checks.contract = keys.length ? checks.json && missing.length === 0 : checks.json;
  const g = peekGuards(agentId, text);
  checks.guards = !g;
  if (expect?.field) checks.expected = Boolean(parsed) && expect.anyOf.some((e) => String(e).toLowerCase() === String(parsed[expect.field]).toLowerCase());
  if (keys.includes('confidence')) checks.confidence = Boolean(parsed) && Number(parsed.confidence) >= Number(s.confidenceFloor ?? 0.5);
  return { pass: Object.values(checks).every(Boolean), checks, missing, guard: g ? g.why || g.pattern : null };
}

/** The tasks an employee is tested on: golden cases first, then prompts it was really given. */
export function tasksFor(agentId, batch) {
  const out = [];
  for (const c of goldenSets()[agentId]?.cases || []) {
    if (out.length >= batch) break;
    out.push({ key: `golden:${c.name}`, source: 'golden', prompt: c.prompt, expect: { field: c.expectField, anyOf: c.expectAnyOf } });
  }
  const seen = new Set();
  for (const r of q(`SELECT id, input FROM runs WHERE agent_id = ? AND subject_ref IS NULL AND state IN ('done','awaiting_human','failed')
                     AND task_type NOT LIKE 'si:%' AND task_type NOT LIKE 'chat:%' AND task_type NOT LIKE 'coach:%' ORDER BY created_at DESC LIMIT 40`, agentId)) {
    if (out.length >= batch) break;
    let prompt = null;
    try { prompt = JSON.parse(openPii(r.input))?.prompt || null; } catch { prompt = null; }
    if (!prompt || prompt.length < 20 || seen.has(prompt)) continue;
    seen.add(prompt);
    out.push({ key: `history:${r.id}`, source: 'history', prompt: prompt.slice(0, 8000), expect: null });
  }
  return out;
}

/** Who can be tested: everybody active with at least one task, the busiest first. */
export function candidates(limit = 16) {
  const busy = new Map(q("SELECT agent_id, COUNT(*) AS n FROM runs WHERE created_at > datetime('now','-30 days') AND task_type NOT LIKE 'si:%' GROUP BY agent_id").map((r) => [r.agent_id, r.n]));
  return agentsConfig.agents.filter((a) => a.id !== COACH && (a.status || 'active') === 'active')
    .map((a) => ({ id: a.id, busy: (busy.get(a.id) || 0) + (goldenSets()[a.id] ? 1000 : 0) }))
    .filter((a) => a.busy > 0).sort((a, b) => b.busy - a.busy).slice(0, limit).map((a) => a.id);
}

const mode = () => (getSetting('SELF_IMPROVE_MODE') === 'ask' ? 'ask' : 'auto');

export function startLoop({ agents = null, target = 0.95, batch = 3, maxRounds = 5, actor }) {
  if (!isHuman(actor)) refuse('a person starts a loop', 403);
  if (one("SELECT id FROM si_loops WHERE state IN ('grading','coaching','waiting')")) refuse('a loop is already running — stop it or let it finish');
  const t = Number(target); const b = Math.round(Number(batch)); const m = Math.round(Number(maxRounds));
  if (!(t > 0 && t <= 1)) refuse('the target is a pass rate between 0 and 1');
  if (!(b >= 1 && b <= 10)) refuse('between 1 and 10 tasks per employee');
  if (!(m >= 1 && m <= 10)) refuse('between 1 and 10 rounds');
  const scope = (Array.isArray(agents) && agents.length ? agents : candidates()).filter((id) => spec(id) && id !== COACH);
  const plan = scope.map((id) => ({ id, tasks: tasksFor(id, b) })).filter((p) => p.tasks.length);
  if (!plan.length) refuse('no employee has anything to be tested on yet — a golden set, or work it has done');
  const n = one('SELECT COUNT(*) AS n FROM si_loops').n + 1;
  const r = exec('INSERT INTO si_loops (name, target, batch, max_rounds, mode, scope, round, state, started_by) VALUES (?,?,?,?,?,?,1,?,?)',
    `self-improve-${String(n).padStart(2, '0')}`, t, b, m, mode(), JSON.stringify(plan.map((p) => p.id)), 'grading', actor);
  const id = Number(r.lastInsertRowid);
  for (const p of plan) {
    for (const task of p.tasks) {
      exec('INSERT INTO si_tasks (loop_id, round, agent_id, case_key, source, prompt, expect) VALUES (?,?,?,?,?,?,?)',
        id, 1, p.id, task.key, task.source, task.prompt, task.expect ? JSON.stringify(task.expect) : null);
    }
  }
  dispatch(id, 1);
  audit({ actorType: 'human', actorId: actor, action: 'selfimprove.started', subjectType: 'si_loop', subjectId: id, payload: { agents: plan.length, tasks: plan.reduce((a, p) => a + p.tasks.length, 0), target: t, maxRounds: m, mode: mode() } });
  return getLoop(id);
}

/** Every task of a round, run again as a real run of the employee. */
function dispatch(loopId, round) {
  const { lane, notBefore } = laneFor({});
  for (const t of q("SELECT * FROM si_tasks WHERE loop_id = ? AND round = ? AND run_id IS NULL", loopId, round)) {
    const runId = enqueueRun({ agentId: t.agent_id, taskType: `si:${loopId}:${round}`, input: { prompt: t.prompt }, actor: SYSTEM, lane, notBefore });
    exec('UPDATE si_tasks SET run_id = ? WHERE id = ?', runId, t.id);
  }
}

function byAgent(loopId, round) {
  const out = {};
  for (const r of q("SELECT agent_id, SUM(verdict = 'pass') AS passed, COUNT(*) AS total FROM si_tasks WHERE loop_id = ? AND round = ? GROUP BY agent_id", loopId, round)) {
    out[r.agent_id] = { passed: r.passed, total: r.total };
  }
  return out;
}
const rate = (x) => (x && x.total ? x.passed / x.total : 0);

/** The coach's section of a playbook: from its heading to the next one. */
function sectionSpan(s) {
  const at = s.indexOf(SECTION);
  if (at < 0) return null;
  const next = s.indexOf('\n## ', at + SECTION.length);
  return [at, next < 0 ? s.length : next + 1];
}
export function coachRules(body) {
  const s = String(body || '');
  const span = sectionSpan(s);
  if (!span) return [];
  return s.slice(span[0] + SECTION.length, span[1]).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
}
/**
 * The playbook with a new set of coach rules. The section sits before the
 * first other heading, not at the end: recall hands an employee the first
 * 2,600 characters of its playbook, and a rule past that is a rule it never reads.
 */
export function withRules(body, rules) {
  let s = String(body || '');
  const span = sectionSpan(s);
  if (span) s = s.slice(0, span[0]) + s.slice(span[1]);
  const block = `${SECTION}\n*Written by the coach from graded failures; each kept only because the next round scored no lower.*\n${rules.map((r) => `- ${r}`).join('\n')}\n\n`;
  const first = s.indexOf('\n## ');
  return first < 0 ? `${s.replace(/\s+$/, '')}\n\n${block}` : `${s.slice(0, first + 1)}${block}${s.slice(first + 1)}`;
}

/** Write a rewrite as a new playbook version. */
function applyRewrite(c, loop, decidedBy) {
  const before = readPlaybook(c.agent_id) || '';
  const removed = JSON.parse(c.removed || '[]');
  const added = JSON.parse(c.added || '[]');
  const rules = coachRules(before).filter((r) => !removed.includes(r));
  for (const a of added) if (!rules.includes(a)) rules.push(a);
  const after = withRules(before, rules.slice(-20));
  const version = (one('SELECT MAX(version) AS v FROM playbook_versions WHERE agent_id = ?', c.agent_id)?.v || 0) + 1;
  const r = exec('INSERT INTO playbook_versions (agent_id, version, loop_id, round, before_body, after_body, removed, added, decided_by, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    c.agent_id, version, loop.id, c.round, before, after, c.removed || '[]', c.added || '[]', decidedBy, COACH);
  writePlaybook(c.agent_id, after, { actor: SYSTEM, reason: `coach rewrite v${version} (${loop.name}, round ${c.round})` });
  exec("UPDATE si_coach SET state = 'applied', version_id = ?, decided_by = ? WHERE id = ?", Number(r.lastInsertRowid), decidedBy, c.id);
}

/** After a round: a rewrite made before it is kept if the employee did not score lower, reverted if it did. */
function judgeRewrites(loop, round) {
  const now = byAgent(loop.id, round);
  const prev = byAgent(loop.id, round - 1);
  for (const v of q("SELECT * FROM playbook_versions WHERE loop_id = ? AND round = ? AND state = 'applied'", loop.id, round - 1)) {
    if (rate(now[v.agent_id]) < rate(prev[v.agent_id])) {
      writePlaybook(v.agent_id, v.before_body, { actor: SYSTEM, reason: `reverted v${v.version}: the next round scored lower` });
      exec("UPDATE playbook_versions SET state = 'reverted' WHERE id = ?", v.id);
    } else exec("UPDATE playbook_versions SET state = 'kept' WHERE id = ?", v.id);
  }
}

function coach(loop, round) {
  const failing = q("SELECT agent_id, case_key, checks, excerpt, expect FROM si_tasks WHERE loop_id = ? AND round = ? AND verdict = 'fail'", loop.id, round);
  const by = new Map();
  for (const f of failing) { if (!by.has(f.agent_id)) by.set(f.agent_id, []); by.get(f.agent_id).push(f); }
  for (const [agentId, fails] of by) {
    const s = spec(agentId);
    const missing = [...new Set(fails.flatMap((f) => JSON.parse(f.checks || '{}').missing || []))];
    const failed = [...new Set(fails.flatMap((f) => Object.entries(JSON.parse(f.checks || '{}')).filter(([k, v]) => v === false && k !== 'missing').map(([k]) => k)))];
    const prompt = `[COACH] Employee ${agentId} (${s?.name || agentId}) failed ${fails.length} graded task(s) in ${loop.name}, round ${round}.
Failed checks: ${failed.join(', ')}${missing.length ? ` — contract fields missing: ${missing.join(', ')}` : ''}.
Its output contract: ${contractKeys(s?.system).join(', ') || '(none stated)'}.
Rules the coach gave it before: ${JSON.stringify(coachRules(readPlaybook(agentId)))}
Excerpts of failing answers:\n${fails.slice(0, 3).map((f) => { const e = f.expect ? JSON.parse(f.expect) : null; return `- ${f.case_key}${e?.field ? ` (expected ${e.field} to be one of: ${e.anyOf.join(' | ')})` : ''}: ${String(f.excerpt || '').slice(0, 400)}`; }).join('\n')}

Propose at most five short rules for its playbook that would make these answers pass, and any earlier rule that is wrong or no longer needed. A rule is an instruction it can follow on every task, not advice about this one.
Output JSON: {"add":[],"remove":[],"why":""}`;
    const runId = enqueueRun({ agentId: COACH, taskType: `coach:${loop.id}:${round}`, input: { prompt }, actor: SYSTEM });
    exec('INSERT INTO si_coach (loop_id, round, agent_id, run_id) VALUES (?,?,?,?)', loop.id, round, agentId, runId);
  }
  return by.size;
}

function nextRound(loop) {
  const round = loop.round + 1;
  exec(`INSERT INTO si_tasks (loop_id, round, agent_id, case_key, source, prompt, expect)
        SELECT loop_id, ?, agent_id, case_key, source, prompt, expect FROM si_tasks WHERE loop_id = ? AND round = 1`, round, loop.id);
  exec("UPDATE si_loops SET round = ?, state = 'grading' WHERE id = ?", round, loop.id);
  dispatch(loop.id, round);
}

function finish(loop, note) {
  exec("UPDATE si_loops SET state = 'done', finished_at = datetime('now'), note = ? WHERE id = ?", note, loop.id);
  const l = getLoop(loop.id);
  audit({ actorType: 'system', actorId: SYSTEM, action: 'selfimprove.finished', subjectType: 'si_loop', subjectId: loop.id, payload: { from: l.firstPass, to: l.lastPass, rounds: l.round, rewrites: l.metrics.rewrites, note } });
}

/**
 * The server tick: grade what has finished, and when a round is complete move
 * the loop on — judge the last rewrites, stop or coach, apply, run again.
 */
export function syncSelfImprove() {
  for (const loop of q("SELECT * FROM si_loops WHERE state IN ('grading','coaching')")) {
    if (loop.state === 'grading') {
      for (const t of q("SELECT * FROM si_tasks WHERE loop_id = ? AND round = ? AND verdict = 'pending' AND run_id IS NOT NULL", loop.id, loop.round)) {
        const r = readRun(t.run_id);
        if (!r.done) continue;
        const g = grade(t.agent_id, r, t.expect ? JSON.parse(t.expect) : null);
        exec('UPDATE si_tasks SET verdict = ?, checks = ?, excerpt = ? WHERE id = ?', g.pass ? 'pass' : 'fail',
          JSON.stringify({ ...g.checks, missing: g.missing, guard: g.guard }), String(r.raw || r.why || '').slice(0, 600), t.id);
      }
      if (one("SELECT COUNT(*) AS n FROM si_tasks WHERE loop_id = ? AND round = ? AND verdict = 'pending'", loop.id, loop.round).n) continue;
      const agents = byAgent(loop.id, loop.round);
      const passed = Object.values(agents).reduce((a, x) => a + x.passed, 0);
      const total = Object.values(agents).reduce((a, x) => a + x.total, 0);
      exec('INSERT OR REPLACE INTO si_rounds (loop_id, round, passed, total, by_agent) VALUES (?,?,?,?,?)', loop.id, loop.round, passed, total, JSON.stringify(agents));
      const pass = total ? passed / total : 0;
      exec('UPDATE si_loops SET last_pass = ?, first_pass = COALESCE(first_pass, ?) WHERE id = ?', pass, pass, loop.id);
      if (loop.round > 1) judgeRewrites(loop, loop.round);
      if (pass >= loop.target) { finish(loop, 'target reached'); continue; }
      if (loop.round >= loop.max_rounds) { finish(loop, 'last round'); continue; }
      if (!coach(loop, loop.round)) { finish(loop, 'nothing to coach'); continue; }
      exec("UPDATE si_loops SET state = 'coaching' WHERE id = ?", loop.id);
    } else {
      for (const c of q("SELECT * FROM si_coach WHERE loop_id = ? AND round = ? AND state = 'thinking'", loop.id, loop.round)) {
        const r = readRun(c.run_id);
        if (!r.done) continue;
        const p = r.parsed || {};
        const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 240)).filter((x) => x.length >= 8).slice(0, 5);
        const add = clean(p.add); const remove = clean(p.remove);
        exec('UPDATE si_coach SET state = ?, added = ?, removed = ?, why = ? WHERE id = ?', add.length || remove.length ? 'proposed' : 'empty',
          JSON.stringify(add), JSON.stringify(remove), String(p.why || r.why || '').slice(0, 600), c.id);
      }
      if (one("SELECT COUNT(*) AS n FROM si_coach WHERE loop_id = ? AND round = ? AND state = 'thinking'", loop.id, loop.round).n) continue;
      const proposed = q("SELECT * FROM si_coach WHERE loop_id = ? AND round = ? AND state = 'proposed'", loop.id, loop.round);
      if (!proposed.length) finish(loop, 'the coach had nothing to change');
      else if (loop.mode === 'auto') {
        for (const c of proposed) applyRewrite(c, loop, SYSTEM);
        nextRound(loop);
      } else exec("UPDATE si_loops SET state = 'waiting' WHERE id = ?", loop.id);
    }
  }
}

/** In "ask" mode, a person accepts or rejects each rewrite; the loop goes on when none is left. */
export function decideRewrite({ id, verdict, actor }) {
  if (!isHuman(actor)) refuse('a person decides', 403);
  const c = one("SELECT * FROM si_coach WHERE id = ? AND state = 'proposed'", Number(id));
  if (!c) refuse('no such proposal', 404);
  const loop = one('SELECT * FROM si_loops WHERE id = ?', c.loop_id);
  if (verdict === 'accept') applyRewrite(c, loop, actor);
  else if (verdict === 'reject') exec("UPDATE si_coach SET state = 'rejected', decided_by = ? WHERE id = ?", actor, c.id);
  else refuse('accept or reject');
  audit({ actorType: 'human', actorId: actor, action: `selfimprove.rewrite_${verdict}ed`, subjectType: 'si_coach', subjectId: c.id, payload: { agent: c.agent_id } });
  if (loop.state === 'waiting' && !one("SELECT COUNT(*) AS n FROM si_coach WHERE loop_id = ? AND round = ? AND state = 'proposed'", loop.id, loop.round).n) {
    if (one("SELECT COUNT(*) AS n FROM si_coach WHERE loop_id = ? AND round = ? AND state = 'applied'", loop.id, loop.round).n) nextRound(loop);
    else finish(loop, 'every rewrite was rejected');
  }
  return getLoop(loop.id);
}

/** Undo one rewrite by hand, at any time: the playbook goes back to what it was before it. */
export function revertVersion({ id, actor }) {
  if (!isHuman(actor)) refuse('a person reverts', 403);
  const v = one('SELECT * FROM playbook_versions WHERE id = ?', Number(id));
  if (!v) refuse('no such version', 404);
  if (v.state === 'reverted') refuse('already reverted');
  const latest = one('SELECT MAX(version) AS v FROM playbook_versions WHERE agent_id = ? AND state <> \'reverted\'', v.agent_id).v;
  if (v.version !== latest) refuse('revert the later versions first — they were written on top of this one');
  writePlaybook(v.agent_id, v.before_body, { actor, reason: `reverted v${v.version} by hand` });
  exec("UPDATE playbook_versions SET state = 'reverted', decided_by = ? WHERE id = ?", actor, v.id);
  audit({ actorType: 'human', actorId: actor, action: 'selfimprove.reverted', subjectType: 'agent', subjectId: v.agent_id, payload: { version: v.version } });
  return { ok: true };
}

export function stopLoop({ id, actor }) {
  if (!isHuman(actor)) refuse('a person stops a loop', 403);
  const r = exec("UPDATE si_loops SET state = 'stopped', finished_at = datetime('now'), note = 'stopped by a person' WHERE id = ? AND state IN ('grading','coaching','waiting')", Number(id));
  if (!r.changes) refuse('no such running loop', 404);
  audit({ actorType: 'human', actorId: actor, action: 'selfimprove.stopped', subjectType: 'si_loop', subjectId: Number(id) });
  return getLoop(id);
}

export function getLoop(id) {
  const l = one('SELECT * FROM si_loops WHERE id = ?', Number(id));
  if (!l) refuse('no such loop', 404);
  const rounds = q('SELECT round, passed, total, by_agent FROM si_rounds WHERE loop_id = ? ORDER BY round', l.id).map((r) => ({ ...r, by_agent: JSON.parse(r.by_agent) }));
  const versions = q('SELECT id, agent_id, version, round, removed, added, state FROM playbook_versions WHERE loop_id = ? ORDER BY id', l.id)
    .map((v) => ({ ...v, removed: JSON.parse(v.removed), added: JSON.parse(v.added) }));
  const last = rounds.at(-1)?.round;
  const fixed = last && last > 1 ? one(`SELECT COUNT(*) AS n FROM si_tasks a JOIN si_tasks b ON b.loop_id = a.loop_id AND b.case_key = a.case_key AND b.agent_id = a.agent_id
      WHERE a.loop_id = ? AND a.round = 1 AND a.verdict = 'fail' AND b.round = ? AND b.verdict = 'pass'`, l.id, last).n : 0;
  const byMe = one(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'memory.playbook_written' AND actor_type = 'human' AND occurred_at >= ?`, l.started_at).n;
  return {
    ...l, scope: JSON.parse(l.scope), firstPass: l.first_pass, lastPass: l.last_pass, rounds, versions,
    coach: q('SELECT id, round, agent_id, state, added, removed, why FROM si_coach WHERE loop_id = ? ORDER BY id DESC LIMIT 60', l.id)
      .map((c) => ({ ...c, added: JSON.parse(c.added || '[]'), removed: JSON.parse(c.removed || '[]') })),
    tasks: q('SELECT agent_id, case_key, source, round, verdict, checks FROM si_tasks WHERE loop_id = ? AND round = ? ORDER BY id', l.id, l.round)
      .map((t) => ({ ...t, checks: t.checks ? JSON.parse(t.checks) : null })),
    metrics: { rounds: l.round, pass: l.last_pass, rewrites: versions.length, kept: versions.filter((v) => v.state === 'kept').length, reverted: versions.filter((v) => v.state === 'reverted').length, fixed, byMe },
  };
}

export function setMode({ mode: m, actor }) {
  if (!isHuman(actor)) refuse('a person sets this', 403);
  if (!['auto', 'ask'].includes(m)) refuse('auto or ask');
  exec("INSERT INTO settings (k, v) VALUES ('SELF_IMPROVE_MODE', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", m);
  audit({ actorType: 'human', actorId: actor, action: 'selfimprove.mode', subjectType: 'settings', subjectId: 'SELF_IMPROVE_MODE', payload: { mode: m } });
  return overview();
}

/**
 * Everything the map draws, and nothing it does not: the loop if one is
 * running (or the latest), the workforce live otherwise. Pass rates are graded
 * tasks in a loop and finished runs out of one; tools are what each employee
 * really called through the gate, with what the gate refused marked as such.
 */
export function mapData({ loopId = null } = {}) {
  const row = loopId ? one('SELECT id FROM si_loops WHERE id = ?', Number(loopId))
    : one("SELECT id FROM si_loops ORDER BY CASE WHEN state IN ('grading','coaching','waiting') THEN 0 ELSE 1 END, id DESC LIMIT 1");
  const loop = row ? getLoop(row.id) : null;
  const ids = loop ? loop.scope : candidates(16);
  const live = new Map(q(`SELECT agent_id, SUM(state = 'done') AS done, SUM(state IN ('failed','awaiting_human','escalated')) AS bad,
      SUM(state IN ('queued','leased','running')) AS busy, COUNT(*) AS n FROM runs WHERE created_at > datetime('now','-7 days') AND task_type NOT LIKE 'coach:%' GROUP BY agent_id`).map((r) => [r.agent_id, r]));
  const tools = new Map();
  for (const r of q(`SELECT agent_id, connector || '.' || capability AS tool, COUNT(*) AS n, SUM(verdict IN ('blocked','gated')) AS stopped
      FROM egress_log WHERE agent_id IS NOT NULL AND created_at > datetime('now','-30 days') GROUP BY agent_id, tool ORDER BY n DESC`)) {
    if (!tools.has(r.agent_id)) tools.set(r.agent_id, []);
    if (tools.get(r.agent_id).length < 8) tools.get(r.agent_id).push({ name: r.tool, count: r.n, stopped: r.stopped });
  }
  for (const s of q("SELECT agent_id, connector, capability FROM agent_scopes WHERE expires_at IS NULL OR expires_at > datetime('now')")) {
    const list = tools.get(s.agent_id) || [];
    const name = `${s.connector}.${s.capability}`;
    if (!list.some((t) => t.name === name) && list.length < 8) list.push({ name, count: 0, stopped: 0, granted: true });
    tools.set(s.agent_id, list);
  }
  const lastRound = loop?.rounds.at(-1);
  const workers = ids.map((id) => {
    const s = spec(id) || { id, name: id };
    const l = live.get(id) || { done: 0, bad: 0, busy: 0, n: 0 };
    const series = loop ? loop.rounds.map((r) => rate(r.by_agent[id])) : [];
    const graded = loop ? loop.tasks.filter((t) => t.agent_id === id) : [];
    const pass = loop
      ? (lastRound?.by_agent[id] ? rate(lastRound.by_agent[id]) : null)
      : (l.done + l.bad ? l.done / (l.done + l.bad) : null);
    return {
      id, name: s.name, group: s.group || 'run', tier: s.tier, role: String(s.system || '').split('.')[0].replace(/^You are (the )?/, '').slice(0, 140),
      pass, series, busy: l.busy, runs: l.n,
      roundTasks: graded.map((t) => ({ key: t.case_key, source: t.source, verdict: t.verdict, failed: t.checks ? Object.entries(t.checks).filter(([k, v]) => v === false && !['missing', 'guard'].includes(k)).map(([k]) => k) : [] })),
      version: one("SELECT MAX(version) AS v FROM playbook_versions WHERE agent_id = ? AND state <> 'reverted'", id)?.v || 0,
      rules: coachRules(readPlaybook(id)),
      tools: tools.get(id) || [],
      contract: contractKeys(s.system),
    };
  });
  const passed = loop ? (lastRound?.passed ?? 0) : workers.reduce((a, w) => a + (live.get(w.id)?.done || 0), 0);
  const total = loop ? (lastRound?.total ?? loop.tasks.length) : workers.reduce((a, w) => a + ((live.get(w.id)?.done || 0) + (live.get(w.id)?.bad || 0)), 0);
  return {
    mode: loop ? 'loop' : 'live',
    loop: loop && {
      id: loop.id, name: loop.name, state: loop.state, round: loop.round, maxRounds: loop.max_rounds, target: loop.target, batch: loop.batch,
      firstPass: loop.firstPass, lastPass: loop.lastPass, rounds: loop.rounds.map((r) => ({ round: r.round, passed: r.passed, total: r.total })),
      metrics: loop.metrics, versions: loop.versions, coach: loop.coach, note: loop.note,
    },
    inputs: {
      goal: loop ? `pass ${Math.round(loop.target * 100)}%` : null,
      tasks: loop ? loop.tasks.length : total,
      golden: loop ? loop.tasks.filter((t) => t.source === 'golden').length : 0,
      history: loop ? loop.tasks.filter((t) => t.source === 'history').length : one("SELECT COUNT(*) AS n FROM runs WHERE created_at > datetime('now','-7 days')").n,
      rubric: RUBRIC,
    },
    coach: { active: (spec(COACH)?.status || 'active') === 'active', mode: mode(), rewrites: loop?.metrics.rewrites ?? one('SELECT COUNT(*) AS n FROM playbook_versions').n, busy: one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state IN ('queued','leased','running')", COACH).n },
    grader: { checks: RUBRIC.length, graded: loop ? loop.tasks.filter((t) => t.verdict !== 'pending').length : total },
    workers,
    gate: { passed, total, rate: total ? passed / total : null },
    more: Math.max(0, agentsConfig.agents.length - ids.length - 1),
  };
}

export function overview() {
  return {
    loops: q('SELECT id, name, state, round, max_rounds, target, first_pass, last_pass, started_at, finished_at FROM si_loops ORDER BY id DESC LIMIT 30'),
    candidates: candidates().map((id) => ({ id, name: spec(id)?.name || id, tasks: tasksFor(id, 3).length })),
    mode: mode(),
    rubric: RUBRIC,
  };
}
