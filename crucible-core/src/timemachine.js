// The time machine — standing at any hour of the company's life.
//
// The audit chain is hash-linked and append-only, which has always meant "you
// cannot change the past". This module uses the other half of that property:
// because every consequential act was written in order, the past can be *read*
// in order. Take a mark, look at what the company knew then, replay the moves
// between two marks, and re-open a decision with what is known now.
//
// Nothing here rewrites anything. Reconstruction is a read; a decision reopened
// becomes a new decision that cites the old one.
import { q, one, exec } from './db.js';
import { audit, verifyChain } from './audit.js';

const COUNTED = ['runs', 'decisions', 'customers', 'deals', 'artifacts', 'requests', 'workstreams', 'egress_log', 'provenance'];

function counts() {
  const out = {};
  for (const t of COUNTED) {
    try { out[t] = one(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { out[t] = null; }
  }
  return out;
}

/** Put a named mark on the chain. */
export function takeSnapshot({ label, actor = 'human:admin' }) {
  const tip = one('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  if (!tip) throw new Error('the chain is empty — there is nothing to mark yet');
  const r = exec(
    'INSERT INTO snapshots (label, seq, chain_hash, counts, taken_by) VALUES (?,?,?,?,?)',
    label, tip.seq, tip.hash, JSON.stringify(counts()), actor,
  );
  audit({ actorType: 'human', actorId: actor, action: 'snapshot.taken', subjectType: 'snapshot', subjectId: Number(r.lastInsertRowid), payload: { label, seq: tip.seq } });
  return one('SELECT * FROM snapshots WHERE id = ?', Number(r.lastInsertRowid));
}

/**
 * What the company looked like at a point on the chain: not a guess, but the
 * entries up to that sequence number, grouped so the shape is readable.
 */
export function standAt(seq) {
  const at = one('SELECT * FROM audit_log WHERE seq <= ? ORDER BY seq DESC LIMIT 1', seq);
  if (!at) throw new Error('nothing on the chain that early');
  const upto = at.seq;
  return {
    seq: upto,
    at: at.occurred_at,
    hash: at.hash,
    actions: q('SELECT action, COUNT(*) AS n FROM audit_log WHERE seq <= ? GROUP BY action ORDER BY n DESC LIMIT 20', upto),
    actors: q('SELECT actor_type, actor_id, COUNT(*) AS n FROM audit_log WHERE seq <= ? GROUP BY actor_type, actor_id ORDER BY n DESC LIMIT 12', upto),
    lastEntries: q('SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id FROM audit_log WHERE seq <= ? ORDER BY seq DESC LIMIT 25', upto),
    // Decisions as they stood: the ruling that had been made by then, if any.
    decisions: q(`SELECT subject_id AS decision, MAX(seq) AS seq, MAX(action) AS last_action
                  FROM audit_log WHERE seq <= ? AND subject_type = 'decision' GROUP BY subject_id ORDER BY seq DESC LIMIT 15`, upto),
    money: one("SELECT COALESCE(SUM(cost_usd),0) AS spent FROM model_calls WHERE created_at <= (SELECT occurred_at FROM audit_log WHERE seq = ?)", upto),
  };
}

/** Everything that happened between two marks, in order. */
export function replay(fromSeq, toSeq, { limit = 500 } = {}) {
  const rows = q(
    `SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id, payload
     FROM audit_log WHERE seq > ? AND seq <= ? ORDER BY seq ASC LIMIT ?`,
    fromSeq, toSeq, limit,
  );
  const byActor = {};
  const byAction = {};
  for (const r of rows) {
    byActor[r.actor_id] = (byActor[r.actor_id] || 0) + 1;
    byAction[r.action] = (byAction[r.action] || 0) + 1;
  }
  return {
    from: fromSeq, to: toSeq, moves: rows.length,
    span: rows.length ? { start: rows[0].occurred_at, end: rows[rows.length - 1].occurred_at } : null,
    byActor: Object.entries(byActor).sort((a, b) => b[1] - a[1]).slice(0, 12),
    byAction: Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 15),
    entries: rows.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null })),
  };
}

/**
 * Re-litigate. The old decision is left exactly as it was — a decision you can
 * edit afterwards is not a record — and a new one is opened that cites it.
 */
export function reopenDecision({ decisionId, why, actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person reopens a decision');
  const old = one('SELECT * FROM decisions WHERE id = ?', decisionId);
  if (!old) throw new Error('no such decision');
  const year = new Date().getFullYear();
  const n = one("SELECT COUNT(*) AS c FROM decisions WHERE id LIKE ?", `DR-${year}-%`).c + 1;
  const id = `DR-${year}-${String(n).padStart(3, '0')}`;
  exec(
    `INSERT INTO decisions (id, title, tier, status, owner_human, context)
     VALUES (?,?,?,'open',?,?)`,
    id, `Reopened: ${old.title}`, old.tier, actor,
    `Reopening ${decisionId} (decided ${old.decided_at || 'never'}).\nWhy now: ${why}\n\nOriginal context:\n${old.context || ''}`,
  );
  const trail = q("SELECT seq, occurred_at, action, payload FROM audit_log WHERE subject_type = 'decision' AND subject_id = ? ORDER BY seq", decisionId);
  exec(
    'INSERT INTO decision_evidence (decision_id, claim, source_ref, verification, added_by) VALUES (?,?,?,?,?)',
    id, `The original decision moved through ${trail.length} recorded steps`, `audit:${decisionId}`, 'verified', actor,
  );
  audit({ actorType: 'human', actorId: actor, action: 'decision.reopened', subjectType: 'decision', subjectId: id, payload: { original: decisionId, why } });
  return { id, original: decisionId, trail: trail.length };
}

export function timeMachineOverview() {
  const tip = one('SELECT seq, hash, occurred_at FROM audit_log ORDER BY seq DESC LIMIT 1');
  const first = one('SELECT seq, occurred_at FROM audit_log ORDER BY seq ASC LIMIT 1');
  return {
    chain: { ...verifyChain(), tip: tip?.seq || 0, tipHash: tip?.hash || null, since: first?.occurred_at || null, until: tip?.occurred_at || null },
    snapshots: q('SELECT * FROM snapshots ORDER BY seq DESC LIMIT 30').map((s) => ({ ...s, counts: JSON.parse(s.counts || '{}') })),
    days: q(`SELECT date(occurred_at) AS day, COUNT(*) AS moves, COUNT(DISTINCT actor_id) AS actors
             FROM audit_log GROUP BY day ORDER BY day DESC LIMIT 30`),
    busiest: q(`SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC LIMIT 12`),
  };
}
