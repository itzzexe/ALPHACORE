// The desk, and handing its decisions to the AI.
//
// What is tested is what this code decides: that the desk shows every kind of
// waiting item (and the held egress calls it used to miss), that a person can
// decide from it only with the right permission, that a group is one act on
// the chain, and that the AI decides only inside the categories, confidence
// floor and daily cap the owner set — and is never offered a real-money order.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-desk.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-desk-memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 29).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-desk.db${suffix}`)); } catch { /* first run */ }
}

const { one, q, exec, uuid } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { verifyChain } = await import('../src/audit.js');
const desk = await import('../src/approvals.js');
const autonomy = await import('../src/autonomy.js');
const markets = await import('../src/markets.js');
const portfolio = await import('../src/portfolio.js');

seedAgents();
seedConnectors();
markets.seedWatchlist({ actor: 'human:owner' });
await markets.refreshQuotes({ actor: 'human:owner' });

const OWNER = { id: 1, username: 'owner', perms: ['*'] };
const CLERK = { id: 2, username: 'clerk', perms: ['gate.resolve'] };

function heldRun() {
  const id = uuid();
  exec("INSERT INTO runs (id, agent_id, task_type, state, failure_reason) VALUES (?, 'AGT-DOC-001', 'docs:test', 'awaiting_human', 'confidence 0.4 below floor 0.6')", id);
  return id;
}

test('the desk shows every kind waiting — including the held egress calls it used to miss', () => {
  heldRun();
  portfolio.propose({ symbol: 'AAPL', side: 'buy', qty: 1, actor: 'agent:AGT-INV-001' });
  exec("INSERT INTO egress_log (connector, capability, verdict, target, payload) VALUES ('gmail', 'mail.send', 'gated', 'someone@example.com', '{}')");
  const d = desk.waiting({ forUser: OWNER });
  const kinds = new Set(d.items.map((i) => i.kind));
  for (const k of ['run', 'paperOrder', 'egress']) assert.ok(kinds.has(k), `${k} is missing from the desk`);
  const egress = d.items.find((i) => i.kind === 'egress');
  assert.equal(egress.alwaysHuman, true);
  assert.equal(egress.decidable, false);
  assert.equal(d.items.find((i) => i.kind === 'paperOrder').category, 'trading');
  assert.ok(d.byCategory.find((c) => c.id === 'trading').count >= 1);
});

test('a person decides from the desk only with the permission that kind needs', () => {
  const order = one("SELECT id FROM pf_orders WHERE state = 'proposed'");
  assert.throws(() => desk.decideFromDesk({ kind: 'paperOrder', ids: [order.id], verdict: 'approve', user: CLERK }), /portfolio.approve/);
  assert.throws(() => desk.decideFromDesk({ kind: 'egress', ids: ['1'], verdict: 'approve', user: OWNER }), /by a person, on purpose/);
  const run = heldRun();
  const r = desk.decideFromDesk({ kind: 'run', ids: [run], verdict: 'approve', user: CLERK });
  assert.equal(r.decided, 1);
  assert.notEqual(one('SELECT state FROM runs WHERE id = ?', run).state, 'awaiting_human');
});

test('a group decided together is one act on the chain naming every item', () => {
  const ids = [heldRun(), heldRun(), heldRun()];
  const before = q("SELECT seq FROM audit_log WHERE action = 'approvals.batch'").length;
  const r = desk.decideFromDesk({ kind: 'run', ids, verdict: 'reject', user: OWNER });
  assert.equal(r.decided, 3);
  const batches = q("SELECT payload FROM audit_log WHERE action = 'approvals.batch'");
  assert.equal(batches.length, before + 1);
  assert.deepEqual(JSON.parse(batches.at(-1).payload).ids.sort(), [...ids].sort());
});

test('only the owner sets what the AI may decide', () => {
  assert.throws(() => autonomy.setPolicy({ scope: ['trading'], actor: 'system:autonomy' }), /owner/);
  const p = autonomy.setPolicy({ scope: ['trading', 'nonsense'], minConfidence: 0.7, maxPerDay: 10, actor: 'human:owner' });
  assert.deepEqual(p.scope, ['trading']);
});

/** A finished executive run carrying the verdicts we want it to have returned. */
function executiveAnswer(decisions) {
  const runId = uuid();
  exec("INSERT INTO runs (id, agent_id, task_type, state, output) VALUES (?, 'AGT-EXE-001', 'autonomy:batch', 'done', ?)",
    runId, JSON.stringify({ parsed: { decisions } }));
  return runId;
}

test('the AI is offered only the categories the owner allowed', async () => {
  autonomy.setAutonomy('full', 'human:owner');
  heldRun();
  await autonomy.autonomyTick();
  const offered = q("SELECT DISTINCT kind FROM autonomy_log WHERE verdict = 'pending'").map((r) => r.kind);
  assert.deepEqual(offered, ['paperOrder'], `offered ${offered}`);
  exec("UPDATE autonomy_log SET verdict = 'hold', run_id = NULL WHERE verdict = 'pending'");
});

test('a verdict the AI was unsure of is held; a sure one is carried out, as the system', async () => {
  const order = one("SELECT id FROM pf_orders WHERE state = 'proposed'");
  const unsure = executiveAnswer([{ ref: `paperOrder:${order.id}`, verdict: 'approve', reason: 'looks fine', confidence: 0.3 }]);
  exec("INSERT INTO autonomy_log (kind, subject_id, title, verdict, run_id) VALUES ('paperOrder', ?, 'order', 'pending', ?)", String(order.id), unsure);
  await autonomy.autonomyTick();
  const held = one('SELECT verdict, outcome FROM autonomy_log WHERE run_id = ?', unsure);
  assert.equal(held.verdict, 'hold');
  assert.match(held.outcome, /under the floor/);
  assert.equal(one('SELECT state FROM pf_orders WHERE id = ?', order.id).state, 'proposed');

  const sure = executiveAnswer([{ ref: `paperOrder:${order.id}`, verdict: 'approve', reason: 'inside every limit', confidence: 0.9 }]);
  exec("INSERT INTO autonomy_log (kind, subject_id, title, verdict, run_id) VALUES ('paperOrder', ?, 'order', 'pending', ?)", String(order.id), sure);
  await autonomy.autonomyTick();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(one('SELECT state FROM pf_orders WHERE id = ?', order.id).state, 'filled');
  const approved = one("SELECT actor_type, actor_id FROM audit_log WHERE action = 'portfolio.approved' ORDER BY seq DESC LIMIT 1");
  assert.deepEqual([approved.actor_type, approved.actor_id], ['system', 'system:autonomy'], 'the AI’s decision was recorded as a person’s');
});

test('the daily limit stops the AI, and a real-money order is never offered or accepted', async () => {
  autonomy.setPolicy({ scope: Object.keys(autonomy.CATEGORIES), maxPerDay: 0, actor: 'human:owner' });
  exec("UPDATE autonomy_log SET verdict = 'hold' WHERE verdict = 'pending'");
  const pendingBefore = one("SELECT COUNT(*) AS n FROM autonomy_log WHERE verdict = 'pending'").n;
  await autonomy.autonomyTick();
  assert.equal(one("SELECT COUNT(*) AS n FROM autonomy_log WHERE verdict = 'pending'").n, pendingBefore, 'past the cap it still asked');

  exec("INSERT INTO pf_accounts (name, kind, connector, cash, start_cash, created_by) VALUES ('Broker', 'broker', 'broker', 100000, 100000, 'human:owner')");
  const acc = one("SELECT id FROM pf_accounts WHERE kind = 'broker'").id;
  exec("INSERT INTO pf_orders (account_id, symbol, side, qty, est_price, est_value, proposed_by, state, risk) VALUES (?, 'AAPL', 'buy', 1, 100, 100, 'human:owner', 'proposed', '{\"ok\":true,\"checks\":[]}')", acc);
  const broker = one("SELECT id FROM pf_orders WHERE account_id = ?", acc).id;
  assert.ok(desk.waiting({ forUser: OWNER }).items.find((i) => i.kind === 'brokerOrder' && i.alwaysHuman));
  autonomy.setPolicy({ maxPerDay: 40, actor: 'human:owner' });
  exec("UPDATE autonomy_log SET created_at = datetime('now','-3 hours')");
  await autonomy.autonomyTick();
  assert.equal(one("SELECT COUNT(*) AS n FROM autonomy_log WHERE kind = 'brokerOrder'").n, 0, 'the AI was offered a broker order');
  await assert.rejects(() => portfolio.approve({ id: broker, actor: 'system:autonomy' }), /only a person/);
  autonomy.setAutonomy('off', 'human:owner');
});

test('the chain verifies after all of it', () => {
  assert.equal(verifyChain().ok, true);
  fs.rmSync(path.join(root, 'data', 'test-desk-memory'), { recursive: true, force: true });
});
