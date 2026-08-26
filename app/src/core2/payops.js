// FINANCE OPS — expenses, loans, cost centers, and the payroll engine.
//
// The directive's formula, implemented exactly and in this order:
//
//   base + allowances + overtime + bonuses + commissions
//   − absences − deductions − loans − penalties
//   = gross adjustments; then − taxes − contributions = net
//
// Two rules shape everything here:
//
//   Core 2 never posts a journal entry. A closed payroll run and a paid
//   expense emit events; the bridge hands them to Core 1's ledger through the
//   same journalEntry() an accountant uses. If this file ever imports
//   ledger.js, it has gone wrong.
//
//   Payroll approval is a human act, always, whatever the amount. approvePayroll
//   sits on the gateway's categorical list, so an agent may *draft* a run —
//   compute it, check it, present it — and can never approve one. The module
//   enforces the same thing again here, because a rule that lives in one place
//   is a rule one refactor away from living nowhere.
import { q, one, exec } from '../db.js';
import { sealForRef, openPii } from '../erasure.js';
import { log } from './identity.js';
import { emit } from './bridge.js';
import { payrollInputs } from './hrplus.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const round2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------ cost centers --

export function createCostCenter({ name, code, budgetUsd = 0, actor }) {
  if (!actor) refuse('a cost center is an act and carries a name');
  exec('INSERT INTO fin_cost_center (name, code, budget_usd) VALUES (?,?,?)',
    clean(name), clean(code, 20), Number(budgetUsd) || 0);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'cost_center', entityId: id, action: 'finops.cost_center_created', actor });
  return one('SELECT * FROM fin_cost_center WHERE id = ?', id);
}

/** Spend against each center this year: expenses plus procurement, in SQL. */
export function costCenters() {
  return q(`
    SELECT c.*,
      COALESCE((SELECT SUM(e.amount) FROM fin_expense e WHERE e.cost_center_id = c.id AND e.state IN ('approved','paid')), 0)
      + COALESCE((SELECT SUM(p.amount) FROM proc_request p WHERE p.cost_center_id = c.id AND p.state NOT IN ('requested','rejected')), 0)
      AS spent
    FROM fin_cost_center c WHERE c.state = 'active' ORDER BY c.code`);
}

// ---------------------------------------------------------------- expenses --

export function submitExpense({ employeeId, kind = 'expense', category = 'other', amount, costCenterId = null, actor }) {
  if (!actor) refuse('an expense is an act and carries a name');
  if (!one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(employeeId))) refuse('no such active employee');
  const usd = round2(Number(amount));
  if (!(usd > 0)) refuse('an expense needs a positive amount');
  exec('INSERT INTO fin_expense (employee_id, kind, category, amount, cost_center_id, submitted_by) VALUES (?,?,?,?,?,?)',
    Number(employeeId), kind === 'advance' ? 'advance' : 'expense', clean(category, 40), usd,
    costCenterId ? Number(costCenterId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'expense', entityId: id, action: 'expense.submitted', actor, detail: { usd, kind } });
  emit('expense.submitted', { id, employeeId: Number(employeeId), amount: usd });
  return one('SELECT * FROM fin_expense WHERE id = ?', id);
}

/**
 * Decide an expense. Reachable two ways, on purpose: a human through the route,
 * and an agent through the gateway's approve_expense tool — where the ordinary
 * value ceiling applies, so a small expense clears on a granted scope and a
 * large one waits for a person. Routine money is Core 1's existing pattern;
 * only payroll is categorical.
 */
export function decideExpense(id, { approve, actor }) {
  if (!actor) refuse('deciding an expense carries a name');
  const e = one('SELECT * FROM fin_expense WHERE id = ?', Number(id));
  if (!e) refuse('no such expense');
  if (e.state !== 'submitted') refuse(`this expense is already ${e.state}`);
  const state = approve ? 'approved' : 'rejected';
  exec("UPDATE fin_expense SET state = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", state, String(actor), e.id);
  log({ entity: 'expense', entityId: e.id, action: `expense.${state}`, actor, detail: { usd: e.amount } });
  return one('SELECT * FROM fin_expense WHERE id = ?', e.id);
}

/** Mark paid. This is the moment money moved, so this is what reaches the ledger. */
export function payExpense(id, { actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('paying out is a human act');
  const e = one('SELECT * FROM fin_expense WHERE id = ?', Number(id));
  if (!e) refuse('no such expense');
  if (e.state !== 'approved') refuse('only an approved expense can be paid');
  exec("UPDATE fin_expense SET state = 'paid', paid_at = datetime('now') WHERE id = ?", e.id);
  log({ entity: 'expense', entityId: e.id, action: 'expense.paid', actor, detail: { usd: e.amount }, chain: true });
  emit('expense.paid', { id: e.id, amount: e.amount, category: e.category });
  return one('SELECT * FROM fin_expense WHERE id = ?', e.id);
}

export function listExpenses({ state = null, limit = 200 } = {}) {
  let sql = `SELECT e.*, p.display_name FROM fin_expense e
               JOIN hr_employee emp ON emp.id = e.employee_id
               JOIN hr_person p ON p.id = emp.person_id WHERE 1=1`;
  const params = [];
  if (state) { sql += ' AND e.state = ?'; params.push(state); }
  sql += ' ORDER BY e.id DESC LIMIT ?'; params.push(Number(limit));
  return q(sql, ...params);
}

// ------------------------------------------------------------------- loans --

export function createLoan({ employeeId, principal, monthly, actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('granting a loan is a human act');
  if (!one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(employeeId))) refuse('no such active employee');
  const p = round2(Number(principal)); const m = round2(Number(monthly));
  if (!(p > 0) || !(m > 0)) refuse('a loan needs a principal and a monthly deduction');
  exec('INSERT INTO pay_loan (employee_id, principal, monthly, balance, created_by) VALUES (?,?,?,?,?)',
    Number(employeeId), p, m, p, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'loan', entityId: id, action: 'loan.created', actor, detail: { principal: p }, chain: true });
  return one('SELECT * FROM pay_loan WHERE id = ?', id);
}

// ----------------------------------------------------------------- payroll --

/** Unpaid leave days inside a period, per employee. */
function unpaidDays(employeeId, period) {
  const rows = q(
    `SELECT r.starts, r.ends FROM time_leave_request r
      JOIN time_leave_policy p ON p.id = r.policy_id
     WHERE r.employee_id = ? AND r.state = 'approved' AND p.leave_type LIKE 'unpaid%'
       AND substr(r.starts, 1, 7) <= ? AND substr(r.ends, 1, 7) >= ?`,
    Number(employeeId), period, period,
  );
  let days = 0;
  const first = new Date(`${period}-01T00:00:00Z`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  for (const r of rows) {
    const a = new Date(`${r.starts}T00:00:00Z`); const b = new Date(`${r.ends}T00:00:00Z`);
    const from = a > first ? a : first; const to = b < last ? b : last;
    if (to >= from) days += Math.round((to - from) / 86400000) + 1;
  }
  return days;
}

/**
 * Draft a run: compute every active employee's slip for a period.
 *
 * Callable by an agent through the gateway — drafting is arithmetic, and
 * arithmetic is what agents are for. The run it produces is 'draft' and stays
 * that way until a human approves it; drafting twice recomputes rather than
 * duplicating, so the agent can refresh a stale draft safely.
 */
export function draftPayroll({ period, actor }) {
  if (!actor) refuse('drafting payroll carries a name');
  if (!/^\d{4}-\d{2}$/.test(String(period))) refuse('period is YYYY-MM');
  const existing = one('SELECT * FROM pay_run WHERE period = ?', period);
  if (existing && existing.state !== 'draft') refuse(`the ${period} run is already ${existing.state}`);

  let runId = existing?.id;
  if (!runId) {
    exec('INSERT INTO pay_run (period, created_by) VALUES (?,?)', period, String(actor));
    runId = one('SELECT last_insert_rowid() AS id').id;
  } else {
    exec('DELETE FROM pay_slip WHERE run_id = ?', runId);
  }

  const employees = q(`SELECT e.*, p.subject_ref FROM hr_employee e
                        JOIN hr_person p ON p.id = e.person_id WHERE e.state = 'active'`);
  let totalGross = 0; let totalNet = 0; let skipped = 0;
  let totalTax = 0; let totalContrib = 0; let totalEmployer = 0;
  for (const e of employees) {
    const base = round2(Number(openPii(e.base_salary)) || 0);
    if (!base) { skipped++; continue; }        // no salary on file: nothing to compute
    const daily = round2(base / 30);
    const absence = round2(unpaidDays(e.id, period) * daily);
    const loans = q("SELECT * FROM pay_loan WHERE employee_id = ? AND state = 'active'", e.id);
    const loanDeduction = round2(loans.reduce((a, l) => a + Math.min(l.monthly, l.balance), 0));

    // The formula, in the directive's order. Allowances and overtime come from
    // the time and compensation modules; tax from the bracket table for the
    // employee's jurisdiction; contributions from the plans they are enrolled
    // in. Bonuses, commissions, other deductions and penalties are still named
    // zeros — the slip's shape is the formula's shape whether or not a module
    // feeds every line yet.
    const inputs = payrollInputs(e, period, base);
    const slip = {
      period, base,
      allowances: inputs.allowances, overtime: inputs.overtime, bonuses: 0, commissions: 0,
      absences: absence, deductions: 0, loans: loanDeduction, penalties: 0,
    };
    slip.gross = round2(base + slip.allowances + slip.overtime + slip.bonuses + slip.commissions);
    const adjusted = round2(slip.gross - slip.absences - slip.deductions - slip.loans - slip.penalties);
    // Tax and contributions come from the rules the company declared
    // (payrules.js) plus the plans the person is enrolled in. With no rule
    // declared the lines are zero and the slip says so — rulesConfigured is
    // the label that keeps a zero from looking computed.
    const ded = inputs.deductions(round2(slip.gross - slip.absences));
    slip.taxes = ded.taxes;
    slip.contributions = ded.contributions;
    slip.employer = ded.employer;              // the company's side, not in net
    slip.rulesConfigured = ded.configured;
    slip.net = round2(adjusted - slip.taxes - slip.contributions);

    exec('INSERT INTO pay_slip (run_id, employee_id, detail, subject_ref) VALUES (?,?,?,?)',
      runId, e.id, e.subject_ref ? sealForRef(JSON.stringify(slip), e.subject_ref) : JSON.stringify(slip), e.subject_ref);
    totalGross = round2(totalGross + slip.gross);
    totalNet = round2(totalNet + slip.net);
    totalTax = round2(totalTax + slip.taxes);
    totalContrib = round2(totalContrib + slip.contributions);
    totalEmployer = round2(totalEmployer + slip.employer);
  }
  exec('UPDATE pay_run SET total_gross = ?, total_net = ?, total_tax = ?, total_contrib = ?, total_employer = ? WHERE id = ?',
    totalGross, totalNet, totalTax, totalContrib, totalEmployer, runId);
  log({ entity: 'payroll', entityId: runId, action: 'payroll.drafted', actor, detail: { period, employees: employees.length - skipped, skipped } });
  return getRun(runId);
}

/**
 * Approve, then close. Both human acts, asserted here as well as at the
 * gateway — approvePayroll is on the categorical list, so an agent's path
 * ends in 'gated' before this function is ever reached; this check is the
 * second lock on the same door.
 */
export function approvePayrollRun(runId, { actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('approving payroll is a human act, always — whatever the amount');
  const r = one('SELECT * FROM pay_run WHERE id = ?', Number(runId));
  if (!r) refuse('no such run');
  if (r.state !== 'draft') refuse(`the run is already ${r.state}`);
  exec("UPDATE pay_run SET state = 'approved', approved_by = ? WHERE id = ?", String(actor), r.id);
  log({ entity: 'payroll', entityId: r.id, action: 'payroll.approved', actor, detail: { period: r.period, totalNet: r.total_net }, chain: true });
  return getRun(r.id);
}

/** Close: money moves, loan balances fall, and the ledger hears about it. */
export function closePayrollRun(runId, { actor }) {
  if (!String(actor || '').startsWith('human:')) refuse('closing payroll is a human act');
  const r = one('SELECT * FROM pay_run WHERE id = ?', Number(runId));
  if (!r) refuse('no such run');
  if (r.state !== 'approved') refuse('only an approved run can close');

  // Loan balances fall by what the slips deducted.
  for (const s of q('SELECT * FROM pay_slip WHERE run_id = ?', r.id)) {
    const slip = JSON.parse(openPii(s.detail) || '{}');
    let remaining = Number(slip.loans) || 0;
    if (!remaining) continue;
    for (const l of q("SELECT * FROM pay_loan WHERE employee_id = ? AND state = 'active' ORDER BY id", s.employee_id)) {
      const cut = Math.min(remaining, l.monthly, l.balance);
      if (cut <= 0) break;
      exec("UPDATE pay_loan SET balance = ROUND(balance - ?, 2), state = CASE WHEN balance - ? <= 0.005 THEN 'settled' ELSE state END WHERE id = ?", cut, cut, l.id);
      remaining = round2(remaining - cut);
    }
  }
  exec("UPDATE pay_run SET state = 'closed', closed_at = datetime('now') WHERE id = ?", r.id);
  log({ entity: 'payroll', entityId: r.id, action: 'payroll.closed', actor, detail: { period: r.period }, chain: true });
  emit('payroll.closed', {
    id: r.id, period: r.period, totalGross: r.total_gross, totalNet: r.total_net,
    totalTax: r.total_tax || 0, totalContrib: r.total_contrib || 0, totalEmployer: r.total_employer || 0,
  });
  return getRun(r.id);
}

export function getRun(id) {
  const r = one('SELECT * FROM pay_run WHERE id = ?', Number(id));
  if (!r) return null;
  return {
    ...r,
    slips: q(`SELECT s.id, s.employee_id, s.detail, p.display_name FROM pay_slip s
               JOIN hr_employee e ON e.id = s.employee_id JOIN hr_person p ON p.id = e.person_id
              WHERE s.run_id = ?`, r.id)
      .map((s) => ({ ...s, detail: JSON.parse(openPii(s.detail) || 'null') })),
  };
}

export function payopsOverview() {
  const n = (sql) => one(sql).n;
  return {
    costCenters: costCenters(),
    expensesPending: n("SELECT COUNT(*) AS n FROM fin_expense WHERE state = 'submitted'"),
    activeLoans: n("SELECT COUNT(*) AS n FROM pay_loan WHERE state = 'active'"),
    runs: q('SELECT id, period, state, total_gross, total_net, approved_by FROM pay_run ORDER BY period DESC LIMIT 12'),
    note: 'A slip is sealed under its employee\'s own key; the run\'s totals stay readable because the ledger entry '
      + 'the close posts shows the aggregate regardless. An agent may draft a run — drafting is arithmetic — and can '
      + 'never approve one: approvePayroll is categorically gated, and this module checks the actor again anyway. '
      + 'Core 2 posts nothing to the ledger; the close emits an event and Core 1\'s bookkeeper does the books.',
  };
}
