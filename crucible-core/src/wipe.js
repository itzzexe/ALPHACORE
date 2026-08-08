// Factory reset — the superadmin's kill switch for all company data.
// Two levels: a data wipe (operational records cleared, identities and
// provider settings survive) and a full factory reset (users, sessions and
// settings go too; the default superadmin is reseeded). Either way the
// schema stays in place and the boot seeds re-create the default company,
// so the platform is immediately usable again. The audit chain restarts
// with a genesis entry recording who pulled the switch.
import fs from 'node:fs';
import path from 'node:path';
import { db, q, exec } from './db.js';
import { audit } from './audit.js';
import { ROOT } from './env.js';
import { seedAgents } from './workflow.js';
import { seedRituals } from './rituals.js';
import { seedVendors, seedPeople } from './corporate.js';
import { seedAdmin } from './auth.js';
import { seedRisks } from './pm.js';
import { seedAutomations } from './nexus.js';
import { seedPersonas } from './org.js';

// Tables that survive a plain data wipe: who you are and how the platform
// is configured are not "company data".
const KEEP_ON_DATA_WIPE = ['users', 'sessions', 'settings'];

const AUDIT_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`;

export function wipeSystem({ actor, full = false, workspace = false }) {
  const keep = full ? [] : KEEP_ON_DATA_WIPE;
  const tables = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((r) => r.name)
    .filter((n) => !keep.includes(n));

  // The append-only triggers exist to stop tampering, not a factory reset;
  // they are re-armed the moment the wipe is done.
  db.exec('DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;');
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const t of tables) exec(`DELETE FROM "${t}"`);
    try {
      for (const t of tables) exec('DELETE FROM sqlite_sequence WHERE name = ?', t);
    } catch { /* no AUTOINCREMENT tables yet */ }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(AUDIT_TRIGGERS);
  }

  let filesRemoved = 0;
  if (workspace) {
    const ws = path.join(ROOT, 'workspace');
    if (fs.existsSync(ws)) {
      for (const entry of fs.readdirSync(ws)) {
        fs.rmSync(path.join(ws, entry), { recursive: true, force: true });
        filesRemoved++;
      }
    }
  }

  // Rebuild the default company so the platform boots straight into a
  // usable state (same seed set as server startup).
  seedAgents();
  seedRituals();
  seedVendors();
  seedPeople();
  seedAdmin(); // only recreates admin/alphacore when users were wiped
  seedRisks();
  seedAutomations();
  seedPersonas();

  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  // Genesis entry of the new audit chain: who wiped, and how deep.
  audit({
    actorType: 'human', actorId: actor, action: 'system.wiped',
    subjectType: 'system', subjectId: 'alphacore',
    payload: { full, workspace, tablesCleared: tables.length, workspaceEntriesRemoved: filesRemoved },
  });

  return { ok: true, full, workspace, tablesCleared: tables.length, workspaceEntriesRemoved: filesRemoved };
}
