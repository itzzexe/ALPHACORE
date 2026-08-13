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

/** Recompute the whole chain; returns {ok, checked, brokenAt}. */
export function verifyChain() {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
  let prevHash = GENESIS;
  for (const r of rows) {
    const body = canon({
      actorType: r.actor_type, actorId: r.actor_id, action: r.action,
      subjectType: r.subject_type, subjectId: r.subject_id,
      payload: r.payload ? JSON.parse(r.payload) : null,
    });
    const expect = createHash('sha256').update(prevHash + '|' + body).digest('hex');
    if (r.prev_hash !== prevHash || r.hash !== expect) {
      return { ok: false, checked: rows.length, brokenAt: r.seq };
    }
    prevHash = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}
