// WHATSAPP — the channel customers here actually use, with a person on every
// message that leaves.
//
// What arrives comes through the webhook, signed by WhatsApp with the app
// secret; an unsigned or wrongly signed delivery is refused, because anyone
// can post to a public address. Each message lands in an inbox by sender. The
// support employee drafts a reply from the conversation and the company's own
// documents; a person reads it, edits it and sends it.
//
// WhatsApp's own rule is enforced before WhatsApp would refuse: inside the
// twenty-four hours after the customer last wrote, a free reply; outside it,
// only a template approved in advance, from the list the company keeps.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { getSecret as vaultSecret } from './vault.js';
import { callConnector } from './connectors/index.js';
import { requestDraft, draftsFor } from './drafts.js';
import { companyContext } from './context.js';
import { notify } from './notify.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const WINDOW_HOURS = 24;
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ------------------------------------------------------------- webhook --

/** WhatsApp's subscription handshake: answer the challenge only for our own verify token. */
export function verifyWebhook(params) {
  const want = getSetting('WHATSAPP_VERIFY_TOKEN');
  if (want && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === want) return params.get('hub.challenge');
  return null;
}

/** X-Hub-Signature-256 is the HMAC of the raw body under the app secret. */
export function signatureValid(raw, header) {
  let secret;
  try { secret = vaultSecret('WHATSAPP_APP_SECRET'); } catch { secret = null; }
  secret = secret || process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const got = Buffer.from(String(header));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A delivery from WhatsApp: messages in, and statuses of what we sent. Idempotent — WhatsApp retries. */
export function ingest(payload) {
  let received = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = new Map((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
      for (const m of v.messages || []) {
        const waId = String(m.from || '').replace(/\D/g, '');
        if (!waId) continue;
        const body = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : `[${m.type}]`;
        const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 19) : sqlNow();
        exec(`INSERT INTO wa_contacts (wa_id, name, last_inbound_at) VALUES (?,?,?)
              ON CONFLICT(wa_id) DO UPDATE SET name = COALESCE(excluded.name, name), last_inbound_at = MAX(COALESCE(last_inbound_at, ''), excluded.last_inbound_at)`,
        waId, names.get(m.from) || null, at);
        const r = exec('INSERT OR IGNORE INTO wa_messages (wa_id, direction, kind, body, wa_message_id, created_at) VALUES (?,?,?,?,?,?)',
          waId, 'in', m.type === 'text' ? 'text' : 'media', String(body || '').slice(0, 4096), m.id || null, at);
        if (r.changes) {
          received++;
          notify({ level: 'info', source: 'whatsapp', message: `WhatsApp from ${names.get(m.from) || waId}`, subjectType: 'wa_contact', subjectId: waId });
        }
      }
      for (const s of v.statuses || []) exec('UPDATE wa_messages SET status = ? WHERE wa_message_id = ?', String(s.status || ''), String(s.id || ''));
    }
  }
  return { received };
}

// --------------------------------------------------------------- inbox --

export const windowOpen = (c) => Boolean(c?.last_inbound_at) && (Date.now() - new Date(`${c.last_inbound_at.replace(' ', 'T')}Z`).getTime()) < WINDOW_HOURS * 3600e3;

export function templates() {
  try { return JSON.parse(getSetting('WHATSAPP_TEMPLATES') || '[]').filter((t) => t && /^[a-z0-9_]{1,512}$/.test(t.name)); } catch { return []; }
}

export function thread(waId) {
  const c = one('SELECT * FROM wa_contacts WHERE wa_id = ?', String(waId));
  if (!c) refuse('no such conversation', 404);
  return { ...c, windowOpen: windowOpen(c), messages: q('SELECT * FROM wa_messages WHERE wa_id = ? ORDER BY id DESC LIMIT 100', c.wa_id).reverse(), drafts: draftsFor('whatsapp', 'wa_contact', c.wa_id, 2) };
}

/** The support employee drafts an answer from the conversation and the company's own rules. */
export function draftReply({ waId, actor }) {
  const t = thread(waId);
  const convo = t.messages.slice(-12).map((m) => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.body}`).join('\n');
  return requestDraft({
    dept: 'whatsapp', subjectType: 'wa_contact', subjectId: t.wa_id, kind: 'whatsapp-reply', agentId: 'AGT-SUP-001', actor, urgent: true,
    exclude: null,
    brief: `A WhatsApp reply to ${t.name || 'a customer'}. Short, courteous, in the customer's language; promise nothing the documents below do not support, and say a colleague will confirm anything you are unsure of.\n${companyContext(convo)}\n\nConversation:\n${convo}`,
  });
}

async function record(waId, kind, body, r, actor) {
  exec('INSERT INTO wa_messages (wa_id, direction, kind, body, wa_message_id, status, created_by) VALUES (?,?,?,?,?,?,?)',
    waId, 'out', kind, body, r.result?.messageId || null, r.verdict === 'allowed' ? 'sent' : r.verdict, actor);
  audit({ actorType: 'human', actorId: actor, action: `whatsapp.${kind === 'template' ? 'template_sent' : 'sent'}`, subjectType: 'wa_contact', subjectId: waId, payload: { verdict: r.verdict } });
  return { verdict: r.verdict, why: r.why || null, thread: thread(waId) };
}

/** A person sends a reply — free text only while the customer's window is open. */
export async function send({ waId, text, user }) {
  if (!user) refuse('a person sends', 403);
  const t = thread(waId);
  const body = String(text || '').trim();
  if (!body) refuse('nothing to send');
  if (!t.windowOpen) refuse('more than 24 hours since the customer last wrote — WhatsApp allows only an approved template now');
  const actor = `human:${user.username}`;
  const r = await callConnector({ connector: 'whatsapp', capability: 'message.send', args: { to: t.wa_id, text: body.slice(0, 4096) }, actor, reason: 'reply to a customer' });
  return record(t.wa_id, 'text', body.slice(0, 4096), r, actor);
}

/** A person sends an approved template, with its blanks filled. Allowed at any time. */
export async function sendTemplate({ waId, name, params = [], user }) {
  if (!user) refuse('a person sends', 403);
  const t = thread(waId);
  const tpl = templates().find((x) => x.name === name);
  if (!tpl) refuse('that template is not on the approved list');
  const values = (Array.isArray(params) ? params : []).map((p) => String(p ?? '').trim());
  if (values.length !== Number(tpl.params || 0) || values.some((v) => !v)) refuse(`this template takes ${tpl.params || 0} value(s)`);
  const actor = `human:${user.username}`;
  const r = await callConnector({ connector: 'whatsapp', capability: 'template.send', args: { to: t.wa_id, name: tpl.name, lang: tpl.lang || 'ar', params: values }, actor, reason: `template ${tpl.name}` });
  const preview = String(tpl.preview || tpl.name).replace(/\{\{(\d+)\}\}/g, (_m, i) => values[Number(i) - 1] ?? '');
  return record(t.wa_id, 'template', preview, r, actor);
}

export function linkCustomer({ waId, customerId, user }) {
  if (!user) refuse('a person links', 403);
  if (customerId != null && !one('SELECT id FROM customers WHERE id = ?', Number(customerId))) refuse('no such customer');
  exec('UPDATE wa_contacts SET customer_id = ? WHERE wa_id = ?', customerId == null ? null : Number(customerId), String(waId));
  return thread(waId);
}

export function overview() {
  const contacts = q(`SELECT c.*, (SELECT body FROM wa_messages m WHERE m.wa_id = c.wa_id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM wa_messages m WHERE m.wa_id = c.wa_id ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT direction FROM wa_messages m WHERE m.wa_id = c.wa_id ORDER BY m.id DESC LIMIT 1) AS last_direction
    FROM wa_contacts c ORDER BY last_at DESC LIMIT 200`).map((c) => ({ ...c, windowOpen: windowOpen(c), waiting: c.last_direction === 'in' }));
  return {
    contacts,
    waiting: contacts.filter((c) => c.waiting).length,
    connected: one("SELECT state FROM connectors WHERE id = 'whatsapp'")?.state || 'disconnected',
    templates: templates(),
    webhookReady: Boolean(getSetting('WHATSAPP_VERIFY_TOKEN')),
  };
}
