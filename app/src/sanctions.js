// Sanctions lists — the reference data both cores screen against.
//
// The UN and OFAC lists are downloaded through the gate once a day, once a
// person has turned them on, and kept here as names: each listed party under
// its reference, with its aliases as further names under the same reference.
// This is reference data rather than a department — AML on Core 1 and
// remittances on Core 2 both read it, and neither owns it.
//
// Matching is stricter than for a short in-house watchlist. Against twenty
// thousand names a single shared word ("Mohammed", "Trading") would match
// half the customers, so a token match needs at least two names in common
// covering the shorter name; otherwise only a close spelling counts. A hit is
// a question for a person, as everywhere else.
import { q, one, exec, db, atomically } from './db.js';
import { audit } from './audit.js';
import { fold, compareFolded } from './screening.js';
import { callConnector, connect, setConnectorState } from './connectors/index.js';
import { SOURCES } from './connectors/sanctions.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');

export const LISTS = ['un', 'ofac'];
export const THRESHOLD = 0.88;

// ------------------------------------------------------------- matching --

let index = null;

/** Built on first use and after every refresh: folded names, and which names hold each word. */
function getIndex() {
  if (index) return index;
  const entries = q('SELECT list, ref, name, folded, kind, program FROM sanctions_entries');
  const byToken = new Map();
  entries.forEach((e, i) => {
    for (const t of new Set(e.folded.split(' '))) {
      if (t.length < 3) continue;
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(i);
    }
  });
  index = { entries, byToken };
  return index;
}
export const forgetIndex = () => { index = null; };

/** Every listed name close enough to `name` to stop and look, best first, one per listed party. */
export function matchSanctions(name, { threshold = THRESHOLD, limit = 5 } = {}) {
  const fa = fold(name);
  if (!fa) return [];
  const { entries, byToken } = getIndex();
  if (!entries.length) return [];
  const cand = new Set();
  for (const t of new Set(fa.split(' '))) for (const i of byToken.get(t) || []) cand.add(i);
  const best = new Map();
  for (const i of cand) {
    const e = entries[i];
    const c = compareFolded(fa, e.folded);
    const score = Math.max(c.minTokens >= 2 && c.common >= 2 ? c.tokens : 0, c.edit);
    if (score < threshold) continue;
    const key = `${e.list}:${e.ref}`;
    if (!best.has(key) || best.get(key).score < score) {
      best.set(key, { list: e.list, ref: e.ref, name: e.name, kind: e.kind, program: e.program, score: Math.round(score * 100) / 100 });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// -------------------------------------------------------------- loading --

/**
 * Replace one list's names. A list that comes back less than half its previous
 * size is refused rather than loaded: a truncated download or a changed format
 * would otherwise quietly clear thousands of names off the screen.
 */
export function storeList(list, entries, { url = null, bytes = null, actor = 'system:sanctions' } = {}) {
  if (!LISTS.includes(list)) refuse(`no such list: ${list}`);
  // Parties, not names: the alias file can fail on its own, and a list without
  // its aliases is smaller without being truncated.
  const before = one('SELECT COUNT(DISTINCT ref) AS n FROM sanctions_entries WHERE list = ?', list).n;
  const parties = new Set(entries.filter((e) => !e.alias).map((e) => String(e.ref))).size;
  if (before && parties < before * 0.5) {
    exec(`INSERT INTO sanctions_lists (list, url, state, error) VALUES (?,?, 'refused', ?)
          ON CONFLICT(list) DO UPDATE SET state = 'refused', error = excluded.error`, list, url,
    `the new file lists ${parties} parties against ${before} before — kept the old list`);
    audit({ actorType: 'system', actorId: actor, action: 'sanctions.refused', subjectType: 'sanctions_list', subjectId: list, payload: { before, now: parties } });
    return { stored: false, before, now: parties };
  }
  // Aliases arrive without their party's kind and programme; they inherit them.
  const meta = new Map(entries.filter((e) => !e.alias).map((e) => [e.ref, e]));
  atomically(() => {
    exec('DELETE FROM sanctions_entries WHERE list = ?', list);
    const ins = db.prepare('INSERT INTO sanctions_entries (list, ref, name, folded, kind, program, alias) VALUES (?,?,?,?,?,?,?)');
    for (const e of entries) {
      const f = fold(e.name);
      if (!f) continue;
      const m = meta.get(e.ref) || {};
      ins.run(list, String(e.ref), String(e.name).slice(0, 300), f, e.kind || m.kind || null, e.program || m.program || null, e.alias ? 1 : 0);
    }
    const n = one('SELECT COUNT(*) AS n FROM sanctions_entries WHERE list = ?', list).n;
    exec(`INSERT INTO sanctions_lists (list, url, entries, bytes, fetched_at, state, error) VALUES (?,?,?,?, datetime('now'), 'ok', NULL)
          ON CONFLICT(list) DO UPDATE SET url = excluded.url, entries = excluded.entries, bytes = excluded.bytes, fetched_at = excluded.fetched_at, state = 'ok', error = NULL`,
    list, url, n, bytes);
  });
  forgetIndex();
  const n = one('SELECT entries FROM sanctions_lists WHERE list = ?', list).entries;
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'sanctions.loaded', subjectType: 'sanctions_list', subjectId: list, payload: { names: n, before } });
  return { stored: true, before, now: n };
}

function failed(list, verdict, why) {
  exec(`INSERT INTO sanctions_lists (list, state, error) VALUES (?,?,?)
        ON CONFLICT(list) DO UPDATE SET state = excluded.state, error = excluded.error`, list, verdict, String(why || '').slice(0, 300));
}

const fetchVia = (list, actor) => callConnector({ connector: 'sanctions', capability: 'list.fetch', args: { list }, actor, reason: `refresh the ${list} sanctions list` });

/** Download and load every list. Returns what changed, so the callers can rescreen. */
export async function refresh({ actor = 'system:sanctions' } = {}) {
  const out = {};
  for (const list of LISTS) {
    try {
      const r = await fetchVia(list, actor);
      if (r.verdict !== 'allowed') { failed(list, r.verdict, r.why); out[list] = { verdict: r.verdict, why: r.why }; continue; }
      let entries = r.result.entries;
      if (list === 'ofac') {
        const alt = await fetchVia('ofac_alt', actor);
        if (alt.verdict === 'allowed') entries = entries.concat(alt.result.entries);
      }
      out[list] = storeList(list, entries, { url: r.result.url, bytes: r.result.bytes, actor });
    } catch (e) {
      failed(list, 'failed', e.message);
      out[list] = { error: String(e.message) };
    }
  }
  return out;
}

export const live = () => one("SELECT state FROM connectors WHERE id = 'sanctions'")?.state === 'live';

export function goLive({ actor }) {
  if (!isHuman(actor)) refuse('a person turns the sanctions lists on', 403);
  connect('sanctions', { actor });
  setConnectorState('sanctions', 'live', { actor });
  return { live: live() };
}

export function goQuiet({ actor }) {
  if (!isHuman(actor)) refuse('a person turns the sanctions lists off', 403);
  setConnectorState('sanctions', 'paused', { actor });
  return { live: live() };
}

/** Due when switched on and the oldest list is more than twenty hours old. */
export function due() {
  if (!live()) return false;
  const oldest = one("SELECT MIN(COALESCE(fetched_at, '1970-01-01')) AS t FROM sanctions_lists")?.t;
  const missing = LISTS.some((l) => !one("SELECT 1 FROM sanctions_lists WHERE list = ? AND state = 'ok'", l));
  return missing || !oldest || oldest < new Date(Date.now() - 20 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
}

export function sanctionsOverview() {
  const rows = new Map(q('SELECT * FROM sanctions_lists').map((r) => [r.list, r]));
  return {
    live: live(),
    names: one('SELECT COUNT(*) AS n FROM sanctions_entries').n,
    lists: LISTS.map((l) => ({ list: l, label: SOURCES[l].label, url: SOURCES[l].url, ...(rows.get(l) || { entries: 0, state: 'never' }) })),
  };
}
