// Policies, procedures, processes — the company's written rules, and the
// external laws they answer to.
//
// Six kinds, because they are read differently: a law is something the
// company must obey and does not write; a policy says what and why; a
// procedure says how, step by step; a process says who hands what to whom,
// with the control at each step; a work instruction is one task in detail; a
// standard is a measurable bar. Each has an owner, a version history that is
// never overwritten, and a date it must be read again by.
//
// An employee may draft. Publishing is a person's act — a rule the company
// holds itself to cannot be issued by the thing it governs — and once a
// version is published, everyone it applies to can be asked to acknowledge
// having read *that* version.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
export const KINDS = ['law', 'policy', 'procedure', 'process', 'instruction', 'standard'];
const PREFIX = { law: 'LAW', policy: 'POL', procedure: 'SOP', process: 'PRC', instruction: 'WI', standard: 'STD' };
const STATES = ['draft', 'review', 'published', 'retired'];
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const addMonths = (months) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + Number(months || 12)); return d.toISOString().slice(0, 10); };

function nextCode(kind) {
  const p = PREFIX[kind];
  const last = one('SELECT code FROM pol_docs WHERE code LIKE ? ORDER BY id DESC LIMIT 1', `${p}-%`)?.code;
  const n = last ? Number(last.split('-')[1]) + 1 : 1;
  return `${p}-${String(n).padStart(3, '0')}`;
}

/** A process's steps, checked: each needs what happens and who does it. */
function cleanSteps(steps) {
  if (steps == null) return null;
  if (!Array.isArray(steps)) refuse('steps are a list');
  return JSON.stringify(steps.slice(0, 60).map((s, i) => {
    if (!clean(s.step) || !clean(s.role)) refuse(`step ${i + 1} needs what happens and who does it`);
    return { step: clean(s.step, 300), role: clean(s.role, 80), input: clean(s.input, 200), output: clean(s.output, 200), control: clean(s.control, 200) };
  }));
}

export function createDoc({ kind, title, owner = null, scope = null, body = '', steps = null, isoRefs = null, reviewMonths = 12, actor }) {
  if (!actor) refuse('a document has to name who started it');
  if (!KINDS.includes(kind)) refuse(`kind must be one of: ${KINDS.join(', ')}`);
  if (!clean(title)) refuse('a title, please');
  const code = nextCode(kind);
  const r = exec(`INSERT INTO pol_docs (code, kind, title, owner, scope, body, steps, iso_refs, review_months, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`,
  code, kind, clean(title), clean(owner, 80) || null, clean(scope, 500) || null, String(body || ''), cleanSteps(steps),
  isoRefs ? JSON.stringify(isoRefs.slice(0, 30).map((x) => clean(x, 40))) : null, Math.max(1, Math.min(60, Number(reviewMonths) || 12)), actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'policies.created', subjectType: 'pol_doc', subjectId: id, payload: { code, kind, title } });
  return getDoc(id);
}

/** Edit the working copy. A published document goes back to draft, as a new version. */
export function editDoc({ id, title = null, body = null, steps = null, owner = null, scope = null, isoRefs = null, note = null, actor }) {
  const d = one('SELECT * FROM pol_docs WHERE id = ?', Number(id));
  if (!d) refuse('no such document', 404);
  if (d.state === 'retired') refuse('a retired document is read, not edited');
  if (d.state === 'published') {
    // The published text stays in the history exactly as people acknowledged it.
    exec('INSERT INTO pol_versions (doc_id, version, body, steps, note, changed_by) VALUES (?,?,?,?,?,?)', d.id, d.version, d.body, d.steps, 'superseded', actor);
    exec("UPDATE pol_docs SET version = version + 1, state = 'draft', approved_by = NULL WHERE id = ?", d.id);
  }
  exec(`UPDATE pol_docs SET title = COALESCE(?, title), body = COALESCE(?, body), steps = COALESCE(?, steps), owner = COALESCE(?, owner),
        scope = COALESCE(?, scope), iso_refs = COALESCE(?, iso_refs), updated_at = datetime('now') WHERE id = ?`,
  title ? clean(title) : null, body != null ? String(body) : null, steps != null ? cleanSteps(steps) : null, owner ? clean(owner, 80) : null,
  scope ? clean(scope, 500) : null, isoRefs ? JSON.stringify(isoRefs.map((x) => clean(x, 40))) : null, d.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'policies.edited', subjectType: 'pol_doc', subjectId: d.id, payload: { note } });
  return getDoc(d.id);
}

export function setState({ id, state, actor }) {
  const d = one('SELECT * FROM pol_docs WHERE id = ?', Number(id));
  if (!d) refuse('no such document', 404);
  if (!STATES.includes(state)) refuse(`state must be one of: ${STATES.join(', ')}`);
  if (state === 'published') {
    if (!isHuman(actor)) refuse('publishing a rule is a person’s act', 403);
    if (!d.body.trim() && !d.steps) refuse('there is nothing to publish yet');
    if (d.created_by === actor && d.kind !== 'law' && d.state !== 'review') refuse('send it to review first — the author does not approve their own rule straight from draft');
    exec('INSERT INTO pol_versions (doc_id, version, body, steps, note, changed_by) VALUES (?,?,?,?,?,?)', d.id, d.version, d.body, d.steps, 'published', actor);
    exec("UPDATE pol_docs SET state = 'published', approved_by = ?, published_at = datetime('now'), next_review = ?, updated_at = datetime('now') WHERE id = ?",
      actor, addMonths(d.review_months), d.id);
  } else {
    if (state === 'retired' && !isHuman(actor)) refuse('retiring a rule is a person’s act', 403);
    exec("UPDATE pol_docs SET state = ?, updated_at = datetime('now') WHERE id = ?", state, d.id);
  }
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `policies.${state}`, subjectType: 'pol_doc', subjectId: d.id, payload: { code: d.code, version: d.version } });
  return getDoc(d.id);
}

/** "I have read version N." Only a published version can be acknowledged. */
export function acknowledge({ id, user }) {
  const d = one("SELECT * FROM pol_docs WHERE id = ? AND state = 'published'", Number(id));
  if (!d) refuse('only a published document can be acknowledged');
  exec('INSERT OR IGNORE INTO pol_acks (doc_id, version, username) VALUES (?,?,?)', d.id, d.version, user.username);
  audit({ actorType: 'human', actorId: `human:${user.username}`, action: 'policies.acknowledged', subjectType: 'pol_doc', subjectId: d.id, payload: { version: d.version } });
  return { ok: true };
}

export function draft({ id, instructions = '', lang = 'ar', actor }) {
  const d = getDoc(id);
  const brief = `${d.kind.toUpperCase()} ${d.code}: "${d.title}". Scope: ${d.scope || '[TO CONFIRM]'}. Owner: ${d.owner || '[TO CONFIRM]'}.
${d.kind === 'process' ? 'Write the process as numbered steps; for each step give who does it, the input, the output and the control that catches a mistake. Put the steps in "items" as {step, role, input, output, control}.' : ''}
${d.kind === 'procedure' || d.kind === 'instruction' ? 'Write numbered steps a new employee could follow without asking anybody.' : ''}
${d.kind === 'policy' ? 'Sections: purpose, scope, policy statements, roles and responsibilities, exceptions, consequences of breach, related documents.' : ''}
${d.kind === 'law' ? 'Summarise what the law requires of this company, article by article, and what the company must do to comply. Do not invent article numbers.' : ''}
${d.iso_refs?.length ? `It must satisfy: ${d.iso_refs.join(', ')}.` : ''}
${instructions ? `The person asking adds: ${instructions}` : ''}
${d.body ? `The current text, to improve rather than replace:\n${d.body.slice(0, 6000)}` : ''}`;
  return requestDraft({ dept: 'policies', subjectType: 'pol_doc', subjectId: d.id, kind: d.kind, agentId: 'AGT-POL-001', brief, lang, actor, exclude: d.code });
}

export function getDoc(id) {
  const d = one('SELECT * FROM pol_docs WHERE id = ?', Number(id));
  if (!d) refuse('no such document', 404);
  return {
    ...d,
    steps: d.steps ? JSON.parse(d.steps) : null,
    iso_refs: d.iso_refs ? JSON.parse(d.iso_refs) : [],
    versions: q('SELECT id, version, note, changed_by, created_at FROM pol_versions WHERE doc_id = ? ORDER BY id DESC', d.id),
    acks: q('SELECT username, acked_at FROM pol_acks WHERE doc_id = ? AND version = ? ORDER BY acked_at', d.id, d.version),
    drafts: draftsFor('policies', 'pol_doc', d.id, 5),
  };
}

export function overview({ kind = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const docs = q(`SELECT id, code, kind, title, owner, state, version, next_review, updated_at,
                  (SELECT COUNT(*) FROM pol_acks a WHERE a.doc_id = d.id AND a.version = d.version) AS acks
                  FROM pol_docs d ${kind && KINDS.includes(kind) ? 'WHERE kind = ?' : ''} ORDER BY kind, code`, ...(kind && KINDS.includes(kind) ? [kind] : []));
  return {
    kinds: KINDS,
    counts: Object.fromEntries(KINDS.map((k) => [k, one('SELECT COUNT(*) AS n FROM pol_docs WHERE kind = ?', k).n])),
    published: one("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published'").n,
    inReview: one("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'review'").n,
    overdue: q("SELECT id, code, title, next_review FROM pol_docs WHERE state = 'published' AND next_review < ? ORDER BY next_review", today),
    users: one("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n,
    docs,
  };
}
