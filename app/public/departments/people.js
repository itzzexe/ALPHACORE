// The people surface, and the pages that belong to no single door: the
// overview, the detail views a link can land on, and the offices the workforce
// moves around in.
//
// 'Shared' here means genuinely shared — a request detail is reached from four
// surfaces and belongs to none of them. It is not a drawer for leftovers:
// every name in it was checked against the route table first.

import { $, esc, linkFor, money, money4, short, toast, view } from '../core/dom.js';
import { DEPT_COLORS, GROUP_COLOR, MOOD, figure, initials } from '../components/bits.js';
import { REQ_STATE_CLS, bubble, renderConnections, wireDownloads } from '../components/common.js';
import { SURFACE_LABEL, SURFACE_ORDER, holdPoll, routeOf } from '../core/shell.js';
import { actor, currentUser, hasPermC, navPerm } from '../state/session.js';
import { api } from '../services/api.js';
import { atlasGoTo, atlasStep, atlasZoom, buildMap, buildSystemMap, initAtlas, initMapInteractivity } from '../views/map.js';
import { certificationPanel, flowLegend, stateChip } from '../components/widgets.js';
import { preBody, scoreChip, wireXact, xbtn } from '../components/chrome.js';
import { tile } from '../components/tile.js';
import { t, sectionName, divisionName } from '/i18n.js';

/** The router hands the id straight through: #/s/approvals → 'approvals'. */
export async function renderSurfaceRoute(arg) {
  const id = SURFACE_ORDER.includes(arg) ? arg : null;
  if (!id) { view.innerHTML = `<div class="empty">${esc(t('No such surface.'))}</div>`; return; }
  document.title = `${t(SURFACE_LABEL[id])} — AlphaCore`;
  const h = $('#page-title');
  if (h) h.textContent = t(SURFACE_LABEL[id]);
  return renderSurface(id);
}
async function renderSurface(id) {
  const d = await api('/api/surfaces').catch(() => null);
  const s = (d?.surfaces || []).find((x) => x.id === id);
  if (!s) { view.innerHTML = `<div class="empty">${esc(t('No such surface.'))}</div>`; return; }
  const mine = s.departments.filter((x) => {
    const perm = navPerm[routeOf(x.href)];
    return !perm || hasPermC(perm);
  });
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t(SURFACE_LABEL[id] || s.label))}</div>
    <div class="map-legend">${esc(t(s.hint))}</div>
  </div>
  <div class="grid grid-3" style="margin-top:16px">
    ${mine.map((x) => `<a class="panel surface-card" href="${x.href}">
      <div class="panel-title">${esc(sectionName(x.id, x.label))}</div>
      <div class="big">${x.count}</div>
      <div class="sub">${esc(t(x.hint || ''))}</div>
    </a>`).join('') || `<div class="empty">${esc(t('Nothing here you have permission to see.'))}</div>`}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="map-legend">${esc(t('Every department still has its own page and its own address — nothing was removed. This is a door, not a replacement.'))}
      <a href="#/departments">${esc(t('All departments'))} →</a> · <a href="#/graph">${esc(t('The map'))} →</a></div>
  </div>`;
}
/** The full list, still grouped the way the org chart groups it. */
export async function renderDepartments() {
  const d = await api('/api/map').catch(() => ({ sections: [], divisions: [], surfaces: [] }));
  const mine = (d.sections || []).filter((s) => {
    const perm = navPerm[routeOf(s.href)];
    return !perm || hasPermC(perm);
  });
  const bySurface = new Map((d.surfaces || []).map((s) => [s.id, s]));
  const surfaceFor = new Map();
  for (const s of d.surfaces || []) for (const x of s.departments || []) surfaceFor.set(x.id, s.id);

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t('Every department'))}</div>
    <div class="map-legend">${esc(t('The eight doors are a way in, not a shorter list. All of it is still here, still grouped by division the way the org chart groups it, and every route that ever worked still works.'))}</div>
    <div style="margin-top:10px"><input id="dept-filter" class="in" type="search" placeholder="${esc(t('Filter departments'))}" aria-label="${esc(t('Filter departments'))}"></div>
  </div>
  <div class="table-wrap" style="margin-top:16px">
    <table class="tbl"><thead><tr>
      <th>${esc(t('Department'))}</th><th>${esc(t('Door'))}</th><th>${esc(t('Division'))}</th><th class="num">${esc(t('Records'))}</th>
    </tr></thead><tbody id="dept-rows">
      ${mine.map((s) => {
    const surf = surfaceFor.get(s.id);
    return `<tr data-name="${esc(`${s.id} ${s.label} ${s.hint || ''}`.toLowerCase())}">
        <td><a href="${s.href}"><b>${esc(sectionName(s.id, s.label))}</b></a><div class="sub">${esc(t(s.hint || ''))}</div></td>
        <td>${surf ? `<a class="chip" href="#/s/${surf}">${esc(t(SURFACE_LABEL[surf] || bySurface.get(surf)?.label || surf))}</a>` : `<span class="chip chip-bad">${esc(t('unfiled'))}</span>`}</td>
        <td class="sub">${esc(divisionName(s.division, s.division))}</td>
        <td class="num">${s.count}</td>
      </tr>`;
  }).join('')}
    </tbody></table>
  </div>`;

  const box = $('#dept-filter');
  box?.addEventListener('input', () => {
    const term = box.value.trim().toLowerCase();
    document.querySelectorAll('#dept-rows tr').forEach((tr) => {
      tr.hidden = Boolean(term) && !tr.dataset.name.includes(term);
    });
  });
}

/* ---------- Ask AlphaCore ----------
   One box in front of a hundred and forty departments. It adds no
   intelligence: the routing is regex over what you typed, decided server-side
   and shown back to you, and the only thing that happens without asking is a
   search that costs nothing. Everything that spends money arrives as a button
   with the price written on it. */
export async function renderAsk() {
  const rules = await api('/api/ask').catch(() => null);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">${esc(t('Ask AlphaCore'))}</div>
    <div class="map-legend">${esc(t('Say what you need. The records are searched straight away and cost nothing; anything that spends money or opens work comes back as a button, not as a surprise.'))}</div>
    <form id="ask-form" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <input id="ask-q" class="in" style="flex:1;min-width:240px" autocomplete="off"
        placeholder="${esc(t('e.g. who are the top logistics companies in Baghdad'))}" aria-label="${esc(t('Ask AlphaCore'))}">
      <button class="btn btn-primary" type="submit">${esc(t('Ask'))}</button>
    </form>
  </div>
  <div id="ask-out"></div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('How it decides'))}</div>
    <div class="map-legend">${esc(t(rules?.note || ''))}</div>
    ${rules ? `<table class="tbl" style="margin-top:10px"><thead><tr><th>${esc(t('Rule'))}</th><th>${esc(t('Goes to'))}</th><th>${esc(t('Why'))}</th></tr></thead><tbody>
      ${rules.rules.map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.target)}</td><td class="sub">${esc(t(r.why))}</td></tr>`).join('')}
    </tbody></table>` : ''}
  </div>`;

  $('#ask-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#ask-q').value.trim();
    if (!q) return;
    const out = $('#ask-out');
    out.innerHTML = `<div class="panel" style="margin-top:16px"><div class="empty">${esc(t('Looking…'))}</div></div>`;
    try {
      const r = await api('/api/ask', { method: 'POST', body: { q } });
      out.innerHTML = renderAskAnswer(r);
      $('#ask-do')?.addEventListener('click', () => runAskNext(r.next));
    } catch (err) {
      out.innerHTML = `<div class="panel" style="margin-top:16px"><div class="empty">${esc(err.message)}</div></div>`;
    }
  });
}
function renderAskAnswer(r) {
  const hits = r.answer.hits || [];
  // An enterprise answer: computed from the record, drawn above the search.
  const core2 = r.core2 ? `
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('From the record'))}</div>
    <div class="big">${esc(t(r.core2.headline))}</div>
    ${(r.core2.rows || []).length ? `<div class="map-legend" style="margin-top:8px">${r.core2.rows.map((x) => `<span class="chip">${esc(x.title)}${x.sub ? ` <span class="sub">${esc(t(x.sub))}</span>` : ''}</span>`).join(' ')}</div>` : ''}
    ${r.core2.note ? `<div class="sub" style="margin-top:8px">${esc(t(r.core2.note))}</div>` : ''}
    <a class="btn btn-sm" style="margin-top:10px" href="${esc(r.core2.href)}">${esc(t('Open the page'))} →</a>
  </div>` : '';
  return `${core2}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Answered by'))}</div>
    <div class="map-legend">
      ${r.departments.length
    ? r.departments.map((d) => `<a class="chip" href="${esc(d.href)}">${esc(sectionName(d.id, d.label))}</a>`).join(' ')
    : esc(t('No department has anything on this yet.'))}
    </div>
    <div class="sub" style="margin-top:8px">${esc(t('Routed by the'))} <code>${esc(r.route.rule)}</code> ${esc(t('rule'))} — ${esc(t(r.route.why))}</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('From the records'))} · ${r.answer.total}</div>
    ${hits.length ? `<table class="tbl"><thead><tr><th>${esc(t('What'))}</th><th>${esc(t('Where'))}</th><th>${esc(t('Matched'))}</th></tr></thead><tbody>
      ${hits.map((h) => `<tr><td>${esc(h.title)}<div class="sub">${esc(String(h.snippet || '').slice(0, 160))}</div></td>
        <td class="sub">${esc(h.where)}</td><td class="sub">${esc(h.matched || h.source)}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">${esc(t('Nothing in the records matched. That is an answer too.'))}</div>`}
    <div class="sub" style="margin-top:8px">${esc(t('Searched'))} ${r.answer.tablesSearched} ${esc(t('tables. This cost nothing.'))}</div>
  </div>
  ${r.next ? `<div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('What happens next, if you say so'))}</div>
    <div class="map-legend">${esc(t(r.next.cost))}</div>
    <button class="btn btn-primary" id="ask-do" type="button" style="margin-top:10px">${esc(t(r.next.what))}</button>
  </div>` : ''}
  <div class="panel" style="margin-top:16px"><div class="map-legend">${esc(t(r.note))}</div></div>`;
}
/** Carry out the proposal, and go where the result lives. */
async function runAskNext(next) {
  if (!next) return;
  const btn = $('#ask-do');
  if (btn) { btn.disabled = true; btn.textContent = t('Working…'); }
  const [, path] = next.endpoint.split(' ');
  try {
    const res = await api(path, { method: 'POST', body: next.body });
    toast(t('Done'));
    if (path === '/api/requests' && res?.id) location.hash = `#/requests/${res.id}`;
    else if (path === '/api/hunt' && res?.id) location.hash = `#/hunt`;
    else if (path === '/api/chat/dm' && res?.id) location.hash = `#/chat`;
  } catch (err) {
    toast(err.message);
    if (btn) { btn.disabled = false; btn.textContent = t(next.what); }
  }
}
export async function renderTrust() {
  const d = await api('/api/trust');
  // A matrix that fails to load must leave the rest of the page standing —
  // this section is evidence about the connectors, not part of the trust page's
  // own claims.
  const cert = await api('/api/connectors/certification').catch(() => null);
  const e = d.evidence;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Open red-team findings', e.openRedTeamFindings ?? '—', 'published as-is', e.openRedTeamFindings ? 'bad' : '')}
    ${tile('Hours since witnessed', e.hoursSinceWitnessed ?? 'never', 'the chain answering to somebody outside', e.hoursSinceWitnessed === null || e.hoursSinceWitnessed > 48 ? 'bad' : '')}
    ${tile('Overdue privacy answers', e.overduePrivacyRequests ?? 0, 'people still waiting', e.overduePrivacyRequests ? 'bad' : '')}
    ${tile('Processors with personal data', e.subprocessorsWithPersonalData ?? 0, 'everyone else who touches it')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">A claim that cannot be contradicted by its own system is marketing</div>
    <div class="map-legend">${esc(d.note)}</div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Published</div>
    ${d.documents.length ? `<table class="tbl"><thead><tr><th>Title</th><th>Kind</th><th>State</th><th>Published</th></tr></thead><tbody>
      ${d.documents.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.kind)}</td><td>${esc(x.state)}</td><td>${esc(x.published_at || '—')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing published. The evidence above exists whether or not anybody outside can see it.</div>'}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Subprocessors</div>
    ${d.subprocessors.length ? `<table class="tbl"><thead><tr><th>Name</th><th>For</th><th>Where</th><th>Personal data</th></tr></thead><tbody>
      ${d.subprocessors.map((s) => `<tr><td>${esc(s.name)}</td><td class="sub">${esc(s.purpose)}</td><td>${esc(s.location || '—')}</td>
        <td>${s.personal ? '<span class="pill bad">yes</span>' : 'no'}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">None listed.</div>'}
    ${d.suggested.length ? `<div class="map-legend" style="margin-top:10px">Live connectors and providers that are not on the list:
      ${d.suggested.map((s) => `<b>${esc(s.name)}</b> <span class="sub">(${esc(s.why)})</span>`).join(' · ')}</div>` : ''}
  </div>
  ${certificationPanel(cert)}`;
}
let officesReplay = null;   // the walkthrough timer
let officesStage = null;    // { kind: 'room'|'encounter', id } — survives a refresh
export async function renderOffices() {
  const d = await api('/api/sim');
  const c = d.counts;
  const map = await api('/api/map').catch(() => ({ divisions: [] }));
  const divColour = Object.fromEntries((map.divisions || []).map((x) => [x.id, x.color]));
  const colourFor = (p, room) => divColour[String(p.role_group || '').toLowerCase()]
    || divColour[room.division] || 'var(--steel)';

  // --- geometry ------------------------------------------------------------
  // Rows are as tall as their fullest room needs, rather than a fixed height
  // that clipped people's heads in the version this replaces.
  const CW = 92;
  const PITCH_X = 39;
  const PITCH_Y = 42;
  const HEAD = 40;
  const perRowFor = (r) => Math.max(2, Math.floor((r.gw * CW - 30) / PITCH_X));
  const rowsNeededFor = (r) => Math.max(1, Math.ceil(Math.min(r.people.length, 18) / perRowFor(r)));

  const gridRows = [...new Set(d.building.map((r) => r.gy))].sort((a, b) => a - b);
  const rowHeight = {};
  const bubbleBand = {};
  for (const gy of gridRows) {
    const inRow = d.building.filter((r) => r.gy === gy);
    const tallest = Math.max(...inRow.map((r) => (r.people.length ? rowsNeededFor(r) : 0)));
    // A speech bubble needs a band of its own. Reserved for the whole row so
    // rooms beside each other stay aligned, and paid for only when somebody in
    // the row has actually said something.
    bubbleBand[gy] = inRow.some((r) => r.lastLine) ? 52 : 0;
    rowHeight[gy] = HEAD + bubbleBand[gy] + tallest * PITCH_Y + 16;
  }
  const rowTop = {};
  let acc = 0;
  for (const gy of gridRows) { rowTop[gy] = acc; acc += rowHeight[gy] + 8; }
  const W = d.floor.cols * CW;
  const H = acc;

  const roomSvg = (r) => {
    const x = r.gx * CW + 5;
    const y = rowTop[r.gy];
    const w = r.gw * CW - 10;
    const h = rowHeight[r.gy];
    const tint = divColour[r.division] || 'var(--ink-faint)';
    const empty = r.people.length === 0;
    const hot = r.lastEncounter && Number(r.lastEncounter.tension) >= 0.6;
    const perRow = perRowFor(r);

    const shown = r.people.slice(0, perRow * 3);
    const people = shown.map((p, i) => ({
      p,
      px: x + 22 + (i % perRow) * PITCH_X,
      py: y + HEAD + bubbleBand[r.gy] + Math.floor(i / perRow) * PITCH_Y,
    }));
    const speaker = r.lastLine ? people.find((q2) => q2.p.agent_id === r.lastLine.from) : null;

    return `<g class="of-room${empty ? ' is-empty' : ''}${hot ? ' is-hot' : ''}" data-room="${esc(r.id)}" tabindex="0"
              role="button" aria-label="${esc(r.name)} — ${r.people.length} of ${r.capacity} people. ${esc(r.about || '')}">
      <title>${esc(r.about || r.name)}</title>
      <rect class="of-room-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>
      <rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${tint}" opacity="${empty ? 0.35 : 0.9}"/>
      <text x="${x + 13}" y="${y + 20}" font-size="11.5" font-weight="600" fill="var(--ink)">${esc(r.name)}</text>
      <text x="${x + w - 11}" y="${y + 20}" font-size="10" text-anchor="end"
            fill="${r.people.length >= r.capacity ? 'var(--warn)' : 'var(--ink-faint)'}">${r.people.length}/${r.capacity}</text>
      ${empty ? `<text x="${x + w / 2}" y="${y + h / 2 + 6}" font-size="10" text-anchor="middle" fill="var(--ink-ghost)">empty</text>` : ''}
      ${people.map(({ p, px, py }) => figure(p, colourFor(p, r), px, py, speaker && speaker.p.agent_id === p.agent_id)).join('')}
      ${r.people.length > shown.length ? `<text x="${x + w - 11}" y="${y + h - 9}" font-size="9" text-anchor="end" fill="var(--ink-faint)">+${r.people.length - shown.length} more</text>` : ''}
      ${speaker && r.lastLine
    ? bubble(Math.min(Math.max(speaker.px, x + 100), x + w - 100), y + 26, r.lastLine.name || r.lastLine.from, r.lastLine.body, Math.min(190, w - 20))
    : ''}
    </g>`;
  };

  const busiest = [...d.building].filter((r) => r.people.length).sort((a, b) => b.people.length - a.people.length)[0];
  const empties = d.building.filter((r) => !r.people.length).length;

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">
      <span>The building</span>
      <span class="chip ${d.on ? 'chip-ok' : 'chip-dim'}">${d.on ? 'running' : 'stopped'}</span>
    </div>
    <div class="of-controls">
      ${hasPermC('sim.run') ? (d.on
    ? '<button class="btn btn-bad" id="of-stop">Stop it</button>'
    : '<button class="btn btn-primary" id="of-start">Start it</button>')
    + '<button class="btn" id="of-play">Play one encounter now</button>' : ''}
      ${(d.encounters.find((e) => e.lines) || {}).id ? `<button class="btn" id="of-watch" data-enc="${d.encounters.find((e) => e.lines).id}">Watch the last one</button>` : ''}
      <span class="sub">${d.on
    ? 'A room meets every six minutes. Nothing waits for you.'
    : 'Stopped: nobody moves, nothing is spent.'}</span>
    </div>
    ${!c.encounters ? `<div class="of-hint">
      Nobody has met yet. <b>Play one encounter now</b> puts whoever is in a room together and shows you the result in
      about half a minute — you do not have to wait six for the first one.
    </div>` : ''}
  </div>

  <div class="grid grid-4" style="margin-top:16px">
    ${tile('Learned, and kept', c.inMemory, 'in an employee’s memory, recalled into later prompts')}
    ${tile('Encounters', c.encounters, `${c.placed} people · ${c.rooms - empties} rooms in use`)}
    ${tile('Went to HR', c.disputes, 'would not resolve between them', c.disputes ? 'bad' : '')}
    ${tile('Spent', money4(c.spentUsd || 0), 'on the whole building')}
  </div>

  ${d.recent && d.recent.length ? `<div class="panel of-ticker" style="margin-top:16px">
    <div class="panel-title"><span>Just said</span><span class="sub">newest first</span></div>
    ${d.recent.slice(0, 6).map((m) => `<div class="of-tick">
      <span class="of-tick-room">${esc(m.room_name || m.room_id)}</span>
      <span class="of-who">${esc(m.name || m.from_agent)}</span>${esc(m.body)}
    </div>`).join('')}
  </div>` : ''}

  <div class="panel of-floor-wrap" style="margin-top:16px">
    <div class="panel-title"><span>The floor</span></div>
    <div class="of-key" aria-hidden="true">
      <span class="of-k"><svg width="20" height="20" viewBox="-11 -11 22 22"><circle r="8.5" fill="none" stroke="var(--ok)" stroke-width="1.6"/></svg> pleased</span>
      <span class="of-k"><svg width="20" height="20" viewBox="-11 -11 22 22"><circle r="8.5" fill="none" stroke="var(--steel)" stroke-width="1.6"/></svg> curious</span>
      <span class="of-k"><svg width="20" height="20" viewBox="-11 -11 22 22"><circle r="8.5" fill="none" stroke="var(--warn)" stroke-width="1.6"/></svg> tired</span>
      <span class="of-k"><svg width="20" height="20" viewBox="-11 -11 22 22"><circle r="8.5" fill="none" stroke="var(--bad)" stroke-width="1.6"/></svg> tense</span>
      <span class="of-k">no ring = steady</span>
      <span class="of-k">shirt = their division</span>
      <span class="of-k">shadow = energy</span>
      <span class="of-k of-k-do">click a room to read it · hover anyone for their name</span>
    </div>
    <div class="of-scroll">
      <svg class="of-floor" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
           role="img" aria-label="Floor plan: ${c.placed} employees across ${c.rooms} rooms. Busiest is ${esc(busiest ? busiest.name : 'nowhere')}.">
        ${d.building.map(roomSvg).join('')}
      </svg>
    </div>
    <div id="of-stage" class="of-stage" hidden></div>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">What somebody walked away with</div>
    ${d.learnings.length ? `<table class="tbl"><thead><tr><th>Who</th><th>Took away</th><th>From</th><th>Where</th></tr></thead><tbody>
      ${d.learnings.map((l) => `<tr><td>${esc(l.name || l.agent_id)}</td><td>${esc(l.learned)}</td>
        <td class="sub">${esc(l.from_agent || '—')}</td><td class="sub">${esc(l.room_id || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing yet. A learning only counts here once it is in that employee’s memory.</div>'}
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="panel-title">Recent encounters</div>
    ${d.encounters.length ? `<table class="tbl"><thead><tr><th>Room</th><th>Kind</th><th>Said</th><th>Tension</th><th>What came of it</th><th></th></tr></thead><tbody>
      ${d.encounters.map((e) => `<tr class="${e.tension >= 0.6 ? 'row-bad' : ''}">
        <td>${esc(e.room_name || e.room_id)}</td><td>${esc(e.kind)}</td>
        <td>${e.lines || 0}</td>
        <td>${Math.round((e.tension || 0) * 100)}%</td>
        <td class="sub">${e.lines ? esc(e.outcome || '') : '<i>nothing was said — the scene did not come back</i>'}${e.dispute_id ? ' <span class="pill bad">went to HR</span>' : ''}</td>
        <td>${e.lines ? `<button class="btn btn-sm" data-watch="${e.id}">Watch</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nobody has met yet.</div>'}
  </div>`;

  const act = async (path, body = {}) => {
    try { await api(path, { method: 'POST', body }); await renderOffices(); }
    catch (e) { toast(e.message, true); }
  };
  $('#of-start')?.addEventListener('click', () => act('/api/sim/start'));
  $('#of-stop')?.addEventListener('click', () => act('/api/sim/stop'));
  $('#of-play')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'They are talking…';
    try {
      const r = await api('/api/sim/play', { method: 'POST', body: {} });
      await renderOffices();
      if (r?.id) watch(r.id);            // land straight on what just happened
      else toast(r?.skipped || 'nothing came of it');
    } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Play one encounter now'; }
  });

  /**
   * Play a conversation back, a line at a time.
   *
   * `atOnce` is what a refresh uses. Without it the thirty-second poll restored
   * the transcript by starting the replay again from line one, so a page you
   * were reading threw you back to the beginning of the conversation — worse
   * than losing it, because it looked deliberate.
   */
  async function watch(encId, atOnce = false) {
    const stage = $('#of-stage');
    if (officesReplay) { clearTimeout(officesReplay); officesReplay = null; }
    let data;
    try { data = await api(`/api/sim/encounter/${encId}`); } catch (e) { return toast(e.message, true); }
    if (!data?.lines?.length) return toast('nothing was said in that one');
    const same = officesStage?.id === encId;
    officesStage = { kind: 'encounter', id: encId, played: same ? officesStage.played : false, at: same ? officesStage.at : undefined };

    stage.hidden = false;
    stage.innerHTML = `<div class="of-stage-head">
        <b>${esc(data.encounter.room_name || data.encounter.room_id)}</b>
        <span class="sub">${esc(data.encounter.kind)} · tension ${Math.round((data.encounter.tension || 0) * 100)}%</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" id="of-skip">Show it all</button>
        <button class="btn btn-sm" id="of-close-stage">Close</button>
      </div><div class="of-lines" id="of-lines"></div>`;

    const box = $('#of-lines');
    const closeStage = () => {
      if (officesReplay) clearTimeout(officesReplay);
      officesReplay = null; officesStage = null;
      holdPoll('offices-replay', false);
      stage.hidden = true;
    };
    $('#of-close-stage').addEventListener('click', closeStage);
    $('#of-skip').addEventListener('click', () => {
      if (officesReplay) clearTimeout(officesReplay);
      officesReplay = null;
      holdPoll('offices-replay', false);
      while (i < data.lines.length) emit(data.lines[i++]);
      finish();
    });

    let i = 0;
    const emit = (l) => {
      box.insertAdjacentHTML('beforeend',
        `<div class="of-line"><span class="of-who">${esc(l.name || l.from_agent)}</span>${esc(l.body)}</div>`);
      box.scrollTop = box.scrollHeight;
    };
    const finish = () => {
      if (data.learnings.length) {
        box.insertAdjacentHTML('beforeend', `<div class="of-learn">${data.learnings.map((l) =>
          `<b>${esc(l.name || l.agent_id)}</b> walked away with: ${esc(l.learned)}`).join('<br>')}</div>`);
      }
      if (data.encounter.outcome) box.insertAdjacentHTML('beforeend', `<div class="sub" style="margin-top:8px">${esc(data.encounter.outcome)}</div>`);
      box.scrollTop = box.scrollHeight;
      holdPoll('offices-replay', false);
      if (officesStage) officesStage.played = true;
    };

    // Remember where you were reading, so a rebuild for any reason puts you
    // back rather than at one end or the other.
    box.addEventListener('scroll', () => { if (officesStage) officesStage.at = box.scrollTop; });

    // A refresh restores what you were reading whole. Only a deliberate click
    // plays it out, and while it is playing the page holds still.
    if (atOnce || officesStage.played) {
      while (i < data.lines.length) emit(data.lines[i++]);
      finish();
      if (officesStage.at !== undefined) box.scrollTop = officesStage.at;
      return;
    }

    holdPoll('offices-replay', true);
    const step = () => {
      if (i >= data.lines.length) { officesReplay = null; return finish(); }
      const l = data.lines[i++];
      emit(l);
      officesReplay = setTimeout(step, 1300 + Math.min(2000, String(l.body).length * 20));
    };
    step();
    stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function openRoom(id) {
    const r = d.building.find((x) => x.id === id);
    if (!r) return;
    officesStage = { kind: 'room', id };
    let feed = { feed: [] };
    try { feed = await api(`/api/sim/room/${id}`); } catch { /* nothing said in there yet */ }
    const stage = $('#of-stage');
    stage.hidden = false;
    stage.innerHTML = `<div class="of-stage-head">
        <b>${esc(r.name)}</b><span class="sub">${r.people.length}/${r.capacity} · ${esc(r.about || '')}</span>
        <span style="flex:1"></span>
        ${hasPermC('sim.run') && r.people.length >= 2 ? '<button class="btn btn-sm" id="of-here">See what happens here</button>' : ''}
        ${r.lastEncounter ? '<button class="btn btn-sm" id="of-replay">Watch the last one</button>' : ''}
        <button class="btn btn-sm" id="of-close-stage">Close</button>
      </div>
      ${r.people.length ? `<div class="of-roster">${r.people.map((p) => `<span class="of-chip">
        <i style="background:${colourFor(p, r)}"></i>${esc(p.name)}
        <em>${esc((MOOD[p.mood] || MOOD.steady).word)} · ${p.energy}%</em></span>`).join('')}</div>` : ''}
      <div class="of-lines">${feed.feed.length
    ? feed.feed.map((m) => `<div class="of-line"><span class="of-who">${esc(m.name || m.from_agent)}</span>${esc(m.body)}</div>`).join('')
    : '<div class="sub">Nothing has been said in here yet.</div>'}</div>`;
    $('#of-close-stage').addEventListener('click', () => { officesStage = null; stage.hidden = true; });
    $('#of-here')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'They are talking…';
      try {
        const res = await api('/api/sim/play', { method: 'POST', body: { roomId: id } });
        await renderOffices();
        if (res?.id) watch(res.id); else toast(res?.skipped || 'nothing came of it');
      } catch (err) { toast(err.message, true); }
    });
    $('#of-replay')?.addEventListener('click', () => watch(r.lastEncounter.id));
    stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#of-watch')?.addEventListener('click', (e) => watch(e.currentTarget.dataset.enc));
  for (const b of view.querySelectorAll('[data-watch]')) b.addEventListener('click', () => watch(b.dataset.watch));
  for (const g of view.querySelectorAll('.of-room')) {
    g.addEventListener('click', () => openRoom(g.dataset.room));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRoom(g.dataset.room); } });
  }

  // The page refreshes itself every half minute. Without this, a transcript you
  // were reading disappeared mid-sentence — which is the kind of thing that
  // makes somebody stop using a page rather than report a bug.
  if (officesStage) {
    if (officesStage.kind === 'room') openRoom(officesStage.id);
    else watch(officesStage.id, true);   // whole, not replayed from the top
  }
}
// ---------- pages ----------
export async function renderOverview() {
  // Every side-fetch degrades gracefully: a user with a narrow permission set
  // still gets the overview, with dashes where they lack access.
  const safe = (p, d) => api(p).catch(() => d);
  const [s, prov, agentsList, chain, products, incidents, tickets, rituals, notif, artifacts,
    campaigns, customers, people, contracts, vendors, objectives, knowledge,
    archiveItems, tasksList, projectsList, risksList, qualityDash,
    journeysList, relationsOv, workforce, studioOv, dealsOv, autopilotOv,
    blueprintsList, infraOv, finRepOv, mapData] = await Promise.all([
    api('/api/stats'), safe('/api/providers', { providers: [] }), safe('/api/agents', []), api('/api/audit/verify'),
    safe('/api/products', []), safe('/api/incidents', []), safe('/api/tickets', []), safe('/api/rituals', []), api('/api/notifications?unread=1'),
    safe('/api/artifacts', []),
    safe('/api/campaigns', []), safe('/api/customers', { stats: { mrr: 0 }, items: [] }), safe('/api/people', []), safe('/api/contracts', []),
    safe('/api/vendors', []), safe('/api/objectives', []), safe('/api/knowledge', []),
    safe('/api/archive', []), safe('/api/tasks', []), safe('/api/projects', []), safe('/api/risks', []), safe('/api/quality', null),
    safe('/api/journeys', []), safe('/api/relations', null), safe('/api/workforce', []), safe('/api/studio', null),
    safe('/api/deals', null), safe('/api/autopilot', null),
    safe('/api/design', []), safe('/api/infra', null), safe('/api/finreports', null),
    safe('/api/map', null),
  ]);
  const archiveCount = archiveItems.length;
  const extra = {
    artifactsCount: artifacts.length,
    archiveCount,
    campaignsLive: campaigns.filter((c) => c.state === 'live').length,
    mrr: customers.stats.mrr,
    peopleCount: people.length,
    contractsCount: contracts.length,
    vendorsActive: vendors.filter((v) => v.state === 'active').length,
    objectivesActive: objectives.filter((o) => o.state === 'active').length,
    knowledgeCount: knowledge.length,
    openTasks: tasksList.filter((t) => !['done', 'cancelled'].includes(t.state)).length,
    activeProjects: projectsList.filter((p) => p.state === 'active').length,
    openRisks: risksList.filter((r) => r.state === 'open').length,
    evalAvg: qualityDash?.evalAvg ?? null,
    productsTotal: products.length,
    liveProducts: products.filter((p) => p.state === 'live').length,
    openIncidents: incidents.filter((i) => i.state !== 'closed').length,
    openTickets: tickets.filter((t) => !['sent', 'closed'].includes(t.state)).length,
    evalSets: 5,
    unread: notif.unread,
    overdueRituals: rituals.filter((r) => r.overdue).length,
    openJourneys: journeysList.filter((j) => ['running', 'awaiting_human'].includes(j.state)).length,
    partnersActive: relationsOv?.active ?? 0,
    busyAgents: workforce.filter((w) => w.busy > 0).length,
    blueprints: blueprintsList?.length ?? 0,
    infraPlans: infraOv?.overview?.total ?? 0,
    finReports: finRepOv?.overview?.total ?? 0,
    pipelineValue: dealsOv?.openValue ?? 0,
    autopilotActions: autopilotOv?.feed?.length ?? 0,
    postsScheduled: studioOv?.postsByState?.scheduled ?? 0,
    channelsConnected: studioOv?.channels?.filter((c) => c.state === 'connected').length ?? 0,
    followers: studioOv?.followers ?? 0,
    contentReady: (studioOv?.contentByState?.draft_ready ?? 0) + (studioOv?.contentByState?.approved ?? 0),
    designsReady: studioOv?.designsReady ?? 0,
  };
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100);
  const govPct = Math.min(100, (s.spend.governanceUsd / (s.spend.governanceCapUsd || 1)) * 100);
  const queue = s.queue || {};
  const dec = s.decisions || {};

  const maxCost = Math.max(...s.spendSeries.map((d) => d.cost), 0.0001);
  const points = s.spendSeries.map((d, i) => {
    const x = s.spendSeries.length > 1 ? (i / (s.spendSeries.length - 1)) * 100 : 50;
    const y = 92 - (d.cost / maxCost) * 78;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // The map and the numbers are two different questions, so they are two
  // views rather than one long scroll. Both are rendered; the switch decides
  // which one is on screen, which keeps the toggle instant.
  const tab = localStorage.getItem('alphacore-overview-tab') === 'dashboards' ? 'dashboards' : 'map';
  const here = atlasZoom && mapData ? mapData.divisions.find((d) => d.id === atlasZoom) : null;

  view.innerHTML = `
  <div class="panel" style="border-top:none;padding-top:0">
    <div class="panel-title atlas-bar">
      <span class="atlas-switch">
        <button data-ovtab="map" class="${tab === 'map' ? 'on' : ''}">${esc(t('Map'))}</button>
        <button data-ovtab="dashboards" class="${tab === 'dashboards' ? 'on' : ''}">${esc(t('Dashboards'))}</button>
      </span>
      <span class="atlas-aside">
        ${here ? `<button class="btn btn-sm" data-atlasout>← ${esc(t('the whole company'))}</button>` : ''}
        ${mapData ? `<span class="chip ${mapData.audit.orphans.length ? 'chip-bad' : 'chip-ok'}">${mapData.audit.wired}/${mapData.audit.sections} ${esc(t('wired'))}</span>` : ''}
        <a class="chip chip-dim" style="text-decoration:none" href="#/graph">${esc(t('relationship table'))} →</a>
        <a class="chip chip-ember" style="text-decoration:none" href="#/map2">${esc(t('The two galaxies'))} →</a>
      </span>
    </div>
    <div ${tab === 'map' ? '' : 'hidden'}>
      ${mapData ? buildMap(mapData) : buildSystemMap(s, prov, agentsList, chain, extra)}
      <div class="map-legend">${esc(t(here
        ? 'One district, and the departments inside it. Each mark is a department; a filled one holds records, a hollow one is declared and still empty. The arrows walk you round the rim.'
        : 'The whole company as one drawing: a dense core of the orchestrator and the chain, and a tree for every district growing out of it. The AI core grows to the left of the seam and the enterprise core to the right; every dotted arc through the core is a declared tunnel between them. Circles are AI-core departments, squares enterprise ones. Point at a district to bring up its colour and its tunnels; open it to go inside.'))}
        <b>${esc(t('Click'))}</b> ${esc(t('a district to go inside'))} · <b>${esc(t('right-click'))}</b> ${esc(t('for everything it touches and a hop-by-hop'))} <b>${esc(t('Trace flow'))}</b> · <b>${esc(t('drag / wheel'))}</b> ${esc(t('pans and zooms'))}.${mapData?.audit.orphans.length ? ` <b style="color:var(--bad)">${esc(t('Unwired'))}: ${mapData.audit.orphans.map((o) => o.label).join(', ')}</b>` : ''}</div>
      ${flowLegend(mapData?.flow)}
    </div>
  </div>

  <div ${tab === 'dashboards' ? '' : 'hidden'}>
  <div class="grid grid-4">
    <div class="panel tile">
      <div class="panel-title">Month spend</div>
      <div class="big">${esc(money(s.spend.monthUsd))}</div>
      <div class="sub">cap ${esc(money(s.spend.companyCapUsd))} · ${monthPct.toFixed(1)}%</div>
      <div class="meter"><div class="meter-track"><div class="meter-fill ${monthPct > 80 ? 'hot' : ''}" style="width:${monthPct}%"></div></div></div>
    </div>
    <div class="panel tile tile-warn">
      <div class="panel-title">Governance pool · ≤5% rule</div>
      <div class="big">${esc(money(s.spend.governanceUsd))}</div>
      <div class="sub">cap ${esc(money(s.spend.governanceCapUsd))} · ${govPct.toFixed(1)}%</div>
      <div class="meter"><div class="meter-track"><div class="meter-fill ${govPct > 80 ? 'hot' : ''}" style="width:${govPct}%"></div></div></div>
    </div>
    <div class="panel tile tile-steel">
      <div class="panel-title">Today</div>
      <div class="big">${esc(money(s.spend.todayUsd))}</div>
      <div class="sub">${s.spend.todayCalls} model calls</div>
    </div>
    <div class="panel tile ${s.awaitingHuman ? 'tile-warn' : ''}">
      <div class="panel-title">Awaiting human</div>
      <div class="big">${s.awaitingHuman}</div>
      <div class="sub"><a href="#/gate" style="color:var(--warn)">open the gate queue →</a></div>
    </div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Spend · last 14 days</div>
      <svg aria-hidden="true" focusable="false" class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily spend sparkline">
        <polyline points="${points}" fill="none" stroke="var(--ember)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
        <polygon points="0,100 ${points} 100,100" fill="rgba(255,107,44,0.08)"/>
      </svg>
      <div class="meter-label"><span>${esc(s.spendSeries[0]?.d || '')}</span><span>${esc(s.spendSeries.at(-1)?.d || '')}</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">Run queue</div>
      <table><tbody>
        ${['queued', 'leased', 'running', 'awaiting_human', 'done', 'failed', 'escalated', 'cancelled']
          .filter((k) => queue[k]).map((k) => `
          <tr><td><span class="state state-${k}">${k}</span></td><td class="num">${queue[k]}</td></tr>`).join('') || '<tr><td class="empty">No runs yet — enqueue one from the Runs page.</td></tr>'}
      </tbody></table>
      <div class="panel-title" style="margin-top:14px">Decisions</div>
      <div class="agent-meta">
        ${Object.entries(dec).map(([k, n]) => `<span class="chip">${esc(k)} · ${n}</span>`).join('') || '<span class="empty">No decisions registered.</span>'}
      </div>
    </div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Spend by provider</div>
      <table>
        <thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Errors</th><th class="num">Cost</th></tr></thead>
        <tbody>${s.byProvider.map((p) => `
          <tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td>
          <td class="num">${p.errors || 0}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No model calls yet.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title">Spend by agent</div>
      <table>
        <thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Cost</th></tr></thead>
        <tbody>${s.byAgent.map((a) => `
          <tr><td class="mono">${esc(a.agent_id)}</td><td class="num">${a.runs}</td><td class="num">${esc(money4(a.cost))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No runs yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
  </div>`;
  if (mapData) initAtlas(mapData); else initMapInteractivity();
  view.querySelectorAll('[data-ovtab]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('alphacore-overview-tab', b.dataset.ovtab);
    renderOverview();
  }));
  view.querySelector('[data-atlasout]')?.addEventListener('click', () => atlasGoTo(null));
  // Going into a district and walking the rim: the two gestures the map needs
  // beyond what the shared interaction engine already provides.
  view.querySelectorAll('[data-district]').forEach((g) => {
    g.querySelector('.at-hit')?.addEventListener('click', () => atlasGoTo(g.dataset.district));
    g.querySelector('.at-dname')?.addEventListener('click', () => atlasGoTo(g.dataset.district));
    // The tunnels that touch this district come up with it: every crossing
    // that lands here, or leaves from one of its enterprise departments.
    const id = g.dataset.district;
    const mineIds = new Set((mapData?.enterprise?.divisions || []).find((d) => d.id === id)?.departments.map((x) => x.id) || []);
    const tunnelsOf = () => [...(view.querySelector('.atlas-svg')?.querySelectorAll('.at-tunnel') || [])]
      .filter((p) => p.dataset.tunnelTo === id || mineIds.has(p.dataset.tunnelFrom));
    g.addEventListener('mouseenter', () => {
      view.querySelector('.atlas-svg')?.classList.add('focused');
      g.classList.add('lit');
      tunnelsOf().forEach((p) => p.classList.add('lit'));
    });
    g.addEventListener('mouseleave', () => {
      view.querySelector('.atlas-svg')?.classList.remove('focused');
      g.classList.remove('lit');
      tunnelsOf().forEach((p) => p.classList.remove('lit'));
    });
  });
  view.querySelectorAll('[data-step]').forEach((r) => r.addEventListener('click', () => atlasStep(Number(r.dataset.step))));
}
export async function renderDecisionDetail(id) {
  const d = await api(`/api/decisions/${id}`);
  $('#page-title').textContent = d.id;
  const canTribunal = ['open', 'needs_evidence', 'expired'].includes(d.status);
  const canDecide = ['recommended', 'recommended_cond', 'escalated', 'deciding', 'needs_evidence', 'deferred'].includes(d.status);
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Case</div>
      <dl class="kv">
        <dt>Title</dt><dd>${esc(d.title)}</dd>
        <dt>Tier</dt><dd>${esc(d.tier)}</dd>
        <dt>Status</dt><dd><span class="state state-${d.status.startsWith('approved') ? 'done' : d.status === 'rejected' ? 'failed' : 'awaiting_human'}">${esc(d.status)}</span></dd>
        <dt>Owner</dt><dd>${esc(d.owner_human)}</dd>
        <dt>Consensus</dt><dd>${d.consensus_score != null ? Number(d.consensus_score).toFixed(2) : '—'}</dd>
        <dt>Confidence</dt><dd>${d.confidence != null ? Number(d.confidence).toFixed(2) : '—'}</dd>
        <dt>Context</dt><dd>${esc(d.context || '—')}</dd>
      </dl>
      ${d.conditions?.length ? `<div class="panel-title" style="margin-top:12px">Conditions</div><ul style="padding-left:18px">${d.conditions.map((c) => `<li>${esc(typeof c === 'string' ? c : JSON.stringify(c))}</li>`).join('')}</ul>` : ''}
      ${d.dissent?.length ? `<div class="panel-title" style="margin-top:12px">Dissent (preserved verbatim)</div><ul style="padding-left:18px;color:var(--warn)">${d.dissent.map((c) => `<li>${esc(typeof c === 'string' ? c : JSON.stringify(c))}</li>`).join('')}</ul>` : ''}
      ${d.related?.productGates?.length || d.related?.runs?.length ? `
      <div class="panel-title" style="margin-top:12px">Linked across the company</div>
      <div class="agent-meta">
        ${d.related.productGates.map((g) => `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(g.productName)} · G${g.gate} ${esc(g.gateTitle)}</a>`).join('')}
        ${d.related.runs.map((r) => `<a class="chip ${r.state === 'done' ? 'chip-ok' : 'chip-dim'}" style="text-decoration:none" href="#/runs" title="${esc(r.task_type)}">⚙ ${esc(r.agent_id)} · ${esc(r.state)}</a>`).join('')}
      </div>` : ''}
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        ${canTribunal ? '<button class="btn btn-primary" id="trib-go">Run mini-tribunal</button>' : ''}
        ${canDecide ? `<button class="btn btn-ok" id="dec-approve">Human: approve</button>
        <button class="btn btn-bad" id="dec-reject">Human: reject</button>` : ''}
      </div>
      ${canTribunal ? '<div style="margin-top:10px"><label class="fl" for="trib-proposal">Proposal for the tribunal</label><textarea id="trib-proposal" placeholder="The option under consideration…"></textarea></div>' : ''}
    </div>
    <div class="panel">
      <div class="panel-title">Evidence — the Tribunal cites verified entries only</div>
      ${d.evidence.map((e) => `
        <div class="round"><div class="round-body">
          <div class="agent-head">
            <span>${esc(e.claim)}</span>
            ${e.verification === 'verified' ? '<span class="chip chip-ok">verified</span>'
              : e.verification === 'expired' ? '<span class="chip chip-bad">expired</span>'
              : `<button class="btn btn-sm" data-verify="${e.id}">Verify (human)</button>`}
          </div>
          <div class="mono" style="color:var(--ink-faint);font-size:11px">${esc(e.source_ref)} · added by ${esc(e.added_by)}</div>
        </div></div>`).join('') || '<div class="empty">No evidence registered.</div>'}
      <div class="form-inline" style="margin-top:10px">
        <div style="flex:2"><label class="fl" for="ev-claim">Claim</label><input type="text" id="ev-claim"></div>
        <div><label class="fl" for="ev-src">Source ref</label><input type="text" id="ev-src"></div>
        <button class="btn" id="ev-add">Add</button>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Tribunal rounds ${d.outcome?.totalCostUsd != null ? `· case cost ${esc(money4(d.outcome.totalCostUsd))}` : ''}</div>
    ${d.rounds.map((r) => `
      <div class="round round-${esc(r.role)}">
        <div class="round-badge">${r.round}</div>
        <div class="round-body">
          <div class="round-label">${esc(r.label)} · ${esc(money4(r.cost_usd))}</div>
          <pre class="json">${esc(JSON.stringify(r.output, null, 2))}</pre>
        </div>
      </div>`).join('') || '<div class="empty">No tribunal has run on this case.</div>'}
  </div>`;

  $('#trib-go')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Deliberating…';
    try {
      await api(`/api/decisions/${id}/tribunal`, { method: 'POST', body: { proposal: $('#trib-proposal').value || d.title } });
      toast('Tribunal closed — review the recommendation'); renderDecisionDetail(id);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Run mini-tribunal'; }
  });
  $('#dec-approve')?.addEventListener('click', async () => {
    try { await api(`/api/decisions/${id}/decide`, { method: 'POST', body: { verdict: 'approved', actor: actor() } }); toast(`Approved by ${actor()}`); renderDecisionDetail(id); } catch (e) { toast(e.message, true); }
  });
  $('#dec-reject')?.addEventListener('click', async () => {
    try { await api(`/api/decisions/${id}/decide`, { method: 'POST', body: { verdict: 'rejected', actor: actor() } }); toast('Rejected'); renderDecisionDetail(id); } catch (e) { toast(e.message, true); }
  });
  $('#ev-add')?.addEventListener('click', async () => {
    try { await api(`/api/decisions/${id}/evidence`, { method: 'POST', body: { claim: $('#ev-claim').value, sourceRef: $('#ev-src').value, addedBy: actor() } }); renderDecisionDetail(id); } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/evidence/${b.dataset.verify}/verify`, { method: 'POST', body: { actor: actor() } }); toast('Evidence verified'); renderDecisionDetail(id); } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Graph — the department relationship matrix ----------
export async function renderGraph() {
  const edges = await api('/api/graph');
  const live = edges.filter((e) => e.count > 0);
  const dormant = edges.filter((e) => !e.count);
  const max = Math.max(...live.map((e) => e.count), 1);
  const row = (e) => `
    <a class="graph-row" href="${e.href}">
      <span class="gr-from">${esc(e.from)}</span>
      <span class="gr-arrow">→</span>
      <span class="gr-to">${esc(e.to)}</span>
      <span class="gr-label">${esc(e.label)}</span>
      <span class="gr-bar"><span style="width:${Math.max(4, (e.count / max) * 100)}%"></span></span>
      <span class="gr-count">${e.count}</span>
    </a>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Live connections</div><div class="big">${live.reduce((a, e) => a + e.count, 0)}</div><div class="sub">actual records linking departments</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Active channels</div><div class="big">${live.length}<span class="unit">/${edges.length}</span></div><div class="sub">department-to-department paths in use</div></div>
    <div class="panel tile"><div class="panel-title">Strongest link</div><div class="big" style="font-size:18px;line-height:1.4">${live.length ? esc(`${live.sort((a, b) => b.count - a.count)[0].from} → ${live[0].to}`) : '—'}</div><div class="sub">${live.length ? live[0].count + ' records' : 'no links yet'}</div></div>
    <div class="panel tile ${dormant.length ? 'tile-warn' : ''}"><div class="panel-title">Dormant paths</div><div class="big">${dormant.length}</div><div class="sub">wired, waiting for their first record</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">How work actually crosses the company — every row is a real join in the database</div>
    ${live.sort((a, b) => b.count - a.count).map(row).join('')}
  </div>
  ${dormant.length ? `<div class="panel">
    <div class="panel-title">Wired but still empty — these paths exist and will fill as work flows</div>
    ${dormant.map(row).join('')}
  </div>` : ''}
  <div class="panel">
    <div class="map-legend">
      This page reads the same resolver every entity page uses: open a customer, product, campaign, deal, partner, incident or intel record and you'll see its own 360° panel listing everything attached to it.
      Automatic links are created by <a href="#/autopilot">the Nexus</a>; every one of them is on the <a href="#/audit">audit chain</a>.
    </div>
  </div>`;
}
export async function renderPeople() {
  const people = await api('/api/people');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">The humans — accountability is never delegated; this is the bus-factor view (Part 7 F6)</div>
  </div>
  <div class="grid grid-3">
    ${people.map((p) => `
    <div class="panel agent-card">
      <div class="agent-head"><span class="agent-name">${esc(p.name)}</span><span class="chip ${p.type === 'founder' ? 'chip-ember' : 'chip-dim'}">${esc(p.type)}</span></div>
      <div class="agent-id">${esc(p.role)}</div>
      <div class="agent-meta">
        ${p.actor_id ? `<span class="chip">${esc(p.actor_id)}</span>` : '<span class="chip chip-dim">no system actor</span>'}
        ${p.deputy_id ? `<span class="chip chip-ok">deputy: ${esc(p.deputy_id)}</span>` : ''}
      </div>
      ${p.load ? `
      <dl class="kv" style="grid-template-columns:110px 1fr">
        <dt>Approvals 30d</dt><dd>${p.load.approvals30d}</dd>
        <dt>Actions 30d</dt><dd>${p.load.auditActions30d}</dd>
        <dt>Incidents led</dt><dd>${p.load.incidentsCommanded}</dd>
        <dt>Agents owned</dt><dd><a href="#/agents">${p.load.agentsOwned}</a></dd>
      </dl>` : '<div class="map-legend">fractional — no platform load tracked</div>'}
    </div>`).join('')}
  </div>
  <div class="panel">
    <div class="panel-title">Add a person</div>
    <div class="form-inline">
      <div><label class="fl" for="pe-name">Name</label><input type="text" id="pe-name"></div>
      <div style="flex:1.5"><label class="fl" for="pe-role">Role</label><input type="text" id="pe-role"></div>
      <div><label class="fl" for="pe-type">Type</label><select id="pe-type" aria-label="Type"><option>hire</option><option>fractional</option><option>founder</option></select></div>
      <button class="btn btn-primary" id="pe-go">Add</button>
    </div>
    <div class="map-legend">First hire waits for M7 — positive contribution margin (Part 6 §8). Adding one here is the record, not the trigger.</div>
  </div>`;
  $('#pe-go').addEventListener('click', async () => {
    try { await api('/api/people', { method: 'POST', body: { name: $('#pe-name').value, role: $('#pe-role').value, type: $('#pe-type').value, actor: actor() } }); renderPeople(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderJourneyDetail(id) {
  const j = await api(`/api/journeys/${id}`);
  const canM = hasPermC('journeys.manage');
  $('#page-title').textContent = `Journey — ${j.title}`;
  const stageRow = (s) => {
    const c = DEPT_COLORS[s.dept] || 'var(--steel)';
    const stateChip = {
      done: '<span class="state state-done">done</span>',
      active: '<span class="state state-running">in progress</span>',
      awaiting_human: '<span class="state state-awaiting_human">needs a human</span>',
      pending: '<span class="state state-queued">pending</span>',
      skipped: '<span class="state state-failed">skipped</span>',
    }[s.state];
    return `<div class="jstage ${s.state}">
      <div class="js-rail"><span class="js-dot" style="border-color:${c};${s.state === 'done' ? `background:${c}` : ''}"></span></div>
      <div class="js-body">
        <div class="js-head">
          <span><span class="chip" style="color:${c};border-color:${c}">${esc(s.dept.toUpperCase())}</span> <b>${esc(s.title)}</b></span>
          <span>${s.mode === 'agent' ? `<a class="chip chip-steel" style="text-decoration:none" href="#/workforce">🤖 ${esc(s.agent_id || '')}</a>` : '<span class="chip chip-warn">👤 human sign-off</span>'} ${stateChip}</span>
        </div>
        ${s.summary ? `<div class="js-sum">${esc(short(s.summary, 220))}</div>` : ''}
        ${s.note ? `<div class="reason">${esc(s.note)}</div>` : ''}
        <div class="map-legend">
          ${s.started_at ? `started ${esc(String(s.started_at).slice(0, 16))}` : ''}${s.ended_at ? ` · finished ${esc(s.ended_at.slice(0, 16))}` : ''}
          ${s.run ? ` · run: ${esc(s.run.state)} · ${money4(s.run.cost_usd)}` : ''}
          ${s.run?.state === 'awaiting_human' ? ' · <a href="#/gate" style="color:var(--warn)">resolve at the gate →</a>' : ''}
        </div>
        ${canM && ['active', 'awaiting_human'].includes(s.state) && (s.mode === 'human' || s.state === 'awaiting_human') ? `
          <button class="btn btn-sm btn-ok" data-js-complete>${s.mode === 'human' ? `Sign off as ${esc(currentUser?.username || '')}` : 'Override & advance'}</button>` : ''}
      </div>
    </div>`;
  };
  view.innerHTML = `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(j.title)}</b> ${j.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(j.product_id)}</a>` : ''}</span>
      <span>
        <span class="chip">cost ${money4(j.costUsd)}</span>
        <span class="state state-${j.state === 'done' ? 'done' : j.state === 'awaiting_human' ? 'awaiting_human' : j.state === 'cancelled' ? 'failed' : 'running'}">${esc(j.state)}</span>
        ${canM && !['done', 'cancelled'].includes(j.state) ? '<button class="btn btn-sm btn-bad" id="jn-cancel">Cancel journey</button>' : ''}
      </span>
    </div>
    <div class="jr-track" style="margin:10px 0"><div class="jr-fill" style="width:${Math.round((j.doneCount / j.total) * 100)}%"></div></div>
    <div class="map-legend">${j.doneCount}/${j.total} departments crossed · every stage lands on the <a href="#/audit">audit chain</a> · agent stages spend real budget through the <a href="#/providers">router</a></div>
  </div>
  <div class="panel">${j.stages.map(stageRow).join('')}</div>
  <div class="map-legend" style="margin:8px 4px"><a href="#/journeys">← all journeys</a></div>`;
  $('#jn-cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancel this journey? Remaining stages are skipped.')) return;
    try { await api(`/api/journeys/${id}/cancel`, { method: 'POST', body: {} }); toast('Journey cancelled'); renderJourneyDetail(id); } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-js-complete]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('Sign-off note (optional):') || null;
    try { await api(`/api/journeys/${id}/complete-stage`, { method: 'POST', body: { note } }); toast('Stage advanced — the journey moves on'); renderJourneyDetail(id); }
    catch (e) { toast(e.message, true); }
  }));
}
export async function renderDesignDoc(arg) {
  const [bpId, docKey] = String(arg).split('/');
  const b = await api(`/api/design/${bpId}`);
  const d = b.docs.find((x) => x.doc_key === docKey);
  if (!d) { view.innerHTML = '<div class="panel"><div class="empty">No such document.</div></div>'; return; }
  const canM = hasPermC('design.manage');
  $('#page-title').textContent = `${b.name} — ${d.title}`;
  view.innerHTML = `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(d.title)}</b> <span class="chip chip-dim">${esc(d.agent_id)}</span>
        <span class="state state-${d.state === 'done' ? 'done' : d.state === 'writing' ? 'running' : d.state === 'awaiting_human' ? 'awaiting_human' : 'queued'}">${esc(d.state)}</span></span>
      <span>
        ${d.file_ref ? `<a class="chip chip-dim" style="text-decoration:none" href="#/artifacts/${encodeURIComponent(d.file_ref)}">📁 file</a>` : ''}
        ${canM ? `<button class="btn btn-sm" id="doc-redo">Rewrite</button>
        ${d.content ? '<button class="btn btn-sm btn-ok" id="doc-approve">Approve (with my edits)</button>' : ''}` : ''}
      </span>
    </div>
    <div class="map-legend">${esc(d.brief || '')}${d.needs?.length ? ` · builds on: ${d.needs.join(', ')}` : ''}${d.cost_usd ? ` · ${money4(d.cost_usd)}` : ''}${d.approved_by ? ` · approved by ${esc(d.approved_by)}` : ''}</div>
    ${d.openQuestions?.length ? `<div class="reason">Open questions: ${d.openQuestions.map(esc).join(' · ')}</div>` : ''}
  </div>
  <div class="panel">
    ${d.content
      ? (canM ? `<textarea id="doc-body" style="min-height:64vh;font-family:var(--font-mono);font-size:12px">${esc(d.content)}</textarea>`
        : `<pre class="json" style="max-height:70vh;white-space:pre-wrap">${esc(d.content)}</pre>`)
      : `<div class="empty">${d.state === 'writing' ? 'The agent is writing this document…' : 'Not written yet — it starts once its dependencies are done.'}</div>`}
  </div>
  <div class="map-legend" style="margin:8px 4px"><a href="#/systems">← back to the package</a></div>`;
  $('#doc-redo')?.addEventListener('click', async () => {
    try { await api(`/api/design/docs/${d.id}/redo`, { method: 'POST', body: {} }); toast('Queued for a rewrite'); location.hash = '#/systems'; }
    catch (e) { toast(e.message, true); }
  });
  $('#doc-approve')?.addEventListener('click', async () => {
    try { await api(`/api/design/docs/${d.id}/approve`, { method: 'POST', body: { content: $('#doc-body').value } }); toast('Approved and saved to disk'); renderDesignDoc(arg); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderRequestDetail(id) {
  const r = await api(`/api/requests/${id}`);
  const canC = hasPermC('requests.create');
  $('#page-title').textContent = `Request #${r.id} — ${r.title}`;
  const dur = (s) => {
    if (!s.started_at) return '';
    const end = s.ended_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const mins = Math.max(0, Math.round((new Date(end.replace(' ', 'T') + 'Z') - new Date(s.started_at.replace(' ', 'T') + 'Z')) / 60000));
    return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;
  };
  view.innerHTML = `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(r.title)}</b>
        <span class="state state-${REQ_STATE_CLS[r.state] || 'queued'}">${esc(r.state)}</span></span>
      <span>
        <span class="chip chip-dim">${r.progress.done}/${r.progress.total} · ${money4(r.progress.costUsd)}</span>
        ${r.state === 'done' ? `<button class="btn btn-sm btn-ok" data-download="/api/requests/${r.id}/export" data-filename="request-${r.id}.md">⬇ Deliverable</button>` : ''}
        ${canC && r.state === 'awaiting_human' ? '<button class="btn btn-sm btn-ok" id="rq-sign">Sign off & continue</button>' : ''}
        ${canC && !['done', 'cancelled'].includes(r.state) ? '<button class="btn btn-sm btn-bad" id="rq-cancel">Cancel</button>' : ''}
      </span>
    </div>
    <div style="font-size:12.5px;margin:8px 0;white-space:pre-wrap">${esc(r.body)}</div>
    <div class="map-legend">by ${esc(r.requester)} · ${esc(r.created_at)}${r.plan_summary ? ` · <b>route:</b> ${esc(r.plan_summary)}` : ''}${r.deliverable ? ` · <b>ends with:</b> ${esc(r.deliverable)}` : ''}</div>
    <div class="jr-track" style="margin-top:10px"><div class="jr-fill" style="width:${r.progress.pct}%"></div></div>
  </div>

  <div class="panel">
    ${r.steps.map((s) => `<div class="jstage ${s.state === 'active' ? 'active' : s.state}">
      <div class="js-rail"><span class="js-dot" style="${s.state === 'done' ? 'border-color:var(--ok);background:var(--ok)' : s.state === 'active' ? 'border-color:var(--ember)' : s.state === 'awaiting_human' ? 'border-color:var(--warn)' : ''}"></span></div>
      <div class="js-body">
        <div class="js-head">
          <span><span class="chip chip-steel">${esc(s.dept.toUpperCase())}</span> <b>${esc(s.title)}</b></span>
          <span>
            ${s.agent_id ? `<a class="chip chip-dim" style="text-decoration:none" href="#/workforce">🤖 ${esc(s.agent_id)}</a>` : '<span class="chip chip-warn">👤 human</span>'}
            ${s.spawn_id ? `<a class="chip chip-ember" style="text-decoration:none" href="${linkFor(s.spawn_kind, s.spawn_id) || '#/'}">${esc(s.spawn_kind)} #${esc(s.spawn_id)} →</a>` : ''}
            <span class="state state-${s.state === 'done' ? 'done' : s.state === 'active' ? 'running' : s.state === 'awaiting_human' ? 'awaiting_human' : s.state === 'failed' ? 'failed' : 'queued'}">${esc(s.state)}</span>
          </span>
        </div>
        ${s.brief ? `<div class="map-legend">${esc(s.brief)}</div>` : ''}
        ${s.note ? `<div class="reason">${esc(s.note)}</div>` : ''}
        ${s.output ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">what this department produced (${s.output.length.toLocaleString()} chars)</summary><pre class="json" style="max-height:50vh;white-space:pre-wrap">${esc(s.output)}</pre></details>` : ''}
        <div class="map-legend">${s.started_at ? `started ${esc(s.started_at.slice(5, 16))}` : 'not started'}${s.ended_at ? ` · finished ${esc(s.ended_at.slice(5, 16))}` : ''}${s.started_at ? ` · ${dur(s)}` : ''}${s.cost_usd ? ` · ${money4(s.cost_usd)}` : ''}</div>
      </div>
    </div>`).join('') || '<div class="empty">The intake router is drawing the route…</div>'}
  </div>
  <div id="req-links"></div>
  <div class="map-legend" style="margin:8px 4px"><a href="#/requests">← all requests</a></div>`;
  wireDownloads();
  await renderConnections('#req-links', 'request', r.id);
  $('#rq-sign')?.addEventListener('click', async () => {
    const note = prompt('Note (optional):') || null;
    try { await api(`/api/requests/${id}/signoff`, { method: 'POST', body: { note } }); toast('Signed off — the request moves on'); renderRequestDetail(id); }
    catch (e) { toast(e.message, true); }
  });
  $('#rq-cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancel this request?')) return;
    try { await api(`/api/requests/${id}/cancel`, { method: 'POST', body: {} }); renderRequestDetail(id); } catch (e) { toast(e.message, true); }
  });
}
// ---------- Org & personas ----------
export async function renderOrg() {
  const org = await api('/api/org');
  const canM = hasPermC('org.manage');
  const groups = [...new Set(org.agents.map((a) => a.roleGroup))];
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">AI employees</div><div class="big">${org.agents.length}</div><div class="sub">${org.agents.filter((a) => a.status === 'active').length} active · ${groups.length} groups</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Departments served</div><div class="big">${org.byDepartment.length}</div><div class="sub">some employees serve several</div></div>
    <div class="panel tile"><div class="panel-title">Humans</div><div class="big">${org.humans.length}</div><div class="sub">accountability is never delegated</div></div>
    <div class="panel tile ${org.agents.some((a) => a.disputes) ? 'tile-warn' : ''}"><div class="panel-title">In dispute</div><div class="big">${org.agents.filter((a) => a.disputes).length}</div><div class="sub"><a href="#/disputes">HR arbitrates →</a></div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Who works where</div>
    <div class="agent-meta">${org.byDepartment.map((d) => `<span class="chip chip-dim" title="${esc(d.agents.join(', '))}">${esc(d.dept)} · ${d.agents.length}</span>`).join('')}</div>
    <div class="map-legend">A persona is not decoration — it is appended to that employee's system prompt on every single run, so editing it changes how they actually write and behave. What they are <i>allowed</i> to do stays governed by their role specification and the platform's rules.</div>
  </div>

  ${groups.map((g) => `
  <div class="panel-title" style="margin:16px 0 8px">${esc(g.toUpperCase())}</div>
  <div class="grid grid-2">
    ${org.agents.filter((a) => a.roleGroup === g).map((a) => `
    <div class="panel agent-card">
      <div class="agent-head">
        <span class="agent-name">${esc(a.nickname || a.name)}${a.nickname ? ` <span style="color:var(--ink-faint);font-weight:400">(${esc(a.name)})</span>` : ''}</span>
        <span>
          <span class="chip chip-dim">${esc(a.tier)}</span>
          <span class="chip ${a.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(a.status)}</span>
          ${canM ? `<button class="btn btn-sm" data-org-edit="${esc(a.id)}">Edit</button>` : ''}
        </span>
      </div>
      <div class="agent-id">${esc(a.id)} · owner ${esc(a.humanOwner)} · ${esc(a.failMode || '')}
        ${a.reportsTo ? ` · reports to <b>${esc(a.reportsTo.replace('AGT-', ''))}</b>` : ''}
        ${a.reports?.length ? ` · manages ${a.reports.length}` : ''}</div>
      ${a.persona ? `<div class="persona">
        ${a.persona.tone ? `<div><span class="pk">tone</span> ${esc(a.persona.tone)}</div>` : ''}
        ${a.persona.values ? `<div><span class="pk">values</span> ${esc(a.persona.values)}</div>` : ''}
        ${a.persona.style ? `<div><span class="pk">works by</span> ${esc(a.persona.style)}</div>` : ''}
        ${a.persona.traits?.length ? `<div><span class="pk">traits</span> ${a.persona.traits.map(esc).join(' · ')}</div>` : ''}
        ${a.persona.interests?.length ? `<div><span class="pk">outside work</span> ${a.persona.interests.map(esc).join(' · ')}</div>` : ''}
        ${a.persona.quirk ? `<div><span class="pk">quirk</span> ${esc(a.persona.quirk)}</div>` : ''}
        ${a.persona.custom ? `<div><span class="pk">note</span> ${esc(a.persona.custom)}</div>` : ''}
      </div>` : '<div class="map-legend">no persona set — this employee runs on its role specification alone</div>'}
      ${a.reports?.length ? `<div class="agent-meta">${a.reports.map((r) => `<span class="chip chip-ember">↳ ${esc(r.replace('AGT-', ''))}</span>`).join('')}</div>` : ''}
      <div class="agent-meta">
        ${a.departments.map((d) => `<span class="chip chip-steel">${esc(d)}</span>`).join('') || '<span class="chip chip-dim">unassigned</span>'}
      </div>
      <div class="map-legend">${a.runs7d} run(s) this week · ${a.openTasks} open task(s)${a.disputes ? ` · <a href="#/disputes" style="color:var(--warn)">${a.disputes} dispute(s)</a>` : ''}</div>
    </div>`).join('')}
  </div>`).join('')}`;

  if (!canM) return;
  view.querySelectorAll('[data-org-edit]').forEach((b) => b.addEventListener('click', async () => {
    const a = org.agents.find((x) => x.id === b.dataset.orgEdit);
    const nickname = prompt(`Nickname for ${a.name} (blank keeps "${a.nickname || a.name}"):`, a.nickname || '');
    const tone = prompt('Tone:', a.persona?.tone || '');
    const values = prompt('What they value:', a.persona?.values || '');
    const style = prompt('How they work:', a.persona?.style || '');
    const traits = prompt('Traits (comma separated):', (a.persona?.traits || []).join(', '));
    const interests = prompt('Interests outside work (comma separated):', (a.persona?.interests || []).join(', '));
    const quirk = prompt('A quirk colleagues would notice:', a.persona?.quirk || '');
    const custom = prompt('Anything else that should shape how they write:', a.persona?.custom || '');
    const departments = prompt('Departments (comma separated):', (a.departments || []).join(', '));
    const split = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    try {
      await api(`/api/org/${a.id}`, { method: 'POST', body: {
        nickname: nickname || null,
        persona: { tone, values, style, custom, traits: split(traits), interests: split(interests), quirk },
        departments: departments ? departments.split(',').map((s) => s.trim()).filter(Boolean) : null,
      } });
      toast(`${a.name} updated — it takes effect on their next run`); renderOrg();
    } catch (e) { toast(e.message, true); }
  }));
}
export async function renderSociety() {
  const channel = view.dataset.socChannel || 'all';
  const [ov, msgs, rels] = await Promise.all([
    api('/api/society'),
    api(`/api/society/feed?channel=${encodeURIComponent(channel)}&limit=90`),
    api('/api/society/relations'),
  ]);
  const canM = hasPermC('org.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${ov.enabled ? 'tile-steel' : ''}"><div class="panel-title">Society</div><div class="big" style="font-size:22px;padding-top:8px">${ov.enabled ? 'LIVE' : 'QUIET'}</div><div class="sub">${ov.stats.last24h} message(s) in the last day</div></div>
    <div class="panel tile"><div class="panel-title">Conversations</div><div class="big">${ov.stats.scenes}</div><div class="sub">${ov.stats.messages} messages in total</div></div>
    <div class="panel tile"><div class="panel-title">Working relationships</div><div class="big">${ov.stats.relationships}</div><div class="sub">${ov.stats.colleagues} close · ${ov.stats.friction} with friction</div></div>
    <div class="panel tile"><div class="panel-title">Most talkative</div><div class="big" style="font-size:17px;line-height:1.5;padding-top:6px">${ov.mostSocial.slice(0, 2).map((m) => esc(m.id.replace('AGT-', ''))).join('<br>') || '—'}</div><div class="sub">by messages sent</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>The workplace</span>
      ${canM ? `<span>
        <button class="btn btn-sm ${ov.enabled ? 'btn-bad' : 'btn-ok'}" id="soc-toggle">${ov.enabled ? 'Quieten the room' : 'Bring it to life'}</button>
        ${ov.enabled ? '<button class="btn btn-sm btn-primary" id="soc-spark">Spark a conversation now</button>' : ''}
      </span>` : ''}
    </div>
    <div class="map-legend">
      Colleagues talk when something real happens between them — work is handed over, a review is blocked, an eval goes well, a standup comes round — and sometimes about nothing at all, because a workplace where people only discuss tickets is not a workplace.
      <b>What this honestly is:</b> language models given personas and a shared history. The rapport below is computed from real events and simulated conversation; it models a workplace rather than claiming anyone here feels anything. Conversations run on the cheapest tier, slowly, inside a small separate budget.
    </div>
  </div>

  <div class="panel">
    <div class="chan-bar">
      ${['all', ...ov.channels.map((c) => c.id)].map((c) => {
        const meta = ov.channels.find((x) => x.id === c);
        return `<button class="chan ${channel === c ? 'on' : ''}" data-chan="${esc(c)}">${esc(meta ? meta.label : 'everything')}${meta && meta.messages ? ` <span class="chan-n">${meta.messages}</span>` : ''}</button>`;
      }).join('')}
    </div>
    <div class="chat">
      ${msgs.map((m) => `
        <div class="msg">
          <span class="msg-av" style="background:${GROUP_COLOR[m.fromGroup] || 'var(--steel)'}" title="${esc(m.fromRole)}">${esc(initials(m.fromName))}</span>
          <div class="msg-body">
            <div class="msg-head">
              <b>${esc(m.fromName)}</b>
              <span class="msg-role">${esc(m.fromRole)}</span>
              ${m.toName ? `<span class="msg-to">→ ${esc(m.toName)}</span>` : ''}
              <span class="chip chip-dim">${esc(m.kind)}</span>
              <span class="msg-time">${esc(m.created_at.slice(5, 16))}</span>
            </div>
            <div class="msg-text">${esc(m.body)}</div>
          </div>
        </div>`).join('') || `<div class="empty">${ov.enabled ? 'Nothing said yet — spark a conversation, or wait for something to happen worth talking about.' : 'The room is quiet. Switch the society on to let colleagues talk.'}</div>`}
    </div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Who gets on with whom</div>
      ${ov.closest.length ? ov.closest.map((r) => `
        <div class="rel-row">
          <span class="rel-pair">${esc(r.a_id.replace('AGT-', ''))} <span style="color:var(--ink-faint)">·</span> ${esc(r.b_id.replace('AGT-', ''))}</span>
          <span class="rel-bar"><span style="width:${Math.min(100, ((r.rapport + 2) / 4) * 100)}%"></span></span>
          <span class="rel-label">${esc(r.label)}</span>
          <span class="mono" style="color:var(--ink-faint);font-size:10px">${r.interactions}×</span>
        </div>`).join('') : '<div class="empty">No relationships have formed yet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Where there is friction</div>
      ${ov.tension.length ? ov.tension.map((r) => `
        <div class="rel-row">
          <span class="rel-pair">${esc(r.a_id.replace('AGT-', ''))} <span style="color:var(--bad)">✕</span> ${esc(r.b_id.replace('AGT-', ''))}</span>
          <span class="rel-bar friction"><span style="width:${Math.min(100, (Math.abs(r.rapport) / 2) * 100)}%"></span></span>
          <span class="rel-label">${esc(r.label)}</span>
          <span class="mono" style="color:var(--ink-faint);font-size:10px">${r.interactions}×</span>
        </div>`).join('') : '<div class="empty">Nobody is at odds. Disagreements show up here as they happen — see <a href="#/disputes">disputes</a> for the formal ones.</div>'}
    </div>
  </div>`;

  view.querySelectorAll('[data-chan]').forEach((b) => b.addEventListener('click', () => {
    view.dataset.socChannel = b.dataset.chan;
    renderSociety();
  }));
  if (!canM) return;
  $('#soc-toggle')?.addEventListener('click', async () => {
    try { await api('/api/society/toggle', { method: 'POST', body: { enabled: !ov.enabled } }); toast(ov.enabled ? 'The room went quiet' : 'The society is live — conversations start as things happen'); renderSociety(); }
    catch (e) { toast(e.message, true); }
  });
  $('#soc-spark')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Writing…';
    try { await api('/api/society/scene', { method: 'POST', body: {} }); toast('A conversation just happened'); renderSociety(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Spark a conversation now'; }
  });
}
// ---------- Disputes ----------
export async function renderDisputes() {
  const [ov, org] = await Promise.all([api('/api/disputes'), api('/api/org').catch(() => ({ agents: [] }))]);
  const canRaise = hasPermC('disputes.raise');
  const isOwner = currentUser?.isOwner;
  const opts = [...org.agents.map((a) => a.id), ...(org.humans || []).map((h) => `human:${h.id}`)];
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Disputes</div><div class="big">${ov.total}</div><div class="sub">${ov.ruled} ruled</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">HR arbitrating</div><div class="big">${ov.arbitrating}</div><div class="sub">hearing both sides</div></div>
    <div class="panel tile ${ov.awaitingOwner ? 'tile-warn' : ''}"><div class="panel-title">Awaiting your ruling</div><div class="big">${ov.awaitingOwner}</div><div class="sub">${isOwner ? 'only you can settle these' : 'the owner must settle these'}</div></div>
    <div class="panel tile"><div class="panel-title">The ladder</div><div class="big" style="font-size:15px;line-height:1.6;padding-top:6px">agents argue<br>HR frames<br><b style="color:var(--ember)">the owner rules</b></div><div class="sub"></div></div>
  </div>

  ${canRaise ? `<div class="panel">
    <div class="panel-title">Raise a dispute — both positions must be stated; a dispute with one side is just an opinion</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl" for="dp-title">What is the disagreement about?</label><input type="text" id="dp-title"></div>
      <div><label class="fl" for="dp-a">Party A</label><input type="text" id="dp-a" list="dp-parties" placeholder="AGT-REV-001"></div>
      <div><label class="fl" for="dp-b">Party B</label><input type="text" id="dp-b" list="dp-parties" placeholder="AGT-ENG-001"></div>
      <button class="btn btn-primary" id="dp-go">Send to HR</button>
    </div>
    <datalist id="dp-parties">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
    <div class="form-inline">
      <div style="flex:1"><label class="fl" for="dp-pa">Position A</label><textarea id="dp-pa" style="min-height:70px"></textarea></div>
      <div style="flex:1"><label class="fl" for="dp-pb">Position B</label><textarea id="dp-pb" style="min-height:70px"></textarea></div>
    </div>
  </div>` : ''}

  ${ov.disputes.map((d) => `
  <div class="panel">
    <div class="jr-head">
      <span><b>#${d.id} ${esc(d.title)}</b>
        <span class="state state-${d.state === 'ruled' ? 'done' : d.state === 'recommended' ? 'awaiting_human' : d.state === 'withdrawn' ? 'failed' : 'running'}">${esc(d.state)}</span></span>
      <span class="mono" style="color:var(--ink-faint)">${esc(d.created_at.slice(0, 16))}</span>
    </div>
    <div class="grid grid-2" style="margin-top:8px">
      <div class="panel" style="background:var(--bg-raise)">
        <div class="panel-title">${esc(d.party_a)}</div>
        <div style="font-size:12px;white-space:pre-wrap">${esc(short(d.position_a, 700))}</div>
      </div>
      <div class="panel" style="background:var(--bg-raise)">
        <div class="panel-title">${esc(d.party_b)}</div>
        <div style="font-size:12px;white-space:pre-wrap">${esc(short(d.position_b, 700))}</div>
      </div>
    </div>
    ${d.recommendation ? `<div class="panel" style="border-left:2px solid var(--steel);margin-top:8px">
      <div class="panel-title">HR recommends (not binding)</div>
      <div style="font-size:12.5px">${esc(d.recommendation)}</div>
      ${d.reasoning ? `<div class="map-legend" style="white-space:pre-wrap;margin-top:6px">${esc(d.reasoning)}</div>` : ''}
    </div>` : d.state === 'arbitrating' ? '<div class="empty">HR is hearing both sides…</div>' : ''}
    ${d.ruling ? `<div class="panel" style="border-left:2px solid var(--ember);margin-top:8px">
      <div class="panel-title" style="color:var(--ember)">The owner's ruling — final</div>
      <div style="font-size:12.5px">${esc(d.ruling)}</div>
      <div class="map-legend">ruled by ${esc(d.ruled_by || '')} · ${esc(d.ruled_at || '')}</div>
    </div>` : ''}
    ${isOwner && d.state === 'recommended' ? `<div class="form-inline" style="margin-top:8px">
      <div style="flex:2"><label class="fl">Your ruling (binding)</label><input type="text" data-dp-ruling="${d.id}" placeholder="What is decided, and what happens now"></div>
      <div><label class="fl">Favours</label><select data-dp-fav="${d.id}"><option value="">—</option><option>${esc(d.party_a)}</option><option>${esc(d.party_b)}</option><option value="neither">neither</option></select></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" data-dp-prec="${d.id}"> keep as precedent</label>
      <button class="btn btn-primary" data-dp-rule="${d.id}">Rule</button>
    </div>` : ''}
    ${!isOwner && d.state === 'recommended' ? '<div class="reason">Only the owner can rule on this.</div>' : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No disputes. Either the workforce agrees, or nobody has raised the disagreement yet — blocked reviews are also turned into cases automatically.</div></div>'}`;

  $('#dp-go')?.addEventListener('click', async () => {
    try {
      await api('/api/disputes', { method: 'POST', body: {
        title: $('#dp-title').value, partyA: $('#dp-a').value, positionA: $('#dp-pa').value,
        partyB: $('#dp-b').value, positionB: $('#dp-pb').value,
      } });
      toast('Sent to HR for arbitration'); renderDisputes();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dp-rule]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.dpRule;
    try {
      await api(`/api/disputes/${id}/rule`, { method: 'POST', body: {
        ruling: view.querySelector(`[data-dp-ruling="${id}"]`).value,
        favours: view.querySelector(`[data-dp-fav="${id}"]`).value || null,
        precedent: view.querySelector(`[data-dp-prec="${id}"]`).checked,
      } });
      toast('Ruled — final and on the record'); renderDisputes();
    } catch (e) { toast(e.message, true); }
  }));
}
// ---------- Skill market ----------
export async function renderSkills() {
  const d = await api('/api/skills');
  const canM = hasPermC('skills.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('In use', d.counts.adopted, 'methods the workforce follows', d.counts.adopted ? 'tile-ok' : '')}
    ${tile('Proposed', d.counts.proposed, 'written down, not yet proven')}
    ${tile('Being tested', d.counts.testing, 'scored against the incumbent')}
    ${tile('Rejected', d.counts.rejected, 'did not beat the current way')}
  </div>

  <div class="panel">
    <div class="panel-title">Adopted methods — these go into the next prompt</div>
    <table><thead><tr><th>For</th><th>Method</th><th>Score</th><th>Written by</th><th>Since</th></tr></thead><tbody>
    ${d.adopted.map((s) => `<tr><td class="mono">${esc(s.task_type)}</td><td><b>${esc(s.title)}</b></td>
      <td class="num mono" style="color:var(--ok)">${s.score}</td><td class="mono">${esc(s.proposed_by)}</td>
      <td class="mono sub">${esc(String(s.adopted_at || '').slice(0, 10))}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nothing adopted yet — the workforce is still doing it its own way.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">All proposals</div>
    ${canM ? `<div class="form-inline">${xbtn('/api/skills/invite', {}, 'Ask experienced employees to write down how they work', 'btn-primary')}</div>` : ''}
    <table><thead><tr><th>#</th><th>Title</th><th>For</th><th>v</th><th>State</th><th>Score</th><th>Beat</th><th></th></tr></thead><tbody>
    ${d.skills.map((s) => `<tr><td class="mono">${s.id}</td>
      <td><b>${esc(s.title)}</b><div class="sub">${esc(short(s.body, 90))}</div></td>
      <td class="mono">${esc(s.task_type)}</td><td class="mono">${s.version}</td>
      <td><span class="chip ${s.state === 'adopted' ? 'chip-ok' : s.state === 'rejected' ? 'chip-bad' : s.state === 'testing' ? 'chip-warn' : 'chip-dim'}">${esc(s.state)}</span></td>
      <td class="num mono">${s.score ?? '—'}</td><td class="num mono sub">${s.baseline ?? '—'}</td>
      <td>${canM && ['proposed', 'rejected'].includes(s.state) ? xbtn(`/api/skills/${s.id}/trial`, {}, 'Put it on trial') : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">No proposals yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Model tournaments — which model actually wins which work</div>
    ${canM ? `<div class="form-inline">
      <select id="tn-task" aria-label="Task">${d.taskTypes.map((t) => `<option value="${esc(t.task_type)}">${esc(t.task_type)} (${t.runs} runs)</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="tn-run">Run a tournament</button>
    </div>` : ''}
    ${d.tournaments.map((t) => `
      <div style="margin-top:12px"><b class="mono">${esc(t.task_type)}</b> — winner <span class="chip chip-ok">${esc(t.winner || '—')}</span>
      <table><thead><tr><th>Model</th><th>Calls</th><th>Quality</th><th>Reliability</th><th>Avg cost</th><th>Avg ms</th><th>Value</th></tr></thead><tbody>
      ${(t.results || []).map((r) => `<tr><td class="mono">${esc(r.provider)}/${esc(r.model)}</td><td class="num mono">${r.calls}</td>
        <td class="num mono">${r.quality}</td><td class="num mono">${r.reliability}%</td>
        <td class="num mono">${Number(r.avg_cost || 0).toFixed(5)}</td><td class="num mono">${r.avg_ms || '—'}</td>
        <td class="num mono">${r.value}</td></tr>`).join('')}
      </tbody></table></div>`).join('') || '<div class="empty">No tournament has been run.</div>'}
    <div class="map-legend">Quality comes from the AI auditor's verdicts on work that model actually served — not from a benchmark. Value is quality per dollar, with a floor on cost so a free local model cannot win purely by being free.</div>
  </div>`;
  wireXact(renderSkills);
  $('#tn-run')?.addEventListener('click', async () => {
    try { await api('/api/tournaments', { method: 'POST', body: { taskType: $('#tn-task').value } }); toast('Ran'); renderSkills(); }
    catch (e) { toast(e.message, true); }
  });
}
// ---------- A package's own page ----------
export async function renderPackageSection(id) {
  const p = await api(`/api/packages/${id}`);
  if (!p) { view.innerHTML = '<div class="empty">No such package.</div>'; return; }
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Department', esc(p.manifest.section.label), `installed from ${esc(p.name)} ${esc(p.version)}`)}
    ${tile('Tables', Object.keys(p.rows).length, Object.entries(p.rows).map(([t, n]) => `${t}: ${n ?? '—'}`).join(' · '))}
    ${tile('Employees', (p.manifest.agents || []).length, (p.manifest.agents || []).map((a) => a.id).join(' · '))}
    ${tile('Relationships', (p.manifest.edges || []).length, 'drawn on the map like any other department')}
  </div>
  <div class="panel">
    <div class="panel-title">${esc(p.manifest.section.label)}</div>
    <div class="ms-hint">${esc(p.manifest.section.hint || p.description || '')}</div>
    ${Object.entries(p.rows).map(([t, n]) => `<div class="sub" style="margin-top:10px"><span class="mono">${esc(t)}</span> — ${n ?? '—'} row(s)</div>`).join('')}
    <div class="map-legend">This department was installed from a manifest rather than written into the codebase. It has its own tables, its own employee and its own place on the map — and it can be uninstalled, which retires the employee and keeps the data.</div>
  </div>
  <div class="panel">
    <div class="panel-title">The manifest it came from</div>
    ${preBody(JSON.stringify(p.manifest, null, 1))}
  </div>`;
}


// ===========================================================================
// MARKETING — the district, desk by desk.
//
// Six of these were tables buried inside the marketing desk with no page of
// their own; six are functions a marketing department has that this company
// simply did not. Each answers one question and shows the number it is judged
// on, because a marketing page that shows activity instead of outcome is how
// departments talk themselves into being busy.
// ===========================================================================
export async function renderRecruiting() {
  const data = await api('/api/recruiting');
  const rows = data.candidates || [];
  const gaps = data.gaps || [];
  const canM = hasPermC('recruiting.manage');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><span>Where the company is short-staffed — read from the work, not from opinion</span>
      ${canM ? xbtn('/api/recruiting/auto', {}, 'Hire for the biggest gap', 'btn-primary') : ''}</div>
    ${gaps.length ? gaps.map((g) => `<div class="map-legend">
      <span class="chip chip-warn">${esc(g.dept || g.role)}</span> ${esc(g.why)}</div>`).join('')
    : '<div class="map-legend">No gap in the data — every role is carrying a workable load.</div>'}
    <div class="map-legend" style="margin-top:6px">In unattended mode the company opens these roles by itself, drafts the specification, trials it and hires — capped at 60 employees, one opening at a time.</div>
  </div>
  <div class="panel"><div class="panel-title">Open a role — an agent drafts the spec, a reviewer trials it, you decide</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="rc-role" placeholder="role, e.g. Localization QA" style="width:220px">
      <input id="rc-brief" placeholder="what should this employee do?" style="flex:1;min-width:0">
      <button class="btn btn-sm btn-primary" id="rc-go">Open role</button></div>` : ''}
  </div>
  ${rows.map((c) => `
  <div class="panel">
    <div class="panel-title"><span>#${c.id} ${esc(c.role_name)}
      <span class="chip ${c.state === 'hired' ? 'chip-ok' : c.state === 'rejected' ? 'chip-bad' : 'chip-warn'}">${esc(c.state)}</span>
      ${c.agent_id ? `<span class="chip chip-ember">${esc(c.agent_id)}</span>` : ''}</span>
      <span>
        ${canM && c.state === 'screening' ? xbtn(`/api/recruiting/${c.id}/trial`, {}, 'Send to trial') : ''}
        ${canM && ['screening', 'trial'].includes(c.state) ? xbtn(`/api/recruiting/${c.id}/decide`, { verdict: 'hire' }, 'Hire', 'btn-ok') + xbtn(`/api/recruiting/${c.id}/decide`, { verdict: 'reject' }, 'Reject', 'btn-bad') : ''}
      </span></div>
    ${c.brief ? `<div class="map-legend">${esc(c.brief)}</div>` : ''}
    <div class="grid grid-2">
      <div><b style="font-size:12px">Drafted spec</b>${preBody(c.spec || '⏳ drafting…')}</div>
      <div><b style="font-size:12px">Trial review</b>${preBody(c.trial_note || (c.state === 'trial' ? '⏳ reviewer working…' : '—'))}</div>
    </div>
  </div>`).join('') || '<div class="panel"><div class="empty">No candidates yet — the company grows its own workforce here.</div></div>'}`;
  wireXact(renderRecruiting);
  $('#rc-go')?.addEventListener('click', async () => {
    try { await api('/api/recruiting', { method: 'POST', body: { roleName: $('#rc-role').value, brief: $('#rc-brief').value } }); toast('Role opened — spec drafting'); renderRecruiting(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderAcademy() {
  const [d, agents] = await Promise.all([api('/api/academy'), api('/api/agents').catch(() => [])]);
  const canM = hasPermC('academy.manage');
  view.innerHTML = `
  ${d.suggestions.length ? `<div class="panel"><div class="panel-title">Suggested training — from real eval gaps</div>
    ${d.suggestions.map((s) => `<div class="form-inline" style="justify-content:space-between">
      <span class="mono">${esc(s.agentId)} <span style="color:var(--ink-faint)">· ${esc(s.reason)}</span></span>
      ${canM ? xbtn('/api/academy', { agentId: s.agentId, title: `Close eval gap — ${s.agentId}`, source: 'eval-fail' }, 'Create curriculum', 'btn-primary') : ''}
    </div>`).join('')}</div>` : ''}
  <div class="panel"><div class="panel-title">New curriculum</div>
    ${canM ? `<div class="form-inline">
      <select id="ac-agent" aria-label="Agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
      <input id="ac-title" placeholder="curriculum title" style="width:280px">
      <button class="btn btn-sm btn-primary" id="ac-go">Create</button></div>` : '<div class="map-legend">academy.manage required.</div>'}
  </div>
  <div class="panel"><div class="panel-title">Curricula — scores measured before and after</div>
    <table><thead><tr><th>#</th><th>Agent</th><th>Title</th><th>Source</th><th>State</th><th class="num">Before</th><th class="num">After</th><th></th></tr></thead><tbody>
    ${d.curricula.map((c) => `<tr>
      <td class="mono">${c.id}</td><td class="mono">${esc(c.agent_id)}</td><td>${esc(c.title)}</td><td class="mono">${esc(c.source)}</td>
      <td><span class="chip ${c.state === 'done' ? 'chip-ok' : c.state === 'active' ? 'chip-warn' : 'chip-dim'}">${esc(c.state)}</span></td>
      <td class="num mono">${c.score_before?.toFixed?.(2) ?? '—'}</td><td class="num mono">${c.score_after?.toFixed?.(2) ?? '—'}</td>
      <td>${canM && c.state === 'proposed' ? xbtn(`/api/academy/${c.id}/state`, { state: 'active' }, 'Start') : ''}
          ${canM && c.state === 'active' ? xbtn(`/api/academy/${c.id}/state`, { state: 'done' }, 'Complete', 'btn-ok') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No curricula yet.</td></tr>'}
    </tbody></table></div>`;
  wireXact(renderAcademy);
  $('#ac-go')?.addEventListener('click', async () => {
    try { await api('/api/academy', { method: 'POST', body: { agentId: $('#ac-agent').value, title: $('#ac-title').value } }); toast('Created'); renderAcademy(); }
    catch (e) { toast(e.message, true); }
  });
}
export async function renderWorkstreamDetail(id) {
  const w = await api(`/api/workstreams/${id}`);
  const canM = hasPermC('workstreams.manage');
  const phaseChip = (c) => c.state === 'blocked' ? '<span class="chip chip-bad">blocked</span>'
    : c.state === 'done' ? '<span class="chip chip-ok">complete</span>'
    : `<span class="chip chip-warn">${esc(c.phase)}…</span>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><span>#${w.id} ${esc(w.title)}
      <span class="chip chip-ember">${esc(w.methods[w.method]?.label || w.method)}</span>
      <span class="chip ${w.state === 'done' ? 'chip-ok' : w.state === 'awaiting_human' ? 'chip-warn' : 'chip-dim'}">${esc(w.state)}</span></span>
      <a class="chip chip-dim" style="text-decoration:none" href="#/workstreams">← all workstreams</a></div>
    <div class="map-legend">${esc(w.goal)}</div>
    <div class="form-inline" style="margin-top:8px">
      <span class="chip">route: ${w.route.map(esc).join(' → ')}</span>
      <span class="chip">target ${Math.round(w.quality_target * 100)}%</span>
      <span class="chip">budget ${w.current_cycle}/${w.max_cycles} rounds</span>
      <span class="chip">${w.reviewers} peer reviewer(s)/round</span>
      <span>best score ${scoreChip(w.best_score)}</span>
    </div>
    ${w.note ? `<div class="map-legend" style="color:var(--warn)">${esc(w.note)}</div>` : ''}
    ${canM && w.state !== 'done' ? `<div class="form-inline" style="margin-top:10px;flex-wrap:wrap">
      <input id="wd-note" placeholder="your instruction for the next round — the agents must obey it" style="width:48%">
      <select id="wd-dept" aria-label="Department" style="width:auto"><option value="">same department</option>${w.route.map((r) => `<option value="${esc(r)}">re-run in ${esc(r)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="wd-rerun">Run another round</button>
      <button class="btn btn-sm" id="wd-note-only">Save note only</button>
      ${w.state === 'awaiting_human' ? '<button class="btn btn-sm btn-ok" id="wd-accept">Accept the work</button>' : ''}
      <button class="btn btn-sm btn-bad" id="wd-cancel">Cancel</button>
    </div>` : ''}
  </div>
  ${w.notes.length ? `<div class="panel"><div class="panel-title">Human instructions</div>
    ${w.notes.map((n) => `<div class="map-legend">${n.applied ? '✓ folded in' : '⏳ next round'} · <b>${esc(n.author)}</b>: ${esc(n.body)}</div>`).join('')}</div>` : ''}
  ${w.cycles.slice().reverse().map((c) => `
  <div class="panel">
    <div class="panel-title"><span>Round ${c.seq} · ${esc(c.dept)} ${phaseChip(c)}${c.gated ? ' <span class="chip chip-warn" title="A run in this round is fail-closed and waits in the approvals inbox. Its text was used inside the cycle only; nothing is published without your acceptance.">at the gate</span>' : ''}</span>
      <span>${c.audit_score != null ? `auditor ${scoreChip(c.audit_score)} <span class="chip ${c.audit_verdict === 'pass' ? 'chip-ok' : c.audit_verdict === 'fail' ? 'chip-bad' : 'chip-warn'}">${esc(c.audit_verdict || '')}</span>` : ''}</span></div>
    ${preBody(c.output || '⏳ producing…')}
    ${c.reviews?.length ? `<div class="ws-reviews">
      ${c.reviews.map((r) => `<div class="ws-rev">
        <div><b class="mono">${esc(r.reviewer)}</b> ${scoreChip(r.score)} <span class="chip chip-dim">${esc(r.verdict)}</span></div>
        ${(r.findings || []).map((f) => `<div class="map-legend">— ${esc(f)}</div>`).join('')}
      </div>`).join('')}</div>` : ''}
    ${c.auditFindings?.length ? `<div class="ws-audit"><b style="font-size:11px;color:var(--bad)">AUDITOR FINDINGS</b>
      ${c.auditFindings.map((f) => `<div class="map-legend">— ${esc(f)}</div>`).join('')}</div>` : ''}
  </div>`).join('')}`;
  const post = async (path, body) => { await api(path, { method: 'POST', body }); renderWorkstreamDetail(id); };
  $('#wd-rerun')?.addEventListener('click', async () => {
    try { await post(`/api/workstreams/${id}/rerun`, { note: $('#wd-note').value || null, dept: $('#wd-dept').value || null }); toast('Another round started'); }
    catch (e) { toast(e.message, true); }
  });
  $('#wd-note-only')?.addEventListener('click', async () => {
    try { await post(`/api/workstreams/${id}/note`, { body: $('#wd-note').value }); toast('Saved — the next round will obey it'); }
    catch (e) { toast(e.message, true); }
  });
  $('#wd-accept')?.addEventListener('click', async () => {
    try { await post(`/api/workstreams/${id}/close`, { verdict: 'accepted' }); toast('Accepted'); }
    catch (e) { toast(e.message, true); }
  });
  $('#wd-cancel')?.addEventListener('click', async () => {
    try { await post(`/api/workstreams/${id}/close`, { verdict: 'cancelled' }); toast('Cancelled'); }
    catch (e) { toast(e.message, true); }
  });
}
// ---------- Agent memory ----------
let memSel = null;
export async function renderMemory() {
  const d = await api('/api/memory');
  const canM = hasPermC('memory.manage');
  const sel = memSel || d.agents.find((a) => a.episodes > 0)?.id || d.agents[0]?.id;
  memSel = sel;
  const agent = sel ? await api(`/api/memory/agent/${sel}`) : null;
  const wm = d.impact.withMemory, wo = d.impact.withoutMemory;
  const kindChip = (k) => `<span class="chip ${k === 'lesson' ? 'chip-ember' : k === 'playbook' ? 'chip-ok' : 'chip-dim'}">${esc(k)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Memory documents', d.stats.documents, d.stats.byKind.map((k) => `${k.n} ${k.kind}`).join(' · '))}
    ${tile('Index terms', d.stats.terms, 'BM25 retrieval, Arabic + English, offline')}
    ${tile('Recalls into work', d.stats.recalls, 'times memory was injected into a run')}
    ${tile('Verified lessons', d.stats.verifiedLessons, 'promoted to company truth by a human', d.stats.verifiedLessons ? 'tile-steel' : '')}
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Does memory help? — audited quality, with and without recall</div>
      <table><tbody>
        <tr><td>Runs that used memory</td><td class="num mono">${wm.n || 0}</td><td class="num">${wm.q == null ? '—' : `<b style="color:var(--ok)">${Math.round(wm.q * 100)}%</b>`}</td></tr>
        <tr><td>Runs without memory</td><td class="num mono">${wo.n || 0}</td><td class="num">${wo.q == null ? '—' : `${Math.round(wo.q * 100)}%`}</td></tr>
      </tbody></table>
      <div class="map-legend">Scores come from the AI auditor, not from self-assessment. With too few audited runs this is noise — it becomes meaningful as work accumulates.</div>
    </div>
    <div class="panel">
      <div class="panel-title">Try the retrieval — this is exactly what agents get</div>
      <div class="form-inline">
        <input id="mem-q" placeholder="اكتب بالعربية أو English…" style="width:60%">
        <button class="btn btn-sm btn-primary" id="mem-search">Search</button>
      </div>
      <div id="mem-results"></div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">The workforce's memory</div>
    <table><thead><tr><th>Agent</th><th class="num">Episodes</th><th class="num">Lessons</th><th class="num">Verified</th><th class="num">Avg quality</th><th class="num">Playbook</th><th></th></tr></thead><tbody>
    ${d.agents.filter((a) => a.episodes || a.lessons || a.playbookBytes).map((a) => `<tr${a.id === sel ? ' style="background:rgba(255,107,44,0.07)"' : ''}>
      <td class="mono">${esc(a.id)}<div class="map-legend">${esc(a.name)}</div></td>
      <td class="num mono">${a.episodes}</td><td class="num mono">${a.lessons}</td><td class="num mono">${a.verified}</td>
      <td class="num">${a.avgQuality == null ? '—' : scoreChip(a.avgQuality)}</td>
      <td class="num mono">${a.playbookBytes} B</td>
      <td><button class="btn btn-sm" data-mem-sel="${esc(a.id)}">Open</button>
          ${canM && a.episodes >= 2 ? xbtn(`/api/memory/reflect/${a.id}`, {}, 'Reflect', 'btn-primary') : ''}</td>
    </tr>`).join('')}
    </tbody></table>
  </div>
  ${d.pendingLessons.length ? `<div class="panel">
    <div class="panel-title">Candidate lessons — a human decides what becomes company truth</div>
    ${d.pendingLessons.map((l) => `<div class="form-inline" style="justify-content:space-between;border-bottom:1px solid var(--edge);padding:6px 0">
      <span><b class="mono" style="font-size:10px">${esc(l.agent_id || 'company')}</b> — ${esc(l.body)}</span>
      <span>${canM ? xbtn(`/api/memory/${l.id}/verify`, { verdict: 'verified' }, 'Make it canon', 'btn-ok') + xbtn(`/api/memory/${l.id}/forget`, {}, 'Discard', 'btn-bad') : ''}</span>
    </div>`).join('')}
  </div>` : ''}
  ${agent ? `
  <div class="panel" id="mem-detail">
    <div class="panel-title"><span>${esc(agent.agentId)} — playbook <span class="chip chip-dim">workspace/_memory/${esc(agent.agentId)}.md</span></span>
      <span class="chip">${agent.recalls} recalls</span></div>
    <div class="map-legend">This Markdown file is read before every single task this agent performs. Edit it and the change takes effect on the very next run.</div>
    <textarea id="mem-pb" aria-label="Playbook" style="width:100%;height:230px;font-family:var(--font-mono);font-size:11.5px" ${canM ? '' : 'readonly'}>${esc(agent.playbook || '')}</textarea>
    ${canM ? '<button class="btn btn-sm btn-primary" id="mem-save" style="margin-top:8px">Save playbook</button>' : ''}
  </div>
  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Lessons</div>
      ${agent.lessons.map((l) => `<div class="map-legend">${l.verification === 'verified' ? '✓' : '○'} ${esc(l.body)}</div>`).join('') || '<div class="empty">None yet — run Reflect after a few tasks.</div>'}</div>
    <div class="panel"><div class="panel-title">Recent episodes</div>
      ${agent.episodes.slice(0, 8).map((e) => `<div class="ms-row" style="cursor:default">
        <span class="ms-dir">${e.quality == null ? '·' : e.quality >= 0.7 ? '✓' : '✗'}</span>
        <b>${esc(short(e.title, 46))}</b><span class="ms-cnt">${e.quality == null ? '' : Math.round(e.quality * 100) + '%'}</span>
        <div class="ms-lbl">${esc(short(e.body.replace(/\\s+/g, ' '), 150))}</div></div>`).join('') || '<div class="empty">No experience recorded yet.</div>'}</div>
  </div>` : ''}`;
  wireXact(renderMemory);
  // The detail panel sits below a table of thirty-nine rows, so selecting an
  // employee changed something far off screen and looked like a dead button.
  view.querySelectorAll('[data-mem-sel]').forEach((b) => b.addEventListener('click', async () => {
    memSel = b.dataset.memSel;
    await renderMemory();
    const panel = $('#mem-detail');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.classList.add('just-opened');
      setTimeout(() => panel.classList.remove('just-opened'), 1400);
    }
  }));
  $('#mem-save')?.addEventListener('click', async () => {
    try { await api(`/api/memory/playbook/${sel}`, { method: 'POST', body: { body: $('#mem-pb').value } }); toast('Playbook saved — effective on the next run'); }
    catch (e) { toast(e.message, true); }
  });
  const doSearch = async () => {
    const qv = $('#mem-q').value.trim();
    if (!qv) return;
    try {
      const hits = await api(`/api/memory/search?q=${encodeURIComponent(qv)}`);
      $('#mem-results').innerHTML = hits.length ? hits.map((h) => `<div class="ms-row" style="cursor:default">
        <span class="ms-dir">${h.score}</span><b>${kindChip(h.kind)} ${esc(short(h.title || '', 40))}</b>
        <span class="ms-cnt">${h.agent_id ? esc(h.agent_id) : ''}</span>
        <div class="ms-lbl">${esc(short(h.body.replace(/\\s+/g, ' '), 180))}</div></div>`).join('')
        : '<div class="empty">Nothing recalled for that.</div>';
    } catch (e) { toast(e.message, true); }
  };
  $('#mem-search')?.addEventListener('click', doSearch);
  $('#mem-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}
// ---------- Owner console ----------
export async function renderOwner() {
  if (!currentUser?.isOwner) {
    view.innerHTML = '<div class="panel"><div class="empty">This console belongs to the owner of the company.</div></div>';
    return;
  }
  const [box, harmony, disputes, settings, users, stats] = await Promise.all([
    api('/api/inbox'), api('/api/harmony'), api('/api/disputes'), api('/api/settings'), api('/api/users'), api('/api/stats'),
  ]);
  view.innerHTML = `
  <div class="panel" style="border-color:var(--ember)">
    <div class="panel-title" style="color:var(--ember)">You own this company</div>
    <div class="map-legend">
      Signed in as <b>${esc(currentUser.displayName)}</b> — every permission in the platform, plus the two powers that exist only for the owner:
      the <b>final ruling</b> on any dispute, and the <b>kill switches</b> below. Everything you do here is recorded on the audit chain under your name, like everyone else's actions.
    </div>
  </div>

  <div class="grid grid-4">
    <div class="panel tile ${disputes.awaitingOwner ? 'tile-warn' : ''}"><div class="panel-title">Rulings only you can make</div><div class="big">${disputes.awaitingOwner}</div><div class="sub"><a href="#/disputes">open the cases →</a></div></div>
    <div class="panel tile ${box.total ? 'tile-warn' : ''}"><div class="panel-title">Waiting on a human</div><div class="big">${box.total}</div><div class="sub"><a href="#/gate">approvals inbox →</a></div></div>
    <div class="panel tile"><div class="panel-title">Harmony</div><div class="big">${harmony.harmony.score}<span class="unit">%</span></div><div class="sub"><a href="#/harmony">raise it →</a></div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Month spend</div><div class="big">${esc(money(stats.spend.monthUsd))}</div><div class="sub">of ${esc(money(stats.spend.companyCapUsd))} cap</div></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Kill switches — reversible, immediate, audited</div>
      <div class="owner-switch">
        <span><b>Orchestrator</b><span class="os-sub">plans and dispatches work hourly</span></span>
        <button class="btn btn-sm ${harmony.enabled ? 'btn-bad' : 'btn-ok'}" id="ow-maestro">${harmony.enabled ? 'Stop' : 'Start'}</button>
      </div>
      <div class="owner-switch">
        <span><b>Orchestrator mode</b><span class="os-sub">dry-run plans without acting</span></span>
        <button class="btn btn-sm" id="ow-mode">${esc(harmony.mode)}</button>
      </div>
      <div class="owner-switch">
        <span><b>Mock mode</b><span class="os-sub">stop all real model spend instantly</span></span>
        <button class="btn btn-sm ${settings.mockForced ? 'btn-ok' : ''}" id="ow-mock">${settings.mockForced ? 'Currently MOCK — go live' : 'Switch to mock'}</button>
      </div>
      <div class="map-legend">Nothing here deletes anything. Each switch changes what the company is allowed to do next, and can be flipped straight back.</div>
    </div>

    <div class="panel">
      <div class="panel-title">Your company at a glance</div>
      <table><tbody>
        <tr><td>People with access</td><td class="num">${users.length}</td><td><a href="#/users">manage →</a></td></tr>
        <tr><td>AI employees</td><td class="num">${stats.byAgent.length || '—'}</td><td><a href="#/org">personas →</a></td></tr>
        <tr><td>Providers configured</td><td class="num">${settings.providers.filter((p) => p.configured).length}/${settings.providers.length}</td><td><a href="#/settings">keys →</a></td></tr>
        <tr><td>Audit chain</td><td class="num">${stats.inboxTotal !== undefined ? '✓' : '—'}</td><td><a href="#/audit">verify →</a></td></tr>
      </tbody></table>
      <div class="map-legend" style="margin-top:10px">The one thing you cannot do is edit history: the audit chain is append-only and hash-linked, for you as much as for anyone. That is what makes your rulings worth something.</div>
    </div>
  </div>

  ${disputes.awaitingOwner ? `<div class="panel">
    <div class="panel-title">Cases waiting for your ruling</div>
    ${disputes.disputes.filter((d) => d.state === 'recommended').map((d) => `
      <div class="round"><div class="round-body">
        <div class="agent-head"><span><b>#${d.id} ${esc(d.title)}</b> <span class="chip chip-dim">${esc(d.party_a)} vs ${esc(d.party_b)}</span></span>
          <a class="btn btn-sm btn-primary" href="#/disputes">Rule</a></div>
        <div class="map-legend">HR recommends: ${esc(short(d.recommendation, 220))}</div>
      </div></div>`).join('')}
  </div>` : ''}`;

  $('#ow-maestro')?.addEventListener('click', async () => {
    try { await api('/api/harmony/toggle', { method: 'POST', body: { enabled: !harmony.enabled } }); renderOwner(); } catch (e) { toast(e.message, true); }
  });
  $('#ow-mode')?.addEventListener('click', async () => {
    try { await api('/api/harmony/mode', { method: 'POST', body: { mode: harmony.mode === 'live' ? 'dry-run' : 'live' } }); renderOwner(); } catch (e) { toast(e.message, true); }
  });
  $('#ow-mock')?.addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: 'ALPHACORE_MOCK', value: settings.mockForced ? null : 'true' } }); toast(settings.mockForced ? 'Live models re-enabled' : 'Mock mode on — no further model spend'); renderOwner(); }
    catch (e) { toast(e.message, true); }
  });
}
