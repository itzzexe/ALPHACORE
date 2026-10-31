// Broadcasts — one message to everybody in the company, and who has read it.
//
// The console's other channels are about a thing: a run, an invoice, a step.
// Sometimes the thing is the company — the office is closed tomorrow, the
// payment run moves to Thursday, the new policy is in force — and that needs
// to reach everyone and be seen to have reached them. A broadcast sits at the
// top of every page until the reader acknowledges it; the author sees who has.
// It stays inside the console: nothing here is sent anywhere, so it needs no
// gate, only a person to write it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const LEVELS = ['info', 'important', 'critical'];

export function post({ title, body = null, level = 'info', days = null, actor }) {
  if (!isHuman(actor)) refuse('a person writes a broadcast', 403);
  const t = String(title || '').trim().slice(0, 160);
  if (!t) refuse('a broadcast needs a title');
  if (!LEVELS.includes(level)) refuse('level is info, important or critical');
  const d = days == null || days === '' ? null : Number(days);
  if (d != null && !(d >= 1 && d <= 90)) refuse('a broadcast lasts between 1 and 90 days, or until it is ended');
  // datetime('now', NULL) is NULL, so one statement serves both a dated broadcast and an open-ended one.
  const id = Number(exec("INSERT INTO broadcasts (title, body, level, expires_at, created_by) VALUES (?,?,?,datetime('now', ?),?)",
    t, body ? String(body).slice(0, 4000) : null, level, d ? `+${d} days` : null, actor).lastInsertRowid);
  // The author has read what they wrote.
  exec('INSERT OR IGNORE INTO broadcast_acks (broadcast_id, username) VALUES (?, ?)', id, actor.slice(6));
  audit({ actorType: 'human', actorId: actor, action: 'broadcast.posted', subjectType: 'broadcast', subjectId: id, payload: { title: t, level, days: d } });
  return get(id);
}

export function end({ id, actor }) {
  if (!isHuman(actor)) refuse('a person ends a broadcast', 403);
  const r = exec("UPDATE broadcasts SET state = 'ended', ended_by = ?, ended_at = datetime('now') WHERE id = ? AND state = 'live'", actor, Number(id));
  if (!r.changes) refuse('no such live broadcast', 404);
  audit({ actorType: 'human', actorId: actor, action: 'broadcast.ended', subjectType: 'broadcast', subjectId: Number(id) });
  return get(id);
}

/** Reading is not a consequential act; it is recorded where the author can see it, not on the chain. */
export function ack({ id, username }) {
  const b = one("SELECT id FROM broadcasts WHERE id = ? AND state = 'live' AND (expires_at IS NULL OR expires_at > datetime('now'))", Number(id));
  if (!b) refuse('no such live broadcast', 404);
  exec('INSERT OR IGNORE INTO broadcast_acks (broadcast_id, username) VALUES (?, ?)', b.id, username);
  return { ok: true };
}

/** What is live and this person has not acknowledged yet — the banner. */
export function unread(username) {
  return q(`SELECT id, title, body, level, created_by, created_at FROM broadcasts b WHERE state = 'live' AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND NOT EXISTS (SELECT 1 FROM broadcast_acks a WHERE a.broadcast_id = b.id AND a.username = ?)
      ORDER BY CASE level WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, id DESC LIMIT 5`, username);
}

export function get(id) {
  const b = one('SELECT * FROM broadcasts WHERE id = ?', Number(id));
  if (!b) refuse('no such broadcast', 404);
  return { ...b, readers: q('SELECT username, acked_at FROM broadcast_acks WHERE broadcast_id = ? ORDER BY acked_at', b.id) };
}

export function overview() {
  const people = one("SELECT COUNT(*) AS n FROM users WHERE status = 'active'")?.n ?? 0;
  return {
    people,
    items: q(`SELECT b.*, (SELECT COUNT(*) FROM broadcast_acks a WHERE a.broadcast_id = b.id) AS readers,
        CASE WHEN b.state = 'live' AND (b.expires_at IS NULL OR b.expires_at > datetime('now')) THEN 1 ELSE 0 END AS live
        FROM broadcasts b ORDER BY b.id DESC LIMIT 60`),
  };
}
