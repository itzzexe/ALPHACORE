// Does the workforce earn its keep — الجدوى.
//
// A company that employs fifty AI agents can answer "what did we spend" from
// the finance page and "what did we earn" from the ledger, and cannot answer the
// only question that decides anything: **which of them is worth having**.
//
// That question is answerable here because the work is already traceable. A run
// drafted the proposal that became the deal that became the invoice that was
// paid. A run drafted the reply that closed the ticket. The chain exists in the
// operational tables; nobody had ever walked it.
//
// One honest word about what these numbers are, said here rather than buried:
//
//   **touched, not caused.** An agent that drafted a proposal did not single-
//   handedly earn the money. A person edited it, a founder took the call, the
//   customer had already decided. Attributing the full invoice to the drafting
//   agent would be flattering and false. So this reports *revenue the agent's
//   work touched*, and says so in the field name, because the alternative is a
//   number that looks like proof and is not.
//
// What it can say without qualification is the cost side: model spend per agent
// is exact, per run, from the meter. So "this agent cost $340 this month and its
// work touched $12,000 of invoiced revenue" is two true statements, one precise
// and one indicative — which is worth more than one made-up ratio.
import { q, one } from './db.js';
import { getSetting } from './settings.js';

const round = (n, p = 2) => Number((Number(n) || 0).toFixed(p));
const period = (m) => m || new Date().toISOString().slice(0, 7);
const div = (a, b) => (b ? round(a / b, 4) : null);

// --------------------------------------------------------------- per agent --

/**
 * What each employee cost, and what its work touched.
 *
 * The cost is from the meter and is exact. The revenue is the sum of paid
 * invoices whose deal was drafted by one of this agent's runs — a real link,
 * not an allocation, and still not a claim of causation.
 */
export function agentEconomics({ month = null } = {}) {
  const p = period(month);
  const rows = q(`
    SELECT a.id, a.name, a.role_group, a.departments, a.status, a.model_tier, a.human_owner,
           COUNT(r.id)                                            AS runs,
           SUM(CASE WHEN r.state = 'done' THEN 1 ELSE 0 END)      AS done,
           SUM(CASE WHEN r.state = 'failed' THEN 1 ELSE 0 END)    AS failed,
           COALESCE(SUM(r.cost_usd), 0)                           AS cost,
           COALESCE(SUM(r.tokens_in + r.tokens_out), 0)           AS tokens
      FROM agents a
      LEFT JOIN runs r ON r.agent_id = a.id AND strftime('%Y-%m', r.created_at) = ?
     GROUP BY a.id ORDER BY cost DESC`, p);

  return rows.map((a) => {
    // Money whose paper trail passes through this agent's work.
    const touched = one(`
      SELECT COALESCE(SUM(i.paid_amount), 0) AS usd, COUNT(DISTINCT i.id) AS invoices
        FROM invoices i
        JOIN deals d ON d.id = i.deal_id
        JOIN runs r  ON r.id = d.draft_run_id
       WHERE r.agent_id = ? AND i.state = 'paid'`, a.id);
    const tickets = one(
      `SELECT COUNT(*) AS n FROM tickets t JOIN runs r ON r.id = t.draft_run_id
        WHERE r.agent_id = ? AND t.state IN ('sent','closed','resolved')`, a.id,
    ).n;

    return {
      ...a,
      cost: round(a.cost, 4),
      costPerRun: div(a.cost, a.runs),
      // A failure costs the same as a success and delivers nothing, which is
      // the cheapest thing to fix and the easiest thing not to notice.
      wasteUsd: a.runs ? round(a.cost * (a.failed / a.runs), 4) : 0,
      revenueTouched: round(touched.usd),
      invoicesTouched: touched.invoices,
      ticketsAnswered: tickets,
      delivered: a.done,
      // Deliberately not called "ROI". See the note at the top of this file.
      touchedPerDollar: a.cost > 0 ? div(touched.usd, a.cost) : null,
    };
  });
}

// ---------------------------------------------------------- per department --

export function departmentEconomics({ month = null } = {}) {
  const p = period(month);
  const byDept = new Map();
  for (const a of agentEconomics({ month: p })) {
    // An agent can belong to more than one department; its cost is split rather
    // than counted twice, or the company appears to spend more than it does.
    const depts = String(a.departments || a.role_group || 'unassigned').split(/[,;\s]+/).filter(Boolean);
    const share = depts.length || 1;
    for (const d of depts.length ? depts : ['unassigned']) {
      const cur = byDept.get(d) || { dept: d, agents: 0, runs: 0, cost: 0, revenueTouched: 0, failed: 0 };
      cur.agents += 1;
      cur.runs += a.runs;
      cur.failed += a.failed;
      cur.cost += a.cost / share;
      cur.revenueTouched += a.revenueTouched / share;
      byDept.set(d, cur);
    }
  }
  return [...byDept.values()]
    .map((d) => ({ ...d, cost: round(d.cost, 4), revenueTouched: round(d.revenueTouched), costPerRun: div(d.cost, d.runs) }))
    .sort((a, b) => b.cost - a.cost);
}

// ------------------------------------------------------------ per customer --

/**
 * What each customer costs to serve, against what they pay.
 *
 * The question behind it is the one nobody asks until it is too late: whether
 * the biggest account is also the least profitable. Support work is traceable
 * through the ticket's drafting run, so the cost of serving is real rather than
 * allocated by headcount.
 */
export function customerEconomics() {
  return q(`
    SELECT c.id, c.name, c.company, c.plan, c.mrr_usd, c.state,
           COALESCE((SELECT SUM(i.paid_amount) FROM invoices i WHERE i.customer_id = c.id AND i.state = 'paid'), 0) AS paid,
           (SELECT COUNT(*) FROM tickets t WHERE t.customer = c.name) AS tickets,
           COALESCE((SELECT SUM(r.cost_usd) FROM tickets t JOIN runs r ON r.id = t.draft_run_id WHERE t.customer = c.name), 0) AS supportCost,
           COALESCE((SELECT SUM(r.cost_usd) FROM deals d JOIN runs r ON r.id = d.draft_run_id WHERE d.customer_id = c.id), 0) AS salesCost
      FROM customers c ORDER BY paid DESC`)
    .map((c) => {
      const cost = Number(c.supportCost || 0) + Number(c.salesCost || 0);
      return {
        ...c,
        paid: round(c.paid),
        costToServe: round(cost, 4),
        supportCost: round(c.supportCost, 4),
        salesCost: round(c.salesCost, 4),
        // Only the model spend attributable to this customer. It is not the
        // whole cost of serving them and does not pretend to be — infrastructure,
        // people and everything else sit in the ledger, not here.
        netOfModelSpend: round(Number(c.paid || 0) - cost),
        ticketsPerMonth: c.tickets,
      };
    });
}

// ---------------------------------------------------------- the whole thing --

/**
 * The company's own unit economics, drawn from the ledger where it can be and
 * from the meter where it cannot.
 */
export function unitEconomics({ month = null } = {}) {
  const p = period(month);

  const spend = one(
    "SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS calls FROM model_calls WHERE strftime('%Y-%m', created_at) = ?", p,
  );
  const runs = one(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN state='done' THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM runs WHERE strftime('%Y-%m', created_at) = ?`, p,
  );
  const revenue = one(
    "SELECT COALESCE(SUM(paid_amount),0) AS usd, COUNT(*) AS n FROM invoices WHERE state='paid' AND strftime('%Y-%m', COALESCE(paid_at, created_at)) = ?", p,
  );
  const won = one(
    "SELECT COUNT(*) AS n, COALESCE(SUM(value_usd),0) AS usd FROM deals WHERE stage IN ('won','closed') AND strftime('%Y-%m', COALESCE(closed_at, created_at)) = ?", p,
  );
  const tickets = one(
    "SELECT COUNT(*) AS n FROM tickets WHERE strftime('%Y-%m', created_at) = ?", p,
  ).n;

  // From the books when they exist, because a margin computed from operational
  // tables and a margin computed from the ledger disagreeing is itself news.
  let fromLedger = null;
  try {
    const rev = one(`
      SELECT COALESCE(SUM(CASE WHEN l.side='credit' THEN l.amount ELSE -l.amount END),0) AS usd
        FROM journal_lines l JOIN journal j ON j.id = l.journal_id JOIN accounts a ON a.code = l.account_code
       WHERE j.state='posted' AND a.type='revenue' AND j.period = ?`, p).usd;
    const exp = one(`
      SELECT COALESCE(SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END),0) AS usd
        FROM journal_lines l JOIN journal j ON j.id = l.journal_id JOIN accounts a ON a.code = l.account_code
       WHERE j.state='posted' AND a.type='expense' AND j.period = ?`, p).usd;
    fromLedger = { revenue: round(rev), expenses: round(exp), net: round(rev - exp), margin: rev ? round(((rev - exp) / rev) * 100, 1) : null };
  } catch { fromLedger = null; }

  const failureWaste = runs.n ? round(spend.usd * (runs.failed / runs.n), 4) : 0;

  return {
    period: p,
    spendUsd: round(spend.usd, 4),
    modelCalls: spend.calls,
    runs: runs.n,
    delivered: runs.done,
    failed: runs.failed,
    revenueUsd: round(revenue.usd),
    invoicesPaid: revenue.n,

    // The numbers an owner actually uses.
    costPerRun: div(spend.usd, runs.n),
    costPerDelivered: div(spend.usd, runs.done),
    costPerTicket: div(spend.usd, tickets),
    costPerDealWon: div(spend.usd, won.n),
    // What the failures cost. Rerunning work that failed is the purest waste in
    // the building, and it is invisible unless somebody totals it.
    failureWasteUsd: failureWaste,
    failureRate: runs.n ? round((runs.failed / runs.n) * 100, 1) : 0,

    // Does the workforce pay for itself this month? Stated as a ratio and a
    // plain sentence, because a ratio alone gets misread in both directions.
    coverage: spend.usd > 0 ? div(revenue.usd, spend.usd) : null,
    says: spend.usd <= 0
      ? 'Nothing has been spent this month, so there is nothing to judge yet.'
      : (revenue.usd >= spend.usd
        ? `Every dollar of model spend this month sits against ${div(revenue.usd, spend.usd)} dollars of collected revenue.`
        : `Model spend is ${round(spend.usd, 2)} against ${round(revenue.usd, 2)} collected. That is normal early and worth watching.`),

    fromLedger,
    // Where the two disagree, say so rather than quietly preferring one.
    ledgerAgrees: fromLedger && Math.abs(fromLedger.revenue - revenue.usd) < 0.02,

    honestly: 'Cost is exact, from the meter, per run. Revenue attributed to an agent is revenue its work *touched* — '
      + 'a run drafted the proposal behind the invoice. It is a real link and not a claim that the agent earned the money.',
  };
}

export function economicsOverview({ month = null } = {}) {
  const p = period(month);
  const agents = agentEconomics({ month: p });
  return {
    ...unitEconomics({ month: p }),
    // Only the ones that actually did something: a page listing fifty idle
    // employees at $0 buries the three that matter.
    agents: agents.filter((a) => a.runs > 0 || a.revenueTouched > 0).slice(0, 40),
    idleAgents: agents.filter((a) => !a.runs).length,
    departments: departmentEconomics({ month: p }).slice(0, 20),
    customers: customerEconomics().slice(0, 20),
    currency: getSetting('FUNCTIONAL_CURRENCY') || 'USD',
  };
}
