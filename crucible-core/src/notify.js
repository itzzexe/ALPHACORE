// Notification center — the immune system, gates, and incidents surface here.
// Dedupe rule: never stack a second unread notification for the same
// source+subject; the first one is still waiting for a human.
import { q, one, exec } from './db.js';

export function notify({ level = 'info', source, message, subjectType = null, subjectId = null, dedupe = true }) {
  if (dedupe && subjectId) {
    const dup = one(
      'SELECT id FROM notifications WHERE read = 0 AND source = ? AND subject_type IS ? AND subject_id = ?',
      source, subjectType, String(subjectId),
    );
    if (dup) return null;
  }
  exec(
    'INSERT INTO notifications (level, source, message, subject_type, subject_id) VALUES (?,?,?,?,?)',
    level, source, message, subjectType, subjectId === null ? null : String(subjectId),
  );
  return true;
}

export function listNotifications({ unreadOnly = false, limit = 100 } = {}) {
  return unreadOnly
    ? q('SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT ?', limit)
    : q('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', limit);
}

export function unreadCount() {
  return one('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').n;
}

export function markAllRead() {
  exec('UPDATE notifications SET read = 1 WHERE read = 0');
}
