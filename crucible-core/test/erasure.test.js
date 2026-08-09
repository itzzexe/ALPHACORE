// Crypto-shredding, proved on the case that makes it necessary.
//
// The claim under test is a strong one and easy to fake: that a person's data
// can be destroyed inside an append-only, hash-linked log without breaking a
// single hash. So these tests write real personal data into the chain, erase
// the person, and then check three things that must all hold at once:
//
//   1. the plaintext is gone — not hidden, gone, with the master key in hand
//   2. every hash in the chain still verifies
//   3. the fact of the erasure survives, because a promise nobody can check
//      is not a promise
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-erasure.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-erasure.db${s}`)); } catch { /* first run */ }
}

const E = await import('../src/erasure.js');
const { audit, verifyChain } = await import('../src/audit.js');
const { q, one, exec } = await import('../src/db.js');

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

test('a sealed value looks like nothing and reads back exactly', () => {
  const sealed = E.sealPii(ALICE, { kind: 'contact', identifier: ALICE });
  assert.ok(E.isSealed(sealed));
  assert.ok(!sealed.includes('alice'), 'the ciphertext must not carry the plaintext');
  assert.ok(!sealed.includes('example.com'));
  assert.equal(E.openPii(sealed), ALICE);
});

test('the reference is not the identifier, and is stable', () => {
  const ref = E.refFor('contact', ALICE);
  assert.equal(ref, E.refFor('contact', '  ALICE@EXAMPLE.COM  '), 'case and spacing are not different people');
  assert.notEqual(ref, E.refFor('contact', BOB));
  assert.ok(!ref.includes('alice'));
  // Salted per install: the same address elsewhere must not produce the same
  // reference, or two databases could be joined on it.
  const salt = one("SELECT v FROM settings WHERE k = 'PII_SUBJECT_SALT'").v;
  assert.ok(salt && salt.length > 20);
});

test('two people get two keys, and neither can read the other', () => {
  const a = E.sealPii('alice lives here', { kind: 'contact', identifier: ALICE });
  const b = E.sealPii('bob lives there', { kind: 'contact', identifier: BOB });
  assert.notEqual(a.split(':')[2], b.split(':')[2], 'different references');
  assert.equal(E.openPii(a), 'alice lives here');
  assert.equal(E.openPii(b), 'bob lives there');
});

test('personal data goes into the chain sealed, and comes back out', () => {
  audit({
    actorType: 'system', actorId: 'system:intel', action: 'contact.discovered',
    subjectType: 'person', subjectId: E.refFor('contact', ALICE),
    payload: {
      email: E.sealPii(ALICE, { kind: 'contact', identifier: ALICE }),
      phone: E.sealPii('+964 770 000 0000', { kind: 'contact', identifier: ALICE }),
      source: 'a public website',            // not personal, not sealed
    },
  });

  const row = one("SELECT payload FROM audit_log WHERE action = 'contact.discovered'");
  assert.ok(!row.payload.includes('alice@example.com'), 'the chain must never hold the plaintext');
  assert.ok(row.payload.includes('a public website'), 'and must still hold what is not personal');

  const opened = E.openDeep(JSON.parse(row.payload));
  assert.equal(opened.email, ALICE, 'readable while the key exists');
  assert.equal(opened.phone, '+964 770 000 0000');
});

test('a subject access request finds everything held about one person', () => {
  exec("INSERT INTO intel_records (query_id, name, email, phone) VALUES (1, 'Alice Ltd', ?, ?)",
    ALICE, '+964 770 000 0000');
  exec("INSERT INTO intel_records (query_id, name, email) VALUES (1, 'Bob Ltd', ?)", BOB);

  const found = E.findSubject({ identifier: ALICE });
  assert.ok(found.records.length >= 1, 'her row should be found while it is still plaintext');
  assert.ok(found.auditEntries >= 1, 'and the chain entries, found by reference not by scanning');
  assert.equal(found.erasedAt, null);

  // Somebody nobody has heard of is not an error.
  const stranger = E.findSubject({ identifier: 'nobody@nowhere.test' });
  assert.equal(stranger.records.length, 0);
  assert.equal(stranger.known, false);
});

test('erasure requires a human to sign it', () => {
  assert.throws(() => E.eraseSubject({ identifier: ALICE, actor: null }), /human act/);
});

test('erasing destroys the key and leaves the chain whole', () => {
  const before = verifyChain();
  assert.equal(before.ok, true);

  const r = E.eraseSubject({ identifier: ALICE, reason: 'she asked', actor: 'human:owner' });
  assert.ok(r.ok);
  assert.ok(r.sealedBeforeShredding >= 1,
    'anything still in plaintext must be sealed *before* the key dies, or it is readable forever');

  // 1. gone
  const row = one("SELECT payload FROM audit_log WHERE action = 'contact.discovered'");
  const opened = E.openDeep(JSON.parse(row.payload));
  assert.equal(opened.email, '[erased]');
  assert.equal(opened.phone, '[erased]');
  assert.equal(opened.source, 'a public website', 'and the rest of the entry is untouched');

  // 2. the chain still verifies, every hash of it
  const after = verifyChain();
  assert.equal(after.ok, true, 'shredding a key must not break a single hash');
  assert.ok(after.checked > before.checked, 'and the erasure itself was recorded');

  // 3. the fact survives
  const subject = one('SELECT * FROM pii_subjects WHERE ref = ?', r.ref);
  assert.equal(subject.wrapped_key, null, 'the key is destroyed, not archived');
  assert.ok(subject.erased_at);
  assert.equal(subject.erased_by, 'human:owner');
});

test('the erasure record never names the person it erased', () => {
  const entry = one("SELECT payload, subject_id FROM audit_log WHERE action = 'pii.erased'");
  assert.ok(!entry.payload.includes('alice@example.com'),
    'writing "we erased alice@example.com" into an append-only log is a way of not erasing it');
  assert.equal(entry.subject_id, E.refFor('contact', ALICE), 'the reference, which is not reversible');
});

test('the database itself no longer holds her details anywhere', () => {
  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const leaks = [];
  for (const t of tables) {
    const cols = q(`PRAGMA table_info(${t.name})`).map((c) => c.name);
    for (const row of q(`SELECT * FROM ${t.name}`)) {
      for (const c of cols) {
        if (typeof row[c] === 'string' && row[c].toLowerCase().includes('alice@example.com')) {
          leaks.push(`${t.name}.${c}`);
        }
      }
    }
  }
  assert.deepEqual(leaks, [], `her address is still readable in: ${leaks.join(', ')}`);
});

test('bob is untouched — erasure is surgical, not a purge', () => {
  const b = one("SELECT email FROM intel_records WHERE name = 'Bob Ltd'");
  const readable = E.isSealed(b.email) ? E.openPii(b.email) : b.email;
  assert.equal(readable, BOB);
});

test('verifying an erasure checks it rather than asserting it', () => {
  const v = E.verifyErasure({ identifier: ALICE });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.keyDestroyed, true);
  assert.equal(v.chainStillVerifies, true);
  assert.deepEqual(v.leaks, []);

  const notErased = E.verifyErasure({ identifier: BOB });
  assert.equal(notErased.ok, false);
  assert.match(notErased.reason, /has not been erased/);
});

test('data arriving after an erasure is not quietly resurrected', () => {
  // Somebody re-imports the same list next week. Without this, the person is
  // back on file and the erasure was theatre.
  const sealed = E.sealPii(ALICE, { kind: 'contact', identifier: ALICE });
  assert.ok(sealed.endsWith(':erased'), 'no key, so nothing readable can be written');
  assert.equal(E.openPii(sealed), '[erased]');
});

test('erasing twice is not an error and does not change the date', () => {
  const first = one('SELECT erased_at FROM pii_subjects WHERE ref = ?', E.refFor('contact', ALICE)).erased_at;
  const again = E.eraseSubject({ identifier: ALICE, actor: 'human:owner' });
  assert.equal(again.alreadyErased, true);
  assert.equal(one('SELECT erased_at FROM pii_subjects WHERE ref = ?', E.refFor('contact', ALICE)).erased_at, first);
});

test('the overview counts people without naming any of them', () => {
  const o = E.erasureOverview();
  assert.ok(o.known >= 2);
  assert.equal(o.erased, 1);
  assert.ok(o.columnsCovered.includes('intel_records.email'));
  assert.ok(!JSON.stringify(o).includes('alice@example.com'));
  assert.ok(!JSON.stringify(o).includes('bob@example.com'));
});
