// The rest of the enterprise galaxy, on screen: time rules, compensation, the
// finance sub-ledgers, the bank, operations, administration — and the one
// page that is about you.
//
// Same discipline as core2.js: a page draws what the permission-checked
// route handed it, every button that moves money or decides about a person
// is shown only to somebody who holds the permission, and the sealing is at
// the database rather than here. Forms are small on purpose — the record is
// the point, and a form is only the way a fact gets in.
import { $, esc, view, money, toast } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { tile } from '../components/tile.js';
import { t } from '/i18n.js';

// ------------------------------------------------------------------ helpers --

const CHIP = {
  pending: 'chip-warn', open: 'chip-warn', draft: 'chip-warn', drafted: 'chip-warn', received: 'chip-warn', proposed: 'chip-warn',
  submitted: 'chip-warn', unmatched: 'chip-warn', overdue: 'chip-bad', breached: 'chip-bad', bounced: 'chip-bad', lost: 'chip-bad',
  rejected: 'chip-bad', dismissed: 'chip-dim', void: 'chip-dim', cancelled: 'chip-dim', closed: 'chip-dim', expired: 'chip-bad',
  approved: 'chip-ok', active: 'chip-ok', issued: 'chip-ok', adopted: 'chip-ok', done: 'chip-ok', cleared: 'chip-ok', matched: 'chip-ok',
  paid: 'chip-dim', released: 'chip-dim', executed: 'chip-dim', resolved: 'chip-dim', disposed: 'chip-dim', renewed: 'chip-dim', settled: 'chip-ok', won: 'chip-ok',
  in_progress: 'chip-ok', investigating: 'chip-warn', hearing: 'chip-warn', under_review: 'chip-warn', booked: 'chip-ok', presented: 'chip-warn', in_service: 'chip-warn',
};
const chip = (s) => `<span class="chip ${CHIP[s] || 'chip-dim'}">${esc(t(String(s || '—').replace(/_/g, ' ')))}</span>`;
const denied = (what) => { view.innerHTML = `<div class="empty">${esc(t(`You do not have permission to see ${what}.`))}</div>`; };
const day = (s) => (s ? String(s).slice(0, 10) : '—');
const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fl = (id, label, input) => `<div><label class="fl" for="${id}">${esc(t(label))}</label>${input}</div>`;
const inp = (id, ph = '', type = 'text', extra = '') => `<input type="${type}" id="${id}" placeholder="${esc(t(ph))}" ${extra}>`;
const sel = (id, options, extra = '') => `<select id="${id}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}">${esc(t(l))}</option>`).join('')}</select>`;
const btn = (id, label, cls = 'btn-primary') => `<button class="btn btn-sm ${cls}" id="${id}" type="button">${esc(t(label))}</button>`;
const table = (heads, rows, empty = 'Nothing yet.') => `
  <div class="table-wrap"><table class="tbl"><thead><tr>${heads.map((h) => `<th${/^\$/.test(h) ? ' class="num"' : ''}>${esc(t(h.replace(/^\$/, '')))}</th>`).join('')}</tr></thead>
  <tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="empty">${esc(t(empty))}</td></tr>`}</tbody></table></div>`;
const val = (id) => ($(`#${id}`)?.value ?? '').trim();
const numv = (id) => { const v = val(id); return v === '' ? undefined : Number(v); };
const panel = (title, body, extra = '') => `<div class="panel" style="margin-top:16px"><div class="panel-title">${esc(t(title))}${extra}</div>${body}</div>`;

/** POST, then redraw. Errors are the server's sentence, shown as a toast. */
async function act(path, body, rerender) {
  try { await api(path, { method: 'POST', body: body || {} }); toast(t('Done.')); await rerender(); }
  catch (err) { toast(err.message, true); }
}
/** Wire every [data-act] button: data-act="path" data-body='{"json":1}'. */
function wireActs(rerender) {
  view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.confirm && !window.confirm(t(b.dataset.confirm))) return;
    act(b.dataset.act, b.dataset.body ? JSON.parse(b.dataset.body) : {}, rerender);
  }));
}
const actBtn = (path, body, label, cls = '', confirm = null) => `<button class="btn btn-sm ${cls}" type="button" data-act="${esc(path)}" data-body='${esc(JSON.stringify(body || {}))}'${confirm ? ` data-confirm="${esc(confirm)}"` : ''}>${esc(t(label))}</button>`;
const on = (id, fn) => $(`#${id}`)?.addEventListener('click', fn);

async function employees() {
  const d = await api('/api/core2/employees').catch(() => ({ employees: [] }));
  return (d.employees || []).map((e) => [String(e.id), `${e.display_name || e.employee_no} (${e.employee_no})`]);
}
const empSel = (id, emps) => sel(id, emps.length ? emps : [['', 'no active employees']]);

// --------------------------------------------------------------- time rules --

export async function renderHrOps() {
  const d = await api('/api/core2/hrops').catch(() => null);
  if (!d) return denied('time rules');
  const canM = hasPermC('people.manage');
  const emps = canM ? await employees() : [];

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Corrections waiting'), d.correctionsPending, esc(t('in/out claims awaiting a decision')), d.correctionsPending ? 'tile-warn' : '')}
    ${tile(t('Holidays this year'), d.holidays.length, esc(t('days nobody is expected in')))}
    ${tile(t('Overtime rate'), `${d.overtimeRate}×`, esc(t('setting OVERTIME_RATE — claims live on the Shifts page')))}
    ${tile(t('Shifts & overtime'), esc(t('next door')), `<a href="#/shifts">${esc(t('rosters, lateness and overtime claims'))} →</a>`)}
  </div>
  ${panel('Measured, never explained', `<div class="map-legend">${esc(t(d.note))}</div>`)}
  ${panel(`Lateness and absence — ${d.exceptions.period}`, table(['Employee', '$Absent days', '$Late days', '$Late minutes'],
    d.exceptions.rows.map((r) => `<tr><td><b>${esc(r.display_name)}</b></td><td class="num">${r.absent}</td><td class="num">${r.lateDays}</td><td class="num">${r.lateMinutes}</td></tr>`), 'No active employees.'))}
  ${panel('Attendance corrections', table(['Employee', 'Day', 'In', 'Out', 'State', ''], d.corrections.map((c) => `<tr>
      <td><b>${esc(c.display_name)}</b></td><td class="mono">${esc(c.day)}</td><td class="mono">${esc(c.in_at || '—')}</td><td class="mono">${esc(c.out_at || '—')}</td><td>${chip(c.state)}</td>
      <td>${c.state === 'pending' && canM ? actBtn(`/api/core2/hrops/correction/${c.id}/decide`, { approve: true }, 'Approve') + ' ' + actBtn(`/api/core2/hrops/correction/${c.id}/decide`, { approve: false }, 'Reject') : ''}</td></tr>`)))}
  ${panel('Holidays', table(['Day', 'Name'], d.holidays.map((h) => `<tr><td class="mono">${esc(h.day)}</td><td>${esc(h.name)}</td></tr>`)))}
  ${canM ? `
  <div class="grid grid-2" style="margin-top:16px">
    ${panel('Claim a correction', `<div class="form-inline">
      ${fl('cr-emp', 'Employee', empSel('cr-emp', emps))}${fl('cr-day', 'Day', inp('cr-day', '', 'date'))}${fl('cr-in', 'In (HH:MM)', inp('cr-in', '09:00'))}${fl('cr-out', 'Out (HH:MM)', inp('cr-out', '17:00'))}
      ${btn('cr-go', 'Claim')}</div>`)}
    ${panel('Add a holiday', `<div class="form-inline">${fl('ho-day', 'Day', inp('ho-day', '', 'date'))}${fl('ho-name', 'Name', inp('ho-name', 'Eid'))}${btn('ho-go', 'Add', '')}</div>`)}
  </div>` : ''}`;

  wireActs(renderHrOps);
  on('cr-go', () => act('/api/core2/hrops/correction', { employeeId: val('cr-emp'), day: val('cr-day'), inAt: val('cr-day') ? `${val('cr-day')} ${val('cr-in')}:00` : null, outAt: val('cr-day') ? `${val('cr-day')} ${val('cr-out')}:00` : null }, renderHrOps));
  on('ho-go', () => act('/api/core2/hrops/holiday', { day: val('ho-day'), name: val('ho-name') }, renderHrOps));
}

// ------------------------------------------------------------- compensation --

export async function renderComp() {
  const [d, c] = await Promise.all([api('/api/core2/hrops').catch(() => null), api('/api/core2/comp').catch(() => null)]);
  if (!d || !c) return denied('compensation');
  const canM = hasPermC('people.manage'); const canPay = hasPermC('finance.export');
  const emps = canM ? await employees() : [];
  const plans = c.plans.map((p) => [String(p.id), p.name]);

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Salary changes'), d.salaryChanges, esc(t('each sealed under the person — the fact is on the chain')))}
    ${tile(t('Benefit plans'), c.plans.length, esc(t('with employer and employee shares')))}
    ${tile(t('Grievances open'), d.grievancesOpen, esc(t('sealed documents awaiting a decision')), d.grievancesOpen ? 'tile-warn' : '')}
    ${tile(t('End of service computed'), d.eosComputed, `<a href="#/payrules">${esc(t('the rule it is computed from'))} →</a>`)}
  </div>
  ${panel('What is sealed here', `<div class="map-legend">${esc(t('A salary, its history and an end-of-service amount are one person\'s money and are sealed under that person\'s own key. The screen shows that a change happened, when, and who made it. Changing a salary is categorically a human act at the gateway; the module refuses any other actor as the second lock. Tax and contribution rules are declared on Pay rules; who holds which of the company\'s things is on Custody.'))} <a href="#/payrules">${esc(t('Pay rules'))} →</a> · <a href="#/custody">${esc(t('Custody'))} →</a> · <a href="#/shifts">${esc(t('Shifts & overtime'))} →</a></div>`)}
  ${panel('Benefit plans', table(['Plan', 'Kind', '$Employer', '$Employee', '$Enrolled'], c.plans.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="sub">${esc(p.provider || '')}</div></td><td>${chip(p.kind)}</td><td class="num">${money(p.employer_share)}</td><td class="num">${money(p.employee_share)}</td><td class="num">${p.enrolled}</td></tr>`)))}
  ${panel('Movements', table(['Employee', 'Kind', 'Effective', 'By'], d.movements.map((m) => `<tr><td><b>${esc(m.display_name)}</b></td><td>${chip(m.kind)}</td><td class="mono">${esc(m.effective)}</td><td class="sub">${esc(m.created_by)}</td></tr>`)))}
  ${panel('Grievances', table(['#', 'State', 'Opened', 'Decided by', ''], c.grievances.map((g) => `<tr><td class="mono">${g.id}</td><td>${chip(g.state)}</td><td class="mono">${day(g.opened_at)}</td><td class="sub">${esc(g.decided_by || '—')}</td>
    <td>${canM && !['resolved', 'dismissed'].includes(g.state) ? actBtn(`/api/core2/comp/grievance/${g.id}/decide`, { state: 'under_review' }, 'Review', '') + ' ' + actBtn(`/api/core2/comp/grievance/${g.id}/decide`, { state: 'resolved' }, 'Resolve') + ' ' + actBtn(`/api/core2/comp/grievance/${g.id}/decide`, { state: 'dismissed' }, 'Dismiss', '') : ''}</td></tr>`),
  'No grievances — the words, when there are any, live in a sealed document.'))}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Grant an allowance', `<div class="form-inline">${fl('al-emp', 'Employee', empSel('al-emp', emps))}${fl('al-kind', 'Kind', sel('al-kind', [['housing', 'housing'], ['transport', 'transport'], ['phone', 'phone'], ['meal', 'meal'], ['hardship', 'hardship'], ['other', 'other']]))}${fl('al-amt', 'Monthly amount', inp('al-amt', '100', 'number'))}${btn('al-go', 'Grant')}</div>`)}
    ${panel('Benefits', `<div class="form-inline">${fl('pl-name', 'Plan name', inp('pl-name', 'Health cover'))}${fl('pl-kind', 'Kind', sel('pl-kind', [['health', 'health'], ['life', 'life'], ['pension', 'pension'], ['social', 'social'], ['other', 'other']]))}${fl('pl-er', 'Employer share', inp('pl-er', '50', 'number'))}${fl('pl-ee', 'Employee share', inp('pl-ee', '10', 'number'))}${btn('pl-go', 'Create plan', '')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('en-emp', 'Enroll', empSel('en-emp', emps))}${fl('en-plan', 'in plan', sel('en-plan', plans.length ? plans : [['', 'no plans']]))}${btn('en-go', 'Enroll')}</div>`)}
    ${panel('Move somebody', `<div class="form-inline">${fl('mv-emp', 'Employee', empSel('mv-emp', emps))}${fl('mv-kind', 'Kind', sel('mv-kind', [['promotion', 'promotion'], ['transfer', 'transfer'], ['regrade', 'regrade'], ['acting', 'acting'], ['demotion', 'demotion']]))}${fl('mv-unit', 'To unit id', inp('mv-unit', '', 'number'))}${fl('mv-pos', 'To position id', inp('mv-pos', '', 'number'))}${fl('mv-grade', 'To grade id', inp('mv-grade', '', 'number'))}${btn('mv-go', 'Record')}</div>`)}
    ${panel('Raise a grievance', `<div class="form-inline">${fl('gr-emp', 'Employee', empSel('gr-emp', emps))}${fl('gr-title', 'Title', inp('gr-title', 'Grievance'))}</div><textarea id="gr-body" aria-label="${esc(t('Grievance'))}" rows="3" style="width:100%;margin-top:6px" placeholder="${esc(t('Sealed under the person from the first byte.'))}"></textarea><div style="margin-top:6px">${btn('gr-go', 'Raise', '')}</div>`)}
    ${panel('Employment certificate', `<div class="form-inline">${fl('lt-emp', 'Employee', empSel('lt-emp', emps))}${btn('lt-go', 'Issue letter', '')}</div><div class="sub">${esc(t('Org facts only — never the salary.'))}</div>`)}
  </div>` : ''}
  ${canPay ? panel('Money about one person — finance.export', `<div class="grid grid-2">
    <div><div class="form-inline">${fl('sc-emp', 'Employee', empSel('sc-emp', emps.length ? emps : [['', '—']]))}${fl('sc-amt', 'New monthly salary', inp('sc-amt', '', 'number'))}${fl('sc-eff', 'Effective', inp('sc-eff', '', 'date'))}${btn('sc-go', 'Change salary')}</div><div class="sub">${esc(t('Categorically human. Both figures sealed; the fact chained.'))}</div></div>
    <div><div class="form-inline">${fl('eos-emp', 'Employee id', inp('eos-emp', '', 'number'))}${btn('eos-calc', 'Compute end of service', '')} ${btn('eos-pay', 'Pay end of service')}</div><div id="eos-out" class="sub">${esc(t('Days of pay come from the rule declared on Pay rules; a day is the sealed salary over thirty.'))}</div></div>
  </div>`) : ''}`;

  wireActs(renderComp);
  on('al-go', () => act('/api/core2/comp/allowance', { employeeId: val('al-emp'), kind: val('al-kind'), amount: numv('al-amt') }, renderComp));
  on('pl-go', () => act('/api/core2/comp/plan', { name: val('pl-name'), kind: val('pl-kind'), employerShare: numv('pl-er'), employeeShare: numv('pl-ee') }, renderComp));
  on('en-go', () => act('/api/core2/comp/enroll', { employeeId: val('en-emp'), planId: val('en-plan') }, renderComp));
  on('mv-go', () => act('/api/core2/comp/movement', { employeeId: val('mv-emp'), kind: val('mv-kind'), toUnit: numv('mv-unit') || null, toPosition: numv('mv-pos') || null, toGrade: numv('mv-grade') || null }, renderComp));
  on('gr-go', () => act('/api/core2/comp/grievance', { employeeId: val('gr-emp'), title: val('gr-title'), body: $('#gr-body').value }, renderComp));
  on('lt-go', () => act(`/api/core2/employees/${val('lt-emp')}/letter`, {}, renderComp));
  on('sc-go', () => { if (window.confirm(t('Change this salary? The act is chained with your name.'))) act('/api/core2/comp/salary', { employeeId: val('sc-emp'), newSalary: numv('sc-amt'), effective: val('sc-eff') || undefined }, renderComp); });
  on('eos-calc', async () => { try { const r = await api(`/api/core2/comp/eos/${val('eos-emp')}`, { method: 'POST', body: {} }); $('#eos-out').textContent = r.configured ? `${r.years} ${t('years')} → ${r.days} ${t('days')} → ${money(r.amount)}` : r.says; } catch (e) { toast(e.message, true); } });
  on('eos-pay', () => { if (window.confirm(t('Pay end of service? This posts to the ledger and is chained.'))) act(`/api/core2/comp/eos/${val('eos-emp')}/pay`, {}, renderComp); });
}

// -------------------------------------------------------------- finance ops --

async function financeData(what) {
  const d = await api('/api/core2/finance').catch(() => null);
  if (!d) { denied(what); return null; }
  return d;
}

export async function renderBudgets2() {
  const d = await financeData('budgets'); if (!d) return;
  const canM = hasPermC('finance.export');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Budgets'), d.budgets.length, esc(t('drafted, adopted, closed')))}
    ${tile(t('Adopted'), d.budgets.filter((b) => b.state === 'approved').length, esc(t('by a person, on the record')))}
    ${tile(t('Budgeted this set'), money(d.budgets.reduce((a, b) => a + (b.total || 0), 0)), esc(t('across every draft and adopted budget')))}
    ${tile(t('Actuals from'), esc(t('the journal')), esc(t('read from posted entries, never re-typed')))}
  </div>
  ${panel('Budgets', table(['Name', 'Period', '$Total', 'State', 'Adopted by', ''], d.budgets.map((b) => `<tr><td><b>${esc(b.name)}</b></td><td class="mono">${esc(b.period)}</td><td class="num">${money(b.total)}</td><td>${chip(b.state)}</td><td class="sub">${esc(b.approved_by || '—')}</td>
    <td><button class="btn btn-sm" type="button" data-var="${b.id}">${esc(t('Variance'))}</button> ${b.state === 'draft' && canM ? actBtn(`/api/core2/budgets/${b.id}/approve`, {}, 'Adopt', 'btn-primary', 'Adopt this budget? It is chained with your name.') : ''} ${b.state === 'approved' && canM ? actBtn(`/api/core2/budgets/${b.id}/close`, {}, 'Close', '') : ''}</td></tr>`)))}
  <div id="var-out"></div>
  ${canM ? panel('Draft a budget', `<div class="form-inline">${fl('bg-name', 'Name', inp('bg-name', 'Operating budget'))}${fl('bg-period', 'Period (YYYY, YYYY-Qn or YYYY-MM)', inp('bg-period', '2026'))}</div>
    <textarea id="bg-lines" aria-label="${esc(t('Lines'))}" rows="4" style="width:100%;margin-top:6px;font-family:var(--font-mono)" placeholder="5100, 12000\n5300, 4000, 2   ← account, amount, optional cost center id"></textarea>
    <div style="margin-top:6px">${btn('bg-go', 'Draft')}</div>`) : ''}`;
  wireActs(renderBudgets2);
  view.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const v = await api(`/api/core2/budgets/${b.dataset.var}`);
      $('#var-out').innerHTML = panel(`${v.name} — ${v.period}`, table(['Account', 'Cost center', '$Budget', '$Actual', '$Variance', '$%'], v.lines.map((l) => `<tr><td class="mono">${esc(l.account_code)} <span class="sub">${esc(l.account_name || '')}</span></td><td class="sub">${esc(l.cost_center || '—')}</td><td class="num">${money(l.amount)}</td><td class="num">${money(l.actual)}</td><td class="num" style="color:${l.variance < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(l.variance)}</td><td class="num">${l.pct == null ? '—' : l.pct + '%'}</td></tr>`)) + `<div class="sub" style="margin-top:6px">${esc(t('Budgeted'))} ${money(v.budgeted)} · ${esc(t('actual'))} ${money(v.actual)} · ${esc(t('variance'))} ${money(v.variance)}</div>`);
    } catch (e) { toast(e.message, true); }
  }));
  on('bg-go', () => act('/api/core2/budgets', { name: val('bg-name'), period: val('bg-period'), lines: $('#bg-lines').value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p[0]).map(([accountCode, amount, costCenterId]) => ({ accountCode, amount: Number(amount), costCenterId: costCenterId ? Number(costCenterId) : null })) }, renderBudgets2));
}

export async function renderPayables() {
  const d = await financeData('payables'); if (!d) return;
  const canM = hasPermC('finance.export');
  const banks = await api('/api/core2/bank').then((b) => b.accounts.filter((a) => a.state === 'active')).catch(() => []);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Owed to vendors'), money(d.ap.total), `${d.ap.count} ${esc(t('approved bills'))}`)}
    ${tile(t('Overdue'), money(d.ap.d30 + d.ap.d60 + d.ap.d90), esc(t('past due — 30/60/90')), d.ap.d30 + d.ap.d60 + d.ap.d90 > 0 ? 'tile-warn' : '')}
    ${tile(t('Drafts'), d.billsDraft, esc(t('recorded, not yet approved')))}
    ${tile(t('Over 90 days'), money(d.ap.d90), esc(t('the ones that need a call')), d.ap.d90 > 0 ? 'tile-bad' : '')}
  </div>
  ${panel('Bills', table(['Vendor', 'Ref', '$Amount', '$Tax', 'Due', 'State', ''], d.bills.map((b) => `<tr><td><b>${esc(b.vendor_name || b.vendor_id)}</b></td><td class="mono">${esc(b.ref)}</td><td class="num">${money(b.amount)}</td><td class="num">${money(b.tax)}</td><td class="mono">${esc(b.due)}</td><td>${chip(b.state)}</td>
    <td>${canM && b.state === 'draft' ? actBtn(`/api/core2/bills/${b.id}/approve`, {}, 'Approve') + ' ' + actBtn(`/api/core2/bills/${b.id}/void`, {}, 'Void', '') : ''}
        ${canM && b.state === 'approved' ? `<select aria-label="${esc(t('Pay from'))}" data-payfrom="${b.id}">${banks.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('') || '<option value="">1000</option>'}</select> <button class="btn btn-sm btn-primary" type="button" data-paybill="${b.id}">${esc(t('Pay'))}</button>` : ''}</td></tr>`)))}
  ${canM ? panel('Record a bill', `<div class="form-inline">${fl('bl-vendor', 'Vendor id (slug)', inp('bl-vendor', 'anthropic'))}${fl('bl-ref', 'Their reference', inp('bl-ref', 'INV-1001'))}${fl('bl-amt', 'Amount', inp('bl-amt', '', 'number'))}${fl('bl-tax', 'Tax', inp('bl-tax', '0', 'number'))}${fl('bl-acct', 'Expense account', inp('bl-acct', '5100'))}${fl('bl-due', 'Due', inp('bl-due', '', 'date'))}${btn('bl-go', 'Record')}</div><div class="sub">${esc(t('Vendors are Core 1\'s register — one master.'))} <a href="#/vendors">${esc(t('Vendors'))} →</a></div>`) : ''}`;
  wireActs(renderPayables);
  view.querySelectorAll('[data-paybill]').forEach((b) => b.addEventListener('click', () => {
    if (!window.confirm(t('Pay this bill? Money leaves; the act is chained.'))) return;
    const from = view.querySelector(`[data-payfrom="${b.dataset.paybill}"]`)?.value;
    act(`/api/core2/bills/${b.dataset.paybill}/pay`, { bankAccountId: from ? Number(from) : null }, renderPayables);
  }));
  on('bl-go', () => act('/api/core2/bills', { vendorId: val('bl-vendor'), ref: val('bl-ref'), amount: numv('bl-amt'), tax: numv('bl-tax') || 0, accountCode: val('bl-acct') || '5100', due: val('bl-due') || undefined }, renderPayables));
}

export async function renderReceivables() {
  const d = await financeData('receivables'); if (!d) return;
  const canM = hasPermC('finance.export');
  const banks = await api('/api/core2/bank').then((b) => b.accounts.filter((a) => a.state === 'active')).catch(() => []);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Owed to us'), money(d.ar.total), `${d.ar.count} ${esc(t('issued invoices'))}`)}
    ${tile(t('Overdue'), money(d.ar.d30 + d.ar.d60 + d.ar.d90), esc(t('past due — 30/60/90')), d.ar.d30 + d.ar.d60 + d.ar.d90 > 0 ? 'tile-warn' : '')}
    ${tile(t('Issued'), d.invoicesIssued, esc(t('waiting for money')))}
    ${tile(t('Fiat, not crypto'), esc(t('this desk')), `<a href="#/treasury">${esc(t('crypto invoices settle themselves'))} →</a>`)}
  </div>
  ${panel('Invoices', table(['Ref', 'Customer', 'Description', '$Total', '$Paid', 'Due', 'State', ''], d.invoices.map((i) => `<tr><td class="mono">${esc(i.ref)}</td><td><b>${esc(i.customer_name || '—')}</b></td><td class="sub">${esc(i.description)}</td><td class="num">${money(i.amount + i.tax)}</td><td class="num">${money(i.paid_amount)}</td><td class="mono">${esc(i.due || '—')}</td><td>${chip(i.state)}</td>
    <td>${canM && i.state === 'draft' ? actBtn(`/api/core2/ar/${i.id}/issue`, {}, 'Issue') + ' ' + actBtn(`/api/core2/ar/${i.id}/void`, {}, 'Void', '') : ''}
        ${canM && i.state === 'issued' ? `<input type="number" aria-label="${esc(t('Amount received'))}" data-rcpt-amt="${i.id}" value="${(i.amount + i.tax - i.paid_amount).toFixed(2)}" style="width:110px"> <select aria-label="${esc(t('Into'))}" data-rcpt-into="${i.id}">${banks.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('') || '<option value="">1000</option>'}</select> <button class="btn btn-sm btn-primary" type="button" data-rcpt="${i.id}">${esc(t('Receipt'))}</button>` : ''}</td></tr>`)))}
  ${canM ? panel('Draft an invoice', `<div class="form-inline">${fl('iv-cust', 'Customer id', inp('iv-cust', '', 'number'))}${fl('iv-desc', 'Description', inp('iv-desc', 'Services, August'))}${fl('iv-amt', 'Amount', inp('iv-amt', '', 'number'))}${fl('iv-tax', 'Tax', inp('iv-tax', '0', 'number'))}${fl('iv-due', 'Due', inp('iv-due', '', 'date'))}${btn('iv-go', 'Draft')}</div><div class="sub">${esc(t('Customers are Core 1\'s CRM — one master.'))} <a href="#/customers">${esc(t('Customers'))} →</a></div>`) : ''}`;
  wireActs(renderReceivables);
  view.querySelectorAll('[data-rcpt]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.rcpt;
    const into = view.querySelector(`[data-rcpt-into="${id}"]`)?.value;
    act(`/api/core2/ar/${id}/receipt`, { amount: Number(view.querySelector(`[data-rcpt-amt="${id}"]`).value), bankAccountId: into ? Number(into) : null }, renderReceivables);
  }));
  on('iv-go', () => act('/api/core2/ar', { customerId: numv('iv-cust') || null, description: val('iv-desc'), amount: numv('iv-amt'), tax: numv('iv-tax') || 0, due: val('iv-due') || undefined }, renderReceivables));
}

export async function renderFixedAssets() {
  const d = await financeData('fixed assets'); if (!d) return;
  const canM = hasPermC('finance.export');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('On the register'), d.fixedAssets, esc(t('active, depreciating')))}
    ${tile(t('Book value'), money(d.bookValue), esc(t('cost less accumulated depreciation')))}
    ${tile(t('Method'), esc(t('straight line')), esc(t('one row per asset per month, never twice')))}
    ${tile(t('FX rates'), d.rates.length, d.rates.map((r) => `${r.currency} ${r.rate_to_usd}`).join(' · ') || esc(t('none recorded')))}
  </div>
  ${panel('The register', table(['Asset', 'Category', 'Acquired', '$Cost', '$Accumulated', '$Book', 'Life', 'State', ''], d.assets.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.core1_asset_id ? ` <a class="chip chip-dim" href="#/assets">#${a.core1_asset_id}</a>` : ''}</td><td class="sub">${esc(a.category)}</td><td class="mono">${esc(a.acquired)}</td><td class="num">${money(a.cost)}</td><td class="num">${money(a.accumulated)}</td><td class="num">${money(a.book_value)}</td><td class="num">${a.life_months} ${esc(t('mo'))}</td><td>${chip(a.state)}</td>
    <td>${canM && a.state === 'active' ? actBtn(`/api/core2/fixed-assets/${a.id}/dispose`, {}, 'Dispose', '', 'Write this asset off? The loss posts to the ledger and the act is chained.') : ''}</td></tr>`)))}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Register an asset', `<div class="form-inline">${fl('fa-name', 'Name', inp('fa-name', 'Server rack'))}${fl('fa-cat', 'Category', inp('fa-cat', 'equipment'))}${fl('fa-cost', 'Cost', inp('fa-cost', '', 'number'))}${fl('fa-salv', 'Salvage', inp('fa-salv', '0', 'number'))}${fl('fa-life', 'Life (months)', inp('fa-life', '36', 'number'))}${fl('fa-acq', 'Acquired', inp('fa-acq', '', 'date'))}${fl('fa-c1', 'Core 1 asset id', inp('fa-c1', '', 'number'))}${btn('fa-go', 'Register')}</div>`)}
    ${panel('Run a month', `<div class="form-inline">${fl('dep-period', 'Period (YYYY-MM)', inp('dep-period', new Date().toISOString().slice(0, 7)))}${btn('dep-go', 'Post depreciation')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('fx-cur', 'Currency', inp('fx-cur', 'IQD'))}${fl('fx-rate', '1 unit = USD', inp('fx-rate', '0.00076', 'number'))}${btn('fx-go', 'Record rate', '')}</div>`)}
  </div>` : ''}`;
  wireActs(renderFixedAssets);
  on('fa-go', () => act('/api/core2/fixed-assets', { name: val('fa-name'), category: val('fa-cat') || 'equipment', cost: numv('fa-cost'), salvage: numv('fa-salv') || 0, lifeMonths: numv('fa-life'), acquired: val('fa-acq') || undefined, core1AssetId: numv('fa-c1') || null }, renderFixedAssets));
  on('dep-go', () => act('/api/core2/depreciation', { period: val('dep-period') }, renderFixedAssets));
  on('fx-go', () => act('/api/core2/fx', { currency: val('fx-cur'), rateToUsd: numv('fx-rate') }, renderFixedAssets));
}

// ---------------------------------------------------------------- the bank --

export async function renderBank() {
  const d = await api('/api/core2/bank').catch(() => null);
  if (!d) return denied('the bank');
  const canM = hasPermC('bank.manage');
  const accts = d.accounts.filter((a) => a.state === 'active').map((a) => [String(a.id), `${a.name} (${a.gl_code})`]);
  const acctSel = (id) => sel(id, accts.length ? accts : [['', 'no accounts']]);
  const p = d.position;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Cash on the ledger'), money(p.total), `${p.accounts.length} ${esc(t('accounts and cash boxes'))}`)}
    ${tile(t('Unmatched lines'), d.unmatched, esc(t('statement lines with no journal line yet')), d.unmatched ? 'tile-warn' : '')}
    ${tile(t('Transfers waiting'), d.transfersWaiting, esc(t('drafted or approved, not executed')), d.transfersWaiting ? 'tile-warn' : '')}
    ${tile(t('Batches waiting'), d.batchesWaiting, esc(t('payroll and bills not yet released')), d.batchesWaiting ? 'tile-warn' : '')}
  </div>
  ${panel('One chart, one balance', `<div class="map-legend">${esc(t(d.note))} <a href="#/ledger">${esc(t('The ledger'))} →</a> · <a href="#/treasury">${esc(t('Crypto treasury'))} →</a></div>`)}
  ${panel('Cash position', table(['Account', 'Kind', 'GL', '$Ledger', '$Statement', '$Difference', '$Unmatched', ''], p.accounts.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="sub">${esc(a.bank || '')} ${esc(a.currency)}</div></td><td>${chip(a.kind)}</td><td class="mono">${esc(a.glCode)}</td><td class="num">${money(a.ledger)}</td><td class="num">${money(a.statement)}</td><td class="num" style="color:${Math.abs(a.difference) > 0.005 ? 'var(--warn)' : 'var(--ok)'}">${money(a.difference)}</td><td class="num">${a.unmatched}</td>
    <td><button class="btn btn-sm" type="button" data-recon="${a.id}">${esc(t('Reconcile'))}</button> ${canM ? actBtn(`/api/core2/bank/accounts/${a.id}/automatch`, {}, 'Auto-match', '') : ''}</td></tr>`), 'No accounts yet — open one below.') + `<div class="sub" style="margin-top:6px">${esc(t('Parent cash (1000), before it is placed in an account'))}: ${money(p.parentCash)}</div>`)}
  <div id="recon-out"></div>
  ${panel('Transfers', table(['#', 'From', 'To', '$Amount', '$Fee', 'State', 'Approved by', ''], d.transfers.map((x) => `<tr><td class="mono">${x.id}</td><td>${esc(x.from_name)}</td><td>${esc(x.to_name || x.beneficiary || '—')}${x.to_account_id ? '' : ` <span class="chip chip-dim">${esc(t('external'))} ${esc(x.purpose_code)}</span>`}</td><td class="num">${money(x.amount)}</td><td class="num">${money(x.fee)}</td><td>${chip(x.state)}</td><td class="sub">${esc(x.approved_by || '—')}</td>
    <td>${canM && x.state === 'draft' ? actBtn(`/api/core2/bank/transfers/${x.id}/approve`, {}, 'Approve') : ''} ${canM && x.state === 'approved' ? actBtn(`/api/core2/bank/transfers/${x.id}/execute`, {}, 'Execute', 'btn-primary', 'Execute this transfer? Money moves and the act is chained.') : ''}</td></tr>`)))}
  ${panel('Cheques', table(['Account', 'No.', 'Direction', 'Payee', '$Amount', 'Day', 'State', ''], d.cheques.map((c) => `<tr><td>${esc(c.account_name)}</td><td class="mono">${esc(c.number)}</td><td>${chip(c.direction)}</td><td>${esc(c.payee)}</td><td class="num">${money(c.amount)}</td><td class="mono">${esc(c.day)}</td><td>${chip(c.state)}</td>
    <td>${canM ? ({ drafted: ['issued', 'void'], issued: ['presented', 'void'], presented: ['cleared', 'bounced'], bounced: ['presented'] }[c.state] || []).map((s) => actBtn(`/api/core2/bank/cheques/${c.id}/state`, { state: s }, s, s === 'cleared' ? 'btn-primary' : '')).join(' ') : ''}</td></tr>`)))}
  ${panel('Payment batches', table(['#', 'Kind', 'Account', '$Total', '$Lines', 'State', 'Approved by', ''], d.batches.map((b) => `<tr><td class="mono">${b.id}</td><td>${chip(b.kind)}</td><td>${esc(b.account_name)}</td><td class="num">${money(b.total)}</td><td class="num">${b.count}</td><td>${chip(b.state)}</td><td class="sub">${esc(b.approved_by || '—')}</td>
    <td>${canM && b.state === 'draft' ? actBtn(`/api/core2/bank/batches/${b.id}/approve`, {}, 'Approve') : ''} ${canM && b.state === 'approved' ? actBtn(`/api/core2/bank/batches/${b.id}/release`, {}, 'Release', 'btn-primary', 'Release these payments to the bank? The act is chained.') : ''}</td></tr>`)) + `<div class="sub" style="margin-top:6px">${esc(t('A batch is approved by somebody other than the person who built it — four eyes.'))}</div>`)}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Open an account', `<div class="form-inline">${fl('ba-name', 'Name', inp('ba-name', 'Main operating'))}${fl('ba-bank', 'Bank', inp('ba-bank', 'TBI'))}${fl('ba-kind', 'Kind', sel('ba-kind', [['bank', 'bank'], ['cashbox', 'cash box']]))}${fl('ba-cur', 'Currency', inp('ba-cur', 'USD'))}${fl('ba-open', 'Opening balance', inp('ba-open', '0', 'number'))}${btn('ba-go', 'Open')}</div>`)}
    ${panel('Draft a transfer', `<div class="form-inline">${fl('tr-from', 'From', acctSel('tr-from'))}${fl('tr-to', 'To account', sel('tr-to', [['', '— external —'], ...accts]))}${fl('tr-ben', 'Beneficiary (external)', inp('tr-ben', 'Landlord'))}${fl('tr-code', 'Purpose account', inp('tr-code', '5900'))}${fl('tr-amt', 'Amount', inp('tr-amt', '', 'number'))}${fl('tr-fee', 'Fee', inp('tr-fee', '0', 'number'))}${btn('tr-go', 'Draft')}</div>`)}
    ${panel('Write a cheque', `<div class="form-inline">${fl('ch-acct', 'Account', acctSel('ch-acct'))}${fl('ch-no', 'Number', inp('ch-no', '000123'))}${fl('ch-dir', 'Direction', sel('ch-dir', [['issued', 'issued'], ['received', 'received']]))}${fl('ch-payee', 'Payee', inp('ch-payee', ''))}${fl('ch-amt', 'Amount', inp('ch-amt', '', 'number'))}${fl('ch-bill', 'Bill id', inp('ch-bill', '', 'number'))}${btn('ch-go', 'Draft')}</div>`)}
    ${panel('Build a batch', `<div class="form-inline">${fl('pb-run', 'Payroll run id', inp('pb-run', '', 'number'))}${fl('pb-acct', 'From account', acctSel('pb-acct'))}${btn('pb-go', 'Payroll batch')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('ab-bills', 'Approved bill ids (comma)', inp('ab-bills', '1,2'))}${fl('ab-acct', 'From account', acctSel('ab-acct'))}${btn('ab-go', 'Bills batch', '')}</div>`)}
    ${panel('Import a statement', `<div class="form-inline">${fl('st-acct', 'Account', acctSel('st-acct'))}${fl('st-label', 'Label', inp('st-label', 'August'))}</div>
      <textarea id="st-lines" aria-label="${esc(t('Statement lines'))}" rows="4" style="width:100%;margin-top:6px;font-family:var(--font-mono)" placeholder="2026-08-01, -1200.00, RENT\n2026-08-03, 5000.00, INV AR-2026-0001"></textarea><div style="margin-top:6px">${btn('st-go', 'Import', '')}</div>`)}
  </div>` : ''}`;

  wireActs(renderBank);
  view.querySelectorAll('[data-recon]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/api/core2/bank/accounts/${b.dataset.recon}/reconcile`);
      $('#recon-out').innerHTML = panel(`${t('Reconciliation')} — ${r.account.name}`, `<div class="grid grid-2">
        <div><div class="panel-title">${esc(t('Unmatched statement lines'))} · ${r.unmatchedLines.length}</div>${table(['Day', '$Amount', 'Ref', ''], r.unmatchedLines.map((l) => `<tr><td class="mono">${esc(l.day)}</td><td class="num">${money(l.amount)}</td><td class="sub">${esc(l.ref || '')}</td><td>${canM ? `<select aria-label="${esc(t('Journal line'))}" data-mline="${l.id}">${r.openJournal.filter((j) => Math.abs((j.side === 'debit' ? j.amount : -j.amount) - l.amount) < 0.005).map((j) => `<option value="${j.id}">${esc(j.ref)} ${esc(j.memo)}</option>`).join('') || '<option value="">—</option>'}</select> <button class="btn btn-sm" type="button" data-match="${l.id}">${esc(t('Match'))}</button> ${actBtn(`/api/core2/bank/lines/${l.id}/exclude`, {}, 'Exclude', '')}` : ''}</td></tr>`), 'Everything on the statement has a line behind it.')}</div>
        <div><div class="panel-title">${esc(t('Open journal lines'))} · ${r.openJournal.length}</div>${table(['Entry', 'Day', 'Memo', '$Amount'], r.openJournal.map((j) => `<tr><td class="mono">${esc(j.ref)}</td><td class="mono">${esc(j.entry_date)}</td><td class="sub">${esc(j.memo)}</td><td class="num">${j.side === 'debit' ? '' : '−'}${money(j.amount)}</td></tr>`), 'Every posted line has met its statement line.')}</div>
      </div><div class="sub" style="margin-top:6px">${esc(t('Ledger'))} ${money(r.ledger)} · ${esc(t('statement'))} ${money(r.statement)} · ${esc(t('difference'))} ${money(r.difference)} · ${r.matched} ${esc(t('matched'))}</div>`);
      wireActs(renderBank);
      view.querySelectorAll('[data-match]').forEach((m) => m.addEventListener('click', () => {
        const jl = view.querySelector(`[data-mline="${m.dataset.match}"]`)?.value;
        if (!jl) return toast(t('No journal line with that amount is open.'), true);
        act(`/api/core2/bank/lines/${m.dataset.match}/match`, { journalLineId: Number(jl) }, renderBank);
      }));
    } catch (e) { toast(e.message, true); }
  }));
  on('ba-go', () => act('/api/core2/bank/accounts', { name: val('ba-name'), bank: val('ba-bank'), kind: val('ba-kind'), currency: val('ba-cur') || 'USD', openingBalance: numv('ba-open') || 0 }, renderBank));
  on('tr-go', () => act('/api/core2/bank/transfers', { fromAccountId: val('tr-from'), toAccountId: val('tr-to') || null, beneficiary: val('tr-ben') || null, purposeCode: val('tr-code') || '5900', amount: numv('tr-amt'), fee: numv('tr-fee') || 0 }, renderBank));
  on('ch-go', () => act('/api/core2/bank/cheques', { accountId: val('ch-acct'), number: val('ch-no'), direction: val('ch-dir'), payee: val('ch-payee'), amount: numv('ch-amt'), billId: numv('ch-bill') || null }, renderBank));
  on('pb-go', () => act('/api/core2/bank/batches/payroll', { runId: numv('pb-run'), accountId: val('pb-acct') }, renderBank));
  on('ab-go', () => act('/api/core2/bank/batches/ap', { billIds: val('ab-bills').split(',').map((x) => Number(x.trim())).filter(Boolean), accountId: val('ab-acct') }, renderBank));
  on('st-go', () => act(`/api/core2/bank/accounts/${val('st-acct')}/statement`, { label: val('st-label'), lines: $('#st-lines').value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p2) => p2[0]).map(([d2, amount, ref]) => ({ day: d2, amount: Number(amount), ref })) }, renderBank));
}

// -------------------------------------------------------------- operations --

export async function renderInventory() {
  const d = await api('/api/core2/ops').catch(() => null);
  if (!d) return denied('inventory');
  const canM = hasPermC('ops.manage');
  const whs = d.warehouses.map((w) => [String(w.id), `${w.code} — ${w.name}`]);
  const items = d.items.map((i) => [String(i.id), `${i.sku} — ${i.name}`]);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Items'), d.items.length, esc(t('catalogued SKUs')))}
    ${tile(t('Below minimum'), d.lowStock, esc(t('an event was raised for each')), d.lowStock ? 'tile-warn' : '')}
    ${tile(t('Stock value'), money(d.stockValue), esc(t('level × unit cost')))}
    ${tile(t('Warehouses'), d.warehouses.length, d.warehouses.map((w) => w.code).join(' · ') || esc(t('none yet')))}
  </div>
  ${panel('A level is a sum', `<div class="map-legend">${esc(t('A stock level is never stored. It is the sum of the moves against the item, so a level that is wrong has a move behind it that can be found. Goods are received against a delivered procurement.'))} <a href="#/procure">${esc(t('Procurement'))} →</a></div>`)}
  ${panel('Levels', table(['SKU', 'Item', '$Level', '$Min', 'By warehouse', '$Value', ''], d.items.map((i) => `<tr><td class="mono">${esc(i.sku)}</td><td><b>${esc(i.name)}</b></td><td class="num" style="${i.low ? 'color:var(--bad)' : ''}">${num(i.level)} ${esc(i.unit)}</td><td class="num">${num(i.min_qty)}</td><td class="sub">${i.byWarehouse.map((w) => `${esc(w.code)}: ${num(w.level)}`).join(' · ') || '—'}</td><td class="num">${money(i.value)}</td><td>${i.low ? chip('low') : ''}</td></tr>`)))}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Move stock', `<div class="form-inline">${fl('sm-item', 'Item', sel('sm-item', items.length ? items : [['', 'no items']]))}${fl('sm-wh', 'Warehouse', sel('sm-wh', whs.length ? whs : [['', 'no warehouses']]))}${fl('sm-kind', 'Kind', sel('sm-kind', [['receipt', 'receipt'], ['issue', 'issue'], ['adjust', 'adjust']]))}${fl('sm-qty', 'Quantity', inp('sm-qty', '10', 'number'))}${fl('sm-proc', 'Procurement id', inp('sm-proc', '', 'number'))}${btn('sm-go', 'Record')}</div>`)}
    ${panel('Catalogue', `<div class="form-inline">${fl('it-sku', 'SKU', inp('it-sku', 'PAPER-A4'))}${fl('it-name', 'Name', inp('it-name', 'A4 paper, ream'))}${fl('it-unit', 'Unit', inp('it-unit', 'each'))}${fl('it-min', 'Minimum', inp('it-min', '0', 'number'))}${fl('it-cost', 'Unit cost', inp('it-cost', '0', 'number'))}${btn('it-go', 'Add item', '')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('wh-name', 'Warehouse', inp('wh-name', 'Main store'))}${fl('wh-code', 'Code', inp('wh-code', 'MAIN'))}${btn('wh-go', 'Add warehouse', '')}</div>`)}
  </div>` : ''}`;
  wireActs(renderInventory);
  on('sm-go', () => act('/api/core2/ops/stock', { itemId: val('sm-item'), warehouseId: val('sm-wh'), kind: val('sm-kind'), qty: numv('sm-qty'), procRequestId: numv('sm-proc') || null }, renderInventory));
  on('it-go', () => act('/api/core2/ops/item', { sku: val('it-sku'), name: val('it-name'), unit: val('it-unit') || 'each', minQty: numv('it-min') || 0, cost: numv('it-cost') || 0 }, renderInventory));
  on('wh-go', () => act('/api/core2/ops/warehouse', { name: val('wh-name'), code: val('wh-code') }, renderInventory));
}

export async function renderFacilities() {
  const d = await api('/api/core2/ops').catch(() => null);
  if (!d) return denied('facilities');
  const canM = hasPermC('ops.manage');
  const emps = canM ? await employees() : [];
  const rooms = d.rooms.map((r) => [String(r.id), r.name]);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Work orders open'), d.workOrdersOpen, esc(t('raised, not yet done')), d.workOrdersOpen ? 'tile-warn' : '')}
    ${tile(t('Vehicles'), d.fleet.length, `${d.fleet.filter((v) => v.state === 'in_service').length} ${esc(t('in service'))}`)}
    ${tile(t('Rooms'), d.rooms.length, `${d.rooms.reduce((a, r) => a + r.bookings.length, 0)} ${esc(t('bookings today'))}`)}
    ${tile(t('Incidents open'), d.incidentsOpen, esc(t('workplace — kept apart from the technical ones')), d.incidentsOpen ? 'tile-warn' : '')}
  </div>
  ${panel('Work orders', table(['Title', 'Target', 'Priority', 'Assignee', 'Due', '$Cost', 'State', ''], d.workOrders.map((w) => `<tr><td><b>${esc(w.title)}</b></td><td class="sub">${esc(w.target_kind)}${w.target_id ? ` #${w.target_id}` : ''}</td><td>${chip(w.priority)}</td><td class="sub">${esc(w.assignee || '—')}</td><td class="mono">${esc(w.due || '—')}</td><td class="num">${money(w.cost)}</td><td>${chip(w.state)}</td>
    <td>${canM && !['done', 'cancelled'].includes(w.state) ? (w.state === 'open' ? actBtn(`/api/core2/ops/workorder/${w.id}/state`, { state: 'in_progress' }, 'Start', '') + ' ' : '') + actBtn(`/api/core2/ops/workorder/${w.id}/state`, { state: 'done' }, 'Done') + ' ' + actBtn(`/api/core2/ops/workorder/${w.id}/state`, { state: 'cancelled' }, 'Cancel', '') : ''}</td></tr>`)))}
  <div class="grid grid-2" style="margin-top:16px">
    ${panel('Fleet', table(['Plate', 'Vehicle', '$Odometer', 'Held by', 'Next service', 'State'], d.fleet.map((v) => `<tr><td class="mono">${esc(v.plate)}</td><td>${esc(v.make)} ${esc(v.model || '')} ${v.year || ''}</td><td class="num">${num(v.odometer)}</td><td class="sub">${esc(v.assignee || '—')}</td><td class="mono">${esc(v.next_service || '—')}</td><td>${chip(v.state)}</td></tr>`)))}
    ${panel('Rooms today', table(['Room', 'Capacity', 'Bookings'], d.rooms.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="sub">${esc(r.building || '')}</div></td><td class="num">${r.capacity}</td><td class="sub">${r.bookings.map((b) => `${esc(b.starts.slice(11, 16))}–${esc(b.ends.slice(11, 16))} ${esc(b.display_name)}${canM ? ` ${actBtn(`/api/core2/ops/booking/${b.id}/cancel`, {}, '×', '')}` : ''}`).join('<br>') || '—'}</td></tr>`)))}
  </div>
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Raise a work order', `<div class="form-inline">${fl('wo-title', 'What needs doing', inp('wo-title', 'Replace AC filter, room 2'))}${fl('wo-kind', 'Target', sel('wo-kind', [['other', 'other'], ['fixed_asset', 'fixed asset'], ['vehicle', 'vehicle'], ['room', 'room']]))}${fl('wo-id', 'Target id', inp('wo-id', '', 'number'))}${fl('wo-pri', 'Priority', sel('wo-pri', [['normal', 'normal'], ['low', 'low'], ['high', 'high'], ['urgent', 'urgent']]))}${fl('wo-emp', 'Assign to', sel('wo-emp', [['', '—'], ...emps]))}${btn('wo-go', 'Raise')}</div>`)}
    ${panel('Book a room', `<div class="form-inline">${fl('bk-room', 'Room', sel('bk-room', rooms.length ? rooms : [['', 'no rooms']]))}${fl('bk-emp', 'For', empSel('bk-emp', emps))}${fl('bk-start', 'Starts', inp('bk-start', '', 'datetime-local'))}${fl('bk-end', 'Ends', inp('bk-end', '', 'datetime-local'))}${btn('bk-go', 'Book')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('rm-name', 'New room', inp('rm-name', 'Meeting room 1'))}${fl('rm-cap', 'Capacity', inp('rm-cap', '6', 'number'))}${btn('rm-go', 'Add room', '')}</div>`)}
    ${panel('Add a vehicle', `<div class="form-inline">${fl('vh-plate', 'Plate', inp('vh-plate', 'BGD 12345'))}${fl('vh-make', 'Make', inp('vh-make', 'Toyota'))}${fl('vh-model', 'Model', inp('vh-model', 'Hilux'))}${fl('vh-odo', 'Odometer', inp('vh-odo', '0', 'number'))}${fl('vh-emp', 'Held by', sel('vh-emp', [['', '—'], ...emps]))}${btn('vh-go', 'Add', '')}</div>`)}
  </div>` : ''}`;
  wireActs(renderFacilities);
  const dt = (id) => (val(id) ? val(id).replace('T', ' ') + ':00' : '');
  on('wo-go', () => act('/api/core2/ops/workorder', { title: val('wo-title'), targetKind: val('wo-kind'), targetId: numv('wo-id') || null, priority: val('wo-pri'), assigneeEmployeeId: val('wo-emp') || null }, renderFacilities));
  on('bk-go', () => act('/api/core2/ops/booking', { roomId: val('bk-room'), employeeId: val('bk-emp'), starts: dt('bk-start'), ends: dt('bk-end') }, renderFacilities));
  on('rm-go', () => act('/api/core2/ops/room', { name: val('rm-name'), capacity: numv('rm-cap') || 4 }, renderFacilities));
  on('vh-go', () => act('/api/core2/ops/vehicle', { plate: val('vh-plate'), make: val('vh-make'), model: val('vh-model'), odometer: numv('vh-odo') || 0, assigneeEmployeeId: val('vh-emp') || null }, renderFacilities));
}

export async function renderHelpdesk() {
  const d = await api('/api/core2/helpdesk').catch(() => null);
  if (!d) return denied('the help desk');
  const canM = hasPermC('ops.manage'); const canOpen = hasPermC('ops.view');
  const emps = canOpen ? await employees() : [];
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Open tickets'), d.open, esc(t('not yet resolved')), d.open ? 'tile-warn' : '')}
    ${tile(t('Past SLA'), d.breached, esc(t('announced once each, when the clock ran out')), d.breached ? 'tile-bad' : '')}
    ${tile(t('Incidents open'), d.incidents.filter((i) => i.state !== 'closed').length, esc(t('safety, quality, security, environment')))}
    ${tile(t('Customer desk'), esc(t('elsewhere')), `<a href="#/support">${esc(t('customers who wrote in'))} →</a>`)}
  </div>
  ${panel('Tickets', table(['Ref', 'Title', 'Category', 'Priority', 'Requester', 'Assignee', 'SLA due', 'State', ''], d.tickets.map((x) => `<tr><td class="mono">${esc(x.ref)}</td><td><b>${esc(x.title)}</b>${x.doc_id ? ` <a class="chip chip-dim" href="#/docs">${esc(t('doc'))}</a>` : ''}</td><td>${chip(x.category)}</td><td>${chip(x.priority)}</td><td class="sub">${esc(x.requester || '—')}</td><td class="sub">${esc(x.assignee || '—')}</td><td class="mono" style="${x.breached ? 'color:var(--bad)' : ''}">${esc(x.sla_due)}</td><td>${chip(x.state)}${x.breached && !['resolved', 'closed'].includes(x.state) ? ' ' + chip('breached') : ''}</td>
    <td>${canM && x.state !== 'closed' ? `<select aria-label="${esc(t('Assign to'))}" data-asg-emp="${x.id}">${[['', '—'], ...emps].map(([v, l]) => `<option value="${v}"${String(x.assignee_employee_id) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select> <button class="btn btn-sm" type="button" data-asg="${x.id}">${esc(t('Assign'))}</button>
      ${x.state !== 'resolved' ? actBtn(`/api/core2/helpdesk/${x.id}/state`, { state: 'resolved' }, 'Resolve') : actBtn(`/api/core2/helpdesk/${x.id}/state`, { state: 'closed' }, 'Close', '')}` : ''}</td></tr>`)))}
  ${panel('Workplace incidents', table(['Kind', '$Sev', 'Title', 'Occurred', 'Corrective action', 'State', ''], d.incidents.map((i) => `<tr><td>${chip(i.kind)}</td><td class="num">${i.severity}</td><td><b>${esc(i.title)}</b></td><td class="mono">${esc(i.occurred_at)}</td><td class="sub">${esc(i.action || '—')}</td><td>${chip(i.state)}</td>
    <td>${canM && i.state !== 'closed' ? (i.state === 'open' ? actBtn(`/api/core2/ops/incident/${i.id}/state`, { state: 'investigating' }, 'Investigate', '') + ' ' : '') + actBtn(`/api/core2/ops/incident/${i.id}/state`, { state: 'closed' }, 'Close') : ''}</td></tr>`)))}
  ${canOpen ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Open a ticket', `<div class="form-inline">${fl('tk-title', 'What is wrong', inp('tk-title', 'Laptop will not start'))}${fl('tk-cat', 'Category', sel('tk-cat', [['it', 'IT'], ['facilities', 'facilities'], ['hr', 'HR'], ['finance', 'finance'], ['other', 'other']]))}${fl('tk-pri', 'Priority', sel('tk-pri', [['normal', 'normal'], ['low', 'low'], ['high', 'high'], ['urgent', 'urgent']]))}${fl('tk-emp', 'Requester', sel('tk-emp', [['', '—'], ...emps]))}</div>
      <textarea id="tk-body" aria-label="${esc(t('Details'))}" rows="2" style="width:100%;margin-top:6px" placeholder="${esc(t('Details, if any. An HR ticket\'s words are sealed under the requester.'))}"></textarea><div style="margin-top:6px">${btn('tk-go', 'Open')}</div>`)}
    ${canM ? panel('Report an incident', `<div class="form-inline">${fl('in-kind', 'Kind', sel('in-kind', [['safety', 'safety'], ['quality', 'quality'], ['security', 'security'], ['environment', 'environment']]))}${fl('in-sev', 'Severity 1–4', inp('in-sev', '3', 'number'))}${fl('in-title', 'Title', inp('in-title', 'Wet floor, stairwell B'))}${fl('in-action', 'Corrective action', inp('in-action', 'Signage and mat placed'))}${btn('in-go', 'Report', '')}</div>`) : ''}
  </div>` : ''}`;
  wireActs(renderHelpdesk);
  view.querySelectorAll('[data-asg]').forEach((b) => b.addEventListener('click', () => {
    const who = view.querySelector(`[data-asg-emp="${b.dataset.asg}"]`)?.value;
    if (!who) return toast(t('Choose somebody.'), true);
    act(`/api/core2/helpdesk/${b.dataset.asg}/assign`, { assigneeEmployeeId: Number(who) }, renderHelpdesk);
  }));
  on('tk-go', () => act('/api/core2/helpdesk', { title: val('tk-title'), category: val('tk-cat'), priority: val('tk-pri'), requesterEmployeeId: val('tk-emp') || null, body: $('#tk-body').value || null }, renderHelpdesk));
  on('in-go', () => act('/api/core2/ops/incident', { kind: val('in-kind'), severity: numv('in-sev'), title: val('in-title'), action: val('in-action') || null }, renderHelpdesk));
}

// ---------------------------------------------------------- administration --

export async function renderSecretariat() {
  const d = await api('/api/core2/admin').catch(() => null);
  if (!d) return denied('the secretariat');
  const canM = hasPermC('admin.manage');
  const emps = canM ? await employees() : [];
  const NEXT = { received: ['routed', 'closed'], routed: ['answered', 'closed'], answered: ['closed'], drafted: ['sent'], sent: ['closed'] };
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Letters open'), d.lettersOpen, esc(t('received or drafted, not yet closed')), d.lettersOpen ? 'tile-warn' : '')}
    ${tile(t('Committees'), d.committees.filter((c) => c.state === 'active').length, esc(t('with members who are employments')))}
    ${tile(t('Resolutions adopted'), d.committees.reduce((a, c) => a + c.resolutions.filter((r) => r.state === 'adopted').length, 0), esc(t('by a person, chained')))}
    ${tile(t('Numbered'), esc(t('everything')), esc(t('IN-, OUT-, RES- — a reference and a name on each')))}
  </div>
  ${panel('Correspondence register', table(['Ref', 'Direction', 'Subject', 'Counterparty', 'Unit', 'Day', 'State', ''], d.letters.map((l) => `<tr><td class="mono">${esc(l.ref)}</td><td>${chip(l.direction)}</td><td><b>${esc(l.subject)}</b></td><td class="sub">${esc(l.counterparty)}</td><td class="sub">${esc(l.unit || '—')}</td><td class="mono">${esc(l.day)}</td><td>${chip(l.state)}</td>
    <td>${canM ? (NEXT[l.state] || []).map((s) => actBtn(`/api/core2/admin/letter/${l.id}/state`, { state: s }, s, s === 'sent' ? 'btn-primary' : '')).join(' ') : ''}</td></tr>`)))}
  ${panel('Committees and resolutions', d.committees.map((c) => `<div style="margin-bottom:12px"><b>${esc(c.name)}</b> ${chip(c.state)} <span class="sub">${esc(t('chair'))}: ${esc(c.chair || '—')} · ${c.members.map((m) => esc(m.display_name)).join(', ') || esc(t('no members'))}</span>
    ${table(['Ref', 'Title', 'State', 'Decided', 'By', ''], c.resolutions.map((r) => `<tr><td class="mono">${esc(r.ref)}</td><td>${esc(r.title)}</td><td>${chip(r.state)}</td><td class="mono">${esc(r.decided_on || '—')}</td><td class="sub">${esc(r.adopted_by || '—')}</td>
      <td>${canM && r.state === 'proposed' ? actBtn(`/api/core2/admin/resolution/${r.id}/decide`, { state: 'adopted' }, 'Adopt', 'btn-primary', 'Adopt this resolution? It is chained with your name.') + ' ' + actBtn(`/api/core2/admin/resolution/${r.id}/decide`, { state: 'rejected' }, 'Reject', '') : ''}</td></tr>`), 'No resolutions proposed.')}</div>`).join('') || `<div class="empty">${esc(t('No committees yet.'))}</div>`)}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Register a letter', `<div class="form-inline">${fl('le-dir', 'Direction', sel('le-dir', [['in', 'incoming'], ['out', 'outgoing']]))}${fl('le-subj', 'Subject', inp('le-subj', ''))}${fl('le-cp', 'Counterparty', inp('le-cp', 'Ministry of Labour'))}${fl('le-unit', 'Unit id', inp('le-unit', '', 'number'))}</div>
      <textarea id="le-body" aria-label="${esc(t('Body'))}" rows="2" style="width:100%;margin-top:6px" placeholder="${esc(t('The text, kept as an internal document.'))}"></textarea><div style="margin-top:6px">${btn('le-go', 'Register')}</div>`)}
    ${panel('Committees', `<div class="form-inline">${fl('cm-name', 'Committee', inp('cm-name', 'Procurement committee'))}${fl('cm-chair', 'Chair', sel('cm-chair', [['', '—'], ...emps]))}${fl('cm-members', 'Member ids (comma)', inp('cm-members', ''))}${btn('cm-go', 'Form', '')}</div>
      <div class="form-inline" style="margin-top:8px">${fl('rs-cm', 'Committee', sel('rs-cm', d.committees.filter((c) => c.state === 'active').map((c) => [String(c.id), c.name]).concat(d.committees.length ? [] : [['', 'none']])))}${fl('rs-title', 'Resolution', inp('rs-title', ''))}${btn('rs-go', 'Propose')}</div>`)}
  </div>` : ''}`;
  wireActs(renderSecretariat);
  on('le-go', () => act('/api/core2/admin/letter', { direction: val('le-dir'), subject: val('le-subj'), counterparty: val('le-cp'), orgUnitId: numv('le-unit') || null, body: $('#le-body').value || null }, renderSecretariat));
  on('cm-go', () => act('/api/core2/admin/committee', { name: val('cm-name'), chairEmployeeId: val('cm-chair') || null, memberIds: val('cm-members').split(',').map((x) => Number(x.trim())).filter(Boolean) }, renderSecretariat));
  on('rs-go', () => act('/api/core2/admin/resolution', { committeeId: val('rs-cm'), title: val('rs-title') }, renderSecretariat));
}

export async function renderLegalCases() {
  const d = await api('/api/core2/legalcases').catch(() => null);
  if (!d) return denied('legal cases');
  const canM = hasPermC('legal.manage');
  const open = d.cases.filter((c) => ['open', 'hearing'].includes(c.state));
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Open cases'), open.length, esc(t('litigation, arbitration, claims')), open.length ? 'tile-warn' : '')}
    ${tile(t('Exposure'), money(open.reduce((a, c) => a + c.exposure, 0)), esc(t('what the open cases could cost')))}
    ${tile(t('Next hearing'), esc(open.map((c) => c.next_hearing).filter(Boolean).sort()[0] || '—'), esc(t('the soonest date on the calendar')))}
    ${tile(t('Contracts'), esc(t('Core 1\'s')), `<a href="#/legal">${esc(t('a case rests on a contract from the register'))} →</a>`)}
  </div>
  ${panel('Cases', table(['Ref', 'Kind', 'Counterparty', 'Court', 'Contract', 'Next hearing', '$Exposure', 'State', ''], d.cases.map((c) => `<tr><td class="mono">${esc(c.ref)}</td><td>${chip(c.kind)}</td><td><b>${esc(c.counterparty)}</b></td><td class="sub">${esc(c.court || '—')}</td><td class="sub">${c.contract_id ? `<a href="#/legal">#${c.contract_id}</a>` : '—'}</td><td class="mono">${esc(c.next_hearing || '—')}</td><td class="num">${money(c.exposure)}</td><td>${chip(c.state)}</td>
    <td>${canM && ['open', 'hearing'].includes(c.state) ? [['hearing', ''], ['settled', 'btn-primary'], ['won', ''], ['lost', ''], ['closed', '']].filter(([s]) => s !== c.state).map(([s, cls]) => actBtn(`/api/core2/legalcases/${c.id}/state`, { state: s }, s, cls, ['settled', 'won', 'lost', 'closed'].includes(s) ? 'Conclude this case? The act is chained with your name.' : null)).join(' ') : ''}</td></tr>`)))}
  ${canM ? panel('Open a case', `<div class="form-inline">${fl('cs-kind', 'Kind', sel('cs-kind', [['claim', 'claim'], ['litigation', 'litigation'], ['arbitration', 'arbitration'], ['regulatory', 'regulatory'], ['labour', 'labour']]))}${fl('cs-cp', 'Counterparty', inp('cs-cp', ''))}${fl('cs-court', 'Court', inp('cs-court', ''))}${fl('cs-ct', 'Contract id', inp('cs-ct', '', 'number'))}${fl('cs-hear', 'Next hearing', inp('cs-hear', '', 'date'))}${fl('cs-exp', 'Exposure', inp('cs-exp', '0', 'number'))}${btn('cs-go', 'Open')}</div>`) : ''}`;
  wireActs(renderLegalCases);
  on('cs-go', () => act('/api/core2/legalcases', { kind: val('cs-kind'), counterparty: val('cs-cp'), court: val('cs-court') || null, contractId: numv('cs-ct') || null, nextHearing: val('cs-hear') || null, exposure: numv('cs-exp') || 0 }, renderLegalCases));
}

export async function renderRegulatory() {
  const d = await api('/api/core2/admin').catch(() => null);
  if (!d) return denied('the regulatory calendar');
  const canM = hasPermC('admin.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Obligations pending'), d.obligations.filter((o) => o.state !== 'done').length, esc(t('on the calendar, not yet discharged')))}
    ${tile(t('Overdue'), d.obligationsOverdue, esc(t('the sweep marks these; they do not mark themselves')), d.obligationsOverdue ? 'tile-bad' : '')}
    ${tile(t('Licences'), d.licenses.filter((l) => l.state === 'active').length, esc(t('active, with an expiry the sweep watches')))}
    ${tile(t('Expiring in 60 days'), d.licensesExpiring, esc(t('renewal needs a decision')), d.licensesExpiring ? 'tile-warn' : '')}
  </div>
  ${panel('Two clocks', `<div class="map-legend">${esc(t('An obligation is due to an authority on a date; a licence expires on one. The hourly sweep marks what is overdue and announces what is close, once a day each. Discharging an obligation with a recurrence puts the next one on the calendar.'))} <a href="#/compliance">${esc(t('The compliance file'))} →</a> · <a href="#/tax">${esc(t('Tax'))} →</a></div>`)}
  ${panel('Obligations', table(['Title', 'Authority', 'Due', 'Recurs', 'Unit', 'State', 'Done by', ''], d.obligations.map((o) => `<tr><td><b>${esc(o.title)}</b></td><td class="sub">${esc(o.authority)}</td><td class="mono">${esc(o.due)}</td><td class="sub">${esc(o.recurrence)}</td><td class="sub">${esc(o.unit || '—')}</td><td>${chip(o.state)}</td><td class="sub">${esc(o.done_by || '—')}</td>
    <td>${canM && o.state !== 'done' ? actBtn(`/api/core2/admin/obligation/${o.id}/done`, {}, 'Discharge') : ''}</td></tr>`)))}
  ${panel('Licences and registrations', table(['Name', 'Authority', 'Number', 'Issued', 'Expires', 'State', ''], d.licenses.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td class="sub">${esc(l.authority)}</td><td class="mono">${esc(l.number || '—')}</td><td class="mono">${esc(l.issued || '—')}</td><td class="mono">${esc(l.expires)}</td><td>${chip(l.state)}</td>
    <td>${canM && l.state !== 'renewed' ? `<input type="date" aria-label="${esc(t('New expiry'))}" data-ren-date="${l.id}"> <button class="btn btn-sm" type="button" data-renew="${l.id}">${esc(t('Renew'))}</button>` : ''}</td></tr>`)))}
  ${canM ? `<div class="grid grid-2" style="margin-top:16px">
    ${panel('Add an obligation', `<div class="form-inline">${fl('ob-title', 'Title', inp('ob-title', 'Social security return'))}${fl('ob-auth', 'Authority', inp('ob-auth', 'Ministry of Labour'))}${fl('ob-due', 'Due', inp('ob-due', '', 'date'))}${fl('ob-rec', 'Recurs', sel('ob-rec', [['none', 'none'], ['monthly', 'monthly'], ['quarterly', 'quarterly'], ['yearly', 'yearly']]))}${btn('ob-go', 'Add')}</div>`)}
    ${panel('Add a licence', `<div class="form-inline">${fl('li-name', 'Name', inp('li-name', 'Commercial registration'))}${fl('li-auth', 'Authority', inp('li-auth', 'Companies Registrar'))}${fl('li-no', 'Number', inp('li-no', ''))}${fl('li-exp', 'Expires', inp('li-exp', '', 'date'))}${btn('li-go', 'Add', '')}</div>`)}
  </div>` : ''}`;
  wireActs(renderRegulatory);
  view.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', () => act(`/api/core2/admin/license/${b.dataset.renew}/renew`, { expires: view.querySelector(`[data-ren-date="${b.dataset.renew}"]`)?.value }, renderRegulatory)));
  on('ob-go', () => act('/api/core2/admin/obligation', { title: val('ob-title'), authority: val('ob-auth'), due: val('ob-due'), recurrence: val('ob-rec') }, renderRegulatory));
  on('li-go', () => act('/api/core2/admin/license', { name: val('li-name'), authority: val('li-auth'), number: val('li-no') || null, expires: val('li-exp') }, renderRegulatory));
}

// ------------------------------------------------------------ my workspace --

export async function renderMe() {
  const d = await api('/api/core2/me').catch(() => null);
  if (!d) return denied('your workspace');
  if (!d.linked) {
    view.innerHTML = `<div class="panel"><div class="panel-title">${esc(t('This login is not yet a person on the record'))}</div>
      <div class="map-legend">${esc(t('A login may exist without an employment and an employment without a login — the identity model allows any combination. To see your day, your leave and your slips here, somebody with people.manage links your account to your person on the Employees page.'))} <a href="#/workforce2">${esc(t('Employees'))} →</a></div></div>`;
    return;
  }
  if (!d.employee) {
    view.innerHTML = `<div class="panel"><div class="panel-title">${esc(d.person.display_name)}</div><div class="map-legend">${esc(t('You are on the record as a person, with no employment yet.'))}</div></div>`;
    return;
  }
  const e = d.employee;
  const canTime = hasPermC('people.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">${esc(d.person.display_name)} <span class="chip chip-dim">${esc(e.employee_no)}</span> ${chip(e.state)}</div>
    <div class="sub">${esc(e.position || '—')} · ${esc(e.unit || '—')} · ${esc(t(e.employment))} · ${esc(t('since'))} ${esc(e.hired_at)}</div></div>
  <div class="grid grid-4" style="margin-top:16px">
    ${tile(t('Today'), d.today?.in_at ? esc(d.today.in_at.slice(11, 16)) : '—', d.today?.out_at ? `${esc(t('out'))} ${esc(d.today.out_at.slice(11, 16))}` : (d.today?.in_at ? esc(t('checked in')) : esc(t('not checked in'))))}
    ${tile(t('Leave requests'), d.leave.requests.filter((r) => r.state === 'pending').length, esc(t('waiting on your manager')))}
    ${tile(t('Payslips'), d.payslips.length, esc(t('sealed under your key; opened only for you and finance')))}
    ${tile(t('Open tickets'), d.tickets.length, esc(t('at the help desk')))}
  </div>
  ${canTime ? `<div style="margin-top:12px">${actBtn('/api/core2/time/checkin', { employeeId: e.id }, 'Check in', 'btn-primary')} ${actBtn('/api/core2/time/checkout', { employeeId: e.id }, 'Check out', '')} <a class="btn btn-sm" href="#/time">${esc(t('Attendance & leave'))} →</a></div>` : ''}
  <div class="grid grid-2" style="margin-top:16px">
    ${panel('Leave balances', table(['Policy', 'Type', '$Entitled', '$Used', '$Left'], d.leave.balances.map((b) => `<tr><td><b>${esc(b.policy)}</b></td><td class="sub">${esc(b.type)}</td><td class="num">${num(b.entitled ?? b.total ?? 0)}</td><td class="num">${num(b.used ?? 0)}</td><td class="num">${num(b.remaining ?? b.left ?? 0)}</td></tr>`), 'No leave policies yet.'))}
    ${panel('My requests', table(['Policy', 'From', 'To', '$Days', 'State'], d.leave.requests.map((r) => `<tr><td>${esc(r.policy)}</td><td class="mono">${esc(r.starts)}</td><td class="mono">${esc(r.ends)}</td><td class="num">${r.days}</td><td>${chip(r.state)}</td></tr>`)))}
    ${panel('Overtime', table(['Day', '$Minutes', 'State'], d.overtime.map((o) => `<tr><td class="mono">${esc(o.day)}</td><td class="num">${o.minutes}</td><td>${chip(o.state)}</td></tr>`)))}
    ${panel('Payslips', table(['Period', 'Run state'], d.payslips.map((p) => `<tr><td class="mono">${esc(p.period)}</td><td>${chip(p.state)}</td></tr>`)) + `<div class="sub" style="margin-top:6px"><a href="#/finops2">${esc(t('Finance ops'))} →</a></div>`)}
    ${panel('Things I hold', table(['Asset', 'Kind', 'Since'], d.assets.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td class="sub">${esc(a.kind)}</td><td class="mono">${day(a.assigned_at)}</td></tr>`), 'Nothing signed out to you.'))}
    ${panel('My tasks', table(['Kind', 'What'], d.tasks.map((x) => `<tr><td>${chip(x.kind)}</td><td>${esc(x.what)}</td></tr>`), 'Nothing outstanding.'))}
    ${panel('My tickets', table(['Ref', 'Title', 'State', 'SLA'], d.tickets.map((x) => `<tr><td class="mono">${esc(x.ref)}</td><td>${esc(x.title)}</td><td>${chip(x.state)}</td><td class="mono">${esc(x.sla_due)}</td></tr>`)) + `<div class="sub" style="margin-top:6px"><a href="#/helpdesk">${esc(t('Help desk'))} →</a></div>`)}
    ${panel('Rooms I booked', table(['Room', 'From', 'To'], d.bookings.map((b) => `<tr><td>${esc(b.room)}</td><td class="mono">${esc(b.starts)}</td><td class="mono">${esc(b.ends)}</td></tr>`)))}
    ${panel('Objectives', table(['Objective', 'Due', 'State'], d.objectives.map((o) => `<tr><td>${esc(o.title)}</td><td class="mono">${esc(o.due || '—')}</td><td>${chip(o.state)}</td></tr>`)))}
    ${panel('Certificates', table(['Course', 'Expires'], d.certificates.map((c) => `<tr><td>${esc(c.course)}</td><td class="mono">${esc(c.expires_at || '—')}</td></tr>`)))}
    ${panel('Policies to acknowledge', table(['Policy', ''], d.policiesToAcknowledge.map((p) => `<tr><td><b>${esc(p.title)}</b></td><td>${hasPermC('admin.manage') || hasPermC('docs.view') ? actBtn('/api/core2/admin/policy-ack', { docId: p.id, employeeId: e.id }, 'I have read it', '') : ''}</td></tr>`), 'Nothing waiting for your acknowledgement.'))}
  </div>`;
  wireActs(renderMe);
}
