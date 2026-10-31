// The market atlas — where the company could go next, ranked on the World
// Bank's own figures with the weights the founder chooses.
//
// Six pillars, each built from figures for every economy in the world: size
// (the economy and its people), growth, wealth (income per person), digital
// reach (internet and mobile), stability (prices, political stability,
// regulation, control of corruption — the World Bank's governance estimates)
// and proximity (distance from home, and whether the market speaks Arabic).
// Each figure is placed between the lowest and highest among the candidates
// being compared, so a score means "better than the others on this list", not
// a grade against an ideal; a pillar with no figures for a country is left out
// of that country's total rather than counted as zero. The weights are the
// founder's opinion, and the ranking is what the record says under it.
//
// A shortlist is a decision being made, so adding to it and moving a market
// along it are a person's acts and on the chain.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { homeCountry } from './globe.js';
import { read, km, facts, isLive } from './livedata.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const ISO = /^[A-Z]{2}$/;

/** The members of the Arab League: a market whose language the company already writes in. */
export const ARABIC = new Set('DZ BH KM DJ EG IQ JO KW LB LY MR MA OM PS QA SA SO SD SY TN AE YE'.split(' '));

export const REGIONS = {
  gcc: { label: 'The Gulf', codes: 'SA AE KW QA BH OM'.split(' ') },
  mena: { label: 'Middle East and North Africa', codes: 'SA AE KW QA BH OM IQ JO LB SY EG LY TN DZ MA YE IR TR IL PS'.split(' ') },
  arab: { label: 'The Arabic-speaking world', codes: [...ARABIC] },
  africa: { label: 'Africa\'s largest', codes: 'NG EG ZA DZ MA ET KE GH CI TZ AO SN UG CM TN RW'.split(' ') },
  europe: { label: 'Europe', codes: 'DE GB FR IT ES NL PL SE BE AT CH IE PT DK NO FI CZ RO GR HU'.split(' ') },
  asia: { label: 'Asia', codes: 'CN IN JP KR ID TH VN MY SG PH PK BD KZ UZ'.split(' ') },
  americas: { label: 'The Americas', codes: 'US CA MX BR AR CO CL PE'.split(' ') },
  g20: { label: 'The G20', codes: 'AR AU BR CA CN FR DE IN ID IT JP KR MX RU SA ZA TR GB US'.split(' ') },
};

/** Which figures make each pillar, and whether more is better. Size and wealth are compared on a log scale. */
export const PILLARS = {
  size: [['gdp', 1, 'log'], ['population', 1, 'log']],
  growth: [['gdpGrowth', 1]],
  wealth: [['gdpPerCapita', 1, 'log']],
  digital: [['internet', 1], ['mobile', 1]],
  stability: [['inflation', -1, 'inflation'], ['stability', 1], ['regulation', 1], ['corruption', 1]],
  proximity: [['distance', -1], ['arabic', 1]],
};
export const DEFAULT_WEIGHTS = { size: 3, growth: 3, wealth: 2, digital: 2, stability: 3, proximity: 2 };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const transform = (v, how) => {
  if (v == null || !Number.isFinite(v)) return null;
  if (how === 'log') return v > 0 ? Math.log10(v) : null;
  // Inflation hurts in both directions away from a little: deflation is not a virtue.
  if (how === 'inflation') return Math.abs(clamp(v, -20, 60) - 2);
  return v;
};

function weightsFrom(w = {}) {
  const out = {};
  for (const k of Object.keys(PILLARS)) {
    const v = Number(w[k] ?? DEFAULT_WEIGHTS[k]);
    out[k] = Number.isFinite(v) ? clamp(v, 0, 5) : DEFAULT_WEIGHTS[k];
  }
  return out;
}

/**
 * Rank candidates. Pure: the world's figures come in, a ranking goes out,
 * so the test can hand it a world of three countries and know the answer.
 */
export function rank({ world, codes, weights, home }) {
  const W = weightsFrom(weights);
  const homeFacts = home ? world.countries[home] : null;
  const rows = codes.filter((c) => world.countries[c]).map((c) => {
    const f = world.countries[c]; const ind = world.indicators[c] || {};
    const raw = Object.fromEntries(Object.keys(world.indicators[c] || {}).map((k) => [k, ind[k].value]));
    raw.distance = homeFacts && f.lat != null && homeFacts.lat != null ? km(homeFacts, f) : null;
    raw.arabic = ARABIC.has(c) ? 1 : 0;
    return { code: c, name: f.name, region: f.region, income: f.income, capital: f.capital, raw, years: Object.fromEntries(Object.entries(ind).map(([k, v]) => [k, v.year])) };
  });
  // Each figure between the lowest and highest among these candidates.
  const scale = {};
  for (const metrics of Object.values(PILLARS)) {
    for (const [m, , how] of metrics) {
      const vals = rows.map((r) => transform(r.raw[m], how)).filter((v) => v != null);
      scale[m] = vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
    }
  }
  const out = rows.map((r) => {
    const pillars = {};
    for (const [p, metrics] of Object.entries(PILLARS)) {
      const parts = metrics.map(([m, dir, how]) => {
        const v = transform(r.raw[m], how); const sc = scale[m];
        if (v == null || !sc) return null;
        const span = sc[1] - sc[0];
        const x = span > 0 ? (v - sc[0]) / span : 0.5;
        return dir > 0 ? x : 1 - x;
      }).filter((x) => x != null);
      pillars[p] = parts.length ? Math.round((parts.reduce((a, x) => a + x, 0) / parts.length) * 100) : null;
    }
    let num = 0; let den = 0;
    for (const [p, v] of Object.entries(pillars)) if (v != null && W[p] > 0) { num += v * W[p]; den += W[p]; }
    const score = den ? Math.round(num / den) : null;
    const scored = Object.entries(pillars).filter(([p, v]) => v != null && W[p] > 0).sort((a, b) => b[1] - a[1]);
    return {
      ...r, pillars, score,
      strongest: scored.slice(0, 2).map(([p]) => p),
      weakest: scored.length > 2 ? scored.at(-1)[0] : null,
      missing: Object.entries(pillars).filter(([, v]) => v == null).map(([p]) => p),
    };
  }).filter((r) => r.score != null).sort((a, b) => b.score - a.score);
  out.forEach((r, i) => { r.rank = i + 1; });
  return { weights: W, rows: out };
}

function world() {
  const w = read('world', 'all');
  return w?.data ? { countries: w.data.countries || {}, indicators: w.data.indicators || {}, fetchedAt: w.fetchedAt } : null;
}

/** The ranking for a region, a custom list, or the shortlist. Reads the cache only. */
export function score({ region = 'mena', codes = null, weights = {} } = {}) {
  const w = world();
  const home = homeCountry();
  if (!w) return { ready: false, live: isLive(), region, regions: regionList(), weights: weightsFrom(weights), rows: [] };
  let list;
  if (codes) list = String(codes).toUpperCase().split(/[,\s]+/).filter((c) => ISO.test(c)).slice(0, 60);
  else if (region === 'shortlist') list = q('SELECT code FROM atlas_shortlist').map((r) => r.code);
  else if (region === 'all') list = Object.keys(w.countries);
  else list = (REGIONS[region] || REGIONS.mena).codes;
  // Home is the benchmark, not a candidate.
  const r = rank({ world: w, codes: list.filter((c) => c !== home), weights, home });
  const shortlisted = new Set(q('SELECT code FROM atlas_shortlist').map((x) => x.code));
  return {
    ready: true, live: isLive(), fetchedAt: w.fetchedAt, region, regions: regionList(), home,
    homeRow: home ? rank({ world: w, codes: [home, ...list.filter((c) => c !== home)], weights, home }).rows.find((x) => x.code === home) || null : null,
    weights: r.weights, rows: r.rows.map((x) => ({ ...x, shortlisted: shortlisted.has(x.code) })),
  };
}

const regionList = () => Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label, count: r.codes.length }));

export const STAGES = ['watching', 'researching', 'entering', 'operating', 'dropped'];

export function shortlist({ code, note = null, actor }) {
  if (!isHuman(actor)) refuse('a person shortlists a market', 403);
  const cc = String(code || '').toUpperCase();
  if (!ISO.test(cc)) refuse('a two-letter country code');
  if (cc === homeCountry()) refuse('home is where the company already is', 409);
  if (!facts()[cc]) refuse('no figures for that country yet — live data reads the world first', 409);
  exec(`INSERT INTO atlas_shortlist (code, note, added_by) VALUES (?,?,?)
        ON CONFLICT(code) DO UPDATE SET note = COALESCE(excluded.note, atlas_shortlist.note)`, cc, note || null, actor);
  audit({ actorType: 'human', actorId: actor, action: 'atlas.shortlisted', subjectType: 'atlas_market', subjectId: cc, payload: { note } });
  return one('SELECT * FROM atlas_shortlist WHERE code = ?', cc);
}

export function setStage({ code, stage, note, actor }) {
  if (!isHuman(actor)) refuse('a person moves a market along', 403);
  if (!STAGES.includes(stage)) refuse(`a stage is one of ${STAGES.join(', ')}`);
  const row = one('SELECT * FROM atlas_shortlist WHERE code = ?', String(code || '').toUpperCase()) || refuse('not on the shortlist', 404);
  exec("UPDATE atlas_shortlist SET stage = ?, note = COALESCE(?, note), updated_at = datetime('now') WHERE code = ?", stage, note || null, row.code);
  audit({ actorType: 'human', actorId: actor, action: 'atlas.stage', subjectType: 'atlas_market', subjectId: row.code, payload: { from: row.stage, to: stage, note } });
  return one('SELECT * FROM atlas_shortlist WHERE code = ?', row.code);
}

export function unlist({ code, actor }) {
  if (!isHuman(actor)) refuse('a person takes a market off the shortlist', 403);
  const row = one('SELECT * FROM atlas_shortlist WHERE code = ?', String(code || '').toUpperCase()) || refuse('not on the shortlist', 404);
  exec('DELETE FROM atlas_shortlist WHERE code = ?', row.code);
  audit({ actorType: 'human', actorId: actor, action: 'atlas.unlisted', subjectType: 'atlas_market', subjectId: row.code, payload: { stage: row.stage } });
  return { removed: row.code };
}

export function overview() {
  const w = world();
  const f = facts();
  return {
    ready: Boolean(w), live: isLive(), fetchedAt: w?.fetchedAt || null, economies: w ? Object.keys(w.countries).length : 0,
    home: homeCountry(), regions: regionList(), defaults: DEFAULT_WEIGHTS, stages: STAGES,
    shortlist: q('SELECT * FROM atlas_shortlist ORDER BY CASE stage WHEN \'operating\' THEN 0 WHEN \'entering\' THEN 1 WHEN \'researching\' THEN 2 WHEN \'watching\' THEN 3 ELSE 4 END, added_at')
      .map((r) => ({ ...r, name: f[r.code]?.name || r.code, capital: f[r.code]?.capital || null })),
  };
}
