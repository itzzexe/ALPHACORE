// Master key rotation, tested by breaking it first.
//
// This is the one operation in the system whose failure mode is losing every
// credential the company has at once. So the tests that matter are not the
// happy path — they are: does it refuse when it should, does it roll back
// cleanly, and does the *old* key stop working afterwards. A rotation where
// the previous key still opens everything has rotated nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-rotation.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-rotation.db${s}`)); } catch { /* first run */ }
}
// A rotation test that shares the live key file would rewrite the real one.
const KEY = path.join(root, 'data', 'master.key');
const BACKUP = `${KEY}.testbackup`;
if (fs.existsSync(KEY)) fs.copyFileSync(KEY, BACKUP);
for (const f of fs.readdirSync(path.join(root, 'data')).filter((f) => f.startsWith('master.key.retired-'))) {
  fs.rmSync(path.join(root, 'data', f));
}

const vault = await import('../src/vault.js');
const mk = await import('../src/masterkey.js');
const E = await import('../src/erasure.js');
const { q, one, exec } = await import('../src/db.js');

test.after(() => {
  // Put the real key back, whatever these tests did to it.
  if (fs.existsSync(BACKUP)) { fs.copyFileSync(BACKUP, KEY); fs.rmSync(BACKUP); }
  for (const f of fs.readdirSync(path.join(root, 'data')).filter((f) => f.startsWith('master.key.retired-'))) {
    fs.rmSync(path.join(root, 'data', f));
  }
});

test('a sealed value names the key that sealed it', () => {
  const sealed = vault.seal('a secret');
  assert.match(sealed, /^k1:[0-9a-f]{16}:/);
  assert.equal(vault.open(sealed), 'a secret');
  assert.ok(!sealed.includes('a secret'));
});

test('a value sealed under another key is refused by name, not by a generic error', () => {
  const other = mk.proposeKey();
  const sealed = vault.seal('under a different key', other.key);
  assert.throws(() => vault.open(sealed), vault.VaultKeyMismatch);
  try { vault.open(sealed); } catch (e) {
    // "Sealed under a key you no longer have" and "this is corrupt" have
    // nothing in common as problems, and used to look identical.
    assert.match(e.message, /restore the retired key file/);
  }
  assert.equal(vault.open(sealed, other.key), 'under a different key');
});

test('values written before key ids existed still open', () => {
  // The old format was bare base64 with no prefix. There was only ever one key
  // then, so reading them with the current one is correct.
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', mk.masterKey(), iv);
  const data = Buffer.concat([c.update('an old secret', 'utf8'), c.final()]);
  const legacy = Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  assert.ok(!legacy.startsWith('k1:'));
  assert.equal(vault.open(legacy), 'an old secret');
});

test('rotation needs a human, and a dry run changes nothing', () => {
  vault.putSecret('PROVIDER_KEY', 'sk-the-real-thing-9999', { actor: 'human:owner' });
  vault.putSecret('WEBHOOK_SECRET', 'whsec-abcdef', { actor: 'human:owner' });
  E.sealPii('someone@example.com', { kind: 'contact', identifier: 'someone@example.com' });

  assert.throws(() => vault.rotateMasterKey({}), /human act/);

  const before = mk.keyId();
  const dry = vault.rotateMasterKey({ actor: 'human:owner', dryRun: true });
  assert.equal(dry.ok, true);
  assert.ok(dry.wouldReseal >= 3, 'the vault secrets and the subject key');
  assert.equal(mk.keyId(), before, 'a dry run must not touch the key');
});

test('rotation refuses when something cannot be read now', () => {
  // Corrupt one value. Re-sealing what you cannot read turns a recoverable
  // problem into a permanent one, so it must stop before it starts.
  exec("UPDATE vault_secrets SET ciphertext = 'k1:0000000000000000:bm90LWEtc2VjcmV0' WHERE name = 'WEBHOOK_SECRET'");
  const r = vault.rotateMasterKey({ actor: 'human:owner' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot be read with the current key/);
  assert.ok(r.unreadable.includes('vault_secrets.WEBHOOK_SECRET'));

  // Put it back so the rest of the file has a healthy vault.
  vault.putSecret('WEBHOOK_SECRET', 'whsec-abcdef', { actor: 'human:owner' });
});

test('a real rotation moves everything, and the old key stops working', () => {
  const oldKeyMaterial = Buffer.from(fs.readFileSync(KEY, 'utf8').trim(), 'base64');
  const before = mk.keyId();
  const providerBefore = vault.getSecret('PROVIDER_KEY');
  const subjectRef = E.refFor('contact', 'someone@example.com');
  const wrappedBefore = one('SELECT wrapped_key FROM pii_subjects WHERE ref = ?', subjectRef).wrapped_key;

  const r = vault.rotateMasterKey({ actor: 'human:owner' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual(r.to, before, 'a new key');
  assert.ok(r.resealed >= 3);

  // Everything still readable, and unchanged.
  assert.equal(vault.getSecret('PROVIDER_KEY'), providerBefore);
  assert.equal(vault.getSecret('WEBHOOK_SECRET'), 'whsec-abcdef');
  // The subject key moved too — missing it would erase everybody silently,
  // as a side effect of a security improvement.
  const wrappedAfter = one('SELECT wrapped_key FROM pii_subjects WHERE ref = ?', subjectRef).wrapped_key;
  assert.notEqual(wrappedAfter, wrappedBefore, 're-sealed under the new key');
  assert.equal(E.openPii(E.sealPii('x', { kind: 'contact', identifier: 'someone@example.com' })), 'x');

  // And the old key genuinely no longer opens anything. A rotation after which
  // the previous key still works has rotated nothing.
  const oldKey = scryptSync(oldKeyMaterial.subarray(16), oldKeyMaterial.subarray(0, 16), 32);
  const ciphertext = one("SELECT ciphertext FROM vault_secrets WHERE name = 'PROVIDER_KEY'").ciphertext;
  assert.throws(() => vault.open(ciphertext, oldKey), 'the retired key must not open the new ciphertext');
});

test('the retired key is kept, because a backup from an hour ago needs it', () => {
  const retired = fs.readdirSync(path.join(root, 'data')).filter((f) => f.startsWith('master.key.retired-'));
  assert.equal(retired.length, 1, 'deleting it makes every earlier backup unreadable');
  const health = vault.keyHealth();
  assert.equal(health.retiredKeys.length, 1);
});

test('the rotation is on the chain, naming both fingerprints and neither key', () => {
  const entry = one("SELECT payload FROM audit_log WHERE action = 'vault.key_rotated' ORDER BY seq DESC LIMIT 1");
  const p = JSON.parse(entry.payload);
  assert.ok(p.from && p.to && p.from !== p.to);
  assert.ok(p.resealed >= 3);
  const material = fs.readFileSync(KEY, 'utf8').trim();
  assert.ok(!entry.payload.includes(material), 'the key itself never goes into the record');
});

test('health says where the key comes from and whether everything reads', () => {
  const h = vault.keyHealth();
  assert.equal(h.source, 'file');
  assert.equal(h.external, false);
  assert.match(h.note, /beside the database/);
  assert.equal(h.failing.length, 0);
  assert.equal(h.readable, h.sealedValues);
});

test('an external key source is used when one is configured', async () => {
  // The KMS door: any command that prints the material works. Proved with the
  // simplest possible one rather than mocked, so the plumbing is genuinely
  // exercised — argument splitting, timeout, base64, and all.
  const material = fs.readFileSync(KEY, 'utf8').trim();
  process.env.ALPHACORE_MASTER_KEY_COMMAND = `node -e console.log("${material}")`;
  const fresh = await import(`../src/masterkey.js?external=${Date.now()}`);
  const src = fresh.keySource();
  assert.equal(src.source, 'command');
  assert.equal(src.external, true);
  assert.match(src.note, /nothing is written to disk/);
  assert.equal(src.keyId, mk.keyId(), 'the same material must give the same key');

  // …and rotation refuses to rewrite a file that is not the source of truth.
  assert.throws(() => fresh.installKey(Buffer.alloc(48)), /belongs there/);
  delete process.env.ALPHACORE_MASTER_KEY_COMMAND;
});
