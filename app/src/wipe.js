// Factory reset — the superadmin's kill switch for all company data.
// Two levels: a data wipe (operational records cleared, identities and
// provider settings survive) and a full factory reset (users, sessions and
// settings go too). Either way the schema stays in place and the same seeds
// the server runs at boot re-create the default company, so the platform is
// immediately usable again. The audit chain restarts with a genesis entry
// recording who pulled the switch.
//
// It runs its own transaction, and it must not run inside anybody else's:
// SQLite ignores `PRAGMA foreign_keys` inside a transaction, so a wipe held in
// the route table's savepoint met the first table with a reference and
// stopped — "FOREIGN KEY constraint failed", nothing deleted, every time.
import fs from 'node:fs';
import path from 'node:path';
import { db, q, exec, one, inTransaction } from './db.js';
import { audit } from './audit.js';
import { ROOT } from './env.js';
import { seedAgents } from './workflow.js';
import { seedRituals } from './rituals.js';
import { seedVendors, seedPeople } from './corporate.js';
import { seedAdmin, hashPassword } from './auth.js';
import { seedRisks } from './pm.js';
import { seedAutomations } from './nexus.js';
import { seedPersonas } from './org.js';
import { seedOracle } from './oracle.js';
import { ensurePlaybooks } from './memory.js';
import { ensureChannels } from './chat.js';
import { seedMarketingTeam, seedMarketingOps } from './marketing.js';
import { seedConnectors } from './connectors/index.js';
import { seedBridge } from './core2/bridge.js';
import { seedBrowserConnector } from './browser.js';
import { seedConstitution } from './constitution.js';
import { seedPackages } from './packages.js';
import { seedSlos } from './observe.js';
import { seedChart } from './ledger.js';
import { ensureHubScopes } from './engineering/github.js';
import { seedWatchlist } from './markets.js';
import { seedFeeds } from './newsroom.js';
import { seedGuards } from './learning.js';
import { stopAll as stopEngine } from './engine.js';

// Tables that survive a plain data wipe: who you are and how the platform
// is configured are not "company data".
const KEEP_ON_DATA_WIPE = ['users', 'sessions', 'settings'];

// Workspace entries a wipe leaves alone: the downloaded engine and its models
// are software, gigabytes of it, not anything the company recorded.
const KEEP_IN_WORKSPACE = new Set(['_engine']);

const AUDIT_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

/** Everything the server seeds at boot, in the same order. One failing seed does not stop the rest. */
function reseed() {
  const failed = [];
  for (const [name, fn] of [
    ['agents', seedAgents], ['oracle', seedOracle], ['rituals', seedRituals], ['vendors', seedVendors],
    ['people', seedPeople], ['admin', seedAdmin], ['risks', seedRisks], ['automations', seedAutomations],
    ['personas', seedPersonas], ['playbooks', ensurePlaybooks], ['channels', ensureChannels],
    ['marketing team', seedMarketingTeam], ['marketing ops', seedMarketingOps], ['connectors', seedConnectors],
    ['bridge', seedBridge], ['browser', seedBrowserConnector], ['constitution', seedConstitution],
    ['packages', seedPackages], ['slos', seedSlos], ['chart of accounts', seedChart], ['github scopes', ensureHubScopes],
    ['watchlist', seedWatchlist], ['news feeds', seedFeeds], ['guards', seedGuards],
  ]) {
    try { fn(); } catch (e) { failed.push(`${name}: ${String(e.message || e).slice(0, 80)}`); }
  }
  return failed;
}

/**
 * @param {object} a
 * @param {string} a.actor        `human:<username>` of the person wiping
 * @param {boolean} a.full        users, sessions and settings go too
 * @param {boolean} a.workspace   generated files go too (the engine stays)
 * @param {object} a.keepLogin    on a full reset, the wiping person's username
 *                                and the password they just re-entered: they
 *                                come back as the owner, so the reset does not
 *                                lock them out of a server whose console they
 *                                cannot see.
 */
export function wipeSystem({ actor, full = false, workspace = false, keepLogin = null }) {
  if (!actor || !String(actor).startsWith('human:')) throw new Error('a wipe is a person’s act');
  if (inTransaction()) throw new Error('the wipe must run outside a transaction — foreign keys cannot be switched off inside one');
  const keep = full ? [] : KEEP_ON_DATA_WIPE;
  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((r) => r.name)
    .filter((n) => !keep.includes(n));

  try { stopEngine(); } catch { /* not running */ }

  // Off before BEGIN, or SQLite ignores it. The append-only triggers exist to
  // stop tampering, not a factory reset; they are re-armed in the finally.
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const t of tables) exec(`DELETE FROM "${t}"`);
      try {
        for (const t of tables) exec('DELETE FROM sqlite_sequence WHERE name = ?', t);
      } catch { /* no AUTOINCREMENT tables yet */ }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } finally {
    db.exec(AUDIT_TRIGGERS);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  let filesRemoved = 0;
  if (workspace) {
    const ws = path.join(ROOT, 'workspace');
    if (fs.existsSync(ws)) {
      for (const entry of fs.readdirSync(ws)) {
        if (KEEP_IN_WORKSPACE.has(entry)) continue;
        fs.rmSync(path.join(ws, entry), { recursive: true, force: true });
        filesRemoved++;
      }
    }
  }

  if (full && keepLogin?.username && keepLogin?.password) {
    exec("INSERT INTO users (username, display_name, pass, role, perms, must_change) VALUES (?, ?, ?, 'superadmin', ?, 0)",
      keepLogin.username, keepLogin.username, hashPassword(keepLogin.password), JSON.stringify(['*']));
  }
  // The genesis entry of the new chain comes first — who wiped, and how deep —
  // so the record of the reset is not buried under the reseed it caused.
  audit({
    actorType: 'human', actorId: actor, action: 'system.wiped',
    subjectType: 'system', subjectId: 'alphacore',
    payload: { full, workspace, tablesCleared: tables.length, workspaceEntriesRemoved: filesRemoved },
  });
  const seedFailures = reseed();
  if (seedFailures.length) {
    audit({ actorType: 'system', actorId: 'system:wipe', action: 'system.reseed_incomplete', subjectType: 'system', subjectId: 'alphacore', payload: { seedFailures } });
  }

  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* a reader is open; the next checkpoint catches up */ }

  return { ok: true, full, workspace, tablesCleared: tables.length, workspaceEntriesRemoved: filesRemoved, seedFailures, keptLogin: Boolean(full && keepLogin) };
}
