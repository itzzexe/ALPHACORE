// ASK THE COMPANY — a question answered from the company's own documents,
// every sentence with the document it came from.
//
// The search is free and runs at once (context.js). The answer costs a model
// call, so, like everything on the Ask page that spends anything, it is a
// button a person presses. The writer is told to answer only from the passages
// it is given and to say so when they do not cover the question: a confident
// paragraph that cites nothing is the failure this is built to prevent.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { searchCompany, contextBlock } from './context.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

export async function askCompany({ question, user, lang = 'ar' }) {
  const text = String(question || '').trim().slice(0, 500);
  if (!text) refuse('ask something');
  if (!user) refuse('sign in first', 401);
  const actor = `human:${user.username}`;
  const found = await searchCompany(text, { user, k: 6 });
  const r = exec('INSERT INTO company_asks (question, sources, asked_by) VALUES (?,?,?)',
    text, JSON.stringify(found.results.map(({ text: _t, ...s }) => s)), actor);
  const id = Number(r.lastInsertRowid);
  let draftId = null;
  if (found.results.length) {
    const job = requestDraft({
      dept: 'ask', subjectType: 'company_ask', subjectId: id, kind: 'answer', agentId: 'AGT-KNW-001', lang, actor, urgent: true,
      brief: `Question: ${text}\n\n${contextBlock(found.results)}\n\nAnswer only from the documents above. After every sentence put the [code] it rests on. If they do not answer the question, say exactly that and name what is missing — do not fill the gap from general knowledge.`,
    });
    draftId = job.id;
    exec('UPDATE company_asks SET draft_id = ? WHERE id = ?', draftId, id);
  }
  // The question is a person's words and may name anybody; the chain records that it was asked, not what.
  audit({ actorType: 'human', actorId: actor, action: 'ask.company', subjectType: 'company_ask', subjectId: id, payload: { sources: found.results.length, semantic: found.semantic } });
  return getAsk(id, user);
}

export function getAsk(id, user) {
  const a = one('SELECT * FROM company_asks WHERE id = ?', Number(id));
  if (!a) refuse('no such question', 404);
  if (user && a.asked_by !== `human:${user.username}` && user.role !== 'superadmin' && !user.perms?.includes('*')) refuse('that question is someone else’s', 403);
  const draft = a.draft_id ? draftsFor('ask', 'company_ask', a.id, 1)[0] : null;
  return {
    id: a.id, question: a.question, sources: JSON.parse(a.sources), askedAt: a.created_at,
    state: !a.draft_id ? 'no-sources' : draft?.state || 'thinking',
    answer: draft?.state === 'ready' ? draft.body : null,
  };
}

export function recentAsks(user, limit = 10) {
  return q('SELECT id, question, created_at FROM company_asks WHERE asked_by = ? ORDER BY id DESC LIMIT ?', `human:${user.username}`, limit);
}
