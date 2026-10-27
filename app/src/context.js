// What the company has already decided, put in front of whoever writes next.
//
// A drafting employee that knows nothing of the company writes a generic
// policy; one handed the company's own published rules, the corrective actions
// it has taken and the audit findings still open writes one that fits — and
// can cite them, so a reader can check where a sentence came from. Retrieval
// is lexical (the words in common, weighted by how rare they are), which needs
// no model and works the same on a two-core server in either language.
import { q } from './db.js';
import { tokenize } from './memory.js';

const MAX_CHARS = 2400;

/** The documents worth citing: published rules, closed corrective actions, open findings, recent decisions of review. */
function corpus() {
  const docs = [];
  for (const d of q("SELECT code, version, title, body, steps FROM pol_docs WHERE state = 'published'")) {
    const steps = d.steps ? JSON.parse(d.steps).map((s) => `${s.step} (${s.role})`).join('; ') : '';
    docs.push({ cite: `${d.code} v${d.version}`, title: d.title, text: `${d.body || ''} ${steps}` });
  }
  for (const n of q("SELECT id, clause_ref, description, root_cause, corrective_action FROM iso_ncrs WHERE state = 'closed' ORDER BY id DESC LIMIT 200")) {
    docs.push({ cite: `NCR-${n.id}`, title: `Nonconformity ${n.clause_ref || ''}`.trim(), text: `${n.description} Cause: ${n.root_cause || ''} Action: ${n.corrective_action || ''}` });
  }
  for (const f of q("SELECT id, title, criteria, condition, recommendation FROM ia_findings WHERE state <> 'verified' ORDER BY id DESC LIMIT 200")) {
    docs.push({ cite: `IA-F${f.id}`, title: f.title, text: `${f.criteria} ${f.condition} ${f.recommendation || ''}` });
  }
  for (const r of q('SELECT id, standard, held_on, decisions FROM iso_reviews ORDER BY id DESC LIMIT 20')) {
    docs.push({ cite: `MR-${r.id}`, title: `${r.standard} management review ${r.held_on}`, text: r.decisions });
  }
  return docs;
}

/** The k passages most related to `text`, best first. */
export function relatedDocuments(text, { k = 4, exclude = null } = {}) {
  const want = new Set(tokenize(text));
  if (!want.size) return [];
  const docs = corpus().filter((d) => d.cite.split(' ')[0] !== exclude);
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
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

/** A block for a prompt: each passage under its citation, trimmed to fit a small model's context. */
export function companyContext(text, opts = {}) {
  const docs = relatedDocuments(text, opts);
  if (!docs.length) return '';
  const per = Math.floor(MAX_CHARS / docs.length);
  return `The company's own documents that bear on this — follow them, and cite them as [code] where you rely on them:\n${
    docs.map((d) => `[${d.cite}] ${d.title}: ${String(d.text).replace(/\s+/g, ' ').trim().slice(0, per)}`).join('\n')}`;
}
