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
import { q, one, exec, db, atomically } from './db.js';
import { masterKey, keyId, proposeKey, installKey, keySource, KEY_FILE } from './masterkey.js';

/** Thrown when a ciphertext names a key that is not the one loaded. */
export class VaultKeyMismatch extends Error {}
import { audit } from './audit.js';

/**
 * Sealing and opening are exported so other things can be wrapped under the
 * same master key. A second key file would be a second thing to back up, a
 * second thing to rotate, and a second thing to lose.
 *
 * Sealed values carry the fingerprint of the key that sealed them:
 *
 *   k1:<key id>:<base64 iv‖tag‖ciphertext>
 *
 * Values written before this existed have no prefix and are read with whatever
 * key is current, which is correct: there was only ever one. The fingerprint
 * turns "sealed under a key you no longer have" into its own error instead of
 * a generic decryption failure — two problems whose answers have nothing in
 * common, and which used to look identical.
 */
export function seal(plain, key = masterKey()) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `k1:${keyId(key)}:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
}

export function open(ciphertext, key = masterKey()) {
  let blob = String(ciphertext);
  if (blob.startsWith('k1:')) {
    const [, id, rest] = blob.split(':');
    if (id !== keyId(key)) {
      throw new VaultKeyMismatch(
        `this was sealed under key ${id}, and the key in use is ${keyId(key)} — `
        + 'restore the retired key file, or re-seal from a backup taken under it',
      );
    }
    blob = rest;
  }
  const buf = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
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

// ---------------------------------------------------------------- rotation --

/**
 * Everything in this database that is sealed under the master key.
 *
 * Two places, and both must move together or the rotation is worse than
 * useless: the vault's own secrets, and every person's crypto-shredding key.
 * Missing the second would leave every subject key unreadable — which is to
 * say it would erase everybody, silently, as a side effect of a security
 * improvement.
 */
function sealedEverywhere() {
  const items = [];
  for (const r of q('SELECT name, ciphertext FROM vault_secrets')) {
    items.push({ table: 'vault_secrets', key: r.name, column: 'ciphertext', value: r.ciphertext });
  }
  try {
    for (const r of q('SELECT ref, wrapped_key FROM pii_subjects WHERE wrapped_key IS NOT NULL')) {
      items.push({ table: 'pii_subjects', key: r.ref, column: 'wrapped_key', value: r.wrapped_key });
    }
  } catch { /* older database, before crypto-shredding */ }
  return items;
}

/**
 * Re-seal everything under a new master key.
 *
 * The order is the entire safety argument, so it is written out rather than
 * left to be inferred:
 *
 *   1. read and decrypt everything under the CURRENT key, in memory
 *   2. re-seal it all under the NEW key, in one transaction
 *   3. read every re-sealed value back with the new key and compare it to what
 *      was there before
 *   4. only if all of that held, install the new key file
 *
 * Any failure before step 4 rolls the transaction back and leaves the old key
 * exactly where it was. A rotation that installs the key first and fails
 * halfway is indistinguishable from destroying the vault, and that is the
 * usual way this goes wrong.
 */
export function rotateMasterKey({ actor, dryRun = false } = {}) {
  if (!actor) throw new Error('rotating the master key is a human act and has to be signed');

  const oldKey = masterKey();
  const items = sealedEverywhere();

  // Step 1. If anything cannot be read now, stop: re-sealing what you cannot
  // read is how a rotation turns a recoverable problem into a permanent one.
  const plain = new Map();
  const unreadable = [];
  for (const it of items) {
    try { plain.set(`${it.table}:${it.key}`, open(it.value, oldKey)); }
    catch (e) { unreadable.push({ ...it, error: e.message }); }
  }
  if (unreadable.length) {
    return {
      ok: false,
      reason: `${unreadable.length} sealed value(s) cannot be read with the current key — rotating would make that permanent`,
      unreadable: unreadable.map((u) => `${u.table}.${u.key}`),
    };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, wouldReseal: items.length, from: keyId(oldKey) };
  }

  const proposed = proposeKey();

  // Steps 2 and 3, inside one transaction. The abort record is written after
  // the rollback rather than inside it — written inside, the account of what
  // went wrong would be rolled back along with the thing that went wrong.
  try {
    atomically(() => {
      for (const it of items) {
        const text = plain.get(`${it.table}:${it.key}`);
        const resealed = seal(text, proposed.key);
        const idCol = it.table === 'vault_secrets' ? 'name' : 'ref';
        exec(`UPDATE ${it.table} SET ${it.column} = ? WHERE ${idCol} = ?`, resealed, it.key);
      }

      for (const it of items) {
        const idCol = it.table === 'vault_secrets' ? 'name' : 'ref';
        const stored = one(`SELECT ${it.column} AS v FROM ${it.table} WHERE ${idCol} = ?`, it.key).v;
        const back = open(stored, proposed.key);
        if (back !== plain.get(`${it.table}:${it.key}`)) {
          throw new Error(`${it.table}.${it.key} did not survive re-sealing`);
        }
      }
    });
  } catch (e) {
    audit({
      actorType: 'human', actorId: actor, action: 'vault.rotation_aborted',
      subjectType: 'system', subjectId: 'master-key',
      payload: { error: String(e.message).slice(0, 200), items: items.length },
    });
    return { ok: false, reason: `rolled back: ${e.message}`, nothingChanged: true };
  }

  // Step 4. Everything is re-sealed and read back; now the key can move.
  let installed;
  try {
    installed = installKey(proposed.raw);
  } catch (e) {
    // The database is now under a key that is not installed. Say exactly that,
    // and exactly how to fix it, rather than leaving somebody to discover it
    // at the next restart.
    return {
      ok: false,
      reason: `everything was re-sealed but the new key could not be installed: ${e.message}`,
      urgent: `the database now expects key ${proposed.id}. Put this material where the key comes from, or restore a backup taken before this ran.`,
      material: proposed.raw.toString('base64'),
    };
  }

  audit({
    actorType: 'human', actorId: actor, action: 'vault.key_rotated',
    subjectType: 'system', subjectId: 'master-key',
    payload: { from: keyId(oldKey), to: proposed.id, resealed: items.length, retiredFile: installed.retiredFile },
  });

  return {
    ok: true,
    from: keyId(oldKey),
    to: proposed.id,
    resealed: items.length,
    retiredFile: installed.retiredFile,
    note: 'The retired key file is kept. A backup taken before now is still sealed under it, and deleting it makes that backup unreadable.',
  };
}

/** Where the key comes from, and whether everything can still be read. */
export function keyHealth() {
  const src = keySource();
  const items = sealedEverywhere();
  let readable = 0;
  const failing = [];
  for (const it of items) {
    try { open(it.value); readable++; }
    catch (e) { failing.push({ where: `${it.table}.${it.key}`, error: e.message.slice(0, 120) }); }
  }
  return {
    ...src,
    sealedValues: items.length,
    readable,
    failing,
    // A rotation is only meaningful if it can be undone by restoring a backup,
    // and that needs the retired keys.
    retiredKeys: (() => {
      try {
        return fs.readdirSync(path.dirname(KEY_FILE))
          .filter((f) => f.startsWith('master.key.retired-'))
          .sort().reverse();
      } catch { return []; }
    })(),
  };
}
