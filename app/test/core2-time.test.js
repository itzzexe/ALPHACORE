// Employee Operations, and the directive's worked example: a leave request an
// agent may file but never decide.
//
// The flow under test is the whole architecture in one feature — agent →
// gateway → balance check → conflict check → pending request → human decision.
// Each arrow is asserted separately, because a flow that works end to end can
// still be wrong in the middle: an agent that could approve, a balance check
// that runs after the insert, a reason field that quietly holds a diagnosis.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-time.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 31).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-time.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { tierAUnreachable, eraseSubject, verifyErasure } = await import('../src/erasure.js');
const { verifyChain } = await import('../src/audit.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { createDocument } = await import('../src/core2/documents.js');
const { seedBridge, callTool, CONNECTOR } = await import('../src/core2/bridge.js');
const {
  checkIn, checkOut, attendanceToday, createPolicy, balanceFor, requestLeave, decideLeave, listLeave, timeOverview,
} = await import('../src/core2/time.js');
const {
  createMeeting, getMeeting, setMeetingState, addAction, listMeetings, meetingsOverview,
} = await import('../src/core2/meetings.js');

seedAgents();
seedConstitution();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;

const alice = createPerson({ displayName: 'Alia Nasser', personalEmail: 'alia@example.test', actor: 'human:test' });
const empA = employ({ personId: alice.id, employeeNo: 'E001', actor: 'human:test' });
const badr = createPerson({ displayName: 'Badr Salem', personalEmail: 'badr@example.test', actor: 'human:test' });
const empB = employ({ personId: badr.id, employeeNo: 'E002', actor: 'human:test' });

const ANNUAL = createPolicy({ name: 'Annual leave', leaveType: 'annual', daysPerYear: 21, actor: 'human:test' });
const SICK = createPolicy({ name: 'Sick leave', leaveType: 'sick', daysPerYear: 10, needsDocument: true, actor: 'human:test' });

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}

// --- minimization is structural, not behavioural ---------------------------

test('no leave table has anywhere to write a reason, a note, or a diagnosis', () => {
  for (const t of ['time_leave_request', 'time_leave_policy', 'time_leave_balance', 'time_attendance']) {
    const cols = q(`PRAGMA table_info(${t})`).map((c) => c.name);
    for (const banned of ['reason', 'note', 'notes', 'detail', 'details', 'description', 'comment', 'diagnosis', 'body', 'text']) {
      assert.ok(!cols.includes(banned), `${t}.${banned} exists — a free-text field is where a diagnosis ends up`);
    }
  }
});

test('sick leave demands a sealed document, and refuses an unsealed one', () => {
  assert.throws(() => requestLeave({
    employeeId: empA.id, policyId: SICK.id, starts: '2026-09-01', ends: '2026-09-02', actor: 'human:test',
  }), /supporting document/);

  const openDoc = createDocument({ title: 'A note', classification: 'internal', body: 'x', actor: 'human:test' });
  assert.throws(() => requestLeave({
    employeeId: empA.id, policyId: SICK.id, starts: '2026-09-01', ends: '2026-09-02', docId: openDoc.id, actor: 'human:test',
  }), /must be restricted/);

  const sealedDoc = createDocument({
    title: 'Doctor\'s note', classification: 'restricted', subjectPersonId: alice.id,
    body: 'SEALED-NOTE-b7 unfit for work', actor: 'human:test',
  });
  const r = requestLeave({
    employeeId: empA.id, policyId: SICK.id, starts: '2026-09-01', ends: '2026-09-02', docId: sealedDoc.id, actor: 'human:test',
  });
  assert.equal(r.state, 'pending');
  assert.ok(!diskContains('SEALED-NOTE-b7'), 'the note leaked into the file in plaintext');
});

// --- the checks run before the insert --------------------------------------

test('a request beyond the balance is refused, and nothing is written', () => {
  const before = one('SELECT COUNT(*) AS n FROM time_leave_request').n;
  assert.throws(() => requestLeave({
    employeeId: empB.id, policyId: ANNUAL.id, starts: '2026-06-01', ends: '2026-07-15', actor: 'human:test',
  }), /balance is 21/);
  assert.equal(one('SELECT COUNT(*) AS n FROM time_leave_request').n, before);
});

test('an overlapping request is refused by name', () => {
  requestLeave({ employeeId: empB.id, policyId: ANNUAL.id, starts: '2026-06-01', ends: '2026-06-05', actor: 'human:test' });
  assert.throws(() => requestLeave({
    employeeId: empB.id, policyId: ANNUAL.id, starts: '2026-06-03', ends: '2026-06-08', actor: 'human:test',
  }), /overlaps request #/);
});

// --- the gateway files; a human decides -------------------------------------

test('an agent files a leave request through the gate, and the checks still run', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.create_leave_request', actor: 'human:test' });

  const ok = await callTool('create_leave_request', {
    employeeId: empA.id, policyId: ANNUAL.id, starts: '2026-10-01', ends: '2026-10-03',
  }, { agentId: AGENT, actor: 'agent' });
  assert.equal(ok.verdict, 'allowed');
  assert.equal(ok.result.state, 'pending', 'the agent-filed request must wait for a person');

  // The same checks bite through the gate: over-balance is refused inside
  // Core 2 and surfaces as a failed egress call, not a written row.
  await assert.rejects(() => callTool('create_leave_request', {
    employeeId: empA.id, policyId: ANNUAL.id, starts: '2026-11-01', ends: '2026-12-31',
  }, { agentId: AGENT, actor: 'agent' }));
});

test('deciding leave is a human act with no path for an agent', async () => {
  const pending = listLeave({ state: 'pending' }).find((r) => r.employee_id === empA.id);
  assert.ok(pending);

  // Not by module call with an agent actor…
  assert.throws(() => decideLeave(pending.id, { approve: true, actor: `agent:${AGENT}` }), /human act/);
  // …and not through the gateway either: there is no tool by any deciding name.
  for (const name of ['approve_leave', 'decide_leave', 'reject_leave']) {
    await assert.rejects(() => callTool(name, { id: pending.id }, { agentId: AGENT, actor: 'agent' }), /no such/);
  }

  const done = decideLeave(pending.id, { approve: true, actor: 'human:manager' });
  assert.equal(done.state, 'approved');
  assert.equal(done.decided_by, 'human:manager');
  const bal = balanceFor(empA.id, ANNUAL.id);
  assert.ok(bal.used >= 3, 'approval must consume the balance');
  // Approval is consequential: it reaches the chain via the bridge.
  await jobsTick();
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'leave.approved'"), 'an approved leave is chained');
  assert.equal(verifyChain().ok, true);
});

// --- attendance -------------------------------------------------------------

test('attendance: idempotent arrival, computed minutes, and leave shows as leave', () => {
  const first = checkIn(empB.id, { actor: 'human:test' });
  const again = checkIn(empB.id, { actor: 'human:test' });
  assert.equal(first.id, again.id, 'arriving twice is one arrival');
  const out = checkOut(empB.id, { actor: 'human:test' });
  assert.ok(out.minutes >= 0);
  assert.throws(() => checkOut(999, { actor: 'human:test' }), /before checking in/);

  const day = attendanceToday();
  assert.ok(day.people.length >= 2);
  assert.ok(day.people.find((p) => p.id === empB.id).in, 'Badr checked in');
});

// --- meetings ---------------------------------------------------------------

test('an agent cannot be a meeting participant of record', () => {
  const m = createMeeting({
    title: 'Weekly ops', scheduledAt: '2026-08-17 10:00', organizerEmployeeId: empA.id,
    participantIds: [empB.id], actor: 'human:test',
  });
  assert.equal(m.participants.length, 2);
  // Straight at the table: STRICT refuses the TEXT agent id in the INTEGER column.
  assert.throws(() => exec('INSERT INTO mtg_participant (meeting_id, employee_id) VALUES (?,?)', m.id, AGENT));
  // And through the module: an agent id is not an employee.
  assert.throws(() => createMeeting({
    title: 'Bots only', scheduledAt: '2026-08-18 10:00', organizerEmployeeId: AGENT, actor: 'human:test',
  }));
});

test('the transcript is sealed on arrival and dies with the organizer', () => {
  const m = listMeetings()[0];
  const TRANSCRIPT = 'PLANTED-TRANSCRIPT-4e19 we discussed the restructure';
  setMeetingState(m.id, { state: 'completed', transcript: TRANSCRIPT, actor: 'human:test' });
  assert.ok(!diskContains(TRANSCRIPT), 'the transcript is readable in the raw file');
  assert.equal(getMeeting(m.id).transcript, TRANSCRIPT);

  addAction(m.id, { kind: 'decision', what: 'Hire two engineers', actor: 'human:test' });
  assert.throws(() => addAction(m.id, { kind: 'action', what: 'Follow up', ownerEmployeeId: 424242, actor: 'human:test' }), /must be an employee/);

  eraseSubject({ kind: 'contact', identifier: 'alia@example.test', reason: 'test', actor: 'human:test' });
  assert.equal(getMeeting(m.id).transcript, '[erased]');
  assert.equal(getMeeting(m.id).title, 'Weekly ops', 'the meeting itself survives');
  assert.equal(verifyErasure({ kind: 'contact', identifier: 'alia@example.test' }).ok, true);
  assert.deepEqual(tierAUnreachable(), []);
});

test('the overviews say what is really there', () => {
  assert.ok(timeOverview().pending >= 0);
  assert.match(timeOverview().note, /human act/);
  const mo = meetingsOverview();
  assert.ok(mo.decisions >= 1);
  assert.ok(mo.sealedTranscripts >= 0);
});
