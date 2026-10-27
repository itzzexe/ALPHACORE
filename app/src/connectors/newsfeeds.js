// News feeds — RSS and Atom, read the way they were published to be read.
//
// A feed is the one part of a news site that exists for machines, so this is
// the honest way in: no scraping of article pages, no paywall games, and every
// fetch asks robots.txt first like the rest of the platform. The parser is
// small and deliberately forgiving — feeds in the wild are rarely valid XML —
// and it returns plain text only, because whatever a headline contains is
// untrusted input on its way to a model.
import { assertPublicUrl } from '../web.js';
import { mayFetch, userAgent } from '../robots.js';

const MAX_BYTES = 1_500_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const text = (s) => decode(decode(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

function isoDate(s) {
  if (!s) return null;
  const d = new Date(text(s));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Exported so the parser can be tested without the internet. */
export function parseFeed(xml) {
  const src = String(xml || '');
  const channelTitle = text(tag(src.replace(/<item[\s\S]*$/i, '').replace(/<entry[\s\S]*$/i, ''), 'title') || '');
  const items = [];
  const blocks = src.match(/<item[\s>][\s\S]*?<\/item>/gi) || src.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 80)) {
    let link = text(tag(b, 'link') || '');
    if (!link) {
      // Atom: the alternate link is an attribute, not a body.
      const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decode(m[1]) : '';
    }
    if (!link) link = text(tag(b, 'guid') || '');
    const title = text(tag(b, 'title') || '');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    items.push({
      title: title.slice(0, 300),
      url: link.slice(0, 1000),
      summary: text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || '').slice(0, 600),
      publishedAt: isoDate(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')),
      source: text(tag(b, 'source') || '') || null,
    });
  }
  return { title: channelTitle.slice(0, 200), items };
}

/**
 * Fetch one feed, following redirects by hand so every hop is checked.
 *
 * fetch() would follow a redirect to 127.0.0.1 without asking. A feed URL is
 * something a person types into a form, so each address it leads to is put
 * through the same public-address check as the first.
 */
export async function fetchFeed(rawUrl) {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    const robots = await mayFetch(url);
    if (!robots.allowed) throw new Error(`robots.txt: ${robots.why}`);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': userAgent(), accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const body = (await res.text()).slice(0, MAX_BYTES);
    const parsed = parseFeed(body);
    if (!parsed.items.length && !/<(rss|feed|rdf)/i.test(body.slice(0, 2000))) throw new Error('that address is not an RSS or Atom feed');
    return { url, ...parsed };
  }
  throw new Error('too many redirects');
}

export default {
  id: 'newsfeeds',
  label: 'News feeds — RSS and Atom',
  auth: { kind: 'none' },
  docs: 'Public RSS/Atom feeds. No key. robots.txt is honoured on every fetch.',
  quotaDay: 3000,
  capabilities: ['feed.fetch'],
  ops: {
    'feed.fetch': {
      target: (args) => { try { return new URL(args.url).hostname; } catch { return null; } },
      run: (args) => fetchFeed(args.url),
    },
  },
};
