// PROCUREMENT & CONTRACT WATCH.
//
// The chain the directive names — request → approval → RFQ/PO → delivery →
// invoice → payment — as a state machine that refuses to skip. A payment with
// no delivery behind it and a PO with no approval are the two classic frauds
// of purchasing, and both are unrepresentable here rather than discouraged.
//
// Vendors live in Core 1's existing table, and contract records in Core 1's
// existing contracts table — one vendor, one contract, one master. What Core 2
// adds is the operational chain in front of the vendor, and the expiry watch
// behind the contract.
import { q, one, exec } from '../db.js';
import { log } from './identity.js';
import { emit } from './bridge.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 160) => String(s ?? '').trim().slice(0, n);

/** The only legal moves. Everything else is a skipped step, refused by name. */
const NEXT = {
  requested: ['approved', 'rejected'],
  approved: ['po'],
  po: ['delivered'],
  delivered: ['invoiced'],
  invoiced: ['paid'],
};

export function createProcurement({ title, amount = 0, vendorId = null, costCenterId = null, actor }) {
  if (!actor) refuse('a purchase request is an act and carries a name');
  if (!clean(title)) refuse('a purchase request needs a title');
  if (vendorId && !one('SELECT id FROM vendors WHERE id = ?', String(vendorId))) refuse('no such vendor');
  exec('INSERT INTO proc_request (title, amount, vendor_id, cost_center_id, requested_by) VALUES (?,?,?,?,?)',
    clean(title), Math.round(Number(amount) * 100) / 100, vendorId ? String(vendorId) : null,
    costCenterId ? Number(costCenterId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'procurement', entityId: id, action: 'procurement.requested', actor, detail: { amount } });
  return one('SELECT * FROM proc_request WHERE id = ?', id);
}

/**
 * Advance the chain one step. Approval and payment are human acts; the middle
 * steps record logistics and may be driven by an agent through the gateway,
 * where the ordinary ceiling still applies to the money on the request.
 */
export function advanceProcurement(id, { to, actor }) {
  if (!actor) refuse('moving a purchase carries a name');
  const p = one('SELECT * FROM proc_request WHERE id = ?', Number(id));
  if (!p) refuse('no such purchase request');
  const legal = NEXT[p.state] || [];
  if (!legal.includes(to)) refuse(`a purchase cannot go from ${p.state} to ${to} — the chain is ${p.state} → ${legal.join('/') || 'nothing'}`);
  if ((to === 'approved' || to === 'rejected' || to === 'paid') && !String(actor).startsWith('human:')) {
    refuse(`${to} is a human act — an agent may move goods, not money`);
  }
  const poNo = to === 'po' ? `PO-${String(p.id).padStart(5, '0')}` : p.po_no;
  exec("UPDATE proc_request SET state = ?, po_no = ?, decided_by = CASE WHEN ? IN ('approved','rejected','paid') THEN ? ELSE decided_by END WHERE id = ?",
    to, poNo, to, String(actor), p.id);
  log({ entity: 'procurement', entityId: p.id, action: `procurement.${to}`, actor, detail: { amount: p.amount }, chain: to === 'paid' });
  if (to === 'invoiced') emit('invoice.created', { id: p.id, amount: p.amount });
  if (to === 'paid') emit('invoice.paid', { id: p.id, amount: p.amount });
  return one('SELECT * FROM proc_request WHERE id = ?', p.id);
}

export function listProcurement({ state = null, limit = 200 } = {}) {
  let sql = 'SELECT p.*, v.name AS vendor_name FROM proc_request p LEFT JOIN vendors v ON v.id = p.vendor_id WHERE 1=1';
  const params = [];
  if (state) { sql += ' AND p.state = ?'; params.push(state); }
  sql += ' ORDER BY p.id DESC LIMIT ?'; params.push(Number(limit));
  return q(sql, ...params);
}

// ---------------------------------------------------- the contract watch --

/**
 * Contracts about to lapse, announced before they do.
 *
 * Reads Core 1's contracts table — the record stays there — and emits one
 * expiring event per contract per horizon, idempotent by construction: the
 * queue's idempotency key means running this sweep every tick costs nothing
 * and forgetting to run it is the only way to miss a renewal.
 */
export function contractExpirySweep({ horizonDays = 30 } = {}) {
  const soon = q(
    `SELECT id, title, counterparty, expires_at FROM contracts
      WHERE state = 'signed' AND expires_at IS NOT NULL
        AND date(expires_at) <= date('now', '+' || ? || ' days')
        AND date(expires_at) >= date('now')`, Number(horizonDays),
  );
  for (const c of soon) {
    emit('contract.expiring', { id: c.id, title: c.title, expiresAt: c.expires_at },
      { idempotency: `contract-expiring-${c.id}-${c.expires_at}` });
  }
  return { watched: soon.length, horizonDays };
}

export function listExpiring({ horizonDays = 90 } = {}) {
  return q(
    `SELECT id, title, counterparty, state, expires_at, obligations FROM contracts
      WHERE expires_at IS NOT NULL AND date(expires_at) <= date('now', '+' || ? || ' days')
      ORDER BY expires_at`, Number(horizonDays),
  );
}

export function procureOverview() {
  const n = (sql) => one(sql).n;
  return {
    open: n("SELECT COUNT(*) AS n FROM proc_request WHERE state NOT IN ('paid','rejected')"),
    awaitingApproval: n("SELECT COUNT(*) AS n FROM proc_request WHERE state = 'requested'"),
    paidThisYear: n(`SELECT COUNT(*) AS n FROM proc_request WHERE state = 'paid' AND created_at >= '${new Date().getFullYear()}-01-01'`),
    expiring: listExpiring({ horizonDays: 90 }),
    note: 'The chain refuses to skip: a payment with no delivery behind it and a PO with no approval are '
      + 'unrepresentable rather than discouraged. Approval and payment are human acts; an agent may move goods, '
      + 'not money. Vendors and contract records stay in Core 1\'s tables — one fact, one master — and the watch '
      + 'announces an expiry before it happens, idempotently.',
  };
}
