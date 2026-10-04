// Who is signed in, and what they are allowed to open.
//
// `currentUser` is the one piece of genuinely global state in the console, and
// it is a `let` that boot() sets once the server has confirmed the token. An
// imported binding is read-only, so the assignment cannot move out of this
// file — hence setCurrentUser. That is not ceremony: it is the module system
// refusing to let two files disagree about who is signed in.
//
// navPerm is the map from a hash route to the permission it needs. It is used
// before a page renders, so somebody without the permission is told so rather
// than shown an empty department.

// ---------- auth ----------
export const TOKEN_KEY = 'alphacore-token';
export let currentUser = null;
export const actor = () => (currentUser ? `human:${currentUser.username}` : 'human:unknown');
export const hasPermC = (p) => currentUser && (currentUser.role === 'superadmin' || currentUser.perms.includes('*') || currentUser.perms.includes(p));
// Route → the permission that unlocks its page.
export const navPerm = {
  '': 'dashboard.view', governance: 'governance.view', gate: 'runs.view', decisions: 'decisions.view',
  decision: 'decisions.view', products: 'products.view', pipelines: 'pipelines.view', runs: 'runs.view',
  artifacts: 'archive.view', projects: 'projects.view', tasks: 'tasks.view', risks: 'risks.view',
  quality: 'quality.view', incidents: 'incidents.view', support: 'support.view', intel: 'intel.view',
  segments: 'segments.view', data: 'datasets.view', archive: 'archive.view', marketing: 'marketing.view',
  customers: 'customers.view', finance: 'finance.view', people: 'people.view', legal: 'legal.view',
  ledger: 'ledger.view', bookkeeper: 'ledger.view', hunt: 'hunt.view', browser: 'browser.view',
  economics: 'economics.view', standing: 'standing.view', deadletter: 'deadletter.view', continuity: 'lifecycle.view',
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
  chief: 'chief.view', observe: 'observe.view', tenants: 'tenants.view',
  keys: 'keys.view', webhooks: 'webhooks.view', packages: 'packages.view',
  backups: 'backups.view', pkg: 'packages.view',
  events: 'marketing.view', press: 'marketing.view', community: 'marketing.view',
  attribution: 'marketing.view', pages: 'marketing.view', mktops: 'marketing.view',
  seo: 'marketing.view', paidmedia: 'marketing.view', lifecycle: 'marketing.view',
  calendar: 'marketing.view', personas: 'marketing.view', positioning: 'marketing.view',
  // The enterprise core. `me` needs nothing but a login: it shows only what is yours.
  hrops: 'people.view', comp: 'people.view', budgets2: 'finance.view', payables: 'finance.view',
  receivables: 'finance.view', fixedassets: 'finance.view', bank: 'bank.view', inventory: 'ops.view',
  facilities: 'ops.view', helpdesk: 'ops.view', secretariat: 'admin.view', legalcases: 'legal.view',
  regulatory: 'admin.view',
  // Build and run, and the crew. `mywork` needs only a login.
  atlas: 'dashboard.view', forge: 'forge.view', forgeProject: 'forge.view', sites: 'sites.view',
  servers: 'servers.view', server: 'servers.view', deploys: 'deploys.view', deployTarget: 'deploys.view',
  monitors: 'monitors.view', crew: 'crew.view',
};

/**
 * The only way to change who is signed in.
 *
 * `currentUser` is exported as a live binding, so every module sees this
 * immediately — but none of them may assign to it, which is the point. One
 * writer, named, in the file that owns the state.
 */
export function setCurrentUser(u) {
  currentUser = u;
}
