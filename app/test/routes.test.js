// The shape of a route handler.
//
// A handler is called as `handler(m.slice(1), body, url, user)`, so the first
// capture group is `p[0]`. Seven routes were written using `p[1]`, which is
// always undefined: `Number(undefined)` is NaN, the query matches nothing, and
// the endpoint answers 200 with `null`. Nothing throws, nothing is logged, and
// the only symptom is a page that quietly does not open — which is how it
// survived a screenshot, a deploy and a round of manual clicking.
//
// This reads the route table as text rather than calling it, because the point
// is to catch the next one before anybody runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = fs.readFileSync(path.join(root, 'src', 'api.js'), 'utf8');
const lines = api.split(/\r?\n/);
const isRouteStart = (t) => /^\s*\['(GET|POST|PUT|DELETE|PATCH)'\s*,/.test(t);
const routeLines = lines
  .map((l, i) => ({ n: i + 1, text: l }))
  .filter((l) => isRouteStart(l.text));

/**
 * A whole route entry, not just its first line.
 *
 * Most handlers run to three or four lines, and the parameter is usually read
 * on one of the later ones — a checker that reads only the first line reports
 * every one of them as broken, which is a checker nobody keeps.
 */
const routeEntries = routeLines.map(({ n, text }) => {
  const parts = [text];
  for (let i = n; i < lines.length && !isRouteStart(lines[i]); i++) {
    if (/^\s*\]\s*;\s*$/.test(lines[i])) break;
    parts.push(lines[i]);
  }
  return { n, text, whole: parts.join('\n') };
});

test('the route table is found, and it is the real one', () => {
  assert.ok(routeLines.length > 100, `only found ${routeLines.length} route lines — the parser has drifted`);
  assert.ok(api.includes('handler(m.slice(1)'), 'the calling convention this test is built on still holds');
});

test('no handler reads a capture group that cannot exist', () => {
  // p[0] is the first capture. p[1] is the second — legitimate only where the
  // pattern really has two groups, which none of these do today. Reading one
  // that is not there yields undefined, then NaN, then a query that matches
  // nothing, then a 200 with null in it. Nothing throws. That is the whole
  // problem: it fails silently and looks like a dead button.
  const wrong = [];
  for (const { n, text, whole } of routeEntries) {
    const pattern = (text.match(/^\s*\['[A-Z]+',\s*(\/\^.*?\$\/)\s*,/) || [])[1] || '';
    const groups = (pattern.match(/\((?!\?:)/g) || []).length;
    for (const m of whole.matchAll(/\bp\[(\d+)\]/g)) {
      const i = Number(m[1]);
      if (i >= groups) wrong.push(`line ${n}: reads p[${i}] but the pattern has ${groups} capture group(s) — ${text.trim().slice(0, 64)}`);
    }
  }
  assert.deepEqual(wrong, [], `\n${wrong.join('\n')}`);
});

test('every route that captures something goes on to read it', () => {
  const silent = [];
  for (const { n, text, whole } of routeEntries) {
    const pattern = (text.match(/^\s*\['[A-Z]+',\s*(\/\^.*?\$\/)\s*,/) || [])[1] || '';
    if (!(pattern.match(/\((?!\?:)/g) || []).length) continue;
    // Either p[0] somewhere in the handler, or the array destructured in place.
    if (!/\bp\[0\]/.test(whole) && !/\(\s*\[[a-zA-Z]/.test(text)) {
      silent.push(`line ${n}: captures a parameter and never reads it — ${text.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(silent, [], `\n${silent.join('\n')}`);
});

test('every route the offices page calls is registered', () => {
  // The page was shipped calling an endpoint that had never been added: the
  // edit that was supposed to add it failed silently and only the import
  // survived. The console answered 404 and the button did nothing.
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const called = [...app.matchAll(/api\(`?\/api\/(sim[^`'"?]*)/g)]
    .map((m) => m[1].replace(/\$\{[^}]+\}/g, 'X').replace(/\/$/, ''));
  const missing = [];
  for (const c of new Set(called)) {
    const asRegex = `/api/${c}`.replace(/X/g, '.+');
    const found = routeLines.some(({ text }) => {
      const pat = (text.match(/^\s*\['[A-Z]+',\s*\/\^(.*?)\$\/,/) || [])[1];
      if (!pat) return false;
      const plain = pat.replace(/\\\//g, '/');
      try { return new RegExp(`^${plain}$`).test(asRegex.replace(/\.\+/g, '1')); } catch { return false; }
    });
    if (!found) missing.push(`/api/${c}`);
  }
  assert.deepEqual(missing, [], `the console calls endpoints that do not exist:\n${missing.join('\n')}`);
});

test('a literal route is never shadowed by an earlier pattern that would swallow it', () => {
  // /api/connectors/certification is a fixed path, and "certification" is a
  // perfectly legal connector id as far as /api/connectors/([a-z0-9:_-]+)$/ is
  // concerned. First match wins, so the fixed route has to come first — and
  // when it does not, the symptom is a 404 saying "no such connector", which
  // reads like a data problem rather than a routing one.
  const parsed = routeLines.map(({ n, text }) => {
    const m = text.match(/^\s*\['([A-Z]+)',\s*(\/\^.*?\$\/),/);
    if (!m) return null;
    let re = null;
    try { re = new RegExp(m[2].slice(1, -1)); } catch { return null; }
    const src = m[2].slice(2, -2);                       // between /^ and $/
    // A fixed path: word characters and escaped slashes, nothing else. Anything
    // with a group, a class or a quantifier is a pattern and is skipped.
    const literal = /^(?:[\w.-]|\\\/)*$/.test(src) ? src.replace(/\\(.)/g, '$1') : null;
    return { n, method: m[1], re, literal };
  }).filter(Boolean);

  const shadowed = [];
  for (let i = 0; i < parsed.length; i++) {
    const later = parsed[i];
    if (!later.literal) continue;
    for (let j = 0; j < i; j++) {
      const earlier = parsed[j];
      if (earlier.method !== later.method || earlier.literal) continue;
      if (earlier.re.test(later.literal)) {
        shadowed.push(`line ${later.n}: ${later.method} ${later.literal} is caught first by ${earlier.re} on line ${earlier.n}`);
      }
    }
  }
  assert.deepEqual(shadowed, [], `\n${shadowed.join('\n')}`);
});
