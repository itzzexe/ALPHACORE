// Open data, the second set — what a founder who looks up reads.
//
// The first set (opendata.js) is the ground under the company: rates,
// holidays, weather, the economies it works in. This one is the horizon: the
// whole world's economies for choosing the next market, the governance
// estimates that price its risk, the natural events and the air at its
// places, the day at home by the Hijri calendar, the station overhead, what
// builders are reading and writing about a subject, the papers and the
// repositories appearing in it, who is hiring for it (the companies posting
// in this month's "Who is hiring?" thread), how much attention the public
// pays it — and whether a name is still free as a domain (asked of each
// registry's own RDAP server), a GitHub handle and a package. Every service is free, keyless and HTTPS, and every
// call is a read; opendata.js registers these as its own capabilities so the
// one switch and the one allowlist cover both sets.
import { wire } from './wire.js';
import { userAgent } from '../robots.js';

export const WORLD_HOSTS = {
  air: 'air-quality-api.open-meteo.com',
  eonet: 'eonet.gsfc.nasa.gov',
  aladhan: 'api.aladhan.com',
  iss: 'api.wheretheiss.at',
  pageviews: 'wikimedia.org',
  hn: 'hn.algolia.com',
  hnTop: 'hacker-news.firebaseio.com',
  arxiv: 'export.arxiv.org',
  github: 'api.github.com',
  // The registries' own RDAP servers, from IANA's bootstrap file. Asking them
  // directly spreads the load; rdap.org, which only redirects, refuses after a
  // few names in a row.
  rdapVerisign: 'rdap.verisign.com',
  rdapPir: 'rdap.publicinterestregistry.org',
  rdapIdentity: 'rdap.identitydigital.services',
  rdapGoogle: 'pubapi.registry.google',
  rdapRadix: 'rdap.radix.host',
  rdapCentralnic: 'rdap.centralnic.com',
  npm: 'registry.npmjs.org',
  npmStats: 'api.npmjs.org',
};

const ua = () => ({ 'user-agent': userAgent() });
const get = (url, service, timeout = 15_000, headers = {}) => wire(url, { headers: { ...ua(), ...headers }, service, timeout });

/**
 * GitHub allows sixty keyless reads an hour from one address. If the company
 * has connected GitHub, its token raises that to five thousand — the same
 * token, sent only to api.github.com. Imported when asked, because the
 * connector registry imports this file.
 */
async function githubAuth() {
  try {
    const { credentialFor } = await import('./index.js');
    const token = credentialFor('github');
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}
const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const ISO2 = /^[A-Z]{2}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw text, for the one service here that answers in XML. */
async function getText(url, service, timeout = 20_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { ...ua(), accept: 'application/atom+xml, text/xml' }, signal: ctl.signal });
    const text = (await res.text()).slice(0, 2_000_000);
    if (!res.ok) throw new Error(`${service} ${res.status}`);
    return text;
  } finally { clearTimeout(timer); }
}

/** The status alone, for the services whose 404 is the answer ("nobody has this name"). */
async function probe(url, service, timeout = 12_000, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { ...ua(), accept: 'application/json, application/rdap+json', ...headers }, signal: ctl.signal, redirect: 'follow' });
    const text = (await res.text()).slice(0, 200_000);
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, finalUrl: res.url };
  } catch (e) {
    throw new Error(`${service}: ${String(e.message || e).slice(0, 160)}`);
  } finally { clearTimeout(timer); }
}

// ------------------------------------------------------------ the world --

/**
 * The indicators the market atlas scores on. Size, growth, wealth, the
 * digital reach of a market, its prices and its governance — each the most
 * recent year the World Bank has.
 */
export const WORLD_INDICATORS = {
  gdp: 'NY.GDP.MKTP.CD',
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  population: 'SP.POP.TOTL',
  internet: 'IT.NET.USER.ZS',
  mobile: 'IT.CEL.SETS.P2',
  urban: 'SP.URB.TOTL.IN.ZS',
  inflation: 'FP.CPI.TOTL.ZG',
  trade: 'NE.TRD.GNFS.ZS',
  corruption: 'GOV_WGI_CC.EST',
  regulation: 'GOV_WGI_RQ.EST',
  stability: 'GOV_WGI_PV.EST',
};

export function parseWorld(countryList, perIndicator) {
  const countries = {};
  for (const c of Array.isArray(countryList?.[1]) ? countryList[1] : []) {
    // Aggregates ("Arab World", "Euro area") carry region NA; they are not markets.
    if (!ISO2.test(c.iso2Code || '') || c.region?.id === 'NA') continue;
    countries[c.iso2Code] = {
      code: c.iso2Code, name: c.name, capital: c.capitalCity || null, lat: num(c.latitude), lon: num(c.longitude),
      region: c.region?.value || null, regionId: c.region?.id || null, income: c.incomeLevel?.value || null,
    };
  }
  const indicators = {};
  for (const [key, rows] of Object.entries(perIndicator)) {
    for (const r of Array.isArray(rows?.[1]) ? rows[1] : []) {
      const cc = r.country?.id;
      if (!countries[cc] || r.value === null || r.value === undefined) continue;
      indicators[cc] ||= {};
      if (!indicators[cc][key] || Number(r.date) > Number(indicators[cc][key].year)) indicators[cc][key] = { value: Number(r.value), year: r.date };
    }
  }
  return { countries, indicators };
}

async function worldFetch() {
  const list = await get('https://api.worldbank.org/v2/country?format=json&per_page=400', 'world bank', 30_000);
  const per = {};
  for (const [key, code] of Object.entries(WORLD_INDICATORS)) {
    per[key] = await get(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=500`, 'world bank', 30_000);
  }
  return { ...parseWorld(list, per), source: 'world bank' };
}

// ------------------------------------------------------- the air, the land --

export function parseAir(data, keys) {
  const rows = Array.isArray(data) ? data : [data];
  const out = {};
  rows.forEach((r, i) => { if (r && keys[i]) out[keys[i]] = { aqi: num(r.current?.us_aqi), pm25: num(r.current?.pm2_5), pm10: num(r.current?.pm10), ozone: num(r.current?.ozone) }; });
  return out;
}

async function airFetch({ places }) {
  const list = (Array.isArray(places) ? places : []).filter((p) => p && p.key && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))).slice(0, 20);
  if (!list.length) throw new Error('no places to read the air for');
  const d = await get(`https://${WORLD_HOSTS.air}/v1/air-quality?latitude=${list.map((p) => Number(p.lat).toFixed(3)).join(',')}&longitude=${list.map((p) => Number(p.lon).toFixed(3)).join(',')}&current=us_aqi,pm2_5,pm10,ozone`, 'open-meteo air');
  return { air: parseAir(d, list.map((p) => p.key)), source: 'open-meteo air quality' };
}

export function parseEvents(data) {
  return (data?.events || []).map((e) => {
    const g = (e.geometry || []).at(-1) || {};
    let lon = null; let lat = null;
    if (g.type === 'Point' && Array.isArray(g.coordinates)) [lon, lat] = g.coordinates;
    else if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0])) {
      const ring = g.coordinates[0];
      lon = ring.reduce((a, p) => a + p[0], 0) / ring.length; lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    }
    return {
      id: e.id, title: e.title, category: e.categories?.[0]?.id || 'other', categoryTitle: e.categories?.[0]?.title || null,
      lat: num(lat), lon: num(lon), date: g.date || null, magnitude: num(g.magnitudeValue), unit: g.magnitudeUnit || null,
      link: e.sources?.[0]?.url || e.link || null,
    };
  }).filter((x) => x.lat !== null && x.lon !== null);
}

async function eventsFetch() {
  return { events: parseEvents(await get(`https://${WORLD_HOSTS.eonet}/api/v3/events?status=open&days=30&limit=200`, 'nasa eonet', 25_000)), source: 'nasa eonet' };
}

// ------------------------------------------------------------- the day --

/** Prayer times and the Hijri date at the capital, and when the next Ramadan begins. */
async function dayFetch({ city, country }) {
  const c = String(city || '').slice(0, 80); const cc = String(country || '').toUpperCase();
  if (!c || !ISO2.test(cc)) throw new Error('a city and a country');
  const d = await get(`https://${WORLD_HOSTS.aladhan}/v1/timingsByCity?city=${encodeURIComponent(c)}&country=${cc}&method=3`, 'aladhan');
  const h = d?.data?.date?.hijri || {};
  const year = Number(h.year) || null;
  const month = Number(h.month?.number) || null;
  // The first of Ramadan of this Hijri year, or of next year once it has begun.
  let ramadan = null;
  if (year && month) {
    const y = month >= 9 ? year + 1 : year;
    try {
      const r = await get(`https://${WORLD_HOSTS.aladhan}/v1/hToG/01-09-${y}`, 'aladhan');
      const g = r?.data?.gregorian?.date;
      if (g) { const [dd, mm, yy] = g.split('-'); ramadan = { hijriYear: y, date: `${yy}-${mm}-${dd}` }; }
    } catch { /* the times still stand */ }
  }
  const tm = d?.data?.timings || {};
  return {
    city: c, country: cc,
    timings: Object.fromEntries(['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((k) => [k, String(tm[k] || '').slice(0, 5)])),
    hijri: { day: Number(h.day) || null, month, monthAr: h.month?.ar || null, monthEn: h.month?.en || null, year, holidays: h.holidays || [] },
    gregorian: d?.data?.date?.gregorian?.date || null,
    ramadan,
    inRamadan: month === 9,
    source: 'aladhan',
  };
}

/**
 * Where the International Space Station is now and over the next orbit. Ten
 * positions nine minutes apart are one orbit; the console draws the track
 * and moves the station along it between reads, so one call is half an hour
 * of a satellite crossing the globe.
 */
async function issFetch() {
  const now = Math.floor(Date.now() / 1000);
  const ts = Array.from({ length: 10 }, (_, i) => now + i * 540);
  const rows = await get(`https://${WORLD_HOSTS.iss}/v1/satellites/25544/positions?timestamps=${ts.join(',')}&units=kilometers`, 'wheretheiss');
  return { track: (Array.isArray(rows) ? rows : []).map((r) => ({ t: r.timestamp, lat: num(r.latitude), lon: num(r.longitude), alt: num(r.altitude), vel: num(r.velocity), visibility: r.visibility || null })), source: 'wheretheiss.at' };
}

// ----------------------------------------------------------- a subject --

const dayStr = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Ninety days of how often the public opened a subject's page: attention, measured. */
async function attentionFetch({ title, lang = 'en' }) {
  const t = String(title || '').trim().replace(/ /g, '_').slice(0, 200);
  if (!t) throw new Error('no page to measure');
  const end = new Date(Date.now() - 86400_000); const start = new Date(end.getTime() - 89 * 86400_000);
  const project = `${lang === 'ar' ? 'ar' : 'en'}.wikipedia`;
  try {
    const d = await get(`https://${WORLD_HOSTS.pageviews}/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${encodeURIComponent(t)}/daily/${dayStr(start)}/${dayStr(end)}`, 'wikimedia');
    return { title: t, series: (d?.items || []).map((x) => [`${x.timestamp.slice(0, 4)}-${x.timestamp.slice(4, 6)}-${x.timestamp.slice(6, 8)}`, x.views]), source: 'wikimedia pageviews' };
  } catch (e) {
    if (/ 404:/.test(e.message)) return { title: t, series: [], missing: true, source: 'wikimedia pageviews' };
    throw e;
  }
}

/** Stories builders posted about a subject in the last month, the most discussed first. */
async function hnSearch({ query, days = 30 }) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) throw new Error('nothing to search for');
  const since = Math.floor(Date.now() / 1000) - Math.min(365, Number(days) || 30) * 86400;
  const d = await get(`https://${WORLD_HOSTS.hn}/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i%3E${since}&hitsPerPage=40`, 'hn algolia');
  const hits = (d?.hits || []).map((h) => ({ id: h.objectID, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: num(h.points) || 0, comments: num(h.num_comments) || 0, at: h.created_at }));
  return { query: q, total: num(d?.nbHits) || hits.length, stories: hits.sort((a, b) => b.points - a.points).slice(0, 12), source: 'hacker news' };
}

/** The builders' front page right now. */
async function hnTop() {
  const ids = (await get(`https://${WORLD_HOSTS.hnTop}/v0/topstories.json`, 'hacker news')).slice(0, 12);
  const items = [];
  for (const id of ids) {
    try {
      const it = await get(`https://${WORLD_HOSTS.hnTop}/v0/item/${Number(id)}.json`, 'hacker news', 8000);
      if (it?.title) items.push({ id: it.id, title: it.title, url: it.url || `https://news.ycombinator.com/item?id=${it.id}`, points: num(it.score) || 0, comments: num(it.descendants) || 0, at: it.time ? new Date(it.time * 1000).toISOString() : null });
    } catch { /* one missing story is not the front page */ }
  }
  return { stories: items, source: 'hacker news' };
}

const xml = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseArxiv(text) {
  const total = Number((text.match(/<opensearch:totalResults[^>]*>(\d+)</) || [])[1] || 0);
  const papers = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: xml((e.match(/<id>([\s\S]*?)<\/id>/) || [])[1]),
    title: xml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
    summary: xml((e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]).slice(0, 360),
    published: xml((e.match(/<published>([\s\S]*?)<\/published>/) || [])[1]).slice(0, 10),
    authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => xml(m[1])).slice(0, 4),
  }));
  return { total, papers };
}

/** The newest research on a subject. */
async function papersSearch({ query }) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) throw new Error('nothing to search for');
  const text = await getText(`https://${WORLD_HOSTS.arxiv}/api/query?search_query=all:%22${encodeURIComponent(q)}%22&sortBy=submittedDate&sortOrder=descending&max_results=8`, 'arxiv');
  return { query: q, ...parseArxiv(text), source: 'arxiv' };
}

/** Open-source projects started on a subject in the last quarter, the most starred first. */
async function reposSearch({ query }) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) throw new Error('nothing to search for');
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const d = await get(`https://${WORLD_HOSTS.github}/search/repositories?q=${encodeURIComponent(q)}+created:%3E${since}&sort=stars&order=desc&per_page=8`, 'github', 15_000, await githubAuth());
  return {
    query: q, total: num(d?.total_count) || 0,
    repos: (d?.items || []).map((r) => ({ name: r.full_name, url: r.html_url, stars: num(r.stargazers_count) || 0, language: r.language || null, description: (r.description || '').slice(0, 200), created: String(r.created_at || '').slice(0, 10) })),
    source: 'github',
  };
}

const strip = (html) => String(html || '').replace(/<p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&#x2F;/g, '/').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
const PAY = /(?:[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s?(?:-|–|to)\s?[$€£]?\s?\d[\d,.]*\s?[kK]?)?)/;

/** One posting: "Company | Role | Location | REMOTE | $150k" is the thread's own convention. */
export function parsePosting(h) {
  const text = strip(h.comment_text);
  const head = text.split('\n')[0].slice(0, 300);
  // The convention is pipes; some write dashes. A 'Location:' line is not a company.
  const sep = head.includes('|') ? '|' : / [—–-] /;
  const parts = head.split(sep).map((x) => x.trim()).filter((x) => x && !/^location\s*:/i.test(x));
  return {
    company: (parts[0] || '').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 80) || null,
    role: (parts[1] || '').slice(0, 120) || null,
    // A field longer than a place name is a sentence, not a location.
    location: parts.slice(2).find((x) => x.length <= 40 && !/remote|onsite|on-site|hybrid|full[- ]time|\$/i.test(x)) || null,
    remote: /remote/i.test(head),
    salary: (head.match(PAY) || text.match(PAY) || [null])[0],
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    at: h.created_at,
    text: text.toLowerCase(),
  };
}

/**
 * Who is hiring for a subject: the companies that named it in this month's
 * "Ask HN: Who is hiring?" thread. A thread a thousand companies post in every
 * month is a real count of demand, which a job board that ignores the search
 * word is not.
 */
async function jobsSearch({ query }) {
  const q = String(query || '').trim().slice(0, 80);
  if (!q) throw new Error('nothing to search for');
  const threads = await get(`https://${WORLD_HOSTS.hn}/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5`, 'hn algolia');
  const thread = (threads?.hits || []).find((h) => /who is hiring/i.test(h.title || ''));
  if (!thread) return { query: q, count: 0, thread: null, companies: [], regions: [], withPay: [], latest: [], source: 'hacker news' };
  const d = await get(`https://${WORLD_HOSTS.hn}/api/v1/search?query=${encodeURIComponent(q)}&tags=comment,story_${thread.objectID}&typoTolerance=false&hitsPerPage=100`, 'hn algolia');
  // Top-level postings only: a reply in the thread is a question, not a job.
  // The search forgives typos, which turns a company's name into a dozen others;
  // a posting counts only if every word of the subject is in it.
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const posts = (d?.hits || []).filter((h) => String(h.parent_id) === String(thread.objectID)).map(parsePosting)
    .filter((p) => p.company && words.every((w) => p.text.includes(w)));
  const tally = (f) => Object.entries(posts.reduce((m, p) => { const k = f(p); if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    query: q, count: posts.length, thread: { title: thread.title, url: `https://news.ycombinator.com/item?id=${thread.objectID}` },
    remote: posts.filter((p) => p.remote).length,
    companies: tally((p) => p.company),
    regions: tally((p) => (p.remote ? 'Remote' : p.location)),
    withPay: posts.filter((p) => p.salary).slice(0, 8).map((p) => ({ title: p.role || p.company, company: p.company, salary: p.salary, url: p.url })),
    latest: posts.slice(0, 8).map((p) => ({ title: p.role || '', company: p.company, url: p.url, at: String(p.at || '').slice(0, 10) })),
    source: 'hacker news — who is hiring',
  };
}

// --------------------------------------------------------------- a name --

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Each zone's own RDAP server (IANA's bootstrap). A zone without one cannot be asked, so it is not offered. */
export const RDAP = {
  com: `https://${WORLD_HOSTS.rdapVerisign}/com/v1/`, net: `https://${WORLD_HOSTS.rdapVerisign}/net/v1/`,
  org: `https://${WORLD_HOSTS.rdapPir}/rdap/`, ai: `https://${WORLD_HOSTS.rdapIdentity}/rdap/`,
  app: `https://${WORLD_HOSTS.rdapGoogle}/rdap/`, dev: `https://${WORLD_HOSTS.rdapGoogle}/rdap/`,
  tech: `https://${WORLD_HOSTS.rdapRadix}/rdap/`, xyz: `https://${WORLD_HOSTS.rdapCentralnic}/xyz/`,
};
export const NAME_TLDS = Object.keys(RDAP);

/**
 * Is a domain registered. RDAP is the registry's own answer: a record is a
 * yes and the registry's 404 is a no. Anything else — a refusal, a limit, a
 * timeout — is "cannot say", which is not the same as free.
 */
export function rdapVerdict({ status, data }) {
  if (status === 200 && data?.objectClassName === 'domain') return { state: 'taken', registrar: (data.entities || []).find((e) => (e.roles || []).includes('registrar'))?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || null, expires: (data.events || []).find((e) => e.eventAction === 'expiration')?.eventDate?.slice(0, 10) || null };
  if (status === 404) return { state: 'free' };
  return { state: 'unknown', status };
}

async function domainCheck({ name, tlds = NAME_TLDS }) {
  const label = String(name || '').toLowerCase();
  if (!LABEL.test(label)) throw new Error('a name is letters, digits and hyphens');
  const out = {};
  for (const tld of tlds.filter((x) => RDAP[x])) {
    const url = `${RDAP[tld]}domain/${label}.${tld}`;
    try {
      let r = await probe(url, 'rdap');
      // A registry that asks us to slow down is asked once more, a moment later.
      if (r.status === 429) { await sleep(1500); r = await probe(url, 'rdap'); }
      out[tld] = rdapVerdict(r);
    } catch (e) { out[tld] = { state: 'unknown', why: e.message }; }
    await sleep(150);
  }
  return { name: label, domains: out, source: 'rdap' };
}

async function handleCheck({ name }) {
  const label = String(name || '').toLowerCase();
  if (!LABEL.test(label)) throw new Error('a name is letters, digits and hyphens');
  const gh = await probe(`https://${WORLD_HOSTS.github}/users/${label}`, 'github', 12_000, await githubAuth());
  const npm = await probe(`https://${WORLD_HOSTS.npm}/${label}`, 'npm');
  let downloads = null;
  if (npm.status === 200) {
    try { downloads = num((await get(`https://${WORLD_HOSTS.npmStats}/downloads/point/last-month/${label}`, 'npm'))?.downloads); } catch { /* still taken */ }
  }
  return {
    name: label,
    github: gh.status === 404 ? { state: 'free' } : gh.status === 200 ? { state: 'taken', kind: gh.data?.type || null, url: gh.data?.html_url || null } : { state: 'unknown', status: gh.status, why: gh.status === 403 ? 'GitHub\'s keyless limit for this hour — connect GitHub to raise it' : null },
    npm: npm.status === 404 ? { state: 'free' } : npm.status === 200 ? { state: 'taken', downloads, modified: npm.data?.time?.modified?.slice(0, 10) || null } : { state: 'unknown', status: npm.status },
    source: 'github · npm',
  };
}

/** The capabilities this set adds to the open-data connector. */
export const WORLD_OPS = {
  'world.fetch': { target: () => 'api.worldbank.org', run: () => worldFetch() },
  'air.fetch': { target: () => WORLD_HOSTS.air, run: (a) => airFetch(a) },
  'events.fetch': { target: () => WORLD_HOSTS.eonet, run: () => eventsFetch() },
  'day.fetch': { target: () => WORLD_HOSTS.aladhan, run: (a) => dayFetch(a) },
  'iss.fetch': { target: () => WORLD_HOSTS.iss, run: () => issFetch() },
  'attention.fetch': { target: () => WORLD_HOSTS.pageviews, run: (a) => attentionFetch(a) },
  'stories.search': { target: () => WORLD_HOSTS.hn, run: (a) => hnSearch(a) },
  'frontpage.fetch': { target: () => WORLD_HOSTS.hnTop, run: () => hnTop() },
  'papers.search': { target: () => WORLD_HOSTS.arxiv, run: (a) => papersSearch(a) },
  'repos.search': { target: () => WORLD_HOSTS.github, run: (a) => reposSearch(a) },
  'jobs.search': { target: () => WORLD_HOSTS.hn, run: (a) => jobsSearch(a) },
  // A registry may redirect to the zone's own RDAP server; the gate fences the
  // intent (rdap.org) and the protocol takes it from there.
  // One check asks several registries; the intent is fenced at the first, and
  // every registry's host is on the connector's allowlist.
  'domain.check': { target: () => WORLD_HOSTS.rdapVerisign, run: (a) => domainCheck(a) },
  'handle.check': { target: () => WORLD_HOSTS.github, run: (a) => handleCheck(a) },
};
