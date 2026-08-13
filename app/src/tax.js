// Tax — the department where a mistake costs real money to somebody who can
// fine you for it.
//
// It is deliberately not a report over the ledger. A report can tell you what
// you charged; it cannot tell you what you *owed*, which depends on where the
// customer was, whether you are registered there, whether the supply was
// reverse-charged, and which quarter it fell in. Those are facts about a
// jurisdiction and a date, not about an invoice, so they live here and produce
// entries in the same double-entry books as everything else.
//
// Nothing in this module invents a rate. A jurisdiction with no rate on file
// produces an unclassified line and a question for a person, because a guessed
// VAT rate is a wrong number that looks exactly like a right one.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { journalEntry, postEntry } from './ledger.js';

const clean = (s, n = 400) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/** What an AI employee may commit to the books unattended — the same limit the bookkeeper obeys. */
const agentLimit = () => Number(getSetting('BOOKKEEPER_LIMIT_USD') || 500);

// ------------------------------------------------------------ jurisdictions --

export function jurisdictions() {
  return q('SELECT * FROM tax_jurisdictions ORDER BY registered DESC, code');
}

export function addJurisdiction({
  code, name, kind = 'vat', rate = 0, registered = 0, registration = null,
  thresholdUsd = 0, filing = 'quarterly', note = null, actor,
}) {
  if (!actor) refuse('a tax registration has to name who recorded it');
  if (!code || !name) refuse('a jurisdiction needs a code and a name');
  if (!['vat', 'sales', 'gst', 'withholding', 'none'].includes(kind)) refuse(`unknown tax kind ${kind}`);
  if (rate < 0 || rate > 100) refuse('a rate is a percentage');
  exec(`INSERT INTO tax_jurisdictions (code, name, kind, rate, registered, registration, threshold_usd, filing, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET name=excluded.name, kind=excluded.kind, rate=excluded.rate,
          registered=excluded.registered, registration=excluded.registration,
          threshold_usd=excluded.threshold_usd, filing=excluded.filing, note=excluded.note`,
  clean(code, 12).toUpperCase(), clean(name), kind, Number(rate), registered ? 1 : 0,
  clean(registration, 60) || null, Number(thresholdUsd), filing, clean(note, 600) || null, actor);
  const row = one('SELECT * FROM tax_jurisdictions WHERE code = ?', clean(code, 12).toUpperCase());
  audit({
    actorType: 'human', actorId: actor, action: 'tax.jurisdiction_set',
    subjectType: 'tax_jurisdiction', subjectId: row.id,
    payload: { code: row.code, kind, rate, registered: Boolean(registered) },
  });
  return row;
}

// ---------------------------------------------------------------- treatment --

const TREATMENTS = ['collected', 'paid', 'reverse_charge', 'exempt', 'out_of_scope'];

/**
 * Decide what a single event owes, from the rules on file — never from a guess.
 *
 * Returns the treatment *and the sentence explaining it*, because "why is this
 * line zero" is the question an auditor asks and "the code decided" is not an
 * answer anybody can defend three years later.
 */
export function classify({ jurisdiction, basis, kind = 'invoice' }) {
  const code = clean(jurisdiction, 12).toUpperCase();
  const j = one('SELECT * FROM tax_jurisdictions WHERE code = ?', code);
  if (!j) {
    return {
      treatment: null, rate: 0, amount: 0,
      reason: `${code || 'no jurisdiction'} is not on file — a rate nobody recorded is not a rate`,
      needsPerson: true,
    };
  }
  if (j.kind === 'none') {
    return { treatment: 'out_of_scope', rate: 0, amount: 0, reason: `${j.name} levies no tax of this kind`, needsPerson: false };
  }
  if (!j.registered) {
    return {
      treatment: 'out_of_scope', rate: 0, amount: 0,
      needsPerson: Number(basis) > 0 && Number(j.threshold_usd) > 0,
      reason: `not registered in ${j.name}${j.threshold_usd ? ` — the threshold there is ${j.threshold_usd}` : ''}`,
    };
  }
  const rate = Number(j.rate);
  const amount = Math.round(Number(basis) * rate) / 100;
  return {
    treatment: kind === 'payout' ? 'paid' : 'collected',
    rate,
    amount,
    reason: `${j.name} ${j.kind.toUpperCase()} at ${rate}% on ${basis}`,
    needsPerson: false,
  };
}

/**
 * Record the tax consequence of one event, and put it in the real books.
 *
 * The entry is drafted rather than posted when an AI employee is doing it and
 * the amount is over the limit — the same rule the bookkeeper obeys, for the
 * same reason. Tax is not a special case that deserves a lower bar; it is the
 * case that deserves the bar most.
 */
export function recordLine({
  sourceKind = 'manual', sourceId, jurisdiction, basis, actor, note = null, postToBooks = true,
}) {
  if (!actor) refuse('a tax line has to name who classified it');
  if (!sourceId) refuse('a tax line names the event it came from, or it cannot be defended');
  const existing = one('SELECT * FROM tax_lines WHERE source_kind = ? AND source_id = ?', sourceKind, String(sourceId));
  if (existing) return { alreadyRecorded: true, line: existing };

  const c = classify({ jurisdiction, basis, kind: sourceKind });
  exec(`INSERT INTO tax_lines (source_kind, source_id, jurisdiction, treatment, basis, rate, amount, reason, state, classified_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
  sourceKind, String(sourceId), clean(jurisdiction, 12).toUpperCase(),
  c.treatment || 'unclassified', Number(basis), c.rate, c.amount,
  note ? `${c.reason} — ${clean(note, 300)}` : c.reason, 'draft', actor);
  const line = one('SELECT * FROM tax_lines WHERE id = last_insert_rowid()');

  let entry = null;
  const isAgent = !String(actor).startsWith('human:');
  if (postToBooks && c.amount > 0 && c.treatment === 'collected') {
    // Tax collected is never revenue: it is money held on behalf of an
    // authority. Booking it as income is the mistake that makes a company look
    // profitable right up to the day the return is due.
    entry = journalEntry({
      memo: `Tax ${c.reason}`,
      source: 'tax', sourceId: String(line.id), actor,
      lines: [
        { account: '1100', debit: c.amount, memo: 'owed by the customer' },
        { account: '2200', credit: c.amount, memo: 'held for the authority, not earned' },
      ],
      post: !(isAgent && c.amount > agentLimit()),
    });
    exec('UPDATE tax_lines SET entry_id = ?, state = ? WHERE id = ?',
      entry.id, entry.state === 'posted' ? 'posted' : 'draft', line.id);
  }

  audit({
    actorType: isAgent ? 'agent' : 'human', actorId: actor, action: 'tax.line_recorded',
    subjectType: 'tax_line', subjectId: line.id,
    payload: {
      sourceKind, sourceId: String(sourceId), jurisdiction: line.jurisdiction,
      treatment: line.treatment, amount: c.amount, entryId: entry?.id || null,
      needsPerson: c.needsPerson, reason: c.reason,
    },
  });
  return { line: one('SELECT * FROM tax_lines WHERE id = ?', line.id), entryId: entry?.id || null, needsPerson: c.needsPerson };
}

/** Anything an agent classified that a person still has to look at. */
export function unclassified() {
  return q("SELECT * FROM tax_lines WHERE treatment = 'unclassified' OR state = 'draft' ORDER BY id DESC LIMIT 200");
}

/**
 * Sweep the invoices nobody has classified yet.
 *
 * Idempotent by (source, id): running it twice does not tax anything twice,
 * which is the whole reason the uniqueness is checked in the database and not
 * remembered in a variable.
 */
export function sweep({ actor = 'agent:AGT-TAX-001' } = {}) {
  const made = [];
  const skipped = [];
  const invoices = q(`SELECT i.* FROM invoices i
                       WHERE i.state IN ('paid','issued','sent')
                         AND NOT EXISTS (SELECT 1 FROM tax_lines t WHERE t.source_kind = 'invoice' AND t.source_id = CAST(i.id AS TEXT))
                       ORDER BY i.id LIMIT 100`);
  for (const inv of invoices) {
    const cust = inv.customer_id ? one('SELECT * FROM customers WHERE id = ?', inv.customer_id) : null;
    // A customer with no country is not an excuse to invent one.
    const code = clean(cust?.plan && '', 12) || getSetting('HOME_JURISDICTION') || '';
    const r = recordLine({
      sourceKind: 'invoice', sourceId: inv.id, jurisdiction: code,
      basis: Number(inv.amount) || 0, actor,
    });
    (r.needsPerson || !r.line.entry_id ? skipped : made).push(r.line.id);
  }
  if (made.length || skipped.length) {
    audit({
      actorType: 'agent', actorId: actor, action: 'tax.swept',
      subjectType: 'tax', subjectId: 'sweep',
      payload: { classified: made.length, awaitingPerson: skipped.length },
    });
  }
  return { classified: made.length, awaitingPerson: skipped.length, made, skipped };
}

// ------------------------------------------------------------------ returns --

export function buildReturn({ jurisdiction, periodStart, periodEnd, actor }) {
  if (!actor) refuse('a return has to name who prepared it');
  const code = clean(jurisdiction, 12).toUpperCase();
  const rows = q(`SELECT treatment, SUM(amount) AS total FROM tax_lines
                   WHERE jurisdiction = ? AND date(created_at) BETWEEN date(?) AND date(?)
                   GROUP BY treatment`, code, periodStart, periodEnd);
  const collected = rows.find((r) => r.treatment === 'collected')?.total || 0;
  const paid = rows.find((r) => r.treatment === 'paid')?.total || 0;
  exec(`INSERT INTO tax_returns (jurisdiction, period_start, period_end, collected, paid, net, state, prepared_by)
        VALUES (?,?,?,?,?,?, 'prepared', ?)`,
  code, periodStart, periodEnd, collected, paid, collected - paid, actor);
  const ret = one('SELECT * FROM tax_returns WHERE id = last_insert_rowid()');
  exec(`UPDATE tax_lines SET return_id = ? WHERE jurisdiction = ? AND return_id IS NULL
          AND date(created_at) BETWEEN date(?) AND date(?)`, ret.id, code, periodStart, periodEnd);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'tax.return_prepared', subjectType: 'tax_return', subjectId: ret.id,
    payload: { jurisdiction: code, collected, paid, net: collected - paid },
  });
  return ret;
}

/**
 * Filing is a human act, always.
 *
 * There is no amount small enough to make "an AI filed our tax return" a
 * sentence anybody wants to say, and no autonomy setting reaches this.
 */
export function fileReturn({ id, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('a return is filed by a person, not by an employee of this kind');
  const ret = one('SELECT * FROM tax_returns WHERE id = ?', id);
  if (!ret) refuse('no such return');
  if (ret.state === 'filed') return { alreadyFiled: true, ret };
  exec("UPDATE tax_returns SET state = 'filed', filed_by = ?, filed_at = datetime('now') WHERE id = ?", actor, id);
  exec("UPDATE tax_lines SET state = 'filed' WHERE return_id = ?", id);
  audit({
    actorType: 'human', actorId: actor, action: 'tax.return_filed',
    subjectType: 'tax_return', subjectId: id,
    payload: { jurisdiction: ret.jurisdiction, net: ret.net },
  });
  return one('SELECT * FROM tax_returns WHERE id = ?', id);
}

/** Post a drafted tax entry — the person's half of the limit. */
export function postDraft({ id, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('posting is a human act');
  const line = one('SELECT * FROM tax_lines WHERE id = ?', id);
  if (!line?.entry_id) refuse('that line has no entry to post');
  const r = postEntry({ id: line.entry_id, actor });
  exec("UPDATE tax_lines SET state = 'posted' WHERE id = ?", id);
  return r;
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const owed = one("SELECT COALESCE(SUM(amount),0) AS t FROM tax_lines WHERE treatment='collected' AND state <> 'filed'").t;
  return {
    jurisdictions: jurisdictions(),
    registered: n("SELECT COUNT(*) AS n FROM tax_jurisdictions WHERE registered = 1"),
    lines: n('SELECT COUNT(*) AS n FROM tax_lines'),
    awaitingPerson: n("SELECT COUNT(*) AS n FROM tax_lines WHERE treatment = 'unclassified' OR state = 'draft'"),
    owed,
    returns: q('SELECT * FROM tax_returns ORDER BY id DESC LIMIT 20'),
    recent: q('SELECT * FROM tax_lines ORDER BY id DESC LIMIT 40'),
    limitUsd: agentLimit(),
    // Said out loud rather than implied: this module classifies from rules a
    // person entered. It is not tax advice and cannot become it.
    note: 'Rates come from the jurisdictions on file. Nothing here invents one, and filing is always a human act.',
  };
}
