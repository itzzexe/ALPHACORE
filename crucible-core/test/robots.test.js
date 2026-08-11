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

// The wall itself. A session that meets one should say which wall and what to
// do, not "stuck" — the word that is true and tells nobody anything.
test('a verification checkpoint is recognised by its address', () => {
  const w = R.botWall('https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dx', '', '');
  assert.ok(w, 'the /sorry/ interstitial is where Google sends a client it has decided is a machine');
  assert.match(w.instead, /BRAVE_SEARCH_KEY/, 'and it says where searching actually lives');
  assert.match(w.instead, /Intelligence/, 'and which department finds contact details without one');
});

test('and by what the page says, in either language', () => {
  assert.ok(R.botWall('https://example.com/x', 'Our systems have detected unusual traffic from your computer network'));
  assert.ok(R.botWall('https://example.com/x', 'من فضلك أثبت أنك لست روبوت'));
  assert.ok(R.botWall('https://example.com/x', '', "I'm not a robot"));
  assert.ok(R.botWall('https://shop.example/x', 'Checking your browser before accessing'));
});

test('an ordinary page is not mistaken for a checkpoint', () => {
  assert.equal(R.botWall('https://genelenergy.com/contact', 'Contact us on +964 770 000 0000', 'Contact'), null);
  assert.equal(R.botWall('https://example.com/robots', 'robots.txt explained', 'Robots'), null);
});

test('the /sorry/ page is refused as a destination too', () => {
  assert.equal(R.isSearchResultsPage('https://www.google.com/sorry/index?continue=x'), true);
});
