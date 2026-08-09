// Does the workforce earn its keep — checked on a month that actually happened.
//
// The dangerous failure here is not a wrong division. It is a number that looks
// like proof and is not: attributing a whole invoice to the agent that drafted
// the proposal, calling it ROI, and letting somebody fire an employee over it.
//
// So these tests check the arithmetic, and then check the honesty — that cost is
// exact, that revenue is labelled as *touched* rather than earned, that the file
// says so in words, and that a month with no spend says "nothing to judge yet"
// rather than dividing by zero and printing infinity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-economics.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-economics.db${s}`)); } catch { /* first run */ }
}

const { exec, one } = await import('../src/db.js');
const { seedChart, journalEntry } = await import('../src/ledger.js');
const E = await import('../src/economics.js');

const HUMAN = 'human:owner';
seedChart();

test('with nothing spent it says there is nothing to judge, rather than dividing by zero', () => {
  // A month nothing happened in. Asserted against an explicit empty period
  // rather than against "before the fixtures load" — module-level inserts run
  // before every test, so ordering would have made this pass by accident.
  const u = E.unitEconomics({ month: '2019-01' });
  assert.equal(u.spendUsd, 0);
  assert.equal(u.coverage, null, 'no ratio out of an empty month');
  assert.match(u.says, /nothing to judge/i);
  for (const k of ['costPerRun', 'costPerDelivered', 'costPerTicket', 'costPerDealWon']) {
    assert.equal(u[k], null, `${k} must be null, not Infinity or NaN`);
  }
});

// ---- a month: two employees, three runs, one of them wasted, one deal paid ----
exec("INSERT INTO agents (id,name,role_group,version,spec,model_tier,status,human_owner) VALUES ('AGT-SAL-001','Closer','sales',1,'{}','T2','active',?)", HUMAN);
exec("INSERT INTO agents (id,name,role_group,version,spec,model_tier,status,human_owner) VALUES ('AGT-SUP-001','Support','support',1,'{}','T1','active',?)", HUMAN);
exec("INSERT INTO agents (id,name,role_group,version,spec,model_tier,status,human_owner) VALUES ('AGT-IDL-001','Idle','ops',1,'{}','T1','active',?)", HUMAN);
exec("INSERT INTO runs (id,agent_id,task_type,state,cost_usd,tokens_in,tokens_out) VALUES ('R1','AGT-SAL-001','draft','done',12.40,900,400)");
exec("INSERT INTO runs (id,agent_id,task_type,state,cost_usd) VALUES ('R2','AGT-SAL-001','draft','failed',3.10)");
exec("INSERT INTO runs (id,agent_id,task_type,state,cost_usd) VALUES ('R3','AGT-SUP-001','reply','done',0.80)");
for (const [r, m, c] of [['R1', 'opus', 12.40], ['R2', 'opus', 3.10], ['R3', 'haiku', 0.80]]) {
  exec("INSERT INTO model_calls (run_id,provider,model,cost_usd) VALUES (?,'anthropic',?,?)", r, m, c);
}
const CID = Number(exec("INSERT INTO customers (name,company,plan,mrr_usd,state) VALUES ('Northwind','Northwind Traders','pro',900,'active')").lastInsertRowid);
const DID = Number(exec(
  "INSERT INTO deals (name,customer_id,value_usd,stage,owner,draft_run_id,closed_at) VALUES ('Retainer',?,14000,'won',?,'R1',datetime('now'))",
  CID, HUMAN,
).lastInsertRowid);
const WID = Number(exec("INSERT INTO wallets (label,chain,asset,address,created_by) VALUES ('Ops','base','USDC','0xd',?)", HUMAN).lastInsertRowid);
exec(
  `INSERT INTO invoices (ref,wallet_id,customer_id,deal_id,description,amount,asset,chain,state,paid_amount,paid_at,created_by)
   VALUES ('INV-1',?,?,?,'Retainer',14000,'USDC','base','paid',14000,datetime('now'),?)`, WID, CID, DID, HUMAN,
);
exec("INSERT INTO tickets (customer,category,subject,body,state,draft_run_id) VALUES ('Northwind','billing','Question','?','sent','R3')");

test('the cost side is exact, per run, from the meter', () => {
  const u = E.unitEconomics({});
  assert.equal(u.spendUsd, 16.3, '12.40 + 3.10 + 0.80');
  assert.equal(u.runs, 3);
  assert.equal(u.delivered, 2);
  assert.equal(u.failed, 1);
  assert.equal(u.costPerRun, 5.4333);
  // Per *delivered* is the number that matters and is always worse than per
  // run, because the failures cost money and delivered nothing.
  assert.ok(u.costPerDelivered > u.costPerRun, 'a failure costs the same as a success');
  assert.equal(u.costPerDealWon, 16.3, 'one deal won this month');
});

test('what the failures cost is totalled, because otherwise nobody sees it', () => {
  const u = E.unitEconomics({});
  assert.equal(u.failureRate, 33.3);
  assert.ok(u.failureWasteUsd > 5 && u.failureWasteUsd < 6, `a third of 16.30: ${u.failureWasteUsd}`);
});

test('revenue attributed to an agent is revenue its work touched, and is labelled that way', () => {
  const agents = E.agentEconomics({});
  const closer = agents.find((a) => a.id === 'AGT-SAL-001');
  assert.equal(closer.cost, 15.5);
  assert.equal(closer.revenueTouched, 14000, 'the invoice behind the deal its run drafted');
  assert.equal(closer.invoicesTouched, 1);
  assert.ok('touchedPerDollar' in closer, 'the ratio exists');
  assert.ok(!('roi' in closer) && !('return' in closer), 'and is not called ROI, because it is not one');

  const support = agents.find((a) => a.id === 'AGT-SUP-001');
  assert.equal(support.revenueTouched, 0, 'answering a ticket did not produce an invoice');
  assert.equal(support.ticketsAnswered, 1, 'but the work it did do is counted');
});

test('an idle employee is counted as idle rather than buried in the list', () => {
  const o = E.economicsOverview({});
  assert.ok(o.idleAgents >= 1, 'the one that did nothing is counted');
  assert.ok(!o.agents.some((a) => a.id === 'AGT-IDL-001'), 'and kept off the list that matters');
  assert.ok(o.agents.some((a) => a.id === 'AGT-SAL-001'));
});

test('cost to serve a customer is real work traced to them, not an allocation', () => {
  const c = E.customerEconomics().find((x) => x.name === 'Northwind');
  assert.equal(c.paid, 14000);
  assert.equal(c.salesCost, 12.4, 'the run that drafted their deal');
  assert.equal(c.supportCost, 0.8, 'the run that drafted their ticket reply');
  assert.equal(c.costToServe, 13.2);
  assert.equal(c.netOfModelSpend, 13986.8);
});

test('an agent in two departments has its cost split, not counted twice', () => {
  exec("UPDATE agents SET departments = 'sales,marketing' WHERE id = 'AGT-SAL-001'");
  const depts = E.departmentEconomics({});
  const sales = depts.find((d) => d.dept === 'sales');
  const marketing = depts.find((d) => d.dept === 'marketing');
  assert.ok(sales && marketing, 'it appears in both');
  assert.equal(sales.cost, 7.75, 'half of 15.50');
  assert.equal(marketing.cost, 7.75);
  const total = depts.reduce((n, d) => n + d.cost, 0);
  assert.ok(Math.abs(total - 16.3) < 0.01, `the company still spent 16.30, not 31.80: ${total}`);
});

test('where the ledger and the operational tables disagree, it says so', () => {
  const before = E.unitEconomics({});
  assert.ok(before.fromLedger, 'the books are consulted');
  assert.equal(before.ledgerAgrees, false, 'nothing has been posted, so they do not agree yet');

  journalEntry({
    memo: 'Northwind retainer', source: 'invoice.issued', sourceId: 'INV-1', actor: HUMAN, post: true,
    lines: [{ account: '1000', debit: 14000 }, { account: '4000', credit: 14000 }],
  });
  const after = E.unitEconomics({});
  assert.equal(after.fromLedger.revenue, 14000);
  assert.equal(after.ledgerAgrees, true, 'once the entry exists, the two agree');
});

test('the file says out loud what the numbers do and do not mean', () => {
  const u = E.unitEconomics({});
  assert.match(u.honestly, /touched/i);
  assert.match(u.honestly, /not a claim/i, 'it refuses the causal claim in words, not only in field names');
  const src = fs.readFileSync(path.join(root, 'src', 'economics.js'), 'utf8');
  assert.match(src, /touched, not caused/i, 'and the same warning is where a developer will read it');
});

test('coverage is stated as a ratio and as a sentence, because a ratio alone gets misread', () => {
  const u = E.unitEconomics({});
  assert.ok(u.coverage > 800, `14000 collected against 16.30 spent: ${u.coverage}`);
  assert.match(u.says, /against/);
  assert.ok(u.says.length > 40, 'and in a sentence a person can quote');
});
