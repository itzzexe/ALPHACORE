// Money, and the two laws it answers to.
//
// One ledger: Core 2 emits events, and the bridge posts through the same
// journalEntry() an accountant uses. The test asserts the entry exists, is
// balanced, and was posted by the bridge — and that a retried event cannot
// post it twice, because a double-posted payroll is a real accounting incident
// and queues retry by design.
//
// One kind of act a machine never completes: an agent may draft a payroll run
// — arithmetic is what agents are for — and approving it comes back `gated`
// with a scope, with force, and at zero dollars, while the module refuses any
// non-human actor as the second lock on the same door.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-money.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 37).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-money.db');
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
const { createPolicy, requestLeave, decideLeave } = await import('../src/core2/time.js');
const { seedBridge, callTool, command, CONNECTOR } = await import('../src/core2/bridge.js');
const {
  createCostCenter, submitExpense, decideExpense, payExpense, createLoan,
  draftPayroll, approvePayrollRun, closePayrollRun, getRun, payopsOverview,
} = await import('../src/core2/payops.js');
const {
  createProcurement, advanceProcurement, contractExpirySweep, listExpiring,
} = await import('../src/core2/procure.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;

const p1 = createPerson({ displayName: 'Huda Rashid', personalEmail: 'huda@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', baseSalary: 3000, actor: 'human:test' });
const p2 = createPerson({ displayName: 'Sami Waleed', personalEmail: 'sami@example.test', actor: 'human:test' });
const e2 = employ({ personId: p2.id, employeeNo: 'E002', baseSalary: 1500, actor: 'human:test' });

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}

// --- the payroll engine, against the directive's formula --------------------

test('the formula: base − absences − loans = net, with the named zeros in place', () => {
  // Sami takes 3 days unpaid this period and repays a loan at 100/month.
  const unpaid = createPolicy({ name: 'Unpaid', leaveType: 'unpaid', actor: 'human:test' });
  const period = '2026-08';
  requestLeave({ employeeId: e2.id, policyId: unpaid.id, starts: '2026-08-10', ends: '2026-08-12', actor: 'human:test' });
  decideLeave(one('SELECT id FROM time_leave_request ORDER BY id DESC LIMIT 1').id, { approve: true, actor: 'human:manager' });
  createLoan({ employeeId: e2.id, principal: 300, monthly: 100, actor: 'human:test' });

  const run = draftPayroll({ period, actor: 'human:test' });
  const sami = run.slips.find((s) => s.employee_id === e2.id).detail;
  assert.equal(sami.base, 1500);
  assert.equal(sami.absences, 150);           // 3 days × (1500/30)
  assert.equal(sami.loans, 100);
  assert.equal(sami.net, 1250);               // 1500 − 150 − 100
  // The named zeros: the slip's shape is the formula's shape from day one.
  for (const k of ['allowances', 'overtime', 'bonuses', 'commissions', 'deductions', 'penalties', 'taxes', 'contributions']) {
    assert.ok(k in sami, `${k} is missing from the slip`);
  }
  const huda = run.slips.find((s) => s.employee_id === e1.id).detail;
  assert.equal(huda.net, 3000);
  assert.equal(run.total_net, 4250);
});

test('a slip is sealed on disk; the run total is readable because the ledger will print it anyway', () => {
  assert.ok(!diskContains('"net":1250'), 'a slip is readable in the raw file');
  assert.ok(!diskContains('"base":1500'), 'a slip is readable in the raw file');
  const raw = one('SELECT detail FROM pay_slip LIMIT 1').detail;
  assert.match(raw, /^pii:1:/);
  assert.equal(one('SELECT total_net FROM pay_run LIMIT 1').total_net, 4250);
});

test('an agent may draft payroll and may never approve it', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.draft_payroll', actor: 'human:test' });
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });

  // Drafting through the gate: allowed, and recomputing is safe.
  const draft = await callTool('draft_payroll', { period: '2026-08' }, { agentId: AGENT, actor: 'agent' });
  assert.equal(draft.verdict, 'allowed');
  assert.equal(draft.result.state, 'draft');

  // Approving: gated with the scope, gated with force, gated at zero value.
  for (const opts of [{}, { force: true }, { valueUsd: 0 }]) {
    const r = await command('approvePayroll', { runId: draft.result.id, ...opts }, { agentId: AGENT, actor: 'agent', ...opts });
    assert.equal(r.verdict, 'gated', `approvePayroll cleared with ${JSON.stringify(opts)}`);
  }
  // And the module is the second lock on the same door.
  assert.throws(() => approvePayrollRun(draft.result.id, { actor: `agent:${AGENT}` }), /human act, always/);
});

test('close posts one balanced entry through Core 1\'s ledger — and never twice', async () => {
  const run = one("SELECT id FROM pay_run WHERE period = '2026-08'");
  approvePayrollRun(run.id, { actor: 'human:cfo' });
  closePayrollRun(run.id, { actor: 'human:cfo' });
  await jobsTick();

  const entry = one("SELECT * FROM journal WHERE source = 'core2' AND source_id = ?", `payroll-${run.id}`);
  assert.ok(entry, 'the close never reached the ledger');
  assert.equal(entry.created_by, 'system:core2-bridge', 'posted by the bridge, not by Core 2');
  const lines = q('SELECT * FROM journal_lines WHERE journal_id = ?', entry.id);
  const debits = lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
  const credits = lines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
  assert.equal(Math.round(debits * 100), Math.round(credits * 100), 'the payroll entry does not balance');
  assert.equal(Math.round(debits * 100), 450000, 'gross must be the debit: 4500.00');

  // Queues retry by design; a double-posted payroll is an incident. Re-emit.
  const { emit } = await import('../src/core2/bridge.js');
  emit('payroll.closed', { id: run.id, period: '2026-08', totalGross: 4500, totalNet: 4250 });
  await jobsTick();
  assert.equal(
    one("SELECT COUNT(*) AS n FROM journal WHERE source = 'core2' AND source_id = ?", `payroll-${run.id}`).n, 1,
    'a retried event posted the payroll twice',
  );

  // The loan fell by the deduction the slip carried.
  assert.equal(one('SELECT balance FROM pay_loan LIMIT 1').balance, 200);
});

// --- expenses: routine money keeps Core 1's ordinary ceiling ----------------

test('a small expense clears an agent scope; a large one waits for a person', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.create_expense', actor: 'human:test' });
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.approve_expense', actor: 'human:test' });

  const small = submitExpense({ employeeId: e1.id, amount: 30, category: 'travel', actor: 'human:test' });
  const ok = await callTool('approve_expense', { id: small.id, valueUsd: 30 }, { agentId: AGENT, actor: 'agent' });
  assert.equal(ok.verdict, 'allowed', 'routine money is Core 1\'s existing pattern');

  const big = submitExpense({ employeeId: e1.id, amount: 900, category: 'hardware', actor: 'human:test' });
  const held = await callTool('approve_expense', { id: big.id, valueUsd: 900 }, { agentId: AGENT, actor: 'agent' });
  assert.equal(held.verdict, 'gated', 'a large expense must wait for a person');

  // Paying out is human, and payment is what reaches the ledger.
  decideExpense(big.id, { approve: true, actor: 'human:cfo' });
  assert.throws(() => payExpense(big.id, { actor: `agent:${AGENT}` }), /human act/);
  payExpense(big.id, { actor: 'human:cfo' });
  await jobsTick();
  const entry = one("SELECT id FROM journal WHERE source = 'core2' AND source_id = ?", `expense-${big.id}`);
  assert.ok(entry, 'a paid expense never reached the ledger');
});

// --- procurement: the chain refuses to skip ---------------------------------

test('the chain cannot skip a step, and money steps refuse a machine', async () => {
  const cc = createCostCenter({ name: 'Operations', code: 'OPS', budgetUsd: 10000, actor: 'human:test' });
  const pr = createProcurement({ title: 'Laptops', amount: 2400, costCenterId: cc.id, actor: 'human:test' });

  assert.throws(() => advanceProcurement(pr.id, { to: 'paid', actor: 'human:test' }), /cannot go from requested to paid/);
  assert.throws(() => advanceProcurement(pr.id, { to: 'approved', actor: `agent:${AGENT}` }), /human act/);

  advanceProcurement(pr.id, { to: 'approved', actor: 'human:cfo' });
  const po = advanceProcurement(pr.id, { to: 'po', actor: `agent:${AGENT}` });   // goods, not money
  assert.equal(po.po_no, `PO-${String(pr.id).padStart(5, '0')}`);
  advanceProcurement(pr.id, { to: 'delivered', actor: `agent:${AGENT}` });
  advanceProcurement(pr.id, { to: 'invoiced', actor: `agent:${AGENT}` });
  assert.throws(() => advanceProcurement(pr.id, { to: 'paid', actor: `agent:${AGENT}` }), /human act/);
  advanceProcurement(pr.id, { to: 'paid', actor: 'human:cfo' });

  await jobsTick();
  // Invoice raised the payable; payment cleared it. Two entries, both balanced.
  for (const sid of [`proc-inv-${pr.id}`, `proc-pay-${pr.id}`]) {
    const j = one("SELECT id FROM journal WHERE source = 'core2' AND source_id = ?", sid);
    assert.ok(j, `${sid} never reached the ledger`);
  }
  const spent = q('SELECT * FROM fin_cost_center').length && (await import('../src/core2/payops.js')).costCenters()[0].spent;
  assert.ok(spent >= 2400, 'the cost center did not see the spend');
});

// --- the contract watch ------------------------------------------------------

test('an expiring contract is announced once, before it lapses', async () => {
  exec(`INSERT INTO contracts (kind, title, counterparty, state, signed_by, signed_at, expires_at)
        VALUES ('contract', 'Hosting agreement', 'Hostinger', 'signed', 'human:test', datetime('now'), date('now', '+10 days'))`);
  const swept = contractExpirySweep({ horizonDays: 30 });
  assert.equal(swept.watched, 1);
  await jobsTick();
  const notif = one("SELECT message FROM notifications WHERE source = 'core2' ORDER BY id DESC LIMIT 1");
  assert.match(notif.message, /contract expires/i);

  // Sweeping again announces nothing new — idempotent by queue key.
  const jobs = one("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'core2.event'").n;
  contractExpirySweep({ horizonDays: 30 });
  assert.equal(one("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'core2.event'").n, jobs, 'the sweep re-announced the same expiry');
  assert.equal(listExpiring({ horizonDays: 30 }).length, 1);
});

test('the overview says what is true', () => {
  const o = payopsOverview();
  assert.ok(o.runs.length >= 1);
  assert.match(o.note, /never approve/);
});
