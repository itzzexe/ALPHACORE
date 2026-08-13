// Workflow engine (ADR-003) — deliberately small state machine + queue.
// States: queued|leased|running|awaiting_human|done|failed|escalated|cancelled.
// awaiting_human is a first-class state, not an error: it is how gates, low
// confidence, budget hard-stops, and fail-closed roles appear in the system.
// Logic failures never retry — retrying a wrong answer produces a confident
// wrong answer; only transport failures requeue, capped by MAX_ATTEMPTS.
import { q, one, exec, uuid } from './db.js';
import { agentsConfig } from './env.js';
import { audit } from './audit.js';
import { companyName } from './settings.js';
import { route, parseAgentJson, RouterExhausted, BudgetExceeded } from './router.js';
import { personaPrompt } from './org.js';
import { recall, captureEpisode } from './memory.js';
import { promptVersion } from './canary.js';

const MAX_ATTEMPTS = 3;
const LEASE_MINUTES = 10;

/** Upsert the twelve launch role specs from config into the agents table. */
export function seedAgents() {
  for (const a of agentsConfig.agents) {
    const existing = one('SELECT id FROM agents WHERE id = ?', a.id);
    if (existing) {
      exec('UPDATE agents SET name=?, role_group=?, spec=?, model_tier=? WHERE id=?',
        a.name, a.group, JSON.stringify(a), a.tier, a.id);
    } else {
      exec('INSERT INTO agents (id, name, role_group, spec, model_tier, human_owner) VALUES (?,?,?,?,?,?)',
        a.id, a.name, a.group, JSON.stringify(a), a.tier, a.owner);
      audit({ actorType: 'system', actorId: 'seed', action: 'agent.registered', subjectType: 'agent', subjectId: a.id });
    }
  }
}

export function getAgentSpec(agentId) {
  const row = one('SELECT * FROM agents WHERE id = ?', agentId);
  if (!row) return null;
  let spec = {};
  try { spec = JSON.parse(row.spec) || {}; } catch { /* a broken spec still gets defaults below */ }
  // Employees written by the blueprint carry `tier` in their spec. Ones hired
  // later — by recruiting, or seeded by a department — may name it differently
  // or not at all, and a spec without a tier gives the router no chain to try:
  // "Router exhausted for undefined". The column is the source of truth.
  const tier = spec.tier || spec.modelTier || row.model_tier || 'T1';
  return {
    ...spec,
    tier,
    status: row.status,
    // {{company}} in a blueprint prompt resolves here, so an install that names
    // itself gets that name in every system prompt it sends — and one that has
    // not been named yet says "this company" rather than ours.
    system: (spec.system || `You are ${row.name} at {{company}}. ${spec.mission || ''} Answer only with the JSON you were asked for.`)
      .replaceAll('{{company}}', companyName()),
    sensitivity: spec.sensitivity || 'internal',
  };
}

export function enqueueRun({ agentId, taskType, input, decisionId = null, parentRunId = null, pipelineId = null, actor = 'human:admin' }) {
  const spec = getAgentSpec(agentId);
  if (!spec) throw new Error(`unknown agent ${agentId}`);
  if (spec.status !== 'active') throw new Error(`agent ${agentId} is ${spec.status}`);
  const id = uuid();
  exec(
    'INSERT INTO runs (id, agent_id, parent_run_id, decision_id, task_type, input, pipeline_id) VALUES (?,?,?,?,?,?,?)',
    id, agentId, parentRunId, decisionId, taskType, JSON.stringify(input), pipelineId,
  );
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'run.enqueued', subjectType: 'run', subjectId: id, payload: { agentId, taskType } });
  return id;
}

function setState(runId, state, extra = {}) {
  const sets = ['state = ?'];
  const vals = [state];
  if (extra.failureReason !== undefined) { sets.push('failure_reason = ?'); vals.push(extra.failureReason); }
  if (extra.output !== undefined) { sets.push('output = ?'); vals.push(JSON.stringify(extra.output)); }
  if (extra.flags !== undefined) { sets.push('flags = ?'); vals.push(JSON.stringify(extra.flags)); }
  // Recorded on every terminal state, not only success: a run that stopped at
  // the gate is exactly the one somebody will want to reproduce.
  if (extra.provider !== undefined) { sets.push('provider = ?'); vals.push(extra.provider); }
  if (extra.model !== undefined) { sets.push('model = ?'); vals.push(extra.model); }
  if (extra.family !== undefined) { sets.push('model_family = ?'); vals.push(extra.family); }
  if (extra.promptVersion !== undefined) { sets.push('prompt_version = ?'); vals.push(extra.promptVersion); }
  if (['done', 'failed', 'cancelled', 'escalated'].includes(state)) sets.push("ended_at = datetime('now')");
  vals.push(runId);
  exec(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`, ...vals);
}

export function leaseNext() {
  const row = one(
    `SELECT * FROM runs
     WHERE state = 'queued' OR (state = 'leased' AND lease_until < datetime('now'))
     ORDER BY created_at ASC LIMIT 1`,
  );
  if (!row) return null;
  exec(
    `UPDATE runs SET state = 'leased', lease_until = datetime('now', '+${LEASE_MINUTES} minutes'), attempts = attempts + 1 WHERE id = ?`,
    row.id,
  );
  return one('SELECT * FROM runs WHERE id = ?', row.id);
}

/**
 * Did the employee refuse rather than fumble? Refusals arrive as prose in the
 * first person, in either language; the first sentences carry the reason.
 */
const DECLINE_MARKERS = [
  "i'm not going to", 'i am not going to', "i won't", 'i will not',
  "i can't help", 'i cannot help', "i can't assist", 'i cannot assist',
  'i must decline', 'i have to decline', "i'm declining", 'i refuse',
  'لن أقوم', 'لا أستطيع المساعدة', 'أرفض', 'لن أنفذ',
];
function declinedReason(text) {
  const t = String(text || '');
  const head = t.slice(0, 400).toLowerCase();
  if (!DECLINE_MARKERS.some((m) => head.includes(m))) return null;
  const sentence = t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?؟])\s/).slice(0, 2).join(' ');
  return sentence.slice(0, 300);
}

/** Execute one leased run end-to-end. */
export async function executeRun(run) {
  const spec = getAgentSpec(run.agent_id);
  const input = run.input ? JSON.parse(run.input) : {};
  setState(run.id, 'running');
  audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.started', subjectType: 'run', subjectId: run.id });

  const taskText = input.prompt || input.task || JSON.stringify(input);
  // Memory is injected here, at the single choke point every department's work
  // passes through: the agent's own playbook plus what retrieval says is
  // relevant. Never fatal — an employee with amnesia still does the job.
  let memoryBlock = null;
  try { memoryBlock = recall(run.agent_id, `${input.context || ''} ${taskText}`, { runId: run.id }); }
  catch { /* memory is an advantage, not a dependency */ }

  const prompt = [
    memoryBlock,
    input.context ? `Context:\n${input.context}` : null,
    `Task (${run.task_type}):\n${taskText}`,
  ].filter(Boolean).join('\n\n');

  try {
    const decision = run.decision_id ? one('SELECT id, tier FROM decisions WHERE id = ?', run.decision_id) : null;
    // The prompt is the other half of reproducibility — the model was already
    // recorded. Stamped here, once, before anything is sent, so a run that
    // fails still says what it was asked with.
    const promptV = promptVersion(run.agent_id, spec.system);
    const baseReq = {
      tier: spec.tier,
      agentId: run.agent_id,
      decisionId: decision,
      sensitivity: spec.sensitivity || 'internal',
      // The persona is appended, never substituted: character shapes how the
      // work reads, the role specification still governs what it may do.
      system: spec.system + personaPrompt(run.agent_id),
      prompt,
      runId: run.id,
    };
    let result;
    let forceHumanReason = null;
    try {
      result = await route({ ...baseReq, familyNot: spec.familyNot || null });
    } catch (err) {
      if (err instanceof RouterExhausted && spec.familyNot) {
        // Blueprint Part 1 §8.3: author/reviewer from different families "where
        // feasible". Not feasible right now — degrade to same-family review
        // with a prominent flag, and force the human gate on the result.
        result = await route({ ...baseReq, familyNot: null });
        result.flags = [...(result.flags || []), 'same-family-review'];
        forceHumanReason = `independent family (≠${spec.familyNot}) unavailable — same-family review requires human confirmation`;
        audit({ actorType: 'system', actorId: 'router', action: 'run.family_degraded', subjectType: 'run', subjectId: run.id, payload: { familyNot: spec.familyNot } });
      } else throw err;
    }

    exec('UPDATE runs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ? WHERE id = ?',
      result.tokensIn, result.tokensOut, result.costUsd, run.id);

    const parsed = parseAgentJson(result.text);
    const output = { raw: result.text, parsed, provider: result.provider, model: result.model };
    const floor = spec.confidenceFloor ?? 0;
    const confidence = parsed?.confidence;

    if (parsed === null) {
      // Two very different things produce unparseable output, and calling both
      // "schema validation" hid the important one: an employee that declined
      // the work and said why. A refusal is an answer, not a malformed reply,
      // and the person who asked deserves to read it.
      const declined = declinedReason(result.text);
      setState(run.id, 'awaiting_human', {
        output, flags: [...(result.flags || []), declined ? 'declined' : 'unparseable'],
        failureReason: declined
          ? `${run.agent_id} declined this work — ${declined}`
          : 'output failed schema validation (no parseable JSON)',
      });
      audit({
        actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human',
        subjectType: 'run', subjectId: run.id,
        payload: { reason: declined ? 'declined' : 'schema', detail: declined ? declined.slice(0, 200) : undefined },
      });
    } else if (forceHumanReason) {
      setState(run.id, 'awaiting_human', { output, flags: result.flags, failureReason: forceHumanReason, provider: result.provider, model: result.model, family: result.family, promptVersion: promptV });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human', subjectType: 'run', subjectId: run.id, payload: { reason: 'same-family-review' } });
    } else if (floor > 0 && typeof confidence === 'number' && confidence < floor) {
      setState(run.id, 'awaiting_human', { output, flags: result.flags, failureReason: `confidence ${confidence} below floor ${floor}`, provider: result.provider, model: result.model, family: result.family, promptVersion: promptV });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human', subjectType: 'run', subjectId: run.id, payload: { reason: 'confidence', confidence } });
    } else {
      setState(run.id, 'done', { output, flags: result.flags, provider: result.provider, model: result.model, family: result.family, promptVersion: promptV });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.done', subjectType: 'run', subjectId: run.id, payload: { costUsd: result.costUsd, provider: result.provider, model: result.model } });
    }
    const finished = one('SELECT * FROM runs WHERE id = ?', run.id);
    // Experience is kept whether the work passed or stopped at the gate —
    // a run that needed a human is exactly the kind of thing worth remembering.
    try { captureEpisode(finished); } catch { /* never fail a run over its diary */ }
    return finished;
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      // Hard budget stop = checkpoint + awaiting_human (Part 3 §5.2) — never silent truncation.
      setState(run.id, 'awaiting_human', { failureReason: `budget hard-stop: ${err.message}` });
      audit({ actorType: 'system', actorId: 'policy', action: 'run.budget_stop', subjectType: 'run', subjectId: run.id, payload: { scope: err.scope, scopeId: err.scopeId } });
    } else if (err instanceof RouterExhausted) {
      // Tier policy already decided the failure mode: everything lands on a human.
      setState(run.id, 'awaiting_human', { failureReason: `router exhausted (${err.mode}): ${err.message}` });
      audit({ actorType: 'system', actorId: 'router', action: 'run.escalated', subjectType: 'run', subjectId: run.id, payload: { mode: err.mode } });
    } else if (run.attempts < MAX_ATTEMPTS) {
      // Transport-class failure — requeue within the attempts cap.
      exec("UPDATE runs SET state = 'queued', failure_reason = ? WHERE id = ?", String(err.message).slice(0, 300), run.id);
      audit({ actorType: 'system', actorId: 'workflow', action: 'run.requeued', subjectType: 'run', subjectId: run.id, payload: { attempt: run.attempts } });
    } else {
      setState(run.id, 'failed', { failureReason: String(err.message).slice(0, 300) });
      exec('INSERT INTO dead_letter (run_id, reason) VALUES (?, ?)', run.id, String(err.message).slice(0, 300));
      audit({ actorType: 'system', actorId: 'workflow', action: 'run.dead_letter', subjectType: 'run', subjectId: run.id });
    }
    return one('SELECT * FROM runs WHERE id = ?', run.id);
  }
}

/**
 * Work that failed for good.
 *
 * `dead_letter` has been written on every exhausted run since the queue was
 * built, and nothing has ever read it. That is the worst shape a table can
 * have: the company records its own permanent failures and shows them to
 * nobody, so the dashboard stays green while the work quietly does not happen.
 */
export function deadLetters({ limit = 100, includeRevived = false } = {}) {
  return q(
    `SELECT d.id, d.run_id, d.reason, d.created_at,
            r.agent_id, r.task_type, r.state, r.attempts, r.cost_usd, r.decision_id, r.pipeline_id
       FROM dead_letter d
       LEFT JOIN runs r ON r.id = d.run_id
      ${includeRevived ? '' : "WHERE r.state = 'failed' OR r.state IS NULL"}
      ORDER BY d.id DESC LIMIT ?`, limit,
  );
}

/** What is dying, grouped by why — the shape that tells you where to look. */
export function deadLetterOverview() {
  const rows = deadLetters({ limit: 500 });
  const byReason = new Map();
  for (const d of rows) {
    // The first clause of the message: everything after it is usually an id or
    // a timestamp, and grouping on the whole string gives four hundred groups
    // of one, which is the same as no grouping.
    const key = String(d.reason || 'unknown').split(/[:(]/)[0].trim().slice(0, 70);
    const cur = byReason.get(key) || { reason: key, n: 0, agents: new Set(), costUsd: 0 };
    cur.n += 1;
    if (d.agent_id) cur.agents.add(d.agent_id);
    cur.costUsd += Number(d.cost_usd || 0);
    byReason.set(key, cur);
  }
  return {
    total: one('SELECT COUNT(*) AS n FROM dead_letter').n,
    waiting: rows.length,
    // Money already spent on work that produced nothing. Somebody should see it.
    wastedUsd: Number(rows.reduce((n, d) => n + Number(d.cost_usd || 0), 0).toFixed(4)),
    byReason: [...byReason.values()]
      .map((r) => ({ ...r, agents: [...r.agents], costUsd: Number(r.costUsd.toFixed(4)) }))
      .sort((a, b) => b.n - a.n),
    recent: rows.slice(0, 40),
    lastDeath: one('SELECT created_at FROM dead_letter ORDER BY id DESC LIMIT 1')?.created_at || null,
  };
}

/**
 * Put a dead run back on the queue.
 *
 * Signed, because a run that failed four times and is being asked to try again
 * is a decision, and because the reason it failed may still be there — a revival
 * that fails four more times has cost the company twice for nothing.
 */
export function reviveRun(runId, { actor, why = '' }) {
  if (!actor) { const e = new Error('reviving dead work has to be signed'); e.status = 400; throw e; }
  const run = one('SELECT * FROM runs WHERE id = ?', runId);
  if (!run) { const e = new Error('no such run'); e.status = 404; throw e; }
  if (run.state !== 'failed') { const e = new Error(`that run is ${run.state}, not dead`); e.status = 400; throw e; }
  exec("UPDATE runs SET state = 'queued', attempts = 0, failure_reason = NULL, lease_until = NULL WHERE id = ?", runId);
  audit({
    actorType: 'human', actorId: actor, action: 'run.revived',
    subjectType: 'run', subjectId: runId,
    payload: { why, hadFailed: run.failure_reason, attempts: run.attempts },
  });
  return { ok: true, id: runId, state: 'queued' };
}

/** Human gate actions on awaiting_human runs. */
export function resolveRun(runId, verdict, approver, note = null) {
  const run = one('SELECT * FROM runs WHERE id = ?', runId);
  if (!run) throw new Error('run not found');
  if (run.state !== 'awaiting_human') throw new Error(`run is ${run.state}, not awaiting_human`);
  exec('INSERT INTO approvals (subject_type, subject_id, gate, approver_human, verdict, note) VALUES (?,?,?,?,?,?)',
    'run', runId, 'human-review', approver, verdict, note);
  setState(runId, verdict === 'approved' ? 'done' : 'cancelled');
  audit({ actorType: 'human', actorId: approver, action: `run.${verdict}`, subjectType: 'run', subjectId: runId, payload: { note } });
  return one('SELECT * FROM runs WHERE id = ?', runId);
}

let workerTimer = null;
let executing = 0;
const CONCURRENCY = 2;

/** Background worker loop: lease → execute, bounded concurrency. */
/**
 * A run marked "running" when this process starts is orphaned by definition:
 * the only thing that could have been executing it was a worker in a process
 * that is now gone. Left alone it sits in the queue for ever, holding a slot
 * and quietly breaching the objective that says nothing stalls. Put it back.
 */
export function reclaimOrphanedRuns() {
  const orphans = q("SELECT id, agent_id, task_type FROM runs WHERE state = 'running'");
  if (!orphans.length) return 0;
  exec("UPDATE runs SET state = 'queued' WHERE state = 'running'");
  audit({
    actorType: 'system', actorId: 'system:workers', action: 'runs.reclaimed',
    payload: { count: orphans.length, runs: orphans.slice(0, 10).map((r) => `${r.agent_id}:${r.task_type}`) },
  });
  return orphans.length;
}

export function startWorkers(intervalMs = 1500) {
  if (workerTimer) return;
  // Before taking any new work, take back what the last process dropped.
  reclaimOrphanedRuns();
  workerTimer = setInterval(async () => {
    while (executing < CONCURRENCY) {
      const run = leaseNext();
      if (!run) break;
      executing += 1;
      executeRun(run).catch(() => {}).finally(() => { executing -= 1; });
    }
  }, intervalMs);
  workerTimer.unref?.();
}

export function stopWorkers() {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}

export function queueStats() {
  const rows = q("SELECT state, COUNT(*) AS n FROM runs GROUP BY state");
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}
