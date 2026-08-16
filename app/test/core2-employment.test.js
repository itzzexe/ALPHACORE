// A whole employment, end to end: rostered, paid, holding a laptop, and leaving.
//
// These four modules exist because each closed a hole that made the system look
// more finished than it was — a shift table nothing read, a tax line that was a
// named zero, an asset register that could not say who was holding anything,
// and a first day that lived in somebody's head.
//
// So the tests follow one person through all of it, and most of them are about
// the refusals: that extra minutes are not overtime, that nobody signs off
// their own hours or their own returns, that an unconfigured tax is reported as
// unknown rather than as zero, and that a leaving cannot close over a laptop
// that never came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-employment.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-core2-employment.db${s}`)); } catch { /* first run */ }
}

const S = await import('../src/core2/shifts.js');
const R = await import('../src/core2/payrules.js');
const C = await import('../src/core2/custody.js');
const J = await import('../src/core2/joining.js');
const I = await import('../src/core2/identity.js');
const { q, one, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { verifyChain } = await import('../src/audit.js');

const HR = 'human:hr';
const IT = 'human:it';

const person = I.createPerson({ displayName: 'Rami Khoury', personalEmail: 'rami@example.com', actor: HR });
const employee = I.employ({ personId: person.id, hiredAt: '2026-01-05', baseSalary: 4000, actor: HR });

// ------------------------------------------------------------------ shifts --

test('a shift needs a real time and at least one day', () => {
  assert.throws(() => S.createShift({ name: 'Days', starts: '09:00', ends: '17:00' }), /signed/);
  assert.throws(() => S.createShift({ name: '', starts: '09:00', ends: '17:00', actor: HR }), /needs a name/);
  assert.throws(() => S.createShift({ name: 'Days', starts: 'nine', ends: '17:00', actor: HR }), /HH:MM/);
  assert.throws(() => S.createShift({ name: 'Days', starts: '09:00', ends: '17:00', days: [], actor: HR }), /which days/);
  assert.throws(() => S.createShift({ name: 'Days', starts: '09:00', ends: '17:00', days: [9], actor: HR }), /0 \(Sunday\) to 6/);
});

test('an assignment is dated, so last month is still judged against last month\'s roster', () => {
  const day = S.createShift({ name: 'Days', starts: '09:00', ends: '17:00', days: [0, 1, 2, 3, 4], actor: HR });
  const late = S.createShift({ name: 'Late', starts: '13:00', ends: '21:00', days: [0, 1, 2, 3, 4], actor: HR });

  S.assignShift({ employeeId: employee.id, shiftId: day.id, from: '2026-01-05', actor: HR });
  S.assignShift({ employeeId: employee.id, shiftId: late.id, from: '2026-03-01', actor: HR });

  assert.equal(S.shiftOn(employee.id, '2026-02-10').name, 'Days', 'February was on the day shift and still is');
  assert.equal(S.shiftOn(employee.id, '2026-03-10').name, 'Late');
  // The first assignment was closed rather than left running, so no day has two.
  const live = q('SELECT * FROM time_shift_assignment WHERE employee_id = ? AND (until IS NULL OR until >= ?)', employee.id, '2026-03-10');
  assert.equal(live.length, 1, 'exactly one roster in force on any given day');
});

test('somebody on no roster is not "on time" — they are not on a roster', () => {
  const other = I.createPerson({ displayName: 'Nour Saab', personalEmail: 'nour@example.com', actor: HR });
  const emp2 = I.employ({ personId: other.id, hiredAt: '2026-01-05', actor: HR });
  exec("INSERT INTO time_attendance (employee_id, day, in_at, out_at, minutes) VALUES (?,?,?,?,?)",
    emp2.id, '2026-02-10', '2026-02-10 09:30:00', '2026-02-10 17:30:00', 480);
  const j = S.judgeDay(emp2.id, '2026-02-10');
  assert.equal(j.late, null, 'a zero here would put them in the on-time column of every report');
  assert.match(j.note, /not on a roster/);
});

test('late is measured against the shift, after the grace the company set', () => {
  setSetting('SHIFT_GRACE_MINUTES', '10', HR);
  exec("INSERT INTO time_attendance (employee_id, day, in_at, out_at, minutes) VALUES (?,?,?,?,?)",
    employee.id, '2026-02-10', '2026-02-10 09:25:00', '2026-02-10 18:00:00', 515);
  const j = S.judgeDay(employee.id, '2026-02-10');
  assert.equal(j.shift.name, 'Days');
  assert.equal(j.late, 15, '25 minutes late, 10 of them forgiven');
  assert.equal(j.extra, 60, 'and an hour past the end');
});

test('extra minutes are not overtime until somebody approves them', () => {
  assert.throws(() => S.claimOvertime({ employeeId: employee.id, day: '2026-02-10', minutes: 60, reason: '', actor: HR }), /say what the extra hours were for/);
  const c = S.claimOvertime({ employeeId: employee.id, day: '2026-02-10', minutes: 60, reason: 'shipping the February close', actor: HR });
  assert.equal(S.approvedOvertime(employee.id, '2026-02'), 0, 'a claim is not an approval');

  // Nobody signs off their own hours. The oldest control there is.
  assert.throws(() => S.decideOvertime(c.id, { approve: true, actor: HR }), /somebody else has to approve/);
  assert.throws(() => S.decideOvertime(c.id, { approve: true, actor: 'agent:AGT-HR-001' }), /only a person/);

  S.decideOvertime(c.id, { approve: true, actor: IT });
  assert.equal(S.approvedOvertime(employee.id, '2026-02'), 60, 'and only now can payroll see it');
  assert.throws(() => S.decideOvertime(c.id, { approve: true, actor: IT }), /already approved/);
});

// --------------------------------------------------------------- pay rules --

test('with nothing declared, tax is reported as unknown rather than as zero', () => {
  const d = R.computeDeductions({ gross: 5000, basic: 4000 });
  assert.equal(d.configured, false);
  assert.equal(d.employeeTotal, null, 'a zero here looks computed, and somebody eventually pays against it');
  assert.match(d.says, /rather than as zero/);
});

test('a rule needs a stated basis, and is either flat or banded', () => {
  assert.throws(() => R.setRule({ code: 'x', label: 'X', percent: 5, basis: '', actor: HR }), /nobody can cite/);
  assert.throws(() => R.setRule({ code: 'x', label: 'X', percent: 5, basis: 'the act' }), /signed/);
  assert.throws(() => R.setRule({ code: 'x', label: 'X', basis: 'the act', actor: HR }), /either a flat percentage or a set of bands/);
  assert.throws(() => R.setRule({ code: 'x', label: 'X', percent: 5, bands: [{ upTo: null, percent: 1 }], basis: 'y', actor: HR }), /not both/);
  assert.throws(() => R.setRule({ code: 'x', label: 'X', percent: 140, basis: 'y', actor: HR }), /0 to 100/);
});

test('bands that overlap or leave the top open-ended are refused', () => {
  const bad = [
    [[{ upTo: 1000, percent: 5 }, { upTo: 500, percent: 10 }, { upTo: null, percent: 20 }], /does not start where the one before it ended/],
    [[{ upTo: 1000, percent: 5 }, { upTo: 2000, percent: 10 }], /top band has no upper limit/],
  ];
  for (const [bands, why] of bad) {
    assert.throws(() => R.setRule({ code: 'inc', label: 'Income tax', bands, basis: 'y', actor: HR }), why);
  }
});

test('a progressive rule taxes each slice, not the whole amount at the top rate', () => {
  R.setRule({
    code: 'income', label: 'Income tax', kind: 'tax', base: 'taxable', paidBy: 'employee',
    bands: [{ upTo: 1000, percent: 0 }, { upTo: 3000, percent: 10 }, { upTo: null, percent: 20 }],
    basis: 'Finance Act, set locally', actor: HR,
  });
  R.setRule({
    code: 'social', label: 'Social insurance', kind: 'contribution', base: 'gross', paidBy: 'employee',
    percent: 7.5, capAmount: 4000, basis: 'Social Security Law, set locally', actor: HR,
  });
  R.setRule({
    code: 'social-er', label: 'Social insurance (employer)', kind: 'contribution', base: 'gross', paidBy: 'employer',
    percent: 14, capAmount: 4000, basis: 'Social Security Law, set locally', actor: HR,
  });

  const d = R.computeDeductions({ gross: 5000, basic: 4000, deductions: 0 });
  assert.equal(d.configured, true);
  const income = d.lines.find((l) => l.code === 'income');
  // 0 on the first 1000, 10% of the next 2000 = 200, 20% of the last 2000 = 400.
  assert.equal(income.amount, 600, 'each band taxes only its own slice');
  // Not 20% of 5000 = 1000, which is what the common bug produces.
  assert.notEqual(income.amount, 1000);

  const social = d.lines.find((l) => l.code === 'social');
  assert.equal(social.amount, 300, '7.5% of the 4000 cap, not of 5000');

  // The employer's share is a company cost, never a deduction from the person.
  assert.equal(d.employeeTotal, 900);
  assert.equal(d.employerTotal, 560);
  assert.ok(d.lines.every((l) => l.basis), 'and every line carries the authority for it');
});

test('end of service is unconfigured rather than zero, and computes once it is set', () => {
  const before = R.endOfService({ employeeId: employee.id, lastDay: '2029-01-05' });
  assert.equal(before.configured, false);
  assert.match(before.says, /opposite in front of a tribunal/);

  setSetting('EOS_DAYS_PER_YEAR_FIRST', '15', HR);
  setSetting('EOS_DAYS_PER_YEAR_AFTER', '30', HR);
  setSetting('EOS_THRESHOLD_YEARS', '5', HR);
  setSetting('EOS_RESIGN_FACTOR', '0.5', HR);

  const after = R.endOfService({ employeeId: employee.id, lastDay: '2033-01-05', reason: 'terminated' });
  assert.equal(after.configured, true);
  assert.equal(after.years, 7);
  // Five years at 15 days, two at 30: 75 + 60 = 135.
  assert.equal(after.days, 135);

  const resigned = R.endOfService({ employeeId: employee.id, lastDay: '2033-01-05', reason: 'resigned' });
  assert.equal(resigned.days, 67.5, 'halved, because that is the rule this company recorded');
});

// ----------------------------------------------------------------- custody --

test('one thing cannot be in two hands', () => {
  const assetId = Number(exec("INSERT INTO assets (name, kind, owner) VALUES ('MacBook Pro 14', 'device', 'it')").lastInsertRowid);
  C.issue({ employeeId: employee.id, assetId, serial: 'C02X1', condition: 'new', actor: IT });

  const other = one("SELECT id FROM hr_employee WHERE id != ? LIMIT 1", employee.id);
  assert.throws(() => C.issue({ employeeId: other.id, assetId, actor: IT }), /already with Rami Khoury/);
  assert.throws(() => C.issue({ employeeId: employee.id, actor: IT }), /say which asset, or describe/);
  assert.throws(() => C.issue({ employeeId: employee.id, description: 'keys', condition: 'mint', actor: IT }), /condition is one of/);
});

test('a return is signed by somebody other than the person handing it back', () => {
  const item = C.issue({ employeeId: employee.id, description: 'Office keys', actor: IT });
  assert.throws(() => C.takeBack(item.id, { actor: undefined }), /signed/);
  C.takeBack(item.id, { condition: 'good', actor: HR });
  assert.ok(one('SELECT returned_at FROM cust_item WHERE id = ?', item.id).returned_at);
  assert.throws(() => C.takeBack(item.id, { actor: HR }), /already returned/);
});

test('custody says who is holding what, and blocks a leaving that would lose it', () => {
  const held = C.heldBy(employee.id);
  assert.equal(held.length, 1, 'the laptop is still out');
  const check = C.clearedToLeave(employee.id);
  assert.equal(check.cleared, false);
  assert.match(check.say, /finds out about its laptops a year later/);
  assert.equal(check.holding[0].what, 'MacBook Pro 14');
});

// ---------------------------------------------------------------- joining --

test('a checklist is generated with dated steps, and only one may be open', () => {
  const l = J.start({ employeeId: employee.id, kind: 'joining', on: '2026-01-05', actor: HR });
  assert.equal(l.steps, J.TEMPLATES.joining.length);
  assert.throws(() => J.start({ employeeId: employee.id, kind: 'joining', actor: HR }), /already an open joining/);
  assert.throws(() => J.start({ employeeId: employee.id, kind: 'onboarding', actor: HR }), /a checklist is one of/);

  const d = J.listDetail(l.id);
  const contract = d.steps.find((s) => s.code === 'contract-signed');
  assert.equal(contract.due_on, '2026-01-02', 'three days before the start');
  assert.equal(contract.critical, 1);
});

test('a critical step cannot be skipped without a name and a reason', () => {
  const l = one("SELECT id FROM join_list WHERE kind = 'joining' ORDER BY id DESC LIMIT 1");
  const step = one("SELECT id FROM join_step WHERE list_id = ? AND code = 'accounts-created'", l.id);
  assert.throws(() => J.tick(step.id, { actor: IT, skip: true }), /costs money or opens a door/);
  J.tick(step.id, { actor: IT, skip: true, why: 'they already had an account from the contract period' });
  assert.equal(one('SELECT skipped FROM join_step WHERE id = ?', step.id).skipped, 1);
});

test('a checklist will not close over an unfinished critical step', () => {
  const l = one("SELECT id FROM join_list WHERE kind = 'joining' ORDER BY id DESC LIMIT 1");
  assert.throws(() => J.close(l.id, { actor: HR }), (e) => {
    assert.equal(e.status, 409);
    assert.ok(e.open.length, 'and it names them, because "cannot close" is not something anybody can act on');
    return true;
  });
  for (const s of q('SELECT id FROM join_step WHERE list_id = ? AND done_at IS NULL', l.id)) J.tick(s.id, { actor: HR });
  assert.equal(J.close(l.id, { actor: HR }).ok, true);
});

test('a leaving will not close while the person still holds company property', () => {
  const l = J.start({ employeeId: employee.id, kind: 'leaving', on: '2033-01-05', actor: HR });
  for (const s of q('SELECT id FROM join_step WHERE list_id = ?', l.id)) J.tick(s.id, { actor: HR });

  // Every step ticked, including "all equipment returned" — and the laptop is
  // still out. Checked against the register rather than against the tick box.
  assert.throws(() => J.close(l.id, { actor: HR }), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /still out/);
    return true;
  });

  const item = one('SELECT id FROM cust_item WHERE employee_id = ? AND returned_at IS NULL', employee.id);
  C.takeBack(item.id, { condition: 'worn', actor: IT });
  assert.equal(J.close(l.id, { actor: HR }).ok, true, 'and now it closes');
});

test('all of it is on the chain, and the chain still verifies', () => {
  for (const action of ['shift.assigned', 'overtime.approved', 'payrule.added', 'custody.issued', 'custody.returned', 'joining.leaving_closed']) {
    assert.ok(one('SELECT seq FROM audit_log WHERE action = ? ORDER BY seq DESC LIMIT 1', action), `${action} is recorded`);
  }
  assert.ok(verifyChain().ok);
});

test('each overview says what it will not do', () => {
  assert.match(S.shiftsOverview({}).says, /nobody signs off their own hours/);
  assert.match(R.payRulesOverview().says, /authority for it stated beside the number/);
  assert.match(C.custodyOverview().says, /cannot be in two hands/);
  assert.match(J.joiningOverview().says, /never silently/);
});
