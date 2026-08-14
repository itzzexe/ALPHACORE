// Sealing what was written before there was sealing.
//
// Encryption at write protects everything from the moment it ships. It does
// nothing at all for the rows already on the disk, and those are the ones that
// have been sitting in a backup for a year — which is precisely the threat the
// whole design is aimed at. A migration that only protects future data is a
// migration that protects the least interesting data.
//
// This is a queue job rather than a script, and the difference is not
// stylistic. A script has to be remembered, run by somebody with shell access,
// on a machine that stays up; when it dies at row 40,000 of 90,000 nobody
// knows which half is done. A job resumes on the next tick from where it
// stopped, retries on its own, and leaves what it did on the chain.
//
// Three properties it has to have, and each one is a design constraint above:
//
//   Idempotent.  sealPii returns an already-sealed value untouched, so a batch
//                run twice changes nothing the second time. No bookkeeping,
//                no "done" flag to get out of step with reality.
//   Resumable.   Progress is a rowid watermark in the payload of the next job,
//                so the state lives in the queue rather than in memory.
//   Interruptible. Each batch is small and commits before the next is queued.
//                Killing the process loses at most one batch's worth of work,
//                and that work was idempotent anyway.
import { q, one, exec, db } from './db.js';
import { audit } from './audit.js';
import { enqueue, handle } from './jobs.js';
import { TIER_A, isSealed, sealPii, refFor } from './erasure.js';

/**
 * Reclaim the pages the sealing left behind.
 *
 * Sealing a row is an UPDATE, and SQLite does not zero the page the old value
 * was on — it marks it free and moves on. So a backfilled database still has
 * every plaintext transcript sitting in its free list, invisible to SQL and
 * perfectly readable to `strings`. That is not a rounding error: it is the
 * exact attacker this whole design is aimed at, holding the exact bytes we
 * just spent an hour encrypting.
 *
 * `secure_delete` fixes it going forward and VACUUM fixes the history, and
 * the backfill is not finished until both have happened. Nothing else in the
 * system needs to know: this is a property of the file, not of the schema.
 */
export function reclaimFreePages() {
  try {
    db.exec('PRAGMA secure_delete = ON;');
    db.exec('VACUUM;');
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err.message).slice(0, 200) };
  }
}

/**
 * Rows per batch.
 *
 * Small enough that a batch is over in well under a second — a long-running
 * write transaction on the same SQLite file the console is reading is how a
 * backfill turns into an outage — and large enough that ninety thousand rows
 * do not need nine hundred ticks.
 */
const BATCH = 200;

/**
 * The tables that hold Tier A, in the order they must be sealed.
 *
 * The order is not cosmetic. A row that borrows its subject from a parent —
 * a provenance line that only knows whose it is because the record above it
 * still holds a readable address — has to be sealed *before* that parent, or
 * the identifier it needed is gone and the reference left behind is one-way.
 * So borrowers go first.
 */
function plan() {
  const byTable = new Map();
  for (const c of TIER_A) {
    if (!byTable.has(c.table)) {
      byTable.set(c.table, { table: c.table, columns: [], subject: c.subject, parent: c.parent || null });
    }
    const t = byTable.get(c.table);
    t.columns.push(c.column);
    if (!t.subject.length && c.subject.length) t.subject = c.subject;
    if (!t.parent && c.parent) t.parent = c.parent;
  }
  const all = [...byTable.values()];
  return [...all.filter((t) => t.parent), ...all.filter((t) => !t.parent)];
}

const columnsOf = (table) => {
  try { return q(`PRAGMA table_info(${table})`).map((c) => c.name); } catch { return []; }
};

/** Does this table exist here, with these columns? An install may predate one. */
function usable({ table, columns, subject, parent }) {
  const cols = columnsOf(table);
  if (!cols.length) return null;
  const present = columns.filter((c) => cols.includes(c));
  if (!present.length || !cols.includes('subject_ref')) return null;

  if (parent) {
    const pcols = columnsOf(parent.table);
    const psubjects = parent.subject.filter((c) => pcols.includes(c));
    if (!cols.includes(parent.on) || !psubjects.length) return null;
    return { table, columns: present, subject: [], parent: { ...parent, subject: psubjects } };
  }
  const subjects = subject.filter((c) => cols.includes(c));
  if (!subjects.length) return null;
  return { table, columns: present, subject: subjects, parent: null };
}

/** The first still-readable identifier among a set of columns on a row. */
function readableSubject(row, columns) {
  for (const c of columns) {
    const v = row[c];
    if (v === null || v === undefined || v === '' || isSealed(v)) continue;
    return String(v);
  }
  return null;
}

/**
 * One batch: seal every Tier A value in the next `BATCH` rows past `after`.
 *
 * Returns the watermark to resume from, or null when the table is finished.
 * Nothing here throws on a single bad row — one unreadable value must not
 * stall the other eighty-nine thousand.
 */
export function sealBatch(spec, after = 0, limit = BATCH) {
  const t = usable(spec);
  if (!t) return { done: true, sealed: 0, scanned: 0, watermark: after };

  const cols = [...new Set([...t.columns, ...t.subject, ...(t.parent ? [t.parent.on] : [])])];
  const rows = q(
    `SELECT rowid AS _rowid, subject_ref, ${cols.map((c) => `"${c}"`).join(', ')}
       FROM "${t.table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    after, limit,
  );
  if (!rows.length) return { done: true, sealed: 0, scanned: 0, watermark: after };

  let sealed = 0;
  let watermark = after;
  for (const row of rows) {
    watermark = row._rowid;
    // Whose row is it? Only a value that is still readable can say — a row
    // whose subject column is already sealed was done on an earlier pass.
    let who = null;
    if (t.parent) {
      const p = one(`SELECT ${t.parent.subject.map((c) => `"${c}"`).join(', ')} FROM "${t.parent.table}" WHERE id = ?`, row[t.parent.on]);
      who = p ? readableSubject(p, t.parent.subject) : null;
    } else {
      who = readableSubject(row, t.subject);
    }
    if (!who) {
      // Nothing readable to seal under. If the row already carries a reference
      // it was sealed before; if it does not, there is no person to name and
      // sealing it would make it unreadable *and* unerasable.
      continue;
    }

    const sets = [];
    const params = [];
    for (const c of t.columns) {
      const v = row[c];
      if (v === null || v === undefined || v === '' || isSealed(v)) continue;
      sets.push(`"${c}" = ?`);
      params.push(sealPii(v, { kind: 'contact', identifier: who }));
    }
    if (!row.subject_ref) { sets.push('subject_ref = ?'); params.push(refFor('contact', who)); }
    if (!sets.length) continue;

    try {
      exec(`UPDATE "${t.table}" SET ${sets.join(', ')} WHERE rowid = ?`, ...params, row._rowid);
      sealed++;
    } catch { /* one row must not stall the rest; the next pass sees it again */ }
  }
  return { done: rows.length < limit, sealed, scanned: rows.length, watermark };
}

/** How much is left, counted rather than estimated. */
export function remaining() {
  const out = [];
  for (const spec of plan()) {
    const t = usable(spec);
    if (!t) continue;
    // A row still holding a readable value in a sealed column is a row not yet
    // done. Counted on the sealed columns themselves rather than on the subject
    // columns, so a borrower — which has no subject of its own — is counted too.
    const where = t.columns.map((c) => `("${c}" IS NOT NULL AND "${c}" != '' AND "${c}" NOT LIKE 'pii:1:%')`).join(' OR ');
    let n = 0;
    try { n = one(`SELECT COUNT(*) AS n FROM "${t.table}" WHERE ${where}`).n; } catch { continue; }
    out.push({ table: t.table, columns: t.columns, unsealed: n });
  }
  return out;
}

export const JOB_KIND = 'pii.backfill';

/**
 * Start it. Idempotent at the queue level: asking twice while one is in flight
 * returns the job already running rather than a second one racing it.
 */
export function startBackfill({ actor = 'system:backfill' } = {}) {
  const tables = plan().map((s) => usable(s)).filter(Boolean).map((t) => t.table);
  if (!tables.length) return { ok: false, why: 'no Tier A tables in this install' };
  audit({
    actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor,
    action: 'pii.backfill_started', subjectType: 'backfill', subjectId: 'tier-a',
    payload: { tables, batch: BATCH, remaining: remaining() },
  });
  const id = enqueue(JOB_KIND, { tables, index: 0, after: 0, sealed: 0, actor },
    { idempotency: `pii-backfill-${tables.join('-')}` });
  return { ok: true, jobId: id, tables, remaining: remaining() };
}

/**
 * One tick of the backfill: a batch, then re-queue itself for the next.
 *
 * The next job is enqueued *after* the batch has committed, so a crash between
 * the two loses nothing — the watermark that was written is the watermark the
 * replacement job would have used.
 */
handle(JOB_KIND, async (payload) => {
  const { tables, index = 0, after = 0, sealed = 0, actor = 'system:backfill' } = payload;
  if (index >= tables.length) {
    // Last step, and not an optional one: until the free pages are reclaimed
    // the plaintext this job spent its whole life encrypting is still in the
    // file, one `strings` away from anybody holding the disk.
    const reclaimed = reclaimFreePages();
    audit({
      actorType: 'system', actorId: actor, action: 'pii.backfill_finished',
      subjectType: 'backfill', subjectId: 'tier-a',
      payload: { sealed, tables, reclaimed: reclaimed.ok, remaining: remaining() },
    });
    return { done: true, sealed, reclaimed };
  }

  const table = tables[index];
  const spec = plan().find((s) => s.table === table);
  const res = sealBatch(spec, after);
  const total = sealed + res.sealed;

  // Progress on the chain, but one entry per table rather than one per batch:
  // a backfill over ninety thousand rows would otherwise write four hundred
  // and fifty audit entries saying nothing, and a chain nobody can read is a
  // chain nobody checks.
  if (res.done) {
    audit({
      actorType: 'system', actorId: actor, action: 'pii.backfill_table_done',
      subjectType: 'backfill', subjectId: table,
      payload: { table, sealedSoFar: total },
    });
  }

  const next = res.done
    ? { tables, index: index + 1, after: 0, sealed: total, actor }
    : { tables, index, after: res.watermark, sealed: total, actor };
  // A fresh idempotency key per step, so the next batch is a new job rather
  // than a duplicate of the one that just finished.
  enqueue(JOB_KIND, next, { idempotency: `pii-backfill-${table}-${next.index}-${next.after}` });
  return { table, ...res, sealedSoFar: total };
});

export function backfillOverview() {
  const job = one(
    "SELECT id, state, attempts, last_error, created_at, finished_at FROM jobs WHERE kind = ? ORDER BY id DESC LIMIT 1",
    JOB_KIND,
  );
  const left = remaining();
  return {
    running: Boolean(job && ['queued', 'running'].includes(job.state)),
    lastJob: job || null,
    remaining: left,
    unsealedRows: left.reduce((a, r) => a + r.unsealed, 0),
    batch: BATCH,
    note: 'Sealing is idempotent, so this is safe to start twice and safe to interrupt: a value already sealed is '
      + 'returned untouched, and progress is a rowid watermark carried in the next job rather than held in memory. '
      + 'Rows written from now on are sealed at write and never appear here.',
  };
}
