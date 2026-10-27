// Internal audit — the third line: independent assurance that the company's
// controls work, and a financial audit that reads the books themselves.
//
// The plan is risk-based, not alphabetical: every auditable area has a risk
// rating, and what comes first is high risk that has gone longest without a
// look. A finding is written the way the profession writes them — criteria,
// condition, cause, effect, recommendation — and stays open until a person
// verifies the agreed action was taken. Nobody closes their own finding.
//
// The financial audit is a set of tests over every posted journal entry,
// deterministic so the same books always give the same exceptions: entries
// that do not balance, postings on a weekend, round amounts, the same entry
// twice, amounts sitting just under an approval limit, and a Benford's-law
// test on the first digits. An exception is a question, not an accusation;
// each one can become a finding with its evidence attached.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { sectionCatalog } from './links.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
const KINDS = ['operational', 'financial', 'compliance', 'it'];
const STAGES = ['planned', 'fieldwork', 'reporting', 'followup', 'closed'];
const OPINIONS = ['satisfactory', 'needs_improvement', 'unsatisfactory'];

// ---------------------------------------------------------- the universe --

/** Every department in the catalogue is auditable; seeded once at a middle risk. */
export function seedUniverse({ actor = 'system:internal-audit' } = {}) {
  let made = 0;
  for (const s of sectionCatalog()) {
    made += exec('INSERT OR IGNORE INTO ia_entities (name, section, risk, created_by) VALUES (?,?,3,?)', s.label, s.id, actor).changes;
  }
  return made;
}

export function rateEntity({ id, risk, actor }) {
  const r = Number(risk);
  if (!(Number.isInteger(r) && r >= 1 && r <= 5)) refuse('risk is 1 (low) to 5 (high)');
  if (!one('SELECT id FROM ia_entities WHERE id = ?', Number(id))) refuse('no such area', 404);
  exec('UPDATE ia_entities SET risk = ? WHERE id = ?', r, Number(id));
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'internalaudit.rated', subjectType: 'ia_entity', subjectId: Number(id), payload: { risk: r } });
  return one('SELECT * FROM ia_entities WHERE id = ?', Number(id));
}

/** The risk-based plan: risk × years since last audited (never audited counts as three years). */
export function plan(limit = 15) {
  const now = Date.now();
  return q('SELECT * FROM ia_entities').map((e) => {
    const years = e.last_audited ? (now - new Date(`${e.last_audited.replace(' ', 'T')}Z`)) / (365 * 864e5) : 3;
    return { ...e, priority: Math.round(e.risk * Math.min(3, Math.max(0.25, years)) * 10) / 10 };
  }).sort((a, b) => b.priority - a.priority).slice(0, limit);
}

// ----------------------------------------------------------- engagements --

export function openEngagement({ entityId = null, title, kind = 'operational', objective = '', scope = '', lead = null, actor }) {
  if (!clean(title, 200)) refuse('an engagement has a title');
  if (!KINDS.includes(kind)) refuse(`kind must be one of: ${KINDS.join(', ')}`);
  const r = exec('INSERT INTO ia_engagements (entity_id, title, kind, objective, scope, lead, created_by) VALUES (?,?,?,?,?,?,?)',
    entityId ? Number(entityId) : null, clean(title, 200), kind, clean(objective), clean(scope), clean(lead, 80) || null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'internalaudit.opened', subjectType: 'ia_engagement', subjectId: Number(r.lastInsertRowid), payload: { title, kind } });
  return one('SELECT * FROM ia_engagements WHERE id = ?', Number(r.lastInsertRowid));
}

export function advanceEngagement({ id, to, opinion = null, actor }) {
  const e = one('SELECT * FROM ia_engagements WHERE id = ?', Number(id));
  if (!e) refuse('no such engagement', 404);
  if (STAGES.indexOf(to) !== STAGES.indexOf(e.state) + 1) refuse(`after ${e.state} comes ${STAGES[STAGES.indexOf(e.state) + 1] || 'nothing'}`);
  if (to === 'followup' && !OPINIONS.includes(opinion || e.opinion)) refuse('a report gives an opinion: satisfactory, needs_improvement or unsatisfactory');
  if (to === 'closed') {
    if (!isHuman(actor)) refuse('closing an audit is the chief auditor’s act', 403);
    const open = one("SELECT COUNT(*) AS n FROM ia_findings WHERE engagement_id = ? AND state <> 'verified'", e.id).n;
    if (open) refuse(`${open} finding(s) are not verified yet`);
  }
  exec(`UPDATE ia_engagements SET state = ?, opinion = COALESCE(?, opinion), closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END WHERE id = ?`,
    to, opinion, to, e.id);
  if (to === 'closed' && e.entity_id) exec("UPDATE ia_entities SET last_audited = datetime('now') WHERE id = ?", e.entity_id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `internalaudit.${to}`, subjectType: 'ia_engagement', subjectId: e.id, payload: { opinion } });
  return one('SELECT * FROM ia_engagements WHERE id = ?', e.id);
}

export function addFinding({ engagementId = null, title, rating = 'medium', criteria = '', condition = '', cause = '', effect = '', recommendation = '', owner = null, due = null, source = 'manual', evidence = null, actor }) {
  if (!clean(title, 200)) refuse('a finding has a title');
  if (!['high', 'medium', 'low'].includes(rating)) refuse('high, medium or low');
  if (source === 'manual' && (!clean(condition) || !clean(criteria))) refuse('a finding states the criteria and what was found against it');
  const r = exec(`INSERT INTO ia_findings (engagement_id, title, rating, criteria, condition, cause, effect, recommendation, owner, due, source, evidence, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  engagementId ? Number(engagementId) : null, clean(title, 200), rating, clean(criteria), clean(condition), clean(cause), clean(effect), clean(recommendation),
  clean(owner, 80) || null, due, source, evidence ? JSON.stringify(evidence).slice(0, 8000) : null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'internalaudit.finding', subjectType: 'ia_finding', subjectId: Number(r.lastInsertRowid), payload: { rating, source } });
  return one('SELECT * FROM ia_findings WHERE id = ?', Number(r.lastInsertRowid));
}

/** Management agrees an action; the auditor verifies it was done. The owner never verifies their own. */
export function advanceFinding({ id, to, actionPlan = null, actor }) {
  const f = one('SELECT * FROM ia_findings WHERE id = ?', Number(id));
  if (!f) refuse('no such finding', 404);
  const next = { open: ['in_progress'], in_progress: ['implemented'], implemented: ['verified', 'in_progress'], verified: [] };
  if (!next[f.state].includes(to)) refuse(`from ${f.state} it can go to: ${next[f.state].join(', ') || 'nowhere'}`);
  if (to === 'in_progress' && !clean(actionPlan ?? f.action_plan)) refuse('agree an action plan with management first');
  if (to === 'verified') {
    if (!isHuman(actor)) refuse('verifying a finding is the auditor’s act', 403);
    if (f.owner && actor === `human:${f.owner}`) refuse('the owner of an action does not verify it');
  }
  exec(`UPDATE ia_findings SET state = ?, action_plan = COALESCE(?, action_plan), closed_at = CASE WHEN ? = 'verified' THEN datetime('now') ELSE closed_at END WHERE id = ?`,
    to, actionPlan ? clean(actionPlan) : null, to, f.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `internalaudit.finding_${to}`, subjectType: 'ia_finding', subjectId: f.id });
  return one('SELECT * FROM ia_findings WHERE id = ?', f.id);
}

export function programme({ id, actor, lang = 'ar' }) {
  const e = one('SELECT e.*, x.name AS area FROM ia_engagements e LEFT JOIN ia_entities x ON x.id = e.entity_id WHERE e.id = ?', Number(id));
  if (!e) refuse('no such engagement', 404);
  const brief = `Audit programme for "${e.title}" (${e.kind} audit${e.area ? ` of ${e.area}` : ''}). Objective: ${e.objective || '[TO CONFIRM]'}. Scope: ${e.scope || '[TO CONFIRM]'}.
List the key risks, the control expected for each, and the test that would show whether the control works (inquiry, inspection, re-performance, data analysis), with the sample size. Put each test in "items" as {risk, control, test, sample}.`;
  return requestDraft({ dept: 'internalaudit', subjectType: 'ia_engagement', subjectId: e.id, kind: 'audit-programme', agentId: 'AGT-AUD-001', brief, lang, actor });
}

// ------------------------------------------------------ financial audit --

const BENFORD = [0, 0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];

/**
 * Run the financial tests over posted entries in a period.
 *
 * `limit` is the approval threshold whose neighbourhood is suspicious: an
 * amount within 5% under it is listed, because splitting or shaving to stay
 * under a limit is the classic way round one.
 */
export function runAnalytics({ from = null, to = null, limit = Number(process.env.IA_APPROVAL_LIMIT || 5000), actor }) {
  // An open end of the period is NULL, which matches every date.
  const entries = q(`SELECT j.id, j.ref, j.entry_date, j.memo, j.total, j.created_by, j.posted_by, j.source FROM journal j
                     WHERE j.state = 'posted' AND (?1 IS NULL OR j.entry_date >= ?1) AND (?2 IS NULL OR j.entry_date <= ?2) ORDER BY j.id`, from, to);
  const lines = q(`SELECT l.journal_id, l.side, l.amount, l.account_code FROM journal_lines l JOIN journal j ON j.id = l.journal_id
                   WHERE j.state = 'posted' AND (?1 IS NULL OR j.entry_date >= ?1) AND (?2 IS NULL OR j.entry_date <= ?2)`, from, to);
  const byEntry = new Map();
  for (const l of lines) { if (!byEntry.has(l.journal_id)) byEntry.set(l.journal_id, []); byEntry.get(l.journal_id).push(l); }

  const tests = {
    unbalanced: [], weekend: [], round: [], duplicates: [], nearLimit: [], selfApproved: [],
  };
  const seen = new Map();
  for (const e of entries) {
    const ls = byEntry.get(e.id) || [];
    const dr = ls.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0);
    const cr = ls.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0);
    if (Math.abs(dr - cr) > 0.005) tests.unbalanced.push({ ref: e.ref, debit: dr, credit: cr });
    const day = new Date(`${e.entry_date}T00:00:00Z`).getUTCDay();
    // Friday and Saturday are the weekend here; Saturday and Sunday elsewhere —
    // all three are flagged, because a manual posting on any of them is unusual.
    if ([0, 5, 6].includes(day) && (e.source || 'manual') === 'manual') tests.weekend.push({ ref: e.ref, date: e.entry_date });
    if (e.total >= 1000 && e.total % 1000 === 0) tests.round.push({ ref: e.ref, total: e.total });
    if (e.total >= limit * 0.95 && e.total < limit) tests.nearLimit.push({ ref: e.ref, total: e.total, limit });
    if (e.posted_by && e.posted_by === e.created_by && (e.source || 'manual') === 'manual') tests.selfApproved.push({ ref: e.ref, by: e.created_by });
    const key = `${e.entry_date}|${e.total}|${ls.map((l) => `${l.account_code}${l.side[0]}`).sort().join(',')}`;
    if (seen.has(key)) tests.duplicates.push({ ref: e.ref, sameAs: seen.get(key) }); else seen.set(key, e.ref);
  }

  // Benford: first significant digit of every line amount, chi-square against
  // the expected distribution. Under ~50 amounts the test means nothing, and
  // says so rather than reporting a confident number.
  const amounts = lines.map((l) => l.amount).filter((a) => a >= 10);
  const counts = new Array(10).fill(0);
  for (const a of amounts) counts[Number(String(Math.floor(a))[0])] += 1;
  let chi = 0;
  for (let d = 1; d <= 9; d++) { const exp = BENFORD[d] * amounts.length; if (exp > 0) chi += ((counts[d] - exp) ** 2) / exp; }
  const benford = amounts.length >= 50
    ? { n: amounts.length, chiSquare: Math.round(chi * 100) / 100, critical: 15.51, conforms: chi <= 15.51, observed: counts.slice(1).map((c) => Math.round((c / amounts.length) * 1000) / 1000) }
    : { n: amounts.length, note: 'fewer than 50 amounts — too few for Benford to mean anything' };

  const exceptions = Object.values(tests).reduce((a, x) => a + x.length, 0) + (benford.conforms === false ? 1 : 0);
  const r = exec('INSERT INTO ia_analytics (period_from, period_to, entries, exceptions, results, created_by) VALUES (?,?,?,?,?,?)',
    from, to, entries.length, exceptions, JSON.stringify({ tests, benford, limit }), actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'internalaudit.analytics', subjectType: 'ia_analytics', subjectId: Number(r.lastInsertRowid), payload: { entries: entries.length, exceptions } });
  return { id: Number(r.lastInsertRowid), entries: entries.length, exceptions, tests, benford, limit };
}

/** Turn a test's exceptions into one finding with the evidence attached. */
export function raiseFromAnalytics({ runId, test, actor }) {
  const r = one('SELECT * FROM ia_analytics WHERE id = ?', Number(runId));
  if (!r) refuse('no such analytics run', 404);
  const res = JSON.parse(r.results);
  const items = res.tests[test];
  if (!items?.length) refuse('that test found nothing to raise');
  const TITLES = {
    unbalanced: 'Journal entries that do not balance', weekend: 'Manual postings on non-working days', round: 'Large round-amount entries',
    duplicates: 'Possible duplicate entries', nearLimit: 'Amounts just under the approval limit', selfApproved: 'Entries posted by the person who created them',
  };
  return addFinding({
    title: TITLES[test] || test, rating: ['unbalanced', 'duplicates', 'selfApproved'].includes(test) ? 'high' : 'medium',
    criteria: 'Posted entries should be balanced, unique, segregated and free of patterns that suggest limits are being avoided.',
    condition: `${items.length} entr${items.length === 1 ? 'y' : 'ies'} in the analytics run of ${r.created_at}.`,
    source: 'analytics', evidence: items.slice(0, 50), actor,
  });
}

export function overview() {
  seedUniverse();
  const last = one('SELECT * FROM ia_analytics ORDER BY id DESC LIMIT 1');
  return {
    plan: plan(12),
    entities: one('SELECT COUNT(*) AS n FROM ia_entities').n,
    engagements: q('SELECT e.*, x.name AS area, (SELECT COUNT(*) FROM ia_findings f WHERE f.engagement_id = e.id) AS findings FROM ia_engagements e LEFT JOIN ia_entities x ON x.id = e.entity_id ORDER BY e.id DESC LIMIT 40'),
    findings: q("SELECT * FROM ia_findings ORDER BY CASE state WHEN 'verified' THEN 1 ELSE 0 END, CASE rating WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT 60"),
    overdue: one("SELECT COUNT(*) AS n FROM ia_findings WHERE state NOT IN ('implemented','verified') AND due < date('now')").n,
    analytics: last ? { ...last, results: JSON.parse(last.results) } : null,
    drafts: draftsFor('internalaudit', null, null, 5),
  };
}
