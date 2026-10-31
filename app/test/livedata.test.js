// Live data: the public services, read through the gate.
//
// Nothing here reaches the internet. The runtime's fetch is replaced by one
// that answers each host with the shape that service really returns (taken
// from the services themselves), so what is tested is everything around the
// wire: that the clock does nothing until a person switches it on, that each
// read is a row in the egress log held to the connector's own fence, that a
// failure keeps the last good answer, and what each department is handed —
// a rate, a holiday, the weather at home, a quake near a place the company
// works, a legal entity, an advisory in a package an app runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-livedata.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-livedata-files/memory';
process.env.ALPHACORE_APPS_ROOT = 'data/test-livedata-files/apps';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-livedata.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-livedata-files'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const { verifyChain } = await import('../src/audit.js');
const { isRead } = await import('../src/egress.js');
const { seedConnectors, setAllowlist } = await import('../src/connectors/index.js');
const { addParty } = await import('../src/aml.js');
const { HOSTS, ALL_HOSTS, parseRates, parseIndicator, parseQuakes, severityOf } = await import('../src/connectors/opendata.js');
const Live = await import('../src/livedata.js');
const Deck = await import('../src/deck.js');

seedConnectors();
const person = 'human:founder';

// ------------------------------------------------------------ the world --

const year = new Date().getUTCFullYear();
const soon = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const calls = [];
let failFx = false;
const ANSWERS = {
  [HOSTS.fx]: () => {
    if (failFx) throw new Error('down');
    return { date: '2026-10-30', usd: { iqd: 1310, sar: 3.75, eur: 0.9, gbp: 0.75, aed: 3.6725, eth: 0.0003, '1inch': 12.7 } };
  },
  [HOSTS.ecb]: () => ({ base: 'USD', rates: { '2026-08-01': { EUR: 0.95, GBP: 0.8 }, '2026-10-30': { EUR: 0.9, GBP: 0.75 } } }),
  [HOSTS.holidays]: (u) => (u.includes('/IQ')
    ? [{ date: soon(3), localName: 'Army Day', name: 'Army Day', countryCode: 'IQ', global: true, types: ['Public'] }, { date: `${year}-01-01`, name: 'New Year', localName: 'New Year', global: true }]
    : { status: 404, body: { title: 'Not Found' } }),
  [HOSTS.weather]: () => ([
    { timezone: 'Asia/Baghdad', utc_offset_seconds: 10800, current: { temperature_2m: 32.1, weather_code: 2, wind_speed_10m: 6, is_day: 1 }, daily: { time: [soon(0)], temperature_2m_max: [33], temperature_2m_min: [20], weather_code: [1] } },
    { timezone: 'Asia/Riyadh', utc_offset_seconds: 10800, current: { temperature_2m: 35, weather_code: 0, wind_speed_10m: 9, is_day: 1 }, daily: { time: [soon(0)], temperature_2m_max: [36], temperature_2m_min: [24], weather_code: [0] } },
  ]),
  [HOSTS.worldbank]: (u) => {
    if (u.includes('/indicator/')) {
      const code = u.match(/indicator\/([A-Z.0-9]+)/)[1];
      return [{ page: 1 }, [
        { indicator: { id: code }, country: { id: 'IQ' }, date: '2025', value: code === 'FP.CPI.TOTL.ZG' ? 3.1 : -2.1 },
        { indicator: { id: code }, country: { id: 'SA' }, date: '2025', value: 4.5 },
        { indicator: { id: code }, country: { id: 'SA' }, date: '2024', value: 1.3 },
      ]];
    }
    return [{ page: 1 }, [
      { iso2Code: 'IQ', name: 'Iraq', capitalCity: 'Baghdad', latitude: '33.3302', longitude: '44.394', region: { value: 'Middle East' }, incomeLevel: { value: 'Upper middle income' } },
      { iso2Code: 'SA', name: 'Saudi Arabia', capitalCity: 'Riyadh', latitude: '24.6748', longitude: '46.6977', region: { value: 'Middle East' }, incomeLevel: { value: 'High income' } },
    ]];
  },
  [HOSTS.quakes]: () => ({ features: [
    { id: 'near', properties: { mag: 5.4, place: '40 km E of Halabja', time: Date.now() - 3600_000, tsunami: 0 }, geometry: { coordinates: [46.3, 35.2, 10] } },
    { id: 'far', properties: { mag: 6.1, place: 'Vanuatu', time: Date.now() - 7200_000, tsunami: 1 }, geometry: { coordinates: [167, -15, 30] } },
  ] }),
  [HOSTS.eol]: () => ({ result: { releases: [
    { name: process.versions.node.split('.')[0], label: 'current', isLts: true, isEol: false, eolFrom: '2028-04-30', isMaintained: true, latest: { name: '24.22.2' } },
    { name: '20', label: '20 (LTS)', isLts: true, isEol: true, eolFrom: '2026-04-30', isMaintained: false, latest: { name: '20.19.5' } },
  ] } }),
  [HOSTS.gleif]: () => ({ data: [{ id: 'YYPPRNO5HB304LHFVG31', attributes: { entity: { legalName: { name: 'GOOGLE IRELAND LIMITED' }, status: 'ACTIVE', jurisdiction: 'IE', legalAddress: { addressLines: ['GORDON HOUSE'], city: 'DUBLIN', country: 'IE', postalCode: 'D04' } }, registration: { status: 'ISSUED', nextRenewalDate: '2027-05-31', corroborationLevel: 'FULLY_CORROBORATED' } } }] }),
  'en.wikipedia.org': () => ({ type: 'standard', title: 'Google', description: 'American technology company', extract: 'Google LLC is…', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Google' } } }),
  [HOSTS.vat]: () => ({ valid: true, vat_number: '6388047V', country_code: 'IE', name: 'GOOGLE IRELAND LIMITED', address: 'DUBLIN 4' }),
  [HOSTS.mail]: (u) => ({ disposable: u.endsWith('/mailinator.com') }),
  [HOSTS.osv]: (u, init) => {
    if (u.endsWith('/querybatch')) {
      const qs = JSON.parse(init.body).queries;
      return { results: qs.map((x) => (x.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-lodash-1' }] } : {})) };
    }
    return { id: 'GHSA-lodash-1', summary: 'Prototype pollution', aliases: ['CVE-2020-8203'], database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.19' }] }] }] };
  },
};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const host = new URL(u).hostname;
  calls.push(host);
  const fn = ANSWERS[host];
  if (!fn) throw new Error(`the test reached ${host}, which nothing here answers`);
  let body = fn(u, init);
  let status = 200;
  if (body && body.status && body.body) { status = body.status; body = body.body; }
  return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Not Found', text: async () => JSON.stringify(body) };
};

setSetting('COMPANY_COUNTRY', 'IQ');
addParty({ name: 'Riyadh Trading', kind: 'company', country: 'SA', actor: person });

// ---------------------------------------------------------------- tests --

test('nothing is read until a person switches it on, and the tools say so', async () => {
  assert.equal(Live.isLive(), false);
  const before = calls.length;
  assert.deepEqual(await Live.refreshDue(), { skipped: 'live data is off' });
  assert.equal(calls.length, before, 'the clock asked nobody');
  await assert.rejects(Live.lookupCompany({ query: 'google', actor: person }), (e) => e.status === 409);
  assert.throws(() => Live.goLive({ actor: 'system:livedata' }), (e) => e.status === 403);
  assert.throws(() => Live.goLive({ actor: 'agent:AGT-1' }), (e) => e.status === 403);
  const ov = Live.overview();
  assert.equal(ov.live, false);
  assert.equal(ov.fx.rates.length, 0, 'no invented rates');
});

test('every capability is a read, and the connector is fenced to the services it names', () => {
  for (const s of Live.SOURCES) assert.ok(isRead(s.capability), `${s.capability} reads`);
  Live.goLive({ actor: person });
  assert.equal(Live.isLive(), true);
  const c = one("SELECT * FROM connectors WHERE id = 'opendata'");
  assert.equal(c.state, 'live');
  assert.deepEqual(JSON.parse(c.allowlist).sort(), [...ALL_HOSTS].sort());
});

test('the clock reads each service once and keeps every answer with its time', async () => {
  await Live.refreshDue();
  const ov = Live.overview();
  // Places: home first, then the countries the record ties the company to.
  assert.deepEqual(ov.places.map((p) => p.code), ['IQ', 'SA']);
  assert.equal(ov.places[0].capital, 'Baghdad');
  assert.equal(ov.places[0].currency, 'IQD');
  assert.equal(ov.places[0].weather.temp, 32.1);
  assert.equal(ov.places[1].weather.timezone, 'Asia/Riyadh');
  // The dinar is in; the coins are not.
  assert.equal(ov.fx.home, 'IQD');
  assert.ok(ov.fx.rates.some((r) => r.code === 'IQD' && r.perUsd === 1310));
  assert.ok(!ov.fx.all.includes('ETH') && !ov.fx.all.includes('1INCH'));
  const eur = ov.fx.rates.find((r) => r.code === 'EUR');
  assert.equal(eur.change90, -5.26, 'the trend comes from the ECB series');
  // Holidays: Iraq's next one; Saudi Arabia not covered, said once rather than failing the batch.
  assert.equal(ov.holidays.list[0].name, 'Army Day');
  assert.ok(ov.holidays.unsupported.includes('SA'));
  // Indicators: the latest year wins.
  assert.equal(ov.indicators.byCountry.SA.gdpGrowth.value, 4.5);
  assert.equal(ov.indicators.byCountry.IQ.inflation.value, 3.1);
  // The quake near Baghdad is flagged; the one in the Pacific is not.
  assert.equal(ov.quakes.near.length, 1);
  assert.equal(ov.quakes.near[0].near.code, 'IQ');
  assert.ok(ov.quakes.near[0].near.km < 600);
  assert.equal(ov.runtime.line.maintained, true);
  // Every read is a row in the gate's log.
  const rows = q("SELECT capability, verdict FROM egress_log WHERE connector = 'opendata'");
  assert.ok(rows.length >= 8);
  assert.ok(rows.every((r) => r.verdict === 'allowed'));
  // A second pass inside the freshness windows asks nobody.
  const n = calls.length;
  await Live.refreshDue();
  assert.equal(calls.length, n);
});

test('a failure keeps the last good answer and says the last try failed', async () => {
  failFx = true;
  await Live.refreshDue({ force: true });
  const row = one("SELECT * FROM od_cache WHERE source = 'fx' AND key = 'USD'");
  const fx = Live.overview().fx;
  // Frankfurter answered for the ECB's currencies; the dinar is not one of
  // them, so it keeps its last rate and says it was carried over.
  assert.ok(fx.fallback, 'the page is told the main service failed');
  assert.ok(fx.fallback.carried.includes('IQD'));
  assert.equal(fx.rates.find((r) => r.code === 'IQD').perUsd, 1310);
  assert.equal(JSON.parse(row.payload).source, 'frankfurter');
  failFx = false;
});

test('the fence holds: a service taken off the allowlist is refused at the gate', async () => {
  setAllowlist('opendata', [HOSTS.osv], { actor: person });
  await Live.refreshDue({ force: true });
  const blocked = one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'opendata' AND verdict = 'blocked'").n;
  assert.ok(blocked > 0);
  assert.match(one("SELECT error FROM od_cache WHERE source = 'quakes'").error, /allowlist/);
  // Switching it on again restores the fence the module declares.
  Live.goLive({ actor: person });
});

test('conversion uses the last rates read, and a currency with none is refused', () => {
  const r = Live.convert({ amount: 100, from: 'USD', to: 'IQD' });
  assert.ok(r.result > 0);
  assert.equal(Math.round(Live.convert({ amount: 3.75, from: 'SAR', to: 'USD' }).result * 100) / 100, 1);
  assert.throws(() => Live.convert({ amount: 1, from: 'USD', to: 'XYZ' }), (e) => e.status === 404);
});

test('a person can ask who a company is, whether a VAT number is real, and whether a mailbox is throwaway', async () => {
  const c = await Live.lookupCompany({ query: 'Google Ireland', actor: person });
  assert.equal(c.lei[0].lei, 'YYPPRNO5HB304LHFVG31');
  assert.equal(c.lei[0].status, 'ACTIVE');
  assert.equal(c.wiki.found, true);
  const v = await Live.checkVat({ number: 'IE 6388047V', actor: person });
  assert.equal(v.valid, true);
  assert.equal(v.name, 'GOOGLE IRELAND LIMITED');
  await assert.rejects(Live.checkVat({ number: '12345', actor: person }), (e) => e.status === 400);
  const m = await Live.checkEmail({ address: 'info@mailinator.com', actor: person });
  assert.equal(m.disposable, true);
  assert.equal(m.role, true);
  const ok = await Live.checkEmail({ address: 'sara@example.org', actor: person });
  assert.equal(ok.disposable, false);
  assert.equal(ok.role, false);
});

test('advisories are read for the versions a tree actually runs', async () => {
  const dir = path.join(root, 'data', 'test-livedata-files', 'tree');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0', left: '1.0.0' } }));
  let deps = Live.dependenciesOf(dir);
  assert.deepEqual(deps.packages.map((p) => p.name), ['left'], 'a range is a family, not a version');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/a/node_modules/left': { version: '1.0.0', dev: true } } }));
  deps = Live.dependenciesOf(dir);
  assert.deepEqual(deps.packages.map((p) => `${p.name}@${p.version}`).sort(), ['left@1.0.0', 'lodash@4.17.15']);
  // The platform's own tree, which has a lock file.
  const s = await Live.scanDependencies({ target: 'alphacore', actor: person });
  assert.ok(s.checked > 0);
  assert.equal(severityOf({ database_specific: { severity: 'moderate' } }), 'MODERATE');
});

test('the parsers drop what is not there instead of inventing it', () => {
  assert.equal(parseRates({ usd: { xyz: 2, eur: -1 } }).rates.EUR, undefined);
  assert.deepEqual(parseIndicator([{}, [{ country: { id: 'IQ' }, date: '2025', value: null }]]), {});
  assert.equal(parseQuakes({ features: [{ properties: { mag: null }, geometry: { coordinates: [1, 2] } }] }).length, 0);
});

test('the home page and the globe are handed the cache, and asking for them calls nobody', () => {
  const n = calls.length;
  const b = Deck.brief({ username: 'founder' }).wire;
  assert.equal(b.live, true);
  assert.equal(b.currency.code, 'IQD');
  assert.equal(b.holiday.name, 'Army Day');
  assert.equal(b.quakesNear, 1);
  const c = Live.country('iq');
  assert.equal(c.facts.capital, 'Baghdad');
  assert.equal(c.perUsd, 1310);
  assert.equal(c.quakes.length, 1);
  assert.equal(calls.length, n);
});

test('switching it off stops the clock, and both switches are on the chain', async () => {
  Live.pause({ actor: person });
  assert.equal(Live.isLive(), false);
  assert.deepEqual(await Live.refreshDue(), { skipped: 'live data is off' });
  const acts = q("SELECT payload FROM audit_log WHERE action = 'connector.state' AND subject_id = 'opendata'").map((r) => JSON.parse(r.payload).state);
  assert.ok(acts.includes('live') && acts.includes('paused'));
  assert.equal(verifyChain().ok, true);
});

test('the department is catalogued, placed once, and its powers are split', () => {
  for (const p of ['livedata.view', 'livedata.lookup', 'livedata.manage']) assert.ok(PERMS.includes(p), p);
  const cat = sectionCatalog();
  assert.ok(cat.find((s) => s.id === 'livedata'));
  assert.equal(SURFACES.filter((s) => s.departments.includes('livedata')).length, 1);
  assert.ok(expandTemplate('operator').includes('livedata.lookup'));
  assert.ok(!expandTemplate('operator').includes('livedata.manage'), 'switching the clock on stays with an admin');
  exec('SELECT 1');
});
