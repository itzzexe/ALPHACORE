// The command floor: the globe, missions, the health index, what if,
// broadcasts, and the person's own deck.
//
// What is tested is what each one decides from the record — which countries
// light and what crossed to them, when a mission step counts as done, how a
// pillar scores and when it is left out, how many months the cash lasts under
// a set of levers, who sees a broadcast and when it stops showing, and what a
// person's preferences may hold. Nothing here is drawn; the globe's canvas and
// the deck's motion are checked in the browser sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-meridian.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-meridian-files/memory';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-meridian.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-meridian-files'), { recursive: true, force: true });

const { one, q, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { createUser } = await import('../src/auth.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const { verifyChain } = await import('../src/audit.js');
const { addParty } = await import('../src/aml.js');
const { addBeneficiary } = await import('../src/core2/remit.js');
const Globe = await import('../src/globe.js');
const Missions = await import('../src/missions.js');
const Health = await import('../src/healthindex.js');
const WhatIf = await import('../src/whatif.js');
const Broadcasts = await import('../src/broadcasts.js');
const Deck = await import('../src/deck.js');

const ALICE = 'human:alice';
createUser({ username: 'alice', password: 'alice-pass-1', perms: ['*'], actor: 'system:test' });
createUser({ username: 'bob', password: 'bob-pass-1', perms: ['dashboard.view'], actor: 'system:test' });

// ---------------------------------------------------------------- globe --

test('the globe lights what the record touches, and draws what crossed', () => {
  assert.equal(Globe.overview().totals.countries, 0);
  assert.equal(Globe.homeCountry(), null);
  setSetting('COMPANY_COUNTRY', 'iq');
  assert.equal(Globe.homeCountry(), 'IQ', 'stored however it was typed, read as a code');
  setSetting('COMPANY_COUNTRY', 'Iraq');
  assert.equal(Globe.homeCountry(), null, 'a name is not a code');
  setSetting('COMPANY_COUNTRY', 'IQ');

  addParty({ name: 'Gulf Steel', country: 'AE', actor: ALICE });
  addParty({ name: 'Gulf Steel Two', country: 'AE', actor: ALICE });
  addParty({ name: 'Nowhere Ltd', country: 'XX1', actor: ALICE });
  const ben = addBeneficiary({ name: 'Hamburg Tools', bic: 'DEUTDEFF', country: 'DE', account: '123', actor: ALICE });
  const benId = ben?.id ?? one('SELECT id FROM remit_beneficiary WHERE name = ?', 'Hamburg Tools').id;
  exec('PRAGMA foreign_keys = OFF');
  const msg = (state, amount, n) => exec(`INSERT INTO remit_message (transfer_id, beneficiary_id, format, uetr, currency, amount, charges, value_date, content, screening, state, created_by)
    VALUES (?, ?, 'pacs.008', ?, 'EUR', ?, 'SHA', date('now'), '<x/>', '{}', ?, ?)`, 900 + n, benId, `u-${n}`, amount, state, ALICE);
  msg('released', 1000, 1); msg('approved', 500, 2); msg('cancelled', 9999, 3);
  exec('PRAGMA foreign_keys = ON');

  const g = Globe.overview();
  const ae = g.countries.find((c) => c.code === 'AE');
  const de = g.countries.find((c) => c.code === 'DE');
  assert.equal(ae.parties, 2);
  assert.equal(de.beneficiaries, 1);
  assert.equal(de.payments, 2, 'a cancelled message never crossed');
  assert.equal(de.amounts.EUR, 1500);
  assert.ok(!g.countries.some((c) => c.code.length !== 2), 'a malformed code is not a country');
  assert.deepEqual(g.arcs.map((a) => a.state).sort(), ['approved', 'released']);
  assert.equal(g.totals.released, 1);
  assert.equal(g.home, 'IQ');
});

// ------------------------------------------------------------- missions --

test('a mission step is done when the record says so, and not before', () => {
  setSetting('COMPANY_NAME', '');
  let m = Missions.overview();
  const step = (mid, sid) => m.missions.find((x) => x.id === mid).steps.find((s) => s.id === sid);
  assert.equal(step('foundations', 'name').done, false);
  assert.equal(step('foundations', 'country').done, true, 'set by the globe test');
  assert.equal(step('foundations', 'people').done, true, 'alice and bob');
  assert.equal(step('govern', 'broadcast').done, false);
  setSetting('COMPANY_NAME', 'Alpha');
  Broadcasts.post({ title: 'Hello', actor: ALICE });
  m = Missions.overview();
  assert.equal(step('foundations', 'name').done, true);
  assert.equal(step('govern', 'broadcast').done, true);
  assert.equal(m.done, m.missions.reduce((a, x) => a + x.steps.filter((s) => s.done).length, 0));
  assert.equal(m.pct, Math.round((m.done / m.total) * 100));
  assert.ok(m.next && !m.next.step.done, 'the next step is one not yet done');
  // Undo it in the record and the step is honest about it.
  setSetting('COMPANY_NAME', '');
  m = Missions.overview();
  assert.equal(step('foundations', 'name').done, false);
});

test('every mission step points at a place that exists, behind a permission that exists', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  for (const m of Missions.MISSIONS) {
    for (const s of m.steps) {
      if (s.perm) assert.ok(PERMS.includes(s.perm), `${m.id}/${s.id}: ${s.perm}`);
      const key = s.href.replace(/^#\//, '').split(/[/?]/)[0];
      assert.ok(new RegExp(`\\n\\s+'?${key}'?: \\{ title`).test(app), `${m.id}/${s.id}: no page ${key}`);
    }
  }
});

// --------------------------------------------------------- health index --

test('the health index scores from the record and leaves out what it cannot read', () => {
  const h = Health.compute();
  assert.ok(h.score >= 0 && h.score <= 100);
  const money = h.pillars.find((p) => p.id === 'money');
  assert.equal(money.score, null, 'no bank account and no invoice: no money score, not a perfect one');
  const scored = h.pillars.filter((p) => p.score != null);
  assert.equal(h.score, Math.round(scored.reduce((a, p) => a + p.score, 0) / scored.length));
  // The same record scores the same.
  assert.deepEqual(Health.compute().pillars.map((p) => p.score), h.pillars.map((p) => p.score));
  // An open incident weighs on operations.
  const before = h.pillars.find((p) => p.id === 'operations').score;
  exec("INSERT INTO incidents (sev, title, state, commander) VALUES ('SEV1', 'Down', 'open', 'human:alice')");
  const after = Health.compute().pillars.find((p) => p.id === 'operations').score;
  assert.ok(after < before, `${after} < ${before}`);
  for (const p of h.pillars) for (const r of p.readings) assert.match(r.href, /^#\//);
});

test('one health snapshot a day', () => {
  assert.equal(Health.snapshotToday(), true);
  assert.equal(Health.snapshotToday(), false, 'the second reading today is not kept');
  const ov = Health.overview();
  assert.equal(ov.trend.length, 1);
  assert.ok(ov.trend[0].pillars.operations != null);
});

// -------------------------------------------------------------- what if --

test('what if walks the cash forward by arithmetic', () => {
  const base = { cash: 10000, accounts: 1, revenue: 5000, expenses: 6000, months: [] };
  const flat = WhatIf.simulate({ horizon: 12 }, base);
  assert.equal(flat.curve.length, 12);
  assert.equal(flat.curve[0].cash, 9000);
  assert.equal(flat.summary.runsOutInMonth, 11, '10,000 at −1,000 a month goes below zero in month 11');
  assert.deepEqual(flat.baseCurve, flat.curve.map((c) => c.cash), 'no lever: the scenario is the baseline');

  const better = WhatIf.simulate({ revenuePct: 40, horizon: 12 }, base);
  assert.equal(better.curve[0].net, 1000);
  assert.equal(better.summary.breaksEvenInMonth, 1);
  assert.equal(better.summary.runsOutInMonth, null);

  const hire = WhatIf.simulate({ hires: 2, salary: 1500, oneOff: -2000, horizon: 6 }, base);
  assert.equal(hire.curve[0].expenses, 9000);
  assert.equal(hire.curve[0].cash, 10000 - 2000 + 5000 - 9000);

  const grow = WhatIf.simulate({ growthPct: 10, horizon: 3 }, base);
  assert.equal(grow.curve[2].revenue, 6050);

  assert.throws(() => WhatIf.simulate({ revenuePct: 900 }, base), /between/);
  assert.throws(() => WhatIf.simulate({ hires: 'many' }, base), /number/);
});

test('keeping a scenario is a person\'s act, written down with its baseline', () => {
  assert.throws(() => WhatIf.save({ name: 'x', params: {}, actor: 'agent:AGT-X' }), /person/);
  assert.throws(() => WhatIf.save({ name: '  ', params: {}, actor: ALICE }), /name/);
  const s = WhatIf.save({ name: 'Hire two', params: { hires: 2, salary: 1500 }, actor: ALICE });
  const ov = WhatIf.overview();
  assert.equal(ov.scenarios[0].name, 'Hire two');
  assert.equal(ov.scenarios[0].params.hires, 2);
  assert.ok('cash' in ov.scenarios[0].baseline);
  assert.ok(one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'whatif.saved'").n >= 1);
  WhatIf.remove({ id: s.id, actor: ALICE });
  assert.equal(WhatIf.overview().scenarios.length, 0);
  assert.ok(one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'whatif.removed'").n >= 1);
});

// ----------------------------------------------------------- broadcasts --

test('a broadcast reaches everybody until they have read it', () => {
  assert.throws(() => Broadcasts.post({ title: 'x', actor: 'system:x' }), /person/);
  assert.throws(() => Broadcasts.post({ title: 'x', level: 'loud', actor: ALICE }), /level/);
  assert.throws(() => Broadcasts.post({ title: 'x', days: 400, actor: ALICE }), /90 days/);
  const b = Broadcasts.post({ title: 'Payment run moves to Thursday', level: 'important', days: 3, actor: ALICE });
  assert.ok(b.expires_at);
  assert.ok(!Broadcasts.unread('alice').some((x) => x.id === b.id), 'the author has read what they wrote');
  assert.ok(Broadcasts.unread('bob').some((x) => x.id === b.id));
  Broadcasts.ack({ id: b.id, username: 'bob' });
  Broadcasts.ack({ id: b.id, username: 'bob' });
  assert.ok(!Broadcasts.unread('bob').some((x) => x.id === b.id));
  assert.equal(Broadcasts.get(b.id).readers.length, 2);

  const c = Broadcasts.post({ title: 'Office closed', level: 'critical', actor: ALICE });
  assert.equal(Broadcasts.unread('bob')[0].id, c.id, 'critical first');
  Broadcasts.end({ id: c.id, actor: ALICE });
  assert.ok(!Broadcasts.unread('bob').some((x) => x.id === c.id));
  assert.throws(() => Broadcasts.ack({ id: c.id, username: 'bob' }), /no such live/);
  assert.throws(() => Broadcasts.end({ id: c.id, actor: ALICE }), /no such live/);

  // Expired is over without anybody ending it.
  const d = Broadcasts.post({ title: 'Old news', days: 1, actor: ALICE });
  exec("UPDATE broadcasts SET expires_at = datetime('now','-1 minute') WHERE id = ?", d.id);
  assert.ok(!Broadcasts.unread('bob').some((x) => x.id === d.id));
  assert.equal(Broadcasts.overview().items.find((x) => x.id === d.id).live, 0);
});

// ------------------------------------------------------------- the deck --

test('a person\'s console keeps only what it can use', () => {
  const p = Deck.setPrefs('bob', { pins: ['#/globe', '#/finance', 'javascript:alert(1)', 'https://evil.example', '#/globe'], focus: ['money', 'astrology'] });
  assert.deepEqual(p.pins, ['#/globe', '#/finance']);
  assert.deepEqual(p.focus, ['money']);
  assert.equal(p.onboarded, false);
  Deck.setPrefs('bob', { onboarded: true });
  assert.deepEqual(Deck.getPrefs('bob').pins, ['#/globe', '#/finance'], 'a partial update keeps the rest');
  assert.equal(Deck.getPrefs('bob').onboarded, true);
  assert.throws(() => Deck.setPrefs('bob', { pins: 'everything' }), /list/);
  assert.equal(Deck.getPrefs('carol').pins.length, 0);
  Deck.setPrefs('carol', { pins: Array.from({ length: 30 }, (_, i) => `#/p${i}`) });
  assert.equal(Deck.getPrefs('carol').pins.length, 16);
});

test('the brief is counts from the record, each with a place to go', () => {
  exec("INSERT INTO tasks (title, state, due_date, created_by) VALUES ('Late one', 'todo', date('now','-2 days'), 'human:alice')");
  const b = Deck.brief({ username: 'bob' });
  const overdue = b.lines.find((l) => l.kind === 'overdue');
  assert.ok(overdue && overdue.count >= 1);
  assert.ok(b.lines.every((l) => l.count > 0 && /^#\//.test(l.href)), 'a zero is not a line');
  assert.equal(b.calm, false);
  assert.ok(b.health.pillars.length === 5);
  assert.equal(b.prefs.onboarded, true);
  assert.equal(b.home, 'IQ');
});

// ---------------------------------------------------- catalogue, perms --

test('the five places are catalogued, each in one door, and the right roles hold them', () => {
  const ids = ['globe', 'missions', 'healthindex', 'whatif', 'broadcasts'];
  const cat = sectionCatalog();
  for (const id of ids) {
    assert.ok(cat.find((s) => s.id === id), id);
    assert.equal(SURFACES.filter((s) => s.departments.includes(id)).length, 1, `${id} sits in exactly one door`);
  }
  const observer = expandTemplate('observer');
  for (const p of ['globe.view', 'missions.view', 'healthindex.view', 'whatif.view', 'broadcasts.view']) assert.ok(observer.includes(p), p);
  assert.ok(!observer.includes('whatif.manage'));
  assert.ok(!observer.includes('broadcasts.manage'));
  const operator = expandTemplate('operator');
  assert.ok(operator.includes('whatif.manage') && operator.includes('broadcasts.manage'));
  assert.equal(verifyChain().ok, true);
  assert.ok(q('SELECT * FROM health_snapshots').length >= 1);
});

test('every place the console pins, goes to or cycles through is a page that exists', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const cmd = fs.readFileSync(path.join(root, 'public', 'core', 'command.js'), 'utf8');
  const pages = new Set([...app.matchAll(/\n\s+'?([a-z0-9]+)'?: \{ title/g)].map((m) => m[1]));
  const hrefs = [...cmd.matchAll(/'#\/([a-z0-9]*)'/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(hrefs.length > 15, 'the setup pins, the keys and the wall are all read');
  for (const h of new Set(hrefs)) assert.ok(pages.has(h), `#/${h} is not a page`);
});
