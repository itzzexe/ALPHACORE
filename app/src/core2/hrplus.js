// HR, THE REST OF IT — time rules, compensation, movements, end of service,
// grievances, and who holds which of the company's things.
//
// The rules this file keeps, in one place so they can be counted:
//
//   A salary is sealed at rest and its history is sealed too. What is readable
//   about a raise is that it happened, when, and who did it. changeSalary is on
//   the gateway's categorical list, and this module refuses any non-human actor
//   as the second lock on that door.
//
//   Nothing here holds a reason. An overtime claim is minutes on a day; a
//   correction is an in/out pair; a grievance is a pointer to a document
//   sealed under the person who raised it. A manager decides on facts and
//   their name is written down.
//
//   The tax table is data, not code. Brackets live in a table keyed by
//   jurisdiction so payroll can be right for Baghdad and Erbil without a
//   deploy — and the seeded figures are placeholders that say so.
import { q, one, exec } from '../db.js';
import { sealPii, sealForRef, openPii } from '../erasure.js';
import { getSetting } from '../settings.js';
import { log, getEmployee } from './identity.js';
import { emit } from './bridge.js';
import { createDocument } from './documents.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const human = (actor, what) => {
  if (!String(actor || '').startsWith('human:')) refuse(`${what} is a human act — an agent may prepare it, never do it`);
};
const activeEmployee = (id) => {
  const e = one("SELECT e.*, p.subject_ref, p.display_name, p.personal_email, p.personal_phone FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ? AND e.state IN ('active','notice','suspended')", Number(id));
  if (!e) refuse('no such active employee');
  return e;
};

/** The person's own key, the same way employ() finds it. */
function sealerFor(emp) {
  const identifier = emp.personal_email ? openPii(emp.personal_email) : (emp.personal_phone ? openPii(emp.personal_phone) : null);
  const usable = identifier && identifier !== '[erased]' && identifier !== '[unreadable]' ? identifier : null;
  return (v) => (usable && v != null ? sealPii(String(v), { kind: 'contact', identifier: usable }) : (v == null ? null : String(v)));
}

// ------------------------------------------------------------ the calendar --

export function addHoliday({ day, name, actor }) {
  if (!actor) refuse('the calendar is edited by somebody');
  if (!isDay(day)) refuse('a holiday is a date, YYYY-MM-DD');
  exec('INSERT INTO hr_holiday (day, name) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET name = excluded.name', day, clean(name) || 'Holiday');
  log({ entity: 'holiday', action: 'holiday.added', actor, detail: { day } });
  return one('SELECT * FROM hr_holiday WHERE day = ?', day);
}

export function listHolidays(year = new Date().getFullYear()) {
  return q('SELECT * FROM hr_holiday WHERE day LIKE ? ORDER BY day', `${year}-%`);
}

export const isHoliday = (day) => Boolean(one('SELECT id FROM hr_holiday WHERE day = ?', day));

// ------------------------------------------------------------------ shifts --

export function createShift({ name, starts, ends, days = [1, 2, 3, 4, 5], actor }) {
  if (!actor) refuse('a shift is defined by somebody');
  if (!/^\d{2}:\d{2}$/.test(starts) || !/^\d{2}:\d{2}$/.test(ends)) refuse('shift times are HH:MM');
  const d = (Array.isArray(days) ? days : []).map(Number).filter((n) => n >= 0 && n <= 6);
  if (!d.length) refuse('a shift needs at least one working day');
  exec('INSERT INTO time_shift (name, starts, ends, days) VALUES (?,?,?,?)', clean(name) || 'Shift', starts, ends, JSON.stringify(d));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'shift', entityId: id, action: 'shift.created', actor });
  return one('SELECT * FROM time_shift WHERE id = ?', id);
}

export const listShifts = () => q('SELECT * FROM time_shift ORDER BY id');

export function assignShift({ employeeId, shiftId, starts = null, ends = null, actor }) {
  if (!actor) refuse('assigning a shift carries a name');
  const emp = activeEmployee(employeeId);
  if (!one('SELECT id FROM time_shift WHERE id = ?', Number(shiftId))) refuse('no such shift');
  const from = starts || today();
  // The previous open assignment ends the day before this one starts.
  exec("UPDATE time_shift_assignment SET ends = date(?, '-1 day') WHERE employee_id = ? AND ends IS NULL", from, emp.id);
  exec('INSERT INTO time_shift_assignment (employee_id, shift_id, starts, ends, created_by) VALUES (?,?,?,?,?)',
    emp.id, Number(shiftId), from, ends, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'shift_assignment', entityId: id, action: 'shift.assigned', actor, detail: { employeeId: emp.id, shiftId: Number(shiftId) } });
  return one('SELECT * FROM time_shift_assignment WHERE id = ?', id);
}

/** The shift an employee is on for a given day, if any. */
export function shiftFor(employeeId, day = today()) {
  return one(
    `SELECT s.* FROM time_shift_assignment a JOIN time_shift s ON s.id = a.shift_id
      WHERE a.employee_id = ? AND a.starts <= ? AND (a.ends IS NULL OR a.ends >= ?)
      ORDER BY a.starts DESC LIMIT 1`, Number(employeeId), day, day,
  );
}

// ---------------------------------------------------------------- overtime --

export function requestOvertime({ employeeId, day, minutes, rate = 1.5, actor }) {
  if (!actor) refuse('an overtime claim carries a name');
  const emp = activeEmployee(employeeId);
  if (!isDay(day)) refuse('overtime is claimed for a date');
  const m = Math.round(Number(minutes));
  if (!(m > 0 && m <= 720)) refuse('overtime is between one minute and twelve hours in a day');
  const r = Number(rate) || 1.5;
  if (r < 1 || r > 3) refuse('an overtime rate is between 1× and 3×');
  exec('INSERT INTO time_overtime (employee_id, day, minutes, rate, created_by) VALUES (?,?,?,?,?)', emp.id, day, m, r, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'overtime', entityId: id, action: 'overtime.requested', actor, detail: { employeeId: emp.id, minutes: m } });
  emit('overtime.requested', { id, employeeId: emp.id });
  return one('SELECT * FROM time_overtime WHERE id = ?', id);
}

export function decideOvertime(id, { approve, actor }) {
  human(actor, 'deciding overtime');
  const row = one('SELECT * FROM time_overtime WHERE id = ?', Number(id));
  if (!row) refuse('no such overtime claim');
  if (row.state !== 'pending') refuse(`this claim is already ${row.state}`);
  const state = approve ? 'approved' : 'rejected';
  exec("UPDATE time_overtime SET state = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", state, String(actor), row.id);
  log({ entity: 'overtime', entityId: row.id, action: `overtime.${state}`, actor });
  return one('SELECT * FROM time_overtime WHERE id = ?', row.id);
}

/** Approved overtime minutes inside a period, weighted by rate. */
export function overtimeFor(employeeId, period) {
  const rows = q("SELECT minutes, rate FROM time_overtime WHERE employee_id = ? AND state = 'approved' AND substr(day, 1, 7) = ?", Number(employeeId), period);
  return rows.reduce((a, r) => a + (r.minutes / 60) * r.rate, 0);   // weighted hours
}

// ------------------------------------------------------------- corrections --

export function requestCorrection({ employeeId, day, inAt = null, outAt = null, actor }) {
  if (!actor) refuse('a correction carries a name');
  const emp = activeEmployee(employeeId);
  if (!isDay(day)) refuse('a correction is for a date');
  if (!inAt && !outAt) refuse('a correction says what the in or the out time should have been');
  exec('INSERT INTO time_correction (employee_id, day, in_at, out_at, created_by) VALUES (?,?,?,?,?)',
    emp.id, day, inAt ? clean(inAt, 25) : null, outAt ? clean(outAt, 25) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'correction', entityId: id, action: 'attendance.correction_requested', actor, detail: { employeeId: emp.id, day } });
  return one('SELECT * FROM time_correction WHERE id = ?', id);
}

export function decideCorrection(id, { approve, actor }) {
  human(actor, 'deciding an attendance correction');
  const row = one('SELECT * FROM time_correction WHERE id = ?', Number(id));
  if (!row) refuse('no such correction');
  if (row.state !== 'pending') refuse(`this correction is already ${row.state}`);
  const state = approve ? 'approved' : 'rejected';
  exec("UPDATE time_correction SET state = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", state, String(actor), row.id);
  if (approve) {
    exec(`INSERT INTO time_attendance (employee_id, day, in_at, out_at, source) VALUES (?,?,?,?,'manual')
          ON CONFLICT(employee_id, day) DO UPDATE SET in_at = COALESCE(excluded.in_at, in_at), out_at = COALESCE(excluded.out_at, out_at)`,
      row.employee_id, row.day, row.in_at, row.out_at);
    exec(`UPDATE time_attendance SET minutes = CAST((julianday(out_at) - julianday(in_at)) * 1440 AS INTEGER)
          WHERE employee_id = ? AND day = ? AND in_at IS NOT NULL AND out_at IS NOT NULL`, row.employee_id, row.day);
  }
  log({ entity: 'correction', entityId: row.id, action: `attendance.correction_${state}`, actor });
  return one('SELECT * FROM time_correction WHERE id = ?', row.id);
}

/**
 * Lateness and absence for a month, measured against the shift each person
 * was on. An absence is a working day with no mark and no approved leave and
 * no holiday; late is minutes after the shift start. Org facts, both.
 */
export function attendanceExceptions({ period = today().slice(0, 7) } = {}) {
  const first = `${period}-01`;
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const stop = last < today() ? last : today();
  const employees = q("SELECT e.id, p.display_name, e.hired_at FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.state = 'active'");
  const out = [];
  for (const e of employees) {
    let absent = 0; let lateMinutes = 0; let lateDays = 0;
    for (let d = new Date(`${first}T00:00:00Z`); d.toISOString().slice(0, 10) <= stop; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (e.hired_at && day < e.hired_at) continue;
      const shift = shiftFor(e.id, day);
      const days = shift ? JSON.parse(shift.days) : [0, 1, 2, 3, 4];
      if (!days.includes(d.getUTCDay()) || isHoliday(day)) continue;
      const leave = one(`SELECT 1 AS x FROM time_leave_request WHERE employee_id = ? AND state = 'approved' AND starts <= ? AND ends >= ?`, e.id, day, day);
      if (leave) continue;
      const mark = one('SELECT in_at FROM time_attendance WHERE employee_id = ? AND day = ?', e.id, day);
      if (!mark?.in_at) { absent++; continue; }
      if (shift) {
        const inMin = Number(mark.in_at.slice(11, 13)) * 60 + Number(mark.in_at.slice(14, 16));
        const startMin = Number(shift.starts.slice(0, 2)) * 60 + Number(shift.starts.slice(3, 5));
        if (inMin > startMin + 5) { lateDays++; lateMinutes += inMin - startMin; }
      }
    }
    out.push({ employeeId: e.id, display_name: e.display_name, absent, lateDays, lateMinutes });
  }
  return { period, rows: out };
}

// -------------------------------------------------------------- allowances --

export function addAllowance({ employeeId, kind, amount, currency = 'USD', starts = null, ends = null, actor }) {
  human(actor, 'granting an allowance');
  const emp = activeEmployee(employeeId);
  const usd = round2(Number(amount));
  if (!(usd > 0)) refuse('an allowance is a positive monthly amount');
  exec('INSERT INTO hr_allowance (employee_id, kind, amount, currency, starts, ends, created_by) VALUES (?,?,?,?,?,?,?)',
    emp.id, clean(kind, 20) || 'other', usd, clean(currency, 3) || 'USD', starts || today(), ends, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'allowance', entityId: id, action: 'allowance.granted', actor, detail: { employeeId: emp.id, kind } });
  return one('SELECT * FROM hr_allowance WHERE id = ?', id);
}

export function allowancesFor(employeeId, period) {
  const rows = q(`SELECT amount FROM hr_allowance WHERE employee_id = ? AND substr(starts, 1, 7) <= ? AND (ends IS NULL OR substr(ends, 1, 7) >= ?)`,
    Number(employeeId), period, period);
  return round2(rows.reduce((a, r) => a + r.amount, 0));
}

// ---------------------------------------------------------------- benefits --

export function createBenefitPlan({ name, kind = 'other', employerShare = 0, employeeShare = 0, provider = null, actor }) {
  if (!actor) refuse('a plan is created by somebody');
  exec('INSERT INTO hr_benefit_plan (name, kind, employer_share, employee_share, provider) VALUES (?,?,?,?,?)',
    clean(name) || 'Plan', clean(kind, 20), round2(Number(employerShare) || 0), round2(Number(employeeShare) || 0), provider ? clean(provider) : null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'benefit_plan', entityId: id, action: 'benefit.plan_created', actor });
  return one('SELECT * FROM hr_benefit_plan WHERE id = ?', id);
}

export const listBenefitPlans = () => q("SELECT p.*, (SELECT COUNT(*) FROM hr_benefit_enrollment e WHERE e.plan_id = p.id AND e.ends IS NULL) AS enrolled FROM hr_benefit_plan p WHERE p.state = 'active' ORDER BY p.id");

export function enroll({ employeeId, planId, starts = null, actor }) {
  if (!actor) refuse('enrolling somebody carries a name');
  const emp = activeEmployee(employeeId);
  if (!one("SELECT id FROM hr_benefit_plan WHERE id = ? AND state = 'active'", Number(planId))) refuse('no such active plan');
  if (one('SELECT id FROM hr_benefit_enrollment WHERE employee_id = ? AND plan_id = ? AND ends IS NULL', emp.id, Number(planId))) refuse('already enrolled');
  exec('INSERT INTO hr_benefit_enrollment (employee_id, plan_id, starts, created_by) VALUES (?,?,?,?)', emp.id, Number(planId), starts || today(), String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'enrollment', entityId: id, action: 'benefit.enrolled', actor, detail: { employeeId: emp.id, planId: Number(planId) } });
  return one('SELECT * FROM hr_benefit_enrollment WHERE id = ?', id);
}

export function endEnrollment(id, { actor }) {
  if (!actor) refuse('ending an enrollment carries a name');
  const row = one('SELECT * FROM hr_benefit_enrollment WHERE id = ? AND ends IS NULL', Number(id));
  if (!row) refuse('no such open enrollment');
  exec('UPDATE hr_benefit_enrollment SET ends = ? WHERE id = ?', today(), row.id);
  log({ entity: 'enrollment', entityId: row.id, action: 'benefit.ended', actor });
  return one('SELECT * FROM hr_benefit_enrollment WHERE id = ?', row.id);
}

/** What the employee pays and what the company pays, per month, for a period. */
export function benefitsFor(employeeId, period) {
  const rows = q(`SELECT p.employer_share, p.employee_share FROM hr_benefit_enrollment e JOIN hr_benefit_plan p ON p.id = e.plan_id
                   WHERE e.employee_id = ? AND substr(e.starts, 1, 7) <= ? AND (e.ends IS NULL OR substr(e.ends, 1, 7) >= ?)`,
    Number(employeeId), period, period);
  return {
    employee: round2(rows.reduce((a, r) => a + r.employee_share, 0)),
    employer: round2(rows.reduce((a, r) => a + r.employer_share, 0)),
  };
}

// --------------------------------------------------------------------- tax --

/**
 * Placeholder brackets, seeded once and editable on the screen. They exist so
 * the payroll formula has a real tax line from day one; they are not a claim
 * about any jurisdiction's law, and the screen says so.
 */
export function seedTaxBrackets() {
  if (one('SELECT id FROM pay_tax_bracket LIMIT 1')) return 0;
  const IQ = [[250, 0.03], [500, 0.05], [1000, 0.10], [null, 0.15]];
  IQ.forEach(([upTo, rate], i) => exec('INSERT INTO pay_tax_bracket (jurisdiction, ordinal, up_to, rate) VALUES (?,?,?,?)', 'IQ', i, upTo, rate));
  return IQ.length;
}

export function setTaxBrackets({ jurisdiction, brackets, actor }) {
  human(actor, 'changing the tax table');
  const j = clean(jurisdiction, 8).toUpperCase();
  if (!j) refuse('a jurisdiction code is needed');
  if (!Array.isArray(brackets) || !brackets.length) refuse('at least one bracket');
  exec('DELETE FROM pay_tax_bracket WHERE jurisdiction = ?', j);
  brackets.forEach((b, i) => exec('INSERT INTO pay_tax_bracket (jurisdiction, ordinal, up_to, rate) VALUES (?,?,?,?)',
    j, i, b.upTo == null ? null : Number(b.upTo), Number(b.rate) || 0));
  log({ entity: 'tax_table', action: 'tax.brackets_set', actor, detail: { jurisdiction: j, brackets: brackets.length }, chain: true });
  return taxBrackets(j);
}

export const taxBrackets = (jurisdiction = 'IQ') => q('SELECT * FROM pay_tax_bracket WHERE jurisdiction = ? ORDER BY ordinal', jurisdiction);

/** Progressive monthly tax on a taxable amount. */
export function taxFor(taxable, jurisdiction = 'IQ') {
  const brackets = taxBrackets(jurisdiction);
  if (!brackets.length) return 0;
  let remaining = Math.max(0, Number(taxable) || 0); let floor = 0; let tax = 0;
  for (const b of brackets) {
    const span = b.up_to == null ? remaining : Math.max(0, Math.min(remaining, b.up_to - floor));
    tax += span * b.rate;
    remaining -= span;
    floor = b.up_to ?? floor;
    if (remaining <= 0) break;
  }
  return round2(tax);
}

/** Everything the payroll formula needs from this module, for one employee. */
export function payrollInputs(employee, period, base) {
  const hourly = base / 30 / 8;
  const ben = benefitsFor(employee.id, period);
  return {
    allowances: allowancesFor(employee.id, period),
    overtime: round2(overtimeFor(employee.id, period) * hourly),
    contributions: ben.employee,
    employer: ben.employer,
    tax: (taxable) => taxFor(taxable, employee.jurisdiction || 'IQ'),
  };
}

// --------------------------------------------------------- salary changes --

/**
 * The raise. Categorically human at the gateway; asserted again here. Both
 * figures are sealed under the person; the chain records that it happened.
 */
export function changeSalary({ employeeId, newSalary, effective = null, actor }) {
  human(actor, 'changing a salary');
  const emp = activeEmployee(employeeId);
  const next = round2(Number(newSalary));
  if (!(next >= 0)) refuse('a salary is a number');
  const seal = sealerFor(emp);
  exec('INSERT INTO hr_salary_change (employee_id, old_salary, new_salary, effective, changed_by, subject_ref) VALUES (?,?,?,?,?,?)',
    emp.id, emp.base_salary, seal(String(next)), effective || today(), String(actor), emp.subject_ref);
  const id = one('SELECT last_insert_rowid() AS id').id;
  exec('UPDATE hr_employee SET base_salary = ? WHERE id = ?', seal(String(next)), emp.id);
  log({ entity: 'employee', entityId: emp.id, action: 'salary.changed', actor, detail: { changeId: id, effective: effective || today() }, chain: true });
  emit('salary.changed', { id: emp.id, changeId: id });
  return { id, employeeId: emp.id, effective: effective || today(), changedBy: String(actor) };
}

/** The history, opened for the permission-checked route. */
export function salaryHistory(employeeId) {
  return q('SELECT * FROM hr_salary_change WHERE employee_id = ? ORDER BY id DESC', Number(employeeId))
    .map((r) => ({ id: r.id, effective: r.effective, changed_by: r.changed_by, old: r.old_salary ? Number(openPii(r.old_salary)) || openPii(r.old_salary) : null, new: r.new_salary ? Number(openPii(r.new_salary)) || openPii(r.new_salary) : null }));
}

// --------------------------------------------------------------- movements --

export function recordMovement({ employeeId, kind, toUnit = null, toPosition = null, toGrade = null, effective = null, actor }) {
  human(actor, 'moving somebody in the organization');
  const emp = activeEmployee(employeeId);
  if (!['promotion', 'transfer', 'regrade', 'demotion', 'acting'].includes(kind)) refuse('kind is promotion, transfer, regrade, demotion or acting');
  if (toUnit && !one('SELECT id FROM hr_org_unit WHERE id = ?', Number(toUnit))) refuse('no such unit');
  if (toPosition && !one('SELECT id FROM hr_position WHERE id = ?', Number(toPosition))) refuse('no such position');
  if (toGrade && !one('SELECT id FROM hr_grade WHERE id = ?', Number(toGrade))) refuse('no such grade');
  exec(`INSERT INTO hr_movement (employee_id, kind, from_unit, to_unit, from_position, to_position, from_grade, to_grade, effective, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    emp.id, kind, emp.org_unit_id, toUnit ? Number(toUnit) : emp.org_unit_id, emp.position_id, toPosition ? Number(toPosition) : emp.position_id,
    emp.grade_id, toGrade ? Number(toGrade) : emp.grade_id, effective || today(), String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  if (kind !== 'acting') {
    exec('UPDATE hr_employee SET org_unit_id = COALESCE(?, org_unit_id), position_id = COALESCE(?, position_id), grade_id = COALESCE(?, grade_id) WHERE id = ?',
      toUnit ? Number(toUnit) : null, toPosition ? Number(toPosition) : null, toGrade ? Number(toGrade) : null, emp.id);
  }
  log({ entity: 'employee', entityId: emp.id, action: `employee.${kind}`, actor, detail: { movementId: id }, chain: kind === 'promotion' || kind === 'demotion' });
  if (kind === 'promotion') emit('employee.promoted', { id: emp.id });
  emit('org.changed', { id: emp.id, movementId: id });
  return one('SELECT * FROM hr_movement WHERE id = ?', id);
}

export const movementsFor = (employeeId) => q('SELECT * FROM hr_movement WHERE employee_id = ? ORDER BY id DESC', Number(employeeId));

// ---------------------------------------------------------- end of service --

/**
 * Years of service times the days-per-year the policy names times a day's pay.
 * The days-per-year is a setting because it is a matter of law and contract,
 * and the amount is sealed because it is one person's money.
 */
export function computeEos({ employeeId, actor }) {
  if (!actor) refuse('computing end of service carries a name');
  const emp = one("SELECT e.*, p.subject_ref, p.personal_email, p.personal_phone FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ?", Number(employeeId));
  if (!emp) refuse('no such employee');
  const start = new Date(`${emp.hired_at || today()}T00:00:00Z`);
  const end = new Date(`${(emp.ended_at || today()).slice(0, 10)}T00:00:00Z`);
  const years = Math.max(0, round2((end - start) / (365.25 * 86400000)));
  const daysPerYear = Number(getSetting('EOS_DAYS_PER_YEAR') || 14);
  const base = Number(openPii(emp.base_salary)) || 0;
  const amount = round2(years * daysPerYear * (base / 30));
  const sealed = emp.subject_ref ? sealForRef(String(amount), emp.subject_ref) : String(amount);
  exec(`INSERT INTO hr_eos (employee_id, years, days_per_year, amount, subject_ref) VALUES (?,?,?,?,?)
        ON CONFLICT(employee_id) DO UPDATE SET years = excluded.years, days_per_year = excluded.days_per_year, amount = excluded.amount, computed_at = datetime('now')`,
    emp.id, years, daysPerYear, sealed, emp.subject_ref);
  log({ entity: 'eos', entityId: emp.id, action: 'eos.computed', actor, detail: { years, daysPerYear } });
  return { employeeId: emp.id, years, daysPerYear, amount };
}

export function payEos(employeeId, { actor }) {
  human(actor, 'paying end of service');
  const row = one('SELECT * FROM hr_eos WHERE employee_id = ?', Number(employeeId));
  if (!row) refuse('compute end of service first');
  if (row.paid_at) refuse('already paid');
  exec("UPDATE hr_eos SET paid_by = ?, paid_at = datetime('now') WHERE id = ?", String(actor), row.id);
  log({ entity: 'eos', entityId: row.employee_id, action: 'eos.paid', actor, chain: true });
  // The event carries no amount: it is one person's money. The bridge opens
  // the sealed figure at posting time and the memo names the employment only.
  emit('eos.paid', { id: row.employee_id });
  return { ...row, amount: Number(openPii(row.amount)) || openPii(row.amount) };
}

export const eosFor = (employeeId) => {
  const row = one('SELECT * FROM hr_eos WHERE employee_id = ?', Number(employeeId));
  return row ? { ...row, amount: Number(openPii(row.amount)) || openPii(row.amount) } : null;
};

// -------------------------------------------------------------- grievances --

export function openGrievance({ employeeId, title, body, actor }) {
  if (!actor) refuse('a grievance is raised by somebody');
  const emp = activeEmployee(employeeId);
  const doc = createDocument({ title: clean(title) || 'Grievance', classification: 'restricted', subjectPersonId: emp.person_id, body, actor });
  exec('INSERT INTO hr_grievance (employee_id, doc_id) VALUES (?,?)', emp.id, doc.id);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'grievance', entityId: id, action: 'grievance.opened', actor, detail: { employeeId: emp.id } });
  emit('grievance.opened', { id });
  return one('SELECT * FROM hr_grievance WHERE id = ?', id);
}

export function decideGrievance(id, { state, actor }) {
  human(actor, 'deciding a grievance');
  const row = one('SELECT * FROM hr_grievance WHERE id = ?', Number(id));
  if (!row) refuse('no such grievance');
  if (!['under_review', 'resolved', 'dismissed'].includes(state)) refuse('state is under_review, resolved or dismissed');
  if (['resolved', 'dismissed'].includes(row.state)) refuse(`already ${row.state}`);
  exec("UPDATE hr_grievance SET state = ?, decided_by = ?, decided_at = CASE WHEN ? IN ('resolved','dismissed') THEN datetime('now') ELSE decided_at END WHERE id = ?",
    state, String(actor), state, row.id);
  log({ entity: 'grievance', entityId: row.id, action: `grievance.${state}`, actor, chain: state !== 'under_review' });
  return one('SELECT * FROM hr_grievance WHERE id = ?', row.id);
}

export const listGrievances = () => q(`SELECT g.*, p.display_name FROM hr_grievance g JOIN hr_employee e ON e.id = g.employee_id JOIN hr_person p ON p.id = e.person_id ORDER BY g.id DESC LIMIT 200`);

// ------------------------------------------------------------------ assets --

export function assignAsset({ employeeId, assetId, actor }) {
  if (!actor) refuse('handing over an asset carries a name');
  const emp = activeEmployee(employeeId);
  const asset = one("SELECT id, name FROM assets WHERE id = ? AND state != 'retired'", Number(assetId));
  if (!asset) refuse('no such asset on the register');
  if (one('SELECT id FROM hr_asset_assignment WHERE asset_id = ? AND returned_at IS NULL', asset.id)) refuse('this asset is already held by somebody');
  exec('INSERT INTO hr_asset_assignment (employee_id, asset_id, assigned_by) VALUES (?,?,?)', emp.id, asset.id, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  // Core 1's register names an owner; keep it true. Display name is Tier B.
  exec('UPDATE assets SET owner = ? WHERE id = ?', emp.display_name, asset.id);
  log({ entity: 'asset_assignment', entityId: id, action: 'asset.assigned', actor, detail: { employeeId: emp.id, assetId: asset.id } });
  return one('SELECT * FROM hr_asset_assignment WHERE id = ?', id);
}

export function returnAsset(id, { actor }) {
  if (!actor) refuse('returning an asset carries a name');
  const row = one('SELECT * FROM hr_asset_assignment WHERE id = ? AND returned_at IS NULL', Number(id));
  if (!row) refuse('no such open assignment');
  exec("UPDATE hr_asset_assignment SET returned_at = datetime('now') WHERE id = ?", row.id);
  log({ entity: 'asset_assignment', entityId: row.id, action: 'asset.returned', actor });
  return one('SELECT * FROM hr_asset_assignment WHERE id = ?', row.id);
}

export const assetsFor = (employeeId) => q(`SELECT h.*, a.name, a.kind FROM hr_asset_assignment h JOIN assets a ON a.id = h.asset_id
  WHERE h.employee_id = ? ORDER BY h.returned_at IS NOT NULL, h.id DESC`, Number(employeeId));

// ------------------------------------------------------------------ letters --

/** An employment certificate: org facts only. Never the salary. */
export function employmentLetter({ employeeId, actor }) {
  if (!actor) refuse('a letter is issued by somebody');
  const raw = getEmployee(Number(employeeId));
  if (!raw) refuse('no such employee');
  const emp = { ...raw, display_name: raw.person?.display_name || one('SELECT display_name FROM hr_person WHERE id = ?', raw.person_id)?.display_name || '—' };
  const pos = emp.position_id ? one('SELECT title FROM hr_position WHERE id = ?', emp.position_id)?.title : null;
  const unit = emp.org_unit_id ? one('SELECT name FROM hr_org_unit WHERE id = ?', emp.org_unit_id)?.name : null;
  const body = [
    'TO WHOM IT MAY CONCERN',
    '',
    `This is to certify that ${emp.display_name} (employee no. ${emp.employee_no}) has been employed by this company since ${emp.hired_at}`
      + `${pos ? ` as ${pos}` : ''}${unit ? ` in ${unit}` : ''}, on a ${emp.employment} basis, and is ${emp.state === 'active' ? 'currently employed' : emp.state}.`,
    '',
    `Issued on ${today()} by ${String(actor).replace(/^human:/, '')}.`,
  ].join('\n');
  const doc = createDocument({ title: `Employment certificate — ${emp.employee_no}`, classification: 'internal', body, actor });
  log({ entity: 'employee', entityId: emp.id, action: 'letter.issued', actor, detail: { docId: doc.id } });
  return doc;
}

// ----------------------------------------------------------------- overview --

export function hrplusOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    shifts: listShifts(),
    holidays: listHolidays(),
    overtimePending: n("SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'pending'"),
    correctionsPending: n("SELECT COUNT(*) AS n FROM time_correction WHERE state = 'pending'"),
    overtime: q(`SELECT o.*, p.display_name FROM time_overtime o JOIN hr_employee e ON e.id = o.employee_id JOIN hr_person p ON p.id = e.person_id ORDER BY o.id DESC LIMIT 50`),
    corrections: q(`SELECT c.*, p.display_name FROM time_correction c JOIN hr_employee e ON e.id = c.employee_id JOIN hr_person p ON p.id = e.person_id ORDER BY c.id DESC LIMIT 50`),
    plans: listBenefitPlans(),
    allowances: n('SELECT COUNT(*) AS n FROM hr_allowance WHERE ends IS NULL'),
    salaryChanges: n('SELECT COUNT(*) AS n FROM hr_salary_change'),
    movements: q(`SELECT m.*, p.display_name FROM hr_movement m JOIN hr_employee e ON e.id = m.employee_id JOIN hr_person p ON p.id = e.person_id ORDER BY m.id DESC LIMIT 30`),
    grievances: listGrievances().map((g) => ({ id: g.id, state: g.state, opened_at: g.opened_at, decided_by: g.decided_by })),
    grievancesOpen: n("SELECT COUNT(*) AS n FROM hr_grievance WHERE state IN ('open','under_review')"),
    assetsHeld: n('SELECT COUNT(*) AS n FROM hr_asset_assignment WHERE returned_at IS NULL'),
    eosComputed: n('SELECT COUNT(*) AS n FROM hr_eos'),
    taxBrackets: taxBrackets('IQ'),
    eosDaysPerYear: Number(getSetting('EOS_DAYS_PER_YEAR') || 14),
    exceptions: attendanceExceptions(),
    note: 'Salaries and their history are sealed under each person. Overtime is minutes on a day; a correction is a time pair; a '
      + 'grievance is a sealed document — there is no column anywhere here for a reason. The tax brackets are data and the seeded '
      + 'figures are placeholders until somebody who knows the law replaces them.',
  };
}
