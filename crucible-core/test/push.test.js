// Web Push, proved by doing the browser's half.
//
// There is no way to reach a real push service from a test, and "it returned
// 201" would not prove much anyway. What matters is that the sealed record is
// one a browser can actually open — so this test *is* the browser: it makes a
// subscription keypair, hands the public half to the encrypter, and then walks
// RFC 8291 backwards to read the message. If the plaintext comes back, the
// implementation is right; if a single byte of the key derivation is wrong,
// nothing comes back at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createECDH, hkdfSync, createDecipheriv, createPublicKey, createVerify, verify as verifyRaw } from 'node:crypto';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-push.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-push.db${s}`)); } catch { /* first run */ }
}

const { vapidKeys, vapidHeader, encryptPayload, subscribe, unsubscribe, pushToPermitted, pushOverview } = await import('../src/push.js');
const { one, exec } = await import('../src/db.js');

const b64url = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

/** Everything a browser holds for one subscription. */
function makeBrowser() {
  const ecdh = createECDH('prime256v1');
  const publicKey = ecdh.generateKeys();
  return {
    ecdh,
    p256dh: b64url(publicKey),
    auth: b64url(Buffer.from([...Array(16)].map((_, i) => (i * 37 + 11) & 0xff))),
    publicKey,
  };
}

/** The browser's side of RFC 8291, run in reverse. */
function browserDecrypt(browser, record) {
  const salt = record.subarray(0, 16);
  const idlen = record[20];
  const asPublic = record.subarray(21, 21 + idlen);
  const ciphertext = record.subarray(21 + idlen);

  const shared = browser.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browser.publicKey, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, unb64(browser.auth), keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // The last byte is the padding delimiter, 0x02 for a final record.
  assert.equal(plain[plain.length - 1], 2, 'the record should end with the 0x02 delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('the application server has one keypair, and it is stable', () => {
  const first = vapidKeys();
  const again = vapidKeys();
  assert.equal(first.publicKey, again.publicKey, 'regenerating would orphan every subscription');
  const raw = unb64(first.publicKey);
  assert.equal(raw.length, 65, 'the browser needs an uncompressed P-256 point');
  assert.equal(raw[0], 4, 'uncompressed points start with 0x04');
});

test('the VAPID header is a JWT the push service can verify', () => {
  const { authorization } = vapidHeader('https://fcm.googleapis.com/fcm/send/abc123');
  const [, token] = authorization.match(/t=([^,]+)/);
  const [h, p, s] = token.split('.');

  const header = JSON.parse(unb64(h));
  assert.equal(header.alg, 'ES256');
  const claims = JSON.parse(unb64(p));
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'the audience is the push service, not the endpoint');
  assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'it should not ship already expired');
  assert.ok(claims.exp - Math.floor(Date.now() / 1000) <= 24 * 3600, 'the spec caps the life at a day');
  assert.ok(claims.sub, 'a contact is required so a push service can complain to somebody');

  // Verify the signature with the public half, exactly as the service would.
  const raw = unb64(vapidKeys().publicKey);
  const pub = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) },
    format: 'jwk',
  });
  const ok = verifyRaw('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64(s));
  assert.ok(ok, 'the push service must be able to verify who sent this');
});

test('an encrypted payload is one the subscribing browser can actually open', () => {
  const browser = makeBrowser();
  const message = JSON.stringify({ title: 'Waiting on you', body: 'A decision needs a person', route: '#/gate' });
  const record = encryptPayload(message, browser);

  assert.equal(record.readUInt32BE(16), 4096, 'the record size goes in the header');
  assert.equal(record[20], 65, 'the key id length is the point length');
  assert.equal(browserDecrypt(browser, record), message);
});

test('two pushes of the same text produce different bytes', () => {
  const browser = makeBrowser();
  const a = encryptPayload('same', browser);
  const b = encryptPayload('same', browser);
  assert.notEqual(a.toString('base64'), b.toString('base64'), 'a fresh salt and ephemeral key every time');
  // …and both still open.
  assert.equal(browserDecrypt(browser, a), 'same');
  assert.equal(browserDecrypt(browser, b), 'same');
});

test('a subscription belonging to somebody else cannot open it', () => {
  const mine = makeBrowser();
  const theirs = makeBrowser();
  const record = encryptPayload('for me only', mine);
  assert.throws(() => browserDecrypt(theirs, record), 'a different key must not decrypt');
});

test('a malformed subscription is refused rather than sent into the void', () => {
  assert.throws(() => encryptPayload('x', { p256dh: b64url(Buffer.alloc(10)), auth: b64url(Buffer.alloc(16)) }), /uncompressed P-256/);
  assert.throws(() => encryptPayload('x', { p256dh: b64url(Buffer.alloc(65)), auth: b64url(Buffer.alloc(4)) }), /sixteen bytes/);
});

test('subscribing is idempotent, and unsubscribing removes it', () => {
  exec("INSERT INTO users (username, display_name, pass, role, perms) VALUES ('pushy','Pushy','x:y','member',?)", JSON.stringify(['gate.approve']));
  const userId = one("SELECT id FROM users WHERE username = 'pushy'").id;
  const browser = makeBrowser();
  const sub = { endpoint: 'https://push.example/one', keys: { p256dh: browser.p256dh, auth: browser.auth } };

  subscribe({ userId, subscription: sub, agent: 'a test' });
  subscribe({ userId, subscription: sub, agent: 'a test' });
  assert.equal(one('SELECT COUNT(*) AS n FROM push_subscriptions').n, 1, 'the same browser is one row, not two');

  assert.throws(() => subscribe({ userId, subscription: { endpoint: 'x' } }), /not a push subscription/);

  unsubscribe({ userId, endpoint: sub.endpoint });
  assert.equal(one('SELECT COUNT(*) AS n FROM push_subscriptions').n, 0);
});

test('a push goes only to people who can act on it', async () => {
  exec('DELETE FROM push_subscriptions');
  const can = one("SELECT id FROM users WHERE username = 'pushy'").id;
  exec("INSERT INTO users (username, display_name, pass, role, perms) VALUES ('bystander','By','x:y','member',?)", JSON.stringify(['dashboard.view']));
  const cannot = one("SELECT id FROM users WHERE username = 'bystander'").id;

  for (const [uid, ep] of [[can, 'https://push.example/can'], [cannot, 'https://push.example/cannot']]) {
    const b = makeBrowser();
    subscribe({ userId: uid, subscription: { endpoint: ep, keys: { p256dh: b.p256dh, auth: b.auth } } });
  }

  // The endpoints are unreachable, so every delivery fails — but the count of
  // what it *tried* is the thing under test: who was considered.
  const r = await pushToPermitted('gate.approve', { title: 'x', body: 'y' });
  assert.equal(r.tried, 1, 'only the account holding gate.approve should be tried');

  const overview = pushOverview();
  assert.ok(overview.configured, 'keys exist by now');
  assert.equal(overview.subscriptions.length, 2);
});

test('push can be switched off without tearing anything down', async () => {
  const { setSetting } = await import('../src/settings.js');
  setSetting('PUSH_ENABLED', 'false');
  const r = await pushToPermitted('gate.approve', { title: 'x', body: 'y' });
  assert.equal(r.sent, 0);
  assert.match(r.reason, /switched off/);
  setSetting('PUSH_ENABLED', null);
});
