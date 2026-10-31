// The governance and enterprise floor: policies, ISO, internal audit, digital
// transformation, the production studio, operations, strategy, insurance,
// AML, and remittances.
//
// Each page is the same shape on purpose — the figures that matter, the work
// waiting, a form to add to it — and the parts they share live at the top:
// a form built from a field list, and the panel that shows an AI draft and
// lets a person take it or leave it.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, tabs, emptyCta, act, wireActs, ago, spark, hashParam } from '../components/ui.js';
import { officialCopyButton, wireOfficialCopy } from './assurance.js';

// ------------------------------------------------------------- the parts --

/** A form from a field list: [name, label, type, {options, required, wide, value, step}]. */
function form(id, fields, submit = 'Add') {
  return `<form id="${id}" class="fields">${fields.map(([name, label, type = 'text', o = {}]) => {
    const fid = `${id}-${name}`;
    const req = o.required ? 'required' : '';
    const val = o.value != null ? ` value="${esc(o.value)}"` : '';
    let input;
    if (type === 'select') input = `<select id="${fid}" name="${name}">${o.options.map((x) => (Array.isArray(x) ? x : [x, x])).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(o.value ?? '') ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea id="${fid}" name="${name}" rows="${o.rows || 3}" ${req}>${esc(o.value ?? '')}</textarea>`;
    else if (type === 'checkbox') return `<div class="wide"><label class="eng-chk"><input type="checkbox" id="${fid}" name="${name}"> ${esc(t(label))}</label></div>`;
    else input = `<input id="${fid}" name="${name}" type="${type}" ${o.step ? `step="${o.step}"` : ''} ${req}${val}>`;
    return `<div class="${o.wide || type === 'textarea' ? 'wide' : ''}"><label class="fl" for="${fid}">${esc(t(label))}</label>${input}</div>`;
  }).join('')}<div class="wide"><button class="btn btn-primary" type="submit">${esc(t(submit))}</button></div></form>`;
}

/** Wire a form to a POST; numbers stay numbers, empty fields are left out. */
function wireForm(id, path, done, shape = (b) => b) {
  $(`#${id}`)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const el of e.target.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') body[el.name] = el.checked;
      else if (el.value !== '') body[el.name] = el.type === 'number' ? Number(el.value) : el.value;
    }
    try { const r = await api(typeof path === 'function' ? path(body) : path, { method: 'POST', body: shape(body) }); toast(t('Saved')); done(r); }
    catch (err) { toast(err.message, true); }
  });
}

// A draft waiting for the night shift says when it will be written, in the
// reader's own clock, and can be brought forward to the day model.
const localTime = (sqlUtc) => new Date(`${String(sqlUtc).replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function draftStatus(d) {
  if (d.state !== 'thinking') return esc(d.served_by || '');
  if (!d.not_before) return esc(t('being written…'));
  return `${esc(t('waiting for the night shift'))} · ${esc(localTime(d.not_before))} <button type="button" class="btn btn-sm btn-ghost" data-draft-now="${d.id}">${esc(t('Write it now'))}</button>`;
}
let draftNowWired = false;
function wireDraftNow() {
  if (draftNowWired) return;
  draftNowWired = true;
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-draft-now]');
    if (!b) return;
    try {
      await api(`/api/drafts/${b.dataset.draftNow}/now`, { method: 'POST', body: {} });
      toast(t('Written now by the day model'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, true); }
  });
}

/** The latest AI drafts, readable, with the open questions the writer left. */
function draftsPanel(drafts = [], { adopt = false } = {}) {
  if (!drafts.length) return '';
  wireDraftNow();
  return `<div class="panel"><div class="panel-title">${esc(t('AI drafts'))}</div>${drafts.map((d) => `<div class="ent-draft">
    <div class="sub">${esc(d.kind)} · ${draftStatus(d)} · ${ago(d.created_at)}</div>
    ${d.state === 'ready' ? `<pre class="ent-md">${esc(d.body?.markdown || '')}</pre>
      ${d.body?.items?.length ? `<pre class="ent-md">${esc(JSON.stringify(d.body.items, null, 2))}</pre>` : ''}
      ${d.body?.openQuestions?.length ? `<div class="sub">${esc(t('Open questions'))}: ${esc(d.body.openQuestions.join(' · '))}</div>` : ''}
      ${adopt ? `<button type="button" class="btn btn-sm" data-adopt="${d.id}">${esc(t('Use this draft'))}</button>` : ''}` : ''}
    ${d.state === 'failed' ? `<div class="sub">${esc(d.body?.markdown || t('failed'))}</div>` : ''}</div>`).join('')}</div>`;
}

const chip = (s, map = {}) => `<span class="chip ${map[s] || ''}">${esc(t(String(s).replace(/_/g, ' ')))}</span>`;
const STATE_CLS = { published: 'chip-ok', closed: 'chip-ok', verified: 'chip-ok', implemented: 'chip-ok', live: 'chip-ok', delivered: 'chip-ok', settled: 'chip-ok', cleared: 'chip-ok', released: 'chip-ok', approved: 'chip-ok', green: 'chip-ok', kept: 'chip-ok', reverted: 'chip-bad', applied: 'chip-warn',
  review: 'chip-warn', partial: 'chip-warn', action: 'chip-warn', verify: 'chip-warn', amber: 'chip-warn', held: 'chip-bad', open: 'chip-warn', investigating: 'chip-warn', medium: 'chip-warn',
  red: 'chip-bad', high: 'chip-bad', major: 'chip-bad', rejected: 'chip-bad', reported: 'chip-bad', not_started: 'chip-dim', retired: 'chip-dim', cancelled: 'chip-dim', low: 'chip-dim', none: 'chip-dim' };
const st = (s) => chip(s, STATE_CLS);
const money = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// ================================================================ policies ==

const KIND_LABEL = { law: 'Laws', policy: 'Policies', procedure: 'Procedures', process: 'Processes', instruction: 'Work instructions', standard: 'Standards' };

export async function renderPolicies() {
  const id = hashParam('id');
  if (id) return renderPolicyDoc(Number(id));
  const kind = hashParam('kind') || 'all';
  const d = await api(`/api/policies${kind !== 'all' ? `?kind=${encodeURIComponent(kind)}` : ''}`);
  const canM = hasPermC('policies.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The company’s written rules and the laws they answer to. A law is obeyed, a policy says what and why, a procedure says how, a process says who hands what to whom with the control at each step. Every version is kept; publishing is a person’s act; everyone can be asked to acknowledge the version in force.'))}</p></div>
  <div class="kpis">
    ${kpi('Published', d.published)}
    ${kpi('In review', d.inReview, '', d.inReview ? 'human' : '')}
    ${kpi('Review overdue', d.overdue.length, esc(t('past their review date')), d.overdue.length ? 'bad' : 'ok')}
    ${kpi('Processes', d.counts.process, `${d.counts.procedure} ${esc(t('procedures'))}`)}
  </div>
  ${tabs([['all', 'All', Object.values(d.counts).reduce((a, b) => a + b, 0)], ...d.kinds.map((k) => [k, KIND_LABEL[k], d.counts[k]])], kind)}
  <div class="panel">
    ${d.docs.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Code'))}</th><th>${esc(t('Title'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Version'))}</th><th>${esc(t('Next review'))}</th><th>${esc(t('Read by'))}</th></tr></thead><tbody>
      ${d.docs.map((x) => `<tr><td class="ltr"><a href="#/policies?id=${x.id}">${esc(x.code)}</a></td><td><a href="#/policies?id=${x.id}">${esc(x.title)}</a><div class="sub">${esc(t(x.kind))}${x.owner ? ` · ${esc(x.owner)}` : ''}</div></td>
        <td>${st(x.state)}</td><td>v${x.version}</td><td class="sub">${esc(x.next_review || '—')}</td><td>${x.acks}/${d.users}</td></tr>`).join('')}
    </tbody></table></div>` : emptyCta('No documents yet', 'Start with the policy every company needs first, or register the laws the company must comply with.')}
  </div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('New document'))}</div>${form('pl-new', [
    ['kind', 'Kind', 'select', { options: d.kinds.map((k) => [k, k]), value: kind !== 'all' ? kind : 'policy' }],
    ['title', 'Title', 'text', { required: true, wide: true }],
    ['owner', 'Owner'], ['reviewMonths', 'Review every (months)', 'number', { value: 12 }],
    ['scope', 'Scope', 'textarea', { rows: 2 }],
  ], 'Create')}</div>` : ''}`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab === 'all' ? '#/policies' : `#/policies?kind=${b.dataset.tab}`; }));
  wireForm('pl-new', '/api/policies', (r) => { location.hash = `#/policies?id=${r.id}`; });
}

async function renderPolicyDoc(id) {
  const d = await api(`/api/policies/${id}`);
  const canM = hasPermC('policies.manage');
  const canP = hasPermC('policies.publish');
  const steps = d.steps || [];
  view.innerHTML = `
  <div class="pg-head"><p><a href="#/policies">← ${esc(t('Policies & procedures'))}</a></p>
    <h2 class="ltr" style="margin:6px 0">${esc(d.code)} · <span dir="auto">${esc(d.title)}</span></h2>
    <div class="inline">${st(d.state)} <span class="chip">v${d.version}</span> <span class="chip">${esc(t(d.kind))}</span>
      ${d.next_review ? `<span class="chip">${esc(t('Next review'))} ${esc(d.next_review)}</span>` : ''}
      ${canM && d.state === 'draft' ? act(`/api/policies/${d.id}/state`, 'Send to review', { body: { state: 'review' }, cls: 'btn-sm' }) : ''}
      ${canP && ['draft', 'review'].includes(d.state) ? act(`/api/policies/${d.id}/state`, 'Publish', { body: { state: 'published' }, cls: 'btn-sm btn-human', confirm: 'Publish this version? It becomes the rule in force.' }) : ''}
      ${canP && d.state === 'published' ? act(`/api/policies/${d.id}/state`, 'Retire', { body: { state: 'retired' }, cls: 'btn-sm btn-ghost', confirm: 'Retire this document?' }) : ''}
      ${d.state === 'published' ? act(`/api/policies/${d.id}/ack`, 'I have read it', { cls: 'btn-sm' }) : ''}
      ${canM && d.state === 'published' ? officialCopyButton('policy', d.id) : ''}</div>
  </div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title">${esc(t('Text'))}</div>
      ${canM && d.state !== 'retired' ? `<form id="pl-edit"><label class="fl" for="pl-body">${esc(t('Body (Markdown)'))}</label>
        <textarea id="pl-body" name="body" rows="18" class="ent-editor" dir="auto">${esc(d.body)}</textarea>
        ${d.kind === 'process' ? `<label class="fl" for="pl-steps">${esc(t('Steps (JSON: step, role, input, output, control)'))}</label><textarea id="pl-steps" rows="8" class="ent-editor ltr">${esc(JSON.stringify(steps, null, 2))}</textarea>` : ''}
        <div class="inline" style="margin-top:8px"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button>
        <span class="hint">${esc(t(d.state === 'published' ? 'Saving a published document starts the next version as a draft.' : 'Saved as the working draft.'))}</span></div></form>`
    : `<pre class="ent-md" dir="auto">${esc(d.body)}</pre>`}
      ${steps.length ? `<div class="fl" style="margin-top:12px">${esc(t('Process steps'))}</div><table class="tbl"><thead><tr><th>#</th><th>${esc(t('Step'))}</th><th>${esc(t('Role'))}</th><th>${esc(t('Control'))}</th></tr></thead><tbody>
        ${steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.step)}<div class="sub">${esc(s.input || '')} → ${esc(s.output || '')}</div></td><td>${esc(s.role)}</td><td class="sub">${esc(s.control || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>
    <div class="stack">
      ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Ask the policy writer'))}</div>${form('pl-draft', [['instructions', 'What should it cover?', 'textarea', { rows: 3 }], ['lang', 'Language', 'select', { options: [['ar', 'Arabic'], ['en', 'English']] }]], 'Write a draft')}</div>` : ''}
      ${draftsPanel(d.drafts, { adopt: canM })}
      <div class="panel"><div class="panel-title">${esc(t('Versions'))}</div>${d.versions.length ? `<table class="tbl"><tbody>${d.versions.map((v) => `<tr><td>v${v.version}</td><td>${esc(t(v.note || ''))}</td><td class="sub">${esc(v.changed_by)} · ${ago(v.created_at)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('Not published yet.'))}</div>`}
        <div class="fl" style="margin-top:10px">${esc(t('Read by'))} (${d.acks.length})</div><div class="sub">${d.acks.map((a) => esc(a.username)).join(', ') || '—'}</div></div>
    </div>
  </div>`;
  wireActs(view, api, toast, () => renderPolicyDoc(id));
  wireOfficialCopy(view);
  $('#pl-edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    let stepsVal;
    try { stepsVal = $('#pl-steps') ? JSON.parse($('#pl-steps').value || '[]') : undefined; } catch { toast(t('The steps are not valid JSON'), true); return; }
    try { await api(`/api/policies/${id}/edit`, { method: 'POST', body: { body: $('#pl-body').value, ...(stepsVal ? { steps: stepsVal } : {}) } }); toast(t('Saved')); renderPolicyDoc(id); } catch (err) { toast(err.message, true); }
  });
  wireForm('pl-draft', `/api/policies/${id}/draft`, () => renderPolicyDoc(id));
  view.querySelectorAll('[data-adopt]').forEach((b) => b.addEventListener('click', () => {
    const dr = d.drafts.find((x) => String(x.id) === b.dataset.adopt);
    if ($('#pl-body') && dr?.body?.markdown) { $('#pl-body').value = dr.body.markdown; toast(t('Draft copied into the text — review it, then save')); }
    if ($('#pl-steps') && Array.isArray(dr?.body?.items) && dr.body.items.length) $('#pl-steps').value = JSON.stringify(dr.body.items, null, 2);
  }));
}

// ===================================================================== ISO ==

export async function renderIso() {
  const std = hashParam('standard') || 'ISO 9001';
  const d = await api(`/api/iso?standard=${encodeURIComponent(std)}`);
  const canM = hasPermC('iso.manage');
  const canV = hasPermC('iso.verify');
  const cur = d.standards.find((s) => s.code === d.standard);
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The ISO management systems clause by clause. Readiness counts what is implemented and verified; beside each clause is the evidence this platform already holds. A clause is verified by a person who checked the evidence, a nonconformity closes only when the corrective action worked.'))}</p></div>
  <div class="ent-cards">${d.standards.map((s) => `<a class="ent-card ${s.code === d.standard ? 'on' : ''}" href="#/iso?standard=${encodeURIComponent(s.code)}">
    <b class="ltr">${esc(s.code)}</b><span>${esc(t(s.title))}</span><div class="ent-meter"><i style="width:${s.readiness}%"></i></div><span>${s.readiness}% · ${s.gaps} ${esc(t('gaps'))}</span></a>`).join('')}</div>
  <div class="split2">
    <div class="panel">
      <div class="panel-title"><span class="ltr">${esc(d.standard)}</span> — ${cur.readiness}% ${canM ? act('/api/iso/gap', 'Ask for a gap analysis', { body: { standard: d.standard }, cls: 'btn-sm', done: 'The quality manager is writing' }) : ''}</div>
      <div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Clause'))}</th><th>${esc(t('Status'))}</th><th>${esc(t('Evidence'))}</th></tr></thead><tbody>
      ${d.clauses.map((c) => `<tr><td><b class="ltr">${esc(c.ref)}</b> ${esc(t(c.title))}${c.owner ? `<div class="sub">${esc(c.owner)}</div>` : ''}</td>
        <td>${canM ? `<label class="sr-only" for="iso-s-${c.id}">${esc(t('Status'))}</label><select id="iso-s-${c.id}" data-clause="${c.id}">${['not_started', 'partial', 'implemented', 'verified', 'na'].filter((s) => s !== 'verified' || canV || c.status === 'verified').map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${esc(t(s.replace('_', ' ')))}</option>`).join('')}</select>` : st(c.status)}</td>
        <td class="sub">${esc(c.evidence || '')}${c.platform ? `<div class="ent-ev">◆ ${esc(c.platform)}</div>` : ''}${canM ? ` <button type="button" class="btn btn-sm btn-ghost" data-evidence="${c.id}">${esc(t('Evidence'))}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('Nonconformities and corrective action'))}</div>
        ${d.ncrs.length ? `<table class="tbl"><tbody>${d.ncrs.map((n) => `<tr><td>${st(n.severity)}</td><td>${esc(n.description)}<div class="sub">${esc(n.standard || '')} ${esc(n.clause_ref || '')} · ${esc(n.owner || '—')}${n.root_cause ? ` · ${esc(t('cause'))}: ${esc(n.root_cause)}` : ''}</div></td><td>${st(n.state)}</td>
          <td>${canM && n.state === 'open' ? `<button class="btn btn-sm" data-ncr="${n.id}" data-to="action">${esc(t('Root cause'))}</button>` : ''}
            ${canM && n.state === 'action' ? `<button class="btn btn-sm" data-ncr="${n.id}" data-to="verify">${esc(t('Action taken'))}</button>` : ''}
            ${canV && n.state === 'verify' ? `<button class="btn btn-sm btn-human" data-ncr="${n.id}" data-to="closed">${esc(t('It worked — close'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No nonconformities recorded.'))}</div>`}
        ${canM ? form('iso-ncr', [['standard', 'Standard', 'select', { options: d.standards.map((s) => [s.code, s.code]), value: d.standard }], ['clauseRef', 'Clause'], ['severity', 'Severity', 'select', { options: ['minor', 'major', 'observation'] }], ['source', 'Source', 'select', { options: ['internal', 'audit', 'customer', 'supplier'] }], ['owner', 'Owner'], ['due', 'Due', 'date'], ['description', 'What was found', 'textarea', { required: true }]], 'Raise') : ''}
      </div>
      <div class="panel"><div class="panel-title">${esc(t('Management review'))}</div>
        ${d.reviews.length ? `<table class="tbl"><tbody>${d.reviews.map((r) => `<tr><td class="ltr">${esc(r.standard)}</td><td>${esc(r.decisions)}</td><td class="sub">${esc(r.held_on)}</td><td>${canM ? officialCopyButton('review', r.id) : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No management review held yet.'))}</div>`}
        ${canV ? form('iso-rev', [['standard', 'Standard', 'select', { options: d.standards.map((s) => [s.code, s.code]), value: d.standard }], ['attendees', 'Attendees'], ['decisions', 'Decisions', 'textarea', { required: true }]], 'Record the review') : ''}
      </div>
      ${draftsPanel(d.drafts)}
    </div>
  </div>`;
  wireActs(view, api, toast, renderIso);
  wireOfficialCopy(view);
  view.querySelectorAll('[data-clause]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/iso/clause/${s.dataset.clause}`, { method: 'POST', body: { status: s.value } }); toast(t('Saved')); renderIso(); } catch (e) { toast(e.message, true); renderIso(); }
  }));
  view.querySelectorAll('[data-evidence]').forEach((b) => b.addEventListener('click', async () => {
    const v = window.prompt(t('Evidence for this clause — a document code, a record, a link:'));
    if (v == null) return;
    try { await api(`/api/iso/clause/${b.dataset.evidence}`, { method: 'POST', body: { evidence: v } }); renderIso(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ncr]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.to; const body = { to };
    if (to === 'action') { body.rootCause = window.prompt(t('Why did it happen? (root cause)')); if (!body.rootCause) return; }
    if (to === 'verify') { body.correctiveAction = window.prompt(t('What was done so it cannot happen again?')); if (!body.correctiveAction) return; }
    if (to === 'closed') { if (!window.confirm(t('Was the corrective action effective?'))) return; body.effective = true; }
    try { await api(`/api/iso/ncr/${b.dataset.ncr}`, { method: 'POST', body }); renderIso(); } catch (e) { toast(e.message, true); }
  }));
  wireForm('iso-ncr', '/api/iso/ncr', () => renderIso());
  wireForm('iso-rev', '/api/iso/review', () => renderIso());
}

// ========================================================== internal audit ==

const TEST_LABEL = { unbalanced: 'Unbalanced entries', weekend: 'Manual postings on non-working days', round: 'Large round amounts', duplicates: 'Possible duplicates', nearLimit: 'Just under the approval limit', selfApproved: 'Posted by their own author' };

export async function renderInternalAudit() {
  const d = await api('/api/internalaudit');
  const canM = hasPermC('ia.manage');
  const canC = hasPermC('ia.close');
  const a = d.analytics;
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Independent assurance that the company’s controls work. The plan puts high-risk areas that have gone longest without a look first; findings follow criteria, condition, cause, effect and recommendation; nobody verifies their own action. The financial audit reads every posted journal entry.'))}</p></div>
  <div class="kpis">
    ${kpi('Auditable areas', d.entities)}
    ${kpi('Engagements', d.engagements.length, `${d.engagements.filter((e) => e.state !== 'closed').length} ${esc(t('in progress'))}`)}
    ${kpi('Open findings', d.findings.filter((f) => f.state !== 'verified').length, `${d.findings.filter((f) => f.rating === 'high' && f.state !== 'verified').length} ${esc(t('high'))}`, d.findings.some((f) => f.rating === 'high' && f.state !== 'verified') ? 'bad' : '')}
    ${kpi('Overdue actions', d.overdue, '', d.overdue ? 'bad' : 'ok')}
  </div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Risk-based plan'))}</div>
      <table class="tbl"><thead><tr><th>${esc(t('Area'))}</th><th>${esc(t('Risk'))}</th><th>${esc(t('Last audited'))}</th><th>${esc(t('Priority'))}</th></tr></thead><tbody>
      ${d.plan.map((e) => `<tr><td>${esc(t(e.name))}</td><td>${canM ? `<label class="sr-only" for="ia-r-${e.id}">${esc(t('Risk'))}</label><select id="ia-r-${e.id}" data-risk="${e.id}">${[1, 2, 3, 4, 5].map((r) => `<option ${e.risk === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : e.risk}</td>
        <td class="sub">${e.last_audited ? ago(e.last_audited) : esc(t('never'))}</td><td><b>${e.priority}</b> ${canM ? `<button class="btn btn-sm btn-ghost" data-plan="${e.id}" data-name="${esc(e.name)}">${esc(t('Plan an audit'))}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="panel"><div class="panel-title">${esc(t('Financial audit — tests over the journal'))}</div>
      ${canM ? form('ia-an', [['from', 'From date', 'date'], ['to', 'To date', 'date'], ['limit', 'Approval limit', 'number', { value: 5000 }]], 'Run the tests') : ''}
      ${a ? `<div class="sub" style="margin-top:8px">${a.entries} ${esc(t('entries tested'))} · ${a.exceptions} ${esc(t('exceptions'))} · ${ago(a.created_at)}</div>
        <table class="tbl"><tbody>${Object.entries(a.results.tests).map(([k, v]) => `<tr><td>${esc(t(TEST_LABEL[k] || k))}</td><td>${v.length ? `<b>${v.length}</b>` : '0'}</td>
          <td>${v.length && canM ? act(`/api/internalaudit/analytics/${a.id}/raise`, 'Raise a finding', { body: { test: k }, cls: 'btn-sm' }) : ''}</td></tr>`).join('')}
          <tr><td>${esc(t('Benford’s law (first digits)'))}</td><td colspan="2">${a.results.benford.chiSquare != null ? `χ² ${a.results.benford.chiSquare} ${a.results.benford.conforms ? `<span class="chip chip-ok">${esc(t('conforms'))}</span>` : `<span class="chip chip-bad">${esc(t('does not conform'))}</span>`}` : `<span class="sub">${esc(t(a.results.benford.note))}</span>`}</td></tr></tbody></table>` : `<div class="empty">${esc(t('No test run yet.'))}</div>`}
    </div>
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Engagements'))}</div>
    ${d.engagements.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.engagements.map((e) => `<tr><td><b>${esc(e.title)}</b><div class="sub">${esc(t(e.kind))}${e.area ? ` · ${esc(t(e.area))}` : ''} · ${e.findings} ${esc(t('findings'))}</div></td><td>${st(e.state)} ${e.opinion ? st(e.opinion) : ''}</td>
      <td class="inline">${canM ? act(`/api/internalaudit/engagement/${e.id}/programme`, 'Draft the programme', { cls: 'btn-sm btn-ghost', done: 'The internal auditor is writing' }) : ''}
        ${canC && e.state !== 'closed' ? `<button class="btn btn-sm" data-adv="${e.id}" data-state="${e.state}">${esc(t('Next stage'))}</button>` : ''}
        ${canM && ['followup', 'closed'].includes(e.state) ? officialCopyButton('audit', e.id) : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t('No engagements yet. Plan one from the risk-based plan.'))}</div>`}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Findings'))}</div>
    ${d.findings.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.findings.map((f) => `<tr><td>${st(f.rating)}</td><td><b>${esc(f.title)}</b><div class="sub">${esc(f.condition || '')}${f.action_plan ? ` · ${esc(t('action'))}: ${esc(f.action_plan)}` : ''}</div></td><td>${st(f.state)}</td>
      <td>${canC && f.state === 'open' ? `<button class="btn btn-sm" data-find="${f.id}" data-to="in_progress">${esc(t('Agree action'))}</button>` : ''}
        ${canC && f.state === 'in_progress' ? `<button class="btn btn-sm" data-find="${f.id}" data-to="implemented">${esc(t('Implemented'))}</button>` : ''}
        ${canC && f.state === 'implemented' ? `<button class="btn btn-sm btn-human" data-find="${f.id}" data-to="verified">${esc(t('Verify'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t('No findings.'))}</div>`}
  </div>
  ${draftsPanel(d.drafts)}`;
  wireActs(view, api, toast, renderInternalAudit);
  wireOfficialCopy(view);
  wireForm('ia-an', '/api/internalaudit/analytics', () => renderInternalAudit());
  view.querySelectorAll('[data-risk]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/internalaudit/entity/${s.dataset.risk}/risk`, { method: 'POST', body: { risk: Number(s.value) } }); renderInternalAudit(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/internalaudit/engagement', { method: 'POST', body: { entityId: Number(b.dataset.plan), title: `${t('Audit of')} ${t(b.dataset.name)}` } }); renderInternalAudit(); } catch (e) { toast(e.message, true); }
  }));
  const NEXT = { planned: 'fieldwork', fieldwork: 'reporting', reporting: 'followup', followup: 'closed' };
  view.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', async () => {
    const to = NEXT[b.dataset.state]; const body = { to };
    if (to === 'followup') { body.opinion = window.prompt(t('Opinion: satisfactory, needs_improvement or unsatisfactory'), 'needs_improvement'); if (!body.opinion) return; }
    try { await api(`/api/internalaudit/engagement/${b.dataset.adv}/advance`, { method: 'POST', body }); renderInternalAudit(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-find]').forEach((b) => b.addEventListener('click', async () => {
    const body = { to: b.dataset.to };
    if (body.to === 'in_progress') { body.actionPlan = window.prompt(t('The action management agreed, with its owner and date:')); if (!body.actionPlan) return; }
    try { await api(`/api/internalaudit/finding/${b.dataset.find}`, { method: 'POST', body }); renderInternalAudit(); } catch (e) { toast(e.message, true); }
  }));
}

// ========================================================= transformation ==

const DIM_LABEL = { strategy: 'Strategy', customer: 'Customer', operations: 'Operations', technology: 'Technology', data: 'Data', people: 'People and culture' };

export async function renderTransformation() {
  const d = await api('/api/transformation');
  const canM = hasPermC('dtx.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Where the company stands on six dimensions, the initiatives that will move it, and whether each one moved its number. The weakest dimension is where the roadmap should lean.'))}</p></div>
  <div class="kpis">
    ${kpi('Maturity', d.overall != null ? `${d.overall}/5` : '—', d.weakest ? `${esc(t('weakest'))}: ${esc(t(DIM_LABEL[d.weakest]))}` : esc(t('not assessed yet')))}
    ${kpi('Initiatives', d.initiatives.length, `${d.byStage.live} ${esc(t('live'))} · ${d.byStage.in_progress} ${esc(t('in progress'))}`)}
    <div class="kpi"><div class="k-label">${esc(t('Maturity over time'))}</div>${spark(d.history.map((h) => h.overall).reverse(), { max: 5 })}</div>
  </div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Maturity assessment'))}</div>
      ${canM ? `<form id="dx-assess" class="fields">${d.dimensions.map((x) => `<div class="wide"><label class="fl" for="dx-${x.id}">${esc(t(DIM_LABEL[x.id]))}</label>
        <select id="dx-${x.id}" name="${x.id}">${x.levels.map((l, i) => `<option value="${i + 1}" ${x.score === i + 1 ? 'selected' : ''}>${i + 1} — ${esc(t(l))}</option>`).join('')}</select></div>`).join('')}
        <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Record the assessment'))}</button></div></form>`
    : d.dimensions.map((x) => `<div class="kv"><span>${esc(t(DIM_LABEL[x.id]))}</span><b>${x.score ?? '—'}</b></div>`).join('')}
    </div>
    <div class="panel"><div class="panel-title">${esc(t('Roadmap'))} ${canM ? act('/api/transformation/roadmap', 'Draft the roadmap', { cls: 'btn-sm', done: 'The transformation lead is writing' }) : ''}</div>
      ${draftsPanel(d.drafts).replace('<div class="panel">', '<div>')}
      ${canM ? `<div class="fl" style="margin-top:12px">${esc(t('New initiative'))}</div>${form('dx-new', [['title', 'Title', 'text', { required: true, wide: true }], ['dimension', 'Dimension', 'select', { options: Object.entries(DIM_LABEL) }], ['quarter', 'Quarter'], ['value', 'Value (1–5)', 'number', { value: 3 }], ['effort', 'Effort (1–5)', 'number', { value: 3 }], ['kpi', 'KPI'], ['baseline', 'Baseline', 'number', { step: 'any' }], ['target', 'Target', 'number', { step: 'any' }], ['problem', 'Problem it solves', 'textarea', { rows: 2 }]])}` : ''}
    </div>
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Initiative portfolio'))}</div>
    ${d.initiatives.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Initiative'))}</th><th>${esc(t('Value / effort'))}</th><th>${esc(t('Stage'))}</th><th>${esc(t('KPI'))}</th><th></th></tr></thead><tbody>
      ${d.initiatives.map((i) => `<tr><td><b>${esc(i.title)}</b><div class="sub">${esc(t(DIM_LABEL[i.dimension]))} · ${esc(i.quarter || '')} · ${esc(t(i.quadrant))}</div></td><td>${i.value}/${i.effort}</td><td>${st(i.stage)}</td>
        <td class="sub">${esc(i.kpi || '—')}${i.progress != null ? ` · ${i.progress}%` : ''}</td>
        <td>${canM ? `<label class="sr-only" for="dx-st-${i.id}">${esc(t('Stage'))}</label><select id="dx-st-${i.id}" data-dxstage="${i.id}">${['idea', 'approved', 'in_progress', 'live', 'retired'].map((s) => `<option value="${s}" ${i.stage === s ? 'selected' : ''}>${esc(t(s.replace('_', ' ')))}</option>`).join('')}</select>
          <button class="btn btn-sm btn-ghost" data-dxval="${i.id}">${esc(t('Reading'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyCta('No initiatives yet', 'Add the first change the company should make, with the number it should move.')}
  </div>`;
  wireActs(view, api, toast, renderTransformation);
  $('#dx-assess')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const scores = Object.fromEntries([...e.target.elements].filter((x) => x.name).map((x) => [x.name, Number(x.value)]));
    try { await api('/api/transformation/assess', { method: 'POST', body: { scores } }); toast(t('Saved')); renderTransformation(); } catch (err) { toast(err.message, true); }
  });
  wireForm('dx-new', '/api/transformation/initiative', () => renderTransformation());
  view.querySelectorAll('[data-dxstage]').forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/api/transformation/initiative/${s.dataset.dxstage}`, { method: 'POST', body: { stage: s.value } }); renderTransformation(); } catch (e) { toast(e.message, true); renderTransformation(); }
  }));
  view.querySelectorAll('[data-dxval]').forEach((b) => b.addEventListener('click', async () => {
    const v = window.prompt(t('The KPI’s current value:'));
    if (v == null || v === '') return;
    try { await api(`/api/transformation/initiative/${b.dataset.dxval}`, { method: 'POST', body: { current: Number(v) } }); renderTransformation(); } catch (e) { toast(e.message, true); }
  }));
}

// ============================================================== production ==

export async function renderProduction() {
  const id = hashParam('id');
  if (id) return renderProductionOne(Number(id));
  const d = await api('/api/production');
  const canM = hasPermC('production.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Films, adverts, series and podcasts from the first line to delivery. Scripts are kept in Fountain, so the breakdown — scenes, locations, characters, running time — is read from the script itself. Delivered work goes into the archive; the copywriting desk is below.'))}</p></div>
  <div class="kpis">${['development', 'preproduction', 'production', 'post', 'delivered'].map((s) => kpi(s.replace('_', ' '), d.byStage[s])).join('')}${kpi('Over budget', d.overBudget, '', d.overBudget ? 'bad' : '')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Productions'))}</div>
    ${d.productions.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.productions.map((p) => `<tr><td><a href="#/production?id=${p.id}"><b>${esc(p.title)}</b></a><div class="sub">${esc(t(p.kind))} · ${esc(p.owner || '')}</div></td><td>${st(p.stage)}</td>
      <td class="sub">${money(p.spent)} / ${money(p.budget)}</td><td class="sub">${esc(p.due || '')}</td></tr>`).join('')}</tbody></table></div>` : emptyCta('No productions yet', 'Start one with a title and a logline.')}
    ${canM ? `<div class="fl" style="margin-top:12px">${esc(t('New production'))}</div>${form('pr-new', [['title', 'Title', 'text', { required: true }], ['kind', 'Kind', 'select', { options: ['ad', 'film', 'series', 'corporate', 'podcast', 'social'] }], ['budget', 'Budget', 'number', { step: 'any' }], ['due', 'Due', 'date'], ['owner', 'Owner'], ['logline', 'Logline', 'textarea', { rows: 2 }]], 'Create')}` : ''}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Copywriting desk'))}</div>
    ${d.briefs.length ? d.briefs.map((b) => `<div class="ent-draft"><b>${esc(b.product)}</b> <span class="sub">${esc(b.channel || '')} · ${esc(b.audience || '')}</span> ${st(b.state)}
      ${b.chosen ? `<pre class="ent-md" dir="auto">${esc(b.chosen)}</pre>` : ''}
      ${(b.drafts[0]?.body?.items || []).map((v, i) => `<div class="ent-variant" dir="auto"><b>${esc(v.headline || '')}</b><div>${esc(v.body || '')}</div><div class="sub">${esc(v.cta || '')}</div>
        ${canM && !b.chosen ? `<button class="btn btn-sm" data-choose="${b.id}" data-i="${i}">${esc(t('Use this one'))}</button>` : ''}</div>`).join('')}
      ${b.drafts[0]?.state === 'thinking' ? `<div class="sub">${esc(t('being written…'))}</div>` : ''}
      ${b.drafts[0]?.state === 'ready' && !(b.drafts[0].body?.items || []).length ? `<pre class="ent-md">${esc(b.drafts[0].body?.markdown || '')}</pre>` : ''}</div>`).join('') : `<div class="empty">${esc(t('No copy briefs yet.'))}</div>`}
    ${canM ? `<div class="fl" style="margin-top:12px">${esc(t('New brief'))}</div>${form('cp-new', [['product', 'What is it for?', 'text', { required: true }], ['audience', 'Audience'], ['goal', 'Goal'], ['channel', 'Channel'], ['tone', 'Tone'], ['lang', 'Language', 'select', { options: [['ar', 'Arabic'], ['en', 'English']] }]], 'Write five variants')}` : ''}
  </div>`;
  wireForm('pr-new', '/api/production', (r) => { location.hash = `#/production?id=${r.id}`; });
  wireForm('cp-new', '/api/production/copy', () => renderProduction());
  view.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
    const br = d.briefs.find((x) => String(x.id) === b.dataset.choose);
    const v = br.drafts[0].body.items[Number(b.dataset.i)];
    try { await api(`/api/production/copy/${br.id}/choose`, { method: 'POST', body: { text: `${v.headline}\n${v.body}\n${v.cta}` } }); renderProduction(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderProductionOne(id) {
  const p = await api(`/api/production/${id}`);
  const canM = hasPermC('production.manage');
  const b = p.breakdown;
  view.innerHTML = `
  <div class="pg-head"><p><a href="#/production">← ${esc(t('Production studio'))}</a></p>
    <h2 style="margin:6px 0" dir="auto">${esc(p.title)}</h2>
    <div class="inline">${st(p.stage)} <span class="chip">${esc(t(p.kind))}</span> <span class="chip">${money(p.spent)} / ${money(p.budget)}</span>
      ${canM && p.stage !== 'delivered' ? act(`/api/production/${p.id}/advance`, p.stage === 'post' ? 'Deliver and archive' : 'Next stage', { cls: `btn-sm ${p.stage === 'post' ? 'btn-human' : ''}` }) : ''}
      ${p.archive_id ? `<a class="chip chip-ok" href="#/archive">${esc(t('In the archive'))}</a>` : ''}</div>
    <p class="sub" dir="auto">${esc(p.logline || '')}</p>
  </div>
  <div class="kpis">${kpi('Scenes', b.scenes.length)}${kpi('Running time', b.minutes ? `~${b.minutes} ${esc(t('min'))}` : esc(t('under a minute')), `${b.pages} ${esc(t('pages'))}`)}${kpi('Characters', b.characters.length)}${kpi('Locations', b.locations.length, `${b.nightScenes} ${esc(t('night scenes'))}`)}</div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Script (Fountain)'))}</div>
      ${canM && p.stage !== 'delivered' ? `<form id="pr-script"><label class="sr-only" for="pr-s">${esc(t('Script (Fountain)'))}</label><textarea id="pr-s" rows="24" class="ent-editor" dir="auto">${esc(p.script)}</textarea>
        <div class="inline" style="margin-top:8px"><button class="btn btn-primary" type="submit">${esc(t('Save'))}</button>
        <span class="hint">${esc(t('INT./EXT. LOCATION - DAY starts a scene; a name in capitals before dialogue is a character.'))}</span></div></form>` : `<pre class="ent-md" dir="auto">${esc(p.script)}</pre>`}
      ${canM && p.stage !== 'delivered' ? `<div class="fl" style="margin-top:12px">${esc(t('Ask the screenwriter'))}</div>${form('pr-write', [['instructions', 'Which scenes, and what happens in them?', 'textarea', { rows: 3 }], ['lang', 'Language', 'select', { options: [['ar', 'Arabic'], ['en', 'English']] }]], 'Write scenes')}` : ''}
      ${draftsPanel(p.drafts, { adopt: canM })}
    </div>
    <div class="stack">
      <div class="panel"><div class="panel-title">${esc(t('Scene breakdown'))}</div>
        ${b.scenes.length ? `<table class="tbl"><tbody>${b.scenes.map((s) => `<tr><td>${s.n}</td><td dir="auto"><b>${esc(s.heading)}</b><div class="sub">${esc(s.characters.join(', '))}</div></td><td class="sub">${esc(t(s.interior ? 'interior' : 'exterior'))}${s.time ? ` · ${esc(s.time)}` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No scenes yet — start a line with INT. or EXT.'))}</div>`}</div>
      <div class="panel"><div class="panel-title">${esc(t('Characters'))}</div>
        ${b.characters.length ? `<table class="tbl"><tbody>${b.characters.map((c) => `<tr><td dir="auto">${esc(c.name)}</td><td>${c.lines} ${esc(t('lines'))}</td><td class="sub">${esc(t('scenes'))} ${c.scenes.join(', ')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No dialogue yet.'))}</div>`}</div>
    </div>
  </div>`;
  wireActs(view, api, toast, () => renderProductionOne(id));
  $('#pr-script')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/production/${id}/script`, { method: 'POST', body: { script: $('#pr-s').value } }); toast(t('Saved')); renderProductionOne(id); } catch (err) { toast(err.message, true); }
  });
  wireForm('pr-write', `/api/production/${id}/write`, () => renderProductionOne(id));
  view.querySelectorAll('[data-adopt]').forEach((btn) => btn.addEventListener('click', () => {
    const dr = p.drafts.find((x) => String(x.id) === btn.dataset.adopt);
    if ($('#pr-s') && dr?.body?.markdown) { $('#pr-s').value = `${$('#pr-s').value.trimEnd()}\n\n${dr.body.markdown}`; toast(t('Draft added to the script — review it, then save')); }
  }));
}

// ============================================================ operations ==

export async function renderOpscenter() {
  const d = await api('/api/opscenter');
  const canM = hasPermC('opscenter.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Whether the company’s processes are performing, from numbers rather than status meetings. Each KPI belongs to a process and has a target and a warning line; a reading past the warning line opens an issue with an owner.'))}</p></div>
  <div class="kpis">${kpi('On target', d.rag.green, '', 'ok')}${kpi('Short of target', d.rag.amber, '', d.rag.amber ? 'human' : '')}${kpi('Past the warning line', d.rag.red, '', d.rag.red ? 'bad' : '')}${kpi('Open issues', d.issues.filter((i) => i.state === 'open').length)}</div>
  <div class="panel"><div class="panel-title">${esc(t('KPIs'))}</div>
    ${d.kpis.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('KPI'))}</th><th>${esc(t('Last'))}</th><th>${esc(t('Target'))}</th><th>${esc(t('Trend'))}</th><th></th></tr></thead><tbody>
      ${d.kpis.map((k) => `<tr><td><b>${esc(k.name)}</b><div class="sub">${esc(k.process_code || '')} ${esc(k.process_title || '')} · ${esc(k.owner || '')}</div></td>
        <td>${st(k.state)} ${k.last != null ? `${k.last}${esc(k.unit || '')}` : ''}</td><td class="sub">${k.better === 'up' ? '≥' : '≤'} ${k.target}${esc(k.unit || '')}${k.warn != null ? ` · ${esc(t('warn'))} ${k.warn}` : ''}</td>
        <td class="mk-sparkcell">${spark(k.readings.map((r) => r.value))}</td>
        <td>${canM ? `<button class="btn btn-sm" data-read="${k.id}">${esc(t('Record'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyCta('No KPIs yet', 'Add the number each process is judged by.')}
    ${canM ? `<div class="fl" style="margin-top:12px">${esc(t('New KPI'))}</div>${form('op-kpi', [['name', 'Name', 'text', { required: true }], ['processId', 'Process', 'select', { options: [['', '—'], ...d.processes.map((p) => [p.id, `${p.code} ${p.title}`])] }], ['unit', 'Unit'], ['better', 'Better when', 'select', { options: [['up', 'higher'], ['down', 'lower']] }], ['target', 'Target', 'number', { required: true, step: 'any' }], ['warn', 'Warning line', 'number', { step: 'any' }], ['owner', 'Owner']])}` : ''}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Issues'))}</div>
    ${d.issues.length ? `<table class="tbl"><tbody>${d.issues.map((i) => `<tr><td>${st(i.severity)}</td><td><b>${esc(i.title)}</b><div class="sub">${esc(i.owner || '—')}${i.resolution ? ` · ${esc(i.resolution)}` : ''}</div></td><td>${st(i.state)}</td>
      <td>${canM && i.state === 'open' ? `<button class="btn btn-sm" data-close="${i.id}">${esc(t('Close'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No issues.'))}</div>`}
    ${canM ? form('op-issue', [['title', 'Issue', 'text', { required: true, wide: true }], ['severity', 'Severity', 'select', { options: ['medium', 'high', 'low'] }], ['owner', 'Owner'], ['due', 'Due', 'date']], 'Log it') : ''}
  </div>`;
  wireForm('op-kpi', '/api/opscenter/kpi', () => renderOpscenter(), (b) => ({ ...b, processId: b.processId ? Number(b.processId) : null }));
  wireForm('op-issue', '/api/opscenter/issue', () => renderOpscenter());
  view.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    const v = window.prompt(t('Today’s reading:')); if (v == null || v === '') return;
    try { const r = await api(`/api/opscenter/kpi/${b.dataset.read}/reading`, { method: 'POST', body: { value: Number(v) } }); toast(t(r.state)); renderOpscenter(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    const v = window.prompt(t('What was done about it?')); if (!v) return;
    try { await api(`/api/opscenter/issue/${b.dataset.close}/close`, { method: 'POST', body: { resolution: v } }); renderOpscenter(); } catch (e) { toast(e.message, true); }
  }));
}

// ================================================================ strategy ==

const SWOT = [['strength', 'Strengths'], ['weakness', 'Weaknesses'], ['opportunity', 'Opportunities'], ['threat', 'Threats'], ['theme', 'Strategic themes']];

export async function renderStrategy() {
  const d = await api('/api/strategy');
  const canM = hasPermC('strategy.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Where the company is going and what it might buy on the way. The SWOT and themes are written by people; the strategy analyst turns them into a brief. Making an offer and closing a deal are a person’s acts.'))}</p></div>
  <div class="ent-swot">${SWOT.map(([k, label]) => `<div class="panel"><div class="panel-title">${esc(t(label))}</div>
    <ul class="ent-list">${(d.items[k] || []).map((i) => `<li dir="auto">${esc(i.text)} ${canM ? `<button class="btn btn-sm btn-ghost" data-rm="${i.id}" aria-label="${esc(t('Remove'))}">×</button>` : ''}</li>`).join('') || `<li class="sub">—</li>`}</ul>
    ${canM ? `<form class="form-inline" data-swot="${k}"><label class="sr-only" for="sw-${k}">${esc(t(label))}</label><input id="sw-${k}" required><button class="btn btn-sm" type="submit">${esc(t('Add'))}</button></form>` : ''}</div>`).join('')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Strategy brief'))} ${canM ? act('/api/strategy/brief', 'Draft the brief', { cls: 'btn-sm', done: 'The strategy analyst is writing' }) : ''}</div>${draftsPanel(d.drafts).replace('<div class="panel">', '<div>')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Acquisition pipeline'))}</div>
    <div class="inline">${d.pipeline.filter((x) => x.count).map((x) => `<span class="chip">${esc(t(x.stage))} ${x.count}${x.ev ? ` · ${money(x.ev)}` : ''}</span>`).join('') || `<span class="sub">${esc(t('No targets yet.'))}</span>`}</div>
    ${d.deals.length ? `<div class="mk-scroll"><table class="tbl"><thead><tr><th>${esc(t('Target'))}</th><th>${esc(t('Stage'))}</th><th>${esc(t('Implied value'))}</th><th></th></tr></thead><tbody>${d.deals.map((x) => `<tr><td><b dir="auto">${esc(x.target)}</b><div class="sub">${esc(x.sector || '')} · ${esc(x.thesis || '')}</div></td><td>${st(x.stage)}</td>
      <td class="sub">${x.ev != null ? `${money(x.ev)} (${money(x.ebitda)} × ${x.multiple})` : '—'}</td>
      <td>${canM ? `<label class="sr-only" for="dl-${x.id}">${esc(t('Stage'))}</label><select id="dl-${x.id}" data-deal="${x.id}">${['screening', 'contact', 'nda', 'diligence', 'offer', 'closing', 'closed', 'dropped'].map((s) => `<option value="${s}" ${x.stage === s ? 'selected' : ''}>${esc(t(s))}</option>`).join('')}</select>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${canM ? form('st-deal', [['target', 'Target company', 'text', { required: true }], ['sector', 'Sector'], ['revenue', 'Revenue', 'number', { step: 'any' }], ['ebitda', 'EBITDA', 'number', { step: 'any' }], ['multiple', 'EV / EBITDA multiple', 'number', { step: 'any' }], ['owner', 'Owner'], ['thesis', 'Thesis', 'textarea', { rows: 2 }]], 'Add target') : ''}
  </div>`;
  wireActs(view, api, toast, renderStrategy);
  view.querySelectorAll('[data-swot]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/strategy/item', { method: 'POST', body: { kind: f.dataset.swot, text: f.querySelector('input').value } }); renderStrategy(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/strategy/item/${b.dataset.rm}/remove`, { method: 'POST', body: {} }); renderStrategy(); } catch (e) { toast(e.message, true); } }));
  view.querySelectorAll('[data-deal]').forEach((s) => s.addEventListener('change', async () => { try { await api(`/api/strategy/deal/${s.dataset.deal}`, { method: 'POST', body: { stage: s.value } }); renderStrategy(); } catch (e) { toast(e.message, true); renderStrategy(); } }));
  wireForm('st-deal', '/api/strategy/deal', () => renderStrategy());
}

// =============================================================== insurance ==

export async function renderInsurance() {
  const d = await api('/api/insurance');
  const canM = hasPermC('insurance.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('What the company is covered for and until when. Renewals within sixty days come first, every line with no cover is named, and a claim is followed from the incident to the money or the refusal.'))}</p></div>
  <div class="kpis">${kpi('Policies in force', d.policies.filter((p) => p.status === 'in force').length)}${kpi('Renewing within 60 days', d.renewals.length, '', d.renewals.length ? 'human' : '')}${kpi('Annual premiums', money(d.premiums))}${kpi('Lines with no cover', d.uncovered.length, esc(d.uncovered.map((l) => t(l)).join(', ')), d.uncovered.length ? 'bad' : 'ok')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Policies'))}</div>
    ${d.policies.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.policies.map((p) => `<tr><td><b>${esc(t(p.line))}</b> · ${esc(p.insurer)}<div class="sub ltr">${esc(p.number || '')}</div></td><td>${st(p.status === 'in force' ? 'active' : p.status)}</td>
      <td class="sub">${esc(p.starts)} → ${esc(p.ends)}</td><td class="sub">${esc(t('cover'))} ${money(p.coverage)} · ${esc(t('premium'))} ${money(p.premium)}</td>
      <td>${canM && p.state === 'active' ? act(`/api/insurance/policy/${p.id}/cancel`, 'Cancel', { cls: 'btn-sm btn-ghost', confirm: 'Cancel this cover?' }) : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyCta('No policies registered', 'Register the company’s cover so lapses are seen before they matter.')}
    ${canM ? form('in-pol', [['insurer', 'Insurer', 'text', { required: true }], ['line', 'Line', 'select', { options: ['property', 'liability', 'cyber', 'health', 'fleet', 'directors', 'marine', 'other'] }], ['number', 'Policy number'], ['coverage', 'Coverage', 'number', { step: 'any' }], ['premium', 'Premium', 'number', { step: 'any' }], ['deductible', 'Deductible', 'number', { step: 'any' }], ['starts', 'Starts', 'date', { required: true }], ['ends', 'Ends', 'date', { required: true }], ['broker', 'Broker']], 'Register') : ''}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Claims'))}</div>
    ${d.claims.length ? `<table class="tbl"><tbody>${d.claims.map((c) => `<tr><td>${esc(t(c.line))} · ${esc(c.insurer)}<div class="sub">${esc(c.incident_date)} — ${esc(c.description)}</div></td><td>${st(c.state)}</td><td class="sub">${money(c.claimed)}${c.paid != null ? ` → ${money(c.paid)}` : ''}</td>
      <td>${canM && c.state === 'open' ? act(`/api/insurance/claim/${c.id}`, 'Submit to insurer', { body: { to: 'submitted' }, cls: 'btn-sm btn-human' }) : ''}
        ${canM && c.state === 'submitted' ? `<button class="btn btn-sm" data-settle="${c.id}">${esc(t('Settled'))}</button> ${act(`/api/insurance/claim/${c.id}`, 'Rejected', { body: { to: 'rejected' }, cls: 'btn-sm btn-ghost' })}` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No claims.'))}</div>`}
    ${canM && d.policies.some((p) => p.status === 'in force') ? form('in-claim', [['policyId', 'Policy', 'select', { options: d.policies.filter((p) => p.status === 'in force').map((p) => [p.id, `${p.line} · ${p.insurer}`]) }], ['incidentDate', 'Incident date', 'date', { required: true }], ['claimed', 'Amount claimed', 'number', { step: 'any' }], ['description', 'What happened', 'textarea', { required: true }]], 'File the claim') : ''}
  </div>`;
  wireActs(view, api, toast, renderInsurance);
  wireForm('in-pol', '/api/insurance/policy', () => renderInsurance());
  wireForm('in-claim', '/api/insurance/claim', () => renderInsurance(), (b) => ({ ...b, policyId: Number(b.policyId) }));
  view.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', async () => {
    const v = window.prompt(t('Amount paid:')); if (v == null || v === '') return;
    try { await api(`/api/insurance/claim/${b.dataset.settle}`, { method: 'POST', body: { to: 'settled', paid: Number(v) } }); renderInsurance(); } catch (e) { toast(e.message, true); }
  }));
}

// ===================================================================== AML ==

// The two reasons the system writes itself are a phrase plus the names that
// matched; a person's own reason is shown as they wrote it.
const SYSTEM_REASONS = ['name matches the watchlist', 'now matches a watchlisted name', 'matches a sanctions list'];
function alertReason(reason) {
  const r = String(reason || '');
  const p = SYSTEM_REASONS.find((x) => r.startsWith(`${x}: `));
  return p ? `${t(p)}: ${r.slice(p.length + 2)}` : r;
}

export async function renderAml() {
  const d = await api('/api/aml');
  const canM = hasPermC('aml.manage');
  const canD = hasPermC('aml.decide');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Who the company deals with and how risky they are. Each party is scored on recognised risk factors and screened against the watchlist; the score sets the depth of due diligence and the next review. An alert is cleared or reported by a person; reporting to the financial intelligence unit happens outside the platform and is recorded here with its reference.'))}</p></div>
  <div class="kpis">${kpi('High risk', d.byLevel.high, '', d.byLevel.high ? 'bad' : '')}${kpi('Medium risk', d.byLevel.medium)}${kpi('Low risk', d.byLevel.low)}${kpi('Open alerts', d.alerts.filter((a) => ['open', 'investigating'].includes(a.state)).length, '', d.alerts.some((a) => a.state === 'open') ? 'human' : '')}${kpi('Reviews due', d.reviewsDue, '', d.reviewsDue ? 'human' : 'ok')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Alerts'))}</div>
    ${d.alerts.length ? `<table class="tbl"><tbody>${d.alerts.map((a) => `<tr><td><b dir="auto">${esc(a.party || '—')}</b><div class="sub">${esc(alertReason(a.reason))}${a.note ? ` · ${esc(a.note)}` : ''}${a.report_ref ? ` · ${esc(t('report'))} ${esc(a.report_ref)}` : ''}</div></td><td>${st(a.state)}</td>
      <td>${canM && a.state === 'open' ? act(`/api/aml/alert/${a.id}`, 'Investigate', { body: { to: 'investigating' }, cls: 'btn-sm' }) : ''}
        ${canD && a.state === 'investigating' ? `<button class="btn btn-sm" data-alert="${a.id}" data-to="cleared">${esc(t('Clear'))}</button> <button class="btn btn-sm btn-human" data-alert="${a.id}" data-to="reported">${esc(t('Reported'))}</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No alerts.'))}</div>`}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Parties'))}</div>
    ${d.parties.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.parties.map((p) => `<tr><td><b dir="auto">${esc(p.name)}</b><div class="sub">${[t(p.kind), p.country || '—', p.industry, p.pep ? 'PEP' : null].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td>${st(p.risk_level)} <span class="sub">${p.risk_score}</span>${d.sanctionHits[p.id] ? ` ${chip('sanctions match', { 'sanctions match': 'chip-bad' })}` : ''}</td><td class="sub">${esc(t(p.cdd))} · ${esc(t('review'))} ${esc(p.next_review || '')}</td>
      <td class="sub">${(p.screening?.factors || []).map((f) => esc(t(f.why)) + (f.arg ? ` (<span dir="auto">${esc(f.arg)}</span>)` : '')).join(' · ')}</td>
      <td>${canM ? act(`/api/aml/party/${p.id}/review`, 'Due-diligence memo', { cls: 'btn-sm btn-ghost', done: 'The AML analyst is writing' }) : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyCta('No parties yet', 'Add the customers and counterparties the company deals with.')}
    ${canM ? form('aml-p', [['name', 'Name', 'text', { required: true }], ['kind', 'Kind', 'select', { options: ['company', 'individual'] }], ['country', 'Country (ISO code)'], ['industry', 'Industry'], ['channel', 'How the relationship started', 'select', { options: [['in_person', 'in person'], ['remote', 'remote'], ['intermediary', 'through an intermediary']] }], ['pep', 'Politically exposed person', 'checkbox']], 'Add and screen') : ''}
  </div>
  <div class="panel"><div class="panel-title">${esc(t('Sanctions lists'))}</div>
    <p class="hint">${esc(t('The UN and OFAC lists, downloaded once a day through the gate. Every party and every payment not yet released is screened again when they change.'))}</p>
    <table class="tbl"><tbody>${d.sanctions.lists.map((l) => `<tr><td><b>${esc(t(l.label))}</b><div class="sub ltr">${esc(l.url)}</div></td>
      <td>${st(l.state === 'ok' ? 'live' : l.state === 'never' ? 'not downloaded yet' : l.state)}</td><td class="sub">${l.entries ? `${Number(l.entries).toLocaleString()} ${esc(t('names'))}` : '—'}${l.fetched_at ? ` · ${ago(l.fetched_at)}` : ''}${l.error ? `<div>${esc(l.error)}</div>` : ''}</td></tr>`).join('')}</tbody></table>
    ${canM ? `<div class="inline" style="margin-top:10px">${d.sanctions.live
    ? `${act('/api/aml/sanctions/refresh', 'Refresh now', { cls: 'btn-sm', done: 'Lists refreshed and everyone rescreened' })} ${act('/api/aml/sanctions/live', 'Turn the lists off', { body: { on: false }, cls: 'btn-sm btn-ghost' })}`
    : act('/api/aml/sanctions/live', 'Turn the lists on', { body: { on: true }, cls: 'btn-sm btn-human', confirm: 'Download the UN and OFAC lists every day through the gate?' })}</div>` : ''}
  </div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Screening watchlist'))}</div>
      <div class="sub">${esc(t('High-risk countries'))}: <span class="ltr">${esc(d.highRiskCountries.join(', '))}</span></div>
      <ul class="ent-list">${d.watchlist.map((w) => `<li dir="auto">${esc(w.name)} <span class="sub">${esc(w.list)}</span></li>`).join('') || '<li class="sub">—</li>'}</ul>
      ${canD ? form('aml-w', [['name', 'Name to watch', 'text', { required: true }], ['list', 'List']], 'Add to the watchlist') : ''}</div>
    ${draftsPanel(d.drafts)}
  </div>`;
  wireActs(view, api, toast, renderAml);
  wireForm('aml-p', '/api/aml/party', (r) => { if (r.hits?.length || r.sanctions?.length) toast(t('Watchlist match — an alert was opened'), true); renderAml(); });
  wireForm('aml-w', '/api/aml/watchlist', () => renderAml());
  view.querySelectorAll('[data-alert]').forEach((b) => b.addEventListener('click', async () => {
    const body = { to: b.dataset.to, note: window.prompt(t('Why?')) };
    if (!body.note) return;
    if (body.to === 'reported') { body.reportRef = window.prompt(t('The reference the financial intelligence unit gave the report:')); if (!body.reportRef) return; }
    try { await api(`/api/aml/alert/${b.dataset.alert}`, { method: 'POST', body }); renderAml(); } catch (e) { toast(e.message, true); }
  }));
}

// ============================================================= remittances ==

export async function renderRemit() {
  const d = await api('/api/remit');
  const canM = hasPermC('remit.manage');
  const canR = hasPermC('remit.release');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('External transfers the bank approved, turned into MT103 or ISO 20022 pacs.008 messages. Each beneficiary’s IBAN is checksum-validated, every message is screened against the watchlist and carries a UETR, a second person approves it, and release produces the file for the bank’s portal. Nothing here connects to SWIFT.'))}</p></div>
  ${!d.orderingBic ? `<div class="callout">${esc(t('Set the company bank’s BIC before building messages — every message names the bank it is sent from.'))}</div>` : ''}
  ${d.orderingBic || canR ? `<div class="panel"><div class="panel-title">${esc(t('Company bank BIC'))}</div>
    ${d.orderingBic ? `<p><b class="ltr">${esc(d.orderingBic)}</b></p>` : ''}
    ${canR ? form('rm-bic', [['bic', 'BIC / SWIFT code', 'text', { required: true }]], d.orderingBic ? 'Change the BIC' : 'Set the BIC') : ''}</div>` : ''}
  <div class="kpis">${['draft', 'held', 'approved', 'released'].map((s) => kpi(s, d.byState[s] || 0, '', s === 'held' && d.byState.held ? 'bad' : '')).join('')}${kpi('Ready transfers', d.readyTransfers.length)}</div>
  <div class="panel"><div class="panel-title">${esc(t('Payment messages'))}</div>
    ${d.messages.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.messages.map((m) => `<tr><td><b dir="auto">${esc(m.beneficiary)}</b> <span class="sub">${esc(m.country)}</span><div class="sub ltr">${esc(m.format)} · UETR ${esc(m.uetr)}</div></td>
      <td class="ltr">${money(m.amount)} ${esc(m.currency)} · ${esc(m.charges)}</td><td>${st(m.state)}</td>
      <td class="inline">${canR && m.state === 'held' ? `<button class="btn btn-sm" data-clear="${m.id}">${esc(t('Clear the hit'))}</button>` : ''}
        ${canR && m.state === 'draft' ? act(`/api/remit/message/${m.id}/approve`, 'Approve', { cls: 'btn-sm btn-human' }) : ''}
        ${canR && m.state === 'approved' ? `<button class="btn btn-sm btn-human" data-release="${m.id}">${esc(t('Release the file'))}</button>` : ''}
        ${canR && m.state === 'released' ? officialCopyButton('payment', m.id) : ''}
        ${canM && !['released', 'cancelled'].includes(m.state) ? act(`/api/remit/message/${m.id}/cancel`, 'Cancel', { cls: 'btn-sm btn-ghost', confirm: 'Cancel this message?' }) : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t('No messages yet.'))}</div>`}
    ${canM && d.readyTransfers.length && d.beneficiaries.length ? `<div class="fl" style="margin-top:12px">${esc(t('Build a message'))}</div>${form('rm-msg', [
    ['transferId', 'Approved transfer', 'select', { options: d.readyTransfers.map((x) => [x.id, `#${x.id} · ${x.amount} ${x.currency} · ${x.beneficiary || ''}`]) }],
    ['beneficiaryId', 'Beneficiary', 'select', { options: d.beneficiaries.map((b) => [b.id, `${b.name} · ${b.bic}`]) }],
    ['format', 'Format', 'select', { options: ['MT103', 'pacs.008'] }], ['charges', 'Charges', 'select', { options: [['SHA', 'SHA — shared'], ['OUR', 'OUR — we pay all'], ['BEN', 'BEN — beneficiary pays']] }],
    ['currency', 'Currency'], ['valueDate', 'Value date', 'date'], ['remittanceInfo', 'Payment details (to the beneficiary)', 'text', { wide: true }]], 'Build and screen')}` : ''}
    ${canM && !d.readyTransfers.length ? `<p class="hint">${esc(t('A message is built from an external transfer approved in The bank.'))}</p>` : ''}
  </div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Beneficiaries'))}</div>
      ${d.beneficiaries.length ? `<table class="tbl"><tbody>${d.beneficiaries.map((b) => `<tr><td dir="auto"><b>${esc(b.name)}</b><div class="sub ltr">${esc(b.iban || b.account)} · ${esc(b.bic)} · ${esc(b.country)}</div></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No beneficiaries yet.'))}</div>`}
      ${canM ? form('rm-ben', [['name', 'Name', 'text', { required: true }], ['iban', 'IBAN'], ['account', 'Account number (if no IBAN)'], ['bic', 'BIC / SWIFT code', 'text', { required: true }], ['bankName', 'Bank'], ['country', 'Country (ISO code)', 'text', { required: true }], ['address', 'Address', 'text', { wide: true }]], 'Add beneficiary') : ''}</div>
    <div class="panel"><div class="panel-title">${esc(t('Screening watchlist'))}</div>
      <ul class="ent-list">${d.watchlist.map((w) => `<li dir="auto">${esc(w.name)} <span class="sub">${esc(w.source)}</span></li>`).join('') || '<li class="sub">—</li>'}</ul>
      ${canR ? form('rm-w', [['name', 'Name to watch', 'text', { required: true }], ['source', 'Source']], 'Add to the watchlist') : ''}</div>
  </div>`;
  wireActs(view, api, toast, renderRemit);
  wireOfficialCopy(view);
  wireForm('rm-ben', '/api/remit/beneficiary', () => renderRemit());
  wireForm('rm-w', '/api/remit/watchlist', () => renderRemit());
  wireForm('rm-bic', '/api/remit/ordering-bic', () => renderRemit());
  wireForm('rm-msg', '/api/remit/message', (r) => { if (r.state === 'held') toast(t('Screening hit — the message is held'), true); renderRemit(); },
    (b) => ({ ...b, transferId: Number(b.transferId), beneficiaryId: Number(b.beneficiaryId) }));
  view.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    const note = window.prompt(t('Why is the hit a different party?')); if (!note) return;
    try { await api(`/api/remit/message/${b.dataset.clear}/clear`, { method: 'POST', body: { note } }); renderRemit(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('Release this payment? The file is produced for the bank; upload it there to send it.'))) return;
    try {
      const r = await api(`/api/remit/message/${b.dataset.release}/release`, { method: 'POST', body: {} });
      const url = URL.createObjectURL(new Blob([r.file.content], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = r.file.name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      renderRemit();
    } catch (e) { toast(e.message, true); }
  }));
}

// The parts the other floors share: a form from a field list, the draft panel, the state chip.
export { form, wireForm, draftsPanel, st, money };
