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

  // She also wrote to support. The address is what a request names; what she
  // wrote is about her just as much, and is reached because it sits on the row
  // the address matched.
  exec("INSERT INTO tickets (customer, category, subject, body) VALUES (?,?,?,?)",
    ALICE, 'billing', 'Please close my account', 'My name is Alice and I live at 5 Rose Lane.');

  const found = E.findSubject({ identifier: ALICE });
  const cols = found.records.map((r) => `${r.table}.${r.column}`);
  assert.ok(cols.includes('tickets.customer'), 'the address she wrote from');
  assert.ok(cols.includes('tickets.body'), 'and the message it arrived on');
  assert.ok(found.records.find((r) => r.column === 'tickets.body'.split('.')[1])?.carried,
    'the body is carried, not matched — a paragraph never equals an email address');
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
        const v = typeof row[c] === 'string' ? row[c].toLowerCase() : '';
        // Her address, and the things she said that were only reachable by
        // following the row it appeared on.
        if (v.includes('alice@example.com') || v.includes('5 rose lane') || v.includes('my name is alice')) {
          leaks.push(`${t.name}.${c}`);
        }
      }
    }
  }
  assert.deepEqual(leaks, [], `still readable in: ${leaks.join(', ')}`);
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
  assert.ok(o.columnsCarried.includes('calls.recording'),
    'and says plainly which columns are only reached by following a row');
  assert.ok(!JSON.stringify(o).includes('alice@example.com'));
  assert.ok(!JSON.stringify(o).includes('bob@example.com'));
});

// The contact centre was the worst of it. A phone number is what an erasure
// request names; a recording of somebody's voice is the most sensitive thing
// this company can hold about them, and it was surviving untouched because it
// is not equal to a phone number and nothing followed the row.
const CALLER = '+964 771 234 5678';

test('a caller is a person on file, recording and all', () => {
  exec(`INSERT INTO calls (direction, from_number, to_number, state, transcript, recording, created_by)
        VALUES ('in', ?, '+964 780 000 0000', 'completed', ?, ?, 'inbound')`,
  CALLER, 'He said his name is Karim and he lives at 12 Palm Street.', 'BASE64AUDIOOFHISVOICE');
  exec(`INSERT INTO sms_messages (direction, channel, from_number, to_number, body, state, thread_key)
        VALUES ('in', 'sms', ?, '+964 780 000 0000', ?, 'received', 'thread-1')`,
  CALLER, 'Please delete everything you hold about me.');

  const found = E.findSubject({ identifier: CALLER });
  const cols = found.records.map((r) => `${r.table}.${r.column}`);
  assert.ok(cols.includes('calls.from_number'), 'the number he rang from');
  assert.ok(cols.includes('calls.transcript'), 'what he said');
  assert.ok(cols.includes('calls.recording'), 'and his voice');
  assert.ok(cols.includes('sms_messages.body'));
});

test('erasing him takes the recording with it, and the chain still verifies', () => {
  const before = verifyChain();
  const r = E.eraseSubject({ identifier: CALLER, reason: 'he asked, on the recording', actor: 'human:owner' });
  assert.ok(r.ok);
  assert.ok(r.sealedBeforeShredding >= 4, 'number, transcript, recording, message');

  const call = one('SELECT * FROM calls ORDER BY rowid DESC LIMIT 1');
  assert.equal(E.openPii(call.transcript), '[erased]');
  assert.equal(E.openPii(call.recording), '[erased]');
  assert.equal(E.openPii(call.from_number), '[erased]');
  assert.equal(call.to_number, '+964 780 000 0000', 'our own number is not his personal data');
  assert.equal(call.direction, 'in', 'and the fact that a call happened survives');

  const sms = one('SELECT * FROM sms_messages ORDER BY rowid DESC LIMIT 1');
  assert.equal(E.openPii(sms.body), '[erased]');

  assert.equal(verifyChain().ok, true, 'shredding his key must not break a hash');
  assert.ok(verifyChain().checked > before.checked);
});

test('nothing he said is readable anywhere in the database', () => {
  const needles = ['771 234 5678', 'karim', '12 palm street', 'base64audioofhisvoice'];
  const leaks = [];
  for (const t of q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    const cols = q(`PRAGMA table_info(${t.name})`).map((c) => c.name);
    for (const row of q(`SELECT * FROM ${t.name}`)) {
      for (const c of cols) {
        const v = typeof row[c] === 'string' ? row[c].toLowerCase() : '';
        if (needles.some((n) => v.includes(n))) leaks.push(`${t.name}.${c}`);
      }
    }
  }
  assert.deepEqual(leaks, [], `still readable in: ${leaks.join(', ')}`);
});

test('a customer is somebody, and can be forgotten', () => {
  // Customers were reachable by no route at all. A review put the reasoning
  // behind that plainly enough to fix: "the customer's name is not an
  // identifier" is not true in general — for a sole trader it is the only
  // identifier on the row.
  exec(`INSERT INTO customers (name, company, plan, mrr_usd, state, notes)
        VALUES ('Layla Haddad','Haddad Consulting','pro',900,'active','prefers a call on Tuesdays')`);

  const found = E.findSubject({ kind: 'contact', identifier: 'Layla Haddad' });
  assert.ok(found.records.length, 'she is findable at all, which she was not before');

  E.eraseSubject({ kind: 'contact', identifier: 'Layla Haddad', reason: 'she asked', actor: 'human:test' });
  const row = one("SELECT name, company, notes FROM customers WHERE name IS NOT NULL ORDER BY id DESC LIMIT 1");
  assert.ok(String(row.name).startsWith('pii:'), 'the name is sealed');
  // A note about somebody is about them.
  assert.ok(String(row.notes).startsWith('pii:'), 'and so is the note');
  assert.ok(verifyChain().ok);
});

test('erasing somebody takes their name with them', async () => {
  const { createPerson } = await import('../src/core2/identity.js');
  const p = createPerson({ displayName: 'Omar Nasser', personalEmail: 'omar-erase@example.com', actor: 'human:test' });
  assert.equal(one('SELECT display_name FROM hr_person WHERE id = ?', p.id).display_name, 'Omar Nasser');

  E.eraseSubject({ kind: 'contact', identifier: 'omar-erase@example.com', reason: 'he asked', actor: 'human:test' });
  const after = one('SELECT display_name FROM hr_person WHERE id = ?', p.id).display_name;
  assert.ok(String(after).startsWith('pii:'), 'erasing somebody while leaving their name readable is not erasing them');
  assert.equal(E.openPii(after), '[erased]');
  assert.ok(verifyChain().ok);
});

test('a name counts as personal on a table about people, and not on one about products', async () => {
  const { rebuild, coverage } = await import('../src/datagov.js');
  rebuild({ actor: 'system:test' });

  const personal = (t, c) => one('SELECT personal FROM data_inventory WHERE table_name = ? AND column_name = ?', t, c)?.personal;
  // `subject_ref` is the schema saying "this table is about people", so the
  // rule is read from the schema rather than from somebody's list.
  assert.equal(personal('customers', 'name'), 1, 'a customer may be a person');
  assert.equal(personal('hr_person', 'display_name'), 1);
  assert.equal(personal('products', 'name'), 0, 'a product is not');
  assert.equal(personal('assets', 'name'), 0);
  // A foreign key points at a name; it is not one.
  assert.notEqual(personal('customers', 'product_id'), 1);

  const cov = coverage();
  assert.equal(cov.sealedButUnerasable, 0, 'nothing is sealed under a key erasure cannot reach');
  assert.ok(cov.gap >= 0 && cov.gap < cov.personal, 'and the gap is a number rather than a claim');
});
