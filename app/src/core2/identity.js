// Who a human being is, once, for the whole company.
//
// Core 1 already had three tables that each knew about people from one angle:
// `users` (somebody who can log in), `people` (the founder roster), and
// `candidates` (somebody who applied). None of them referred to the others, so
// the same human could be three rows with three spellings of their name and no
// way to know it. This is the root they all now point at.
//
// The shape is deliberately loose about combinations and strict about identity:
//
//   a candidate      — a person, no employment, no login
//   a contractor     — a person with employment, no login
//   an administrator — a person with a login, no employment
//   an employee      — all three
//   a leaver         — a person, employment that has ended, login revoked
//
// Every one of those is a real thing a real company has, so every one has to be
// representable. A model that cannot hold "somebody who left but whose payslips
// we must keep for seven years" is a model that will be worked around.
//
// ---------------------------------------------------------------------------
// An agent is not a person, and this is enforced twice
// ---------------------------------------------------------------------------
// Core 1's constitution already says no action may record a human approver who
// did not approve it. Core 2 extends that to the org chart: an AI employee must
// never appear in a reporting line, a meeting attendance list, or a signature.
//
// The enforcement is structural rather than conventional. Agents have TEXT ids
// ('AGT-SUP-001'); people have INTEGER ones. Every Core 2 table is STRICT, so
// SQLite refuses the assignment at the storage engine — not in a helper anybody
// can forget to call. The trigger in db.js catches the other direction, where a
// name rather than an id is the thing being smuggled.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { sealPii, openPii, openDeep, refFor } from '../erasure.js';

const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/** Does this look like one of Core 1's employees rather than a human? */
export const looksLikeAgent = (v) => /^AGT-[A-Z]{2,5}-\d{2,4}$/i.test(String(v || '').trim())
  || Boolean(one('SELECT id FROM agents WHERE id = ?', String(v || '').trim()));

/**
 * Record a human being.
 *
 * The identifying details are sealed under this person's own key before the row
 * exists — the same path every other piece of personal data in the platform
 * takes. What stays readable is the display name, because every screen, every
 * org chart and every report groups by it, and a name nobody can read is a
 * company nobody can run.
 */
export function createPerson({
  displayName, personalEmail = null, personalPhone = null,
  nationalId = null, emergencyContact = null, actor,
}) {
  const name = clean(displayName);
  if (!name) refuse('a person needs a name');
  if (!actor) refuse('recording a person is an act and carries a name');
  // The trigger would catch this too. Refusing here as well means the caller
  // gets a sentence rather than a SQLITE_CONSTRAINT.
  if (looksLikeAgent(name)) refuse('an AI agent cannot be recorded as a person');

  // The subject is the person themselves, identified by whichever contact
  // detail we have. Without one there is nothing to seal under and nothing for
  // an erasure request to name, so the row is written in the clear and says so.
  const identifier = clean(personalEmail) || clean(personalPhone) || null;
  const seal = (v) => (identifier && v ? sealPii(clean(v, 400), { kind: 'contact', identifier }) : (v ? clean(v, 400) : null));

  exec(
    `INSERT INTO hr_person (display_name, subject_ref, personal_email, personal_phone, national_id, emergency_contact)
     VALUES (?,?,?,?,?,?)`,
    name,
    identifier ? refFor('contact', identifier) : null,
    seal(personalEmail), seal(personalPhone), seal(nationalId), seal(emergencyContact),
  );
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'person', entityId: id, action: 'person.created', actor, detail: { sealed: Boolean(identifier) } });
  return getPerson(id);
}

/** Opened on the way out; the route that reaches this is permission-checked. */
export function getPerson(id) {
  return openDeep(one('SELECT * FROM hr_person WHERE id = ?', Number(id)));
}

export function listPeople({ limit = 200 } = {}) {
  return openDeep(q('SELECT * FROM hr_person ORDER BY id DESC LIMIT ?', Number(limit)));
}

/**
 * Everything the company knows about one human, across both galaxies.
 *
 * This is the join the three separate tables could not do before: a person, the
 * employment they hold, the login they use, and the Core 1 roster row that
 * refers to them.
 */
export function personDossier(id) {
  const person = getPerson(id);
  if (!person) return null;
  return {
    person,
    employment: openDeep(q('SELECT * FROM hr_employee WHERE person_id = ? ORDER BY id DESC', Number(id))),
    login: one('SELECT id, username, display_name, role, status FROM users WHERE person_id = ?', Number(id)) || null,
    core1Roster: one('SELECT id, name, role, type, status FROM people WHERE person_id = ?', Number(id)) || null,
    note: 'One human, one row, however many systems refer to them. The identifying details are sealed under '
      + 'this person\'s own key and are readable here only because the route that reached this function '
      + 'checked a permission first.',
  };
}

/** Give an existing login a person. Additive: Core 1 keeps working either way. */
export function linkUser(personId, userId, { actor }) {
  if (!getPerson(personId)) refuse('no such person');
  if (!one('SELECT id FROM users WHERE id = ?', Number(userId))) refuse('no such user');
  exec('UPDATE users SET person_id = ? WHERE id = ?', Number(personId), Number(userId));
  log({ entity: 'person', entityId: Number(personId), action: 'person.user_linked', actor, detail: { userId } });
  return personDossier(personId);
}

// ------------------------------------------------------------- employment --

/**
 * Employ somebody.
 *
 * The salary and the bank account are sealed under the person's key like every
 * other Tier A value. Note what the manager column is: a reference to another
 * *employment*, by integer id. It is not a name and it cannot be an agent —
 * the column is INTEGER in a STRICT table, so an org chart with an AI on it is
 * not something this schema can express.
 */
export function employ({
  personId, employeeNo, orgUnitId = null, positionId = null, gradeId = null,
  managerId = null, employment = 'full-time', baseSalary = null, bankAccount = null,
  currency = 'USD', hiredAt = null, actor,
}) {
  if (!actor) refuse('employing somebody is an act and carries a name');
  const person = getPerson(personId);
  if (!person) refuse('no such person');
  if (managerId && !one('SELECT id FROM hr_employee WHERE id = ?', Number(managerId))) {
    refuse('a reporting line has to point at somebody who is employed here');
  }
  const no = clean(employeeNo, 40) || `E${String(personId).padStart(5, '0')}`;

  // Sealed under the person, so an erasure request naming their address takes
  // their salary with it.
  const raw = one('SELECT personal_email, personal_phone, subject_ref FROM hr_person WHERE id = ?', Number(personId));
  const identifier = raw?.personal_email ? openPii(raw.personal_email) : (raw?.personal_phone ? openPii(raw.personal_phone) : null);
  const usable = identifier && identifier !== '[erased]' && identifier !== '[unreadable]' ? identifier : null;
  const seal = (v) => (usable && v ? sealPii(clean(v, 200), { kind: 'contact', identifier: usable }) : (v ? clean(v, 200) : null));

  exec(
    `INSERT INTO hr_employee (person_id, employee_no, org_unit_id, position_id, grade_id, manager_id,
                              employment, bank_account, base_salary, currency, hired_at, subject_ref, state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
    Number(personId), no, orgUnitId ? Number(orgUnitId) : null, positionId ? Number(positionId) : null,
    gradeId ? Number(gradeId) : null, managerId ? Number(managerId) : null, employment,
    seal(bankAccount), seal(baseSalary == null ? null : String(baseSalary)), currency,
    hiredAt || new Date().toISOString().slice(0, 10),
    // Carried from the person, so an erasure naming their address finds the
    // salary by lookup rather than by a scan that could never match it.
    raw?.subject_ref || null,
  );
  const id = one('SELECT last_insert_rowid() AS id').id;

  // Employment is consequential, so it goes on Core 1's chain as well as the
  // operational log — but the terms do not. What is chained is that it happened.
  log({
    entity: 'employee', entityId: id, action: 'employee.created', actor,
    detail: { personId: Number(personId), employeeNo: no, employment }, chain: true,
  });
  return getEmployee(id);
}

export function getEmployee(id) {
  const e = openDeep(one('SELECT * FROM hr_employee WHERE id = ?', Number(id)));
  if (!e) return null;
  return { ...e, person: getPerson(e.person_id) };
}

export function listEmployees({ state = null, orgUnitId = null, limit = 500 } = {}) {
  let sql = `SELECT e.*, p.display_name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE 1=1`;
  const params = [];
  if (state) { sql += ' AND e.state = ?'; params.push(state); }
  if (orgUnitId) { sql += ' AND e.org_unit_id = ?'; params.push(Number(orgUnitId)); }
  sql += ' ORDER BY e.id DESC LIMIT ?';
  params.push(Number(limit));
  return openDeep(q(sql, ...params));
}

/**
 * The reporting line, walked upward.
 *
 * Guarded against a cycle rather than trusting the data: somebody will
 * eventually make two people each other's manager, and an org chart that hangs
 * the server is a worse bug than one that shows a wrong line.
 */
export function reportingLine(employeeId) {
  const seen = new Set();
  const line = [];
  let cur = Number(employeeId);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const e = one(
      `SELECT e.id, e.manager_id, e.employee_no, p.display_name, po.title
         FROM hr_employee e JOIN hr_person p ON p.id = e.person_id
         LEFT JOIN hr_position po ON po.id = e.position_id WHERE e.id = ?`, cur,
    );
    if (!e) break;
    line.push(e);
    cur = e.manager_id;
  }
  return { line, cycle: Boolean(cur && seen.has(cur)) };
}

// -------------------------------------------------------------- the chart --

export function orgChart() {
  const units = q('SELECT * FROM hr_org_unit WHERE state = \'active\' ORDER BY id');
  const byParent = new Map();
  for (const u of units) {
    const k = u.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(u);
  }
  const headcount = new Map(
    q("SELECT org_unit_id, COUNT(*) AS n FROM hr_employee WHERE state = 'active' GROUP BY org_unit_id")
      .map((r) => [r.org_unit_id, r.n]),
  );
  // Depth-limited: a unit tree that refers to itself would otherwise recurse
  // until the stack gives out.
  const build = (parent, depth = 0) => (depth > 12 ? [] : (byParent.get(parent) || []).map((u) => ({
    ...u,
    headcount: headcount.get(u.id) || 0,
    children: build(u.id, depth + 1),
  })));
  return { units: build(0), total: units.length, employees: [...headcount.values()].reduce((a, b) => a + b, 0) };
}

export function createOrgUnit({ name, code = null, parentId = null, core1Section = null, actor }) {
  if (!actor) refuse('creating a unit is an act and carries a name');
  if (!clean(name)) refuse('a unit needs a name');
  exec('INSERT INTO hr_org_unit (name, code, parent_id, core1_section) VALUES (?,?,?,?)',
    clean(name), clean(code, 40) || null, parentId ? Number(parentId) : null, clean(core1Section, 40) || null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'org_unit', entityId: id, action: 'org.unit_created', actor, detail: { name: clean(name) } });
  return one('SELECT * FROM hr_org_unit WHERE id = ?', id);
}

export function createPosition({ title, orgUnitId = null, gradeId = null, headcount = 1, actor }) {
  if (!actor) refuse('creating a position is an act and carries a name');
  if (!clean(title)) refuse('a position needs a title');
  exec('INSERT INTO hr_position (title, org_unit_id, grade_id, headcount) VALUES (?,?,?,?)',
    clean(title), orgUnitId ? Number(orgUnitId) : null, gradeId ? Number(gradeId) : null, Number(headcount) || 1);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'position', entityId: id, action: 'org.position_created', actor, detail: { title: clean(title) } });
  return one('SELECT * FROM hr_position WHERE id = ?', id);
}

export function createGrade({ name, rank, bandMin = null, bandMax = null, currency = 'USD', actor }) {
  if (!actor) refuse('creating a grade is an act and carries a name');
  exec('INSERT INTO hr_grade (name, rank, band_min, band_max, currency) VALUES (?,?,?,?,?)',
    clean(name, 40), Number(rank) || 1, bandMin, bandMax, currency);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'grade', entityId: id, action: 'org.grade_created', actor, detail: { name: clean(name, 40) } });
  return one('SELECT * FROM hr_grade WHERE id = ?', id);
}

// ------------------------------------------------------------------- log --

/**
 * Core 2's operational log, and the gate to Core 1's chain.
 *
 * `chain: true` is the whole of Bridge 5's policy at the call site: this event
 * is consequential enough that it belongs in the record that cannot be edited.
 * Everything else stays here, where it can be read without drowning the chain
 * in attendance pings.
 */
export function log({ entity, entityId = null, action, actor, detail = null, chain = false }) {
  exec('INSERT INTO core2_log (entity, entity_id, action, actor, detail, chained) VALUES (?,?,?,?,?,?)',
    String(entity), entityId == null ? null : Number(entityId), String(action), String(actor),
    detail ? JSON.stringify(detail) : null, chain ? 1 : 0);
  if (chain) {
    audit({
      actorType: String(actor).startsWith('human') ? 'human' : 'system',
      actorId: String(actor), action, subjectType: String(entity), subjectId: entityId,
      payload: detail || {},
    });
  }
}

export function identityOverview() {
  const n = (sql) => one(sql).n;
  return {
    people: n('SELECT COUNT(*) AS n FROM hr_person'),
    employees: n("SELECT COUNT(*) AS n FROM hr_employee WHERE state = 'active'"),
    withLogin: n('SELECT COUNT(*) AS n FROM users WHERE person_id IS NOT NULL'),
    units: n("SELECT COUNT(*) AS n FROM hr_org_unit WHERE state = 'active'"),
    positions: n('SELECT COUNT(*) AS n FROM hr_position'),
    grades: n('SELECT COUNT(*) AS n FROM hr_grade'),
    unsealed: n('SELECT COUNT(*) AS n FROM hr_person WHERE subject_ref IS NULL'),
    note: 'A person is the root; employment and a login are things a person may or may not have, in any '
      + 'combination. An AI agent can hold none of them: every table here is STRICT and every reference to a '
      + 'human is an integer, so an agent id is refused by the storage engine rather than by a convention.',
  };
}
