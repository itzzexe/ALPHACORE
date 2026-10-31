// The self-improvement loop: the Grader scores, the Coach rewrites, and only
// what helps is kept.
//
// What is tested is what the loop decides — which answer passes, where the
// coach's rules sit in a playbook, that a rewrite which helped is kept and one
// that hurt is put back, that "ask" mode waits for a person, and that only a
// person starts, stops or reverts. The whole loop is walked in mock mode: the
// mock's default answer leaves out a field the test employee's contract asks
// for, and honours the coach's rule to include it, so round two passes for
// the reason a real model's would.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-selfimprove.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-selfimprove-files/memory';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-selfimprove.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-selfimprove-files'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { agentsConfig } = await import('../src/env.js');
const { seedAgents, leaseNext, executeRun, enqueueRun } = await import('../src/workflow.js');
const { ensurePlaybooks, readPlaybook, writePlaybook } = await import('../src/memory.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const SI = await import('../src/selfimprove.js');

// An employee whose contract asks for one field more than the mock's default
// answer carries, and a second one that already passes.
const TESTER = 'AGT-TST-SI1';
const STEADY = 'AGT-TST-SI2';
agentsConfig.agents.push(
  { id: TESTER, name: 'Test Planner', group: 'build', tier: 'T1', owner: 'CEO', failMode: 'fail-to-human', confidenceFloor: 0.5, sensitivity: 'internal',
    system: 'You are the Test Planner agent. You plan the next move for a piece of work. Output JSON: {"summary":"","nextMove":"","confidence":0}' },
  { id: STEADY, name: 'Test Steady', group: 'assure', tier: 'T1', owner: 'CEO', failMode: 'fail-to-human', confidenceFloor: 0.5, sensitivity: 'internal',
    system: 'You are the Test Steady agent. You summarise. Output JSON: {"summary":"","confidence":0}' },
);
seedAgents();
ensurePlaybooks();

const ALICE = 'human:alice';
async function drain() {
  for (let i = 0; i < 80; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}
/** Tick the loop until it settles: run what it queued, fold it back, repeat. */
async function settle(loopId, until = ['done', 'stopped', 'waiting']) {
  for (let i = 0; i < 20; i++) {
    await drain();
    SI.syncSelfImprove();
    const l = one('SELECT state FROM si_loops WHERE id = ?', loopId);
    if (until.includes(l.state)) return l.state;
  }
  return one('SELECT state FROM si_loops WHERE id = ?', loopId).state;
}
async function history(agentId, n = 2) {
  for (let i = 0; i < n; i++) enqueueRun({ agentId, taskType: 'work', input: { prompt: `Plan the next move for the quarterly supplier review, item ${i + 1}.` }, actor: ALICE });
  await drain();
}

// ------------------------------------------------------------- grading --

test('the contract is read from the role, and the rubric is code', () => {
  assert.deepEqual(SI.contractKeys('You are X. Output JSON: {"summary":"","nextMove":"","items":[{"a":1}],"confidence":0}'), ['summary', 'nextMove', 'items', 'confidence']);
  assert.deepEqual(SI.contractKeys('No contract here.'), []);

  const ok = SI.grade(TESTER, { raw: '{"summary":"s","nextMove":"m","confidence":0.8}' });
  assert.equal(ok.pass, true);
  const missing = SI.grade(TESTER, { raw: '{"summary":"s","confidence":0.8}' });
  assert.equal(missing.pass, false);
  assert.equal(missing.checks.contract, false);
  assert.deepEqual(missing.missing, ['nextMove']);
  const low = SI.grade(TESTER, { raw: '{"summary":"s","nextMove":"m","confidence":0.2}' });
  assert.equal(low.checks.confidence, false, 'below the floor is a fail');
  const prose = SI.grade(TESTER, { raw: 'Sure! Here is my plan.' });
  assert.equal(prose.checks.json, false);
  // The same answer always scores the same: grading is not a model call.
  assert.deepEqual(SI.grade(TESTER, { raw: '{"summary":"s","confidence":0.8}' }), missing);
  // A golden case's expected answer is checked when it states one.
  const exp = SI.grade(TESTER, { raw: '{"summary":"yes","nextMove":"m","confidence":0.8}' }, { field: 'summary', anyOf: ['no'] });
  assert.equal(exp.checks.expected, false);
});

test('the coach\'s rules sit before the first heading, so recall reads them', () => {
  const body = '# Playbook\nIntro line.\n\n## Lessons\n' + 'x'.repeat(4000);
  const once = SI.withRules(body, ['Always do A', 'Never do B']);
  assert.ok(once.indexOf('## Rules from the coach') < once.indexOf('## Lessons'));
  assert.deepEqual(SI.coachRules(once), ['Always do A', 'Never do B']);
  // Rewriting replaces the section rather than stacking a second one.
  const twice = SI.withRules(once, ['Always do C']);
  assert.equal(twice.split('## Rules from the coach').length, 2);
  assert.deepEqual(SI.coachRules(twice), ['Always do C']);
  assert.ok(twice.includes('## Lessons'), 'the rest of the playbook is untouched');
  assert.deepEqual(SI.coachRules('# no section'), []);
});

// ------------------------------------------------------------ the loop --

test('only a person starts a loop, and only with something to test', async () => {
  assert.throws(() => SI.startLoop({ agents: [TESTER], actor: 'system:x' }), /person/);
  assert.throws(() => SI.startLoop({ agents: [TESTER], actor: ALICE }), /anything to be tested/);
  await history(TESTER);
  await history(STEADY);
  assert.throws(() => SI.startLoop({ agents: [TESTER], target: 2, actor: ALICE }), /between 0 and 1/);
  assert.throws(() => SI.startLoop({ agents: [TESTER], maxRounds: 40, actor: ALICE }), /rounds/);
});

test('a failing employee is coached, passes the next round, and the rewrite is kept', async () => {
  setSetting('SELF_IMPROVE_MODE', 'auto');
  const before = readPlaybook(TESTER) || '';
  const loop = SI.startLoop({ agents: [TESTER, STEADY], target: 0.95, batch: 2, maxRounds: 4, actor: ALICE });
  assert.equal(loop.name, 'self-improve-01');
  assert.throws(() => SI.startLoop({ agents: [TESTER], actor: ALICE }), /already running/);
  assert.equal(await settle(loop.id), 'done');

  const l = SI.getLoop(loop.id);
  assert.equal(l.rounds.length, 2);
  assert.equal(l.rounds[0].by_agent[TESTER].passed, 0, 'round one: the field was missing');
  assert.equal(l.rounds[0].by_agent[STEADY].passed, l.rounds[0].by_agent[STEADY].total, 'the steady one passed from the start');
  assert.equal(l.lastPass, 1);
  assert.ok(l.firstPass < l.lastPass);
  assert.equal(l.note, 'target reached');
  assert.equal(l.versions.length, 1, 'only the employee that failed was rewritten');
  assert.equal(l.versions[0].agent_id, TESTER);
  assert.equal(l.versions[0].state, 'kept');
  assert.ok(l.versions[0].added.some((r) => r.includes('nextMove')));
  assert.ok(l.metrics.fixed >= 1);
  assert.equal(l.metrics.byMe, 0, 'nobody edited a playbook by hand');

  const after = readPlaybook(TESTER);
  assert.notEqual(after, before);
  assert.ok(SI.coachRules(after).some((r) => r.includes('nextMove')));
  // The coach touched the playbook and nothing else.
  assert.ok(agentsConfig.agents.find((a) => a.id === TESTER).system.includes('Test Planner'));
  assert.equal(readPlaybook(STEADY) && SI.coachRules(readPlaybook(STEADY)).length, 0);

  // Every graded task was a real run of the employee.
  const runs = one("SELECT COUNT(*) AS n FROM si_tasks WHERE loop_id = ? AND run_id IS NOT NULL", loop.id).n;
  assert.equal(runs, one('SELECT COUNT(*) AS n FROM si_tasks WHERE loop_id = ?', loop.id).n);
  assert.equal(one("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'si:%'").n, runs);
  // The coach's runs and the graded runs are not history for the next loop.
  assert.ok(SI.tasksFor(TESTER, 10).every((t) => !/si:|coach:/.test(t.prompt)));
});

test('the map draws the loop that ran, and what each employee called', () => {
  const m = SI.mapData();
  assert.equal(m.mode, 'loop');
  assert.equal(m.loop.name, 'self-improve-01');
  assert.equal(m.loop.state, 'done');
  const w = m.workers.find((x) => x.id === TESTER);
  assert.deepEqual(w.series, [0, 1]);
  assert.equal(w.pass, 1);
  assert.equal(w.version, 1);
  assert.ok(w.rules.length);
  assert.deepEqual(w.contract, ['summary', 'nextMove', 'confidence']);
  assert.equal(m.gate.passed, m.gate.total);
  assert.equal(m.inputs.rubric.length, SI.RUBRIC.length);
  assert.ok(m.inputs.history >= 2);
  // Pointing at a loop that does not exist is the live map, not an error.
  assert.equal(SI.mapData({ loopId: 999 }).mode, 'live');
});

test('a rewrite after which the employee scored lower is put back on its own', async () => {
  // The mock never gets worse on its own, so the regression is built on the
  // engine's own tables: a round that passed, a rewrite, a round that did not.
  const loop = SI.startLoop({ agents: [STEADY], target: 1, batch: 1, maxRounds: 3, actor: ALICE });
  await drain();
  SI.syncSelfImprove();
  const l1 = SI.getLoop(loop.id);
  assert.equal(l1.state, 'done', 'a loop that starts at its target finishes in round one');
  assert.equal(l1.note, 'target reached');

  // Hand-built regression on the engine's own tables, then the tick judges it.
  const reg = exec("INSERT INTO si_loops (name, target, batch, max_rounds, mode, scope, round, state, started_by) VALUES ('regress', 0.99, 1, 3, 'auto', ?, 2, 'grading', ?)", JSON.stringify([STEADY]), ALICE);
  const rid = Number(reg.lastInsertRowid);
  const original = readPlaybook(STEADY);
  const worse = SI.withRules(original, ['A rule that made things worse']);
  writePlaybook(STEADY, worse, { actor: 'system:selfimprove', reason: 'test' });
  exec("INSERT INTO playbook_versions (agent_id, version, loop_id, round, before_body, after_body, removed, added, state, decided_by, created_by) VALUES (?, 1, ?, 1, ?, ?, '[]', '[\"A rule that made things worse\"]', 'applied', 'system:selfimprove', 'AGT-COACH-001')",
    STEADY, rid, original, worse);
  exec("INSERT INTO si_tasks (loop_id, round, agent_id, case_key, source, prompt, verdict) VALUES (?, 1, ?, 'k', 'history', 'p', 'pass')", rid, STEADY);
  exec("INSERT INTO si_rounds (loop_id, round, passed, total, by_agent) VALUES (?, 1, 1, 1, ?)", rid, JSON.stringify({ [STEADY]: { passed: 1, total: 1 } }));
  exec("INSERT INTO si_tasks (loop_id, round, agent_id, case_key, source, prompt, verdict) VALUES (?, 2, ?, 'k', 'history', 'p', 'fail')", rid, STEADY);
  SI.syncSelfImprove();
  const v = one('SELECT state FROM playbook_versions WHERE loop_id = ?', rid);
  assert.equal(v.state, 'reverted');
  assert.equal(readPlaybook(STEADY), original, 'the playbook is what it was before the rewrite');
  exec("UPDATE si_loops SET state = 'stopped' WHERE id = ?", rid);
});

test('in ask mode the loop waits for a person, and a person decides', async () => {
  setSetting('SELF_IMPROVE_MODE', 'ask');
  // Put the tester back to failing: its playbook without the coach's rule.
  writePlaybook(TESTER, SI.withRules(readPlaybook(TESTER), []), { actor: ALICE, reason: 'test reset' });
  const loop = SI.startLoop({ agents: [TESTER], target: 0.95, batch: 1, maxRounds: 3, actor: ALICE });
  assert.equal(await settle(loop.id), 'waiting');
  const l = SI.getLoop(loop.id);
  const proposal = l.coach.find((c) => c.state === 'proposed');
  assert.ok(proposal, 'the coach proposed, and nothing was applied');
  assert.equal(l.versions.length, 0);
  assert.throws(() => SI.decideRewrite({ id: proposal.id, verdict: 'accept', actor: 'system:x' }), /person/);
  assert.throws(() => SI.decideRewrite({ id: proposal.id, verdict: 'maybe', actor: ALICE }), /accept or reject/);
  SI.decideRewrite({ id: proposal.id, verdict: 'accept', actor: ALICE });
  assert.equal(one('SELECT state FROM si_loops WHERE id = ?', loop.id).state, 'grading', 'deciding the last proposal starts the next round');
  assert.equal(await settle(loop.id), 'done');
  const done = SI.getLoop(loop.id);
  assert.equal(one('SELECT decided_by FROM playbook_versions WHERE loop_id = ?', loop.id).decided_by, ALICE);
  assert.equal(done.lastPass, 1);

  // Reverting by hand: a person, the latest version only.
  const vid = done.versions[0].id;
  assert.throws(() => SI.revertVersion({ id: vid, actor: 'system:x' }), /person/);
  SI.revertVersion({ id: vid, actor: ALICE });
  assert.equal(SI.coachRules(readPlaybook(TESTER)).length, 0);
  assert.throws(() => SI.revertVersion({ id: vid, actor: ALICE }), /already reverted/);
  setSetting('SELF_IMPROVE_MODE', 'auto');
});

test('a round in which nothing would change is not paid for twice', async () => {
  // A golden canary the mock cannot catch: the coach is told what the answer
  // should have been, has no rule to offer, and the loop stops there.
  const loop = SI.startLoop({ agents: ['AGT-SEC-001'], target: 0.95, batch: 1, maxRounds: 4, actor: ALICE });
  assert.equal(await settle(loop.id), 'done');
  const l = SI.getLoop(loop.id);
  assert.equal(l.round, 1);
  assert.equal(l.note, 'the coach had nothing to change');
  const coachRun = one("SELECT input FROM runs WHERE task_type = ? AND agent_id = 'AGT-COACH-001'", `coach:${loop.id}:1`);
  assert.match(coachRun.input, /expected \w+ to be one of/);

  // Rejecting every proposal leaves the playbooks as they were: same answer.
  setSetting('SELF_IMPROVE_MODE', 'ask');
  writePlaybook(TESTER, SI.withRules(readPlaybook(TESTER), []), { actor: ALICE, reason: 'test reset' });
  const ask = SI.startLoop({ agents: [TESTER], target: 0.95, batch: 1, maxRounds: 3, actor: ALICE });
  assert.equal(await settle(ask.id), 'waiting');
  for (const c of SI.getLoop(ask.id).coach.filter((x) => x.state === 'proposed')) SI.decideRewrite({ id: c.id, verdict: 'reject', actor: ALICE });
  const rejected = SI.getLoop(ask.id);
  assert.equal(rejected.state, 'done');
  assert.equal(rejected.note, 'every rewrite was rejected');
  assert.equal(rejected.versions.length, 0);
  setSetting('SELF_IMPROVE_MODE', 'auto');
});

test('a person can stop a loop; stopping is audited and leaves the record', async () => {
  const loop = SI.startLoop({ agents: [TESTER], target: 0.95, batch: 1, maxRounds: 3, actor: ALICE });
  assert.throws(() => SI.stopLoop({ id: loop.id, actor: 'system:x' }), /person/);
  const s = SI.stopLoop({ id: loop.id, actor: ALICE });
  assert.equal(s.state, 'stopped');
  assert.throws(() => SI.stopLoop({ id: loop.id, actor: ALICE }), /no such running loop/);
  await drain();
  SI.syncSelfImprove();
  assert.equal(one('SELECT state FROM si_loops WHERE id = ?', loop.id).state, 'stopped', 'the tick leaves a stopped loop alone');
  assert.ok(one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'selfimprove.stopped'").n >= 1);
  assert.equal(verifyChain().ok, true);
});

test('permissions, catalogue and surface', () => {
  const observer = expandTemplate('observer');
  assert.ok(observer.includes('selfimprove.view'), 'anyone who reads the floor may watch the loop');
  assert.ok(!observer.includes('selfimprove.manage'));
  assert.ok(expandTemplate('operator').includes('selfimprove.manage'));
  const sec = sectionCatalog().find((s) => s.id === 'selfimprove');
  assert.ok(sec);
  assert.equal(sec.href, '#/selfimprove');
  assert.equal(SURFACES.filter((x) => x.departments.includes('selfimprove')).length, 1);
  assert.ok(q("SELECT id FROM agents WHERE id = 'AGT-COACH-001'").length, 'the Coach is on the payroll');
});
