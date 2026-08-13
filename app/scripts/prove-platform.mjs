// Prove the platform layer against a throwaway database, in mock mode.
// Run: node --experimental-sqlite scripts/prove-platform.mjs
//
// It used to run against whatever database was configured, which on a normal
// machine is the running company: the proof wrote test connectors, test keys
// and fork simulations into real records, and refused to run at all while the
// server held the file. A proof that damages what it inspects is not a proof.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/prove-platform.db';
const proveRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(proveRoot, process.env.ALPHACORE_DB + suffix)); } catch { /* first run */ }
}

const { createKey, authenticateKey, revokeKey, apiKeysOverview } = await import('../src/apikeys.js');
const { addWebhook, sign, verify, webhookTick, webhooksOverview, removeWebhook } = await import('../src/webhooks.js');
const { seedPackages, addPackage, validateManifest, installPackage, uninstallPackage, packagesOverview, EXAMPLE_MANIFEST } = await import('../src/packages.js');
const { chiefTick, chiefOverview, situation } = await import('../src/chief.js');
const { seedSlos, record, observeTick, observeOverview } = await import('../src/observe.js');
const { takeBackup, verifyBackup, backupsOverview, exportAll } = await import('../src/backup.js');
const { createTenant, tenantsOverview, deleteTenant } = await import('../src/tenants.js');
const { verifyChain } = await import('../src/audit.js');
const { one, exec, q } = await import('../src/db.js');

const line = (s) => console.log(`\n=== ${s} ===`);
let failures = 0;
const check = (cond, msg) => { if (!cond) failures++; console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`); };

seedPackages();
seedSlos();

line('API keys: a key is shown once, scoped, and rate-limited');
const made = createKey({ name: 'prove-key', scopes: ['dashboard.view', 'runs.view'], ratePerMin: 3, actor: 'human:prove' });
check(made.key.startsWith('ck_') && made.key.length > 30, 'a key is minted');
const stored = one('SELECT hash, prefix FROM api_keys WHERE prefix = ?', made.prefix);
check(!stored.hash.includes(made.key.slice(4)), 'what is stored is a hash, not the key');
const asUser = authenticateKey(made.key);
check(asUser && asUser.perms.length === 2 && asUser.isKey, `the key authenticates and carries exactly its ${asUser?.perms.length} scopes`);
check(authenticateKey('ck_totally-made-up') === null, 'a made-up key authenticates as nobody');
check(!asUser.perms.includes('*'), 'a key never holds the wildcard');

// Burn through the rate limit deliberately.
for (let i = 0; i < 4; i++) exec('INSERT INTO api_calls (key_id, method, path, status, ms) VALUES (?,?,?,?,?)', stored.id ?? one('SELECT id FROM api_keys WHERE prefix = ?', made.prefix).id, 'GET', '/api/stats', 200, 5);
const limited = authenticateKey(made.key);
check(limited?.rateLimited === true, `past ${3} calls a minute the key is refused rather than served`);

const keyRow = one('SELECT id FROM api_keys WHERE prefix = ?', made.prefix);
revokeKey(keyRow.id, { actor: 'human:prove' });
check(authenticateKey(made.key) === null, 'a revoked key stops working immediately');

line('Webhooks: signed, and the signature actually verifies');
const hook = addWebhook({ url: 'https://example.com/hooks/alphacore', events: ['run.*', 'egress.blocked'], actor: 'human:prove' });
const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ event: 'run.done', seq: 1 });
const sig = sign(hook.secret, ts, body);
check(verify({ secret: hook.secret, timestamp: ts, body, signature: sig }), 'a receiver can verify what we send');
check(!verify({ secret: hook.secret, timestamp: ts, body: `${body} `, signature: sig }), 'an altered body fails the check');
check(!verify({ secret: 'the-wrong-secret', timestamp: ts, body, signature: sig }), 'the wrong secret fails the check');
check(!verify({ secret: hook.secret, timestamp: ts - 3600, body, signature: sign(hook.secret, ts - 3600, body) }), 'an hour-old signature is refused (replay window)');
const queued = webhookTick();
console.log(`    queued ${queued} deliveries from the chain`);
removeWebhook(hook.id, { actor: 'human:prove' });

line('Packages: a department as an installable manifest');
check(validateManifest(EXAMPLE_MANIFEST).ok, 'the shipped example validates');
const bad = validateManifest({ ...EXAMPLE_MANIFEST, id: 'evil', tables: [{ name: 'customers', columns: [{ name: 'x', type: 'TEXT' }] }] });
check(!bad.ok && bad.problems.some((p) => p.includes('must start with')), 'a package cannot redefine somebody else\'s table');
const grabby = validateManifest({ ...EXAMPLE_MANIFEST, permissions: ['users.manage'] });
check(!grabby.ok, 'a package cannot claim an existing permission');

addPackage({ manifest: EXAMPLE_MANIFEST, actor: 'human:prove' });
installPackage(EXAMPLE_MANIFEST.id, { actor: 'human:prove' });
const installed = packagesOverview();
check(installed.counts.installed >= 1, 'the package installs');
check(Boolean(one("SELECT name FROM sqlite_master WHERE type='table' AND name = 'legalhold_matters'")), 'its table exists');
check(Boolean(one("SELECT id FROM agents WHERE id = 'AGT-HOLD-001' AND status = 'active'")), 'its employee is on the roster');
check(installed.sections.some((s) => s.id === 'legalhold'), 'it appears as a section with its own relationships');
uninstallPackage(EXAMPLE_MANIFEST.id, { actor: 'human:prove' });
check(one("SELECT status FROM agents WHERE id = 'AGT-HOLD-001'")?.status === 'retired', 'uninstalling retires the employee');
check(Boolean(one("SELECT name FROM sqlite_master WHERE name = 'legalhold_matters'")), 'and keeps the data, because nobody asked for it to be deleted');

line('The operating rhythm: the company decides what to do next');
const turn = chiefTick({ force: 'day' });
check(turn.ran, `the rhythm ran at autonomy "${turn.level}"`);
for (const m of turn.moves.slice(0, 6)) console.log(`    · ${m}`);
const week = chiefTick({ force: 'week' });
for (const m of week.moves.slice(0, 4)) console.log(`    · ${m}`);
const quarter = chiefTick({ force: 'quarter' });
for (const m of quarter.moves.slice(0, 4)) console.log(`    · ${m}`);
// A period that already exists is not re-opened — running the rhythm twice in
// one day must not produce two days. What is checked is that each clock has a
// period with a plan on it, whoever wrote it.
const kinds = q("SELECT kind, COUNT(*) AS n, SUM(plan IS NOT NULL) AS planned FROM periods GROUP BY kind");
check(kinds.length === 3, `all three clocks have periods: ${kinds.map((k) => `${k.n} ${k.kind}`).join(', ')}`);
check(kinds.every((k) => k.planned > 0), 'every clock wrote down what it decided, not just that it ran');
const co = chiefOverview();
check(co.objectives.length > 0, `${co.objectives.length} objective(s) the company set itself`);
for (const o of co.objectives.slice(0, 3)) console.log(`    goal: ${o.title}`);
check(co.limits.length === 4, 'the four limits autonomy does not cross are stated');

line('Observability: it notices, and then it does something');
record('queue.stuck', 12);   // deliberately breach "nothing stalls"
exec("UPDATE slos SET state = 'ok' WHERE name = 'nothing-stalls'");
const applied = observeTick();
const ob = observeOverview();
const stalls = ob.slos.find((s) => s.name === 'nothing-stalls');
check(stalls.state === 'breached' || applied.some((a) => a.slo === 'nothing-stalls'),
  `a breached objective is noticed (${stalls.state}, last value ${stalls.last_value})`);
check(applied.length > 0 || ob.counts.remediesApplied > 0, `a remedy was applied rather than a dashboard turning red: ${applied.map((a) => a.action).join(', ') || 'previously'}`);
for (const a of applied) console.log(`    ${a.slo} → ${a.action}: ${a.detail}`);

line('Backups: taken, hashed, and actually opened again');
const b = takeBackup({ kind: 'manual', actor: 'human:prove' });
check(b.bytes > 100_000, `${(b.bytes / 1e6).toFixed(1)} MB written`);
const v = verifyBackup(b.id);
check(v.ok, `it verifies: ${v.chain ? `${v.chain.entries} chain entries, tip ${v.chain.tip}` : ''}`);
check(v.chain?.matchesRecord, 'and its chain tip matches what was recorded when it was taken');
const ex = exportAll({ tables: ['agents', 'vault_secrets'] });
check(Array.isArray(ex.tables.agents) && ex.tables.agents.length > 0, `export carries real rows (${ex.tables.agents.length} employees)`);
check(ex.tables.vault_secrets?.skipped, 'and never exports credentials');

line('Tenants: isolation by file, not by WHERE clause');
try { deleteTenant('prove-co', { confirm: 'prove-co', actor: 'human:prove' }); } catch { /* first run */ }
const t = createTenant({ id: 'prove-co', name: 'Prove & Co', ownerEmail: 'owner@example.com', monthlyCapUsd: 5, actor: 'human:prove' });
check(t.db_file.includes('tenants') && t.db_file.endsWith('.db'), `it gets its own database file: ${t.db_file}`);
check(t.port >= 8500, `and its own port: ${t.port}`);
const to = tenantsOverview();
check(to.tenants.some((x) => x.id === 'prove-co'), `${to.counts.total} company(ies) on this installation`);
let refused = false;
try { deleteTenant('prove-co', { confirm: 'wrong', actor: 'human:prove' }); } catch { refused = true; }
check(refused, 'deleting a company refuses without the id typed back');
deleteTenant('prove-co', { confirm: 'prove-co', actor: 'human:prove' });
check(!one('SELECT id FROM tenants WHERE id = ?', 'prove-co'), 'and removes it cleanly when confirmed');

line('The chain survived all of that');
const chain = verifyChain();
check(chain.ok, `${chain.checked} entries verify`);

line('summary');
console.log(`  keys: ${JSON.stringify(apiKeysOverview().counts)}`);
console.log(`  webhooks: ${JSON.stringify(webhooksOverview().counts)}`);
console.log(`  packages: ${JSON.stringify(packagesOverview().counts)}`);
console.log(`  periods: ${JSON.stringify(chiefOverview().counts)}`);
console.log(`  slos: ${JSON.stringify(observeOverview().counts)}`);
console.log(`  backups: ${backupsOverview().counts.total} kept, newest ${backupsOverview().newest?.ageHours ?? '—'}h old`);
console.log(`  situation: queue ${situation().queue.queued} waiting, ${situation().workforce.active} employees, $${situation().money.monthUsd} this month`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
