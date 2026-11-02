// The gold desk.
//
// The models are checked on series whose answer is known (a ramp continues,
// a stretched price comes back, an AR(1) is recovered); the learning on the
// simulated tape with its planted pattern, where the desk has to find the
// autoregression and put its weight there; the grading against prices this
// file controls; the paper book and its stops; and the gates — a bot that
// only a person switches on, a feed only a person arms. Nothing reaches the
// network: the clock is handed in, and the simulated tape is the only feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-gold.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-gold-memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 31).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-gold.db${suffix}`)); } catch { /* first run */ }
}

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const M = await import('../src/gold/models.js');
const G = await import('../src/gold.js');
const { parseSwissquote } = await import('../src/connectors/goldfeed.js');
const { simulatedBars } = await import('../src/markets.js');
const { sectionCatalog, surfaceAudit, connectivityAudit } = await import('../src/links.js');

seedAgents();
seedConnectors();
const ME = 'human:owner';
const T0 = Date.parse('2026-11-02T10:00:00Z');
let now = T0;
async function run(seconds) { for (let i = 0; i < seconds; i++) { now += 1000; await G.goldTick({ now }); } }

// ----------------------------------------------------------------- models --

test('each model does what its name says on a series whose answer is known', () => {
  const ramp = Array.from({ length: 600 }, (_, i) => 100 + i * 0.01);
  assert.equal(M.predict('naive', ramp, 30), ramp.at(-1));
  const mom = M.predict('momentum', ramp, 30, { lookback: 60, damp: 1 });
  assert.ok(Math.abs(mom - (ramp.at(-1) + 0.3)) < 1e-6, 'a straight line continues');
  // A slope is extrapolated no further than the window it was measured on.
  assert.ok(Math.abs(M.predict('momentum', ramp, 3600, { lookback: 60, damp: 1 }) - (ramp.at(-1) + 0.6)) < 1e-6);
  const stretched = [...Array(600).fill(100), 101];
  const mr = M.predict('meanrev', stretched, 300, { window: 300, speed: 0.5 });
  assert.ok(mr < 101 && mr > 100, 'a stretched price is pulled back toward its average');
  // AR(1) with φ = 0.5 is recovered from its returns.
  let r = 0; let a = 1; const rets = [];
  const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  for (let i = 0; i < 6000; i++) { r = 0.5 * r + (rnd() - 0.5) * 1e-4; rets.push(r); }
  const phi = M.fitAR(rets, 1);
  assert.ok(Math.abs(phi[0] - 0.5) < 0.05, `φ ≈ 0.5, got ${phi[0]}`);
});

test('the ensemble’s weights move toward the model that is right, and never to zero', () => {
  let s = {};
  for (let i = 0; i < 200; i++) s = M.hedge(s, { naive: 1, drift: 1, momentum: 1, meanrev: 1, ar: 0.2 });
  assert.ok(s.weights.ar > 0.6, `ar ${s.weights.ar}`);
  assert.ok(s.weights.naive >= 0.015, 'a floor, so a model can come back');
  assert.ok(Math.abs(Object.values(s.weights).reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.equal(M.normWeights({}).naive, 2 / 6, '“no change” starts with a third');
});

test('a model that said nothing in a round is charged the round’s average, not let off', () => {
  let s = {};
  for (let i = 0; i < 100; i++) s = M.hedge(s, { naive: 1, drift: 1, momentum: 1, meanrev: 1, ar: 1 });
  assert.ok(Math.abs(s.weights.holt - s.weights.ar) < 1e-9, 'silent models end level with the rest');

  // An install upgraded mid-run: five models with a long record, two new ones with none.
  const old = { loss: { naive: 180, drift: 200, momentum: 210, meanrev: 205, ar: 175 }, n: 5000 };
  const up = M.hedge(old, { naive: 1, drift: 1, momentum: 1, meanrev: 1, ar: 1, holt: 1, learn: 1 });
  assert.ok(up.weights.learn < up.weights.ar && up.weights.holt < up.weights.ar, `newcomers ${up.weights.learn} do not outweigh the best ${up.weights.ar}`);
});

test('the damped trend carries a ramp forward, and the learner finds a pattern planted in the tape', () => {
  const ramp = Array.from({ length: 900 }, (_, i) => 100 + i * 0.01);
  const h = M.predict('holt', ramp, 30, M.DEFAULT_PARAMS.holt);
  assert.ok(h > ramp.at(-1) && h < ramp.at(-1) + 0.31, `holt ${h}`);

  // Returns that lean on the one before (φ = 0.4). One second out the pattern is
  // worth about 6% of the error; by five seconds it is too small for the mean
  // error to show even for the true model, so the learner is held to one second.
  let x = 4000; let r = 0; let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const xs = [];
  for (let i = 0; i < 4200; i++) { const z = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()); r = 0.4 * r + 1e-4 * z; x *= Math.exp(r); xs.push(x); }
  const naive = M.walkForward(xs, 'naive', {}, 1, { start: 1900 });
  const learn = M.walkForward(xs, 'learn', M.DEFAULT_PARAMS.learn, 1, { start: 1900 });
  assert.ok(learn.mae < naive.mae * 0.96, `learner ${learn.mae} vs naive ${naive.mae}`);
  assert.ok(learn.hit > 0.57, `direction ${learn.hit}`);
  const fs = M.forecastAll(xs, { horizons: [5, 60] });
  assert.ok(fs.every((f) => Number.isFinite(f.preds.learn) && Number.isFinite(f.preds.holt)));
});

test('a chance is what happened when the desk said it, and never falls as the raw number rises', () => {
  let c = null;
  // The raw number says 75% up; the market goes up half the time.
  for (let i = 0; i < 2000; i++) c = M.pcalUpdate(c, 0.75, i % 2 === 0);
  assert.ok(Math.abs(M.pcalApply(c, 0.75) - 0.5) < 0.05, `calibrated ${M.pcalApply(c, 0.75)}`);
  // Untouched bins lean on the raw number.
  assert.equal(M.pcalApply(c, 0.15), 0.15);
  // A bin that disagrees with its neighbour is pooled so the curve rises.
  let d = null;
  for (let i = 0; i < 400; i++) { d = M.pcalUpdate(d, 0.55, i % 10 < 7); d = M.pcalUpdate(d, 0.65, i % 10 < 4); }
  const curve = M.pcalCurve(d);
  assert.ok(curve[5].rate <= curve[6].rate + 1e-12);
  assert.equal(M.reliability(d).length, 10);
});

test('advice says buy or sell only when every condition holds, and names the one that does not', () => {
  const f = { horizon: 60, ens: 4002, base: 4000, sigma: 0.8, pUp: 0.7, k80: 1.28, low80: 4001, high80: 4003 };
  const A = { n: 500, skillPct: 3, hitRate: 0.56 };
  const a = M.advise(f, { bid: 3999.9, ask: 4000.1, record: A, trend: 'up', equity: 100000, riskPct: 0.5 });
  assert.equal(a.action, 'buy');
  assert.equal(a.grade, 'A');
  assert.ok(a.stop < a.entry && a.entry < a.target, `${a.stop} < ${a.entry} < ${a.target}`);
  assert.ok(Math.abs(a.oz * (a.entry - a.stop) - 500) < 2, 'risks half a percent of the book to the stop');
  assert.ok(a.ev > 0 && a.rr > 0);

  assert.deepEqual(M.advise(f, { bid: 3999.9, ask: 4000.1, record: { n: 50, skillPct: -1, hitRate: 0.49 }, trend: 'up' }).why, ['unproven']);
  assert.ok(M.advise({ ...f, pUp: 0.6 }, { bid: 3999.9, ask: 4000.1, record: A, trend: 'down' }).why.includes('against-trend'));
  assert.ok(M.advise({ ...f, ens: 4000.05 }, { bid: 3999.9, ask: 4000.1, record: A }).why.includes('no-edge'));
  assert.ok(M.advise({ ...f, pUp: 0.52 }, { bid: 3999.9, ask: 4000.1, record: A }).why.includes('unsure'));
  // Seventy percent right, but the target pays 0.5 and the stop costs 2.66: a losing bracket.
  const thin = M.advise({ ...f, ens: 4000.6, sigma: 2 }, { bid: 3999.9, ask: 4000.1, record: A, trend: 'up' });
  assert.deepEqual(thin.why, ['negative-ev']);
  assert.ok(thin.bracket < 0);
  const sell = M.advise({ ...f, ens: 3998.6, pUp: 0.3 }, { bid: 3999.9, ask: 4000.1, record: A, trend: 'down' });
  assert.equal(sell.action, 'sell');
  assert.ok(sell.stop > sell.entry && sell.entry > sell.target);
  assert.deepEqual(M.verdict([sell, a]).action, 'buy', 'the larger edge per minute held wins');
  assert.equal(M.verdict([{ action: 'wait' }]).action, 'wait');
});

test('a signal is settled by whichever of its target and stop the tape reaches first, or by the clock', () => {
  const sig = { made_at: 10_000, horizon: 30, side: 'buy', entry: 100.1, stop: 99, target: 101, spread: 0.2 };
  const up = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1);
  assert.equal(M.settle(sig, up, 0, { now: 60_000 }).outcome, 'target');
  const down = Array.from({ length: 60 }, (_, i) => 100 - i * 0.1);
  assert.equal(M.settle(sig, down, 0, { now: 60_000 }).outcome, 'stop');
  const flat = Array.from({ length: 60 }, () => 100.3);
  assert.equal(M.settle(sig, flat, 0, { now: 30_000 }), null, 'still running');
  const t = M.settle(sig, flat, 0, { now: 60_000 });
  assert.equal(t.outcome, 'time');
  assert.equal(t.exit, 100.2, 'closed at the bid');
});

test('the bands are re-fitted to the errors actually made', () => {
  const errs = Array.from({ length: 1000 }, (_, i) => ((i % 100) / 100) * 3);
  const c = M.calibrate(errs);
  assert.ok(Math.abs(c.k80 - 2.4) < 0.05);
  assert.ok(Math.abs(c.k95 - 2.85) < 0.05);
  assert.equal(M.calibrate([1, 2]), null, 'thirty errors or nothing');
});

test('a grade is per model, with direction and band, and skill is measured against no change', () => {
  const g = M.grade({ base: 100, sigma: 1, ens: 101, low80: 99, high80: 102, low95: 98, high95: 103, preds: { naive: 100, drift: 99, momentum: 101.5, meanrev: 100.2, ar: 100 } }, 101.2);
  assert.equal(g.hit.ens, 1);
  assert.equal(g.hit.drift, 0);
  assert.equal(g.hit.naive, null, 'no change makes no call on the direction');
  assert.equal(g.inside80, 1);
  const s = M.scoreOf({ n: 10, sae: 5, sse: 3, sape: 0.0005, hits: 6, dir_n: 10, inside80: 8, inside95: 10 }, 1);
  assert.equal(s.skillPct, 50);
  assert.equal(s.hitRate, 0.6);
  assert.equal(s.accuracyPct, 99.995);
  assert.equal(s.coverage80, 0.8);
});

test('ticks become a one-second grid, candles and indicators', () => {
  const ticks = [{ ts: 1000, mid: 1 }, { ts: 3500, mid: 2 }, { ts: 3900, mid: 3 }, { ts: 6100, mid: 4 }];
  assert.deepEqual(M.resample(ticks).xs, [1, 1, 3, 3, 3, 4]);
  const cs = M.candles(ticks, 5);
  assert.equal(cs.length, 2);
  assert.deepEqual([cs[0].o, cs[0].h, cs[0].l, cs[0].c, cs[0].ticks], [1, 3, 1, 3, 3]);
  const many = Array.from({ length: 300 }, (_, i) => ({ ts: i * 1000, mid: 100 + Math.sin(i / 10) + i * 0.01 }));
  const summary = M.technicalSummary(M.candles(many, 1, 300));
  assert.ok(['strong buy', 'buy', 'neutral', 'sell', 'strong sell'].includes(summary.verdict.all));
  assert.ok(summary.oscillators.length >= 6 && summary.movingAverages.length >= 10);
});

test('the dealing desk’s quote is read for its tightest spread', () => {
  const q1 = parseSwissquote([{ ts: 5, spreadProfilePrices: [{ bid: 4000, ask: 4001 }, { bid: 4000.2, ask: 4000.5 }] }, { ts: 6, spreadProfilePrices: [{ bid: 0, ask: 1 }] }]);
  assert.deepEqual([q1.bid, q1.ask], [4000.2, 4000.5]);
  assert.equal(parseSwissquote('nonsense'), null);
});

// --------------------------------------------------------------- the desk --

test('the desk forecasts every horizon, writes it down first, and grades it when its moment comes', async () => {
  setSetting('GD_SIM_AR', 0.45);
  await G.goldTick({ now });
  assert.ok(G.seriesOf('XAU', now).xs.length >= 3600, 'an hour of simulated tape to start from');
  assert.equal(G.source(), 'simulated');
  await run(240);
  const made = one('SELECT COUNT(*) AS n FROM gold_preds').n;
  const graded = one('SELECT COUNT(*) AS n FROM gold_preds WHERE actual IS NOT NULL').n;
  assert.ok(made > 150 && graded > 100, `${made} made, ${graded} graded`);
  const p = one('SELECT * FROM gold_preds WHERE actual IS NOT NULL AND horizon = 30 ORDER BY id LIMIT 1');
  assert.ok(p.due_at === p.made_at + 30_000);
  assert.ok(p.low95 <= p.low80 && p.low80 <= p.ens && p.ens <= p.high80 && p.high80 <= p.high95, 'bands nest');
  assert.ok(Math.abs(p.err - (p.ens - p.actual)) < 1e-9);
  const board = G.scoreboard({ days: 1 });
  const s5 = board.find((h) => h.horizon === 5);
  for (const m of ['naive', 'drift', 'momentum', 'meanrev', 'ar', 'ens']) assert.ok(s5.models[m]?.n > 20, m);
  assert.equal(s5.models.naive.skillPct, null, 'no change is the yardstick, not a contestant');
});

test('on a tape with a pattern in it, the desk finds the pattern and puts its weight there', async () => {
  await run(900);
  const s5 = G.scoreboard({ days: 1 }).find((h) => h.horizon === 5);
  assert.ok(s5.models.ar.skillPct > 0, `the autoregression beats no change: ${s5.models.ar.skillPct}%`);
  const top = Object.entries(s5.weights).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'ar', JSON.stringify(s5.weights));
  assert.ok(s5.calib?.k80 > 0, 'the band has been re-fitted');
  assert.ok(one("SELECT COUNT(*) AS n FROM gold_learning WHERE kind IN ('tune','calibrate')").n > 0, 'learning is written down');
  assert.ok(G.learningCurve({ horizon: 5, now }).length >= 1);
});

test('a restart forgets nothing it learned', async () => {
  const before = G.scoreboard({ days: 1 }).find((h) => h.horizon === 5).weights.ar;
  G._restart();
  const after = G.scoreboard({ days: 1 }).find((h) => h.horizon === 5).weights.ar;
  assert.ok(Math.abs(before - after) < 1e-9);
  await run(5);
});

test('any moment can be asked about, is answered by the right model, and is graded when it comes', async () => {
  const soon = G.ask({ at: now + 90_000, actor: ME, now });
  assert.match(soon.method, /ensemble/);
  assert.ok(soon.low95 < soon.expected && soon.expected < soon.high95);
  assert.equal(soon.record.horizon, 60);
  for (const b of simulatedBars('GC=F')) exec("INSERT OR IGNORE INTO mkt_bars (symbol, day, close, source) VALUES ('GC=F', ?, ?, 'simulated')", b.day, b.close);
  const far = G.ask({ at: new Date(now + 30 * 86400_000).toISOString(), actor: ME, now });
  assert.match(far.method, /daily model/);
  assert.ok(far.high80 - far.low80 > soon.high80 - soon.low80, 'a month out is less certain than a minute and a half');
  assert.throws(() => G.ask({ at: now - 1000, actor: ME, now }), /passed/);
  assert.throws(() => G.ask({ at: 'tomorrow-ish', actor: ME, now }), /date and time/);
  assert.throws(() => G.ask({ at: now + 400 * 86400_000, actor: ME, now }), /year/);
  await run(95);
  const graded = one('SELECT * FROM gold_asks WHERE id = ?', soon.id);
  assert.ok(graded.actual > 0 && graded.err != null);
});

test('the paper book: a person trades, the stops are the other side of the spread, and nobody but a person opens by hand', async () => {
  const qt = G.quote();
  assert.ok(qt.ask > qt.bid);
  assert.throws(() => G.openTrade({ side: 'buy', oz: 1, actor: 'agent:AGT-GLD-001' }), /a person/);
  assert.throws(() => G.openTrade({ side: 'buy', oz: 1, sl: qt.ask + 5, actor: ME }), /below/);
  assert.throws(() => G.openTrade({ side: 'sell', oz: 1, tp: qt.bid + 5, actor: ME }), /below/);
  assert.throws(() => G.openTrade({ side: 'buy', oz: 999, actor: ME }), /margin/);
  const t1 = G.openTrade({ side: 'buy', oz: 2, actor: ME, now });
  assert.equal(t1.open_price, qt.ask, 'a buy pays the ask');
  const c1 = G.closeTrade({ id: t1.id, actor: ME, now });
  assert.equal(c1.close_price, G.quote().bid, 'and sells at the bid');
  assert.ok(Math.abs(c1.pnl - (c1.close_price - c1.open_price) * 2) < 0.01);
  // A stop a hair under the market is hit within seconds on a moving tape.
  const t2 = G.openTrade({ side: 'buy', oz: 1, sl: G.quote().bid - 0.05, tp: G.quote().ask + 0.05, actor: ME, now });
  await run(60);
  const c2 = one('SELECT * FROM gold_trades WHERE id = ?', t2.id);
  assert.equal(c2.state, 'closed');
  assert.ok(['sl', 'tp'].includes(c2.close_reason));
  const t3 = G.openTrade({ side: 'sell', oz: 1, expiresIn: 3, actor: ME, now });
  await run(4);
  assert.equal(one('SELECT close_reason FROM gold_trades WHERE id = ?', t3.id).close_reason, 'expiry');
  const acc = G.account();
  assert.ok(Math.abs(acc.cash - (100_000 + q("SELECT pnl FROM gold_trades WHERE state = 'closed'").reduce((s, x) => s + x.pnl, 0))) < 0.01);
});

test('the bot trades paper only, and only once a person switches it on', async () => {
  assert.equal(G.config().bot, false);
  await run(30);
  assert.equal(one("SELECT COUNT(*) AS n FROM gold_trades WHERE source = 'bot'").n, 0);
  assert.throws(() => G.setBot({ on: true, actor: 'agent:AGT-GLD-001' }), /a person/);
  G.setConfig({ botEdgeX: 0, botMinP: 0.5, botHorizon: 15, actor: ME });
  G.setBot({ on: true, actor: ME });
  await run(60);
  const bots = q("SELECT * FROM gold_trades WHERE source = 'bot'");
  assert.ok(bots.length >= 2, `${bots.length} bot trades`);
  assert.ok(bots.filter((b) => b.state === 'closed').every((b) => ['expiry', 'sl'].includes(b.close_reason)));
  G.setBot({ on: false, actor: ME });
  assert.equal(one("SELECT COUNT(*) AS n FROM gold_trades WHERE source = 'bot' AND state = 'open'").n, 0, 'switching off closes what it held');
});

test('the simulator replays the strategy after the spread, and scores every model on the same moments', () => {
  const r = G.backtest({ minutes: 60, horizon: 15, edgeX: 0.5, minP: 0.5, oz: 5, actor: ME, now });
  assert.ok(r.strategy.trades > 0);
  assert.ok(Math.abs(r.strategy.spreadCost - r.strategy.trades * r.spread * 5) < 0.05);
  for (const m of M.MODELS) assert.ok(r.models[m].n > 50, m);
  assert.ok(r.models.ar.skillPct > -5);
  assert.throws(() => G.backtest({ horizon: 7, actor: ME, now }), /horizon/);
});

test('the overview and the screen read without touching the network', () => {
  const l = G.live({ tf: '5s', now });
  assert.ok(l.candles.length > 50);
  assert.ok(l.ind.rsi.length === l.candles.length);
  assert.ok(l.tech?.verdict);
  assert.equal(l.forecasts.length, 7);
  assert.ok(l.tape.length > 0 && l.xau && l.xag && l.ratio > 10);
  const o = G.overview({ now });
  assert.ok(o.today.length === 7 && o.week.length === 7);
  assert.match(o.note, /not financial advice/);
});

test('the screen keeps its finished candles, re-reads only the one forming, and draws with the periods a person chose', async () => {
  G.live({ tf: '30s', bars: 60, now });
  await run(75);
  const kept = G.live({ tf: '30s', bars: 60, now });
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const fresh = M.candles(q("SELECT ts, mid, bid, ask FROM gold_ticks WHERE sym = 'XAU' AND ts >= ? ORDER BY ts", now - 30 * 500 * 1000), 30, 500).slice(-60);
  assert.deepEqual(kept.candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.ticks]), fresh.map((c) => [c.t, r3(c.o), r3(c.h), r3(c.l), r3(c.c), c.ticks]));

  const p = G.live({ tf: '5s', bars: 40, p: { ema: '5,10,20', bb: '10,1.5', rsi: '7', macd: '26,12,9' }, now });
  assert.deepEqual(p.params.ema, [5, 10, 20]);
  assert.deepEqual(p.params.bb, [10, 1.5]);
  assert.equal(p.params.rsi, 7);
  assert.deepEqual(p.params.macd, [12, 26, 9], 'a fast average slower than the slow one is refused');
  assert.equal(p.candles.length, 40);
  assert.equal(p.ind.ema.length, 3);
  assert.ok(p.ind.ema.every((e) => e.length === 40));
  assert.ok(p.ind.ema[2].every((v) => v != null), 'computed over the kept candles, so warm from the first one shown');

  assert.equal(G.live({ tf: 'constructor', now }).tf, '15s');
  const bad = G.chartParams({ ema: 'x,1,999', rsi: '1.5', bb: '20,9' });
  assert.deepEqual(bad.ema, [9, 21, 50]);
  assert.equal(bad.rsi, 14);
  assert.deepEqual(bad.bb, [20, 2]);
});

test('the desk advises on four horizons, writes down what it advised, and grades it by the tape', async () => {
  const a = G.advice({ now });
  assert.equal(a.list.length, 4);
  assert.ok(['buy', 'sell', 'wait'].includes(a.verdict.action));
  for (const s of a.list) {
    assert.ok(['A', 'B', 'C'].includes(s.grade));
    if (s.action === 'wait') assert.ok(s.why.length > 0, 'a wait says why');
  }
  // A signal planted at the price now is graded within its horizon.
  const mid = G.quote().mid;
  exec('INSERT INTO gold_signals (made_at, horizon, side, entry, stop, target, expected, p, spread, src) VALUES (?,?,?,?,?,?,?,?,?,?)', now, 15, 'buy', mid, mid - 50, mid + 50, mid + 1, 0.6, 0.3, 'simulated');
  await run(20);
  const s = one('SELECT * FROM gold_signals WHERE horizon = 15 AND stop = ? ', mid - 50);
  assert.equal(s.outcome, 'time');
  assert.ok(Number.isFinite(s.pnl));
  const rec = G.signalRecord({ hours: 24, now });
  assert.ok(rec.all.n >= 1);
  assert.equal(rec.byHorizon.length, 4);
  const o = G.overview({ now });
  assert.ok(o.reliability[60].length === 10);
  assert.ok(o.signalRecord.day.all.n >= 1);
  const l = G.live({ tf: '15s', gh: 15, now });
  assert.equal(l.ghost.horizon, 15);
  assert.ok(l.ghost.rows.length > 0 && l.ghost.rows.some((r) => r.actual != null));
  assert.ok(l.ind.st.length === l.candles.length && l.ind.spanA.length === l.candles.length && l.ind.sar.some((v) => v != null));
  assert.ok(l.pivots?.pivot > 0);
});

test('a question in either language finds its instrument, and gold and stocks answer in one shape', async () => {
  const { resolve, askInstrument } = await import('../src/instrument.js');
  assert.equal(resolve('ما حالة الذهب اليوم؟').symbol, 'GOLD');
  assert.equal(resolve('how is gold doing').symbol, 'GOLD');
  assert.equal(resolve('توقع سهم آبل').symbol, 'AAPL');
  assert.equal(resolve('ما رأيك في النفط').symbol, 'CL=F');
  assert.equal(resolve('$tsla this week').symbol, 'TSLA');
  assert.equal(resolve('ما حالة NVDA؟').symbol, 'NVDA');
  assert.equal(resolve('سهم 2222.SR').symbol, '2222.SR');
  assert.equal(resolve('I wonder'), null, 'a capital I is not a ticker');
  assert.equal(resolve('مرحبا'), null);

  const g = await askInstrument({ text: 'ما حالة الذهب', actor: ME, now });
  assert.equal(g.kind, 'gold');
  assert.ok(g.price > 0 && g.forecasts.length === 7 && g.timeframes.length === 4);
  assert.ok(g.forecasts.every((f) => f.low80 <= f.expected && f.expected <= f.high80));
  assert.ok(['buy', 'sell', 'wait'].includes(g.advice.verdict.action));
  assert.ok(g.chart.length > 20 && g.levels.length === 5);
  assert.match(g.note, /not financial advice/);

  const s = await askInstrument({ text: 'how is Tesla', actor: ME, now });
  assert.equal(s.kind, 'symbol');
  assert.equal(s.symbol, 'TSLA');
  assert.equal(s.source, 'simulated', 'a simulated desk says so');
  assert.ok(one("SELECT symbol FROM mkt_watch WHERE symbol = 'TSLA'"), 'kept on the watchlist so its forecasts are graded from now on');
  assert.deepEqual(s.forecasts.map((f) => f.horizon), [5, 20, 60]);
  assert.ok(['strong buy', 'buy', 'hold', 'sell', 'strong sell'].includes(s.signal.label) && s.signal.components.length > 0);
  assert.equal(s.timeframes.length, 3);
  assert.ok(s.timeframes.every((x) => x.dir), 'two years of history is enough for a daily, a weekly and a monthly direction');
  assert.equal(typeof s.proven, 'boolean', 'every stock answer says whether its record beats the baseline');
  assert.ok(one("SELECT * FROM audit_log WHERE action = 'markets.asked' AND subject_id = 'TSLA'"));
  await assert.rejects(askInstrument({ text: 'hello there', actor: ME, now }), /no instrument/);
});

test('a live quote reaches the desk as it is read, not when its window closes', async () => {
  const { stream, sink } = await import('../src/connectors/goldfeed.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ ts: Date.now(), spreadProfilePrices: [{ bid: 4001.1, ask: 4001.5 }] }]), { status: 200 });
  const seen = [];
  sink.tick = (t) => seen.push(t);
  try {
    const r = await stream({ symbols: ['XAU', 'XAG'], duration: 1, interval: 1 }, { config: {} });
    assert.equal(seen.length, r.ticks.length);
    assert.ok(seen.length >= 2 && seen.every((t) => t.src === 'swissquote' && t.mid === 4001.3));
  } finally { sink.tick = null; globalThis.fetch = realFetch; }
});

test('the brief is written from computed levels, and the feed is a person’s to arm', async () => {
  const n = G.requestBrief({ actor: ME, now });
  for (let i = 0; i < 10; i++) { const r = leaseNext(); if (!r) break; await executeRun(r); }
  G.overview({ now });
  const b = one('SELECT * FROM gold_notes WHERE id = ?', n.id);
  assert.equal(b.state, 'ready');
  assert.match(b.summary, /Pivot/);
  assert.throws(() => G.goLive({ actor: 'agent:AGT-GLD-001' }), /a person/);
  assert.throws(() => G.resetLearning({ actor: 'system:gold' }), /a person/);
});

test('installs seeded before a connector learned new capabilities are offered them, unless a person narrowed the list', () => {
  exec("UPDATE connectors SET scopes = ? WHERE id = 'marketdata'", JSON.stringify(['quotes.fetch', 'history.fetch']));
  exec("UPDATE connectors SET scopes = ? WHERE id = 'broker'", JSON.stringify(['account.read']));
  seedConnectors();
  assert.deepEqual(JSON.parse(one("SELECT scopes FROM connectors WHERE id = 'marketdata'").scopes), ['quotes.fetch', 'history.fetch', 'intraday.fetch', 'spark.fetch']);
  assert.deepEqual(JSON.parse(one("SELECT scopes FROM connectors WHERE id = 'broker'").scopes), ['account.read'], 'a narrowed list stays narrowed');
});

test('the desk is in the catalogue, behind a door, joined to something, with its keys', () => {
  assert.ok(sectionCatalog().map((s) => s.id).includes('gold'));
  assert.deepEqual(surfaceAudit().unfiled, []);
  const c = connectivityAudit();
  assert.ok(!c.orphans.some((o) => o.id === 'gold'));
  assert.deepEqual(c.dangling, []);
  for (const p of ['gold.view', 'gold.manage', 'gold.configure']) assert.ok(PERMS.includes(p), p);
  assert.ok(expandTemplate('operator').includes('gold.manage'));
  assert.ok(!expandTemplate('operator').includes('gold.configure'), 'the operator forecasts and trades paper, but does not switch the bot on');
});

test('the chain still verifies after all of it', () => {
  assert.equal(verifyChain().ok, true);
  for (const a of ['gold.asked', 'gold.opened', 'gold.closed', 'gold.bot_on', 'gold.bot_off', 'gold.backtest', 'gold.tuned', 'gold.brief_requested']) {
    assert.ok(one('SELECT seq FROM audit_log WHERE action = ? LIMIT 1', a), a);
  }
});
