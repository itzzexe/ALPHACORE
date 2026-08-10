// Intellectual property — what the company owns that is not a thing.
//
// A name, a mark, an invention, a secret. It is kept apart from Assets because
// an asset depreciates and IP lapses: the failure mode is not wear, it is a
// renewal date nobody was watching. A trademark lost that way cannot be bought
// back at any price, and the company usually finds out from somebody else's
// lawyer.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const clean = (s, n = 400) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const KINDS = ['trademark', 'patent', 'copyright', 'domain', 'trade_secret', 'design'];
const STATES = ['idea', 'filed', 'granted', 'registered', 'lapsed', 'abandoned', 'refused'];

export function register({
  name, kind, jurisdiction = null, reference = null, owner, state = 'idea',
  sourceKind = null, sourceId = null, filedAt = null, grantedAt = null,
  renewalAt = null, costUsd = 0, evidence = null, note = null, actor,
}) {
  if (!actor) refuse('an IP record has to name who created it');
  if (!name) refuse('an IP asset needs a name');
  if (!KINDS.includes(kind)) refuse(`kind must be one of: ${KINDS.join(', ')}`);
  if (!STATES.includes(state)) refuse(`state must be one of: ${STATES.join(', ')}`);
  if (!owner) refuse('somebody owns this, and it is not "the company" in the abstract');
  exec(`INSERT INTO ip_assets (name, kind, jurisdiction, reference, state, owner, source_kind, source_id,
          filed_at, granted_at, renewal_at, cost_usd, evidence, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  clean(name, 200), kind, clean(jurisdiction, 40) || null, clean(reference, 80) || null, state,
  clean(owner, 80), clean(sourceKind, 40) || null, clean(sourceId, 80) || null,
  filedAt, grantedAt, renewalAt, Number(costUsd) || 0, clean(evidence, 2000) || null,
  clean(note, 1000) || null, actor);
  const row = one('SELECT * FROM ip_assets WHERE id = last_insert_rowid()');
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'ip.registered', subjectType: 'ip_asset', subjectId: row.id,
    payload: { name: row.name, kind, jurisdiction, state, sourceKind, sourceId },
  });
  return row;
}

export function advance({ id, state, reference = null, renewalAt = null, note = null, actor }) {
  if (!actor) refuse('a change of state has to be signed');
  if (!STATES.includes(state)) refuse(`state must be one of: ${STATES.join(', ')}`);
  const row = one('SELECT * FROM ip_assets WHERE id = ?', id);
  if (!row) refuse('no such asset');
  exec(`UPDATE ip_assets SET state = ?,
          reference = COALESCE(?, reference),
          renewal_at = COALESCE(?, renewal_at),
          filed_at = CASE WHEN ? = 'filed' AND filed_at IS NULL THEN date('now') ELSE filed_at END,
          granted_at = CASE WHEN ? IN ('granted','registered') AND granted_at IS NULL THEN date('now') ELSE granted_at END,
          note = COALESCE(?, note)
        WHERE id = ?`,
  state, clean(reference, 80) || null, renewalAt, state, state, clean(note, 1000) || null, id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'ip.advanced', subjectType: 'ip_asset', subjectId: id,
    payload: { from: row.state, to: state, name: row.name },
  });
  return one('SELECT * FROM ip_assets WHERE id = ?', id);
}

/** What lapses soon, which is the only question this department exists to answer in time. */
export function dueSoon(days = 90) {
  return q(`SELECT * FROM ip_assets
             WHERE renewal_at IS NOT NULL AND state IN ('granted','registered')
               AND date(renewal_at) <= date('now', ?)
             ORDER BY date(renewal_at)`, `+${Number(days) || 90} days`);
}

/**
 * What the company produced that nobody has claimed.
 *
 * Released products and published designs are the two things most likely to be
 * protectable and least likely to be registered, because the person who made
 * them was thinking about shipping.
 */
export function unclaimed() {
  const out = [];
  const claimed = new Set(q("SELECT source_kind, source_id FROM ip_assets WHERE source_id IS NOT NULL")
    .map((r) => `${r.source_kind}:${r.source_id}`));
  for (const p of q("SELECT id, name FROM products LIMIT 200")) {
    if (!claimed.has(`product:${p.id}`)) out.push({ kind: 'product', id: String(p.id), name: p.name, suggest: 'trademark' });
  }
  try {
    for (const d of q("SELECT id, title FROM design_assets WHERE state = 'approved' LIMIT 100")) {
      if (!claimed.has(`design:${d.id}`)) out.push({ kind: 'design', id: String(d.id), name: d.title, suggest: 'design' });
    }
  } catch { /* the designs desk may not be installed */ }
  return out.slice(0, 50);
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    assets: q('SELECT * FROM ip_assets ORDER BY id DESC LIMIT 200'),
    total: n('SELECT COUNT(*) AS n FROM ip_assets'),
    registered: n("SELECT COUNT(*) AS n FROM ip_assets WHERE state IN ('granted','registered')"),
    lapsed: n("SELECT COUNT(*) AS n FROM ip_assets WHERE state = 'lapsed'"),
    spend: one('SELECT COALESCE(SUM(cost_usd),0) AS t FROM ip_assets').t,
    dueSoon: dueSoon(90),
    unclaimed: unclaimed(),
    kinds: KINDS,
    states: STATES,
  };
}
