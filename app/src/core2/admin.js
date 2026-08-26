// ADMINISTRATION — the registry of letters, the committees and what they
// resolved, the legal cases, the regulatory calendar, the licences, and who
// has acknowledged which policy. And the one page that is about you.
//
// Everything here is a record with a number on it, because administration is
// the department that has to answer "which letter, when, and who signed it"
// years later. Words live in documents; a resolution being adopted, a case
// being settled, are human acts and chained as facts.
import { q, one, exec } from '../db.js';
import { openPii } from '../erasure.js';
import { log } from './identity.js';
import { emit } from './bridge.js';
import { createDocument } from './documents.js';
import { nextRef } from './finance.js';
import { balanceFor } from './time.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const human = (actor, what) => {
  if (!String(actor || '').startsWith('human:')) refuse(`${what} is a human act — an agent may draft it, never do it`);
};
const employeeOk = (id) => {
  if (id == null) return null;
  if (!one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(id))) refuse('no such active employee');
  return Number(id);
};
const unitOk = (id) => {
  if (id == null) return null;
  if (!one('SELECT id FROM hr_org_unit WHERE id = ?', Number(id))) refuse('no such unit');
  return Number(id);
};

// ---------------------------------------------------------- correspondence --

export function registerLetter({ direction = 'in', subject, counterparty, orgUnitId = null, day = null, body = null, actor }) {
  if (!actor) refuse('a letter is registered by somebody');
  if (!['in', 'out'].includes(direction)) refuse('direction is in or out');
  if (!clean(subject)) refuse('a letter has a subject');
  const docId = body ? createDocument({ title: `${direction === 'in' ? 'Incoming' : 'Outgoing'} — ${clean(subject, 80)}`, classification: 'internal', body, actor }).id : null;
  const ref = nextRef('adm_letter', direction === 'in' ? 'IN' : 'OUT');
  exec(`INSERT INTO adm_letter (ref, direction, subject, counterparty, org_unit_id, doc_id, day, state, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    ref, direction, clean(subject, 200), clean(counterparty) || '—', unitOk(orgUnitId), docId, day || today(), direction === 'in' ? 'received' : 'drafted', String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'letter', entityId: id, action: 'letter.registered', actor, detail: { ref, direction } });
  return one('SELECT * FROM adm_letter WHERE id = ?', id);
}

const LETTER_NEXT = { received: ['routed', 'closed'], routed: ['answered', 'closed'], answered: ['closed'], drafted: ['sent'], sent: ['closed'], closed: [] };

export function setLetterState(id, { state, orgUnitId = null, actor }) {
  if (!actor) refuse('moving a letter carries a name');
  const l = one('SELECT * FROM adm_letter WHERE id = ?', Number(id));
  if (!l) refuse('no such letter');
  if (!LETTER_NEXT[l.state].includes(state)) refuse(`a ${l.state} letter cannot become ${state}`);
  if (state === 'sent') human(actor, 'sending a letter');
  exec('UPDATE adm_letter SET state = ?, org_unit_id = COALESCE(?, org_unit_id) WHERE id = ?', state, unitOk(orgUnitId), l.id);
  log({ entity: 'letter', entityId: l.id, action: `letter.${state}`, actor });
  return one('SELECT * FROM adm_letter WHERE id = ?', l.id);
}

export const listLetters = ({ limit = 200 } = {}) => q(`SELECT l.*, u.name AS unit FROM adm_letter l LEFT JOIN hr_org_unit u ON u.id = l.org_unit_id ORDER BY l.id DESC LIMIT ?`, Number(limit));

// -------------------------------------------------------------- committees --

export function createCommittee({ name, chairEmployeeId = null, memberIds = [], actor }) {
  human(actor, 'forming a committee');
  if (!clean(name)) refuse('a committee has a name');
  exec('INSERT INTO adm_committee (name, chair_employee_id) VALUES (?,?)', clean(name), employeeOk(chairEmployeeId));
  const id = one('SELECT last_insert_rowid() AS id').id;
  const members = new Set([...(Array.isArray(memberIds) ? memberIds : []), chairEmployeeId].filter((x) => x != null).map(Number));
  for (const m of members) exec('INSERT OR IGNORE INTO adm_committee_member (committee_id, employee_id) VALUES (?,?)', id, employeeOk(m));
  log({ entity: 'committee', entityId: id, action: 'committee.formed', actor, detail: { members: members.size }, chain: true });
  return getCommittee(id);
}

export function getCommittee(id) {
  const c = one('SELECT c.*, p.display_name AS chair FROM adm_committee c LEFT JOIN hr_employee e ON e.id = c.chair_employee_id LEFT JOIN hr_person p ON p.id = e.person_id WHERE c.id = ?', Number(id));
  if (!c) return null;
  return {
    ...c,
    members: q('SELECT m.employee_id, p.display_name FROM adm_committee_member m JOIN hr_employee e ON e.id = m.employee_id JOIN hr_person p ON p.id = e.person_id WHERE m.committee_id = ?', c.id),
    resolutions: q('SELECT * FROM adm_resolution WHERE committee_id = ? ORDER BY id DESC', c.id),
  };
}

export const listCommittees = () => q('SELECT id FROM adm_committee ORDER BY state, name').map((r) => getCommittee(r.id));

export function proposeResolution({ committeeId, title, body = null, actor }) {
  if (!actor) refuse('a resolution is proposed by somebody');
  const c = one("SELECT * FROM adm_committee WHERE id = ? AND state = 'active'", Number(committeeId));
  if (!c) refuse('no such active committee');
  if (!clean(title)) refuse('a resolution has a title');
  const docId = body ? createDocument({ title: `Resolution — ${clean(title, 80)}`, classification: 'confidential', body, actor }).id : null;
  exec('INSERT INTO adm_resolution (committee_id, ref, title, doc_id, created_by) VALUES (?,?,?,?,?)', c.id, nextRef('adm_resolution', 'RES'), clean(title, 200), docId, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'resolution', entityId: id, action: 'resolution.proposed', actor });
  return one('SELECT * FROM adm_resolution WHERE id = ?', id);
}

/** Adopted or rejected — by a person, on the record, chained. */
export function decideResolution(id, { state, actor }) {
  human(actor, 'deciding a resolution');
  const r = one('SELECT * FROM adm_resolution WHERE id = ?', Number(id));
  if (!r) refuse('no such resolution');
  if (r.state !== 'proposed') refuse(`already ${r.state}`);
  if (!['adopted', 'rejected'].includes(state)) refuse('a resolution is adopted or rejected');
  exec("UPDATE adm_resolution SET state = ?, decided_on = ?, adopted_by = ? WHERE id = ?", state, today(), String(actor), r.id);
  log({ entity: 'resolution', entityId: r.id, action: `resolution.${state}`, actor, detail: { ref: r.ref }, chain: true });
  if (state === 'adopted') emit('resolution.adopted', { id: r.id, ref: r.ref });
  return one('SELECT * FROM adm_resolution WHERE id = ?', r.id);
}

// ------------------------------------------------------------- legal cases --

export function openCase({ kind = 'claim', counterparty, court = null, contractId = null, nextHearing = null, exposure = 0, body = null, actor }) {
  if (!actor) refuse('a case is opened by somebody');
  if (!['litigation', 'arbitration', 'claim', 'regulatory', 'labour'].includes(kind)) refuse('kind is litigation, arbitration, claim, regulatory or labour');
  if (!clean(counterparty)) refuse('a case names a counterparty');
  if (contractId && !one('SELECT id FROM contracts WHERE id = ?', Number(contractId))) refuse('no such contract on Core 1\'s register');
  const docId = body ? createDocument({ title: `Case — ${clean(counterparty, 80)}`, classification: 'confidential', body, actor }).id : null;
  exec(`INSERT INTO adm_case (ref, kind, counterparty, court, contract_id, next_hearing, exposure, doc_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    nextRef('adm_case', 'CASE'), kind, clean(counterparty), court ? clean(court) : null, contractId ? Number(contractId) : null, nextHearing, Math.max(0, Number(exposure) || 0), docId, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'case', entityId: id, action: 'case.opened', actor, detail: { kind }, chain: true });
  emit('case.opened', { id, kind });
  return one('SELECT * FROM adm_case WHERE id = ?', id);
}

export function setCaseState(id, { state, nextHearing = null, exposure = null, actor }) {
  if (!actor) refuse('moving a case carries a name');
  const c = one('SELECT * FROM adm_case WHERE id = ?', Number(id));
  if (!c) refuse('no such case');
  if (!['open', 'hearing', 'settled', 'won', 'lost', 'closed'].includes(state)) refuse('state is open, hearing, settled, won, lost or closed');
  if (['settled', 'won', 'lost', 'closed'].includes(c.state)) refuse(`already ${c.state}`);
  const final = ['settled', 'won', 'lost', 'closed'].includes(state);
  if (final) human(actor, 'concluding a case');
  exec('UPDATE adm_case SET state = ?, next_hearing = COALESCE(?, next_hearing), exposure = COALESCE(?, exposure), decided_by = CASE WHEN ? THEN ? ELSE decided_by END WHERE id = ?',
    state, nextHearing, exposure == null ? null : Math.max(0, Number(exposure)), final ? 1 : 0, String(actor), c.id);
  log({ entity: 'case', entityId: c.id, action: `case.${state}`, actor, chain: final });
  if (state === 'settled') emit('case.settled', { id: c.id });
  return one('SELECT * FROM adm_case WHERE id = ?', c.id);
}

export const listCases = () => q("SELECT * FROM adm_case ORDER BY state IN ('settled','won','lost','closed'), next_hearing, id DESC LIMIT 200");

// ------------------------------------------------- the regulatory calendar --

export function addObligation({ title, authority, due, recurrence = 'none', orgUnitId = null, actor }) {
  if (!actor) refuse('an obligation is recorded by somebody');
  if (!clean(title)) refuse('an obligation has a title');
  if (!isDay(due)) refuse('due is a date');
  if (!['none', 'monthly', 'quarterly', 'yearly'].includes(recurrence)) refuse('recurrence is none, monthly, quarterly or yearly');
  exec('INSERT INTO adm_obligation (title, authority, due, recurrence, org_unit_id, created_by) VALUES (?,?,?,?,?,?)',
    clean(title, 200), clean(authority) || '—', due, recurrence, unitOk(orgUnitId), String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'obligation', entityId: id, action: 'obligation.added', actor });
  return one('SELECT * FROM adm_obligation WHERE id = ?', id);
}

/** Done — and if it recurs, the next one is already on the calendar. */
export function completeObligation(id, { actor }) {
  human(actor, 'discharging an obligation');
  const o = one('SELECT * FROM adm_obligation WHERE id = ?', Number(id));
  if (!o) refuse('no such obligation');
  if (o.state === 'done') refuse('already done');
  exec("UPDATE adm_obligation SET state = 'done', done_by = ?, done_at = datetime('now') WHERE id = ?", String(actor), o.id);
  log({ entity: 'obligation', entityId: o.id, action: 'obligation.done', actor, chain: true });
  if (o.recurrence !== 'none') {
    const step = { monthly: '+1 month', quarterly: '+3 month', yearly: '+1 year' }[o.recurrence];
    const next = one('SELECT date(?, ?) AS d', o.due, step).d;
    exec('INSERT INTO adm_obligation (title, authority, due, recurrence, org_unit_id, created_by) VALUES (?,?,?,?,?,?)', o.title, o.authority, next, o.recurrence, o.org_unit_id, String(actor));
  }
  return one('SELECT * FROM adm_obligation WHERE id = ?', o.id);
}

export const listObligations = () => q(`SELECT o.*, u.name AS unit FROM adm_obligation o LEFT JOIN hr_org_unit u ON u.id = o.org_unit_id ORDER BY o.state = 'done', o.due LIMIT 200`);

/** Overdue is a state the sweep sets; due soon is an event it raises once a day. */
export function obligationSweep({ horizonDays = 14 } = {}) {
  const day = today();
  exec("UPDATE adm_obligation SET state = 'overdue' WHERE state = 'pending' AND due < ?", day);
  const soon = q("SELECT id, title, due FROM adm_obligation WHERE state IN ('pending','overdue') AND due <= date(?, ?)", day, `+${Number(horizonDays)} day`);
  for (const o of soon) emit('obligation.due', { id: o.id, due: o.due }, { idempotency: `obligation-${o.id}-${day}` });
  return { due: soon.length, overdue: one("SELECT COUNT(*) AS n FROM adm_obligation WHERE state = 'overdue'").n };
}

// ---------------------------------------------------------------- licences --

export function addLicense({ name, authority, number = null, issued = null, expires, body = null, actor }) {
  if (!actor) refuse('a licence is recorded by somebody');
  if (!clean(name)) refuse('a licence has a name');
  if (!isDay(expires)) refuse('expires is a date');
  const docId = body ? createDocument({ title: `Licence — ${clean(name, 80)}`, classification: 'internal', body, actor }).id : null;
  exec('INSERT INTO adm_license (name, authority, number, issued, expires, doc_id, created_by) VALUES (?,?,?,?,?,?,?)',
    clean(name), clean(authority) || '—', number ? clean(number, 60) : null, issued, expires, docId, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'license', entityId: id, action: 'license.added', actor });
  return one('SELECT * FROM adm_license WHERE id = ?', id);
}

export function renewLicense(id, { expires, actor }) {
  human(actor, 'renewing a licence');
  const l = one('SELECT * FROM adm_license WHERE id = ?', Number(id));
  if (!l) refuse('no such licence');
  if (!isDay(expires) || expires <= l.expires) refuse('a renewal expires later than the current licence');
  exec("UPDATE adm_license SET state = 'renewed' WHERE id = ?", l.id);
  exec('INSERT INTO adm_license (name, authority, number, issued, expires, doc_id, created_by) VALUES (?,?,?,?,?,?,?)', l.name, l.authority, l.number, today(), expires, l.doc_id, String(actor));
  const nid = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'license', entityId: nid, action: 'license.renewed', actor, detail: { previous: l.id }, chain: true });
  return one('SELECT * FROM adm_license WHERE id = ?', nid);
}

export const listLicenses = () => q("SELECT * FROM adm_license ORDER BY state = 'renewed', expires");

export function licenseSweep({ horizonDays = 60 } = {}) {
  const day = today();
  exec("UPDATE adm_license SET state = 'expired' WHERE state = 'active' AND expires < ?", day);
  const soon = q("SELECT id, name, expires FROM adm_license WHERE state = 'active' AND expires <= date(?, ?)", day, `+${Number(horizonDays)} day`);
  for (const l of soon) emit('license.expiring', { id: l.id, expires: l.expires }, { idempotency: `license-${l.id}-${day}` });
  return { expiring: soon.length };
}

// ---------------------------------------------------------------- policies --

export function acknowledgePolicy({ docId, employeeId, actor }) {
  if (!actor) refuse('an acknowledgement carries a name');
  const doc = one("SELECT id, classification FROM doc_document WHERE id = ? AND state = 'active'", Number(docId));
  if (!doc) refuse('no such document');
  if (doc.classification === 'restricted') refuse('a restricted document is not a policy');
  const who = employeeOk(employeeId);
  if (!who) refuse('an acknowledgement belongs to an employee');
  exec('INSERT OR IGNORE INTO adm_policy_ack (doc_id, employee_id) VALUES (?,?)', doc.id, who);
  log({ entity: 'policy_ack', entityId: doc.id, action: 'policy.acknowledged', actor, detail: { employeeId: who } });
  return policyAckStatus(doc.id);
}

export function policyAckStatus(docId) {
  const doc = one('SELECT id, title FROM doc_document WHERE id = ?', Number(docId));
  if (!doc) refuse('no such document');
  const acked = new Set(q('SELECT employee_id FROM adm_policy_ack WHERE doc_id = ?', doc.id).map((r) => r.employee_id));
  const staff = q("SELECT e.id, p.display_name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.state = 'active' ORDER BY p.display_name");
  return { doc, acknowledged: staff.filter((s) => acked.has(s.id)), pending: staff.filter((s) => !acked.has(s.id)) };
}

// ---------------------------------------------------------- my workspace --

/**
 * The page about you. Derived from the login's person link; nothing here is
 * about anybody else, and a login with no person behind it is told so.
 */
export function myWorkspace(user) {
  const u = one('SELECT id, username, person_id FROM users WHERE username = ?', String(user?.username || ''));
  if (!u?.person_id) return { linked: false, username: u?.username || null };
  const person = one('SELECT id, display_name FROM hr_person WHERE id = ?', u.person_id);
  const emp = one("SELECT e.*, un.name AS unit, po.title AS position FROM hr_employee e LEFT JOIN hr_org_unit un ON un.id = e.org_unit_id LEFT JOIN hr_position po ON po.id = e.position_id WHERE e.person_id = ? ORDER BY e.state = 'active' DESC, e.id DESC LIMIT 1", u.person_id);
  if (!emp) return { linked: true, person, employee: null };
  const day = today();
  const year = new Date().getFullYear();
  return {
    linked: true,
    person,
    employee: { id: emp.id, employee_no: emp.employee_no, state: emp.state, employment: emp.employment, hired_at: emp.hired_at, unit: emp.unit, position: emp.position, currency: emp.currency },
    today: one('SELECT * FROM time_attendance WHERE employee_id = ? AND day = ?', emp.id, day) || null,
    leave: {
      balances: q("SELECT id, name, leave_type FROM time_leave_policy").map((p) => ({ policy: p.name, type: p.leave_type, ...balanceFor(emp.id, p.id, year) })),
      requests: q("SELECT r.id, r.starts, r.ends, r.days, r.state, p.name AS policy FROM time_leave_request r JOIN time_leave_policy p ON p.id = r.policy_id WHERE r.employee_id = ? ORDER BY r.id DESC LIMIT 10", emp.id),
    },
    overtime: q("SELECT id, day, minutes, state FROM time_overtime WHERE employee_id = ? ORDER BY id DESC LIMIT 10", emp.id),
    payslips: q('SELECT s.id, r.period, r.state FROM pay_slip s JOIN pay_run r ON r.id = s.run_id WHERE s.employee_id = ? ORDER BY r.period DESC LIMIT 12', emp.id),
    // Custody is custody.js's register: what is signed out to this person.
    assets: q('SELECT c.id, COALESCE(a.name, c.description) AS name, COALESCE(a.kind, \'item\') AS kind, c.issued_at AS assigned_at FROM cust_item c LEFT JOIN assets a ON a.id = c.asset_id WHERE c.employee_id = ? AND c.returned_at IS NULL', emp.id),
    tasks: q("SELECT id, kind, what FROM rec_task WHERE employee_id = ? AND state = 'open' ORDER BY id", emp.id),
    tickets: q("SELECT id, ref, title, state, sla_due FROM ops_ticket WHERE requester_employee_id = ? AND state NOT IN ('closed') ORDER BY id DESC LIMIT 10", emp.id),
    bookings: q("SELECT b.id, r.name AS room, b.starts, b.ends FROM ops_booking b JOIN ops_room r ON r.id = b.room_id WHERE b.employee_id = ? AND b.state = 'booked' AND b.ends >= datetime('now') ORDER BY b.starts LIMIT 10", emp.id),
    objectives: q("SELECT id, title, due, state FROM perf_objective WHERE employee_id = ? ORDER BY id DESC LIMIT 10", emp.id),
    certificates: q('SELECT c.id, k.name AS course, c.expires_at FROM lrn_certificate c JOIN lrn_course k ON k.id = c.course_id WHERE c.employee_id = ? ORDER BY c.expires_at', emp.id),
    policiesToAcknowledge: q(`SELECT d.id, d.title FROM doc_document d WHERE d.state = 'active' AND d.classification IN ('public','internal') AND d.title LIKE 'Policy%'
      AND d.id NOT IN (SELECT doc_id FROM adm_policy_ack WHERE employee_id = ?) ORDER BY d.id DESC LIMIT 20`, emp.id),
    salaryOnFile: Boolean(emp.base_salary && openPii(emp.base_salary) !== '[erased]'),
  };
}

// ----------------------------------------------------------------- overview --

export function adminOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    letters: listLetters({ limit: 50 }),
    lettersOpen: n("SELECT COUNT(*) AS n FROM adm_letter WHERE state NOT IN ('closed','sent')"),
    committees: listCommittees(),
    cases: listCases(),
    casesOpen: n("SELECT COUNT(*) AS n FROM adm_case WHERE state IN ('open','hearing')"),
    exposure: Number(one("SELECT COALESCE(SUM(exposure), 0) AS n FROM adm_case WHERE state IN ('open','hearing')").n),
    obligations: listObligations(),
    obligationsOverdue: n("SELECT COUNT(*) AS n FROM adm_obligation WHERE state = 'overdue'"),
    licenses: listLicenses(),
    licensesExpiring: n("SELECT COUNT(*) AS n FROM adm_license WHERE state = 'active' AND expires <= date('now', '+60 day')"),
    note: 'Every letter, resolution, case and licence carries a number and a name. Adopting a resolution, settling a case and '
      + 'discharging an obligation are human acts on the chain; the words behind them are documents.',
  };
}
