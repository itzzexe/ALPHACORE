// The job queue — work that must survive a dropped line.
//
// Thirty setInterval sweeps were fine while every action landed in the same
// SQLite file: if a tick threw, the next one repeated it and nothing was lost.
// The moment work leaves the machine that stops being true. A failed send is
// not a tick to retry blindly — it is one attempt out of five, with a growing
// pause between them, an idempotency key so a retry cannot double-send, and a
// dead-letter shelf for whatever never succeeds so a person can look at it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const handlers = new Map();

/** Register a kind of work. The handler gets the parsed payload. */
export function handle(kind, fn) {
  handlers.set(kind, fn);
}

/**
 * Queue a job. `idempotency` makes the same logical work impossible to enqueue
 * twice — the second call returns the first job instead of creating another.
 */
export function enqueue(kind, payload = {}, { idempotency = null, runAfter = null, maxAttempts = 5 } = {}) {
  if (idempotency) {
    const existing = one('SELECT id, state FROM jobs WHERE idempotency = ?', idempotency);
    if (existing) return existing.id;
  }
  const r = exec(
    `INSERT INTO jobs (kind, payload, idempotency, run_after, max_attempts)
     VALUES (?,?,?, COALESCE(?, datetime('now')), ?)`,
    kind, JSON.stringify(payload), idempotency, runAfter, maxAttempts,
  );
  return Number(r.lastInsertRowid);
}

/** Exponential, so a service that is down is not hammered while it recovers. */
const backoffSeconds = (attempt) => Math.min(3600, 5 * 2 ** (attempt - 1));

function lease() {
  const row = one(
    `SELECT * FROM jobs
     WHERE state = 'queued' AND run_after <= datetime('now')
     ORDER BY run_after ASC, id ASC LIMIT 1`,
  );
  if (!row) return null;
  const claimed = exec(
    "UPDATE jobs SET state = 'running', attempts = attempts + 1, leased_at = datetime('now') WHERE id = ? AND state = 'queued'",
    row.id,
  );
  return claimed.changes ? { ...row, attempts: row.attempts + 1 } : null;
}

async function runOne() {
  const job = lease();
  if (!job) return false;
  const fn = handlers.get(job.kind);
  if (!fn) {
    exec("UPDATE jobs SET state = 'dead', last_error = 'no handler', finished_at = datetime('now') WHERE id = ?", job.id);
    return true;
  }
  try {
    const payload = job.payload ? JSON.parse(job.payload) : {};
    const out = await fn(payload, job);
    exec("UPDATE jobs SET state = 'done', last_error = NULL, finished_at = datetime('now') WHERE id = ?", job.id);
    if (out && out.audit) audit(out.audit);
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 500);
    if (job.attempts >= job.max_attempts) {
      // Dead jobs stay in this table rather than the runs' dead_letter shelf —
      // different failure, different shelf, so neither list lies about the other.
      exec("UPDATE jobs SET state = 'dead', last_error = ?, finished_at = datetime('now') WHERE id = ?", msg, job.id);
      audit({ actorType: 'system', actorId: 'system:jobs', action: 'job.dead', subjectType: 'job', subjectId: job.id, payload: { kind: job.kind, attempts: job.attempts, error: msg } });
    } else {
      exec(
        `UPDATE jobs SET state = 'queued', last_error = ?, run_after = datetime('now', '+' || ? || ' seconds') WHERE id = ?`,
        msg, backoffSeconds(job.attempts), job.id,
      );
    }
  }
  return true;
}

/** Drain what is ready, bounded so one busy kind cannot starve the loop. */
export async function jobsTick(max = 8) {
  let n = 0;
  while (n < max && await runOne()) n++;
  return n;
}

export function retryJob(id, { actor = 'human:admin' } = {}) {
  const job = one('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw new Error('no such job');
  exec("UPDATE jobs SET state = 'queued', attempts = 0, run_after = datetime('now'), last_error = NULL, finished_at = NULL WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'job.retried', subjectType: 'job', subjectId: id, payload: { kind: job.kind } });
  return { ok: true };
}

export function cancelJob(id, { actor = 'human:admin' } = {}) {
  exec("UPDATE jobs SET state = 'dead', last_error = 'cancelled by ' || ?, finished_at = datetime('now') WHERE id = ? AND state IN ('queued','running')", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'job.cancelled', subjectType: 'job', subjectId: id });
  return { ok: true };
}

/** A job stuck in 'running' means the process died mid-flight. Give it back. */
export function reclaimStuck() {
  const r = exec("UPDATE jobs SET state = 'queued' WHERE state = 'running' AND leased_at < datetime('now','-10 minutes')");
  return r.changes;
}

export function jobsOverview() {
  const byState = Object.fromEntries(q('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').map((r) => [r.state, r.n]));
  return {
    counts: {
      queued: byState.queued || 0, running: byState.running || 0,
      done: byState.done || 0, failed: byState.failed || 0, dead: byState.dead || 0,
    },
    kinds: q(`SELECT kind, COUNT(*) AS n, SUM(state = 'dead') AS dead,
                     ROUND(AVG(attempts), 2) AS avg_attempts
              FROM jobs GROUP BY kind ORDER BY n DESC`),
    waiting: q("SELECT id, kind, attempts, max_attempts, run_after, last_error FROM jobs WHERE state = 'queued' ORDER BY run_after LIMIT 25"),
    recent: q("SELECT id, kind, state, attempts, last_error, created_at, finished_at FROM jobs ORDER BY id DESC LIMIT 30"),
    deadLetter: q("SELECT id, kind, attempts, last_error AS error, created_at, finished_at FROM jobs WHERE state = 'dead' ORDER BY id DESC LIMIT 20"),
    registered: [...handlers.keys()].sort(),
  };
}
