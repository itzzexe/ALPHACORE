// API keys — the surface other software talks to.
//
// A session token belongs to a person at a keyboard: it expires in a week, it
// carries that person's whole permission set, and it is meant to be typed into
// a browser. A key belongs to a script, runs for months, and should be able to
// do exactly one thing. So keys are a separate mechanism with their own scopes,
// their own rate limit, and their own ledger.
//
// The key itself is shown once, at creation, and never again — what is stored
// is a scrypt hash and the first eight characters, which is enough to recognise
// it in a list and useless to anyone who steals the database.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { PERMS } from './auth.js';

const hash = (key) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(key, salt, 64).toString('hex')}`;
};

const matches = (key, stored) => {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const a = scryptSync(key, salt, 64);
  const b = Buffer.from(digest, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Create a key. The plaintext is returned exactly once, here. */
export function createKey({ name, scopes = [], expiresAt = null, ratePerMin = 120, tenantId = null, actor }) {
  if (!name) throw new Error('a key needs a name so you know what to revoke later');
  const clean = scopes.filter((s) => PERMS.includes(s));
  if (!clean.length) throw new Error('a key with no scopes can do nothing — name at least one permission');
  const secret = `ck_${randomBytes(24).toString('base64url')}`;
  const prefix = secret.slice(0, 11);
  exec(
    `INSERT INTO api_keys (name, prefix, hash, scopes, tenant_id, rate_per_min, expires_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    name, prefix, hash(secret), JSON.stringify(clean), tenantId, ratePerMin, expiresAt, actor,
  );
  audit({
    actorType: 'human', actorId: actor, action: 'apikey.created',
    subjectType: 'apikey', subjectId: prefix, payload: { name, scopes: clean, ratePerMin, expiresAt },
  });
  // The only time the full key exists outside the caller's hands.
  return { key: secret, prefix, name, scopes: clean, note: 'copy this now — it is not stored and cannot be shown again' };
}

/**
 * Identify a key and decide whether it may proceed. Returns a user-shaped
 * object so the rest of the API cannot tell the difference between a person and
 * a script — except that a key's permissions are only ever what it was granted.
 */
export function authenticateKey(presented) {
  if (!presented || !presented.startsWith('ck_')) return null;
  const prefix = presented.slice(0, 11);
  const row = one("SELECT * FROM api_keys WHERE prefix = ? AND state = 'active'", prefix);
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  if (!matches(presented, row.hash)) return null;

  const recent = one(
    "SELECT COUNT(*) AS n FROM api_calls WHERE key_id = ? AND created_at >= datetime('now','-1 minute')", row.id,
  ).n;
  if (recent >= row.rate_per_min) {
    return { rateLimited: true, keyId: row.id, limit: row.rate_per_min };
  }

  exec("UPDATE api_keys SET last_used = datetime('now'), calls = calls + 1 WHERE id = ?", row.id);
  return {
    id: `key:${row.id}`,
    keyId: row.id,
    username: `key:${row.name}`,
    display_name: row.name,
    role: 'api',
    perms: JSON.parse(row.scopes),
    tenantId: row.tenant_id,
    isKey: true,
  };
}

export function recordCall({ keyId, method, path, status, ms, ip = null }) {
  exec('INSERT INTO api_calls (key_id, method, path, status, ms, ip) VALUES (?,?,?,?,?,?)', keyId, method, path, status, ms, ip);
}

export function revokeKey(id, { actor }) {
  const row = one('SELECT * FROM api_keys WHERE id = ?', id);
  if (!row) throw new Error('no such key');
  exec("UPDATE api_keys SET state = 'revoked' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'apikey.revoked', subjectType: 'apikey', subjectId: row.prefix, payload: { name: row.name } });
  return { ok: true };
}

export function apiKeysOverview() {
  return {
    keys: q('SELECT id, name, prefix, scopes, tenant_id, rate_per_min, expires_at, last_used, calls, state, created_by, created_at FROM api_keys ORDER BY id DESC')
      .map((k) => ({ ...k, scopes: JSON.parse(k.scopes), expired: Boolean(k.expires_at && k.expires_at < new Date().toISOString()) })),
    counts: {
      active: one("SELECT COUNT(*) AS n FROM api_keys WHERE state = 'active'").n,
      revoked: one("SELECT COUNT(*) AS n FROM api_keys WHERE state = 'revoked'").n,
      callsToday: one("SELECT COUNT(*) AS n FROM api_calls WHERE created_at >= date('now')").n,
    },
    busiest: q(`SELECT path, method, COUNT(*) AS n, ROUND(AVG(ms),0) AS avg_ms
                FROM api_calls WHERE created_at >= datetime('now','-7 days')
                GROUP BY path, method ORDER BY n DESC LIMIT 15`),
    recent: q(`SELECT c.id, c.method, c.path, c.status, c.ms, c.created_at, k.name AS key_name
               FROM api_calls c LEFT JOIN api_keys k ON k.id = c.key_id
               ORDER BY c.id DESC LIMIT 30`),
    // A key can only ever hold permissions that exist; showing the catalogue
    // here is what stops somebody inventing a scope that silently grants nothing.
    availableScopes: PERMS,
  };
}
