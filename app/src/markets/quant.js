// The arithmetic of the markets desk: indicators, a forecast, how good that
// forecast has been, and a score.
//
// All of it deterministic, all of it here rather than in a prompt. A language
// model asked "where will this stock be in a month" produces a confident number
// with nothing behind it; a model asked to *explain* a forecast whose error
// bars and track record it was handed produces something a person can weigh.
// So the numbers are computed, and the model only narrates them.
//
// What this does not pretend: daily returns are close to unpredictable. The
// forecast is a drift-and-volatility model with a damped trend, its bands are
// the honest part, and the backtest beside it says how often the direction
// was right — usually somewhere near a coin toss, which is the finding.

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const std = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const last = (xs) => xs[xs.length - 1];
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Standard normal CDF (Abramowitz–Stegun 7.1.26; error under 1.5e-7). */
export function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ------------------------------------------------------------ indicators --

export function sma(xs, n) {
  const out = new Array(xs.length).fill(null);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(xs, n) {
  const out = new Array(xs.length).fill(null);
  if (xs.length < n) return out;
  const k = 2 / (n + 1);
  let e = mean(xs.slice(0, n));
  out[n - 1] = e;
  for (let i = n; i < xs.length; i++) { e = xs[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

/** Wilder's RSI — the smoothing everyone's charting tool uses, so the number matches theirs. */
export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, sig = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const firstIdx = line.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const sub = ema(line.slice(firstIdx), sig);
    sub.forEach((v, i) => { signal[firstIdx + i] = v; });
  }
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

export function bollinger(closes, n = 20, k = 2) {
  const mid = sma(closes, n);
  return closes.map((c, i) => {
    if (mid[i] == null) return null;
    const sd = std(closes.slice(i - n + 1, i + 1));
    const upper = mid[i] + k * sd; const lower = mid[i] - k * sd;
    return { mid: mid[i], upper, lower, pctB: upper === lower ? 0.5 : (c - lower) / (upper - lower), width: mid[i] ? (upper - lower) / mid[i] : 0 };
  });
}

export function atr(bars, n = 14) {
  if (bars.length <= n) return null;
  const tr = bars.map((b, i) => {
    const h = b.high ?? b.close; const l = b.low ?? b.close;
    if (i === 0) return h - l;
    const pc = bars[i - 1].close;
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  });
  let a = mean(tr.slice(1, n + 1));
  for (let i = n + 1; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

export const logReturns = (closes) => closes.slice(1).map((c, i) => Math.log(c / closes[i]));

/** Annualised volatility over the last `window` sessions (252 a year). */
export function volatility(closes, window = 20) {
  const r = logReturns(closes.slice(-(window + 1)));
  return r.length > 1 ? std(r) * Math.sqrt(252) : null;
}

export function maxDrawdown(closes) {
  let peak = -Infinity; let dd = 0;
  for (const c of closes) { peak = Math.max(peak, c); dd = Math.min(dd, c / peak - 1); }
  return dd;
}

function pctBack(closes, n) {
  if (closes.length <= n) return null;
  return last(closes) / closes[closes.length - 1 - n] - 1;
}

/** Everything the page and the analyst need about one symbol, from daily bars. */
export function summarize(bars) {
  const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 2) return { bars: closes.length, enough: false };
  const m = macd(closes);
  const bb = bollinger(closes);
  const year = closes.slice(-252);
  return {
    bars: closes.length,
    enough: closes.length >= 60,
    last: last(closes),
    sma20: round(last(sma(closes, 20))),
    sma50: round(last(sma(closes, 50))),
    sma200: round(last(sma(closes, 200))),
    ema12: round(last(ema(closes, 12))),
    ema26: round(last(ema(closes, 26))),
    rsi14: round(last(rsi(closes, 14)), 2),
    macd: { line: round(last(m.line)), signal: round(last(m.signal)), hist: round(last(m.hist)), prevHist: round(m.hist[m.hist.length - 2]) },
    bollinger: last(bb) ? { upper: round(last(bb).upper), lower: round(last(bb).lower), pctB: round(last(bb).pctB, 3), width: round(last(bb).width, 4) } : null,
    atr14: round(atr(bars.filter((b) => b.close > 0), 14)),
    vol20: round(volatility(closes, 20), 4),
    vol60: round(volatility(closes, 60), 4),
    hi52: round(Math.max(...year)),
    lo52: round(Math.min(...year)),
    drawdown1y: round(maxDrawdown(year), 4),
    perf: {
      d1: round(pctBack(closes, 1), 4), w1: round(pctBack(closes, 5), 4), m1: round(pctBack(closes, 21), 4),
      m3: round(pctBack(closes, 63), 4), m6: round(pctBack(closes, 126), 4), y1: round(pctBack(closes, 252), 4),
    },
  };
}

// --------------------------------------------------------------- forecast --

/**
 * Drift, volatility and a damped trend, with bands.
 *
 * Volatility is exponentially weighted (λ = 0.94, the RiskMetrics value), so
 * the bands widen the week a market gets nervous rather than a quarter later.
 * The historical drift is shrunk hard towards zero — a year of returns says
 * almost nothing about next month's mean, and an unshrunk drift is how a model
 * learns to forecast that whatever went up keeps going up. The Holt trend on
 * log prices is damped (φ = 0.9) so it fades within a couple of weeks.
 */
export function forecast(closes, horizons = [5, 20, 60]) {
  const xs = closes.filter((c) => Number.isFinite(c) && c > 0).slice(-500);
  if (xs.length < 30) return [];
  const r = logReturns(xs).slice(-250);
  const n = r.length;

  let v = r.slice(0, 20).reduce((a, x) => a + x * x, 0) / Math.min(20, n);
  for (const x of r) v = 0.94 * v + 0.06 * x * x;
  const sigma = Math.sqrt(v);
  const mu = mean(r) * (n / (n + 750));

  // Holt's linear method on log prices.
  const lp = xs.map(Math.log);
  let level = lp[0]; let trend = lp[1] - lp[0];
  for (let i = 1; i < lp.length; i++) {
    const prev = level;
    level = 0.3 * lp[i] + 0.7 * (level + 0.9 * trend);
    trend = 0.05 * (level - prev) + 0.95 * 0.9 * trend;
  }

  const L = Math.log(last(xs));
  return horizons.map((h) => {
    let damp = 0; for (let k = 1; k <= h; k++) damp += 0.9 ** k;
    const m = L + mu * h + 0.5 * trend * damp;
    const sd = sigma * Math.sqrt(h);
    return {
      horizon: h,
      method: 'ewma-drift+damped-holt',
      base: round(last(xs)),
      expected: round(Math.exp(m)),
      low80: round(Math.exp(m - 1.2816 * sd)), high80: round(Math.exp(m + 1.2816 * sd)),
      low95: round(Math.exp(m - 1.96 * sd)), high95: round(Math.exp(m + 1.96 * sd)),
      pUp: round(sd > 0 ? phi((m - L) / sd) : 0.5, 3),
      dailyVol: round(sigma, 5),
    };
  });
}

/**
 * Walk forward through history and score the forecast against what happened.
 *
 * The baseline matters as much as the score: in a market that rose 60% of
 * days, a model that is right 58% of the time is worse than one that always
 * says "up". Both are reported, so the comparison is on the page rather than
 * left to the reader's optimism.
 */
export function backtest(closes, { horizon = 5, step = 5, windows = 40 } = {}) {
  const xs = closes.filter((c) => Number.isFinite(c) && c > 0);
  const results = [];
  for (let end = xs.length - horizon - 1; end >= 60 && results.length < windows; end -= step) {
    const [f] = forecast(xs.slice(0, end + 1), [horizon]);
    if (!f) break;
    const actual = xs[end + horizon];
    results.push({
      hit: Math.sign(f.expected - f.base) === Math.sign(actual - f.base) ? 1 : 0,
      inside: actual >= f.low80 && actual <= f.high80 ? 1 : 0,
      err: Math.abs(actual / f.expected - 1),
      up: actual > f.base ? 1 : 0,
    });
  }
  if (!results.length) return { windows: 0 };
  const upRate = mean(results.map((x) => x.up));
  return {
    windows: results.length,
    horizon,
    directionHit: round(mean(results.map((x) => x.hit)), 3),
    baselineAlwaysMajority: round(Math.max(upRate, 1 - upRate), 3),
    inside80: round(mean(results.map((x) => x.inside)), 3),
    meanAbsErrPct: round(mean(results.map((x) => x.err)) * 100, 2),
  };
}

// ------------------------------------------------------------------ signal --

export const LABELS = ['strong sell', 'sell', 'hold', 'buy', 'strong buy'];
export const labelFor = (s) => (s >= 40 ? 'strong buy' : s >= 15 ? 'buy' : s > -15 ? 'hold' : s > -40 ? 'sell' : 'strong sell');

/**
 * A score from −100 to +100 and the parts it was made of.
 *
 * The parts are returned so the page can show why, and so a person can see
 * when one loud input — a headline, an RSI extreme — is carrying the whole
 * verdict. A score without its reasons is an instruction, not advice.
 */
export function score(sum, fc = [], news = null) {
  if (!sum?.enough) return { score: 0, label: 'hold', components: [{ part: 'data', points: 0, why: 'fewer than sixty sessions of history' }] };
  const c = [];
  const add = (part, points, why) => c.push({ part, points: round(points, 1), why });
  const p = sum.last;
  if (sum.sma50) add('trend', p > sum.sma50 ? 12 : -12, p > sum.sma50 ? 'above its 50-day average' : 'below its 50-day average');
  if (sum.sma50 && sum.sma200) add('trend', sum.sma50 > sum.sma200 ? 12 : -12, sum.sma50 > sum.sma200 ? '50-day above 200-day' : '50-day below 200-day');
  if (sum.perf?.m3 != null) add('momentum', clamp(sum.perf.m3 * 100, -18, 18), `${round(sum.perf.m3 * 100, 1)}% over three months`);
  if (sum.rsi14 != null) {
    if (sum.rsi14 < 30) add('rsi', 12, `RSI ${sum.rsi14}: oversold`);
    else if (sum.rsi14 > 70) add('rsi', -12, `RSI ${sum.rsi14}: overbought`);
    else add('rsi', 0, `RSI ${sum.rsi14}: neutral`);
  }
  if (sum.macd?.hist != null) {
    const crossed = sum.macd.prevHist != null && Math.sign(sum.macd.hist) !== Math.sign(sum.macd.prevHist);
    add('macd', (sum.macd.hist > 0 ? 8 : -8) * (crossed ? 1.5 : 1), `MACD histogram ${sum.macd.hist > 0 ? 'positive' : 'negative'}${crossed ? ', just crossed' : ''}`);
  }
  const f20 = fc.find((f) => f.horizon === 20);
  if (f20) add('forecast', clamp((f20.pUp - 0.5) * 60, -12, 12), `${Math.round(f20.pUp * 100)}% chance of being higher in 20 sessions`);
  if (news && news.n) add('news', clamp(news.avg * 25, -12, 12), `${news.n} recent headlines, mean tone ${round(news.avg, 2)}`);
  if (sum.vol20 != null && sum.vol20 > 0.6) add('risk', -10, `annualised volatility ${Math.round(sum.vol20 * 100)}%`);
  const total = clamp(c.reduce((a, x) => a + x.points, 0), -100, 100);
  return { score: round(total, 1), label: labelFor(total), components: c };
}

/**
 * How much, and where to get out — sized to volatility, not to conviction.
 *
 * The weight targets a contribution to portfolio volatility, so a calm stock
 * gets a larger slice than a wild one at the same score. Stops sit two ATRs
 * away: far enough not to be shaken out by an ordinary day.
 */
export const PROFILES = {
  conservative: { targetVol: 0.10, maxWeight: 0.08 },
  balanced: { targetVol: 0.15, maxWeight: 0.12 },
  aggressive: { targetVol: 0.25, maxWeight: 0.20 },
};
export function sizing(sum, profile = 'balanced', signal = null) {
  const pf = PROFILES[profile] || PROFILES.balanced;
  if (!sum?.last || !sum.vol20) return null;
  const conviction = signal ? clamp(Math.abs(signal.score) / 60, 0, 1) : 0.5;
  const weight = clamp((pf.targetVol / Math.max(sum.vol20, 0.05)) * 0.1 * (0.5 + conviction), 0, pf.maxWeight);
  const a = sum.atr14 || sum.last * (sum.vol20 / Math.sqrt(252));
  return {
    profile,
    weight: round(weight, 4),
    stop: round(sum.last - 2 * a),
    target: round(sum.last + 3 * a),
    riskPerShare: round(2 * a),
  };
}
