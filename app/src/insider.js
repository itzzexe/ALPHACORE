// INSIDER RISK — patterns in the record worth a second look.
//
// Most fraud is done by people with access, using it. The record of every act
// is already here and cannot be edited; this reads it for the shapes that
// precede trouble: a sign-in from somewhere new, approvals in the middle of
// the night, a burst of exports, one person approving almost everything one
// colleague prepares, a run of failed passwords that ends in a success.
//
// None of these is proof, and none acts on its own. Each raises one alert per
// person and pattern, for the security team to clear with a reason or confirm.
// Confirming can end the person's sessions, so the next step is a fresh
// sign-in — with the one-time code where the company requires one.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');

/** Hours from UTC to the company's clock — the night is the company's night. */
const offset = () => { const n = Number(getSetting('COMPANY_TZ_OFFSET')); return Number.isFinite(n) && Math.abs(n) <= 14 ? n : 3; };

const APPROVAL = /(approve|approved|publish|published|release|released|\.paid|executed|\.decide|decided|settled|cleared)$/;
const EXPORT = /(export|download|backup\.taken|document\.issued)/;
const MONEY = /^(remit|treasury|payout|bank|finance|fin_|bill|payroll)/;

export const RULES = {
  new_location: { score: 40, label: 'Signed in from a network not seen for this account in ninety days' },
  off_hours: { score: 30, label: 'Approved something between midnight and five in the morning' },
  bulk_export: { score: 50, label: 'More than twenty exports or downloads in a day' },
  approval_pair: { score: 50, label: 'Approves almost everything one colleague prepares' },
  password_burst: { score: 60, label: 'Five or more failed passwords, then a success, within the hour' },
};

function raise(rule, subject, key, detail, extra = 0) {
  const score = RULES[rule].score + extra;
  const r = exec('INSERT OR IGNORE INTO insider_alerts (rule, subject, key, score, detail) VALUES (?,?,?,?,?)',
    rule, subject, String(key), score, JSON.stringify(detail));
  if (r.changes && score >= 50) {
    notify({ level: 'warn', source: 'insider', message: `${RULES[rule].label}: ${subject.replace(/^human:/, '')}`, subjectType: 'insider_alert', subjectId: Number(r.lastInsertRowid) });
  }
  return r.changes > 0;
}

const net = (ip) => { const s = String(ip || '').replace(/^::ffff:/, ''); return s.includes('.') ? s.split('.').slice(0, 2).join('.') : s.split(':').slice(0, 3).join(':'); };

/** Read the record for every pattern. Idempotent: each pattern raises once per person and key. */
export function sweep(now = new Date()) {
  let raised = 0;

  // A network this account has not signed in from in ninety days. The very
  // first sign-in is not news; there is nothing to compare it with.
  for (const s of q("SELECT username, ip, at FROM login_attempts WHERE ok = 1 AND at > datetime('now','-1 day') AND ip IS NOT NULL")) {
    const seen = q("SELECT DISTINCT ip FROM login_attempts WHERE username = ? AND ok = 1 AND at < ? AND at > datetime(?, '-90 days')", s.username, s.at, s.at).map((r) => net(r.ip));
    if (seen.length && !seen.includes(net(s.ip))) raised += raise('new_location', `human:${s.username}`, net(s.ip), { ip: s.ip, at: s.at, known: [...new Set(seen)].slice(0, 5) });
  }

  // Approvals in the company's small hours; money approved then counts double.
  for (const r of q("SELECT actor_id, action, subject_type, subject_id, occurred_at FROM audit_log WHERE actor_type = 'human' AND occurred_at > datetime('now','-7 days')")) {
    if (!APPROVAL.test(r.action)) continue;
    const local = new Date(new Date(`${r.occurred_at.replace(' ', 'T')}Z`).getTime() + offset() * 3600e3);
    if (local.getUTCHours() >= 5) continue;
    raised += raise('off_hours', r.actor_id, local.toISOString().slice(0, 10), { action: r.action, subject: `${r.subject_type}:${r.subject_id}`, localTime: local.toISOString().slice(11, 16) }, MONEY.test(r.action) ? 20 : 0);
  }

  // A burst of exports in one day.
  const byDay = new Map();
  for (const r of q("SELECT actor_id, action, substr(occurred_at, 1, 10) AS day FROM audit_log WHERE actor_type = 'human' AND occurred_at > datetime('now','-2 days')")) {
    if (!EXPORT.test(r.action)) continue;
    const k = `${r.actor_id}|${r.day}`;
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  for (const [k, count] of byDay) if (count > 20) { const [who, day] = k.split('|'); raised += raise('bulk_export', who, day, { count }); }

  // One approver for nearly everything one colleague prepares, across the records that carry both names.
  const pairs = q(`SELECT created_by AS maker, approved_by AS checker, COUNT(*) AS n FROM (
      SELECT created_by, approved_by, created_at FROM remit_message WHERE approved_by IS NOT NULL
      UNION ALL SELECT created_by, approved_by, created_at FROM bank_transfer WHERE approved_by IS NOT NULL
      UNION ALL SELECT created_by, approved_by, created_at FROM fin_ap_bill WHERE approved_by IS NOT NULL
      UNION ALL SELECT created_by, approved_by, created_at FROM pol_docs WHERE approved_by IS NOT NULL
    ) WHERE created_at > datetime('now','-90 days') AND created_by <> approved_by GROUP BY created_by, approved_by`);
  const totals = new Map();
  for (const p of pairs) totals.set(p.maker, (totals.get(p.maker) || 0) + p.n);
  for (const p of pairs) {
    if (p.n >= 5 && p.n / totals.get(p.maker) >= 0.8 && isHuman(p.checker)) {
      raised += raise('approval_pair', p.checker, p.maker, { maker: p.maker, approved: p.n, ofAll: totals.get(p.maker) });
    }
  }

  // Failed passwords that end in a success.
  for (const s of q("SELECT username, at FROM login_attempts WHERE ok = 1 AND at > datetime('now','-1 day')")) {
    const failed = one("SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND ok = 0 AND at BETWEEN datetime(?, '-1 hour') AND ?", s.username, s.at, s.at).n;
    if (failed >= 5) raised += raise('password_burst', `human:${s.username}`, s.at.slice(0, 13), { failed, at: s.at });
  }

  if (raised) audit({ actorType: 'system', actorId: 'system:insider', action: 'insider.raised', subjectType: 'insider_alerts', subjectId: 'sweep', payload: { raised } });
  return { raised };
}

/** Clear with a reason, or confirm — and, if it is serious, end the person's sessions. */
export function decide({ id, verdict, note, endSessions = false, actor }) {
  if (!isHuman(actor)) refuse('a person decides', 403);
  if (!['cleared', 'confirmed'].includes(verdict)) refuse('cleared or confirmed');
  if (!String(note || '').trim()) refuse('record why');
  const a = one("SELECT * FROM insider_alerts WHERE id = ? AND state = 'open'", Number(id));
  if (!a) refuse('no such open alert', 404);
  if (a.subject === actor) refuse('an alert about you is decided by somebody else');
  exec("UPDATE insider_alerts SET state = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?", verdict, actor, String(note).slice(0, 1000), a.id);
  let ended = 0;
  if (verdict === 'confirmed' && endSessions) {
    const u = one('SELECT id FROM users WHERE username = ?', a.subject.replace(/^human:/, ''));
    if (u) ended = exec('DELETE FROM sessions WHERE user_id = ?', u.id).changes;
  }
  audit({ actorType: 'human', actorId: actor, action: `insider.${verdict}`, subjectType: 'insider_alert', subjectId: a.id, payload: { rule: a.rule, subject: a.subject, sessionsEnded: ended } });
  return { ...one('SELECT * FROM insider_alerts WHERE id = ?', a.id), sessionsEnded: ended };
}

export function overview() {
  const alerts = q("SELECT * FROM insider_alerts ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END, score DESC, id DESC LIMIT 150")
    .map((a) => ({ ...a, detail: JSON.parse(a.detail), label: RULES[a.rule]?.label }));
  const people = q("SELECT subject, SUM(score) AS score, COUNT(*) AS alerts FROM insider_alerts WHERE state <> 'cleared' AND created_at > datetime('now','-90 days') GROUP BY subject ORDER BY score DESC LIMIT 10");
  return { alerts, people, open: alerts.filter((a) => a.state === 'open').length, rules: RULES, tzOffset: offset() };
}
