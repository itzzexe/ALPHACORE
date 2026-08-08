// Authentication + fine-grained RBAC. Passwords are scrypt-hashed; sessions
// are opaque tokens; every API action maps to one permission key, so a user
// can be granted exactly one capability and nothing else. The superadmin
// holds "*" and manages users, permissions, and provider settings.
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

// The permission catalog — section.action, grantable individually.
export const PERMS = [
  'dashboard.view',
  'gate.resolve',
  'runs.view', 'runs.create', 'runs.apply',
  'pipelines.view', 'pipelines.create', 'pipelines.cancel',
  'decisions.view', 'decisions.create', 'decisions.evidence', 'decisions.verify', 'decisions.tribunal', 'decisions.decide',
  'agents.view', 'agents.manage',
  'budgets.view', 'budgets.freeze',
  'audit.view',
  'providers.view', 'providers.test',
  'products.view', 'products.manage',
  'incidents.view', 'incidents.manage',
  'support.view', 'support.manage',
  'evals.view', 'evals.run',
  'governance.view', 'rituals.complete', 'problems.resolve', 'notifications.read',
  'finance.view', 'finance.export',
  'marketing.view', 'marketing.manage',
  'customers.view', 'customers.manage',
  'people.view', 'people.manage',
  'legal.view', 'legal.manage',
  'vendors.view', 'vendors.manage',
  'knowledge.view', 'knowledge.manage',
  'objectives.view', 'objectives.manage',
  'intel.view', 'intel.manage',
  'segments.view', 'segments.manage',
  'datasets.view', 'datasets.manage',
  'archive.view', 'archive.manage',
  'projects.view', 'projects.manage',
  'tasks.view', 'tasks.manage',
  'risks.view', 'risks.manage',
  'quality.view', 'quality.manage',
  'oversight.view',
  'relations.view', 'relations.manage',
  'journeys.view', 'journeys.manage',
  'workforce.view',
  'social.view', 'social.manage',
  'content.view', 'content.manage',
  'design.view', 'design.manage',
  'sales.view', 'sales.manage',
  'autopilot.view', 'autopilot.manage',
  'harmony.view', 'harmony.manage',
  'requests.view', 'requests.create',
  'pricing.view', 'pricing.manage',
  'success.view', 'success.manage',
  'assets.view', 'assets.manage',
  'localization.view', 'localization.manage',
  'marketwatch.view', 'marketwatch.manage',
  'enablement.view', 'enablement.manage',
  'org.view', 'org.manage',
  'disputes.view', 'disputes.raise',
  // The owner's own powers. Held by the superadmin via "*"; grantable to
  // nobody else by default, because a final ruling has to belong to one person.
  'owner.rule',
  'systems.view', 'systems.manage',
  'infra.view', 'infra.manage',
  'finreports.view', 'finreports.manage',
  'users.manage', 'settings.manage',
  // Expansion wave.
  'security.view', 'security.manage',
  'compliance.view', 'compliance.manage',
  'sustainability.view',
  'capacity.view',
  'lab.view', 'lab.manage',
  'releases.view', 'releases.manage',
  'pmo.view', 'pmo.manage',
  'insights.view',
  'brand.view', 'brand.manage',
  'procurement.view', 'procurement.manage',
  'finops.view',
  'recruiting.view', 'recruiting.manage',
  'academy.view', 'academy.manage',
  'board.view', 'board.manage',
  'ir.view', 'ir.manage',
  'comms.view', 'comms.manage',
  // The iteration engine.
  'workstreams.view', 'workstreams.manage',
  'auditor.view', 'auditor.request',
  'sprints.view', 'sprints.manage',
  'memory.view', 'memory.manage',
  'chat.view', 'chat.post',
  // treasury.pay releases money and is deliberately separate from the rest.
  'treasury.view', 'treasury.manage', 'treasury.pay',
  'comms.view', 'comms.manage',
  'contact.view', 'contact.manage',
  'marketing.view', 'marketing.manage',
  'money.view', 'money.manage',
  // The outside world. These are the powers that can affect somebody who is not
  // in this building, so each one is separate and none of them is implied by
  // "view". vault.manage holds every credential the company has; egress.release
  // is the hand that lets a held action through; constitution.amend rewrites
  // the rules the gate enforces — all three belong to very few people.
  'vault.manage',
  'connectors.view', 'connectors.manage',
  'egress.view', 'egress.release', 'scopes.grant',
  'jobs.view', 'jobs.manage',
  'web.view', 'web.use',
  'mcp.view', 'mcp.manage',
  'constitution.view', 'constitution.amend',
  'provenance.view', 'provenance.issue',
  'timemachine.view', 'timemachine.snapshot',
  'simulation.view', 'simulation.run',
  'skills.view', 'skills.manage',
  'redteam.view', 'redteam.run',
  'graph.view', 'graph.manage',
  'revenue.view', 'revenue.manage', 'revenue.invoice',
  // The platform. Running other people's companies, minting keys that outlive
  // any session, and restoring a database over the live one are each powers a
  // person should have to be given on purpose.
  'tenants.view', 'tenants.manage',
  'keys.view', 'keys.manage',
  'webhooks.view', 'webhooks.manage',
  'packages.view', 'packages.install',
  'chief.view', 'chief.run',
  'observe.view', 'observe.run',
  'backups.view', 'backups.take', 'backups.restore',
  // Putting the company on record in a newspaper is its own act, separate from
  // running a campaign.
  'press.approve',
];

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
};
const checkPassword = (pw, stored) => {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Re-authentication for destructive actions: does this password belong to this user? */
export function verifyPassword(userId, password) {
  const u = one('SELECT pass FROM users WHERE id = ?', userId);
  return Boolean(u) && checkPassword(password || '', u.pass);
}

/** First boot: create the superadmin (admin / crucible — change it). */
export function seedAdmin() {
  if (one('SELECT id FROM users LIMIT 1')) return;
  exec('INSERT INTO users (username, display_name, pass, role, perms) VALUES (?,?,?,?,?)',
    'admin', 'Super Admin', hashPassword('crucible'), 'superadmin', JSON.stringify(['*']));
  console.log('Seeded superadmin — username: admin · password: crucible (change it in Admin → Users)');
}

export function login(username, password) {
  const u = one('SELECT * FROM users WHERE username = ?', String(username || '').toLowerCase().trim());
  if (!u || u.status !== 'active' || !checkPassword(password || '', u.pass)) {
    throw new Error('invalid credentials');
  }
  const token = randomUUID() + randomBytes(16).toString('hex');
  exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))", token, u.id);
  audit({ actorType: 'human', actorId: `human:${u.username}`, action: 'auth.login', subjectType: 'user', subjectId: u.id });
  return { token, user: publicUser(u) };
}

export function logout(token) {
  exec('DELETE FROM sessions WHERE token = ?', token);
}

export function userForToken(token) {
  if (!token) return null;
  const s = one("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')", token);
  if (!s) return null;
  const u = one("SELECT * FROM users WHERE id = ? AND status = 'active'", s.user_id);
  return u ? publicUser(u) : null;
}

function publicUser(u) {
  const perms = JSON.parse(u.perms);
  const isOwner = u.role === 'superadmin' || perms.includes('*');
  return {
    id: u.id, username: u.username, displayName: u.display_name,
    role: u.role, perms,
    // The superadmin is the owner of the company: every permission, plus the
    // powers that exist only for them — final rulings and the kill switches.
    isOwner, title: isOwner ? 'Owner' : 'Member',
  };
}

export function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === 'superadmin' || user.perms.includes('*')) return true;
  return user.perms.includes(perm);
}

// ---------- user management (users.manage) ----------
export function listUsers() {
  return q('SELECT id, username, display_name, role, perms, status, created_at FROM users ORDER BY id')
    .map((u) => ({ ...u, perms: JSON.parse(u.perms) }));
}

export function createUser({ username, displayName, password, perms = [], actor }) {
  username = String(username || '').toLowerCase().trim();
  if (!/^[a-z0-9_.-]{2,32}$/.test(username)) throw new Error('username: 2-32 chars, a-z 0-9 _ . -');
  if (!password || password.length < 6) throw new Error('password: min 6 chars');
  if (one('SELECT id FROM users WHERE username = ?', username)) throw new Error('username taken');
  const clean = perms.filter((p) => PERMS.includes(p));
  exec('INSERT INTO users (username, display_name, pass, perms) VALUES (?,?,?,?)',
    username, displayName?.trim() || username, hashPassword(password), JSON.stringify(clean));
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'user.created', subjectType: 'user', subjectId: id, payload: { username, perms: clean } });
  return id;
}

export function updateUser(id, { perms = null, status = null, password = null, actor }) {
  const u = one('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new Error('user not found');
  if (u.role === 'superadmin' && status === 'disabled') throw new Error('cannot disable the superadmin');
  const clean = perms === null ? null : JSON.stringify(perms.filter((p) => PERMS.includes(p)));
  exec('UPDATE users SET perms = COALESCE(?, perms), status = COALESCE(?, status), pass = COALESCE(?, pass) WHERE id = ?',
    clean, status, password ? hashPassword(password) : null, id);
  if (status === 'disabled' || password) exec('DELETE FROM sessions WHERE user_id = ?', id);
  audit({ actorType: 'human', actorId: actor, action: 'user.updated', subjectType: 'user', subjectId: id, payload: { permsChanged: perms !== null, status, passwordReset: Boolean(password) } });
}
