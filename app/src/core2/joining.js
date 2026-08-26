// Joining and leaving — الالتحاق والمغادرة.
//
// A first day and a last day are the two moments where a company either looks
// organised or does not, and they are the two most commonly held in somebody's
// head. The cost of the head is not the forgotten welcome email — it is the
// account nobody closed, the laptop nobody asked for back, and the payroll that
// paid somebody for a month after they left.
//
// So both are checklists, generated from a template when the employment starts
// or ends, with an owner and a due day on each step. Two things make it more
// than a to-do list:
//
//   **Leaving is blocked by what is still open.** Custody outstanding, and the
//   steps that must be done rather than merely should be. An offboarding that
//   closes over an open laptop is how a company learns about its hardware a
//   year later.
//
//   **The steps that matter are marked as such and cannot be skipped quietly.**
//   Anybody may tick "introduce to the team". Revoking access is not that kind
//   of step, and closing the checklist without it is refused by name.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/**
 * The starting templates.
 *
 * Ordinary steps a company would recognise, plus the handful that are marked
 * `critical` because getting them wrong costs money or opens a door: access,
 * payroll, and the company's things.
 */
export const TEMPLATES = {
  joining: [
    ['contract-signed', 'Signed contract on file', 'hr', -3, true],
    ['identity-checked', 'Right to work and identity checked', 'hr', -1, true],
    ['payroll-set-up', 'On payroll, with bank details', 'payroll', 0, true],
    ['accounts-created', 'Accounts and access created', 'it', 0, true],
    ['equipment-issued', 'Equipment issued and recorded', 'it', 0, true],
    ['policies-read', 'Handbook and policies acknowledged', 'hr', 3, false],
    ['manager-one-to-one', 'First one-to-one with their manager', 'manager', 5, false],
    ['team-introduced', 'Introduced to the team', 'manager', 1, false],
    ['objectives-set', 'First objectives agreed', 'manager', 14, false],
  ],
  leaving: [
    ['resignation-recorded', 'Resignation or notice on file', 'hr', -14, true],
    ['handover-written', 'Handover written and accepted', 'manager', -3, false],
    ['equipment-returned', 'All equipment returned', 'it', 0, true],
    ['access-revoked', 'Every account and key revoked', 'it', 0, true],
    ['final-pay', 'Final pay and end-of-service calculated', 'payroll', 3, true],
    ['exit-interview', 'Exit interview held', 'hr', 0, false],
    ['records-retained', 'Records moved to the retention schedule', 'hr', 7, false],
  ],
};

const shift = (day, days) => new Date(Date.parse(day) + days * 86400e3).toISOString().slice(0, 10);

/**
 * Start a checklist.
 *
 * One live checklist of each kind per person: two open joinings for the same
 * employee means two people ticking different copies, which is worse than none.
 */
export function start({ employeeId, kind, on, actor }) {
  if (!actor) refuse('starting a checklist has to be signed');
  if (!TEMPLATES[kind]) refuse(`a checklist is one of: ${Object.keys(TEMPLATES).join(', ')}`);
  const emp = one(
    'SELECT e.id, e.hired_at, p.display_name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ?',
    employeeId,
  );
  if (!emp) refuse('no such employee');
  const day = on || emp.hired_at || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) refuse('which day? (YYYY-MM-DD)');

  const live = one("SELECT id FROM join_list WHERE employee_id = ? AND kind = ? AND state = 'open'", employeeId, kind);
  if (live) refuse(`there is already an open ${kind} checklist for ${emp.display_name}`);

  const id = Number(exec(
    "INSERT INTO join_list (employee_id, kind, on_day, state, started_by) VALUES (?,?,?,'open',?)",
    employeeId, kind, day, actor,
  ).lastInsertRowid);

  for (const [code, label, owner, offset, critical] of TEMPLATES[kind]) {
    exec(
      'INSERT INTO join_step (list_id, code, label, owner_role, due_on, critical) VALUES (?,?,?,?,?,?)',
      id, code, label, owner, shift(day, offset), critical ? 1 : 0,
    );
  }
  audit({
    actorType: 'human', actorId: actor, action: `joining.${kind}_started`,
    subjectType: 'employee', subjectId: String(employeeId),
    payload: { listId: id, kind, on: day, steps: TEMPLATES[kind].length },
  });
  return { ok: true, id, steps: TEMPLATES[kind].length };
}

export function tick(stepId, { actor, note = null, skip = false, why = null }) {
  if (!actor) refuse('ticking a step has to be signed');
  const step = one('SELECT * FROM join_step WHERE id = ?', stepId);
  if (!step) { const e = new Error('no such step'); e.status = 404; throw e; }
  if (step.done_at) return { ok: true, alreadyDone: true };

  // A critical step may be skipped — sometimes it genuinely does not apply —
  // but never silently, and never without somebody's name and a reason on it.
  if (skip) {
    if (step.critical && !why?.trim()) refuse(`"${step.label}" is a step that costs money or opens a door — say why it is being skipped`);
    exec("UPDATE join_step SET done_at = datetime('now'), done_by = ?, skipped = 1, note = ? WHERE id = ?", actor, why || note, stepId);
  } else {
    exec("UPDATE join_step SET done_at = datetime('now'), done_by = ?, note = ? WHERE id = ?", actor, note, stepId);
  }
  audit({
    actorType: 'human', actorId: actor, action: skip ? 'joining.step_skipped' : 'joining.step_done',
    subjectType: 'joining', subjectId: String(step.list_id),
    payload: { code: step.code, critical: Boolean(step.critical), why: why || null },
  });
  return { ok: true, id: stepId };
}

/**
 * Close it.
 *
 * Refuses over an unfinished critical step, and over outstanding custody on a
 * leaving list. Both by name: "cannot close" is not something anybody can act
 * on, and the names are the work that remains.
 */
export function close(listId, { actor }) {
  if (!actor) refuse('closing a checklist has to be signed');
  const list = one('SELECT * FROM join_list WHERE id = ?', listId);
  if (!list) { const e = new Error('no such checklist'); e.status = 404; throw e; }
  if (list.state !== 'open') return { ok: true, already: list.state };

  const open = q("SELECT code, label FROM join_step WHERE list_id = ? AND done_at IS NULL AND critical = 1", listId);
  if (open.length) {
    const e = new Error(`still open: ${open.map((s) => s.label).join('; ')}`);
    e.status = 409;
    e.open = open;
    throw e;
  }

  if (list.kind === 'leaving') {
    // Cross-checked against custody rather than against a tick box, because a
    // tick box records that somebody said so.
    const held = q('SELECT id, description, asset_id FROM cust_item WHERE employee_id = ? AND returned_at IS NULL', list.employee_id);
    if (held.length) {
      const e = new Error(`${held.length} item(s) are still out — take them back or write them off before closing`);
      e.status = 409;
      e.holding = held;
      throw e;
    }
  }

  exec("UPDATE join_list SET state = 'closed', closed_by = ?, closed_at = datetime('now') WHERE id = ?", actor, listId);
  audit({
    actorType: 'human', actorId: actor, action: `joining.${list.kind}_closed`,
    subjectType: 'employee', subjectId: String(list.employee_id), payload: { listId },
  });
  return { ok: true, id: listId };
}

export function listDetail(id) {
  const l = one(
    `SELECT j.*, p.display_name FROM join_list j
       JOIN hr_employee e ON e.id = j.employee_id JOIN hr_person p ON p.id = e.person_id WHERE j.id = ?`, id,
  );
  if (!l) { const e = new Error('no such checklist'); e.status = 404; throw e; }
  const steps = q('SELECT * FROM join_step WHERE list_id = ? ORDER BY due_on, id', id);
  return {
    ...l,
    steps,
    done: steps.filter((s) => s.done_at).length,
    // The two numbers that decide whether it can close.
    criticalOpen: steps.filter((s) => s.critical && !s.done_at).map((s) => s.label),
    overdue: steps.filter((s) => !s.done_at && s.due_on < new Date().toISOString().slice(0, 10)).map((s) => s.label),
  };
}

export function joiningOverview() {
  const lists = q(
    `SELECT j.*, p.display_name,
            (SELECT COUNT(*) FROM join_step s WHERE s.list_id = j.id) AS steps,
            (SELECT COUNT(*) FROM join_step s WHERE s.list_id = j.id AND s.done_at IS NOT NULL) AS done,
            (SELECT COUNT(*) FROM join_step s WHERE s.list_id = j.id AND s.done_at IS NULL AND s.critical = 1) AS critical_open
       FROM join_list j JOIN hr_employee e ON e.id = j.employee_id JOIN hr_person p ON p.id = e.person_id
      ORDER BY j.state, j.on_day DESC LIMIT 60`,
  );
  const today = new Date().toISOString().slice(0, 10);
  return {
    lists,
    open: lists.filter((l) => l.state === 'open').length,
    joining: lists.filter((l) => l.kind === 'joining' && l.state === 'open').length,
    leaving: lists.filter((l) => l.kind === 'leaving' && l.state === 'open').length,
    overdue: q(
      `SELECT s.*, j.kind, p.display_name FROM join_step s
         JOIN join_list j ON j.id = s.list_id
         JOIN hr_employee e ON e.id = j.employee_id JOIN hr_person p ON p.id = e.person_id
        WHERE j.state = 'open' AND s.done_at IS NULL AND s.due_on < ? ORDER BY s.due_on LIMIT 40`, today,
    ),
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v.map(([code, label, owner, offset, critical]) => ({ code, label, owner, offset, critical }))])),
    says: 'A step marked critical costs money or opens a door. It may be skipped when it genuinely does not apply, '
      + 'but never silently — a name and a reason go on it. A leaving list will not close while the person still '
      + 'holds company property, checked against the custody register rather than against a tick box.',
  };
}
