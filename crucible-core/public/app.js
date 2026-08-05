// Crucible Core console — vanilla SPA, hash routing, 5s polling on live pages.
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const money = (n) => '$' + Number(n || 0).toFixed(n >= 100 ? 0 : 2);
const money4 = (n) => '$' + Number(n || 0).toFixed(4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One deep-link map for the whole company — every subject type knows its home.
const linkFor = (type, id) => ({
  run: '#/runs', pipeline: '#/pipelines', decision: `#/decisions/${id}`, agent: '#/agents',
  ticket: '#/support', incident: '#/incidents', product: '#/products', ritual: '#/governance',
  budget: '#/budgets', artifact: '#/artifacts', audit: '#/audit',
  campaign: '#/marketing', customer: '#/customers', contract: '#/legal', vendor: '#/vendors',
  person: '#/people', memory: '#/knowledge', objective: '#/objectives',
  intelQuery: '#/intel', intelRecord: '#/intel', segment: '#/segments', dataset: '#/data', archiveItem: '#/archive',
  project: '#/projects', task: '#/tasks', risk: '#/risks', quality: '#/quality', user: '#/users', settings: '#/settings',
}[type] || null);
const short = (s, n = 80) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };

// ---------- auth ----------
const TOKEN_KEY = 'crucible-token';
let currentUser = null;
const actor = () => (currentUser ? `human:${currentUser.username}` : 'human:unknown');
const hasPermC = (p) => currentUser && (currentUser.role === 'superadmin' || currentUser.perms.includes('*') || currentUser.perms.includes(p));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', 'x-auth-token': localStorage.getItem(TOKEN_KEY) || '' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) showLogin();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function showLogin() {
  const el = $('#login');
  if (!el.hidden) return;
  el.hidden = false;
  $('#login-user').focus();
}

$('#login-go').addEventListener('click', doLogin);
$('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  $('#login-err').textContent = '';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { username: $('#login-user').value, password: $('#login-pass').value } });
    localStorage.setItem(TOKEN_KEY, r.token);
    location.reload();
  } catch (e) { $('#login-err').textContent = e.message; }
}

$('#logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* session gone anyway */ }
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

// Route → the permission that unlocks its page.
const navPerm = {
  '': 'dashboard.view', governance: 'governance.view', gate: 'runs.view', decisions: 'decisions.view',
  decision: 'decisions.view', products: 'products.view', pipelines: 'pipelines.view', runs: 'runs.view',
  artifacts: 'archive.view', projects: 'projects.view', tasks: 'tasks.view', risks: 'risks.view',
  quality: 'quality.view', incidents: 'incidents.view', support: 'support.view', intel: 'intel.view',
  segments: 'segments.view', data: 'datasets.view', archive: 'archive.view', marketing: 'marketing.view',
  customers: 'customers.view', finance: 'finance.view', people: 'people.view', legal: 'legal.view',
  vendors: 'vendors.view', knowledge: 'knowledge.view', objectives: 'objectives.view', evals: 'evals.view',
  agents: 'agents.view', budgets: 'budgets.view', audit: 'audit.view', providers: 'providers.view',
  oversight: 'oversight.view', users: 'users.manage', settings: 'settings.manage',
};

function applyNavGating() {
  document.querySelectorAll('#nav a').forEach((a) => {
    const perm = navPerm[a.dataset.route];
    a.style.display = perm && !hasPermC(perm) ? 'none' : '';
  });
  document.querySelectorAll('#nav .nav-sec').forEach((sec) => {
    let el = sec.nextElementSibling, any = false;
    while (el && !el.classList.contains('nav-sec')) { if (el.style.display !== 'none') any = true; el = el.nextElementSibling; }
    sec.style.display = any ? '' : 'none';
  });
}

function toast(msg, isErr = false) {
  let host = $('#toast');
  if (!host) { host = document.createElement('div'); host.id = 'toast'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- shell status ----------
async function refreshShell() {
  try {
    const [health, chain, stats, notif] = await Promise.all([
      api('/api/health'), api('/api/audit/verify'), api('/api/stats'), api('/api/notifications?unread=1'),
    ]);
    $('#alert-count').textContent = notif.unread || '';
    const mode = $('#mode-chip');
    mode.textContent = health.mockMode ? 'MOCK MODE' : 'LIVE';
    mode.className = 'chip ' + (health.mockMode ? 'chip-warn' : 'chip-ok');
    const cc = $('#chain-chip');
    cc.textContent = chain.ok ? `chain ✓ ${chain.checked}` : `chain BROKEN @${chain.brokenAt}`;
    cc.className = 'chip ' + (chain.ok ? 'chip-ok' : 'chip-bad');
    $('#gate-count').textContent = stats.awaitingHuman || '';
  } catch { /* server restarting */ }
}
setInterval(refreshShell, 7000);
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-GB'); }, 1000);

// ---------- router ----------
let pollTimer = null;
const routes = {
  '': { title: 'Overview', render: renderOverview, poll: 5000 },
  gate: { title: 'Human Gate', render: renderGate, poll: 5000 },
  pipelines: { title: 'Pipelines', render: renderPipelines, poll: 4000 },
  runs: { title: 'Runs', render: renderRuns, poll: 6000 },
  artifacts: { title: 'Artifacts', render: renderArtifacts },
  products: { title: 'Product Factory', render: renderProducts },
  incidents: { title: 'Incidents', render: renderIncidents, poll: 6000 },
  support: { title: 'Support Desk', render: renderSupport, poll: 5000 },
  evals: { title: 'Evals & Canaries', render: renderEvals },
  governance: { title: 'Governance', render: renderGovernance, poll: 10000 },
  marketing: { title: 'Marketing', render: renderMarketing, poll: 6000 },
  customers: { title: 'Customers', render: renderCustomers },
  people: { title: 'People (HR)', render: renderPeople },
  legal: { title: 'Legal & Compliance', render: renderLegal },
  vendors: { title: 'Vendors', render: renderVendors },
  knowledge: { title: 'Knowledge', render: renderKnowledge },
  objectives: { title: 'Objectives (OKRs)', render: renderObjectives },
  intel: { title: 'Intelligence', render: renderIntel, poll: 6000 },
  segments: { title: 'Segments', render: renderSegments },
  data: { title: 'Datasets', render: renderDatasets, poll: 6000 },
  archive: { title: 'Archive', render: renderArchive },
  projects: { title: 'Projects', render: renderProjects },
  tasks: { title: 'Task Tracker', render: renderTasksPage, poll: 6000 },
  risks: { title: 'Risk Register', render: renderRisks },
  quality: { title: 'Quality', render: renderQuality },
  finance: { title: 'Finance', render: renderFinance },
  oversight: { title: 'Oversight', render: renderOversight, poll: 10000 },
  users: { title: 'Users & Roles', render: renderUsers },
  settings: { title: 'Settings', render: renderSettings },
  decisions: { title: 'Decisions', render: renderDecisions },
  decision: { title: 'Decision', render: renderDecisionDetail },
  agents: { title: 'Agents', render: renderAgents },
  budgets: { title: 'Budgets', render: renderBudgets, poll: 8000 },
  audit: { title: 'Audit Chain', render: renderAudit, poll: 8000 },
  providers: { title: 'Providers', render: renderProviders },
};

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = hash.split('/');
  if (seg === 'decisions' && arg) return { key: 'decision', arg };
  if (seg === 'artifacts' && arg) return { key: 'artifacts', arg: decodeURIComponent(arg) };
  return { key: routes[seg] ? seg : '', arg: null };
}

async function navigate() {
  clearInterval(pollTimer);
  if (!currentUser) return;
  const { key, arg } = currentRoute();
  const r = routes[key];
  $('#page-title').textContent = r.title;
  const perm = navPerm[key];
  if (perm && !hasPermC(perm)) {
    view.innerHTML = `<div class="panel"><div class="empty">You need the <span class="mono" style="color:var(--warn)">${esc(perm)}</span> permission for this section — ask the superadmin.</div></div>`;
    return;
  }
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (key === 'decision' ? 'decisions' : key));
  });
  view.innerHTML = '<div class="empty">Loading…</div>';
  try { await r.render(arg); } catch (e) { view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
  if (r.poll) pollTimer = setInterval(() => r.render(arg).catch(() => {}), r.poll);
}
window.addEventListener('hashchange', navigate);

// ---------- system map ----------
const mapNode = ({ x, y, w, h, href, title, value, cls = '' }) => `
  <a href="${href}"><g class="map-node ${cls}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    <text class="mt" x="${x + 12}" y="${y + 22}">${title}</text>
    ${value ? `<text class="mv" x="${x + 12}" y="${y + h - 12}">${value}</text>` : ''}
  </g></a>`;

const mapChip = ({ x, y, w, h, href, title, value, dot = null }) => `
  <a href="${href}"><g class="map-node">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>
    ${dot !== null ? `<circle cx="${x + 12}" cy="${y + h / 2}" r="3.5" fill="${dot ? 'var(--ok)' : 'var(--ink-faint)'}"/>` : ''}
    <text class="mt small" x="${x + (dot !== null ? 22 : 12)}" y="${y + h / 2 + 4}">${title}</text>
    ${value ? `<text class="mv" x="${x + w - 10}" y="${y + h / 2 + 4}" text-anchor="end">${value}</text>` : ''}
  </g></a>`;

const mapEdge = (d, { label = '', lx = 0, ly = 0, dashed = false, anchor = 'middle' } = {}) => `
  <path class="map-edge${dashed ? ' dashed' : ''}" d="${d}" ${dashed ? '' : 'marker-end="url(#arr)"'}/>
  ${label ? `<text class="me" x="${lx}" y="${ly}" text-anchor="${anchor}">${label}</text>` : ''}`;

// ---------- system map · orbital design ----------
// The crucible at the center: the audit chain is the core every section
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

// ---------- system map · metro design ----------
// Six colored lines — every line terminates at the AUDIT CHAIN interchange,
// because every department's actions end up on the record.
function buildSystemMap(s, prov, agentsList, chain, extra = {}) {
  const queue = s.queue || {};
  const active = (queue.queued || 0) + (queue.leased || 0) + (queue.running || 0);
  const done = queue.done || 0;
  const decTotal = Object.values(s.decisions || {}).reduce((a, b) => a + b, 0);
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100).toFixed(1);
  const online = prov.providers.filter((p) => p.name !== 'mock' && p.available).length;

  const L = [
    { label: 'EXECUTE', color: '#ff6b2c', y: 90, st: [
      ['#/agents', 'AGENTS', `${agentsList.length} roles`],
      ['#/runs', 'RUN QUEUE', `${active} · ${done} done`],
      ['#/providers', 'ROUTER', s.mockMode ? 'MOCK' : 'LIVE'],
      ['#/providers', 'PROVIDERS', `${online}/5 online`],
      ['#/pipelines', 'PIPELINES', 'FORGE chains'],
      ['#/artifacts', 'ARTIFACTS', `${extra.artifactsCount ?? 0} files`],
    ] },
    { label: 'DECIDE', color: '#5ec3c9', y: 180, st: [
      ['#/gate', 'HUMAN GATE', `${s.awaitingHuman} waiting`],
      ['#/budgets', 'POLICY', `${monthPct}% of cap`],
      ['#/decisions', 'TRIBUNAL', 'critics · judge'],
      ['#/decisions', 'REGISTRY', `${decTotal} cases`],
      ['#/products', 'PRODUCTS', `${extra.productsTotal ?? 0} · ${extra.liveProducts ?? 0} live`],
      ['#/objectives', 'OBJECTIVES', `${extra.objectivesActive ?? 0} OKRs`],
    ] },
    { label: 'PLAN', color: '#ffb020', y: 270, st: [
      ['#/tasks', 'TASKS', `${extra.openTasks ?? 0} open`],
      ['#/projects', 'PROJECTS', `${extra.activeProjects ?? 0} active`],
      ['#/quality', 'QUALITY', extra.evalAvg != null ? `${Math.round(extra.evalAvg * 100)}% evals` : 'reviews'],
      ['#/risks', 'RISKS', `${extra.openRisks ?? 0} open`],
      ['#/incidents', 'INCIDENTS', `${extra.openIncidents ?? 0} open`],
      ['#/support', 'SUPPORT', `${extra.openTickets ?? 0} open`],
    ] },
    { label: 'DATA', color: '#78bf6d', y: 360, st: [
      ['#/intel', 'INTEL', 'collect → CRM'],
      ['#/segments', 'SEGMENTS', 'targeting'],
      ['#/data', 'DATASETS', 'clean · extract'],
      ['#/archive', 'ARCHIVE', `${extra.archiveCount ?? 0} items`],
      ['#/knowledge', 'KNOWLEDGE', `${extra.knowledgeCount ?? 0} entries`],
      ['#/evals', 'EVALS', 'canaries'],
    ] },
    { label: 'BUSINESS', color: '#e5533d', y: 450, st: [
      ['#/people', 'PEOPLE', `${extra.peopleCount ?? 0} humans`],
      ['#/legal', 'LEGAL', `${extra.contractsCount ?? 0} docs`],
      ['#/vendors', 'VENDORS', `${extra.vendorsActive ?? 0} active`],
      ['#/marketing', 'MARKETING', `${extra.campaignsLive ?? 0} live`],
      ['#/customers', 'CUSTOMERS', `$${(extra.mrr ?? 0).toFixed(0)} MRR`],
      ['#/finance', 'FINANCE', 'MRR · CAC · burn'],
    ] },
    { label: 'GOVERN', color: '#948b7d', y: 540, st: [
      ['#/governance', 'GOVERNANCE', `${extra.unread ?? 0} alerts`],
      ['#/oversight', 'OVERSIGHT', 'approvals ledger'],
      ['#/users', 'USERS', 'RBAC'],
      ['#/settings', 'SETTINGS', 'providers'],
    ] },
  ];
  const X0 = 95, DX = 138, TX = 913, TY = 315;

  const lines = L.map((l) => `<path class="m-line" stroke="${l.color}" d="M 62 ${l.y} H 845 L ${TX - 6} ${TY}"/>`).join('');
  const labels = L.map((l) => `<text class="m-lbl" x="54" y="${l.y + 3}" fill="${l.color}">${l.label}</text>`).join('');
  const stations = L.map((l) => l.st.map((st, i) => {
    const x = X0 + i * DX;
    return `<a href="${st[0]}"><g class="m-station" style="color:${l.color}">
      <circle cx="${x}" cy="${l.y}" r="6.5" stroke="${l.color}"/>
      <text class="m-name" x="${x}" y="${l.y - 14}">${st[1]}</text>
      <text class="m-val" x="${x}" y="${l.y + 22}">${st[2]}</text>
    </g></a>`;
  }).join('')).join('');

  return `<svg class="metro" viewBox="0 0 1000 615" role="img" aria-label="System metro map — every line terminates at the audit chain">
  ${lines}${labels}${stations}
  <a href="#/audit"><g class="m-term">
    <circle cx="${TX}" cy="${TY}" r="34" stroke="${chain.ok ? 'var(--ok)' : 'var(--bad)'}" stroke-width="2.5"/>
    <text class="core-glyph" x="${TX}" y="${TY - 2}" text-anchor="middle">▲</text>
    <text class="m-name" x="${TX}" y="${TY + 16}">AUDIT</text>
    <text class="m-val" x="${TX}" y="${TY + 56}">${chain.checked} entries · ${chain.ok ? 'intact' : 'BROKEN'}</text>
  </g></a>
</svg>`;
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

  return `<svg class="sysmap" viewBox="0 0 1000 655" role="img" aria-label="System map — the company in orbit around its audit chain">
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

function buildSystemMapLegacy(s, prov, agentsList, chain, extra = {}) {
  const queue = s.queue || {};
  const active = (queue.queued || 0) + (queue.leased || 0) + (queue.running || 0);
  const done = queue.done || 0;
  const decTotal = Object.values(s.decisions || {}).reduce((a, b) => a + b, 0);
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100).toFixed(1);
  const groups = [['discover', 'DISCOVER'], ['build', 'BUILD'], ['assure', 'ASSURE'], ['run', 'RUN'], ['steer', 'STEER']];
  const provNames = { anthropic: 'CLAUDE API', 'claude-subscription': 'CLAUDE SUB', openai: 'OPENAI', deepseek: 'DEEPSEEK', google: 'GEMINI' };
  const provRows = prov.providers.filter((p) => p.name !== 'mock');

  return `<svg class="sysmap" viewBox="0 0 1000 570" role="img" aria-label="System map — relations between the platform sections">
  <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--ink-faint)"/></marker></defs>

  <rect class="map-group" x="15" y="40" width="150" height="250" rx="5"/>
  <text class="mg" x="27" y="60">AGENTS ×${agentsList.length}</text>
  ${groups.map(([g, label], i) => mapChip({
    x: 27, y: 72 + i * 42, w: 126, h: 30, href: '#/agents',
    title: label, value: String(agentsList.filter((a) => a.role_group === g).length),
  })).join('')}

  ${mapNode({ x: 240, y: 40, w: 170, h: 60, href: '#/gate', title: 'HUMAN GATE', value: `${s.awaitingHuman} awaiting`, cls: 'warn' })}
  ${mapNode({ x: 240, y: 150, w: 170, h: 80, href: '#/runs', title: 'RUN QUEUE', value: `${active} active · ${done} done` })}
  ${mapNode({ x: 480, y: 40, w: 190, h: 60, href: '#/budgets', title: 'POLICY · BUDGETS', value: `${monthPct}% of monthly cap`, cls: 'ember' })}
  ${mapNode({ x: 480, y: 160, w: 190, h: 70, href: '#/providers', title: 'MODEL ROUTER', value: `${s.mockMode ? 'MOCK' : 'LIVE'} · T1–T4 chains`, cls: 'steel' })}

  <rect class="map-group" x="760" y="40" width="220" height="250" rx="5"/>
  <text class="mg" x="772" y="60">PROVIDERS</text>
  ${provRows.map((p, i) => mapChip({
    x: 772, y: 72 + i * 42, w: 196, h: 30, href: '#/providers',
    title: provNames[p.name] || p.name.toUpperCase(), value: p.available ? 'online' : 'no key', dot: p.available,
  })).join('')}

  ${mapNode({ x: 300, y: 330, w: 170, h: 64, href: '#/decisions', title: 'MINI-TRIBUNAL', value: 'governance pool · critics' })}
  ${mapNode({ x: 560, y: 330, w: 190, h: 64, href: '#/decisions', title: 'DECISION REGISTRY', value: `${decTotal} cases · humans decide` })}
  ${mapNode({ x: 15, y: 505, w: 965, h: 52, href: '#/audit', title: 'AUDIT CHAIN — APPEND-ONLY', value: `${chain.checked} entries · ${chain.ok ? 'intact' : 'BROKEN'}`, cls: chain.ok ? 'ok' : 'bad' })}

  ${mapEdge('M165 185 L236 185', { label: 'instantiate', lx: 200, ly: 178 })}
  ${mapEdge('M352 148 L352 104', { label: 'escalate', lx: 360, ly: 128, anchor: 'start' })}
  ${mapEdge('M298 104 L298 148', { label: 'resolve', lx: 290, ly: 128, anchor: 'end' })}
  ${mapEdge('M412 195 L476 195', { label: 'model call', lx: 444, ly: 188 })}
  ${mapEdge('M575 102 L575 156', { label: 'reserve first', lx: 583, ly: 133, anchor: 'start' })}
  ${mapEdge('M672 195 L756 195', { label: 'tier chain', lx: 714, ly: 188 })}
  ${mapEdge('M556 348 L474 348', { label: 'opens case', lx: 515, ly: 341 })}
  ${mapEdge('M472 376 L556 376', { label: 'recommends', lx: 515, ly: 391 })}
  ${mapEdge('M270 232 L270 503', { dashed: true })}
  ${mapEdge('M490 232 L490 503', { dashed: true })}
  ${mapEdge('M385 396 L385 503', { dashed: true })}
  ${mapEdge('M655 396 L655 503', { dashed: true })}
  ${mapEdge('M870 292 L870 503', { dashed: true })}
  ${mapEdge('M115 490 L115 503', { dashed: true })}
  ${mapEdge('M325 490 L325 503', { dashed: true })}
  ${mapEdge('M520 490 L520 503', { dashed: true })}
  ${mapEdge('M720 490 L720 503', { dashed: true })}
  ${mapEdge('M907 490 L907 503', { dashed: true })}
  ${mapEdge('M435 460 L412 460', { label: 'raise', lx: 423, ly: 450 })}
  ${mapEdge('M240 460 L217 460', { label: 'product', lx: 228, ly: 450 })}
  ${mapEdge('M115 428 C 115 405 560 428 638 398', { label: 'gate records', lx: 300, ly: 416, anchor: 'start' })}

  ${mapNode({ x: 15, y: 430, w: 200, h: 60, href: '#/products', title: 'PRODUCT FACTORY', value: `${extra.productsTotal ?? 0} products · ${extra.liveProducts ?? 0} live · pipelines ↑`, cls: 'ember' })}
  ${mapNode({ x: 240, y: 430, w: 170, h: 60, href: '#/incidents', title: 'INCIDENTS', value: `${extra.openIncidents ?? 0} open · postmortem → pipeline`, cls: extra.openIncidents ? 'bad' : '' })}
  ${mapNode({ x: 435, y: 430, w: 170, h: 60, href: '#/support', title: 'SUPPORT DESK', value: `${extra.openTickets ?? 0} open · human sends`, cls: extra.openTickets ? 'warn' : '' })}
  ${mapNode({ x: 630, y: 430, w: 180, h: 60, href: '#/evals', title: 'EVALS · CANARIES', value: `${extra.evalSets ?? 0} sets · reputation → agents`, cls: 'steel' })}
  ${mapNode({ x: 835, y: 430, w: 145, h: 60, href: '#/governance', title: 'GOVERNANCE', value: `${extra.unread ?? 0} alerts · ${extra.overdueRituals ?? 0} overdue`, cls: extra.unread ? 'warn' : 'ok' })}
</svg>`;
}

// ---------- pages ----------
async function renderOverview() {
  // Every side-fetch degrades gracefully: a user with a narrow permission set
  // still gets the overview, with dashes where they lack access.
  const safe = (p, d) => api(p).catch(() => d);
  const [s, prov, agentsList, chain, products, incidents, tickets, rituals, notif, artifacts,
    campaigns, customers, people, contracts, vendors, objectives, knowledge,
    archiveItems, tasksList, projectsList, risksList, qualityDash] = await Promise.all([
    api('/api/stats'), safe('/api/providers', { providers: [] }), safe('/api/agents', []), api('/api/audit/verify'),
    safe('/api/products', []), safe('/api/incidents', []), safe('/api/tickets', []), safe('/api/rituals', []), api('/api/notifications?unread=1'),
    safe('/api/artifacts', []),
    safe('/api/campaigns', []), safe('/api/customers', { stats: { mrr: 0 }, items: [] }), safe('/api/people', []), safe('/api/contracts', []),
    safe('/api/vendors', []), safe('/api/objectives', []), safe('/api/knowledge', []),
    safe('/api/archive', []), safe('/api/tasks', []), safe('/api/projects', []), safe('/api/risks', []), safe('/api/quality', null),
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

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">System map — how the sections relate</div>
    ${buildSystemMap(s, prov, agentsList, chain, extra)}
    <div class="map-legend">six lines, one interchange — every department's line terminates at the audit chain · click any station to open its section</div>
  </div>

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
      <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily spend sparkline">
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
  </div>`;
}

async function renderGate() {
  const runs = await api('/api/runs?state=awaiting_human');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Runs awaiting a human — this queue is the founders' work list</div>
    ${runs.length ? '' : '<div class="empty">Nothing waiting. The machine is either idle or confident.</div>'}
    ${runs.map((r) => `
      <div class="round">
        <div class="round-body">
          <div class="agent-head">
            <div>
              <span class="mono">${esc(r.agent_id)}</span> · <span class="mono" style="color:var(--ink-faint)">${esc(r.task_type)}</span>
              <span class="state state-awaiting_human">awaiting_human</span>
            </div>
            <div>
              <button class="btn btn-ok btn-sm" data-resolve="approved" data-id="${esc(r.id)}">Approve</button>
              <button class="btn btn-bad btn-sm" data-resolve="rejected" data-id="${esc(r.id)}">Reject</button>
            </div>
          </div>
          <div class="reason" style="margin:6px 0">${esc(r.failure_reason || '')}</div>
          ${r.output ? `<pre class="json">${esc(JSON.stringify(r.output.parsed ?? r.output, null, 2).slice(0, 1200))}</pre>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
  view.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/runs/${b.dataset.id}/resolve`, { method: 'POST', body: { verdict: b.dataset.resolve, actor: actor() } });
      toast(`Run ${b.dataset.resolve} by ${actor()}`);
      renderGate(); refreshShell();
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderRuns() {
  const stateSel = view.dataset.runState || '';
  const [runs, agents] = await Promise.all([
    api('/api/runs' + (stateSel ? `?state=${stateSel}` : '')),
    api('/api/agents'),
  ]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Enqueue a run</div>
    <div class="form-inline">
      <div><label class="fl">Agent</label>
        <select id="run-agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Task type</label><input type="text" id="run-type" value="task"></div>
      <button class="btn btn-primary" id="run-go">Enqueue</button>
    </div>
    <div><label class="fl">Prompt</label><textarea id="run-prompt" placeholder="What should the agent do?"></textarea></div>
  </div>
  <div class="panel">
    <div class="panel-title"><span>Recent runs</span>
      <select id="run-filter" style="width:auto">
        ${['', 'queued', 'running', 'awaiting_human', 'done', 'failed'].map((s) => `<option value="${s}" ${s === stateSel ? 'selected' : ''}>${s || 'all states'}</option>`).join('')}
      </select>
    </div>
    <table>
      <thead><tr><th>Agent</th><th>Task</th><th>State</th><th>Flags</th><th class="num">Cost</th><th>Created</th></tr></thead>
      <tbody>
        ${runs.map((r) => `
        <tr class="rowlink" data-run="${esc(r.id)}">
          <td class="mono">${esc(r.agent_id)}</td>
          <td>${esc(short(r.input?.prompt || r.task_type, 60))}</td>
          <td><span class="state state-${esc(r.state)}">${esc(r.state)}</span></td>
          <td class="mono">${(r.flags || []).map((f) => `<span class="chip chip-ember">${esc(f)}</span>`).join(' ')}</td>
          <td class="num">${esc(money4(r.cost_usd))}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at)}</td>
        </tr>
        <tr class="run-detail" data-detail="${esc(r.id)}" hidden><td colspan="6">
          <div class="agent-meta" style="margin-bottom:6px">
            ${r.pipeline_id ? '<a class="chip" style="text-decoration:none" href="#/pipelines">⚙ pipeline</a>' : ''}
            ${r.decision_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(r.decision_id)}">${esc(r.decision_id)}</a>` : ''}
            ${r.task_type?.startsWith('ticket:') ? `<a class="chip chip-warn" style="text-decoration:none" href="#/support">✉ ${esc(r.task_type)}</a>` : ''}
          </div>
          ${r.failure_reason ? `<div class="reason">${esc(r.failure_reason)}</div>` : ''}
          ${r.state === 'done' && r.output?.parsed?.files?.length
            ? `<div style="margin:6px 0"><button class="btn btn-sm btn-ok" data-applyfiles="${esc(r.id)}">Apply ${r.output.parsed.files.length} file(s) to workspace</button></div>` : ''}
          <pre class="json">${esc(JSON.stringify(r.output?.parsed ?? r.output ?? r.input, null, 2))}</pre>
        </td></tr>`).join('') || '<tr><td colspan="6" class="empty">No runs.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#run-filter').addEventListener('change', (e) => { view.dataset.runState = e.target.value; renderRuns(); });
  $('#run-go').addEventListener('click', async () => {
    const prompt = $('#run-prompt').value.trim();
    if (!prompt) return toast('Prompt is required', true);
    try {
      await api('/api/runs', { method: 'POST', body: { agentId: $('#run-agent').value, taskType: $('#run-type').value || 'task', prompt, actor: actor() } });
      toast('Run enqueued'); renderRuns();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-run]').forEach((row) => row.addEventListener('click', () => {
    const d = view.querySelector(`[data-detail="${row.dataset.run}"]`);
    if (d) d.hidden = !d.hidden;
  }));
  view.querySelectorAll('[data-applyfiles]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const r = await api(`/api/runs/${b.dataset.applyfiles}/apply`, { method: 'POST', body: { actor: actor() } });
      toast(`Wrote ${r.written.length} file(s): ${r.written.join(', ').slice(0, 120)}`);
    } catch (err) { toast(err.message, true); }
  }));
}

async function renderDecisions() {
  const list = await api('/api/decisions');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Register a decision</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="dec-title" placeholder="What is being decided?"></div>
      <div><label class="fl">Tier</label><select id="dec-tier"><option>T1</option><option selected>T2</option><option>T3</option></select></div>
      <div><label class="fl">Owner (human)</label><input type="text" id="dec-owner" value="CTO"></div>
      <button class="btn btn-primary" id="dec-go">Register</button>
    </div>
    <div><label class="fl">Context</label><textarea id="dec-context" placeholder="Two-four sentences: what question, why now."></textarea></div>
  </div>
  <div class="panel">
    <div class="panel-title">Registry</div>
    <table>
      <thead><tr><th>ID</th><th>Title</th><th>Tier</th><th>Status</th><th>Owner</th><th class="num">Consensus</th><th>Expiry</th></tr></thead>
      <tbody>${list.map((d) => `
        <tr class="rowlink" onclick="location.hash='#/decisions/${esc(d.id)}'">
          <td class="mono">${esc(d.id)}</td><td>${esc(short(d.title, 56))}</td>
          <td class="mono">${esc(d.tier)}</td>
          <td><span class="state state-${d.status === 'approved' || d.status === 'approved_cond' ? 'done' : d.status === 'rejected' ? 'failed' : d.status === 'escalated' ? 'escalated' : 'awaiting_human'}">${esc(d.status)}</span></td>
          <td>${esc(d.owner_human)}</td>
          <td class="num">${d.consensus_score != null ? Number(d.consensus_score).toFixed(2) : '—'}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(d.expires_at || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">No decisions yet — the registry exists before the platform does.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#dec-go').addEventListener('click', async () => {
    try {
      const d = await api('/api/decisions', { method: 'POST', body: { title: $('#dec-title').value, tier: $('#dec-tier').value, owner: $('#dec-owner').value, context: $('#dec-context').value, actor: actor() } });
      location.hash = `#/decisions/${d.id}`;
    } catch (e) { toast(e.message, true); }
  });
}

async function renderDecisionDetail(id) {
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
      ${canTribunal ? '<div style="margin-top:10px"><label class="fl">Proposal for the tribunal</label><textarea id="trib-proposal" placeholder="The option under consideration…"></textarea></div>' : ''}
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
        <div style="flex:2"><label class="fl">Claim</label><input type="text" id="ev-claim"></div>
        <div><label class="fl">Source ref</label><input type="text" id="ev-src"></div>
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

async function renderPipelines() {
  const [templates, pipes, products] = await Promise.all([api('/api/pipeline-templates'), api('/api/pipelines'), api('/api/products')]);
  const preselect = localStorage.getItem('crucible-pl-product') || '';
  localStorage.removeItem('crucible-pl-product');
  const stepChip = (s) => {
    const st = s.runState || s.stepState;
    const cls = st === 'done' ? 'done' : st === 'awaiting_human' ? 'awaiting_human'
      : ['running', 'leased', 'queued'].includes(st) ? 'running'
      : ['failed', 'cancelled'].includes(st) ? 'failed' : 'queued';
    return `<span class="state state-${cls}" title="${esc(s.agentId)}${s.reason ? ' — ' + esc(s.reason) : ''}">${s.index + 1}. ${esc(s.title)}</span>`;
  };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Start a pipeline — FORGE chain, each step feeds the next</div>
    <div class="form-inline">
      <div style="flex:1.2"><label class="fl">Template</label>
        <select id="pl-template">${templates.map((t) => `<option value="${esc(t.key)}">${esc(t.title)}</option>`).join('')}</select></div>
      <div><label class="fl">Product (optional)</label>
        <select id="pl-product"><option value="">— none —</option>${products.map((p) => `<option value="${esc(p.id)}" ${p.id === preselect ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="pl-go">Start</button>
    </div>
    <div><label class="fl">Goal</label><textarea id="pl-goal" placeholder="What should this pipeline produce?"></textarea></div>
    <div class="map-legend" id="pl-desc">${esc(templates[0]?.description || '')}</div>
  </div>
  ${pipes.map((p) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} · <a class="mono" style="letter-spacing:0;color:var(--steel)" href="#/artifacts/${encodeURIComponent(p.workspace)}">${esc(p.workspace)}</a>${p.product_id ? ` · <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(p.product_id)}</a>` : ''}</span>
      <span>
        <span class="state state-${p.state === 'done' ? 'done' : p.state === 'awaiting_human' ? 'awaiting_human' : p.state === 'running' ? 'running' : 'failed'}">${esc(p.state)}</span>
        ${['running', 'awaiting_human'].includes(p.state) ? `<button class="btn btn-sm btn-bad" data-plcancel="${esc(p.id)}">Cancel</button>` : ''}
      </span>
    </div>
    <div style="margin-bottom:10px">${esc(short(p.goal, 160))}</div>
    <div class="agent-meta">${p.steps.map(stepChip).join('<span style="color:var(--ink-faint)">→</span>')}</div>
    <div class="map-legend">
      cost ${esc(money4(p.costUsd))}
      ${p.state === 'awaiting_human' ? ' · waiting at the <a href="#/gate" style="color:var(--warn)">human gate</a>' : ''}
      ${p.steps.some((s) => s.flags?.includes('same-family-review')) ? ' · <span style="color:var(--ember-soft)">same-family review flagged</span>' : ''}
    </div>
  </div>`).join('') || '<div class="panel"><div class="empty">No pipelines yet.</div></div>'}`;

  $('#pl-template').addEventListener('change', (e) => {
    $('#pl-desc').textContent = templates.find((t) => t.key === e.target.value)?.description || '';
  });
  $('#pl-go').addEventListener('click', async () => {
    const goal = $('#pl-goal').value.trim();
    if (!goal) return toast('Goal is required', true);
    try {
      await api('/api/pipelines', { method: 'POST', body: { template: $('#pl-template').value, goal, productId: $('#pl-product').value || null, actor: actor() } });
      toast('Pipeline started'); renderPipelines();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-plcancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/pipelines/${b.dataset.plcancel}/cancel`, { method: 'POST', body: { actor: actor() } }); renderPipelines(); }
    catch (e) { toast(e.message, true); }
  }));
}

async function renderArtifacts(filter = null) {
  let files = await api('/api/artifacts');
  if (filter) files = files.filter((f) => f.path.startsWith(filter + '/') || f.path.startsWith(filter));
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">
        <span>Workspace files — real output on disk (${files.length})</span>
        ${filter ? `<span class="chip chip-ember">${esc(filter)} · <a href="#/artifacts" style="color:inherit">clear</a></span>` : ''}
      </div>
      <table>
        <thead><tr><th>Path</th><th class="num">Size</th><th>Modified</th></tr></thead>
        <tbody>${files.map((f) => `
          <tr class="rowlink" data-art="${esc(f.path)}">
            <td class="mono">${esc(f.path)}</td>
            <td class="num">${f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB'}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(f.mtime.slice(0, 16).replace('T', ' '))}</td>
          </tr>`).join('') || '<tr><td colspan="3" class="empty">No artifacts yet — run a pipeline, then apply the Engineer’s files from the Runs page.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title" id="art-title">Viewer</div>
      <pre class="json" id="art-view" style="max-height:560px">Select a file.</pre>
    </div>
  </div>`;
  view.querySelectorAll('[data-art]').forEach((row) => row.addEventListener('click', async () => {
    try {
      const f = await api(`/api/artifacts/file?path=${encodeURIComponent(row.dataset.art)}`);
      $('#art-title').textContent = f.path;
      $('#art-view').textContent = f.content;
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderProducts() {
  const products = await api('/api/products');
  const gateHints = { 2: 'Gate 2 go requires payment-intent evidence (LOI / pre-order)', 8: 'Gate 8 is a T3 joint CEO+CTO go/no-go' };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New product — enters the factory at Gate 1</div>
    <div class="form-inline">
      <div style="flex:1"><label class="fl">Name</label><input type="text" id="pr-name"></div>
      <div style="flex:2"><label class="fl">Description</label><input type="text" id="pr-desc"></div>
      <button class="btn btn-primary" id="pr-go">Create</button>
    </div>
  </div>
  ${products.map((p) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">· ${esc(p.id)}</span></span>
      <span class="chip ${p.state === 'live' ? 'chip-ok' : p.state === 'retired' ? 'chip-bad' : 'chip-ember'}">${esc(p.state)} · gate ${p.stage}/10</span>
    </div>
    ${p.description ? `<div style="margin-bottom:6px">${esc(p.description)}</div>` : ''}
    <div class="gatebar">${p.gates.map((g) => `<span class="${esc(g.status)}" data-t="${g.gate}. ${esc(g.title)}${g.date ? ' · ' + esc(g.date) : ''}${g.status === 'active' ? ' · ACTIVE' : ''}"></span>`).join('')}</div>
    <div class="agent-meta">
      <button class="btn btn-sm" data-plnew="${esc(p.id)}">New pipeline →</button>
      ${p.related.pipelines.map((pl) => `<a class="chip" style="text-decoration:none" href="#/artifacts/${encodeURIComponent(pl.workspace)}" title="${esc(pl.state)}">⚙ ${esc(short(pl.name, 24))}</a>`).join('')}
      ${p.related.incidents.map((i) => `<a class="chip ${i.state !== 'closed' ? 'chip-bad' : 'chip-dim'}" style="text-decoration:none" href="#/incidents">⚠ #${i.id} ${esc(i.sev)}</a>`).join('')}
      ${p.related.tickets.map((t) => `<a class="chip chip-dim" style="text-decoration:none" href="#/support">✉ #${t.id}</a>`).join('')}
      ${p.related.gateDecisions.map((g) => `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(g.decisionId)}">G${g.gate} → ${esc(g.decisionId)}</a>`).join('')}
    </div>
    <div class="map-legend">active: <b style="color:var(--steel)">${esc(p.gates[p.stage - 1]?.title || '—')}</b>${gateHints[p.stage] ? ' — ' + gateHints[p.stage] : ''}</div>
    ${p.state !== 'retired' ? `
    <div class="form-inline" style="margin-top:10px">
      <div style="flex:2"><label class="fl">Gate note (the decision artifact)</label><input type="text" data-note="${esc(p.id)}"></div>
      <div><label class="fl">Decision ref (optional)</label><input type="text" data-dr="${esc(p.id)}" placeholder="DR-2026-…"></div>
      ${p.stage < 10 ? `<button class="btn btn-ok" data-advance="${esc(p.id)}">Pass gate ${p.stage}</button>` : ''}
      <button class="btn btn-bad" data-retire="${esc(p.id)}">Retire (T3)</button>
    </div>` : ''}
    ${p.gates.filter((g) => g.status === 'passed').map((g) => `<div class="map-legend">✓ G${g.gate} ${esc(g.title)} · ${esc(g.date)}${g.decisionId ? ' · ' + esc(g.decisionId) : ''} — ${esc(short(g.note, 90))}</div>`).join('')}
  </div>`).join('') || '<div class="panel"><div class="empty">No products in the factory yet.</div></div>'}`;

  $('#pr-go').addEventListener('click', async () => {
    try { await api('/api/products', { method: 'POST', body: { name: $('#pr-name').value, description: $('#pr-desc').value, actor: actor() } }); renderProducts(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.advance;
    try {
      await api(`/api/products/${id}/advance`, { method: 'POST', body: { note: view.querySelector(`[data-note="${id}"]`).value, decisionId: view.querySelector(`[data-dr="${id}"]`).value || null, actor: actor() } });
      toast('Gate passed'); renderProducts();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-retire]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.retire;
    try {
      await api(`/api/products/${id}/retire`, { method: 'POST', body: { note: view.querySelector(`[data-note="${id}"]`).value, actor: actor() } });
      toast('Product retired — runbook applies (Part 5 §13)'); renderProducts();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-plnew]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('crucible-pl-product', b.dataset.plnew);
    location.hash = '#/pipelines';
  }));
}

async function renderIncidents() {
  const incidents = await api('/api/incidents');
  const NEXT = { open: ['mitigated', 'resolved'], mitigated: ['resolved', 'open'], resolved: ['closed', 'open'], closed: [] };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Declare an incident — a human commands, always</div>
    <div class="form-inline">
      <div style="flex:0.6"><label class="fl">Severity</label><select id="in-sev"><option>SEV1</option><option>SEV2</option><option selected>SEV3</option><option>SEV4</option></select></div>
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="in-title"></div>
      <div><label class="fl">Commander (human)</label><input type="text" id="in-cmd" value="${esc(actor())}"></div>
      <button class="btn btn-primary" id="in-go">Declare</button>
    </div>
  </div>
  ${incidents.map((i) => `
  <div class="panel">
    <div class="panel-title">
      <span><span class="chip ${i.sev === 'SEV1' ? 'chip-bad' : i.sev === 'SEV2' ? 'chip-warn' : 'chip-dim'}">${esc(i.sev)}</span> #${i.id} · ${esc(i.title)}</span>
      <span class="state state-${i.state === 'closed' ? 'done' : i.state === 'open' ? 'failed' : 'awaiting_human'}">${esc(i.state)}</span>
    </div>
    <div class="map-legend">commander ${esc(i.commander)} · declared ${esc(i.created_at)}
      ${i.product_id ? ` · <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(i.product_id)}</a>` : ''}
      ${i.postmortem_pipeline_id ? ` · <a href="#/pipelines" class="chip chip-ok" style="text-decoration:none">postmortem pipeline ⚙</a>` : ''}
    </div>
    ${['SEV1', 'SEV2'].includes(i.sev) && !i.postmortem_pipeline_id ? `<div style="margin:6px 0"><button class="btn btn-sm" data-ipm-pipe="${i.id}">Draft postmortem via pipeline</button></div>` : ''}
    <div style="margin:8px 0">${i.timeline.map((t) => `<div class="mono" style="font-size:11.5px;padding:2px 0"><span style="color:var(--ink-faint)">${esc(t.t.slice(11, 19))}</span> <span style="color:var(--steel)">${esc(t.who)}</span> — ${esc(t.note)}</div>`).join('')}</div>
    ${i.postmortem ? `<div class="panel-title">Postmortem</div><pre class="json">${esc(i.postmortem)}</pre>` : ''}
    ${['resolved', 'closed'].includes(i.state) ? `
    <div class="form-inline" style="margin-top:6px">
      <div style="flex:2"><input type="text" data-ilesson="${i.id}" placeholder="One-line lesson → organizational memory (verified by this act)"></div>
      <button class="btn btn-sm btn-ok" data-ilessongo="${i.id}">Record lesson</button>
    </div>` : ''}
    ${i.state !== 'closed' ? `
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Timeline update</label><input type="text" data-inote="${i.id}"></div>
      <button class="btn btn-sm" data-iupd="${i.id}">Add update</button>
      ${NEXT[i.state].map((s) => `<button class="btn btn-sm ${s === 'closed' ? 'btn-ok' : ''}" data-istate="${i.id}" data-to="${s}">→ ${s}</button>`).join('')}
    </div>
    ${['SEV1', 'SEV2'].includes(i.sev) && !i.postmortem ? `<div style="margin-top:8px"><label class="fl">Postmortem (required before ${esc(i.sev)} closes)</label><textarea data-ipm="${i.id}"></textarea></div>` : ''}` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No incidents. May it stay that way.</div></div>'}`;

  $('#in-go').addEventListener('click', async () => {
    try { await api('/api/incidents', { method: 'POST', body: { sev: $('#in-sev').value, title: $('#in-title').value, commander: $('#in-cmd').value, actor: actor() } }); renderIncidents(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-iupd]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/incidents/${b.dataset.iupd}/update`, { method: 'POST', body: { note: view.querySelector(`[data-inote="${b.dataset.iupd}"]`).value, actor: actor() } }); renderIncidents(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-istate]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.istate;
    try {
      await api(`/api/incidents/${id}/state`, { method: 'POST', body: { state: b.dataset.to, postmortem: view.querySelector(`[data-ipm="${id}"]`)?.value || null, actor: actor() } });
      renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ipm-pipe]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/incidents/${b.dataset.ipmPipe}/postmortem-pipeline`, { method: 'POST', body: { actor: actor() } });
      toast('Postmortem pipeline started — see Pipelines'); renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ilessongo]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.ilessongo;
    try {
      await api(`/api/incidents/${id}/lesson`, { method: 'POST', body: { content: view.querySelector(`[data-ilesson="${id}"]`).value, actor: actor() } });
      toast('Lesson recorded in Knowledge (verified)'); renderIncidents();
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderSupport() {
  const [tickets, stats, products] = await Promise.all([api('/api/tickets'), api('/api/support/stats'), api('/api/products')]);
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Inbound ticket (AI drafts — a human always sends)</div>
      <div class="form-inline">
        <div><label class="fl">Customer</label><input type="text" id="tk-cust"></div>
        <div><label class="fl">Category</label><input type="text" id="tk-cat" value="general"></div>
        <div><label class="fl">Product</label><select id="tk-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div class="form-inline">
        <div style="flex:1"><label class="fl">Subject</label><input type="text" id="tk-subj"></div>
        <button class="btn btn-primary" id="tk-go">Receive</button>
      </div>
      <div><label class="fl">Message</label><textarea id="tk-body"></textarea></div>
    </div>
    <div class="panel">
      <div class="panel-title">Graduation ladder — ≥100 sent · ≥95% unedited; auto-recall &lt;90%</div>
      <table>
        <thead><tr><th>Category</th><th class="num">Sent</th><th class="num">Unedited</th><th class="num">Acceptance</th><th class="num">Escalated</th><th>Status</th></tr></thead>
        <tbody>${stats.map((s) => `
          <tr><td class="mono">${esc(s.category)}</td><td class="num">${s.sent}</td><td class="num">${s.unedited}</td>
          <td class="num">${s.acceptance !== null ? (s.acceptance * 100).toFixed(0) + '%' : '—'}</td>
          <td class="num">${s.escalated}</td>
          <td>${s.graduated ? '<span class="chip chip-ok">graduated</span>' : s.recalled ? '<span class="chip chip-bad">recalled</span>' : '<span class="chip chip-dim">draft-only</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tickets yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
  ${tickets.map((t) => `
  <div class="panel">
    <div class="panel-title">
      <span>#${t.id} · ${esc(t.subject)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">· ${esc(t.customer)} · ${esc(t.category)}</span></span>
      <span class="state state-${t.state === 'sent' || t.state === 'closed' ? 'done' : t.state === 'escalated' ? 'escalated' : t.state === 'draft_ready' ? 'awaiting_human' : 'running'}">${esc(t.state)}</span>
    </div>
    <div class="map-legend">
      ${t.product_id ? `<a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(t.product_id)}</a> ` : ''}
      ${t.incident_id ? `<a href="#/incidents" class="chip chip-bad" style="text-decoration:none">⚠ incident #${t.incident_id}</a>` : ''}
    </div>
    <pre class="json" style="max-height:120px">${esc(t.body)}</pre>
    ${!t.incident_id && t.state !== 'closed' ? `
      <div class="form-inline" style="margin:6px 0">
        <div style="flex:0.4"><select data-tsev="${t.id}"><option>SEV3</option><option>SEV2</option><option>SEV1</option><option>SEV4</option></select></div>
        <button class="btn btn-sm btn-bad" data-traise="${t.id}">Raise incident</button>
      </div>` : ''}
    ${['draft_ready', 'escalated'].includes(t.state) ? `
      <div style="margin-top:8px"><label class="fl">${t.state === 'escalated' ? 'Escalated — human writes/edits the reply' : 'AI draft — edit if needed, then send'}</label>
      <textarea data-tbody="${t.id}" style="min-height:110px">${esc(t.draft || '')}</textarea></div>
      <div class="form-inline" style="margin-top:6px">
        <button class="btn btn-ok" data-tsend="${t.id}">Send as ${esc(actor())}</button>
        <button class="btn btn-sm" data-tclose="${t.id}">Close without reply</button>
      </div>` : ''}
    ${t.state === 'sent' ? `<div class="map-legend">sent ${esc(t.sent_at)} · ${t.edited ? '<span style="color:var(--warn)">edited before send</span>' : '<span style="color:var(--ok)">accepted unedited</span>'}</div><pre class="json" style="max-height:140px">${esc(t.sent_body)}</pre>` : ''}
  </div>`).join('')}`;

  $('#tk-go').addEventListener('click', async () => {
    try {
      await api('/api/tickets', { method: 'POST', body: { customer: $('#tk-cust').value, category: $('#tk-cat').value, subject: $('#tk-subj').value, body: $('#tk-body').value, productId: $('#tk-prod').value || null } });
      toast('Ticket received — Support agent is drafting'); renderSupport();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-tsend]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tickets/${b.dataset.tsend}/send`, { method: 'POST', body: { body: view.querySelector(`[data-tbody="${b.dataset.tsend}"]`).value, actor: actor() } }); toast('Reply sent by human'); renderSupport(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-tclose]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tickets/${b.dataset.tclose}/close`, { method: 'POST', body: { actor: actor() } }); renderSupport(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-traise]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.traise;
    try {
      await api(`/api/tickets/${id}/incident`, { method: 'POST', body: { sev: view.querySelector(`[data-tsev="${id}"]`).value, commander: actor(), actor: actor() } });
      toast('Incident raised and linked'); renderSupport();
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderEvals() {
  const data = await api('/api/evals');
  view.innerHTML = `
  <div class="grid grid-3">
    ${data.sets.map((s) => `
    <div class="panel agent-card">
      <div class="agent-head"><span class="agent-name">${esc(s.agentId)}</span><span class="chip ${s.kind === 'canary' ? 'chip-ember' : 'chip-dim'}">${esc(s.kind)}</span></div>
      <div class="agent-meta">${s.cases.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <div class="map-legend">${s.lastRun ? `last: ${(s.lastRun.score * 100).toFixed(0)}% (${s.lastRun.passed}/${s.lastRun.total}) · ${esc(s.lastRun.created_at)}` : 'never run'}</div>
      <div><button class="btn btn-primary btn-sm" data-eval="${esc(s.agentId)}">Run set (live usage)</button></div>
    </div>`).join('')}
  </div>
  <div class="panel">
    <div class="panel-title">Eval history — scores feed the reputation factor (hard-capped 0.85–1.15)</div>
    <table>
      <thead><tr><th>Agent</th><th>Kind</th><th class="num">Score</th><th class="num">Passed</th><th>Cases</th><th class="num">Cost</th><th>When</th></tr></thead>
      <tbody>${data.runs.map((r) => `
        <tr><td class="mono">${esc(r.agent_id)}</td><td class="mono">${esc(r.kind)}</td>
        <td class="num" style="color:${r.score >= 0.9 ? 'var(--ok)' : r.score >= 0.6 ? 'var(--warn)' : 'var(--bad)'}">${(r.score * 100).toFixed(0)}%</td>
        <td class="num">${r.passed}/${r.total}</td>
        <td class="mono" style="font-size:11px">${r.details.map((d) => `${esc(d.name)}:${d.verdict === 'pass' ? '✓' : '✗'}`).join(' ')}</td>
        <td class="num">${esc(money4(r.cost_usd))}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No eval runs yet.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-eval]').forEach((b) => b.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Running…';
    try {
      const r = await api('/api/evals/run', { method: 'POST', body: { agentId: b.dataset.eval, actor: actor() } });
      toast(`${r.agentId}: ${(r.score * 100).toFixed(0)}% (${r.passed}/${r.total})`); renderEvals();
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Run set (live usage)'; }
  }));
}

async function renderGovernance() {
  const [notif, rituals, problems, fin] = await Promise.all([
    api('/api/notifications'), api('/api/rituals'), api('/api/problems'), api('/api/finance'),
  ]);
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title"><span>Notifications (${notif.unread} unread)</span><button class="btn btn-sm" id="nt-read">Mark all read</button></div>
      ${notif.items.slice(0, 30).map((n) => {
        const href = linkFor(n.subject_type, n.subject_id);
        return `
        <div class="round"><div class="round-body">
          <span class="chip ${n.level === 'crit' ? 'chip-bad' : n.level === 'warn' ? 'chip-warn' : 'chip-dim'}">${esc(n.level)}</span>
          ${href ? `<a href="${href}" style="color:inherit;${n.read ? 'color:var(--ink-faint)' : ''}"> ${esc(n.message)} →</a>` : `<span style="${n.read ? 'color:var(--ink-faint)' : ''}"> ${esc(n.message)}</span>`}
          <div class="map-legend">${esc(n.source)} · ${esc(n.created_at)}</div>
        </div></div>`;
      }).join('') || '<div class="empty">All quiet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Governance calendar — no artifact, no meeting</div>
      ${rituals.map((r) => `
        <div class="round"><div class="round-body">
          <div class="agent-head">
            <span><b>${esc(r.title)}</b> <span class="chip chip-dim">${esc(r.cadence)}</span></span>
            <span class="mono" style="color:${r.overdue ? 'var(--bad)' : r.dueToday ? 'var(--warn)' : 'var(--ink-faint)'}">due ${esc(r.next_due)}</span>
          </div>
          <div class="map-legend">${esc(r.description || '')}${r.last_done ? ` · last done ${esc(r.last_done)}: ${esc(short(r.last_note, 60))}` : ''}</div>
          <div class="form-inline" style="margin-top:4px">
            <div style="flex:2"><input type="text" data-rnote="${esc(r.id)}" placeholder="artifact note…"></div>
            <button class="btn btn-sm btn-ok" data-rdone="${esc(r.id)}">Complete</button>
          </div>
        </div></div>`).join('')}
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Open problems (immune system)</div>
      ${problems.filter((p) => p.state === 'open').map((p) => `
        <div class="round"><div class="round-body">
          <div class="agent-head"><span class="mono">${esc(p.signature)}</span><button class="btn btn-sm btn-ok" data-presolve="${p.id}">Resolve</button></div>
          <div class="map-legend">count ${p.count} · ${esc(short(p.note, 100))}</div>
        </div></div>`).join('') || '<div class="empty">No open problems.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title"><span>Finance pack — ${esc(fin.month)}</span><button class="btn btn-sm" id="fin-export">Export .md</button></div>
      <dl class="kv">
        <dt>Cash spend</dt><dd>${esc(money4(fin.totalCostUsd))} of ${esc(money(fin.capUsd))} (${fin.capConsumedPct.toFixed(1)}%)</dd>
        <dt>Governance</dt><dd>${esc(money4(fin.governanceUsd))} (${fin.governancePctOfSpend.toFixed(1)}% of spend)</dd>
        <dt>Subscription</dt><dd>${fin.subscription.calls} calls · ${fin.subscription.tin.toLocaleString()} in / ${fin.subscription.tout.toLocaleString()} out tok · $0</dd>
        <dt>Activity</dt><dd>${fin.activity.pipelines} pipelines · ${fin.activity.decisions} decisions · ${fin.activity.incidents} incidents · ${fin.activity.ticketsSent} tickets sent</dd>
        <dt>Commercial</dt><dd>MRR <a href="#/customers">${esc(money(fin.commercial.mrrUsd))}</a> · CAC ${fin.commercial.cashCacUsd !== null ? esc(money(fin.commercial.cashCacUsd)) : '—'} · <a href="#/vendors">vendor burn ${esc(money(fin.commercial.vendorBurnUsd))}/mo</a></dd>
      </dl>
      <table style="margin-top:10px">
        <thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead>
        <tbody>${fin.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;

  $('#nt-read').addEventListener('click', async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); renderGovernance(); refreshShell(); });
  $('#fin-export').addEventListener('click', async () => {
    try { const r = await api('/api/finance/export', { method: 'POST', body: { actor: actor() } }); toast(`Exported ${r.path} — see Artifacts`); } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-rdone]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/rituals/${b.dataset.rdone}/complete`, { method: 'POST', body: { note: view.querySelector(`[data-rnote="${b.dataset.rdone}"]`).value, actor: actor() } }); toast('Ritual completed'); renderGovernance(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-presolve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/problems/${b.dataset.presolve}/resolve`, { method: 'POST', body: { actor: actor() } }); renderGovernance(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderIntel() {
  const [queries, segments, products] = await Promise.all([api('/api/intel'), api('/api/segments'), api('/api/products')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Intelligence request — describe what you want collected (Arabic or English)</div>
    <div class="form-inline">
      <div style="flex:3"><textarea id="iq-q" style="min-height:56px" placeholder="مثال: اريد كل الشركات التي تعمل بمجال الطاقة و تعمل في العراق — الاسم، الموقع، بروفايل، طرق التواصل"></textarea></div>
      <button class="btn btn-primary" id="iq-go">Collect</button>
    </div>
    <div class="map-legend">Records come from model knowledge — every one enters <b>unverified</b> with per-record confidence; verify (human) before outreach. Exports are Excel-ready CSV (UTF-8 BOM, Arabic-safe) and land in the <a href="#/artifacts/_intel">_intel repository</a> + <a href="#/archive">Archive</a>.</div>
  </div>
  ${queries.map((iq) => `
  <div class="panel">
    <div class="panel-title">
      <span>#${iq.id} · ${esc(short(iq.question, 90))}</span>
      <span>
        <span class="state state-${iq.state === 'ready' ? 'done' : iq.state === 'failed' ? 'failed' : 'running'}">${esc(iq.state)}</span>
        ${iq.state === 'ready' && iq.records.length ? `
          <a class="btn btn-sm" href="/api/intel/export?queryId=${iq.id}&actor=${encodeURIComponent(actor())}" download>⬇ Excel (CSV)</a>
          <button class="btn btn-sm" data-autoseg="${iq.id}">AI segment</button>` : ''}
      </span>
    </div>
    ${iq.summary ? `<div class="map-legend">${esc(short(iq.summary, 200))}</div>` : ''}
    ${iq.records.length ? `
    <table>
      <thead><tr><th>Name / الاسم</th><th>Sector</th><th>Location</th><th>Contact</th><th class="num">Conf</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${iq.records.map((r) => `
        <tr>
          <td><b>${esc(r.name)}</b>${r.name_ar ? `<div style="color:var(--ink-mute)">${esc(r.name_ar)}</div>` : ''}${r.profile ? `<div class="map-legend">${esc(short(r.profile, 110))}</div>` : ''}</td>
          <td class="mono">${esc(r.sector || '—')}</td>
          <td class="mono">${esc([r.city, r.country].filter(Boolean).join(', ') || '—')}</td>
          <td class="mono" style="font-size:11px">${[r.website, r.email, r.phone].filter(Boolean).map(esc).join('<br>') || '—'}</td>
          <td class="num" style="color:${(r.confidence ?? 0) >= 0.7 ? 'var(--ok)' : 'var(--warn)'}">${r.confidence != null ? (r.confidence * 100).toFixed(0) + '%' : '—'}</td>
          <td>
            <span class="chip ${r.verification === 'verified' ? 'chip-ok' : 'chip-warn'}">${esc(r.verification)}</span>
            ${r.customer_id ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">→ lead #${r.customer_id}</a>` : ''}
          </td>
          <td>
            ${r.verification === 'unverified' ? `<button class="btn btn-sm" data-iverify="${r.id}">Verify</button>` : ''}
            ${!r.customer_id ? `<button class="btn btn-sm btn-ok" data-itarget="${r.id}">Target → CRM</button>` : ''}
            ${segments.length ? `<select data-isegsel="${r.id}" style="width:auto;font-size:11px"><option value="">+segment</option>${segments.map((s) => `<option value="${s.id}">${esc(short(s.name, 20))}</option>`).join('')}</select>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>` : iq.state === 'collecting' ? '<div class="empty">Collecting…</div>' : '<div class="empty">No records.</div>'}
  </div>`).join('') || ''}`;

  $('#iq-go').addEventListener('click', async () => {
    try { await api('/api/intel', { method: 'POST', body: { question: $('#iq-q').value, actor: actor() } }); toast('Collecting — the Intelligence agent is working'); renderIntel(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-iverify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.iverify}/verify`, { method: 'POST', body: { actor: actor() } }); renderIntel(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-itarget]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/api/intel/records/${b.dataset.itarget}/target`, { method: 'POST', body: { actor: actor() } }); toast(`Targeted → CRM lead #${r.customer.id}`); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-isegsel]').forEach((sel) => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    try { await api(`/api/segments/${sel.value}/members`, { method: 'POST', body: { recordId: Number(sel.dataset.isegsel), actor: actor() } }); toast('Added to segment'); }
    catch (e) { toast(e.message, true); }
    sel.value = '';
  }));
  view.querySelectorAll('[data-autoseg]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/api/intel/${b.dataset.autoseg}/auto-segment`, { method: 'POST', body: { actor: actor() } }); toast('AI segmentation running — see Segments shortly'); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

async function renderSegments() {
  const segments = await api('/api/segments');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New segment</div>
    <div class="form-inline">
      <div><label class="fl">Name</label><input type="text" id="sg-name"></div>
      <div style="flex:2"><label class="fl">Description</label><input type="text" id="sg-desc"></div>
      <button class="btn btn-primary" id="sg-go">Create</button>
    </div>
    <div class="map-legend">Add members from the <a href="#/intel">Intelligence</a> page. A segment becomes a campaign audience in one click.</div>
  </div>
  ${segments.map((s) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(s.name)} <span class="chip ${s.source === 'ai' ? 'chip-steel' : 'chip-dim'}">${esc(s.source)}</span> <span class="chip">${s.members.length} members</span></span>
      <span>
        ${s.members.length ? `<a class="btn btn-sm" href="/api/intel/export?segmentId=${s.id}&actor=${encodeURIComponent(actor())}" download>⬇ Excel</a>` : ''}
        <button class="btn btn-sm btn-ok" data-sgcamp="${s.id}" data-name="${esc(s.name)}" data-desc="${esc(s.description || '')}" data-n="${s.members.length}">→ Campaign</button>
      </span>
    </div>
    ${s.description ? `<div class="map-legend">${esc(s.description)}</div>` : ''}
    <div class="agent-meta">${s.members.map((m) => `<span class="chip ${m.state === 'targeted' ? 'chip-ok' : m.verification === 'verified' ? 'chip-steel' : 'chip-dim'}" title="${esc(m.verification)}">${esc(short(m.name, 26))}${m.country ? ' · ' + esc(m.country) : ''}</span>`).join('') || '<span class="empty">empty</span>'}</div>
  </div>`).join('') || '<div class="panel"><div class="empty">No segments — create one, or run “AI segment” on an intelligence query.</div></div>'}`;

  $('#sg-go').addEventListener('click', async () => {
    try { await api('/api/segments', { method: 'POST', body: { name: $('#sg-name').value, description: $('#sg-desc').value || null, actor: actor() } }); renderSegments(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-sgcamp]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/campaigns', { method: 'POST', body: {
        name: `Segment: ${b.dataset.name}`, channel: 'email', budgetUsd: 0,
        brief: `Outreach campaign targeting segment "${b.dataset.name}" (${b.dataset.n} organizations). ${b.dataset.desc}\nGoal: introduce our product and invite to a pilot. Draft a short outreach email (English + Arabic versions).`,
        actor: actor(),
      } });
      toast('Campaign created from segment — see Marketing'); location.hash = '#/marketing';
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderDatasets() {
  const datasets = await api('/api/datasets');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Store a dataset — paste anything (CSV, JSON, text, mixed Arabic/English)</div>
    <div class="form-inline">
      <div><label class="fl">Name</label><input type="text" id="ds-name"></div>
      <button class="btn btn-primary" id="ds-go">Store</button>
    </div>
    <div><label class="fl">Raw data (treated as untrusted input)</label><textarea id="ds-raw" style="min-height:110px"></textarea></div>
  </div>
  <div class="panel">
    <div class="panel-title">Datasets — transform with AI: clean · summarize · extract entities → Intelligence</div>
    <table>
      <thead><tr><th>Name</th><th class="num">Size</th><th>Op</th><th>State</th><th>Actions</th></tr></thead>
      <tbody>${datasets.map((d) => `
        <tr class="rowlink" data-dsrow="${d.id}">
          <td><b>${esc(d.name)}</b>${d.parent_id ? ` <span class="chip chip-dim">from #${d.parent_id}</span>` : ''}</td>
          <td class="num">${(d.raw_chars / 1024).toFixed(1)} KB</td>
          <td class="mono">${esc(d.op || '—')}</td>
          <td><span class="state state-${d.state === 'done' ? 'done' : d.state === 'failed' ? 'failed' : d.state === 'processing' ? 'running' : 'queued'}">${esc(d.state)}</span></td>
          <td>
            ${['stored', 'done', 'failed'].includes(d.state) ? ['clean', 'summarize', 'extract-entities'].map((op) => `<button class="btn btn-sm" data-dsop="${d.id}" data-op="${op}">${op}</button>`).join(' ') : '…'}
          </td>
        </tr>
        <tr class="run-detail" data-dsdetail="${d.id}" hidden><td colspan="5"><pre class="json" id="ds-view-${d.id}">click row again to load…</pre></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No datasets.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#ds-go').addEventListener('click', async () => {
    try { await api('/api/datasets', { method: 'POST', body: { name: $('#ds-name').value, raw: $('#ds-raw').value, actor: actor() } }); renderDatasets(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dsop]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api(`/api/datasets/${b.dataset.dsop}/transform`, { method: 'POST', body: { op: b.dataset.op, actor: actor() } }); toast(`${b.dataset.op} running`); renderDatasets(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-dsrow]').forEach((row) => row.addEventListener('click', async () => {
    const id = row.dataset.dsrow;
    const detail = view.querySelector(`[data-dsdetail="${id}"]`);
    detail.hidden = !detail.hidden;
    if (!detail.hidden) {
      try { const d = await api(`/api/datasets/${id}`); $(`#ds-view-${id}`).textContent = d.result ? JSON.stringify(d.result, null, 2) : d.raw.slice(0, 3000); } catch { /* leave */ }
    }
  }));
}

async function renderArchive() {
  const items = await api('/api/archive');
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Archive — frozen snapshots from every section (${items.length})</div>
      <table>
        <thead><tr><th>Kind</th><th>Title</th><th>Source</th><th>By</th><th>When</th></tr></thead>
        <tbody>${items.map((a) => `
          <tr class="rowlink" data-arc="${a.id}">
            <td><span class="chip ${{ 'intel-export': 'chip-steel', contract: 'chip-ember', campaign: 'chip-warn', finance: 'chip-ok' }[a.kind] || 'chip-dim'}">${esc(a.kind)}</span></td>
            <td>${esc(short(a.title, 60))}</td>
            <td>${(() => { const h = linkFor(a.subject_type, a.subject_id); return h ? `<a class="mono" style="color:var(--steel)" href="${h}">${esc(a.subject_type)} ${esc(short(a.subject_id || '', 14))}</a>` : '<span class="mono" style="color:var(--ink-faint)">—</span>'; })()}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(short(a.created_by, 18))}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(a.created_at.slice(0, 16))}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty">Empty — snapshots arrive automatically.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title" id="arc-title">Snapshot viewer</div>
      <pre class="json" id="arc-view" style="max-height:560px">Select an item.</pre>
      <div id="arc-file" class="map-legend"></div>
    </div>
  </div>`;
  view.querySelectorAll('[data-arc]').forEach((row) => row.addEventListener('click', async () => {
    try {
      const a = await api(`/api/archive/${row.dataset.arc}`);
      $('#arc-title').textContent = a.title;
      $('#arc-view').textContent = a.snapshot ? JSON.stringify(a.snapshot, null, 2) : '(no snapshot payload)';
      $('#arc-file').innerHTML = a.file_ref ? `file: <a href="#/artifacts/${encodeURIComponent(a.file_ref.split('/')[0])}" style="color:var(--steel)">${esc(a.file_ref)}</a>` : '';
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderMarketing() {
  const [campaigns, products] = await Promise.all([api('/api/campaigns'), api('/api/products')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New campaign — AI drafts the copy, a human approves before it goes live</div>
    <div class="form-inline">
      <div><label class="fl">Name</label><input type="text" id="cm-name"></div>
      <div><label class="fl">Channel</label><select id="cm-chan"><option>landing</option><option>email</option><option>paid</option><option>content</option><option>social</option></select></div>
      <div><label class="fl">Product</label><select id="cm-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Budget $</label><input type="text" id="cm-budget" value="0"></div>
      <button class="btn btn-primary" id="cm-go">Create</button>
    </div>
    <div><label class="fl">Brief</label><textarea id="cm-brief" placeholder="Audience, promise, call to action…"></textarea></div>
  </div>
  ${campaigns.map((c) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(c.name)} <span class="chip chip-dim">${esc(c.channel)}</span>${c.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(c.product_id)}</a>` : ''}</span>
      <span class="state state-${c.state === 'live' ? 'done' : c.state === 'paused' ? 'failed' : c.state === 'pending_approval' ? 'awaiting_human' : 'running'}">${esc(c.state)}</span>
    </div>
    <div class="map-legend">budget ${esc(money(c.budget_usd))} · spent ${esc(money(c.spent_usd))} · signups ${c.metrics.signups} · qualified ${c.metrics.qualified} · customers <a href="#/customers">${c.customers}</a>${c.approved_by ? ` · approved by ${esc(c.approved_by)}` : ''}</div>
    ${c.budget_usd > 0 ? `<div class="meter"><div class="meter-track"><div class="meter-fill ${c.spent_usd > c.budget_usd ? 'hot' : ''}" style="width:${Math.min(100, (c.spent_usd / c.budget_usd) * 100)}%"></div></div></div>` : ''}
    ${c.state === 'pending_approval' ? `
      <div style="margin-top:8px"><label class="fl">Copy — edit then approve (publishing is human-only)</label>
      <textarea data-cmcopy="${c.id}" style="min-height:100px">${esc(c.draft || '')}</textarea></div>
      <div style="margin-top:6px"><button class="btn btn-ok btn-sm" data-cmapprove="${c.id}">Approve → live</button></div>` : ''}
    ${['live', 'paused'].includes(c.state) ? `
      <div class="form-inline" style="margin-top:8px">
        <div><label class="fl">Spent $</label><input type="text" data-cmspent="${c.id}" value="${c.spent_usd}"></div>
        <div><label class="fl">Signups</label><input type="text" data-cmsign="${c.id}" value="${c.metrics.signups}"></div>
        <div><label class="fl">Qualified</label><input type="text" data-cmqual="${c.id}" value="${c.metrics.qualified}"></div>
        <button class="btn btn-sm" data-cmupd="${c.id}">Update</button>
        ${c.state === 'live' ? `<button class="btn btn-sm btn-bad" data-cmstate="${c.id}" data-to="paused">Pause</button>` : `<button class="btn btn-sm btn-ok" data-cmstate="${c.id}" data-to="live">Resume (human)</button>`}
        <button class="btn btn-sm" data-cmstate="${c.id}" data-to="done">Done</button>
      </div>` : ''}
    ${c.draft && c.state !== 'pending_approval' ? `<pre class="json" style="max-height:120px">${esc(c.draft)}</pre>` : ''}
  </div>`).join('') || ''}`;

  $('#cm-go').addEventListener('click', async () => {
    try {
      await api('/api/campaigns', { method: 'POST', body: { name: $('#cm-name').value, channel: $('#cm-chan').value, productId: $('#cm-prod').value || null, budgetUsd: Number($('#cm-budget').value) || 0, brief: $('#cm-brief').value, actor: actor() } });
      toast('Campaign created — Docs agent is drafting copy'); renderMarketing();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-cmapprove]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/campaigns/${b.dataset.cmapprove}/approve`, { method: 'POST', body: { copy: view.querySelector(`[data-cmcopy="${b.dataset.cmapprove}"]`).value, actor: actor() } }); toast('Live — approved by human'); renderMarketing(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cmupd]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.cmupd;
    try { await api(`/api/campaigns/${id}/update`, { method: 'POST', body: { spentUsd: Number(view.querySelector(`[data-cmspent="${id}"]`).value), signups: Number(view.querySelector(`[data-cmsign="${id}"]`).value), qualified: Number(view.querySelector(`[data-cmqual="${id}"]`).value), actor: actor() } }); renderMarketing(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cmstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/campaigns/${b.dataset.cmstate}/update`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderMarketing(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderCustomers() {
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
      <div><label class="fl">Name</label><input type="text" id="cu-name"></div>
      <div><label class="fl">Company</label><input type="text" id="cu-comp"></div>
      <div><label class="fl">State</label><select id="cu-state"><option>lead</option><option>trial</option><option>active</option></select></div>
      <div><label class="fl">MRR $</label><input type="text" id="cu-mrr" value="0"></div>
      <div><label class="fl">Product</label><select id="cu-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Campaign</label><select id="cu-camp"><option value="">—</option>${campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
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
          <td>${c.state !== 'churned' ? `
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
}

async function renderPeople() {
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
      <div><label class="fl">Name</label><input type="text" id="pe-name"></div>
      <div style="flex:1.5"><label class="fl">Role</label><input type="text" id="pe-role"></div>
      <div><label class="fl">Type</label><select id="pe-type"><option>hire</option><option>fractional</option><option>founder</option></select></div>
      <button class="btn btn-primary" id="pe-go">Add</button>
    </div>
    <div class="map-legend">First hire waits for M7 — positive contribution margin (Part 6 §8). Adding one here is the record, not the trigger.</div>
  </div>`;
  $('#pe-go').addEventListener('click', async () => {
    try { await api('/api/people', { method: 'POST', body: { name: $('#pe-name').value, role: $('#pe-role').value, type: $('#pe-type').value, actor: actor() } }); renderPeople(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderLegal() {
  const [contracts, vendors, products] = await Promise.all([api('/api/contracts'), api('/api/vendors'), api('/api/products')]);
  const NEXT = { draft: ['under_review'], under_review: ['signed', 'draft'], signed: ['expired'], expired: [] };
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New legal item — signing is human-only and named, always (Part 1 §6.1)</div>
    <div class="form-inline">
      <div><label class="fl">Kind</label><select id="lg-kind"><option>contract</option><option>tos</option><option>privacy</option><option>dpa</option><option>nda</option><option>provider-terms</option></select></div>
      <div style="flex:1.5"><label class="fl">Title</label><input type="text" id="lg-title"></div>
      <div><label class="fl">Counterparty</label><input type="text" id="lg-cp"></div>
      <div><label class="fl">Review due</label><input type="text" id="lg-due" placeholder="2026-12-01"></div>
      <div><label class="fl">Vendor</label><select id="lg-vendor"><option value="">—</option>${vendors.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Product</label><select id="lg-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="lg-go">Register</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Legal register</div>
    <table>
      <thead><tr><th>Kind</th><th>Title</th><th>Counterparty</th><th>State</th><th>Review due</th><th>Links</th><th>Actions</th></tr></thead>
      <tbody>${contracts.map((c) => `
        <tr>
          <td class="mono">${esc(c.kind)}</td>
          <td>${esc(c.title)}${c.signed_by ? `<div class="map-legend">signed by ${esc(c.signed_by)} · ${esc(c.signed_at || '')}</div>` : ''}</td>
          <td>${esc(c.counterparty)}</td>
          <td><span class="state state-${c.state === 'signed' ? 'done' : c.state === 'expired' ? 'failed' : 'awaiting_human'}">${esc(c.state)}</span></td>
          <td class="mono" style="color:${c.review_due && c.review_due < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(c.review_due || '—')}</td>
          <td>${c.vendor_id ? `<a class="chip chip-dim" style="text-decoration:none" href="#/vendors">${esc(c.vendor_id)}</a>` : ''}
              ${c.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(c.product_id)}</a>` : ''}
              ${c.decision_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/decisions/${esc(c.decision_id)}">${esc(c.decision_id)}</a>` : ''}</td>
          <td>${(NEXT[c.state] || []).map((s2) => `<button class="btn btn-sm ${s2 === 'signed' ? 'btn-ok' : ''}" data-lgstate="${c.id}" data-to="${s2}">${s2 === 'signed' ? `Sign as ${esc(actor())}` : '→ ' + s2}</button>`).join(' ')}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing registered. A5/A6 closure lives here (Part 7 §4).</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#lg-go').addEventListener('click', async () => {
    try {
      await api('/api/contracts', { method: 'POST', body: { kind: $('#lg-kind').value, title: $('#lg-title').value, counterparty: $('#lg-cp').value, reviewDue: $('#lg-due').value || null, vendorId: $('#lg-vendor').value || null, productId: $('#lg-prod').value || null, actor: actor() } });
      renderLegal();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-lgstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/contracts/${b.dataset.lgstate}/state`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderLegal(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderVendors() {
  const vendors = await api('/api/vendors');
  const total = vendors.filter((v) => v.state === 'active').reduce((a, v) => a + v.monthly_usd, 0);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><span>Vendor register — surprise renewals must be 0 (Part 2 §3.6)</span><span class="chip chip-ember">fixed burn ${esc(money(total))}/mo</span></div>
    <table>
      <thead><tr><th>Vendor</th><th>Service</th><th class="num">$/mo</th><th>Renewal</th><th>Owner</th><th>Contracts</th><th></th></tr></thead>
      <tbody>${vendors.map((v) => `
        <tr style="${v.state === 'cancelled' ? 'opacity:.5' : ''}">
          <td><b>${esc(v.name)}</b>${v.source === 'model-provider' ? ' <span class="chip chip-steel">provider</span>' : ''}</td>
          <td>${esc(v.service)}</td>
          <td class="num">${esc(money(v.monthly_usd))}</td>
          <td class="mono" style="color:${v.renewal_date && v.renewal_date <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) ? 'var(--warn)' : 'var(--ink-faint)'}">${esc(v.renewal_date || '—')}</td>
          <td class="mono">${esc(v.owner)}</td>
          <td>${v.contracts.map((c) => `<a class="chip ${c.state === 'signed' ? 'chip-ok' : 'chip-dim'}" style="text-decoration:none" href="#/legal">${esc(c.kind)}</a>`).join(' ') || '<span class="chip chip-warn">no contract</span>'}</td>
          <td>${v.state === 'active' ? `<button class="btn btn-sm btn-bad" data-vstate="${esc(v.id)}" data-to="cancelled">Cancel</button>` : `<button class="btn btn-sm btn-ok" data-vstate="${esc(v.id)}" data-to="active">Reactivate</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="panel">
    <div class="panel-title">Add a vendor</div>
    <div class="form-inline">
      <div><label class="fl">Name</label><input type="text" id="vn-name"></div>
      <div style="flex:1.5"><label class="fl">Service</label><input type="text" id="vn-svc"></div>
      <div><label class="fl">$/month</label><input type="text" id="vn-usd" value="0"></div>
      <div><label class="fl">Renewal</label><input type="text" id="vn-renew" placeholder="2027-01-01"></div>
      <button class="btn btn-primary" id="vn-go">Add</button>
    </div>
  </div>`;
  $('#vn-go').addEventListener('click', async () => {
    try { await api('/api/vendors', { method: 'POST', body: { name: $('#vn-name').value, service: $('#vn-svc').value, monthlyUsd: Number($('#vn-usd').value) || 0, renewalDate: $('#vn-renew').value || null, actor: actor() } }); renderVendors(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-vstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/vendors/${b.dataset.vstate}/state`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderVendors(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderKnowledge() {
  const entries = await api('/api/knowledge');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Organizational memory — unverified claims never become truth (Part 3 §8); verification is human-only</div>
    <div class="form-inline">
      <div><label class="fl">Layer</label><select id="kn-layer"><option>org</option><option>lesson</option><option>product</option><option>policy</option><option>project</option></select></div>
      <div style="flex:2"><label class="fl">Content</label><input type="text" id="kn-content"></div>
      <div><label class="fl">Source ref</label><input type="text" id="kn-src"></div>
      <button class="btn btn-primary" id="kn-go">Add</button>
    </div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Layer</th><th>Content</th><th>Source</th><th>Verification</th><th>By</th><th></th></tr></thead>
      <tbody>${entries.map((m) => `
        <tr style="${m.verification === 'retracted' ? 'opacity:.45;text-decoration:line-through' : ''}">
          <td class="mono">${esc(m.layer)}</td>
          <td>${esc(short(m.content, 90))}</td>
          <td class="mono" style="color:var(--ink-faint)">${(() => { const im = m.source_ref.match(/^incident:(\d+)$/); return im ? `<a href="#/incidents" style="color:var(--steel)">${esc(m.source_ref)}</a>` : esc(short(m.source_ref, 30)); })()}</td>
          <td><span class="chip ${m.verification === 'verified' ? 'chip-ok' : m.verification === 'retracted' ? 'chip-bad' : 'chip-warn'}">${esc(m.verification)}</span></td>
          <td class="mono" style="color:var(--ink-faint)">${esc(short(m.created_by, 20))}</td>
          <td>${m.verification === 'unverified' ? `
            <button class="btn btn-sm btn-ok" data-knv="${m.id}" data-to="verified">Verify (human)</button>
            <button class="btn btn-sm btn-bad" data-knv="${m.id}" data-to="retracted">Retract</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">Empty. Lessons from incidents land here.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#kn-go').addEventListener('click', async () => {
    try { await api('/api/knowledge', { method: 'POST', body: { layer: $('#kn-layer').value, content: $('#kn-content').value, sourceRef: $('#kn-src').value, actor: actor() } }); renderKnowledge(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-knv]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/knowledge/${b.dataset.knv}/verification`, { method: 'POST', body: { verification: b.dataset.to, actor: actor() } }); renderKnowledge(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderObjectives() {
  const [objectives, products] = await Promise.all([api('/api/objectives'), api('/api/products')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New objective</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="ob-title"></div>
      <div><label class="fl">Quarter</label><input type="text" id="ob-q" value="2026-Q3"></div>
      <div><label class="fl">Owner</label><input type="text" id="ob-owner" value="CEO"></div>
      <div><label class="fl">Product</label><select id="ob-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="ob-go">Create</button>
    </div>
    <div><label class="fl">Key results — one per line: description | target | unit</label><textarea id="ob-krs" placeholder="First paying customer | 1 | customers&#10;Escaped defects per release | 1 | defects"></textarea></div>
  </div>
  ${objectives.map((o) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(o.title)} <span class="chip chip-dim">${esc(o.quarter)}</span> <span class="chip">${esc(o.owner)}</span>${o.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(o.product_id)}</a>` : ''}</span>
      <span class="state state-${o.state === 'done' ? 'done' : o.state === 'dropped' ? 'failed' : 'running'}">${esc(o.state)}</span>
    </div>
    ${o.krs.map((kr, ki) => {
      const pct = kr.target ? Math.min(100, (Number(kr.current || 0) / Number(kr.target)) * 100) : 0;
      return `
      <div style="margin:8px 0">
        <div class="meter-label"><span>${esc(kr.kr)}</span><span class="mono">${esc(String(kr.current ?? 0))} / ${esc(String(kr.target))} ${esc(kr.unit || '')}</span></div>
        <div class="meter-track"><div class="meter-fill ${pct >= 100 ? '' : 'cool'}" style="width:${pct}%"></div></div>
        ${o.state === 'active' ? `<div class="form-inline" style="margin-top:4px"><div style="flex:0.3"><input type="text" data-krv="${esc(o.id)}:${ki}" value="${esc(String(kr.current ?? 0))}"></div><button class="btn btn-sm" data-krupd="${esc(o.id)}" data-ki="${ki}">Update</button></div>` : ''}
      </div>`;
    }).join('')}
    ${o.state === 'active' ? `<div style="margin-top:6px"><button class="btn btn-sm btn-ok" data-obstate="${esc(o.id)}" data-to="done">Mark done</button> <button class="btn btn-sm btn-bad" data-obstate="${esc(o.id)}" data-to="dropped">Drop</button></div>` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No objectives. The M-milestones (Part 1 §11) belong here.</div></div>'}`;

  $('#ob-go').addEventListener('click', async () => {
    const krs = $('#ob-krs').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [kr, target, unit] = l.split('|').map((x) => x.trim());
      return { kr, target: Number(target) || 1, current: 0, unit: unit || '' };
    });
    try { await api('/api/objectives', { method: 'POST', body: { title: $('#ob-title').value, quarter: $('#ob-q').value, owner: $('#ob-owner').value, productId: $('#ob-prod').value || null, krs, actor: actor() } }); renderObjectives(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-krupd]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.krupd; const ki = Number(b.dataset.ki);
    const o = objectives.find((x) => x.id === id);
    o.krs[ki].current = Number(view.querySelector(`[data-krv="${id}:${ki}"]`).value) || 0;
    try { await api(`/api/objectives/${id}/update`, { method: 'POST', body: { krs: o.krs, actor: actor() } }); renderObjectives(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-obstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/objectives/${b.dataset.obstate}/update`, { method: 'POST', body: { state: b.dataset.to, actor: actor() } }); renderObjectives(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderProjects() {
  const [projects, products] = await Promise.all([api('/api/projects'), api('/api/products').catch(() => [])]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New project</div>
    <div class="form-inline">
      <div style="flex:1.5"><label class="fl">Name</label><input type="text" id="pj-name"></div>
      <div><label class="fl">Owner</label><input type="text" id="pj-owner" value="${esc(currentUser?.username || '')}"></div>
      <div><label class="fl">Product</label><select id="pj-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="pj-go">Create</button>
    </div>
  </div>
  ${projects.map((p) => {
    const pct = p.tasks.total ? (p.tasks.done / p.tasks.total) * 100 : 0;
    return `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(p.name)} <span class="chip">${esc(p.owner)}</span>${p.product_id ? ` <a href="#/products" class="chip chip-ember" style="text-decoration:none">${esc(p.product_id)}</a>` : ''}</span>
      <span class="state state-${p.state === 'done' ? 'done' : p.state === 'active' ? 'running' : 'failed'}">${esc(p.state)}</span>
    </div>
    ${p.description ? `<div class="map-legend">${esc(p.description)}</div>` : ''}
    <div class="meter-label"><span><a href="#/tasks">${p.tasks.done}/${p.tasks.total} tasks</a>${p.tasks.blocked ? ` · <span style="color:var(--warn)">${p.tasks.blocked} blocked</span>` : ''}</span><span class="mono">${pct.toFixed(0)}%</span></div>
    <div class="meter-track"><div class="meter-fill ${pct >= 100 ? '' : 'cool'}" style="width:${pct}%"></div></div>
    ${p.state === 'active' ? `<div style="margin-top:8px">
      <button class="btn btn-sm" data-pjstate="${esc(p.id)}" data-to="paused">Pause</button>
      <button class="btn btn-sm btn-ok" data-pjstate="${esc(p.id)}" data-to="done">Done</button></div>`
      : p.state === 'paused' ? `<div style="margin-top:8px"><button class="btn btn-sm btn-ok" data-pjstate="${esc(p.id)}" data-to="active">Resume</button></div>` : ''}
  </div>`;
  }).join('') || '<div class="panel"><div class="empty">No projects yet.</div></div>'}`;
  $('#pj-go').addEventListener('click', async () => {
    try { await api('/api/projects', { method: 'POST', body: { name: $('#pj-name').value, owner: $('#pj-owner').value, productId: $('#pj-prod').value || null } }); renderProjects(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-pjstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/projects/${b.dataset.pjstate}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderProjects(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderTasksPage() {
  const [tasks, projects, agents, people] = await Promise.all([
    api('/api/tasks'), api('/api/projects').catch(() => []), api('/api/agents').catch(() => []), api('/api/people').catch(() => []),
  ]);
  const stChip = (s2) => `<span class="state state-${s2 === 'done' ? 'done' : s2 === 'doing' ? 'running' : s2 === 'blocked' ? 'awaiting_human' : s2 === 'cancelled' ? 'failed' : 'queued'}">${esc(s2)}</span>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New task — assign to a human, or delegate to an AI agent (they are the workforce)</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="tk2-title"></div>
      <div><label class="fl">Assignee</label>
        <select id="tk2-assignee">
          <optgroup label="AI agents">${agents.map((a) => `<option value="agent:${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</optgroup>
          <optgroup label="Humans">${people.map((p) => `<option value="human:${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>
        </select></div>
      <div><label class="fl">Project</label><select id="tk2-proj"><option value="">—</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Priority</label><select id="tk2-prio"><option>normal</option><option>high</option><option>critical</option><option>low</option></select></div>
      <button class="btn btn-primary" id="tk2-go">Create</button>
    </div>
    <div><label class="fl">Details</label><textarea id="tk2-details"></textarea></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Task</th><th>Assignee</th><th>Project</th><th>Priority</th><th>State</th><th>Actions</th></tr></thead>
      <tbody>${tasks.map((t) => `
        <tr>
          <td><b>${esc(t.title)}</b>${t.details ? `<div class="map-legend">${esc(short(t.details, 80))}</div>` : ''}</td>
          <td>${t.assignee_type === 'agent'
            ? `<a class="chip chip-steel" style="text-decoration:none" href="#/agents">🤖 ${esc(t.assignee_id || '')}</a>${t.run_id ? ' <a class="chip chip-dim" style="text-decoration:none" href="#/runs">run</a>' : ''}`
            : `<span class="chip">${esc(t.assignee_id || '—')}</span>`}</td>
          <td>${t.project_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/projects">${esc(t.project_id)}</a>` : '—'}</td>
          <td class="mono" style="color:${t.priority === 'critical' ? 'var(--bad)' : t.priority === 'high' ? 'var(--warn)' : 'var(--ink-mute)'}">${esc(t.priority)}</td>
          <td>${stChip(t.state)}</td>
          <td>${['todo', 'blocked'].includes(t.state) ? `<button class="btn btn-sm" data-tk2="${t.id}" data-to="doing">Start</button>` : ''}
              ${t.state !== 'done' && t.state !== 'cancelled' ? `<button class="btn btn-sm btn-ok" data-tk2="${t.id}" data-to="done">Done</button>
              <button class="btn btn-sm btn-bad" data-tk2="${t.id}" data-to="cancelled">✕</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No tasks.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#tk2-go').addEventListener('click', async () => {
    const [at, aid] = $('#tk2-assignee').value.split(':');
    try {
      await api('/api/tasks', { method: 'POST', body: { title: $('#tk2-title').value, details: $('#tk2-details').value || null, projectId: $('#tk2-proj').value || null, assigneeType: at, assigneeId: aid, priority: $('#tk2-prio').value } });
      toast(at === 'agent' ? 'Delegated — the agent is working now' : 'Task created'); renderTasksPage();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-tk2]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/tasks/${b.dataset.tk2}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderTasksPage(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderRisks() {
  const risks = await api('/api/risks');
  const scoreChip = (sc) => `<span class="chip ${sc >= 16 ? 'chip-bad' : sc >= 9 ? 'chip-warn' : 'chip-dim'}">${sc}</span>`;
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New risk — likelihood × impact, residual after designed controls (Part 7 §1)</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="rk-title"></div>
      <div style="flex:0.4"><label class="fl">L 1-5</label><input type="text" id="rk-l" value="3"></div>
      <div style="flex:0.4"><label class="fl">I 1-5</label><input type="text" id="rk-i" value="3"></div>
      <div><label class="fl">Owner</label><input type="text" id="rk-owner" value="${esc(currentUser?.username || '')}"></div>
      <div><label class="fl">Review</label><input type="text" id="rk-review" placeholder="2026-11-01"></div>
      <button class="btn btn-primary" id="rk-go">Register</button>
    </div>
    <div><label class="fl">Mitigation</label><input type="text" id="rk-mit"></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Risk</th><th class="num">L</th><th class="num">I</th><th class="num">Score</th><th>Mitigation</th><th>Owner</th><th>Review</th><th>State</th><th></th></tr></thead>
      <tbody>${risks.map((r) => `
        <tr style="${r.state === 'closed' ? 'opacity:.5' : ''}">
          <td>${esc(r.title)}${r.source === 'blueprint' ? ' <span class="chip chip-dim">blueprint</span>' : ''}</td>
          <td class="num">${r.likelihood}</td><td class="num">${r.impact}</td>
          <td class="num">${scoreChip(r.score)}</td>
          <td>${esc(short(r.mitigation || '—', 60))}</td>
          <td class="mono">${esc(r.owner)}</td>
          <td class="mono" style="color:${r.review_date && r.review_date < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(r.review_date || '—')}</td>
          <td><span class="state state-${r.state === 'open' ? 'failed' : r.state === 'closed' ? 'done' : 'awaiting_human'}">${esc(r.state)}</span></td>
          <td>${r.state !== 'closed' ? ['mitigated', 'accepted', 'closed'].filter((x) => x !== r.state).map((x) => `<button class="btn btn-sm" data-rk="${r.id}" data-to="${x}">${x}</button>`).join(' ') : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
  $('#rk-go').addEventListener('click', async () => {
    try { await api('/api/risks', { method: 'POST', body: { title: $('#rk-title').value, likelihood: $('#rk-l').value, impact: $('#rk-i').value, mitigation: $('#rk-mit').value || null, owner: $('#rk-owner').value, reviewDate: $('#rk-review').value || null } }); renderRisks(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-rk]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/risks/${b.dataset.rk}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderRisks(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderQuality() {
  const qd = await api('/api/quality');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${qd.evalAvg != null && qd.evalAvg < 0.8 ? 'tile-warn' : ''}"><div class="panel-title">Eval average (last 10)</div><div class="big">${qd.evalAvg != null ? Math.round(qd.evalAvg * 100) + '<span class="unit">%</span>' : '—'}</div><div class="sub"><a href="#/evals">run the sets →</a></div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Last canary</div><div class="big">${qd.canaryLast ? Math.round(qd.canaryLast.score * 100) + '<span class="unit">%</span>' : '—'}</div><div class="sub">${qd.canaryLast ? esc(qd.canaryLast.created_at.slice(0, 10)) : 'never run'}</div></div>
    <div class="panel tile ${qd.failedRuns7d ? 'tile-warn' : ''}"><div class="panel-title">Failed runs · 7d</div><div class="big">${qd.failedRuns7d}</div><div class="sub"><a href="#/runs">runs →</a></div></div>
    <div class="panel tile ${qd.openProblems + qd.openIncidents ? 'tile-warn' : ''}"><div class="panel-title">Open problems + incidents</div><div class="big">${qd.openProblems + qd.openIncidents}</div><div class="sub"><a href="#/incidents">incidents →</a> · <a href="#/governance">problems →</a></div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Manual quality review — drills are the proof (Part 5 §1.5)</div>
    <div class="form-inline">
      <div style="flex:1.5"><label class="fl">Area audited</label><input type="text" id="qr-area" placeholder="e.g. backup restore drill, support drafts sample"></div>
      <div><label class="fl">Verdict</label><select id="qr-verdict"><option>pass</option><option>fail</option></select></div>
      <button class="btn btn-primary" id="qr-go">Record</button>
    </div>
    <div><label class="fl">Notes</label><input type="text" id="qr-notes"></div>
  </div>
  <div class="panel">
    <table>
      <thead><tr><th>Area</th><th>Verdict</th><th>Notes</th><th>Reviewer</th><th>When</th></tr></thead>
      <tbody>${qd.reviews.map((r) => `
        <tr><td>${esc(r.area)}</td>
        <td><span class="chip ${r.verdict === 'pass' ? 'chip-ok' : 'chip-bad'}">${esc(r.verdict)}</span></td>
        <td>${esc(short(r.notes || '—', 70))}</td>
        <td class="mono">${esc(r.reviewer)}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(r.created_at.slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No reviews recorded.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  $('#qr-go').addEventListener('click', async () => {
    try { await api('/api/quality/review', { method: 'POST', body: { area: $('#qr-area').value, verdict: $('#qr-verdict').value, notes: $('#qr-notes').value || null } }); renderQuality(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderFinance() {
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

async function renderOversight() {
  const o = await api('/api/oversight');
  view.innerHTML = `
  <div class="grid grid-3">
    <div class="panel">
      <div class="panel-title"><span>Chain</span><span class="chip ${o.chain.ok ? 'chip-ok' : 'chip-bad'}">${o.chain.ok ? `intact · ${o.chain.checked}` : 'BROKEN'}</span></div>
      <div class="panel-title" style="margin-top:10px">Human actions · 7d</div>
      ${o.humanActions7d.map((h) => `<div class="meter-label"><span class="mono">${esc(h.actor_id)}</span><span class="mono">${h.n}</span></div>`).join('') || '<div class="empty">quiet</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Suspended agents</div>
      ${o.suspendedAgents.map((a) => `<div class="meter-label"><a class="mono" href="#/agents" style="color:var(--bad)">${esc(a.id)}</a><span class="mono">${esc(a.human_owner)}</span></div>`).join('') || '<div class="empty">none</div>'}
      <div class="panel-title" style="margin-top:10px">Frozen budgets</div>
      ${o.frozenBudgets.map((b) => `<div class="meter-label"><a class="mono" href="#/budgets" style="color:var(--warn)">${esc(b.scope)}/${esc(b.scope_id)}</a><span class="mono">${esc(money4(b.spent_usd))}/${esc(money(b.cap_usd))}</span></div>`).join('') || '<div class="empty">none</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">The rule</div>
      <div class="map-legend" style="font-size:11.5px;line-height:1.7">Agents execute; humans are accountable — always. Every approval below carries a named human. Suspension and freezes are reversible containment; resumption is a human decision recorded on the chain.</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Approvals ledger — who approved what</div>
    <table>
      <thead><tr><th class="num">#</th><th>Gate</th><th>Subject</th><th>Verdict</th><th>Approver</th><th>Note</th><th>When</th></tr></thead>
      <tbody>${o.approvals.map((a) => `
        <tr><td class="num">${a.id}</td>
        <td class="mono">${esc(a.gate)}</td>
        <td class="mono">${esc(a.subject_type)}${a.agent_id ? ` <span class="chip chip-dim">${esc(a.agent_id)}</span>` : ''}</td>
        <td><span class="chip ${a.verdict === 'approved' ? 'chip-ok' : 'chip-bad'}">${esc(a.verdict)}</span></td>
        <td class="mono" style="color:var(--steel)">${esc(a.approver_human)}</td>
        <td>${esc(short(a.note || '—', 40))}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(a.created_at.slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No approvals yet.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

async function renderUsers() {
  const [users, perms] = await Promise.all([api('/api/users'), api('/api/perms')]);
  const groups = {};
  for (const p of perms) { const g = p.split('.')[0]; (groups[g] ||= []).push(p); }
  const permBoxes = (checked = [], prefix = 'np') => Object.entries(groups).map(([g, list]) => `
    <div style="margin:4px 0"><span class="mono" style="color:var(--ink-faint);font-size:10px;text-transform:uppercase;letter-spacing:.15em">${esc(g)}</span><br>
    ${list.map((p) => `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-family:var(--font-mono);font-size:11px"><input type="checkbox" class="${prefix}-perm" value="${esc(p)}" ${checked.includes(p) ? 'checked' : ''}>${esc(p.split('.')[1])}</label>`).join('')}</div>`).join('');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Create user — grant exactly the permissions they need, down to a single one</div>
    <div class="form-inline">
      <div><label class="fl">Username</label><input type="text" id="us-name"></div>
      <div><label class="fl">Display name</label><input type="text" id="us-disp"></div>
      <div><label class="fl">Password</label><input type="password" id="us-pass"></div>
      <button class="btn btn-primary" id="us-go">Create</button>
    </div>
    <div class="panel-title" style="margin-top:10px">Permissions</div>
    ${permBoxes([], 'np')}
  </div>
  ${users.map((u) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(u.display_name)} <span class="mono" style="letter-spacing:0;color:var(--ink-faint)">@${esc(u.username)}</span>
        <span class="chip ${u.role === 'superadmin' ? 'chip-ember' : 'chip-dim'}">${esc(u.role)}</span></span>
      <span>
        <span class="chip ${u.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(u.status)}</span>
        ${u.role !== 'superadmin' ? `<button class="btn btn-sm ${u.status === 'active' ? 'btn-bad' : 'btn-ok'}" data-ustatus="${u.id}" data-to="${u.status === 'active' ? 'disabled' : 'active'}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''}
        <button class="btn btn-sm" data-utoggle="${u.id}">Edit</button>
      </span>
    </div>
    <div class="agent-meta">${u.role === 'superadmin' ? '<span class="chip chip-ember">* — everything</span>' : u.perms.map((p) => `<span class="chip">${esc(p)}</span>`).join('') || '<span class="chip chip-warn">no permissions</span>'}</div>
    <div data-uedit="${u.id}" hidden style="margin-top:10px">
      ${u.role !== 'superadmin' ? `<div class="panel-title">Permissions</div>${permBoxes(u.perms, `up${u.id}`)}
      <button class="btn btn-sm btn-ok" data-usaveperms="${u.id}">Save permissions</button>` : ''}
      <div class="form-inline" style="margin-top:8px">
        <div><input type="password" data-unewpass="${u.id}" placeholder="new password"></div>
        <button class="btn btn-sm" data-uresetpw="${u.id}">Reset password</button>
      </div>
    </div>
  </div>`).join('')}`;
  $('#us-go').addEventListener('click', async () => {
    const permsSel = [...view.querySelectorAll('.np-perm:checked')].map((c) => c.value);
    try { await api('/api/users', { method: 'POST', body: { username: $('#us-name').value, displayName: $('#us-disp').value || null, password: $('#us-pass').value, perms: permsSel } }); toast('User created'); renderUsers(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-utoggle]').forEach((b) => b.addEventListener('click', () => {
    const d = view.querySelector(`[data-uedit="${b.dataset.utoggle}"]`); d.hidden = !d.hidden;
  }));
  view.querySelectorAll('[data-ustatus]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/users/${b.dataset.ustatus}/update`, { method: 'POST', body: { status: b.dataset.to } }); renderUsers(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-usaveperms]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.usaveperms;
    const sel = [...view.querySelectorAll(`.up${id}-perm:checked`)].map((c) => c.value);
    try { await api(`/api/users/${id}/update`, { method: 'POST', body: { perms: sel } }); toast('Permissions saved'); renderUsers(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-uresetpw]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.uresetpw;
    const pw = view.querySelector(`[data-unewpass="${id}"]`).value;
    try { await api(`/api/users/${id}/update`, { method: 'POST', body: { password: pw } }); toast('Password reset'); } catch (e) { toast(e.message, true); }
  }));
}

async function renderSettings() {
  const s = await api('/api/settings');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">AI providers — keys are stored locally (SQLite), never echoed back; a secret manager replaces this in real deployment (Part 3 §6.3)</div>
    <table>
      <thead><tr><th>Provider</th><th>Key / flag</th><th>Status</th><th>Set value</th><th></th></tr></thead>
      <tbody>${s.providers.map((p) => `
        <tr>
          <td><b>${esc(p.provider)}</b> <span class="chip chip-dim">${esc(p.kind)}</span></td>
          <td class="mono" style="font-size:11px">${esc(p.keyName)}${p.configured && p.tail ? ` <span style="color:var(--ink-faint)">····${esc(p.tail)}</span>` : ''}${p.source ? ` <span class="chip chip-dim">${esc(p.source)}</span>` : ''}</td>
          <td>${p.available ? '<span class="chip chip-ok">available</span>' : '<span class="chip chip-warn">off</span>'}</td>
          <td>${p.kind === 'claude-cli'
            ? `<select data-skey="${esc(p.keyName)}" style="width:auto"><option value="true" ${p.configured ? 'selected' : ''}>enabled</option><option value="" ${p.configured ? '' : 'selected'}>disabled</option></select>`
            : `<input type="password" data-skey="${esc(p.keyName)}" placeholder="${p.configured ? 'replace key…' : 'paste API key…'}" style="width:220px">`}</td>
          <td><button class="btn btn-sm btn-ok" data-ssave="${esc(p.keyName)}">Save</button>
              ${p.configured && p.source === 'settings' ? `<button class="btn btn-sm btn-bad" data-sclear="${esc(p.keyName)}">Clear</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="form-inline" style="margin-top:12px">
      <span class="chip ${s.mockMode ? 'chip-warn' : 'chip-ok'}">${s.mockMode ? 'MOCK MODE' : 'LIVE'}</span>
      <button class="btn btn-sm" id="s-mock">${s.mockForced ? 'Disable forced mock' : 'Force mock mode'}</button>
      <button class="btn btn-sm" id="s-probe">Test connectivity (T1)</button>
      <span id="s-probe-out" class="mono" style="color:var(--ink-mute)"></span>
    </div>
  </div>`;
  view.querySelectorAll('[data-ssave]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.ssave;
    const el = view.querySelector(`[data-skey="${key}"]`);
    try { await api('/api/settings', { method: 'POST', body: { key, value: el.value } }); toast('Saved — takes effect immediately'); renderSettings(); refreshShell(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sclear]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: b.dataset.sclear, value: null } }); renderSettings(); refreshShell(); } catch (e) { toast(e.message, true); }
  }));
  $('#s-mock').addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { key: 'CRUCIBLE_MOCK', value: s.mockForced ? null : 'true' } }); renderSettings(); refreshShell(); } catch (e) { toast(e.message, true); }
  });
  $('#s-probe').addEventListener('click', async (e) => {
    e.target.disabled = true; $('#s-probe-out').textContent = 'probing…';
    try { const r = await api('/api/providers/test', { method: 'POST', body: { tier: 'T1' } }); $('#s-probe-out').textContent = `${r.provider}/${r.model} · ${short(r.text, 60)}`; }
    catch (err) { $('#s-probe-out').textContent = 'failed: ' + err.message; }
    e.target.disabled = false;
  });
}

async function renderAgents() {
  const agents = await api('/api/agents');
  const groups = {};
  for (const a of agents) (groups[a.role_group] ||= []).push(a);
  view.innerHTML = Object.entries(groups).map(([g, list]) => `
    <div>
      <div class="panel-title" style="margin-bottom:8px">${esc(g)}</div>
      <div class="grid grid-3">
        ${list.map((a) => `
        <div class="panel agent-card">
          <div class="agent-head">
            <span class="agent-name">${esc(a.name)}</span>
            <span class="chip ${a.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(a.status)}</span>
          </div>
          <div class="agent-id">${esc(a.id)} · owner ${esc(a.human_owner)}</div>
          <div class="agent-meta">
            <span class="chip">${esc(a.model_tier)}</span>
            ${a.accuracy ? `<span class="chip ${a.accuracy.factor >= 1 ? 'chip-ok' : 'chip-warn'}" title="gate ✓${a.accuracy.signals.gateApproved} ✗${a.accuracy.signals.gateRejected} · eval ${a.accuracy.signals.lastEvalScore ?? '—'}">rep ${a.accuracy.factor}</span>` : ''}
            ${a.spec?.familyNot ? `<span class="chip chip-ember">family ≠ ${esc(a.spec.familyNot)}</span>` : ''}
            <span class="chip">${esc(a.spec?.failMode || '')}</span>
            ${a.spec?.confidenceFloor ? `<span class="chip">floor ${a.spec.confidenceFloor}</span>` : ''}
            <span class="chip">${esc(a.spec?.sensitivity || 'internal')}</span>
          </div>
          <div>
            <button class="btn btn-sm ${a.status === 'active' ? 'btn-bad' : 'btn-ok'}" data-agent="${esc(a.id)}" data-to="${a.status === 'active' ? 'suspended' : 'active'}">
              ${a.status === 'active' ? 'Suspend' : 'Reactivate'}
            </button>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');
  view.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/agents/${b.dataset.agent}/status`, { method: 'POST', body: { status: b.dataset.to, actor: actor() } });
      toast(`${b.dataset.agent} → ${b.dataset.to}`); renderAgents();
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderBudgets() {
  const rows = await api('/api/budgets');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">Budget scopes — reservation-first; the hard stop fires before the call</div>
    <table>
      <thead><tr><th>Scope</th><th>ID</th><th>Period</th><th style="width:30%">Consumption</th><th class="num">Spent</th><th class="num">Cap</th><th></th></tr></thead>
      <tbody>${rows.map((b) => {
        const pct = Math.min(100, ((b.spent_usd + b.reserved_usd) / b.cap_usd) * 100);
        return `
        <tr>
          <td class="mono">${esc(b.scope)}</td><td class="mono">${esc(b.scope_id)}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(b.period_key)}</td>
          <td><div class="meter-track"><div class="meter-fill ${pct > 80 ? 'hot' : pct > 50 ? '' : 'cool'}" style="width:${pct}%"></div></div></td>
          <td class="num">${esc(money4(b.spent_usd))}</td>
          <td class="num">${esc(money(b.cap_usd))}</td>
          <td>${b.frozen
            ? `<button class="btn btn-sm btn-ok" data-freeze="0" data-scope="${esc(b.scope)}" data-sid="${esc(b.scope_id)}">Unfreeze</button>`
            : `<button class="btn btn-sm btn-bad" data-freeze="1" data-scope="${esc(b.scope)}" data-sid="${esc(b.scope_id)}">Freeze</button>`}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No budget rows yet — they materialize on first spend.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-freeze]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/budgets/freeze', { method: 'POST', body: { scope: b.dataset.scope, scopeId: b.dataset.sid, frozen: b.dataset.freeze === '1', actor: actor() } });
      toast(b.dataset.freeze === '1' ? 'Scope frozen' : 'Scope unfrozen — human decision recorded'); renderBudgets();
    } catch (e) { toast(e.message, true); }
  }));
}

async function renderAudit() {
  const [rows, chain] = await Promise.all([api('/api/audit?limit=150'), api('/api/audit/verify')]);
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">
      <span>Append-only hash chain</span>
      <span class="chip ${chain.ok ? 'chip-ok' : 'chip-bad'}">${chain.ok ? `intact · ${chain.checked} entries` : `BROKEN at seq ${chain.brokenAt}`}</span>
    </div>
    <table>
      <thead><tr><th class="num">Seq</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Hash</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="num">${r.seq}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.occurred_at)}</td>
          <td class="mono">${esc(r.actor_type)}:${esc(short(r.actor_id, 22))}</td>
          <td class="mono" style="color:${r.actor_type === 'human' ? 'var(--steel)' : 'var(--ink)'}">${esc(r.action)}</td>
          <td class="mono">${(() => { const h = linkFor(r.subject_type, r.subject_id); const label = esc(short((r.subject_type || '') + ' ' + (r.subject_id || ''), 30)); return h ? `<a href="${h}" style="color:var(--steel)">${label}</a>` : `<span style="color:var(--ink-faint)">${label}</span>`; })()}</td>
          <td class="mono" style="color:var(--ink-faint)">${esc(r.hash.slice(0, 10))}…</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

async function renderProviders() {
  const p = await api('/api/providers');
  view.innerHTML = `
  ${p.mockMode ? '<div class="panel" style="border-color:var(--warn)"><div class="panel-title" style="color:var(--warn)">Mock mode</div>No provider keys configured — every call is served by the deterministic mock at zero cost. Add keys to <span class="mono">.env</span> and restart to go live.</div>' : ''}
  <div class="grid grid-3">
    ${p.providers.map((pr) => `
    <div class="panel agent-card">
      <div class="agent-head">
        <span class="agent-name">${esc(pr.name)}</span>
        <span class="chip ${pr.available ? 'chip-ok' : 'chip-dim'}">${pr.available ? 'available' : 'no key'}</span>
      </div>
      <div class="agent-id">family: ${esc(pr.family)} · ${esc(pr.kind)}</div>
      <div class="agent-meta">
        ${pr.models.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}
      </div>
      <div class="agent-meta">
        ${pr.dpa ? '<span class="chip chip-ok">DPA</span>' : '<span class="chip chip-warn">no DPA</span>'}
        ${pr.noTraining ? '<span class="chip chip-ok">no-training</span>' : '<span class="chip chip-warn">may train</span>'}
        ${pr.keyEnv ? `<span class="chip">${esc(pr.keyEnv)}</span>` : ''}
      </div>
    </div>`).join('')}
  </div>
  <div class="panel">
    <div class="panel-title">Routing tiers — pinned chains, fail-closed where it matters</div>
    <table>
      <thead><tr><th>Tier</th><th>Purpose</th><th>Chain</th><th>On exhausted</th></tr></thead>
      <tbody>${Object.entries(p.tiers).map(([t, cfg]) => `
        <tr>
          <td class="mono">${esc(t)}</td><td>${esc(cfg.purpose)}</td>
          <td class="mono">${(cfg.chain || cfg.pair || []).map((s) => `${esc(s.provider)}/${esc(s.model)}`).join(' → ')}</td>
          <td class="mono" style="color:var(--warn)">${esc(cfg.onExhausted || '')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px"><button class="btn btn-primary" id="probe">Test connectivity (T1 probe)</button> <span id="probe-out" class="mono" style="margin-left:10px;color:var(--ink-mute)"></span></div>
  </div>`;
  $('#probe').addEventListener('click', async (e) => {
    e.target.disabled = true; $('#probe-out').textContent = 'probing…';
    try {
      const r = await api('/api/providers/test', { method: 'POST', body: {} });
      $('#probe-out').textContent = `${r.provider}/${r.model} · ${money4(r.costUsd)} · ${short(r.text, 90)}`;
    } catch (err) { $('#probe-out').textContent = 'failed: ' + err.message; }
    e.target.disabled = false;
  });
}

// boot — authenticate first, then bring up the console.
(async function boot() {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    $('#who').textContent = `${currentUser.displayName} · ${currentUser.role === 'superadmin' ? 'superadmin' : currentUser.perms.length + ' perms'}`;
    applyNavGating();
    refreshShell();
    navigate();
  } catch { showLogin(); }
})();
