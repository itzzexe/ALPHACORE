// OFFICIAL DOCUMENTS — a published policy, an audit report, a management
// review or a released payment, printed as the company's own paper and
// checkable by whoever holds the paper.
//
// Issuing a document freezes what it says: the content is snapshotted, hashed,
// given a code, and chained. The printed copy carries the code and a QR code
// pointing at /verify/<code>, which anybody can open without an account and
// which answers four questions: is this real, who approved it, when, and is it
// still the version in force. The verification page shows the record, not the
// text — a reader compares the paper to it, and a forged page has no record.
//
// Only something already final can be issued: a draft policy, an audit still
// in fieldwork or a payment nobody released has no official copy.
import { randomBytes, createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { getMessage } from './core2/remit.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');

/**
 * Each kind of document: who may issue it, who may read it, when it is final,
 * and what it says. `view` and `issue` are permissions; the handler checks them
 * because one route serves four departments.
 */
const TYPES = {
  policy: {
    label: 'Policy document', view: 'policies.view', issue: 'policies.manage',
    snapshot(id) {
      const d = one('SELECT * FROM pol_docs WHERE id = ?', Number(id));
      if (!d) refuse('no such document', 404);
      if (d.state !== 'published') refuse('only a published document has an official copy');
      return {
        title: `${d.code} · ${d.title}`, version: d.version,
        content: {
          code: d.code, kind: d.kind, title: d.title, version: d.version, owner: d.owner, scope: d.scope,
          body: d.body, steps: d.steps ? JSON.parse(d.steps) : null,
          approvedBy: d.approved_by, publishedAt: d.published_at, nextReview: d.next_review,
        },
      };
    },
    // A printed policy is most often wrong by being old; say so.
    current(issue) {
      const d = one('SELECT version, state FROM pol_docs WHERE id = ?', Number(issue.subject_id));
      if (!d) return { inForce: false, note: 'the document no longer exists' };
      if (d.state === 'retired') return { inForce: false, note: 'this document has been retired' };
      if (d.version !== issue.version) return { inForce: false, note: `superseded — version ${d.version} is the current one` };
      return { inForce: d.state === 'published' };
    },
  },
  audit: {
    label: 'Internal audit report', view: 'ia.view', issue: 'ia.manage',
    snapshot(id) {
      const e = one('SELECT e.*, x.name AS area FROM ia_engagements e LEFT JOIN ia_entities x ON x.id = e.entity_id WHERE e.id = ?', Number(id));
      if (!e) refuse('no such engagement', 404);
      if (!['followup', 'closed'].includes(e.state)) refuse('an audit report is issued once it gives an opinion — at follow-up or after closing');
      const findings = q('SELECT title, rating, criteria, condition, cause, effect, recommendation, action_plan, owner, due, state FROM ia_findings WHERE engagement_id = ? ORDER BY id', e.id);
      return {
        title: e.title, version: e.state === 'closed' ? 2 : 1,
        content: {
          title: e.title, kind: e.kind, area: e.area, objective: e.objective, scope: e.scope, lead: e.lead,
          opinion: e.opinion, state: e.state, closedAt: e.closed_at, findings,
        },
      };
    },
  },
  review: {
    label: 'Management review minutes', view: 'iso.view', issue: 'iso.manage',
    snapshot(id) {
      const r = one('SELECT * FROM iso_reviews WHERE id = ?', Number(id));
      if (!r) refuse('no such management review', 404);
      return {
        title: `${r.standard} — ${r.held_on}`, version: 1,
        content: { standard: r.standard, heldOn: r.held_on, attendees: r.attendees, decisions: r.decisions, inputs: r.inputs ? JSON.parse(r.inputs) : null, heldBy: r.created_by },
      };
    },
  },
  payment: {
    label: 'Payment advice', view: 'remit.view', issue: 'remit.release',
    snapshot(id) {
      const m = getMessage(Number(id));
      if (m.state !== 'released') refuse('a payment advice is issued for a released payment only');
      return {
        title: `${m.format} ${m.uetr}`, version: 1,
        content: {
          format: m.format, uetr: m.uetr, amount: m.amount, currency: m.currency, charges: m.charges,
          beneficiary: m.beneficiary, bic: m.bic, country: m.country, valueDate: m.value_date, remittanceInfo: m.remittance_info,
          builtBy: m.created_by, approvedBy: m.approved_by, releasedBy: m.released_by, releasedAt: m.released_at,
        },
      };
    },
  },
};
export const DOC_TYPES = Object.keys(TYPES);

const userHas = (user, perm) => user && (user.role === 'superadmin' || user.perms?.includes('*') || user.perms?.includes(perm));

/** Canonical JSON: keys sorted, so the same content always hashes the same. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Crockford's alphabet: no I, L, O or U, so a code read aloud or retyped from
// paper survives the trip.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newCode() {
  const b = randomBytes(12);
  const s = [...b].map((x) => ALPHABET[x % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/**
 * Issue the official copy. The same content issued twice gets the same code —
 * printing again is not a new document — and changed content gets a new one.
 */
export function issue({ type, id, user }) {
  const spec = TYPES[type];
  if (!spec) refuse(`a document is one of: ${DOC_TYPES.join(', ')}`);
  const actor = `human:${user?.username}`;
  if (!user || !isHuman(actor)) refuse('an official document is issued by a person', 403);
  if (!userHas(user, spec.issue)) refuse(`issuing a ${spec.label.toLowerCase()} needs ${spec.issue}`, 403);
  const snap = spec.snapshot(id);
  const digest = createHash('sha256').update(canonical(snap.content)).digest('hex');
  const same = one('SELECT * FROM doc_issues WHERE doc_type = ? AND subject_id = ? AND digest = ? AND revoked_at IS NULL', type, String(id), digest);
  if (same) return read(same.code, user);
  const code = newCode();
  exec('INSERT INTO doc_issues (code, doc_type, subject_id, version, title, snapshot, digest, issued_by) VALUES (?,?,?,?,?,?,?,?)',
    code, type, String(id), snap.version, String(snap.title).slice(0, 300), JSON.stringify(snap.content), digest, actor);
  audit({ actorType: 'human', actorId: actor, action: 'document.issued', subjectType: type, subjectId: String(id), payload: { code, digest, version: snap.version } });
  return read(code, user);
}

/** The issued document, for the person printing it. */
export function read(code, user) {
  const d = one('SELECT * FROM doc_issues WHERE code = ?', String(code || '').toUpperCase());
  if (!d) refuse('no such document', 404);
  const spec = TYPES[d.doc_type];
  if (!userHas(user, spec.view)) refuse(`reading this needs ${spec.view}`, 403);
  return {
    code: d.code, type: d.doc_type, label: spec.label, subjectId: d.subject_id, version: d.version, title: d.title,
    content: JSON.parse(d.snapshot), digest: d.digest, issuedBy: d.issued_by, issuedAt: d.issued_at,
    revokedAt: d.revoked_at, verifyUrl: verifyUrl(d.code),
    company: { name: getSetting('COMPANY_NAME') || '', address: getSetting('COMPANY_ADDRESS') || '' },
    ...(spec.current ? spec.current(d) : { inForce: true }),
  };
}

export function issuesFor(type, id, user) {
  if (!TYPES[type]) refuse('no such document type', 404);
  if (!userHas(user, TYPES[type].view)) refuse(`reading this needs ${TYPES[type].view}`, 403);
  return q('SELECT code, version, issued_by, issued_at, revoked_at FROM doc_issues WHERE doc_type = ? AND subject_id = ? ORDER BY id DESC LIMIT 10', type, String(id));
}

/** Withdraw a copy that should not be relied on — a mistake, a leak. The record stays; it now says so. */
export function revoke({ code, reason, user }) {
  const d = one('SELECT * FROM doc_issues WHERE code = ?', String(code || '').toUpperCase());
  if (!d) refuse('no such document', 404);
  if (!userHas(user, TYPES[d.doc_type].issue)) refuse(`revoking needs ${TYPES[d.doc_type].issue}`, 403);
  if (d.revoked_at) refuse('already revoked');
  if (!String(reason || '').trim()) refuse('say why it is withdrawn');
  const actor = `human:${user.username}`;
  exec("UPDATE doc_issues SET revoked_at = datetime('now'), revoked_by = ?, revoke_reason = ? WHERE id = ?", actor, String(reason).slice(0, 500), d.id);
  audit({ actorType: 'human', actorId: actor, action: 'document.revoked', subjectType: d.doc_type, subjectId: d.subject_id, payload: { code: d.code, reason: String(reason).slice(0, 200) } });
  return { ok: true };
}

export function verifyUrl(code) {
  const base = String(getSetting('PUBLIC_BASE_URL') || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/verify/${code}`;
}

/**
 * What a stranger holding the paper may learn: that it exists, what it is,
 * who issued and approved it, and whether it still stands. Never the text,
 * never amounts or names beyond the approver's account.
 */
export function verify(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c)) return { found: false };
  const d = one('SELECT * FROM doc_issues WHERE code = ?', c);
  if (!d) return { found: false };
  const spec = TYPES[d.doc_type];
  const content = JSON.parse(d.snapshot);
  const status = d.revoked_at ? { inForce: false, note: 'withdrawn by the company' } : (spec.current ? spec.current(d) : { inForce: true });
  return {
    found: true, code: d.code, label: spec.label,
    title: d.doc_type === 'payment' ? `${content.format} · UETR ${content.uetr}` : d.title,
    version: d.version, issuedAt: d.issued_at, issuedBy: d.issued_by.replace(/^human:/, ''),
    approvedBy: String(content.approvedBy || content.releasedBy || content.heldBy || '').replace(/^human:/, '') || null,
    digest: d.digest.slice(0, 16), company: getSetting('COMPANY_NAME') || null, ...status,
  };
}

const h = (s) => String(s ?? '').replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));

/** The public verification page: self-contained, both languages, no external requests. */
export function verifyPage(code) {
  const v = verify(code);
  const row = (en, ar, val) => (val ? `<tr><th>${en}<br><span lang="ar">${ar}</span></th><td>${h(val)}</td></tr>` : '');
  const verdict = !v.found
    ? ['bad', 'No document with this code was issued.', 'لم تُصدَر أي وثيقة بهذا الرمز.']
    : v.inForce ? ['ok', 'Genuine, and in force.', 'وثيقة أصلية وسارية.']
      : ['warn', `Genuine, but not in force: ${v.note || ''}.`, 'وثيقة أصلية لكنها غير سارية.'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Document verification</title>
<style>
:root{--bg:#f6f6f4;--ink:#16161a;--mute:#5b5b66;--line:#ddd;--ok:#1d7a3e;--warn:#9a6400;--bad:#b3261e;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e11;--ink:#ececf1;--mute:#9a9aa6;--line:#2a2a31;--ok:#6fc487;--warn:#e8b04a;--bad:#f0685a;--card:#17171c}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.v{font-weight:700;font-size:18px;margin:0 0 4px}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
[lang=ar]{direction:rtl;display:block}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:start;padding:8px 0;border-top:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:500;width:42%;font-size:13px}td{overflow-wrap:anywhere}
p.m{color:var(--mute);font-size:13px;margin-top:16px}
</style></head><body><main><div class="card">
<p class="v ${verdict[0]}">${h(verdict[1])}<span lang="ar">${h(verdict[2])}</span></p>
${v.found ? `<table>
${row('Issued by', 'جهة الإصدار', v.company)}
${row('Document', 'الوثيقة', v.label)}
${row('Title', 'العنوان', v.title)}
${row('Version', 'الإصدار', v.version)}
${row('Approved by', 'اعتمده', v.approvedBy)}
${row('Issued', 'تاريخ الإصدار', `${v.issuedAt} UTC · ${v.issuedBy}`)}
${row('Code', 'الرمز', v.code)}
${row('Fingerprint', 'البصمة', v.digest)}
${!v.inForce && v.note ? row('Status', 'الحالة', v.note) : ''}
</table>` : ''}
<p class="m">This page shows the company's record of the document, not its text. Compare the printed copy with it.<span lang="ar">تعرض هذه الصفحة سجل الشركة للوثيقة لا نصها. قارن النسخة المطبوعة به.</span></p>
</div></main></body></html>`;
}
