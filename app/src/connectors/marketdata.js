// Market data — quotes and daily history from the public price services.
//
// Yahoo Finance's chart endpoint is the default because it needs no key and
// covers every kind of symbol the desk watches: shares (AAPL), indices
// (^GSPC), currencies (EURUSD=X), futures (GC=F) and crypto (BTC-USD). It is
// unofficial and rate-limited, so Twelve Data and Finnhub sit behind it for
// anyone who gives the connector a key; the quote records which one answered.
//
// One gate pass per batch, not per symbol. The intent written to the chain is
// "refresh these twenty symbols", which is what the company actually decided
// to do, and twenty rows a minute saying the same thing would bury the record.
import { wire } from './wire.js';
import { userAgent } from '../robots.js';

const YAHOO = 'https://query1.finance.yahoo.com';
const TWELVE = 'https://api.twelvedata.com';
const FINNHUB = 'https://finnhub.io/api/v1';

const ua = () => ({ 'user-agent': userAgent() });
const SYMBOL = /^[\w.^=\-]{1,20}$/;

function cleanSymbols(list) {
  const out = [...new Set((Array.isArray(list) ? list : String(list || '').split(','))
    .map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL.test(s)))];
  if (!out.length) throw new Error('no valid symbols');
  return out.slice(0, 60);
}

/** A handful at a time: polite to the service, and still a second or two for a full watchlist. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e.message || e).slice(0, 200) }; }
    }
  }));
  return out;
}

// ------------------------------------------------------------------ yahoo --

async function yahooChart(symbol, range, interval) {
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await wire(url, { headers: ua(), service: 'yahoo', timeout: 12_000 });
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error(data?.chart?.error?.description || `yahoo has no data for ${symbol}`);
  return r;
}

async function yahooQuote(symbol) {
  const r = await yahooChart(symbol, '1d', '5m');
  const m = r.meta || {};
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose ?? m.previousClose;
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  return {
    symbol,
    price,
    prevClose: prev,
    change: price != null && prev ? price - prev : null,
    changePct: price != null && prev ? (price / prev - 1) * 100 : null,
    dayHigh: m.regularMarketDayHigh ?? (closes.length ? Math.max(...closes) : null),
    dayLow: m.regularMarketDayLow ?? (closes.length ? Math.min(...closes) : null),
    volume: m.regularMarketVolume ?? null,
    currency: m.currency || null,
    exchange: m.fullExchangeName || m.exchangeName || null,
    name: m.longName || m.shortName || null,
    kind: kindOf(m.instrumentType, symbol),
    marketState: m.marketState || (m.currentTradingPeriod?.regular && Date.now() / 1000 < m.currentTradingPeriod.regular.end ? 'REGULAR' : null),
    source: 'yahoo',
  };
}

async function yahooHistory(symbol, range = '2y') {
  const r = await yahooChart(symbol, range, '1d');
  const ts = r.timestamp || [];
  const qt = r.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (qt.close?.[i] == null) continue;
    bars.push({
      day: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: qt.open?.[i] ?? null, high: qt.high?.[i] ?? null, low: qt.low?.[i] ?? null,
      close: qt.close[i], volume: qt.volume?.[i] ?? null,
    });
  }
  return { symbol, bars, source: 'yahoo' };
}

function kindOf(t, symbol) {
  const x = String(t || '').toUpperCase();
  if (x === 'CRYPTOCURRENCY' || /-USD[T]?$/.test(symbol)) return 'crypto';
  if (x === 'CURRENCY' || /=X$/.test(symbol)) return 'fx';
  if (x === 'FUTURE' || /=F$/.test(symbol)) return 'commodity';
  if (x === 'INDEX' || symbol.startsWith('^')) return 'index';
  if (x === 'ETF' || x === 'MUTUALFUND') return 'etf';
  return 'stock';
}

// ------------------------------------------------------------- twelvedata --

async function twelveQuotes(symbols, key) {
  const data = await wire(`${TWELVE}/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${encodeURIComponent(key)}`, { service: 'twelvedata' });
  const rows = symbols.length === 1 ? { [symbols[0]]: data } : data;
  return symbols.map((s) => {
    const d = rows?.[s];
    if (!d || d.status === 'error') return { symbol: s, error: d?.message || 'no data' };
    return {
      symbol: s, price: Number(d.close), prevClose: Number(d.previous_close), change: Number(d.change),
      changePct: Number(d.percent_change), dayHigh: Number(d.high), dayLow: Number(d.low), volume: Number(d.volume) || null,
      currency: d.currency || null, exchange: d.exchange || null, name: d.name || null,
      marketState: d.is_market_open ? 'REGULAR' : 'CLOSED', source: 'twelvedata',
    };
  });
}

async function twelveHistory(symbol, key) {
  const d = await wire(`${TWELVE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=520&apikey=${encodeURIComponent(key)}`, { service: 'twelvedata' });
  if (d?.status === 'error') throw new Error(d.message);
  const bars = (d?.values || []).map((v) => ({
    day: v.datetime.slice(0, 10), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume) || null,
  })).reverse();
  return { symbol, bars, source: 'twelvedata' };
}

// ---------------------------------------------------------------- finnhub --

async function finnhubQuote(symbol, key) {
  const d = await wire(`${FINNHUB}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`, { service: 'finnhub' });
  if (!d || !d.c) throw new Error(`finnhub has no quote for ${symbol}`);
  return { symbol, price: d.c, prevClose: d.pc, change: d.d, changePct: d.dp, dayHigh: d.h, dayLow: d.l, volume: null, source: 'finnhub' };
}

// ------------------------------------------------------------------ driver --

/**
 * The order the services are tried in. A key is optional; with one, the keyed
 * service goes first because it is the one with a contract behind it.
 */
function order(ctx) {
  const pref = String(ctx.config?.provider || 'yahoo');
  const key = ctx.credential();
  const list = [pref, 'yahoo', 'twelvedata', 'finnhub'].filter((p, i, a) => a.indexOf(p) === i);
  return list.filter((p) => p === 'yahoo' || key);
}

export async function quotes(symbols, ctx) {
  const syms = cleanSymbols(symbols);
  const key = ctx.credential();
  let pending = syms;
  const got = {};
  for (const p of order(ctx)) {
    if (!pending.length) break;
    let rows;
    if (p === 'twelvedata') rows = await twelveQuotes(pending, key).catch((e) => pending.map((s) => ({ symbol: s, error: e.message })));
    else if (p === 'finnhub') rows = await pool(pending, 3, (s) => finnhubQuote(s, key).then((x) => x, (e) => ({ symbol: s, error: e.message })));
    else rows = await pool(pending, 4, (s) => yahooQuote(s).then((x) => x, (e) => ({ symbol: s, error: e.message })));
    for (const r of rows) if (r && !r.error && Number.isFinite(r.price)) got[r.symbol] = r;
    pending = pending.filter((s) => !got[s]);
  }
  return { quotes: syms.map((s) => got[s] || { symbol: s, error: 'no service answered for this symbol' }) };
}

export async function history(symbol, ctx, range = '2y') {
  const [s] = cleanSymbols([symbol]);
  const key = ctx.credential();
  let lastErr = null;
  for (const p of order(ctx)) {
    try {
      if (p === 'twelvedata') return await twelveHistory(s, key);
      if (p === 'yahoo') return await yahooHistory(s, range);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`no history for ${s}`);
}

export default {
  id: 'marketdata',
  label: 'Market data — Yahoo Finance, Twelve Data, Finnhub',
  auth: { kind: 'api_key', optional: true },
  docs: 'Works with no key (Yahoo Finance). A free Twelve Data or Finnhub key adds a second source; set config.provider to prefer it.',
  quotaDay: 6000,
  capabilities: ['quotes.fetch', 'history.fetch'],
  ops: {
    'quotes.fetch': {
      target: () => 'query1.finance.yahoo.com',
      run: (args, ctx) => quotes(args.symbols, ctx),
    },
    'history.fetch': {
      target: () => 'query1.finance.yahoo.com',
      run: (args, ctx) => history(args.symbol, ctx, args.range || '2y'),
    },
  },
};
