// The frontier: the horizon radar, the market atlas, the naming studio, and
// the second set of public services under them.
//
// As in livedata.test.js, the runtime's fetch answers each host with the
// shape that service really returns, so nothing leaves the machine. What is
// tested is what each department decides from those answers: when attention
// counts as rising and when a ratio is too thin to mean anything, which
// stories and projects are signals and that a signal is recorded once a day,
// how a market ranks when the weights change and that a missing figure is
// left out rather than counted as zero, that a 404 from a registry means free
// and rdap.org's own 404 means "cannot say", that a quake-free fire near the
// capital is flagged, and that the day at home knows the next prayer and how
// far away Ramadan is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-frontier.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-frontier-files/memory';
process.env.ALPHACORE_APPS_ROOT = 'data/test-frontier-files/apps';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-frontier.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-frontier-files'), { recursive: true, force: true });

const { one, q } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const { verifyChain } = await import('../src/audit.js');
const { isRead } = await import('../src/egress.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { rdapVerdict, parseArxiv, parseEvents, parseWorld } = await import('../src/connectors/openworld.js');
const Live = await import('../src/livedata.js');
const Radar = await import('../src/radar.js');
const Atlas = await import('../src/atlas.js');
const Naming = await import('../src/naming.js');

seedConnectors();
const ME = 'human:founder';

// ------------------------------------------------------------ the world --

const day = (k) => new Date(Date.now() - k * 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
const views = (base, lastWeek) => Array.from({ length: 90 }, (_, i) => ({ timestamp: `${day(89 - i)}00`, views: i >= 83 ? lastWeek : base }));
const COUNTRIES = [
  ['IQ', 'Iraq', 'Baghdad', 33.33, 44.39, 'MEA'], ['SA', 'Saudi Arabia', 'Riyadh', 24.67, 46.69, 'MEA'], ['AE', 'United Arab Emirates', 'Abu Dhabi', 24.47, 54.37, 'MEA'],
  ['DE', 'Germany', 'Berlin', 52.52, 13.4, 'ECS'], ['EG', 'Egypt', 'Cairo', 30.04, 31.24, 'MEA'],
];
const IND = {
  'NY.GDP.MKTP.CD': { IQ: 2.5e11, SA: 1.1e12, AE: 5.0e11, DE: 4.5e12, EG: 4.0e11 },
  'NY.GDP.MKTP.KD.ZG': { IQ: -2.1, SA: 4.5, AE: 4.0, DE: 0.2, EG: 3.8 },
  'NY.GDP.PCAP.CD': { IQ: 5400, SA: 33000, AE: 50000, DE: 54000, EG: 3500 },
  'SP.POP.TOTL': { IQ: 4.6e7, SA: 3.3e7, AE: 1.0e7, DE: 8.4e7, EG: 1.1e8 },
  'IT.NET.USER.ZS': { IQ: 79, SA: 99, AE: 100, DE: 92, EG: 72 },
  'IT.CEL.SETS.P2': { IQ: 95, SA: 130, AE: 190, DE: 128, EG: 93 },
  'SP.URB.TOTL.IN.ZS': { IQ: 71, SA: 85, AE: 87, DE: 78, EG: 43 },
  'FP.CPI.TOTL.ZG': { IQ: 3, SA: 2, AE: 2.5, DE: 2.2, EG: 33 },
  'NE.TRD.GNFS.ZS': { IQ: 70, SA: 60, AE: 180, DE: 85, EG: 40 },
  'GOV_WGI_CC.EST': { IQ: -1.25, SA: 0.2, AE: 1.1, DE: 1.8, EG: -0.8 },
  'GOV_WGI_RQ.EST': { IQ: -1.1, SA: 0.1, AE: 1.0, DE: 1.6 },
  'GOV_WGI_PV.EST': { IQ: -1.6, SA: -0.4, AE: 0.7, DE: 0.6, EG: -1.0 },
};
let rdapTaken = new Set(['alphacore.com']);
const calls = [];
const ANSWERS = {
  'api.worldbank.org': (u) => {
    const m = u.match(/indicator\/([A-Z_.0-9]+)/);
    if (m) return [{ page: 1 }, [...Object.entries(IND[m[1]] || {}).map(([cc, value]) => ({ country: { id: cc }, date: '2025', value })), { country: { id: '1A' }, date: '2025', value: 9 }]];
    return [{ page: 1 }, [...COUNTRIES.map(([iso2Code, name, capitalCity, la, lo, rid]) => ({ iso2Code, name, capitalCity, latitude: String(la), longitude: String(lo), region: { id: rid, value: rid }, incomeLevel: { value: 'x' } })),
      { iso2Code: '1A', name: 'Arab World', region: { id: 'NA', value: 'Aggregates' } }]];
  },
  'air-quality-api.open-meteo.com': () => [{ current: { us_aqi: 152, pm2_5: 60 } }, { current: { us_aqi: 40, pm2_5: 9 } }],
  'eonet.gsfc.nasa.gov': () => ({ events: [
    { id: 'E1', title: 'Wildfire near Baghdad', categories: [{ id: 'wildfires', title: 'Wildfires' }], geometry: [{ date: '2026-10-30T00:00:00Z', type: 'Point', coordinates: [44.6, 33.6] }] },
    { id: 'E2', title: 'Typhoon far away', categories: [{ id: 'severeStorms', title: 'Severe Storms' }], geometry: [{ date: '2026-10-30T00:00:00Z', type: 'Point', coordinates: [140, 20], magnitudeValue: 90, magnitudeUnit: 'kts' }] },
  ] }),
  'api.aladhan.com': (u) => (u.includes('hToG')
    ? { data: { gregorian: { date: '07-02-2027' } } }
    : { data: { timings: { Fajr: '04:56', Sunrise: '06:20', Dhuhr: '11:46', Asr: '14:49', Maghrib: '17:12', Isha: '18:31' }, date: { gregorian: { date: '31-10-2026' }, hijri: { day: '20', month: { number: 5, en: 'Jumada al-ula', ar: 'جمادى الأولى' }, year: '1448', holidays: [] } } } }),
  'api.wheretheiss.at': () => Array.from({ length: 10 }, (_, i) => ({ timestamp: 1e9 + i * 540, latitude: -35 + i * 6, longitude: -34 + i * 30, altitude: 420, velocity: 27600, visibility: 'daylight' })),
  'wikimedia.org': (u) => (u.includes('/Rising_thing/') ? { items: views(100, 300) } : u.includes('/Quiet_thing/') ? { items: views(5, 30) } : { status: 404, body: { title: 'Not found' } }),
  'hn.algolia.com': (u) => {
    if (u.includes('author_whoishiring')) return { hits: [{ objectID: '900', title: 'Ask HN: Who wants to be hired? (October 2026)' }, { objectID: '901', title: 'Ask HN: Who is hiring? (October 2026)' }] };
    if (u.includes('story_901')) {
      return { hits: [
        ...Array.from({ length: 22 }, (_, i) => ({ objectID: String(1000 + i), parent_id: 901, created_at: '2026-10-02T00:00:00Z', comment_text: `Rocket${i % 3} | Senior Engineer | Berlin | ${i % 2 ? 'REMOTE' : 'ONSITE'} | $150k - $190k<p>We build the rising thing.` })),
        { objectID: '2000', parent_id: 1000, comment_text: 'Is the rising thing role still open?' },
        // Matched by the search's typo tolerance, and not about the subject at all.
        { objectID: '2001', parent_id: 901, created_at: '2026-10-02T00:00:00Z', comment_text: 'Rasing Things Ltd | Chef | Paris' },
      ] };
    }
    return { nbHits: 42, hits: [
    { objectID: '1', title: 'A big launch', url: 'https://x.test/a', points: 480, num_comments: 200, created_at: new Date(Date.now() - 2 * 86400_000).toISOString() },
    { objectID: '2', title: 'Small note', points: 12, num_comments: 1, created_at: new Date().toISOString() },
  ] };
  },
  'hacker-news.firebaseio.com': (u) => (u.endsWith('topstories.json') ? [101, 102] : { id: Number(u.match(/item\/(\d+)/)[1]), title: `Story ${u.match(/item\/(\d+)/)[1]}`, score: 300, descendants: 50, time: 1793400000 }),
  'export.arxiv.org': () => ({ raw: true, text: `<?xml version="1.0"?><feed><opensearch:totalResults>1234</opensearch:totalResults>
    <entry><id>http://arxiv.org/abs/2610.00001v1</id><published>2026-10-30T00:00:00Z</published><title>Agents &amp; markets</title><summary>We study things.</summary><author><name>A. Researcher</name></author></entry></feed>` }),
  'api.github.com': (u) => {
    if (u.includes('/search/')) return { total_count: 77, items: [{ full_name: 'org/rocket', html_url: 'https://github.com/org/rocket', stargazers_count: 2400, language: 'Rust', description: 'fast', created_at: '2026-09-02T00:00:00Z' }] };
    return u.endsWith('/users/alphacore') ? { type: 'Organization', html_url: 'https://github.com/alphacore' } : { status: 404, body: { message: 'Not Found' } };
  },
  ...Object.fromEntries(['rdap.verisign.com', 'rdap.publicinterestregistry.org', 'rdap.identitydigital.services', 'pubapi.registry.google', 'rdap.radix.host', 'rdap.centralnic.com'].map((h) => [h, (u) => {
    const dom = u.split('/domain/')[1];
    // The .tech registry is having a bad day: it refuses, and that is "cannot say".
    if (dom.endsWith('.tech')) return { status: 403, body: { title: 'Forbidden' } };
    return rdapTaken.has(dom) ? { objectClassName: 'domain', events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }] } : { status: 404, body: { errorCode: 404, title: 'Not Found' } };
  }])),
  'registry.npmjs.org': (u) => (u.endsWith('/alphacore') ? { name: 'alphacore', time: { modified: '2022-06-13T00:00:00Z' } } : { status: 404, body: { error: 'Not found' } }),
  'api.npmjs.org': () => ({ downloads: 12 }),
  'en.wikipedia.org': (u) => (/alphacore/i.test(u) ? { type: 'standard', title: 'AlphaCore', description: 'a thing', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/AlphaCore' } } } : { status: 404, body: { title: 'Not found' } }),
};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const host = new URL(u).hostname;
  calls.push(host);
  const fn = ANSWERS[host];
  if (!fn) return { ok: false, status: 503, statusText: 'unreachable in tests', url: u, text: async () => '{}' };
  let body = fn(u, init);
  let status = 200; let finalUrl = u;
  if (body && body.status && body.body) { status = body.status; finalUrl = body.url || (host === 'rdap.org' && body.body.errorCode ? 'https://rdap.verisign.com/x' : u); body = body.body; }
  const text = body && body.raw ? body.text : JSON.stringify(body);
  return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Not Found', url: finalUrl, text: async () => text };
};

setSetting('COMPANY_COUNTRY', 'IQ');

// ---------------------------------------------------------------- tests --

test('every new capability is a read, and the connector is fenced to every host it names', () => {
  for (const s of Live.SOURCES) assert.ok(isRead(s.capability), `${s.capability} reads`);
  Live.goLive({ actor: ME });
  const allow = JSON.parse(one("SELECT allowlist FROM connectors WHERE id = 'opendata'").allowlist);
  for (const h of ['rdap.verisign.com', 'pubapi.registry.google', 'api.github.com', 'export.arxiv.org', 'eonet.gsfc.nasa.gov', 'api.aladhan.com']) assert.ok(allow.includes(h), h);
});

test('the world is read once: 217 economies would be here, aggregates are not', async () => {
  await Live.refreshDue({ force: true });
  const w = Live.read('world', 'all').data;
  assert.deepEqual(Object.keys(w.countries).sort(), ['AE', 'DE', 'EG', 'IQ', 'SA']);
  assert.equal(w.indicators.EG.inflation.value, 33);
  assert.equal(w.indicators['1A'], undefined, 'Arab World is an aggregate, not a market');
  assert.equal(parseWorld([{}, []], {}).countries && Object.keys(parseWorld([{}, []], {}).countries).length, 0);
});

test('the ground under the company: the air, a fire near the capital, the day at home, the station overhead', () => {
  const ov = Live.overview();
  const iq = ov.places.find((p) => p.code === 'IQ');
  assert.equal(iq.capital, 'Baghdad', 'the whole world\'s list places the capital');
  assert.equal(iq.air.aqi, 152);
  assert.equal(ov.events.near.length, 1);
  assert.equal(ov.events.near[0].near.code, 'IQ');
  assert.equal(ov.events.counts.wildfires, 1);
  assert.equal(ov.day.hijri.year, 1448);
  assert.equal(ov.day.ramadan.date, '2027-02-07');
  assert.ok(ov.day.next.name, 'there is always a next prayer');
  assert.equal(ov.iss.track.length, 10);
  assert.equal(ov.frontpage.stories.length, 2);
  const b = Live.brief();
  assert.equal(b.eventsNear, 1);
  assert.equal(b.air.aqi, 152);
  assert.ok(b.day.ramadanIn > 0);
  const c = Live.country('IQ');
  assert.equal(c.indicators.corruption.value, -1.25, 'governance comes from the world read');
  assert.equal(c.events.length, 1);
});

test('the parsers: an arXiv feed, a polygon event, a registry answer', () => {
  const a = parseArxiv('<opensearch:totalResults>5</opensearch:totalResults><entry><id>x</id><title> T &amp; U </title><summary>s</summary><published>2026-01-02T00:00:00Z</published><author><name>N</name></author></entry>');
  assert.equal(a.total, 5);
  assert.equal(a.papers[0].title, 'T & U');
  const e = parseEvents({ events: [{ id: 'p', title: 'flood', categories: [{ id: 'floods' }], geometry: [{ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }] }] });
  assert.deepEqual([e[0].lat, e[0].lon], [1, 1]);
  assert.equal(rdapVerdict({ status: 200, data: { objectClassName: 'domain' } }).state, 'taken');
  assert.equal(rdapVerdict({ status: 404, data: { title: 'Not Found' } }).state, 'free');
  assert.equal(rdapVerdict({ status: 429, data: null }).state, 'unknown', 'a registry asking us to slow down is not saying the name is free');
});

test('the radar: only a person chooses a subject, and the five reads come back with the time', async () => {
  assert.throws(() => Radar.addTopic({ query: 'x y', actor: 'agent:AGT-1' }), (e) => e.status === 403);
  const t = Radar.addTopic({ query: 'rising thing', actor: ME });
  assert.equal(t.wiki_title, 'Rising_thing');
  assert.throws(() => Radar.addTopic({ query: 'Rising Thing', actor: ME }), (e) => e.status === 409);
  Radar.addTopic({ query: 'quiet thing', actor: ME });
  Radar.addTopic({ query: 'nothing at all', actor: ME });
  const r = await Radar.refresh({ force: true });
  assert.equal(r.topics, 3);
  const full = Radar.topic(t.id);
  assert.equal(full.attention.trend.ratio, 3);
  assert.equal(full.stories.top[0].title, 'A big launch');
  assert.equal(full.papers.total, 1234);
  assert.equal(full.repos.top[0].stars, 2400);
  assert.equal(full.jobs.count, 22, 'a reply in the thread is a question, not a posting');
  assert.equal(full.jobs.remote, 11);
  assert.equal(full.jobs.withPay[0].salary, '$150k - $190k');
  assert.equal(full.jobs.thread.title, 'Ask HN: Who is hiring? (October 2026)');
});

test('signals: attention rising is one, a thin page is not, and each is recorded once a day', async () => {
  const ov = Radar.overview();
  const kinds = (q) => ov.signals.filter((s) => s.query === q).map((s) => s.kind).sort();
  assert.deepEqual(kinds('rising thing'), ['attention.rising', 'jobs.demand', 'repos.breakout', 'stories.hot']);
  // Five readers a day becoming thirty is a ratio of six, and also nothing: below the floor.
  assert.ok(!kinds('quiet thing').includes('attention.rising'));
  const missing = ov.topics.find((x) => x.query === 'nothing at all');
  assert.equal(missing.missingPage, true, 'a subject with no encyclopaedia page says so');
  const n = one('SELECT COUNT(*) AS n FROM radar_signals').n;
  Radar.detect();
  assert.equal(one('SELECT COUNT(*) AS n FROM radar_signals').n, n, 'the same news twice is not two signals');
  assert.ok(one("SELECT COUNT(*) AS n FROM notifications WHERE source = 'radar'").n >= 1, 'attention tripling reaches the tray');
  assert.equal(Radar.attentionTrend([['d', 1]]), null);
});

test('the atlas ranks on the record, and the weights decide', () => {
  const growth = Atlas.score({ region: 'mena', weights: { size: 0, growth: 5, wealth: 0, digital: 0, stability: 0, proximity: 0 } });
  assert.equal(growth.ready, true);
  assert.ok(!growth.rows.some((r) => r.code === 'IQ'), 'home is the benchmark, not a candidate');
  assert.equal(growth.rows[0].code, 'SA');
  const stable = Atlas.score({ region: 'mena', weights: { size: 0, growth: 0, wealth: 0, digital: 0, stability: 5, proximity: 0 } });
  assert.equal(stable.rows[0].code, 'AE');
  assert.equal(stable.rows.at(-1).code, 'EG', 'a third off prices every year is not stability');
  const custom = Atlas.score({ codes: 'DE,AE', weights: { proximity: 5, size: 0, growth: 0, wealth: 0, digital: 0, stability: 0 } });
  assert.equal(custom.rows[0].code, 'AE', 'nearer, and speaks Arabic');
  // Egypt has no regulation estimate in this world: the pillar is built from what exists.
  const eg = stable.rows.find((r) => r.code === 'EG');
  assert.ok(eg.pillars.stability != null && eg.raw.regulation === undefined);
  assert.ok(stable.homeRow, 'home is shown beside the ranking for comparison');
});

test('the shortlist is a person\'s decision, moved along stages, on the chain', () => {
  assert.throws(() => Atlas.shortlist({ code: 'SA', actor: 'system:x' }), (e) => e.status === 403);
  assert.throws(() => Atlas.shortlist({ code: 'IQ', actor: ME }), (e) => e.status === 409);
  Atlas.shortlist({ code: 'sa', note: 'big and near', actor: ME });
  Atlas.shortlist({ code: 'AE', actor: ME });
  Atlas.setStage({ code: 'SA', stage: 'researching', actor: ME });
  assert.throws(() => Atlas.setStage({ code: 'SA', stage: 'conquered', actor: ME }), /stage/);
  const ov = Atlas.overview();
  assert.equal(ov.shortlist[0].code, 'SA');
  assert.equal(ov.shortlist[0].name, 'Saudi Arabia');
  const short = Atlas.score({ region: 'shortlist' });
  assert.deepEqual(short.rows.map((r) => r.code).sort(), ['AE', 'SA']);
  assert.ok(short.rows.every((r) => r.shortlisted));
  Atlas.unlist({ code: 'AE', actor: ME });
  assert.equal(Atlas.overview().shortlist.length, 1);
});

test('naming: a registry\'s 404 is free, a record is taken, and an unknown zone is not counted', async () => {
  assert.equal(Naming.slug('  Álpha Core! '), 'alphacore');
  assert.ok(Naming.variations('Nova').includes('getnova'));
  await assert.rejects(Naming.check({ name: 'x', actor: 'agent:1' }), (e) => e.status === 403);
  const taken = await Naming.check({ name: 'AlphaCore', actor: ME });
  assert.equal(taken.results.domains.com.state, 'taken');
  assert.equal(taken.results.domains.ai.state, 'free');
  assert.equal(taken.results.domains.tech.state, 'unknown');
  assert.equal(taken.results.domains.co, undefined, 'a zone with no RDAP server is not offered');
  assert.equal(taken.results.github.state, 'taken');
  assert.equal(taken.results.npm.state, 'taken');
  assert.equal(taken.results.known.title, 'AlphaCore');
  const free = await Naming.check({ name: 'Zephyrion', actor: ME });
  assert.equal(free.score, 100);
  assert.ok(taken.score < free.score);
  Naming.mark({ id: free.id, starred: true, verdict: 'favourite', note: 'say it out loud', actor: ME });
  assert.throws(() => Naming.mark({ id: free.id, verdict: 'perfect', actor: ME }), /verdict/);
  const ov = Naming.overview();
  assert.equal(ov.names[0].label, 'zephyrion');
  assert.equal(ov.names[0].starred, true);
  Naming.remove({ id: taken.id, actor: ME });
  assert.equal(Naming.overview().names.length, 1);
});

test('nothing here works with live data off, and every decision is on an intact chain', async () => {
  Live.pause({ actor: ME });
  await assert.rejects(Naming.check({ name: 'later', actor: ME }), (e) => e.status === 409);
  await assert.rejects(Radar.readNow({ id: 1, actor: ME }), (e) => e.status === 409);
  assert.deepEqual(await Radar.refresh(), { skipped: 'live data is off' });
  const acts = new Set(q("SELECT action FROM audit_log WHERE action LIKE 'radar.%' OR action LIKE 'atlas.%' OR action LIKE 'naming.%'").map((r) => r.action));
  for (const a of ['radar.watch', 'atlas.shortlisted', 'atlas.stage', 'atlas.unlisted', 'naming.checked', 'naming.marked', 'naming.removed']) assert.ok(acts.has(a), a);
  assert.equal(verifyChain().ok, true);
});

test('three departments, catalogued, placed once, with their powers', () => {
  const cat = sectionCatalog();
  for (const id of ['radar', 'atlas', 'naming']) {
    assert.ok(cat.find((s) => s.id === id), id);
    assert.equal(SURFACES.filter((s) => s.departments.includes(id)).length, 1, id);
    assert.ok(PERMS.includes(`${id}.view`) && PERMS.includes(`${id}.manage`));
    assert.ok(expandTemplate('operator').includes(`${id}.manage`));
  }
});
