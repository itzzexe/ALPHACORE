// The finance sub-ledgers, and the one law they answer to: the ledger is
// Core 1's. A budget is measured against the posted journal rather than a
// figure kept here; a bill approved and a bill paid are two balanced entries
// posted by the bridge; an invoice issued is revenue owed and a receipt moves
// it to cash; depreciation posts once per asset per month and a write-off
// books the loss. And every one of those entries carries a source id, so a
// retried event cannot post twice.
//
// The human line: a machine may draft any of it. Adopting a budget, paying a
// bill, recording a receipt and writing off an asset wait for a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-finance.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 43).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-finance.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { seedChart, journalEntry } = await import('../src/ledger.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { seedBridge, command, callTool, emit, CONNECTOR } = await import('../src/core2/bridge.js');
const F = await import('../src/core2/finance.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;
exec("INSERT INTO vendors (id, name, service) VALUES ('acme', 'Acme Hosting', 'hosting')");
exec("INSERT INTO customers (name, company) VALUES ('Globex', 'Globex Corp')");
const CUSTOMER = one('SELECT id FROM customers').id;

const lines = (entry) => q('SELECT * FROM journal_lines WHERE journal_id = ?', entry.id);
const balanced = (entry) => {
  const ls = lines(entry);
  const d = ls.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
  const c = ls.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
  return Math.abs(d - c) < 0.005;
};
const entryFor = (sourceId) => one("SELECT * FROM journal WHERE source = 'core2' AND source_id = ?", sourceId);
const amountOn = (entry, code, side) => lines(entry).find((l) => l.account_code === code && l.side === side)?.amount;

// --- budgets --------------------------------------------------------------------------

test('a budget is drafted by anybody, adopted by a person, and measured from the journal', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.draft_budget', actor: 'human:test' });
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
  const drafted = await callTool('draft_budget', { name: 'Software', period: '2026', lines: [{ accountCode: '5100', amount: 1000 }] }, { agentId: AGENT, actor: 'agent' });
  assert.equal(drafted.verdict, 'allowed');
  const id = drafted.result.id;
  assert.throws(() => F.createBudget({ period: '2026', lines: [{ accountCode: '9999', amount: 1 }], actor: 'human:test' }), /no such account/);

  for (const opts of [{}, { force: true }, { valueUsd: 0 }]) {
    const r = await command('approveBudget', { id, ...opts }, { agentId: AGENT, actor: 'agent', ...opts });
    assert.equal(r.verdict, 'gated');
  }
  assert.throws(() => F.approveBudget(id, { actor: `agent:${AGENT}` }), /human act/);
  F.approveBudget(id, { actor: 'human:cfo' });
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'budget.approved'"), 'adoption is chained');

  // An actual arrives in the ledger the ordinary way; the variance reads it.
  journalEntry({ date: '2026-06-01', memo: 'Hosting', lines: [{ account: '5100', debit: 250 }, { account: '1000', credit: 250 }], actor: 'human:bookkeeper', post: true });
  const v = F.budgetVariance(id);
  assert.equal(v.lines[0].actual, 250);
  assert.equal(v.lines[0].variance, 750);
  assert.equal(v.actual, 250);
});

// --- payables ----------------------------------------------------------------------

test('a bill approved is a debt and a bill paid clears it — two entries, each once, paying human', async () => {
  const bill = F.createBill({ vendorId: 'acme', ref: 'INV-77', amount: 400, tax: 40, actor: `agent:${AGENT}` });
  assert.throws(() => F.createBill({ vendorId: 'nobody', amount: 1, actor: 'human:test' }), /no such vendor/);
  F.approveBill(bill.id, { actor: 'human:cfo' });
  await jobsTick();
  const appr = entryFor(`bill-appr-${bill.id}`);
  assert.ok(appr && balanced(appr));
  assert.equal(amountOn(appr, '5100', 'debit'), 400);
  assert.equal(amountOn(appr, '2200', 'debit'), 40);
  assert.equal(amountOn(appr, '2000', 'credit'), 440);
  assert.equal(F.apAging().total, 440);

  assert.throws(() => F.payBill(bill.id, { actor: `agent:${AGENT}` }), /human act/);
  const r = await command('payBill', { id: bill.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'gated');
  F.payBill(bill.id, { actor: 'human:cfo' });
  await jobsTick();
  const paid = entryFor(`bill-paid-${bill.id}`);
  assert.ok(paid && balanced(paid));
  assert.equal(amountOn(paid, '2000', 'debit'), 440);
  assert.equal(amountOn(paid, '1000', 'credit'), 440);
  assert.equal(F.apAging().total, 0);

  emit('bill.paid', { id: bill.id, total: 440, glCode: '1000' });
  await jobsTick();
  assert.equal(one("SELECT COUNT(*) AS n FROM journal WHERE source_id = ?", `bill-paid-${bill.id}`).n, 1, 'a retried event paid the bill twice');
});

// --- receivables -----------------------------------------------------------------------

test('an invoice issued is revenue owed; receipts move it to cash and cannot exceed what is owed', async () => {
  const inv = F.createInvoice({ customerId: CUSTOMER, description: 'Services, August', amount: 1000, tax: 100, actor: `agent:${AGENT}` });
  assert.equal(inv.ref, 'AR-2026-0001');
  assert.throws(() => F.recordReceipt(inv.id, { amount: 100, actor: 'human:cfo' }), /only an issued invoice/);
  F.issueInvoice(inv.id, { actor: `agent:${AGENT}` });
  await jobsTick();
  const issued = entryFor(`ar-issued-${inv.id}`);
  assert.ok(issued && balanced(issued));
  assert.equal(amountOn(issued, '1100', 'debit'), 1100);
  assert.equal(amountOn(issued, '4000', 'credit'), 1000);
  assert.equal(amountOn(issued, '2200', 'credit'), 100);

  assert.throws(() => F.recordReceipt(inv.id, { amount: 500, actor: `agent:${AGENT}` }), /human act/);
  F.recordReceipt(inv.id, { amount: 500, actor: 'human:cfo' });
  assert.equal(F.getInvoice(inv.id).state, 'issued', 'a partial receipt keeps it open');
  assert.throws(() => F.recordReceipt(inv.id, { amount: 700, actor: 'human:cfo' }), /only 600 is outstanding/);
  F.recordReceipt(inv.id, { amount: 600, actor: 'human:cfo' });
  assert.equal(F.getInvoice(inv.id).state, 'paid');
  await jobsTick();
  const receipts = q("SELECT * FROM journal WHERE source = 'core2' AND source_id LIKE 'ar-rcpt-%'");
  assert.equal(receipts.length, 2);
  for (const r of receipts) assert.ok(balanced(r));
  assert.equal(F.arAging().total, 0);
});

// --- fixed assets -----------------------------------------------------------------------

test('depreciation posts once per asset per month; a write-off books the loss and is human', async () => {
  const a = F.registerFixedAsset({ name: 'Rack', cost: 1200, salvage: 0, lifeMonths: 12, acquired: '2026-01-15', actor: `agent:${AGENT}` });
  await jobsTick();
  const acq = entryFor(`fa-acq-${a.id}`);
  assert.ok(acq && balanced(acq));
  assert.equal(amountOn(acq, '1500', 'debit'), 1200);

  const first = F.runDepreciation({ period: '2026-02', actor: `agent:${AGENT}` });
  assert.equal(first.total, 100);
  const again = F.runDepreciation({ period: '2026-02', actor: `agent:${AGENT}` });
  assert.equal(again.assets, 0, 'a month is never depreciated twice');
  F.runDepreciation({ period: '2026-03', actor: `agent:${AGENT}` });
  await jobsTick();
  assert.equal(q("SELECT id FROM journal WHERE source = 'core2' AND source_id LIKE 'dep-2026-02-%'").length, 1);
  assert.equal(F.getFixedAsset(a.id).accumulated, 200);
  assert.equal(F.getFixedAsset(a.id).bookValue, 1000);

  assert.throws(() => F.disposeAsset(a.id, { actor: `agent:${AGENT}` }), /human act/);
  const r = await command('disposeAsset', { id: a.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'gated');
  F.disposeAsset(a.id, { actor: 'human:cfo' });
  await jobsTick();
  const disp = entryFor(`fa-disp-${a.id}`);
  assert.ok(disp && balanced(disp));
  assert.equal(amountOn(disp, '1510', 'debit'), 200);
  assert.equal(amountOn(disp, '5900', 'debit'), 1000);
  assert.equal(amountOn(disp, '1500', 'credit'), 1200);
});

// --- FX ---------------------------------------------------------------------------------------

test('a rate converts on or before its day, and refuses to guess before it', () => {
  F.setFxRate({ currency: 'IQD', rateToUsd: 0.00076, day: '2026-08-01', actor: 'human:test' });
  assert.equal(F.convertToUsd(1_000_000, 'IQD', '2026-08-15'), 760);
  assert.equal(F.convertToUsd(50, 'USD'), 50);
  assert.throws(() => F.convertToUsd(1, 'IQD', '2026-07-01'), /no IQD rate/);
});

test('the statements were not duplicated: Core 2 has no ledger of its own', () => {
  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
  for (const twin of ['fin_journal', 'fin_ledger', 'fin_account', 'core2_journal']) assert.ok(!tables.includes(twin), `${twin} is a second ledger`);
  const src = fs.readFileSync(path.join(root, 'src', 'core2', 'finance.js'), 'utf8');
  assert.ok(!src.includes("from '../ledger.js'"), 'finance.js imports the ledger — that is the second ledger wearing a disguise');
});
