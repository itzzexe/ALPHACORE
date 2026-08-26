// The bank, and the proofs it owes.
//
// An account is its own line in the one chart, so the balance on the screen is
// the ledger's — asserted by reading it back from journal_lines rather than
// from anything the bank module keeps. A statement is matched line by line and
// the unmatched remainder is shown. Money moves only when a person says so:
// opening an account, executing a transfer and releasing a batch all come
// back `gated` for an agent and refused in the module. A payroll batch names
// people and their bank details, so each line is sealed under them; and the
// person who builds a batch may not approve it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-bank.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 47).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-bank.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { seedChart } = await import('../src/ledger.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { seedBridge, command, callTool, CONNECTOR } = await import('../src/core2/bridge.js');
const { draftPayroll, approvePayrollRun, closePayrollRun } = await import('../src/core2/payops.js');
const F = await import('../src/core2/finance.js');
const B = await import('../src/core2/bank.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;
grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.draft_transfer', actor: 'human:test' });
exec("INSERT INTO vendors (id, name, service) VALUES ('acme', 'Acme Hosting', 'hosting')");
const p1 = createPerson({ displayName: 'Huda Rashid', personalEmail: 'huda@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', baseSalary: 3000, bankAccount: 'IQ12 3456 7890', actor: 'human:test' });
const today = new Date().toISOString().slice(0, 10);

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}
const entryFor = (sourceId) => one("SELECT * FROM journal WHERE source = 'core2' AND source_id = ?", sourceId);
const lineOn = (entry, code, side) => one('SELECT amount FROM journal_lines WHERE journal_id = ? AND account_code = ? AND side = ?', entry.id, code, side)?.amount;
const ledgerOf = (code) => one(`SELECT COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END), 0) AS n
  FROM journal_lines l JOIN journal j ON j.id = l.journal_id WHERE j.state = 'posted' AND l.account_code = ?`, code).n;

let main; let petty;

test('opening an account is human, and gives the account its own line in the one chart', async () => {
  assert.throws(() => B.createBankAccount({ name: 'Main', openingBalance: 1, actor: `agent:${AGENT}` }), /human act/);
  const r = await command('openBankAccount', { name: 'Main' }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'gated');

  main = B.createBankAccount({ name: 'Main operating', bank: 'TBI', openingBalance: 10000, iban: 'IQ98TBIA0000000000001234', actor: 'human:cfo' });
  assert.equal(main.gl_code, '1020');
  assert.equal(main.iban, 'IQ98…1234', 'the IBAN is masked on the way out');
  const acct = one('SELECT * FROM accounts WHERE code = ?', main.gl_code);
  assert.ok(acct, 'the chart has no line for this account');
  assert.equal(acct.parent_code, '1000');
  assert.equal(acct.created_at != null, true);
  await jobsTick();
  const open = entryFor(`bank-open-${main.id}`);
  assert.ok(open, 'the opening balance never reached the ledger');
  assert.equal(lineOn(open, '1020', 'debit'), 10000);
  assert.equal(lineOn(open, '3000', 'credit'), 10000);
  const pos = B.cashPosition().accounts.find((a) => a.id === main.id);
  assert.equal(pos.ledger, 10000, 'the balance on the screen is the ledger\'s');
  assert.equal(pos.ledger, ledgerOf('1020'));
});

test('a statement is matched line by line; what does not match is shown, not hidden', () => {
  B.importStatement({ accountId: main.id, label: 'Opening', lines: [{ day: today, amount: 10000, ref: 'OPENING' }, { day: today, amount: -77.7, ref: 'FEE' }], actor: 'human:clerk' });
  const auto = B.autoMatch(main.id, { actor: `agent:${AGENT}` });
  assert.equal(auto.matched, 1, 'the opening line has exactly one candidate');
  const rec = B.reconciliation(main.id);
  assert.equal(rec.unmatchedLines.length, 1);
  assert.equal(rec.unmatchedLines[0].ref, 'FEE');
  assert.equal(rec.difference, 77.7, 'ledger 10000 − statement 9922.30');
  const openJl = rec.openJournal;
  assert.equal(openJl.length, 0, 'the opening debit is claimed');
  assert.throws(() => B.matchLine(rec.unmatchedLines[0].id, { journalLineId: 1, actor: 'human:clerk' }), /not open|differ/);
  assert.throws(() => B.excludeLine(rec.unmatchedLines[0].id, { actor: `agent:${AGENT}` }), /human act/);
  B.excludeLine(rec.unmatchedLines[0].id, { actor: 'human:clerk' });
  assert.equal(B.reconciliation(main.id).unmatchedLines.length, 0);
  assert.equal(B.cashPosition().accounts.find((a) => a.id === main.id).difference, 0);
});

test('a transfer is drafted by a machine and executed only by a person; the fee is a charge', async () => {
  petty = B.createBankAccount({ name: 'Petty cash', kind: 'cashbox', actor: 'human:cfo' });
  assert.equal(petty.gl_code, '1021');
  const drafted = await callTool('draft_transfer', { fromAccountId: main.id, toAccountId: petty.id, amount: 500, fee: 5 }, { agentId: AGENT, actor: 'agent' });
  assert.equal(drafted.verdict, 'allowed');
  const t = drafted.result;
  assert.throws(() => B.executeTransfer(t.id, { actor: 'human:cfo' }), /only an approved/);
  assert.throws(() => B.approveTransfer(t.id, { actor: `agent:${AGENT}` }), /human act/);
  B.approveTransfer(t.id, { actor: 'human:cfo' });
  for (const opts of [{}, { force: true }, { valueUsd: 0 }]) {
    const r = await command('executeTransfer', { id: t.id, ...opts }, { agentId: AGENT, actor: 'agent', ...opts });
    assert.equal(r.verdict, 'gated');
  }
  assert.throws(() => B.executeTransfer(t.id, { actor: `agent:${AGENT}` }), /human act/);
  B.executeTransfer(t.id, { actor: 'human:treasurer' });
  await jobsTick();
  const e = entryFor(`xfer-${t.id}`);
  assert.ok(e);
  assert.equal(lineOn(e, '1021', 'debit'), 500);
  assert.equal(lineOn(e, '5500', 'debit'), 5);
  assert.equal(lineOn(e, '1020', 'credit'), 505);
  const pos = B.cashPosition();
  assert.equal(pos.accounts.find((a) => a.id === main.id).ledger, 9495);
  assert.equal(pos.accounts.find((a) => a.id === petty.id).ledger, 500);

  // Outward: a beneficiary and a purpose account.
  const out = B.createTransfer({ fromAccountId: main.id, beneficiary: 'Landlord', purposeCode: '5900', amount: 100, actor: 'human:clerk' });
  B.approveTransfer(out.id, { actor: 'human:cfo' });
  B.executeTransfer(out.id, { actor: 'human:cfo' });
  await jobsTick();
  const oe = entryFor(`xfer-${out.id}`);
  assert.equal(lineOn(oe, '5900', 'debit'), 100);
  assert.equal(lineOn(oe, '1020', 'credit'), 100);
});

test('a cheque against a bill pays the bill when it clears — once, from this account', async () => {
  const bill = F.createBill({ vendorId: 'acme', ref: 'INV-9', amount: 300, actor: 'human:clerk' });
  F.approveBill(bill.id, { actor: 'human:cfo' });
  const c = B.issueCheque({ accountId: main.id, number: '000101', payee: 'Acme', amount: 300, billId: bill.id, actor: 'human:clerk' });
  assert.throws(() => B.setChequeState(c.id, { state: 'cleared', actor: 'human:cfo' }), /cannot become/);
  assert.throws(() => B.setChequeState(c.id, { state: 'issued', actor: `agent:${AGENT}` }), /human act/);
  B.setChequeState(c.id, { state: 'issued', actor: 'human:cfo' });
  B.setChequeState(c.id, { state: 'presented', actor: `agent:${AGENT}` });
  B.setChequeState(c.id, { state: 'cleared', actor: 'human:cfo' });
  await jobsTick();
  assert.equal(F.getBill(bill.id).state, 'paid');
  const paid = q("SELECT * FROM journal WHERE source = 'core2' AND source_id = ?", `bill-paid-${bill.id}`);
  assert.equal(paid.length, 1);
  assert.equal(lineOn(paid[0], '1020', 'credit'), 300, 'paid from the cheque\'s account, not the parent');
  assert.throws(() => B.issueCheque({ accountId: petty.id, number: '1', payee: 'x', amount: 1, actor: 'human:clerk' }), /no cheque book/);
});

test('payroll leaves as a batch: sealed lines, four eyes, and cash placed in the account it left', async () => {
  const period = today.slice(0, 7);
  const run = draftPayroll({ period, actor: 'human:payroll' });
  approvePayrollRun(run.id, { actor: 'human:cfo' });
  closePayrollRun(run.id, { actor: 'human:cfo' });
  await jobsTick();

  assert.throws(() => B.buildPayrollBatch({ runId: run.id, accountId: main.id, actor: `agent:${AGENT}` }), /human act/);
  const batch = B.buildPayrollBatch({ runId: run.id, accountId: main.id, actor: 'human:clerk' });
  assert.equal(batch.count, 1);
  assert.equal(batch.total, 3000);
  assert.match(batch.items[0].beneficiary, /Huda Rashid · IQ12 3456 7890/, 'opened for the permission-checked route');
  assert.match(one('SELECT beneficiary FROM bank_payment_item WHERE batch_id = ?', batch.id).beneficiary, /^pii:1:/);
  assert.ok(!diskContains('IQ12 3456 7890'), 'a bank detail is readable on disk');
  assert.throws(() => B.buildPayrollBatch({ runId: run.id, accountId: main.id, actor: 'human:clerk' }), /already has a batch/);

  assert.throws(() => B.approveBatch(batch.id, { actor: 'human:clerk' }), /four eyes/);
  B.approveBatch(batch.id, { actor: 'human:cfo' });
  const r = await command('releasePayments', { id: batch.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'gated');
  assert.throws(() => B.releaseBatch(batch.id, { actor: `agent:${AGENT}` }), /human act/);
  const before = B.cashPosition().accounts.find((a) => a.id === main.id).ledger;
  B.releaseBatch(batch.id, { actor: 'human:treasurer' });
  await jobsTick();
  const e = entryFor(`batch-${batch.id}`);
  assert.ok(e, 'the release never reached the ledger');
  assert.equal(lineOn(e, '1000', 'debit'), 3000, 'the close spent from the parent; the release places it');
  assert.equal(lineOn(e, '1020', 'credit'), 3000);
  assert.equal(B.cashPosition().accounts.find((a) => a.id === main.id).ledger, before - 3000);
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'batch.released'"), 'a release is chained');
});

test('an account with money in it cannot be closed', () => {
  assert.throws(() => B.closeBankAccount(petty.id, { actor: 'human:cfo' }), /cannot be closed/);
});
