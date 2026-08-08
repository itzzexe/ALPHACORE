// The platform's load-bearing walls: a key cannot exceed its scopes, a webhook
// signature cannot be forged, a package cannot claim somebody else's tables or
// powers, the rhythm writes down what it decided, and a backup can be opened
// again. Runs against its own database file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CRUCIBLE_MOCK = 'true';
process.env.CRUCIBLE_DB = 'data/test-platform.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-platform.db${suffix}`)); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { createKey, authenticateKey, revokeKey } = await import('../src/apikeys.js');
const { addWebhook, sign, verify } = await import('../src/webhooks.js');
const { seedPackages, addPackage, validateManifest, installPackage, uninstallPackage, EXAMPLE_MANIFEST } = await import('../src/packages.js');
const { chiefTick, chiefOverview } = await import('../src/chief.js');
const { seedSlos, record, observeTick, observeOverview } = await import('../src/observe.js');
const { takeBackup, verifyBackup } = await import('../src/backup.js');
const { createTenant, deleteTenant, tenantsOverview } = await import('../src/tenants.js');

seedPackages();
seedSlos();

test('a key carries exactly its scopes and nothing more', () => {
  const made = createKey({ name: 'test-key', scopes: ['dashboard.view'], ratePerMin: 100, actor: 'human:test' });
  const who = authenticateKey(made.key);
  assert.deepEqual(who.perms, ['dashboard.view']);
  assert.equal(who.isKey, true);
  assert.ok(!who.perms.includes('*'), 'a key must never hold the wildcard');

  const row = one('SELECT hash FROM api_keys WHERE prefix = ?', made.prefix);
  assert.ok(!row.hash.includes(made.key.slice(3, 20)), 'the key itself must not be recoverable from storage');
  assert.equal(authenticateKey('ck_not-a-real-key'), null);
});

test('an invented scope is dropped rather than silently granted', () => {
  const made = createKey({ name: 'test-key-2', scopes: ['dashboard.view', 'not.a.real.permission'], actor: 'human:test' });
  assert.deepEqual(authenticateKey(made.key).perms, ['dashboard.view']);
  assert.throws(() => createKey({ name: 'empty', scopes: ['nope.nope'], actor: 'human:test' }), /no scopes/);
});

test('a revoked key stops working immediately', () => {
  const made = createKey({ name: 'test-key-3', scopes: ['dashboard.view'], actor: 'human:test' });
  const id = one('SELECT id FROM api_keys WHERE prefix = ?', made.prefix).id;
  assert.ok(authenticateKey(made.key));
  revokeKey(id, { actor: 'human:test' });
  assert.equal(authenticateKey(made.key), null);
});

test('a key past its rate limit is refused rather than served', () => {
  const made = createKey({ name: 'test-key-4', scopes: ['dashboard.view'], ratePerMin: 2, actor: 'human:test' });
  const id = one('SELECT id FROM api_keys WHERE prefix = ?', made.prefix).id;
  for (let i = 0; i < 3; i++) exec('INSERT INTO api_calls (key_id, method, path, status, ms) VALUES (?,?,?,?,?)', id, 'GET', '/api/stats', 200, 4);
  assert.equal(authenticateKey(made.key).rateLimited, true);
});

test('a webhook signature verifies, and cannot be forged or replayed', () => {
  const hook = addWebhook({ url: 'https://example.com/hook', events: ['*'], actor: 'human:test' });
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event: 'run.done' });
  const sig = sign(hook.secret, ts, body);
  assert.equal(verify({ secret: hook.secret, timestamp: ts, body, signature: sig }), true);
  assert.equal(verify({ secret: hook.secret, timestamp: ts, body: `${body} `, signature: sig }), false);
  assert.equal(verify({ secret: 'wrong', timestamp: ts, body, signature: sig }), false);
  assert.equal(verify({ secret: hook.secret, timestamp: ts - 3600, body, signature: sign(hook.secret, ts - 3600, body) }), false, 'an hour-old signature must be refused');
});

test('a package cannot take somebody else\'s tables or powers', () => {
  assert.equal(validateManifest(EXAMPLE_MANIFEST).ok, true);

  const grabsTable = validateManifest({ ...EXAMPLE_MANIFEST, tables: [{ name: 'customers', columns: [{ name: 'x', type: 'TEXT' }] }] });
  assert.equal(grabsTable.ok, false);
  assert.ok(grabsTable.problems.some((p) => p.includes('must start with')));

  const grabsPerm = validateManifest({ ...EXAMPLE_MANIFEST, permissions: ['users.manage'] });
  assert.equal(grabsPerm.ok, false);

  const badColumn = validateManifest({
    ...EXAMPLE_MANIFEST,
    tables: [{ name: 'legalhold_x', columns: [{ name: 'y', type: "TEXT); DROP TABLE agents;--" }] }],
  });
  assert.equal(badColumn.ok, false, 'a column type outside the four allowed must be refused');
});

test('installing a package creates its department; uninstalling keeps the data', () => {
  addPackage({ manifest: EXAMPLE_MANIFEST, actor: 'human:test' });
  installPackage(EXAMPLE_MANIFEST.id, { actor: 'human:test' });
  assert.ok(one("SELECT name FROM sqlite_master WHERE name = 'legalhold_matters'"), 'its table exists');
  assert.equal(one("SELECT status FROM agents WHERE id = 'AGT-HOLD-001'")?.status, 'active');

  uninstallPackage(EXAMPLE_MANIFEST.id, { actor: 'human:test' });
  assert.equal(one("SELECT status FROM agents WHERE id = 'AGT-HOLD-001'")?.status, 'retired');
  assert.ok(one("SELECT name FROM sqlite_master WHERE name = 'legalhold_matters'"), 'the data stays unless somebody asks otherwise');

  // Re-installing must bring the employee back, not leave a package installed
  // with a retired workforce.
  installPackage(EXAMPLE_MANIFEST.id, { actor: 'human:test' });
  assert.equal(one("SELECT status FROM agents WHERE id = 'AGT-HOLD-001'")?.status, 'active');
});

test('the rhythm writes down what it decided, and does not re-open a period', () => {
  const first = chiefTick({ force: 'day' });
  assert.equal(first.ran, true);
  chiefTick({ force: 'week' });
  chiefTick({ force: 'quarter' });

  const kinds = q('SELECT kind, COUNT(*) AS n FROM periods GROUP BY kind');
  assert.equal(kinds.length, 3, 'all three clocks wrote a period');

  const before = one('SELECT COUNT(*) AS n FROM periods').n;
  chiefTick({ force: 'day' });
  assert.equal(one('SELECT COUNT(*) AS n FROM periods').n, before, 'running the day twice must not produce two days');

  const o = chiefOverview();
  assert.ok(o.objectives.length > 0, 'the quarter set objectives');
  assert.ok(o.objectives.every((x) => x.id), 'every objective has an id — a null id reads back as nothing');
  assert.equal(o.limits.length, 4, 'the limits autonomy does not cross are stated');
});

test('a broken promise is noticed and something is actually done', () => {
  record('queue.stuck', 25);
  exec("UPDATE slos SET state = 'ok' WHERE name = 'nothing-stalls'");
  observeTick();
  const slo = observeOverview().slos.find((s) => s.name === 'nothing-stalls');
  assert.equal(slo.state, 'breached');
  assert.ok(one("SELECT id FROM remedies WHERE slo = 'nothing-stalls'"), 'a remedy was recorded, not just an alert');
});

test('a backup opens again and knows which chain it came from', () => {
  const b = takeBackup({ kind: 'manual', actor: 'human:test' });
  const v = verifyBackup(b.id);
  assert.equal(v.ok, true);
  assert.ok(v.chain.entries > 0);
  assert.equal(v.chain.matchesRecord, true, 'the chain tip must match what was recorded when it was taken');
});

test('a company gets its own file, and cannot be deleted by accident', () => {
  const t = createTenant({ id: 'test-co', name: 'Test Co', monthlyCapUsd: 10, actor: 'human:test' });
  assert.ok(t.db_file.includes('tenants'), 'isolation is by file');
  assert.ok(t.port >= 8500);
  assert.throws(() => deleteTenant('test-co', { confirm: 'nope', actor: 'human:test' }), /type the company id/);
  assert.throws(() => deleteTenant('test-co', { confirm: 'test-co', actor: 'system:whatever' }), /only a person/);
  deleteTenant('test-co', { confirm: 'test-co', actor: 'human:test' });
  assert.equal(tenantsOverview().counts.total, 0);
});

test('the chain verifies after everything above', () => {
  const v = verifyChain();
  assert.equal(v.ok, true, v.brokenAt ? `broken at ${v.brokenAt}` : '');
});
