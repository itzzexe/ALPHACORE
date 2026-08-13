// Intelligence division — a multi-pass collection pipeline, not a single
// prompt. A query runs as a small research campaign:
//
//   1. COLLECT   the Intelligence agent proposes candidate organizations from
//                training knowledge (names, geography, sector, likely domain).
//   2. ENRICH    every candidate's OWN website is fetched over HTTP and mined
//                for real emails, phones, address and social profiles — each
//                value stamped with the exact source URL (see enrich.js).
//   3. GAP-FILL  records still missing a domain or contacts go back to the
//                agent for a better domain hypothesis, then get re-enriched —
//                the hypothesis only becomes fact if the site confirms it.
//   4. EXPAND    if the target count isn't met, another collection round runs
//                excluding everything already found, until the target is hit
//                or two consecutive rounds return nothing new.
//   5. SCORE     each record gets a completeness score, an explicit gap list,
//                and a provenance trail; humans verify before any outreach.
//
// The honesty rule is structural: model-proposed contact details are never
// written into a record's contact fields. Only web-confirmed values (method
// 'web-scrape', with a URL) or human entries land there. Everything else is
// declared a gap. That is what makes the output usable for targeting.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { createCustomer } from './commercial.js';
import { archiveItem } from './data.js';
import { enrichFromWeb, discoverPeople, deepCrawl, inferEmailPattern, applyEmailPattern } from './enrich.js';

const INTEL_DIR = path.join(WS_ROOT, '_intel');
const MAX_ROUNDS = 4;
const ENRICH_PER_TICK = 3;

// ---------- scoring ----------
const WEIGHTS = { email: 0.24, phone: 0.24, address: 0.14, website: 0.14, profile: 0.08, city: 0.05, country: 0.05, linkedin: 0.06 };

function scoreRecord(r) {
  let s = 0;
  const gaps = [];
  for (const [f, w] of Object.entries(WEIGHTS)) {
    if (r[f]) s += w; else gaps.push(f);
  }
  return { completeness: Math.round(s * 100) / 100, gaps };
}

function refreshScore(id) {
  const r = one('SELECT * FROM intel_records WHERE id = ?', id);
  if (!r) return;
  const { completeness, gaps } = scoreRecord(r);
  exec('UPDATE intel_records SET completeness = ?, gaps = ? WHERE id = ?', completeness, JSON.stringify(gaps), id);
}

function evidence(recordId, field, value, method, sourceUrl = null, confidence = null) {
  if (!value) return;
  exec('INSERT INTO intel_evidence (record_id, field, value, method, source_url, confidence) VALUES (?,?,?,?,?,?)',
    recordId, field, String(value).slice(0, 400), method, sourceUrl, confidence);
}

// ---------- rules: conditional escalation ----------
// A campaign is not just a search, it is a policy. Each rule says: WHEN a
// record still lacks something, THEN escalate a specific way. The classic
// case — a company that publishes no switchboard number — escalates to
// finding the people inside it, because a named manager is reachable even
// when the company is not.
export const RULE_CATALOG = [
  {
    id: 'people-when-no-phone', when: 'no-phone', action: 'find-people',
    label: 'No company phone → find people inside the company',
    detail: 'Crawls the team, leadership, management and staff pages for named managers with their own direct phone or email.',
  },
  {
    id: 'people-when-no-contact', when: 'no-contact', action: 'find-people',
    label: 'No email AND no phone → find people inside the company',
    detail: 'Same escalation, triggered only when the organization is completely unreachable at the company level.',
  },
  {
    id: 'ask-executives', when: 'no-people', action: 'ask-people',
    label: 'No people found on the site → ask the agent who runs it',
    detail: 'The agent names known executives and their roles from training knowledge. It never invents their contact details — those must still be confirmed or derived.',
  },
  {
    id: 'derive-emails', when: 'people-without-email', action: 'derive-emails',
    label: 'Person known but no address → derive it from the company pattern',
    detail: 'If the site shows e.g. ahmed.hassan@acme.iq, the first.last pattern is applied to named people. Marked pattern-derived and low-confidence — a hypothesis to test, never a verified fact.',
  },
  {
    id: 'deep-when-no-address', when: 'no-address', action: 'deep-crawl',
    label: 'No address → sweep locations, branches and legal pages',
    detail: 'Crawls /locations, /branches, /offices, /imprint and similar pages for a postal address and any extra numbers.',
  },
  {
    id: 'deep-when-no-phone', when: 'no-phone', action: 'deep-crawl',
    label: 'No phone → sweep the secondary pages too',
    detail: 'Numbers are often only in the footer of a branches or legal page.',
  },
];

const RULE_BY_ID = Object.fromEntries(RULE_CATALOG.map((r) => [r.id, r]));

function conditionHolds(when, r, peopleCount) {
  switch (when) {
    case 'no-phone': return !r.phone;
    case 'no-email': return !r.email;
    case 'no-contact': return !r.phone && !r.email;
    case 'no-address': return !r.address;
    case 'no-people': return peopleCount === 0;
    case 'people-without-email': return peopleCount > 0;
    case 'always': return true;
    default: return false;
  }
}

/** Hard constraints — what a record must satisfy to count as a result. */
function checkConstraints(r, c) {
  if (!c) return null;
  if (c.requirePhone && !r.phone && !one("SELECT id FROM intel_contacts WHERE record_id = ? AND phone IS NOT NULL LIMIT 1", r.id)) return 'no phone (required)';
  if (c.requireEmail && !r.email && !one("SELECT id FROM intel_contacts WHERE record_id = ? AND email IS NOT NULL LIMIT 1", r.id)) return 'no email (required)';
  if (c.requireWebsite && r.enrichment !== 'enriched') return 'website unreachable (required)';
  if (c.minCompleteness && r.completeness < Number(c.minCompleteness)) return `completeness ${Math.round(r.completeness * 100)}% below ${Math.round(Number(c.minCompleteness) * 100)}%`;
  if (c.country && !String(r.country || '').toLowerCase().includes(String(c.country).toLowerCase())) return `country is not ${c.country}`;
  if (c.mustMention) {
    const hay = `${r.name} ${r.profile || ''} ${r.sector || ''}`.toLowerCase();
    const words = String(c.mustMention).split(/[,،]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length && !words.some((w) => hay.includes(w))) return `profile does not mention ${words.join(' / ')}`;
  }
  if (c.excludeKeywords) {
    const hay = `${r.name} ${r.profile || ''} ${r.sector || ''}`.toLowerCase();
    const bad = String(c.excludeKeywords).split(/[,،]/).map((w) => w.trim().toLowerCase()).filter(Boolean)
      .find((w) => hay.includes(w));
    if (bad) return `excluded keyword "${bad}"`;
  }
  return null;
}

// ---------- query creation ----------
const CRITERIA_FIELDS = ['sector', 'country', 'city', 'kind', 'size', 'keywords', 'exclude', 'language'];

/** Turn structured criteria into a precise brief the collector can follow. */
function briefFor(criteria, question, targetCount, excludeNames = []) {
  const c = criteria || {};
  const lines = [
    `Objective: compile ${targetCount} distinct, real organizations matching ALL of these criteria.`,
    c.kind ? `Type: ${c.kind}` : null,
    c.sector ? `Sector / industry: ${c.sector}` : null,
    c.country ? `Country: ${c.country}` : null,
    c.city ? `City / region: ${c.city}` : null,
    c.size ? `Size band: ${c.size}` : null,
    c.keywords ? `Must relate to: ${c.keywords}` : null,
    c.exclude ? `Exclude: ${c.exclude}` : null,
    question ? `Analyst's note: ${question}` : null,
  ].filter(Boolean);
  if (excludeNames.length) {
    lines.push(`ALREADY COLLECTED — return NONE of these, only NEW ones: ${excludeNames.slice(0, 60).join('; ')}`);
  }
  lines.push(
    '',
    'For each organization give: official English name, Arabic name if it has one, sector, country, city,',
    'a 2-3 sentence factual profile, and the most likely OFFICIAL website domain (bare domain, e.g. "example.iq").',
    'The domain is a hypothesis — the platform will fetch the site and confirm it, so give your best guess rather than nothing.',
    'Do NOT invent emails, phone numbers, or street addresses: leave them null. The platform harvests those from the live site.',
    'Prefer organizations that genuinely exist and are findable; mark uncertainty by lowering confidence, never by inventing detail.',
    '',
    'Output JSON exactly:',
    '{"records":[{"name":"","nameAr":null,"kind":"company","sector":null,"country":null,"city":null,"region":null,"sizeHint":null,"profile":"","domain":null,"confidence":0.0}],"summary":"","confidence":0.0}',
  );
  return lines.join('\n');
}

export function createIntelQuery({ question, criteria = null, targetCount = 15, rules = null, constraints = null, actor }) {
  const c = criteria && typeof criteria === 'object'
    ? Object.fromEntries(CRITERIA_FIELDS.filter((f) => criteria[f]).map((f) => [f, String(criteria[f]).slice(0, 200)]))
    : null;
  if (!question?.trim() && !c) throw new Error('a question or at least one criterion is required');
  const target = Math.min(60, Math.max(1, Number(targetCount) || 15));
  const label = question?.trim() || Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(' · ');
  const activeRules = Array.isArray(rules) ? rules.filter((x) => RULE_BY_ID[x]) : [];
  const cons = constraints && typeof constraints === 'object'
    ? Object.fromEntries(Object.entries(constraints).filter(([, v]) => v !== null && v !== '' && v !== false))
    : null;
  exec('INSERT INTO intel_queries (question, criteria, target_count, created_by, rules, constraints) VALUES (?,?,?,?,?,?)',
    label, c ? JSON.stringify(c) : null, target, actor,
    activeRules.length ? JSON.stringify(activeRules) : null,
    cons && Object.keys(cons).length ? JSON.stringify(cons) : null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-INT-001',
    taskType: `intel:${id}:r1`,
    input: { prompt: briefFor(c, question?.trim(), target) },
    actor,
  });
  exec("UPDATE intel_queries SET run_id = ?, round = 1, state = 'collecting' WHERE id = ?", runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.query_created', subjectType: 'intelQuery', subjectId: id, payload: { criteria: c, targetCount: target, rules: activeRules, constraints: cons } });
  return getIntelQuery(id);
}

export function getIntelQuery(id) {
  const iq = one('SELECT * FROM intel_queries WHERE id = ?', id);
  if (!iq) return null;
  const records = q('SELECT * FROM intel_records WHERE query_id = ? ORDER BY completeness DESC, confidence DESC, id', id)
    .map(hydrate);
  return {
    ...iq,
    criteria: iq.criteria ? JSON.parse(iq.criteria) : null,
    rules: iq.rules ? JSON.parse(iq.rules) : [],
    constraints: iq.constraints ? JSON.parse(iq.constraints) : null,
    stats: iq.stats ? JSON.parse(iq.stats) : null,
    records,
    progress: {
      collected: records.length,
      target: iq.target_count,
      enriched: records.filter((r) => r.enrichment === 'enriched').length,
      pending: records.filter((r) => r.enrichment === 'pending').length,
      people: records.reduce((a, r) => a + r.contacts.filter((c) => c.name).length, 0),
      rejected: records.filter((r) => r.rejected_reason).length,
      withEmail: records.filter((r) => r.email).length,
      withPhone: records.filter((r) => r.phone).length,
      withAddress: records.filter((r) => r.address).length,
      verified: records.filter((r) => r.verification === 'verified').length,
      avgCompleteness: records.length ? Math.round((records.reduce((a, r) => a + r.completeness, 0) / records.length) * 100) : 0,
    },
  };
}

function hydrate(r) {
  return {
    ...r,
    gaps: r.gaps ? JSON.parse(r.gaps) : [],
    rulesLog: r.rules_log ? JSON.parse(r.rules_log) : [],
    social: r.social ? JSON.parse(r.social) : null,
    contacts: q('SELECT * FROM intel_contacts WHERE record_id = ? ORDER BY confidence DESC LIMIT 10', r.id),
    evidence: q('SELECT field, value, method, source_url, confidence FROM intel_evidence WHERE record_id = ? ORDER BY id DESC LIMIT 20', r.id),
  };
}

export function listIntelQueries() {
  return q('SELECT id FROM intel_queries ORDER BY id DESC LIMIT 50').map((r) => getIntelQuery(r.id));
}

export function getIntelRecord(id) {
  const r = one('SELECT * FROM intel_records WHERE id = ?', id);
  return r ? hydrate(r) : null;
}

export function listIntelRecords({ country = null, sector = null, minCompleteness = null, hasContact = null, verified = null } = {}) {
  let sql = 'SELECT * FROM intel_records WHERE 1=1';
  const params = [];
  if (country) { sql += ' AND country LIKE ?'; params.push(`%${country}%`); }
  if (sector) { sql += ' AND sector LIKE ?'; params.push(`%${sector}%`); }
  if (minCompleteness !== null) { sql += ' AND completeness >= ?'; params.push(Number(minCompleteness)); }
  if (hasContact) sql += ' AND (email IS NOT NULL OR phone IS NOT NULL)';
  if (verified) sql += " AND verification = 'verified'";
  sql += ' ORDER BY completeness DESC, id DESC LIMIT 500';
  return q(sql, ...params).map(hydrate);
}

// ---------- record insertion (deduped) ----------
const norm = (s) => String(s || '').toLowerCase().replace(/\b(co|company|ltd|limited|llc|inc|corp|corporation|group|holding|est|establishment|the)\b/g, '').replace(/[^a-z0-9؀-ۿ]/g, '');

function insertCandidates(records, queryId) {
  const existing = q('SELECT name, domain FROM intel_records WHERE query_id = ?', queryId);
  const seenNames = new Set(existing.map((e) => norm(e.name)));
  const seenDomains = new Set(existing.filter((e) => e.domain).map((e) => e.domain.toLowerCase()));
  let added = 0;
  for (const r of records || []) {
    if (!r?.name) continue;
    const key = norm(r.name);
    const domain = r.domain ? String(r.domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase() : null;
    if (!key || seenNames.has(key)) continue;
    if (domain && seenDomains.has(domain)) continue;
    seenNames.add(key); if (domain) seenDomains.add(domain);
    exec(`INSERT INTO intel_records (query_id, name, name_ar, kind, sector, country, city, region, size_hint, profile, domain, website, source, confidence, enrichment)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
      queryId, String(r.name).slice(0, 200), r.nameAr || null, r.kind || 'company', r.sector || null,
      r.country || null, r.city || null, r.region || null, r.sizeHint || null, r.profile || null,
      domain, domain ? `https://${domain}` : null, 'model-knowledge',
      typeof r.confidence === 'number' ? r.confidence : null);
    const id = one('SELECT last_insert_rowid() AS id').id;
    if (r.profile) evidence(id, 'profile', r.profile, 'model-knowledge', null, r.confidence ?? null);
    if (domain) evidence(id, 'domain-hypothesis', domain, 'model-knowledge', null, r.confidence ?? null);
    refreshScore(id);
    added += 1;
  }
  return added;
}

// ---------- stage 2: web enrichment ----------
let enrichInFlight = false;

async function enrichPending() {
  if (enrichInFlight) return;
  const batch = q("SELECT * FROM intel_records WHERE enrichment = 'pending' ORDER BY id LIMIT ?", ENRICH_PER_TICK);
  if (!batch.length) return;
  enrichInFlight = true;
  try {
    for (const r of batch) {
      const target = r.website || r.domain;
      if (!target) {
        exec("UPDATE intel_records SET enrichment = 'no-domain', enriched_at = datetime('now') WHERE id = ?", r.id);
        refreshScore(r.id);
        continue;
      }
      let res;
      try { res = await enrichFromWeb(target); } catch { res = { ok: false, reason: 'error' }; }
      if (!res.ok) {
        exec("UPDATE intel_records SET enrichment = 'unreachable', enriched_at = datetime('now') WHERE id = ?", r.id);
        evidence(r.id, 'website', target, 'web-scrape', null, 0);
        refreshScore(r.id);
        continue;
      }
      const email = res.emails[0]?.value || null;
      const email2 = res.emails[1]?.value || null;
      const phone = res.phones[0]?.value || null;
      const phone2 = res.phones[1]?.value || null;
      exec(`UPDATE intel_records SET
              website = ?, domain = ?,
              email = COALESCE(?, email), email2 = COALESCE(?, email2),
              phone = COALESCE(?, phone), phone2 = COALESCE(?, phone2),
              whatsapp = COALESCE(?, whatsapp),
              address = COALESCE(?, address),
              linkedin = COALESCE(?, linkedin),
              social = ?,
              profile = COALESCE(profile, ?),
              source = 'web-scrape',
              enrichment = 'enriched', enriched_at = datetime('now')
            WHERE id = ?`,
        res.sourceUrl, res.domain, email, email2, phone, phone2,
        res.whatsapp?.value || null, res.address?.value || null,
        res.social.linkedin || null,
        Object.keys(res.social).length ? JSON.stringify(res.social) : null,
        res.profile?.value || null, r.id);

      for (const e of res.emails) {
        evidence(r.id, 'email', e.value, 'web-scrape', e.sourceUrl, e.confidence);
        exec('INSERT OR IGNORE INTO intel_contacts (record_id, email, method, source_url, confidence) VALUES (?,?,?,?,?)',
          r.id, e.value, 'web-scrape', e.sourceUrl, e.confidence);
      }
      for (const p of res.phones) {
        evidence(r.id, 'phone', p.value, 'web-scrape', p.sourceUrl, p.confidence);
        exec('INSERT OR IGNORE INTO intel_contacts (record_id, phone, method, source_url, confidence) VALUES (?,?,?,?,?)',
          r.id, p.value, 'web-scrape', p.sourceUrl, p.confidence);
      }
      if (res.address) evidence(r.id, 'address', res.address.value, 'web-scrape', res.address.sourceUrl, 0.7);
      if (res.whatsapp) evidence(r.id, 'whatsapp', res.whatsapp.value, 'web-scrape', res.whatsapp.sourceUrl, 0.8);
      for (const [k, v] of Object.entries(res.social)) evidence(r.id, `social:${k}`, v, 'web-scrape', res.sourceUrl, 0.8);
      refreshScore(r.id);
      audit({ actorType: 'system', actorId: 'system:intel', action: 'intel.record_enriched', subjectType: 'intelRecord', subjectId: r.id, payload: { domain: res.domain, emails: res.emails.length, phones: res.phones.length, pages: res.pages.length } });
    }
  } finally { enrichInFlight = false; }
}

// ---------- stage 2b: rule-driven escalation ----------
let rulesInFlight = false;

// The table's UNIQUE index cannot dedupe these rows: SQLite treats every NULL
// as distinct, so two sightings of the same person with no email yet would
// both insert. Match explicitly instead — by name, or by any shared channel.
function addContact({ recordId, name = null, role = null, email = null, phone = null, method, sourceUrl = null, confidence = null, note = null }) {
  if (!name && !email && !phone) return false;
  const existing = name
    ? one('SELECT * FROM intel_contacts WHERE record_id = ? AND name IS NOT NULL AND lower(trim(name)) = lower(trim(?))', recordId, name)
    : one('SELECT * FROM intel_contacts WHERE record_id = ? AND ((email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?))', recordId, email, phone);
  if (existing) {
    // Fill blanks from the new sighting; a web-scraped fact outranks a guess.
    const better = existing.method !== 'web-scrape' && method === 'web-scrape';
    exec(`UPDATE intel_contacts SET role = COALESCE(role, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?),
          method = CASE WHEN ? THEN ? ELSE method END,
          source_url = COALESCE(source_url, ?), confidence = MAX(COALESCE(confidence,0), COALESCE(?,0))
          WHERE id = ?`,
      role, email, phone, better ? 1 : 0, method, sourceUrl, confidence, existing.id);
    return false;
  }
  exec('INSERT INTO intel_contacts (record_id, name, role, email, phone, method, source_url, confidence, note) VALUES (?,?,?,?,?,?,?,?,?)',
    recordId, name, role, email, phone, method, sourceUrl, confidence, note);
  return true;
}

const logRule = (r, line) => {
  const log = r.rules_log ? JSON.parse(r.rules_log) : [];
  log.push(line);
  exec('UPDATE intel_records SET rules_log = ? WHERE id = ?', JSON.stringify(log.slice(-12)), r.id);
};

/** Run the campaign's web-based rules for records that finished harvesting. */
async function applyRulesPass() {
  if (rulesInFlight) return;
  const batch = q(`SELECT r.*, iq.rules AS q_rules FROM intel_records r JOIN intel_queries iq ON iq.id = r.query_id
                   WHERE r.rules_state = 'pending' AND r.enrichment != 'pending' ORDER BY r.id LIMIT 2`);
  if (!batch.length) return;
  rulesInFlight = true;
  try {
    for (const r of batch) {
      const rules = r.q_rules ? JSON.parse(r.q_rules) : [];
      if (!rules.length) { exec("UPDATE intel_records SET rules_state = 'done' WHERE id = ?", r.id); continue; }
      const target = r.website || r.domain;
      const peopleCount = one('SELECT COUNT(*) AS n FROM intel_contacts WHERE record_id = ? AND name IS NOT NULL', r.id).n;
      const wanted = new Set(rules.filter((id) => conditionHolds(RULE_BY_ID[id].when, r, peopleCount)).map((id) => RULE_BY_ID[id].action));
      // A crawl is expensive and deterministic: never repeat one on the same
      // record when the rules re-run after the agent's people pass.
      const alreadyDone = new Set((r.rules_log ? JSON.parse(r.rules_log) : []).map((l) => String(l).split(':')[0]));
      for (const a of ['find-people', 'deep-crawl']) if (alreadyDone.has(a)) wanted.delete(a);

      // 1. People discovery on the organization's own site.
      if (wanted.has('find-people') && target) {
        const res = await discoverPeople(target).catch(() => ({ ok: false, people: [] }));
        let added = 0;
        for (const p of res.people || []) {
          // Names come off the page verbatim, but a leadership grid flattens
          // to "Name Role Name Role" — so a title can land on its neighbour.
          // The person is evidence; the title is a lead to confirm.
          const note = p.role && !p.email && !p.phone
            ? 'name read from the leadership page — confirm the exact title before using it'
            : null;
          if (addContact({ recordId: r.id, name: p.name, role: p.role, email: p.email, phone: p.phone, method: 'web-scrape', sourceUrl: p.sourceUrl, confidence: p.email || p.phone ? 0.8 : 0.5, note })) added += 1;
          if (p.email) evidence(r.id, 'person-email', `${p.name}: ${p.email}`, 'web-scrape', p.sourceUrl, 0.8);
          if (p.phone) evidence(r.id, 'person-phone', `${p.name}: ${p.phone}`, 'web-scrape', p.sourceUrl, 0.8);
        }
        logRule(r, `find-people: ${added} people from ${(res.pages || []).length} page(s)`);
        // A manager's direct line becomes the record's phone when it has none.
        const direct = (res.people || []).find((p) => p.phone);
        if (!r.phone && direct) {
          exec('UPDATE intel_records SET phone = ? WHERE id = ?', direct.phone, r.id);
          evidence(r.id, 'phone', direct.phone, 'web-scrape', direct.sourceUrl, 0.75);
          logRule(r, `phone taken from ${direct.name}${direct.role ? ` (${direct.role})` : ''}`);
        }
        const directMail = (res.people || []).find((p) => p.email);
        if (!r.email && directMail) {
          exec('UPDATE intel_records SET email = ? WHERE id = ?', directMail.email, r.id);
          evidence(r.id, 'email', directMail.email, 'web-scrape', directMail.sourceUrl, 0.75);
        }
      }

      // 2. Deeper sweep for an address or a number hiding on a secondary page.
      if (wanted.has('deep-crawl') && target) {
        const res = await deepCrawl(target).catch(() => ({ ok: false }));
        if (res.address && !r.address) {
          exec('UPDATE intel_records SET address = ? WHERE id = ?', res.address.value, r.id);
          evidence(r.id, 'address', res.address.value, 'web-scrape', res.address.sourceUrl, 0.65);
        }
        const extra = (res.phones || [])[0];
        if (extra && !one('SELECT phone FROM intel_records WHERE id = ? AND phone IS NOT NULL', r.id)) {
          exec('UPDATE intel_records SET phone = ? WHERE id = ?', extra.value, r.id);
          evidence(r.id, 'phone', extra.value, 'web-scrape', extra.sourceUrl, extra.confidence);
        }
        logRule(r, `deep-crawl: ${(res.pages || []).length} extra page(s)${res.address ? ', address found' : ''}`);
      }

      // 3. Learn the house email pattern from confirmed addresses.
      const knownEmails = q("SELECT value FROM intel_evidence WHERE record_id = ? AND field IN ('email','person-email') AND method = 'web-scrape'", r.id)
        .map((e) => String(e.value).split(': ').pop());
      const pat = inferEmailPattern(knownEmails, r.domain);
      if (pat) exec('UPDATE intel_records SET email_pattern = ? WHERE id = ?', `${pat.pattern} (e.g. ${pat.sample})`, r.id);

      // 4. Derive candidate addresses for people we know by name only.
      if (wanted.has('derive-emails') && pat && r.domain) {
        let derived = 0;
        for (const c of q('SELECT * FROM intel_contacts WHERE record_id = ? AND name IS NOT NULL AND email IS NULL', r.id)) {
          const guess = applyEmailPattern(c.name, pat.pattern, r.domain);
          if (!guess) continue;
          exec("UPDATE intel_contacts SET email = ?, method = 'pattern-derived', confidence = 0.35, note = ? WHERE id = ?",
            guess, `derived from the ${pat.pattern} pattern seen at ${pat.sample} — unverified hypothesis`, c.id);
          evidence(r.id, 'person-email-derived', `${c.name}: ${guess}`, 'pattern-derived', null, 0.35);
          derived += 1;
        }
        if (derived) logRule(r, `derive-emails: ${derived} candidate address(es) from the ${pat.pattern} pattern`);
      }

      // 5. Nothing on the site — hand the question to the agent (batched later).
      const stillNoPeople = one('SELECT COUNT(*) AS n FROM intel_contacts WHERE record_id = ? AND name IS NOT NULL', r.id).n === 0;
      if (wanted.has('ask-people') || (rules.includes('ask-executives') && stillNoPeople)) {
        exec("UPDATE intel_records SET rules_state = 'awaiting-agent' WHERE id = ?", r.id);
      } else {
        exec("UPDATE intel_records SET rules_state = 'done' WHERE id = ?", r.id);
      }
      refreshScore(r.id);
    }
  } finally { rulesInFlight = false; }
}

/** Batch the "who runs this company?" question for a campaign's stuck records. */
function launchPeopleAsk(iq) {
  const stuck = q("SELECT * FROM intel_records WHERE query_id = ? AND rules_state = 'awaiting-agent' LIMIT 10", iq.id);
  if (!stuck.length) return false;
  const list = stuck.map((r) => `#${r.id} ${r.name}${r.city || r.country ? ` — ${[r.city, r.country].filter(Boolean).join(', ')}` : ''}${r.domain ? ` — ${r.domain}` : ''}`).join('\n');
  const runId = enqueueRun({
    agentId: 'AGT-INT-001',
    taskType: `intelpeople:${iq.id}`,
    input: {
      prompt: `We could not find any named contacts on these organizations' websites. For EACH one, list the senior people most likely to be the right point of contact (managing director, general manager, commercial/procurement head, founder).

Give ONLY names and roles that you actually associate with the organization. NEVER invent an email address or phone number — leave them out entirely; the platform derives or verifies contact details separately. If you do not know who runs an organization, return an empty people array for it rather than guessing a name.

${list}

Output JSON exactly: {"orgs":[{"id":0,"people":[{"name":"","role":"","note":""}]}],"summary":""} — id must match the #numbers above.`,
    },
    actor: 'system:intel',
  });
  exec("UPDATE intel_queries SET state = 'people-ask', run_id = ? WHERE id = ?", runId, iq.id);
  return true;
}

/** Manual re-enrichment (also used after a human corrects the website). */
export function reEnrichRecord(id, { website = null, actor }) {
  const r = one('SELECT * FROM intel_records WHERE id = ?', id);
  if (!r) throw new Error('record not found');
  if (website) {
    const domain = String(website).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
    exec('UPDATE intel_records SET website = ?, domain = ? WHERE id = ?', `https://${domain}`, domain, id);
    evidence(id, 'website', domain, 'human', null, 1);
  }
  exec("UPDATE intel_records SET enrichment = 'pending' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.reenrich_requested', subjectType: 'intelRecord', subjectId: id });
  return { ok: true };
}

// ---------- stage 3/4: gap-fill and expansion ----------
function launchGapfill(iq) {
  const weak = q(`SELECT * FROM intel_records WHERE query_id = ? AND gapfill_tries < 2
                  AND (domain IS NULL OR enrichment IN ('no-domain','unreachable') OR (email IS NULL AND phone IS NULL))
                  ORDER BY id LIMIT 12`, iq.id);
  if (!weak.length) return false;
  const list = weak.map((r) => `#${r.id} ${r.name}${r.name_ar ? ` (${r.name_ar})` : ''} — ${r.city || ''} ${r.country || ''} — current domain guess: ${r.domain || 'NONE'} (${r.enrichment})`).join('\n');
  const runId = enqueueRun({
    agentId: 'AGT-INT-001',
    taskType: `intelgap:${iq.id}`,
    input: {
      prompt: `These organizations could not be reached at the domain we tried, or we have no domain at all.
For EACH one, give the most likely OFFICIAL website domain (bare domain). Consider country TLDs (.iq, .sa, .ae, .com.iq), parent-company sites, and ministry/registry pages for state entities.
If a company genuinely has no website, say so with domain: null and put where its contact details are normally published (registry, chamber of commerce, LinkedIn) in "note".

${list}

Output JSON exactly: {"fixes":[{"id":0,"domain":null,"linkedin":null,"note":""}],"summary":""} — id must match the #numbers above.`,
    },
    actor: 'system:intel',
  });
  exec('UPDATE intel_records SET gapfill_tries = gapfill_tries + 1 WHERE id IN (' + weak.map(() => '?').join(',') + ')', ...weak.map((r) => r.id));
  exec("UPDATE intel_queries SET state = 'gapfill', run_id = ? WHERE id = ?", runId, iq.id);
  return true;
}

function launchExpansion(iq) {
  if (iq.round >= MAX_ROUNDS) return false;
  const names = q('SELECT name FROM intel_records WHERE query_id = ?', iq.id).map((r) => r.name);
  const remaining = iq.target_count - names.length;
  if (remaining <= 0) return false;
  const runId = enqueueRun({
    agentId: 'AGT-INT-001',
    taskType: `intel:${iq.id}:r${iq.round + 1}`,
    input: { prompt: briefFor(iq.criteria ? JSON.parse(iq.criteria) : null, iq.question, remaining, names) },
    actor: 'system:intel',
  });
  exec("UPDATE intel_queries SET state = 'collecting', round = round + 1, run_id = ? WHERE id = ?", runId, iq.id);
  return true;
}

function finish(iq) {
  // Hard constraints decide what counts as a result. Failures are marked and
  // explained, never silently dropped — you can always see what was excluded.
  const cons = iq.constraints ? JSON.parse(iq.constraints) : null;
  if (cons) {
    for (const r of q('SELECT * FROM intel_records WHERE query_id = ?', iq.id)) {
      const reason = checkConstraints(r, cons);
      exec("UPDATE intel_records SET rejected_reason = ?, state = CASE WHEN ? IS NULL THEN (CASE WHEN state = 'rejected' THEN 'new' ELSE state END) ELSE 'rejected' END WHERE id = ?",
        reason, reason, r.id);
    }
  }
  const recs = q('SELECT * FROM intel_records WHERE query_id = ?', iq.id);
  const passing = recs.filter((r) => !r.rejected_reason);
  const stats = {
    collected: recs.length, target: iq.target_count, rounds: iq.round,
    passing: passing.length,
    rejected: recs.length - passing.length,
    peopleFound: one('SELECT COUNT(*) AS n FROM intel_contacts c JOIN intel_records r ON r.id = c.record_id WHERE r.query_id = ? AND c.name IS NOT NULL', iq.id).n,
    withEmail: recs.filter((r) => r.email).length,
    withPhone: recs.filter((r) => r.phone).length,
    withAddress: recs.filter((r) => r.address).length,
    webConfirmed: recs.filter((r) => r.enrichment === 'enriched').length,
    unreachable: recs.filter((r) => ['unreachable', 'no-domain'].includes(r.enrichment)).length,
    avgCompleteness: recs.length ? Math.round((recs.reduce((a, r) => a + r.completeness, 0) / recs.length) * 100) : 0,
  };
  exec("UPDATE intel_queries SET state = 'ready', stats = ?, run_id = NULL WHERE id = ?", JSON.stringify(stats), iq.id);
  archiveItem({
    title: `Intel campaign #${iq.id}: ${iq.question.slice(0, 70)} — ${stats.collected} records`,
    kind: 'intel-export', subjectType: 'intelQuery', subjectId: iq.id, snapshot: stats, actor: 'system:intel',
  });
  notify({
    level: stats.withEmail || stats.withPhone ? 'info' : 'warn',
    source: 'intel',
    message: `Intel #${iq.id} ready — ${stats.collected} records over ${stats.rounds} round(s): ${stats.withEmail} with email, ${stats.withPhone} with phone, ${stats.peopleFound} named people, ${stats.webConfirmed} web-confirmed, ${stats.unreachable} unreachable${stats.rejected ? `, ${stats.rejected} rejected by constraints` : ''}. Avg completeness ${stats.avgCompleteness}%.`,
    subjectType: 'intelQuery', subjectId: iq.id,
  });
  audit({ actorType: 'system', actorId: 'system:intel', action: 'intel.campaign_finished', subjectType: 'intelQuery', subjectId: iq.id, payload: stats });
}

// ---------- the tick: drives every campaign through its stages ----------
export function syncIntel() {
  for (const iq of q("SELECT * FROM intel_queries WHERE state IN ('collecting','gapfill','people-ask')")) {
    if (!iq.run_id) { exec("UPDATE intel_queries SET state = 'enriching' WHERE id = ?", iq.id); continue; }
    const run = one('SELECT * FROM runs WHERE id = ?', iq.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;

    if (iq.state === 'people-ask') {
      for (const org of parsed?.orgs || []) {
        const rec = one('SELECT * FROM intel_records WHERE id = ? AND query_id = ?', Number(org.id), iq.id);
        if (!rec) continue;
        let n = 0;
        for (const p of org.people || []) {
          if (!p?.name) continue;
          // Names and roles only — the agent is never a source of contact details.
          if (addContact({ recordId: rec.id, name: String(p.name).slice(0, 120), role: p.role || null, method: 'model-knowledge', confidence: 0.4, note: p.note || 'named by the agent — contact details unconfirmed' })) n += 1;
          evidence(rec.id, 'person', `${p.name}${p.role ? ` — ${p.role}` : ''}`, 'model-knowledge', null, 0.4);
        }
        logRule(rec, `ask-people: ${n} name(s) proposed by the agent`);
        // Named people can now inherit the house email pattern.
        exec("UPDATE intel_records SET rules_state = CASE WHEN ? > 0 THEN 'pending' ELSE 'done' END WHERE id = ?", n, rec.id);
      }
      exec("UPDATE intel_records SET rules_state = 'done' WHERE query_id = ? AND rules_state = 'awaiting-agent'", iq.id);
      exec("UPDATE intel_queries SET state = 'enriching', run_id = NULL WHERE id = ?", iq.id);
      continue;
    }

    if (iq.state === 'collecting') {
      const added = parsed?.records ? insertCandidates(parsed.records, iq.id) : 0;
      exec("UPDATE intel_queries SET state = 'enriching', run_id = NULL, summary = COALESCE(?, summary), dry_rounds = ? WHERE id = ?",
        parsed?.summary || null, added ? 0 : iq.dry_rounds + 1, iq.id);
      audit({ actorType: 'system', actorId: 'system:intel', action: 'intel.round_collected', subjectType: 'intelQuery', subjectId: iq.id, payload: { round: iq.round, added } });
    } else {
      for (const f of parsed?.fixes || []) {
        const rec = one('SELECT * FROM intel_records WHERE id = ? AND query_id = ?', Number(f.id), iq.id);
        if (!rec) continue;
        const domain = f.domain ? String(f.domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase() : null;
        if (domain && domain !== rec.domain) {
          exec("UPDATE intel_records SET domain = ?, website = ?, enrichment = 'pending' WHERE id = ?", domain, `https://${domain}`, rec.id);
          evidence(rec.id, 'domain-hypothesis', domain, 'model-knowledge', null, 0.5);
        } else {
          exec("UPDATE intel_records SET enrichment = CASE WHEN enrichment = 'pending' THEN 'no-domain' ELSE enrichment END WHERE id = ?", rec.id);
        }
        if (f.linkedin) { exec('UPDATE intel_records SET linkedin = COALESCE(linkedin, ?) WHERE id = ?', f.linkedin, rec.id); evidence(rec.id, 'linkedin', f.linkedin, 'model-knowledge', null, 0.4); }
        if (f.note) evidence(rec.id, 'note', f.note, 'model-knowledge', null, null);
        refreshScore(rec.id);
      }
      exec("UPDATE intel_queries SET state = 'enriching', run_id = NULL WHERE id = ?", iq.id);
    }
  }

  // Enrichment stage — async, bounded, fire-and-forget per tick.
  const enriching = q("SELECT * FROM intel_queries WHERE state = 'enriching'");
  if (enriching.length) {
    const pending = one("SELECT COUNT(*) AS n FROM intel_records WHERE enrichment = 'pending'").n;
    if (pending) { enrichPending().catch(() => {}); return; }
    // Rules run after the base harvest, before the campaign decides it is done.
    const rulesPending = one("SELECT COUNT(*) AS n FROM intel_records WHERE rules_state = 'pending'").n;
    if (rulesPending) { applyRulesPass().catch(() => {}); return; }
    for (const iq of enriching) {
      if (launchPeopleAsk(iq)) continue;
      if (launchGapfill(iq)) continue;
      const count = one('SELECT COUNT(*) AS n FROM intel_records WHERE query_id = ?', iq.id).n;
      if (count < iq.target_count && iq.dry_rounds < 2 && launchExpansion(iq)) continue;
      finish(iq);
    }
  }
}

// ---------- human actions ----------
/** Re-run the campaign's rules for one record (after a fix, or on demand). */
export function rerunRules(id, actor) {
  if (!one('SELECT id FROM intel_records WHERE id = ?', id)) throw new Error('record not found');
  exec("UPDATE intel_records SET rules_state = 'pending' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.rules_rerun', subjectType: 'intelRecord', subjectId: id });
  return { ok: true };
}

/** A human confirms one contact person — the highest-trust signal there is. */
export function verifyContact(contactId, { verification = 'verified', actor }) {
  const c = one('SELECT * FROM intel_contacts WHERE id = ?', contactId);
  if (!c) throw new Error('contact not found');
  exec('UPDATE intel_contacts SET verification = ? WHERE id = ?', verification, contactId);
  if (verification === 'verified') {
    const r = one('SELECT * FROM intel_records WHERE id = ?', c.record_id);
    if (r && !r.phone && c.phone) exec('UPDATE intel_records SET phone = ? WHERE id = ?', c.phone, r.id);
    if (r && !r.email && c.email) exec('UPDATE intel_records SET email = ? WHERE id = ?', c.email, r.id);
    refreshScore(c.record_id);
  }
  audit({ actorType: 'human', actorId: actor, action: `intel.contact_${verification}`, subjectType: 'intelRecord', subjectId: c.record_id, payload: { contactId, name: c.name } });
  return { ok: true };
}

export function verifyIntelRecord(id, actor) {
  const r = one('SELECT * FROM intel_records WHERE id = ?', id);
  if (!r) throw new Error('record not found');
  exec("UPDATE intel_records SET verification = 'verified' WHERE id = ?", id);
  exec("UPDATE intel_contacts SET verification = 'verified' WHERE record_id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.record_verified', subjectType: 'intelRecord', subjectId: id, payload: { name: r.name, completeness: r.completeness } });
}

/** Human correction — the highest-trust source; overrides scraped values. */
export function editIntelRecord(id, { email = null, phone = null, address = null, website = null, linkedin = null, notes = null, actor }) {
  const r = one('SELECT * FROM intel_records WHERE id = ?', id);
  if (!r) throw new Error('record not found');
  exec(`UPDATE intel_records SET email = COALESCE(?, email), phone = COALESCE(?, phone),
        address = COALESCE(?, address), website = COALESCE(?, website), linkedin = COALESCE(?, linkedin) WHERE id = ?`,
    email, phone, address, website, linkedin, id);
  for (const [f, v] of Object.entries({ email, phone, address, website, linkedin, note: notes })) {
    if (v) evidence(id, f, v, 'human', null, 1);
  }
  refreshScore(id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.record_edited', subjectType: 'intelRecord', subjectId: id, payload: { fields: Object.entries({ email, phone, address, website, linkedin }).filter(([, v]) => v).map(([k]) => k) } });
  return getIntelRecord(id);
}

/** Targeting: record → CRM lead, with the full contact block and provenance. */
export function targetIntelRecord(id, { productId = null, actor }) {
  const r = getIntelRecord(id);
  if (!r) throw new Error('record not found');
  if (r.customer_id) throw new Error(`already targeted → customer #${r.customer_id}`);
  const customer = createCustomer({
    name: r.name, company: r.name_ar ? `${r.name} / ${r.name_ar}` : r.name,
    state: 'lead', productId, actor,
  });
  const contactBlock = [
    `From intel record #${r.id} (campaign #${r.query_id}) · completeness ${Math.round(r.completeness * 100)}% · ${r.verification}`,
    r.profile ? `Profile: ${r.profile}` : null,
    `Email: ${r.email || '— gap'}${r.email2 ? ` / ${r.email2}` : ''}`,
    `Phone: ${r.phone || '— gap'}${r.phone2 ? ` / ${r.phone2}` : ''}${r.whatsapp ? ` · WhatsApp ${r.whatsapp}` : ''}`,
    `Address: ${r.address || '— gap'}`,
    `Web: ${r.website || '— gap'}${r.linkedin ? ` · ${r.linkedin}` : ''}`,
    `Location: ${[r.city, r.region, r.country].filter(Boolean).join(', ') || '—'}`,
    `Sources: ${[...new Set(r.evidence.filter((e) => e.source_url).map((e) => e.source_url))].slice(0, 3).join(' · ') || 'model knowledge only'}`,
  ].filter(Boolean).join('\n');
  exec('UPDATE customers SET notes = ? WHERE id = ?', contactBlock.slice(0, 1500), customer.id);
  exec("UPDATE intel_records SET state = 'targeted', customer_id = ? WHERE id = ?", customer.id, id);
  audit({ actorType: 'human', actorId: actor, action: 'intel.record_targeted', subjectType: 'intelRecord', subjectId: id, payload: { customerId: customer.id, name: r.name } });
  return { record: getIntelRecord(id), customer };
}

/** Bulk targeting — everything verified in a campaign or segment, in one act. */
export function bulkTarget({ queryId = null, segmentId = null, minCompleteness = 0, verifiedOnly = true, productId = null, actor }) {
  let rows;
  if (segmentId) rows = q('SELECT r.* FROM intel_records r JOIN segment_members m ON m.record_id = r.id WHERE m.segment_id = ? AND r.customer_id IS NULL', segmentId);
  else if (queryId) rows = q('SELECT * FROM intel_records WHERE query_id = ? AND customer_id IS NULL', queryId);
  else throw new Error('queryId or segmentId required');
  const picked = rows.filter((r) => r.completeness >= Number(minCompleteness) && (!verifiedOnly || r.verification === 'verified'));
  const created = [];
  for (const r of picked) {
    try { created.push(targetIntelRecord(r.id, { productId, actor }).customer.id); } catch { /* skip */ }
  }
  audit({ actorType: 'human', actorId: actor, action: 'intel.bulk_targeted', subjectType: queryId ? 'intelQuery' : 'segment', subjectId: queryId || segmentId, payload: { count: created.length } });
  return { targeted: created.length, skipped: rows.length - created.length };
}

// ---------- export ----------
// Two formats, both Excel-safe:
//   csv  — UTF-8 with BOM so Excel renders Arabic correctly, plus a `sep=`
//          hint so locales whose list separator is ';' still split columns.
//   xls  — SpreadsheetML 2003: real typed cells, real column widths, no
//          separator or encoding ambiguity at all. Opens natively in Excel,
//          LibreOffice, and Google Sheets.
const EXPORT_COLS = [
  ['Name', (r) => r.name], ['الاسم', (r) => r.name_ar], ['Kind', (r) => r.kind],
  ['Sector | القطاع', (r) => r.sector], ['Country | الدولة', (r) => r.country],
  ['City | المدينة', (r) => r.city], ['Region', (r) => r.region],
  ['Email | البريد', (r) => r.email], ['Email 2', (r) => r.email2],
  ['Phone | الهاتف', (r) => r.phone], ['Phone 2', (r) => r.phone2], ['WhatsApp', (r) => r.whatsapp],
  ['Address | العنوان', (r) => r.address],
  ['Website | الموقع', (r) => r.website], ['LinkedIn', (r) => r.linkedin],
  ['Social', (r) => { try { return Object.values(JSON.parse(r.social || '{}')).join(' | '); } catch { return ''; } }],
  ['Profile | نبذة', (r) => r.profile], ['Size', (r) => r.size_hint],
  ['Completeness %', (r) => Math.round((r.completeness || 0) * 100), 'number'],
  ['Gaps | النواقص', (r) => { try { return (JSON.parse(r.gaps || '[]')).join(' '); } catch { return ''; } }],
  ['Contacts | جهات الاتصال', (r) => q('SELECT name, role, email, phone, method, verification FROM intel_contacts WHERE record_id = ? AND name IS NOT NULL ORDER BY confidence DESC LIMIT 6', r.id)
    .map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}${c.email ? ` <${c.email}${c.method === 'pattern-derived' ? ' ?derived' : ''}>` : ''}${c.phone ? ` ☎ ${c.phone}` : ''}`).join(' ; ')],
  ['Email pattern', (r) => r.email_pattern],
  ['Rejected because', (r) => r.rejected_reason],
  ['Source method', (r) => r.source], ['Enrichment', (r) => r.enrichment],
  ['Source URLs', (r) => [...new Set(q('SELECT source_url FROM intel_evidence WHERE record_id = ? AND source_url IS NOT NULL', r.id).map((e) => e.source_url))].slice(0, 3).join(' | ')],
  ['Confidence', (r) => r.confidence, 'number'], ['Verification', (r) => r.verification], ['State', (r) => r.state],
];

const xmlEsc = (v) => String(v ?? '')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildXls(records, sheetName) {
  const widths = [180, 150, 70, 130, 90, 90, 90, 170, 150, 120, 120, 110, 220, 180, 160, 160, 320, 80, 90, 160, 340, 130, 160, 100, 100, 240, 80, 90, 80];
  const headRow = `<Row ss:StyleID="hdr">${EXPORT_COLS.map(([h]) => `<Cell><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join('')}</Row>`;
  const rows = records.map((r) => `<Row>${EXPORT_COLS.map(([, f, type]) => {
    const v = f(r);
    if (v === null || v === undefined || v === '') return '<Cell/>';
    if (type === 'number' && !Number.isNaN(Number(v))) return `<Cell><Data ss:Type="Number">${Number(v)}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  }).join('')}</Row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>
  <Style ss:ID="hdr"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/><Interior ss:Color="#F2E6DA" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEsc(sheetName).slice(0, 28)}">
  <Table>
${EXPORT_COLS.map((_, i) => `   <Column ss:Width="${widths[i] || 120}"/>`).join('\n')}
   ${headRow}
   ${rows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

export function exportIntelCsv({ queryId = null, segmentId = null, format = 'csv', actor }) {
  let records, label;
  if (segmentId) {
    records = q('SELECT r.* FROM intel_records r JOIN segment_members m ON m.record_id = r.id WHERE m.segment_id = ? ORDER BY r.completeness DESC', segmentId);
    label = `segment-${segmentId}`;
  } else if (queryId) {
    records = q('SELECT * FROM intel_records WHERE query_id = ? ORDER BY completeness DESC', queryId);
    label = `query-${queryId}`;
  } else {
    records = q('SELECT * FROM intel_records ORDER BY completeness DESC');
    label = 'all';
  }

  const xls = String(format).toLowerCase() === 'xls' || String(format).toLowerCase() === 'excel';
  let body, ext, mime;
  if (xls) {
    body = buildXls(records, `Intel ${label}`);
    ext = 'xls';
    mime = 'application/vnd.ms-excel; charset=utf-8';
  } else {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    body = '﻿' + 'sep=,\r\n'
      + EXPORT_COLS.map(([h]) => cell(h)).join(',') + '\r\n'
      + records.map((r) => EXPORT_COLS.map(([, f]) => cell(f(r))).join(',')).join('\r\n');
    ext = 'csv';
    mime = 'text/csv; charset=utf-8';
  }

  fs.mkdirSync(INTEL_DIR, { recursive: true });
  const file = `intel-${label}-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(INTEL_DIR, file), body, 'utf8');
  archiveItem({
    title: `Intel export (${label}, ${ext.toUpperCase()}) — ${records.length} records`, kind: 'intel-export',
    subjectType: segmentId ? 'segment' : 'intelQuery', subjectId: segmentId || queryId || 'all',
    snapshot: { count: records.length, format: ext, withEmail: records.filter((r) => r.email).length, withPhone: records.filter((r) => r.phone).length },
    fileRef: `_intel/${file}`, actor,
  });
  audit({ actorType: 'human', actorId: actor, action: 'intel.exported', subjectType: 'artifact', subjectId: `_intel/${file}`, payload: { count: records.length, format: ext } });
  return { body, filename: file, mime, count: records.length };
}

/** Division dashboard. */
export function intelOverview() {
  return {
    campaigns: one('SELECT COUNT(*) AS n FROM intel_queries').n,
    running: one("SELECT COUNT(*) AS n FROM intel_queries WHERE state IN ('collecting','enriching','gapfill')").n,
    records: one('SELECT COUNT(*) AS n FROM intel_records').n,
    withEmail: one('SELECT COUNT(*) AS n FROM intel_records WHERE email IS NOT NULL').n,
    withPhone: one('SELECT COUNT(*) AS n FROM intel_records WHERE phone IS NOT NULL').n,
    webConfirmed: one("SELECT COUNT(*) AS n FROM intel_records WHERE enrichment = 'enriched'").n,
    verified: one("SELECT COUNT(*) AS n FROM intel_records WHERE verification = 'verified'").n,
    targeted: one("SELECT COUNT(*) AS n FROM intel_records WHERE state = 'targeted'").n,
    avgCompleteness: Math.round((one('SELECT AVG(completeness) AS a FROM intel_records')?.a || 0) * 100),
    contacts: one('SELECT COUNT(*) AS n FROM intel_contacts').n,
    people: one('SELECT COUNT(*) AS n FROM intel_contacts WHERE name IS NOT NULL').n,
    peopleWithDirect: one('SELECT COUNT(*) AS n FROM intel_contacts WHERE name IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)').n,
    byCountry: q("SELECT country, COUNT(*) AS n FROM intel_records WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 8"),
    bySector: q("SELECT sector, COUNT(*) AS n FROM intel_records WHERE sector IS NOT NULL GROUP BY sector ORDER BY n DESC LIMIT 8"),
  };
}
