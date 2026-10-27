// AML and KYC — knowing who the company deals with, how risky they are, and
// what to do when something looks wrong.
//
// A customer or counterparty is scored on factors a regulator recognises —
// a politically exposed person, a high-risk country, a cash-heavy industry, a
// relationship opened remotely or through an intermediary — and the score sets
// the depth of due diligence and how soon it is reviewed again. Every party is
// screened against the watchlist the company keeps. An alert is investigated,
// then cleared or reported; reporting to the financial intelligence unit is a
// person's act, recorded with the reference the unit gave back. The platform
// files nothing itself.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret } from './settings.js';
import { screen } from './screening.js';
import { requestDraft, draftsFor } from './drafts.js';
import { matchSanctions, sanctionsOverview } from './sanctions.js';

/** Record new sanctions matches for a party and open one alert for them. */
function sanctionAlert(partyId, name) {
  const fresh = matchSanctions(name).filter((h) => !one('SELECT 1 FROM aml_sanction_hits WHERE party_id = ? AND list = ? AND ref = ?', partyId, h.list, h.ref));
  if (!fresh.length) return null;
  const r = exec('INSERT INTO aml_alerts (party_id, reason, created_by) VALUES (?,?,?)', partyId,
    `matches a sanctions list: ${fresh.map((h) => `${h.list.toUpperCase()} ${h.ref} ${h.name} (${Math.round(h.score * 100)}%)`).join(', ')}`, 'system:aml');
  const alertId = Number(r.lastInsertRowid);
  for (const h of fresh) exec('INSERT INTO aml_sanction_hits (party_id, list, ref, score, alert_id) VALUES (?,?,?,?,?)', partyId, h.list, h.ref, h.score, alertId);
  audit({ actorType: 'system', actorId: 'system:aml', action: 'aml.sanctions_hit', subjectType: 'aml_party', subjectId: partyId, payload: { hits: fresh.map((h) => `${h.list}:${h.ref}`) } });
  return { alertId, hits: fresh };
}

/** After the lists change, everyone on the books is screened again. */
export function rescreenSanctions() {
  let alerts = 0;
  for (const p of q("SELECT id, name FROM aml_parties WHERE state = 'active'")) if (sanctionAlert(p.id, p.name)) alerts++;
  return { alerts };
}

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
// Matched as substrings of what was typed, in either language: exchange houses
// and hawala are where money services actually happen in this region.
const HIGH_RISK_INDUSTRIES = ['cash', 'crypto', 'gambling', 'precious metals', 'gold', 'jewel', 'money services', 'exchange house', 'hawala', 'arms', 'real estate',
  'نقد', 'عملات رقمية', 'قمار', 'ذهب', 'مجوهرات', 'صراف', 'حوالات', 'سلاح', 'عقار'];

/** The FATF call-for-action list at its most stable; the rest is the company's to maintain. */
export function highRiskCountries() {
  const set = getSecret('AML_HIGH_RISK_COUNTRIES');
  return (set ? String(set) : 'KP,IR,MM').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
}

export function scoreParty(p) {
  const factors = [];
  // `why` is a fixed phrase and `arg` the particular, so the console can translate the one and show the other.
  const add = (points, why, arg = null) => factors.push({ points, why, arg });
  if (p.pep) add(3, 'politically exposed person');
  if (p.country && highRiskCountries().includes(String(p.country).toUpperCase())) add(3, 'high-risk country', String(p.country).toUpperCase());
  if (p.industry && HIGH_RISK_INDUSTRIES.some((i) => String(p.industry).toLowerCase().includes(i))) add(2, 'higher-risk industry', p.industry);
  if (p.channel === 'remote') add(1, 'onboarded without meeting');
  if (p.channel === 'intermediary') add(2, 'introduced through an intermediary');
  const score = factors.reduce((a, f) => a + f.points, 0);
  const level = score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { score, level, factors, cdd: level === 'high' ? 'enhanced' : level === 'low' ? 'simplified' : 'standard', reviewMonths: level === 'high' ? 12 : level === 'medium' ? 24 : 36 };
}

const watchlist = () => q('SELECT id, name, list FROM aml_watchlist');

export function addParty({ name, kind = 'company', country = null, pep = false, industry = null, channel = 'in_person', actor }) {
  if (!clean(name, 200)) refuse('who is the party?');
  if (!['individual', 'company'].includes(kind)) refuse('individual or company');
  if (!['in_person', 'remote', 'intermediary'].includes(channel)) refuse('channel is in_person, remote or intermediary');
  const s = scoreParty({ pep, country, industry, channel });
  const hits = screen(name, watchlist());
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + s.reviewMonths);
  const r = exec(`INSERT INTO aml_parties (name, kind, country, pep, industry, channel, risk_score, risk_level, cdd, screening, next_review, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, clean(name, 200), kind, clean(country, 2).toUpperCase() || null, pep ? 1 : 0, clean(industry, 80) || null, channel,
  s.score, s.level, s.cdd, JSON.stringify({ factors: s.factors, hits, at: new Date().toISOString() }), next.toISOString().slice(0, 10), actor);
  const id = Number(r.lastInsertRowid);
  if (hits.length) {
    exec('INSERT INTO aml_alerts (party_id, reason, created_by) VALUES (?,?,?)', id, `name matches the watchlist: ${hits.map((h) => `${h.name} (${Math.round(h.score * 100)}%)`).join(', ')}`, 'system:aml');
  }
  const sanctioned = sanctionAlert(id, clean(name, 200));
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'aml.party', subjectType: 'aml_party', subjectId: id, payload: { level: s.level, hits: hits.length } });
  return { ...one('SELECT * FROM aml_parties WHERE id = ?', id), hits, sanctions: sanctioned?.hits || [] };
}

export function addToWatchlist({ name, list = 'internal', actor }) {
  if (!isHuman(actor)) refuse('a person decides who goes on the watchlist', 403);
  if (!clean(name, 200)) refuse('a name, please');
  exec('INSERT INTO aml_watchlist (name, list, created_by) VALUES (?,?,?)', clean(name, 200), clean(list, 40) || 'internal', actor);
  audit({ actorType: 'human', actorId: actor, action: 'aml.watchlisted', subjectType: 'aml_watchlist', subjectId: clean(name, 200), payload: { list } });
  // Everybody already on the books is screened again against the new name.
  let alerts = 0;
  for (const p of q("SELECT id, name FROM aml_parties WHERE state = 'active'")) {
    const hit = screen(p.name, [{ name: clean(name, 200), list }])[0];
    if (hit) { exec('INSERT INTO aml_alerts (party_id, reason, created_by) VALUES (?,?,?)', p.id, `now matches a watchlisted name: ${hit.name} (${Math.round(hit.score * 100)}%)`, 'system:aml'); alerts++; }
  }
  return { ok: true, alerts };
}

export function raiseAlert({ partyId, reason, amount = null, actor }) {
  if (!one('SELECT id FROM aml_parties WHERE id = ?', Number(partyId))) refuse('no such party', 404);
  if (!clean(reason)) refuse('what looks wrong?');
  const r = exec('INSERT INTO aml_alerts (party_id, reason, amount, created_by) VALUES (?,?,?,?)', Number(partyId), clean(reason, 1000), amount == null ? null : Number(amount), actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'aml.alert', subjectType: 'aml_alert', subjectId: Number(r.lastInsertRowid) });
  return one('SELECT * FROM aml_alerts WHERE id = ?', Number(r.lastInsertRowid));
}

/** Investigate, then clear or report. Both conclusions are a person's, and reporting needs the FIU's reference. */
export function decideAlert({ id, to, note = '', reportRef = null, actor }) {
  const a = one('SELECT * FROM aml_alerts WHERE id = ?', Number(id));
  if (!a) refuse('no such alert', 404);
  const next = { open: ['investigating'], investigating: ['cleared', 'reported'], cleared: [], reported: [] };
  if (!next[a.state].includes(to)) refuse(`from ${a.state} it can go to: ${next[a.state].join(', ') || 'nowhere'}`);
  if (['cleared', 'reported'].includes(to)) {
    if (!isHuman(actor)) refuse('concluding an alert is a person’s act', 403);
    if (!clean(note)) refuse('record why');
    if (to === 'reported' && !clean(reportRef, 80)) refuse('record the reference the financial intelligence unit gave the report');
  }
  exec('UPDATE aml_alerts SET state = ?, note = COALESCE(?, note), decided_by = CASE WHEN ? IN (\'cleared\',\'reported\') THEN ? ELSE decided_by END, report_ref = COALESCE(?, report_ref) WHERE id = ?',
    to, clean(note, 2000) || null, to, actor, clean(reportRef, 80) || null, a.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `aml.alert_${to}`, subjectType: 'aml_alert', subjectId: a.id });
  return one('SELECT * FROM aml_alerts WHERE id = ?', a.id);
}

export function review({ partyId, actor, lang = 'ar' }) {
  const p = one('SELECT * FROM aml_parties WHERE id = ?', Number(partyId));
  if (!p) refuse('no such party', 404);
  const alerts = q('SELECT reason, state FROM aml_alerts WHERE party_id = ?', p.id);
  const brief = `An enhanced-due-diligence review memo for ${p.kind} "${p.name}" (country ${p.country || '[TO CONFIRM]'}, industry ${p.industry || '[TO CONFIRM]'}, risk ${p.risk_level}, PEP ${p.pep ? 'yes' : 'no'}).
Alerts: ${alerts.map((a) => `${a.reason} [${a.state}]`).join('; ') || 'none'}.
List what must be verified (identity, beneficial owners, source of funds, source of wealth), which documents prove each, and the red flags to look for. Do not conclude whether to report — that is a person's decision.`;
  return requestDraft({ dept: 'aml', subjectType: 'aml_party', subjectId: p.id, kind: 'edd-review', agentId: 'AGT-AML-001', brief, lang, actor });
}

export function overview() {
  return {
    parties: q('SELECT * FROM aml_parties ORDER BY risk_score DESC, id DESC LIMIT 80').map((p) => ({ ...p, screening: p.screening ? JSON.parse(p.screening) : null })),
    byLevel: Object.fromEntries(['high', 'medium', 'low'].map((l) => [l, one("SELECT COUNT(*) AS n FROM aml_parties WHERE risk_level = ? AND state = 'active'", l).n])),
    reviewsDue: one("SELECT COUNT(*) AS n FROM aml_parties WHERE state = 'active' AND next_review < date('now')").n,
    alerts: q('SELECT a.*, p.name AS party FROM aml_alerts a LEFT JOIN aml_parties p ON p.id = a.party_id ORDER BY CASE a.state WHEN \'open\' THEN 0 WHEN \'investigating\' THEN 1 ELSE 2 END, a.id DESC LIMIT 60'),
    watchlist: q('SELECT * FROM aml_watchlist ORDER BY id DESC LIMIT 100'),
    highRiskCountries: highRiskCountries(),
    sanctions: sanctionsOverview(),
    sanctionHits: Object.fromEntries(q('SELECT party_id, COUNT(*) AS n FROM aml_sanction_hits GROUP BY party_id').map((r) => [r.party_id, r.n])),
    drafts: draftsFor('aml', null, null, 5),
  };
}
