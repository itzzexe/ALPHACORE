// What the company has already decided, put in front of whoever writes next —
// and in front of whoever asks.
//
// A drafting employee that knows nothing of the company writes a generic
// policy; one handed the company's own published rules, the corrective actions
// it has taken and the audit findings still open writes one that fits — and
// can cite them, so a reader can check where a sentence came from.
//
// Two ways of finding a passage, used together. Words in common, weighted by
// how rare they are: no model, the same in Arabic, on two cores. And meaning,
// when the local embedding model is installed: a question about "staff
// leaving" finds the policy that says "resignation". The two rankings are
// fused, so each covers what the other misses.
//
// Every document carries the permission that reading it takes. A person asking
// is answered only from what they could have opened themselves — an answer is
// a way of reading, and must not be a way round the permissions.
import { createHash } from 'node:crypto';
import { q, one, exec } from './db.js';
import { tokenize } from './memory.js';
import { embedText } from './embeddings.js';

const MAX_CHARS = 2400;

const can = (user, perm) => !user || user.role === 'superadmin' || user.perms?.includes('*') || user.perms?.includes(perm);

/** The documents worth citing, each with the permission that reading it takes. */
function corpus(user = null) {
  const docs = [];
  const add = (perm, rows, shape) => { if (can(user, perm)) for (const r of rows()) docs.push({ ...shape(r), perm }); };
  add('policies.view', () => q("SELECT code, version, title, body, steps FROM pol_docs WHERE state = 'published'"), (d) => ({
    cite: `${d.code} v${d.version}`, title: d.title, href: '#/policies',
    text: `${d.body || ''} ${d.steps ? JSON.parse(d.steps).map((s) => `${s.step} (${s.role})`).join('; ') : ''}`,
  }));
  add('iso.view', () => q("SELECT id, clause_ref, description, root_cause, corrective_action FROM iso_ncrs WHERE state = 'closed' ORDER BY id DESC LIMIT 200"), (n) => ({
    cite: `NCR-${n.id}`, title: `Nonconformity ${n.clause_ref || ''}`.trim(), href: '#/iso',
    text: `${n.description} Cause: ${n.root_cause || ''} Action: ${n.corrective_action || ''}`,
  }));
  add('ia.view', () => q("SELECT id, title, criteria, condition, recommendation FROM ia_findings WHERE state <> 'verified' ORDER BY id DESC LIMIT 200"), (f) => ({
    cite: `IA-F${f.id}`, title: f.title, href: '#/internalaudit', text: `${f.criteria} ${f.condition} ${f.recommendation || ''}`,
  }));
  add('iso.view', () => q('SELECT id, standard, held_on, decisions FROM iso_reviews ORDER BY id DESC LIMIT 20'), (r) => ({
    cite: `MR-${r.id}`, title: `${r.standard} management review ${r.held_on}`, href: '#/iso', text: r.decisions,
  }));
  add('minutes.view', () => q("SELECT id, title, held_on, summary, decisions FROM rec_meetings WHERE state = 'minuted' ORDER BY id DESC LIMIT 200"), (m) => ({
    cite: `MTG-${m.id}`, title: `${m.title} (${m.held_on})`, href: `#/minutes?id=${m.id}`, text: `${m.summary || ''} ${m.decisions || ''}`,
  }));
  add('decisions.view', () => q("SELECT id, title, context, outcome FROM decisions WHERE status IN ('decided','closed','approved') ORDER BY created_at DESC LIMIT 200"), (d) => ({
    cite: d.id, title: d.title, href: `#/decision/${d.id}`, text: `${d.context || ''} ${d.outcome || ''}`,
  }));
  return docs;
}

/** Words in common, weighted by rarity: every document's score for `text`. */
function lexical(text, docs) {
  const want = new Set(tokenize(text));
  if (!want.size || !docs.length) return [];
  const toks = docs.map((d) => tokenize(`${d.title} ${d.title} ${d.text}`));
  const df = new Map();
  for (const ts of toks) for (const t of new Set(ts)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  return docs.map((d, i) => {
    const tf = new Map();
    for (const t of toks[i]) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of want) if (tf.has(t)) score += (1 + Math.log(tf.get(t))) * Math.log(1 + N / df.get(t));
    return { ...d, score: score / Math.sqrt(1 + toks[i].length / 50) };
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
}

/** The k passages most related to `text`, best first — lexical, synchronous, for drafting and sweeps. */
export function relatedDocuments(text, { k = 4, exclude = null, user = null } = {}) {
  const docs = corpus(user).filter((d) => d.cite.split(' ')[0] !== exclude);
  return lexical(text, docs).slice(0, k);
}

/** A block for a prompt: each passage under its citation, trimmed to fit a small model's context. */
export function companyContext(text, opts = {}) {
  return contextBlock(relatedDocuments(text, opts));
}

export function contextBlock(docs) {
  if (!docs.length) return '';
  const per = Math.floor(MAX_CHARS / docs.length);
  return `The company's own documents that bear on this — follow them, and cite them as [code] where you rely on them:\n${
    docs.map((d) => `[${d.cite}] ${d.title}: ${String(d.text).replace(/\s+/g, ' ').trim().slice(0, per)}`).join('\n')}`;
}

const unit = (v) => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);

/** A document's vector, from the cache while its text is unchanged. Null without a real model. */
async function vectorOf(d) {
  const text = `${d.title}\n${String(d.text).slice(0, 4000)}`;
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 32);
  const hit = one('SELECT * FROM ctx_vectors WHERE cite = ?', d.cite);
  if (hit && hit.digest === digest) return JSON.parse(hit.vec);
  const e = await embedText(text);
  if (!e.local) return null;
  const vec = unit(e.vector);
  exec(`INSERT INTO ctx_vectors (cite, digest, model, vec) VALUES (?,?,?,?)
        ON CONFLICT(cite) DO UPDATE SET digest = excluded.digest, model = excluded.model, vec = excluded.vec`, d.cite, digest, e.space, JSON.stringify(vec));
  return vec;
}

/**
 * Search the company for `query`, as `user` may see it: lexical and semantic
 * rankings fused by reciprocal rank, so a passage high in either rises. Without
 * a local embedding model it is the lexical ranking alone, and says so.
 */
export async function searchCompany(query, { user = null, k = 6 } = {}) {
  const docs = corpus(user);
  const lex = lexical(query, docs);
  let sem = [];
  let semantic = false;
  const qv = await embedText(query);
  if (qv.local && docs.length) {
    semantic = true;
    const qvec = unit(qv.vector);
    const scored = [];
    for (const d of docs.slice(0, 600)) {
      const v = await vectorOf(d);
      if (v && v.length === qvec.length) scored.push({ ...d, sim: dot(qvec, v) });
    }
    sem = scored.filter((d) => d.sim > 0.3).sort((a, b) => b.sim - a.sim).slice(0, 30);
  }
  const fused = new Map();
  const rrf = (list) => list.forEach((d, i) => {
    const prev = fused.get(d.cite) || { ...d, rank: 0 };
    fused.set(d.cite, { ...prev, rank: prev.rank + 1 / (60 + i) });
  });
  rrf(lex.slice(0, 30));
  rrf(sem);
  const results = [...fused.values()].sort((a, b) => b.rank - a.rank).slice(0, k)
    .map(({ cite, title, href, text, perm }) => ({ cite, title, href, perm, excerpt: String(text).replace(/\s+/g, ' ').trim().slice(0, 400), text }));
  return { results, semantic, searched: docs.length };
}
