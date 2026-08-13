// What the company looks like from outside, and how big it is getting.
//
// Three problems, one module, because they share a cause: nobody notices a
// system growing until it stops.
//
//   metrics     Prometheus text, no dependency. Without it the only way to
//               know anything is to open a page, which nobody does at 4am.
//
//   retention   A chain that is never deleted plus 149 tables plus a run
//               history that only grows. Left alone this is a disk-full
//               outage with a long fuse, and disk-full stops SQLite dead.
//
//   the hazard  node:sqlite is synchronous. One heavy query blocks the event
//               loop — HTTP, the WebSocket, the workers, all of it. That is
//               not a bug to fix so much as a property to respect, and the
//               only honest response is to measure it and say so.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { ROOT } from './env.js';
import { DB_FILE } from './db.js';

// -------------------------------------------------------------- the hazard --

/**
 * How long the event loop was blocked, and by what.
 *
 * Every synchronous query holds the whole process: no request is served, no
 * socket is read, no timer fires. At a hundred milliseconds nobody notices; at
 * two seconds the WebSocket drops and the browser reports the server as down,
 * which sends somebody looking in entirely the wrong place.
 *
 * This is a ring buffer in memory rather than a table, deliberately: writing a
 * row about a slow query is another query.
 */
const SLOW = [];
const SLOW_KEEP = 50;
let blockedMsTotal = 0;
let blockedCount = 0;

export function timed(label, fn) {
  const started = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    blockedMsTotal += ms;
    blockedCount++;
    const threshold = Number(getSetting('SLOW_QUERY_MS') || 250);
    if (ms > threshold) {
      SLOW.push({ label, ms: Math.round(ms), at: new Date().toISOString() });
      if (SLOW.length > SLOW_KEEP) SLOW.shift();
    }
  }
}

/** Sampled from a timer: how late the loop is, which is what users feel. */
let lagMs = 0;
let lagWorst = 0;
export function watchEventLoop({ everyMs = 500 } = {}) {
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const drift = Number(now - last) / 1e6 - everyMs;
    last = now;
    lagMs = Math.max(0, drift);
    if (lagMs > lagWorst) lagWorst = lagMs;
  }, everyMs);
  timer.unref?.();
  return timer;
}

export function loopHealth() {
  return {
    lagMs: Math.round(lagMs),
    worstLagMs: Math.round(lagWorst),
    blockedCount,
    blockedMsTotal: Math.round(blockedMsTotal),
    slowest: [...SLOW].sort((a, b) => b.ms - a.ms).slice(0, 10),
    // Said out loud rather than left to be discovered under load.
    note: 'node:sqlite is synchronous: a heavy query blocks HTTP, the WebSocket and the workers together. Sustained lag above ~200ms means the browser will start reporting this server as down.',
  };
}

// ------------------------------------------------------------------- size --

/** Rows and bytes, per table, biggest first. */
export function databaseSize() {
  const file = DB_FILE;
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const wal = fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0;

  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((t) => {
      let rows = 0;
      try { rows = one(`SELECT COUNT(*) AS n FROM "${t.name}"`).n; } catch { /* view or gone */ }
      return { table: t.name, rows };
    })
    .sort((a, b) => b.rows - a.rows);

  const free = (() => {
    try {
      const pageSize = one('PRAGMA page_size').page_size ?? 4096;
      const freelist = one('PRAGMA freelist_count').freelist_count ?? 0;
      return freelist * pageSize;
    } catch { return 0; }
  })();

  return {
    file, bytes, walBytes: wal, reclaimableBytes: free,
    totalRows: tables.reduce((n, t) => n + t.rows, 0),
    tables: tables.slice(0, 25),
  };
}

// -------------------------------------------------------------- retention --

/**
 * What may be deleted, and what may never be.
 *
 * The audit chain is not on this list and never will be: deleting an entry
 * breaks every hash after it, and the record is the one thing the whole design
 * rests on. Everything here is either derived, reproducible, or noise that has
 * served its purpose.
 *
 * Each entry says how long, in days, and why — because "why" is the part
 * somebody needs six months later when deciding whether to change it.
 */
const RETAIN = [
  { table: 'metrics', column: 'at', days: 30, why: 'the shape of last month is enough; the objectives that matter keep their own state' },
  { table: 'login_attempts', column: 'at', days: 90, why: 'long enough to see a campaign, short enough not to be a log of who was where' },
  { table: 'web_fetches', column: 'created_at', days: 60, why: 'a fetched page is evidence for a claim; the claim keeps its own hash' },
  { table: 'egress_log', column: 'created_at', days: 365, why: 'a year of what left this machine — the chain keeps the intent regardless' },
  { table: 'jobs', column: 'finished_at', days: 30, why: 'finished work, already recorded', where: "state IN ('done','dead')" },
  { table: 'notifications', column: 'created_at', days: 90, where: 'read = 1', why: 'read and acted on' },
  { table: 'live_presence', column: 'at', days: 2, why: 'who was looking at what, last Tuesday, is nobody\'s business' },
];

export function retentionPlan() {
  return RETAIN.map((r) => {
    let due = 0;
    try {
      due = one(
        `SELECT COUNT(*) AS n FROM "${r.table}" WHERE ${r.column} IS NOT NULL
         AND ${r.column} < datetime('now', ?) ${r.where ? `AND ${r.where}` : ''}`,
        `-${r.days} days`,
      ).n;
    } catch { return { ...r, missing: true, due: 0 }; }
    let total = 0;
    try { total = one(`SELECT COUNT(*) AS n FROM "${r.table}"`).n; } catch { /* gone */ }
    return { ...r, total, due };
  });
}

/**
 * Delete what is past its keep, in bounded batches.
 *
 * The batch limit is the point. A single DELETE of two million rows holds the
 * event loop for as long as it takes, and on a synchronous database that is an
 * outage caused by housekeeping — the exact failure this is meant to prevent.
 */
export function applyRetention({ actor = 'system:retention', batch = 5000, dryRun = false } = {}) {
  if (String(getSetting('RETENTION_ENABLED') ?? 'true') === 'false') {
    return { skipped: true, reason: 'retention is switched off' };
  }
  const plan = retentionPlan();
  const deleted = {};
  let total = 0;

  for (const r of plan) {
    if (r.missing || !r.due) continue;
    if (dryRun) { deleted[r.table] = r.due; total += r.due; continue; }
    const n = exec(
      `DELETE FROM "${r.table}" WHERE rowid IN (
         SELECT rowid FROM "${r.table}"
         WHERE ${r.column} IS NOT NULL AND ${r.column} < datetime('now', ?)
         ${r.where ? `AND ${r.where}` : ''} LIMIT ?)`,
      `-${r.days} days`, batch,
    ).changes;
    if (n) { deleted[r.table] = n; total += n; }
  }

  if (total && !dryRun) {
    audit({
      actorType: 'system', actorId: actor, action: 'retention.applied',
      subjectType: 'system', subjectId: 'database',
      payload: { deleted, total, note: 'the audit chain is never on this list' },
    });
  }
  return { dryRun, deleted, total };
}

// ---------------------------------------------------------------- metrics --

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/**
 * Prometheus exposition format, written by hand.
 *
 * It is a text format with four rules, and a client library to emit four rules
 * would be a dependency carrying its own registry, its own opinions about
 * process metrics, and its own upgrade treadmill.
 */
export function metricsText() {
  const lines = [];
  const metric = (name, help, type, samples) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) {
      const tags = labels && Object.keys(labels).length
        ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}`
        : '';
      lines.push(`${name}${tags} ${value}`);
    }
  };

  const n = (sql, ...p) => { try { return one(sql, ...p).n; } catch { return 0; } };

  metric('alphacore_up', 'Always 1 while the process is answering.', 'gauge', [[null, 1]]);
  metric('alphacore_uptime_seconds', 'Process uptime.', 'gauge', [[null, Math.round(process.uptime())]]);

  metric('alphacore_runs', 'Runs by state.', 'gauge',
    q('SELECT state, COUNT(*) AS n FROM runs GROUP BY state').map((r) => [{ state: r.state }, r.n]));
  metric('alphacore_jobs', 'Queue depth by state.', 'gauge',
    q('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').map((r) => [{ state: r.state }, r.n]));

  // The number the whole design turns on: work stopped until a person acts.
  metric('alphacore_awaiting_human', 'Work that has stopped for a person.', 'gauge',
    [[null, n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'")]]);

  metric('alphacore_spend_usd_total', 'Model spend, all time.', 'counter',
    [[null, (() => { try { return one('SELECT COALESCE(SUM(cost_usd), 0) AS n FROM runs').n.toFixed(6); } catch { return 0; } })()]]);
  metric('alphacore_tokens_total', 'Tokens in and out.', 'counter', [
    [{ direction: 'in' }, n('SELECT COALESCE(SUM(tokens_in), 0) AS n FROM runs')],
    [{ direction: 'out' }, n('SELECT COALESCE(SUM(tokens_out), 0) AS n FROM runs')],
  ]);

  // Which model actually served the work, not which tier was asked for.
  metric('alphacore_runs_by_model', 'Finished runs by the model that served them.', 'counter',
    q(`SELECT COALESCE(json_extract(flags, '$.model'), 'unrecorded') AS model,
              COALESCE(json_extract(flags, '$.provider'), 'unrecorded') AS provider,
              COUNT(*) AS n
       FROM runs WHERE state = 'done' GROUP BY model, provider`)
      .map((r) => [{ model: r.model, provider: r.provider }, r.n]));

  const chainOk = (() => { try { return one('SELECT COUNT(*) AS n FROM audit_log').n; } catch { return 0; } })();
  metric('alphacore_audit_entries', 'Entries on the chain.', 'counter', [[null, chainOk]]);
  metric('alphacore_anchor_age_seconds', 'Since the chain was last witnessed outside this machine. Very large means it was not.', 'gauge',
    [[null, (() => {
      try {
        const a = one("SELECT created_at FROM anchors WHERE ok = 1 ORDER BY id DESC LIMIT 1");
        if (!a) return -1;
        return Math.round((Date.now() - new Date(`${a.created_at.replace(' ', 'T')}Z`)) / 1000);
      } catch { return -1; }
    })()]]);

  metric('alphacore_incidents_open', 'Open incidents.', 'gauge',
    [[null, n("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'")]]);
  metric('alphacore_slo_breached', 'Service objectives in breach.', 'gauge',
    [[null, n("SELECT COUNT(*) AS n FROM slos WHERE state = 'breached'")]]);
  metric('alphacore_redteam_open', 'Red-team findings not yet fixed.', 'gauge',
    [[null, n("SELECT COUNT(*) AS n FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL")]]);

  const size = databaseSize();
  metric('alphacore_database_bytes', 'The database file.', 'gauge', [[null, size.bytes]]);
  metric('alphacore_wal_bytes', 'The write-ahead log.', 'gauge', [[null, size.walBytes]]);
  metric('alphacore_rows_total', 'Rows across every table.', 'gauge', [[null, size.totalRows]]);

  // The synchronous hazard, exposed rather than hidden: this is the number that
  // explains "the server was down" when the process never stopped.
  metric('alphacore_event_loop_lag_ms', 'How late the event loop is. node:sqlite is synchronous, so a heavy query shows here.', 'gauge',
    [[null, Math.round(lagMs)]]);
  metric('alphacore_slow_queries_total', 'Operations that blocked longer than SLOW_QUERY_MS.', 'counter', [[null, SLOW.length]]);

  metric('alphacore_push_subscriptions', 'Devices that can be told something is waiting.', 'gauge',
    [[null, n('SELECT COUNT(*) AS n FROM push_subscriptions WHERE retired_at IS NULL')]]);

  return `${lines.join('\n')}\n`;
}

export function observabilityOverview() {
  return {
    loop: loopHealth(),
    size: databaseSize(),
    retention: {
      enabled: String(getSetting('RETENTION_ENABLED') ?? 'true') !== 'false',
      plan: retentionPlan(),
      // Stated where somebody will read it, not only in the source.
      neverDeleted: ['audit_log', 'anchors', 'pii_subjects'],
    },
    metricsEndpoint: '/metrics',
  };
}
