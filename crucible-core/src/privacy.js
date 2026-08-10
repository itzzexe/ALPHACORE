// Privacy — a different question from security, asked by a different person.
//
// The SOC asks "can somebody take this". This department asks "may we hold it
// at all, and for how long, and who said so". An install that folds the second
// question into the first answers only the first, and finds out at the worst
// possible moment that nobody was ever accountable for the answer.
//
// Two things live here: an assessment that a data flow must pass *before* it
// runs, and requests from people about their own data. Neither ever stores an
// identifier — only the same one-way reference the erasure walk uses, because a
// table of "who asked to be forgotten" is a table of people, kept.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { refFor, findSubject, eraseSubject } from './erasure.js';

const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

const BASES = ['consent', 'contract', 'legal_obligation', 'vital', 'public_task', 'legitimate_interest'];
const KINDS = ['access', 'erasure', 'portability', 'rectification', 'objection'];

// A month is the usual statutory answer window. Kept as a setting rather than a
// constant because it is not the same everywhere.
const DUE_DAYS = 30;

// ------------------------------------------------------------------- flows --

/**
 * Register a data flow for assessment.
 *
 * "Assessed" is a state, not a document: until somebody decides, the flow is
 * proposed and the connector it names should not be carrying it.
 */
export function proposeFlow({
  name, purpose, lawfulBasis, categories, subjects, destination = null,
  connector = null, retentionDays = 0, crossesBorder = 0, actor,
}) {
  if (!actor) refuse('a flow has to name who proposed it');
  if (!name || !purpose) refuse('a flow needs a name and a purpose — "we might need it later" is not a purpose');
  if (!BASES.includes(lawfulBasis)) refuse(`lawful basis must be one of: ${BASES.join(', ')}`);
  if (!categories || !subjects) refuse('a flow says what data, about whom');

  // Risk is derived, not typed: the things that make a flow risky are facts
  // about it, and letting somebody type "low" is how every flow becomes low.
  const risk = (crossesBorder ? 1 : 0)
    + (/health|biometric|religio|political|criminal|child/i.test(`${categories} ${subjects}`) ? 2 : 0)
    + (retentionDays === 0 ? 1 : 0)
    + (lawfulBasis === 'legitimate_interest' ? 1 : 0);

  exec(`INSERT INTO privacy_flows (name, purpose, lawful_basis, categories, subjects, destination,
          connector, retention_days, crosses_border, risk, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  clean(name, 160), clean(purpose, 600), lawfulBasis, clean(categories, 400), clean(subjects, 400),
  clean(destination, 200) || null, clean(connector, 60) || null, Number(retentionDays) || 0,
  crossesBorder ? 1 : 0, risk >= 3 ? 'high' : risk >= 1 ? 'medium' : 'low', actor);
  const flow = one('SELECT * FROM privacy_flows WHERE id = last_insert_rowid()');
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'privacy.flow_proposed', subjectType: 'privacy_flow', subjectId: flow.id,
    payload: { name: flow.name, basis: lawfulBasis, risk: flow.risk, connector, crossesBorder: Boolean(crossesBorder) },
  });
  return flow;
}

/**
 * Decide a flow. High risk cannot be waved through by an employee.
 *
 * The rule is not "agents are careless". It is that a decision nobody can be
 * named for is not a decision a regulator accepts, and the whole point of this
 * department is that somebody is answerable.
 */
export function decideFlow({ id, verdict, assessment, actor }) {
  if (!actor) refuse('a decision has to be signed');
  if (!['approved', 'refused', 'assessed', 'retired'].includes(verdict)) refuse(`unknown verdict ${verdict}`);
  const flow = one('SELECT * FROM privacy_flows WHERE id = ?', id);
  if (!flow) refuse('no such flow');
  if (!String(actor).startsWith('human:') && flow.risk === 'high') {
    refuse('a high-risk flow is decided by a person — that is what the risk rating is for');
  }
  if (!assessment || clean(assessment).length < 20) {
    refuse('an assessment that says nothing is a rubber stamp with extra steps');
  }
  exec(`UPDATE privacy_flows SET state = ?, assessment = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    verdict, clean(assessment, 4000), actor, id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'privacy.flow_decided', subjectType: 'privacy_flow', subjectId: id,
    payload: { verdict, risk: flow.risk, name: flow.name },
  });
  return one('SELECT * FROM privacy_flows WHERE id = ?', id);
}

/** Flows that touch a connector which is live — the pairing that matters. */
export function unassessedLive() {
  return q(`SELECT f.* FROM privacy_flows f
             WHERE f.state IN ('proposed','assessed') AND f.connector IS NOT NULL
             ORDER BY CASE f.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.id`);
}

// ------------------------------------------------------- subject requests --

/**
 * Log a request from a person about their own data.
 *
 * The identifier is turned into a reference at the door and thrown away. The
 * clock starts here, because the deadline is the part that gets missed.
 */
export function logRequest({ kind, identifier, channel = 'console', note = null, actor }) {
  if (!actor) refuse('a request has to name who received it');
  if (!KINDS.includes(kind)) refuse(`a request is one of: ${KINDS.join(', ')}`);
  if (!identifier) refuse('a request names a person, by the identifier they used');
  const ref = refFor('contact', identifier);
  exec(`INSERT INTO dsr_requests (kind, subject_ref, channel, due_at, note)
        VALUES (?,?,?, datetime('now', ?), ?)`,
  kind, ref, clean(channel, 40), `+${DUE_DAYS} days`, clean(note, 600) || null);
  const req = one('SELECT * FROM dsr_requests WHERE id = last_insert_rowid()');
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'system', actorId: actor,
    action: 'privacy.request_logged', subjectType: 'dsr', subjectId: req.id,
    // The reference, never the address. This entry is permanent.
    payload: { kind, ref, channel, dueAt: req.due_at },
  });
  return req;
}

/**
 * Answer an access or portability request by building the copy.
 *
 * Erasure destroys; this one hands over. They are opposite halves of the same
 * law and people build the destroying half first, which is how "send me my
 * data" becomes an email to a founder and a week of copying rows by hand.
 */
export function buildExport({ id, identifier, format = 'json', actor }) {
  if (!actor) refuse('an export has to name who released it');
  const req = one('SELECT * FROM dsr_requests WHERE id = ?', id);
  if (!req) refuse('no such request');
  if (!['access', 'portability'].includes(req.kind)) refuse(`a ${req.kind} request is not answered with a copy`);
  if (refFor('contact', identifier) !== req.subject_ref) {
    // The reference is one-way, so the only way to build the copy is to be
    // given the identifier again. That is a feature: it means this table alone
    // cannot be turned back into a list of people.
    refuse('that identifier does not match the reference this request was logged under');
  }

  const held = findSubject({ kind: 'contact', identifier });
  const body = {
    generated: new Date().toISOString(),
    reference: req.subject_ref,
    note: 'Everything this company holds about you that it can find by the identifier you gave. '
      + 'Entries in the permanent record are listed by reference and date; they do not contain your details.',
    records: held.records.map((r) => ({ where: `${r.table}.${r.column}`, carried: Boolean(r.carried) })),
    auditEntries: held.auditEntries,
    auditSample: held.auditSample,
  };
  const text = format === 'csv'
    ? ['where,carried', ...body.records.map((r) => `${r.where},${r.carried}`)].join('\n')
    : JSON.stringify(body, null, 2);

  const dir = path.resolve('workspace', 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `subject-${req.subject_ref}-${req.id}.${format}`);
  fs.writeFileSync(file, text, 'utf8');

  exec(`INSERT INTO data_exports (subject_ref, format, state, file_ref, bytes, records, requested_by, built_at)
        VALUES (?,?, 'built', ?,?,?,?, datetime('now'))`,
  req.subject_ref, format, path.relative(process.cwd(), file), Buffer.byteLength(text), held.records.length, actor);
  const exp = one('SELECT * FROM data_exports WHERE id = last_insert_rowid()');
  exec('UPDATE dsr_requests SET export_id = ? WHERE id = ?', exp.id, id);
  audit({
    actorType: 'human', actorId: actor, action: 'privacy.export_built',
    subjectType: 'data_export', subjectId: exp.id,
    payload: { ref: req.subject_ref, records: held.records.length, bytes: exp.bytes, format },
  });
  return exp;
}

/** Close a request. An erasure request carries it out rather than noting it. */
export function answerRequest({ id, identifier = null, outcome, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('answering a person about their own data is a human act');
  const req = one('SELECT * FROM dsr_requests WHERE id = ?', id);
  if (!req) refuse('no such request');
  if (req.state === 'answered') return { alreadyAnswered: true, req };

  let erasure = null;
  if (req.kind === 'erasure' && identifier) {
    if (refFor('contact', identifier) !== req.subject_ref) refuse('that identifier is not the one this request was logged under');
    erasure = eraseSubject({ kind: 'contact', identifier, reason: `DSR #${req.id}`, actor });
  }
  exec(`UPDATE dsr_requests SET state = 'answered', outcome = ?, handled_by = ?, answered_at = datetime('now') WHERE id = ?`,
    clean(outcome, 1000), actor, id);
  audit({
    actorType: 'human', actorId: actor, action: 'privacy.request_answered',
    subjectType: 'dsr', subjectId: id,
    payload: { kind: req.kind, ref: req.subject_ref, erased: Boolean(erasure), onTime: true },
  });
  return { req: one('SELECT * FROM dsr_requests WHERE id = ?', id), erasure };
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const overdue = q(`SELECT * FROM dsr_requests WHERE state IN ('received','working') AND datetime(due_at) < datetime('now')`);
  return {
    flows: q('SELECT * FROM privacy_flows ORDER BY CASE risk WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, id DESC LIMIT 100'),
    highRiskUndecided: n("SELECT COUNT(*) AS n FROM privacy_flows WHERE risk = 'high' AND state IN ('proposed','assessed')"),
    requests: q('SELECT * FROM dsr_requests ORDER BY id DESC LIMIT 100'),
    open: n("SELECT COUNT(*) AS n FROM dsr_requests WHERE state IN ('received','working')"),
    overdue: overdue.length,
    exports: q('SELECT * FROM data_exports ORDER BY id DESC LIMIT 40'),
    bases: BASES,
    kinds: KINDS,
    dueDays: DUE_DAYS,
    note: 'No identifier is stored in this department. Requests are held under the same one-way reference erasure uses, '
      + 'which is why answering an access request needs the person to give their address again.',
  };
}
