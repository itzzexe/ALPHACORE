// Standing orders — الأوامر الدائمة.
//
// Everything this company does is either something a person just asked for, or
// something hardcoded into an interval in server.js. There is no way to say
// *"from now on, every Monday, do this"* — which is most of what running a
// company actually consists of. Chase the unpaid invoices. Close the books.
// Check whether the competitor changed their pricing. Nobody wants to be asked
// each time, and nobody should have to remember.
//
// So: a goal in words, a schedule, an owner, and a record of every firing. It
// targets the capabilities that already exist rather than inventing a new kind
// of work — a hunt, a browser session, the request desk, the bookkeeper.
//
// The dangerous part of any recurring job is not the schedule. It is that it
// keeps running long after the person who wrote it stopped watching:
//
//   - **an order that keeps failing turns itself off.** Three consecutive
//     failures and it is paused with the reason on it. A job that fails silently
//     every hour for a month is worse than no job, because the dashboard is
//     green and the work is not happening.
//   - **it cannot outlive its own budget.** Each order carries a per-firing cap
//     and a lifetime cap.
//   - **it inherits every gate.** A browsing order still stops at the click that
//     commits. A bookkeeping order still drafts rather than posts above the
//     limit. A standing order is a *schedule*, not an authority.
//   - **it has an owner, a reason and an expiry.** Orders with nobody's name on
//     them accumulate until nobody dares delete any of them.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/**
 * What an order may target. Deliberately a closed list of things that already
 * exist and already have their own gates — a standing order is a schedule, not
 * a new capability, and an open list would quietly make it one.
 */
export const KINDS = {
  hunt: {
    label: 'find something out',
    describe: (o) => `hunt: ${o.goal}`,
    run: async (o) => {
      const { hunt } = await import('./hunt.js');
      const r = await hunt({ question: o.goal, actor: `system:standing:${o.id}`, maxUsd: o.max_usd_per_run || 1 });
      return { ok: true, costUsd: r.costUsd, note: r.say, found: r.found };
    },
  },
  browse: {
    label: 'do something on the web',
    describe: (o) => `browser: ${o.goal}`,
    run: async (o) => {
      const { drive } = await import('./browser.js');
      const r = await drive({
        goal: o.goal, actor: `system:standing:${o.id}`, startUrl: o.target || null,
        maxUsd: o.max_usd_per_run || 1,
      });
      // "Waiting for a person" is a successful firing, not a failure: the order
      // did its job and stopped exactly where it was supposed to.
      return { ok: true, costUsd: r.costUsd || 0, note: r.say, waiting: r.state === 'waiting' };
    },
  },
  bookkeep: {
    label: 'keep the books up to date',
    describe: () => 'sweep everything that has happened into journal entries',
    run: async () => {
      const { bookkeep, reconcile } = await import('./bookkeeper.js');
      const b = bookkeep({ actor: 'agent:AGT-FIN-001' });
      const rc = reconcile({});
      return {
        ok: b.problems.length === 0,
        costUsd: 0,
        note: `${b.made.length} entr(ies) written, ${rc.findings.length} thing(s) to look at`,
      };
    },
  },
  request: {
    label: 'ask the company for something',
    describe: (o) => `request desk: ${o.goal}`,
    run: async (o) => {
      const { createRequest } = await import('./requests.js');
      // It goes through the desk like anything else, which means it goes through
      // the desk's own refusal — a standing order cannot ask for work the desk
      // would turn down from a person.
      const r = createRequest({ title: o.goal.slice(0, 120), body: o.reason || o.goal, actor: `system:standing:${o.id}` });
      return { ok: true, costUsd: 0, note: `request ${r.id || ''} opened at the desk`.trim() };
    },
  },
};

/** When is it next due? Plain schedules, because cron is a language nobody reads. */
export const SCHEDULES = {
  hourly: { label: 'every hour', ms: 3600e3 },
  daily: { label: 'every day', ms: 24 * 3600e3 },
  weekly: { label: 'every week', ms: 7 * 24 * 3600e3 },
  monthly: { label: 'every month', ms: 30 * 24 * 3600e3 },
};

/**
 * SQLite's own datetime shape, not ISO 8601.
 *
 * This matters more than it looks. Every due check is a string comparison
 * against `datetime('now')`, which SQLite writes as "2026-08-10 20:15:00" — with
 * a space. An ISO string has a "T" there, and "T" sorts after " ", so an ISO
 * timestamp is *always* greater than the SQLite one for the same instant. Stored
 * as ISO, `next_due <= datetime('now')` is never true and no order ever fires,
 * silently, forever. The tests caught it only because they wrote their own dates
 * in SQLite's format.
 */
const sqlTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const nextDue = (schedule, from = Date.now()) => sqlTime(from + SCHEDULES[schedule].ms);

// ------------------------------------------------------------------ writes --

export function createOrder({
  goal, kind, schedule, actor, reason = null, target = null,
  maxUsdPerRun = 1, lifetimeUsd = 25, expiresAt = null,
}) {
  if (!actor) refuse('a standing order has to be signed — it will act without anyone watching');
  if (!goal || !String(goal).trim()) refuse('a standing order needs a goal in words');
  if (!KINDS[kind]) refuse(`an order is one of: ${Object.keys(KINDS).join(', ')}`);
  if (!SCHEDULES[schedule]) refuse(`a schedule is one of: ${Object.keys(SCHEDULES).join(', ')}`);
  // Not paperwork: an order nobody can explain in six months is an order nobody
  // will dare to turn off.
  if (!reason || !String(reason).trim()) refuse('say why this should keep happening — an order nobody can explain never gets deleted');

  const id = Number(exec(
    `INSERT INTO standing_orders (goal, kind, schedule, target, reason, owner, state,
                                  max_usd_per_run, lifetime_usd, next_due, expires_at)
     VALUES (?,?,?,?,?,?, 'active', ?,?,?,?)`,
    goal, kind, schedule, target, reason, actor, maxUsdPerRun, lifetimeUsd, nextDue(schedule),
    expiresAt ? sqlTime(Date.parse(expiresAt)) : null,
  ).lastInsertRowid);

  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'standing.created',
    subjectType: 'standing', subjectId: String(id),
    payload: { goal: goal.slice(0, 200), kind, schedule, reason: String(reason).slice(0, 200), lifetimeUsd },
  });
  return { ok: true, id, nextDue: nextDue(schedule) };
}

export function pauseOrder({ id, actor, why = '' }) {
  if (!actor) refuse('pausing an order has to be signed');
  exec("UPDATE standing_orders SET state = 'paused', paused_reason = ? WHERE id = ?", why || 'paused by hand', id);
  audit({ actorType: 'human', actorId: actor, action: 'standing.paused', subjectType: 'standing', subjectId: String(id), payload: { why } });
  return { ok: true };
}

export function resumeOrder({ id, actor }) {
  if (!actor) refuse('resuming an order has to be signed');
  const o = one('SELECT * FROM standing_orders WHERE id = ?', id);
  if (!o) refuse('no such order');
  // Resuming clears the failure count. Otherwise an order that was paused for
  // failing turns itself off again on its very next firing.
  exec("UPDATE standing_orders SET state = 'active', paused_reason = NULL, consecutive_failures = 0, next_due = ? WHERE id = ?",
    nextDue(o.schedule), id);
  audit({ actorType: 'human', actorId: actor, action: 'standing.resumed', subjectType: 'standing', subjectId: String(id), payload: {} });
  return { ok: true };
}

export function deleteOrder({ id, actor }) {
  if (!actor) refuse('deleting an order has to be signed');
  const o = one('SELECT * FROM standing_orders WHERE id = ?', id);
  if (!o) refuse('no such order');
  exec("UPDATE standing_orders SET state = 'deleted' WHERE id = ?", id);
  audit({
    actorType: 'human', actorId: actor, action: 'standing.deleted', subjectType: 'standing', subjectId: String(id),
    payload: { goal: o.goal.slice(0, 200), spentUsd: o.spent_usd },
  });
  return { ok: true };
}

// ------------------------------------------------------------------- firing --

/** Fire one order now, whatever the clock says. */
export async function fireOrder(id, { manual = false, actor = null } = {}) {
  const o = one('SELECT * FROM standing_orders WHERE id = ?', id);
  if (!o) refuse('no such order');
  if (o.state !== 'active' && !manual) return { skipped: o.state };

  if (Number(o.spent_usd || 0) >= Number(o.lifetime_usd || 0)) {
    exec("UPDATE standing_orders SET state = 'paused', paused_reason = ? WHERE id = ?",
      `it has spent its whole allowance of ${o.lifetime_usd}`, id);
    notify({
      level: 'warn', source: 'standing', subjectType: 'standing', subjectId: String(id),
      message: `"${o.goal.slice(0, 60)}" has spent its allowance and stopped`,
    });
    return { skipped: 'out of money' };
  }

  const started = Date.now();
  let result;
  try {
    result = await KINDS[o.kind].run(o);
  } catch (e) {
    result = { ok: false, costUsd: 0, note: String(e.message).slice(0, 300) };
  }

  const cost = Number(result.costUsd || 0);
  exec(
    `INSERT INTO standing_firings (order_id, ok, note, cost_usd, ms, fired_by)
     VALUES (?,?,?,?,?,?)`,
    id, result.ok ? 1 : 0, String(result.note || '').slice(0, 500), cost, Date.now() - started,
    manual ? (actor || 'human:console') : 'system:standing',
  );

  const failures = result.ok ? 0 : Number(o.consecutive_failures || 0) + 1;
  exec(
    `UPDATE standing_orders SET last_fired = datetime('now'), next_due = ?, firings = firings + 1,
            spent_usd = spent_usd + ?, consecutive_failures = ?, last_note = ? WHERE id = ?`,
    nextDue(o.schedule), cost, failures, String(result.note || '').slice(0, 300), id,
  );

  // Three strikes. A job that fails silently every hour for a month is worse
  // than no job: the dashboard stays green while the work does not happen.
  if (failures >= 3) {
    exec("UPDATE standing_orders SET state = 'paused', paused_reason = ? WHERE id = ?",
      `it failed three times in a row — the last one said: ${String(result.note || '').slice(0, 140)}`, id);
    notify({
      level: 'warn', source: 'standing', subjectType: 'standing', subjectId: String(id),
      message: `"${o.goal.slice(0, 60)}" has been turned off after failing three times`,
    });
    audit({
      actorType: 'system', actorId: 'system:standing', action: 'standing.gave_up',
      subjectType: 'standing', subjectId: String(id), payload: { failures, note: String(result.note || '').slice(0, 200) },
    });
  }

  return { ok: result.ok, note: result.note, costUsd: cost, failures };
}

/**
 * Everything due, fired. Called on a timer by the server.
 *
 * One at a time on purpose. Ten orders firing together, each able to start a
 * browser session and a model chain, is a way to spend a month's budget in a
 * minute and to have ten agents fighting over one browser tab.
 */
export async function tick({ limit = 3 } = {}) {
  const due = q(
    `SELECT id FROM standing_orders
      WHERE state = 'active' AND next_due <= datetime('now')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY next_due LIMIT ?`, limit,
  );
  const fired = [];
  for (const d of due) {
    try { fired.push({ id: d.id, ...(await fireOrder(d.id)) }); }
    catch (e) { fired.push({ id: d.id, ok: false, note: String(e.message).slice(0, 140) }); }
  }
  // An order past its expiry retires itself rather than being quietly skipped
  // forever, so the list stays a list of things that are actually happening.
  const expired = exec(
    "UPDATE standing_orders SET state = 'expired' WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= datetime('now')",
  ).changes;
  return { fired, expired };
}

// ---------------------------------------------------------------- read-side --

export function ordersList({ includeDeleted = false } = {}) {
  return q(
    `SELECT * FROM standing_orders ${includeDeleted ? '' : "WHERE state != 'deleted'"} ORDER BY
       CASE state WHEN 'paused' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, next_due`,
  ).map((o) => ({
    ...o,
    kindLabel: KINDS[o.kind]?.label || o.kind,
    scheduleLabel: SCHEDULES[o.schedule]?.label || o.schedule,
    remainingUsd: Number((Number(o.lifetime_usd || 0) - Number(o.spent_usd || 0)).toFixed(4)),
  }));
}

export function orderDetail(id) {
  const o = one('SELECT * FROM standing_orders WHERE id = ?', id);
  if (!o) { const e = new Error('no such order'); e.status = 404; throw e; }
  return {
    ...o,
    kindLabel: KINDS[o.kind]?.label || o.kind,
    scheduleLabel: SCHEDULES[o.schedule]?.label || o.schedule,
    firings: q('SELECT * FROM standing_firings WHERE order_id = ? ORDER BY id DESC LIMIT 40', id),
  };
}

export function standingOverview() {
  const orders = ordersList({});
  return {
    kinds: Object.entries(KINDS).map(([k, v]) => ({ key: k, label: v.label })),
    schedules: Object.entries(SCHEDULES).map(([k, v]) => ({ key: k, label: v.label })),
    orders,
    active: orders.filter((o) => o.state === 'active').length,
    paused: orders.filter((o) => o.state === 'paused').length,
    spentUsd: Number(orders.reduce((n, o) => n + Number(o.spent_usd || 0), 0).toFixed(2)),
    firings: one('SELECT COUNT(*) AS n FROM standing_firings').n,
    failures: one('SELECT COUNT(*) AS n FROM standing_firings WHERE ok = 0').n,
    recent: q(`SELECT f.*, o.goal FROM standing_firings f JOIN standing_orders o ON o.id = f.order_id
               ORDER BY f.id DESC LIMIT 15`),
    // Said where somebody deciding whether to trust this can read it.
    inherits: 'A standing order is a schedule, not an authority. A browsing order still stops at the click that '
      + 'commits; a bookkeeping order still drafts rather than posts above the limit. Nothing here can do something '
      + 'its owner could not do by hand.',
  };
}
