// The closed revenue loop.
//
// Every hop already existed, alone: intelligence found companies, relations
// drafted outreach, sales wrote proposals, the treasury issued invoices, the
// workstreams delivered. Nothing joined them, so a lead became a row and
// stopped. This module is the joining — one state machine over the whole path,
// from a name on a list to money in an account.
//
//   sourced → contacted → replied → meeting → proposal → agreed → invoiced → paid → delivering → delivered
//
// Two things make it safe to run without a person standing over it. Every hop
// that touches somebody outside goes through the egress gate, so it obeys the
// allowlist, the quota and the constitution. And the two hops that cannot be
// undone — signing and taking money — are in the always-gated set, so the loop
// runs itself right up to the moment a person is genuinely needed, and then
// waits.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { callConnector } from './connectors/index.js';
import { enqueue } from './jobs.js';

const STAGES = ['sourced', 'contacted', 'replied', 'meeting', 'proposal', 'agreed', 'invoiced', 'paid', 'delivering', 'delivered'];

/** Which employee owns which hop. Falls back to whoever is active. */
function owner(roleGroup) {
  return one("SELECT id FROM agents WHERE role_group = ? AND status = 'active' ORDER BY random() LIMIT 1", roleGroup)?.id
    || one("SELECT id FROM agents WHERE status = 'active' ORDER BY random() LIMIT 1")?.id
    || null;
}

const stageOf = (d) => (STAGES.includes(d.stage) ? d.stage : 'sourced');

/**
 * Turn a qualified intel record into a deal — the first hop, and the only one
 * that creates something rather than moving it.
 */
export function sourceFromIntel({ limit = 3, actor = 'system:revenue' } = {}) {
  const ready = q(`SELECT * FROM intel_records
    WHERE state IN ('targeted','qualified') AND customer_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.name = intel_records.name)
    ORDER BY confidence DESC, completeness DESC LIMIT ?`, limit);
  const made = [];
  for (const r of ready) {
    const res = exec(
      "INSERT INTO deals (name, value_usd, stage, owner, notes) VALUES (?,?,'sourced',?,?)",
      `${r.name}`, 0, owner('run'), `Sourced from intelligence record ${r.id}. ${r.sector || ''} ${r.country || ''}`.trim(),
    );
    const id = Number(res.lastInsertRowid);
    audit({ actorType: 'system', actorId: actor, action: 'revenue.sourced', subjectType: 'deal', subjectId: id, payload: { intel: r.id, name: r.name } });
    made.push(id);
  }
  return made;
}

/** Ask the right employee to produce whatever this hop needs next. */
function commission(deal, stage) {
  const briefs = {
    contacted: {
      role: 'discover', taskType: 'outreach_draft',
      instruction: 'Write a first approach to this company. One short paragraph, no flattery, name the specific thing we think they need and why we think it. Return JSON: {"subject": "...", "body": "...", "why_them": "..."}',
    },
    meeting: {
      role: 'run', taskType: 'meeting_propose',
      instruction: 'They answered. Propose a meeting: three concrete slots in the next five working days, an agenda of at most four lines, and what we want to leave with. Return JSON: {"slots": ["ISO", "ISO", "ISO"], "agenda": "...", "goal": "..."}',
    },
    proposal: {
      role: 'create', taskType: 'proposal_draft',
      instruction: 'Write the proposal. Scope, what is explicitly out of scope, timeline, price, and the assumption that would change the price. Return JSON: {"scope": "...", "out_of_scope": "...", "timeline": "...", "price_usd": 0, "assumptions": "..."}',
    },
    delivering: {
      role: 'build', taskType: 'delivery_plan',
      instruction: 'They paid. Plan the delivery: milestones with dates, who owns each, and the first thing that must happen this week. Return JSON: {"milestones": [{"name": "...", "due": "...", "owner": "..."}], "first_step": "..."}',
    },
  };
  const b = briefs[stage];
  if (!b) return null;
  const agentId = owner(b.role);
  if (!agentId) return null;
  return enqueueRun({
    agentId, taskType: b.taskType, actor: 'system:revenue',
    input: { instruction: b.instruction, deal: { id: deal.id, name: deal.name, value: deal.value_usd, notes: deal.notes } },
  });
}

/** Move one deal one hop, if the thing it was waiting for has arrived. */
function advance(deal) {
  const stage = stageOf(deal);
  const next = STAGES[STAGES.indexOf(stage) + 1];
  if (!next) return null;

  // A hop only completes when its artefact exists — no deal advances on hope.
  const waiting = {
    sourced: () => Boolean(one("SELECT id FROM runs WHERE task_type = 'outreach_draft' AND state = 'done' AND input LIKE ?", `%"id":${deal.id},%`)),
    contacted: () => Boolean(one("SELECT id FROM interactions WHERE customer_id = ? AND kind = 'reply'", deal.customer_id)),
    replied: () => Boolean(one("SELECT id FROM runs WHERE task_type = 'meeting_propose' AND state = 'done' AND input LIKE ?", `%"id":${deal.id},%`)),
    meeting: () => Boolean(one("SELECT id FROM runs WHERE task_type = 'proposal_draft' AND state = 'done' AND input LIKE ?", `%"id":${deal.id},%`)),
    proposal: () => false,   // agreeing is a human act; the gate holds it
    agreed: () => Boolean(one("SELECT id FROM invoices WHERE deal_id = ?", deal.id)),
    invoiced: () => Boolean(one("SELECT id FROM invoices WHERE deal_id = ? AND state = 'paid'", deal.id)),
    paid: () => true,
    delivering: () => Boolean(one("SELECT id FROM workstreams WHERE title LIKE ? AND state = 'closed'", `%${deal.name}%`)),
  };
  if (!(waiting[stage] || (() => false))()) return null;

  exec('UPDATE deals SET stage = ? WHERE id = ?', next, deal.id);
  audit({ actorType: 'system', actorId: 'system:revenue', action: 'revenue.advanced', subjectType: 'deal', subjectId: deal.id, payload: { from: stage, to: next } });
  const runId = commission({ ...deal, stage: next }, next);
  return { deal: deal.id, from: stage, to: next, runId };
}

/** The loop itself, one turn. Runs on a timer like everything else. */
export function revenueTick() {
  const moved = [];
  for (const deal of q(`SELECT * FROM deals WHERE stage IN (${STAGES.map(() => '?').join(',')})`, ...STAGES)) {
    try {
      const step = advance(deal);
      if (step) moved.push(step);
    } catch { /* one stuck deal must not stop the others */ }
  }
  // Start work for deals that are sitting at a hop with nothing commissioned.
  for (const deal of q("SELECT * FROM deals WHERE stage = 'sourced' LIMIT 5")) {
    const has = one("SELECT id FROM runs WHERE task_type = 'outreach_draft' AND input LIKE ?", `%"id":${deal.id},%`);
    if (!has) commission(deal, 'contacted');
  }
  return moved;
}

/**
 * Send the approach that was drafted. This is the hop that leaves the machine,
 * so it goes through the gate under the sender's own scope — and if the gate
 * holds it, the deal simply waits, which is the correct behaviour.
 */
export async function sendOutreach({ dealId, connector = 'gmail', to, agentId = null, actor = null }) {
  const deal = one('SELECT * FROM deals WHERE id = ?', dealId);
  if (!deal) throw new Error('no such deal');
  const run = one("SELECT * FROM runs WHERE task_type = 'outreach_draft' AND state = 'done' AND input LIKE ? ORDER BY id DESC LIMIT 1", `%"id":${dealId},%`);
  if (!run?.output) throw new Error('there is no approach written for this deal yet');
  let draft;
  try {
    const out = JSON.parse(run.output);
    draft = out.parsed || out;
    if (typeof draft === 'string') draft = JSON.parse(draft);
  } catch { throw new Error('the drafted approach could not be read'); }

  const result = await callConnector({
    connector, capability: 'mail.send',
    args: { to, subject: draft.subject, body: draft.body, sources: `deal:${dealId}` },
    agentId: agentId || run.agent_id, runId: run.id, actor,
    reason: `first approach for deal ${dealId} (${deal.name})`,
  });
  if (result.verdict === 'allowed' || result.verdict === 'dry') {
    exec("UPDATE deals SET stage = 'contacted' WHERE id = ? AND stage = 'sourced'", dealId);
    exec("INSERT INTO interactions (customer_id, kind, summary, logged_by) VALUES (?,?,?,?)",
      deal.customer_id, 'outreach', `${result.verdict === 'dry' ? '[dry run] ' : ''}${draft.subject}`, agentId || run.agent_id);
  }
  return { ...result, dealId, stage: one('SELECT stage FROM deals WHERE id = ?', dealId).stage };
}

/** Invoice an agreed deal. Money is gated, so this prepares and waits. */
export function invoiceDeal({ dealId, amountUsd, actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person raises an invoice');
  const deal = one('SELECT * FROM deals WHERE id = ?', dealId);
  if (!deal) throw new Error('no such deal');
  exec(
    "INSERT INTO invoices (ref, customer_id, deal_id, description, amount, asset, state, created_by) VALUES (?,?,?,?,?,?,'open',?)",
    `INV-${dealId}-${Date.now().toString(36).toUpperCase()}`, deal.customer_id, dealId, deal.name, amountUsd, 'USD', actor,
  );
  exec("UPDATE deals SET stage = 'invoiced', value_usd = ? WHERE id = ?", amountUsd, dealId);
  audit({ actorType: 'human', actorId: actor, action: 'revenue.invoiced', subjectType: 'deal', subjectId: dealId, payload: { amountUsd } });
  // Chase it in a week if nobody has paid — the queue remembers so a person
  // does not have to.
  enqueue('revenue.chase', { dealId }, {
    idempotency: `chase:${dealId}`,
    runAfter: new Date(Date.now() + 7 * 864e5).toISOString().replace('T', ' ').slice(0, 19),
  });
  return { ok: true, dealId, amountUsd };
}

export function revenueOverview() {
  const byStage = Object.fromEntries(q('SELECT stage, COUNT(*) AS n, COALESCE(SUM(value_usd),0) AS v FROM deals GROUP BY stage').map((r) => [r.stage, { count: r.n, value: r.v }]));
  const funnel = STAGES.map((s) => ({ stage: s, count: byStage[s]?.count || 0, value: byStage[s]?.value || 0 }));
  const total = funnel.reduce((a, f) => a + f.count, 0);
  return {
    stages: STAGES,
    funnel,
    conversion: funnel.map((f, i) => ({
      stage: f.stage,
      fromPrevious: i === 0 || !funnel[i - 1].count ? null : Number(((f.count / funnel[i - 1].count) * 100).toFixed(1)),
    })),
    counts: {
      inFlight: total,
      won: byStage.delivered?.count || 0,
      valueInFlight: funnel.filter((f) => !['delivered', 'paid'].includes(f.stage)).reduce((a, f) => a + f.value, 0),
      collected: (byStage.paid?.value || 0) + (byStage.delivered?.value || 0),
    },
    deals: q('SELECT id, name, stage, value_usd, owner, created_at FROM deals ORDER BY id DESC LIMIT 40'),
    waitingOnAPerson: q("SELECT id, name, stage, value_usd FROM deals WHERE stage IN ('proposal','agreed') ORDER BY value_usd DESC"),
    recentMoves: q("SELECT subject_id AS deal, payload, occurred_at FROM audit_log WHERE action = 'revenue.advanced' ORDER BY seq DESC LIMIT 20")
      .map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') })),
  };
}
