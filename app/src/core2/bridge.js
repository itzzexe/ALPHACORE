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
import { createHash } from 'node:crypto';
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { attempt } from '../egress.js';
import { enqueue, handle } from '../jobs.js';
import { notify } from '../notify.js';
import { journalEntry, addAccount } from '../ledger.js';
import * as identity from './identity.js';
import * as time from './time.js';
import * as meetings from './meetings.js';
import * as payops from './payops.js';
import * as procure from './procure.js';
import * as talent from './talent.js';
import * as docs from './documents.js';
import * as hrplus from './hrplus.js';
import * as finance from './finance.js';
import * as bank from './bank.js';
import * as ops from './ops.js';
import * as admin from './admin.js';
import { openPii } from '../erasure.js';

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
    write: false, permission: 'people.view', pii: true,
    about: 'One employment record, with the person it belongs to.',
    run: ({ id }) => identity.getEmployee(id),
  },
  search_employees: {
    write: false, permission: 'people.view', pii: true,
    about: 'Employees, filtered by state or org unit.',
    run: ({ state = null, orgUnitId = null, limit = 50 }) => identity.listEmployees({ state, orgUnitId, limit }),
  },
  get_person: {
    write: false, permission: 'people.view', pii: true,
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

  get_leave_balance: {
    write: false, permission: 'people.view',
    about: 'One employee`s remaining days under one policy.',
    run: ({ employeeId, policyId }) => time.balanceFor(employeeId, policyId),
  },
  get_attendance_today: {
    write: false, permission: 'people.view',
    about: 'Who is in, who is out, who is on approved leave, today.',
    run: () => time.attendanceToday(),
  },
  get_meeting: {
    write: false, permission: 'people.view', pii: true,
    about: 'One meeting: participants, decisions and action items.',
    run: ({ id }) => meetings.getMeeting(id),
  },

  // --- writes: every one of these goes through the gateway ---
  create_leave_request: {
    write: true, permission: 'people.manage', pii: true,
    about: 'File a leave request on an employee`s behalf. Balance and overlap are checked; approval stays human.',
    run: (a, ctx) => time.requestLeave({ ...a, actor: ctx.actor }),
  },
  create_meeting: {
    write: true, permission: 'people.manage',
    about: 'Schedule a meeting with an agenda and human participants.',
    run: (a, ctx) => meetings.createMeeting({ ...a, actor: ctx.actor }),
  },
  create_action_item: {
    write: true, permission: 'people.manage',
    about: 'Record an action item or a decision against a meeting.',
    run: (a, ctx) => meetings.addAction(a.meetingId, { ...a, actor: ctx.actor }),
  },
  get_payroll: {
    write: false, permission: 'finance.view', pii: true,
    about: 'One payroll run with its slips — opened only for a permitted reader.',
    run: ({ id }) => payops.getRun(id),
  },
  list_expiring_contracts: {
    write: false, permission: 'legal.view',
    about: 'Contracts lapsing inside a horizon, soonest first.',
    run: ({ horizonDays = 90 }) => procure.listExpiring({ horizonDays }),
  },
  create_expense: {
    write: true, permission: 'finance.view',
    about: 'Submit an expense or advance on an employee`s behalf.',
    run: (a, ctx) => payops.submitExpense({ ...a, actor: ctx.actor }),
  },
  approve_expense: {
    write: true, permission: 'finance.view',
    about: 'Approve a routine expense. The ordinary value ceiling applies: small clears on scope, large waits for a person.',
    run: (a, ctx) => payops.decideExpense(a.id, { approve: true, actor: ctx.actor }),
  },
  draft_payroll: {
    write: true, permission: 'finance.view',
    about: 'Compute a period`s payroll as a draft. Drafting is arithmetic; approving is human, always, and no tool for it exists.',
    run: (a, ctx) => payops.draftPayroll({ ...a, actor: ctx.actor }),
  },
  create_procurement: {
    write: true, permission: 'finance.view',
    about: 'Open a purchase request at the start of the chain.',
    run: (a, ctx) => procure.createProcurement({ ...a, actor: ctx.actor }),
  },
  advance_procurement: {
    write: true, permission: 'finance.view',
    about: 'Move a purchase one legal step. Goods, not money: approval and payment refuse a non-human actor inside Core 2.',
    run: (a, ctx) => procure.advanceProcurement(a.id, { to: a.to, actor: ctx.actor }),
  },

  search_documents: {
    write: false, permission: 'docs.view',
    about: 'Titles and internal bodies only — guarded contents are never searched.',
    run: ({ q: term, limit = 20 }) => docs.searchDocuments(term, { limit }),
  },
  get_asset: {
    write: false, permission: 'assets.view',
    about: 'One company asset, for the offboarding return checklist.',
    run: ({ id }) => one('SELECT * FROM assets WHERE id = ?', Number(id)),
  },
  draft_review_evidence: {
    write: true, permission: 'people.manage', pii: true,
    about: 'Write the evidence half of a review. There is no rating parameter: an AI summarizes, a human judges.',
    run: (a, ctx) => talent.writeReviewEvidence({ ...a, actor: ctx.actor }),
  },
  advance_application: {
    write: true, permission: 'people.manage',
    about: 'Move an application through screening. Offers, hires and rejections refuse a machine inside Core 2.',
    run: (a, ctx) => talent.advanceApplication(a.id, { to: a.to, actor: ctx.actor }),
  },

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

  // --- the rest of the company: reads ---
  get_attendance_exceptions: {
    write: false, permission: 'people.view',
    about: 'Lateness and absence for a month, measured against each person\'s shift. Counts, never reasons.',
    run: ({ period = null }) => hrplus.attendanceExceptions(period ? { period } : {}),
  },
  get_stock_levels: {
    write: false, permission: 'ops.view',
    about: 'Every item, its level per warehouse, and whether it is below its minimum.',
    run: () => ops.stockLevels(),
  },
  get_cash_position: {
    write: false, permission: 'bank.view',
    about: 'Ledger balance per bank account and cash box, against the last statement.',
    run: () => bank.cashPosition(),
  },
  get_reconciliation: {
    write: false, permission: 'bank.view',
    about: 'Unmatched statement lines and open journal lines for one account.',
    run: ({ accountId }) => bank.reconciliation(accountId),
  },
  get_budget_variance: {
    write: false, permission: 'finance.view',
    about: 'Budget against actual, line by line, from the posted journal.',
    run: ({ budgetId }) => finance.budgetVariance(budgetId),
  },
  get_ap_aging: {
    write: false, permission: 'finance.view',
    about: 'What is owed to vendors, bucketed by how overdue it is.',
    run: () => finance.apAging(),
  },
  get_ar_aging: {
    write: false, permission: 'finance.view',
    about: 'What customers owe, bucketed by how overdue it is.',
    run: () => finance.arAging(),
  },
  list_open_tickets: {
    write: false, permission: 'ops.view',
    about: 'Help-desk tickets that are not yet resolved, SLA first.',
    run: ({ state = null }) => ops.listTickets({ state }),
  },
  get_room_availability: {
    write: false, permission: 'ops.view',
    about: 'Rooms and their bookings for a day.',
    run: ({ day = null }) => ops.roomAvailability(day || undefined),
  },
  get_fleet: {
    write: false, permission: 'ops.view',
    about: 'Vehicles, who holds them, and when they are next due for service.',
    run: () => ops.fleet(),
  },
  list_obligations: {
    write: false, permission: 'admin.view',
    about: 'The regulatory calendar: what is due, to whom, and what is overdue.',
    run: () => admin.listObligations(),
  },
  list_licenses: {
    write: false, permission: 'admin.view',
    about: 'Company licences and registrations with their expiry.',
    run: () => admin.listLicenses(),
  },
  list_cases: {
    write: false, permission: 'legal.view',
    about: 'Legal cases, next hearing first.',
    run: () => admin.listCases(),
  },
  list_letters: {
    write: false, permission: 'admin.view',
    about: 'The correspondence register.',
    run: ({ limit = 50 }) => admin.listLetters({ limit }),
  },

  // --- the rest of the company: writes, through the gateway ---
  request_overtime: {
    write: true, permission: 'people.manage',
    about: 'File an overtime claim for somebody. Deciding it is a manager\'s act.',
    run: (a, ctx) => hrplus.requestOvertime({ ...a, actor: ctx.actor }),
  },
  draft_budget: {
    write: true, permission: 'finance.export',
    about: 'Draft a budget with its lines. Adopting it waits for a person.',
    run: (a, ctx) => finance.createBudget({ ...a, actor: ctx.actor }),
  },
  draft_bill: {
    write: true, permission: 'finance.export',
    about: 'Record a vendor bill as a draft. Paying it waits for a person.',
    run: (a, ctx) => finance.createBill({ ...a, actor: ctx.actor }),
  },
  approve_bill: {
    write: true, permission: 'finance.export',
    about: 'Approve a draft bill. Ordinary value ceiling applies; paying is still human.',
    run: ({ id }, ctx) => finance.approveBill(id, { actor: ctx.actor }),
  },
  draft_invoice: {
    write: true, permission: 'finance.export',
    about: 'Draft a customer invoice in the fiat books.',
    run: (a, ctx) => finance.createInvoice({ ...a, actor: ctx.actor }),
  },
  issue_invoice: {
    write: true, permission: 'finance.export',
    about: 'Issue a drafted invoice; the ledger recognises the receivable.',
    run: ({ id }, ctx) => finance.issueInvoice(id, { actor: ctx.actor }),
  },
  run_depreciation: {
    write: true, permission: 'finance.export',
    about: 'Post a month of straight-line depreciation. Idempotent per asset and month.',
    run: (a, ctx) => finance.runDepreciation({ ...a, actor: ctx.actor }),
  },
  set_fx_rate: {
    write: true, permission: 'finance.export',
    about: 'Record an exchange rate to USD for a day.',
    run: (a, ctx) => finance.setFxRate({ ...a, actor: ctx.actor }),
  },
  draft_transfer: {
    write: true, permission: 'bank.manage',
    about: 'Draft a transfer between accounts or to an outside beneficiary. Executing it is human.',
    run: (a, ctx) => bank.createTransfer({ ...a, actor: ctx.actor }),
  },
  import_statement: {
    write: true, permission: 'bank.manage',
    about: 'Import a bank statement\'s lines for reconciliation.',
    run: (a, ctx) => bank.importStatement({ ...a, actor: ctx.actor }),
  },
  auto_match: {
    write: true, permission: 'bank.manage',
    about: 'Match statement lines to journal lines where exactly one candidate fits.',
    run: ({ accountId }, ctx) => bank.autoMatch(accountId, { actor: ctx.actor }),
  },
  record_stock_move: {
    write: true, permission: 'ops.manage',
    about: 'Receipt, issue or adjustment of stock in a warehouse.',
    run: (a, ctx) => ops.recordStockMove({ ...a, actor: ctx.actor }),
  },
  create_workorder: {
    write: true, permission: 'ops.manage',
    about: 'Raise a maintenance work order on an asset, vehicle or room.',
    run: (a, ctx) => ops.createWorkOrder({ ...a, actor: ctx.actor }),
  },
  book_room: {
    write: true, permission: 'ops.view',
    about: 'Book a room for an employee. Refuses a clash.',
    run: (a, ctx) => ops.bookRoom({ ...a, actor: ctx.actor }),
  },
  open_ticket: {
    write: true, permission: 'ops.view',
    about: 'Open a help-desk ticket on somebody\'s behalf.',
    run: (a, ctx) => ops.openTicket({ ...a, actor: ctx.actor }),
  },
  report_incident: {
    write: true, permission: 'ops.manage',
    about: 'Report a workplace incident. Closing it is human.',
    run: (a, ctx) => ops.reportIncident({ ...a, actor: ctx.actor }),
  },
  draft_letter: {
    write: true, permission: 'admin.manage',
    about: 'Register a letter, in or out. Sending an outgoing letter is human.',
    run: (a, ctx) => admin.registerLetter({ ...a, actor: ctx.actor }),
  },
  add_obligation: {
    write: true, permission: 'admin.manage',
    about: 'Put a regulatory obligation on the calendar.',
    run: (a, ctx) => admin.addObligation({ ...a, actor: ctx.actor }),
  },
  propose_resolution: {
    write: true, permission: 'admin.manage',
    about: 'Propose a resolution to a committee. Adopting it is human.',
    run: (a, ctx) => admin.proposeResolution({ ...a, actor: ctx.actor }),
  },
  open_case: {
    write: true, permission: 'legal.manage',
    about: 'Open a legal case file. Concluding it is human.',
    run: (a, ctx) => admin.openCase({ ...a, actor: ctx.actor }),
  },
};

/**
 * What the egress log is allowed to remember about a Core 2 call.
 *
 * The gate records every attempt's payload, and the egress log is not
 * erasable — so a review summary or a CV passed as a tool argument would be a
 * plaintext copy of personal text in a log that outlives the person. The test
 * that planted evidence through the gateway found it there, not in the table
 * it was aimed at: the same leak-one-table-to-the-left failure runs.input had.
 *
 * So long strings are logged as their shape — length and a hash prefix —
 * which is still evidence of what was attempted (the hash pins the content)
 * without the log becoming a second, unerasable home for the words. Short
 * strings pass through; ids, dates and enums are what the log is for.
 */
function redactForLog(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    out[k] = typeof v === 'string' && v.length > 48
      ? `[${v.length} chars, sha256:${createHash('sha256').update(v).digest('hex').slice(0, 12)}]`
      : v;
  }
  return out;
}

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
    payload: redactForLog(args),
    logResult: !tool.pii,
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
  const existing = one('SELECT id, scopes FROM connectors WHERE id = ?', CONNECTOR);
  if (existing) {
    // An install that predates a tool would otherwise refuse it forever as a
    // capability the connector never offered — the same trap core2.gated fell
    // into on day one. The declared list is derived, so it is synced, not
    // hand-tended.
    const current = JSON.stringify([...Object.keys(TOOLS).map((t2) => `core2.${t2}`), 'core2.gated']);
    if (existing.scopes !== current) exec('UPDATE connectors SET scopes = ? WHERE id = ?', current, CONNECTOR);
    return { already: true, synced: existing.scopes !== current };
  }
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
  // The rest of the company. Each of these is a different kind of act from a
  // large expense: money leaving, a budget adopted, an asset written off, a
  // case concluded. Amount is irrelevant; a person decides.
  'approveBudget',
  'payBill',
  'releasePayments',
  'executeTransfer',
  'openBankAccount',
  'disposeAsset',
  'payEos',
  'decideGrievance',
  'adoptResolution',
  'concludeCase',
  'closePeriod',
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
    payload: { command: name, ...redactForLog(args) },
    // The value is what makes the ceiling bite for money-shaped commands; the
    // categorical list above is what makes the gate bite regardless.
    valueUsd: Number(args.valueUsd || 0),
    logResult: !(tool && tool.pii),
    force: gated ? false : force,
    call: async () => {
      if (!tool) refuse(`${name} is gated but has no implementation yet`);
      return tool.run(args, { actor });
    },
  });

  if (res.verdict === 'allowed') {
    emit(`core2.${name}`, { command: name, agentId, actor, id: res.result?.id ?? null });
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
/**
 * Which events reach a person, and how urgently.
 *
 * This is the Notifications module the directive asks for, and it is
 * deliberately not a module: notify() already exists, already dedupes, and
 * already feeds the Web Push channel a phone subscribes to. Core 2 adds a
 * mapping, not a mechanism — the same argument as the queue.
 */
const NOTIFY = {
  'leave.requested': { level: 'warn', text: (p) => `Leave request #${p.id ?? ''} is waiting for a manager.` },
  'employee.created': { level: 'info', text: (p) => `${p.employeeNo ?? 'A new employee'} joined the record.` },
  'employee.terminated': { level: 'warn', text: (p) => `An employment ended — offboarding checklist applies.` },
  'task.overdue': { level: 'warn', text: (p) => `Task #${p.id ?? ''} is overdue.` },
  'contract.expiring': { level: 'warn', text: (p) => `A contract expires soon — renewal needs a decision.` },
  'certificate.expiring': { level: 'warn', text: (p) => `A ${p.course || ''} certificate expires soon — renewal or retraining needed.` },
  'payroll.closed': { level: 'info', text: () => 'A payroll period closed.' },
  'invoice.paid': { level: 'info', text: (p) => `Invoice #${p.id ?? ''} was paid.` },
  'overtime.requested': { level: 'info', text: (p) => `Overtime claim #${p.id ?? ''} is waiting for a manager.` },
  'grievance.opened': { level: 'warn', text: (p) => `Grievance #${p.id ?? ''} was raised and waits for review.` },
  'salary.changed': { level: 'info', text: () => 'A salary changed on the record.' },
  'budget.approved': { level: 'info', text: (p) => `Budget #${p.id ?? ''} for ${p.period ?? ''} was adopted.` },
  'bill.paid': { level: 'info', text: (p) => `Bill #${p.id ?? ''} was paid.` },
  'ar.received': { level: 'info', text: (p) => `A receipt landed on invoice #${p.invoiceId ?? ''}.` },
  'transfer.executed': { level: 'warn', text: (p) => `Transfer #${p.id ?? ''} was executed.` },
  'payments.released': { level: 'warn', text: (p) => `Payment batch #${p.id ?? ''} (${p.kind ?? ''}) was released to the bank.` },
  'stock.low': { level: 'warn', text: (p) => `${p.sku ?? 'An item'} is below its minimum stock.` },
  'ticket.breached': { level: 'warn', text: (p) => `Help-desk ticket ${p.ref ?? ''} passed its SLA.` },
  'workplace.incident': { level: 'warn', text: (p) => `A severity-${p.severity ?? ''} ${p.kind ?? ''} incident was reported.` },
  'obligation.due': { level: 'warn', text: (p) => `A regulatory obligation is due on ${p.due ?? 'soon'}.` },
  'license.expiring': { level: 'warn', text: (p) => `A licence expires on ${p.expires ?? 'soon'} — renewal needs a decision.` },
  'case.opened': { level: 'warn', text: (p) => `A ${p.kind ?? ''} case was opened.` },
  'resolution.adopted': { level: 'info', text: (p) => `Resolution ${p.ref ?? ''} was adopted.` },
};

/**
 * The ledger glue — the one place enterprise money becomes accounting.
 *
 * This sits on the Core 1 side of the bridge on purpose: Core 2 emits
 * `payroll.closed` and knows nothing about debits. The entry is posted through
 * the same journalEntry() an accountant uses, so it is balanced or refused,
 * lands in an open period or refuses, exactly like anything typed by hand.
 * If Core 2 ever imports ledger.js directly, that is the second ledger the
 * directive forbids, wearing a disguise.
 */
/**
 * The one door from Core 2 into the chart of accounts. Core 1's addAccount(),
 * called from Core 1's side of the bridge, so a bank account opened in the
 * enterprise core gets its own line under 1000 without bank.js ever touching
 * the ledger module. Idempotent: an account that exists is left alone.
 */
export function ensureLedgerAccount({ code, name, type, parentCode = null, note = null }) {
  if (one('SELECT code FROM accounts WHERE code = ?', String(code))) return false;
  try {
    addAccount({ code: String(code), name, type, parentCode, note, actor: 'system:core2-bridge' });
    return true;
  } catch { return false; /* raced another tick; the account exists */ }
}

function ensureSalariesAccount() {
  ensureLedgerAccount({ code: '5250', name: 'Salaries and wages', type: 'expense', note: 'Payroll, posted by the bridge on close' });
  ensureLedgerAccount({ code: '5260', name: 'Employer contributions', type: 'expense', parentCode: '5250', note: 'The company\'s share of benefit plans' });
  ensureLedgerAccount({ code: '2210', name: 'Contributions payable', type: 'liability', note: 'Withheld and owed to plans and funds' });
}
function ensureAssetAccounts() {
  ensureLedgerAccount({ code: '1510', name: 'Accumulated depreciation', type: 'asset', parentCode: '1500', note: 'Contra to equipment; carries a credit balance' });
  ensureLedgerAccount({ code: '5600', name: 'Depreciation', type: 'expense', note: 'Straight-line, posted monthly by the bridge' });
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** Drop empty lines so an optional tax or fee of zero cannot unbalance an entry. */
const live = (lines) => lines.filter((l) => r2(l.debit) > 0 || r2(l.credit) > 0);

const LEDGER_GLUE = {
  // Gross is the company's cost; net leaves the bank; what is withheld is
  // owed onward as two liabilities — tax to the state, contributions to the
  // plans — and the employer's own share is a cost of its own.
  'payroll.closed': (p) => {
    ensureSalariesAccount();
    const tax = p.totalTax != null ? r2(p.totalTax) : r2(p.totalGross - p.totalNet);
    const contrib = r2(p.totalContrib);
    const employer = r2(p.totalEmployer);
    const rest = r2(p.totalGross - p.totalNet - tax - contrib);
    const lines = [
      { account: '5250', debit: p.totalGross },
      { account: '1000', credit: p.totalNet },
      { account: '2200', credit: r2(tax + Math.max(0, rest)) },
      { account: '2210', credit: contrib },
    ];
    if (employer > 0) lines.push({ account: '5260', debit: employer }, { account: '2210', credit: employer });
    return { memo: `Payroll ${p.period}`, lines: live(lines), sourceId: `payroll-${p.id}` };
  },
  // End of service: one person's money, so the event carried no amount. The
  // bridge opens the sealed figure here, at posting time, and the memo names
  // the employment and never the person.
  'eos.paid': (p) => {
    ensureSalariesAccount();
    const row = one('SELECT amount FROM hr_eos WHERE employee_id = ?', Number(p.id));
    const amount = r2(openPii(row?.amount));
    if (!(amount > 0)) return null;
    return { memo: `End of service, employment #${p.id}`, lines: [{ account: '5250', debit: amount }, { account: '1000', credit: amount }], sourceId: `eos-${p.id}` };
  },
  // A bank account's opening balance is an opening entry against capital.
  'bank.opened': (p) => ({
    memo: `Opening balance, bank account #${p.id}`,
    lines: [{ account: p.glCode, debit: p.opening }, { account: '3000', credit: p.opening }],
    sourceId: `bank-open-${p.id}`,
  }),
  // A bill approved is a cost incurred and a debt owed; paid, the debt clears
  // out of the account it was paid from.
  'bill.approved': (p) => ({
    memo: `Bill #${p.id} approved`,
    lines: live([{ account: p.accountCode || '5100', debit: p.amount }, { account: '2200', debit: p.tax }, { account: '2000', credit: r2(p.amount + (p.tax || 0)) }]),
    sourceId: `bill-appr-${p.id}`,
  }),
  'bill.paid': (p) => ({
    memo: `Bill #${p.id} paid`,
    lines: [{ account: '2000', debit: p.total }, { account: p.glCode || '1000', credit: p.total }],
    sourceId: `bill-paid-${p.id}`,
  }),
  // A customer invoice issued is revenue earned and money owed to us; a
  // receipt moves it from owed to held.
  'ar.issued': (p) => ({
    memo: `Invoice #${p.id} issued`,
    lines: live([{ account: '1100', debit: r2(p.amount + (p.tax || 0)) }, { account: '4000', credit: p.amount }, { account: '2200', credit: p.tax }]),
    sourceId: `ar-issued-${p.id}`,
  }),
  'ar.received': (p) => ({
    memo: `Receipt #${p.id} on invoice #${p.invoiceId}`,
    lines: [{ account: p.glCode || '1000', debit: p.amount }, { account: '1100', credit: p.amount }],
    sourceId: `ar-rcpt-${p.id}`,
  }),
  // Fixed assets: bought, worn down a month at a time, written off.
  'asset.acquired': (p) => {
    ensureAssetAccounts();
    return { memo: `Fixed asset #${p.id} acquired`, lines: [{ account: '1500', debit: p.cost }, { account: '1000', credit: p.cost }], sourceId: `fa-acq-${p.id}` };
  },
  'depreciation.posted': (p) => {
    ensureAssetAccounts();
    return { memo: `Depreciation ${p.period}`, lines: [{ account: '5600', debit: p.total }, { account: '1510', credit: p.total }], sourceId: `dep-${p.period}-${p.id}` };
  },
  'asset.disposed': (p) => {
    ensureAssetAccounts();
    const loss = r2(p.cost - p.accumulated);
    return { memo: `Fixed asset #${p.id} disposed`, lines: live([{ account: '1510', debit: p.accumulated }, { account: '5900', debit: loss }, { account: '1500', credit: p.cost }]), sourceId: `fa-disp-${p.id}` };
  },
  // Money between our own accounts, or out to somebody else. The fee is a
  // bank charge either way.
  'transfer.executed': (p) => ({
    memo: `Transfer #${p.id}`,
    lines: live([
      { account: p.toGl || p.purposeCode || '5900', debit: p.amount },
      { account: '5500', debit: p.fee },
      { account: p.fromGl, credit: r2(p.amount + (p.fee || 0)) },
    ]),
    sourceId: `xfer-${p.id}`,
  }),
  'cheque.cleared': (p) => ({
    memo: `Cheque #${p.id} cleared`,
    lines: p.direction === 'received'
      ? [{ account: p.glCode, debit: p.amount }, { account: p.invoiceId ? '1100' : '4900', credit: p.amount }]
      : [{ account: '5900', debit: p.amount }, { account: p.glCode, credit: p.amount }],
    sourceId: `chq-${p.id}`,
  }),
  // A payroll batch released moves the cash the close already spent from the
  // parent cash account to the account it actually left. Bills in an AP batch
  // were posted one by one as they were paid, so that kind posts nothing.
  'payments.released': (p) => {
    if (p.kind === 'ap' || !p.glCode || p.glCode === '1000') return null;
    return { memo: `Payments released, batch #${p.id} (${p.kind})`, lines: [{ account: '1000', debit: p.total }, { account: p.glCode, credit: p.total }], sourceId: `batch-${p.id}` };
  },
  'expense.paid': (p) => ({
    memo: `Expense #${p.id} (${p.category || 'other'})`,
    lines: [{ account: '5900', debit: p.amount }, { account: '1000', credit: p.amount }],
    sourceId: `expense-${p.id}`,
  }),
  // Invoice received: we owe. Paid: the debt clears.
  'invoice.created': (p) => ({
    memo: `Procurement #${p.id} invoiced`,
    lines: [{ account: '5100', debit: p.amount }, { account: '2000', credit: p.amount }],
    sourceId: `proc-inv-${p.id}`,
  }),
  'invoice.paid': (p) => ({
    memo: `Procurement #${p.id} paid`,
    lines: [{ account: '2000', debit: p.amount }, { account: '1000', credit: p.amount }],
    sourceId: `proc-pay-${p.id}`,
  }),
};

handle('core2.event', async ({ event, payload }) => {
  if (shouldChain(event)) {
    audit({
      actorType: 'system', actorId: 'system:core2', action: event,
      subjectType: 'core2', subjectId: String(payload?.id ?? event),
      payload: payload || {},
    });
    exec("UPDATE core2_log SET chained = 1 WHERE action = ? AND chained = 0", String(event));
  }
  // Reaching a person is part of the event's job, not an afterthought. Note
  // what the text never carries: a name, a reason, a body — the notification
  // table is not erasable, so it gets the pointer and not the words, the same
  // rule the support desk already follows.
  const n = NOTIFY[event];
  if (n) {
    notify({
      level: n.level, source: 'core2', message: n.text(payload || {}),
      // The dedupe key carries the event name: two different events about
      // entity #1 are two messages, not one — an unread 'invoice paid' must
      // never swallow a 'contract expiring' that happens to share an id.
      subjectType: 'core2', subjectId: payload?.id != null ? `${event}#${payload.id}` : null,
    });
  }
  // Money becomes accounting, through Core 1's ledger and nowhere else. The
  // idempotent sourceId means a retried event cannot post twice.
  const glue = LEDGER_GLUE[event];
  let posted = false;
  if (glue && payload) {
    const entry = glue(payload);
    // A glue may decline (nothing to post for this shape) by returning null.
    if (entry && entry.lines.length >= 2 && entry.lines.every((l) => (l.debit || l.credit) > 0)) {
      const dup = one("SELECT id FROM journal WHERE source = 'core2' AND source_id = ?", entry.sourceId);
      if (!dup) {
        const j = journalEntry({
          memo: entry.memo, lines: entry.lines, source: 'core2', sourceId: entry.sourceId,
          actor: 'system:core2-bridge', post: true,
        });
        posted = Boolean(j);
      }
    }
  }
  return { event, chained: shouldChain(event), notified: Boolean(n), posted };
});

/** Everything Core 2 can announce. Declared so it can be subscribed to. */
export const EVENTS = [
  'employee.created', 'employee.promoted', 'employee.terminated',
  'person.created', 'org.changed',
  'leave.requested', 'leave.approved', 'leave.rejected',
  'meeting.started', 'meeting.completed',
  'task.created', 'task.overdue',
  'expense.submitted', 'invoice.created', 'invoice.paid',
  'payroll.closed', 'contract.signed', 'contract.expiring', 'certificate.expiring',
  // the rest of the company
  'overtime.requested', 'salary.changed', 'eos.paid', 'grievance.opened',
  'budget.approved', 'bill.approved', 'bill.paid', 'ar.issued', 'ar.received',
  'asset.acquired', 'depreciation.posted', 'asset.disposed',
  'bank.opened', 'transfer.executed', 'cheque.cleared', 'payments.released',
  'stock.low', 'workorder.created', 'ticket.opened', 'ticket.breached', 'workplace.incident',
  'resolution.adopted', 'case.opened', 'case.settled', 'obligation.due', 'license.expiring',
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
  'eos.paid', 'budget.approved', 'bill.paid', 'ar.received', 'asset.acquired', 'asset.disposed',
  'bank.opened', 'transfer.executed', 'payments.released', 'resolution.adopted', 'case.opened', 'case.settled',
]);

export const shouldChain = (event) => CHAINED_EVENTS.has(event);

// ------------------------------------------------------------ overview --

/**
 * The verb set, per module — measured from what is wired, never typed.
 *
 * The directive names eight verbs: Ask, Summarize, Analyze, Recommend, Draft,
 * Execute (gated), Automate, Monitor. This derives which module has which,
 * from the tool surface, the event list and the categorical gate — so a verb
 * shown here has code behind it, and a module missing one says so instead of
 * getting a tick. Summarize/Analyze/Recommend arrive through Core 1's agents
 * reading via the tools and answering in a run; they are listed where a read
 * tool exists to feed them, because an agent cannot summarize what it cannot
 * read.
 */
export function verbCoverage() {
  const MODULES = {
    identity: /^(get_employee|search_employees|get_person|get_org_chart|get_reporting_line|create_org_unit|create_position)$/,
    time: /^(get_leave_balance|get_attendance_today|create_leave_request)$/,
    meetings: /^(get_meeting|create_meeting|create_action_item)$/,
    documents: /^(search_documents)$/,
    payops: /^(get_payroll|create_expense|approve_expense|draft_payroll)$/,
    procurement: /^(create_procurement|advance_procurement|get_asset)$/,
    talent: /^(draft_review_evidence|advance_application)$/,
    contracts: /^(list_expiring_contracts)$/,
    hrplus: /^(get_attendance_exceptions|request_overtime)$/,
    finance: /^(get_budget_variance|get_ap_aging|get_ar_aging|draft_budget|draft_bill|approve_bill|draft_invoice|issue_invoice|run_depreciation|set_fx_rate)$/,
    bank: /^(get_cash_position|get_reconciliation|draft_transfer|import_statement|auto_match)$/,
    ops: /^(get_stock_levels|list_open_tickets|get_room_availability|get_fleet|record_stock_move|create_workorder|book_room|open_ticket|report_incident)$/,
    admin: /^(list_obligations|list_licenses|list_cases|list_letters|draft_letter|add_obligation|propose_resolution|open_case)$/,
  };
  const gatedFor = {
    identity: ['deletePerson'], payops: ['approvePayroll', 'changeSalary'],
    talent: ['terminateEmployee', 'recordDisciplinary'], contracts: ['signContract'],
    hrplus: ['changeSalary', 'payEos', 'decideGrievance'],
    finance: ['approveBudget', 'payBill', 'disposeAsset', 'closePeriod'],
    bank: ['openBankAccount', 'executeTransfer', 'releasePayments'],
    admin: ['adoptResolution', 'concludeCase'],
  };
  const EVENT_PREFIX = {
    payops: ['payroll.'], talent: ['employee.'], time: ['time.', 'leave.'], contracts: ['contract.'],
    hrplus: ['overtime.', 'salary.', 'eos.', 'grievance.'],
    finance: ['budget.', 'bill.', 'ar.', 'asset.', 'depreciation.'],
    bank: ['bank.', 'transfer.', 'cheque.', 'payments.'],
    ops: ['stock.', 'workorder.', 'ticket.', 'workplace.'],
    admin: ['resolution.', 'case.', 'obligation.', 'license.'],
  };
  return Object.entries(MODULES).map(([module, re]) => {
    const tools = Object.entries(TOOLS).filter(([n]) => re.test(n));
    const reads = tools.filter(([, t2]) => !t2.write).map(([n]) => n);
    const writes = tools.filter(([, t2]) => t2.write).map(([n]) => n);
    const prefixes = EVENT_PREFIX[module] || [`${module}.`];
    const events = EVENTS.filter((e2) => prefixes.some((p) => e2.startsWith(p)));
    return {
      module,
      ask: reads.length > 0,
      summarize: reads.length > 0, analyze: reads.length > 0, recommend: reads.length > 0,
      draft: writes.length > 0,
      executeGated: (gatedFor[module] || []).filter((c) => ALWAYS_HUMAN.has(c)),
      automate: writes.length > 0,
      monitor: events.length > 0,
      tools: [...reads, ...writes],
    };
  });
}

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
