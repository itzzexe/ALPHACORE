// The tunnels between the two galaxies.
//
// Core 1 thinks; Core 2 records. Nothing crosses between them except through
// the five bridges here, and the point of concentrating them in one file is
// that the crossing points stay countable. A sixth way across added quietly
// somewhere else is the failure this file exists to make visible.
//
//   Bridge 1  MCP        — a narrow, per-action tool surface onto Core 2
//   Bridge 2  Events     — domain events onto the existing durable queue
//   Bridge 3  Gateway    — the only way an agent may *change* anything in Core 2
//   Bridge 4  Identity   — enforced in the schema; audited here
//   Bridge 5  Audit      — the consequential subset onto Core 1's chain
//
// ---------------------------------------------------------------------------
// The sentence this file is built around
// ---------------------------------------------------------------------------
// "Core 2 gets no special-cased trust just because it's internal."
//
// So a tool call from an agent does not call a Core 2 function. It goes through
// `attempt()` — Core 1's egress gate — against a connector named
// `enterprise-core`, and takes every check in the same order everything else
// does: does this agent hold the scope, is the target on the allowlist, is it
// within quota, does the constitution permit it, is it under the value ceiling,
// does it stop for a person. The fact that the other side of the call is a
// table in the same database file changes nothing about the checks.
//
// That is a deliberate cost. It would be faster to call the function. Faster is
// how "internal" becomes a synonym for "ungoverned".
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { attempt } from '../egress.js';
import { enqueue, handle } from '../jobs.js';
import * as identity from './identity.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

// ------------------------------------------------------ Bridge 1 — MCP --

/**
 * The tool surface. One action each, no `run_sql`, ever.
 *
 * `write: true` means the tool changes something, which routes it through the
 * gateway (Bridge 3) rather than straight through. `permission` is the Core 1
 * permission the caller must hold — the same catalogue, not a parallel one, so
 * a tool cannot be reachable by somebody who could not reach the screen.
 */
export const TOOLS = {
  // --- reads ---
  get_employee: {
    write: false, permission: 'people.view',
    about: 'One employment record, with the person it belongs to.',
    run: ({ id }) => identity.getEmployee(id),
  },
  search_employees: {
    write: false, permission: 'people.view',
    about: 'Employees, filtered by state or org unit.',
    run: ({ state = null, orgUnitId = null, limit = 50 }) => identity.listEmployees({ state, orgUnitId, limit }),
  },
  get_person: {
    write: false, permission: 'people.view',
    about: 'One human being, and everything the company knows about them.',
    run: ({ id }) => identity.personDossier(id),
  },
  get_org_chart: {
    write: false, permission: 'org.view',
    about: 'The organization as a tree of units with headcounts.',
    run: () => identity.orgChart(),
  },
  get_reporting_line: {
    write: false, permission: 'people.view',
    about: 'Who an employee reports to, all the way up.',
    run: ({ employeeId }) => identity.reportingLine(employeeId),
  },

  // --- writes: every one of these goes through the gateway ---
  create_org_unit: {
    write: true, permission: 'org.manage',
    about: 'Add a unit to the organization.',
    run: (a, ctx) => identity.createOrgUnit({ ...a, actor: ctx.actor }),
  },
  create_position: {
    write: true, permission: 'org.manage',
    about: 'Open a position on a unit.',
    run: (a, ctx) => identity.createPosition({ ...a, actor: ctx.actor }),
  },
};

/**
 * Call a Core 2 tool from Core 1.
 *
 * Reads take the gate too. A read is not free — `search_employees` returns
 * salaries' existence, headcounts and reporting lines, and an agent that can
 * enumerate the org chart at will is a data-exfiltration path whether or not it
 * writes anything. The quota and the log matter for reads exactly as much.
 */
export async function callTool(name, args = {}, { agentId = null, runId = null, actor = 'system:bridge', reason = '' } = {}) {
  const tool = TOOLS[name];
  if (!tool) refuse(`no such tool: ${name}`);

  // A write never goes straight through, whatever the caller believes.
  if (tool.write) return command(name, args, { agentId, runId, actor, reason });

  const res = await attempt({
    connector: CONNECTOR,
    capability: `core2.${name}`,
    agentId, runId, actor,
    target: 'enterprise-core',
    reason: reason || `read ${name}`,
    payload: args,
    call: async () => tool.run(args, { actor }),
  });
  return res;
}

/** The connector the gate knows Core 2 by. */
export const CONNECTOR = 'enterprise-core';

/**
 * Register Core 2 with the egress gate.
 *
 * It is armed in 'dry' like every other connector, which for an internal target
 * would be pointless — so it is moved to 'live' here deliberately, and the
 * decision is recorded. What is *not* granted is any agent scope: an agent
 * still holds nothing until somebody grants it, exactly as with Gmail.
 */
export function seedBridge({ actor = 'system:bridge' } = {}) {
  if (one('SELECT id FROM connectors WHERE id = ?', CONNECTOR)) return { already: true };
  // `core2.gated` has to be declared, not just permitted. Left off the list it
  // is refused two checks earlier as a capability the connector never offered —
  // which looks like the gate working and is actually the opposite: a command
  // nobody can perform, not even the person it is supposed to be waiting for.
  const capabilities = [...Object.keys(TOOLS).map((t) => `core2.${t}`), 'core2.gated'];
  exec(
    `INSERT INTO connectors (id, driver, label, config, scopes, allowlist, quota_day, state)
     VALUES (?, 'http', ?, '{}', ?, ?, ?, 'live')`,
    CONNECTOR, 'Enterprise Core (Core 2)', JSON.stringify(capabilities),
    JSON.stringify(['enterprise-core']), 5000,
  );
  audit({
    actorType: 'system', actorId: actor, action: 'bridge.registered',
    subjectType: 'connector', subjectId: CONNECTOR,
    payload: { tools: capabilities.length, why: 'Core 2 is reached through the egress gate like anything else' },
  });
  return { ok: true, tools: capabilities.length };
}

// -------------------------------------------------- Bridge 3 — Gateway --

/**
 * Commands that may never clear the gateway on autonomy alone.
 *
 * Not "governed by the value ceiling" — categorically gated, whatever the
 * amount and whatever the agent's scopes say. A termination is not a large
 * expense; it is a different kind of act, and the ceiling is the wrong
 * instrument for it. Core 1 already treats `money.payout` this way; this is the
 * same treatment applied to the things Core 2 makes possible.
 *
 * Adding to this list is cheap. Removing from it should require an argument
 * nobody in this codebase has yet made.
 */
export const ALWAYS_HUMAN = new Set([
  'terminateEmployee',
  'approvePayroll',
  'changeSalary',
  'signContract',
  'recordDisciplinary',
  'deletePerson',
]);

/**
 * The only way an agent changes anything in Core 2.
 *
 *   agent → permission → constitution → human gate (if listed) → Core 2 API
 *
 * The gate is `attempt()` with `force: false`, so a listed command comes back
 * `gated` and waits for a person to release it. Nothing here writes to a Core 2
 * table directly, which is the whole of Bridge 3: the code path an agent takes
 * and the code path a person takes are not the same path, and only one of them
 * can be walked without a human.
 */
export async function command(name, args = {}, { agentId = null, runId = null, actor = 'system:bridge', reason = '', force = false } = {}) {
  const tool = TOOLS[name];
  const gated = ALWAYS_HUMAN.has(name);
  if (!tool && !gated) refuse(`no such command: ${name}`);

  // A listed command is gated even when the caller passes force. `force` exists
  // for a person releasing something already held, and that release goes
  // through releaseGated() — not through here with a flag set.
  const res = await attempt({
    connector: CONNECTOR,
    capability: gated ? 'core2.gated' : `core2.${name}`,
    agentId, runId, actor,
    target: 'enterprise-core',
    reason: reason || `command ${name}`,
    payload: { command: name, ...args },
    // The value is what makes the ceiling bite for money-shaped commands; the
    // categorical list above is what makes the gate bite regardless.
    valueUsd: Number(args.valueUsd || 0),
    force: gated ? false : force,
    call: async () => {
      if (!tool) refuse(`${name} is gated but has no implementation yet`);
      return tool.run(args, { actor });
    },
  });

  if (res.verdict === 'allowed') {
    emit(`core2.${name}`, { command: name, agentId, actor, result: res.result ?? null });
  }
  return res;
}

/** Is this command one a machine may never complete on its own? */
export const isAlwaysHuman = (name) => ALWAYS_HUMAN.has(name);

// ------------------------------------------------- Bridge 2 — Events --

/**
 * A domain event, onto the queue Core 1 already runs.
 *
 * Deliberately the existing queue rather than a second one: it is durable, it
 * retries with backoff, it dead-letters what never succeeds, and a person can
 * already see all of that on a page. A parallel event bus would need all of
 * that built again and would be the first thing to silently stop working.
 */
export function emit(event, payload = {}, { idempotency = null } = {}) {
  const name = String(event);
  exec('INSERT INTO core2_log (entity, entity_id, action, actor, detail) VALUES (?,?,?,?,?)',
    'event', null, name, 'system:bridge', JSON.stringify(payload).slice(0, 2000));
  try {
    return enqueue('core2.event', { event: name, payload }, { idempotency });
  } catch {
    // An event that cannot be queued must not take down the act that caused it.
    // It is in the operational log above either way.
    return null;
  }
}

/**
 * What happens to an event once the queue picks it up.
 *
 * Registered here at import time so an emitted event is never dead-lettered for
 * want of a handler. The consequential subset goes onto Core 1's chain; the
 * rest has already been written to the operational log by `emit`, and exists so
 * that Core 1's rhythm and its agents can react — the same way they already
 * react to queue depth and open incidents.
 */
handle('core2.event', async ({ event, payload }) => {
  if (shouldChain(event)) {
    audit({
      actorType: 'system', actorId: 'system:core2', action: event,
      subjectType: 'core2', subjectId: String(payload?.id ?? event),
      payload: payload || {},
    });
    exec("UPDATE core2_log SET chained = 1 WHERE action = ? AND chained = 0", String(event));
  }
  return { event, chained: shouldChain(event) };
});

/** Everything Core 2 can announce. Declared so it can be subscribed to. */
export const EVENTS = [
  'employee.created', 'employee.promoted', 'employee.terminated',
  'person.created', 'org.changed',
  'leave.requested', 'leave.approved', 'leave.rejected',
  'meeting.started', 'meeting.completed',
  'task.created', 'task.overdue',
  'expense.submitted', 'invoice.created', 'invoice.paid',
  'payroll.closed', 'contract.signed', 'contract.expiring',
];

// -------------------------------------------------- Bridge 4 — Identity --

/**
 * The enforcement is in the schema; this is the audit of it.
 *
 * A column that models a human and is not an integer is a hole in the bar,
 * because SQLite will store an agent id in it. This walks the Core 2 tables and
 * reports any it finds, so the guarantee is checked rather than remembered.
 */
export function identityAudit() {
  const holes = [];
  const humanish = /^(person_id|employee_id|manager_id|user_id|head_employee_id|owner_id|approver_id|assignee_id)$/;
  for (const t of q("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND (name LIKE 'hr\\_%' ESCAPE '\\' OR name LIKE 'core2\\_%' ESCAPE '\\')")) {
    if (!/STRICT/i.test(t.sql || '')) holes.push({ table: t.name, why: 'not STRICT — an agent id can be stored in a person column' });
    for (const c of q(`PRAGMA table_info(${t.name})`)) {
      if (humanish.test(c.name) && String(c.type).toUpperCase() !== 'INTEGER') {
        holes.push({ table: t.name, column: c.name, why: `${c.type || 'untyped'} — a human reference must be an integer` });
      }
    }
  }
  return {
    ok: holes.length === 0,
    holes,
    note: 'Agents have TEXT ids and people have INTEGER ones. Under STRICT, SQLite refuses to store one where the '
      + 'other belongs — which is why the bar holds in code paths nobody has written yet.',
  };
}

// ---------------------------------------------------- Bridge 5 — Audit --

/**
 * Which Core 2 events are consequential enough for Core 1's chain.
 *
 * Not everything. A chain of every attendance ping is noise that buries the
 * signal, and Core 1's own principle is that the chain records what is
 * consequential rather than what is frequent. These are the ones that change
 * somebody's money, their employment, or what the company is bound to.
 */
export const CHAINED_EVENTS = new Set([
  'salary.changed', 'employee.created', 'employee.terminated',
  'payroll.approved', 'contract.signed', 'leave.approved',
  'person.erased', 'disciplinary.recorded',
]);

export const shouldChain = (event) => CHAINED_EVENTS.has(event);

// ------------------------------------------------------------ overview --

export function bridgeOverview() {
  const conn = one('SELECT id, state, quota_day FROM connectors WHERE id = ?', CONNECTOR);
  const calls = one(
    "SELECT COUNT(*) AS n FROM egress_log WHERE connector = ?", CONNECTOR,
  ).n;
  const gatedNow = one(
    "SELECT COUNT(*) AS n FROM egress_log WHERE connector = ? AND verdict = 'gated'", CONNECTOR,
  ).n;
  return {
    connector: conn || null,
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name, writes: t.write, permission: t.permission, about: t.about,
      alwaysHuman: ALWAYS_HUMAN.has(name),
    })),
    alwaysHuman: [...ALWAYS_HUMAN],
    events: EVENTS,
    chainedEvents: [...CHAINED_EVENTS],
    identity: identityAudit(),
    calls,
    gated: gatedNow,
    note: 'Every call from Core 1 into Core 2 passes the egress gate: scope, allowlist, quota, constitution, value '
      + 'ceiling, human gate. Being in the same process buys no trust. The commands listed under alwaysHuman are '
      + 'gated categorically rather than by amount — a termination is not a large expense, it is a different act.',
  };
}
