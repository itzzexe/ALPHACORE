// Crucible Core console — vanilla SPA, hash routing, 5s polling on live pages.
import { t, lang, setLang, applyLang, translateDom, sectionName, divisionName, DIV_AR } from '/i18n.js';

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
  workstreams: 'workstreams.view', workstream: 'workstreams.view', auditor: 'auditor.view', sprints: 'sprints.view',
  memory: 'memory.view', chat: 'chat.view', treasury: 'treasury.view',
  money: 'money.view', contact: 'contact.view', mkt: 'marketing.view',
  connectors: 'connectors.view', egress: 'egress.view', vault: 'vault.manage',
  web: 'web.view', mcp: 'mcp.view', jobs: 'jobs.view',
  constitution: 'constitution.view', provenance: 'provenance.view',
  timemachine: 'timemachine.view', simulation: 'simulation.view',
  skills: 'skills.view', redteam: 'redteam.view', kgraph: 'graph.view',
  revenue: 'revenue.view',
};

// ---------- shell v2: rail + flyout + command palette ----------
// The navigation is generated from the same catalogue the map draws, so a new
// department appears in the rail, the flyout and the palette the moment it is
// declared server-side — one source of truth, no list to forget to update.
const DIV_ORDER = ['engine', 'world', 'build', 'decide', 'data', 'create', 'commerce', 'capital', 'operate', 'talent', 'trust', 'exec', 'govern'];
const DIV_ICON = {
  engine: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  build: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
  decide: '<path d="M12 3v18M5 7h14"/><path d="M5 7l-2.5 6h5zM19 7l-2.5 6h5z"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  create: '<path d="M4 20l3.5-9 9-3.5L20 4"/><path d="M14 6l4 4"/><circle cx="7" cy="17" r="1.6"/>',
  commerce: '<path d="M3 7h13l-1.5 8H6z"/><circle cx="8" cy="19" r="1.4"/><circle cx="15" cy="19" r="1.4"/><path d="M3 7L2 4"/>',
  capital: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.7-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2"/>',
  operate: '<path d="M3 12h4l2.5 6 5-14 2.5 8h4"/>',
  talent: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
  trust: '<path d="M12 3l7.5 3v6c0 4.4-3 8.2-7.5 9.5C7.5 20.2 4.5 16.4 4.5 12V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  exec: '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"/>',
  govern: '<path d="M12 3l8 4v5c0 4.5-3.3 8.4-8 9.5-4.7-1.1-8-5-8-9.5V7z"/><path d="M12 8v5M12 15.5v.5"/>',
  // A globe with a door in it: everything that reaches past the front door.
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5S14.5 18.4 12 20.5c-2.5-2.1-3.8-5.4-3.8-8.5S9.5 6.1 12 3.5z"/>',
};
let CATALOG = { sections: [], divisions: [] };
let openDiv = null;

function railBtn(id, label, count = '') {
  return `<button class="rail-btn" type="button" data-div="${id}" aria-label="${esc(label)}">
    <svg viewBox="0 0 24 24">${DIV_ICON[id] || DIV_ICON.govern}</svg>
    <span class="rail-dot">${count || ''}</span>
    <span class="rail-tip">${esc(label)}</span>
  </button>`;
}

const routeOf = (href) => String(href || '').replace(/^#\//, '').split('/')[0];
const visibleSections = () => CATALOG.sections.filter((s) => {
  const perm = navPerm[routeOf(s.href)];
  return !perm || hasPermC(perm);
});

function buildRail() {
  const host = $('#rail-items');
  if (!host) return;
  const divs = DIV_ORDER.filter((d) => visibleSections().some((s) => s.division === d));
  host.innerHTML = divs.map((d) => {
    const meta = CATALOG.divisions.find((x) => x.id === d);
    return railBtn(d, divisionName(d, meta?.label || d));
  }).join('');
  host.querySelectorAll('[data-div]').forEach((b) => b.addEventListener('click', () => toggleDiv(b.dataset.div)));
  markActiveNav();
}

function toggleDiv(id) {
  openDiv = openDiv === id ? null : id;
  renderFlyout();
}

function renderFlyout() {
  const fly = $('#flyout');
  const app = $('#app');
  if (!fly) return;
  if (!openDiv) { fly.hidden = true; app.classList.remove('nav-open'); markActiveNav(); return; }
  const meta = CATALOG.divisions.find((x) => x.id === openDiv);
  const list = visibleSections().filter((s) => s.division === openDiv);
  fly.innerHTML = `<div class="flyout-head" style="color:${meta?.color || 'var(--ink-faint)'}">
      <span>${esc(divisionName(openDiv, meta?.label || openDiv))}</span><span class="fh-count">${list.length}</span></div>
    ${list.map((s) => `<a href="${s.href}" data-route="${routeOf(s.href)}">
      <span>${esc(sectionName(s.id, s.label))}</span><span class="fly-n">${s.count}</span></a>`).join('')}`;
  fly.hidden = false;
  app.classList.add('nav-open');
  markActiveNav();
}

function markActiveNav() {
  const here = currentRoute().key;
  document.querySelectorAll('#flyout a').forEach((a) => a.classList.toggle('active', a.dataset.route === here));
  const sec = CATALOG.sections.find((s) => routeOf(s.href) === here);
  document.querySelectorAll('#rail-items .rail-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.div === (openDiv || sec?.division));
  });
}

async function loadCatalog() {
  try {
    const map = await api('/api/map');
    CATALOG = { sections: map.sections, divisions: map.divisions };
  } catch {
    // A user without dashboard.view still needs to move around.
    CATALOG = { sections: Object.keys(navPerm).filter((k) => k).map((k) => ({ id: k, label: k, division: 'govern', href: `#/${k}`, count: '' })), divisions: [] };
  }
  buildRail();
}

// ---------- command palette ----------
let palIndex = 0;
let palHits = [];
function openPalette() {
  const p = $('#palette');
  p.hidden = false;
  const input = $('#pal-input');
  input.value = '';
  input.focus();
  palFilter('');
}
function closePalette() { $('#palette').hidden = true; }
function palFilter(qv) {
  const q = qv.trim().toLowerCase();
  const all = visibleSections().map((s) => ({
    ...s, ar: sectionName(s.id, ''), div: CATALOG.divisions.find((d) => d.id === s.division),
  }));
  palHits = (!q ? all : all.filter((s) => `${s.label} ${s.ar} ${s.id} ${s.hint || ''}`.toLowerCase().includes(q))).slice(0, 40);
  palIndex = 0;
  const list = $('#pal-list');
  list.innerHTML = palHits.length ? palHits.map((s, i) => `
    <div class="pal-item ${i === 0 ? 'sel' : ''}" data-href="${s.href}" data-i="${i}">
      <span class="pal-title">${esc(sectionName(s.id, s.label))}</span>
      <span class="pal-div" style="color:${s.div?.color || ''}">${esc(divisionName(s.division, s.div?.label || ''))}</span>
    </div>`).join('') : `<div class="pal-empty">${esc(t('Nothing found'))}</div>`;
  list.querySelectorAll('.pal-item').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.href; closePalette(); }));
}
function palMove(step) {
  if (!palHits.length) return;
  palIndex = (palIndex + step + palHits.length) % palHits.length;
  const items = [...document.querySelectorAll('.pal-item')];
  items.forEach((el, i) => el.classList.toggle('sel', i === palIndex));
  items[palIndex]?.scrollIntoView({ block: 'nearest' });
}

function initShell() {
  $('#open-palette')?.addEventListener('click', openPalette);
  $('#rail-search')?.addEventListener('click', openPalette);
  $('#pal-input')?.addEventListener('input', (e) => palFilter(e.target.value));
  $('#palette')?.addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ($('#palette').hidden) return;
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
    else if (e.key === 'Enter') { const h = palHits[palIndex]; if (h) { location.hash = h.href; closePalette(); } }
  });

  // Theme: explicit choice wins, otherwise the operating system decides.
  const savedTheme = localStorage.getItem('crucible-theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#theme-toggle')?.addEventListener('click', () => {
    const now = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = now === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('crucible-theme', next);
  });

  const flipLang = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
    location.reload(); // renderers bake their language in at build time
  };
  $('#lang-toggle')?.addEventListener('click', flipLang);
  $('#login-lang')?.addEventListener('click', flipLang);
  $('#lang-toggle') && ($('#lang-toggle').textContent = lang === 'ar' ? 'EN' : 'ع');

  $('#who-chip')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* session gone anyway */ }
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
  applyLang();
}

function paintUser() {
  if (!currentUser) return;
  $('#who-avatar').textContent = (currentUser.displayName || currentUser.username).slice(0, 1).toUpperCase();
  $('#who-name').textContent = currentUser.displayName || currentUser.username;
  $('#who-role').textContent = currentUser.isOwner ? t('Owner') || 'Owner' : currentUser.role;
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
    const cc = $('#chain-chip');
    cc.textContent = chain.ok ? `${t('chain —').replace('—', '')}✓ ${chain.checked}` : `chain BROKEN @${chain.brokenAt}`;
    cc.className = 'chip ' + (chain.ok ? 'chip-ok' : 'chip-bad');
    cc.title = health.mockMode ? 'MOCK MODE — no provider keys' : 'LIVE';
    // Everything waiting on a person surfaces on the rail, so a blocked item
    // is visible from any page without opening a menu.
    const waiting = stats.inboxTotal || stats.awaitingHuman || 0;
    const dot = document.querySelector('[data-div="decide"] .rail-dot');
    if (dot) dot.textContent = waiting || '';
    const alerts = notif.unread || 0;
    const gdot = document.querySelector('[data-div="govern"] .rail-dot');
    if (gdot) gdot.textContent = alerts || '';
    const jdot = document.querySelector('[data-div="build"] .rail-dot');
    if (jdot) jdot.textContent = journeys.filter((j) => j.state === 'awaiting_human').length || '';
  } catch { /* server restarting */ }
}
setInterval(refreshShell, 7000);

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
  workstreams: { title: 'Workstreams — work that goes around', render: renderWorkstreams, poll: 5000 },
  workstream: { title: 'Workstream', render: renderWorkstreamDetail, poll: 4000 },
  auditor: { title: 'AI Auditor — one standard for every department', render: renderAuditor, poll: 5000 },
  sprints: { title: 'Sprints — Scrum over the task tracker', render: renderSprints, poll: 8000 },
  memory: { title: 'Agent memory — how the workforce stops repeating itself', render: renderMemory, poll: 10000 },
  chat: { title: 'The floor — humans and the AI workforce in one room', render: renderChat, poll: 4000 },
  treasury: { title: 'Treasury — the company gets paid in crypto', render: renderTreasury, poll: 10000 },
  mkt: { title: 'Marketing — the whole department', render: renderMarketingDept, poll: 8000 },
  money: { title: 'Money desk — position, runway, allocation', render: renderMoney, poll: 15000 },
  contact: { title: 'Contact centre — calls and messages', render: renderContact, poll: 6000 },
  // The outside world.
  connectors: { title: 'Integrations — every service the company can reach', render: renderConnectors, poll: 10000 },
  egress: { title: 'The gate — every attempt to touch anything outside', render: renderEgress, poll: 5000 },
  vault: { title: 'The vault — credentials, encrypted at rest', render: renderVault },
  web: { title: 'The open web — fetch, search, browse', render: renderWeb, poll: 10000 },
  mcp: { title: 'MCP — outside tools in, this company out', render: renderMcp, poll: 10000 },
  jobs: { title: 'The queue — work that survives a dropped line', render: renderJobs, poll: 4000 },
  constitution: { title: 'The constitution — the rules, enforced by machine', render: renderConstitution },
  provenance: { title: 'Provenance — a signed receipt for everything made here', render: renderProvenance, poll: 15000 },
  timemachine: { title: 'Time machine — stand at any hour of the company', render: renderTimeMachine, poll: 20000 },
  simulation: { title: 'Shadow company — fork reality and ask', render: renderSimulation },
  skills: { title: 'Skill market — how the workforce gets better', render: renderSkills, poll: 15000 },
  redteam: { title: 'Red team — we attack ourselves first', render: renderRedteam, poll: 20000 },
  kgraph: { title: 'Knowledge graph — everything about one thing, in one hop', render: renderKnowledgeGraph, poll: 20000 },
  revenue: { title: 'Revenue loop — a name on a list to money in the account', render: renderRevenue, poll: 8000 },
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
  if (seg === 'workstreams' && arg) return { key: 'workstream', arg };
  if (seg === 'artifacts' && arg) return { key: 'artifacts', arg: decodeURIComponent(arg) };
  return { key: routes[seg] ? seg : '', arg: null };
}

async function navigate() {
  clearInterval(pollTimer);
  showPollState(false);
  if (!currentUser) return;
  const { key, arg } = currentRoute();
  const r = routes[key];
  const sec = CATALOG.sections.find((s) => routeOf(s.href) === key);
  $('#page-title').textContent = sec ? sectionName(sec.id, r.title) : t(r.title);
  document.title = `${$('#page-title').textContent} · Crucible Core`;
  const perm = navPerm[key];
  if (perm && !hasPermC(perm)) {
    view.innerHTML = `<div class="panel"><div class="empty">You need the <span class="mono" style="color:var(--warn)">${esc(perm)}</span> permission for this section — ask the superadmin.</div></div>`;
    return;
  }
  markActiveNav();
  view.innerHTML = `<div class="empty">${esc(t('Loading…'))}</div>`;
  try { await r.render(arg); translateDom(view); }
  catch (e) { view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
  if (r.poll) {
    pollTimer = setInterval(() => {
      // Never re-render out from under someone who is typing.
      if (pollPaused()) { showPollState(true); return; }
      showPollState(false);
      r.render(arg).then(() => translateDom(view)).catch(() => {});
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
    if (e.from === e.to) return selfLoop(a, i, e, a.color);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const bx = mx + (CX - mx) * 0.45, by = my + (CY - my) * 0.45;
    const w = e.count ? 1 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 3.2 : 0.8;
    return `<path class="cx-edge ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
      d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"
      stroke="${a.color}" stroke-width="${w.toFixed(2)}"${edgeAttrs(e)} fill="none"><title>${esc(e.from)} → ${esc(e.to)}: ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  // Universal edges (everything → audit, everything → archive) are drawn as
  // faint spokes to the core rather than 45 individual lines.
  const spokes = Object.values(pos).map((p) =>
    `<line class="cx-spoke" data-spoke="${esc(p.s.id)}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${CX}" y2="${CY}"/>`).join('');

  const nodes = Object.values(pos).map((p) => {
    const r = nodeR(p.s.count);
    return `<a href="${p.s.href}" data-node="${esc(p.s.id)}" data-color="${p.color}" data-label="${esc(sectionName(p.s.id, p.s.label))}"
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
    <defs>${MAP_DEFS}
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
        <div class="tip-val">${esc(a.dataset.count)} ${id === 'harmony' ? 'harmony score' : 'records'}${a.dataset.div ? ` · ${esc(a.dataset.div)}` : ''}</div>
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

// ---------- how a relationship is drawn ----------
// Five kinds of movement, five readings. Without this every line looked like
// a hand-off, so the loops — the part that makes the work actually improve —
// were invisible.
const EDGE_KIND = {
  flow: {
    dash: null, marker: 'arrow', label: 'hand-off',
    how: 'Work moves forward: the source department finishes something and the target picks it up. The number is how many times this has actually happened, counted straight from the database — not a diagram of intent.',
  },
  loop: {
    dash: '7 5', marker: 'arrow-back', label: 'sent back to improve',
    how: 'The return path. Work that did not clear the bar goes back carrying every finding with it, and the next round must address them. This is the line that makes output improve instead of merely ship.',
  },
  review: {
    dash: '2 5', marker: 'arrow', label: 'independent peer review',
    how: 'A second opinion from someone who did not do the work. Reviewers are chosen to exclude the producer, and where possible from a different model family, so a mistake is not confirmed by the mind that made it.',
  },
  audit: {
    dash: '10 4 2 4', marker: 'diamond', label: 'audit verdict',
    how: 'One independent auditor judges output from every department against the same criteria and returns a score plus concrete findings. A failing verdict blocks the work and opens the return path.',
  },
  gate: {
    dash: '1 6', marker: 'gate', label: 'stops for a human',
    how: 'A hard stop. The machine prepares, a named person decides, and the decision is written to the hash chain with their name on it. Nothing crosses this line automatically.',
  },
  memory: {
    dash: '4 3', marker: 'arrow', label: 'memory recalled / kept',
    how: 'Experience moving in and out of storage: finished work leaves an episode behind, and future work retrieves what is relevant before it starts — so the same mistake is not made twice.',
  },
};
const edgeAttrs = (e) => {
  const k = EDGE_KIND[e.kind] || EDGE_KIND.flow;
  return `${k.dash ? ` stroke-dasharray="${k.dash}"` : ''} marker-end="url(#mk-${k.marker})" data-kind="${esc(e.kind || 'flow')}"`;
};
// Markers inherit the trace colour via context-stroke, so a copper line keeps
// a copper arrowhead without generating one marker per division.
const MAP_DEFS = `
  <marker id="mk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M0 1L9 5L0 9z" fill="context-stroke"/></marker>
  <marker id="mk-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
    <path d="M0 1L9 5L0 9z" fill="context-stroke"/><path d="M9 2v6" stroke="context-stroke" stroke-width="1.4"/></marker>
  <marker id="mk-diamond" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
    <path d="M0 5L5 1L10 5L5 9z" fill="context-stroke"/></marker>
  <marker id="mk-gate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
    <rect x="2" y="1" width="6" height="8" rx="1" fill="none" stroke="context-stroke" stroke-width="1.6"/></marker>`;

/** A relationship that returns to its own department: the revision loop. */
const selfLoop = (p, i, e, color) => {
  const r = 26;
  const d = `M ${p.x + 20} ${p.y - 4} a ${r} ${r} 0 1 1 ${r * 1.4} 6`;
  return `<path class="cx-edge live" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
    d="${d}" stroke="${color}" stroke-width="2"${edgeAttrs(e)} fill="none"/>
    <path class="cx-hit" data-edgehit="${i}" d="${d}" fill="none"><title>${esc(e.label)} (${e.count})</title></path>`;
};

const flowLegend = (flow) => !flow ? '' : `
  <div class="flow-legend">
    ${Object.entries(EDGE_KIND).map(([k, v]) => `<span class="fl-k fl-${k}"><i></i>${esc(t(v.label))}</span>`).join('')}
    <span class="fl-stats">${flow.rounds} ${esc(t('rounds'))} · ${flow.revisions} ${esc(t('sent back'))} · ${flow.handoffs} ${esc(t('hand-offs across'))} ${flow.departmentsTouched} ${esc(t('departments'))} ·
      ${flow.peerReviews} ${esc(t('peer reviews by'))} ${flow.reviewersInvolved} ${esc(t('reviewers'))} · ${flow.audits} ${esc(t('audits over'))} ${flow.auditedDepartments} ${esc(t('departments'))} ·
      ${flow.humanGates} ${esc(t('human rulings'))} · ${flow.memoryRecalls} ${esc(t('memory recalls'))}</span>
  </div>`;

// ---------- map style switcher ----------
// Two maps, not six. The Hive answers "what is this company and how is it
// joined together"; the Stream answers "where is the work right now". Six
// variations on the first question were five too many, and none of them
// answered the second.
// Both are driven by the same /api/map payload and share one interaction
// engine (initAtlas): click opens the department, right-click opens its
// connection ledger and trace, clicking a line explains the relationship,
// drag/wheel pans and zooms, and the live ticker + pings work in both.
const MAP_STYLES = [
  ['hive', 'The Hive', '⬡', 'Every department as a cell, grouped into districts — hover one to see only what it touches'],
  ['stream', 'The Stream', '⇄', 'Where work actually is: intake to produce to review to audit to the gate, loops included'],
];
// Anyone who used the old maps has a dead style name in localStorage; only the
// two that exist now are honoured.
const mapStyle = () => {
  const s = localStorage.getItem('crucible-map-style');
  return MAP_STYLES.some((m) => m[0] === s) ? s : 'hive';
};
function buildMap(m) {
  const s = mapStyle();
  if (atlasState.style !== s) {
    atlasState.style = s;
    atlasState.vb = null; atlasState.sel = null; atlasState.traceFrom = null; atlasState.divSel = null;
  }
  return s === 'stream' ? buildStream(m) : buildHive(m);
}

// ---------- map I · The Hive ----------
// Eighty-one departments drawn as hexagonal cells packed into twelve districts.
// Two decisions carry this design:
//
//   1. Hexagons tile with no wasted space and six neighbours each, so a dense
//      company reads as a dense honeycomb rather than a scatter of boxes.
//   2. Relationships are NOT drawn by default. Two hundred lines at rest is
//      noise; the same lines revealed for one cell at a time is an answer.
//      Hover a cell and only its own connections appear.
function buildHive(map) {
  const { divisions, sections, edges, harmony, audit: connAudit, flow } = map;
  const R = 46;                       // hex radius
  const HW = Math.sqrt(3) * R;        // horizontal spacing
  const HV = R * 1.5;                 // vertical spacing
  const byDiv = Object.fromEntries(divisions.map((d) => [d.id, { ...d, items: [] }]));
  for (const s of sections) {
    if (s.id === 'harmony') continue;
    (byDiv[s.division] || byDiv.govern).items.push(s);
  }
  const divs = divisions.filter((d) => byDiv[d.id].items.length);

  // Districts sit on a ring around the core, each one a compact hex block.
  const CX = 980, CY = 700;
  const cell = {};
  const districts = [];

  // A fixed ring cannot hold twelve districts of wildly different sizes: a
  // nine-cell block and a three-cell block placed at the same radius either
  // collide or leave a hole. So each district is measured first, seeded on an
  // alternating inner/outer ring, and then pushed apart until nothing overlaps
  // anything — including the core and each other's name plates.
  const LABEL_BAND = 44;                // room above a block for its name
  const GAP = 22;                       // breathing space between districts
  const plan = divs.map((d, di) => {
    const items = byDiv[d.id].items;
    const cols = items.length > 8 ? 3 : items.length > 3 ? 2 : 1;
    const rows = Math.ceil(items.length / cols);
    // Offsets of every cell relative to the block origin, measured exactly —
    // odd rows are nudged half a hex, so the extents are not symmetric.
    const offs = items.map((s, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      return { s, dx: (col - (cols - 1) / 2) * HW + (row % 2 ? HW / 2 : 0), dy: (row - (rows - 1) / 2) * HV };
    });
    const left = Math.min(...offs.map((o) => o.dx)) - R;
    const right = Math.max(...offs.map((o) => o.dx)) + R;
    const top = Math.min(...offs.map((o) => o.dy)) - R - LABEL_BAND;
    const bottom = Math.max(...offs.map((o) => o.dy)) + R;
    const ang = (di / divs.length) * Math.PI * 2 - Math.PI / 2;
    const ring = di % 2 ? 715 : 455;
    return {
      d, items, offs, left, right, top, bottom, ang,
      x: CX + Math.cos(ang) * ring * 1.06,
      y: CY + Math.sin(ang) * ring * 0.72,
    };
  });

  const CORE = 170;                     // keep the Harmony hexagon clear
  for (let pass = 0; pass < 220; pass++) {
    let moved = false;
    for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        const a = plan[i], b = plan[j];
        const ox = Math.min(a.x + a.right, b.x + b.right) - Math.max(a.x + a.left, b.x + b.left) + GAP;
        const oy = Math.min(a.y + a.bottom, b.y + b.bottom) - Math.max(a.y + a.top, b.y + b.top) + GAP;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Separate along the cheaper axis — it keeps the ring recognisable
        // instead of flinging blocks diagonally across the canvas.
        const s = (ox < oy ? ox : oy) / 2 + 0.5;
        if (ox < oy) { const dir = a.x <= b.x ? -1 : 1; a.x += dir * s; b.x -= dir * s; }
        else { const dir = a.y <= b.y ? -1 : 1; a.y += dir * s; b.y -= dir * s; }
      }
      // Push out of the core, then off the canvas edges.
      const p = plan[i];
      const dx = p.x - CX, dy = p.y - CY, dist = Math.hypot(dx, dy) || 1;
      const need = CORE + Math.max(Math.abs(p.left), p.right, Math.abs(p.top), p.bottom) * 0.55;
      if (dist < need) { p.x = CX + (dx / dist) * need; p.y = CY + (dy / dist) * need; moved = true; }
    }
    if (!moved) break;
  }

  // Re-centre whatever the relaxation produced, then lay the cells down.
  const span = {
    x0: Math.min(...plan.map((p) => p.x + p.left)), x1: Math.max(...plan.map((p) => p.x + p.right)),
    y0: Math.min(...plan.map((p) => p.y + p.top)), y1: Math.max(...plan.map((p) => p.y + p.bottom)),
  };
  const shiftX = CX - (span.x0 + span.x1) / 2, shiftY = CY - (span.y0 + span.y1) / 2;
  // Relaxation settles into a square, but the map lives in a wide panel — a
  // square viewBox would letterbox and shrink every label. Spreading the
  // districts sideways only ever widens the gaps between them, so it is safe.
  const aspect = (span.x1 - span.x0) / (span.y1 - span.y0);
  const stretch = Math.min(2.1, Math.max(1, 1.95 / aspect));
  for (const p of plan) {
    const ox = CX + (p.x + shiftX - CX) * stretch, oy = p.y + shiftY;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const o of p.offs) {
      const x = ox + o.dx, y = oy + o.dy;
      cell[o.s.id] = { x, y, color: p.d.color, div: p.d.id, s: o.s };
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
    districts.push({ ...p.d, n: p.items.length, ...box, labelX: ox, labelY: box.y0 - R - 26 });
  }

  const hexPath = (x, y) => {
    const p = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      p.push(`${(x + R * Math.cos(a)).toFixed(1)} ${(y + R * Math.sin(a)).toFixed(1)}`);
    }
    return `M ${p.join(' L ')} Z`;
  };

  // Links are laid down once but start invisible; the interaction layer lights
  // the ones belonging to whatever you point at.
  const maxCount = Math.max(...edges.map((e) => e.count), 1);
  const links = edges.map((e, i) => {
    const a = cell[e.from]; const b = cell[e.to];
    if (!a || !b || e.from === e.to) return '';
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    const bx = mx + (CX - mx) * 0.42; const by = my + (CY - my) * 0.42;
    const w = e.count ? 1.2 + (Math.log10(e.count + 1) / Math.log10(maxCount + 1)) * 3 : 0.8;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    return `<path class="cx-edge hv-link ${e.count ? 'live' : 'dormant'}" data-edge="${i}" data-a="${esc(e.from)}" data-b="${esc(e.to)}"
      d="${d}" stroke="${a.color}" stroke-width="${w.toFixed(2)}"${edgeAttrs(e)} fill="none"/>
      <path class="cx-hit" data-edgehit="${i}" d="${d}" fill="none"><title>${esc(e.from)} → ${esc(e.to)} · ${esc(e.label)} (${e.count})</title></path>`;
  }).join('');

  const districtShapes = districts.map((d) => `
    <rect class="hv-district" data-divlabel="${esc(d.id)}" rx="34"
      x="${(d.x0 - R - 16).toFixed(1)}" y="${(d.y0 - R - 14).toFixed(1)}"
      width="${(d.x1 - d.x0 + R * 2 + 32).toFixed(1)}" height="${(d.y1 - d.y0 + R * 2 + 28).toFixed(1)}"
      stroke="${d.color}"/>
    <text class="hv-dname" data-divlabel="${esc(d.id)}" x="${d.labelX.toFixed(1)}" y="${d.labelY.toFixed(1)}" fill="${d.color}">
      ${esc(divisionName(d.id, d.label))}<tspan class="hv-dn"> ${d.n}</tspan></text>`).join('');

  // Wrap on words to the width a hexagon actually has, rather than cutting at
  // a fixed character count — "Marketing depar…" told you nothing.
  const wrapCell = (label) => {
    const out = [];
    for (const w of String(label).split(/\s+/)) {
      if (out.length && (out[out.length - 1] + ' ' + w).length <= 11) out[out.length - 1] += ' ' + w;
      else out.push(w);
    }
    if (out.length > 2) return [out[0], short(out.slice(1).join(' '), 11)];
    return [out[0] || '', out[1] || ''];
  };
  const cells = Object.values(cell).map((c) => {
    const label = sectionName(c.s.id, c.s.label);
    const [line1, line2] = wrapCell(label);
    return `<a href="${c.s.href}" data-node="${esc(c.s.id)}" data-color="${c.color}" data-label="${esc(label)}"
      data-hint="${esc(c.s.hint)}" data-count="${c.s.count}" data-div="${esc(c.div)}" style="color:${c.color}">
      <g class="hv-cell">
        <path class="hv-hex" d="${hexPath(c.x, c.y)}" stroke="${c.color}"/>
        <path class="hv-glow" d="${hexPath(c.x, c.y)}" stroke="${c.color}"/>
        <text class="hv-label" x="${c.x.toFixed(1)}" y="${(c.y - (line2 ? 6 : 1)).toFixed(1)}">${esc(short(line1, 13))}</text>
        ${line2 ? `<text class="hv-label" x="${c.x.toFixed(1)}" y="${(c.y + 9).toFixed(1)}">${esc(line2)}</text>` : ''}
        <text class="hv-count" x="${c.x.toFixed(1)}" y="${(c.y + (line2 ? 26 : 20)).toFixed(1)}">${c.s.count}</text>
        <circle class="hv-led ${c.s.count > 0 ? 'on' : ''}" cx="${c.x.toFixed(1)}" cy="${(c.y - R + 13).toFixed(1)}" r="2.6"/>
      </g></a>`;
  }).join('');

  const hs = harmony?.score ?? 0;
  const hsColor = hs >= 80 ? 'var(--ok)' : hs >= 55 ? 'var(--warn)' : 'var(--bad)';
  const coreHex = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(CX + 118 * Math.cos(a)).toFixed(1)} ${(CY + 118 * Math.sin(a)).toFixed(1)}`;
  }).join(' L ');

  // The relaxation decides how wide the hive ends up, so the frame follows it
  // rather than the other way round — no clipped district, no dead margin.
  const PAD = 56;
  const vb = {
    x0: Math.min(...districts.map((d) => d.x0 - R), CX - 400) - PAD,
    x1: Math.max(...districts.map((d) => d.x1 + R), CX + 400) + PAD,
    y0: Math.min(...districts.map((d) => d.y0 - R - LABEL_BAND), CY - 400) - PAD,
    y1: Math.max(...districts.map((d) => d.y1 + R), CY + 400) + PAD + 30,
  };
  return `<svg class="constellation atlas hive" viewBox="${vb.x0.toFixed(0)} ${vb.y0.toFixed(0)} ${(vb.x1 - vb.x0).toFixed(0)} ${(vb.y1 - vb.y0).toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="The Hive — every department as a cell, grouped into districts">
    <defs>${MAP_DEFS}
      <radialGradient id="hiveGlow"><stop offset="0%" stop-color="rgba(255,122,60,0.16)"/><stop offset="100%" stop-color="rgba(255,122,60,0)"/></radialGradient>
    </defs>
    <circle cx="${CX}" cy="${CY}" r="360" fill="url(#hiveGlow)"/>
    ${districtShapes}${links}${cells}
    <a href="#/harmony" data-node="harmony" data-color="#ff7a3c" data-label="HARMONY"
       data-hint="The orchestrator. Every district is wired to this cell; hover it to see the whole reach at once."
       data-count="${hs}" data-div="govern" style="color:#ff7a3c">
      <g class="hv-core">
        <path class="hv-corehex" d="M ${coreHex} Z" stroke="${hsColor}"/>
        <path class="hv-corepulse" d="M ${coreHex} Z" stroke="${hsColor}"/>
        <text class="cx-core-glyph" x="${CX}" y="${CY - 22}">▲</text>
        <text class="cx-core-score" x="${CX}" y="${CY + 14}" fill="${hsColor}">${hs}%</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 34}">HARMONY</text>
        <text class="cx-core-sub" x="${CX}" y="${CY + 50}">${connAudit.wired}/${connAudit.sections} WIRED</text>
      </g>
    </a>
    <text class="silk" x="${(vb.x0 + 24).toFixed(0)}" y="${(vb.y1 - 16).toFixed(0)}">${sections.length} ${esc(t('DEPARTMENTS'))} · ${divs.length} ${esc(t('DISTRICTS'))} · ${edges.length} ${esc(t('RELATIONSHIPS'))}${flow ? ` · ${flow.rounds} ${esc(t('ROUNDS RUN'))}` : ''}</text>
  </svg>`;
}

// ---------- map II · The Stream ----------
// Not what the company is — what it is doing. Six stages left to right, the
// real volume between them, and the two arcs that matter most: work sent back
// to be improved, and work stopped for a person. Both drawn above the flow so
// they cannot be mistaken for progress.
function buildStream(map) {
  const { edges, flow, sections, harmony } = map;
  const S = Object.fromEntries(sections.map((s) => [s.id, s]));
  const n = (id) => S[id]?.count ?? 0;
  const kindTotal = (kind) => edges.filter((e) => e.kind === kind).reduce((a, e) => a + e.count, 0);

  const STAGES = [
    { id: 'intake', label: 'Intake', sub: 'requests · chat · orchestrator', value: n('requests') + n('chat'), sections: ['requests', 'chat', 'harmony'], color: '#ff7a3c' },
    { id: 'produce', label: 'Produce', sub: 'employees do the work', value: n('runs'), sections: ['runs', 'workstreams', 'pipelines', 'tasks'], color: '#b78bff' },
    { id: 'review', label: 'Peer review', sub: 'someone who did not write it', value: flow?.peerReviews ?? kindTotal('review'), sections: ['quality', 'agents'], color: '#5ec3c9' },
    { id: 'audit', label: 'Audit', sub: 'one standard, every department', value: flow?.audits ?? kindTotal('audit'), sections: ['auditor', 'evals'], color: '#e3a63c' },
    { id: 'gate', label: 'Human gate', sub: 'a person decides', value: flow?.humanGates ?? n('gate'), sections: ['gate', 'oversight'], color: '#f0685a' },
    { id: 'land', label: 'Landed', sub: 'shipped · archived · on the chain', value: n('archive'), sections: ['archive', 'artifacts', 'audit'], color: '#6fc487' },
  ];
  const W = 1720, H = 780, X0 = 90, GAP = (W - X0 * 2) / (STAGES.length - 1), MID = 420;
  const max = Math.max(...STAGES.map((s) => s.value), 1);
  const height = (v) => 26 + (Math.log10(v + 1) / Math.log10(max + 1)) * 210;

  const nodes = STAGES.map((s, i) => {
    const x = X0 + i * GAP;
    const h = height(s.value);
    return { ...s, x, h, y0: MID - h / 2, y1: MID + h / 2 };
  });

  // Ribbons between consecutive stages, thickness carried by the smaller end.
  const ribbons = nodes.slice(0, -1).map((a, i) => {
    const b = nodes[i + 1];
    const t = Math.min(a.h, b.h) * 0.82;
    const ay0 = MID - t / 2, ay1 = MID + t / 2;
    const c1 = a.x + 76, c2 = b.x - 76;
    return `<path class="st-ribbon" d="M ${a.x + 74} ${ay0} C ${c1 + 60} ${ay0}, ${c2 - 60} ${ay0}, ${b.x - 74} ${ay0}
      L ${b.x - 74} ${ay1} C ${c2 - 60} ${ay1}, ${c1 + 60} ${ay1}, ${a.x + 74} ${ay1} Z"
      fill="url(#grad${i})"/>
      <path class="st-spark" d="M ${a.x + 74} ${MID} C ${c1 + 60} ${MID}, ${c2 - 60} ${MID}, ${b.x - 74} ${MID}" stroke="${b.color}"/>`;
  }).join('');

  const grads = nodes.slice(0, -1).map((a, i) => `
    <linearGradient id="grad${i}" x1="0" x2="1">
      <stop offset="0%" stop-color="${a.color}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${nodes[i + 1].color}" stop-opacity="0.30"/>
    </linearGradient>`).join('');

  const pillars = nodes.map((s) => `
    <a href="${S[s.sections[0]]?.href || '#/'}" data-node="${esc(s.sections[0])}" data-color="${s.color}"
       data-label="${esc(t(s.label))}" data-hint="${esc(t(s.sub))}" data-count="${s.value}" style="color:${s.color}">
      <g class="st-stage">
        <rect class="st-pillar" x="${s.x - 74}" y="${s.y0.toFixed(1)}" width="148" height="${s.h.toFixed(1)}" rx="16" stroke="${s.color}"/>
        <text class="st-num" x="${s.x}" y="${(MID + 8).toFixed(1)}" fill="${s.color}">${s.value}</text>
        <text class="st-label" x="${s.x}" y="${(s.y1 + 34).toFixed(1)}">${esc(t(s.label))}</text>
        <text class="st-sub" x="${s.x}" y="${(s.y1 + 52).toFixed(1)}">${esc(t(s.sub))}</text>
        <g class="st-chips">${s.sections.map((k, j) => S[k]
          ? `<text class="st-chip" x="${s.x}" y="${(s.y1 + 72 + j * 15).toFixed(1)}">${esc(sectionName(k, S[k].label))} · ${S[k].count}</text>` : '').join('')}
        </g>
      </g></a>`).join('');

  // The two arcs that are not progress.
  const loopFrom = nodes[3].x, loopTo = nodes[1].x;
  const sentBack = flow?.sentBack ?? 0;
  const revisions = flow?.revisions ?? 0;
  const gateStops = flow?.humanGates ?? 0;
  const arcs = `
    <path class="st-loop" d="M ${loopFrom} ${nodes[3].y0 - 12} C ${loopFrom - 120} ${MID - 320}, ${loopTo + 120} ${MID - 320}, ${loopTo} ${nodes[1].y0 - 12}"/>
    <text class="st-arclabel" x="${((loopFrom + loopTo) / 2).toFixed(1)}" y="${(MID - 296).toFixed(1)}">
      ${sentBack} ${esc(t('sent back to be improved'))} · ${revisions} ${esc(t('revision rounds run')).replace('rounds run', revisions === 1 ? 'round run' : 'rounds run')}
    </text>
    <path class="st-gatearc" d="M ${nodes[4].x} ${nodes[4].y1 + 96} C ${nodes[4].x - 60} ${MID + 300}, ${nodes[1].x + 60} ${MID + 300}, ${nodes[1].x} ${nodes[1].y1 + 96}"/>
    <text class="st-arclabel low" x="${((nodes[4].x + nodes[1].x) / 2).toFixed(1)}" y="${(MID + 318).toFixed(1)}">
      ${gateStops} ${esc(t('human rulings — rejected work returns to the maker')).replace('rulings', gateStops === 1 ? 'ruling' : 'rulings')}
    </text>`;

  const hs = harmony?.score ?? 0;
  return `<svg class="constellation atlas stream" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="The Stream — where work is right now, from intake to landed">
    <defs>${MAP_DEFS}${grads}</defs>
    ${ribbons}${arcs}${pillars}
    <text class="silk" x="34" y="${H - 22}">${esc(t('HARMONY'))} ${hs}% · ${flow?.departmentsTouched ?? 0} ${esc(t('DEPARTMENTS TOUCHED'))} · ${flow?.reviewersInvolved ?? 0} ${esc(t('REVIEWERS'))} · ${flow?.memoryRecalls ?? 0} ${esc(t('MEMORY RECALLS'))}</text>
    <text class="silk" x="${W - 34}" y="${H - 22}" text-anchor="end">${esc(t('WIDTH = REAL VOLUME · ARCS ABOVE AND BELOW ARE NOT PROGRESS'))}</text>
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
  // Clicking something on the map opens a real window over it, and while that
  // window is open the pointer belongs to the window — the map underneath does
  // not pan, zoom or drag. A panel docked inside the canvas kept stealing the
  // gestures meant for the panel itself.
  let dlg = document.getElementById('map-dialog');
  if (!dlg) {
    dlg = document.createElement('div');
    dlg.id = 'map-dialog';
    dlg.hidden = true;
    dlg.innerHTML = '<div class="md-box" role="dialog" aria-modal="true" tabindex="-1"></div>';
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
  // the <svg>, so a plain click on a section never reached the section.
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
      <span>${esc(t('The company as it actually is'))} — ${mapData ? `${mapData.sections.length} ${esc(t('sections'))} · ${mapData.edges.filter((e) => e.count > 0).length}/${mapData.edges.length} ${esc(t('relationships live'))}` : esc(t('system map'))}</span>
      <span>
        <span class="map-style-picker">${MAP_STYLES.map(([k, label, icon, hint]) =>
          `<button data-mapstyle="${k}" class="${mapStyle() === k ? 'on' : ''}" title="${esc(t(hint))}"><b>${icon}</b>${esc(t(label))}</button>`).join('')}</span>
        ${mapData ? `<span class="chip ${mapData.audit.orphans.length ? 'chip-bad' : 'chip-ok'}">${mapData.audit.wired}/${mapData.audit.sections} ${esc(t('wired'))}${mapData.audit.orphans.length ? ` · ${mapData.audit.orphans.length} ${esc(t('orphan'))}` : ` · ${esc(t('no orphans'))}`}</span>` : ''}
        <a class="chip chip-dim" style="text-decoration:none" href="#/graph">${esc(t('relationship table'))} →</a>
      </span>
    </div>
    ${mapData ? buildMap(mapData) : buildSystemMap(s, prov, agentsList, chain, extra)}
    ${flowLegend(mapData?.flow)}
    <div class="map-legend">${esc(t(mapStyle() === 'stream'
      ? 'The Stream: six stages of one piece of work. A pillar is as tall as the volume actually sitting in it, a ribbon as thick as the work crossing between two stages, and the two arcs are the paths that are not progress — work sent back to be improved, and rulings a person made.'
      : 'The Hive: one cell per department, cells grouped into the district that owns them, and the orchestrator in the middle. Relationships stay hidden until you point at a cell, because two hundred lines at once is noise and seven lines is an answer.'))}
      <b>${esc(t('Click'))}</b> ${esc(t('a cell to open that department'))} · <b>${esc(t('right-click'))}</b> ${esc(t('for everything it touches and a hop-by-hop'))} <b>${esc(t('Trace flow'))}</b> · <b>${esc(t('drag / wheel'))}</b> ${esc(t('pans and zooms'))} · ${esc(t('click a relationship line to read what kind of movement it is'))}.${mapData?.audit.orphans.length ? ` <b style="color:var(--bad)">${esc(t('Unwired'))}: ${mapData.audit.orphans.map((o) => o.label).join(', ')}</b>` : ''}</div>
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


// ===========================================================================
// THE OUTSIDE WORLD — the pages for everything that lets this company touch
// anything that is not itself.
// ===========================================================================

const verdictChip = (v) => `<span class="chip ${v === 'allowed' ? 'chip-ok' : v === 'blocked' ? 'chip-bad' : v === 'gated' ? 'chip-warn' : 'chip-dim'}">${esc(v)}</span>`;
const stateChip = (s) => `<span class="chip ${s === 'live' ? 'chip-ok' : s === 'dry' ? 'chip-warn' : s === 'paused' ? 'chip-bad' : 'chip-dim'}">${esc(s)}</span>`;

// ---------- Integrations ----------
async function renderConnectors() {
  const d = await api('/api/connectors');
  const canM = hasPermC('connectors.manage');
  const row = (c) => `
    <tr>
      <td><b>${esc(c.label)}</b><div class="sub mono">${esc(c.id)}</div></td>
      <td>${stateChip(c.state)}</td>
      <td class="mono">${esc(c.driverInfo?.auth || '—')}</td>
      <td class="sub">${(c.scopes || []).slice(0, 4).map((s) => `<span class="chip chip-dim">${esc(s)}</span>`).join(' ')}${c.scopes.length > 4 ? ` +${c.scopes.length - 4}` : ''}</td>
      <td class="mono">${(c.allowlist || []).join(', ') || '<span class="sub">anything</span>'}</td>
      <td class="num mono">${c.today}${c.blockedToday ? ` <span style="color:var(--bad)">/${c.blockedToday} blocked</span>` : ''}</td>
      <td>
        ${canM && c.state === 'disconnected' ? `<button class="btn btn-sm" data-connect="${esc(c.id)}">Connect</button>` : ''}
        ${canM && c.state === 'dry' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'live' }, 'Arm it', 'btn-primary') : ''}
        ${canM && c.state === 'live' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'dry' }, 'Back to dry') : ''}
        ${canM && c.state !== 'disconnected' ? xbtn(`/api/connectors/${c.id}/state`, { state: 'paused' }, 'Pause') : ''}
        ${canM && c.driverInfo?.auth === 'oauth2' ? `<button class="btn btn-sm" data-oauth="${esc(c.id)}">OAuth…</button>` : ''}
      </td>
    </tr>`;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Services reachable', d.counts.total, `${d.counts.live} armed · ${d.counts.dry} in dry-run`)}
    ${tile('Live', d.counts.live, 'can actually touch the world', d.counts.live ? 'tile-ok' : '')}
    ${tile('Dry-run', d.counts.dry, 'everything runs except the part that leaves', d.counts.dry ? 'tile-warn' : '')}
    ${tile('Not connected', d.counts.disconnected, 'no credential handed over yet')}
  </div>

  <div class="panel">
    <div class="panel-title">Every service the company can reach</div>
    <table><thead><tr><th>Service</th><th>State</th><th>Auth</th><th>Can do</th><th>Allowlist</th><th>Today</th><th></th></tr></thead>
      <tbody>${d.connectors.map(row).join('')}</tbody></table>
    <div class="map-legend">A connector starts <b>disconnected</b>. Handing it a credential moves it to <b>dry-run</b>, where every call executes and is recorded and <b>nothing leaves the machine</b> — that is how an integration is proven before it is trusted. Arming it is a separate, deliberate act by a person.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Add any HTTP API — no code</div>
      ${canM ? `
      <div class="form-grid">
        <input id="hc-id" placeholder="id, e.g. supplier-portal">
        <input id="hc-label" placeholder="what it is called">
        <input id="hc-base" placeholder="https://api.example.com/v1">
        <input id="hc-allow" placeholder="allowlist: example.com, partner.iq">
        <textarea id="hc-ops" rows="5" placeholder='{"order.create": {"method": "POST", "path": "/orders", "targetFrom": "customer"}, "order.read": {"method": "GET", "path": "/orders/{id}"}}'></textarea>
        <button class="btn btn-primary" id="hc-add">Create the connector</button>
      </div>
      <div class="map-legend">Describe the operations and it becomes a connector with the same gate, allowlist and ledger as Gmail. Path templates take <span class="mono">{name}</span> from the arguments.</div>
      ` : '<div class="empty">connectors.manage required</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Drivers available</div>
      <table><thead><tr><th>Driver</th><th>Auth</th><th>Capabilities</th></tr></thead><tbody>
        ${d.drivers.map((x) => `<tr><td><b>${esc(x.label)}</b><div class="sub mono">${esc(x.id)}</div></td>
          <td class="mono">${esc(x.auth)}</td>
          <td class="sub">${x.capabilities.map((c) => `<span class="chip chip-dim">${esc(c)}</span>`).join(' ')}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Try a call by hand</div>
    <div class="form-inline">
      <select id="cc-conn">${d.connectors.filter((c) => c.state !== 'disconnected').map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('') || '<option>connect something first</option>'}</select>
      <input id="cc-cap" placeholder="capability, e.g. mail.read" style="width:180px">
      <input id="cc-args" placeholder='{"query":"is:unread","max":3}' style="width:38%">
      <button class="btn btn-sm btn-primary" id="cc-go">Call</button>
    </div>
    <div id="cc-out"></div>
  </div>`;

  wireXact(renderConnectors);
  view.querySelectorAll('[data-connect]').forEach((b) => b.addEventListener('click', async () => {
    const secret = prompt(`Paste the credential for ${b.dataset.connect}.\nIt is encrypted before it is stored and never shown again.`);
    if (!secret) return;
    try { await api(`/api/connectors/${b.dataset.connect}/connect`, { method: 'POST', body: { secret } }); toast('Connected — in dry-run'); renderConnectors(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', async () => {
    const clientId = prompt('OAuth client id for ' + b.dataset.oauth);
    if (!clientId) return;
    const clientSecret = prompt('OAuth client secret (leave blank if the provider does not use one)') || '';
    try {
      const r = await api(`/api/connectors/${b.dataset.oauth}/authorize`, { method: 'POST', body: { clientId, clientSecret } });
      toast('Opening the provider…');
      window.open(r.url, '_blank', 'noopener');
    } catch (e) { toast(e.message, true); }
  }));
  const add = $('#hc-add');
  if (add) add.addEventListener('click', async () => {
    let ops;
    try { ops = JSON.parse($('#hc-ops').value || '{}'); } catch { return toast('The operations must be valid JSON', true); }
    try {
      await api('/api/connectors', { method: 'POST', body: {
        id: $('#hc-id').value.trim(), driver: 'http', label: $('#hc-label').value.trim(),
        config: { baseUrl: $('#hc-base').value.trim(), auth: { in: 'header', name: 'authorization', prefix: 'Bearer ' }, ops },
        allowlist: $('#hc-allow').value.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      toast('Created'); renderConnectors();
    } catch (e) { toast(e.message, true); }
  });
  $('#cc-go')?.addEventListener('click', async () => {
    let args = {};
    try { args = JSON.parse($('#cc-args').value || '{}'); } catch { return toast('Arguments must be JSON', true); }
    try {
      const r = await api(`/api/connectors/${$('#cc-conn').value}/call`, { method: 'POST', body: { capability: $('#cc-cap').value.trim(), args } });
      $('#cc-out').innerHTML = `<div style="margin-top:10px">${verdictChip(r.verdict)} ${esc(r.why || '')}</div>${preBody(JSON.stringify(r.result ?? r, null, 1))}`;
    } catch (e) { $('#cc-out').innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
  });
}

// ---------- The gate ----------
async function renderEgress() {
  const d = await api('/api/egress');
  const canRelease = hasPermC('egress.release');
  const canGrant = hasPermC('scopes.grant');
  const c = d.counts || {};
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Let through today', c.allowed || 0, 'reached the outside world', 'tile-ok')}
    ${tile('Refused', c.blocked || 0, 'a rule said no', (c.blocked || 0) ? 'tile-bad' : '')}
    ${tile('Waiting for a person', c.gated || 0, 'irreversible, so it stops here', (c.gated || 0) ? 'tile-warn' : '')}
    ${tile('Dry-run', c.dry || 0, 'executed, recorded, never sent')}
  </div>

  <div class="panel">
    <div class="panel-title">Held for a person — nothing here happened yet</div>
    <table><thead><tr><th>#</th><th>Service</th><th>What</th><th>Who asked</th><th>Target</th><th>Why held</th><th></th></tr></thead><tbody>
    ${d.waiting.map((e) => `<tr>
      <td class="mono">${e.id}</td><td class="mono">${esc(e.connector)}</td><td class="mono">${esc(e.capability)}</td>
      <td class="mono">${esc(e.agent_id || e.actor || '—')}</td><td>${esc(short(e.target || '—', 40))}</td>
      <td class="sub">${esc(e.blocked_by || '')}${e.value_usd ? ` · ${e.value_usd}` : ''}</td>
      <td>${canRelease ? `${xbtn(`/api/egress/${e.id}/release`, {}, 'Release', 'btn-primary')} ${xbtn(`/api/egress/${e.id}/deny`, { why: 'refused from the gate' }, 'Refuse', 'btn-bad')}` : '<span class="sub">egress.release required</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing is waiting.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">What gets refused, and by which rule</div>
      <table><thead><tr><th>Service</th><th>What</th><th>Rule</th><th>Times</th></tr></thead><tbody>
      ${d.blocked.map((b) => `<tr><td class="mono">${esc(b.connector)}</td><td class="mono">${esc(b.capability)}</td>
        <td><span class="chip chip-bad">${esc(b.blocked_by || 'unknown')}</span></td><td class="num mono">${b.n}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing has been refused.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Per service, today</div>
      <table><thead><tr><th>Service</th><th>State</th><th>Calls</th><th>Quota</th><th>Health</th></tr></thead><tbody>
      ${d.byConnector.map((x) => `<tr><td>${esc(x.label)}</td><td>${stateChip(x.state)}</td>
        <td class="num mono">${x.today}</td><td class="num mono">${x.quota_day}</td>
        <td><span class="chip ${x.health === 'ok' ? 'chip-ok' : x.health === 'failing' ? 'chip-bad' : 'chip-dim'}">${esc(x.health)}</span></td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Who may reach what — ${d.totalScopes} grants, none of them a wildcard</div>
    ${canGrant ? `
    <div class="form-inline">
      <input id="sc-agent" placeholder="AGT-REL-001" style="width:150px">
      <input id="sc-conn" placeholder="gmail" style="width:110px">
      <input id="sc-cap" placeholder="mail.send" style="width:130px">
      <input id="sc-limit" placeholder='{"domain":"client.com"}' style="width:220px">
      <button class="btn btn-sm btn-primary" id="sc-grant">Grant</button>
    </div>` : ''}
    <table><thead><tr><th>Employee</th><th>Service</th><th>May</th><th>Only for</th><th></th></tr></thead><tbody>
    ${d.scopes.map((s) => `<tr><td class="mono">${esc(s.agent_id)}</td><td class="mono">${esc(s.connector)}</td>
      <td><span class="chip chip-steel">${esc(s.capability)}</span></td>
      <td class="mono sub">${esc(s.constraint_json || 'anything the connector allows')}</td>
      <td>${canGrant ? xbtn('/api/scopes/revoke', { agentId: s.agent_id, connector: s.connector, capability: s.capability }, 'Revoke') : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nobody holds an outside scope. Nothing can leave.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">The ledger — every attempt, in order</div>
    <table><thead><tr><th>#</th><th>When</th><th>Service</th><th>What</th><th>Who</th><th>Target</th><th>Verdict</th></tr></thead><tbody>
    ${d.recent.map((e) => `<tr><td class="mono">${e.id}</td><td class="mono sub">${esc(String(e.created_at).slice(5, 16))}</td>
      <td class="mono">${esc(e.connector)}</td><td class="mono">${esc(e.capability)}</td>
      <td class="mono">${esc(e.agent_id || e.actor || '—')}</td><td>${esc(short(e.target || '—', 30))}</td>
      <td>${verdictChip(e.verdict)}${e.blocked_by ? ` <span class="sub mono">${esc(e.blocked_by)}</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nothing has tried to leave yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderEgress);
  $('#sc-grant')?.addEventListener('click', async () => {
    let constraint = null;
    const raw = $('#sc-limit').value.trim();
    if (raw) { try { constraint = JSON.parse(raw); } catch { return toast('The limit must be JSON', true); } }
    try {
      await api('/api/scopes', { method: 'POST', body: {
        agentId: $('#sc-agent').value.trim(), connector: $('#sc-conn').value.trim(),
        capability: $('#sc-cap').value.trim(), constraint,
      } });
      toast('Granted'); renderEgress();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- The vault ----------
async function renderVault() {
  const d = await api('/api/vault');
  const canM = hasPermC('vault.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Credentials held', d.counts.total, 'encrypted with AES-256-GCM')}
    ${tile('Expired', d.counts.expired, 'will not be handed out', d.counts.expired ? 'tile-bad' : '')}
    ${tile('Expiring within a fortnight', d.counts.expiringSoon, 'rotate before they bite', d.counts.expiringSoon ? 'tile-warn' : '')}
    ${tile('Never used', d.counts.stale, 'a key nobody uses is a liability')}
  </div>
  <div class="panel">
    <div class="panel-title">The vault</div>
    ${canM ? `
    <div class="form-inline">
      <input id="v-name" placeholder="NAME_LIKE_THIS" style="width:200px">
      <input id="v-val" type="password" placeholder="the value — stored encrypted, never shown again" style="width:34%">
      <input id="v-conn" placeholder="connector (optional)" style="width:130px">
      <input id="v-exp" type="date" title="expires">
      <button class="btn btn-sm btn-primary" id="v-put">Store</button>
    </div>` : '<div class="empty">vault.manage required</div>'}
    <table><thead><tr><th>Name</th><th>Kind</th><th>For</th><th>Ends</th><th>Expires</th><th>Last used</th><th></th></tr></thead><tbody>
    ${d.secrets.map((s) => `<tr>
      <td class="mono">${esc(s.name)}</td>
      <td><span class="chip chip-dim">${esc(s.kind)}</span></td>
      <td class="mono sub">${esc(s.connector || '—')}</td>
      <td class="mono">…${esc(s.tail || '••')}</td>
      <td class="mono sub">${s.expires_at ? `<span class="chip ${s.expired ? 'chip-bad' : s.expiringSoon ? 'chip-warn' : 'chip-dim'}">${esc(String(s.expires_at).slice(0, 10))}</span>` : '—'}</td>
      <td class="mono sub">${s.last_used ? esc(String(s.last_used).slice(0, 16)) : '<span style="color:var(--warn)">never</span>'}</td>
      <td>${canM ? `<button class="btn btn-sm btn-bad" data-drop="${esc(s.name)}">Delete</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">Empty.</td></tr>'}
    </tbody></table>
    <div class="map-legend">The value goes in and never comes back out: what you see is the last four characters. The master key lives in <span class="mono">data/master.key</span>, outside the database, so a copied <span class="mono">.db</span> is not a copied set of keys. On a shared host this raises the cost of theft rather than making it impossible — a second machine wants a real key manager.</div>
  </div>`;
  $('#v-put')?.addEventListener('click', async () => {
    try {
      await api('/api/vault', { method: 'POST', body: {
        name: $('#v-name').value.trim(), value: $('#v-val').value,
        connector: $('#v-conn').value.trim() || null, expiresAt: $('#v-exp').value || null,
      } });
      toast('Stored'); renderVault();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete ${b.dataset.drop}? Anything using it stops working.`)) return;
    try { await api(`/api/vault/${b.dataset.drop}`, { method: 'DELETE' }); toast('Deleted'); renderVault(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ---------- The open web ----------
async function renderWeb(id) {
  // #/web/12 opens one page as it was actually read, hash and all.
  if (id) return renderWebPage(id);
  const d = await api('/api/web');
  const canUse = hasPermC('web.use');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Pages read today', d.counts.today, `${d.counts.total} all time`)}
    ${tile('Failed or refused', d.counts.failed, 'private addresses are blocked outright')}
    ${tile('Hijack attempts caught', d.counts.injections, 'text that tried to give orders', d.counts.injections ? 'tile-warn' : '')}
    <div class="panel tile"><div class="panel-title">Search engines</div>
      <div class="sub" style="margin-top:8px">
        ${Object.entries(d.engines).map(([k, on]) => `<span class="chip ${on ? 'chip-ok' : 'chip-dim'}">${esc(k)}</span>`).join(' ')}
      </div>
      <div class="sub" style="margin-top:6px">Add BRAVE_SEARCH_KEY, TAVILY_API_KEY or SERPAPI_KEY to the vault.</div></div>
  </div>

  ${canUse ? `
  <div class="panel">
    <div class="panel-title">Reach out — three ways, weakest first</div>
    <div class="form-inline">
      <input id="w-url" placeholder="https://example.com  or  a search phrase" style="width:48%">
      <button class="btn btn-sm btn-primary" id="w-fetch">Fetch</button>
      <button class="btn btn-sm" id="w-search">Search</button>
      <button class="btn btn-sm" id="w-browse">Browse (real Chrome)</button>
    </div>
    <div id="w-out"></div>
    <div class="map-legend"><b>Fetch</b> reads the HTML. <b>Search</b> asks an engine. <b>Browse</b> drives a real browser for pages that are an application rather than a document. Everything read is kept with the hash of what it actually said, so any claim made from it can be traced back — and any text in it that tries to give orders is flagged and filed as an attack, never obeyed.</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">What the company has read</div>
    <table><thead><tr><th>#</th><th>Mode</th><th>Page</th><th>Status</th><th>Bytes</th><th>Fingerprint</th><th>Who</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr>
      <td class="mono">${r.id}</td>
      <td><span class="chip ${r.mode === 'browse' ? 'chip-steel' : r.mode === 'search' ? 'chip-ember' : 'chip-dim'}">${esc(r.mode)}</span></td>
      <td><a href="#/web/${r.id}" class="mono">${esc(short(r.title || r.url, 52))}</a></td>
      <td class="mono ${r.error ? 'sub' : ''}" style="${r.error ? 'color:var(--bad)' : ''}">${r.error ? esc(short(r.error, 26)) : r.status}</td>
      <td class="num mono">${r.bytes || 0}</td>
      <td class="mono sub">${esc((r.content_hash || '').slice(0, 12) || '—')}</td>
      <td class="mono sub">${esc(r.agent_id || 'human')}</td>
      <td class="mono sub">${esc(String(r.created_at).slice(5, 16))}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing has been read from the web yet.</td></tr>'}
    </tbody></table>
  </div>`;

  const show = async (path, body) => {
    $('#w-out').innerHTML = '<div class="empty">working…</div>';
    try {
      const r = await api(path, { method: 'POST', body });
      if (r.results) {
        $('#w-out').innerHTML = `<div class="sub" style="margin:8px 0">${esc(r.engine || 'no engine')} · ${r.results.length} results</div>` +
          r.results.map((x) => `<div style="margin:6px 0"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><div class="sub">${esc(short(x.snippet || '', 160))}</div></div>`).join('')
          + (r.note ? `<div class="empty">${esc(r.note)}</div>` : '');
        return;
      }
      const warn = r.injection && !r.injection.clean
        ? `<div class="chip chip-bad" style="margin:8px 0">This page tried to give instructions — recorded as an attack, not obeyed</div>` : '';
      $('#w-out').innerHTML = `${warn}<div class="sub" style="margin:8px 0"><b>${esc(r.title || '')}</b> · ${r.cached ? 'from cache' : 'fresh'} · ${esc((r.contentHash || '').slice(0, 16))}</div>
        ${r.screenshot ? `<img src="${r.screenshot}" style="max-width:100%;border:1px solid var(--seam);border-radius:8px">` : ''}
        ${preBody(short(r.text || '', 4000))}`;
    } catch (e) { $('#w-out').innerHTML = `<div class="empty" style="color:var(--bad)">${esc(e.message)}</div>`; }
  };
  $('#w-fetch')?.addEventListener('click', () => show('/api/web/fetch', { url: $('#w-url').value.trim() }));
  $('#w-search')?.addEventListener('click', () => show('/api/web/search', { query: $('#w-url').value.trim() }));
  $('#w-browse')?.addEventListener('click', () => show('/api/web/browse', { url: $('#w-url').value.trim(), screenshot: true }));
}

async function renderWebPage(id) {
  const r = await api(`/api/web/${id}`);
  if (!r) { view.innerHTML = '<div class="empty">No such page.</div>'; return; }
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title"><a href="#/web">← the open web</a></div>
    <h2 style="margin:6px 0">${esc(r.title || r.url)}</h2>
    <div class="sub mono">${esc(r.url)}</div>
    <div class="sub" style="margin-top:6px">${esc(r.mode)} · ${r.status} · ${r.bytes} bytes · fingerprint <span class="mono">${esc(r.content_hash || '—')}</span> · ${esc(String(r.created_at))}</div>
    ${!r.injection.clean ? `<div class="chip chip-bad" style="margin-top:10px">Contains text that tries to give instructions: ${esc(r.injection.hits.join(', '))}</div>` : ''}
    ${r.screenshot ? `<img src="${r.screenshot}" style="max-width:100%;margin-top:12px;border:1px solid var(--seam);border-radius:8px">` : ''}
    ${preBody(r.text || '')}
  </div>`;
}

// ---------- MCP ----------
async function renderMcp() {
  const d = await api('/api/mcp');
  const canM = hasPermC('mcp.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Servers registered', d.counts.registered, `${d.counts.connected} answering`)}
    ${tile('Tools reachable', d.counts.tools, 'things the workforce can now do', d.counts.tools ? 'tile-ok' : '')}
    ${tile('Tool calls made', d.counts.calls, 'by employees, on real work')}
    ${tile('Crucible exposes', 7, 'tools an outside agent can drive us with', 'tile-steel')}
  </div>

  <div class="panel">
    <div class="panel-title">Servers the company can reach</div>
    <table><thead><tr><th>Server</th><th>Transport</th><th>State</th><th>Tools</th><th>Calls</th><th></th></tr></thead><tbody>
    ${d.servers.map((s) => `<tr>
      <td><b>${esc(s.label)}</b><div class="sub mono">${esc(s.command || s.url || s.id)}</div></td>
      <td class="mono">${esc(s.transport)}</td>
      <td><span class="chip ${s.state === 'connected' ? 'chip-ok' : s.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${esc(s.state)}</span>${s.last_error ? `<div class="sub" style="color:var(--bad)">${esc(short(s.last_error, 60))}</div>` : ''}</td>
      <td class="sub">${s.tools.slice(0, 5).map((t) => `<span class="chip chip-dim">${esc(t.name)}</span>`).join(' ')}${s.tools.length > 5 ? ` +${s.tools.length - 5}` : ''}</td>
      <td class="num mono">${s.calls}</td>
      <td>${canM ? xbtn(`/api/mcp/${s.id}/sync`, {}, 'Sync', 'btn-primary') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No servers yet — add one below.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Add a server</div>
      ${canM ? `
      <div class="form-grid">
        <input id="mc-id" placeholder="id, e.g. filesystem">
        <input id="mc-label" placeholder="what it is">
        <input id="mc-cmd" placeholder="command, e.g. npx">
        <input id="mc-args" placeholder='args, comma separated: -y, @modelcontextprotocol/server-filesystem, .'>
        <button class="btn btn-primary" id="mc-add">Register</button>
      </div>
      <div class="sub" style="margin-top:10px">Worth having:</div>
      <table><tbody>${d.suggestions.map((s) => `<tr>
        <td><b>${esc(s.label)}</b><div class="sub">${esc(s.why)}</div></td>
        <td><button class="btn btn-sm" data-suggest="${encodeURIComponent(JSON.stringify(s))}">Add</button></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">mcp.manage required</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Crucible as a server — drive this company from outside</div>
      <div class="map-legend">Point Claude Code, Claude Desktop or any MCP client at the endpoint below with your own Crucible token. You get exactly the permissions your account holds — there is no wider back door.</div>
      ${preBody(JSON.stringify({
        mcpServers: {
          crucible: {
            type: 'http',
            url: `${location.origin}/mcp`,
            headers: { 'x-auth-token': 'YOUR-CRUCIBLE-TOKEN' },
          },
        },
      }, null, 2))}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Recent tool calls</div>
    <table><thead><tr><th>#</th><th>Server</th><th>Tool</th><th>Who</th><th>Result</th><th>ms</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((c) => `<tr><td class="mono">${c.id}</td><td class="mono">${esc(c.server_id)}</td><td class="mono">${esc(c.tool)}</td>
      <td class="mono sub">${esc(c.agent_id || 'human')}</td>
      <td>${c.ok ? '<span class="chip chip-ok">ok</span>' : '<span class="chip chip-bad">failed</span>'}</td>
      <td class="num mono">${c.ms || 0}</td><td class="mono sub">${esc(String(c.created_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No tool has been called yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderMcp);
  $('#mc-add')?.addEventListener('click', async () => {
    try {
      await api('/api/mcp', { method: 'POST', body: {
        id: $('#mc-id').value.trim(), label: $('#mc-label').value.trim(),
        command: $('#mc-cmd').value.trim(),
        args: $('#mc-args').value.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      toast('Registered'); renderMcp();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', async () => {
    const s = JSON.parse(decodeURIComponent(b.dataset.suggest));
    try { await api('/api/mcp', { method: 'POST', body: { id: s.id, label: s.label, command: s.command, args: s.args } }); toast('Registered — press Sync'); renderMcp(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ---------- The queue ----------
async function renderJobs() {
  const d = await api('/api/jobs');
  const canM = hasPermC('jobs.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Waiting', d.counts.queued, 'due now or backing off')}
    ${tile('Running', d.counts.running, 'in flight')}
    ${tile('Finished', d.counts.done, 'completed and closed')}
    ${tile('Dead', d.counts.dead, 'gave up after every attempt', d.counts.dead ? 'tile-bad' : '')}
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">By kind</div>
      <table><thead><tr><th>Kind</th><th>Jobs</th><th>Dead</th><th>Avg attempts</th></tr></thead><tbody>
      ${d.kinds.map((k) => `<tr><td class="mono">${esc(k.kind)}</td><td class="num mono">${k.n}</td>
        <td class="num mono" style="${k.dead ? 'color:var(--bad)' : ''}">${k.dead || 0}</td><td class="num mono">${k.avg_attempts}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nothing has been queued.</td></tr>'}
      </tbody></table>
      <div class="map-legend">Registered handlers: ${d.registered.map((r) => `<span class="chip chip-dim">${esc(r)}</span>`).join(' ') || 'none'}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Gave up — somebody should look</div>
      <table><thead><tr><th>#</th><th>Kind</th><th>Tries</th><th>Last error</th><th></th></tr></thead><tbody>
      ${d.deadLetter.map((j) => `<tr><td class="mono">${j.id}</td><td class="mono">${esc(j.kind)}</td><td class="num mono">${j.attempts}</td>
        <td class="sub">${esc(short(j.error || '', 60))}</td>
        <td>${canM ? xbtn(`/api/jobs/${j.id}/retry`, {}, 'Try again') : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Nothing has been abandoned.</td></tr>'}
      </tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Recent</div>
    <table><thead><tr><th>#</th><th>Kind</th><th>State</th><th>Tries</th><th>Error</th><th>Queued</th><th></th></tr></thead><tbody>
    ${d.recent.map((j) => `<tr><td class="mono">${j.id}</td><td class="mono">${esc(j.kind)}</td>
      <td><span class="chip ${j.state === 'done' ? 'chip-ok' : j.state === 'dead' ? 'chip-bad' : j.state === 'running' ? 'chip-ember' : 'chip-dim'}">${esc(j.state)}</span></td>
      <td class="num mono">${j.attempts}</td><td class="sub">${esc(short(j.last_error || '', 44))}</td>
      <td class="mono sub">${esc(String(j.created_at).slice(5, 16))}</td>
      <td>${canM && j.state === 'queued' ? xbtn(`/api/jobs/${j.id}/cancel`, {}, 'Cancel') : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="map-legend">A failed job is re-queued with a growing pause between attempts — five seconds, ten, twenty, and so on to an hour — and an idempotency key means the same logical work can never be queued twice. After the last attempt it is shelved rather than retried forever, because a job that cannot succeed should be read by a person, not repeated by a machine.</div>
  </div>`;
  wireXact(renderJobs);
}

// ---------- The constitution ----------
async function renderConstitution() {
  const d = await api('/api/constitution');
  const canAmend = hasPermC('constitution.amend');
  const sev = (s) => `<span class="chip ${s === 'block' ? 'chip-bad' : s === 'gate' ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  const byArticle = {};
  for (const r of d.rules.filter((x) => x.state === 'active')) (byArticle[r.article] ||= []).push(r);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Rules in force', d.counts.active, `across ${d.articles.length} articles`)}
    ${tile('Machine-checkable', d.counts.enforceable, 'the gate can evaluate these before anything leaves', 'tile-ok')}
    ${tile('Absolute refusals', d.counts.blocking, 'no scope can override them')}
    ${tile('People left alone', d.suppression.length, 'asked not to be contacted, permanently')}
  </div>

  ${Object.entries(byArticle).map(([article, rules]) => `
  <div class="panel">
    <div class="panel-title">${esc(article)}</div>
    <table><tbody>
    ${rules.map((r) => `<tr>
      <td style="width:60%"><b>${esc(r.text)}</b>
        <div class="sub mono" style="margin-top:4px">${esc(r.rule_id)}${r.machine ? ` · ${esc(short(JSON.stringify(r.machine), 90))}` : ' · read by people, not enforced by machine'}</div></td>
      <td>${sev(r.severity)}</td>
      <td class="num mono" title="times this rule has fired">${r.hits}</td>
      <td>${canAmend ? xbtn(`/api/constitution/${r.rule_id}/retire`, {}, 'Retire') : ''}</td>
    </tr>`).join('')}
    </tbody></table>
  </div>`).join('')}

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">When the rules actually bit</div>
      <table><thead><tr><th>Rule</th><th>On</th><th>Verdict</th><th>When</th></tr></thead><tbody>
      ${d.recentHits.map((h) => `<tr><td class="mono">${esc(h.rule_id)}</td><td class="sub">${esc(short(h.subject || '', 40))}</td>
        <td>${sev(h.verdict)}</td><td class="mono sub">${esc(String(h.created_at).slice(5, 16))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">No rule has fired yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Add a rule</div>
      ${canAmend ? `
      <div class="form-grid">
        <input id="ct-id" placeholder="rule id, e.g. no-weekend-calls">
        <input id="ct-article" placeholder="article, e.g. Consent">
        <textarea id="ct-text" rows="3" placeholder="The sentence a person reads."></textarea>
        <input id="ct-machine" placeholder='machine form (optional): {"gate": {"capabilityIn": ["call.place"]}}'>
        <select id="ct-sev"><option value="warn">warn</option><option value="gate">stop for a person</option><option value="block">refuse outright</option></select>
        <button class="btn btn-primary" id="ct-add">Enact</button>
      </div>
      <div class="map-legend">A rule nobody can check is a slogan; a check nobody can read is a trap. Write both halves. Amending replaces the rule with a new version and leaves the old one in the record — the constitution has a history, not a current state.</div>
      ` : '<div class="empty">Only the owner amends the constitution.</div>'}
    </div>
  </div>`;
  wireXact(renderConstitution);
  $('#ct-add')?.addEventListener('click', async () => {
    let machine = null;
    const raw = $('#ct-machine').value.trim();
    if (raw) { try { machine = JSON.parse(raw); } catch { return toast('The machine form must be JSON', true); } }
    try {
      await api('/api/constitution', { method: 'POST', body: {
        ruleId: $('#ct-id').value.trim(), article: $('#ct-article').value.trim(),
        text: $('#ct-text').value.trim(), machine, severity: $('#ct-sev').value,
      } });
      toast('Enacted'); renderConstitution();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- Provenance ----------
async function renderProvenance() {
  const d = await api('/api/provenance');
  const canIssue = hasPermC('provenance.issue');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Receipts issued', d.counts.total, `${d.counts.today} today`)}
    ${tile('Runs not yet sealed', d.unsealed.runs, 'sealed automatically as they finish', d.unsealed.runs ? 'tile-warn' : '')}
    ${tile('Kinds of work', d.counts.subjects.length, d.counts.subjects.map((s) => `${s.n} ${s.subject_type}`).join(' · '))}
    <div class="panel tile"><div class="panel-title">Seal now</div>
      ${canIssue ? xbtn('/api/provenance/seal', {}, 'Sign everything finished', 'btn-primary') : '<div class="sub">provenance.issue required</div>'}
      <div class="sub" style="margin-top:6px">Ed25519 over a canonical description of the work.</div></div>
  </div>
  <div class="panel">
    <div class="panel-title">Receipts</div>
    <table><thead><tr><th>#</th><th>What</th><th>Fingerprint</th><th>Made by</th><th>Model</th><th>Reviewed by</th><th>Cost</th><th></th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr>
      <td class="mono">${r.id}</td>
      <td class="mono">${esc(r.subject_type)}:${esc(short(String(r.subject_id), 12))}</td>
      <td class="mono sub">${esc(r.content_hash)}</td>
      <td class="mono">${esc(r.made_by || '—')}</td>
      <td class="mono sub">${esc(r.model || '—')}</td>
      <td class="sub">${(JSON.parse(r.reviewers || '[]')).join(', ') || '—'}</td>
      <td class="num mono">${r.cost_usd ? `${Number(r.cost_usd).toFixed(4)}` : '—'}</td>
      <td>${xbtn(`/api/provenance/${r.id}/verify`, {}, 'Verify')}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing sealed yet.</td></tr>'}
    </tbody></table>
  </div>
  <div class="panel">
    <div class="panel-title">The public key — publish this</div>
    <div class="map-legend">Anyone holding this key can verify a receipt offline, forever, without asking us anything. That is the point: the proof does not depend on our database still existing or on us being trusted.</div>
    ${preBody(d.publicKey)}
  </div>`;
  wireXact(renderProvenance);
}

// ---------- The time machine ----------
async function renderTimeMachine() {
  const d = await api('/api/timemachine');
  const canSnap = hasPermC('timemachine.snapshot');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Entries on the chain', d.chain.checked, d.chain.ok ? 'every one verifies' : `broken at ${d.chain.brokenAt}`, d.chain.ok ? 'tile-ok' : 'tile-bad')}
    ${tile('Marks you can stand at', d.snapshots.length, 'named points in the company’s life')}
    ${tile('First recorded moment', String(d.chain.since || '—').slice(0, 10), 'the beginning of the record')}
    <div class="panel tile"><div class="panel-title">Mark now</div>
      ${canSnap ? `<div class="form-inline"><input id="tm-label" placeholder="what is happening" style="width:60%"><button class="btn btn-sm btn-primary" id="tm-snap">Mark</button></div>` : '<div class="sub">timemachine.snapshot required</div>'}
    </div>
  </div>
  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Marks</div>
      <table><thead><tr><th>Label</th><th>Entry</th><th>What existed then</th><th></th></tr></thead><tbody>
      ${d.snapshots.map((s) => `<tr><td><b>${esc(s.label)}</b><div class="sub mono">${esc(String(s.created_at).slice(0, 16))}</div></td>
        <td class="mono">${s.seq}</td>
        <td class="sub">${Object.entries(s.counts).filter(([, v]) => v).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
        <td><button class="btn btn-sm" data-standat="${s.seq}">Stand here</button></td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">No marks yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Days of the company</div>
      <table><thead><tr><th>Day</th><th>Moves</th><th>Who acted</th></tr></thead><tbody>
      ${d.days.map((x) => `<tr><td class="mono">${esc(x.day)}</td><td class="num mono">${x.moves}</td><td class="num mono">${x.actors}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">Replay a stretch</div>
    <div class="form-inline">
      <input id="tm-from" type="number" placeholder="from entry" style="width:120px">
      <input id="tm-to" type="number" placeholder="to entry" value="${d.chain.tip}" style="width:120px">
      <button class="btn btn-sm btn-primary" id="tm-replay">Replay</button>
    </div>
    <div id="tm-out"></div>
  </div>`;

  $('#tm-snap')?.addEventListener('click', async () => {
    try { await api('/api/timemachine/snapshot', { method: 'POST', body: { label: $('#tm-label').value.trim() || 'mark' } }); toast('Marked'); renderTimeMachine(); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-standat]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/api/timemachine/at/${b.dataset.standat}`);
    $('#tm-out').innerHTML = `
      <div class="sub" style="margin:10px 0">Standing at entry ${r.seq}, ${esc(String(r.at))} — the company had spent ${Number(r.money.spent || 0).toFixed(2)} by then.</div>
      <div class="grid grid-2">
        <div><div class="panel-title">What had been done</div><table><tbody>${r.actions.slice(0, 12).map((a) => `<tr><td class="mono">${esc(a.action)}</td><td class="num mono">${a.n}</td></tr>`).join('')}</tbody></table></div>
        <div><div class="panel-title">Who had acted</div><table><tbody>${r.actors.slice(0, 12).map((a) => `<tr><td class="mono">${esc(a.actor_id)}</td><td class="num mono">${a.n}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
  }));
  $('#tm-replay')?.addEventListener('click', async () => {
    try {
      const r = await api(`/api/timemachine/replay/${Number($('#tm-from').value || 1)}/${Number($('#tm-to').value || d.chain.tip)}`);
      $('#tm-out').innerHTML = `<div class="sub" style="margin:10px 0">${r.moves} moves${r.span ? ` between ${esc(String(r.span.start).slice(0, 16))} and ${esc(String(r.span.end).slice(0, 16))}` : ''}</div>
        <table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Did</th><th>To</th></tr></thead><tbody>
        ${r.entries.slice(-60).reverse().map((e) => `<tr><td class="mono">${e.seq}</td><td class="mono sub">${esc(String(e.occurred_at).slice(5, 16))}</td>
          <td class="mono">${esc(e.actor_id)}</td><td class="mono">${esc(e.action)}</td>
          <td class="mono sub">${esc(e.subject_type || '')} ${esc(short(String(e.subject_id || ''), 18))}</td></tr>`).join('')}
        </tbody></table>`;
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- The shadow company ----------
async function renderSimulation() {
  const d = await api('/api/simulation');
  const canRun = hasPermC('simulation.run');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Simulations run', d.counts.total, `${d.counts.done} finished`)}
    ${tile('Levers available', d.levers.length, 'each one a small, readable change')}
    ${tile('Measured on', d.metrics.length, 'the same numbers as the real company')}
    ${tile('Company right now', d.now.runs, `${d.now.customers} customers · ${Number(d.now.spendUsd || 0).toFixed(2)} spent`)}
  </div>

  ${canRun ? `
  <div class="panel">
    <div class="panel-title">Ask a question you cannot afford to answer for real</div>
    <div class="form-grid">
      <input id="sm-name" placeholder="a short name, e.g. marketing cut">
      <textarea id="sm-q" rows="2" placeholder="What happens if we cut marketing by forty per cent?"></textarea>
      <div class="form-inline">
        <select id="sm-lever">${d.levers.map((l) => `<option value="${esc(l.id)}">${esc(l.id)} — ${esc(l.describe)}</option>`).join('')}</select>
        <input id="sm-arg" placeholder='{"factor": 0.6}' style="width:180px">
        <button class="btn btn-primary" id="sm-run">Fork and run</button>
      </div>
    </div>
    <div class="map-legend">The fork is a copy of the database on disk with its connectors switched off. A simulated employee <b>cannot</b> send an email — not because a policy forbids it, but because the file it is working in is not connected to anything.</div>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">Runs</div>
    <table><thead><tr><th>#</th><th>Question</th><th>What changed</th><th>State</th><th>When</th><th></th></tr></thead><tbody>
    ${d.simulations.map((s) => `<tr><td class="mono">${s.id}</td>
      <td><b>${esc(s.name)}</b><div class="sub">${esc(short(s.question, 70))}</div></td>
      <td class="mono sub">${esc(short(s.verdict || '', 40))}</td>
      <td><span class="chip ${s.state === 'done' ? 'chip-ok' : s.state === 'failed' ? 'chip-bad' : 'chip-dim'}">${esc(s.state)}</span></td>
      <td class="mono sub">${esc(String(s.created_at).slice(5, 16))}</td>
      <td><button class="btn btn-sm" data-simopen="${s.id}">Compare</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nothing has been simulated yet.</td></tr>'}
    </tbody></table>
    <div id="sm-out"></div>
  </div>`;

  $('#sm-run')?.addEventListener('click', async () => {
    let arg = {};
    try { arg = JSON.parse($('#sm-arg').value || '{}'); } catch { return toast('The lever argument must be JSON', true); }
    try {
      const r = await api('/api/simulation', { method: 'POST', body: {
        name: $('#sm-name').value.trim() || 'simulation',
        question: $('#sm-q').value.trim() || 'what happens?',
        changes: [{ lever: $('#sm-lever').value, ...arg }],
      } });
      toast('Ran'); renderSimulation();
      setTimeout(() => document.querySelector(`[data-simopen="${r.id}"]`)?.click(), 200);
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-simopen]').forEach((b) => b.addEventListener('click', async () => {
    const s = await api(`/api/simulation/${b.dataset.simopen}`);
    $('#sm-out').innerHTML = `
      <div class="sub" style="margin:12px 0"><b>${esc(s.name)}</b> — ${esc(s.question)}<br>changed: <span class="mono">${esc(s.verdict || '')}</span></div>
      <table><thead><tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>
      ${Object.entries(s.delta).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td>
        <td class="num mono">${v.before}</td><td class="num mono">${v.after}</td>
        <td class="num mono" style="color:${v.change > 0 ? 'var(--ok)' : v.change < 0 ? 'var(--bad)' : 'var(--ink-faint)'}">${v.change > 0 ? '+' : ''}${v.change}${v.percent !== null ? ` (${v.percent > 0 ? '+' : ''}${v.percent}%)` : ''}</td></tr>`).join('')}
      </tbody></table>`;
  }));
}

// ---------- Skill market ----------
async function renderSkills() {
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
      <select id="tn-task">${d.taskTypes.map((t) => `<option value="${esc(t.task_type)}">${esc(t.task_type)} (${t.runs} runs)</option>`).join('')}</select>
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

// ---------- Red team ----------
async function renderRedteam() {
  const d = await api('/api/redteam');
  const canRun = hasPermC('redteam.run');
  const sev = (s) => `<span class="chip ${s === 'critical' ? 'chip-bad' : s === 'high' ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Got through', d.counts.breached, 'open, unfixed', d.counts.breached ? 'tile-bad' : 'tile-ok')}
    ${tile('Held', d.counts.defended, 'the defence worked')}
    ${tile('Attacks in the suite', d.attacks.length, 'run on a timer, not on request')}
    <div class="panel tile"><div class="panel-title">Attack ourselves</div>
      ${canRun ? xbtn('/api/redteam/run', {}, 'Run the whole suite', 'btn-primary') : '<div class="sub">redteam.run required</div>'}
      <div class="sub" style="margin-top:6px">Last sweep: ${esc(String(d.lastSweep || 'never').slice(0, 16))}</div></div>
  </div>

  ${d.open.length ? `
  <div class="panel">
    <div class="panel-title" style="color:var(--bad)">Open — these got through and are not fixed</div>
    <table><thead><tr><th>Attack</th><th>Against</th><th>What happened</th><th>Severity</th><th></th></tr></thead><tbody>
    ${d.open.map((r) => `<tr><td class="mono">${esc(r.attack)}</td><td class="sub">${esc(r.target)}</td>
      <td>${esc(r.detail)}</td><td>${sev(r.severity)}</td>
      <td>${canRun ? xbtn(`/api/redteam/${r.id}/fixed`, {}, 'Mark fixed', 'btn-ok') : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}

  <div class="panel">
    <div class="panel-title">The suite</div>
    <table><thead><tr><th>Attack</th><th>What it tries</th><th>Severity</th><th></th></tr></thead><tbody>
    ${d.attacks.map((a) => `<tr><td class="mono">${esc(a.id)}</td><td>${esc(a.describe)}</td><td>${sev(a.severity)}</td>
      <td>${canRun ? xbtn('/api/redteam/run', { only: a.id }, 'Try it now') : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="map-legend">The moment an employee can read a web page or an email and then send one, open a pull request or move money, a hostile page becomes a command channel. That is the main threat this company faces, and the only honest response is to keep trying it on ourselves and to write down what happens. A breach here is a finding, not an incident.</div>
  </div>

  <div class="panel">
    <div class="panel-title">History</div>
    <table><thead><tr><th>#</th><th>Attack</th><th>Result</th><th>Detail</th><th>When</th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr><td class="mono">${r.id}</td><td class="mono">${esc(r.attack)}</td>
      <td><span class="chip ${r.outcome === 'defended' ? 'chip-ok' : r.outcome === 'breached' ? 'chip-bad' : 'chip-dim'}">${esc(r.outcome)}</span>${r.fixed_at ? ' <span class="chip chip-ok">fixed</span>' : ''}</td>
      <td class="sub">${esc(short(r.detail || '', 70))}</td><td class="mono sub">${esc(String(r.created_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">No sweep has run yet.</td></tr>'}
    </tbody></table>
  </div>`;
  wireXact(renderRedteam);
}

// ---------- Knowledge graph ----------
async function renderKnowledgeGraph() {
  const d = await api('/api/kgraph');
  const canM = hasPermC('graph.manage');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Things known', d.counts.nodes, 'customers, employees, deals, work, memories')}
    ${tile('Connections', d.counts.edges, 'drawn from real rows, not guessed')}
    ${tile('Unconnected', d.orphans, 'known, but not yet joined to anything')}
    <div class="panel tile"><div class="panel-title">Rebuild</div>
      ${canM ? xbtn('/api/kgraph/rebuild', {}, 'Rebuild from the database', 'btn-primary') : '<div class="sub">graph.manage required</div>'}
      <div class="sub" style="margin-top:6px">Last built ${esc(String(d.lastBuilt || 'never').slice(0, 16))}</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Ask about anything — meaning, not spelling</div>
    <div class="form-inline">
      <input id="g-q" placeholder="اسأل بالعربية أو in English — e.g. oil company in Basra" style="width:52%">
      <button class="btn btn-sm btn-primary" id="g-go">Search</button>
    </div>
    <div id="g-out"></div>
    <div class="map-legend">The embeddings are local: hashed character trigrams with the same Arabic folding the memory index uses. No key, no network, no vendor — it keeps working with the line cut, which is the point.</div>
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Most connected</div>
      <table><thead><tr><th>Thing</th><th>Kind</th><th>Connections</th></tr></thead><tbody>
      ${d.hubs.map((h) => `<tr><td><a href="#" data-node="${esc(h.id)}">${esc(h.label)}</a></td>
        <td><span class="chip chip-dim">${esc(h.kind)}</span></td><td class="num mono">${h.degree}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="panel">
      <div class="panel-title">Shape of what we know</div>
      <table><thead><tr><th>Kind</th><th>Count</th></tr></thead><tbody>
      ${d.byKind.map((k) => `<tr><td class="mono">${esc(k.kind)}</td><td class="num mono">${k.n}</td></tr>`).join('')}
      </tbody></table>
      <div class="panel-title" style="margin-top:12px">Kinds of connection</div>
      <div class="sub">${d.byRel.map((r) => `<span class="chip chip-dim">${esc(r.rel)} ${r.n}</span>`).join(' ')}</div>
    </div>
  </div>`;

  const openNode = async (id) => {
    const nb = await api(`/api/kgraph/node/${encodeURIComponent(id)}`);
    if (!nb) return;
    $('#g-out').innerHTML = `
      <div class="sub" style="margin:10px 0"><b>${esc(nb.centre.label)}</b> <span class="chip chip-dim">${esc(nb.centre.kind)}</span>
        — ${nb.nodes.length} things within two hops</div>
      <table><thead><tr><th>Hop</th><th>Thing</th><th>Kind</th><th>How it connects</th></tr></thead><tbody>
      ${nb.nodes.filter((n) => n.id !== nb.centre.id).map((n) => {
        const via = nb.edges.filter((e) => e.src === n.id || e.dst === n.id).map((e) => e.rel);
        return `<tr><td class="mono">${n.hop}</td><td><a href="#" data-node="${esc(n.id)}">${esc(n.label)}</a></td>
          <td><span class="chip chip-dim">${esc(n.kind)}</span></td>
          <td class="sub mono">${esc([...new Set(via)].join(', '))}</td></tr>`;
      }).join('')}
      </tbody></table>`;
    $('#g-out').querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  };
  view.querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  $('#g-go')?.addEventListener('click', async () => {
    const r = await api(`/api/kgraph/search?q=${encodeURIComponent($('#g-q').value)}`);
    $('#g-out').innerHTML = `<table><thead><tr><th>Match</th><th>Kind</th><th>Closeness</th><th>What we know</th></tr></thead><tbody>
      ${r.results.map((x) => `<tr><td><a href="#" data-node="${esc(x.id)}">${esc(x.label)}</a></td>
        <td><span class="chip chip-dim">${esc(x.kind)}</span></td><td class="num mono">${x.score}</td>
        <td class="sub">${esc(short(Object.entries(x.props).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · '), 70))}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nothing close enough.</td></tr>'}
      </tbody></table>`;
    $('#g-out').querySelectorAll('[data-node]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openNode(a.dataset.node); }));
  });
  wireXact(renderKnowledgeGraph);
}

// ---------- Revenue loop ----------
async function renderRevenue() {
  const d = await api('/api/revenue');
  const canM = hasPermC('revenue.manage');
  const canInv = hasPermC('revenue.invoice');
  const max = Math.max(...d.funnel.map((f) => f.count), 1);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Deals moving', d.counts.inFlight, 'somewhere on the path')}
    ${tile('Value in flight', `${Number(d.counts.valueInFlight).toLocaleString()}`, 'not yet collected')}
    ${tile('Collected', `${Number(d.counts.collected).toLocaleString()}`, 'paid or delivered', d.counts.collected ? 'tile-ok' : '')}
    ${tile('Waiting on a person', d.waitingOnAPerson.length, 'signing and money never happen alone', d.waitingOnAPerson.length ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title">The path — a name on a list to money in the account</div>
    <div style="display:flex;gap:6px;align-items:flex-end;margin:16px 0 8px">
      ${d.funnel.map((f, i) => `
        <div style="flex:1;text-align:center">
          <div class="mono" style="font-size:18px;color:${f.count ? 'var(--ember)' : 'var(--ink-faint)'}">${f.count}</div>
          <div style="height:${8 + (f.count / max) * 90}px;background:linear-gradient(180deg,var(--ember),transparent);border-radius:4px 4px 0 0;opacity:${f.count ? 0.85 : 0.15}"></div>
          <div class="sub" style="font-size:10px;margin-top:4px">${esc(f.stage)}</div>
          ${d.conversion[i]?.fromPrevious !== null && d.conversion[i]?.fromPrevious !== undefined ? `<div class="sub mono" style="font-size:9px">${d.conversion[i].fromPrevious}%</div>` : ''}
        </div>`).join('')}
    </div>
    <div class="map-legend">Every hop that touches somebody outside goes through the gate, so it obeys the allowlist, the quota and the constitution. The two hops that cannot be undone — agreeing and taking money — stop for a person. The loop runs itself right up to the moment somebody is genuinely needed, and then waits.</div>
    ${canM ? `<div class="form-inline">${xbtn('/api/revenue/source', { limit: 3 }, 'Source new deals from intelligence', 'btn-primary')} ${xbtn('/api/revenue/tick', {}, 'Move everything that can move')}</div>` : ''}
  </div>

  <div class="panel">
    <div class="panel-title">Deals</div>
    <table><thead><tr><th>#</th><th>Who</th><th>Stage</th><th>Value</th><th>Owner</th><th></th></tr></thead><tbody>
    ${d.deals.map((x) => `<tr><td class="mono">${x.id}</td><td><b>${esc(x.name)}</b></td>
      <td><span class="chip ${['paid', 'delivered'].includes(x.stage) ? 'chip-ok' : ['proposal', 'agreed'].includes(x.stage) ? 'chip-warn' : 'chip-dim'}">${esc(x.stage || 'sourced')}</span></td>
      <td class="num mono">${x.value_usd ? `${Number(x.value_usd).toLocaleString()}` : '—'}</td>
      <td class="mono sub">${esc(x.owner || '—')}</td>
      <td>
        ${canM ? `<button class="btn btn-sm" data-outreach="${x.id}">Send the approach</button>` : ''}
        ${canInv && ['proposal', 'agreed'].includes(x.stage) ? `<button class="btn btn-sm btn-primary" data-invoice="${x.id}">Invoice</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="empty">No deals yet — source some from intelligence.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Recent moves</div>
    <table><tbody>
    ${d.recentMoves.map((m) => `<tr><td class="mono">deal ${m.deal}</td>
      <td class="mono sub">${esc(m.payload.from)} → <b>${esc(m.payload.to)}</b></td>
      <td class="mono sub">${esc(String(m.occurred_at).slice(5, 16))}</td></tr>`).join('')
      || '<tr><td class="empty">Nothing has moved yet.</td></tr>'}
    </tbody></table>
  </div>`;

  wireXact(renderRevenue);
  view.querySelectorAll('[data-outreach]').forEach((b) => b.addEventListener('click', async () => {
    const to = prompt('Send the drafted approach to which address?');
    if (!to) return;
    try {
      const r = await api(`/api/revenue/${b.dataset.outreach}/outreach`, { method: 'POST', body: { to } });
      toast(`${r.verdict}${r.why ? ` — ${r.why}` : ''}`, r.verdict === 'blocked');
      renderRevenue();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-invoice]').forEach((b) => b.addEventListener('click', async () => {
    const amount = prompt('Invoice how much, in dollars?');
    if (!amount) return;
    try { await api(`/api/revenue/${b.dataset.invoice}/invoice`, { method: 'POST', body: { amountUsd: Number(amount) } }); toast('Invoiced'); renderRevenue(); }
    catch (e) { toast(e.message, true); }
  }));
}

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

// ---------- The iteration engine: workstreams, auditor, sprints ----------
const METHOD_HINT = {
  waterfall: 'One pass per department with a gate between phases — a failed audit stops for a human instead of silently looping.',
  scrum: 'Fixed iterations with a cycle budget; quality that misses the bar carries into the next round.',
  kaizen: 'Keeps improving until the audit clears your target or the cycle budget is spent.',
};
const scoreChip = (s) => s == null ? '<span class="chip chip-dim">—</span>'
  : `<span class="chip ${s >= 0.85 ? 'chip-ok' : s >= 0.6 ? 'chip-warn' : 'chip-bad'}">${Math.round(s * 100)}%</span>`;

async function renderWorkstreams() {
  const d = await api('/api/workstreams');
  const canM = hasPermC('workstreams.manage');
  const waiting = d.workstreams.filter((w) => w.state === 'awaiting_human').length;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Running', d.workstreams.filter((w) => w.state === 'running').length, 'cycling right now')}
    ${tile('Waiting on you', waiting, 'a human decision unblocks them', waiting ? 'tile-warn' : '')}
    ${tile('Rounds run', d.workstreams.reduce((a, w) => a + w.cycles, 0), 'produce → review → audit')}
    ${tile('Accepted', d.workstreams.filter((w) => w.state === 'done').length, 'closed by a human')}
  </div>
  <div class="panel">
    <div class="panel-title">Start a workstream — pick the methodology the work actually needs</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap;gap:8px">
      <input id="ws-title" placeholder="title" style="width:220px">
      <select id="ws-method" style="width:auto">${Object.entries(d.methods).map(([k, m]) => `<option value="${k}" ${k === 'kaizen' ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <input id="ws-target" type="number" step="0.05" min="0.5" max="1" value="0.85" title="quality target" style="width:80px">
      <input id="ws-cycles" type="number" min="1" max="8" value="4" title="cycle budget" style="width:70px">
      <select id="ws-reviewers" style="width:auto" title="peer reviewers per round"><option value="1">1 reviewer</option><option value="2" selected>2 reviewers</option><option value="3">3 reviewers</option></select>
      <textarea id="ws-goal" placeholder="the goal — what must exist when this is done" style="width:100%;height:52px"></textarea>
      <div style="width:100%">
        <div class="map-legend" style="margin:0 0 4px">Route — the departments this work travels through, in order (click to toggle):</div>
        <div id="ws-route" class="route-picker">${d.departments.map((dep) => `<button data-dep="${esc(dep)}" class="${['research', 'engineering', 'docs'].includes(dep) ? 'on' : ''}">${esc(dep)}</button>`).join('')}</div>
      </div>
      <button class="btn btn-sm btn-primary" id="ws-go">Start cycling</button>
      <span id="ws-method-hint" class="map-legend" style="margin:0">${esc(METHOD_HINT.kaizen)}</span>
    </div>` : '<div class="map-legend">workstreams.manage required to start one.</div>'}
  </div>
  <div class="panel">
    <div class="panel-title">Workstreams</div>
    <table><thead><tr><th>#</th><th>Title</th><th>Method</th><th>Route</th><th class="num">Round</th><th class="num">Best</th><th>State</th><th></th></tr></thead><tbody>
    ${d.workstreams.map((w) => `<tr>
      <td class="mono">${w.id}</td>
      <td><a href="#/workstreams/${w.id}"><b>${esc(w.title)}</b></a>${w.note ? `<div class="map-legend">${esc(w.note)}</div>` : ''}</td>
      <td><span class="chip chip-ember">${esc(d.methods[w.method]?.label || w.method)}</span></td>
      <td class="mono" style="font-size:10px">${w.route.map((r) => esc(r)).join(' → ')}</td>
      <td class="num mono">${w.current_cycle}/${w.max_cycles}</td>
      <td class="num">${scoreChip(w.best_score)}</td>
      <td><span class="chip ${w.state === 'done' ? 'chip-ok' : w.state === 'awaiting_human' ? 'chip-warn' : w.state === 'cancelled' ? 'chip-dim' : 'chip-ember'}">${esc(w.state)}</span></td>
      <td><a class="btn btn-sm" href="#/workstreams/${w.id}">Open</a></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">No workstreams yet — this is where one-shot tasks become work that improves itself.</td></tr>'}
    </tbody></table>
  </div>`;
  view.querySelectorAll('#ws-route button').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
  $('#ws-method')?.addEventListener('change', (e) => { $('#ws-method-hint').textContent = METHOD_HINT[e.target.value] || ''; });
  $('#ws-go')?.addEventListener('click', async () => {
    const route = [...view.querySelectorAll('#ws-route button.on')].map((b) => b.dataset.dep);
    try {
      const r = await api('/api/workstreams', { method: 'POST', body: {
        title: $('#ws-title').value, goal: $('#ws-goal').value, method: $('#ws-method').value,
        route, qualityTarget: Number($('#ws-target').value), maxCycles: Number($('#ws-cycles').value),
        reviewers: Number($('#ws-reviewers').value),
      } });
      toast('Workstream started — round 1 producing'); location.hash = `#/workstreams/${r.id}`;
    } catch (e) { toast(e.message, true); }
  });
}

async function renderWorkstreamDetail(id) {
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
      <select id="wd-dept" style="width:auto"><option value="">same department</option>${w.route.map((r) => `<option value="${esc(r)}">re-run in ${esc(r)}</option>`).join('')}</select>
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

async function renderAuditor() {
  const d = await api('/api/auditor');
  const canR = hasPermC('auditor.request');
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Average score', d.stats.avgScore == null ? '—' : `${Math.round(d.stats.avgScore * 100)}<span class="unit">%</span>`, 'across every audited department')}
    ${tile('Auditing now', d.stats.running, 'in flight')}
    ${tile('Failed', d.stats.failed, 'rejected by the auditor', d.stats.failed ? 'tile-bad' : '')}
    ${tile('All-time', d.stats.total, 'artifacts judged')}
  </div>
  <div class="panel">
    <div class="panel-title">Send anything to the auditor — one standard, every department</div>
    ${canR ? `<div class="form-inline" style="flex-wrap:wrap">
      <select id="au-type" style="width:auto">
        <option value="content">content item</option><option value="post">social post</option>
        <option value="ticket">support draft</option><option value="release">release notes</option>
        <option value="brand">brand asset</option><option value="bulletin">bulletin</option>
        <option value="irUpdate">investor update</option><option value="boardRecord">board packet</option>
        <option value="finReport">financial report</option><option value="campaign">campaign copy</option>
        <option value="run">agent run</option><option value="cycle">workstream round</option>
      </select>
      <input id="au-id" placeholder="id" style="width:100px">
      <input id="au-dept" placeholder="department (optional)" style="width:150px">
      <button class="btn btn-sm btn-primary" id="au-go">Audit it</button>
    </div>` : '<div class="map-legend">auditor.request required.</div>'}
  </div>
  ${d.byDept.length ? `<div class="panel"><div class="panel-title">Quality by department — worst first</div>
    <table><thead><tr><th>Department</th><th class="num">Audits</th><th style="width:40%">Average</th></tr></thead><tbody>
    ${d.byDept.map((r) => `<tr><td class="mono">${esc(r.dept)}</td><td class="num">${r.n}</td>
      <td><div class="meter-track"><div class="meter-fill ${r.avg < 0.6 ? 'hot' : r.avg >= 0.85 ? 'cool' : ''}" style="width:${Math.round(r.avg * 100)}%"></div></div></td></tr>`).join('')}
    </tbody></table></div>` : ''}
  <div class="panel">
    <div class="panel-title">Audit log</div>
    <table><thead><tr><th>#</th><th>Subject</th><th>Dept</th><th>Score</th><th>Verdict</th><th>Findings</th></tr></thead><tbody>
    ${d.audits.map((a) => `<tr>
      <td class="mono">${a.id}</td><td class="mono">${esc(a.subject_type)} #${esc(a.subject_id)}</td>
      <td class="mono">${esc(a.dept || '—')}</td><td>${a.state === 'running' ? '<span class="chip chip-warn">auditing…</span>' : scoreChip(a.score)}</td>
      <td>${a.verdict ? `<span class="chip ${a.verdict === 'pass' ? 'chip-ok' : a.verdict === 'fail' ? 'chip-bad' : 'chip-warn'}">${esc(a.verdict)}</span>` : ''}</td>
      <td>${(a.findings || []).slice(0, 3).map((f) => `<div class="map-legend">— ${esc(short(f, 110))}</div>`).join('') || (a.summary ? `<div class="map-legend">${esc(short(a.summary, 130))}</div>` : '')}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing audited yet.</td></tr>'}
    </tbody></table>
  </div>`;
  $('#au-go')?.addEventListener('click', async () => {
    try {
      await api('/api/auditor', { method: 'POST', body: { subjectType: $('#au-type').value, subjectId: $('#au-id').value, dept: $('#au-dept').value || null } });
      toast('Auditor working'); renderAuditor();
    } catch (e) { toast(e.message, true); }
  });
}

async function renderSprints() {
  const [sprints, tasks] = await Promise.all([api('/api/sprints'), api('/api/tasks').catch(() => [])]);
  const canM = hasPermC('sprints.manage');
  const backlog = tasks.filter((t) => !t.sprint_id && !['done', 'cancelled'].includes(t.state));
  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">New iteration</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="sp-name" placeholder="sprint name, e.g. Sprint 4" style="width:170px">
      <input id="sp-goal" placeholder="sprint goal — one sentence" style="width:340px">
      <input id="sp-start" type="date" style="width:140px"><input id="sp-end" type="date" style="width:140px">
      <button class="btn btn-sm btn-primary" id="sp-go">Create</button></div>` : ''}
  </div>
  ${sprints.map((s) => {
    const pct = s.tasks.points ? Math.round((s.tasks.pointsDone / s.tasks.points) * 100) : 0;
    return `<div class="panel">
    <div class="panel-title"><span>${esc(s.name)}
      <span class="chip ${s.state === 'closed' ? 'chip-ok' : s.state === 'active' ? 'chip-ember' : 'chip-warn'}">${esc(s.state)}</span>
      ${s.velocity != null ? `<span class="chip chip-dim">velocity ${s.velocity}</span>` : ''}</span>
      <span>${canM && s.state === 'planning' ? xbtn(`/api/sprints/${s.id}/state`, { state: 'active' }, 'Start sprint', 'btn-primary') : ''}
        ${canM && s.state === 'active' ? xbtn(`/api/sprints/${s.id}/state`, { state: 'review' }, 'Go to review') : ''}</span></div>
    ${s.goal ? `<div class="map-legend">${esc(s.goal)}</div>` : ''}
    <div class="form-inline" style="margin-top:6px">
      <span class="chip">${s.tasks.done}/${s.tasks.total} tasks</span>
      <span class="chip">${s.tasks.pointsDone}/${s.tasks.points} points</span>
      <div class="meter-track" style="flex:1"><div class="meter-fill ${pct >= 80 ? 'cool' : ''}" style="width:${pct}%"></div></div>
    </div>
    ${canM && ['planning', 'active'].includes(s.state) && backlog.length ? `<div class="form-inline" style="margin-top:8px">
      <select id="sp-task-${s.id}" style="width:50%">${backlog.map((t) => `<option value="${t.id}">#${t.id} ${esc(short(t.title, 60))}</option>`).join('')}</select>
      <input id="sp-pts-${s.id}" type="number" min="1" max="13" value="3" style="width:70px" title="story points">
      <button class="btn btn-sm" data-assign="${s.id}">Commit to sprint</button></div>` : ''}
    ${s.state === 'review' && canM ? `<div class="form-inline" style="margin-top:8px">
      <input id="sp-retro-${s.id}" placeholder="retrospective — what to change next iteration (required)" style="width:60%">
      <button class="btn btn-sm btn-ok" data-close="${s.id}">Close with retro</button></div>` : ''}
    ${s.retro ? `<div class="map-legend"><b>Retro:</b> ${esc(s.retro)}</div>` : ''}
  </div>`;
  }).join('') || '<div class="panel"><div class="empty">No sprints yet.</div></div>'}`;
  wireXact(renderSprints);
  $('#sp-go')?.addEventListener('click', async () => {
    try {
      await api('/api/sprints', { method: 'POST', body: { name: $('#sp-name').value, goal: $('#sp-goal').value || null, startsOn: $('#sp-start').value || null, endsOn: $('#sp-end').value || null } });
      toast('Sprint created'); renderSprints();
    } catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', async () => {
    const sid = b.dataset.assign;
    try {
      await api(`/api/sprints/${sid}/assign`, { method: 'POST', body: { taskId: Number($(`#sp-task-${sid}`).value), points: Number($(`#sp-pts-${sid}`).value) } });
      toast('Committed'); renderSprints();
    } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    const sid = b.dataset.close;
    try { await api(`/api/sprints/${sid}/state`, { method: 'POST', body: { state: 'closed', retro: $(`#sp-retro-${sid}`).value } }); toast('Closed'); renderSprints(); }
    catch (e) { toast(e.message, true); }
  }));
}

// ---------- Marketing department ----------
let mktTab = 'plan';
async function renderMarketingDept() {
  const d = await api('/api/mkt');
  const canM = hasPermC('marketing.manage');
  const f = d.funnel;
  const step = (label, n, sub) => `<div class="fn-step"><b>${n}</b><span>${esc(label)}</span><i>${esc(sub || '')}</i></div>`;
  const tabs = [['plan', 'Plan'], ['channels', 'Channels & spend'], ['calendar', 'Calendar'], ['seo', 'Search'], ['email', 'Lifecycle'], ['team', 'The team']];

  const body = {
    plan: () => `
      <div class="grid grid-2">
        <div class="panel"><div class="panel-title">Who we are talking to</div>
          ${canM ? `<div class="form-inline">
            <input id="pa-name" placeholder="persona name, e.g. Finance Manager in Basra" style="width:280px">
            <input id="pa-seg" placeholder="segment" style="width:140px">
            <button class="btn btn-sm btn-primary" id="pa-go">Draft persona</button></div>` : ''}
          ${d.personas.map((p) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">${p.state === 'active' ? '●' : '○'}</span>
            <b>${esc(p.name)}</b><span class="ms-cnt">${esc(p.job_title || 'drafting…')}</span>
            <div class="ms-lbl">${p.pains ? `<b>pains:</b> ${esc(short(p.pains, 110))}` : ''}${p.channels ? `<br><b>found on:</b> ${esc(short(p.channels, 90))}` : ''}
              ${canM && p.state === 'draft' && p.job_title ? ` <button class="btn btn-sm btn-ok" data-pa="${p.id}">Activate</button>` : ''}</div>
          </div>`).join('') || '<div class="empty">No personas yet — everything downstream guesses without one.</div>'}
        </div>
        <div class="panel"><div class="panel-title">What we promise</div>
          ${canM ? `<div class="form-inline">
            <input id="po-aud" placeholder="audience" style="width:180px">
            <input id="po-pro" placeholder="the promise" style="width:240px">
            <button class="btn btn-sm btn-primary" id="po-go">Sharpen</button></div>` : ''}
          ${d.positioning.map((p) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">${p.state === 'approved' ? '✓' : '○'}</span>
            <b>${esc(p.tagline || p.promise)}</b>
            <div class="ms-lbl">for <b>${esc(p.audience)}</b>${p.category ? ` · in ${esc(p.category)}` : ''}
              ${p.proof ? `<br><b>proof:</b> ${esc(short(p.proof, 120))}` : ''}
              ${p.messages?.length ? `<br>${p.messages.map((m) => `<span class="edge-tag">${esc(short(m, 40))}</span>`).join(' ')}` : ''}
              ${canM && p.state === 'draft' && p.tagline ? ` <button class="btn btn-sm btn-ok" data-po="${p.id}">Approve</button>` : ''}</div>
          </div>`).join('') || '<div class="empty">Nothing positioned yet.</div>'}
        </div>
      </div>`,
    channels: () => `
      <div class="panel"><div class="panel-title">Channel performance — what each one cost and returned</div>
        ${canM ? `<div class="form-inline">
          <select id="cc-camp" style="width:auto">${d.campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">no campaigns</option>'}</select>
          <select id="cc-chan" style="width:auto">${['search', 'social', 'email', 'content', 'events', 'partners', 'outbound'].map((c) => `<option>${c}</option>`).join('')}</select>
          <input id="cc-bud" type="number" placeholder="budget $" style="width:110px">
          <button class="btn btn-sm btn-primary" id="cc-go">Plan channel</button></div>` : ''}
        <table><thead><tr><th>Channel</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Customers</th><th class="num">CAC</th><th>Verdict</th></tr></thead><tbody>
        ${d.channels.map((c) => {
          const v = d.verdicts.find((x) => x.channel === c.channel);
          return `<tr><td><b>${esc(c.channel)}</b></td>
            <td class="num mono">${money(c.budget)}</td><td class="num mono">${money(c.spent)}</td>
            <td class="num mono">${c.impressions}</td><td class="num mono">${c.clicks}</td><td class="num mono">${c.ctr ?? '—'}%</td>
            <td class="num mono">${c.leads}</td><td class="num mono">${c.cpl ? money(c.cpl) : '—'}</td>
            <td class="num mono">${c.customers}</td><td class="num mono">${c.cac ? money(c.cac) : '—'}</td>
            <td><span class="chip ${v?.verdict === 'paying' ? 'chip-ok' : v?.verdict === 'expensive' ? 'chip-bad' : 'chip-dim'}" title="${esc(v?.detail || '')}">${esc(v?.verdict || '—')}</span></td></tr>`;
        }).join('') || '<tr><td colspan="11" class="empty">No channel has been planned yet.</td></tr>'}
        </tbody></table>
      </div>
      <div class="panel"><div class="panel-title">Campaigns and their channel plans</div>
        ${d.campaigns.map((c) => `<div class="ms-row" style="cursor:default">
          <span class="ms-dir">${c.state === 'live' ? '●' : '○'}</span><b>${esc(c.name)}</b>
          <span class="ms-cnt">${money(c.budget_usd)}</span>
          <div class="ms-lbl">${c.channels.length ? c.channels.map((x) => `<span class="edge-tag">${esc(x.channel)} ${money(x.spent_usd)}/${money(x.budget_usd)}</span>`).join(' ') : 'no channels planned'}</div>
        </div>`).join('') || '<div class="empty">No campaigns.</div>'}
      </div>`,
    calendar: () => `
      <div class="panel"><div class="panel-title">Editorial calendar — planned against the funnel, not the mood</div>
        ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
          <input id="cal-t" placeholder="title" style="width:240px">
          <select id="cal-ch" style="width:auto">${['blog', 'social', 'email', 'video', 'landing'].map((x) => `<option>${x}</option>`).join('')}</select>
          <select id="cal-st" style="width:auto">${['awareness', 'consideration', 'decision', 'retention'].map((x) => `<option>${x}</option>`).join('')}</select>
          <select id="cal-pa" style="width:auto"><option value="">— persona —</option>${d.personas.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <input id="cal-due" type="date" style="width:150px">
          <button class="btn btn-sm btn-primary" id="cal-go">Add to calendar</button></div>` : ''}
        <table><thead><tr><th>Due</th><th>Title</th><th>Channel</th><th>Stage</th><th>Persona</th><th>State</th><th></th></tr></thead><tbody>
        ${d.calendar.map((c) => `<tr>
          <td class="mono">${esc(c.due_date || '—')}</td><td>${esc(c.title)}</td>
          <td class="mono">${esc(c.channel)}</td><td><span class="edge-tag">${esc(c.stage)}</span></td>
          <td>${esc(c.persona || '—')}</td>
          <td><span class="chip ${c.state === 'published' ? 'chip-ok' : c.state === 'ready' ? 'chip-warn' : 'chip-dim'}">${esc(c.state)}</span></td>
          <td>${canM && c.state === 'idea' ? `<button class="btn btn-sm" data-comm="${c.id}">Commission</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">Calendar is empty.</td></tr>'}
        </tbody></table>
      </div>`,
    seo: () => `
      <div class="panel"><div class="panel-title">Search — the queries worth winning</div>
        ${canM ? `<div class="form-inline">
          <input id="seo-t" placeholder="topic, e.g. invoice data extraction" style="width:280px">
          <select id="seo-l" style="width:auto"><option value="en">English</option><option value="ar">العربية</option></select>
          <button class="btn btn-sm btn-primary" id="seo-go">Research</button></div>
          <div class="map-legend">The SEO lead returns keywords with intent and difficulty. Volumes stay empty unless real data is supplied — an invented number is worse than none.</div>` : ''}
        <table><thead><tr><th>Keyword</th><th>Lang</th><th>Intent</th><th class="num">Difficulty</th><th class="num">Priority</th></tr></thead><tbody>
        ${d.keywords.map((k) => `<tr><td>${esc(k.keyword)}</td><td class="mono">${esc(k.language)}</td>
          <td><span class="edge-tag">${esc(k.intent || '—')}</span></td>
          <td class="num mono">${k.difficulty ?? '—'}</td><td class="num mono">${k.priority}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No keywords yet.</td></tr>'}
        </tbody></table>
      </div>`,
    email: () => `
      <div class="panel"><div class="panel-title">Lifecycle sequences</div>
        ${canM ? `<div class="form-inline">
          <input id="sq-n" placeholder="sequence name" style="width:180px">
          <input id="sq-g" placeholder="goal" style="width:240px">
          <button class="btn btn-sm btn-primary" id="sq-go">Write it</button></div>` : ''}
        ${d.sequences.map((s) => `<div class="panel" style="background:var(--bg-sunk);margin-top:10px">
          <div class="panel-title"><span>${esc(s.name)} <span class="chip ${s.state === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(s.state)}</span></span>
            <span>${canM && s.state === 'ready' ? xbtn(`/api/mkt/sequences/${s.id}/state`, { state: 'live' }, 'Set live', 'btn-ok') : ''}</span></div>
          <div class="map-legend">${esc(s.goal || '')}</div>
          ${(s.steps || []).map((x) => `<div class="ms-row" style="cursor:default">
            <span class="ms-dir">D${x.day ?? '?'}</span><b>${esc(x.subject || '')}</b>
            <div class="ms-lbl">${esc(short(x.body || '', 220))}</div></div>`).join('') || '<div class="map-legend">⏳ being written…</div>'}
        </div>`).join('') || '<div class="empty">No sequences yet.</div>'}
      </div>`,
    team: () => `
      <div class="panel"><div class="panel-title">The marketing team — real employees on the roster</div>
        <div class="map-legend">Mention any of them by ID in <a href="#/chat">the floor</a> and give them work directly.</div>
        <table><thead><tr><th>Employee</th><th>Speciality</th><th>Mission</th><th class="num">In flight</th><th>Status</th></tr></thead><tbody>
        ${d.team.map((m) => `<tr>
          <td class="mono">${esc(m.id)}<div class="map-legend">${esc(m.name)}</div></td>
          <td><span class="edge-tag">${esc(m.speciality)}</span></td>
          <td>${esc(m.mission)}</td>
          <td class="num mono">${m.load}</td>
          <td><span class="chip ${m.status === 'active' ? 'chip-ok' : 'chip-bad'}">${esc(m.status)}</span></td>
        </tr>`).join('')}
        </tbody></table>
      </div>`,
  };

  view.innerHTML = `
  <div class="panel">
    <div class="panel-title">The funnel — measured, not assumed</div>
    <div class="funnel">
      ${step('impressions', f.impressions, '')}
      ${step('clicks', f.clicks, f.ctr !== null ? `${f.ctr}% CTR` : '')}
      ${step('leads', f.leads, f.leadRate !== null ? `${f.leadRate}% of clicks` : '')}
      ${step('customers', f.customers, f.closeRate !== null ? `${f.closeRate}% of leads` : '')}
    </div>
    <div class="form-inline" style="margin-top:10px">
      <span class="chip">spent ${money(f.spent)} of ${money(f.budget)}</span>
      <span class="chip ${f.cac ? 'chip-warn' : 'chip-dim'}">CAC ${f.cac ? money(f.cac) : '—'}</span>
      <span class="chip chip-ok">attributed MRR ${money(f.mrrAttributed)}</span>
      <span class="chip">payback ${f.paybackMonths ? `${f.paybackMonths} mo` : '—'}</span>
      <span class="chip chip-dim">${d.stats.personas} personas · ${d.stats.liveCampaigns} live campaigns · ${d.stats.plannedContent} pieces planned · ${d.stats.keywords} keywords · ${d.stats.sequencesLive} sequences live</span>
    </div>
  </div>
  <div class="map-style-picker" style="margin-bottom:12px">
    ${tabs.map(([k, l]) => `<button data-mtab="${k}" class="${mktTab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}
  </div>
  ${(body[mktTab] || body.plan)()}`;

  view.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => { mktTab = b.dataset.mtab; renderMarketingDept(); }));
  wireXact(renderMarketingDept);
  const post = async (path, payload, msg) => {
    try { await api(path, { method: 'POST', body: payload }); toast(msg); renderMarketingDept(); }
    catch (e) { toast(e.message, true); }
  };
  $('#pa-go')?.addEventListener('click', () => post('/api/mkt/personas', { name: $('#pa-name').value, segment: $('#pa-seg').value || null }, 'Persona drafting'));
  $('#po-go')?.addEventListener('click', () => post('/api/mkt/positioning', { audience: $('#po-aud').value, promise: $('#po-pro').value }, 'Sharpening'));
  $('#cc-go')?.addEventListener('click', () => post('/api/mkt/channels', { campaignId: Number($('#cc-camp').value), channel: $('#cc-chan').value, budgetUsd: Number($('#cc-bud').value) || 0 }, 'Channel planned'));
  $('#cal-go')?.addEventListener('click', () => post('/api/mkt/calendar', { title: $('#cal-t').value, channel: $('#cal-ch').value, stage: $('#cal-st').value, personaId: Number($('#cal-pa').value) || null, dueDate: $('#cal-due').value || null }, 'Added'));
  $('#seo-go')?.addEventListener('click', () => post('/api/mkt/seo', { topic: $('#seo-t').value, language: $('#seo-l').value }, 'Researching'));
  $('#sq-go')?.addEventListener('click', () => post('/api/mkt/sequences', { name: $('#sq-n').value, goal: $('#sq-g').value }, 'Writing'));
  view.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/personas/${b.dataset.pa}/state`, { state: 'active' }, 'Activated')));
  view.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/positioning/${b.dataset.po}/approve`, {}, 'Approved')));
  view.querySelectorAll('[data-comm]').forEach((b) => b.addEventListener('click', () => post(`/api/mkt/calendar/${b.dataset.comm}/commission`, {}, 'Commissioned — the studio is writing it')));
}

// ---------- Money desk ----------
async function renderMoney() {
  const d = await api('/api/money');
  const canM = hasPermC('money.manage');
  const p = d.policy;
  const pos = d.position;
  const maxSpend = Math.max(...d.history.map((h) => h.spend), 0.0001);
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Runway', pos.runwayMonths === null ? '∞' : `${pos.runwayMonths}<span class="unit">mo</span>`, `floor is ${p.min_runway_mo} months`, pos.runwayMonths !== null && pos.runwayMonths < p.min_runway_mo ? 'tile-bad' : 'tile-steel')}
    ${tile('Recurring revenue', money(pos.recurringUsd), 'active customers, per month')}
    ${tile('Monthly burn', money(pos.burnMonthlyUsd), `models ${money(pos.modelMonthUsd)} · vendors ${money(pos.vendorMonthlyUsd)}`, pos.burnMonthlyUsd > pos.recurringUsd ? 'tile-warn' : '')}
    ${tile('Committed', money(pos.committedUsd), `pipeline ${money(pos.pipelineUsd)} · payouts pending ${pos.payoutsPending}`)}
  </div>

  <div class="panel">
    <div class="panel-title">What the desk is telling you</div>
    ${d.alerts.map((a) => `<div class="map-legend" style="color:${a.level === 'crit' ? 'var(--bad)' : a.level === 'warn' ? 'var(--warn)' : 'var(--ink-mute)'}">
      ${a.level === 'crit' ? '⛔' : a.level === 'warn' ? '⚠' : '✓'} ${esc(a.text)}</div>`).join('')}
  </div>

  <div class="grid grid-2">
    <div class="panel">
      <div class="panel-title">Allocation policy — what the company promised itself</div>
      <table><thead><tr><th>Bucket</th><th class="num">Policy</th><th class="num">Target</th><th class="num">Allocated</th></tr></thead><tbody>
      ${d.buckets.map((b) => `<tr>
        <td><b>${esc(b.id)}</b><div class="map-legend">${esc(b.why)}</div></td>
        <td class="num mono">${b.pct}%</td><td class="num mono">${money(b.target)}</td><td class="num mono">${money(b.allocated)}</td>
      </tr>`).join('')}
      </tbody></table>
      ${canM ? `<div class="form-inline" style="margin-top:10px">
        <input id="m-res" type="number" value="${p.reserve_pct}" style="width:80px" title="reserve %">
        <input id="m-opex" type="number" value="${p.opex_pct}" style="width:80px" title="opex %">
        <input id="m-grow" type="number" value="${p.growth_pct}" style="width:80px" title="growth %">
        <input id="m-run" type="number" value="${p.min_runway_mo}" style="width:80px" title="min runway months">
        <button class="btn btn-sm btn-primary" id="m-set">Set policy</button>
      </div><div class="map-legend">reserve · opex · growth must add up to 100</div>` : ''}
    </div>
    <div class="panel">
      <div class="panel-title">Crypto received</div>
      <table><tbody>${d.position.cryptoReceived.map((c) => `<tr><td class="mono">${esc(c.asset)}</td><td class="num mono">${c.total}</td><td class="num">${c.invoices} invoice${c.invoices > 1 ? 's' : ''}</td></tr>`).join('') || '<tr><td class="empty">Nothing settled yet.</td></tr>'}</tbody></table>
      <div class="panel-title" style="margin-top:14px">Model spend, 14 days</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:70px">
        ${d.history.map((h) => `<div title="${esc(h.day)}: ${money(h.spend)}" style="flex:1;background:var(--ember);opacity:.7;border-radius:2px 2px 0 0;height:${Math.max(3, (h.spend / maxSpend) * 64)}px"></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Money moves — every allocation with a reason attached</div>
    ${canM ? `<div class="form-inline">
      <select id="mv-kind" style="width:auto"><option value="allocation">allocation</option><option value="transfer">transfer</option><option value="writeoff">writeoff</option><option value="note">note</option></select>
      <select id="mv-bucket" style="width:auto"><option value="">— bucket —</option><option>reserve</option><option>opex</option><option>growth</option></select>
      <input id="mv-amt" type="number" step="0.01" placeholder="amount" style="width:110px">
      <input id="mv-why" placeholder="reason" style="width:280px">
      <button class="btn btn-sm" id="mv-add">Record</button></div>` : ''}
    <table><thead><tr><th>Kind</th><th>Bucket</th><th class="num">Amount</th><th>Reason</th><th>By</th></tr></thead><tbody>
    ${d.moves.map((m) => `<tr><td class="mono">${esc(m.kind)}</td><td class="mono">${esc(m.bucket || '—')}</td>
      <td class="num mono">${money(m.amount)}</td><td>${esc(m.reason)}</td><td class="mono" style="font-size:10px">${esc(m.decided_by)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No moves recorded.</td></tr>'}
    </tbody></table>
  </div>`;
  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderMoney(); } catch (e) { toast(e.message, true); }
  };
  $('#m-set')?.addEventListener('click', () => post('/api/money/policy', { reserve: Number($('#m-res').value), opex: Number($('#m-opex').value), growth: Number($('#m-grow').value), minRunway: Number($('#m-run').value) }, 'Policy set'));
  $('#mv-add')?.addEventListener('click', () => post('/api/money/moves', { kind: $('#mv-kind').value, bucket: $('#mv-bucket').value || null, amount: Number($('#mv-amt').value), reason: $('#mv-why').value }, 'Recorded'));
}

// ---------- Contact centre ----------
async function renderContact() {
  const c = await api('/api/contact');
  const canM = hasPermC('contact.manage');
  const agents = await api('/api/agents').catch(() => []);
  const st = (s) => `<span class="chip ${['completed', 'sent', 'delivered', 'received'].includes(s) ? 'chip-ok' : ['queued', 'drafting', 'ringing', 'live'].includes(s) ? 'chip-warn' : 'chip-dim'}">${esc(s)}</span>`;
  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Calls out', c.stats.callsOut, `${c.stats.awaitingDial} waiting to dial`, c.stats.awaitingDial ? 'tile-warn' : '')}
    ${tile('Calls in', c.stats.callsIn, 'answered by the company number')}
    ${tile('Messages', `${c.stats.messagesOut}/${c.stats.messagesIn}`, 'out / in', '')}
    ${tile('Voices', c.voices.length, 'Arabic and English', 'tile-steel')}
  </div>

  <div class="panel">
    <div class="panel-title"><span>Company numbers</span><span class="chip ${c.mode === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(c.mode)}</span></div>
    <div class="map-legend">${c.mode === 'live'
      ? 'Live: calls and messages go through the carrier.'
      : 'Simulated: the whole flow works and nothing dials. To go live, buy a number from Twilio, add <span class="mono">TWILIO_ACCOUNT_SID</span> and <span class="mono">TWILIO_AUTH_TOKEN</span> in Settings, set <span class="mono">PUBLIC_BASE_URL</span>, and point the number\'s voice webhook at <span class="mono">/webhooks/voice</span> and its messaging webhook at <span class="mono">/webhooks/sms</span>.'}</div>
    ${canM ? `<div class="form-inline">
      <input id="n-num" placeholder="+9647701234567" style="width:190px">
      <input id="n-label" placeholder="label" style="width:160px">
      <button class="btn btn-sm btn-primary" id="n-add">Register number</button></div>` : ''}
    <table><tbody>${c.numbers.map((x) => `<tr><td class="mono">${esc(x.number)}</td><td>${esc(x.label)}</td>
      <td><span class="chip ${x.provider === 'twilio' ? 'chip-ok' : 'chip-dim'}">${esc(x.provider)}</span></td></tr>`).join('') || '<tr><td class="empty">No number yet — register one you own.</td></tr>'}</tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Voices</div>
    <div class="form-inline" style="flex-wrap:wrap">
      ${c.voices.map((v) => `<span class="chip" title="${esc(v.twilio)} · ${esc(v.language)}"><b class="mono">${esc(v.id)}</b> — ${esc(v.label)}</span>`).join('')}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Calls — an employee writes the script, then a human dials</div>
    ${canM ? `<div class="form-inline" style="flex-wrap:wrap">
      <input id="c-to" placeholder="+964..." style="width:150px">
      <input id="c-why" placeholder="purpose of the call" style="width:260px">
      <select id="c-voice" style="width:auto">${c.voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select>
      <select id="c-lang" style="width:auto"><option value="en">English</option><option value="ar">العربية</option></select>
      <select id="c-agent" style="width:auto"><option value="">— any employee —</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="c-add">Queue call</button></div>` : ''}
    <table><thead><tr><th>#</th><th>To</th><th>Purpose</th><th>Voice</th><th>State</th><th></th></tr></thead><tbody>
    ${c.calls.map((x) => `<tr>
      <td class="mono">${x.id}${x.direction === 'in' ? ' ←' : ' →'}</td>
      <td class="mono">${esc(x.direction === 'in' ? x.from_number : x.to_number)}</td>
      <td>${esc(x.purpose || '')}${x.script ? `<div class="map-legend">"${esc(short(x.script, 120))}"</div>` : ''}${x.transcript ? `<div class="map-legend" style="color:var(--steel)">${esc(short(x.transcript, 120))}</div>` : ''}</td>
      <td class="mono">${esc(x.voice)}</td>
      <td>${st(x.state)}${x.outcome ? ` <span class="chip chip-dim">${esc(x.outcome)}</span>` : ''}</td>
      <td>${canM && x.state === 'queued' ? `<button class="btn btn-sm btn-ok" data-dial="${x.id}">Dial</button>` : ''}
          ${canM && x.state === 'completed' && !x.outcome ? `<button class="btn btn-sm" data-disp="${x.id}">Mark reached</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No calls yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Messages — SMS and WhatsApp threads</div>
    ${canM ? `<div class="form-inline">
      <input id="s-to" placeholder="+964..." style="width:150px">
      <input id="s-body" placeholder="message (leave empty to have an employee write it)" style="width:320px">
      <select id="s-chan" style="width:auto"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
      <select id="s-agent" style="width:auto"><option value="">— draft with —</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="s-add">Queue message</button></div>` : ''}
    ${c.threads.map((t) => `<div class="panel" style="margin-top:10px;background:var(--bg-sunk)">
      <div class="panel-title mono" style="font-size:11px">${esc(t.key)} · ${t.count}</div>
      ${t.messages.map((m) => `<div class="ms-row" style="cursor:default">
        <span class="ms-dir">${m.direction === 'in' ? '←' : '→'}</span>
        <b>${esc(m.body === '…' ? 'writing…' : short(m.body, 90))}</b>
        <span class="ms-cnt">${st(m.state)}</span>
        <div class="ms-lbl">${esc(String(m.created_at).slice(0, 16))} · ${esc(m.channel)}${m.agent_id ? ` · ${esc(m.agent_id)}` : ''}
          ${canM && m.state === 'queued' ? `<button class="btn btn-sm btn-ok" data-send="${m.id}">Send</button>` : ''}</div>
      </div>`).join('')}
    </div>`).join('') || '<div class="empty">No messages yet.</div>'}
  </div>`;
  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderContact(); } catch (e) { toast(e.message, true); }
  };
  $('#n-add')?.addEventListener('click', () => post('/api/contact/numbers', { number: $('#n-num').value, label: $('#n-label').value }, 'Number registered'));
  $('#c-add')?.addEventListener('click', () => post('/api/contact/calls', { toNumber: $('#c-to').value, purpose: $('#c-why').value, voice: $('#c-voice').value, language: $('#c-lang').value, agentId: $('#c-agent').value || null }, 'Queued — the script is being written'));
  $('#s-add')?.addEventListener('click', () => post('/api/contact/messages', { toNumber: $('#s-to').value, body: $('#s-body').value || null, channel: $('#s-chan').value, draftWith: $('#s-agent').value || null }, 'Queued'));
  view.querySelectorAll('[data-dial]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/calls/${b.dataset.dial}/place`, {}, 'Dialling')));
  view.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/messages/${b.dataset.send}/send`, {}, 'Sent')));
  view.querySelectorAll('[data-disp]').forEach((b) => b.addEventListener('click', () => post(`/api/contact/calls/${b.dataset.disp}/disposition`, { outcome: 'reached' }, 'Dispositioned')));
}

// ---------- Treasury: the company gets paid in crypto ----------
async function renderTreasury() {
  const t = await api('/api/treasury');
  const canM = hasPermC('treasury.manage');
  const canPay = hasPermC('treasury.pay');
  const chains = Object.entries(t.chains);
  const st = (s) => `<span class="chip ${s === 'paid' ? 'chip-ok' : s === 'open' ? 'chip-warn' : s === 'expired' || s === 'cancelled' ? 'chip-dim' : 'chip-bad'}">${esc(s)}</span>`;

  view.innerHTML = `
  <div class="grid grid-4">
    ${tile('Paid invoices', t.stats.paid, t.revenue.map((r) => `${r.total} ${r.asset}`).join(' · ') || 'nothing settled yet', t.stats.paid ? 'tile-steel' : '')}
    ${tile('Open invoices', t.stats.open, 'watching the chain for these')}
    ${tile('Unattributed', t.stats.unmatched, 'money in with no invoice', t.stats.unmatched ? 'tile-warn' : '')}
    ${tile('Waiting for a signature', t.stats.awaitingSignature, 'payouts a person must release', t.stats.awaitingSignature ? 'tile-warn' : '')}
  </div>

  <div class="panel">
    <div class="panel-title"><span>Wallets — watch-only</span><span class="chip ${t.mode === 'live' ? 'chip-ok' : 'chip-dim'}">${esc(t.mode)}</span></div>
    <div class="map-legend">This platform stores <b>addresses only</b>. No private key, seed phrase or mnemonic is kept here or asked for anywhere — the company can watch money arrive and cannot move it.</div>
    ${canM ? `<div class="form-inline">
      <input id="w-label" placeholder="label, e.g. Main receiving" style="width:180px">
      <select id="w-chain" style="width:auto">${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
      <input id="w-addr" placeholder="public address" style="width:320px">
      <button class="btn btn-sm btn-primary" id="w-add">Add wallet</button>
    </div>` : ''}
    <table><thead><tr><th>Label</th><th>Chain</th><th>Address</th><th class="num">Balance</th><th class="num">Received</th><th></th></tr></thead><tbody>
    ${t.wallets.map((w) => `<tr>
      <td><b>${esc(w.label)}</b><div class="map-legend">${esc(w.kind)}</div></td>
      <td class="mono">${esc(w.chain)} · ${esc(w.asset)}</td>
      <td class="mono" style="font-size:10.5px">${esc(w.address)}${w.explorer ? ` <a href="${esc(w.explorer)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
      <td class="num mono">${w.balance}</td><td class="num mono">${w.received}</td>
      <td>${canM ? `<button class="btn btn-sm btn-bad" data-retire="${w.id}">Retire</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No wallet yet — add a receiving address and the company can start invoicing.</td></tr>'}
    </tbody></table>
  </div>

  <div class="panel">
    <div class="panel-title">Invoices — they settle themselves</div>
    <div class="map-legend">Each invoice carries a unique amount, so an incoming payment is attributed without asking the payer for a memo. When it lands: the invoice closes, the customer goes active, the deal is won, and the audit chain records all three.</div>
    ${canM ? `<div class="form-inline">
      <input id="i-desc" placeholder="what is being billed" style="width:260px">
      <input id="i-amt" type="number" step="0.0001" placeholder="amount" style="width:120px">
      <select id="i-chain" style="width:auto"><option value="">— any wallet —</option>${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="i-add">Issue invoice</button>
    </div>` : ''}
    <table><thead><tr><th>Ref</th><th>For</th><th class="num">Amount</th><th>Pay to</th><th>State</th><th></th></tr></thead><tbody>
    ${t.invoices.map((i) => `<tr>
      <td class="mono">${esc(i.ref)}</td>
      <td>${esc(i.description)}<div class="map-legend">${esc(String(i.created_at).slice(0, 16))} · by ${esc(i.created_by)}</div></td>
      <td class="num mono">${i.amount} ${esc(i.asset)}</td>
      <td class="mono" style="font-size:10px">${esc(i.address || '')}</td>
      <td>${st(i.state)}${i.tx_hash ? `<div class="map-legend mono">${esc(String(i.tx_hash).slice(0, 22))}…</div>` : ''}</td>
      <td>${canM && i.state === 'open' ? `<button class="btn btn-sm" data-cancel="${i.id}">Cancel</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No invoices yet.</td></tr>'}
    </tbody></table>
  </div>

  <div class="grid grid-2">
    <div class="panel"><div class="panel-title">Money in</div>
      <table><tbody>${t.transactions.map((x) => `<tr>
        <td class="mono" style="font-size:10px">${esc(String(x.tx_hash).slice(0, 18))}…</td>
        <td class="num mono">${x.amount} ${esc(x.asset)}</td>
        <td>${x.invoice_id ? '<span class="chip chip-ok">matched</span>' : '<span class="chip chip-warn">unattributed</span>'}</td>
        <td class="mono" style="font-size:10px">${esc(String(x.seen_at).slice(0, 16))}</td>
      </tr>`).join('') || '<tr><td class="empty">Nothing has arrived yet.</td></tr>'}</tbody></table>
    </div>
    <div class="panel"><div class="panel-title">Money out — prepared here, signed elsewhere</div>
      <div class="map-legend">The platform holds no key, so it cannot send. A payout is a request; you sign it in your own wallet and paste the transaction hash back so the ledger matches the chain. <b>Autonomy mode cannot release these.</b></div>
      ${canM ? `<div class="form-inline">
        <input id="p-addr" placeholder="destination address" style="width:220px">
        <select id="p-chain" style="width:auto">${chains.map(([k, c]) => `<option value="${k}">${esc(c.label)}</option>`).join('')}</select>
        <input id="p-amt" type="number" step="0.0001" placeholder="amount" style="width:100px">
        <input id="p-why" placeholder="reason" style="width:180px">
        <button class="btn btn-sm" id="p-add">Prepare payout</button>
      </div>` : ''}
      <table><tbody>${t.payouts.map((p) => `<tr>
        <td>${esc(p.reason)}<div class="map-legend mono">${esc(p.to_address.slice(0, 22))}…</div></td>
        <td class="num mono">${p.amount} ${esc(p.asset)}</td>
        <td>${st(p.state === 'sent' ? 'paid' : p.state)}</td>
        <td>${canPay && p.state === 'prepared' ? `<button class="btn btn-sm btn-ok" data-pay="${p.id}" data-to="approved">Approve</button><button class="btn btn-sm btn-bad" data-pay="${p.id}" data-to="rejected">Reject</button>` : ''}
            ${canPay && p.state === 'approved' ? `<button class="btn btn-sm" data-sent="${p.id}">I signed it →</button>` : ''}</td>
      </tr>`).join('') || '<tr><td class="empty">No payouts prepared.</td></tr>'}</tbody></table>
    </div>
  </div>`;

  const post = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); toast(msg); renderTreasury(); }
    catch (e) { toast(e.message, true); }
  };
  $('#w-add')?.addEventListener('click', () => post('/api/treasury/wallets', { label: $('#w-label').value, chain: $('#w-chain').value, address: $('#w-addr').value }, 'Wallet added — watch-only'));
  $('#i-add')?.addEventListener('click', () => post('/api/treasury/invoices', { description: $('#i-desc').value, amount: Number($('#i-amt').value), chain: $('#i-chain').value || null }, 'Invoice issued'));
  $('#p-add')?.addEventListener('click', () => post('/api/treasury/payouts', { toAddress: $('#p-addr').value, chain: $('#p-chain').value, amount: Number($('#p-amt').value), reason: $('#p-why').value }, 'Prepared — it needs your signature'));
  view.querySelectorAll('[data-retire]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/wallets/${b.dataset.retire}/retire`, {}, 'Retired')));
  view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/invoices/${b.dataset.cancel}/cancel`, {}, 'Cancelled')));
  view.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => post(`/api/treasury/payouts/${b.dataset.pay}/resolve`, { state: b.dataset.to }, `Payout ${b.dataset.to}`)));
  view.querySelectorAll('[data-sent]').forEach((b) => b.addEventListener('click', () => {
    const h = prompt('Paste the transaction hash you signed, so the record matches the chain:');
    if (h) post(`/api/treasury/payouts/${b.dataset.sent}/resolve`, { state: 'sent', txHash: h }, 'Recorded against the chain');
  }));
}

// ---------- The floor: chat between humans and the AI workforce ----------
const chatState = { channel: null, since: 0, thread: null, showRoster: true };
const CHAT_EMOJI = ['👍', '✅', '🔥', '👀', '❓'];

async function renderChat() {
  const ov = await api(`/api/chat?actor=${encodeURIComponent(actor())}`);
  if (!chatState.channel) chatState.channel = ov.channels.find((c) => c.key === 'general')?.id || ov.channels[0]?.id;
  const canPost = hasPermC('chat.post');
  const [data] = await Promise.all([api(`/api/chat/${chatState.channel}`)]);
  const ch = data.channel;
  const msgs = data.messages;
  const roster = ov.roster;

  const who = (id) => {
    if (id.startsWith('human:')) return { name: id.replace('human:', ''), kind: 'human' };
    const a = roster.agents.find((x) => x.id === id);
    return { name: a ? a.name : id, kind: id === 'system' ? 'system' : 'agent', id };
  };
  const linkRefs = (refs) => (refs || []).map((r) => `<a class="chat-ref" href="${linkFor(r.type, r.id) || '#/'}">↗ ${esc(r.label || `${r.type} #${r.id}`)}</a>`).join('');
  const mark = (body) => esc(body)
    .replace(/@([A-Za-z0-9_.\-]+)/g, '<span class="chat-at">@$1</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');

  const bubble = (m) => {
    const w = who(m.author_id);
    const mine = m.author_id === actor();
    return `<div class="chat-msg ${w.kind}${mine ? ' mine' : ''}${m.state === 'thinking' ? ' thinking' : ''}" data-msg="${m.id}">
      <div class="cm-avatar" title="${esc(m.author_id)}">${esc(w.name.slice(0, 2).toUpperCase())}</div>
      <div class="cm-body">
        <div class="cm-head">
          <b>${esc(w.name)}</b>
          <span class="cm-kind">${w.kind === 'agent' ? 'AI employee' : w.kind}</span>
          <span class="cm-time">${esc(String(m.created_at).slice(11, 16))}</span>
          ${m.pinned ? '<span class="chip chip-warn">pinned</span>' : ''}
          ${m.edited_at ? '<span class="cm-time">(edited)</span>' : ''}
        </div>
        <div class="cm-text">${m.state === 'thinking' ? '<span class="cm-typing"><i></i><i></i><i></i></span> thinking…' : mark(m.body)}</div>
        ${m.action ? `<div class="cm-action ${m.action.ok ? 'ok' : 'bad'}">
          <b>${m.action.ok ? '✔ did it' : '✕ refused'}</b> <span class="mono">${esc(m.action.id)}</span> — ${esc(m.action.detail)}</div>` : ''}
        ${m.refs?.length ? `<div class="cm-refs">${linkRefs(m.refs)}</div>` : ''}
        <div class="cm-tools">
          ${CHAT_EMOJI.map((e) => `<button data-react="${m.id}" data-emoji="${e}">${e}</button>`).join('')}
          <button data-thread="${m.id}">reply${m.replies ? ` (${m.replies})` : ''}</button>
          <button data-pin="${m.id}">pin</button>
          ${mine ? `<button data-del="${m.id}">delete</button>` : ''}
        </div>
        ${m.reactions?.length ? `<div class="cm-reacts">${m.reactions.map((r) => `<span title="${esc(r.who || '')}">${esc(r.emoji)} ${r.n}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  };

  view.innerHTML = `
  <div class="chat-wrap">
    <aside class="chat-side">
      <div class="cs-sec">Channels</div>
      ${ov.channels.filter((c) => c.kind !== 'dm').map((c) => `
        <button class="cs-ch ${c.id === chatState.channel ? 'on' : ''}" data-ch="${c.id}">
          <span>#${esc(c.name)}</span>${c.unread ? `<i class="cs-unread">${c.unread}</i>` : ''}
        </button>`).join('')}
      ${ov.channels.some((c) => c.kind === 'dm') ? `<div class="cs-sec">Direct</div>
        ${ov.channels.filter((c) => c.kind === 'dm').map((c) => `
          <button class="cs-ch ${c.id === chatState.channel ? 'on' : ''}" data-ch="${c.id}">
            <span>@${esc(c.name)}</span>${c.unread ? `<i class="cs-unread">${c.unread}</i>` : ''}
          </button>`).join('')}` : ''}
      <div class="cs-sec">People · ${roster.humans.length}</div>
      ${roster.humans.map((h) => `<button class="cs-person" data-dm="${esc(h.id)}" data-name="${esc(h.name)}">
        <span class="cs-dot human"></span>${esc(h.name)}</button>`).join('')}
      <div class="cs-sec">AI workforce · ${roster.agents.filter((a) => a.status === 'active').length}</div>
      ${roster.agents.map((a) => `<button class="cs-person" data-dm="${esc(a.id)}" data-name="${esc(a.id)}"
          title="${esc(a.name)} · ${esc(a.role || '')} · can: ${esc(a.can.join(', ') || 'talk only')}">
        <span class="cs-dot ${a.busy ? 'busy' : a.status === 'active' ? 'on' : 'off'}"></span>
        <span class="mono">${esc(a.id)}</span>${a.busy ? `<i class="cs-unread">${a.busy}</i>` : ''}</button>`).join('')}
    </aside>

    <section class="chat-main">
      <header class="chat-head">
        <div>
          <b>#${esc(ch.name)}</b>
          <div class="chat-topic">${esc(ch.topic || '')}</div>
        </div>
        <div class="chat-stat mono">${ov.stats.messages} msgs · ${ov.stats.fromAgents} from AI · ${ov.stats.actionsTaken} actions${ov.stats.thinking ? ` · ${ov.stats.thinking} thinking` : ''}</div>
      </header>
      <div class="chat-log" id="chat-log">${msgs.length ? msgs.map(bubble).join('') : '<div class="empty">Nobody has said anything here yet. Mention an employee by name — try <span class="mono">@AGT-DOC-001</span> — and it will answer.</div>'}</div>
      ${canPost ? `<div class="chat-compose">
        ${chatState.thread ? `<div class="chat-replying">replying in thread to #${chatState.thread} <button id="chat-unthread">✕</button></div>` : ''}
        <div class="chat-input-row">
          <textarea id="chat-input" rows="2" placeholder="Write to the room. @mention an employee to bring it in — or ask it to start work."></textarea>
          <button class="btn btn-primary" id="chat-send">Send</button>
        </div>
        <div id="chat-suggest" class="chat-suggest" hidden></div>
        <div class="chat-hint">Enter sends · Shift+Enter for a new line · an employee may act on what you ask, within what its role allows</div>
      </div>` : '<div class="chat-hint">chat.post permission required to write here.</div>'}
    </section>
  </div>`;

  const log = $('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  api(`/api/chat/${chatState.channel}/read`, { method: 'POST', body: {} }).catch(() => {});

  view.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { chatState.channel = Number(b.dataset.ch); chatState.thread = null; renderChat(); }));
  view.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', async () => {
    try { const c = await api('/api/chat/dm', { method: 'POST', body: { with: b.dataset.dm } }); chatState.channel = c.id; renderChat(); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.react}/react`, { method: 'POST', body: { emoji: b.dataset.emoji } }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.pin}/pin`, { method: 'POST', body: {} }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/chat/msg/${b.dataset.del}/delete`, { method: 'POST', body: {} }); renderChat(); } catch (e) { toast(e.message, true); }
  }));
  view.querySelectorAll('[data-thread]').forEach((b) => b.addEventListener('click', () => { chatState.thread = Number(b.dataset.thread); renderChat(); }));
  $('#chat-unthread')?.addEventListener('click', () => { chatState.thread = null; renderChat(); });

  const input = $('#chat-input');
  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try { await api(`/api/chat/${chatState.channel}`, { method: 'POST', body: { body, parentId: chatState.thread } }); renderChat(); }
    catch (e) { toast(e.message, true); input.value = body; }
  };
  $('#chat-send')?.addEventListener('click', send);

  // @-autocomplete over every employee and person in the building.
  const suggest = $('#chat-suggest');
  const everyone = [...roster.agents.map((a) => ({ id: a.id, label: `${a.id} — ${a.name}`, can: a.can })),
    ...roster.humans.map((h) => ({ id: h.id.replace('human:', ''), label: `${h.name} (human)`, can: [] }))];
  input?.addEventListener('input', () => {
    const m = input.value.slice(0, input.selectionStart).match(/@([A-Za-z0-9_.\-]*)$/);
    if (!m) { suggest.hidden = true; return; }
    const hits = everyone.filter((e) => e.id.toLowerCase().includes(m[1].toLowerCase())).slice(0, 6);
    suggest.innerHTML = hits.map((h) => `<button data-pick="${esc(h.id)}">${esc(h.label)}${h.can.length ? `<i>${esc(h.can.slice(0, 3).join(', '))}</i>` : ''}</button>`).join('');
    suggest.hidden = !hits.length;
    suggest.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      input.value = input.value.replace(/@([A-Za-z0-9_.\-]*)$/, `@${b.dataset.pick} `);
      suggest.hidden = true; input.focus();
    }));
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') suggest.hidden = true;
  });
}

// ---------- Agent memory ----------
let memSel = null;
async function renderMemory() {
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
    <textarea id="mem-pb" style="width:100%;height:230px;font-family:var(--font-mono);font-size:11.5px" ${canM ? '' : 'readonly'}>${esc(agent.playbook || '')}</textarea>
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

// ---------- live presence ----------
// The pages poll because they always have. This socket is the other half: the
// company as it happens, straight off the audit chain, plus who else is looking
// at what. It is deliberately additive — if the socket never connects, every
// page still works exactly as before on its timer.
let live = null;
let liveWho = [];

function liveBar() {
  let bar = document.getElementById('live-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'live-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

function paintLive(state, entries = []) {
  const bar = liveBar();
  const others = liveWho.filter((w) => w.who !== (currentUser?.display_name || currentUser?.username));
  bar.className = state;
  bar.innerHTML = `
    <span class="lb-dot"></span>
    <span class="lb-txt">${state === 'on' ? esc(t('live')) : esc(t('reconnecting…'))}</span>
    ${others.length ? `<span class="lb-who">${others.slice(0, 4).map((w) => `<b title="${esc(w.pages.join(', '))}">${esc(w.who)}</b>`).join(' · ')}${others.length > 4 ? ` +${others.length - 4}` : ''}</span>` : ''}
    ${entries.length ? `<span class="lb-feed">${entries.slice(-2).map((e) => `<span class="mono">${esc(e.action)}</span> <span class="lb-actor">${esc(e.actor_id)}</span>`).join(' · ')}</span>` : ''}`;
}

function connectLive() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || live?.readyState === WebSocket.OPEN) return;
  try {
    live = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live?token=${encodeURIComponent(token)}`);
  } catch { return; }
  live.addEventListener('open', () => {
    paintLive('on');
    live.send(JSON.stringify({ type: 'at', page: currentRoute().key || 'overview' }));
  });
  live.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'hello' || msg.type === 'presence') { liveWho = msg.who || []; paintLive('on'); }
    if (msg.type === 'chain') {
      paintLive('on', msg.entries);
      // A page showing a list of things that just changed should not wait for
      // its next tick — but only if nobody is typing into it.
      const key = currentRoute().key;
      const touched = msg.entries.some((e) => (e.action || '').startsWith(key));
      if (touched && routes[key]?.poll && !pollPaused()) routes[key].render(currentRoute().arg).then(() => translateDom(view)).catch(() => {});
    }
  });
  live.addEventListener('close', () => { paintLive('off'); setTimeout(connectLive, 4000); });
  live.addEventListener('error', () => { try { live.close(); } catch { /* closing anyway */ } });
}

window.addEventListener('hashchange', () => {
  if (live?.readyState === WebSocket.OPEN) live.send(JSON.stringify({ type: 'at', page: currentRoute().key || 'overview' }));
});

// boot — authenticate first, then bring up the console.
(async function boot() {
  initShell();
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    paintUser();
    await loadCatalog();
    refreshShell();
    navigate();
    connectLive();
  } catch { showLogin(); }
})();
