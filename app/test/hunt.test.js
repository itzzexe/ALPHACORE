// The hunt, tested on the two things that could make it worthless.
//
// A deep search has one interesting failure mode and one dangerous one. The
// interesting one is stopping too early — giving up on round two when the lead
// was right there. The dangerous one is not stopping at all: a loop that keeps
// going until it produces *something* will eventually produce something wrong,
// and here that something becomes a journal entry, an email, or a decision.
//
// So these check both directions. It must follow what it learns rather than
// re-asking the question in different words; and when it does not find the
// answer it must say so, with what it tried, rather than offering a guess.
//
// Also checked: that "searches everywhere" is true — including the tables
// nobody thought to register — and that "everywhere" stops at the secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-hunt.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-hunt.db${s}`)); } catch { /* first run */ }
}

const H = await import('../src/hunt.js');
const { q, one, exec } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');

const HUMAN = 'human:owner';

// A fact planted in an ordinary operational table, reachable only by looking
// there — which is the whole claim.
const w = exec("INSERT INTO wallets (label, chain, asset, address, created_by) VALUES ('Ops','base','USDC','0xdead',?)", HUMAN).lastInsertRowid;
exec(`INSERT INTO invoices (ref, wallet_id, description, amount, asset, chain, state, created_by, created_at)
      VALUES ('INV-770',?,'Northwind Traders — Q3 retainer',4200,'USDC','base','sent',?,datetime('now'))`, w, HUMAN);

test('one pass reaches every table, not a hand-registered list of them', () => {
  const r = H.lookup('Northwind');
  assert.ok(r.tablesSearched > 100, `a company this size has more than a search box: ${r.tablesSearched} tables`);
  const hit = r.hits.find((h) => h.where === 'invoices');
  assert.ok(hit, 'the invoice is found without anybody registering the invoices table');
  assert.equal(hit.matched, 'description', 'and it says which column matched, so the hit can be judged');
});

test('everywhere stops at the secrets', () => {
  // Something that would match, planted in a table that must never be read
  // from. Inserted for real and asserted for real — a guard test that quietly
  // fails to plant its bait proves nothing while looking like it passed.
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES ('Northwind-token-xyz', 1, datetime('now','+1 day'))");
  assert.ok(one("SELECT token FROM sessions WHERE token LIKE '%Northwind%'"), 'the bait is really there');

  const r = H.lookup('Northwind');
  for (const h of r.hits) {
    assert.ok(
      !['sessions', 'secrets', 'api_keys', 'users', 'vault_items'].includes(h.where),
      `a search that reads ${h.where} is a credential leak with a progress bar`,
    );
  }
  // And no column that holds a hash, a key or ciphertext is ever the reason a
  // row was returned.
  for (const h of r.hits) {
    assert.ok(!/secret|password|token|hash|key/i.test(h.matched || ''), `matched on ${h.matched}`);
  }
});

test('an empty question is refused, and so is an unsigned hunt', async () => {
  await assert.rejects(() => H.hunt({ question: '   ', actor: HUMAN }), /needs a question/);
  await assert.rejects(() => H.hunt({ question: 'anything' }), /signed/);
});

test('it follows what it learns instead of re-asking the question', async () => {
  const r = await H.hunt({ question: 'Who is Northwind Traders and what do they owe us?', actor: HUMAN, allowWeb: false, rounds: 4 });
  assert.ok(r.rounds >= 2, 'a hunt that stops at round one is a search box');
  const later = r.trail[1].queries;
  assert.ok(later.length, 'round two asked something');
  assert.ok(
    !later.some((t) => t.toLowerCase() === r.question.toLowerCase()),
    'and it was not the same question again — a rewording is not a lead',
  );
  // The new terms came out of the evidence, so they are things the first round
  // did not know to ask.
  assert.ok(r.queriesTried.length > 1);
  assert.equal(new Set(r.queriesTried.map((t) => t.toLowerCase())).size, r.queriesTried.length, 'nothing asked twice');
});

test('when it does not find the answer it says so, and never offers a guess', async () => {
  const r = await H.hunt({ question: 'What is the registered office address of a company we have never dealt with?', actor: HUMAN, allowWeb: false, rounds: 3 });
  assert.equal(r.found, false);
  assert.equal(r.answer, null, 'no answer means no answer — not a best effort');
  assert.equal(r.confidence, 0);
  assert.match(r.say, /Not found/);
  assert.match(r.say, /round/, 'it says how hard it looked');
  assert.ok(r.stopped, 'and why it stopped');
  assert.ok(r.sourcesAsked.length >= 4, 'across everything it can reach');
});

test('it stops — a loop that can spend money has to have a floor', async () => {
  const r = await H.hunt({ question: 'Northwind', actor: HUMAN, allowWeb: false, rounds: 2 });
  assert.ok(r.rounds <= 2, 'the ceiling holds');
  const cheap = await H.hunt({ question: 'Northwind Traders retainer', actor: HUMAN, allowWeb: false, rounds: 8, maxUsd: 0 });
  assert.ok(cheap.rounds <= 1, 'a zero budget buys one round of judgement and no more');
  assert.match(cheap.stopped, /cap|cold|lead/, `stopped for a stated reason: ${cheap.stopped}`);
});

test('every hunt is on the record — the question, the rounds, and the cost', async () => {
  const r = await H.hunt({ question: 'Where is the Q3 retainer recorded?', actor: HUMAN, allowWeb: false, rounds: 2 });
  const stored = one('SELECT * FROM hunts WHERE id = ?', r.id);
  assert.ok(stored, 'the hunt itself');
  assert.equal(stored.asked_by, HUMAN, 'named to a person, not to the system');
  assert.ok(['found', 'not-found'].includes(stored.state), `finished cleanly, not left running: ${stored.state}`);
  assert.ok(stored.stopped, 'with the reason in words');
  const rounds = q('SELECT * FROM hunt_rounds WHERE hunt_id = ? ORDER BY round', r.id);
  assert.equal(rounds.length, r.rounds, 'every round kept');
  assert.ok(rounds.every((x) => x.queries), 'each with what it asked, so nobody repeats it next week');

  const audited = one("SELECT * FROM audit_log WHERE action = 'hunt.finished' AND subject_id = ? ORDER BY seq DESC LIMIT 1", String(r.id));
  assert.ok(audited, 'and on the chain');
  assert.ok(verifyChain().ok, 'which still verifies');
});

test('the detail view returns the trail, and asking for a hunt that never ran fails cleanly', () => {
  const first = huntsFirstId();
  const d = H.huntDetail(first);
  assert.ok(d.question);
  assert.ok(Array.isArray(d.rounds));
  assert.throws(() => H.huntDetail(999999), /no such hunt/);
});

function huntsFirstId() {
  return one('SELECT id FROM hunts ORDER BY id LIMIT 1').id;
}

test('the overview is honest about the rate, including when it is bad', () => {
  const o = H.huntOverview();
  assert.ok(o.total > 0);
  assert.equal(typeof o.foundRate, 'number');
  assert.ok(o.sources.some((s) => s.reachesOutside), 'it says which sources leave the building');
  assert.ok(o.sources.some((s) => !s.reachesOutside));
  assert.ok(o.tablesSearched > 100);
});
