// The gold desk's arithmetic. Pure functions: a series of one-second prices in,
// forecasts, scores, candles and indicators out. No database, no clock, no
// network.
//
// Five forecasters, each simple enough to read in a minute:
//   naive      the price stays where it is — the baseline every other model
//              has to beat, because at a horizon of seconds it is very hard to
//   drift      the recent average return, carried forward
//   momentum   the recent slope, damped
//   meanrev    a pull back toward a moving average
//   ar         an autoregression on one-second returns, fitted by least squares
// and an ensemble whose weights are earned: after every graded forecast each
// model's weight falls with its squared error (the Hedge rule, with a memory
// that fades so a change of regime is noticed), and the error bands are
// re-fitted from the errors actually made (split conformal), not assumed.
//
// Nothing here claims an edge. The scoreboard reports each model against the
// naive one; at a few seconds gold is close to a random walk, and the page
// says so in numbers.
import { ema, sma, rsi, macd, bollinger, phi } from '../markets/quant.js';

export const MODELS = ['naive', 'drift', 'momentum', 'meanrev', 'ar'];
export const HORIZONS = [5, 15, 30, 60, 300, 900, 3600];
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** The parameters each model starts with, before the tuner has looked at any data. */
export const DEFAULT_PARAMS = {
  drift: { halfLife: 300 },
  momentum: { lookback: 60, damp: 0.5 },
  meanrev: { window: 300, speed: 0.5 },
  ar: { p: 2, fit: 1800 },
};

/** The values the tuner tries. Small on purpose: a grid this size is searched every hour in under a second. */
export const GRID = {
  drift: [{ halfLife: 60 }, { halfLife: 300 }, { halfLife: 1800 }],
  momentum: [15, 30, 60, 120, 300].flatMap((lookback) => [0.25, 0.5, 1].map((damp) => ({ lookback, damp }))),
  meanrev: [60, 180, 600, 1800].flatMap((window) => [0.25, 0.5, 1].map((speed) => ({ window, speed }))),
  ar: [1, 2, 3, 5].map((p) => ({ p, fit: 1800 })),
};

// ------------------------------------------------------------- the series --

/**
 * Ticks at irregular times → one price a second, the last known price carried
 * into seconds with no tick. Forecasts are made and graded on this grid.
 */
export function resample(ticks, { from = null, to = null } = {}) {
  if (!ticks.length) return { t0: null, xs: [] };
  const start = Math.floor((from ?? ticks[0].ts) / 1000);
  const end = Math.floor((to ?? ticks[ticks.length - 1].ts) / 1000);
  const xs = [];
  let k = 0; let last = ticks[0].mid;
  for (let s = start; s <= end; s++) {
    while (k < ticks.length && Math.floor(ticks[k].ts / 1000) <= s) { last = ticks[k].mid; k++; }
    xs.push(last);
  }
  return { t0: start * 1000, xs };
}

const logret = (xs, n) => {
  const out = [];
  for (let i = Math.max(1, xs.length - n); i < xs.length; i++) out.push(Math.log(xs[i] / xs[i - 1]));
  return out;
};

/** Volatility of one-second log returns, exponentially weighted, so a quiet hour after a busy one is seen as quiet. */
export function sigma1(xs, halfLife = 300) {
  const r = logret(xs, Math.min(xs.length - 1, 1800));
  if (r.length < 30) return null;
  const a = 1 - Math.exp(-Math.LN2 / halfLife);
  let v = r.slice(0, 30).reduce((s, x) => s + x * x, 0) / 30;
  for (const x of r) v = (1 - a) * v + a * x * x;
  return Math.sqrt(v) || 1e-7;
}

// ------------------------------------------------------------ the models --

/** Least squares for AR(p) on returns: solves the normal equations by Gaussian elimination. */
export function fitAR(r, p) {
  const n = r.length;
  if (n < p * 10 + 20) return null;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let t = p; t < n; t++) {
    for (let i = 0; i < p; i++) {
      b[i] += r[t] * r[t - 1 - i];
      for (let j = 0; j < p; j++) A[i][j] += r[t - 1 - i] * r[t - 1 - j];
    }
  }
  // A little ridge, so a flat market does not make the system singular.
  const tr = A.reduce((s, row, i) => s + row[i], 0) / p || 1e-12;
  for (let i = 0; i < p; i++) A[i][i] += tr * 1e-3;
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let i = c + 1; i < p; i++) if (Math.abs(A[i][c]) > Math.abs(A[piv][c])) piv = i;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    if (Math.abs(A[c][c]) < 1e-300) return null;
    for (let i = c + 1; i < p; i++) {
      const f = A[i][c] / A[c][c];
      for (let j = c; j < p; j++) A[i][j] -= f * A[c][j];
      b[i] -= f * b[c];
    }
  }
  const phiv = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < p; j++) s -= A[i][j] * phiv[j];
    phiv[i] = s / A[i][i];
  }
  // A fitted process that would explode is not a forecast; it is a bug.
  if (phiv.reduce((s, x) => s + Math.abs(x), 0) >= 0.98) return phiv.map((x) => x * 0.98 / phiv.reduce((s, y) => s + Math.abs(y), 0));
  return phiv;
}

/**
 * One model's forecast of the price `h` seconds after the last point of `xs`.
 * `fitted` carries the AR coefficients so a caller predicting many horizons
 * from the same moment fits them once.
 */
export function predict(model, xs, h, params = DEFAULT_PARAMS[model] || {}, fitted = null) {
  const n = xs.length;
  const last = xs[n - 1];
  if (model === 'naive' || n < 30) return last;
  if (model === 'drift') {
    const r = logret(xs, Math.min(n - 1, params.halfLife * 4));
    const a = 1 - Math.exp(-Math.LN2 / params.halfLife);
    let mu = 0; for (const x of r) mu = (1 - a) * mu + a * x;
    // A drift measured over minutes says nothing about the hour after: it is
    // carried forward no further than the window it was measured on.
    return last * Math.exp(mu * Math.min(h, 2 * params.halfLife));
  }
  if (model === 'momentum') {
    const L = Math.min(params.lookback, n - 1);
    // The least-squares slope of the last L seconds.
    let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
    for (let i = 0; i <= L; i++) { const y = xs[n - 1 - L + i]; sx += i; sy += y; sxy += i * y; sxx += i * i; }
    const m = L + 1;
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1);
    // Likewise a slope measured over L seconds is extrapolated at most L seconds.
    return last + params.damp * slope * Math.min(h, L);
  }
  if (model === 'meanrev') {
    const W = Math.min(params.window, n);
    let s = 0; for (let i = n - W; i < n; i++) s += xs[i];
    const target = s / W;
    // Half the gap closes over speed × window seconds.
    const tau = Math.max(1, params.speed * W) / Math.LN2;
    return last + (target - last) * (1 - Math.exp(-h / tau));
  }
  if (model === 'ar') {
    const phiv = fitted?.ar?.[params.p] || fitAR(logret(xs, params.fit), params.p);
    if (!phiv) return last;
    const hist = logret(xs, params.p);
    const r = hist.slice(-params.p);
    let cum = 0;
    // Beyond a few hundred steps an AR forecast is its mean, which is zero.
    for (let k = 0; k < Math.min(h, 300); k++) {
      let next = 0;
      for (let i = 0; i < params.p; i++) next += phiv[i] * (r[r.length - 1 - i] || 0);
      r.push(next); cum += next;
      if (Math.abs(next) < 1e-12) break;
    }
    return last * Math.exp(cum);
  }
  return last;
}

/** Every model at every horizon from one moment, the ensemble beside them, and the band around it. */
export function forecastAll(xs, { horizons = HORIZONS, params = {}, weights = {}, calib = {} } = {}) {
  const last = xs[xs.length - 1];
  const s1 = sigma1(xs);
  if (!s1 || !last) return [];
  const fitted = { ar: {} };
  return horizons.map((h) => {
    // Parameters are tuned per horizon: the lookback that suits five seconds
    // is not the one that suits fifteen minutes.
    const ph = params[h] || {};
    const per = {};
    for (const m of MODELS) {
      const pm = { ...DEFAULT_PARAMS[m], ...(ph[m] || {}) };
      if (m === 'ar' && !fitted.ar[pm.p]) fitted.ar[pm.p] = fitAR(logret(xs, pm.fit), pm.p);
      per[m] = round(predict(m, xs, h, pm, fitted), 4);
    }
    const w = normWeights(weights[h]);
    const ens = MODELS.reduce((s, m) => s + w[m] * per[m], 0);
    const sd = s1 * Math.sqrt(h) * last;
    const k = calib[h] || {};
    const k80 = k.k80 || 1.2816; const k95 = k.k95 || 1.96;
    return {
      horizon: h, base: last, sigma: sd, preds: per, weights: w, ens: round(ens, 4),
      low80: round(ens - k80 * sd, 4), high80: round(ens + k80 * sd, 4), low95: round(ens - k95 * sd, 4), high95: round(ens + k95 * sd, 4),
      pUp: round(sd > 0 ? phi((ens - last) / sd) : 0.5, 3), k80, k95,
    };
  });
}

// ------------------------------------------------------------- learning --

/**
 * Before a horizon has any record, "no change" carries a third of the weight:
 * it is the forecast that is never far wrong, and the others have to earn
 * their share by being graded.
 */
export const PRIOR = { naive: 2, drift: 1, momentum: 1, meanrev: 1, ar: 1 };

export function normWeights(w = {}) {
  const raw = MODELS.map((m) => Math.max(0, Number(w[m]) || 0));
  const s = raw.reduce((a, x) => a + x, 0);
  if (!s) return normWeights(PRIOR);
  return Object.fromEntries(MODELS.map((m, i) => [m, raw[i] / s]));
}

/**
 * The Hedge rule with forgetting. Each model carries a fading sum of its
 * squared errors (in units of the band, so a calm minute and a wild one count
 * alike); the weights are exp(−η × that sum), with a floor so no model is ever
 * written off for good — a model useless this morning may be the best one this
 * afternoon.
 */
export function hedge(state = {}, errors, { eta = 2, decay = 0.995, floor = 0.02 } = {}) {
  const L = { ...(state.loss || {}) };
  for (const m of MODELS) {
    const e = errors[m];
    if (e == null || !Number.isFinite(e)) continue;
    L[m] = (L[m] || 0) * decay + Math.min(25, e * e);
  }
  const min = Math.min(...MODELS.map((m) => L[m] ?? 0));
  const raw = Object.fromEntries(MODELS.map((m) => [m, Math.exp(-eta * ((L[m] ?? 0) - min))]));
  const w = normWeights(raw);
  const fl = normWeights(Object.fromEntries(MODELS.map((m) => [m, Math.max(floor, w[m])])));
  return { loss: L, weights: fl, n: (state.n || 0) + 1 };
}

/**
 * Split-conformal bands: the 80th and 95th percentiles of the errors actually
 * made, in units of σ√h. If the market is calmer than the volatility says the
 * band narrows; if it surprises more often the band widens — until four in
 * five outcomes really do land inside the 80% band.
 */
export function calibrate(normErrors) {
  const e = normErrors.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  if (e.length < 30) return null;
  const q = (p) => e[Math.min(e.length - 1, Math.floor(p * e.length))];
  return { k80: round(Math.max(0.2, q(0.8)), 3), k95: round(Math.max(0.3, q(0.95)), 3), n: e.length };
}

/**
 * Walk forward: from point `start`, every `stride` seconds, predict each
 * horizon and compare it with what came. The mean absolute error of each
 * parameter set on the same moments decides which one the desk uses next hour.
 */
export function walkForward(series, model, params, h, { start = 1800, stride = 20 } = {}) {
  // A typed array, so each step looks at the past through a window instead of copying it.
  const xs = series instanceof Float64Array ? series : Float64Array.from(series);
  let sae = 0; let n = 0; let hits = 0; let moves = 0;
  const pFit = model === 'ar' ? fitAR(logret(xs.subarray(0, start), params.fit), params.p) : null;
  for (let i = start; i + h < xs.length; i += stride) {
    const past = xs.subarray(Math.max(0, i - 1900), i + 1);
    const f = predict(model, past, h, params, pFit ? { ar: { [params.p]: pFit } } : null);
    const actual = xs[i + h];
    sae += Math.abs(f - actual); n++;
    const p0 = past[past.length - 1];
    if (actual !== p0 && f !== p0) { moves++; if (Math.sign(f - p0) === Math.sign(actual - p0)) hits++; }
  }
  return { n, mae: n ? sae / n : null, hit: moves ? hits / moves : null };
}

export function tune(series, horizons = [5, 15, 30, 60, 300], opts = {}) {
  const xs = Float64Array.from(series);
  const out = {};
  for (const h of horizons) {
    if (xs.length < 1800 + h + 60) continue;
    const naive = walkForward(xs, 'naive', {}, h, opts);
    const best = {};
    for (const m of ['drift', 'momentum', 'meanrev', 'ar']) {
      let pick = null;
      for (const p of GRID[m]) {
        const r = walkForward(xs, m, p, h, opts);
        if (r.mae != null && (!pick || r.mae < pick.mae)) pick = { params: p, ...r };
      }
      if (pick) best[m] = pick;
    }
    out[h] = { naive, best };
  }
  return out;
}

// ------------------------------------------------------------- the score --

/** Errors of one graded forecast, model by model, in price and in band units. */
export function grade(pred, actual) {
  const base = pred.base;
  const sd = pred.sigma || 1e-9;
  const errs = {}; const norm = {};
  for (const m of [...MODELS, 'ens']) {
    const f = m === 'ens' ? pred.ens : pred.preds?.[m];
    if (f == null) continue;
    errs[m] = f - actual;
    norm[m] = (f - actual) / sd;
  }
  const moved = actual !== base;
  // A forecast of no move makes no call on the direction, and is not counted as a wrong one.
  const dir = (f) => (moved && f !== base ? Number(Math.sign(f - base) === Math.sign(actual - base)) : null);
  return {
    errs, norm,
    hit: Object.fromEntries([...MODELS, 'ens'].map((m) => [m, dir(m === 'ens' ? pred.ens : pred.preds?.[m])])),
    inside80: actual >= pred.low80 && actual <= pred.high80 ? 1 : 0,
    inside95: actual >= pred.low95 && actual <= pred.high95 ? 1 : 0,
  };
}

/** Rows of running sums → the numbers a person reads. */
export function scoreOf(r, naiveMae = null) {
  if (!r?.n) return { n: 0 };
  const mae = r.sae / r.n;
  return {
    n: r.n,
    mae: round(mae, 4),
    rmse: round(Math.sqrt(r.sse / r.n), 4),
    mapePct: round((r.sape / r.n) * 100, 5),
    accuracyPct: round(100 - (r.sape / r.n) * 100, 4),
    hitRate: r.dir_n ? round(r.hits / r.dir_n, 4) : null,
    coverage80: r.inside80 != null && r.n ? round(r.inside80 / r.n, 3) : null,
    coverage95: r.inside95 != null && r.n ? round(r.inside95 / r.n, 3) : null,
    // Skill: how much smaller the error is than "the price stays the same".
    // Zero is no better; negative is worse. This is the honest number.
    skillPct: naiveMae ? round((1 - mae / naiveMae) * 100, 2) : null,
  };
}

// ------------------------------------------------------------ the chart --

/** Ticks → candles of `tf` seconds. Spot gold has no exchange volume, so the count of ticks stands in, and is called that. */
export function candles(ticks, tf = 60, limit = 240) {
  const by = new Map();
  for (const t of ticks) {
    const k = Math.floor(t.ts / 1000 / tf) * tf;
    const c = by.get(k);
    if (!c) by.set(k, { t: k * 1000, o: t.mid, h: t.mid, l: t.mid, c: t.mid, ticks: 1, spread: t.ask && t.bid ? t.ask - t.bid : null });
    else { c.h = Math.max(c.h, t.mid); c.l = Math.min(c.l, t.mid); c.c = t.mid; c.ticks++; if (t.ask && t.bid) c.spread = t.ask - t.bid; }
  }
  return [...by.values()].sort((a, b) => a.t - b.t).slice(-limit);
}

function stoch(cs, n = 14, d = 3) {
  const k = cs.map((_, i) => {
    if (i < n - 1) return null;
    const w = cs.slice(i - n + 1, i + 1);
    const hi = Math.max(...w.map((c) => c.h)); const lo = Math.min(...w.map((c) => c.l));
    return hi === lo ? 50 : ((cs[i].c - lo) / (hi - lo)) * 100;
  });
  const dd = k.map((_, i) => (i < n + d - 2 ? null : k.slice(i - d + 1, i + 1).reduce((a, x) => a + x, 0) / d));
  return { k, d: dd };
}

function cci(cs, n = 20) {
  return cs.map((_, i) => {
    if (i < n - 1) return null;
    const tp = cs.slice(i - n + 1, i + 1).map((c) => (c.h + c.l + c.c) / 3);
    const m = tp.reduce((a, x) => a + x, 0) / n;
    const md = tp.reduce((a, x) => a + Math.abs(x - m), 0) / n;
    return md ? (tp[n - 1] - m) / (0.015 * md) : 0;
  });
}

function williams(cs, n = 14) {
  return cs.map((_, i) => {
    if (i < n - 1) return null;
    const w = cs.slice(i - n + 1, i + 1);
    const hi = Math.max(...w.map((c) => c.h)); const lo = Math.min(...w.map((c) => c.l));
    return hi === lo ? -50 : ((hi - cs[i].c) / (hi - lo)) * -100;
  });
}

function atrSeries(cs, n = 14) {
  const tr = cs.map((c, i) => (i ? Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c)) : c.h - c.l));
  const out = new Array(cs.length).fill(null);
  if (cs.length <= n) return out;
  let a = tr.slice(1, n + 1).reduce((s, x) => s + x, 0) / n; out[n] = a;
  for (let i = n + 1; i < tr.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}

/** The indicators a trading screen shows, on the candles it shows. */
export function indicators(cs) {
  const c = cs.map((x) => x.c);
  const bb = bollinger(c, 20, 2);
  const m = macd(c);
  const st = stoch(cs);
  return {
    ema9: ema(c, 9), ema21: ema(c, 21), ema50: ema(c, 50),
    bbUpper: bb.map((b) => b?.upper ?? null), bbMid: bb.map((b) => b?.mid ?? null), bbLower: bb.map((b) => b?.lower ?? null),
    rsi: rsi(c, 14), macd: m.line, macdSignal: m.signal, macdHist: m.hist,
    stochK: st.k, stochD: st.d, cci: cci(cs), willR: williams(cs), atr: atrSeries(cs),
  };
}

/**
 * The technical summary in the shape every trading platform shows: each
 * oscillator and each moving average votes buy, sell or neutral, and the
 * count is the verdict. It is a description of the chart, not a forecast, and
 * the scoreboard beside it shows how little such votes say about the next
 * minute.
 */
export function technicalSummary(cs) {
  if (cs.length < 30) return null;
  const ind = indicators(cs);
  const L = (a) => a[a.length - 1];
  const P = (a) => a[a.length - 2];
  const price = L(cs).c;
  const osc = [
    ['RSI (14)', L(ind.rsi), (v) => (v < 30 ? 'buy' : v > 70 ? 'sell' : 'neutral')],
    ['Stochastic %K (14, 3, 3)', L(ind.stochK), (v) => (v < 20 ? 'buy' : v > 80 ? 'sell' : 'neutral')],
    ['CCI (20)', L(ind.cci), (v) => (v < -100 ? 'buy' : v > 100 ? 'sell' : 'neutral')],
    ['Williams %R (14)', L(ind.willR), (v) => (v < -80 ? 'buy' : v > -20 ? 'sell' : 'neutral')],
    ['MACD (12, 26)', L(ind.macdHist), (v) => (v > 0 ? 'buy' : v < 0 ? 'sell' : 'neutral')],
    ['Momentum (10)', cs.length > 10 ? price - cs[cs.length - 11].c : null, (v) => (v > 0 ? 'buy' : v < 0 ? 'sell' : 'neutral')],
    ['RSI slope', L(ind.rsi) != null && P(ind.rsi) != null ? L(ind.rsi) - P(ind.rsi) : null, (v) => (v > 0 ? 'buy' : v < 0 ? 'sell' : 'neutral')],
  ].map(([name, v, f]) => ({ name, value: round(v, 4), action: v == null ? 'neutral' : f(v) }));
  const c = cs.map((x) => x.c);
  const mas = [];
  for (const n of [10, 20, 30, 50, 100, 200]) {
    if (c.length < n) continue;
    const e = L(ema(c, n)); const s = L(sma(c, n));
    mas.push({ name: `EMA (${n})`, value: round(e, 4), action: price > e ? 'buy' : price < e ? 'sell' : 'neutral' });
    mas.push({ name: `SMA (${n})`, value: round(s, 4), action: price > s ? 'buy' : price < s ? 'sell' : 'neutral' });
  }
  const tally = (list) => ({ buy: list.filter((x) => x.action === 'buy').length, sell: list.filter((x) => x.action === 'sell').length, neutral: list.filter((x) => x.action === 'neutral').length });
  const verdict = (t) => { const n = t.buy + t.sell + t.neutral || 1; const s = (t.buy - t.sell) / n; return s > 0.5 ? 'strong buy' : s > 0.1 ? 'buy' : s < -0.5 ? 'strong sell' : s < -0.1 ? 'sell' : 'neutral'; };
  const to = tally(osc); const tm = tally(mas); const all = { buy: to.buy + tm.buy, sell: to.sell + tm.sell, neutral: to.neutral + tm.neutral };
  return { oscillators: osc, movingAverages: mas, tally: { oscillators: to, movingAverages: tm, all }, verdict: { oscillators: verdict(to), movingAverages: verdict(tm), all: verdict(all) } };
}

// ---------------------------------------------------------- the strategy --

/**
 * The strategy the simulator and the paper bot share: when the ensemble
 * expects a move at `horizon` larger than `edgeX` times the spread, and is
 * at least `minP` sure of the direction, open on that side at the ask or the
 * bid, and close at the horizon at the other side of the spread. The spread
 * is the point — a forecast that is right by less than the spread loses money.
 */
export function signal(f, { spread, edgeX = 1.5, minP = 0.55 }) {
  if (!f) return null;
  const move = f.ens - f.base;
  const p = move > 0 ? f.pUp : 1 - f.pUp;
  if (Math.abs(move) < edgeX * spread || p < minP) return null;
  return { side: move > 0 ? 'buy' : 'sell', expectedMove: move, p };
}

export function backtest(series, { horizon = 60, stride = 10, spread = 0.3, edgeX = 1.5, minP = 0.55, oz = 10, params = {}, weights = {}, start = 600 } = {}) {
  const xs = Float64Array.from(series);
  const trades = [];
  let eq = 0; const curve = [];
  let busyUntil = -1;
  for (let i = start; i + horizon < xs.length; i += stride) {
    if (i < busyUntil) continue;
    const past = xs.subarray(Math.max(0, i - 1900), i + 1);
    const [f] = forecastAll(past, { horizons: [horizon], params, weights });
    const s = signal(f, { spread, edgeX, minP });
    if (!s) continue;
    const mid0 = xs[i]; const mid1 = xs[i + horizon];
    const open = s.side === 'buy' ? mid0 + spread / 2 : mid0 - spread / 2;
    const close = s.side === 'buy' ? mid1 - spread / 2 : mid1 + spread / 2;
    const pnl = (s.side === 'buy' ? close - open : open - close) * oz;
    eq += pnl;
    trades.push({ at: i, side: s.side, open: round(open, 3), close: round(close, 3), pnl: round(pnl, 2), right: Math.sign(mid1 - mid0) === (s.side === 'buy' ? 1 : -1) });
    curve.push(round(eq, 2));
    busyUntil = i + horizon;
  }
  const wins = trades.filter((t) => t.pnl > 0).length;
  const right = trades.filter((t) => t.right).length;
  const gw = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = -trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  // Holding the same ounces for the whole stretch, for comparison.
  const hold = (xs[xs.length - 1] - xs[start]) * oz;
  return {
    trades: trades.length, wins, winRate: trades.length ? round(wins / trades.length, 3) : null,
    directionRight: trades.length ? round(right / trades.length, 3) : null,
    pnl: round(eq, 2), profitFactor: gl ? round(gw / gl, 2) : null, buyAndHold: round(hold, 2),
    spreadCost: round(trades.length * spread * oz, 2), curve, sample: trades.slice(-40), seconds: xs.length - start,
  };
}
