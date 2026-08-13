// Authentication + fine-grained RBAC. Passwords are scrypt-hashed; sessions
// are opaque tokens; every API action maps to one permission key, so a user
// can be granted exactly one capability and nothing else. The superadmin
// holds "*" and manages users, permissions, and provider settings.
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { newSecret, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, checkRecovery } from './totp.js';

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
  'ledger.view', 'ledger.post', 'ledger.close',
  'hunt.view', 'hunt.run',
  'browser.view', 'browser.drive', 'browser.approve',
  'economics.view', 'standing.view', 'standing.manage', 'deadletter.view', 'deadletter.revive',
  'lifecycle.view', 'lifecycle.manage',
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

  // The functions a company discovers it needed after somebody audited it.
  // Each irreversible one is split from its read: classifying a transaction is
  // not filing a return, drafting an article is not publishing it, and deciding
  // a data flow is not looking at the list.
  'tax.view', 'tax.classify', 'tax.file',
  'privacy.view', 'privacy.assess', 'privacy.respond',
  'ip.view', 'ip.manage',
  'help.view', 'help.write', 'help.publish',
  'datagov.view', 'datagov.classify',
  'trust.view', 'trust.publish',
  'status.view', 'status.post',
  'partners.view', 'partners.manage',
  'growth.view', 'growth.run',
  'sim.view', 'sim.run',
];

export const hashPassword = (pw) => {
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

/**
 * First boot: create the owner account with a password nobody else can know.
 *
 * It used to be `alphacore`, printed on the login screen. That is a published
 * credential: everybody who has read the repository has it, and on any machine
 * reachable from a network it is an open door. The password is now generated,
 * shown once in the console of the person who started the server, and the
 * account is marked as needing a change — which the API enforces rather than
 * suggests.
 */
/**
 * A password meant to be read off one screen and typed into another — often a
 * phone, which is where this console is opened as much as anywhere.
 *
 * base64url looked fine in a terminal and was miserable in practice: mixed
 * case, and `-` and `_` that live behind a symbol layer on a phone keyboard.
 * A one-character slip reads back as "invalid credentials" with no way to tell
 * a typo from a wrong password. So: lowercase and digits only, with the five
 * characters nobody can reliably tell apart removed, in groups of four.
 *
 * Sixteen characters from an alphabet of thirty-one is about 79 bits — more
 * than the thing it protects needs, given it is single-use and the account
 * cannot do anything until it has been replaced.
 */
const TYPEABLE = 'abcdefghjkmnpqrstuvwxyz23456789';   // no i, l, o, 0, 1

export function generatePassword() {
  const bytes = randomBytes(16);
  // Rejection-free and unbiased enough: 256 % 31 skews the first four letters
  // by under 4%, which costs a fraction of a bit out of seventy-nine.
  const chars = [...bytes].map((b) => TYPEABLE[b % TYPEABLE.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function seedAdmin() {
  if (one('SELECT id FROM users LIMIT 1')) return;
  const password = generatePassword();
  exec(
    "INSERT INTO users (username, display_name, pass, role, perms, must_change) VALUES (?,?,?,?,?,1)",
    'owner', 'Owner', hashPassword(password), 'superadmin', JSON.stringify(['*']),
  );
  audit({ actorType: 'system', actorId: 'system:auth', action: 'user.seeded', subjectType: 'user', subjectId: 'owner', payload: { generated: true } });
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  First run. The owner account has been created.\n\n    username   owner\n    password   ${password}\n\n  This is shown once and is not stored anywhere in readable form.\n  You will be asked to change it the moment you sign in.\n${line}\n`);
}

/** Has this account still not chosen its own password? */
export function mustChangePassword(userId) {
  return Boolean(one('SELECT must_change FROM users WHERE id = ?', userId)?.must_change);
}

/** The account chooses its own password; the forced flag clears with it. */
export function changeOwnPassword(userId, { current, next, actor }) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new Error('no such account');
  if (!checkPassword(current || '', u.pass)) throw new Error('the current password is not right');
  if (!next || next.length < 10) throw new Error('a password needs at least ten characters');
  if (next === current) throw new Error('that is the password you already have');
  exec('UPDATE users SET pass = ?, must_change = 0 WHERE id = ?', hashPassword(next), userId);
  // Changing a password ends every other session: if it was changed because it
  // leaked, leaving the leaked session alive defeats the change.
  exec('DELETE FROM sessions WHERE user_id = ?', userId);
  audit({ actorType: 'human', actorId: actor, action: 'user.password_changed', subjectType: 'user', subjectId: userId });
  return { ok: true, note: 'every session was signed out, including this one — sign in again with the new password' };
}

// ---------------------------------------------------------------------------
// Signing in.
//
// A password check on its own is a door with no lock on the handle. Three
// things are added here, and each closes a hole that a real deployment finds
// within a week of being reachable from a network:
//
//   rate limiting  an unthrottled login endpoint is an offline password
//                  cracker with better uptime than the attacker's own hardware
//   lockout        after enough failures, stop answering at all for a while
//   a second factor  because passwords are reused, and you will never know
//
// The counters are per account *and* per address. Per account alone lets one
// address work through every username; per address alone lets a botnet work
// through one password.
// ---------------------------------------------------------------------------

const WINDOW_MINUTES = 15;
const MAX_PER_ACCOUNT = 8;
const MAX_PER_IP = 25;
const LOCKOUT_MINUTES = 15;

function recordAttempt({ username, ip, ok, reason }) {
  exec('INSERT INTO login_attempts (username, ip, ok, reason) VALUES (?,?,?,?)', username || null, ip || null, ok ? 1 : 0, reason || null);
}

function recentFailures({ username, ip }) {
  const since = `-${WINDOW_MINUTES} minutes`;
  return {
    account: username
      ? one("SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND ok = 0 AND at > datetime('now', ?)", username, since).n
      : 0,
    address: ip
      ? one("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > datetime('now', ?)", ip, since).n
      : 0,
  };
}

/** Thrown when the caller should be told to wait rather than told they were wrong. */
export class TooManyAttempts extends Error {
  constructor(seconds) {
    super(`too many attempts — wait ${Math.ceil(seconds / 60)} minute(s) and try again`);
    this.retryAfterSeconds = seconds;
  }
}

/** Thrown when the password was right and a code is still needed. */
export class SecondFactorRequired extends Error {
  constructor(methods) {
    super('a one-time code is required');
    this.methods = methods;
  }
}

export function totpEnabled(userId) {
  return Boolean(one('SELECT user_id FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL', userId));
}

export function login(username, password, { code = null, ip = null } = {}) {
  const name = String(username || '').toLowerCase().trim();

  // Address first: somebody spraying a hundred usernames never trips a
  // per-account counter, because no single account sees enough failures.
  const before = recentFailures({ username: name, ip });
  if (before.address >= MAX_PER_IP) {
    recordAttempt({ username: name, ip, ok: false, reason: 'address rate limit' });
    throw new TooManyAttempts(LOCKOUT_MINUTES * 60);
  }

  const u = one('SELECT * FROM users WHERE username = ?', name);

  if (u?.locked_until && one("SELECT datetime('now') < ? AS locked", u.locked_until).locked) {
    recordAttempt({ username: name, ip, ok: false, reason: 'locked' });
    throw new TooManyAttempts(LOCKOUT_MINUTES * 60);
  }

  if (!u || u.status !== 'active' || !checkPassword(password || '', u.pass)) {
    recordAttempt({ username: name, ip, ok: false, reason: u ? 'wrong password' : 'no such account' });
    // Count *after* recording, so this attempt is included in the total.
    if (u && recentFailures({ username: name, ip }).account >= MAX_PER_ACCOUNT) {
      exec("UPDATE users SET locked_until = datetime('now', ?) WHERE id = ?", `+${LOCKOUT_MINUTES} minutes`, u.id);
      audit({
        actorType: 'system', actorId: 'system:auth', action: 'auth.locked',
        subjectType: 'user', subjectId: u.id,
        payload: { minutes: LOCKOUT_MINUTES, failures: MAX_PER_ACCOUNT, ip: ip || null },
      });
      notifyLockout(u, ip);
    }
    // The same message either way. "No such account" tells an attacker which
    // usernames are real, which is half of what they came for.
    throw new Error('invalid credentials');
  }

  // The password was right. If a second factor is set up, it is not enough.
  if (totpEnabled(u.id)) {
    if (!code) {
      recordAttempt({ username: name, ip, ok: false, reason: 'second factor required' });
      throw new SecondFactorRequired(['totp', 'recovery']);
    }
    const accepted = acceptSecondFactor(u, code);
    if (!accepted.ok) {
      recordAttempt({ username: name, ip, ok: false, reason: accepted.reason });
      if (recentFailures({ username: name, ip }).account >= MAX_PER_ACCOUNT) {
        exec("UPDATE users SET locked_until = datetime('now', ?) WHERE id = ?", `+${LOCKOUT_MINUTES} minutes`, u.id);
      }
      // "Already used" and "wrong" are different facts, and the person needs to
      // know which. Told only that a correct code is wrong — which is what
      // happens for thirty seconds after setting it up — they will check the
      // clock, re-scan the QR, and eventually turn the whole thing off.
      throw new Error(accepted.reason === 'code already used'
        ? 'that code has already been used — wait for the next one'
        : 'that code is not right');
    }
  }

  exec('UPDATE users SET locked_until = NULL WHERE id = ?', u.id);
  recordAttempt({ username: name, ip, ok: true, reason: null });
  return issueSession(u, ip);
}

/**
 * A TOTP code, or one of the recovery codes — each accepted exactly once.
 *
 * The single-use rule is not fussiness. A six-digit code is valid for a full
 * period; anybody who reads it over a shoulder, or off a screen share, or out
 * of a phishing form, has thirty seconds to use it — and without this, they can
 * use it after the person whose code it was already has.
 */
function acceptSecondFactor(u, code) {
  const row = one('SELECT * FROM user_totp WHERE user_id = ?', u.id);
  if (row) {
    const counter = verifyCode(row.secret, code);
    if (counter !== null) {
      // Spent — including by the setup that confirmed it a moment ago.
      if (row.last_counter !== null && counter <= row.last_counter) return { ok: false, reason: 'code already used' };
      exec('UPDATE user_totp SET last_counter = ? WHERE user_id = ?', counter, u.id);
      return { ok: true };
    }
  }
  for (const r of q('SELECT * FROM user_recovery WHERE user_id = ? AND used_at IS NULL', u.id)) {
    if (checkRecovery(code, r.code)) {
      exec("UPDATE user_recovery SET used_at = datetime('now') WHERE id = ?", r.id);
      const left = one('SELECT COUNT(*) AS n FROM user_recovery WHERE user_id = ? AND used_at IS NULL', u.id).n;
      audit({
        actorType: 'human', actorId: `human:${u.username}`, action: 'auth.recovery_used',
        subjectType: 'user', subjectId: u.id, payload: { remaining: left },
      });
      return { ok: true, viaRecovery: true };
    }
  }
  return { ok: false, reason: 'wrong one-time code' };
}

/**
 * Sessions carry two clocks: an idle one that slides forward while you are
 * using it, and an absolute one that does not. Without the second, a token
 * that leaks is good forever as long as something keeps touching it.
 */
const IDLE_DAYS = 7;
const ABSOLUTE_DAYS = 30;

function issueSession(u, ip) {
  const token = randomUUID() + randomBytes(24).toString('hex');
  exec(
    `INSERT INTO sessions (token, user_id, expires_at, absolute_expires_at, last_seen, ip)
     VALUES (?, ?, datetime('now', ?), datetime('now', ?), datetime('now'), ?)`,
    token, u.id, `+${IDLE_DAYS} days`, `+${ABSOLUTE_DAYS} days`, ip || null,
  );
  audit({
    actorType: 'human', actorId: `human:${u.username}`, action: 'auth.login',
    subjectType: 'user', subjectId: u.id,
    payload: { ip: ip || null, secondFactor: totpEnabled(u.id) },
  });
  return { token, user: publicUser(u) };
}

function notifyLockout(u, ip) {
  // Imported lazily: notify() pulls in push, and auth is loaded during boot
  // before any of that is wanted.
  import('./notify.js')
    .then(({ notify }) => notify({
      level: 'warn', source: 'security',
      message: `${u.username} was locked after ${MAX_PER_ACCOUNT} failed sign-ins${ip ? ` from ${ip}` : ''}`,
      subjectType: 'user', subjectId: String(u.id),
    }))
    .catch(() => { /* the attempt log is the record; this is the courtesy */ });
}

export function logout(token) {
  exec('DELETE FROM sessions WHERE token = ?', token);
}

export function userForToken(token) {
  if (!token) return null;
  const s = one(
    `SELECT * FROM sessions
     WHERE token = ? AND expires_at > datetime('now')
       AND (absolute_expires_at IS NULL OR absolute_expires_at > datetime('now'))`,
    token,
  );
  if (!s) return null;
  const u = one("SELECT * FROM users WHERE id = ? AND status = 'active'", s.user_id);
  if (!u) return null;
  // Slide the idle clock, but never past the absolute one. Writing on every
  // request would be wasteful, so only once a minute has passed.
  if (!s.last_seen || one("SELECT ? < datetime('now', '-1 minute') AS stale", s.last_seen).stale) {
    exec(
      `UPDATE sessions SET last_seen = datetime('now'),
         expires_at = MIN(datetime('now', ?), COALESCE(absolute_expires_at, datetime('now', ?)))
       WHERE token = ?`,
      `+${IDLE_DAYS} days`, `+${IDLE_DAYS} days`, token,
    );
  }
  return publicUser(u);
}

// ------------------------------------------------------------ second factor --

/** Begin setting up TOTP: a secret, unconfirmed until a code proves it works. */
export function beginTotp(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new Error('no such account');
  if (totpEnabled(userId)) throw new Error('this account already has a one-time code set up');
  const secret = newSecret();
  exec(
    'INSERT INTO user_totp (user_id, secret, confirmed_at, last_counter) VALUES (?,?,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, confirmed_at = NULL, last_counter = NULL',
    userId, secret,
  );
  return { secret, otpauth: otpauthUrl({ secret, account: u.username }) };
}

/**
 * Confirm it, and only then hand over the recovery codes.
 *
 * Order matters: issuing recovery codes before a working code is proved is how
 * somebody ends up with ten pieces of paper that unlock an account whose second
 * factor never actually worked.
 */
export function confirmTotp(userId, code) {
  const row = one('SELECT * FROM user_totp WHERE user_id = ?', userId);
  if (!row) throw new Error('nothing to confirm — start again');
  const counter = verifyCode(row.secret, code);
  if (counter === null) throw new Error('that code is not right — check the clock on the phone');
  exec("UPDATE user_totp SET confirmed_at = datetime('now'), last_counter = ? WHERE user_id = ?", counter, userId);

  exec('DELETE FROM user_recovery WHERE user_id = ?', userId);
  const codes = newRecoveryCodes();
  for (const c of codes) exec('INSERT INTO user_recovery (user_id, code) VALUES (?,?)', userId, hashRecovery(c));

  const u = one('SELECT username FROM users WHERE id = ?', userId);
  audit({ actorType: 'human', actorId: `human:${u.username}`, action: 'auth.totp_enabled', subjectType: 'user', subjectId: userId });
  return { ok: true, recoveryCodes: codes, note: 'These are shown once. A lost phone without them is a lost account.' };
}

/** Turning it off needs the current password: a hijacked session must not. */
export function disableTotp(userId, password) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new Error('no such account');
  if (!checkPassword(password || '', u.pass)) throw new Error('the password is not right');
  exec('DELETE FROM user_totp WHERE user_id = ?', userId);
  exec('DELETE FROM user_recovery WHERE user_id = ?', userId);
  audit({ actorType: 'human', actorId: `human:${u.username}`, action: 'auth.totp_disabled', subjectType: 'user', subjectId: userId });
  return { ok: true };
}

export function securityOverview(userId) {
  const totp = one('SELECT confirmed_at FROM user_totp WHERE user_id = ?', userId);
  const sessions = q(
    `SELECT token, created_at, last_seen, expires_at, absolute_expires_at, ip FROM sessions
     WHERE user_id = ? ORDER BY created_at DESC`, userId,
  );
  return {
    totp: { enabled: Boolean(totp?.confirmed_at), pending: Boolean(totp && !totp.confirmed_at) },
    recoveryRemaining: one('SELECT COUNT(*) AS n FROM user_recovery WHERE user_id = ? AND used_at IS NULL', userId).n,
    sessions: sessions.map((s) => ({
      // Never the token itself, not even to its owner: this list is read on
      // screens that get shared.
      id: s.token.slice(0, 8), createdAt: s.created_at, lastSeen: s.last_seen,
      expiresAt: s.expires_at, absoluteExpiresAt: s.absolute_expires_at, ip: s.ip,
    })),
    recentAttempts: q(
      `SELECT ok, ip, reason, at FROM login_attempts WHERE username = (SELECT username FROM users WHERE id = ?)
       ORDER BY id DESC LIMIT 20`, userId,
    ),
  };
}

/** Sign every other session out — the button somebody needs at 2am. */
export function endOtherSessions(userId, keepToken) {
  const n = exec('DELETE FROM sessions WHERE user_id = ? AND token != ?', userId, keepToken || '').changes;
  const u = one('SELECT username FROM users WHERE id = ?', userId);
  audit({ actorType: 'human', actorId: `human:${u.username}`, action: 'auth.sessions_ended', subjectType: 'user', subjectId: userId, payload: { ended: n } });
  return { ended: n };
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
    // The interface asks for a new password on sight of this rather than
    // trusting the account to get round to it.
    mustChangePassword: Boolean(u.must_change),
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
