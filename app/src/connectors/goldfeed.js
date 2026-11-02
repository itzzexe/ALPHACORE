// The gold feed — spot gold and silver, bid and ask, a few seconds apart.
//
// Swissquote's public quote feed first, because it carries a real bid and ask
// from a dealing desk: a forecast of gold that ignores the spread is a
// forecast nobody can trade. gold-api.com behind it (a mid price, no key), and
// Yahoo Finance's gold future (GC=F) last, which is a different instrument and
// is labelled as such.
//
// One gate pass is a short window, not one quote: `spot.stream` samples every
// few seconds for ten seconds and returns them all. The intent written to the
// chain is "watch gold for ten seconds", which is what the company decided,
// and eight thousand rows a day saying so is the price of a seconds-level desk.
import { wire } from './wire.js';
import { userAgent } from '../robots.js';

const SWISSQUOTE = 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument';
const GOLDAPI = 'https://api.gold-api.com/price';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const ua = () => ({ 'user-agent': userAgent() });
const METALS = { XAU: 'GC=F', XAG: 'SI=F' };

/** Swissquote answers one entry per trading server, each with prices per spread profile; the tightest is kept. */
export function parseSwissquote(data) {
  const rows = (Array.isArray(data) ? data : []).flatMap((s) => (s.spreadProfilePrices || []).map((p) => ({ bid: Number(p.bid), ask: Number(p.ask), ts: Number(s.ts) || Date.now() })));
  const ok = rows.filter((r) => r.bid > 0 && r.ask >= r.bid).sort((a, b) => (a.ask - a.bid) - (b.ask - b.bid));
  return ok[0] || null;
}

async function one(sym, ctx) {
  const order = ctx.config?.provider ? [ctx.config.provider, 'swissquote', 'goldapi', 'yahoo'] : ['swissquote', 'goldapi', 'yahoo'];
  let lastErr = null;
  for (const p of [...new Set(order)]) {
    try {
      if (p === 'swissquote') {
        const q = parseSwissquote(await wire(`${SWISSQUOTE}/${sym}/USD`, { headers: ua(), service: 'swissquote', timeout: 6000 }));
        if (q) return { sym, ts: Date.now(), bid: q.bid, ask: q.ask, mid: (q.bid + q.ask) / 2, src: 'swissquote' };
      } else if (p === 'goldapi') {
        const d = await wire(`${GOLDAPI}/${sym}`, { headers: ua(), service: 'gold-api', timeout: 6000 });
        if (Number(d?.price) > 0) return { sym, ts: Date.now(), bid: null, ask: null, mid: Number(d.price), src: 'gold-api' };
      } else if (p === 'yahoo') {
        const d = await wire(`${YAHOO}/${encodeURIComponent(METALS[sym])}?range=1d&interval=1m`, { headers: ua(), service: 'yahoo', timeout: 8000 });
        const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (Number(price) > 0) return { sym, ts: Date.now(), bid: null, ask: null, mid: Number(price), src: `yahoo:${METALS[sym]}` };
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`no service answered for ${sym}`);
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

export async function stream({ symbols = ['XAU', 'XAG'], duration = 10, interval = 2 }, ctx) {
  const syms = (Array.isArray(symbols) ? symbols : [symbols]).filter((s) => METALS[s]);
  const ticks = []; const errors = [];
  const until = Date.now() + Math.min(60, Math.max(1, duration)) * 1000;
  const every = Math.min(30, Math.max(1, interval)) * 1000;
  do {
    const started = Date.now();
    for (const s of syms) {
      try { ticks.push(await one(s, ctx)); } catch (e) { errors.push(String(e.message || e).slice(0, 160)); }
    }
    const left = every - (Date.now() - started);
    if (Date.now() + left >= until) break;
    if (left > 0) await sleep(left);
  } while (Date.now() < until);
  return { ticks, errors: [...new Set(errors)].slice(0, 5) };
}

/** One-minute history of the gold future, to give the models a past on a fresh install. */
export async function history({ symbol = 'XAU', range = '1d' }) {
  const d = await wire(`${YAHOO}/${encodeURIComponent(METALS[symbol] || 'GC=F')}?range=${['1d', '5d'].includes(range) ? range : '1d'}&interval=1m`, { headers: ua(), service: 'yahoo', timeout: 12000 });
  const r = d?.chart?.result?.[0];
  const ts = r?.timestamp || []; const c = r?.indicators?.quote?.[0]?.close || [];
  return { symbol, src: `yahoo:${METALS[symbol]}`, ticks: ts.map((t, i) => (c[i] == null ? null : { sym: symbol, ts: t * 1000, bid: null, ask: null, mid: c[i] })).filter(Boolean) };
}

export default {
  id: 'goldfeed',
  label: 'Gold feed — Swissquote, gold-api.com, Yahoo (XAU, XAG)',
  auth: { kind: 'api_key', optional: true },
  docs: 'No key needed. Swissquote supplies bid and ask; gold-api.com a mid price; Yahoo the gold future as a last resort. Set config.provider to prefer one.',
  quotaDay: 12000,
  capabilities: ['spot.stream', 'history.fetch'],
  ops: {
    'spot.stream': { target: () => 'forex-data-feed.swissquote.com', run: (args, ctx) => stream(args, ctx) },
    'history.fetch': { target: () => 'query1.finance.yahoo.com', run: (args) => history(args) },
  },
};
