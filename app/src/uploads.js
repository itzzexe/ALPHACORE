// Files people hand the company — a scanned invoice, a meeting recording, a
// document a customer uploads through the portal.
//
// The bytes go to disk under data/uploads with a name the company chose, never
// the one the sender typed, and are checked against what each purpose may
// accept: a recording is not an image, and nothing here is ever served back as
// HTML. The index row carries the SHA-256, so the file read later is provably
// the file received.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './env.js';
import { one, exec } from './db.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

export const uploadsDir = () => path.resolve(process.env.ALPHACORE_UPLOADS_DIR || path.join(ROOT, 'data', 'uploads'));

// What each purpose may receive, recognised by the file's own first bytes as
// well as by what the sender said it was.
const KINDS = {
  'application/pdf': { ext: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
  'audio/mpeg': { ext: 'mp3', magic: [[0x49, 0x44, 0x33], [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]] },
  'audio/wav': { ext: 'wav', magic: [[0x52, 0x49, 0x46, 0x46]] },
  'audio/ogg': { ext: 'ogg', magic: [[0x4f, 0x67, 0x67, 0x53]] },
  'audio/mp4': { ext: 'm4a', magic: [] },
  'audio/webm': { ext: 'webm', magic: [[0x1a, 0x45, 0xdf, 0xa3]] },
};
export const PURPOSES = {
  intake: { mimes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'], maxBytes: 15e6 },
  meeting: { mimes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'], maxBytes: 60e6 },
  portal: { mimes: ['application/pdf', 'image/png', 'image/jpeg'], maxBytes: 10e6 },
};

const startsWith = (buf, sig) => sig.every((b, i) => buf[i] === b);

/** Save a base64 upload for a purpose; returns its index row. */
export function saveUpload({ purpose, name, mime, data, actor }) {
  const spec = PURPOSES[purpose];
  if (!spec) refuse(`no such upload purpose: ${purpose}`);
  if (!actor) refuse('an upload carries who sent it');
  const m = String(mime || '').toLowerCase();
  if (!spec.mimes.includes(m)) refuse(`this takes ${spec.mimes.join(', ')}`);
  const buf = Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) refuse('the file is empty');
  if (buf.length > spec.maxBytes) refuse(`the file is larger than ${Math.round(spec.maxBytes / 1e6)} MB`);
  const kind = KINDS[m];
  if (kind.magic.length && !kind.magic.some((sig) => startsWith(buf, sig))) refuse('the file is not what its type says it is');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const dir = path.join(uploadsDir(), purpose);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${sha256.slice(0, 12)}.${kind.ext}`);
  fs.writeFileSync(file, buf);
  const r = exec('INSERT INTO uploads (purpose, name, mime, bytes, sha256, path, created_by) VALUES (?,?,?,?,?,?,?)',
    purpose, String(name || 'file').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 120) || 'file', m, buf.length, sha256, file, String(actor));
  return one('SELECT * FROM uploads WHERE id = ?', Number(r.lastInsertRowid));
}

export function getUpload(id) {
  const u = one('SELECT * FROM uploads WHERE id = ?', Number(id));
  if (!u) refuse('no such file', 404);
  return u;
}

/** The bytes, checked against the fingerprint taken when they arrived. */
export function readUpload(id) {
  const u = getUpload(id);
  const buf = fs.readFileSync(u.path);
  if (createHash('sha256').update(buf).digest('hex') !== u.sha256) refuse('the stored file no longer matches what was received', 409);
  return { ...u, buf };
}
