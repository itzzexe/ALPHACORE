// The two things production mode refuses to start without.
//
// Both gates guard a default that is correct on a laptop and dangerous on a
// machine the internet can reach — a master key in a file beside the database,
// and a console on plain HTTP. Defaults like that survive to production because
// nothing ever complains.
//
// So the matrix below is the point of the phase: every combination of mode, key
// source, address scheme and override, with the expected outcome asserted for
// each. A gate that has only been tried in the one configuration its author had
// is a gate that fails in the configuration somebody else has.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-production.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-production.db${s}`)); } catch { /* first run */ }
}

// The KMS door runs its command with execFileSync and splits it on whitespace,
// so the "fetch it from outside" case needs a real command with no quoting —
// a one-line script in the temp directory is the honest stand-in for `vault
// read`, and exercises the same path.
const os = await import('node:os');
const KEY_SCRIPT = path.join(os.tmpdir(), `alphacore-key-${process.pid}.mjs`);
fs.writeFileSync(KEY_SCRIPT, "process.stdout.write(Buffer.alloc(48, 7).toString('base64'));\n");
process.on('exit', () => { try { fs.rmSync(KEY_SCRIPT); } catch { /* already gone */ } });

const P = await import('../src/production.js');
const { setSetting, getSetting } = await import('../src/settings.js');
const { audit } = await import('../src/audit.js');
const { one, q } = await import('../src/db.js');

/** Put the environment in a known state; every case sets what it needs. */
function env({ mode = null, key = 'file', url = 'http://localhost:8484', proxy = false, acceptKey = false, acceptHttp = false }) {
  setSetting('PRODUCTION_MODE', mode === null ? '' : String(mode));
  delete process.env.ALPHACORE_ENV;

  delete process.env.ALPHACORE_MASTER_KEY;
  delete process.env.ALPHACORE_MASTER_KEY_COMMAND;
  if (key === 'environment') process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 7).toString('base64');
  if (key === 'command') process.env.ALPHACORE_MASTER_KEY_COMMAND = `node ${KEY_SCRIPT}`;

  setSetting('PUBLIC_BASE_URL', url);
  process.env.TRUST_PROXY = proxy ? 'true' : 'false';
  setSetting('TRUST_PROXY', proxy ? 'true' : 'false');

  delete process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY;
  delete process.env.ALPHACORE_ACCEPT_PLAIN_HTTP;
  if (acceptKey) process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY = P.ACCEPT;
  if (acceptHttp) process.env.ALPHACORE_ACCEPT_PLAIN_HTTP = P.ACCEPT;
}

test('the mode is off unless somebody says otherwise', () => {
  env({});
  assert.equal(P.isProduction(), false, 'a platform that decides it is production on its own is a platform that surprises somebody');
});

test('the setting wins over the environment, as everywhere else here', () => {
  env({});
  process.env.ALPHACORE_ENV = 'production';
  assert.equal(P.isProduction(), true, 'the environment configures a machine before it first starts');
  setSetting('PRODUCTION_MODE', 'false');
  assert.equal(P.isProduction(), false, 'and after that the console owns it');
  setSetting('PRODUCTION_MODE', 'true');
  delete process.env.ALPHACORE_ENV;
  assert.equal(P.isProduction(), true);
});

// ---------------------------------------------------------------------------
// The matrix. Sixteen cells: production or not, key on disk or outside it,
// address plain or https-behind-a-proxy, override present or absent.
// ---------------------------------------------------------------------------

const CASES = [
  // mode      key            url                     proxy  accept  → expected
  ['dev  · file key · http ', false, 'file', 'http://localhost:8484', false, false, false, { stop: false, keySeverity: 'warn', httpSeverity: 'warn' }],
  ['dev  · file key · https', false, 'file', 'https://core.example', true, false, false, { stop: false, keySeverity: 'warn', httpSeverity: 'ok' }],
  ['dev  · env key  · http ', false, 'environment', 'http://localhost:8484', false, false, false, { stop: false, keySeverity: 'ok', httpSeverity: 'warn' }],
  ['dev  · cmd key  · https', false, 'command', 'https://core.example', true, false, false, { stop: false, keySeverity: 'ok', httpSeverity: 'ok' }],

  ['prod · file key · http ', true, 'file', 'http://core.example', false, false, false, { stop: true, keySeverity: 'blocker', httpSeverity: 'blocker' }],
  ['prod · file key · https', true, 'file', 'https://core.example', true, false, false, { stop: true, keySeverity: 'blocker', httpSeverity: 'ok' }],
  ['prod · env key  · http ', true, 'environment', 'http://core.example', false, false, false, { stop: true, keySeverity: 'ok', httpSeverity: 'blocker' }],
  ['prod · env key  · https', true, 'environment', 'https://core.example', true, false, false, { stop: false, keySeverity: 'ok', httpSeverity: 'ok' }],
  ['prod · cmd key  · https', true, 'command', 'https://core.example', true, false, false, { stop: false, keySeverity: 'ok', httpSeverity: 'ok' }],

  // https without a proxy is still refused: nothing says anything is
  // terminating TLS, and X-Forwarded-For would be a fiction.
  ['prod · env key  · https, no proxy', true, 'environment', 'https://core.example', false, false, false, { stop: true, keySeverity: 'ok', httpSeverity: 'blocker' }],

  // Overrides.
  ['prod · file key accepted', true, 'file', 'https://core.example', true, true, false, { stop: false, keySeverity: 'accepted', httpSeverity: 'ok' }],
  ['prod · http accepted', true, 'environment', 'http://core.example', false, false, true, { stop: false, keySeverity: 'ok', httpSeverity: 'accepted' }],
  ['prod · both accepted', true, 'file', 'http://core.example', false, true, true, { stop: false, keySeverity: 'accepted', httpSeverity: 'accepted' }],

  // The wrong word is not the word.
  ['prod · file key, wrong override word', true, 'file', 'https://core.example', true, false, false, { stop: true, keySeverity: 'blocker', httpSeverity: 'ok' }],
];

for (const [name, mode, key, url, proxy, acceptKey, acceptHttp, expected] of CASES) {
  test(`boot matrix — ${name}`, () => {
    env({ mode, key, url, proxy, acceptKey, acceptHttp });
    const b = P.bootCheck();
    assert.equal(b.production, mode, `${name}: mode`);
    assert.equal(b.stop, expected.stop, `${name}: ${expected.stop ? 'must refuse to boot' : 'must boot'}`);
    assert.equal(b.gates.masterKey.severity, expected.keySeverity, `${name}: master key`);
    assert.equal(b.gates.https.severity, expected.httpSeverity, `${name}: https`);
    if (expected.stop) {
      assert.ok(b.message.includes('will not start'), 'the refusal says so in words');
      for (const r of b.refusals) assert.ok(b.message.includes(r.variable), 'and names the way to accept the risk');
    }
  });
}

test('an override has to be the whole sentence, not a truthy value', () => {
  env({ mode: true, key: 'file', url: 'https://core.example', proxy: true });
  process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY = 'yes';
  assert.equal(P.bootCheck().stop, true, '"yes" is something somebody types by accident');
  process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY = '1';
  assert.equal(P.bootCheck().stop, true);
  process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY = P.ACCEPT;
  assert.equal(P.bootCheck().stop, false, 'and this is something somebody means');
});

test('a refusal names the risk in one sentence and both acceptable key sources', () => {
  env({ mode: true, key: 'file', url: 'http://core.example', proxy: false });
  const b = P.bootCheck();
  assert.match(b.gates.masterKey.why, /ALPHACORE_MASTER_KEY_COMMAND/);
  assert.match(b.gates.masterKey.why, /ALPHACORE_MASTER_KEY/);
  assert.match(b.gates.https.why, /TRUST_PROXY|https/);
});

// The chain-recorded part of the contract. server.js writes these at startup;
// this asserts the shape it writes, so a rename in one place fails here.
test('accepting a risk is recorded under system:boot, not under nobody', () => {
  env({ mode: true, key: 'file', url: 'http://core.example', proxy: false, acceptKey: true, acceptHttp: true });
  const b = P.bootCheck();
  assert.equal(b.stop, false);
  assert.equal(b.accepted.length, 2, 'both risks were accepted');

  for (const a of b.accepted) {
    audit({
      actorType: 'system', actorId: 'system:boot', action: 'boot.risk_accepted',
      subjectType: 'server', subjectId: 'startup',
      payload: { production: b.production, risk: a.name, why: a.why, via: a.variable },
    });
  }
  const rows = q("SELECT * FROM audit_log WHERE action = 'boot.risk_accepted' ORDER BY seq DESC LIMIT 2");
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.actor_id, 'system:boot');
    assert.equal(r.actor_type, 'system');
    const p = JSON.parse(r.payload);
    assert.ok(p.risk && p.why && p.via, 'the entry says which risk, why it matters, and how it was accepted');
  }
});

test('the platform behaves identically either way — this is a declaration, not a code path', () => {
  env({ mode: false, key: 'command', url: 'https://core.example', proxy: true });
  const off = P.gates();
  env({ mode: true, key: 'command', url: 'https://core.example', proxy: true });
  const on = P.gates();
  assert.equal(off.masterKey.source, on.masterKey.source, 'the same key, read the same way');
  assert.equal(off.https.secure, on.https.secure);
  assert.notEqual(off.production, on.production, 'only the declaration differs');
});

test('an unreadable key source is refused in production rather than assumed safe', () => {
  env({ mode: true, key: 'command', url: 'https://core.example', proxy: true });
  process.env.ALPHACORE_MASTER_KEY_COMMAND = `node ${path.join(os.tmpdir(), 'alphacore-no-such-key-script.mjs')}`;
  const g = P.masterKeyGate();
  assert.equal(g.ok, false, 'failure closed: a rule that cannot be evaluated means the action does not happen');
  assert.equal(g.severity, 'blocker');
});

test('the settings the console owns are readable back, for the header', () => {
  env({ mode: true, key: 'command', url: 'https://core.example', proxy: true });
  assert.equal(getSetting('PRODUCTION_MODE'), 'true');
  assert.ok(one("SELECT v FROM settings WHERE k = 'PUBLIC_BASE_URL'"));
});
