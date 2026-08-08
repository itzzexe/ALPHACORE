// Webhooks out — the company telling other software what just happened.
//
// The audit chain is already the event source: anything worth telling anyone
// about was written there first, in order, with a sequence number. So a webhook
// is a filter over the chain plus a delivery attempt, and it inherits the one
// property that matters — it can never announce an event that did not happen.
//
// Delivery goes on the job queue, so a receiver that is down costs a retry
// rather than a lost event, and every body is signed the same way Twilio signs
// its callbacks to us: the receiver can prove it came from here.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { putSecret, getSecret } from './vault.js';
import { enqueue, handle } from './jobs.js';

let lastSeq = 0;

const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

/** `run.*` matches `run.done`; `*` matches everything. */
const matchesEvent = (patterns, action) => patterns.some((p) => {
  if (p === '*') return true;
  if (p.endsWith('.*')) return action.startsWith(p.slice(0, -1));
  return p === action;
});

export function addWebhook({ url, events = ['*'], actor }) {
  if (!/^https:\/\//i.test(url)) throw new Error('a webhook target must be https');
  const secretName = `WEBHOOK_${randomBytes(6).toString('hex').toUpperCase()}`;
  const secret = randomBytes(32).toString('base64url');
  putSecret(secretName, secret, { kind: 'webhook', note: `signs deliveries to ${url}`, actor });
  const r = exec(
    'INSERT INTO webhooks (url, events, secret_name, created_by) VALUES (?,?,?,?)',
    url, JSON.stringify(events), secretName, actor,
  );
  audit({ actorType: 'human', actorId: actor, action: 'webhook.added', subjectType: 'webhook', subjectId: Number(r.lastInsertRowid), payload: { url, events } });
  // The signing secret is shown once, to the person setting up the receiver.
  return { id: Number(r.lastInsertRowid), url, events, secret, note: 'store this — it verifies our signature and is not shown again' };
}

export function setWebhookState(id, state, { actor }) {
  if (!['active', 'paused'].includes(state)) throw new Error('a webhook is active or paused');
  exec('UPDATE webhooks SET state = ?, failures = 0 WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: 'webhook.state', subjectType: 'webhook', subjectId: id, payload: { state } });
  return { ok: true };
}

export function removeWebhook(id, { actor }) {
  exec('DELETE FROM webhooks WHERE id = ?', id);
  audit({ actorType: 'human', actorId: actor, action: 'webhook.removed', subjectType: 'webhook', subjectId: id });
  return { ok: true };
}

/** The signature a receiver checks: timestamp + body under the shared secret. */
export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Offered so a receiver written against this file can be tested honestly. */
export function verify({ secret, timestamp, body, signature, toleranceSeconds = 300 }) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = sign(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

handle('webhook.deliver', async ({ deliveryId }) => {
  const d = one('SELECT * FROM webhook_deliveries WHERE id = ?', deliveryId);
  if (!d) return {};
  const w = one('SELECT * FROM webhooks WHERE id = ?', d.webhook_id);
  if (!w || w.state !== 'active') return {};
  const secret = getSecret(w.secret_name);
  if (!secret) throw new Error('the signing secret for this webhook is missing');

  const body = d.payload || '{}';
  const ts = Math.floor(Date.now() / 1000);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(w.url, {
      method: 'POST', signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-alphacore-event': d.event,
        'x-alphacore-timestamp': String(ts),
        'x-alphacore-signature': sign(secret, ts, body),
      },
      body,
    });
    exec('UPDATE webhook_deliveries SET status = ?, attempts = attempts + 1, error = NULL WHERE id = ?', res.status, deliveryId);
    if (!res.ok) throw new Error(`receiver answered ${res.status}`);
    exec("UPDATE webhooks SET last_fired = datetime('now'), failures = 0 WHERE id = ?", w.id);
    return {};
  } catch (err) {
    const msg = String(err.message).slice(0, 300);
    exec('UPDATE webhook_deliveries SET attempts = attempts + 1, error = ? WHERE id = ?', msg, deliveryId);
    exec('UPDATE webhooks SET failures = failures + 1 WHERE id = ?', w.id);
    // A receiver that has been dead for twenty consecutive events is paused
    // rather than retried forever — and the pause is on the chain, so it is
    // visible rather than mysterious.
    const failures = one('SELECT failures FROM webhooks WHERE id = ?', w.id).failures;
    if (failures >= 20) {
      exec("UPDATE webhooks SET state = 'paused' WHERE id = ?", w.id);
      audit({ actorType: 'system', actorId: 'system:webhooks', action: 'webhook.paused', subjectType: 'webhook', subjectId: w.id, payload: { url: w.url, failures } });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
});

/** Read forward from the chain and queue whatever anybody subscribed to. */
export function webhookTick() {
  const hooks = q("SELECT * FROM webhooks WHERE state = 'active'").map((w) => ({ ...w, events: parse(w.events, ['*']) }));
  if (!hooks.length) {
    lastSeq = one('SELECT seq FROM audit_log ORDER BY seq DESC LIMIT 1')?.seq || lastSeq;
    return 0;
  }
  const rows = q(
    'SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id, payload FROM audit_log WHERE seq > ? ORDER BY seq ASC LIMIT 50',
    lastSeq,
  );
  if (!rows.length) return 0;
  lastSeq = rows[rows.length - 1].seq;

  let queued = 0;
  for (const row of rows) {
    for (const w of hooks) {
      if (!matchesEvent(w.events, row.action)) continue;
      const body = JSON.stringify({
        event: row.action,
        seq: row.seq,
        at: row.occurred_at,
        actor: { type: row.actor_type, id: row.actor_id },
        subject: row.subject_type ? { type: row.subject_type, id: row.subject_id } : null,
        data: parse(row.payload, null),
      });
      const d = exec('INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES (?,?,?)', w.id, row.action, body);
      enqueue('webhook.deliver', { deliveryId: Number(d.lastInsertRowid) }, { idempotency: `wh:${w.id}:${row.seq}` });
      queued++;
    }
  }
  return queued;
}

export function webhooksOverview() {
  return {
    webhooks: q('SELECT id, url, events, state, last_fired, failures, created_by, created_at FROM webhooks ORDER BY id DESC')
      .map((w) => ({ ...w, events: parse(w.events, []) })),
    counts: {
      active: one("SELECT COUNT(*) AS n FROM webhooks WHERE state = 'active'").n,
      paused: one("SELECT COUNT(*) AS n FROM webhooks WHERE state = 'paused'").n,
      deliveredToday: one("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE created_at >= date('now') AND status BETWEEN 200 AND 299").n,
      failing: one('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE error IS NOT NULL').n,
    },
    recent: q(`SELECT d.id, d.event, d.status, d.attempts, d.error, d.created_at, w.url
               FROM webhook_deliveries d LEFT JOIN webhooks w ON w.id = d.webhook_id
               ORDER BY d.id DESC LIMIT 30`),
    // Anything on the chain can be subscribed to; these are simply the ones
    // people ask for most.
    commonEvents: q("SELECT action, COUNT(*) AS n FROM audit_log WHERE occurred_at >= datetime('now','-7 days') GROUP BY action ORDER BY n DESC LIMIT 20"),
  };
}
