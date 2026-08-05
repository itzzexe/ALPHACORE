// Finance pack (Part 6 §10) — computed from the platform's own metering, not
// estimates. Export writes the monthly pack as a markdown artifact.
import fs from 'node:fs';
import path from 'node:path';
import { q, one } from './db.js';
import { budgetsConfig } from './env.js';
import { audit } from './audit.js';
import { WS_ROOT } from './artifacts.js';
import { archiveItem } from './data.js';

export function financeReport(month = null) {
  const m = month || new Date().toISOString().slice(0, 7);
  const from = `${m}-01`;
  const byProvider = q(`
    SELECT provider, COUNT(*) AS calls, SUM(ok = 0) AS errors,
           COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout,
           COALESCE(SUM(cost_usd),0) AS cost
    FROM model_calls WHERE created_at >= ? GROUP BY provider ORDER BY cost DESC, calls DESC`, from);
  const byAgent = q(`
    SELECT agent_id, COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost,
           SUM(state = 'done') AS done, SUM(state = 'failed') AS failed
    FROM runs WHERE created_at >= ? GROUP BY agent_id ORDER BY cost DESC`, from);
  const totals = one(`SELECT COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS calls FROM model_calls WHERE created_at >= ?`, from);
  const gov = one(`SELECT COALESCE(SUM(spent_usd),0) AS s FROM budgets WHERE scope = 'governance' AND period_key = ?`, m);
  const subs = one(`SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, COUNT(*) AS calls FROM model_calls WHERE provider = 'claude-subscription' AND created_at >= ?`, from);
  const activity = {
    pipelines: one(`SELECT COUNT(*) AS n FROM pipelines WHERE created_at >= ?`, from).n,
    decisions: one(`SELECT COUNT(*) AS n FROM decisions WHERE created_at >= ?`, from).n,
    incidents: one(`SELECT COUNT(*) AS n FROM incidents WHERE created_at >= ?`, from).n,
    ticketsSent: one(`SELECT COUNT(*) AS n FROM tickets WHERE sent_at >= ?`, from).n,
  };
  const capUsd = budgetsConfig.company.monthlyCapUsd;

  // Commercial + corporate lines: MRR from the CRM, CAC from campaigns,
  // fixed vendor burn from procurement (Part 6 unit-economics discipline).
  const mrr = one("SELECT COALESCE(SUM(mrr_usd),0) AS s FROM customers WHERE state = 'active'").s;
  const newActive = one("SELECT COUNT(*) AS n FROM customers WHERE state = 'active' AND created_at >= ?", from).n;
  const churned = one("SELECT COUNT(*) AS n FROM customers WHERE churned_at >= ?", from).n;
  const marketingSpend = one('SELECT COALESCE(SUM(spent_usd),0) AS s FROM campaigns').s;
  const vendorBurn = one("SELECT COALESCE(SUM(monthly_usd),0) AS s FROM vendors WHERE state = 'active'").s;

  return {
    month: m, capUsd,
    totalCostUsd: totals.cost, totalCalls: totals.calls,
    capConsumedPct: capUsd ? (totals.cost / capUsd) * 100 : 0,
    governanceUsd: gov?.s || 0,
    governancePctOfSpend: totals.cost > 0 ? ((gov?.s || 0) / totals.cost) * 100 : 0,
    subscription: subs,
    byProvider, byAgent, activity,
    commercial: {
      mrrUsd: mrr,
      newActiveCustomers: newActive,
      churnedThisMonth: churned,
      marketingSpendUsd: marketingSpend,
      // Cash CAC — flatters because founder labor is free in it (Part 6 §6.3
      // honesty note); the loaded figure is a Phase 3 recomputation.
      cashCacUsd: newActive > 0 ? marketingSpend / newActive : null,
      vendorBurnUsd: vendorBurn,
      monthlyBurnUsd: vendorBurn + totals.cost,
    },
  };
}

export function exportFinanceReport(actor) {
  const r = financeReport();
  const md = [
    `# Finance Pack — ${r.month}`,
    '',
    `Cash model-spend: **$${r.totalCostUsd.toFixed(4)}** of $${r.capUsd} cap (${r.capConsumedPct.toFixed(1)}%) across ${r.totalCalls} calls.`,
    `Governance pool: $${r.governanceUsd.toFixed(4)} (${r.governancePctOfSpend.toFixed(1)}% of spend; rule ≤5% of budget).`,
    `Claude subscription served ${r.subscription.calls} calls — ${r.subscription.tin.toLocaleString()} in / ${r.subscription.tout.toLocaleString()} out tokens at $0 cash.`,
    '',
    '## Spend by provider',
    '| Provider | Calls | Errors | Tokens in | Tokens out | Cost |',
    '|---|---:|---:|---:|---:|---:|',
    ...r.byProvider.map((p) => `| ${p.provider} | ${p.calls} | ${p.errors || 0} | ${p.tin} | ${p.tout} | $${p.cost.toFixed(4)} |`),
    '',
    '## Runs by agent',
    '| Agent | Runs | Done | Failed | Cost |',
    '|---|---:|---:|---:|---:|',
    ...r.byAgent.map((a) => `| ${a.agent_id} | ${a.runs} | ${a.done} | ${a.failed} | $${a.cost.toFixed(4)} |`),
    '',
    '## Commercial',
    `MRR: **$${r.commercial.mrrUsd.toFixed(2)}** · new active customers this month: ${r.commercial.newActiveCustomers} · churned: ${r.commercial.churnedThisMonth}`,
    `Marketing spend (all campaigns): $${r.commercial.marketingSpendUsd.toFixed(2)} · cash CAC: ${r.commercial.cashCacUsd !== null ? '$' + r.commercial.cashCacUsd.toFixed(2) : 'n/a'} *(flattering — founder labor uncosted; Part 6 §6.3)*`,
    `Vendor fixed burn: $${r.commercial.vendorBurnUsd.toFixed(2)}/mo · total monthly burn (vendors + model spend): $${r.commercial.monthlyBurnUsd.toFixed(2)}`,
    '',
    '## Activity',
    `Pipelines: ${r.activity.pipelines} · Decisions: ${r.activity.decisions} · Incidents: ${r.activity.incidents} · Tickets sent: ${r.activity.ticketsSent}`,
    '',
    `*Generated ${new Date().toISOString()} by ${actor}. Numbers come from the platform's own metering; reconcile against provider invoices monthly (Part 3 §4.2).*`,
  ].join('\n');
  const dir = path.join(WS_ROOT, '_reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = `finance-${r.month}.md`;
  fs.writeFileSync(path.join(dir, file), md, 'utf8');
  audit({ actorType: 'human', actorId: actor, action: 'finance.exported', subjectType: 'artifact', subjectId: `_reports/${file}` });
  archiveItem({ title: `Finance pack ${r.month}`, kind: 'finance', subjectType: 'artifact', subjectId: `_reports/${file}`, snapshot: { month: r.month, totalCostUsd: r.totalCostUsd, mrr: r.commercial.mrrUsd }, fileRef: `_reports/${file}`, actor });
  return { path: `_reports/${file}` };
}
