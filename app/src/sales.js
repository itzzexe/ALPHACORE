// Sales department — the deals pipeline. The Sales agent drafts proposals
// and follow-ups; a HUMAN sends and signs. Won deals flow automatically into
// the CRM (via the Nexus rule), value feeds the finance pack, and every stage
// change is on the audit chain.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';

const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];

export function createDeal({ name, valueUsd = 0, customerId = null, partnerId = null, productId = null, owner, notes = null, actor }) {
  if (!name?.trim() || !owner?.trim()) throw new Error('name and owner required');
  exec('INSERT INTO deals (name, value_usd, customer_id, partner_id, product_id, owner, notes) VALUES (?,?,?,?,?,?,?)',
    name.trim(), Number(valueUsd) || 0, customerId, partnerId, productId, owner.trim(), notes);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'deal.created', subjectType: 'deal', subjectId: id, payload: { name: name.trim(), valueUsd } });
  return one('SELECT * FROM deals WHERE id = ?', id);
}

export function listDeals() {
  const deals = q('SELECT * FROM deals ORDER BY stage = \'lost\', stage = \'won\', value_usd DESC, id DESC LIMIT 200').map((d) => ({
    ...d,
    customer: d.customer_id ? one('SELECT name, company FROM customers WHERE id = ?', d.customer_id) : null,
    partner: d.partner_id ? one('SELECT name FROM partners WHERE id = ?', d.partner_id) : null,
  }));
  const openStages = ['lead', 'qualified', 'proposal'];
  return {
    deals,
    pipeline: Object.fromEntries(STAGES.map((s) => [s, {
      n: deals.filter((d) => d.stage === s).length,
      value: deals.filter((d) => d.stage === s).reduce((a, d) => a + d.value_usd, 0),
    }])),
    openValue: deals.filter((d) => openStages.includes(d.stage)).reduce((a, d) => a + d.value_usd, 0),
    wonValue: deals.filter((d) => d.stage === 'won').reduce((a, d) => a + d.value_usd, 0),
  };
}

export function setDealStage(id, { stage, actor }) {
  const d = one('SELECT * FROM deals WHERE id = ?', id);
  if (!d) throw new Error('deal not found');
  if (!STAGES.includes(stage)) throw new Error(`stage must be ${STAGES.join('|')}`);
  exec(`UPDATE deals SET stage = ?, closed_at = CASE WHEN ? IN ('won','lost') THEN datetime('now') ELSE closed_at END WHERE id = ?`, stage, stage, id);
  audit({ actorType: 'human', actorId: actor, action: `deal.${stage}`, subjectType: 'deal', subjectId: id, payload: { name: d.name, valueUsd: d.value_usd } });
  if (stage === 'won') notify({ level: 'info', source: 'sales', message: `Deal WON: ${d.name} ($${d.value_usd}) — Nexus will register the customer.`, subjectType: 'deal', subjectId: id });
  // Reaching "proposal" with no draft yet auto-briefs the Sales agent.
  if (stage === 'proposal' && !d.draft_run_id && !d.proposal) draftProposal(id, actor);
  return one('SELECT * FROM deals WHERE id = ?', id);
}

export function draftProposal(id, actor) {
  const d = one('SELECT * FROM deals WHERE id = ?', id);
  if (!d) throw new Error('deal not found');
  const runId = enqueueRun({
    agentId: 'AGT-SLS-001',
    taskType: `deal:${id}`,
    input: {
      prompt: `Draft a proposal for deal "${d.name}" (value ~$${d.value_usd}${d.product_id ? `, product ${d.product_id}` : ''}).
Notes: ${d.notes || '—'}
A human reviews, sends, and signs — commit to nothing.`,
    },
    actor,
  });
  exec('UPDATE deals SET draft_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'deal.proposal_drafting', subjectType: 'deal', subjectId: id, payload: { runId } });
  return runId;
}

/** Server tick: finished proposal runs land on the deal. */
export function syncProposalDrafts() {
  for (const d of q('SELECT * FROM deals WHERE draft_run_id IS NOT NULL AND proposal IS NULL')) {
    const run = one('SELECT state, output FROM runs WHERE id = ?', d.draft_run_id);
    if (!run) { exec('UPDATE deals SET draft_run_id = NULL WHERE id = ?', d.id); continue; }
    if (run.state === 'done' || run.state === 'awaiting_human') {
      const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
      if (parsed?.proposal) {
        exec('UPDATE deals SET proposal = ? WHERE id = ?', parsed.proposal, d.id);
        notify({ level: 'info', source: 'sales', message: `Proposal draft ready for deal "${d.name}" — review and send it yourself.`, subjectType: 'deal', subjectId: d.id });
      } else if (run.state === 'done') {
        exec('UPDATE deals SET draft_run_id = NULL WHERE id = ?', d.id);
      }
    } else if (['failed', 'cancelled'].includes(run.state)) {
      exec('UPDATE deals SET draft_run_id = NULL WHERE id = ?', d.id);
    }
  }
}
