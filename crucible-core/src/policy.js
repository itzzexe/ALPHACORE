// Policy & budget engine — reservation-first enforcement (Part 3 §4.2).
// Nothing reaches a model without a prior reservation against every applicable
// budget scope; the hard stop fires BEFORE the call, not after the invoice.
import { one, exec } from './db.js';
import { budgetsConfig, providersConfig } from './env.js';
import { audit } from './audit.js';

export class BudgetExceeded extends Error {
  constructor(scope, scopeId, detail) {
    super(`Budget hard-stop: ${scope}/${scopeId} — ${detail}`);
    this.name = 'BudgetExceeded';
    this.scope = scope;
    this.scopeId = scopeId;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

function ensureRow(scope, scopeId, periodKey, capUsd, hardStop = true) {
  let row = one(
    'SELECT * FROM budgets WHERE scope = ? AND scope_id = ? AND period_key = ?',
    scope, scopeId, periodKey,
  );
  if (!row) {
    exec(
      'INSERT INTO budgets (scope, scope_id, period_key, cap_usd, hard_stop) VALUES (?, ?, ?, ?, ?)',
      scope, scopeId, periodKey, capUsd, hardStop ? 1 : 0,
    );
    row = one('SELECT * FROM budgets WHERE scope = ? AND scope_id = ? AND period_key = ?', scope, scopeId, periodKey);
  }
  return row;
}

/** All budget rows that apply to a call from this agent (optionally within a decision case). */
function applicableRows(agentId, decisionId, governance) {
  const rows = [];
  const agentCfg = budgetsConfig.agents[agentId] || { dailyCapUsd: 5, perTaskCapUsd: 1 };
  rows.push(ensureRow('agent', agentId, today(), agentCfg.dailyCapUsd));
  rows.push(ensureRow('company', 'company', month(), budgetsConfig.company.monthlyCapUsd, budgetsConfig.company.hardStop));
  if (governance) rows.push(ensureRow('governance', 'governance', month(), budgetsConfig.governance.monthlyCapUsd, budgetsConfig.governance.hardStop));
  if (decisionId) {
    const tier = decisionId.tier || 'T2';
    const cap = budgetsConfig.decisions[tier] ?? budgetsConfig.decisions.T2;
    rows.push(ensureRow('decision', decisionId.id || decisionId, 'case', cap));
  }
  return rows;
}

/**
 * Reserve estUsd across every applicable scope. Throws BudgetExceeded (hard
 * stop) before any tokens are spent. Returns a reservation handle used to
 * settle with the actual cost afterwards.
 */
export function reserve({ agentId, decisionId = null, estUsd, governance = false }) {
  const rows = applicableRows(agentId, decisionId, governance);
  for (const r of rows) {
    if (r.frozen) throw new BudgetExceeded(r.scope, r.scope_id, 'scope is frozen (Cost Sentinel / human)');
    const would = r.spent_usd + r.reserved_usd + estUsd;
    if (would > r.cap_usd && r.hard_stop) {
      throw new BudgetExceeded(r.scope, r.scope_id, `${would.toFixed(2)} would exceed cap ${r.cap_usd}`);
    }
  }
  for (const r of rows) {
    exec('UPDATE budgets SET reserved_usd = reserved_usd + ? WHERE id = ?', estUsd, r.id);
  }
  return { rowIds: rows.map((r) => r.id), estUsd };
}

/** Settle a reservation with the actual cost (may be less than the estimate). */
export function settle(reservation, actualUsd) {
  for (const id of reservation.rowIds) {
    exec(
      'UPDATE budgets SET reserved_usd = MAX(0, reserved_usd - ?), spent_usd = spent_usd + ? WHERE id = ?',
      reservation.estUsd, actualUsd, id,
    );
  }
}

/** Release a reservation without spend (call failed before any tokens). */
export function release(reservation) {
  for (const id of reservation.rowIds) {
    exec('UPDATE budgets SET reserved_usd = MAX(0, reserved_usd - ?) WHERE id = ?', reservation.estUsd, id);
  }
}

/** Cost Sentinel containment: freeze/unfreeze a scope. Resume is a human decision. */
export function setFrozen(scope, scopeId, frozen, actor = 'system') {
  const keys = scope === 'agent' ? [today()] : [month()];
  for (const k of keys) {
    const cfg = scope === 'agent'
      ? (budgetsConfig.agents[scopeId]?.dailyCapUsd ?? 5)
      : scope === 'governance' ? budgetsConfig.governance.monthlyCapUsd : budgetsConfig.company.monthlyCapUsd;
    ensureRow(scope, scopeId, k, cfg);
    exec('UPDATE budgets SET frozen = ? WHERE scope = ? AND scope_id = ? AND period_key = ?', frozen ? 1 : 0, scope, scopeId, k);
  }
  audit({ actorType: frozen ? 'system' : 'human', actorId: actor, action: frozen ? 'budget.freeze' : 'budget.unfreeze', subjectType: 'budget', subjectId: `${scope}/${scopeId}` });
}

/** Sensitivity ceiling check (Part 3 §7.5): can this provider receive this classification? */
export function providerAllowedFor(providerName, sensitivity) {
  const allowed = providersConfig.sensitivity[sensitivity || 'internal'] || [];
  return allowed.includes(providerName);
}

/** Per-task cap for an agent (router uses it as the reservation estimate ceiling). */
export function perTaskCap(agentId) {
  return budgetsConfig.agents[agentId]?.perTaskCapUsd ?? 1;
}
