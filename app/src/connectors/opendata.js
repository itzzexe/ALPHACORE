// Open data — the free public services a company reads to know where it stands.
//
// Every service here needs no key and answers over HTTPS: exchange rates
// (currency-api, with Frankfurter for the ECB series), public holidays
// (Nager.Date), weather (Open-Meteo), country facts and macro indicators (the
// World Bank), legal entities (GLEIF), EU VAT numbers (VATComply), disposable
// mail domains (Kickbox), open-source advisories (OSV), runtime support dates
// (endoflife.date), earthquakes (USGS) and encyclopaedia summaries (Wikipedia).
// They were picked from the public-apis catalogue for one reason each: a
// department of this company has a decision that the answer changes.
//
// Every capability only reads, and each is named with a read verb so the gate
// and paper-trading mode treat it that way. One gate pass per batch, as the
// market-data driver does: "refresh the indicators for six countries" is one
// decision, not thirty-six.
import { wire } from './wire.js';
import { userAgent } from '../robots.js';
import { WORLD_HOSTS, WORLD_OPS } from './openworld.js';

export const HOSTS = {
  fx: 'cdn.jsdelivr.net',
  ecb: 'api.frankfurter.dev',
  holidays: 'date.nager.at',
  weather: 'api.open-meteo.com',
  worldbank: 'api.worldbank.org',
  gleif: 'api.gleif.org',
  vat: 'api.vatcomply.com',
  mail: 'open.kickbox.com',
  osv: 'api.osv.dev',
  eol: 'endoflife.date',
  quakes: 'earthquake.usgs.gov',
  wiki: 'wikipedia.org',
};

/** Every host either set reaches: the connector's allowlist. */
export const ALL_HOSTS = [...new Set([...Object.values(HOSTS), ...Object.values(WORLD_HOSTS)])];

const ua = () => ({ 'user-agent': userAgent() });
const get = (url, service, timeout = 15_000) => wire(url, { headers: ua(), service, timeout });
const ISO2 = /^[A-Z]{2}$/;
const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));

function countries(list) {
  const out = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[,;]/))
    .map((c) => String(c).trim().toUpperCase()).filter((c) => ISO2.test(c)))];
  if (!out.length) throw new Error('no valid country codes');
  return out.slice(0, 20);
}

// ------------------------------------------------------------- currencies --

// The rates file lists coins next to currencies; the runtime's own list of
// ISO 4217 codes is what separates the dinar from a token.
let ISO4217 = null;
const isoCurrencies = () => (ISO4217 ||= new Set((Intl.supportedValuesOf?.('currency') || []).map((c) => c.toUpperCase())));

export function parseRates(data) {
  const usd = data?.usd || {};
  const rates = {};
  for (const [k, v] of Object.entries(usd)) {
    const code = k.toUpperCase();
    if (isoCurrencies().has(code) && Number.isFinite(v) && v > 0) rates[code] = v;
  }
  rates.USD = 1;
  return { base: 'USD', date: data?.date || null, rates, source: 'currency-api' };
}

async function fxLatest() {
  try {
    return parseRates(await get('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', 'currency-api'));
  } catch (e) {
    // The ECB set is smaller — no dinar, no riyal — but it is a central bank's.
    const d = await get(`https://${HOSTS.ecb}/v1/latest?base=USD`, 'frankfurter');
    return { base: 'USD', date: d?.date || null, rates: { USD: 1, ...(d?.rates || {}) }, source: 'frankfurter', fallbackBecause: String(e.message).slice(0, 160) };
  }
}

const CUR = /^[A-Z]{3}$/;
async function fxSeries({ symbols, days = 90 }) {
  const syms = [...new Set((Array.isArray(symbols) ? symbols : String(symbols || '').split(',')).map((s) => String(s).trim().toUpperCase()).filter((s) => CUR.test(s) && s !== 'USD'))].slice(0, 12);
  if (!syms.length) throw new Error('no currencies to chart');
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(365, Math.max(7, Number(days) || 90)) * 86400_000);
  const d = await get(`https://${HOSTS.ecb}/v1/${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}?base=USD&symbols=${syms.join(',')}`, 'frankfurter', 30_000);
  const series = Object.fromEntries(syms.map((s) => [s, []]));
  for (const [day, row] of Object.entries(d?.rates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const s of syms) if (Number.isFinite(row?.[s])) series[s].push([day, row[s]]);
  }
  return { base: 'USD', series, source: 'frankfurter (ECB)' };
}

// --------------------------------------------------------------- holidays --

export function parseHolidays(list, cc) {
  return (Array.isArray(list) ? list : []).map((h) => ({
    country: cc, date: h.date, name: h.name, localName: h.localName || h.name,
    global: h.global !== false, types: h.types || [],
  }));
}

async function holidays({ countries: list, year }) {
  const y = Number(year) || new Date().getUTCFullYear();
  const out = {};
  for (const cc of countries(list)) {
    const url = `https://${HOSTS.holidays}/api/v3/PublicHolidays/${y}/${cc}`;
    try {
      out[cc] = parseHolidays(await get(url, 'nager.date'), cc);
    } catch (e) {
      // Nager covers about a hundred countries. One it does not cover (a 404)
      // is an answer — no calendar here — not a failure of the whole batch; a
      // timeout is asked once more, and if it fails again it says so rather
      // than claiming the country has no calendar.
      if (/ 404:/.test(e.message)) out[cc] = { unsupported: true };
      else {
        try { out[cc] = parseHolidays(await get(url, 'nager.date'), cc); } catch (e2) { out[cc] = { failed: true, why: String(e2.message).slice(0, 160) }; }
      }
    }
  }
  return { year: y, holidays: out, source: 'nager.date' };
}

// ---------------------------------------------------------------- weather --

export function parseWeather(data, keys) {
  const rows = Array.isArray(data) ? data : [data];
  const out = {};
  rows.forEach((r, i) => {
    if (!r || !keys[i]) return;
    const d = r.daily || {};
    out[keys[i]] = {
      temp: num(r.current?.temperature_2m), code: num(r.current?.weather_code), wind: num(r.current?.wind_speed_10m),
      isDay: r.current?.is_day === 1, timezone: r.timezone || null, utcOffset: num(r.utc_offset_seconds),
      daily: (d.time || []).map((day, k) => ({ day, max: num(d.temperature_2m_max?.[k]), min: num(d.temperature_2m_min?.[k]), code: num(d.weather_code?.[k]) })),
    };
  });
  return out;
}

async function weather({ places }) {
  const list = (Array.isArray(places) ? places : []).filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && p.key).slice(0, 20);
  if (!list.length) throw new Error('no places to read the weather for');
  const lat = list.map((p) => Number(p.lat).toFixed(3)).join(',');
  const lon = list.map((p) => Number(p.lon).toFixed(3)).join(',');
  const d = await get(`https://${HOSTS.weather}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=4&timezone=auto`, 'open-meteo');
  return { weather: parseWeather(d, list.map((p) => p.key)), source: 'open-meteo' };
}

// -------------------------------------------------------------- world bank --

/** The figures a market-entry or a pricing decision actually turns on. */
export const INDICATORS = {
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  inflation: 'FP.CPI.TOTL.ZG',
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  unemployment: 'SL.UEM.TOTL.ZS',
  population: 'SP.POP.TOTL',
  internet: 'IT.NET.USER.ZS',
};

export function parseCountries(data) {
  return Object.fromEntries((Array.isArray(data?.[1]) ? data[1] : []).map((c) => [c.iso2Code, {
    code: c.iso2Code, name: c.name, capital: c.capitalCity || null,
    lat: num(c.latitude), lon: num(c.longitude), region: c.region?.value || null, income: c.incomeLevel?.value || null,
  }]));
}

async function countryFacts({ countries: list }) {
  const cs = countries(list);
  return { countries: parseCountries(await get(`https://${HOSTS.worldbank}/v2/country/${cs.join(';')}?format=json&per_page=100`, 'world bank')), source: 'world bank' };
}

export function parseIndicator(data) {
  const out = {};
  for (const r of Array.isArray(data?.[1]) ? data[1] : []) {
    const cc = r.country?.id;
    if (!cc || r.value === null || r.value === undefined) continue;
    if (!out[cc] || Number(r.date) > Number(out[cc].year)) out[cc] = { value: Number(r.value), year: r.date };
  }
  return out;
}

async function indicators({ countries: list }) {
  const cs = countries(list);
  const out = Object.fromEntries(cs.map((c) => [c, {}]));
  for (const [key, code] of Object.entries(INDICATORS)) {
    const got = parseIndicator(await get(`https://${HOSTS.worldbank}/v2/country/${cs.join(';')}/indicator/${code}?format=json&mrnev=1&per_page=500`, 'world bank'));
    for (const c of cs) if (got[c]) out[c][key] = got[c];
  }
  return { indicators: out, source: 'world bank' };
}

// ---------------------------------------------------------- legal entities --

const LEI = /^[A-Z0-9]{18}[0-9]{2}$/;
export function parseLei(rec) {
  const a = rec?.attributes || {};
  const e = a.entity || {};
  const r = a.registration || {};
  return {
    lei: rec?.id || a.lei, name: e.legalName?.name || null, status: e.status || null,
    jurisdiction: e.jurisdiction || null, country: e.legalAddress?.country || null, city: e.legalAddress?.city || null,
    address: [...(e.legalAddress?.addressLines || []), e.legalAddress?.postalCode, e.legalAddress?.city].filter(Boolean).join(', ') || null,
    form: e.legalForm?.other || e.legalForm?.id || null, category: e.category || null,
    registration: r.status || null, registeredAt: r.initialRegistrationDate || null, renewsAt: r.nextRenewalDate || null,
    corroboration: r.corroborationLevel || null,
  };
}

async function leiSearch({ query }) {
  const qs = String(query || '').trim();
  if (qs.length < 3) throw new Error('give at least three characters');
  if (LEI.test(qs.toUpperCase())) {
    const d = await get(`https://${HOSTS.gleif}/api/v1/lei-records/${qs.toUpperCase()}`, 'gleif');
    return { results: d?.data ? [parseLei(d.data)] : [], source: 'gleif' };
  }
  const d = await get(`https://${HOSTS.gleif}/api/v1/lei-records?filter%5Bfulltext%5D=${encodeURIComponent(qs.slice(0, 120))}&page%5Bsize%5D=8`, 'gleif');
  return { results: (d?.data || []).map(parseLei), source: 'gleif' };
}

async function wikiLookup({ title, lang = 'en' }) {
  const t = String(title || '').trim().slice(0, 200);
  if (!t) throw new Error('nothing to look up');
  const l = lang === 'ar' ? 'ar' : 'en';
  try {
    const d = await get(`https://${l}.${HOSTS.wiki}/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`, 'wikipedia');
    if (d?.type === 'disambiguation') return { found: false, why: 'more than one page has this name', source: 'wikipedia' };
    return { found: true, title: d?.title, description: d?.description || null, extract: d?.extract || null, url: d?.content_urls?.desktop?.page || null, source: 'wikipedia' };
  } catch {
    return { found: false, source: 'wikipedia' };
  }
}

// ------------------------------------------------------- checks on a party --

const VAT = /^[A-Z]{2}[A-Z0-9+*]{2,13}$/;
async function vatCheck({ number }) {
  const n = String(number || '').toUpperCase().replace(/[\s.\-]/g, '');
  if (!VAT.test(n)) throw new Error('a VAT number starts with its two-letter country code');
  const d = await get(`https://${HOSTS.vat}/vat?vat_number=${encodeURIComponent(n)}`, 'vatcomply');
  return { number: n, valid: Boolean(d?.valid), name: d?.name && d.name !== '---' ? d.name : null, address: d?.address && d.address !== '---' ? d.address : null, country: d?.country_code || n.slice(0, 2), source: 'vatcomply (EU VIES)' };
}

const DOMAIN = /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
async function emailCheck({ domain }) {
  const d = String(domain || '').trim().toLowerCase();
  if (!DOMAIN.test(d)) throw new Error('not a mail domain');
  const r = await get(`https://${HOSTS.mail}/v1/disposable/${encodeURIComponent(d)}`, 'kickbox');
  return { domain: d, disposable: Boolean(r?.disposable), source: 'kickbox' };
}

// ------------------------------------------------------------- engineering --

export function severityOf(v) {
  const s = String(v?.database_specific?.severity || '').toUpperCase();
  if (['CRITICAL', 'HIGH', 'MODERATE', 'MEDIUM', 'LOW'].includes(s)) return s === 'MEDIUM' ? 'MODERATE' : s;
  return 'UNKNOWN';
}

function fixedIn(v, name) {
  for (const a of v?.affected || []) {
    if (a.package?.name !== name) continue;
    for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) return e.fixed;
  }
  return null;
}

async function vulnsCheck({ packages, ecosystem = 'npm' }) {
  const list = (Array.isArray(packages) ? packages : []).filter((p) => p && p.name && p.version).slice(0, 300);
  if (!list.length) return { packages: [], source: 'osv' };
  const d = await wire(`https://${HOSTS.osv}/v1/querybatch`, {
    method: 'POST', headers: ua(), service: 'osv', timeout: 20_000,
    body: { queries: list.map((p) => ({ package: { name: p.name, ecosystem }, version: p.version })) },
  });
  const hits = list.map((p, i) => ({ ...p, ids: (d?.results?.[i]?.vulns || []).map((v) => v.id) })).filter((p) => p.ids.length);
  // The batch answers with ids only. The details — how bad, fixed in which
  // version — are read for the first few dozen, which is more than a person
  // will act on in a sitting.
  const details = new Map();
  for (const id of [...new Set(hits.flatMap((h) => h.ids))].slice(0, 40)) {
    try { details.set(id, await get(`https://${HOSTS.osv}/v1/vulns/${encodeURIComponent(id)}`, 'osv')); } catch { /* the id alone still says something */ }
  }
  return {
    packages: hits.map((h) => ({
      name: h.name, version: h.version, dev: Boolean(h.dev),
      vulns: h.ids.map((id) => {
        const v = details.get(id);
        return { id, summary: v?.summary || null, severity: v ? severityOf(v) : 'UNKNOWN', aliases: (v?.aliases || []).filter((a) => a.startsWith('CVE-')).slice(0, 3), fixed: v ? fixedIn(v, h.name) : null };
      }),
    })),
    checked: list.length,
    source: 'osv',
  };
}

async function eolFetch({ product = 'nodejs' }) {
  const p = String(product).toLowerCase().replace(/[^a-z0-9.\-]/g, '').slice(0, 40);
  const d = await get(`https://${HOSTS.eol}/api/v1/products/${p}/`, 'endoflife.date');
  return {
    product: p,
    releases: (d?.result?.releases || []).slice(0, 12).map((r) => ({
      name: r.name, label: r.label, lts: Boolean(r.isLts), eol: Boolean(r.isEol), eolFrom: r.eolFrom || null,
      maintained: Boolean(r.isMaintained), latest: r.latest?.name || null,
    })),
    source: 'endoflife.date',
  };
}

// ------------------------------------------------------------------- quakes --

export function parseQuakes(data) {
  return (data?.features || []).map((f) => ({
    id: f.id, mag: num(f.properties?.mag), place: f.properties?.place || null, time: f.properties?.time ? new Date(f.properties.time).toISOString() : null,
    lon: num(f.geometry?.coordinates?.[0]), lat: num(f.geometry?.coordinates?.[1]), depth: num(f.geometry?.coordinates?.[2]),
    tsunami: Boolean(f.properties?.tsunami), alert: f.properties?.alert || null, url: f.properties?.url || null,
  })).filter((x) => x.lat !== null && x.lon !== null && x.mag !== null);
}

async function quakes() {
  return { quakes: parseQuakes(await get(`https://${HOSTS.quakes}/earthquakes/feed/v1.0/summary/4.5_week.geojson`, 'usgs')), source: 'usgs' };
}

export default {
  id: 'opendata',
  label: 'Open data — rates, holidays, weather, World Bank, GLEIF, VAT, OSV, USGS, NASA, arXiv, GitHub, RDAP',
  auth: { kind: 'none' },
  docs: 'Free public services that need no key. Nothing is written anywhere; every call is a read and passes the gate.',
  quotaDay: 3000,
  capabilities: [
    'fx.fetch', 'fxseries.fetch', 'holidays.fetch', 'weather.fetch', 'countries.fetch', 'indicators.fetch',
    'lei.search', 'wiki.lookup', 'vat.check', 'email.check', 'vulns.check', 'eol.fetch', 'quakes.fetch',
    ...Object.keys(WORLD_OPS),
  ],
  ops: {
    'fx.fetch': { target: () => HOSTS.fx, run: () => fxLatest() },
    'fxseries.fetch': { target: () => HOSTS.ecb, run: (a) => fxSeries(a) },
    'holidays.fetch': { target: () => HOSTS.holidays, run: (a) => holidays(a) },
    'weather.fetch': { target: () => HOSTS.weather, run: (a) => weather(a) },
    'countries.fetch': { target: () => HOSTS.worldbank, run: (a) => countryFacts(a) },
    'indicators.fetch': { target: () => HOSTS.worldbank, run: (a) => indicators(a) },
    'lei.search': { target: () => HOSTS.gleif, run: (a) => leiSearch(a) },
    'wiki.lookup': { target: (a) => `${a.lang === 'ar' ? 'ar' : 'en'}.${HOSTS.wiki}`, run: (a) => wikiLookup(a) },
    'vat.check': { target: () => HOSTS.vat, run: (a) => vatCheck(a) },
    'email.check': { target: () => HOSTS.mail, run: (a) => emailCheck(a) },
    'vulns.check': { target: () => HOSTS.osv, run: (a) => vulnsCheck(a) },
    'eol.fetch': { target: () => HOSTS.eol, run: (a) => eolFetch(a) },
    'quakes.fetch': { target: () => HOSTS.quakes, run: () => quakes() },
    ...WORLD_OPS,
  },
};
