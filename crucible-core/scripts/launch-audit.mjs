// Launch audit — the questions somebody should have to answer before handing
// this to anyone, asked of the running system rather than of the code.
//
// Run: node --experimental-sqlite scripts/launch-audit.mjs
//
// Every check either passes, fails, or says plainly that it cannot tell. A
// check that cannot tell is reported as a gap, not as a pass, because "we did
// not look" and "it is fine" are different answers.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/env.js';
import { q, one, db } from '../src/db.js';
import { verifyChain } from '../src/audit.js';
import { PERMS } from '../src/auth.js';
import { sectionCatalog, relationshipMatrix, connectivityAudit, DIVISIONS } from '../src/links.js';

const findings = [];
const ok = [];
const note = (level, area, what, detail) => findings.push({ level, area, what, detail });
const pass = (area, what) => ok.push(`${area}: ${what}`);

// ---------------------------------------------------------------- security --
// No account ships with a known password any more — first run generates one and
// prints it once. What is left to ask is whether anybody is still carrying that
// generated password instead of having chosen their own.
const { scryptSync, timingSafeEqual } = await import('node:crypto');

const unchanged = q('SELECT username FROM users WHERE must_change = 1');
if (unchanged.length) note('HIGH', 'security', `${unchanged.length} account(s) still hold the password generated at first run`, `${unchanged.map((u) => u.username).join(', ')} — each can do nothing else until it is changed, but it should be changed`);
else pass('security', 'every account has chosen its own password');

// Belt and braces: if a hard-coded credential is ever reintroduced, this
// catches the obvious ones rather than trusting that it will not happen.
const guessable = q('SELECT username, pass FROM users').filter((u) => {
  const [salt, hash] = String(u.pass).split(':');
  if (!salt || !hash) return false;
  const stored = Buffer.from(hash, 'hex');
  return ['crucible', 'alphacore', 'admin', 'password', 'changeme'].some((guess) => {
    const known = scryptSync(guess, salt, 64);
    return known.length === stored.length && timingSafeEqual(known, stored);
  });
});
if (guessable.length) note('BLOCKER', 'security', 'an account has a password that is guessable from the source', guessable.map((u) => u.username).join(', '));
else pass('security', 'no account uses a password that appears in the repository');

const wide = q("SELECT username, perms FROM users WHERE role != 'superadmin'").filter((u) => JSON.parse(u.perms).includes('*'));
if (wide.length) note('HIGH', 'security', 'a non-superadmin holds the wildcard permission', wide.map((u) => u.username).join(', '));
else pass('security', 'no ordinary account holds "*"');

// The master key is created lazily, by the first secret. Its absence on a
// fresh install is correct; its absence once secrets exist would mean they
// cannot be read, which is a different and much louder problem.
const keyFile = path.join(ROOT, 'data', 'master.key');
const secretCount = one('SELECT COUNT(*) AS n FROM vault_secrets').n;
if (fs.existsSync(keyFile)) pass('security', 'the vault master key exists — back it up with the database, never inside it');
else if (secretCount) note('BLOCKER', 'security', `${secretCount} secret(s) are stored but the master key is gone`, 'nothing in the vault can be decrypted — restore data/master.key from the backup that has it');
else pass('security', 'nothing is in the vault yet, so there is no master key to lose');

const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const must of ['data/', '.env', '*.key']) {
  if (!gitignore.includes(must)) note('BLOCKER', 'security', `.gitignore does not cover ${must}`, 'a secret is one `git add .` from being public');
}
if (!findings.some((f) => f.what.includes('.gitignore'))) pass('security', 'the ignore rules cover the database, the env file and every key');

const live = q("SELECT id, allowlist FROM connectors WHERE state = 'live'");
const unfenced = live.filter((c) => !JSON.parse(c.allowlist || '[]').length);
if (unfenced.length) note('HIGH', 'security', 'a live connector has no allowlist', `${unfenced.map((c) => c.id).join(', ')} — it may reach anything`);
else pass('security', live.length ? 'every armed connector is fenced by an allowlist' : 'no connector is armed');

const breaches = q("SELECT attack, detail FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL");
if (breaches.length) note('HIGH', 'security', `${breaches.length} red-team finding(s) open`, breaches.map((b) => b.attack).join(', '));
else pass('security', 'the red team has nothing open');

// ------------------------------------------------------------------ record --
const chain = verifyChain();
if (!chain.ok) note('BLOCKER', 'record', 'the audit chain does not verify', `broken at entry ${chain.brokenAt}`);
else pass('record', `the chain verifies across ${chain.checked} entries`);

// The chain verifying against itself is necessary and not sufficient: anybody
// who owns the file can rewrite history and recompute every hash, and the
// result verifies perfectly. Only a witness outside this disk can tell the
// difference, so the audit asks whether there is one.
const { verifyAnchors, anchorsOverview } = await import('../src/anchor.js');
const anchoring = anchorsOverview();
const anchorCheck = verifyAnchors();
if (!anchorCheck.ok && anchorCheck.findings.length) {
  note('BLOCKER', 'record', 'the chain no longer matches what an outside witness recorded', anchorCheck.findings[0]);
} else if (!anchoring.last) {
  note('HIGH', 'record', 'the chain has never been anchored outside this machine',
    'verifyChain() only proves the record agrees with itself — which is exactly what a rewritten record does. Platform → Anchors');
} else if (!anchoring.witnessIsExternal) {
  note('HIGH', 'record', `the only witness is "${anchoring.witness}", which is not external`,
    'a local file is rewritable by anyone who can rewrite the database; use a timestamping authority');
} else if (anchoring.ageHours !== null && anchoring.ageHours > 48) {
  note('MEDIUM', 'record', `the newest external anchor is ${anchoring.ageHours} hours old`,
    'everything since then is provable only against itself');
} else {
  pass('record', `the chain is witnessed outside this machine by ${anchoring.witness}, ${anchoring.ageHours}h ago at height ${anchoring.last.height}`);
}

const trig = q("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_no_%'");
if (trig.length < 2) note('BLOCKER', 'record', 'the append-only triggers are missing', 'the audit log can be edited');
else pass('record', 'the audit log refuses UPDATE and DELETE at the database level');

const { lifecycleOverview } = await import('../src/lifecycle.js');
const life = lifecycleOverview();
if (!life.offsite.configured) {
  note('HIGH', 'record', 'no backup has ever left this machine',
    'BACKUP_SHIP_COMMAND is unset, so every copy is on the disk that holds the original — that survives a mistake, not the disk');
} else if (life.offsite.lastFailureAt && (!life.offsite.lastShippedAt || life.offsite.lastFailureAt > life.offsite.lastShippedAt)) {
  note('HIGH', 'record', 'the last attempt to ship a backup off this machine failed', life.offsite.lastFailureAt);
} else {
  pass('record', `backups leave this machine — last at ${life.offsite.lastShippedAt}`);
}
if (!life.alerts.configured) {
  note('MEDIUM', 'health', 'nothing can reach a person who is not looking at the app',
    'a push needs the app installed on the device that is not being looked at. Set ALERT_CHANNEL for incidents at 3am');
} else {
  pass('health', `alerts reach people through ${life.alerts.channel}`);
}

const backups = q('SELECT file, created_at, verified FROM backups ORDER BY id DESC LIMIT 1');
if (!backups.length) note('HIGH', 'record', 'no backup has ever been taken', 'the first one is a single click on the Backups page');
else {
  const age = (Date.now() - new Date(backups[0].created_at.replace(' ', 'T') + 'Z')) / 36e5;
  if (age > 24) note('MEDIUM', 'record', 'the newest backup is over a day old', `${Math.round(age)} hours`);
  else pass('record', `a backup exists from ${Math.round(age)}h ago`);
}

// ------------------------------------------------------------- wiring/shape --
const sections = sectionCatalog();
const audit = connectivityAudit();
if (audit.orphans.length) note('HIGH', 'wiring', `${audit.orphans.length} department(s) joined to nothing`, audit.orphans.map((o) => o.id).join(', '));
else pass('wiring', `all ${sections.length} departments have at least one declared relationship`);
if (audit.weak.length) note('MEDIUM', 'wiring', `${audit.weak.length} department(s) hang by a single relationship`, audit.weak.map((w) => w.id).join(', '));
else pass('wiring', 'no department hangs by a single thread');

// Every section must have a page, and every page a section. A route with no
// section is unreachable from the map; a section with no route is a dead link.
const appjs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const routeBlock = appjs.slice(appjs.indexOf('const routes = {'), appjs.indexOf('let pollTimer') > 0 ? appjs.indexOf('};', appjs.indexOf('const routes = {')) : undefined);
const routeKeys = new Set([...routeBlock.matchAll(/^\s{2}([a-z][\w]*)\s*:\s*\{/gm)].map((m) => m[1]));
const missingPages = sections.filter((s) => {
  const key = String(s.href || '').replace('#/', '').split('/')[0];
  return key && !routeKeys.has(key);
});
if (missingPages.length) note('HIGH', 'wiring', `${missingPages.length} department(s) point at a page that does not exist`, missingPages.map((s) => `${s.id} → ${s.href}`).join(', '));
else pass('wiring', 'every department on the map opens a real page');

// Every permission the API can demand must exist in the catalogue, or a route
// is permanently unreachable.
const apijs = fs.readFileSync(path.join(ROOT, 'src', 'api.js'), 'utf8');
// The resolver returns permissions from ternaries as often as from plain
// returns. Matching only `return '…'` missed every one of those and reported a
// hundred and fifty-seven live permissions as dead — a false alarm is worse
// than no alarm, because it teaches you to ignore the next one.
const resolver = apijs.slice(apijs.indexOf('function permFor'));
const demanded = new Set([...resolver.matchAll(/'([a-z][\w]*\.[a-z][\w]*)'/g)].map((m) => m[1]));
const unknown = [...demanded].filter((p) => !PERMS.includes(p));
if (unknown.length) note('BLOCKER', 'wiring', 'the API demands permissions that do not exist', unknown.join(', '));
else pass('wiring', `every permission the API demands (${demanded.size}) is in the catalogue of ${PERMS.length}`);

// A permission nobody can be granted is dead weight, not a risk — reported low.
const granted = new Set(q('SELECT perms FROM users').flatMap((u) => JSON.parse(u.perms)));
const nevergranted = PERMS.filter((p) => !demanded.has(p) && !granted.has(p));
if (nevergranted.length > 40) note('LOW', 'wiring', `${nevergranted.length} permissions are never demanded by any route`, `${nevergranted.slice(0, 6).join(', ')}…`);

// ------------------------------------------------------------------ health --
const deadJobs = one("SELECT COUNT(*) AS n FROM jobs WHERE state = 'dead'").n;
if (deadJobs) note('MEDIUM', 'health', `${deadJobs} job(s) gave up after every attempt`, 'the Queue page lists them');
else pass('health', 'no job has been abandoned');

const stuck = one("SELECT COUNT(*) AS n FROM runs WHERE state = 'running' AND created_at < datetime('now','-2 hours')").n;
if (stuck) note('MEDIUM', 'health', `${stuck} run(s) have been "running" for over two hours`, 'the rhythm requeues these, so a standing count means it is not running');
else pass('health', 'nothing is stalled in the queue');

const failing = q("SELECT id FROM connectors WHERE health = 'failing'");
if (failing.length) note('MEDIUM', 'health', `${failing.length} connector(s) failing`, failing.map((c) => c.id).join(', '));

const slo = q("SELECT name, last_value, target FROM slos WHERE state = 'breached'");
if (slo.length) note('MEDIUM', 'health', `${slo.length} service objective(s) breached`, slo.map((s) => `${s.name} (${s.last_value} vs ${s.target})`).join(', '));
else pass('health', 'every service objective is being met');

// ------------------------------------------------------------- readiness ----
const providers = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'providers.json'), 'utf8'));
const { isMockMode } = await import('../src/settings.js');
if (isMockMode()) note('HIGH', 'readiness', 'no model provider is configured', 'the whole platform runs on the deterministic mock — real work needs a key in Settings');
else pass('readiness', 'at least one real model provider is configured');

const publicBase = one("SELECT v FROM settings WHERE k = 'PUBLIC_BASE_URL'");
if (!publicBase) note('MEDIUM', 'readiness', 'PUBLIC_BASE_URL is not set', 'OAuth callbacks and carrier webhooks cannot reach this machine without it');
else pass('readiness', 'the public base URL is set');

for (const f of ['LICENSE', 'SECURITY.md', 'CONTRIBUTING.md']) {
  if (!fs.existsSync(path.join(ROOT, '..', f)) && !fs.existsSync(path.join(ROOT, f))) {
    note('MEDIUM', 'readiness', `${f} is missing`, 'a public repository without it leaves the terms unstated');
  }
}

// Demo residue: rows that look like they came from a test rather than from work.
const demoish = {
  'test connectors': one("SELECT COUNT(*) AS n FROM connectors WHERE id LIKE '%prove%' OR id LIKE '%test%'").n,
  'test API keys': one("SELECT COUNT(*) AS n FROM api_keys WHERE name LIKE '%test%' OR name LIKE '%prove%'").n,
  'simulations': one('SELECT COUNT(*) AS n FROM simulations').n,
  'example.com touches': one("SELECT COUNT(*) AS n FROM egress_log WHERE target LIKE '%example.com%'").n,
};
const residue = Object.entries(demoish).filter(([, n]) => n > 0);
if (residue.length) note('MEDIUM', 'readiness', 'demo and test residue is still in the database', residue.map(([k, n]) => `${n} ${k}`).join(', '));
else pass('readiness', 'no test residue found');

// ------------------------------------------------------------------ report --
const order = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);

console.log(`\nLAUNCH AUDIT — ${sections.length} departments, ${DIVISIONS.length} divisions, ${relationshipMatrix().length} relationships\n`);
console.log(`PASSED (${ok.length})`);
for (const o of ok) console.log(`  ✓ ${o}`);
console.log(`\nFINDINGS (${findings.length})`);
for (const f of findings) {
  console.log(`  ${f.level.padEnd(8)} [${f.area}] ${f.what}`);
  console.log(`           ${f.detail}`);
}
const blockers = findings.filter((f) => f.level === 'BLOCKER').length;
console.log(`\n${blockers ? `${blockers} BLOCKER(S) — not ready` : 'no blockers'}`);
// CI runs this. An audit that always exits 0 is decoration.
process.exit(blockers ? 1 : 0);
