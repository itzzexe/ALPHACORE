// Things the company keeps doing without being asked again.
//
// The schedule is the boring part. The dangerous part is that a recurring job
// outlives the attention of whoever wrote it: it keeps firing for a year after
// the reason for it stopped being true, or it fails silently every hour while
// the dashboard stays green, or it quietly spends a month's budget in a night.
//
// So these tests are almost entirely about stopping: three strikes, the money
// running out, the expiry, and the fact that a schedule is not an authority —
// an order can only target work the company could already do, through the same
// gates it already has.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-standing.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-standing.db${s}`)); } catch { /* first run */ }
}

const S = await import('../src/standing.js');
const { q, one, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { verifyChain } = await import('../src/audit.js');

const HUMAN = 'human:owner';
const make = (over = {}) => S.createOrder({
  goal: 'Has any competitor changed their pricing?',
  kind: 'hunt', schedule: 'weekly', actor: HUMAN,
  reason: 'we were undercut twice without noticing', lifetimeUsd: 5, ...over,
});

test('an order has to be signed, explained, and aimed at something real', () => {
  assert.throws(() => make({ actor: undefined }), /signed/);
  // The reason is not paperwork. An order nobody can explain in six months is
  // an order nobody dares to delete, and those accumulate until the list is
  // useless.
  assert.throws(() => make({ reason: '' }), /why this should keep happening/);
  assert.throws(() => make({ goal: '   ' }), /goal/);
  assert.throws(() => make({ kind: 'launch-missiles' }), /an order is one of/);
  assert.throws(() => make({ schedule: 'every-tuesday-ish' }), /a schedule is one of/);
});

test('the kinds are a closed list of work the company can already do', () => {
  // An open list would make a scheduler into a new capability, quietly. Every
  // kind here routes to something that already exists and already has a gate.
  const kinds = Object.keys(S.KINDS);
  assert.deepEqual(kinds.sort(), ['bookkeep', 'browse', 'hunt', 'request']);
  for (const k of kinds) assert.equal(typeof S.KINDS[k].run, 'function');
  const src = fs.readFileSync(path.join(root, 'src', 'standing.js'), 'utf8');
  assert.match(src, /schedule, not an authority/i, 'and it is written down where it will be read');
});

test('a new order is scheduled, signed and on the chain', () => {
  const r = make();
  const o = one('SELECT * FROM standing_orders WHERE id = ?', r.id);
  assert.equal(o.owner, HUMAN);
  assert.equal(o.state, 'active');
  assert.ok(o.reason.length, 'the reason is kept, not just validated');
  assert.ok(o.next_due > new Date().toISOString(), 'it is due in the future, not immediately');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'standing.created' ORDER BY seq DESC LIMIT 1"));
  assert.ok(verifyChain().ok);
});

test('firing records what happened, what it cost, and when it is next due', async () => {
  const r = make({ goal: 'What is our own trial balance saying?' });
  const before = one('SELECT next_due FROM standing_orders WHERE id = ?', r.id).next_due;
  const f = await S.fireOrder(r.id, { manual: true, actor: HUMAN });
  assert.ok('ok' in f);
  const firings = q('SELECT * FROM standing_firings WHERE order_id = ?', r.id);
  assert.equal(firings.length, 1, 'the firing is kept whether it worked or not');
  assert.ok(firings[0].note, 'with what came of it, in words');
  assert.equal(firings[0].fired_by, HUMAN, 'and who fired it');
  const after = one('SELECT next_due, firings, last_fired FROM standing_orders WHERE id = ?', r.id);
  assert.equal(after.firings, 1);
  assert.ok(after.last_fired);
  assert.ok(after.next_due >= before, 'and it is rescheduled rather than firing again immediately');
});

test('three failures in a row and it turns itself off, with the reason on it', async () => {
  setSetting('BROWSER_PORT', '1', HUMAN);   // nothing is listening there, so browsing always fails
  const r = make({ kind: 'browse', schedule: 'hourly', goal: 'do the impossible' });

  for (let i = 1; i <= 2; i += 1) {
    await S.fireOrder(r.id, { manual: true, actor: HUMAN });
    const o = one('SELECT state, consecutive_failures FROM standing_orders WHERE id = ?', r.id);
    assert.equal(o.consecutive_failures, i);
    assert.equal(o.state, 'active', 'two strikes is not out');
  }
  await S.fireOrder(r.id, { manual: true, actor: HUMAN });
  const o = one('SELECT state, paused_reason FROM standing_orders WHERE id = ?', r.id);
  assert.equal(o.state, 'paused', 'a job that fails silently every hour is worse than no job');
  assert.match(o.paused_reason, /three times/, 'and it says why, so nobody has to dig');
  assert.ok(o.paused_reason.length > 30, 'including what the last failure actually said');

  // Paused means paused: the timer must not keep firing it.
  assert.deepEqual(await S.fireOrder(r.id), { skipped: 'paused' });
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'standing.gave_up' ORDER BY seq DESC LIMIT 1"));
  setSetting('BROWSER_PORT', '9333', HUMAN);
});

test('resuming clears the strikes, or it would turn itself off again at once', () => {
  const paused = one("SELECT id FROM standing_orders WHERE state = 'paused' ORDER BY id DESC LIMIT 1");
  assert.throws(() => S.resumeOrder({ id: paused.id }), /signed/);
  S.resumeOrder({ id: paused.id, actor: HUMAN });
  const o = one('SELECT state, consecutive_failures, paused_reason FROM standing_orders WHERE id = ?', paused.id);
  assert.equal(o.state, 'active');
  assert.equal(o.consecutive_failures, 0, 'otherwise the next single failure is its third');
  assert.equal(o.paused_reason, null);
});

test('an order cannot outlive its allowance', async () => {
  const r = make({ lifetimeUsd: 2 });
  exec('UPDATE standing_orders SET spent_usd = 2 WHERE id = ?', r.id);
  const f = await S.fireOrder(r.id, { manual: true, actor: HUMAN });
  assert.deepEqual(f, { skipped: 'out of money' });
  const o = one('SELECT state, paused_reason FROM standing_orders WHERE id = ?', r.id);
  assert.equal(o.state, 'paused');
  assert.match(o.paused_reason, /allowance/);
  assert.equal(q('SELECT id FROM standing_firings WHERE order_id = ?', r.id).length, 0, 'and it did not run');
});

test('the tick fires what is due, retires what has expired, and does not stampede', async () => {
  // Everything so far is scheduled in the future; make three due now.
  const ids = [make({ goal: 'due one' }), make({ goal: 'due two' }), make({ goal: 'due three' }), make({ goal: 'due four' })].map((r) => r.id);
  exec(`UPDATE standing_orders SET next_due = datetime('now','-1 hour') WHERE id IN (${ids.join(',')})`);

  const r = await S.tick({ limit: 3 });
  assert.equal(r.fired.length, 3, 'three at a time, not everything at once — ten orders each able to start a model chain is a way to spend a month in a minute');
  const stillDue = one(`SELECT COUNT(*) AS n FROM standing_orders WHERE id IN (${ids.join(',')}) AND next_due <= datetime('now')`).n;
  assert.equal(stillDue, 1, 'the fourth waits for the next tick');

  const gone = make({ goal: 'already over', expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const r2 = await S.tick({ limit: 1 });
  assert.ok(r2.expired >= 1, 'an order past its expiry retires itself rather than being skipped forever');
  assert.equal(one('SELECT state FROM standing_orders WHERE id = ?', gone.id).state, 'expired');
});

test('an expired or deleted order never fires again', async () => {
  const r = make({ goal: 'delete me' });
  assert.throws(() => S.deleteOrder({ id: r.id }), /signed/);
  S.deleteOrder({ id: r.id, actor: HUMAN });
  assert.equal(one('SELECT state FROM standing_orders WHERE id = ?', r.id).state, 'deleted');
  assert.deepEqual(await S.fireOrder(r.id), { skipped: 'deleted' });
  // And it leaves the list a person reads, without leaving the record.
  assert.ok(!S.ordersList({}).some((o) => o.id === r.id));
  assert.ok(S.ordersList({ includeDeleted: true }).some((o) => o.id === r.id));
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'standing.deleted' ORDER BY seq DESC LIMIT 1"));
});

test('the overview says what an order can and cannot do', () => {
  const o = S.standingOverview();
  assert.ok(o.orders.length);
  assert.equal(typeof o.active, 'number');
  assert.match(o.inherits, /schedule, not an authority/i);
  assert.match(o.inherits, /stops at the click that commits/i, 'the browser gate is named specifically');
  assert.ok(o.kinds.length === 4 && o.schedules.length === 4);
  assert.ok(verifyChain().ok, 'and the whole session is still on an intact chain');
});
