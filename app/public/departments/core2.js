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
