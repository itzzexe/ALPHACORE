// Administration — numbers on everything, names on every act, and the one
// page that is about you.
//
// Letters are numbered per direction and year and cannot skip a state.
// A machine may propose a resolution or open a case file; adopting, settling
// and discharging are human and chained. The regulatory calendar is driven by
// the sweep: overdue is a state it sets, due-soon is announced once a day, and
// a recurring obligation puts the next one on the calendar when it is done.
// And a login sees its own workspace and nobody else's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-admin.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 59).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-admin.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { seedChart } = await import('../src/ledger.js');
const { grantScope } = await import('../src/egress.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { seedBridge, command, CONNECTOR } = await import('../src/core2/bridge.js');
const { createDocument } = await import('../src/core2/documents.js');
const { openTicket } = await import('../src/core2/ops.js');
const A = await import('../src/core2/admin.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;
grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
const p1 = createPerson({ displayName: 'Huda Rashid', personalEmail: 'huda@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', actor: 'human:test' });
const p2 = createPerson({ displayName: 'Sami Waleed', personalEmail: 'sami@example.test', actor: 'human:test' });
const e2 = employ({ personId: p2.id, employeeNo: 'E002', actor: 'human:test' });
const year = new Date().getUTCFullYear();

test('letters are numbered per direction and year, cannot skip a state, and sending is human', () => {
  const a = A.registerLetter({ direction: 'in', subject: 'Inspection notice', counterparty: 'Ministry of Labour', actor: `agent:${AGENT}` });
  const b = A.registerLetter({ direction: 'in', subject: 'Second notice', counterparty: 'Ministry of Labour', actor: 'human:clerk' });
  const c = A.registerLetter({ direction: 'out', subject: 'Reply', counterparty: 'Ministry of Labour', body: 'Dear Sir', actor: 'human:clerk' });
  assert.equal(a.ref, `IN-${year}-0001`);
  assert.equal(b.ref, `IN-${year}-0002`);
  assert.equal(c.ref, `OUT-${year}-0001`);
  assert.ok(c.doc_id, 'an outgoing letter with text is a document');
  assert.throws(() => A.setLetterState(a.id, { state: 'answered', actor: 'human:clerk' }), /cannot become/);
  A.setLetterState(a.id, { state: 'routed', actor: 'human:clerk' });
  assert.throws(() => A.setLetterState(c.id, { state: 'sent', actor: `agent:${AGENT}` }), /human act/);
  A.setLetterState(c.id, { state: 'sent', actor: 'human:clerk' });
  assert.equal(one('SELECT state FROM adm_letter WHERE id = ?', c.id).state, 'sent');
});

test('a machine may propose a resolution; adopting it is human, gated, and chained', async () => {
  assert.throws(() => A.createCommittee({ name: 'Procurement', chairEmployeeId: e1.id, memberIds: [e2.id], actor: `agent:${AGENT}` }), /human act/);
  const cm = A.createCommittee({ name: 'Procurement', chairEmployeeId: e1.id, memberIds: [e2.id], actor: 'human:ceo' });
  assert.equal(cm.members.length, 2, 'the chair is a member');
  const r = A.proposeResolution({ committeeId: cm.id, title: 'Adopt the vendor policy', actor: `agent:${AGENT}` });
  assert.equal(r.ref, `RES-${year}-0001`);
  const g = await command('adoptResolution', { id: r.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(g.verdict, 'gated');
  assert.throws(() => A.decideResolution(r.id, { state: 'adopted', actor: `agent:${AGENT}` }), /human act/);
  A.decideResolution(r.id, { state: 'adopted', actor: 'human:ceo' });
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'resolution.adopted'"));
  assert.throws(() => A.decideResolution(r.id, { state: 'rejected', actor: 'human:ceo' }), /already adopted/);
});

test('a case rests on a contract from Core 1\'s register, and concluding it is human', async () => {
  exec("INSERT INTO contracts (kind, title, counterparty) VALUES ('contract', 'Office lease', 'Landlord')");
  const contractId = one('SELECT id FROM contracts').id;
  assert.throws(() => A.openCase({ counterparty: 'Landlord', contractId: 999, actor: 'human:legal' }), /no such contract/);
  const c = A.openCase({ kind: 'litigation', counterparty: 'Landlord', court: 'Baghdad Commercial', contractId, exposure: 12000, actor: `agent:${AGENT}` });
  assert.equal(c.ref, `CASE-${year}-0001`);
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'case.opened'"));
  A.setCaseState(c.id, { state: 'hearing', nextHearing: '2026-10-01', actor: `agent:${AGENT}` });
  const g = await command('concludeCase', { id: c.id }, { agentId: AGENT, actor: 'agent' });
  assert.equal(g.verdict, 'gated');
  assert.throws(() => A.setCaseState(c.id, { state: 'settled', actor: `agent:${AGENT}` }), /human act/);
  A.setCaseState(c.id, { state: 'settled', exposure: 4000, actor: 'human:legal' });
  assert.equal(one('SELECT decided_by FROM adm_case WHERE id = ?', c.id).decided_by, 'human:legal');
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'case.settled'"));
});

test('the calendar: overdue is set by the sweep, due-soon is announced once a day, recurrence spawns the next', () => {
  const late = A.addObligation({ title: 'Quarterly return', authority: 'Tax authority', due: '2026-01-31', actor: 'human:clerk' });
  const soonDay = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const soon = A.addObligation({ title: 'Social security', authority: 'Ministry of Labour', due: soonDay, recurrence: 'monthly', actor: 'human:clerk' });
  const first = A.obligationSweep();
  assert.equal(first.overdue, 1);
  assert.equal(one('SELECT state FROM adm_obligation WHERE id = ?', late.id).state, 'overdue');
  assert.equal(first.due, 2);
  A.obligationSweep();
  assert.equal(q("SELECT id FROM jobs WHERE kind = 'core2.event' AND payload LIKE '%obligation.due%'").length, 2, 'once a day per obligation');

  assert.throws(() => A.completeObligation(soon.id, { actor: `agent:${AGENT}` }), /human act/);
  A.completeObligation(soon.id, { actor: 'human:clerk' });
  const next = one('SELECT * FROM adm_obligation WHERE title = ? AND state = ?', 'Social security', 'pending');
  assert.ok(next, 'a monthly obligation done must put the next one on the calendar');
  assert.equal(next.due, one('SELECT date(?, ?) AS d', soonDay, '+1 month').d);
});

test('a licence expires and renews; acknowledging a policy is per person and never a restricted document', () => {
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const l = A.addLicense({ name: 'Commercial registration', authority: 'Registrar', number: 'CR-1', expires: in30, actor: 'human:clerk' });
  assert.equal(A.licenseSweep().expiring, 1);
  assert.throws(() => A.renewLicense(l.id, { expires: '2026-01-01', actor: 'human:clerk' }), /later than/);
  const renewed = A.renewLicense(l.id, { expires: `${year + 1}-12-31`, actor: 'human:clerk' });
  assert.equal(one('SELECT state FROM adm_license WHERE id = ?', l.id).state, 'renewed');
  assert.equal(renewed.number, 'CR-1');

  const policy = createDocument({ title: 'Policy — Travel', classification: 'internal', body: 'Book economy.', actor: 'human:hr' });
  A.acknowledgePolicy({ docId: policy.id, employeeId: e1.id, actor: 'human:huda' });
  const st = A.policyAckStatus(policy.id);
  assert.deepEqual(st.acknowledged.map((s) => s.id), [e1.id]);
  assert.deepEqual(st.pending.map((s) => s.id), [e2.id]);
  const secret = createDocument({ title: 'Note', classification: 'restricted', subjectPersonId: p1.id, body: 'x', actor: 'human:hr' });
  assert.throws(() => A.acknowledgePolicy({ docId: secret.id, employeeId: e1.id, actor: 'human:huda' }), /not a policy/);
});

test('the page about you shows only what is yours', () => {
  assert.equal(A.myWorkspace({ username: 'ghost' }).linked, false);
  exec("INSERT INTO users (username, display_name, pass, role, perms, person_id) VALUES ('huda', 'Huda', 'x:y', 'member', '[]', ?)", p1.id);
  openTicket({ title: 'Mine', requesterEmployeeId: e1.id, actor: 'human:huda' });
  openTicket({ title: 'Not mine', requesterEmployeeId: e2.id, actor: 'human:sami' });
  const me = A.myWorkspace({ username: 'huda' });
  assert.equal(me.linked, true);
  assert.equal(me.employee.id, e1.id);
  assert.deepEqual(me.tickets.map((x) => x.title), ['Mine']);
  assert.equal(me.policiesToAcknowledge.length, 0, 'Huda already acknowledged the travel policy');
  assert.equal(A.myWorkspace({ username: 'huda' }).salaryOnFile, false, 'no salary was recorded for this employment');
});
