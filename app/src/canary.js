// Prompt versions, and not changing a model chain on a hunch.
//
// Two things that make the AI layer reproducible instead of merely working.
//
// **Versions.** A system prompt is the largest single input to what an employee
// produces, and it is edited casually — a sentence added here, a constraint
// softened there. Without a version, "why did this get worse last Tuesday" has
// no answer, because nothing recorded that anything changed. Every run already
// records the model that answered it; it should record the prompt too.
//
// **Canaries.** A tier is a chain of provider/model candidates. Changing one —
// swapping a model for its successor, adding a cheaper provider at the front —
// changes the behaviour of every employee on that tier at once, and the change
// is invisible until output quality drops in a way nobody attributes to it.
// The honest procedure is old and dull: run the same tasks against both, look
// at the difference, and have a person decide. What was missing was any way to
// do that.
import { createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { providersConfig } from './env.js';
import { getSetting, setSetting } from './settings.js';

// ---------------------------------------------------------------- prompts --

const digest = (text) => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);

/**
 * The version of a system prompt: its content hash, recorded the first time it
 * is seen.
 *
 * Content-addressed rather than numbered, so an edit and a revert produce the
 * same version rather than a third one — and so two installs running the same
 * prompt agree about what it is without coordinating.
 */
export function promptVersion(agentId, system) {
  const hash = digest(system);
  const existing = one('SELECT * FROM prompt_versions WHERE agent_id = ? AND hash = ?', agentId, hash);
  if (existing) {
    exec("UPDATE prompt_versions SET last_seen = datetime('now'), uses = uses + 1 WHERE id = ?", existing.id);
    return hash;
  }

  const previous = one('SELECT hash FROM prompt_versions WHERE agent_id = ? ORDER BY id DESC LIMIT 1', agentId);
  exec(
    'INSERT INTO prompt_versions (agent_id, hash, text, chars, uses) VALUES (?,?,?,?,1)',
    agentId, hash, String(system ?? ''), String(system ?? '').length,
  );
  if (previous) {
    // Only a *change* is worth an entry. Recording the first sight of every
    // agent's prompt at boot would put fifty entries on the chain and teach
    // everybody to scroll past them.
    audit({
      actorType: 'system', actorId: 'system:prompts', action: 'prompt.changed',
      subjectType: 'agent', subjectId: agentId,
      payload: { from: previous.hash, to: hash },
    });
  }
  return hash;
}

export function promptHistory(agentId) {
  return q('SELECT hash, chars, uses, first_seen, last_seen FROM prompt_versions WHERE agent_id = ? ORDER BY id DESC', agentId);
}

export function promptText(agentId, hash) {
  return one('SELECT text FROM prompt_versions WHERE agent_id = ? AND hash = ?', agentId, hash)?.text || null;
}

// ----------------------------------------------------------------- chains --

/**
 * The chain a tier resolves to now: the file, unless an override has been
 * promoted over it.
 *
 * The override lives in settings rather than by editing providers.json,
 * because a change made by editing a file that ships with the repository is a
 * change that a `git pull` silently reverts.
 */
export function tierChain(tier) {
  let overrides = {};
  try { overrides = JSON.parse(getSetting('TIER_OVERRIDES') || '{}'); } catch { /* file it is */ }
  return overrides[tier] || providersConfig.tiers[tier]?.chain || [];
}

export function tiersOverview() {
  let overrides = {};
  try { overrides = JSON.parse(getSetting('TIER_OVERRIDES') || '{}'); } catch { /* none */ }
  return Object.keys(providersConfig.tiers).map((tier) => ({
    tier,
    purpose: providersConfig.tiers[tier].purpose,
    chain: tierChain(tier),
    overridden: Boolean(overrides[tier]),
    fromFile: providersConfig.tiers[tier].chain,
  }));
}

// ---------------------------------------------------------------- canaries --

/**
 * The tasks a candidate chain has to answer before it is allowed near the
 * company's work.
 *
 * Deliberately small and deliberately boring: this is a regression check, not
 * a benchmark. The question is "does the new chain still do the things we
 * depend on", and the things depended on are structure, refusal, and arithmetic
 * — the three ways a model change breaks a pipeline quietly.
 */
const CANARY_TASKS = [
  {
    id: 'json-shape',
    why: 'every pipeline parses the answer; a model that stops emitting clean JSON breaks all of them at once',
    prompt: 'Reply with exactly this JSON and nothing else: {"ok": true, "n": 42}',
    check: (text) => {
      try {
        const m = String(text).match(/\{[\s\S]*\}/);
        const o = JSON.parse(m ? m[0] : text);
        return o.ok === true && Number(o.n) === 42;
      } catch { return false; }
    },
  },
  {
    id: 'follows-constraint',
    why: 'a model that ignores an explicit limit will ignore the ones that matter',
    prompt: 'Answer with a single word, lowercase, no punctuation: what colour is a clear midday sky?',
    check: (text) => /^\s*blue\s*$/i.test(String(text)),
  },
  {
    id: 'declines-invention',
    why: 'the whole intelligence pipeline rests on a model saying "I do not know" rather than filling the gap',
    prompt: 'Reply with exactly the word UNKNOWN if you do not know: what is the mobile telephone number of the current mayor of Basra?',
    check: (text) => /unknown/i.test(String(text)) || /(do not|don't|cannot|can't)\s+(know|have)/i.test(String(text)),
  },
  {
    id: 'arithmetic',
    why: 'financial summaries are generated; a model that fumbles simple sums writes confident wrong numbers',
    prompt: 'Reply with the number only: what is 1284 plus 3719?',
    check: (text) => /\b5003\b/.test(String(text).replace(/[, ]/g, '')),
  },
  {
    id: 'holds-the-language',
    why: 'this company works in Arabic as much as English, and a model that silently answers in the wrong one is unusable',
    prompt: 'أجب بكلمة واحدة بالعربية فقط: ما عاصمة العراق؟',
    check: (text) => /بغداد/.test(String(text)),
  },
];

export const CANARY_TASK_IDS = CANARY_TASKS.map((t) => t.id);

/**
 * Propose a change to a tier's chain. Proposing is not applying.
 *
 * Kept apart on purpose: a proposal is a thing to look at, and something that
 * takes effect the moment it is typed cannot be looked at first.
 */
export function proposeChain({ tier, chain, note = null, actor }) {
  if (!actor) throw new Error('a chain change has to be signed');
  if (!providersConfig.tiers[tier]) throw new Error(`no such tier: ${tier}`);
  if (!Array.isArray(chain) || !chain.length) throw new Error('a chain needs at least one provider/model step');
  for (const step of chain) {
    if (!step?.provider || !step?.model) throw new Error('every step needs a provider and a model');
    if (!providersConfig.providers[step.provider]) throw new Error(`no such provider: ${step.provider}`);
  }

  exec(
    "INSERT INTO tier_proposals (tier, current_chain, candidate_chain, note, state, proposed_by) VALUES (?,?,?,?,'proposed',?)",
    tier, JSON.stringify(tierChain(tier)), JSON.stringify(chain), note, actor,
  );
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({
    actorType: 'human', actorId: actor, action: 'tier.proposed',
    subjectType: 'tier', subjectId: tier,
    payload: { proposalId: id, candidate: chain, note },
  });
  return { id, tier, chain };
}

/**
 * Run the canary tasks against both the current chain and the candidate, and
 * record what each did.
 *
 * Both, in the same run, on the same day. Comparing a candidate's score today
 * against the incumbent's score from last month measures the weather as much as
 * the model.
 */
export async function runCanary({ proposalId, route }) {
  const p = one("SELECT * FROM tier_proposals WHERE id = ? AND state IN ('proposed','tested')", proposalId);
  if (!p) throw new Error('no such proposal, or it has already been decided');

  const sides = {
    current: JSON.parse(p.current_chain),
    candidate: JSON.parse(p.candidate_chain),
  };
  const results = { current: [], candidate: [] };

  for (const [side, chain] of Object.entries(sides)) {
    for (const task of CANARY_TASKS) {
      const started = Date.now();
      let text = ''; let error = null; let step = null;
      try {
        const r = await route({
          tier: p.tier,
          chainOverride: chain,
          agentId: 'AGT-CANARY',
          system: 'You follow instructions exactly. You never add commentary.',
          prompt: task.prompt,
          sensitivity: 'internal',
          canary: true,
        });
        text = r.text ?? r.output ?? '';
        step = `${r.provider}/${r.model}`;
      } catch (e) {
        error = String(e.message).slice(0, 200);
      }
      const passed = !error && task.check(text);
      results[side].push({
        task: task.id, passed, ms: Date.now() - started, via: step, error,
        answer: String(text).slice(0, 200),
      });
    }
  }

  const score = (side) => results[side].filter((r) => r.passed).length;
  // A canary run in mock mode compares a stub with itself. Both sides score
  // zero, no regression is detected, and promotion sails through — the exact
  // "it looked fine" failure this whole feature exists to prevent. So the run
  // says whether it proved anything, and promotion refuses to treat a run that
  // proved nothing as evidence.
  const everyAnswerFromMock = [...results.current, ...results.candidate]
    .every((r) => !r.via || r.via.startsWith('mock/'));
  const summary = {
    total: CANARY_TASKS.length,
    current: score('current'),
    candidate: score('candidate'),
    conclusive: !everyAnswerFromMock && (score('current') > 0 || score('candidate') > 0),
    inconclusiveBecause: everyAnswerFromMock
      ? 'every answer came from the deterministic mock: this compared a stub with itself and shows nothing about either chain'
      : (score('current') === 0 && score('candidate') === 0)
        ? 'neither chain passed a single task — that is a broken setup, not a comparison'
        : null,
    // Named individually: "four out of five" hides which one broke, and which
    // one broke is the entire decision.
    regressions: CANARY_TASKS
      .filter((t, i) => results.current[i].passed && !results.candidate[i].passed)
      .map((t) => ({ task: t.id, why: t.why })),
    improvements: CANARY_TASKS
      .filter((t, i) => !results.current[i].passed && results.candidate[i].passed)
      .map((t) => t.id),
  };

  exec(
    "UPDATE tier_proposals SET state = 'tested', results = ?, summary = ?, tested_at = datetime('now') WHERE id = ?",
    JSON.stringify(results), JSON.stringify(summary), proposalId,
  );
  audit({
    actorType: 'system', actorId: 'system:canary', action: 'tier.canary_ran',
    subjectType: 'tier', subjectId: p.tier,
    payload: { proposalId, ...summary },
  });
  return { proposalId, tier: p.tier, summary, results };
}

/**
 * Put the candidate into service.
 *
 * A person, always — and a person who has been told what regressed rather than
 * one who has to go and look. Promoting over a regression is allowed and has to
 * be said out loud, because sometimes it is the right call and the reason
 * belongs on the record.
 */
export function promoteChain({ proposalId, actor, acceptRegressions = false }) {
  if (!actor) throw new Error('promoting a chain is a human act and has to be signed');
  const p = one("SELECT * FROM tier_proposals WHERE id = ?", proposalId);
  if (!p) throw new Error('no such proposal');
  if (p.state === 'promoted') return { alreadyPromoted: true, tier: p.tier };
  if (p.state !== 'tested') throw new Error('run the canary first — promoting an untested chain is the thing this exists to prevent');

  const summary = JSON.parse(p.summary || '{}');
  if (summary.conclusive === false) {
    return {
      ok: false,
      blocked: true,
      inconclusive: summary.inconclusiveBecause,
      say: 'run the canary again with a real provider configured — promoting on a run that proved nothing is the failure this exists to prevent',
    };
  }
  if (summary.regressions?.length && !acceptRegressions) {
    return {
      ok: false,
      blocked: true,
      regressions: summary.regressions,
      say: 'promote again with acceptRegressions and a note saying why this is the right call anyway',
    };
  }

  let overrides = {};
  try { overrides = JSON.parse(getSetting('TIER_OVERRIDES') || '{}'); } catch { /* start fresh */ }
  overrides[p.tier] = JSON.parse(p.candidate_chain);
  setSetting('TIER_OVERRIDES', JSON.stringify(overrides));

  exec("UPDATE tier_proposals SET state = 'promoted', promoted_by = ?, promoted_at = datetime('now') WHERE id = ?", actor, proposalId);
  audit({
    actorType: 'human', actorId: actor, action: 'tier.promoted',
    subjectType: 'tier', subjectId: p.tier,
    payload: {
      proposalId, chain: JSON.parse(p.candidate_chain),
      canary: summary, overRegressions: Boolean(summary.regressions?.length),
    },
  });
  return { ok: true, tier: p.tier, chain: JSON.parse(p.candidate_chain) };
}

/** Back to the file. The button somebody needs at 2am. */
export function revertChain({ tier, actor }) {
  if (!actor) throw new Error('reverting a chain has to be signed');
  let overrides = {};
  try { overrides = JSON.parse(getSetting('TIER_OVERRIDES') || '{}'); } catch { /* nothing to do */ }
  if (!overrides[tier]) return { ok: true, alreadyOnFile: true };
  delete overrides[tier];
  setSetting('TIER_OVERRIDES', JSON.stringify(overrides));
  audit({
    actorType: 'human', actorId: actor, action: 'tier.reverted',
    subjectType: 'tier', subjectId: tier,
    payload: { back_to: providersConfig.tiers[tier]?.chain },
  });
  return { ok: true, tier, chain: providersConfig.tiers[tier]?.chain };
}

export function canaryOverview() {
  return {
    tiers: tiersOverview(),
    tasks: CANARY_TASKS.map((t) => ({ id: t.id, why: t.why })),
    proposals: q('SELECT * FROM tier_proposals ORDER BY id DESC LIMIT 30').map((p) => ({
      id: p.id, tier: p.tier, state: p.state,
      candidate: JSON.parse(p.candidate_chain),
      summary: p.summary ? JSON.parse(p.summary) : null,
      note: p.note, proposedBy: p.proposed_by, promotedBy: p.promoted_by,
      testedAt: p.tested_at, promotedAt: p.promoted_at,
    })),
    prompts: q(`SELECT agent_id, COUNT(*) AS versions, MAX(last_seen) AS last
                FROM prompt_versions GROUP BY agent_id
                HAVING versions > 1 ORDER BY versions DESC LIMIT 20`),
  };
}
