// The command deck — what the home page needs that is about the person looking
// at it: their own console (pinned places, whether they have been through
// setup) and the day's brief.
//
// The brief is written from the record, not by a model: what waits on you,
// what changed since yesterday, what falls due today, and the one thing the
// health index says is dragging. A sentence a model wrote about the company
// every morning is a sentence somebody has to check; these are counts with
// a place to go.
import { q, one, exec } from './db.js';
import { inboxSummary } from './inbox.js';
import * as Health from './healthindex.js';
import * as Missions from './missions.js';
import * as Broadcasts from './broadcasts.js';
import { homeCountry } from './globe.js';
import * as LiveData from './livedata.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const n = (sql, ...a) => safe(() => one(sql, ...a)?.n ?? 0, 0);

const ROUTE = /^#\/[a-z0-9][a-z0-9/_-]{0,60}(\?[a-z0-9=&_-]{0,40})?$/i;
const FOCUS = ['money', 'engineering', 'sales', 'governance', 'people', 'markets', 'operations'];

export function getPrefs(username) {
  const row = one('SELECT prefs FROM user_prefs WHERE username = ?', username);
  const p = row ? safe(() => JSON.parse(row.prefs), {}) : {};
  return { pins: Array.isArray(p.pins) ? p.pins : [], onboarded: Boolean(p.onboarded), focus: Array.isArray(p.focus) ? p.focus : [], wall: Array.isArray(p.wall) ? p.wall : [] };
}

/** Only what the console knows how to use is kept: routes it can open, focus areas it knows. */
export function setPrefs(username, patch = {}) {
  const cur = getPrefs(username);
  const next = { ...cur };
  if (patch.pins !== undefined) {
    if (!Array.isArray(patch.pins)) refuse('pins is a list of places');
    next.pins = [...new Set(patch.pins.map(String).filter((h) => ROUTE.test(h)))].slice(0, 16);
  }
  if (patch.wall !== undefined) {
    if (!Array.isArray(patch.wall)) refuse('wall is a list of places');
    next.wall = [...new Set(patch.wall.map(String).filter((h) => ROUTE.test(h)))].slice(0, 12);
  }
  if (patch.focus !== undefined) {
    if (!Array.isArray(patch.focus)) refuse('focus is a list');
    next.focus = patch.focus.map(String).filter((f) => FOCUS.includes(f));
  }
  if (patch.onboarded !== undefined) next.onboarded = Boolean(patch.onboarded);
  exec(`INSERT INTO user_prefs (username, prefs, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(username) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`, username, JSON.stringify(next));
  return next;
}

/** The morning read, for one person. */
export function brief(user) {
  const username = user?.username || '';
  const inbox = safe(() => inboxSummary(), { total: 0, high: 0, items: [] });
  const health = safe(() => Health.compute(), { score: null, band: 'unknown', focus: null, pillars: [] });
  const missions = safe(() => Missions.overview(), { pct: 0, next: null, done: 0, total: 0 });
  const lines = [];
  const line = (kind, text, count, href, tone = '') => { if (count) lines.push({ kind, text, count, href, tone }); };
  line('waiting', 'things wait for a decision', inbox.total, '#/approvals', inbox.high ? 'human' : '');
  line('urgent', 'of them are urgent', inbox.high, '#/approvals', 'bad');
  line('due', 'tasks fall due today', n("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('todo','doing','blocked') AND due_date = date('now')"), '#/tasks');
  line('overdue', 'tasks are overdue', n("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('todo','doing','blocked') AND due_date < date('now')"), '#/tasks', 'bad');
  line('incidents', 'incidents are open', n("SELECT COUNT(*) AS n FROM incidents WHERE state IN ('open','mitigated')"), '#/incidents', 'bad');
  line('done', 'pieces of AI work finished since yesterday', n("SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND ended_at >= datetime('now','-1 day')"), '#/runs', 'ai');
  line('failed', 'runs failed since yesterday', n("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND created_at >= datetime('now','-1 day')"), '#/deadletter', 'bad');
  line('invoices', 'invoices are past due', n("SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE state = 'issued' AND due < date('now')"), '#/finance', 'human');
  line('bills', 'bills fall due this week', n("SELECT COUNT(*) AS n FROM fin_ap_bill WHERE state = 'approved' AND due <= date('now','+7 days')"), '#/finance');
  return {
    lines,
    health: { score: health.score, band: health.band, focus: health.focus, pillars: (health.pillars || []).map((p) => ({ id: p.id, label: p.label, score: p.score })) },
    missions: { pct: missions.pct, done: missions.done, total: missions.total, next: missions.next },
    broadcasts: username ? safe(() => Broadcasts.unread(username), []) : [],
    prefs: username ? getPrefs(username) : null,
    home: homeCountry(),
    wire: safe(() => LiveData.brief(), null),
    calm: !lines.some((l) => l.tone === 'bad' || l.tone === 'human'),
  };
}
