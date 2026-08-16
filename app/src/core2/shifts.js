// Shifts and overtime — الورديات والعمل الإضافي.
//
// `time_shift` has existed since Phase 2 and nothing ever read it. NEXT.md was
// honest about that — "a hook, not a feature" — and a hook nobody hangs anything
// on is a table that makes the system look more finished than it is.
//
// What it takes to be a feature is not the schedule. It is the answer to *"was
// this person late, and did they work longer than they were asked to"*, because
// that answer becomes money in the next payroll run. So:
//
//   - a shift is assigned to a person for a period, not owned by them for ever
//   - attendance is compared against the shift they were actually on that day
//   - overtime is computed, and **it is not the same as staying late**
//
// That last one is the whole design. Minutes past the end of a shift are not
// overtime unless somebody asked for them: an employee who stays an extra hour
// because the traffic is bad has not earned an hour's pay, and a system that
// pays it teaches everybody to leave late. So extra minutes are *recorded* and
// wait for approval, and only approved minutes reach the payroll.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { getSetting } from '../settings.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 'HH:MM' → minutes past midnight. */
const mins = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export function createShift({ name, starts, ends, days = [1, 2, 3, 4, 5], actor }) {
  if (!actor) refuse('a shift has to be signed');
  if (!name?.trim()) refuse('a shift needs a name');
  if (mins(starts) === null || mins(ends) === null) refuse('a shift starts and ends at HH:MM');
  if (!Array.isArray(days) || !days.length) refuse('which days?');
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) refuse('a day is 0 (Sunday) to 6 (Saturday)');

  const id = Number(exec(
    'INSERT INTO time_shift (name, starts, ends, days) VALUES (?,?,?,?)',
    name.trim(), starts, ends, JSON.stringify(days),
  ).lastInsertRowid);
  audit({
    actorType: 'human', actorId: actor, action: 'shift.created',
    subjectType: 'shift', subjectId: String(id), payload: { name, starts, ends, days },
  });
  return { ok: true, id };
}

/**
 * Put somebody on a shift, from a date.
 *
 * Assignments are dated rather than replaced, so last month's attendance is
 * still judged against the shift that was actually in force then. Overwriting
 * would silently rewrite whether somebody was late in March.
 */
export function assignShift({ employeeId, shiftId, from, to = null, actor }) {
  if (!actor) refuse('assigning a shift has to be signed');
  if (!one('SELECT id FROM hr_employee WHERE id = ?', employeeId)) refuse('no such employee');
  if (!one('SELECT id FROM time_shift WHERE id = ?', shiftId)) refuse('no such shift');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) refuse('from which day? (YYYY-MM-DD)');
  if (to && to < from) refuse('that assignment ends before it starts');

  // Close whatever they were on, rather than leaving two live assignments and
  // letting the query decide which one wins.
  exec(
    "UPDATE time_shift_assignment SET until = date(?, '-1 day') WHERE employee_id = ? AND (until IS NULL OR until >= ?)",
    from, employeeId, from,
  );
  const id = Number(exec(
    'INSERT INTO time_shift_assignment (employee_id, shift_id, since, until, assigned_by) VALUES (?,?,?,?,?)',
    employeeId, shiftId, from, to, actor,
  ).lastInsertRowid);
  audit({
    actorType: 'human', actorId: actor, action: 'shift.assigned',
    subjectType: 'employee', subjectId: String(employeeId), payload: { shiftId, from, to },
  });
  return { ok: true, id };
}

/** Which shift somebody was on for a given day — the one in force then. */
export function shiftOn(employeeId, day) {
  return one(
    `SELECT s.* FROM time_shift_assignment a JOIN time_shift s ON s.id = a.shift_id
      WHERE a.employee_id = ? AND a.since <= ? AND (a.until IS NULL OR a.until >= ?)
      ORDER BY a.since DESC LIMIT 1`,
    employeeId, day, day,
  );
}

/**
 * Judge one day against the shift that was in force.
 *
 * Returns nulls rather than zeros when there is no shift to judge against:
 * somebody on no roster is not "0 minutes late", they are simply not on a
 * roster, and a zero would put them in the on-time column of every report.
 */
export function judgeDay(employeeId, day) {
  const att = one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', employeeId, day);
  if (!att) return { day, worked: null, note: 'no attendance recorded' };
  const shift = shiftOn(employeeId, day);
  if (!shift) return { day, worked: att.minutes, late: null, extra: null, note: 'not on a roster that day' };

  const days = (() => { try { return JSON.parse(shift.days); } catch { return []; } })();
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const rostered = days.includes(dow);

  const inAt = mins(String(att.in_at || '').slice(11, 16));
  const outAt = mins(String(att.out_at || '').slice(11, 16));
  const start = mins(shift.starts);
  const end = mins(shift.ends);
  const grace = Number(getSetting('SHIFT_GRACE_MINUTES') || 10);

  return {
    day,
    shift: { id: shift.id, name: shift.name, starts: shift.starts, ends: shift.ends },
    rostered,
    worked: att.minutes,
    // Grace is a real policy, not a rounding error: a company that counts one
    // minute as late spends its mornings arguing about clocks.
    late: rostered && inAt !== null ? Math.max(0, inAt - start - grace) : null,
    leftEarly: rostered && outAt !== null ? Math.max(0, end - outAt) : null,
    // Minutes beyond the shift. Deliberately called extra, not overtime — see
    // the note at the top of this file. A day that was never rostered is all
    // extra, because none of it was asked for.
    extra: outAt !== null ? Math.max(0, rostered ? outAt - end : (att.minutes || 0)) : null,
  };
}

/**
 * Log extra minutes for approval.
 *
 * Nothing computes its way into somebody's pay. A claim is raised, a person
 * approves it, and only then does payroll see it.
 */
export function claimOvertime({ employeeId, day, minutes, reason, actor }) {
  if (!actor) refuse('an overtime claim has to be signed');
  if (!one('SELECT id FROM hr_employee WHERE id = ?', employeeId)) refuse('no such employee');
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) refuse('how many minutes?');
  if (!reason?.trim()) refuse('say what the extra hours were for — unexplained overtime is the first line of every payroll dispute');
  if (one('SELECT id FROM time_overtime WHERE employee_id = ? AND day = ?', employeeId, day)) {
    refuse('there is already a claim for that day');
  }
  const id = Number(exec(
    "INSERT INTO time_overtime (employee_id, day, minutes, reason, state, claimed_by) VALUES (?,?,?,?,'claimed',?)",
    employeeId, day, Math.round(Number(minutes)), reason.trim(), actor,
  ).lastInsertRowid);
  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'overtime.claimed',
    subjectType: 'employee', subjectId: String(employeeId), payload: { day, minutes, reason: reason.slice(0, 160) },
  });
  return { ok: true, id };
}

export function decideOvertime(id, { approve, actor, note = '' }) {
  if (!actor || !String(actor).startsWith('human')) refuse('only a person may approve overtime — it is money');
  const c = one('SELECT * FROM time_overtime WHERE id = ?', id);
  if (!c) { const e = new Error('no such claim'); e.status = 404; throw e; }
  if (c.state !== 'claimed') refuse(`that claim is already ${c.state}`);
  // Nobody signs off their own extra hours. The oldest control there is, and
  // the one every payroll fraud case starts by finding missing.
  if (c.claimed_by === actor) refuse('somebody else has to approve your own overtime');

  exec("UPDATE time_overtime SET state = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?",
    approve ? 'approved' : 'refused', actor, note, id);
  audit({
    actorType: 'human', actorId: actor, action: approve ? 'overtime.approved' : 'overtime.refused',
    subjectType: 'employee', subjectId: String(c.employee_id), payload: { day: c.day, minutes: c.minutes, note },
  });
  return { ok: true, id, state: approve ? 'approved' : 'refused' };
}

/** Approved minutes for a period — what payroll is allowed to see. */
export function approvedOvertime(employeeId, period) {
  return one(
    "SELECT COALESCE(SUM(minutes), 0) AS minutes FROM time_overtime WHERE employee_id = ? AND state = 'approved' AND day LIKE ?",
    employeeId, `${period}%`,
  ).minutes;
}

export function shiftsOverview({ period = null } = {}) {
  const p = period || new Date().toISOString().slice(0, 7);
  const shifts = q('SELECT * FROM time_shift ORDER BY starts').map((s) => ({
    ...s,
    days: (() => { try { return JSON.parse(s.days); } catch { return []; } })(),
    assigned: one("SELECT COUNT(*) AS n FROM time_shift_assignment WHERE shift_id = ? AND (until IS NULL OR until >= date('now'))", s.id).n,
  }));
  const unrostered = one(
    `SELECT COUNT(*) AS n FROM hr_employee e WHERE e.state = 'active'
       AND NOT EXISTS (SELECT 1 FROM time_shift_assignment a WHERE a.employee_id = e.id AND (a.until IS NULL OR a.until >= date('now')))`,
  ).n;
  return {
    period: p,
    shifts,
    graceMinutes: Number(getSetting('SHIFT_GRACE_MINUTES') || 10),
    // Said rather than hidden: an employee on no roster cannot be late and
    // cannot claim overtime against a shift, and a company should know how many
    // of those it has.
    unrostered,
    pending: q(`SELECT o.*, p.display_name FROM time_overtime o
                JOIN hr_employee e ON e.id = o.employee_id JOIN hr_person p ON p.id = e.person_id
                WHERE o.state = 'claimed' ORDER BY o.day`),
    approvedThisPeriod: one(
      "SELECT COALESCE(SUM(minutes),0) AS m, COUNT(*) AS n FROM time_overtime WHERE state = 'approved' AND day LIKE ?", `${p}%`,
    ),
    refusedThisPeriod: one(
      "SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'refused' AND day LIKE ?", `${p}%`,
    ).n,
    says: 'Minutes past the end of a shift are recorded but are not overtime until somebody approves them. '
      + 'Paying every late departure teaches everybody to leave late, and nobody signs off their own hours.',
  };
}
