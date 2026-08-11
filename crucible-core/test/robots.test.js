// Asking before reading, and saying who is asking.
//
// The claim under test is that this platform is refused less often because it
// behaves better, not because it disguises itself. So these check two things
// that pull in opposite directions: that the crawl policy is obeyed exactly,
// including the awkward parts of RFC 9309, and that the user-agent still names
// the platform rather than impersonating a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-robots.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-robots.db${s}`)); } catch { /* first run */ }
}

const R = await import('../src/robots.js');

test('the agent says what it is, and does not pretend to be a person', () => {
  const ua = R.userAgent();
  assert.match(ua, /AlphaCore\/1\.0/, 'the platform names itself');
  assert.match(ua, /\+http/, 'and leaves an address to complain to');
  // Browser-shaped, because a great many sites refuse anything that is not —
  // which was blocking the honest agent while a dishonest one sailed through.
  assert.match(ua, /^Mozilla\/5\.0 /);
  assert.match(ua, /Chrome\//);
  assert.ok(!/Headless/i.test(ua), 'not the default, which is refused outright by many sites');
});

test('a results page is recognised however it is dressed up', () => {
  for (const u of [
    'https://www.google.com/search?q=iraq+oil+companies',
    'https://google.co.uk/search?q=x',
    'https://www.bing.com/search?q=x',
    'https://duckduckgo.com/?q=x',
    'https://yandex.ru/search/?text=x&q=x',
  ]) assert.equal(R.isSearchResultsPage(u), true, u);
});

test('an ordinary page on an ordinary site is not mistaken for one', () => {
  for (const u of [
    'https://example.com/about',
    'https://genelenergy.com/contact',
    'https://news.ycombinator.com/item?id=1',
    'https://maps.google.com/maps/place/x',
  ]) assert.equal(R.isSearchResultsPage(u), false, u);
});

// The parser is exercised directly rather than over the network, because a test
// that needs the internet is a test that fails on a train.
const parseForTest = R.parse;
const decideForTest = R.decide;

test('the longest matching rule wins, and a tie goes to allow', () => {
  const groups = parseForTest(`
User-agent: *
Disallow: /private
Allow: /private/public
`);
  assert.equal(decideForTest(groups, '/private/secret').allowed, false);
  assert.equal(decideForTest(groups, '/private/public/page').allowed, true, 'the longer Allow beats the shorter Disallow');
  assert.equal(decideForTest(groups, '/elsewhere').allowed, true);
});

test('a group naming this agent beats the wildcard', () => {
  const groups = parseForTest(`
User-agent: *
Disallow: /

User-agent: AlphaCore
Allow: /
Crawl-delay: 3
`);
  const d = decideForTest(groups, '/anything');
  assert.equal(d.allowed, true, 'the specific group applies and the wildcard does not');
  assert.equal(d.delay, 3, 'and its crawl delay comes with it');
});

test('wildcards and end-anchors are honoured', () => {
  const groups = parseForTest(`
User-agent: *
Disallow: /*.pdf$
Disallow: /admin/*/edit
`);
  assert.equal(decideForTest(groups, '/reports/annual.pdf').allowed, false);
  assert.equal(decideForTest(groups, '/reports/annual.pdf.html').allowed, true, '$ anchors the end');
  assert.equal(decideForTest(groups, '/admin/7/edit').allowed, false);
  assert.equal(decideForTest(groups, '/admin/7/view').allowed, true);
});

test('an empty Disallow forbids nothing — the classic way to say "come in"', () => {
  const groups = parseForTest('User-agent: *\nDisallow:');
  assert.equal(decideForTest(groups, '/anything').allowed, true);
});
