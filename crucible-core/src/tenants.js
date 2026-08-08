// Multi-tenancy — one installation, many companies.
//
// The obvious design is a `tenant_id` column on every table and a WHERE clause
// on every query. Across a hundred and thirty tables and four hundred
// endpoints, that is a hundred and thirty chances to forget, and the failure
// mode is one company reading another's customers.
//
// So isolation is by file. Each tenant gets its own SQLite database and its own
// worker process, and this module is the control plane that provisions, starts,
// stops and watches them. A query cannot leak across tenants because there is
// no connection that can see two of them — not as a matter of discipline, but
// as a matter of what is open.
//
// The cost is a process per company. At this scale that is the right trade:
// a Node process idles at a few tens of megabytes, and the isolation is
// absolute rather than careful.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const TENANT_DIR = path.join(ROOT, 'data', 'tenants');
const BASE_PORT = 8500;
const live = new Map();   // id → { child, port, startedAt }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** The next free port above the control plane's own. */
function allocatePort() {
  const taken = new Set(q('SELECT port FROM tenants WHERE port IS NOT NULL').map((r) => r.port));
  for (let p = BASE_PORT; p < BASE_PORT + 500; p++) if (!taken.has(p)) return p;
  throw new Error('no free port for another tenant');
}

export function createTenant({ id, name, ownerEmail = null, plan = 'standard', locale = 'en', monthlyCapUsd = 200, actor = 'human:admin' }) {
  const tid = slug(id || name);
  if (!tid) throw new Error('a tenant needs a name');
  if (one('SELECT id FROM tenants WHERE id = ?', tid)) throw new Error(`there is already a company called ${tid}`);
  fs.mkdirSync(TENANT_DIR, { recursive: true });
  const dbFile = path.join('data', 'tenants', `${tid}.db`);
  const port = allocatePort();
  exec(
    `INSERT INTO tenants (id, name, db_file, port, state, plan, owner_email, locale, monthly_cap_usd, created_by)
     VALUES (?,?,?,?, 'provisioning', ?,?,?,?,?)`,
    tid, name || tid, dbFile, port, plan, ownerEmail, locale, monthlyCapUsd, actor,
  );
  audit({ actorType: 'human', actorId: actor, action: 'tenant.created', subjectType: 'tenant', subjectId: tid, payload: { name, plan, port } });
  return getTenant(tid);
}

/**
 * Start a tenant's process. The child gets its own database file and port; it
 * knows nothing about this one, and there is no shared handle between them.
 */
export function startTenant(id, { actor = 'system:tenants' } = {}) {
  const t = one('SELECT * FROM tenants WHERE id = ?', id);
  if (!t) throw new Error('no such company');
  if (live.has(id)) return { ok: true, already: true, port: t.port };

  const child = spawn(process.execPath, ['--experimental-sqlite', path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ALPHACORE_DB: t.db_file,
      PORT: String(t.port),
      ALPHACORE_TENANT: id,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let lastErr = '';
  child.stderr.on('data', (d) => { lastErr = String(d).slice(-500); });
  child.on('exit', (code) => {
    live.delete(id);
    exec(
      "UPDATE tenants SET state = CASE WHEN ? = 0 THEN 'stopped' ELSE 'failed' END, last_error = ?, stopped_at = datetime('now') WHERE id = ?",
      code ?? 1, code ? lastErr : null, id,
    );
    audit({ actorType: 'system', actorId: 'system:tenants', action: code ? 'tenant.crashed' : 'tenant.stopped', subjectType: 'tenant', subjectId: id, payload: { code } });
  });

  live.set(id, { child, port: t.port, startedAt: new Date().toISOString() });
  exec("UPDATE tenants SET state = 'running', last_seen = datetime('now'), last_error = NULL, stopped_at = NULL WHERE id = ?", id);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'tenant.started', subjectType: 'tenant', subjectId: id, payload: { port: t.port } });
  return { ok: true, port: t.port };
}

export function stopTenant(id, { actor = 'human:admin' } = {}) {
  const running = live.get(id);
  if (running) {
    try { running.child.kill(); } catch { /* already gone */ }
    live.delete(id);
  }
  exec("UPDATE tenants SET state = 'stopped', stopped_at = datetime('now') WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'tenant.stopped', subjectType: 'tenant', subjectId: id });
  return { ok: true };
}

/**
 * Removing a company deletes its database, so it asks for the name back the way
 * a person would have to type it. There is no undo, and pretending otherwise
 * would be worse than saying so.
 */
export function deleteTenant(id, { confirm, actor }) {
  const t = one('SELECT * FROM tenants WHERE id = ?', id);
  if (!t) throw new Error('no such company');
  if (confirm !== t.id) throw new Error(`type the company id (${t.id}) to confirm — this deletes its database and cannot be undone`);
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person can delete a company');
  stopTenant(id, { actor });
  const file = path.join(ROOT, t.db_file);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${file}${suffix}`, { force: true }); } catch { /* already gone */ }
  }
  exec('DELETE FROM tenants WHERE id = ?', id);
  audit({ actorType: 'human', actorId: actor, action: 'tenant.deleted', subjectType: 'tenant', subjectId: id, payload: { name: t.name } });
  return { ok: true };
}

/** Anything that should be running and is not, gets restarted. */
export function superviseTenants() {
  let restarted = 0;
  for (const t of q("SELECT * FROM tenants WHERE state IN ('running','provisioning')")) {
    if (live.has(t.id)) {
      exec("UPDATE tenants SET last_seen = datetime('now') WHERE id = ?", t.id);
      continue;
    }
    try { startTenant(t.id); restarted++; }
    catch (err) { exec("UPDATE tenants SET state = 'failed', last_error = ? WHERE id = ?", String(err.message).slice(0, 300), t.id); }
  }
  return restarted;
}

export function getTenant(id) {
  const t = one('SELECT * FROM tenants WHERE id = ?', id);
  if (!t) return null;
  const running = live.get(id);
  return {
    ...t,
    settings: t.settings ? JSON.parse(t.settings) : {},
    up: Boolean(running),
    startedAt: running?.startedAt || null,
    url: `http://localhost:${t.port}`,
    usage: q('SELECT * FROM tenant_usage WHERE tenant_id = ? ORDER BY day DESC LIMIT 30', id),
  };
}

/** Read each tenant's own database to see what it has been doing. */
export function collectUsage() {
  let counted = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const t of q('SELECT * FROM tenants')) {
    const file = path.join(ROOT, t.db_file);
    if (!fs.existsSync(file)) continue;
    try {
      // Opened read-only and closed immediately: the control plane looks, it
      // does not hold a handle on somebody else's company.
      const h = new DatabaseSync(file, { readOnly: true });
      const g = (sql) => { try { return h.prepare(sql).get(); } catch { return null; } };
      const runs = g(`SELECT COUNT(*) AS n FROM runs WHERE date(created_at) = date('now')`)?.n || 0;
      const calls = g(`SELECT COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS ti, COALESCE(SUM(tokens_out),0) AS toks, COALESCE(SUM(cost_usd),0) AS c
                       FROM model_calls WHERE date(created_at) = date('now')`) || {};
      const egress = g(`SELECT COUNT(*) AS n FROM egress_log WHERE date(created_at) = date('now')`)?.n || 0;
      h.close();
      exec(
        `INSERT INTO tenant_usage (tenant_id, day, runs, tokens_in, tokens_out, cost_usd, egress)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id, day) DO UPDATE SET runs = excluded.runs, tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out, cost_usd = excluded.cost_usd, egress = excluded.egress`,
        t.id, day, runs, calls.ti || 0, calls.toks || 0, calls.c || 0, egress,
      );
      counted++;
      // A company over its cap is paused rather than allowed to keep spending.
      const month = one(
        "SELECT COALESCE(SUM(cost_usd),0) AS c FROM tenant_usage WHERE tenant_id = ? AND day >= date('now','start of month')", t.id,
      ).c;
      if (t.monthly_cap_usd && month > t.monthly_cap_usd && t.state === 'running') {
        stopTenant(t.id, { actor: 'system:tenants' });
        exec("UPDATE tenants SET state = 'paused', last_error = 'monthly cap reached' WHERE id = ?", t.id);
        audit({ actorType: 'system', actorId: 'system:tenants', action: 'tenant.capped', subjectType: 'tenant', subjectId: t.id, payload: { spentUsd: month, capUsd: t.monthly_cap_usd } });
      }
    } catch { /* a tenant mid-write is read next sweep */ }
  }
  return counted;
}

export function tenantsOverview() {
  const rows = q('SELECT * FROM tenants ORDER BY created_at DESC').map((t) => ({
    ...t,
    up: live.has(t.id),
    url: `http://localhost:${t.port}`,
    monthUsd: one("SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS c FROM tenant_usage WHERE tenant_id = ? AND day >= date('now','start of month')", t.id).c,
    todayRuns: one("SELECT COALESCE(runs,0) AS n FROM tenant_usage WHERE tenant_id = ? AND day = date('now')", t.id)?.n || 0,
  }));
  return {
    tenants: rows,
    counts: {
      total: rows.length,
      running: rows.filter((r) => r.up).length,
      paused: rows.filter((r) => r.state === 'paused').length,
      failed: rows.filter((r) => r.state === 'failed').length,
    },
    spendThisMonthUsd: rows.reduce((a, r) => a + (r.monthUsd || 0), 0),
    isolation: 'one database file and one process per company — a query cannot reach across, because no connection can see two',
  };
}

/** Stop everything cleanly when the control plane goes down. */
export function stopAll() {
  for (const [id, running] of live) {
    try { running.child.kill(); } catch { /* already gone */ }
    live.delete(id);
  }
}
