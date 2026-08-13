// The books, proved on the cases that decide whether they are books.
//
// Accounting software is easy to write and hard to trust. Anything can add
// numbers into two columns; what makes a ledger worth keeping is what it
// refuses. So most of this file is refusals — the unbalanced entry, the edit to
// a posted line, the entry backdated into a sealed month, the correction that
// tries to happen quietly — because every one of those, allowed once, turns a
// set of books into a set of numbers.
//
// The rest proves the two identities everything else rests on: debits equal
// credits, and assets equal liabilities plus equity. Both are checked after the
// AI bookkeeper has been let loose on real operational rows, not after a
// hand-written example.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-ledger.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-ledger.db${s}`)); } catch { /* first run */ }
}

const L = await import('../src/ledger.js');
const B = await import('../src/bookkeeper.js');
const { q, one, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');

const HUMAN = 'human:owner';
const AGENT = 'agent:AGT-FIN-001';
const refuses = (fn, why) => assert.throws(fn, (e) => { assert.ok(e.message, why); return true; }, why);

test('the chart of accounts seeds, and seeding twice does not duplicate it', () => {
  const first = L.seedChart();
  assert.ok(first >= 20, 'a usable chart has assets, liabilities, equity, revenue and expenses');
  L.seedChart();
  const codes = L.chart().map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length, 'every account code appears once');
  for (const a of L.chart()) {
    assert.ok(['debit', 'credit'].includes(a.normal_side), `${a.code} knows which side increases it`);
  }
});

test('an entry that does not balance is refused', () => {
  refuses(
    () => L.journalEntry({ memo: 'off by ten', actor: HUMAN, lines: [{ account: '1000', debit: 100 }, { account: '4000', credit: 90 }] }),
    'the single rule the whole system exists to enforce',
  );
});

test('a line cannot be both a debit and a credit, and cannot be negative', () => {
  refuses(() => L.journalEntry({
    memo: 'both sides', actor: HUMAN,
    lines: [{ account: '1000', debit: 5, credit: 5 }, { account: '4000', credit: 5 }],
  }), 'a line with both sides is two lines pretending to be one');
  refuses(() => L.journalEntry({
    memo: 'negative', actor: HUMAN,
    lines: [{ account: '1000', debit: -100 }, { account: '4000', credit: -100 }],
  }), 'negatives balance arithmetically and destroy the meaning of a side');
});

test('an entry needs an account that exists, a memo, an author, and two lines', () => {
  refuses(() => L.journalEntry({ memo: 'x', actor: HUMAN, lines: [{ account: '9999', debit: 10 }, { account: '4000', credit: 10 }] }), 'no such account');
  refuses(() => L.journalEntry({ actor: HUMAN, lines: [{ account: '1000', debit: 10 }, { account: '4000', credit: 10 }] }), 'a number nobody can explain');
  refuses(() => L.journalEntry({ memo: 'x', lines: [{ account: '1000', debit: 10 }, { account: '4000', credit: 10 }] }), 'unsigned');
  refuses(() => L.journalEntry({ memo: 'x', actor: HUMAN, lines: [{ account: '1000', debit: 10 }] }), 'one line is not an entry');
});

test('a balanced entry posts, and the trial balance says so', () => {
  L.journalEntry({
    date: '2026-03-01', memo: 'Owner capital', actor: HUMAN, post: true,
    lines: [{ account: '1000', debit: 50000 }, { account: '3000', credit: 50000 }],
  });
  const tb = L.trialBalance({ period: '2026-03' });
  assert.ok(tb.balances, `debits and credits must agree, out by ${tb.difference}`);
  assert.equal(tb.debits, tb.credits);
});

test('the database itself refuses to edit or gut a posted entry', () => {
  const j = one("SELECT id FROM journal WHERE state = 'posted' ORDER BY id LIMIT 1");
  // Not the application — the database. Anything holding a connection, including
  // a future version of this code written by somebody in a hurry, hits this.
  refuses(() => exec('UPDATE journal_lines SET amount = 999999 WHERE journal_id = ?', j.id), 'an edit to evidence');
  refuses(() => exec('DELETE FROM journal_lines WHERE journal_id = ?', j.id), 'evidence losing a line');
  const still = one('SELECT SUM(amount) AS t FROM journal_lines WHERE journal_id = ?', j.id).t;
  assert.equal(still, 100000, 'both lines intact at their original amounts');
});

test('a correction is a reversal, it needs a reason, and the pair nets to nothing', () => {
  const e = L.journalEntry({
    date: '2026-03-02', memo: 'Wrong customer', actor: HUMAN, post: true,
    lines: [{ account: '1100', debit: 700 }, { account: '4000', credit: 700 }],
  });
  refuses(() => L.reverseEntry({ id: e.id, actor: HUMAN }), 'a reversal without a reason is an edit in disguise');

  const before = L.trialBalance({ period: '2026-03' }).debits;
  const rev = L.reverseEntry({ id: e.id, actor: HUMAN, reason: 'billed the wrong customer' });
  // Still posted — a reversal marks an entry, it does not remove it from the
  // books. Dropping it while keeping the reversal is the classic way to be
  // wrong by exactly the correction.
  const orig = one('SELECT state, reversed_by_id, reversal_reason FROM journal WHERE id = ?', e.id);
  assert.equal(orig.state, 'posted', 'the original stays in the books');
  assert.ok(orig.reversed_by_id, 'marked as reversed');
  assert.ok(orig.reversal_reason, 'and the reason is on the record');
  assert.ok(one('SELECT id FROM journal WHERE ref = ?', rev.by), 'the reversal is its own entry');

  // The reversal is dated today, not backdated over the original — a correction
  // belongs to the period in which somebody noticed, and backdating it would
  // silently change a month that may already have been reported.
  assert.equal(one('SELECT period FROM journal WHERE ref = ?', rev.by).period, L.periodOf());
  // The original still stands in its own month: that is the point of a reversal.
  assert.equal(L.trialBalance({ period: '2026-03' }).debits, before, 'March is unchanged by a correction made in August');
  // Across all time the two cancel, which is what "corrected" means.
  assert.equal(L.ledgerFor({ account: '1100' }).balance, 0, 'the mistake and its correction cancel in the account');
});

test('a closed period cannot be posted into, and reopening is recorded with a reason', () => {
  L.closePeriod({ period: '2026-03', actor: HUMAN });
  refuses(() => L.journalEntry({
    date: '2026-03-30', memo: 'sneaking one in', actor: HUMAN, post: true,
    lines: [{ account: '1000', debit: 1 }, { account: '4000', credit: 1 }],
  }), 'backdating into a sealed month is how last quarter changes quietly');

  refuses(() => L.reopenPeriod({ period: '2026-03', actor: HUMAN }), 'reopening without a reason');
  L.reopenPeriod({ period: '2026-03', actor: HUMAN, reason: 'a supplier invoice arrived late' });
  const p = one('SELECT * FROM fiscal_periods WHERE period = ?', '2026-03');
  assert.equal(p.state, 'open');
  assert.ok(p.reopen_reason, 'the reason survives, so a reopening can be questioned later');
  assert.ok(p.reopened_by, 'and so can the person who did it');
});

test('the AI bookkeeper turns real events into entries, and running twice does not double-book', () => {
  const w = exec(
    "INSERT INTO wallets (label, chain, asset, address, created_by) VALUES ('Ops','base','USDC','0xdead',?)", HUMAN,
  ).lastInsertRowid;
  exec(`INSERT INTO invoices (ref, wallet_id, description, amount, asset, chain, state, paid_amount, paid_at, created_by, created_at)
        VALUES ('INV-100',?,'Northwind retainer',4200,'USDC','base','paid',4200,datetime('now'),?,datetime('now'))`, w, HUMAN);
  exec(`INSERT INTO invoices (ref, wallet_id, description, amount, asset, chain, state, created_by, created_at)
        VALUES ('INV-101',?,'Contoso pilot',900,'USDC','base','sent',?,datetime('now'))`, w, HUMAN);
  exec(`INSERT INTO payouts (to_address, chain, asset, amount, reason, state, created_by, created_at)
        VALUES ('0xabc','base','USDC',120,'Contractor','settled',?,datetime('now'))`, HUMAN);
  for (let i = 0; i < 40; i += 1) {
    exec("INSERT INTO model_calls (provider, model, cost_usd, created_at) VALUES ('anthropic','claude-opus-5',1.37,datetime('now'))");
  }

  const first = B.bookkeep({ actor: AGENT });
  assert.equal(first.problems.length, 0, `nothing should fail to book: ${JSON.stringify(first.problems)}`);
  assert.ok(first.made.length >= 4, 'invoice raised, invoice paid, payout, model spend');

  const again = B.bookkeep({ actor: AGENT });
  assert.equal(again.made.length, 0, 'a restart must not post the whole month a second time');

  const tb = L.trialBalance({});
  assert.ok(tb.balances, `after the agent has written the month, out by ${tb.difference}`);
  const bs = L.balanceSheet({});
  assert.ok(bs.balances, `assets must equal liabilities plus equity, out by ${bs.difference}`);
});

test('an AI employee may not post above its limit — it drafts and waits for a person', () => {
  
  setSetting('BOOKKEEPER_LIMIT_USD', '100', HUMAN);
  const w = one('SELECT id FROM wallets LIMIT 1').id;
  exec(`INSERT INTO invoices (ref, wallet_id, description, amount, asset, chain, state, created_by, created_at)
        VALUES ('INV-BIG',?,'Large deal',75000,'USDC','base','sent',?,datetime('now'))`, w, HUMAN);

  const r = B.bookkeep({ actor: AGENT });
  const big = r.made.find((m) => /INV-BIG/.test(m.what));
  assert.ok(big, 'the entry is written');
  assert.ok(big.waiting, 'but not posted — that is the whole control');

  const je = one("SELECT state, created_by, posted_by FROM journal WHERE ref = ?", big.ref);
  assert.equal(je.state, 'draft');
  assert.equal(je.posted_by, null, 'nobody has signed it');
  assert.ok(je.created_by.startsWith('agent:'), 'and it is visibly an agent that drafted it');

  // A person posts it, and now the record names them rather than the agent.
  L.postEntry({ id: one('SELECT id FROM journal WHERE ref = ?', big.ref).id, actor: HUMAN });
  assert.equal(one('SELECT posted_by FROM journal WHERE ref = ?', big.ref).posted_by, HUMAN);
  assert.ok(L.trialBalance({}).balances, 'and the books still balance after a human posting');
});

test('the controller notices an entry that should exist and does not', () => {
  const w = one('SELECT id FROM wallets LIMIT 1').id;
  // An invoice that the bookkeeper never sees, because somebody marked it
  // recorded without recording it — the exact shape of a real reconciliation break.
  exec(`INSERT INTO invoices (ref, wallet_id, description, amount, asset, chain, state, created_by, created_at)
        VALUES ('INV-GHOST',?,'Never booked',3300,'USDC','base','sent',?,datetime('now'))`, w, HUMAN);
  const id = one("SELECT id FROM invoices WHERE ref = 'INV-GHOST'").id;
  exec("INSERT INTO ledger_marks (source, source_id, journal_id) VALUES ('invoice.issued', ?, NULL)", String(id));

  B.bookkeep({ actor: AGENT });
  const rc = B.reconcile({});
  assert.equal(rc.ok, false, 'a ledger that only checks itself is not reconciled');
  const gap = rc.findings.find((f) => /invoiced revenue does not match/.test(f.what));
  assert.ok(gap, 'the break is named');
  // The ghost invoice plus the large one still sitting in draft: the reconciler
  // counts what is posted, and a draft is not posted.
  const drafted = one("SELECT COALESCE(SUM(total), 0) AS t FROM journal WHERE state = 'draft' AND source = 'invoice.issued'").t;
  assert.ok(
    Math.abs((gap.operational - gap.ledger) - (3300 + drafted)) < 0.02,
    `off by the invoice nobody booked plus what is still waiting: ${gap.operational - gap.ledger} against ${3300 + drafted}`,
  );
});

test('the close refuses to happen over a difference, and says why', () => {
  const period = L.periodOf();
  // Leave a draft on the floor: an unposted entry means the month is not done.
  L.journalEntry({
    memo: 'Waiting on approval', actor: AGENT,
    lines: [{ account: '5100', debit: 40 }, { account: '2000', credit: 40 }],
  });
  const r = B.closeMonth({ period, actor: HUMAN });
  assert.equal(r.ok, false, 'a month with an unposted entry is not closed');
  assert.ok(r.blocking.length, 'and the reason is on the return, not in a log');
  assert.equal(one('SELECT state FROM fiscal_periods WHERE period = ?', period)?.state || 'open', 'open');
});

test('the statements agree with each other', () => {
  const period = L.periodOf();
  const is = L.incomeStatement({ period });
  const bs = L.balanceSheet({});
  const tb = L.trialBalance({ period });
  assert.ok(tb.balances, 'trial balance');
  assert.ok(bs.balances, 'balance sheet');
  assert.equal(
    Math.round((is.totalRevenue - is.totalExpenses) * 100) / 100,
    Math.round(is.net * 100) / 100,
    'the income statement adds up on its own terms',
  );
  const cf = L.cashFlow({ period });
  const cash = L.ledgerFor({ account: '1000', period }).balance + L.ledgerFor({ account: '1010', period }).balance;
  assert.ok(Math.abs(cf.net - cash) < 0.02, 'cash movement equals the change in the cash accounts');
});

test('every entry names who made it, and agent entries are distinguishable from human ones', () => {
  const rows = q('SELECT created_by, posted_by, state FROM journal');
  assert.ok(rows.length > 5);
  for (const r of rows) {
    assert.ok(/^(human|agent|system):/.test(r.created_by), `an author has a kind: ${r.created_by}`);
    if (r.state === 'posted') assert.ok(r.posted_by, 'a posted entry names who posted it');
  }
  assert.ok(rows.some((r) => r.created_by.startsWith('agent:')), 'agents really did write to the books');
  assert.ok(rows.some((r) => r.created_by.startsWith('human:')), 'and so did people');
});
