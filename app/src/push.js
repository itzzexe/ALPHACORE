// Web Push — the platform reaching a person who is not looking at it.
//
// This is the highest-leverage thing in the whole system, and it is not a
// convenience. The design says humans hold the gates; the throughput of the
// company is therefore bounded by how quickly a human answers one. Without a
// push, an approval waits until somebody happens to open a tab, and autonomy
// freezes silently — the worst failure mode there is, because nothing looks
// broken.
//
// Written against RFC 8292 (VAPID) and RFC 8291 (aes128gcm payloads) on
// node:crypto alone. No dependency, in a project whose argument is that the
// machinery should be legible.
//
// What a push carries: a title, a line, and a route. Never a record. The
// payload is end-to-end encrypted and the push service cannot read it, but it
// still crosses a machine we do not own, and "an approval is waiting" is all
// anybody needs to know from a lock screen.
import {
  createECDH, createPrivateKey, createPublicKey, createSign,
  generateKeyPairSync, hkdfSync, createCipheriv, randomBytes, sign as signRaw,
} from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting, setSetting } from './settings.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

// ---------------------------------------------------------------- identity --

/**
 * The application server's own keypair. Generated once and kept in settings:
 * the public half is handed to every browser that subscribes, and a browser's
 * subscription is bound to it — rotate this and every existing subscription
 * becomes undeliverable, which is why it is generated once and left alone.
 */
export function vapidKeys({ create = true } = {}) {
  let pub = getSetting('VAPID_PUBLIC');
  let priv = getSetting('VAPID_PRIVATE');
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  if (!create) return null;

  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  // The browser wants the raw uncompressed point: 0x04 || X || Y.
  pub = b64url(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)]));
  priv = jwk.d;
  setSetting('VAPID_PUBLIC', pub);
  setSetting('VAPID_PRIVATE', priv);
  audit({
    actorType: 'system', actorId: 'system:push', action: 'push.keys_created',
    subjectType: 'system', subjectId: 'vapid',
    payload: { note: 'rotating these invalidates every existing subscription' },
  });
  return { publicKey: pub, privateKey: priv };
}

/** Rebuild a signing key from the stored scalar. */
function signingKey() {
  const { publicKey, privateKey } = vapidKeys();
  const raw = unb64(publicKey);
  return createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64url(raw.subarray(1, 33)),
      y: b64url(raw.subarray(33, 65)),
      d: privateKey,
    },
    format: 'jwk',
  });
}

/**
 * The VAPID Authorization header: a JWT saying who is pushing, to which push
 * service, and for how long — signed so the push service can tell one sender
 * from another and rate-limit them separately.
 */
export function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const sub = getSetting('VAPID_SUBJECT') || getSetting('PUBLIC_BASE_URL') || 'https://localhost';
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify({
    aud,
    // Twelve hours. The spec caps it at 24; half of that survives a clock that
    // is a little wrong in either direction.
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: sub.startsWith('mailto:') || sub.startsWith('http') ? sub : `mailto:${sub}`,
  }));
  // JWS wants the raw r||s pair, not the DER sequence node produces by default.
  const signature = signRaw('sha256', Buffer.from(`${header}.${body}`), {
    key: signingKey(),
    dsaEncoding: 'ieee-p1363',
  });
  return {
    authorization: `vapid t=${header}.${body}.${b64url(signature)}, k=${vapidKeys().publicKey}`,
  };
}

// -------------------------------------------------------------- encryption --

/**
 * RFC 8291, aes128gcm. The push service relays a sealed box it cannot open:
 * only the browser that produced the subscription holds the key.
 *
 * The record it builds is
 *   salt(16) ‖ rs(4) ‖ idlen(1) ‖ server_public(65) ‖ ciphertext
 * and the plaintext is padded with a single 0x02 delimiter, which is what
 * marks it as the last (and only) record.
 */
export function encryptPayload(plaintext, { p256dh, auth }) {
  const uaPublic = unb64(p256dh);
  const authSecret = unb64(auth);
  if (uaPublic.length !== 65) throw new Error('the subscription key is not an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('the subscription auth secret is not sixteen bytes');

  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);

  // Step one binds the shared secret to *these two* parties, so a secret
  // captured from another exchange cannot be replayed into this one.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), uaPublic, asPublic,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));

  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.from(plaintext, 'utf8');
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([body, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

// ----------------------------------------------------------- subscriptions --

export function subscribe({ userId, subscription, agent = null }) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('that is not a push subscription');
  exec(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       failures = 0, retired_at = NULL`,
    userId, endpoint, keys.p256dh, keys.auth, agent ? String(agent).slice(0, 200) : null,
  );
  audit({
    actorType: 'human', actorId: `user:${userId}`, action: 'push.subscribed',
    subjectType: 'user', subjectId: String(userId),
    payload: { service: new URL(endpoint).host },
  });
  return { ok: true };
}

export function unsubscribe({ userId, endpoint }) {
  exec('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint);
  audit({ actorType: 'human', actorId: `user:${userId}`, action: 'push.unsubscribed', subjectType: 'user', subjectId: String(userId) });
  return { ok: true };
}

/** A dead subscription is a browser that was uninstalled, not an error. */
function retire(sub, reason) {
  exec("UPDATE push_subscriptions SET retired_at = datetime('now'), last_error = ? WHERE id = ?", reason, sub.id);
  audit({
    actorType: 'system', actorId: 'system:push', action: 'push.retired',
    subjectType: 'user', subjectId: String(sub.user_id), payload: { reason },
  });
}

// --------------------------------------------------------------- delivering --

/**
 * Deliver to one subscription. Returns what happened rather than throwing: a
 * push that fails must never take down the thing that raised the notification.
 */
export async function deliver(sub, message) {
  let res;
  const payload = JSON.stringify(message);
  try {
    const body = encryptPayload(payload, { p256dh: sub.p256dh, auth: sub.auth });
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        ...vapidHeader(sub.endpoint),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: message.urgency || 'normal',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    exec('UPDATE push_subscriptions SET failures = failures + 1, last_error = ? WHERE id = ?', String(err.message).slice(0, 200), sub.id);
    return { ok: false, error: err.message };
  }

  if (res.status === 404 || res.status === 410) {
    retire(sub, `the push service returned ${res.status} — the browser is gone`);
    return { ok: false, gone: true };
  }
  if (!res.ok) {
    const failures = (sub.failures || 0) + 1;
    exec('UPDATE push_subscriptions SET failures = ?, last_error = ? WHERE id = ?', failures, `HTTP ${res.status}`, sub.id);
    // Ten refusals in a row is not a blip; stop pestering a service that does
    // not want to hear from us.
    if (failures >= 10) retire(sub, `ten consecutive failures, last was HTTP ${res.status}`);
    return { ok: false, status: res.status };
  }
  exec("UPDATE push_subscriptions SET failures = 0, last_ok = datetime('now'), last_error = NULL WHERE id = ?", sub.id);
  return { ok: true, status: res.status };
}

/**
 * Push to everybody who can act on this, which is not everybody who is
 * subscribed: a notification about an approval goes to people who can approve.
 */
export async function pushToPermitted(perm, message) {
  if (!getSetting('VAPID_PUBLIC')) return { sent: 0, reason: 'push is not set up' };
  if (String(getSetting('PUSH_ENABLED') ?? 'true') === 'false') return { sent: 0, reason: 'push is switched off' };

  const subs = q('SELECT * FROM push_subscriptions WHERE retired_at IS NULL');
  if (!subs.length) return { sent: 0, reason: 'nobody is subscribed' };

  const users = new Map(q('SELECT id, perms, role FROM users').map((u) => [u.id, u]));
  const allowed = subs.filter((s) => {
    const u = users.get(s.user_id);
    if (!u) return false;
    if (u.role === 'superadmin') return true;
    try { const p = JSON.parse(u.perms); return p.includes('*') || !perm || p.includes(perm); }
    catch { return false; }
  });

  const results = await Promise.all(allowed.map((s) => deliver(s, message)));
  const sent = results.filter((r) => r.ok).length;
  if (sent) {
    audit({
      actorType: 'system', actorId: 'system:push', action: 'push.sent',
      subjectType: message.subjectType || 'notification', subjectId: String(message.subjectId ?? ''),
      payload: { title: message.title, recipients: sent, permission: perm || 'any' },
    });
  }
  return { sent, tried: allowed.length };
}

export function pushOverview() {
  const rows = q(`SELECT p.*, u.username FROM push_subscriptions p
                  LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`);
  return {
    configured: Boolean(getSetting('VAPID_PUBLIC')),
    enabled: String(getSetting('PUSH_ENABLED') ?? 'true') !== 'false',
    publicKey: getSetting('VAPID_PUBLIC') || null,
    subject: getSetting('VAPID_SUBJECT') || null,
    active: rows.filter((r) => !r.retired_at).length,
    retired: rows.filter((r) => r.retired_at).length,
    subscriptions: rows.map((r) => ({
      id: r.id, username: r.username, service: (() => { try { return new URL(r.endpoint).host; } catch { return '?'; } })(),
      userAgent: r.user_agent, failures: r.failures, lastOk: r.last_ok, lastError: r.last_error, retiredAt: r.retired_at,
    })),
  };
}
