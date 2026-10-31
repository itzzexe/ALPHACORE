// THE PORTAL — a customer's or a supplier's own door into the company.
//
// A person issues a link for one customer or one supplier; the link carries a
// long random token, kept here only as its hash, good for thirty days and
// revocable at once. Behind it the visitor sees their own invoices or bills
// and their messages, writes to the company, and uploads documents — a
// supplier's invoice goes straight into paper intake, a customer's KYC papers
// to AML. Every query is scoped to that one party: there is no listing,
// searching or guessing beyond it.
//
// It has no account, no password and no permissions in the console, and its
// own small API (/portal-api) that the console's permission table never sees.
// The token travels in the link's fragment and then in a header, never in a
// query string a log would keep.
import { randomBytes, createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { saveUpload } from './uploads.js';
import { createItem } from './intake.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const isHuman = (a) => String(a || '').startsWith('human:');
const days = () => { const n = Number(getSetting('PORTAL_LINK_DAYS')); return Number.isInteger(n) && n > 0 && n <= 365 ? n : 30; };

/** The party a link is for, as the register knows it. */
function party(kind, partyId) {
  if (kind === 'customer') return one('SELECT id, name FROM customers WHERE id = ?', Number(partyId));
  if (kind === 'supplier') return one('SELECT id, name FROM vendors WHERE id = ?', String(partyId));
  return null;
}

/** Issue a link. The token is shown once, here, and stored only as its hash. */
export function issueLink({ kind, partyId, actor }) {
  if (!isHuman(actor)) refuse('a person issues a portal link', 403);
  if (!['customer', 'supplier'].includes(kind)) refuse('customer or supplier');
  const p = party(kind, partyId);
  if (!p) refuse(`no such ${kind}`, 404);
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + days() * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
  const r = exec('INSERT INTO portal_accounts (kind, party_id, name, token_hash, expires_at, created_by) VALUES (?,?,?,?,?,?)',
    kind, String(p.id), p.name, sha(token), expires, actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'portal.link_issued', subjectType: 'portal_account', subjectId: id, payload: { kind, party: String(p.id), days: days() } });
  const base = String(getSetting('PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
  return { id, name: p.name, expires, link: `${base}/portal.html#t=${token}`, note: 'Shown once. Send it to them yourself, by a channel you trust.' };
}

export function revoke({ id, actor }) {
  if (!isHuman(actor)) refuse('a person revokes a link', 403);
  const r = exec("UPDATE portal_accounts SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL", Number(id));
  if (!r.changes) refuse('no such live link', 404);
  audit({ actorType: 'human', actorId: actor, action: 'portal.link_revoked', subjectType: 'portal_account', subjectId: Number(id) });
  return { ok: true };
}

// ------------------------------------------------------------ the door --

const hits = new Map();
/** A hundred and twenty requests a minute per link: enough for a person, too few for a script. */
function throttle(key) {
  const now = Date.now();
  const h = hits.get(key) || { start: now, n: 0 };
  if (now - h.start > 60_000) { h.start = now; h.n = 0; }
  h.n += 1;
  hits.set(key, h);
  if (h.n > 120) refuse('too many requests — wait a minute', 429);
}

export function authenticate(token) {
  if (!token || String(token).length < 20) return null;
  const a = one("SELECT * FROM portal_accounts WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')", sha(token));
  if (!a) return null;
  throttle(a.token_hash);
  if (!a.last_seen || a.last_seen < new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19)) {
    exec("UPDATE portal_accounts SET last_seen = datetime('now') WHERE id = ?", a.id);
  }
  return a;
}

const visitor = (a) => `portal:${a.id}`;

function invoices(a) {
  if (a.kind === 'customer') {
    return q("SELECT ref, description, amount + tax AS total, currency, issued, due, state, paid_amount FROM fin_ar_invoice WHERE customer_id = ? AND state IN ('issued','paid') ORDER BY id DESC LIMIT 100", Number(a.party_id));
  }
  return q("SELECT ref, amount + tax AS total, currency, issued, due, state FROM fin_ap_bill WHERE vendor_id = ? AND state <> 'void' ORDER BY id DESC LIMIT 100", a.party_id);
}

/** The portal's whole API: a method, a path, a body, and the account the token named. */
export function handle(a, method, path, body = {}) {
  if (method === 'GET' && path === '/me') {
    return { name: a.name, kind: a.kind, company: getSetting('COMPANY_NAME') || '', expires: a.expires_at, payInstructions: a.kind === 'customer' ? (getSetting('PORTAL_PAY_INSTRUCTIONS') || null) : null };
  }
  if (method === 'GET' && path === '/invoices') return { items: invoices(a) };
  if (method === 'GET' && path === '/messages') {
    return { items: q('SELECT m.id, m.direction, m.subject, m.body, m.purpose, m.created_at, u.name AS file FROM portal_messages m LEFT JOIN uploads u ON u.id = m.upload_id WHERE m.account_id = ? ORDER BY m.id DESC LIMIT 100', a.id) };
  }
  if (method === 'POST' && path === '/message') {
    const text = String(body.body || '').trim();
    if (!text) refuse('write something');
    exec('INSERT INTO portal_messages (account_id, direction, subject, body, created_by) VALUES (?,?,?,?,?)', a.id, 'in', String(body.subject || '').slice(0, 200) || null, text.slice(0, 5000), visitor(a));
    audit({ actorType: 'external', actorId: visitor(a), action: 'portal.message', subjectType: 'portal_account', subjectId: a.id });
    notify({ level: 'info', source: 'portal', message: `${a.name} wrote through the portal`, subjectType: 'portal_account', subjectId: a.id });
    return { ok: true };
  }
  if (method === 'POST' && path === '/upload') {
    const purpose = ['invoice', 'kyc', 'other'].includes(body.purpose) ? body.purpose : 'other';
    if (purpose === 'invoice' && a.kind !== 'supplier') refuse('invoices are uploaded by suppliers');
    const up = saveUpload({ purpose: 'portal', name: body.name, mime: body.mime, data: body.data, actor: visitor(a) });
    exec('INSERT INTO portal_messages (account_id, direction, subject, body, upload_id, purpose, created_by) VALUES (?,?,?,?,?,?,?)',
      a.id, 'in', String(body.subject || up.name).slice(0, 200), String(body.note || '').slice(0, 2000) || '(file)', up.id, purpose, visitor(a));
    // A supplier's invoice is read like any other paper; KYC papers wait for AML.
    if (purpose === 'invoice') createItem({ kind: 'invoice', uploadId: up.id, source: 'portal', actor: visitor(a) });
    audit({ actorType: 'external', actorId: visitor(a), action: 'portal.upload', subjectType: 'portal_account', subjectId: a.id, payload: { purpose, bytes: up.bytes, sha256: up.sha256 } });
    notify({ level: 'info', source: 'portal', message: `${a.name} uploaded ${purpose === 'kyc' ? 'identity documents' : purpose === 'invoice' ? 'an invoice' : 'a file'}`, subjectType: 'portal_account', subjectId: a.id });
    return { ok: true, id: up.id };
  }
  refuse('not found', 404);
}

/** A person answers in the portal; it shows there, and nothing else is sent. */
export function reply({ accountId, body, actor }) {
  if (!isHuman(actor)) refuse('a person replies', 403);
  const a = one('SELECT * FROM portal_accounts WHERE id = ?', Number(accountId));
  if (!a) refuse('no such portal account', 404);
  if (!String(body || '').trim()) refuse('write something');
  exec('INSERT INTO portal_messages (account_id, direction, body, created_by) VALUES (?,?,?,?)', a.id, 'out', String(body).slice(0, 5000), actor);
  audit({ actorType: 'human', actorId: actor, action: 'portal.reply', subjectType: 'portal_account', subjectId: a.id });
  return thread(a.id);
}

export function thread(accountId) {
  const a = one('SELECT id, kind, party_id, name, expires_at, revoked_at, last_seen, created_by, created_at FROM portal_accounts WHERE id = ?', Number(accountId));
  if (!a) refuse('no such portal account', 404);
  return { ...a, messages: q('SELECT m.*, u.name AS file, u.mime, u.bytes FROM portal_messages m LEFT JOIN uploads u ON u.id = m.upload_id WHERE m.account_id = ? ORDER BY m.id', a.id) };
}

export function overview() {
  return {
    accounts: q(`SELECT a.id, a.kind, a.party_id, a.name, a.expires_at, a.revoked_at, a.last_seen, a.created_at,
        (SELECT COUNT(*) FROM portal_messages m WHERE m.account_id = a.id AND m.direction = 'in') AS received,
        (SELECT MAX(created_at) FROM portal_messages m WHERE m.account_id = a.id AND m.direction = 'in') AS last_in
      FROM portal_accounts a ORDER BY a.id DESC LIMIT 200`),
    customers: q('SELECT id, name FROM customers ORDER BY name LIMIT 500'),
    suppliers: q('SELECT id, name FROM vendors ORDER BY name LIMIT 500'),
    publicUrl: getSetting('PUBLIC_BASE_URL') || null,
  };
}
