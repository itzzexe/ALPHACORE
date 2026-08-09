// Notification center — the immune system, gates, and incidents surface here.
// Dedupe rule: never stack a second unread notification for the same
// source+subject; the first one is still waiting for a human.
import { q, one, exec } from './db.js';

/**
 * Which notifications are worth a person's lock screen, who is allowed to act
 * on them, and where tapping should land.
 *
 * Not everything belongs here. A push that fires for routine traffic teaches
 * people to swipe the app away, and then the one that mattered goes unseen
 * too — so this list is deliberately short and only grows for things that
 * genuinely stop the company until somebody answers.
 */
const WORTH_WAKING_SOMEBODY = {
  gate: { perm: 'gate.approve', route: '#/gate', title: 'Waiting on you', urgency: 'high' },
  decisions: { perm: 'decisions.approve', route: '#/decisions', title: 'A decision needs a person' },
  incidents: { perm: 'incidents.manage', route: '#/incidents', title: 'Incident', urgency: 'high' },
  redteam: { perm: 'redteam.run', route: '#/redteam', title: 'The red team got through', urgency: 'high' },
  treasury: { perm: 'treasury.payout', route: '#/treasury', title: 'Money is waiting for a signature', urgency: 'high' },
  budgets: { perm: 'budgets.manage', route: '#/budgets', title: 'Budget' },
  egress: { perm: 'egress.grant', route: '#/egress', title: 'The gate stopped something' },
  requests: { perm: 'requests.manage', route: '#/requests', title: 'A request needs an answer' },
};

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

  // Reaching a person is a side effect of recording the fact, never a
  // precondition of it: the row is already written above, and nothing below
  // can undo it or throw its way out of this function.
  wake({ level, source, message, subjectType, subjectId });
  return true;
}

function wake({ level, source, message, subjectType, subjectId }) {
  const spec = WORTH_WAKING_SOMEBODY[source];
  // Anything at warning level or worse is worth a push even from a source not
  // on the list; anything below it is not, however loudly it is phrased.
  if (!spec && level !== 'error' && level !== 'warn') return;

  const shape = spec || { perm: null, route: '#/', title: source || 'AlphaCore' };

  // Both of these are imported here rather than at the top: they reach outside
  // the machine and pull in crypto and the settings table, and notify() is
  // called from deep inside the seeds at boot, before any of that is wanted.

  // A push reaches an installed browser. This reaches everything else — the
  // Telegram group, the on-call webhook, a pager script — and only for what
  // genuinely stops the company, because a channel people cannot mute
  // per-message is a channel they mute entirely.
  if (level === 'error' || spec?.urgency === 'high') {
    import('./lifecycle.js')
      .then(({ alert }) => alert({
        level, subject: shape.title,
        text: `${message}

${shape.route}`,
      }))
      .catch(() => { /* the record is the fact; this is the courtesy */ });
  }

  import('./push.js')
    .then(({ pushToPermitted }) => pushToPermitted(shape.perm, {
      title: shape.title,
      // The message, and nothing else. A push crosses a machine we do not own.
      body: String(message || '').slice(0, 180),
      route: shape.route,
      tag: `${source}:${subjectId ?? ''}`,
      urgency: shape.urgency || (level === 'error' ? 'high' : 'normal'),
      subjectType,
      subjectId,
    }))
    .catch(() => { /* a lock screen is a nicety; the record is the fact */ });
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
