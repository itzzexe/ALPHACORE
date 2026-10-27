// REACH — telling a person, on their phone, that something waits for them.
//
// Thirteen items waiting on the desk help nobody who is not looking at the
// desk. Each person may link a Telegram chat to their own account and then
// hears, within a minute, that something they are allowed to decide has
// arrived — and once a morning, what is waiting and what is overdue.
//
// Three rules shape it. A message carries a link, never a button that
// decides: approving happens in the console, behind the password and the
// second factor, so a phone left on a table is not a way to release a payment.
// A message says as little as it can — counts and kinds by default, not names
// or amounts — because it crosses servers the company does not own. And it
// goes through the gate like any other message leaving the machine.
import { randomInt, createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { hasPerm } from './auth.js';
import { waiting } from './approvals.js';
import { callConnector } from './connectors/index.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const userById = (id) => {
  const u = one("SELECT id, username, role, perms, status FROM users WHERE id = ? AND status = 'active'", Number(id));
  return u ? { ...u, perms: JSON.parse(u.perms) } : null;
};
const itemKey = (i) => `${i.kind}:${i.id}`;
const ar = () => String(getSetting('REACH_LANG') || 'ar') !== 'en';
const base = () => String(getSetting('PUBLIC_BASE_URL') || '').replace(/\/+$/, '');
export const ready = () => one("SELECT state FROM connectors WHERE id = 'telegram'")?.state === 'live';

// A failed send is reported, never thrown: one person's broken chat must not
// stop everybody after them in the same minute from hearing.
async function send(chatId, text, actor) {
  try {
    const r = await callConnector({ connector: 'telegram', capability: 'message.send', args: { chatId, text, silent: false }, actor, reason: 'tell a person something waits for them' });
    return { verdict: r.verdict, why: r.why };
  } catch (e) {
    return { verdict: 'error', why: String(e.message || e).slice(0, 200) };
  }
}

// ----------------------------------------------------------- linking --

/** Send a code to the chat; the person types it back, which proves the chat is theirs. */
export async function link({ user, chatId }) {
  if (!user) refuse('sign in first', 401);
  const chat = String(chatId || '').trim();
  if (!/^-?\d{5,20}$/.test(chat)) refuse('a Telegram chat id is a number — send /start to the company bot and it is shown there');
  if (!ready()) refuse('Telegram is not connected yet — an administrator connects the company bot under Integrations');
  const code = String(randomInt(100000, 1000000));
  exec(`INSERT INTO reach_channels (user_id, chat_id, code_hash, code_expires) VALUES (?,?,?, datetime('now','+15 minutes'))
        ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, code_hash = excluded.code_hash, code_expires = excluded.code_expires, verified_at = NULL`,
  user.id, chat, sha(code));
  const r = await send(chat, ar() ? `رمز ربط AlphaCore: ${code}\nصالح لمدة 15 دقيقة. إن لم تطلبه فتجاهل هذه الرسالة.` : `AlphaCore link code: ${code}\nValid for 15 minutes. If you did not ask for it, ignore this message.`, `human:${user.username}`);
  audit({ actorType: 'human', actorId: `human:${user.username}`, action: 'reach.link_requested', subjectType: 'user', subjectId: user.id, payload: { verdict: r.verdict } });
  return { sent: r.verdict === 'allowed', verdict: r.verdict, why: r.why || null };
}

export function confirm({ user, code }) {
  const c = one('SELECT * FROM reach_channels WHERE user_id = ?', user?.id);
  if (!c?.code_hash) refuse('ask for a code first');
  if (c.code_expires < new Date().toISOString().replace('T', ' ').slice(0, 19)) refuse('that code has expired — ask for a new one');
  if (sha(String(code || '').trim()) !== c.code_hash) refuse('that is not the code that was sent');
  exec("UPDATE reach_channels SET verified_at = datetime('now'), code_hash = NULL, code_expires = NULL WHERE user_id = ?", user.id);
  // What is already waiting is not news: only what arrives from now on is announced.
  for (const i of waiting().items) exec('INSERT OR IGNORE INTO reach_sent (item_key, user_id) VALUES (?,?)', itemKey(i), user.id);
  audit({ actorType: 'human', actorId: `human:${user.username}`, action: 'reach.linked', subjectType: 'user', subjectId: user.id });
  return mine({ user });
}

export function setPrefs({ user, instant = null, digestHour = null }) {
  const c = one('SELECT * FROM reach_channels WHERE user_id = ?', user?.id);
  if (!c) refuse('link a chat first');
  const h = digestHour == null ? null : Number(digestHour);
  if (h != null && !(Number.isInteger(h) && h >= -1 && h <= 23)) refuse('the digest hour is 0–23, or -1 for none');
  exec('UPDATE reach_channels SET instant = COALESCE(?, instant), digest_hour = COALESCE(?, digest_hour) WHERE user_id = ?',
    instant == null ? null : (instant ? 1 : 0), h, user.id);
  return mine({ user });
}

export function unlink({ user }) {
  exec('DELETE FROM reach_channels WHERE user_id = ?', user?.id);
  exec('DELETE FROM reach_sent WHERE user_id = ?', user?.id);
  audit({ actorType: 'human', actorId: `human:${user.username}`, action: 'reach.unlinked', subjectType: 'user', subjectId: user.id });
  return mine({ user });
}

export function mine({ user }) {
  const c = one('SELECT chat_id, verified_at, instant, digest_hour, last_digest FROM reach_channels WHERE user_id = ?', user?.id);
  return { ready: ready(), linked: Boolean(c?.verified_at), pending: Boolean(c && !c.verified_at), ...(c ? { chatId: c.chat_id, instant: Boolean(c.instant), digestHour: c.digest_hour, lastDigest: c.last_digest } : {}) };
}

// ---------------------------------------------------------- messages --

const KIND_AR = { run: 'عمل موظف', decision: 'قرار', payout: 'دفعة', egress: 'اتصال خارجي', paperOrder: 'أمر تداول', brokerOrder: 'أمر وساطة', contract: 'عقد', post: 'منشور', content: 'محتوى', ticket: 'تذكرة', learnNote: 'درس', finReport: 'تقرير مالي' };

/** "3 new: 2 decisions, 1 payout" — kinds and counts, never names or amounts. */
export function instantText(items, { arabic = ar(), link = base() } = {}) {
  const by = new Map();
  for (const i of items) by.set(i.kind, (by.get(i.kind) || 0) + 1);
  const parts = [...by].map(([k, n]) => `${n} ${arabic ? (KIND_AR[k] || k) : k}`).join(arabic ? '، ' : ', ');
  const url = link ? `\n${link}/#/approvals` : '';
  return arabic ? `⏳ ${items.length} بانتظار قرارك: ${parts}${url}` : `⏳ ${items.length} waiting for you: ${parts}${url}`;
}

/** The morning's counts, only for the departments this person may see. */
export function digestFor(user) {
  const lines = [];
  const add = (perm, sql, en, arText) => {
    if (perm && !hasPerm(user, perm)) return;
    let n = 0;
    try { n = one(sql)?.n || 0; } catch { return; }
    if (n) lines.push(ar() ? `• ${n} ${arText}` : `• ${n} ${en}`);
  };
  const mineWaiting = waiting().items.filter((i) => hasPerm(user, i.permission));
  if (mineWaiting.length) {
    const oldest = mineWaiting.reduce((a, i) => (String(i.since) < String(a) ? i.since : a), mineWaiting[0].since);
    const days = Math.floor((Date.now() - new Date(`${String(oldest).replace(' ', 'T')}Z`).getTime()) / 86400e3);
    lines.push(ar() ? `• ${mineWaiting.length} بانتظار قرارك (أقدمها منذ ${days} يوم)` : `• ${mineWaiting.length} waiting for your decision (oldest ${days} day(s))`);
  }
  add('ia.view', "SELECT COUNT(*) AS n FROM ia_findings WHERE state NOT IN ('implemented','verified') AND due < date('now')", 'audit actions overdue', 'إجراءات تدقيق متأخرة');
  add('iso.view', "SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed'", 'nonconformities open', 'حالات عدم مطابقة مفتوحة');
  add('policies.view', "SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published' AND next_review < date('now')", 'policies past their review date', 'سياسات تجاوزت موعد مراجعتها');
  add('insurance.view', "SELECT COUNT(*) AS n FROM ins_policies WHERE state = 'active' AND ends <= date('now','+30 days')", 'insurance policies ending within 30 days', 'وثائق تأمين تنتهي خلال 30 يومًا');
  add('opscenter.view', "SELECT COUNT(*) AS n FROM ops_issues WHERE state = 'open'", 'operations issues open', 'مشكلات تشغيل مفتوحة');
  add('aml.view', "SELECT COUNT(*) AS n FROM aml_alerts WHERE state IN ('open','investigating')", 'AML alerts open', 'تنبيهات غسل أموال مفتوحة');
  add('remit.view', "SELECT COUNT(*) AS n FROM remit_message WHERE state = 'held'", 'payment messages held by screening', 'رسائل دفع محجوزة بالفحص');
  add(null, "SELECT COUNT(*) AS n FROM draft_jobs WHERE state = 'ready' AND created_at >= datetime('now','-1 day')", 'drafts written overnight', 'مسودات كُتبت خلال الليل');
  const head = ar() ? '☀️ صباح الخير — ما ينتظرك اليوم:' : '☀️ Good morning — what is waiting today:';
  const tail = base() ? `\n${base()}/#/approvals` : '';
  return lines.length ? `${head}\n${lines.join('\n')}${tail}` : null;
}

/**
 * Once a minute: announce what arrived for each linked person, and at their
 * hour, the digest. A send the gate holds is not retried every minute — the
 * item is marked, and the gate's own desk shows the held message.
 */
export async function tick(now = new Date()) {
  if (!ready()) return { sent: 0 };
  const chans = q('SELECT * FROM reach_channels WHERE verified_at IS NOT NULL');
  if (!chans.length) return { sent: 0 };
  const items = waiting().items;
  const today = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const c of chans) {
    const user = userById(c.user_id);
    if (!user) continue;
    if (c.instant) {
      const fresh = items.filter((i) => hasPerm(user, i.permission) && !one('SELECT 1 FROM reach_sent WHERE item_key = ? AND user_id = ?', itemKey(i), user.id));
      if (fresh.length) {
        for (const i of fresh) exec('INSERT OR IGNORE INTO reach_sent (item_key, user_id) VALUES (?,?)', itemKey(i), user.id);
        await send(c.chat_id, instantText(fresh), 'system:reach');
        sent++;
      }
    }
    if (c.digest_hour >= 0 && now.getUTCHours() === c.digest_hour && c.last_digest !== today) {
      exec('UPDATE reach_channels SET last_digest = ? WHERE user_id = ?', today, user.id);
      const text = digestFor(user);
      if (text) { await send(c.chat_id, text, 'system:reach'); sent++; }
    }
  }
  // The memory of what was announced need not outlive the items by much.
  exec("DELETE FROM reach_sent WHERE sent_at < datetime('now','-60 days')");
  return { sent };
}

export function reachOverview() {
  return {
    ready: ready(),
    linked: one('SELECT COUNT(*) AS n FROM reach_channels WHERE verified_at IS NOT NULL').n,
    publicUrl: base() || null,
  };
}
