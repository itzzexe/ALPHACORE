// Does every department work, or does it merely render?
//
// `npm run sweep` answers "did the page draw", which is a lower bar than it
// sounds: a page that draws an empty state, with no endpoint behind it and no
// action that does anything, passes it. A review of this repository put the
// concern exactly right — a system with 156 departments and a test suite that
// runs in mock mode invites the suspicion that some of those departments are
// pages and tables rather than capabilities.
//
// So this opens every department in a real browser and records what is actually
// there: how many API calls it made, how much of the page is content rather
// than chrome, whether every panel is an empty state, and whether anything
// errored. Then it separates the two things that look identical on a screen:
//
//   **empty**  nothing has been created yet. Honest on a fresh install, and the
//              write path works when you use it.
//   **hollow** nothing behind it at all — no call, no rows, no action. A page
//              pretending to be a capability.
//
// It cannot tell those apart by looking, so it does not guess: a department
// with no API call at all is reported as hollow, and everything else is
// reported with its numbers so a person can judge. The one thing it will not do
// is call a page working because it rendered.
//
//   node scripts/depth.mjs --port=8484 --user=owner --pass=…
//   node scripts/depth.mjs --json=depth.json      # the full table
import fs from 'node:fs';
import process from 'node:process';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = arg('port', process.env.PORT || '8484');
const CDP = arg('cdp', '9333');
const BASE = `http://127.0.0.1:${PORT}`;
const USER = arg('user', 'owner');
const PASS = arg('pass', process.env.SWEEP_PASSWORD || '');
const JSON_OUT = arg('json', '');
const ONLY = arg('only', '').split(',').filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- the harness --

const rpc = (ws, id, method, params = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${method} did not answer`)), 30_000);
  const onMsg = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    clearTimeout(timer);
    ws.removeEventListener('message', onMsg);
    resolve(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id, method, params }));
});

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!login.token) {
    console.error(`\n  Could not sign in as ${USER}. Pass --pass=… or set SWEEP_PASSWORD.\n`);
    process.exit(2);
  }
  const token = login.token;

  const map = await fetch(`${BASE}/api/map`, { headers: { 'x-auth-token': token } }).then((r) => r.json());
  let depts = map.sections.filter((s) => String(s.href || '').startsWith('#/'));
  if (ONLY.length) depts = depts.filter((d) => ONLY.includes(d.id));

  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  } catch {
    console.error(`\n  No browser on port ${CDP}. Start one with:\n    chrome --headless=new --remote-debugging-port=${CDP} about:blank\n`);
    process.exit(2);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));

  let id = 1;
  await rpc(ws, id++, 'Page.enable');
  await rpc(ws, id++, 'Runtime.enable');
  await rpc(ws, id++, 'Log.enable');
  await rpc(ws, id++, 'Network.enable');

  let calls = [];
  let errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/')) {
      calls.push(m.params.request.url.replace(BASE, ''));
    }
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/') && m.params.response.status >= 400) {
      errors.push(`${m.params.response.status} ${m.params.response.url.replace(BASE, '')}`);
    }
    // The local antivirus injects a script into every page on some machines.
    // That is this machine, not the application.
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/kaspersky/i.test(m.params.entry.text)) {
      errors.push(m.params.entry.text.slice(0, 130));
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.text || '').slice(0, 130));
  });
  const ev = async (e) => (await rpc(ws, id++, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await rpc(ws, id++, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await rpc(ws, id++, 'Page.navigate', { url: BASE });
  await sleep(2000);
  await ev(`localStorage.setItem('alphacore-token', ${JSON.stringify(token)}); localStorage.setItem('alphacore-lang','en')`);
  await rpc(ws, id++, 'Page.navigate', { url: BASE });
  await sleep(5000);

  console.log(`\n  Opening ${depts.length} departments against ${BASE}\n`);

  const rows = [];
  for (const d of depts) {
    const route = String(d.href).replace('#/', '');
    calls = [];
    errors = [];
    await ev(`location.hash = ${JSON.stringify(`/${route}`)}`);
    // Wait for the render rather than guessing at it.
    for (let i = 0; i < 26; i += 1) {
      await sleep(140);
      if (await ev(`document.getElementById('view').innerText.trim().length > 30`)) break;
    }
    await sleep(400);

    const shape = JSON.parse(await ev(`(() => {
      const v = document.getElementById('view');
      const txt = v.innerText.trim();
      return JSON.stringify({
        text: txt.length,
        rows: v.querySelectorAll('tbody tr').length,
        controls: v.querySelectorAll('button, input, select, textarea').length,
        empties: v.querySelectorAll('.empty').length,
        panels: v.querySelectorAll('.panel').length,
      });
    })()`));

    const uniqueCalls = [...new Set(calls)];
    rows.push({
      id: d.id,
      route,
      ...shape,
      calls: uniqueCalls.length,
      endpoints: uniqueCalls,
      errors: [...new Set(errors)],
      // A page that fetched nothing has nothing behind it. Everything else is
      // reported with its numbers rather than graded.
      hollow: uniqueCalls.length === 0,
      bare: shape.text < 120 && shape.rows === 0,
    });
    process.stdout.write(rows[rows.length - 1].errors.length ? '✗' : (rows[rows.length - 1].hollow ? '·' : '✓'));
  }
  console.log('\n');

  const hollow = rows.filter((r) => r.hollow);
  const errored = rows.filter((r) => r.errors.length);
  const bare = rows.filter((r) => r.bare && !r.hollow);

  console.log(`  ${rows.length} departments`);
  console.log(`  ${rows.length - hollow.length} call at least one endpoint`);
  console.log(`  ${rows.length - errored.length} raise no error`);
  console.log(`  ${bare.length} are bare — empty on this database, with a working page behind them`);

  const show = (label, list, fmt) => {
    if (!list.length) return;
    console.log(`\n  ${label}`);
    for (const r of list.slice(0, 30)) console.log(`    ${r.id.padEnd(16)} ${fmt(r)}`);
    if (list.length > 30) console.log(`    …and ${list.length - 30} more`);
  };
  show('HOLLOW — no endpoint behind the page', hollow, (r) => `${r.panels} panel(s), ${r.controls} control(s)`);
  show('ERRORED', errored, (r) => r.errors.join(' | ').slice(0, 100));
  show('BARE — nothing created yet on this database', bare, (r) => `${r.calls} endpoint(s): ${r.endpoints.slice(0, 2).join(' ')}`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
    console.log(`\n  Full table written to ${JSON_OUT}`);
  }

  // Bare is not a failure. Hollow and errored are.
  const failed = hollow.length + errored.length;
  console.log(failed
    ? `\n  ${failed} department(s) are not backed by anything that works.\n`
    : '\n  Every department is backed by a live endpoint and raises no error.\n');
  ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
