// Encrypting a backup before it leaves the machine.
//
// A backup shipped to another server or a storage bucket is the whole company
// in one file, on a disk somebody else runs. So when a passphrase is set the
// file is encrypted first — AES-256-GCM, the key stretched from the passphrase
// with scrypt — and only the encrypted copy is shipped.
//
// The passphrase is deliberately not the master key. The master key lives on
// this server, and the backup exists for the day this server is gone; the
// passphrase is something the owner also keeps somewhere else (on paper, in a
// password manager). Without it the offsite copy cannot be opened — by anyone.
//
// File layout: "ACBK1\n" · salt (16) · iv (12) · ciphertext · tag (16).
//
// Pure — files and crypto only — so scripts/decrypt-backup.mjs can run on a
// machine that has nothing of AlphaCore but this file and the backup.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const MAGIC = Buffer.from('ACBK1\n');
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const keyFor = (passphrase, salt) => scryptSync(String(passphrase), salt, 32, SCRYPT);

export async function encryptFile(src, dst, passphrase) {
  if (!passphrase || String(passphrase).length < 12) throw new Error('a backup passphrase is at least 12 characters');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  const out = fs.createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false });
  await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), (e) => (e ? reject(e) : resolve())));
  return { bytes: fs.statSync(dst).size };
}

/** The reverse, for the day it is needed. A wrong passphrase or a damaged file fails loudly at the end. */
export async function decryptFile(src, dst, passphrase) {
  const size = fs.statSync(src).size;
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(MAGIC.length + 28);
  const tag = Buffer.alloc(16);
  try {
    fs.readSync(fd, head, 0, head.length, 0);
    fs.readSync(fd, tag, 0, 16, size - 16);
  } finally { fs.closeSync(fd); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('this is not an AlphaCore encrypted backup');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(src, { start: head.length, end: size - 17 }), decipher, fs.createWriteStream(dst));
  } catch (e) {
    fs.rmSync(dst, { force: true });
    throw new Error(/auth|tag/i.test(e.message) ? 'wrong passphrase, or the file was damaged' : e.message);
  }
  return { bytes: fs.statSync(dst).size };
}
