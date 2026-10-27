// Strategy and corporate development — where the company is going, and what
// it might buy on the way.
//
// The strategy side is a SWOT and a set of strategic themes, written by people
// and kept dated, from which an employee can draft a strategy brief. The
// M&A side is a deal pipeline from screening to close, with the arithmetic a
// first look needs: an implied enterprise value from EBITDA and a multiple.
// Making an offer, and closing, are a person's acts.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 1000) => String(s ?? '').trim().slice(0, n);
export const ITEM_KINDS = ['strength', 'weakness', 'opportunity', 'threat', 'theme'];
export const DEAL_STAGES = ['screening', 'contact', 'nda', 'diligence', 'offer', 'closing', 'closed', 'dropped'];

export function addItem({ kind, text, actor }) {
  if (!ITEM_KINDS.includes(kind)) refuse(`kind must be one of: ${ITEM_KINDS.join(', ')}`);
  if (!clean(text)) refuse('write it down');
  const r = exec('INSERT INTO strat_items (kind, text, created_by) VALUES (?,?,?)', kind, clean(text), actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'strategy.item', subjectType: 'strat_item', subjectId: Number(r.lastInsertRowid), payload: { kind } });
  return one('SELECT * FROM strat_items WHERE id = ?', Number(r.lastInsertRowid));
}

export function removeItem({ id, actor }) {
  if (!one('SELECT id FROM strat_items WHERE id = ?', Number(id))) refuse('no such item', 404);
  exec('DELETE FROM strat_items WHERE id = ?', Number(id));
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'strategy.item_removed', subjectType: 'strat_item', subjectId: Number(id) });
  return { ok: true };
}

export const impliedEv = (d) => (d.ebitda != null && d.multiple != null ? Math.round(d.ebitda * d.multiple) : null);

export function addDeal({ target, sector = '', thesis = '', revenue = null, ebitda = null, multiple = null, owner = null, actor }) {
  if (!clean(target, 200)) refuse('which company?');
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const r = exec('INSERT INTO strat_deals (target, sector, thesis, revenue, ebitda, multiple, owner, created_by) VALUES (?,?,?,?,?,?,?,?)',
    clean(target, 200), clean(sector, 80), clean(thesis, 2000), num(revenue), num(ebitda), num(multiple), clean(owner, 80) || null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'strategy.deal', subjectType: 'strat_deal', subjectId: Number(r.lastInsertRowid), payload: { target } });
  return one('SELECT * FROM strat_deals WHERE id = ?', Number(r.lastInsertRowid));
}

export function moveDeal({ id, stage, notes = null, actor }) {
  const d = one('SELECT * FROM strat_deals WHERE id = ?', Number(id));
  if (!d) refuse('no such deal', 404);
  if (!DEAL_STAGES.includes(stage)) refuse(`stage must be one of: ${DEAL_STAGES.join(', ')}`);
  if (['offer', 'closing', 'closed'].includes(stage) && !isHuman(actor)) refuse('an offer and a close are a person’s acts', 403);
  exec("UPDATE strat_deals SET stage = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?", stage, notes ? clean(notes, 4000) : null, d.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'strategy.deal_moved', subjectType: 'strat_deal', subjectId: d.id, payload: { from: d.stage, to: stage } });
  return one('SELECT * FROM strat_deals WHERE id = ?', d.id);
}

export function brief({ actor, lang = 'ar' }) {
  const items = q('SELECT kind, text FROM strat_items ORDER BY kind, id');
  const text = `A one-page strategy brief. SWOT and themes as written by the company:
${items.map((i) => `- ${i.kind}: ${i.text}`).join('\n') || '- none yet [TO CONFIRM]'}
Turn strengths × opportunities into moves, weaknesses × threats into defences, name three strategic objectives with one measure each, and say what the company should stop doing.`;
  return requestDraft({ dept: 'strategy', subjectType: 'strategy', subjectId: 'brief', kind: 'strategy-brief', agentId: 'AGT-STR-001', brief: text, lang, actor });
}

export function overview() {
  const deals = q("SELECT * FROM strat_deals ORDER BY CASE stage WHEN 'dropped' THEN 2 WHEN 'closed' THEN 1 ELSE 0 END, updated_at DESC").map((d) => ({ ...d, ev: impliedEv(d) }));
  return {
    items: Object.fromEntries(ITEM_KINDS.map((k) => [k, q('SELECT * FROM strat_items WHERE kind = ? ORDER BY id', k)])),
    deals,
    pipeline: DEAL_STAGES.map((s) => ({ stage: s, count: deals.filter((d) => d.stage === s).length, ev: deals.filter((d) => d.stage === s).reduce((a, d) => a + (d.ev || 0), 0) })),
    drafts: draftsFor('strategy', 'strategy', 'brief', 3),
  };
}
