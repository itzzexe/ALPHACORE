// Live data — the world outside, read on a clock and kept for the departments
// that need it.
//
// The company already knows its own numbers. What it does not know by itself
// is what a dinar buys today, which days next month the office is shut, how
// the economies it sells into are moving, whether a counterparty is a
// registered legal entity, whether a dependency in one of its apps has a
// published advisory, and whether the ground moved near a place it works.
// Each of those is a free public service, and each answer is kept here with
// the time it was read, so a page shows the last good answer and says how old
// it is rather than going blank when a service has a bad hour.
//
// Three rules shape it.
//
// It is off until a person switches it on. Reading changes nothing out there,
// but it is the platform reaching the world on a clock, so it is a person's
// decision and the chain records it — the same rule as the markets desk.
//
// Everything passes the gate. The driver (connectors/opendata.js) is called
// through callConnector, so each read is an egress row with its intent, and
// the connector's allowlist holds it to the services named below.
//
// Nothing is invented. A service that has not answered shows as not read yet;
// there is no simulated feed, because a made-up exchange rate that looks real
// is worse than none.
import { q, one, exec } from './db.js';
import { callConnector, connect, setConnectorState } from './connectors/index.js';
import { HOSTS, ALL_HOSTS, INDICATORS } from './connectors/opendata.js';
import { WORLD_HOSTS } from './connectors/openworld.js';
import { getSetting } from './settings.js';
import { homeCountry, overview as globeOverview } from './globe.js';
import { listProjects, projectRow, projectDir } from './forge.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const parse = (s, f = null) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const SYSTEM = 'system:livedata';

/**
 * Every service, what it is for, and how long an answer stays good. The
 * category is the public-apis catalogue's, so anyone can find the service
 * again; the minutes are how often the thing itself changes, not how often
 * we would like to look.
 */
export const SOURCES = [
  { id: 'fx', label: 'Exchange rates', service: 'currency-api', host: HOSTS.fx, category: 'Currency Exchange', ttl: 60, capability: 'fx.fetch', for: 'Finance, remittances, what-if — every currency against the dollar, the dinar and the riyal included' },
  { id: 'fxseries', label: 'Rate history', service: 'Frankfurter (ECB)', host: HOSTS.ecb, category: 'Currency Exchange', ttl: 720, capability: 'fxseries.fetch', for: 'Ninety days of the central-bank series, for the trend beside each rate' },
  { id: 'holidays', label: 'Public holidays', service: 'Nager.Date', host: HOSTS.holidays, category: 'Calendar', ttl: 4320, capability: 'holidays.fetch', for: 'Shifts, deadlines and payment runs — the days each country the company works in is shut' },
  { id: 'weather', label: 'Weather', service: 'Open-Meteo', host: HOSTS.weather, category: 'Weather', ttl: 30, capability: 'weather.fetch', for: 'Now and the next three days at each place the company works, on the globe' },
  { id: 'countries', label: 'Country facts', service: 'World Bank', host: HOSTS.worldbank, category: 'Open Data', ttl: 10080, capability: 'countries.fetch', for: 'Capital, region and income group of every country in the record' },
  { id: 'indicators', label: 'Economic indicators', service: 'World Bank', host: HOSTS.worldbank, category: 'Open Data', ttl: 10080, capability: 'indicators.fetch', for: 'Growth, inflation, income, unemployment, population, internet use — for pricing and market entry' },
  { id: 'quakes', label: 'Earthquakes', service: 'USGS', host: HOSTS.quakes, category: 'Science & Math', ttl: 15, capability: 'quakes.fetch', for: 'Continuity: magnitude 4.5 and above this week, and which ones were near a place the company works' },
  { id: 'eol', label: 'Runtime support', service: 'endoflife.date', host: HOSTS.eol, category: 'Development', ttl: 1440, capability: 'eol.fetch', for: 'Whether the Node.js this platform runs on still receives security fixes' },
  { id: 'lei', label: 'Legal entities', service: 'GLEIF', host: HOSTS.gleif, category: 'Business', ttl: 10080, capability: 'lei.search', for: 'KYC and AML: is a counterparty a registered legal entity, where, and is its record current' },
  { id: 'wiki', label: 'Encyclopaedia', service: 'Wikipedia', host: HOSTS.wiki, category: 'Open Data', ttl: 10080, capability: 'wiki.lookup', for: 'A paragraph about a company or a place, with the page it came from' },
  { id: 'vat', label: 'EU VAT numbers', service: 'VATComply (VIES)', host: HOSTS.vat, category: 'Currency Exchange', ttl: 1440, capability: 'vat.check', for: 'Vendors and customers in the EU: is the VAT number real, and whose is it' },
  { id: 'mail', label: 'Disposable mail', service: 'Kickbox', host: HOSTS.mail, category: 'Email', ttl: 43200, capability: 'email.check', for: 'Intake and sales: is a sign-up from a throwaway inbox' },
  { id: 'osv', label: 'Open-source advisories', service: 'OSV', host: HOSTS.osv, category: 'Security', ttl: 720, capability: 'vulns.check', for: 'The engineering floor: published vulnerabilities in the packages an app depends on' },
  { id: 'world', label: 'Every economy', service: 'World Bank', host: HOSTS.worldbank, category: 'Open Data', ttl: 10080, capability: 'world.fetch', for: 'The market atlas: twelve figures for all 217 economies, governance estimates included' },
  { id: 'air', label: 'Air quality', service: 'Open-Meteo Air Quality', host: WORLD_HOSTS.air, category: 'Environment', ttl: 60, capability: 'air.fetch', for: 'The air at each place the company works — for the people in it' },
  { id: 'events', label: 'Natural events', service: 'NASA EONET', host: WORLD_HOSTS.eonet, category: 'Science & Math', ttl: 180, capability: 'events.fetch', for: 'Wildfires, storms, volcanoes and floods still open, and which are near a place the company works' },
  { id: 'day', label: 'The day at home', service: 'Aladhan', host: WORLD_HOSTS.aladhan, category: 'Calendar', ttl: 360, capability: 'day.fetch', for: 'The Hijri date, prayer times at the capital, and how far away Ramadan is — for hours, shifts and plans' },
  { id: 'iss', label: 'The station overhead', service: 'wheretheiss.at', host: WORLD_HOSTS.iss, category: 'Science & Math', ttl: 30, capability: 'iss.fetch', for: 'Where the International Space Station is, drawn crossing the globe' },
  { id: 'frontpage', label: 'What builders read', service: 'Hacker News', host: WORLD_HOSTS.hnTop, category: 'News', ttl: 60, capability: 'frontpage.fetch', for: 'The front page the technical world is reading right now' },
  { id: 'attention', label: 'Public attention', service: 'Wikimedia pageviews', host: WORLD_HOSTS.pageviews, category: 'Open Data', ttl: 720, capability: 'attention.fetch', for: 'The radar: ninety days of how often people opened a subject\'s page' },
  { id: 'stories', label: 'Stories', service: 'Hacker News search', host: WORLD_HOSTS.hn, category: 'News', ttl: 360, capability: 'stories.search', for: 'The radar: what builders posted about a subject this month' },
  { id: 'papers', label: 'Research', service: 'arXiv', host: WORLD_HOSTS.arxiv, category: 'Science & Math', ttl: 720, capability: 'papers.search', for: 'The radar: the newest papers on a subject' },
  { id: 'repos', label: 'Open-source projects', service: 'GitHub', host: WORLD_HOSTS.github, category: 'Development', ttl: 720, capability: 'repos.search', for: 'The radar: projects started on a subject this quarter, the most starred first' },
  { id: 'jobs', label: 'Who is hiring', service: 'Hacker News — Who is hiring?', host: WORLD_HOSTS.hn, category: 'Jobs', ttl: 720, capability: 'jobs.search', for: 'The radar: the companies that named a subject in this month\'s hiring thread — how many, where, at what pay' },
  { id: 'domain', label: 'Domain names', service: 'RDAP — the registries', host: WORLD_HOSTS.rdapVerisign, category: 'Development', ttl: 1440, capability: 'domain.check', for: 'The naming studio: is a name registered, asked of eight zones\' own registries' },
  { id: 'handle', label: 'Handles and packages', service: 'GitHub · npm', host: WORLD_HOSTS.github, category: 'Development', ttl: 1440, capability: 'handle.check', for: 'The naming studio: is a name free as a GitHub handle and an npm package' },
];
const TTL = Object.fromEntries(SOURCES.map((s) => [s.id, s.ttl]));
const CAP = Object.fromEntries(SOURCES.map((s) => [s.id, s.capability]));

// The currency of each country, because neither the runtime nor the World
// Bank says. Countries that use another's currency say so.
const CURRENCY = Object.fromEntries('AD:EUR AE:AED AF:AFN AG:XCD AL:ALL AM:AMD AO:AOA AR:ARS AT:EUR AU:AUD AZ:AZN BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BN:BND BO:BOB BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR EG:EGP ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FR:EUR GA:XAF GB:GBP GD:XCD GE:GEL GH:GHS GM:GMD GN:GNF GQ:XAF GR:EUR GT:GTQ GW:XOF GY:GYD HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IN:INR IQ:IQD IR:IRR IS:ISK IT:EUR JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KZ:KZT LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD MC:EUR MD:MDL ME:EUR MG:MGA MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MR:MRU MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD NE:XOF NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NZ:NZD OM:OMR PA:PAB PE:PEN PG:PGK PH:PHP PK:PKR PL:PLN PS:ILS PT:EUR PY:PYG QA:QAR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SI:EUR SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP SV:USD SY:SYP SZ:SZL TD:XAF TG:XOF TH:THB TJ:TJS TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VE:VES VN:VND VU:VUV WS:WST YE:YER ZA:ZAR ZM:ZMW ZW:ZWL'
  .split(' ').map((p) => p.split(':')));
export const currencyOf = (cc) => CURRENCY[String(cc || '').toUpperCase()] || null;

/** The rates a person reads first, before the ones the company's own places add. */
const MAJORS = ['EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'SAR', 'AED', 'TRY', 'INR'];

// ------------------------------------------------------------------ state --

export function isLive() {
  return one("SELECT state FROM connectors WHERE id = 'opendata'")?.state === 'live';
}

/** The connector, registered with its fence: these hosts and no others. */
function ensureConnector() {
  if (!one("SELECT id FROM connectors WHERE id = 'opendata'")) {
    exec(`INSERT INTO connectors (id, driver, label, config, scopes, allowlist, quota_day, state)
          VALUES ('opendata', 'opendata', 'Open data', '{}', ?, ?, 3000, 'disconnected')`,
    JSON.stringify(SOURCES.map((s) => s.capability)), JSON.stringify(ALL_HOSTS));
  } else {
    exec("UPDATE connectors SET allowlist = ?, scopes = ? WHERE id = 'opendata'",
      JSON.stringify(ALL_HOSTS), JSON.stringify(SOURCES.map((s) => s.capability)));
  }
}

export function goLive({ actor }) {
  if (!isHuman(actor)) refuse('a person switches live data on', 403);
  ensureConnector();
  connect('opendata', { secret: null, actor });
  setConnectorState('opendata', 'live', { actor });
  lastRefresh = 0;
  return { live: isLive() };
}

export function pause({ actor }) {
  if (!isHuman(actor)) refuse('a person switches live data off', 403);
  ensureConnector();
  setConnectorState('opendata', 'paused', { actor });
  return { live: isLive() };
}

// ------------------------------------------------------------------ cache --

const ageMin = (ts) => (ts ? (Date.now() - Date.parse(`${String(ts).replace(' ', 'T')}Z`)) / 60_000 : Infinity);

// The world's list is a hundred kilobytes; a page reads it a dozen times. The
// parsed answer is kept until the row changes.
const memo = new Map();
export function read(source, key) {
  const r = one('SELECT fetched_at, tried_at, error, LENGTH(payload) AS size FROM od_cache WHERE source = ? AND key = ?', source, key);
  if (!r) return null;
  const k = `${source}\u0000${key}`;
  let m = memo.get(k);
  if (!m || m.fetchedAt !== r.fetched_at || m.size !== r.size) {
    m = { fetchedAt: r.fetched_at, size: r.size, data: parse(one('SELECT payload FROM od_cache WHERE source = ? AND key = ?', source, key)?.payload) };
    memo.set(k, m);
  }
  return { data: m.data, fetchedAt: r.fetched_at, triedAt: r.tried_at, error: r.error };
}

function store(source, key, { data = undefined, error = null }) {
  if (data !== undefined) {
    exec(`INSERT INTO od_cache (source, key, payload, error, fetched_at, tried_at) VALUES (?,?,?,NULL, datetime('now'), datetime('now'))
          ON CONFLICT(source, key) DO UPDATE SET payload = excluded.payload, error = NULL, fetched_at = excluded.fetched_at, tried_at = excluded.tried_at`,
    source, key, JSON.stringify(data));
  } else {
    // A failure keeps the last good answer; it only says the last try failed.
    exec(`INSERT INTO od_cache (source, key, payload, error, tried_at) VALUES (?,?, NULL, ?, datetime('now'))
          ON CONFLICT(source, key) DO UPDATE SET error = excluded.error, tried_at = excluded.tried_at`,
    source, key, String(error).slice(0, 300));
  }
}

/**
 * The fallback for exchange rates is the ECB's set, which has no dinar and no
 * riyal. Taking its answer whole would make the company's own currency vanish
 * on the day the main service is down, so the currencies it does not publish
 * keep their last rate, and are named as carried over.
 */
const MERGE = {
  fx: (next, prev) => {
    if (!next?.fallbackBecause || !prev?.rates) return next;
    const carried = Object.keys(prev.rates).filter((c) => !(c in next.rates));
    return { ...next, rates: { ...Object.fromEntries(carried.map((c) => [c, prev.rates[c]])), ...next.rates }, carried, carriedFrom: prev.carriedFrom || prev.date };
  },
};

const inflight = new Map();

/**
 * The answer for one question, from the cache while it is good and from the
 * service when it is not. A service that just failed is not asked again for
 * a quarter of an hour, so one bad hour out there is a handful of rows in the
 * egress log, not one every tick.
 */
export async function pull(source, key, args, { actor = SYSTEM, reason = '', force = false } = {}) {
  const row = read(source, key);
  if (!isLive()) return row;
  if (!force && row?.fetchedAt && ageMin(row.fetchedAt) < TTL[source]) return row;
  if (!force && row?.error && ageMin(row.triedAt) < Math.min(15, TTL[source])) return row;
  const k = `${source}\u0000${key}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    try {
      const r = await callConnector({
        connector: 'opendata', capability: CAP[source], args, actor, reason: reason || `read ${source} for ${key}`,
        // The answer is kept in od_cache with its time; a second copy in the
        // append-forever egress log would be most of a megabyte a day.
        logResult: `kept in od_cache as ${source}/${key}`,
      });
      if (r.verdict === 'allowed') store(source, key, { data: MERGE[source] ? MERGE[source](r.result, row?.data) : r.result });
      else store(source, key, { error: r.why || r.verdict });
    } catch (e) {
      store(source, key, { error: e.message || e });
    }
    return read(source, key);
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

// ----------------------------------------------------------------- places --

/**
 * Where the company works: home, then the countries the record ties it to
 * most. Eight at most — a weather strip for forty countries is noise.
 */
export function placeCodes() {
  const home = homeCountry();
  const ties = safe(() => globeOverview().countries.map((c) => c.code), []);
  return [...new Set([home, ...ties].filter(Boolean))].slice(0, 8);
}

/** What is known about every country: the whole world's list, with the places' own read on top. */
export function facts() { return { ...(read('world', 'all')?.data?.countries || {}), ...(read('countries', 'all')?.data?.countries || {}) }; }

export function places() {
  const f = facts();
  const w = read('weather', 'places')?.data?.weather || {};
  const air = read('air', 'places')?.data?.air || {};
  const home = homeCountry();
  return placeCodes().map((code) => {
    const c = f[code] || {};
    return { code, home: code === home, capital: c.capital || null, lat: c.lat ?? null, lon: c.lon ?? null, region: c.region || null, income: c.income || null, currency: currencyOf(code), weather: w[code] || null, air: air[code] || null };
  });
}

export function homeCurrency() {
  const set = String(getSetting('COMPANY_CURRENCY') || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(set) ? set : (currencyOf(homeCountry()) || 'USD');
}

// --------------------------------------------------------------- refresh --

let lastRefresh = 0;
let refreshing = false;

/** Everything that has gone stale, in an order that lets each read use the last. */
export async function refreshDue({ actor = SYSTEM, force = false } = {}) {
  if (!isLive()) return { skipped: 'live data is off' };
  if (refreshing) return { skipped: 'already refreshing' };
  refreshing = true;
  try {
    const codes = placeCodes();
    const year = new Date().getUTCFullYear();
    const opt = { actor, force };
    if (codes.length) {
      await pull('countries', 'all', { countries: codes }, { ...opt, force: force || codes.some((c) => !facts()[c]) });
      const located = places().filter((p) => p.lat !== null && p.lon !== null);
      if (located.length) {
        const at = located.map((p) => ({ key: p.code, lat: p.lat, lon: p.lon }));
        await pull('weather', 'places', { places: at }, opt);
        await pull('air', 'places', { places: at }, opt);
      }
      const home = places().find((p) => p.home && p.capital);
      // Keyed by the date, so a new day is a new read.
      if (home) await pull('day', `${home.code}:${new Date().toISOString().slice(0, 10)}`, { city: home.capital, country: home.code }, opt);
      await pull('holidays', String(year), { countries: codes, year }, opt);
      // December looks into January.
      if (new Date().getUTCMonth() === 11) await pull('holidays', String(year + 1), { countries: codes, year: year + 1 }, opt);
      await pull('indicators', 'all', { countries: codes }, opt);
    }
    await pull('fx', 'USD', {}, opt);
    await pull('quakes', 'week', {}, opt);
    await pull('eol', 'nodejs', { product: 'nodejs' }, opt);
    await pull('events', 'open', {}, opt);
    await pull('iss', 'track', {}, opt);
    await pull('frontpage', 'top', {}, opt);
    await pull('world', 'all', {}, opt);
    const ecb = new Set(Object.keys(read('fx', 'USD')?.data?.rates || {}));
    const series = [...new Set([...MAJORS, homeCurrency(), ...places().map((p) => p.currency)])].filter((c) => c !== 'USD' && FRANKFURTER.has(c) && ecb.has(c));
    if (series.length) await pull('fxseries', 'majors', { symbols: series, days: 90 }, opt);
    lastRefresh = Date.now();
    return { refreshed: true };
  } finally {
    refreshing = false;
  }
}

// The currencies the ECB publishes, so the history is not asked for a dinar it does not have.
const FRANKFURTER = new Set('AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR'.split(' '));

// ------------------------------------------------------------------ reads --

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
export function km(a, b) {
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** A quake is "near" a place within this distance of its capital — roughly where it would be felt. */
const NEAR_KM = 600;

export function quakes() {
  const row = read('quakes', 'week');
  const located = places().filter((p) => p.lat !== null);
  const list = (row?.data?.quakes || []).map((x) => {
    let near = null;
    for (const p of located) {
      const d = km(x, p);
      if (d <= NEAR_KM && (!near || d < near.km)) near = { code: p.code, km: d };
    }
    return { ...x, near };
  }).sort((a, b) => b.mag - a.mag);
  return { fetchedAt: row?.fetchedAt || null, list: list.slice(0, 60), near: list.filter((x) => x.near) };
}

/** Natural events still open: the near ones (within this of a place's capital) first. */
const EVENT_NEAR_KM = 500;
export function naturalEvents() {
  const row = read('events', 'open');
  const located = places().filter((p) => p.lat !== null);
  const list = (row?.data?.events || []).map((x) => {
    let near = null;
    for (const p of located) { const d = km(x, p); if (d <= EVENT_NEAR_KM && (!near || d < near.km)) near = { code: p.code, km: d }; }
    return { ...x, near };
  });
  const counts = list.reduce((m, x) => { m[x.category] = (m[x.category] || 0) + 1; return m; }, {});
  return { fetchedAt: row?.fetchedAt || null, list: [...list.filter((x) => x.near), ...list.filter((x) => !x.near)].slice(0, 120), near: list.filter((x) => x.near), counts };
}

/** The day at home: the Hijri date, the prayer times and the next one, and Ramadan. */
export function day() {
  const home = homeCountry();
  if (!home) return null;
  const row = one("SELECT * FROM od_cache WHERE source = 'day' AND key LIKE ? AND payload IS NOT NULL ORDER BY fetched_at DESC LIMIT 1", `${home}:%`);
  const d = row ? parse(row.payload) : null;
  if (!d) return null;
  const tz = safe(() => read('weather', 'places')?.data?.weather?.[home]?.utcOffset, null);
  // The capital's clock, from the weather service's offset; the server's own zone is not the company's.
  const local = new Date(Date.now() + (Number.isFinite(tz) ? tz * 1000 : 0));
  const hm = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  const order = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const next = order.map((k) => ({ name: k, at: d.timings[k] })).find((x) => x.at && x.at > hm) || { name: 'Fajr', at: d.timings.Fajr, tomorrow: true };
  const today = new Date().toISOString().slice(0, 10);
  const ramadanIn = d.ramadan?.date ? Math.round((Date.parse(d.ramadan.date) - Date.parse(today)) / 86400_000) : null;
  return { ...d, next, now: hm, ramadanIn, fetchedAt: row.fetched_at, stale: d.gregorian && !String(row.key).endsWith(today) };
}

/** The station's track, and where on it the station is now (the console moves it between reads). */
export function iss() {
  const row = read('iss', 'track');
  return row?.data?.track?.length ? { fetchedAt: row.fetchedAt, track: row.data.track } : null;
}

export function frontpage() {
  const row = read('frontpage', 'top');
  return { fetchedAt: row?.fetchedAt || null, stories: row?.data?.stories || [] };
}

/** Holidays from today, across every place, the soonest first. */
export function upcomingHolidays(days = 90) {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
  const out = [];
  const unsupported = new Set();
  for (const y of [new Date().getUTCFullYear(), new Date().getUTCFullYear() + 1]) {
    const h = read('holidays', String(y))?.data?.holidays || {};
    for (const [cc, list] of Object.entries(h)) {
      if (!Array.isArray(list)) { if (list?.unsupported) unsupported.add(cc); continue; }
      for (const x of list) if (x.date >= today && x.date <= until) out.push(x);
    }
  }
  return { list: out.sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country)), unsupported: [...unsupported] };
}

/** What a unit of one currency is worth in another, from the last rates read. */
export function convert({ amount = 1, from = 'USD', to }) {
  const rates = read('fx', 'USD')?.data?.rates || {};
  const f = String(from).toUpperCase(); const t = String(to || homeCurrency()).toUpperCase();
  if (!rates[f] || !rates[t]) refuse(`no rate for ${!rates[f] ? f : t} yet`, 404);
  const a = Number(amount);
  if (!Number.isFinite(a)) refuse('amount must be a number');
  return { amount: a, from: f, to: t, result: Math.round((a / rates[f]) * rates[t] * 1e6) / 1e6, rate: rates[t] / rates[f], date: read('fx', 'USD')?.data?.date || null };
}

function fxView() {
  const row = read('fx', 'USD');
  const all = row?.data?.rates || {};
  const series = read('fxseries', 'majors')?.data?.series || {};
  const home = homeCurrency();
  const codes = [...new Set([home, ...places().map((p) => p.currency), ...MAJORS])].filter((c) => c && c !== 'USD' && all[c]);
  return {
    fetchedAt: row?.fetchedAt || null, date: row?.data?.date || null, source: row?.data?.source || null, home,
    fallback: row?.data?.fallbackBecause ? { why: row.data.fallbackBecause, carried: row.data.carried || [], from: row.data.carriedFrom || null } : null,
    rates: codes.map((c) => {
      const s = (series[c] || []).map(([, v]) => v);
      const first = s[0];
      return { code: c, perUsd: all[c], change90: first ? Math.round(((all[c] / first) - 1) * 10000) / 100 : null, spark: s.filter((_, i) => i % 3 === 0 || i === s.length - 1) };
    }),
    all: Object.keys(all).sort(),
  };
}

function runtime() {
  const row = read('eol', 'nodejs');
  const major = process.versions.node.split('.')[0];
  const rel = (row?.data?.releases || []).find((r) => r.name === major);
  const lts = (row?.data?.releases || []).find((r) => r.lts && r.maintained && !r.eol);
  return {
    fetchedAt: row?.fetchedAt || null, node: process.versions.node,
    line: rel ? { label: rel.label, maintained: rel.maintained, eol: rel.eol, eolFrom: rel.eolFrom, latest: rel.latest } : null,
    recommended: lts ? { label: lts.label, latest: lts.latest, eolFrom: lts.eolFrom } : null,
  };
}

function sourceRows() {
  const counts = Object.fromEntries(q(`SELECT capability, COUNT(*) AS n, SUM(CASE WHEN verdict = 'blocked' THEN 1 ELSE 0 END) AS blocked
      FROM egress_log WHERE connector = 'opendata' AND created_at >= datetime('now','-1 day') GROUP BY capability`).map((r) => [r.capability, r]));
  const last = Object.fromEntries(q(`SELECT source, MAX(fetched_at) AS fetched_at, MAX(tried_at) AS tried_at,
      (SELECT error FROM od_cache c2 WHERE c2.source = c.source ORDER BY tried_at DESC LIMIT 1) AS error
      FROM od_cache c GROUP BY source`).map((r) => [r.source, r]));
  return SOURCES.map((s) => ({
    id: s.id, label: s.label, service: s.service, host: s.host, category: s.category, for: s.for, ttl: s.ttl,
    fetchedAt: last[s.id]?.fetched_at || null, triedAt: last[s.id]?.tried_at || null, error: last[s.id]?.error || null,
    today: counts[s.capability]?.n || 0, blocked: counts[s.capability]?.blocked || 0,
  }));
}

export function overview() {
  const ind = read('indicators', 'all');
  return {
    live: isLive(),
    connector: one("SELECT state, health, last_call FROM connectors WHERE id = 'opendata'") || null,
    sources: sourceRows(),
    fx: fxView(),
    places: places(),
    holidays: upcomingHolidays(90),
    indicators: { fetchedAt: ind?.fetchedAt || null, keys: Object.keys(INDICATORS), byCountry: ind?.data?.indicators || {} },
    quakes: quakes(),
    events: naturalEvents(),
    day: day(),
    iss: iss(),
    frontpage: frontpage(),
    world: { fetchedAt: read('world', 'all')?.fetchedAt || null, countries: Object.keys(read('world', 'all')?.data?.countries || {}).length },
    runtime: runtime(),
    scans: scans(),
    projects: safe(() => listProjects().map((p) => ({ id: p.id, slug: p.slug, name: p.name })), []),
    lastRefresh: lastRefresh ? new Date(lastRefresh).toISOString() : null,
  };
}

/** One country, for the globe: what is known, from the cache only — opening a panel asks nobody. */
export function country(code) {
  const cc = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) refuse('a two-letter country code');
  const f = facts()[cc] || null;
  const fx = read('fx', 'USD')?.data?.rates || {};
  const cur = currencyOf(cc);
  return {
    code: cc, live: isLive(), facts: f, currency: cur, perUsd: cur && fx[cur] ? fx[cur] : null,
    weather: read('weather', 'places')?.data?.weather?.[cc] || null,
    indicators: { ...(read('world', 'all')?.data?.indicators?.[cc] || {}), ...(read('indicators', 'all')?.data?.indicators?.[cc] || {}) },
    air: read('air', 'places')?.data?.air?.[cc] || null,
    events: naturalEvents().list.filter((x) => x.near?.code === cc).slice(0, 5),
    holidays: upcomingHolidays(120).list.filter((h) => h.country === cc).slice(0, 4),
    quakes: quakes().list.filter((x) => x.near?.code === cc).slice(0, 5),
  };
}

/** The corner of this the home page shows: the home currency, the next day off, the weather at home. */
export function brief() {
  if (!one("SELECT 1 AS x FROM od_cache LIMIT 1")) return { live: isLive(), empty: true };
  const fx = fxView();
  const home = homeCountry();
  const h = upcomingHolidays(45).list;
  return {
    live: isLive(),
    home,
    currency: fx.rates.find((r) => r.code === fx.home) || null,
    rates: fx.rates.slice(0, 4),
    holiday: h.find((x) => x.country === home) || h[0] || null,
    weather: home ? read('weather', 'places')?.data?.weather?.[home] || null : null,
    quakesNear: quakes().near.length,
    eventsNear: naturalEvents().near.length,
    air: home ? read('air', 'places')?.data?.air?.[home] || null : null,
    day: safe(() => day(), null),
  };
}

// ------------------------------------------------------------------ tools --

const needLive = () => { if (!isLive()) refuse('live data is off — a person switches it on first', 409); };

/** Is this a registered legal entity, and what does the encyclopaedia say about it. */
export async function lookupCompany({ query, lang = 'en', actor }) {
  needLive();
  const qs = String(query || '').trim();
  if (qs.length < 3) refuse('give at least three characters');
  const key = qs.toLowerCase().slice(0, 120);
  const [lei, wiki] = await Promise.all([
    pull('lei', key, { query: qs }, { actor, reason: `who is ${qs.slice(0, 60)}` }),
    pull('wiki', `${lang === 'ar' ? 'ar' : 'en'}:${key}`, { title: qs, lang }, { actor, reason: `about ${qs.slice(0, 60)}` }),
  ]);
  return { query: qs, lei: lei?.data?.results || [], leiError: lei?.error || null, wiki: wiki?.data || null, fetchedAt: lei?.fetchedAt || null };
}

export async function checkVat({ number, actor }) {
  needLive();
  const n = String(number || '').toUpperCase().replace(/[\s.\-]/g, '');
  if (!/^[A-Z]{2}[A-Z0-9+*]{2,13}$/.test(n)) refuse('a VAT number starts with its two-letter country code');
  const r = await pull('vat', n, { number: n }, { actor, reason: `is ${n} a real VAT number` });
  if (!r?.data) refuse(r?.error || 'the VAT service did not answer', 502);
  return { ...r.data, fetchedAt: r.fetchedAt };
}

const ROLE = /^(info|admin|support|sales|contact|hello|office|billing|accounts|noreply|no-reply|postmaster|webmaster|team|hr|jobs)$/i;
const ADDRESS = /^[^\s@]{1,64}@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/** What can be said about an address without writing to it: shape, role, and whether the domain is throwaway. */
export async function checkEmail({ address, actor }) {
  needLive();
  const a = String(address || '').trim().toLowerCase();
  const m = a.match(ADDRESS);
  if (!m) refuse('not an email address');
  const domain = m[1];
  const r = await pull('mail', domain, { domain }, { actor, reason: `is ${domain} a throwaway domain` });
  return { address: a, domain, role: ROLE.test(a.split('@')[0]), disposable: r?.data ? r.data.disposable : null, error: r?.error || null, fetchedAt: r?.fetchedAt || null };
}

// ----------------------------------------------------------- dependencies --

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.\-]+)?$/;

/**
 * The packages a tree depends on, at the versions it actually runs. The lock
 * file is the truth when there is one; without it a range is read only when
 * it names one version, because "^4.17.0" is a family, not a version, and an
 * advisory against a family member nobody installed is noise.
 */
export function dependenciesOf(dir) {
  const json = (f) => safe(() => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), null);
  const pkg = json('package.json');
  if (!pkg) return { packages: [], note: 'no package.json' };
  const direct = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  const lock = json('package-lock.json');
  const out = [];
  if (lock?.packages) {
    for (const [p, v] of Object.entries(lock.packages)) {
      if (!p.startsWith('node_modules/') || !v?.version) continue;
      const name = p.slice(p.lastIndexOf('node_modules/') + 13);
      out.push({ name, version: v.version, dev: Boolean(v.dev), direct: direct.has(name) });
    }
    return { packages: dedupe(out), lock: true };
  }
  let skipped = 0;
  for (const [deps, dev] of [[pkg.dependencies || {}, false], [pkg.devDependencies || {}, true]]) {
    for (const [name, range] of Object.entries(deps)) {
      const v = String(range).replace(/^[=v]/, '');
      if (EXACT.test(v)) out.push({ name, version: v, dev, direct: true }); else skipped++;
    }
  }
  return { packages: out, lock: false, skipped };
}

const dedupe = (list) => [...new Map(list.map((p) => [`${p.name}@${p.version}`, p])).values()];

function targetDir(target) {
  if (target === 'alphacore') return { dir: APP_ROOT, label: 'AlphaCore' };
  const p = projectRow(target);
  return { dir: projectDir(p), label: p.name };
}

/** Ask OSV about every package a tree runs, and keep the answer for the page. */
export async function scanDependencies({ target = 'alphacore', actor }) {
  needLive();
  const key = String(target);
  const { dir, label } = targetDir(key);
  const deps = dependenciesOf(dir);
  if (!deps.packages.length) refuse(deps.skipped ? 'no exact versions to check — install the app so it has a lock file' : 'this app declares no packages', 409);
  const r = await pull('osv', key, { packages: deps.packages.map(({ name, version, dev }) => ({ name, version, dev })) },
    { actor, force: true, reason: `advisories for ${deps.packages.length} packages in ${label}` });
  if (!r?.data) refuse(r?.error || 'OSV did not answer', 502);
  return { target: key, label, ...summarise(r.data), lock: deps.lock, fetchedAt: r.fetchedAt };
}

const SEV = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'UNKNOWN'];
function summarise(data) {
  const pk = (data?.packages || []).map((p) => ({ ...p, worst: SEV.find((s) => p.vulns.some((v) => v.severity === s)) || 'UNKNOWN' }))
    .sort((a, b) => SEV.indexOf(a.worst) - SEV.indexOf(b.worst));
  const count = (s) => pk.reduce((n, p) => n + p.vulns.filter((v) => v.severity === s).length, 0);
  return { checked: data?.checked || 0, packages: pk, counts: Object.fromEntries(SEV.map((s) => [s.toLowerCase(), count(s)])) };
}

export function scans() {
  return q("SELECT key, payload, fetched_at, error FROM od_cache WHERE source = 'osv' ORDER BY fetched_at DESC").map((r) => {
    const d = parse(r.payload, null);
    const s = d ? summarise(d) : null;
    return { target: r.key, fetchedAt: r.fetched_at, error: r.error, checked: s?.checked || 0, counts: s?.counts || null, packages: (s?.packages || []).slice(0, 25) };
  });
}
