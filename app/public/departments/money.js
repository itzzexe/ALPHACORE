// The money surface: every department behind that door.
//
// Grouped by the same mapping the navigation is drawn from, so a module
// boundary and a menu boundary cannot drift apart.

import { $, esc, money, money4, short, toast, view } from '../core/dom.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { api } from '../services/api.js';
import { connBtn, wireConnections, wireDownloads } from '../components/common.js';
import { figure } from '../components/bits.js';
import { tile } from '../components/tile.js';
import { wireXact, xbtn } from '../components/chrome.js';
import { t } from '/i18n.js';

// The books. Four statements, the journal, and the account behind any number —
// because the question after "what is this number" is always "show me".
export async function renderLedger() {
  const L = await api('/api/ledger');
  const tb = L.trialBalance; const is = L.incomeStatement; const bs = L.balanceSheet;
  const acct = (a) => `<tr><td><a href="#/ledger" class="mono">${esc(a.code)}</a> ${esc(a.name)}</td><td class="num">${esc(money(a.balance))}</td></tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${tb.balances ? '' : 'tile-bad'}">
      <div class="panel-title">Trial balance · ${esc(L.period)}</div>
      <div class="big">${tb.balances ? 'balances' : 'OUT'}</div>
      <div class="sub">${esc(money(tb.debits))} debits · ${esc(money(tb.credits))} credits${tb.balances ? '' : ` · out by ${esc(money(tb.difference))}`}</div>
    </div>
    <div class="panel tile"><div class="panel-title">Revenue · ${esc(L.period)}</div><div class="big">${esc(money(is.totalRevenue))}</div><div class="sub">net ${esc(money(is.net))} · margin ${is.margin ?? '—'}%</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Expenses · ${esc(L.period)}</div><div class="big">${esc(money(is.totalExpenses))}</div><div class="sub"><a href="#/bookkeeper">the bookkeeper →</a></div></div>
    <div class="panel tile ${L.drafts ? 'tile-warn' : ''}">
      <div class="panel-title">Period</div>
      <div class="big">${esc(L.periodState)}</div>
      <div class="sub">${L.drafts} draft${L.drafts === 1 ? '' : 's'}${L.awaitingHuman ? ` · ${L.awaitingHuman} waiting for a person` : ''}</div>
    </div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title"><span>Balance sheet</span><span class="chip ${bs.balances ? 'chip-ok' : 'chip-bad'}">${bs.balances ? 'balances' : `OUT BY ${esc(money(bs.difference))}`}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody>
        <tr><td colspan="2" class="mono" style="color:var(--ink-dim)">ASSETS</td></tr>
        ${bs.assets.map(acct).join('')}
        <tr><td><strong>Total assets</strong></td><td class="num"><strong>${esc(money(bs.totalAssets))}</strong></td></tr>
        <tr><td colspan="2" class="mono" style="color:var(--ink-dim)">LIABILITIES</td></tr>
        ${bs.liabilities.map(acct).join('') || '<tr><td colspan="2" class="empty">none</td></tr>'}
        <tr><td colspan="2" class="mono" style="color:var(--ink-dim)">EQUITY</td></tr>
        ${bs.equity.map(acct).join('') || '<tr><td colspan="2" class="empty">none</td></tr>'}
        <tr><td><strong>Liabilities + equity</strong></td><td class="num"><strong>${esc(money(bs.totalLiabilities + bs.totalEquity))}</strong></td></tr>
      </tbody></table></div>
      <div class="map-legend">Profit not yet closed to retained earnings is folded into equity, which is why this balances mid-month rather than only after a close.</div>
    </div>

    <div class="panel">
      <div class="panel-title"><span>Chart of accounts</span><button class="btn btn-sm" id="led-add">Add account</button></div>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Balance</th></tr></thead>
      <tbody>${L.chart.map((a) => `<tr><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td><span class="chip chip-dim">${esc(a.type)}</span></td><td class="num">${esc(money(a.balance))}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>Journal · ${esc(L.period)}</span>
      <span><input id="led-q" class="input input-sm" placeholder="find an entry" aria-label="Search the journal" style="width:180px"> <button class="btn btn-sm" id="led-new">New entry</button></span>
    </div>
    <div id="led-journal"></div>
  </div>`;

  const drawJournal = async (term) => {
    const { entries } = await api(`/api/ledger/journal${term ? `?q=${encodeURIComponent(term)}` : ''}`);
    const row = (e) => `<tr>
        <td class="mono">${esc(e.ref)}</td>
        <td class="mono">${esc(e.entry_date)}</td>
        <td>${esc(e.memo)}${e.reversed_by_id ? ' <span class="chip chip-warn">reversed</span>' : ''}${e.state === 'draft' ? ' <span class="chip chip-warn">draft</span>' : ''}</td>
        <td class="mono" style="font-size:11px">${e.lines.map((l) => `${esc(l.account_code)} ${l.side === 'debit' ? 'Dr' : 'Cr'} ${esc(money(l.amount))}`).join('<br>')}</td>
        <td class="num">${esc(money(e.total))}</td>
        <td class="mono" style="font-size:11px">${esc(e.created_by)}</td>
        <td>${e.state === 'draft' ? `<button class="btn btn-sm" data-post="${e.id}">Post</button>` : (e.reversed_by_id ? '' : `<button class="btn btn-sm" data-rev="${e.id}">Reverse</button>`)}</td>
      </tr>`;
    $('#led-journal').innerHTML = entries.length
      ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Date</th><th>Memo</th><th>Lines</th><th class="num">Total</th><th>By</th><th></th></tr></thead><tbody>${entries.map(row).join('')}</tbody></table></div>`
      : '<div class="empty">no entries yet — the bookkeeper writes them as things happen</div>';

    view.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/ledger/journal/${b.dataset.post}/post`, { method: 'POST', body: {} }); toast('posted'); render(); }
      catch (e) { toast(e.message, true); }
    }));
    view.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      // Asked for, not optional: a correction whose reason nobody wrote down is
      // indistinguishable from an edit six months later.
      const reason = prompt('Why is this being reversed?');
      if (!reason) return;
      try { await api(`/api/ledger/journal/${b.dataset.rev}/reverse`, { method: 'POST', body: { reason } }); toast('reversed'); render(); }
      catch (e) { toast(e.message, true); }
    }));
  };
  await drawJournal('');
  let t;
  $('#led-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => drawJournal(e.target.value), 300); });

  $('#led-new').addEventListener('click', async () => {
    const memo = prompt('What is this entry for?'); if (!memo) return;
    const dr = prompt('Debit — account code then amount, e.g. 5100 250'); if (!dr) return;
    const cr = prompt('Credit — account code then amount, e.g. 1000 250'); if (!cr) return;
    const [da, dv] = dr.trim().split(/\s+/);
    const [ca, cv] = cr.trim().split(/\s+/);
    try {
      await api('/api/ledger/journal', { method: 'POST', body: {
        memo, source: 'manual', post: true,
        lines: [{ account: da, debit: Number(dv) }, { account: ca, credit: Number(cv) }],
      } });
      toast('posted'); render();
    } catch (e) { toast(e.message, true); }
  });
  $('#led-add').addEventListener('click', async () => {
    const code = prompt('Account code — four digits. 1xxx asset, 2xxx liability, 3xxx equity, 4xxx revenue, 5xxx expense'); if (!code) return;
    const name = prompt('What is it called?'); if (!name) return;
    const type = prompt('asset, liability, equity, revenue or expense'); if (!type) return;
    try { await api('/api/ledger/chart', { method: 'POST', body: { code, name, type } }); toast('added'); render(); }
    catch (e) { toast(e.message, true); }
  });
}
// The AI employees who keep the books, and the limit above which they stop.
export async function renderBookkeeper() {
  const b = await api('/api/bookkeeper');
  const rc = b.reconciliation;
  const finding = (f) => `<div style="padding:8px 0;border-bottom:1px solid var(--seam)">
        <div><strong>${esc(f.what)}</strong></div>
        <div class="sub">${esc(f.why || '')}${f.operational !== undefined ? ` — operational ${esc(money(f.operational))} against ledger ${esc(money(f.ledger))}` : ''}</div>
      </div>`;
  const waitingRow = (w) => `<tr><td class="mono">${esc(w.ref)}</td><td>${esc(w.memo)}</td><td class="num">${esc(money(w.total))}</td><td class="mono" style="font-size:11px">${esc(w.created_by)}</td><td><a class="btn btn-sm" href="#/ledger">View</a></td></tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Recorded</div><div class="big">${b.recorded}</div><div class="sub">events turned into entries</div></div>
    <div class="panel tile ${b.waiting.length ? 'tile-warn' : ''}"><div class="panel-title">Waiting for a person</div><div class="big">${b.waiting.length}</div><div class="sub">above the limit, so drafted not posted</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">The limit</div><div class="big">${esc(money(b.limitUsd))}</div><div class="sub">per entry, unattended</div></div>
    <div class="panel tile ${rc.ok ? '' : 'tile-warn'}"><div class="panel-title">Reconciliation</div><div class="big">${rc.ok ? 'clean' : rc.findings.length}</div><div class="sub">${rc.ok ? 'the books match what happened' : 'thing(s) to look at'}</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">What this means</div>
    <p class="lede">${esc(b.limitMeans)}. Nobody — person or agent — can post an entry that does not balance; the ledger refuses it. The limit is about attention, not arithmetic: an entry large enough to matter gets a person's eyes before it becomes part of the record.</p>
    <div style="margin-top:10px"><button class="btn" id="bk-sweep">Sweep now</button> <button class="btn" id="bk-close">Close ${esc(b.period)}</button></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Waiting for a signature</div>
      ${b.waiting.length
    ? `<div class="table-wrap"><table><thead><tr><th>Ref</th><th>Memo</th><th class="num">Total</th><th>Drafted by</th><th></th></tr></thead><tbody>${b.waiting.map(waitingRow).join('')}</tbody></table></div>`
    : '<div class="empty">nothing waiting</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">What the controller found</div>
      ${rc.findings.length ? rc.findings.map(finding).join('') : '<div class="empty">the ledger matches the operational tables</div>'}
      ${b.refused.length ? `<div class="panel-title" style="margin-top:12px">Events it could not book</div>${b.refused.map((r) => `<div class="meter-label"><span class="mono" style="font-size:11px">${esc(r.subject_id)}</span><span class="mono" style="font-size:11px">${esc(String(r.payload || '').slice(0, 80))}</span></div>`).join('')}` : ''}
    </div>
  </div>`;

  $('#bk-sweep').addEventListener('click', async () => {
    try { const r = await api('/api/bookkeeper/sweep', { method: 'POST', body: {} }); toast(`${r.made.length} entr(ies) written`); render(); }
    catch (e) { toast(e.message, true); }
  });
  $('#bk-close').addEventListener('click', async () => {
    if (!confirm(`Close ${b.period}? Nothing can be posted into a closed period afterwards.`)) return;
    try {
      const r = await api('/api/bookkeeper/close', { method: 'POST', body: { period: b.period } });
      toast(r.ok ? `${b.period} closed` : (r.blocking?.[0]?.what || 'not closed'), !r.ok);
      render();
    } catch (e) { toast(e.message, true); }
  });
}
// Does the workforce earn its keep. Cost is exact; revenue attributed to an
// agent is revenue its work touched — the page says so rather than implying it.
export async function renderEconomics() {
  const e = await api('/api/economics');
  const agent = (a) => `<tr>
      <td class="mono"><a href="#/agents">${esc(a.id)}</a></td>
      <td>${esc(a.name || '')}</td>
      <td class="num">${a.runs}</td>
      <td class="num">${a.delivered}</td>
      <td class="num">${esc(money4(a.cost))}</td>
      <td class="num">${a.wasteUsd > 0 ? `<span style="color:var(--warn)">${esc(money4(a.wasteUsd))}</span>` : '—'}</td>
      <td class="num">${a.revenueTouched ? esc(money(a.revenueTouched)) : '—'}</td>
      <td class="num">${a.touchedPerDollar ? `${a.touchedPerDollar}×` : '—'}</td>
    </tr>`;
  const cust = (c) => `<tr>
      <td>${esc(c.name)}</td>
      <td class="num">${esc(money(c.paid))}</td>
      <td class="num">${esc(money4(c.salesCost))}</td>
      <td class="num">${esc(money4(c.supportCost))}</td>
      <td class="num">${esc(money(c.netOfModelSpend))}</td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Cost per run</div><div class="big">${e.costPerRun !== null ? esc(money4(e.costPerRun)) : '—'}</div><div class="sub">${e.runs} run${e.runs === 1 ? '' : 's'} · ${e.delivered} delivered</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Cost per delivered</div><div class="big">${e.costPerDelivered !== null ? esc(money4(e.costPerDelivered)) : '—'}</div><div class="sub">what the failures make each success cost</div></div>
    <div class="panel tile ${e.failureWasteUsd > 0 ? 'tile-warn' : ''}"><div class="panel-title">Wasted on failures</div><div class="big">${esc(money4(e.failureWasteUsd))}</div><div class="sub">${e.failureRate}% of runs failed</div></div>
    <div class="panel tile"><div class="panel-title">Collected · ${esc(e.period)}</div><div class="big">${esc(money(e.revenueUsd))}</div><div class="sub">${e.invoicesPaid} invoice${e.invoicesPaid === 1 ? '' : 's'} paid</div></div>
  </div>

  <div class="panel">
    <div class="panel-title"><span>Does it pay for itself?</span>${e.fromLedger ? `<span class="chip ${e.ledgerAgrees ? 'chip-ok' : 'chip-warn'}">${e.ledgerAgrees ? 'the books agree' : 'the books disagree'}</span>` : ''}</div>
    <p class="lede">${esc(e.says)}</p>
    ${e.fromLedger ? `<div class="map-legend">From the ledger for ${esc(e.period)}: revenue ${esc(money(e.fromLedger.revenue))}, expenses ${esc(money(e.fromLedger.expenses))}, net ${esc(money(e.fromLedger.net))}${e.fromLedger.margin !== null ? ` · margin ${e.fromLedger.margin}%` : ''}. <a href="#/ledger">the books →</a></div>` : ''}
    <div class="map-legend">${esc(e.honestly)}</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title"><span>Cost per unit of work</span></div>
      <table><tbody>
        <tr><td>per model call</td><td class="num">${e.modelCalls ? esc(money4(e.spendUsd / e.modelCalls)) : '—'}</td></tr>
        <tr><td>per ticket</td><td class="num">${e.costPerTicket !== null ? esc(money4(e.costPerTicket)) : '—'}</td></tr>
        <tr><td>per deal won</td><td class="num">${e.costPerDealWon !== null ? esc(money4(e.costPerDealWon)) : '—'}</td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">By department</div>
      ${e.departments.length
    ? `<table><thead><tr><th>Department</th><th class="num">Runs</th><th class="num">Cost</th><th class="num">Touched</th></tr></thead><tbody>${e.departments.map((d) => `<tr><td>${esc(d.dept)}</td><td class="num">${d.runs}</td><td class="num">${esc(money4(d.cost))}</td><td class="num">${d.revenueTouched ? esc(money(d.revenueTouched)) : '—'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">no work yet this month</div>'}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title"><span>Every employee that did something</span><span class="chip chip-dim">${e.idleAgents} idle</span></div>
    ${e.agents.length
    ? `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Name</th><th class="num">Runs</th><th class="num">Delivered</th><th class="num">Cost</th><th class="num">Wasted</th><th class="num">Touched</th><th class="num">Per dollar</th></tr></thead><tbody>${e.agents.map(agent).join('')}</tbody></table></div>`
    : '<div class="empty">nobody has done anything this month</div>'}
  </div>

  <div class="panel">
    <div class="panel-title">What each customer costs to serve</div>
    ${e.customers.length
    ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th class="num">Paid</th><th class="num">Sales</th><th class="num">Support</th><th class="num">Net of model spend</th></tr></thead><tbody>${e.customers.map(cust).join('')}</tbody></table></div>
       <div class="map-legend">Only the model spend traceable to them. Infrastructure, people and everything else sit in <a href="#/ledger">the books</a>, not here.</div>`
    : '<div class="empty">no customers yet</div>'}
  </div>`;
}
export async function renderTax() {
  const d = await api('/api/tax');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Awaiting a person', d.awaitingPerson, 'unclassified, or drafted above the limit', d.awaitingPerson ? 'bad' : '')}
    ${tile('Held for authorities', money(d.owed), 'collected and not yet filed — never revenue')}
    ${tile('Registered in', d.registered, `of ${d.jurisdictions.length} jurisdiction(s) on file`)}
    ${tile('Lines', d.lines, 'each naming the event it came from')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What this department will not do</div>
    <div class="map-legend">${esc(d.note)} An employee may classify and post up to ${money(d.limitUsd)};
      above that it drafts and a person posts. Filing is always a human act, at any amount.</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Jurisdictions</div>
    ${d.jurisdictions.length ? `<table class="tbl"><thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Rate</th><th>Registered</th><th>Filing</th></tr></thead><tbody>
      ${d.jurisdictions.map((j) => `<tr><td class="mono">${esc(j.code)}</td><td>${esc(j.name)}</td><td>${esc(j.kind)}</td>
        <td>${j.rate}%</td><td>${j.registered ? 'yes' : '<span class="sub">no</span>'}</td><td>${esc(j.filing)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No jurisdiction on file. Nothing will be classified until one is — a rate nobody recorded is not a rate.</div>'}
    ${hasPermC('tax.classify') ? `<div class="form-inline" style="margin-top:10px">
      <div><label class="fl" for="tx-code">Code</label><input id="tx-code" placeholder="IQ"></div>
      <div><label class="fl" for="tx-name">Name</label><input id="tx-name" placeholder="Iraq"></div>
      <div><label class="fl" for="tx-rate">Rate %</label><input id="tx-rate" type="number" step="0.1" value="0"></div>
      <div><label class="fl" for="tx-reg">Registered</label><select id="tx-reg"><option value="0">no</option><option value="1">yes</option></select></div>
      <button class="btn" id="tx-add">Record</button>
    </div>` : ''}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Recent lines</div>
    ${d.recent.length ? `<table class="tbl"><thead><tr><th>Source</th><th>Where</th><th>Treatment</th><th>Basis</th><th>Amount</th><th>Why</th><th>State</th></tr></thead><tbody>
      ${d.recent.map((l) => `<tr>
        <td class="mono">${esc(l.source_kind)}#${esc(l.source_id)}</td><td class="mono">${esc(l.jurisdiction)}</td>
        <td>${l.treatment === 'unclassified' ? '<span class="pill bad">unclassified</span>' : esc(l.treatment)}</td>
        <td>${money(l.basis)}</td><td>${money(l.amount)}</td>
        <td class="sub">${esc(l.reason)}</td>
        <td>${esc(l.state)}${l.state === 'draft' && l.entry_id && hasPermC('tax.file') ? ` <button class="btn btn-sm" data-post="${l.id}">post</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing classified yet.</div>'}
    ${hasPermC('tax.classify') ? '<button class="btn" id="tx-sweep" style="margin-top:10px">Sweep unclassified invoices</button>' : ''}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Returns</div>
    ${d.returns.length ? `<table class="tbl"><thead><tr><th>Where</th><th>Period</th><th>Collected</th><th>Paid</th><th>Net</th><th>State</th></tr></thead><tbody>
      ${d.returns.map((r) => `<tr><td class="mono">${esc(r.jurisdiction)}</td><td>${esc(r.period_start)} → ${esc(r.period_end)}</td>
        <td>${money(r.collected)}</td><td>${money(r.paid)}</td><td><b>${money(r.net)}</b></td>
        <td>${esc(r.state)}${r.state === 'prepared' && hasPermC('tax.file') ? ` <button class="btn btn-sm" data-file="${r.id}">file</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No return prepared.</div>'}
  </div>`;
  $('#tx-add')?.addEventListener('click', async () => {
    try {
      await api('/api/tax/jurisdiction', { method: 'POST', body: {
        code: $('#tx-code').value, name: $('#tx-name').value,
        rate: Number($('#tx-rate').value), registered: Number($('#tx-reg').value),
      } });
      toast('Recorded'); renderTax();
    } catch (e) { toast(e.message, true); }
  });
  $('#tx-sweep')?.addEventListener('click', async () => {
    try { const r = await api('/api/tax/sweep', { method: 'POST', body: {} }); toast(`${r.classified} classified, ${r.awaitingPerson} for a person`); renderTax(); }
    catch (e) { toast(e.message, true); }
  });
  for (const b of view.querySelectorAll('[data-post]')) {
    b.addEventListener('click', async () => {
      try { await api(`/api/tax/line/${b.dataset.post}/post`, { method: 'POST', body: {} }); renderTax(); }
      catch (e) { toast(e.message, true); }
    });
  }
  for (const b of view.querySelectorAll('[data-file]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Filing is a statement to a tax authority in this company\'s name. Continue?')) return;
      try { await api(`/api/tax/return/${b.dataset.file}/file`, { method: 'POST', body: {} }); renderTax(); }
      catch (e) { toast(e.message, true); }
    });
  }
}
export async function renderPartnerships() {
  const d = await api('/api/partnerships');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Producing nothing', d.dormant.length, 'no deal, and quiet for 90 days', d.dormant.length ? 'bad' : '')}
    ${tile('Partners', d.total, `${d.active} active`)}
    ${tile('Producing', d.producing, 'have closed something')}
    ${tile('Through partners', money(d.valueUsd), 'value of deals they brought')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Not sales</div>
    <div class="map-legend">Sales asks whether they will buy. This asks whether anything actually flows through the
      relationship — and for most partnerships, most of the time, the honest answer is nothing, which is what this
      page is for. ${esc(d.note)}</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Partners</div>
    ${d.partners.length ? `<table class="tbl"><thead><tr><th>Name</th><th>Tier</th><th>State</th><th>Deals</th><th>Won</th><th>Value</th><th>Quiet for</th><th>Integration</th></tr></thead><tbody>
      ${d.partners.map((p) => `<tr class="${p.won === 0 && (p.daysQuiet === null || p.daysQuiet > 90) ? 'row-bad' : ''}">
        <td>${esc(p.name)}</td><td>${esc(p.tier)}</td><td>${esc(p.state)}</td>
        <td>${p.deals}</td><td>${p.won}</td><td>${money(p.valueUsd)}</td>
        <td>${p.daysQuiet === null ? 'never spoken' : `${p.daysQuiet}d`}</td>
        <td class="sub">${esc(p.integration || '—')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No partners. The table and the outreach drafting were already here — this page is the door.</div>'}
  </div>`;
}
export async function renderCustomers() {
  const [data, products, campaigns] = await Promise.all([api('/api/customers'), api('/api/products'), api('/api/campaigns')]);
  const s = data.stats;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR</div><div class="big">${esc(money(s.mrr))}</div><div class="sub">active recurring revenue</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Active</div><div class="big">${s.active || 0}</div><div class="sub">${s.trial || 0} trial · ${s.leads || 0} leads</div></div>
    <div class="panel tile tile-warn"><div class="panel-title">Churned</div><div class="big">${s.churned || 0}</div><div class="sub">exit reasons → Gate 10 pack</div></div>
    <div class="panel tile ${s.concentrationFlag ? 'tile-warn' : ''}"><div class="panel-title">Concentration</div><div class="big" style="font-size:22px;padding-top:8px">${s.concentrationFlag ? esc(short(s.concentrationFlag, 16)) : 'OK'}</div><div class="sub">${s.concentrationFlag ? '> 20% of MRR — flagged (Part 6 §7)' : 'no customer > 20% of MRR'}</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">New customer</div>
    <div class="form-inline">
      <div><label class="fl" for="cu-name">Name</label><input type="text" id="cu-name"></div>
      <div><label class="fl" for="cu-comp">Company</label><input type="text" id="cu-comp"></div>
      <div><label class="fl" for="cu-state">State</label><select id="cu-state" aria-label="State"><option>lead</option><option>trial</option><option>active</option></select></div>
      <div><label class="fl" for="cu-mrr">MRR $</label><input type="text" id="cu-mrr" value="0"></div>
      <div><label class="fl" for="cu-prod">Product</label><select id="cu-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="cu-camp">Campaign</label><select id="cu-camp" aria-label="Campaign"><option value="">—</option>${campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="cu-go">Add</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Book of customers</div>
    <table>
      <thead><tr><th>Customer</th><th>Plan</th><th>State</th><th class="num">MRR</th><th>Links</th><th>Actions</th></tr></thead>
      <tbody>${data.items.map((c) => `
        <tr>
          <td><b>${esc(c.name)}</b>${c.company ? ` <span class="mono" style="color:var(--ink-faint)">· ${esc(c.company)}</span>` : ''}</td>
          <td class="mono">${esc(c.plan)}</td>
          <td><span class="state state-${c.state === 'active' ? 'done' : c.state === 'churned' ? 'failed' : 'awaiting_human'}">${esc(c.state)}</span></td>
          <td class="num">${esc(money(c.mrr_usd))}</td>
          <td>${c.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(c.product_id)}</a>` : ''}
              ${c.campaign_id ? `<a class="chip chip-dim" style="text-decoration:none" href="#/marketing">campaign #${c.campaign_id}</a>` : ''}
              ${c.tickets.length ? `<a class="chip chip-warn" style="text-decoration:none" href="#/support">✉ ${c.tickets.length} tickets</a>` : ''}</td>
          <td>${connBtn('customer', c.id)}
            ${c.state !== 'churned' ? `
            ${c.state !== 'active' ? `<button class="btn btn-sm btn-ok" data-custate="${c.id}" data-to="active">Activate</button>` : ''}
            <button class="btn btn-sm btn-bad" data-custate="${c.id}" data-to="churned">Churn</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No customers yet — marketing feeds this table.</td></tr>'}
      </tbody>
    </table>
  </div>`;

  $('#cu-go').addEventListener('click', async () => {
    try {
      await api('/api/customers', { method: 'POST', body: { name: $('#cu-name').value, company: $('#cu-comp').value || null, state: $('#cu-state').value, mrrUsd: Number($('#cu-mrr').value) || 0, productId: $('#cu-prod').value || null, campaignId: $('#cu-camp').value ? Number($('#cu-camp').value) : null, actor: actor() } });
      renderCustomers();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-custate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/customers/${b.dataset.custate}/update`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderCustomers(); } catch (e) { toast(e.message, true); }
  }));
  wireConnections();
}
export async function renderFinance() {
  const fin = await api('/api/finance');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR</div><div class="big">${esc(money(fin.commercial.mrrUsd))}</div><div class="sub"><a href="#/customers">${fin.commercial.newActiveCustomers} new active · ${fin.commercial.churnedThisMonth} churned</a></div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Model spend · ${esc(fin.month)}</div><div class="big">${esc(money4(fin.totalCostUsd))}</div><div class="sub">${fin.capConsumedPct.toFixed(1)}% of ${esc(money(fin.capUsd))} cap · <a href="#/budgets">budgets →</a></div></div>
    <div class="panel tile tile-warn"><div class="panel-title">Monthly burn</div><div class="big">${esc(money(fin.commercial.monthlyBurnUsd))}</div><div class="sub"><a href="#/vendors">vendors ${esc(money(fin.commercial.vendorBurnUsd))}</a> + models</div></div>
    <div class="panel tile"><div class="panel-title">Cash CAC</div><div class="big">${fin.commercial.cashCacUsd !== null ? esc(money(fin.commercial.cashCacUsd)) : '—'}</div><div class="sub">flattering — founder labor uncosted (P6 §6.3)</div></div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Spend by provider · subscription served ${fin.subscription.calls} calls at $0</div>
      <table><thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Tok in</th><th class="num">Tok out</th><th class="num">Cost</th></tr></thead>
      <tbody>${fin.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td><td class="num">${p.tin}</td><td class="num">${p.tout}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title"><span>Runs by agent</span><button class="btn btn-sm" id="fin-exp">Export pack (.md)</button></div>
      <table><thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Done</th><th class="num">Failed</th><th class="num">Cost</th></tr></thead>
      <tbody>${fin.byAgent.map((a) => `<tr><td class="mono">${esc(a.agent_id)}</td><td class="num">${a.runs}</td><td class="num">${a.done}</td><td class="num">${a.failed}</td><td class="num">${esc(money4(a.cost))}</td></tr>`).join('')}</tbody></table>
      <div class="map-legend">governance pool: ${esc(money4(fin.governanceUsd))} (${fin.governancePctOfSpend.toFixed(1)}% of spend · rule ≤5%) · activity: ${fin.activity.pipelines} pipelines / ${fin.activity.decisions} decisions / ${fin.activity.ticketsSent} tickets sent</div>
    </div>
  </div>`;
  $('#fin-exp').addEventListener('click', async () => {
    try { const r = await api('/api/finance/export', { method: 'POST', body: {} }); toast(`Exported ${r.path} — see Artifacts + Archive`); } catch (e) { toast(e.message, true); }
  });
}
// ---------- Relations (RM) ----------
export async function renderRelations() {
  const [ov, partners] = await Promise.all([api('/api/relations'), api('/api/partners')]);
  const canM = hasPermC('relations.manage');
  const health = (h) => '●'.repeat(h) + '○'.repeat(5 - h);
  const kindChip = (k) => ({ partner: 'chip-steel', investor: 'chip-ember', government: 'chip-warn', media: 'chip-dim', community: 'chip-ok', strategic: 'chip-bad' }[k] || 'chip-dim');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Active relationships</div><div class="big">${ov.active}</div><div class="sub">${ov.prospects} prospects · avg health ${ov.avgHealth ? Number(ov.avgHealth).toFixed(1) : '—'}/5</div></div>
    <div class="panel tile ${ov.overdue.length ? 'tile-warn' : ''}"><div class="panel-title">Overdue follow-ups</div><div class="big">${ov.overdue.length}</div><div class="sub">next actions past their date</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Coming up · 14d</div><div class="big">${ov.upcoming.length}</div><div class="sub">scheduled next actions</div></div>
    <div class="panel tile ${ov.stale.length ? 'tile-warn' : ''}"><div class="panel-title">Gone quiet · 30d+</div><div class="big">${ov.stale.length}</div><div class="sub">active but untouched</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">New relationship — partners, investors, government, media, community</div>
    <div class="form-inline">
      <div style="flex:1.6"><label class="fl" for="pr-name">Name</label><input type="text" id="pr-name"></div>
      <div><label class="fl" for="pr-kind">Kind</label><select id="pr-kind" aria-label="Kind"><option>partner</option><option>investor</option><option>government</option><option>media</option><option>community</option><option>strategic</option></select></div>
      <div><label class="fl" for="pr-tier">Tier</label><select id="pr-tier" aria-label="Tier"><option>standard</option><option>key</option><option>strategic</option></select></div>
      <div><label class="fl" for="pr-owner">Owner</label><input type="text" id="pr-owner" value="${esc(currentUser?.username || '')}"></div>
      <button class="btn btn-primary" id="pr-go">Add</button>
    </div>
    <div><label class="fl" for="pr-notes">Notes</label><input type="text" id="pr-notes" placeholder="context, who introduced, what they want"></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Relationship register — the RM agent drafts, a human always sends</div>
    <table>
      <thead><tr><th>Name</th><th>Kind · tier</th><th>Health</th><th>Last touch</th><th>Next action</th><th>State</th>${canM ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${partners.map((p) => `
        <tr style="${p.state === 'ended' ? 'opacity:.45' : ''}">
          <td><b>${esc(p.name)}</b><div class="map-legend">${esc(short(p.notes || '', 60))}</div>
            ${p.draft ? `<div class="round" style="margin-top:6px"><div class="round-body">
              <div class="map-legend" style="color:var(--ember)">AI outreach draft — review, then send it yourself:</div>
              <div style="font-size:12px;margin:4px 0">${esc(short(p.draft, 280))}</div>
              ${canM ? `<button class="btn btn-sm btn-ok" data-pr-send="${p.id}">Mark sent (by me)</button>` : ''}
            </div></div>` : ''}</td>
          <td><span class="chip ${kindChip(p.kind)}">${esc(p.kind)}</span> <span class="chip chip-dim">${esc(p.tier)}</span></td>
          <td class="mono" style="color:${p.health >= 4 ? 'var(--ok)' : p.health <= 2 ? 'var(--bad)' : 'var(--warn)'}" title="relationship health ${p.health}/5">${health(p.health)}</td>
          <td class="mono" style="color:var(--ink-faint)">${p.lastTouch ? `${esc(p.lastTouch.created_at.slice(0, 10))} · ${esc(p.lastTouch.kind)}` : 'never'} · ${p.touches}×</td>
          <td>${p.nextAction ? `${esc(short(p.nextAction.next_action, 34))} <span class="mono" style="color:${p.nextAction.next_date && p.nextAction.next_date < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(p.nextAction.next_date || '')}</span>` : '—'}</td>
          <td><span class="state state-${p.state === 'active' ? 'done' : p.state === 'ended' ? 'failed' : 'queued'}">${esc(p.state)}</span></td>
          ${canM ? `<td>
            ${connBtn('partner', p.id)}
            <button class="btn btn-sm" data-pr-log="${p.id}" data-pr-name="${esc(p.name)}">Log</button>
            <button class="btn btn-sm" data-pr-draft="${p.id}" ${p.draft_run_id && !p.draft ? 'disabled' : ''}>${p.draft_run_id && !p.draft ? 'drafting…' : 'AI outreach'}</button>
            ${['prospect', 'dormant'].includes(p.state) ? `<button class="btn btn-sm btn-ok" data-pr-state="${p.id}" data-to="active">activate</button>` : ''}
            ${p.state === 'active' ? `<button class="btn btn-sm" data-pr-state="${p.id}" data-to="dormant">dormant</button>` : ''}
            ${[1, 2, 3, 4, 5].map((h) => `<button class="btn btn-sm" data-pr-health="${p.id}" data-h="${h}" title="set health ${h}/5" style="padding:2px 6px;${p.health === h ? 'color:var(--ember)' : ''}">${h}</button>`).join('')}
          </td>` : ''}
        </tr>`).join('') || `<tr><td colspan="7" class="empty">No relationships yet${canM ? ' — add the first one above' : ''}.</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Follow-ups</div>
      ${[...ov.overdue.map((u) => ({ ...u, od: true })), ...ov.upcoming].map((u) => `
        <div class="round"><div class="round-body" style="display:flex;justify-content:space-between">
          <span>${esc(u.name)} — ${esc(short(u.next_action, 60))}</span>
          <span class="mono" style="color:${u.od ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(u.next_date)}</span>
        </div></div>`).join('') || '<div class="empty">Nothing scheduled.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Recent interactions</div>
      ${ov.recent.map((i) => `
        <div class="round"><div class="round-body">
          <span class="chip chip-dim">${esc(i.kind)}</span> <b>${esc(i.partner_name || (i.customer_id ? 'customer #' + i.customer_id : i.vendor_id || ''))}</b>
          — ${esc(short(i.summary, 90))}
          <span class="mono" style="color:var(--ink-faint);float:right">${esc(i.created_at.slice(0, 16))}</span>
        </div></div>`).join('') || '<div class="empty">No interactions logged.</div>'}
    </div>
  </div>`;
  wireConnections();
  if (!canM) return;
  $('#pr-go')?.addEventListener('click', async () => {
    try {
      await api('/api/partners', { method: 'POST', body: { name: $('#pr-name').value, kind: $('#pr-kind').value, tier: $('#pr-tier').value, owner: $('#pr-owner').value, notes: $('#pr-notes').value || null } });
      toast('Relationship added'); renderRelations();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-pr-log]').forEach((b) => b.addEventListener('click', async () => {
    const summary = prompt(`Log an interaction with ${b.dataset.prName} — what happened?`);
    if (!summary) return;
    const nextAction = prompt('Next action (optional):') || null;
    const nextDate = nextAction ? (prompt('Next action date (YYYY-MM-DD, optional):') || null) : null;
    try { await api('/api/interactions', { method: 'POST', body: { partnerId: Number(b.dataset.prLog), kind: 'note', summary, nextAction, nextDate } }); toast('Logged'); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-draft]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prDraft}/outreach`, { method: 'POST', body: {} }); toast('RM agent is drafting — the draft lands on the card'); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-send]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prSend}/send`, { method: 'POST', body: {} }); toast(`Outreach recorded as sent by ${actor()}`); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-state]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prState}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderRelations(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-health]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prHealth}/health`, { method: 'POST', body: { health: Number(b.dataset.h) } }); renderRelations(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Sales — deals pipeline ----------
export async function renderSales() {
  const [ov, products, partners] = await Promise.all([
    api('/api/deals'), api('/api/products').catch(() => []), api('/api/partners').catch(() => []),
  ]);
  const canM = hasPermC('sales.manage');
  const stChip = (s2) => `<span class="state state-${s2 === 'won' ? 'done' : s2 === 'lost' ? 'failed' : s2 === 'proposal' ? 'awaiting_human' : s2 === 'qualified' ? 'running' : 'queued'}">${esc(s2)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Open pipeline</div><div class="big">${esc(money(ov.openValue))}</div><div class="sub">${ov.pipeline.lead.n + ov.pipeline.qualified.n + ov.pipeline.proposal.n} deals in motion</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Won</div><div class="big">${esc(money(ov.wonValue))}</div><div class="sub">${ov.pipeline.won.n} deals → <a href="#/customers">customers</a> (auto)</div></div>
    <div class="panel tile"><div class="panel-title">At proposal</div><div class="big">${ov.pipeline.proposal.n}</div><div class="sub">${esc(money(ov.pipeline.proposal.value))} — AI drafts, you send</div></div>
    <div class="panel tile ${ov.pipeline.lost.n ? 'tile-warn' : ''}"><div class="panel-title">Lost</div><div class="big">${ov.pipeline.lost.n}</div><div class="sub">reasons live in the notes</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">New deal — reaching “proposal” auto-briefs the Sales agent; winning auto-creates the customer</div>
    <div class="form-inline">
      <div style="flex:1.8"><label class="fl" for="dl-name">Deal name</label><input type="text" id="dl-name" placeholder="e.g. Basra Oil Co — pilot"></div>
      <div style="flex:0.6"><label class="fl" for="dl-value">Value $/yr</label><input type="text" id="dl-value" value="0"></div>
      <div><label class="fl" for="dl-prod">Product</label><select id="dl-prod" aria-label="Product"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl" for="dl-partner">Partner</label><select id="dl-partner" aria-label="Partner"><option value="">—</option>${partners.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="dl-go">Open deal</button>
    </div>
    <div><label class="fl" for="dl-notes">Notes</label><input type="text" id="dl-notes" placeholder="who, why now, what they need"></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Pipeline — lead → qualified → proposal → won/lost</div>
    <table>
      <thead><tr><th>Deal</th><th class="num">Value</th><th>Stage</th><th>Links</th><th>Owner</th><th>Move</th></tr></thead>
      <tbody>${ov.deals.map((d) => `
        <tr style="${d.stage === 'lost' ? 'opacity:.45' : ''}">
          <td><b>${esc(d.name)}</b>${d.notes ? `<div class="map-legend">${esc(short(d.notes, 60))}</div>` : ''}
            ${d.proposal ? `<div class="round" style="margin-top:6px"><div class="round-body">
              <div class="map-legend" style="color:var(--ember)">AI proposal draft — you send and sign:</div>
              <div style="font-size:12px">${esc(short(d.proposal, 240))}</div></div></div>` : d.draft_run_id ? '<div class="map-legend">proposal drafting…</div>' : ''}</td>
          <td class="num">${esc(money(d.value_usd))}</td>
          <td>${stChip(d.stage)}</td>
          <td>${d.customer ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">👤 ${esc(d.customer.name)}</a>` : ''}
              ${d.partner ? `<a class="chip chip-steel" style="text-decoration:none" href="#/relations">🤝 ${esc(d.partner.name)}</a>` : ''}
              ${d.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(d.product_id)}</a>` : ''}</td>
          <td class="mono">${esc(d.owner)}</td>
          <td>${connBtn('deal', d.id)}
            ${canM ? `${['lead', 'qualified', 'proposal', 'won', 'lost'].filter((s2) => s2 !== d.stage && !['won', 'lost'].includes(d.stage)).map((s2) => `<button class="btn btn-sm ${s2 === 'won' ? 'btn-ok' : s2 === 'lost' ? 'btn-bad' : ''}" data-dl="${d.id}" data-to="${s2}">${s2}</button>`).join(' ')}
            ${!d.proposal && !d.draft_run_id && !['won', 'lost'].includes(d.stage) ? `<button class="btn btn-sm" data-dl-prop="${d.id}">AI proposal</button>` : ''}` : ''}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty">No deals yet${canM ? ' — open the first one above' : ''}.</td></tr>`}
      </tbody>
    </table>
  </div>`;
  wireConnections();
  if (!canM) return;
  $('#dl-go')?.addEventListener('click', async () => {
    try {
      await api('/api/deals', { method: 'POST', body: { name: $('#dl-name').value, valueUsd: Number($('#dl-value').value) || 0, productId: $('#dl-prod').value || null, partnerId: $('#dl-partner').value ? Number($('#dl-partner').value) : null, notes: $('#dl-notes').value || null } });
      toast('Deal opened'); renderSales();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/deals/${b.dataset.dl}/stage`, { method: 'POST', body: { stage: b.dataset.to } }); toast(`Deal → ${b.dataset.to}`); renderSales(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-dl-prop]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/deals/${b.dataset.dlProp}/proposal`, { method: 'POST', body: {} }); toast('Sales agent drafting the proposal'); renderSales(); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Financial Reports ----------
export async function renderFinReports() {
  const [{ overview, reports }, ledger] = await Promise.all([
    api('/api/finreports'), api('/api/finreports/ledger').catch(() => null),
  ]);
  const canM = hasPermC('finreports.manage');
  const l = overview.live;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR / ARR</div><div class="big">${esc(money(l.mrrUsd))}</div><div class="sub">${esc(money(l.arrUsd))} annualised</div></div>
    <div class="panel tile ${l.netUsd < 0 ? 'tile-warn' : 'tile-steel'}"><div class="panel-title">Net this month</div><div class="big">${esc(money(l.netUsd))}</div><div class="sub">${esc(money(l.monthlyCostUsd))} total cost</div></div>
    <div class="panel tile"><div class="panel-title">Pipeline</div><div class="big">${esc(money(l.pipelineUsd))}</div><div class="sub">open deals · <a href="#/sales">sales →</a></div></div>
    <div class="panel tile"><div class="panel-title">Reports</div><div class="big">${overview.ready}<span class="unit">/${overview.total}</span></div><div class="sub">${overview.drafting} in preparation</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">Prepare a financial document — internal ones are built on the live ledger, not on guesses</div>
    <div class="form-inline">
      <div style="flex:1.6"><label class="fl" for="fr-kind">Document</label><select id="fr-kind" aria-label="Kind">${overview.kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}${k.internal ? '' : ' — external company'}</option>`).join('')}</select></div>
      <div><label class="fl" for="fr-period">Period</label><input type="text" id="fr-period" placeholder="${new Date().toISOString().slice(0, 7)}"></div>
      <div style="flex:1.2"><label class="fl" for="fr-subject">Company (research only)</label><input type="text" id="fr-subject" placeholder="e.g. Basra Oil Company"></div>
      <button class="btn btn-primary" id="fr-go">Prepare</button>
    </div>
    <div class="map-legend">Internal statements are fed the platform's real ledgers — model spend by provider and agent, customer MRR, vendor burn, campaign spend, deal pipeline — so the analyst reports the actual numbers. External research is training knowledge and every figure is labelled <b>[Unverified]</b> with its period.</div>
  </div>` : ''}
  ${ledger ? `<div class="panel">
    <div class="panel-title">Live ledger — ${esc(ledger.period)} · this is what internal reports are built from</div>
    <div class="grid grid-2">
      <table><tbody>
        <tr><td>Recurring revenue (MRR)</td><td class="num">${esc(money(ledger.revenue.mrrUsd))}</td></tr>
        <tr><td>Deals won (all time)</td><td class="num">${esc(money(ledger.revenue.dealsWonUsd))}</td></tr>
        <tr><td>Open pipeline</td><td class="num">${esc(money(ledger.revenue.pipelineUsd))}</td></tr>
        <tr><td>Model spend this month</td><td class="num">${esc(money(ledger.costs.modelSpendUsd))}</td></tr>
        <tr><td>Vendor burn</td><td class="num">${esc(money(ledger.costs.vendorBurnUsd))}</td></tr>
        <tr><td>Marketing spent</td><td class="num">${esc(money(ledger.costs.marketingSpentUsd))}</td></tr>
        <tr><td><b>Net</b></td><td class="num"><b>${esc(money(ledger.net.grossUsd))}</b></td></tr>
      </tbody></table>
      <table><thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead><tbody>
        ${ledger.costs.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No model calls yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>` : ''}
  ${reports.map((r) => `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(r.title)}</b> <span class="chip chip-dim">${esc(r.kind)}</span>
        ${r.subject !== 'own' ? `<span class="chip chip-warn">external · unverified</span>` : '<span class="chip chip-ok">from live ledger</span>'}
        <span class="state state-${['ready', 'approved'].includes(r.state) ? 'done' : r.state === 'failed' ? 'failed' : 'running'}">${esc(r.state)}</span></span>
      <span>
        ${r.content ? `<button class="btn btn-sm" data-download="/api/finreports/${r.id}/export" data-filename="${esc(r.kind)}-${esc(r.period)}.md">⬇ Markdown</button>` : ''}
        ${canM && r.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-frapprove="${r.id}">Approve</button>` : ''}
        ${connBtn('finReport', r.id)}
      </span>
    </div>
    <div class="map-legend">period ${esc(r.period || '—')}${r.approved_by ? ` · approved by ${esc(r.approved_by)}` : ''}${r.hasInputs ? ' · built on real figures' : ''}</div>
    ${(r.flags || []).length ? `<div class="reason">⚑ ${r.flags.map(esc).join(' · ')}</div>` : ''}
    ${r.content ? `<details style="margin-top:8px"><summary class="map-legend" style="cursor:pointer">read the report</summary><pre class="json" style="max-height:60vh;white-space:pre-wrap">${esc(r.content)}</pre></details>`
      : `<div class="empty">${r.state === 'drafting' ? 'The financial analyst is preparing this…' : 'No content.'}</div>`}
  </div>`).join('')}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#fr-go')?.addEventListener('click', async () => {
    try {
      await api('/api/finreports', { method: 'POST', body: { kind: $('#fr-kind').value, period: $('#fr-period').value || null, subject: $('#fr-subject').value || 'own' } });
      toast('Financial analyst is preparing the document'); renderFinReports();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-frapprove]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/finreports/${b.dataset.frapprove}/approve`, { method: 'POST', body: {} }); toast('Approved and archived'); renderFinReports(); }
    catch (e) { toast(e.message, true); }
  }));
}
// ---------- Revenue loop ----------
export async function renderRevenue() {
  const d = await api('/api/revenue');
  const canM = hasPermC('revenue.manage');
  const canInv = hasPermC('revenue.invoice');
  const max = Math.max(...d.funnel.map((f) => f.count), 1);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Deals moving', d.counts.inFlight, 'somewhere on the path')}
    ${tile('Value in flight', `${Number(d.counts.valueInFlight).toLocaleString()}`, 'not yet collected')}
    ${tile('Collected', `${Number(d.counts.collected).toLocaleString()}`, 'paid or delivered', d.counts.collected ? 'tile-ok' : '')}
    ${tile('Waiting on a person', d.waitingOnAPerson.length, 'signing and money never happen alone', d.waitingOnAPerson.length ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title">The path — a name on a list to money in the account</div>
    <div class="fn-bars" style="display:flex;gap:6px;align-items:flex-end;margin:16px 0 8px">
      ${d.funnel.map((f, i) => `
        <div style="flex:1;text-align:center">
          <div class="mono" style="font-size:18px;color:${f.count ? 'var(--ember)' : 'var(--ink-faint)'}">${f.count}</div>
          <div style="height:${8 + (f.count / max) * 90}px;background:linear-gradient(180deg,var(--ember),transparent);border-radius:4px 4px 0 0;opacity:${f.count ? 0.85 : 0.15}"></div>
          <div class="sub" style="font-size:10px;margin-top:4px">${esc(f.stage)}</div>
          ${d.conversion[i]?.fromPrevious !== null && d.conversion[i]?.fromPrevious !== undefined ? `<div class="sub mono" style="font-size:9px">${d.conversion[i].fromPrevious}%</div>` : ''}
        </div>`).join('')}
    </div>
    <div class="map-legend">Every hop that touches somebody outside goes through the gate, so it obeys the allowlist, the quota and the constitution. The two hops that cannot be undone — agreeing and taking money — stop for a person. The loop runs itself right up to the moment somebody is genuinely needed, and then waits.</div>
    ${canM ? `<div class="form-inline">${xbtn('/api/revenue/source', { limit: 3 }, 'Source new deals from intelligence', 'btn-primary')} ${xbtn('/api/revenue/tick', {}, 'Move everything that can move')}</div>` : ''}
  </div>

  <div class="panel">
    <div class="panel-title">Deals</div>
    <table><thead><tr><th>#</th><th>Who</th><th>Stage</th><th>Value</th><th>Owner</th><th></th></tr></thead><tbody>
    ${d.deals.map((x) => `<tr><td class="mono">${x.id}</td><td><b>${esc(x.name)}</b></td>
      <td><span class="chip ${['paid', 'delivered'].includes(x.stage) ? 'chip-ok' : ['proposal', 'agreed'].includes(x.stage) ? 'chip-warn' : 'chip-dim'}">${esc(x.stage || 'sourced')}</span></td>
      <td class="num mono">${x.value_usd ? `${Number(x.value_usd).toLocaleString()}` : '—'}</td>
      <td class="mono sub">${esc(x.owner || '—')}</td>
      <td>
        ${canM ? `<button class="btn btn-sm" data-outreach="${x.id}">Send the approach</button>` : ''}
        ${canInv && ['proposal', 'agreed'].includes(x.stage) ? `<button class="btn btn-sm btn-primary" data-invoice="${x.id}">Invoice</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="empty">No deals yet — source some from intelligence.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Recent moves</div>
    <table><tbody>
    ${d.recentMoves.map((m) => `<tr><td class="mono">deal ${m.deal}</td>
      <td class="mono sub">${esc(m.payload.from)} → <b>${esc(m.payload.to)}</b></td>
      <td class="mono sub">${esc(String(m.occurred_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td class="empty">Nothing has moved yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderRevenue);
  view.querySelectorAll('[data-outreach]').forEach((b) => b.addEventListener('click', async () => {
    const to = prompt('Send the drafted approach to which address?');
    if (!to) return;
    try {
      const r = await api(`/api/revenue/${b.dataset.outreach}/outreach`, { method: 'POST', body: { to } });
      toast(`${r.verdict}${r.why ? ` — ${r.why}` : ''}`, r.verdict === 'blocked');
      renderRevenue();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-invoice]').forEach((b) => b.addEventListener('click', async () => {
    const amount = prompt('Invoice how much, in dollars?');
    if (!amount) return;
    try { await api(`/api/revenue/${b.dataset.invoice}/invoice`, { method: 'POST', body: { amountUsd: Number(amount) } }); toast('Invoiced'); renderRevenue(); }
    catch (e) { toast(e.message, true); }
  }));
}


// ===========================================================================
// THE PLATFORM — many companies, a programmatic surface, installable
// departments, and the rhythm that runs all of it without anybody present.
// ===========================================================================
export async function renderProcurement() {
  const [rows, vendors] = await Promise.all([api('/api/procurement'), api('/api/vendors').catch(() => [])]);
  const canM = hasPermC('procurement.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Purchase requests — human approval before money moves</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="pu-item" placeholder="item" style="width:220px">
      <input id="pu-amt" type="number" placeholder="USD" style="width:90px">
      <select id="pu-vendor" aria-label="Vendor" style="width:auto"><option value="">— vendor —</option>${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      <input id="pu-why" placeholder="justification" style="width:260px">
      <button class="btn btn-sm btn-primary" id="pu-go">Request</button></div>` : ''}
    <table><thead><tr><th>#</th><th>Item</th><th class="num">USD</th><th>Vendor</th><th>State</th><th>By / Approver</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr>
      <td class="mono">${p.id}</td><td>${esc(p.item)}${p.justification ? `<div class="map-legend">${esc(p.justification)}</div>` : ''}</td>
      <td class="num mono">$${p.amount_usd}</td><td>${esc(p.vendor_name || '—')}</td>
      <td><span class="chip ${p.state === 'approved' || p.state === 'ordered' ? 'chip-ok' : p.state === 'rejected' ? 'chip-bad' : 'chip-warn'}">${esc(p.state)}</span></td>
      <td class="mono" style="font-size:10px">${esc(p.created_by)}${p.approver ? ` → ${esc(p.approver)}` : ''}</td>
      <td>${canM && p.state === 'requested' ? xbtn(`/api/procurement/${p.id}/resolve`, { state: 'approved' }, 'Approve', 'btn-ok') + xbtn(`/api/procurement/${p.id}/resolve`, { state: 'rejected' }, 'Reject', 'btn-bad') : ''}
          ${canM && p.state === 'approved' ? xbtn(`/api/procurement/${p.id}/resolve`, { state: 'ordered' }, 'Mark ordered') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No purchase requests yet.</td></tr>'}
    </tbody></table></div>`;
  wireXact(renderProcurement);
  $('#pu-go')?.addEventListener('click', async () => {
    try {
      await api('/api/procurement', { method: 'POST', body: { item: $('#pu-item').value, amountUsd: Number($('#pu-amt').value) || 0, vendorId: $('#pu-vendor').value || null, justification: $('#pu-why').value || null } });
      toast('Requested'); renderProcurement();
    } catch (e) { toast(e.message, true); }
  });
}
export async function renderFinops() {
  const d = await api('/api/finops');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Wasted spend', `$${d.wasted.usd}`, `inside ${d.wasted.runs} failed/cancelled runs`, d.wasted.usd > 0 ? 'tile-warn' : '')}
    ${tile('Transport retries', d.retries, 'failed calls that were retried')}
    ${tile('Metered employees', d.byAgent.length, 'agents with recorded spend')}
    ${tile('Costliest', d.byAgent[0] ? esc(d.byAgent[0].agent_id) : '—', d.byAgent[0] ? `$${d.byAgent[0].usd}` : '')}
  </div>
  <div class="panel"><div class="panel-title">Cost per employee</div>
    <table><thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Tokens</th><th class="num">USD</th></tr></thead><tbody>
    ${d.byAgent.map((a) => `<tr><td class="mono">${esc(a.agent_id)}</td><td class="num mono">${a.runs}</td><td class="num mono">${a.tokens}</td><td class="num mono">$${a.usd}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No metered spend yet.</td></tr>'}
    </tbody></table></div>
  <div class="panel"><div class="panel-title">Recommendations</div>
    ${d.recommendations.map((r) => `<div class="map-legend">— ${esc(r)}</div>`).join('')}</div>`;
}
// ---------- Money desk ----------
export async function renderMoney() {
  const d = await api('/api/money');
  const canM = hasPermC('money.manage');
  const p = d.policy;
  const pos = d.position;
  const maxSpend = Math.max(...d.history.map((h) => h.spend), 0.0001);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Runway', pos.runwayMonths === null ? '∞' : `${pos.runwayMonths}<span class="unit">mo</span>`, `floor is ${p.min_runway_mo} months`, pos.runwayMonths !== null && pos.runwayMonths < p.min_runway_mo ? 'tile-bad' : 'tile-steel')}
    ${tile('Recurring revenue', money(pos.recurringUsd), 'active customers, per month')}
    ${tile('Monthly burn', money(pos.burnMonthlyUsd), `models ${money(pos.modelMonthUsd)} · vendors ${money(pos.vendorMonthlyUsd)}`, pos.burnMonthlyUsd > pos.recurringUsd ? 'tile-warn' : '')}
    ${tile('Committed', money(pos.committedUsd), `pipeline ${money(pos.pipelineUsd)} · payouts pending ${pos.payoutsPending}`)}
  </div>

  <div class="panel">
    <div class="panel-title">What the desk is telling you</div>
    ${d.alerts.map((a) => `<div class="map-legend" style="color:${a.level === 'crit' ? 'var(--bad)' : a.level === 'warn' ? 'var(--warn)' : 'var(--ink-mute)'}">
      ${a.level === 'crit' ? '⛔' : a.level === 'warn' ? '⚠' : '✓'} ${esc(a.text)}</div>`).join('')}
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Allocation policy — what the company promised itself</div>
      <table><thead><tr><th>Bucket</th><th class="num">Policy</th><th class="num">Target</th><th class="num">Allocated</th></tr></thead><tbody>
      ${d.buckets.map((b) => `<tr>
        <td><b>${esc(b.id)}</b><div class="map-legend">${esc(b.why)}</div></td>
        <td class="num mono">${b.pct}%</td><td class="num mono">${money(b.target)}</td><td class="num mono">${money(b.allocated)}</td>
      </tr>`).join('')}
      </tbody></table>
      ${canM ? `<div class="form-inline" style="margin-top:10px">
        <input id="m-res" aria-label="Reserve" type="number" value="${p.reserve_pct}" style="width:80px" title="reserve %">
        <input id="m-opex" aria-label="Operating spend" type="number" value="${p.opex_pct}" style="width:80px" title="opex %">
        <input id="m-grow" aria-label="Growth" type="number" value="${p.growth_pct}" style="width:80px" title="growth %">
        <input id="m-run" aria-label="Runway" type="number" value="${p.min_runway_mo}" style="width:80px" title="min runway months">
        <button class="btn btn-sm btn-primary" id="m-set">Set policy</button>
      </div><div class="map-legend">reserve · opex · growth must add up to 100</div>` : ''}
    </div>
    <div class="panel">
      <div class="panel-title">Crypto received</div>
      <table><tbody>${d.position.cryptoReceived.map((c) => `<tr><td class="mono">${esc(c.asset)}</td><td class="num mono">${c.total}</td><td class="num">${c.invoices} invoice${c.invoices > 1 ? 's' : ''}</td></tr>`).join('') || '<tr><td class="empty">Nothing settled yet.</td></tr>'}</tbody></table>
      <div class="panel-title" style="margin-top:14px">Model spend, 14 days</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:70px">
        ${d.history.map((h) => `<div title="${esc(h.day)}: ${money(h.spend)}" style="flex:1;background:var(--ember);opacity:.7;border-radius:2px 2px 0 0;height:${Math.max(3, (h.spend / maxSpend) * 64)}px"></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Money moves — every allocation with a reason attached</div>
    ${canM ? `<div class="form-inline">
      <select id="mv-kind" aria-label="Kind" style="width:auto"><option value="allocation">allocation</option><option value="transfer">transfer</option><option value="writeoff">writeoff</option><option value="note">note</option></select>
      <select id="mv-bucket" aria-label="Bucket" style="width:auto"><option value="">— bucket —</option><option>reserve</option><option>opex</option><option>growth</option></select>
      <input id="mv-amt" type="number" step="0.01" placeholder="amount" style="width:110px">
      <input id="mv-why" placeholder="reason" style="width:280px">
      <button class="btn btn-sm" id="mv-add">Record</button></div>` : ''}
    <table><thead><tr><th>Kind</th><th>Bucket</th><th class="num">Amount</th><th>Reason</th><th>By</th></tr></thead><tbody>
    ${d.moves.map((m) => `<tr><td class="mono">${esc(m.kind)}</td><td class="mono">${esc(m.bucket || '—')}</td>
      <td class="num mono">${money(m.amount)}</td><td>${esc(m.reason)}</td><td class="mono" style="font-size:10px">${esc(m.decided_by)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No moves recorded.</td></tr>'}
    </tbody></table>
  </div>`;
  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderMoney(); } catch (e) { toast(e.message, true); }
  };
  $('#m-set')?.addEventListener('click', () => post('/api/money/policy', { reserve: Number($('#m-res').value), opex: Number($('#m-opex').value), growth: Number($('#m-grow').value), minRunway: Number($('#m-run').value) }, 'Policy set'));
  $('#mv-add')?.addEventListener('click', () => post('/api/money/moves', { kind: $('#mv-kind').value, bucket: $('#mv-bucket').value || null, amount: Number($('#mv-amt').value), reason: $('#mv-why').value }, 'Recorded'));
}
// ---------- Treasury: the company gets paid in crypto ----------
export async function renderTreasury() {
  const t = await api('/api/treasury');
  const canM = hasPermC('treasury.manage');
  const canPay = hasPermC('treasury.pay');
  const chains = Object.entries(t.chains);
  const st = (s) => `<span class="chip ${s === 'paid' ? 'chip-ok' : s === 'open' ? 'chip-warn' : s === 'expired' || s === 'cancelled' ? 'chip-dim' : 'chip-bad'}">${esc(s)}</span>`;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Paid invoices', t.stats.paid, t.revenue.map((r) => `${r.total} ${r.asset}`).join(' · ') || 'nothing settled yet', t.stats.paid ? 'tile-steel' : '')}
    ${tile('Open invoices', t.stats.open, 'watching the chain for these')}
    ${tile('Unattributed', t.stats.unmatched, 'money in with no invoice', t.stats.unmatched ? 'tile-warn' : '')}
    ${tile('Waiting for a signature', t.stats.awaitingSignature, 'payouts a person must release', t.stats.awaitingSignature ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title"><span>Wallets — watch-only</span><span class="chip ${t.mode === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(t.mode)}</span></div>
    <div class="map-legend">This platform stores <b>addresses only</b>. No private key, seed phrase or mnemonic is kept here or asked for anywhere — the company can watch money arrive and cannot move it.</div>
    ${canM ? `<div class="form-inline">
      <input id="w-label" placeholder="label, e.g. Main receiving" style="width:180px">
      <select id="w-chain" aria-label="Chain" style="width:auto">${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
      <input id="w-addr" placeholder="public address" style="width:320px">
      <button class="btn btn-sm btn-primary" id="w-add">Add wallet</button>
    </div>` : ''}
    <table><thead><tr><th>Label</th><th>Chain</th><th>Address</th><th class="num">Balance</th><th class="num">Received</th><th></th></tr></thead><tbody>
    ${t.wallets.map((w) => `<tr>
      <td><b>${esc(w.label)}</b><div class="map-legend">${esc(w.kind)}</div></td>
      <td class="mono">${esc(w.chain)} · ${esc(w.asset)}</td>
      <td class="mono" style="font-size:10.5px">${esc(w.address)}${w.explorer ? ` <a href="${esc(w.explorer)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
      <td class="num mono">${w.balance}</td><td class="num mono">${w.received}</td>
      <td>${canM ? `<button class="btn btn-sm btn-bad" data-retire="${w.id}">Retire</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No wallet yet — add a receiving address and the company can start invoicing.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Invoices — they settle themselves</div>
    <div class="map-legend">Each invoice carries a unique amount, so an incoming payment is attributed without asking the payer for a memo. When it lands: the invoice closes, the customer goes active, the deal is won, and the audit chain records all three.</div>
    ${canM ? `<div class="form-inline">
      <input id="i-desc" placeholder="what is being billed" style="width:260px">
      <input id="i-amt" type="number" step="0.0001" placeholder="amount" style="width:120px">
      <select id="i-chain" aria-label="Chain" style="width:auto"><option value="">— any wallet —</option>${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="i-add">Issue invoice</button>
    </div>` : ''}
    <table><thead><tr><th>Ref</th><th>For</th><th class="num">Amount</th><th>Pay to</th><th>State</th><th></th></tr></thead><tbody>
    ${t.invoices.map((i) => `<tr>
      <td class="mono">${esc(i.ref)}</td>
      <td>${esc(i.description)}<div class="map-legend">${esc(String(i.created_at).slice(0, 16))} · by ${esc(i.created_by)}</div></td>
      <td class="num mono">${i.amount} ${esc(i.asset)}</td>
      <td class="mono" style="font-size:10px">${esc(i.address || '')}</td>
      <td>${st(i.state)}${i.tx_hash ? `<div class="map-legend mono">${esc(String(i.tx_hash).slice(0, 22))}…</div>` : ''}</td>
      <td>${canM && i.state === 'open' ? `<button class="btn btn-sm" data-cancel="${i.id}">Cancel</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No invoices yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Money in</div>
      <table><tbody>${t.transactions.map((x) => `<tr>
        <td class="mono" style="font-size:10px">${esc(String(x.tx_hash).slice(0, 18))}…</td>
        <td class="num mono">${x.amount} ${esc(x.asset)}</td>
        <td>${x.invoice_id ? '<span class="chip chip-ok">matched</span>' : '<span class="chip chip-warn">unattributed</span>'}</td>
        <td class="mono" style="font-size:10px">${esc(String(x.seen_at).slice(0, 16))}</td>
      </tr>`).join('') || '<tr><td class="empty">Nothing has arrived yet.</td></tr>'}</tbody></table>
    </div>
    <div class="panel"><div class="panel-title">Money out — prepared here, signed elsewhere</div>
      <div class="map-legend">The platform holds no key, so it cannot send. A payout is a request; you sign it in your own wallet and paste the transaction hash back so the ledger matches the chain. <b>Autonomy mode cannot release these.</b></div>
      ${canM ? `<div class="form-inline">
        <input id="p-addr" placeholder="destination address" style="width:220px">
        <select id="p-chain" aria-label="Chain" style="width:auto">${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
        <input id="p-amt" type="number" step="0.0001" placeholder="amount" style="width:100px">
        <input id="p-why" placeholder="reason" style="width:180px">
        <button class="btn btn-sm" id="p-add">Prepare payout</button>
      </div>` : ''}
      <table><tbody>${t.payouts.map((p) => `<tr>
        <td>${esc(p.reason)}<div class="map-legend mono">${esc(p.to_address.slice(0, 22))}…</div></td>
        <td class="num mono">${p.amount} ${esc(p.asset)}</td>
        <td>${st(p.state === 'sent' ? 'paid' : p.state)}</td>
        <td>${canPay && p.state === 'prepared' ? `<button class="btn btn-sm btn-ok" data-pay="${p.id}" data-to="approved">Approve</button><button class="btn btn-sm btn-bad" data-pay="${p.id}" data-to="rejected">Reject</button>` : ''}
            ${canPay && p.state === 'approved' ? `<button class="btn btn-sm" data-sent="${p.id}">I signed it →</button>` : ''}</td>
      </tr>`).join('') || '<tr><td class="empty">No payouts prepared.</td></tr>'}</tbody></table>
    </div>
  </div>`;

  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderTreasury(); }
    catch (e) { toast(e.message, true); }
  };
  $('#w-add')?.addEventListener('click', () => post('/api/treasury/wallets', { label: $('#w-label').value, chain: $('#w-chain').value, address: $('#w-addr').value }, 'Wallet added — watch-only'));
  $('#i-add')?.addEventListener('click', () => post('/api/treasury/invoices', { description: $('#i-desc').value, amount: Number($('#i-amt').value), chain: $('#i-chain').value || null }, 'Invoice issued'));
  $('#p-add')?.addEventListener('click', () => post('/api/treasury/payouts', { toAddress: $('#p-addr').value, chain: $('#p-chain').value, amount: Number($('#p-amt').value), reason: $('#p-why').value }, 'Prepared — it needs your signature'));
  view.querySelectorAll('[data-retire]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/wallets/${b.dataset.retire}/retire`, {}, 'Retired')));
  view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/invoices/${b.dataset.cancel}/cancel`, {}, 'Cancelled')));
  view.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/payouts/${b.dataset.pay}/resolve`, { state: b.dataset.to }, `Payout ${b.dataset.to}`)));
  view.querySelectorAll('[data-sent]').forEach((b) => b.addEventListener('click', () => {
    const h = prompt('Paste the transaction hash you signed, so the record matches the chain:');
    if (h) post(`/api/treasury/payouts/${b.dataset.sent}/resolve`, { state: 'sent', txHash: h }, 'Recorded against the chain');
  }));
}
