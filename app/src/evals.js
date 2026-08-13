// Evaluation harness + reputation (Part 3 §10, Part 2 §7.6).
// Golden sets prove a role still does its job; canary defects prove reviewers
// still catch what they must. Scores feed a hard-capped accuracy factor
// (0.85–1.15) computed ONLY from audited outcomes — never self-reported.
import { q, one, exec } from './db.js';
import { agentsConfig } from './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { audit } from './audit.js';
import { route, parseAgentJson } from './router.js';

const goldenSets = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'golden-sets.json'), 'utf8')).sets;

export function listSets() {
  return Object.entries(goldenSets).map(([agentId, s]) => ({
    agentId, kind: s.kind, cases: s.cases.map((c) => c.name),
    lastRun: one('SELECT score, passed, total, created_at FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 1', agentId) || null,
  }));
}

export function listEvalRuns() {
  return q('SELECT * FROM eval_runs ORDER BY id DESC LIMIT 100').map((r) => ({ ...r, details: JSON.parse(r.details) }));
}

/** Run one role's golden set live. Consumes real model usage — human-triggered. */
export async function runEvalSet(agentId, actor = 'human:admin') {
  const set = goldenSets[agentId];
  if (!set) throw new Error(`no golden set for ${agentId}`);
  const spec = agentsConfig.agents.find((a) => a.id === agentId);
  if (!spec) throw new Error(`unknown agent ${agentId}`);

  const details = [];
  let passed = 0, cost = 0;
  for (const c of set.cases) {
    let verdict = 'error', got = null, ok = false;
    try {
      const result = await route({
        tier: spec.tier, agentId, sensitivity: spec.sensitivity || 'internal',
        system: spec.system, prompt: c.prompt, runId: null,
      });
      cost += result.costUsd;
      const parsed = parseAgentJson(result.text);
      got = parsed ? parsed[c.expectField] : null;
      ok = parsed !== null && c.expectAnyOf.some((e) => String(e).toLowerCase() === String(got).toLowerCase());
      verdict = ok ? 'pass' : 'fail';
    } catch (err) {
      verdict = 'error'; got = String(err.message).slice(0, 120);
    }
    if (ok) passed += 1;
    details.push({ name: c.name, verdict, expectField: c.expectField, expectAnyOf: c.expectAnyOf, got });
  }
  const score = set.cases.length ? passed / set.cases.length : 0;
  exec('INSERT INTO eval_runs (agent_id, kind, score, passed, total, details, cost_usd) VALUES (?,?,?,?,?,?,?)',
    agentId, set.kind, score, passed, set.cases.length, JSON.stringify(details), cost);
  audit({ actorType: 'human', actorId: actor, action: 'eval.run', subjectType: 'agent', subjectId: agentId, payload: { kind: set.kind, score, passed, total: set.cases.length } });
  return { agentId, kind: set.kind, score, passed, total: set.cases.length, details, costUsd: cost };
}

/**
 * Reputation factor per Part 2 §7.6: base 1.0, moved only by audited signals —
 * human gate outcomes (approvals vs rejections of this agent's runs) and the
 * latest eval/canary score. Hard-capped to [0.85, 1.15] so reputation can
 * shade a vote but never override current evidence.
 */
export function accuracyFactor(agentId) {
  const gate = one(
    `SELECT SUM(a.verdict = 'approved') AS ok, SUM(a.verdict = 'rejected') AS bad
     FROM approvals a JOIN runs r ON r.id = a.subject_id
     WHERE a.subject_type = 'run' AND r.agent_id = ?`, agentId);
  const evalRow = one('SELECT score FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 1', agentId);
  let factor = 1.0;
  const decided = (gate?.ok || 0) + (gate?.bad || 0);
  if (decided > 0) factor += 0.08 * ((gate.ok - gate.bad) / decided);
  if (evalRow) factor += 0.10 * (evalRow.score - 0.8);
  factor = Math.max(0.85, Math.min(1.15, factor));
  return {
    factor: Number(factor.toFixed(3)),
    signals: { gateApproved: gate?.ok || 0, gateRejected: gate?.bad || 0, lastEvalScore: evalRow?.score ?? null },
  };
}
