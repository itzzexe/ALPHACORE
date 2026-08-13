// Partnerships — the relationships that are not sales.
//
// The data was already here: a `partners` table, an outreach draft, a health
// score, and `deals.partner_id` waiting for somebody to use it. What was
// missing was a place to stand, so a partner existed only as a row somebody
// could reach through the API.
//
// This is separated from Sales because the question is different. Sales asks
// "will they buy". A partnership asks "does anything actually flow through
// this" — and the honest answer for most partnerships, most of the time, is
// nothing, which is exactly what this department is for finding out.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const clean = (s, n = 1000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

/** What a partner has actually produced, rather than what was hoped. */
export function throughput(partnerId) {
  const deals = q('SELECT id, name, stage, value_usd, closed_at FROM deals WHERE partner_id = ? ORDER BY id DESC', partnerId);
  const won = deals.filter((d) => d.stage === 'won' || d.closed_at);
  const interactions = one('SELECT COUNT(*) AS n FROM interactions WHERE partner_id = ?', partnerId).n;
  const last = one('SELECT MAX(created_at) AS t FROM interactions WHERE partner_id = ?', partnerId)?.t || null;
  return {
    deals: deals.length,
    won: won.length,
    valueUsd: won.reduce((s, d) => s + (Number(d.value_usd) || 0), 0),
    interactions,
    lastContact: last,
    daysQuiet: last ? Math.floor((Date.now() - Date.parse(last.replace(' ', 'T') + 'Z')) / 864e5) : null,
  };
}

export function setIntegration({ id, integration, agreementRef = null, actor }) {
  if (!actor) refuse('an integration has to name who recorded it');
  const p = one('SELECT * FROM partners WHERE id = ?', id);
  if (!p) refuse('no such partner');
  exec("UPDATE partners SET integration = ?, agreement_ref = COALESCE(?, agreement_ref), reviewed_at = datetime('now') WHERE id = ?",
    clean(integration, 400), clean(agreementRef, 80) || null, id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'partner.integration_set', subjectType: 'partner', subjectId: id,
    payload: { name: p.name, integration: clean(integration, 120) },
  });
  return one('SELECT * FROM partners WHERE id = ?', id);
}

/**
 * Partnerships that have produced nothing and nobody has spoken to.
 *
 * Named plainly because the alternative is a list of logos that grows forever
 * and describes a company doing better than it is.
 */
export function dormant(days = 90) {
  return q("SELECT * FROM partners WHERE state IN ('prospect','active')")
    .map((p) => ({ partner: p, ...throughput(p.id) }))
    .filter((r) => r.won === 0 && (r.daysQuiet === null || r.daysQuiet > days))
    .sort((a, b) => (b.daysQuiet || 9999) - (a.daysQuiet || 9999));
}

export function overview() {
  const partners = q('SELECT * FROM partners ORDER BY CASE tier WHEN \'strategic\' THEN 0 WHEN \'key\' THEN 1 ELSE 2 END, name');
  const withFlow = partners.map((p) => ({ ...p, ...throughput(p.id) }));
  return {
    partners: withFlow,
    total: partners.length,
    active: partners.filter((p) => p.state === 'active').length,
    producing: withFlow.filter((p) => p.won > 0).length,
    valueUsd: withFlow.reduce((s, p) => s + p.valueUsd, 0),
    dormant: dormant(90).slice(0, 20),
    integrations: withFlow.filter((p) => p.integration).length,
    // The gate is not optional here: an outreach draft is a message to somebody
    // outside, and it leaves the same way everything else does.
    note: 'An outreach draft is written here and sent by a person, through the gate, like anything else that leaves.',
  };
}
