// AlphaCore console — vanilla SPA, hash routing, 5s polling on live pages.
import { t, lang, setLang, applyLang, translateDom, sectionName, divisionName, DIV_AR } from '/i18n.js';
import { $, esc, linkFor, money, money4, short, toast, view } from '/core/dom.js';
import { TOKEN_KEY, actor, currentUser, hasPermC, navPerm, setCurrentUser } from '/state/session.js';
import { api, downloadFile, setUnauthorizedHandler } from '/services/api.js';
import { routes, registerRoutes } from '/router/registry.js';
import { renderWorkforce2, renderOrgChart, renderBridges, renderDocs, renderTime, renderMeetings, renderFinOps, renderProcure, renderTalent, renderGalaxies } from '/departments/core2.js';
import { renderHrOps, renderComp, renderBudgets2, renderPayables, renderReceivables, renderFixedAssets, renderBank, renderInventory, renderFacilities, renderHelpdesk, renderSecretariat, renderLegalCases, renderRegulatory, renderMe } from '/departments/core2b.js';
import { CATALOG, SURFACE_LABEL, SURFACE_ORDER, afterRender, currentRoute, holdPoll, initShell, loadCatalog, navGeneration, navigate, pollPaused, routeOf } from '/core/shell.js';
import { tile } from '/components/tile.js';
import { CHAT_EMOJI, REQ_STATE_CLS, bubble, chatState, connBtn, renderConnections, wireConnections, wireDownloads } from '/components/common.js';
import { DEPT_LABEL, disablePush, enablePush, paintUser, preBody, pushState, refreshShell, scoreChip, wireXact, xbtn } from '/components/chrome.js';
import { DEPT_COLORS, DS_SOURCE_ICON, ENRICH_CHIP, GROUP_COLOR, METHOD_HINT, MOOD, contactCell, figure, initials, peopleBlock } from '/components/bits.js';
import { makeDeptRenderer } from '/components/dept-page.js';
import { EDGE_KIND, PLATFORM_ICONS, certificationPanel, flowLegend, mktState, mktTab, renderWebPage, stateChip, verdictChip } from '/components/widgets.js';
import { renderChat, renderHunt, renderRequests } from '/departments/ask.js';
import { renderApprovals, renderAuditor, renderBudgets, renderDecisions, renderEvals, renderGate, renderPmo, renderQuality, renderRisks, renderSimulation } from '/departments/approvals.js';
import { renderAgents, renderArtifacts, renderCapacity, renderDeadletter, renderInfra, renderJobs, renderJourneys, renderLab, renderPackages, renderPipelines, renderProducts, renderProjects, renderProviders, renderReleases, renderRuns, renderSprints, renderSystems, renderTasksPage, renderTiers, renderWorkforce, renderWorkstreams } from '/departments/work.js';
import { renderArchive, renderDatasets, renderEmbeddings, renderInsights, renderIntel, renderKnowledge, renderKnowledgeGraph, renderSegments } from '/departments/intelligence.js';
import { renderBookkeeper, renderCustomers, renderEconomics, renderFinReports, renderFinance, renderFinops, renderLedger, renderMoney, renderPartnerships, renderProcurement, renderRelations, renderRevenue, renderSales, renderTax, renderTreasury } from '/departments/money.js';
import { renderAttribution, renderBrand, renderBrowser, renderCalendar, renderCommunity, renderConnectors, renderContact, renderContent, renderDeliverability, renderDesign, renderEgress, renderEvents, renderGrowth, renderHelp, renderKeys, renderLifecycle, renderMarketing, renderMarketingDept, renderMcp, renderMktOps, renderPages, renderPaidMedia, renderPersonas, renderPositioning, renderPress, renderSeo, renderSocial, renderStatus, renderSupport, renderTenants, renderVault, renderWeb, renderWebhooks } from '/departments/world.js';
import { renderAnchors, renderAudit, renderAutopilot, renderBackups, renderBoard, renderChief, renderComms, renderCompliance, renderConstitution, renderContinuity, renderDataGov, renderErasure, renderGovernance, renderHarmony, renderIncidents, renderIp, renderIr, renderLegal, renderObjectives, renderObservability, renderObserve, renderOversight, renderPrivacy, renderProvenance, renderRedteam, renderRoles, renderScorecard, renderSecurity, renderSettings, renderStanding, renderSustainability, renderTimeMachine, renderUsers, renderVendors } from '/departments/company.js';
import { atlasGoTo, atlasStep, atlasZoom, buildMap, buildSystemMap, initAtlas, initMapInteractivity, mapChip, mapEdge, mapNode } from '/views/map.js';
import { renderAcademy, renderAsk, renderDecisionDetail, renderDepartments, renderDesignDoc, renderDisputes, renderGraph, renderJourneyDetail, renderMemory, renderOffices, renderOrg, renderOverview, renderOwner, renderPackageSection, renderPeople, renderRecruiting, renderRequestDetail, renderSkills, renderSociety, renderSurfaceRoute, renderTrust, renderWorkstreamDetail } from '/departments/people.js';







function showLogin() {
  const el = $('#login');
  if (!el.hidden) return;
  el.hidden = false;
  $('#login-user').focus();
}

// The API layer refuses to import a view, so the view registers itself. Until
// this line runs a 401 does nothing, which is correct during boot and wrong
// everywhere after it.
setUnauthorizedHandler(showLogin);


/** Show the choose-a-password form instead of the sign-in one. */
function showPasswordChange() {
  $('#login').hidden = false;
  $('#login-form').hidden = true;
  $('#pw-form').hidden = false;
  $('#login-err').textContent = '';
  $('#pw-current').focus();
}

// Both forms submit rather than listening for clicks, so Enter works from any
// field and the browser offers to save the credentials.
$('#login-form').addEventListener('submit', (e) => { e.preventDefault(); doLogin(); });
let failedLogins = 0;

async function doLogin() {
  $('#login-err').textContent = '';
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      // Trimmed, because a password copied from a console or a message often
      // arrives with a space on the end, and "invalid credentials" is a cruel
      // way to report a space. The code too: authenticator apps show it as
      // "123 456" and people copy the space with it.
      body: {
        username: $('#login-user').value.trim(),
        password: $('#login-pass').value.trim(),
        code: $('#login-code')?.value.trim() || undefined,
      },
    });

    // The password was right and a second factor is set up. Ask for it here
    // rather than throwing them back to an empty form.
    if (r.secondFactorRequired) {
      $('#login-2fa').hidden = false;
      $('#login-code').focus();
      $('#login-err').textContent = t('Enter the code from your authenticator');
      return;
    }
    localStorage.setItem(TOKEN_KEY, r.token);
    failedLogins = 0;
    // A generated password gets you exactly this far.
    if (r.user?.mustChangePassword) {
      $('#pw-current').value = $('#login-pass').value.trim();
      showPasswordChange();
      return;
    }
    location.reload();
  } catch (e) {
    failedLogins++;
    // "Invalid credentials" twice in a row usually means one of three things,
    // and none of them is visible from the screen: the browser filled in a
    // password it saved earlier, the one being typed is from an older reset,
    // or a character went astray. Say so rather than repeating the refusal.
    $('#login-err').innerHTML = failedLogins >= 2
      ? `${esc(e.message)}<span class="login-hint">${esc(t('If your browser filled the password in for you, clear the field and type it by hand. A new one can be issued on the machine itself with: npm run reset-password'))}</span>`
      : esc(e.message);
  }
}

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-err');
  err.textContent = '';
  const next = $('#pw-next').value;
  if (next !== $('#pw-again').value) { err.textContent = t('Those two do not match'); return; }
  try {
    await api('/api/auth/password', { method: 'POST', body: { current: $('#pw-current').value, next } });
    // Changing the password ends every session, including this one — so the
    // honest next step is to sign in again rather than to pretend otherwise.
    localStorage.removeItem(TOKEN_KEY);
    $('#pw-form').hidden = true;
    $('#login-form').hidden = false;
    $('#login-user').value = '';
    $('#login-pass').value = '';
    if ($('#login-code')) { $('#login-code').value = ''; $('#login-2fa').hidden = true; }
    err.style.color = 'var(--ok)';
    err.textContent = t('Password set. Sign in with it.');
    $('#login-user').focus();
  } catch (e2) { err.textContent = e2.message; }
});




































































// The shape of the whole console, in one place. A named declaration rather
// than a bare statement on purpose: the module splitter draws boundaries
// between top-level declarations, so a 165-line top-level *statement* is
// carried along by whichever declaration sits above it. This owns its span.
const ROUTE_TABLE = {
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
  ledger: { title: 'Ledger', render: renderLedger },
  bookkeeper: { title: 'Bookkeeper', render: renderBookkeeper },
  hunt: { title: 'Hunt', render: renderHunt },

  // The eight doors, plus the full list behind them.
  //
  // Namespaced under `#/s/` on purpose. Three of the surface names — approvals,
  // money, people — are also department names with pages of their own that have
  // worked since the beginning. A surface route called `#/people` would not
  // 404; it would quietly open the wrong page, which is worse, and no test that
  // only checks for 404s would ever catch it.
  ask: { title: 'Ask AlphaCore — say what you need', render: renderAsk },

  // Core 2 — the enterprise galaxy. Same rail, same sweep, same catalogue as
  // the hundred and forty; the seam is invisible here and disciplined in src/.
  workforce2: { title: 'Employees — the system of record', render: renderWorkforce2 },
  orgchart: { title: 'Organization — units, positions and grades', render: renderOrgChart },
  bridges: { title: 'The bridges — what crosses between the two cores', render: renderBridges },
  docs: { title: 'Documents — the knowledge base, governed', render: renderDocs },
  time: { title: 'Attendance & leave — who is in, and what waits on a manager', render: renderTime, poll: 15000 },
  meetings: { title: 'Meetings — decisions with people behind them', render: renderMeetings },
  finops2: { title: 'Finance ops — expenses, payroll, cost centers', render: renderFinOps },
  procure: { title: 'Procurement — the chain that refuses to skip', render: renderProcure },
  talent2: { title: 'People lifecycle — in, up, and out', render: renderTalent },
  map2: { title: 'Two galaxies — the AI core, the enterprise core, and the tunnels', render: renderGalaxies },
  // The rest of the enterprise core.
  hrops: { title: 'Time rules — shifts, holidays, overtime, corrections', render: renderHrOps },
  comp: { title: 'Compensation — allowances, benefits, salary history, end of service', render: renderComp },
  budgets2: { title: 'Budgets — adopted by a person, measured against the journal', render: renderBudgets2 },
  payables: { title: 'Payables — vendor bills from draft to paid', render: renderPayables },
  receivables: { title: 'Receivables — customer invoices and receipts', render: renderReceivables },
  fixedassets: { title: 'Fixed assets — the register and its depreciation', render: renderFixedAssets },
  bank: { title: 'The bank — accounts, statements, transfers, cheques, batches', render: renderBank },
  inventory: { title: 'Inventory — warehouses, items, every move', render: renderInventory },
  facilities: { title: 'Facilities & fleet — work orders, vehicles, rooms', render: renderFacilities },
  helpdesk: { title: 'Help desk — the internal desk with an SLA clock', render: renderHelpdesk, poll: 30000 },
  secretariat: { title: 'Secretariat — correspondence, committees, resolutions', render: renderSecretariat },
  legalcases: { title: 'Legal cases — litigation, arbitration, claims', render: renderLegalCases },
  regulatory: { title: 'Regulatory — the obligations calendar and the licences', render: renderRegulatory },
  me: { title: 'My workspace', render: renderMe },
  surface: { title: 'Surface', render: renderSurfaceRoute },
  departments: { title: 'Every department', render: renderDepartments },
  browser: { title: 'Browser', render: renderBrowser },
  economics: { title: 'Unit economics', render: renderEconomics },
  standing: { title: 'Standing orders', render: renderStanding },
  deadletter: { title: 'Dead work', render: renderDeadletter },
  continuity: { title: 'Continuity', render: renderContinuity },
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
  // The platform.
  chief: { title: 'Operating rhythm — the company deciding what to do next', render: renderChief, poll: 15000 },
  observe: { title: 'Watchtower — what it promised itself, and what it does when it slips', render: renderObserve, poll: 10000 },
  tenants: { title: 'Companies — more than one on this installation', render: renderTenants, poll: 10000 },
  keys: { title: 'API keys — how other software talks to this company', render: renderKeys, poll: 15000 },
  webhooks: { title: 'Webhooks — telling other software what just happened', render: renderWebhooks, poll: 10000 },
  packages: { title: 'Department packages — a department you can install', render: renderPackages },
  anchors: { title: 'Anchors — the record answering to something other than itself', render: renderAnchors, poll: 30000 },
  erasure: { title: 'Erasure — forgetting a person inside a record that cannot forget', render: renderErasure },
  tax: { title: 'Tax — what was owed, where, and to whom', render: renderTax },
  privacy: { title: 'Privacy — not whether it is safe, but whether we may hold it', render: renderPrivacy },
  ip: { title: 'Intellectual property — what the company owns that is not a thing', render: renderIp },
  help: { title: 'Help centre — the replies that never had to be written', render: renderHelp },
  datagov: { title: 'Data governance — what a column is, and whether it can be forgotten', render: renderDataGov },
  trust: { title: 'Trust centre — the claims, and the live numbers behind them', render: renderTrust },
  status: { title: 'Status & SLA — what the company admits while it is happening', render: renderStatus, poll: 20000 },
  partnerships: { title: 'Partnerships — whether anything actually flows through them', render: renderPartnerships },
  offices: { title: 'The offices — the workforce in a building, not a feed', render: renderOffices, poll: 30000 },
  growth: { title: 'Growth — moving a number on purpose, and knowing whether it moved', render: renderGrowth },
  approvals: { title: 'The desk — everything waiting on a person', render: renderApprovals, poll: 10000 },
  roles: { title: 'Roles — jobs instead of two hundred and four checkboxes', render: renderRoles },
  tiers: { title: 'Model chains — and the canary that has to pass first', render: renderTiers, poll: 20000 },
  embeddings: { title: 'Recall — whether search understands the question', render: renderEmbeddings },
  deliverability: { title: 'Deliverability — whether mail arrives, and whether a recording is lawful', render: renderDeliverability },
  observability: { title: 'Instruments — size, retention, and how late the loop is', render: renderObservability, poll: 15000 },
  backups: { title: 'Backups — a platform that can lose the company is not a platform', render: renderBackups, poll: 20000 },
  pkg: { title: 'Installed department', render: renderPackageSection },
  // Marketing, desk by desk.
  events: { title: 'Events — rooms booked, and whether anybody followed up', render: renderEvents, poll: 15000 },
  press: { title: 'Press & media — what the company says on record', render: renderPress, poll: 15000 },
  community: { title: 'Community — who speaks for us, and who is unhappy', render: renderCommunity },
  attribution: { title: 'Attribution — where customers actually came from', render: renderAttribution, poll: 20000 },
  pages: { title: 'Landing pages — one person, one action', render: renderPages, poll: 15000 },
  mktops: { title: 'Marketing operations — the plumbing under the numbers', render: renderMktOps },
  seo: { title: 'Search — the queries worth winning', render: renderSeo, poll: 20000 },
  paidmedia: { title: 'Paid media — which channel earned its money', render: renderPaidMedia, poll: 15000 },
  lifecycle: { title: 'Lifecycle email — curious to paying, and staying', render: renderLifecycle, poll: 15000 },
  calendar: { title: 'Editorial calendar — what goes out, and when', render: renderCalendar, poll: 15000 },
  personas: { title: 'Personas — who we are actually talking to', render: renderPersonas },
  positioning: { title: 'Positioning — the promise, in one line', render: renderPositioning },
};

registerRoutes(ROUTE_TABLE);






















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

  return `<svg aria-hidden="true" focusable="false" class="constellation" viewBox="0 0 1000 880" role="img" aria-label="Company constellation — every section and the real relationships between them">
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















function buildSystemMapLegacy(s, prov, agentsList, chain, extra = {}) {
  const queue = s.queue || {};
  const active = (queue.queued || 0) + (queue.leased || 0) + (queue.running || 0);
  const done = queue.done || 0;
  const decTotal = Object.values(s.decisions || {}).reduce((a, b) => a + b, 0);
  const monthPct = Math.min(100, (s.spend.monthUsd / s.spend.companyCapUsd) * 100).toFixed(1);
  const groups = [['discover', 'DISCOVER'], ['build', 'BUILD'], ['assure', 'ASSURE'], ['run', 'RUN'], ['steer', 'STEER']];
  const provNames = { anthropic: 'CLAUDE API', 'claude-subscription': 'CLAUDE SUB', openai: 'OPENAI', deepseek: 'DEEPSEEK', google: 'GEMINI' };
  const provRows = prov.providers.filter((p) => p.name !== 'mock');

  return `<svg aria-hidden="true" focusable="false" class="sysmap" viewBox="0 0 1000 570" role="img" aria-label="System map — relations between the platform sections">
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
      if (touched && routes[key]?.poll && !pollPaused()) {
        // Same race as the poll timer: this render is triggered by something
        // arriving over the wire, and the person may well be on another page
        // by the time it resolves.
        const gen = navGeneration;
        routes[key].render(currentRoute().arg)
          .then(() => { if (gen === navGeneration) afterRender(); })
          .catch(() => {});
      }
    }
  });
  live.addEventListener('close', () => { paintLive('off'); setTimeout(connectLive, 4000); });
  live.addEventListener('error', () => { try { live.close(); } catch { /* closing anyway */ } });
}

window.addEventListener('hashchange', () => {
  if (live?.readyState === WebSocket.OPEN) live.send(JSON.stringify({ type: 'at', page: currentRoute().key || 'overview' }));
});

// Installed to a home screen, the app should open without waiting for a
// network round trip, and say something in its own words when there is none.
// The worker is network-first — see public/sw.js for why that matters more
// here than speed does.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* http, private mode, or told not to */ });
  });
}

// boot — authenticate first, then bring up the console.
async function boot() {
  initShell();
  try {
    const me = await api('/api/auth/me');
    // A live session on an account that never chose its own password gets the
    // same treatment as a fresh sign-in: nothing else opens until it does.
    if (me.user?.mustChangePassword) { showPasswordChange(); return; }
    setCurrentUser(me.user);
    paintUser();
    await loadCatalog();
    refreshShell();
    navigate();
    connectLive();
  } catch (e) {
    showLogin();
    // Installed on a phone, this screen is also what you get in a lift or on a
    // plane. "Sign in" and "there is no network" look identical from here, and
    // only one of them is your fault — so say which it is. A rejected fetch is
    // a TypeError; a real 401 comes back as a message from the server.
    const offline = !navigator.onLine || e instanceof TypeError;
    if (offline) $('#login-err').textContent = t('No connection to the company — this is the last thing your phone kept.');
  }
}

boot();
