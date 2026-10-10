// The engineering floor: the scanner, the review board, the quality gate, the
// studio's repository operations, the app builder, the GitHub hub and the
// pair programmer.
//
// Mock mode throughout, so no model is asked anything and nothing leaves the
// machine. What is tested is what this code decides: what the scanner calls a
// problem and what it leaves alone, which acts wait for a person, what the
// gate refuses, and that the app builder will not move past a stage nobody
// approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-engineering.db';
process.env.ALPHACORE_APPS_ROOT = 'data/test-eng-apps';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 11).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-engineering.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-eng-apps'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { ROLE_TEMPLATES } = await import('../src/approvals.js');
const forge = await import('../src/forge.js');
const scan = await import('../src/engineering/scan.js');
const reviews = await import('../src/engineering/reviews.js');
const builder = await import('../src/engineering/builder.js');
const hub = await import('../src/engineering/github.js');
const assist = await import('../src/engineering/assist.js');
const { engineeringMetrics } = await import('../src/engineering/metrics.js');
const { sectionCatalog, surfaceAudit, connectivityAudit, SURFACES } = await import('../src/links.js');

seedAgents();
seedConnectors();
const ME = 'human:owner';
const BOT = 'agent:AGT-ENG-001';

async function drain() {
  for (let i = 0; i < 40; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}
// Fake credentials are assembled at runtime, so this file never contains a
// string that looks like a real key to a scanner reading the repository.
const fake = {
  aws: ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
  github: ['ghp', '_', 'a'.repeat(36)].join(''),
  stripe: ['sk', '_live_', 'b'.repeat(24)].join(''),
};

// ------------------------------------------------------------------ scanner --

test('the scanner finds secrets and never repeats them in full', () => {
  const found = scan.scanFiles([{ path: 'src/config.js', content: `export const key = '${fake.aws}';\nconst gh = "${fake.github}";\nconst pay = '${fake.stripe}';\n` }]);
  const rules = found.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['secret.aws', 'secret.github', 'secret.stripe']);
  for (const f of found) {
    assert.equal(f.severity, 'critical');
    assert.ok(!f.evidence.includes(fake.aws) && !f.evidence.includes(fake.github) && !f.evidence.includes(fake.stripe), `evidence is masked: ${f.evidence}`);
    assert.match(f.evidence, /chars/);
  }
  assert.equal(found.find((f) => f.rule === 'secret.github').line, 2);
});

test('placeholders, environment reads and test fixtures are not called secrets', () => {
  const found = scan.scanFiles([
    { path: 'src/a.js', content: "const password = process.env.DB_PASSWORD;\nconst apiKey = 'your-api-key-here';\nconst token = '<token>';\n" },
    { path: 'test/fixtures/keys.js', content: `const k = '${fake.aws}';\n` },
  ]);
  assert.deepEqual(found.filter((f) => f.dimension === 'security'), []);
});

test('dangerous code, string-built SQL and inaccessible markup are found with their lines', () => {
  const found = scan.scanFiles([
    { path: 'src/db.js', content: "const row = db.query('SELECT * FROM users WHERE id = ' + id);\neval(input);\nrequire('child_process').exec(`ls ${dir}`);\n" },
    { path: 'public/index.html', content: '<html>\n<img src="a.png">\n<button></button>\n<meta name="viewport" content="width=device-width, user-scalable=no">\n' },
    { path: 'app.py', content: 'import subprocess\nsubprocess.run(cmd, shell=True)\nimport pickle\npickle.loads(data)\n' },
  ]);
  const by = (rule) => found.find((f) => f.rule === rule);
  assert.equal(by('code.sql-concat').line, 1);
  assert.equal(by('code.eval').line, 2);
  assert.equal(by('code.command-injection').line, 3);
  assert.equal(by('a11y.html-lang').line, 1);
  assert.equal(by('a11y.img-alt').line, 2);
  assert.equal(by('a11y.empty-button').line, 3);
  assert.ok(by('a11y.zoom-off'));
  assert.equal(by('code.shell-true').line, 2);
  assert.equal(by('code.pickle').line, 4);
});

test('what the scanner found in this repository and was wrong about stays unflagged', () => {
  const header = ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ');
  const found = scan.scanFiles([
    { path: 'public/fleet.js', content: `<textarea id="k" placeholder="${header}"></textarea>\n` },
    { path: 'public/page.js', content: 'const x = `<select id="m">${opts}</select>`;\n' },
    { path: 'src/crew.js', content: "one(`SELECT id FROM t WHERE s IN (${OPEN.map(() => '?').join(',')})`, ...OPEN);\n" },
  ]);
  assert.deepEqual(found.filter((f) => f.dimension === 'security').map((f) => f.rule), []);
  // …and the real thing is still caught.
  assert.ok(scan.scanFiles([{ path: 'deploy/id_rsa.txt', content: `${header}\nb3BlbnNzaC1rZXktdjEAAAAA\n` }]).some((f) => f.rule === 'secret.private-key'));
  assert.ok(scan.scanFiles([{ path: 'src/q.js', content: 'db.all(`SELECT * FROM t WHERE name = ${name}`);\n' }]).some((f) => f.rule === 'code.sql-concat'));
});

test('a pull request is scanned on the lines it adds, at their new line numbers', () => {
  const patch = '@@ -10,3 +10,4 @@ function x() {\n context\n-removed(line)\n+eval(userInput)\n+ok()\n context';
  const found = scan.scanPatches([{ filename: 'src/x.js', status: 'modified', patch }, { filename: '.env', status: 'added', patch: '+A=1' }]);
  const ev = found.find((f) => f.rule === 'code.eval');
  assert.equal(ev.line, 11, 'the first context line is 10, so the added eval lands on 11');
  assert.ok(found.some((f) => f.rule === 'secret.env-file'));
  assert.equal(found.filter((f) => f.rule === 'code.eval').length, 1, 'a removed line is not a finding');
});

test('the score and the verdict follow the worst open finding', () => {
  assert.deepEqual([scan.score([]).verdict, scan.score([]).score], ['pass', 100]);
  assert.equal(scan.score([{ severity: 'high', dimension: 'security' }]).verdict, 'warn');
  assert.equal(scan.score([{ severity: 'critical', dimension: 'security' }]).verdict, 'fail');
  assert.equal(scan.score([{ severity: 'critical', dimension: 'security', state: 'dismissed' }]).verdict, 'pass', 'a dismissed finding no longer counts');
});

// ------------------------------------------------------------- review board --

let projectId;
test('a review runs the scanner, asks one reviewer per dimension, and finishes honestly in mock mode', async () => {
  const p = forge.createProject({ name: 'Leaky API', kind: 'node-api', actor: ME });
  projectId = p.id;
  forge.writeProjectFile(p.id, { path: 'src/keys.js', content: `export const AWS = '${fake.aws}';\n`, actor: ME });
  forge.writeProjectFile(p.id, { path: 'package.json', content: JSON.stringify({ name: 'leaky', scripts: { test: 'node --test' }, dependencies: { leftish: '*' } }), actor: ME });
  const r = reviews.startReview({ projectId: p.id, actor: ME });
  assert.equal(r.state, 'running');
  assert.ok(r.findings.some((f) => f.rule === 'secret.aws' && f.source === 'scanner'));
  assert.ok(r.findings.some((f) => f.rule === 'deps.unpinned'));
  assert.equal(r.reviewers.length, 5, 'security, tests, quality, performance and accessibility each get a reviewer');
  assert.ok(r.commit_sha === null || /^[0-9a-f]{4,}$/.test(r.commit_sha));

  await drain();
  reviews.syncReviews();
  const done = reviews.getReview(r.id);
  assert.equal(done.state, 'done');
  assert.equal(done.verdict, 'fail', 'a committed AWS key fails the review');
  assert.ok(done.score < 100);
  assert.ok(done.reviewers.every((x) => ['done', 'held'].includes(x.state)), JSON.stringify(done.reviewers));
  assert.ok(done.reviewers.every((x) => /\[mock\]/.test(x.summary)), 'mock reviewers say they did not read anything');
  assert.equal(done.findings.filter((f) => f.source === 'agent').length, 0, 'mock invents no findings');
});

test('dismissing a serious finding needs a person and a reason, and the score follows', () => {
  const r = q('SELECT id FROM eng_reviews ORDER BY id DESC LIMIT 1')[0];
  const crit = one("SELECT * FROM eng_findings WHERE review_id = ? AND severity = 'critical'", r.id);
  assert.throws(() => reviews.dismissFinding(crit.id, { note: 'fine', actor: BOT }), /only a person/);
  assert.throws(() => reviews.dismissFinding(crit.id, { note: 'no', actor: ME }), /needs a reason/);
  const before = reviews.getReview(r.id).score;
  reviews.dismissFinding(crit.id, { note: 'a revoked test key, kept on purpose', actor: ME });
  const after = reviews.getReview(r.id);
  assert.ok(after.score > before);
  assert.notEqual(after.verdict, 'fail');
  reviews.reopenFinding(crit.id, { actor: ME });
  assert.equal(reviews.getReview(r.id).verdict, 'fail');
});

test('findings go to an engineer as one change set, and close when it is applied', async () => {
  const r = q('SELECT id FROM eng_reviews ORDER BY id DESC LIMIT 1')[0];
  const fix = reviews.fixFindings({ reviewId: r.id, severities: ['critical'], actor: ME });
  assert.ok(fix.changeId);
  assert.equal(one("SELECT COUNT(*) AS n FROM eng_findings WHERE review_id = ? AND state = 'fixing'", r.id).n, 1);
  await drain();
  forge.syncForge();
  forge.applyChange(fix.changeId, { actor: ME });
  reviews.syncReviews();
  assert.equal(one("SELECT state FROM eng_findings WHERE change_id = ?", fix.changeId).state, 'fixed');
});

test('only missing tests go to the test engineer', () => {
  const p = forge.createProject({ name: 'Untested', kind: 'blank', actor: ME });
  for (const f of ['a', 'b', 'c', 'd']) forge.writeProjectFile(p.id, { path: `src/${f}.js`, content: 'export const x = 1;\n', actor: ME });
  const r = reviews.startReview({ projectId: p.id, dimensions: ['tests'], agents: false, actor: ME });
  reviews.syncReviews();
  assert.ok(reviews.getReview(r.id).findings.some((f) => f.rule === 'tests.none'));
  const fix = reviews.fixFindings({ reviewId: r.id, actor: ME });
  assert.equal(fix.agent, 'AGT-TST-001');
});

test('the quality gate holds a production release only when it is told to', () => {
  // A fresh read: the key is still in the file (the mock engineer only wrote a note).
  reviews.startReview({ projectId, agents: false, actor: ME });
  reviews.syncReviews();
  setSetting('ENG_QUALITY_GATE', 'warn');
  let g = reviews.qualityGate(projectId);
  assert.equal(g.state, 'fail');
  assert.equal(g.ok, true, 'warn records, it does not stop');
  setSetting('ENG_QUALITY_GATE', 'enforce');
  g = reviews.qualityGate(projectId);
  assert.equal(g.ok, false);
  assert.match(g.why, /critical/);
  const fresh = forge.createProject({ name: 'Never reviewed', kind: 'blank', actor: ME });
  assert.equal(reviews.qualityGate(fresh.id).ok, false, 'enforce does not wave through what nobody read');
  setSetting('ENG_QUALITY_GATE', 'off');
  assert.equal(reviews.qualityGate(projectId).ok, true);
});

test('a review can be written as the comment a person would post', () => {
  const r = q('SELECT id FROM eng_reviews ORDER BY id LIMIT 1')[0];
  const md = reviews.reviewMarkdown(r.id);
  assert.match(md, /AlphaCore review/);
  assert.ok(!md.includes(fake.aws), 'the comment never carries the secret');
});

// ------------------------------------------------------------------ studio --

test('the studio searches, renames, diffs, commits and discards inside the project only', () => {
  const p = forge.createProject({ name: 'Studio Desk', kind: 'node-api', actor: ME });
  const hits = forge.searchProject(p.id, { query: 'createServer' });
  assert.ok(hits.hits.length >= 1);
  assert.ok(hits.hits.every((h) => h.line > 0 && h.col > 0));
  assert.throws(() => forge.searchProject(p.id, { query: '(', regex: true }), /not a valid pattern/);

  forge.writeProjectFile(p.id, { path: 'notes.md', content: '# one\n', commit: false, actor: ME });
  assert.ok(forge.gitStatus(forge.projectRow(p.id)).some((s) => s.path === 'notes.md'));
  const c = forge.commitWorkingTree(p.id, { message: 'Notes start here', actor: ME });
  assert.ok(c.commit);
  forge.writeProjectFile(p.id, { path: 'notes.md', content: '# two\n', commit: false, actor: ME });
  assert.equal(forge.fileAtHead(p.id, 'notes.md').content.trim(), '# one');
  assert.match(forge.gitDiff(p.id, { path: 'notes.md' }).diff, /\+# two/);
  forge.discardFile(p.id, { path: 'notes.md', actor: ME });
  assert.equal(forge.readProjectFile(p.id, 'notes.md').content, '# one\n');

  forge.renameProjectFile(p.id, { from: 'notes.md', to: 'docs/notes.md', actor: ME });
  assert.equal(forge.readProjectFile(p.id, 'docs/notes.md').content, '# one\n');
  assert.throws(() => forge.renameProjectFile(p.id, { from: 'docs/notes.md', to: '../escape.md', actor: ME }), /path/);
  assert.throws(() => forge.commitWorkingTree(p.id, { message: '', actor: ME }), /message/);

  forge.commitWorkingTree(p.id, { message: 'Move the notes', actor: ME });
  const b = forge.switchBranch(p.id, { name: 'feature/notes', create: true, actor: ME });
  assert.equal(b.current, 'feature/notes');
  assert.throws(() => forge.switchBranch(p.id, { name: 'bad..name', actor: ME }), /branch/);
});

// ------------------------------------------------------------- app builder --

test('the app builder walks every stage and never past an unapproved one', async () => {
  const b = builder.createBuild({ name: 'Clinic Bookings', idea: 'Patients book a slot with a doctor and reception sees the day.', language: 'ar', actor: ME });
  assert.equal(b.state, 'spec');
  await drain();
  builder.syncBuilds();
  assert.equal(builder.getBuild(b.id).state, 'spec_review');
  assert.throws(() => builder.approve(b.id, { actor: BOT }), /only a person/);

  builder.revise(b.id, { feedback: 'Add cancellation by the patient.', actor: ME });
  assert.equal(builder.getBuild(b.id).state, 'spec');
  await drain();
  builder.syncBuilds();
  builder.approve(b.id, { actor: ME });
  assert.equal(builder.getBuild(b.id).state, 'arch');
  await drain();
  builder.syncBuilds();
  let s = builder.getBuild(b.id);
  assert.equal(s.state, 'arch_review');
  assert.ok(s.arch.milestones.length >= 2);

  builder.approve(b.id, { actor: ME });
  s = builder.getBuild(b.id);
  assert.equal(s.state, 'building');
  assert.ok(s.project, 'approving the design makes the project');

  // Each milestone waits for a person to apply it before the next one starts.
  for (let i = 0; i < s.milestones.length; i++) {
    await drain();
    forge.syncForge();
    builder.syncBuilds();
    assert.equal(builder.getBuild(b.id).state, 'milestone_review', `milestone ${i + 1} waits`);
    builder.applyMilestone(b.id, { actor: ME });
  }
  assert.equal(builder.getBuild(b.id).state, 'testing');
  await drain();
  forge.syncForge();
  const tc = builder.getBuild(b.id).test_change;
  assert.equal(one('SELECT agent_id FROM forge_changes WHERE id = ?', tc).agent_id, 'AGT-TST-001');
  forge.applyChange(tc, { actor: ME });
  builder.syncBuilds();
  assert.equal(builder.getBuild(b.id).state, 'reviewing');
  await drain();
  reviews.syncReviews();
  builder.syncBuilds();
  s = builder.getBuild(b.id);
  assert.equal(s.state, 'ready');
  assert.ok(s.review && s.review.state === 'done');
  assert.ok(s.log.length >= 8, 'every stage left a line in the log');
});

test('a build can be cancelled, and a cancelled build stays cancelled', () => {
  const b = builder.createBuild({ name: 'Throwaway', idea: 'Something we will not build after all, described properly.', actor: ME });
  builder.cancelBuild(b.id, { actor: ME });
  assert.equal(builder.getBuild(b.id).state, 'cancelled');
  assert.throws(() => builder.approve(b.id, { actor: ME }), /nothing to approve/);
});

// ---------------------------------------------------------------- GitHub --

test('connecting GitHub checks the token and starts in dry-run', () => {
  assert.throws(() => hub.connectGitHub({ token: 'hunter2', actor: ME }), /does not look like/);
  assert.throws(() => hub.connectGitHub({ token: fake.github, actor: BOT }), /only a person/);
  const h = hub.connectGitHub({ token: fake.github, actor: ME });
  assert.equal(h.connector.state, 'dry');
  assert.equal(h.hasToken, true);
});

test('in dry-run, a clone is recorded at the gate and nothing is cloned', async () => {
  const r = await hub.addRepo({ repo: 'octocat/hello-world', actor: ME });
  assert.equal(r.full_name, 'octocat/hello-world');
  await assert.rejects(() => hub.importRepo(r.id, { actor: ME }), (e) => e.status === 409 && /dry-run/.test(e.message));
  const logged = one("SELECT verdict FROM egress_log WHERE connector = 'github' AND capability = 'repo.clone' ORDER BY id DESC LIMIT 1");
  assert.equal(logged.verdict, 'dry');
  assert.equal(one('SELECT project_id FROM gh_repos WHERE id = ?', r.id).project_id, null);
  await assert.rejects(() => hub.pushRepo(r.id, { actor: ME }), /import the repository/);
  await assert.rejects(() => hub.addRepo({ repo: 'not a repo', actor: ME }), /owner\/name/);
});

test('a webhook without the right signature is refused, and an unlinked repository is left alone', async () => {
  const raw = JSON.stringify({ action: 'opened', repository: { full_name: 'someone/else' }, pull_request: { number: 7 } });
  let r = await hub.receiveWebhook({ event: 'pull_request', delivery: 'd1', raw, signature: 'sha256=00' });
  assert.equal(r.status, 401, 'no secret has been made, so nothing can be verified');
  const { secret } = hub.rotateWebhookSecret({ actor: ME });
  const sign = (body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  r = await hub.receiveWebhook({ event: 'pull_request', delivery: 'd2', raw, signature: 'sha256=' + 'f'.repeat(64) });
  assert.equal(r.status, 401);
  r = await hub.receiveWebhook({ event: 'pull_request', delivery: 'd3', raw, signature: sign(raw) });
  assert.equal(r.status, 202);
  assert.equal(one("SELECT outcome FROM gh_deliveries WHERE delivery = 'd3'").outcome, 'ignored');
  r = await hub.receiveWebhook({ event: 'ping', delivery: 'd4', raw: '{}', signature: sign('{}') });
  assert.equal(r.status, 200);
});

test('posting to GitHub is a person\'s act', async () => {
  await assert.rejects(() => hub.postReview(1, { actor: BOT }), /person/);
  await assert.rejects(() => hub.issueFromFinding(1, { actor: BOT }), /person/);
});

// ------------------------------------------------------- the pair programmer --

test('the pair programmer answers, and says when no model read the code', async () => {
  const a = assist.ask({ projectId, path: 'src/keys.js', question: 'What is this file for?', actor: ME });
  assert.equal(a.state, 'thinking');
  await drain();
  const done = assist.getAnswer(a.id);
  assert.equal(done.state, 'answered');
  assert.match(done.answer, /\[mock\]/);
  assert.throws(() => assist.ask({ projectId, question: 'x', mode: 'nonsense', actor: ME }), /mode/);
});

// ---------------------------------------------------------------- metrics --

test('the metrics measure what happened and say null for what did not', () => {
  const m = engineeringMetrics({ days: 30 });
  assert.equal(m.dora.frequency.n, 0);
  assert.equal(m.dora.changeFailure.value, null, 'no releases: no failure rate, not a zero');
  assert.equal(m.dora.timeToRestore.value, null);
  assert.ok(m.dora.leadTime.n >= 1, 'applied change sets give a lead time');
  assert.ok(m.ai.applied >= 1);
  assert.ok(m.quality.reviews >= 2);
  assert.ok(m.projects.length >= 1 && m.projects.every((p) => p.gate && p.gate.mode));
});

// ------------------------------------------------------------ speed --

test('the incremental chain proof agrees with the full walk, and keeps up with new entries', async () => {
  const { verifyChainFast, audit } = await import('../src/audit.js');
  const full = verifyChain();
  const fast = verifyChainFast();
  assert.equal(fast.ok, true);
  assert.equal(fast.checked, full.checked);
  audit({ actorType: 'human', actorId: ME, action: 'test.after_proof' });
  const later = verifyChainFast();
  assert.equal(later.checked, full.checked + 1);
  assert.equal(later.incremental, true);
});

test('a backlog at the human gate is one notice, not one per run', async () => {
  const { immuneTick } = await import('../src/immune.js');
  for (let i = 0; i < 300; i++) {
    exec("INSERT INTO runs (id, agent_id, task_type, input, state, created_at) VALUES (?, 'AGT-ENG-001', 'test:stale', '{}', 'awaiting_human', datetime('now','-3 days'))", crypto.randomUUID());
  }
  const before = one("SELECT COUNT(*) AS n FROM notifications WHERE source = 'immune.gate'").n;
  immuneTick();
  immuneTick();
  const notices = q("SELECT message FROM notifications WHERE source = 'immune.gate'");
  assert.equal(notices.length - before, 1);
  assert.match(notices.at(-1).message, /^\d+ run\(s\) have waited/);
});

// -------------------------------------------------------- the wiring --

test('the engineering floor is filed, wired, permissioned and on the chain', () => {
  const ids = ['studio', 'reviews', 'github', 'appbuilder', 'engmetrics'];
  const cat = new Set(sectionCatalog().map((s) => s.id));
  for (const id of ids) assert.ok(cat.has(id), `${id} is a department`);
  const eng = SURFACES.find((s) => s.id === 'engineering');
  for (const id of ids) assert.ok(eng.departments.includes(id), `${id} is behind the engineering door`);
  const a = surfaceAudit();
  assert.deepEqual([a.unfiled, a.duplicated, a.dangling], [[], [], []]);
  const c = connectivityAudit();
  assert.deepEqual(c.dangling, []);
  for (const id of ids) assert.ok(!c.orphans.some((o) => o.id === id), `${id} is connected to something`);
  for (const p of ['reviews.view', 'reviews.run', 'reviews.decide', 'github.view', 'github.manage', 'github.post', 'appbuilder.view', 'appbuilder.manage', 'engmetrics.view']) {
    assert.ok(PERMS.includes(p), `${p} exists`);
  }
  assert.ok(ROLE_TEMPLATES.engineering.perms.includes('github.post'));
  assert.ok(!ROLE_TEMPLATES.observer.perms.includes('github.post'));
  assert.equal(verifyChain().ok, true);
});
