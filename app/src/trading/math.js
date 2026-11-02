// The trading floor's arithmetic. Pure functions: bars and numbers in, numbers
// out, no database, no clock of its own, no network.
//
// Most of this is a port of the day-trader skill (Jake Schincariol, MIT,
// github.com/Jakeschincariol/day-trader-skill): the opening-range breakout,
// the trigger that wants a closed bar above the level, the stop rounded away
// from the entry, the Time Machine that replays a plan through bars borrowed
// from the same time of day in past sessions, and the size that is the
// smallest of four limits. Where the skill wrote a file for the next skill to
// read, this returns an object; where it relied on a person running the steps
// in order, the desk in src/trading.js runs them on its clock.
//
// Two things are added. The same plan is replayed through every past session
// in which its rule would have fired (a backtest of the rule on this symbol,
// not of the market in general), and the size check knows about the loss
// already taken today, so the third losing trade of a bad morning is refused
// before anyone is asked to approve it.
import { OPEN_MIN, BAR_MIN, CLOSE_MIN } from './clock.js';

export const SESSION_BARS = (CLOSE_MIN - OPEN_MIN) / BAR_MIN; // 78
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
// Half up to the cent, the way the skill rounds a target. Math.round on 0.005
// steps is at the mercy of binary fractions, so the epsilon is deliberate.
const centsHalfUp = (x) => Math.floor(x * 100 + 0.5 + 1e-9) / 100;
// A stop rounds away from the entry: down for a long, so the risk is never
// understated by a fraction of a cent.
const centsDown = (x) => Math.floor(x * 100 + 1e-9) / 100;

// ---------------------------------------------------------------- sessions --

/**
 * 5-minute bars with New York minutes and dates → one entry per session.
 * A session is `full` when every bar from 09:30 to the close is present; the
 * Time Machine samples only from full ones, because a missing bar would be a
 * missing move.
 */
export function sessionsFrom(bars, closeOf = () => CLOSE_MIN) {
  const by = new Map();
  for (const b of bars) {
    if (b.c == null || b.min < OPEN_MIN) continue;
    if (b.min >= closeOf(b.day)) continue;
    if (!by.has(b.day)) by.set(b.day, []);
    by.get(b.day).push(b);
  }
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, list]) => {
    list.sort((a, b) => a.min - b.min);
    const want = (closeOf(day) - OPEN_MIN) / BAR_MIN;
    const contiguous = list.every((b, i) => b.min === OPEN_MIN + i * BAR_MIN);
    return { day, bars: list, full: contiguous && list.length === want && want === SESSION_BARS };
  });
}

/** The first `minutes` of the session: its high, low and midpoint, or null if a bar is missing. */
export function openingRange(bars, minutes = 15) {
  const n = Math.max(1, Math.round(minutes / BAR_MIN));
  const first = bars.slice(0, n);
  if (first.length < n || first.some((b, i) => b.min !== OPEN_MIN + i * BAR_MIN || b.h == null || b.l == null)) return null;
  const high = Math.max(...first.map((b) => b.h));
  const low = Math.min(...first.map((b) => b.l));
  return { high: round(high), low: round(low), mid: (high + low) / 2, bars: n, volume: first.reduce((a, b) => a + (b.v || 0), 0) / n };
}

/**
 * The entry trigger: the first completed bar that CLOSES above the level.
 * A wick through it is not a breakout, and a close exactly on it is not
 * either. A bar counts from the minute it closes, so the 09:40 bar is an
 * 09:45 entry and passes "no entries before 09:45".
 */
export function trigger(bars, { level, nRange = 3, fromMin = 9 * 60 + 45, toMin = 15 * 60 + 30, minVolumeX = 0, rangeVolume = 0, nowMin = Infinity } = {}) {
  if (!(level > 0)) return { status: 'no level' };
  let last = null;
  for (let k = nRange; k < bars.length; k++) {
    const b = bars[k];
    const closesAt = b.min + BAR_MIN;
    if (closesAt > nowMin) break;               // still forming
    last = b;
    if (closesAt < fromMin) continue;
    if (closesAt > toMin) return { status: 'expired', why: 'past the last entry time with no close above the level', last: b.c };
    if (b.c > level) {
      if (minVolumeX > 0 && rangeVolume > 0 && (b.v || 0) < minVolumeX * rangeVolume) continue;
      return { status: 'triggered', price: round(b.c), barIndex: k, at: closesAt, pctOver: round((b.c / level - 1) * 100), volumeX: rangeVolume ? round((b.v || 0) / rangeVolume, 2) : null };
    }
  }
  if (nowMin >= toMin) return { status: 'expired', why: 'past the last entry time with no close above the level', last: last?.c ?? null };
  return { status: 'waiting', last: last?.c ?? null, distancePct: last ? round((level / last.c - 1) * 100) : null };
}

/** Session VWAP from the typical price, and where the last close sits against it. */
export function vwap(bars) {
  let pv = 0; let vol = 0;
  for (const b of bars) { const tp = ((b.h ?? b.c) + (b.l ?? b.c) + b.c) / 3; pv += tp * (b.v || 0); vol += b.v || 0; }
  return vol ? pv / vol : null;
}

/** Wilder's ATR over the last n bars (all of them if there are fewer). */
export function atr(bars, n = 14) {
  const tr = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]; const pc = i ? bars[i - 1].c : b.o ?? b.c;
    tr.push(Math.max((b.h ?? b.c) - (b.l ?? b.c), Math.abs((b.h ?? b.c) - pc), Math.abs((b.l ?? b.c) - pc)));
  }
  if (!tr.length) return null;
  const use = tr.slice(-n);
  return { value: use.reduce((a, x) => a + x, 0) / use.length, bars: use.length, short: use.length < n };
}

/**
 * Relative volume: today's volume to this bar against the average of the same
 * bars in past sessions. The number a day trader asks first — a breakout on
 * half the usual volume is a different trade from one on three times it.
 */
export function relVolume(today, past) {
  const k = today.length;
  if (!k || !past.length) return null;
  const sum = (bs) => bs.slice(0, k).reduce((a, b) => a + (b.v || 0), 0);
  const avg = past.map((s) => sum(s.bars)).reduce((a, x) => a + x, 0) / past.length;
  return avg ? round(sum(today) / avg, 2) : null;
}

// -------------------------------------------------------------------- exit --

/**
 * The exit plan, set before the entry. Long side only: the skill plans longs,
 * and a short is a different set of risks (borrow, squeeze, the uptick rule)
 * this desk does not take on.
 */
export function planExit({ entry, orHigh = null, orLow = null, stopRule = 'or-mid', target = '2R', atrValue = null }) {
  const e = Number(entry);
  if (!(e > 0)) return { ok: false, why: 'no entry price' };
  let stop; let stopWhy;
  const [kind, arg] = String(stopRule).split(':');
  if (kind === 'or-mid' || kind === 'or-low') {
    if (!(orHigh > 0 && orLow > 0)) return { ok: false, why: 'an opening-range stop needs the opening range' };
    stop = kind === 'or-mid' ? (orHigh + orLow) / 2 : orLow;
    stopWhy = kind === 'or-mid' ? `opening-range midpoint (${orHigh} + ${orLow}) / 2` : `opening-range low ${orLow}`;
  } else if (kind === 'pct') {
    const p = Number(arg);
    if (!(p > 0 && p < 50)) return { ok: false, why: 'pct:X needs a percent between 0 and 50' };
    stop = e * (1 - p / 100); stopWhy = `${p}% under the entry`;
  } else if (kind === 'atr') {
    const k = Number(arg || 1.5);
    if (!(atrValue > 0)) return { ok: false, why: 'an ATR stop needs the session bars up to the entry' };
    stop = e - k * atrValue; stopWhy = `${k} × ATR(14) ${round(atrValue, 4)} under the entry`;
  } else if (kind === 'price') {
    stop = Number(arg); stopWhy = 'the price you named';
  } else return { ok: false, why: `unknown stop rule ${stopRule}` };
  stop = centsDown(stop);
  if (!(stop < e)) return { ok: false, why: `the stop ${stop} is not below the entry ${e} — a long needs its stop underneath` };
  const risk = round(e - stop, 4);
  // Under 0.05% of the price, the spread alone stops the trade out.
  if (risk < e * 0.0005) return { ok: false, why: `a risk of ${risk} a share is too tight to survive the spread` };
  let tgt; let targetR;
  const tm = /^(\d+(?:\.\d+)?)R$/i.exec(String(target));
  if (tm) { targetR = Number(tm[1]); tgt = centsHalfUp(e + targetR * risk); } else if (String(target).startsWith('price:')) {
    tgt = Number(String(target).slice(6)); targetR = round((tgt - e) / risk, 2);
  } else return { ok: false, why: `unknown target ${target}` };
  if (!(tgt > e)) return { ok: false, why: `the target ${tgt} is not above the entry ${e}` };
  return { ok: true, entry: e, stop, stopRule, stopWhy, target: tgt, targetR, riskShare: risk, riskPct: round((risk / e) * 100), rr: round((tgt - e) / risk, 2) };
}

// ------------------------------------------------------------ time machine --

/** A small, seedable generator, so the same plan replays the same way twice. */
export function rng(seed = 19) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** pool[i] = every full past session's bar i as ratios (open, high, low, close) to bar i-1's close. */
export function buildPool(sessions) {
  const pool = Array.from({ length: SESSION_BARS }, () => []);
  for (const s of sessions) {
    if (!s.full) continue;
    for (let i = 1; i < SESSION_BARS; i++) {
      const pc = s.bars[i - 1].c;
      const b = s.bars[i];
      pool[i].push([b.o / pc, b.h / pc, b.l / pc, b.c / pc]);
    }
  }
  return pool;
}

const pctile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * Monte Carlo replays of the rest of the session after the entry bar. Each
 * later bar is borrowed from a past session at the same time of day (± window
 * bars) and scaled to the price. Within a bar the stop is checked before the
 * target, so a bar that touches both counts as the loss — the conservative
 * reading, because the order of a high and a low inside five minutes is not
 * in the data.
 */
export function simulate(pool, { entry, stop, target, k, last = SESSION_BARS - 2, replays = 10000, seed = 19, window = 2, paths = 24 }) {
  const risk = entry - stop;
  const rTarget = round((target - entry) / risk, 4);
  const r = rng(seed);
  const slot = (i) => (window === 0 ? i : Math.min(SESSION_BARS - 1, Math.max(1, i + Math.floor(r() * (2 * window + 1)) - window)));
  const pick = (i) => { const p = pool[slot(i)]; return p[Math.floor(r() * p.length)]; };
  const outcomes = { target: 0, stop: 0, close: 0 };
  const closes = []; const Rs = []; const sample = [];
  let green = 0;
  for (let n = 0; n < replays; n++) {
    let p = entry; let out = null;
    const path = n < paths ? [entry] : null;
    for (let i = k + 1; i <= last; i++) {
      const [, h, l, c] = pick(i);
      if (!out) { if (p * l <= stop) out = 'stop'; else if (p * h >= target) out = 'target'; }
      p *= c;
      if (path) path.push(round(p));
    }
    out = out || 'close';
    outcomes[out]++;
    closes.push(p);
    if (out === 'target' || (out === 'close' && p > entry)) green++;
    Rs.push(out === 'target' ? rTarget : out === 'stop' ? -1 : (p - entry) / risk);
    if (path) sample.push(path);
  }
  closes.sort((a, b) => a - b);
  return {
    replays, seed, window, barsLeft: last - k,
    pTarget: round(outcomes.target / replays, 4), pStop: round(outcomes.stop / replays, 4), pNeither: round(outcomes.close / replays, 4),
    pGreen: round(green / replays, 4), avgR: round(Rs.reduce((a, x) => a + x, 0) / replays, 3), rAtTarget: rTarget,
    p5: round(pctile(closes, 0.05)), median: round(pctile(closes, 0.5)), p95: round(pctile(closes, 0.95)),
    paths: sample,
  };
}

const COIN_FLIP = 0.05;
const STRONG = 0.15;

/**
 * One line from the numbers. At R:1 the target has to come first in
 * 1/(1+R) of the replays that reach a side just to break even, so the lean
 * is measured against that, not against a half.
 */
export function verdict(mc) {
  const hit = mc.pTarget + mc.pStop;
  if (hit <= 0) return { lean: 0, head: 'decided by the close', line: 'No replay reached the target or the stop before the flat-by time.' };
  const r = mc.rAtTarget || 1;
  const share = mc.pTarget / hit; const even = 1 / (1 + r);
  const d = share - even;
  const oneR = Math.abs(r - 1) < 0.005;
  const head = Math.abs(d) < COIN_FLIP ? (oneR ? 'close to a coin flip' : 'close to break-even')
    : Math.abs(d) < STRONG ? (d > 0 ? 'leans toward the target' : 'leans toward the stop')
      : (d > 0 ? 'strongly toward the target' : 'strongly toward the stop');
  const odds = `target first ${round(100 * mc.pTarget, 1)}% vs stop first ${round(100 * mc.pStop, 1)}%`;
  const notes = [];
  if (mc.pNeither > 0.25) notes.push(`${round(100 * mc.pNeither, 1)}% of the replays hit neither by the flat-by time; the closing price decides those.`);
  if (Math.abs(d) >= COIN_FLIP && mc.avgR !== 0 && (mc.avgR > 0) !== (d > 0)) notes.push(`Average R is ${mc.avgR > 0 ? '+' : ''}${mc.avgR} all the same: the replays that hit neither pull it the other way.`);
  return {
    lean: round(d, 4), share: round(share, 4), breakEven: round(even, 4), head,
    line: oneR ? `${head}: ${odds}.` : `${head}: at ${round(r, 2)}R the target has to come first in ${Math.round(100 * even)}% of the replays that reach a side; it did in ${Math.round(100 * share)}% (${odds}).`,
    notes,
  };
}

/**
 * The rule replayed through every past session in which it would have fired:
 * same opening range, same trigger, same stop rule and the same R, walked bar
 * by bar to the flat-by time. Small samples are reported as small.
 */
export function historyReplay(sessions, { nRange = 3, stopRule = 'or-mid', targetR = 2, fromMin = 9 * 60 + 45, toMin = 15 * 60 + 30, flatMin = 15 * 60 + 55 } = {}) {
  const trades = [];
  for (const s of sessions) {
    if (!s.full) continue;
    const or = openingRange(s.bars, nRange * BAR_MIN);
    if (!or) continue;
    const tr = trigger(s.bars, { level: or.high, nRange, fromMin, toMin });
    if (tr.status !== 'triggered') continue;
    const a = String(stopRule).startsWith('atr') ? atr(s.bars.slice(0, tr.barIndex + 1))?.value : null;
    const plan = planExit({ entry: tr.price, orHigh: or.high, orLow: or.low, stopRule, target: `${targetR}R`, atrValue: a });
    if (!plan.ok) continue;
    let out = null; let exit = null;
    for (let i = tr.barIndex + 1; i < s.bars.length; i++) {
      const b = s.bars[i];
      if (b.min + BAR_MIN > flatMin) break;
      if (b.l <= plan.stop) { out = 'stop'; exit = plan.stop; break; }
      if (b.h >= plan.target) { out = 'target'; exit = plan.target; break; }
      exit = b.c;
    }
    out = out || 'close';
    const R = out === 'stop' ? -1 : out === 'target' ? plan.rr : (exit - plan.entry) / plan.riskShare;
    trades.push({ day: s.day, entry: plan.entry, stop: plan.stop, target: plan.target, exit: round(exit ?? plan.entry), outcome: out, R: round(R, 3) });
  }
  return { ...stats(trades.map((t) => t.R)), trades: trades.slice(-40), sessions: sessions.filter((s) => s.full).length };
}

/** Win rate, average R, expectancy and profit factor of a list of R results. */
export function stats(Rs) {
  const n = Rs.length;
  if (!n) return { n: 0, winRate: null, avgR: null, expectancy: null, profitFactor: null, totalR: 0, maxLosingStreak: 0 };
  const wins = Rs.filter((r) => r > 0); const losses = Rs.filter((r) => r < 0);
  const gw = wins.reduce((a, x) => a + x, 0); const gl = -losses.reduce((a, x) => a + x, 0);
  let streak = 0; let worst = 0;
  for (const r of Rs) { streak = r < 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  // Equity in R and its deepest fall from a high: the number that decides
  // whether a person keeps trading a rule through a bad month.
  let eq = 0; let peak = 0; let dd = 0;
  for (const r of Rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {
    n, winRate: round(wins.length / n, 3), avgWinR: wins.length ? round(gw / wins.length, 3) : null, avgLossR: losses.length ? round(-gl / losses.length, 3) : null,
    avgR: round(Rs.reduce((a, x) => a + x, 0) / n, 3), expectancy: round(Rs.reduce((a, x) => a + x, 0) / n, 3),
    profitFactor: gl ? round(gw / gl, 2) : (gw ? null : 0), totalR: round(eq, 2), maxDrawdownR: round(dd, 2), maxLosingStreak: worst,
    small: n < 20,
  };
}

// -------------------------------------------------------------------- size --

/**
 * Whole shares, the smallest of four limits: the loss allowed on one trade
 * over the risk a share, the largest position, the largest order, and the cash
 * left after the buffer. Which one bound is reported, because "why only 8?"
 * is the first question anyone asks.
 */
export function size({ entry, stop, equity, cash, cfg }) {
  const risk = entry - stop;
  if (!(risk > 0)) return { qty: 0, why: 'the stop is not below the entry' };
  const maxLoss = Math.min(cfg.maxLossUsd || Infinity, (equity * cfg.riskPct) / 100);
  const limits = {
    'max loss a trade': maxLoss / risk,
    'largest position': (equity * cfg.maxPositionPct) / 100 / entry,
    'largest order': cfg.maxOrderUsd / entry,
    'cash after the buffer': Math.max(0, cash - (equity * cfg.cashBufferPct) / 100) / entry,
  };
  let bound = null; let q = Infinity;
  for (const [k, v] of Object.entries(limits)) if (v < q) { q = v; bound = k; }
  const qty = Math.max(0, Math.floor(q + 1e-9));
  return { qty, bound, maxLoss: round(maxLoss), riskUsd: round(qty * risk), value: round(qty * entry), limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, Math.floor(v + 1e-9)])) };
}

// ------------------------------------------------------------------- daily --

function wilderRsi(c, n = 14) {
  if (c.length < n + 1) return null;
  let g = 0; let l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : round(100 - 100 / (1 + g / l), 2);
}

/**
 * The pre-market setups, on daily closes only. "Matched a rule" — never "a
 * buy": a setup is a reason to watch a symbol at the open, nothing more.
 */
export function dailySetups(c) {
  if (c.length < 30) return null;
  const last = c.at(-1);
  const hi20 = Math.max(...c.slice(-21, -1));
  const ma20 = c.slice(-20).reduce((a, x) => a + x, 0) / 20;
  const ma20Prev = c.slice(-21, -1).reduce((a, x) => a + x, 0) / 20;
  const run = c.at(-6) / c.at(-16) - 1;
  const rng5 = (Math.max(...c.slice(-5)) - Math.min(...c.slice(-5))) / last;
  const r = wilderRsi(c); const rPrev = wilderRsi(c.slice(0, -1));
  const tags = [];
  if (last > hi20) tags.push('breakout_20d');
  if (run > 0.10 && rng5 < 0.05) tags.push('bull_flag');
  if (c.at(-2) < ma20Prev && last > ma20) tags.push('reclaim_ma20');
  if (r != null && r < 30) tags.push('oversold');
  if (rPrev != null && rPrev < 30 && last > c.at(-2)) tags.push('oversold_bounce');
  return { tags, rsi: r, high20: round(hi20), ma20: round(ma20), runPct: round(run * 100), range5Pct: round(rng5 * 100), last: round(last) };
}

// -------------------------------------------------------------------- risk --

/**
 * Every check an entry must pass before a person is asked about it. A `block`
 * stops the order; a `warn` is shown beside it. The daily-loss line counts the
 * loss already booked today and the risk still open, so the limit means what
 * it says: the worst this day can cost, not the worst this one trade can.
 */
export function riskChecks({ symbol, side = 'buy', qty, entry, stop, target }, cfg, ctx) {
  const risk = entry - stop;
  const value = qty * entry;
  const lossIfStopped = qty * risk;
  const dailyLimit = (ctx.equity * cfg.maxDailyLossPct) / 100;
  const maxLoss = Math.min(cfg.maxLossUsd || Infinity, (ctx.equity * cfg.riskPct) / 100);
  const used = Math.max(0, -ctx.realizedTodayUsd) + ctx.openRiskUsd;
  const list = [
    ['format', Number.isInteger(qty) && qty > 0 && entry > 0 && stop > 0 && target > 0, `${qty} shares, entry ${entry}, stop ${stop}, target ${target}`],
    ['long-only', side === 'buy', side === 'buy' ? 'a long' : 'the desk does not short'],
    ['blocked-list', !cfg.blocked.includes(symbol), cfg.blocked.includes(symbol) ? `${symbol} is on the blocked list` : 'not blocked'],
    ['stop', stop > 0 && stop < entry, `stop ${stop} under entry ${entry}`],
    ['target', target > entry, `target ${target} over entry ${entry}`],
    ['loss-per-trade', lossIfStopped <= maxLoss + 1e-6, `${round(lossIfStopped)} if stopped, limit ${round(maxLoss)}`],
    ['reward-risk', (target - entry) / risk >= cfg.minRR - 1e-9, `${round((target - entry) / risk, 2)}R, minimum ${cfg.minRR}R`],
    ['order-size', value >= cfg.minOrderUsd && value <= cfg.maxOrderUsd, `order ${round(value)}, between ${cfg.minOrderUsd} and ${cfg.maxOrderUsd}`],
    ['position-cap', value <= (ctx.equity * cfg.maxPositionPct) / 100 + 1e-6, `${round((value / Math.max(ctx.equity, 1)) * 100)}% of equity, limit ${cfg.maxPositionPct}%`],
    ['cash-buffer', value <= ctx.cash - (ctx.equity * cfg.cashBufferPct) / 100 + 1e-6, `cash ${round(ctx.cash)} keeps ${cfg.cashBufferPct}% back`],
    ['daily-loss', used + lossIfStopped <= dailyLimit + 1e-6, `${round(used)} lost or at risk today + ${round(lossIfStopped)} against a day limit of ${round(dailyLimit)}`],
    ['trades-per-day', ctx.tradesToday < cfg.maxTradesDay, `${ctx.tradesToday} entries today, limit ${cfg.maxTradesDay}`],
    ['tilt', ctx.lossStreakToday < cfg.maxConsecLosses, `${ctx.lossStreakToday} losses in a row today, the desk stops at ${cfg.maxConsecLosses}`],
    ['entry-window', ctx.clock.canEnter || ctx.ignoreClock, ctx.clock.canEnter ? `inside ${ctx.clock.window.from}–${ctx.clock.window.to} New York` : `outside ${ctx.clock.window.from}–${ctx.clock.window.to} New York (${ctx.clock.state})`],
    ['duplicate', !ctx.openSymbols.includes(symbol), ctx.openSymbols.includes(symbol) ? `already trading ${symbol} today` : 'no open trade in it'],
  ];
  const checks = list.map(([name, ok, why]) => ({ name, ok: Boolean(ok), why, level: 'block' }));
  if (cfg.pdtGuard && ctx.equity < 25_000) checks.push({ name: 'pdt', ok: ctx.dayTrades5 < 3, why: `${ctx.dayTrades5} day trades in five sessions under $25,000`, level: 'block' });
  // The edge: the Time Machine's average R and the rule's own record on this
  // symbol. With requireEdge on, a plan that loses on average in both is not
  // put in front of a person; with too few past triggers it only warns.
  if (ctx.tm) {
    const histOk = !ctx.history || ctx.history.n < 5 || ctx.history.expectancy > 0;
    const mcOk = ctx.tm.avgR > 0;
    checks.push({ name: 'edge', ok: !cfg.requireEdge || mcOk || histOk, level: cfg.requireEdge ? 'block' : 'warn',
      why: `replays ${ctx.tm.avgR > 0 ? '+' : ''}${ctx.tm.avgR}R on average${ctx.history?.n ? `; the rule on this symbol ${ctx.history.expectancy > 0 ? '+' : ''}${ctx.history.expectancy}R over ${ctx.history.n} past triggers` : ''}` });
  }
  if (!ctx.priceFresh) checks.push({ name: 'fresh-price', ok: false, why: 'the last price is more than 15 minutes old', level: ctx.live ? 'block' : 'warn' });
  return { ok: checks.every((c) => c.ok || c.level === 'warn'), checks, lossIfStopped: round(lossIfStopped), dailyLimit: round(dailyLimit), usedToday: round(used) };
}
