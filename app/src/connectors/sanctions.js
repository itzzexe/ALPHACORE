// Sanctions lists — the UN Security Council's consolidated list and OFAC's
// SDN list, downloaded from the files their publishers put out for exactly
// this. No key, no scraping. The parsers are here, beside the fetch, so what
// crosses back into the platform is names and references, never the raw file.
import { assertPublicUrl } from '../web.js';
import { mayFetch, userAgent } from '../robots.js';

const MAX_BYTES = 25_000_000;

export const SOURCES = {
  un: { label: 'UN Security Council consolidated list', url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml' },
  ofac: { label: 'OFAC Specially Designated Nationals (SDN)', url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV' },
  ofac_alt: { label: 'OFAC SDN aliases', url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV' },
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m).replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
const tags = (block, name) => [...block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => decode(m[1]));

/** The UN list: every individual and entity, with its aliases as further names under the same reference. */
export function parseUn(xml) {
  const out = [];
  for (const [kind, el, aliasEl] of [['individual', 'INDIVIDUAL', 'INDIVIDUAL_ALIAS'], ['entity', 'ENTITY', 'ENTITY_ALIAS']]) {
    for (const m of String(xml).matchAll(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`, 'g'))) {
      const b = m[1];
      const ref = tag(b, 'REFERENCE_NUMBER') || tag(b, 'DATAID');
      const name = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((n) => tag(b, n)).filter(Boolean).join(' ');
      const program = tag(b, 'UN_LIST_TYPE');
      if (!ref || !name) continue;
      out.push({ ref, name, kind, program, alias: false });
      const original = tag(b, 'NAME_ORIGINAL_SCRIPT');
      if (original) out.push({ ref, name: original, kind, program, alias: true });
      for (const a of String(b).matchAll(new RegExp(`<${aliasEl}>([\\s\\S]*?)</${aliasEl}>`, 'g'))) {
        for (const an of tags(a[1], 'ALIAS_NAME')) if (an && an !== name) out.push({ ref, name: an, kind, program, alias: true });
      }
    }
  }
  return out;
}

/** One CSV line, with quoted fields and doubled quotes inside them. */
export function csvLine(line) {
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// OFAC writes "-0-" for an empty field and "SURNAME, Given" for people.
const ofacName = (n) => { const s = String(n || '').trim(); const m = s.match(/^([^,]+),\s*(.+)$/); return m ? `${m[2]} ${m[1]}` : s; };
const ofacEmpty = (v) => (!v || v === '-0-' ? '' : v);

/** OFAC SDN.CSV: ent_num, name, type, program, … */
export function parseOfac(csv) {
  const out = [];
  for (const line of String(csv).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, name, type, program] = csvLine(line);
    if (!/^\d+$/.test(ref) || !ofacEmpty(name)) continue;
    const kind = ofacEmpty(type) === 'individual' ? 'individual' : ofacEmpty(type) || 'entity';
    out.push({ ref, name: ofacName(name), kind, program: ofacEmpty(program), alias: false });
  }
  return out;
}

/** OFAC ALT.CSV: ent_num, alt_num, alt_type, alt_name, remarks. */
export function parseOfacAlt(csv) {
  const out = [];
  for (const line of String(csv).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, , , name] = csvLine(line);
    if (!/^\d+$/.test(ref) || !ofacEmpty(name)) continue;
    out.push({ ref, name: ofacName(name), alias: true });
  }
  return out;
}

const PARSE = { un: parseUn, ofac: parseOfac, ofac_alt: parseOfacAlt };

/** Download one list, following redirects by hand so each hop is checked, and return its names. */
export async function fetchList(list) {
  const src = SOURCES[list];
  if (!src) throw new Error(`no such list: ${list}`);
  let url = src.url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    const robots = await mayFetch(url);
    if (!robots.allowed) throw new Error(`robots.txt: ${robots.why}`);
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': userAgent() }, signal: AbortSignal.timeout(120_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).toString(); continue; }
    if (!res.ok) throw new Error(`${list} ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error(`${list} is larger than expected (${body.length} bytes) — refusing to load it`);
    const entries = PARSE[list](body);
    if (!entries.length) throw new Error(`${list}: the file had no names — the format may have changed`);
    return { list, url, bytes: body.length, entries };
  }
  throw new Error('too many redirects');
}

export default {
  id: 'sanctions',
  label: 'Sanctions lists — UN and OFAC',
  auth: { kind: 'none' },
  docs: 'The UN consolidated list and the OFAC SDN list, from their publishers’ download addresses. No key.',
  quotaDay: 20,
  capabilities: ['list.fetch'],
  ops: {
    'list.fetch': {
      target: (a) => SOURCES[a.list]?.url || String(a.list),
      run: (args) => fetchList(args.list),
    },
  },
};
