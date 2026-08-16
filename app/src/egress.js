// The egress gate — the only door out of this machine.
//
// The 158 permissions govern a person clicking in the interface. Nothing
// governed an employee touching the world, because until now there was no
// world to touch. Every outbound effect — an email, a commit, a post, a
// payment, a phone call, an HTTP call to somebody else's API — passes through
// attempt() below, and attempt() is deliberately suspicious.
//
// The order of checks matters. Cheap refusals come first so an unscoped agent
// never even reaches a rate-limit counter, and the intent is written to the
// chain *before* the call is made, so a crash mid-flight still leaves evidence
// of what was about to happen.
//
// Failure is closed: anything unrecognised is refused. A connector that has
// not been armed runs in 'dry' — the whole path executes, the payload is
// recorded, and nothing leaves.
import { createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { record as certRecord, modeForVerdict } from './certification.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { checkConstitution } from './constitution.js';

/**
 * Paper trading: real reads, no writes.
 *
 * Mock mode proves the plumbing and nothing about the economics — every answer
 * is a stub, so a pipeline can look like it works while being fed invented
 * numbers. Live mode proves everything and can also email four hundred people.
 * This is the setting in between, and it is the only honest way to run a
 * vertical for a fortnight before it touches anybody.
 */
export const paperTrading = () => String(getSetting('PAPER_TRADING') ?? 'false') === 'true';

/**
 * Does this capability only look?
 *
 * The list is of verbs that *read*, and anything unrecognised is treated as a
 * write. That default is the whole safety of this feature: a capability added
 * next month that nobody thought about must be held, not sent — the opposite
 * default would let one new verb quietly undo the entire mode.
 */
const READ_VERBS = /(?:^|\.)(?:get|list|read|search|fetch|check|verify|balance|status|history|profile|lookup|watch|poll|inbox|threads?)$/i;
export function isRead(capability) {
  const c = String(capability || '');
  if (READ_VERBS.test(c)) return true;
  // "request" is the generic HTTP driver's capability and can be either; a
  // GET-shaped operation says so in its op name, which the caller passes.
  return false;
}

/** What a capability can cost before a person has to say yes. */
const VALUE_GATE_USD = 50;

/** Capabilities that always stop for a human, whatever the scopes say. */
const ALWAYS_GATED = new Set([
  'money.send', 'money.payout', 'contract.sign', 'repo.merge',
  'mail.bulk', 'post.publish.paid',
  // Core 2's categorical list arrives here as one capability. A termination, a
  // payroll approval or a salary change is not a large expense that the ceiling
  // happens to catch — it is a different kind of act, and the ceiling is the
  // wrong instrument for it. The commands themselves are named in
  // src/core2/bridge.js; what this line does is make the gate hold them
  // whatever the amount and whatever the agent's scopes say.
  'core2.gated',
]);

const REDACT = /(?:key|token|secret|password|authorization|cookie|seed|mnemonic|private)/i;

/** Payloads are recorded, so anything that looks like a credential is stripped. */
function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  if (typeof value === 'string') return value.length > 900 ? `${value.slice(0, 900)}…` : value;
  return value;
}

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** Does this agent hold this capability, and does the target fit the grant? */
function scopeCheck({ connector, capability, agentId, target }) {
  if (!agentId) return { ok: true, note: 'human actor' };
  const grant = one(
    'SELECT * FROM agent_scopes WHERE agent_id = ? AND connector = ? AND capability = ?',
    agentId, connector, capability,
  );
  if (!grant) return { ok: false, rule: 'scope', why: `${agentId} does not hold ${connector}.${capability}` };
  if (grant.expires_at && grant.expires_at < new Date().toISOString()) {
    return { ok: false, rule: 'scope.expired', why: `the grant for ${connector}.${capability} expired` };
  }
  const c = parse(grant.constraint_json, {});
  if (c.domain && target && !String(target).toLowerCase().endsWith(String(c.domain).toLowerCase())) {
    return { ok: false, rule: 'scope.domain', why: `${target} is outside the granted domain ${c.domain}` };
  }
  if (c.repo && target && String(target) !== String(c.repo)) {
    return { ok: false, rule: 'scope.repo', why: `${target} is not the granted repository ${c.repo}` };
  }
  if (c.channel && target && String(target) !== String(c.channel)) {
    return { ok: false, rule: 'scope.channel', why: `${target} is not the granted channel ${c.channel}` };
  }
  return { ok: true, constraint: c };
}

/** The connector's own allowlist — a second fence, independent of the agent. */
function allowlistCheck(connector, target) {
  const list = parse(connector.allowlist, []);
  if (!list.length || !target) return { ok: true };
  const t = String(target).toLowerCase();
  const hit = list.some((entry) => {
    const e = String(entry).toLowerCase();
    return e === '*' || t === e || t.endsWith(`.${e}`) || t.endsWith(`@${e}`) || t.startsWith(`${e}/`);
  });
  return hit ? { ok: true } : { ok: false, rule: 'allowlist', why: `${target} is not on ${connector.id}'s allowlist` };
}

function quotaCheck(connector, agentId) {
  const used = one(
    "SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND verdict IN ('allowed','dry') AND created_at >= datetime('now','-1 day')",
    connector.id,
  ).n;
  if (used >= connector.quota_day) {
    return { ok: false, rule: 'quota', why: `${connector.id} has used its ${connector.quota_day} calls for today` };
  }
  if (agentId) {
    const mine = one(
      "SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND agent_id = ? AND created_at >= datetime('now','-1 hour')",
      connector.id, agentId,
    ).n;
    if (mine >= 60) return { ok: false, rule: 'rate', why: `${agentId} is calling ${connector.id} too fast` };
  }
  return { ok: true };
}

/**
 * Try to affect something outside this machine.
 *
 * @param {object} a
 * @param {string} a.connector   which service
 * @param {string} a.capability  what kind of effect
 * @param {Function} a.call      the thing that actually reaches out
 * @returns {Promise<{verdict, result?, why?, id}>}
 */
export async function attempt({
  connector: connectorId, capability, call,
  agentId = null, runId = null, actor = null, target = null,
  reason = '', payload = {}, valueUsd = 0, force = false,
}) {
  const conn = one('SELECT * FROM connectors WHERE id = ?', connectorId);
  const safePayload = redact(payload);
  const intentHash = createHash('sha256')
    .update(JSON.stringify({ connectorId, capability, target, payload: safePayload }))
    .digest('hex').slice(0, 32);

  const record = (verdict, { blockedBy = null, result = null } = {}) => {
    const r = exec(
      `INSERT INTO egress_log (connector, capability, agent_id, run_id, actor, target, reason, payload,
                               verdict, blocked_by, result, value_usd, intent_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      connectorId, capability, agentId, runId, actor, target ? String(target) : null, reason,
      JSON.stringify(safePayload), verdict, blockedBy, result ? JSON.stringify(redact(result)) : null,
      valueUsd, intentHash,
    );
    audit({
      actorType: agentId ? 'agent' : 'human', actorId: agentId || actor || 'system:egress',
      action: `egress.${verdict}`, subjectType: 'egress', subjectId: Number(r.lastInsertRowid),
      payload: { connector: connectorId, capability, target, blockedBy, valueUsd, intentHash },
    });
    return Number(r.lastInsertRowid);
  };

  const refuse = (rule, why) => ({ verdict: 'blocked', why, rule, id: record('blocked', { blockedBy: rule }) });

  // 1. The service must exist and be switched on.
  if (!conn) return refuse('unknown-connector', `there is no connector called ${connectorId}`);
  if (conn.state === 'disconnected') return refuse('disconnected', `${connectorId} is not connected`);
  if (conn.state === 'paused') return refuse('paused', `${connectorId} is paused`);

  // 2. The connector must actually offer this capability.
  const offered = parse(conn.scopes, []);
  if (offered.length && !offered.includes(capability)) {
    return refuse('capability', `${connectorId} was not granted ${capability}`);
  }

  // 3. The employee must hold the scope, and the target must fit it.
  const scope = scopeCheck({ connector: connectorId, capability, agentId, target });
  if (!scope.ok) return refuse(scope.rule, scope.why);

  // 4. The connector's own fence.
  const allowed = allowlistCheck(conn, target);
  if (!allowed.ok) return refuse(allowed.rule, allowed.why);

  // 5. Volume.
  const quota = quotaCheck(conn, agentId);
  if (!quota.ok) {
    // Our own limit, hit and respected. The matrix's rate-limit column says
    // "theirs or ours", and this is the ours half — the call was stopped here
    // rather than going out and being stopped there.
    certify({ connectorId, capability, verdict: conn.state === 'dry' ? 'dry' : 'allowed', outcome: 'ok', detail: quota.why, dimension: 'rate_limit' });
    return refuse(quota.rule, quota.why);
  }

  // 6. The constitution gets a veto that no scope can override.
  const law = checkConstitution({ connector: connectorId, capability, target, payload: safePayload, valueUsd, agentId });
  if (law.verdict === 'block') return refuse(`constitution:${law.ruleId}`, law.why);

  // 7. Money and irreversibility stop for a person.
  const needsHuman = ALWAYS_GATED.has(capability)
    || law.verdict === 'gate'
    || valueUsd > (scope.constraint?.maxValueUsd ?? VALUE_GATE_USD);
  if (needsHuman && !force) {
    const id = record('gated', { blockedBy: law.verdict === 'gate' ? `constitution:${law.ruleId}` : 'human-gate' });
    return { verdict: 'gated', id, why: law.why || `${capability} waits for a person`, rule: 'human-gate' };
  }

  // 8. A connector that is armed but not live executes everything except the
  //    part that leaves. This is how an integration is proven before it is
  //    trusted, and it is the default for every new connector.
  if (conn.state === 'dry') {
    const id = record('dry', { result: { dryRun: true, wouldCall: capability, target } });
    certify({ connectorId, capability, verdict: 'dry', outcome: 'ok', egressId: id });
    return { verdict: 'dry', id, result: { dryRun: true }, why: `${connectorId} is in dry-run — nothing left the machine` };
  }

  // 8b. Paper trading: the middle setting between "nothing is real" and
  //     "everything is". Reads go out against the real APIs with real
  //     credentials — so the data is the company's actual data — and anything
  //     that would change something out there is executed up to the last step
  //     and then not sent.
  //
  //     Mock mode proves the plumbing and nothing about the economics: every
  //     answer is a stub, so a pipeline can be "working" while being fed
  //     invented numbers. This is the bridge, and the only honest way to run a
  //     vertical for a fortnight before letting it touch anybody.
  if (paperTrading() && !isRead(capability)) {
    const id = record('paper', {
      result: { paperTrading: true, wouldCall: capability, target, valueUsd },
    });
    certify({ connectorId, capability, verdict: 'paper', outcome: 'ok', egressId: id });
    return {
      verdict: 'paper',
      id,
      result: { paperTrading: true, wouldCall: capability, target },
      why: 'paper trading: this read the real world and did not change it',
    };
  }

  // 9. Do it, and record what came back either way.
  const id = record('allowed');
  try {
    const result = await call();
    exec("UPDATE egress_log SET result = ? WHERE id = ?", JSON.stringify(redact(result ?? { ok: true })), id);
    exec("UPDATE connectors SET last_call = datetime('now'), health = 'ok' WHERE id = ?", connectorId);
    certify({ connectorId, capability, verdict: 'allowed', outcome: 'ok', egressId: id });
    return { verdict: 'allowed', id, result };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 400);
    exec("UPDATE egress_log SET result = ? WHERE id = ?", JSON.stringify({ error: msg }), id);
    exec("UPDATE connectors SET last_call = datetime('now'), health = 'failing' WHERE id = ?", connectorId);
    certify({ connectorId, capability, verdict: 'allowed', outcome: 'failed', detail: msg, egressId: id });
    throw err;
  }
}

/**
 * Evidence, written as a by-product of the call rather than by anybody.
 *
 * A failure produces two rows and the second is the interesting one: the read
 * or write failed, *and* failure handling was exercised and worked — the call
 * threw, it was caught, the log and the connector's health were updated, and
 * nothing crashed. That is the only honest evidence that a failure path exists,
 * and it can only be collected by failing.
 *
 * Nothing here can throw. Evidence is a by-product; a certification that could
 * break a connector call would be worse than no certification at all.
 */
function certify({ connectorId, capability, verdict, outcome, detail = null, egressId = null, dimension = null }) {
  try {
    const mode = modeForVerdict(verdict);
    if (!mode) return;
    const column = dimension || (isRead(capability) ? 'read' : 'write');
    certRecord({ connector: connectorId, capability: column, operation: capability, mode, outcome, detail, egressId });

    if (outcome === 'failed') {
      certRecord({ connector: connectorId, capability: 'failure', operation: capability, mode, outcome: 'ok', detail, egressId });
      // Their limit, not ours — ours is the quota check above, which never
      // reaches this line because it refuses before the call is made.
      if (/\b429\b|rate.?limit|too many requests|quota exceeded/i.test(String(detail || ''))) {
        certRecord({ connector: connectorId, capability: 'rate_limit', operation: capability, mode, outcome: 'ok', detail, egressId });
      }
    }
  } catch { /* by-product */ }
}

/** A person releasing something the gate held. */
export async function releaseGated(id, { actor, call = null }) {
  const row = one('SELECT * FROM egress_log WHERE id = ?', id);
  if (!row) throw new Error('no such attempt');
  if (row.verdict !== 'gated') throw new Error('that attempt is not waiting for anyone');
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person can release a gated action');
  exec("UPDATE egress_log SET verdict = 'allowed', blocked_by = NULL, actor = ? WHERE id = ?", actor, id);
  audit({
    actorType: 'human', actorId: actor, action: 'egress.released', subjectType: 'egress', subjectId: id,
    payload: { connector: row.connector, capability: row.capability, target: row.target },
  });
  if (call) {
    const result = await call();
    exec('UPDATE egress_log SET result = ? WHERE id = ?', JSON.stringify(redact(result)), id);
    return { ok: true, result };
  }
  return { ok: true };
}

export function denyGated(id, { actor, why = '' }) {
  exec("UPDATE egress_log SET verdict = 'blocked', blocked_by = 'human-refused', result = ? WHERE id = ?", JSON.stringify({ why }), id);
  audit({ actorType: 'human', actorId: actor, action: 'egress.refused', subjectType: 'egress', subjectId: id, payload: { why } });
  return { ok: true };
}

/** Grant an employee one capability, as narrowly as you can bear. */
export function grantScope({ agentId, connector, capability, constraint = null, expiresAt = null, actor }) {
  if (!agentId || !connector || !capability) throw new Error('agent, connector and capability are all required');
  exec(
    `INSERT INTO agent_scopes (agent_id, connector, capability, constraint_json, granted_by, expires_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(agent_id, connector, capability) DO UPDATE SET
       constraint_json = excluded.constraint_json, granted_by = excluded.granted_by, expires_at = excluded.expires_at`,
    agentId, connector, capability, constraint ? JSON.stringify(constraint) : null, actor, expiresAt,
  );
  audit({ actorType: 'human', actorId: actor, action: 'scope.granted', subjectType: 'agent', subjectId: agentId, payload: { connector, capability, constraint } });
  return { ok: true };
}

export function revokeScope({ agentId, connector, capability, actor }) {
  exec('DELETE FROM agent_scopes WHERE agent_id = ? AND connector = ? AND capability = ?', agentId, connector, capability);
  audit({ actorType: 'human', actorId: actor, action: 'scope.revoked', subjectType: 'agent', subjectId: agentId, payload: { connector, capability } });
  return { ok: true };
}

export function scopesFor(agentId) {
  return q('SELECT * FROM agent_scopes WHERE agent_id = ? ORDER BY connector, capability', agentId)
    .map((s) => ({ ...s, constraint: parse(s.constraint_json, null) }));
}

export function egressOverview() {
  const day = "created_at >= datetime('now','-1 day')";
  return {
    counts: Object.fromEntries(q(`SELECT verdict, COUNT(*) AS n FROM egress_log WHERE ${day} GROUP BY verdict`).map((r) => [r.verdict, r.n])),
    waiting: q("SELECT * FROM egress_log WHERE verdict = 'gated' ORDER BY id DESC LIMIT 25"),
    blocked: q("SELECT connector, capability, blocked_by, COUNT(*) AS n FROM egress_log WHERE verdict = 'blocked' GROUP BY connector, capability, blocked_by ORDER BY n DESC LIMIT 15"),
    recent: q('SELECT id, connector, capability, agent_id, target, verdict, blocked_by, created_at FROM egress_log ORDER BY id DESC LIMIT 40'),
    byConnector: q(`SELECT c.id, c.label, c.state, c.quota_day, c.health,
                           (SELECT COUNT(*) FROM egress_log e WHERE e.connector = c.id AND e.${day}) AS today
                    FROM connectors c ORDER BY today DESC`),
    scopes: q('SELECT agent_id, connector, capability, constraint_json, expires_at FROM agent_scopes ORDER BY agent_id LIMIT 200'),
    totalScopes: one('SELECT COUNT(*) AS n FROM agent_scopes').n,
  };
}
