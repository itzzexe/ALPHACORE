// Quality and ISO — the management systems a certification body will audit,
// clause by clause, and the nonconformities that keep them honest.
//
// The standards share one skeleton (Annex SL: context, leadership, planning,
// support, operation, evaluation, improvement), so the clauses are seeded
// from it and each standard adds its own. A clause is not "done" because
// somebody ticked it: readiness counts implemented and verified clauses, and
// next to each one the platform shows the evidence it already holds — the
// published policies, the internal audits closed this year, the management
// reviews held, the corrective actions closed. An auditor asks for exactly
// that, and a gap the platform can see is a gap it says out loud.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
export const STATUSES = ['not_started', 'partial', 'implemented', 'verified', 'na'];

const ANNEX_SL = [
  ['4.1', 'Understanding the organization and its context'], ['4.2', 'Needs and expectations of interested parties'],
  ['4.3', 'Scope of the management system'], ['4.4', 'The management system and its processes'],
  ['5.1', 'Leadership and commitment'], ['5.2', 'Policy'], ['5.3', 'Roles, responsibilities and authorities'],
  ['6.1', 'Actions to address risks and opportunities'], ['6.2', 'Objectives and planning to achieve them'],
  ['7.1', 'Resources'], ['7.2', 'Competence'], ['7.3', 'Awareness'], ['7.4', 'Communication'], ['7.5', 'Documented information'],
  ['8.1', 'Operational planning and control'],
  ['9.1', 'Monitoring, measurement, analysis and evaluation'], ['9.2', 'Internal audit'], ['9.3', 'Management review'],
  ['10.1', 'Improvement'], ['10.2', 'Nonconformity and corrective action'], ['10.3', 'Continual improvement'],
];
export const STANDARDS = {
  'ISO 9001': { title: 'Quality management', extra: [['6.3', 'Planning of changes'], ['8.2', 'Requirements for products and services'], ['8.3', 'Design and development'], ['8.4', 'Control of externally provided processes, products and services'], ['8.5', 'Production and service provision'], ['8.6', 'Release of products and services'], ['8.7', 'Control of nonconforming outputs']] },
  'ISO 27001': { title: 'Information security', extra: [['6.1.2', 'Information security risk assessment'], ['6.1.3', 'Risk treatment and statement of applicability'], ['A.5', 'Organizational controls (37)'], ['A.6', 'People controls (8)'], ['A.7', 'Physical controls (14)'], ['A.8', 'Technological controls (34)']] },
  'ISO 14001': { title: 'Environmental management', extra: [['6.1.2', 'Environmental aspects'], ['6.1.3', 'Compliance obligations'], ['8.2', 'Emergency preparedness and response']] },
  'ISO 45001': { title: 'Occupational health and safety', extra: [['5.4', 'Consultation and participation of workers'], ['6.1.2', 'Hazard identification and assessment of risks'], ['8.2', 'Emergency preparedness and response']] },
  'ISO 22301': { title: 'Business continuity', extra: [['8.2', 'Business impact analysis and risk assessment'], ['8.3', 'Business continuity strategies and solutions'], ['8.4', 'Business continuity plans and procedures'], ['8.5', 'Exercise programme']] },
};

export function seedStandards({ actor = 'system:iso' } = {}) {
  let made = 0;
  for (const [std, def] of Object.entries(STANDARDS)) {
    const clauses = [...ANNEX_SL, ...def.extra].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
    for (const [ref, title] of clauses) {
      const r = exec('INSERT OR IGNORE INTO iso_clauses (standard, ref, title) VALUES (?,?,?)', std, ref, title);
      made += r.changes;
    }
  }
  if (made) audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'iso.seeded', subjectType: 'iso', subjectId: 'clauses', payload: { clauses: made } });
  return made;
}

/** What this platform already holds that an auditor would accept as evidence for a clause. */
function platformEvidence(ref) {
  const n = (sql) => { try { return one(sql).n; } catch { return 0; } };
  const map = {
    '5.2': () => `${n("SELECT COUNT(*) AS n FROM pol_docs WHERE kind = 'policy' AND state = 'published'")} published policies`,
    '6.1': () => `${n('SELECT COUNT(*) AS n FROM risks')} risks in the register`,
    '7.5': () => `${n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published'")} controlled documents published, with version history`,
    '8.1': () => `${n("SELECT COUNT(*) AS n FROM pol_docs WHERE kind IN ('process','procedure') AND state = 'published'")} published processes and procedures`,
    '9.1': () => `${n('SELECT COUNT(*) AS n FROM ops_kpis')} operational KPIs measured`,
    '9.2': () => `${n("SELECT COUNT(*) AS n FROM ia_engagements WHERE state = 'closed' AND closed_at >= datetime('now','-12 months')")} internal audits closed in 12 months`,
    '9.3': () => `${n("SELECT COUNT(*) AS n FROM iso_reviews WHERE created_at >= datetime('now','-12 months')")} management reviews held in 12 months`,
    '10.2': () => {
      const closed = n("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state = 'closed'");
      return `${closed} nonconformities closed, ${n('SELECT COUNT(*) AS n FROM iso_ncrs') - closed} open`;
    },
  };
  return map[ref] ? map[ref]() : null;
}

export function setClause({ id, status = null, owner = null, evidence = null, actor }) {
  const c = one('SELECT * FROM iso_clauses WHERE id = ?', Number(id));
  if (!c) refuse('no such clause', 404);
  if (status && !STATUSES.includes(status)) refuse(`status must be one of: ${STATUSES.join(', ')}`);
  // "Verified" means somebody checked the evidence, which a machine cannot sign.
  if (status === 'verified' && !isHuman(actor)) refuse('verifying a clause is a person’s act', 403);
  if (status === 'verified' && !clean(evidence ?? c.evidence)) refuse('a verified clause names its evidence');
  exec(`UPDATE iso_clauses SET status = COALESCE(?, status), owner = COALESCE(?, owner), evidence = COALESCE(?, evidence),
        updated_by = ?, updated_at = datetime('now') WHERE id = ?`, status, owner ? clean(owner, 80) : null, evidence != null ? clean(evidence, 2000) : null, actor, c.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'iso.clause_set', subjectType: 'iso_clause', subjectId: c.id, payload: { standard: c.standard, ref: c.ref, status } });
  return one('SELECT * FROM iso_clauses WHERE id = ?', c.id);
}

export function readiness(standard) {
  const rows = q('SELECT status FROM iso_clauses WHERE standard = ?', standard);
  const applicable = rows.filter((r) => r.status !== 'na');
  if (!applicable.length) return { clauses: rows.length, readiness: 0 };
  const score = applicable.reduce((a, r) => a + (r.status === 'verified' || r.status === 'implemented' ? 1 : r.status === 'partial' ? 0.5 : 0), 0);
  return {
    clauses: rows.length,
    readiness: Math.round((score / applicable.length) * 100),
    verified: rows.filter((r) => r.status === 'verified').length,
    gaps: applicable.filter((r) => r.status === 'not_started').length,
  };
}

// ------------------------------------------------------------- NCR / CAPA --

const NCR_NEXT = { open: ['action'], action: ['verify'], verify: ['closed', 'action'], closed: [] };

export function raiseNcr({ standard = null, clauseRef = null, source = 'internal', description, severity = 'minor', owner = null, due = null, actor }) {
  if (!clean(description)) refuse('describe what was found');
  if (!['observation', 'minor', 'major'].includes(severity)) refuse('observation, minor or major');
  const r = exec('INSERT INTO iso_ncrs (standard, clause_ref, source, description, severity, owner, due, created_by) VALUES (?,?,?,?,?,?,?,?)',
    standard, clauseRef, source, clean(description, 2000), severity, clean(owner, 80) || null, due, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'iso.ncr_raised', subjectType: 'iso_ncr', subjectId: Number(r.lastInsertRowid), payload: { standard, clauseRef, severity } });
  return one('SELECT * FROM iso_ncrs WHERE id = ?', Number(r.lastInsertRowid));
}

/**
 * Move a nonconformity on. Corrective action cannot start without a root
 * cause, closing needs a person to say the action worked — "we fixed it" and
 * "it stayed fixed" are different claims, and only the second closes it.
 */
export function advanceNcr({ id, to, rootCause = null, correction = null, correctiveAction = null, effective = null, actor }) {
  const n = one('SELECT * FROM iso_ncrs WHERE id = ?', Number(id));
  if (!n) refuse('no such nonconformity', 404);
  if (!NCR_NEXT[n.state].includes(to)) refuse(`from ${n.state} it can go to: ${NCR_NEXT[n.state].join(', ') || 'nowhere'}`);
  if (to === 'action' && !clean(rootCause ?? n.root_cause)) refuse('corrective action starts from a root cause — why did it happen?');
  if (to === 'verify' && !clean(correctiveAction ?? n.corrective_action)) refuse('say what was done so it cannot happen again');
  if (to === 'closed') {
    if (!isHuman(actor)) refuse('closing a nonconformity is a person’s judgement', 403);
    if (effective !== true) refuse('close it only when the action was effective — otherwise send it back to action');
  }
  exec(`UPDATE iso_ncrs SET state = ?, root_cause = COALESCE(?, root_cause), correction = COALESCE(?, correction),
        corrective_action = COALESCE(?, corrective_action), effective = COALESCE(?, effective),
        verified_by = CASE WHEN ? = 'closed' THEN ? ELSE verified_by END, closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END
        WHERE id = ?`, to, rootCause ? clean(rootCause, 2000) : null, correction ? clean(correction, 2000) : null,
  correctiveAction ? clean(correctiveAction, 2000) : null, effective == null ? null : (effective ? 1 : 0), to, actor, to, n.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `iso.ncr_${to}`, subjectType: 'iso_ncr', subjectId: n.id });
  return one('SELECT * FROM iso_ncrs WHERE id = ?', n.id);
}

/** A management review, recorded with the numbers it was held against. */
export function holdReview({ standard, attendees = '', decisions, actor }) {
  if (!isHuman(actor)) refuse('a management review is held by people', 403);
  if (!STANDARDS[standard]) refuse('no such standard');
  if (!clean(decisions)) refuse('a review without decisions is a meeting, not a review');
  const inputs = {
    readiness: readiness(standard),
    openNcrs: one("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed'").n,
    auditsClosed: one("SELECT COUNT(*) AS n FROM ia_engagements WHERE state = 'closed' AND closed_at >= datetime('now','-12 months')").n,
    policiesOverdue: one("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published' AND next_review < date('now')").n,
  };
  const r = exec('INSERT INTO iso_reviews (standard, held_on, attendees, inputs, decisions, created_by) VALUES (?, date(\'now\'), ?, ?, ?, ?)',
    standard, clean(attendees, 500), JSON.stringify(inputs), clean(decisions, 4000), actor);
  audit({ actorType: 'human', actorId: actor, action: 'iso.review_held', subjectType: 'iso_review', subjectId: Number(r.lastInsertRowid), payload: { standard } });
  return one('SELECT * FROM iso_reviews WHERE id = ?', Number(r.lastInsertRowid));
}

export function gapAnalysis({ standard, actor, lang = 'ar' }) {
  if (!STANDARDS[standard]) refuse('no such standard');
  const clauses = q('SELECT ref, title, status, evidence FROM iso_clauses WHERE standard = ? ORDER BY id', standard);
  const brief = `Gap analysis for ${standard} (${STANDARDS[standard].title}). For every clause not implemented, say what is missing, the smallest step that closes it, and which document or record would prove it. Order by what a certification auditor would raise first.
Clauses: ${clauses.map((c) => `${c.ref} ${c.title} — ${c.status}${c.evidence ? ` (evidence: ${c.evidence.slice(0, 80)})` : ''}`).join('; ')}`;
  return requestDraft({ dept: 'iso', subjectType: 'iso_standard', subjectId: standard, kind: 'gap-analysis', agentId: 'AGT-ISO-001', brief, lang, actor });
}

export function overview({ standard = 'ISO 9001' } = {}) {
  seedStandards();
  const std = STANDARDS[standard] ? standard : 'ISO 9001';
  return {
    standards: Object.entries(STANDARDS).map(([code, s]) => ({ code, title: s.title, ...readiness(code) })),
    standard: std,
    clauses: q('SELECT * FROM iso_clauses WHERE standard = ? ORDER BY id', std).map((c) => ({ ...c, platform: platformEvidence(c.ref) })),
    ncrs: q("SELECT * FROM iso_ncrs ORDER BY CASE state WHEN 'closed' THEN 1 ELSE 0 END, id DESC LIMIT 60"),
    reviews: q('SELECT * FROM iso_reviews ORDER BY id DESC LIMIT 10'),
    drafts: draftsFor('iso', 'iso_standard', std, 3),
  };
}
