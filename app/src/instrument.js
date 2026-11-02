// Ask about an instrument in your own words — "how is gold doing?", "Apple",
// "ما حالة النفط", "$NVDA" — and get the whole picture in one answer: the
// price, which way each timeframe points, the forecasts with their ranges and
// chances, the levels, the advice and the reasons for it, and how forecasts
// like these have actually done.
//
// Nothing here is new arithmetic. Gold is answered from the gold desk, which
// forecasts by the second and grades itself; anything else from the markets
// desk's daily model, which does the same by the day. This module finds the
// instrument in the question and puts the two desks' numbers in one shape.
//
// A symbol nobody watched before is put on the markets watchlist, by the
// person who asked — its history is fetched through the gate (or simulated,
// on a simulated desk, and said so), and from then on its forecasts are
// written down daily and graded, so the next answer about it carries a record.
import { q, one } from './db.js';
import { audit } from './audit.js';
import * as Gold from './gold.js';
import * as Markets from './markets.js';
import { ema, rsi } from './markets/quant.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const round = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d);
const SYMBOL = /^\^?[A-Z0-9][A-Z0-9.=\-]{0,14}$/;

// The names people use, in both languages. Arabic has no word boundary a
// regular expression knows, so the longer and rarer spellings come first.
const NAMES = [
  [/(ذهب|gold|xau)/i, 'GOLD', 'Gold'],
  [/(فض[ةه]|silver|xag)/i, 'SI=F', 'Silver'],
  [/(برنت|brent)/i, 'BZ=F', 'Brent crude'],
  [/(نفط|النفط|خام|crude|oil|wti)/i, 'CL=F', 'Crude oil'],
  [/(بيتكوين|بتكوين|bitcoin|btc)/i, 'BTC-USD', 'Bitcoin'],
  [/(إيثريوم|ايثريوم|اثيريوم|ethereum)/i, 'ETH-USD', 'Ethereum'],
  [/(آبل|أبل|ابل|apple)/i, 'AAPL', 'Apple'],
  [/(مايكروسوفت|microsoft)/i, 'MSFT', 'Microsoft'],
  [/(إنفيديا|انفيديا|نفيديا|nvidia)/i, 'NVDA', 'NVIDIA'],
  [/(تسلا|tesla)/i, 'TSLA', 'Tesla'],
  [/(أمازون|امازون|amazon)/i, 'AMZN', 'Amazon'],
  [/(جوجل|غوغل|قوقل|google|alphabet)/i, 'GOOGL', 'Alphabet'],
  [/(فيسبوك|ميتا|facebook|\bmeta\b)/i, 'META', 'Meta'],
  [/(نتفليكس|netflix)/i, 'NFLX', 'Netflix'],
  [/(أرامكو|ارامكو|aramco)/i, '2222.SR', 'Saudi Aramco'],
  [/(إس آند بي|اس اند بي|s&p|sp500|spx)/i, '^GSPC', 'S&P 500'],
  [/(ناسداك|nasdaq)/i, '^IXIC', 'Nasdaq Composite'],
  [/(داو جونز|dow jones|\bdow\b)/i, '^DJI', 'Dow Jones'],
  [/(يورو|\beuro\b|eurusd)/i, 'EURUSD=X', 'Euro / dollar'],
];

/**
 * The instrument a question is about, or null. Order: a ticker written as one
 * ($TSLA, AAPL, 2222.SR, GC=F); a name from the list above; a name or symbol
 * already on the watchlist. The question is never sent anywhere to be read.
 */
export function resolve(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const tagged = s.match(/\$([A-Za-z][A-Za-z0-9.^=\-]{0,14})/);
  if (tagged) return { symbol: tagged[1].toUpperCase(), name: null };
  for (const [re, symbol, name] of NAMES) if (re.test(s)) return { symbol, name };
  // A token in capitals is a ticker: "AAPL", "^GSPC", "GC=F", "2222.SR".
  // Two characters at least, so the English "I" is not a company.
  const caps = s.match(/(?:^|[\s,،؟?(])(\^?[A-Z][A-Z0-9]{1,5}(?:[.=-][A-Z0-9]{1,4})?|\d{4}\.[A-Z]{2})(?=$|[\s,،؟?)])/);
  if (caps && SYMBOL.test(caps[1])) return { symbol: caps[1], name: null };
  const lower = s.toLowerCase();
  for (const w of q('SELECT symbol, name FROM mkt_watch')) {
    if (w.name && lower.includes(String(w.name).toLowerCase())) return { symbol: w.symbol, name: w.name };
    if (new RegExp(`(^|[^a-z0-9])${w.symbol.toLowerCase().replace(/[.^=\-]/g, '\\$&')}($|[^a-z0-9])`).test(lower)) return { symbol: w.symbol, name: w.name };
  }
  return null;
}

/**
 * Direction of a series by a fast EMA against a slow one and the slope of the
 * fast, the same rule the gold desk uses. Monthly points are few — two years
 * of history is twenty-four of them — so that timeframe uses 6 and 12.
 */
function direction(c, fast = 20, slow = 50) {
  if (c.length < fast + 5) return null;
  const L = c.length - 1;
  const a = ema(c, fast); const b = c.length > slow ? ema(c, slow) : null;
  const slope = a[L] - a[L - Math.min(5, fast - 1)];
  const above = b ? a[L] > b[L] : c[L] > a[L];
  return above && slope > 0 ? 'up' : !above && slope < 0 ? 'down' : 'flat';
}

function goldAnswer(now) {
  const l = Gold.live({ tf: '1m', bars: 180, now });
  const o = Gold.scoreboard({ days: 7 });
  const tech5 = Gold.live({ tf: '5m', bars: 120, now }).tech;
  const rec = Object.fromEntries(o.map((h) => [h.horizon, h.models.ens || {}]));
  const fc = l.forecasts.map((f) => ({
    horizon: f.horizon, unit: 's', expected: round(f.ens, 3), low80: round(f.low80, 3), high80: round(f.high80, 3), low95: round(f.low95, 3), high95: round(f.high95, 3),
    pUp: f.p_up, record: { n: rec[f.horizon]?.n || 0, hitRate: rec[f.horizon]?.hitRate ?? null, skillPct: rec[f.horizon]?.skillPct ?? null },
  }));
  return {
    kind: 'gold', symbol: 'XAU/USD', name: 'Gold', source: l.source,
    price: l.xau?.mid ?? null, changePct: l.xau?.changePct ?? null, high: l.xau?.high24 ?? null, low: l.xau?.low24 ?? null, period: '24h',
    timeframes: Gold.timeframes({ now }).map((x) => ({ tf: x.tf, dir: x.dir, rsi: x.rsi, change: x.change })),
    forecasts: fc,
    advice: l.advice,
    technical: tech5 ? { verdict: tech5.verdict, tally: tech5.tally } : null,
    levels: l.pivots ? [['S2', l.pivots.s2], ['S1', l.pivots.s1], ['Pivot', l.pivots.pivot], ['R1', l.pivots.r1], ['R2', l.pivots.r2]] : [],
    record: Gold.signalRecord({ hours: 24, now }).all,
    chart: l.candles.map((c) => c.c),
    chartUnit: 60,
    open: '#/gold?tab=terminal',
  };
}

async function symbolAnswer(symbol, name, actor) {
  if (!one('SELECT symbol FROM mkt_watch WHERE symbol = ?', symbol)) {
    Markets.addSymbol({ symbol, name, actor });
  }
  if (!one('SELECT 1 AS x FROM mkt_bars WHERE symbol = ? LIMIT 1', symbol)) await Markets.refreshHistory(symbol, { actor });
  const d = Markets.detail(symbol);
  const a = d.analysis;
  if (!a.summary?.enough) refuse(`not enough history for ${symbol} yet — ${a.bars} sessions; the desk needs sixty`, 409);
  const closes = q('SELECT close FROM mkt_bars WHERE symbol = ? ORDER BY day', symbol).map((r) => r.close);
  const weekly = closes.filter((_, i) => (closes.length - 1 - i) % 5 === 0);
  const monthly = closes.filter((_, i) => (closes.length - 1 - i) % 21 === 0);
  const tf = (label, c, n = 20, fast = 20, slow = 50) => ({ tf: label, dir: direction(c, fast, slow), rsi: round(rsi(c, Math.min(14, c.length - 2))[c.length - 1], 1), change: c.length > n ? round((c[c.length - 1] / c[c.length - 1 - n] - 1) * 100, 2) : null });
  const s = a.summary;
  const bt = { 5: d.backtest, 20: d.backtest20 };
  // The same gate the gold desk keeps: a signal is only as good as the record
  // behind it, and a record that loses to "always the majority direction" has
  // not earned a buy or a sell — it is shown, and marked.
  const proven = [5, 20].some((h) => bt[h]?.windows >= 20 && bt[h].directionHit > bt[h].baselineAlwaysMajority);
  return {
    proven,
    kind: 'symbol', symbol, name: d.name || name || symbol, source: d.source,
    price: d.quote?.price ?? s.last, changePct: s.perf?.d1 != null ? round(s.perf.d1 * 100, 2) : null, high: s.hi52, low: s.lo52, period: '52w',
    timeframes: [tf('1D', closes), tf('1W', weekly), tf('1M', monthly, 6, 6, 12)],
    forecasts: a.forecast.map((f) => ({
      horizon: f.horizon, unit: 'd', expected: f.expected, low80: f.low80, high80: f.high80, low95: f.low95, high95: f.high95, pUp: f.pUp,
      record: bt[f.horizon]?.windows ? { n: bt[f.horizon].windows, hitRate: bt[f.horizon].directionHit, baseline: bt[f.horizon].baselineAlwaysMajority } : null,
    })),
    signal: a.signal,
    sizing: a.sizing,
    perf: s.perf,
    levels: [['52w low', s.lo52], ['SMA 200', s.sma200], ['SMA 50', s.sma50], ['SMA 20', s.sma20], ['52w high', s.hi52], ...(s.bollinger ? [['Bollinger low', s.bollinger.lower], ['Bollinger high', s.bollinger.upper]] : [])].filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]),
    record: d.record,
    news: (d.news || []).slice(0, 4).map((n) => ({ title: n.title, source: n.source, tone: n.sentiment ?? n.tone ?? null, url: n.url || null })),
    chart: closes.slice(-180),
    chartUnit: 86400,
    open: `#/symbol/${encodeURIComponent(symbol)}`,
  };
}

/** The answer to a person's question about an instrument. */
export async function askInstrument({ text, actor, now = Date.now() }) {
  if (!actor) refuse('a question has to name who asked it');
  const question = String(text || '').trim().slice(0, 300);
  if (!question) refuse('ask about gold, a stock, an index or a coin — "how is gold", "Apple", "$NVDA"');
  const r = resolve(question);
  if (!r) refuse('no instrument found in that — name it ("gold", "Apple", "Bitcoin") or write its ticker ("AAPL", "$TSLA", "2222.SR")', 404);
  const answer = r.symbol === 'GOLD' ? goldAnswer(now) : await symbolAnswer(r.symbol, r.name, actor);
  audit({ actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor, action: 'markets.asked', subjectType: 'symbol', subjectId: answer.symbol, payload: { question, kind: answer.kind } });
  return { question, ...answer, at: now, note: 'Analysis and forecasts with their ranges and their record, not financial advice. A forecast is a distribution, not a promise; the record says how often forecasts like it were right.' };
}

