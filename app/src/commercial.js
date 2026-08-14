// Commercial division — Marketing (campaigns) + Customers (CRM).
// Marketing copy is AI-drafted and HUMAN-approved before anything goes live
// (Part 2 RACI: publish approval is human). Customer MRR feeds the finance
// pack; campaign spend feeds CAC. Everything cross-links: campaign → product,
// customer → campaign/product, tickets ↔ customers by name.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { archiveItem } from './data.js';
import { openPii } from './erasure.js';

// ---------- Marketing ----------
export function createCampaign({ name, channel = 'landing', productId = null, budgetUsd = 0, brief, actor }) {
  if (!name?.trim() || !brief?.trim()) throw new Error('name and brief required');
  exec('INSERT INTO campaigns (name, channel, product_id, budget_usd) VALUES (?,?,?,?)',
    name.trim(), channel, productId, Number(budgetUsd) || 0);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-DOC-001',
    taskType: `campaign:${id}`,
    input: { prompt: `Draft marketing copy for a ${channel} campaign "${name}"${productId ? ` for product ${productId}` : ''}.\nBrief:\n${brief}\nKeep claims factual; flag anything that needs human verification.` },
    actor,
  });
  exec('UPDATE campaigns SET draft_run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'campaign.created', subjectType: 'campaign', subjectId: id, payload: { name, channel, productId, budgetUsd } });
  return getCampaign(id);
}

export function getCampaign(id) {
  const c = one('SELECT * FROM campaigns WHERE id = ?', id);
  return c ? { ...c, metrics: JSON.parse(c.metrics) } : null;
}

export function listCampaigns() {
  return q('SELECT id FROM campaigns ORDER BY id DESC LIMIT 100').map((r) => {
    const c = getCampaign(r.id);
    c.customers = one('SELECT COUNT(*) AS n FROM customers WHERE campaign_id = ?', c.id).n;
    return c;
  });
}

/** Server tick: pull finished copy drafts into campaigns. */
export function syncCampaignDrafts() {
  for (const c of q("SELECT * FROM campaigns WHERE state = 'drafting' AND draft_run_id IS NOT NULL")) {
    const run = one('SELECT * FROM runs WHERE id = ?', c.draft_run_id);
    if (!run) continue;
    if (run.state === 'done' || run.state === 'awaiting_human') {
      const parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null;
      exec("UPDATE campaigns SET state = 'pending_approval', draft = ? WHERE id = ?", parsed?.draft || '(draft unusable — human writes copy)', c.id);
    } else if (['failed', 'cancelled'].includes(run.state)) {
      exec("UPDATE campaigns SET state = 'pending_approval', draft = '(drafting failed — human writes copy)' WHERE id = ?", c.id);
    }
  }
}

/** Human approves the copy → campaign goes live. Publishing is never agent-initiated. */
export function approveCampaign(id, { copy = null, actor }) {
  const c = getCampaign(id);
  if (!c) throw new Error('campaign not found');
  if (c.state !== 'pending_approval') throw new Error(`campaign is ${c.state}`);
  exec("UPDATE campaigns SET state = 'live', draft = COALESCE(?, draft), approved_by = ? WHERE id = ?", copy, actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'campaign.approved_live', subjectType: 'campaign', subjectId: id });
  const final = getCampaign(id);
  archiveItem({ title: `Campaign live: ${final.name}`, kind: 'campaign', subjectType: 'campaign', subjectId: id, snapshot: { channel: final.channel, budget: final.budget_usd, copy: (final.draft || '').slice(0, 2000) }, actor });
  return final;
}

export function updateCampaign(id, { state = null, spentUsd = null, signups = null, qualified = null, actor }) {
  const c = getCampaign(id);
  if (!c) throw new Error('campaign not found');
  const metrics = { ...c.metrics };
  if (signups !== null) metrics.signups = Number(signups);
  if (qualified !== null) metrics.qualified = Number(qualified);
  exec('UPDATE campaigns SET state = COALESCE(?, state), spent_usd = COALESCE(?, spent_usd), metrics = ? WHERE id = ?',
    state, spentUsd === null ? null : Number(spentUsd), JSON.stringify(metrics), id);
  audit({ actorType: 'human', actorId: actor, action: 'campaign.updated', subjectType: 'campaign', subjectId: id, payload: { state, spentUsd, signups, qualified } });
  return getCampaign(id);
}

/** Immune rule: overspent live campaigns pause automatically (reversible). */
export function ruleCampaignOverspend() {
  for (const c of q("SELECT * FROM campaigns WHERE state = 'live' AND budget_usd > 0 AND spent_usd > budget_usd")) {
    exec("UPDATE campaigns SET state = 'paused' WHERE id = ?", c.id);
    audit({ actorType: 'system', actorId: 'immune', action: 'campaign.paused_overspend', subjectType: 'campaign', subjectId: c.id });
    notify({ level: 'crit', source: 'immune.campaign', message: `Campaign "${c.name}" paused: spent $${c.spent_usd} > budget $${c.budget_usd}. Resume is a human decision.`, subjectType: 'campaign', subjectId: c.id });
  }
}

// ---------- Customers (CRM) ----------
export function createCustomer({ name, company = null, plan = 'trial', mrrUsd = 0, state = 'lead', productId = null, campaignId = null, actor }) {
  if (!name?.trim()) throw new Error('name required');
  exec('INSERT INTO customers (name, company, plan, mrr_usd, state, product_id, campaign_id) VALUES (?,?,?,?,?,?,?)',
    name.trim(), company, plan, Number(mrrUsd) || 0, state, productId, campaignId);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'customer.created', subjectType: 'customer', subjectId: id, payload: { name, plan, state } });
  return getCustomer(id);
}

export function getCustomer(id) {
  const c = one('SELECT * FROM customers WHERE id = ?', id);
  if (!c) return null;
  return {
    ...c,
    tickets: q('SELECT id, subject, state FROM tickets WHERE customer = ? ORDER BY id DESC LIMIT 10', c.name),
  };
}

export function listCustomers() {
  return q('SELECT id FROM customers ORDER BY id DESC LIMIT 200').map((r) => getCustomer(r.id));
}

export function updateCustomer(id, { state = null, plan = null, mrrUsd = null, actor }) {
  const c = one('SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw new Error('customer not found');
  const newState = state || c.state;
  exec(`UPDATE customers SET state = ?, plan = COALESCE(?, plan), mrr_usd = COALESCE(?, mrr_usd),
        churned_at = CASE WHEN ? = 'churned' AND churned_at IS NULL THEN datetime('now') ELSE churned_at END
        WHERE id = ?`,
    newState, plan, mrrUsd === null ? null : Number(mrrUsd), newState, id);
  audit({ actorType: 'human', actorId: actor, action: `customer.${state || 'updated'}`, subjectType: 'customer', subjectId: id, payload: { plan, mrrUsd } });
  if (newState === 'churned' && c.state !== 'churned') {
    notify({ level: 'warn', source: 'crm', message: `Customer churned: ${c.name} (was $${c.mrr_usd}/mo). Exit reason belongs in the Gate 10 pack.`, subjectType: 'customer', subjectId: id });
  }
  return getCustomer(id);
}

export function crmStats() {
  const s = one(`SELECT
    SUM(state = 'active') AS active, SUM(state = 'trial') AS trial,
    SUM(state = 'lead') AS leads, SUM(state = 'churned') AS churned,
    COALESCE(SUM(CASE WHEN state = 'active' THEN mrr_usd ELSE 0 END), 0) AS mrr
    FROM customers`);
  const concentration = q(`SELECT name, mrr_usd FROM customers WHERE state = 'active' AND mrr_usd > 0 ORDER BY mrr_usd DESC LIMIT 1`)[0] || null;
  return {
    ...s,
    mrr: s.mrr || 0,
    // Part 6 §7: any customer > 20% of MRR is a concentration flag.
    concentrationFlag: concentration && s.mrr > 0 && concentration.mrr_usd / s.mrr > 0.2 ? concentration.name : null,
  };
}
