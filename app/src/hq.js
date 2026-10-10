// Headquarters — the one read that answers "how is the company doing, and
// what does it need from me?"
//
// Every number here is read from the module that owns it; nothing is stored
// twice. Two lanes, because the design draws them apart on purpose: what the
// machines are doing, and what is waiting on a person.
import { q, one } from './db.js';
import { verifyChainFast } from './audit.js';
import { inboxSummary } from './inbox.js';
import { activityFeed } from './links.js';
import { forgeOverview, listProjects } from './forge.js';
import { serversOverview, listServers } from './servers.js';
import { deployOverview, listTargets } from './deploy.js';
import { monitorOverview, listChecks } from './monitor.js';
import { crewOverview, workload } from './crew.js';
import { isMockMode, companyName } from './settings.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export function headquarters(user) {
  const n = (sql, ...a) => safe(() => one(sql, ...a).n, 0);
  const inbox = safe(() => inboxSummary(), { total: 0, high: 0, items: [] });
  const machines = {
    agentsActive: n("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"),
    runsInFlight: n("SELECT COUNT(*) AS n FROM runs WHERE state IN ('queued','leased','running')"),
    runsToday: n("SELECT COUNT(*) AS n FROM runs WHERE created_at >= date('now')"),
    doneToday: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND ended_at >= date('now')"),
    spendToday: safe(() => one("SELECT COALESCE(SUM(cost_usd),0) AS v FROM model_calls WHERE created_at >= date('now')").v, 0),
  };
  const chain = safe(() => verifyChainFast(), { ok: null });
  return {
    company: safe(() => companyName(), null) || 'AlphaCore',
    greetingName: user?.displayName || user?.username || null,
    mock: safe(() => isMockMode(), false),
    chain: { ok: chain.ok, length: chain.checked ?? null },
    machines,
    people: {
      waiting: inbox.total,
      urgent: inbox.high,
      top: (inbox.items || []).slice(0, 8),
      crew: safe(() => crewOverview(), null),
      team: safe(() => workload().filter((w) => w.signal !== 'ok').slice(0, 8), []),
    },
    build: {
      forge: safe(() => forgeOverview(), null),
      projects: safe(() => listProjects().slice(0, 6).map((p) => ({ id: p.id, slug: p.slug, name: p.name, kind: p.kind, pending: p.pending, updated_at: p.updated_at, lastCommit: p.lastCommit })), []),
    },
    run: {
      servers: safe(() => serversOverview(), null),
      fleet: safe(() => listServers().map((s) => ({ id: s.id, name: s.name, environment: s.environment, state: s.state, cpu: s.metrics?.cpuPct ?? null, mem: s.metrics?.memPct ?? null, disk: s.metrics?.diskPct ?? null })), []),
      deploys: safe(() => deployOverview(), null),
      targets: safe(() => listTargets().slice(0, 6).map((t) => ({ id: t.id, name: t.name, state: t.state, url: t.url, last: t.last })), []),
      monitor: safe(() => monitorOverview(), null),
      checks: safe(() => listChecks().slice(0, 8).map((c) => ({ id: c.id, name: c.name, state: c.state, latency: c.last_latency_ms, uptime: c.day.uptime, strip: c.strip })), []),
    },
    activity: safe(() => activityFeed(0).slice(0, 14), []),
    incidentsOpen: n("SELECT COUNT(*) AS n FROM incidents WHERE state IN ('open','mitigated')"),
  };
}
