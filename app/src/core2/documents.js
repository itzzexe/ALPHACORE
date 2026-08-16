// Documents and the knowledge base — Core 2's COLLABORATION division, part one.
//
// Four classifications, and they are access decisions rather than labels:
//
//   public        anybody signed in may read it
//   internal      docs.view
//   confidential  docs.confidential
//   restricted    docs.confidential AND, when the document is about a person,
//                 the body is sealed under that person's own key
//
// The last line is the answer to "who may read version 3 of a document attached
// to a disciplinary record": somebody holding docs.confidential, through the
// permission-checked route, while the key still exists. A disk thief gets
// ciphertext; a colleague without the permission gets a refusal; and after the
// person is erased, nobody gets anything — including us — while the fact that
// a document existed, and when, survives on the row.
//
// This is also where the directive's data-minimization rule gets its mechanism:
// a doctor's note is a restricted document about a person, stored as an opaque
// sealed body. There is no medical field anywhere in any schema for a report or
// an agent to summarize; there is only "a note exists, sealed, reference NNN".
import { q, one, exec } from '../db.js';
import { sealPii, sealForRef, openPii, isSealed } from '../erasure.js';
import { log } from './identity.js';

const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];

/** The permission each classification demands of a reader. */
export const READ_PERMISSION = {
  public: null,                     // signed in is enough
  internal: 'docs.view',
  confidential: 'docs.confidential',
  restricted: 'docs.confidential',
};

/**
 * Create a document, with its first version if a body was given.
 *
 * `subjectPersonId` names who the document is ABOUT — not who wrote it. It is
 * what makes a disciplinary note erasable by the person it concerns, and it is
 * an INTEGER in a STRICT table, so it cannot name an agent.
 */
export function createDocument({ title, classification = 'internal', subjectPersonId = null, body = null, note = null, actor }) {
  if (!actor) refuse('creating a document is an act and carries a name');
  if (!clean(title)) refuse('a document needs a title');
  if (!CLASSIFICATIONS.includes(classification)) refuse(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);

  let subjectRef = null;
  if (subjectPersonId) {
    const p = one('SELECT id, subject_ref FROM hr_person WHERE id = ?', Number(subjectPersonId));
    if (!p) refuse('no such person to be the subject of this document');
    subjectRef = p.subject_ref;
    // A restricted document about a person with no key to seal under is a
    // promise the platform cannot keep. Refuse rather than store plaintext
    // that the classification claims is sealed.
    if (classification === 'restricted' && !subjectRef) {
      refuse('this person has no contact detail on file, so there is no key to seal a restricted document under');
    }
  }
  if (classification === 'restricted' && !subjectPersonId) {
    refuse('restricted means sealed under a person\'s key — say who the document is about, or use confidential');
  }

  exec(
    `INSERT INTO doc_document (title, classification, subject_person_id, subject_ref, created_by)
     VALUES (?,?,?,?,?)`,
    clean(title), classification, subjectPersonId ? Number(subjectPersonId) : null, subjectRef, String(actor),
  );
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'document', entityId: id, action: 'document.created', actor, detail: { classification, about: subjectPersonId || null } });

  if (body != null && body !== '') addVersion(id, { body, note, actor });
  return getDocument(id);
}

/**
 * Append a version. Versions are never edited — the next correction is the
 * next version, which is what makes the history a record.
 */
export function addVersion(documentId, { body, note = null, actor }) {
  if (!actor) refuse('a new version is an act and carries a name');
  const doc = one('SELECT * FROM doc_document WHERE id = ?', Number(documentId));
  if (!doc) refuse('no such document');
  if (doc.state !== 'active') refuse('an archived document does not take new versions');
  if (body == null || body === '') refuse('a version without a body is a version number');

  const sealed = doc.classification === 'restricted' && doc.subject_ref
    ? sealForRef(String(body), doc.subject_ref)
    : String(body);
  const version = doc.current_version + 1;
  exec(
    `INSERT INTO doc_version (document_id, version, body, note, subject_ref, created_by)
     VALUES (?,?,?,?,?,?)`,
    doc.id, version, sealed, clean(note, 400) || null, doc.classification === 'restricted' ? doc.subject_ref : null, String(actor),
  );
  exec('UPDATE doc_document SET current_version = ? WHERE id = ?', version, doc.id);
  log({ entity: 'document', entityId: doc.id, action: 'document.versioned', actor, detail: { version } });
  return getDocument(doc.id);
}

/**
 * One document with its versions, opened on the way out.
 *
 * The route that reaches this checked the classification's permission first;
 * openPii turns sealed bodies back into text only while the subject's key
 * exists. After an erasure the versions read '[erased]', which is the design
 * working, not a bug to patch around.
 */
export function getDocument(id) {
  const doc = one('SELECT * FROM doc_document WHERE id = ?', Number(id));
  if (!doc) return null;
  const versions = q('SELECT * FROM doc_version WHERE document_id = ? ORDER BY version', doc.id)
    .map((v) => ({ ...v, body: openPii(v.body), sealed: isSealed(v.body) }));
  return { ...doc, versions };
}

export function listDocuments({ classification = null, state = 'active', limit = 200 } = {}) {
  let sql = 'SELECT d.*, p.display_name AS about FROM doc_document d LEFT JOIN hr_person p ON p.id = d.subject_person_id WHERE 1=1';
  const params = [];
  if (state) { sql += ' AND d.state = ?'; params.push(state); }
  if (classification) { sql += ' AND d.classification = ?'; params.push(classification); }
  sql += ' ORDER BY d.id DESC LIMIT ?';
  params.push(Number(limit));
  // List views carry no bodies at all, so there is nothing to open and nothing
  // to leak: the index of the knowledge base is Tier B by construction.
  return q(sql, ...params);
}

export function archiveDocument(id, { actor }) {
  if (!actor) refuse('archiving is an act and carries a name');
  const doc = one('SELECT id FROM doc_document WHERE id = ?', Number(id));
  if (!doc) refuse('no such document');
  exec("UPDATE doc_document SET state = 'archived' WHERE id = ?", doc.id);
  log({ entity: 'document', entityId: doc.id, action: 'document.archived', actor });
  return getDocument(doc.id);
}

/**
 * Search titles and internal bodies. Deliberately narrow: confidential and
 * restricted bodies are never searched — a search index over sealed content is
 * how sealed content leaks one snippet at a time, which is the exact failure
 * the deep-search guardrail already refuses for every other sealed column.
 */
export function searchDocuments(term, { limit = 20 } = {}) {
  const t = clean(term, 80);
  if (!t) return [];
  const like = `%${t}%`;
  return q(
    `SELECT d.id, d.title, d.classification, d.current_version, d.created_at
       FROM doc_document d
      WHERE d.state = 'active' AND (
        d.title LIKE ?
        OR (d.classification IN ('public','internal') AND EXISTS (
          SELECT 1 FROM doc_version v WHERE v.document_id = d.id AND v.version = d.current_version AND v.body LIKE ?
        ))
      )
      ORDER BY d.id DESC LIMIT ?`,
    like, like, Number(limit),
  );
}

export function documentsOverview() {
  const n = (sql) => one(sql).n;
  return {
    total: n("SELECT COUNT(*) AS n FROM doc_document WHERE state = 'active'"),
    byClassification: Object.fromEntries(CLASSIFICATIONS.map((c) => [
      c, n(`SELECT COUNT(*) AS n FROM doc_document WHERE state = 'active' AND classification = '${c}'`),
    ])),
    versions: n('SELECT COUNT(*) AS n FROM doc_version'),
    aboutPeople: n('SELECT COUNT(*) AS n FROM doc_document WHERE subject_person_id IS NOT NULL'),
    sealedVersions: n("SELECT COUNT(*) AS n FROM doc_version WHERE body LIKE 'pii:1:%'"),
    note: 'Classification is an access decision, not a label: each level maps to a permission at the route, and a '
      + 'restricted document about a person has every version\'s body sealed under that person\'s own key. Erasing '
      + 'them takes the contents; the fact a document existed, and when, survives. Versions are append-only — the '
      + 'next correction is the next version.',
  };
}
