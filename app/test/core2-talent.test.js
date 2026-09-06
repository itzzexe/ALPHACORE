// People Lifecycle, and the three bars that make it safe to automate around:
// humans and agents never share an identity pool, an AI drafts evidence and
// never a rating, and the way out of employment is a human act however good
// the draft was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-talent.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 41).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-talent.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { tierAUnreachable } = await import('../src/erasure.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { createDocument } = await import('../src/core2/documents.js');
const { seedBridge, callTool, command, CONNECTOR } = await import('../src/core2/bridge.js');
const {
  openVacancy, apply, advanceApplication, hire, listVacancies,
  tasksFor, completeTask, writeReviewEvidence, setRating, getReview,
  createCourse, grantCertificate, competencyMatrix, certificateExpirySweep,
  terminateEmployee, recordDisciplinary, talentOverview,
} = await import('../src/core2/talent.js');

seedAgents();
seedConstitution();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}

// --- the ATS: humans only, one legal pipeline -------------------------------

test('an applicant is a person, and the agent-hiring table is never touched', async () => {
  const agentCandidatesBefore = one('SELECT COUNT(*) AS n FROM candidates').n;

  const noor = createPerson({ displayName: 'Noor Hadi', personalEmail: 'noor.h@example.test', actor: 'human:test' });
  const vac = openVacancy({ title: 'Backend Developer', actor: 'human:hr' });
  const cv = createDocument({
    title: 'CV — Noor Hadi', classification: 'restricted', subjectPersonId: noor.id,
    body: 'PLANTED-CV-6a90 ten years of Node', actor: 'human:hr',
  });
  const app = apply({ vacancyId: vac.id, personId: noor.id, docId: cv.id, actor: 'human:hr' });
  assert.equal(app.state, 'applied');
  assert.ok(!diskContains('PLANTED-CV-6a90'), 'the CV is readable in the raw file');

  // An unsealed CV is refused by name.
  const openDoc = createDocument({ title: 'Plain notes', classification: 'internal', body: 'x', actor: 'human:hr' });
  const omar = createPerson({ displayName: 'Omar Faris', personalEmail: 'omar.f@example.test', actor: 'human:test' });
  assert.throws(() => apply({ vacancyId: vac.id, personId: omar.id, docId: openDoc.id, actor: 'human:hr' }), /stays sealed/);

  assert.equal(one('SELECT COUNT(*) AS n FROM candidates').n, agentCandidatesBefore,
    'the human pipeline leaked into the agent-hiring table');
});

test('screening can be delegated; offers, hires and rejections cannot', async () => {
  const app = one('SELECT * FROM rec_application LIMIT 1');
  assert.throws(() => advanceApplication(app.id, { to: 'hired', actor: 'human:hr' }), /cannot go from applied/);

  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.advance_application', actor: 'human:test' });
  const screened = await callTool('advance_application', { id: app.id, to: 'screening' }, { agentId: AGENT, actor: 'agent' });
  assert.equal(screened.verdict, 'allowed');
  assert.equal(screened.result.state, 'screening');

  advanceApplication(app.id, { to: 'interview', actor: 'human:hr' });
  // The livelihood decisions refuse a machine inside Core 2, so even through
  // the gate the call fails there rather than clearing quietly.
  await assert.rejects(() => callTool('advance_application', { id: app.id, to: 'offer' }, { agentId: AGENT, actor: 'agent' }));
  advanceApplication(app.id, { to: 'offer', actor: 'human:hr' });
});

test('hiring converts the application into an employment through the one door', () => {
  const app = one('SELECT * FROM rec_application LIMIT 1');
  assert.throws(() => hire(app.id, { actor: `agent:${AGENT}` }), /human act/);
  const emp = hire(app.id, { employeeNo: 'E100', baseSalary: 2500, actor: 'human:hr' });
  assert.equal(emp.state, 'active');
  assert.equal(emp.person.display_name, 'Noor Hadi');
  assert.equal(one('SELECT state FROM rec_vacancy LIMIT 1').state, 'filled');
  const onboard = tasksFor(emp.id, 'onboard');
  assert.ok(onboard.length >= 4, 'hiring must open the onboarding checklist');
  completeTask(onboard[0].id, { actor: 'human:hr' });
  assert.equal(tasksFor(emp.id, 'onboard').filter((t2) => t2.state === 'open').length, onboard.length - 1);
});

// --- performance: evidence is draftable, judgment is not --------------------

test('an AI drafts evidence and cannot emit a rating by any path', async () => {
  const emp = one("SELECT id FROM hr_employee WHERE state = 'active' LIMIT 1");
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.draft_review_evidence', actor: 'human:test' });

  // The agent drafts the evidence — and smuggles a rating into the args.
  const drafted = await callTool('draft_review_evidence', {
    employeeId: emp.id, period: '2026-H2',
    evidence: 'PLANTED-EVIDENCE-3c11 shipped the payroll engine; strong reviews from two peers',
    rating: 5,
  }, { agentId: AGENT, actor: 'agent' });
  assert.equal(drafted.verdict, 'allowed');

  const review = getReview(emp.id, '2026-H2');
  assert.match(review.evidence, /PLANTED-EVIDENCE-3c11/);
  assert.equal(review.rating, null, 'the smuggled rating landed — the function must not be able to express one');
  assert.ok(!diskContains('PLANTED-EVIDENCE-3c11'), 'review evidence is readable in the raw file');

  // The rating setter refuses the machine outright.
  assert.throws(() => setRating({ employeeId: emp.id, period: '2026-H2', rating: 5, actor: `agent:${AGENT}` }), /human judgment/);
  const rated = setRating({ employeeId: emp.id, period: '2026-H2', rating: 4, actor: 'human:manager' });
  assert.equal(rated.rating, 4);
  assert.equal(rated.rated_by, 'human:manager');
  assert.throws(() => setRating({ employeeId: emp.id, period: '2026-H2', rating: 9, actor: 'human:manager' }), /1 to 5/);
  assert.deepEqual(tierAUnreachable(), []);
});

// --- training ---------------------------------------------------------------

test('certificates expire on the course\'s clock, and the watch announces once', async () => {
  const emp = one("SELECT id FROM hr_employee WHERE state = 'active' LIMIT 1");
  const forever = createCourse({ name: 'Security basics', expiresMonths: 0, actor: 'human:hr' });
  const yearly = createCourse({ name: 'First aid', expiresMonths: 12, actor: 'human:hr' });
  const c1 = grantCertificate({ employeeId: emp.id, courseId: forever.id, actor: 'human:hr' });
  assert.equal(c1.expires_at, null);
  // Earned eleven months ago, so it lapses in about a month: inside the
  // sixty-day watch and still current today. Relative on purpose — a fixed
  // date turns this into a test that passes until the calendar reaches it,
  // which is exactly how it failed once the clock rolled past 2026-09-01.
  const earned = one("SELECT date('now', '-11 month') AS d").d;
  const c2 = grantCertificate({ employeeId: emp.id, courseId: yearly.id, earnedAt: earned, actor: 'human:hr' });
  assert.equal(c2.expires_at, one("SELECT date(?, '+12 month') AS d", earned).d);

  const m = competencyMatrix();
  assert.equal(m.length, 2);
  assert.ok(m.every((r) => r.standing === 'current'));

  const swept = certificateExpirySweep({ horizonDays: 60 });
  assert.equal(swept.watched, 1);
  await jobsTick();
  assert.match(one("SELECT message FROM notifications ORDER BY id DESC LIMIT 1").message, /certificate expires/i);
  const jobs = one("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'core2.event'").n;
  certificateExpirySweep({ horizonDays: 60 });
  assert.equal(one("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'core2.event'").n, jobs, 'the watch re-announced');
});

// --- the way out ------------------------------------------------------------

test('a termination is gated for agents and complete for a human', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
  const emp = one("SELECT e.id, p.display_name, p.id AS pid FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.state = 'active' LIMIT 1");

  // The agent's path stops at the gate — scope, force and amount are all known
  // not to clear it from the bridge tests; one assertion here keeps this file
  // honest on its own.
  const held = await command('terminateEmployee', { employeeId: emp.id }, { agentId: AGENT, actor: 'agent', force: true });
  assert.equal(held.verdict, 'gated');
  assert.equal(one('SELECT state FROM hr_employee WHERE id = ?', emp.id).state, 'active', 'the gate held but the employment ended');

  // Give them a login and an asset, then the human path.
  exec("INSERT INTO users (username, display_name, pass, person_id) VALUES ('noor', ?, 'x', ?)", emp.display_name, emp.pid);
  exec("INSERT INTO assets (name, kind, owner) VALUES ('MacBook M4', 'device', ?)", emp.display_name);

  assert.throws(() => terminateEmployee({ employeeId: emp.id, actor: `agent:${AGENT}` }), /human act/);
  const ended = terminateEmployee({ employeeId: emp.id, actor: 'human:hr' });
  assert.equal(ended.state, 'ended');
  assert.equal(one('SELECT status FROM users WHERE person_id = ?', emp.pid).status, 'disabled', 'access must die with the employment');
  const off = tasksFor(emp.id, 'offboard');
  assert.ok(off.some((t2) => /MacBook M4/.test(t2.what)), 'the asset-return checklist missed the laptop');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'employee.terminated'"), 'a termination must be chained');
  // The person survives their employment: a leaver's payslips have years to live.
  assert.ok(one('SELECT id FROM hr_person WHERE id = ?', emp.pid));
});

test('a disciplinary record is a sealed document with a chained fact', () => {
  const p = createPerson({ displayName: 'Rafid Aziz', personalEmail: 'rafid@example.test', actor: 'human:test' });
  assert.throws(() => recordDisciplinary({ personId: p.id, body: 'x', actor: `agent:${AGENT}` }), /human act/);
  const doc = recordDisciplinary({
    personId: p.id, title: 'Written warning', body: 'PLANTED-WARNING-8d02 repeated unexcused absence', actor: 'human:hr',
  });
  assert.equal(doc.classification, 'restricted');
  assert.ok(!diskContains('PLANTED-WARNING-8d02'), 'a disciplinary record is readable in the raw file');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'disciplinary.recorded'"), 'the fact must be chained');
  const chained = q("SELECT payload FROM audit_log WHERE action = 'disciplinary.recorded'");
  assert.ok(!chained.some((r) => /PLANTED-WARNING/.test(r.payload || '')), 'the words reached the chain, which cannot forget');
});

test('the overview says what is true', () => {
  const o = talentOverview();
  assert.ok(o.certificates >= 2);
  assert.ok(o.offboarding >= 1);
  assert.match(o.note, /never emit a rating|never a rating/);
});
