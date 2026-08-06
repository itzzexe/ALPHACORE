// Web enrichment — the only place in the platform that reads the live public
// web. It fetches a company's OWN website (home + the usual contact/about
// pages) and extracts contact facts from the HTML: emails, phones, address,
// social profiles. Every extracted value carries the exact URL it came from,
// so a record's contact block is auditable back to its source page.
//
// This is what makes intel records real rather than recalled: the model may
// PROPOSE a company and a likely domain, but a phone number only becomes a
// fact here, with a source URL — otherwise it stays an explicit gap.
//
// Safety: outbound requests are sandboxed — https/http only, public hosts
// only (no localhost/private ranges/metadata IPs), 8s timeout, 1.5 MB cap,
// bounded page count. Untrusted HTML is never executed, only pattern-scanned.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'CrucibleCore/0.4 (+intelligence enrichment; contact discovery)';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_PAGES = 5;

const CONTACT_PATHS = [
  '', '/contact', '/contact-us', '/contactus', '/about', '/about-us',
  '/ar/contact', '/contact.html', '/en/contact', '/impressum', '/support',
];

// Escalation paths — only crawled when a campaign rule asks for them.
const PEOPLE_PATHS = [
  '/team', '/our-team', '/about/team', '/leadership', '/management',
  '/about-us/management', '/staff', '/people', '/board', '/who-we-are',
  '/ar/team', '/en/team', '/company/leadership', '/executive-team',
];
const DEEP_PATHS = [
  '/locations', '/branches', '/offices', '/find-us', '/ar/contact-us',
  '/imprint', '/legal', '/privacy', '/terms', '/footer', '/ar/about',
];

const BAD_EMAIL = /(\.(png|jpe?g|gif|svg|webp|css|js)$)|^(example|test|user|name|email|your|info@example|sentry|wixpress|godaddy|domain)/i;
const BAD_HOSTS = /^(localhost|.*\.local|.*\.internal)$/i;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
  }
  const low = ip.toLowerCase();
  return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

/** Only public http(s) hosts are reachable — blocks SSRF via agent-supplied URLs. */
async function assertPublicUrl(u) {
  const url = new URL(u);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol not allowed');
  if (url.port && !['80', '443', ''].includes(url.port)) throw new Error('port not allowed');
  if (BAD_HOSTS.test(url.hostname)) throw new Error('host not allowed');
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error('private address blocked');
    return url;
  }
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address blocked');
  return url;
}

async function fetchPage(u) {
  await assertPublicUrl(u);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en,ar' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html') && !type.includes('text')) return null;
    const buf = await res.arrayBuffer();
    const html = Buffer.from(buf.slice(0, MAX_BYTES)).toString('utf8');
    return { url: res.url || u, html };
  } catch { return null; } finally { clearTimeout(timer); }
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const stripTags = (html) => decode(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '));

/** Digits-aware phone normalizer; keeps the leading +. */
function normalizePhone(raw) {
  const s = decode(raw).replace(/[^\d+]/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (/^(\d)\1+$/.test(digits)) return null;            // 000000000
  if (/^(19|20)\d{6,}$/.test(digits) && !s.startsWith('+')) return null; // dates/ids
  return s.startsWith('+') ? s : digits;
}

function extractFromPage(page) {
  const { html, url } = page;
  const out = { emails: [], phones: [], addresses: [], social: {}, title: null, description: null, whatsapp: null };

  // mailto: / tel: links are the highest-signal source on any contact page.
  for (const m of html.matchAll(/mailto:([^"'>\s?]+)/gi)) out.emails.push(decode(m[1]).toLowerCase());
  for (const m of html.matchAll(/tel:([^"'>\s]+)/gi)) {
    const p = normalizePhone(m[1]);
    if (p) out.phones.push(p);
  }
  const text = stripTags(html);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.emails.push(m[0].toLowerCase());
  for (const m of text.matchAll(/(?:\+|00)\d[\d\s().-]{7,18}\d/g)) {
    const p = normalizePhone(m[0]);
    if (p) out.phones.push(p);
  }

  // WhatsApp click-to-chat links carry a real number.
  const wa = html.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\+?\d{8,15})/i);
  if (wa) out.whatsapp = normalizePhone(wa[1]);

  for (const [key, re] of Object.entries({
    linkedin: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[^"'\s<>]+/i,
    x: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s<>/]+/i,
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/[^"'\s<>]+/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^"'\s<>/]+/i,
    youtube: /https?:\/\/(?:www\.)?youtube\.com\/[^"'\s<>]+/i,
  })) {
    const m = html.match(re);
    if (m) out.social[key] = decode(m[0]).replace(/[),.]+$/, '');
  }

  const addrTag = html.match(/<address[^>]*>([\s\S]{5,400}?)<\/address>/i);
  if (addrTag) out.addresses.push(stripTags(addrTag[1]));
  for (const m of text.matchAll(/(?:P\.?O\.?\s*Box[^.|·]{3,80}|(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Building|Bldg|Tower|Floor|District|Block)[^.|·]{5,90})/gi)) {
    const a = decode(m[0]);
    if (a.length > 12) out.addresses.push(a);
  }

  const t = html.match(/<title[^>]*>([\s\S]{2,200}?)<\/title>/i);
  if (t) out.title = decode(t[1]);
  const d = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]{10,400}?)["']/i)
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]{10,400}?)["']/i);
  if (d) out.description = decode(d[1]);

  out.sourceUrl = url;
  return out;
}

const score = (email, domain) => {
  const local = email.split('@')[0];
  const host = email.split('@')[1] || '';
  let s = 0.5;
  if (domain && host.endsWith(domain.replace(/^www\./, ''))) s += 0.35;   // on the company's own domain
  if (/^(info|contact|sales|hello|enquir|inquir|office|support|admin|marketing|hr|careers)/i.test(local)) s += 0.1;
  if (/(noreply|no-reply|donotreply|webmaster|postmaster|abuse)/i.test(local)) s -= 0.35;
  return Math.max(0.1, Math.min(0.98, s));
};

// ---------- people discovery ----------
// When an organization publishes no switchboard number, the reachable path is
// usually a named person: a manager or department head whose details sit on a
// team, leadership, or contact page. This finds those people — and, as with
// everything else here, only records what the page actually says.
const ROLE_EN = '(?:CEO|CTO|CFO|COO|CIO|CMO|Chief\\s+[A-Za-z]+(?:\\s+Officer)?|Managing\\s+Director|General\\s+Manager|Deputy\\s+Manager|Executive\\s+Director|Director(?:\\s+of\\s+[A-Za-z ]{3,24})?|Head\\s+of\\s+[A-Za-z ]{3,24}|Vice\\s+President|President|Chairman|Founder|Co-?founder|Owner|Partner|Board\\s+Member|Sales\\s+Manager|Procurement\\s+Manager|Purchasing\\s+Manager|Operations\\s+Manager|Business\\s+Development\\s+Manager|Country\\s+Manager|Branch\\s+Manager|Project\\s+Manager|Manager)';
const ROLE_AR = '(?:المدير\\s+العام|المدير\\s+التنفيذي|الرئيس\\s+التنفيذي|نائب\\s+المدير|مدير\\s+عام|مدير\\s+[\\u0600-\\u06FF]{3,20}|رئيس\\s+مجلس\\s+الإدارة|رئيس\\s+قسم\\s+[\\u0600-\\u06FF]{3,20}|مسؤول\\s+[\\u0600-\\u06FF]{3,20}|مدير)';
const NAME_EN = "(?:[A-Z][a-z'’-]{1,18}(?:\\s+(?:Al|El|Abu|bin|bint|van|von|de|da)\\.?)?(?:\\s+[A-Z][a-z'’-]{1,18}){1,3})";
const NAME_AR = '(?:[\\u0600-\\u06FF]{2,15}(?:\\s+[\\u0600-\\u06FF]{2,15}){1,3})';

const NOT_A_NAME = /\b(Privacy|Cookie|Terms|Read More|Learn More|Contact Us|About Us|Our Team|All Rights|Home Page|Site Map|Follow Us|Get In|Head Office|Main Office|Customer Service|Human Resources)\b/i;

// Marketing pages are full of capitalised noise that looks like a name to a
// regex ("Customer Success", "Asana Dash"). A token from this list anywhere in
// a candidate name disqualifies it — a missed person is recoverable, a fake
// one poisons the outreach list.
const NAME_STOPWORDS = new Set(`about admin advisor agency ai all analytics api apps automation blog board brand business
foundation foundations staff leadership careers company corporate group inc llc ltd
about advisor agency ai all analytics api apps automation blog board brand business
buy careers case center chief cloud community company compare connect contact content course customer dash dashboard
data demo developer developers docs download education enterprise events explore feature features finance forum free
get github growth guide guides health help home hub industry insights integration integrations jobs join learn legal
library login logo main manage management marketing marketplace media meet mobile more news newsletter官 office
onboarding overview partner partners platform plans plus podcast portal press pricing privacy product products
professional program project projects reports resources review reviews roadmap sales security service services
sign signup site software solution solutions start started status stories story success support system table team
template templates terms tools training trial trust tutorial update updates upgrade use user users video view
watch webinar website work workflow workspace world`.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase()));

// Role words that regularly bleed into a captured name.
const ROLE_TOKENS = /^(chief|officer|executive|president|vice|head|director|manager|founder|co-?founder|owner|partner|chairman|board|member|general|managing|deputy|senior|lead|global|regional|country|branch|sales|marketing|operations|product|technology|technical|financial|revenue|people|talent|strategy|growth|customer|success|of|and|the|at|for)$/i;

/** Cut role words off a captured name: "Arnab Bose Chief Product" → "Arnab Bose". */
function trimRoleFromName(raw) {
  const tokens = String(raw).trim().split(/\s+/);
  const out = [];
  for (const t of tokens) {
    if (ROLE_TOKENS.test(t) && out.length >= 2) break;
    out.push(t);
  }
  // Hyphenated surnames get clipped by the capture ("Anderson-"); drop the
  // dangling punctuation rather than storing a half-written name.
  return out.join(' ').replace(/[\s'’-]+$/, '').trim();
}

/** Does this actually read like a person's name? */
function looksLikePersonName(raw) {
  const name = String(raw || '').trim();
  if (!name || NOT_A_NAME.test(name)) return false;
  const tokens = name.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (/\d|@|\/|·|\||©/.test(name)) return false;
  const arabic = /[؀-ۿ]/.test(name);
  for (const t of tokens) {
    const low = t.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
    if (!low) return false;
    if (NAME_STOPWORDS.has(low)) return false;
    if (ROLE_TOKENS.test(low)) return false;
    if (!arabic && !/^[A-Z]/.test(t)) return false;   // Latin names are capitalised
    if (low.length < 2 || low.length > 20) return false;
  }
  return true;
}

/** Turn "ahmed.hassan" or "a_hassan" into a plausible display name. */
function nameFromLocalPart(local) {
  const parts = local.split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length < 2) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/** Detect how this organization builds its email addresses. */
export function inferEmailPattern(emails, domain) {
  const host = String(domain || '').replace(/^www\./, '');
  const locals = emails
    .map((e) => (typeof e === 'string' ? e : e.value))
    .filter((e) => e && e.endsWith(`@${host}`))
    .map((e) => e.split('@')[0].toLowerCase())
    .filter((l) => !/^(info|contact|sales|hello|office|support|admin|enquir|inquir|marketing|hr|careers|help|team|mail|no-?reply)/i.test(l));
  for (const l of locals) {
    if (/^[a-z]{2,}\.[a-z]{2,}$/.test(l)) return { pattern: 'first.last', sample: l };
    if (/^[a-z]{2,}_[a-z]{2,}$/.test(l)) return { pattern: 'first_last', sample: l };
    if (/^[a-z]\.[a-z]{2,}$/.test(l)) return { pattern: 'f.last', sample: l };
  }
  return null;
}

/** Build a candidate address for a named person from a detected pattern. */
export function applyEmailPattern(fullName, pattern, domain) {
  const parts = String(fullName || '').trim().toLowerCase().split(/\s+/)
    .map((p) => p.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''))
    .filter(Boolean);
  if (parts.length < 2 || !pattern || !domain) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const local = pattern === 'first.last' ? `${first}.${last}`
    : pattern === 'first_last' ? `${first}_${last}`
      : pattern === 'f.last' ? `${first[0]}.${last}` : null;
  return local ? `${local}@${String(domain).replace(/^www\./, '')}` : null;
}

function extractPeople(page) {
  const text = stripTags(page.html);
  const found = new Map();
  const add = (rawName, role, email, phone) => {
    const name = trimRoleFromName(rawName || '');
    if (!looksLikePersonName(name)) return;
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    const prev = found.get(key) || { name: name.trim(), role: null, email: null, phone: null, sourceUrl: page.url };
    found.set(key, {
      ...prev,
      role: prev.role || (role ? decode(role).slice(0, 80) : null),
      email: prev.email || email || null,
      phone: prev.phone || phone || null,
    });
  };

  // 1. Name and role sitting near each other, in either order and either
  //    script. Team cards routinely slip an email, a separator or a job
  //    location between the two, so a short gap is allowed — and mined: an
  //    address or number inside it belongs to that same person.
  // The gap may contain an email or a phone (both full of dots and digits),
  // so it cannot simply ban periods. Instead a sentence boundary — a period
  // followed by a new capitalised word — disqualifies the pairing.
  const GAP = '([^\\n]{0,70}?)';
  const crossesSentence = (gap) => /\.\s+[A-Z؀-ۿ]/.test(gap.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' '));
  const harvestGap = (gap) => ({
    email: gap.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase() || null,
    phone: normalizePhone(gap.match(/(?:\+|00)\d[\d\s().-]{7,18}\d/)?.[0] || ''),
  });
  for (const [nameRe, roleRe] of [[NAME_EN, ROLE_EN], [NAME_AR, ROLE_AR]]) {
    for (const m of text.matchAll(new RegExp(`(${nameRe})\\s*[,،\\-–—:|]{0,3}\\s*${GAP}\\s*(${roleRe})`, 'g'))) {
      if (crossesSentence(m[2] || '')) continue;
      const { email, phone } = harvestGap(m[2] || '');
      add(m[1], m[3], email && !BAD_EMAIL.test(email) ? email : null, phone);
    }
    for (const m of text.matchAll(new RegExp(`(${roleRe})\\s*[,،\\-–—:|]{0,3}\\s*${GAP}\\s*(${nameRe})`, 'g'))) {
      if (crossesSentence(m[2] || '')) continue;
      const { email, phone } = harvestGap(m[2] || '');
      add(m[3], m[1], email && !BAD_EMAIL.test(email) ? email : null, phone);
    }
  }

  // 2. Personal mailto: links — the local part names the person.
  for (const m of page.html.matchAll(/mailto:([^"'>\s?]+)/gi)) {
    const email = decode(m[1]).toLowerCase();
    if (BAD_EMAIL.test(email)) continue;
    const local = email.split('@')[0];
    const guessed = nameFromLocalPart(local);
    if (guessed) add(guessed, null, email, null);
  }

  // 3. A phone sitting right next to a person's name (common on team cards).
  for (const m of text.matchAll(new RegExp(`(${NAME_EN}|${NAME_AR})[^\\n]{0,60}?((?:\\+|00)\\d[\\d\\s().-]{7,18}\\d)`, 'g'))) {
    const p = normalizePhone(m[2]);
    if (p) add(m[1], null, null, p);
  }

  // A bare name scraped off a marketing page is weak evidence. Keep it only
  // when the page also gave a role or a way to reach them.
  return [...found.values()].filter((p) => p.role || p.email || p.phone);
}

/**
 * Escalation crawl: look for named people inside the organization.
 * Returns people with whatever the site actually publishes about them.
 */
export async function discoverPeople(websiteOrDomain, { maxPages = 4 } = {}) {
  if (!websiteOrDomain) return { ok: false, reason: 'no website', people: [] };
  let base;
  try { base = new URL(/^https?:\/\//i.test(websiteOrDomain) ? websiteOrDomain : `https://${websiteOrDomain}`); }
  catch { return { ok: false, reason: 'bad url', people: [] }; }

  const people = new Map();
  const visited = [];
  const seen = new Set();
  for (const p of PEOPLE_PATHS) {
    if (visited.length >= maxPages) break;
    const page = await fetchPage(new URL(p, base).href);
    // Sites redirect unknown paths to one page — scan each destination once.
    if (!page || seen.has(page.url)) continue;
    seen.add(page.url);
    visited.push(page.url);
    for (const person of extractPeople(page)) {
      const key = person.name.toLowerCase();
      if (!people.has(key)) people.set(key, person);
      else {
        const prev = people.get(key);
        people.set(key, { ...prev, role: prev.role || person.role, email: prev.email || person.email, phone: prev.phone || person.phone });
      }
    }
    if (people.size >= 12) break;
  }
  return { ok: Boolean(visited.length), pages: visited, people: [...people.values()].slice(0, 12) };
}

/** Deeper sweep for a postal address when the usual pages had none. */
export async function deepCrawl(websiteOrDomain, { maxPages = 4 } = {}) {
  if (!websiteOrDomain) return { ok: false, addresses: [], phones: [] };
  let base;
  try { base = new URL(/^https?:\/\//i.test(websiteOrDomain) ? websiteOrDomain : `https://${websiteOrDomain}`); }
  catch { return { ok: false, addresses: [], phones: [] }; }
  const addresses = []; const phones = new Map(); const visited = [];
  for (const p of DEEP_PATHS) {
    if (visited.length >= maxPages) break;
    const page = await fetchPage(new URL(p, base).href);
    if (!page) continue;
    visited.push(page.url);
    const ex = extractFromPage(page);
    addresses.push(...ex.addresses.map((a) => ({ value: a, sourceUrl: ex.sourceUrl })));
    for (const ph of ex.phones) if (!phones.has(ph)) phones.set(ph, { value: ph, sourceUrl: ex.sourceUrl, confidence: ph.startsWith('+') ? 0.8 : 0.55 });
  }
  return {
    ok: Boolean(visited.length), pages: visited,
    address: addresses.sort((a, b) => b.value.length - a.value.length)[0] || null,
    phones: [...phones.values()].slice(0, 4),
  };
}

/**
 * Crawl a company's own site for contact facts.
 * Returns { ok, pages[], emails[], phones[], address, social, profile, sourceUrl }
 * where every email/phone carries the page URL it was found on.
 */
export async function enrichFromWeb(websiteOrDomain) {
  if (!websiteOrDomain) return { ok: false, reason: 'no website' };
  let base;
  try {
    base = new URL(/^https?:\/\//i.test(websiteOrDomain) ? websiteOrDomain : `https://${websiteOrDomain}`);
  } catch { return { ok: false, reason: 'bad url' }; }
  const domain = base.hostname.replace(/^www\./, '');

  const emails = new Map(); const phones = new Map();
  const addresses = []; const social = {}; const visited = [];
  let profile = null; let whatsapp = null;

  for (const p of CONTACT_PATHS) {
    if (visited.length >= MAX_PAGES) break;
    const page = await fetchPage(new URL(p || '/', base).href);
    if (!page) continue;
    visited.push(page.url);
    const ex = extractFromPage(page);
    for (const e of ex.emails) {
      if (BAD_EMAIL.test(e) || e.length > 90) continue;
      if (!emails.has(e)) emails.set(e, { value: e, sourceUrl: ex.sourceUrl, confidence: score(e, domain) });
    }
    for (const ph of ex.phones) {
      if (!phones.has(ph)) phones.set(ph, { value: ph, sourceUrl: ex.sourceUrl, confidence: ph.startsWith('+') ? 0.85 : 0.6 });
    }
    addresses.push(...ex.addresses.map((a) => ({ value: a, sourceUrl: ex.sourceUrl })));
    Object.assign(social, ex.social);
    if (!whatsapp && ex.whatsapp) whatsapp = { value: ex.whatsapp, sourceUrl: ex.sourceUrl };
    if (!profile && ex.description) profile = { value: ex.description, sourceUrl: ex.sourceUrl };
    // Home page alone answering everything is enough — stay polite.
    if (emails.size && phones.size && addresses.length && visited.length >= 2) break;
  }

  if (!visited.length) return { ok: false, reason: 'site unreachable', domain };

  const best = (arr) => arr.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const addr = addresses.sort((a, b) => b.value.length - a.value.length)[0] || null;
  return {
    ok: true, domain, pages: visited,
    emails: best([...emails.values()]).slice(0, 6),
    phones: best([...phones.values()]).slice(0, 6),
    whatsapp, address: addr, social, profile,
    sourceUrl: visited[0],
  };
}
