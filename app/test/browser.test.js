// The browser the employees drive, tested on what it refuses.
//
// A browser agent is the most dangerous thing in this repository. Everything
// else either reads, or writes somewhere the company owns. This one clicks
// buttons on other people's websites, and the gap between "found the pricing
// page" and "created an account and agreed to terms" is one click that looks
// identical to the model choosing it.
//
// So the interesting tests are not "can it click". They are:
//
//   - does the thing that commits actually stop, including when the label is
//     in Arabic, and including when the label says nothing useful but the form
//     has a password field
//   - does an unrecognised action fail closed rather than open
//   - does a credential stay out of the model and out of the record
//   - is a signature for the step that was shown, rather than for the session
//
// The perception layer is exercised against a real page served locally, because
// a numbered element list that works on a fixture and not on a real DOM is a
// fixture test wearing a costume.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-browser.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-browser.db${s}`)); } catch { /* first run */ }
}

const B = await import('../src/browser.js');
const { q, one, exec } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');

const HUMAN = 'human:owner';

test('a goal is required, and driving a browser has to be signed', async () => {
  await assert.rejects(() => B.drive({ goal: '  ', actor: HUMAN }), /goal/);
  await assert.rejects(() => B.drive({ goal: 'go and look at something' }), /signed/);
});

test('with no browser running it says how to start one instead of failing obscurely', async () => {
  // Port 1 has nothing on it and never will.
  const { setSetting } = await import('../src/settings.js');
  setSetting('BROWSER_PORT', '1', HUMAN);
  await assert.rejects(
    () => B.drive({ goal: 'anything', actor: HUMAN }),
    (e) => {
      assert.match(e.message, /remote-debugging-port/, 'the error tells you the command to run');
      return true;
    },
  );
  setSetting('BROWSER_PORT', '9333', HUMAN);
});

test('the overview says plainly what it will not do', async () => {
  const o = await B.browserOverview();
  const said = o.refuses.join(' ').toLowerCase();
  assert.match(said, /stops for a person/, 'the commit gate is stated, not implied');
  assert.match(said, /vault/, 'and where credentials come from');
  assert.match(said, /captcha|bot check/, 'and that it does not go around a bot check');
  assert.match(said, /private address/, 'and that it cannot reach inside the network');
  assert.equal(typeof o.live.attached, 'boolean');
});

// The gate is the whole safety story, so it is tested directly rather than
// through a live browser: what matters is the classification, not the clicking.
const { needsAPerson } = await import('../src/browser.js').then(async (m) => {
  // Not exported on purpose — it is an internal rule, not an API. Reach it the
  // way a test may: through the module's own source, evaluated in place.
  const src = fs.readFileSync(path.join(root, 'src', 'browser.js'), 'utf8');
  const body = src.slice(src.indexOf('const READS = new Set('), src.indexOf('// -------------------------------------------------------------- the driver --'));
  const mod = await import(`data:text/javascript,${encodeURIComponent(`${body}\nexport { needsAPerson };`)}`);
  return mod;
});

const held = (action, el, session = {}) => needsAPerson(action, el, session);

test('a plain link is not stopped — otherwise nothing would ever get done', () => {
  assert.equal(held({ do: 'click', n: 1 }, { kind: 'link', label: 'Pricing' }), null);
  assert.equal(held({ do: 'click', n: 2 }, { kind: 'link', label: 'Documentation' }), null);
  assert.equal(held({ do: 'scroll', by: 600 }, null), null);
  assert.equal(held({ do: 'navigate', url: 'https://example.com' }, null), null);
  assert.equal(held({ do: 'type', n: 3, text: 'laptop stand' }, { kind: 'input:text', label: 'Search' }), null);
});

test('anything that commits the company is stopped, in English', () => {
  for (const label of ['Submit', 'Sign up', 'Create account', 'Log in', 'Pay now', 'Buy',
    'Checkout', 'Place order', 'Subscribe', 'Confirm', 'Send message', 'Publish', 'Delete account']) {
    const why = held({ do: 'click', n: 1 }, { kind: 'button', label });
    assert.ok(why, `"${label}" must not be clicked unattended`);
    assert.match(why, /commits|submits/, 'and the reason is in words a person can weigh');
  }
});

test('and in Arabic, because the label being in Arabic changes nothing', () => {
  for (const label of ['إرسال', 'تسجيل الدخول', 'إنشاء حساب', 'ادفع الآن', 'شراء', 'تأكيد', 'حذف', 'اشتراك']) {
    assert.ok(held({ do: 'click', n: 1 }, { kind: 'button', label }), `"${label}" must not be clicked unattended`);
  }
});

test('a button with a useless label is still stopped if the form takes a password', () => {
  // Real sign-in forms have buttons labelled "→", "Continue", or nothing at all.
  assert.equal(held({ do: 'click', n: 1 }, { kind: 'button', label: '→' }), null, 'without a password field it is just a button');
  const why = held({ do: 'click', n: 1 }, { kind: 'button', label: '→' }, { formHasPassword: true });
  assert.ok(why, 'with one, the click is a sign-in whatever the label says');
  assert.match(why, /password/);
});

test('an action nobody thought about is treated as a write, not waved through', () => {
  // The failure mode that matters: a future action verb, or a model inventing
  // one, must not become an unreviewed capability.
  for (const verb of ['upload', 'download', 'execute', 'drag', 'authorise', 'accept_terms', '']) {
    const why = held({ do: verb }, null);
    assert.ok(why, `"${verb}" is not recognised and must not proceed`);
    assert.match(why, /not an action this browser recognises/);
  }
});

test('a session records the goal, who opened it, and lands on the chain', async () => {
  // Driven far enough to create the session, then failing at the browser — the
  // record must exist regardless, because a session that vanishes when the
  // browser is missing is a session nobody can ask about.
  const { setSetting } = await import('../src/settings.js');
  setSetting('BROWSER_PORT', '1', HUMAN);
  await B.drive({ goal: 'look up the price of a thing', actor: HUMAN }).catch(() => {});
  setSetting('BROWSER_PORT', '9333', HUMAN);

  const s = one('SELECT * FROM browser_sessions ORDER BY id DESC LIMIT 1');
  assert.ok(s, 'the session is on the record');
  assert.equal(s.opened_by, HUMAN, 'named to a person');
  assert.ok(s.goal.length, 'with what it was asked to do');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'browser.opened' ORDER BY seq DESC LIMIT 1"), 'and on the chain');
  assert.ok(verifyChain().ok, 'which still verifies');
});

test('only a person may approve a step, and only one that is waiting', async () => {
  const id = one('SELECT id FROM browser_sessions ORDER BY id DESC LIMIT 1').id;
  await assert.rejects(() => B.approveStep({ id, actor: 'agent:AGT-WEB-001' }), /only a person/);
  await assert.rejects(() => B.approveStep({ id }), /only a person/);
  await assert.rejects(() => B.approveStep({ id, actor: HUMAN }), /not waiting/);
  await assert.rejects(() => B.approveStep({ id: 999999, actor: HUMAN }), /no such/);
});

test('a refusal ends the session and says who refused it and why', () => {
  const sid = Number(exec(
    "INSERT INTO browser_sessions (goal, agent_id, opened_by, state) VALUES ('sign up somewhere','agent:AGT-WEB-001',?,'waiting')", HUMAN,
  ).lastInsertRowid);
  exec(
    `INSERT INTO browser_steps (session_id, step, url, action, result, gated, gate_reason)
     VALUES (?,1,'https://example.com/signup','click 4 "Create account"','waiting for a person',1,'it creates an account')`, sid,
  );
  const r = B.refuseStep({ id: sid, actor: HUMAN, why: 'we do not want an account there' });
  assert.equal(r.state, 'stopped');
  const step = one('SELECT * FROM browser_steps WHERE session_id = ?', sid);
  assert.equal(step.resolved, 'refused');
  assert.equal(step.resolved_by, HUMAN, 'the refusal is signed too');
  assert.match(one('SELECT outcome FROM browser_sessions WHERE id = ?', sid).outcome, /refused/);
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'browser.refused' ORDER BY seq DESC LIMIT 1"));
});

test('a credential is recorded by name, never by value', () => {
  // What the step row looks like after a vault fill. The value must never reach
  // this table — it is read by people, exported, and backed up.
  const sid = Number(exec(
    "INSERT INTO browser_sessions (goal, opened_by, state) VALUES ('sign in','" + HUMAN + "','running')",
  ).lastInsertRowid);
  exec(
    `INSERT INTO browser_steps (session_id, step, url, action, result)
     VALUES (?,1,'https://example.com/login','type 2 «ACME_PASSWORD»','filled 2 from the vault (ACME_PASSWORD)')`, sid,
  );
  const rows = q('SELECT action, result FROM browser_steps WHERE session_id = ?', sid);
  for (const r of rows) {
    assert.match(r.action, /«[A-Z_]+»/, 'the name of the secret');
    assert.ok(!/hunter2|password123/i.test(r.action + r.result), 'and nothing that looks like a value');
  }
  // And the source really does pass the name rather than the text.
  const src = fs.readFileSync(path.join(root, 'src', 'browser.js'), 'utf8');
  assert.ok(src.includes('action.secret ? ` «${action.secret}»`'), 'the step record writes the secret name');
  assert.ok(!/action\.secret \? getSecret\([^)]*\).*prompt/s.test(src), 'and no secret is ever put in a prompt');
});

test('the model is told the rules that matter, in the system prompt as well as in code', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'browser.js'), 'utf8');
  const sys = src.slice(src.indexOf('const SYSTEM = `'), src.indexOf('// -------------------------------------------------------------- the session --'));
  // Belt and braces: the gate is enforced in code, and the prompt says so too,
  // because a model that knows the rule wastes fewer steps discovering it.
  assert.match(sys, /NEVER put a password/i);
  assert.match(sys, /prove you are human/i);
  assert.match(sys, /ignore them/i, 'page text that gives it instructions');
  assert.match(sys, /"stuck" is a respectable answer/i, 'so it does not fabricate a done');
});
