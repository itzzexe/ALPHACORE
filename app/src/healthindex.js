// The health index — one number for how the company is doing, and the five
// that make it up.
//
// A composite score is only honest if you can take it apart, so every pillar
// carries the readings it was scored from and where each one lives. The
// scoring is arithmetic with the thresholds written down here, not a model's
// impression: the same record always scores the same. A pillar with nothing
// to read is left out of the average rather than counted as perfect — a
// company with no bank account registered has no money score, not a good one.
//
// One snapshot a day goes into health_snapshots, so the trend line is what the
// index said on each day, not today's formula run over yesterday's data.
import { q, one, exec } from './db.js';
import { verifyChainFast } from './audit.js';
import { inboxSummary } from './inbox.js';
import { monitorOverview } from './monitor.js';
import { incomeStatement } from './ledger.js';
import { cashPosition } from './core2/bank.js';
import { runway, previousPeriod } from './boardpack.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const n = (sql, ...a) => safe(() => one(sql, ...a)?.n ?? 0, 0);
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
/** Linear from `good` (100) to `bad` (0); either direction. */
const scale = (v, good, bad) => clamp(100 * (bad - v) / (bad - good));
const back = (period, k) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7); };

function reading(label, value, score, href, unit = '') {
  return { label, value, unit, score: clamp(score), href };
}
function pillar(id, label, readings) {
  const scored = readings.filter(Boolean);
  if (!scored.length) return { id, label, score: null, readings: [] };
  return { id, label, score: clamp(scored.reduce((a, r) => a + r.score, 0) / scored.length), readings: scored };
}

function money() {
  const cash = safe(() => cashPosition(), null);
  const accounts = cash?.accounts?.length || 0;
  const period = previousPeriod();
  const months = safe(() => [0, 1, 2].map((k) => incomeStatement({ period: back(period, k) })), []);
  const r = accounts && months.length ? runway(cash.total || 0, months) : null;
  const overdue = n("SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE state = 'issued' AND due < date('now')");
  const open = n("SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE state = 'issued'");
  return pillar('money', 'Money', [
    r ? reading('Months of cash', r.months == null ? '∞' : r.months, r.months == null ? 100 : scale(r.months, 18, 2), '#/boardpack', 'months') : null,
    open ? reading('Invoices overdue', `${overdue}/${open}`, scale(overdue / open, 0, 0.5), '#/finance') : null,
  ]);
}

function operations() {
  const mon = safe(() => monitorOverview(), null);
  const incidents = n("SELECT COUNT(*) AS n FROM incidents WHERE state IN ('open','mitigated')");
  const lateSteps = n("SELECT COUNT(*) AS n FROM proc_steps WHERE state = 'active' AND due_at < datetime('now')");
  const issues = n("SELECT COUNT(*) AS n FROM ops_issues WHERE state = 'open' AND severity = 'high'");
  return pillar('operations', 'Operations', [
    reading('Open incidents', incidents, scale(incidents, 0, 5), '#/incidents'),
    mon?.total ? reading('Watched things up', `${mon.up}/${mon.total}`, scale((mon.total - mon.up) / mon.total, 0, 0.3), '#/monitors') : null,
    reading('Late process steps', lateSteps, scale(lateSteps, 0, 10), '#/procruns'),
    reading('High operational issues', issues, scale(issues, 0, 4), '#/opscenter'),
  ]);
}

function people() {
  const inbox = safe(() => inboxSummary(), { total: 0, high: 0 });
  const overdue = n("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('todo','doing','blocked') AND due_date < date('now')");
  const blocked = n("SELECT COUNT(*) AS n FROM tasks WHERE state = 'blocked'");
  return pillar('people', 'People', [
    reading('Waiting on a person', inbox.total, scale(inbox.total, 0, 40), '#/approvals'),
    reading('Urgent among them', inbox.high, scale(inbox.high, 0, 8), '#/approvals'),
    reading('Overdue tasks', overdue, scale(overdue, 0, 20), '#/tasks'),
    reading('Blocked tasks', blocked, scale(blocked, 0, 10), '#/tasks'),
  ]);
}

function ai() {
  const week = safe(() => one(`SELECT SUM(state = 'done') AS done, SUM(state IN ('failed','escalated')) AS bad, COUNT(*) AS n
      FROM runs WHERE created_at > datetime('now','-7 days') AND state NOT IN ('queued','leased','running','cancelled')`), null);
  const loop = safe(() => one("SELECT last_pass FROM si_loops WHERE last_pass IS NOT NULL ORDER BY id DESC LIMIT 1"), null);
  const dead = n("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND created_at > datetime('now','-1 day')");
  return pillar('ai', 'The workforce', [
    week?.n ? reading('Runs that finished well (7 days)', `${Math.round(100 * (week.done || 0) / week.n)}%`, 100 * (week.done || 0) / week.n, '#/runs') : null,
    loop ? reading('Last self-improvement pass rate', `${Math.round(loop.last_pass * 100)}%`, loop.last_pass * 100, '#/selfimprove') : null,
    reading('Failed runs (24 hours)', dead, scale(dead, 0, 15), '#/deadletter'),
  ]);
}

function governance() {
  const chain = safe(() => verifyChainFast(), { ok: null });
  const audits = n("SELECT COUNT(*) AS n FROM ia_findings WHERE state NOT IN ('implemented','verified') AND due < date('now')");
  const ncrs = n("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed'");
  const reviews = n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published' AND next_review < date('now')");
  const aml = n("SELECT COUNT(*) AS n FROM aml_alerts WHERE state IN ('open','investigating')");
  const risks = n("SELECT COUNT(*) AS n FROM risks WHERE state = 'open' AND likelihood * impact >= 15");
  return pillar('governance', 'Governance', [
    chain.ok === null ? null : reading('The audit record', chain.ok ? 'intact' : 'broken', chain.ok ? 100 : 0, '#/audit'),
    reading('Overdue audit actions', audits, scale(audits, 0, 6), '#/internalaudit'),
    reading('Open nonconformities', ncrs, scale(ncrs, 0, 8), '#/iso'),
    reading('Policies past review', reviews, scale(reviews, 0, 6), '#/policies'),
    reading('AML alerts open', aml, scale(aml, 0, 6), '#/aml'),
    reading('Severe open risks', risks, scale(risks, 0, 5), '#/risks'),
  ]);
}

/** The index now: the pillars, and the average of the ones that had something to read. */
export function compute() {
  const pillars = [money(), operations(), people(), ai(), governance()];
  const scored = pillars.filter((p) => p.score != null);
  const score = scored.length ? clamp(scored.reduce((a, p) => a + p.score, 0) / scored.length) : null;
  const weakest = scored.slice().sort((a, b) => a.score - b.score)[0] || null;
  const drag = weakest ? weakest.readings.slice().sort((a, b) => a.score - b.score)[0] : null;
  return {
    score,
    band: score == null ? 'unknown' : score >= 80 ? 'strong' : score >= 60 ? 'steady' : score >= 40 ? 'strained' : 'critical',
    pillars,
    focus: drag && drag.score < 80 ? { pillar: weakest.id, label: drag.label, value: drag.value, href: drag.href } : null,
    method: 'Each reading is scored 0–100 on a straight line between a good and a bad threshold written in src/healthindex.js; a pillar is the mean of its readings, the index the mean of the pillars that had anything to read.',
  };
}

/** Once a day: what the index said, kept. */
export function snapshotToday() {
  const day = new Date().toISOString().slice(0, 10);
  if (one('SELECT day FROM health_snapshots WHERE day = ?', day)) return false;
  const c = compute();
  if (c.score == null) return false;
  exec('INSERT OR IGNORE INTO health_snapshots (day, score, pillars) VALUES (?,?,?)', day, c.score,
    JSON.stringify(Object.fromEntries(c.pillars.map((p) => [p.id, p.score]))));
  return true;
}

export function overview() {
  return {
    ...compute(),
    trend: q('SELECT day, score, pillars FROM health_snapshots ORDER BY day DESC LIMIT 60').reverse()
      .map((r) => ({ day: r.day, score: r.score, pillars: JSON.parse(r.pillars) })),
  };
}
