// Phase 5: one question box over two galaxies, and the verbs measured
// rather than claimed.
//
// The routing stays regex — no model call — and the enterprise answers are
// computed from the record, with a rule about what an answer may contain:
// attendance gives names and counts (org facts), payroll gives a pointer and
// never a number, because an answer box must not become the hole in the seal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-ask.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 43).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-core2-ask.db${suffix}`)); } catch { /* first run */ }
}

const { one, exec } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { checkIn } = await import('../src/core2/time.js');
const { seedBridge, verbCoverage, TOOLS } = await import('../src/core2/bridge.js');
const { classify, ask } = await import('../src/ask.js');
const { mcpTools } = await import('../src/mcptools.js');

seedAgents();
seedConstitution();
seedBridge();

const p1 = createPerson({ displayName: 'Zain Kamal', personalEmail: 'zain@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', baseSalary: 2000, actor: 'human:test' });
const p2 = createPerson({ displayName: 'Mays Jaber', personalEmail: 'mays@example.test', actor: 'human:test' });
employ({ personId: p2.id, employeeNo: 'E002', actor: 'human:test' });
checkIn(e1.id, { actor: 'human:test' });

// --- the router speaks both languages ---------------------------------------

test('enterprise questions route to the record, in Arabic and English', () => {
  for (const [text, rule] of [
    ['منو غايب اليوم؟', 'attendance'],
    ['who is absent today', 'attendance'],
    ['شنو وضع الرواتب', 'payroll'],
    ['pending leave requests', 'leave'],
    ['عقود تنتهي قريبا', 'contracts'],
    ['acme trading', 'lookup'],
  ]) {
    assert.equal(classify(text).id, rule, `"${text}" routed to ${classify(text).id}`);
  }
});

test('the attendance answer is names and counts — org facts, nothing sealed', async () => {
  const r = await ask('منو غايب اليوم؟', { actor: 'human:test' });
  assert.equal(r.route.target, 'core2');
  assert.match(r.core2.headline, /1 in, 1 absent/);
  assert.deepEqual(r.core2.rows.map((x) => x.title), ['Mays Jaber']);
  assert.equal(r.core2.href, '#/time');
  // The answer names the Core 2 department it came from.
  assert.ok(r.departments.some((d) => d.id === 'time'));
});

test('the payroll answer is a pointer, never a number', async () => {
  const r = await ask('what is the payroll status', { actor: 'human:test' });
  assert.equal(r.route.rule, 'payroll');
  assert.ok(!/\d{3,}/.test(r.core2.headline), 'a payroll figure leaked into the answer box');
  assert.equal(r.core2.href, '#/finops2');
  assert.match(r.core2.note, /sealed/);
});

// --- the verbs are measured --------------------------------------------------

test('every module has the verbs its wiring earns, and none it does not', () => {
  const cov = verbCoverage();
  assert.equal(cov.length, 8, 'eight modules, eight rows');
  for (const m of cov) {
    assert.equal(m.ask, m.tools.some((t2) => !TOOLS[t2].write), `${m.module}: ask must mean a read tool exists`);
    if (m.executeGated.length) {
      for (const c of m.executeGated) assert.ok(c, `${m.module} lists an empty gated command`);
    }
  }
  const payops = cov.find((m) => m.module === 'payops');
  assert.ok(payops.executeGated.includes('approvePayroll'));
  const talent = cov.find((m) => m.module === 'talent');
  assert.ok(talent.executeGated.includes('terminateEmployee'));
  // Monitor means events actually declared, not a hopeful tick.
  assert.equal(cov.find((m) => m.module === 'contracts').monitor, true);
});

// --- the MCP surface: same permissions, no agents ---------------------------

test('every Core 2 tool is on the MCP server, guarded by its own permission', () => {
  for (const name of Object.keys(TOOLS)) {
    assert.ok(mcpTools[`core2_${name}`], `core2_${name} is missing from the MCP surface`);
  }
  // A user without the permission is refused by the same must() as everything.
  const nobody = { username: 'guest', role: 'member', perms: ['dashboard.view'] };
  assert.throws(() => mcpTools.core2_get_payroll({ id: 1 }, nobody), /finance.view/);
  // And with the permission, the tool answers.
  const reader = { username: 'hr', role: 'member', perms: ['people.view', 'org.view'] };
  const chart = mcpTools.core2_get_org_chart({}, reader);
  assert.ok(chart.total >= 0);
});

test('an install that predates a tool learns it on the next boot', () => {
  // Shrink the connector's declared list the way an old install would have it.
  exec("UPDATE connectors SET scopes = '[\"core2.get_employee\"]' WHERE id = 'enterprise-core'");
  const r = seedBridge();
  assert.equal(r.synced, true, 'seedBridge left the stale capability list in place');
  const scopes = JSON.parse(one("SELECT scopes FROM connectors WHERE id = 'enterprise-core'").scopes);
  assert.ok(scopes.includes('core2.search_documents'), 'the new tool is still undeclared');
  assert.ok(scopes.includes('core2.gated'));
});
