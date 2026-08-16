// TIME — attendance and leave. Core 2's second division.
//
// The leave flow is the directive's worked example of the whole architecture:
// an agent may *file* a request on somebody's behalf — through the command
// gateway, with the balance and conflict checks running here — but approving
// it is a human act, always. Not because an agent could not compute the
// answer, but because "your leave was rejected" must never be a sentence with
// nobody behind it.
//
// And there is no free-text reason anywhere in this module. A sick request is
// a category plus an optional pointer to a sealed doctor's note. The platform
// cannot reason about anyone's health because there is no field in which
// health details could exist — minimization as schema, not as policy.
import { q, one, exec } from '../db.js';
import { log } from './identity.js';
import { emit } from './bridge.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------ attendance --

/**
 * Check in. One row per employee per day; checking in twice is answered with
 * the row that already exists rather than an error — arriving is idempotent.
 */
export function checkIn(employeeId, { actor }) {
  if (!actor) refuse('checking in is an act and carries a name');
  const emp = one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(employeeId));
  if (!emp) refuse('no such active employee');
  const day = today();
  const existing = one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', emp.id, day);
  if (existing?.in_at) return existing;
  exec(
    `INSERT INTO time_attendance (employee_id, day, in_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(employee_id, day) DO UPDATE SET in_at = COALESCE(in_at, datetime('now'))`,
    emp.id, day,
  );
  log({ entity: 'attendance', entityId: emp.id, action: 'attendance.in', actor });
  return one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', emp.id, day);
}

export function checkOut(employeeId, { actor }) {
  if (!actor) refuse('checking out is an act and carries a name');
  const day = today();
  const row = one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', Number(employeeId), day);
  if (!row?.in_at) refuse('cannot check out before checking in');
  exec(
    `UPDATE time_attendance SET out_at = datetime('now'),
       minutes = CAST((julianday(datetime('now')) - julianday(in_at)) * 1440 AS INTEGER)
     WHERE id = ?`, row.id,
  );
  log({ entity: 'attendance', entityId: row.employee_id, action: 'attendance.out', actor });
  return one('SELECT * FROM time_attendance WHERE id = ?', row.id);
}

/** Who is in today, who is out, who is on approved leave. */
export function attendanceToday() {
  const day = today();
  const active = q(`SELECT e.id, e.employee_no, p.display_name FROM hr_employee e
                    JOIN hr_person p ON p.id = e.person_id WHERE e.state = 'active'`);
  const marks = new Map(q('SELECT * FROM time_attendance WHERE day = ?', day).map((r) => [r.employee_id, r]));
  const onLeave = new Set(q(
    "SELECT employee_id FROM time_leave_request WHERE state = 'approved' AND starts <= ? AND ends >= ?",
    day, day,
  ).map((r) => r.employee_id));
  return {
    day,
    people: active.map((e) => ({
      ...e,
      in: marks.get(e.id)?.in_at || null,
      out: marks.get(e.id)?.out_at || null,
      onLeave: onLeave.has(e.id),
    })),
    present: active.filter((e) => marks.get(e.id)?.in_at && !onLeave.has(e.id)).length,
    absent: active.filter((e) => !marks.get(e.id)?.in_at && !onLeave.has(e.id)).length,
    onLeave: onLeave.size,
  };
}

// ----------------------------------------------------------------- leave --

export function createPolicy({ name, leaveType, daysPerYear = 0, carryForwardMax = 0, needsDocument = false, actor }) {
  if (!actor) refuse('a leave policy is an act and carries a name');
  exec(
    'INSERT INTO time_leave_policy (name, leave_type, days_per_year, carry_forward_max, needs_document) VALUES (?,?,?,?,?)',
    clean(name), String(leaveType), Number(daysPerYear) || 0, Number(carryForwardMax) || 0, needsDocument ? 1 : 0,
  );
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'leave_policy', entityId: id, action: 'leave.policy_created', actor, detail: { leaveType } });
  return one('SELECT * FROM time_leave_policy WHERE id = ?', id);
}

/** The balance row for one employee, one policy, this year — created on first sight. */
export function balanceFor(employeeId, policyId, year = new Date().getFullYear()) {
  const policy = one('SELECT * FROM time_leave_policy WHERE id = ?', Number(policyId));
  if (!policy) refuse('no such leave policy');
  let b = one('SELECT * FROM time_leave_balance WHERE employee_id = ? AND policy_id = ? AND year = ?',
    Number(employeeId), policy.id, year);
  if (!b) {
    exec('INSERT INTO time_leave_balance (employee_id, policy_id, year, entitled) VALUES (?,?,?,?)',
      Number(employeeId), policy.id, year, policy.days_per_year);
    b = one('SELECT * FROM time_leave_balance WHERE employee_id = ? AND policy_id = ? AND year = ?',
      Number(employeeId), policy.id, year);
  }
  return { ...b, remaining: b.entitled - b.used, policy };
}

const spanDays = (starts, ends) => {
  const a = new Date(`${starts}T00:00:00Z`);
  const b = new Date(`${ends}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
};

/**
 * File a leave request. This is what the agent flow calls through the gateway,
 * and what the screen calls directly — the checks are identical because they
 * are the same function.
 *
 * The checks, in order: the employee exists; the dates make sense; the policy's
 * balance covers it (unpaid types are exempt — there is nothing to deduct);
 * no overlapping request already sits pending or approved; a policy that
 * demands a document gets one, as a sealed reference and never as text.
 */
export function requestLeave({ employeeId, policyId, starts, ends, docId = null, actor }) {
  if (!actor) refuse('a leave request is an act and carries a name');
  const emp = one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(employeeId));
  if (!emp) refuse('no such active employee');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(starts)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(ends))) refuse('dates are YYYY-MM-DD');
  const days = spanDays(starts, ends);
  if (days < 1) refuse('the leave ends before it starts');

  const bal = balanceFor(emp.id, policyId);
  const unpaid = bal.policy.leave_type.startsWith('unpaid');
  if (!unpaid && days > bal.remaining) {
    refuse(`the ${bal.policy.name} balance is ${bal.remaining} day(s); this request needs ${days}`);
  }

  const clash = one(
    `SELECT id FROM time_leave_request WHERE employee_id = ? AND state IN ('pending','approved')
      AND NOT (ends < ? OR starts > ?)`, emp.id, starts, ends,
  );
  if (clash) refuse(`this overlaps request #${clash.id}, which is still ${one('SELECT state FROM time_leave_request WHERE id = ?', clash.id).state}`);

  if (bal.policy.needs_document) {
    const doc = docId ? one('SELECT id, classification FROM doc_document WHERE id = ?', Number(docId)) : null;
    if (!doc) refuse(`${bal.policy.name} needs a supporting document — attach it as a sealed restricted document first`);
    if (doc.classification !== 'restricted') refuse('a supporting document for leave must be restricted, so it stays sealed');
  }

  exec(
    'INSERT INTO time_leave_request (employee_id, policy_id, starts, ends, days, doc_id, created_by) VALUES (?,?,?,?,?,?,?)',
    emp.id, bal.policy.id, starts, ends, days, docId ? Number(docId) : null, String(actor),
  );
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'leave', entityId: id, action: 'leave.requested', actor, detail: { days, type: bal.policy.leave_type } });
  emit('leave.requested', { id, employeeId: emp.id, days });
  return one('SELECT * FROM time_leave_request WHERE id = ?', id);
}

/**
 * Decide a request. A human act, structurally: the actor must be human:*, and
 * no gateway command exists for this — an agent has no path to this function
 * whatever its scopes say.
 */
export function decideLeave(requestId, { approve, actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('deciding leave is a human act, always');
  const r = one("SELECT * FROM time_leave_request WHERE id = ?", Number(requestId));
  if (!r) refuse('no such request');
  if (r.state !== 'pending') refuse(`this request is already ${r.state}`);

  const state = approve ? 'approved' : 'rejected';
  exec("UPDATE time_leave_request SET state = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?",
    state, String(actor), r.id);
  if (approve) {
    const policy = one('SELECT leave_type FROM time_leave_policy WHERE id = ?', r.policy_id);
    if (!policy.leave_type.startsWith('unpaid')) {
      exec('UPDATE time_leave_balance SET used = used + ? WHERE employee_id = ? AND policy_id = ? AND year = ?',
        r.days, r.employee_id, r.policy_id, Number(r.starts.slice(0, 4)));
    }
  }
  log({ entity: 'leave', entityId: r.id, action: `leave.${state}`, actor, detail: { days: r.days }, chain: approve });
  emit(`leave.${state}`, { id: r.id, employeeId: r.employee_id });
  return one('SELECT * FROM time_leave_request WHERE id = ?', r.id);
}

export function listLeave({ state = null, employeeId = null, limit = 200 } = {}) {
  let sql = `SELECT r.*, p.display_name, pol.name AS policy_name, pol.leave_type
               FROM time_leave_request r
               JOIN hr_employee e ON e.id = r.employee_id
               JOIN hr_person p ON p.id = e.person_id
               JOIN time_leave_policy pol ON pol.id = r.policy_id WHERE 1=1`;
  const params = [];
  if (state) { sql += ' AND r.state = ?'; params.push(state); }
  if (employeeId) { sql += ' AND r.employee_id = ?'; params.push(Number(employeeId)); }
  sql += ' ORDER BY r.id DESC LIMIT ?';
  params.push(Number(limit));
  return q(sql, ...params);
}

export function timeOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    attendance: attendanceToday(),
    policies: q('SELECT * FROM time_leave_policy ORDER BY id'),
    pending: n("SELECT COUNT(*) AS n FROM time_leave_request WHERE state = 'pending'"),
    approvedThisYear: n("SELECT COUNT(*) AS n FROM time_leave_request WHERE state = 'approved' AND starts >= ?", `${new Date().getFullYear()}-01-01`),
    note: 'A sick request is a category and, at most, a pointer to a sealed document. There is no reason field '
      + 'anywhere in leave — the platform cannot summarize anyone\'s health because there is nowhere health details '
      + 'could be written. Filing can be delegated to an agent through the gateway; deciding is a human act, always, '
      + 'and no gateway command for it exists.',
  };
}
