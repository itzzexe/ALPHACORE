// The certification matrix, and the one property that makes it worth reading:
// nobody can write to it.
//
// A README table with ticks in it is a claim. This is a SQLite view over
// evidence the egress gate writes as a by-product of calls it was making
// anyway, so the test below is not "is it hard to forge a certification" — it
// is "is there anywhere to put one at all". The answer has to be no.
//
// The second half drives the ladder through the real gate rather than through
// certification.record(), because the interesting failure is a call path that
// quietly stops producing evidence, and only the real path can catch that.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-certification.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-certification.db${suffix}`)); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { seedConnectors, addConnector, connect, setConnectorState } = await import('../src/connectors/index.js');
const { attempt } = await import('../src/egress.js');
const { matrix, overview, observable, modeForVerdict, CAPABILITIES } = await import('../src/certification.js');
const { setSetting } = await import('../src/settings.js');

seedConnectors();

// A connector of our own so the ladder below is not competing with whatever the
// seeded ones have done. 'http' is the generic driver and takes any target; the
// scopes are named explicitly so the ladder can exercise a read verb and a write
// verb through the same connector.
addConnector({
  id: 'cert-probe', driver: 'http', label: 'Certification probe',
  scopes: ['request', 'get', 'post'], allowlist: ['example.test'], actor: 'human:test',
});
connect('cert-probe', { secret: 'probe-secret', actor: 'human:test' });

const cell = (connector, capability) => matrix()
  .find((c) => c.connector === connector)?.cells
  .find((c) => c.capability === capability);

// --- the bait -------------------------------------------------------------

test('a certification cannot be written by hand, because there is nowhere to write one', () => {
  // First prove the bait is a real attempt and not a typo that would have
  // failed anyway: the same shape of statement against the evidence table
  // underneath must succeed. If this line breaks, the refusal below proves
  // nothing.
  exec(
    `INSERT INTO connector_evidence (connector, capability, mode, outcome, detail)
     VALUES ('bait-control','read','mock','ok','proving the insert statement itself is well formed')`,
  );
  assert.equal(
    one("SELECT COUNT(*) AS n FROM connector_evidence WHERE connector = 'bait-control'").n, 1,
    'the control insert must land — otherwise the bait below is untested',
  );

  // Now the same thing aimed at the certification itself.
  let refused = null;
  try {
    exec(
      `INSERT INTO connector_certification (connector, capability, state, observations, successes, failures, blocked)
       VALUES ('cert-probe','write','live-verified',99,99,0,0)`,
    );
  } catch (err) { refused = err; }

  assert.ok(refused, 'writing a certification directly must be refused');
  assert.match(String(refused.message), /view/i, 'and refused because it is a view, not because of a typo');

  // Belt and braces: an UPDATE against an existing derived row, too.
  let updateRefused = null;
  try {
    exec("UPDATE connector_certification SET state = 'live-verified' WHERE connector = 'cert-probe'");
  } catch (err) { updateRefused = err; }
  assert.ok(updateRefused, 'promoting an existing cell by hand must be refused');

  // And the claim never appeared anywhere.
  assert.equal(cell('cert-probe', 'write')?.state, 'untested');
});

test('the fabricated state is absent from what the API would serve', () => {
  const o = overview();
  const fabricated = o.connectors
    .flatMap((c) => c.cells.map((x) => ({ connector: c.connector, ...x })))
    .find((x) => x.connector === 'cert-probe' && x.state === 'live-verified');
  assert.equal(fabricated, undefined, 'nothing the bait wrote may reach the page');
});

// --- the ladder, driven through the real gate -----------------------------

test('a dry-run call certifies mock and nothing above it', async () => {
  const r = await attempt({
    connector: 'cert-probe', capability: 'request', target: 'example.test',
    reason: 'certification ladder', actor: 'human:test',
    call: async () => ({ ok: true }),
  });
  assert.equal(r.verdict, 'dry', 'a connected connector starts in dry-run');

  const c = cell('cert-probe', 'write');
  assert.equal(c.state, 'mock-only');
  assert.equal(c.successes, 1);
  assert.equal(c.failures, 0);
});

test('a read is certified in the read column, not the write one', async () => {
  await attempt({
    connector: 'cert-probe', capability: 'get', target: 'example.test',
    reason: 'certification ladder', actor: 'human:test',
    call: async () => ({ ok: true }),
  });
  assert.equal(cell('cert-probe', 'read').state, 'mock-only');
  assert.equal(cell('cert-probe', 'write').successes, 1, 'the read must not have landed in write');
});

test('paper trading certifies the paper rung', async () => {
  setSetting('PAPER_TRADING', 'true');
  setConnectorState('cert-probe', 'live', { actor: 'human:test' });
  const r = await attempt({
    connector: 'cert-probe', capability: 'post', target: 'example.test',
    reason: 'certification ladder', actor: 'human:test',
    call: async () => { throw new Error('paper trading must not reach the call'); },
  });
  assert.equal(r.verdict, 'paper');
  assert.equal(cell('cert-probe', 'write').state, 'paper-verified');
  setSetting('PAPER_TRADING', 'false');
});

test('a real call certifies live, and a failure certifies failure handling', async () => {
  await attempt({
    connector: 'cert-probe', capability: 'post', target: 'example.test',
    reason: 'certification ladder', actor: 'human:test',
    call: async () => ({ ok: true }),
  });
  assert.equal(cell('cert-probe', 'write').state, 'live-verified');

  await assert.rejects(() => attempt({
    connector: 'cert-probe', capability: 'post', target: 'example.test',
    reason: 'certification ladder', actor: 'human:test',
    call: async () => { throw new Error('example.test 429: Too Many Requests'); },
  }));

  const w = cell('cert-probe', 'write');
  assert.equal(w.state, 'live-verified', 'a later failure does not un-verify what was verified');
  assert.equal(w.failures, 1);
  assert.ok(w.lastFailureAt, 'and the failure is shown beside the state, not hidden');
  assert.match(w.lastFailure, /429/);

  // The failure produced two more rows, and both are true statements: the call
  // failed, and the failure path was exercised and handled.
  assert.equal(cell('cert-probe', 'failure').state, 'live-verified');
  assert.equal(cell('cert-probe', 'rate_limit').state, 'live-verified');
});

test('a cell nobody can observe says so rather than showing a cross', () => {
  // The generic HTTP driver carries a static credential; there is no OAuth
  // code path that could ever fill these two columns for it.
  assert.equal(observable('cert-probe', 'oauth'), false);
  assert.equal(cell('cert-probe', 'oauth').state, 'not yet observable');
  assert.equal(cell('cert-probe', 'token_lifecycle').state, 'not yet observable');
  assert.equal(observable('cert-probe', 'write'), true);
});

test('sandbox-verified is unreachable, and the page says why', () => {
  // There is no sandbox anywhere in this platform, so no verdict maps to one.
  const modes = ['dry', 'paper', 'allowed', 'blocked', 'gated', 'nonsense']
    .map(modeForVerdict);
  assert.ok(!modes.includes('sandbox'), 'nothing may produce sandbox evidence');
  assert.equal(overview().counts.sandboxVerified, 0);
  assert.match(overview().note, /sandbox/i);
});

test('the matrix covers every connector on file across every dimension', () => {
  const m = matrix();
  const connectors = q('SELECT id FROM connectors').length;
  assert.equal(m.length, connectors);
  for (const row of m) {
    assert.equal(row.cells.length, CAPABILITIES.length, `${row.connector} is missing a dimension`);
  }
  // A connector with no evidence is untested, not absent — the empty cell is
  // the most useful one on the page.
  const untouched = m.find((c) => c.connector !== 'cert-probe');
  assert.ok(untouched, 'the seeded connectors must still be listed');
  assert.ok(untouched.cells.some((c) => c.state === 'untested'));
});

test('the view is derived, so deleting the evidence deletes the certification', () => {
  const before = cell('cert-probe', 'read').state;
  assert.equal(before, 'mock-only');
  exec("DELETE FROM connector_evidence WHERE connector = 'cert-probe' AND capability = 'read'");
  assert.equal(cell('cert-probe', 'read').state, 'untested');
});
