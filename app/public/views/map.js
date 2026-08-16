// The company as a picture: the atlas, the orbital view, and the interactions
// that move you around them.
//
// Its own module because it is the one page that is mostly geometry. Nothing
// else in the console draws an SVG this size, and nothing here is wanted by
// anything that is not the map.

import { $, esc, money, short, view } from '../core/dom.js';
import { CATALOG, afterRender, currentRoute, navigate } from '../core/shell.js';
import { EDGE_KIND } from '../components/widgets.js';
import { api } from '../services/api.js';
import { routes } from '../router/registry.js';
import { t, sectionName, divisionName } from '/i18n.js';

// ---------- system map ----------
export const mapNode = ({ x, y, w, h, href, title, value, cls = '' }) => `
  <a href="${href}"><g class="map-node ${cls}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    <text class="mt" x="${x + 12}" y="${y + 22}">${title}</text>
    ${value ? `<text class="mv" x="${x + 12}" y="${y + h - 12}">${value}</text>` : ''}
  </g></a>`;
export const mapChip = ({ x, y, w, h, href, title, value, dot = null }) => `
  <a href="${href}"><g class="map-node">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>
    ${dot !== null ? `<circle cx="${x + 12}" cy="${y + h / 2}" r="3.5" fill="${dot ? 'var(--ok)' : 'var(--ink-faint)'}"/>` : ''}
    <text class="mt small" x="${x + (dot !== null ? 22 : 12)}" y="${y + h / 2 + 4}">${title}</text>
    ${value ? `<text class="mv" x="${x + w - 10}" y="${y + h / 2 + 4}" text-anchor="end">${value}</text>` : ''}
  </g></a>`;
export const mapEdge = (d, { label = '', lx = 0, ly = 0, dashed = false, anchor = 'middle' } = {}) => `
  <path class="map-edge${dashed ? ' dashed' : ''}" d="${d}" ${dashed ? '' : 'marker-end="url(#arr)"'}/>
  ${label ? `<text class="me" x="${lx}" y="${ly}" text-anchor="${anchor}">${label}</text>` : ''}`;
// ---------- system map · orbital design ----------
// The alphacore at the center: the audit chain is the core every section
// feeds (dashed spokes). Inner orbit = the execution engine; outer orbit =
// the company around it. Solid arcs = work flowing between sections.
const polar = (deg, rx, ry, cx = 500, cy = 330) => {
  const a = (deg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(a), y: cy - ry * Math.sin(a) };
};
function orbitPill({ deg = 0, ring = 'outer', x = null, y = null, href, title, value, cls = '', w = 158, h = 46 }) {
  if (x === null) {
    const [rx, ry] = ring === 'inner' ? [215, 155] : [400, 262];
    ({ x, y } = polar(deg, rx, ry));
  }
  const html = `
  <a href="${href}"><g class="map-node ${cls}">
    <rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="23"/>
    <text class="mt mid" x="${x.toFixed(1)}" y="${(y - 4).toFixed(1)}">${title}</text>
    <text class="mv mid" x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}">${value}</text>
  </g></a>`;
  return { x, y, html };
}
function coreSpoke(x, y) {
  const dx = 500 - x, dy = 330 - y;
  const len = Math.hypot(dx, dy) || 1;
  const ex = 500 - (dx / len) * 84, ey = 330 - (dy / len) * 84;
  return `<line class="map-edge dashed" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"/>`;
}
// ---------- system map · interactive metro v4 ----------
// Seven colored lines — the whole company on one board, every line ending at
// the AUDIT interchange. INTERACTIVE: hover a station and the rest of the
// board dims while a tooltip explains what lives there; the moving dots are
// work flowing through the company; click any station to travel to it.
export function buildSystemMap(s, prov, agentsList, chain, extra = {}) {
  const queue = s.queue || {};
  const active = (queue.queued || 0) + (queue.leased || 0) + (queue.running || 0);
  const done = queue.done || 0;
  const decTotal = Object.values(s.decisions || {}).reduce((a, b) => a + b, 0);
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100).toFixed(1);
  const online = prov.providers.filter((p) => p.name !== 'mock' && p.available).length;

  const L = [
    { label: 'EXECUTE', color: '#ff6b2c', y: 70, st: [
      ['#/agents', 'AGENTS', `${agentsList.length} roles`, 'The AI workforce roster — specs, tiers, owners, reputation.'],
      ['#/workforce', 'WORKFORCE', `${extra.busyAgents ?? 0} busy`, 'Per-employee board: live workload, tasks, journey stages, spend.'],
      ['#/runs', 'RUN QUEUE', `${active} · ${done} done`, 'Every unit of agent work: queued → running → done, or held at the gate.'],
      ['#/providers', 'ROUTER', s.mockMode ? 'MOCK' : 'LIVE', 'Multi-provider model router — tier chains T1–T4, family separation.'],
      ['#/providers', 'PROVIDERS', `${online}/5 online`, 'Claude API · Claude subscription · OpenAI · DeepSeek · Gemini.'],
      ['#/pipelines', 'PIPELINES', 'FORGE chains', 'Templated multi-agent chains that produce real files on disk.'],
    ] },
    { label: 'FLOW', color: '#b78bff', y: 148, st: [
      ['#/systems', 'SYSTEM DESIGN', `${extra.blueprints ?? 0} packages`, 'Turns one sentence into 22 documents — BRD, SRS, architecture, stack, security, and a build brief an AI coder can execute.'],
      ['#/infra', 'INFRASTRUCTURE', `${extra.infraPlans ?? 0} plans`, 'Sizing, rate limits, CI/CD, observability, DR and cost — derived from stated load, arithmetic shown.'],
      ['#/journeys', 'JOURNEYS', `${extra.openJourneys ?? 0} moving`, 'The value chain: an order crosses ALL 14 departments, start to sign-off.'],
      ['#/products', 'PRODUCTS', `${extra.productsTotal ?? 0} · ${extra.liveProducts ?? 0} live`, 'Ten-gate product lifecycle — applause never passes Gate 2.'],
      ['#/projects', 'PROJECTS', `${extra.activeProjects ?? 0} active`, 'Delivery containers grouping tasks toward a product goal.'],
      ['#/tasks', 'TASKS', `${extra.openTasks ?? 0} open`, 'The task tracker — delegate to an AI employee and it starts instantly.'],
      ['#/artifacts', 'ARTIFACTS', `${extra.artifactsCount ?? 0} files`, 'Real files produced by pipelines and runs, human-applied to disk.'],
      ['#/objectives', 'OBJECTIVES', `${extra.objectivesActive ?? 0} OKRs`, 'Quarterly objectives — every journey starts by aligning here.'],
    ] },
    { label: 'DECIDE', color: '#5ec3c9', y: 226, st: [
      ['#/gate', 'HUMAN GATE', `${s.awaitingHuman} waiting`, 'Runs held for a named human verdict — the founders’ work list.'],
      ['#/budgets', 'POLICY', `${monthPct}% of cap`, 'Reservation-first budgets: the call is refused BEFORE it is made.'],
      ['#/decisions', 'TRIBUNAL', 'critics · judge', 'Blind critics attack in parallel; a judge consolidates; humans decide.'],
      ['#/decisions', 'REGISTRY', `${decTotal} cases`, 'Decision records with evidence, expiry, and reopen triggers.'],
      ['#/risks', 'RISKS', `${extra.openRisks ?? 0} open`, 'Likelihood × impact register, seeded from the blueprint’s Part 7.'],
      ['#/quality', 'QUALITY', extra.evalAvg != null ? `${Math.round(extra.evalAvg * 100)}% evals` : 'reviews', 'Eval averages, canaries, failed runs, manual quality drills.'],
    ] },
    { label: 'CREATIVE', color: '#ff5fa2', y: 304, st: [
      ['#/social', 'SOCIAL MEDIA', `${extra.postsScheduled ?? 0} scheduled`, 'The social desk: AI drafts platform-native posts; a human publishes.'],
      ['#/social', 'CHANNELS', `${extra.channelsConnected ?? 0} · ${extra.followers ?? 0} followers`, 'The account register: X, LinkedIn, Instagram, TikTok, YouTube…'],
      ['#/content', 'CONTENT', `${extra.contentReady ?? 0} ready`, 'Content Studio: articles, scripts, emails — drafted by the Content agent.'],
      ['#/design', 'DESIGN', `${extra.designsReady ?? 0} ready`, 'Design Studio: the Designer agent ships real SVG files for everything.'],
      ['#/marketing', 'MARKETING', `${extra.campaignsLive ?? 0} live`, 'Campaigns with budgets and CAC — copy is AI-drafted, human-approved.'],
    ] },
    { label: 'DATA', color: '#78bf6d', y: 382, st: [
      ['#/intel', 'INTEL', 'collect → CRM', 'Intelligence collection: structured records, Arabic+English, CSV export.'],
      ['#/segments', 'SEGMENTS', 'targeting', 'Slice intel records into targetable groups — manually or by AI.'],
      ['#/data', 'DATASETS', 'clean · extract', 'Data operations: clean, summarize, extract entities.'],
      ['#/archive', 'ARCHIVE', `${extra.archiveCount ?? 0} items`, 'The company repository — frozen snapshots of everything that mattered.'],
      ['#/knowledge', 'KNOWLEDGE', `${extra.knowledgeCount ?? 0} entries`, 'Organizational memory — humans verify before anything becomes truth.'],
      ['#/evals', 'EVALS', 'canaries', 'Golden sets and canaries feeding agent reputation from audited outcomes.'],
    ] },
    { label: 'BUSINESS', color: '#e5533d', y: 460, st: [
      ['#/sales', 'SALES', `$${(extra.pipelineValue ?? 0).toFixed(0)} pipeline`, 'The deals pipeline — AI drafts proposals; a human sends and signs. Won deals auto-become customers.'],
      ['#/customers', 'CUSTOMERS', `$${(extra.mrr ?? 0).toFixed(0)} MRR`, 'CRM: leads → trials → active, with concentration flags.'],
      ['#/relations', 'RELATIONS', `${extra.partnersActive ?? 0} active`, 'RM: partners, investors, government, media — none go quiet unnoticed.'],
      ['#/finance', 'FINANCE', 'MRR · CAC · burn', 'The money view: spend, revenue, vendor burn, exportable reports.'],
      ['#/finreports', 'FIN REPORTS', `${extra.finReports ?? 0} reports`, 'P&L, balance sheet, cash flow, budgets, annual reports — built on the live ledger, not on guesses.'],
      ['#/legal', 'LEGAL', `${extra.contractsCount ?? 0} docs`, 'Contracts and compliance — signing is HUMAN-only, always named.'],
      ['#/vendors', 'VENDORS', `${extra.vendorsActive ?? 0} active`, 'Procurement — renewals surface 14 days early; surprises must be 0.'],
    ] },
    { label: 'OPERATE', color: '#ffb020', y: 538, st: [
      ['#/incidents', 'INCIDENTS', `${extra.openIncidents ?? 0} open`, 'SEV1–4 lifecycle with enforced postmortems — closing needs the lesson.'],
      ['#/support', 'SUPPORT', `${extra.openTickets ?? 0} open`, 'AI drafts replies; a human always sends. Never-AI categories escalate.'],
      ['#/people', 'PEOPLE', `${extra.peopleCount ?? 0} humans`, 'The human layer: founders and fractionals, with bus-factor load view.'],
      ['#/governance', 'IMMUNE', `${extra.unread ?? 0} alerts`, 'The immune system: spend spikes, stale gates, quiet relationships — contained, reversibly.'],
    ] },
    { label: 'GOVERN', color: '#948b7d', y: 616, st: [
      ['#/governance', 'GOVERNANCE', `${extra.unread ?? 0} alerts`, 'Rituals, alerts, and the immune system’s containment actions.'],
      ['#/oversight', 'OVERSIGHT', 'approvals ledger', 'Who approved what — plus frozen budgets and suspended agents.'],
      ['#/autopilot', 'AUTOPILOT', `${extra.autopilotActions ?? 0} actions`, 'The Nexus: cross-department automations — departments create work for each other with no human in the loop.'],
      ['#/scorecard', 'SCORECARD', 'company KPIs', 'One board for the whole organism: revenue, creative output, production, trust.'],
      ['#/users', 'USERS', 'RBAC', 'Fine-grained permissions — one capability per key, grantable alone.'],
      ['#/settings', 'SETTINGS', 'providers', 'Superadmin controls: provider keys, mock mode — DB-backed, instant.'],
    ] },
  ];
  const X0 = 95, DX = 138, TX = 913, TY = 343;

  const paths = L.map((l) => `M 62 ${l.y} H 845 L ${TX - 6} ${TY}`);
  const lines = L.map((l, li) => `<path class="m-line" data-line="${li}" stroke="${l.color}" d="${paths[li]}"/>`).join('');
  const dots = L.map((l, li) => [0, 1].map((k) => `
    <circle class="m-dot" data-line="${li}" r="3" fill="${l.color}">
      <animateMotion dur="${11 + li * 1.3}s" begin="-${k * (5.5 + li * 0.65) + li * 1.7}s" repeatCount="indefinite" path="${paths[li]}"/>
    </circle>`).join('')).join('');
  const labels = L.map((l, li) => `<text class="m-lbl" data-line="${li}" x="54" y="${l.y + 3}" fill="${l.color}">${l.label}</text>`).join('');
  const stations = L.map((l, li) => l.st.map((st, i) => {
    const x = X0 + i * DX;
    return `<a href="${st[0]}" data-station data-line="${li}" data-pos="${li}:${i}" data-color="${l.color}" data-name="${st[1]}" data-val="${esc(st[2])}" data-tip="${esc(st[3] || '')}"><g class="m-station" style="color:${l.color}">
      <circle cx="${x}" cy="${l.y}" r="6.5" stroke="${l.color}"/>
      <text class="m-name" x="${x}" y="${l.y - 14}">${st[1]}</text>
      <text class="m-val" x="${x}" y="${l.y + 22}">${st[2]}</text>
    </g></a>`;
  }).join('')).join('');

  // The lateral mesh — Nexus automations drawn as interchange connectors:
  // work flows BETWEEN lines, not only along them. Hover a station to light
  // up its cross-department links.
  const pos = (l, i) => ({ x: X0 + i * DX, y: L[l].y });
  const CROSS = [
    [[0, 1], [1, 3], 'delegation'],
    [[1, 0], [2, 0], 'gates'],
    [[1, 0], [3, 0], 'announce'],
    [[1, 1], [3, 2], 'launch content'],
    [[3, 4], [5, 3], 'CAC'],
    [[6, 0], [2, 4], 'auto-risk'],
    [[6, 0], [3, 0], 'status draft'],
    [[4, 5], [2, 5], 'eval scores'],
    [[4, 4], [6, 1], 'KB'],
    [[4, 0], [5, 1], 'targeting'],
    [[5, 0], [5, 1], 'deal won'],
    [[5, 5], [1, 3], 'renewal task'],
  ];
  const cross = CROSS.map(([a, b, label]) => {
    const A = pos(a[0], a[1]), B = pos(b[0], b[1]);
    const sameCol = a[1] === b[1];
    const bend = sameCol ? 30 : (A.x < B.x ? 26 : -26);
    const sameRow = a[0] === b[0];
    const mx = sameRow ? (A.x + B.x) / 2 : (A.x + B.x) / 2 + bend;
    const my = sameRow ? A.y - 34 : (A.y + B.y) / 2;
    return `<g class="m-cross" data-a="${a[0]}:${a[1]}" data-b="${b[0]}:${b[1]}">
      <path d="M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}"/>
      <text x="${mx + (sameRow ? 0 : bend > 0 ? 5 : -5)}" y="${my + (sameRow ? -4 : 3)}" text-anchor="${sameRow ? 'middle' : bend > 0 ? 'start' : 'end'}">${label}</text>
    </g>`;
  }).join('');

  return `<svg aria-hidden="true" focusable="false" class="metro" viewBox="0 0 1000 700" role="img" aria-label="Interactive system metro map — lines are departments, connectors are the Nexus automations between them">
  ${lines}${cross}${dots}${labels}${stations}
  <a href="#/audit" data-station data-line="core" data-color="${chain.ok ? '#59b36a' : '#e5533d'}" data-name="AUDIT CHAIN" data-val="${chain.checked} entries · ${chain.ok ? 'intact' : 'BROKEN'}" data-tip="Hash-chained, append-only. Every line ends here because every action in the company ends up on the record."><g class="m-term">
    <circle class="m-term-pulse" cx="${TX}" cy="${TY}" r="34" stroke="${chain.ok ? 'var(--ok)' : 'var(--bad)'}"/>
    <circle cx="${TX}" cy="${TY}" r="34" stroke="${chain.ok ? 'var(--ok)' : 'var(--bad)'}" stroke-width="2.5"/>
    <text class="core-glyph" x="${TX}" y="${TY - 2}" text-anchor="middle">▲</text>
    <text class="m-name" x="${TX}" y="${TY + 16}">AUDIT</text>
    <text class="m-val" x="${TX}" y="${TY + 56}">${chain.checked} entries · ${chain.ok ? 'intact' : 'BROKEN'}</text>
  </g></a>
</svg>`;
}
// Wire hover/dim/tooltip behaviour onto the freshly rendered map.
export function initMapInteractivity() {
  const svg = view.querySelector('svg.metro');
  if (!svg) return;
  const panel = svg.closest('.panel');
  if (!panel) return;
  panel.style.position = 'relative';
  let tip = panel.querySelector('#map-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'map-tip'; tip.hidden = true; panel.appendChild(tip); }
  const dimAll = (line, stationPos = null) => {
    svg.querySelectorAll('[data-line]').forEach((el) => {
      el.classList.toggle('dimmed', line !== null && line !== 'core' && el.dataset.line !== line);
    });
    svg.querySelectorAll('.m-cross').forEach((c) => {
      const touches = stationPos !== null && (c.dataset.a === stationPos || c.dataset.b === stationPos);
      c.classList.toggle('hot', touches);
      c.classList.toggle('dimmed', stationPos !== null && !touches);
    });
  };
  svg.querySelectorAll('a[data-station]').forEach((a) => {
    a.addEventListener('mouseenter', () => {
      dimAll(a.dataset.line, a.dataset.pos || null);
      tip.innerHTML = `<div class="tip-head" style="color:${a.dataset.color}">${a.dataset.name}</div>
        <div class="tip-val">${a.dataset.val}</div>
        <div class="tip-body">${a.dataset.tip}</div>
        <div class="tip-go">click to open →</div>`;
      tip.hidden = false;
    });
    a.addEventListener('mousemove', (e) => {
      const r = panel.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - r.left + 16, panel.clientWidth - 250) + 'px';
      tip.style.top = Math.min(e.clientY - r.top + 16, panel.clientHeight - 120) + 'px';
    });
    a.addEventListener('mouseleave', () => { dimAll(null); tip.hidden = true; });
  });
}
// ---------- system map v7 · the interactive atlas ----------
// v6 drew the right graph but could overflow the screen and answered detail
// only on hover. v7 fits the whole company on one screen — the SVG scales to
// the viewport — and turns the graph into an instrument: drag to pan, wheel
// to zoom, hover to isolate, click a section for its full connection ledger,
// trace a flow end-to-end hop by hop, double-click to open the section.
// Zoom, selection and traces survive the poll re-render.
const atlasState = { vb: null, sel: null, traceFrom: null, divSel: null };
const ATLAS_R = { core: 66, trunk: 182, fork: 268, leaf: 330, rim: 476 };
/** Which district the near view is showing, or null for the whole company. */
export let atlasZoom = localStorage.getItem('alphacore-atlas-zoom') || null;
/**
 * A small, curated glyph set. Every department gets a mark; the mark is chosen
 * by what the department does rather than by which division it sits in, so two
 * writing desks look alike even when they report to different places.
 */
const NODE_GLYPH = {
  write: '<path d="M3 13L13 3l2 2L5 15H3z"/>',
  search: '<circle cx="7.5" cy="7.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l4 4" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  people: '<circle cx="9" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 15c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  money: '<path d="M9 3v12M6.2 6.2c0-1 1.2-1.8 2.8-1.8s2.8.8 2.8 1.8-1.2 1.5-2.8 1.9-2.8.9-2.8 1.9 1.2 1.8 2.8 1.8 2.8-.8 2.8-1.8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  chart: '<path d="M4 14V8M9 14V4M14 14v-4" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  shield: '<path d="M9 3l5 2v4c0 3.2-2.1 5.6-5 6.4C6.1 14.6 4 12.2 4 9V5z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  gate: '<rect x="4" y="4" width="10" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 4v10" stroke="currentColor" stroke-width="1.4"/>',
  build: '<path d="M4 14V7l5-3 5 3v7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 14v-4h4v4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  data: '<ellipse cx="9" cy="5.5" rx="4.6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.4 5.5v7c0 1 2 1.9 4.6 1.9s4.6-.9 4.6-1.9v-7" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  flow: '<path d="M3 9h5M10 9h5" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="1.6"/>',
  clock: '<circle cx="9" cy="9" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 6v3.4l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  bell: '<path d="M9 3.6a3.6 3.6 0 013.6 3.6v3l1 1.8H4.4l1-1.8v-3A3.6 3.6 0 019 3.6z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.6 14a1.5 1.5 0 002.8 0" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  globe: '<circle cx="9" cy="9" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.4 9h11.2M9 3.4c1.6 1.7 2.5 3.5 2.5 5.6S10.6 12.9 9 14.6C7.4 12.9 6.5 11.1 6.5 9S7.4 5.1 9 3.4z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  chat: '<path d="M3.6 5.4h10.8v6.2H9l-3.4 2.6v-2.6H3.6z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  doc: '<path d="M5 3.4h5.4L13 6v8.6H5z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 3.4V6H13" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  spark: '<path d="M9 3l1.5 4.5L15 9l-4.5 1.5L9 15l-1.5-4.5L3 9l4.5-1.5z"/>',
  key: '<circle cx="6" cy="9" r="2.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8.8 9H15M12.5 9v2.4M14.2 9v1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  box: '<rect x="4" y="5" width="10" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 8h10" stroke="currentColor" stroke-width="1.2"/>',
  cart: '<path d="M3.4 4.4h2l1.6 7h6l1.4-5H6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="14" r="1.1"/><circle cx="12.4" cy="14" r="1.1"/>',
  eye: '<path d="M2.6 9S5 5 9 5s6.4 4 6.4 4-2.4 4-6.4 4S2.6 9 2.6 9z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="9" r="1.7"/>',
};
/** Keyword → glyph. First match wins, so order is the priority. */
const GLYPH_RULES = [
  [/chat|floor|comms|society|relations|support/, 'chat'],
  [/intel|search|marketwatch|insight|knowledge|kgraph|graph/, 'search'],
  [/people|org|recruit|workforce|agents|academy|talent|enable/, 'people'],
  [/finance|money|budget|treasury|finops|pricing|revenue|invoice|capital/, 'money'],
  [/scorecard|report|eval|quality|analytic|observe|metric|insights/, 'chart'],
  [/security|compliance|trust|redteam|provenance|sustain|legal|risk/, 'shield'],
  [/gate|approval|oversight|decision|pmo|governance|constitution/, 'gate'],
  [/system|infra|product|lab|release|project|sprint|build|package|journey/, 'build'],
  [/data|dataset|archive|segment|memory|backup/, 'data'],
  [/run|pipeline|workstream|task|queue|job|autopilot|harmony|nexus/, 'flow'],
  [/time|period|chief|ritual|capacity/, 'clock'],
  [/incident|alert|dispute|problem/, 'bell'],
  [/connector|web|mcp|egress|tenant|webhook|localization/, 'globe'],
  [/content|doc|brand|design|social|marketing|mkt|campaign|artifact|blueprint/, 'doc'],
  [/vault|key|user|setting|auth/, 'key'],
  [/asset|vendor|procure|inventory/, 'box'],
  [/sale|deal|customer|success|commerce/, 'cart'],
  [/audit|watch|monitor|trace/, 'eye'],
  [/skill|simulation|experiment|idea/, 'spark'],
];
const glyphFor = (id) => {
  const s = String(id).toLowerCase();
  for (const [re, g] of GLYPH_RULES) if (re.test(s)) return g;
  return 'flow';
};
/**
 * A district's tree. Departments are dealt into branches of at most four, each
 * branch given a slice of the district's angle, and leaves placed at three
 * depths so a crowded district reads as depth rather than as a picket fence.
 */
function districtTree(items, angle, slice) {
  const branches = [];
  const perBranch = 4;
  const count = Math.max(1, Math.ceil(items.length / perBranch));
  for (let b = 0; b < count; b++) {
    const mine = items.slice(b * perBranch, (b + 1) * perBranch);
    if (!mine.length) continue;
    // Branches fan out inside the slice; a single branch sits on the centreline.
    const spread = slice * 0.72;
    const at = count === 1 ? angle : angle - spread / 2 + (spread * b) / (count - 1);
    const leaves = mine.map((item, i) => {
      const depth = i % 3;
      const r = ATLAS_R.leaf + depth * 44;
      const wobble = (((i % 2) ? 1 : -1) * (0.6 + i * 0.5) * slice) / 22;
      return { item, a: at + wobble, r };
    });
    branches.push({ at, leaves });
  }
  return branches;
}
/** The whole company: districts radiating from the core. */
function buildAtlasFar(map) {
  const { divisions, sections, harmony, audit: connAudit, flow } = map;

  // The enterprise core's departments are lifted out of the AI core's trees.
  // They were never really leaves of those districts — an HR record sat under
  // "talent" because both involve people, which is the confusion the two-galaxy
  // split exists to end. Drawn as their own constellation and joined by the
  // declared tunnels, one screen now shows the whole company *and* the seam.
  const enterprise = new Set((map.core2Divisions || []).flatMap((d) => d.departments));

  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) {
    if (s.id === 'harmony' || enterprise.has(s.id)) continue;
    (byDiv[s.division] || byDiv.govern).items.push(s);
  }
  const divs = divisions.filter((d) => byDiv[d.id].items.length);

  // The one deliberate distortion: everything is stretched sideways, because a
  // circle in a widescreen panel wastes half the page. The core stays round so
  // the eye still reads a centre.
  const XS = 1.46;
  const CX = 940, CY = 640;
  const slice = (Math.PI * 2) / divs.length;
  const px = (a, r) => CX + Math.cos(a) * r * XS;
  const py = (a, r) => CY + Math.sin(a) * r;

  const districts = divs.map((d, i) => {
    // Start at the top and go clockwise, so the first district is where the eye
    // lands rather than where the maths happens to begin.
    const angle = i * slice - Math.PI / 2;
    const items = byDiv[d.id].items;
    const branches = districtTree(items, angle, slice);

    const trunk = { x: px(angle, ATLAS_R.trunk), y: py(angle, ATLAS_R.trunk) };
    // Every district has its own trunk node, joined to the core by a single
    // thin line. Without it the stems all converge on one point and the drawing
    // reads as a starburst rather than as thirteen trees.
    const root = `M ${px(angle, ATLAS_R.core + 6).toFixed(1)} ${py(angle, ATLAS_R.core + 6).toFixed(1)} L ${trunk.x.toFixed(1)} ${trunk.y.toFixed(1)}`;

    const lines = `<path class="at-branch" d="${root}"/>` + branches.map((b) => {
      const fx = px(b.at, ATLAS_R.fork), fy = py(b.at, ATLAS_R.fork);
      const stem = `M ${trunk.x.toFixed(1)} ${trunk.y.toFixed(1)} Q ${((trunk.x + fx) / 2).toFixed(1)} ${((trunk.y + fy) / 2).toFixed(1)} ${fx.toFixed(1)} ${fy.toFixed(1)}`;
      const twigs = b.leaves.map((l) => {
        const lx = px(l.a, l.r), ly = py(l.a, l.r);
        return `<path class="at-branch" d="M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${(fx * 0.35 + lx * 0.65).toFixed(1)} ${(fy * 0.35 + ly * 0.65).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)}"/>`;
      }).join('');
      return `<path class="at-branch" d="${stem}"/>${twigs}`;
    }).join('')
      + `<circle class="at-leaf" cx="${trunk.x.toFixed(1)}" cy="${trunk.y.toFixed(1)}" r="2.6" opacity="0.5"/>`;

    const leaves = branches.flatMap((b) => b.leaves).map((l) => {
      // A department with nothing in it yet is drawn hollow — present, not busy.
      const live = l.item.count > 0;
      const cx = px(l.a, l.r).toFixed(1), cy = py(l.a, l.r).toFixed(1);
      const title = `<title>${esc(sectionName(l.item.id, l.item.label))} · ${live ? l.item.count : t('empty')}</title>`;
      return live
        ? `<circle class="at-leaf" data-dept="${esc(l.item.id)}" cx="${cx}" cy="${cy}" r="3.2">${title}</circle>`
        : `<circle class="at-leaf-ring" data-dept="${esc(l.item.id)}" cx="${cx}" cy="${cy}" r="2.6">${title}</circle>`;
    }).join('');

    const lx = px(angle, ATLAS_R.rim);
    const ly = py(angle, ATLAS_R.rim);
    const sample = items.slice(0, 3).map((x) => sectionName(x.id, x.label).toLowerCase()).join(' · ');

    return `<g class="at-district" data-district="${esc(d.id)}" style="color:${d.color}">
      ${lines}${leaves}
      <text class="at-dname" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${esc(divisionName(d.id, d.label))}</text>
      <text class="at-dsub" x="${lx.toFixed(1)}" y="${(ly + 15).toFixed(1)}">${esc(short(sample, 36))}</text>
      <ellipse class="at-hit" cx="${lx.toFixed(1)}" cy="${(ly - 2).toFixed(1)}" rx="96" ry="34"/>
    </g>`;
  }).join('');

  // The core: a small cloud for the orchestrator and the chain beneath it.
  // Deterministic scatter, so it is the same cloud every time.
  const dots = Array.from({ length: 52 }, (_, i) => {
    const a = i * 2.399963;                        // golden angle
    const r = ATLAS_R.core * 0.66 * Math.sqrt(i / 52);
    return `<circle class="at-core-dot" cx="${(CX + Math.cos(a) * r).toFixed(1)}" cy="${(CY + Math.sin(a) * r).toFixed(1)}" r="${(1.6 - i / 52).toFixed(2)}"/>`;
  }).join('');

  // ---- the enterprise core, and the seam ----------------------------------
  // Placed to the right of the AI core rather than interleaved: the distance is
  // the point. Its own small core, its own districts, and one line per declared
  // tunnel — so the crossings are countable rather than implied.
  const byId2 = Object.fromEntries(sections.map((x) => [x.id, x]));
  const e2 = (map.core2Divisions || []).map((d) => ({
    ...d, items: d.departments.map((id) => byId2[id]).filter(Boolean),
  })).filter((d) => d.items.length);

  // Clear of the AI core's rim, not near it. Its outermost label sits at
  // CX + rim * XS = 1635 and is centred, so anything before ~1760 collides —
  // which it did, and "RECORDS" printed on top of "MARKETING".
  const E_CX = 2010, E_CY = 640;
  const eSpan = 620;
  const ePos = new Map();
  const eDistricts = e2.map((d, i) => {
    const y = E_CY - eSpan / 2 + (eSpan / Math.max(1, e2.length - 1)) * i;
    const rows = d.items.map((it, j) => {
      const ix = E_CX + 62, iy = y + j * 19 - ((d.items.length - 1) * 19) / 2;
      ePos.set(it.id, { x: ix, y: iy });
      return `<circle class="at-leaf" data-dept="${esc(it.id)}" cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="${it.count > 0 ? 3.2 : 2.6}"${it.count > 0 ? '' : ' opacity="0.45"'}>
        <title>${esc(sectionName(it.id, it.label))} · ${it.count > 0 ? it.count : t('empty')}</title></circle>
      <text class="at-dsub" x="${(ix + 9).toFixed(1)}" y="${(iy + 3.4).toFixed(1)}" text-anchor="start">${esc(short(sectionName(it.id, it.label), 22))}</text>`;
    }).join('');
    return `<g class="at-district" data-district="${esc(d.id)}" style="color:${d.color}">
      <path class="at-branch" d="M ${E_CX} ${E_CY} Q ${E_CX + 26} ${((E_CY + y) / 2).toFixed(1)} ${(E_CX + 62).toFixed(1)} ${y.toFixed(1)}"/>
      <text class="at-dname" x="${(E_CX + 52).toFixed(1)}" y="${(y - ((d.items.length - 1) * 19) / 2 - 13).toFixed(1)}" text-anchor="start">${esc(t(d.label))}</text>
      ${rows}
    </g>`;
  }).join('');

  // One line per declared tunnel. Nothing is drawn that is not an edge the
  // connectivity audit already checks — a picture that can show a relationship
  // the data does not have is a picture that will.
  const c1Angle = new Map(divs.map((d, i) => [d.id, i * slice - Math.PI / 2]));
  const tunnels = ((map.core2 || {}).tunnels || []).map((tn) => {
    const a = ePos.get(tn.core2End);
    const ang = c1Angle.get(tn.core1Division);
    if (!a || ang === undefined) return '';
    const bx = px(ang, ATLAS_R.rim * 0.92), by = py(ang, ATLAS_R.rim * 0.92);
    return `<path class="at-tunnel" d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x - 260).toFixed(1)} ${a.y.toFixed(1)}, ${(bx + 240).toFixed(1)} ${by.toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)}">
      <title>${esc(tn.core2End)} ↔ ${esc(tn.core1End)}: ${esc(t(tn.label || ''))}</title></path>`;
  }).join('');

  const hs = harmony?.score ?? 0;
  return `<svg aria-hidden="true" focusable="false" class="atlas-svg" viewBox="150 92 2280 1108" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="The whole company on one map — the AI core, the enterprise core, and the declared tunnels between them">
    ${tunnels}
    ${districts}
    ${eDistricts}
    <g class="at-core">
      <circle class="at-core-ring" cx="${E_CX}" cy="${E_CY}" r="26"/>
      <text class="at-core-label" x="${E_CX}" y="${E_CY + 44}">${esc(t('ENTERPRISE'))}</text>
    </g>
    <g class="at-core">
      <circle class="at-core-ring" cx="${CX}" cy="${CY}" r="${ATLAS_R.core}"/>
      ${dots}
      <text class="at-core-label" x="${CX}" y="${CY + ATLAS_R.core + 18}">${esc(t('HARMONY'))} ${hs}%</text>
    </g>
    <text class="at-foot" x="166" y="1186">${sections.length} ${esc(t('DEPARTMENTS'))} · ${divs.length + e2.length} ${esc(t('DISTRICTS'))} · ${((map.core2 || {}).tunnels || []).length} ${esc(t('TUNNELS'))} · ${connAudit.wired}/${connAudit.sections} ${esc(t('wired'))}${flow ? ` · ${flow.rounds} ${esc(t('ROUNDS RUN'))}` : ''}</text>
  </svg>`;
}
function buildAtlasNear(map, divId) {
  const { divisions, sections, edges } = map;
  const div = divisions.find((d) => d.id === divId) || divisions[0];
  const items = sections.filter((s) => s.division === div.id && s.id !== 'harmony');
  const W = 1600, H = 1020;
  const rootX = W / 2, rootY = H - 118;

  // Clusters of at most four, fanned across almost a half-circle so the tree
  // occupies the page rather than a corner of it. Each node gets its own angular
  // slot inside its cluster, which is what stops two chips landing on top of
  // each other when a district is crowded.
  const per = 4;
  const clusters = [];
  for (let i = 0; i < items.length; i += per) clusters.push(items.slice(i, i + per));
  const n = clusters.length;
  const SPAN = Math.PI * 0.74;                 // wide enough to fan, narrow enough to climb
  const TOP = -Math.PI / 2;

  const placed = clusters.map((group, ci) => {
    const a = n === 1 ? TOP : TOP - SPAN / 2 + (SPAN * ci) / (n - 1);
    const fork = { x: rootX + Math.cos(a) * 350, y: rootY + Math.sin(a) * 330 };
    const inner = Math.min(0.5, SPAN / (n * 2.1));
    const nodes = group.map((sec, i) => {
      const slot = group.length === 1 ? 0 : (i / (group.length - 1) - 0.5) * 2;
      const na = a + slot * inner;
      // Alternating reach gives the cluster depth instead of an arc of beads.
      const reach = 235 + (i % 2 ? 132 : 0) + Math.floor(i / 2) * 60;
      return { sec, x: fork.x + Math.cos(na) * reach, y: fork.y + Math.sin(na) * reach };
    });
    return { a, fork, nodes, group };
  });

  const drawn = placed.map(({ fork, nodes, group }) => {
    const stem = `<path class="at-edge" d="M ${rootX} ${rootY - 26} Q ${(rootX + (fork.x - rootX) * 0.42).toFixed(1)} ${(rootY + (fork.y - rootY) * 0.72).toFixed(1)} ${fork.x.toFixed(1)} ${fork.y.toFixed(1)}"/>`;
    const twigs = nodes.map((nd) => `<path class="at-edge" d="M ${fork.x.toFixed(1)} ${fork.y.toFixed(1)} Q ${((fork.x + nd.x) / 2).toFixed(1)} ${((fork.y + nd.y) / 2 - 14).toFixed(1)} ${nd.x.toFixed(1)} ${nd.y.toFixed(1)}"/>`).join('');

    const chips = nodes.map((nd) => {
      const live = nd.sec.count > 0;
      const label = sectionName(nd.sec.id, nd.sec.label);
      return `<a class="at-node ${live ? '' : 'hollow'}" href="${nd.sec.href}" data-node="${esc(nd.sec.id)}"
        data-color="${div.color}" data-label="${esc(label)}" data-hint="${esc(nd.sec.hint)}"
        data-count="${nd.sec.count}" data-div="${esc(div.id)}">
        ${live
          ? `<circle class="at-chip" cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="17"/>`
          : `<circle class="at-chip-ring" cx="${nd.x.toFixed(1)}" cy="${nd.y.toFixed(1)}" r="17"/>`}
        <g class="at-chip-glyph" style="color:${live ? 'var(--paper)' : 'var(--ink)'};fill:${live ? 'var(--paper)' : 'var(--ink)'}"
           transform="translate(${(nd.x - 9).toFixed(1)}, ${(nd.y - 9).toFixed(1)})">${NODE_GLYPH[glyphFor(nd.sec.id)]}</g>
        <text class="at-nlabel" x="${nd.x.toFixed(1)}" y="${(nd.y + 33).toFixed(1)}">${esc(short(label, 24))}</text>
        <title>${esc(label)} · ${live ? `${nd.sec.count} ${t('records')}` : t('empty')}</title>
      </a>`;
    }).join('');

    // The cluster is named after the work in it, set above the highest node in
    // the reference's manner: small, wide-tracked, and out of the way.
    const top = nodes.reduce((acc, b) => (b.y < acc.y ? b : acc), nodes[0]);
    return `${stem}${twigs}
      <text class="at-cluster" x="${top.x.toFixed(1)}" y="${(top.y - 44).toFixed(1)}">${esc(short(sectionName(group[0].id, group[0].label), 20))}
        <tspan class="at-cluster-n" x="${top.x.toFixed(1)}" dy="12">${group.length} ${esc(t('sections'))}</tspan></text>
      ${chips}`;
  }).join('');

  const total = items.reduce((a, x) => a + x.count, 0);
  const related = edges.filter((e) => items.some((x) => x.id === e.from) || items.some((x) => x.id === e.to)).length;

  return `<svg aria-hidden="true" focusable="false" class="atlas-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="${esc(divisionName(div.id, div.label))} — its departments and how they connect"
    style="color:${div.color}">
    <text class="at-ghost" x="${rootX}" y="${(rootY - 430).toFixed(0)}" style="font-size:196px">${esc(divisionName(div.id, div.label))}</text>
    ${drawn}
    <g class="at-node">
      <circle class="at-chip-ring" cx="${rootX}" cy="${rootY}" r="21" style="stroke:${div.color}"/>
      <g class="at-chip-glyph" style="fill:${div.color}" transform="translate(${rootX - 9}, ${rootY - 9})">${NODE_GLYPH.flow}</g>
    </g>
    <text class="at-dname" x="${rootX}" y="${rootY + 50}" style="fill:${div.color}">${esc(divisionName(div.id, div.label))}</text>
    <text class="at-dsub" x="${rootX}" y="${rootY + 68}">${items.length} ${esc(t('sections'))} · ${total} ${esc(t('records'))} · ${related} ${esc(t('relationships'))}</text>

    <g class="at-stepper">
      <path class="at-step" d="M 56 ${rootY - 40} l -12 10 l 12 10"/>
      <rect class="at-step-hit" data-step="-1" x="24" y="${rootY - 68}" width="64" height="66"/>
      <path class="at-step" d="M ${W - 56} ${rootY - 40} l 12 10 l -12 10"/>
      <rect class="at-step-hit" data-step="1" x="${W - 88}" y="${rootY - 68}" width="64" height="66"/>
    </g>
  </svg>`;
}
/** The map, at whichever depth you are standing. */
export function buildMap(m) {
  const known = m.divisions.some((d) => d.id === atlasZoom);
  if (atlasZoom && !known) atlasZoom = null;
  if (atlasState.style !== (atlasZoom || 'far')) {
    atlasState.style = atlasZoom || 'far';
    atlasState.vb = null; atlasState.sel = null; atlasState.traceFrom = null; atlasState.divSel = null;
  }
  return atlasZoom ? buildAtlasNear(m, atlasZoom) : buildAtlasFar(m);
}
/** Walking the rim, and going in and out. */
export function atlasGoTo(divId) {
  atlasZoom = divId;
  if (divId) localStorage.setItem('alphacore-atlas-zoom', divId);
  else localStorage.removeItem('alphacore-atlas-zoom');
  const r = routes[currentRoute().key];
  if (r) r.render(currentRoute().arg).then(afterRender).catch(() => {});
}
export function atlasStep(delta) {
  const ids = (CATALOG.divisions || []).map((d) => d.id);
  if (!ids.length) return;
  const at = ids.indexOf(atlasZoom);
  atlasGoTo(ids[(at + delta + ids.length) % ids.length]);
}
/** Pan/zoom, hover isolation, click-to-inspect, hop-by-hop flow tracing. */
/**
 * Light the map by what is happening, rather than by what exists.
 *
 * The atlas has always drawn the company. Drawing is the right thing for
 * somebody meeting it for the first time and the wrong thing every morning
 * afterwards, when the questions are all about today. A lens dims everything
 * and lights only the departments the answer is in, with the number on them.
 *
 * Nothing is invented: each lens is a set of counts the server derived from
 * real queries, and a department with no counter stays unlit rather than
 * showing a confident zero.
 */
function applyLens(svg, state, lens, term) {
  const counts = lens === 'all' ? null : (state?.[lens] || {});
  svg.querySelectorAll('.at-lens-badge').forEach((n) => n.remove());
  const matches = (id) => {
    if (term) return id.toLowerCase().includes(term) || (sectionName(id, id) || '').toLowerCase().includes(term);
    if (!counts) return true;
    return Boolean(counts[id]);
  };

  let lit = 0;
  svg.querySelectorAll('[data-dept]').forEach((node) => {
    const id = node.dataset.dept;
    const on = matches(id);
    if (on) lit += 1;
    node.classList.toggle('at-dim', !on && (Boolean(term) || Boolean(counts)));
    node.classList.toggle('at-lit', on && (Boolean(term) || Boolean(counts)));

    const n = counts?.[id];
    if (n && on) {
      const cx = Number(node.getAttribute('cx'));
      const cy = Number(node.getAttribute('cy'));
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      g.setAttribute('class', 'at-lens-badge');
      g.setAttribute('x', (cx + 6).toFixed(1));
      g.setAttribute('y', (cy - 5).toFixed(1));
      g.textContent = n > 99 ? '99+' : String(n);
      node.parentNode.appendChild(g);
    }
  });
  // The districts fade with their leaves, so the eye is not pulled to a label
  // whose departments are all dark.
  svg.querySelectorAll('.at-district').forEach((d) => {
    const any = [...d.querySelectorAll('[data-dept]')].some((n) => !n.classList.contains('at-dim'));
    d.classList.toggle('at-district-dim', !any && (Boolean(term) || Boolean(counts)));
  });
  return lit;
}

export function initAtlas(map) {
  const svg = view.querySelector('svg.atlas-svg');
  if (!svg) return;
  const panel = svg.closest('.panel');
  panel.style.position = 'relative';
  let tip = panel.querySelector('#map-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'map-tip'; tip.hidden = true; panel.appendChild(tip); }
  // ---- the lenses ----------------------------------------------------
  let lensState = null;
  let lens = 'all';
  let term = '';
  const bar = document.createElement('div');
  bar.className = 'map-lens';
  bar.innerHTML = `
    <div class="ml-buttons" role="group" aria-label="${esc(t('Light the map by'))}">
      <button data-lens="all" class="on">${esc(t('Everything'))}</button>
      <button data-lens="waiting">${esc(t('Waiting on a person'))} <span class="ml-n" data-n="waiting"></span></button>
      <button data-lens="failing">${esc(t('Failing'))} <span class="ml-n" data-n="failing"></span></button>
      <button data-lens="active">${esc(t('Moved today'))} <span class="ml-n" data-n="active"></span></button>
    </div>
    <input class="ml-find" type="search" placeholder="${esc(t('find a department'))}" aria-label="${esc(t('Find a department on the map'))}">
    <span class="ml-said"></span>`;
  panel.appendChild(bar);

  const said = bar.querySelector('.ml-said');
  const paint = () => {
    const lit = applyLens(svg, lensState, lens, term.trim().toLowerCase());
    if (term) said.textContent = `${lit} ${t('match')}`;
    else if (lens === 'all') said.textContent = '';
    else {
      const total = lensState?.totals?.[lens] ?? 0;
      said.textContent = lit
        ? `${lit} ${t('department(s)')} · ${total} ${t('item(s)')}`
        : t('nothing — and only departments with a declared counter can light up');
    }
  };
  bar.querySelectorAll('[data-lens]').forEach((b) => b.addEventListener('click', () => {
    lens = b.dataset.lens;
    bar.querySelectorAll('[data-lens]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
  let findTimer;
  bar.querySelector('.ml-find').addEventListener('input', (e) => {
    term = e.target.value;
    clearTimeout(findTimer);
    findTimer = setTimeout(paint, 160);
  });
  api('/api/map/state').then((st) => {
    lensState = st;
    for (const k of ['waiting', 'failing', 'active']) {
      const el = bar.querySelector(`[data-n="${k}"]`);
      if (el) el.textContent = st.totals?.[k] ? String(st.totals[k]) : '';
    }
    bar.title = st.note || '';
    paint();
  }).catch(() => { bar.querySelector('.ml-said').textContent = ''; });

  const ctl = document.createElement('div');
  ctl.className = 'map-ctl';
  ctl.innerHTML = `<button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit whole map">⤢</button>`;
  panel.appendChild(ctl);
  // Clicking something on the map opens a real window over it, and while that
  // window is open the pointer belongs to the window — the map underneath does
  // not pan, zoom or drag. A panel docked inside the canvas kept stealing the
  // gestures meant for the panel itself.
  let dlg = document.getElementById('map-dialog');
  if (!dlg) {
    dlg = document.createElement('div');
    dlg.id = 'map-dialog';
    dlg.hidden = true;
    dlg.innerHTML = '<div class="md-box" role="dialog" aria-modal="true" aria-label="Department details" role="dialog" aria-modal="true" tabindex="-1"></div>';
    document.body.appendChild(dlg);
  }
  const side = dlg.querySelector('.md-box');
  const dialogOpen = () => !dlg.hidden;
  const openDialog = () => {
    dlg.hidden = false;
    document.body.classList.add('map-modal-open');
    side.scrollTop = 0;
    side.focus({ preventScroll: true });
  };

  const sec = Object.fromEntries(map.sections.map((s) => [s.id, s]));
  const divColor = Object.fromEntries(map.divisions.map((d) => [d.id, d.color]));
  const idxEdges = map.edges.map((e, i) => ({ ...e, i }));
  const edgesFor = (id) => idxEdges.filter((e) => e.from === id || e.to === id);

  // --- viewport: wheel zoom about the cursor, drag to pan ---
  const vbAttr = (svg.getAttribute('viewBox') || '0 0 1744 940').split(/\s+/).map(Number);
  const VB0 = { x: vbAttr[0], y: vbAttr[1], w: vbAttr[2], h: vbAttr[3] };
  let vb = atlasState.vb ? { ...atlasState.vb } : { ...VB0 };
  const applyVB = () => { svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`); atlasState.vb = { ...vb }; };
  if (atlasState.vb) applyVB();
  const toSvg = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (px, py, k) => {
    const nw = Math.min(2600, Math.max(260, vb.w * k));
    const nh = nw * (VB0.h / VB0.w);
    vb = { x: px - (px - vb.x) * (nw / vb.w), y: py - (py - vb.y) * (nh / vb.h), w: nw, h: nh };
    applyVB();
  };
  svg.addEventListener('wheel', (e) => {
    if (dialogOpen()) return;
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  ctl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.z === 'fit') { vb = { ...VB0 }; applyVB(); return; }
    zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, b.dataset.z === 'in' ? 1 / 1.35 : 1.35);
  }));
  // Pan, without stealing clicks. The pointer is only captured once a real
  // drag starts — capturing on pointerdown retargets the follow-up click to
  // the <svg aria-hidden="true" focusable="false">, so a plain click on a section never reached the section.
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dialogOpen()) return;
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false, pid: e.pointerId };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      drag.moved = true;
      try { svg.setPointerCapture(drag.pid); } catch { /* touch quirks */ }
    }
    if (!drag.moved) return;
    const scale = vb.w / svg.getBoundingClientRect().width;
    vb.x = drag.vx - dx * scale; vb.y = drag.vy - dy * scale; applyVB();
  });
  svg.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) { try { svg.releasePointerCapture(d.pid); } catch { /* already released */ } return; }
    // A click, not a drag: resolve what is actually under the pointer. This is
    // the single path that opens a department, so it works in every map style.
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const a = hit?.closest?.('a[data-node]');
    if (!a) {
      if (hit === svg || hit?.classList?.contains('cx-orbit') || hit?.classList?.contains('b-bg')) closeSide();
      return;
    }
    const id = a.dataset.node;
    // A click opens the section's window; the window carries the button that
    // actually leaves the map. Ctrl/⌘-click still jumps straight there for
    // anyone who knows where they are going.
    if (e.ctrlKey || e.metaKey) {
      const href = a.getAttribute('href');
      if (href) { if (location.hash === href) navigate(); else location.hash = href; }
      return;
    }
    // Shift-click retraces from wherever you are without reopening the window,
    // so a trace can be walked across the company one department at a time.
    if (e.shiftKey || atlasState.traceFrom) { atlasState.traceHop = null; startTrace(id); return; }
    select(id);
  });

  // --- highlighting ---
  const clearFx = () => {
    svg.querySelectorAll('.dimmed,.lit,.trace').forEach((el) => { el.classList.remove('dimmed', 'lit', 'trace'); el.style.animationDelay = ''; });
  };
  const focus = (id) => {
    clearFx();
    if (!id) return;
    const near = new Set([id]);
    for (const e of idxEdges) {
      if (e.from === id) near.add(e.to);
      if (e.to === id) near.add(e.from);
    }
    svg.querySelectorAll('[data-node]').forEach((el) => {
      const nid = el.dataset.node;
      el.classList.toggle('dimmed', nid !== 'core' && !near.has(nid));
      el.classList.toggle('lit', near.has(nid));
    });
    svg.querySelectorAll('.cx-edge').forEach((el) => {
      const on = el.dataset.a === id || el.dataset.b === id;
      el.classList.toggle('lit', on);
      el.classList.toggle('dimmed', !on);
    });
    svg.querySelectorAll('.cx-spoke').forEach((el) => el.classList.toggle('dimmed', el.dataset.spoke !== id));
  };
  const focusDiv = (divId) => {
    clearFx();
    if (!divId) return;
    const inDiv = new Set(map.sections.filter((s) => s.division === divId).map((s) => s.id));
    svg.querySelectorAll('[data-node]').forEach((el) => el.classList.toggle('dimmed', el.dataset.node !== 'core' && !inDiv.has(el.dataset.node)));
    svg.querySelectorAll('.cx-edge').forEach((el) => {
      const on = inDiv.has(el.dataset.a) || inDiv.has(el.dataset.b);
      el.classList.toggle('lit', on);
      el.classList.toggle('dimmed', !on);
    });
  };

  // Full flow trace: breadth-first from one section across every declared
  // relationship, lighting the graph hop by hop so the propagation is visible.
  const runTrace = (start) => {
    const depth = { [start]: 0 };
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const e of idxEdges) {
          const other = e.from === id ? e.to : e.to === id ? e.from : null;
          if (!other || other === 'all' || e.from === 'all' || e.to === 'all') continue;
          if (!(other in depth)) { depth[other] = depth[id] + 1; next.push(other); }
        }
      }
      frontier = next;
    }
    clearFx();
    const maxHop = Math.max(...Object.values(depth));
    const limit = atlasState.traceHop == null ? maxHop : atlasState.traceHop;
    svg.querySelectorAll('[data-node]').forEach((el) => {
      const d = depth[el.dataset.node];
      const on = d !== undefined && d <= limit;
      el.classList.toggle('dimmed', !on);
      el.classList.toggle('lit', on);
      el.classList.toggle('trace-origin', el.dataset.node === start);
      if (on) el.style.animationDelay = `${d * 0.12}s`;
    });
    svg.querySelectorAll('.cx-edge').forEach((el) => {
      const da = depth[el.dataset.a], db = depth[el.dataset.b];
      const on = da !== undefined && db !== undefined && Math.max(da, db) <= limit;
      el.classList.toggle('trace', on);
      el.classList.toggle('dimmed', !on);
      if (on) el.style.animationDelay = `${Math.min(da, db) * 0.12}s`;
    });
    drawHopBadges(depth, limit);
    return depth;
  };

  // Each reached department is stamped with how many hops away it is, so the
  // trace can be read standing still instead of watched like an animation.
  const drawHopBadges = (depth, limit) => {
    svg.querySelector('#hop-layer')?.remove();
    if (!depth) return;
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('id', 'hop-layer');
    layer.setAttribute('pointer-events', 'none');
    for (const el of svg.querySelectorAll('[data-node]')) {
      const d = depth[el.dataset.node];
      if (d === undefined || d > limit) continue;
      let box;
      try { box = el.getBBox(); } catch { continue; }
      if (!box || (!box.width && !box.height)) continue;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `hop-badge${d === 0 ? ' hop-origin' : ''}`);
      g.setAttribute('transform', `translate(${(box.x + box.width - 4).toFixed(1)} ${(box.y + 4).toFixed(1)})`);
      g.style.animationDelay = `${d * 0.12}s`;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '8.5');
      const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tx.setAttribute('dy', '3.2');
      tx.textContent = d === 0 ? '◎' : String(d);
      g.append(c, tx);
      layer.appendChild(g);
    }
    svg.appendChild(layer);
  };

  // The trace outlives the window that started it: a small bar keeps it under
  // control — which department, how far it reaches, and how to step or stop.
  // The bar lives on the body, not inside the view: #view carries a transform,
  // which would make `position: fixed` resolve against that very tall element
  // and park the control far below the fold.
  let hud = document.getElementById('trace-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'trace-hud';
    hud.className = 'trace-hud';
    hud.hidden = true;
    document.body.appendChild(hud);
  }
  const stopTrace = () => {
    atlasState.traceFrom = null; atlasState.traceHop = null;
    hud.hidden = true;
    svg.querySelector('#hop-layer')?.remove();
    clearFx();
  };
  const startTrace = (id) => {
    atlasState.traceFrom = id;
    const depth = runTrace(id);
    const maxHop = Math.max(...Object.values(depth));
    const reach = Object.keys(depth).length - 1;
    const at = atlasState.traceHop == null ? maxHop : atlasState.traceHop;
    const shown = Object.values(depth).filter((d) => d <= at && d > 0).length;
    const perHop = [...Array(maxHop + 1).keys()].map((h) => Object.values(depth).filter((d) => d === h).length);
    hud.innerHTML = `
      <div class="th-main">
        <span class="th-dot"></span>
        <b>${esc(sectionName(id, sec[id]?.label || id))}</b>
        <span class="th-txt">${esc(t('reaches'))} <b>${reach}</b> ${esc(t('departments in'))} <b>${maxHop}</b> ${esc(t(maxHop === 1 ? 'hop' : 'hops'))}${at < maxHop ? ` · ${esc(t('showing'))} ${shown} ${esc(t('within'))} ${at}` : ''}</span>
      </div>
      <div class="th-hops">${perHop.map((n, h) => `<button class="th-hop ${h <= at ? 'on' : ''}" data-hop="${h}" title="${n} ${esc(t('departments'))} · ${esc(t('hop'))} ${h}">${h === 0 ? '◎' : h}<i>${n}</i></button>`).join('')}
        <button class="th-hop ${at >= maxHop ? 'on' : ''}" data-hop="all" title="${esc(t('Show every hop'))}">${esc(t('all'))}</button></div>
      <button class="btn btn-sm th-stop">${esc(t('Stop trace'))}</button>`;
    hud.hidden = false;
    hud.querySelectorAll('[data-hop]').forEach((b) => b.addEventListener('click', () => {
      atlasState.traceHop = b.dataset.hop === 'all' ? null : Number(b.dataset.hop);
      startTrace(id);
    }));
    hud.querySelector('.th-stop').addEventListener('click', stopTrace);
  };

  // --- the connection ledger: click a section, read everything it touches ---
  // Closing the window must not throw away a trace the window merely started —
  // that was why the trace looked like it never worked.
  const closeSide = () => {
    atlasState.sel = null; atlasState.selEdge = null;
    dlg.hidden = true;
    document.body.classList.remove('map-modal-open');
    if (atlasState.traceFrom) startTrace(atlasState.traceFrom);
    else clearFx();
  };
  // Opening a window is looking at something, not abandoning the trace: the
  // highlight yields to whatever you opened and comes back when you close it.
  // Only the HUD's own Stop ends a trace.
  const select = (id) => {
    atlasState.sel = id; atlasState.divSel = null; atlasState.selEdge = null;
    focus(id);
    const s = sec[id];
    if (!s) return;
    const rel = edgesFor(id);
    const out = rel.filter((e) => e.from === id);
    const inn = rel.filter((e) => e.to === id);
    const row = (e, dir) => {
      const other = dir === 'out' ? e.to : e.from;
      const oth = sec[other];
      const k = EDGE_KIND[e.kind] || EDGE_KIND.flow;
      return `<div class="ms-row" data-edgeinfo="${e.i}" title="${esc(k.how)}">
        <span class="ms-dir">${dir === 'out' ? '→' : '←'}</span>
        <b style="color:${oth ? divColor[oth.division] : 'var(--ink)'}">${esc(sectionName(other, oth?.label || other))}</b>
        <span class="ms-cnt">${e.count}</span>
        <div class="ms-lbl"><span class="edge-tag edge-${esc(e.kind || 'flow')}">${esc(t(k.label))}</span> ${esc(e.label)}</div>
      </div>`;
    };
    side.innerHTML = `
      <button class="md-x" data-ms="close" aria-label="Close">✕</button>
      <div class="ms-head" style="color:${divColor[s.division]}">${esc(sectionName(s.id, s.label))}</div>
      <div class="ms-sub">${esc(divisionName(s.division, s.division))} · ${s.count} ${esc(t(s.count === 1 ? 'record' : 'records'))} · ${rel.length} ${esc(t('relationships'))}</div>
      <div class="ms-hint">${esc(s.hint)}</div>
      <div class="ms-actions">
        <button class="btn btn-sm btn-primary" data-ms="open">${esc(t('Open'))} →</button>
        <button class="btn btn-sm" data-ms="trace">${esc(t('Trace flow'))}</button>
      </div>
      ${out.length ? `<div class="ms-sec">${esc(t('Sends to'))} · ${out.length}</div>${out.map((e) => row(e, 'out')).join('')}` : ''}
      ${inn.length ? `<div class="ms-sec">${esc(t('Receives from'))} · ${inn.length}</div>${inn.map((e) => row(e, 'in')).join('')}` : ''}
      <div class="ms-sec">${esc(t('Universal'))}</div>
      <div class="ms-lbl">${esc(t('Every action here lands on the audit chain; produced items freeze into the archive.'))}</div>`;
    openDialog();
    side.querySelector('[data-ms="open"]').onclick = () => { location.hash = s.href; };
    side.querySelector('[data-ms="close"]').onclick = closeSide;
    // Starting a trace closes the window on purpose: the answer is on the map,
    // and the trace now survives on its own with its control bar.
    side.querySelector('[data-ms="trace"]').onclick = () => {
      atlasState.sel = null; atlasState.selEdge = null; atlasState.traceHop = null;
      dlg.hidden = true;
      document.body.classList.remove('map-modal-open');
      startTrace(id);
    };
    side.querySelectorAll('[data-edgeinfo]').forEach((r) => r.addEventListener('click', () => selectEdge(Number(r.dataset.edgeinfo))));
  };

  // --- pointer wiring ---
  svg.querySelectorAll('a[data-node]').forEach((a) => {
    // Navigation is handled once, on pointerup above (it survives pointer
    // capture and works identically in all four map styles). The anchor's own
    // default is suppressed so the two never race.
    a.addEventListener('click', (e) => e.preventDefault());
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (a.dataset.node !== 'core') select(a.dataset.node);
    });
    a.addEventListener('mouseenter', (e) => {
      if (drag?.moved) return;
      const id = a.dataset.node;
      if (!atlasState.sel && !atlasState.traceFrom && id !== 'core') focus(id);
      const rel = edgesFor(id);
      tip.innerHTML = `<div class="tip-head" style="color:${a.dataset.color}">${esc(a.dataset.label)}</div>
        <div class="tip-val">${esc(a.dataset.count)} ${id === 'harmony' ? 'harmony score' : 'records'}${a.dataset.div ? ` · ${esc(a.dataset.div)}` : ''}</div>
        <div class="tip-body">${esc(a.dataset.hint)}</div>
        ${rel.length ? `<div class="tip-rel">${rel.slice(0, 6).map((e2) => `<span>${esc(e2.from === id ? '→ ' + e2.to : '← ' + e2.from)} <b>${e2.count}</b> ${esc(short(e2.label, 30))}</span>`).join('')}</div>` : ''}
        <div class="tip-go">click to open · right-click for connections &amp; trace</div>`;
      tip.hidden = false;
    });
    a.addEventListener('mousemove', (e) => {
      const r = panel.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(e.clientX - r.left + 18, panel.clientWidth - 268)) + 'px';
      tip.style.top = Math.max(8, Math.min(e.clientY - r.top + 18, panel.clientHeight - 190)) + 'px';
    });
    a.addEventListener('mouseleave', () => {
      tip.hidden = true;
      if (atlasState.traceFrom) runTrace(atlasState.traceFrom);
      else if (atlasState.sel) focus(atlasState.sel);
      else if (atlasState.divSel) focusDiv(atlasState.divSel);
      else clearFx();
    });
  });
  // A relationship is a thing you can ask about, not just a line: clicking one
  // explains what kind of movement it is and how that mechanism works.
  const selectEdge = (idx) => {
    const e = idxEdges[idx];
    if (!e) return;
    atlasState.sel = null; atlasState.divSel = null;
    atlasState.selEdge = idx;
    clearFx();
    const k = EDGE_KIND[e.kind] || EDGE_KIND.flow;
    const a = sec[e.from]; const b = sec[e.to];
    svg.querySelectorAll('.cx-edge').forEach((el) => {
      const on = el.dataset.edge === String(idx);
      el.classList.toggle('lit', on);
      el.classList.toggle('dimmed', !on);
    });
    svg.querySelectorAll('[data-node]').forEach((el) => {
      const on = [e.from, e.to].includes(el.dataset.node);
      el.classList.toggle('lit', on);
      el.classList.toggle('dimmed', !on);
    });
    side.innerHTML = `
      <button class="md-x" data-ms="close" aria-label="Close">✕</button>
      <div class="ms-head" style="color:${divColor[a?.division] || 'var(--ember)'}">${esc(t(k.label))}</div>
      <div class="ms-sub">${esc(sectionName(e.from, a?.label || e.from))} → ${esc(sectionName(e.to, b?.label || e.to))}</div>
      <div class="edge-kind edge-${esc(e.kind || 'flow')}"><i></i><span>${esc(e.label)}</span></div>
      <div class="ms-metric"><b>${e.count}</b> ${esc(t(e.count === 1 ? 'record' : 'records'))} ${esc(t('on this join right now'))}</div>
      <div class="ms-hint">${esc(t(k.how))}</div>
      <div class="ms-actions">
        ${a ? `<button class="btn btn-sm btn-primary" data-ms-go="${esc(a.href)}">${esc(sectionName(e.from, a.label))} →</button>` : ''}
        ${b ? `<button class="btn btn-sm" data-ms-go="${esc(b.href)}">${esc(sectionName(e.to, b.label))} →</button>` : ''}
        <button class="btn btn-sm" data-ms="close">✕</button>
      </div>
      <div class="ms-sec">${esc(t('Where this is written'))}</div>
      <div class="ms-lbl">${esc(t('The count comes from a live query, so this line disappears the moment the relationship stops being real.'))}</div>`;
    openDialog();
    side.querySelector('[data-ms="close"]').onclick = closeSide;
    side.querySelectorAll('[data-ms-go]').forEach((btn) => { btn.onclick = () => { location.hash = btn.dataset.msGo; }; });
  };

  svg.querySelectorAll('.cx-hit').forEach((h) => {
    const idx = Number(h.dataset.edgehit);
    h.addEventListener('mouseenter', () => svg.querySelector(`[data-edge="${idx}"]`)?.classList.add('lit'));
    h.addEventListener('mouseleave', () => {
      if (!atlasState.sel && !atlasState.traceFrom && atlasState.selEdge == null) {
        svg.querySelector(`[data-edge="${idx}"]`)?.classList.remove('lit');
      }
    });
    h.addEventListener('click', (ev) => { ev.stopPropagation(); if (!drag?.moved) selectEdge(idx); });
    h.addEventListener('pointerup', (ev) => { ev.stopPropagation(); if (!drag?.moved) selectEdge(idx); });
  });
  // Matrix cells: one click lists every relationship behind the number.
  svg.querySelectorAll('.mx-cell.has').forEach((g) => g.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const list = (g.dataset.edges || '').split(',').map(Number).filter((x) => !Number.isNaN(x));
    if (!list.length) return;
    if (list.length === 1) { selectEdge(list[0]); return; }
    const [fromDiv, toDiv] = g.dataset.cell.split('|');
    const fd = map.divisions.find((d) => d.id === fromDiv);
    const td = map.divisions.find((d) => d.id === toDiv);
    atlasState.selEdge = null;
    side.innerHTML = `
      <div class="ms-head" style="color:${fd?.color || 'var(--ember)'}">${esc(divisionName(fromDiv, fd?.label))} → ${esc(divisionName(toDiv, td?.label))}</div>
      <div class="ms-sub">${list.length} relationships · ${list.reduce((n, i) => n + (idxEdges[i]?.count || 0), 0)} records</div>
      ${list.map((i) => {
        const e = idxEdges[i];
        const k = EDGE_KIND[e.kind] || EDGE_KIND.flow;
        return `<div class="ms-row" data-edgeinfo="${i}">
          <span class="ms-dir">→</span>
          <b>${esc(sectionName(e.from, sec[e.from]?.label || e.from))} → ${esc(sectionName(e.to, sec[e.to]?.label || e.to))}</b>
          <span class="ms-cnt">${e.count}</span>
          <div class="ms-lbl"><span class="edge-tag edge-${esc(e.kind || 'flow')}">${esc(k.label)}</span> ${esc(e.label)}</div>
        </div>`;
      }).join('')}
      <div class="ms-actions"><button class="btn btn-sm" data-ms="close">✕</button></div>`;
    openDialog();
    side.querySelector('[data-ms="close"]').onclick = closeSide;
    side.querySelectorAll('[data-edgeinfo]').forEach((r) => r.addEventListener('click', () => selectEdge(Number(r.dataset.edgeinfo))));
  }));

  svg.querySelectorAll('[data-divlabel]').forEach((t) => t.addEventListener('click', () => {
    const id = t.dataset.divlabel;
    if (atlasState.divSel === id) { atlasState.divSel = null; clearFx(); return; }
    // Filtering to a district replaces the highlight for good, so the trace
    // ends properly instead of leaving its bar on screen claiming otherwise.
    if (atlasState.traceFrom) stopTrace();
    atlasState.divSel = id; atlasState.sel = null;
    dlg.hidden = true; document.body.classList.remove('map-modal-open');
    focusDiv(id);
  }));

  dlg.onclick = (e) => { if (e.target === dlg) closeSide(); };
  dlg.onpointerdown = (e) => e.stopPropagation();
  dlg.onwheel = (e) => e.stopPropagation();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialogOpen()) closeSide(); });

  // Restore what the user was looking at across the poll re-render.
  // A live trace is redrawn silently on every poll — it must not pop the
  // window open again while someone is reading the board.
  if (atlasState.traceFrom) startTrace(atlasState.traceFrom);
  else if (atlasState.sel) select(atlasState.sel);
  else if (atlasState.divSel) focusDiv(atlasState.divSel);

  // --- the live layer: watch the company work ---
  // Every few seconds the board asks the audit chain what happened. New events
  // flash their section's chip and scroll through the ticker, so activity is
  // visible the moment it lands on the chain.
  // The ticker sits under the board rather than floating over it: at 76 chips
  // there is no free corner left, and covering a department to show activity
  // defeats the point.
  const ticker = document.createElement('div');
  ticker.className = 'map-ticker';
  ticker.innerHTML = '<div class="tk-row tk-idle">listening for activity…</div>';
  svg.insertAdjacentElement('afterend', ticker);
  const renderTicker = () => {
    ticker.innerHTML = (atlasState.feed || []).map((ev) => `
      <div class="tk-row">
        <span class="tk-time">${esc(String(ev.at).slice(11, 19))}</span>
        <span class="tk-act">${esc(ev.action)}</span>
        <span class="tk-who">${esc(short(ev.actor || '', 18))}</span>
      </div>`).join('') || '<div class="tk-row tk-idle">listening for activity…</div>';
  };
  renderTicker();
  const pollActivity = async () => {
    try {
      const feed = await api(`/api/map/activity?since=${atlasState.lastSeq || 0}`);
      if (Array.isArray(feed) && feed.length) {
        const first = !atlasState.lastSeq;
        atlasState.lastSeq = feed[0].seq;
        atlasState.feed = [...feed, ...(atlasState.feed || [])].slice(0, 6);
        if (!first) {
          for (const ev of feed.slice(0, 10)) {
            if (!ev.section) continue;
            const node = svg.querySelector(`[data-node="${ev.section}"]`);
            if (node) { node.classList.remove('ping'); void node.getBoundingClientRect(); node.classList.add('ping'); }
          }
        }
        renderTicker();
      }
    } catch { /* a missed beat is fine — next poll catches up */ }
  };
  pollActivity();
  const tickerTimer = setInterval(() => {
    if (!document.body.contains(svg)) { clearInterval(tickerTimer); return; }
    pollActivity();
  }, 4000);
}
function buildSystemMapOrbital(s, prov, agentsList, chain, extra = {}) {
  const queue = s.queue || {};
  const active = (queue.queued || 0) + (queue.leased || 0) + (queue.running || 0);
  const done = queue.done || 0;
  const decTotal = Object.values(s.decisions || {}).reduce((a, b) => a + b, 0);
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100).toFixed(1);
  const online = prov.providers.filter((p) => p.name !== 'mock' && p.available).length;

  const nodes = [
    // inner orbit — the execution engine
    orbitPill({ deg: 180, ring: 'inner', href: '#/runs', title: 'RUN QUEUE', value: `${active} active · ${done} done` }),
    orbitPill({ deg: 105, ring: 'inner', href: '#/gate', title: 'HUMAN GATE', value: `${s.awaitingHuman} awaiting`, cls: s.awaitingHuman ? 'warn' : '' }),
    orbitPill({ deg: 60, ring: 'inner', href: '#/budgets', title: 'POLICY · BUDGETS', value: `${monthPct}% of cap`, cls: 'ember' }),
    orbitPill({ deg: 0, ring: 'inner', href: '#/providers', title: 'MODEL ROUTER', value: `${s.mockMode ? 'MOCK' : 'LIVE'} · T1–T4`, cls: 'steel' }),
    orbitPill({ deg: 300, ring: 'inner', href: '#/decisions', title: 'REGISTRY', value: `${decTotal} cases · humans decide` }),
    orbitPill({ deg: 240, ring: 'inner', href: '#/decisions', title: 'TRIBUNAL', value: 'blind critics · judge' }),
    // outer orbit — the company
    orbitPill({ deg: 180, ring: 'outer', href: '#/agents', title: 'AGENTS', value: `${agentsList.length} roles · 5 groups` }),
    orbitPill({ deg: 135, ring: 'outer', href: '#/evals', title: 'EVALS · CANARIES', value: `${extra.evalSets ?? 0} sets → reputation`, cls: 'steel' }),
    orbitPill({ deg: 90, ring: 'outer', href: '#/artifacts', title: 'ARTIFACTS', value: `${extra.artifactsCount ?? 0} real files` }),
    orbitPill({ deg: 45, ring: 'outer', href: '#/governance', title: 'GOVERNANCE', value: `${extra.unread ?? 0} alerts · ${extra.overdueRituals ?? 0} overdue`, cls: extra.unread ? 'warn' : 'ok' }),
    orbitPill({ deg: 0, ring: 'outer', href: '#/providers', title: 'PROVIDERS', value: `${online}/5 online` }),
    orbitPill({ deg: 322, ring: 'outer', href: '#/support', title: 'SUPPORT DESK', value: `${extra.openTickets ?? 0} open · human sends`, cls: extra.openTickets ? 'warn' : '' }),
    orbitPill({ deg: 270, ring: 'outer', href: '#/incidents', title: 'INCIDENTS', value: `${extra.openIncidents ?? 0} open`, cls: extra.openIncidents ? 'bad' : '' }),
    orbitPill({ deg: 218, ring: 'outer', href: '#/products', title: 'PRODUCT FACTORY', value: `${extra.productsTotal ?? 0} products · ${extra.liveProducts ?? 0} live`, cls: 'ember' }),
    // corporate ring — the giant-company layer
    orbitPill({ x: 95, y: 95, w: 150, h: 40, href: '#/people', title: 'PEOPLE · HR', value: `${extra.peopleCount ?? 0} humans` }),
    orbitPill({ x: 300, y: 42, w: 150, h: 40, href: '#/knowledge', title: 'KNOWLEDGE', value: `${extra.knowledgeCount ?? 0} entries` }),
    orbitPill({ x: 700, y: 42, w: 150, h: 40, href: '#/objectives', title: 'OBJECTIVES', value: `${extra.objectivesActive ?? 0} active OKRs` }),
    orbitPill({ x: 905, y: 95, w: 150, h: 40, href: '#/legal', title: 'LEGAL', value: `${extra.contractsCount ?? 0} on register` }),
    orbitPill({ x: 918, y: 557, w: 150, h: 40, href: '#/vendors', title: 'VENDORS', value: `${extra.vendorsActive ?? 0} active`, cls: 'ember' }),
    orbitPill({ x: 700, y: 627, w: 150, h: 40, href: '#/customers', title: 'CUSTOMERS', value: `$${(extra.mrr ?? 0).toFixed(0)} MRR`, cls: 'ok' }),
    orbitPill({ x: 300, y: 627, w: 150, h: 40, href: '#/marketing', title: 'MARKETING', value: `${extra.campaignsLive ?? 0} live campaigns`, cls: 'steel' }),
    orbitPill({ x: 88, y: 557, w: 156, h: 40, href: '#/intel', title: 'DATA · INTEL', value: `${extra.archiveCount ?? 0} archived · targets → CRM`, cls: 'steel' }),
  ];

  return `<svg aria-hidden="true" focusable="false" class="sysmap" viewBox="0 0 1000 655" role="img" aria-label="System map — the company in orbit around its audit chain">
  <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--ink-faint)"/></marker></defs>

  <ellipse class="orbit-guide" cx="500" cy="330" rx="215" ry="155"/>
  <ellipse class="orbit-guide" cx="500" cy="330" rx="400" ry="262"/>

  ${nodes.map((n) => coreSpoke(n.x, n.y)).join('')}

  ${mapEdge('M181 330 L203 330')}
  ${mapEdge('M796 330 L818 330')}
  ${mapEdge('M352 314 Q500 208 648 314', { label: 'model call', lx: 500, ly: 240 })}
  ${mapEdge('M625 217 Q690 240 706 304', { label: 'reserve first', lx: 700, ly: 250, anchor: 'start' })}
  ${mapEdge('M410 200 Q330 240 296 306', { label: 'escalate · resolve', lx: 322, ly: 236, anchor: 'end' })}
  ${mapEdge('M474 464 L526 464', { label: 'case ⇄ recommends', lx: 500, ly: 454 })}
  ${mapEdge('M240 474 Q380 502 540 480', { label: 'gate records', lx: 388, ly: 502 })}
  ${mapEdge('M744 500 Q650 578 585 589', { label: 'raise', lx: 668, ly: 566 })}
  ${mapEdge('M196 168 Q116 240 106 302', { label: 'reputation', lx: 130, ly: 238, anchor: 'end' })}
  ${mapEdge('M458 156 Q482 108 494 93', { label: 'apply', lx: 452, ly: 118, anchor: 'end' })}
  ${mapEdge('M742 168 Q662 180 634 192')}
  ${mapEdge('M375 627 L622 627', { label: 'acquire', lx: 500, ly: 619 })}
  ${mapEdge('M95 116 L100 304', { label: 'owns', lx: 88, ly: 210, anchor: 'end' })}
  ${mapEdge('M905 116 L901 304', { label: 'terms · A5', lx: 913, ly: 210, anchor: 'start' })}

  ${nodes.map((n) => n.html).join('')}

  <a href="#/audit"><g class="map-node ${chain.ok ? 'ok' : 'bad'}">
    <circle class="core-ring" cx="500" cy="330" r="97"/>
    <circle class="core-disc" cx="500" cy="330" r="76" stroke="${chain.ok ? 'var(--ok)' : 'var(--bad)'}" stroke-width="1.4"/>
    <text class="core-glyph" x="500" y="312">▲</text>
    <text class="mt mid" x="500" y="336">AUDIT CHAIN</text>
    <text class="mv mid" x="500" y="352">${chain.checked} entries · ${chain.ok ? 'intact' : 'BROKEN'}</text>
  </g></a>
</svg>`;
}
