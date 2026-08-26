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
import { t, sectionName } from '/i18n.js';
import { buildMap, initAtlas } from '../views/map.js';

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
  // This page used to draw its own picture — an arc of thirteen circles and a
  // stack of pills, static, with every circle linking to the same place. It
  // said in its own legend that it was "the same catalogue as the first map,
  // projected so the seam is the subject", and two independent drawings of one
  // catalogue is precisely the thing the declared edge between these two pages
  // says must not happen: the maps cannot disagree. So it no longer draws. It
  // opens the real atlas — pan, zoom, hover to isolate, click for a section's
  // connection ledger, trace a flow hop by hop — with the seam lit, and keeps
  // the one thing that was genuinely its own: the tunnel ledger underneath.
  const d = await api('/api/map').catch(() => null);
  if (!d) { view.innerHTML = `<div class="empty">${esc(t('You do not have permission to see the map.'))}</div>`; return; }

  const tunnels = d.core2?.tunnels || [];
  const isolated = d.core2?.audit?.isolated || [];

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t('Two galaxies, one company'))}</div>
    <div class="map-legend">${esc(t('The AI core thinks and acts; the enterprise core records what is true. Nothing crosses between them except the tunnels lit here — and every tunnel is a declared relationship the connectivity audit checks, not a line on a picture. This is the same map as the atlas, opened on the seam.'))}
      <a href="#/graph">${esc(t('The matrix'))} →</a> · <a href="#/bridges">${esc(t('The bridges'))} →</a></div>
  </div>
  <div class="panel" style="margin-top:16px">
    ${buildMap(d, { far: true })}
    <div class="sub" style="margin-top:10px">
      <b>${esc(t('Click'))}</b> ${esc(t('a department for everything it touches'))} ·
      <b>${esc(t('right-click'))}</b> ${esc(t('to trace a flow hop by hop'))} ·
      <b>${esc(t('drag / wheel'))}</b> ${esc(t('pans and zooms'))}.
      ${isolated.length ? `<b style="color:var(--bad)">${esc(t('No tunnel reaches'))}: ${isolated.map((id) => esc(sectionName(id, id))).join(', ')}</b>` : ''}
    </div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('The tunnels'))} · ${tunnels.length}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Enterprise'))}</th><th>${esc(t('AI core'))}</th><th>${esc(t('Why they are joined'))}</th>
    </tr></thead><tbody>
      ${tunnels.map((t2) => `<tr>
        <td class="mono">${esc(t2.core2End)}</td>
        <td class="mono">${esc(t2.core1End)}</td>
        <td class="sub">${esc(t(t2.label || ''))}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <div class="sub" style="margin-top:8px">${esc(t('A tunnel with no declared edge behind it cannot exist on this page — the drawing is derived, never drawn.'))}</div>
  </div>`;

  initAtlas(d, { lens: 'seam' });
}

// Files — sealed bytes, not a path in a sealed column.
export async function renderFiles() {
  const f = await api('/api/core2/files');
  const row = (x) => `<tr>
      <td class="mono">${x.id}</td>
      <td>${esc(x.filename)}${x.note ? `<div class="sub">${esc(x.note)}</div>` : ''}</td>
      <td class="sub">${esc(x.mime || '—')}</td>
      <td class="num">${(x.bytes / 1024).toFixed(0)} KB</td>
      <td>${x.attach_type ? `<span class="chip chip-dim">${esc(x.attach_type)} ${x.attach_id}</span>` : '<span class="sub">—</span>'}</td>
      <td class="mono" style="font-size:11px">${esc(x.uploaded_by)}</td>
      <td class="sub">${esc(String(x.created_at || '').slice(0, 16))}</td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Files'), f.files, `${f.megabytes} MB ${t('sealed')}`)}
    ${tile(t('Deleted'), f.deleted, t('tombstoned, not vanished'))}
    ${tile(t('On disk'), f.blobsOnDisk, f.consistent ? t('matches the record') : `${f.orphans} ${t('unaccounted for')}`, f.consistent ? '' : 'tile-warn')}
    ${tile(t('Limit'), `${f.limitMb} MB`, t('per file'))}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('What this refuses'))}</div>
    ${f.refuses.map((r) => `<div class="meter-label"><span>${esc(t(r))}</span></div>`).join('')}
    <div class="map-legend">${esc(t('The bytes are encrypted with the subject\'s own key and written outside the database. Erasing the person destroys the key, and with it the file — a path in a sealed column would have protected nothing.'))}</div>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>${esc(t('Add a file'))}</span>
      <span><input type="file" id="f-pick" aria-label="${esc(t('Choose a file'))}"> <button class="btn btn-primary" id="f-up">${esc(t('Upload'))}</button></span>
    </div>
    <div id="f-out" class="sub"></div>
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('By what they belong to'))}</div>
    ${f.byKind.length
    ? `<table class="tbl"><thead><tr><th>${esc(t('Attached to'))}</th><th class="num">${esc(t('Files'))}</th><th class="num">KB</th></tr></thead><tbody>${f.byKind.map((k) => `<tr><td>${esc(k.kind || t('nothing'))}</td><td class="num">${k.n}</td><td class="num">${(k.bytes / 1024).toFixed(0)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('no files yet'))}</div>`}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Recent'))}</div>
    ${f.recent.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>${esc(t('Name'))}</th><th>${esc(t('Type'))}</th><th class="num">${esc(t('Size'))}</th><th>${esc(t('Attached to'))}</th><th>${esc(t('By'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>${f.recent.map(row).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('no files yet'))}</div>`}
  </div>`;

  $('#f-up').addEventListener('click', async () => {
    const picked = $('#f-pick').files?.[0];
    if (!picked) { toast(t('choose a file first'), true); return; }
    const out = $('#f-out');
    out.textContent = t('sealing…');
    try {
      const buf = await picked.arrayBuffer();
      // Base64 in the body rather than a multipart stream: the bytes are sealed
      // in the server process, and a separate upload path would be a second
      // door into the same room.
      let bin = '';
      const view8 = new Uint8Array(buf);
      for (let i = 0; i < view8.length; i += 1) bin += String.fromCharCode(view8[i]);
      const r = await api('/api/core2/files', {
        method: 'POST',
        body: { bytes: btoa(bin), filename: picked.name, mime: picked.type || null },
      });
      out.textContent = `${r.filename} — ${r.bytes} ${t('bytes, sealed')}`;
      render();
    } catch (e) { out.textContent = e.message; }
  });
}

// Records — how long a thing is kept, on whose authority, and what freezes it.
export async function renderRecords() {
  const r = await api('/api/core2/records');
  const cls = (c) => `<tr>
      <td class="mono">${esc(c.code)}</td>
      <td>${esc(t(c.label))}<div class="sub">${esc(t(c.basis))}</div></td>
      <td class="num">${c.keep_months}</td>
      <td><span class="chip ${c.disposition === 'keep-forever' ? 'chip-steel' : 'chip-dim'}">${esc(t(c.disposition))}</span></td>
      <td class="num">${c.disposition === 'keep-forever' ? '—' : c.due}</td>
      <td class="sub">${c.frozen ? `<span class="chip chip-warn">${esc(t('frozen'))}</span> ` : ''}${esc(t(c.say))}</td>
    </tr>`;
  const hold = (h) => `<tr>
      <td class="mono">${h.id}</td>
      <td>${esc(h.scope_kind)}${h.scope_id ? ` ${esc(h.scope_id)}` : ''}</td>
      <td>${esc(h.matter || '—')}<div class="sub">${esc(h.reason)}</div></td>
      <td class="mono" style="font-size:11px">${esc(h.placed_by)}</td>
      <td class="sub">${esc(String(h.placed_at || '').slice(0, 16))}</td>
      <td><button class="btn btn-sm" data-release="${h.id}">${esc(t('Release'))}</button></td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Retention classes'), r.classes.length, t('each with a stated basis'))}
    ${tile(t('Past their date'), r.dueTotal, t('and disposable'), r.dueTotal ? 'tile-warn' : '')}
    ${tile(t('Frozen'), r.frozenTotal, t('held, not disposable'))}
    ${tile(t('Legal holds'), r.holds.length, r.everythingFrozen ? t('everything is frozen') : t('live'), r.holds.length ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('What this does and does not do'))}</div>
    <p class="lede">${esc(t(r.says))}</p>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>${esc(t('Legal holds'))}</span>
      <button class="btn btn-sm" id="rec-hold">${esc(t('Place a hold'))}</button>
    </div>
    ${r.holds.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>${esc(t('Covers'))}</th><th>${esc(t('Matter'))}</th><th>${esc(t('Placed by'))}</th><th>${esc(t('When'))}</th><th></th></tr></thead><tbody>${r.holds.map(hold).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('nothing is held — the schedule applies as written'))}</div>`}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('The retention schedule'))}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${esc(t('Code'))}</th><th>${esc(t('Records'))}</th><th class="num">${esc(t('Months'))}</th>
      <th>${esc(t('At the end'))}</th><th class="num">${esc(t('Due'))}</th><th>${esc(t('State'))}</th>
    </tr></thead><tbody>${r.classes.map(cls).join('')}</tbody></table></div>
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Disposals'))}</div>
    ${r.disposals.length
    ? `<table class="tbl"><thead><tr><th>${esc(t('Class'))}</th><th>${esc(t('What'))}</th><th>${esc(t('Action'))}</th><th class="num">${esc(t('Count'))}</th><th>${esc(t('By'))}</th><th>${esc(t('When'))}</th></tr></thead><tbody>
      ${r.disposals.map((d) => `<tr><td class="mono">${esc(d.class_code)}</td><td>${esc(d.what)}</td><td>${esc(t(d.action))}</td><td class="num">${d.count}</td><td class="mono" style="font-size:11px">${esc(d.decided_by)}</td><td class="sub">${esc(String(d.at || '').slice(0, 16))}</td></tr>`).join('')}
    </tbody></table>`
    : `<div class="empty">${esc(t('nothing has been disposed of'))}</div>`}
  </div>`;

  view.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt(t('Why is the hold being lifted?'));
    if (note === null) return;
    try { await api(`/api/core2/records/hold/${b.dataset.release}/release`, { method: 'POST', body: { note } }); render(); }
    catch (e) { toast(e.message, true); }
  }));

  $('#rec-hold').addEventListener('click', async () => {
    const scopeKind = prompt(`${t('Covering what?')} ${r.scopes.join(' / ')}`);
    if (!scopeKind) return;
    const scopeId = scopeKind === 'everything' ? null : prompt(t('Which one? (an id, or a class code)'));
    if (scopeKind !== 'everything' && !scopeId) return;
    const matter = prompt(t('Which matter or case?'));
    const reason = prompt(t('Why? A hold nobody can explain never gets lifted.'));
    if (!reason) return;
    try { await api('/api/core2/records/hold', { method: 'POST', body: { scopeKind, scopeId, matter, reason } }); render(); }
    catch (e) { toast(e.message, true); }
  });
}

// Rosters, and the extra minutes that are not overtime until somebody says so.
export async function renderShifts() {
  const s = await api('/api/core2/shifts');
  const shift = (x) => `<tr>
      <td>${esc(x.name)}</td>
      <td class="mono">${esc(x.starts)} – ${esc(x.ends)}</td>
      <td class="sub">${x.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).map((d) => esc(t(d))).join(' ')}</td>
      <td class="num">${x.assigned}</td>
    </tr>`;
  const claim = (c) => `<tr>
      <td>${esc(c.display_name)}</td>
      <td class="mono">${esc(c.day)}</td>
      <td class="num">${Math.floor(c.minutes / 60)}h ${c.minutes % 60}m</td>
      <td>${esc(c.reason)}</td>
      <td class="mono" style="font-size:11px">${esc(c.claimed_by)}</td>
      <td>
        <button class="btn btn-sm" data-ot-yes="${c.id}">${esc(t('Approve'))}</button>
        <button class="btn btn-sm btn-bad" data-ot-no="${c.id}">${esc(t('Refuse'))}</button>
      </td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Shifts'), s.shifts.length, t('rosters defined'))}
    ${tile(t('On no roster'), s.unrostered, t('cannot be late, cannot claim'), s.unrostered ? 'tile-warn' : '')}
    ${tile(t('Waiting on you'), s.pending.length, t('overtime claims'), s.pending.length ? 'tile-warn' : '')}
    ${tile(t('Approved'), `${Math.floor((s.approvedThisPeriod.m || 0) / 60)}h`, `${s.approvedThisPeriod.n} ${esc(t('claims this period'))}`)}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('What counts, and what does not'))}</div>
    <p class="lede">${esc(t(s.says))}</p>
    <div class="map-legend">${esc(t('Arriving late is forgiven for the first'))} ${s.graceMinutes} ${esc(t('minutes — a company that counts one minute as late spends its mornings arguing about clocks.'))}</div>
  </div>

  <div class="panel">
    <div class="panel-title"><span>${esc(t('Overtime waiting for a decision'))}</span></div>
    ${s.pending.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(t('Who'))}</th><th>${esc(t('Day'))}</th><th class="num">${esc(t('Extra'))}</th><th>${esc(t('What for'))}</th><th>${esc(t('Claimed by'))}</th><th></th></tr></thead><tbody>${s.pending.map(claim).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('nothing waiting'))}</div>`}
  </div>

  <div class="panel">
    <div class="panel-title"><span>${esc(t('Rosters'))}</span><button class="btn btn-sm" id="sh-add">${esc(t('Add a shift'))}</button></div>
    ${s.shifts.length
    ? `<table class="tbl"><thead><tr><th>${esc(t('Name'))}</th><th>${esc(t('Hours'))}</th><th>${esc(t('Days'))}</th><th class="num">${esc(t('On it'))}</th></tr></thead><tbody>${s.shifts.map(shift).join('')}</tbody></table>`
    : `<div class="empty">${esc(t('no shifts yet'))}</div>`}
  </div>`;

  const decide = async (id, approve) => {
    try { await api(`/api/core2/overtime/${id}/decide`, { method: 'POST', body: { approve } }); render(); }
    catch (e) { toast(e.message, true); }
  };
  view.querySelectorAll('[data-ot-yes]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.otYes, true)));
  view.querySelectorAll('[data-ot-no]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.otNo, false)));
  $('#sh-add').addEventListener('click', async () => {
    const name = prompt(t('What is this shift called?')); if (!name) return;
    const starts = prompt(t('Starts at (HH:MM)'), '09:00'); if (!starts) return;
    const ends = prompt(t('Ends at (HH:MM)'), '17:00'); if (!ends) return;
    try { await api('/api/core2/shifts', { method: 'POST', body: { name, starts, ends } }); render(); }
    catch (e) { toast(e.message, true); }
  });
}

// What the company deducts, and on whose authority.
export async function renderPayRules() {
  const p = await api('/api/core2/payrules');
  const rule = (r) => `<tr>
      <td class="mono">${esc(r.code)}</td>
      <td>${esc(t(r.label))}<div class="sub">${esc(r.basis)}</div></td>
      <td><span class="chip chip-dim">${esc(t(r.kind))}</span></td>
      <td class="sub">${esc(t(r.base))} · ${esc(t(r.paid_by))}</td>
      <td class="mono">${r.percent !== null ? `${r.percent}%` : `${(r.bands || []).length} ${esc(t('bands'))}`}</td>
      <td class="mono">${r.cap_amount ? esc(money(r.cap_amount)) : '—'}</td>
      <td>${r.active ? `<span class="chip chip-ok">${esc(t('live'))}</span>` : `<span class="chip chip-dim">${esc(t('off'))}</span>`}</td>
    </tr>`;
  const eos = p.endOfService;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Rules'), p.active, t('live, each with a stated basis'), p.configured ? '' : 'tile-warn')}
    ${tile(t('Tax'), p.rules.filter((r) => r.kind === 'tax').length, t('declared'))}
    ${tile(t('Contributions'), p.rules.filter((r) => r.kind === 'contribution').length, t('declared'))}
    ${tile(t('End of service'), eos.configured ? `${eos.perYearFirst}/${eos.perYearAfter}` : t('not set'), eos.configured ? t('days per year, before and after the threshold') : t('reported as unknown, never as zero'), eos.configured ? '' : 'tile-warn')}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('Why this is not a set of zeros'))}</div>
    <p class="lede">${esc(t(p.says))}</p>
  </div>

  ${p.example ? `<div class="panel">
    <div class="panel-title">${esc(t('Worked through, on a salary of 5,000'))}</div>
    <table class="tbl"><thead><tr><th>${esc(t('Line'))}</th><th>${esc(t('On'))}</th><th class="num">${esc(t('Amount'))}</th><th>${esc(t('Paid by'))}</th></tr></thead><tbody>
      ${p.example.lines.map((l) => `<tr><td>${esc(t(l.label))}</td><td class="mono">${esc(money(l.on))} (${esc(t(l.base))})</td><td class="num">${esc(money(l.amount))}</td><td>${esc(t(l.paidBy))}</td></tr>`).join('')}
      <tr><td><strong>${esc(t('Deducted from the employee'))}</strong></td><td></td><td class="num"><strong>${esc(money(p.example.employeeTotal))}</strong></td><td></td></tr>
      <tr><td><strong>${esc(t('Cost to the company'))}</strong></td><td></td><td class="num"><strong>${esc(money(p.example.employerTotal))}</strong></td><td></td></tr>
    </tbody></table>
    <div class="map-legend">${esc(t('An employer contribution is a company cost, never a deduction from the person — adding them together understates somebody\'s net pay.'))}</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title"><span>${esc(t('The rules'))}</span><button class="btn btn-sm" id="pr-add">${esc(t('Add a rule'))}</button></div>
    ${p.rules.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(t('Code'))}</th><th>${esc(t('What'))}</th><th>${esc(t('Kind'))}</th><th>${esc(t('Applied to'))}</th><th>${esc(t('Rate'))}</th><th>${esc(t('Cap'))}</th><th>${esc(t('State'))}</th></tr></thead><tbody>${p.rules.map(rule).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('nothing declared — tax and contributions are reported as unknown'))}</div>`}
  </div>`;

  $('#pr-add').addEventListener('click', async () => {
    const code = prompt(t('A short code (income, social, pension)')); if (!code) return;
    const label = prompt(t('What is it called on a slip?')); if (!label) return;
    const percent = prompt(t('A flat percentage, or leave blank to add bands by API'));
    const basis = prompt(t('What says so? The law, the contract, or the policy.'));
    if (!basis) { toast(t('a deduction nobody can cite is one nobody can defend'), true); return; }
    try {
      await api('/api/core2/payrules', { method: 'POST', body: { code, label, percent: percent ? Number(percent) : null, basis } });
      render();
    } catch (e) { toast(e.message, true); }
  });
}

// Who is holding what.
export async function renderCustody() {
  const c = await api('/api/core2/custody');
  const item = (x) => `<tr>
      <td>${esc(x.display_name)}</td>
      <td>${esc(x.asset_name || x.description)}${x.serial ? `<div class="sub mono">${esc(x.serial)}</div>` : ''}</td>
      <td><span class="chip chip-dim">${esc(t(x.asset_kind || 'unlisted'))}</span></td>
      <td class="sub">${esc(t(x.condition_out))}</td>
      <td class="sub">${esc(String(x.issued_at || '').slice(0, 10))}</td>
      <td><button class="btn btn-sm" data-back="${x.id}">${esc(t('Take it back'))}</button></td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Out now'), c.out, t('in somebody\'s hands'))}
    ${tile(t('With leavers'), c.withLeavers.reduce((n, w) => n + w.items, 0), t('held by people who have gone'), c.withLeavers.length ? 'tile-warn' : '')}
    ${tile(t('Returned'), c.returned, t('handed back'))}
    ${tile(t('Damaged'), c.damaged, t('came back worse than it went'), c.damaged ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('What this is, and what it refuses'))}</div>
    <p class="lede">${esc(t(c.says))}</p>
  </div>

  ${c.withLeavers.length ? `<div class="panel" style="border-color:var(--warn)">
    <div class="panel-title">${esc(t('Held by people who have left'))}</div>
    <table class="tbl"><thead><tr><th>${esc(t('Who'))}</th><th>${esc(t('State'))}</th><th class="num">${esc(t('Items'))}</th></tr></thead><tbody>
      ${c.withLeavers.map((w) => `<tr><td>${esc(w.display_name)}</td><td><span class="chip chip-warn">${esc(t(w.state))}</span></td><td class="num">${w.items}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title"><span>${esc(t('Out now'))}</span><button class="btn btn-sm" id="cu-issue">${esc(t('Hand something over'))}</button></div>
    ${c.items.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(t('Who'))}</th><th>${esc(t('What'))}</th><th>${esc(t('Kind'))}</th><th>${esc(t('Condition'))}</th><th>${esc(t('Since'))}</th><th></th></tr></thead><tbody>${c.items.map(item).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('nothing is out'))}</div>`}
  </div>`;

  view.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', async () => {
    const condition = prompt(`${t('What condition is it in?')} ${c.conditions.join(' / ')}`, 'good');
    if (!condition) return;
    try { await api(`/api/core2/custody/${b.dataset.back}/return`, { method: 'POST', body: { condition } }); render(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#cu-issue').addEventListener('click', async () => {
    const employeeId = prompt(t('Which employee? (id)')); if (!employeeId) return;
    const description = prompt(t('What is it? (or leave blank and give an asset id)'));
    const assetId = description ? null : prompt(t('Asset id from the register'));
    try { await api('/api/core2/custody', { method: 'POST', body: { employeeId: Number(employeeId), description, assetId: assetId ? Number(assetId) : null } }); render(); }
    catch (e) { toast(e.message, true); }
  });
}

// A first day and a last day, as a checklist rather than as somebody's memory.
export async function renderJoining() {
  const j = await api('/api/core2/joining');
  const row = (l) => `<tr>
      <td>${esc(l.display_name)}</td>
      <td><span class="chip ${l.kind === 'leaving' ? 'chip-warn' : 'chip-ok'}">${esc(t(l.kind))}</span></td>
      <td class="mono">${esc(l.on_day)}</td>
      <td class="num">${l.done}/${l.steps}</td>
      <td>${l.critical_open ? `<span class="chip chip-bad">${l.critical_open} ${esc(t('critical open'))}</span>` : `<span class="chip chip-ok">${esc(t('clear'))}</span>`}</td>
      <td><span class="chip ${l.state === 'open' ? 'chip-steel' : 'chip-dim'}">${esc(t(l.state))}</span></td>
      <td><button class="btn btn-sm" data-open="${l.id}">${esc(t('Open'))}</button></td>
    </tr>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile(t('Open checklists'), j.open, `${j.joining} ${esc(t('joining'))} · ${j.leaving} ${esc(t('leaving'))}`)}
    ${tile(t('Overdue steps'), j.overdue.length, t('past their day and not done'), j.overdue.length ? 'tile-warn' : '')}
    ${tile(t('Joining template'), j.templates.joining.length, t('steps'))}
    ${tile(t('Leaving template'), j.templates.leaving.length, t('steps'))}
  </div>

  <div class="panel">
    <div class="panel-title">${esc(t('How this closes'))}</div>
    <p class="lede">${esc(t(j.says))}</p>
  </div>

  ${j.overdue.length ? `<div class="panel" style="border-color:var(--warn)">
    <div class="panel-title">${esc(t('Overdue'))}</div>
    <table class="tbl"><thead><tr><th>${esc(t('Who'))}</th><th>${esc(t('Step'))}</th><th>${esc(t('Owner'))}</th><th>${esc(t('Due'))}</th></tr></thead><tbody>
      ${j.overdue.map((s) => `<tr><td>${esc(s.display_name)}</td><td>${esc(t(s.label))}${s.critical ? ` <span class="chip chip-bad">${esc(t('critical'))}</span>` : ''}</td><td class="sub">${esc(t(s.owner_role || ''))}</td><td class="mono">${esc(s.due_on)}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title"><span>${esc(t('Checklists'))}</span><button class="btn btn-sm" id="jn-new">${esc(t('Start one'))}</button></div>
    ${j.lists.length
    ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(t('Who'))}</th><th>${esc(t('Kind'))}</th><th>${esc(t('Day'))}</th><th class="num">${esc(t('Done'))}</th><th>${esc(t('Blocking'))}</th><th>${esc(t('State'))}</th><th></th></tr></thead><tbody>${j.lists.map(row).join('')}</tbody></table></div>`
    : `<div class="empty">${esc(t('none yet'))}</div>`}
  </div>

  <div id="jn-detail"></div>`;

  const showList = async (id) => {
    const d = await api(`/api/core2/joining/${id}`);
    const step = (s) => `<tr>
        <td>${s.done_at ? '✓' : '·'}</td>
        <td>${esc(t(s.label))}${s.critical ? ` <span class="chip chip-bad">${esc(t('critical'))}</span>` : ''}${s.skipped ? ` <span class="chip chip-warn">${esc(t('skipped'))}</span>` : ''}</td>
        <td class="sub">${esc(t(s.owner_role || ''))}</td>
        <td class="mono">${esc(s.due_on)}</td>
        <td class="sub">${esc(s.done_by || '')}${s.note ? ` — ${esc(s.note)}` : ''}</td>
        <td>${s.done_at ? '' : `<button class="btn btn-sm" data-tick="${s.id}">${esc(t('Done'))}</button> <button class="btn btn-sm" data-skip="${s.id}">${esc(t('Skip'))}</button>`}</td>
      </tr>`;
    $('#jn-detail').innerHTML = `<div class="panel">
      <div class="panel-title">
        <span>${esc(d.display_name)} — ${esc(t(d.kind))} ${esc(d.on_day)}</span>
        <span>${d.state === 'open' ? `<button class="btn btn-sm btn-primary" id="jn-close">${esc(t('Close it'))}</button>` : `<span class="chip chip-dim">${esc(t('closed'))}</span>`}</span>
      </div>
      ${d.criticalOpen.length ? `<div class="map-legend" style="color:var(--warn)">${esc(t('Still blocking'))}: ${d.criticalOpen.map((x) => esc(t(x))).join(' · ')}</div>` : ''}
      <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>${esc(t('Step'))}</th><th>${esc(t('Owner'))}</th><th>${esc(t('Due'))}</th><th>${esc(t('By'))}</th><th></th></tr></thead><tbody>${d.steps.map(step).join('')}</tbody></table></div>
    </div>`;

    $('#jn-detail').querySelectorAll('[data-tick]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/core2/joining/step/${b.dataset.tick}`, { method: 'POST', body: {} }); showList(id); }
      catch (e) { toast(e.message, true); }
    }));
    $('#jn-detail').querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', async () => {
      const why = prompt(t('Why is this being skipped?'));
      if (why === null) return;
      try { await api(`/api/core2/joining/step/${b.dataset.skip}`, { method: 'POST', body: { skip: true, why } }); showList(id); }
      catch (e) { toast(e.message, true); }
    }));
    const close = $('#jn-close');
    if (close) {
      close.addEventListener('click', async () => {
        try { await api(`/api/core2/joining/${id}/close`, { method: 'POST', body: {} }); toast(t('closed')); render(); }
        catch (e) { toast(e.message, true); }
      });
    }
  };

  view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showList(b.dataset.open)));
  $('#jn-new').addEventListener('click', async () => {
    const employeeId = prompt(t('Which employee? (id)')); if (!employeeId) return;
    const kind = prompt(t('joining or leaving?'), 'joining'); if (!kind) return;
    try { await api('/api/core2/joining', { method: 'POST', body: { employeeId: Number(employeeId), kind } }); render(); }
    catch (e) { toast(e.message, true); }
  });
  if (j.lists.length) showList(j.lists[0].id);
}
