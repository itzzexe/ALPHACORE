// Monitoring — is it up, is it fast, is it about to run out of something.
//
// Three kinds of check:
//
//   http     a URL answers with the status it should, inside the time it
//            should, optionally containing a phrase. HTTPS checks also read
//            the certificate's expiry, because the most predictable outage
//            there is is a certificate nobody renewed.
//   tcp      a port accepts a connection.
//   server   a machine in the fleet answers and stays under its thresholds
//            for CPU, memory and disk.
//
// Two failures in a row is down — one is a blip. Going down raises a
// notification and opens an incident with a person in command; coming back
// says so on the same incident. The monitor never restarts anything itself:
// healing is a decision, and the remedy belongs to somebody who can be asked.
import net from 'node:net';
import tls from 'node:tls';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { getSetting } from './settings.js';
import { declareIncident, addIncidentUpdate, setIncidentState } from './incidents.js';
import { collect } from './servers.js';

exec(`CREATE TABLE IF NOT EXISTS mon_checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,                  -- http|tcp|server
  target           TEXT NOT NULL,                  -- URL | host:port | server id
  interval_s       INTEGER NOT NULL DEFAULT 60,
  timeout_ms       INTEGER NOT NULL DEFAULT 10000,
  expect_status    INTEGER,                        -- null = any 2xx/3xx
  expect_text      TEXT,
  thresholds       TEXT,                           -- JSON {cpu, mem, disk} for server checks
  enabled          INTEGER NOT NULL DEFAULT 1,
  state            TEXT NOT NULL DEFAULT 'unknown',-- unknown|up|degraded|down|paused
  last_checked     TEXT,
  last_latency_ms  INTEGER,
  last_error       TEXT,
  consecutive_fail INTEGER NOT NULL DEFAULT 0,
  cert_expires     TEXT,
  incident_id      INTEGER,
  target_ref       INTEGER,                        -- dep_targets.id when made by a deployment
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec(`CREATE TABLE IF NOT EXISTS mon_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id   INTEGER NOT NULL REFERENCES mon_checks(id),
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  ok         INTEGER NOT NULL,
  latency_ms INTEGER,
  status     INTEGER,
  error      TEXT
)`);
exec('CREATE INDEX IF NOT EXISTS mon_results_check ON mon_results (check_id, at)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const DEFAULT_THRESHOLDS = { cpu: 90, mem: 92, disk: 90 };

// ----------------------------------------------------------------- checks --

export function createCheck({ name, kind, target, intervalS = 60, timeoutMs = 10000, expectStatus = null, expectText = null, thresholds = null, targetRef = null, actor }) {
  if (!['http', 'tcp', 'server'].includes(kind)) refuse('kind must be http, tcp or server');
  const tgt = String(target || '').trim();
  if (kind === 'http' && !/^https?:\/\/[^\s]+$/i.test(tgt)) refuse('an http check needs a URL starting with http:// or https://');
  if (kind === 'tcp' && !/^[\w.-]+:\d{1,5}$/.test(tgt)) refuse('a tcp check needs host:port');
  if (kind === 'server' && !one('SELECT id FROM srv_servers WHERE id = ?', Number(tgt))) refuse('no such server');
  const interval = Math.max(30, Math.min(86400, Number(intervalS) || 60));
  exec(`INSERT INTO mon_checks (name, kind, target, interval_s, timeout_ms, expect_status, expect_text, thresholds, target_ref, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
  String(name || tgt).slice(0, 80), kind, tgt, interval, Math.max(1000, Math.min(60000, Number(timeoutMs) || 10000)),
  expectStatus ? Number(expectStatus) : null, expectText || null, kind === 'server' ? JSON.stringify({ ...DEFAULT_THRESHOLDS, ...(thresholds || {}) }) : null, targetRef, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: String(actor).startsWith('human') ? 'human' : 'system', actorId: actor, action: 'monitor.check_created', subjectType: 'monitor', subjectId: id, payload: { kind, target: tgt } });
  return getCheck(id);
}

export function updateCheck(id, { enabled, intervalS, expectStatus, expectText, thresholds, actor }) {
  const c = checkRow(id);
  exec(`UPDATE mon_checks SET enabled = COALESCE(?, enabled), interval_s = COALESCE(?, interval_s), expect_status = COALESCE(?, expect_status),
        expect_text = COALESCE(?, expect_text), thresholds = COALESCE(?, thresholds), state = CASE WHEN ? = 0 THEN 'paused' WHEN ? = 1 AND state = 'paused' THEN 'unknown' ELSE state END WHERE id = ?`,
  enabled === undefined ? null : (enabled ? 1 : 0), intervalS ? Math.max(30, Number(intervalS)) : null, expectStatus ? Number(expectStatus) : null,
  expectText ?? null, thresholds ? JSON.stringify({ ...DEFAULT_THRESHOLDS, ...thresholds }) : null,
  enabled === undefined ? -1 : (enabled ? 1 : 0), enabled === undefined ? -1 : (enabled ? 1 : 0), c.id);
  audit({ actorType: 'human', actorId: actor, action: 'monitor.check_updated', subjectType: 'monitor', subjectId: c.id, payload: { enabled } });
  return getCheck(c.id);
}

export function removeCheck(id, { actor }) {
  const c = checkRow(id);
  exec('DELETE FROM mon_results WHERE check_id = ?', c.id);
  exec('DELETE FROM mon_checks WHERE id = ?', c.id);
  audit({ actorType: 'human', actorId: actor, action: 'monitor.check_removed', subjectType: 'monitor', subjectId: c.id, payload: { name: c.name } });
  return { ok: true };
}

function checkRow(id) {
  const c = one('SELECT * FROM mon_checks WHERE id = ?', Number(id));
  if (!c) refuse('no such check', 404);
  return c;
}

/** Uptime and latency over a window, from the results table. */
function stats(id, hours) {
  const r = one(`SELECT COUNT(*) AS n, SUM(ok) AS up FROM mon_results WHERE check_id = ? AND at >= datetime('now', ?)`, id, `-${hours} hours`);
  const lat = q(`SELECT latency_ms FROM mon_results WHERE check_id = ? AND ok = 1 AND latency_ms IS NOT NULL AND at >= datetime('now', ?) ORDER BY latency_ms`, id, `-${hours} hours`).map((x) => x.latency_ms);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
  return { samples: r.n, uptime: r.n ? Math.round((r.up / r.n) * 10000) / 100 : null, p50: pct(0.5), p95: pct(0.95) };
}

/** One bar per hour for the last day — what the status strip draws. */
function strip(id) {
  const rows = q(`SELECT strftime('%Y-%m-%d %H', at) AS h, COUNT(*) AS n, SUM(ok) AS up FROM mon_results
                  WHERE check_id = ? AND at >= datetime('now','-24 hours') GROUP BY h ORDER BY h`, id);
  const byHour = new Map(rows.map((r) => [r.h, r]));
  const out = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3600_000);
    const key = d.toISOString().slice(0, 13).replace('T', ' ');
    const r = byHour.get(key);
    out.push({ hour: key, state: !r ? 'none' : r.up === r.n ? 'up' : r.up === 0 ? 'down' : 'partial' });
  }
  return out;
}

const view = (c) => ({
  ...c,
  thresholds: c.thresholds ? JSON.parse(c.thresholds) : null,
  day: stats(c.id, 24),
  week: stats(c.id, 24 * 7),
  strip: strip(c.id),
  certDays: c.cert_expires ? Math.floor((new Date(c.cert_expires) - Date.now()) / 864e5) : null,
});

export function listChecks() {
  return q('SELECT * FROM mon_checks ORDER BY CASE state WHEN \'down\' THEN 0 WHEN \'degraded\' THEN 1 ELSE 2 END, name').map(view);
}

export function getCheck(id) {
  const c = checkRow(id);
  return {
    ...view(c),
    recent: q('SELECT at, ok, latency_ms, status, error FROM mon_results WHERE check_id = ? ORDER BY id DESC LIMIT 120', c.id),
  };
}

// ------------------------------------------------------------------ probes --

/** Probes are swappable for the tests, which have no network. */
let probeImpl = null;
export function setProbe(fn) { probeImpl = fn; }

async function probeHttp(c) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), c.timeout_ms);
  try {
    const res = await fetch(c.target, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'AlphaCore-Monitor/1.0' } });
    const latency = Date.now() - started;
    const body = c.expect_text ? await res.text() : '';
    const statusOk = c.expect_status ? res.status === c.expect_status : res.status < 400;
    const textOk = !c.expect_text || body.includes(c.expect_text);
    return { ok: statusOk && textOk, latency, status: res.status, error: !statusOk ? `answered ${res.status}` : !textOk ? `"${c.expect_text}" not on the page` : null };
  } catch (e) {
    return { ok: false, latency: Date.now() - started, status: null, error: e.name === 'AbortError' ? `no answer in ${c.timeout_ms} ms` : (e.cause?.code || e.message) };
  } finally { clearTimeout(timer); }
}

function certExpiry(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol !== 'https:') return resolve(null);
    const sock = tls.connect({ host: u.hostname, port: Number(u.port || 443), servername: u.hostname, timeout: 8000, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to).toISOString() : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

function probeTcp(c) {
  const [host, port] = c.target.split(':');
  const started = Date.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: Number(port) });
    const finish = (ok, error = null) => { sock.destroy(); resolve({ ok, latency: Date.now() - started, status: null, error }); };
    sock.setTimeout(c.timeout_ms, () => finish(false, `no connection in ${c.timeout_ms} ms`));
    sock.once('connect', () => finish(true));
    sock.once('error', (e) => finish(false, e.code || e.message));
  });
}

async function probeServer(c) {
  const started = Date.now();
  const r = await collect(Number(c.target));
  if (!r.ok) return { ok: false, latency: Date.now() - started, status: null, error: r.error };
  const t = { ...DEFAULT_THRESHOLDS, ...JSON.parse(c.thresholds || '{}') };
  const m = r.metrics;
  const over = [
    m.cpuPct != null && m.cpuPct > t.cpu ? `CPU ${m.cpuPct}%` : null,
    m.memPct != null && m.memPct > t.mem ? `memory ${m.memPct}%` : null,
    m.diskPct != null && m.diskPct > t.disk ? `disk ${m.diskPct}%` : null,
    m.failedUnits ? `${m.failedUnits} failed service(s)` : null,
  ].filter(Boolean);
  return { ok: true, degraded: over.length > 0, latency: Date.now() - started, status: null, error: over.length ? `over threshold: ${over.join(', ')}` : null };
}

function probe(c) {
  if (probeImpl) return Promise.resolve(probeImpl(c));
  if (c.kind === 'http') return probeHttp(c);
  if (c.kind === 'tcp') return probeTcp(c);
  return probeServer(c);
}

// ------------------------------------------------------------------- run --

const commander = () => getSetting('ONCALL_COMMANDER') || 'human:owner';

/** Run one check now and fold the result into its state. */
export async function runCheck(id) {
  const c = checkRow(id);
  const r = await probe(c);
  exec('INSERT INTO mon_results (check_id, ok, latency_ms, status, error) VALUES (?,?,?,?,?)', c.id, r.ok ? 1 : 0, r.latency ?? null, r.status ?? null, r.error ?? null);
  const fails = r.ok ? 0 : c.consecutive_fail + 1;
  const next = !r.ok ? (fails >= 2 ? 'down' : c.state === 'unknown' ? 'unknown' : c.state) : r.degraded ? 'degraded' : 'up';
  exec("UPDATE mon_checks SET state = ?, last_checked = datetime('now'), last_latency_ms = ?, last_error = ?, consecutive_fail = ? WHERE id = ?",
    next, r.latency ?? null, r.error ?? null, fails, c.id);
  if (c.kind === 'http' && c.target.startsWith('https:') && (!c.cert_expires || Math.random() < 0.05)) {
    const exp = probeImpl ? null : await certExpiry(c.target);
    if (exp) exec('UPDATE mon_checks SET cert_expires = ? WHERE id = ?', exp, c.id);
  }
  if (next !== c.state) transition(c, next, r);
  return getCheck(c.id);
}

function transition(c, next, r) {
  audit({ actorType: 'system', actorId: 'system:monitor', action: `monitor.${next}`, subjectType: 'monitor', subjectId: c.id, payload: { from: c.state, error: r.error } });
  if (next === 'down') {
    notify({ level: 'crit', source: 'monitor', message: `${c.name} is DOWN — ${r.error || 'no answer'}`, subjectType: 'monitor', subjectId: c.id, dedupe: false });
    if (!c.incident_id) {
      try {
        const inc = declareIncident({ sev: 'SEV2', title: `${c.name} is down`, commander: commander(), note: `Monitor: ${r.error || 'no answer'} (target ${c.target})`, actor: 'system:monitor' });
        exec('UPDATE mon_checks SET incident_id = ? WHERE id = ?', inc.id, c.id);
      } catch { /* the notification already went out */ }
    }
  } else if (next === 'degraded') {
    notify({ level: 'warn', source: 'monitor', message: `${c.name} is degraded — ${r.error}`, subjectType: 'monitor', subjectId: c.id });
  } else if (next === 'up' && ['down', 'degraded'].includes(c.state)) {
    notify({ level: 'info', source: 'monitor', message: `${c.name} recovered (${r.latency} ms).`, subjectType: 'monitor', subjectId: c.id, dedupe: false });
    if (c.incident_id) {
      try {
        addIncidentUpdate(c.incident_id, { note: `Monitor: recovered, answering in ${r.latency} ms.`, actor: 'system:monitor' });
        setIncidentState(c.incident_id, { state: 'mitigated', actor: 'system:monitor' });
      } catch { /* a person may already have moved it on */ }
      exec('UPDATE mon_checks SET incident_id = NULL WHERE id = ?', c.id);
    }
  }
}

let ticking = false;
/** Every fifteen seconds: run whatever is due, a few at a time. */
export async function monitorTick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = q(`SELECT id FROM mon_checks WHERE enabled = 1
                   AND (last_checked IS NULL OR last_checked <= datetime('now', '-' || interval_s || ' seconds')) ORDER BY last_checked LIMIT 8`);
    await Promise.all(due.map((c) => runCheck(c.id).catch(() => null)));
    exec("DELETE FROM mon_results WHERE at < datetime('now','-14 days')");
  } finally { ticking = false; }
}

/** A deployment with a domain gets watched without anybody having to ask. */
export function ensureMonitorForTarget(t) {
  if (!t.domain || one('SELECT id FROM mon_checks WHERE target_ref = ?', t.id)) return null;
  return createCheck({ name: t.name, kind: 'http', target: `${t.ssl ? 'https' : 'http'}://${t.domain}${t.runtime === 'static' ? '/' : (t.health_path || '/')}`, targetRef: t.id, actor: 'system:deploy' });
}

export function monitorOverview() {
  const all = q('SELECT state, kind FROM mon_checks');
  const certs = q('SELECT name, cert_expires FROM mon_checks WHERE cert_expires IS NOT NULL').map((c) => ({ name: c.name, days: Math.floor((new Date(c.cert_expires) - Date.now()) / 864e5) })).filter((c) => c.days < 21);
  return {
    total: all.length,
    up: all.filter((c) => c.state === 'up').length,
    down: all.filter((c) => c.state === 'down').length,
    degraded: all.filter((c) => c.state === 'degraded').length,
    paused: all.filter((c) => c.state === 'paused').length,
    certsExpiring: certs,
    uptime24: (() => { const r = one("SELECT COUNT(*) AS n, SUM(ok) AS up FROM mon_results WHERE at >= datetime('now','-24 hours')"); return r.n ? Math.round((r.up / r.n) * 10000) / 100 : null; })(),
  };
}
