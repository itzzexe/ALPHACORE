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
/**
 * The wheel — the whole company as two rings around one core.
 *
 * The core in the middle: the orchestrator and the chain. The inner ring is
 * the AI core, one sector per district, its width the district's share of
 * the departments. The outer ring is the enterprise core, one sector per
 * division, each placed where its tunnels land so the crossings are short.
 * Every department is a cell on its ring; every declared tunnel is a chord
 * from an enterprise cell to the district it reaches.
 *
 * Nothing here is typed: sectors are the catalogue, tunnels are the edge
 * list the connectivity audit checks. Point at a sector and its cells name
 * themselves and its tunnels light; open a cell for everything it touches;
 * open a sector to go inside.
 */
const WHEEL = { cx: 900, cy: 600, core: 72, r1: [150, 318], r2: [442, 560], gap: 2.6 };
const TAU = Math.PI * 2;
const polar2 = (a, r) => ({ x: WHEEL.cx + Math.cos(a) * r, y: WHEEL.cy + Math.sin(a) * r });
/** An annular sector, drawn as a path. Angles in radians, clockwise from 3 o'clock. */
function sectorPath(a0, a1, r0, r1) {
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const p0 = polar2(a0, r1), p1 = polar2(a1, r1), p2 = polar2(a1, r0), p3 = polar2(a0, r0);
  return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${r1} ${r1} 0 ${big} 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} `
    + `L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} A ${r0} ${r0} 0 ${big} 0 ${p3.x.toFixed(1)} ${p3.y.toFixed(1)} Z`;
}
/** Sector widths: proportional to department count, with a floor so a small district stays legible. */
function sectors(list, { start = -Math.PI / 2, span = TAU, minDeg = 9 } = {}) {
  const gap = (WHEEL.gap * Math.PI) / 180;
  const usable = span - gap * list.length;
  const total = list.reduce((n, d) => n + d.items.length, 0) || 1;
  const min = (minDeg * Math.PI) / 180;
  let widths = list.map((d) => Math.max(min, (usable * d.items.length) / total));
  const scale = usable / widths.reduce((n, w) => n + w, 0);
  widths = widths.map((w) => w * scale);
  let a = start;
  return list.map((d, i) => {
    const a0 = a + gap / 2, a1 = a + gap / 2 + widths[i];
    a += widths[i] + gap;
    return { ...d, a0, a1, mid: (a0 + a1) / 2 };
  });
}
/** Cells inside a sector: dealt onto sub-rings, spread across the angle. */
function cellsIn(sec, r0, r1, rings) {
  const items = sec.items;
  const per = Math.ceil(items.length / rings);
  const pad = (1.2 * Math.PI) / 180;
  return items.map((item, i) => {
    const ring = i % rings;
    const slot = Math.floor(i / rings);
    const slots = Math.ceil(items.length / rings);
    const t2 = slots === 1 ? 0.5 : (slot + 0.5) / slots;
    const a = sec.a0 + pad + (sec.a1 - sec.a0 - pad * 2) * t2;
    const r = rings === 1 ? (r0 + r1) / 2 : r0 + ((r1 - r0) * (ring + 0.5)) / rings;
    return { item, a, r, ...polar2(a, r) };
  }).concat([]).slice(0, items.length);
}
/** Where a horizontal label sits for a point on the wheel: outside, anchored by side. */
/** In a right-to-left page 'start' is the right edge, so the sides swap. */
const sideAnchor = (c) => {
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const a = c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle';
  return rtl && a !== 'middle' ? (a === 'start' ? 'end' : 'start') : a;
};
const labelAt = (a, r) => {
  const p = polar2(a, r);
  return { x: p.x, y: p.y, anchor: sideAnchor(Math.cos(a)) };
};

function buildAtlasFar(map) {
  const { divisions, sections, harmony, audit: connAudit, flow } = map;
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const ent = (map.core2Divisions || []).map((d) => ({ ...d, items: d.departments.map((id) => byId[id]).filter(Boolean) })).filter((d) => d.items.length);
  const mine = new Set(ent.flatMap((d) => d.items.map((x) => x.id)));

  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) {
    if (s.id === 'harmony' || mine.has(s.id)) continue;
    (byDiv[s.division] || byDiv.govern).items.push(s);
  }
  const core1 = sectors(divisions.filter((d) => byDiv[d.id].items.length).map((d) => byDiv[d.id]));
  const angleOf = Object.fromEntries(core1.map((s) => [s.id, s.mid]));

  // The enterprise ring: each division sits where its tunnels land, so the
  // chords are short and the seam reads as a set of neighbourhoods rather
  // than a tangle. Ordered by that preferred angle, then dealt round the ring.
  const tunnels = (map.core2?.tunnels || []);
  const prefer = (d) => {
    const angles = tunnels.filter((tn) => d.items.some((x) => x.id === tn.core2End)).map((tn) => angleOf[tn.core1Division]).filter((a) => a !== undefined);
    if (!angles.length) return Math.PI / 2;
    // circular mean
    const x = angles.reduce((n, a) => n + Math.cos(a), 0), y = angles.reduce((n, a) => n + Math.sin(a), 0);
    return Math.atan2(y, x);
  };
  const ordered = ent.map((d) => ({ ...d, pref: prefer(d) })).sort((a, b) => a.pref - b.pref);
  const core2 = ordered.length ? sectors(ordered, { start: ordered[0].pref - (ordered[0].items.length / Math.max(1, ordered.reduce((n, d) => n + d.items.length, 0))) * Math.PI, minDeg: 14 }) : [];

  const cellPos = {};
  const drawRing = (secs, r0, r1, rings, klass, labelR) => secs.map((sec) => {
    const cells = cellsIn(sec, r0 + 14, r1 - 14, rings);
    const nodes = cells.map((c) => {
      cellPos[c.item.id] = { x: c.x, y: c.y, a: c.a };
      const live = c.item.count > 0;
      const name = sectionName(c.item.id, c.item.label);
      const lb = labelAt(c.a, c.r + 11);
      return `<a class="at-node" href="${esc(c.item.href || '#/')}" data-node="${esc(c.item.id)}" aria-label="${esc(name)}"
        data-color="${sec.color}" data-label="${esc(name)}" data-hint="${esc(c.item.hint || '')}" data-count="${c.item.count}" data-div="${esc(sec.id)}">
        <circle class="at-hit" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="10"/>
        <circle class="at-leaf${live ? '' : ' hollow'}" data-dept="${esc(c.item.id)}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${live ? 4.6 : 3.8}"/>
        <text class="at-cell" x="${lb.x.toFixed(1)}" y="${(lb.y + 3).toFixed(1)}" style="text-anchor:${lb.anchor}">${esc(short(name, 20))}</text>
        <title>${esc(name)} · ${live ? `${c.item.count} ${t('records')}` : t('empty')}</title>
      </a>`;
    }).join('');
    const nm = labelAt(sec.mid, labelR);
    const label = klass === 'enterprise' ? t(sec.label) : divisionName(sec.id, sec.label);
    const total = sec.items.reduce((n, x) => n + (x.count || 0), 0);
    return `<g class="at-district ${klass}" data-district="${esc(sec.id)}" style="color:${sec.color}">
      <path class="at-sector" d="${sectorPath(sec.a0, sec.a1, r0, r1)}"/>
      <path class="at-sector-edge" d="${sectorPath(sec.a0, sec.a1, r1 - 3, r1)}"/>
      <path class="at-hit" d="${sectorPath(sec.a0, sec.a1, r0, r1)}"/>
      ${nodes}
      <text class="at-dname" x="${nm.x.toFixed(1)}" y="${nm.y.toFixed(1)}" style="text-anchor:${nm.anchor}">${esc(label)}</text>
      <text class="at-dsub" x="${nm.x.toFixed(1)}" y="${(nm.y + 14).toFixed(1)}" style="text-anchor:${nm.anchor}">${sec.items.length} ${esc(t('departments'))} · ${total} ${esc(t('records'))}</text>
    </g>`;
  }).join('');

  const inner = drawRing(core1, WHEEL.r1[0], WHEEL.r1[1], 3, 'ai', WHEEL.r1[1] + 26);
  const outer = drawRing(core2, WHEEL.r2[0], WHEEL.r2[1], 2, 'enterprise', WHEEL.r2[1] + 26);

  // Tunnels: chords from the enterprise cell to the rim of the district it
  // reaches, bowed through the gap between the rings.
  const chords = tunnels.map((tn) => {
    const a = cellPos[tn.core2End]; const ang = angleOf[tn.core1Division];
    if (!a || ang === undefined) return '';
    const b = polar2(ang, WHEEL.r1[1] + 4);
    const m = polar2((a.a + ang) / 2 + (Math.abs(a.a - ang) > Math.PI ? Math.PI : 0), (WHEEL.r1[1] + WHEEL.r2[0]) / 2 - 20);
    return `<path class="at-tunnel" data-tunnel-from="${esc(tn.core2End)}" data-tunnel-to="${esc(tn.core1Division)}"
      d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${m.x.toFixed(1)} ${m.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}">
      <title>${esc(tn.core2End)} ↔ ${esc(tn.core1End)}: ${esc(t(tn.label || ''))}</title></path>`;
  }).join('');

  // The core: a deterministic cloud for the orchestrator and the chain.
  const dots = Array.from({ length: 64 }, (_, i) => {
    const a = i * 2.399963;
    const r = WHEEL.core * 0.7 * Math.sqrt(i / 64);
    return `<circle class="at-core-dot" cx="${(WHEEL.cx + Math.cos(a) * r).toFixed(1)}" cy="${(WHEEL.cy + Math.sin(a) * r).toFixed(1)}" r="${(1.7 - i / 64).toFixed(2)}"/>`;
  }).join('');
  const hs = harmony?.score ?? 0;
  const ringCaption = (r, text, id) => `<defs><path id="${id}" d="M ${(WHEEL.cx - r).toFixed(1)} ${WHEEL.cy} A ${r} ${r} 0 1 1 ${(WHEEL.cx + r).toFixed(1)} ${WHEEL.cy}"/></defs>
    <text class="at-ring-caption"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text>`;

  return `<svg aria-hidden="true" focusable="false" class="atlas-svg wheel" viewBox="40 -34 1720 1250" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="The whole company as two rings around one core — the AI core inside, the enterprise core outside, and every declared tunnel between them">
    ${ringCaption(WHEEL.r1[0] - 26, t('CORE 1 — THINKS AND ACTS'), 'cap1')}
    ${ringCaption(WHEEL.r2[0] - 30, t('CORE 2 — RECORDS THE TRUTH'), 'cap2')}
    <circle class="at-ring-guide" cx="${WHEEL.cx}" cy="${WHEEL.cy}" r="${WHEEL.r1[0] - 8}"/>
    <circle class="at-ring-guide" cx="${WHEEL.cx}" cy="${WHEEL.cy}" r="${WHEEL.r2[0] - 8}"/>
    ${chords}
    ${inner}
    ${outer}
    <g class="at-core">
      <circle class="at-core-ring" cx="${WHEEL.cx}" cy="${WHEEL.cy}" r="${WHEEL.core}"/>
      ${dots}
      <text class="at-core-label" x="${WHEEL.cx}" y="${WHEEL.cy + WHEEL.core + 20}">${esc(t('HARMONY'))} ${hs}%</text>
    </g>
    <text class="at-foot" x="56" y="1204">${sections.length} ${esc(t('DEPARTMENTS'))} · ${core1.length + core2.length} ${esc(t('DISTRICTS'))} · ${tunnels.length} ${esc(t('TUNNELS'))} · ${connAudit.wired}/${connAudit.sections} ${esc(t('wired'))}${flow ? ` · ${flow.rounds} ${esc(t('ROUNDS RUN'))}` : ''}</text>
  </svg>`;
}

/**
 * One district, as a wheel of its own: the departments round the rim with a
 * glyph and a name each, every declared relationship between them drawn as a
 * chord, and the districts it reaches drawn as a ring of doors outside — so
 * the picture answers "what is in here" and "what does it touch" at once.
 */
function buildAtlasNear(map, divId) {
  const { divisions, sections, edges } = map;
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const ent = (map.core2Divisions || []).find((d) => d.id === divId);
  const div = ent || divisions.find((d) => d.id === divId) || divisions[0];
  const items = ent ? ent.departments.map((id) => byId[id]).filter(Boolean) : sections.filter((s) => s.division === div.id && s.id !== 'harmony');
  const label = ent ? t(div.label) : divisionName(div.id, div.label);
  const W = 1600, H = 1120;
  const cx = W / 2, cy = 600;
  const R = Math.min(300, 140 + items.length * 13);
  const mine = new Set(items.map((x) => x.id));
  const pos = {};
  const nodes = items.map((sec, i) => {
    const a = -Math.PI / 2 + (TAU * i) / Math.max(1, items.length);
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    pos[sec.id] = { x, y, a };
    const live = sec.count > 0;
    const name = sectionName(sec.id, sec.label);
    const lb = { x: cx + Math.cos(a) * (R + 34), y: cy + Math.sin(a) * (R + 34) };
    const anchor = sideAnchor(Math.cos(a));
    return `<a class="at-node ${live ? '' : 'hollow'}" href="${sec.href}" data-node="${esc(sec.id)}" aria-label="${esc(name)}"
        data-color="${div.color}" data-label="${esc(name)}" data-hint="${esc(sec.hint || '')}" data-count="${sec.count}" data-div="${esc(div.id)}">
        <circle class="at-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="24"/>
        ${live ? `<circle class="at-chip" data-dept="${esc(sec.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18"/>` : `<circle class="at-chip-ring" data-dept="${esc(sec.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18"/>`}
        <g class="at-chip-glyph" style="color:${live ? 'var(--paper)' : 'var(--ink)'};fill:${live ? 'var(--paper)' : 'var(--ink)'}" transform="translate(${(x - 9).toFixed(1)}, ${(y - 9).toFixed(1)})">${NODE_GLYPH[glyphFor(sec.id)]}</g>
        <text class="at-nlabel on" x="${lb.x.toFixed(1)}" y="${(lb.y + 4).toFixed(1)}" style="text-anchor:${anchor}">${esc(short(name, 26))}<tspan class="at-nlabel-n" dx="6">${live ? sec.count : ''}</tspan></text>
        <title>${esc(name)} · ${live ? `${sec.count} ${t('records')}` : t('empty')}</title>
      </a>`;
  }).join('');

  // Chords: every declared relationship with both ends in this district.
  const inside = edges.map((e, i) => ({ ...e, i })).filter((e) => mine.has(e.from) && mine.has(e.to) && e.from !== e.to);
  const chords = inside.map((e) => {
    const a = pos[e.from], b = pos[e.to];
    return `<path class="cx-edge${e.count > 0 ? '' : ' dormant'}" data-a="${esc(e.from)}" data-b="${esc(e.to)}" data-i="${e.i}"
      d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx} ${cy} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"><title>${esc(e.from)} → ${esc(e.to)}: ${esc(t(e.label || ''))} · ${e.count}</title></path>`;
  }).join('');

  // The doors out: every other district this one is joined to, as a ring of
  // pills placed at the angle of the department that touches it most.
  const allDivs = [...divisions.map((d) => ({ ...d, kind: 'ai' })), ...(map.core2Divisions || []).map((d) => ({ ...d, kind: 'enterprise' }))];
  const divOf = (id) => byId[id] ? ((map.core2Divisions || []).find((d) => d.departments.includes(id))?.id || byId[id].division) : null;
  const outward = {};
  for (const e of edges) {
    if (e.from === 'all' || e.to === 'all') continue;
    const inA = mine.has(e.from), inB = mine.has(e.to);
    if (inA === inB) continue;
    const here = inA ? e.from : e.to; const there = divOf(inA ? e.to : e.from);
    if (!there || there === div.id) continue;
    outward[there] = outward[there] || { n: 0, angles: [] };
    outward[there].n += 1; outward[there].angles.push(pos[here]?.a ?? 0);
  }
  const doors = Object.entries(outward).map(([id, o]) => {
    const d = allDivs.find((x) => x.id === id); if (!d) return '';
    const x0 = o.angles.reduce((n, a) => n + Math.cos(a), 0), y0 = o.angles.reduce((n, a) => n + Math.sin(a), 0);
    const a = Math.atan2(y0, x0);
    const rr = R + 128;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const name = d.kind === 'enterprise' ? t(d.label) : divisionName(d.id, d.label);
    return `<g class="at-door" data-district="${esc(d.id)}" style="color:${d.color}">
      <rect class="at-hit" x="${(x - 62).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="124" height="26" rx="13"/>
      <text class="at-dname" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${esc(short(name, 16))}<tspan class="at-door-n" dx="6">${o.n}</tspan></text>
    </g>`;
  }).join('');

  const total = items.reduce((a, x) => a + x.count, 0);
  return `<svg aria-hidden="true" focusable="false" class="atlas-svg wheel near" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="${esc(label)} — its departments and how they connect" style="color:${div.color}">
    <text class="at-ghost" x="${cx}" y="${(cy - R - 158).toFixed(0)}" style="font-size:${ent ? 84 : 118}px">${esc(label)}</text>
    <circle class="at-ring-guide" cx="${cx}" cy="${cy}" r="${R}"/>
    ${chords}
    ${doors}
    ${nodes}
    <text class="at-dname" x="${cx}" y="${(cy - 6).toFixed(1)}" style="fill:${div.color}">${esc(label)}</text>
    <text class="at-dsub" x="${cx}" y="${(cy + 14).toFixed(1)}">${items.length} ${esc(t('sections'))} · ${total} ${esc(t('records'))} · ${inside.length} ${esc(t('relationships'))}</text>
    <g class="at-stepper">
      <path class="at-step" d="M 56 ${cy} l -12 10 l 12 10"/>
      <rect class="at-step-hit" data-step="-1" x="24" y="${cy - 28}" width="64" height="66"/>
      <path class="at-step" d="M ${W - 56} ${cy} l 12 10 l -12 10"/>
      <rect class="at-step-hit" data-step="1" x="${W - 88}" y="${cy - 28}" width="64" height="66"/>
    </g>
  </svg>`;
}
/** The map, at whichever depth you are standing. */
export function buildMap(m, { far = false } = {}) {
  const known = m.divisions.some((d) => d.id === atlasZoom) || (m.core2Divisions || []).some((d) => d.id === atlasZoom);
  if (atlasZoom && !known) atlasZoom = null;
  // The seam page always wants the whole company: the district close-up draws
  // no tunnels at all, so opening it while the atlas page happened to be zoomed
  // into TALENT would show a map with nothing across the seam on it. `far`
  // overrides for this render without disturbing the other page's zoom.
  const into = far ? null : atlasZoom;
  if (atlasState.style !== (into || 'far')) {
    atlasState.style = into || 'far';
    atlasState.vb = null; atlasState.sel = null; atlasState.traceFrom = null; atlasState.divSel = null;
  }
  return into ? buildAtlasNear(m, into) : buildAtlasFar(m);
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
  const ids = [...(CATALOG.divisions || []), ...(CATALOG.enterprise?.divisions || [])].map((d) => d.id);
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
  // Under the seam lens the tunnels are the subject rather than background, so
  // they brighten with the departments they join instead of staying hairlines.
  svg.querySelectorAll('.at-tunnel').forEach((p) => {
    p.classList.toggle('at-tunnel-lit', lens === 'seam' && !term);
  });
  // The districts fade with their leaves, so the eye is not pulled to a label
  // whose departments are all dark.
  svg.querySelectorAll('.at-district').forEach((d) => {
    const any = [...d.querySelectorAll('[data-dept]')].some((n) => !n.classList.contains('at-dim'));
    d.classList.toggle('at-district-dim', !any && (Boolean(term) || Boolean(counts)));
  });
  return lit;
}

export function initAtlas(map, { lens: openLens = 'all' } = {}) {
  const svg = view.querySelector('svg.atlas-svg');
  if (!svg) return;
  const panel = svg.closest('.panel');
  panel.style.position = 'relative';
  let tip = panel.querySelector('#map-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'map-tip'; tip.hidden = true; panel.appendChild(tip); }
  // ---- the lenses ----------------------------------------------------
  // The seam is a lens like the others, and it is computed here rather than
  // fetched: it is exactly the endpoints of the declared tunnels, the same
  // edges the connectivity audit checks and the same ones drawn on the canvas.
  // A department cannot light up under it without a tunnel actually existing,
  // which is the whole reason #/map2 can be this map instead of a second one.
  const seam = {};
  const tunnels = (map.core2 || {}).tunnels || [];
  for (const tn of tunnels) {
    seam[tn.core2End] = (seam[tn.core2End] || 0) + 1;
    seam[tn.core1End] = (seam[tn.core1End] || 0) + 1;
  }
  let lensState = { seam, totals: { seam: tunnels.length } };
  let lens = openLens;
  let term = '';
  const bar = document.createElement('div');
  bar.className = 'map-lens';
  const onIf = (k) => (lens === k ? ' class="on"' : '');
  bar.innerHTML = `
    <div class="ml-buttons" role="group" aria-label="${esc(t('Light the map by'))}">
      <button data-lens="all"${onIf('all')}>${esc(t('Everything'))}</button>
      <button data-lens="seam"${onIf('seam')}>${esc(t('Across the seam'))} <span class="ml-n" data-n="seam">${tunnels.length || ''}</span></button>
      <button data-lens="waiting"${onIf('waiting')}>${esc(t('Waiting on a person'))} <span class="ml-n" data-n="waiting"></span></button>
      <button data-lens="failing"${onIf('failing')}>${esc(t('Failing'))} <span class="ml-n" data-n="failing"></span></button>
      <button data-lens="active"${onIf('active')}>${esc(t('Moved today'))} <span class="ml-n" data-n="active"></span></button>
    </div>
    <input class="ml-find" type="search" placeholder="${esc(t('find a department'))}" aria-label="${esc(t('Find a department on the map'))}">
    <span class="ml-said"></span>`;
  panel.appendChild(bar);

  const said = bar.querySelector('.ml-said');
  const paint = () => {
    const lit = applyLens(svg, lensState, lens, term.trim().toLowerCase());
    if (term) said.textContent = `${lit} ${t('match')}`;
    else if (lens === 'all') said.textContent = '';
    else if (lens === 'seam') {
      // Tunnels, not items: saying "38 items" about a seam would be a number
      // that counts nothing anybody can go and look at.
      said.textContent = lit
        ? `${lit} ${t('department(s)')} · ${tunnels.length} ${t('tunnel(s)')}`
        : t('no tunnel is declared across the seam yet');
    } else {
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
  // The seam is already known from the drawing, so a map opened on it is lit
  // before this returns — and stays lit if it never does.
  if (lens !== 'all') paint();
  api('/api/map/state').then((st) => {
    lensState = { ...st, seam, totals: { ...(st.totals || {}), seam: tunnels.length } };
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
