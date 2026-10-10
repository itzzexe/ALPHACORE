// Hash-chained append-only audit log (ADR-006). Every entry's hash covers the
// previous entry's hash plus the canonical serialization of this entry, so any
// tampering — including via direct DB edits that bypass the triggers — is
// detectable by recomputing the chain.
import { createHash } from 'node:crypto';
import { db, one, exec } from './db.js';

const GENESIS = 'crucible-genesis';

function canon(obj) {
  // Deterministic serialization: sorted keys, no whitespace variance.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
}

export function audit({ actorType, actorId, action, subjectType = null, subjectId = null, payload = null }) {
  // Normalize BEFORE hashing so the stored row and the recomputed body are
  // byte-identical: ids become strings (SQLite TEXT affinity would otherwise
  // turn a numeric 1 into '1.0'), and payload goes through a JSON round-trip
  // (dropping undefined the same way storage does).
  subjectId = subjectId === null || subjectId === undefined ? null : String(subjectId);
  actorId = String(actorId);
  payload = payload === null || payload === undefined ? null : JSON.parse(JSON.stringify(payload));
  const prev = one('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  const prevHash = prev ? prev.hash : GENESIS;
  const body = canon({ actorType, actorId, action, subjectType, subjectId, payload });
  const hash = createHash('sha256').update(prevHash + '|' + body).digest('hex');
  exec(
    `INSERT INTO audit_log (actor_type, actor_id, action, subject_type, subject_id, payload, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    actorType, actorId, action, subjectType, subjectId, payload ? JSON.stringify(payload) : null, prevHash, hash,
  );
  return hash;
}

/** Walk rows forward from a known hash; the first that does not follow is where it broke. */
function walkFrom(rows, prevHash) {
  for (const r of rows) {
    const body = canon({
      actorType: r.actor_type, actorId: r.actor_id, action: r.action,
      subjectType: r.subject_type, subjectId: r.subject_id,
      payload: r.payload ? JSON.parse(r.payload) : null,
    });
    const expect = createHash('sha256').update(prevHash + '|' + body).digest('hex');
    if (r.prev_hash !== prevHash || r.hash !== expect) return { brokenAt: r.seq, prevHash };
    prevHash = r.hash;
  }
  return { brokenAt: null, prevHash };
}

// What has already been proved, so the next question only costs what is new.
let proved = { seq: 0, hash: GENESIS, count: 0, fullAt: null };

/** Recompute the whole chain; returns {ok, checked, brokenAt}. */
export function verifyChain() {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
  const w = walkFrom(rows, GENESIS);
  if (w.brokenAt !== null) {
    proved = { seq: 0, hash: GENESIS, count: 0, fullAt: null };
    return { ok: false, checked: rows.length, brokenAt: w.brokenAt };
  }
  const tip = rows.at(-1);
  proved = { seq: tip?.seq || 0, hash: tip?.hash || GENESIS, count: rows.length, fullAt: new Date().toISOString() };
  return { ok: true, checked: rows.length, brokenAt: null };
}

/**
 * The same answer for the badge on every page, at the cost of what was added
 * since it was last asked.
 *
 * Recomputing seventy-six thousand hashes took two seconds of a blocked event
 * loop, and every open console asked every seven seconds — the record was
 * busy proving itself instead of answering anybody. So the proof is kept: rows
 * already verified are not walked again, and the tip that was proved is
 * re-read each time. A rewrite that recomputes the chain changes that tip, and
 * this falls back to the full walk at once. An edit deep in the chain that
 * leaves the tip alone breaks a link the next full walk finds — which runs on
 * a clock, and whenever somebody opens the audit page.
 */
export function verifyChainFast() {
  if (proved.seq) {
    const tip = one('SELECT hash FROM audit_log WHERE seq = ?', proved.seq);
    if (!tip || tip.hash !== proved.hash) return verifyChain();
  } else return verifyChain();
  const rows = db.prepare('SELECT * FROM audit_log WHERE seq > ? ORDER BY seq ASC').all(proved.seq);
  const w = walkFrom(rows, proved.hash);
  if (w.brokenAt !== null) return verifyChain();
  if (rows.length) proved = { ...proved, seq: rows.at(-1).seq, hash: rows.at(-1).hash, count: proved.count + rows.length };
  return { ok: true, checked: proved.count, brokenAt: null, incremental: true, lastFullAt: proved.fullAt };
}
