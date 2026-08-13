// The trust centre — what the company tells somebody who has not bought yet.
//
// The material already exists: the SOC watches, compliance keeps a file,
// provenance issues receipts, the chain is witnessed. None of it is reachable
// by a prospect, so in practice the answer to "how do you handle security" is a
// PDF somebody writes once and never updates.
//
// So a published claim here carries its evidence, and the evidence is a live
// reading rather than a sentence: how many red-team findings are open right
// now, when the chain was last witnessed, how many subprocessors touch personal
// data. A trust centre that cannot be contradicted by its own system is
// marketing.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const clean = (s, n = 20000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const KINDS = ['policy', 'report', 'certificate', 'faq', 'architecture'];

/**
 * The live facts, read from the system every time somebody asks.
 *
 * Each one is deliberately a number this company would rather not have to
 * publish if it were bad — which is what makes publishing it worth anything.
 */
export function evidence() {
  const n = (sql, ...p) => { try { return one(sql, ...p).n; } catch { return null; } };
  const lastAnchor = (() => {
    try { return one('SELECT created_at FROM anchors WHERE ok = 1 ORDER BY id DESC LIMIT 1')?.created_at || null; }
    catch { return null; }
  })();
  return {
    openRedTeamFindings: n("SELECT COUNT(*) AS n FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL"),
    lastWitnessed: lastAnchor,
    hoursSinceWitnessed: lastAnchor
      ? Math.round((Date.now() - Date.parse(lastAnchor.replace(' ', 'T') + 'Z')) / 36e5)
      : null,
    auditEntries: n('SELECT COUNT(*) AS n FROM audit_log'),
    peopleOnFile: n('SELECT COUNT(*) AS n FROM pii_subjects'),
    peopleErased: n('SELECT COUNT(*) AS n FROM pii_subjects WHERE erased_at IS NOT NULL'),
    openPrivacyRequests: n("SELECT COUNT(*) AS n FROM dsr_requests WHERE state IN ('received','working')"),
    overduePrivacyRequests: n("SELECT COUNT(*) AS n FROM dsr_requests WHERE state IN ('received','working') AND datetime(due_at) < datetime('now')"),
    highRiskFlowsUndecided: n("SELECT COUNT(*) AS n FROM privacy_flows WHERE risk = 'high' AND state IN ('proposed','assessed')"),
    subprocessorsWithPersonalData: n('SELECT COUNT(*) AS n FROM subprocessors WHERE personal = 1 AND state = \'active\''),
    openIncidents: n("SELECT COUNT(*) AS n FROM incidents WHERE state <> 'closed'"),
  };
}

export function publishDocument({ title, kind, body, evidenceNote = null, owner, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('a public claim about this company is made by a person');
  if (!KINDS.includes(kind)) refuse(`kind must be one of: ${KINDS.join(', ')}`);
  if (!title || !body) refuse('a document needs a title and a body');
  exec(`INSERT INTO trust_documents (title, kind, body, evidence, owner, state, published_at)
        VALUES (?,?,?,?,?, 'published', datetime('now'))`,
  clean(title, 200), kind, clean(body), clean(evidenceNote, 2000) || null, clean(owner, 80) || actor);
  const d = one('SELECT * FROM trust_documents WHERE id = last_insert_rowid()');
  audit({
    actorType: 'human', actorId: actor, action: 'trust.published',
    subjectType: 'trust_document', subjectId: d.id, payload: { title: d.title, kind },
  });
  return d;
}

export function retireDocument({ id, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('withdrawing a published claim is a human act');
  exec("UPDATE trust_documents SET state = 'retired' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'trust.retired', subjectType: 'trust_document', subjectId: id, payload: {} });
  return one('SELECT * FROM trust_documents WHERE id = ?', id);
}

/**
 * Subprocessors — everyone else who touches the data.
 *
 * Kept here rather than in Vendors because the list a customer is entitled to
 * see is not the list of everyone we buy from: it is the subset that handles
 * their data, and conflating them either leaks commercial detail or hides a
 * processor.
 */
export function addSubprocessor({ name, purpose, location = null, personal = 0, dpaRef = null, actor }) {
  if (!actor) refuse('a subprocessor entry has to be signed');
  if (!name || !purpose) refuse('a subprocessor needs a name and what it is for');
  exec('INSERT INTO subprocessors (name, purpose, location, personal, dpa_ref) VALUES (?,?,?,?,?)',
    clean(name, 120), clean(purpose, 400), clean(location, 80) || null, personal ? 1 : 0, clean(dpaRef, 80) || null);
  const s = one('SELECT * FROM subprocessors WHERE id = last_insert_rowid()');
  audit({
    actorType: 'human', actorId: actor, action: 'trust.subprocessor_added',
    subjectType: 'subprocessor', subjectId: s.id, payload: { name: s.name, personal: Boolean(personal), location },
  });
  return s;
}

/** Seeded from the connectors that are actually configured, not from a wish list. */
export function suggestSubprocessors() {
  const known = new Set(q('SELECT name FROM subprocessors').map((r) => r.name.toLowerCase()));
  const out = [];
  try {
    for (const c of q("SELECT DISTINCT service FROM connectors WHERE state <> 'disabled'")) {
      if (c.service && !known.has(String(c.service).toLowerCase())) {
        out.push({ name: c.service, why: 'a live connector — data reaches it' });
      }
    }
  } catch { /* connectors table may be named differently in an older install */ }
  try {
    for (const p of q('SELECT DISTINCT provider FROM model_calls LIMIT 20')) {
      if (p.provider && p.provider !== 'mock' && !known.has(String(p.provider).toLowerCase())) {
        out.push({ name: p.provider, why: 'a model provider that has processed prompts' });
      }
    }
  } catch { /* no calls yet */ }
  return out.slice(0, 20);
}

/** What a prospect would see: published claims, and the numbers behind them. */
export function publicView() {
  return {
    documents: q("SELECT id, title, kind, body, published_at FROM trust_documents WHERE state = 'published' ORDER BY published_at DESC"),
    subprocessors: q("SELECT name, purpose, location, personal FROM subprocessors WHERE state = 'active' ORDER BY name"),
    evidence: evidence(),
  };
}

export function overview() {
  return {
    documents: q('SELECT * FROM trust_documents ORDER BY id DESC LIMIT 100'),
    published: one("SELECT COUNT(*) AS n FROM trust_documents WHERE state = 'published'").n,
    subprocessors: q('SELECT * FROM subprocessors ORDER BY personal DESC, name'),
    suggested: suggestSubprocessors(),
    evidence: evidence(),
    kinds: KINDS,
    note: 'Every published claim carries a live reading rather than a sentence. If the number is embarrassing, '
      + 'the honest options are to fix it or not to publish the claim — not to write a nicer sentence.',
  };
}
