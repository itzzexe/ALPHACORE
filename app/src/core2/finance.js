// FINANCE, THE SUB-LEDGERS — budgets, payables, receivables, fixed assets, FX.
//
// The general ledger, the trial balance, the statements and the period close
// are Core 1's (src/ledger.js) and are not repeated here. This file holds the
// books that feed it: what we owe a vendor, what a customer owes us, what a
// machine is worth this month. Each fact emits an event; the bridge posts the
// entry. If this file ever imports ledger.js it has become the second ledger
// the directive forbids.
//
// Two kinds of act live here. Drafting — a bill, an invoice, a budget — is
// arithmetic and an agent may do it through the gateway. Money leaving, a
// budget being adopted, an asset being written off: those wait for a person,
// and this module refuses a non-human actor for them as the second lock.
import { q, one, exec } from '../db.js';
import { log } from './identity.js';
import { emit } from './bridge.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const human = (actor, what) => {
  if (!String(actor || '').startsWith('human:')) refuse(`${what} is a human act — an agent may draft it, never do it`);
};
const accountExists = (code) => Boolean(one('SELECT code FROM accounts WHERE code = ? AND retired_at IS NULL', String(code)));

/** IN-2026-0001 style references, counted per prefix and year. */
export function nextRef(table, prefix, column = 'ref') {
  const year = new Date().getUTCFullYear();
  const n = one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ?`, `${prefix}-${year}-%`).n;
  return `${prefix}-${year}-${String(n + 1).padStart(4, '0')}`;
}

/** The first and last day a budget period covers. */
export function periodRange(period) {
  const p = String(period);
  if (/^\d{4}$/.test(p)) return { from: `${p}-01-01`, to: `${p}-12-31` };
  if (/^\d{4}-Q[1-4]$/.test(p)) {
    const qn = Number(p.slice(6)); const y = p.slice(0, 4);
    const m1 = (qn - 1) * 3 + 1;
    const last = new Date(Date.UTC(Number(y), m1 + 2, 0)).getUTCDate();
    return { from: `${y}-${String(m1).padStart(2, '0')}-01`, to: `${y}-${String(m1 + 2).padStart(2, '0')}-${last}` };
  }
  if (/^\d{4}-\d{2}$/.test(p)) {
    const last = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
    return { from: `${p}-01`, to: `${p}-${last}` };
  }
  refuse('a period is YYYY, YYYY-Qn or YYYY-MM');
  return null;
}

// ----------------------------------------------------------------- budgets --

export function createBudget({ name, period, lines = [], actor }) {
  if (!actor) refuse('a budget is drafted by somebody');
  periodRange(period);
  if (!Array.isArray(lines) || !lines.length) refuse('a budget has at least one line');
  for (const l of lines) {
    if (!accountExists(l.accountCode)) refuse(`no such account: ${l.accountCode}`);
    if (!(Number(l.amount) >= 0)) refuse('a budget line is a non-negative amount');
    if (l.costCenterId && !one('SELECT id FROM fin_cost_center WHERE id = ?', Number(l.costCenterId))) refuse('no such cost center');
  }
  exec('INSERT INTO fin_budget (name, period, created_by) VALUES (?,?,?)', clean(name) || `Budget ${period}`, String(period), String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  for (const l of lines) {
    exec('INSERT INTO fin_budget_line (budget_id, account_code, cost_center_id, amount) VALUES (?,?,?,?)',
      id, String(l.accountCode), l.costCenterId ? Number(l.costCenterId) : null, round2(Number(l.amount)));
  }
  log({ entity: 'budget', entityId: id, action: 'budget.drafted', actor, detail: { period, lines: lines.length } });
  return getBudget(id);
}

export function approveBudget(id, { actor }) {
  human(actor, 'adopting a budget');
  const b = one('SELECT * FROM fin_budget WHERE id = ?', Number(id));
  if (!b) refuse('no such budget');
  if (b.state !== 'draft') refuse(`this budget is already ${b.state}`);
  exec("UPDATE fin_budget SET state = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?", String(actor), b.id);
  log({ entity: 'budget', entityId: b.id, action: 'budget.approved', actor, detail: { period: b.period }, chain: true });
  emit('budget.approved', { id: b.id, period: b.period });
  return getBudget(b.id);
}

export function closeBudget(id, { actor }) {
  human(actor, 'closing a budget');
  const b = one('SELECT * FROM fin_budget WHERE id = ?', Number(id));
  if (!b) refuse('no such budget');
  exec("UPDATE fin_budget SET state = 'closed' WHERE id = ?", b.id);
  log({ entity: 'budget', entityId: b.id, action: 'budget.closed', actor });
  return getBudget(b.id);
}

export function getBudget(id) {
  const b = one('SELECT * FROM fin_budget WHERE id = ?', Number(id));
  if (!b) return null;
  return { ...b, lines: q('SELECT l.*, a.name AS account_name, c.name AS cost_center FROM fin_budget_line l LEFT JOIN accounts a ON a.code = l.account_code LEFT JOIN fin_cost_center c ON c.id = l.cost_center_id WHERE l.budget_id = ? ORDER BY l.account_code', b.id) };
}

export const listBudgets = () => q('SELECT b.*, (SELECT SUM(amount) FROM fin_budget_line l WHERE l.budget_id = b.id) AS total FROM fin_budget b ORDER BY b.id DESC');

/**
 * Budget against actual, read straight from the posted journal. Where a line
 * names a cost center, the actual is that center's recorded spend instead,
 * because the journal does not carry cost centers and pretending it does
 * would invent a number.
 */
export function budgetVariance(id) {
  const b = getBudget(id);
  if (!b) refuse('no such budget');
  const { from, to } = periodRange(b.period);
  const lines = b.lines.map((l) => {
    let actual;
    if (l.cost_center_id) {
      actual = one(`SELECT COALESCE((SELECT SUM(e.amount) FROM fin_expense e WHERE e.cost_center_id = ? AND e.state IN ('approved','paid') AND substr(e.created_at,1,10) BETWEEN ? AND ?), 0)
        + COALESCE((SELECT SUM(p.amount) FROM proc_request p WHERE p.cost_center_id = ? AND p.state NOT IN ('requested','rejected') AND substr(p.created_at,1,10) BETWEEN ? AND ?), 0) AS n`,
      l.cost_center_id, from, to, l.cost_center_id, from, to).n;
    } else {
      const r = one(`SELECT COALESCE(SUM(CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END), 0) AS n
        FROM journal_lines jl JOIN journal j ON j.id = jl.journal_id
        WHERE j.state = 'posted' AND jl.account_code = ? AND j.entry_date BETWEEN ? AND ?`, l.account_code, from, to);
      const acct = one('SELECT normal_side FROM accounts WHERE code = ?', l.account_code);
      actual = acct?.normal_side === 'credit' ? -r.n : r.n;
    }
    actual = round2(actual);
    return { ...l, actual, variance: round2(l.amount - actual), pct: l.amount ? Number(((actual / l.amount) * 100).toFixed(1)) : null };
  });
  const budgeted = round2(lines.reduce((a, l) => a + l.amount, 0));
  const actual = round2(lines.reduce((a, l) => a + l.actual, 0));
  return { id: b.id, name: b.name, period: b.period, state: b.state, from, to, lines, budgeted, actual, variance: round2(budgeted - actual) };
}

// ---------------------------------------------------------------- payables --

export function createBill({ vendorId, ref, amount, tax = 0, currency = 'USD', accountCode = '5100', issued = null, due = null, actor }) {
  if (!actor) refuse('a bill is recorded by somebody');
  const vendor = one('SELECT id, name FROM vendors WHERE id = ?', String(vendorId));
  if (!vendor) refuse('no such vendor — vendors are Core 1\'s register, one master');
  const amt = round2(Number(amount)); const tx = round2(Number(tax) || 0);
  if (!(amt > 0)) refuse('a bill has a positive amount');
  if (!accountExists(accountCode)) refuse(`no such account: ${accountCode}`);
  const day = issued || today();
  exec(`INSERT INTO fin_ap_bill (vendor_id, ref, amount, tax, currency, account_code, issued, due, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    vendor.id, clean(ref, 60) || nextRef('fin_ap_bill', 'BILL'), amt, tx, clean(currency, 3) || 'USD', String(accountCode), day, due || day, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'bill', entityId: id, action: 'bill.drafted', actor, detail: { vendorId: vendor.id, amount: amt } });
  return getBill(id);
}

export function approveBill(id, { actor }) {
  if (!actor) refuse('approving a bill carries a name');
  const b = one('SELECT * FROM fin_ap_bill WHERE id = ?', Number(id));
  if (!b) refuse('no such bill');
  if (b.state !== 'draft') refuse(`this bill is already ${b.state}`);
  exec("UPDATE fin_ap_bill SET state = 'approved', approved_by = ? WHERE id = ?", String(actor), b.id);
  log({ entity: 'bill', entityId: b.id, action: 'bill.approved', actor, detail: { amount: b.amount } });
  emit('bill.approved', { id: b.id, amount: b.amount, tax: b.tax, accountCode: b.account_code });
  return getBill(b.id);
}

/** Money leaves. Human, always; the ledger hears about it through the event. */
export function payBill(id, { actor, bankAccountId = null }) {
  human(actor, 'paying a bill');
  const b = one('SELECT * FROM fin_ap_bill WHERE id = ?', Number(id));
  if (!b) refuse('no such bill');
  if (b.state !== 'approved') refuse('only an approved bill can be paid');
  const gl = bankAccountId ? one("SELECT gl_code FROM bank_account WHERE id = ? AND state = 'active'", Number(bankAccountId))?.gl_code : null;
  if (bankAccountId && !gl) refuse('no such bank account');
  exec("UPDATE fin_ap_bill SET state = 'paid', paid_at = datetime('now') WHERE id = ?", b.id);
  log({ entity: 'bill', entityId: b.id, action: 'bill.paid', actor, detail: { amount: b.amount + b.tax }, chain: true });
  emit('bill.paid', { id: b.id, total: round2(b.amount + b.tax), glCode: gl || '1000' });
  return getBill(b.id);
}

export function voidBill(id, { actor }) {
  human(actor, 'voiding a bill');
  const b = one('SELECT * FROM fin_ap_bill WHERE id = ?', Number(id));
  if (!b) refuse('no such bill');
  if (b.state === 'paid') refuse('a paid bill is reversed in the ledger, not voided here');
  exec("UPDATE fin_ap_bill SET state = 'void' WHERE id = ?", b.id);
  log({ entity: 'bill', entityId: b.id, action: 'bill.void', actor });
  return getBill(b.id);
}

export const getBill = (id) => one('SELECT b.*, v.name AS vendor_name FROM fin_ap_bill b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.id = ?', Number(id));
export const listBills = ({ state = null, limit = 200 } = {}) => q(
  `SELECT b.*, v.name AS vendor_name FROM fin_ap_bill b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE (? IS NULL OR b.state = ?) ORDER BY b.due, b.id DESC LIMIT ?`,
  state, state, Number(limit),
);

/** What is owed, by how overdue it is. */
export function apAging() {
  const rows = q("SELECT id, vendor_id, ref, amount + tax AS total, due FROM fin_ap_bill WHERE state = 'approved'");
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  const now = new Date(`${today()}T00:00:00Z`);
  for (const r of rows) {
    const late = Math.floor((now - new Date(`${r.due}T00:00:00Z`)) / 86400000);
    if (late <= 0) buckets.current += r.total; else if (late <= 30) buckets.d30 += r.total; else if (late <= 60) buckets.d60 += r.total; else buckets.d90 += r.total;
  }
  return { count: rows.length, total: round2(rows.reduce((a, r) => a + r.total, 0)), ...Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v)])) };
}

// ------------------------------------------------------------- receivables --

export function createInvoice({ customerId = null, description, amount, tax = 0, currency = 'USD', due = null, actor }) {
  if (!actor) refuse('an invoice is drafted by somebody');
  if (customerId && !one('SELECT id FROM customers WHERE id = ?', Number(customerId))) refuse('no such customer — customers are Core 1\'s CRM, one master');
  const amt = round2(Number(amount)); const tx = round2(Number(tax) || 0);
  if (!(amt > 0)) refuse('an invoice has a positive amount');
  exec(`INSERT INTO fin_ar_invoice (ref, customer_id, description, amount, tax, currency, due, created_by) VALUES (?,?,?,?,?,?,?,?)`,
    nextRef('fin_ar_invoice', 'AR'), customerId ? Number(customerId) : null, clean(description, 240) || 'Services', amt, tx, clean(currency, 3) || 'USD', due, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'ar_invoice', entityId: id, action: 'ar.drafted', actor, detail: { amount: amt } });
  return getInvoice(id);
}

export function issueInvoice(id, { actor }) {
  if (!actor) refuse('issuing an invoice carries a name');
  const inv = one('SELECT * FROM fin_ar_invoice WHERE id = ?', Number(id));
  if (!inv) refuse('no such invoice');
  if (inv.state !== 'draft') refuse(`this invoice is already ${inv.state}`);
  const day = today();
  exec("UPDATE fin_ar_invoice SET state = 'issued', issued = ?, due = COALESCE(due, date(?, '+30 day')) WHERE id = ?", day, day, inv.id);
  log({ entity: 'ar_invoice', entityId: inv.id, action: 'ar.issued', actor, detail: { amount: inv.amount } });
  emit('ar.issued', { id: inv.id, amount: inv.amount, tax: inv.tax });
  return getInvoice(inv.id);
}

/** Money arrived. A human attests it; the ledger hears through the event. */
export function recordReceipt(id, { amount, bankAccountId = null, actor }) {
  human(actor, 'recording a receipt');
  const inv = one('SELECT * FROM fin_ar_invoice WHERE id = ?', Number(id));
  if (!inv) refuse('no such invoice');
  if (inv.state !== 'issued') refuse('only an issued invoice can be paid');
  const amt = round2(Number(amount));
  if (!(amt > 0)) refuse('a receipt is a positive amount');
  const owed = round2(inv.amount + inv.tax - inv.paid_amount);
  if (amt > owed + 0.005) refuse(`only ${owed} is outstanding on this invoice`);
  const gl = bankAccountId ? one("SELECT gl_code FROM bank_account WHERE id = ? AND state = 'active'", Number(bankAccountId))?.gl_code : null;
  if (bankAccountId && !gl) refuse('no such bank account');
  exec('INSERT INTO fin_ar_receipt (invoice_id, amount, bank_account_id, created_by) VALUES (?,?,?,?)', inv.id, amt, bankAccountId ? Number(bankAccountId) : null, String(actor));
  const rid = one('SELECT last_insert_rowid() AS id').id;
  const paid = round2(inv.paid_amount + amt);
  exec("UPDATE fin_ar_invoice SET paid_amount = ?, state = CASE WHEN ? >= amount + tax - 0.005 THEN 'paid' ELSE state END WHERE id = ?", paid, paid, inv.id);
  log({ entity: 'ar_invoice', entityId: inv.id, action: 'ar.received', actor, detail: { amount: amt, receiptId: rid }, chain: true });
  emit('ar.received', { id: rid, invoiceId: inv.id, amount: amt, glCode: gl || '1000' });
  return getInvoice(inv.id);
}

export function voidInvoice(id, { actor }) {
  human(actor, 'voiding an invoice');
  const inv = one('SELECT * FROM fin_ar_invoice WHERE id = ?', Number(id));
  if (!inv) refuse('no such invoice');
  if (inv.paid_amount > 0) refuse('an invoice with money against it is credited, not voided');
  exec("UPDATE fin_ar_invoice SET state = 'void' WHERE id = ?", inv.id);
  log({ entity: 'ar_invoice', entityId: inv.id, action: 'ar.void', actor });
  return getInvoice(inv.id);
}

export const getInvoice = (id) => {
  const inv = one('SELECT i.*, c.name AS customer_name FROM fin_ar_invoice i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?', Number(id));
  return inv ? { ...inv, receipts: q('SELECT * FROM fin_ar_receipt WHERE invoice_id = ? ORDER BY id', inv.id) } : null;
};
export const listInvoices = ({ state = null, limit = 200 } = {}) => q(
  `SELECT i.*, c.name AS customer_name FROM fin_ar_invoice i LEFT JOIN customers c ON c.id = i.customer_id WHERE (? IS NULL OR i.state = ?) ORDER BY i.id DESC LIMIT ?`,
  state, state, Number(limit),
);

export function arAging() {
  const rows = q("SELECT id, ref, amount + tax - paid_amount AS owed, due FROM fin_ar_invoice WHERE state = 'issued'");
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  const now = new Date(`${today()}T00:00:00Z`);
  for (const r of rows) {
    const late = r.due ? Math.floor((now - new Date(`${r.due}T00:00:00Z`)) / 86400000) : 0;
    if (late <= 0) buckets.current += r.owed; else if (late <= 30) buckets.d30 += r.owed; else if (late <= 60) buckets.d60 += r.owed; else buckets.d90 += r.owed;
  }
  return { count: rows.length, total: round2(rows.reduce((a, r) => a + r.owed, 0)), ...Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v)])) };
}

// ------------------------------------------------------------ fixed assets --

export function registerFixedAsset({ name, category = 'equipment', cost, salvage = 0, lifeMonths, acquired = null, costCenterId = null, core1AssetId = null, actor }) {
  if (!actor) refuse('registering an asset carries a name');
  const c = round2(Number(cost)); const s = round2(Number(salvage) || 0); const life = Math.round(Number(lifeMonths));
  if (!(c > 0)) refuse('an asset has a positive cost');
  if (!(life >= 1 && life <= 600)) refuse('useful life is between one month and fifty years');
  if (s < 0 || s >= c) refuse('salvage value is below cost');
  if (costCenterId && !one('SELECT id FROM fin_cost_center WHERE id = ?', Number(costCenterId))) refuse('no such cost center');
  if (core1AssetId && !one('SELECT id FROM assets WHERE id = ?', Number(core1AssetId))) refuse('no such device on Core 1\'s register');
  const day = acquired || today();
  if (!isDay(day)) refuse('acquired is a date');
  exec(`INSERT INTO fin_fixed_asset (name, category, cost, salvage, life_months, acquired, cost_center_id, core1_asset_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    clean(name), clean(category, 40), c, s, life, day, costCenterId ? Number(costCenterId) : null, core1AssetId ? Number(core1AssetId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'fixed_asset', entityId: id, action: 'asset.acquired', actor, detail: { cost: c }, chain: true });
  emit('asset.acquired', { id, cost: c });
  return getFixedAsset(id);
}

/** Straight-line, one row per asset per month, never twice. */
export function runDepreciation({ period = today().slice(0, 7), actor }) {
  if (!actor) refuse('a depreciation run carries a name');
  if (!/^\d{4}-\d{2}$/.test(period)) refuse('period is YYYY-MM');
  const assets = q("SELECT * FROM fin_fixed_asset WHERE state = 'active' AND substr(acquired, 1, 7) <= ?", period);
  let total = 0; let posted = 0; let firstId = null;
  for (const a of assets) {
    if (one('SELECT id FROM fin_depreciation WHERE asset_id = ? AND period = ?', a.id, period)) continue;
    const monthly = round2((a.cost - a.salvage) / a.life_months);
    const remaining = round2(a.cost - a.salvage - a.accumulated);
    const amount = round2(Math.min(monthly, Math.max(0, remaining)));
    if (amount <= 0) continue;
    exec('INSERT INTO fin_depreciation (asset_id, period, amount) VALUES (?,?,?)', a.id, period, amount);
    if (firstId == null) firstId = one('SELECT last_insert_rowid() AS id').id;
    exec('UPDATE fin_fixed_asset SET accumulated = accumulated + ? WHERE id = ?', amount, a.id);
    total = round2(total + amount); posted++;
  }
  log({ entity: 'depreciation', action: 'depreciation.run', actor, detail: { period, assets: posted, total } });
  if (total > 0) emit('depreciation.posted', { id: firstId, period, total });
  return { period, assets: posted, total };
}

/** Writing off. Human; the loss is what is left after what was already expensed. */
export function disposeAsset(id, { actor }) {
  human(actor, 'disposing of an asset');
  const a = one('SELECT * FROM fin_fixed_asset WHERE id = ?', Number(id));
  if (!a) refuse('no such asset');
  if (a.state === 'disposed') refuse('already disposed');
  exec("UPDATE fin_fixed_asset SET state = 'disposed', disposed_at = datetime('now'), disposed_by = ? WHERE id = ?", String(actor), a.id);
  log({ entity: 'fixed_asset', entityId: a.id, action: 'asset.disposed', actor, detail: { cost: a.cost, accumulated: a.accumulated }, chain: true });
  emit('asset.disposed', { id: a.id, cost: a.cost, accumulated: a.accumulated });
  return getFixedAsset(a.id);
}

export const getFixedAsset = (id) => {
  const a = one('SELECT * FROM fin_fixed_asset WHERE id = ?', Number(id));
  return a ? { ...a, bookValue: round2(a.cost - a.accumulated), schedule: q('SELECT * FROM fin_depreciation WHERE asset_id = ? ORDER BY period', a.id) } : null;
};
export const listFixedAssets = () => q('SELECT *, cost - accumulated AS book_value FROM fin_fixed_asset ORDER BY state, id DESC');

// ---------------------------------------------------------------------- FX --

export function setFxRate({ currency, rateToUsd, day = null, actor }) {
  if (!actor) refuse('a rate is recorded by somebody');
  const c = clean(currency, 3).toUpperCase(); const r = Number(rateToUsd);
  if (!/^[A-Z]{3}$/.test(c)) refuse('currency is a three-letter code');
  if (!(r > 0)) refuse('a rate is positive');
  exec('INSERT INTO fin_fx_rate (currency, rate_to_usd, day) VALUES (?,?,?) ON CONFLICT(currency, day) DO UPDATE SET rate_to_usd = excluded.rate_to_usd', c, r, day || today());
  log({ entity: 'fx', action: 'fx.rate_set', actor, detail: { currency: c, day: day || today() } });
  return one('SELECT * FROM fin_fx_rate WHERE currency = ? AND day = ?', c, day || today());
}

export function convertToUsd(amount, currency = 'USD', day = today()) {
  const c = String(currency || 'USD').toUpperCase();
  if (c === 'USD') return round2(Number(amount) || 0);
  const rate = one('SELECT rate_to_usd FROM fin_fx_rate WHERE currency = ? AND day <= ? ORDER BY day DESC LIMIT 1', c, day);
  if (!rate) refuse(`no ${c} rate on or before ${day}`);
  return round2((Number(amount) || 0) * rate.rate_to_usd);
}

export const latestRates = () => q('SELECT currency, rate_to_usd, day FROM fin_fx_rate r WHERE day = (SELECT MAX(day) FROM fin_fx_rate x WHERE x.currency = r.currency) ORDER BY currency');

// ----------------------------------------------------------------- overview --

export function financeOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    budgets: listBudgets(),
    ap: apAging(),
    ar: arAging(),
    billsDraft: n("SELECT COUNT(*) AS n FROM fin_ap_bill WHERE state = 'draft'"),
    invoicesIssued: n("SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE state = 'issued'"),
    fixedAssets: n("SELECT COUNT(*) AS n FROM fin_fixed_asset WHERE state = 'active'"),
    bookValue: round2(one("SELECT COALESCE(SUM(cost - accumulated), 0) AS n FROM fin_fixed_asset WHERE state = 'active'").n),
    rates: latestRates(),
    note: 'The statements are the ledger\'s and live on the Ledger page. These are the books that feed it: a bill, an invoice, '
      + 'a month of depreciation each become one balanced entry through the bridge, with a source id so a retried event cannot post twice.',
  };
}
