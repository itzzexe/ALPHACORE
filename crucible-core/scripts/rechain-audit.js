// One-time maintenance: re-link the audit hash chain after the subject-id
// normalization defect (numeric ids stored as '1.0' broke recomputation).
// Row CONTENT is never touched — only prev_hash/hash are recomputed from the
// stored (canonical) values. The operation itself is appended to the log as
// `audit.rechained`, so the repair is on the record like everything else.
// Run with the server STOPPED.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(path.join(root, 'data', 'crucible.db'));

const canon = (o) => {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
};

db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
let prevHash = 'crucible-genesis';
let fixed = 0;
const upd = db.prepare('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE seq = ?');
for (const r of rows) {
  const body = canon({
    actorType: r.actor_type, actorId: r.actor_id, action: r.action,
    subjectType: r.subject_type, subjectId: r.subject_id,
    payload: r.payload ? JSON.parse(r.payload) : null,
  });
  const hash = createHash('sha256').update(prevHash + '|' + body).digest('hex');
  if (r.prev_hash !== prevHash || r.hash !== hash) { upd.run(prevHash, hash, r.seq); fixed += 1; }
  prevHash = hash;
}
db.exec(`
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`);

// Append the maintenance record through the normal chain rules.
const body = canon({
  actorType: 'human', actorId: 'human:founder', action: 'audit.rechained',
  subjectType: 'audit', subjectId: 'chain',
  payload: { reason: 'subject-id normalization defect (numeric → TEXT affinity)', relinked: fixed, rows: rows.length },
});
const hash = createHash('sha256').update(prevHash + '|' + body).digest('hex');
db.prepare(`INSERT INTO audit_log (actor_type, actor_id, action, subject_type, subject_id, payload, prev_hash, hash)
            VALUES ('human','human:founder','audit.rechained','audit','chain',?,?,?)`)
  .run(JSON.stringify({ reason: 'subject-id normalization defect (numeric → TEXT affinity)', relinked: fixed, rows: rows.length }), prevHash, hash);

console.log(`Re-linked ${fixed} of ${rows.length} entries; maintenance record appended.`);
