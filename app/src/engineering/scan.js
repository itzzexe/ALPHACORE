// The scanner — what can be known about code without asking a model.
//
// A reviewer that is a language model is good at judgement and bad at being
// exhaustive: it reads the files it was shown, notices what it notices, and on
// a different day notices something else. A regular expression is the
// opposite. So every review starts here, deterministic and free, and the
// models are asked about what is left — which is the part that needs judgement.
//
// Every rule names its dimension, its severity and the fix, because a finding
// a person cannot act on is a complaint, not a review. A secret is never
// copied into a finding: the evidence shows its first characters and its
// length, which is enough to find it and useless to anybody who reads the log.
import fs from 'node:fs';
import path from 'node:path';

export const DIMENSIONS = ['security', 'tests', 'quality', 'performance', 'accessibility', 'dependencies'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const WEIGHT = { critical: 25, high: 10, medium: 4, low: 1, info: 0 };

const CODE = /\.(m?[jt]sx?|cjs|py|rb|php|go|java|cs|kt|rs|sh|vue|svelte)$/i;
const JS = /\.(m?[jt]sx?|cjs|vue|svelte)$/i;
const PY = /\.py$/i;
const MARKUP = /\.(html?|vue|svelte|jsx|tsx)$/i;
const ANY_TEXT = /./;
// A test file may hold a fake key on purpose, and saying so on every run
// teaches people to ignore the scanner — so fixtures are excused from the
// secret and quality rules, never from the dangerous-code ones.
const IS_TEST = (f) => /(^|\/)(test|tests|__tests__|spec|fixtures?)\/|\.(test|spec)\.[a-z]+$/i.test(f);
const IS_DOC = (f) => /\.(md|txt|rst)$/i.test(f);
const PLACEHOLDER = /(change.?me|example|xxx|your[_-]|<[^>]*>|\$\{|process\.env|os\.environ|getenv|dummy|placeholder|redacted|\*\*\*)/i;

const mask = (s) => {
  const v = String(s || '');
  return v.length <= 6 ? '•'.repeat(v.length) : `${v.slice(0, 4)}… (${v.length} chars)`;
};

/**
 * The line rules. `files` narrows which files a rule reads; `secret` marks the
 * evidence for masking; `skipTests` and `skipDocs` excuse fixtures and prose.
 */
export const RULES = [
  // ---- secrets: a key in a repository is a key somebody else already has ----
  { id: 'secret.aws', dimension: 'security', severity: 'critical', files: ANY_TEXT, secret: true, skipTests: true, re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, title: 'An AWS access key is in the code', fix: 'Revoke the key in IAM now, then load it from the environment or a vault. Removing it from the file does not remove it from git history.' },
  { id: 'secret.github', dimension: 'security', severity: 'critical', files: ANY_TEXT, secret: true, skipTests: true, re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/, title: 'A GitHub token is in the code', fix: 'Revoke it under GitHub → Settings → Developer settings, then read it from the environment.' },
  { id: 'secret.slack', dimension: 'security', severity: 'critical', files: ANY_TEXT, secret: true, skipTests: true, re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, title: 'A Slack token is in the code', fix: 'Rotate the token in the Slack app settings and move it to the environment.' },
  { id: 'secret.stripe', dimension: 'security', severity: 'critical', files: ANY_TEXT, secret: true, skipTests: true, re: /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/, title: 'A live Stripe secret key is in the code', fix: 'Roll the key in the Stripe dashboard immediately; it can move money.' },
  { id: 'secret.model-key', dimension: 'security', severity: 'critical', files: ANY_TEXT, secret: true, skipTests: true, re: /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35})\b/, title: 'A model provider API key is in the code', fix: 'Revoke it with the provider and read it from the environment; a leaked model key is billed to you.' },
  { id: 'secret.private-key', dimension: 'security', severity: 'critical', files: ANY_TEXT, skipTests: true, re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/, lineIgnore: /placeholder\s*=|aria-label|startsWith\(|includes\(|\.test\(/, title: 'A private key is committed', fix: 'Treat the key as compromised: generate a new pair and keep the private half out of the repository.' },
  {
    id: 'secret.assigned', dimension: 'security', severity: 'high', files: ANY_TEXT, secret: true, skipTests: true, skipDocs: true,
    re: /\b(api[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|auth[_-]?token|access[_-]?token)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    group: 2, ignore: PLACEHOLDER,
    title: 'A credential is written into the code', fix: 'Read it from the environment (process.env / os.environ) or a secrets manager, and rotate the value that was committed.',
  },

  // ---- dangerous code ----
  { id: 'code.eval', dimension: 'security', severity: 'high', files: /\.(m?[jt]sx?|cjs|py)$/i, re: /(^|[^\w.])eval\s*\(/, title: 'eval() runs a string as code', fix: 'Parse the data instead (JSON.parse, ast.literal_eval) or map the input to a fixed set of functions.' },
  { id: 'code.new-function', dimension: 'security', severity: 'high', files: JS, re: /new\s+Function\s*\(/, title: 'new Function() compiles a string at runtime', fix: 'Replace with a lookup of known functions; never build code from input.' },
  { id: 'code.command-injection', dimension: 'security', severity: 'high', files: JS, re: /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{|[^)]*\+\s*\w)/, title: 'A shell command is built from a variable', fix: 'Use execFile/spawn with an argument array and no shell, and validate the arguments against an allowlist.' },
  { id: 'code.shell-true', dimension: 'security', severity: 'high', files: PY, re: /\bshell\s*=\s*True\b/, title: 'subprocess runs through a shell', fix: 'Pass a list of arguments with shell=False.' },
  { id: 'code.os-system', dimension: 'security', severity: 'medium', files: PY, re: /\bos\.system\s*\(/, title: 'os.system() passes a string to the shell', fix: 'Use subprocess.run([...]) with an argument list.' },
  {
    id: 'code.sql-concat', dimension: 'security', severity: 'high', files: CODE,
    // Upper case only: SQL in code is written that way, and `<select` in a
    // template is HTML. A line that interpolates only '?' placeholders is the
    // parameterised form, done properly.
    re: /(["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+\s*[\w.]+|`[^`]*\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^`]*\$\{|f["'][^"']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{)/,
    lineIgnore: /=>\s*'\?'|\.map\(\(\)\s*=>\s*'\?'\)/,
    title: 'SQL is assembled from strings', fix: 'Use parameterised queries (? or $1 placeholders) so input can never become SQL.',
  },
  { id: 'code.inner-html', dimension: 'security', severity: 'medium', files: /\.(m?[jt]sx?|html?)$/i, re: /\.(innerHTML|outerHTML)\s*\+?=(?!=)|dangerouslySetInnerHTML/, title: 'HTML is written from a string (possible XSS)', fix: 'Use textContent, or escape every value that came from a user before it is inserted.' },
  { id: 'code.document-write', dimension: 'security', severity: 'medium', files: /\.(m?js|html?)$/i, re: /document\.write(ln)?\s*\(/, title: 'document.write() injects markup', fix: 'Build elements with createElement and textContent.' },
  { id: 'code.tls-off', dimension: 'security', severity: 'high', files: CODE, re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true/, title: 'TLS certificate checking is switched off', fix: 'Remove the override; fix the certificate chain instead of trusting everything.' },
  { id: 'code.weak-hash', dimension: 'security', severity: 'medium', files: CODE, re: /createHash\(\s*["'](md5|sha1)["']\)|hashlib\.(md5|sha1)\(/i, title: 'MD5/SHA-1 used where a strong hash is expected', fix: 'Use SHA-256 for integrity and scrypt/argon2/bcrypt for passwords.' },
  { id: 'code.weak-random', dimension: 'security', severity: 'medium', files: JS, re: /Math\.random\(\).*\b(token|secret|password|salt|nonce|otp|session)\b|\b(token|secret|password|salt|nonce|otp|session)\b.*Math\.random\(\)/i, title: 'Math.random() is used for something secret', fix: 'Use crypto.randomBytes / crypto.randomUUID.' },
  { id: 'code.pickle', dimension: 'security', severity: 'high', files: PY, re: /\bpickle\.loads?\s*\(/, title: 'pickle can execute code while loading', fix: 'Load untrusted data as JSON; keep pickle for data you wrote yourself.' },
  { id: 'code.yaml-load', dimension: 'security', severity: 'medium', files: PY, re: /\byaml\.load\s*\((?![^)]*Loader\s*=\s*yaml\.SafeLoader)/, title: 'yaml.load without SafeLoader', fix: 'Use yaml.safe_load().' },
  { id: 'code.cors-any', dimension: 'security', severity: 'low', files: CODE, re: /Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']|cors\(\s*\)/, title: 'CORS allows every origin', fix: 'List the origins that may call the API.' },
  { id: 'code.plain-http', dimension: 'security', severity: 'low', files: CODE, skipTests: true, re: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|example\.|www\.w3\.org)[\w.-]+/, title: 'A plain-HTTP address is called', fix: 'Use https:// so the traffic cannot be read or changed in transit.' },

  // ---- quality ----
  { id: 'quality.debugger', dimension: 'quality', severity: 'low', files: JS, re: /^\s*debugger\s*;?\s*$/, title: 'A debugger statement was left in', fix: 'Delete it.' },
  { id: 'quality.todo', dimension: 'quality', severity: 'info', files: CODE, skipTests: true, re: /\b(TODO|FIXME|HACK|XXX)\b/, title: 'An unfinished-work marker', fix: 'Do it, or turn it into a task so it is tracked somewhere other than a comment.', perFile: true },
  { id: 'quality.console', dimension: 'quality', severity: 'info', files: /(^|\/)(src|lib|app)\/.*\.(m?[jt]sx?)$/i, skipTests: true, re: /\bconsole\.(log|debug)\(/, title: 'console.log in application code', fix: 'Use a logger with levels, or remove the debugging output.', perFile: true },
  { id: 'quality.empty-catch', dimension: 'quality', severity: 'low', files: JS, re: /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/, title: 'An error is caught and silently dropped', fix: 'Handle it, log it, or comment why ignoring it is correct.' },
  { id: 'quality.bare-except', dimension: 'quality', severity: 'low', files: PY, re: /^\s*except\s*:\s*(pass)?\s*$/, title: 'A bare except swallows every error', fix: 'Catch the specific exception you expect.' },

  // ---- performance ----
  { id: 'perf.sync-io', dimension: 'performance', severity: 'low', files: /(^|\/)(src|lib|app|routes|server)[^/]*\/?.*\.(m?[jt]s)$/i, skipTests: true, re: /\b(readFileSync|writeFileSync|execSync|spawnSync)\b/, title: 'Synchronous I/O in server code', fix: 'Use the async form inside request handlers so one slow disk does not stall every request.', perFile: true, context: /createServer|app\.(get|post|use)|router\.|fastify|express\(/ },
  { id: 'perf.blocking-script', dimension: 'performance', severity: 'low', files: /\.html?$/i, re: /<script\s+(?![^>]*\b(defer|async|type=["']module["'])\b)[^>]*\bsrc=/i, title: 'A script blocks page rendering', fix: 'Add defer (or type="module") so the page paints before the script runs.' },

  // ---- accessibility ----
  { id: 'a11y.img-alt', dimension: 'accessibility', severity: 'medium', files: MARKUP, re: /<img\b(?![^>]*\balt\s*=)[^>]*>/i, title: 'An image has no alt text', fix: 'Add alt="what it shows", or alt="" if it is decoration.' },
  { id: 'a11y.html-lang', dimension: 'accessibility', severity: 'medium', files: /\.html?$/i, re: /<html\b(?![^>]*\blang\s*=)[^>]*>/i, title: 'The page does not declare its language', fix: 'Add lang="en" (or lang="ar" dir="rtl") to <html>.' },
  { id: 'a11y.empty-button', dimension: 'accessibility', severity: 'medium', files: MARKUP, re: /<button\b(?![^>]*\baria-label)[^>]*>\s*<\/button>/i, title: 'A button has no accessible name', fix: 'Give it text, or an aria-label.' },
  { id: 'a11y.zoom-off', dimension: 'accessibility', severity: 'medium', files: MARKUP, re: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i, title: 'Pinch-to-zoom is disabled', fix: 'Remove user-scalable=no and maximum-scale; people with low vision need to zoom.' },
  { id: 'a11y.positive-tabindex', dimension: 'accessibility', severity: 'low', files: MARKUP, re: /tabindex\s*=\s*["']?[1-9]/i, title: 'A positive tabindex reorders keyboard focus', fix: 'Use tabindex="0" and fix the order in the markup.' },
  { id: 'a11y.click-div', dimension: 'accessibility', severity: 'low', files: MARKUP, re: /<(div|span)\b[^>]*\bonclick\s*=(?![^>]*\brole\s*=)/i, title: 'A div/span is clickable but not a control', fix: 'Use a <button>, or add role="button", tabindex="0" and key handling.' },
];

const MAX_FILE = 400_000;
const ASSET = /\.(png|jpe?g|gif|webp|mp4|mov|webm|woff2?|ttf|otf|pdf|zip)$/i;

/** Every rule over every line of every file. Pure: give it text, get findings. */
export function scanFiles(files, { only = null } = {}) {
  const findings = [];
  const perFileSeen = new Map();
  for (const f of files) {
    if (typeof f.content !== 'string' || f.content.length > MAX_FILE) continue;
    const rel = f.path;
    const test = IS_TEST(rel);
    const doc = IS_DOC(rel);
    const rules = RULES.filter((r) => (!only || only.includes(r.dimension)) && r.files.test(rel)
      && !(r.skipTests && test) && !(r.skipDocs && doc)
      && !(r.context && !r.context.test(f.content)));
    if (!rules.length) continue;
    const lines = f.content.split('\n');
    // A patch only shows what it added; the caller hands the real line numbers.
    const numberOf = (i) => (f.lineMap ? f.lineMap[i] : i + 1);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 2000) continue; // minified: one line is the whole file
      for (const r of rules) {
        const m = line.match(r.re);
        if (!m) continue;
        if (r.ignore && r.ignore.test(m[r.group || 0])) continue;
        if (r.lineIgnore && r.lineIgnore.test(line)) continue;
        if (r.perFile) {
          const k = `${r.id}\0${rel}`;
          const seen = perFileSeen.get(k);
          if (seen) { seen.count += 1; continue; }
        }
        const hit = {
          dimension: r.dimension, severity: r.severity, rule: r.id, file: rel, line: numberOf(i),
          title: r.title, fix: r.fix,
          evidence: r.secret ? mask(m[r.group || 0]) : line.trim().slice(0, 160),
          count: 1,
        };
        if (r.perFile) perFileSeen.set(`${r.id}\0${rel}`, hit);
        findings.push(hit);
      }
    }
  }
  for (const f of findings) {
    if (f.count > 1) f.title = `${f.title} (${f.count} places in this file)`;
    delete f.count;
  }
  return findings;
}

// ------------------------------------------------------- whole-project rules --

const readJson = (full) => { try { return JSON.parse(fs.readFileSync(full, 'utf8')); } catch { return null; } };

/**
 * What a project is made of — the software bill of materials. Licences come
 * from installed packages when node_modules exists; otherwise the licence is
 * "unknown" rather than guessed, because a guessed licence is a legal claim.
 */
export function sbom(root) {
  const out = [];
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    for (const [kind, deps] of [['runtime', pkg.dependencies], ['dev', pkg.devDependencies]]) {
      for (const [name, version] of Object.entries(deps || {})) {
        const installed = readJson(path.join(root, 'node_modules', name, 'package.json'));
        const lic = installed?.license || (Array.isArray(installed?.licenses) ? installed.licenses.map((l) => l.type).join(' OR ') : null);
        out.push({ ecosystem: 'npm', name, wanted: String(version), installed: installed?.version || null, kind, licence: typeof lic === 'string' ? lic : (lic?.type || 'unknown') });
      }
    }
  }
  const req = path.join(root, 'requirements.txt');
  if (fs.existsSync(req)) {
    for (const raw of fs.readFileSync(req, 'utf8').split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line || line.startsWith('-')) continue;
      const m = line.match(/^([A-Za-z0-9_.\-[\]]+)\s*(.*)$/);
      if (m) out.push({ ecosystem: 'pypi', name: m[1], wanted: m[2] || '*', installed: null, kind: 'runtime', licence: 'unknown' });
    }
  }
  return out;
}

// Licences that oblige you to publish your own source when you ship. Not wrong
// to use — this project is AGPL itself — but a decision, not an accident.
const COPYLEFT = /\b(A?GPL|LGPL|SSPL|EUPL|OSL|CC-BY-SA)/i;
const DEPRECATED = new Set(['request', 'node-uuid', 'left-pad', 'event-stream', 'querystring', 'crypto', 'nomnom', 'jade', 'gulp-util']);

function projectRules(root, tree) {
  const findings = [];
  const add = (f) => findings.push({ line: null, evidence: null, ...f });
  const paths = tree.map((f) => f.path);
  const source = paths.filter((p) => CODE.test(p) && !IS_TEST(p) && !/(^|\/)(scripts|config|migrations?)\//.test(p));
  const tests = paths.filter((p) => IS_TEST(p) || /(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(p));

  // Committed environment files.
  for (const p of paths.filter((x) => /(^|\/)\.env(\.[\w-]+)?$/.test(x) && !/\.(example|sample|template)$/.test(x))) {
    add({ dimension: 'security', severity: 'high', rule: 'secret.env-file', file: p, title: 'An environment file is in the repository', fix: 'Delete it from git (git rm --cached), add it to .gitignore, and rotate whatever it held. Commit a .env.example with empty values instead.' });
  }

  // Tests.
  const pkg = readJson(path.join(root, 'package.json'));
  if (source.length && !tests.length) {
    add({ dimension: 'tests', severity: source.length > 3 ? 'high' : 'medium', rule: 'tests.none', file: null, title: `No tests for ${source.length} source file(s)`, fix: 'Ask the test engineer to write a first suite for the main paths, then keep it running before every deploy.' });
  } else if (source.length >= 5 && tests.length / source.length < 0.2) {
    add({ dimension: 'tests', severity: 'low', rule: 'tests.thin', file: null, title: `Only ${tests.length} test file(s) for ${source.length} source files`, fix: 'Cover the modules that handle money, auth and data first.' });
  }
  if (pkg) {
    const t = pkg.scripts?.test;
    if (!t || /no test specified/.test(t)) add({ dimension: 'tests', severity: 'medium', rule: 'tests.no-script', file: 'package.json', title: 'package.json has no test script', fix: 'Add "test": "node --test" (or your runner) so the factory and CI can run it.' });
  }

  // Dependencies.
  const bom = sbom(root);
  if (pkg && Object.keys(pkg.dependencies || {}).length && !paths.some((p) => /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(p))) {
    add({ dimension: 'dependencies', severity: 'low', rule: 'deps.no-lockfile', file: 'package.json', title: 'Dependencies are not locked', fix: 'Commit the lockfile so every install gets the same versions.' });
  }
  for (const d of bom) {
    const file = d.ecosystem === 'npm' ? 'package.json' : 'requirements.txt';
    if (d.ecosystem === 'npm' && /^(\*|latest|x)$|^$/.test(d.wanted.trim())) add({ dimension: 'dependencies', severity: 'medium', rule: 'deps.unpinned', file, title: `${d.name} accepts any version`, evidence: `${d.name}: ${d.wanted}`, fix: 'Pin a range (^1.2.3) so a hostile or broken release is not installed automatically.' });
    if (d.ecosystem === 'npm' && /^(git|https?):|github:|\.tgz$/.test(d.wanted)) add({ dimension: 'dependencies', severity: 'medium', rule: 'deps.remote-source', file, title: `${d.name} is installed from a URL, not the registry`, evidence: `${d.name}: ${d.wanted}`, fix: 'Publish it or vendor a reviewed copy; a URL can change what it serves.' });
    if (d.ecosystem === 'pypi' && !/==/.test(d.wanted)) add({ dimension: 'dependencies', severity: 'low', rule: 'deps.unpinned', file, title: `${d.name} is not pinned`, evidence: `${d.name} ${d.wanted}`, fix: 'Pin with == (and use pip-tools or a lockfile).' });
    if (DEPRECATED.has(d.name)) add({ dimension: 'dependencies', severity: 'low', rule: 'deps.deprecated', file, title: `${d.name} is deprecated or a known hazard`, evidence: `${d.name}@${d.wanted}`, fix: 'Replace it with the maintained alternative (fetch, crypto.randomUUID, the standard library).' });
    if (COPYLEFT.test(d.licence || '')) add({ dimension: 'dependencies', severity: 'info', rule: 'deps.copyleft', file, title: `${d.name} is ${d.licence}`, evidence: `${d.name}: ${d.licence}`, fix: 'Fine to use; make sure shipping it matches your own licence obligations.' });
  }

  // Assets.
  for (const f of tree) {
    if (ASSET.test(f.path) && f.size > 500_000) add({ dimension: 'performance', severity: 'medium', rule: 'perf.large-asset', file: f.path, title: `A ${(f.size / 1048576).toFixed(1)} MB asset is shipped`, fix: 'Compress or resize it (WebP/AVIF for images), or serve it from storage built for large files.' });
  }
  // Size.
  for (const f of tree) {
    if (!CODE.test(f.path) || IS_TEST(f.path) || f.size > MAX_FILE) continue;
    let n = 0;
    try { n = fs.readFileSync(path.join(root, f.path), 'utf8').split('\n').length; } catch { continue; }
    if (n > 800) add({ dimension: 'quality', severity: 'low', rule: 'quality.large-file', file: f.path, title: `${n} lines in one file`, fix: 'Split it along the seams it already has; a file this long is reviewed by skimming.' });
  }
  return { findings, bom, counts: { source: source.length, tests: tests.length, files: tree.length } };
}

/** A whole project on disk: the line rules over its text, then the project rules. */
export function scanProject(root, tree, { only = null } = {}) {
  const files = [];
  for (const f of tree) {
    if (!f.text || f.size > MAX_FILE) continue;
    try { files.push({ path: f.path, content: fs.readFileSync(path.join(root, f.path), 'utf8') }); } catch { /* vanished mid-walk */ }
  }
  const lineFindings = scanFiles(files, { only });
  const proj = projectRules(root, tree);
  const findings = [...lineFindings, ...proj.findings.filter((f) => !only || only.includes(f.dimension))];
  return { findings, bom: proj.bom, counts: proj.counts };
}

/**
 * A pull request's files as GitHub returns them: only the added lines are
 * scanned, each with the line number it will have after the merge. A review
 * of a pull request is about what it changes, not about the whole repository.
 */
export function scanPatches(prFiles, { only = null } = {}) {
  const files = [];
  for (const f of prFiles || []) {
    if (!f?.patch || f.status === 'removed') continue;
    const added = [];
    const map = [];
    let n = 0;
    for (const line of String(f.patch).split('\n')) {
      const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) { n = Number(h[1]); continue; }
      if (line.startsWith('+')) { added.push(line.slice(1)); map.push(n); n += 1; } else if (!line.startsWith('-')) n += 1;
    }
    files.push({ path: f.filename, content: added.join('\n'), lineMap: map });
  }
  const findings = scanFiles(files, { only });
  for (const f of (prFiles || []).filter((x) => /(^|\/)\.env(\.[\w-]+)?$/.test(x.filename) && !/\.(example|sample)$/.test(x.filename) && x.status !== 'removed')) {
    findings.push({ dimension: 'security', severity: 'high', rule: 'secret.env-file', file: f.filename, line: null, title: 'This pull request adds an environment file', evidence: null, fix: 'Remove it from the branch and rotate what it held.' });
  }
  return findings;
}

/** One number and one word, computed the same way for every review. */
export function score(findings) {
  const open = findings.filter((f) => !f.state || f.state === 'open');
  const penalty = open.reduce((a, f) => a + (WEIGHT[f.severity] ?? 0), 0);
  const worst = SEVERITIES.find((s) => open.some((f) => f.severity === s)) || null;
  return {
    score: Math.max(0, 100 - penalty),
    verdict: worst === 'critical' ? 'fail' : worst === 'high' ? 'warn' : 'pass',
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((f) => f.severity === s).length])),
    byDimension: Object.fromEntries(DIMENSIONS.map((d) => [d, open.filter((f) => f.dimension === d).length])),
  };
}
