// THE BANK — accounts and cash boxes, statements and reconciliation,
// transfers, cheques, and the payment batches that move payroll and bills.
//
// This is the fiat side of treasury. Core 1's treasury page watches crypto
// wallets and settles crypto invoices; this file is the bank account the
// payroll leaves from and the cheque book. They are two departments because
// they are two kinds of money with two kinds of proof.
//
// Each account is its own child of 1000 in Core 1's chart, so the cash
// position per account is a ledger balance and not a number kept here. The
// only writes to the chart go through the bridge's ensureLedgerAccount(),
// which is Core 1 code — this file still never imports ledger.js.
//
// Reconciliation is the honest part: a statement line is matched to a journal
// line, one to one, and what is left unmatched is shown, never hidden.
import { q, one, exec } from '../db.js';
import { sealForRef, openPii } from '../erasure.js';
import { log } from './identity.js';
import { emit, ensureLedgerAccount } from './bridge.js';
import { payBill } from './finance.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const human = (actor, what) => {
  if (!String(actor || '').startsWith('human:')) refuse(`${what} is a human act — an agent may prepare it, never do it`);
};
const activeAccount = (id) => {
  const a = one("SELECT * FROM bank_account WHERE id = ? AND state = 'active'", Number(id));
  if (!a) refuse('no such active bank account');
  return a;
};

// ---------------------------------------------------------------- accounts --

/** Its own GL code: 1020, 1021, … — children of 1000, made by Core 1's addAccount. */
function nextGlCode() {
  const used = new Set(q("SELECT code FROM accounts WHERE code LIKE '10__'").map((r) => r.code));
  for (let n = 1020; n < 1100; n++) if (!used.has(String(n))) return String(n);
  refuse('the chart has no room for another bank account under 1000');
  return null;
}

export function createBankAccount({ name, bank = null, kind = 'bank', currency = 'USD', iban = null, openingBalance = 0, actor }) {
  human(actor, 'opening a bank account');
  if (!clean(name)) refuse('an account needs a name');
  if (!['bank', 'cashbox'].includes(kind)) refuse('kind is bank or cashbox');
  const code = nextGlCode();
  ensureLedgerAccount({ code, name: `${kind === 'cashbox' ? 'Cash box' : 'Bank'} — ${clean(name)}`, type: 'asset', parentCode: '1000', note: 'Opened by the enterprise core' });
  const opening = round2(Number(openingBalance) || 0);
  exec(`INSERT INTO bank_account (name, bank, kind, currency, iban, gl_code, opening_balance, created_by) VALUES (?,?,?,?,?,?,?,?)`,
    clean(name), bank ? clean(bank) : null, kind, clean(currency, 3) || 'USD', iban ? clean(iban, 40) : null, code, opening, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'bank_account', entityId: id, action: 'bank.opened', actor, detail: { glCode: code, kind }, chain: true });
  if (opening) emit('bank.opened', { id, glCode: code, opening });
  return getAccount(id);
}

export function closeBankAccount(id, { actor }) {
  human(actor, 'closing a bank account');
  const a = activeAccount(id);
  const pos = cashPosition().accounts.find((x) => x.id === a.id);
  if (pos && Math.abs(pos.ledger) > 0.005) refuse('an account with a balance cannot be closed — move the money first');
  exec("UPDATE bank_account SET state = 'closed' WHERE id = ?", a.id);
  log({ entity: 'bank_account', entityId: a.id, action: 'bank.closed', actor, chain: true });
  return getAccount(a.id);
}

const mask = (iban) => (iban ? `${iban.slice(0, 4)}…${iban.slice(-4)}` : null);
export const getAccount = (id) => { const a = one('SELECT * FROM bank_account WHERE id = ?', Number(id)); return a ? { ...a, iban: mask(a.iban) } : null; };
export const listAccounts = () => q('SELECT * FROM bank_account ORDER BY state, id').map((a) => ({ ...a, iban: mask(a.iban) }));

/** Ledger balance per account, straight from Core 1's posted journal. */
function ledgerBalance(glCode) {
  return round2(one(`SELECT COALESCE(SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END), 0) AS n
    FROM journal_lines l JOIN journal j ON j.id = l.journal_id WHERE j.state = 'posted' AND l.account_code = ?`, glCode).n);
}

export function cashPosition() {
  const accounts = q("SELECT * FROM bank_account WHERE state = 'active' ORDER BY id").map((a) => {
    const ledger = ledgerBalance(a.gl_code);
    // The statement is the bank's own account of the money: its lines, only.
    // The opening balance is a ledger entry and the bank's first line, so
    // adding it here again would count it twice.
    const stmt = round2(one("SELECT COALESCE(SUM(amount), 0) AS n FROM bank_statement_line WHERE account_id = ? AND state != 'excluded'", a.id).n);
    const unmatched = one("SELECT COUNT(*) AS n FROM bank_statement_line WHERE account_id = ? AND state = 'unmatched'", a.id).n;
    return { id: a.id, name: a.name, bank: a.bank, kind: a.kind, currency: a.currency, glCode: a.gl_code, ledger, statement: stmt, difference: round2(ledger - stmt), unmatched };
  });
  return {
    accounts,
    total: round2(accounts.reduce((a, x) => a + x.ledger, 0)),
    parentCash: ledgerBalance('1000'),
  };
}

// -------------------------------------------------------------- statements --

export function importStatement({ accountId, label, lines = [], actor }) {
  if (!actor) refuse('importing a statement carries a name');
  const a = activeAccount(accountId);
  if (!Array.isArray(lines) || !lines.length) refuse('a statement has lines');
  exec('INSERT INTO bank_statement (account_id, label, created_by) VALUES (?,?,?)', a.id, clean(label) || `Statement ${today()}`, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  let n = 0;
  for (const l of lines) {
    const amt = round2(Number(l.amount));
    if (!amt || !/^\d{4}-\d{2}-\d{2}$/.test(String(l.day || ''))) continue;
    exec('INSERT INTO bank_statement_line (statement_id, account_id, day, amount, ref) VALUES (?,?,?,?,?)', id, a.id, l.day, amt, l.ref ? clean(l.ref, 80) : null);
    n++;
  }
  log({ entity: 'statement', entityId: id, action: 'statement.imported', actor, detail: { accountId: a.id, lines: n } });
  return { id, accountId: a.id, lines: n };
}

/** Journal lines on this account's GL code not yet claimed by a statement line. */
function openJournalLines(glCode) {
  return q(`SELECT l.id, l.side, l.amount, j.entry_date, j.memo, j.ref FROM journal_lines l JOIN journal j ON j.id = l.journal_id
    WHERE j.state = 'posted' AND l.account_code = ? AND l.id NOT IN (SELECT journal_line_id FROM bank_statement_line WHERE journal_line_id IS NOT NULL)
    ORDER BY j.entry_date`, glCode);
}

export function matchLine(lineId, { journalLineId, actor }) {
  if (!actor) refuse('matching carries a name');
  const line = one('SELECT * FROM bank_statement_line WHERE id = ?', Number(lineId));
  if (!line) refuse('no such statement line');
  if (line.state !== 'unmatched') refuse(`this line is ${line.state}`);
  const a = activeAccount(line.account_id);
  const jl = openJournalLines(a.gl_code).find((x) => x.id === Number(journalLineId));
  if (!jl) refuse('that journal line is not open on this account');
  const signed = jl.side === 'debit' ? jl.amount : -jl.amount;
  if (Math.abs(signed - line.amount) > 0.005) refuse(`amounts differ: statement ${line.amount}, ledger ${signed}`);
  exec("UPDATE bank_statement_line SET state = 'matched', journal_line_id = ? WHERE id = ?", jl.id, line.id);
  log({ entity: 'statement_line', entityId: line.id, action: 'statement.matched', actor, detail: { journalLineId: jl.id } });
  return one('SELECT * FROM bank_statement_line WHERE id = ?', line.id);
}

export function excludeLine(lineId, { actor }) {
  human(actor, 'excluding a statement line');
  const line = one('SELECT * FROM bank_statement_line WHERE id = ?', Number(lineId));
  if (!line) refuse('no such statement line');
  exec("UPDATE bank_statement_line SET state = 'excluded' WHERE id = ?", line.id);
  log({ entity: 'statement_line', entityId: line.id, action: 'statement.excluded', actor });
  return one('SELECT * FROM bank_statement_line WHERE id = ?', line.id);
}

/** Exact amount, one candidate: matched. Anything ambiguous is left for a person. */
export function autoMatch(accountId, { actor }) {
  if (!actor) refuse('auto-matching carries a name');
  const a = activeAccount(accountId);
  let matched = 0;
  for (const line of q("SELECT * FROM bank_statement_line WHERE account_id = ? AND state = 'unmatched'", a.id)) {
    const open = openJournalLines(a.gl_code);
    const candidates = open.filter((jl) => Math.abs((jl.side === 'debit' ? jl.amount : -jl.amount) - line.amount) <= 0.005);
    if (candidates.length !== 1) continue;
    exec("UPDATE bank_statement_line SET state = 'matched', journal_line_id = ? WHERE id = ?", candidates[0].id, line.id);
    matched++;
  }
  log({ entity: 'bank_account', entityId: a.id, action: 'statement.automatched', actor, detail: { matched } });
  return { accountId: a.id, matched };
}

export function reconciliation(accountId) {
  const a = activeAccount(accountId);
  const pos = cashPosition().accounts.find((x) => x.id === a.id);
  return {
    account: getAccount(a.id),
    ...pos,
    unmatchedLines: q("SELECT * FROM bank_statement_line WHERE account_id = ? AND state = 'unmatched' ORDER BY day", a.id),
    openJournal: openJournalLines(a.gl_code),
    matched: one("SELECT COUNT(*) AS n FROM bank_statement_line WHERE account_id = ? AND state = 'matched'", a.id).n,
  };
}

// --------------------------------------------------------------- transfers --

export function createTransfer({ fromAccountId, toAccountId = null, beneficiary = null, purposeCode = '5900', amount, fee = 0, actor }) {
  if (!actor) refuse('a transfer is drafted by somebody');
  const from = activeAccount(fromAccountId);
  if (toAccountId) { activeAccount(toAccountId); if (Number(toAccountId) === from.id) refuse('a transfer needs two different accounts'); }
  else if (!clean(beneficiary)) refuse('an external payment names a beneficiary');
  const amt = round2(Number(amount)); const f = round2(Number(fee) || 0);
  if (!(amt > 0)) refuse('a transfer is a positive amount');
  if (!toAccountId && !one('SELECT code FROM accounts WHERE code = ? AND retired_at IS NULL', String(purposeCode))) refuse(`no such account: ${purposeCode}`);
  exec(`INSERT INTO bank_transfer (from_account_id, to_account_id, beneficiary, purpose_code, amount, fee, created_by) VALUES (?,?,?,?,?,?,?)`,
    from.id, toAccountId ? Number(toAccountId) : null, toAccountId ? null : clean(beneficiary), String(purposeCode), amt, f, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'transfer', entityId: id, action: 'transfer.drafted', actor, detail: { amount: amt, external: !toAccountId } });
  return one('SELECT * FROM bank_transfer WHERE id = ?', id);
}

export function approveTransfer(id, { actor }) {
  human(actor, 'approving a transfer');
  const t = one('SELECT * FROM bank_transfer WHERE id = ?', Number(id));
  if (!t) refuse('no such transfer');
  if (t.state !== 'draft') refuse(`this transfer is already ${t.state}`);
  exec("UPDATE bank_transfer SET state = 'approved', approved_by = ? WHERE id = ?", String(actor), t.id);
  log({ entity: 'transfer', entityId: t.id, action: 'transfer.approved', actor, chain: true });
  return one('SELECT * FROM bank_transfer WHERE id = ?', t.id);
}

/** The money moves. Human, and a second human from the one who approved when there are two. */
export function executeTransfer(id, { actor }) {
  human(actor, 'executing a transfer');
  const t = one('SELECT * FROM bank_transfer WHERE id = ?', Number(id));
  if (!t) refuse('no such transfer');
  if (t.state !== 'approved') refuse('only an approved transfer can be executed');
  const from = activeAccount(t.from_account_id);
  const to = t.to_account_id ? activeAccount(t.to_account_id) : null;
  exec("UPDATE bank_transfer SET state = 'executed', executed_at = datetime('now') WHERE id = ?", t.id);
  log({ entity: 'transfer', entityId: t.id, action: 'transfer.executed', actor, detail: { amount: t.amount, fee: t.fee }, chain: true });
  emit('transfer.executed', { id: t.id, amount: t.amount, fee: t.fee, fromGl: from.gl_code, toGl: to ? to.gl_code : null, purposeCode: t.purpose_code });
  return one('SELECT * FROM bank_transfer WHERE id = ?', t.id);
}

export const listTransfers = () => q(`SELECT t.*, f.name AS from_name, x.name AS to_name FROM bank_transfer t
  JOIN bank_account f ON f.id = t.from_account_id LEFT JOIN bank_account x ON x.id = t.to_account_id ORDER BY t.id DESC LIMIT 100`);

// ----------------------------------------------------------------- cheques --

const CHEQUE_NEXT = {
  drafted: ['issued', 'void'], issued: ['presented', 'void'], presented: ['cleared', 'bounced'], cleared: [], bounced: ['presented'], void: [],
};

export function issueCheque({ accountId, number, direction = 'issued', payee, amount, day = null, billId = null, invoiceId = null, actor }) {
  if (!actor) refuse('a cheque is written by somebody');
  const a = activeAccount(accountId);
  if (a.kind !== 'bank') refuse('a cash box has no cheque book');
  if (!['issued', 'received'].includes(direction)) refuse('direction is issued or received');
  const amt = round2(Number(amount));
  if (!(amt > 0)) refuse('a cheque has a positive amount');
  if (billId && !one("SELECT id FROM fin_ap_bill WHERE id = ? AND state = 'approved'", Number(billId))) refuse('no such approved bill');
  if (invoiceId && !one("SELECT id FROM fin_ar_invoice WHERE id = ? AND state = 'issued'", Number(invoiceId))) refuse('no such issued invoice');
  exec(`INSERT INTO bank_cheque (account_id, number, direction, payee, amount, day, bill_id, invoice_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    a.id, clean(number, 30), direction, clean(payee), amt, day || today(), billId ? Number(billId) : null, invoiceId ? Number(invoiceId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'cheque', entityId: id, action: 'cheque.drafted', actor, detail: { amount: amt, direction } });
  return one('SELECT * FROM bank_cheque WHERE id = ?', id);
}

export function setChequeState(id, { state, actor }) {
  if (!actor) refuse('moving a cheque carries a name');
  const c = one('SELECT * FROM bank_cheque WHERE id = ?', Number(id));
  if (!c) refuse('no such cheque');
  if (!CHEQUE_NEXT[c.state].includes(state)) refuse(`a ${c.state} cheque cannot become ${state}`);
  if (['issued', 'cleared', 'void'].includes(state)) human(actor, `marking a cheque ${state}`);
  exec('UPDATE bank_cheque SET state = ? WHERE id = ?', state, c.id);
  log({ entity: 'cheque', entityId: c.id, action: `cheque.${state}`, actor, chain: state === 'cleared' || state === 'bounced' });
  if (state === 'cleared') {
    const a = activeAccount(c.account_id);
    if (c.direction === 'issued' && c.bill_id) {
      // The cheque clearing IS the bill being paid; one event, one entry.
      const bill = one('SELECT state FROM fin_ap_bill WHERE id = ?', c.bill_id);
      if (bill?.state === 'approved') payBill(c.bill_id, { actor, bankAccountId: a.id });
    } else {
      emit('cheque.cleared', { id: c.id, amount: c.amount, direction: c.direction, glCode: a.gl_code, invoiceId: c.invoice_id });
    }
  }
  return one('SELECT * FROM bank_cheque WHERE id = ?', c.id);
}

export const listCheques = () => q('SELECT c.*, a.name AS account_name FROM bank_cheque c JOIN bank_account a ON a.id = c.account_id ORDER BY c.id DESC LIMIT 100');

// --------------------------------------------------------- payment batches --

/**
 * Payroll leaves the bank as a batch: one line per slip, each beneficiary
 * sealed under the employee. The ledger already recognised the cost at close;
 * releasing the batch moves the cash from the parent 1000 to this account.
 */
export function buildPayrollBatch({ runId, accountId, actor }) {
  human(actor, 'building a payroll batch');
  const run = one('SELECT * FROM pay_run WHERE id = ?', Number(runId));
  if (!run) refuse('no such payroll run');
  if (!['approved', 'closed'].includes(run.state)) refuse('a payroll batch is built from an approved run');
  if (one("SELECT id FROM bank_payment_batch WHERE kind = 'payroll' AND source_id = ? AND state != 'void'", String(run.id))) refuse('this run already has a batch');
  const a = activeAccount(accountId);
  exec("INSERT INTO bank_payment_batch (kind, source_id, account_id, created_by) VALUES ('payroll', ?, ?, ?)", String(run.id), a.id, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  let total = 0; let count = 0;
  for (const s of q(`SELECT s.*, e.bank_account, p.display_name FROM pay_slip s JOIN hr_employee e ON e.id = s.employee_id JOIN hr_person p ON p.id = e.person_id WHERE s.run_id = ?`, run.id)) {
    const detail = JSON.parse(openPii(s.detail) || '{}');
    const net = round2(Number(detail.net) || 0);
    if (net <= 0) continue;
    const who = `${s.display_name} · ${openPii(s.bank_account) || 'no bank detail on file'}`;
    exec('INSERT INTO bank_payment_item (batch_id, beneficiary, amount, employee_id, subject_ref) VALUES (?,?,?,?,?)',
      id, s.subject_ref ? sealForRef(who, s.subject_ref) : who, net, s.employee_id, s.subject_ref);
    total = round2(total + net); count++;
  }
  exec('UPDATE bank_payment_batch SET total = ?, count = ? WHERE id = ?', total, count, id);
  log({ entity: 'payment_batch', entityId: id, action: 'batch.built', actor, detail: { kind: 'payroll', runId: run.id, count, total } });
  return getBatch(id);
}

export function buildApBatch({ billIds = [], accountId, actor }) {
  human(actor, 'building a payment batch');
  const a = activeAccount(accountId);
  const bills = (Array.isArray(billIds) ? billIds : []).map((x) => one("SELECT b.*, v.name AS vendor_name FROM fin_ap_bill b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.id = ? AND b.state = 'approved'", Number(x))).filter(Boolean);
  if (!bills.length) refuse('no approved bills to pay');
  exec("INSERT INTO bank_payment_batch (kind, account_id, created_by) VALUES ('ap', ?, ?)", a.id, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  let total = 0;
  for (const b of bills) {
    const amt = round2(b.amount + b.tax);
    exec('INSERT INTO bank_payment_item (batch_id, beneficiary, amount, bill_id) VALUES (?,?,?,?)', id, b.vendor_name || b.vendor_id, amt, b.id);
    total = round2(total + amt);
  }
  exec('UPDATE bank_payment_batch SET total = ?, count = ? WHERE id = ?', total, bills.length, id);
  log({ entity: 'payment_batch', entityId: id, action: 'batch.built', actor, detail: { kind: 'ap', count: bills.length, total } });
  return getBatch(id);
}

export function approveBatch(id, { actor }) {
  human(actor, 'approving a payment batch');
  const b = one('SELECT * FROM bank_payment_batch WHERE id = ?', Number(id));
  if (!b) refuse('no such batch');
  if (b.state !== 'draft') refuse(`this batch is already ${b.state}`);
  if (String(actor) === b.created_by) refuse('the person who built a batch does not approve it — four eyes');
  exec("UPDATE bank_payment_batch SET state = 'approved', approved_by = ? WHERE id = ?", String(actor), b.id);
  log({ entity: 'payment_batch', entityId: b.id, action: 'batch.approved', actor, chain: true });
  return getBatch(b.id);
}

/** Released: the instruction goes to the bank. Bills become paid here, one by one. */
export function releaseBatch(id, { actor }) {
  human(actor, 'releasing payments');
  const b = one('SELECT * FROM bank_payment_batch WHERE id = ?', Number(id));
  if (!b) refuse('no such batch');
  if (b.state !== 'approved') refuse('only an approved batch can be released');
  const a = activeAccount(b.account_id);
  exec("UPDATE bank_payment_batch SET state = 'released', released_at = datetime('now') WHERE id = ?", b.id);
  for (const it of q('SELECT * FROM bank_payment_item WHERE batch_id = ? AND bill_id IS NOT NULL', b.id)) {
    const bill = one('SELECT state FROM fin_ap_bill WHERE id = ?', it.bill_id);
    if (bill?.state === 'approved') payBill(it.bill_id, { actor, bankAccountId: a.id });
  }
  log({ entity: 'payment_batch', entityId: b.id, action: 'batch.released', actor, detail: { kind: b.kind, total: b.total, count: b.count }, chain: true });
  emit('payments.released', { id: b.id, kind: b.kind, total: b.total, glCode: a.gl_code });
  return getBatch(b.id);
}

export function getBatch(id) {
  const b = one('SELECT b.*, a.name AS account_name FROM bank_payment_batch b JOIN bank_account a ON a.id = b.account_id WHERE b.id = ?', Number(id));
  if (!b) return null;
  return { ...b, items: q('SELECT * FROM bank_payment_item WHERE batch_id = ? ORDER BY id', b.id).map((it) => ({ ...it, beneficiary: openPii(it.beneficiary) })) };
}

export const listBatches = () => q('SELECT b.*, a.name AS account_name FROM bank_payment_batch b JOIN bank_account a ON a.id = b.account_id ORDER BY b.id DESC LIMIT 50');

// ----------------------------------------------------------------- overview --

export function bankOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    position: cashPosition(),
    accounts: listAccounts(),
    transfers: listTransfers(),
    cheques: listCheques(),
    batches: listBatches(),
    transfersWaiting: n("SELECT COUNT(*) AS n FROM bank_transfer WHERE state IN ('draft','approved')"),
    batchesWaiting: n("SELECT COUNT(*) AS n FROM bank_payment_batch WHERE state IN ('draft','approved')"),
    unmatched: n("SELECT COUNT(*) AS n FROM bank_statement_line WHERE state = 'unmatched'"),
    note: 'Each account is its own line in the one chart, so the balance shown is the ledger\'s and not a figure kept here. A '
      + 'statement is matched line by line and what does not match is shown. Money moves only when a person says so, and a '
      + 'batch is approved by somebody other than the person who built it.',
  };
}
