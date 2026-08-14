// Financial Reporting division — statements, budgets, annual reports, company
// research, and a standing assessment of our own financial health.
//
// The distinction that makes this useful rather than decorative: reports about
// OUR company are built from the platform's own ledgers — model spend, MRR,
// vendor burn, pipeline, campaign cost — so the numbers are the real ones and
// the analyst is only asked to interpret and present them. Reports about an
// external company are explicitly labelled as unverified research.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { companyName } from './settings.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { archiveItem } from './data.js';
import { budgetsConfig } from './env.js';
import { openPii } from './erasure.js';

const FIN_DIR = path.join(WS_ROOT, '_finance');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'report';
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const REPORT_KINDS = {
  pnl: { label: 'Profit & Loss (income statement)', internal: true,
    brief: 'A complete P&L for the period: revenue by line, cost of revenue, gross profit and margin, operating expenses by category, EBITDA, depreciation if any, net result. Then a variance commentary against the prior period and the three lines that moved most.' },
  'balance-sheet': { label: 'Balance sheet', internal: true,
    brief: 'Assets (current and non-current), liabilities (current and non-current), and equity, balancing exactly. Where a figure is not in the supplied data, list it as [Unknown — supply this] rather than inventing it, and show the balancing check explicitly.' },
  'cash-flow': { label: 'Cash flow statement', internal: true,
    brief: 'Operating, investing and financing cash flows with the opening and closing cash position, the monthly burn rate, and the runway in months at the current burn. State the runway assumption plainly.' },
  budget: { label: 'Budget / forecast', internal: true,
    brief: 'A forward budget by category with the basis for each figure, a monthly phasing table, best/base/worst scenarios, the break-even point, and the trigger conditions that should force a re-forecast.' },
  'annual-report': { label: 'Annual report', internal: true,
    brief: 'A full annual report: executive summary, the year in review, financial statements summary, operational KPIs, customer and revenue analysis, risk review, governance statement, and outlook with stated assumptions.' },
  'company-research': { label: 'Financial research on a company', internal: false,
    brief: 'Everything known about the subject company financially: business model, revenue streams, funding history, known financials with their periods, market position and competitors, growth signals, and financial risk factors. Every figure must carry [Unverified — training knowledge, as of <period>] unless it was supplied in the data below. State clearly what could not be established.' },
  'health-check': { label: 'Financial health assessment', internal: true,
    brief: 'An assessment of financial condition: liquidity, burn and runway, revenue concentration, unit economics, cost structure, and margin trend. Score each dimension out of 5 with the reasoning, give an overall verdict, and list the specific actions that would most improve the position.' },
};

/** Pull the company's real figures out of the platform's own ledgers. */
export function ownFinancials(period = null) {
  const month = period && /^\d{4}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const spend = one('SELECT COALESCE(SUM(cost_usd),0) AS s, COUNT(*) AS calls, COALESCE(SUM(tokens_in),0) AS ti, COALESCE(SUM(tokens_out),0) AS toks FROM model_calls WHERE created_at >= ?', start);
  const byProvider = q('SELECT provider, COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS calls FROM model_calls WHERE created_at >= ? GROUP BY provider ORDER BY cost DESC', start);
  const byAgent = q('SELECT agent_id, COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost FROM runs WHERE created_at >= ? GROUP BY agent_id ORDER BY cost DESC', start);
  const customers = q("SELECT state, COUNT(*) AS n, COALESCE(SUM(mrr_usd),0) AS mrr FROM customers GROUP BY state");
  const mrr = one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'").n;
  const vendors = q("SELECT name, service, monthly_usd FROM vendors WHERE state = 'active' AND monthly_usd > 0 ORDER BY monthly_usd DESC");
  const campaigns = one("SELECT COALESCE(SUM(spent_usd),0) AS spent, COALESCE(SUM(budget_usd),0) AS budget FROM campaigns");
  const deals = one("SELECT COALESCE(SUM(CASE WHEN stage='won' THEN value_usd ELSE 0 END),0) AS won, COALESCE(SUM(CASE WHEN stage IN ('lead','qualified','proposal') THEN value_usd ELSE 0 END),0) AS pipeline FROM deals");
  const history = q("SELECT substr(created_at,1,7) AS m, COALESCE(SUM(cost_usd),0) AS cost FROM model_calls GROUP BY m ORDER BY m DESC LIMIT 6");
  const vendorBurn = vendors.reduce((a, v) => a + v.monthly_usd, 0);

  return {
    period: month,
    revenue: { mrrUsd: money(mrr), arrUsd: money(mrr * 12), byState: customers, dealsWonUsd: money(deals.won), pipelineUsd: money(deals.pipeline) },
    costs: {
      modelSpendUsd: money(spend.s), modelCalls: spend.calls, tokensIn: spend.ti, tokensOut: spend.toks,
      byProvider: byProvider.map((p) => ({ ...p, cost: money(p.cost) })),
      byAgent: byAgent.slice(0, 12).map((a) => ({ ...a, cost: money(a.cost) })),
      vendorBurnUsd: money(vendorBurn), vendors,
      marketingSpentUsd: money(campaigns.spent), marketingBudgetUsd: money(campaigns.budget),
      totalMonthlyUsd: money(spend.s + vendorBurn + campaigns.spent),
    },
    caps: { companyMonthlyCapUsd: budgetsConfig.company.monthlyCapUsd, governanceCapUsd: budgetsConfig.governance.monthlyCapUsd },
    net: { grossUsd: money(mrr - (spend.s + vendorBurn + campaigns.spent)) },
    spendHistory: history.map((h) => ({ month: h.m, cost: money(h.cost) })),
  };
}

export function createFinReport({ kind, title = null, subject = 'own', period = null, inputs = null, actor }) {
  const spec = REPORT_KINDS[kind];
  if (!spec) throw new Error(`kind must be one of: ${Object.keys(REPORT_KINDS).join(', ')}`);
  const subj = spec.internal ? 'own' : (subject?.trim() || null);
  if (!spec.internal && !subj) throw new Error('a company name is required for external research');
  const per = period?.trim() || new Date().toISOString().slice(0, 7);
  const name = title?.trim() || `${spec.label} — ${spec.internal ? companyName() : subj} (${per})`;

  // Internal reports are built on our own ledgers; external ones start empty.
  const figures = spec.internal ? ownFinancials(per) : (inputs || null);
  exec('INSERT INTO fin_reports (kind, title, subject, period, inputs, created_by) VALUES (?,?,?,?,?,?)',
    kind, name, spec.internal ? 'own' : subj, per, figures ? JSON.stringify(figures) : null, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;

  const dataBlock = figures
    ? `\n\nREAL FIGURES — these come from the company's own ledgers. Use exactly these numbers; do not round them into a different story, and do not invent any figure that is absent:\n\`\`\`json\n${JSON.stringify(figures, null, 2).slice(0, 9000)}\n\`\`\``
    : '\n\nNo figures were supplied. Work from what you know, label every number [Unverified] with its period, and list plainly what could not be established.';

  const runId = enqueueRun({
    agentId: 'AGT-FIN-001',
    taskType: `finreport:${id}`,
    input: {
      prompt: `Prepare this financial document in full.

Document: ${spec.label}
Subject: ${spec.internal ? `${companyName()} (our own company)` : subj}
Period: ${per}

What it must contain:
${spec.brief}

Present every statement as a table, show the arithmetic for any derived figure, and finish with a short "what this means" section written for a founder rather than an accountant.${dataBlock}`,
    },
    actor,
  });
  exec('UPDATE fin_reports SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'finreport.requested', subjectType: 'finReport', subjectId: id, payload: { kind, subject: spec.internal ? 'own' : subj, period: per } });
  return getFinReport(id);
}

export function getFinReport(id) {
  const r = one('SELECT * FROM fin_reports WHERE id = ?', id);
  if (!r) return null;
  return {
    ...r,
    inputs: r.inputs ? JSON.parse(r.inputs) : null,
    metrics: r.metrics ? JSON.parse(r.metrics) : null,
    flags: r.flags ? JSON.parse(r.flags) : [],
  };
}

export function listFinReports() {
  return q('SELECT id FROM fin_reports ORDER BY id DESC LIMIT 60').map((r) => {
    const f = getFinReport(r.id);
    return { ...f, inputs: undefined, hasInputs: Boolean(f.inputs) };
  });
}

export function approveFinReport(id, { actor }) {
  const r = one('SELECT * FROM fin_reports WHERE id = ?', id);
  if (!r) throw new Error('report not found');
  if (r.state !== 'ready') throw new Error(`report is ${r.state}`);
  exec("UPDATE fin_reports SET state = 'approved', approved_by = ? WHERE id = ?", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'finreport.approved', subjectType: 'finReport', subjectId: id, payload: { kind: r.kind, period: r.period } });
  archiveItem({ title: `Financial report approved: ${r.title}`, kind: 'finance', subjectType: 'finReport', subjectId: id, snapshot: { kind: r.kind, period: r.period }, fileRef: r.file_ref, actor });
  return getFinReport(id);
}

/** Server tick — fold finished analyst runs into their reports. */
export function syncFinReports() {
  for (const r of q("SELECT * FROM fin_reports WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', r.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null;
    if (parsed?.markdown) {
      // Financial work held at the gate (low self-reported confidence, say) is
      // still the analysis. Publish it for review with that caveat attached
      // rather than discarding it — approval is a human act either way.
      const held = run.state !== 'done';
      const body = `# ${parsed.title || r.title}\n\n${parsed.markdown}`;
      fs.mkdirSync(FIN_DIR, { recursive: true });
      const rel = `_finance/${r.kind}-${slug(r.subject)}-${r.period}-${r.id}.md`;
      fs.writeFileSync(path.join(WS_ROOT, rel), body, 'utf8');
      const flags = [...(parsed.flags || [])];
      if (held) flags.unshift(`held for review by the platform: ${run.failure_reason || run.state}`);
      exec("UPDATE fin_reports SET state = 'ready', content = ?, metrics = ?, flags = ?, file_ref = ? WHERE id = ?",
        body, JSON.stringify(parsed.metrics || {}), JSON.stringify(flags), rel, r.id);
      notify({
        level: flags.length ? 'warn' : 'info', source: 'finance',
        message: `Financial report ready: ${r.title}${flags.length ? ` — ${flags.length} flag(s) to read first` : ''}.`,
        subjectType: 'finReport', subjectId: r.id,
      });
    } else if (['failed', 'cancelled', 'awaiting_human'].includes(run.state)) {
      exec("UPDATE fin_reports SET state = 'failed', content = ? WHERE id = ?", run.failure_reason || `run ${run.state}`, r.id);
    }
  }
}

export function finReportsOverview() {
  const own = ownFinancials();
  return {
    kinds: Object.entries(REPORT_KINDS).map(([id, k]) => ({ id, label: k.label, internal: k.internal })),
    total: one('SELECT COUNT(*) AS n FROM fin_reports').n,
    ready: one("SELECT COUNT(*) AS n FROM fin_reports WHERE state IN ('ready','approved')").n,
    drafting: one("SELECT COUNT(*) AS n FROM fin_reports WHERE state = 'drafting'").n,
    live: {
      mrrUsd: own.revenue.mrrUsd, arrUsd: own.revenue.arrUsd,
      monthlyCostUsd: own.costs.totalMonthlyUsd, netUsd: own.net.grossUsd,
      pipelineUsd: own.revenue.pipelineUsd, vendorBurnUsd: own.costs.vendorBurnUsd,
      runwayNote: own.costs.totalMonthlyUsd > 0
        ? `at the current ${own.costs.totalMonthlyUsd}/mo cost, each $1,000 of cash buys ${(1000 / own.costs.totalMonthlyUsd).toFixed(1)} months`
        : 'no cash cost recorded this month',
    },
    spendHistory: own.spendHistory,
  };
}
