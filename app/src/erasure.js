// Crypto-shredding — how a right to be forgotten survives a record that
// cannot be edited.
//
// The two requirements are flatly contradictory as usually stated. The audit
// chain is append-only and hash-linked: deleting a row breaks every hash after
// it, and the whole point of the chain is that this is impossible. Meanwhile
// somebody in the EU sends an erasure request naming an email address that sits
// inside forty of those rows, and "our architecture does not allow it" is not
// one of the lawful answers.
//
// The way out is to stop storing the thing at all.
//
// Every person the company holds data about gets their own key. Their details
// are sealed under it before they are written anywhere — crucially, *before*
// the audit payload is hashed, so the chain covers the ciphertext and knows
// nothing about the plaintext. Erasing them destroys their key. The rows stay
// exactly as they were, every hash still verifies, and what was inside them is
// gone in the only sense that matters: nobody can read it, including us,
// including with the database and the master key in hand.
//
// What deliberately survives an erasure: that a person existed under some
// reference, that they asked, and when it was carried out. Erasing the erasure
// would leave no way to prove the request was honoured, which serves nobody —
// least of all the person who made it.
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit, verifyChain } from './audit.js';
import { seal as vaultSeal, open as vaultOpen } from './vault.js';

// A sealed value is a self-describing string so it survives JSON, canonical
// serialisation and a database column without any schema knowing about it.
//   pii:1:<subject ref>:<base64 iv+tag+ciphertext>
const PREFIX = 'pii:1:';
export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

/**
 * The stable reference for a person, derived rather than sequential.
 *
 * Keyed by a per-install salt so the same email in two installs gives two
 * references, and one-way so the reference itself is not a copy of the thing
 * it points at. Sequential ids would leak how many people are on file and let
 * two databases be joined by a number.
 */
function subjectRef(kind, identifier) {
  let salt = one("SELECT v FROM settings WHERE k = 'PII_SUBJECT_SALT'")?.v;
  if (!salt) {
    salt = randomBytes(32).toString('base64');
    exec("INSERT INTO settings (k, v) VALUES ('PII_SUBJECT_SALT', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", salt);
  }
  const norm = String(identifier || '').trim().toLowerCase();
  return createHash('sha256').update(`${salt}|${kind}|${norm}`).digest('hex').slice(0, 24);
}

/**
 * The key for one person, created on first sight and wrapped under the vault's
 * master key so a stolen database is not a stolen set of subject keys.
 */
function subjectKey(ref, { create = true } = {}) {
  const row = one('SELECT * FROM pii_subjects WHERE ref = ?', ref);
  if (row?.erased_at) return null;                    // shredded: nothing to return
  if (row) return Buffer.from(vaultOpen(row.wrapped_key), 'base64');
  if (!create) return null;
  const key = randomBytes(32);
  exec('INSERT INTO pii_subjects (ref, wrapped_key) VALUES (?,?)', ref, vaultSeal(key.toString('base64')));
  return key;
}

/**
 * Seal one value for one person.
 *
 * `kind` and `identifier` say *whose* data this is — usually the person's own
 * email or phone, because that is what an erasure request will name. Every
 * value sealed for the same person shares one key, so one deletion covers all
 * of them, wherever they ended up.
 */
export function sealPii(value, { kind, identifier }) {
  if (value === null || value === undefined || value === '') return value;
  if (isSealed(value)) return value;
  const ref = subjectRef(kind, identifier);
  const key = subjectKey(ref);
  if (!key) return `${PREFIX}${ref}:erased`;          // already shredded; do not resurrect
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  return `${PREFIX}${ref}:${blob}`;
}

/**
 * Seal under a reference we already hold, rather than deriving one.
 *
 * Same key, same cipher, same everything — this skips only the derivation,
 * for the case where the row knows *which* person it belongs to but no longer
 * holds anything readable that says who they are. A run's output is written
 * minutes after its input was sealed; re-deriving would mean keeping the
 * address in memory for the whole round trip in order to compute a value that
 * is already sitting in the row.
 *
 * Returns the value untouched when there is no such subject: sealing under a
 * reference nobody minted would produce something unreadable and unerasable.
 */
export function sealForRef(value, ref) {
  if (value === null || value === undefined || value === '' || !ref) return value;
  if (isSealed(value)) return value;
  const key = subjectKey(ref, { create: false });
  if (!key) return value;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return `${PREFIX}${ref}:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
}

/**
 * Read it back, if the key still exists.
 *
 * After an erasure this returns a marker rather than throwing. A page that
 * explodes because somebody exercised a legal right is a page that will be
 * quietly patched by removing the erasure.
 */
export function openPii(sealed) {
  if (!isSealed(sealed)) return sealed;
  const [, , ref, blob] = sealed.split(':');
  if (!blob || blob === 'erased') return '[erased]';
  const key = subjectKey(ref, { create: false });
  if (!key) return '[erased]';
  try {
    const buf = Buffer.from(blob, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '[unreadable]';
  }
}

/**
 * Seal a row on its way into the database.
 *
 * One helper, called by every Tier A write path, so that no write path has to
 * know which columns are Tier A — the list lives in one place and adding to it
 * seals the new column everywhere at once. Anything not Tier A is passed
 * through untouched, so this is safe to wrap around a whole row object.
 *
 * `subject_ref` is set on the same row while we still have the identifier in
 * hand. That is the only thing this adds that was not already there, and it is
 * one-way: it is the same reference erasure derives, not a copy of the address.
 *
 * @param {string} table
 * @param {object} row          the values about to be written
 * @param {object} [opts]
 * @param {string} [opts.identifier]  whose data this is, when the caller knows
 *                                    better than the column order can say
 */
export function sealRow(table, row, { identifier = null, kind = 'contact' } = {}) {
  const cols = TIER_A.filter((c) => c.table === table);
  if (!cols.length) return row;

  // Whose row is this? An explicit identifier wins — the contact centre knows
  // that an outbound call's person is the number it dialled, and no ordering of
  // columns can work that out on its own.
  let who = identifier;
  if (!who) {
    for (const candidate of cols[0].subject) {
      const v = row[candidate];
      if (v === null || v === undefined || v === '') continue;
      who = isSealed(v) ? openPii(v) : v;
      if (who && who !== '[erased]' && who !== '[unreadable]') break;
      who = null;
    }
  }
  // No identifier means no person to seal under. Writing the row in plaintext
  // is the honest outcome — a row sealed under a made-up subject would be
  // unreadable *and* unerasable, which is the worst of both.
  if (!who) return row;

  const out = { ...row };
  for (const { column } of cols) {
    if (!(column in out)) continue;
    out[column] = sealPii(out[column], { kind, identifier: who });
  }
  out.subject_ref = subjectRef(kind, who);
  return out;
}

/** Walk any structure and open every sealed value in it. */
export function openDeep(value) {
  if (isSealed(value)) return openPii(value);
  if (Array.isArray(value)) return value.map(openDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, openDeep(v)]));
  }
  return value;
}

/** Which people are on file, and which have been erased. */
export function refFor(kind, identifier) {
  return subjectRef(kind, identifier);
}

// ------------------------------------------------------------------ erasure --

// Columns that hold something about a person who never worked here. Erasure
// walks these; anything not listed is not touched, which is why the list is
// here in the open rather than inferred from column names at runtime — a
// regex that decides what counts as personal data is a regex that will one day
// decide wrongly and quietly.
// Two kinds of column, and the distinction is the whole reason this works.
//
// `match` holds the person's identifier itself — the walk compares each value
// to the email or phone the request names, because that is what an erasure
// request can name. `also` holds everything else in that same row that is about
// the same person and could never be matched: a call transcript is not equal to
// a phone number, and a support ticket's body is not equal to an address.
//
// Listing a transcript under `match` would have looked exactly like coverage
// and erased nothing — the value would never equal the identifier, so the walk
// would never see it. That is the failure this shape exists to prevent.
const PII_COLUMNS = [
  ['intel_records', ['email', 'phone', 'address', 'email2', 'phone2', 'whatsapp'], []],
  ['intel_contacts', ['email', 'phone'], ['name', 'role', 'note']],
  ['suppression_list', ['contact'], []],
  ['tenants', ['owner_email'], []],
  // Core 2's people. The address or number reaches them; the national id and the
  // emergency contact are carried because they sit on the same row and could
  // never be matched against an erasure request naming an email.
  ['hr_person', ['personal_email', 'personal_phone'], ['national_id', 'emergency_contact']],
  // Support: somebody who wrote in is a person on file, and what they wrote is
  // about them as much as the address they wrote from.
  ['tickets', ['customer'], ['subject', 'body', 'draft', 'sent_body']],
  // The contact centre. A recording and a transcript of somebody's voice are
  // the most sensitive things this company holds about anyone, and they were
  // surviving erasure entirely.
  ['calls', ['from_number', 'to_number'], ['transcript', 'recording', 'script', 'outcome', 'follow_up']],
  ['sms_messages', ['from_number', 'to_number'], ['body']],
];

/**
 * Tables reached by reference rather than by scanning.
 *
 * The walk above finds a person by comparing values to the identifier they
 * named. That works when a column holds the identifier, and it cannot work at
 * all for a provenance row reading `Ahmed Hassan: ahmed@acme.iq at /team` —
 * which is about the person, contains their address, and will never be equal to
 * it. Those rows carry `subject_ref` from the moment they are written, so they
 * are found by lookup instead of by comparison.
 *
 * This is not a second identity scheme: the reference is the same one-way
 * value `subjectRef` derives, stored rather than recomputed.
 */
const PII_BY_REF = [
  ['intel_evidence', ['value']],
  // Employment terms: a salary and a bank account, which are about a person but
  // contain nothing that equals their email address. Reached by the reference
  // the employment row carried from the moment it was written.
  ['hr_employee', ['bank_account', 'base_salary']],
  // Restricted document versions — a disciplinary note, a doctor's note held as
  // an opaque body. Sealed at write under the subject's key; found by the
  // reference each version carries.
  ['doc_version', ['body']],
  // Meeting transcripts, sealed under the organizer and found by their reference.
  ['mtg_meeting', ['transcript']],
  // Review evidence: a paragraph about a person, sealed under them.
  ['perf_review', ['evidence']],
  // A run's prompt is a copy of whatever it was asked to work on, and its
  // output is a copy of what it wrote about them. Sealing a support ticket
  // while the drafting run beside it holds the same message in plaintext moves
  // the leak one table to the left; this is where the test found it.
  ['runs', ['input', 'output']],
];

/** Every column of a table that an erasure may touch, matched or carried. */
const allColumns = (match, also) => [...match, ...also];

/**
 * Tier A — sealed at write, under the person's own key.
 *
 * The content of what somebody said, wrote or typed, and the identifiers that
 * reach them. Reading any one of these tells you something about a specific
 * person that they did not intend for you, and nothing in the company's own
 * operation needs to search or aggregate them.
 *
 * `subject` names the column on the same row that says *whose* data this is,
 * because sealing needs a person, not a table. Where two columns could serve
 * (an inbound call's number is `from`, an outbound call's is `to`), the list
 * gives both and the writer picks the one that is not the company's own line.
 *
 * Deliberately not here, each for a stated reason — see docs/THREAT-MODEL-PII.md
 * and the DECISIONS in the release notes:
 *   tickets.customer      the controller's reconciliation joins on it
 *   calls.from_number     the contact centre matches an inbound webhook on it
 *   customers.name        every report in the company groups by it
 * Their protection is disk encryption and a master key from outside the disk,
 * which is documented guidance rather than something this file enforces.
 *
 * The invariant, enforced as a test rather than promised here: every column in
 * this list must also be reachable by the walk above. A column sealed at write
 * but invisible to erasure is data nobody can delete, which is worse than
 * plaintext data everybody can.
 */
export const TIER_A = [
  // The contact centre. A recording and a transcript of somebody's voice are
  // the most sensitive things this company holds about anyone.
  { table: 'calls', column: 'transcript', subject: ['to_number', 'from_number'] },
  { table: 'calls', column: 'recording', subject: ['to_number', 'from_number'] },
  { table: 'sms_messages', column: 'body', subject: ['to_number', 'from_number'] },
  // Support: what somebody wrote in, what we drafted about them, what we sent.
  { table: 'tickets', column: 'subject', subject: ['customer'] },
  { table: 'tickets', column: 'body', subject: ['customer'] },
  { table: 'tickets', column: 'draft', subject: ['customer'] },
  { table: 'tickets', column: 'sent_body', subject: ['customer'] },
  // Intelligence: the identifiers that reach a named human being. These are the
  // rows an enrichment run produces by the thousand, and they are the ones a
  // stolen database is actually worth money for.
  { table: 'intel_contacts', column: 'email', subject: ['email', 'phone'] },
  { table: 'intel_contacts', column: 'phone', subject: ['email', 'phone'] },
  { table: 'intel_records', column: 'email', subject: ['email', 'phone'] },
  { table: 'intel_records', column: 'phone', subject: ['email', 'phone'] },
  { table: 'intel_records', column: 'email2', subject: ['email', 'phone'] },
  { table: 'intel_records', column: 'phone2', subject: ['email', 'phone'] },
  { table: 'intel_records', column: 'whatsapp', subject: ['email', 'phone'] },
  // A postal address is as much a way to reach somebody as a phone number, and
  // the provenance row that carries it is sealed — leaving the column it came
  // from readable would move the leak rather than close it.
  { table: 'intel_records', column: 'address', subject: ['email', 'phone'] },
  // The provenance trail beside them. "Ahmed Hassan: ahmed@acme.iq, seen at
  // /team" is a copy of the address the record was sealed for, and sealing the
  // record while leaving this in plaintext would have moved the leak rather
  // than closed it. Reached by reference, not by comparison — see PII_BY_REF.
  // `parent` is for the backfill only. This row has no readable identifier of
  // its own, so an existing one can only be sealed by asking the record it
  // belongs to who it is about — and only while that record is still readable,
  // which is why the backfill does this table before its parent. Once both are
  // sealed the reference is the only way back, and it is one-way by design.
  {
    table: 'intel_evidence',
    column: 'value',
    subject: [],
    parent: { table: 'intel_records', on: 'record_id', subject: ['email', 'phone'] },
  },
  // The work itself. `runs.input` is the prompt an employee was given, which
  // for anything to do with a person is a verbatim copy of what they wrote;
  // `runs.output` is what was written back about them. Neither has a
  // subject column of its own — the caller names the person at enqueue time
  // and the row carries the reference from then on.
  { table: 'runs', column: 'input', subject: [] },
  { table: 'runs', column: 'output', subject: [] },

  // ---- Core 2 ----
  //
  // The larger PII surface the enterprise galaxy brings with it. A national id
  // and a bank account are the two values in this whole platform that most
  // deserve to be unreadable on a stolen disk, and a salary is the one most
  // likely to be read by somebody with database access and no business reading
  // it — which is the third threat in the model, not an afterthought.
  { table: 'hr_person', column: 'personal_email', subject: ['personal_email', 'personal_phone'] },
  { table: 'hr_person', column: 'personal_phone', subject: ['personal_email', 'personal_phone'] },
  { table: 'hr_person', column: 'national_id', subject: ['personal_email', 'personal_phone'] },
  { table: 'hr_person', column: 'emergency_contact', subject: ['personal_email', 'personal_phone'] },
  // Employment borrows its subject from the person it is about, and is sealed
  // before them for the same reason the provenance rows are: once the person's
  // address is sealed there is nothing readable left to derive a key from.
  {
    table: 'hr_employee',
    column: 'bank_account',
    subject: [],
    parent: { table: 'hr_person', on: 'person_id', subject: ['personal_email', 'personal_phone'] },
  },
  {
    table: 'hr_employee',
    column: 'base_salary',
    subject: [],
    parent: { table: 'hr_person', on: 'person_id', subject: ['personal_email', 'personal_phone'] },
  },
  // A restricted document's body. Sealed conditionally — only when the document
  // is classified 'restricted' and is about a person — which the tiering
  // records the same way it records tickets.draft: the column is sealed at
  // write wherever there is a person to seal under.
  { table: 'doc_version', column: 'body', subject: [] },
  // A transcript is about everybody in the room; sealing has one subject. The
  // organizer's key holds it, and the limitation is in NEXT.md, not hidden.
  { table: 'mtg_meeting', column: 'transcript', subject: [] },
  { table: 'perf_review', column: 'evidence', subject: [] },
];

const TIER_A_KEYS = new Set(TIER_A.map((c) => `${c.table}.${c.column}`));
export const isTierA = (table, column) => TIER_A_KEYS.has(`${table}.${column}`);

/**
 * Which Tier A columns the erasure walk cannot reach.
 *
 * This is the cross-check the whole tiering rests on, and it is computed from
 * the two lists rather than asserted between them, so adding a Tier A column
 * and forgetting the walk fails a test instead of quietly shipping data that
 * nobody can delete.
 */
export function tierAUnreachable() {
  const reachable = new Set([
    ...PII_COLUMNS.flatMap(([table, match, also]) => allColumns(match, also).map((c) => `${table}.${c}`)),
    ...PII_BY_REF.flatMap(([table, cols]) => cols.map((c) => `${table}.${c}`)),
  ]);
  return TIER_A.map((c) => `${c.table}.${c.column}`).filter((k) => !reachable.has(k));
}

/**
 * Everything held about one person, before deciding what to do about it.
 *
 * This is the same walk that answers a subject access request, which is the
 * other half of the same law and the half people forget to build.
 */
export function findSubject({ kind = 'contact', identifier }) {
  const ref = subjectRef(kind, identifier);
  const subject = one('SELECT * FROM pii_subjects WHERE ref = ?', ref);
  const needle = String(identifier || '').trim().toLowerCase();
  const hits = [];

  for (const [table, match, also] of PII_COLUMNS) {
    let rows = [];
    try { rows = q(`SELECT rowid AS _rowid, * FROM ${table}`); } catch { continue; }
    for (const row of rows) {
      const matched = match.filter((col) => {
        const v = row[col];
        if (v === null || v === undefined || v === '') return false;
        const plain = isSealed(v) ? openPii(v) : v;
        return String(plain).trim().toLowerCase() === needle;
      });
      if (!matched.length) continue;

      // The row is theirs. Everything on it that was listed as being about the
      // same person comes with it — otherwise the address is erased and the
      // conversation it appears in is not, which erases nothing worth erasing.
      for (const col of allColumns(matched, also)) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        hits.push({
          table, rowid: row._rowid, column: col, sealed: isSealed(v),
          carried: !matched.includes(col),
        });
      }
    }
  }

  // The rows that carry the reference. No comparison, no decryption, no scan —
  // and no chance of missing one because its text did not look like an email.
  for (const [table, cols] of PII_BY_REF) {
    let rows = [];
    try { rows = q(`SELECT rowid AS _rowid, ${cols.join(', ')} FROM ${table} WHERE subject_ref = ?`, ref); } catch { continue; }
    for (const row of rows) {
      for (const col of cols) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        hits.push({ table, rowid: row._rowid, column: col, sealed: isSealed(v), carried: true, byRef: true });
      }
    }
  }

  // The chain is searched by reference, never by scanning plaintext: once
  // sealed there is no plaintext there to scan for, which is the point.
  const chained = q(
    "SELECT seq, action, occurred_at FROM audit_log WHERE payload LIKE ? ORDER BY seq",
    `%${ref}%`,
  );

  return {
    ref,
    known: Boolean(subject),
    erasedAt: subject?.erased_at || null,
    records: hits,
    auditEntries: chained.length,
    auditSample: chained.slice(0, 20),
  };
}

/**
 * Carry out an erasure.
 *
 * Three steps in this order, and the order is the whole design:
 *   1. seal anything about them still sitting in plaintext, so it is behind
 *      the key that is about to be destroyed
 *   2. destroy the key
 *   3. record that it happened, on the chain, under the reference
 *
 * Doing (2) before (1) would leave plaintext columns readable forever with no
 * key to shred them with, which is the failure mode that makes people believe
 * crypto-shredding does not work.
 */
export function eraseSubject({ kind = 'contact', identifier, reason = null, actor }) {
  if (!actor) throw new Error('an erasure is a human act and has to be signed');
  const ref = subjectRef(kind, identifier);
  const existing = one('SELECT * FROM pii_subjects WHERE ref = ?', ref);
  if (existing?.erased_at) return { ok: true, alreadyErased: true, ref, at: existing.erased_at };

  const found = findSubject({ kind, identifier });

  let sealedNow = 0;
  for (const hit of found.records) {
    if (hit.sealed) continue;
    const current = one(`SELECT ${hit.column} AS v FROM ${hit.table} WHERE rowid = ?`, hit.rowid)?.v;
    if (current === null || current === undefined) continue;
    exec(`UPDATE ${hit.table} SET ${hit.column} = ? WHERE rowid = ?`, sealPii(current, { kind, identifier }), hit.rowid);
    sealedNow++;
  }

  // Destroy the key. Overwrite rather than delete the row: the reference has to
  // survive so the erasure can be proved, and a missing row is indistinguishable
  // from a person nobody ever heard of.
  //
  // Upsert rather than branching on the `existing` read taken at the top of this
  // function, because the sealing loop above may have created the row in between:
  // sealing the first plaintext value mints the person's key, and minting a key
  // inserts the subject. Branching on the stale read meant that erasing somebody
  // who was not already on file — which is exactly the person who arrives by
  // phone or by writing to support — threw a UNIQUE violation and erased nobody.
  exec(`INSERT INTO pii_subjects (ref, wrapped_key, erased_at, erased_by, reason)
        VALUES (?, NULL, datetime('now'), ?, ?)
        ON CONFLICT(ref) DO UPDATE SET
          wrapped_key = NULL,
          erased_at   = datetime('now'),
          erased_by   = excluded.erased_by,
          reason      = excluded.reason`, ref, actor, reason);

  audit({
    actorType: 'human', actorId: actor, action: 'pii.erased',
    subjectType: 'person', subjectId: ref,
    // The identifier itself is never written here. Recording "we erased
    // alice@example.com" in an append-only log is a way of not erasing it.
    payload: { ref, sealedBeforeShredding: sealedNow, recordsCovered: found.records.length, auditEntries: found.auditEntries, reason },
  });

  return { ok: true, ref, sealedBeforeShredding: sealedNow, recordsCovered: found.records.length, auditEntries: found.auditEntries };
}

/**
 * Prove it worked, rather than asserting it.
 *
 * Re-reads everything that was sealed for this person and checks that not one
 * of it comes back as readable text, and that the chain still verifies. An
 * erasure nobody checked is a promise, not a fact.
 */
export function verifyErasure({ kind = 'contact', identifier = null, ref = null }) {
  const key = ref || subjectRef(kind, identifier);
  const subject = one('SELECT * FROM pii_subjects WHERE ref = ?', key);
  if (!subject) return { ok: false, reason: 'no such subject' };
  if (!subject.erased_at) return { ok: false, reason: 'this subject has not been erased' };

  const leaks = [];
  const byRef = PII_BY_REF.map(([table, cols]) => [table, cols, []]);
  for (const [table, match, also] of [...PII_COLUMNS, ...byRef]) {
    const cols = allColumns(match, also);
    let rows = [];
    try { rows = q(`SELECT rowid AS _rowid, ${cols.join(', ')} FROM ${table}`); } catch { continue; }
    for (const row of rows) {
      for (const col of cols) {
        const v = row[col];
        if (!isSealed(v)) continue;
        if (!v.includes(key)) continue;
        const opened = openPii(v);
        if (opened !== '[erased]' && opened !== '[unreadable]') {
          leaks.push({ table, rowid: row._rowid, column: col });
        }
      }
    }
  }

  // The other half of the promise: erasing somebody must not have damaged the
  // record of everything else. If shredding a key broke the chain, the design
  // would be wrong no matter how unreadable the data became.
  const chain = verifyChain();
  return {
    ok: leaks.length === 0 && subject.wrapped_key === null && chain.ok,
    ref: key,
    erasedAt: subject.erased_at,
    keyDestroyed: subject.wrapped_key === null,
    chainStillVerifies: chain.ok,
    leaks,
  };
}

export function erasureOverview() {
  const subjects = q('SELECT ref, erased_at, erased_by, reason, created_at FROM pii_subjects ORDER BY created_at DESC LIMIT 200');
  return {
    // The count of people on file is itself worth knowing and is not personal
    // data: it is a number, and it is the one a regulator asks for first.
    known: one('SELECT COUNT(*) AS n FROM pii_subjects').n,
    erased: one('SELECT COUNT(*) AS n FROM pii_subjects WHERE erased_at IS NOT NULL').n,
    // Split, because the difference matters to whoever is answering for this:
    // a matched column can be named in a request, a carried one is only reached
    // because it sits on a row that was matched.
    columnsCovered: PII_COLUMNS.flatMap(([t, match]) => match.map((c) => `${t}.${c}`)),
    columnsCarried: [
      ...PII_COLUMNS.flatMap(([t, , also]) => also.map((c) => `${t}.${c}`)),
      ...PII_BY_REF.flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`)),
    ],
    subjects: subjects.map((s) => ({
      ref: s.ref, erasedAt: s.erased_at, erasedBy: s.erased_by, reason: s.reason, since: s.created_at,
    })),
  };
}
