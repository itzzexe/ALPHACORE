// Decision Registry — every material decision with evidence, provenance,
// expiry, and human ownership. The unverified→verified transition is
// human-only (Part 3 §4.1 note 2); expiry triggers reopen decisions.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { openPii } from './erasure.js';

export function nextDecisionId() {
  const year = new Date().getFullYear();
  const row = one(
    "SELECT COUNT(*) AS n FROM decisions WHERE id LIKE ?", `DR-${year}-%`,
  );
  return `DR-${year}-${String((row?.n || 0) + 1).padStart(3, '0')}`;
}

export function createDecision({ title, tier, owner, context = null, deadline = null, expiresAt = null, actor = 'human:admin' }) {
  const id = nextDecisionId();
  exec(
    'INSERT INTO decisions (id, title, tier, owner_human, context, deadline, expires_at) VALUES (?,?,?,?,?,?,?)',
    id, title, tier, owner, context, deadline, expiresAt,
  );
  audit({ actorType: 'human', actorId: actor, action: 'decision.created', subjectType: 'decision', subjectId: id, payload: { title, tier, owner } });
  return getDecision(id);
}

export function addEvidence(decisionId, { claim, sourceRef, expiresAt = null, addedBy = 'agent:unknown' }) {
  exec(
    'INSERT INTO decision_evidence (decision_id, claim, source_ref, expires_at, added_by) VALUES (?,?,?,?,?)',
    decisionId, claim, sourceRef, expiresAt, addedBy,
  );
  audit({ actorType: addedBy.startsWith('human') ? 'human' : 'agent', actorId: addedBy, action: 'evidence.added', subjectType: 'decision', subjectId: decisionId, payload: { claim: claim.slice(0, 120) } });
}

/** Human-only: flip evidence to verified. The API layer supplies the approver name. */
export function verifyEvidence(evidenceId, approver) {
  const row = one('SELECT * FROM decision_evidence WHERE id = ?', evidenceId);
  if (!row) throw new Error('evidence not found');
  exec("UPDATE decision_evidence SET verification = 'verified' WHERE id = ?", evidenceId);
  audit({ actorType: 'human', actorId: approver, action: 'evidence.verified', subjectType: 'decision', subjectId: row.decision_id, payload: { evidenceId } });
}

export function getDecision(id) {
  const d = one('SELECT * FROM decisions WHERE id = ?', id);
  if (!d) return null;
  return {
    ...d,
    outcome: d.outcome ? JSON.parse(d.outcome) : null,
    conditions: d.conditions ? JSON.parse(d.conditions) : null,
    dissent: d.dissent ? JSON.parse(d.dissent) : null,
    evidence: q('SELECT * FROM decision_evidence WHERE decision_id = ? ORDER BY id', id),
    rounds: q('SELECT * FROM tribunal_rounds WHERE decision_id = ? ORDER BY round, id', id)
      .map((r) => ({ ...r, output: JSON.parse(openPii(r.output)) })),
    approvals: q("SELECT * FROM approvals WHERE subject_type = 'decision' AND subject_id = ? ORDER BY id", id),
    related: {
      runs: q('SELECT id, agent_id, state, task_type, cost_usd FROM runs WHERE decision_id = ? ORDER BY created_at DESC LIMIT 20', id),
      productGates: q('SELECT id, name, gates FROM products').flatMap((p) => {
        const gates = JSON.parse(p.gates).filter((g) => g.decisionId === id);
        return gates.map((g) => ({ productId: p.id, productName: p.name, gate: g.gate, gateTitle: g.title }));
      }),
    },
  };
}

export function listDecisions() {
  return q('SELECT id, title, tier, status, owner_human, consensus_score, confidence, expires_at, decided_at, created_at FROM decisions ORDER BY created_at DESC');
}

/** Human decides (T2 approves the recommendation; T3 decides outright). */
export function decideDecision(id, { verdict, approver, note = null }) {
  const d = one('SELECT * FROM decisions WHERE id = ?', id);
  if (!d) throw new Error('decision not found');
  const status = verdict === 'approved' ? (d.status === 'recommended_cond' ? 'approved_cond' : 'approved') : 'rejected';
  exec("UPDATE decisions SET status = ?, decided_at = datetime('now') WHERE id = ?", status, id);
  exec('INSERT INTO approvals (subject_type, subject_id, gate, approver_human, verdict, note) VALUES (?,?,?,?,?,?)',
    'decision', id, `decision-${d.tier}`, approver, verdict === 'approved' ? 'approved' : 'rejected', note);
  audit({ actorType: 'human', actorId: approver, action: `decision.${verdict}`, subjectType: 'decision', subjectId: id, payload: { note } });
  return getDecision(id);
}

/** Expiry sweep: reopen approved decisions whose expiry passed; expire stale evidence. */
export function expirySweep() {
  const now = new Date().toISOString().slice(0, 10);
  const expired = q(
    "SELECT id FROM decisions WHERE status IN ('approved','approved_cond') AND expires_at IS NOT NULL AND expires_at < ?",
    now,
  );
  for (const d of expired) {
    exec("UPDATE decisions SET status = 'expired' WHERE id = ?", d.id);
    audit({ actorType: 'system', actorId: 'expiry-sweep', action: 'decision.expired', subjectType: 'decision', subjectId: d.id });
  }
  const staleEv = q(
    "SELECT id, decision_id FROM decision_evidence WHERE verification = 'verified' AND expires_at IS NOT NULL AND expires_at < ?",
    now,
  );
  for (const e of staleEv) {
    exec("UPDATE decision_evidence SET verification = 'expired' WHERE id = ?", e.id);
    audit({ actorType: 'system', actorId: 'expiry-sweep', action: 'evidence.expired', subjectType: 'decision', subjectId: e.decision_id, payload: { evidenceId: e.id } });
  }
  return { decisionsExpired: expired.length, evidenceExpired: staleEv.length };
}
