// Workflow engine (ADR-003) — deliberately small state machine + queue.
// States: queued|leased|running|awaiting_human|done|failed|escalated|cancelled.
// awaiting_human is a first-class state, not an error: it is how gates, low
// confidence, budget hard-stops, and fail-closed roles appear in the system.
// Logic failures never retry — retrying a wrong answer produces a confident
// wrong answer; only transport failures requeue, capped by MAX_ATTEMPTS.
import { q, one, exec, uuid } from './db.js';
import { agentsConfig } from './env.js';
import { audit } from './audit.js';
import { route, parseAgentJson, RouterExhausted, BudgetExceeded } from './router.js';

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
  return { ...JSON.parse(row.spec), status: row.status };
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

/** Execute one leased run end-to-end. */
export async function executeRun(run) {
  const spec = getAgentSpec(run.agent_id);
  const input = run.input ? JSON.parse(run.input) : {};
  setState(run.id, 'running');
  audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.started', subjectType: 'run', subjectId: run.id });

  const prompt = [
    input.context ? `Context:\n${input.context}` : null,
    `Task (${run.task_type}):\n${input.prompt || input.task || JSON.stringify(input)}`,
  ].filter(Boolean).join('\n\n');

  try {
    const decision = run.decision_id ? one('SELECT id, tier FROM decisions WHERE id = ?', run.decision_id) : null;
    const baseReq = {
      tier: spec.tier,
      agentId: run.agent_id,
      decisionId: decision,
      sensitivity: spec.sensitivity || 'internal',
      system: spec.system,
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
      // Structural validation failed — never silently pass malformed output.
      setState(run.id, 'awaiting_human', { output, flags: result.flags, failureReason: 'output failed schema validation (no parseable JSON)' });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human', subjectType: 'run', subjectId: run.id, payload: { reason: 'schema' } });
    } else if (forceHumanReason) {
      setState(run.id, 'awaiting_human', { output, flags: result.flags, failureReason: forceHumanReason });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human', subjectType: 'run', subjectId: run.id, payload: { reason: 'same-family-review' } });
    } else if (floor > 0 && typeof confidence === 'number' && confidence < floor) {
      setState(run.id, 'awaiting_human', { output, flags: result.flags, failureReason: `confidence ${confidence} below floor ${floor}` });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.awaiting_human', subjectType: 'run', subjectId: run.id, payload: { reason: 'confidence', confidence } });
    } else {
      setState(run.id, 'done', { output, flags: result.flags });
      audit({ actorType: 'agent', actorId: run.agent_id, action: 'run.done', subjectType: 'run', subjectId: run.id, payload: { costUsd: result.costUsd, provider: result.provider } });
    }
    return one('SELECT * FROM runs WHERE id = ?', run.id);
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
export function startWorkers(intervalMs = 1500) {
  if (workerTimer) return;
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
