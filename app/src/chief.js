// The operating rhythm — the company running itself, not just doing what it
// is told.
//
// Autonomy so far has meant: work arrives, the machine does it, nobody has to
// approve each step. That is a company that executes without intervention. It
// is not a company that *runs* without intervention, because nobody was
// deciding what should be worked on, whether last week went well, or what to
// change as a result. A person still had to be the management layer.
//
// This module is that layer. It keeps three clocks:
//
//   day      — look at what is stuck, unblock it, rebalance who is doing what
//   week     — review what actually happened against what was planned, correct
//   quarter  — set objectives, allocate the budget across them, retire what failed
//
// Every turn writes a period: the plan before, the review after, and the
// corrections in between. That record is the thing that makes this legible
// rather than mysterious — six months from now the question "why did the
// company do that" has an answer with a date on it.
//
// Two limits are deliberate and stay. Money still leaves only by a person, and
// the company still does not contact people in bulk who never asked. Autonomy
// means nobody has to be present for the work; it does not mean nobody is
// responsible for the consequences.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { isAutonomous, autonomyLevel } from './autonomy.js';
import { record as recordMetric } from './observe.js';

const ACTOR = 'system:chief';

const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const label = (kind) => {
  const d = new Date();
  if (kind === 'day') return d.toISOString().slice(0, 10);
  if (kind === 'quarter') return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  // ISO week, so a "week" means the same thing to everyone reading it later.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/** Everything the company can see about itself, in one read. */
export function situation() {
  const n = (sql, ...p) => one(sql, ...p)?.n ?? 0;
  return {
    queue: {
      queued: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'queued'"),
      running: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'running'"),
      awaitingHuman: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'"),
      failedToday: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND date(created_at) = date('now')"),
      stuck: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'running' AND created_at < datetime('now','-30 minutes')"),
    },
    money: {
      monthUsd: one("SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS n FROM model_calls WHERE created_at >= date('now','start of month')").n,
      todayUsd: one("SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS n FROM model_calls WHERE date(created_at) = date('now')").n,
      capUsd: one("SELECT COALESCE(MAX(cap_usd),0) AS n FROM budgets WHERE scope = 'company'").n,
      frozen: n('SELECT COUNT(*) AS n FROM budgets WHERE frozen = 1'),
    },
    work: {
      workstreamsOpen: n("SELECT COUNT(*) AS n FROM workstreams WHERE state NOT IN ('closed','cancelled')"),
      revisions: n('SELECT COUNT(*) AS n FROM cycles WHERE seq > 1'),
      auditsFailed: n("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'fail'"),
      tasksOverdue: n("SELECT COUNT(*) AS n FROM tasks WHERE state != 'done' AND due_date IS NOT NULL AND due_date < date('now')"),
      incidentsOpen: n("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'"),
    },
    commerce: {
      dealsInFlight: n("SELECT COUNT(*) AS n FROM deals WHERE stage NOT IN ('won','lost','delivered')"),
      customersActive: n("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'"),
      mrrUsd: one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'").n,
    },
    workforce: {
      active: n("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"),
      idle: n(`SELECT COUNT(*) AS n FROM agents a WHERE a.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.agent_id = a.id AND r.created_at >= datetime('now','-7 days'))`),
      overloaded: n(`SELECT COUNT(*) AS n FROM (SELECT agent_id, COUNT(*) AS c FROM runs
                     WHERE state IN ('queued','running') GROUP BY agent_id HAVING c > 8)`),
    },
    outside: {
      connectorsLive: n("SELECT COUNT(*) AS n FROM connectors WHERE state = 'live'"),
      egressBlocked: n("SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'blocked' AND created_at >= datetime('now','-1 day')"),
      gatedWaiting: n("SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'gated'"),
      breaches: n("SELECT COUNT(*) AS n FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL"),
    },
    objectives: q("SELECT id, title, quarter, state, krs FROM objectives WHERE state != 'closed' ORDER BY id DESC LIMIT 10")
      .map((o) => ({ ...o, krs: parse(o.krs, []) })),
  };
}

/**
 * The daily turn: nothing strategic, everything unblocking. This is the shift
 * supervisor, not the board.
 */
function dailyTurn(s) {
  const moves = [];

  // A run that has been "running" for half an hour is not running.
  const stuck = q("SELECT id, agent_id FROM runs WHERE state = 'running' AND created_at < datetime('now','-30 minutes') LIMIT 10");
  for (const r of stuck) {
    exec("UPDATE runs SET state = 'queued' WHERE id = ?", r.id);
    moves.push(`requeued a run that stalled on ${r.agent_id}`);
  }

  // Employees carrying more than eight open items get the excess spread to
  // colleagues in the same role who are carrying nothing.
  const overloaded = q(`SELECT agent_id, COUNT(*) AS c FROM runs WHERE state = 'queued' GROUP BY agent_id HAVING c > 8 ORDER BY c DESC LIMIT 3`);
  for (const o of overloaded) {
    const role = one('SELECT role_group FROM agents WHERE id = ?', o.agent_id)?.role_group;
    const spare = q(
      `SELECT a.id FROM agents a WHERE a.role_group = ? AND a.status = 'active' AND a.id != ?
       AND (SELECT COUNT(*) FROM runs r WHERE r.agent_id = a.id AND r.state IN ('queued','running')) < 3 LIMIT 2`,
      role, o.agent_id,
    );
    if (!spare.length) continue;
    const move = q("SELECT id FROM runs WHERE agent_id = ? AND state = 'queued' ORDER BY created_at DESC LIMIT ?", o.agent_id, Math.min(3, spare.length * 2));
    move.forEach((r, i) => exec('UPDATE runs SET agent_id = ? WHERE id = ?', spare[i % spare.length].id, r.id));
    if (move.length) moves.push(`moved ${move.length} items from ${o.agent_id} to colleagues who were free`);
  }

  // An unfixed breach outranks whatever else was planned.
  if (s.outside.breaches) {
    const sec = one("SELECT id FROM agents WHERE role_group = 'assure' AND status = 'active' ORDER BY random() LIMIT 1");
    if (sec && !one("SELECT id FROM runs WHERE task_type = 'security_fix' AND state IN ('queued','running')")) {
      enqueueRun({
        agentId: sec.id, taskType: 'security_fix', actor: ACTOR,
        input: {
          instruction: 'The red team got through. Read the finding, work out what specifically failed, and return JSON: {"what_failed": "...", "fix": "...", "test": "how we would know it is fixed"}. Do not describe the attack; describe the hole.',
          findings: q("SELECT attack, target, detail, severity FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL LIMIT 5"),
        },
      });
      moves.push('put an unfixed security breach in front of everything else');
    }
  }

  // Money: at ninety per cent of the cap, stop starting new discretionary work
  // rather than discovering the wall mid-sentence.
  if (s.money.capUsd && s.money.monthUsd > s.money.capUsd * 0.9) {
    const cancelled = exec("UPDATE runs SET state = 'cancelled', failure_reason = 'held: the month is nearly spent' WHERE state = 'queued' AND task_type LIKE 'idea%'");
    if (cancelled.changes) moves.push(`held ${cancelled.changes} speculative items — the month is ${Math.round((s.money.monthUsd / s.money.capUsd) * 100)}% spent`);
  }

  return moves;
}

/** The weekly turn: did last week go the way it was supposed to? */
function weeklyTurn(s) {
  const moves = [];
  const lastWeek = one("SELECT * FROM periods WHERE kind = 'week' AND state = 'open' ORDER BY id DESC LIMIT 1");

  if (lastWeek) {
    const plan = parse(lastWeek.plan, {});
    const review = {
      runsDone: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND created_at >= ?", lastWeek.opened_at).n,
      runsFailed: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND created_at >= ?", lastWeek.opened_at).n,
      spentUsd: one("SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS n FROM model_calls WHERE created_at >= ?", lastWeek.opened_at).n,
      auditPass: one("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'pass' AND created_at >= ?", lastWeek.opened_at).n,
      auditFail: one("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'fail' AND created_at >= ?", lastWeek.opened_at).n,
      dealsMoved: one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'revenue.advanced' AND occurred_at >= ?", lastWeek.opened_at).n,
    };
    // The honest comparison: what was promised against what landed.
    review.metTarget = plan.targetRuns ? review.runsDone >= plan.targetRuns : null;
    const corrections = [];
    if (review.runsFailed > review.runsDone * 0.2) {
      corrections.push('failure rate above one in five — the quality desk gets a review of what is failing');
      const qa = one("SELECT id FROM agents WHERE role_group = 'assure' AND status = 'active' ORDER BY random() LIMIT 1");
      if (qa) {
        enqueueRun({
          agentId: qa.id, taskType: 'failure_review', actor: ACTOR,
          input: {
            instruction: 'More than a fifth of this week\'s work failed. Find the pattern, not the instances. Return JSON: {"pattern": "...", "likely_cause": "...", "change": "one thing to change next week"}.',
            failures: q("SELECT task_type, agent_id, failure_reason FROM runs WHERE state = 'failed' AND created_at >= ? LIMIT 20", lastWeek.opened_at),
          },
        });
      }
    }
    if (plan.budgetUsd && review.spentUsd > plan.budgetUsd) {
      corrections.push(`spent $${review.spentUsd} against a plan of $${plan.budgetUsd} — next week's plan starts from what was actually spent`);
    }
    if (review.auditFail > review.auditPass) {
      corrections.push('more work failed audit than passed — the skill market is asked for a better method');
    }
    exec(
      "UPDATE periods SET state = 'reviewed', review = ?, corrections = ?, closed_at = datetime('now') WHERE id = ?",
      JSON.stringify(review), JSON.stringify(corrections), lastWeek.id,
    );
    audit({ actorType: 'system', actorId: ACTOR, action: 'period.reviewed', subjectType: 'period', subjectId: lastWeek.id, payload: { label: lastWeek.label, review, corrections } });
    moves.push(`reviewed ${lastWeek.label}: ${review.runsDone} done, ${review.runsFailed} failed, $${review.spentUsd} spent${corrections.length ? ` · ${corrections.length} correction(s)` : ''}`);
  }

  // Open the new week with a plan derived from the last four, not from hope.
  const recent = q("SELECT review FROM periods WHERE kind = 'week' AND review IS NOT NULL ORDER BY id DESC LIMIT 4").map((r) => parse(r.review, {}));
  const avgRuns = recent.length ? Math.round(recent.reduce((a, r) => a + (r.runsDone || 0), 0) / recent.length) : Math.max(10, s.queue.queued);
  const avgSpend = recent.length ? recent.reduce((a, r) => a + (r.spentUsd || 0), 0) / recent.length : s.money.todayUsd * 7;
  const plan = {
    targetRuns: Math.round(avgRuns * 1.05),
    budgetUsd: Number((avgSpend * 1.1).toFixed(2)),
    focus: s.outside.breaches ? 'close the open security findings'
      : s.work.incidentsOpen ? 'close the open incidents'
        : s.commerce.dealsInFlight ? 'move the deals that are already in flight'
          : 'find work worth doing',
    basedOn: `${recent.length} previous week(s)`,
  };
  const r = exec("INSERT INTO periods (kind, label, plan) VALUES ('week', ?, ?) ON CONFLICT(kind, label) DO NOTHING", label('week'), JSON.stringify(plan));
  if (r.changes) {
    audit({ actorType: 'system', actorId: ACTOR, action: 'period.planned', subjectType: 'period', subjectId: Number(r.lastInsertRowid), payload: { label: label('week'), plan } });
    moves.push(`opened ${label('week')} aiming at ${plan.targetRuns} pieces of work on $${plan.budgetUsd}, focused on ${plan.focus}`);
  }
  return moves;
}

/** The quarterly turn: what is this company trying to do, and with what money? */
function quarterlyTurn(s) {
  const moves = [];
  const q4 = label('quarter');
  if (one("SELECT id FROM periods WHERE kind = 'quarter' AND label = ?", q4)) return moves;

  // Close the previous quarter's objectives honestly before setting new ones.
  const stale = q("SELECT id, title, quarter FROM objectives WHERE state = 'active' AND quarter != ?", q4);
  for (const o of stale) {
    exec("UPDATE objectives SET state = 'closed' WHERE id = ?", o.id);
    moves.push(`closed "${o.title}" from ${o.quarter}`);
  }

  // Objectives come from the situation, not from a template: the company sets
  // itself the goals its own numbers say it needs.
  const objectives = [];
  if (s.commerce.mrrUsd < 1000) objectives.push({ title: 'Reach the first thousand dollars of recurring revenue', krs: ['3 customers paying', 'one closed deal per month', 'outreach reaching a real inbox'] });
  if (s.outside.breaches) objectives.push({ title: 'No open security findings at quarter end', krs: ['every red-team breach fixed', 'the suite runs daily', 'no new finding older than a week'] });
  if (s.work.auditsFailed > 5) objectives.push({ title: 'Raise the pass rate on first submission', krs: ['audit pass rate above 80%', 'fewer than two revision rounds on average', 'one adopted method per failing task type'] });
  if (s.workforce.idle > 3) objectives.push({ title: 'Everyone on the roster has work worth doing', krs: ['no employee idle for a fortnight', 'retire or repurpose what is unused'] });
  if (!objectives.length) objectives.push({ title: 'Compound what is already working', krs: ['grow throughput 20%', 'hold cost per finished item flat', 'one new department that earns its place'] });

  // The id is a TEXT primary key, not an autoincrementing one — omitting it
  // writes a row with a null id, which reads back as nothing and blanks the
  // page that lists them. The slug follows the convention already in the table.
  for (const o of objectives) {
    const id = `${q4.toLowerCase()}-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;
    exec(
      "INSERT INTO objectives (id, title, quarter, owner, krs, state) VALUES (?,?,?,?,?, 'active') ON CONFLICT(id) DO NOTHING",
      id, o.title, q4, ACTOR, JSON.stringify(o.krs),
    );
  }

  // Divide the money across the objectives — but as a stated intention, not as
  // a budget row. The reservation engine enforces four scopes and would ignore
  // an "objective" one, and a control the engine ignores is worse than no
  // control: it looks like a limit while enforcing nothing. What is enforceable
  // is the per-employee cap, so the split is recorded here and the company cap
  // stays the wall.
  const cap = s.money.capUsd || 200;
  const share = Number((cap / Math.max(1, objectives.length)).toFixed(2));

  const plan = {
    objectives: objectives.map((o) => o.title),
    budgetPerObjectiveUsd: share,
    enforcedBy: `the company cap of $${cap}; the split above is how the quarter intends to use it`,
    setFrom: 'the company\'s own numbers at the turn of the quarter',
  };
  const r = exec("INSERT INTO periods (kind, label, plan) VALUES ('quarter', ?, ?)", q4, JSON.stringify(plan));
  audit({ actorType: 'system', actorId: ACTOR, action: 'quarter.planned', subjectType: 'period', subjectId: Number(r.lastInsertRowid), payload: plan });
  moves.push(`opened ${q4} with ${objectives.length} objective(s) and $${share} behind each`);
  return moves;
}

/**
 * One turn of the rhythm. Cheap to call often: each clock only does anything
 * when its period has actually turned over.
 */
export function chiefTick({ force = null } = {}) {
  if (!isAutonomous() && !force) return { ran: false, why: 'autonomy is off — the rhythm follows it' };
  const s = situation();
  const moves = [];

  const today = label('day');
  const dayRow = one("SELECT id FROM periods WHERE kind = 'day' AND label = ?", today);
  if (!dayRow || force === 'day') {
    moves.push(...dailyTurn(s));
    exec("INSERT INTO periods (kind, label, plan) VALUES ('day', ?, ?) ON CONFLICT(kind, label) DO UPDATE SET plan = excluded.plan",
      today, JSON.stringify({ moves, at: new Date().toISOString() }));
  }

  const thisWeek = label('week');
  if (!one("SELECT id FROM periods WHERE kind = 'week' AND label = ?", thisWeek) || force === 'week') {
    moves.push(...weeklyTurn(s));
  }

  if (force === 'quarter' || !one("SELECT id FROM periods WHERE kind = 'quarter' AND label = ?", label('quarter'))) {
    moves.push(...quarterlyTurn(s));
  }

  // What the rhythm saw becomes a measurement, so the SLOs have something real
  // to watch rather than a number somebody typed.
  recordMetric('queue.depth', s.queue.queued + s.queue.running);
  recordMetric('queue.stuck', s.queue.stuck);
  recordMetric('spend.month_usd', s.money.monthUsd, 'usd');
  recordMetric('work.audits_failed', s.work.auditsFailed);
  recordMetric('outside.breaches_open', s.outside.breaches);
  recordMetric('workforce.idle', s.workforce.idle);

  if (moves.length) {
    audit({ actorType: 'system', actorId: ACTOR, action: 'chief.turn', payload: { level: autonomyLevel(), moves } });
  }
  return { ran: true, level: autonomyLevel(), moves, situation: s };
}

export function chiefOverview() {
  return {
    autonomy: autonomyLevel(),
    situation: situation(),
    periods: q('SELECT * FROM periods ORDER BY id DESC LIMIT 30').map((p) => ({
      ...p, plan: parse(p.plan, {}), review: parse(p.review, null), corrections: parse(p.corrections, []),
    })),
    counts: {
      days: one("SELECT COUNT(*) AS n FROM periods WHERE kind = 'day'").n,
      weeks: one("SELECT COUNT(*) AS n FROM periods WHERE kind = 'week'").n,
      quarters: one("SELECT COUNT(*) AS n FROM periods WHERE kind = 'quarter'").n,
      corrections: one("SELECT COUNT(*) AS n FROM periods WHERE corrections IS NOT NULL AND corrections != '[]'").n,
    },
    objectives: q("SELECT * FROM objectives WHERE state = 'active' ORDER BY id DESC").map((o) => ({ ...o, krs: parse(o.krs, []) })),
    recentTurns: q("SELECT occurred_at, payload FROM audit_log WHERE action = 'chief.turn' ORDER BY seq DESC LIMIT 15")
      .map((r) => ({ at: r.occurred_at, ...parse(r.payload, {}) })),
    // Said plainly, because "fully autonomous" should never be read as "nobody
    // is responsible".
    limits: [
      'Money leaves only when a signed-in person releases it.',
      'No bulk contact with people who never asked to hear from us.',
      'Irreversible outbound actions stop at the gate for a person.',
      'Everything the rhythm decides is written down as a period, with the numbers it decided from.',
    ],
  };
}
