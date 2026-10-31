// The cap table — who owns the company, what they were promised, and what a
// round or an exit would do to each of them.
//
// A ledger, not a spreadsheet. Shares are issued and cancelled as rows that
// are never edited: a mistake is corrected by a cancellation that says why,
// so the table on any day can be rebuilt from the rows that existed then and
// an auditor can see every change in the order it was made. Options vest on a
// schedule computed from the grant, never stored, so nobody has to remember
// to "update" a vesting figure. A SAFE or a note sits beside the table until a
// round converts it.
//
// Issuing shares, granting or cancelling options, recording a convertible and
// sizing the pool are a person's acts, and each is written to the chain: they
// change who owns the company. The round modeller and the exit waterfall are
// arithmetic on the table and change nothing; a scenario kept from them is a
// note with the inputs it was run on.
import { q, one, exec, atomically } from './db.js';
import { audit } from './audit.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const person = (actor) => { if (!isHuman(actor)) refuse('a person changes who owns the company', 403); return actor; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
const r4 = (x) => Math.round(Number(x || 0) * 10000) / 10000;
const int = (x, what) => {
  const n = Number(x);
  if (!Number.isInteger(n) || n <= 0) refuse(`${what} must be a whole number above zero`);
  return n;
};
const money = (x, what, { allowZero = true } = {}) => {
  const n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) refuse(`${what} must be ${allowZero ? 'zero or more' : 'above zero'}`);
  return n;
};
const day = (d) => {
  const v = d || today();
  if (!DAY.test(v) || Number.isNaN(Date.parse(v))) refuse('dates are YYYY-MM-DD');
  return v;
};

export const HOLDER_KINDS = ['founder', 'employee', 'investor', 'advisor', 'other'];

// ---------------------------------------------------------------- holders --

export function addHolder({ name, kind = 'other', email = null, note = null, actor }) {
  const n = String(name || '').trim();
  if (!n || n.length > 160) refuse('a holder needs a name');
  if (!HOLDER_KINDS.includes(kind)) refuse(`kind is one of ${HOLDER_KINDS.join(', ')}`);
  const r = exec('INSERT INTO eq_holders (name, kind, email, note, created_by) VALUES (?,?,?,?,?)', n, kind, email || null, note || null, actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'equity.holder', subjectType: 'eq_holder', subjectId: String(id), payload: { name: n, kind } });
  return one('SELECT * FROM eq_holders WHERE id = ?', id);
}

const holder = (id) => one('SELECT * FROM eq_holders WHERE id = ?', Number(id)) || refuse('no such holder', 404);

// ---------------------------------------------------------------- classes --

/**
 * A class of share. Preferred carries a liquidation preference (a multiple of
 * what was paid), may participate after it, and has a seniority — higher is
 * paid first at an exit.
 */
export function addClass({ name, kind = 'common', liqPref = 1, participating = false, seniority = 0, originalPrice = null, actor }) {
  const n = String(name || '').trim();
  if (!n || n.length > 80) refuse('a class needs a name');
  if (!['common', 'preferred'].includes(kind)) refuse('a class is common or preferred');
  if (one('SELECT id FROM eq_classes WHERE name = ?', n)) refuse('there is already a class with that name', 409);
  const lp = kind === 'preferred' ? money(liqPref, 'the preference multiple') : 0;
  if (lp > 10) refuse('a preference above 10× is a typing mistake');
  const r = exec('INSERT INTO eq_classes (name, kind, liq_pref, participating, seniority, original_price) VALUES (?,?,?,?,?,?)',
    n, kind, lp, kind === 'preferred' && participating ? 1 : 0, Math.max(0, Math.min(20, Number(seniority) || 0)),
    originalPrice == null || originalPrice === '' ? null : money(originalPrice, 'the original price'));
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'equity.class', subjectType: 'eq_class', subjectId: String(id), payload: { name: n, kind, liqPref: lp, participating: Boolean(participating) } });
  return one('SELECT * FROM eq_classes WHERE id = ?', id);
}

const shareClass = (id) => one('SELECT * FROM eq_classes WHERE id = ?', Number(id)) || refuse('no such class', 404);

/** The common class, created the first time anything needs it — options exercise into it. */
function commonClass() {
  return one("SELECT * FROM eq_classes WHERE kind = 'common' ORDER BY id LIMIT 1")
    || one('SELECT * FROM eq_classes WHERE id = ?', Number(exec("INSERT INTO eq_classes (name, kind) VALUES ('Common', 'common')").lastInsertRowid));
}

// ---------------------------------------------------------------- shares --

/** Shares issued to a holder. Irreversible in the sense that matters: the row stays. */
export function issueShares({ holderId, classId = null, shares, price = 0, issuedOn = null, ref = null, note = null, actor }) {
  person(actor);
  const h = holder(holderId);
  const c = classId ? shareClass(classId) : commonClass();
  const n = int(shares, 'shares');
  const p = money(price, 'the price');
  const d = day(issuedOn);
  return atomically(() => {
    const r = exec('INSERT INTO eq_ledger (holder_id, class_id, kind, shares, price, on_day, ref, note, actor) VALUES (?,?,?,?,?,?,?,?,?)',
      h.id, c.id, 'issue', n, p, d, ref || null, note || null, actor);
    const id = Number(r.lastInsertRowid);
    audit({ actorType: 'human', actorId: actor, action: 'equity.issued', subjectType: 'eq_ledger', subjectId: String(id), payload: { holder: h.name, class: c.name, shares: n, price: p, on: d, ref } });
    return one('SELECT * FROM eq_ledger WHERE id = ?', id);
  });
}

/** The correction for a mistaken issue, or a buy-back: a negative row with its reason. */
export function cancelShares({ holderId, classId, shares, note, actor }) {
  person(actor);
  const h = holder(holderId);
  const c = shareClass(classId);
  const n = int(shares, 'shares');
  if (!String(note || '').trim()) refuse('say why the shares are cancelled — the reason is the record');
  const held = one('SELECT COALESCE(SUM(shares), 0) AS n FROM eq_ledger WHERE holder_id = ? AND class_id = ?', h.id, c.id).n;
  if (n > held) refuse(`${h.name} holds ${held} ${c.name} shares`, 409);
  return atomically(() => {
    const r = exec('INSERT INTO eq_ledger (holder_id, class_id, kind, shares, price, on_day, note, actor) VALUES (?,?,?,?,0,?,?,?)',
      h.id, c.id, 'cancel', -n, today(), String(note).trim(), actor);
    const id = Number(r.lastInsertRowid);
    audit({ actorType: 'human', actorId: actor, action: 'equity.cancelled', subjectType: 'eq_ledger', subjectId: String(id), payload: { holder: h.name, class: c.name, shares: n, why: note } });
    return one('SELECT * FROM eq_ledger WHERE id = ?', id);
  });
}

// ------------------------------------------------------------------- pool --

const meta = (k, d = null) => one('SELECT v FROM eq_meta WHERE k = ?', k)?.v ?? d;

export function setPool({ size, actor }) {
  person(actor);
  const n = Number(size);
  if (!Number.isInteger(n) || n < 0) refuse('the pool is a whole number of shares');
  const used = granted();
  if (n < used) refuse(`${used} shares of the pool are already granted`, 409);
  exec("INSERT INTO eq_meta (k, v) VALUES ('pool_size', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(n));
  audit({ actorType: 'human', actorId: actor, action: 'equity.pool', subjectType: 'eq_meta', subjectId: 'pool_size', payload: { size: n } });
  return { pool: n };
}

/** Shares the pool has given away: live grants in full, and what a cancelled grant had exercised before it ended. */
function granted() {
  return one(`SELECT COALESCE(SUM(CASE WHEN state = 'active' THEN shares ELSE exercised END), 0) AS n FROM eq_grants`).n;
}

// ---------------------------------------------------------------- options --

const monthsBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
};

/** Vested shares on a day: nothing before the cliff, then a straight line by whole months. */
export function vestedOf(g, asOf = today()) {
  if (asOf < g.granted_on) return 0;
  const m = monthsBetween(g.granted_on, asOf);
  if (m < g.cliff_months) return 0;
  if (g.vest_months <= 0) return g.shares;
  return Math.min(g.shares, Math.floor((g.shares * m) / g.vest_months));
}

export function grantOptions({ holderId, shares, strike = 0, grantedOn = null, vestMonths = 48, cliffMonths = 12, note = null, actor }) {
  person(actor);
  const h = holder(holderId);
  const n = int(shares, 'options');
  const vm = Number(vestMonths); const cm = Number(cliffMonths);
  if (!Number.isInteger(vm) || vm < 0 || vm > 120) refuse('vesting runs 0 to 120 months');
  if (!Number.isInteger(cm) || cm < 0 || cm > vm) refuse('the cliff is within the vesting period');
  const pool = Number(meta('pool_size', 0));
  const free = pool - granted();
  if (n > free) refuse(`the pool has ${free} options left — make it bigger first`, 409);
  const d = day(grantedOn);
  return atomically(() => {
    const r = exec('INSERT INTO eq_grants (holder_id, shares, strike, granted_on, vest_months, cliff_months, note, actor) VALUES (?,?,?,?,?,?,?,?)',
      h.id, n, money(strike, 'the strike'), d, vm, cm, note || null, actor);
    const id = Number(r.lastInsertRowid);
    audit({ actorType: 'human', actorId: actor, action: 'equity.granted', subjectType: 'eq_grant', subjectId: String(id), payload: { holder: h.name, shares: n, strike: Number(strike), vestMonths: vm, cliffMonths: cm, on: d } });
    return one('SELECT * FROM eq_grants WHERE id = ?', id);
  });
}

const grant = (id) => one('SELECT * FROM eq_grants WHERE id = ?', Number(id)) || refuse('no such grant', 404);

/** Vested options become common shares, at the strike. */
export function exerciseOptions({ grantId, shares, actor }) {
  person(actor);
  const g = grant(grantId);
  if (g.state !== 'active') refuse('this grant has ended', 409);
  const n = int(shares, 'options');
  const open = vestedOf(g) - g.exercised;
  if (n > open) refuse(`${open} vested options can be exercised today`, 409);
  const c = commonClass();
  return atomically(() => {
    exec('UPDATE eq_grants SET exercised = exercised + ? WHERE id = ?', n, g.id);
    const r = exec('INSERT INTO eq_ledger (holder_id, class_id, kind, shares, price, on_day, ref, actor) VALUES (?,?,?,?,?,?,?,?)',
      g.holder_id, c.id, 'exercise', n, g.strike, today(), `grant ${g.id}`, actor);
    audit({ actorType: 'human', actorId: actor, action: 'equity.exercised', subjectType: 'eq_grant', subjectId: String(g.id), payload: { shares: n, strike: g.strike, ledger: Number(r.lastInsertRowid) } });
    return grant(g.id);
  });
}

/** A grant that ends — somebody leaves. What was not exercised goes back to the pool. */
export function cancelGrant({ grantId, note, actor }) {
  person(actor);
  const g = grant(grantId);
  if (g.state !== 'active') refuse('this grant has already ended', 409);
  if (!String(note || '').trim()) refuse('say why the grant ends');
  exec("UPDATE eq_grants SET state = 'cancelled', cancelled_on = ?, note = COALESCE(note || ' · ', '') || ? WHERE id = ?", today(), String(note).trim(), g.id);
  audit({ actorType: 'human', actorId: actor, action: 'equity.grant_cancelled', subjectType: 'eq_grant', subjectId: String(g.id), payload: { returned: g.shares - g.exercised, why: note } });
  return grant(g.id);
}

// ----------------------------------------------------------- convertibles --

export function addConvertible({ holderId, kind = 'safe', principal, cap = null, discountPct = 0, interestPct = 0, issuedOn = null, note = null, actor }) {
  person(actor);
  const h = holder(holderId);
  if (!['safe', 'note'].includes(kind)) refuse('a convertible is a SAFE or a note');
  const p = money(principal, 'the amount', { allowZero: false });
  const c = cap == null || cap === '' ? null : money(cap, 'the cap', { allowZero: false });
  const d = Number(discountPct || 0);
  if (!(d >= 0 && d < 100)) refuse('the discount is 0 to 99 per cent');
  const i = kind === 'note' ? Number(interestPct || 0) : 0;
  if (!(i >= 0 && i <= 50)) refuse('interest is 0 to 50 per cent a year');
  if (c === null && d === 0) refuse('a convertible with no cap and no discount converts at the round price — give it one of them');
  const on = day(issuedOn);
  const r = exec('INSERT INTO eq_convertibles (holder_id, kind, principal, cap, discount_pct, interest_pct, issued_on, note, actor) VALUES (?,?,?,?,?,?,?,?,?)',
    h.id, kind, p, c, d, i, on, note || null, actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'equity.convertible', subjectType: 'eq_convertible', subjectId: String(id), payload: { holder: h.name, kind, principal: p, cap: c, discountPct: d, interestPct: i } });
  return one('SELECT * FROM eq_convertibles WHERE id = ?', id);
}

/** What a note has grown to: simple interest, by the day. A SAFE does not grow. */
export function accrued(c, asOf = today()) {
  if (c.kind !== 'note' || !c.interest_pct) return c.principal;
  const days = Math.max(0, (Date.parse(asOf) - Date.parse(c.issued_on)) / 86400_000);
  return r2(c.principal * (1 + (c.interest_pct / 100) * (days / 365)));
}

// ------------------------------------------------------------------ table --

/** The table on a day, rebuilt from the rows. */
export function capTable(asOf = today()) {
  const holders = q('SELECT * FROM eq_holders ORDER BY id');
  const classes = q('SELECT * FROM eq_classes ORDER BY seniority DESC, id');
  const held = q('SELECT holder_id, class_id, SUM(shares) AS shares, SUM(CASE WHEN shares > 0 THEN shares * price ELSE 0 END) AS paid FROM eq_ledger WHERE on_day <= ? GROUP BY holder_id, class_id', asOf);
  const grants = q('SELECT * FROM eq_grants ORDER BY granted_on, id');
  const pool = Number(meta('pool_size', 0));
  const poolFree = Math.max(0, pool - granted());

  const rows = holders.map((h) => {
    const mine = held.filter((x) => x.holder_id === h.id && x.shares);
    const g = grants.filter((x) => x.holder_id === h.id && x.state === 'active');
    const options = g.reduce((a, x) => a + x.shares - x.exercised, 0);
    const vested = g.reduce((a, x) => a + Math.max(0, vestedOf(x, asOf) - x.exercised), 0);
    const shares = mine.reduce((a, x) => a + x.shares, 0);
    return {
      id: h.id, name: h.name, kind: h.kind, email: h.email,
      shares, options, vested, invested: r2(mine.reduce((a, x) => a + x.paid, 0)),
      byClass: Object.fromEntries(mine.map((x) => [x.class_id, x.shares])),
    };
  });
  const issued = rows.reduce((a, r) => a + r.shares, 0);
  const optionsOut = rows.reduce((a, r) => a + r.options, 0);
  const fd = issued + optionsOut + poolFree;
  for (const r of rows) {
    r.basicPct = issued ? r4((r.shares / issued) * 100) : 0;
    r.fdPct = fd ? r4(((r.shares + r.options) / fd) * 100) : 0;
  }
  const byClass = classes.map((c) => ({ ...c, participating: Boolean(c.participating), shares: held.filter((x) => x.class_id === c.id).reduce((a, x) => a + x.shares, 0) }));
  return {
    asOf, holders: rows, classes: byClass,
    totals: { issued, options: optionsOut, poolSize: pool, poolFree, fullyDiluted: fd, poolPct: fd ? r4((poolFree / fd) * 100) : 0 },
  };
}

export function overview() {
  const t = capTable();
  const names = Object.fromEntries(q('SELECT id, name FROM eq_holders').map((h) => [h.id, h.name]));
  const grants = q('SELECT * FROM eq_grants ORDER BY state, granted_on DESC').map((g) => ({
    ...g, holder: names[g.holder_id], vested: vestedOf(g), exercisable: Math.max(0, vestedOf(g) - g.exercised),
    cliffOn: addMonths(g.granted_on, g.cliff_months), fullyOn: addMonths(g.granted_on, g.vest_months),
  }));
  const convertibles = q('SELECT * FROM eq_convertibles ORDER BY state, issued_on').map((c) => ({ ...c, holder: names[c.holder_id], value: accrued(c) }));
  return {
    ...t,
    grants,
    convertibles,
    ledger: q('SELECT l.*, h.name AS holder, c.name AS class FROM eq_ledger l JOIN eq_holders h ON h.id = l.holder_id JOIN eq_classes c ON c.id = l.class_id ORDER BY l.id DESC LIMIT 40'),
    scenarios: q('SELECT * FROM eq_scenarios ORDER BY id DESC LIMIT 30').map((s) => ({ ...s, params: JSON.parse(s.params), result: JSON.parse(s.result) })),
    kinds: HOLDER_KINDS,
    lastPrice: one("SELECT price FROM eq_ledger WHERE kind = 'issue' AND price > 0 ORDER BY on_day DESC, id DESC LIMIT 1")?.price ?? null,
  };
}

function addMonths(d, m) {
  const [y, mo, da] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + m, da));
  return x.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ round --

/**
 * A priced round, the way term sheets are usually written: the pre-money is
 * on a fully diluted basis that already includes the new pool and the
 * converting SAFEs and notes, so the new investor's percentage is exactly
 * investment ÷ post-money and the dilution falls on the people already there.
 *
 * Three things depend on each other — the price sets how many shares the
 * convertibles get, the shares set the size of the post-money, and the
 * post-money sets how big the pool top-up must be — so it is solved by
 * iteration, which settles in a handful of passes.
 */
export function modelRound({ preMoney, investment, poolPostPct = 10, convertibles = true, investor = 'New investor' } = {}, table = null) {
  const pre = money(preMoney, 'the pre-money', { allowZero: false });
  const inv = money(investment, 'the investment', { allowZero: false });
  const target = Number(poolPostPct);
  if (!(target >= 0 && target < 50)) refuse('the pool after the round is 0 to 49 per cent');
  const t = table || capTable();
  const base = t.totals.issued + t.totals.options + t.totals.poolFree;
  if (base <= 0) refuse('the table has no shares yet — issue the founders theirs first', 409);
  const notes = convertibles ? q("SELECT * FROM eq_convertibles WHERE state = 'open'") : [];

  let top = 0; let conv = 0; let price = 0; let fresh = 0;
  let conversions = [];
  for (let i = 0; i < 60; i++) {
    price = pre / (base + top + conv);
    conversions = notes.map((c) => {
      const amount = accrued(c);
      const byCap = c.cap ? c.cap / base : Infinity;
      const byDiscount = price * (1 - (c.discount_pct || 0) / 100);
      const at = Math.min(byCap, byDiscount);
      return { id: c.id, holderId: c.holder_id, kind: c.kind, amount, price: at, via: byCap < byDiscount ? 'cap' : 'discount', shares: amount / at };
    });
    const nextConv = conversions.reduce((a, c) => a + c.shares, 0);
    fresh = inv / price;
    const post = base + top + nextConv + fresh;
    const nextTop = Math.max(0, (target / 100) * post - t.totals.poolFree);
    const settled = Math.abs(nextTop - top) < 0.5 && Math.abs(nextConv - conv) < 0.5;
    top = nextTop; conv = nextConv;
    if (settled) break;
  }
  price = pre / (base + top + conv);
  fresh = Math.round(inv / price);
  top = Math.round(top);
  conversions = conversions.map((c) => ({ ...c, shares: Math.round(c.shares), price: r4(c.price) }));
  const conversionShares = conversions.reduce((a, c) => a + c.shares, 0);
  const post = base + top + conversionShares + fresh;

  const names = Object.fromEntries(t.holders.map((h) => [h.id, h.name]));
  const after = new Map(t.holders.map((h) => [h.id, { id: h.id, name: h.name, kind: h.kind, before: h.fdPct, shares: h.shares + h.options }]));
  for (const c of conversions) {
    const row = after.get(c.holderId) || { id: c.holderId, name: names[c.holderId] || `holder ${c.holderId}`, kind: 'investor', before: 0, shares: 0 };
    row.shares += c.shares;
    after.set(c.holderId, row);
  }
  const rows = [...after.values()].map((r) => ({ ...r, after: r4((r.shares / post) * 100) }));
  rows.push({ id: null, name: String(investor || 'New investor').slice(0, 80), kind: 'new', before: 0, shares: fresh, after: r4((fresh / post) * 100) });
  rows.push({ id: null, name: 'Option pool (unallocated)', kind: 'pool', before: t.totals.poolPct, shares: t.totals.poolFree + top, after: r4(((t.totals.poolFree + top) / post) * 100) });
  return {
    price: r4(price), preMoney: r2(pre), investment: r2(inv), postMoney: r2(price * post),
    shares: { before: base, poolTopUp: top, conversions: conversionShares, fresh, after: post },
    conversions: conversions.map((c) => ({ ...c, holder: names[c.holderId] || null })),
    rows: rows.sort((a, b) => b.after - a.after),
    investorPct: r4((fresh / post) * 100),
  };
}

// ------------------------------------------------------------------- exit --

/**
 * Who gets what if the company is sold for this much.
 *
 * Preferred is paid first, the most senior class first and classes of equal
 * seniority side by side. A non-participating class then chooses: keep its
 * preference, or give it up and share as common — whichever pays more, which
 * depends on what everybody else chose, so it is decided by iteration. A
 * participating class takes its preference and then shares as well.
 * Unexercised options are left out: an option is money only once exercised.
 */
export function exitWaterfall({ value } = {}, table = null) {
  const exit = money(value, 'the exit value');
  const t = table || capTable();
  const paidPer = new Map(q("SELECT class_id, SUM(shares * price) AS paid, SUM(shares) AS n FROM eq_ledger WHERE shares > 0 GROUP BY class_id").map((r) => [r.class_id, r.n ? r.paid / r.n : 0]));
  const classes = t.classes.filter((c) => c.shares > 0).map((c) => {
    const unit = c.original_price ?? paidPer.get(c.id) ?? 0;
    return { ...c, pref: c.kind === 'preferred' ? r2(c.liq_pref * unit * c.shares) : 0 };
  });
  let converted = new Set();
  let result = null;
  for (let pass = 0; pass < 12; pass++) {
    result = distribute(exit, classes, converted);
    const next = new Set(converted);
    for (const c of classes) {
      if (c.kind !== 'preferred' || c.participating) continue;
      const asCommon = result.perCommonShare * c.shares;
      if (!converted.has(c.id) && asCommon > c.pref) next.add(c.id);
      if (converted.has(c.id) && asCommon < c.pref) next.delete(c.id);
    }
    if ([...next].every((x) => converted.has(x)) && next.size === converted.size) break;
    converted = next;
  }
  const byHolder = t.holders.filter((h) => h.shares > 0).map((h) => {
    let payout = 0;
    for (const [cid, n] of Object.entries(h.byClass)) {
      const c = result.classes.find((x) => x.id === Number(cid));
      if (c && c.shares) payout += (c.payout * n) / c.shares;
    }
    return { id: h.id, name: h.name, kind: h.kind, shares: h.shares, invested: h.invested, payout: r2(payout), multiple: h.invested ? r2(payout / h.invested) : null, pct: exit ? r4((payout / exit) * 100) : 0 };
  }).sort((a, b) => b.payout - a.payout);
  return { value: r2(exit), classes: result.classes, holders: byHolder, perCommonShare: r4(result.perCommonShare) };
}

function distribute(exit, classes, converted) {
  let left = exit;
  const out = new Map(classes.map((c) => [c.id, { id: c.id, name: c.name, kind: c.kind, shares: c.shares, pref: c.pref, prefPaid: 0, share: 0, converted: converted.has(c.id), participating: Boolean(c.participating) }]));
  const prefClasses = classes.filter((c) => c.kind === 'preferred' && !converted.has(c.id));
  for (const level of [...new Set(prefClasses.map((c) => c.seniority))].sort((a, b) => b - a)) {
    const tier = prefClasses.filter((c) => c.seniority === level);
    const owed = tier.reduce((a, c) => a + c.pref, 0);
    const pay = Math.min(left, owed);
    for (const c of tier) out.get(c.id).prefPaid = owed ? (pay * c.pref) / owed : 0;
    left -= pay;
  }
  // Common, converted preferred, and participating preferred share what is left.
  const sharing = classes.filter((c) => c.kind === 'common' || converted.has(c.id) || c.participating);
  const units = sharing.reduce((a, c) => a + c.shares, 0);
  const per = units ? Math.max(0, left) / units : 0;
  for (const c of sharing) out.get(c.id).share = per * c.shares;
  const list = [...out.values()].map((c) => ({ ...c, prefPaid: r2(c.prefPaid), share: r2(c.share), payout: r2(c.prefPaid + c.share) }));
  return { classes: list, perCommonShare: per };
}

// -------------------------------------------------------------- scenarios --

export function saveScenario({ name, params = {}, actor }) {
  if (!isHuman(actor)) refuse('a person keeps a scenario', 403);
  const n = String(name || '').trim();
  if (!n || n.length > 120) refuse('name the scenario');
  const kind = params.kind === 'exit' ? 'exit' : 'round';
  const result = kind === 'exit' ? exitWaterfall(params) : modelRound(params);
  const summary = kind === 'exit'
    ? { value: result.value, perCommonShare: result.perCommonShare, top: result.holders.slice(0, 3).map((h) => ({ name: h.name, payout: h.payout })) }
    : { price: result.price, postMoney: result.postMoney, investorPct: result.investorPct, poolTopUp: result.shares.poolTopUp };
  const r = exec('INSERT INTO eq_scenarios (name, kind, params, result, created_by) VALUES (?,?,?,?,?)', n, kind, JSON.stringify({ ...params, kind }), JSON.stringify(summary), actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'equity.scenario', subjectType: 'eq_scenario', subjectId: String(id), payload: { name: n, kind } });
  return { id, name: n, kind, result: summary };
}

export function removeScenario({ id, actor }) {
  if (!isHuman(actor)) refuse('a person removes a scenario', 403);
  const s = one('SELECT * FROM eq_scenarios WHERE id = ?', Number(id)) || refuse('no such scenario', 404);
  exec('DELETE FROM eq_scenarios WHERE id = ?', s.id);
  audit({ actorType: 'human', actorId: actor, action: 'equity.scenario_removed', subjectType: 'eq_scenario', subjectId: String(s.id), payload: { name: s.name } });
  return { removed: s.id };
}
