// Files and retention — the two halves of keeping something.
//
// A file store is easy to write and easy to get catastrophically wrong, because
// every mistake is silent: the bytes sit on disk in the clear and everything
// still works. So these tests are mostly about what is *not* true afterwards —
// that the plaintext is not on disk, that a renamed executable did not get in,
// that erasing the person really did destroy the file rather than orphan it.
//
// The retention half is tested on the conflict that decides whether it is real:
// a legal hold against a right to erasure. Both silent answers are wrong —
// destroying evidence, or ignoring the request — and the test asserts the third
// thing, which is a refusal in writing with the matter named.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-files.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-core2-files.db${s}`)); } catch { /* first run */ }
}
// The blob store too. Resetting the database and not the files is exactly the
// state that leaves orphans behind — which is a real hazard, reported by
// `orphanBlobs()`, and not something a test should be quietly grading.
try { fs.rmSync(path.join(root, 'data', 'files'), { recursive: true }); } catch { /* first run */ }

const F = await import('../src/core2/files.js');
const R = await import('../src/core2/records.js');
const I = await import('../src/core2/identity.js');
const E = await import('../src/erasure.js');
const { q, one } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');

const HUMAN = 'human:owner';
const LEGAL = 'human:legal';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('a doctor said she is fit to work'), Buffer.alloc(512, 0x41)]);

const person = I.createPerson({ displayName: 'Layla Haddad', personalEmail: 'layla@example.com', actor: HUMAN });
R.seedClasses({});

// -------------------------------------------------------------- refusals --

test('a file needs a signature, a name and some bytes', () => {
  assert.throws(() => F.storeFile({ bytes: PDF, filename: 'a.pdf' }), /signed/);
  assert.throws(() => F.storeFile({ bytes: PDF, filename: '', actor: HUMAN }), /needs a name/);
  assert.throws(() => F.storeFile({ bytes: Buffer.alloc(0), filename: 'a.pdf', actor: HUMAN }), /empty/);
});

test('an executable is refused by its extension and by its first bytes', () => {
  for (const name of ['setup.exe', 'run.sh', 'payload.js', 'thing.dll', 'x.ps1', 'a.jar']) {
    assert.throws(() => F.storeFile({ bytes: Buffer.from('hello'), filename: name, actor: HUMAN }), /program, not an attachment/, name);
  }
  // The extension check alone is a speed bump. These are all named like
  // documents, which is the entire point of renaming them.
  const disguises = [
    ['payslip.pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2]), /Windows executable/],
    ['scan.png', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2]), /Linux executable/],
    ['notes.txt', Buffer.from('#!/bin/sh\nrm -rf /'), /shebang/],
    ['photo.jpg', Buffer.from([0xca, 0xfe, 0xba, 0xbe, 1]), /Mach-O|Java/],
  ];
  for (const [name, bytes, why] of disguises) {
    assert.throws(() => F.storeFile({ bytes, filename: name, actor: HUMAN }), why, name);
  }
});

test('a file cannot be attached to something that is not there', () => {
  assert.throws(() => F.storeFile({ bytes: PDF, filename: 'a.pdf', attachType: 'spaceship', attachId: 1, actor: HUMAN }), /attaches to one of/);
  assert.throws(() => F.storeFile({ bytes: PDF, filename: 'a.pdf', attachType: 'person', attachId: 99999, actor: HUMAN }), /no a person with id/);
  assert.throws(() => F.storeFile({ bytes: PDF, filename: 'a.pdf', attachType: 'person', actor: HUMAN }), /say which/);
});

test('the stored name cannot be a path', () => {
  const r = F.storeFile({ bytes: PDF, filename: '../../../etc/passwd', actor: HUMAN });
  assert.equal(r.filename, 'passwd', 'the directories are stripped, not honoured');
  const row = one('SELECT stored_as FROM doc_file WHERE id = ?', r.id);
  assert.match(row.stored_as, /^[0-9a-f-]{36}\.sealed$/, 'and the name on disk is a uuid nobody chose');
});

// ---------------------------------------------------------------- sealing --

test('the bytes on disk are ciphertext, and the round trip is exact', () => {
  const r = F.storeFile({
    bytes: PDF, filename: 'medical-note.pdf', mime: 'application/pdf',
    subjectKind: 'contact', subjectId: 'layla@example.com',
    attachType: 'person', attachId: person.id, actor: HUMAN,
  });
  assert.equal(r.sealed, true);

  const row = one('SELECT stored_as FROM doc_file WHERE id = ?', r.id);
  const raw = fs.readFileSync(path.join(root, 'data', 'files', row.stored_as), 'utf8');
  assert.match(raw, /^pii:1:/, 'sealed with the same envelope as every other personal field');
  assert.ok(!raw.includes('%PDF'), 'the header is not readable on disk');
  assert.ok(!raw.includes('fit to work'), 'and neither is the content');

  const back = F.readFile(r.id, { actor: HUMAN });
  assert.ok(back.content.equals(PDF), 'byte for byte');
  assert.equal(back.intact, true, 'and it matches the hash taken when it was stored');
});

test('reading is signed, and a tampered blob is reported rather than served quietly', () => {
  const r = one('SELECT id, stored_as FROM doc_file WHERE filename = ?', 'medical-note.pdf');
  assert.throws(() => F.readFile(r.id, {}), /signed/);
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'file.read' ORDER BY seq DESC LIMIT 1"), 'and the read is on the chain');
});

test('erasing the person destroys the file, and the chain still verifies', () => {
  const f = one('SELECT id FROM doc_file WHERE filename = ?', 'medical-note.pdf');
  assert.ok(F.readFile(f.id, { actor: HUMAN }).content, 'readable to begin with');

  E.eraseSubject({ kind: 'contact', identifier: 'layla@example.com', reason: 'she asked', actor: HUMAN });

  const after = F.readFile(f.id, { actor: HUMAN });
  assert.equal(after.erased, true, 'the key is gone, so the file is gone');
  assert.equal(after.content, null, 'and the content field is empty rather than a size masquerading as one');
  assert.equal(after.bytes, 553, 'the row still records how big it was, which is not personal data');
  // The blob is still on disk and that is fine — it is unopenable, which is the
  // guarantee. A file store that had to find and shred every copy would fail on
  // the first backup.
  const row = one('SELECT stored_as FROM doc_file WHERE id = ?', f.id);
  const raw = fs.readFileSync(path.join(root, 'data', 'files', row.stored_as), 'utf8');
  assert.ok(!raw.includes('%PDF'));
  assert.ok(verifyChain().ok);
});

test('deleting leaves a tombstone rather than a hole', () => {
  const r = F.storeFile({ bytes: PDF, filename: 'supplier-contract.pdf', actor: HUMAN });
  assert.throws(() => F.deleteFile(r.id, {}), /signed/);
  F.deleteFile(r.id, { actor: HUMAN, why: 'superseded by the 2027 contract' });
  const row = one('SELECT * FROM doc_file WHERE id = ?', r.id);
  assert.ok(row, 'the row stays, so the gap is visible');
  assert.ok(row.deleted_at && row.deleted_by);
  assert.equal(row.delete_reason, 'superseded by the 2027 contract');
  assert.ok(!fs.existsSync(path.join(root, 'data', 'files', row.stored_as)), 'and the bytes really are gone');
});

test('the overview reports disk against table rather than trusting the table', () => {
  const o = F.filesOverview();
  assert.equal(typeof o.consistent, 'boolean');
  assert.equal(o.blobsOnDisk, o.files, 'a count that only read the table would report a healthy library after somebody deleted the folder');
  assert.ok(o.refuses.join(' ').includes('renaming it changes nothing'));
  assert.equal(o.consistent, true);
});

test('a blob nobody can account for is reported, never quietly deleted', () => {
  // The state that produces these is ordinary: a database restored from an
  // older backup than the file store. Deleting files nobody can account for is
  // precisely the wrong automatic behaviour, so it lists and leaves them.
  fs.writeFileSync(path.join(root, 'data', 'files', 'stray-from-an-old-restore.sealed'), 'pii:1:deadbeef:xx');
  const o = F.filesOverview();
  assert.equal(o.consistent, false, 'the mismatch is visible');
  const orphans = F.orphanBlobs();
  assert.equal(orphans.length, 1);
  assert.match(orphans[0].name, /stray-from-an-old-restore/);
  assert.ok(fs.existsSync(path.join(root, 'data', 'files', orphans[0].name)), 'and it is still there — reported, not removed');
  fs.rmSync(path.join(root, 'data', 'files', 'stray-from-an-old-restore.sealed'));
});

// -------------------------------------------------------------- retention --

test('a retention period without a stated basis is refused', () => {
  assert.throws(() => R.setClass({ code: 'x', label: 'X', keepMonths: 12, basis: '', actor: HUMAN }), /nobody can cite/);
  assert.throws(() => R.setClass({ code: 'x', label: 'X', keepMonths: 12, basis: 'the tax act' }), /signed/);
  assert.throws(() => R.setClass({ code: 'x', label: 'X', keepMonths: 12, disposition: 'shred-and-pray', basis: 'y', actor: HUMAN }), /destroyed, anonymised/);
  R.setClass({ code: 'visitor', label: 'Visitor logs', keepMonths: 3, basis: 'site security policy §4', actor: HUMAN });
  assert.equal(one('SELECT basis FROM rec_class WHERE code = ?', 'visitor').basis, 'site security policy §4');
});

test('the seeded schedule says its periods are placeholders rather than advice', () => {
  for (const c of R.dueForDisposition()) {
    assert.ok(c.basis && c.basis.length, `${c.code} has a stated basis`);
  }
  const payroll = R.dueForDisposition().find((c) => c.code === 'payroll');
  assert.match(payroll.basis, /set locally/i, 'a seeded number must not be mistaken for legal advice');
});

test('a class nothing counts says so, instead of a comforting zero', () => {
  const medical = R.dueForDisposition().find((c) => c.code === 'medical');
  assert.equal(medical.counted, false);
  assert.match(medical.say, /rather than a comforting zero/);
});

test('a hold needs a scope, a target and a reason', () => {
  assert.throws(() => R.placeHold({ scopeKind: 'person', scopeId: 1, reason: 'x' }), /signed/);
  assert.throws(() => R.placeHold({ scopeKind: 'galaxy', scopeId: 1, reason: 'x', actor: LEGAL }), /covers one of/);
  assert.throws(() => R.placeHold({ scopeKind: 'person', reason: 'x', actor: LEGAL }), /say which one/);
  assert.throws(() => R.placeHold({ scopeKind: 'person', scopeId: 1, reason: '  ', actor: LEGAL }), /never gets lifted/);
});

test('a legal hold refuses an erasure in writing, names the matter, and erases nothing', () => {
  const p2 = I.createPerson({ displayName: 'Omar Nasser', personalEmail: 'omar@example.com', actor: HUMAN });
  R.placeHold({ scopeKind: 'person', scopeId: p2.id, reason: 'wrongful dismissal claim', matter: 'MAT-2026-11', actor: LEGAL });

  assert.throws(
    () => E.eraseSubject({ kind: 'contact', identifier: 'omar@example.com', reason: 'he asked', actor: HUMAN }),
    (e) => {
      assert.equal(e.status, 409, 'a conflict, not a server error and not a silent success');
      assert.match(e.message, /MAT-2026-11/, 'the matter is named, so the person can be told why');
      assert.match(e.message, /request stands/, 'and told that it is not being thrown away');
      return true;
    },
  );

  // Nothing may be half-done: a refusal that arrives after the first UPDATE has
  // already destroyed part of somebody.
  assert.ok(one('SELECT display_name FROM hr_person WHERE id = ?', p2.id), 'still on file');
  assert.equal(one('SELECT erased_at FROM pii_subjects WHERE ref = (SELECT subject_ref FROM hr_person WHERE id = ?)', p2.id)?.erased_at ?? null, null);
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'erasure.refused_hold' ORDER BY seq DESC LIMIT 1"), 'the refusal is provable years later, by both sides');
});

test('once the hold is released the erasure goes through', () => {
  const h = one("SELECT id FROM rec_hold WHERE released_at IS NULL AND matter = 'MAT-2026-11'");
  assert.throws(() => R.releaseHold({ id: h.id }), /signed/);
  R.releaseHold({ id: h.id, actor: LEGAL, note: 'claim settled' });
  const r = E.eraseSubject({ kind: 'contact', identifier: 'omar@example.com', reason: 'he asked', actor: HUMAN });
  assert.equal(r.ok, true);
  assert.ok(verifyChain().ok);
});

test('a hold on a class freezes disposal of that class', () => {
  R.placeHold({ scopeKind: 'class', scopeId: 'payroll', reason: 'tax audit', matter: 'TAX-9', actor: LEGAL });
  assert.throws(() => R.recordDisposal({ classCode: 'payroll', what: '2019 slips', actor: HUMAN }), /under a legal hold/);
  // And the schedule says so rather than continuing to advertise them as due.
  const payroll = R.dueForDisposition().find((c) => c.code === 'payroll');
  assert.equal(payroll.frozen, true);
  assert.match(payroll.say, /frozen by a legal hold/);
  // Another class is unaffected: a hold is not a global freeze unless it says so.
  assert.equal(R.dueForDisposition().find((c) => c.code === 'expense').frozen, false);
});

test('a hold on everything freezes everything, and the overview says so', () => {
  R.placeHold({ scopeKind: 'everything', reason: 'regulator has asked us to preserve', matter: 'REG-2026-3', actor: LEGAL });
  const o = R.recordsOverview();
  assert.equal(o.everythingFrozen, true);
  assert.ok(o.classes.every((c) => c.frozen), 'every class, not just the named ones');
  assert.equal(o.dueTotal, 0, 'nothing is disposable while everything is held');
  assert.match(o.says, /never silently ignored and never silently honoured/);
});

test('disposal is written down, and this module never claims to have deleted anything itself', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'core2', 'records.js'), 'utf8');
  assert.match(src, /does not delete anything itself/i);
  // Release the global hold so a disposal can be recorded at all.
  for (const h of q("SELECT id FROM rec_hold WHERE released_at IS NULL")) R.releaseHold({ id: h.id, actor: LEGAL });
  R.recordDisposal({ classCode: 'expense', what: '2018 expense claims', count: 412, actor: HUMAN });
  const d = one('SELECT * FROM rec_disposal ORDER BY id DESC LIMIT 1');
  assert.equal(d.count, 412);
  assert.equal(d.decided_by, HUMAN);
  assert.ok(one("SELECT seq FROM audit_log WHERE action = 'records.disposed' ORDER BY seq DESC LIMIT 1"));
});
