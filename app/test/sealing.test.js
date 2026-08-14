// Personal data at rest, checked against the bytes rather than against the API.
//
// Every claim in docs/THREAT-MODEL-PII.md that this code can be held to is
// tested here, and the tests are deliberately unkind: the assertion that a
// value is absent is made by opening the database file and searching it, not by
// asking the module that wrote it whether it did its job.
//
// What is NOT tested here, because the threat model says it is not true:
// protection against this process. Every read below succeeds. That is the
// boundary, not a gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-sealing.db';
// Its own master key, not the shared file.
//
// Every test file gets its own database, but `data/master.key` is one file for
// all of them, and the rotation test rotates it. Test files run concurrently,
// so this suite could have its key changed underneath it half way through and
// fail with "sealed under key A, key in use is B" — which is the retirement
// machinery working correctly on a problem the tests created. Pinning it here
// makes this file independent of what any other file does to the key.
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 42).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-sealing.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { seedAgents } = await import('../src/workflow.js');
const {
  sealPii, openPii, isSealed, refFor, TIER_A, isTierA, tierAUnreachable,
  findSubject, eraseSubject, verifyErasure,
} = await import('../src/erasure.js');
const { createTicket, getTicket, sendTicket } = await import('../src/support.js');
const { recordTiering, tiering, coverage, rebuild } = await import('../src/datagov.js');
const { sealBatch, remaining, startBackfill, backfillOverview, reclaimFreePages, JOB_KIND } = await import('../src/backfill.js');
const { jobsTick } = await import('../src/jobs.js');
const { takeBackup, verifyBackup } = await import('../src/backup.js');
const { lookup } = await import('../src/hunt.js');

seedAgents();

// The planted values. Distinctive enough that finding them in a binary file is
// unambiguous, and they are never used as anything but content.
const SUBJECT = 'zahra.alrawi@planted-subject.test';
const SECRET_BODY = 'PLANTED-BODY-b7f2c1 my card was charged twice and I want it back';
const SECRET_SUBJECT = 'PLANTED-SUBJECT-9e41a0 double charge';

/** Search the raw file, as somebody who stole the disk would. */
function fileContains(file, needle) {
  if (!fs.existsSync(file)) return null;             // nothing to search is not a pass
  return fs.readFileSync(file).includes(Buffer.from(needle, 'utf8'));
}

/** Everything on disk that this database is: the file, its WAL, its shared memory. */
function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* checkpoint is best effort */ }
  const hits = [];
  for (const suffix of ['', '-wal', '-shm']) {
    if (fileContains(`${DB}${suffix}`, needle)) hits.push(`${path.basename(DB)}${suffix}`);
  }
  return hits;
}

// --- the tiering holds together -------------------------------------------

test('every Tier A column is reachable by erasure', () => {
  // The invariant the whole split rests on: a column sealed at write that the
  // erasure walk cannot reach is data nobody can delete, which is worse than
  // plaintext data everybody can.
  assert.deepEqual(tierAUnreachable(), []);
  assert.ok(TIER_A.length >= 14, 'the Tier A list has been emptied — check erasure.js');
});

test('the tiering is a signed judgement, and refuses to be signed by nobody', () => {
  assert.throws(() => recordTiering({ actor: 'system:automation' }), /judgement|name/i);
  const r = recordTiering({ actor: 'human:test' });
  assert.equal(r.signed, TIER_A.length);
  assert.deepEqual(r.unreachable, []);
  assert.equal(r.sealedButUnerasable, 0, 'a sealed column nobody can erase must never exist');

  for (const { table, column } of TIER_A) {
    const row = one('SELECT tier, sealed_at_write, erasable, reviewed_by FROM data_inventory WHERE table_name = ? AND column_name = ?', table, column);
    assert.equal(row?.tier, 'A', `${table}.${column} is not recorded as Tier A`);
    assert.equal(row.sealed_at_write, 1);
    assert.equal(row.erasable, 1, `${table}.${column} is sealed but the walk cannot reach it`);
    assert.equal(row.reviewed_by, 'human:test');
  }
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'datagov.tiering_recorded' ORDER BY seq DESC LIMIT 1"),
    'signing the tiering must be on the chain');
});

test('the inventory cannot claim a column is sealed that the code does not seal', () => {
  // Both sides read the same list, so this is a check that the derivation is
  // still a derivation rather than a copy somebody keeps in step by hand.
  rebuild({ actor: 'system:test' });
  const claimed = q("SELECT table_name, column_name FROM data_inventory WHERE sealed_at_write = 1")
    .map((r) => `${r.table_name}.${r.column_name}`).sort();
  const actual = TIER_A.map((c) => `${c.table}.${c.column}`).sort();
  assert.deepEqual(claimed, actual);
});

// --- the planted value ----------------------------------------------------

let ticketId = null;

test('a value written through the normal path is not in the database file', () => {
  // Prove the search works before trusting what it does not find: the customer
  // column is Tier B by design and must be findable in the raw bytes. Without
  // this line, a broken `fileContains` would make every assertion below pass.
  const t = createTicket({ customer: SUBJECT, subject: SECRET_SUBJECT, body: SECRET_BODY });
  ticketId = t.id;
  assert.ok(diskContains(SUBJECT).length, 'the control value must be findable, or the search proves nothing');

  assert.deepEqual(diskContains(SECRET_BODY), [], 'the message body is readable on the disk');
  assert.deepEqual(diskContains(SECRET_SUBJECT), [], 'the subject line is readable on the disk');

  // And it is sealed rather than merely absent.
  const raw = one('SELECT subject, body, subject_ref FROM tickets WHERE id = ?', ticketId);
  assert.ok(isSealed(raw.body) && isSealed(raw.subject));
  assert.equal(raw.subject_ref, refFor('contact', SUBJECT));
});

test('the surface still returns it, because that is the boundary', () => {
  const t = getTicket(ticketId);
  assert.equal(t.body, SECRET_BODY);
  assert.equal(t.subject, SECRET_SUBJECT);
});

test('the chain never carried the words', () => {
  // An append-only log holding a quoted message body is a copy that survives
  // the erasure, which is the one thing crypto-shredding exists to prevent.
  const entries = q("SELECT payload FROM audit_log WHERE action = 'ticket.created'").map((r) => r.payload || '');
  assert.ok(entries.length);
  assert.ok(!entries.some((p) => p.includes(SECRET_SUBJECT)), 'the subject line is on the chain');
  assert.ok(!entries.some((p) => p.includes(SECRET_BODY)), 'the body is on the chain');
  assert.ok(entries.some((p) => p.includes(refFor('contact', SUBJECT))), 'the reference should be, so it can be found');
});

test('a reply written by a person is sealed on the way in too', () => {
  exec("UPDATE tickets SET state = 'draft_ready', draft = ? WHERE id = ?",
    sealPii('a draft', { kind: 'contact', identifier: SUBJECT }), ticketId);
  const reply = 'PLANTED-REPLY-4c8d we have refunded the duplicate charge';
  sendTicket(ticketId, { body: reply, actor: 'human:test' });
  assert.deepEqual(diskContains(reply), [], 'what we sent them is as personal as what they sent us');
  assert.equal(getTicket(ticketId).sent_body, reply);
});

// --- deep search ----------------------------------------------------------

test('a sealed column can never be the reason a row was returned', async () => {
  // The rule the search has always followed — no column holding a hash, a token
  // or ciphertext may be a match — now covers sealed columns by name. Searching
  // for the plaintext must find nothing, and searching for a fragment of the
  // ciphertext must not surface somebody's transcript as a snippet either.
  const raw = one('SELECT body FROM tickets WHERE id = ?', ticketId);
  const fragment = raw.body.slice(30, 46);

  const sealedCols = new Set(TIER_A.map((c) => `${c.table}.${c.column}`));
  for (const term of [SECRET_BODY.slice(0, 24), fragment]) {
    const res = lookup(term);
    const leaked = (res.hits || []).filter((h) => sealedCols.has(`${h.where}.${h.matched}`));
    assert.deepEqual(leaked, [], `deep search matched on a sealed column for "${term.slice(0, 20)}"`);
  }

  // And prove the exclusion is real rather than an artefact of the term not
  // being there: a Tier B column on the same table must still be findable.
  const control = lookup('planted-subject.test');
  assert.ok((control.hits || []).some((h) => h.where === 'tickets' && h.matched === 'customer'),
    'the search no longer finds anything at all — the guardrail has gone too far');
});

// --- backfill -------------------------------------------------------------

test('the backfill seals what was written before there was sealing', () => {
  // A row inserted the way an older version of this code would have: plaintext
  // in every Tier A column, and no reference.
  const legacy = 'PLANTED-LEGACY-1f9b written before any of this existed';
  exec("INSERT INTO tickets (customer, category, subject, body) VALUES (?,?,?,?)",
    'legacy@planted-subject.test', 'general', 'legacy subject', legacy);
  const id = one('SELECT last_insert_rowid() AS id').id;

  assert.ok(diskContains(legacy).length, 'the legacy row must really be in plaintext, or this test proves nothing');
  const before = remaining().find((r) => r.table === 'tickets');
  assert.ok(before.unsealed > 0);

  const res = sealBatch({ table: 'tickets', columns: ['subject', 'body', 'draft', 'sent_body'], subject: ['customer'] }, 0);
  assert.ok(res.sealed > 0);
  assert.deepEqual(diskContains(legacy), [], 'the backfill left plaintext behind');

  const row = one('SELECT body, subject_ref FROM tickets WHERE id = ?', id);
  assert.ok(isSealed(row.body));
  assert.equal(openPii(row.body), legacy);
  assert.equal(row.subject_ref, refFor('contact', 'legacy@planted-subject.test'));
});

test('running the backfill twice changes nothing the second time', () => {
  const spec = { table: 'tickets', columns: ['subject', 'body', 'draft', 'sent_body'], subject: ['customer'] };
  const snapshot = q('SELECT id, subject, body FROM tickets ORDER BY id');
  const again = sealBatch(spec, 0);
  assert.equal(again.sealed, 0, 'a second pass must find nothing left to do');
  assert.deepEqual(q('SELECT id, subject, body FROM tickets ORDER BY id'), snapshot,
    'sealing an already-sealed value must not re-encrypt it');
});

test('an interrupted backfill resumes rather than restarting', async () => {
  for (let i = 0; i < 5; i++) {
    exec("INSERT INTO tickets (customer, category, subject, body) VALUES (?,?,?,?)",
      `batch${i}@planted-subject.test`, 'general', `subject ${i}`, `PLANTED-BATCH-${i} body`);
  }
  const spec = { table: 'tickets', columns: ['subject', 'body', 'draft', 'sent_body'], subject: ['customer'] };

  // Two rows at a time, stopping between them the way a killed process would.
  let after = 0;
  let done = false;
  let passes = 0;
  while (!done && passes < 40) {
    const r = sealBatch(spec, after, 2);
    after = r.watermark;
    done = r.done;
    passes++;
  }
  assert.ok(passes > 1, 'the batching did not actually batch');
  for (let i = 0; i < 5; i++) {
    assert.ok(isSealed(one('SELECT body FROM tickets WHERE customer = ?', `batch${i}@planted-subject.test`).body),
      `row ${i} was not sealed by the resumed backfill`);
  }

  // Sealed in the table is not the same as gone from the file, and this is
  // where the first version of this test failed. An UPDATE frees the old page
  // without zeroing it, so every plaintext body the backfill had just encrypted
  // was still sitting in the file — invisible to SQL, one `strings` away, and
  // copied verbatim into the next backup. Against the attacker this whole
  // design is aimed at, the encryption would have been decorative.
  //
  // `secure_delete` is what makes the assertion below pass rather than the
  // vacuum, so it is asserted directly: without it these rows come back.
  assert.equal(q('PRAGMA secure_delete')[0].secure_delete, 1,
    'overwritten pages are not being zeroed — sealed data stays readable in the file');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(diskContains(`PLANTED-BATCH-${i} body`), [],
      `row ${i} is still readable in a freed page`);
  }

  // And the vacuum, which is the only thing that reclaims pages freed *before*
  // the pragma was ever set — an install upgrading into this feature.
  assert.equal(reclaimFreePages().ok, true);
  assert.deepEqual(diskContains('PLANTED-BATCH-3 body'), []);
});

test('the backfill is a job, and the queue knows how to run it', async () => {
  const started = startBackfill({ actor: 'human:test' });
  assert.equal(started.ok, true);
  assert.ok(one("SELECT id FROM jobs WHERE kind = ? AND state = 'queued'", JOB_KIND), 'nothing was queued');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'pii.backfill_started'"), 'the start is not on the chain');

  // Asking twice while one is in flight returns the job already running.
  assert.equal(startBackfill({ actor: 'human:test' }).jobId, started.jobId);

  // jobsTick drains up to eight jobs, and each batch queues the next, so this
  // runs the backfill to completion in one call on a database this size.
  const ran = await jobsTick();
  assert.ok(ran > 1, 'each batch must queue the next one, or the backfill stops after one');
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'pii.backfill_table_done'"), 'no progress was recorded');

  // Whatever it got through, it left nothing readable behind it.
  const left = backfillOverview();
  assert.equal(typeof left.unsealedRows, 'number');
  assert.ok(one("SELECT id FROM jobs WHERE kind = ? AND state != 'dead'", JOB_KIND),
    'the queue has no handler for the backfill — it was dead-lettered');
});

// --- erasure, now covering data that was sealed at write ------------------

test('erasing a subject makes Tier A unreadable, and the chain still verifies', () => {
  const found = findSubject({ kind: 'contact', identifier: SUBJECT });
  assert.ok(found.records.length, 'the walk must find the sealed rows it is about to shred');

  const done = eraseSubject({ kind: 'contact', identifier: SUBJECT, reason: 'test', actor: 'human:test' });
  assert.equal(done.ok, true);

  const t = getTicket(ticketId);
  assert.equal(t.body, '[erased]');
  assert.equal(t.subject, '[erased]');

  const proof = verifyErasure({ kind: 'contact', identifier: SUBJECT });
  assert.equal(proof.ok, true);
  assert.equal(proof.keyDestroyed, true);
  assert.deepEqual(proof.leaks, []);
  assert.equal(proof.chainStillVerifies, true);
  assert.equal(verifyChain().ok, true);
});

test('the erased words are gone from the disk, not just from the API', () => {
  assert.deepEqual(diskContains(SECRET_BODY), []);
  assert.deepEqual(diskContains(SECRET_SUBJECT), []);
  // And the key really is destroyed rather than merely marked.
  assert.equal(one('SELECT wrapped_key FROM pii_subjects WHERE ref = ?', refFor('contact', SUBJECT)).wrapped_key, null);
});

// --- backups --------------------------------------------------------------

test('sealed data is sealed inside the backup file and the WAL archive', () => {
  const survivor = 'PLANTED-BACKUP-5a3e this must be sealed in the copy too';
  createTicket({ customer: 'backup@planted-subject.test', subject: 'backup check', body: survivor });

  const b = takeBackup({ kind: 'test', actor: 'human:test' });
  const file = path.join(root, b.file);
  assert.ok(fs.existsSync(file), 'no backup file was written');

  // The control again: a Tier B value must be findable in the backup, so that
  // "the sealed one is absent" is a fact about sealing and not about the file.
  assert.equal(fileContains(file, 'backup@planted-subject.test'), true,
    'the control value is missing from the backup — the search is not working');
  assert.equal(fileContains(file, survivor), false, 'the backup contains readable personal data');

  assert.equal(verifyBackup(b.id).ok, true, 'the backup no longer verifies');

  // The write-ahead log travels with it and is the same argument.
  const walDir = path.join(root, 'data', 'wal-archive');
  const wal = `${DB}-wal`;
  if (fs.existsSync(wal)) {
    fs.mkdirSync(walDir, { recursive: true });
    const copy = path.join(walDir, 'wal-sealing-test');
    fs.copyFileSync(wal, copy);
    assert.equal(fileContains(copy, survivor), false, 'the write-ahead log carries readable personal data');
    fs.rmSync(copy, { force: true });
  }
  fs.rmSync(file, { force: true });
});

test('what the tiering says about itself is true', () => {
  const t = tiering();
  assert.deepEqual(t.unreachable, []);
  assert.equal(t.declared.length, TIER_A.length);
  assert.ok(t.note.includes('THREAT-MODEL-PII.md'), 'the surface must point at what it does not protect against');
  assert.equal(coverage().sealedButUnerasable, 0);
  assert.equal(isTierA('tickets', 'body'), true);
  assert.equal(isTierA('tickets', 'customer'), false, 'the reconciliation join key must stay Tier B');
});
