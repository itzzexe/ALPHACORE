// Maestro — the harmony layer. Nexus gives the company reflexes: when X
// happens, do Y. Maestro gives it judgement: it reads the whole organization
// at once, decides what matters most right now, and dispatches that work to
// the agents who can do it.
//
// The division of labour is deliberate:
//   Nexus   — event-driven, deterministic, always on. Cheap and predictable.
//   Maestro — periodic, model-authored, holistic. It sees the gaps a rule
//             cannot express: a department that has gone quiet, a design
//             package stalled behind one document, an idle workforce while
//             the pipeline is empty.
//
// Three guardrails make it safe to leave running:
//   1. Whitelist — it can only dispatch preparation work. Publishing, signing,
//      spending approval and gate verdicts are not in the catalog at all, so
//      no plan can reach them; it must flag those for a human instead.
//   2. Caps — a bounded number of actions per cycle, a per-action cooldown,
//      and a hard stop when the monthly budget is nearly spent.
//   3. Record — the snapshot, the plan, the reasoning and every executed
//      action land on the audit chain as system:maestro.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { budgetsConfig } from './env.js';
import { getSetting, setSetting } from './settings.js';
import { createTask } from './pm.js';
import { createIntelQuery } from './intel.js';
import { createContent, createDesign, createPost } from './studio.js';
import { draftOutreach } from './relations.js';
import { buildSegment } from './data.js';
import { draftProposal } from './sales.js';
import { runEvalSet } from './evals.js';
import { createFinReport } from './finreports.js';
import { createBlueprint } from './systemdesign.js';
import { createInfraPlan } from './infra.js';
import { createJourney } from './journey.js';

const ACTOR = 'system:maestro';
const MAX_ACTIONS = 5;
const COOLDOWN_HOURS = 6;

// ---------- the action catalog: preparation only, never commitment ----------
const ACTIONS = {
  'task.delegate': {
    describe: 'Delegate a task to an AI employee. params: {title, details, agentId, priority}',
    key: (p) => `${p.agentId}:${String(p.title || '').slice(0, 40)}`,
    run: (p) => {
      const t = createTask({ title: p.title, details: p.details || null, assigneeType: 'agent', assigneeId: p.agentId, priority: p.priority || 'normal', actor: ACTOR });
      return `task #${t.id} → ${p.agentId}`;
    },
  },
  'intel.campaign': {
    describe: 'Start an intelligence campaign. params: {question, criteria:{sector,country,city,kind}, targetCount}',
    key: (p) => String(p.question || JSON.stringify(p.criteria || {})).slice(0, 50),
    run: (p) => {
      const iq = createIntelQuery({ question: p.question || null, criteria: p.criteria || null, targetCount: Math.min(15, Number(p.targetCount) || 8), rules: ['people-when-no-phone', 'ask-executives', 'derive-emails'], actor: ACTOR });
      return `intel campaign #${iq.id}`;
    },
  },
  'segment.build': {
    describe: 'Group contactable intel records into a segment. params: {name, country, sector}',
    key: (p) => `${p.name}`,
    run: (p) => {
      const s = buildSegment({ name: p.name, country: p.country || null, sector: p.sector || null, contactableOnly: true, actor: ACTOR });
      return `segment #${s.id} (${s.stats.size} members)`;
    },
  },
  'content.brief': {
    describe: 'Commission a content piece (draft only). params: {kind, title, brief}',
    key: (p) => String(p.title || '').slice(0, 50),
    run: (p) => {
      const c = createContent({ kind: p.kind || 'article', title: p.title, brief: p.brief, actor: ACTOR });
      return `content #${c.id} drafting`;
    },
  },
  'social.brief': {
    describe: 'Commission a social post (draft only — a human publishes). params: {brief, kind}',
    key: (p) => String(p.brief || '').slice(0, 50),
    run: (p) => {
      const post = createPost({ brief: p.brief, kind: p.kind || 'post', actor: ACTOR });
      return `post #${post.id} drafting`;
    },
  },
  'design.brief': {
    describe: 'Commission a visual design. params: {kind, title, brief}',
    key: (p) => String(p.title || '').slice(0, 50),
    run: (p) => {
      const d = createDesign({ kind: p.kind || 'social-visual', title: p.title, brief: p.brief, actor: ACTOR });
      return `design #${d.id} drafting`;
    },
  },
  'relations.outreach': {
    describe: 'Draft outreach for a partner who has gone quiet. params: {partnerId}',
    key: (p) => `partner:${p.partnerId}`,
    run: (p) => { draftOutreach(Number(p.partnerId), ACTOR); return `outreach drafting for partner #${p.partnerId}`; },
  },
  'sales.proposal': {
    describe: 'Draft a proposal for a deal sitting at the proposal stage. params: {dealId}',
    key: (p) => `deal:${p.dealId}`,
    run: (p) => { draftProposal(Number(p.dealId), ACTOR); return `proposal drafting for deal #${p.dealId}`; },
  },
  'quality.eval': {
    describe: 'Run the golden/canary set for an agent whose reputation is unproven. params: {agentId}',
    key: (p) => `eval:${p.agentId}`,
    run: async (p) => { const r = await runEvalSet(p.agentId, ACTOR); return `eval ${p.agentId}: ${Math.round(r.score * 100)}%`; },
  },
  'finance.report': {
    describe: 'Prepare a financial document from the live ledger. params: {kind, period}',
    key: (p) => `${p.kind}:${p.period || 'current'}`,
    run: (p) => { const r = createFinReport({ kind: p.kind, period: p.period || null, actor: ACTOR }); return `financial report #${r.id} (${p.kind})`; },
  },
  'design.package': {
    describe: 'Start a full system design package. params: {name, goal}',
    key: (p) => String(p.name || '').slice(0, 50),
    run: (p) => { const b = createBlueprint({ name: p.name, goal: p.goal, actor: ACTOR }); return `design package #${b.id} (${b.progress.total} docs)`; },
  },
  'infra.plan': {
    describe: 'Plan infrastructure for a design or product. params: {name, section, blueprintId}',
    key: (p) => `${p.name}:${p.section || 'full'}`,
    run: (p) => { const i = createInfraPlan({ name: p.name, section: p.section || 'full', blueprintId: p.blueprintId || null, spec: p.spec || {}, actor: ACTOR }); return `infra plan #${i.id}`; },
  },
  'journey.launch': {
    describe: 'Launch a company journey across all departments. params: {title, autopilot}',
    key: (p) => String(p.title || '').slice(0, 50),
    run: (p) => { const j = createJourney({ title: p.title, autopilot: p.autopilot !== false, actor: ACTOR }); return `journey #${j.id} launched`; },
  },
  'human.flag': {
    describe: 'Raise something only a human may decide. params: {message, level}',
    key: (p) => String(p.message || '').slice(0, 60),
    run: (p) => {
      notify({ level: p.level === 'crit' ? 'crit' : 'warn', source: 'maestro', message: `Needs a human: ${p.message}` });
      return 'flagged for a human';
    },
  },
};

export const ACTION_CATALOG = Object.entries(ACTIONS).map(([id, a]) => ({ id, describe: a.describe }));

// ---------- state assessment ----------
/** A factual snapshot of the whole company — no interpretation, just numbers. */
export function assessCompany() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const month = new Date().toISOString().slice(0, 7);
  const spend = one('SELECT COALESCE(SUM(cost_usd),0) AS s FROM model_calls WHERE created_at >= ?', `${month}-01`).s;

  return {
    at: new Date().toISOString(),
    budget: {
      monthSpendUsd: Math.round(spend * 100) / 100,
      monthCapUsd: budgetsConfig.company.monthlyCapUsd,
      headroomPct: Math.round((1 - spend / budgetsConfig.company.monthlyCapUsd) * 100),
    },
    workforce: q(`SELECT a.id, a.name, a.status,
        (SELECT COUNT(*) FROM runs r WHERE r.agent_id = a.id AND r.state IN ('queued','leased','running')) AS active,
        (SELECT COUNT(*) FROM runs r WHERE r.agent_id = a.id AND r.created_at >= datetime('now','-7 days')) AS week,
        (SELECT COUNT(*) FROM eval_runs e WHERE e.agent_id = a.id) AS evals
      FROM agents a WHERE a.status = 'active' ORDER BY a.id`),
    queue: {
      awaitingHuman: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'"),
      running: n("SELECT COUNT(*) AS n FROM runs WHERE state IN ('queued','leased','running')"),
      failed7d: n("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND created_at >= datetime('now','-7 days')"),
    },
    stalled: {
      journeysAwaitingHuman: q("SELECT id, title FROM journeys WHERE state = 'awaiting_human' LIMIT 5"),
      blueprintsBlocked: q("SELECT id, name FROM blueprints WHERE state = 'awaiting_human' LIMIT 5"),
      dealsAtProposalNoDraft: q("SELECT id, name FROM deals WHERE stage = 'proposal' AND proposal IS NULL AND draft_run_id IS NULL LIMIT 5"),
      quietPartners: q(`SELECT p.id, p.name FROM partners p LEFT JOIN interactions i ON i.partner_id = p.id
        WHERE p.state = 'active' AND p.draft IS NULL GROUP BY p.id
        HAVING MAX(i.created_at) IS NULL OR MAX(i.created_at) < datetime('now','-30 days') LIMIT 5`),
      tasksBlocked: n("SELECT COUNT(*) AS n FROM tasks WHERE state = 'blocked'"),
      postsAwaitingPublish: n("SELECT COUNT(*) AS n FROM posts WHERE state = 'draft_ready'"),
      contentAwaitingApproval: n("SELECT COUNT(*) AS n FROM content_items WHERE state = 'draft_ready'"),
      intelUnverified: n("SELECT COUNT(*) AS n FROM intel_records WHERE verification = 'unverified' AND (email IS NOT NULL OR phone IS NOT NULL)"),
    },
    departments: {
      products: n('SELECT COUNT(*) AS n FROM products'), productsLive: n("SELECT COUNT(*) AS n FROM products WHERE state = 'live'"),
      journeys: n('SELECT COUNT(*) AS n FROM journeys'), journeysDone: n("SELECT COUNT(*) AS n FROM journeys WHERE state = 'done'"),
      designPackages: n('SELECT COUNT(*) AS n FROM blueprints'), infraPlans: n('SELECT COUNT(*) AS n FROM infra_plans'),
      intelCampaigns: n('SELECT COUNT(*) AS n FROM intel_queries'), intelRecords: n('SELECT COUNT(*) AS n FROM intel_records'),
      segments: n('SELECT COUNT(*) AS n FROM segments'), campaigns: n('SELECT COUNT(*) AS n FROM campaigns'),
      campaignsLive: n("SELECT COUNT(*) AS n FROM campaigns WHERE state = 'live'"),
      customers: n('SELECT COUNT(*) AS n FROM customers'), activeCustomers: n("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'"),
      deals: n('SELECT COUNT(*) AS n FROM deals'), openDeals: n("SELECT COUNT(*) AS n FROM deals WHERE stage IN ('lead','qualified','proposal')"),
      partners: n("SELECT COUNT(*) AS n FROM partners WHERE state = 'active'"),
      posts: n('SELECT COUNT(*) AS n FROM posts'), contentItems: n('SELECT COUNT(*) AS n FROM content_items'), designs: n('SELECT COUNT(*) AS n FROM designs'),
      tasksOpen: n("SELECT COUNT(*) AS n FROM tasks WHERE state NOT IN ('done','cancelled')"),
      projects: n("SELECT COUNT(*) AS n FROM projects WHERE state = 'active'"),
      openIncidents: n("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'"),
      openTickets: n("SELECT COUNT(*) AS n FROM tickets WHERE state NOT IN ('sent','closed')"),
      criticalRisks: n("SELECT COUNT(*) AS n FROM risks WHERE state = 'open' AND likelihood * impact >= 16"),
      finReports: n('SELECT COUNT(*) AS n FROM fin_reports'),
      knowledgeVerified: n("SELECT COUNT(*) AS n FROM memory_entries WHERE verification = 'verified'"),
      objectivesActive: n("SELECT COUNT(*) AS n FROM objectives WHERE state = 'active'"),
    },
    commerce: {
      mrrUsd: one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'").n,
      pipelineUsd: one("SELECT COALESCE(SUM(value_usd),0) AS n FROM deals WHERE stage IN ('lead','qualified','proposal')").n,
    },
    automation: {
      nexusActions7d: n("SELECT COUNT(*) AS n FROM nexus_log WHERE created_at >= datetime('now','-7 days')"),
      maestroCycles7d: n("SELECT COUNT(*) AS n FROM maestro_cycles WHERE created_at >= datetime('now','-7 days')"),
      agentActions7d: n("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'agent' AND occurred_at >= datetime('now','-7 days')"),
      humanActions7d: n("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'human' AND occurred_at >= datetime('now','-7 days')"),
    },
    recentMaestroActions: q("SELECT action, dedup_key, detail, created_at FROM maestro_actions ORDER BY id DESC LIMIT 15"),
  };
}

// ---------- planning ----------
export function isEnabled() { return String(getSetting('MAESTRO_ENABLED') || 'false').toLowerCase() === 'true'; }
export function setEnabled(on, actor) {
  setSetting('MAESTRO_ENABLED', on ? 'true' : 'false');
  audit({ actorType: 'human', actorId: actor, action: on ? 'maestro.enabled' : 'maestro.disabled', subjectType: 'settings', subjectId: 'MAESTRO_ENABLED' });
}
export function mode() { return getSetting('MAESTRO_MODE') || 'live'; }
export function setMode(m, actor) {
  if (!['live', 'dry-run'].includes(m)) throw new Error('mode must be live|dry-run');
  setSetting('MAESTRO_MODE', m);
  audit({ actorType: 'human', actorId: actor, action: 'maestro.mode', subjectType: 'settings', subjectId: 'MAESTRO_MODE', payload: { mode: m } });
}

/** Start a cycle: snapshot the company, ask the orchestrator what to do. */
export function startCycle({ trigger = 'auto', actor = ACTOR } = {}) {
  if (one("SELECT id FROM maestro_cycles WHERE state = 'planning'")) throw new Error('a cycle is already planning');
  const snapshot = assessCompany();
  if (snapshot.budget.headroomPct < 10) {
    notify({ level: 'warn', source: 'maestro', message: `Orchestration paused — only ${snapshot.budget.headroomPct}% of the monthly budget remains.` });
    throw new Error('budget headroom too low to orchestrate');
  }
  const m = mode();
  exec('INSERT INTO maestro_cycles (snapshot, mode, trigger, created_by) VALUES (?,?,?,?)', JSON.stringify(snapshot), m, trigger, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;

  const runId = enqueueRun({
    agentId: 'AGT-ORC-001',
    taskType: `maestro:${id}`,
    input: {
      prompt: `Plan the company's next moves. You may dispatch at most ${MAX_ACTIONS} actions this cycle.

AVAILABLE ACTIONS — you may use nothing else:
${ACTION_CATALOG.map((a) => `- ${a.id}: ${a.describe}`).join('\n')}

Not available to you by design: publishing anything, sending anything to a customer or partner, approving spend, signing, and gate verdicts. When one of those is what the company needs, use human.flag to say so precisely.

COMPANY SNAPSHOT (facts, not opinions):
\`\`\`json
${JSON.stringify(snapshot, null, 2).slice(0, 14000)}
\`\`\`

Choose actions that unblock what is stalled before starting anything new, keep departments in step with each other, and avoid repeating anything in recentMaestroActions. Give each action a one-sentence reason a founder would accept. If nothing is worth doing, return an empty plan and explain why in the assessment.`,
    },
    actor,
  });
  exec('UPDATE maestro_cycles SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'maestro.cycle_started', subjectType: 'maestro', subjectId: id, payload: { trigger, mode: m } });
  return getCycle(id);
}

const cooledDown = (action, key) => !one(
  "SELECT id FROM maestro_actions WHERE action = ? AND dedup_key = ? AND created_at >= datetime('now', ?)",
  action, key, `-${COOLDOWN_HOURS} hours`,
);

/** Execute an approved plan under the guardrails. */
async function executePlan(cycle, plan) {
  const results = [];
  let dispatched = 0;
  for (const step of plan.slice(0, MAX_ACTIONS * 2)) {
    if (dispatched >= MAX_ACTIONS) { results.push({ action: step.action, ok: false, detail: 'skipped — cycle action cap reached' }); continue; }
    const spec = ACTIONS[step.action];
    if (!spec) { results.push({ action: step.action, ok: false, detail: 'not in the action catalog — refused' }); continue; }
    const key = String(spec.key(step.params || {}) || '').slice(0, 120);
    if (!cooledDown(step.action, key)) { results.push({ action: step.action, ok: false, detail: `cooldown — already done within ${COOLDOWN_HOURS}h` }); continue; }
    if (cycle.mode === 'dry-run') { results.push({ action: step.action, ok: true, detail: `[dry-run] would run: ${key}`, why: step.why }); dispatched += 1; continue; }
    try {
      const detail = await spec.run(step.params || {});
      exec('INSERT INTO maestro_actions (cycle_id, action, dedup_key, ok, detail) VALUES (?,?,?,1,?)', cycle.id, step.action, key, detail);
      audit({ actorType: 'system', actorId: ACTOR, action: 'maestro.dispatched', subjectType: 'maestro', subjectId: cycle.id, payload: { action: step.action, detail, why: step.why } });
      results.push({ action: step.action, ok: true, detail, why: step.why });
      dispatched += 1;
    } catch (e) {
      exec('INSERT INTO maestro_actions (cycle_id, action, dedup_key, ok, detail) VALUES (?,?,?,0,?)', cycle.id, step.action, key, String(e.message).slice(0, 200));
      results.push({ action: step.action, ok: false, detail: String(e.message).slice(0, 200), why: step.why });
    }
  }
  return results;
}

/** Server tick — collect finished plans and run them. */
export async function maestroTick() {
  for (const c of q("SELECT * FROM maestro_cycles WHERE state = 'planning' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', c.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
    if (!parsed || !Array.isArray(parsed.plan)) {
      exec("UPDATE maestro_cycles SET state = 'failed', assessment = ? WHERE id = ?", run.failure_reason || 'planner returned no usable plan', c.id);
      continue;
    }
    const executed = await executePlan(c, parsed.plan);
    const ok = executed.filter((r) => r.ok).length;
    exec("UPDATE maestro_cycles SET state = ?, plan = ?, assessment = ?, flags = ?, executed = ? WHERE id = ?",
      parsed.plan.length ? 'executed' : 'empty',
      JSON.stringify(parsed.plan), parsed.assessment || null,
      JSON.stringify(parsed.flagsForHumans || []), JSON.stringify(executed), c.id);
    audit({ actorType: 'system', actorId: ACTOR, action: 'maestro.cycle_executed', subjectType: 'maestro', subjectId: c.id, payload: { planned: parsed.plan.length, dispatched: ok, mode: c.mode } });
    notify({
      level: (parsed.flagsForHumans || []).length ? 'warn' : 'info', source: 'maestro',
      message: `Orchestration cycle #${c.id}: ${ok} action(s) dispatched${(parsed.flagsForHumans || []).length ? `, ${parsed.flagsForHumans.length} item(s) need a human` : ''}.`,
      subjectType: 'maestro', subjectId: c.id,
    });
  }

  // Auto-cycle on a slow cadence when enabled and nothing is in flight.
  if (!isEnabled()) return;
  const last = one('SELECT created_at FROM maestro_cycles ORDER BY id DESC LIMIT 1');
  const due = !last || one("SELECT (julianday('now') - julianday(?)) * 24 AS h", last.created_at).h >= 1;
  if (due && !one("SELECT id FROM maestro_cycles WHERE state = 'planning'")) {
    try { startCycle({ trigger: 'auto' }); } catch { /* budget or race — next tick */ }
  }
}

// ---------- reads ----------
export function getCycle(id) {
  const c = one('SELECT * FROM maestro_cycles WHERE id = ?', id);
  if (!c) return null;
  return {
    ...c,
    snapshot: c.snapshot ? JSON.parse(c.snapshot) : null,
    plan: c.plan ? JSON.parse(c.plan) : [],
    flags: c.flags ? JSON.parse(c.flags) : [],
    executed: c.executed ? JSON.parse(c.executed) : [],
  };
}

export function maestroOverview() {
  const cycles = q('SELECT id FROM maestro_cycles ORDER BY id DESC LIMIT 10').map((r) => getCycle(r.id));
  const snap = assessCompany();
  return {
    enabled: isEnabled(),
    mode: mode(),
    catalog: ACTION_CATALOG,
    cycles,
    dispatchedTotal: one('SELECT COUNT(*) AS n FROM maestro_actions WHERE ok = 1').n,
    dispatched7d: one("SELECT COUNT(*) AS n FROM maestro_actions WHERE ok = 1 AND created_at >= datetime('now','-7 days')").n,
    snapshot: snap,
    harmony: harmonyScore(snap),
  };
}

/**
 * For every failing harmony check, exactly what would fix it — and whether an
 * agent can do that or only a person can. A score is only useful if it comes
 * with the route to a better one.
 */
export function remediations(snap = null) {
  const s = snap || assessCompany();
  const d = s.departments;
  const fix = (key, ok, how, auto = null, href = '#/') => ({ key, ok, how, auto, href });
  return [
    fix('nothing stalled at the gate', s.queue.awaitingHuman === 0,
      `Resolve ${s.queue.awaitingHuman} held run(s) — approve or reject each.`, null, '#/gate'),
    fix('no blocked tasks', s.stalled.tasksBlocked === 0,
      `${s.stalled.tasksBlocked} task(s) blocked behind a gate — clear the gate and they resume.`, null, '#/tasks'),
    fix('drafts are being published', (s.stalled.postsAwaitingPublish + s.stalled.contentAwaitingApproval) < 5,
      `${s.stalled.postsAwaitingPublish + s.stalled.contentAwaitingApproval} draft(s) waiting — publishing is human by design.`, null, '#/gate'),
    fix('relationships are warm', s.stalled.quietPartners.length === 0,
      `${s.stalled.quietPartners.length} partner(s) untouched for 30 days.`,
      s.stalled.quietPartners.length ? { action: 'relations.outreach', params: { partnerId: s.stalled.quietPartners[0].id }, label: 'Draft outreach now' } : null, '#/relations'),
    // No automatic fix here on purpose: accepting, mitigating or closing a
    // risk is a judgement about what the company is willing to live with.
    // Flagging it would move the notification, not the number.
    fix('no critical risk unattended', d.criticalRisks === 0,
      `${d.criticalRisks} risk(s) scoring 16+ — mark each mitigated, accepted or closed on the register. Nothing but a person can decide that.`,
      null, '#/risks'),
    fix('no open incident', d.openIncidents === 0, `${d.openIncidents} incident(s) open — close them with a postmortem.`, null, '#/incidents'),
    fix('budget headroom', s.budget.headroomPct > 25,
      `${s.budget.headroomPct}% of the monthly cap remains — reduce spend or raise the cap.`, null, '#/budgets'),
    fix('pipeline is not empty', d.openDeals > 0 || d.intelRecords > 0,
      'No open deals and no intelligence records — the top of the funnel is empty.',
      { action: 'intel.campaign', params: { question: 'Organizations that match our ideal customer profile', targetCount: 8 }, label: 'Start a collection campaign' }, '#/intel'),
    fix('the workforce is being used', s.workforce.some((a) => a.week > 0),
      'No agent has worked this week — the workforce is idle.',
      { action: 'task.delegate', params: { title: 'Weekly company status summary', agentId: 'AGT-DOC-001', details: 'Summarize what changed across the company this week from the audit trail.' }, label: 'Give someone work' }, '#/workforce'),
    fix('automation is carrying load', s.automation.agentActions7d >= s.automation.humanActions7d,
      isEnabled()
        ? `Humans did ${s.automation.humanActions7d} actions to the agents' ${s.automation.agentActions7d}. The orchestrator is already running — this ratio moves as it dispatches work, so run a cycle now or give the workforce more to do.`
        : `Humans did ${s.automation.humanActions7d} actions to the agents' ${s.automation.agentActions7d} — the orchestrator is off, so nothing is dispatching work on its own.`,
      isEnabled()
        ? { action: '__run_cycle', params: {}, label: 'Run a cycle now' }
        : { action: '__enable_maestro', params: {}, label: 'Start the orchestrator' }, '#/harmony'),
  ];
}

/**
 * Do everything an agent is allowed to do to raise the score, and report
 * precisely what only a person can finish. This is the "raise it to the max"
 * button — honest about its own ceiling.
 */
export async function boostHarmony({ actor }) {
  const before = harmonyScore().score;
  const rems = remediations();
  const did = []; const remains = [];
  for (const r of rems.filter((x) => !x.ok)) {
    if (!r.auto) { remains.push({ key: r.key, how: r.how, href: r.href }); continue; }
    if (r.auto.action === '__enable_maestro') {
      setEnabled(true, actor);
      did.push({ key: r.key, detail: 'orchestrator started — it now plans a cycle every hour' });
      continue;
    }
    if (r.auto.action === '__run_cycle') {
      try {
        const c = startCycle({ trigger: 'manual', actor });
        did.push({ key: r.key, detail: `orchestration cycle #${c.id} started — it will dispatch work shortly` });
      } catch (e) {
        remains.push({ key: r.key, how: `${r.how} (a cycle could not start: ${String(e.message).slice(0, 90)})`, href: r.href });
      }
      continue;
    }
    const spec = ACTIONS[r.auto.action];
    if (!spec) { remains.push({ key: r.key, how: r.how, href: r.href }); continue; }
    const dedup = String(spec.key(r.auto.params) || '').slice(0, 120);
    if (!cooledDown(r.auto.action, dedup)) { remains.push({ key: r.key, how: `${r.how} (an identical action ran within ${COOLDOWN_HOURS}h)`, href: r.href }); continue; }
    try {
      const detail = await spec.run(r.auto.params);
      exec('INSERT INTO maestro_actions (cycle_id, action, dedup_key, ok, detail) VALUES (0,?,?,1,?)', r.auto.action, dedup, detail);
      audit({ actorType: 'human', actorId: actor, action: 'harmony.boost_action', subjectType: 'maestro', subjectId: 'boost', payload: { key: r.key, action: r.auto.action, detail } });
      did.push({ key: r.key, detail });
    } catch (e) {
      remains.push({ key: r.key, how: `${r.how} — automatic attempt failed: ${String(e.message).slice(0, 120)}`, href: r.href });
    }
  }
  const after = harmonyScore().score;
  audit({ actorType: 'human', actorId: actor, action: 'harmony.boosted', subjectType: 'maestro', subjectId: 'boost', payload: { before, after, dispatched: did.length, remaining: remains.length } });
  notify({
    level: remains.length ? 'warn' : 'info', source: 'maestro',
    message: `Harmony boost: ${did.length} action(s) dispatched. ${remains.length ? `${remains.length} item(s) can only be finished by a person — see the approvals inbox.` : 'Nothing left that an agent could not do.'}`,
  });
  return { before, after, dispatched: did, remaining: remains, ceiling: after + remains.length ? null : 100 };
}

/**
 * A single read on whether the company is moving in step. Not a vanity metric:
 * each component is something that, left alone, quietly stops work.
 */
export function harmonyScore(snap = null) {
  const s = snap || assessCompany();
  const d = s.departments;
  const parts = [
    { key: 'nothing stalled at the gate', ok: s.queue.awaitingHuman === 0, weight: 1,
      detail: `${s.queue.awaitingHuman} run(s) waiting on a human` },
    { key: 'no blocked tasks', ok: s.stalled.tasksBlocked === 0, weight: 1,
      detail: `${s.stalled.tasksBlocked} blocked task(s)` },
    { key: 'drafts are being published', ok: (s.stalled.postsAwaitingPublish + s.stalled.contentAwaitingApproval) < 5, weight: 1,
      detail: `${s.stalled.postsAwaitingPublish + s.stalled.contentAwaitingApproval} draft(s) waiting for a human` },
    { key: 'relationships are warm', ok: s.stalled.quietPartners.length === 0, weight: 1,
      detail: `${s.stalled.quietPartners.length} partner(s) gone quiet` },
    { key: 'no critical risk unattended', ok: d.criticalRisks === 0, weight: 1.5,
      detail: `${d.criticalRisks} critical risk(s)` },
    { key: 'no open incident', ok: d.openIncidents === 0, weight: 1.5,
      detail: `${d.openIncidents} open incident(s)` },
    { key: 'budget headroom', ok: s.budget.headroomPct > 25, weight: 1,
      detail: `${s.budget.headroomPct}% of the monthly cap left` },
    { key: 'pipeline is not empty', ok: d.openDeals > 0 || d.intelRecords > 0, weight: 1,
      detail: `${d.openDeals} open deal(s), ${d.intelRecords} intel record(s)` },
    { key: 'the workforce is being used', ok: s.workforce.some((a) => a.week > 0), weight: 1,
      detail: `${s.workforce.filter((a) => a.week > 0).length}/${s.workforce.length} agents worked this week` },
    { key: 'automation is carrying load', ok: s.automation.agentActions7d >= s.automation.humanActions7d, weight: 1,
      detail: `${s.automation.agentActions7d} agent vs ${s.automation.humanActions7d} human actions` },
  ];
  const total = parts.reduce((a, p) => a + p.weight, 0);
  const got = parts.reduce((a, p) => a + (p.ok ? p.weight : 0), 0);
  return { score: Math.round((got / total) * 100), parts };
}
