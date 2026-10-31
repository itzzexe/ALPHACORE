// Missions — the journeys a new company takes, checked against its own record.
//
// A checklist that a person ticks is a checklist that lies the day somebody
// ticks it early. Every step here is a question put to the record — is there a
// published policy, has an invoice been issued, has a second person been
// invited — so a mission is done when the company has done it, and the list
// stays true when somebody undoes it. Each step names the place where it is
// done, so the journey is also the way there.
import { one } from './db.js';
import { getSetting, isMockMode } from './settings.js';

const n = (sql, ...a) => { try { return one(sql, ...a)?.n ?? 0; } catch { return 0; } };
const has = (sql, ...a) => n(sql, ...a) > 0;
const set = (k) => Boolean(String(getSetting(k) || '').trim());

/** The perm a step needs is the perm of the place it sends you to; the console hides what you cannot open. */
export const MISSIONS = [
  {
    id: 'foundations', title: 'Lay the foundations', glyph: 'base',
    blurb: 'Name the company, place it on the map, connect a mind and bring in a second person.',
    steps: [
      { id: 'name', title: 'Give the company its name', href: '#/settings', perm: 'settings.manage', done: () => set('COMPANY_NAME') },
      { id: 'country', title: 'Place the company on the globe', href: '#/settings', perm: 'settings.manage', done: () => set('COMPANY_COUNTRY') },
      { id: 'model', title: 'Connect a model, local or remote', href: '#/localai', perm: 'settings.manage', done: () => { try { return !isMockMode(); } catch { return false; } } },
      { id: 'people', title: 'Invite a second person', href: '#/users', perm: 'users.manage', done: () => n('SELECT COUNT(*) AS n FROM users') >= 2 },
      { id: 'policy', title: 'Publish the first policy', href: '#/policies', perm: 'policies.view', done: () => has("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published'") },
    ],
  },
  {
    id: 'money', title: 'Run the money', glyph: 'coin',
    blurb: 'A bank account, the first invoice out, the first bill approved, and a look at the months ahead.',
    steps: [
      { id: 'bank', title: 'Register a bank account', href: '#/bank', perm: 'bank.view', done: () => has('SELECT COUNT(*) AS n FROM bank_account') },
      { id: 'invoice', title: 'Issue the first invoice', href: '#/finance', perm: 'finance.view', done: () => has("SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE state IN ('issued','paid')") },
      { id: 'bill', title: 'Approve the first bill', href: '#/finance', perm: 'finance.view', done: () => has("SELECT COUNT(*) AS n FROM fin_ap_bill WHERE state IN ('approved','paid')") },
      { id: 'whatif', title: 'Keep a what-if scenario', href: '#/whatif', perm: 'whatif.view', done: () => has('SELECT COUNT(*) AS n FROM whatif_scenarios') },
      { id: 'pack', title: 'Build a board pack', href: '#/boardpack', perm: 'boardpack.view', done: () => has('SELECT COUNT(*) AS n FROM board_packs') },
    ],
  },
  {
    id: 'workforce', title: 'Put the workforce to work', glyph: 'spark',
    blurb: 'The first finished run, the first decision by a person, and a loop that makes the employees better.',
    steps: [
      { id: 'run', title: 'Finish the first piece of AI work', href: '#/runs', perm: 'runs.view', done: () => has("SELECT COUNT(*) AS n FROM runs WHERE state = 'done'") },
      { id: 'decide', title: 'Decide something waiting on a person', href: '#/approvals', perm: null, done: () => has("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'human' AND (action LIKE '%.approved' OR action LIKE '%.rejected' OR action LIKE 'gate.%')") },
      { id: 'loop', title: 'Run a self-improvement loop', href: '#/selfimprove', perm: 'selfimprove.view', done: () => has('SELECT COUNT(*) AS n FROM si_loops') },
      { id: 'kept', title: 'Keep a rewrite the coach earned', href: '#/selfimprove', perm: 'selfimprove.view', done: () => has("SELECT COUNT(*) AS n FROM playbook_versions WHERE state = 'kept'") },
    ],
  },
  {
    id: 'govern', title: 'Govern it', glyph: 'shield',
    blurb: 'Risks written down, counterparties screened, a backup taken and everybody told.',
    steps: [
      { id: 'risk', title: 'Register a risk', href: '#/risks', perm: 'risks.view', done: () => has('SELECT COUNT(*) AS n FROM risks') },
      { id: 'aml', title: 'Screen a counterparty', href: '#/aml', perm: 'aml.view', done: () => has('SELECT COUNT(*) AS n FROM aml_parties') },
      { id: 'backup', title: 'Take a backup', href: '#/backups', perm: 'backups.view', done: () => has('SELECT COUNT(*) AS n FROM backups') },
      { id: 'broadcast', title: 'Tell everybody something', href: '#/broadcasts', perm: 'broadcasts.view', done: () => has('SELECT COUNT(*) AS n FROM broadcasts') },
    ],
  },
  {
    id: 'reach', title: 'Reach the world', glyph: 'globe',
    blurb: 'A connection out, something watched, something built, and a door for customers.',
    steps: [
      { id: 'connector', title: 'Connect a service', href: '#/connectors', perm: 'connectors.view', done: () => has("SELECT COUNT(*) AS n FROM connectors WHERE state IN ('dry','live')") },
      { id: 'monitor', title: 'Watch a site or a server', href: '#/monitors', perm: 'monitors.view', done: () => has('SELECT COUNT(*) AS n FROM mon_checks') },
      { id: 'build', title: 'Start a software project', href: '#/forge', perm: 'forge.view', done: () => has('SELECT COUNT(*) AS n FROM forge_projects') },
      { id: 'portal', title: 'Open the portal to a customer', href: '#/portal', perm: 'portal.view', done: () => has('SELECT COUNT(*) AS n FROM portal_accounts') },
    ],
  },
];

/** Every mission with each step's state, read now. */
export function overview() {
  const missions = MISSIONS.map((m) => {
    const steps = m.steps.map((s) => ({ id: s.id, title: s.title, href: s.href, perm: s.perm, done: Boolean(s.done()) }));
    const done = steps.filter((s) => s.done).length;
    return { id: m.id, title: m.title, blurb: m.blurb, glyph: m.glyph, steps, done, total: steps.length, complete: done === steps.length };
  });
  const done = missions.reduce((a, m) => a + m.done, 0);
  const total = missions.reduce((a, m) => a + m.total, 0);
  const next = missions.find((m) => !m.complete);
  return {
    missions,
    done, total, pct: total ? Math.round((done / total) * 100) : 0,
    next: next ? { mission: next.id, title: next.title, step: next.steps.find((s) => !s.done) } : null,
  };
}
