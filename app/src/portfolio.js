// The portfolio desk — where an idea becomes an order, and only a person
// turns an order into a trade.
//
// Every book starts on paper: real prices when the markets desk is live,
// simulated fills against them, no money anywhere. A broker account (Alpaca,
// its paper endpoint unless a person says otherwise in so many words) uses the
// same orders, the same checks and the same approval, and sends through the
// egress gate with that approval attached.
//
// The checks run twice: when an order is proposed, so a person sees at once
// why it would be refused, and again when it is approved, because the price a
// person looked at an hour ago is not the price it will fill at.
import { q, one, exec, atomically } from './db.js';
import { audit } from './audit.js';
import { getSecret } from './settings.js';
import { callConnector, connect, setConnectorState } from './connectors/index.js';
import { lastPrice, analyze, prefs, source as priceSource } from './markets.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const today = () => new Date().toISOString().slice(0, 10);
const num = (k, d) => { const v = Number(getSecret(k)); return Number.isFinite(v) && v > 0 ? v : d; };

export const limits = () => ({
  startCash: num('PF_START_CASH', 100_000),
  maxPositionPct: num('PF_MAX_POSITION_PCT', 20),
  maxOrderUsd: num('PF_MAX_ORDER_USD', 25_000),
  maxOrdersDay: num('PF_MAX_ORDERS_DAY', 20),
  slippageBps: num('PF_SLIPPAGE_BPS', 5),
  autoPropose: String(getSecret('PF_AUTOPROPOSE') || 'true') === 'true',
});

// --------------------------------------------------------------- accounts --

export function ensurePaperBook({ actor = 'system:portfolio' } = {}) {
  const have = one("SELECT * FROM pf_accounts WHERE kind = 'paper' ORDER BY id LIMIT 1");
  if (have) return have;
  const cash = limits().startCash;
  const r = exec("INSERT INTO pf_accounts (name, kind, cash, start_cash, created_by) VALUES ('Paper book', 'paper', ?, ?, ?)", cash, cash, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'portfolio.account_opened', subjectType: 'pf_account', subjectId: Number(r.lastInsertRowid), payload: { kind: 'paper', cash } });
  return one('SELECT * FROM pf_accounts WHERE id = ?', Number(r.lastInsertRowid));
}

/**
 * Connect a broker. Paper endpoint by default; real money only when a person
 * types the phrase, because a checkbox is too easy to tick on the way past.
 */
export function addBroker({ name = 'Alpaca', key, live = false, confirm = '', actor }) {
  if (!isHuman(actor)) refuse('a person connects a broker', 403);
  if (!key || !String(key).includes(':')) refuse('paste the Alpaca key as KEY_ID:SECRET');
  if (live && confirm !== 'REAL MONEY') refuse('type REAL MONEY to connect a live-money account');
  connect('broker', { secret: String(key).trim(), actor });
  exec('UPDATE connectors SET config = ? WHERE id = ?', JSON.stringify({ live: Boolean(live) }), 'broker');
  setConnectorState('broker', 'live', { actor });
  const r = exec("INSERT INTO pf_accounts (name, kind, connector, cash, start_cash, created_by) VALUES (?, 'broker', 'broker', 0, 0, ?)",
    String(name).slice(0, 60) + (live ? ' (live money)' : ' (broker paper)'), actor);
  audit({ actorType: 'human', actorId: actor, action: 'portfolio.broker_connected', subjectType: 'pf_account', subjectId: Number(r.lastInsertRowid), payload: { live: Boolean(live) } });
  return one('SELECT * FROM pf_accounts WHERE id = ?', Number(r.lastInsertRowid));
}

function account(id) {
  const a = one('SELECT * FROM pf_accounts WHERE id = ?', Number(id));
  if (!a) refuse('no such account', 404);
  return a;
}

export function valuation(acc) {
  const positions = q('SELECT * FROM pf_positions WHERE account_id = ? AND qty <> 0 ORDER BY symbol', acc.id).map((p) => {
    const lp = lastPrice(p.symbol);
    const price = lp?.price ?? p.avg_cost;
    return { ...p, price, value: round(price * p.qty), pnl: round((price - p.avg_cost) * p.qty), pnlPct: p.avg_cost ? round((price / p.avg_cost - 1) * 100) : 0, priceSource: lp?.source || 'cost' };
  });
  const invested = positions.reduce((a, p) => a + p.value, 0);
  const equity = round(acc.cash + invested);
  for (const p of positions) p.weight = equity ? round((p.value / equity) * 100) : 0;
  return { equity, invested: round(invested), cash: round(acc.cash), positions, returnPct: acc.start_cash ? round((equity / acc.start_cash - 1) * 100) : null };
}

// ----------------------------------------------------------------- checks --

function checks(acc, { symbol, side, qty, price }) {
  const L = limits();
  const v = valuation(acc);
  const held = v.positions.find((p) => p.symbol === symbol)?.qty || 0;
  const value = qty * price;
  const after = side === 'buy' ? (held + qty) * price : (held - qty) * price;
  const today0 = one("SELECT COUNT(*) AS n FROM pf_orders WHERE account_id = ? AND created_at >= date('now')", acc.id).n;
  const list = [
    { name: 'price', ok: Number.isFinite(price) && price > 0, why: 'the desk has a price for it' },
    { name: 'no-short', ok: side === 'buy' || qty <= held + 1e-9, why: side === 'sell' ? `selling ${qty}, holding ${held}` : 'buying' },
    { name: 'cash', ok: acc.kind !== 'paper' || side === 'sell' || value <= acc.cash + 1e-6, why: `order ${round(value)} against cash ${round(acc.cash)}` },
    { name: 'order-size', ok: value <= L.maxOrderUsd, why: `order ${round(value)}, limit ${L.maxOrderUsd}` },
    { name: 'concentration', ok: side === 'sell' || !v.equity || (after / Math.max(v.equity, 1)) * 100 <= L.maxPositionPct, why: `${round(v.equity ? (after / v.equity) * 100 : 0)}% of the book after, limit ${L.maxPositionPct}%` },
    { name: 'daily-count', ok: today0 < L.maxOrdersDay, why: `${today0} orders today, limit ${L.maxOrdersDay}` },
    // A real order priced off an invented quote is the worst mistake this
    // desk could make, so it is not a warning.
    { name: 'real-price', ok: acc.kind === 'paper' || priceSource() === 'live', why: priceSource() === 'live' ? 'live prices' : 'prices are simulated — a broker order needs live data' },
  ];
  return { ok: list.every((c) => c.ok), checks: list, value: round(value) };
}

// ----------------------------------------------------------------- orders --

/**
 * Propose an order. A person or an agent may; nobody's proposal fills itself.
 * With no quantity, the size comes from the volatility-targeted weight the
 * markets desk computed for the house risk profile.
 */
export function propose({ accountId = null, symbol, side, qty = null, orderType = 'market', limitPrice = null, rationale = '', actor }) {
  if (!actor) refuse('an order has to name who proposed it');
  const acc = accountId ? account(accountId) : ensurePaperBook();
  const s = String(symbol || '').toUpperCase();
  if (!['buy', 'sell'].includes(side)) refuse('side is buy or sell');
  if (!['market', 'limit'].includes(orderType)) refuse('market or limit');
  if (!one('SELECT symbol FROM mkt_watch WHERE symbol = ?', s)) refuse('put the symbol on the watchlist first, so the desk is pricing it');
  const lp = lastPrice(s);
  if (!lp) refuse('the desk has no price for that symbol yet');
  const price = orderType === 'limit' ? Number(limitPrice) : lp.price;
  if (orderType === 'limit' && !(price > 0)) refuse('a limit order needs a limit price');
  let n = Number(qty);
  if (!(n > 0)) {
    const sz = analyze(s, { profile: prefs().profile }).sizing;
    const eq = valuation(acc).equity || acc.cash;
    n = sz ? Math.floor(((sz.weight * eq) / lp.price) * 1e4) / 1e4 : 0;
    if (side === 'sell') n = Math.min(n || Infinity, one('SELECT qty FROM pf_positions WHERE account_id = ? AND symbol = ?', acc.id, s)?.qty || 0);
    if (!(n > 0)) refuse('give a quantity — there was nothing to size this from');
  }
  const risk = checks(acc, { symbol: s, side, qty: n, price });
  const r = exec(`INSERT INTO pf_orders (account_id, symbol, side, qty, order_type, limit_price, est_price, est_value, rationale, risk, proposed_by, state)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  acc.id, s, side, n, orderType, orderType === 'limit' ? price : null, lp.price, risk.value, String(rationale || '').slice(0, 2000),
  JSON.stringify(risk), actor, risk.ok ? 'proposed' : 'held');
  const id = Number(r.lastInsertRowid);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'portfolio.proposed', subjectType: 'pf_order', subjectId: id, payload: { account: acc.id, symbol: s, side, qty: n, value: risk.value, passed: risk.ok } });
  return getOrder(id);
}

export function getOrder(id) {
  const o = one('SELECT * FROM pf_orders WHERE id = ?', Number(id));
  if (!o) refuse('no such order', 404);
  return { ...o, risk: o.risk ? JSON.parse(o.risk) : null };
}

function fill(o, price, { actor, brokerRef = null }) {
  atomically(() => {
    const acc = account(o.account_id);
    const pos = one('SELECT * FROM pf_positions WHERE account_id = ? AND symbol = ?', acc.id, o.symbol);
    const value = o.qty * price;
    if (o.side === 'buy') {
      const qty = (pos?.qty || 0) + o.qty;
      const avg = ((pos?.qty || 0) * (pos?.avg_cost || 0) + value) / qty;
      exec(`INSERT INTO pf_positions (account_id, symbol, qty, avg_cost) VALUES (?,?,?,?)
            ON CONFLICT(account_id, symbol) DO UPDATE SET qty = excluded.qty, avg_cost = excluded.avg_cost`, acc.id, o.symbol, qty, avg);
      if (acc.kind === 'paper') exec('UPDATE pf_accounts SET cash = cash - ? WHERE id = ?', value, acc.id);
    } else {
      const qty = (pos?.qty || 0) - o.qty;
      if (qty <= 1e-9) exec('DELETE FROM pf_positions WHERE account_id = ? AND symbol = ?', acc.id, o.symbol);
      else exec('UPDATE pf_positions SET qty = ? WHERE account_id = ? AND symbol = ?', qty, acc.id, o.symbol);
      if (acc.kind === 'paper') exec('UPDATE pf_accounts SET cash = cash + ? WHERE id = ?', value, acc.id);
    }
    exec("UPDATE pf_orders SET state = 'filled', fill_price = ?, filled_at = datetime('now'), broker_ref = COALESCE(?, broker_ref) WHERE id = ?", price, brokerRef, o.id);
    audit({
      actorType: 'system', actorId: 'system:portfolio', action: 'portfolio.filled', subjectType: 'pf_order', subjectId: o.id,
      payload: { symbol: o.symbol, side: o.side, qty: o.qty, price, value: round(value), approvedBy: o.decided_by || actor },
    });
  });
}

/**
 * A person says yes. The checks run again at today's price; a paper order
 * fills at once with slippage, a limit order fills when the price crosses,
 * and a broker order goes out through the gate carrying this approval.
 */
// The owner can hand paper orders to the AI (autonomy mode, 'Paper trading'):
// no money moves on paper. A broker order stays a person's, always.
const mayDecide = (actor, acc) => isHuman(actor) || (actor === 'system:autonomy' && acc.kind === 'paper');

export async function approve({ id, note = '', actor }) {
  const o = getOrder(id);
  const acc = account(o.account_id);
  if (!mayDecide(actor, acc)) refuse('only a person approves an order', 403);
  if (o.state !== 'proposed') refuse(`this order is ${o.state}, not waiting for approval`, 409);
  const lp = lastPrice(o.symbol);
  const risk = checks(acc, { symbol: o.symbol, side: o.side, qty: o.qty, price: o.order_type === 'limit' ? o.limit_price : lp?.price });
  if (!risk.ok) {
    exec("UPDATE pf_orders SET state = 'held', risk = ? WHERE id = ?", JSON.stringify(risk), o.id);
    audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'portfolio.held_at_approval', subjectType: 'pf_order', subjectId: o.id, payload: { failed: risk.checks.filter((c) => !c.ok).map((c) => c.name) } });
    refuse(`the checks no longer pass: ${risk.checks.filter((c) => !c.ok).map((c) => c.why).join('; ')}`, 409);
  }
  exec("UPDATE pf_orders SET decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?", actor, String(note).slice(0, 500), o.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'portfolio.approved', subjectType: 'pf_order', subjectId: o.id, payload: { symbol: o.symbol, side: o.side, qty: o.qty, value: risk.value, account: acc.kind } });

  if (acc.kind === 'paper') {
    if (o.order_type === 'limit') {
      exec("UPDATE pf_orders SET state = 'working' WHERE id = ?", o.id);
      workLimits();
      return getOrder(o.id);
    }
    const slip = limits().slippageBps / 10_000;
    fill({ ...o, decided_by: actor }, lp.price * (o.side === 'buy' ? 1 + slip : 1 - slip), { actor });
    return getOrder(o.id);
  }

  const r = await callConnector({
    connector: acc.connector || 'broker', capability: 'order.place', actor, force: true,
    reason: `${o.side} ${o.qty} ${o.symbol}, approved by ${actor}`,
    args: { orderId: o.id, symbol: o.symbol, qty: o.qty, side: o.side, type: o.order_type, limitPrice: o.limit_price, estValue: risk.value },
  });
  exec('UPDATE pf_orders SET egress_id = ? WHERE id = ?', r.id, o.id);
  if (r.verdict !== 'allowed') {
    exec("UPDATE pf_orders SET state = 'failed', decision_note = ? WHERE id = ?", `${r.verdict}: ${r.why || ''}`.slice(0, 500), o.id);
    return getOrder(o.id);
  }
  exec("UPDATE pf_orders SET state = 'submitted', broker_ref = ? WHERE id = ?", r.result?.id || null, o.id);
  return getOrder(o.id);
}

export function reject({ id, note = '', actor }) {
  const o = getOrder(id);
  if (!mayDecide(actor, account(o.account_id))) refuse('only a person turns an order down', 403);
  if (!['proposed', 'held', 'working'].includes(o.state)) refuse(`this order is ${o.state}`, 409);
  exec("UPDATE pf_orders SET state = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?", actor, String(note).slice(0, 500), o.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'portfolio.rejected', subjectType: 'pf_order', subjectId: o.id, payload: { note } });
  return getOrder(o.id);
}

/** Paper limit orders fill when the last price crosses them. */
export function workLimits() {
  for (const o of q("SELECT * FROM pf_orders WHERE state = 'working'")) {
    const lp = lastPrice(o.symbol);
    if (!lp) continue;
    if ((o.side === 'buy' && lp.price <= o.limit_price) || (o.side === 'sell' && lp.price >= o.limit_price)) fill(o, o.limit_price, { actor: 'system:portfolio' });
  }
}

/** Read the broker's side: which submitted orders filled, and at what. */
export async function syncBroker({ actor }) {
  // The broker's cash is the broker's: the mirror here only holds it so the
  // concentration check has a denominator.
  const accR = await callConnector({ connector: 'broker', capability: 'account.read', actor, reason: 'broker cash for the checks' });
  if (accR.verdict === 'allowed' && accR.result?.cash != null) {
    const cash = Number(accR.result.cash);
    exec("UPDATE pf_accounts SET cash = ?, start_cash = CASE WHEN start_cash = 0 THEN ? ELSE start_cash END WHERE kind = 'broker'", cash, Number(accR.result.equity) || cash);
  }
  const subs = q("SELECT * FROM pf_orders WHERE state = 'submitted'");
  if (!subs.length) return { checked: 0 };
  const r = await callConnector({ connector: 'broker', capability: 'orders.list', actor, reason: 'which orders filled' });
  if (r.verdict !== 'allowed') return { verdict: r.verdict, why: r.why };
  const theirs = Array.isArray(r.result) ? r.result : [];
  let filled = 0;
  for (const o of subs) {
    const t = theirs.find((x) => x.client_order_id === `alphacore-${o.id}` || x.id === o.broker_ref);
    if (!t) continue;
    if (t.status === 'filled') { fill(o, Number(t.filled_avg_price), { actor, brokerRef: t.id }); filled++; }
    else if (['canceled', 'expired', 'rejected'].includes(t.status)) exec("UPDATE pf_orders SET state = 'failed', decision_note = ? WHERE id = ?", `broker: ${t.status}`, o.id);
  }
  return { checked: subs.length, filled };
}

/**
 * The analyst's ideas, filed as proposals.
 *
 * The brief already said "buy X, stop at Y". Turning that into an order a
 * person can approve with one click is the useful part; approving it for them
 * would be the dangerous part, and is not done.
 */
export function proposeFromBriefs() {
  if (!limits().autoPropose) return 0;
  const lastSeen = Number(getSecret('PF_LAST_BRIEF') || 0);
  const briefs = q("SELECT id, body FROM mkt_briefs WHERE state = 'ready' AND kind = 'daily' AND id > ? ORDER BY id", lastSeen);
  let n = 0;
  for (const b of briefs) {
    exec("INSERT INTO settings (k, v) VALUES ('PF_LAST_BRIEF', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(b.id));
    let body = null; try { body = JSON.parse(b.body || 'null'); } catch { body = null; }
    for (const idea of (body?.ideas || []).slice(0, 5)) {
      if (!idea?.symbol || !['buy', 'sell'].includes(idea.side) || Number(idea.confidence || 0) < 0.6) continue;
      try {
        propose({ symbol: idea.symbol, side: idea.side, rationale: `From the daily brief #${b.id}: ${idea.why || ''}`, actor: 'agent:AGT-INV-001' });
        n++;
      } catch { /* not on the list, no price, nothing to sell */ }
    }
  }
  return n;
}

// ------------------------------------------------------------------ reads --

export function overview() {
  ensurePaperBook();
  const accounts = q('SELECT * FROM pf_accounts ORDER BY id').map((a) => ({ ...a, ...valuation(a) }));
  const benchmark = (() => {
    const first = one('SELECT MIN(created_at) AS d FROM pf_accounts').d?.slice(0, 10);
    const a = one('SELECT close FROM mkt_bars WHERE symbol = ? AND day >= ? ORDER BY day LIMIT 1', '^GSPC', first || today());
    const b = lastPrice('^GSPC');
    return a && b ? { symbol: '^GSPC', returnPct: round((b.price / a.close - 1) * 100) } : null;
  })();
  return {
    priceSource: priceSource(),
    limits: limits(),
    accounts,
    pending: q("SELECT * FROM pf_orders WHERE state IN ('proposed','held','working','submitted') ORDER BY id DESC").map((o) => ({ ...o, risk: o.risk ? JSON.parse(o.risk) : null })),
    orders: q('SELECT * FROM pf_orders ORDER BY id DESC LIMIT 50').map((o) => ({ ...o, risk: o.risk ? JSON.parse(o.risk) : null })),
    curve: q('SELECT account_id, day, equity FROM pf_snapshots ORDER BY day DESC LIMIT 400').reverse(),
    benchmark,
    broker: one("SELECT state, config, health FROM connectors WHERE id = 'broker'") || null,
    note: 'Paper by default. An order fills only after a person approves it; analysis here is not licensed financial advice.',
  };
}

export function portfolioTick() {
  workLimits();
  proposeFromBriefs();
  for (const a of q('SELECT * FROM pf_accounts')) {
    const v = valuation(a);
    exec(`INSERT INTO pf_snapshots (account_id, day, equity, cash) VALUES (?,?,?,?)
          ON CONFLICT(account_id, day) DO UPDATE SET equity = excluded.equity, cash = excluded.cash`, a.id, today(), v.equity, v.cash);
  }
}
