// Workforce command, and each person's own work.
//
// The AI plans and dispatches; people do the work and keep the judgement. A
// manager sees the board, the plans and the team; an employee sees only their
// own assignments, their nudges and today's check-in.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, stateTag, ago, emptyCta, tabs, hashParam, wireActs, act, who } from '../components/ui.js';

const remember = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } };
const recall = (k, d) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } };
const PRIO = { critical: 'chip-bad', high: 'chip-warn', normal: '', low: 'chip-dim' };
const due = (a) => (a.due_at ? `<span class="${a.overdue ? 'chip chip-bad' : 'muted'}">${esc(t(a.overdue ? 'overdue' : 'due'))} ${esc(new Date(a.due_at).toLocaleDateString())}</span>` : '');

function card(a, { manager, roster }) {
  return `<div class="change ${a.state === 'submitted' ? 'proposed' : ''}" style="gap:6px">
    <div class="inline"><b class="grow">${esc(a.title)}</b>${a.source === 'ai' ? '<span class="who-ai" title="dispatched by the AI" style="width:22px;height:22px;font-size:9px">AI</span>' : ''}</div>
    <div class="inline" style="font-size:12.5px"><span class="who-human" style="width:22px;height:22px;font-size:9.5px">${esc(a.employee.slice(0, 2).toUpperCase())}</span><span>${esc(a.employee)}</span>
      <span class="chip ${PRIO[a.priority] || ''}">${esc(t(a.priority))}</span>${due(a)}</div>
    ${a.state === 'blocked' && a.blocker ? `<div class="callout human" style="padding:8px 10px">${esc(a.blocker)}</div>` : ''}
    ${a.state === 'submitted' && a.submission ? `<div class="callout" style="padding:8px 10px;white-space:pre-wrap">${esc(a.submission)}</div>` : ''}
    ${a.ai_review && JSON.parse(a.ai_review).state === 'done' ? `<div class="muted" style="font-size:12px">✦ ${esc(t('Reviewer'))}: ${esc(JSON.parse(a.ai_review).summary || JSON.parse(a.ai_review).verdict || '')}</div>` : ''}
    ${a.progress ? `<div class="prog" title="${a.progress}%"><i style="width:${a.progress}%"></i></div>` : ''}
    ${manager ? `<div class="inline">
      ${a.state === 'submitted' ? `<button class="btn btn-sm btn-bad" type="button" data-move="${a.id}" data-a="return">${esc(t('Return'))}</button><button class="btn btn-sm btn-human" type="button" data-move="${a.id}" data-a="approve">${esc(t('Approve'))}</button>` : ''}
      ${a.state !== 'submitted' ? `<select data-reassign="${a.id}" style="width:auto;min-height:30px;font-size:12.5px" aria-label="${esc(t('Reassign'))}"><option value="">${esc(t('Reassign…'))}</option>${roster.filter((r) => r.id !== a.employee_id).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
        <button class="btn btn-sm btn-ghost" type="button" data-move="${a.id}" data-a="cancel">${esc(t('Cancel'))}</button>` : ''}
    </div>` : ''}
  </div>`;
}

export async function renderCrew() {
  const d = await api('/api/crew');
  const o = d.overview;
  const canM = hasPermC('crew.manage');
  let tab = hashParam('plan') === '1' ? 'plans' : recall('alphacore-crew-tab', 'board');
  const emp = hashParam('emp');
  const list = emp ? d.assignments.filter((a) => String(a.employee_id) === emp) : d.assignments;
  const col = (states) => list.filter((a) => states.includes(a.state));
  const cols = [
    ['To do', col(['assigned', 'accepted', 'returned'])],
    ['In progress', col(['in_progress'])],
    ['Blocked', col(['blocked'])],
    ['For review', col(['submitted'])],
  ];
  const plansWaiting = d.plans.filter((p) => p.state === 'proposed').length;
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('The AI plans the work, gives it to the right people, follows up on what slips and reviews what comes back. People do the work — and keep every judgement about people: ratings, pay and employment stay human.'))}</p>
    <div class="pg-actions">
      ${hasPermC('owner.rule') ? `<label class="chip" style="cursor:pointer;padding:6px 12px"><input type="checkbox" id="cr-auto" ${o.autopilot ? 'checked' : ''} style="width:auto;min-height:0"> ${esc(t('AI dispatches without waiting'))}</label>` : ''}
      ${canM ? `<button class="btn" type="button" id="cr-assign-toggle">${esc(t('Assign directly'))}</button><button class="btn btn-primary" type="button" id="cr-plan-toggle">✦ ${esc(t('Plan work with AI'))}</button>` : ''}
    </div>
  </div>
  <div class="kpis">
    ${kpi('People', o.people, `${o.checkedInToday} ${esc(t('checked in today'))}`)}
    ${kpi('Open work', o.open, `${o.aiAssigned30} ${esc(t('dispatched by AI this month'))}`, 'ai')}
    ${kpi('Overdue', o.overdue, '', o.overdue ? 'bad' : '')}
    ${kpi('Blocked', o.blocked, '', o.blocked ? 'human' : '')}
    ${kpi('For review', o.awaitingReview, esc(t('submitted, waiting for a person')), o.awaitingReview ? 'human' : '')}
    ${kpi('Plans to dispatch', o.plansWaiting, '', o.plansWaiting ? 'human' : '')}
  </div>
  ${!d.roster.length ? `<div class="callout human">${esc(t('There is nobody on the roster yet. Add employees in the enterprise core first —'))} <a href="#/workforce2">${esc(t('Employees'))}</a>.</div>` : ''}
  ${canM ? `<form class="panel" id="cr-assign" hidden><div class="panel-title">${esc(t('Assign work to a person'))}</div>
    <div class="fields">
      <div><label class="fl" for="ca-emp">${esc(t('Person'))}</label><select id="ca-emp">${d.roster.map((r) => `<option value="${r.id}">${esc(r.name)}${r.position ? ` — ${esc(r.position)}` : ''}</option>`).join('')}</select></div>
      <div><label class="fl" for="ca-prio">${esc(t('Priority'))}</label><select id="ca-prio">${['normal', 'high', 'critical', 'low'].map((p) => `<option value="${p}">${esc(t(p))}</option>`).join('')}</select></div>
      <div><label class="fl" for="ca-due">${esc(t('Due'))}</label><input id="ca-due" type="date"></div>
      <div><label class="fl" for="ca-est">${esc(t('Estimate (hours)'))}</label><input id="ca-est" type="number" min="0" step="0.5"></div>
      <div class="wide"><label class="fl" for="ca-title">${esc(t('What needs doing'))}</label><input id="ca-title" required></div>
      <div class="wide"><label class="fl" for="ca-details">${esc(t('Details'))}</label><textarea id="ca-details" rows="2"></textarea></div>
    </div>
    <div class="inline" style="margin-top:12px"><button class="btn btn-primary" type="submit">${esc(t('Assign'))}</button></div></form>` : ''}
  ${tabs([['board', 'Board', d.assignments.length], ['plans', 'Plans', plansWaiting || ''], ['team', 'Team', d.workload.length], ['checkins', 'Check-ins', d.checkins.length]], tab)}
  <div id="cr-body"></div>`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { remember('alphacore-crew-tab', b.dataset.tab); if (hashParam('plan')) location.hash = '#/crew'; else renderCrew(); }));
  $('#cr-assign-toggle')?.addEventListener('click', () => { const f = $('#cr-assign'); f.hidden = !f.hidden; });
  $('#cr-plan-toggle')?.addEventListener('click', () => { remember('alphacore-crew-tab', 'plans'); renderCrew(); setTimeout(() => $('#cp-goal')?.focus(), 50); });
  $('#cr-auto')?.addEventListener('change', async (e) => {
    try { await api('/api/crew/autopilot', { method: 'POST', body: { on: e.target.checked } }); toast(t(e.target.checked ? 'The AI now dispatches plans by itself' : 'Plans now wait for a person')); }
    catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  });
  $('#cr-assign')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/crew/assign', { method: 'POST', body: { employeeId: Number($('#ca-emp').value), title: $('#ca-title').value, details: $('#ca-details').value, priority: $('#ca-prio').value, dueAt: $('#ca-due').value ? new Date(`${$('#ca-due').value}T17:00:00`).toISOString() : null, estimateH: $('#ca-est').value || null } });
      toast(t('Assigned')); renderCrew();
    } catch (err) { toast(err.message, true); }
  });
  const body = $('#cr-body');

  if (tab === 'board') {
    body.innerHTML = `
    ${emp ? `<div class="inline"><span class="chip chip-ember">${esc(d.roster.find((r) => String(r.id) === emp)?.name || '')}</span><a href="#/crew" class="btn btn-sm btn-ghost">${esc(t('Show everyone'))}</a></div>` : ''}
    <div class="grid grid-4" style="align-items:start">${cols.map(([label, items]) => `
      <div class="panel" style="padding:14px;background:var(--sx-raise)">
        <div class="panel-title">${esc(t(label))}<span class="chip">${items.length}</span></div>
        <div class="stack" style="gap:10px">${items.map((a) => card(a, { manager: canM, roster: d.roster })).join('') || `<div class="empty">—</div>`}</div>
      </div>`).join('')}</div>
    ${d.recent.length ? `<div class="panel"><div class="panel-title">${esc(t('Recently closed'))}</div><div class="rows">${d.recent.map((a) => `<div class="row">${stateTag(a.state)}<div class="row-main"><div class="row-title">${esc(a.title)}</div><div class="row-meta">${esc(a.employee)} · ${esc(ago(a.closed_at || a.updated_at))}${a.review_note ? ` · “${esc(a.review_note)}”` : ''}</div></div></div>`).join('')}</div></div>` : ''}`;
    body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      const action = b.dataset.a;
      let note = null;
      if (action === 'return') { note = prompt(t('What needs another pass?')); if (!note) return; }
      if (action === 'approve') note = prompt(t('A note for them (optional)')) || null;
      if (action === 'cancel' && !confirm(t('Cancel this assignment?'))) return;
      try { await api(`/api/crew/assignments/${b.dataset.move}/move`, { method: 'POST', body: { action, note } }); toast(t('Done')); renderCrew(); }
      catch (err) { toast(err.message, true); }
    }));
    body.querySelectorAll('[data-reassign]').forEach((s) => s.addEventListener('change', async () => {
      if (!s.value) return;
      try { await api(`/api/crew/assignments/${s.dataset.reassign}/move`, { method: 'POST', body: { action: 'reassign', toEmployeeId: Number(s.value) } }); toast(t('Reassigned')); renderCrew(); }
      catch (err) { toast(err.message, true); s.value = ''; }
    }));
    return;
  }

  if (tab === 'plans') {
    body.innerHTML = `
    ${canM ? `<form class="panel lane-panel" id="cp-form"><div class="panel-title">✦ ${esc(t('What should the team achieve?'))}</div>
      <textarea id="cp-goal" rows="3" required placeholder="${esc(t('e.g. Launch the spring catalogue: photos, product copy, price list and a newsletter by Thursday.'))}"></textarea>
      <div class="inline" style="margin-top:10px"><label class="fl" for="cp-days" style="margin:0">${esc(t('Within'))}</label><select id="cp-days" style="width:auto"><option value="3">3 ${esc(t('days'))}</option><option value="7" selected>7 ${esc(t('days'))}</option><option value="14">14 ${esc(t('days'))}</option><option value="30">30 ${esc(t('days'))}</option></select>
      <button class="btn btn-primary" type="submit">${esc(t('Draft the plan'))}</button></div>
      <div class="hint">${esc(t('The program manager reads the roster and everyone\'s current load, then proposes who does what by when. You dispatch it — or switch dispatch to the AI.'))}</div></form>` : ''}
    ${d.plans.length ? d.plans.map((p) => `
      <div class="panel ${p.state === 'proposed' ? 'lane-panel people' : ''}">
        <div class="panel-title"><span style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--sx-ink)">${esc(p.goal.slice(0, 140))}</span>${stateTag(p.state)}</div>
        ${p.rationale ? `<p class="muted" style="margin:0 0 10px">${esc(p.rationale)}</p>` : ''}
        ${p.state === 'drafting' ? `<div class="empty">${esc(t('The program manager is drafting…'))}</div>` : ''}
        ${p.proposal.length ? `<table><thead><tr><th>${esc(t('Person'))}</th><th>${esc(t('Assignment'))}</th><th>${esc(t('Priority'))}</th><th class="num">${esc(t('Due in'))}</th><th class="num">${esc(t('Hours'))}</th></tr></thead><tbody>
          ${p.proposal.map((x) => `<tr><td>${esc(x.employee)}</td><td><b>${esc(x.title)}</b>${x.why ? `<div class="muted" style="font-size:12px">${esc(x.why)}</div>` : ''}</td><td><span class="chip ${PRIO[x.priority] || ''}">${esc(t(x.priority || 'normal'))}</span></td><td class="num">${esc(x.dueDays ?? '—')}d</td><td class="num">${esc(x.estimateH ?? '—')}</td></tr>`).join('')}
        </tbody></table>` : ''}
        ${p.state === 'proposed' && canM ? `<div class="inline" style="margin-top:12px;justify-content:flex-end">${act(`/api/crew/plans/${p.id}/discard`, 'Discard', { cls: 'btn-sm btn-ghost' })}${act(`/api/crew/plans/${p.id}/dispatch`, 'Dispatch to the team', { cls: 'btn-sm btn-human', done: 'Dispatched' })}</div>` : ''}
      </div>`).join('') : emptyCta('No plans yet', 'Describe an outcome and the AI drafts who should do what.')}`;
    $('#cp-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/crew/plan', { method: 'POST', body: { goal: $('#cp-goal').value, horizonDays: Number($('#cp-days').value) } }); toast(t('The program manager is drafting the plan')); remember('alphacore-crew-tab', 'plans'); location.hash = '#/crew'; renderCrew(); }
      catch (err) { toast(err.message, true); }
    });
    wireActs(body, api, toast, renderCrew);
    if (d.plans.some((p) => p.state === 'drafting')) setTimeout(() => { if (location.hash.startsWith('#/crew') && !$('#cp-goal')?.value) renderCrew(); }, 4000);
    return;
  }

  if (tab === 'team') {
    body.innerHTML = `<div class="panel">
      ${d.workload.length ? `<table><thead><tr><th>${esc(t('Person'))}</th><th>${esc(t('Signal'))}</th><th class="num">${esc(t('Open'))}</th><th class="num">${esc(t('Overdue'))}</th><th class="num">${esc(t('Load'))}</th><th class="num">${esc(t('On time'))}</th><th class="num">${esc(t('Avg cycle'))}</th><th class="num">${esc(t('Hours in, 30d'))}</th><th class="num">${esc(t('Check-ins, 14d'))}</th></tr></thead><tbody>
        ${d.workload.map((w) => `<tr class="rowlink" data-emp="${w.employeeId}"><td><b>${esc(w.name)}</b><div class="muted" style="font-size:12px">${esc([w.position, w.unit].filter(Boolean).join(' · '))}</div></td>
          <td><span class="sig ${esc(w.signal)}">${esc(t(w.signal))}</span></td><td class="num">${w.open}</td><td class="num" style="${w.overdue ? 'color:var(--sx-bad)' : ''}">${w.overdue}</td>
          <td class="num">${w.loadH}h</td><td class="num">${w.onTimeRate == null ? '—' : `${w.onTimeRate}%`}</td><td class="num">${w.avgCycleH == null ? '—' : `${w.avgCycleH}h`}</td>
          <td class="num">${w.attendanceHours30}</td><td class="num">${w.checkins14}</td></tr>`).join('')}
      </tbody></table>
      <div class="hint" style="margin-top:10px">${esc(t('Facts from the record, not a rating. A rating is a person\'s judgement and is made in People lifecycle.'))}</div>` : emptyCta('Nobody on the roster yet', 'Add employees in the enterprise core.')}
    </div>`;
    body.querySelectorAll('[data-emp]').forEach((tr) => tr.addEventListener('click', () => { remember('alphacore-crew-tab', 'board'); location.hash = `#/crew?emp=${tr.dataset.emp}`; }));
    return;
  }

  body.innerHTML = `<div class="panel">${d.checkins.length ? `<div class="rows">${d.checkins.map((c) => `
    <div class="row" style="align-items:flex-start"><span class="who-human">${esc(c.employee.slice(0, 2).toUpperCase())}</span>
      <div class="row-main"><div class="row-title">${esc(c.employee)} ${c.energy ? `<span class="chip">${'●'.repeat(c.energy)}${'○'.repeat(5 - c.energy)}</span>` : ''}</div>
        ${c.plan ? `<div><span class="muted">${esc(t('Plan'))}:</span> ${esc(c.plan)}</div>` : ''}${c.done ? `<div><span class="muted">${esc(t('Done'))}:</span> ${esc(c.done)}</div>` : ''}
        ${c.blockers ? `<div class="callout human" style="padding:6px 10px;margin-top:4px">${esc(c.blockers)}</div>` : ''}</div></div>`).join('')}</div>`
    : `<div class="empty">${esc(t('No check-ins yet today.'))}</div>`}</div>`;
}

// ============================================================== my work ===

export async function renderMyWork() {
  const d = await api('/api/crew/mine');
  if (!d.linked) {
    view.innerHTML = emptyCta('Your account is not linked to an employee record',
      'When an administrator links your login to your employee record (Enterprise core → Employees), the work assigned to you appears here — with a daily check-in and reminders.',
      hasPermC('crew.view') ? `<a class="btn" href="#/crew">${esc(t('Open workforce command'))}</a>` : '');
    return;
  }
  const by = (states) => d.assignments.filter((a) => states.includes(a.state));
  const todo = by(['assigned', 'accepted', 'returned']);
  const doing = by(['in_progress', 'blocked']);
  const waiting = by(['submitted']);
  const done = by(['approved', 'declined']).slice(0, 10);
  const unseen = d.nudges.filter((n) => !n.seen_at);
  const w = d.workload || {};
  const item = (a) => `
    <div class="change ${a.state === 'returned' || a.state === 'blocked' ? 'proposed' : ''}">
      <div class="inline"><b class="grow">${esc(a.title)}</b>${a.source === 'ai' ? '<span class="who-ai" style="width:22px;height:22px;font-size:9px" title="dispatched by the AI">AI</span>' : ''}<span class="chip ${PRIO[a.priority] || ''}">${esc(t(a.priority))}</span>${stateTag(a.state)}</div>
      ${a.details ? `<div style="white-space:pre-wrap;color:var(--sx-mute)">${esc(a.details)}</div>` : ''}
      ${a.review_note && a.state === 'returned' ? `<div class="callout human"><b>${esc(t('Returned'))}:</b> ${esc(a.review_note)}</div>` : ''}
      <div class="inline" style="font-size:12.5px">${due(a)}${a.estimate_h ? `<span class="muted">~${a.estimate_h}h</span>` : ''}</div>
      ${['in_progress', 'accepted', 'returned'].includes(a.state) ? `<div class="inline"><label class="fl" for="pg-${a.id}" style="margin:0">${esc(t('Progress'))}</label><input type="range" id="pg-${a.id}" min="0" max="100" step="10" value="${a.progress}" data-prog="${a.id}" style="width:180px;min-height:0;padding:0"><span class="mono">${a.progress}%</span></div>` : ''}
      <div class="inline">
        ${['assigned', 'returned'].includes(a.state) ? `<button class="btn btn-sm btn-primary" type="button" data-my="${a.id}" data-a="${a.state === 'assigned' ? 'accept' : 'start'}">${esc(t(a.state === 'assigned' ? 'Accept' : 'Start again'))}</button>` : ''}
        ${a.state === 'accepted' || a.state === 'blocked' ? `<button class="btn btn-sm btn-primary" type="button" data-my="${a.id}" data-a="start">${esc(t(a.state === 'blocked' ? 'Unblocked — continue' : 'Start'))}</button>` : ''}
        ${['accepted', 'in_progress', 'returned', 'blocked'].includes(a.state) ? `<button class="btn btn-sm btn-human" type="button" data-my="${a.id}" data-a="submit">${esc(t('Submit for review'))}</button>` : ''}
        ${['accepted', 'in_progress', 'returned', 'assigned'].includes(a.state) ? `<button class="btn btn-sm" type="button" data-my="${a.id}" data-a="block">${esc(t('I am blocked'))}</button>` : ''}
        ${a.state === 'assigned' ? `<button class="btn btn-sm btn-ghost" type="button" data-my="${a.id}" data-a="decline">${esc(t('Decline'))}</button>` : ''}
      </div>
    </div>`;
  view.innerHTML = `
  <div class="kpis">
    ${kpi('To do', todo.length, '', todo.length ? 'ai' : '')}
    ${kpi('In progress', doing.length)}
    ${kpi('Overdue', w.overdue ?? 0, '', w.overdue ? 'bad' : '')}
    ${kpi('Waiting for review', waiting.length, '', waiting.length ? 'human' : '')}
    ${kpi('On time', w.onTimeRate == null ? '—' : `${w.onTimeRate}%`, esc(t('last 90 days')))}
  </div>
  <div class="split2">
    <div class="stack">
      ${unseen.length ? `<div class="panel lane-panel people"><div class="panel-title">${esc(t('Reminders'))}<button class="btn btn-sm btn-ghost" type="button" id="mw-seen">${esc(t('Mark as read'))}</button></div>
        <div class="rows">${unseen.map((n) => `<div class="row">${who('agent:AGT-PMO-001')}<div class="row-main"><div class="row-title" style="white-space:normal">${esc(n.message)}</div><div class="row-meta">${esc(ago(n.created_at))}</div></div></div>`).join('')}</div></div>` : ''}
      <div class="panel"><div class="panel-title">${esc(t('To do'))}</div><div class="stack" style="gap:10px">${todo.map(item).join('') || `<div class="empty">${esc(t('Nothing new.'))}</div>`}</div></div>
      <div class="panel"><div class="panel-title">${esc(t('In progress'))}</div><div class="stack" style="gap:10px">${doing.map(item).join('') || `<div class="empty">—</div>`}</div></div>
      ${waiting.length ? `<div class="panel"><div class="panel-title">${esc(t('Waiting for review'))}</div><div class="stack" style="gap:10px">${waiting.map(item).join('')}</div></div>` : ''}
      ${done.length ? `<div class="panel"><div class="panel-title">${esc(t('Recently finished'))}</div><div class="rows">${done.map((a) => `<div class="row">${stateTag(a.state)}<div class="row-main"><div class="row-title">${esc(a.title)}</div><div class="row-meta">${a.review_note ? `“${esc(a.review_note)}”` : ''}</div></div></div>`).join('')}</div></div>` : ''}
    </div>
    <form class="panel lane-panel" id="mw-checkin">
      <div class="panel-title">${esc(t('Today\'s check-in'))}${d.today ? `<span class="chip chip-ok">${esc(t('sent'))}</span>` : ''}</div>
      <label class="fl" for="mw-plan">${esc(t('What I plan to do today'))}</label><textarea id="mw-plan" rows="3">${esc(d.today?.plan || '')}</textarea>
      <label class="fl" for="mw-done" style="margin-top:10px">${esc(t('What I finished'))}</label><textarea id="mw-done" rows="2">${esc(d.today?.done || '')}</textarea>
      <label class="fl" for="mw-block" style="margin-top:10px">${esc(t('Anything in my way'))}</label><textarea id="mw-block" rows="2">${esc(d.today?.blockers || '')}</textarea>
      <label class="fl" for="mw-energy" style="margin-top:10px">${esc(t('Energy'))}</label>
      <select id="mw-energy">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${d.today?.energy === n ? 'selected' : ''}>${'●'.repeat(n)}${'○'.repeat(5 - n)}</option>`).join('')}</select>
      <button class="btn btn-primary" type="submit" style="margin-top:12px;width:100%">${esc(t(d.today ? 'Update check-in' : 'Send check-in'))}</button>
      <div class="hint">${esc(t('Your manager and the AI program manager read this. A blocker is raised straight away.'))}</div>
    </form>
  </div>`;
  $('#mw-seen')?.addEventListener('click', async () => { await api('/api/crew/mine/seen', { method: 'POST', body: {} }).catch(() => {}); renderMyWork(); });
  $('#mw-checkin').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/crew/mine/checkin', { method: 'POST', body: { plan: $('#mw-plan').value, done: $('#mw-done').value, blockers: $('#mw-block').value, energy: Number($('#mw-energy').value) } }); toast(t('Check-in sent')); renderMyWork(); }
    catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-my]').forEach((b) => b.addEventListener('click', async () => {
    const action = b.dataset.a;
    const body = { action };
    if (action === 'block') { body.note = prompt(t('What is blocking it?')); if (!body.note) return; }
    if (action === 'decline') { body.note = prompt(t('Why are you declining it?')); if (!body.note) return; }
    if (action === 'submit') { body.submission = prompt(t('What did you do? Add a link if there is one.')); if (!body.submission) return; }
    try { await api(`/api/crew/mine/${b.dataset.my}/move`, { method: 'POST', body }); toast(t('Done')); renderMyWork(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-prog]').forEach((r) => r.addEventListener('change', async () => {
    try { await api(`/api/crew/mine/${r.dataset.prog}/progress`, { method: 'POST', body: { progress: Number(r.value) } }); renderMyWork(); }
    catch (err) { toast(err.message, true); }
  }));
}
