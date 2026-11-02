// The gold desk's arithmetic. Pure functions: a series of one-second prices in,
// forecasts, scores, candles and indicators out. No database, no clock, no
// network.
//
// Seven forecasters, each simple enough to read in a minute:
//   naive      the price stays where it is — the baseline every other model
//              has to beat, because at a horizon of seconds it is very hard to
//   drift      the recent average return, carried forward
//   momentum   the recent slope, damped
//   meanrev    a pull back toward a moving average
//   ar         an autoregression on one-second returns, fitted by least squares
//   holt       a smoothed level and a damped trend (Holt's method)
//   learn      a ridge regression of the move ahead on ten features of the
//              recent tape, refitted on the last half hour every time it speaks
// and an ensemble whose weights are earned: after every graded forecast each
// model's weight falls with its squared error (the Hedge rule, with a memory
// that fades so a change of regime is noticed), and the error bands are
// re-fitted from the errors actually made (split conformal), not assumed.
//
// Nothing here claims an edge. The scoreboard reports each model against the
// naive one; at a few seconds gold is close to a random walk, and the page
// says so in numbers.
import { ema, sma, rsi, macd, bollinger, phi } from '../markets/quant.js';

export const MODELS = ['naive', 'drift', 'momentum', 'meanrev', 'ar', 'holt', 'learn'];
export const HORIZONS = [5, 15, 30, 60, 300, 900, 3600];
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** The parameters each model starts with, before the tuner has looked at any data. */
export const DEFAULT_PARAMS = {
  drift: { halfLife: 300 },
  momentum: { lookback: 60, damp: 0.5 },
  meanrev: { window: 300, speed: 0.5 },
  ar: { p: 2, fit: 1800 },
  holt: { alpha: 0.3, beta: 0.02, phi: 0.95, window: 600 },
  learn: { lambda: 1, fit: 1800 },
};

/** The values the tuner tries. Small on purpose: a grid this size is searched every hour in a second or two. */
export const GRID = {
  drift: [{ halfLife: 60 }, { halfLife: 300 }, { halfLife: 1800 }],
  momentum: [15, 30, 60, 120, 300].flatMap((lookback) => [0.25, 0.5, 1].map((damp) => ({ lookback, damp }))),
  meanrev: [60, 180, 600, 1800].flatMap((window) => [0.25, 0.5, 1].map((speed) => ({ window, speed }))),
  ar: [1, 2, 3, 5].map((p) => ({ p, fit: 1800 })),
  holt: [0.1, 0.3, 0.8].flatMap((alpha) => [0.01, 0.05].flatMap((beta) => [0.9, 0.98].map((phi) => ({ alpha, beta, phi, window: 600 })))),
  learn: [0.3, 1, 3].map((lambda) => ({ lambda, fit: 1800 })),
};
export const TUNED = ['drift', 'momentum', 'meanrev', 'ar', 'holt', 'learn'];

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

/** A x = b by Gaussian elimination with partial pivoting; A and b are overwritten. Null when A is singular. */
export function solve(A, b) {
  const p = b.length;
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
  const x = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < p; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Holt's level and trend over the last `window` seconds: the state a damped-trend forecast starts from. */
export function holtState(xs, { alpha, beta, window }) {
  const n = xs.length;
  const s = Math.max(1, n - window);
  let level = xs[s - 1]; let trend = 0;
  for (let i = s; i < n; i++) {
    const prev = level;
    level = alpha * xs[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return { level, trend };
}

// ---------------------------------------------------------- the learner --
//
// Ten numbers describe the tape at a moment: the returns over the last 1, 5,
// 15, 60 and 300 seconds, where the price sits against its one- and
// five-minute averages (in standard deviations), the one-minute volatility,
// where it sits in its one-minute range, and the one-minute return per unit of
// volatility. The learner fits the move `h` seconds later on those numbers by
// ridge regression over the last half hour, then speaks. It has no intercept
// on purpose: a drift measured over half an hour is noise at these horizons,
// and the drift model already carries one.

export const FEATURES = ['r1', 'r5', 'r15', 'r60', 'r300', 'z60', 'z300', 'vol60', 'pos60', 'rr60'];
const LAGS = [1, 5, 15, 60, 300];
const NEED = 301;

/** Running sums, so each feature at each moment costs a subtraction, not a loop. */
function prefixes(xs) {
  const n = xs.length;
  const s1 = new Float64Array(n + 1); const s2 = new Float64Array(n + 1); const q = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    s1[i + 1] = s1[i] + xs[i];
    s2[i + 1] = s2[i] + xs[i] * xs[i];
    const r = i ? (xs[i] / xs[i - 1] - 1) * 1e4 : 0;
    q[i + 1] = q[i] + r * r;
  }
  return { s1, s2, q };
}

/** The ten features at moment t (needs t ≥ 300), in basis points or standard deviations so a ridge penalty means the same at any price. */
export function featuresAt(xs, t, P) {
  const x = xs[t];
  const z = (w) => {
    const m = (P.s1[t + 1] - P.s1[t + 1 - w]) / w;
    const v = Math.max(0, (P.s2[t + 1] - P.s2[t + 1 - w]) / w - m * m);
    return v > 0 ? (x - m) / Math.sqrt(v) : 0;
  };
  let hi = -Infinity; let lo = Infinity;
  for (let i = t - 59; i <= t; i++) { if (xs[i] > hi) hi = xs[i]; if (xs[i] < lo) lo = xs[i]; }
  const vol = Math.sqrt((P.q[t + 1] - P.q[t - 59]) / 60);
  const r = LAGS.map((k) => (x / xs[t - k] - 1) * 1e4);
  return [...r, z(60), z(300), vol, hi > lo ? (x - lo) / (hi - lo) - 0.5 : 0, vol > 0 ? r[3] / (vol * Math.sqrt(60)) : 0];
}

/** Ridge fit of the h-second move on the features over the last `fit` seconds whose outcome is known. Null when there is too little. */
export function fitLearner(xs, h, { lambda = 1, fit = 1800 } = {}, P = prefixes(xs)) {
  const tEnd = xs.length - 1 - h;
  const tStart = Math.max(NEED - 1, tEnd - fit);
  if (tEnd - tStart < 120) return null;
  // Three hundred moments are plenty for ten coefficients, and keep the hourly tuner quick.
  const stride = Math.max(1, Math.floor((tEnd - tStart) / 300));
  const X = []; const y = [];
  for (let t = tStart; t <= tEnd; t += stride) { X.push(featuresAt(xs, t, P)); y.push((xs[t + h] / xs[t] - 1) * 1e4); }
  const k = FEATURES.length; const m = X.length;
  const mu = new Array(k).fill(0); const sd = new Array(k).fill(0);
  for (const row of X) row.forEach((v, j) => { mu[j] += v / m; });
  for (const row of X) row.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / m; });
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)); const b = new Array(k).fill(0);
  for (let r = 0; r < m; r++) {
    const zr = X[r].map((v, j) => (v - mu[j]) / sd[j]);
    for (let i = 0; i < k; i++) { b[i] += zr[i] * y[r]; for (let j = 0; j < k; j++) A[i][j] += zr[i] * zr[j]; }
  }
  for (let i = 0; i < k; i++) A[i][i] += lambda * m;
  const beta = solve(A, b);
  if (!beta) return null;
  // A forecast larger than any move the window held is the fit talking to itself.
  const cap = Math.max(...y.map(Math.abs));
  return { beta, mu, sd, cap };
}

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
  const phiv = solve(A, b);
  if (!phiv) return null;
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
  if (model === 'holt') {
    const key = `${params.alpha}/${params.beta}/${params.window}`;
    const st = fitted?.holt?.[key] || holtState(xs, params);
    if (fitted?.holt) fitted.holt[key] = st;
    // A damped trend adds less each second, so an hour ahead is not sixty one-minute slopes.
    const damp = params.phi >= 1 ? h : (params.phi * (1 - params.phi ** h)) / (1 - params.phi);
    return st.level + st.trend * damp;
  }
  if (model === 'learn') {
    if (n < NEED + 130) return last;
    const P = fitted?.P || prefixes(xs);
    const key = `${h}/${params.lambda}/${params.fit}`;
    const fit = fitted?.learn && key in fitted.learn ? fitted.learn[key] : fitLearner(xs, h, params, P);
    if (fitted?.learn) fitted.learn[key] = fit;
    if (!fit) return last;
    const f = featuresAt(xs, n - 1, P);
    let y = 0;
    for (let j = 0; j < f.length; j++) y += fit.beta[j] * ((f[j] - fit.mu[j]) / fit.sd[j]);
    return last * (1 + Math.max(-fit.cap, Math.min(fit.cap, y)) / 1e4);
  }
  return last;
}

/** Every model at every horizon from one moment, the ensemble beside them, and the band around it. */
export function forecastAll(xs, { horizons = HORIZONS, params = {}, weights = {}, calib = {}, pcal = {} } = {}) {
  const last = xs[xs.length - 1];
  const s1 = sigma1(xs);
  if (!s1 || !last) return [];
  const fitted = { ar: {}, holt: {}, learn: {}, P: prefixes(xs) };
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
    const pRaw = sd > 0 ? phi((ens - last) / sd) : 0.5;
    return {
      horizon: h, base: last, sigma: sd, preds: per, weights: w, ens: round(ens, 4),
      low80: round(ens - k80 * sd, 4), high80: round(ens + k80 * sd, 4), low95: round(ens - k95 * sd, 4), high95: round(ens + k95 * sd, 4),
      pUp: round(pcalApply(pcal[h], pRaw), 3), pRaw: round(pRaw, 4), k80, k95,
    };
  });
}

// ------------------------------------------------------------- learning --

/**
 * Before a horizon has any record, "no change" carries a third of the weight:
 * it is the forecast that is never far wrong, and the others have to earn
 * their share by being graded.
 */
export const PRIOR = { naive: 3, drift: 1, momentum: 1, meanrev: 1, ar: 1, holt: 1, learn: 1 };

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
  // A model that joins an ensemble already running starts at the others'
  // average loss: at zero it would outweigh models with days of record
  // behind them on its very first grade, having proved nothing.
  const had = MODELS.filter((m) => Number.isFinite(L[m]));
  if (had.length && had.length < MODELS.length) {
    const mean = had.reduce((a, m) => a + L[m], 0) / had.length;
    for (const m of MODELS) if (!Number.isFinite(L[m])) L[m] = mean;
  }
  const inc = Object.fromEntries(MODELS.filter((m) => errors[m] != null && Number.isFinite(errors[m])).map((m) => [m, Math.min(25, errors[m] ** 2)]));
  const known = Object.values(inc);
  if (!known.length) return { loss: L, weights: normWeights(state.weights), n: state.n || 0 };
  // A model that said nothing this time — a forecast written before it existed —
  // is charged the round's average: silence must not be the way to gain weight.
  const avg = known.reduce((a, x) => a + x, 0) / known.length;
  for (const m of MODELS) L[m] = (L[m] || 0) * decay + (inc[m] ?? avg);
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

// --------------------------------------------------------- the chances --
//
// "62% up" is a promise about frequency: of all the times the desk says 62%,
// about 62 in 100 should go up. The raw number comes from the ensemble's
// distance from the price in units of its band, which says nothing of the
// kind until it is checked. So each horizon keeps ten bins of what it said and
// what happened, fading slowly, and the number shown is what happened in the
// bin — pooled so it never goes down as the raw number goes up, and leaning on
// the raw number until a bin has seen enough.

const BINS = 10;
const binOf = (p) => Math.min(BINS - 1, Math.max(0, Math.floor(p * BINS)));

export function pcalUpdate(state = null, pRaw, up, { decay = 0.9995 } = {}) {
  const bins = state?.bins?.length === BINS ? state.bins.map((b) => [...b]) : Array.from({ length: BINS }, () => [0, 0]);
  for (const b of bins) { b[0] *= decay; b[1] *= decay; }
  const i = binOf(pRaw);
  bins[i][0] += 1; bins[i][1] += up ? 1 : 0;
  return { bins, n: (state?.n || 0) + 1 };
}

/** Pool adjacent bins until the rates rise with the raw number (pool-adjacent-violators). */
export function pcalCurve(state) {
  if (!state?.bins) return null;
  const blocks = state.bins.map(([n, u], i) => ({ n, u, from: i, to: i }));
  for (let i = 0; i < blocks.length - 1;) {
    const a = blocks[i]; const b = blocks[i + 1];
    const ra = a.n ? a.u / a.n : 0.5; const rb = b.n ? b.u / b.n : 0.5;
    if (a.n && b.n && ra > rb) { blocks.splice(i, 2, { n: a.n + b.n, u: a.u + b.u, from: a.from, to: b.to }); if (i) i--; } else i++;
  }
  const out = new Array(BINS).fill(null);
  for (const b of blocks) for (let i = b.from; i <= b.to; i++) out[i] = { n: b.n, rate: b.n ? b.u / b.n : null };
  return out;
}

export function pcalApply(state, pRaw) {
  const curve = pcalCurve(state);
  if (!curve) return pRaw;
  const c = curve[binOf(pRaw)];
  if (!c?.n || c.rate == null) return pRaw;
  const w = c.n / (c.n + 60);
  return w * c.rate + (1 - w) * pRaw;
}

/** What the desk said against what happened, bin by bin — the reliability diagram the accuracy page draws. */
export function reliability(state) {
  if (!state?.bins) return [];
  return state.bins.map(([n, u], i) => ({ from: i / BINS, to: (i + 1) / BINS, n: round(n, 1), rate: n >= 1 ? round(u / n, 3) : null }));
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

/**
 * How the tuner walks a model. The learner refits at every step, so it is
 * walked a minute at a time: the hourly tuner runs inside the one-second clock
 * and must not stall it. Every setting of one model is still compared on the
 * same moments.
 */
export const tuneOpts = (m, opts = {}) => (m === 'learn' ? { ...opts, stride: Math.max(opts.stride || 20, 60) } : opts);

export function tune(series, horizons = [5, 15, 30, 60, 300], opts = {}) {
  const xs = Float64Array.from(series);
  const out = {};
  for (const h of horizons) {
    if (xs.length < 1800 + h + 60) continue;
    const naive = walkForward(xs, 'naive', {}, h, opts);
    const best = {};
    for (const m of TUNED) {
      let pick = null;
      for (const p of GRID[m]) {
        const r = walkForward(xs, m, p, h, tuneOpts(m, opts));
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

/** Supertrend: a band at `mult` ATRs that follows the price and flips side when it is crossed. */
function supertrend(cs, n = 10, mult = 3) {
  const a = atrSeries(cs, n);
  const line = new Array(cs.length).fill(null); const dir = new Array(cs.length).fill(null);
  let up = null; let dn = null; let d = 1;
  for (let i = 0; i < cs.length; i++) {
    if (a[i] == null) continue;
    const mid = (cs[i].h + cs[i].l) / 2;
    const bu = mid + mult * a[i]; const bl = mid - mult * a[i];
    const pc = i ? cs[i - 1].c : cs[i].c;
    up = up == null || bu < up || pc > up ? bu : up;
    dn = dn == null || bl > dn || pc < dn ? bl : dn;
    if (d === 1 && cs[i].c < dn) d = -1; else if (d === -1 && cs[i].c > up) d = 1;
    line[i] = d === 1 ? dn : up; dir[i] = d;
  }
  return { line, dir };
}

/** Ichimoku: conversion and base lines, and the cloud drawn where it belongs — `shift` candles after the moment it was computed. */
function ichimoku(cs, a = 9, b = 26, c = 52) {
  const mid = (n, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity; let lo = Infinity;
    for (let k = i - n + 1; k <= i; k++) { if (cs[k].h > hi) hi = cs[k].h; if (cs[k].l < lo) lo = cs[k].l; }
    return (hi + lo) / 2;
  };
  const tenkan = cs.map((_, i) => mid(a, i)); const kijun = cs.map((_, i) => mid(b, i));
  const spanA = cs.map((_, i) => { const j = i - b; return j >= 0 && tenkan[j] != null && kijun[j] != null ? (tenkan[j] + kijun[j]) / 2 : null; });
  const spanB = cs.map((_, i) => (i - b >= 0 ? mid(c, i - b) : null));
  return { tenkan, kijun, spanA, spanB };
}

/** Donchian channel: the highest high and lowest low of the last n candles. */
function donchian(cs, n = 20) {
  const up = cs.map((_, i) => (i < n - 1 ? null : Math.max(...cs.slice(i - n + 1, i + 1).map((x) => x.h))));
  const lo = cs.map((_, i) => (i < n - 1 ? null : Math.min(...cs.slice(i - n + 1, i + 1).map((x) => x.l))));
  return { up, lo, mid: up.map((u, i) => (u == null ? null : (u + lo[i]) / 2)) };
}

/** Parabolic SAR: a stop that trails the trend and accelerates with it. */
function psar(cs, step = 0.02, max = 0.2) {
  const out = new Array(cs.length).fill(null);
  if (cs.length < 3) return out;
  let up = cs[1].c >= cs[0].c; let af = step;
  let ep = up ? Math.max(cs[0].h, cs[1].h) : Math.min(cs[0].l, cs[1].l);
  let sar = up ? Math.min(cs[0].l, cs[1].l) : Math.max(cs[0].h, cs[1].h);
  for (let i = 2; i < cs.length; i++) {
    sar += af * (ep - sar);
    sar = up ? Math.min(sar, cs[i - 1].l, cs[i - 2].l) : Math.max(sar, cs[i - 1].h, cs[i - 2].h);
    if (up ? cs[i].l < sar : cs[i].h > sar) {
      up = !up; sar = ep; af = step; ep = up ? cs[i].h : cs[i].l;
    } else if (up ? cs[i].h > ep : cs[i].l < ep) {
      ep = up ? cs[i].h : cs[i].l; af = Math.min(max, af + step);
    }
    out[i] = sar;
  }
  return out;
}

/**
 * The same indicators with the periods a person chose on the screen. The
 * technical summary keeps the standard ones above: a vote is only comparable
 * with everyone else's if it is taken on the same settings.
 */
export function chartIndicators(cs, p) {
  const c = cs.map((x) => x.c);
  const bb = bollinger(c, p.bb[0], p.bb[1]);
  const m = macd(c, p.macd[0], p.macd[1], p.macd[2]);
  const st = stoch(cs, p.stoch[0], p.stoch[1]);
  const sup = supertrend(cs, p.st[0], p.st[1]);
  const ich = ichimoku(cs, p.ichi[0], p.ichi[1], p.ichi[2]);
  const dc = donchian(cs, p.dc);
  return {
    ema: p.ema.map((n) => ema(c, n)), sma: sma(c, p.sma),
    bbUpper: bb.map((b) => b?.upper ?? null), bbMid: bb.map((b) => b?.mid ?? null), bbLower: bb.map((b) => b?.lower ?? null),
    rsi: rsi(c, p.rsi), macd: m.line, macdSignal: m.signal, macdHist: m.hist,
    stochK: st.k, stochD: st.d, cci: cci(cs, p.cci), willR: williams(cs, p.wr), atr: atrSeries(cs, p.atr),
    st: sup.line, stDir: sup.dir, tenkan: ich.tenkan, kijun: ich.kijun, spanA: ich.spanA, spanB: ich.spanB,
    dcUp: dc.up, dcLo: dc.lo, dcMid: dc.mid, sar: psar(cs, p.sar[0], p.sar[1]),
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

/**
 * How much the desk's record at a horizon earns it the right to advise there.
 * A: a week of grades, beating "no change" and calling the direction more
 * often than a coin; B: some record and ahead of both; C: not shown to be
 * better than doing nothing — and C never advises a trade.
 */
export function gradeOf(rec) {
  if (!rec?.n) return 'C';
  if (rec.n >= 300 && rec.skillPct >= 2 && rec.hitRate >= 0.54) return 'A';
  if (rec.n >= 100 && rec.skillPct > 0 && rec.hitRate > 0.51) return 'B';
  return 'C';
}

/**
 * The advice for one horizon, built from its forecast and the desk's own record.
 *
 * The lean is wherever the ensemble points. It becomes a buy or a sell only
 * if everything that has to be true is: the expected move clears the spread
 * by `edgeX`, the calibrated chance of the direction is at least `minP`, the
 * record at this horizon is grade A or B, and the fifteen-minute trend is not
 * against it (unless the chance is high enough to stand alone). Each missing
 * condition is named, so "wait" always says why.
 *
 * The stop sits one 80%-band half-width from the price now, on the losing
 * side: a move against the idea the desk expects about one time in ten. It is
 * measured from the price now, not from the expected price — the band says
 * where the price may be at the horizon, and the stop has to survive the way
 * there. The target is the expected price. The size risks `riskPct` of the
 * book between entry and stop.
 */
export function advise(f, { bid, ask, record = null, trend = 'flat', minP = 0.55, edgeX = 1, aloneP = 0.65, equity = 100_000, riskPct = 0.5, maxOz = 1000 } = {}) {
  if (!f || bid == null || ask == null) return null;
  const spread = ask - bid;
  const move = f.ens - f.base;
  const lean = move >= 0 ? 'buy' : 'sell';
  const dirn = lean === 'buy' ? 1 : -1;
  const p = lean === 'buy' ? f.pUp : 1 - f.pUp;
  const entry = lean === 'buy' ? ask : bid;
  const half = (f.k80 || 1.2816) * f.sigma;
  const stop = f.base - dirn * half;
  const target = f.ens;
  const risk = Math.abs(entry - stop);
  const reward = dirn * (target - entry);
  const grade = gradeOf(record);
  const withTrend = trend === 'flat' ? 'flat' : (trend === 'up') === (lean === 'buy') ? 'with' : 'against';
  const why = [];
  if (Math.abs(move) < edgeX * spread || reward <= 0) why.push('no-edge');
  if (p < minP) why.push('unsure');
  if (grade === 'C') why.push('unproven');
  if (withTrend === 'against' && p < aloneP) why.push('against-trend');
  if (dirn * (entry - stop) <= 0) why.push('no-room');
  // Right often is not enough: a target nearer than the stop has to be right very
  // often to pay. The bracket itself must be worth taking — the chance times what
  // the target pays, less the rest times what the stop costs. A record of signals
  // that won three times in four and still lost money is how this was found.
  const bracket = p * reward - (1 - p) * risk;
  if (bracket <= 0 && !why.includes('no-edge')) why.push('negative-ev');
  const oz = risk > 0 ? Math.min(maxOz, Math.floor(((equity * riskPct) / 100 / risk) * 100) / 100) : 0;
  return {
    horizon: f.horizon, action: why.length ? 'wait' : lean, lean, why,
    p: round(p, 3), expected: round(f.ens, 3), move: round(move, 3), entry: round(entry, 3), stop: round(stop, 3), target: round(target, 3),
    ev: round(Math.abs(move) - spread, 3), bracket: round(bracket, 3), rr: risk > 0 ? round(reward / risk, 2) : null, oz, grade, trend: withTrend, spread: round(spread, 3),
    low80: f.low80, high80: f.high80,
  };
}

/** The advice across horizons: the actionable one with the most expected after the spread per minute held, or wait. */
export function verdict(list) {
  const act = list.filter((a) => a && a.action !== 'wait');
  if (!act.length) return { action: 'wait', horizon: null };
  const best = act.sort((a, b) => b.ev / Math.sqrt(b.horizon) - a.ev / Math.sqrt(a.horizon))[0];
  return { action: best.action, horizon: best.horizon };
}

/**
 * How a signal came out, read from the one-second tape after it was given:
 * whichever of target and stop the closing side of the spread reached first,
 * or the price at the horizon. Null while it is still running.
 */
export function settle(sig, xs, t0, { now }) {
  const due = sig.made_at + sig.horizon * 1000;
  const half = (sig.spread || 0) / 2;
  const buy = sig.side === 'buy';
  const i0 = Math.max(0, Math.ceil((sig.made_at - t0) / 1000));
  const i1 = Math.min(xs.length - 1, Math.floor((Math.min(now, due) - t0) / 1000));
  for (let i = i0; i <= i1; i++) {
    const out = buy ? xs[i] - half : xs[i] + half;
    if (buy ? out >= sig.target : out <= sig.target) return { outcome: 'target', exit: sig.target, at: t0 + i * 1000 };
    if (buy ? out <= sig.stop : out >= sig.stop) return { outcome: 'stop', exit: sig.stop, at: t0 + i * 1000 };
  }
  if (now >= due && i1 >= i0) {
    const out = buy ? xs[i1] - half : xs[i1] + half;
    return { outcome: 'time', exit: round(out, 3), at: t0 + i1 * 1000 };
  }
  return null;
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
