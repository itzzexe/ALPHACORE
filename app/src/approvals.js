// The approval desk — and the roles that decide who sits at it.
//
// The design says humans hold the gates. That is a promise on one side and a
// bottleneck on the other, and the bottleneck is structural rather than
// accidental: one hundred and fourteen departments feeding decisions to one
// person is a queue that only grows. When it grows past what a person will
// read, the honest outcomes are both bad — either everything waits, or somebody
// starts approving in bulk without looking, which is worse than having no gate
// at all because it produces a signature that means nothing.
//
// Four things keep a queue answerable:
//
//   priority     what actually blocks the company, ahead of what does not
//   grouping     twelve near-identical items decided once, deliberately, and
//                said to be a batch — never a "select all" pretending to be
//                twelve judgements
//   an SLA       a promise about how long a thing waits, and a count of what
//                broke it, because unmeasured latency is the bottleneck hiding
//   delegation   somebody is always on holiday
//
// And under all of it: role templates, because a fresh install asks somebody to
// assemble a job out of two hundred and four individual permissions before
// anybody can do anything, and nobody does that carefully at nine in the
// morning.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { PERMS } from './auth.js';
import { getSetting } from './settings.js';

// ------------------------------------------------------------------ roles --

/**
 * Jobs, expressed as sets of permissions.
 *
 * Wildcards rather than lists where a whole area is meant, so a template does
 * not silently stop covering a department added next month — the failure mode
 * of every hand-written permission list ever committed.
 *
 * `treasury.pay`, `egress.release`, `vault.manage` and `owner.rule` appear in
 * exactly one template each. They are the powers that move money, let something
 * out, read every credential, and settle an argument; spreading them across
 * convenient bundles is how they end up held by people nobody meant to give
 * them to.
 */
export const ROLE_TEMPLATES = {
  observer: {
    label: 'Observer',
    describes: 'Reads everything, changes nothing. For an auditor, an investor, or somebody new.',
    perms: ['*.view', 'dashboard.view', 'audit.view', 'oversight.view', 'workforce.view', 'capacity.view', 'insights.view', 'sustainability.view', 'finops.view'],
  },
  approver: {
    label: 'Approver',
    describes: 'Sits at the gates. Decides, rules on quality, and closes what is waiting — but cannot move money or open a door to the outside.',
    perms: ['*.view', 'gate.resolve', 'decisions.decide', 'decisions.evidence', 'decisions.verify',
      'quality.manage', 'pmo.manage', 'requests.create', 'problems.resolve', 'notifications.read',
      'rituals.complete', 'auditor.request', 'press.approve'],
  },
  operator: {
    label: 'Operator',
    describes: 'Runs the day: work, incidents, support, projects. The largest template, and deliberately without a single irreversible power.',
    perms: ['*.view', 'runs.create', 'runs.apply', 'pipelines.create', 'pipelines.cancel',
      'incidents.manage', 'support.manage', 'tasks.manage', 'projects.manage', 'sprints.manage',
      'releases.manage', 'jobs.manage', 'assets.manage', 'notifications.read', 'rituals.complete',
      'agents.manage', 'workstreams.manage', 'evals.run', 'lab.manage', 'crew.manage'],
  },
  finance: {
    label: 'Finance',
    describes: 'The books, the invoices, and the one permission that releases money — which is here and nowhere else.',
    perms: ['*.view', 'finance.export', 'finreports.manage', 'budgets.freeze', 'revenue.invoice',
      'procurement.manage', 'vendors.manage', 'treasury.manage', 'treasury.pay', 'money.manage'],
  },
  security: {
    label: 'Security',
    describes: 'The SOC, the constitution, the red team, and the gate that lets things out. Reads the vault register; does not hold the vault.',
    perms: ['*.view', 'security.manage', 'compliance.manage', 'redteam.run', 'constitution.amend',
      'egress.release', 'scopes.grant', 'connectors.manage', 'provenance.issue', 'timemachine.snapshot',
      'reviews.run', 'reviews.decide'],
  },
  marketing: {
    label: 'Marketing',
    describes: 'The twenty desks of the marketing district. Can publish; cannot approve a press statement — that stays with an approver.',
    perms: ['*.view', 'marketing.manage', 'content.manage', 'design.manage', 'brand.manage',
      'social.manage', 'localization.manage', 'marketwatch.manage', 'segments.manage'],
  },
  engineering: {
    label: 'Engineering',
    describes: 'Builds and ships: the software factory, websites, deployments and monitoring. Runs commands on servers only if given servers.exec on top.',
    perms: ['*.view', 'forge.manage', 'forge.run', 'sites.manage', 'deploys.manage', 'monitors.manage', 'servers.manage',
      'releases.manage', 'lab.manage', 'infra.manage', 'systems.manage',
      'reviews.run', 'reviews.decide', 'github.manage', 'github.post', 'appbuilder.manage'],
  },
  platform: {
    label: 'Platform',
    describes: 'Keeps the machine running: keys, webhooks, backups, tenants, packages. Holds the vault, and nothing that spends.',
    perms: ['*.view', 'settings.manage', 'keys.manage', 'webhooks.manage', 'backups.take',
      'backups.restore', 'packages.install', 'tenants.manage', 'observe.run', 'chief.run',
      'vault.manage', 'mcp.manage', 'web.use', 'graph.manage', 'skills.manage'],
  },
};

/** Expand a template's patterns against the real catalogue. */
export function expandTemplate(name) {
  const t = ROLE_TEMPLATES[name];
  if (!t) throw new Error(`no such role template: ${name}`);
  const out = new Set();
  for (const pattern of t.perms) {
    if (!pattern.includes('*')) {
      // Named individually, so a typo is an error rather than a silently
      // missing power somebody discovers in six weeks.
      if (!PERMS.includes(pattern)) throw new Error(`${name} names a permission that does not exist: ${pattern}`);
      out.add(pattern);
      continue;
    }
    const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[a-z]+')}$`);
    for (const p of PERMS) if (re.test(p)) out.add(p);
  }
  return [...out].sort();
}

export function roleTemplates() {
  return Object.entries(ROLE_TEMPLATES).map(([id, t]) => {
    const perms = expandTemplate(id);
    return {
      id, label: t.label, describes: t.describes, count: perms.length, perms,
      // Surfaced rather than buried: whoever hands out a template should see
      // which irreversible powers come with it.
      irreversible: perms.filter((p) => ['treasury.pay', 'egress.release', 'vault.manage', 'owner.rule', 'backups.restore', 'constitution.amend'].includes(p)),
    };
  });
}

export function applyTemplate({ userId, template, replace = true, actor }) {
  if (!actor) throw new Error('granting a role has to be signed');
  const u = one('SELECT id, username, perms FROM users WHERE id = ?', userId);
  if (!u) throw new Error('no such account');
  const granted = expandTemplate(template);
  const before = JSON.parse(u.perms);
  const after = replace ? granted : [...new Set([...before, ...granted])];
  exec('UPDATE users SET perms = ? WHERE id = ?', JSON.stringify(after), userId);
  audit({
    actorType: 'human', actorId: actor, action: 'user.role_applied',
    subjectType: 'user', subjectId: String(userId),
    payload: { template, replace, was: before.length, now: after.length, username: u.username },
  });
  return { ok: true, template, permissions: after.length };
}

// -------------------------------------------------------------- the queue --

/**
 * How urgent a waiting thing is, decided by what it blocks rather than by
 * whoever raised it.
 *
 * Self-declared priority is always high. This reads the consequence instead:
 * money that cannot move, a customer waiting, an incident open, an agent idle.
 */
// Urgency strictly dominates age, and age breaks ties inside a band. The first
// version added a capped age bonus to the weight, which read well and was
// wrong: the gap between "money" and "incident" is ten points, so a
// thirty-hour-old customer item scored exactly level with a payout waiting on a
// signature. A queue whose ordering can be gamed by waiting is a queue that
// teaches people to wait.
const URGENCY = [
  { id: 'money', why: 'money cannot move until somebody signs', weight: 100 },
  { id: 'incident', why: 'an incident is open and this is in its way', weight: 90 },
  { id: 'customer', why: 'somebody outside is waiting on this', weight: 70 },
  { id: 'blocking', why: 'other work is queued behind it', weight: 50 },
  { id: 'routine', why: 'nothing is waiting on it', weight: 10 },
];

function classify(item) {
  if (/payout|invoice|treasury|money/i.test(`${item.kind} ${item.title}`)) return URGENCY[0];
  if (item.kind === 'incident' || /incident|outage|sev/i.test(item.title)) return URGENCY[1];
  if (/customer|support|ticket|reply/i.test(`${item.kind} ${item.title}`)) return URGENCY[2];
  if (item.blocking > 0) return URGENCY[3];
  return URGENCY[4];
}

const slaHours = () => Number(getSetting('APPROVAL_SLA_HOURS') || 24);

/**
 * Everything waiting on a person, in one list, ordered by what it costs to
 * leave it.
 *
 * Gathered from the places that stop rather than from a queue table, because a
 * queue table is a second source of truth that drifts the first time somebody
 * resolves something directly.
 */
export function waiting({ forUser = null } = {}) {
  const items = [];

  for (const r of q(`SELECT id, agent_id, task_type, failure_reason, created_at
                     FROM runs WHERE state = 'awaiting_human' ORDER BY created_at ASC`)) {
    items.push({
      kind: 'run', id: r.id, title: `${r.task_type} — ${r.agent_id}`,
      because: r.failure_reason || 'stopped for a person',
      since: r.created_at, route: '#/gate', permission: 'gate.resolve', blocking: 0,
    });
  }
  for (const d of q(`SELECT id, title, status, created_at FROM decisions
                     WHERE status IN ('proposed','deliberating') ORDER BY created_at ASC`)) {
    items.push({
      kind: 'decision', id: d.id, title: d.title, because: d.status,
      since: d.created_at, route: '#/decisions', permission: 'decisions.decide', blocking: 0,
    });
  }
  try {
    for (const p of q("SELECT id, amount, asset, to_address, created_at FROM payouts WHERE state = 'prepared' ORDER BY created_at ASC")) {
      items.push({
        kind: 'payout', id: p.id, title: `${p.amount} ${p.asset || ''} to ${String(p.to_address).slice(0, 16)}…`,
        because: 'money leaves only when a person releases it',
        since: p.created_at, route: '#/treasury', permission: 'treasury.pay', blocking: 0,
      });
    }
  } catch { /* no treasury yet */ }
  try {
    // A held call is one the gate stopped for a person and which has not since
    // produced a result. There is no released_at column, and inventing one in
    // a query is how a queue quietly shows things that were dealt with days ago.
    for (const e of q(`SELECT id, connector, capability, target, created_at FROM egress_log
                       WHERE verdict = 'gate' AND (result IS NULL OR result = '')
                       ORDER BY created_at ASC LIMIT 50`)) {
      items.push({
        kind: 'egress', id: e.id, title: `${e.connector}.${e.capability} → ${e.target || ''}`,
        because: 'the gate held it for a person',
        since: e.created_at, route: '#/egress', permission: 'egress.release', blocking: 0,
      });
    }
  } catch { /* older schema */ }

  const now = Date.now();
  const sla = slaHours();
  const scored = items.map((item) => {
    const urgency = classify(item);
    const ageHours = (now - new Date(`${String(item.since).replace(' ', 'T')}Z`)) / 36e5;
    return {
      ...item,
      urgency: urgency.id,
      whyUrgent: urgency.why,
      ageHours: Math.round(ageHours * 10) / 10,
      overdue: ageHours > sla,
      score: urgency.weight,
    };
  }).sort((a, b) => (b.score - a.score) || (b.ageHours - a.ageHours));

  const mine = forUser
    ? scored.filter((i) => forUser.perms?.includes('*') || forUser.perms?.includes(i.permission))
    : scored;

  return {
    slaHours: sla,
    total: scored.length,
    yours: mine.length,
    overdue: scored.filter((i) => i.overdue).length,
    oldestHours: scored.length ? Math.max(...scored.map((i) => i.ageHours)) : 0,
    byUrgency: URGENCY.map((u) => ({ ...u, count: scored.filter((i) => i.urgency === u.id).length })),
    groups: groupsOf(mine),
    items: mine.slice(0, 200),
  };
}

/**
 * Items alike enough to be decided together.
 *
 * Grouped by kind and by the reason they stopped — never across kinds. A batch
 * that mixes a payout with a draft reply is a "select all" wearing the costume
 * of a considered decision, and the whole value of a gate is that somebody
 * looked.
 */
function groupsOf(items) {
  const by = new Map();
  for (const i of items) {
    const key = `${i.kind}:${String(i.because).slice(0, 60)}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(i);
  }
  return [...by.entries()]
    .filter(([, xs]) => xs.length >= 3)
    .map(([key, xs]) => ({
      key, kind: xs[0].kind, because: xs[0].because, count: xs.length,
      permission: xs[0].permission, oldestHours: Math.max(...xs.map((x) => x.ageHours)),
      ids: xs.map((x) => x.id),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Decide a group in one act — recorded as one act.
 *
 * The chain gets a single entry naming every id, not twelve entries that look
 * like twelve separate judgements. Somebody reading it later should be able to
 * tell "these were decided together" from "these were each considered", because
 * those are different facts about how much thought was applied.
 */
export function decideBatch({ key, ids, verdict, note = null, actor, apply }) {
  if (!actor) throw new Error('a decision has to be signed');
  if (!Array.isArray(ids) || !ids.length) throw new Error('nothing to decide');
  if (!['approve', 'reject'].includes(verdict)) throw new Error('a batch is approved or rejected, nothing else');

  const done = [];
  const failed = [];
  for (const id of ids) {
    try { apply(id, verdict, actor); done.push(id); }
    catch (e) { failed.push({ id, error: String(e.message).slice(0, 120) }); }
  }

  audit({
    actorType: 'human', actorId: actor, action: 'approvals.batch',
    subjectType: 'batch', subjectId: key || 'ad-hoc',
    payload: {
      verdict, count: done.length, ids: done, failed: failed.length ? failed : undefined, note,
      // Written down so nobody later mistakes this for individual consideration.
      decidedTogether: true,
    },
  });
  return { verdict, decided: done.length, failed };
}

// ------------------------------------------------------------- delegation --

/**
 * Hand your gates to somebody else for a while.
 *
 * Bounded in time and never open-ended: a delegation with no end is a
 * permission grant with extra paperwork. The chain records both names, so an
 * approval made under one is attributable to the person who acted *and* the
 * person who lent the authority — which is the whole question afterwards.
 */
export function delegate({ fromUserId, toUserId, untilHours = 72, reason = null, actor }) {
  if (!actor) throw new Error('a delegation has to be signed');
  if (fromUserId === toUserId) throw new Error('delegating to yourself changes nothing');
  const from = one('SELECT id, username FROM users WHERE id = ?', fromUserId);
  const to = one("SELECT id, username FROM users WHERE id = ? AND status = 'active'", toUserId);
  if (!from || !to) throw new Error('both accounts have to exist and be active');
  const hours = Math.min(Math.max(1, Number(untilHours) || 72), 24 * 30);

  exec(
    "INSERT INTO delegations (from_user, to_user, reason, expires_at, created_by) VALUES (?,?,?,datetime('now', ?),?)",
    fromUserId, toUserId, reason, `+${hours} hours`, actor,
  );
  audit({
    actorType: 'human', actorId: actor, action: 'approvals.delegated',
    subjectType: 'user', subjectId: String(fromUserId),
    payload: { from: from.username, to: to.username, hours, reason },
  });
  return { ok: true, from: from.username, to: to.username, hours };
}

export function endDelegation({ id, actor }) {
  if (!actor) throw new Error('ending a delegation has to be signed');
  exec("UPDATE delegations SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL", id);
  audit({ actorType: 'human', actorId: actor, action: 'approvals.delegation_ended', subjectType: 'delegation', subjectId: String(id) });
  return { ok: true };
}

/** Whose authority is this person carrying right now, besides their own? */
export function delegationsFor(userId) {
  return q(
    `SELECT d.*, u.username AS from_username FROM delegations d
     JOIN users u ON u.id = d.from_user
     WHERE d.to_user = ? AND d.revoked_at IS NULL AND d.expires_at > datetime('now')`,
    userId,
  );
}

export function approvalsOverview(user) {
  const board = waiting({ forUser: user });
  return {
    ...board,
    delegations: {
      // Both directions, because "why can she approve this" and "why can I not"
      // are the two questions people actually have.
      toMe: user ? delegationsFor(user.id) : [],
      fromMe: user ? q("SELECT d.*, u.username AS to_username FROM delegations d JOIN users u ON u.id = d.to_user WHERE d.from_user = ? AND d.revoked_at IS NULL AND d.expires_at > datetime('now')", user.id) : [],
    },
    roles: roleTemplates().map(({ perms, ...rest }) => rest),
  };
}
