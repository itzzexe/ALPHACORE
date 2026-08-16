// Consolidating a menu is the easiest way to lose a page.
//
// A hundred and forty departments became eight doors. Nothing was removed and
// nothing was renamed, and this file is what makes that a fact rather than an
// intention: every department the catalogue declares must sit behind exactly
// one door, and every hash route the console has ever answered must still
// resolve to the same page it used to.
//
// The second half is the subtle one. Three surface names — approvals, money,
// people — are also department names with pages of their own. A surface route
// called `#/people` would not 404; it would open the wrong page, silently, and
// a test that only looks for 404s would call that a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-surfaces.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-surfaces.db${suffix}`)); } catch { /* first run */ }
}

const { sectionCatalog, SURFACES, CORE2_SURFACES, surfaceOf, surfaceCatalog, surfaceAudit } = await import('../src/links.js');
const { seedAgents } = await import('../src/workflow.js');
const { classify, ask, askRules, RULES } = await import('../src/ask.js');

seedAgents();

// The console is read as text. It has no build step, so what is in the files is
// what runs — but it is no longer one file, so this reads all of them. Walking
// the directory rather than listing it means an extraction that creates a new
// module does not quietly move code out of this test's sight.
function consoleSource() {
  const pub = path.join(root, 'public');
  const parts = [fs.readFileSync(path.join(pub, 'app.js'), 'utf8')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) parts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of ['core', 'state', 'services', 'router', 'views', 'components', 'departments']) {
    const p = path.join(pub, d);
    if (fs.existsSync(p)) walk(p);
  }
  return parts.join('\n');
}

const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const consoleJs = consoleSource();

/** Every key in the console's `routes` object. */
function consoleRoutes() {
  // A named declaration, registered into router/registry.js. Named rather than
  // a bare `registerRoutes({…})` statement for a reason worth keeping: the
  // module splitter draws boundaries between top-level declarations, so a
  // 165-line top-level *statement* is carried along by whichever declaration
  // sits above it. It once ended up inside a department module, which then
  // imported every renderer in the system. This owns its own span.
  const start = appJs.indexOf('const ROUTE_TABLE = {');
  assert.ok(start > 0, 'the route table has moved — this test can no longer find it');
  const keys = new Set();
  // Keys are at one level of indentation inside the object literal; anything
  // deeper belongs to a nested options object and is not a route.
  for (const line of appJs.slice(start).split(/\r?\n/)) {
    if (/^\};/.test(line)) break;
    // The overview is the empty key: `'': { … }`.
    const m = line.match(/^ {2}(?:'([^']*)'|([a-zA-Z][\w-]*))\s*:\s*\{/);
    if (m) keys.add(m[1] ?? m[2]);
  }
  return keys;
}

const ROUTE_KEYS = consoleRoutes();

test('the route table was found, and it is the real one', () => {
  assert.ok(ROUTE_KEYS.size > 100, `only found ${ROUTE_KEYS.size} routes — the parser has drifted`);
  for (const known of ['', 'requests', 'hunt', 'chat', 'trust']) {
    assert.ok(ROUTE_KEYS.has(known), `${known} is missing, so the parse is wrong`);
  }
});

// --- no department is lost -------------------------------------------------

test('every department in the catalogue still has a page in the console', () => {
  const missing = [];
  for (const s of sectionCatalog()) {
    // Packages declare their own routes under #/pkg/<id>, which the console
    // resolves generically rather than with a key per package.
    const route = String(s.href || '').replace(/^#\//, '').split('/')[0];
    if (!route || route === 'pkg') continue;
    if (!ROUTE_KEYS.has(route)) missing.push(`${s.id} → ${s.href}`);
  }
  assert.deepEqual(missing, [], `these departments have no page:\n${missing.join('\n')}`);
});

test('every department sits behind exactly one of the eight doors', () => {
  const a = surfaceAudit();
  assert.deepEqual(a.unfiled, [], 'a department nobody filed can only be reached by typing its URL');
  assert.deepEqual(a.duplicated, [], 'a department behind two doors is a menu that disagrees with itself');
  assert.deepEqual(a.dangling, [], 'a door pointing at a department that does not exist');
  // Eight in the AI core, five in the enterprise core. Asserted as a total so
  // adding a door without deciding which core it belongs to fails here rather
  // than showing up in the menu.
  assert.equal(a.surfaces, 13);
  assert.equal(a.departments, sectionCatalog().length);

  // And the resolved view agrees with the raw declaration, so the navigation
  // draws the same thing the audit checked.
  const resolved = surfaceCatalog().reduce((n, s) => n + s.departments.length, 0);
  assert.equal(resolved, a.departments);
});

test('the doors are exactly the ones the design names, in each core', () => {
  assert.deepEqual(
    SURFACES.map((s) => s.id),
    ['ask', 'work', 'approvals', 'company', 'intelligence', 'money', 'people', 'world'],
  );
  // The enterprise core keeps its own five. Same boundary the bridges enforce
  // in the data — a surface claiming both cores, or neither, would put an HR
  // record back under a run-queue heading.
  assert.deepEqual(
    CORE2_SURFACES.map((s) => s.id),
    ['e-people', 'e-time', 'e-money', 'e-records', 'e-seam'],
  );
  for (const x of SURFACES) assert.equal(x.core, 'core1', `${x.id} says which core it is in`);
  for (const x of CORE2_SURFACES) assert.equal(x.core, 'core2', `${x.id} says which core it is in`);
  const declared = new Set(SURFACES.map((x) => x.id));
  for (const x of CORE2_SURFACES) assert.ok(!declared.has(x.id), `${x.id} is declared twice`);
  for (const s of SURFACES) {
    assert.ok(s.label && s.hint, `${s.id} has no label or no hint`);
    assert.ok(s.departments.length, `${s.id} has nothing behind it`);
  }
});

// --- and no route changed meaning -----------------------------------------

test('a surface route never shadows a department that already owned that name', () => {
  // approvals, money and people are departments *and* surfaces. If the surface
  // pages had been given the bare names, these three department pages would
  // have been silently replaced — no 404, no error, just the wrong page.
  // These three are department route keys and must stay pointed at their
  // department renderers. If a bare surface route were ever added under one of
  // these names it would replace the page rather than 404, which is why the
  // check is on what they render and not on whether they resolve.
  const renderers = {
    approvals: 'renderApprovals', money: 'renderMoney', people: 'renderPeople',
  };
  const lines = appJs.split(String.fromCharCode(10)).map((l) => l.trimEnd());
  for (const [id, fn] of Object.entries(renderers)) {
    assert.ok(ROUTE_KEYS.has(id), `${id} was a department page and must remain one`);
    assert.ok(sectionCatalog().some((s) => s.id === id), `${id} is no longer in the catalogue`);
    const line = lines.find((l) => l.startsWith(`  ${id}: {`));
    assert.ok(line, `#/${id} has no entry in the route table`);
    assert.ok(line.includes(fn), `#/${id} no longer opens the ${id} department — it renders: ${line.trim()}`);
    assert.ok(!line.includes('renderSurface'), `#/${id} was replaced by a surface page`);
  }

  // And the surfaces are reached under their own prefix.
  assert.ok(consoleJs.includes("if (seg === 's' && arg) return { key: 'surface', arg };"),
    'the #/s/ prefix is gone, so the surface routes are colliding again');
  assert.ok(ROUTE_KEYS.has('surface') && ROUTE_KEYS.has('ask') && ROUTE_KEYS.has('departments'));
});

test('the full department list and the map are still reachable', () => {
  assert.ok(consoleJs.includes("location.hash = '#/departments'"), 'the rail no longer offers the full list');
  assert.ok(consoleJs.includes('class="fly-all"'), 'the flyout no longer offers the full list');
  // The relationship map. Linked from every surface page, so it must exist —
  // the first version of that link pointed at #/map, which is not a route.
  assert.ok(ROUTE_KEYS.has('graph'), 'the map page is gone');
  assert.ok(consoleJs.includes("href=\"#/graph\""), 'the surface pages no longer link to the map');

  // The second map. This one earned its place here the hard way: the screen
  // existed, the renderer existed, the permission mapping existed — and the
  // route itself did not, so the page politely reported a permission problem
  // that was actually a 404. A page whose failure mode is a calm empty state
  // passes every sweep, so the wiring is asserted at the source.
  const apiJs = fs.readFileSync(path.join(root, 'src', 'api.js'), 'utf8');
  assert.ok(ROUTE_KEYS.has('map2'), 'the two-galaxies page is gone');
  // The page used to draw its own picture from /api/core2/map. It now opens the
  // atlas itself — one drawing of one catalogue, which is what the declared
  // edge between these two pages has always claimed — so it asks /api/map, the
  // payload that carries the tunnels alongside everything else. The assertion
  // that matters is unchanged and is the one that caught the original bug: the
  // page must really ask, and a route must really answer.
  assert.ok(consoleJs.includes("api('/api/map')"), 'the galaxies page no longer asks the API for the map');
  assert.ok(/\/api\\\/map\$\//.test(apiJs),
    'the console asks for /api/map but no route answers it — the galaxies page will claim a permission problem');
  // /api/core2/map is published in openapi.json, so it outlives the one screen
  // that used to be its only caller.
  assert.ok(/\/api\\\/core2\\\/map\$\//.test(apiJs), 'a published endpoint lost its route');
  assert.ok(consoleJs.includes('href="#/map2"'), 'the first map no longer offers the way to the second');
});

test('a department on the whole-company map can be clicked, not only looked at', () => {
  // Found by driving the map rather than reading it. Every rich interaction —
  // the connection tooltip, click for the ledger, right-click to trace — is
  // keyed on `a[data-node]`, and only the district close-up ever emitted one.
  // The whole-company view drew bare circles, so all three silently did nothing
  // out there while the help text under the canvas promised all three. The
  // failure mode was a map that looked finished and answered nothing, which is
  // exactly the kind of thing a passing sweep never catches.
  const mapJs = fs.readFileSync(path.join(root, 'public', 'views', 'map.js'), 'utf8');
  const far = mapJs.slice(mapJs.indexOf('function buildAtlasFar'), mapJs.indexOf('function buildAtlasNear'));
  assert.ok(far.length > 500, 'the whole-company view moved — this test is looking at nothing');
  assert.ok(far.includes('data-node='), 'the whole-company view draws departments nothing can click');
  // Both galaxies, not just the one that happened to be checked.
  assert.ok(far.split('data-node=').length - 1 >= 2,
    'only one of the two cores draws clickable departments');
  // A three-pixel dot is not a target a person can hit, so each leaf carries an
  // invisible disc. `transparent`, never `none`: a fill of none takes no
  // pointer events at all, and the difference is the whole feature.
  assert.ok(far.includes('at-hit'), 'the leaves have no pointer target');
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.at-hit\s*\{[^}]*fill:\s*transparent/, 'the hit disc cannot receive a click');
});

test('the waiting count is on the bar at every width, not only on the phone', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="waiting-chip"'), 'the count is not on the top bar');
  assert.ok(html.includes('id="tab-dot"'), 'the phone still needs its own');
  assert.ok(consoleJs.includes("$('#waiting-chip')"), 'nothing ever fills the count in');
});

// --- Ask routes to the right place ----------------------------------------

test('a fixed set of asks each lands at its intended target', () => {
  const cases = [
    ['build me a landing page for the new product', 'request'],
    ['create a campaign for the Baghdad launch', 'request'],
    ['send the invoice to the customer', 'request'],
    ['who are the top logistics companies in Baghdad', 'hunt'],
    ['research our competitors pricing', 'hunt'],
    ['find me 20 leads in Erbil', 'hunt'],
    ['ask legal whether we can use this logo', 'employee'],
    ['acme trading', 'lookup'],
    ['what did we spend last month', 'lookup'],
    ['', 'lookup'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(classify(text).target, expected, `"${text}" should route to ${expected}`);
  }
});

test('naming a department nobody has heard of is a search, not a message', async () => {
  // Failure-closed: "ask hamsandwich about X" must not become a message to an
  // employee who does not exist. It falls back to the read-only answer.
  const r = await ask('ask hamsandwich about the roadmap', { actor: 'human:test' });
  assert.equal(r.route.target, 'lookup');
  assert.equal(r.route.directedAt, null);
  assert.equal(r.next, null, 'a fallback must never propose an action');
});

test('nothing that spends money happens without a person', async () => {
  for (const [text, endpoint] of [
    ['build me a pricing page', 'POST /api/requests'],
    ['research the market for logistics in Iraq', 'POST /api/hunt'],
  ]) {
    const r = await ask(text, { actor: 'human:test' });
    assert.equal(r.next.endpoint, endpoint);
    assert.ok(r.next.cost, 'a proposal must say what it costs');
    // The search that already ran is free and read-only; nothing else ran.
    assert.ok(r.answer, 'the free answer should still be there');
  }
});

test('the answer names the departments that produced it', async () => {
  const r = await ask('build me a landing page', { actor: 'human:test' });
  assert.ok(r.departments.some((d) => d.id === 'requests'), 'the routed department must be named');
  for (const d of r.departments) {
    assert.ok(d.href, `${d.id} has no link`);
    assert.ok(d.surface || d.id, `${d.id} has no surface`);
    if (d.surface) assert.ok(SURFACES.some((s) => s.id === d.surface));
  }
});

test('the question itself never reaches the chain', async () => {
  const { q: query } = await import('../src/db.js');
  const secret = 'PLANTED-ASK-3f2a a very identifiable question';
  await ask(secret, { actor: 'human:test' });
  const rows = query("SELECT payload FROM audit_log WHERE action = 'ask.routed'");
  assert.ok(rows.length, 'routing must be recorded');
  assert.ok(!rows.some((r) => String(r.payload || '').includes('PLANTED-ASK')),
    'the chain cannot forget, so a question typed by a person must not be written to it');
});

test('the routing rules can be read rather than reverse-engineered', () => {
  const r = askRules();
  assert.equal(r.rules.length, RULES.length);
  for (const rule of r.rules) {
    assert.ok(rule.id && rule.target && rule.why && rule.pattern, 'a rule that does not explain itself');
  }
  assert.ok(Object.keys(r.targets).length >= 4);
  assert.match(r.note, /no model call/i, 'the promise that this costs nothing must be stated');
});

test('surfaceOf agrees with the declaration', () => {
  for (const s of SURFACES) {
    for (const d of s.departments) assert.equal(surfaceOf(d), s.id);
  }
  assert.equal(surfaceOf('no-such-department'), null);
});
