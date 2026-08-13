// The browser sweep — every department, opened.
//
// The console has no build step and no framework, which means a broken render
// is a runtime error in one function and nothing else notices. Unit tests do
// not open a page. The launch audit checks that every department *has* a route,
// not that the route draws anything. So this opens all of them, in both themes,
// in both languages, at a desktop width and a phone width, and fails on the
// five things that are invisible until somebody complains:
//
//   a blank page          — the render threw and the catch wrote an error box
//   a console error       — something failed quietly on the way
//   horizontal overflow   — the page pushes sideways on a phone
//   an external request   — this console must reach nothing but its own origin
//   an unnamed control    — a button a screen reader announces as "button"
//
// It drives Chrome over the DevTools protocol with the standard library only:
// no Playwright, no Puppeteer, no dependency. Node 22 has WebSocket and fetch.
//
//   node scripts/sweep.mjs                    # needs a server and a Chrome
//   node scripts/sweep.mjs --fast             # one theme, one language, desktop
//   node scripts/sweep.mjs --only=tax,offices # a few departments while working
//
// Chrome must be listening on the debugging port:
//   chrome --headless=new --remote-debugging-port=9222 about:blank
import process from 'node:process';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const PORT = arg('port', process.env.PORT || '8484');
const CDP = arg('cdp', '9222');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const USER = arg('user', 'admin');
const PASS = arg('pass', process.env.SWEEP_PASSWORD || 'crucible');
const ONLY = arg('only', '').split(',').filter(Boolean);
const FAST = has('fast');

const VIEWPORTS = FAST ? [[1440, 900]] : [[1440, 900], [390, 844]];
const THEMES = FAST ? ['light'] : ['light', 'dark'];
const LANGS = FAST ? ['en'] : ['en', 'ar'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
let renders = 0;

// ------------------------------------------------------------- the harness --

async function connect() {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  } catch {
    console.error(`\n  No browser on port ${CDP}. Start one with:\n`
      + `    chrome --headless=new --remote-debugging-port=${CDP} about:blank\n`);
    process.exit(2);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { console.error('  the browser is running but has no tab to drive'); process.exit(2); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('the browser did not answer')), 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); res(); });
    ws.addEventListener('error', () => { clearTimeout(timer); rej(new Error('could not attach')); });
  });

  let id = 1;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const mine = id++;
    const timer = setTimeout(() => reject(new Error(`${method} did not return`)), 30000);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== mine) return;
      clearTimeout(timer); ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

  // Two live collectors. Both are cleared before each render so a failure is
  // attributed to the page that caused it rather than to the next one.
  const seen = { errors: [], external: [] };
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      seen.errors.push(String(m.params.exceptionDetails?.exception?.description
        || m.params.exceptionDetails?.text || 'exception').split('\n')[0].slice(0, 160));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      seen.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
    }
    if (m.method === 'Network.requestWillBeSent') {
      const url = m.params.request.url;
      if (/^(data|blob):/.test(url)) return;
      try { if (new URL(url).origin !== ORIGIN) seen.external.push(url.slice(0, 120)); }
      catch { /* not a URL we can judge */ }
    }
  });

  const evaluate = async (expression) => {
    const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  await rpc('Page.enable'); await rpc('Runtime.enable'); await rpc('Network.enable');
  return { rpc, evaluate, seen, close: () => ws.close() };
}

// ------------------------------------------------------- what a page must be --

// Runs inside the page. Kept as one expression so it survives Runtime.evaluate
// without a bundler, which is the whole constraint this project works under.
const AUDIT_PAGE = `(() => {
  const view = document.querySelector('#view');
  const text = (view?.innerText || '').trim();

  // A control a screen reader would announce as nothing but its role.
  const named = (el) => {
    // Common to everything: an explicit name always counts.
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return true;
    const by = el.getAttribute('aria-labelledby');
    if (by && by.split(/\\s+/).some((i) => document.getElementById(i)?.innerText?.trim())) return true;
    if ((el.getAttribute('title') || '').trim()) return true;

    // A form control is a special case, and getting it wrong is the easy
    // mistake: a <select> has innerText — its own options — so treating text
    // content as a name passes every unlabelled dropdown in the console. The
    // options are the values. They are not what the control is for.
    const isField = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    if (isField) {
      if (el.type === 'hidden') return true;
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText?.trim()) return true;
      if (el.closest('label')?.innerText?.trim()) return true;
      if ((el.placeholder || '').trim()) return true;
      // A submit or button input is announced by its value.
      if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) && (el.value || '').trim()) return true;
      return false;
    }

    // Buttons and links are announced by what is in them.
    if ((el.innerText || '').trim()) return true;
    if (el.tagName === 'IMG' && (el.getAttribute('alt') || '').trim()) return true;
    if (el.querySelector && el.querySelector('img[alt]:not([alt=""])')) return true;
    return false;
  };

  const unnamed = [];
  for (const el of document.querySelectorAll('#view button, #view a[href], #view input, #view select, #view textarea')) {
    if (el.disabled || el.hidden || el.offsetParent === null) continue;
    if (!named(el)) unnamed.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
  }

  return JSON.stringify({
    blank: text.length < 2,
    error: /^Error:/.test(text) || text === 'could not read this account',
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    unnamed: unnamed.slice(0, 6),
    unnamedCount: unnamed.length,
    chars: text.length,
  });
})()`;

// ------------------------------------------------------------------- the run --

const token = await (async () => {
  try {
    const r = await (await fetch(`${ORIGIN}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    })).json();
    if (!r.token) throw new Error(r.error || 'no token');
    return r.token;
  } catch (e) {
    console.error(`\n  Could not sign in to ${ORIGIN} as ${USER}: ${e.message}`);
    console.error('  Start the server, and pass --user/--pass or SWEEP_PASSWORD if they differ.\n');
    process.exit(2);
  }
})();

const map = await (await fetch(`${ORIGIN}/api/map`, { headers: { 'x-auth-token': token } })).json();
let departments = (map.sections || []).map((s) => ({ id: s.id, route: String(s.href || '').replace('#/', '').split('/')[0] }))
  .filter((d) => d.route);
if (ONLY.length) departments = departments.filter((d) => ONLY.includes(d.id));

const total = departments.length * VIEWPORTS.length * THEMES.length * LANGS.length;
console.log(`\n  Sweeping ${departments.length} departments × ${THEMES.length} theme(s) × ${LANGS.length} language(s)`
  + ` × ${VIEWPORTS.length} viewport(s) = ${total} renders\n`);

const b = await connect();

for (const [w, h] of VIEWPORTS) {
  await b.rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });

  for (const theme of THEMES) {
    for (const lang of LANGS) {
      // One reload per combination; the hash routes after it need none.
      await b.rpc('Page.navigate', { url: `${ORIGIN}/` });
      await sleep(700);
      await b.evaluate(`(localStorage.setItem('alphacore-token', ${JSON.stringify(token)}),
        localStorage.setItem('alphacore-theme', ${JSON.stringify(theme)}),
        localStorage.setItem('alphacore-lang', ${JSON.stringify(lang)}), true)`);
      // A reload, not a hash change. Going from "/" to "/#/" is the same
      // document, so the app never re-reads the token it was just handed and
      // sits on the sign-in screen while the sweep reports 140 blank pages.
      await b.rpc('Page.reload', { ignoreCache: false });
      await sleep(2600);

      const label = `${w}×${h} ${theme} ${lang}`;
      process.stdout.write(`  ${label.padEnd(20)}`);

      for (const d of departments) {
        b.seen.errors.length = 0;
        b.seen.external.length = 0;
        await b.evaluate(`(location.hash = '#/${d.route}', true)`);
        await sleep(260);

        let r;
        try { r = JSON.parse(await b.evaluate(AUDIT_PAGE)); }
        catch (e) { failures.push({ where: `${label} ${d.id}`, what: `the page could not be inspected: ${e.message}` }); continue; }
        renders++;

        const where = `${label} · ${d.id}`;
        if (r.blank) failures.push({ where, what: 'blank — nothing rendered' });
        if (r.error) failures.push({ where, what: 'the render threw and left an error box' });
        if (r.overflow > 2) failures.push({ where, what: `pushes ${r.overflow}px sideways` });
        if (r.unnamedCount) failures.push({ where, what: `${r.unnamedCount} control(s) with no accessible name: ${r.unnamed.join(', ')}` });
        if (b.seen.errors.length) failures.push({ where, what: `console error: ${b.seen.errors[0]}` });
        if (b.seen.external.length) failures.push({ where, what: `reached outside its own origin: ${b.seen.external[0]}` });

        process.stdout.write(failures.some((f) => f.where === where) ? '✗' : '·');
      }
      process.stdout.write('\n');
    }
  }
}

b.close();

console.log(`\n  ${renders} renders`);
if (!failures.length) {
  console.log('\n  ✓ every department drew, in both themes and both languages, at both sizes\n');
  process.exit(0);
}

// Grouped, because one broken component appears once per combination and a flat
// list of two hundred lines hides that it is a single fault.
const byWhat = new Map();
for (const f of failures) {
  const key = f.what.replace(/\d+px/, 'Npx').replace(/\d+ control/, 'N control');
  if (!byWhat.has(key)) byWhat.set(key, []);
  byWhat.get(key).push(f.where);
}
console.log(`\n  ${failures.length} failure(s), ${byWhat.size} distinct:\n`);
for (const [what, wheres] of [...byWhat].sort((a, b2) => b2[1].length - a[1].length)) {
  console.log(`  ${wheres.length}×  ${what}`);
  for (const w of wheres.slice(0, 4)) console.log(`        ${w}`);
  if (wheres.length > 4) console.log(`        …and ${wheres.length - 4} more`);
}
console.log('');
process.exit(1);
