// The naming studio — whether a name is still free where a company needs it.
//
// A name is checked in the places a new product actually has to own it: the
// domain in nine zones (each registry's own RDAP answer), the handle on
// GitHub, the package on npm, and the encyclopaedia (a name that is already
// a famous thing is a name the company will be searched past). Every check
// is a read through the gate and is kept, so a shortlist of names can be
// compared side by side and a decision written down beside the evidence.
//
// "Free" here means "not registered when we asked". It is not a trademark
// search and the page says so; a person who falls in love with a name still
// asks a lawyer before printing it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { isLive, pull } from './livedata.js';
import { NAME_TLDS } from './connectors/openworld.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');

/** The name as a domain label: lower case, letters, digits and inner hyphens; accents folded. */
export function slug(name) {
  return String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '').replace(/^-+|-+$/g, '').replace(/--+/g, '-').slice(0, 63);
}

/** Variations worth checking when the plain name is gone — built here, so suggesting asks nobody. */
export function variations(name) {
  const s = slug(name);
  if (!s) return [];
  const out = [`get${s}`, `${s}hq`, `${s}app`, `${s}ai`, `try${s}`, `${s}labs`, `${s}io`, `use${s}`, `${s}-co`, `go${s}`];
  return [...new Set(out)].filter((x) => x.length <= 63 && x !== s);
}

/** Of the places checked, how many are free — and the .com counts double, because it is the one people type. */
export function scoreOf(r) {
  let free = 0; let asked = 0;
  for (const [tld, v] of Object.entries(r.domains || {})) {
    if (v.state === 'unknown') continue;
    const w = tld === 'com' ? 2 : 1;
    asked += w; if (v.state === 'free') free += w;
  }
  for (const v of [r.github, r.npm]) { if (!v || v.state === 'unknown') continue; asked += 1; if (v.state === 'free') free += 1; }
  return asked ? Math.round((free / asked) * 100) : null;
}

export async function check({ name, actor }) {
  if (!isHuman(actor)) refuse('a person checks a name', 403);
  if (!isLive()) refuse('live data is off — a person switches it on first', 409);
  const s = slug(name);
  if (!s || s.length < 2) refuse('a name needs at least two letters or digits');
  const opt = { actor, reason: `is "${s}" free` };
  const [dom, hdl, wiki] = await Promise.all([
    pull('domain', s, { name: s, tlds: NAME_TLDS }, opt),
    pull('handle', s, { name: s }, opt),
    pull('wiki', `en:${s}`, { title: String(name).trim().slice(0, 120), lang: 'en' }, opt),
  ]);
  if (!dom?.data && !hdl?.data) refuse(dom?.error || hdl?.error || 'the registries did not answer', 502);
  const results = {
    domains: dom?.data?.domains || {}, github: hdl?.data?.github || null, npm: hdl?.data?.npm || null,
    known: wiki?.data?.found ? { title: wiki.data.title, description: wiki.data.description || null, url: wiki.data.url || null } : null,
  };
  const score = scoreOf(results);
  exec(`INSERT INTO naming_checks (name, label, results, score, checked_by) VALUES (?,?,?,?,?)
        ON CONFLICT(label) DO UPDATE SET name = excluded.name, results = excluded.results, score = excluded.score,
          checked_by = excluded.checked_by, checked_at = datetime('now')`,
  String(name).trim().slice(0, 80), s, JSON.stringify(results), score, actor);
  const row = one('SELECT * FROM naming_checks WHERE label = ?', s);
  audit({ actorType: 'human', actorId: actor, action: 'naming.checked', subjectType: 'naming_check', subjectId: String(row.id), payload: { label: s, score } });
  return view(row);
}

export function mark({ id, starred = null, verdict = null, note = null, actor }) {
  if (!isHuman(actor)) refuse('a person decides about a name', 403);
  const row = one('SELECT * FROM naming_checks WHERE id = ?', Number(id)) || refuse('no such name', 404);
  if (verdict !== null && !['', 'favourite', 'maybe', 'no'].includes(verdict)) refuse('a verdict is favourite, maybe or no');
  exec('UPDATE naming_checks SET starred = COALESCE(?, starred), verdict = COALESCE(?, verdict), note = COALESCE(?, note) WHERE id = ?',
    starred === null ? null : (starred ? 1 : 0), verdict, note, row.id);
  audit({ actorType: 'human', actorId: actor, action: 'naming.marked', subjectType: 'naming_check', subjectId: String(row.id), payload: { starred, verdict, note } });
  return view(one('SELECT * FROM naming_checks WHERE id = ?', row.id));
}

export function remove({ id, actor }) {
  if (!isHuman(actor)) refuse('a person removes a name', 403);
  const row = one('SELECT * FROM naming_checks WHERE id = ?', Number(id)) || refuse('no such name', 404);
  exec('DELETE FROM naming_checks WHERE id = ?', row.id);
  audit({ actorType: 'human', actorId: actor, action: 'naming.removed', subjectType: 'naming_check', subjectId: String(row.id), payload: { label: row.label } });
  return { removed: row.id };
}

const view = (r) => ({ ...r, starred: Boolean(r.starred), results: JSON.parse(r.results) });

export function overview() {
  return {
    live: isLive(),
    tlds: NAME_TLDS,
    names: q("SELECT * FROM naming_checks ORDER BY starred DESC, CASE verdict WHEN 'favourite' THEN 0 WHEN 'maybe' THEN 1 WHEN 'no' THEN 3 ELSE 2 END, score DESC, checked_at DESC").map(view),
  };
}
