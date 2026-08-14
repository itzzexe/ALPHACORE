// The handful of things every view needs: how to find an element, how to put a
// value on a page without letting it become markup, and where a subject of a
// given kind lives. Nothing here knows about the server or about any
// department — which is why it is the one module everything else may import.

export const $ = (sel, el = document) => el.querySelector(sel);
export const view = $('#view');
export const money = (n) => '$' + Number(n || 0).toFixed(n >= 100 ? 0 : 2);
export const money4 = (n) => '$' + Number(n || 0).toFixed(4);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One deep-link map for the whole company — every subject type knows its home.
export const linkFor = (type, id) => ({
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
export const short = (s, n = 80) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export function toast(msg, isErr = false) {
  let host = $('#toast');
  if (!host) {
    // The markup provides one with role=status; this is only a fallback, and it
    // carries the same attributes so a toast is never silently unannounced.
    host = document.createElement('div');
    host.id = 'toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
