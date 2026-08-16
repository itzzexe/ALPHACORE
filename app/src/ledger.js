// Double-entry bookkeeping — القيود المزدوجة.
//
// The finance pages until now computed summaries from operational tables:
// invoices, payouts, model spend. That answers "roughly how are we doing" and
// cannot answer "what do we owe", "what are we owed", "does this balance", or
// "show me the entry that produced this number" — and those are the questions
// an accountant, a bank and a tax authority all ask first.
//
// So: a real ledger. The rules are five hundred years old and none of them are
// negotiable, which is exactly why they are worth implementing properly rather
// than approximating:
//
//   every entry balances     debits equal credits, or it is not an entry.
//                            Refused, never warned about — an unbalanced
//                            journal is not a journal with a problem, it is
//                            not a journal.
//
//   posted is immutable      a mistake is corrected by a reversing entry that
//                            says what it reverses and why. Editing history is
//                            how books stop being evidence — the same argument
//                            the audit chain makes, for the same reason.
//
//   every entry has a source what caused it: an invoice, a payout, a model
//                            call, a person. A number nobody can trace to an
//                            event is a number nobody can defend.
//
//   the period closes        and once closed, nothing may be posted into it.
//
// AI employees keep these books. They propose; the rules refuse what does not
// balance; and anything above a threshold waits for a person — because a
// signature that nobody read is worth less than no signature at all.
import { q, one, exec, db, atomically } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';

/**
 * A refusal is not a failure.
 *
 * Everything below that throws does so on purpose: the entry did not balance,
 * the period is closed, the reason was missing. Those are answers, and they
 * carry 400 so that monitoring does not page somebody at three in the morning
 * because an accountant mistyped an amount. A 500 from this module means the
 * ledger itself is broken, which is worth waking up for.
 */
const refuse = (message) => { const e = new Error(message); e.status = 400; throw e; };

// ------------------------------------------------------- chart of accounts --

/**
 * The starting chart. Deliberately small: a company that needs more adds them,
 * and a chart with four hundred accounts nobody uses is how bookkeeping becomes
 * something only one person understands.
 *
 * Numbering follows the convention every accountant already knows — 1 assets,
 * 2 liabilities, 3 equity, 4 revenue, 5 expenses — so nobody has to learn ours.
 */
export const STANDARD_CHART = [
  // Assets — what the company has. Debit increases.
  ['1000', 'Cash and bank', 'asset', null, 'Money that can be spent today'],
  ['1010', 'Crypto held', 'asset', '1000', 'Treasury balances, watch-only'],
  ['1100', 'Accounts receivable', 'asset', null, 'Invoiced and not yet paid — what we are owed'],
  ['1200', 'Prepaid expenses', 'asset', null, 'Paid in advance, not yet consumed'],
  ['1500', 'Equipment', 'asset', null, 'Assets held beyond a year'],

  // Liabilities — what the company owes. Credit increases.
  ['2000', 'Accounts payable', 'liability', null, 'Received and not yet paid — what we owe'],
  ['2100', 'Accrued expenses', 'liability', null, 'Incurred and not yet invoiced to us'],
  ['2200', 'Tax payable', 'liability', null, 'Collected or owed, not yet remitted'],
  ['2300', 'Deferred revenue', 'liability', null, 'Paid for and not yet delivered — not revenue yet'],

  // Equity.
  ['3000', 'Owner capital', 'equity', null, 'What the owners put in'],
  ['3100', 'Retained earnings', 'equity', null, 'Every prior period, accumulated'],

  // Revenue — credit increases.
  ['4000', 'Services revenue', 'revenue', null, 'Work delivered'],
  ['4100', 'Subscription revenue', 'revenue', null, 'Recurring'],
  ['4900', 'Other income', 'revenue', null, null],

  // Expenses — debit increases.
  ['5000', 'Model spend', 'expense', null, 'What the AI workforce costs to run'],
  ['5010', 'Infrastructure', 'expense', null, 'Servers, storage, bandwidth'],
  ['5100', 'Software and services', 'expense', null, 'Everything the company subscribes to'],
  ['5200', 'Contractors', 'expense', null, 'People paid to do work'],
  ['5300', 'Marketing', 'expense', null, null],
  ['5400', 'Professional fees', 'expense', null, 'Legal, accounting, audit'],
  ['5500', 'Fees and charges', 'expense', null, 'Payment processing, banking, network fees'],
  ['5900', 'Other expenses', 'expense', null, null],
];

/** Which side increases an account. The whole of double entry rests on this. */
const NORMAL = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' };

export function seedChart() {
  if (one('SELECT code FROM accounts LIMIT 1')) return 0;
  let n = 0;
  for (const [code, name, type, parent, note] of STANDARD_CHART) {
    exec(
      'INSERT INTO accounts (code, name, type, parent_code, normal_side, note) VALUES (?,?,?,?,?,?)',
      code, name, type, parent, NORMAL[type], note,
    );
    n++;
  }
  audit({
    actorType: 'system', actorId: 'system:ledger', action: 'chart.seeded',
    subjectType: 'ledger', subjectId: 'chart', payload: { accounts: n },
  });
  return n;
}

export function chart() {
  return q(`SELECT a.*,
    (SELECT COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END), 0)
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id
      WHERE l.account_code = a.code AND j.state = 'posted') AS raw_balance
    FROM accounts a WHERE a.retired_at IS NULL ORDER BY a.code`)
    .map((a) => ({
      ...a,
      // Presented the way an accountant expects to see it: a liability with a
      // credit balance is positive, not negative. Storing signed debits and
      // flipping here keeps the arithmetic in one place.
      balance: Number(((a.normal_side === 'debit' ? a.raw_balance : -a.raw_balance) || 0).toFixed(2)),
    }));
}

export function addAccount({ code, name, type, parentCode = null, note = null, actor }) {
  if (!actor) refuse('adding an account has to be signed');
  if (!NORMAL[type]) refuse(`an account is one of: ${Object.keys(NORMAL).join(', ')}`);
  if (!/^\d{4}$/.test(String(code))) refuse('an account code is four digits');
  if (one('SELECT code FROM accounts WHERE code = ?', code)) refuse(`${code} already exists`);
  exec('INSERT INTO accounts (code, name, type, parent_code, normal_side, note) VALUES (?,?,?,?,?,?)',
    code, name, type, parentCode, NORMAL[type], note);
  audit({ actorType: 'human', actorId: actor, action: 'account.added', subjectType: 'account', subjectId: code, payload: { name, type } });
  return { ok: true, code, normalSide: NORMAL[type] };
}

// ---------------------------------------------------------------- periods --

export const periodOf = (date) => String(date || new Date().toISOString()).slice(0, 7);

export function ensurePeriod(period) {
  if (!one('SELECT period FROM fiscal_periods WHERE period = ?', period)) {
    exec("INSERT INTO fiscal_periods (period, state) VALUES (?, 'open')", period);
  }
  return one('SELECT * FROM fiscal_periods WHERE period = ?', period);
}

/**
 * Close a period. Nothing may be posted into it afterwards.
 *
 * This is what makes a set of books answerable: without it, last quarter's
 * numbers change quietly whenever somebody backdates an entry, and every report
 * built on them becomes a snapshot of a moving target.
 */
export function closePeriod({ period, actor }) {
  if (!actor) refuse('closing a period has to be signed');
  const p = ensurePeriod(period);
  if (p.state === 'closed') return { alreadyClosed: true, period };

  const unbalanced = q("SELECT id FROM journal WHERE period = ? AND state = 'draft'", period);
  if (unbalanced.length) {
    return {
      ok: false,
      reason: `${unbalanced.length} entr(y/ies) in ${period} are still drafts`,
      say: 'post or delete them — closing over a draft loses it silently',
    };
  }

  const tb = trialBalance({ period });
  if (Math.abs(tb.difference) > 0.005) {
    // Refusing here is the point. A period that closes out of balance produces
    // a balance sheet that does not balance, and somebody finds out a year later.
    return { ok: false, reason: `the trial balance is out by ${tb.difference}`, say: 'find the entry before closing' };
  }

  exec("UPDATE fiscal_periods SET state = 'closed', closed_by = ?, closed_at = datetime('now') WHERE period = ?", actor, period);
  audit({
    actorType: 'human', actorId: actor, action: 'period.closed',
    subjectType: 'period', subjectId: period,
    payload: { debits: tb.debits, credits: tb.credits, entries: tb.entries },
  });
  return { ok: true, period, ...tb };
}

export function reopenPeriod({ period, reason, actor }) {
  if (!actor) refuse('reopening a period has to be signed');
  if (!reason) refuse('reopening a closed period needs a reason on the record');
  exec("UPDATE fiscal_periods SET state = 'open', reopened_by = ?, reopened_at = datetime('now'), reopen_reason = ? WHERE period = ?", actor, reason, period);
  audit({ actorType: 'human', actorId: actor, action: 'period.reopened', subjectType: 'period', subjectId: period, payload: { reason } });
  return { ok: true, period };
}

// ----------------------------------------------------------------- entries --

const round = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Write an entry.
 *
 * `lines` is [{ account, debit }] or [{ account, credit }] — never both on one
 * line, because a line that is simultaneously a debit and a credit is two lines
 * somebody has not finished thinking about.
 *
 * A draft can be edited. A posted entry cannot, ever: correcting it means
 * reversing it. That is not bureaucracy, it is the only way the books stay
 * evidence of what happened rather than a description of what somebody
 * currently believes.
 */
export function journalEntry({
  date = null, memo, lines, source = null, sourceId = null,
  currency = null, actor, post = false,
}) {
  if (!actor) refuse('an entry has to name who made it');
  if (!memo) refuse('an entry without a memo is a number nobody can explain later');
  if (!Array.isArray(lines) || lines.length < 2) refuse('an entry has at least two lines');

  const when = date || new Date().toISOString().slice(0, 10);
  const period = periodOf(when);
  const p = ensurePeriod(period);
  if (p.state === 'closed') refuse(`${period} is closed — post to an open period, or reopen it on the record`);

  const cur = currency || getSetting('FUNCTIONAL_CURRENCY') || 'USD';
  let debits = 0; let credits = 0;
  const clean = lines.map((l, i) => {
    const debit = round(l.debit || 0);
    const credit = round(l.credit || 0);
    if (debit && credit) refuse(`line ${i + 1} is both a debit and a credit — that is two lines`);
    if (!debit && !credit) refuse(`line ${i + 1} has no amount`);
    if (debit < 0 || credit < 0) refuse(`line ${i + 1} is negative — put it on the other side instead`);
    const account = one('SELECT code, type FROM accounts WHERE code = ? AND retired_at IS NULL', String(l.account));
    if (!account) refuse(`no such account: ${l.account}`);
    debits += debit; credits += credit;
    return { account: account.code, side: debit ? 'debit' : 'credit', amount: debit || credit, memo: l.memo || null };
  });

  debits = round(debits); credits = round(credits);
  if (Math.abs(debits - credits) > 0.005) {
    // The one rule that is not a preference.
    refuse(`this does not balance: ${debits} in debits against ${credits} in credits`);
  }

  const ref = nextRef(period);
  // The rows and the chain entry are one act. Raw BEGIN was here first and
  // could not nest — a route already inside a transaction would fail with
  // "cannot start a transaction within a transaction", which is what happened
  // the moment the API started wrapping its writes.
  return atomically(() => {
    exec(
      `INSERT INTO journal (ref, entry_date, period, memo, source, source_id, currency, total, state, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ref, when, period, memo, source, sourceId ? String(sourceId) : null, cur, debits,
      post ? 'posted' : 'draft', actor,
    );
    const id = one('SELECT last_insert_rowid() AS id').id;
    for (const l of clean) {
      exec('INSERT INTO journal_lines (journal_id, account_code, side, amount, memo) VALUES (?,?,?,?,?)',
        id, l.account, l.side, l.amount, l.memo);
    }
    if (post) exec("UPDATE journal SET posted_by = ?, posted_at = datetime('now') WHERE id = ?", actor, id);

    // Inside the same savepoint on purpose: if this write fails, the entry it
    // describes has to go with it.
    audit({
      actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor,
      action: post ? 'journal.posted' : 'journal.drafted',
      subjectType: 'journal', subjectId: ref,
      payload: { memo, total: debits, currency: cur, lines: clean.length, source, sourceId },
    });
    return { ok: true, id, ref, period, total: debits, state: post ? 'posted' : 'draft' };
  });
}

function nextRef(period) {
  const n = one('SELECT COUNT(*) AS n FROM journal WHERE period = ?', period).n + 1;
  return `JE-${period.replace('-', '')}-${String(n).padStart(4, '0')}`;
}

/** Post a draft. The moment it stops being editable. */
export function postEntry({ id, actor }) {
  if (!actor) refuse('posting has to be signed');
  const j = one('SELECT * FROM journal WHERE id = ?', id);
  if (!j) refuse('no such entry');
  if (j.state === 'posted') return { alreadyPosted: true, ref: j.ref };
  if (j.reversed_by_id) refuse(`that entry was reversed by ${j.reversed_by_id}; it cannot be posted`);
  if (one('SELECT state FROM fiscal_periods WHERE period = ?', j.period)?.state === 'closed') {
    refuse(`${j.period} is closed`);
  }
  const sums = one(
    `SELECT COALESCE(SUM(CASE WHEN side = 'debit' THEN amount END), 0) AS d,
            COALESCE(SUM(CASE WHEN side = 'credit' THEN amount END), 0) AS c
       FROM journal_lines WHERE journal_id = ?`, id,
  );
  if (Math.abs(sums.d - sums.c) > 0.005) refuse(`this does not balance: ${sums.d} against ${sums.c}`);

  exec("UPDATE journal SET state = 'posted', posted_by = ?, posted_at = datetime('now') WHERE id = ?", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'journal.posted', subjectType: 'journal', subjectId: j.ref, payload: { total: j.total } });
  return { ok: true, ref: j.ref };
}

/**
 * Correct a posted entry by reversing it.
 *
 * The original stays exactly as it was and the reversal says what it undoes and
 * why. Anybody reading the books later sees both the mistake and the
 * correction, which is the point: a ledger that only shows the tidy version is
 * a ledger nobody can audit.
 */
export function reverseEntry({ id, reason, actor, date = null }) {
  if (!actor) refuse('a reversal has to be signed');
  if (!reason) refuse('a reversal without a reason is an edit wearing a disguise');
  const j = one('SELECT * FROM journal WHERE id = ?', id);
  if (!j) refuse('no such entry');
  if (j.state !== 'posted') refuse('only a posted entry can be reversed');
  if (j.reversed_by_id) refuse(`already reversed by entry ${j.reversed_by_id}`);

  const lines = q('SELECT * FROM journal_lines WHERE journal_id = ?', id).map((l) => ({
    account: l.account_code,
    // Every side flipped: that is the whole of a reversal.
    [l.side === 'debit' ? 'credit' : 'debit']: l.amount,
    memo: l.memo,
  }));

  const r = journalEntry({
    date, memo: `Reversal of ${j.ref} — ${reason}`, lines,
    source: 'reversal', sourceId: j.ref, currency: j.currency, actor, post: true,
  });
  // The original stays posted. This is the difference between a reversal and a
  // deletion, and it is not cosmetic: a reversed entry that dropped out of the
  // statements while its reversal stayed in would leave every touched account
  // wrong by the amount of the correction, in the direction nobody checks.
  // Being reversed is a fact recorded against the entry, not a way of leaving
  // the books.
  exec('UPDATE journal SET reversed_by_id = ?, reversal_reason = ? WHERE id = ?', r.id, reason, id);
  audit({
    // Who reversed it matters as much as that it was reversed, and an agent
    // must not be recorded as a person.
    actorType: actor.startsWith('agent:') ? 'agent' : 'human', actorId: actor, action: 'journal.reversed',
    subjectType: 'journal', subjectId: j.ref, payload: { by: r.ref, reason, total: j.total },
  });
  return { ok: true, reversed: j.ref, by: r.ref, id: r.id };
}

// ------------------------------------------------------------- statements --

const range = (period) => (period
  ? { from: `${period}-01`, to: `${period}-31` }
  : { from: '0000-00-00', to: '9999-99-99' });

export function trialBalance({ period = null } = {}) {
  const { from, to } = range(period);
  const rows = q(
    `SELECT l.account_code, a.name, a.type, a.normal_side,
            COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount END), 0) AS debits,
            COALESCE(SUM(CASE WHEN l.side = 'credit' THEN l.amount END), 0) AS credits
       FROM journal_lines l
       JOIN journal j ON j.id = l.journal_id
       JOIN accounts a ON a.code = l.account_code
      WHERE j.state = 'posted' AND j.entry_date BETWEEN ? AND ?
      GROUP BY l.account_code ORDER BY l.account_code`, from, to,
  );
  const debits = round(rows.reduce((n, r) => n + r.debits, 0));
  const credits = round(rows.reduce((n, r) => n + r.credits, 0));
  return {
    period: period || 'all time',
    accounts: rows.map((r) => ({
      ...r,
      balance: round(r.normal_side === 'debit' ? r.debits - r.credits : r.credits - r.debits),
    })),
    debits, credits,
    difference: round(debits - credits),
    // The one-line answer, said the way somebody would ask for it.
    balances: Math.abs(debits - credits) <= 0.005,
    entries: one(
      "SELECT COUNT(*) AS n FROM journal WHERE state = 'posted' AND entry_date BETWEEN ? AND ?", from, to,
    ).n,
  };
}

export function incomeStatement({ period = null } = {}) {
  const { from, to } = range(period);
  const side = (type) => q(
    `SELECT a.code, a.name,
            COALESCE(SUM(CASE WHEN l.side = 'credit' THEN l.amount ELSE -l.amount END), 0) AS credit_balance
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id JOIN accounts a ON a.code = l.account_code
      WHERE j.state = 'posted' AND a.type = ? AND j.entry_date BETWEEN ? AND ?
      GROUP BY a.code HAVING credit_balance != 0 ORDER BY a.code`, type, from, to,
  );
  const revenue = side('revenue').map((r) => ({ ...r, amount: round(r.credit_balance) }));
  const expenses = side('expense').map((r) => ({ ...r, amount: round(-r.credit_balance) }));
  const totalRevenue = round(revenue.reduce((n, r) => n + r.amount, 0));
  const totalExpenses = round(expenses.reduce((n, r) => n + r.amount, 0));
  return {
    period: period || 'all time',
    revenue, expenses, totalRevenue, totalExpenses,
    net: round(totalRevenue - totalExpenses),
    margin: totalRevenue ? Number(((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(1)) : null,
  };
}

export function balanceSheet({ asOf = null } = {}) {
  const to = asOf || '9999-99-99';
  const group = (type) => q(
    `SELECT a.code, a.name, a.normal_side,
            COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END), 0) AS raw
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id JOIN accounts a ON a.code = l.account_code
      WHERE j.state = 'posted' AND a.type = ? AND j.entry_date <= ?
      GROUP BY a.code HAVING raw != 0 ORDER BY a.code`, type, to,
  ).map((r) => ({ code: r.code, name: r.name, amount: round(r.normal_side === 'debit' ? r.raw : -r.raw) }));

  const assets = group('asset');
  const liabilities = group('liability');
  const equity = group('equity');
  const sum = (xs) => round(xs.reduce((n, x) => n + x.amount, 0));

  // Profit not yet closed into retained earnings still belongs to the owners,
  // and a balance sheet that leaves it out does not balance.
  const earned = incomeStatement({}).net;
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round(sum(equity) + earned);

  return {
    asOf: asOf || 'today',
    assets, liabilities, equity,
    retainedThisPeriod: earned,
    totalAssets, totalLiabilities, totalEquity,
    // Assets = liabilities + equity, or somebody has some explaining to do.
    balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.02,
    difference: round(totalAssets - (totalLiabilities + totalEquity)),
  };
}

/** What actually moved through the cash and crypto accounts. */
export function cashFlow({ period = null } = {}) {
  const { from, to } = range(period);
  const rows = q(
    `SELECT j.ref, j.entry_date, j.memo, j.source, l.side, l.amount
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id JOIN accounts a ON a.code = l.account_code
      WHERE j.state = 'posted' AND a.type = 'asset' AND a.code IN ('1000','1010')
        AND j.entry_date BETWEEN ? AND ? ORDER BY j.entry_date DESC LIMIT 200`, from, to,
  );
  const inflow = round(rows.filter((r) => r.side === 'debit').reduce((n, r) => n + r.amount, 0));
  const outflow = round(rows.filter((r) => r.side === 'credit').reduce((n, r) => n + r.amount, 0));
  return { period: period || 'all time', inflow, outflow, net: round(inflow - outflow), movements: rows };
}

export function ledgerFor({ account: accountCode, period = null } = {}) {
  const { from, to } = range(period);
  const account = one('SELECT * FROM accounts WHERE code = ?', accountCode);
  if (!account) refuse('no such account');
  const rows = q(
    `SELECT j.ref, j.entry_date, j.memo, j.source, j.source_id, l.side, l.amount, l.memo AS line_memo
       FROM journal_lines l JOIN journal j ON j.id = l.journal_id
      WHERE l.account_code = ? AND j.state = 'posted' AND j.entry_date BETWEEN ? AND ?
      ORDER BY j.entry_date, j.id`, accountCode, from, to,
  );
  let running = 0;
  const lines = rows.map((r) => {
    running += (r.side === 'debit' ? 1 : -1) * r.amount;
    return { ...r, balance: round(account.normal_side === 'debit' ? running : -running) };
  });
  return { account, lines, balance: lines.length ? lines[lines.length - 1].balance : 0 };
}

export function journalList({ period = null, state = null, account = null, q: term = null, limit = 100 } = {}) {
  const { from, to } = range(period);
  const where = ['j.entry_date BETWEEN ? AND ?'];
  const args = [from, to];
  if (state) { where.push('j.state = ?'); args.push(state); }
  // Finding every entry that touched an account is how you answer "why is this
  // number what it is" — the question the summary pages could never answer.
  if (account) {
    where.push('EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = j.id AND l.account_code = ?)');
    args.push(account);
  }
  if (term) {
    where.push('(j.memo LIKE ? OR j.ref LIKE ? OR j.source_id LIKE ?)');
    args.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const rows = q(
    `SELECT j.* FROM journal j WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT ?`,
    ...args, limit,
  );
  return rows.map((j) => ({
    ...j,
    lines: q('SELECT account_code, side, amount, memo FROM journal_lines WHERE journal_id = ? ORDER BY id', j.id),
  }));
}

export function ledgerOverview({ period = null } = {}) {
  const p = period || periodOf();
  const tb = trialBalance({ period: p });
  const bs = balanceSheet({});
  const is = incomeStatement({ period: p });
  return {
    period: p,
    periodState: one('SELECT * FROM fiscal_periods WHERE period = ?', p)?.state || 'open',
    functionalCurrency: getSetting('FUNCTIONAL_CURRENCY') || 'USD',
    accounts: one('SELECT COUNT(*) AS n FROM accounts WHERE retired_at IS NULL').n,
    chart: chart(),
    drafts: one("SELECT COUNT(*) AS n FROM journal WHERE state = 'draft'").n,
    awaitingHuman: one("SELECT COUNT(*) AS n FROM journal WHERE state = 'draft' AND created_by NOT LIKE 'human:%'").n,
    trialBalance: tb,
    incomeStatement: is,
    balanceSheet: bs,
    // Both checks in one place, because "the books balance" is the first
    // question and it has two halves.
    healthy: tb.balances && bs.balances,
  };
}
