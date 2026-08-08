// Observability, and the part nobody builds: doing something about it.
//
// A dashboard that goes red and waits for a person is a dashboard for a company
// with people watching it. This one is supposed to run without that, so every
// service level objective carries a remedy — a specific, bounded action the
// company applies to itself when the objective is missed.
//
// The remedies are deliberately small and reversible: requeue, throttle, ask an
// employee to look, page a person. None of them can spend money or reach
// outside, because a system that heals itself by taking bigger actions than a
// human would is not self-healing, it is unsupervised.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { notify } from './notify.js';

const ACTOR = 'system:observe';

export function record(name, value, unit = null) {
  exec('INSERT INTO metrics (name, value, unit) VALUES (?,?,?)', name, Number(value) || 0, unit);
}

/** The objectives the company holds itself to, and what it does when it misses. */
const FOUNDING_SLOS = [
  {
    name: 'queue-not-backed-up', metric: 'queue.depth', target: 40, comparison: 'lte', windowH: 1,
    describe: 'Work waiting to start stays under forty items',
    remedy: 'spread-load',
  },
  {
    name: 'nothing-stalls', metric: 'queue.stuck', target: 0, comparison: 'lte', windowH: 1,
    describe: 'No piece of work sits in "running" for half an hour',
    remedy: 'requeue-stuck',
  },
  {
    name: 'spend-inside-cap', metric: 'spend.month_usd', target: 0, comparison: 'lte', windowH: 24,
    describe: 'Monthly model spend stays inside the company cap',
    remedy: 'throttle-discretionary',
  },
  {
    name: 'quality-holds', metric: 'work.audits_failed', target: 10, comparison: 'lte', windowH: 24,
    describe: 'Fewer than ten pieces of work fail audit in a day',
    remedy: 'ask-quality',
  },
  {
    name: 'no-open-breach', metric: 'outside.breaches_open', target: 0, comparison: 'lte', windowH: 1,
    describe: 'The red team has nothing open against us',
    remedy: 'page-a-person',
  },
  {
    name: 'api-answers', metric: 'api.error_rate', target: 5, comparison: 'lte', windowH: 1,
    describe: 'Fewer than five per cent of API calls fail',
    remedy: 'page-a-person',
  },
];

export function seedSlos() {
  for (const s of FOUNDING_SLOS) {
    exec(
      `INSERT INTO slos (name, describe, metric, target, comparison, window_h, remedy)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING`,
      s.name, s.describe, s.metric, s.target, s.comparison, s.windowH, s.remedy,
    );
  }
  // The spend objective's target is the company's own cap, whatever that is
  // today — a number typed in here would drift the moment the cap changed.
  const cap = one("SELECT COALESCE(MAX(cap_usd),0) AS c FROM budgets WHERE scope = 'company'")?.c;
  if (cap) exec("UPDATE slos SET target = ? WHERE name = 'spend-inside-cap'", cap * 0.9);
}

const REMEDIES = {
  'requeue-stuck'() {
    const r = exec("UPDATE runs SET state = 'queued' WHERE state = 'running' AND created_at < datetime('now','-30 minutes')");
    return { action: 'requeue-stuck', detail: `${r.changes} stalled item(s) put back in the queue`, ok: r.changes > 0 };
  },
  'spread-load'() {
    // Move queued work off the three busiest employees onto colleagues in the
    // same role who are carrying nothing.
    let moved = 0;
    for (const busy of q("SELECT agent_id, COUNT(*) AS c FROM runs WHERE state = 'queued' GROUP BY agent_id ORDER BY c DESC LIMIT 3")) {
      const role = one('SELECT role_group FROM agents WHERE id = ?', busy.agent_id)?.role_group;
      const free = q(
        `SELECT a.id FROM agents a WHERE a.role_group = ? AND a.status = 'active' AND a.id != ?
         AND (SELECT COUNT(*) FROM runs r WHERE r.agent_id = a.id AND r.state IN ('queued','running')) = 0 LIMIT 3`,
        role, busy.agent_id,
      );
      const items = q("SELECT id FROM runs WHERE agent_id = ? AND state = 'queued' ORDER BY created_at DESC LIMIT ?", busy.agent_id, free.length * 2);
      items.forEach((it, i) => { if (free.length) { exec('UPDATE runs SET agent_id = ? WHERE id = ?', free[i % free.length].id, it.id); moved++; } });
    }
    return { action: 'spread-load', detail: `${moved} item(s) moved to employees who were free`, ok: moved > 0 };
  },
  'throttle-discretionary'() {
    const r = exec("UPDATE runs SET state = 'cancelled', failure_reason = 'held by the spend objective' WHERE state = 'queued' AND task_type LIKE 'idea%'");
    return { action: 'throttle-discretionary', detail: `${r.changes} speculative item(s) held until the month turns over`, ok: true };
  },
  'ask-quality'() {
    if (one("SELECT id FROM runs WHERE task_type = 'quality_pattern' AND state IN ('queued','running')")) {
      return { action: 'ask-quality', detail: 'already asked; waiting on the answer', ok: true };
    }
    const qa = one("SELECT id FROM agents WHERE role_group = 'assure' AND status = 'active' ORDER BY random() LIMIT 1");
    if (!qa) return { action: 'ask-quality', detail: 'nobody on the quality desk is active', ok: false };
    enqueueRun({
      agentId: qa.id, taskType: 'quality_pattern', actor: ACTOR,
      input: {
        instruction: 'Too much work is failing audit. Find the pattern behind the failures, not the list of them. Return JSON: {"pattern": "...", "cause": "...", "change": "one specific change"}.',
        failures: q("SELECT subject_type, dept, verdict, summary FROM audits WHERE verdict = 'fail' ORDER BY id DESC LIMIT 15"),
      },
    });
    return { action: 'ask-quality', detail: 'the quality desk was asked for the pattern behind the failures', ok: true };
  },
  'page-a-person'(slo) {
    notify({
      kind: 'slo', title: `${slo.name} is breached`,
      body: `${slo.describe}. Last measurement: ${slo.last_value}, target ${slo.comparison === 'lte' ? '≤' : '≥'} ${slo.target}. This one cannot be fixed automatically.`,
      href: '#/observe',
    });
    return { action: 'page-a-person', detail: 'a person was paged — this objective has no safe automatic remedy', ok: true };
  },
};

/** Measure, compare, and act. One pass. */
export function observeTick() {
  // Some measurements are cheaper to take here than to have somebody push.
  const apiTotal = one("SELECT COUNT(*) AS n FROM api_calls WHERE created_at >= datetime('now','-1 hour')").n;
  const apiBad = one("SELECT COUNT(*) AS n FROM api_calls WHERE created_at >= datetime('now','-1 hour') AND status >= 500").n;
  record('api.error_rate', apiTotal ? (apiBad / apiTotal) * 100 : 0, 'percent');
  record('jobs.dead', one("SELECT COUNT(*) AS n FROM jobs WHERE state = 'dead'").n);
  record('chain.length', one('SELECT COUNT(*) AS n FROM audit_log').n);

  const applied = [];
  for (const slo of q('SELECT * FROM slos')) {
    const m = one(
      `SELECT AVG(value) AS avg, MAX(value) AS max FROM metrics
       WHERE name = ? AND at >= datetime('now', '-' || ? || ' hours')`,
      slo.metric, slo.window_h,
    );
    if (m?.avg === null || m?.avg === undefined) continue;
    const value = Number(slo.comparison === 'lte' ? m.max : m.avg);
    const met = slo.comparison === 'lte' ? value <= slo.target : value >= slo.target;
    const state = met ? 'ok' : 'breached';
    const was = slo.state;
    exec(
      "UPDATE slos SET state = ?, last_value = ?, breached_at = CASE WHEN ? = 'breached' AND breached_at IS NULL THEN datetime('now') WHEN ? = 'ok' THEN NULL ELSE breached_at END WHERE id = ?",
      state, value, state, state, slo.id,
    );

    if (state === 'breached' && was !== 'breached') {
      audit({ actorType: 'system', actorId: ACTOR, action: 'slo.breached', subjectType: 'slo', subjectId: slo.name, payload: { value, target: slo.target, describe: slo.describe } });
      const fn = REMEDIES[slo.remedy];
      if (fn) {
        let out;
        try { out = fn({ ...slo, last_value: value }); }
        catch (err) { out = { action: slo.remedy, detail: `the remedy itself failed: ${err.message}`, ok: false }; }
        exec('INSERT INTO remedies (slo, action, detail, outcome) VALUES (?,?,?,?)', slo.name, out.action, out.detail, out.ok ? 'applied' : 'failed');
        audit({ actorType: 'system', actorId: ACTOR, action: 'slo.remedy', subjectType: 'slo', subjectId: slo.name, payload: out });
        applied.push({ slo: slo.name, ...out });
      }
    } else if (state === 'ok' && was === 'breached') {
      audit({ actorType: 'system', actorId: ACTOR, action: 'slo.recovered', subjectType: 'slo', subjectId: slo.name, payload: { value } });
    }
  }
  return applied;
}

export function observeOverview() {
  const slos = q('SELECT * FROM slos ORDER BY state DESC, name');
  const series = (name) => q(
    `SELECT strftime('%Y-%m-%d %H:00', at) AS hour, ROUND(AVG(value), 3) AS v
     FROM metrics WHERE name = ? AND at >= datetime('now','-24 hours') GROUP BY hour ORDER BY hour`, name,
  );
  return {
    slos,
    counts: {
      total: slos.length,
      ok: slos.filter((s) => s.state === 'ok').length,
      breached: slos.filter((s) => s.state === 'breached').length,
      remediesApplied: one("SELECT COUNT(*) AS n FROM remedies WHERE outcome = 'applied'").n,
    },
    remedies: q('SELECT * FROM remedies ORDER BY id DESC LIMIT 25'),
    metrics: q("SELECT name, COUNT(*) AS points, ROUND(AVG(value),3) AS avg, ROUND(MAX(value),3) AS max FROM metrics WHERE at >= datetime('now','-24 hours') GROUP BY name ORDER BY name"),
    series: {
      queue: series('queue.depth'),
      spend: series('spend.month_usd'),
      errors: series('api.error_rate'),
    },
    health: {
      chain: one('SELECT COUNT(*) AS n FROM audit_log').n,
      jobsDead: one("SELECT COUNT(*) AS n FROM jobs WHERE state = 'dead'").n,
      connectorsFailing: one("SELECT COUNT(*) AS n FROM connectors WHERE health = 'failing'").n,
      webhooksPaused: one("SELECT COUNT(*) AS n FROM webhooks WHERE state = 'paused'").n,
    },
  };
}

/** Old measurements are noise; the objectives only look back a day. */
export function trimMetrics() {
  const r = exec("DELETE FROM metrics WHERE at < datetime('now','-14 days')");
  return r.changes;
}
