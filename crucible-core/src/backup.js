// Backup and restore — a platform that can lose the company is not a platform.
//
// Three properties matter more than the copying itself. A backup is taken from
// a checkpointed database, so it is a whole file rather than a file plus
// whatever was still in the write-ahead log. It records the chain tip it was
// taken at, so "which backup is this" has an answer that cannot drift. And
// restoring takes a backup of the current state first, because the worst moment
// to discover you restored the wrong file is after it.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './env.js';
import { q, one, exec, db, DB_FILE } from './db.js';
import { audit, verifyChain } from './audit.js';

const DIR = path.join(ROOT, 'data', 'backups');
const KEEP = 20;

const sha256 = (file) => {
  const h = createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
};

export function takeBackup({ kind = 'manual', actor = 'human:admin' } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const tip = one('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(DIR, `crucible-${stamp}-${kind}.db`);

  // Fold the write-ahead log into the database before copying, or the copy is
  // a database that is missing its most recent minutes.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* copy anyway */ }
  fs.copyFileSync(DB_FILE, file);

  const bytes = fs.statSync(file).size;
  const r = exec(
    'INSERT INTO backups (file, kind, bytes, sha256, chain_tip, chain_hash, taken_by) VALUES (?,?,?,?,?,?,?)',
    path.relative(ROOT, file), kind, bytes, sha256(file), tip?.seq || 0, tip?.hash || null, actor,
  );
  audit({
    actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor,
    action: 'backup.taken', subjectType: 'backup', subjectId: Number(r.lastInsertRowid),
    payload: { kind, bytes, chainTip: tip?.seq || 0 },
  });
  prune();
  return getBackup(Number(r.lastInsertRowid));
}

/** A backup nobody has checked is a hope, not a backup. */
export function verifyBackup(id) {
  const b = one('SELECT * FROM backups WHERE id = ?', id);
  if (!b) throw new Error('no such backup');
  const file = path.join(ROOT, b.file);
  if (!fs.existsSync(file)) {
    exec('UPDATE backups SET verified = -1 WHERE id = ?', id);
    return { ok: false, why: 'the file is gone' };
  }
  const digest = sha256(file);
  if (digest !== b.sha256) {
    exec('UPDATE backups SET verified = -1 WHERE id = ?', id);
    return { ok: false, why: 'the file no longer matches the hash recorded when it was taken' };
  }
  // Open it and read its own chain tip. A file that copies cleanly but holds a
  // database nobody can open is not a backup of anything.
  let chain = null;
  try {
    const h = new DatabaseSync(file, { readOnly: true });
    const tip = h.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get();
    const rows = h.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    h.close();
    chain = { tip: tip?.seq || 0, entries: rows?.n || 0, matchesRecord: (tip?.hash || null) === b.chain_hash };
  } catch (err) {
    exec('UPDATE backups SET verified = -1 WHERE id = ?', id);
    return { ok: false, why: `the file will not open as a database: ${err.message}` };
  }

  exec('UPDATE backups SET verified = 1 WHERE id = ?', id);
  audit({ actorType: 'system', actorId: 'system:backup', action: 'backup.verified', subjectType: 'backup', subjectId: id, payload: { sha256: digest.slice(0, 16), chain } });
  return { ok: true, sha256: digest, chain };
}

/**
 * Restore. Takes a backup of the present first, then swaps the file in and
 * asks the process to be restarted — a live SQLite handle cannot have the file
 * replaced underneath it, and pretending otherwise would corrupt both.
 */
export function restoreBackup(id, { confirm, actor }) {
  const b = one('SELECT * FROM backups WHERE id = ?', id);
  if (!b) throw new Error('no such backup');
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person can restore the company');
  if (confirm !== 'RESTORE') throw new Error('type RESTORE to confirm — the current database is replaced');

  const check = verifyBackup(id);
  if (!check.ok) throw new Error(`refusing to restore: ${check.why}`);

  const safety = takeBackup({ kind: 'pre-restore', actor });
  const target = path.join(ROOT, b.file);
  const staged = `${DB_FILE}.restore`;
  fs.copyFileSync(target, staged);

  audit({
    actorType: 'human', actorId: actor, action: 'backup.restore_staged',
    subjectType: 'backup', subjectId: id,
    payload: { from: b.file, chainTip: b.chain_tip, safetyBackup: safety.file },
  });
  return {
    ok: true,
    staged: path.relative(ROOT, staged),
    safetyBackup: safety.file,
    // Honest about the last step rather than doing something clever and unsafe.
    next: 'stop the server, replace data/crucible.db with the staged file (and delete -wal/-shm), then start it again',
  };
}

/** Everything, as JSON, for taking somewhere that is not SQLite. */
export function exportAll({ tables = null } = {}) {
  const names = tables || q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
  const out = { exportedAt: new Date().toISOString(), chain: verifyChain(), tables: {} };
  for (const name of names) {
    // Secrets are not exported. An export is for moving a company, not for
    // moving its credentials — those are re-issued at the destination.
    if (name === 'vault_secrets') { out.tables[name] = { skipped: 'credentials are never exported' }; continue; }
    try { out.tables[name] = q(`SELECT * FROM ${name} LIMIT 50000`); } catch { out.tables[name] = { error: 'unreadable' }; }
  }
  return out;
}

function prune() {
  const extra = q('SELECT * FROM backups ORDER BY id DESC LIMIT -1 OFFSET ?', KEEP);
  for (const b of extra) {
    try { fs.rmSync(path.join(ROOT, b.file), { force: true }); } catch { /* already gone */ }
    exec('DELETE FROM backups WHERE id = ?', b.id);
  }
  return extra.length;
}

export function getBackup(id) {
  const b = one('SELECT * FROM backups WHERE id = ?', id);
  if (!b) return null;
  return { ...b, exists: fs.existsSync(path.join(ROOT, b.file)) };
}

export function backupsOverview() {
  const rows = q('SELECT * FROM backups ORDER BY id DESC').map((b) => ({ ...b, exists: fs.existsSync(path.join(ROOT, b.file)) }));
  const newest = rows[0];
  return {
    backups: rows,
    counts: {
      total: rows.length,
      verified: rows.filter((r) => r.verified === 1).length,
      missing: rows.filter((r) => !r.exists).length,
      totalBytes: rows.reduce((a, r) => a + (r.bytes || 0), 0),
    },
    newest: newest ? { at: newest.created_at, chainTip: newest.chain_tip, ageHours: Math.round((Date.now() - new Date(newest.created_at.replace(' ', 'T') + 'Z')) / 36e5) } : null,
    keeping: KEEP,
    chainNow: one('SELECT seq FROM audit_log ORDER BY seq DESC LIMIT 1')?.seq || 0,
  };
}
