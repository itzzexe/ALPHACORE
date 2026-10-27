// Guards — the mistakes that must not happen twice, checked on every answer.
//
// A lesson in memory makes a repeat less likely; it cannot make it
// impossible, because a model can read a lesson and do the thing anyway. A
// guard is the other half: a rule checked against the output itself, after
// the model answers and before anyone downstream uses it. When one trips, the
// run stops at a person with the reason, and the guard counts the catch — so
// the page can show which mistakes are still being attempted.
//
// Deliberately small and dependency-free: the run queue imports it, and the
// run queue is imported by nearly everything.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const compiled = new Map();
function re(pattern) {
  if (!compiled.has(pattern)) {
    try { compiled.set(pattern, new RegExp(pattern, 'iu')); } catch { compiled.set(pattern, null); }
  }
  return compiled.get(pattern);
}

/** Is this pattern something a guard can use? Refused at creation, not at the first run. */
export function validPattern(pattern) {
  if (!pattern || String(pattern).length > 300) return false;
  try { new RegExp(pattern, 'iu'); return true; } catch { return false; }
}

/**
 * Check an answer. Returns the first guard it breaks, or null.
 *
 * A must_not guard trips on a match; a must guard trips on its absence. Both
 * are scoped to one employee or to everyone.
 */
export function checkGuards(agentId, text) {
  const out = String(text || '');
  for (const g of q("SELECT * FROM learn_guards WHERE state = 'active' AND (agent_id IS NULL OR agent_id = ?) ORDER BY id", agentId)) {
    const r = re(g.pattern);
    if (!r) continue;
    const hit = g.kind === 'must' ? !r.test(out) : r.test(out);
    if (!hit) continue;
    exec("UPDATE learn_guards SET hits = hits + 1, last_hit = datetime('now') WHERE id = ?", g.id);
    return g;
  }
  return null;
}

export function recordCatch(guard, runId, agentId) {
  audit({
    actorType: 'system', actorId: 'system:guards', action: 'learning.guard_tripped',
    subjectType: 'run', subjectId: runId, payload: { guard: guard.id, agentId, why: guard.why },
  });
}

export const guardCount = () => one("SELECT COUNT(*) AS n FROM learn_guards WHERE state = 'active'").n;
