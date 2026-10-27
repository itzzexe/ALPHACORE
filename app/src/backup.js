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
import { audit, verifyChain, verifyRows } from './audit.js';
import { getSetting } from './settings.js';
import { getSecret as vaultSecret } from './vault.js';

/** The offsite passphrase: the vault first, the environment second; null ships unencrypted, as before. */
export function backupPassphrase() {
  try { return vaultSecret('BACKUP_PASSPHRASE') || process.env.BACKUP_PASSPHRASE || null; } catch { return process.env.BACKUP_PASSPHRASE || null; }
}

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
  // To the millisecond: two copies in the same second once shared a name, and
  // the second silently replaced the first while both rows still pointed at it.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const file = path.join(DIR, `alphacore-${stamp}-${kind}.db`);
  if (fs.existsSync(file)) throw new Error('a backup was taken this very millisecond — try again');

  // Fold the write-ahead log into the database before copying, or the copy is
  // a database that is missing its most recent minutes.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* copy anyway */ }
  fs.copyFileSync(DB_FILE, file);
  // Inside a request's transaction the checkpoint cannot finish, and for a
  // long time that was silent: a backup taken from the console lacked its last
  // minutes, which the first restore drill found. So the log is copied with
  // the file — nothing else writes while this synchronous code runs — and
  // folded into the copy, which is then one whole file again.
  // The copy also leaves write-ahead mode, so reading it later — a verify, a
  // drill, a restore — never scatters -wal and -shm files beside it.
  const wal = `${DB_FILE}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${file}-wal`);
  const fold = new DatabaseSync(file);
  try { fold.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;'); } finally { fold.close(); }
  for (const extra of [`${file}-wal`, `${file}-shm`]) fs.rmSync(extra, { force: true });
  // And it is checked before it is recorded: a copy whose chain stops short is
  // not a backup of now, and saying it is would be the worst kind of wrong.
  const probe = new DatabaseSync(file, { readOnly: true });
  let copied;
  try { copied = probe.prepare('SELECT MAX(seq) AS seq FROM audit_log').get()?.seq || 0; } finally { probe.close(); }
  // Opening a copy can leave its side files behind; a backup is one file.
  for (const extra of [`${file}-wal`, `${file}-shm`]) fs.rmSync(extra, { force: true });
  if (copied !== (tip?.seq || 0)) {
    fs.rmSync(file, { force: true });
    throw new Error(`the copy ends at record ${copied}, not ${tip?.seq || 0} — nothing was recorded; try again`);
  }

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
    next: 'stop the server, replace data/alphacore.db with the staged file (and delete -wal/-shm), then start it again',
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

/**
 * A restore drill: open the newest backup as if the server had been lost, and
 * check that it is a whole database with an unbroken chain. Read-only on a copy,
 * so the drill can never be the thing that damages the backup.
 *
 * A backup that has never been opened is a hope; this turns it into a dated
 * fact — "on the 3rd, the backup of the 2nd opened, passed its integrity check
 * and held a chain of 41,207 records ending where the live one did then".
 */
export function drillRestore({ actor = 'system:backup' } = {}) {
  const t0 = Date.now();
  let b = one('SELECT * FROM backups ORDER BY id DESC LIMIT 1');
  if (!b || !fs.existsSync(path.join(ROOT, b.file))) b = takeBackup({ kind: 'drill', actor });
  const copy = path.join(DIR, `drill-${process.pid}-${Date.now()}.db`);
  let result;
  try {
    fs.copyFileSync(path.join(ROOT, b.file), copy);
    const probe = new DatabaseSync(copy, { readOnly: true });
    try {
      const integrity = probe.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).join('; ');
      const tables = probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
      const chain = verifyRows(probe.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all());
      const ok = integrity === 'ok' && chain.ok && chain.tip === b.chain_tip;
      result = { ok, integrity, chainOk: chain.ok, chainTip: chain.tip, expectedTip: b.chain_tip, tables, brokenAt: chain.brokenAt };
    } finally { probe.close(); }
  } catch (e) {
    result = { ok: false, integrity: null, chainOk: false, chainTip: null, tables: 0, error: String(e.message).slice(0, 300) };
  } finally {
    for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) fs.rmSync(f, { force: true });
  }
  const took = Date.now() - t0;
  const r = exec('INSERT INTO restore_drills (backup_id, ok, integrity, chain_ok, chain_tip, tables, took_ms, detail, actor) VALUES (?,?,?,?,?,?,?,?,?)',
    b.id, result.ok ? 1 : 0, result.integrity, result.chainOk ? 1 : 0, result.chainTip, result.tables, took, JSON.stringify(result), actor);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: result.ok ? 'backup.drill_passed' : 'backup.drill_failed',
    subjectType: 'backup', subjectId: b.id, payload: { ...result, tookMs: took } });
  return { id: Number(r.lastInsertRowid), backupId: b.id, tookMs: took, ...result };
}

/** Due once a month — the cadence an auditor asks about. */
export function drillDue() {
  const last = one('SELECT created_at FROM restore_drills ORDER BY id DESC LIMIT 1')?.created_at;
  return !last || last < new Date(Date.now() - 30 * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
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
    drills: q('SELECT id, backup_id, ok, integrity, chain_ok, chain_tip, tables, took_ms, actor, created_at FROM restore_drills ORDER BY id DESC LIMIT 12'),
    drillDue: drillDue(),
    offsite: { command: Boolean(getSetting('BACKUP_SHIP_COMMAND')), encrypted: Boolean(backupPassphrase()) },
  };
}
