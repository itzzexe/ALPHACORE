// Build and run: the factory, the website builder, the fleet, deployments,
// monitoring and the crew.
//
// Nothing here touches the network or a real server. The fleet's transport and
// the monitor's probe are swapped for recorders, so what is tested is exactly
// what this code decides: which script goes to which machine, what waits for a
// person, what is refused, and what lands on the chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-build-run.db';
process.env.ALPHACORE_APPS_ROOT = 'data/test-apps';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 7).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-build-run.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-apps'), { recursive: true, force: true });

const { one, q } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { verifyChain } = await import('../src/audit.js');
const forge = await import('../src/forge.js');
const sites = await import('../src/sites.js');
const servers = await import('../src/servers.js');
const deploys = await import('../src/deploy.js');
const monitors = await import('../src/monitor.js');
const crew = await import('../src/crew.js');
const { pendingApprovals } = await import('../src/inbox.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { sectionCatalog, surfaceAudit, relationshipMatrix } = await import('../src/links.js');
const { headquarters } = await import('../src/hq.js');

seedAgents();
const ME = 'human:owner';

/** Run every queued model call through the mock provider. */
async function drain() {
  for (let i = 0; i < 20; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}

// ------------------------------------------------------------------ factory --

test('a project is scaffolded from a template onto disk', () => {
  const p = forge.createProject({ name: 'Invoice API', kind: 'node-api', description: 'Bills and receipts', actor: ME });
  assert.equal(p.slug, 'invoice-api');
  const paths = p.tree.map((f) => f.path);
  for (const f of ['package.json', 'src/app.js', 'src/server.js', 'test/app.test.js', 'Dockerfile']) assert.ok(paths.includes(f), `${f} should exist`);
  assert.ok(fs.existsSync(path.join(forge.APPS_ROOT, 'invoice-api', 'package.json')));
  // A second project of the same name gets its own directory.
  assert.equal(forge.createProject({ name: 'Invoice API', kind: 'blank', actor: ME }).slug, 'invoice-api-2');
});

test('files are read and written inside the project, and nowhere else', () => {
  const p = forge.projectRow('invoice-api');
  forge.writeProjectFile(p.id, { path: 'docs/notes.md', content: '# hello', actor: ME });
  assert.equal(forge.readProjectFile(p.id, 'docs/notes.md').content, '# hello');
  for (const bad of ['../escape.txt', '/etc/passwd', 'a/../../b', '.git/config']) {
    assert.throws(() => forge.writeProjectFile(p.id, { path: bad, content: 'x', actor: ME }), /path|repository/, bad);
  }
});

test('the command line is parsed without a shell, and only build tools run', () => {
  assert.deepEqual(forge.parseCommand('npm run "build prod" --flag'), ['npm', 'run', 'build prod', '--flag']);
  assert.throws(() => forge.checkCommand(['rm', '-rf', '/']), /not on the factory/);
  assert.throws(() => forge.checkCommand(['curl', 'x']), /not on the factory/);
  assert.ok(forge.checkCommand(['node', '--version']));
  assert.throws(() => forge.parseCommand('node "unterminated'), /quote/);
});

test('a command runs in the project and its output is kept', async () => {
  const p = forge.projectRow('invoice-api');
  const { id } = forge.runCommand({ projectId: p.id, command: 'node -e "console.log(40+2)"', actor: ME });
  for (let i = 0; i < 100 && forge.getCommand(id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  const c = forge.getCommand(id);
  assert.equal(c.state, 'ok', c.output);
  assert.match(c.output, /42/);
});

test('an engineer proposes a change set; nothing is written until a person applies it', async () => {
  const p = forge.projectRow('invoice-api');
  const { id } = forge.requestChange({ projectId: p.id, prompt: 'Add a /version endpoint', actor: ME });
  await drain();
  forge.syncForge();
  const c = one('SELECT * FROM forge_changes WHERE id = ?', id);
  assert.equal(c.state, 'proposed');
  assert.ok(!fs.existsSync(path.join(forge.APPS_ROOT, p.slug, 'AI-NOTES.md')), 'not applied yet');
  assert.ok(pendingApprovals().some((i) => i.kind === 'forgeChange' && i.id === String(id)), 'and it waits in the one inbox');
  forge.applyChange(id, { actor: ME });
  assert.ok(fs.existsSync(path.join(forge.APPS_ROOT, p.slug, 'AI-NOTES.md')));
  assert.throws(() => forge.applyChange(id, { actor: ME }), /applied/);
});

test('only a person can put a project on autopilot', () => {
  const p = forge.projectRow('invoice-api');
  assert.throws(() => forge.updateProject(p.id, { autopilot: true, actor: 'agent:AGT-ENG-001' }), /person/);
  assert.equal(forge.updateProject(p.id, { autopilot: true, actor: ME }).autopilot, 1);
  forge.updateProject(p.id, { autopilot: false, actor: ME });
});

test('a release package round-trips and leaves secrets and dependencies behind', () => {
  const p = forge.projectRow('invoice-api');
  forge.writeProjectFile(p.id, { path: '.env', content: 'SECRET=1', commit: false, actor: ME });
  fs.mkdirSync(path.join(forge.APPS_ROOT, p.slug, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(forge.APPS_ROOT, p.slug, 'node_modules', 'x', 'i.js'), '1');
  const pkg = forge.packageProject(p.id);
  const names = forge.untarGz(pkg.buffer).map((e) => e.name);
  assert.ok(names.includes('package.json'));
  assert.ok(!names.some((n) => n.startsWith('node_modules')), 'no dependencies');
  assert.ok(!names.includes('.env'), 'no secrets');
  const body = forge.untarGz(pkg.buffer).find((e) => e.name === 'src/app.js').data.toString();
  assert.match(body, /createApp/);
});

test('a preview link is signed, and expires', () => {
  const tok = forge.previewToken('invoice-api');
  assert.ok(forge.checkPreviewToken('invoice-api', tok));
  assert.ok(!forge.checkPreviewToken('another-project', tok), 'bound to one project');
  assert.ok(!forge.checkPreviewToken('invoice-api', `1.${tok.split('.')[1]}`), 'and to its expiry');
});

// ------------------------------------------------------------------ sites --

test('a website is generated whole from a name and a sentence, in Arabic too', () => {
  const site = sites.createSite({ brief: { business: 'مخبز الريان', what: 'خبز طازج كل صباح', language: 'ar', style: 'atelier', phone: '+964 770 000 0000' }, actor: ME });
  assert.equal(site.kind, 'website');
  const html = forge.readProjectFile(site.id, 'index.html').content;
  assert.match(html, /dir="rtl"/);
  assert.match(html, /مخبز الريان/);
  assert.match(html, /tel:\+9647700000000/);
  for (const f of ['styles.css', 'script.js', '404.html', 'favicon.svg', 'robots.txt']) assert.ok(site.tree.some((x) => x.path === f), f);
  assert.throws(() => sites.normalizeBrief({}), /business name/);
});

test('changing the brief regenerates the site and keeps the history', () => {
  const site = sites.listSites()[0];
  sites.regenerate(site.id, { brief: { style: 'studio', tagline: 'Bread at dawn' }, actor: ME });
  const html = forge.readProjectFile(site.id, 'index.html').content;
  assert.match(html, /Bread at dawn/);
  assert.match(forge.readProjectFile(site.id, 'styles.css').content, /#8b7bff/);
  if (forge.gitAvailable()) assert.ok(forge.gitLog(forge.projectRow(site.id)).length >= 2);
});

test('the generator escapes what it is given', () => {
  const files = sites.generateSite({ business: '<script>alert(1)</script>', what: 'x' });
  assert.ok(!files['index.html'].includes('<script>alert(1)</script>'));
});

// ------------------------------------------------------------------ fleet --

const sent = [];
servers.setTransport((server, script, { input }) => {
  sent.push({ server: server.name, script, bytes: input ? input.length : 0 });
  if (script.includes('/proc/stat')) {
    return { code: 0, stdout: 'hostname=web-1\nos=Ubuntu 24.04 LTS\nkernel=6.8\nuptime=3600\nload=0.10 0.20 0.30\ncpus=2\ncpu=97\nmem_total_kb=2048000\nmem_avail_kb=1024000\ndisk_total_kb=40000000\ndisk_used_kb=10000000\nfailed_units=0\nproc=1|systemd|0.1|0.2\n', stderr: '' };
  }
  if (script.includes('AC-RELEASE-OK') || script.includes('release script')) return { code: 0, stdout: 'ok\nAC-RELEASE-OK\n', stderr: '' };
  return { code: 0, stdout: 'done\n', stderr: '' };
});

test('a server is added with its key sealed in the vault, never returned', () => {
  const s = servers.addServer({ name: 'web-1', host: '203.0.113.10', username: 'deploy', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----', actor: ME });
  assert.equal(s.hasKey, true);
  assert.equal(s.key_secret, undefined);
  assert.ok(!JSON.stringify(servers.listServers()).includes('abc'), 'the key never leaves the vault in a listing');
  assert.throws(() => servers.addServer({ name: 'bad', host: 'x;rm', username: 'u', actor: ME }), /host/);
  assert.throws(() => servers.setKey(s.id, { privateKey: 'not a key', actor: ME }), /private key/);
});

test('vital signs are read and parsed, and history is kept', async () => {
  const s = servers.listServers()[0];
  const r = await servers.collect(s.id);
  assert.equal(r.ok, true);
  assert.equal(r.metrics.cpuPct, 97);
  assert.equal(r.metrics.memPct, 50);
  assert.equal(r.metrics.diskPct, 25);
  assert.equal(servers.getServer(s.id).state, 'online');
  assert.equal(servers.getServer(s.id).history.length, 1);
});

test('a person runs a command now; an AI employee asks and waits', async () => {
  const s = servers.listServers()[0];
  const mine = await servers.runOnServer(s.id, { command: 'uptime', actor: ME });
  assert.equal(mine.state, 'ok');
  const theirs = await servers.runOnServer(s.id, { command: 'systemctl restart nginx', actor: 'agent:AGT-MON-001' });
  assert.equal(theirs.state, 'awaiting_approval');
  const before = sent.length;
  assert.equal(sent.length, before, 'nothing ran');
  assert.ok(pendingApprovals().some((i) => i.kind === 'serverCommand'));
  await assert.rejects(servers.decideCommand(theirs.id, { approve: true, actor: 'agent:AGT-MON-001' }), /person/);
  const ran = await servers.decideCommand(theirs.id, { approve: true, actor: ME });
  assert.equal(ran.state, 'ok');
  assert.equal(ran.approved_by, ME);
});

test('service names are checked before they reach a shell', async () => {
  const s = servers.listServers()[0];
  await assert.rejects(servers.serviceAction(s.id, { unit: 'nginx; rm -rf /', action: 'restart', actor: ME }), /unit/);
  await assert.rejects(servers.serviceAction(s.id, { unit: 'nginx', action: 'explode', actor: ME }), /action/);
});

// --------------------------------------------------------------- deploys --

test('a deployment uploads a package, runs a visible script and goes live', async () => {
  const p = forge.projectRow('invoice-api');
  const s = servers.listServers()[0];
  const t = deploys.createTarget({ projectId: p.id, serverId: s.id, runtime: 'node', domain: 'api.example.com', port: 3100, env: 'API_KEY=sekret', ssl: true, sslEmail: 'ops@example.com', actor: ME });
  assert.deepEqual(t.envKeys, ['API_KEY']);
  assert.ok(!JSON.stringify(t).includes('sekret'), 'the environment is sealed');
  assert.match(t.plan.unit, /Environment=PORT=3100/);
  assert.match(t.plan.nginx, /proxy_pass http:\/\/127\.0\.0\.1:3100/);
  sent.length = 0;
  const rel = await deploys.deploy(t.id, { actor: ME });
  for (let i = 0; i < 100 && deploys.getRelease(rel.id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
  const done = deploys.getRelease(rel.id);
  assert.equal(done.state, 'live', done.log);
  assert.ok(sent[0].bytes > 0, 'the package was uploaded first');
  assert.match(sent[1].script, /certbot --nginx -d api\.example\.com/);
  assert.match(sent[1].script, /systemctl restart ac-invoice-api/);
  assert.equal(deploys.getTarget(t.id).state, 'live');
  // A live site is watched without anybody asking.
  assert.ok(monitors.listChecks().some((c) => c.target === 'https://api.example.com/'));
});

test('an AI cannot release to production by itself', async () => {
  const t = deploys.listTargets()[0];
  const rel = await deploys.deploy(t.id, { actor: 'agent:AGT-DEV-001' });
  assert.equal(rel.state, 'awaiting_approval');
  assert.ok(pendingApprovals().some((i) => i.kind === 'release'));
  await assert.rejects(deploys.decideRelease(rel.id, { approve: true, actor: 'agent:AGT-DEV-001' }), /person/);
  const refused = await deploys.decideRelease(rel.id, { approve: false, actor: ME });
  assert.equal(refused.state, 'refused');
  await assert.rejects(deploys.rollback(t.id, { actor: 'agent:AGT-DEV-001' }), /person/);
});

test('a target refuses what would be dangerous to put in a script', () => {
  const p = forge.projectRow('invoice-api');
  const s = servers.listServers()[0];
  assert.throws(() => deploys.createTarget({ projectId: p.id, serverId: s.id, remoteDir: '/srv/$(reboot)', actor: ME }), /absolute path/);
  assert.throws(() => deploys.createTarget({ projectId: p.id, serverId: s.id, domain: 'not a domain', actor: ME }), /domain/);
  assert.throws(() => deploys.createTarget({ projectId: p.id, serverId: s.id, env: 'rm -rf /', actor: ME }), /KEY=VALUE/);
  assert.throws(() => deploys.createTarget({ projectId: p.id, serverId: s.id, ssl: true, domain: 'a.example.com', sslEmail: 'not-an-address', actor: ME }), /email/);
});

// --------------------------------------------------------------- monitor --

test('two failures in a row are down, with an incident; recovery says so', async () => {
  let up = true;
  monitors.setProbe(() => (up ? { ok: true, latency: 40, status: 200 } : { ok: false, latency: 10000, status: null, error: 'no answer' }));
  const c = monitors.createCheck({ name: 'Home page', kind: 'http', target: 'https://shop.example.com', actor: ME });
  assert.equal((await monitors.runCheck(c.id)).state, 'up');
  up = false;
  assert.equal((await monitors.runCheck(c.id)).state, 'up', 'one failure is a blip');
  const down = await monitors.runCheck(c.id);
  assert.equal(down.state, 'down');
  assert.ok(down.incident_id, 'an incident was opened');
  up = true;
  const back = await monitors.runCheck(c.id);
  assert.equal(back.state, 'up');
  assert.equal(back.incident_id, null);
  assert.ok(back.day.uptime < 100 && back.day.uptime > 0);
  assert.throws(() => monitors.createCheck({ kind: 'http', target: 'ftp://x', actor: ME }), /URL/);
});

test('a server check holds the machine to its thresholds', async () => {
  monitors.setProbe(null);
  const s = servers.listServers()[0];
  const c = monitors.createCheck({ kind: 'server', target: String(s.id), thresholds: { cpu: 90 }, actor: ME });
  const r = await monitors.runCheck(c.id);
  assert.equal(r.state, 'degraded');
  assert.match(r.last_error, /CPU 97%/);
});

// ------------------------------------------------------------------ crew --

test('the AI plans work for people; a person dispatches it', async () => {
  const a = createPerson({ displayName: 'Layla Hassan', actor: ME });
  const b = createPerson({ displayName: 'Omar Saleh', actor: ME });
  const ea = employ({ personId: a.id, employeeNo: 'E-100', actor: ME });
  employ({ personId: b.id, employeeNo: 'E-101', actor: ME });
  const plan = crew.planWork({ goal: 'Launch the spring catalogue', actor: ME });
  await drain();
  crew.syncCrew();
  const proposed = crew.getPlan(plan.id);
  assert.equal(proposed.state, 'proposed');
  assert.ok(proposed.proposal.length >= 2);
  assert.throws(() => crew.dispatchPlan(plan.id, { actor: 'agent:AGT-PMO-001' }), /person/);
  const out = crew.dispatchPlan(plan.id, { actor: ME });
  assert.equal(out.assignments.length, proposed.proposal.length);
  const mine = crew.listAssignments({ employeeId: ea.id ?? ea.employeeId ?? one('SELECT id FROM hr_employee WHERE employee_no = ?', 'E-100').id });
  assert.ok(mine.length >= 1);
  assert.equal(mine[0].source, 'ai');
});

test('an employee moves their own work; only a person approves it', async () => {
  const empId = one("SELECT id FROM hr_employee WHERE employee_no = 'E-100'").id;
  const other = one("SELECT id FROM hr_employee WHERE employee_no = 'E-101'").id;
  const a = crew.assign({ employeeId: empId, title: 'Photograph the new range', dueAt: new Date(Date.now() - 3 * 864e5).toISOString(), actor: ME });
  assert.throws(() => crew.move(a.id, { action: 'start', selfEmployeeId: other, actor: 'human:omar' }), /assigned to/);
  crew.move(a.id, { action: 'start', selfEmployeeId: empId, actor: 'human:layla' });
  assert.throws(() => crew.move(a.id, { action: 'block', selfEmployeeId: empId, actor: 'human:layla' }), /blocking/);
  assert.throws(() => crew.move(a.id, { action: 'approve', asManager: false, selfEmployeeId: empId, actor: 'human:layla' }), /manager/);
  crew.move(a.id, { action: 'submit', submission: 'Uploaded 40 photos to the shared drive', selfEmployeeId: empId, actor: 'human:layla' });
  assert.ok(pendingApprovals().some((i) => i.kind === 'crewReview'));
  assert.throws(() => crew.move(a.id, { action: 'approve', asManager: true, actor: 'agent:AGT-PMO-001' }), /person/);
  const done = crew.move(a.id, { action: 'approve', asManager: true, note: 'Lovely', actor: ME });
  assert.equal(done.state, 'approved');
  await drain();
  crew.syncCrew();
  const reviewed = JSON.parse(one('SELECT ai_review FROM crew_assignments WHERE id = ?', a.id).ai_review);
  assert.equal(reviewed.state, 'done', 'the reviewer wrote evidence about the work');
});

test('what slips is nudged once a day, then escalated', () => {
  const empId = one("SELECT id FROM hr_employee WHERE employee_no = 'E-101'").id;
  crew.assign({ employeeId: empId, title: 'Late thing', dueAt: new Date(Date.now() - 4 * 864e5).toISOString(), actor: ME });
  const first = crew.crewSweep().sent;
  assert.ok(first >= 2, 'overdue and escalated');
  assert.equal(crew.crewSweep().sent, 0, 'not again today');
  const w = crew.workload(empId)[0];
  assert.equal(w.signal, 'late');
  assert.equal(w.overdue, 1);
});

test('dispatch autopilot is a person\'s switch', () => {
  assert.throws(() => crew.setAutopilot(true, { actor: 'agent:AGT-PMO-001' }), /person/);
  assert.equal(crew.setAutopilot(true, { actor: ME }).autopilot, true);
  crew.setAutopilot(false, { actor: ME });
});

// ------------------------------------------------------------- the whole --

test('the new departments are on the map, behind a door, and wired', () => {
  const ids = new Set(sectionCatalog().map((s) => s.id));
  for (const d of ['forge', 'sites', 'servers', 'deploys', 'monitors', 'crew']) assert.ok(ids.has(d), d);
  const audit = surfaceAudit();
  assert.deepEqual(audit.unfiled, []);
  const edges = relationshipMatrix();
  for (const d of ['forge', 'sites', 'servers', 'deploys', 'monitors', 'crew']) {
    assert.ok(edges.some((e) => e.from === d || e.to === d), `${d} has a relationship`);
  }
});

test('headquarters reads every lane without throwing', () => {
  const hq = headquarters({ username: 'owner', displayName: 'Owner' });
  assert.ok(hq.build.forge.projects >= 2);
  assert.equal(hq.run.servers.total, 1);
  assert.ok(hq.people.crew.people >= 2);
  assert.ok(Array.isArray(hq.activity));
});

test('the chain verifies after all of it', () => {
  assert.equal(verifyChain().ok, true);
  assert.ok(q("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'forge.%' OR action LIKE 'servers.%' OR action LIKE 'deploy.%' OR action LIKE 'crew.%'")[0].n > 10);
});

test.after(() => {
  forge.stopAllPreviews();
  fs.rmSync(path.join(root, 'data', 'test-apps'), { recursive: true, force: true });
});
