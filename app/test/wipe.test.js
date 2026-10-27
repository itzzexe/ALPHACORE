// The factory reset, through the real route.
//
// It never had a test, and it never worked: the route table held it in a
// transaction, SQLite ignores `PRAGMA foreign_keys = OFF` inside one, and the
// first table with a reference stopped the whole wipe. So this goes through
// handleApi exactly as the console does, with rows that reference each other
// in the database, and checks what a person would check afterwards: the data
// is gone, the company is usable, the chain is intact, and they can still
// sign in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-wipe.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-wipe-memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 19).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-wipe.db${suffix}`)); } catch { /* first run */ }
}

const { one, exec } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { hashPassword, verifyPassword } = await import('../src/auth.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting, getSetting } = await import('../src/settings.js');
const { handleApi } = await import('../src/api.js');
const markets = await import('../src/markets.js');
const portfolio = await import('../src/portfolio.js');
const news = await import('../src/newsroom.js');

seedAgents();
seedConnectors();
const PASS = 'a-long-test-password';
exec("INSERT INTO users (username, display_name, pass, role, perms, must_change) VALUES ('boss', 'Boss', ?, 'superadmin', '[\"*\"]', 0)", hashPassword(PASS));
exec("INSERT INTO users (username, display_name, pass, role, perms, must_change) VALUES ('clerk', 'Clerk', ?, 'operator', '[\"settings.manage\"]', 0)", hashPassword(PASS));
const userRow = (name) => {
  const u = one('SELECT * FROM users WHERE username = ?', name);
  return { ...u, perms: JSON.parse(u.perms) };
};

async function call(pathname, body, user) {
  let status = 200; let out = '';
  const res = { writeHead: (s) => { status = s; }, setHeader() {}, end: (b) => { out = b; } };
  await handleApi({ method: 'POST', headers: {} }, res, new URL(`http://x${pathname}`), body, user);
  return { status, json: out ? JSON.parse(out) : null };
}

/** Rows that reference each other — the shape the old wipe could not delete. */
async function makeData() {
  markets.seedWatchlist({ actor: 'human:boss' });
  await markets.refreshQuotes({ actor: 'human:boss' });
  const o = portfolio.propose({ symbol: 'AAPL', side: 'buy', qty: 2, actor: 'human:boss' });
  await portfolio.approve({ id: o.id, actor: 'human:boss' });
  news.seedFeeds({ actor: 'human:boss' });
  news.ingest(one('SELECT * FROM news_feeds LIMIT 1'), [{ title: 'A story', url: 'https://example.com/s', summary: 'x' }]);
  assert.ok(one('SELECT COUNT(*) AS n FROM pf_positions').n > 0);
  assert.ok(one('SELECT COUNT(*) AS n FROM news_items').n > 0);
}

test('only a superadmin who types the phrase and their password can wipe', async () => {
  assert.equal((await call('/api/system/wipe', { confirm: 'WIPE ALL DATA', password: PASS }, userRow('clerk'))).status, 403);
  assert.equal((await call('/api/system/wipe', { confirm: 'wipe', password: PASS }, userRow('boss'))).status, 400);
  assert.equal((await call('/api/system/wipe', { confirm: 'WIPE ALL DATA', password: 'wrong' }, userRow('boss'))).status, 403);
});

test('a data wipe clears records that reference each other, and leaves a usable company', async () => {
  await makeData();
  setSetting('COMPANY_NAME', 'Kept Co');
  const r = await call('/api/system/wipe', { confirm: 'WIPE ALL DATA', password: PASS }, userRow('boss'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.tablesCleared > 100);
  assert.deepEqual(r.json.seedFailures, []);
  for (const t of ['pf_orders', 'pf_positions', 'news_items', 'mkt_quotes', 'runs']) {
    assert.equal(one(`SELECT COUNT(*) AS n FROM ${t}`).n, 0, `${t} survived the wipe`);
  }
  // Usable again at once: the same seeds as a boot.
  assert.ok(one('SELECT COUNT(*) AS n FROM agents').n > 40);
  assert.ok(one("SELECT id FROM connectors WHERE id = 'marketdata'"), 'connectors were not re-seeded, so the gate would refuse everything');
  assert.ok(one('SELECT COUNT(*) AS n FROM mkt_watch').n > 0);
  // Identities and settings survive a data wipe.
  assert.ok(verifyPassword(userRow('clerk').id, PASS));
  assert.equal(getSetting('COMPANY_NAME'), 'Kept Co');
  // The chain restarts with who did it, and verifies.
  const genesis = one('SELECT * FROM audit_log ORDER BY seq LIMIT 1');
  assert.equal(genesis.action, 'system.wiped');
  assert.equal(genesis.actor_id, 'human:boss');
  assert.equal(verifyChain().ok, true);
  // And the append-only triggers are armed again.
  assert.throws(() => exec('DELETE FROM audit_log'), /append-only/);
});

test('a full reset removes every account but the person who did it, who signs in with the same password', async () => {
  await makeData();
  const r = await call('/api/system/wipe', { confirm: 'WIPE ALL DATA', password: PASS, full: true }, userRow('boss'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.keptLogin, true);
  assert.equal(one('SELECT COUNT(*) AS n FROM users').n, 1);
  const boss = userRow('boss');
  assert.equal(boss.role, 'superadmin');
  assert.ok(verifyPassword(boss.id, PASS), 'locked out of their own server');
  assert.equal(getSetting('COMPANY_NAME'), null);
  assert.equal(verifyChain().ok, true);
  fs.rmSync(path.join(root, 'data', 'test-wipe-memory'), { recursive: true, force: true });
});
