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
  partner: '#/relations', interaction: '#/relations', journey: `#/journeys/${id}`, workforce: '#/workforce',
  channel: '#/social', post: '#/social', content: '#/content', design: '#/design',
  deal: '#/sales', automation: '#/autopilot',
  blueprint: '#/systems', infraPlan: '#/infra', finReport: '#/finreports',
  request: `#/requests/${id}`, intelQuery: '#/intel',
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

/**
 * Download a file from an authenticated endpoint.
 * A plain <a download> can't carry the session header, so the server answered
 * those links with a 401 JSON body — which is what the browser saved. This
 * fetches with the token, then hands the real blob to a temporary link.
 */
async function downloadFile(path, fallbackName = 'export.csv') {
  try {
    const res = await fetch(path, { headers: { 'x-auth-token': localStorage.getItem(TOKEN_KEY) || '' } });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
      if (res.status === 401) showLogin();
      throw new Error(msg);
    }
    const cd = res.headers.get('content-disposition') || '';
    const name = cd.match(/filename="?([^";]+)"?/)?.[1] || fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloaded ${name}`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, true);
  }
}

/** Wire every [data-download] button on the current page. */
function wireDownloads() {
  view.querySelectorAll('[data-download]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadFile(b.dataset.download, b.dataset.filename || 'export.csv');
  }));
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
  workforce: 'workforce.view', relations: 'relations.view', journeys: 'journeys.view', journey: 'journeys.view',
  social: 'social.view', content: 'content.view', design: 'design.view',
  sales: 'sales.view', autopilot: 'autopilot.view', scorecard: 'dashboard.view', graph: 'dashboard.view',
  systems: 'systems.view', system: 'systems.view', infra: 'infra.view', finreports: 'finreports.view',
  harmony: 'harmony.view', requests: 'requests.view', request: 'requests.view',
  pricing: 'pricing.view', success: 'success.view', assets: 'assets.view',
  localization: 'localization.view', marketwatch: 'marketwatch.view', enablement: 'enablement.view',
  org: 'org.view', disputes: 'disputes.view', owner: 'dashboard.view', society: 'org.view',
  security: 'security.view', compliance: 'compliance.view', sustainability: 'sustainability.view',
  capacity: 'capacity.view', lab: 'lab.view', releases: 'releases.view', pmo: 'pmo.view',
  insights: 'insights.view', brand: 'brand.view', procurement: 'procurement.view', finops: 'finops.view',
  recruiting: 'recruiting.view', academy: 'academy.view', board: 'board.view', ir: 'ir.view', comms: 'comms.view',
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
    const [health, chain, stats, notif, journeys] = await Promise.all([
      api('/api/health'), api('/api/audit/verify'), api('/api/stats'), api('/api/notifications?unread=1'),
      api('/api/journeys').catch(() => []),
    ]);
    $('#alert-count').textContent = notif.unread || '';
    const jc = $('#journey-count');
    if (jc) jc.textContent = journeys.filter((j) => j.state === 'awaiting_human').length || '';
    const rc = $('#req-count');
    if (rc) {
      const reqs = await api('/api/requests').catch(() => null);
      rc.textContent = reqs?.open || '';
    }
    const dc = $('#dispute-count');
    if (dc) {
      const dis = await api('/api/disputes').catch(() => null);
      dc.textContent = dis?.awaitingOwner || '';
    }
    const mode = $('#mode-chip');
    mode.textContent = health.mockMode ? 'MOCK MODE' : 'LIVE';
    mode.className = 'chip ' + (health.mockMode ? 'chip-warn' : 'chip-ok');
    const cc = $('#chain-chip');
    cc.textContent = chain.ok ? `chain ✓ ${chain.checked}` : `chain BROKEN @${chain.brokenAt}`;
    cc.className = 'chip ' + (chain.ok ? 'chip-ok' : 'chip-bad');
    // The badge counts everything waiting on a person, not just runs — that
    // gap is why a written document could sit blocked with no visible signal.
    $('#gate-count').textContent = stats.inboxTotal || stats.awaitingHuman || '';
  } catch { /* server restarting */ }
}
setInterval(refreshShell, 7000);
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-GB'); }, 1000);

// ---------- router ----------
let pollTimer = null;
const routes = {
  '': { title: 'Overview', render: renderOverview, poll: 5000 },
  gate: { title: 'Approvals inbox — everything waiting on a human', render: renderGate, poll: 6000 },
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
  workforce: { title: 'Workforce — AI Employees', render: renderWorkforce, poll: 6000 },
  relations: { title: 'Relations (RM)', render: renderRelations, poll: 8000 },
  journeys: { title: 'Company Journeys', render: renderJourneys, poll: 5000 },
  journey: { title: 'Journey', render: renderJourneyDetail, poll: 4000 },
  social: { title: 'Social Media Desk', render: renderSocial, poll: 5000 },
  content: { title: 'Content Studio', render: renderContent, poll: 6000 },
  design: { title: 'Design Studio', render: renderDesign, poll: 6000 },
  sales: { title: 'Sales — Deals Pipeline', render: renderSales, poll: 6000 },
  autopilot: { title: 'Autopilot — the Nexus', render: renderAutopilot, poll: 5000 },
  scorecard: { title: 'Company Scorecard', render: renderScorecard, poll: 8000 },
  graph: { title: 'Relationship Graph', render: renderGraph, poll: 10000 },
  owner: { title: 'Owner console', render: renderOwner, poll: 10000 },
  org: { title: 'Org & personas', render: renderOrg },
  society: { title: 'The society — colleagues at work and off it', render: renderSociety, poll: 20000 },
  disputes: { title: 'Disputes — HR arbitrates, the owner rules', render: renderDisputes, poll: 8000 },
  pricing: { title: 'Pricing', render: makeDeptRenderer('pricing'), poll: 8000 },
  success: { title: 'Customer success', render: makeDeptRenderer('success'), poll: 8000 },
  assets: { title: 'Assets', render: makeDeptRenderer('assets') },
  localization: { title: 'Localization', render: makeDeptRenderer('localization'), poll: 6000 },
  marketwatch: { title: 'Market watch', render: makeDeptRenderer('marketwatch'), poll: 8000 },
  enablement: { title: 'Enablement', render: makeDeptRenderer('enablement'), poll: 8000 },
  requests: { title: 'Request desk', render: renderRequests, poll: 4000 },
  request: { title: 'Request', render: renderRequestDetail, poll: 4000 },
  harmony: { title: 'Harmony — the orchestrator', render: renderHarmony, poll: 8000 },
  systems: { title: 'System Design Studio', render: renderSystems, poll: 5000 },
  system: { title: 'Design Document', render: renderDesignDoc, poll: 8000 },
  infra: { title: 'Infrastructure', render: renderInfra, poll: 6000 },
  finreports: { title: 'Financial Reporting', render: renderFinReports, poll: 8000 },
  agents: { title: 'Agents', render: renderAgents },
  budgets: { title: 'Budgets', render: renderBudgets, poll: 8000 },
  audit: { title: 'Audit Chain', render: renderAudit, poll: 8000 },
  providers: { title: 'Providers', render: renderProviders },
  security: { title: 'Security Operations (SOC)', render: renderSecurity, poll: 8000 },
  compliance: { title: 'Compliance', render: renderCompliance },
  sustainability: { title: 'Sustainability', render: renderSustainability, poll: 15000 },
  capacity: { title: 'Capacity planning', render: renderCapacity, poll: 5000 },
  lab: { title: 'The Lab — A/B experiments', render: renderLab, poll: 5000 },
  releases: { title: 'Releases', render: renderReleases, poll: 6000 },
  pmo: { title: 'PMO — stage gates', render: renderPmo, poll: 8000 },
  insights: { title: 'Insights', render: renderInsights, poll: 10000 },
  brand: { title: 'Brand studio', render: renderBrand, poll: 6000 },
  procurement: { title: 'Procurement', render: renderProcurement, poll: 8000 },
  finops: { title: 'FinOps', render: renderFinops, poll: 10000 },
  recruiting: { title: 'Recruiting — hire AI employees', render: renderRecruiting, poll: 5000 },
  academy: { title: 'Academy', render: renderAcademy, poll: 8000 },
  board: { title: 'Board room', render: renderBoard, poll: 8000 },
  ir: { title: 'Investor relations', render: renderIr, poll: 8000 },
  comms: { title: 'Internal comms', render: renderComms, poll: 8000 },
};

// ---------- auto-refresh guard ----------
// Live pages re-render themselves on a timer, which replaces the whole view.
// That must never happen while someone is filling a form: it would steal
// focus and wipe what they typed. Polling pauses whenever a field is focused
// or holds unsaved input, and resumes by itself once the form is clean.
function isEditingField() {
  const el = document.activeElement;
  if (!el || !view.contains(el)) return false;
  return el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function hasUnsavedInput() {
  for (const el of view.querySelectorAll('input, textarea')) {
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
    else if (el.value !== el.defaultValue) return true;
  }
  for (const el of view.querySelectorAll('select')) {
    for (const o of el.options) if (o.selected !== o.defaultSelected) return true;
  }
  return false;
}

function pollPaused() {
  return document.hidden || isEditingField() || hasUnsavedInput();
}

function showPollState(paused) {
  const chip = $('#poll-chip');
  if (!chip) return;
  chip.hidden = !paused;
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = hash.split('/');
  if (seg === 'decisions' && arg) return { key: 'decision', arg };
  if (seg === 'journeys' && arg) return { key: 'journey', arg };
  if (seg === 'systems' && arg) return { key: 'system', arg: hash.split('/').slice(1).join('/') };
  if (seg === 'requests' && arg) return { key: 'request', arg };
  if (seg === 'artifacts' && arg) return { key: 'artifacts', arg: decodeURIComponent(arg) };
  return { key: routes[seg] ? seg : '', arg: null };
}

async function navigate() {
  clearInterval(pollTimer);
  showPollState(false);
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
  if (r.poll) {
    pollTimer = setInterval(() => {
      // Never re-render out from under someone who is typing.
      if (pollPaused()) { showPollState(true); return; }
      showPollState(false);
      r.render(arg).catch(() => {});
    }, r.poll);
  }
}
window.addEventListener('hashchange', navigate);

// Update the paused indicator as soon as the form goes clean or dirty, so the
// state is never a surprise — it reacts to typing, not just to the next tick.
for (const evt of ['input', 'focusin', 'focusout', 'change']) {
  view.addEventListener(evt, () => showPollState(Boolean(routes[currentRoute().key]?.poll) && pollPaused()));
}

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

// ---------- system map · interactive metro v4 ----------
// Seven colored lines — the whole company on one board, every line ending at
// the AUDIT interchange. INTERACTIVE: hover a station and the rest of the
// board dims while a tooltip explains what lives there; the moving dots are
// work flowing through the company; click any station to travel to it.
function buildSystemMap(s, prov, agentsList, chain, extra = {}) {
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

  return `<svg class="metro" viewBox="0 0 1000 700" role="img" aria-label="Interactive system metro map — lines are departments, connectors are the Nexus automations between them">
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

// ---------- system map v6 · the constellation ----------
// The metro map drew departments as parallel lines, which was a lie about how
// the company works: the traffic is lateral. This draws the real graph — every
// section positioned in its division's arc, every edge an actual join in the
// database with its live count. Hovering a section isolates its neighbourhood,
// so "what touches this?" is answered by looking, not by clicking through.
function buildConstellation(map) {
  const { divisions, sections, edges, harmony, audit: connAudit } = map;
  const CX = 500, CY = 430, R_IN = 150, R_OUT = 392;
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) (byDiv[s.division] || byDiv.govern).items.push(s);

  // Each division owns an angular wedge; its sections spread across that wedge
  // on two radii so dense divisions stay readable.
  const pos = {};
  const arcs = [];
  const divs = divisions.filter((d) => byDiv[d.id].items.length);
  const span = 360 / divs.length;
  divs.forEach((d, di) => {
    const items = byDiv[d.id].items;
    const a0 = di * span - 90;
    arcs.push({ ...d, a0, a1: a0 + span, count: items.length });
    items.forEach((s, i) => {
      const ring = i % 2;
      const step = span / (items.length + 1);
      const ang = ((a0 + step * (i + 1) + (ring ? step * 0.18 : -step * 0.18)) * Math.PI) / 180;
      const r = ring ? R_OUT : R_OUT - 96;
      pos[s.id] = { x: CX + r * Math.cos(ang) * 1.12, y: CY + r * Math.sin(ang) * 0.72, div: d.id, color: d.color, s };
    });
  });

  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const nodeR = (c) => Math.max(6, Math.min(15, 6 + Math.log10(Math.max(1, c)) * 4.5));

  // Edges bend toward the centre, which bundles them and keeps the middle
  // legible instead of a hairball.
  const edgeSvg = edges.map((e, i) => {
    const a = pos[e.from]; const b = pos[e.to];
    if (!a || !b) return '';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const bx = mx + (CX - mx) * 0.45, by = my + (CY - my) * 0.45;
    const w = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 3.2 : 0.8;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
      d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"
      stroke="${a.color}" stroke-width="${w.toFixed(2)}"><title>${esc(e.from)} → ${esc(e.to)}: ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  // Universal edges (everything → audit, everything → archive) are drawn as
  // faint spokes to the core rather than 45 individual lines.
  const spokes = Object.values(pos).map((p) =>
    `<line class="cx-spoke" data-spoke="${esc(p.s.id)}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${CX}" y2="${CY}"/>`).join('');

  const nodes = Object.values(pos).map((p) => {
    const r = nodeR(p.s.count);
    return `<a href="${p.s.href}" data-node="${esc(p.s.id)}" data-color="${p.color}" data-label="${esc(p.s.label)}"
      data-hint="${esc(p.s.hint)}" data-count="${p.s.count}" data-div="${esc(p.div)}">
      <g class="cx-node">
        <circle class="cx-halo" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r + 9).toFixed(1)}" fill="${p.color}"/>
        <circle class="cx-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" stroke="${p.color}"/>
        <text class="cx-label" x="${p.x.toFixed(1)}" y="${(p.y - r - 7).toFixed(1)}">${esc(p.s.label)}</text>
        <text class="cx-count" x="${p.x.toFixed(1)}" y="${(p.y + r + 13).toFixed(1)}">${p.s.count}</text>
      </g></a>`;
  }).join('');

  const divLabels = arcs.map((d) => {
    const mid = ((d.a0 + d.a1) / 2 * Math.PI) / 180;
    const x = CX + (R_OUT + 74) * Math.cos(mid) * 1.12;
    const y = CY + (R_OUT + 74) * Math.sin(mid) * 0.72;
    return `<text class="cx-div" data-divlabel="${esc(d.id)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${d.color}">${d.label}</text>`;
  }).join('');

  const hs = harmony?.score ?? 0;
  const hsColor = hs >= 80 ? 'var(--ok)' : hs >= 55 ? 'var(--warn)' : 'var(--bad)';

  return `<svg class="constellation" viewBox="0 0 1000 880" role="img" aria-label="Company constellation — every section and the real relationships between them">
    <defs>
      <radialGradient id="coreGlow"><stop offset="0%" stop-color="rgba(255,107,44,0.30)"/><stop offset="100%" stop-color="rgba(255,107,44,0)"/></radialGradient>
    </defs>
    <circle cx="${CX}" cy="${CY}" r="230" fill="url(#coreGlow)"/>
    <ellipse class="cx-orbit" cx="${CX}" cy="${CY}" rx="${(R_OUT - 96) * 1.12}" ry="${(R_OUT - 96) * 0.72}"/>
    <ellipse class="cx-orbit" cx="${CX}" cy="${CY}" rx="${R_OUT * 1.12}" ry="${R_OUT * 0.72}"/>
    ${spokes}${edgeSvg}${divLabels}${nodes}
    <a href="#/harmony" data-node="core" data-color="#ff6b2c" data-label="HARMONY CORE"
       data-hint="Everything ends on the audit chain, and the orchestrator keeps the departments in step. Click to open Harmony."
       data-count="${hs}">
      <g class="cx-core">
        <circle class="cx-core-pulse" cx="${CX}" cy="${CY}" r="${R_IN - 62}" stroke="${hsColor}"/>
        <circle class="cx-core-ring" cx="${CX}" cy="${CY}" r="${R_IN - 62}" stroke="${hsColor}"/>
        <text class="cx-core-glyph" x="${CX}" y="${CY - 14}">▲</text>
        <text class="cx-core-score" x="${CX}" y="${CY + 20}" fill="${hsColor}">${hs}%</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 38}">HARMONY</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 54}">${connAudit.wired}/${connAudit.sections} sections wired</text>
      </g>
    </a>
  </svg>`;
}

/** Hover a node → isolate its neighbourhood; the rest of the board recedes. */
function initConstellation(map) {
  const svg = view.querySelector('svg.constellation');
  if (!svg) return;
  const panel = svg.closest('.panel');
  panel.style.position = 'relative';
  let tip = panel.querySelector('#map-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'map-tip'; tip.hidden = true; panel.appendChild(tip); }

  const neighbours = (id) => {
    const set = new Set([id]);
    for (const e of map.edges) {
      if (e.from === id) set.add(e.to);
      if (e.to === id) set.add(e.from);
    }
    return set;
  };

  const focus = (id) => {
    if (!id) {
      svg.querySelectorAll('.dimmed,.lit').forEach((el) => el.classList.remove('dimmed', 'lit'));
      return;
    }
    const near = neighbours(id);
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

  svg.querySelectorAll('a[data-node]').forEach((a) => {
    a.addEventListener('mouseenter', () => {
      const id = a.dataset.node;
      focus(id === 'core' ? null : id);
      const rel = map.edges.filter((e) => e.from === id || e.to === id);
      tip.innerHTML = `<div class="tip-head" style="color:${a.dataset.color}">${esc(a.dataset.label)}</div>
        <div class="tip-val">${esc(a.dataset.count)} ${id === 'core' ? 'harmony score' : 'records'}${a.dataset.div ? ` · ${esc(a.dataset.div)}` : ''}</div>
        <div class="tip-body">${esc(a.dataset.hint)}</div>
        ${rel.length ? `<div class="tip-rel">${rel.slice(0, 6).map((e) => `<span>${esc(e.from === id ? '→ ' + e.to : '← ' + e.from)} <b>${e.count}</b> ${esc(short(e.label, 30))}</span>`).join('')}</div>` : ''}
        <div class="tip-go">click to open →</div>`;
      tip.hidden = false;
    });
    a.addEventListener('mousemove', (e) => {
      const r = panel.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(e.clientX - r.left + 18, panel.clientWidth - 268)) + 'px';
      tip.style.top = Math.max(8, Math.min(e.clientY - r.top + 18, panel.clientHeight - 190)) + 'px';
    });
    a.addEventListener('mouseleave', () => { focus(null); tip.hidden = true; });
  });
}

// Wire hover/dim/tooltip behaviour onto the freshly rendered map.
function initMapInteractivity() {
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

// ---------- system map v8 · the mainboard ----------
// The company drawn as the machine it literally is: every section a silicon
// chip with an activity LED, every database join a copper trace routed PCB-
// style (Manhattan runs, 45° chamfers, shared bus lanes around the CPU), and
// data packets riding the busiest nets. The Harmony orchestrator is the CPU.
// Same contract as the atlas — initAtlas drives all interactivity unchanged.
// ---------- map style switcher ----------
// Four ways to look at the same living company. Every style is driven by the
// same /api/map data and shares one interaction engine (initAtlas): click
// opens the department, right-click opens the connection ledger and trace,
// drag/wheel pans and zooms, and the live ticker + pings work everywhere.
const MAP_STYLES = [
  ['board', 'Mainboard'],
  ['orbit', 'Orbit'],
  ['metro', 'Metro'],
  ['flow', 'Flow'],
];
const mapStyle = () => localStorage.getItem('crucible-map-style') || 'board';
function buildMap(m) {
  const s = mapStyle();
  if (atlasState.style !== s) {
    atlasState.style = s;
    atlasState.vb = null; atlasState.sel = null; atlasState.traceFrom = null; atlasState.divSel = null;
  }
  if (s === 'orbit') return buildAtlas(m);
  if (s === 'metro') return buildMetro(m);
  if (s === 'flow') return buildFlow(m);
  return buildBoard(m);
}

// ---------- system map v9 · the metro ----------
// Twelve coloured transit lines — one per division — each running its
// sections as stations, all terminating at the HARMONY interchange. Cross-
// division joins are the faint "transfer" arcs; hover or trace lights them.
function buildMetro(map) {
  const { divisions, sections, edges, harmony, audit: connAudit } = map;
  const CW = 1560, CH = 980, CX = 780, CY = 490, RING = 86;
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) (byDiv[s.division] || byDiv.govern).items.push(s);
  const divs = divisions.filter((d) => byDiv[d.id].items.length);
  const left = divs.slice(0, Math.ceil(divs.length / 2));
  const right = divs.slice(Math.ceil(divs.length / 2));

  const pos = {};
  const lines = [];
  const layoutSide = (list, isLeft) => {
    const rows = list.length;
    list.forEach((d, i) => {
      const y = 110 + i * ((CH - 220) / Math.max(rows - 1, 1));
      const items = byDiv[d.id].items;
      const x0 = isLeft ? 90 : CW - 90;
      const xEnd = isLeft ? 560 : CW - 560;
      const step = (Math.abs(xEnd - x0) - 20) / Math.max(items.length - 1, 1);
      items.forEach((s, k) => {
        const x = isLeft ? x0 + 10 + k * step : x0 - 10 - k * step;
        pos[s.id] = { x, y, div: d.id, color: d.color, s };
      });
      // terminate on the interchange ring at a per-line angle
      const a = ((isLeft ? 225 - i * (90 / Math.max(rows - 1, 1)) : -45 + i * (90 / Math.max(rows - 1, 1))) * Math.PI) / 180;
      const rx = CX + RING * Math.cos(a), ry = CY + RING * Math.sin(a);
      lines.push({ d, path: `M ${x0} ${y} H ${xEnd} L ${rx.toFixed(1)} ${ry.toFixed(1)}`, x0, y, isLeft });
    });
  };
  layoutSide(left, true);
  layoutSide(right, false);

  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const edgeSvg = edges.map((e, i) => {
    const a = pos[e.from]; const b = pos[e.to];
    if (!a || !b) return '';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const bx = mx + (CX - mx) * 0.35, by = my + (CY - my) * 0.35;
    const w = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 2.4 : 0.7;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}" d="${d}" stroke="${a.color}" stroke-width="${w.toFixed(2)}"/>
      <path class="cx-hit" data-edgehit="${i}" d="${d}"><title>${esc(e.from)} → ${esc(e.to)} · ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  const lineSvg = lines.map((l) => `
    <path class="mt-line" data-divlabel="${esc(l.d.id)}" d="${l.path}" stroke="${l.d.color}"/>
    <text class="cx-div zlab" data-divlabel="${esc(l.d.id)}" x="${l.isLeft ? 36 : CW - 36}" y="${l.y - 14}"
      ${l.isLeft ? '' : 'text-anchor="end"'} fill="${l.d.color}">${l.d.label} · ${byDiv[l.d.id].items.length}</text>`).join('');

  const nodes = Object.values(pos).map((p) => `
    <a href="${p.s.href}" data-node="${esc(p.s.id)}" data-color="${p.color}" data-label="${esc(p.s.label)}"
      data-hint="${esc(p.s.hint)}" data-count="${p.s.count}" data-div="${esc(p.div)}" style="color:${p.color}">
      <g class="mt-stn">
        <circle class="mt-halo cx-halo" cx="${p.x.toFixed(1)}" cy="${p.y}" r="14" fill="${p.color}"/>
        <circle class="mt-dot" cx="${p.x.toFixed(1)}" cy="${p.y}" r="7" stroke="${p.color}"/>
        <text class="mt-lab" transform="translate(${(p.x + 3).toFixed(1)} ${p.y - 14}) rotate(-33)">${esc(p.s.label)}</text>
        <text class="mt-cnt" x="${p.x.toFixed(1)}" y="${p.y + 22}">${p.s.count}</text>
      </g></a>`).join('');

  const hs = harmony?.score ?? 0;
  const hsColor = hs >= 80 ? 'var(--ok)' : hs >= 55 ? 'var(--warn)' : 'var(--bad)';
  return `<svg class="constellation atlas metroV9" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Company metro — twelve division lines terminating at the Harmony interchange">
    <circle cx="${CX}" cy="${CY}" r="220" fill="url(#coreGlow9)"/>
    <defs><radialGradient id="coreGlow9"><stop offset="0%" stop-color="rgba(255,107,44,0.20)"/><stop offset="100%" stop-color="rgba(255,107,44,0)"/></radialGradient></defs>
    ${edgeSvg}${lineSvg}${nodes}
    <a href="#/harmony" data-node="core" data-color="#ff6b2c" data-label="HARMONY INTERCHANGE"
       data-hint="Every line terminates here: the orchestrator and the audit chain. Click to open Harmony."
       data-count="${hs}" style="color:#ff6b2c">
      <g>
        <circle class="cx-core-pulse" cx="${CX}" cy="${CY}" r="${RING}" stroke="${hsColor}" style="transform-origin:${CX}px ${CY}px"/>
        <circle class="cx-core-ring" cx="${CX}" cy="${CY}" r="${RING}" stroke="${hsColor}"/>
        <text class="cx-core-glyph" x="${CX}" y="${CY - 22}">▲</text>
        <text class="cx-core-score" x="${CX}" y="${CY + 12}" fill="${hsColor}">${hs}%</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 32}">HARMONY</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 48}">${connAudit.wired}/${connAudit.sections} WIRED</text>
      </g>
    </a>
  </svg>`;
}

// ---------- system map v10 · the flow line ----------
// The value stream: divisions as columns in the order work actually moves —
// intake to build to decision to market to governance — sections as pills,
// every join a ribbon between columns. Reads left to right like the factory
// the company is.
function buildFlow(map) {
  const { divisions, sections, edges, harmony } = map;
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) (byDiv[s.division] || byDiv.govern).items.push(s);
  const divs = divisions.filter((d) => byDiv[d.id].items.length);
  const PW = 116, PH = 32, COL = 128, CW = 70 + divs.length * COL + 40, CH = 780, MIDY = 430;

  const pos = {};
  divs.forEach((d, ci) => {
    const items = byDiv[d.id].items;
    const x = 60 + ci * COL;
    const y0 = MIDY - (items.length * 42) / 2;
    items.forEach((s, i) => { pos[s.id] = { x, y: y0 + i * 42, div: d.id, color: d.color, s }; });
  });

  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const edgeSvg = edges.map((e, i) => {
    const a = pos[e.from]; const b = pos[e.to];
    if (!a || !b) return '';
    const x1 = a.x + PW, y1 = a.y + PH / 2, x2 = b.x, y2 = b.y + PH / 2;
    const mx = (x1 + x2) / 2;
    const w = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 2.8 : 0.7;
    const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${mx.toFixed(1)} ${y1.toFixed(1)}, ${mx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}" d="${d}" stroke="${a.color}" stroke-width="${w.toFixed(2)}"/>
      <path class="cx-hit" data-edgehit="${i}" d="${d}"><title>${esc(e.from)} → ${esc(e.to)} · ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  const headers = divs.map((d, ci) => {
    const x = 60 + ci * COL + PW / 2;
    return `<text class="cx-div" data-divlabel="${esc(d.id)}" x="${x}" y="70" fill="${d.color}">${d.label}</text>
      <rect data-divlabel="${esc(d.id)}" x="${x - 26}" y="78" width="52" height="2.5" rx="1.2" fill="${d.color}" opacity="0.6" style="cursor:pointer"/>`;
  }).join('');

  const nodes = Object.values(pos).map((p) => `
    <a href="${p.s.href}" data-node="${esc(p.s.id)}" data-color="${p.color}" data-label="${esc(p.s.label)}"
      data-hint="${esc(p.s.hint)}" data-count="${p.s.count}" data-div="${esc(p.div)}" style="color:${p.color}">
      <g class="fl-node">
        <rect class="fl-pill" x="${p.x}" y="${p.y}" width="${PW}" height="${PH}" rx="9" stroke="${p.color}"/>
        <rect x="${p.x + 3}" y="${p.y + 3}" width="3.4" height="${PH - 6}" rx="1.7" fill="${p.color}" opacity="0.85"/>
        <text class="fl-lab" x="${p.x + 12}" y="${p.y + 13.5}">${esc(p.s.label)}</text>
        <text class="fl-cnt" x="${p.x + 12}" y="${p.y + 26}">${p.s.count} rec</text>
        <circle class="chip-led ${p.s.count > 0 ? 'on' : ''}" cx="${p.x + PW - 10}" cy="${p.y + 9}" r="2.4"/>
      </g></a>`).join('');

  const hs = harmony?.score ?? 0;
  return `<svg class="constellation atlas flowV10" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Company flow line — the value stream from intake to governance">
    <text class="silk" x="60" y="36">VALUE STREAM — WORK ENTERS LEFT, GOVERNANCE SEALS RIGHT · HARMONY ${hs}%</text>
    ${edgeSvg}${headers}${nodes}
  </svg>`;
}

function buildBoard(map) {
  const { divisions, sections, edges, harmony, audit: connAudit } = map;
  const W = 128, H = 36, PX = 140, PY = 46;
  const RING = { x1: 390, y1: 214, x2: 1370, y2: 724 };
  const ZONES = {
    engine: { x: 36, y: 56, cols: 2, side: 'left' },
    talent: { x: 36, y: 286, cols: 2, side: 'left' },
    create: { x: 36, y: 516, cols: 2, side: 'left' },
    trust: { x: 36, y: 700, cols: 2, side: 'left' },
    build: { x: 1440, y: 56, cols: 2, side: 'right' },
    commerce: { x: 1440, y: 286, cols: 2, side: 'right' },
    data: { x: 1440, y: 516, cols: 2, side: 'right' },
    capital: { x: 1440, y: 700, cols: 2, side: 'right' },
    decide: { x: 435, y: 64, cols: 4, side: 'top' },
    exec: { x: 1047, y: 64, cols: 2, side: 'top' },
    operate: { x: 365, y: 790, cols: 3, side: 'bottom' },
    govern: { x: 837, y: 790, cols: 4, side: 'bottom' },
  };
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) (byDiv[s.division] || byDiv.govern).items.push(s);

  // Chip placement: a grid inside each division's zone.
  const chip = {};
  const zoneRects = [];
  for (const d of divisions) {
    const z = ZONES[d.id];
    const items = byDiv[d.id]?.items || [];
    if (!z || !items.length) continue;
    const rows = Math.ceil(items.length / z.cols);
    zoneRects.push({
      ...d, x: z.x - 14, y: z.y - 14, n: items.length,
      w: Math.min(items.length, z.cols) * PX - 12 + 28, h: rows * PY - 10 + 28,
    });
    items.forEach((s, i) => {
      chip[s.id] = { x: z.x + (i % z.cols) * PX, y: z.y + Math.floor(i / z.cols) * PY, side: z.side, color: d.color, div: d.id, s };
    });
  }

  // --- PCB routing: chip → perpendicular run → bus lane around the CPU →
  // perpendicular run → chip, with 45° chamfered corners. ---
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const slots = new Map();
  const takeSlot = (id) => { const k = slots.get(id) || 0; slots.set(id, k + 1); return k; };
  const connector = (c, slot) => {
    if (c.side === 'left') return { x: c.x + W, y: c.y + 8 + (slot % 3) * 10 };
    if (c.side === 'right') return { x: c.x, y: c.y + 8 + (slot % 3) * 10 };
    if (c.side === 'top') return { x: c.x + 16 + (slot % 7) * 16, y: c.y + H };
    return { x: c.x + 16 + (slot % 7) * 16, y: c.y };
  };
  const approach = (c, P, R) => {
    if (c.side === 'left') return [P, { x: R.x1, y: P.y }, { x: R.x1, y: clampN(P.y, R.y1, R.y2) }];
    if (c.side === 'right') return [P, { x: R.x2, y: P.y }, { x: R.x2, y: clampN(P.y, R.y1, R.y2) }];
    if (c.side === 'top') return [P, { x: P.x, y: R.y1 }, { x: clampN(P.x, R.x1, R.x2), y: R.y1 }];
    return [P, { x: P.x, y: R.y2 }, { x: clampN(P.x, R.x1, R.x2), y: R.y2 }];
  };
  const perimeter = (R, p1, p2) => {
    const w = R.x2 - R.x1, h = R.y2 - R.y1, P = 2 * (w + h);
    const posOf = (pt) => pt.y === R.y1 ? pt.x - R.x1
      : pt.x === R.x2 ? w + (pt.y - R.y1)
      : pt.y === R.y2 ? w + h + (R.x2 - pt.x)
      : w + h + w + (R.y2 - pt.y);
    const corners = [
      { t: 0, x: R.x1, y: R.y1 }, { t: w, x: R.x2, y: R.y1 },
      { t: w + h, x: R.x2, y: R.y2 }, { t: w + h + w, x: R.x1, y: R.y2 },
    ];
    const t1 = posOf(p1), t2 = posOf(p2);
    const fwd = ((t2 - t1) % P + P) % P;
    const dir = fwd <= P - fwd ? 1 : -1;
    const dist = dir === 1 ? fwd : P - fwd;
    return corners
      .map((c) => ({ ...c, d: (((c.t - t1) * dir) % P + P) % P }))
      .filter((c) => c.d > 0.5 && c.d < dist - 0.5)
      .sort((a, b) => a.d - b.d)
      .map((c) => ({ x: c.x, y: c.y }));
  };
  const simplify = (pts) => {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
      out.push(p);
    }
    for (let i = out.length - 2; i > 0; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) === 0) out.splice(i, 1);
    }
    return out;
  };
  const chamfer = (pts, cut = 10) => {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], e = pts[i + 1];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1, l2 = Math.hypot(e.x - b.x, e.y - b.y) || 1;
      const k = Math.min(cut, l1 / 2, l2 / 2);
      d += ` L ${(b.x - (b.x - a.x) / l1 * k).toFixed(1)} ${(b.y - (b.y - a.y) / l1 * k).toFixed(1)}`
        + ` L ${(b.x + (e.x - b.x) / l2 * k).toFixed(1)} ${(b.y + (e.y - b.y) / l2 * k).toFixed(1)}`;
    }
    return d + ` L ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;
  };

  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const paths = [];
  const edgeSvg = edges.map((e, i) => {
    const a = chip[e.from], b = chip[e.to];
    if (!a || !b) return '';
    const off = 3.5 * (i % 8);
    const R = { x1: RING.x1 - off, y1: RING.y1 - off, x2: RING.x2 + off, y2: RING.y2 + off };
    const Pa = connector(a, takeSlot(e.from)), Pb = connector(b, takeSlot(e.to));
    const inA = approach(a, Pa, R), inB = approach(b, Pb, R);
    const pts = simplify([...inA, ...perimeter(R, inA[2], inB[2]), ...inB.reverse()]);
    const d = chamfer(pts);
    if (e.count) paths.push({ d, count: e.count, color: a.color });
    const w2 = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 3 : 0.8;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
      d="${d}" stroke="${a.color}" stroke-width="${w2.toFixed(2)}"/>
      <path class="cx-hit" data-edgehit="${i}" d="${d}"><title>${esc(e.from)} → ${esc(e.to)} · ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  // Data packets ride the twelve busiest nets — the board is visibly alive.
  const packets = paths.sort((x, y) => y.count - x.count).slice(0, 12).map((p, k) =>
    `<circle class="cx-pkt" r="2.4" fill="${p.color}"><animateMotion dur="${(5 + k * 1.1).toFixed(1)}s" repeatCount="indefinite" path="${p.d}"/></circle>`).join('');

  const zones = zoneRects.map((z) => `
    <rect class="zone-rect" data-divlabel="${esc(z.id)}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="9" stroke="${z.color}"/>
    <text class="cx-div zlab" data-divlabel="${esc(z.id)}" x="${z.x + 2}" y="${z.y - 7}" fill="${z.color}">${z.label} · ${z.n}</text>`).join('');

  const nodes = Object.values(chip).map((c) => {
    const pins = [0, 1, 2, 3].map((k) =>
      `<rect class="pin" x="${c.x + 20 + k * 26}" y="${c.y - 3}" width="5" height="3"/>
       <rect class="pin" x="${c.x + 20 + k * 26}" y="${c.y + H}" width="5" height="3"/>`).join('');
    return `<a href="${c.s.href}" data-node="${esc(c.s.id)}" data-color="${c.color}" data-label="${esc(c.s.label)}"
      data-hint="${esc(c.s.hint)}" data-count="${c.s.count}" data-div="${esc(c.div)}" style="color:${c.color}">
      <g class="chip">${pins}
        <rect class="chip-body" x="${c.x}" y="${c.y}" width="${W}" height="${H}" rx="5" stroke="${c.color}"/>
        <rect x="${c.x + 3}" y="${c.y + 3}" width="3.5" height="${H - 6}" rx="1.7" fill="${c.color}" opacity="0.85"/>
        <text class="chip-name" x="${c.x + 12}" y="${c.y + 15}">${esc(c.s.label)}</text>
        <text class="chip-count" x="${c.x + 12}" y="${c.y + 28}">${c.s.count} rec</text>
        <circle class="chip-led ${c.s.count > 0 ? 'on' : ''}" cx="${c.x + 117}" cy="${c.y + 10}" r="2.6"/>
      </g></a>`;
  }).join('');

  const hs = harmony?.score ?? 0;
  const hsColor = hs >= 80 ? 'var(--ok)' : hs >= 55 ? 'var(--warn)' : 'var(--bad)';
  const cpuPins = [...Array(9)].map((_, k) =>
    `<rect class="pin" x="${788 + k * 23}" y="387" width="7" height="4"/><rect class="pin" x="${788 + k * 23}" y="547" width="7" height="4"/>`).join('')
    + [...Array(6)].map((_, k) =>
    `<rect class="pin" x="773" y="${404 + k * 23}" width="4" height="7"/><rect class="pin" x="983" y="${404 + k * 23}" width="4" height="7"/>`).join('');

  return `<svg class="constellation atlas board" viewBox="0 0 1744 940" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Company mainboard — every section a chip, every relationship a copper trace">
    <defs>
      <pattern id="bgrid" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="0.8" fill="rgba(255,255,255,0.035)"/>
      </pattern>
      <radialGradient id="coreGlow"><stop offset="0%" stop-color="rgba(255,107,44,0.22)"/><stop offset="100%" stop-color="rgba(255,107,44,0)"/></radialGradient>
    </defs>
    <rect class="cx-orbit b-bg" x="6" y="6" width="1732" height="928" rx="16" fill="url(#bgrid)"/>
    <rect class="b-frame" x="6" y="6" width="1732" height="928" rx="16"/>
    <circle class="hole" cx="26" cy="26" r="7"/><circle class="hole" cx="1718" cy="26" r="7"/>
    <circle class="hole" cx="26" cy="914" r="7"/><circle class="hole" cx="1718" cy="914" r="7"/>
    <circle cx="880" cy="469" r="250" fill="url(#coreGlow)"/>
    ${zones}${edgeSvg}${packets}${nodes}
    <a href="#/harmony" data-node="core" data-color="#ff6b2c" data-label="HARMONY CPU"
       data-hint="The orchestrator socket: every department's clock signal. Everything ends on the audit chain. Click to open Harmony."
       data-count="${hs}" style="color:#ff6b2c">
      <g class="cpu">${cpuPins}
        <rect class="cpu-pulse" x="780" y="394" width="200" height="150" rx="10" stroke="${hsColor}" style="transform-origin:880px 469px"/>
        <rect class="cpu-body" x="780" y="394" width="200" height="150" rx="10" stroke="${hsColor}"/>
        <text class="cx-core-glyph" x="880" y="442">▲</text>
        <text class="cx-core-score" x="880" y="476" fill="${hsColor}">${hs}%</text>
        <text class="cx-core-sub" x="880" y="496">HARMONY CPU</text>
        <text class="cx-core-sub" x="880" y="512">${connAudit.wired}/${connAudit.sections} SECTIONS WIRED</text>
      </g>
    </a>
    <text class="silk" x="36" y="929">CRUCIBLE CORE · MAINBOARD REV 9 · AI-NATIVE COMPANY · 12 DIVISIONS</text>
    <text class="silk" x="1708" y="929" text-anchor="end">${sections.length} IC · ${edges.length} NETS · ${edges.filter((e) => e.count > 0).length} LIVE</text>
  </svg>`;
}

function buildAtlas(map) {
  const { divisions, sections, edges, harmony, audit: connAudit } = map;
  const CX = 700, CY = 390, RX = 520, RY = 255, DIV_GAP = 1.6;
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) (byDiv[s.division] || byDiv.govern).items.push(s);

  // One ring, and each division's wedge is proportional to how many sections
  // it holds — every node gets the same angular slot regardless of division
  // size, and labels run radially outward like clock hands, so no two texts
  // can ever sit on top of each other.
  const pos = {};
  const arcs = [];
  const divs = divisions.filter((d) => byDiv[d.id].items.length);
  const total = divs.reduce((n, d) => n + byDiv[d.id].items.length, 0);
  const usable = 360 - DIV_GAP * divs.length;
  let a0 = -90;
  divs.forEach((d) => {
    const items = byDiv[d.id].items;
    const span = usable * (items.length / total);
    arcs.push({ ...d, a0, a1: a0 + span });
    items.forEach((s, i) => {
      const ang = ((a0 + span * ((i + 0.5) / items.length)) * Math.PI) / 180;
      pos[s.id] = { x: CX + RX * Math.cos(ang), y: CY + RY * Math.sin(ang), div: d.id, color: d.color, s };
    });
    a0 += span + DIV_GAP;
  });

  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const nodeR = (c) => Math.max(6, Math.min(15, 6 + Math.log10(Math.max(1, c)) * 4.5));

  // Every edge gets a visible curve plus an invisible wide twin that catches
  // the pointer, so thin lines are hoverable and carry their own tooltip.
  const edgeSvg = edges.map((e, i) => {
    const a = pos[e.from]; const b = pos[e.to];
    if (!a || !b) return '';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const bx = mx + (CX - mx) * 0.45, by = my + (CY - my) * 0.45;
    const w = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 3.2 : 0.8;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
      d="${d}" stroke="${a.color}" stroke-width="${w.toFixed(2)}"/>
      <path class="cx-hit" data-edgehit="${i}" d="${d}"><title>${esc(e.from)} → ${esc(e.to)} · ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  const spokes = Object.values(pos).map((p) =>
    `<line class="cx-spoke" data-spoke="${esc(p.s.id)}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${CX}" y2="${CY}"/>`).join('');

  // Labels run along each node's own ray (flipped on the left half so the
  // text still reads left-to-right), with a background halo for legibility
  // where edges pass underneath. The live count rides on the same line.
  const nodes = Object.values(pos).map((p) => {
    const r = nodeR(p.s.count);
    const phi = Math.atan2(p.y - CY, p.x - CX);
    const deg = (phi * 180) / Math.PI;
    const left = Math.cos(phi) < -0.001;
    const lx = p.x + Math.cos(phi) * (r + 7);
    const ly = p.y + Math.sin(phi) * (r + 7);
    return `<a href="${p.s.href}" data-node="${esc(p.s.id)}" data-color="${p.color}" data-label="${esc(p.s.label)}"
      data-hint="${esc(p.s.hint)}" data-count="${p.s.count}" data-div="${esc(p.div)}">
      <g class="cx-node">
        <circle class="cx-halo" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r + 9).toFixed(1)}" fill="${p.color}"/>
        <circle class="cx-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" stroke="${p.color}"/>
        <text class="cx-rlab" dy="0.34em" text-anchor="${left ? 'end' : 'start'}"
          transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${(left ? deg + 180 : deg).toFixed(1)})">${esc(p.s.label)} <tspan class="cx-rcount">${p.s.count}</tspan></text>
      </g></a>`;
  }).join('');

  // Division identity: a coloured arc hugging the inside of the ring plus a
  // horizontal name at the wedge's midpoint, inside the ring where the radial
  // labels cannot reach it.
  const arcPath = (from, to, arx, ary) => {
    const f = (from * Math.PI) / 180, t = (to * Math.PI) / 180;
    return `M ${(CX + arx * Math.cos(f)).toFixed(1)} ${(CY + ary * Math.sin(f)).toFixed(1)} A ${arx} ${ary} 0 ${to - from > 180 ? 1 : 0} 1 ${(CX + arx * Math.cos(t)).toFixed(1)} ${(CY + ary * Math.sin(t)).toFixed(1)}`;
  };
  const divLabels = arcs.map((d) => {
    const mid = ((d.a0 + d.a1) / 2 * Math.PI) / 180;
    const x = CX + (RX - 76) * Math.cos(mid);
    const y = CY + (RY - 76) * Math.sin(mid);
    return `<path class="cx-arc" data-divlabel="${esc(d.id)}" d="${arcPath(d.a0 + 0.7, d.a1 - 0.7, RX - 27, RY - 27)}" stroke="${d.color}"/>
      <text class="cx-div" data-divlabel="${esc(d.id)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${d.color}">${d.label}</text>`;
  }).join('');

  const hs = harmony?.score ?? 0;
  const hsColor = hs >= 80 ? 'var(--ok)' : hs >= 55 ? 'var(--warn)' : 'var(--bad)';

  return `<svg class="constellation atlas" viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Company atlas — every section, every real relationship, pan and zoom">
    <defs>
      <radialGradient id="coreGlow"><stop offset="0%" stop-color="rgba(255,107,44,0.30)"/><stop offset="100%" stop-color="rgba(255,107,44,0)"/></radialGradient>
    </defs>
    <circle cx="${CX}" cy="${CY}" r="210" fill="url(#coreGlow)"/>
    <ellipse class="cx-orbit" cx="${CX}" cy="${CY}" rx="${RX}" ry="${RY}"/>
    ${spokes}${edgeSvg}${divLabels}${nodes}
    <a href="#/harmony" data-node="core" data-color="#ff6b2c" data-label="HARMONY CORE"
       data-hint="Everything ends on the audit chain, and the orchestrator keeps the departments in step. Click to open Harmony."
       data-count="${hs}">
      <g class="cx-core">
        <circle class="cx-core-pulse" cx="${CX}" cy="${CY}" r="86" stroke="${hsColor}" style="transform-origin:${CX}px ${CY}px"/>
        <circle class="cx-core-ring" cx="${CX}" cy="${CY}" r="86" stroke="${hsColor}"/>
        <text class="cx-core-glyph" x="${CX}" y="${CY - 16}">▲</text>
        <text class="cx-core-score" x="${CX}" y="${CY + 16}" fill="${hsColor}">${hs}%</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 34}">HARMONY</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 50}">${connAudit.wired}/${connAudit.sections} sections wired</text>
      </g>
    </a>
  </svg>`;
}

/** Pan/zoom, hover isolation, click-to-inspect, hop-by-hop flow tracing. */
function initAtlas(map) {
  const svg = view.querySelector('svg.constellation.atlas');
  if (!svg) return;
  const panel = svg.closest('.panel');
  panel.style.position = 'relative';
  let tip = panel.querySelector('#map-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'map-tip'; tip.hidden = true; panel.appendChild(tip); }
  const ctl = document.createElement('div');
  ctl.className = 'map-ctl';
  ctl.innerHTML = `<button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit whole map">⤢</button>`;
  panel.appendChild(ctl);
  const side = document.createElement('div');
  side.className = 'map-side';
  side.hidden = true;
  panel.appendChild(side);

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
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(p.x, p.y, e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  ctl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.z === 'fit') { vb = { ...VB0 }; applyVB(); return; }
    zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, b.dataset.z === 'in' ? 1 / 1.35 : 1.35);
  }));
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch { /* touch quirks */ }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const scale = vb.w / svg.getBoundingClientRect().width;
    vb.x = drag.vx - dx * scale; vb.y = drag.vy - dy * scale; applyVB();
  });
  svg.addEventListener('pointerup', () => setTimeout(() => { drag = null; }, 0));

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
    svg.querySelectorAll('[data-node]').forEach((el) => {
      const d = depth[el.dataset.node];
      el.classList.toggle('dimmed', d === undefined && el.dataset.node !== 'core');
      el.classList.toggle('lit', d !== undefined);
      if (d !== undefined) el.style.animationDelay = `${d * 0.12}s`;
    });
    svg.querySelectorAll('.cx-edge').forEach((el) => {
      const da = depth[el.dataset.a], db = depth[el.dataset.b];
      const on = da !== undefined && db !== undefined;
      el.classList.toggle('trace', on);
      el.classList.toggle('dimmed', !on);
      if (on) el.style.animationDelay = `${Math.min(da, db) * 0.12}s`;
    });
    return depth;
  };

  // --- the connection ledger: click a section, read everything it touches ---
  const closeSide = () => { atlasState.sel = null; atlasState.traceFrom = null; side.hidden = true; clearFx(); };
  const select = (id) => {
    atlasState.sel = id; atlasState.traceFrom = null; atlasState.divSel = null;
    focus(id);
    const s = sec[id];
    if (!s) return;
    const rel = edgesFor(id);
    const out = rel.filter((e) => e.from === id);
    const inn = rel.filter((e) => e.to === id);
    const row = (e, dir) => {
      const other = dir === 'out' ? e.to : e.from;
      const oth = sec[other];
      return `<div class="ms-row" data-jump="${esc(other)}">
        <span class="ms-dir">${dir === 'out' ? '→' : '←'}</span>
        <b style="color:${oth ? divColor[oth.division] : 'var(--ink)'}">${esc(oth?.label || other)}</b>
        <span class="ms-cnt">${e.count}</span>
        <div class="ms-lbl">${esc(e.label)}</div>
      </div>`;
    };
    side.innerHTML = `
      <div class="ms-head" style="color:${divColor[s.division]}">${esc(s.label)}</div>
      <div class="ms-sub">${esc(s.division)} division · ${s.count} records</div>
      <div class="ms-hint">${esc(s.hint)}</div>
      <div class="ms-actions">
        <button class="btn btn-sm btn-primary" data-ms="open">Open →</button>
        <button class="btn btn-sm" data-ms="trace">Trace flow</button>
        <button class="btn btn-sm" data-ms="close">✕</button>
      </div>
      ${out.length ? `<div class="ms-sec">Sends to · ${out.length}</div>${out.map((e) => row(e, 'out')).join('')}` : ''}
      ${inn.length ? `<div class="ms-sec">Receives from · ${inn.length}</div>${inn.map((e) => row(e, 'in')).join('')}` : ''}
      <div class="ms-sec">Universal</div>
      <div class="ms-lbl">Every action here lands on the audit chain; produced items freeze into the archive.</div>`;
    side.hidden = false;
    side.querySelector('[data-ms="open"]').onclick = () => { location.hash = s.href; };
    side.querySelector('[data-ms="close"]').onclick = closeSide;
    side.querySelector('[data-ms="trace"]').onclick = () => {
      atlasState.traceFrom = id;
      const depth = runTrace(id);
      const hops = {};
      for (const [nid, d] of Object.entries(depth)) if (d > 0) (hops[d] ||= []).push(sec[nid]?.label || nid);
      side.querySelector('.ms-trace')?.remove();
      const box = document.createElement('div');
      box.className = 'ms-trace';
      box.innerHTML = `<div class="ms-sec">Flow trace — reaches ${Object.keys(depth).length - 1} sections</div>`
        + Object.entries(hops).map(([d, list]) => `<div class="ms-lbl"><b>hop ${d}</b> · ${esc(list.join(', '))}</div>`).join('')
        + `<div class="ms-lbl" style="margin-top:6px">Edges pulse outward in hop order — watch the map.</div>`;
      side.appendChild(box);
    };
    side.querySelectorAll('[data-jump]').forEach((r) => r.addEventListener('click', () => select(r.dataset.jump)));
  };

  // --- pointer wiring ---
  svg.querySelectorAll('a[data-node]').forEach((a) => {
    // Click opens the section directly; right-click (or Ctrl+click) opens the
    // connection ledger with the trace tools instead.
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (drag?.moved) return;
      const id = a.dataset.node;
      if ((e.ctrlKey || e.metaKey) && id !== 'core') { select(id); return; }
      location.hash = a.getAttribute('href');
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (a.dataset.node !== 'core') select(a.dataset.node);
    });
    a.addEventListener('mouseenter', (e) => {
      if (drag?.moved) return;
      const id = a.dataset.node;
      if (!atlasState.sel && !atlasState.traceFrom && id !== 'core') focus(id);
      const rel = id === 'core' ? [] : edgesFor(id);
      tip.innerHTML = `<div class="tip-head" style="color:${a.dataset.color}">${esc(a.dataset.label)}</div>
        <div class="tip-val">${esc(a.dataset.count)} ${id === 'core' ? 'harmony score' : 'records'}${a.dataset.div ? ` · ${esc(a.dataset.div)}` : ''}</div>
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
  svg.querySelectorAll('.cx-hit').forEach((h) => {
    h.addEventListener('mouseenter', () => svg.querySelector(`[data-edge="${h.dataset.edgehit}"]`)?.classList.add('lit'));
    h.addEventListener('mouseleave', () => {
      if (!atlasState.sel && !atlasState.traceFrom) svg.querySelector(`[data-edge="${h.dataset.edgehit}"]`)?.classList.remove('lit');
    });
  });
  svg.querySelectorAll('[data-divlabel]').forEach((t) => t.addEventListener('click', () => {
    const id = t.dataset.divlabel;
    if (atlasState.divSel === id) { atlasState.divSel = null; clearFx(); return; }
    atlasState.divSel = id; atlasState.sel = null; atlasState.traceFrom = null; side.hidden = true;
    focusDiv(id);
  }));
  svg.addEventListener('click', (e) => {
    if (drag?.moved) return;
    if (e.target === svg || e.target.classList.contains('cx-orbit')) closeSide();
  });

  // Restore what the user was looking at across the poll re-render.
  if (atlasState.traceFrom) { select(atlasState.traceFrom); side.querySelector('[data-ms="trace"]')?.click(); }
  else if (atlasState.sel) select(atlasState.sel);
  else if (atlasState.divSel) focusDiv(atlasState.divSel);

  // --- the live layer: watch the company work ---
  // Every few seconds the board asks the audit chain what happened. New events
  // flash their section's chip and scroll through the ticker, so activity is
  // visible the moment it lands on the chain.
  const ticker = document.createElement('div');
  ticker.className = 'map-ticker';
  ticker.innerHTML = '<div class="tk-row tk-idle">listening for activity…</div>';
  panel.appendChild(ticker);
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

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">
      <span>The company as it actually is — ${mapData ? `${mapData.sections.length} sections · ${mapData.edges.filter((e) => e.count > 0).length}/${mapData.edges.length} relationships live` : 'system map'}</span>
      <span>
        <span class="map-style-picker">${MAP_STYLES.map(([k, label]) =>
          `<button data-mapstyle="${k}" class="${mapStyle() === k ? 'on' : ''}">${label}</button>`).join('')}</span>
        ${mapData ? `<span class="chip ${mapData.audit.orphans.length ? 'chip-bad' : 'chip-ok'}">${mapData.audit.wired}/${mapData.audit.sections} wired${mapData.audit.orphans.length ? ` · ${mapData.audit.orphans.length} orphan` : ' · no orphans'}</span>` : ''}
        <a class="chip chip-dim" style="text-decoration:none" href="#/graph">relationship table →</a>
      </span>
    </div>
    ${mapData ? buildMap(mapData) : buildSystemMap(s, prov, agentsList, chain, extra)}
    <div class="map-legend">The living mainboard: every chip is a department (LED = live records, flash = something just happened there), every copper trace a real database join, packets ride the busiest nets, the ticker narrates the audit chain in real time. <b>Click</b> a chip to open its department · <b>right-click</b> for its full connection ledger and hop-by-hop <b>Trace flow</b> · <b>drag / wheel</b> pans and zooms · click a zone name to isolate a division.${mapData?.audit.orphans.length ? ` <b style="color:var(--bad)">Unwired: ${mapData.audit.orphans.map((o) => o.label).join(', ')}</b>` : ''}</div>
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
  if (mapData) initAtlas(mapData); else initMapInteractivity();
  view.querySelectorAll('[data-mapstyle]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('crucible-map-style', b.dataset.mapstyle);
    renderOverview();
  }));
}

const DEPT_LABEL = {
  gate: 'Run gate', systems: 'System design', social: 'Social media', content: 'Content studio',
  design: 'Design studio', marketing: 'Marketing', relations: 'Relations', support: 'Support desk',
  journeys: 'Journeys', finreports: 'Financial reports', decisions: 'Decisions', legal: 'Legal',
  products: 'Product gates', intel: 'Intelligence', knowledge: 'Knowledge', governance: 'Governance',
  risks: 'Risks', harmony: 'Orchestrator',
};

async function renderGate() {
  const [box, runs] = await Promise.all([
    api('/api/inbox'), api('/api/runs?state=awaiting_human').catch(() => []),
  ]);
  const runById = Object.fromEntries(runs.map((r) => [r.id, r]));
  const groups = {};
  for (const i of box.items) (groups[i.dept] ||= []).push(i);
  const age = (h) => (h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : 'just now');

  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile ${box.total ? 'tile-warn' : ''}"><div class="panel-title">Waiting on you</div><div class="big">${box.total}</div><div class="sub">across ${Object.keys(groups).length} department(s)</div></div>
    <div class="panel tile ${box.high ? 'tile-warn' : ''}"><div class="panel-title">Needs attention first</div><div class="big">${box.high}</div><div class="sub">gates, sends, live copy, incidents</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">One-click answers</div><div class="big">${box.actionable}</div><div class="sub">approve or send without leaving this page</div></div>
    <div class="panel tile"><div class="panel-title">Oldest item</div><div class="big" style="font-size:24px;padding-top:6px">${box.total ? age(box.oldestHours) : '—'}</div><div class="sub">nothing should wait for days</div></div>
  </div>

  ${box.total ? Object.entries(groups).map(([dept, items]) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(DEPT_LABEL[dept] || dept)} — ${items.length}</span>
      <a class="chip chip-dim" style="text-decoration:none" href="${esc(items[0].href)}">open the section →</a></div>
    ${items.map((i) => `
      <div class="inbox-row ${esc(i.severity)}">
        <div class="ib-main">
          <a class="ib-title" href="${esc(i.href)}">${esc(i.title)}</a>
          ${i.sub ? `<div class="ib-sub">${esc(i.sub)}</div>` : ''}
          ${i.kind === 'run' && runById[i.id]?.output ? `<pre class="json" style="max-height:180px;margin-top:6px">${esc(JSON.stringify(runById[i.id].output.parsed ?? runById[i.id].output, null, 2).slice(0, 900))}</pre>` : ''}
        </div>
        <div class="ib-age mono">${age(i.ageHours)}</div>
        <div class="ib-actions">
          ${i.action ? `<button class="btn btn-sm btn-ok" data-ib='${esc(JSON.stringify(i.action))}' data-label="${esc(i.actionLabel)}">${esc(i.actionLabel)}</button>` : ''}
          ${i.secondary ? `<button class="btn btn-sm ${i.secondary.label === 'Reject' ? 'btn-bad' : ''}" data-ib='${esc(JSON.stringify(i.secondary))}' data-label="${esc(i.secondary.label)}">${esc(i.secondary.label)}</button>` : ''}
          ${!i.action && !i.secondary ? `<a class="btn btn-sm" href="${esc(i.href)}">Open</a>` : ''}
        </div>
      </div>`).join('')}
  </div>`).join('') : `
  <div class="panel"><div class="empty">Nothing anywhere in the company is waiting on a person. Every department reports here — publishing, sending, signing, gate verdicts, design review, verification — so this being empty means it is genuinely empty.</div></div>`}

  <div class="panel">
    <div class="map-legend">
      This queue collects <b>every</b> point where the platform stops for a human, from every department:
      run gate · design documents · social publishing · content approval · design sign-off · campaign go-live ·
      partner outreach · support replies · journey stages · financial reports · decisions · contracts ·
      product gates · intel and knowledge verification · problems, rituals and critical risks · and whatever the
      <a href="#/harmony">orchestrator</a> escalated. If something can wait on you, it appears here — the section
      pages remain the place to read the full context before you answer.
    </div>
  </div>`;

  view.querySelectorAll('[data-ib]').forEach((b) => b.addEventListener('click', async () => {
    let spec;
    try { spec = JSON.parse(b.dataset.ib); } catch { return; }
    b.disabled = true;
    try {
      await api(spec.path, { method: spec.method || 'POST', body: spec.body || {} });
      toast(`${b.dataset.label} — recorded as ${actor()}`);
      renderGate(); refreshShell();
    } catch (e) { toast(e.message, true); b.disabled = false; }
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
      <span><span class="chip ${p.state === 'live' ? 'chip-ok' : p.state === 'retired' ? 'chip-bad' : 'chip-ember'}">${esc(p.state)} · gate ${p.stage}/10</span> ${connBtn('product', p.id)}</span>
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
  wireConnections();
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
      <span><span class="state state-${i.state === 'closed' ? 'done' : i.state === 'open' ? 'failed' : 'awaiting_human'}">${esc(i.state)}</span> ${connBtn('incident', i.id)}</span>
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
  wireConnections();
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

const ENRICH_CHIP = {
  enriched: ['chip-ok', 'web-confirmed'],
  pending: ['chip-warn', 'harvesting…'],
  unreachable: ['chip-bad', 'site unreachable'],
  'no-domain': ['chip-dim', 'no domain found'],
};

function contactCell(r) {
  const line = (icon, val, title) => val ? `<div title="${esc(title || '')}"><span style="opacity:.6">${icon}</span> <span class="mono" style="user-select:all">${esc(val)}</span></div>` : '';
  const src = r.evidence?.find((e) => e.source_url)?.source_url;
  const gapList = (r.gaps || []).filter((g) => ['email', 'phone', 'address'].includes(g));
  return `
    ${line('✉', r.email, 'primary email')}${line('✉', r.email2, 'secondary email')}
    ${line('☎', r.phone, 'primary phone')}${line('☎', r.phone2, 'secondary phone')}
    ${line('◎', r.whatsapp, 'WhatsApp')}
    ${line('⌂', short(r.address, 60), r.address)}
    ${r.website ? `<div>🌐 <a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer">${esc(short(r.website.replace(/^https?:\/\//, ''), 34))}</a></div>` : ''}
    ${r.linkedin ? `<div>in <a href="${esc(r.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>` : ''}
    ${gapList.length ? `<div class="map-legend" style="color:var(--warn)">gap: ${gapList.join(', ')}</div>` : ''}
    ${src ? `<div class="map-legend">source: <a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(short(src.replace(/^https?:\/\//, ''), 40))}</a></div>` : '<div class="map-legend">source: model knowledge only</div>'}`;
}

const METHOD_BADGE = {
  'web-scrape': ['chip-ok', 'from site'],
  'model-knowledge': ['chip-dim', 'agent-named'],
  'pattern-derived': ['chip-warn', 'derived — unverified'],
  human: ['chip-steel', 'human'],
  dataset: ['chip-dim', 'dataset'],
};

function peopleBlock(r, canM) {
  const people = (r.contacts || []).filter((c) => c.name);
  if (!people.length) return '';
  return `<div class="people-block">
    <div class="map-legend" style="color:var(--steel)">People inside — ${people.length}</div>
    ${people.map((c) => {
      const [cls, txt] = METHOD_BADGE[c.method] || ['chip-dim', c.method];
      return `<div class="person-row">
        <span><b>${esc(c.name)}</b>${c.role ? ` <span style="color:var(--ink-mute)">· ${esc(short(c.role, 30))}</span>` : ''}</span>
        <span class="mono" style="font-size:11px">${[c.email, c.phone].filter(Boolean).map(esc).join(' · ') || '<span style="color:var(--warn)">no direct contact</span>'}</span>
        <span><span class="chip ${cls}" title="${esc(c.note || '')}">${txt}</span>${c.verification === 'verified' ? '<span class="chip chip-ok">✓</span>' : canM && (c.email || c.phone) ? `<button class="btn btn-sm" data-cverify="${c.id}" title="confirm this person — promotes their details to the record">✓</button>` : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

async function renderIntel() {
  const [ov, queries, segments, ruleCatalog] = await Promise.all([
    api('/api/intel/overview'), api('/api/intel'), api('/api/segments').catch(() => []), api('/api/intel/rules').catch(() => []),
  ]);
  const canM = hasPermC('intel.manage');
  const pctBar = (v) => `<div class="meter" style="margin:4px 0 0"><div class="meter-track"><div class="meter-fill ${v >= 70 ? '' : 'hot'}" style="width:${v}%"></div></div></div>`;

  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Records</div><div class="big">${ov.records}</div><div class="sub">${ov.campaigns} campaigns · ${ov.running} running</div></div>
    <div class="panel tile ${ov.withEmail ? 'tile-steel' : 'tile-warn'}"><div class="panel-title">Contactable</div><div class="big">${ov.withEmail}<span class="unit">✉</span> ${ov.withPhone}<span class="unit">☎</span></div><div class="sub">${ov.contacts} contact points harvested</div></div>
    <div class="panel tile"><div class="panel-title">Web-confirmed</div><div class="big">${ov.webConfirmed}</div><div class="sub">fetched from the org's own site</div></div>
    <div class="panel tile"><div class="panel-title">People found</div><div class="big">${ov.people ?? 0}</div><div class="sub">${ov.peopleWithDirect ?? 0} with a direct line or address</div></div>
    <div class="panel tile"><div class="panel-title">Avg completeness</div><div class="big">${ov.avgCompleteness}<span class="unit">%</span></div><div class="sub">${ov.verified} verified · ${ov.targeted} targeted</div>${pctBar(ov.avgCompleteness)}</div>
  </div>

  ${canM ? `<div class="panel">
    <div class="panel-title">New intelligence campaign — precise criteria beat a vague sentence</div>
    <div class="form-inline">
      <div><label class="fl">Type</label><select id="iq-kind"><option value="company">companies</option><option value="government body">government bodies</option><option value="ngo">NGOs</option><option value="investor">investors</option><option value="supplier">suppliers</option><option value="distributor">distributors</option></select></div>
      <div><label class="fl">Sector / القطاع</label><input type="text" id="iq-sector" placeholder="energy · oil & gas"></div>
      <div><label class="fl">Country / الدولة</label><input type="text" id="iq-country" placeholder="Iraq"></div>
      <div><label class="fl">City / المدينة</label><input type="text" id="iq-city" placeholder="Basra"></div>
      <div style="flex:0.5"><label class="fl">Size</label><select id="iq-size"><option value="">any</option><option>SME</option><option>mid-market</option><option>enterprise</option><option>state-owned</option></select></div>
      <div style="flex:0.4"><label class="fl">Target #</label><input type="text" id="iq-count" value="15"></div>
      <button class="btn btn-primary" id="iq-go">Run campaign</button>
    </div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Must relate to (keywords)</label><input type="text" id="iq-keywords" placeholder="refinery services, EPC contracts, solar"></div>
      <div><label class="fl">Exclude</label><input type="text" id="iq-exclude" placeholder="pure retailers"></div>
      <div style="flex:2"><label class="fl">Analyst note (Arabic or English)</label><input type="text" id="iq-q" placeholder="اريد شركات الطاقة العاملة في العراق مع طرق التواصل"></div>
    </div>

    <div class="panel-title" style="margin-top:14px">Escalation rules — what to do when a record comes back thin</div>
    <div class="rule-grid">
      ${ruleCatalog.map((r) => `
        <label class="rule-card">
          <input type="checkbox" class="iq-rule" value="${esc(r.id)}" ${['people-when-no-phone', 'ask-executives', 'derive-emails', 'deep-when-no-address'].includes(r.id) ? 'checked' : ''}>
          <span><b>${esc(r.label)}</b><span class="rule-detail">${esc(r.detail)}</span></span>
        </label>`).join('')}
    </div>

    <div class="panel-title" style="margin-top:14px">Constraints — a record only counts as a result if it passes these</div>
    <div class="form-inline">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-phone"> must have a phone</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-email"> must have an email</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="iq-req-site"> site must be reachable</label>
      <div style="flex:0.6"><label class="fl">Min complete %</label><input type="text" id="iq-min" value="0"></div>
      <div style="flex:1.2"><label class="fl">Profile must mention</label><input type="text" id="iq-mention" placeholder="oil, gas, refinery"></div>
      <div style="flex:1"><label class="fl">Reject if it mentions</label><input type="text" id="iq-notmention" placeholder="retail, restaurant"></div>
    </div>

    <div class="map-legend">
      <b>How a campaign runs:</b> ① the Intelligence agent proposes real organizations + their likely official domain →
      ② the platform <b>fetches each site over HTTP</b> (home, /contact, /about) and harvests emails, phones, address, socials — each stamped with its source URL →
      ③ records still missing a domain go back for a better hypothesis and are re-fetched →
      ④ more rounds run until the target count is met or two rounds return nothing new →
      ⑤ every record gets a completeness score and an explicit gap list. Contact details are <b>never</b> model-invented: they are scraped, human-entered, or declared a gap.
    </div>
  </div>` : ''}

  ${queries.map((iq) => {
    const p = iq.progress;
    return `
  <div class="panel">
    <div class="panel-title">
      <span>#${iq.id} · ${esc(short(iq.question, 80))}</span>
      <span>
        <span class="state state-${iq.state === 'ready' ? 'done' : iq.state === 'failed' ? 'failed' : 'running'}">${esc(iq.state)}${iq.state !== 'ready' ? ` · round ${iq.round}` : ''}</span>
        ${iq.records.length ? `
          <button class="btn btn-sm" data-download="/api/intel/export?queryId=${iq.id}&format=xls" data-filename="intel-${iq.id}.xls" title="real Excel workbook — typed columns, Arabic-safe">⬇ Excel</button>
          <button class="btn btn-sm" data-download="/api/intel/export?queryId=${iq.id}&format=csv" data-filename="intel-${iq.id}.csv" title="CSV with UTF-8 BOM">⬇ CSV</button>` : ''}
        ${canM && iq.records.length ? `<button class="btn btn-sm" data-autoseg="${iq.id}">AI segment</button>
        <button class="btn btn-sm btn-ok" data-bulk="${iq.id}">Bulk target verified</button>` : ''}
      </span>
    </div>
    ${iq.criteria ? `<div class="agent-meta">${Object.entries(iq.criteria).map(([k, v]) => `<span class="chip chip-dim">${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
    ${(iq.rules || []).length || iq.constraints ? `<div class="agent-meta">
      ${(iq.rules || []).map((rid) => `<span class="chip chip-ember" title="${esc(ruleCatalog.find((x) => x.id === rid)?.detail || '')}">⚙ ${esc(ruleCatalog.find((x) => x.id === rid)?.label || rid)}</span>`).join('')}
      ${iq.constraints ? Object.entries(iq.constraints).map(([k, v]) => `<span class="chip chip-warn">must: ${esc(k)}${v === true ? '' : ` = ${esc(v)}`}</span>`).join('') : ''}
    </div>` : ''}
    <div class="agent-meta">
      <span class="chip">${p.collected}/${p.target} collected</span>
      ${p.people ? `<span class="chip chip-steel">👤 ${p.people} people</span>` : ''}
      ${p.rejected ? `<span class="chip chip-bad">${p.rejected} rejected</span>` : ''}
      <span class="chip ${p.withEmail ? 'chip-ok' : 'chip-dim'}">✉ ${p.withEmail}</span>
      <span class="chip ${p.withPhone ? 'chip-ok' : 'chip-dim'}">☎ ${p.withPhone}</span>
      <span class="chip ${p.withAddress ? 'chip-ok' : 'chip-dim'}">⌂ ${p.withAddress}</span>
      <span class="chip chip-steel">${p.enriched} web-confirmed</span>
      ${p.pending ? `<span class="chip chip-warn">${p.pending} harvesting…</span>` : ''}
      <span class="chip">avg ${p.avgCompleteness}%</span>
      ${p.verified ? `<span class="chip chip-ok">${p.verified} verified</span>` : ''}
    </div>
    ${iq.summary ? `<div class="map-legend">${esc(short(iq.summary, 220))}</div>` : ''}
    ${iq.records.length ? `
    <table>
      <thead><tr><th style="width:26%">Organization / المنظمة</th><th>Location · sector</th><th style="width:26%">Contact — with provenance</th><th class="num">Complete</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${iq.records.map((r) => {
        const [chipCls, chipTxt] = ENRICH_CHIP[r.enrichment] || ['chip-dim', r.enrichment];
        const cp = Math.round((r.completeness || 0) * 100);
        return `
        <tr style="${r.rejected_reason ? 'opacity:.5' : ''}">
          <td><b>${esc(r.name)}</b>${r.name_ar ? `<div style="color:var(--ink-mute)">${esc(r.name_ar)}</div>` : ''}
            ${r.profile ? `<div class="map-legend">${esc(short(r.profile, 130))}</div>` : ''}
            <span class="chip ${chipCls}">${chipTxt}</span>${r.size_hint ? `<span class="chip chip-dim">${esc(r.size_hint)}</span>` : ''}
            ${r.rejected_reason ? `<span class="chip chip-bad" title="excluded by a campaign constraint">rejected: ${esc(r.rejected_reason)}</span>` : ''}
            ${r.email_pattern ? `<div class="map-legend">email pattern: <span class="mono">${esc(r.email_pattern)}</span></div>` : ''}
            ${(r.rulesLog || []).length ? `<div class="map-legend" style="color:var(--ink-faint)">${r.rulesLog.map((l) => `⚙ ${esc(l)}`).join('<br>')}</div>` : ''}</td>
          <td class="mono" style="font-size:11.5px">${esc([r.city, r.region, r.country].filter(Boolean).join(', ') || '—')}<div style="color:var(--ink-faint)">${esc(r.sector || '')}</div></td>
          <td style="font-size:11.5px">${contactCell(r)}${peopleBlock(r, canM)}</td>
          <td class="num" style="color:${cp >= 70 ? 'var(--ok)' : cp >= 40 ? 'var(--warn)' : 'var(--bad)'}">${cp}%</td>
          <td>
            <span class="chip ${r.verification === 'verified' ? 'chip-ok' : 'chip-warn'}">${esc(r.verification)}</span>
            ${r.customer_id ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">→ lead #${r.customer_id}</a>` : ''}
          </td>
          <td>${canM ? `
            ${r.verification === 'unverified' ? `<button class="btn btn-sm" data-iverify="${r.id}">Verify</button>` : ''}
            ${!r.customer_id ? `<button class="btn btn-sm btn-ok" data-itarget="${r.id}">→ CRM</button>` : ''}
            <button class="btn btn-sm" data-ifix="${r.id}" title="correct the website / add contacts by hand">Edit</button>
            <button class="btn btn-sm" data-irefetch="${r.id}" title="re-harvest the site now">↻</button>
            <button class="btn btn-sm" data-irules="${r.id}" title="re-run the campaign's escalation rules on this record">⚙</button>
            ${connBtn('intelRecord', r.id)}
            ${segments.length ? `<select data-isegsel="${r.id}" style="width:auto;font-size:11px"><option value="">+seg</option>${segments.map((s) => `<option value="${s.id}">${esc(short(s.name, 18))}</option>`).join('')}</select>` : ''}` : ''}
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>` : ['collecting', 'enriching', 'gapfill'].includes(iq.state) ? '<div class="empty">Working — collecting candidates…</div>' : '<div class="empty">No records.</div>'}
  </div>`;
  }).join('')}

  <div class="panel">
    <div class="panel-title">Where the data comes from — and where it stops</div>
    <div class="map-legend">
      <b>Real sources:</b> each organization's own website (home, contact, about pages) fetched live over HTTP; the source URL is stored per field and exported in the CSV.
      <b>Model knowledge:</b> used only to propose <i>which</i> organizations exist and their likely domain — never to fill a phone number or email.
      <b>Human:</b> the highest-trust source; anything you type in Edit overrides a scraped value and is recorded as such.
      <b>Gaps stay gaps:</b> if a site is unreachable or publishes no contact details, the record says so instead of guessing — that is what makes the export safe to act on.
      Outbound fetching is sandboxed: public http(s) hosts only, 8s timeout, 5 pages per organization.
    </div>
  </div>`;

  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#iq-go')?.addEventListener('click', async () => {
    const criteria = {
      kind: $('#iq-kind').value, sector: $('#iq-sector').value, country: $('#iq-country').value,
      city: $('#iq-city').value, size: $('#iq-size').value, keywords: $('#iq-keywords').value, exclude: $('#iq-exclude').value,
    };
    const rules = [...view.querySelectorAll('.iq-rule:checked')].map((c) => c.value);
    const constraints = {
      requirePhone: $('#iq-req-phone').checked, requireEmail: $('#iq-req-email').checked,
      requireWebsite: $('#iq-req-site').checked,
      minCompleteness: Number($('#iq-min').value) / 100 || null,
      mustMention: $('#iq-mention').value || null, excludeKeywords: $('#iq-notmention').value || null,
    };
    try {
      await api('/api/intel', { method: 'POST', body: { question: $('#iq-q').value || null, criteria, targetCount: Number($('#iq-count').value) || 15, rules, constraints } });
      toast(`Campaign started with ${rules.length} escalation rule(s)`); renderIntel();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-irules]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.irules}/rerun-rules`, { method: 'POST', body: {} }); toast('Re-running escalation rules…'); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-cverify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/contacts/${b.dataset.cverify}/verify`, { method: 'POST', body: {} }); toast('Contact confirmed — details promoted to the record'); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-iverify]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.iverify}/verify`, { method: 'POST', body: {} }); renderIntel(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-itarget]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await api(`/api/intel/records/${b.dataset.itarget}/target`, { method: 'POST', body: {} }); toast(`Targeted → CRM lead #${r.customer.id}`); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-ifix]').forEach((b) => b.addEventListener('click', async () => {
    const website = prompt('Official website (leave blank to keep):') || null;
    const email = prompt('Email (leave blank to keep):') || null;
    const phone = prompt('Phone (leave blank to keep):') || null;
    const address = prompt('Address (leave blank to keep):') || null;
    if (!website && !email && !phone && !address) return;
    try {
      await api(`/api/intel/records/${b.dataset.ifix}/edit`, { method: 'POST', body: { website, email, phone, address } });
      if (website) await api(`/api/intel/records/${b.dataset.ifix}/enrich`, { method: 'POST', body: { website } });
      toast('Recorded as human-sourced'); renderIntel();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-irefetch]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/intel/records/${b.dataset.irefetch}/enrich`, { method: 'POST', body: {} }); toast('Re-harvesting the site…'); renderIntel(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Target every verified record in this campaign as a CRM lead?')) return;
    try { const r = await api('/api/intel/bulk-target', { method: 'POST', body: { queryId: Number(b.dataset.bulk), verifiedOnly: true } }); toast(`${r.targeted} targeted · ${r.skipped} skipped`); renderIntel(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-isegsel]').forEach((sel) => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    try { await api(`/api/segments/${sel.value}/members`, { method: 'POST', body: { recordId: Number(sel.dataset.isegsel) } }); toast('Added to segment'); }
    catch (e) { toast(e.message, true); }
    sel.value = '';
  }));
  view.querySelectorAll('[data-autoseg]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/api/intel/${b.dataset.autoseg}/auto-segment`, { method: 'POST', body: {} }); toast('AI segmentation running — see Segments shortly'); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

async function renderSegments() {
  const [segments, queries] = await Promise.all([api('/api/segments'), api('/api/intel').catch(() => [])]);
  const canM = hasPermC('segments.manage');
  view.innerHTML = `
  ${canM ? `<div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Build a segment from live filters — intelligence → audience in one step</div>
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl">Segment name</label><input type="text" id="sg-bname" placeholder="Iraqi energy — contactable"></div>
        <div><label class="fl">Country</label><input type="text" id="sg-country" placeholder="Iraq"></div>
        <div><label class="fl">Sector</label><input type="text" id="sg-sector" placeholder="energy"></div>
        <div style="flex:0.7"><label class="fl">Campaign</label><select id="sg-query"><option value="">any</option>${queries.map((iq) => `<option value="${iq.id}">#${iq.id} ${esc(short(iq.question, 24))}</option>`).join('')}</select></div>
      </div>
      <div class="form-inline">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="sg-contactable" checked> contactable only (has email or phone)</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="sg-verified"> human-verified only</label>
        <div style="flex:0.5"><label class="fl">Min complete %</label><input type="text" id="sg-minc" value="0"></div>
        <button class="btn btn-primary" id="sg-build">Build segment</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Or start empty and add members by hand</div>
      <div class="form-inline">
        <div><label class="fl">Name</label><input type="text" id="sg-name"></div>
        <div style="flex:2"><label class="fl">Description</label><input type="text" id="sg-desc"></div>
        <button class="btn btn-primary" id="sg-go">Create</button>
      </div>
      <div class="map-legend">Members come from <a href="#/intel">Intelligence</a>. A segment can go straight to <a href="#/marketing">Marketing</a> as a campaign audience, export to Excel, or bulk-target into the <a href="#/customers">CRM</a>. Autopilot also builds segments on its own — see <a href="#/autopilot">the mesh</a>.</div>
    </div>
  </div>` : ''}
  ${segments.map((s) => `
  <div class="panel">
    <div class="panel-title">
      <span>${esc(s.name)}
        <span class="chip ${{ ai: 'chip-steel', nexus: 'chip-ember', filter: 'chip-ok' }[s.source] || 'chip-dim'}">${esc(s.source)}</span>
        <span class="chip">${s.stats.size} members</span>
        <span class="chip ${s.stats.contactable ? 'chip-ok' : 'chip-warn'}">${s.stats.contactable} contactable</span>
      </span>
      <span>
        ${s.stats.size ? `
          <button class="btn btn-sm" data-download="/api/intel/export?segmentId=${s.id}&format=xls" data-filename="segment-${s.id}.xls">⬇ Excel</button>
          <button class="btn btn-sm" data-download="/api/intel/export?segmentId=${s.id}&format=csv" data-filename="segment-${s.id}.csv">⬇ CSV</button>` : ''}
        ${canM && s.stats.size && !s.campaign ? `<button class="btn btn-sm btn-ok" data-sgcamp="${s.id}">→ Campaign</button>` : ''}
        ${canM && s.stats.size ? `<button class="btn btn-sm" data-sgbulk="${s.id}">→ CRM (verified)</button>` : ''}
        ${connBtn('segment', s.id)}
      </span>
    </div>
    ${s.description ? `<div class="map-legend">${esc(s.description)}</div>` : ''}
    <div class="agent-meta">
      <span class="chip chip-dim">✉ ${s.stats.withEmail}</span>
      <span class="chip chip-dim">☎ ${s.stats.withPhone}</span>
      <span class="chip chip-dim">avg ${s.stats.avgCompleteness}%</span>
      ${s.stats.verified ? `<span class="chip chip-ok">${s.stats.verified} verified</span>` : ''}
      ${s.stats.targeted ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">${s.stats.targeted} in CRM</a>` : ''}
      ${s.campaign ? `<a class="chip chip-ember" style="text-decoration:none" href="#/marketing">campaign #${s.campaign.id} · ${esc(s.campaign.state)}</a>` : ''}
      ${s.stats.countries.map((c) => `<span class="chip chip-dim">${esc(c)}</span>`).join('')}
      ${s.stats.sectors.map((c) => `<span class="chip chip-steel">${esc(c)}</span>`).join('')}
    </div>
    ${s.criteria ? `<div class="map-legend">filters: ${Object.entries(s.criteria).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>` : ''}
    <table>
      <tbody>${s.members.slice(0, 12).map((m) => `
        <tr>
          <td><b>${esc(short(m.name, 34))}</b>${m.name_ar ? `<div style="color:var(--ink-mute);font-size:11px">${esc(m.name_ar)}</div>` : ''}</td>
          <td class="mono" style="font-size:11px">${esc([m.city, m.country].filter(Boolean).join(', ') || '—')}</td>
          <td class="mono" style="font-size:11px">${[m.email, m.phone].filter(Boolean).map(esc).join(' · ') || '<span style="color:var(--warn)">no contact</span>'}</td>
          <td class="num" style="color:${m.completeness >= 0.7 ? 'var(--ok)' : 'var(--warn)'}">${Math.round(m.completeness * 100)}%</td>
          <td>${m.customer_id ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">lead #${m.customer_id}</a>` : `<span class="chip ${m.verification === 'verified' ? 'chip-steel' : 'chip-dim'}">${esc(m.verification)}</span>`}
              ${canM ? `<button class="btn btn-sm" data-sgrm="${s.id}" data-rec="${m.id}" title="remove from segment">✕</button>` : ''}</td>
        </tr>`).join('') || '<tr><td class="empty">Empty — add members from Intelligence.</td></tr>'}
        ${s.members.length > 12 ? `<tr><td colspan="5" class="map-legend">…and ${s.members.length - 12} more — export to see them all</td></tr>` : ''}
      </tbody>
    </table>
  </div>`).join('') || '<div class="panel"><div class="empty">No segments yet — build one above, or let Autopilot group contactable records for you.</div></div>'}`;

  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#sg-go')?.addEventListener('click', async () => {
    try { await api('/api/segments', { method: 'POST', body: { name: $('#sg-name').value, description: $('#sg-desc').value || null } }); renderSegments(); }
    catch (e) { toast(e.message, true); }
  });
  $('#sg-build')?.addEventListener('click', async () => {
    try {
      const s = await api('/api/segments/build', { method: 'POST', body: {
        name: $('#sg-bname').value, country: $('#sg-country').value || null, sector: $('#sg-sector').value || null,
        queryId: $('#sg-query').value ? Number($('#sg-query').value) : null,
        contactableOnly: $('#sg-contactable').checked, verifiedOnly: $('#sg-verified').checked,
        minCompleteness: Number($('#sg-minc').value) / 100 || null,
      } });
      toast(`Segment built — ${s.stats.size} members, ${s.stats.contactable} contactable`); renderSegments();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-sgcamp]').forEach((b) => b.addEventListener('click', async () => {
    try { const c = await api(`/api/segments/${b.dataset.sgcamp}/campaign`, { method: 'POST', body: { channel: 'email' } }); toast(`Campaign #${c.id} created — copy drafting`); location.hash = '#/marketing'; }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sgbulk]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Target every verified member of this segment into the CRM?')) return;
    try { const r = await api('/api/intel/bulk-target', { method: 'POST', body: { segmentId: Number(b.dataset.sgbulk), verifiedOnly: true } }); toast(`${r.targeted} targeted · ${r.skipped} skipped`); renderSegments(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-sgrm]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/segments/${b.dataset.sgrm}/members/remove`, { method: 'POST', body: { recordId: Number(b.dataset.rec) } }); renderSegments(); }
    catch (e) { toast(e.message, true); }
  }));
}

const DS_SOURCE_ICON = { tickets: '🎧', 'intel-records': '🔍', incidents: '🚨', customers: '👤', interactions: '🤝', 'social-metrics': '📱', audit: '⛓' };

async function renderDatasets() {
  const [datasets, sources] = await Promise.all([api('/api/datasets'), api('/api/datasets/sources').catch(() => [])]);
  const canM = hasPermC('datasets.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Pull data from inside the company — no copy-paste needed</div>
    <div class="agent-meta">
      ${sources.map((s) => `<button class="btn btn-sm" data-dssrc="${esc(s.id)}" ${s.rows ? '' : 'disabled'} title="${esc(s.label)}">${DS_SOURCE_ICON[s.id] || '▪'} ${esc(s.label)} <span class="chip chip-dim">${s.rows}</span></button>`).join('')}
    </div>
    <div class="map-legend">Each button snapshots that department's live data into a dataset you can clean, summarize, or mine for entities. Summaries flow onward into <a href="#/knowledge">Knowledge</a>; extracted entities open a new <a href="#/intel">Intelligence</a> campaign complete with web enrichment.</div>
  </div>
  <div class="panel">
    <div class="panel-title">Or store your own — paste anything (CSV, JSON, text, mixed Arabic/English)</div>
    <div class="form-inline">
      <div><label class="fl">Name</label><input type="text" id="ds-name"></div>
      <button class="btn btn-primary" id="ds-go">Store</button>
    </div>
    <div><label class="fl">Raw data (treated as untrusted input — never executed, never obeyed)</label><textarea id="ds-raw" style="min-height:100px"></textarea></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Datasets — clean · summarize → Knowledge · extract entities → Intelligence</div>
    <table>
      <thead><tr><th>Name</th><th>Source</th><th class="num">Size</th><th>Op</th><th>State</th><th>Flows to</th>${canM ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${datasets.map((d) => `
        <tr class="rowlink" data-dsrow="${d.id}">
          <td><b>${esc(short(d.name, 46))}</b>${d.parent_id ? ` <span class="chip chip-dim">from #${d.parent_id}</span>` : ''}</td>
          <td><span class="chip ${d.source_kind && d.source_kind !== 'manual' ? 'chip-steel' : 'chip-dim'}">${DS_SOURCE_ICON[d.source_kind] || ''} ${esc(d.source_kind || 'manual')}</span></td>
          <td class="num">${(d.raw_chars / 1024).toFixed(1)} KB</td>
          <td class="mono">${esc(d.op || '—')}</td>
          <td><span class="state state-${d.state === 'done' ? 'done' : d.state === 'failed' ? 'failed' : d.state === 'processing' ? 'running' : 'queued'}">${esc(d.state)}</span></td>
          <td class="mono" style="font-size:11px">${d.state === 'done' && d.op === 'summarize' ? '<a href="#/knowledge">knowledge →</a>' : d.state === 'done' && d.op === 'extract-entities' ? '<a href="#/intel">intel campaign →</a>' : '<a href="#/archive">archive</a>'} ${connBtn('dataset', d.id)}</td>
          ${canM ? `<td>${['stored', 'done', 'failed'].includes(d.state) ? ['clean', 'summarize', 'extract-entities'].map((op) => `<button class="btn btn-sm" data-dsop="${d.id}" data-op="${op}">${op}</button>`).join(' ') : '…'}</td>` : ''}
        </tr>
        <tr class="run-detail" data-dsdetail="${d.id}" hidden><td colspan="7"><pre class="json" id="ds-view-${d.id}">click row again to load…</pre></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No datasets — pull one from a department above.</td></tr>'}
      </tbody>
    </table>
  </div>`;
  view.querySelectorAll('[data-dsrow]').forEach((row) => row.addEventListener('click', async () => {
    const id = row.dataset.dsrow;
    const detail = view.querySelector(`[data-dsdetail="${id}"]`);
    detail.hidden = !detail.hidden;
    if (!detail.hidden) {
      try { const d = await api(`/api/datasets/${id}`); $(`#ds-view-${id}`).textContent = d.result ? JSON.stringify(d.result, null, 2) : d.raw.slice(0, 3000); } catch { /* leave */ }
    }
  }));
  wireConnections();
  if (!canM) return;
  $('#ds-go')?.addEventListener('click', async () => {
    try { await api('/api/datasets', { method: 'POST', body: { name: $('#ds-name').value, raw: $('#ds-raw').value } }); renderDatasets(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dssrc]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { const d = await api('/api/datasets/from-source', { method: 'POST', body: { source: b.dataset.dssrc } }); toast(`Pulled "${short(d.name, 40)}" — now transform it`); renderDatasets(); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-dsop]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api(`/api/datasets/${b.dataset.dsop}/transform`, { method: 'POST', body: { op: b.dataset.op } }); toast(`${b.dataset.op} running`); renderDatasets(); }
    catch (err) { toast(err.message, true); }
  }));
}

async function renderArchive() {
  const kind = view.dataset.arcKind || '';
  const search = view.dataset.arcSearch || '';
  const { stats, items } = await api(`/api/archive?kind=${encodeURIComponent(kind)}&search=${encodeURIComponent(search)}`);
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Archived items</div><div class="big">${stats.total}</div><div class="sub">${stats.last7d} this week</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">With files</div><div class="big">${stats.withFiles}</div><div class="sub">CSV · SVG · reports on disk</div></div>
    <div class="panel tile"><div class="panel-title">Kinds</div><div class="big">${stats.byKind.length}</div><div class="sub">${stats.byKind.slice(0, 3).map((k) => `${k.kind} ${k.n}`).join(' · ')}</div></div>
    <div class="panel tile"><div class="panel-title">Linked departments</div><div class="big">${stats.bySubject.length}</div><div class="sub">every snapshot points home</div></div>
  </div>
  <div class="panel">
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Search titles</label><input type="text" id="arc-q" value="${esc(search)}" placeholder="intel, contract, journey…"></div>
      <div><label class="fl">Kind</label><select id="arc-kind"><option value="">all</option>${stats.byKind.map((k) => `<option value="${esc(k.kind)}" ${k.kind === kind ? 'selected' : ''}>${esc(k.kind)} (${k.n})</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="arc-go">Filter</button>
    </div>
    <div class="agent-meta">${stats.bySubject.map((s) => `<span class="chip chip-dim">${esc(s.subject_type)} · ${s.n}</span>`).join('')}</div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Repository — frozen snapshots from every section (${items.length} shown)</div>
      <table>
        <thead><tr><th>Kind</th><th>Title</th><th>Source</th><th>By</th><th>When</th></tr></thead>
        <tbody>${items.map((a) => `
          <tr class="rowlink" data-arc="${a.id}">
            <td><span class="chip ${{ 'intel-export': 'chip-steel', contract: 'chip-ember', campaign: 'chip-warn', finance: 'chip-ok', dataset: 'chip-dim' }[a.kind] || 'chip-dim'}">${esc(a.kind)}</span></td>
            <td>${esc(short(a.title, 56))}${a.file_ref ? ' <span class="chip chip-dim">file</span>' : ''}</td>
            <td>${(() => { const h = linkFor(a.subject_type, a.subject_id); return h ? `<a class="mono" style="color:var(--steel)" href="${h}">${esc(a.subject_type)} ${esc(short(a.subject_id || '', 12))}</a>` : '<span class="mono" style="color:var(--ink-faint)">—</span>'; })()}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(short(a.created_by, 16))}</td>
            <td class="mono" style="color:var(--ink-faint)">${esc(a.created_at.slice(0, 16))}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing matches — snapshots arrive automatically as work completes.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="panel-title" id="arc-title">Snapshot viewer</div>
      <pre class="json" id="arc-view" style="max-height:520px">Select an item.</pre>
      <div id="arc-file" class="map-legend"></div>
      <div id="arc-links"></div>
    </div>
  </div>`;
  $('#arc-go').addEventListener('click', () => {
    view.dataset.arcKind = $('#arc-kind').value;
    view.dataset.arcSearch = $('#arc-q').value;
    renderArchive();
  });
  view.querySelectorAll('[data-arc]').forEach((row) => row.addEventListener('click', async () => {
    try {
      const a = await api(`/api/archive/${row.dataset.arc}`);
      $('#arc-title').textContent = a.title;
      $('#arc-view').textContent = a.snapshot ? JSON.stringify(a.snapshot, null, 2) : '(no snapshot payload)';
      const home = linkFor(a.subject_type, a.subject_id);
      $('#arc-file').innerHTML = [
        a.file_ref ? `file: <a href="#/artifacts/${encodeURIComponent(a.file_ref)}" style="color:var(--steel)">${esc(a.file_ref)}</a>` : '',
        home ? `source: <a href="${home}">${esc(a.subject_type)} #${esc(a.subject_id)} →</a>` : '',
      ].filter(Boolean).join(' · ');
      if (a.subject_type && a.subject_id) await renderConnections('#arc-links', a.subject_type, a.subject_id);
      else $('#arc-links').innerHTML = '';
    } catch (e) { toast(e.message, true); }
  }));
}

// ---------- the 360° connections block (used on every entity page) ----------
const DEPT_HREF = {
  sales: '#/sales', customers: '#/customers', support: '#/support', relations: '#/relations',
  marketing: '#/marketing', products: '#/products', intel: '#/intel', segments: '#/segments',
  social: '#/social', content: '#/content', design: '#/design', incidents: '#/incidents',
  risks: '#/risks', knowledge: '#/knowledge', pipelines: '#/pipelines', journeys: '#/journeys',
  runs: '#/runs', tasks: '#/tasks', projects: '#/projects', legal: '#/legal', vendors: '#/vendors',
  objectives: '#/objectives', archive: '#/archive', evals: '#/evals', oversight: '#/oversight', data: '#/data',
};

/** A 🔗 button any row can carry; opens the connections drawer for that entity. */
const connBtn = (type, id, label = '🔗') =>
  `<button class="btn btn-sm" data-conn-type="${esc(type)}" data-conn-id="${esc(String(id))}" title="show everything connected to this">${label}</button>`;

/** Delegate every 🔗 button on the current page to a shared drawer. */
function wireConnections() {
  view.querySelectorAll('[data-conn-type]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    let host = $('#conn-drawer');
    if (!host) { host = document.createElement('div'); host.id = 'conn-drawer'; host.className = 'panel'; view.appendChild(host); }
    host.innerHTML = '<div class="empty">Loading connections…</div>';
    await renderConnections('#conn-drawer', b.dataset.connType, b.dataset.connId);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
}

/** Render "what else is connected to this" into a container selector. */
async function renderConnections(sel, type, id) {
  const host = $(sel);
  if (!host) return;
  let c;
  try { c = await api(`/api/links/${type}/${encodeURIComponent(id)}`); } catch { host.innerHTML = ''; return; }
  if (!c || !c.totalLinks) { host.innerHTML = '<div class="map-legend">No connections recorded yet.</div>'; return; }
  host.innerHTML = `
    <div class="panel-title" style="margin-top:12px">Connected across the company — ${c.totalLinks} links</div>
    ${c.groups.map((g2) => `
      <div class="conn-group">
        <a class="conn-dept" href="${DEPT_HREF[g2.dept] || '#/'}">${esc(g2.label)}</a>
        <div class="agent-meta">${g2.items.map((it) => {
          const href = it.type === 'url' ? it.id : (linkFor(it.type, it.id) || DEPT_HREF[g2.dept] || '#/');
          const ext = it.type === 'url';
          return `<a class="chip chip-dim" style="text-decoration:none" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''} title="${esc(it.sub || '')}">${esc(short(it.title, 34))}${it.sub ? ` <span style="color:var(--ink-faint)">· ${esc(short(it.sub, 22))}</span>` : ''}</a>`;
        }).join('')}</div>
      </div>`).join('')}
    ${c.auditTrail.length ? `<div class="map-legend" style="margin-top:8px">Recent on the <a href="#/audit">chain</a>: ${c.auditTrail.slice(0, 5).map((a) => `${esc(a.action)} <span style="color:var(--ink-faint)">(${esc(a.actor_id)})</span>`).join(' · ')}</div>` : ''}`;
}

// ---------- Graph — the department relationship matrix ----------
async function renderGraph() {
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
      <span><span class="state state-${c.state === 'live' ? 'done' : c.state === 'paused' ? 'failed' : c.state === 'pending_approval' ? 'awaiting_human' : 'running'}">${esc(c.state)}</span> ${connBtn('campaign', c.id)}</span>
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
  wireConnections();
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
          <td>${connBtn('customer', c.id)}
            ${c.state !== 'churned' ? `
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
  wireConnections();
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
  </div>
  ${currentUser?.role === 'superadmin' ? `
  <div class="panel" style="margin-top:16px;border-color:#e5533d">
    <div class="panel-title" style="color:#e5533d">Danger zone — wipe all data</div>
    <p style="color:var(--ink-mute);margin:0 0 10px;max-width:70ch">
      Erases every record in the company — runs, decisions, pipelines, tickets, customers,
      intelligence, projects, notifications, and the audit chain, which restarts with a genesis
      entry naming who wiped it. Default agents, rituals, and registers are re-seeded so the
      platform stays usable. <b>This cannot be undone.</b>
    </p>
    <label style="display:block;margin:4px 0"><input type="checkbox" id="wipe-full">
      Full factory reset — also delete user accounts, sessions, and provider settings
      (you will be signed out; <span class="mono">admin / crucible</span> is restored)</label>
    <label style="display:block;margin:4px 0 12px"><input type="checkbox" id="wipe-ws">
      Also delete produced workspace files (blueprints, designs, exports…)</label>
    <div class="form-inline">
      <input id="wipe-confirm" placeholder="Type: WIPE ALL DATA" style="width:200px">
      <input id="wipe-pass" type="password" placeholder="Your password" autocomplete="current-password" style="width:170px">
      <button class="btn btn-bad" id="wipe-go">Wipe all data</button>
      <span id="wipe-out" class="mono" style="color:var(--ink-mute)"></span>
    </div>
  </div>` : ''}`;
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
  $('#wipe-go')?.addEventListener('click', async (e) => {
    const full = $('#wipe-full').checked;
    e.target.disabled = true; $('#wipe-out').textContent = 'wiping…';
    try {
      const r = await api('/api/system/wipe', { method: 'POST', body: {
        confirm: $('#wipe-confirm').value.trim(), password: $('#wipe-pass').value,
        full, workspace: $('#wipe-ws').checked,
      } });
      if (full) { localStorage.removeItem(TOKEN_KEY); location.hash = '#/'; location.reload(); return; }
      toast(`Wiped ${r.tablesCleared} tables — fresh company, chain restarted`);
      location.hash = '#/'; location.reload();
    } catch (err) {
      $('#wipe-out').textContent = err.message; toast(err.message, true); e.target.disabled = false;
    }
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

// ---------- Workforce — the AI employees ----------
async function renderWorkforce() {
  const wf = await api('/api/workforce');
  const groups = [['discover', 'DISCOVER'], ['build', 'BUILD'], ['assure', 'ASSURE'], ['run', 'RUN'], ['create', 'CREATE'], ['steer', 'STEER']];
  const rep = (r) => r == null ? '—' : `<span class="chip ${r >= 1.05 ? 'chip-ok' : r < 0.95 ? 'chip-warn' : 'chip-dim'}">rep ${Number(r).toFixed(2)}</span>`;
  const card = (a) => `
    <div class="panel agent-card" style="border-left:3px solid ${a.busy ? 'var(--ember)' : 'var(--edge)'}">
      <div class="agent-head">
        <span class="agent-name">${esc(a.name)}</span>
        <span>
          ${a.busy ? `<span class="chip chip-ember">● ${a.busy} working</span>` : '<span class="chip chip-dim">idle</span>'}
          <span class="chip ${a.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(a.status)}</span>
        </span>
      </div>
      <div class="agent-id">${esc(a.id)} · tier ${esc(a.tier)} · owner ${esc(a.owner)} · ${esc(a.failMode || '')}</div>
      <div class="agent-meta">
        ${rep(a.reputation)}
        <span class="chip">runs ${a.runs.done}✓ ${a.runs.failed}✗</span>
        <span class="chip">week ${a.week.n} · ${money4(a.week.cost)}</span>
        <span class="chip">tasks ${a.tasksDone} done</span>
        ${a.runs.gate ? `<a class="chip chip-warn" style="text-decoration:none" href="#/gate">⏸ ${a.runs.gate} at gate</a>` : ''}
      </div>
      ${a.journeyStages.length ? `<div class="agent-meta">${a.journeyStages.map((s2) => `
        <a class="chip chip-steel" style="text-decoration:none" href="#/journeys/${s2.journey_id}">🧭 ${esc(short(s2.journey_title, 26))} · ${esc(s2.dept)}${s2.state === 'awaiting_human' ? ' ⏸' : ''}</a>`).join('')}</div>` : ''}
      ${a.openTasks.length ? `<table style="margin-top:8px"><tbody>${a.openTasks.map((t) => `
        <tr><td><a href="#/tasks" style="color:var(--ink)">${esc(short(t.title, 46))}</a></td>
        <td><span class="state state-${t.state === 'doing' ? 'running' : t.state === 'blocked' ? 'awaiting_human' : 'queued'}">${esc(t.state)}</span></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="map-legend" style="margin-top:8px">
        last active: ${a.lastActive ? `${esc(a.lastActive.at.slice(0, 16))} · ${esc(short(a.lastActive.taskType, 30))}` : 'never'}
        · <a href="#/tasks">assign a task →</a>
      </div>
    </div>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Headcount (AI)</div><div class="big">${wf.length}</div><div class="sub">agents on the org chart</div></div>
    <div class="panel tile ${wf.filter((a) => a.busy).length ? 'tile-warn' : ''}"><div class="panel-title">Working right now</div><div class="big">${wf.filter((a) => a.busy).length}</div><div class="sub">with active runs, tasks, or journey stages</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Held at the gate</div><div class="big">${wf.reduce((n, a) => n + (a.runs.gate || 0), 0)}</div><div class="sub"><a href="#/gate">resolve →</a></div></div>
    <div class="panel tile"><div class="panel-title">All-time output</div><div class="big">${wf.reduce((n, a) => n + (a.runs.done || 0), 0)}</div><div class="sub">runs completed · ${money(wf.reduce((n, a) => n + (a.runs.cost || 0), 0))} total</div></div>
  </div>
  ${groups.map(([g, label]) => {
    const members = wf.filter((a) => a.roleGroup === g);
    return members.length ? `<div class="panel-title" style="margin:16px 0 8px">${label} · ${members.length}</div>
      <div class="grid grid-3">${members.map(card).join('')}</div>` : '';
  }).join('')}`;
}

// ---------- Relations (RM) ----------
async function renderRelations() {
  const [ov, partners] = await Promise.all([api('/api/relations'), api('/api/partners')]);
  const canM = hasPermC('relations.manage');
  const health = (h) => '●'.repeat(h) + '○'.repeat(5 - h);
  const kindChip = (k) => ({ partner: 'chip-steel', investor: 'chip-ember', government: 'chip-warn', media: 'chip-dim', community: 'chip-ok', strategic: 'chip-bad' }[k] || 'chip-dim');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Active relationships</div><div class="big">${ov.active}</div><div class="sub">${ov.prospects} prospects · avg health ${ov.avgHealth ? Number(ov.avgHealth).toFixed(1) : '—'}/5</div></div>
    <div class="panel tile ${ov.overdue.length ? 'tile-warn' : ''}"><div class="panel-title">Overdue follow-ups</div><div class="big">${ov.overdue.length}</div><div class="sub">next actions past their date</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Coming up · 14d</div><div class="big">${ov.upcoming.length}</div><div class="sub">scheduled next actions</div></div>
    <div class="panel tile ${ov.stale.length ? 'tile-warn' : ''}"><div class="panel-title">Gone quiet · 30d+</div><div class="big">${ov.stale.length}</div><div class="sub">active but untouched</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">New relationship — partners, investors, government, media, community</div>
    <div class="form-inline">
      <div style="flex:1.6"><label class="fl">Name</label><input type="text" id="pr-name"></div>
      <div><label class="fl">Kind</label><select id="pr-kind"><option>partner</option><option>investor</option><option>government</option><option>media</option><option>community</option><option>strategic</option></select></div>
      <div><label class="fl">Tier</label><select id="pr-tier"><option>standard</option><option>key</option><option>strategic</option></select></div>
      <div><label class="fl">Owner</label><input type="text" id="pr-owner" value="${esc(currentUser?.username || '')}"></div>
      <button class="btn btn-primary" id="pr-go">Add</button>
    </div>
    <div><label class="fl">Notes</label><input type="text" id="pr-notes" placeholder="context, who introduced, what they want"></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Relationship register — the RM agent drafts, a human always sends</div>
    <table>
      <thead><tr><th>Name</th><th>Kind · tier</th><th>Health</th><th>Last touch</th><th>Next action</th><th>State</th>${canM ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${partners.map((p) => `
        <tr style="${p.state === 'ended' ? 'opacity:.45' : ''}">
          <td><b>${esc(p.name)}</b><div class="map-legend">${esc(short(p.notes || '', 60))}</div>
            ${p.draft ? `<div class="round" style="margin-top:6px"><div class="round-body">
              <div class="map-legend" style="color:var(--ember)">AI outreach draft — review, then send it yourself:</div>
              <div style="font-size:12px;margin:4px 0">${esc(short(p.draft, 280))}</div>
              ${canM ? `<button class="btn btn-sm btn-ok" data-pr-send="${p.id}">Mark sent (by me)</button>` : ''}
            </div></div>` : ''}</td>
          <td><span class="chip ${kindChip(p.kind)}">${esc(p.kind)}</span> <span class="chip chip-dim">${esc(p.tier)}</span></td>
          <td class="mono" style="color:${p.health >= 4 ? 'var(--ok)' : p.health <= 2 ? 'var(--bad)' : 'var(--warn)'}" title="relationship health ${p.health}/5">${health(p.health)}</td>
          <td class="mono" style="color:var(--ink-faint)">${p.lastTouch ? `${esc(p.lastTouch.created_at.slice(0, 10))} · ${esc(p.lastTouch.kind)}` : 'never'} · ${p.touches}×</td>
          <td>${p.nextAction ? `${esc(short(p.nextAction.next_action, 34))} <span class="mono" style="color:${p.nextAction.next_date && p.nextAction.next_date < new Date().toISOString().slice(0, 10) ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(p.nextAction.next_date || '')}</span>` : '—'}</td>
          <td><span class="state state-${p.state === 'active' ? 'done' : p.state === 'ended' ? 'failed' : 'queued'}">${esc(p.state)}</span></td>
          ${canM ? `<td>
            ${connBtn('partner', p.id)}
            <button class="btn btn-sm" data-pr-log="${p.id}" data-pr-name="${esc(p.name)}">Log</button>
            <button class="btn btn-sm" data-pr-draft="${p.id}" ${p.draft_run_id && !p.draft ? 'disabled' : ''}>${p.draft_run_id && !p.draft ? 'drafting…' : 'AI outreach'}</button>
            ${['prospect', 'dormant'].includes(p.state) ? `<button class="btn btn-sm btn-ok" data-pr-state="${p.id}" data-to="active">activate</button>` : ''}
            ${p.state === 'active' ? `<button class="btn btn-sm" data-pr-state="${p.id}" data-to="dormant">dormant</button>` : ''}
            ${[1, 2, 3, 4, 5].map((h) => `<button class="btn btn-sm" data-pr-health="${p.id}" data-h="${h}" title="set health ${h}/5" style="padding:2px 6px;${p.health === h ? 'color:var(--ember)' : ''}">${h}</button>`).join('')}
          </td>` : ''}
        </tr>`).join('') || `<tr><td colspan="7" class="empty">No relationships yet${canM ? ' — add the first one above' : ''}.</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Follow-ups</div>
      ${[...ov.overdue.map((u) => ({ ...u, od: true })), ...ov.upcoming].map((u) => `
        <div class="round"><div class="round-body" style="display:flex;justify-content:space-between">
          <span>${esc(u.name)} — ${esc(short(u.next_action, 60))}</span>
          <span class="mono" style="color:${u.od ? 'var(--bad)' : 'var(--ink-faint)'}">${esc(u.next_date)}</span>
        </div></div>`).join('') || '<div class="empty">Nothing scheduled.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Recent interactions</div>
      ${ov.recent.map((i) => `
        <div class="round"><div class="round-body">
          <span class="chip chip-dim">${esc(i.kind)}</span> <b>${esc(i.partner_name || (i.customer_id ? 'customer #' + i.customer_id : i.vendor_id || ''))}</b>
          — ${esc(short(i.summary, 90))}
          <span class="mono" style="color:var(--ink-faint);float:right">${esc(i.created_at.slice(0, 16))}</span>
        </div></div>`).join('') || '<div class="empty">No interactions logged.</div>'}
    </div>
  </div>`;
  wireConnections();
  if (!canM) return;
  $('#pr-go')?.addEventListener('click', async () => {
    try {
      await api('/api/partners', { method: 'POST', body: { name: $('#pr-name').value, kind: $('#pr-kind').value, tier: $('#pr-tier').value, owner: $('#pr-owner').value, notes: $('#pr-notes').value || null } });
      toast('Relationship added'); renderRelations();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-pr-log]').forEach((b) => b.addEventListener('click', async () => {
    const summary = prompt(`Log an interaction with ${b.dataset.prName} — what happened?`);
    if (!summary) return;
    const nextAction = prompt('Next action (optional):') || null;
    const nextDate = nextAction ? (prompt('Next action date (YYYY-MM-DD, optional):') || null) : null;
    try { await api('/api/interactions', { method: 'POST', body: { partnerId: Number(b.dataset.prLog), kind: 'note', summary, nextAction, nextDate } }); toast('Logged'); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-draft]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prDraft}/outreach`, { method: 'POST', body: {} }); toast('RM agent is drafting — the draft lands on the card'); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-send]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prSend}/send`, { method: 'POST', body: {} }); toast(`Outreach recorded as sent by ${actor()}`); renderRelations(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-state]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prState}/state`, { method: 'POST', body: { state: b.dataset.to } }); renderRelations(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pr-health]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/partners/${b.dataset.prHealth}/health`, { method: 'POST', body: { health: Number(b.dataset.h) } }); renderRelations(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Company Journeys — the value chain ----------
const DEPT_COLORS = {
  strategy: '#948b7d', research: '#5ec3c9', product: '#b78bff', finance: '#ffb020',
  legal: '#e5533d', architecture: '#78bf6d', engineering: '#ff6b2c', review: '#5ec3c9',
  qa: '#ffb020', security: '#e5533d', release: '#78bf6d', marketing: '#b78bff',
  support: '#5ec3c9', governance: '#948b7d',
};

async function renderJourneys() {
  const [journeys, products] = await Promise.all([api('/api/journeys'), api('/api/products').catch(() => [])]);
  const canM = hasPermC('journeys.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Start a company journey — the order crosses ALL 14 departments: strategy → research → product → finance → legal → architecture → engineering → review → QA → security → release → marketing → support → governance</div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">What is being built / ordered?</label><input type="text" id="jn-title" placeholder="e.g. Invoice OCR micro-SaaS for Iraqi SMEs"></div>
      <div><label class="fl">Product (optional)</label><select id="jn-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Autopilot</label><label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:8px 0"><input type="checkbox" id="jn-auto"> minimal human touch</label></div>
      <button class="btn btn-primary" id="jn-go">Launch journey</button>
    </div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Journeys in motion — click one to walk its stations</div>
    ${journeys.map((j) => {
      const pct = Math.round((j.doneCount / j.total) * 100);
      return `<a class="journey-row" href="#/journeys/${j.id}">
        <div class="jr-head">
          <span><b>${esc(j.title)}</b> ${j.product_id ? `<span class="chip chip-ember">${esc(j.product_id)}</span>` : ''}</span>
          <span>
            ${j.activeStage ? `<span class="chip" style="color:${DEPT_COLORS[j.activeStage.dept] || 'var(--ink)'}">now: ${esc(j.activeStage.dept)}${j.activeStage.state === 'awaiting_human' ? ' ⏸ needs a human' : ''}</span>` : ''}
            <span class="state state-${j.state === 'done' ? 'done' : j.state === 'awaiting_human' ? 'awaiting_human' : j.state === 'cancelled' ? 'failed' : 'running'}">${esc(j.state)}</span>
          </span>
        </div>
        <div class="jr-track"><div class="jr-fill" style="width:${pct}%"></div></div>
        <div class="map-legend">${j.doneCount}/${j.total} departments crossed · ${pct}% · cost ${money4(j.costUsd)} · started ${esc(j.created_at.slice(0, 16))}</div>
      </a>`;
    }).join('') || '<div class="empty">No journeys yet — launch one above and watch it travel the company.</div>'}
  </div>`;
  $('#jn-go')?.addEventListener('click', async () => {
    try {
      const auto = $('#jn-auto').checked;
      const j = await api('/api/journeys', { method: 'POST', body: { title: $('#jn-title').value, productId: $('#jn-prod').value || null, autopilot: auto } });
      toast(auto ? 'Autopilot journey launched — only the final sign-off is yours' : 'Journey launched — first stop: strategy sign-off'); location.hash = `#/journeys/${j.id}`;
    } catch (e) { toast(e.message, true); }
  });
}

async function renderJourneyDetail(id) {
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

// ---------- Social Media Desk ----------
const PLATFORM_ICONS = { x: '𝕏', linkedin: 'in', instagram: '◎', facebook: 'f', tiktok: '♪', youtube: '▶', telegram: '✈' };

async function renderSocial() {
  const [ov, posts, campaigns] = await Promise.all([
    api('/api/studio'), api('/api/posts'), api('/api/campaigns').catch(() => []),
  ]);
  const canM = hasPermC('social.manage');
  const pb = ov.postsByState || {};
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Channels</div><div class="big">${ov.channels.filter((c) => c.state === 'connected').length}</div><div class="sub">${ov.followers} followers total</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Scheduled</div><div class="big">${pb.scheduled || 0}</div><div class="sub">${pb.draft_ready || 0} drafts awaiting review</div></div>
    <div class="panel tile"><div class="panel-title">Published</div><div class="big">${pb.published || 0}</div><div class="sub">reach ${ov.reach} · humans pressed every button</div></div>
    <div class="panel tile ${pb.drafting ? 'tile-warn' : ''}"><div class="panel-title">Drafting now</div><div class="big">${pb.drafting || 0}</div><div class="sub">AGT-SMM-001 at work → <a href="#/workforce">workforce</a></div></div>
  </div>
  ${canM ? `<div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Connect a channel</div>
      <div class="form-inline">
        <div><label class="fl">Platform</label><select id="ch-platform"><option>x</option><option>linkedin</option><option>instagram</option><option>facebook</option><option>tiktok</option><option>youtube</option><option>telegram</option></select></div>
        <div><label class="fl">Handle</label><input type="text" id="ch-handle" placeholder="@crucible"></div>
        <div style="flex:0.5"><label class="fl">Followers</label><input type="text" id="ch-followers" value="0"></div>
        <button class="btn btn-primary" id="ch-go">Connect</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">New post — the SMM agent drafts, you publish</div>
      <div class="form-inline">
        <div><label class="fl">Channel</label><select id="po-channel"><option value="">any</option>${ov.channels.map((c) => `<option value="${c.id}">${esc(c.platform)} @${esc(c.handle)}</option>`).join('')}</select></div>
        <div><label class="fl">Kind</label><select id="po-kind"><option>post</option><option>thread</option><option>reel-script</option><option>story</option></select></div>
        <div><label class="fl">Campaign</label><select id="po-camp"><option value="">—</option>${campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="po-go">Draft it</button>
      </div>
      <div><label class="fl">Brief</label><textarea id="po-brief" placeholder="What should this post say / achieve?"></textarea></div>
    </div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Channel register</div>
    <div class="agent-meta">${ov.channels.map((c) => `
      <span class="chip ${c.state === 'connected' ? 'chip-ok' : 'chip-dim'}" title="${c.posts} posts · ${c.published} published">
        ${PLATFORM_ICONS[c.platform] || '●'} ${esc(c.platform)} @${esc(c.handle)} · ${c.followers}
        ${canM && c.state === 'connected' ? `<a href="#" data-ch-pause="${c.id}" style="color:var(--warn);margin-left:4px" title="pause">⏸</a>` : ''}
        ${canM && c.state !== 'connected' ? `<a href="#" data-ch-resume="${c.id}" style="color:var(--ok);margin-left:4px" title="reconnect">▶</a>` : ''}
      </span>`).join('') || '<span class="empty">No channels connected yet.</span>'}
    </div>
  </div>
  ${ov.upcoming.length ? `<div class="panel">
    <div class="panel-title">Publishing calendar — next up</div>
    ${ov.upcoming.map((p) => `<div class="round"><div class="round-body" style="display:flex;justify-content:space-between;gap:10px">
      <span><span class="chip chip-steel">${esc(p.platform || 'any')}</span> ${esc(short(p.draft || p.brief, 90))}</span>
      <span class="mono" style="color:var(--warn)">${esc(p.schedule_at || '')}</span>
    </div></div>`).join('')}
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Posts</div>
    ${posts.map((p) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span>
            <span class="chip chip-steel">${esc(p.channel ? `${p.channel.platform} @${p.channel.handle}` : 'any channel')}</span>
            <span class="chip chip-dim">${esc(p.kind)}</span>
            ${p.campaign_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/marketing">campaign #${p.campaign_id}</a>` : ''}
            <span class="state state-${p.state === 'published' ? 'done' : p.state === 'scheduled' ? 'running' : p.state === 'draft_ready' ? 'awaiting_human' : p.state === 'cancelled' ? 'failed' : 'queued'}">${esc(p.state)}</span>
          </span>
          <span>${canM && ['draft_ready', 'scheduled'].includes(p.state) ? `
            <button class="btn btn-sm" data-po-sched="${p.id}">Schedule</button>
            <button class="btn btn-sm btn-ok" data-po-pub="${p.id}">Publish (as ${esc(currentUser?.username || 'me')})</button>
            <button class="btn btn-sm btn-bad" data-po-cancel="${p.id}">✕</button>` : ''}</span>
        </div>
        <div style="font-size:12.5px;margin:6px 0">${esc(p.draft || `(drafting…) ${short(p.brief, 80)}`)}</div>
        <div class="map-legend">
          ${(p.hashtags || []).map((h) => `<span class="chip chip-dim">${esc(h)}</span>`).join(' ')}
          ${p.best_time ? ` · best time: ${esc(p.best_time)}` : ''}
          ${p.state === 'published' ? ` · published by <b>${esc(p.published_by || '')}</b> ${esc((p.published_at || '').slice(0, 16))} · ♥ ${p.metrics.likes} ↺ ${p.metrics.shares} reach ${p.metrics.reach}${canM ? ` · <a href="#" data-po-metrics="${p.id}">update metrics</a>` : ''}` : ''}
        </div>
      </div></div>`).join('') || '<div class="empty">No posts yet — brief the SMM agent above.</div>'}
  </div>`;
  if (!canM) return;
  $('#ch-go')?.addEventListener('click', async () => {
    try { await api('/api/channels', { method: 'POST', body: { platform: $('#ch-platform').value, handle: $('#ch-handle').value, followers: Number($('#ch-followers').value) || 0 } }); toast('Channel connected'); renderSocial(); }
    catch (e) { toast(e.message, true); }
  });
  $('#po-go')?.addEventListener('click', async () => {
    try {
      await api('/api/posts', { method: 'POST', body: { channelId: $('#po-channel').value ? Number($('#po-channel').value) : null, kind: $('#po-kind').value, campaignId: $('#po-camp').value ? Number($('#po-camp').value) : null, brief: $('#po-brief').value } });
      toast('SMM agent is drafting — the post appears below'); renderSocial();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ch-pause]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await api(`/api/channels/${b.dataset.chPause}/update`, { method: 'POST', body: { state: 'paused' } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-ch-resume]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await api(`/api/channels/${b.dataset.chResume}/update`, { method: 'POST', body: { state: 'connected' } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll('[data-po-sched]').forEach((b) => b.addEventListener('click', async () => {
    const when = prompt('Schedule for (YYYY-MM-DD HH:MM):');
    if (!when) return;
    try { await api(`/api/posts/${b.dataset.poSched}/schedule`, { method: 'POST', body: { scheduleAt: when } }); toast('Scheduled'); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-pub]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/posts/${b.dataset.poPub}/publish`, { method: 'POST', body: {} }); toast(`Published — on the record as ${actor()}`); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/posts/${b.dataset.poCancel}/cancel`, { method: 'POST', body: {} }); renderSocial(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-po-metrics]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const likes = prompt('Likes:'); const shares = prompt('Shares:'); const reach = prompt('Reach:');
    try { await api(`/api/posts/${b.dataset.poMetrics}/metrics`, { method: 'POST', body: { likes: likes || null, shares: shares || null, reach: reach || null } }); renderSocial(); } catch (err) { toast(err.message, true); }
  }));
}

// ---------- Content Studio ----------
async function renderContent() {
  const items = await api('/api/content');
  const canM = hasPermC('content.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Brief the Content Creator — articles, scripts, emails, landing copy</div>
    <div class="form-inline">
      <div><label class="fl">Kind</label><select id="ct-kind"><option>article</option><option>blog</option><option>video-script</option><option>email</option><option>landing</option><option>doc</option></select></div>
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="ct-title"></div>
      <button class="btn btn-primary" id="ct-go">Draft it</button>
    </div>
    <div><label class="fl">Brief</label><textarea id="ct-brief" placeholder="Audience, angle, key points, call to action…"></textarea></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Content pipeline — AI drafts · human approves · human publishes</div>
    ${items.map((c) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><span class="chip chip-dim">${esc(c.kind)}</span> <b>${esc(c.title)}</b>
            <span class="state state-${c.state === 'published' ? 'done' : c.state === 'draft_ready' ? 'awaiting_human' : c.state === 'approved' ? 'running' : c.state === 'cancelled' ? 'failed' : 'queued'}">${esc(c.state)}</span></span>
          <span>${canM && c.state === 'draft_ready' ? `
            <button class="btn btn-sm btn-ok" data-ct-v="${c.id}" data-to="approved">Approve</button>
            <button class="btn btn-sm btn-bad" data-ct-v="${c.id}" data-to="cancelled">Reject</button>` : ''}
            ${canM && c.state === 'approved' ? `<button class="btn btn-sm btn-ok" data-ct-v="${c.id}" data-to="published">Publish (as ${esc(currentUser?.username || 'me')})</button>` : ''}</span>
        </div>
        ${c.draft ? `<div style="font-size:12.5px;margin:6px 0;white-space:pre-wrap">${esc(short(c.draft, 600))}</div>` : `<div class="map-legend">drafting… brief: ${esc(short(c.brief, 100))}</div>`}
        <div class="map-legend">
          ${(c.seo || []).map((k) => `<span class="chip chip-dim">${esc(k)}</span>`).join(' ')}
          ${c.product_id ? ` · <a href="#/products">product ${esc(c.product_id)}</a>` : ''}
          ${c.approved_by ? ` · approved by <b>${esc(c.approved_by)}</b>` : ''}
        </div>
      </div></div>`).join('') || '<div class="empty">Nothing in the studio yet.</div>'}
  </div>`;
  if (!canM) return;
  $('#ct-go')?.addEventListener('click', async () => {
    try { await api('/api/content', { method: 'POST', body: { kind: $('#ct-kind').value, title: $('#ct-title').value, brief: $('#ct-brief').value } }); toast('Content agent is writing'); renderContent(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ct-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/content/${b.dataset.ctV}/verdict`, { method: 'POST', body: { verdict: b.dataset.to } }); toast(`Content ${b.dataset.to}`); renderContent(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Design Studio ----------
async function renderDesign() {
  const designs = await api('/api/designs');
  const canM = hasPermC('design.manage');
  const svgSrc = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">Brief the Designer — logos, banners, UI mockups, brand assets: designs for everything, delivered as real SVG files</div>
    <div class="form-inline">
      <div><label class="fl">Kind</label><select id="ds-kind"><option>social-visual</option><option>logo</option><option>banner</option><option>ui</option><option>brand</option><option>diagram</option></select></div>
      <div style="flex:2"><label class="fl">Title</label><input type="text" id="ds-title"></div>
      <button class="btn btn-primary" id="ds-go">Design it</button>
    </div>
    <div><label class="fl">Brief</label><textarea id="ds-brief" placeholder="Purpose, mood, colors, text to include, dimensions…"></textarea></div>
  </div>` : ''}
  <div class="grid grid-3">
    ${designs.map((d) => `
    <div class="panel agent-card">
      <div class="agent-head">
        <span><span class="chip chip-dim">${esc(d.kind)}</span> <b>${esc(short(d.title, 30))}</b></span>
        <span class="state state-${d.state === 'approved' ? 'done' : d.state === 'draft_ready' ? 'awaiting_human' : d.state === 'cancelled' ? 'failed' : 'queued'}">${esc(d.state)}</span>
      </div>
      ${d.svg ? `<img class="design-thumb" alt="${esc(d.title)}" src="${svgSrc(d.svg)}">` : '<div class="empty" style="padding:30px 0">designing…</div>'}
      ${d.spec ? `<div class="map-legend" style="margin-top:6px">${esc(short(d.spec, 120))}</div>` : ''}
      <div class="map-legend" style="margin-top:6px">
        ${d.file_ref ? `<a href="#/artifacts/${encodeURIComponent(d.file_ref)}">📁 ${esc(d.file_ref)}</a> · ` : ''}
        ${d.approved_by ? `approved by <b>${esc(d.approved_by)}</b>` : ''}
        ${canM && d.state === 'draft_ready' ? `<button class="btn btn-sm btn-ok" data-ds-ok="${d.id}" style="margin-top:6px">Approve</button>` : ''}
      </div>
    </div>`).join('') || '<div class="empty">No designs yet — brief the Designer above.</div>'}
  </div>`;
  if (!canM) return;
  $('#ds-go')?.addEventListener('click', async () => {
    try { await api('/api/designs', { method: 'POST', body: { kind: $('#ds-kind').value, title: $('#ds-title').value, brief: $('#ds-brief').value } }); toast('Designer is working — the SVG lands below and on disk'); renderDesign(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-ds-ok]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/designs/${b.dataset.dsOk}/approve`, { method: 'POST', body: {} }); toast('Design approved & archived'); renderDesign(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Sales — deals pipeline ----------
async function renderSales() {
  const [ov, products, partners] = await Promise.all([
    api('/api/deals'), api('/api/products').catch(() => []), api('/api/partners').catch(() => []),
  ]);
  const canM = hasPermC('sales.manage');
  const stChip = (s2) => `<span class="state state-${s2 === 'won' ? 'done' : s2 === 'lost' ? 'failed' : s2 === 'proposal' ? 'awaiting_human' : s2 === 'qualified' ? 'running' : 'queued'}">${esc(s2)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Open pipeline</div><div class="big">${esc(money(ov.openValue))}</div><div class="sub">${ov.pipeline.lead.n + ov.pipeline.qualified.n + ov.pipeline.proposal.n} deals in motion</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Won</div><div class="big">${esc(money(ov.wonValue))}</div><div class="sub">${ov.pipeline.won.n} deals → <a href="#/customers">customers</a> (auto)</div></div>
    <div class="panel tile"><div class="panel-title">At proposal</div><div class="big">${ov.pipeline.proposal.n}</div><div class="sub">${esc(money(ov.pipeline.proposal.value))} — AI drafts, you send</div></div>
    <div class="panel tile ${ov.pipeline.lost.n ? 'tile-warn' : ''}"><div class="panel-title">Lost</div><div class="big">${ov.pipeline.lost.n}</div><div class="sub">reasons live in the notes</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">New deal — reaching “proposal” auto-briefs the Sales agent; winning auto-creates the customer</div>
    <div class="form-inline">
      <div style="flex:1.8"><label class="fl">Deal name</label><input type="text" id="dl-name" placeholder="e.g. Basra Oil Co — pilot"></div>
      <div style="flex:0.6"><label class="fl">Value $/yr</label><input type="text" id="dl-value" value="0"></div>
      <div><label class="fl">Product</label><select id="dl-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Partner</label><select id="dl-partner"><option value="">—</option>${partners.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="dl-go">Open deal</button>
    </div>
    <div><label class="fl">Notes</label><input type="text" id="dl-notes" placeholder="who, why now, what they need"></div>
  </div>` : ''}
  <div class="panel">
    <div class="panel-title">Pipeline — lead → qualified → proposal → won/lost</div>
    <table>
      <thead><tr><th>Deal</th><th class="num">Value</th><th>Stage</th><th>Links</th><th>Owner</th><th>Move</th></tr></thead>
      <tbody>${ov.deals.map((d) => `
        <tr style="${d.stage === 'lost' ? 'opacity:.45' : ''}">
          <td><b>${esc(d.name)}</b>${d.notes ? `<div class="map-legend">${esc(short(d.notes, 60))}</div>` : ''}
            ${d.proposal ? `<div class="round" style="margin-top:6px"><div class="round-body">
              <div class="map-legend" style="color:var(--ember)">AI proposal draft — you send and sign:</div>
              <div style="font-size:12px">${esc(short(d.proposal, 240))}</div></div></div>` : d.draft_run_id ? '<div class="map-legend">proposal drafting…</div>' : ''}</td>
          <td class="num">${esc(money(d.value_usd))}</td>
          <td>${stChip(d.stage)}</td>
          <td>${d.customer ? `<a class="chip chip-ok" style="text-decoration:none" href="#/customers">👤 ${esc(d.customer.name)}</a>` : ''}
              ${d.partner ? `<a class="chip chip-steel" style="text-decoration:none" href="#/relations">🤝 ${esc(d.partner.name)}</a>` : ''}
              ${d.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(d.product_id)}</a>` : ''}</td>
          <td class="mono">${esc(d.owner)}</td>
          <td>${connBtn('deal', d.id)}
            ${canM ? `${['lead', 'qualified', 'proposal', 'won', 'lost'].filter((s2) => s2 !== d.stage && !['won', 'lost'].includes(d.stage)).map((s2) => `<button class="btn btn-sm ${s2 === 'won' ? 'btn-ok' : s2 === 'lost' ? 'btn-bad' : ''}" data-dl="${d.id}" data-to="${s2}">${s2}</button>`).join(' ')}
            ${!d.proposal && !d.draft_run_id && !['won', 'lost'].includes(d.stage) ? `<button class="btn btn-sm" data-dl-prop="${d.id}">AI proposal</button>` : ''}` : ''}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty">No deals yet${canM ? ' — open the first one above' : ''}.</td></tr>`}
      </tbody>
    </table>
  </div>`;
  wireConnections();
  if (!canM) return;
  $('#dl-go')?.addEventListener('click', async () => {
    try {
      await api('/api/deals', { method: 'POST', body: { name: $('#dl-name').value, valueUsd: Number($('#dl-value').value) || 0, productId: $('#dl-prod').value || null, partnerId: $('#dl-partner').value ? Number($('#dl-partner').value) : null, notes: $('#dl-notes').value || null } });
      toast('Deal opened'); renderSales();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/deals/${b.dataset.dl}/stage`, { method: 'POST', body: { stage: b.dataset.to } }); toast(`Deal → ${b.dataset.to}`); renderSales(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-dl-prop]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/deals/${b.dataset.dlProp}/proposal`, { method: 'POST', body: {} }); toast('Sales agent drafting the proposal'); renderSales(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Autopilot — the Nexus ----------
async function renderAutopilot() {
  const { rules, feed } = await api('/api/autopilot');
  const canM = hasPermC('autopilot.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Rules armed</div><div class="big">${rules.filter((r) => r.enabled).length}<span class="unit">/${rules.length}</span></div><div class="sub">departments creating work for each other</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Automatic actions</div><div class="big">${feed.length ? rules.reduce((a, r) => a + r.runs, 0) : 0}</div><div class="sub">zero human keystrokes involved</div></div>
    <div class="panel tile"><div class="panel-title">What stays human</div><div class="big" style="font-size:20px;line-height:1.5">publish · sign · gate</div><div class="sub">the load-bearing moments — everything else self-drives</div></div>
    <div class="panel tile tile-warn"><div class="panel-title">Every firing audited</div><div class="big" style="font-size:20px;line-height:1.5">system:nexus</div><div class="sub">on the <a href="#/audit">chain</a>, rule by rule</div></div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">The mesh — watch A, act in B</div>
      ${rules.map((r) => `
        <div class="round"><div class="round-body">
          <div class="agent-head">
            <span><b class="mono" style="color:var(--ember)">${esc(r.id)}</b> — ${esc(r.name)}</span>
            <span>
              <span class="chip chip-dim">${r.runs}× fired</span>
              ${canM ? `<button class="btn btn-sm ${r.enabled ? 'btn-bad' : 'btn-ok'}" data-ap="${esc(r.id)}" data-en="${r.enabled ? 0 : 1}">${r.enabled ? 'disarm' : 'arm'}</button>` : `<span class="chip ${r.enabled ? 'chip-ok' : 'chip-dim'}">${r.enabled ? 'armed' : 'off'}</span>`}
            </span>
          </div>
          <div class="map-legend">${esc(r.why)}</div>
          ${r.recent.length ? `<div class="map-legend" style="color:var(--ink-mute)">${r.recent.map((x) => `→ ${esc(short(x.note, 70))}`).join('<br>')}</div>` : ''}
        </div></div>`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">Live feed — the company running itself</div>
      ${feed.map((f) => `
        <div class="round"><div class="round-body" style="display:flex;justify-content:space-between;gap:10px">
          <span><span class="chip chip-ember">${esc(f.rule_id)}</span> ${esc(short(f.note, 80))}</span>
          <span class="mono" style="color:var(--ink-faint);flex:none">${esc(f.created_at.slice(5, 16))}</span>
        </div></div>`).join('') || '<div class="empty">Nothing yet — the rules fire as soon as their conditions appear.</div>'}
    </div>
  </div>`;
  view.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/autopilot/rule', { method: 'POST', body: { id: b.dataset.ap, enabled: b.dataset.en === '1' } }); renderAutopilot(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Company Scorecard (BI) ----------
async function renderScorecard() {
  const s = await api('/api/scorecard');
  const pct = (n) => n != null ? Math.round(n * 100) + '%' : '—';
  const auto = s.autopilot.humanActions7d + s.autopilot.agentActions7d;
  const autoShare = auto ? Math.round((s.autopilot.agentActions7d / auto) * 100) : 0;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR</div><div class="big">${esc(money(s.revenue.mrr))}</div><div class="sub">${s.revenue.customersActive} active customers</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Sales pipeline</div><div class="big">${esc(money(s.revenue.pipelineValue))}</div><div class="sub">${s.revenue.dealsOpen} open · ${esc(money(s.revenue.wonValue))} won</div></div>
    <div class="panel tile tile-warn"><div class="panel-title">AI share of work · 7d</div><div class="big">${autoShare}<span class="unit">%</span></div><div class="sub">${s.autopilot.agentActions7d} agent vs ${s.autopilot.humanActions7d} human actions</div></div>
    <div class="panel tile"><div class="panel-title">Autopilot actions</div><div class="big">${s.autopilot.actionsTotal}</div><div class="sub">${s.autopilot.actions7d} this week · <a href="#/autopilot">the mesh →</a></div></div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Creative output</div>
      <table><tbody>
        <tr><td>Posts published</td><td class="num">${s.creative.postsPublished}</td><td><a href="#/social">social →</a></td></tr>
        <tr><td>Followers (connected channels)</td><td class="num">${s.creative.followers}</td><td></td></tr>
        <tr><td>Content published</td><td class="num">${s.creative.contentPublished}</td><td><a href="#/content">studio →</a></td></tr>
        <tr><td>Designs approved</td><td class="num">${s.creative.designsApproved}</td><td><a href="#/design">gallery →</a></td></tr>
        <tr><td>Campaigns live</td><td class="num">${s.creative.campaignsLive}</td><td><a href="#/marketing">marketing →</a></td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Production</div>
      <table><tbody>
        <tr><td>Journeys completed / moving</td><td class="num">${s.production.journeysDone} / ${s.production.journeysMoving}</td><td><a href="#/journeys">journeys →</a></td></tr>
        <tr><td>Runs done · 7d</td><td class="num">${s.production.runsDone7d}</td><td><a href="#/runs">runs →</a></td></tr>
        <tr><td>Tasks done · 7d</td><td class="num">${s.production.tasksDone7d}</td><td><a href="#/tasks">tasks →</a></td></tr>
        <tr><td>Products live</td><td class="num">${s.production.productsLive}</td><td><a href="#/products">factory →</a></td></tr>
        <tr><td>Model spend · month</td><td class="num">${esc(money(s.spendMonth))}</td><td><a href="#/budgets">budgets →</a></td></tr>
      </tbody></table>
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Trust & control</div>
      <table><tbody>
        <tr><td>Open incidents</td><td class="num" style="color:${s.trust.incidentsOpen ? 'var(--bad)' : 'var(--ok)'}">${s.trust.incidentsOpen}</td><td><a href="#/incidents">incidents →</a></td></tr>
        <tr><td>Critical risks (≥16)</td><td class="num" style="color:${s.trust.risksCritical ? 'var(--warn)' : 'var(--ok)'}">${s.trust.risksCritical}</td><td><a href="#/risks">register →</a></td></tr>
        <tr><td>Eval average</td><td class="num">${pct(s.trust.evalAvg)}</td><td><a href="#/evals">evals →</a></td></tr>
        <tr><td>Waiting on a human</td><td class="num" style="color:${s.trust.awaitingHuman ? 'var(--warn)' : 'var(--ok)'}">${s.trust.awaitingHuman}</td><td><a href="#/gate">gate →</a></td></tr>
        <tr><td>Audit chain entries</td><td class="num">${s.trust.chainEntries}</td><td><a href="#/audit">chain →</a></td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Relationships</div>
      <table><tbody>
        <tr><td>Active partners</td><td class="num">${s.relations.partnersActive}</td><td><a href="#/relations">RM →</a></td></tr>
        <tr><td>Interactions · 30d</td><td class="num">${s.relations.interactions30d}</td><td></td></tr>
      </tbody></table>
      <div class="map-legend" style="margin-top:10px">The whole company on one board — every number clicks through to its department, every department feeds the <a href="#/audit">audit chain</a>, and the <a href="#/autopilot">Nexus</a> moves work between them without a human in the loop.</div>
    </div>
  </div>`;
}

// ---------- System Design studio ----------
async function renderSystems() {
  const [blueprints, catalog, products] = await Promise.all([
    api('/api/design'), api('/api/design/catalog'), api('/api/products').catch(() => []),
  ]);
  const canM = hasPermC('design.manage');
  view.innerHTML = `
  ${canM ? `<div class="panel">
    <div class="panel-title">New design package — one sentence in, a complete specification out</div>
    <div class="form-inline">
      <div style="flex:1.4"><label class="fl">System name</label><input type="text" id="bp-name" placeholder="Invoice OCR platform"></div>
      <div><label class="fl">Product</label><select id="bp-prod"><option value="">—</option>${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="bp-go">Generate package</button>
    </div>
    <div><label class="fl">Goal — what must this system do, for whom?</label><textarea id="bp-goal" placeholder="A web app that lets Iraqi SMEs photograph supplier invoices and get structured accounting entries, with Arabic OCR and export to their accountant."></textarea></div>
    <div class="form-inline">
      <div><label class="fl">Audience / users</label><input type="text" id="bp-audience" placeholder="SME owners, accountants"></div>
      <div><label class="fl">Scale</label><input type="text" id="bp-scale" placeholder="5,000 users, 50 req/s peak"></div>
      <div><label class="fl">Budget</label><input type="text" id="bp-budget" placeholder="$500/mo infra"></div>
      <div><label class="fl">Stack preference</label><input type="text" id="bp-stack" placeholder="any / Node + Postgres"></div>
      <div><label class="fl">Compliance</label><input type="text" id="bp-comp" placeholder="Iraqi data residency"></div>
      <div><label class="fl">Language</label><select id="bp-lang"><option value="English">English</option><option value="Arabic">العربية</option><option value="Arabic and English">both</option></select></div>
    </div>
    <div class="panel-title" style="margin-top:12px">Documents to produce — ${catalog.length} available, all selected by default</div>
    <div class="rule-grid">
      ${catalog.map((d) => `<label class="rule-card">
        <input type="checkbox" class="bp-doc" value="${esc(d.key)}" checked>
        <span><b>${esc(d.title)}</b><span class="rule-detail">${esc(short(d.brief, 130))}</span>
        <span class="rule-detail" style="color:var(--ink-faint)">writer: ${esc(d.agent)}${d.needs.length ? ` · needs: ${d.needs.join(', ')}` : ''}</span></span>
      </label>`).join('')}
    </div>
    <div class="map-legend">Documents are written in dependency order, each one seeing the approved output of the ones it depends on — so the architecture cannot contradict the requirements. The final document is a <b>build brief you can hand to any AI coding agent</b> to produce the whole application.</div>
  </div>` : ''}
  ${blueprints.map((b) => {
    const pct = Math.round((b.progress.done / Math.max(1, b.progress.total)) * 100);
    return `<div class="panel">
      <div class="jr-head">
        <span><b>${esc(b.name)}</b> ${b.product_id ? `<a class="chip chip-ember" style="text-decoration:none" href="#/products">${esc(b.product_id)}</a>` : ''}
          <span class="state state-${b.state === 'ready' ? 'done' : b.state === 'awaiting_human' ? 'awaiting_human' : b.state === 'cancelled' ? 'failed' : 'running'}">${esc(b.state)}</span></span>
        <span>
          <span class="chip">${b.progress.done}/${b.progress.total} docs</span>
          <span class="chip chip-dim">${b.progress.words.toLocaleString()} words · ${money4(b.progress.costUsd)}</span>
          ${b.progress.done ? `<button class="btn btn-sm" data-download="/api/design/${b.id}/bundle" data-filename="design-package-${b.id}.md">⬇ Full package</button>
          <button class="btn btn-sm btn-ok" data-download="/api/design/${b.id}/build-brief" data-filename="BUILD-BRIEF-${b.id}.md" title="paste this into an AI coding agent">⬇ Build brief</button>` : ''}
          ${connBtn('blueprint', b.id)}
          ${canM && !['ready', 'cancelled'].includes(b.state) ? `<button class="btn btn-sm btn-bad" data-bpcancel="${b.id}">✕</button>` : ''}
        </span>
      </div>
      <div class="map-legend">${esc(short(b.goal, 200))}</div>
      <div class="jr-track" style="margin:8px 0"><div class="jr-fill" style="width:${pct}%"></div></div>
      <div class="doc-grid">
        ${b.docs.map((d) => `<a class="doc-chip ${d.state}" href="#/systems/${b.id}/${esc(d.doc_key)}" title="${esc(d.title)}">
          <span class="dc-seq">${d.seq}</span><span class="dc-title">${esc(short(d.title, 30))}</span>
          <span class="dc-state">${d.state === 'done' ? '✓' : d.state === 'writing' ? '✎' : d.state === 'awaiting_human' ? '⏸' : '·'}</span>
        </a>`).join('')}
      </div>
      ${b.progress.blocked ? `<div class="reason">${b.progress.blocked} document(s) need you — open them to retry or approve.</div>` : ''}
    </div>`;
  }).join('') || '<div class="panel"><div class="empty">No design packages yet — describe a system above and the studio writes the whole specification.</div></div>'}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#bp-go')?.addEventListener('click', async () => {
    const docKeys = [...view.querySelectorAll('.bp-doc:checked')].map((c) => c.value);
    try {
      const b = await api('/api/design', { method: 'POST', body: {
        name: $('#bp-name').value, goal: $('#bp-goal').value, docKeys,
        productId: $('#bp-prod').value || null,
        context: { audience: $('#bp-audience').value, scale: $('#bp-scale').value, budget: $('#bp-budget').value, stack: $('#bp-stack').value, compliance: $('#bp-comp').value, language: $('#bp-lang').value },
      } });
      toast(`Package started — ${b.progress.total} documents queued`); renderSystems();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-bpcancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Cancel this design package?')) return;
    try { await api(`/api/design/${b.dataset.bpcancel}/cancel`, { method: 'POST', body: {} }); renderSystems(); } catch (e) { toast(e.message, true); }
  }));
}

async function renderDesignDoc(arg) {
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

// ---------- Infrastructure ----------
async function renderInfra() {
  const [{ overview, plans }, sections, blueprints] = await Promise.all([
    api('/api/infra'), api('/api/infra/sections'), api('/api/design').catch(() => []),
  ]);
  const canM = hasPermC('infra.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Plans</div><div class="big">${overview.total}</div><div class="sub">${overview.ready} ready · ${overview.drafting} drafting</div></div>
    <div class="panel tile tile-steel"><div class="panel-title">Estimated infra cost</div><div class="big">${esc(money(overview.estimatedMonthlyUsd))}</div><div class="sub">per month, across ready plans</div></div>
    <div class="panel tile"><div class="panel-title">Sections</div><div class="big">${sections.length}</div><div class="sub">full plan or one layer at a time</div></div>
    <div class="panel tile"><div class="panel-title">Linked designs</div><div class="big">${plans.filter((p) => p.blueprint_id).length}</div><div class="sub">sized against a real architecture</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">Plan the infrastructure — sized from the load you state, with the arithmetic shown</div>
    <div class="form-inline">
      <div style="flex:1.4"><label class="fl">Name</label><input type="text" id="if-name" placeholder="Invoice OCR — production"></div>
      <div><label class="fl">Section</label><select id="if-section">${sections.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></div>
      <div><label class="fl">From design</label><select id="if-bp"><option value="">—</option>${blueprints.map((b) => `<option value="${b.id}">${esc(short(b.name, 26))}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="if-go">Design it</button>
    </div>
    <div class="form-inline">
      <div><label class="fl">Users</label><input type="text" id="if-users" placeholder="5000"></div>
      <div><label class="fl">Peak req/sec</label><input type="text" id="if-rps" placeholder="50"></div>
      <div><label class="fl">Data (GB)</label><input type="text" id="if-data" placeholder="200"></div>
      <div><label class="fl">Budget $/mo</label><input type="text" id="if-budget" placeholder="500"></div>
      <div><label class="fl">Cloud</label><input type="text" id="if-cloud" placeholder="AWS / Hetzner / any"></div>
      <div><label class="fl">Regions</label><input type="text" id="if-regions" placeholder="eu-central, me-south"></div>
      <div><label class="fl">Availability</label><input type="text" id="if-avail" placeholder="99.9%"></div>
      <div><label class="fl">Compliance</label><input type="text" id="if-comp" placeholder="GDPR"></div>
    </div>
  </div>` : ''}
  ${plans.map((p) => `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(p.name)}</b> <span class="chip chip-steel">${esc(p.section)}</span>
        ${p.blueprint ? `<a class="chip chip-ember" style="text-decoration:none" href="#/design">${esc(short(p.blueprint.name, 24))}</a>` : ''}
        <span class="state state-${p.state === 'ready' ? 'done' : p.state === 'failed' ? 'failed' : 'running'}">${esc(p.state)}</span></span>
      <span>
        ${p.costTable.length ? `<span class="chip">${esc(money(p.costTable.reduce((a, c) => a + (Number(c.monthlyUsd) || 0), 0)))}/mo</span>` : ''}
        ${p.content ? `<button class="btn btn-sm" data-download="/api/infra/${p.id}/export" data-filename="infra-${p.id}.md">⬇ Markdown</button>` : ''}
        ${connBtn('infraPlan', p.id)}
      </span>
    </div>
    <div class="map-legend">${Object.entries(p.spec).filter(([, v]) => v).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ') || 'no load stated'}</div>
    ${p.costTable.length ? `<table style="margin-top:8px"><thead><tr><th>Line item</th><th class="num">Monthly</th></tr></thead><tbody>
      ${p.costTable.map((c) => `<tr><td>${esc(c.item)}</td><td class="num">${esc(money(c.monthlyUsd))}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${p.content ? `<details style="margin-top:8px"><summary class="map-legend" style="cursor:pointer">read the plan</summary><pre class="json" style="max-height:60vh;white-space:pre-wrap">${esc(p.content)}</pre></details>`
      : `<div class="empty">${p.state === 'drafting' ? 'The infrastructure agent is working…' : 'No content.'}</div>`}
  </div>`).join('')}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#if-go')?.addEventListener('click', async () => {
    try {
      await api('/api/infra', { method: 'POST', body: {
        name: $('#if-name').value, section: $('#if-section').value,
        blueprintId: $('#if-bp').value ? Number($('#if-bp').value) : null,
        spec: { users: $('#if-users').value, rps: $('#if-rps').value, dataGb: $('#if-data').value, budgetUsd: $('#if-budget').value, cloud: $('#if-cloud').value, regions: $('#if-regions').value, availability: $('#if-avail').value, compliance: $('#if-comp').value },
      } });
      toast('Infrastructure agent is designing'); renderInfra();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- Financial Reports ----------
async function renderFinReports() {
  const [{ overview, reports }, ledger] = await Promise.all([
    api('/api/finreports'), api('/api/finreports/ledger').catch(() => null),
  ]);
  const canM = hasPermC('finreports.manage');
  const l = overview.live;
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">MRR / ARR</div><div class="big">${esc(money(l.mrrUsd))}</div><div class="sub">${esc(money(l.arrUsd))} annualised</div></div>
    <div class="panel tile ${l.netUsd < 0 ? 'tile-warn' : 'tile-steel'}"><div class="panel-title">Net this month</div><div class="big">${esc(money(l.netUsd))}</div><div class="sub">${esc(money(l.monthlyCostUsd))} total cost</div></div>
    <div class="panel tile"><div class="panel-title">Pipeline</div><div class="big">${esc(money(l.pipelineUsd))}</div><div class="sub">open deals · <a href="#/sales">sales →</a></div></div>
    <div class="panel tile"><div class="panel-title">Reports</div><div class="big">${overview.ready}<span class="unit">/${overview.total}</span></div><div class="sub">${overview.drafting} in preparation</div></div>
  </div>
  ${canM ? `<div class="panel">
    <div class="panel-title">Prepare a financial document — internal ones are built on the live ledger, not on guesses</div>
    <div class="form-inline">
      <div style="flex:1.6"><label class="fl">Document</label><select id="fr-kind">${overview.kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}${k.internal ? '' : ' — external company'}</option>`).join('')}</select></div>
      <div><label class="fl">Period</label><input type="text" id="fr-period" placeholder="${new Date().toISOString().slice(0, 7)}"></div>
      <div style="flex:1.2"><label class="fl">Company (research only)</label><input type="text" id="fr-subject" placeholder="e.g. Basra Oil Company"></div>
      <button class="btn btn-primary" id="fr-go">Prepare</button>
    </div>
    <div class="map-legend">Internal statements are fed the platform's real ledgers — model spend by provider and agent, customer MRR, vendor burn, campaign spend, deal pipeline — so the analyst reports the actual numbers. External research is training knowledge and every figure is labelled <b>[Unverified]</b> with its period.</div>
  </div>` : ''}
  ${ledger ? `<div class="panel">
    <div class="panel-title">Live ledger — ${esc(ledger.period)} · this is what internal reports are built from</div>
    <div class="grid grid-2">
      <table><tbody>
        <tr><td>Recurring revenue (MRR)</td><td class="num">${esc(money(ledger.revenue.mrrUsd))}</td></tr>
        <tr><td>Deals won (all time)</td><td class="num">${esc(money(ledger.revenue.dealsWonUsd))}</td></tr>
        <tr><td>Open pipeline</td><td class="num">${esc(money(ledger.revenue.pipelineUsd))}</td></tr>
        <tr><td>Model spend this month</td><td class="num">${esc(money(ledger.costs.modelSpendUsd))}</td></tr>
        <tr><td>Vendor burn</td><td class="num">${esc(money(ledger.costs.vendorBurnUsd))}</td></tr>
        <tr><td>Marketing spent</td><td class="num">${esc(money(ledger.costs.marketingSpentUsd))}</td></tr>
        <tr><td><b>Net</b></td><td class="num"><b>${esc(money(ledger.net.grossUsd))}</b></td></tr>
      </tbody></table>
      <table><thead><tr><th>Provider</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead><tbody>
        ${ledger.costs.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num">${p.calls}</td><td class="num">${esc(money4(p.cost))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No model calls yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>` : ''}
  ${reports.map((r) => `
  <div class="panel">
    <div class="jr-head">
      <span><b>${esc(r.title)}</b> <span class="chip chip-dim">${esc(r.kind)}</span>
        ${r.subject !== 'own' ? `<span class="chip chip-warn">external · unverified</span>` : '<span class="chip chip-ok">from live ledger</span>'}
        <span class="state state-${['ready', 'approved'].includes(r.state) ? 'done' : r.state === 'failed' ? 'failed' : 'running'}">${esc(r.state)}</span></span>
      <span>
        ${r.content ? `<button class="btn btn-sm" data-download="/api/finreports/${r.id}/export" data-filename="${esc(r.kind)}-${esc(r.period)}.md">⬇ Markdown</button>` : ''}
        ${canM && r.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-frapprove="${r.id}">Approve</button>` : ''}
        ${connBtn('finReport', r.id)}
      </span>
    </div>
    <div class="map-legend">period ${esc(r.period || '—')}${r.approved_by ? ` · approved by ${esc(r.approved_by)}` : ''}${r.hasInputs ? ' · built on real figures' : ''}</div>
    ${(r.flags || []).length ? `<div class="reason">⚑ ${r.flags.map(esc).join(' · ')}</div>` : ''}
    ${r.content ? `<details style="margin-top:8px"><summary class="map-legend" style="cursor:pointer">read the report</summary><pre class="json" style="max-height:60vh;white-space:pre-wrap">${esc(r.content)}</pre></details>`
      : `<div class="empty">${r.state === 'drafting' ? 'The financial analyst is preparing this…' : 'No content.'}</div>`}
  </div>`).join('')}`;
  wireConnections();
  wireDownloads();
  if (!canM) return;
  $('#fr-go')?.addEventListener('click', async () => {
    try {
      await api('/api/finreports', { method: 'POST', body: { kind: $('#fr-kind').value, period: $('#fr-period').value || null, subject: $('#fr-subject').value || 'own' } });
      toast('Financial analyst is preparing the document'); renderFinReports();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-frapprove]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/finreports/${b.dataset.frapprove}/approve`, { method: 'POST', body: {} }); toast('Approved and archived'); renderFinReports(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ---------- Harmony — the orchestration layer ----------
async function renderHarmony() {
  const [h, auto] = await Promise.all([api('/api/harmony'), api('/api/autonomy').catch(() => null)]);
  const canM = hasPermC('harmony.manage');
  const isOwner = currentUser?.isOwner;
  const s = h.snapshot;
  const hs = h.harmony;
  const scoreColor = hs.score >= 80 ? 'var(--ok)' : hs.score >= 55 ? 'var(--warn)' : 'var(--bad)';
  const latest = h.cycles[0];
  view.innerHTML = `
  ${auto?.enabled ? `
  <div class="panel autonomy-live">
    <div class="panel-title" style="color:var(--bad)">⚠ AUTONOMY MODE IS ON — the AI is deciding for you</div>
    <div style="font-size:12.5px;line-height:1.6">
      Since <b>${esc(String(auto.since || '').slice(0, 16).replace('T', ' '))}</b>, the Acting Executive has been answering the queue that would normally wait for you:
      approving, rejecting, publishing, sending, signing and ruling. <b>${auto.stats.decided}</b> decision(s) made, <b>${auto.stats.held}</b> held back for you deliberately${auto.stats.failed ? `, <b>${auto.stats.failed}</b> failed to execute` : ''}.
    </div>
    ${isOwner ? '<div style="margin-top:10px"><button class="btn btn-bad" id="au-off">Take back control now</button></div>' : '<div class="map-legend" style="margin-top:8px">Only the owner can switch this off.</div>'}
  </div>` : ''}

  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Harmony score</div><div class="big" style="color:${scoreColor}">${hs.score}<span class="unit">%</span></div><div class="sub">${hs.parts.filter((p) => p.ok).length}/${hs.parts.length} checks passing</div></div>
    <div class="panel tile ${h.enabled ? 'tile-steel' : 'tile-warn'}"><div class="panel-title">Orchestrator</div><div class="big" style="font-size:22px;padding-top:8px">${h.enabled ? 'RUNNING' : 'PAUSED'}</div><div class="sub">${esc(h.mode)} mode · hourly cycles</div></div>
    <div class="panel tile"><div class="panel-title">Actions dispatched</div><div class="big">${h.dispatchedTotal}</div><div class="sub">${h.dispatched7d} this week, no human keystrokes</div></div>
    <div class="panel tile"><div class="panel-title">AI vs human · 7d</div><div class="big">${s.automation.agentActions7d}<span class="unit">/${s.automation.humanActions7d}</span></div><div class="sub">${s.automation.nexusActions7d} reflex actions from <a href="#/autopilot">Nexus</a></div></div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">
        <span>Is the company moving in step?</span>
        ${canM ? `<span>
          <button class="btn btn-sm ${h.enabled ? 'btn-bad' : 'btn-ok'}" id="hm-toggle">${h.enabled ? 'Pause orchestrator' : 'Start orchestrator'}</button>
          <button class="btn btn-sm" id="hm-mode">${h.mode === 'live' ? 'Switch to dry-run' : 'Switch to live'}</button>
          <button class="btn btn-primary btn-sm" id="hm-cycle">Run a cycle now</button>
        </span>` : ''}
      </div>
      ${hs.parts.map((p) => `<div class="harm-part">
        <span class="hp-ok" style="color:${p.ok ? 'var(--ok)' : 'var(--warn)'}">${p.ok ? '✓' : '!'}</span>
        <span>${esc(p.key)}</span>
        <span class="hp-detail">${esc(p.detail)}</span>
      </div>`).join('')}
      ${hs.score < 100 && canM ? `<div style="margin-top:12px">
        <button class="btn btn-primary" id="hm-boost">Raise the score — do everything an agent can</button>
        <div class="map-legend" style="margin-top:6px">This dispatches every fix the workforce is allowed to make on its own, then tells you precisely what is left that only a person can finish. It cannot publish, send, sign or pass a gate — so a perfect score is reached with you, not instead of you.</div>
      </div>` : ''}
      <div id="hm-boost-out"></div>
      <div class="map-legend" style="margin-top:10px">Each check is something that quietly stops work when ignored. The orchestrator reads exactly this state before it plans.</div>
    </div>

    <div class="panel">
      <div class="panel-title">What it is allowed to do — ${h.catalog.length} actions</div>
      <div class="agent-meta">${h.catalog.map((a) => `<span class="chip chip-dim" title="${esc(a.describe)}">${esc(a.id)}</span>`).join('')}</div>
      <div class="map-legend" style="margin-top:10px">
        <b>Not in the catalog, by design:</b> publishing a post, sending a message to a customer or partner, approving spend, signing a contract, and gate verdicts. The planner physically cannot reach those — when one is what the company needs, it must raise <span class="mono">human.flag</span> instead.
      </div>
      <div class="map-legend" style="margin-top:8px">
        Other guardrails: at most 5 actions per cycle, a ${6}-hour cooldown per identical action, a hard stop below 10% budget headroom, and every dispatch on the <a href="#/audit">audit chain</a> as <span class="mono">system:maestro</span>.
      </div>
    </div>
  </div>

  <div class="panel ${auto?.enabled ? 'autonomy-live' : ''}">
    <div class="panel-title">${auto?.enabled ? 'Autonomy is running' : 'Hand the company to the AI'}</div>
    <div class="danger-note">
      <div class="dn-title">Read this before switching it on</div>
      <p>Everything in this platform is built on one rule: <b>a machine prepares, a person decides</b>. This switch suspends that rule. With it on, the Acting Executive answers your queue — it approves work, publishes posts, sends replies to customers, signs contracts, approves campaigns and money reports, and rules on disputes between employees. Nothing waits for you any more.</p>
      <p><b>Agents get things wrong.</b> They misread context, they are confident when they should not be, and they cannot see what you know but never wrote down. Today those mistakes are caught at the gate because you look at them. With autonomy on, the same mistakes are <b>committed instead of caught</b> — a wrong reply is sent, a bad campaign goes live, a contract is signed. That is the entire trade.</p>
      <p>Highest-risk categories it will act on: ${auto ? auto.highStakes.map((x) => `<span class="chip chip-bad">${esc(x)}</span>`).join(' ') : ''}</p>
      <p>What stays true even in autonomy: budgets still hard-stop, the audit chain still records everything as <span class="mono">system:autonomy</span>, every decision is logged <b>with the reason given for it</b> so you can read what happened in your absence, the executive may deliberately <b>hold</b> anything it judges too consequential, and the off switch is immediate and yours alone.</p>
    </div>
    ${isOwner ? `<div style="margin-top:12px">
      ${auto?.enabled
        ? '<button class="btn btn-bad" id="au-toggle-off">Turn autonomy OFF — return decisions to humans</button>'
        : '<button class="btn btn-bad" id="au-toggle-on">Turn autonomy ON — let the AI run the company</button>'}
      <span class="map-legend" style="margin-left:10px">You will be asked to confirm.</span>
    </div>` : '<div class="map-legend" style="margin-top:10px">Only the owner can hand over or take back the company\'s decisions.</div>'}
    ${auto && auto.stats.total ? `<div class="agent-meta" style="margin-top:10px">
      <span class="chip">${auto.stats.total} handled</span>
      <span class="chip chip-ok">${auto.stats.decided} decided</span>
      <span class="chip chip-warn">${auto.stats.held} held for you</span>
      ${auto.stats.failed ? `<span class="chip chip-bad">${auto.stats.failed} failed</span>` : ''}
      ${auto.stats.reverted ? `<span class="chip chip-bad">${auto.stats.reverted} you disagreed with</span>` : ''}
      <span class="chip chip-dim">${auto.stats.last24h} in the last 24h</span>
    </div>` : ''}
  </div>

  ${auto?.log?.length ? `<div class="panel">
    <div class="panel-title">What the AI decided in your place — read it, reverse what you disagree with</div>
    ${auto.log.map((l) => `
      <div class="inbox-row ${l.verdict === 'hold' ? 'low' : l.ok ? '' : 'high'}" style="${l.reverted ? 'opacity:.5' : ''}">
        <div class="ib-main">
          <span class="chip ${l.verdict === 'approve' ? 'chip-ok' : l.verdict === 'reject' ? 'chip-bad' : l.verdict === 'hold' ? 'chip-warn' : 'chip-dim'}">${esc(l.verdict)}</span>
          <span class="ib-title">${esc(l.title)}</span>
          <div class="ib-sub">${esc(l.reason || 'no reason recorded')}</div>
          <div class="map-legend">${esc(l.outcome || 'pending')} · <span class="mono">${esc(l.kind)} #${esc(l.subject_id)}</span>${l.reverted ? ' · <b style="color:var(--bad)">you marked this wrong</b>' : ''}</div>
        </div>
        <div class="ib-age mono">${esc(l.created_at.slice(5, 16))}</div>
        <div class="ib-actions">
          ${linkFor(l.kind, l.subject_id) ? `<a class="btn btn-sm" href="${linkFor(l.kind, l.subject_id)}">Open</a>` : ''}
          ${isOwner && !l.reverted && l.ok && l.verdict !== 'hold' ? `<button class="btn btn-sm btn-bad" data-au-revert="${l.id}">Disagree</button>` : ''}
        </div>
      </div>`).join('')}
  </div>` : ''}

  ${latest ? `<div class="panel">
    <div class="panel-title">
      <span>Latest cycle #${latest.id} — ${esc(latest.state)}${latest.mode === 'dry-run' ? ' · dry-run' : ''}</span>
      <span class="mono" style="color:var(--ink-faint)">${esc(latest.created_at)}</span>
    </div>
    ${latest.assessment ? `<div style="font-size:12.5px;margin-bottom:8px">${esc(latest.assessment)}</div>` : ''}
    ${latest.flags?.length ? `<div class="reason">Needs a human: ${latest.flags.map(esc).join(' · ')}</div>` : ''}
    ${latest.plan?.length ? latest.plan.map((p, i) => {
      const done = (latest.executed || []).find((x) => x.action === p.action && x.why === p.why) || (latest.executed || [])[i];
      return `<div class="plan-step ${done && !done.ok ? 'failed' : ''}">
        <div class="ps-action">${esc(p.action)} <span style="color:var(--ink-faint)">${esc(short(JSON.stringify(p.params || {}), 90))}</span></div>
        <div class="ps-why">${esc(p.why || '')}</div>
        ${done ? `<div class="ps-result">${done.ok ? '✓' : '✕'} ${esc(done.detail || '')}</div>` : '<div class="ps-result">pending</div>'}
      </div>`;
    }).join('') : `<div class="empty">${latest.state === 'planning' ? 'The orchestrator is thinking…' : 'No actions this cycle.'}</div>`}
  </div>` : '<div class="panel"><div class="empty">No cycles yet — run one to see the orchestrator read the company and dispatch work.</div></div>'}

  ${h.cycles.length > 1 ? `<div class="panel">
    <div class="panel-title">Cycle history</div>
    <table>
      <thead><tr><th>#</th><th>When</th><th>Mode</th><th>State</th><th class="num">Planned</th><th class="num">Dispatched</th><th>Assessment</th></tr></thead>
      <tbody>${h.cycles.slice(1).map((c) => `<tr>
        <td class="mono">${c.id}</td>
        <td class="mono" style="color:var(--ink-faint)">${esc(c.created_at.slice(5, 16))}</td>
        <td><span class="chip chip-dim">${esc(c.mode)}</span></td>
        <td><span class="state state-${c.state === 'executed' ? 'done' : c.state === 'failed' ? 'failed' : 'queued'}">${esc(c.state)}</span></td>
        <td class="num">${c.plan?.length || 0}</td>
        <td class="num">${(c.executed || []).filter((x) => x.ok).length}</td>
        <td>${esc(short(c.assessment || '—', 80))}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : ''}`;

  // Autonomy: switching it on takes a typed confirmation, switching it off never does.
  const setAutonomy = async (on) => {
    if (on && !confirm(
      'Hand every decision in the company to the AI?\n\n'
      + 'It will approve work, publish posts, send customer replies, sign contracts, approve campaigns and financial reports, and rule on disputes — without waiting for you.\n\n'
      + 'Agents make mistakes. With this on, those mistakes are committed instead of caught.\n\n'
      + 'Every decision is logged with its reason, and you can switch this off at any moment.',
    )) return;
    try {
      await api('/api/autonomy/toggle', { method: 'POST', body: { enabled: on } });
      toast(on ? 'Autonomy ON — the AI is now deciding. Watch the log.' : 'Autonomy OFF — decisions wait for a human again.', on);
      renderHarmony(); refreshShell();
    } catch (e) { toast(e.message, true); }
  };
  $('#au-toggle-on')?.addEventListener('click', () => setAutonomy(true));
  $('#au-toggle-off')?.addEventListener('click', () => setAutonomy(false));
  $('#au-off')?.addEventListener('click', () => setAutonomy(false));
  view.querySelectorAll('[data-au-revert]').forEach((b) => b.addEventListener('click', async () => {
    const note = prompt('What was wrong with this decision?') || null;
    try {
      const r = await api(`/api/autonomy/${b.dataset.auRevert}/revert`, { method: 'POST', body: { note } });
      toast(r.note || 'Recorded'); renderHarmony();
    } catch (e) { toast(e.message, true); }
  }));

  if (!canM) return;
  $('#hm-toggle')?.addEventListener('click', async () => {
    try { await api('/api/harmony/toggle', { method: 'POST', body: { enabled: !h.enabled } }); toast(h.enabled ? 'Orchestrator paused' : 'Orchestrator running — a cycle every hour'); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-mode')?.addEventListener('click', async () => {
    try { await api('/api/harmony/mode', { method: 'POST', body: { mode: h.mode === 'live' ? 'dry-run' : 'live' } }); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-cycle')?.addEventListener('click', async () => {
    try { await api('/api/harmony/cycle', { method: 'POST', body: {} }); toast('Cycle started — the orchestrator is reading the company'); renderHarmony(); }
    catch (e) { toast(e.message, true); }
  });
  $('#hm-boost')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Working…';
    try {
      const r = await api('/api/harmony/boost', { method: 'POST', body: {} });
      $('#hm-boost-out').innerHTML = `
        <div class="panel" style="margin-top:10px;border-color:var(--ember)">
          <div class="panel-title">Harmony ${r.before}% → ${r.after}%</div>
          ${r.dispatched.length ? `<div class="panel-title" style="margin-top:6px">Done automatically</div>
            ${r.dispatched.map((x) => `<div class="harm-part"><span class="hp-ok" style="color:var(--ok)">✓</span><span>${esc(x.key)}</span><span class="hp-detail">${esc(x.detail)}</span></div>`).join('')}` : ''}
          ${r.remaining.length ? `<div class="panel-title" style="margin-top:8px">Only you can finish these</div>
            ${r.remaining.map((x) => `<div class="harm-part"><span class="hp-ok" style="color:var(--warn)">!</span><span><a href="${esc(x.href)}">${esc(x.key)}</a></span><span class="hp-detail">${esc(x.how)}</span></div>`).join('')}
            <div class="map-legend" style="margin-top:8px">These are the load-bearing human moments — publishing, sending, signing, gate verdicts. The platform will not do them for you, which is the point.</div>`
            : '<div class="map-legend" style="margin-top:8px">Nothing is left that a person must do. The next refresh should read 100%.</div>'}
        </div>`;
      toast(`Harmony ${r.before}% → ${r.after}% · ${r.dispatched.length} dispatched, ${r.remaining.length} for you`);
    } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Raise the score — do everything an agent can'; }
  });
}

// ---------- Request desk ----------
const REQ_STATE_CLS = { done: 'done', running: 'running', triaging: 'running', awaiting_human: 'awaiting_human', failed: 'failed', cancelled: 'failed' };

async function renderRequests() {
  const [ov, depts] = await Promise.all([api('/api/requests'), api('/api/requests/departments').catch(() => [])]);
  const canC = hasPermC('requests.create');
  view.innerHTML = `
  <div class="grid grid-4">
    <div class="panel tile"><div class="panel-title">Requests</div><div class="big">${ov.total}</div><div class="sub">${ov.done} completed</div></div>
    <div class="panel tile ${ov.open ? 'tile-steel' : ''}"><div class="panel-title">Moving now</div><div class="big">${ov.open}</div><div class="sub">travelling between departments</div></div>
    <div class="panel tile ${ov.needsHuman ? 'tile-warn' : ''}"><div class="panel-title">Waiting on you</div><div class="big">${ov.needsHuman}</div><div class="sub"><a href="#/gate">approvals inbox →</a></div></div>
    <div class="panel tile"><div class="panel-title">Departments engaged</div><div class="big">${ov.departmentsTouched}</div><div class="sub">${ov.stepsRun} steps completed automatically</div></div>
  </div>

  ${canC ? `<div class="panel">
    <div class="panel-title">Write what you need — in Arabic or English, however you'd say it to a colleague</div>
    <div><textarea id="rq-body" style="min-height:96px" placeholder="مثال: اريد دراسة كاملة لإطلاق تطبيق فواتير للشركات الصغيرة في العراق — السوق، المتطلبات، التصميم التقني، التكلفة، وخطة التسويق&#10;or: Find me 10 energy companies in Basra with real contact details, then draft an intro email for each"></textarea></div>
    <div class="form-inline">
      <div style="flex:2"><label class="fl">Title (optional — the router will name it)</label><input type="text" id="rq-title"></div>
      <div><label class="fl">Priority</label><select id="rq-prio"><option>normal</option><option>high</option><option>critical</option><option>low</option></select></div>
      <button class="btn btn-primary" id="rq-go">Submit to the company</button>
    </div>
    <div class="map-legend">The intake router reads your request and draws its own route through the departments that must each do something real — it is not a fixed template. Steps run by themselves, open actual work in other sections when needed (an intelligence campaign, a design package, a financial report), and stop only where a person is required. You can watch every step below.</div>
  </div>` : ''}

  ${ov.requests.map((r) => {
    const cur = r.progress.current;
    return `<div class="panel">
      <div class="jr-head">
        <span><a href="#/requests/${r.id}" style="color:var(--ink);text-decoration:none"><b>#${r.id} ${esc(r.title)}</b></a>
          <span class="state state-${REQ_STATE_CLS[r.state] || 'queued'}">${esc(r.state)}</span>
          ${r.priority !== 'normal' ? `<span class="chip ${r.priority === 'critical' ? 'chip-bad' : 'chip-warn'}">${esc(r.priority)}</span>` : ''}</span>
        <span>
          <span class="chip chip-dim">${r.progress.done}/${r.progress.total} steps · ${money4(r.progress.costUsd)}</span>
          ${r.state === 'done' ? `<button class="btn btn-sm" data-download="/api/requests/${r.id}/export" data-filename="request-${r.id}.md">⬇ Deliverable</button>` : ''}
          ${connBtn('request', r.id)}
        </span>
      </div>
      <div class="map-legend">${esc(short(r.body, 190))}</div>
      <div class="jr-track" style="margin:8px 0"><div class="jr-fill" style="width:${r.progress.pct}%"></div></div>
      <div class="route">
        ${r.steps.map((s) => `<a class="route-stop ${esc(s.state)}" href="#/requests/${r.id}" title="${esc(s.title)}${s.note ? ` — ${esc(s.note)}` : ''}">
          <span class="rs-dept">${esc(s.dept)}</span>
          <span class="rs-mark">${s.state === 'done' ? '✓' : s.state === 'active' ? '●' : s.state === 'awaiting_human' ? '⏸' : s.state === 'failed' ? '✕' : '·'}</span>
        </a>`).join('') || '<span class="map-legend">the router is drawing the route…</span>'}
      </div>
      ${cur ? `<div class="map-legend">now at <b style="color:var(--ember)">${esc(cur.dept)}</b> — ${esc(cur.title)}${cur.agent ? ` · ${esc(cur.agent)}` : ''}${cur.state === 'awaiting_human' ? ' · <span style="color:var(--warn)">waiting on you</span>' : ''}</div>` : ''}
    </div>`;
  }).join('') || '<div class="panel"><div class="empty">No requests yet — write one above and watch it travel.</div></div>'}`;

  wireConnections();
  wireDownloads();
  if (!canC) return;
  $('#rq-go')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/requests', { method: 'POST', body: { body: $('#rq-body').value, title: $('#rq-title').value || null, priority: $('#rq-prio').value } });
      toast('Submitted — the intake router is planning its route'); location.hash = `#/requests/${r.id}`;
    } catch (e) { toast(e.message, true); }
  });
}

async function renderRequestDetail(id) {
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
async function renderOrg() {
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

// ---------- The society ----------
const initials = (s) => String(s || '?').replace(/^AGT-/, '').split(/[\s-]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const GROUP_COLOR = { build: '#b78bff', create: '#ff5fa2', run: '#ffb020', discover: '#78bf6d', steer: '#948b7d', assure: '#5ec3c9' };

async function renderSociety() {
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
async function renderDisputes() {
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
      <div style="flex:2"><label class="fl">What is the disagreement about?</label><input type="text" id="dp-title"></div>
      <div><label class="fl">Party A</label><input type="text" id="dp-a" list="dp-parties" placeholder="AGT-REV-001"></div>
      <div><label class="fl">Party B</label><input type="text" id="dp-b" list="dp-parties" placeholder="AGT-ENG-001"></div>
      <button class="btn btn-primary" id="dp-go">Send to HR</button>
    </div>
    <datalist id="dp-parties">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
    <div class="form-inline">
      <div style="flex:1"><label class="fl">Position A</label><textarea id="dp-pa" style="min-height:70px"></textarea></div>
      <div style="flex:1"><label class="fl">Position B</label><textarea id="dp-pb" style="min-height:70px"></textarea></div>
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

// ---------- the six new departments, one shared renderer ----------
const DEPT_PAGES = {
  pricing: {
    title: 'Pricing', perm: 'pricing.manage', endpoint: '/api/pricing',
    intro: 'Several agents are forbidden from stating a price that is not backed by an approved pricing record. This is that record — a draft is invisible to them, an approved one is quotable.',
    tiles: (d) => [
      ['Records', d.records.length, `${d.approved.length} approved and quotable`],
      ['Approved', d.approved.length, 'agents may cite these'],
      ['Drafts', d.records.filter((r) => r.state === 'draft').length, 'awaiting your approval'],
      ['Retired', d.records.filter((r) => r.state === 'retired').length, 'kept for the record'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.5"><label class="fl">Name</label><input type="text" id="pc-name" placeholder="Pro plan"></div>
        <div><label class="fl">Amount</label><input type="text" id="pc-amount" value="0"></div>
        <div style="flex:0.6"><label class="fl">Currency</label><input type="text" id="pc-cur" value="USD"></div>
        <div><label class="fl">Unit</label><input type="text" id="pc-unit" value="per month"></div>
        <div><label class="fl">Plan</label><input type="text" id="pc-plan" value="standard"></div>
        <button class="btn btn-primary" id="pc-go">Draft with analysis</button>
      </div>
      <div><label class="fl">Why this price?</label><input type="text" id="pc-why" placeholder="what the buyer compares it to, what it must cover"></div>`,
    submit: async () => api('/api/pricing', { method: 'POST', body: { name: $('#pc-name').value, amount: Number($('#pc-amount').value) || 0, currency: $('#pc-cur').value, unit: $('#pc-unit').value, plan: $('#pc-plan').value, rationale: $('#pc-why').value || null } }),
    rows: (d, canM) => d.records.map((r) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(r.name)}</b> <span class="mono">${esc(String(r.amount))} ${esc(r.currency)} ${esc(r.unit)}</span>
            <span class="chip chip-dim">${esc(r.plan)}</span>
            <span class="state state-${r.state === 'approved' ? 'done' : r.state === 'retired' ? 'failed' : 'awaiting_human'}">${esc(r.state)}</span></span>
          <span>${canM && r.state === 'draft' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/pricing/${r.id}/state","body":{"state":"approved"}}'>Approve</button>` : ''}
            ${canM && r.state === 'approved' ? `<button class="btn btn-sm" data-act='{"path":"/api/pricing/${r.id}/state","body":{"state":"retired"}}'>Retire</button>` : ''}</span>
        </div>
        ${r.approved_by ? `<div class="map-legend">approved by ${esc(r.approved_by)}</div>` : ''}
        ${r.rationale ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the pricing analysis</summary><pre class="json" style="max-height:40vh;white-space:pre-wrap">${esc(r.rationale)}</pre></details>` : '<div class="map-legend">the analyst is working on the rationale…</div>'}
      </div></div>`).join('') || '<div class="empty">No pricing records — until one is approved, no agent may quote a price.</div>',
  },
  success: {
    title: 'Customer success', perm: 'success.manage', endpoint: '/api/success',
    intro: 'The CRM knows who pays. This knows who is actually healthy — judged from ticket history and how recently anyone spoke to them, not from optimism.',
    tiles: (d) => [
      ['Assessed', d.assessed, `of ${d.customers} customers`],
      ['At risk', d.atRisk, `$${d.mrrAtRisk}/mo exposed`],
      ['Average score', d.avgScore ?? '—', 'out of 5'],
      ['Unassessed', Math.max(0, d.customers - d.assessed), 'nobody has looked'],
    ],
    form: () => `<div class="map-legend">Open a customer below and assess them, or run one from the <a href="#/customers">CRM</a>.</div>`,
    rows: (d, canM) => d.rows.map((r) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(r.customer_name)}</b> <span class="mono">$${r.mrr_usd}/mo</span>
            <span class="chip ${['at_risk', 'churn_risk'].includes(r.stage) ? 'chip-bad' : r.stage === 'healthy' ? 'chip-ok' : 'chip-dim'}">${esc(r.stage.replace('_', ' '))}</span>
            <span class="chip chip-dim">${'●'.repeat(r.score)}${'○'.repeat(5 - r.score)}</span></span>
          <span>${canM ? `<button class="btn btn-sm" data-act='{"path":"/api/success/${r.customer_id}/assess","body":{}}'>Re-assess</button>` : ''}</span>
        </div>
        ${r.notes ? `<div class="map-legend">${esc(r.notes)}</div>` : '<div class="map-legend">assessing…</div>'}
        ${r.next_step ? `<div style="font-size:12.5px;margin-top:4px">→ <b>${esc(r.next_step)}</b></div>` : ''}
      </div></div>`).join('') || '<div class="empty">No customers assessed yet.</div>',
    extra: (d) => d.customers > d.assessed ? `<div class="panel"><div class="panel-title">Not yet assessed</div><div class="map-legend">Assess a customer from the <a href="#/customers">CRM</a> — the success desk reads their tickets and interaction history to judge health.</div></div>` : '',
  },
  assets: {
    title: 'Assets', perm: 'assets.manage', endpoint: '/api/assets', listKey: null,
    intro: 'Domains, licences, credentials and devices expire exactly like vendor contracts, and losing one quietly is how companies lose their name. Renewals inside 21 days raise an alert.',
    tiles: (d) => [
      ['Assets', d.length, `${d.filter((a) => a.state === 'active').length} active`],
      ['Monthly cost', `$${d.reduce((a, x) => a + (x.cost_usd || 0), 0)}`, 'across all assets'],
      ['Renewing soon', d.filter((a) => a.renewal_date && a.renewal_date <= new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10)).length, 'within 21 days'],
      ['Kinds', new Set(d.map((a) => a.kind)).size, 'domains, licences, credentials…'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl">Name</label><input type="text" id="as-name" placeholder="crucible.iq domain"></div>
        <div><label class="fl">Kind</label><select id="as-kind"><option>domain</option><option>license</option><option>credential</option><option>device</option><option>repo</option><option>account</option><option>certificate</option></select></div>
        <div><label class="fl">Owner</label><input type="text" id="as-owner" value="${esc(currentUser?.username || '')}"></div>
        <div style="flex:0.6"><label class="fl">$/mo</label><input type="text" id="as-cost" value="0"></div>
        <div><label class="fl">Renews</label><input type="text" id="as-renew" placeholder="2027-01-15"></div>
        <button class="btn btn-primary" id="as-go">Register</button>
      </div>`,
    submit: async () => api('/api/assets', { method: 'POST', body: { name: $('#as-name').value, kind: $('#as-kind').value, owner: $('#as-owner').value, costUsd: Number($('#as-cost').value) || 0, renewalDate: $('#as-renew').value || null } }),
    rows: (d, canM) => `<table><thead><tr><th>Asset</th><th>Kind</th><th>Owner</th><th class="num">$/mo</th><th>Renews</th><th>State</th>${canM ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.map((a) => {
        const soon = a.renewal_date && a.renewal_date <= new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
        return `<tr style="${a.state === 'retired' ? 'opacity:.5' : ''}">
          <td><b>${esc(a.name)}</b>${a.vendor ? ` <a class="chip chip-dim" style="text-decoration:none" href="#/vendors">${esc(a.vendor.name)}</a>` : ''}</td>
          <td><span class="chip chip-steel">${esc(a.kind)}</span></td>
          <td class="mono">${esc(a.owner)}</td>
          <td class="num">${a.cost_usd}</td>
          <td class="mono" style="color:${soon ? 'var(--warn)' : 'var(--ink-faint)'}">${esc(a.renewal_date || '—')}</td>
          <td><span class="chip ${a.state === 'active' ? 'chip-ok' : 'chip-dim'}">${esc(a.state)}</span></td>
          ${canM ? `<td>${a.state !== 'retired' ? `<button class="btn btn-sm" data-act='{"path":"/api/assets/${a.id}/state","body":{"state":"retired"}}'>Retire</button>` : ''}</td>` : ''}
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No assets registered.</td></tr>'}
    </tbody></table>`,
  },
  localization: {
    title: 'Localization', perm: 'localization.manage', endpoint: '/api/localization', listKey: null,
    intro: 'Adaptation between Arabic and English for meaning and market — not word by word. Formatting, numbers and placeholders are preserved exactly; anything that could not carry over is noted.',
    tiles: (d) => [
      ['Translations', d.length, `${d.filter((l) => l.state === 'approved').length} approved`],
      ['Ready to review', d.filter((l) => l.state === 'ready').length, 'awaiting your sign-off'],
      ['In progress', d.filter((l) => l.state === 'translating').length, 'the localization agent is working'],
      ['Languages', new Set(d.map((l) => l.target_lang)).size, 'targets in use'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl">Title</label><input type="text" id="lo-title"></div>
        <div><label class="fl">From</label><select id="lo-kind"><option value="manual">pasted text</option><option value="content">content item</option><option value="post">social post</option><option value="doc">design document</option></select></div>
        <div style="flex:0.5"><label class="fl">Source #</label><input type="text" id="lo-sid" placeholder="id"></div>
        <div style="flex:0.5"><label class="fl">Into</label><select id="lo-lang"><option value="ar">العربية</option><option value="en">English</option><option value="ku">Kurdish</option><option value="tr">Türkçe</option></select></div>
        <button class="btn btn-primary" id="lo-go">Translate</button>
      </div>
      <div><label class="fl">Text (leave blank when pulling from a source above)</label><textarea id="lo-text" style="min-height:80px"></textarea></div>`,
    submit: async () => api('/api/localization', { method: 'POST', body: { title: $('#lo-title').value || null, sourceKind: $('#lo-kind').value, sourceId: $('#lo-sid').value || null, sourceText: $('#lo-text').value || null, targetLang: $('#lo-lang').value } }),
    rows: (d, canM) => d.map((l) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(l.title)}</b> <span class="chip chip-dim">${esc(l.source_kind)}</span> <span class="chip chip-steel">→ ${esc(l.target_lang)}</span>
            <span class="state state-${l.state === 'approved' ? 'done' : l.state === 'ready' ? 'awaiting_human' : l.state === 'failed' ? 'failed' : 'running'}">${esc(l.state)}</span></span>
          <span>${canM && l.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/localization/${l.id}/approve","body":{}}'>Approve</button>` : ''}</span>
        </div>
        ${l.output ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">read the adaptation</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(l.output)}</pre></details>` : '<div class="map-legend">translating…</div>'}
        ${l.notes ? `<div class="map-legend">${esc(l.notes)}</div>` : ''}
      </div></div>`).join('') || '<div class="empty">Nothing translated yet.</div>',
  },
  marketwatch: {
    title: 'Market watch', perm: 'marketwatch.manage', endpoint: '/api/marketwatch', listKey: null,
    intro: 'Intelligence collects prospects. This watches rivals — what they sell, what they charge, where they are weak, and how they would react if we moved into their space.',
    tiles: (d) => [
      ['Competitors', d.length, `${d.filter((c) => c.state === 'watching').length} watched`],
      ['High threat', d.filter((c) => c.threat >= 4).length, 'threat 4 or 5'],
      ['Profiled', d.filter((c) => c.brief).length, 'with a research brief'],
      ['Checked live', d.filter((c) => c.last_checked).length, 'site fetched by the harvester'],
    ],
    form: () => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl">Competitor</label><input type="text" id="mw-name"></div>
        <div style="flex:1.2"><label class="fl">Website</label><input type="text" id="mw-site" placeholder="example.com"></div>
        <div><label class="fl">Segment</label><input type="text" id="mw-seg" placeholder="SME invoicing"></div>
        <button class="btn btn-primary" id="mw-go">Add & research</button>
      </div>`,
    submit: async () => api('/api/marketwatch', { method: 'POST', body: { name: $('#mw-name').value, website: $('#mw-site').value || null, segment: $('#mw-seg').value || null } }),
    rows: (d, canM) => d.map((c) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(c.name)}</b>${c.website ? ` <a href="${esc(/^https?:/.test(c.website) ? c.website : `https://${c.website}`)}" target="_blank" rel="noopener noreferrer" class="chip chip-dim" style="text-decoration:none">${esc(c.website)}</a>` : ''}
            ${c.segment ? `<span class="chip chip-steel">${esc(c.segment)}</span>` : ''}
            <span class="chip ${c.threat >= 4 ? 'chip-bad' : c.threat >= 3 ? 'chip-warn' : 'chip-dim'}">threat ${c.threat}/5</span></span>
          <span>${canM ? `${[1, 2, 3, 4, 5].map((t) => `<button class="btn btn-sm" data-act='{"path":"/api/marketwatch/${c.id}/threat","body":{"threat":${t}}}' style="padding:2px 6px;${c.threat === t ? 'color:var(--ember)' : ''}">${t}</button>`).join('')}
            ${c.website ? `<button class="btn btn-sm" data-act='{"path":"/api/marketwatch/${c.id}/check","body":{}}'>Check site</button>` : ''}` : ''}</span>
        </div>
        ${c.brief ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the profile${c.last_checked ? ` · last checked ${esc(c.last_checked.slice(0, 16))}` : ''}</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(c.brief)}</pre></details>` : '<div class="map-legend">researching…</div>'}
      </div></div>`).join('') || '<div class="empty">No competitors on watch.</div>',
  },
  enablement: {
    title: 'Enablement', perm: 'enablement.manage', endpoint: '/api/enablement', listKey: null,
    intro: 'Evals produce a red number; this turns that number into training. The plan says what wording the role specification needs, what the output contract should tighten, and which cases belong in the golden set.',
    tiles: (d) => [
      ['Plans', d.length, `${d.filter((e) => e.state === 'applied').length} applied to a spec`],
      ['Ready to apply', d.filter((e) => e.state === 'ready').length, 'read and apply them'],
      ['From failed evals', d.filter((e) => e.trigger === 'eval-fail').length, 'raised automatically'],
      ['Analysing', d.filter((e) => e.state === 'analysing').length, 'diagnosis in progress'],
    ],
    form: (extra) => `
      <div class="form-inline">
        <div style="flex:1.4"><label class="fl">Employee</label><select id="en-agent">${(extra.agents || []).map((a) => `<option value="${esc(a.id)}">${esc(a.id)} — ${esc(a.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="en-go">Analyse and plan</button>
      </div>`,
    submit: async () => api('/api/enablement', { method: 'POST', body: { agentId: $('#en-agent').value } }),
    rows: (d, canM) => d.map((e) => `
      <div class="round"><div class="round-body">
        <div class="agent-head">
          <span><b>${esc(e.agent_id)}</b> <span class="chip chip-dim">${esc(e.trigger)}</span>
            <span class="state state-${e.state === 'applied' ? 'done' : e.state === 'ready' ? 'awaiting_human' : e.state === 'dismissed' ? 'failed' : 'running'}">${esc(e.state)}</span></span>
          <span>${canM && e.state === 'ready' ? `<button class="btn btn-sm btn-ok" data-act='{"path":"/api/enablement/${e.id}/state","body":{"state":"applied"}}'>Mark applied</button>
            <button class="btn btn-sm" data-act='{"path":"/api/enablement/${e.id}/state","body":{"state":"dismissed"}}'>Dismiss</button>` : ''}</span>
        </div>
        ${e.findings ? `<div class="map-legend">${esc(e.findings)}</div>` : ''}
        ${e.plan ? `<details style="margin-top:6px"><summary class="map-legend" style="cursor:pointer">the improvement plan</summary><pre class="json" style="max-height:45vh;white-space:pre-wrap">${esc(e.plan)}</pre></details>` : '<div class="map-legend">analysing the failure pattern…</div>'}
        <div class="map-legend">Applying a plan means editing the role specification in <a href="#/org">the org</a> or config, then re-running its <a href="#/evals">eval set</a> to prove it worked.</div>
      </div></div>`).join('') || '<div class="empty">No enablement plans. They are also raised automatically when an eval scores under 70%.</div>',
  },
};

function makeDeptRenderer(key) {
  return async function renderDept() {
    const cfg = DEPT_PAGES[key];
    const data = await api(cfg.endpoint);
    const canM = hasPermC(cfg.perm);
    const extra = key === 'enablement' ? { agents: await api('/api/agents').catch(() => []) } : {};
    const tiles = cfg.tiles(data);
    view.innerHTML = `
    <div class="grid grid-4">
      ${tiles.map(([label, big, sub], i) => `<div class="panel tile ${i === 1 ? 'tile-steel' : ''}"><div class="panel-title">${esc(label)}</div><div class="big">${esc(String(big))}</div><div class="sub">${sub}</div></div>`).join('')}
    </div>
    <div class="panel">
      <div class="panel-title">${esc(cfg.title)}</div>
      <div class="map-legend">${cfg.intro}</div>
      ${canM ? cfg.form(extra) : ''}
    </div>
    <div class="panel">${cfg.rows(data, canM)}</div>
    ${cfg.extra ? cfg.extra(data) : ''}`;

    view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      let spec; try { spec = JSON.parse(b.dataset.act); } catch { return; }
      b.disabled = true;
      try { await api(spec.path, { method: 'POST', body: spec.body || {} }); renderDept(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    const goBtn = view.querySelector('#pc-go, #as-go, #lo-go, #mw-go, #en-go');
    goBtn?.addEventListener('click', async () => {
      try { await cfg.submit(); toast('Done'); renderDept(); } catch (e) { toast(e.message, true); }
    });
  };
}

// ---------- Expansion wave: 16 departments across TRUST/CAPITAL/TALENT/EXEC ----------
const xbtn = (path, body, label, cls = '') =>
  `<button class="btn btn-sm ${cls}" data-xact="${encodeURIComponent(JSON.stringify({ path, body }))}">${esc(label)}</button>`;
function wireXact(rerender) {
  view.querySelectorAll('[data-xact]').forEach((b) => b.addEventListener('click', async () => {
    let spec; try { spec = JSON.parse(decodeURIComponent(b.dataset.xact)); } catch { return; }
    b.disabled = true;
    try { await api(spec.path, { method: 'POST', body: spec.body || {} }); toast('Done'); rerender(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
const preBody = (t) => `<div class="mono" style="white-space:pre-wrap;font-size:11px;color:var(--ink-mute);max-height:260px;overflow:auto;border-left:2px solid var(--edge);padding:6px 10px;margin-top:6px">${esc(t || '')}</div>`;
const tile = (label, big, sub = '', cls = '') => `<div class="panel tile ${cls}"><div class="panel-title">${esc(label)}</div><div class="big">${big}</div><div class="sub">${sub}</div></div>`;

async function renderSecurity() {
  const d = await api('/api/security');
  const canM = hasPermC('security.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Open findings', d.stats.open, 'need triage', d.stats.open ? 'tile-warn' : '')}
    ${tile('High severity', d.stats.high, 'act now', d.stats.high ? 'tile-bad' : '')}
    ${tile('All-time findings', d.stats.total, 'swept from real runs and configs')}
    <div class="panel tile"><div class="panel-title">Sweep</div>
      ${canM ? xbtn('/api/security/scan', {}, 'Run security sweep', 'btn-primary') : '<div class="sub">security.manage required</div>'}
      <div class="sub" style="margin-top:6px">Checks run inputs for injection phrasing, outputs for secret-shaped strings, vendors for missing DPAs, users for over-broad grants.</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Findings</div>
    <table><thead><tr><th>#</th><th>Kind</th><th>Sev</th><th>Summary</th><th>State</th><th></th></tr></thead><tbody>
    ${d.events.map((e) => `<tr>
      <td class="mono">${e.id}</td><td class="mono">${esc(e.kind)}</td>
      <td><span class="chip ${e.severity === 'high' ? 'chip-bad' : e.severity === 'medium' ? 'chip-warn' : 'chip-dim'}">${esc(e.severity)}</span></td>
      <td>${esc(e.summary)}</td><td class="mono">${esc(e.state)}</td>
      <td>${canM && e.state === 'open' ? xbtn(`/api/security/${e.id}/state`, { state: 'triaged' }, 'Triage') : ''}
          ${canM && e.state !== 'closed' ? xbtn(`/api/security/${e.id}/state`, { state: 'closed' }, 'Close', 'btn-ok') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No findings yet — run a sweep.</td></tr>'}
    </tbody></table>
  </div>`;
  wireXact(renderSecurity);
}

async function renderCompliance() {
  const d = await api('/api/compliance');
  const canM = hasPermC('compliance.manage');
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Provider posture — from live config</div>
      <table><thead><tr><th>Provider</th><th>DPA</th><th>No-training</th></tr></thead><tbody>
      ${d.providers.map((p) => `<tr><td class="mono">${esc(p.name)}</td>
        <td>${p.dpa ? '<span class="chip chip-ok">signed</span>' : '<span class="chip chip-bad">missing</span>'}</td>
        <td>${p.noTraining ? '<span class="chip chip-ok">yes</span>' : '<span class="chip chip-warn">unknown</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="panel"><div class="panel-title">Data processing register</div>
      <table><thead><tr><th>Store</th><th>Contains</th><th>Basis</th></tr></thead><tbody>
      ${d.dataRegister.map((r) => `<tr><td class="mono">${esc(r.store)}</td><td>${esc(r.contains)}</td><td class="mono">${esc(r.basis)}</td></tr>`).join('')}
      </tbody></table></div>
  </div>
  <div class="panel">
    <div class="panel-title">Attestations — human-signed, auditor-ready</div>
    ${canM ? `<div class="form-inline">
      <input id="cc-area" placeholder="area, e.g. access-control" style="width:200px">
      <select id="cc-status" style="width:auto"><option value="ok">ok</option><option value="gap">gap</option><option value="na">n/a</option></select>
      <input id="cc-note" placeholder="note" style="width:280px">
      <button class="btn btn-sm btn-primary" id="cc-go">Record check</button></div>` : ''}
    <table><thead><tr><th>Area</th><th>Status</th><th>Note</th><th>By</th><th>When</th></tr></thead><tbody>
    ${d.checks.map((c) => `<tr><td class="mono">${esc(c.area)}</td>
      <td><span class="chip ${c.status === 'ok' ? 'chip-ok' : c.status === 'gap' ? 'chip-bad' : 'chip-dim'}">${esc(c.status)}</span></td>
      <td>${esc(c.note || '')}</td><td class="mono">${esc(c.checked_by)}</td><td class="mono">${esc(c.created_at.slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No attestations recorded yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#cc-go')?.addEventListener('click', async () => {
    try {
      await api('/api/compliance/check', { method: 'POST', body: { area: $('#cc-area').value, status: $('#cc-status').value, note: $('#cc-note').value || null } });
      toast('Recorded'); renderCompliance();
    } catch (e) { toast(e.message, true); }
  });
}

async function renderSustainability() {
  const d = await api('/api/sustainability');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Energy (est.)', `${d.totalKwh}<span class="unit">kWh</span>`, 'all model calls, all time')}
    ${tile('Carbon (est.)', `${d.totalGco2}<span class="unit">g</span>`, 'at 400 g/kWh grid average')}
    ${tile('Providers metered', d.byProvider.length, 'from the live token meters')}
    <div class="panel tile"><div class="panel-title">Method</div><div class="sub">${esc(d.note)}</div></div>
  </div>
  <div class="panel"><div class="panel-title">By provider</div>
    <table><thead><tr><th>Provider</th><th class="num">Tokens</th><th class="num">kWh</th><th class="num">gCO2</th><th class="num">Cost</th></tr></thead><tbody>
    ${d.byProvider.map((p) => `<tr><td class="mono">${esc(p.provider)}</td><td class="num mono">${p.tokens}</td><td class="num mono">${p.kwh}</td><td class="num mono">${p.gco2}</td><td class="num mono">$${p.cost?.toFixed?.(4) ?? p.cost}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No model calls yet.</td></tr>'}
    </tbody></table></div>
  <div class="panel"><div class="panel-title">Efficiency playbook</div>
    ${d.tips.map((t) => `<div class="map-legend">— ${esc(t)}</div>`).join('')}</div>`;
}

async function renderCapacity() {
  const rows = await api('/api/capacity');
  const sat = rows.filter((r) => r.saturated).length;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Active employees', rows.length, 'AI workforce on shift')}
    ${tile('Saturated', sat, 'over 3 live runs or 80% daily budget', sat ? 'tile-warn' : '')}
    ${tile('Live work items', rows.reduce((a, b) => a + b.active, 0), 'queued + leased + running')}
    ${tile('Waiting on humans', rows.reduce((a, b) => a + b.waiting, 0), 'at the gate')}
  </div>
  <div class="panel"><div class="panel-title">Load board — live per employee</div>
    <table><thead><tr><th>Agent</th><th>Group</th><th class="num">Active</th><th class="num">Gate</th><th class="num">Done 7d</th><th style="width:22%">Daily budget</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td class="mono">${esc(r.id)}</td><td class="mono">${esc(r.role_group)}</td>
      <td class="num">${r.active}</td><td class="num">${r.waiting}</td><td class="num">${r.done7}</td>
      <td><div class="meter-track"><div class="meter-fill ${r.budgetPct > 80 ? 'hot' : ''}" style="width:${Math.min(100, r.budgetPct)}%"></div></div></td>
      <td>${r.saturated ? '<span class="chip chip-warn">saturated</span>' : '<span class="chip chip-ok">ok</span>'}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

async function renderLab() {
  const rows = await api('/api/lab');
  const canM = hasPermC('lab.manage');
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New experiment — two prompts race, you judge the winner</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="lx-name" placeholder="name" style="width:180px">
      <input id="lx-hypo" placeholder="hypothesis (optional)" style="width:260px">
      <textarea id="lx-a" placeholder="variant A prompt" style="width:100%;height:56px"></textarea>
      <textarea id="lx-b" placeholder="variant B prompt" style="width:100%;height:56px"></textarea>
      <button class="btn btn-sm btn-primary" id="lx-go">Run A/B</button></div>` : '<div class="map-legend">lab.manage required to start experiments.</div>'}
  </div>
  ${rows.map((x) => `
  <div class="panel">
    <div class="panel-title"><span>#${x.id} ${esc(x.name)} <span class="chip ${x.state === 'concluded' ? 'chip-ok' : 'chip-warn'}">${esc(x.state)}</span>${x.winner ? ` <span class="chip chip-ember">winner: ${esc(x.winner)}</span>` : ''}</span>
      <span>${canM && x.state === 'running' && x.result_a && x.result_b ? xbtn(`/api/lab/${x.id}/conclude`, { winner: 'a' }, 'A wins') + xbtn(`/api/lab/${x.id}/conclude`, { winner: 'b' }, 'B wins') + xbtn(`/api/lab/${x.id}/conclude`, { winner: 'inconclusive' }, 'Inconclusive') : ''}</span></div>
    ${x.hypothesis ? `<div class="map-legend">${esc(x.hypothesis)}</div>` : ''}
    <div class="grid grid-2">
      <div><b style="font-size:12px">A</b>${preBody(x.result_a || '⏳ running…')}</div>
      <div><b style="font-size:12px">B</b>${preBody(x.result_b || '⏳ running…')}</div>
    </div>
  </div>`).join('') || '<div class="panel"><div class="empty">No experiments yet.</div></div>'}`;
  wireXact(renderLab);
  $('#lx-go')?.addEventListener('click', async () => {
    try {
      await api('/api/lab', { method: 'POST', body: { name: $('#lx-name').value, hypothesis: $('#lx-hypo').value || null, variantA: $('#lx-a').value, variantB: $('#lx-b').value } });
      toast('Experiment running'); renderLab();
    } catch (e) { toast(e.message, true); }
  });
}

async function renderReleases() {
  const rows = await api('/api/releases');
  const canM = hasPermC('releases.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Draft a release — notes compile themselves from completed work</div>
    ${canM ? `<div class="form-inline">
      <input id="rl-ver" placeholder="version, e.g. 1.4.0" style="width:160px">
      <button class="btn btn-sm btn-primary" id="rl-go">Draft notes</button></div>` : ''}
  </div>
  ${rows.map((r) => `
  <div class="panel">
    <div class="panel-title"><span>v${esc(r.version)} <span class="chip ${r.state === 'published' ? 'chip-ok' : 'chip-warn'}">${esc(r.state)}</span></span>
      <span>${canM && r.state === 'draft' && r.notes ? xbtn(`/api/releases/${r.id}/publish`, {}, 'Publish', 'btn-ok') : ''}</span></div>
    ${preBody(r.notes || '⏳ the agent is compiling the changelog…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No releases yet.</div></div>'}`;
  wireXact(renderReleases);
  $('#rl-go')?.addEventListener('click', async () => {
    try { await api('/api/releases', { method: 'POST', body: { version: $('#rl-ver').value } }); toast('Drafting'); renderReleases(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderPmo() {
  const [d, projects] = await Promise.all([api('/api/pmo'), api('/api/projects').catch(() => [])]);
  const canM = hasPermC('pmo.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Pending gates', d.stats.pending, 'waiting for a human ruling', d.stats.pending ? 'tile-warn' : '')}
    ${tile('Passed', d.stats.passed, 'crossings approved')}
    ${tile('Failed', d.stats.failed, 'work sent back')}
    <div class="panel tile"><div class="panel-title">New gate</div>
      ${canM ? `<div class="form-inline" style="flex-direction:column;align-items:stretch;gap:6px">
        <select id="pg-proj">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <input id="pg-gate" placeholder="gate, e.g. Design freeze">
        <button class="btn btn-sm btn-primary" id="pg-go">Create</button></div>` : '<div class="sub">pmo.manage required</div>'}</div>
  </div>
  <div class="panel"><div class="panel-title">Stage gates across all projects</div>
    <table><thead><tr><th>#</th><th>Project</th><th>Gate</th><th>State</th><th>Approver</th><th></th></tr></thead><tbody>
    ${d.gates.map((x) => `<tr>
      <td class="mono">${x.id}</td><td>${esc(x.project_name || x.project_id)}</td><td>${esc(x.gate)}</td>
      <td><span class="chip ${x.state === 'passed' ? 'chip-ok' : x.state === 'failed' ? 'chip-bad' : 'chip-warn'}">${esc(x.state)}</span></td>
      <td class="mono">${esc(x.approver || '—')}</td>
      <td>${canM && x.state === 'pending' ? xbtn(`/api/pmo/${x.id}/resolve`, { state: 'passed' }, 'Pass', 'btn-ok') + xbtn(`/api/pmo/${x.id}/resolve`, { state: 'failed' }, 'Fail', 'btn-bad') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No gates yet.</td></tr>'}
    </tbody></table></div>`;
  wireXact(renderPmo);
  $('#pg-go')?.addEventListener('click', async () => {
    try { await api('/api/pmo', { method: 'POST', body: { projectId: $('#pg-proj').value, gate: $('#pg-gate').value } }); toast('Gate created'); renderPmo(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderInsights() {
  const d = await api('/api/insights');
  const maxAct = Math.max(...d.activityByDay.map((x) => x.n), 1);
  const maxSpend = Math.max(...d.spendByDay.map((x) => x.usd), 0.0001);
  const bars = (rows, valKey, maxV, fmt) => `<div style="display:flex;align-items:flex-end;gap:4px;height:90px;padding-top:8px">
    ${rows.map((r) => `<div title="${esc(r.day)}: ${fmt(r[valKey])}" style="flex:1;background:var(--ember);opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(3, (r[valKey] / maxV) * 82)}px"></div>`).join('')}</div>`;
  view.innerHTML = `
  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Company activity — audit events per day (14d)</div>${bars(d.activityByDay, 'n', maxAct, (v) => `${v} events`)}</div>
    <div class="panel"><div class="panel-title">Model spend per day (14d)</div>${bars(d.spendByDay, 'usd', maxSpend, (v) => `$${v}`)}</div>
  </div>
  <div class="grid grid-3">
    <div class="panel"><div class="panel-title">Runs by state</div>
      <table><tbody>${d.runsByState.map((r) => `<tr><td class="mono">${esc(r.state)}</td><td class="num mono">${r.n}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel"><div class="panel-title">Busiest employees</div>
      <table><tbody>${d.busiestAgents.map((r) => `<tr><td class="mono">${esc(r.agent_id)}</td><td class="num mono">${r.runs}</td></tr>`).join('')}</tbody></table></div>
    <div class="panel"><div class="panel-title">Most-touched subjects</div>
      <table><tbody>${d.topSubjects.map((r) => `<tr><td class="mono">${esc(r.subject_type)}</td><td class="num mono">${r.n}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
}

async function renderBrand() {
  const rows = await api('/api/brand');
  const canM = hasPermC('brand.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Brand studio — the identity every agent must obey</div>
    ${canM ? `<div class="form-inline">
      <select id="br-kind" style="width:auto"><option>voice</option><option>palette</option><option>logo-spec</option><option>boilerplate</option><option>guideline</option></select>
      <input id="br-name" placeholder="asset name" style="width:220px">
      <button class="btn btn-sm btn-primary" id="br-go">Draft with an agent</button></div>` : ''}
  </div>
  ${rows.map((a) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(a.kind)} · ${esc(a.name)} <span class="chip ${a.state === 'approved' ? 'chip-ok' : 'chip-warn'}">${esc(a.state)}</span></span>
      <span>${canM && a.state === 'draft' && a.content ? xbtn(`/api/brand/${a.id}/approve`, {}, 'Approve', 'btn-ok') : ''}</span></div>
    ${preBody(a.content || '⏳ drafting…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No brand assets yet.</div></div>'}`;
  wireXact(renderBrand);
  $('#br-go')?.addEventListener('click', async () => {
    try { await api('/api/brand', { method: 'POST', body: { kind: $('#br-kind').value, name: $('#br-name').value } }); toast('Drafting'); renderBrand(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderProcurement() {
  const [rows, vendors] = await Promise.all([api('/api/procurement'), api('/api/vendors').catch(() => [])]);
  const canM = hasPermC('procurement.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Purchase requests — human approval before money moves</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="pu-item" placeholder="item" style="width:220px">
      <input id="pu-amt" type="number" placeholder="USD" style="width:90px">
      <select id="pu-vendor" style="width:auto"><option value="">— vendor —</option>${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      <input id="pu-why" placeholder="justification" style="width:260px">
      <button class="btn btn-sm btn-primary" id="pu-go">Request</button></div>` : ''}
    <table><thead><tr><th>#</th><th>Item</th><th class="num">USD</th><th>Vendor</th><th>State</th><th>By / Approver</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr>
      <td class="mono">${p.id}</td><td>${esc(p.item)}${p.justification ? `<div class="map-legend">${esc(p.justification)}</div>` : ''}</td>
      <td class="num mono">$${p.amount_usd}</td><td>${esc(p.vendor_name || '—')}</td>
      <td><span class="chip ${p.state === 'approved' || p.state === 'ordered' ? 'chip-ok' : p.state === 'rejected' ? 'chip-bad' : 'chip-warn'}">${esc(p.state)}</span></td>
      <td class="mono" style="font-size:10px">${esc(p.created_by)}${p.approver ? ` → ${esc(p.approver)}` : ''}</td>
      <td>${canM && p.state === 'requested' ? xbtn(`/api/procurement/${p.id}/resolve`, { state: 'approved' }, 'Approve', 'btn-ok') + xbtn(`/api/procurement/${p.id}/resolve`, { state: 'rejected' }, 'Reject', 'btn-bad') : ''}
          ${canM && p.state === 'approved' ? xbtn(`/api/procurement/${p.id}/resolve`, { state: 'ordered' }, 'Mark ordered') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No purchase requests yet.</td></tr>'}
    </tbody></table></div>`;
  wireXact(renderProcurement);
  $('#pu-go')?.addEventListener('click', async () => {
    try {
      await api('/api/procurement', { method: 'POST', body: { item: $('#pu-item').value, amountUsd: Number($('#pu-amt').value) || 0, vendorId: $('#pu-vendor').value || null, justification: $('#pu-why').value || null } });
      toast('Requested'); renderProcurement();
    } catch (e) { toast(e.message, true); }
  });
}

async function renderFinops() {
  const d = await api('/api/finops');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Wasted spend', `$${d.wasted.usd}`, `inside ${d.wasted.runs} failed/cancelled runs`, d.wasted.usd > 0 ? 'tile-warn' : '')}
    ${tile('Transport retries', d.retries, 'failed calls that were retried')}
    ${tile('Metered employees', d.byAgent.length, 'agents with recorded spend')}
    ${tile('Costliest', d.byAgent[0] ? esc(d.byAgent[0].agent_id) : '—', d.byAgent[0] ? `$${d.byAgent[0].usd}` : '')}
  </div>
  <div class="panel"><div class="panel-title">Cost per employee</div>
    <table><thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Tokens</th><th class="num">USD</th></tr></thead><tbody>
    ${d.byAgent.map((a) => `<tr><td class="mono">${esc(a.agent_id)}</td><td class="num mono">${a.runs}</td><td class="num mono">${a.tokens}</td><td class="num mono">$${a.usd}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No metered spend yet.</td></tr>'}
    </tbody></table></div>
  <div class="panel"><div class="panel-title">Recommendations</div>
    ${d.recommendations.map((r) => `<div class="map-legend">— ${esc(r)}</div>`).join('')}</div>`;
}

async function renderRecruiting() {
  const rows = await api('/api/recruiting');
  const canM = hasPermC('recruiting.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Open a role — an agent drafts the spec, a reviewer trials it, you decide</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="rc-role" placeholder="role, e.g. Localization QA" style="width:220px">
      <input id="rc-brief" placeholder="what should this employee do?" style="width:380px">
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

async function renderAcademy() {
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
      <select id="ac-agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
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

async function renderIr() {
  const rows = await api('/api/ir');
  const canM = hasPermC('ir.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Investor updates — drafted from the live ledger, sent by you</div>
    ${canM ? `<div class="form-inline">
      <input id="ir-period" placeholder="period, e.g. 2026-08" style="width:140px">
      <button class="btn btn-sm btn-primary" id="ir-go">Draft update</button></div>` : ''}
  </div>
  ${rows.map((u) => `
  <div class="panel">
    <div class="panel-title"><span>${esc(u.period)} <span class="chip ${u.state === 'sent' ? 'chip-ok' : 'chip-warn'}">${esc(u.state)}</span></span>
      <span>${canM && u.state === 'draft' && u.body ? xbtn(`/api/ir/${u.id}/send`, {}, 'Mark sent', 'btn-ok') : ''}</span></div>
    ${preBody(u.body || '⏳ drafting from live numbers…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No investor updates yet.</div></div>'}`;
  wireXact(renderIr);
  $('#ir-go')?.addEventListener('click', async () => {
    try { await api('/api/ir', { method: 'POST', body: { period: $('#ir-period').value } }); toast('Drafting'); renderIr(); }
    catch (e) { toast(e.message, true); }
  });
}

async function renderBoard() {
  const rows = await api('/api/board');
  const canM = hasPermC('board.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Board room — the packet reads the company, the humans resolve</div>
    ${canM ? `<div class="form-inline">
      <input id="bd-period" placeholder="period, e.g. 2026-Q3" style="width:140px">
      <button class="btn btn-sm btn-primary" id="bd-go">Prepare packet</button></div>` : ''}
  </div>
  ${rows.map((b) => `
  <div class="panel">
    <div class="panel-title">${esc(b.period)} <span class="chip ${b.state === 'held' ? 'chip-ok' : 'chip-warn'}">${esc(b.state)}</span></div>
    ${preBody(b.packet || '⏳ preparing the packet…')}
    ${b.state === 'held' ? `<div class="map-legend"><b>Resolutions:</b> ${esc(b.resolutions)}</div>`
      : canM && b.packet ? `<div class="form-inline" style="margin-top:8px">
          <input id="bd-res-${b.id}" placeholder="resolutions taken by the board" style="width:60%">
          <button class="btn btn-sm btn-ok" data-hold="${b.id}">Record meeting held</button></div>` : ''}
  </div>`).join('') || '<div class="panel"><div class="empty">No board records yet.</div></div>'}`;
  wireXact(renderBoard);
  $('#bd-go')?.addEventListener('click', async () => {
    try { await api('/api/board', { method: 'POST', body: { period: $('#bd-period').value } }); toast('Preparing'); renderBoard(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-hold]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/board/${b.dataset.hold}/hold`, { method: 'POST', body: { resolutions: $(`#bd-res-${b.dataset.hold}`).value } }); toast('Recorded'); renderBoard(); }
    catch (e) { toast(e.message, true); }
  }));
}

async function renderComms() {
  const rows = await api('/api/comms');
  const canM = hasPermC('comms.manage');
  view.innerHTML = `
  <div class="panel"><div class="panel-title">Internal comms — the bulletin writes itself from the week's real events</div>
    ${canM ? xbtn('/api/comms', {}, 'Draft this week’s bulletin', 'btn-primary') : ''}
  </div>
  ${rows.map((b) => `
  <div class="panel">
    <div class="panel-title"><span>Week of ${esc(b.week)} <span class="chip ${b.state === 'published' ? 'chip-ok' : 'chip-warn'}">${esc(b.state)}</span></span>
      <span>${canM && b.state === 'draft' && b.body ? xbtn(`/api/comms/${b.id}/publish`, {}, 'Publish', 'btn-ok') : ''}</span></div>
    ${preBody(b.body || '⏳ the editor is reading the audit chain…')}
  </div>`).join('') || '<div class="panel"><div class="empty">No bulletins yet.</div></div>'}`;
  wireXact(renderComms);
}

// ---------- Owner console ----------
async function renderOwner() {
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
    try { await api('/api/settings', { method: 'POST', body: { key: 'CRUCIBLE_MOCK', value: settings.mockForced ? null : 'true' } }); toast(settings.mockForced ? 'Live models re-enabled' : 'Mock mode on — no further model spend'); renderOwner(); }
    catch (e) { toast(e.message, true); }
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
