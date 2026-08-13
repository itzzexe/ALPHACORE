// The connector layer — one contract, many services.
//
// A driver declares who it is, how it authenticates, what it can do, and how
// to do it. It never decides whether it is allowed to: that belongs to the
// egress gate, which every call below passes through. The result is that
// adding Gmail, GitHub or somebody's private API is a file, not a subsystem —
// and that no new file can quietly acquire the right to reach the world.
import { q, one, exec } from './../db.js';
import { audit } from './../audit.js';
import { attempt } from './../egress.js';
import { getSecret, putSecret } from './../vault.js';

import gmail from './gmail.js';
import gcalendar from './gcalendar.js';
import github from './github.js';
import slack from './slack.js';
import telegram from './telegram.js';
import x from './x.js';
import linkedin from './linkedin.js';
import stripe from './stripe.js';
import notion from './notion.js';
import http from './http.js';

export const DRIVERS = Object.fromEntries(
  [gmail, gcalendar, github, slack, telegram, x, linkedin, stripe, notion, http].map((d) => [d.id, d]),
);

const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

/** Register a service. It starts disconnected, and its first armed state is dry. */
export function addConnector({ id, driver, label, config = {}, allowlist = [], scopes = null, quotaDay = 200, actor = 'human:admin' }) {
  const d = DRIVERS[driver];
  if (!d) throw new Error(`no driver called ${driver}`);
  exec(
    `INSERT INTO connectors (id, driver, label, config, scopes, allowlist, quota_day, state)
     VALUES (?,?,?,?,?,?,?, 'disconnected')
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, config = excluded.config,
       scopes = excluded.scopes, allowlist = excluded.allowlist, quota_day = excluded.quota_day`,
    id, driver, label || d.label, JSON.stringify(config),
    JSON.stringify(scopes || d.capabilities), JSON.stringify(allowlist), quotaDay,
  );
  audit({ actorType: 'human', actorId: actor, action: 'connector.added', subjectType: 'connector', subjectId: id, payload: { driver, allowlist, quotaDay } });
  return getConnector(id);
}

/**
 * Hand a connector its credential and switch it on — in dry-run, always.
 * Going live is a separate, deliberate act (`setConnectorState`).
 */
export function connect(id, { secret, account = 'default', meta = {}, actor = 'human:admin' }) {
  const c = one('SELECT * FROM connectors WHERE id = ?', id);
  if (!c) throw new Error('no such connector');
  const name = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_SECRET`;
  if (secret) putSecret(name, secret, { kind: 'api_key', connector: id, actor });
  exec(
    `INSERT INTO connector_accounts (connector_id, account, secret_name, meta)
     VALUES (?,?,?,?)
     ON CONFLICT(connector_id, account) DO UPDATE SET secret_name = excluded.secret_name, meta = excluded.meta, state = 'active'`,
    id, account, name, JSON.stringify(meta),
  );
  exec("UPDATE connectors SET state = 'dry', connected_by = ?, connected_at = datetime('now') WHERE id = ?", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'connector.connected', subjectType: 'connector', subjectId: id, payload: { account, state: 'dry' } });
  return getConnector(id);
}

/** dry → live is the moment a connector can actually touch the world. */
export function setConnectorState(id, state, { actor = 'human:admin' } = {}) {
  if (!['disconnected', 'dry', 'live', 'paused'].includes(state)) throw new Error('unknown state');
  if (state === 'live' && !String(actor).startsWith('human')) throw new Error('only a person arms a connector');
  exec('UPDATE connectors SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: 'connector.state', subjectType: 'connector', subjectId: id, payload: { state } });
  return getConnector(id);
}

export function setAllowlist(id, allowlist, { actor = 'human:admin' } = {}) {
  exec('UPDATE connectors SET allowlist = ? WHERE id = ?', JSON.stringify(allowlist || []), id);
  audit({ actorType: 'human', actorId: actor, action: 'connector.allowlist', subjectType: 'connector', subjectId: id, payload: { allowlist } });
  return getConnector(id);
}

export function getConnector(id) {
  const c = one('SELECT * FROM connectors WHERE id = ?', id);
  if (!c) return null;
  const d = DRIVERS[c.driver];
  return {
    ...c,
    config: parse(c.config, {}),
    scopes: parse(c.scopes, []),
    allowlist: parse(c.allowlist, []),
    accounts: q('SELECT id, account, state, expires_at, created_at FROM connector_accounts WHERE connector_id = ?', id),
    driverInfo: d ? { label: d.label, auth: d.auth?.kind || 'none', capabilities: d.capabilities, docs: d.docs || null } : null,
    todayCalls: one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND created_at >= datetime('now','-1 day')", id).n,
  };
}

/** The credential this connector should use right now. */
export function credentialFor(id, account = 'default') {
  const row = one('SELECT secret_name FROM connector_accounts WHERE connector_id = ? AND account = ?', id, account)
    || one('SELECT secret_name FROM connector_accounts WHERE connector_id = ? LIMIT 1', id);
  return row?.secret_name ? getSecret(row.secret_name) : null;
}

/**
 * The only way to call a service. Everything — the gate, the driver, the
 * recording — happens here, so no caller can accidentally skip a step.
 */
export async function callConnector({ connector, capability, args = {}, agentId = null, runId = null, actor = null, reason = '' }) {
  const c = one('SELECT * FROM connectors WHERE id = ?', connector);
  if (!c) throw new Error(`no connector called ${connector}`);
  const driver = DRIVERS[c.driver];
  if (!driver) throw new Error(`connector ${connector} has no driver`);
  const op = driver.ops?.[capability];
  if (!op) throw new Error(`${c.driver} cannot do ${capability}`);

  const ctx = {
    connector,
    config: parse(c.config, {}),
    credential: () => credentialFor(connector),
    agentId, runId, actor,
  };
  const target = op.target ? op.target(args, ctx) : null;
  const valueUsd = op.value ? op.value(args) : 0;

  return attempt({
    connector, capability, agentId, runId, actor, target, reason,
    payload: args, valueUsd,
    call: () => op.run(args, ctx),
  });
}

/** Seed the catalogue so every service is visible before anyone connects it. */
export function seedConnectors() {
  for (const d of Object.values(DRIVERS)) {
    if (d.id === 'http') continue; // generic driver: instances are created by hand
    if (one('SELECT id FROM connectors WHERE id = ?', d.id)) continue;
    exec(
      `INSERT INTO connectors (id, driver, label, config, scopes, allowlist, quota_day, state)
       VALUES (?,?,?, '{}', ?, '[]', ?, 'disconnected')`,
      d.id, d.id, d.label, JSON.stringify(d.capabilities), d.quotaDay || 200,
    );
  }
}

export function connectorsOverview() {
  const rows = q('SELECT * FROM connectors ORDER BY state DESC, id').map((c) => ({
    ...c,
    config: parse(c.config, {}),
    scopes: parse(c.scopes, []),
    allowlist: parse(c.allowlist, []),
    driverInfo: DRIVERS[c.driver] ? { auth: DRIVERS[c.driver].auth?.kind || 'none', capabilities: DRIVERS[c.driver].capabilities, docs: DRIVERS[c.driver].docs } : null,
    accounts: q('SELECT account, state FROM connector_accounts WHERE connector_id = ?', c.id),
    today: one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND created_at >= datetime('now','-1 day')", c.id).n,
    blockedToday: one("SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND verdict = 'blocked' AND created_at >= datetime('now','-1 day')", c.id).n,
  }));
  return {
    connectors: rows,
    drivers: Object.values(DRIVERS).map((d) => ({ id: d.id, label: d.label, auth: d.auth?.kind || 'none', capabilities: d.capabilities, docs: d.docs || null })),
    counts: {
      total: rows.length,
      live: rows.filter((r) => r.state === 'live').length,
      dry: rows.filter((r) => r.state === 'dry').length,
      disconnected: rows.filter((r) => r.state === 'disconnected').length,
    },
  };
}
