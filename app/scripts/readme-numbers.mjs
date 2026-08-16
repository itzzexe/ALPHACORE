// The README's numbers, measured from the code that produces them.
//
// A document whose argument is "nothing is claimed from inspection, every
// number is measured" cannot carry four counts that disagree with each other
// inside one file — a reader who finds one stops believing the rest, including
// the parts that are true. So the counts are derived here the same way
// openapi.json is derived from the route table, and CI fails on drift.
//
//   npm run readme          # rewrite the numbers in place
//   npm run readme:check    # fail if any of them has drifted
//
// What this covers: counts that change when somebody adds a department, a
// permission, a route, a test, a table. What it deliberately does not cover:
// domain constants that are not derived from a catalogue — the ten
// constitutional rules, the five-hundred-year-old bookkeeping rules, the
// 22-account chart. Those change by decision, not by drift, and a checker that
// pretends to verify them would be theatre.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The README is the repository's, not the platform's: one description of this
// project, at the top, where somebody arriving from GitHub lands. The catalogues
// it counts are still in here, which is why this script lives in the app.
const README = path.join(ROOT, '..', 'README.md');

// Numbers written as words keep the opening paragraph readable. They are still
// checked: the expected count is spelled and compared, so "one hundred and
// twenty-two" fails the moment the catalogue says a hundred and thirty.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function spell(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${spell(rest)}` : ''}`;
}
const capitalise = (s) => s[0].toUpperCase() + s.slice(1);
const comma = (n) => n.toLocaleString('en-US');
const round = (n, to) => Math.round(n / to) * to;

// The catalogues live behind modules that open a database on import, and a
// documentation check has no business touching the company's one — or seeding
// an owner account into an empty checkout on CI. So it runs against a scratch
// file that is deleted afterwards, with the first-run banner swallowed.
//
// Measuring against an *empty* database is not just hygiene, it is the only
// honest reading. Some counts move with the data: relationshipMatrix() reports
// 390 declared edges on a fresh install and more once records exist to link.
// A number printed in the README has to mean the same thing to every reader,
// so what is documented is what the catalogue declares, not what one machine
// happens to be holding.
async function loadCatalogues() {
  const scratch = path.join(os.tmpdir(), `alphacore-readme-${process.pid}.db`);
  process.env.ALPHACORE_DB = scratch;
  const say = console.log;
  console.log = () => {};
  try {
    const links = await import('../src/links.js');
    const { PERMS } = await import('../src/auth.js');
    return { ...links, PERMS };
  } finally {
    console.log = say;
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(scratch + suffix); } catch { /* it may never have been created */ }
    }
  }
}

async function measure() {
  const { sectionCatalog, DIVISIONS, relationshipMatrix, PERMS } = await loadCatalogues();

  const sections = sectionCatalog();
  const perDivision = {};
  for (const s of sections) perDivision[s.division] = (perDivision[s.division] || 0) + 1;

  // The same scrape the OpenAPI generator uses, so the two can never disagree
  // about how many routes there are.
  const api = fs.readFileSync(path.join(ROOT, 'src', 'api.js'), 'utf8');
  const routes = [...api.matchAll(/\['(GET|POST|PUT|DELETE|PATCH)',\s*(\/\^[^,]+?\$\/)\s*,/g)].length;

  // Counting the calls rather than running the suite, because a checker that has
  // to boot the world to check a sentence does not get run.
  //
  // This counts test *declarations*, which is not quite what `npm test` prints.
  // One `test()` inside a loop — the boot matrix in production.test.js — is a
  // single declaration that runs eight times, so the suite reports more than
  // this does. The comment here used to claim the two matched exactly; they did
  // when it was written and stopped the day the first generated case appeared.
  // Both numbers are true of different things, and the README says which.
  const testFiles = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js'));
  const tests = testFiles.reduce((n, f) => n
    + (fs.readFileSync(path.join(ROOT, 'test', f), 'utf8').match(/^\s*(test|it)\(/gm) || []).length, 0);

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])));
  const modules = walk(path.join(ROOT, 'src'));
  const srcLines = modules.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').length - 1, 0);
  const lines = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').length - 1;

  // Tables come from the schema text rather than from a live database, so this
  // needs no file on disk and no migration run.
  const schema = fs.readFileSync(path.join(ROOT, 'src', 'db.js'), 'utf8');
  const tables = new Set([...schema.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/gi)]
    .map((m) => m[1].toLowerCase())).size;

  const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agents.json'), 'utf8')).agents.length;
  const providers = Object.keys(JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config', 'providers.json'), 'utf8')).providers);

  return {
    departments: sections.length,
    divisions: DIVISIONS.length,
    perDivision,
    relationships: relationshipMatrix().length,
    permissions: PERMS.length,
    permFamilies: new Set(PERMS.map((p) => String(p).split('.')[0])).size,
    routes,
    tests,
    testFiles: testFiles.length,
    modules: modules.length,
    srcLines,
    appLines: lines('public/app.js'),
    cssLines: lines('public/styles.css'),
    tables,
    agents,
    realProviders: providers.filter((p) => p !== 'mock').length,
    // Two themes and two languages, at two viewport sizes, over every department.
    renders: sections.length * 2 * 2,
  };
}

// Each claim names one number in the README and one regular expression with a
// single capture group holding it. If an anchor stops matching, that is drift
// too — the sentence was rewritten and nobody re-checked the number in it.
function claims(f) {
  const d = f.perDivision;
  const division = (label, key) => ({
    what: `mermaid ${label}`, value: d[key], re: new RegExp(`(?<=${label} · )(\\d+)(?=<br/>)`),
  });
  const summary = (label, key) => ({
    what: `details ${label}`, value: d[key], re: new RegExp(`(?<=<summary><b>${label} · )(\\d+)(?=</b>)`),
  });

  return [
    { what: 'badge departments', value: f.departments, re: /(?<=badge\/departments-)(\d+)(?=-)/ },
    { what: 'badge departments alt', value: f.departments, re: /(?<=alt=")(\d+)(?= departments")/ },
    { what: 'badge divisions', value: f.divisions, re: /(?<=badge\/divisions-)(\d+)(?=-)/ },
    { what: 'badge divisions alt', value: f.divisions, re: /(?<=alt=")(\d+)(?= divisions")/ },
    { what: 'badge relationships', value: f.relationships, re: /(?<=badge\/relationships-)(\d+)(?=-)/ },
    { what: 'badge relationships alt', value: f.relationships, re: /(?<=alt=")(\d+)(?= declared relationships")/ },
    { what: 'badge routes', value: f.routes, re: /(?<=badge\/API-)(\d+)(?=_routes-)/ },
    { what: 'badge routes alt', value: f.routes, re: /(?<=alt=")(\d+)(?= API routes")/ },
    { what: 'badge permissions', value: f.permissions, re: /(?<=badge\/permissions-)(\d+)(?=_atomic-)/ },
    { what: 'badge permissions alt', value: f.permissions, re: /(?<=alt=")(\d+)(?= atomic permissions")/ },
    { what: 'badge tests', value: f.tests, re: /(?<=badge\/tests-)(\d+)(?=-)/ },
    { what: 'badge tests alt', value: f.tests, re: /(?<=alt=")(\d+)(?= tests")/ },

    { what: 'headline departments', value: capitalise(spell(f.departments)), re: /^(.+?)(?= departments across )/m },
    { what: 'headline divisions', value: spell(f.divisions), re: /(?<= departments across )([a-z-]+)(?= divisions,)/ },

    { what: 'contents link', value: f.departments, re: /(?<=\[All )(\d+)(?= departments\])/ },
    { what: 'contents anchor', value: `${f.divisions}-divisions-${f.departments}`, re: /(?<=#the-company--)([0-9a-z-]+?)(?=-departments\))/ },
    { what: 'heading divisions', value: f.divisions, re: /(?<=## The company — )(\d+)(?= divisions)/ },
    { what: 'heading departments', value: f.departments, re: /(?<=## The company — \d+ divisions, )(\d+)(?= departments)/ },

    division('ENGINE', 'engine'), division('THE WORLD', 'world'), division('BUILD', 'build'),
    division('DECIDE', 'decide'), division('DATA', 'data'), division('MARKETING', 'marketing'),
    division('COMMERCE', 'commerce'), division('CAPITAL', 'capital'), division('OPERATE', 'operate'),
    division('TALENT', 'talent'), division('TRUST', 'trust'), division('EXECUTIVE', 'exec'),
    division('GOVERN', 'govern'),

    summary('ENGINE', 'engine'), summary('BUILD', 'build'), summary('DECIDE', 'decide'),
    summary('DATA', 'data'), summary('MARKETING', 'marketing'), summary('COMMERCE', 'commerce'),
    summary('CAPITAL', 'capital'), summary('OPERATE', 'operate'), summary('TALENT', 'talent'),
    summary('TRUST', 'trust'), summary('EXECUTIVE', 'exec'), summary('GOVERN', 'govern'),
    summary('THE WORLD', 'world'),

    { what: 'relationships prose', value: f.relationships, re: /(?<=\*\*)(\d+)(?= relationships\*\* that the map)/ },
    { what: 'routes prose', value: f.routes, re: /(?<=\*\*)(\d+)(?= routes\*\* — all JSON)/ },
    { what: 'permissions prose', value: f.permissions, re: /(?<=\*\*)(\d+)(?= atomic permissions\*\*)/ },
    { what: 'permission families', value: f.permFamilies, re: /(?<=atomic permissions\*\* across )(\d+)(?= families)/ },
    { what: 'roles over permissions', value: f.permissions, re: /(?<=templates over the )(\d+)(?= permissions)/ },

    { what: 'layout auth permissions', value: f.permissions, re: /(?<=sessions, )(\d+)(?= permissions)/ },
    { what: 'layout tables', value: f.tables, re: /(?<=db\.js {13})(\d+)(?= tables)/ },
    { what: 'layout modules', value: f.modules, re: /(?<=src\/ {16})(\d+)(?= modules)/ },
    { what: 'layout src lines', value: comma(round(f.srcLines, 100)), re: /(?<= modules, ~)([\d,]+)(?= lines)/, soft: true },
    { what: 'layout app lines', value: comma(round(f.appLines, 100)), re: /(?<=the console — )([\d,]+)(?= lines)/, soft: true },
    { what: 'layout css lines', value: comma(round(f.cssLines, 100)), re: /(?<=styles\.css {8})([\d,]+)(?= lines)/, soft: true },
    { what: 'layout tests', value: f.tests, re: /(?<=test\/ {15})(\d+)(?= tests across)/ },
    { what: 'layout test files', value: spell(f.testFiles), re: /(?<=tests across )([a-z-]+)(?= files)/ },

    { what: 'cli tests', value: f.tests, re: /(?<=`npm test` \| )(\d+)(?= tests)/ },
    { what: 'verification tests', value: f.tests, re: /(?<=npm test {24}# )(\d+)(?= tests)/ },

    { what: 'seeded agents (engine)', value: f.agents, re: /(?<=carried out\. )(\d+)(?= AI employees seeded)/ },
    { what: 'seeded agents (workforce)', value: f.agents, re: /(?<=### The workforce\s+)(\d+)(?= employees seeded)/ },

    { what: 'sweep departments', value: f.departments, re: /(?<=opens all )(\d+)(?= departments in both themes)/ },
    { what: 'sweep renders', value: f.renders, re: /(?<=— )(\d+)(?= renders each)/ },
    { what: 'real providers', value: capitalise(spell(f.realProviders)), re: /(?<=^)([A-Za-z]+)(?= real providers plus a deterministic mock)/m },
  ];
}

const fix = process.argv.includes('--fix');
const facts = await measure();
let text = fs.readFileSync(README, 'utf8');
const drift = [];
const missing = [];

for (const c of claims(facts)) {
  const want = String(c.value);
  const m = text.match(c.re);
  if (!m) { missing.push(c.what); continue; }
  const found = m[0];
  if (found === want) continue;
  // Line counts are written to the nearest hundred and would otherwise churn on
  // every commit, so they only count as drift once they are properly stale.
  if (c.soft) {
    const n = (s) => Number(String(s).replace(/,/g, ''));
    if (Math.abs(n(found) - n(want)) / Math.max(1, n(want)) < 0.05) continue;
  }
  drift.push({ what: c.what, found, want });
  if (fix) text = text.replace(c.re, want);
}

const pad = (s, n) => String(s).padEnd(n);
if (missing.length) {
  console.error(`\n  ${missing.length} claim(s) no longer match anything in the README.`);
  console.error('  The sentence was rewritten and its number was not re-checked:\n');
  for (const w of missing) console.error(`    ${w}`);
}
if (drift.length) {
  console.error(`\n  ${drift.length} number(s) in the README disagree with the code:\n`);
  console.error(`    ${pad('claim', 30)} ${pad('README says', 22)} measured`);
  for (const d of drift) console.error(`    ${pad(d.what, 30)} ${pad(d.found, 22)} ${d.want}`);
}

if (fix && drift.length) {
  fs.writeFileSync(README, text);
  console.log(`\n  ${drift.length} number(s) corrected in README.md\n`);
  process.exit(missing.length ? 1 : 0);
}
if (!drift.length && !missing.length) {
  console.log(`  README numbers are current: ${facts.departments} departments, ${facts.relationships} relationships, ${facts.routes} routes, ${facts.permissions} permissions, ${facts.tests} tests.`);
  process.exit(0);
}
console.error(`\n  Run \`npm run readme\` to correct them.\n`);
process.exit(1);
