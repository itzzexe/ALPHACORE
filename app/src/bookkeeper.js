// The employees who keep the books — المحاسبة الآلية.
//
// A ledger nobody writes to is a schema. What makes this a company's accounting
// rather than a diagram is that the events already happening — an invoice going
// out, money arriving, a model being called, a contractor being paid — become
// entries without anybody typing them.
//
// Three jobs, deliberately separated, because separating them is the oldest
// control in accounting and it is separated here for the same reason:
//
//   the bookkeeper   turns events into entries. Mechanical, high volume, and
//                    posts within its own limit.
//   the controller   reviews what the bookkeeper could not post, reconciles
//                    the ledger against the operational tables, and finds the
//                    entries that should exist and do not.
//   the closer       runs the period end: accruals, the trial balance, and a
//                    close that refuses to happen over a difference.
//
// Nobody, including a person, can post an entry that does not balance. Above a
// threshold an agent may only draft, because a signature nobody read is worth
// less than no signature — and an AI employee posting a fifty-thousand-dollar
// entry unattended is exactly the thing this company's design exists to prevent.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { journalEntry, periodOf, trialBalance, ensurePeriod, closePeriod } from './ledger.js';
import { notify } from './notify.js';

/** What an AI employee may post without a person looking at it. */
const agentLimit = () => Number(getSetting('BOOKKEEPER_LIMIT_USD') || 500);

/** Already turned into an entry? Restarting must not post everything twice. */
const seen = (source, id) => Boolean(one('SELECT source FROM ledger_marks WHERE source = ? AND source_id = ?', source, String(id)));
const mark = (source, id, journalId) => exec(
  'INSERT OR REPLACE INTO ledger_marks (source, source_id, journal_id) VALUES (?,?,?)', source, String(id), journalId || null,
);

/**
 * Write one entry for one event, or say why it could not.
 *
 * Returns rather than throws: a bookkeeping sweep that dies on the first
 * awkward row leaves the rest of the month unrecorded, and the awkward row is
 * usually the one worth a person's attention rather than a crash.
 */
function record({ source, sourceId, date, memo, lines, actor, valueUsd }) {
  if (seen(source, sourceId)) return { skipped: 'already recorded' };
  const overLimit = Number(valueUsd || 0) > agentLimit();
  try {
    const r = journalEntry({
      date, memo, lines, source, sourceId, actor,
      // The threshold is the whole control: above it an agent proposes and a
      // person posts.
      post: !overLimit,
    });
    mark(source, sourceId, r.id);
    if (overLimit) {
      notify({
        level: 'warn', source: 'finance',
        message: `${memo} — ${valueUsd} is above the bookkeeping limit, so it is drafted and waiting`,
        subjectType: 'journal', subjectId: r.ref,
      });
    }
    return { ...r, waitingForAPerson: overLimit };
  } catch (e) {
    // An event that cannot be turned into a balanced entry is a fact about the
    // event, not a reason to stop. It goes on the record and a person is told.
    audit({
      actorType: 'agent', actorId: actor, action: 'bookkeeping.refused',
      subjectType: source, subjectId: String(sourceId),
      payload: { memo, error: String(e.message).slice(0, 200) },
    });
    return { error: e.message };
  }
}

// ------------------------------------------------------------ the bookkeeper --

/**
 * Turn everything that has happened into entries.
 *
 * Each source is its own small function so the accounting treatment is written
 * once, in words, where somebody can disagree with it — rather than buried in a
 * loop that nobody reads.
 */
export function bookkeep({ actor = 'agent:AGT-FIN-001', limit = 200 } = {}) {
  const made = [];
  const problems = [];
  const push = (r, what) => {
    if (r?.error) problems.push({ what, error: r.error });
    else if (r?.ref) made.push({ what, ref: r.ref, waiting: r.waitingForAPerson });
  };

  // 1. An invoice raised is revenue earned and money owed to us. Recognised
  //    when it is issued, not when it is paid — that is the whole point of
  //    accounts receivable, and cash accounting cannot tell you what you are
  //    owed.
  for (const inv of q(`SELECT * FROM invoices WHERE state != 'draft' ORDER BY id LIMIT ?`, limit)) {
    const usd = Number(inv.amount || 0);
    if (!usd) continue;
    push(record({
      source: 'invoice.issued', sourceId: inv.id, date: String(inv.created_at || '').slice(0, 10),
      memo: `Invoice ${inv.ref || inv.id}${inv.description ? ` — ${inv.description}` : ''}`,
      valueUsd: usd, actor,
      lines: [{ account: '1100', debit: usd }, { account: '4000', credit: usd }],
    }), `invoice ${inv.ref || inv.id}`);

    // 2. …and when it is paid, the debt becomes cash. Two entries, not one:
    //    collapsing them loses the fact that we were owed money in between.
    if (inv.state === 'paid' && Number(inv.paid_amount || 0) > 0) {
      const paid = Number(inv.paid_amount);
      const cash = inv.chain ? '1010' : '1000';
      push(record({
        source: 'invoice.paid', sourceId: inv.id, date: String(inv.paid_at || inv.created_at || '').slice(0, 10),
        memo: `Payment received for ${inv.ref || inv.id}`,
        valueUsd: paid, actor,
        lines: [{ account: cash, debit: paid }, { account: '1100', credit: paid }],
      }), `payment ${inv.ref || inv.id}`);
    }
  }

  // 3. Model spend is a real cost and it was invisible in the books. Accrued
  //    monthly rather than per call: forty thousand journal entries a month
  //    would be technically correct and useless to read.
  const period = periodOf();
  const spend = one(
    `SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS calls
       FROM model_calls WHERE strftime('%Y-%m', created_at) = ?`, period,
  );
  if (spend.usd > 0.005 && !seen('model-spend', period)) {
    push(record({
      source: 'model-spend', sourceId: period,
      memo: `Model spend for ${period} — ${spend.calls} calls`,
      valueUsd: spend.usd, actor,
      lines: [{ account: '5000', debit: spend.usd }, { account: '2100', credit: spend.usd }],
    }), `model spend ${period}`);
  }

  // 4. A payout that settled is money gone. Only settled ones: a prepared
  //    payout is a plan, and booking plans as expenses is how a company
  //    convinces itself it is poorer than it is.
  for (const p of q("SELECT * FROM payouts WHERE state IN ('sent','settled','paid') ORDER BY id LIMIT ?", limit)) {
    const usd = Number(p.amount || 0);
    if (!usd) continue;
    push(record({
      source: 'payout', sourceId: p.id, date: String(p.created_at || '').slice(0, 10),
      memo: `Payout — ${p.reason || p.to_address}`,
      valueUsd: usd, actor,
      lines: [{ account: '5200', debit: usd }, { account: p.chain ? '1010' : '1000', credit: usd }],
    }), `payout ${p.id}`);
  }

  if (made.length || problems.length) {
    audit({
      actorType: 'agent', actorId: actor, action: 'bookkeeping.swept',
      subjectType: 'ledger', subjectId: period,
      payload: { entries: made.length, waiting: made.filter((m) => m.waiting).length, problems: problems.length },
    });
  }
  return { made, problems, limitUsd: agentLimit() };
}

// ------------------------------------------------------------- the controller --

/**
 * What the books say against what actually happened.
 *
 * The bookkeeper writes entries; this asks whether they are all there. A ledger
 * is only worth its reconciliation — anybody can produce a set of books that
 * balances internally and describes a different company.
 */
export function reconcile({ period = null } = {}) {
  const p = period || periodOf();
  const findings = [];

  const invoiced = one(
    "SELECT COALESCE(SUM(amount), 0) AS usd FROM invoices WHERE state != 'draft' AND strftime('%Y-%m', created_at) = ?", p,
  ).usd;
  const booked = one(
    `SELECT COALESCE(SUM(l.amount), 0) AS usd FROM journal_lines l JOIN journal j ON j.id = l.journal_id
      WHERE j.state = 'posted' AND j.source = 'invoice.issued' AND j.period = ? AND l.side = 'credit'`, p,
  ).usd;
  if (Math.abs(invoiced - booked) > 0.02) {
    findings.push({
      what: 'invoiced revenue does not match what is in the ledger',
      operational: Number(invoiced.toFixed(2)), ledger: Number(booked.toFixed(2)),
      why: 'either an invoice was never booked, or an entry exists for an invoice that does not',
    });
  }

  const spent = one(
    "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM model_calls WHERE strftime('%Y-%m', created_at) = ?", p,
  ).usd;
  const spendBooked = one(
    `SELECT COALESCE(SUM(l.amount), 0) AS usd FROM journal_lines l JOIN journal j ON j.id = l.journal_id
      WHERE j.state = 'posted' AND j.source = 'model-spend' AND j.period = ? AND l.side = 'debit'`, p,
  ).usd;
  if (Math.abs(spent - spendBooked) > 0.02) {
    findings.push({
      what: 'model spend has moved since it was accrued',
      operational: Number(spent.toFixed(4)), ledger: Number(spendBooked.toFixed(4)),
      why: 'the month is still running — the accrual is trued up at close',
    });
  }

  const tb = trialBalance({ period: p });
  if (!tb.balances) {
    findings.push({ what: 'the trial balance is out', difference: tb.difference, why: 'find the entry before anything else' });
  }

  const drafts = q("SELECT ref, memo, total, created_by FROM journal WHERE state = 'draft' AND period = ?", p);
  if (drafts.length) {
    findings.push({
      what: `${drafts.length} entr(y/ies) are drafted and not posted`,
      entries: drafts.map((d) => `${d.ref} ${d.memo} (${d.total})`),
      why: 'above the bookkeeping limit, so they are waiting for a person',
    });
  }

  return { period: p, ok: findings.length === 0, findings, trialBalance: tb };
}

// ---------------------------------------------------------------- the closer --

/**
 * Period end.
 *
 * True up the accrual to what was actually spent, check the books, and close.
 * It refuses to close over a difference — a period that closes out of balance
 * produces a balance sheet that does not balance, and somebody finds out a year
 * later when it is expensive.
 */
export function closeMonth({ period = null, actor, force = false }) {
  if (!actor) throw new Error('closing the books has to be signed');
  const p = period || periodOf();
  ensurePeriod(p);

  const steps = [];

  // Accrue the difference between what was booked and what was actually spent.
  const spent = one("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM model_calls WHERE strftime('%Y-%m', created_at) = ?", p).usd;
  const booked = one(
    `SELECT COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END), 0) AS usd
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id
      WHERE j.state = 'posted' AND j.period = ? AND l.account_code = '5000'`, p,
  ).usd;
  const gap = Math.round((spent - booked) * 100) / 100;
  if (Math.abs(gap) > 0.005) {
    const r = journalEntry({
      date: `${p}-28`, memo: `Model spend accrual trued up for ${p}`,
      source: 'close', sourceId: `${p}:accrual`, actor, post: true,
      lines: gap > 0
        ? [{ account: '5000', debit: gap }, { account: '2100', credit: gap }]
        : [{ account: '2100', debit: -gap }, { account: '5000', credit: -gap }],
    });
    steps.push({ step: 'accrual trued up', by: gap, ref: r.ref });
  }

  const check = reconcile({ period: p });
  const blocking = check.findings.filter((f) => /trial balance is out|drafted and not posted/.test(f.what));
  if (blocking.length && !force) {
    return {
      ok: false, period: p, steps, blocking,
      say: 'a period that closes out of balance produces a balance sheet that does not, and somebody finds out a year later',
    };
  }

  const closed = closePeriod({ period: p, actor });
  audit({
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'ledger.month_closed',
    subjectType: 'period', subjectId: p,
    payload: { steps: steps.length, forced: force && blocking.length > 0 },
  });
  return { ok: true, period: p, steps, reconciliation: check, closed };
}

export function bookkeeperOverview() {
  const p = periodOf();
  return {
    period: p,
    limitUsd: agentLimit(),
    // Said in the open: this is the number that decides what an AI employee may
    // do to the books without anybody looking.
    limitMeans: `an AI employee posts entries up to ${agentLimit()} on its own; above that it drafts and a person posts`,
    recorded: one('SELECT COUNT(*) AS n FROM ledger_marks').n,
    waiting: q("SELECT ref, memo, total, created_by, created_at FROM journal WHERE state = 'draft' ORDER BY id DESC LIMIT 20"),
    refused: q("SELECT subject_id, payload, occurred_at FROM audit_log WHERE action = 'bookkeeping.refused' ORDER BY seq DESC LIMIT 10"),
    reconciliation: reconcile({ period: p }),
  };
}
