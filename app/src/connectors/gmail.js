// Gmail — the company's mailbox.
//
// Reading is how work arrives: a message becomes a request on the desk. Sending
// is how work leaves, and it is the single most dangerous capability in this
// repository, because an employee that reads a hostile email and can then send
// one has been handed a mouth. Every send goes through the gate, the domain
// constraint on the scope decides who can be written to at all, and bulk sends
// are a separate capability the constitution refuses outright.
import { wire, b64url, need } from './wire.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const headersOf = (msg) => Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));

/** Gmail nests bodies; this pulls out the readable part without a library. */
function bodyText(payload) {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf8');
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  for (const part of payload.parts || []) {
    const nested = bodyText(part);
    if (nested) return nested;
  }
  return '';
}

function rfc822({ to, subject, body, from = 'me', cc = null, replyTo = null }) {
  const lines = [
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    cc ? `Cc: ${cc}` : null,
    replyTo ? `In-Reply-To: ${replyTo}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].filter(Boolean);
  return b64url(lines.join('\r\n'));
}

export default {
  id: 'gmail',
  label: 'Gmail',
  docs: 'https://developers.google.com/gmail/api',
  auth: { kind: 'oauth2', provider: 'google', scopes: ['https://www.googleapis.com/auth/gmail.modify'] },
  capabilities: ['mail.read', 'mail.send', 'mail.draft', 'mail.label', 'mail.bulk'],
  quotaDay: 400,
  ops: {
    'mail.read': {
      async run({ query = 'is:unread', max = 10 }, ctx) {
        const token = need(ctx, 'access token');
        const list = await wire(`${API}/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(50, max)}`, {
          headers: { authorization: `Bearer ${token}` }, service: 'gmail',
        });
        const out = [];
        for (const m of list.messages || []) {
          const full = await wire(`${API}/messages/${m.id}?format=full`, { headers: { authorization: `Bearer ${token}` }, service: 'gmail' });
          const h = headersOf(full);
          out.push({
            id: full.id, threadId: full.threadId,
            from: h.from, to: h.to, subject: h.subject, date: h.date,
            snippet: full.snippet,
            // Fetched text is data, never instruction — the constitution says so
            // and the auditor checks it. It is stored, not obeyed.
            body: bodyText(full.payload).slice(0, 8000),
          });
        }
        return { count: out.length, messages: out };
      },
    },
    'mail.send': {
      target: (a) => (Array.isArray(a.to) ? a.to[0] : a.to),
      async run({ to, subject, body, cc = null, replyTo = null }, ctx) {
        const token = need(ctx, 'access token');
        if (!to || !subject) throw new Error('a message needs a recipient and a subject');
        const raw = rfc822({ to, subject, body: body || '', cc, replyTo });
        const sent = await wire(`${API}/messages/send`, {
          method: 'POST', headers: { authorization: `Bearer ${token}` },
          body: { raw }, service: 'gmail',
        });
        return { id: sent.id, threadId: sent.threadId, to, subject };
      },
    },
    'mail.draft': {
      target: (a) => (Array.isArray(a.to) ? a.to[0] : a.to),
      async run({ to, subject, body }, ctx) {
        const token = need(ctx, 'access token');
        const draft = await wire(`${API}/drafts`, {
          method: 'POST', headers: { authorization: `Bearer ${token}` },
          body: { message: { raw: rfc822({ to, subject, body: body || '' }) } }, service: 'gmail',
        });
        return { draftId: draft.id, to, subject };
      },
    },
    'mail.label': {
      async run({ id, add = [], remove = [] }, ctx) {
        const token = need(ctx, 'access token');
        return wire(`${API}/messages/${id}/modify`, {
          method: 'POST', headers: { authorization: `Bearer ${token}` },
          body: { addLabelIds: add, removeLabelIds: remove }, service: 'gmail',
        });
      },
    },
    'mail.bulk': {
      target: () => 'bulk',
      // Deliberately present and deliberately unreachable: the constitution
      // refuses it, so an attempt is recorded and refused rather than silently
      // impossible. A capability nobody can see is a capability nobody audits.
      async run() { throw new Error('bulk mail is refused by the constitution (no-unrequested-bulk)'); },
    },
  },
};
