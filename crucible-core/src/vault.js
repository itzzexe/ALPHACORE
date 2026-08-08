// The vault — every credential the company holds, encrypted at rest.
//
// Before this existed, keys sat in the settings table as plaintext. Now they
// are sealed with AES-256-GCM under a master key that lives in one file outside
// the database, so a copied .db is not a copied set of keys. The plaintext is
// returned to exactly one kind of caller — a connector making a call — and it
// never enters an audit payload, an API response, or a log line. What the rest
// of the system can see is the last four characters and when it was last used.
//
// Honest limit: on a single machine the master key and the database sit on the
// same disk, so this raises the cost of theft rather than making it impossible.
// A multi-host deployment moves the key to a real KMS; the interface below does
// not change when it does.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const KEY_FILE = path.join(ROOT, 'data', 'master.key');

/** The master key, made once and kept out of the database. */
function masterKey() {
  if (!fs.existsSync(KEY_FILE)) {
    const salt = randomBytes(16);
    const material = randomBytes(32);
    fs.writeFileSync(KEY_FILE, Buffer.concat([salt, material]).toString('base64'), { mode: 0o600 });
  }
  const raw = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  return scryptSync(raw.subarray(16), raw.subarray(0, 16), 32);
}

function seal(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

function open(ciphertext) {
  const buf = Buffer.from(ciphertext, 'base64');
  const d = createDecipheriv('aes-256-gcm', masterKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Store a secret. Returns only the safe view of it. */
export function putSecret(name, value, { kind = 'api_key', connector = null, note = null, expiresAt = null, actor = 'human:admin' } = {}) {
  if (!name) throw new Error('a secret needs a name');
  if (!value) throw new Error('a secret needs a value');
  const existed = Boolean(one('SELECT name FROM vault_secrets WHERE name = ?', name));
  exec(
    `INSERT INTO vault_secrets (name, ciphertext, kind, connector, note, tail, expires_at, rotated_at)
     VALUES (?,?,?,?,?,?,?, CASE WHEN ? THEN datetime('now') ELSE NULL END)
     ON CONFLICT(name) DO UPDATE SET
       ciphertext = excluded.ciphertext, kind = excluded.kind, connector = excluded.connector,
       note = COALESCE(excluded.note, vault_secrets.note), tail = excluded.tail,
       expires_at = excluded.expires_at, rotated_at = datetime('now')`,
    name, seal(value), kind, connector, note, String(value).slice(-4), expiresAt, existed ? 1 : 0,
  );
  // The name and the tail are recorded; the value is not, and never will be.
  audit({
    actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor,
    action: existed ? 'vault.rotated' : 'vault.stored',
    subjectType: 'secret', subjectId: name, payload: { kind, connector, tail: String(value).slice(-4) },
  });
  return safe(name);
}

/** The plaintext. Only connectors and the router call this. */
export function getSecret(name) {
  const row = one('SELECT ciphertext, expires_at FROM vault_secrets WHERE name = ?', name);
  if (!row) return process.env[name] || null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  try {
    exec("UPDATE vault_secrets SET last_used = datetime('now') WHERE name = ?", name);
    return open(row.ciphertext);
  } catch {
    return null; // wrong master key — better to look absent than to throw everywhere
  }
}

export function hasSecret(name) {
  return Boolean(getSecret(name));
}

export function dropSecret(name, { actor = 'human:admin' } = {}) {
  exec('DELETE FROM vault_secrets WHERE name = ?', name);
  audit({ actorType: 'human', actorId: actor, action: 'vault.deleted', subjectType: 'secret', subjectId: name });
  return { ok: true };
}

/** What a page is allowed to see about a secret. */
function safe(name) {
  const r = one('SELECT name, kind, connector, note, tail, expires_at, last_used, rotated_at, created_at FROM vault_secrets WHERE name = ?', name);
  return r ? { ...r, expired: Boolean(r.expires_at && r.expires_at < new Date().toISOString()) } : null;
}

export function listSecrets() {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 14 * 864e5).toISOString();
  const rows = q('SELECT name, kind, connector, note, tail, expires_at, last_used, rotated_at, created_at FROM vault_secrets ORDER BY connector, name')
    .map((r) => ({ ...r, expired: Boolean(r.expires_at && r.expires_at < now), expiringSoon: Boolean(r.expires_at && r.expires_at >= now && r.expires_at < soon) }));
  return {
    secrets: rows,
    counts: {
      total: rows.length,
      expired: rows.filter((r) => r.expired).length,
      expiringSoon: rows.filter((r) => r.expiringSoon).length,
      stale: rows.filter((r) => !r.last_used).length,
    },
    keyFile: fs.existsSync(KEY_FILE),
  };
}

/** Secrets nobody has touched in 90 days are a liability, not an asset. */
export function vaultSweep() {
  const stale = q("SELECT name FROM vault_secrets WHERE last_used IS NOT NULL AND last_used < datetime('now','-90 days')");
  for (const s of stale) {
    audit({ actorType: 'system', actorId: 'system:vault', action: 'vault.stale', subjectType: 'secret', subjectId: s.name });
  }
  return stale.length;
}
