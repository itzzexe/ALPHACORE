// HR, the rest of it — and the three things it must never do.
//
// It must never store a reason: a correction is a time pair, a grievance is a
// sealed document. It must never let a machine change what somebody is paid:
// changeSalary is gated categorically and refused in the module. And it must
// never let one person's money be readable on disk: the raise, the history and
// the end-of-service amount are sealed under them.
//
// The payroll formula is the other half, and it reads three neighbours rather
// than repeating them: approved overtime from shifts.js, tax and contributions
// from the rules declared in payrules.js, end-of-service days from the same.
// One master per fact; this file proves the slip is computed from all of them.
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
const { setSetting } = await import('../src/settings.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { seedBridge, command, callTool, CONNECTOR } = await import('../src/core2/bridge.js');
const { draftPayroll } = await import('../src/core2/payops.js');
const { terminateEmployee } = await import('../src/core2/talent.js');
const { createShift, assignShift, claimOvertime, decideOvertime } = await import('../src/core2/shifts.js');
const { setRule } = await import('../src/core2/payrules.js');
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

// --- the calendar and the corrections ------------------------------------------

test('lateness is measured against the shift in force (shifts.js); a holiday measures nothing', () => {
  const shift = createShift({ name: 'Day', starts: '09:00', ends: '17:00', days: [0, 1, 2, 3, 4, 5, 6], actor: 'human:test' });
  assignShift({ employeeId: e1.id, shiftId: shift.id, from: `${period}-01`, actor: 'human:test' });

  // Huda walked in half an hour late today.
  exec('INSERT INTO time_attendance (employee_id, day, in_at) VALUES (?, ?, ?)', e1.id, today, `${today} 09:30:00`);
  const before = H.attendanceExceptions({ period });
  const huda = before.rows.find((r) => r.employeeId === e1.id);
  assert.equal(huda.lateDays, 1);
  assert.equal(huda.lateMinutes, 30);
  assert.equal(huda.absent, 0);

  H.addHoliday({ day: today, name: 'Test holiday', actor: 'human:test' });
  const after = H.attendanceExceptions({ period });
  assert.equal(after.rows.find((r) => r.employeeId === e2.id).absent, 0, 'a holiday is not an absence');
  assert.equal(after.rows.find((r) => r.employeeId === e1.id).lateDays, 0, 'nothing is measured on a holiday');
});

test('a correction is a time pair a manager decides; approved, it becomes the mark', () => {
  const c = H.requestCorrection({ employeeId: e2.id, day: `${period}-03`, inAt: `${period}-03 08:55:00`, outAt: `${period}-03 17:05:00`, actor: `agent:${AGENT}` });
  assert.throws(() => H.decideCorrection(c.id, { approve: true, actor: `agent:${AGENT}` }), /human act/);
  H.decideCorrection(c.id, { approve: true, actor: 'human:manager' });
  const mark = one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', e2.id, `${period}-03`);
  assert.ok(mark?.in_at && mark?.out_at, 'an approved correction writes the mark');
  assert.equal(mark.minutes, 490);
  for (const table of ['time_correction', 'hr_grievance', 'hr_salary_change', 'hr_movement']) {
    const cols = q(`PRAGMA table_info(${table})`).map((x) => x.name);
    for (const bad of ['reason', 'note', 'notes', 'comment', 'diagnosis', 'body']) {
      assert.ok(!cols.includes(bad), `${table} has a ${bad} column — a reason has nowhere to live by design`);
    }
  }
});

// --- the formula, fed by its neighbours ------------------------------------------

test('the slip reads overtime from shifts.js, tax from payrules.js, contributions from the plans', () => {
  // Two hours of approved overtime at the company's rate.
  setSetting('OVERTIME_RATE', '1.5');
  const ot = claimOvertime({ employeeId: e1.id, day: `${period}-05`, minutes: 120, reason: 'month-end close', actor: `agent:${AGENT}` });
  decideOvertime(ot.id, { approve: true, actor: 'human:manager' });
  // A flat tax and an employer-paid contribution, declared with a basis.
  setRule({ code: 'PIT', label: 'Income tax', kind: 'tax', base: 'gross', paidBy: 'employee', percent: 10, basis: 'Income Tax Law, art. 1 — test', actor: 'human:cfo' });
  setRule({ code: 'SSE', label: 'Social security (employer)', kind: 'contribution', base: 'basic', paidBy: 'employer', percent: 12, basis: 'Social Security Law — test', actor: 'human:cfo' });
  H.addAllowance({ employeeId: e1.id, kind: 'housing', amount: 300, actor: 'human:test' });
  const plan = H.createBenefitPlan({ name: 'Health', kind: 'health', employerShare: 50, employeeShare: 10, actor: 'human:test' });
  H.enroll({ employeeId: e1.id, planId: plan.id, actor: 'human:test' });

  const run = draftPayroll({ period, actor: 'human:test' });
  const huda = run.slips.find((s) => s.employee_id === e1.id).detail;
  assert.equal(huda.allowances, 300);
  assert.equal(huda.overtime, 37.5, '2h × 1.5 × (3000/30/8 = 12.5/h)');
  assert.equal(huda.gross, 3337.5);
  assert.equal(huda.taxes, 333.75, '10% of gross, from the declared rule');
  assert.equal(huda.contributions, 10, 'the plan\'s employee share');
  assert.equal(huda.employer, 410, '12% of basic (360) plus the plan\'s employer share (50)');
  assert.equal(huda.rulesConfigured, true);
  assert.equal(huda.net, 2993.75);
  assert.equal(run.total_tax, 483.75, 'Huda 333.75 + Sami 150');
  assert.equal(run.total_employer, 590, 'Huda 410 + Sami 180');
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
  assert.ok(!q("SELECT payload FROM audit_log WHERE action = 'salary.changed'").some((r) => String(r.payload).includes('3500')));
});

// --- end of service ---------------------------------------------------------------

test('end of service takes its days from payrules.js, is sealed, and is paid by a person through the one ledger', async () => {
  setSetting('EOS_DAYS_PER_YEAR_FIRST', '14');
  setSetting('EOS_DAYS_PER_YEAR_AFTER', '21');
  setSetting('EOS_THRESHOLD_YEARS', '5');
  exec("UPDATE hr_employee SET hired_at = date('now', '-2 year') WHERE id = ?", e2.id);
  terminateEmployee({ employeeId: e2.id, actor: 'human:hr' });
  const eos = H.eosFor(e2.id);
  assert.ok(eos, 'termination must compute end of service');
  assert.ok(eos.years >= 1.95 && eos.years <= 2.05, `years: ${eos.years}`);
  assert.equal(eos.days_per_year, 14);
  assert.ok(Math.abs(eos.amount - eos.years * 14 * 50) < 0.5, 'years × 14 days × (1500/30)');
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
  assert.ok(!q("SELECT payload FROM jobs WHERE kind = 'core2.event' AND payload LIKE '%eos.paid%'").some((j) => String(j.payload).includes(String(Math.round(eos.amount)))));
});

test('with no end-of-service rule declared, nothing is paid — an absence, not a zero', () => {
  setSetting('EOS_DAYS_PER_YEAR_FIRST', '');
  setSetting('EOS_DAYS_PER_YEAR_AFTER', '');
  const r = H.computeEos({ employeeId: e1.id, actor: 'human:hr' });
  assert.equal(r.configured, false);
  assert.equal(r.amount, 0);
  assert.throws(() => H.payEos(e1.id, { actor: 'human:cfo' }), /not configured|nothing is owed/);
});

// --- grievances and the letter ------------------------------------------------------

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

test('an employment certificate carries org facts and never the salary', () => {
  const doc = H.employmentLetter({ employeeId: e1.id, actor: 'human:hr' });
  const body = one('SELECT body FROM doc_version WHERE document_id = ? ORDER BY id DESC LIMIT 1', doc.id).body;
  assert.match(body, /Huda Rashid/);
  assert.match(body, /E001/);
  assert.ok(!/3500|3000/.test(body), 'the letter must not mention the salary');
});

test('the overtime claim reaches the bridge as one tool, against shifts.js', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.claim_overtime', actor: 'human:test' });
  const r = await callTool('claim_overtime', { employeeId: e1.id, day: `${period}-06`, minutes: 30, reason: 'late delivery' }, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'allowed');
  assert.equal(one('SELECT state FROM time_overtime WHERE employee_id = ? AND day = ?', e1.id, `${period}-06`).state, 'claimed');
  assert.ok(!one("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pay_tax_bracket','hr_asset_assignment')"), 'a second master for tax or custody exists');
});
