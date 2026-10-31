// The working day: processes that run, paper read on this machine, meetings
// that end in tasks, WhatsApp, the customer and supplier portal, the board
// pack, insider risk — and the Ask page's answer from the company's own
// documents. The parts these share with the governance floor are imported
// from it rather than written twice.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { t } from '/i18n.js';
import { kpi, emptyCta, act, wireActs, ago, hashParam } from '../components/ui.js';
import { form, wireForm, draftsPanel, st, money } from './enterprise.js';
import { officialCopyButton, wireOfficialCopy } from './assurance.js';
import { mountLoopMap } from '../views/loopmap.js';

/** A chosen file as the API takes it: name, type and base64, read in the browser. */
function readFile(input) {
  const f = input?.files?.[0];
  if (!f) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, mime: f.type || 'application/octet-stream', data: String(r.result).replace(/^data:[^,]*,/, '') });
    r.onerror = () => reject(new Error(t('The file could not be read')));
    r.readAsDataURL(f);
  });
}
const fileField = (id, label, accept) => `<div class="wide"><label class="fl" for="${id}">${esc(t(label))}</label><input type="file" id="${id}" accept="${esc(accept)}"></div>`;
const when = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const who = (a) => esc(String(a || '—').replace(/^human:/, ''));
const back = (href, label) => `<p><a href="${href}">← ${esc(t(label))}</a></p>`;

// ===================================================== processes in motion ==

export async function renderProcRuns() {
  const id = hashParam('id');
  if (id) return renderProcRun(Number(id));
  const d = await api('/api/procruns');
  const canM = hasPermC('procruns.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('A published process, run: each step waits for its role with a due time, a step with a control is done only when the person says how the control held, and whoever did a step does not perform the control on it. The audit of a process reads its runs.'))}</p></div>
  <div class="kpis">${kpi('Open runs', d.runs.filter((r) => r.state === 'open').length)}${kpi('Waiting on you', d.mine, '', d.mine ? 'human' : '')}${kpi('Late steps', d.late, '', d.late ? 'bad' : 'ok')}${kpi('Control exceptions', d.exceptions, '', d.exceptions ? 'bad' : 'ok')}</div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Start a process'))}</div>
    ${d.processes.length ? form('pr-start', [['docId', 'Process', 'select', { options: d.processes.map((p) => [p.id, `${p.code} · ${p.title} (v${p.version})`]) }], ['title', 'What this run is for', 'text', { wide: true }]], 'Start')
    : `<p class="sub">${esc(t('No published process has steps yet — write one under Policies & procedures.'))}</p>`}</div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Runs'))}</div>
    ${d.runs.length ? `<div class="mk-scroll"><table class="tbl"><tbody>${d.runs.map((r) => `<tr>
      <td><a href="#/procruns?id=${r.id}"><b dir="auto">${esc(r.title)}</b></a><div class="sub ltr">${esc(r.doc_code)} v${r.version}</div></td>
      <td>${st(r.state)}</td>
      <td>${r.state === 'open' ? `<span dir="auto">${esc(r.active_step || '')}</span><div class="sub">${esc(r.active_role || '')} · ${esc(t('due'))} ${esc(when(r.active_due))}${r.active_assignee ? ` · ${who(r.active_assignee)}` : ''}</div>` : `<span class="sub">${ago(r.created_at)}</span>`}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('No runs yet.'))}</div>`}</div>
  <div class="panel"><div class="panel-title">${esc(t('Processes'))}</div>
    <table class="tbl"><thead><tr><th>${esc(t('Process'))}</th><th>${esc(t('Runs'))}</th><th>${esc(t('Rejected'))}</th><th>${esc(t('Average hours'))}</th></tr></thead><tbody>
    ${d.processes.map((p) => `<tr><td dir="auto"><span class="ltr">${esc(p.code)}</span> · ${esc(p.title)}</td><td>${p.runs}</td><td>${p.rejected}</td><td>${p.avg_hours ?? '—'}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table>
    <p class="hint">${esc(t('A step is late after'))} ${d.stepHours} ${esc(t('hours'))} (PROCESS_STEP_HOURS).</p></div>`;
  wireForm('pr-start', '/api/procruns', (r) => { location.hash = `#/procruns?id=${r.id}`; }, (b) => ({ ...b, docId: Number(b.docId) }));
}

async function renderProcRun(id) {
  const r = await api(`/api/procruns/${id}`);
  const canAct = hasPermC('procruns.act');
  const canM = hasPermC('procruns.manage');
  const active = r.steps.find((s) => s.state === 'active');
  view.innerHTML = `${back('#/procruns', 'Processes in motion')}
  <div class="pg-head"><h2 dir="auto">${esc(r.title)}</h2><div class="inline">${st(r.state)}<span class="sub ltr">${esc(r.doc_code)} v${r.version}</span><span class="sub">${who(r.created_by)} · ${ago(r.created_at)}</span></div></div>
  <div class="panel"><div class="panel-title">${esc(t('Steps'))}</div>
    <ol class="proc-steps">${r.steps.map((s) => `<li class="proc-step proc-${s.state}">
      <div class="inline"><b dir="auto">${esc(s.step)}</b> ${st(s.state)}</div>
      <div class="sub">${esc(t('Role'))}: ${esc(s.role)}${s.control ? ` · ${esc(t('Control'))}: <span dir="auto">${esc(s.control)}</span>` : ''}</div>
      ${s.done_by ? `<div class="sub">${who(s.done_by)} · ${esc(when(s.done_at))}${s.note ? ` — <span dir="auto">${esc(s.note)}</span>` : ''}</div>` : ''}
      ${s.state === 'active' ? `<div class="sub">${esc(t('due'))} ${esc(when(s.due_at))}${s.assignee ? ` · ${esc(t('taken by'))} ${who(s.assignee)}` : ''}</div>` : ''}
    </li>`).join('')}</ol>
    ${active && r.state === 'open' && canAct ? `<div class="inline" style="margin-top:10px">
      ${!active.assignee ? act(`/api/procruns/${r.id}/claim`, 'Take this step', { cls: 'btn-sm' }) : ''}
      <button type="button" class="btn btn-sm btn-human" id="pr-done">${esc(t('Done'))}</button>
      <button type="button" class="btn btn-sm btn-ghost" id="pr-reject">${esc(t('Reject'))}</button></div>` : ''}
    ${r.state === 'open' && canM ? `<button type="button" class="btn btn-sm btn-ghost" id="pr-cancel" style="margin-top:8px">${esc(t('Cancel this run'))}</button>` : ''}
  </div>`;
  wireActs(view, api, toast, () => renderProcRun(id));
  $('#pr-done')?.addEventListener('click', async () => {
    const body = {};
    if (active.control) {
      if (!window.confirm(`${t('Did the control hold?')}\n\n${active.control}`)) return;
      body.controlOk = true;
      body.note = window.prompt(t('How was the control satisfied?'));
      if (!body.note) return;
    } else body.note = window.prompt(t('A note, if any:')) || '';
    try { await api(`/api/procruns/${r.id}/complete`, { method: 'POST', body }); renderProcRun(id); } catch (e) { toast(e.message, true); }
  });
  $('#pr-reject')?.addEventListener('click', async () => {
    const reason = window.prompt(t('Why is this step rejected? The run stops here.'));
    if (!reason) return;
    try { await api(`/api/procruns/${r.id}/reject`, { method: 'POST', body: { reason } }); renderProcRun(id); } catch (e) { toast(e.message, true); }
  });
  $('#pr-cancel')?.addEventListener('click', async () => {
    const reason = window.prompt(t('Why is this run cancelled?'));
    if (!reason) return;
    try { await api(`/api/procruns/${r.id}/cancel`, { method: 'POST', body: { reason } }); renderProcRun(id); } catch (e) { toast(e.message, true); }
  });
}

// ========================================================== paper intake ==

const KIND_LABEL = { invoice: 'Invoice', id: 'Identity document', contract: 'Contract', other: 'Other' };
let toolCache = null;

export async function renderIntake() {
  const id = hashParam('id');
  if (id) return renderIntakeItem(Number(id));
  const d = await api('/api/intake');
  const canM = hasPermC('intake.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('A scanned invoice, a passport or a contract, read on this machine — nothing leaves the server. The fields are found and offered to a person, who corrects them and decides what they become: a bill in payables, a party in AML. A passport or ID card checks itself: every field of its machine-readable zone carries a check digit.'))}</p></div>
  <div class="inline" id="in-tools"><span class="sub">${esc(t('Checking the reading tools…'))}</span></div>
  <div class="kpis">${kpi('Waiting for a person', d.waiting, '', d.waiting ? 'human' : '')}${kpi('Documents', d.items.length)}</div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Add a document'))}</div>
    <form id="in-new" class="fields">
      <div><label class="fl" for="in-kind">${esc(t('Kind'))}</label><select id="in-kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${esc(t(l))}</option>`).join('')}</select></div>
      ${fileField('in-file', 'Scan or photo (PDF, PNG, JPG)', 'application/pdf,image/png,image/jpeg,image/webp')}
      <div class="wide"><label class="fl" for="in-text">${esc(t('…or paste its text'))}</label><textarea id="in-text" rows="4"></textarea></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Read it'))}</button></div></form></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Documents'))}</div>
    ${d.items.length ? `<table class="tbl"><tbody>${d.items.map((i) => `<tr><td><a href="#/intake?id=${i.id}">${esc(t(KIND_LABEL[i.kind]))} #${i.id}</a><div class="sub" dir="auto">${esc(i.file_name || t('pasted text'))} · ${esc(t(i.source))}</div></td>
      <td>${st(i.state)}${i.error ? `<div class="sub">${esc(i.error)}</div>` : ''}</td><td class="sub">${ago(i.created_at)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('Nothing read yet.'))}</div>`}</div>`;
  (async () => {
    try {
      toolCache = toolCache || await api('/api/intake/tools');
      $('#in-tools').innerHTML = ['tesseract', 'pdftoppm', 'ffmpeg', 'whisper'].map((k) => `<span class="chip ${toolCache[k] ? 'chip-ok' : 'chip-warn'}">${esc(k)} ${esc(t(toolCache[k] ? 'ready' : 'not installed'))}</span>`).join(' ');
    } catch { $('#in-tools').innerHTML = ''; }
  })();
  $('#in-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const upload = await readFile($('#in-file'));
      const text = $('#in-text').value.trim();
      if (!upload && !text) { toast(t('Choose a file or paste the text'), true); return; }
      const r = await api('/api/intake', { method: 'POST', body: { kind: $('#in-kind').value, ...(upload ? { upload } : { text }) } });
      location.hash = `#/intake?id=${r.id}`;
    } catch (err) { toast(err.message, true); }
  });
}

const INVOICE_FIELDS = [['supplier', 'Supplier'], ['number', 'Invoice number'], ['issued', 'Issued'], ['due', 'Due'], ['total', 'Total'], ['tax', 'Tax'], ['currency', 'Currency']];

async function renderIntakeItem(id) {
  const it = await api(`/api/intake/${id}`);
  const canM = hasPermC('intake.manage');
  const f = it.fields || {};
  const m = f.mrz || null;
  const ov = it.kind === 'invoice' ? await api('/api/intake') : null;
  const fieldRows = it.kind === 'invoice'
    ? INVOICE_FIELDS.map(([k, l]) => `<div><label class="fl" for="if-${k}">${esc(t(l))}</label><input id="if-${k}" data-field="${k}" value="${esc(f[k] ?? '')}"></div>`).join('')
    : it.kind === 'id'
      ? `<div class="wide">${m ? `<div class="inline">${st(m.valid ? 'verified' : 'partial')} <span class="sub">${esc(m.format)} · ${esc(t(m.valid ? 'every check digit holds' : 'a check digit fails — read it again by eye'))}</span></div>
        <table class="doc-meta">${[['Surname', m.surname], ['Given names', m.given], ['Number', m.number], ['Nationality', m.nationality], ['Born', m.birth], ['Expires', m.expiry], ['Sex', m.sex]].map(([k, v]) => `<tr><th>${esc(t(k))}</th><td dir="auto">${esc(v || '—')}</td></tr>`).join('')}</table>`
        : `<p class="sub">${esc(t('No machine-readable zone was found — type the name and country.'))}</p>`}</div>
        <div><label class="fl" for="if-name">${esc(t('Name'))}</label><input id="if-name" value="${esc(m ? `${m.given} ${m.surname}`.trim() : '')}"></div>
        <div><label class="fl" for="if-country">${esc(t('Country (ISO code)'))}</label><input id="if-country" value="${esc(m?.nationality || '')}"></div>`
      : `<div class="wide"><pre class="ent-md">${esc(JSON.stringify(f, null, 2))}</pre></div>`;
  view.innerHTML = `${back('#/intake', 'Paper intake')}
  <div class="pg-head"><h2>${esc(t(KIND_LABEL[it.kind]))} #${it.id}</h2><div class="inline">${st(it.state)}<span class="sub" dir="auto">${esc(it.file_name || '')}</span>${it.adopted_ref ? `<span class="sub ltr">${esc(it.adopted_ref)}</span>` : ''}</div>
    ${it.error ? `<div class="callout">${esc(it.error)}</div>` : ''}</div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Fields'))}</div>
      ${it.state === 'reading' ? `<div class="empty">${esc(t('Being read…'))}</div>` : `<form id="if-form" class="fields">${fieldRows}
        ${it.kind === 'invoice' ? `<div class="wide"><label class="fl" for="if-vendor">${esc(t('Vendor'))}</label><select id="if-vendor"><option value="">—</option>${ov.vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></div>` : ''}
        ${canM && ['read', 'failed'].includes(it.state) ? `<div class="wide inline"><button class="btn btn-human" type="submit">${esc(t(it.kind === 'invoice' ? 'Make a draft bill' : it.kind === 'id' ? 'Add as a party and screen' : 'File it'))}</button>
          <button class="btn btn-sm btn-ghost" type="button" id="if-reject">${esc(t('Reject'))}</button>
          <button class="btn btn-sm" type="button" id="if-structure">${esc(t('Ask the intake clerk'))}</button></div>` : ''}</form>`}
    </div>
    <div class="panel"><div class="panel-title">${esc(t('Text as read'))}</div><pre class="ent-md" dir="auto">${esc(it.text || '—')}</pre></div>
  </div>
  ${draftsPanel(it.drafts)}`;
  $('#if-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {};
    view.querySelectorAll('[data-field]').forEach((el) => { fields[el.dataset.field] = el.value.trim(); });
    if (it.kind === 'id') { fields.name = $('#if-name').value.trim(); fields.country = $('#if-country').value.trim(); }
    try { await api(`/api/intake/${id}/adopt`, { method: 'POST', body: { fields, vendorId: $('#if-vendor')?.value || null } }); toast(t('Done')); renderIntakeItem(id); } catch (err) { toast(err.message, true); }
  });
  $('#if-reject')?.addEventListener('click', async () => {
    const reason = window.prompt(t('Why is it rejected?'));
    if (!reason) return;
    try { await api(`/api/intake/${id}/reject`, { method: 'POST', body: { reason } }); renderIntakeItem(id); } catch (err) { toast(err.message, true); }
  });
  $('#if-structure')?.addEventListener('click', async () => {
    try { await api(`/api/intake/${id}/structure`, { method: 'POST', body: {} }); toast(t('The intake clerk is reading')); renderIntakeItem(id); } catch (err) { toast(err.message, true); }
  });
}

// ================================================== recordings & minutes ==

const MEETING_KINDS = [['general', 'General'], ['committee', 'Committee'], ['board', 'Board'], ['management_review', 'Management review (ISO)']];

export async function renderMinutes() {
  const id = hashParam('id');
  if (id) return renderMeeting(Number(id));
  const d = await api('/api/minutes');
  const canM = hasPermC('minutes.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('A recording is written down on this machine — at night when the night shift is on — then the minutes secretary drafts the summary, the decisions and the actions. A person confirms them; each confirmed action becomes a task with its owner and date.'))}</p></div>
  <div class="kpis">${kpi('Meetings', d.meetings.length)}${kpi('Being written up', d.waiting)}${kpi('Open actions', d.openActions, '', d.openActions ? 'human' : 'ok')}</div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Record a meeting'))}</div>
    <form id="mt-new" class="fields">
      <div><label class="fl" for="mt-title">${esc(t('Title'))}</label><input id="mt-title" required></div>
      <div><label class="fl" for="mt-date">${esc(t('Held on'))}</label><input id="mt-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div><label class="fl" for="mt-kind">${esc(t('Kind'))}</label><select id="mt-kind">${MEETING_KINDS.map(([v, l]) => `<option value="${v}">${esc(t(l))}</option>`).join('')}</select></div>
      <div><label class="fl" for="mt-iso">${esc(t('Standard reviewed'))}</label><select id="mt-iso"><option value="">—</option>${['ISO 9001', 'ISO 27001', 'ISO 14001', 'ISO 45001', 'ISO 22301'].map((s) => `<option>${s}</option>`).join('')}</select></div>
      <div class="wide"><label class="fl" for="mt-att">${esc(t('Attendees'))}</label><input id="mt-att"></div>
      ${fileField('mt-file', 'Recording (MP3, WAV, OGG, M4A)', 'audio/*')}
      <div class="wide"><label class="fl" for="mt-text">${esc(t('…or paste the transcript'))}</label><textarea id="mt-text" rows="4"></textarea></div>
      <div class="wide"><button class="btn btn-primary" type="submit">${esc(t('Record'))}</button></div></form></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Meetings'))}</div>
    ${d.meetings.length ? `<table class="tbl"><tbody>${d.meetings.map((m) => `<tr><td><a href="#/minutes?id=${m.id}"><b dir="auto">${esc(m.title)}</b></a><div class="sub">${esc(m.held_on)} · ${esc(t((MEETING_KINDS.find(([v]) => v === m.kind) || [])[1] || m.kind))}</div></td>
      <td>${st(m.state)}${m.error ? `<div class="sub">${esc(m.error)}</div>` : ''}</td><td class="sub">${m.actions} ${esc(t('actions'))}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('No meetings recorded yet.'))}</div>`}</div>`;
  $('#mt-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const upload = await readFile($('#mt-file'));
      const body = { title: $('#mt-title').value.trim(), heldOn: $('#mt-date').value, kind: $('#mt-kind').value, isoStandard: $('#mt-iso').value || null, attendees: $('#mt-att').value.trim() };
      if (upload) body.upload = upload; else body.transcript = $('#mt-text').value;
      const r = await api('/api/minutes', { method: 'POST', body });
      location.hash = `#/minutes?id=${r.id}`;
    } catch (err) { toast(err.message, true); }
  });
}

async function renderMeeting(id) {
  const m = await api(`/api/minutes/${id}`);
  const canM = hasPermC('minutes.manage');
  const ready = m.drafts.find((d) => d.state === 'ready')?.body;
  const actions = m.state === 'minuted' ? [] : (ready?.items || []).filter((a) => a && typeof a === 'object' && a.task);
  const row = (a = {}) => `<div class="mt-action fields"><div><input data-k="task" aria-label="${esc(t('Action'))}" placeholder="${esc(t('Action'))}" value="${esc(a.task || '')}"></div>
    <div><input data-k="owner" aria-label="${esc(t('Owner'))}" placeholder="${esc(t('Owner'))}" value="${esc(a.owner || '')}"></div>
    <div><input data-k="due" type="date" aria-label="${esc(t('Due'))}" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '')}"></div></div>`;
  view.innerHTML = `${back('#/minutes', 'Recordings & minutes')}
  <div class="pg-head"><h2 dir="auto">${esc(m.title)}</h2><div class="inline">${st(m.state)}<span class="sub">${esc(m.held_on)} · ${esc(m.attendees || '')}</span>
    ${m.state === 'minuted' && canM ? officialCopyButton('minutes', m.id) : ''}</div>
    ${m.error ? `<div class="callout">${esc(m.error)}</div>` : ''}</div>
  ${m.state === 'minuted' ? `<div class="panel"><div class="panel-title">${esc(t('Minutes'))}</div>
      <div dir="auto" class="ent-md">${esc(m.summary || '')}</div>
      <h3>${esc(t('Decisions'))}</h3><div dir="auto" class="ent-md">${esc(m.decisions || '—')}</div>
      <h3>${esc(t('Actions'))}</h3><table class="tbl"><tbody>${m.actions.map((a) => `<tr><td dir="auto">${esc(a.task)}</td><td>${esc(a.owner || '—')}</td><td>${esc(a.due || '—')}</td><td><a href="#/tasks">${esc(t('task'))} #${a.task_id}</a></td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table></div>`
    : canM && m.state === 'transcribed' ? `<div class="panel"><div class="panel-title">${esc(t('Record the minutes'))}</div>
      <form id="mt-min" class="fields">
        <div class="wide"><label class="fl" for="mt-sum">${esc(t('Summary'))}</label><textarea id="mt-sum" rows="3">${esc(ready?.markdown?.split('\n- ')[0] || '')}</textarea></div>
        <div class="wide"><label class="fl" for="mt-dec">${esc(t('Decisions'))}</label><textarea id="mt-dec" rows="4">${esc((ready?.markdown || '').split('\n').filter((l) => l.startsWith('- ')).join('\n'))}</textarea></div>
        <div class="wide"><div class="fl">${esc(t('Actions'))}</div><div id="mt-actions">${(actions.length ? actions : [{}]).map(row).join('')}</div>
          <button type="button" class="btn btn-sm btn-ghost" id="mt-more">${esc(t('Another action'))}</button></div>
        <div class="wide"><button class="btn btn-human" type="submit">${esc(t('Record the minutes'))}</button></div></form></div>` : ''}
  ${m.state !== 'minuted' ? draftsPanel(m.drafts) : ''}
  ${m.transcript ? `<details class="panel"><summary class="panel-title">${esc(t('Transcript'))}</summary><pre class="ent-md" dir="auto">${esc(m.transcript)}</pre></details>` : ''}`;
  wireOfficialCopy(view);
  $('#mt-more')?.addEventListener('click', () => $('#mt-actions').insertAdjacentHTML('beforeend', row()));
  $('#mt-min')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = [...view.querySelectorAll('.mt-action')].map((r) => Object.fromEntries([...r.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()]))).filter((a) => a.task);
    try { await api(`/api/minutes/${id}/record`, { method: 'POST', body: { summary: $('#mt-sum').value, decisions: $('#mt-dec').value, actions: list } }); toast(t('Recorded')); renderMeeting(id); } catch (err) { toast(err.message, true); }
  });
}

// ============================================================== WhatsApp ==

export async function renderWhatsApp() {
  const id = hashParam('id');
  if (id) return renderWaThread(id);
  const d = await api('/api/whatsapp');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Customers who write on WhatsApp, by sender. The support employee drafts a reply from the conversation and the company’s documents; a person reads it and sends it. Inside the 24 hours after the customer last wrote a free reply is allowed; after that only a template WhatsApp approved in advance.'))}</p></div>
  <div class="inline">${st(d.connected === 'live' ? 'live' : d.connected)}<span class="sub">${esc(t('connector'))}</span>
    <span class="chip ${d.webhookReady ? 'chip-ok' : 'chip-warn'}">${esc(t(d.webhookReady ? 'webhook ready' : 'set WHATSAPP_VERIFY_TOKEN'))}</span>
    <span class="sub">${d.templates.length} ${esc(t('approved templates'))}</span></div>
  ${d.connected !== 'live' ? `<p class="hint">${esc(t('Connect WhatsApp under Integrations with the access token and the phone number id, set WHATSAPP_VERIFY_TOKEN and WHATSAPP_APP_SECRET, and point the webhook at /webhooks/whatsapp — which needs HTTPS.'))}</p>` : ''}
  <div class="kpis">${kpi('Conversations', d.contacts.length)}${kpi('Waiting for a reply', d.waiting, '', d.waiting ? 'human' : 'ok')}</div>
  <div class="panel"><div class="panel-title">${esc(t('Inbox'))}</div>
    ${d.contacts.length ? `<table class="tbl"><tbody>${d.contacts.map((c) => `<tr><td><a href="#/whatsapp?id=${esc(c.wa_id)}"><b dir="auto">${esc(c.name || c.wa_id)}</b></a><div class="sub ltr">+${esc(c.wa_id)}</div></td>
      <td dir="auto" class="sub">${esc(String(c.last_body || '').slice(0, 90))}</td>
      <td>${c.waiting ? `<span class="chip chip-warn">${esc(t('waiting'))}</span>` : ''} <span class="chip ${c.windowOpen ? 'chip-ok' : 'chip-dim'}">${esc(t(c.windowOpen ? 'window open' : 'template only'))}</span></td><td class="sub">${ago(c.last_at)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No messages yet.'))}</div>`}</div>`;
}

async function renderWaThread(waId) {
  const [th, d] = await Promise.all([api(`/api/whatsapp/${encodeURIComponent(waId)}`), api('/api/whatsapp')]);
  const canSend = hasPermC('whatsapp.send');
  const canM = hasPermC('whatsapp.manage');
  view.innerHTML = `${back('#/whatsapp', 'WhatsApp')}
  <div class="pg-head"><h2 dir="auto">${esc(th.name || th.wa_id)}</h2><div class="inline"><span class="sub ltr">+${esc(th.wa_id)}</span><span class="chip ${th.windowOpen ? 'chip-ok' : 'chip-dim'}">${esc(t(th.windowOpen ? 'window open' : 'template only'))}</span></div></div>
  <div class="panel wa-thread">${th.messages.map((m) => `<div class="wa-msg wa-${m.direction}"><div dir="auto">${esc(m.body)}</div><div class="sub">${ago(m.created_at)}${m.direction === 'out' ? ` · ${who(m.created_by)} · ${esc(t(m.status || ''))}` : ''}</div></div>`).join('') || `<div class="empty">—</div>`}</div>
  ${draftsPanel(th.drafts, { adopt: true })}
  ${canSend ? `<div class="panel"><div class="panel-title">${esc(t('Reply'))}</div>
    ${th.windowOpen ? `<form id="wa-send" class="fields"><div class="wide"><label class="fl" for="wa-text">${esc(t('Message'))}</label><textarea id="wa-text" rows="3" dir="auto"></textarea></div>
      <div class="wide inline"><button class="btn btn-human" type="submit">${esc(t('Send'))}</button>${canM ? `<button class="btn btn-sm" type="button" id="wa-draft">${esc(t('Draft a reply'))}</button>` : ''}</div></form>`
    : `<p class="sub">${esc(t('More than 24 hours since they last wrote: only an approved template can be sent.'))}</p>`}
    ${d.templates.length ? `<form id="wa-tpl" class="fields" style="margin-top:10px"><div><label class="fl" for="wa-tname">${esc(t('Template'))}</label><select id="wa-tname">${d.templates.map((x) => `<option value="${esc(x.name)}" data-params="${Number(x.params || 0)}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="wide"><label class="fl" for="wa-tparams">${esc(t('Values, one per line'))}</label><textarea id="wa-tparams" rows="2"></textarea></div>
      <div class="wide"><button class="btn btn-sm btn-human" type="submit">${esc(t('Send the template'))}</button></div></form>` : ''}</div>` : ''}`;
  const after = (r) => { if (r.verdict !== 'allowed') toast(`${t('The gate did not send it')}: ${r.why || r.verdict}`, true); else toast(t('Sent')); renderWaThread(waId); };
  $('#wa-send')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { after(await api(`/api/whatsapp/${waId}/send`, { method: 'POST', body: { text: $('#wa-text').value } })); } catch (err) { toast(err.message, true); }
  });
  $('#wa-tpl')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const params = $('#wa-tparams').value.split('\n').map((s) => s.trim()).filter(Boolean);
    try { after(await api(`/api/whatsapp/${waId}/template`, { method: 'POST', body: { name: $('#wa-tname').value, params } })); } catch (err) { toast(err.message, true); }
  });
  $('#wa-draft')?.addEventListener('click', async () => {
    try { await api(`/api/whatsapp/${waId}/draft`, { method: 'POST', body: {} }); toast(t('The support employee is writing')); setTimeout(() => renderWaThread(waId), 2500); } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll('[data-adopt]').forEach((b) => b.addEventListener('click', () => {
    const dr = th.drafts.find((x) => String(x.id) === b.dataset.adopt);
    if ($('#wa-text') && dr?.body?.markdown) { $('#wa-text').value = dr.body.markdown; $('#wa-text').focus(); }
  }));
}

// ================================================================ portal ==

export async function renderPortal() {
  const id = hashParam('id');
  if (id) return renderPortalThread(Number(id));
  const d = await api('/api/portal');
  const canM = hasPermC('portal.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('A customer’s or a supplier’s own door: their invoices or bills, their messages, and documents they upload — a supplier’s invoice goes straight into paper intake. Each link is for one party, lasts thirty days and can be withdrawn at once; nothing behind it reaches anyone else’s records.'))}</p></div>
  ${!d.publicUrl ? `<div class="callout">${esc(t('Set PUBLIC_BASE_URL (with HTTPS) before issuing links — a link has to reach the customer’s phone.'))}</div>` : ''}
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Issue a link'))}</div>
    <form id="po-link" class="fields">
      <div><label class="fl" for="po-kind">${esc(t('For'))}</label><select id="po-kind"><option value="customer">${esc(t('Customer'))}</option><option value="supplier">${esc(t('Supplier'))}</option></select></div>
      <div><label class="fl" for="po-party">${esc(t('Who'))}</label><select id="po-party"></select></div>
      <div class="wide"><button class="btn btn-human" type="submit">${esc(t('Issue the link'))}</button></div></form>
    <div id="po-out"></div></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Links'))}</div>
    ${d.accounts.length ? `<table class="tbl"><tbody>${d.accounts.map((a) => {
    const live = !a.revoked_at && a.expires_at > new Date().toISOString().replace('T', ' ');
    return `<tr><td><a href="#/portal?id=${a.id}"><b dir="auto">${esc(a.name)}</b></a><div class="sub">${esc(t(a.kind === 'customer' ? 'Customer' : 'Supplier'))} · ${esc(t('expires'))} ${esc(String(a.expires_at).slice(0, 10))}</div></td>
      <td>${st(live ? 'live' : a.revoked_at ? 'revoked' : 'expired')}</td><td class="sub">${a.received} ${esc(t('received'))}${a.last_in ? ` · ${ago(a.last_in)}` : ''}</td>
      <td>${canM && live ? act(`/api/portal/${a.id}/revoke`, 'Withdraw', { cls: 'btn-sm btn-ghost', confirm: 'Withdraw this link? It stops working at once.' }) : ''}</td></tr>`;
  }).join('')}</tbody></table>` : `<div class="empty">${esc(t('No links issued yet.'))}</div>`}</div>`;
  const fill = () => {
    const list = $('#po-kind').value === 'customer' ? d.customers : d.suppliers;
    $('#po-party').innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') || `<option value="">—</option>`;
  };
  if ($('#po-kind')) { fill(); $('#po-kind').addEventListener('change', fill); }
  wireActs(view, api, toast, renderPortal);
  $('#po-link')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/portal/link', { method: 'POST', body: { kind: $('#po-kind').value, partyId: $('#po-party').value } });
      $('#po-out').innerHTML = `<div class="callout"><b>${esc(t('Shown once.'))}</b> ${esc(t('Send it to them yourself, by a channel you trust.'))}</div>
        <label class="fl" for="po-url">${esc(r.name)}</label><input id="po-url" class="ltr" readonly value="${esc(r.link)}">`;
      $('#po-url').select();
    } catch (err) { toast(err.message, true); }
  });
}

async function renderPortalThread(id) {
  const th = await api(`/api/portal/${id}`);
  const canM = hasPermC('portal.manage');
  view.innerHTML = `${back('#/portal', 'Customer & supplier portal')}
  <div class="pg-head"><h2 dir="auto">${esc(th.name)}</h2><div class="inline"><span class="sub">${esc(t(th.kind === 'customer' ? 'Customer' : 'Supplier'))}</span><span class="sub">${esc(t('last seen'))} ${th.last_seen ? ago(th.last_seen) : '—'}</span></div></div>
  <div class="panel wa-thread">${th.messages.map((m) => `<div class="wa-msg wa-${m.direction}">${m.subject ? `<b dir="auto">${esc(m.subject)}</b>` : ''}<div dir="auto">${esc(m.body)}</div>
    ${m.file ? `<div class="sub">📎 ${esc(m.file)} · ${esc(t(m.purpose || 'other'))} · ${Math.round((m.bytes || 0) / 1024)} KB</div>` : ''}<div class="sub">${ago(m.created_at)}${m.direction === 'out' ? ` · ${who(m.created_by)}` : ''}</div></div>`).join('') || `<div class="empty">${esc(t('Nothing yet.'))}</div>`}</div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Reply'))}</div>${form('po-reply', [['body', 'Message', 'textarea', { rows: 3 }]], 'Reply in the portal')}</div>` : ''}`;
  wireForm('po-reply', `/api/portal/${id}/reply`, () => renderPortalThread(id));
}

// ============================================================ board pack ==

export async function renderBoardPack() {
  const id = hashParam('id');
  if (id) return renderPack(Number(id));
  const d = await api('/api/boardpack');
  const canM = hasPermC('boardpack.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The month from the record: results, cash and how long it lasts, the governance map, the largest risks and what is late — built on the first of each month, frozen, and issued by a person as an official document.'))}</p></div>
  ${canM ? `<div class="panel"><div class="panel-title">${esc(t('Build a pack'))}</div>${form('bp-build', [['period', 'Month', 'month', { value: d.suggested }]], 'Build')}</div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Packs'))}</div>
    ${d.packs.length ? `<table class="tbl"><tbody>${d.packs.map((p) => `<tr><td><a href="#/boardpack?id=${p.id}"><b class="ltr">${esc(p.period)}</b></a></td><td>${st(p.state === 'issued' ? 'published' : 'draft')}</td><td class="sub ltr">${esc(p.issued_code || '')}</td><td class="sub">${ago(p.created_at)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No packs yet — the first is built on the first of next month, or build one now.'))}</div>`}</div>`;
  wireForm('bp-build', '/api/boardpack', (r) => { location.hash = `#/boardpack?id=${r.id}`; });
}

async function renderPack(id) {
  const p = await api(`/api/boardpack/${id}`);
  const s = p.snapshot;
  const f = s.finance;
  const canM = hasPermC('boardpack.manage');
  const HEAT = { green: 'chip-ok', amber: 'chip-warn', red: 'chip-bad' };
  view.innerHTML = `${back('#/boardpack', 'Board pack')}
  <div class="pg-head"><h2>${esc(t('Board pack'))} — <span class="ltr">${esc(s.period)}</span></h2>
    <div class="inline">${st(p.state === 'issued' ? 'published' : 'draft')}<span class="sub">${esc(t('built'))} ${ago(p.created_at)}</span>
    ${canM ? officialCopyButton('boardpack', p.id) : ''}
    ${canM && p.state !== 'issued' ? `${act('/api/boardpack', 'Rebuild', { body: { period: s.period }, cls: 'btn-sm btn-ghost' })} ${act(`/api/boardpack/${p.id}/summary`, 'Draft the covering note', { cls: 'btn-sm', done: 'The executive is writing' })}` : ''}</div></div>
  <div class="kpis">${kpi('Revenue', money(f.revenue))}${kpi('Expenses', money(f.expenses))}${kpi('Net', money(f.net), f.margin != null ? `${f.margin}%` : '', f.net < 0 ? 'bad' : 'ok')}${kpi('Cash', money(f.cash))}
    ${kpi('Months of cash', f.runway.months ?? '—', f.runway.months == null ? t('not burning cash') : `${t('if revenue falls 20%')}: ${f.runway.monthsIfRevenueFalls20 ?? '—'}`, f.runway.months != null && f.runway.months < 6 ? 'bad' : '')}</div>
  <p class="hint">${esc(t(f.runway.method))}</p>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Three months'))}</div><table class="tbl"><thead><tr><th>${esc(t('Month'))}</th><th>${esc(t('Revenue'))}</th><th>${esc(t('Expenses'))}</th><th>${esc(t('Net'))}</th></tr></thead><tbody>
      ${f.trend.map((m) => `<tr><td class="ltr">${esc(m.period)}</td><td>${money(m.revenue)}</td><td>${money(m.expenses)}</td><td>${money(m.net)}</td></tr>`).join('')}</tbody></table>
      <table class="doc-meta" style="margin-top:10px">${[['Receivables open', f.receivablesOpen], ['Receivables overdue', f.receivablesOverdue], ['Payables due in 30 days', f.payablesNext30]].map(([k, v]) => `<tr><th>${esc(t(k))}</th><td>${money(v)}</td></tr>`).join('')}</table></div>
    <div class="panel"><div class="panel-title">${esc(t('Governance map'))}</div><div class="inline" style="flex-wrap:wrap">${s.governance.map((g) => `<span class="chip ${HEAT[g.status]}">${esc(t(g.label))}</span>`).join(' ')}</div>
      <div class="fl" style="margin-top:12px">${esc(t('Late or open'))}</div>
      <table class="doc-meta">${[['Audit actions overdue', s.overdue.auditActions], ['Nonconformities open', s.overdue.nonconformities], ['Policies past their review date', s.overdue.policiesPastReview], ['Late process steps', s.overdue.lateProcessSteps], ['AML alerts open', s.overdue.amlAlerts]].map(([k, v]) => `<tr><th>${esc(t(k))}</th><td>${v}</td></tr>`).join('')}</table></div>
  </div>
  <div class="split2">
    <div class="panel"><div class="panel-title">${esc(t('Largest risks'))}</div><table class="tbl"><tbody>${s.risks.map((r) => `<tr><td dir="auto">${esc(r.title)}<div class="sub" dir="auto">${esc(r.mitigation || t('no mitigation recorded'))}</div></td><td>${r.score}/25</td><td>${esc(r.owner)}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table></div>
    <div class="panel"><div class="panel-title">${esc(t('Operations issues'))}</div><table class="tbl"><tbody>${s.operations.map((o) => `<tr><td dir="auto">${esc(o.title)}</td><td>${st(o.severity)}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table></div>
  </div>
  ${draftsPanel(p.drafts)}`;
  wireActs(view, api, toast, () => renderPack(id));
  wireOfficialCopy(view);
}

// ========================================================== insider risk ==

export async function renderInsider() {
  const d = await api('/api/insider');
  const canM = hasPermC('insider.manage');
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('Patterns in the record that come before trouble: a sign-in from a new network, approvals in the small hours, a burst of exports, one person approving nearly everything one colleague prepares, failed passwords ending in a success. None is proof and none acts on its own — the security team clears each with a reason or confirms it, and confirming can end the person’s sessions.'))}</p></div>
  <div class="kpis">${kpi('Open alerts', d.open, '', d.open ? 'human' : 'ok')}${kpi('People with alerts', d.people.length)}</div>
  ${canM ? `<div class="inline">${act('/api/insider/sweep', 'Read the record now', { cls: 'btn-sm', done: 'Read' })}<span class="sub">${esc(t('Night is counted on the company’s clock'))}: UTC${d.tzOffset >= 0 ? '+' : ''}${d.tzOffset} (COMPANY_TZ_OFFSET)</span></div>` : ''}
  ${d.people.length ? `<div class="panel"><div class="panel-title">${esc(t('Who to look at first'))}</div><table class="tbl"><tbody>${d.people.map((p) => `<tr><td>${who(p.subject)}</td><td>${p.score}</td><td class="sub">${p.alerts} ${esc(t('alerts'))}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Alerts'))}</div>
    ${d.alerts.length ? d.alerts.map((a) => `<div class="ent-draft"><div class="inline"><b>${who(a.subject)}</b> ${st(a.state === 'open' ? 'open' : a.state === 'confirmed' ? 'reported' : 'cleared')} <span class="sub">${a.score} · ${ago(a.created_at)}</span></div>
      <div>${esc(t(a.label || a.rule))}</div><div class="sub ltr">${esc(Object.entries(a.detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))}</div>
      ${a.note ? `<div class="sub" dir="auto">${who(a.decided_by)}: ${esc(a.note)}</div>` : ''}
      ${canM && a.state === 'open' ? `<div class="inline" style="margin-top:6px"><button type="button" class="btn btn-sm" data-ins="${a.id}" data-v="cleared">${esc(t('Clear'))}</button><button type="button" class="btn btn-sm btn-human" data-ins="${a.id}" data-v="confirmed">${esc(t('Confirm'))}</button></div>` : ''}</div>`).join('')
    : `<div class="empty">${esc(t('Nothing in the record needs a second look.'))}</div>`}</div>`;
  wireActs(view, api, toast, renderInsider);
  view.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', async () => {
    const note = window.prompt(t('Why?'));
    if (!note) return;
    const endSessions = b.dataset.v === 'confirmed' && window.confirm(t('End this person’s sessions now? They will have to sign in again.'));
    try { const r = await api(`/api/insider/${b.dataset.ins}`, { method: 'POST', body: { verdict: b.dataset.v, note, endSessions } }); if (r.sessionsEnded) toast(`${r.sessionsEnded} ${t('session(s) ended')}`); renderInsider(); } catch (e) { toast(e.message, true); }
  }));
}

// ==================================================== ask the company ==

/** Under the Ask page's answer: the same question, answered from the company's documents, on request. */
export function companyAskPanel(question) {
  return `<div class="panel" style="margin-top:16px" id="ca-panel"><div class="panel-title">${esc(t('Answer from the company’s own documents'))}</div>
    <p class="hint">${esc(t('The local model answers only from the policies, minutes, decisions and findings you may read, and cites each one. It costs a model call, so it waits for you to ask.'))}</p>
    <button type="button" class="btn btn-sm btn-primary" id="ca-go" data-q="${esc(question)}">${esc(t('Answer from the documents'))}</button><div id="ca-out"></div></div>`;
}

export function wireCompanyAsk() {
  $('#ca-go')?.addEventListener('click', async (e) => {
    const out = $('#ca-out');
    e.target.disabled = true;
    out.innerHTML = `<div class="empty">${esc(t('Searching the documents…'))}</div>`;
    try {
      let r = await api('/api/ask/company', { method: 'POST', body: { question: e.target.dataset.q, lang: document.documentElement.lang === 'ar' ? 'ar' : 'en' } });
      const show = () => {
        out.innerHTML = `${r.state === 'no-sources' ? `<div class="empty">${esc(t('Nothing you may read answers this.'))}</div>`
          : r.answer ? `<div class="ent-md" dir="auto">${esc(r.answer.markdown || '')}</div>` : `<div class="sub">${esc(t('being written…'))}</div>`}
          ${r.sources.length ? `<div class="fl" style="margin-top:10px">${esc(t('Sources'))}</div><ul class="ent-list">${r.sources.map((s) => `<li><a href="${esc(s.href)}" class="ltr">[${esc(s.cite)}]</a> <span dir="auto">${esc(s.title)}</span><div class="sub" dir="auto">${esc(s.excerpt)}</div></li>`).join('')}</ul>` : ''}`;
      };
      show();
      for (let i = 0; i < 90 && r.state === 'thinking'; i++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        if (!document.body.contains(out)) return;
        r = await api(`/api/ask/company/${r.id}`);
        show();
      }
    } catch (err) { out.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  });
}

// ================================================== self-improvement ==

let siMap = null;

/** The loop: the map on top, and under it the record — every loop, every rewrite, and the ones waiting for a person. */
export async function renderSelfImprove() {
  const loopId = hashParam('loop');
  const [ov, loop] = await Promise.all([api('/api/selfimprove'), api(`/api/selfimprove/map${loopId ? `?loop=${encodeURIComponent(loopId)}` : ''}`)]);
  const canM = hasPermC('selfimprove.manage');
  const l = loop.loop;
  const proposed = (l?.coach || []).filter((c) => c.state === 'proposed');
  const nameOf = (id) => loop.workers.find((w) => w.id === id)?.name || id;
  const latest = new Map();
  for (const v of l?.versions || []) if (v.state !== 'reverted') latest.set(v.agent_id, v.id);
  siMap?.destroy();
  view.innerHTML = `
  <div class="pg-head"><p>${esc(t('The Grader scores each employee against a fixed rubric — valid JSON, every field of its contract, no guard tripped, the expected facts, a stated confidence. The Coach reads the failures and rewrites the playbook of each employee that failed; the next round shows whether the rewrite helped, and one that made things worse is reverted on its own. The role, the guards and the permissions are never touched.'))}</p></div>
  <div class="kpis">${kpi('Loops', ov.loops.length)}${kpi('Employees it can test', ov.candidates.length)}${kpi('Coach mode', t(ov.mode === 'ask' ? 'A person accepts each' : 'Keep if better'))}${l ? kpi('Pass rate', l.lastPass == null ? '—' : `${Math.round(l.lastPass * 100)}%`, l.firstPass == null ? '' : `${t('from')} ${Math.round(l.firstPass * 100)}%`, l.lastPass >= l.target ? 'ok' : '') : ''}</div>
  <div id="si-map"></div>
  ${proposed.length && canM ? `<div class="panel"><div class="panel-title">${esc(t('Rewrites waiting for you'))} · ${proposed.length}</div>
    ${proposed.map((c) => `<div class="ent-draft"><div class="inline"><b>${esc(nameOf(c.agent_id))}</b> <span class="sub">${esc(t('round'))} ${c.round}</span></div>
      ${c.why ? `<div class="sub" dir="auto">${esc(c.why)}</div>` : ''}
      <div class="lm-diff">${c.removed.map((x) => `<div class="lm-del" dir="auto">− ${esc(x)}</div>`).join('')}${c.added.map((x) => `<div class="lm-add" dir="auto">+ ${esc(x)}</div>`).join('')}</div>
      <div class="inline" style="margin-top:6px"><button type="button" class="btn btn-sm btn-human" data-si-rw="${c.id}" data-v="accept">${esc(t('Accept'))}</button><button type="button" class="btn btn-sm" data-si-rw="${c.id}" data-v="reject">${esc(t('Reject'))}</button></div></div>`).join('')}</div>` : ''}
  ${l?.versions.length ? `<div class="panel"><div class="panel-title">${esc(t('Playbook versions from this loop'))}</div><table class="tbl"><thead><tr><th>${esc(t('Employee'))}</th><th>${esc(t('Version'))}</th><th>${esc(t('Round'))}</th><th>${esc(t('Change'))}</th><th>${esc(t('State'))}</th><th></th></tr></thead><tbody>
    ${l.versions.slice().reverse().map((v) => `<tr><td>${esc(nameOf(v.agent_id))}</td><td>v${v.version}</td><td>${v.round}</td><td class="sub" dir="auto">${v.added.map((x) => `+ ${esc(x)}`).join('<br>')}${v.removed.map((x) => `<br><s>− ${esc(x)}</s>`).join('')}</td><td>${st(v.state)}</td>
      <td>${canM && latest.get(v.agent_id) === v.id ? `<button type="button" class="btn btn-sm" data-si-rev="${v.id}">${esc(t('Revert'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="panel"><div class="panel-title">${esc(t('Loops'))}</div>
    ${ov.loops.length ? `<table class="tbl"><thead><tr><th>${esc(t('Loop'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Rounds'))}</th><th>${esc(t('Pass rate'))}</th><th>${esc(t('Started'))}</th></tr></thead><tbody>
      ${ov.loops.map((x) => `<tr><td><a href="#/selfimprove?loop=${x.id}" class="ltr">${esc(x.name)}</a></td><td>${esc(t(x.state))}</td><td>${x.round}/${x.max_rounds}</td><td class="ltr">${x.first_pass == null ? '—' : `${Math.round(x.first_pass * 100)}%`} → ${x.last_pass == null ? '—' : `${Math.round(x.last_pass * 100)}%`}</td><td>${ago(x.started_at)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('No loop has run yet. Start one from the map: it tests the employees on their golden cases and on work they really did.'))}</div>`}</div>`;
  siMap = mountLoopMap($('#si-map'), { source: `/api/selfimprove/map${loopId ? `?loop=${encodeURIComponent(loopId)}` : ''}`, canManage: canM, initial: loop });
  view.querySelectorAll('[data-si-rw]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/selfimprove/rewrite/${b.dataset.siRw}`, { method: 'POST', body: { verdict: b.dataset.v } }); renderSelfImprove(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-si-rev]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('Put this playbook back the way it was before this version?'))) return;
    try { await api(`/api/selfimprove/version/${b.dataset.siRev}/revert`, { method: 'POST', body: {} }); renderSelfImprove(); } catch (e) { toast(e.message, true); }
  }));
}
