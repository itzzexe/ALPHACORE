// Contact centre — the company on the phone.
//
// Outbound: an AI employee writes the call in the customer's language, a voice
// speaks it, the result is dispositioned and lands back in the CRM.
// Inbound: a call or a message arrives on the company number, an employee
// answers it, and the thread stays attached to whoever it belongs to.
//
// Two honest notes about what this is:
//   • Real telephony needs a carrier. With Twilio credentials in Settings this
//     places actual calls and sends actual SMS/WhatsApp. Without them it runs
//     in simulated mode — the whole flow works, nothing dials.
//   • Nobody can conjure a phone number. You register a number you own (or
//     buy one from the carrier); simulated numbers are labelled as such and
//     can never reach a real handset.
import crypto from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { getSecret, getSetting } from './settings.js';

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const clean = (s) => String(s || '').trim();
const E164 = /^\+[1-9]\d{6,15}$/;

/** The voice roster. Names map to real carrier voices; Arabic included. */
export const VOICES = {
  ava: { label: 'Ava — warm, English', language: 'en-US', twilio: 'Polly.Joanna-Neural', gender: 'female' },
  ethan: { label: 'Ethan — steady, English', language: 'en-US', twilio: 'Polly.Matthew-Neural', gender: 'male' },
  amelia: { label: 'Amelia — British, English', language: 'en-GB', twilio: 'Polly.Amy-Neural', gender: 'female' },
  hala: { label: 'هالة — Gulf Arabic', language: 'ar-AE', twilio: 'Polly.Hala-Neural', gender: 'female' },
  zeina: { label: 'زينة — Modern Standard Arabic', language: 'arb', twilio: 'Polly.Zeina', gender: 'female' },
  zayd: { label: 'زيد — Gulf Arabic, male', language: 'ar-AE', twilio: 'Polly.Zayd-Neural', gender: 'male' },
  lucia: { label: 'Lucía — Spanish', language: 'es-ES', twilio: 'Polly.Lucia-Neural', gender: 'female' },
};

export const isSimulated = () => !getSecret('TWILIO_ACCOUNT_SID') || !getSecret('TWILIO_AUTH_TOKEN')
  || String(getSetting('COMMS_MODE') || 'simulated') !== 'live';

// ---------- numbers ----------
export function addNumber({ number, label, provider = null, country = null, actor }) {
  const num = clean(number);
  if (!E164.test(num)) throw new Error('use E.164 format, e.g. +9647701234567');
  const p = provider || (isSimulated() ? 'simulated' : 'twilio');
  exec('INSERT INTO phone_numbers (number, label, provider, country, created_by) VALUES (?,?,?,?,?)',
    num, clean(label) || num, p, country, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'comms.number_added', subjectType: 'number', subjectId: id, payload: { number: num, provider: p } });
  return id;
}

export const mainNumber = () => one("SELECT * FROM phone_numbers WHERE state = 'active' ORDER BY id LIMIT 1");

// ---------- the carrier ----------
async function twilio(path, params) {
  const sid = getSecret('TWILIO_ACCOUNT_SID');
  const token = getSecret('TWILIO_AUTH_TOKEN');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.message || `carrier returned ${r.status}`);
  return body;
}

/** Twilio signs its webhooks; an unsigned request is not from the carrier. */
export function verifyWebhook(url, params, signature) {
  const token = getSecret('TWILIO_AUTH_TOKEN');
  if (!token) return isSimulated(); // simulated mode accepts local test posts
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || '')));
  } catch { return false; }
}

const escXml = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** What the carrier is told to say when a call connects. */
export function twiml(call) {
  const v = VOICES[call.voice] || VOICES.ava;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${v.twilio}" language="${v.language}">${escXml(call.script || 'Hello. Thank you for taking our call.')}</Say>
  <Record maxLength="120" transcribe="true" transcribeCallback="/webhooks/voice/transcript?call=${call.id}"/>
</Response>`;
}

// ---------- outbound calls ----------
export function scheduleCall({ toNumber, purpose, customerId = null, agentId = null, voice = 'ava', language = 'en', actor }) {
  const to = clean(toNumber);
  if (!E164.test(to)) throw new Error('destination must be E.164, e.g. +9647701234567');
  if (!VOICES[voice]) throw new Error(`voice must be one of: ${Object.keys(VOICES).join(', ')}`);
  const from = mainNumber();
  if (!from) throw new Error('register a company number first');
  const worker = agentId || one("SELECT id FROM agents WHERE status='active' AND role_group='run' ORDER BY id LIMIT 1")?.id
    || one("SELECT id FROM agents WHERE status='active' ORDER BY id LIMIT 1")?.id;
  const cust = customerId ? one('SELECT name, notes FROM customers WHERE id = ?', customerId) : null;
  // The employee writes the call before anyone dials: a script that reads badly
  // on paper reads worse out loud.
  const runId = worker ? enqueueRun({
    agentId: worker,
    taskType: `call:${to}`,
    input: {
      prompt: `Write what to say on a phone call.
Purpose: ${purpose}
${cust ? `The person: ${cust.name}${cust.notes ? ` — ${cust.notes}` : ''}` : 'The person is not a known customer.'}
Language: ${language === 'ar' ? 'Arabic' : language}
It will be spoken aloud by a synthetic voice, so: short sentences, no bullet points, no markdown, under 90 words, and open by saying who is calling and why. End with one clear question.
Reply as JSON {"text": "<the spoken script>"}.`,
    },
    actor,
  }) : null;
  exec(`INSERT INTO calls (direction, from_number, to_number, customer_id, agent_id, voice, language, purpose, state, run_id, created_by)
        VALUES ('out',?,?,?,?,?,?,?, 'drafting', ?, ?)`,
    from.number, to, customerId, worker, voice, language, clean(purpose), runId, actor);
  const id = lastId();
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'call.scheduled', subjectType: 'call', subjectId: id, payload: { to, voice, purpose } });
  return id;
}

/** Place the call once its script exists. Simulated mode never dials. */
export async function placeCall(id, { actor }) {
  const c = one('SELECT * FROM calls WHERE id = ?', id);
  if (!c) throw new Error('no such call');
  if (!c.script) throw new Error('the script is still being written');
  if (c.state === 'live' || c.state === 'completed') throw new Error('that call already went out');
  if (isSimulated()) {
    exec("UPDATE calls SET state='completed', outcome='reached', duration_s=?, transcript=?, ended_at=datetime('now') WHERE id = ?",
      30 + (id % 45), `[simulated] ${c.script}\n\n[the other side answered and the conversation was recorded]`, id);
    audit({ actorType: 'system', actorId: 'comms', action: 'call.simulated', subjectType: 'call', subjectId: id, payload: { to: c.to_number } });
    notify({ level: 'info', source: 'comms', message: `Simulated call to ${c.to_number} completed — add Twilio credentials in Settings to place it for real.`, subjectType: 'call', subjectId: id });
    return { simulated: true };
  }
  const base = getSetting('PUBLIC_BASE_URL') || '';
  if (!base) throw new Error('set PUBLIC_BASE_URL in Settings so the carrier can reach the callbacks');
  const res = await twilio('Calls.json', {
    To: c.to_number, From: c.from_number,
    Url: `${base}/webhooks/voice/twiml?call=${id}`,
    StatusCallback: `${base}/webhooks/voice/status?call=${id}`,
  });
  exec("UPDATE calls SET state='ringing', provider_sid=? WHERE id = ?", res.sid, id);
  audit({ actorType: 'human', actorId: actor, action: 'call.placed', subjectType: 'call', subjectId: id, payload: { to: c.to_number, sid: res.sid } });
  return { sid: res.sid };
}

export function dispositionCall(id, { outcome, followUp = null, actor }) {
  if (!one('SELECT id FROM calls WHERE id = ?', id)) throw new Error('no such call');
  exec("UPDATE calls SET outcome = ?, follow_up = ?, state = 'completed', ended_at = COALESCE(ended_at, datetime('now')) WHERE id = ?", outcome, followUp, id);
  audit({ actorType: 'human', actorId: actor, action: 'call.dispositioned', subjectType: 'call', subjectId: id, payload: { outcome } });
}

// ---------- messages ----------
const threadKey = (a, b) => [clean(a), clean(b)].sort().join('|');

export function sendMessage({ toNumber, body, channel = 'sms', customerId = null, draftWith = null, actor }) {
  const to = clean(toNumber);
  if (!E164.test(to)) throw new Error('destination must be E.164');
  const from = mainNumber();
  if (!from) throw new Error('register a company number first');
  // Either the words are given, or an employee writes them first.
  let runId = null;
  let text = clean(body);
  let state = 'queued';
  if (!text) {
    if (!draftWith) throw new Error('give the message body, or name an employee to draft it');
    const cust = customerId ? one('SELECT name FROM customers WHERE id = ?', customerId) : null;
    runId = enqueueRun({
      agentId: draftWith,
      taskType: `sms:${to}`,
      input: { prompt: `Write one short ${channel.toUpperCase()} message to ${cust?.name || to}. Under 300 characters, plain text, no markdown, no emoji unless it genuinely helps. Reply as JSON {"text": "<the message>"}.` },
      actor,
    });
    text = '…';
    state = 'drafting';
  }
  exec(`INSERT INTO sms_messages (direction, channel, from_number, to_number, customer_id, agent_id, body, state, thread_key, run_id, created_by)
        VALUES ('out',?,?,?,?,?,?,?,?,?,?)`,
    channel, from.number, to, customerId, draftWith, text, state, threadKey(from.number, to), runId, actor);
  const id = lastId();
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'sms.queued', subjectType: 'sms', subjectId: id, payload: { to, channel, drafted: Boolean(runId) } });
  return id;
}

export async function deliverMessage(id, { actor }) {
  const m = one('SELECT * FROM sms_messages WHERE id = ?', id);
  if (!m) throw new Error('no such message');
  if (m.state === 'drafting') throw new Error('still being written');
  if (['sent', 'delivered'].includes(m.state)) throw new Error('already sent');
  if (isSimulated()) {
    exec("UPDATE sms_messages SET state='sent' WHERE id = ?", id);
    audit({ actorType: 'system', actorId: 'comms', action: 'sms.simulated', subjectType: 'sms', subjectId: id });
    return { simulated: true };
  }
  const prefix = m.channel === 'whatsapp' ? 'whatsapp:' : '';
  const res = await twilio('Messages.json', { To: prefix + m.to_number, From: prefix + m.from_number, Body: m.body });
  exec("UPDATE sms_messages SET state='sent', provider_sid=? WHERE id = ?", res.sid, id);
  audit({ actorType: 'human', actorId: actor, action: 'sms.sent', subjectType: 'sms', subjectId: id, payload: { to: m.to_number, sid: res.sid } });
  return { sid: res.sid };
}

/** Who is this number? Intel records carry phones; customers are linked through them. */
function matchCustomer(number) {
  const p = clean(number).replace(/[^0-9+]/g, '');
  if (!p) return null;
  const rec = one("SELECT customer_id, name FROM intel_records WHERE customer_id IS NOT NULL AND replace(replace(phone,' ',''),'-','') LIKE ?", '%' + p.slice(-9) + '%');
  if (!rec) return null;
  return one('SELECT id, name FROM customers WHERE id = ?', rec.customer_id);
}

// ---------- inbound ----------
/** A message arrived on the company number. */
export function receiveMessage({ from, to, body, channel = 'sms', sid = null }) {
  const cust = matchCustomer(from);
  exec(`INSERT INTO sms_messages (direction, channel, from_number, to_number, customer_id, body, state, thread_key, provider_sid, created_by)
        VALUES ('in',?,?,?,?,?, 'received', ?, ?, 'inbound')`,
    channel, clean(from), clean(to), cust?.id || null, clean(body), threadKey(from, to), sid);
  const id = lastId();
  audit({ actorType: 'system', actorId: 'comms', action: 'sms.received', subjectType: 'sms', subjectId: id, payload: { from: clean(from), channel } });
  notify({ level: 'info', source: 'comms', message: `Message from ${clean(from)}: ${clean(body).slice(0, 90)}`, subjectType: 'sms', subjectId: id });
  // An inbound message is answered by an employee, not left to rot in a queue.
  const worker = one("SELECT id FROM agents WHERE status='active' AND role_group='run' ORDER BY id LIMIT 1")?.id;
  if (worker) {
    const history = q('SELECT direction, body FROM sms_messages WHERE thread_key = ? ORDER BY id DESC LIMIT 6', threadKey(from, to))
      .reverse().map((x) => `${x.direction === 'in' ? 'them' : 'us'}: ${x.body}`).join('\n');
    const runId = enqueueRun({
      agentId: worker, taskType: `sms-reply:${id}`,
      input: { prompt: `Reply to this ${channel.toUpperCase()} conversation. Under 300 characters, plain text, same language they used.\n\n${history}\n\nReply as JSON {"text": "<the reply>"}.` },
      actor: 'system:comms',
    });
    exec(`INSERT INTO sms_messages (direction, channel, from_number, to_number, customer_id, agent_id, body, state, thread_key, run_id, created_by)
          VALUES ('out',?,?,?,?,?, '…', 'drafting', ?, ?, 'system:comms')`,
      channel, clean(to), clean(from), cust?.id || null, worker, threadKey(from, to), runId);
  }
  return id;
}

/** A call arrived. Returns the TwiML the carrier should play. */
export function receiveCall({ from, to, sid = null }) {
  const cust = matchCustomer(from);
  const voice = String(clean(from)).startsWith('+964') ? 'hala' : 'ava';
  exec(`INSERT INTO calls (direction, from_number, to_number, customer_id, voice, language, purpose, state, provider_sid, created_by)
        VALUES ('in',?,?,?,?,?, 'inbound call', 'live', ?, 'inbound')`,
    clean(from), clean(to), cust?.id || null, voice, voice === 'hala' ? 'ar' : 'en', sid);
  const id = lastId();
  audit({ actorType: 'system', actorId: 'comms', action: 'call.received', subjectType: 'call', subjectId: id, payload: { from: clean(from) } });
  notify({ level: 'warn', source: 'comms', message: `Incoming call from ${clean(from)}${cust ? ` (${cust.name})` : ''}.`, subjectType: 'call', subjectId: id });
  const v = VOICES[voice];
  const greet = voice === 'hala'
    ? 'أهلًا بك في كروسيبل. من فضلك اترك رسالتك بعد الإشارة وسنعاود الاتصال بك.'
    : 'Welcome to Crucible. Please leave your message after the tone and we will call you back.';
  return { id, twiml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${v.twilio}" language="${v.language}">${escXml(greet)}</Say>
  <Record maxLength="180" transcribe="true" transcribeCallback="/webhooks/voice/transcript?call=${id}"/>
</Response>` };
}

// ---------- the tick ----------
export async function commsTick() {
  const text = (runId) => {
    const r = one('SELECT state, output FROM runs WHERE id = ?', runId);
    if (r?.state !== 'done' || !r.output) return null;
    try {
      const o = JSON.parse(r.output);
      const p = o?.parsed || (typeof o?.raw === 'string' ? JSON.parse(o.raw) : null);
      return clean(p?.text || p?.draft || p?.body) || null;
    } catch { return null; }
  };
  for (const c of q("SELECT id, run_id FROM calls WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const t = text(c.run_id);
    if (t) exec("UPDATE calls SET script = ?, state = 'queued' WHERE id = ?", t, c.id);
  }
  for (const m of q("SELECT id, run_id FROM sms_messages WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const t = text(m.run_id);
    if (t) exec("UPDATE sms_messages SET body = ?, state = 'queued' WHERE id = ?", t, m.id);
  }
}

// ---------- the view ----------
export function commsOverview() {
  const threads = q(`SELECT thread_key, MAX(id) AS last_id, COUNT(*) AS n FROM sms_messages GROUP BY thread_key ORDER BY last_id DESC LIMIT 20`)
    .map((t) => ({
      key: t.thread_key, count: t.n,
      messages: q('SELECT * FROM sms_messages WHERE thread_key = ? ORDER BY id DESC LIMIT 12', t.thread_key).reverse(),
    }));
  return {
    mode: isSimulated() ? 'simulated' : 'live',
    numbers: q("SELECT * FROM phone_numbers WHERE state = 'active' ORDER BY id"),
    voices: Object.entries(VOICES).map(([id, v]) => ({ id, ...v })),
    calls: q('SELECT * FROM calls ORDER BY id DESC LIMIT 40'),
    threads,
    stats: {
      callsOut: one("SELECT COUNT(*) AS n FROM calls WHERE direction = 'out'").n,
      callsIn: one("SELECT COUNT(*) AS n FROM calls WHERE direction = 'in'").n,
      awaitingDial: one("SELECT COUNT(*) AS n FROM calls WHERE state = 'queued'").n,
      messagesOut: one("SELECT COUNT(*) AS n FROM sms_messages WHERE direction = 'out'").n,
      messagesIn: one("SELECT COUNT(*) AS n FROM sms_messages WHERE direction = 'in'").n,
      awaitingSend: one("SELECT COUNT(*) AS n FROM sms_messages WHERE state = 'queued'").n,
    },
  };
}
