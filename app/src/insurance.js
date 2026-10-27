// Insurance — what the company is covered for, until when, and the claims
// against it.
//
// The register is the point: a policy that lapsed unnoticed is discovered on
// the day of the fire. So renewals within sixty days are listed first, every
// policy line the company has no cover for is named, and a claim is tracked
// from the incident to the money (or the refusal).
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
export const LINES = ['property', 'liability', 'cyber', 'health', 'fleet', 'directors', 'marine', 'other'];
const CLAIM_NEXT = { open: ['submitted'], submitted: ['settled', 'rejected'], settled: [], rejected: [] };

export function addPolicy({ insurer, line, number = null, coverage = 0, premium = 0, deductible = 0, starts, ends, broker = null, actor }) {
  if (!clean(insurer, 120)) refuse('who is the insurer?');
  if (!LINES.includes(line)) refuse(`line must be one of: ${LINES.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(starts)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(ends))) refuse('dates are YYYY-MM-DD');
  if (ends <= starts) refuse('a policy ends after it starts');
  const r = exec(`INSERT INTO ins_policies (insurer, line, number, coverage, premium, deductible, starts, ends, broker, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`, clean(insurer, 120), line, clean(number, 60) || null, Number(coverage) || 0, Number(premium) || 0,
  Number(deductible) || 0, starts, ends, clean(broker, 120) || null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'insurance.policy', subjectType: 'ins_policy', subjectId: Number(r.lastInsertRowid), payload: { line, ends } });
  return one('SELECT * FROM ins_policies WHERE id = ?', Number(r.lastInsertRowid));
}

export function cancelPolicy({ id, actor }) {
  if (!isHuman(actor)) refuse('cancelling cover is a person’s act', 403);
  if (!one('SELECT id FROM ins_policies WHERE id = ?', Number(id))) refuse('no such policy', 404);
  exec("UPDATE ins_policies SET state = 'cancelled' WHERE id = ?", Number(id));
  audit({ actorType: 'human', actorId: actor, action: 'insurance.cancelled', subjectType: 'ins_policy', subjectId: Number(id) });
  return { ok: true };
}

export function fileClaim({ policyId, incidentDate, description, claimed = 0, actor }) {
  const p = one("SELECT * FROM ins_policies WHERE id = ? AND state = 'active'", Number(policyId));
  if (!p) refuse('no such active policy');
  if (incidentDate < p.starts || incidentDate > p.ends) refuse('the incident falls outside the policy period — it is not covered by this policy');
  if (!clean(description)) refuse('describe what happened');
  const r = exec('INSERT INTO ins_claims (policy_id, incident_date, description, claimed, created_by) VALUES (?,?,?,?,?)',
    p.id, incidentDate, clean(description, 2000), Number(claimed) || 0, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'insurance.claim', subjectType: 'ins_claim', subjectId: Number(r.lastInsertRowid), payload: { claimed } });
  return one('SELECT * FROM ins_claims WHERE id = ?', Number(r.lastInsertRowid));
}

export function moveClaim({ id, to, paid = null, actor }) {
  const c = one('SELECT * FROM ins_claims WHERE id = ?', Number(id));
  if (!c) refuse('no such claim', 404);
  if (!CLAIM_NEXT[c.state].includes(to)) refuse(`from ${c.state} it can go to: ${CLAIM_NEXT[c.state].join(', ') || 'nowhere'}`);
  // Submitting a claim is a statement to an insurer, so a person makes it.
  if (to === 'submitted' && !isHuman(actor)) refuse('submitting a claim is a person’s act', 403);
  if (to === 'settled' && !(Number(paid) >= 0)) refuse('a settled claim records what was paid');
  exec('UPDATE ins_claims SET state = ?, paid = COALESCE(?, paid) WHERE id = ?', to, to === 'settled' ? Number(paid) : null, c.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `insurance.claim_${to}`, subjectType: 'ins_claim', subjectId: c.id, payload: { paid } });
  return one('SELECT * FROM ins_claims WHERE id = ?', c.id);
}

/** Policies ending within sixty days, announced once each. */
export function renewalSweep() {
  for (const p of q("SELECT * FROM ins_policies WHERE state = 'active' AND ends BETWEEN date('now') AND date('now','+60 days')")) {
    notify({ level: 'warn', source: 'insurance', message: `${p.line} cover with ${p.insurer} ends on ${p.ends} — renew or replace it.`, subjectType: 'ins_policy', subjectId: p.id });
  }
}

export function overview() {
  const today = new Date().toISOString().slice(0, 10);
  const policies = q('SELECT * FROM ins_policies ORDER BY ends').map((p) => ({ ...p, status: p.state === 'cancelled' ? 'cancelled' : p.ends < today ? 'expired' : p.starts > today ? 'future' : 'in force' }));
  const inForce = policies.filter((p) => p.status === 'in force');
  return {
    policies,
    renewals: inForce.filter((p) => p.ends <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)),
    uncovered: LINES.filter((l) => l !== 'other' && !inForce.some((p) => p.line === l)),
    premiums: inForce.reduce((a, p) => a + p.premium, 0),
    claims: q('SELECT c.*, p.insurer, p.line FROM ins_claims c JOIN ins_policies p ON p.id = c.policy_id ORDER BY c.id DESC LIMIT 40'),
  };
}
