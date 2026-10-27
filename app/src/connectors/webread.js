// Reading the web to learn — search and pages, for the research loop.
//
// Wikipedia first, through its API, because it needs no key, it is written to
// be read by machines, and it carries its own sources. A search engine is used
// as well when one is configured (Brave, Tavily, SerpAPI — see web.js). Pages
// that are not Wikipedia go through fetchPage, which asks robots.txt, refuses
// private addresses and scans what it reads for injected instructions.
import { wire } from './wire.js';
import { userAgent } from '../robots.js';
import { fetchPage, searchWeb } from '../web.js';

const LANGS = new Set(['en', 'ar']);
const wiki = (lang) => `https://${LANGS.has(lang) ? lang : 'en'}.wikipedia.org`;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'");

export async function search({ query, lang = 'en', count = 4 }) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) throw new Error('nothing to search for');
  const base = wiki(lang);
  const d = await wire(`${base}/w/api.php?action=query&list=search&format=json&srlimit=${count}&srsearch=${encodeURIComponent(q)}`,
    { headers: { 'user-agent': userAgent() }, service: 'wikipedia' });
  const results = (d?.query?.search || []).map((r) => ({
    title: r.title, url: `${base}/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, snippet: strip(r.snippet), engine: 'wikipedia',
  }));
  try {
    const web = await searchWeb(q, { count });
    for (const r of web.results || []) results.push({ ...r, engine: web.engine });
  } catch { /* a search engine is a bonus, not a requirement */ }
  return { query: q, results: results.slice(0, count * 2) };
}

export async function page({ url }) {
  const u = new URL(url);
  const m = u.hostname.match(/^(en|ar)\.wikipedia\.org$/);
  if (m && u.pathname.startsWith('/wiki/')) {
    const title = decodeURIComponent(u.pathname.slice(6));
    const d = await wire(`https://${m[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=9000&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
      { headers: { 'user-agent': userAgent() }, service: 'wikipedia' });
    const pg = Object.values(d?.query?.pages || {})[0];
    if (!pg?.extract) throw new Error(`wikipedia has no article called ${title}`);
    return { url, title: pg.title, text: pg.extract };
  }
  const p = await fetchPage(url);
  if (p.injection && !p.injection.clean) return { url, title: p.title, text: '', flagged: true };
  return { url: p.url || url, title: p.title, text: String(p.text || '').slice(0, 9000) };
}

export default {
  id: 'webread',
  label: 'Web reading — Wikipedia and configured search, for the research loop',
  auth: { kind: 'none' },
  docs: 'Wikipedia needs no key. A Brave, Tavily or SerpAPI key in Settings adds a general search engine.',
  quotaDay: 600,
  capabilities: ['search.fetch', 'page.fetch'],
  ops: {
    'search.fetch': { target: (a) => `${a.lang === 'ar' ? 'ar' : 'en'}.wikipedia.org`, run: (a) => search(a) },
    'page.fetch': { target: (a) => { try { return new URL(a.url).hostname; } catch { return null; } }, run: (a) => page(a) },
  },
};
