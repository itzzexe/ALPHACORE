// THE GOVERNANCE MAP — one sheet for the second and third lines of defence.
//
// The departments that keep the company honest each see their own corner: the
// auditor sees findings, the quality manager nonconformities, operations its
// red numbers. The connections between them are where things fall through — a
// finding that should have changed a policy, a red KPI nobody treated as a
// nonconformity, a large risk with no insurance behind it. This module reads
// across all of them, draws the heat map, and proposes the connection.
//
// It proposes; it never acts. Accepting a proposal is a person's decision, made
// with the permission of the department it acts in — accepting "revise the
// policy" needs the right to manage policies — and what it does is the same
// thing that department's own page would do, with the proposal as the reason.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { hasPerm } from './auth.js';
import { relatedDocuments } from './context.js';
import * as Policies from './policies.js';
import * as Iso from './iso.js';
import * as Ops from './opscenter.js';
import * as Aml from './aml.js';
import { overview as insuranceOverview } from './insurance.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const SYSTEM = 'system:assurance';

/** What each kind of proposal does when accepted, and the permission that takes. */
const KINDS = {
  finding_policy: { perm: 'policies.manage', route: '#/policies' },
  finding_procedure: { perm: 'policies.manage', route: '#/policies' },
  issue_ncr: { perm: 'iso.manage', route: '#/iso' },
  risk_insurance: { perm: 'insurance.manage', route: '#/insurance' },
  aml_review: { perm: 'aml.manage', route: '#/aml' },
};

// Which insurance line answers which kind of risk, in either language.
const LINE_WORDS = {
  cyber: /cyber|hack|ransom|breach|malware|phish|اختراق|سيبر|فدية|تسريب|قرصنة/i,
  property: /fire|flood|property|building|warehouse|premises|حريق|فيضان|مبنى|مستودع|مقر|ممتلكات/i,
  liability: /liabilit|lawsuit|third.party|injur|دعوى|مسؤولية|تعويض|إصابة/i,
  fleet: /vehicle|fleet|truck|\bcar\b|lorry|مركب|أسطول|شاحن|سيار/i,
  health: /health|medical|illness|صح|طب|مرض/i,
  directors: /director|board|governance failure|مجلس الإدارة|أعضاء المجلس/i,
  marine: /marine|ship|cargo|vessel|بحري|شحن|سفين/i,
};

/**
 * The sentences each proposal is told in. Stored filled in English for the
 * record, and with their particulars apart, so the console fills the same
 * template in the reader's language.
 */
export const TEMPLATES = {
  finding_policy: ['Revise {code} “{doc}” in light of the finding “{finding}”', 'The audit found: {condition}. The closest rule in force is {code}; a finding the rule does not answer will be found again.'],
  finding_procedure: ['Write a procedure for “{finding}”', 'The audit found: {condition}. No published rule covers it, so nobody is told how it should be done.'],
  issue_ncr: ['Raise a nonconformity for “{kpi}”', '{kpi} read {value}{unit} against a target of {target}{unit}. ISO 9001 clause 9.1 asks that performance be measured and acted on; as a nonconformity it goes through root cause and corrective action.'],
  risk_insurance: ['Get {line} cover for the risk “{risk}”', 'The risk scores {score} of 25 and the company holds no active {line} policy. Insurance is the transfer half of treating it.'],
  aml_review: ['Prepare the enhanced due-diligence memo for “{party}”', 'A high-risk party is subject to enhanced due diligence, and none has been prepared.'],
};
const fill = (tpl, params) => tpl.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? ''));

function propose(kind, fromType, fromId, params, toRef = null) {
  const [title, why] = TEMPLATES[kind];
  const r = exec('INSERT OR IGNORE INTO gov_proposals (kind, from_type, from_id, to_ref, title, why, params) VALUES (?,?,?,?,?,?,?)',
    kind, fromType, String(fromId), toRef == null ? null : String(toRef), fill(title, params).slice(0, 300), fill(why, params).slice(0, 1000), JSON.stringify(params));
  return r.changes > 0;
}

/** Look across the departments and propose what is missing between them. Idempotent: one proposal per source, ever. */
export function sweep() {
  let made = 0;
  const POLICY_CODE = /^(LAW|POL|SOP|PRC|WI|STD)-\d+$/;

  // A finding is a statement that a rule was missing or not followed: the rule should change.
  for (const f of q("SELECT * FROM ia_findings WHERE state IN ('open','in_progress') AND rating IN ('high','medium')")) {
    if (one("SELECT 1 FROM gov_proposals WHERE from_type = 'ia_finding' AND from_id = ?", String(f.id))) continue;
    const hit = relatedDocuments(`${f.title} ${f.criteria} ${f.condition}`, { k: 5 }).find((d) => POLICY_CODE.test(d.cite.split(' ')[0]));
    if (hit) {
      const doc = one('SELECT id, code, title FROM pol_docs WHERE code = ?', hit.cite.split(' ')[0]);
      if (doc && propose('finding_policy', 'ia_finding', f.id, { code: doc.code, doc: doc.title, finding: f.title, condition: f.condition }, doc.id)) made++;
    } else if (propose('finding_procedure', 'ia_finding', f.id, { finding: f.title, condition: f.condition })) made++;
  }

  // A KPI past its warning line is a nonconformity with clause 9.1 whether or not anyone files it.
  for (const i of q(`SELECT i.id, k.id AS kpi_id, k.name AS kpi, k.unit, k.target FROM ops_issues i JOIN ops_kpis k ON k.id = i.kpi_id WHERE i.state = 'open'`)) {
    const reading = one('SELECT value FROM ops_readings WHERE kpi_id = ? ORDER BY id DESC LIMIT 1', i.kpi_id);
    if (propose('issue_ncr', 'ops_issue', i.id, { kpi: i.kpi, value: reading?.value ?? '?', unit: i.unit || '', target: i.target })) made++;
  }

  // A large risk is treated by reducing it or transferring it; an uncovered line is neither.
  const covered = new Set(q("SELECT DISTINCT line FROM ins_policies WHERE state = 'active' AND ends >= date('now')").map((r) => r.line));
  for (const r of q("SELECT * FROM risks WHERE state = 'open' AND likelihood * impact >= 12")) {
    const text = `${r.title} ${r.mitigation || ''}`;
    for (const [line, re] of Object.entries(LINE_WORDS)) {
      if (!re.test(text) || covered.has(line)) continue;
      if (propose('risk_insurance', 'risk', `${r.id}:${line}`, { line, risk: r.title, score: r.likelihood * r.impact }, line)) made++;
    }
  }

  // A high-risk party without a due-diligence memo is enhanced due diligence not yet done.
  for (const p of q("SELECT id, name FROM aml_parties WHERE state = 'active' AND risk_level = 'high'")) {
    if (one("SELECT 1 FROM draft_jobs WHERE dept = 'aml' AND subject_type = 'aml_party' AND subject_id = ?", String(p.id))) continue;
    if (propose('aml_review', 'aml_party', p.id, { party: p.name })) made++;
  }
  if (made) audit({ actorType: 'system', actorId: SYSTEM, action: 'assurance.proposed', subjectType: 'gov_proposals', subjectId: 'sweep', payload: { made } });
  return { made };
}

/** Accept (and do it) or dismiss (with a reason). A person, with the acting department's permission. */
export function decide({ id, verdict, reason = '', user }) {
  const p = one('SELECT * FROM gov_proposals WHERE id = ?', Number(id));
  if (!p) refuse('no such proposal', 404);
  if (p.state !== 'proposed') refuse(`already ${p.state}`);
  if (!user) refuse('a person decides', 403);
  const spec = KINDS[p.kind];
  if (!hasPerm(user, spec.perm)) refuse(`deciding this needs ${spec.perm}`, 403);
  const actor = `human:${user.username}`;
  if (verdict === 'dismiss') {
    if (!String(reason).trim()) refuse('say why it does not apply');
    exec("UPDATE gov_proposals SET state = 'dismissed', decided_by = ?, decided_at = datetime('now'), reason = ? WHERE id = ?", actor, String(reason).slice(0, 1000), p.id);
    audit({ actorType: 'human', actorId: actor, action: 'assurance.dismissed', subjectType: 'gov_proposal', subjectId: p.id, payload: { kind: p.kind, reason: String(reason).slice(0, 200) } });
    return one('SELECT * FROM gov_proposals WHERE id = ?', p.id);
  }
  if (verdict !== 'accept') refuse('accept or dismiss');

  let result;
  if (p.kind === 'finding_policy') {
    const f = one('SELECT * FROM ia_findings WHERE id = ?', Number(p.from_id));
    const job = Policies.draft({ id: Number(p.to_ref), instructions: `Revise it so that this audit finding cannot recur. Finding: ${f.title}. Criteria: ${f.criteria}. Condition: ${f.condition}. Recommendation: ${f.recommendation || '[TO CONFIRM]'}`, actor });
    result = `draft_job:${job.id}`;
  } else if (p.kind === 'finding_procedure') {
    const f = one('SELECT * FROM ia_findings WHERE id = ?', Number(p.from_id));
    const doc = Policies.createDoc({ kind: 'procedure', title: `Procedure: ${f.title}`.slice(0, 200), owner: f.owner, actor });
    Policies.draft({ id: doc.id, instructions: `Write the procedure that closes this audit finding. Criteria: ${f.criteria}. Condition: ${f.condition}. Recommendation: ${f.recommendation || '[TO CONFIRM]'}`, actor });
    result = `pol_doc:${doc.id}`;
  } else if (p.kind === 'issue_ncr') {
    const i = one('SELECT * FROM ops_issues WHERE id = ?', Number(p.from_id));
    const n = Iso.raiseNcr({ standard: 'ISO 9001', clauseRef: '9.1', source: 'internal', description: i.title, severity: i.severity === 'high' ? 'major' : 'minor', owner: i.owner, actor });
    result = `iso_ncr:${n.id}`;
  } else if (p.kind === 'risk_insurance') {
    const riskId = Number(String(p.from_id).split(':')[0]);
    const r = one('SELECT title FROM risks WHERE id = ?', riskId);
    const i = Ops.addIssue({ title: `Get ${p.to_ref} insurance quotes — risk “${r?.title || riskId}”`, severity: 'high', actor });
    result = `ops_issue:${i.id}`;
  } else if (p.kind === 'aml_review') {
    const job = Aml.review({ partyId: Number(p.from_id), actor });
    result = `draft_job:${job.id}`;
  }
  exec("UPDATE gov_proposals SET state = 'accepted', decided_by = ?, decided_at = datetime('now'), result_ref = ? WHERE id = ?", actor, result, p.id);
  audit({ actorType: 'human', actorId: actor, action: 'assurance.accepted', subjectType: 'gov_proposal', subjectId: p.id, payload: { kind: p.kind, result } });
  return one('SELECT * FROM gov_proposals WHERE id = ?', p.id);
}

// ------------------------------------------------------------- the map --

const n = (sql, ...a) => { try { return one(sql, ...a)?.n || 0; } catch { return 0; } };
const tile = (id, label, route, status, figures, note = null) => ({ id, label, route, status, figures, note });

/** Each area as green, amber or red, with the figures that make it so. */
export function heatmap() {
  const rows = [];

  const published = n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published'");
  const overdue = n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published' AND next_review < date('now')");
  rows.push(tile('policies', 'Policies & procedures', '#/policies',
    !published ? 'amber' : overdue / published > 0.2 ? 'red' : overdue ? 'amber' : 'green',
    [['Published', published], ['Review overdue', overdue], ['In review', n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'review'")]],
    !published ? 'no published rules yet' : null));

  const std = q("SELECT standard, SUM(CASE WHEN status IN ('implemented','verified') THEN 1.0 WHEN status = 'partial' THEN 0.5 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN status <> 'na' THEN 1 ELSE 0 END), 0) AS r FROM iso_clauses GROUP BY standard");
  const best = std.reduce((a, s) => Math.max(a, Math.round(s.r || 0)), 0);
  const majors = n("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed' AND severity = 'major'");
  rows.push(tile('iso', 'Quality & ISO', '#/iso', majors ? 'red' : best < 60 ? 'amber' : 'green',
    [['Best readiness %', best], ['Major NCRs open', majors], ['NCRs open', n("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed'")]]));

  const highOpen = n("SELECT COUNT(*) AS n FROM ia_findings WHERE state <> 'verified' AND rating = 'high'");
  const late = n("SELECT COUNT(*) AS n FROM ia_findings WHERE state NOT IN ('implemented','verified') AND due < date('now')");
  rows.push(tile('internalaudit', 'Internal & financial audit', '#/internalaudit', late || highOpen ? 'red' : n("SELECT COUNT(*) AS n FROM ia_findings WHERE state <> 'verified'") ? 'amber' : 'green',
    [['High findings open', highOpen], ['Overdue actions', late], ['Engagements', n('SELECT COUNT(*) AS n FROM ia_engagements')]]));

  const issues = n("SELECT COUNT(*) AS n FROM ops_issues WHERE state = 'open'");
  const highIssues = n("SELECT COUNT(*) AS n FROM ops_issues WHERE state = 'open' AND severity = 'high'");
  rows.push(tile('opscenter', 'Operations center', '#/opscenter', highIssues ? 'red' : issues ? 'amber' : 'green',
    [['Open issues', issues], ['KPIs', n('SELECT COUNT(*) AS n FROM ops_kpis')]]));

  const alerts = n("SELECT COUNT(*) AS n FROM aml_alerts WHERE state IN ('open','investigating')");
  const due = n("SELECT COUNT(*) AS n FROM aml_parties WHERE state = 'active' AND next_review < date('now')");
  rows.push(tile('aml', 'AML & KYC', '#/aml', alerts ? 'red' : due ? 'amber' : 'green',
    [['Open alerts', alerts], ['Reviews due', due], ['High-risk parties', n("SELECT COUNT(*) AS n FROM aml_parties WHERE state = 'active' AND risk_level = 'high'")]]));

  let ins = { uncovered: [], renewals: [] };
  try { ins = insuranceOverview(); } catch { /* fresh install */ }
  const soon = (ins.renewals || []).filter((p) => p.ends <= new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10)).length;
  rows.push(tile('insurance', 'Insurance', '#/insurance', soon ? 'red' : (ins.uncovered || []).length ? 'amber' : 'green',
    [['Renewing within 60 days', (ins.renewals || []).length], ['Lines with no cover', (ins.uncovered || []).length]]));

  const held = n("SELECT COUNT(*) AS n FROM remit_message WHERE state = 'held'");
  rows.push(tile('remit', 'Remittances & SWIFT', '#/remit', held ? 'red' : 'green',
    [['Held by screening', held], ['Awaiting approval', n("SELECT COUNT(*) AS n FROM remit_message WHERE state = 'draft'")]]));

  const bigRisks = n("SELECT COUNT(*) AS n FROM risks WHERE state = 'open' AND likelihood * impact >= 15");
  const bare = n("SELECT COUNT(*) AS n FROM risks WHERE state = 'open' AND likelihood * impact >= 15 AND COALESCE(mitigation, '') = ''");
  rows.push(tile('risks', 'Risk register', '#/risks', bare ? 'red' : bigRisks ? 'amber' : 'green',
    [['Severe risks open', bigRisks], ['With no mitigation', bare]]));

  return rows;
}

export function overview() {
  sweep();
  return {
    map: heatmap(),
    proposals: q("SELECT * FROM gov_proposals ORDER BY CASE state WHEN 'proposed' THEN 0 ELSE 1 END, id DESC LIMIT 80")
      .map((p) => ({ ...p, params: p.params ? JSON.parse(p.params) : null, template: TEMPLATES[p.kind], perm: KINDS[p.kind]?.perm, route: KINDS[p.kind]?.route })),
    counts: Object.fromEntries(['proposed', 'accepted', 'dismissed'].map((s) => [s, n('SELECT COUNT(*) AS n FROM gov_proposals WHERE state = ?', s)])),
  };
}
