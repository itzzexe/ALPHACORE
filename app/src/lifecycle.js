// Starting, stopping, and being told when something has gone wrong.
//
// Three things that only matter when nobody is watching, which is most of the
// time:
//
//   the drain      a process killed mid-run leaves work marked `running` that
//                  nothing owns. It is reclaimed at the next boot — but only if
//                  there *is* a next boot, and only after however long the
//                  restart takes. Finishing what is in flight first costs a few
//                  seconds and saves that.
//
//   the alert      a push reaches a phone that has the app installed. An
//                  incident at 3am on a machine nobody has installed it on
//                  reaches nobody at all, and the first anybody knows is the
//                  morning. Email and Telegram go where people already are.
//
//   the copy       a backup on the same disk protects against a mistake and
//                  not against the disk. Getting it off the machine is the
//                  difference between an inconvenience and the end of the
//                  company.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { q, one, exec, db } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { ROOT } from './env.js';

// ------------------------------------------------------------- the drain --

let draining = false;
export const isDraining = () => draining;

/**
 * Stop accepting work, let what is running finish, then go.
 *
 * The deadline is real: a supervisor sends SIGTERM and then SIGKILL some
 * seconds later, and a process that has not gone by then is killed anyway with
 * whatever it was holding. So this waits for a bounded time and then admits
 * what it is abandoning rather than hanging in the hope of finishing.
 */
export async function drain({ deadlineMs = 20_000, onStop = () => {} } = {}) {
  if (draining) return { alreadyDraining: true };
  draining = true;

  const started = Date.now();
  const inFlight = () => one("SELECT COUNT(*) AS n FROM runs WHERE state = 'running'").n
    + one("SELECT COUNT(*) AS n FROM jobs WHERE state = 'running'").n;

  const at_start = inFlight();
  if (at_start) {
    console.log(`\n  draining: ${at_start} in flight, up to ${Math.round(deadlineMs / 1000)}s to finish`);
  }

  while (inFlight() > 0 && Date.now() - started < deadlineMs) {
    await new Promise((r) => setTimeout(r, 250));
  }

  const abandoned = inFlight();
  if (abandoned) {
    // Say so, and put them back in the queue now rather than leaving the next
    // boot to discover them. If there is no next boot, this is the only record
    // that they were ever in flight.
    exec("UPDATE runs SET state = 'queued' WHERE state = 'running'");
    exec("UPDATE jobs SET state = 'queued' WHERE state = 'running'");
    console.log(`  ${abandoned} still running at the deadline — requeued`);
  }

  audit({
    actorType: 'system', actorId: 'system:lifecycle', action: 'server.stopped',
    subjectType: 'system', subjectId: 'server',
    payload: { inFlightAtStart: at_start, requeued: abandoned, tookMs: Date.now() - started },
  });

  try { onStop(); } catch { /* going down anyway */ }
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* going down anyway */ }
  console.log('  stopped cleanly\n');
  return { requeued: abandoned, tookMs: Date.now() - started };
}

/** Wire SIGINT/SIGTERM to a drain, with a hard floor if it is sent twice. */
export function handleSignals({ onStop } = {}) {
  let asked = 0;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      asked++;
      // A second one means somebody is impatient, and impatience beats
      // tidiness. Do not make them use SIGKILL to be heard.
      if (asked > 1) { console.log('\n  going now'); process.exit(1); }
      const deadline = Math.max(1000, Number(getSetting('DRAIN_SECONDS') || 20) * 1000);
      drain({ deadlineMs: deadline, onStop })
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

// ------------------------------------------------------------- the alerts --

/**
 * Where a human can be reached when they are not looking at the app.
 *
 * Push reaches an installed browser; this reaches everything else. It is
 * deliberately independent of the connector gate: an alert about the gate
 * being broken must not have to pass through it.
 */
const CHANNELS = {
  async telegram({ text, config }) {
    const token = config.botToken || getSetting('ALERT_TELEGRAM_TOKEN');
    const chat = config.chatId || getSetting('ALERT_TELEGRAM_CHAT');
    if (!token || !chat) throw new Error('no Telegram bot token or chat id');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
    return { via: 'telegram' };
  },

  async webhook({ text, subject, config }) {
    const url = config.url || getSetting('ALERT_WEBHOOK_URL');
    if (!url) throw new Error('no alert webhook set');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Slack, Discord and Mattermost all take `text`; anything else gets the
      // structured fields beside it.
      body: JSON.stringify({ text, subject, source: 'alphacore', at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`the webhook answered ${res.status}`);
    return { via: 'webhook' };
  },

  async command({ text, subject, config }) {
    // The escape hatch: mail(1), a pager script, an SMS gateway, ntfy. Argument
    // vector rather than a shell, because an alert body is attacker-influenced
    // text and a shell would make it an injection.
    const cmd = config.command || getSetting('ALERT_COMMAND');
    if (!cmd) throw new Error('no alert command set');
    const [bin, ...args] = cmd.split(/\s+/);
    await new Promise((resolve, reject) => {
      const child = execFile(bin, [...args, subject, text], { timeout: 15_000, windowsHide: true },
        (err) => (err ? reject(err) : resolve()));
      child.on('error', reject);
    });
    return { via: 'command' };
  },
};

export const ALERT_CHANNELS = Object.keys(CHANNELS);

/**
 * Send an alert, and record what happened either way.
 *
 * Never throws. Something has already gone wrong by the time this is called,
 * and an alerting failure that takes down the thing raising the alarm is a
 * cure worse than the disease.
 */
export async function alert({ subject, text, level = 'warn', channel = null }) {
  const which = channel || getSetting('ALERT_CHANNEL');
  if (!which) return { sent: false, reason: 'no alert channel is set' };
  const run = CHANNELS[which];
  if (!run) return { sent: false, reason: `no such channel: ${which}` };

  let config = {};
  try { config = JSON.parse(getSetting('ALERT_CONFIG') || '{}'); } catch { /* defaults */ }

  const company = getSetting('COMPANY_NAME') || 'AlphaCore';
  const body = `[${level.toUpperCase()}] ${company}: ${subject}\n\n${text}`;

  try {
    const r = await run({ text: body, subject, config });
    audit({
      actorType: 'system', actorId: 'system:alert', action: 'alert.sent',
      subjectType: 'alert', subjectId: subject.slice(0, 60),
      payload: { channel: which, level, ...r },
    });
    return { sent: true, channel: which };
  } catch (e) {
    audit({
      actorType: 'system', actorId: 'system:alert', action: 'alert.failed',
      subjectType: 'alert', subjectId: subject.slice(0, 60),
      payload: { channel: which, level, error: String(e.message).slice(0, 200) },
    });
    return { sent: false, reason: e.message };
  }
}

// -------------------------------------------------------------- the copy --

/**
 * Get a backup off this machine.
 *
 * A copy on the same disk survives a mistake and not the disk. This shells out
 * to whatever the operator already trusts — rclone, rsync, aws s3 cp, scp,
 * restic — because building a second-rate uploader for each of those would be
 * worse than every one of them and would need credentials of its own.
 */
export async function shipOffsite(file, { actor = 'system:backup' } = {}) {
  const cmd = getSetting('BACKUP_SHIP_COMMAND');
  if (!cmd) return { shipped: false, reason: 'no BACKUP_SHIP_COMMAND is set — the copy is on the same disk as the original' };
  if (!fs.existsSync(file)) return { shipped: false, reason: `no such file: ${file}` };

  const [bin, ...args] = cmd.split(/\s+/);
  const started = Date.now();
  try {
    await new Promise((resolve, reject) => {
      execFile(bin, [...args, file], { timeout: 10 * 60_000, windowsHide: true },
        (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout)));
    });
  } catch (e) {
    audit({
      actorType: 'system', actorId: actor, action: 'backup.ship_failed',
      subjectType: 'backup', subjectId: path.basename(file),
      payload: { error: String(e.message).slice(0, 200) },
    });
    // Loud, because a backup that silently stops leaving the machine is
    // indistinguishable from one that never did.
    await alert({
      level: 'error', subject: 'A backup did not leave the machine',
      text: `${path.basename(file)} could not be shipped: ${e.message}\n\nThe copy on this disk survives a mistake, not the disk.`,
    });
    return { shipped: false, reason: e.message };
  }

  audit({
    actorType: 'system', actorId: actor, action: 'backup.shipped',
    subjectType: 'backup', subjectId: path.basename(file),
    payload: { bytes: fs.statSync(file).size, tookMs: Date.now() - started },
  });
  return { shipped: true, tookMs: Date.now() - started };
}

/**
 * Archive the write-ahead log alongside the backup.
 *
 * A nightly copy means losing up to a day. Keeping the WAL segments between
 * copies is what turns "yesterday" into "four minutes ago" — the difference
 * between explaining a lost afternoon and not having lost one.
 */
export function archiveWal({ keep = 48 } = {}) {
  const wal = `${(getSetting('ALPHACORE_DB') || path.join(ROOT, 'data', 'alphacore.db'))}-wal`;
  const live = fs.existsSync(wal) ? wal : path.join(ROOT, 'data', 'alphacore.db-wal');
  if (!fs.existsSync(live)) return { archived: false, reason: 'no write-ahead log — the database is quiet' };

  const dir = path.join(ROOT, 'data', 'wal-archive');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(dir, `wal-${stamp}`);
  fs.copyFileSync(live, out);

  // Keep a bounded window. Unbounded archives fill the disk, and a full disk
  // stops the database — turning a backup feature into an outage.
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('wal-')).sort();
  for (const old of kept.slice(0, Math.max(0, kept.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  return { archived: true, file: out, bytes: fs.statSync(out).size, kept: Math.min(kept.length, keep) };
}

export function lifecycleOverview() {
  const dir = path.join(ROOT, 'data', 'wal-archive');
  const walFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('wal-')).sort() : [];
  const lastShipped = one("SELECT occurred_at FROM audit_log WHERE action = 'backup.shipped' ORDER BY seq DESC LIMIT 1");
  const lastFailed = one("SELECT occurred_at, payload FROM audit_log WHERE action = 'backup.ship_failed' ORDER BY seq DESC LIMIT 1");
  return {
    draining,
    drainSeconds: Number(getSetting('DRAIN_SECONDS') || 20),
    alerts: {
      channel: getSetting('ALERT_CHANNEL') || null,
      channels: ALERT_CHANNELS,
      configured: Boolean(getSetting('ALERT_CHANNEL')),
    },
    offsite: {
      // Stated as a fact, not as a setting: "not configured" here means the
      // only copies are on the disk that holds the original.
      configured: Boolean(getSetting('BACKUP_SHIP_COMMAND')),
      lastShippedAt: lastShipped?.occurred_at || null,
      lastFailureAt: lastFailed?.occurred_at || null,
    },
    walArchive: {
      segments: walFiles.length,
      oldest: walFiles[0] || null,
      newest: walFiles[walFiles.length - 1] || null,
    },
  };
}
