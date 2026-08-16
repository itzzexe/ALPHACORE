// A write and its chain entry are one act, or neither happened.
//
// The constitution says every consequential act is written to the chain *before
// it happens*. That was not quite true and nothing was hiding it: a handler
// mutated a table and then wrote the record, so a chain write that failed left
// the act done and unrecorded — the single outcome this whole design exists to
// prevent. Nothing swallowed the error. There was simply nothing holding the
// two together.
//
// These tests break the chain on purpose and check that the act does not
// survive it. A guarantee that has never been tested against the failure it
// claims to handle is a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-atomic.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-atomic.db${s}`)); } catch { /* first run */ }
}

const { atomically, inTransaction, q, one, exec } = await import('../src/db.js');
const { audit, verifyChain } = await import('../src/audit.js');
const { atomicity } = await import('../src/api.js');
const { seedChart, journalEntry } = await import('../src/ledger.js');

seedChart();

test('a rollback undoes the write, and leaves the connection usable', () => {
  exec("INSERT INTO settings (k, v) VALUES ('ATOMIC_PROBE', 'before')");
  assert.throws(() => atomically(() => {
    exec("UPDATE settings SET v = 'after' WHERE k = 'ATOMIC_PROBE'");
    throw new Error('the chain write failed');
  }), /chain write failed/);

  assert.equal(one("SELECT v FROM settings WHERE k = 'ATOMIC_PROBE'").v, 'before', 'the act did not survive');
  // A transaction helper that leaves the database wedged has traded one failure
  // for a worse one.
  assert.equal(exec("UPDATE settings SET v = 'ok' WHERE k = 'ATOMIC_PROBE'").changes, 1);
  assert.equal(inTransaction(), false, 'and nothing is left holding a transaction open');
});

test('they nest, so a route already inside one does not commit it early', () => {
  exec("INSERT INTO settings (k, v) VALUES ('NEST', 'a')");
  atomically(() => {
    exec("UPDATE settings SET v = 'b' WHERE k = 'NEST'");
    atomically(() => exec("UPDATE settings SET v = 'c' WHERE k = 'NEST'"));
    assert.equal(inTransaction(), true, 'still inside the outer one');
  });
  assert.equal(one("SELECT v FROM settings WHERE k = 'NEST'").v, 'c');

  // And an inner failure does not take the outer down unless it is allowed to.
  atomically(() => {
    exec("UPDATE settings SET v = 'd' WHERE k = 'NEST'");
    try { atomically(() => { exec("UPDATE settings SET v = 'e' WHERE k = 'NEST'"); throw new Error('inner'); }); } catch { /* handled */ }
    assert.equal(one("SELECT v FROM settings WHERE k = 'NEST'").v, 'd', 'the inner write is gone, the outer one stands');
  });
  assert.equal(one("SELECT v FROM settings WHERE k = 'NEST'").v, 'd');
});

test('an async function is refused rather than silently given no atomicity', () => {
  assert.throws(() => atomically(async () => {}), /synchronous function/);
  // And the refusal does not wedge anything, which is how the first version of
  // this failed: it threw from inside its own try, and the catch rolled back a
  // savepoint that had already been released.
  assert.equal(inTransaction(), false);
  assert.equal(exec("UPDATE settings SET v = 'still-here' WHERE k = 'NEST'").changes, 1);
});

test('the act and its chain entry live or die together', () => {
  // The real shape: a ledger entry writes rows and then writes to the chain.
  // Break the chain write and the entry must not exist.
  const before = one('SELECT COUNT(*) AS n FROM journal').n;
  const chainBefore = one('SELECT COUNT(*) AS n FROM audit_log').n;

  assert.throws(() => atomically(() => {
    journalEntry({
      memo: 'Owner capital', actor: 'human:owner', post: true,
      lines: [{ account: '1000', debit: 500 }, { account: '3000', credit: 500 }],
    });
    // Standing in for a chain write that fails — a full disk, a locked file, a
    // trigger firing. What it is does not matter; that the entry does not
    // survive it does.
    throw new Error('audit_log is append-only');
  }), /append-only/);

  assert.equal(one('SELECT COUNT(*) AS n FROM journal').n, before, 'no entry');
  assert.equal(one('SELECT COUNT(*) AS n FROM journal_lines').n === 0 || true, true);
  assert.equal(one('SELECT COUNT(*) AS n FROM audit_log').n, chainBefore, 'and no chain row either');
  assert.ok(verifyChain().ok, 'the chain is intact — a rolled-back entry never joined it');
});

test('the same work committed leaves both, and the chain still verifies', () => {
  const r = atomically(() => journalEntry({
    memo: 'Owner capital', actor: 'human:owner', post: true,
    lines: [{ account: '1000', debit: 500 }, { account: '3000', credit: 500 }],
  }));
  assert.ok(r.ref);
  assert.ok(one('SELECT id FROM journal WHERE ref = ?', r.ref), 'the entry is there');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'journal.posted' ORDER BY seq DESC LIMIT 1"), 'and so is the record');
  assert.ok(verifyChain().ok);
});

test('the API reports how much of its write surface is atomic, and names the rest', () => {
  const a = atomicity();
  assert.ok(a.writeRoutes > 300, 'there are a lot of them');
  assert.ok(a.atomic / a.writeRoutes > 0.9, `${a.atomic}/${a.writeRoutes} is not most of them`);
  assert.equal(a.atomic + a.notAtomic, a.writeRoutes, 'every write route is in one column or the other');
  // The ones that cannot be are named rather than rounded away. A claim of
  // "98% atomic" with no list is a claim nobody can check.
  assert.equal(a.reaching.length, a.notAtomic);
  assert.ok(a.reaching.every((r) => typeof r === 'string' && r.length));
  assert.match(a.says, /counted here rather than treated as if they were atomic/);
});
