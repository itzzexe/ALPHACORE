// Engineering metrics — the four numbers that say whether a team ships well,
// measured from what happened rather than reported by anybody.
//
// Deployment frequency, lead time, change failure rate and time to restore
// (the DORA four) come from the release table, the change sets and the
// incident log. Next to them sit the numbers particular to a company whose
// engineers are partly models: how often a person accepts what an AI engineer
// proposes, and how much of what the reviewers find actually gets fixed.
//
// A number with no data behind it is reported as null, not as zero — "we
// deployed nothing" and "we cannot tell" are different answers.
import { q, one } from '../db.js';
import { qualityGate, gateMode } from './reviews.js';

const soft = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// SQLite writes UTC without saying so; an ISO string from JavaScript already does.
const utc = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? String(s) : `${String(s).replace(' ', 'T')}Z`);
const minutesBetween = (a, b) => (utc(b) - utc(a)) / 60000;

/** Elite / high / medium / low, by the published DORA bands. */
function band(metric, v) {
  if (v === null || v === undefined) return null;
  switch (metric) {
    case 'frequency': return v >= 7 ? 'elite' : v >= 1 ? 'high' : v >= 0.25 ? 'medium' : 'low';         // per week
    case 'lead': return v <= 60 * 24 ? 'elite' : v <= 60 * 24 * 7 ? 'high' : v <= 60 * 24 * 30 ? 'medium' : 'low'; // minutes
    case 'failure': return v <= 0.05 ? 'elite' : v <= 0.15 ? 'high' : v <= 0.3 ? 'medium' : 'low';       // ratio
    case 'restore': return v <= 60 ? 'elite' : v <= 60 * 24 ? 'high' : v <= 60 * 24 * 7 ? 'medium' : 'low'; // minutes
    default: return null;
  }
}

export function engineeringMetrics({ days = 30 } = {}) {
  const since = `-${Math.max(1, Math.min(365, Number(days) || 30))} days`;
  const weeks = Math.max(1, (Number(days) || 30) / 7);

  const releases = soft(() => q("SELECT state, kind, started_at, ended_at FROM dep_releases WHERE started_at >= datetime('now', ?)", since), []);
  const live = releases.filter((r) => ['live', 'superseded'].includes(r.state) && r.kind !== 'rollback');
  const failed = releases.filter((r) => r.state === 'failed' || r.kind === 'rollback');
  const finished = releases.filter((r) => r.state !== 'running' && r.state !== 'awaiting_approval');

  const changes = soft(() => q("SELECT state, created_at, decided_at, agent_id FROM forge_changes WHERE created_at >= datetime('now', ?)", since), []);
  const applied = changes.filter((c) => c.state === 'applied' && c.decided_at);
  const decided = changes.filter((c) => ['applied', 'rejected'].includes(c.state));

  const incidents = soft(() => q("SELECT created_at, resolved_at FROM incidents WHERE resolved_at IS NOT NULL AND created_at >= datetime('now', ?)", since), []);

  const frequency = live.length / weeks;
  const lead = median(applied.map((c) => minutesBetween(c.created_at, c.decided_at)).filter((x) => x >= 0));
  const failure = finished.length ? failed.length / finished.length : null;
  const restore = median(incidents.map((i) => minutesBetween(i.created_at, i.resolved_at)).filter((x) => x >= 0));

  const tests = soft(() => q("SELECT state FROM forge_commands WHERE (command LIKE '%test%' OR command LIKE '%unittest%') AND started_at >= datetime('now', ?) AND state != 'running'", since), []);
  const findings = soft(() => q("SELECT f.state, f.severity, f.source FROM eng_findings f JOIN eng_reviews r ON r.id = f.review_id WHERE r.created_at >= datetime('now', ?)", since), []);
  const reviews = soft(() => q("SELECT score, verdict FROM eng_reviews WHERE state = 'done' AND created_at >= datetime('now', ?)", since), []);
  const closed = findings.filter((f) => ['fixed', 'dismissed'].includes(f.state)).length;

  const weekly = soft(() => q(`SELECT strftime('%Y-%W', started_at) AS wk, COUNT(*) AS n, SUM(state = 'failed' OR kind = 'rollback') AS bad
                               FROM dep_releases WHERE started_at >= datetime('now', '-84 days') GROUP BY wk ORDER BY wk`), []);
  const changeWeekly = soft(() => q(`SELECT strftime('%Y-%W', created_at) AS wk, COUNT(*) AS n, SUM(state = 'applied') AS applied
                                     FROM forge_changes WHERE created_at >= datetime('now', '-84 days') GROUP BY wk ORDER BY wk`), []);

  return {
    days: Number(days) || 30,
    dora: {
      frequency: { value: Number(frequency.toFixed(2)), unit: 'per week', band: releases.length ? band('frequency', frequency) : null, n: live.length },
      leadTime: { value: lead === null ? null : Math.round(lead), unit: 'minutes, request to applied', band: band('lead', lead), n: applied.length },
      changeFailure: { value: failure === null ? null : Number(failure.toFixed(3)), unit: 'of releases', band: band('failure', failure), n: finished.length },
      timeToRestore: { value: restore === null ? null : Math.round(restore), unit: 'minutes, incident to resolved', band: band('restore', restore), n: incidents.length },
    },
    ai: {
      proposed: changes.length,
      applied: applied.length,
      rejected: changes.filter((c) => c.state === 'rejected').length,
      failed: changes.filter((c) => c.state === 'failed').length,
      acceptance: decided.length ? Number((applied.length / decided.length).toFixed(3)) : null,
      byAgent: Object.values(changes.reduce((m, c) => {
        const a = (m[c.agent_id] ||= { agent: c.agent_id, proposed: 0, applied: 0 });
        a.proposed += 1; if (c.state === 'applied') a.applied += 1; return m;
      }, {})),
    },
    quality: {
      reviews: reviews.length,
      avgScore: reviews.length ? Math.round(reviews.reduce((a, r) => a + (r.score || 0), 0) / reviews.length) : null,
      failing: reviews.filter((r) => r.verdict === 'fail').length,
      findings: findings.length,
      open: findings.filter((f) => f.state === 'open').length,
      openCritical: findings.filter((f) => f.state === 'open' && f.severity === 'critical').length,
      closeRate: findings.length ? Number((closed / findings.length).toFixed(3)) : null,
      fromScanner: findings.filter((f) => f.source === 'scanner').length,
      fromAgents: findings.filter((f) => f.source === 'agent').length,
      testRuns: tests.length,
      testPassRate: tests.length ? Number((tests.filter((t) => t.state === 'ok').length / tests.length).toFixed(3)) : null,
    },
    trend: { releases: weekly, changes: changeWeekly },
    gateMode: gateMode(),
    projects: soft(() => q("SELECT id, slug, name, kind FROM forge_projects WHERE state = 'active' ORDER BY updated_at DESC LIMIT 40"), []).map((p) => ({
      ...p,
      gate: qualityGate(p.id),
      lastRelease: soft(() => one("SELECT r.state, r.started_at FROM dep_releases r JOIN dep_targets t ON t.id = r.target_id WHERE t.project_id = ? ORDER BY r.id DESC LIMIT 1", p.id)),
      openChanges: one("SELECT COUNT(*) AS n FROM forge_changes WHERE project_id = ? AND state IN ('drafting','proposed')", p.id).n,
    })),
  };
}
