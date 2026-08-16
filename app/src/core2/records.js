// Records — الأرشفة والاحتفاظ.
//
// Core 1 has an archive: somewhere to put a finished thing so it can be found
// again. That is storage. What an enterprise core needs is the other half —
// **how long each kind of record is kept, on whose authority, and what happens
// at the end.** Payroll for seven years because the tax authority says so. A
// job application for six months because that is what the candidate was told.
// A medical note for as long as the employment and not one day longer.
//
// Without that, "we keep everything" is the default, and it is the expensive
// kind of wrong: every record kept past its purpose is a record that can be
// subpoenaed, breached, or found in discovery, and none of them can be
// defended by saying nobody got round to deleting them.
//
// Three things make this real rather than a document:
//
//   **A basis is required.** A retention period nobody can cite is a guess with
//   a number on it. The field is not optional and it is shown next to the
//   number everywhere the number appears.
//
//   **A legal hold outranks the schedule.** Once a matter is live, records stop
//   being disposable — including records whose retention expired yesterday.
//
//   **A legal hold also outranks the right to erasure, and that conflict is
//   declared rather than resolved.** This is the part most systems get wrong in
//   one of two silent directions: honouring the erasure and destroying evidence,
//   or ignoring it and pretending the request never came. Both are decisions
//   made by an absence of code. Here the erasure is *refused, in writing, with
//   the matter named* — so somebody has to look at it, and the person who asked
//   can be told the truth about why.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/**
 * A starting schedule, drawn from the shapes almost every company needs.
 *
 * Deliberately not jurisdiction-specific: the *periods* here are placeholders a
 * company must replace with its own, and the basis field says so out loud
 * rather than letting a seeded number get mistaken for legal advice.
 */
export const STARTER_CLASSES = [
  ['payroll', 'Payroll and pay slips', 84, 'destroy', 'set locally — most tax authorities require six to seven years'],
  ['contract', 'Employment contracts', 84, 'keep-forever', 'set locally — usually the employment plus a limitation period'],
  ['application', 'Job applications not hired', 6, 'destroy', 'set locally — normally what the candidate was told at the time'],
  ['medical', 'Medical notes and fitness records', 12, 'destroy', 'set locally — special-category data, kept only while it is needed'],
  ['attendance', 'Attendance and leave records', 36, 'anonymise', 'set locally — useful in aggregate long after it is personal'],
  ['expense', 'Expense claims and receipts', 84, 'destroy', 'set locally — usually the same as the tax retention'],
  ['procurement', 'Purchase requests and approvals', 84, 'destroy', 'set locally'],
  ['meeting', 'Meeting minutes and transcripts', 24, 'destroy', 'set locally'],
  ['document', 'Policies and internal documents', 120, 'keep-forever', 'set locally — the current version, and the history of what changed'],
];

export function seedClasses({ actor = 'system:records' } = {}) {
  if (one('SELECT code FROM rec_class LIMIT 1')) return 0;
  let n = 0;
  for (const [code, label, months, disposition, basis] of STARTER_CLASSES) {
    exec('INSERT INTO rec_class (code, label, keep_months, disposition, basis, created_by) VALUES (?,?,?,?,?,?)',
      code, label, months, disposition, basis, actor);
    n += 1;
  }
  audit({
    actorType: 'system', actorId: actor, action: 'records.seeded',
    subjectType: 'records', subjectId: 'schedule', payload: { classes: n },
  });
  return n;
}

export function setClass({ code, label, keepMonths, disposition = 'destroy', basis, appliesTo = null, actor }) {
  if (!actor) refuse('a retention rule has to be signed');
  if (!code || !label) refuse('a retention class needs a code and a name');
  if (!Number.isFinite(Number(keepMonths)) || Number(keepMonths) < 0) refuse('how many months?');
  if (!['destroy', 'anonymise', 'keep-forever'].includes(disposition)) {
    refuse('at the end a record is destroyed, anonymised, or kept for good');
  }
  // Not paperwork. A number with no authority behind it is the thing people
  // argue about in a deposition.
  if (!basis || !String(basis).trim()) refuse('say what says so — a retention period nobody can cite is a guess with a number on it');

  const existed = one('SELECT code FROM rec_class WHERE code = ?', code);
  exec(
    `INSERT INTO rec_class (code, label, keep_months, disposition, basis, applies_to, created_by)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label, keep_months = excluded.keep_months,
       disposition = excluded.disposition, basis = excluded.basis, applies_to = excluded.applies_to`,
    code, label, Number(keepMonths), disposition, basis, appliesTo ? JSON.stringify(appliesTo) : null, actor,
  );
  audit({
    actorType: 'human', actorId: actor, action: existed ? 'records.class_changed' : 'records.class_added',
    subjectType: 'records', subjectId: code,
    payload: { label, keepMonths: Number(keepMonths), disposition, basis: String(basis).slice(0, 200) },
  });
  return { ok: true, code };
}

// ------------------------------------------------------------- legal holds --

export const HOLD_SCOPES = ['person', 'employee', 'class', 'everything'];

/**
 * Freeze disposal.
 *
 * Coarse on purpose. A hold that is fiddly to place is a hold somebody places
 * on Monday for something that mattered on Friday.
 */
export function placeHold({ scopeKind, scopeId = null, reason, matter = null, actor }) {
  if (!actor) refuse('a legal hold has to be signed');
  if (!HOLD_SCOPES.includes(scopeKind)) refuse(`a hold covers one of: ${HOLD_SCOPES.join(', ')}`);
  if (scopeKind !== 'everything' && !scopeId) refuse('say which one');
  if (!reason || !String(reason).trim()) refuse('say why — a hold nobody can explain never gets lifted');

  const id = Number(exec(
    'INSERT INTO rec_hold (scope_kind, scope_id, reason, matter, placed_by) VALUES (?,?,?,?,?)',
    scopeKind, scopeId ? String(scopeId) : null, reason, matter, actor,
  ).lastInsertRowid);

  audit({
    actorType: 'human', actorId: actor, action: 'records.hold_placed',
    subjectType: 'hold', subjectId: String(id),
    payload: { scopeKind, scopeId, matter, reason: String(reason).slice(0, 200) },
  });
  notify({
    level: 'warn', source: 'records', subjectType: 'hold', subjectId: String(id),
    message: `Legal hold placed on ${scopeKind}${scopeId ? ` ${scopeId}` : ''} — disposal and erasure are frozen`,
  });
  return { ok: true, id };
}

export function releaseHold({ id, actor, note = '' }) {
  if (!actor) refuse('releasing a hold has to be signed');
  const h = one('SELECT * FROM rec_hold WHERE id = ?', id);
  if (!h) { const e = new Error('no such hold'); e.status = 404; throw e; }
  if (h.released_at) return { ok: true, alreadyReleased: true };
  exec("UPDATE rec_hold SET released_by = ?, released_at = datetime('now'), release_note = ? WHERE id = ?", actor, note, id);
  audit({
    actorType: 'human', actorId: actor, action: 'records.hold_released',
    subjectType: 'hold', subjectId: String(id),
    payload: { scopeKind: h.scope_kind, scopeId: h.scope_id, matter: h.matter, note },
  });
  return { ok: true, id };
}

export const liveHolds = () => q('SELECT * FROM rec_hold WHERE released_at IS NULL ORDER BY id DESC');

/**
 * Is this person, employee or class frozen?
 *
 * Returns the holds rather than a boolean, because "you cannot do that" is not
 * an answer anybody can act on — the matter and the person who placed it are.
 */
export function holdsOn({ personId = null, employeeId = null, classCode = null } = {}) {
  const hits = liveHolds().filter((h) => {
    if (h.scope_kind === 'everything') return true;
    if (h.scope_kind === 'person' && personId !== null) return String(h.scope_id) === String(personId);
    if (h.scope_kind === 'employee' && employeeId !== null) return String(h.scope_id) === String(employeeId);
    if (h.scope_kind === 'class' && classCode !== null) return String(h.scope_id) === String(classCode);
    return false;
  });
  return hits;
}

/**
 * The interlock: may this person be erased?
 *
 * Called by the erasure path before anything is destroyed. It answers in words,
 * because the person who asked to be forgotten is owed a reason and "no" on its
 * own is not one.
 */
export function erasureAllowed({ personId = null, employeeId = null } = {}) {
  const held = holdsOn({ personId, employeeId });
  if (!held.length) return { allowed: true };
  return {
    allowed: false,
    holds: held.map((h) => ({ id: h.id, matter: h.matter, reason: h.reason, placedBy: h.placed_by, placedAt: h.placed_at })),
    // Written for a person to read and send on, not for a log.
    say: `This cannot be erased while a legal hold is in force${held[0].matter ? ` for ${held[0].matter}` : ''}. `
      + 'The request is recorded and stands; it is carried out when the hold is released. '
      + 'A right to erasure does not override an obligation to preserve evidence, and pretending otherwise '
      + 'would destroy the record instead of the data.',
  };
}

// --------------------------------------------------------------- disposal --

/**
 * What is past its keep-by date, per class, and what is frozen.
 *
 * Nothing is deleted here. This is the list a person reviews — a schedule that
 * disposes automatically is a schedule that destroys the wrong thing on a
 * public holiday.
 */
export function dueForDisposition() {
  const classes = q('SELECT * FROM rec_class ORDER BY code');
  const frozen = liveHolds();
  const everything = frozen.some((h) => h.scope_kind === 'everything');

  // Counted from the table that actually owns each kind of record. A class with
  // no counter reports nothing rather than guessing — a made-up "0 due" and a
  // real "0 due" look identical, which is the wrong way for a schedule to be
  // wrong.
  const COUNTERS = {
    payroll: (cut) => one('SELECT COUNT(*) AS n FROM pay_slip s JOIN pay_run r ON r.id = s.run_id WHERE r.created_at < ?', cut),
    application: (cut) => one('SELECT COUNT(*) AS n FROM rec_application WHERE created_at < ?', cut),
    attendance: (cut) => one('SELECT COUNT(*) AS n FROM time_attendance WHERE created_at < ?', cut),
    expense: (cut) => one('SELECT COUNT(*) AS n FROM fin_expense WHERE created_at < ?', cut),
    procurement: (cut) => one('SELECT COUNT(*) AS n FROM proc_request WHERE created_at < ?', cut),
    meeting: (cut) => one('SELECT COUNT(*) AS n FROM mtg_meeting WHERE created_at < ?', cut),
    document: (cut) => one('SELECT COUNT(*) AS n FROM doc_document WHERE created_at < ?', cut),
  };

  return classes.map((c) => {
    const cut = new Date(Date.now() - c.keep_months * 30.44 * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
    let due = 0;
    if (c.disposition !== 'keep-forever' && COUNTERS[c.code]) {
      try { due = COUNTERS[c.code](cut)?.n || 0; } catch { due = 0; }
    }
    const classHold = everything || frozen.some((h) => h.scope_kind === 'class' && h.scope_id === c.code);
    return {
      ...c,
      appliesTo: (() => { try { return JSON.parse(c.applies_to || 'null'); } catch { return null; } })(),
      cutoff: cut,
      due,
      frozen: classHold,
      counted: Boolean(COUNTERS[c.code]),
      // The two together are the only honest summary: how much is overdue, and
      // whether anybody is allowed to touch it.
      say: c.disposition === 'keep-forever'
        ? 'kept for good'
        : (!COUNTERS[c.code] ? 'nothing counts this class yet, so it reports nothing rather than a comforting zero'
          : (classHold ? `${due} past its date, frozen by a legal hold` : `${due} past its date and disposable`)),
    };
  });
}

/**
 * Record that a disposal happened.
 *
 * This module does not delete anything itself. Destroying records is done by
 * the module that owns them — erasure for personal data, the file store for
 * files — and this is where the fact is written down. A disposal log is the
 * only evidence that a retention policy is a policy rather than a document, and
 * inventing entries for deletions that did not happen would make it worse than
 * nothing.
 */
export function recordDisposal({ classCode, what, ref = null, action = 'destroyed', count = 1, actor }) {
  if (!actor) refuse('a disposal has to be signed');
  if (!one('SELECT code FROM rec_class WHERE code = ?', classCode)) refuse(`no retention class called ${classCode}`);
  const held = holdsOn({ classCode });
  if (held.length) refuse(`${classCode} is under a legal hold (${held[0].matter || held[0].reason}) — nothing may be disposed of`);

  const id = Number(exec(
    'INSERT INTO rec_disposal (class_code, what, ref, action, count, decided_by) VALUES (?,?,?,?,?,?)',
    classCode, what, ref, action, Number(count) || 1, actor,
  ).lastInsertRowid);
  audit({
    actorType: 'human', actorId: actor, action: 'records.disposed',
    subjectType: 'records', subjectId: classCode, payload: { what, ref, action, count },
  });
  return { ok: true, id };
}

export function recordsOverview() {
  const holds = liveHolds();
  const schedule = dueForDisposition();
  return {
    classes: schedule,
    holds,
    holdsEver: one('SELECT COUNT(*) AS n FROM rec_hold').n,
    everythingFrozen: holds.some((h) => h.scope_kind === 'everything'),
    dueTotal: schedule.reduce((n, c) => n + (c.frozen ? 0 : c.due), 0),
    frozenTotal: schedule.reduce((n, c) => n + (c.frozen ? c.due : 0), 0),
    disposals: q('SELECT * FROM rec_disposal ORDER BY id DESC LIMIT 20'),
    scopes: HOLD_SCOPES,
    dispositions: ['destroy', 'anonymise', 'keep-forever'],
    // Stated where whoever is deciding can read it, rather than in a wiki.
    says: 'Nothing here deletes anything. This is the schedule and the review list; disposal is carried out by '
      + 'the module that owns the records, and written down here afterwards. A legal hold outranks the schedule '
      + 'and outranks a request to be forgotten — and where it does, the request is refused in writing with the '
      + 'matter named, never silently ignored and never silently honoured.',
  };
}
