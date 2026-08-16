// The enterprise galaxy, on screen.
//
// Three pages: who is employed, the shape of the company, and what crosses
// between the two cores. They live in the same console, the same rail and the
// same sweep as Core 1's hundred and forty — the seam is meant to be invisible
// to the person using it and disciplined only in the code.
//
// What these pages deliberately do not show: a salary, unless the person
// looking holds the permission that reached the route. The sealing is at the
// database; the permission is at the route; this file just draws what it was
// handed.
import { $, esc, view, money } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC, actor } from '../state/session.js';
import { tile } from '../components/tile.js';
import { t } from '/i18n.js';

const stateChip2 = (s) => {
  const cls = { active: 'chip-ok', pending: 'chip-warn', suspended: 'chip-warn', notice: 'chip-warn', ended: 'chip-dim' }[s] || 'chip-dim';
  return `<span class="chip ${cls}">${esc(t(s))}</span>`;
};

/** Employees — the system of record, not the AI roster. */
export async function renderWorkforce2() {
  const d = await api('/api/core2/people').catch(() => null);
  const e = await api('/api/core2/employees').catch(() => ({ employees: [] }));
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the employee record.'))}</div>`; return; }
  const o = d.overview;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('People on file'), o.people, esc(t('every human the company knows')))}
    ${tile(t('Employed'), o.employees, esc(t('with terms and a reporting line')), o.employees ? 'tile-ok' : '')}
    ${tile(t('With a login'), o.withLogin, esc(t('a person is not automatically a user')))}
    ${tile(t('Unsealed'), o.unsealed, esc(t('no contact detail, so nothing to seal under')), o.unsealed ? 'tile-warn' : '')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('One human, one row'))}</div>
    <div class="map-legend">${esc(t(o.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Employees'))}</div>
    ${e.employees.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Number'))}</th><th>${esc(t('Name'))}</th><th>${esc(t('Employment'))}</th>
      <th>${esc(t('State'))}</th><th>${esc(t('Since'))}</th>
    </tr></thead><tbody>
      ${e.employees.map((x) => `<tr>
        <td class="mono">${esc(x.employee_no)}</td>
        <td><b>${esc(x.display_name)}</b></td>
        <td class="sub">${esc(t(x.employment))}</td>
        <td>${stateChip2(x.state)}</td>
        <td class="sub">${esc(x.hired_at || '—')}</td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('Nobody is employed yet. A person comes first, then their terms.'))}</div>`}
  </div>

  ${hasPermC('people.manage') ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Record a person'))}</div>
    <div class="map-legend">${esc(t('The contact details are sealed under this person\'s own key before the row exists. The name stays readable, because every screen and every report groups by it.'))}</div>
    <form id="c2-person" style="display:grid;gap:8px;margin-top:10px;max-width:520px">
      <div><label class="fl" for="c2-name">${esc(t('Full name'))}</label><input class="in" id="c2-name" required></div>
      <div><label class="fl" for="c2-email">${esc(t('Personal email'))}</label><input class="in" id="c2-email" type="email"></div>
      <div><label class="fl" for="c2-phone">${esc(t('Personal phone'))}</label><input class="in" id="c2-phone"></div>
      <button class="btn btn-primary" type="submit">${esc(t('Record'))}</button>
    </form>
  </div>` : ''}

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('People'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Name'))}</th><th>${esc(t('Contact'))}</th><th>${esc(t('Reference'))}</th>
    </tr></thead><tbody>
      ${d.people.map((p) => `<tr>
        <td><b>${esc(p.display_name)}</b></td>
        <td class="sub">${esc(p.personal_email || p.personal_phone || t('none on file'))}</td>
        <td class="mono sub">${esc(String(p.subject_ref || '—').slice(0, 12))}</td>
      </tr>`).join('') || `<tr><td colspan="3" class="empty">${esc(t('Nobody on file yet.'))}</td></tr>`}
    </tbody></table></div>
  </div>`;

  $('#c2-person')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/core2/people', {
        method: 'POST',
        body: {
          displayName: $('#c2-name').value,
          personalEmail: $('#c2-email').value || null,
          personalPhone: $('#c2-phone').value || null,
          actor: actor(),
        },
      });
      renderWorkforce2();
    } catch (err) { alert(err.message); }
  });
}

/** The organization: units, with headcount, as a tree. */
export async function renderOrgChart() {
  const d = await api('/api/core2/org').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the organization.'))}</div>`; return; }

  // Depth-limited on the server too; this just draws what it was given.
  const branch = (u, depth = 0) => `
    <div class="org-node" style="margin-inline-start:${depth * 22}px">
      <span class="chip">${esc(u.name)}</span>
      <span class="sub">${u.headcount} ${esc(t('people'))}</span>
      ${u.core1_section ? `<a class="sub" href="#/${esc(u.core1_section)}">${esc(t('answers to'))} ${esc(u.core1_section)} →</a>` : ''}
    </div>
    ${(u.children || []).map((c) => branch(c, depth + 1)).join('')}`;

  view.innerHTML = `
  <div class="grid grid-3">
    ${tile(t('Units'), d.total, esc(t('active parts of the company')))}
    ${tile(t('People placed'), d.employees, esc(t('employed and assigned to a unit')))}
    ${tile(t('Top level'), d.units.length, esc(t('units reporting to nobody')))}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The shape of the company'))}</div>
    <div class="map-legend">${esc(t('A reporting line points at another employment, by number. It is not a name and it cannot be an AI employee — the column is an integer in a STRICT table, so an org chart with an agent on it is not something this schema can express.'))}</div>
    <div style="margin-top:12px">
      ${d.units.map((u) => branch(u)).join('') || `<div class="empty">${esc(t('No units yet.'))}</div>`}
    </div>
  </div>`;
}

/** What crosses between the two cores, and what is held. */
export async function renderBridges() {
  const d = await api('/api/core2/bridges').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the bridges.'))}</div>`; return; }

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Tools'), d.tools.length, esc(t('one action each, no catch-all')))}
    ${tile(t('Calls through the gate'), d.calls, esc(t('every one checked like an outside call')))}
    ${tile(t('Held for a person'), d.gated, esc(t('gated, waiting on a human')), d.gated ? 'tile-warn' : '')}
    ${tile(t('Identity bar'), d.identity.ok ? t('holds') : t('BROKEN'), esc(t('an agent cannot occupy a human slot')), d.identity.ok ? 'tile-ok' : 'tile-bad')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Nothing crosses except through these'))}</div>
    <div class="map-legend">${esc(t(d.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Commands a machine may never complete alone'))}</div>
    <div class="map-legend">${d.alwaysHuman.map((c) => `<span class="chip chip-warn">${esc(c)}</span>`).join(' ')}</div>
    <div class="sub" style="margin-top:8px">${esc(t('Gated whatever the amount and whatever the agent\'s scopes say. A termination is not a large expense; it is a different kind of act.'))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The tool surface'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Tool'))}</th><th>${esc(t('Writes'))}</th><th>${esc(t('Permission'))}</th><th>${esc(t('What for'))}</th>
    </tr></thead><tbody>
      ${d.tools.map((x) => `<tr>
        <td class="mono">${esc(x.name)}</td>
        <td>${x.writes ? `<span class="chip chip-warn">${esc(t('yes'))}</span>` : `<span class="chip chip-dim">${esc(t('no'))}</span>`}</td>
        <td class="sub mono">${esc(x.permission)}</td>
        <td class="sub">${esc(t(x.about))}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Events, and which reach the chain'))}</div>
    <div class="map-legend">
      ${d.events.map((e2) => `<span class="chip ${d.chainedEvents.includes(e2) ? 'chip-ember' : 'chip-dim'}">${esc(e2)}</span>`).join(' ')}
    </div>
    <div class="sub" style="margin-top:8px">${esc(t('Highlighted events are also written to the audit chain. The rest stay in the operational log — a chain of every attendance ping buries the signal it exists to carry.'))}</div>
  </div>`;
}

/** Documents & knowledge base: the index is open, the contents are governed. */
export async function renderDocs() {
  const d = await api('/api/core2/docs').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the documents.'))}</div>`; return; }
  const o = d.overview;
  const cls = { public: 'chip-dim', internal: 'chip-ok', confidential: 'chip-warn', restricted: 'chip-ember' };

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Documents'), o.total, esc(t('active in the knowledge base')))}
    ${tile(t('Versions'), o.versions, esc(t('append-only — the next correction is the next version')))}
    ${tile(t('About people'), o.aboutPeople, esc(t('naming a subject who can erase them')))}
    ${tile(t('Sealed versions'), o.sealedVersions, esc(t('unreadable on the disk, by design')), o.sealedVersions ? 'tile-ok' : '')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Classification is an access decision'))}</div>
    <div class="map-legend">${esc(t(o.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The knowledge base'))}</div>
    <div style="margin-bottom:10px"><input id="doc-q" class="in" type="search" placeholder="${esc(t('Search titles and internal content'))}" aria-label="${esc(t('Search titles and internal content'))}"></div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Title'))}</th><th>${esc(t('Classification'))}</th><th>${esc(t('About'))}</th><th class="num">${esc(t('Version'))}</th>
    </tr></thead><tbody id="doc-rows">
      ${d.documents.map((x) => `<tr>
        <td><b>${esc(x.title)}</b></td>
        <td><span class="chip ${cls[x.classification] || 'chip-dim'}">${esc(t(x.classification))}</span></td>
        <td class="sub">${esc(x.about || '—')}</td>
        <td class="num mono">v${x.current_version}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty">${esc(t('Nothing written down yet.'))}</td></tr>`}
    </tbody></table></div>
  </div>

  ${hasPermC('docs.manage') ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('New document'))}</div>
    <form id="doc-new" style="display:grid;gap:8px;max-width:560px">
      <div><label class="fl" for="doc-title">${esc(t('Title'))}</label><input class="in" id="doc-title" required></div>
      <div><label class="fl" for="doc-cls">${esc(t('Classification'))}</label>
        <select class="in" id="doc-cls">
          ${['public', 'internal', 'confidential'].map((c) => `<option value="${c}">${esc(t(c))}</option>`).join('')}
        </select></div>
      <div><label class="fl" for="doc-body">${esc(t('Content'))}</label><textarea class="in" id="doc-body" rows="4"></textarea></div>
      <button class="btn btn-primary" type="submit">${esc(t('Create'))}</button>
    </form>
    <div class="sub" style="margin-top:8px">${esc(t('Restricted documents are created from a person\'s record, because they must name who they are about.'))}</div>
  </div>` : ''}`;

  $('#doc-q')?.addEventListener('input', async (ev) => {
    const term = ev.target.value.trim();
    if (!term) { renderDocs(); return; }
    const r = await api(`/api/core2/docs/search?q=${encodeURIComponent(term)}`).catch(() => ({ hits: [] }));
    $('#doc-rows').innerHTML = r.hits.map((x) => `<tr>
      <td><b>${esc(x.title)}</b></td>
      <td><span class="chip ${cls[x.classification] || 'chip-dim'}">${esc(t(x.classification))}</span></td>
      <td class="sub">—</td><td class="num mono">v${x.current_version}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty">${esc(t('Nothing matched. Guarded contents are never searched — that is the design, not a gap.'))}</td></tr>`;
  });

  $('#doc-new')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/core2/docs', { method: 'POST', body: {
        title: $('#doc-title').value, classification: $('#doc-cls').value, body: $('#doc-body').value || null,
      } });
      renderDocs();
    } catch (err) { alert(err.message); }
  });
}

/** Attendance and leave: who is in, who is away, and what waits on a manager. */
export async function renderTime() {
  const d = await api('/api/core2/time').catch(() => null);
  const lv = await api('/api/core2/leave').catch(() => ({ requests: [] }));
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see attendance.'))}</div>`; return; }
  const a = d.attendance;
  const lvCls = { pending: 'chip-warn', approved: 'chip-ok', rejected: 'chip-bad', cancelled: 'chip-dim' };

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Present'), a.present, esc(t('checked in today')), a.present ? 'tile-ok' : '')}
    ${tile(t('Absent'), a.absent, esc(t('no mark and not on leave')), a.absent ? 'tile-warn' : '')}
    ${tile(t('On leave'), a.onLeave, esc(t('approved and away')))}
    ${tile(t('Waiting on a manager'), d.pending, esc(t('leave requests pending')), d.pending ? 'tile-warn' : '')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Filing can be delegated; deciding cannot'))}</div>
    <div class="map-legend">${esc(t(d.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Today'))} · ${esc(a.day)}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Name'))}</th><th>${esc(t('In'))}</th><th>${esc(t('Out'))}</th><th>${esc(t('State'))}</th>
    </tr></thead><tbody>
      ${a.people.map((p) => `<tr>
        <td><b>${esc(p.display_name)}</b> <span class="sub mono">${esc(p.employee_no)}</span></td>
        <td class="sub mono">${esc((p.in || '—').slice(11, 16))}</td>
        <td class="sub mono">${esc((p.out || '—').slice(11, 16))}</td>
        <td>${p.onLeave ? `<span class="chip">${esc(t('on leave'))}</span>` : p.in ? `<span class="chip chip-ok">${esc(t('present'))}</span>` : `<span class="chip chip-warn">${esc(t('absent'))}</span>`}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty">${esc(t('Nobody is employed yet.'))}</td></tr>`}
    </tbody></table></div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Leave requests'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Who'))}</th><th>${esc(t('Type'))}</th><th>${esc(t('Days'))}</th><th>${esc(t('When'))}</th><th>${esc(t('State'))}</th><th></th>
    </tr></thead><tbody>
      ${lv.requests.map((r) => `<tr>
        <td><b>${esc(r.display_name)}</b></td>
        <td class="sub">${esc(t(r.leave_type))}${r.doc_id ? ` <span class="chip chip-ember" title="${esc(t('a sealed document is attached'))}">🔒</span>` : ''}</td>
        <td class="num">${r.days}</td>
        <td class="sub mono">${esc(r.starts)} → ${esc(r.ends)}</td>
        <td><span class="chip ${lvCls[r.state] || 'chip-dim'}">${esc(t(r.state))}</span></td>
        <td>${r.state === 'pending' && hasPermC('people.manage') ? `
          <button class="btn btn-sm" data-lv="${r.id}" data-ok="1">${esc(t('Approve'))}</button>
          <button class="btn btn-sm" data-lv="${r.id}" data-ok="0">${esc(t('Reject'))}</button>` : esc(r.decided_by || '')}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">${esc(t('No leave requests.'))}</td></tr>`}
    </tbody></table></div>
    <div class="sub" style="margin-top:8px">${esc(t('There is no reason column in this table, by design. A sick request carries a category and, at most, a sealed document.'))}</div>
  </div>`;

  view.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/core2/leave/${b.dataset.lv}/decide`, { method: 'POST', body: { approve: b.dataset.ok === '1' } });
      renderTime();
    } catch (err) { alert(err.message); }
  }));
}

/** Meetings: who was in the room, what was decided, and by whom. */
export async function renderMeetings() {
  const d = await api('/api/core2/meetings').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see meetings.'))}</div>`; return; }
  const o = d.overview;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Planned'), o.planned, esc(t('on the calendar')))}
    ${tile(t('Decisions'), o.decisions, esc(t('recorded with a meeting behind them')))}
    ${tile(t('Open actions'), o.openActions, esc(t('assigned to somebody employed')), o.openActions ? 'tile-warn' : '')}
    ${tile(t('Sealed transcripts'), o.sealedTranscripts, esc(t('unreadable on the disk, by design')))}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Only humans in the room'))}</div>
    <div class="map-legend">${esc(t(o.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Meetings'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Title'))}</th><th>${esc(t('Organizer'))}</th><th>${esc(t('When'))}</th>
      <th class="num">${esc(t('People'))}</th><th class="num">${esc(t('Decisions'))}</th><th>${esc(t('State'))}</th>
    </tr></thead><tbody>
      ${d.meetings.map((m) => `<tr>
        <td><b>${esc(m.title)}</b></td>
        <td class="sub">${esc(m.organizer)}</td>
        <td class="sub mono">${esc(m.scheduled_at)}</td>
        <td class="num">${m.participants}</td>
        <td class="num">${m.decisions}</td>
        <td><span class="chip ${m.state === 'completed' ? 'chip-ok' : m.state === 'cancelled' ? 'chip-dim' : 'chip-warn'}">${esc(t(m.state))}</span></td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">${esc(t('No meetings yet.'))}</td></tr>`}
    </tbody></table></div>
  </div>`;
}

/** Finance ops: expenses, payroll runs, cost centers — and who approved what. */
export async function renderFinOps() {
  const d = await api('/api/core2/finops').catch(() => null);
  const ex = await api('/api/core2/expenses').catch(() => ({ expenses: [] }));
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see finance operations.'))}</div>`; return; }
  const exCls = { submitted: 'chip-warn', approved: 'chip-ok', rejected: 'chip-bad', paid: 'chip-dim' };
  const runCls = { draft: 'chip-warn', approved: 'chip-ok', closed: 'chip-dim' };

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Expenses waiting'), d.expensesPending, esc(t('submitted, not yet decided')), d.expensesPending ? 'tile-warn' : '')}
    ${tile(t('Active loans'), d.activeLoans, esc(t('repaid through payroll')))}
    ${tile(t('Payroll runs'), d.runs.length, esc(t('drafted by arithmetic, approved by people')))}
    ${tile(t('Cost centers'), d.costCenters.length, esc(t('budgets with spend counted against them')))}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('One ledger, one master'))}</div>
    <div class="map-legend">${esc(t(d.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Payroll runs'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Period'))}</th><th class="num">${esc(t('Gross'))}</th><th class="num">${esc(t('Net'))}</th>
      <th>${esc(t('State'))}</th><th>${esc(t('Approved by'))}</th>
    </tr></thead><tbody>
      ${d.runs.map((r) => `<tr>
        <td class="mono">${esc(r.period)}</td>
        <td class="num">${money(r.total_gross)}</td>
        <td class="num">${money(r.total_net)}</td>
        <td><span class="chip ${runCls[r.state] || 'chip-dim'}">${esc(t(r.state))}</span></td>
        <td class="sub">${esc(r.approved_by || '—')}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="empty">${esc(t('No payroll yet.'))}</td></tr>`}
    </tbody></table></div>
    <div class="sub" style="margin-top:8px">${esc(t('Individual slips are sealed under each employee\'s own key. The totals stay readable because the ledger entry the close posts shows the aggregate regardless.'))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Expenses'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Who'))}</th><th>${esc(t('Category'))}</th><th class="num">${esc(t('Amount'))}</th><th>${esc(t('State'))}</th><th></th>
    </tr></thead><tbody>
      ${ex.expenses.map((e) => `<tr>
        <td><b>${esc(e.display_name)}</b></td>
        <td class="sub">${esc(e.category)}${e.kind === 'advance' ? ` <span class="chip chip-dim">${esc(t('advance'))}</span>` : ''}</td>
        <td class="num">${money(e.amount)}</td>
        <td><span class="chip ${exCls[e.state] || 'chip-dim'}">${esc(t(e.state))}</span></td>
        <td>${e.state === 'submitted' && hasPermC('finance.export') ? `
          <button class="btn btn-sm" data-ex="${e.id}" data-ok="1">${esc(t('Approve'))}</button>
          <button class="btn btn-sm" data-ex="${e.id}" data-ok="0">${esc(t('Reject'))}</button>`
    : e.state === 'approved' && hasPermC('finance.export') ? `<button class="btn btn-sm" data-pay="${e.id}">${esc(t('Pay'))}</button>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="empty">${esc(t('No expenses.'))}</td></tr>`}
    </tbody></table></div>
  </div>`;

  view.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/core2/expenses/${b.dataset.ex}/decide`, { method: 'POST', body: { approve: b.dataset.ok === '1' } }); renderFinOps(); }
    catch (err) { alert(err.message); }
  }));
  view.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/core2/expenses/${b.dataset.pay}/pay`, { method: 'POST', body: {} }); renderFinOps(); }
    catch (err) { alert(err.message); }
  }));
}

/** Procurement and the contract watch: the chain, and what lapses soon. */
export async function renderProcure() {
  const d = await api('/api/core2/procurement').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see procurement.'))}</div>`; return; }
  const o = d.overview;
  const stCls = { requested: 'chip-warn', approved: 'chip-ok', po: 'chip-ok', delivered: 'chip-ok', invoiced: 'chip-warn', paid: 'chip-dim', rejected: 'chip-bad' };

  view.innerHTML = `
  <div class="grid grid-3">
    ${tile(t('Open purchases'), o.open, esc(t('somewhere along the chain')))}
    ${tile(t('Awaiting approval'), o.awaitingApproval, esc(t('a human decision, not a ceiling')), o.awaitingApproval ? 'tile-warn' : '')}
    ${tile(t('Contracts expiring'), o.expiring.length, esc(t('inside ninety days')), o.expiring.length ? 'tile-warn' : '')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The chain refuses to skip'))}</div>
    <div class="map-legend">${esc(t(o.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Purchases'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Title'))}</th><th>${esc(t('Vendor'))}</th><th class="num">${esc(t('Amount'))}</th>
      <th>${esc(t('PO'))}</th><th>${esc(t('State'))}</th><th></th>
    </tr></thead><tbody>
      ${d.requests.map((p) => {
    const next = { requested: 'approved', approved: 'po', po: 'delivered', delivered: 'invoiced', invoiced: 'paid' }[p.state];
    return `<tr>
        <td><b>${esc(p.title)}</b></td>
        <td class="sub">${esc(p.vendor_name || '—')}</td>
        <td class="num">${money(p.amount)}</td>
        <td class="mono sub">${esc(p.po_no || '—')}</td>
        <td><span class="chip ${stCls[p.state] || 'chip-dim'}">${esc(t(p.state))}</span></td>
        <td>${next && hasPermC('finance.export') ? `<button class="btn btn-sm" data-adv="${p.id}" data-to="${next}">${esc(t('to'))} ${esc(t(next))}</button>` : ''}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" class="empty">${esc(t('Nothing being purchased.'))}</td></tr>`}
    </tbody></table></div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Contracts expiring soon'))}</div>
    ${o.expiring.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Title'))}</th><th>${esc(t('Counterparty'))}</th><th>${esc(t('Expires'))}</th>
    </tr></thead><tbody>
      ${o.expiring.map((c) => `<tr>
        <td><b>${esc(c.title)}</b></td><td class="sub">${esc(c.counterparty)}</td>
        <td class="mono">${esc(c.expires_at)}</td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('Nothing lapses inside ninety days.'))}</div>`}
    <div class="sub" style="margin-top:8px"><a href="#/legal">${esc(t('The contract record itself lives in Legal'))} →</a></div>
  </div>`;

  view.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/core2/procurement/${b.dataset.adv}/advance`, { method: 'POST', body: { to: b.dataset.to } }); renderProcure(); }
    catch (err) { alert(err.message); }
  }));
}

/** People lifecycle: the pipeline in, the growth inside, and the way out. */
export async function renderTalent() {
  const d = await api('/api/core2/talent').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the people lifecycle.'))}</div>`; return; }
  const o = d.overview;
  const appCls = { applied: 'chip-dim', screening: 'chip-warn', interview: 'chip-warn', offer: 'chip-ok', hired: 'chip-ok', rejected: 'chip-bad' };

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Open vacancies'), o.vacancies, esc(t('positions looking for a person')))}
    ${tile(t('In the pipeline'), o.inPipeline, esc(t('applications not yet decided')), o.inPipeline ? 'tile-warn' : '')}
    ${tile(t('Unrated reviews'), o.reviewsUnrated, esc(t('evidence written, judgment pending')), o.reviewsUnrated ? 'tile-warn' : '')}
    ${tile(t('Offboarding open'), o.offboarding, esc(t('assets and access still to recover')), o.offboarding ? 'tile-warn' : '')}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Two species, two pipelines'))}</div>
    <div class="map-legend">${esc(t(o.note))}</div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Applications'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Who'))}</th><th>${esc(t('Vacancy'))}</th><th>${esc(t('State'))}</th><th>${esc(t('Decided by'))}</th>
    </tr></thead><tbody>
      ${d.applications.map((a) => `<tr>
        <td><b>${esc(a.display_name)}</b>${a.doc_id ? ` <span class="chip chip-ember" title="${esc(t('a sealed document is attached'))}">🔒</span>` : ''}</td>
        <td class="sub">${esc(a.vacancy_title)}</td>
        <td><span class="chip ${appCls[a.state] || 'chip-dim'}">${esc(t(a.state))}</span></td>
        <td class="sub">${esc(a.decided_by || '—')}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty">${esc(t('Nobody has applied yet.'))}</td></tr>`}
    </tbody></table></div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Competency matrix'))}</div>
    ${d.matrix.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Who'))}</th><th>${esc(t('Course'))}</th><th>${esc(t('Earned'))}</th><th>${esc(t('Expires'))}</th><th>${esc(t('Standing'))}</th>
    </tr></thead><tbody>
      ${d.matrix.map((m) => `<tr>
        <td><b>${esc(m.display_name)}</b></td>
        <td class="sub">${esc(m.course)}</td>
        <td class="sub mono">${esc(m.earned_at)}</td>
        <td class="sub mono">${esc(m.expires_at || '—')}</td>
        <td><span class="chip ${m.standing === 'current' ? 'chip-ok' : 'chip-bad'}">${esc(t(m.standing))}</span></td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${esc(t('No certificates yet.'))}</div>`}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('What a machine may and may not do here'))}</div>
    <div class="map-legend">${esc(t('An AI screens applications, drafts review evidence and computes checklists. It cannot make an offer, hire, reject, rate, or terminate — those refuse a machine inside the record itself, whatever the agent\'s scopes say, and each one is chained when a human does it.'))}</div>
  </div>`;
}

/** The two galaxies: Core 1 on one side, Core 2 on the other, tunnels between. */
export async function renderGalaxies() {
  const d = await api('/api/core2/map').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the map.'))}</div>`; return; }

  // Core 1: thirteen divisions on an arc, sized by department count.
  const W = 1000; const H = 640;
  const c1 = d.core1.map((div, i) => {
    const a = (Math.PI * (i + 0.5)) / d.core1.length - Math.PI / 2;
    return { ...div, x: 210 + Math.cos(a) * -150, y: 320 + Math.sin(a) * 260 };
  });
  // Core 2: six enterprise divisions stacked on the right, departments as pills.
  let y = 46;
  const c2 = d.divisions.map((div) => {
    const h = 34 + div.departments.length * 30;
    const g = { ...div, x: 640, y, h };
    y += h + 16;
    return g;
  });
  const deptPos = new Map();
  for (const g of c2) g.departments.forEach((s, i) => deptPos.set(s.id, { x: 660, y: g.y + 40 + i * 30 }));
  const c1Pos = new Map(c1.map((v) => [v.id, v]));

  const tunnels = d.tunnels.map((t2) => {
    const a = deptPos.get(t2.core2End); const b = c1Pos.get(t2.core1Division);
    if (!a || !b) return '';
    return `<path d="M ${a.x} ${a.y} C ${a.x - 160} ${a.y}, ${b.x + 160} ${b.y}, ${b.x + 14} ${b.y}"
      fill="none" stroke="${esc(b.color)}" stroke-width="1.3" opacity="0.55">
      <title>${esc(t2.core2End)} ↔ ${esc(t2.core1End)}: ${esc(t(t2.label))}</title></path>`;
  }).join('');

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t('Two galaxies, one company'))}</div>
    <div class="map-legend">${esc(t('The AI core thinks and acts; the enterprise core records what is true. Nothing crosses between them except the tunnels drawn here — and every tunnel is a declared relationship the connectivity audit checks, not a line on a picture. This is the same catalogue as the first map, projected so the seam is the subject.'))}
      <a href="#/graph">${esc(t('The first map'))} →</a> · <a href="#/bridges">${esc(t('The bridges'))} →</a></div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:760px" role="img" aria-label="${esc(t('Two galaxies, one company'))}">
      <text x="150" y="26" fill="var(--ink-faint)" font-size="12" letter-spacing="2">${esc(t('CORE 1 — THINKS AND ACTS'))}</text>
      <text x="640" y="26" fill="var(--ink-faint)" font-size="12" letter-spacing="2">${esc(t('CORE 2 — RECORDS THE TRUTH'))}</text>
      ${tunnels}
      ${c1.map((v) => `<a href="#/graph"><g>
        <circle cx="${v.x}" cy="${v.y}" r="${10 + Math.min(v.count, 30) / 2}" fill="var(--bg-raise)" stroke="${esc(v.color)}" stroke-width="${v.touched ? 2.4 : 1.2}"/>
        <text x="${v.x}" y="${v.y - 16 - Math.min(v.count, 30) / 2}" text-anchor="middle" fill="${esc(v.color)}" font-size="10">${esc(divisionName(v.id, v.label))}</text>
        <title>${esc(v.label)} · ${v.count} ${esc(t('departments'))}${v.touched ? ' · ' + esc(t('reached by a tunnel')) : ''}</title>
      </g></a>`).join('')}
      ${c2.map((g) => `<g>
        <rect x="${g.x}" y="${g.y}" width="320" height="${g.h}" rx="8" fill="var(--bg-raise)" stroke="${esc(g.color)}" stroke-opacity="0.6"/>
        <text x="${g.x + 12}" y="${g.y + 22}" fill="${esc(g.color)}" font-size="11" letter-spacing="1.5">${esc(t(g.label))}</text>
        ${g.departments.map((s, i) => `<a href="${esc(s.href)}">
          <text x="${g.x + 22}" y="${g.y + 44 + i * 30}" fill="var(--ink)" font-size="12.5">${esc(sectionName(s.id, s.label))} <tspan fill="var(--ink-faint)" font-size="10.5">${s.count}</tspan></text>
        </a>`).join('')}
      </g>`).join('')}
    </svg></div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The tunnels'))} · ${d.tunnels.length}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Enterprise'))}</th><th>${esc(t('AI core'))}</th><th>${esc(t('Why they are joined'))}</th>
    </tr></thead><tbody>
      ${d.tunnels.map((t2) => `<tr>
        <td class="mono">${esc(t2.core2End)}</td>
        <td class="mono">${esc(t2.core1End)}</td>
        <td class="sub">${esc(t(t2.label))}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <div class="sub" style="margin-top:8px">${esc(t('A tunnel with no declared edge behind it cannot exist on this page — the drawing is derived, never drawn.'))}</div>
  </div>`;
}
