// robots.txt — asking before reading.
//
// This was missing, and its absence is most of why the company kept meeting
// "you look like a bot". A site that publishes a crawl policy and gets ignored
// escalates: first a 403 on one page, then a fingerprint check, then the whole
// address range. Half of being allowed to read the web is being the kind of
// reader that stops when told.
//
// The other half is not pretending. This platform identifies itself in its
// user-agent and honours what it finds here, which is the same stance as the
// browser ending a session at a CAPTCHA: a site that does not want machines has
// said so, and going around it poisons everything else the company does online.
//
// Parsing follows RFC 9309, including the part people skip: a 4xx means there
// is no policy and everything is allowed; a 5xx means the policy could not be
// read, and an unreadable policy is not permission.
import { getSetting } from './settings.js';

export const TOKEN = 'AlphaCore';

/**
 * A browser-shaped user-agent that still says exactly what it is.
 *
 * The bare token `AlphaCore/1.0` was honest and unparseable: a great many sites
 * reject anything that does not look like a browser, so the truthful agent was
 * refused while a dishonest one would have been served. This is both — a
 * well-formed Chrome string with our own token and a URL on the end, so anybody
 * reading a log knows who called and where to complain.
 */
export function userAgent() {
  const base = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
  const url = getSetting('PUBLIC_BASE_URL') || 'https://github.com/itzzexe/crucible-core';
  return `${base} ${TOKEN}/1.0 (+${url}; company research agent)`;
}

// One robots.txt per origin, for an hour. Re-fetching it on every page is its
// own kind of rudeness.
const cache = new Map();
const TTL_MS = 60 * 60 * 1000;

/** Exported so the parser can be tested without the internet. */
export function parse(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules.
      if (!current || current.rules.length) { current = { agents: [], rules: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (current && field === 'crawl-delay') {
      const d = Number(value);
      if (Number.isFinite(d)) current.delay = d;
    }
  }
  return groups;
}

/** RFC 9309 matching: `*` is any run of characters, `$` anchors the end. */
function matches(pattern, path) {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const rx = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return rx.test(path);
}

/** Exported alongside `parse` for the same reason. */
export function decide(groups, path) {
  const token = TOKEN.toLowerCase();
  // The most specific group wins: our own name over the wildcard, and nothing
  // else applies to us at all.
  const mine = groups.filter((g) => g.agents.some((a) => a === token));
  const wild = groups.filter((g) => g.agents.includes('*'));
  const chosen = mine.length ? mine : wild;
  if (!chosen.length) return { allowed: true, why: 'no group applies to this agent', delay: null };

  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;

  // Longest matching rule wins; a tie goes to allow, as the standard says.
  let best = null;
  for (const r of rules) {
    if (!matches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  if (!best) return { allowed: true, why: 'no rule matches this path', delay };
  return {
    allowed: best.allow,
    why: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path || '(empty)'}`,
    delay,
  };
}

async function policyFor(origin) {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': userAgent(), accept: 'text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 400 && res.status < 500) {
      value = { groups: [], state: 'none', note: `no robots.txt (${res.status}) — everything is allowed` };
    } else if (res.status >= 500) {
      // Unreadable is not permission. This is the one place the standard and
      // the instinct to "just try it" disagree, and the standard is right.
      value = { groups: null, state: 'unreadable', note: `robots.txt returned ${res.status} — treated as refused` };
    } else {
      value = { groups: parse(await res.text()), state: 'read', note: 'robots.txt read' };
    }
  } catch (e) {
    value = { groups: null, state: 'unreachable', note: `could not read robots.txt: ${String(e.message).slice(0, 80)}` };
  }
  cache.set(origin, { at: Date.now(), value });
  return value;
}

/**
 * May this platform read this URL?
 *
 * Always returns a verdict with a reason in words, because "blocked" with no
 * explanation is the thing that makes somebody reach for a stealth plugin.
 */
export async function mayFetch(rawUrl) {
  if (getSetting('ROBOTS_RESPECT') === 'false') {
    return { allowed: true, why: 'ROBOTS_RESPECT is off — this install has chosen to ignore crawl policies', delay: null, policy: 'ignored' };
  }
  let url;
  try { url = new URL(rawUrl); } catch { return { allowed: false, why: 'not a URL', delay: null, policy: 'none' }; }

  const p = await policyFor(url.origin);
  if (p.groups === null) return { allowed: false, why: p.note, delay: null, policy: p.state };
  if (!p.groups.length) return { allowed: true, why: p.note, delay: null, policy: p.state };

  const d = decide(p.groups, url.pathname + url.search);
  return { allowed: d.allowed, why: d.why, delay: d.delay, policy: p.state };
}

// Search engines are the one case where "the browser is detected as a bot" has
// nothing to do with fingerprints: their results pages forbid automated reading
// in robots.txt, in the terms, and in an anti-bot layer that will win. There is
// a supported way to ask them, and it returns better data than a scrape.
const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z.]+|baidu\.com|ecosia\.org|brave\.com)$/i;
const SEARCH_PATHS = /^\/(search|s|web|results)\b/i;

/** Is this somebody trying to scrape a results page? */
export function isSearchResultsPage(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!SEARCH_HOSTS.test(u.hostname)) return false;
    // /sorry/ is where Google sends a client it has decided is a machine. It is
    // not a results page, but going there is the same mistake one redirect
    // later, and it must not be treated as an ordinary page to work on.
    if (/^\/(sorry|challenge)\b/i.test(u.pathname)) return true;
    return SEARCH_PATHS.test(u.pathname) || u.searchParams.has('q');
  } catch { return false; }
}

// The wall itself, in the shapes it actually arrives in. Recognised so a session
// can end saying what happened and what to do instead — "stuck" is true and
// useless, and the person reading it cannot tell a broken page from a refusal.
const WALL_URLS = /(\/sorry\/|\/challenge|captcha|cdn-cgi\/challenge|__cf_chl|\/checkpoint\/challenge|hcaptcha|recaptcha)/i;
const WALL_TEXT = /(unusual traffic|i'?m not a robot|verify (you are|you're) human|are you a robot|checking your browser|enable javascript and cookies to continue|أثبت أنك لست روبوت|حركة مرور غير عادية)/i;

/**
 * Has this page stopped being a page and become a checkpoint?
 *
 * Returns what to say rather than a boolean, because the useful part is the
 * sentence: which wall, and what the person should do now that going round it
 * is not on the table.
 */
export function botWall(url, text = '', title = '') {
  const byUrl = WALL_URLS.test(String(url));
  const byText = WALL_TEXT.test(`${title}\n${String(text).slice(0, 4000)}`);
  if (!byUrl && !byText) return null;

  const engine = (() => { try { return SEARCH_HOSTS.test(new URL(url).hostname); } catch { return false; } })();
  return {
    wall: byUrl ? 'the address is a verification checkpoint' : 'the page is asking the visitor to prove they are human',
    why: engine
      ? 'This is a search engine refusing automated access to its results. It is not a bug and not a fingerprint '
        + 'problem: reading those pages by machine is refused by every engine, and disguising the client only widens '
        + 'the block from a page to an address range.'
      : 'This site has put a human check in front of the page. It has said it does not want machines here.',
    instead: engine
      ? 'Search through the engine\'s own interface instead — add BRAVE_SEARCH_KEY, TAVILY_API_KEY or SERPAPI_KEY in '
        + 'Settings. To find a company\'s contact details specifically, Intelligence is the department for it: it reads '
        + 'the company\'s own site and needs no search key at all.'
      : 'Ask the site for an interface or for permission. This platform does not go around a human check.',
  };
}
