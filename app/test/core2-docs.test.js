// Documents, and the question that kept them out of the first Phase 1 commit:
// who may read version 3 of a document attached to a disciplinary record?
//
// The answer is tested from both sides. The permission side: a guarded
// classification maps to a permission at the route. The sealing side: a
// restricted document about a person has every version's body sealed under
// that person's key — asserted against the raw database bytes, not against the
// module that wrote them — and erasing the person takes the contents while the
// chain still verifies and the fact of the document survives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-docs.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 29).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-docs.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { seedAgents } = await import('../src/workflow.js');
const { tierAUnreachable, eraseSubject, verifyErasure } = await import('../src/erasure.js');
const { createPerson } = await import('../src/core2/identity.js');
const { emit } = await import('../src/core2/bridge.js');
const { jobsTick } = await import('../src/jobs.js');
const {
  createDocument, addVersion, getDocument, listDocuments, archiveDocument,
  searchDocuments, documentsOverview, CLASSIFICATIONS, READ_PERMISSION,
} = await import('../src/core2/documents.js');

seedAgents();

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  const hits = [];
  for (const suffix of ['', '-wal']) {
    const f = `${DB}${suffix}`;
    if (fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from(needle, 'utf8'))) hits.push(suffix || 'db');
  }
  return hits;
}

const PERSON = createPerson({ displayName: 'Widad Karim', personalEmail: 'widad@example.test', actor: 'human:test' });

// --- classification is an access decision, enforced before storage ---------

test('every classification maps to a stated permission', () => {
  for (const c of CLASSIFICATIONS) {
    assert.ok(c in READ_PERMISSION, `${c} has no read rule`);
  }
  assert.equal(READ_PERMISSION.public, null);
  assert.equal(READ_PERMISSION.restricted, 'docs.confidential');
});

test('restricted requires a person, and a person with a key', () => {
  // Restricted with nobody named: there is no key to seal under, so the
  // classification would be a lie. Refused, with the alternative named.
  assert.throws(() => createDocument({ title: 'Orphan note', classification: 'restricted', actor: 'human:test' }),
    /who the document is about/);

  // Restricted about a person who has no contact detail: same problem, said
  // differently — refusing beats storing plaintext the label calls sealed.
  const keyless = createPerson({ displayName: 'Bare Row', actor: 'human:test' });
  assert.throws(() => createDocument({
    title: 'Note', classification: 'restricted', subjectPersonId: keyless.id, actor: 'human:test',
  }), /no key to seal/);
});

test('an agent cannot be the subject of a personnel document', () => {
  const agent = one('SELECT id FROM agents LIMIT 1');
  // STRICT: subject_person_id is INTEGER, an agent id is TEXT.
  assert.throws(() => exec(
    'INSERT INTO doc_document (title, classification, subject_person_id, created_by) VALUES (?,?,?,?)',
    'About a bot', 'restricted', agent.id, 'human:test',
  ));
});

// --- the sealing half -------------------------------------------------------

const SECRET = 'PLANTED-DOCTOR-NOTE-91b3 unfit for travel until further notice';

test('a restricted body is unreadable on disk and readable through the module', () => {
  const doc = createDocument({
    title: 'Doctor\'s note — sealed attachment', classification: 'restricted',
    subjectPersonId: PERSON.id, body: SECRET, actor: 'human:test',
  });

  // The control first: the title is deliberately plain — the index of the
  // knowledge base is Tier B — so it must be findable, or the search proves
  // nothing about what it fails to find.
  assert.ok(diskContains('Doctor\'s note — sealed attachment').length, 'the control value must be findable');
  assert.deepEqual(diskContains(SECRET), [], 'a sealed body is readable in the raw file');

  const back = getDocument(doc.id);
  assert.equal(back.versions.length, 1);
  assert.equal(back.versions[0].body, SECRET);
  assert.equal(back.versions[0].sealed, true);
});

test('an internal body stays plaintext, because search has to reach it', () => {
  const doc = createDocument({
    title: 'Deploy runbook', classification: 'internal',
    body: 'FINDABLE-RUNBOOK-77aa restart the service after the backfill', actor: 'human:test',
  });
  assert.ok(diskContains('FINDABLE-RUNBOOK-77aa').length, 'internal knowledge must stay searchable');
  assert.equal(getDocument(doc.id).versions[0].sealed, false);
});

test('search reaches titles and internal bodies, and never a guarded body', () => {
  createDocument({
    title: 'Vendor shortlist', classification: 'confidential',
    body: 'GUARDED-BODY-4f2c the winning bid is overpriced', actor: 'human:test',
  });
  assert.ok(searchDocuments('runbook').some((h) => h.title === 'Deploy runbook'));
  assert.ok(searchDocuments('FINDABLE-RUNBOOK').length >= 1, 'internal bodies are searchable');
  assert.equal(searchDocuments('GUARDED-BODY').length, 0, 'a confidential body leaked through search');
  assert.equal(searchDocuments('PLANTED-DOCTOR').length, 0, 'a restricted body leaked through search');
  // The guarded documents are still in the index by title.
  assert.ok(searchDocuments('Vendor shortlist').length === 1);
});

// --- versions are a record --------------------------------------------------

test('versions append; they are never edited and never renumbered', () => {
  const doc = createDocument({ title: 'Policy', classification: 'internal', body: 'v1 text', actor: 'human:test' });
  addVersion(doc.id, { body: 'v2 text', note: 'clarified scope', actor: 'human:test' });
  const back = getDocument(doc.id);
  assert.deepEqual(back.versions.map((v) => v.version), [1, 2]);
  assert.equal(back.current_version, 2);
  // The same version number twice is a constraint violation, not an overwrite.
  assert.throws(() => exec(
    'INSERT INTO doc_version (document_id, version, body, created_by) VALUES (?,?,?,?)',
    doc.id, 2, 'rewritten history', 'human:test',
  ));
  // Archived documents stop taking versions; they do not disappear.
  archiveDocument(doc.id, { actor: 'human:test' });
  assert.throws(() => addVersion(doc.id, { body: 'v3', actor: 'human:test' }), /archived/);
  assert.ok(getDocument(doc.id));
});

// --- erasure ----------------------------------------------------------------

test('erasing the person empties the note; the document survives; the chain verifies', () => {
  assert.deepEqual(tierAUnreachable(), []);
  eraseSubject({ kind: 'contact', identifier: 'widad@example.test', reason: 'test', actor: 'human:test' });

  const doc = listDocuments().find((d) => d.title.startsWith('Doctor'));
  const back = getDocument(doc.id);
  assert.equal(back.versions[0].body, '[erased]');
  assert.equal(back.title, 'Doctor\'s note — sealed attachment', 'the fact a document existed must survive');
  assert.deepEqual(diskContains(SECRET), []);

  const proof = verifyErasure({ kind: 'contact', identifier: 'widad@example.test' });
  assert.equal(proof.ok, true);
  assert.equal(verifyChain().ok, true);
});

// --- notifications: a mapping, not a mechanism ------------------------------

test('a consequential event reaches the notifications a phone already subscribes to', async () => {
  const before = one('SELECT COUNT(*) AS n FROM notifications').n;
  emit('leave.requested', { id: 314 });
  await jobsTick();
  const after = q('SELECT * FROM notifications ORDER BY id DESC LIMIT 1');
  assert.ok(one('SELECT COUNT(*) AS n FROM notifications').n > before, 'nothing reached a person');
  assert.equal(after[0].source, 'core2');
  assert.match(after[0].message, /#314/);
  // The message carries the pointer, never the words: the notifications table
  // is not erasable, so a name or a reason in it would outlive its subject.
  assert.ok(!/widad/i.test(after[0].message));
});

test('an ordinary event notifies nobody', async () => {
  const before = one('SELECT COUNT(*) AS n FROM notifications').n;
  emit('meeting.started', { id: 9 });
  await jobsTick();
  assert.equal(one('SELECT COUNT(*) AS n FROM notifications').n, before,
    'a routine event pinged a person — that teaches people to swipe the app away');
});

test('the overview counts what is really there', () => {
  const o = documentsOverview();
  assert.ok(o.total >= 3);
  assert.ok(o.sealedVersions >= 1);
  assert.ok(o.byClassification.restricted >= 1);
  assert.match(o.note, /append-only/);
});
