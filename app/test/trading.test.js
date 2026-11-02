// The trading floor.
//
// The arithmetic is checked against the day-trader skill's own worked example
// (TSLA on 2026-10-19: entry 364.18, range 354.47–362.18, stop 358.32, eight
// shares on a $50 limit, nine refused). The desk is then run through a whole
// session on a tape this file writes: the range forms, a bar closes above it,
// the plan is replayed, sized, checked and filed; only a person's approval
// fills it; the target leg closes it; two losses stop the floor for the day.
// Nothing here reaches the network — the tape is handed in through `feed`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-trading.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-trading-memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 21).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-trading.db${suffix}`)); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors, callConnector } = await import('../src/connectors/index.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const clock = await import('../src/trading/clock.js');
const M = await import('../src/trading/math.js');
const T = await import('../src/trading.js');
const portfolio = await import('../src/portfolio.js');
const { sectionCatalog, surfaceAudit, connectivityAudit } = await import('../src/links.js');

seedAgents();
seedConnectors();
const ME = 'human:owner';

async function drain() {
  for (let i = 0; i < 20; i++) { const run = leaseNext(); if (!run) return; await executeRun(run); }
}

// ------------------------------------------------------------------ clock --

test('New York time is worked out without the machine’s zone, holidays and early closes included', () => {
  // 10:15 in New York on 19 October 2026 is daylight time: 14:15 UTC.
  assert.equal(clock.nyToUtc('2026-10-19', '10:15').toISOString(), '2026-10-19T14:15:00.000Z');
  // After the first Sunday of November it is standard time again.
  assert.equal(clock.nyToUtc('2026-11-02', '09:30').toISOString(), '2026-11-02T14:30:00.000Z');
  assert.equal(clock.toNY(new Date('2026-03-08T06:59:00Z')).hhmm, '01:59');
  assert.equal(clock.toNY(new Date('2026-03-08T07:00:00Z')).hhmm, '03:00');
  assert.equal(clock.session('2026-11-26').trading, false, 'Thanksgiving');
  assert.equal(clock.session('2026-11-27').close, 13 * 60, 'the day after closes at one');
  assert.equal(clock.session('2026-10-17').why, 'weekend');
  assert.equal(clock.session('2031-05-05').known, false, 'a year nobody wrote down is unknown, not guessed');

  const open = clock.deskClock(clock.nyToUtc('2026-10-19', '10:00'));
  assert.equal(open.state, 'open');
  assert.equal(open.canEnter, true);
  assert.equal(clock.deskClock(clock.nyToUtc('2026-10-19', '09:40')).canEnter, false, 'no entries before 09:45');
  assert.equal(clock.deskClock(clock.nyToUtc('2026-10-19', '15:56')).mustBeFlat, true);
  // On an early close the afternoon limits move up by three hours.
  const early = clock.deskClock(clock.nyToUtc('2026-11-27', '12:40'));
  assert.equal(early.window.to, '12:30');
  assert.equal(early.window.flatBy, '12:55');
  assert.equal(early.canEnter, false);
  assert.equal(early.mustBeFlat, false);
  assert.equal(clock.deskClock(clock.nyToUtc('2026-11-26', '11:00')).nextOpen, '2026-11-27 09:30');
});

// ------------------------------------------------------------------- math --

test('the exit plan reproduces the skill’s TSLA example to the cent', () => {
  const p = M.planExit({ entry: 364.18, orHigh: 362.18, orLow: 354.47, stopRule: 'or-mid', target: '1R' });
  assert.equal(p.ok, true);
  assert.equal(p.stop, 358.32, 'the midpoint 358.325 rounds down, away from the entry');
  assert.equal(p.riskShare, 5.86);
  assert.equal(p.target, 370.04);
  assert.equal(M.planExit({ entry: 364.18, orHigh: 362.18, orLow: 354.47 }).target, 375.90, '2R by default');
  assert.match(M.planExit({ entry: 100, stopRule: 'price:100.5' }).why, /not below the entry/);
  assert.match(M.planExit({ entry: 100, stopRule: 'price:99.99' }).why, /too tight/);
  assert.match(M.planExit({ entry: 100, stopRule: 'pct:1', target: 'price:99' }).why, /not above/);
});

test('the size is the smallest of four limits, and says which one bound it', () => {
  const cfg = { maxLossUsd: 50, riskPct: 100, maxPositionPct: 75, maxOrderUsd: 4000, cashBufferPct: 10 };
  const s = M.size({ entry: 364.18, stop: 358.32, equity: 5000, cash: 5000, cfg });
  assert.equal(s.qty, 8, 'floor(50 / 5.86) = 8');
  assert.equal(s.bound, 'max loss a trade');
  const big = M.size({ entry: 364.18, stop: 363.18, equity: 5000, cash: 5000, cfg });
  assert.equal(big.qty, 10);
  assert.equal(big.bound, 'largest position', 'a tight stop is capped by the position limit, 3750 / 364.18');
});

const CFG = { maxLossUsd: 50, riskPct: 100, maxDailyLossPct: 3, maxTradesDay: 3, maxConsecLosses: 2, minRR: 1, maxPositionPct: 75, maxOrderUsd: 4000, minOrderUsd: 5, cashBufferPct: 10, blocked: [], requireEdge: true, pdtGuard: false };
const CTX = (over = {}) => ({ equity: 5000, cash: 5000, realizedTodayUsd: 0, openRiskUsd: 0, tradesToday: 0, lossStreakToday: 0, openSymbols: [], dayTrades5: 0, clock: { canEnter: true, window: { from: '09:45', to: '15:30' }, state: 'open' }, priceFresh: true, ...over });

test('the risk check passes eight TSLA and blocks nine, as the skill does', () => {
  const order = { symbol: 'TSLA', qty: 8, entry: 364.18, stop: 358.32, target: 370.04 };
  assert.equal(M.riskChecks(order, CFG, CTX()).ok, true);
  const nine = M.riskChecks({ ...order, qty: 9 }, CFG, CTX());
  assert.equal(nine.ok, false);
  assert.match(nine.checks.find((c) => c.name === 'loss-per-trade').why, /52\.74/);
});

test('the day’s losses count before the next trade is allowed', () => {
  const order = { symbol: 'TSLA', qty: 8, entry: 364.18, stop: 358.32, target: 370.04 };
  const after = M.riskChecks(order, CFG, CTX({ realizedTodayUsd: -120 }));
  assert.equal(after.checks.find((c) => c.name === 'daily-loss').ok, false, '120 lost + 46.88 at risk is over 150');
  assert.equal(M.riskChecks(order, CFG, CTX({ lossStreakToday: 2 })).checks.find((c) => c.name === 'tilt').ok, false);
  assert.equal(M.riskChecks(order, CFG, CTX({ openSymbols: ['TSLA'] })).checks.find((c) => c.name === 'duplicate').ok, false);
  assert.equal(M.riskChecks({ ...order, side: 'sell' }, CFG, CTX()).checks.find((c) => c.name === 'long-only').ok, false);
  const late = M.riskChecks(order, CFG, CTX({ clock: { canEnter: false, window: { from: '09:45', to: '15:30' }, state: 'open' } }));
  assert.equal(late.checks.find((c) => c.name === 'entry-window').ok, false);
  // No edge in either the replays or the rule's past: refused with requireEdge, warned without.
  const flat = { tm: { avgR: -0.2 }, history: { n: 12, expectancy: -0.1 } };
  assert.equal(M.riskChecks(order, CFG, CTX(flat)).ok, false);
  assert.equal(M.riskChecks(order, { ...CFG, requireEdge: false }, CTX(flat)).ok, true);
});

const bar = (min, o, h, l, c, v = 1000) => ({ min, o, h, l, c, v });

test('the trigger wants a closed bar above the level — not a wick, not a tie, not before 09:45', () => {
  const range = [bar(570, 10, 10.5, 9.8, 10.2), bar(575, 10.2, 10.6, 10.1, 10.4), bar(580, 10.4, 10.5, 10.2, 10.3)];
  const or = M.openingRange(range);
  assert.deepEqual([or.high, or.low], [10.6, 9.8]);
  const wick = [...range, bar(585, 10.3, 10.9, 10.3, 10.55)];
  assert.equal(M.trigger(wick, { level: 10.6, nowMin: 600 }).status, 'waiting');
  const tie = [...range, bar(585, 10.3, 10.7, 10.3, 10.6)];
  assert.equal(M.trigger(tie, { level: 10.6, nowMin: 600 }).status, 'waiting');
  const go = [...range, bar(585, 10.3, 10.8, 10.3, 10.7)];
  const tr = M.trigger(go, { level: 10.6, nowMin: 600 });
  assert.equal(tr.status, 'triggered');
  assert.equal(tr.at, 590, 'the 09:45 bar is a 09:50 entry');
  assert.equal(M.trigger(go, { level: 10.6, nowMin: 589 }).status, 'waiting', 'a bar still forming does not count');
  assert.equal(M.trigger(go, { level: 10.6, fromMin: 595, nowMin: 600 }).status, 'waiting');
  // With a volume rule, a breakout on thin volume is passed over.
  assert.equal(M.trigger(go, { level: 10.6, nowMin: 600, minVolumeX: 2, rangeVolume: 1000 }).status, 'waiting');
});

test('the Time Machine is repeatable, checks the stop first, and reads its own verdict', () => {
  const up = { full: true, bars: Array.from({ length: 78 }, (_, i) => bar(570 + 5 * i, 100 + i * 0.1, 100 + i * 0.1 + 0.2, 100 + i * 0.1 - 0.02, 100 + (i + 1) * 0.1)) };
  const pool = M.buildPool(Array.from({ length: 20 }, () => up));
  const a = M.simulate(pool, { entry: 100, stop: 99, target: 101, k: 3, last: 76, replays: 500, seed: 7 });
  const b = M.simulate(pool, { entry: 100, stop: 99, target: 101, k: 3, last: 76, replays: 500, seed: 7 });
  assert.deepEqual(a, b, 'the same seed replays the same way');
  assert.equal(a.pTarget, 1);
  assert.equal(M.verdict(a).head, 'strongly toward the target');
  // A bar that touches both levels is the loss.
  const both = { full: true, bars: Array.from({ length: 78 }, (_, i) => bar(570 + 5 * i, 100, 102, 98, 100)) };
  const c = M.simulate(M.buildPool([both]), { entry: 100, stop: 99, target: 101, k: 3, last: 76, replays: 200 });
  assert.equal(c.pStop, 1);
  assert.equal(M.verdict({ pTarget: 0.28, pStop: 0.32, pNeither: 0.40, avgR: 0, rAtTarget: 2 }).head, 'leans toward the target', 'at 2R a third is break-even');
  assert.equal(M.verdict({ pTarget: 0.49, pStop: 0.51, pNeither: 0, avgR: 0, rAtTarget: 1 }).head, 'close to a coin flip');
});

test('the daily setups match the skill’s rules and say nothing about buying', () => {
  const closes = [...Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 2), 110];
  const s = M.dailySetups(closes);
  assert.ok(s.tags.includes('breakout_20d'));
  assert.equal(M.dailySetups(closes.slice(0, 20)), null, 'thirty closes or nothing');
  const st = M.stats([2, -1, -1, 2, -1]);
  assert.equal(st.n, 5);
  assert.equal(st.expectancy, 0.2);
  assert.equal(st.profitFactor, 1.33);
  assert.equal(st.maxLosingStreak, 2);
});

// --------------------------------------------------------------- the desk --

const DAY = '2026-10-19';
const at = (hhmm) => clock.nyToUtc(DAY, hhmm);
const ts = (day, min) => Math.floor(clock.nyToUtc(day, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`).getTime() / 1000);

/** Sixty quiet past sessions that drift up after the range, and today's tape up to `until`. */
function tape(today, { drift = 0.02 } = {}) {
  const days = [];
  const d = new Date(`${DAY}T12:00:00Z`);
  while (days.length < 60) { d.setUTCDate(d.getUTCDate() - 1); const k = d.toISOString().slice(0, 10); if (clock.session(k).trading && clock.session(k).close === 960) days.unshift(k); }
  const bars = [];
  for (const day of days) {
    let p = 100;
    for (let i = 0; i < 78; i++) {
      // A range, a bar that closes above it, then the drift decides.
      const o = p; p = o + (i < 3 ? (i === 1 ? 0.3 : -0.1) : i === 3 ? 0.4 : drift);
      bars.push({ t: ts(day, 570 + 5 * i), o, h: Math.max(o, p) + 0.05, l: Math.min(o, p) - 0.05, c: p, v: 1000 });
    }
  }
  for (const b of today) bars.push({ t: ts(DAY, b.min), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 1000 });
  return bars;
}
const TODAY = [bar(570, 50, 50.4, 49.8, 50.2), bar(575, 50.2, 50.6, 50.1, 50.4), bar(580, 50.4, 50.5, 50.2, 50.3), bar(585, 50.3, 50.9, 50.3, 50.8)];
let todayBars = TODAY;
let drift = 0.02;
T.feed.intraday = async () => ({ source: 'test', bars: tape(todayBars, { drift }) });
const quote = (s, price) => exec(`INSERT INTO mkt_quotes (symbol, price, source, fetched_at) VALUES (?, ?, 'simulated', datetime('now'))
  ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at`, s, price);

test('a whole trade: watched, triggered, replayed, sized, checked, filed — and only a person’s yes fills it', async () => {
  setSetting('TR_RISK_PCT', 0.5);
  const p = T.watch({ symbol: 'NVDA', why: 'test', actor: ME, now: at('09:20') });
  assert.equal(p.state, 'watching');
  assert.equal(p.day, DAY);
  assert.ok(one("SELECT symbol FROM mkt_watch WHERE symbol = 'NVDA'"), 'the markets desk prices it');
  await assert.rejects(async () => T.watch({ symbol: 'NVDA', actor: ME, now: at('09:21') }), /already/);
  assert.throws(() => T.watch({ symbol: 'not a ticker', actor: ME }), /US share/);

  // Before the range is complete, nothing.
  todayBars = TODAY.slice(0, 2); T.clearBarCache();
  assert.equal((await T.evaluate(p.id, { now: at('09:42') })).state, 'watching');
  // The 09:45 bar closes above 50.6 at 09:50.
  todayBars = TODAY; T.clearBarCache();
  quote('NVDA', 50.8);
  const armed = await T.evaluate(p.id, { now: at('09:51') });
  assert.equal(armed.state, 'proposed', armed.note);
  assert.equal(armed.or_high, 50.6);
  assert.equal(armed.entry, 50.8);
  assert.equal(armed.stop, 50.2, 'the midpoint of 50.6 and 49.8');
  assert.equal(armed.target, 52, '2R');
  assert.ok(armed.qty > 0);
  assert.ok(armed.tm.replays > 0 && armed.tm.verdict.head, 'replayed before anyone is asked');
  assert.ok(armed.history.n >= 50, 'the rule replayed through the past sessions');
  assert.ok(armed.checks.checks.every((c) => c.ok || c.level === 'warn'));
  const order = portfolio.getOrder(armed.order_id);
  assert.equal(order.state, 'proposed');
  assert.equal(order.stop_price, 50.2, 'the stop travels with the entry');
  assert.equal(order.take_profit, 52);
  assert.equal(order.order_type, 'limit');
  assert.ok(order.limit_price <= 50.8 * 1.0016, 'the desk does not chase');
  assert.equal(order.proposed_by, 'agent:AGT-TRD-001');

  // Nobody but a person fills it.
  await assert.rejects(() => portfolio.approve({ id: order.id, actor: 'agent:AGT-TRD-001' }), /only a person/);
  await T.monitor({ now: at('09:52') });
  assert.equal(T.getPlan(p.id).state, 'proposed');
  const ok = await portfolio.approve({ id: order.id, actor: ME });
  assert.equal(ok.state, 'filled', 'the limit is above the price, so it fills');
  await T.monitor({ now: at('09:53') });
  const open = T.getPlan(p.id);
  assert.equal(open.state, 'open');

  // A later bar reaches the target: the leg the person approved with the entry closes it.
  todayBars = [...TODAY, bar(590, 50.8, 51.2, 50.7, 51.1), bar(595, 51.1, 52.1, 51, 51.9)]; T.clearBarCache();
  await T.monitor({ now: at('10:01') });
  const closed = T.getPlan(p.id);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.exit_reason, 'target');
  assert.equal(closed.exit_price, 52);
  // The paper limit fills at its limit, a few basis points over the trigger, so the win is a little under 2R.
  assert.ok(closed.r_result > 1.8 && closed.r_result <= 2, `${closed.r_result}R`);
  assert.ok(closed.pnl > 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM pf_positions WHERE symbol = 'NVDA'").n, 0, 'flat');
  const leg = portfolio.getOrder(closed.exit_order_id);
  assert.equal(leg.decided_by, ME, 'the leg carries the person who approved the entry');
});

test('a gap through the stop fills at the open, and two losses stop the floor for the day', async () => {
  for (const [sym, n] of [['AMD', 1], ['MU', 2]]) {
    todayBars = TODAY; T.clearBarCache();
    quote(sym, 50.8);
    const p = T.watch({ symbol: sym, actor: ME, now: at('09:30') });
    const armed = await T.evaluate(p.id, { now: at('09:51') });
    assert.equal(armed.state, 'proposed', armed.note);
    await portfolio.approve({ id: armed.order_id, actor: ME });
    await T.monitor({ now: at('09:52') });
    todayBars = [...TODAY, bar(590, 50.8, 50.9, 50.5, 50.6), bar(595, 50.6, 50.7, 50.4, 50.5), bar(600, 50.5, 50.6, 50.3, 50.35), bar(605, 49.9, 50, 49.5, 49.7)]; T.clearBarCache();
    await T.monitor({ now: at('10:11') });
    const c = T.getPlan(p.id);
    assert.equal(c.state, 'closed', `trade ${n}`);
    assert.equal(c.exit_reason, 'stop');
    assert.ok(c.exit_price < 50.2, 'the bar opened under the stop, so the fill is under it too');
    assert.ok(c.r_result < -1);
  }
  const h = T.halted(DAY);
  assert.equal(h.halted, true);
  assert.equal(h.by, 'breaker');
  todayBars = TODAY; T.clearBarCache();
  quote('META', 50.8);
  const p = T.watch({ symbol: 'META', actor: ME, now: at('10:00') });
  const refused = await T.evaluate(p.id, { now: at('10:01') });
  assert.equal(refused.state, 'refused');
  assert.ok(refused.checks.checks.some((c) => c.name === 'halt' && !c.ok));
  assert.throws(() => T.resume({ actor: 'agent:AGT-TRD-001' }), /a person/);
  T.resume({ actor: ME });
  assert.equal(T.halted(DAY).halted, false);
});

test('a plan with no edge is refused before anyone is asked', async () => {
  drift = -0.02; todayBars = TODAY; T.clearBarCache();
  exec("UPDATE tr_plans SET state = 'cancelled' WHERE state = 'closed'"); // the breaker counts today's losses
  quote('INTC', 50.8);
  const p = T.watch({ symbol: 'INTC', actor: ME, now: at('09:30') });
  const r = await T.evaluate(p.id, { now: at('09:51') });
  assert.equal(r.state, 'refused');
  assert.ok(r.checks.checks.some((c) => c.name === 'edge' && !c.ok), JSON.stringify(r.checks.checks.filter((c) => !c.ok)));
  assert.equal(r.order_id, null, 'nothing was filed');
  drift = 0.02;
});

test('an entry nobody approved before the window closed is withdrawn by the desk that proposed it', async () => {
  todayBars = TODAY; T.clearBarCache();
  quote('AAPL', 50.8);
  const p = T.watch({ symbol: 'AAPL', actor: ME, now: at('09:30') });
  const armed = await T.evaluate(p.id, { now: at('09:51') });
  assert.equal(armed.state, 'proposed', armed.note);
  await T.monitor({ now: at('15:31') });
  assert.equal(T.getPlan(p.id).state, 'cancelled');
  assert.equal(portfolio.getOrder(armed.order_id).state, 'cancelled');
  assert.throws(() => portfolio.withdraw({ id: armed.order_id, actor: 'agent:AGT-INV-001' }), /only whoever proposed/);
});

test('an open paper trade is closed at the flat-by time, win or lose', async () => {
  todayBars = TODAY; T.clearBarCache();
  quote('MSFT', 50.8);
  const p = T.watch({ symbol: 'MSFT', actor: ME, now: at('09:30') });
  const armed = await T.evaluate(p.id, { now: at('09:51') });
  await portfolio.approve({ id: armed.order_id, actor: ME });
  await T.monitor({ now: at('09:52') });
  todayBars = [...TODAY, bar(590, 50.8, 51, 50.5, 50.9)]; T.clearBarCache();
  await T.monitor({ now: at('15:56') });
  const c = T.getPlan(p.id);
  assert.equal(c.state, 'closed');
  assert.equal(c.exit_reason, 'flat');
});

test('a person closes a trade by hand; an agent cannot', async () => {
  todayBars = TODAY; T.clearBarCache();
  quote('GOOGL', 50.8);
  const p = T.watch({ symbol: 'GOOGL', actor: ME, now: at('09:30') });
  const armed = await T.evaluate(p.id, { now: at('09:51') });
  await portfolio.approve({ id: armed.order_id, actor: ME });
  await T.monitor({ now: at('09:52') });
  await assert.rejects(() => T.flatten({ id: p.id, actor: 'agent:AGT-TRD-001' }), /a person/);
  const c = await T.flatten({ id: p.id, actor: ME, now: at('09:55') });
  assert.equal(c.state, 'closed');
  assert.equal(c.exit_reason, 'manual');
});

test('the scan, the morning plan and the review: the agent picks what to watch and nothing else', async () => {
  T.feed.intraday = null;
  const s = await T.scanDaily({ actor: ME });
  assert.equal(s.source, 'simulated');
  assert.ok(s.scanned > 50);
  const note = T.requestGameplan({ actor: ME, now: at('08:40') });
  await drain();
  T.syncNotes({ now: at('08:41') });
  const ready = one('SELECT * FROM tr_notes WHERE id = ?', note.id);
  assert.equal(ready.state, 'ready');
  assert.match(ready.summary, /\[mock\]/);
  assert.equal(one("SELECT COUNT(*) AS n FROM tr_plans WHERE created_by = 'agent:AGT-TRD-001'").n, 0, 'mock conviction is under the autopilot’s bar');
  const rv = T.requestReview({ actor: ME, day: DAY });
  await drain();
  T.syncNotes();
  assert.equal(one('SELECT state FROM tr_notes WHERE id = ?', rv.id).state, 'ready');
});

test('the desk’s rules are a person’s, and can only be tighter than the portfolio’s', () => {
  assert.throws(() => T.setConfig({ riskPct: 1, actor: 'agent:AGT-TRD-001' }), /a person/);
  assert.throws(() => T.setConfig({ riskPct: 50, actor: ME }), /between/);
  assert.throws(() => T.setConfig({ noEntriesBefore: '15:40', actor: ME }), /window/);
  T.setConfig({ noEntriesBefore: '09:45', actor: ME });
  const c = T.setConfig({ maxPositionPct: 90, minRR: 2, stopRule: 'atr:1.5', actor: ME });
  assert.equal(c.maxPositionPct, portfolio.limits().maxPositionPct, 'never looser than the portfolio');
  assert.equal(c.minRR, 2);
  assert.equal(c.stopRule, 'atr:1.5');
});

test('a broker close is held at the gate for an agent, like any order', async () => {
  exec("UPDATE connectors SET state = 'live' WHERE id = 'broker'");
  const r = await callConnector({ connector: 'broker', capability: 'position.close', agentId: 'AGT-TRD-001', force: true, args: { symbol: 'AAPL', estValue: 1 } });
  assert.notEqual(r.verdict, 'allowed');
  exec("UPDATE connectors SET state = 'disconnected' WHERE id = 'broker'");
});

test('the overview reads the board, the journal and the record without touching the network', () => {
  const o = T.overview({ now: at('16:30') });
  assert.equal(o.source, 'simulated');
  assert.ok(o.stats.n >= 2);
  assert.ok(o.journal.length >= 2);
  assert.ok(o.bySetup.find((b) => b.key === 'orb'));
  assert.match(o.note, /not financial advice/);
});

test('the floor is in the catalogue, behind a door, joined to something, with its keys', () => {
  assert.ok(sectionCatalog().map((s) => s.id).includes('trading'));
  assert.deepEqual(surfaceAudit().unfiled, []);
  const c = connectivityAudit();
  assert.ok(!c.orphans.some((o) => o.id === 'trading'));
  assert.deepEqual(c.dangling, []);
  for (const p of ['trading.view', 'trading.manage', 'trading.configure']) assert.ok(PERMS.includes(p), p);
  assert.ok(expandTemplate('finance').includes('trading.configure'));
  assert.ok(!expandTemplate('operator').includes('trading.configure'), 'the operator trades but does not set the limits');
});

test('the chain still verifies after all of it', () => {
  assert.equal(verifyChain().ok, true);
  for (const a of ['trading.watching', 'trading.armed', 'trading.opened', 'trading.closed', 'trading.breaker', 'trading.refused', 'portfolio.bracket_leg', 'portfolio.withdrawn']) {
    assert.ok(one('SELECT seq FROM audit_log WHERE action = ? LIMIT 1', a), a);
  }
  assert.ok(q("SELECT seq FROM audit_log WHERE action = 'portfolio.approved' AND actor_id = ?", ME).length >= 5);
});
