// What if — the next eighteen months, if something changes.
//
// The baseline is the record: cash in the registered bank accounts, and the
// average revenue and expenses of the last three closed months. A scenario
// moves those with the handful of levers a founder actually pulls — revenue up
// or down, costs cut, people hired at a salary, a one-off in or out, revenue
// growing month on month — and walks the cash forward a month at a time.
// Arithmetic, so the same levers always give the same months; nothing is sent
// to a model and nothing is applied to the books. Keeping a scenario writes
// it down with the baseline it was run against, because a plan compared with
// a baseline that has since moved is a different plan.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { incomeStatement } from './ledger.js';
import { cashPosition } from './core2/bank.js';
import { previousPeriod } from './boardpack.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const round = (x) => Math.round(Number(x || 0) * 100) / 100;
const back = (period, k) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7); };

/** Cash now, and the average month of the last three closed ones. */
export function baseline() {
  const period = previousPeriod();
  const months = safe(() => [0, 1, 2].map((k) => incomeStatement({ period: back(period, k) })), []);
  const cash = safe(() => cashPosition(), { total: 0, accounts: [] });
  const avg = (f) => (months.length ? months.reduce((a, m) => a + Number(m[f] || 0), 0) / months.length : 0);
  return {
    cash: round(cash.total || 0),
    accounts: (cash.accounts || []).length,
    revenue: round(avg('totalRevenue')),
    expenses: round(avg('totalExpenses')),
    months: months.map((m) => m.period),
  };
}

const LEVERS = {
  revenuePct: [-100, 300], costPct: [-90, 300], hires: [0, 500], salary: [0, 1e7],
  oneOff: [-1e10, 1e10], growthPct: [-50, 50], horizon: [3, 36],
};
function levers(p = {}) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(LEVERS)) {
    const v = p[k] == null || p[k] === '' ? (k === 'horizon' ? 18 : 0) : Number(p[k]);
    if (!Number.isFinite(v)) refuse(`${k} is a number`);
    if (v < lo || v > hi) refuse(`${k} is between ${lo} and ${hi}`);
    out[k] = k === 'hires' || k === 'horizon' ? Math.round(v) : v;
  }
  return out;
}

/** Walk the cash forward a month at a time under the levers. */
export function simulate(params = {}, base = baseline()) {
  const L = levers(params);
  const revenue0 = base.revenue * (1 + L.revenuePct / 100);
  const expenses = base.expenses * (1 + L.costPct / 100) + L.hires * L.salary;
  let cash = base.cash + L.oneOff;
  const curve = [];
  let runOut = null;
  let breakEven = null;
  for (let m = 1; m <= L.horizon; m++) {
    const revenue = revenue0 * (1 + L.growthPct / 100) ** (m - 1);
    const net = revenue - expenses;
    cash += net;
    if (breakEven == null && net >= 0) breakEven = m;
    if (runOut == null && cash < 0) runOut = m;
    curve.push({ month: m, revenue: round(revenue), expenses: round(expenses), net: round(net), cash: round(cash) });
  }
  const baseCurve = [];
  let bc = base.cash;
  for (let m = 1; m <= L.horizon; m++) { bc += base.revenue - base.expenses; baseCurve.push(round(bc)); }
  return {
    levers: L,
    baseline: base,
    curve,
    baseCurve,
    summary: {
      endCash: curve.at(-1)?.cash ?? base.cash,
      baseEndCash: baseCurve.at(-1) ?? base.cash,
      runsOutInMonth: runOut,
      breaksEvenInMonth: breakEven,
      monthlyBurn: round(expenses - revenue0),
    },
    method: 'cash + one-off, then each month: revenue (baseline × (1 + revenue %) grown by the monthly growth %) − expenses (baseline × (1 + cost %) + hires × salary)',
  };
}

export function save({ name, params, actor }) {
  if (!isHuman(actor)) refuse('a person keeps a scenario', 403);
  const title = String(name || '').trim().slice(0, 120);
  if (!title) refuse('a scenario needs a name');
  const r = simulate(params);
  const id = Number(exec('INSERT INTO whatif_scenarios (name, params, baseline, result, created_by) VALUES (?,?,?,?,?)',
    title, JSON.stringify(r.levers), JSON.stringify(r.baseline), JSON.stringify(r.summary), actor).lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'whatif.saved', subjectType: 'whatif_scenario', subjectId: id, payload: { name: title, levers: r.levers, summary: r.summary } });
  return { id, ...r };
}

export function remove({ id, actor }) {
  if (!isHuman(actor)) refuse('a person removes a scenario', 403);
  const s = one('SELECT id, name FROM whatif_scenarios WHERE id = ?', Number(id));
  if (!s) refuse('no such scenario', 404);
  exec('DELETE FROM whatif_scenarios WHERE id = ?', s.id);
  audit({ actorType: 'human', actorId: actor, action: 'whatif.removed', subjectType: 'whatif_scenario', subjectId: s.id, payload: { name: s.name } });
  return { ok: true };
}

export function overview() {
  return {
    baseline: baseline(),
    scenarios: q('SELECT id, name, params, baseline, result, created_by, created_at FROM whatif_scenarios ORDER BY id DESC LIMIT 40')
      .map((s) => ({ ...s, params: JSON.parse(s.params), baseline: JSON.parse(s.baseline), result: JSON.parse(s.result) })),
    levers: LEVERS,
  };
}
