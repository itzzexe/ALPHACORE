// The open web, as a capability with a memory.
//
// Three graded abilities, weakest first: fetch a page, search for pages, drive
// a real browser. Each is stronger and each costs more, so an employee that
// only needs to read a price list never gets a browser.
//
// Two rules run through all of it. First, the SSRF guard from the intel module
// applies to every mode: no private addresses, no odd ports, no redirect into
// the local network. Second — and this is the one that matters once employees
// can also send email — **fetched text is data, never instruction**. Anything
// that reads like a command to the reader is flagged, recorded as an attack
// attempt, and the text is still returned, clearly fenced, because refusing to
// show it would only hide the attack.
import { createHash } from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret } from './vault.js';

const UA = 'AlphaCore/1.0 (+company research agent)';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 900_000;
const BAD_HOSTS = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v === '::';
}

export async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http and https are allowed');
  if (url.port && !['80', '443', ''].includes(url.port)) throw new Error('that port is not allowed');
  if (BAD_HOSTS.test(url.hostname)) throw new Error('that host is not allowed');
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error('private addresses are blocked');
    return url;
  }
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private addresses are blocked');
  return url;
}

// What an attempted hijack looks like in fetched text.
//
// The English list was written first and the red team immediately walked an
// Arabic payload straight past it — which is the whole reason the red team
// exists. This company reads Arabic all day, so an Arabic-only scanner gap was
// not a gap at the edges, it was a gap down the middle.
const INJECTION = [
  // English
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
  // "forget everything above" was found by fuzzing, not by review: the list
  // had "ignore" and "disregard" and simply no third synonym, and a quarter of
  // mutated payloads walked through the gap. The object is required — "forget
  // about the meeting on Tuesday" is a sentence people write.
  /\b(forget|ignore|disregard|overlook)\s+(everything|all|anything|what)\b[^.!?]{0,40}\b(above|before|prior|previous|earlier|said|told|instructed)/i,
  /\bfollow\s+(these|the|my)\s+new\s+instructions?/i,
  /you\s+are\s+now\s+(a|an|the)\s/i,
  /\bnew\s+instructions?\s*:/i,
  /(send|email|forward|reveal|print)\s+(me\s+)?(the\s+)?(api\s+)?(key|token|password|secret|credential)/i,
  /act\s+as\s+(if\s+)?(you|though)/i,
  /<\|im_start\|>|\[\[SYSTEM\]\]|###\s*system|<system>/i,
  // Arabic — the same four moves: ignore, override, impersonate, exfiltrate
  /تجاهل\s+(كل\s+)?(ال)?(تعليمات|الأوامر|التوجيهات)/,
  /(تجاهل|ألغِ|الغ)\s+(ما\s+)?(سبق|قبل|السابق)/,
  // Same gap on this side: "انس كل ما قيل لك سابقاً" uses a verb the list did
  // not have. Arabic drops short vowels and the alif takes three written
  // forms, so the alternation is spelled out rather than assumed.
  /(انس|أنس|إنس|تناس|اهمل|أهمل)\s+(كل\s+)?(ما\s+)?(قيل|سبق|ذُكر|ذكر|قبل|السابق)/,
  /(أنت|انت)\s+الآن\s/,
  /(تعليمات|أوامر)\s+(جديدة|أخرى)\s*[:：]/,
  /(أرسل|ارسل|أعطني|اعطني|اكشف)\s+(لي\s+)?(ال)?(مفاتيح|مفتاح|كلمة\s*المرور|الرمز|السر)/,
  /تصرف\s+(كأنك|كما\s+لو)/,
  // The shape of an instruction addressed to a reader that is not the user
  /\b(system|assistant)\s*[:：]\s*(you|your|ignore|disregard)/i,
];

export function scanForInjection(text) {
  const hits = INJECTION.filter((re) => re.test(text)).map((re) => String(re).slice(0, 70));
  return { clean: hits.length === 0, hits };
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const stripTags = (html) => decode(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '));

function remember({ url, mode, agentId, runId, status, bytes, text, title, screenshot = null, error = null }) {
  const hash = text ? createHash('sha256').update(text).digest('hex') : null;
  const r = exec(
    `INSERT INTO web_fetches (url, mode, agent_id, run_id, status, bytes, content_hash, title, text, screenshot, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    url, mode, agentId, runId, status, bytes, hash, title, text ? text.slice(0, 60_000) : null, screenshot, error,
  );
  return { id: Number(r.lastInsertRowid), contentHash: hash };
}

/** Level one: read a page. */
export async function fetchPage(rawUrl, { agentId = null, runId = null, maxAgeMinutes = 60 } = {}) {
  const cached = one(
    "SELECT * FROM web_fetches WHERE url = ? AND error IS NULL AND created_at >= datetime('now', '-' || ? || ' minutes') ORDER BY id DESC LIMIT 1",
    rawUrl, maxAgeMinutes,
  );
  if (cached) return { url: rawUrl, cached: true, id: cached.id, title: cached.title, text: cached.text, contentHash: cached.content_hash, injection: scanForInjection(cached.text || '') };

  const url = await assertPublicUrl(rawUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain', 'accept-language': 'ar,en' },
    });
    const buf = Buffer.from((await res.arrayBuffer()).slice(0, MAX_BYTES));
    const html = buf.toString('utf8');
    const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')).slice(0, 200);
    const text = stripTags(html).slice(0, 40_000);
    const injection = scanForInjection(text);
    const saved = remember({ url: res.url || rawUrl, mode: 'fetch', agentId, runId, status: res.status, bytes: buf.length, text, title });
    if (!injection.clean) {
      exec("INSERT INTO redteam_runs (attack, target, payload, outcome, detail, severity) VALUES ('prompt-injection', ?, ?, 'defended', ?, 'high')",
        rawUrl, text.slice(0, 500), `found in a page an employee was reading: ${injection.hits.join(', ')}`);
      audit({ actorType: 'system', actorId: 'system:web', action: 'web.injection_found', subjectType: 'url', subjectId: rawUrl, payload: { hits: injection.hits, agentId } });
    }
    return { url: res.url || rawUrl, status: res.status, title, text, ...saved, injection, cached: false };
  } catch (err) {
    remember({ url: rawUrl, mode: 'fetch', agentId, runId, status: 0, bytes: 0, text: null, title: null, error: String(err.message).slice(0, 300) });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Level two: search. Whichever engine has a key configured wins; with none, it
 * says so plainly instead of inventing results.
 */
export async function searchWeb(query, { agentId = null, runId = null, count = 8 } = {}) {
  const brave = getSecret('BRAVE_SEARCH_KEY');
  const tavily = getSecret('TAVILY_API_KEY');
  const serp = getSecret('SERPAPI_KEY');
  let results = [];
  let engine = null;

  if (brave) {
    engine = 'brave';
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
      headers: { 'x-subscription-token': brave, accept: 'application/json' },
    });
    const d = await r.json();
    results = (d.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  } else if (tavily) {
    engine = 'tavily';
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: tavily, query, max_results: count }),
    });
    const d = await r.json();
    results = (d.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content?.slice(0, 300) }));
  } else if (serp) {
    engine = 'serpapi';
    const r = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serp}`);
    const d = await r.json();
    results = (d.organic_results || []).slice(0, count).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
  } else {
    return { engine: null, query, results: [], note: 'no search key configured — add BRAVE_SEARCH_KEY, TAVILY_API_KEY or SERPAPI_KEY to the vault' };
  }

  remember({
    url: `search:${query}`, mode: 'search', agentId, runId, status: 200,
    bytes: JSON.stringify(results).length, title: `${engine}: ${query}`,
    text: results.map((r) => `${r.title}\n${r.url}\n${r.snippet || ''}`).join('\n\n'),
  });
  return { engine, query, results };
}

/**
 * Level three: a real browser, for pages that are a JavaScript application
 * rather than a document. Talks to Chrome over the DevTools protocol — the same
 * mechanism used to verify this interface — so there is no extra dependency.
 */
export async function browsePage(rawUrl, { agentId = null, runId = null, port = 9333, waitMs = 2500, screenshot = false } = {}) {
  await assertPublicUrl(rawUrl);
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  } catch {
    throw new Error(`no browser on port ${port} — start Chrome with --remote-debugging-port=${port}`);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('the browser has no open page to drive');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 1;
  const rpc = (method, params = {}) => new Promise((resolve) => {
    const mine = id++;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === mine) { ws.removeEventListener('message', onMsg); resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

  try {
    await rpc('Page.enable');
    await rpc('Page.navigate', { url: rawUrl });
    await new Promise((r) => setTimeout(r, waitMs));
    const evaled = await rpc('Runtime.evaluate', {
      expression: 'JSON.stringify({ title: document.title, text: document.body ? document.body.innerText.slice(0, 40000) : "" })',
      returnByValue: true,
    });
    const { title, text } = JSON.parse(evaled.result.value);
    let shot = null;
    if (screenshot) {
      const s = await rpc('Page.captureScreenshot', { format: 'png' });
      shot = `data:image/png;base64,${String(s.data).slice(0, 400_000)}`;
    }
    const injection = scanForInjection(text);
    const saved = remember({ url: rawUrl, mode: 'browse', agentId, runId, status: 200, bytes: text.length, title, text, screenshot: shot });
    return { url: rawUrl, title, text, screenshot: shot, injection, ...saved };
  } finally {
    ws.close();
  }
}

export function webOverview() {
  return {
    counts: {
      today: one("SELECT COUNT(*) AS n FROM web_fetches WHERE created_at >= datetime('now','-1 day')").n,
      total: one('SELECT COUNT(*) AS n FROM web_fetches').n,
      failed: one('SELECT COUNT(*) AS n FROM web_fetches WHERE error IS NOT NULL').n,
      injections: one("SELECT COUNT(*) AS n FROM redteam_runs WHERE attack = 'prompt-injection'").n,
    },
    engines: {
      brave: Boolean(getSecret('BRAVE_SEARCH_KEY')),
      tavily: Boolean(getSecret('TAVILY_API_KEY')),
      serpapi: Boolean(getSecret('SERPAPI_KEY')),
    },
    byMode: q('SELECT mode, COUNT(*) AS n FROM web_fetches GROUP BY mode'),
    recent: q('SELECT id, url, mode, status, title, bytes, content_hash, error, agent_id, created_at FROM web_fetches ORDER BY id DESC LIMIT 40'),
    topDomains: q(`SELECT substr(url, 1, instr(substr(url, 9), '/') + 8) AS domain, COUNT(*) AS n
                   FROM web_fetches WHERE url LIKE 'http%' GROUP BY domain ORDER BY n DESC LIMIT 12`),
  };
}

export function readFetch(id) {
  const row = one('SELECT * FROM web_fetches WHERE id = ?', id);
  if (!row) return null;
  return { ...row, injection: scanForInjection(row.text || '') };
}
