// PEOPLE LIFECYCLE — recruitment, onboarding, performance, training, and the
// way out.
//
// Three rules run through this module, each inherited from the directive and
// each enforced in code rather than described in a comment:
//
//   An applicant is a person. The ATS pipeline moves hr_person rows — the
//   candidate-only combination — and hiring converts the application into an
//   employment with employ(). Core 1's `candidates` table hires AI agents and
//   is not touched: humans and agents never share an identity pool.
//
//   An AI drafts evidence, never a rating. The review row keeps them in
//   different columns, the evidence setter takes no rating, and the rating
//   setter refuses any actor that is not human. The judgment stays with a
//   person not because a model could not produce a number, but because a
//   number about a person must have somebody who can be asked why.
//
//   A termination is drafted by anybody and executed by a human, always.
//   terminateEmployee sits on the gateway's categorical list, and this module
//   refuses a non-human actor again — two locks, one door.
import { q, one, exec } from '../db.js';
import { sealForRef, openPii } from '../erasure.js';
import { log, employ, getEmployee } from './identity.js';
import { createDocument } from './documents.js';
import { emit } from './bridge.js';
import { computeEos } from './hrplus.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 160) => String(s ?? '').trim().slice(0, n);

// ------------------------------------------------------------ recruitment --

export function openVacancy({ title, positionId = null, actor }) {
  if (!actor) refuse('opening a vacancy is an act and carries a name');
  if (!clean(title)) refuse('a vacancy needs a title');
  exec('INSERT INTO rec_vacancy (title, position_id, opened_by) VALUES (?,?,?)',
    clean(title), positionId ? Number(positionId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'vacancy', entityId: id, action: 'vacancy.opened', actor });
  return one('SELECT * FROM rec_vacancy WHERE id = ?', id);
}

/** A person applies. The CV, if any, is a sealed restricted document. */
export function apply({ vacancyId, personId, docId = null, actor }) {
  if (!actor) refuse('recording an application carries a name');
  const v = one("SELECT * FROM rec_vacancy WHERE id = ? AND state = 'open'", Number(vacancyId));
  if (!v) refuse('no such open vacancy');
  if (!one('SELECT id FROM hr_person WHERE id = ?', Number(personId))) refuse('no such person — record them first');
  if (docId) {
    const d = one('SELECT classification FROM doc_document WHERE id = ?', Number(docId));
    if (!d) refuse('no such document');
    if (d.classification !== 'restricted') refuse('a CV names a person — attach it as a restricted document, so it stays sealed');
  }
  exec('INSERT INTO rec_application (vacancy_id, person_id, doc_id) VALUES (?,?,?)',
    v.id, Number(personId), docId ? Number(docId) : null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'application', entityId: id, action: 'application.received', actor });
  return one('SELECT * FROM rec_application WHERE id = ?', id);
}

const PIPELINE = {
  applied: ['screening', 'rejected'],
  screening: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['hired', 'rejected'],
};

/**
 * Move an application one legal step. Screening can be driven by an agent
 * through the gateway; `offer`, `hired` and `rejected` are decisions about a
 * person's livelihood, and those refuse a machine here regardless of scope.
 */
export function advanceApplication(id, { to, actor }) {
  if (!actor) refuse('moving an application carries a name');
  const a = one('SELECT * FROM rec_application WHERE id = ?', Number(id));
  if (!a) refuse('no such application');
  const legal = PIPELINE[a.state] || [];
  if (!legal.includes(to)) refuse(`an application cannot go from ${a.state} to ${to}`);
  if (['offer', 'hired', 'rejected'].includes(to) && !String(actor).startsWith('human:')) {
    refuse(`${to} is a decision about a person's livelihood — a human act, always`);
  }
  exec("UPDATE rec_application SET state = ?, decided_by = CASE WHEN ? IN ('offer','hired','rejected') THEN ? ELSE decided_by END WHERE id = ?",
    to, to, String(actor), a.id);
  log({ entity: 'application', entityId: a.id, action: `application.${to}`, actor });
  return one('SELECT * FROM rec_application WHERE id = ?', a.id);
}

/**
 * Hire: the application becomes an employment, through the same employ() the
 * directive's Phase 1 built — one door into employment, not two. Onboarding
 * opens as a checklist the moment the employment exists.
 */
export function hire(applicationId, { employeeNo = null, orgUnitId = null, positionId = null, baseSalary = null, actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('hiring is a human act, always');
  const a = one("SELECT * FROM rec_application WHERE id = ?", Number(applicationId));
  if (!a) refuse('no such application');
  if (a.state !== 'offer') refuse(`only an accepted offer hires — this application is ${a.state}`);

  const emp = employ({
    personId: a.person_id, employeeNo, orgUnitId, positionId, baseSalary, actor,
  });
  exec("UPDATE rec_application SET state = 'hired', decided_by = ? WHERE id = ?", String(actor), a.id);
  exec("UPDATE rec_vacancy SET state = 'filled' WHERE id = ?", a.vacancy_id);

  for (const what of [
    'Create the login, if this employee needs one',
    'Assign the equipment and record it as an asset',
    'Introduce the reporting line and the org unit',
    'Grant the permissions the position needs — and no more',
  ]) exec("INSERT INTO rec_task (employee_id, kind, what) VALUES (?, 'onboard', ?)", emp.id, what);

  log({ entity: 'application', entityId: a.id, action: 'application.hired', actor, detail: { employeeId: emp.id }, chain: true });
  return getEmployee(emp.id);
}

export function listVacancies() {
  return q(`SELECT v.*, (SELECT COUNT(*) FROM rec_application a WHERE a.vacancy_id = v.id) AS applications
              FROM rec_vacancy v ORDER BY v.id DESC LIMIT 100`);
}

export function listApplications({ vacancyId = null } = {}) {
  let sql = `SELECT a.*, p.display_name, v.title AS vacancy_title FROM rec_application a
               JOIN hr_person p ON p.id = a.person_id
               JOIN rec_vacancy v ON v.id = a.vacancy_id WHERE 1=1`;
  const params = [];
  if (vacancyId) { sql += ' AND a.vacancy_id = ?'; params.push(Number(vacancyId)); }
  sql += ' ORDER BY a.id DESC LIMIT 200';
  return q(sql, ...params);
}

// ---------------------------------------------------------------- checklists --

export function tasksFor(employeeId, kind = null) {
  let sql = 'SELECT * FROM rec_task WHERE employee_id = ?';
  const params = [Number(employeeId)];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  return q(`${sql} ORDER BY id`, ...params);
}

export function completeTask(id, { actor }) {
  if (!actor) refuse('completing a task carries a name');
  const t = one('SELECT * FROM rec_task WHERE id = ?', Number(id));
  if (!t) refuse('no such task');
  exec("UPDATE rec_task SET state = 'done' WHERE id = ?", t.id);
  log({ entity: 'rec_task', entityId: t.id, action: `${t.kind}.task_done`, actor });
  return one('SELECT * FROM rec_task WHERE id = ?', t.id);
}

// --------------------------------------------------------------- performance --

export function setObjective({ employeeId, title, due = null, actor }) {
  if (!actor) refuse('an objective carries a name');
  if (!one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(employeeId))) refuse('no such active employee');
  exec('INSERT INTO perf_objective (employee_id, title, due) VALUES (?,?,?)',
    Number(employeeId), clean(title, 300), due || null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'objective', entityId: id, action: 'objective.set', actor });
  return one('SELECT * FROM perf_objective WHERE id = ?', id);
}

/**
 * The evidence half of a review. Callable by an agent through the gateway —
 * summarizing tasks, meetings and goals is exactly what an agent is for — and
 * note the signature: there is no rating parameter. An AI cannot emit a score
 * through this function because the function cannot express one.
 */
export function writeReviewEvidence({ employeeId, period, evidence, actor }) {
  if (!actor) refuse('review evidence carries a name');
  const emp = one(`SELECT e.id, p.subject_ref FROM hr_employee e JOIN hr_person p ON p.id = e.person_id
                    WHERE e.id = ? AND e.state = 'active'`, Number(employeeId));
  if (!emp) refuse('no such active employee');
  if (!String(evidence || '').trim()) refuse('evidence without words is a rating in disguise');
  const sealed = emp.subject_ref ? sealForRef(String(evidence).slice(0, 8000), emp.subject_ref) : String(evidence).slice(0, 8000);
  exec(
    `INSERT INTO perf_review (employee_id, period, evidence, subject_ref) VALUES (?,?,?,?)
     ON CONFLICT(employee_id, period) DO UPDATE SET evidence = excluded.evidence`,
    emp.id, clean(period, 20), sealed, emp.subject_ref,
  );
  log({ entity: 'review', entityId: emp.id, action: 'review.evidence_written', actor, detail: { period } });
  return getReview(emp.id, period);
}

/**
 * The judgment half. A human act, always — not because a model could not
 * produce the number, but because a number about a person must have somebody
 * who can be asked why.
 */
export function setRating({ employeeId, period, rating, actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('a rating is a human judgment, always — an AI may summarize evidence, never score a person');
  const r = one('SELECT * FROM perf_review WHERE employee_id = ? AND period = ?', Number(employeeId), clean(period, 20));
  if (!r) refuse('write the evidence before the judgment');
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) refuse('a rating is 1 to 5');
  exec('UPDATE perf_review SET rating = ?, rated_by = ? WHERE id = ?', n, String(actor), r.id);
  log({ entity: 'review', entityId: r.id, action: 'review.rated', actor, detail: { period, rating: n } });
  return getReview(Number(employeeId), period);
}

export function getReview(employeeId, period) {
  const r = one('SELECT * FROM perf_review WHERE employee_id = ? AND period = ?', Number(employeeId), clean(period, 20));
  return r ? { ...r, evidence: openPii(r.evidence) } : null;
}

// ------------------------------------------------------------------ training --

export function createCourse({ name, expiresMonths = 0, actor }) {
  if (!actor) refuse('a course carries a name');
  exec('INSERT INTO lrn_course (name, expires_months) VALUES (?,?)', clean(name), Number(expiresMonths) || 0);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'course', entityId: id, action: 'course.created', actor });
  return one('SELECT * FROM lrn_course WHERE id = ?', id);
}

export function grantCertificate({ employeeId, courseId, earnedAt = null, actor }) {
  if (!actor) refuse('a certificate carries a name');
  const course = one('SELECT * FROM lrn_course WHERE id = ?', Number(courseId));
  if (!course) refuse('no such course');
  if (!one('SELECT id FROM hr_employee WHERE id = ?', Number(employeeId))) refuse('no such employee');
  const earned = earnedAt || new Date().toISOString().slice(0, 10);
  const expires = course.expires_months
    ? new Date(new Date(`${earned}T00:00:00Z`).setUTCMonth(new Date(`${earned}T00:00:00Z`).getUTCMonth() + course.expires_months)).toISOString().slice(0, 10)
    : null;
  exec('INSERT INTO lrn_certificate (employee_id, course_id, earned_at, expires_at) VALUES (?,?,?,?)',
    Number(employeeId), course.id, earned, expires);
  log({ entity: 'certificate', entityId: Number(employeeId), action: 'certificate.granted', actor, detail: { course: course.name } });
  return one('SELECT * FROM lrn_certificate WHERE employee_id = ? AND course_id = ? AND earned_at = ?', Number(employeeId), course.id, earned);
}

/** The competency matrix: who currently holds what, expiry respected. */
export function competencyMatrix() {
  return q(`
    SELECT p.display_name, e.employee_no, c.name AS course, cert.earned_at, cert.expires_at,
           CASE WHEN cert.expires_at IS NOT NULL AND date(cert.expires_at) < date('now') THEN 'expired' ELSE 'current' END AS standing
      FROM lrn_certificate cert
      JOIN lrn_course c ON c.id = cert.course_id
      JOIN hr_employee e ON e.id = cert.employee_id
      JOIN hr_person p ON p.id = e.person_id
     ORDER BY p.display_name, c.name`);
}

/** Certificates about to lapse — same idempotent watch as contracts. */
export function certificateExpirySweep({ horizonDays = 30 } = {}) {
  const soon = q(
    `SELECT cert.id, cert.expires_at, c.name FROM lrn_certificate cert JOIN lrn_course c ON c.id = cert.course_id
      WHERE cert.expires_at IS NOT NULL
        AND date(cert.expires_at) <= date('now', '+' || ? || ' days') AND date(cert.expires_at) >= date('now')`,
    Number(horizonDays),
  );
  for (const s of soon) {
    emit('certificate.expiring', { id: s.id, course: s.name, expiresAt: s.expires_at },
      { idempotency: `cert-expiring-${s.id}-${s.expires_at}` });
  }
  return { watched: soon.length };
}

// --------------------------------------------------------------- offboarding --

/**
 * End an employment. The gateway holds `terminateEmployee` categorically, so
 * an agent's path stops at the gate with a draft; this function is the human
 * path, and it checks again. What it does, in order: the employment ends, the
 * login dies, the asset-return checklist opens, and the fact is chained.
 */
export function terminateEmployee({ employeeId, actor }) {
  if (!String(actor || '').startsWith('human:')) {
    refuse('terminating an employment is a human act, always — an agent may draft the summary, never execute it');
  }
  const emp = one(`SELECT e.*, p.display_name, p.id AS pid FROM hr_employee e
                    JOIN hr_person p ON p.id = e.person_id WHERE e.id = ?`, Number(employeeId));
  if (!emp) refuse('no such employee');
  if (emp.state === 'ended') refuse('this employment already ended');

  exec("UPDATE hr_employee SET state = 'ended', ended_at = datetime('now') WHERE id = ?", emp.id);
  // Access dies with the employment. The person row survives — a leaver is
  // still a person, and their payslips still have seven years to live.
  exec("UPDATE users SET status = 'disabled' WHERE person_id = ?", emp.pid);

  for (const a of q("SELECT id, name FROM assets WHERE state = 'active' AND owner = ?", emp.display_name)) {
    exec("INSERT INTO rec_task (employee_id, kind, what) VALUES (?, 'offboard', ?)",
      emp.id, `Recover asset: ${a.name} (#${a.id})`);
  }
  exec("INSERT INTO rec_task (employee_id, kind, what) VALUES (?, 'offboard', 'Revoke every credential and API key issued to this person')", emp.id);
  exec("INSERT INTO rec_task (employee_id, kind, what) VALUES (?, 'offboard', 'Hand over open tasks and record the exit')", emp.id);

  log({ entity: 'employee', entityId: emp.id, action: 'employee.terminated', actor, detail: { employeeNo: emp.employee_no }, chain: true });
  // What the company owes on the way out is computed now, sealed under the
  // person, and waits for a human to pay it — a separate act, separately gated.
  try { computeEos({ employeeId: emp.id, actor }); } catch { /* no salary on file: nothing to compute */ }
  emit('employee.terminated', { id: emp.id });
  return getEmployee(emp.id);
}

/**
 * A disciplinary record is a restricted document about the person — sealed
 * under their key, reachable by their erasure, and chained as a fact without
 * its contents. There is no disciplinary table because there is nothing a
 * table would add except a second place for the words to live.
 */
export function recordDisciplinary({ personId, title, body, actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('a disciplinary record is a human act, always');
  const doc = createDocument({
    title: clean(title) || 'Disciplinary record', classification: 'restricted',
    subjectPersonId: Number(personId), body: String(body || ''), actor,
  });
  log({ entity: 'person', entityId: Number(personId), action: 'disciplinary.recorded', actor, detail: { docId: doc.id }, chain: true });
  return doc;
}

export function talentOverview() {
  const n = (sql) => one(sql).n;
  return {
    vacancies: n("SELECT COUNT(*) AS n FROM rec_vacancy WHERE state = 'open'"),
    inPipeline: n("SELECT COUNT(*) AS n FROM rec_application WHERE state NOT IN ('hired','rejected')"),
    onboarding: n("SELECT COUNT(*) AS n FROM rec_task WHERE kind = 'onboard' AND state = 'open'"),
    offboarding: n("SELECT COUNT(*) AS n FROM rec_task WHERE kind = 'offboard' AND state = 'open'"),
    reviewsUnrated: n('SELECT COUNT(*) AS n FROM perf_review WHERE rating IS NULL'),
    certificates: n('SELECT COUNT(*) AS n FROM lrn_certificate'),
    note: 'An applicant is a person, never a row in the agent-hiring table — humans and agents do not share an '
      + 'identity pool. An AI may draft review evidence and can never emit a rating: the evidence setter has no '
      + 'rating parameter, and the rating setter refuses any actor that is not human. Terminations and offers are '
      + 'human acts whatever an agent\'s scopes say.',
  };
}
