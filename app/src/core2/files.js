// Files — الملفات.
//
// Core 2 could hold a doctor's note as sealed text and had nowhere to put the
// scan of it. NEXT.md deferred attachments for a reason worth keeping in view:
//
//   > a file path in a sealed column is a pointer to unsealed bytes
//
// That is the whole problem. Sealing the *path* protects nothing — the bytes
// sit on disk in the clear, they survive an erasure that was supposed to
// destroy them, and every backup carries a copy. So the bytes are sealed, not
// the path, under the same per-subject key as everything else about that
// person. Destroying the key destroys the file, which is the only definition of
// erasure this system accepts.
//
// The crypto is not new. The bytes are base64'd and handed to `sealPii`, the
// same audited path that seals a salary — a third more storage in exchange for
// no second implementation of AES-GCM to get wrong and no second thing to audit.
//
// Three refusals worth naming, because each is a way this feature could quietly
// become the hole in the building:
//
//   - **an executable is not an attachment.** Checked by extension *and* by the
//     first bytes, because a renamed .exe is the oldest trick there is.
//   - **a file that failed to seal is not stored.** `sealPii` returns the value
//     untouched when there is no subject key, which would write plaintext to
//     disk while every page reports it as sealed. Asserted, not assumed.
//   - **nothing is served from a path the caller chose.** Files are read by id
//     through this module; the stored name is a label, never a location.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { sealPii, openPii, isSealed, refFor } from '../erasure.js';
import { ROOT } from '../env.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/** Where the sealed blobs live. Outside the database: a 40MB row is a mistake. */
const STORE = path.join(ROOT, 'data', 'files');

const MAX_BYTES = 25 * 1024 * 1024;

// Extensions that are programs, however they are labelled. Not a security
// boundary on its own — see the magic check below — but it catches the honest
// mistake before the dishonest one.
const FORBIDDEN_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'psm1',
  'sh', 'bash', 'zsh', 'js', 'mjs', 'cjs', 'jar', 'app', 'apk', 'deb', 'rpm',
  'vbs', 'wsf', 'hta', 'reg', 'lnk',
]);

/**
 * What the first bytes say it is, regardless of what the name says.
 *
 * A file called `payslip.pdf` that begins `MZ` is a Windows executable, and the
 * only reason to rename it is to get it past a check that only reads names.
 */
function looksExecutable(bytes) {
  if (bytes.length < 4) return false;
  const b = bytes;
  if (b[0] === 0x4d && b[1] === 0x5a) return 'a Windows executable (MZ)';
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'a Linux executable (ELF)';
  if (b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe) return 'a Mach-O or Java class';
  if (b[0] === 0xfe && b[1] === 0xed && b[2] === 0xfa) return 'a macOS executable (Mach-O)';
  if (b.slice(0, 2).toString('utf8') === '#!') return 'a script with a shebang';
  return false;
}

/** What a file may be attached to. A closed list: an attachment to nothing is litter. */
export const ATTACH = {
  document: { table: 'doc_document', label: 'a document' },
  person: { table: 'hr_person', label: 'a person' },
  employee: { table: 'hr_employee', label: 'an employee' },
  meeting: { table: 'mtg_meeting', label: 'a meeting' },
  expense: { table: 'fin_expense', label: 'an expense' },
  procurement: { table: 'proc_request', label: 'a purchase request' },
};

/**
 * Store a file, sealed.
 *
 * `subjectKind`/`subjectId` say whose data this is, which decides which key
 * seals it and therefore whose erasure destroys it. A file about nobody in
 * particular — a signed supplier contract — seals under the company itself, so
 * it is still encrypted at rest and simply outlives any individual erasure.
 */
export function storeFile({
  bytes, filename, mime = null,
  subjectKind = 'company', subjectId = 'company',
  attachType = null, attachId = null,
  note = null, actor,
}) {
  if (!actor) refuse('storing a file has to be signed');
  if (!filename || !String(filename).trim()) refuse('a file needs a name');
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '', 'base64');
  if (!buf.length) refuse('that file is empty');
  if (buf.length > MAX_BYTES) refuse(`that file is ${(buf.length / 1048576).toFixed(1)}MB; the limit is ${MAX_BYTES / 1048576}MB`);

  const clean = path.basename(String(filename)).replace(/[\x00-\x1f]/g, '').slice(0, 200);
  const ext = (clean.split('.').pop() || '').toLowerCase();
  if (FORBIDDEN_EXT.has(ext)) refuse(`a .${ext} is a program, not an attachment`);
  const exe = looksExecutable(buf);
  if (exe) refuse(`that file is ${exe}, whatever it is called`);

  if (attachType && !ATTACH[attachType]) refuse(`a file attaches to one of: ${Object.keys(ATTACH).join(', ')}`);
  if (attachType && !attachId) refuse(`say which ${ATTACH[attachType].label} this belongs to`);
  if (attachType && !one(`SELECT 1 AS x FROM ${ATTACH[attachType].table} WHERE id = ?`, attachId)) {
    refuse(`there is no ${ATTACH[attachType].label} with id ${attachId}`);
  }

  // The hash is of the plaintext, so two people uploading the same scan are
  // visibly the same scan even though their sealed blobs differ.
  const sha = createHash('sha256').update(buf).digest('hex');

  const sealed = sealPii(buf.toString('base64'), { kind: subjectKind, identifier: String(subjectId) });
  // sealPii returns the value untouched when it cannot mint a key. Storing that
  // would put plaintext on disk while every page said "sealed", which is worse
  // than not having the feature.
  if (!isSealed(sealed)) refuse('that file could not be sealed, so it was not stored');

  fs.mkdirSync(STORE, { recursive: true });
  const stored = `${randomUUID()}.sealed`;
  fs.writeFileSync(path.join(STORE, stored), sealed, 'utf8');

  const id = Number(exec(
    `INSERT INTO doc_file (filename, mime, bytes, sha256, subject_ref, stored_as,
                           attach_type, attach_id, note, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    clean, mime, buf.length, sha, refFor(subjectKind, String(subjectId)), stored,
    attachType, attachId, note, actor,
  ).lastInsertRowid);

  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'file.stored',
    subjectType: 'file', subjectId: String(id),
    // The name and the hash, never the contents.
    payload: { filename: clean, bytes: buf.length, sha256: sha, attachType, attachId, subjectKind },
  });
  return { ok: true, id, filename: clean, bytes: buf.length, sha256: sha, sealed: true };
}

/**
 * Read one back.
 *
 * After the subject is erased the key is gone and this says so rather than
 * throwing: a page that explodes because somebody exercised a legal right is a
 * page that gets "fixed" by removing the erasure.
 */
export function readFile(id, { actor }) {
  if (!actor) refuse('reading a file has to be signed — it is somebody\'s data');
  const f = one('SELECT * FROM doc_file WHERE id = ?', id);
  if (!f) { const e = new Error('no such file'); e.status = 404; throw e; }

  const full = path.join(STORE, f.stored_as);
  // `bytes` on the row is the *size*; the content comes back as `content`. They
  // were the same name once, which meant an erased file returned a truthy
  // number where a caller expected a Buffer — the kind of collision that reads
  // fine and hands somebody the wrong thing.
  if (!fs.existsSync(full)) return { ...f, gone: 'the blob is missing from disk', content: null };

  const opened = openPii(fs.readFileSync(full, 'utf8'));
  if (opened === '[erased]') {
    return { ...f, erased: true, content: null, note: 'the subject was erased, so the key that opened this file no longer exists' };
  }
  const buf = Buffer.from(opened, 'base64');

  // Checked on every read, not on a schedule: a file whose bytes changed under
  // it is worth knowing about at the moment somebody relies on it.
  const sha = createHash('sha256').update(buf).digest('hex');
  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'file.read',
    subjectType: 'file', subjectId: String(id), payload: { filename: f.filename, intact: sha === f.sha256 },
  });
  return {
    ...f, content: buf, intact: sha === f.sha256,
    ...(sha === f.sha256 ? {} : { warning: 'this file does not match the hash recorded when it was stored' }),
  };
}

/** Forget one. The row stays so the gap is visible; the bytes do not. */
export function deleteFile(id, { actor, why = '' }) {
  if (!actor) refuse('deleting a file has to be signed');
  const f = one('SELECT * FROM doc_file WHERE id = ?', id);
  if (!f) { const e = new Error('no such file'); e.status = 404; throw e; }
  if (f.deleted_at) return { ok: true, alreadyGone: true };

  try { fs.rmSync(path.join(STORE, f.stored_as), { force: true }); } catch { /* already gone */ }
  exec("UPDATE doc_file SET deleted_at = datetime('now'), deleted_by = ?, delete_reason = ? WHERE id = ?", actor, why, id);
  audit({
    actorType: 'human', actorId: actor, action: 'file.deleted',
    subjectType: 'file', subjectId: String(id), payload: { filename: f.filename, why },
  });
  return { ok: true, id };
}

export function filesFor(attachType, attachId) {
  if (!ATTACH[attachType]) refuse(`unknown attachment kind: ${attachType}`);
  return q(
    `SELECT id, filename, mime, bytes, sha256, note, uploaded_by, created_at, deleted_at
       FROM doc_file WHERE attach_type = ? AND attach_id = ? AND deleted_at IS NULL ORDER BY id DESC`,
    attachType, attachId,
  );
}

/**
 * Blobs on disk that no row accounts for.
 *
 * The state that produces them is ordinary rather than sinister: a database
 * restored from an older backup than the file store, or a crash between the
 * write and the insert. They are listed and left alone — automatically deleting
 * files nobody can account for is how a restore turns into a data loss, and the
 * whole point of noticing is to let a person decide.
 */
export function orphanBlobs() {
  let names = [];
  try { names = fs.readdirSync(STORE).filter((f) => f.endsWith('.sealed')); } catch { return []; }
  const known = new Set(q('SELECT stored_as FROM doc_file').map((r) => r.stored_as));
  return names.filter((n) => !known.has(n)).map((n) => {
    let size = null;
    try { size = fs.statSync(path.join(STORE, n)).size; } catch { /* raced with a delete */ }
    return { name: n, bytes: size };
  });
}

export function filesOverview() {
  const live = one('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS b FROM doc_file WHERE deleted_at IS NULL');
  const orphans = one('SELECT COUNT(*) AS n FROM doc_file WHERE attach_type IS NULL AND deleted_at IS NULL').n;

  // Whether what is on disk matches what the table claims. A count that only
  // reads the table would report a healthy library after somebody deleted the
  // folder.
  let onDisk = 0;
  try { onDisk = fs.readdirSync(STORE).filter((f) => f.endsWith('.sealed')).length; } catch { onDisk = 0; }

  return {
    files: live.n,
    bytes: live.b,
    megabytes: Number((live.b / 1048576).toFixed(2)),
    deleted: one('SELECT COUNT(*) AS n FROM doc_file WHERE deleted_at IS NOT NULL').n,
    unattached: orphans,
    blobsOnDisk: onDisk,
    // Said out loud, because a mismatch here means either a lost file or a
    // leftover blob nobody can reach, and both are worth a person's attention.
    consistent: onDisk === live.n,
    orphans: onDisk === live.n ? 0 : orphanBlobs().length,
    limitMb: MAX_BYTES / 1048576,
    byKind: q(`SELECT attach_type AS kind, COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes
                 FROM doc_file WHERE deleted_at IS NULL GROUP BY attach_type ORDER BY n DESC`),
    recent: q(`SELECT id, filename, mime, bytes, attach_type, attach_id, uploaded_by, created_at
                 FROM doc_file WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 20`),
    refuses: [
      'the bytes are sealed under the subject\'s own key, not the path — erasing the person destroys the file',
      'an executable is refused by extension and by its first bytes, so renaming it changes nothing',
      'a file that could not be sealed is not stored at all',
      `nothing larger than ${MAX_BYTES / 1048576}MB, and nothing served from a path a caller chose`,
    ],
  };
}
