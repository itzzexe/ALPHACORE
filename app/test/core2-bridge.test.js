// The five tunnels, and the proof that none of them can be walked around.
//
// The directive's load-bearing sentence is "Core 2 gets no special-cased trust
// just because it's internal", and its load-bearing list is the set of commands
// that may never clear the gateway on autonomy alone. Both are the kind of
// claim that is true on the day it is written and quietly false a month later,
// so both are asserted here from the outside: not "does the code call the
// gate", but "what happens when an agent tries".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-bridge.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 23).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-core2-bridge.db${suffix}`)); } catch { /* first run */ }
}

const { one, q } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { grantScope } = await import('../src/egress.js');
const { jobsTick } = await import('../src/jobs.js');
const { PERMS } = await import('../src/auth.js');
const {
  TOOLS, ALWAYS_HUMAN, CONNECTOR, EVENTS, CHAINED_EVENTS,
  seedBridge, callTool, command, emit, identityAudit, bridgeOverview, isAlwaysHuman, shouldChain,
} = await import('../src/core2/bridge.js');

seedAgents();
seedConstitution();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;

// --- Bridge 1: the tool surface -----------------------------------------

test('Core 2 is registered with the gate like any other connector', () => {
  const c = one('SELECT * FROM connectors WHERE id = ?', CONNECTOR);
  assert.ok(c, 'Core 2 is not behind the egress gate at all');
  const scopes = JSON.parse(c.scopes);
  // Every tool must be a declared capability, or it is refused two checks
  // earlier as something the connector never offered — which looks like the
  // gate working and is the opposite.
  for (const name of Object.keys(TOOLS)) {
    assert.ok(scopes.includes(`core2.${name}`), `${name} is not a declared capability`);
  }
  assert.ok(scopes.includes('core2.gated'), 'gated commands could never reach a person');
});

test('no tool is a catch-all, and every tool names a permission that exists', () => {
  for (const [name, t] of Object.entries(TOOLS)) {
    assert.ok(!/sql|query|exec|eval/i.test(name), `${name} looks like a catch-all`);
    assert.ok(t.permission, `${name} names no permission`);
    assert.ok(PERMS.includes(t.permission), `${name} needs ${t.permission}, which is not in the catalogue`);
    assert.ok(t.about, `${name} does not say what it is for`);
  }
});

test('an unscoped agent is refused, and the refusal names the scope', async () => {
  const r = await callTool('get_org_chart', {}, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'blocked');
  assert.match(r.why, /does not hold/);
});

test('a read passes the gate rather than going around it', async () => {
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.get_org_chart', actor: 'human:test' });
  const before = one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = ?", CONNECTOR).n;
  const r = await callTool('get_org_chart', {}, { agentId: AGENT, actor: 'agent' });
  assert.equal(r.verdict, 'allowed');
  assert.ok(r.result, 'the tool returned nothing');
  const after = one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = ?", CONNECTOR).n;
  assert.ok(after > before, 'the read left no trace in the egress log — it went around the gate');
});

// --- Bridge 3: the gateway, and the categorical list --------------------

test('a listed command waits for a person, and a scope does not change that', async () => {
  // A human actor: passes the scope check, and is still held.
  const asHuman = await command('terminateEmployee', { employeeId: 1 }, { actor: 'human:test' });
  assert.equal(asHuman.verdict, 'gated', 'a termination completed without a person');

  // An unscoped agent: refused earlier, for a different reason.
  const unscoped = await command('approvePayroll', {}, { agentId: AGENT, actor: 'agent' });
  assert.equal(unscoped.verdict, 'blocked');

  // A *scoped* agent: this is the one that matters. Holding the scope is
  // exactly the situation where a value-ceiling rule would let it through.
  grantScope({ agentId: AGENT, connector: CONNECTOR, capability: 'core2.gated', actor: 'human:test' });
  const scoped = await command('approvePayroll', {}, { agentId: AGENT, actor: 'agent' });
  assert.equal(scoped.verdict, 'gated', 'a granted scope cleared a categorically gated command');

  // And the escape hatch does not work either.
  const forced = await command('approvePayroll', {}, { agentId: AGENT, actor: 'agent', force: true });
  assert.equal(forced.verdict, 'gated', 'force cleared a categorically gated command');
});

test('the gate holds regardless of amount — it is not the ceiling doing this', async () => {
  // A zero-value payroll approval is still gated. If the ceiling were what was
  // holding these, this would sail through.
  const free = await command('changeSalary', { valueUsd: 0 }, { agentId: AGENT, actor: 'agent' });
  assert.equal(free.verdict, 'gated');
  const huge = await command('changeSalary', { valueUsd: 1_000_000 }, { agentId: AGENT, actor: 'agent' });
  assert.equal(huge.verdict, 'gated');
});

test('every categorically gated command is named, and none is a write tool in disguise', () => {
  assert.ok(ALWAYS_HUMAN.size >= 5);
  for (const name of ALWAYS_HUMAN) {
    assert.equal(isAlwaysHuman(name), true);
    // A gated command must not also be reachable as an ordinary write tool,
    // which would be a second door onto the same act.
    assert.ok(!TOOLS[name] || TOOLS[name].write, `${name} is gated but also a plain tool`);
  }
  assert.equal(isAlwaysHuman('get_org_chart'), false);
});

test('a write tool is never called directly, even when asked for as a tool', async () => {
  // callTool on a write must divert into the gateway. If it did not, this would
  // create the unit without a permission check on the command path.
  const r = await callTool('create_org_unit', { name: 'Smuggled' }, { agentId: AGENT, actor: 'agent' });
  assert.notEqual(r.verdict, 'allowed');
  assert.equal(one('SELECT COUNT(*) AS n FROM hr_org_unit WHERE name = ?', 'Smuggled').n, 0,
    'a write reached Core 2 without clearing the gateway');
});

// --- Bridge 2: events ----------------------------------------------------

test('an event lands on the existing queue and is handled, not dead-lettered', async () => {
  emit('employee.created', { id: 1, employeeNo: 'E001' });
  const job = one("SELECT id, kind, state FROM jobs WHERE kind = 'core2.event' ORDER BY id DESC LIMIT 1");
  assert.ok(job, 'the event was never queued');
  await jobsTick();
  const after = one('SELECT state FROM jobs WHERE id = ?', job.id);
  assert.notEqual(after.state, 'dead', 'the event had no handler');
});

test('the consequential subset is chained, and the rest is not', async () => {
  assert.equal(shouldChain('employee.terminated'), true);
  assert.equal(shouldChain('attendance.ping'), false);
  assert.ok(CHAINED_EVENTS.size < EVENTS.length,
    'everything is chained, which buries the signal the chain exists to carry');

  emit('employee.terminated', { id: 42 });
  await jobsTick();
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'employee.terminated' ORDER BY seq DESC LIMIT 1"),
    'a termination did not reach the chain');

  emit('task.created', { id: 7 });
  await jobsTick();
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'task.created'").n, 0,
    'an ordinary event was chained — the chain is being used as a log');

  // Both are in the operational log either way.
  assert.ok(one("SELECT id FROM core2_log WHERE action = 'task.created'"));
  assert.equal(verifyChain().ok, true);
});

// --- Bridge 4: identity, audited rather than remembered -----------------

test('no Core 2 table can hold an agent where a human belongs', () => {
  const a = identityAudit();
  assert.equal(a.ok, true, `holes: ${JSON.stringify(a.holes)}`);
  assert.deepEqual(a.holes, []);
});

// --- the overview describes what is actually wired ----------------------

test('the overview does not claim more than is built', () => {
  const o = bridgeOverview();
  assert.equal(o.connector?.id, CONNECTOR);
  assert.equal(o.tools.length, Object.keys(TOOLS).length);
  assert.ok(o.calls > 0, 'no call has ever gone through the gate');
  assert.ok(o.gated > 0, 'nothing has ever been held for a person');
  assert.equal(o.identity.ok, true);
  assert.match(o.note, /no trust/i);
});
