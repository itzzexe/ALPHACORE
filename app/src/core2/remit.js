// REMITTANCES AND SWIFT — the external transfers the bank approved, turned
// into the payment messages a bank accepts, and screened before they go.
//
// A message is built from a bank transfer that a person already approved,
// for a beneficiary whose IBAN passes its checksum and whose BIC is well
// formed. Two formats: MT103, still what most correspondent banks take, and
// ISO 20022 pacs.008, which is replacing it. Every message carries a UETR, the
// identifier the bank's tracker follows the payment by.
//
// Before anything is approved, the beneficiary is screened against the
// watchlist; a hit holds the message until a person clears it with a reason.
// Approval is four-eyes — the person who built it is not the person who
// approves it — and release produces the file for the bank's portal or the
// service bureau. Nothing here talks to SWIFT: the platform has no SWIFT
// connection, and the honest place for that boundary is in the code.
import { randomUUID } from 'node:crypto';
import { q, one, exec } from '../db.js';
import { getSetting, setSetting } from '../settings.js';
import { log } from './identity.js';
import { screen } from '../screening.js';
import { matchSanctions } from '../sanctions.js';

/** The company's own watchlist and the public sanctions lists, as one set of hits. */
const screenAll = (name) => [
  ...screen(name, q('SELECT name, source FROM remit_watchlist')),
  ...matchSanctions(name).map((h) => ({ name: h.name, source: `${h.list.toUpperCase()} ${h.ref}`, score: h.score })),
];

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 140) => String(s ?? '').trim().slice(0, n);
const human = (actor, what) => {
  if (!String(actor || '').startsWith('human:')) refuse(`${what} is a human act — an agent may prepare it, never do it`);
};

// ------------------------------------------------------------ validation --

/** IBAN: two letters, two check digits, then the account; valid when mod 97 = 1. */
export function validIban(raw) {
  const iban = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** BIC: bank (4), country (2), location (2), optional branch (3). */
export const validBic = (raw) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(raw || '').toUpperCase());

// ---------------------------------------------------------- beneficiaries --

export function addBeneficiary({ name, iban = null, account = null, bic, bankName = null, country, address = null, actor }) {
  if (!actor) refuse('a beneficiary is added by somebody');
  if (!clean(name)) refuse('the beneficiary needs a name');
  const ib = iban ? String(iban).replace(/\s+/g, '').toUpperCase() : null;
  if (!ib && !clean(account, 34)) refuse('an IBAN or an account number');
  if (ib && !validIban(ib)) refuse('that IBAN fails its checksum — check every character');
  if (!validBic(bic)) refuse('a BIC is 8 or 11 characters: bank, country, location, optional branch');
  const c = clean(country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) refuse('country is a two-letter ISO code');
  exec('INSERT INTO remit_beneficiary (name, iban, account, bic, bank_name, country, address, created_by) VALUES (?,?,?,?,?,?,?,?)',
    clean(name), ib, ib ? null : clean(account, 34), String(bic).toUpperCase(), clean(bankName) || null, c, clean(address) || null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'remit_beneficiary', entityId: id, action: 'remit.beneficiary_added', actor, detail: { country: c } });
  return one('SELECT * FROM remit_beneficiary WHERE id = ?', id);
}

/** The company bank's BIC, which every message is sent from. Changing it moves where payments originate. */
export function setOrderingBic({ bic, actor }) {
  human(actor, 'setting the company bank’s BIC');
  const b = String(bic || '').trim().toUpperCase();
  if (!validBic(b)) refuse('a BIC is 8 or 11 characters: bank, country, location, optional branch');
  const before = getSetting('REMIT_ORDERING_BIC');
  setSetting('REMIT_ORDERING_BIC', b);
  log({ entity: 'settings', action: 'remit.ordering_bic_set', actor, detail: { before, after: b }, chain: true });
  return { orderingBic: b };
}

export function addWatchName({ name, source = 'internal', actor }) {
  human(actor, 'adding a name to the watchlist');
  if (!clean(name)) refuse('a name, please');
  exec('INSERT INTO remit_watchlist (name, source, added_by) VALUES (?,?,?)', clean(name), clean(source, 40) || 'internal', String(actor));
  log({ entity: 'remit_watchlist', entityId: one('SELECT last_insert_rowid() AS id').id, action: 'remit.watchlisted', actor, chain: true });
  return { ok: true };
}

// --------------------------------------------------------------- messages --

const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const lines35 = (s, n = 4) => (String(s || '').match(/.{1,35}/g) || []).slice(0, n).join('\n');
const swiftAmount = (a) => a.toFixed(2).replace('.', ',');

function mt103({ ref, uetr, valueDate, currency, amount, orderingBic, from, ben, charges, info }) {
  const yymmdd = valueDate.replace(/-/g, '').slice(2);
  return [
    `{1:F01${orderingBic.padEnd(8, 'X').slice(0, 8)}XXXX0000000000}{2:I103${ben.bic.padEnd(11, 'X').slice(0, 8)}XXXXN}{3:{121:${uetr}}}{4:`,
    `:20:${ref.slice(0, 16)}`,
    ':23B:CRED',
    `:32A:${yymmdd}${currency}${swiftAmount(amount)}`,
    `:50K:/${from.iban || ''}`,
    lines35(from.name, 4),
    `:57A:${ben.bic}`,
    `:59:/${ben.iban || ben.account}`,
    lines35([ben.name, ben.address].filter(Boolean).join(' '), 4),
    `:70:${lines35(info || '/RFB/', 4)}`,
    `:71A:${charges}`,
    '-}',
  ].join('\n');
}

function pacs008({ ref, uetr, valueDate, currency, amount, orderingBic, from, ben, charges, info }) {
  const chrg = { OUR: 'DEBT', SHA: 'SHAR', BEN: 'CRED' }[charges];
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr><MsgId>${xml(ref)}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>1</NbOfTxs><SttlmInf><SttlmMtd>INDA</SttlmMtd></SttlmInf></GrpHdr>
    <CdtTrfTxInf>
      <PmtId><InstrId>${xml(ref)}</InstrId><EndToEndId>${xml(ref)}</EndToEndId><UETR>${uetr}</UETR></PmtId>
      <IntrBkSttlmAmt Ccy="${currency}">${amount.toFixed(2)}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${valueDate}</IntrBkSttlmDt>
      <ChrgBr>${chrg}</ChrgBr>
      <Dbtr><Nm>${xml(from.name)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xml(from.iban || '')}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>${xml(orderingBic)}</BICFI></FinInstnId></DbtrAgt>
      <CdtrAgt><FinInstnId><BICFI>${xml(ben.bic)}</BICFI></FinInstnId></CdtrAgt>
      <Cdtr><Nm>${xml(ben.name)}</Nm><PstlAdr><Ctry>${xml(ben.country)}</Ctry></PstlAdr></Cdtr>
      <CdtrAcct><Id>${ben.iban ? `<IBAN>${xml(ben.iban)}</IBAN>` : `<Othr><Id>${xml(ben.account)}</Id></Othr>`}</Id></CdtrAcct>
      <RmtInf><Ustrd>${xml(String(info || '').slice(0, 140))}</Ustrd></RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

/**
 * Build the payment message for an approved external transfer.
 *
 * The ordering bank's BIC comes from the setting REMIT_ORDERING_BIC: the bank
 * account register holds the bank's name, not its BIC, and a guessed BIC is a
 * payment sent to the wrong bank.
 */
export function buildMessage({ transferId, beneficiaryId, format = 'MT103', currency = null, charges = 'SHA', remittanceInfo = '', valueDate = null, orderingBic = null, actor }) {
  if (!actor) refuse('a message is built by somebody');
  if (!['MT103', 'pacs.008'].includes(format)) refuse('MT103 or pacs.008');
  if (!['OUR', 'SHA', 'BEN'].includes(charges)) refuse('charges are OUR, SHA or BEN');
  const t = one('SELECT * FROM bank_transfer WHERE id = ?', Number(transferId));
  if (!t) refuse('no such transfer');
  if (t.to_account_id) refuse('that is an internal transfer — no payment message is needed');
  if (t.state !== 'approved') refuse('only an approved transfer gets a payment message');
  if (one("SELECT id FROM remit_message WHERE transfer_id = ? AND state <> 'cancelled'", t.id)) refuse('this transfer already has a message');
  const ben = one('SELECT * FROM remit_beneficiary WHERE id = ?', Number(beneficiaryId));
  if (!ben) refuse('no such beneficiary');
  const from = one('SELECT * FROM bank_account WHERE id = ?', t.from_account_id);
  const bic = String(orderingBic || getSetting('REMIT_ORDERING_BIC') || '').toUpperCase();
  if (!validBic(bic)) refuse('set REMIT_ORDERING_BIC to the company bank’s BIC first');
  const ccy = String(currency || from.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) refuse('currency is a three-letter ISO code');
  const vd = valueDate || new Date().toISOString().slice(0, 10);
  const uetr = randomUUID();
  const ref = `PAY${String(t.id).padStart(6, '0')}`;
  const args = { ref, uetr, valueDate: vd, currency: ccy, amount: t.amount, orderingBic: bic, from, ben, charges, info: clean(remittanceInfo, 140) };
  const content = format === 'MT103' ? mt103(args) : pacs008(args);
  const hits = screenAll(ben.name);
  const screening = { at: new Date().toISOString(), hits };
  exec(`INSERT INTO remit_message (transfer_id, beneficiary_id, format, uetr, currency, amount, charges, remittance_info, value_date, content, screening, state, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, t.id, ben.id, format, uetr, ccy, t.amount, charges, clean(remittanceInfo, 140) || null, vd, content,
  JSON.stringify(screening), hits.length ? 'held' : 'draft', String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'remit_message', entityId: id, action: hits.length ? 'remit.held_by_screening' : 'remit.built', actor, detail: { format, amount: t.amount, hits: hits.length }, chain: true });
  return getMessage(id);
}

/** A screening hit is cleared by a person who says why it is a different party. */
export function clearHold(id, { note, actor }) {
  human(actor, 'clearing a screening hit');
  const m = one('SELECT * FROM remit_message WHERE id = ?', Number(id));
  if (!m || m.state !== 'held') refuse('only a held message can be cleared');
  if (!clean(note, 500)) refuse('say why the hit is a different party');
  const s = JSON.parse(m.screening);
  exec("UPDATE remit_message SET state = 'draft', screening = ? WHERE id = ?", JSON.stringify({ ...s, clearedBy: actor, clearedNote: clean(note, 500) }), m.id);
  log({ entity: 'remit_message', entityId: m.id, action: 'remit.hold_cleared', actor, detail: { note: clean(note, 200) }, chain: true });
  return getMessage(m.id);
}

/**
 * After the lists change, every message not yet released is screened again.
 * A name that became sanctioned between approval and release is held, approved
 * or not — that window is exactly when a payment should not leave. A hit a
 * person already cleared stays cleared.
 */
export function rescreenOpen() {
  let held = 0;
  for (const m of q("SELECT m.id, m.state, m.screening, b.name FROM remit_message m JOIN remit_beneficiary b ON b.id = m.beneficiary_id WHERE m.state IN ('draft','approved')")) {
    const s = JSON.parse(m.screening);
    const known = new Set((s.hits || []).map((h) => `${h.source}|${h.name}`));
    const fresh = screenAll(m.name).filter((h) => !known.has(`${h.source}|${h.name}`));
    if (!fresh.length) continue;
    exec("UPDATE remit_message SET state = 'held', approved_by = NULL, screening = ? WHERE id = ?",
      JSON.stringify({ ...s, hits: [...(s.hits || []), ...fresh], rescreenedAt: new Date().toISOString(), clearedBy: undefined, clearedNote: undefined }), m.id);
    log({ entity: 'remit_message', entityId: m.id, action: 'remit.held_by_rescreen', actor: 'system:remit', detail: { was: m.state, hits: fresh.length }, chain: true });
    held++;
  }
  return { held };
}

/** Four eyes: whoever built the message does not approve it. */
export function approveMessage(id, { actor }) {
  human(actor, 'approving a payment message');
  const m = one('SELECT * FROM remit_message WHERE id = ?', Number(id));
  if (!m) refuse('no such message');
  if (m.state === 'held') refuse('a screening hit holds this message — clear it first');
  if (m.state !== 'draft') refuse(`this message is ${m.state}`);
  if (m.created_by === String(actor)) refuse('four eyes: the person who built the message does not approve it');
  exec("UPDATE remit_message SET state = 'approved', approved_by = ? WHERE id = ?", String(actor), m.id);
  log({ entity: 'remit_message', entityId: m.id, action: 'remit.approved', actor, chain: true });
  return getMessage(m.id);
}

/** Release produces the file for the bank. It transmits nothing. */
export function releaseMessage(id, { actor }) {
  human(actor, 'releasing a payment');
  const m = one('SELECT * FROM remit_message WHERE id = ?', Number(id));
  if (!m || m.state !== 'approved') refuse('only an approved message can be released');
  exec("UPDATE remit_message SET state = 'released', released_by = ?, released_at = datetime('now') WHERE id = ?", String(actor), m.id);
  log({ entity: 'remit_message', entityId: m.id, action: 'remit.released', actor, detail: { uetr: m.uetr, amount: m.amount, format: m.format }, chain: true });
  return { ...getMessage(m.id), file: { name: `${m.format === 'MT103' ? 'mt103' : 'pacs008'}-${m.uetr}.${m.format === 'MT103' ? 'txt' : 'xml'}`, content: m.content } };
}

export function cancelMessage(id, { actor }) {
  human(actor, 'cancelling a payment message');
  const m = one('SELECT * FROM remit_message WHERE id = ?', Number(id));
  if (!m || ['released', 'cancelled'].includes(m.state)) refuse('that message cannot be cancelled');
  exec("UPDATE remit_message SET state = 'cancelled' WHERE id = ?", m.id);
  log({ entity: 'remit_message', entityId: m.id, action: 'remit.cancelled', actor, chain: true });
  return getMessage(m.id);
}

export function getMessage(id) {
  const m = one('SELECT m.*, b.name AS beneficiary, b.bic, b.country FROM remit_message m JOIN remit_beneficiary b ON b.id = m.beneficiary_id WHERE m.id = ?', Number(id));
  if (!m) refuse('no such message');
  return { ...m, screening: JSON.parse(m.screening) };
}

export function remitOverview() {
  return {
    orderingBic: getSetting('REMIT_ORDERING_BIC') || null,
    beneficiaries: q('SELECT * FROM remit_beneficiary ORDER BY id DESC LIMIT 100'),
    readyTransfers: q(`SELECT t.id, t.amount, t.beneficiary, a.name AS from_name, a.currency FROM bank_transfer t JOIN bank_account a ON a.id = t.from_account_id
                       WHERE t.state = 'approved' AND t.to_account_id IS NULL AND NOT EXISTS (SELECT 1 FROM remit_message m WHERE m.transfer_id = t.id AND m.state <> 'cancelled')`),
    messages: q('SELECT m.id, m.format, m.uetr, m.currency, m.amount, m.charges, m.state, m.value_date, m.created_by, m.approved_by, m.released_at, b.name AS beneficiary, b.country FROM remit_message m JOIN remit_beneficiary b ON b.id = m.beneficiary_id ORDER BY m.id DESC LIMIT 60'),
    watchlist: q('SELECT * FROM remit_watchlist ORDER BY id DESC LIMIT 100'),
    byState: Object.fromEntries(q('SELECT state, COUNT(*) AS n FROM remit_message GROUP BY state').map((r) => [r.state, r.n])),
  };
}
