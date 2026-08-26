// HR, the rest of it — and the three things it must never do.
//
// It must never store a reason: overtime is minutes, a correction is a time
// pair, a grievance is a sealed document. It must never let a machine change
// what somebody is paid: changeSalary is gated categorically and refused in
// the module. And it must never let one person's money be readable on disk:
// the raise, the history and the end-of-service amount are sealed under them.
//
// The payroll formula is the other half: allowances, overtime, tax from the
// bracket table and contributions from the plans must land on the slip in
// the directive's order, and the totals the ledger will see must add up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-hrplus.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 41).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-hrplus.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { seedChart } = await import('../src/ledger.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { createAsset } = await import('../src/departments.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { seedBridge, command, CONNECTOR } = await import('../src/core2/bridge.js');
const { draftPayroll } = await import('../src/core2/payops.js');
const { terminateEmployee } = await import('../src/core2/talent.js');
const H = await import('../src/core2/hrplus.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;
const today = new Date().toISOString().slice(0, 10);
const period = today.slice(0, 7);

const p1 = createPerson({ displayName: 'Huda Rashid', personalEmail: 'huda@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', baseSalary: 3000, bankAccount: 'IQ12 3456 7890', actor: 'human:test' });
const p2 = createPerson({ displayName: 'Sami Waleed', personalEmail: 'sami@example.test', actor: 'human:test' });
const e2 = employ({ personId: p2.id, employeeNo: 'E002', baseSalary: 1500, actor: 'human:test' });

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}

// --- time rules ---------------------------------------------------------------

test('a shift is what lateness is measured against; a holiday is not an absence', () => {
  const shift = H.createShift({ name: 'Day', starts: '09:00', ends: '17:00', days: [0, 1, 2, 3, 4, 5, 6], actor: 'human:test' });
  H.assignShift({ employeeId: e1.id, shiftId: shift.id, actor: 'human:test' });
  assert.equal(H.shiftFor(e1.id, today)?.id, shift.id);

  // Huda walked in half an hour late today.
  exec("INSERT INTO time_attendance (employee_id, day, in_at) VALUES (?, ?, ?)", e1.id, today, `${today} 09:30:00`);
  const before = H.attendanceExceptions({ period });
  const huda = before.rows.find((r) => r.employeeId === e1.id);
  assert.equal(huda.lateDays, 1);
  assert.equal(huda.lateMinutes, 30);
  assert.equal(huda.absent, 0);

  // Sami has no mark today. Whether that is an absence depends on the calendar.
  H.addHoliday({ day: today, name: 'Test holiday', actor: 'human:test' });
  const after = H.attendanceExceptions({ period });
  assert.equal(after.rows.find((r) => r.employeeId === e2.id).absent, 0, 'a holiday is not an absence');
  assert.equal(after.rows.find((r) => r.employeeId === e1.id).lateDays, 0, 'nothing is measured on a holiday — coming in late to a day nobody was expected is not lateness');
});

test('there is no reason column anywhere in the time rules', () => {
  for (const table of ['time_overtime', 'time_correction', 'hr_grievance', 'hr_salary_change', 'hr_movement']) {
    const cols = q(`PRAGMA table_info(${table})`).map((c) => c.name);
    for (const bad of ['reason', 'note', 'notes', 'comment', 'diagnosis', 'body']) {
      assert.ok(!cols.includes(bad), `${table} has a ${bad} column — a reason has nowhere to live by design`);
    }
  }
});

// --- the formula, fed --------------------------------------------------------------

test('allowances, overtime, tax from the table and contributions from the plans land on the slip', () => {
  H.seedTaxBrackets();
  const ot = H.requestOvertime({ employeeId: e1.id, day: `${period}-05`, minutes: 120, rate: 1.5, actor: `agent:${AGENT}` });
  assert.throws(() => H.decideOvertime(ot.id, { approve: true, actor: `agent:${AGENT}` }), /human act/);
  H.decideOvertime(ot.id, { approve: true, actor: 'human:manager' });
  H.addAllowance({ employeeId: e1.id, kind: 'housing', amount: 300, actor: 'human:test' });
  const plan = H.createBenefitPlan({ name: 'Health', kind: 'health', employerShare: 50, employeeShare: 10, actor: 'human:test' });
  H.enroll({ employeeId: e1.id, planId: plan.id, actor: 'human:test' });

  const run = draftPayroll({ period, actor: 'human:test' });
  const huda = run.slips.find((s) => s.employee_id === e1.id).detail;
  assert.equal(huda.allowances, 300);
  assert.equal(huda.overtime, 37.5, '2h × 1.5 × (3000/30/8 = 12.5/h)');
  assert.equal(huda.gross, 3337.5);
  // Progressive: 250×3% + 250×5% + 500×10% + 2337.5×15%
  assert.equal(huda.taxes, 420.63);
  assert.equal(huda.contributions, 10);
  assert.equal(huda.employer, 50);
  assert.equal(huda.net, 2906.87);
  const sami = run.slips.find((s) => s.employee_id === e2.id).detail;
  assert.equal(sami.taxes, 145);
  assert.equal(run.total_tax, 565.63);
  assert.equal(run.total_contrib, 10);
  assert.equal(run.total_employer, 50);
});

// --- the raise -----------------------------------------------------------------------

test('changing a salary is human at the gate and in the module; the history is sealed and the fact is chained', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
  for (const opts of [{}, { force: true }, { valueUsd: 0 }]) {
    const r = await command('changeSalary', { employeeId: e1.id, newSalary: 3500, ...opts }, { agentId: AGENT, actor: 'agent', ...opts });
    assert.equal(r.verdict, 'gated', `changeSalary cleared with ${JSON.stringify(opts)}`);
  }
  assert.throws(() => H.changeSalary({ employeeId: e1.id, newSalary: 3500, actor: `agent:${AGENT}` }), /human act/);

  H.changeSalary({ employeeId: e1.id, newSalary: 3500, actor: 'human:hr' });
  const row = one('SELECT * FROM hr_salary_change WHERE employee_id = ?', e1.id);
  assert.match(row.old_salary, /^pii:1:/);
  assert.match(row.new_salary, /^pii:1:/);
  assert.match(one('SELECT base_salary FROM hr_employee WHERE id = ?', e1.id).base_salary, /^pii:1:/);
  const hist = H.salaryHistory(e1.id);
  assert.equal(hist[0].old, 3000);
  assert.equal(hist[0].new, 3500);
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'salary.changed'"), 'the fact must be on the chain');
  // The chain carries that it happened, not the number.
  assert.ok(!q("SELECT payload FROM audit_log WHERE action = 'salary.changed'").some((r) => String(r.payload).includes('3500')));
});

// --- end of service ---------------------------------------------------------------

test('end of service is computed at termination, sealed, and paid by a person through the one ledger', async () => {
  exec("UPDATE hr_employee SET hired_at = date('now', '-2 year') WHERE id = ?", e2.id);
  terminateEmployee({ employeeId: e2.id, actor: 'human:hr' });
  const eos = H.eosFor(e2.id);
  assert.ok(eos, 'termination must compute end of service');
  assert.ok(eos.years >= 1.95 && eos.years <= 2.05, `years: ${eos.years}`);
  assert.equal(eos.days_per_year, 14);
  assert.ok(Math.abs(eos.amount - eos.years * 14 * 50) < 0.02, 'years × days × (1500/30)');
  assert.match(one('SELECT amount FROM hr_eos WHERE employee_id = ?', e2.id).amount, /^pii:1:/, 'one person\'s money is sealed');

  assert.throws(() => H.payEos(e2.id, { actor: `agent:${AGENT}` }), /human act/);
  const r = await command('payEos', { employeeId: e2.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'gated');

  H.payEos(e2.id, { actor: 'human:cfo' });
  await jobsTick();
  const entry = one("SELECT * FROM journal WHERE source = 'core2' AND source_id = ?", `eos-${e2.id}`);
  assert.ok(entry, 'the payment never reached the ledger');
  const debit = one("SELECT amount FROM journal_lines WHERE journal_id = ? AND side = 'debit'", entry.id).amount;
  assert.ok(Math.abs(debit - eos.amount) < 0.02);
  // The event carried no amount — the bridge opened the sealed figure itself.
  assert.ok(!q("SELECT payload FROM jobs WHERE kind = 'core2.event' AND payload LIKE '%eos.paid%'").some((j) => String(j.payload).includes(String(Math.round(eos.amount)))));
});

// --- grievances and assets ---------------------------------------------------------

test('a grievance is a sealed restricted document with a human decision behind it', () => {
  const planted = 'PLANTED-GRIEVANCE-7c1e a paragraph that must never be readable';
  const g = H.openGrievance({ employeeId: e1.id, title: 'About scheduling', body: planted, actor: `agent:${AGENT}` });
  assert.equal(one('SELECT classification FROM doc_document WHERE id = ?', g.doc_id).classification, 'restricted');
  assert.ok(!diskContains('PLANTED-GRIEVANCE'), 'the grievance is readable on disk');
  assert.throws(() => H.decideGrievance(g.id, { state: 'resolved', actor: `agent:${AGENT}` }), /human act/);
  H.decideGrievance(g.id, { state: 'under_review', actor: 'human:hr' });
  H.decideGrievance(g.id, { state: 'resolved', actor: 'human:hr' });
  assert.equal(one('SELECT state FROM hr_grievance WHERE id = ?', g.id).state, 'resolved');
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'grievance.resolved'"));
});

test('an asset has one holder at a time, and Core 1\'s register agrees', () => {
  const a = createAsset({ name: 'Laptop 7', kind: 'device', owner: 'IT', actor: 'human:test' });
  H.assignAsset({ employeeId: e1.id, assetId: a.id, actor: 'human:test' });
  assert.equal(one('SELECT owner FROM assets WHERE id = ?', a.id).owner, 'Huda Rashid');
  assert.throws(() => H.assignAsset({ employeeId: e1.id, assetId: a.id, actor: 'human:test' }), /already held/);
  const held = H.assetsFor(e1.id);
  assert.equal(held.length, 1);
  H.returnAsset(held[0].id, { actor: 'human:test' });
  assert.ok(one('SELECT returned_at FROM hr_asset_assignment WHERE id = ?', held[0].id).returned_at);
});

test('an employment certificate carries org facts and never the salary', () => {
  const doc = H.employmentLetter({ employeeId: e1.id, actor: 'human:hr' });
  const body = one('SELECT body FROM doc_version WHERE document_id = ? ORDER BY id DESC LIMIT 1', doc.id).body;
  assert.match(body, /Huda Rashid/);
  assert.match(body, /E001/);
  assert.ok(!/3500|3000/.test(body), 'the letter must not mention the salary');
});
