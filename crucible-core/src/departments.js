// Six departments that the rest of the company was already assuming existed.
//
// Each one closes a real gap rather than adding a page:
//   Pricing        — several agents are forbidden from stating a price without
//                    "an approved pricing record". This is where that record lives.
//   Customer success — the CRM knows who pays; nobody was tracking who is
//                    actually healthy, and churn is invisible until it happens.
//   Assets         — domains, licences, credentials and devices renew and expire
//                    exactly like vendor contracts, and were untracked.
//   Localization   — the company writes for an Arabic and English market; the
//                    second language was being done ad hoc inside each section.
//   Market watch   — Intelligence collects prospects, not rivals. Different job.
//   Enablement     — evals find weak agents; nothing turned that into training.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { enrichFromWeb } from './enrich.js';

// ---------- Pricing ----------
export function createPricing({ name, productId = null, plan = 'standard', currency = 'USD', amount = 0, unit = 'per month', rationale = null, draftWithAi = false, actor }) {
  if (!name?.trim()) throw new Error('name required');
  exec('INSERT INTO pricing_records (name, product_id, plan, currency, amount, unit, rationale, created_by) VALUES (?,?,?,?,?,?,?,?)',
    name.trim(), productId, plan, currency, Number(amount) || 0, unit, rationale, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  if (draftWithAi) {
    const runId = enqueueRun({
      agentId: 'AGT-FIN-001',
      taskType: `pricing:${id}`,
      input: {
        prompt: `Propose pricing for "${name.trim()}"${productId ? ` (product ${productId})` : ''}.
Current draft: ${amount} ${currency} ${unit}, plan "${plan}".${rationale ? `\nContext: ${rationale}` : ''}

Give: the recommended price and why, what the buyer is comparing it to, the value metric it should scale on, two alternative structures with their trade-offs, the margin implication at our known cost base, and the three assumptions the number rests on. Be concrete about numbers.`,
      },
      actor,
    });
    exec('UPDATE pricing_records SET run_id = ? WHERE id = ?', runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'pricing.drafted', subjectType: 'pricing', subjectId: id, payload: { name, amount, currency } });
  return one('SELECT * FROM pricing_records WHERE id = ?', id);
}

export function listPricing() {
  return q("SELECT * FROM pricing_records ORDER BY state = 'retired', id DESC LIMIT 100");
}

/** Approval is what turns a number into the record other agents may cite. */
export function setPricingState(id, { state, actor }) {
  const p = one('SELECT * FROM pricing_records WHERE id = ?', id);
  if (!p) throw new Error('pricing record not found');
  if (!['draft', 'approved', 'retired'].includes(state)) throw new Error('bad state');
  exec("UPDATE pricing_records SET state = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END WHERE id = ?", state, state, actor, id);
  audit({ actorType: 'human', actorId: actor, action: `pricing.${state}`, subjectType: 'pricing', subjectId: id, payload: { name: p.name, amount: p.amount } });
  if (state === 'approved') notify({ level: 'info', source: 'pricing', message: `Pricing approved: ${p.name} — ${p.amount} ${p.currency} ${p.unit}. Agents may now cite it.`, subjectType: 'pricing', subjectId: id });
  return one('SELECT * FROM pricing_records WHERE id = ?', id);
}

/** The one line every other agent is allowed to quote. */
export function approvedPricing() {
  return q("SELECT name, product_id, plan, currency, amount, unit FROM pricing_records WHERE state = 'approved'");
}

// ---------- Customer success ----------
export function assessCustomer(customerId, { actor }) {
  const c = one('SELECT * FROM customers WHERE id = ?', customerId);
  if (!c) throw new Error('customer not found');
  const tickets = q('SELECT category, subject, state, created_at FROM tickets WHERE customer = ? ORDER BY id DESC LIMIT 12', c.name);
  const inter = q('SELECT kind, summary, created_at FROM interactions WHERE customer_id = ? ORDER BY id DESC LIMIT 8', customerId);
  const runId = enqueueRun({
    agentId: 'AGT-CS-001',
    taskType: `csm:${customerId}`,
    input: {
      prompt: `Assess this customer's health.

Customer: ${c.name}${c.company ? ` (${c.company})` : ''}
Plan: ${c.plan} · MRR $${c.mrr_usd} · state ${c.state} · since ${c.created_at}
Notes: ${String(c.notes || '—').slice(0, 800)}

Support history (${tickets.length}):
${tickets.map((t) => `- [${t.created_at.slice(0, 10)}] ${t.category}/${t.state}: ${t.subject}`).join('\n') || '- none'}

Relationship touches (${inter.length}):
${inter.map((i) => `- [${i.created_at.slice(0, 10)}] ${i.kind}: ${i.summary}`).join('\n') || '- none — nobody has spoken to them'}

Judge from this evidence only.`,
    },
    actor,
  });
  exec('INSERT INTO customer_health (customer_id, run_id, owner) VALUES (?,?,?)', customerId, runId, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'success.assessment_requested', subjectType: 'customer', subjectId: customerId, payload: { healthId: id } });
  return one('SELECT * FROM customer_health WHERE id = ?', id);
}

export function listCustomerHealth() {
  return q(`SELECT h.*, c.name AS customer_name, c.mrr_usd, c.state AS customer_state
            FROM customer_health h JOIN customers c ON c.id = h.customer_id
            WHERE h.id IN (SELECT MAX(id) FROM customer_health GROUP BY customer_id)
            ORDER BY h.score, c.mrr_usd DESC`);
}

export function successOverview() {
  const rows = listCustomerHealth();
  return {
    assessed: rows.length,
    customers: one('SELECT COUNT(*) AS n FROM customers').n,
    atRisk: rows.filter((r) => ['at_risk', 'churn_risk'].includes(r.stage)).length,
    mrrAtRisk: rows.filter((r) => ['at_risk', 'churn_risk'].includes(r.stage)).reduce((a, r) => a + (r.mrr_usd || 0), 0),
    avgScore: rows.length ? Math.round((rows.reduce((a, r) => a + r.score, 0) / rows.length) * 10) / 10 : null,
    rows,
  };
}

// ---------- Assets ----------
export function createAsset({ name, kind = 'license', owner, vendorId = null, costUsd = 0, renewalDate = null, sensitivity = 'internal', notes = null, actor }) {
  if (!name?.trim() || !owner?.trim()) throw new Error('name and owner required');
  exec('INSERT INTO assets (name, kind, owner, vendor_id, cost_usd, renewal_date, sensitivity, notes) VALUES (?,?,?,?,?,?,?,?)',
    name.trim(), kind, owner.trim(), vendorId, Number(costUsd) || 0, renewalDate, sensitivity, notes);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'asset.registered', subjectType: 'asset', subjectId: id, payload: { name, kind, costUsd } });
  return one('SELECT * FROM assets WHERE id = ?', id);
}

export function listAssets() {
  return q("SELECT * FROM assets ORDER BY state = 'retired', renewal_date IS NULL, renewal_date, id DESC LIMIT 200")
    .map((a) => ({ ...a, vendor: a.vendor_id ? one('SELECT id, name FROM vendors WHERE id = ?', a.vendor_id) : null }));
}

export function setAssetState(id, { state, actor }) {
  if (!['active', 'expiring', 'retired'].includes(state)) throw new Error('bad state');
  exec('UPDATE assets SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `asset.${state}`, subjectType: 'asset', subjectId: id });
}

/** Immune rule: an asset that lapses silently is how a company loses a domain. */
export function ruleAssetRenewals() {
  const soon = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  for (const a of q("SELECT * FROM assets WHERE state = 'active' AND renewal_date IS NOT NULL AND renewal_date <= ?", soon)) {
    notify({ level: 'warn', source: 'immune.assets', message: `Asset renews soon: ${a.name} (${a.kind}) on ${a.renewal_date} — owner ${a.owner}.`, subjectType: 'asset', subjectId: a.id });
  }
}

// ---------- Localization ----------
export function createLocalization({ sourceKind = 'manual', sourceId = null, title, sourceText = null, targetLang = 'ar', notes = null, actor }) {
  let text = sourceText;
  let name = title;
  if (!text && sourceId) {
    // Pull the text straight out of the section that owns it.
    const src = {
      content: () => one('SELECT title, draft AS body FROM content_items WHERE id = ?', sourceId),
      post: () => one('SELECT brief AS title, draft AS body FROM posts WHERE id = ?', sourceId),
      design: () => one('SELECT title, spec AS body FROM designs WHERE id = ?', sourceId),
      doc: () => one('SELECT title, content AS body FROM blueprint_docs WHERE id = ?', sourceId),
    }[sourceKind]?.();
    if (!src?.body) throw new Error('nothing to translate at that source');
    text = src.body;
    name = name || src.title;
  }
  if (!text?.trim()) throw new Error('source text required');
  exec('INSERT INTO localizations (source_kind, source_id, title, source_text, target_lang, notes, created_by) VALUES (?,?,?,?,?,?,?)',
    sourceKind, sourceId === null ? null : String(sourceId), String(name || 'Untitled').slice(0, 140), text, targetLang, notes, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-LOC-001',
    taskType: `l10n:${id}`,
    input: { prompt: `Adapt this into ${targetLang === 'ar' ? 'Arabic' : targetLang}. Preserve all formatting and placeholders exactly.${notes ? `\nBrief: ${notes}` : ''}\n\n---\n${String(text).slice(0, 14000)}` },
    actor,
  });
  exec('UPDATE localizations SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'localization.requested', subjectType: 'localization', subjectId: id, payload: { sourceKind, targetLang } });
  return one('SELECT * FROM localizations WHERE id = ?', id);
}

export function listLocalizations() {
  return q('SELECT * FROM localizations ORDER BY id DESC LIMIT 100')
    .map((l) => ({ ...l, notesList: l.notes ? [l.notes] : [] }));
}

export function approveLocalization(id, { output = null, actor }) {
  const l = one('SELECT * FROM localizations WHERE id = ?', id);
  if (!l) throw new Error('not found');
  exec("UPDATE localizations SET state = 'approved', output = COALESCE(?, output), approved_by = ? WHERE id = ?", output, actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'localization.approved', subjectType: 'localization', subjectId: id });
  return one('SELECT * FROM localizations WHERE id = ?', id);
}

// ---------- Market watch ----------
export function addCompetitor({ name, website = null, segment = null, researchNow = true, actor }) {
  if (!name?.trim()) throw new Error('name required');
  exec('INSERT INTO competitors (name, website, segment, created_by) VALUES (?,?,?,?)', name.trim(), website, segment, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  if (researchNow) {
    const runId = enqueueRun({
      agentId: 'AGT-RES-001',
      taskType: `competitor:${id}`,
      input: {
        prompt: `Profile this competitor for our market watch: ${name.trim()}${website ? ` (${website})` : ''}${segment ? ` — segment: ${segment}` : ''}.

Cover: what they sell and to whom, their positioning, known pricing with its period, their genuine strengths, their exploitable weaknesses, and how they would respond if we entered their space. Mark every claim you cannot verify as [Unverified] with the period it refers to. Put the summary in "summary" and the confidence honestly.`,
      },
      actor,
    });
    exec('UPDATE competitors SET run_id = ? WHERE id = ?', runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'competitor.added', subjectType: 'competitor', subjectId: id, payload: { name, website } });
  return one('SELECT * FROM competitors WHERE id = ?', id);
}

export function listCompetitors() { return q("SELECT * FROM competitors ORDER BY state = 'archived', threat DESC, id DESC LIMIT 100"); }

export function setCompetitorThreat(id, { threat, actor }) {
  const t = Math.min(5, Math.max(1, Number(threat) || 3));
  exec('UPDATE competitors SET threat = ? WHERE id = ?', t, id);
  audit({ actorType: 'human', actorId: actor, action: 'competitor.threat', subjectType: 'competitor', subjectId: id, payload: { threat: t } });
}

/** Check a rival's own site — the same harvester Intelligence uses. */
export async function checkCompetitorSite(id, actor) {
  const c = one('SELECT * FROM competitors WHERE id = ?', id);
  if (!c) throw new Error('competitor not found');
  if (!c.website) throw new Error('no website on file');
  const res = await enrichFromWeb(c.website).catch(() => ({ ok: false }));
  const note = res.ok
    ? `Site reachable (${res.pages.length} page(s)). ${res.profile?.value ? `Positioning: ${res.profile.value.slice(0, 300)}` : ''}${res.emails?.length ? ` Contact: ${res.emails[0].value}` : ''}`
    : `Site unreachable (${res.reason || 'no response'}).`;
  exec("UPDATE competitors SET last_checked = datetime('now'), brief = COALESCE(brief, '') || ? WHERE id = ?", `\n[${new Date().toISOString().slice(0, 10)}] ${note}`, id);
  audit({ actorType: 'human', actorId: actor, action: 'competitor.site_checked', subjectType: 'competitor', subjectId: id, payload: { ok: res.ok } });
  return { ok: res.ok, note };
}

// ---------- Enablement (training the workforce) ----------
export function createEnablement({ agentId, trigger = 'manual', actor }) {
  if (!one('SELECT id FROM agents WHERE id = ?', agentId)) throw new Error('unknown agent');
  const evals = q('SELECT kind, score, passed, total, details, created_at FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 5', agentId);
  const fails = q("SELECT failure_reason, task_type, created_at FROM runs WHERE agent_id = ? AND state IN ('failed','awaiting_human') AND failure_reason IS NOT NULL ORDER BY created_at DESC LIMIT 10", agentId);
  const spec = one('SELECT spec FROM agents WHERE id = ?', agentId).spec;
  exec('INSERT INTO enablement_plans (agent_id, trigger, created_by) VALUES (?,?,?)', agentId, trigger, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-DOC-001',
    taskType: `enablement:${id}`,
    input: {
      prompt: `Write an improvement plan for one of our AI employees.

EMPLOYEE: ${agentId}
Its current role specification:
${String(spec).slice(0, 2500)}

Recent eval results:
${evals.map((e) => `- ${e.created_at.slice(0, 10)} ${e.kind}: ${Math.round(e.score * 100)}% (${e.passed}/${e.total})`).join('\n') || '- never evaluated'}

Recent failures and holds:
${fails.map((f) => `- ${f.task_type}: ${String(f.failure_reason).slice(0, 160)}`).join('\n') || '- none recorded'}

Diagnose the actual pattern behind these — not "try harder". Then give: the specific wording changes its role specification needs, what its output contract should tighten, which cases belong in its golden set, and how we would know the change worked. Put the diagnosis in "findings" and the plan in "draft".`,
    },
    actor,
  });
  exec('UPDATE enablement_plans SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'enablement.requested', subjectType: 'agent', subjectId: agentId, payload: { planId: id, trigger } });
  return one('SELECT * FROM enablement_plans WHERE id = ?', id);
}

export function listEnablement() { return q('SELECT * FROM enablement_plans ORDER BY id DESC LIMIT 60'); }

export function setEnablementState(id, { state, actor }) {
  if (!['analysing', 'ready', 'applied', 'dismissed'].includes(state)) throw new Error('bad state');
  exec("UPDATE enablement_plans SET state = ?, applied_by = CASE WHEN ? = 'applied' THEN ? ELSE applied_by END WHERE id = ?", state, state, actor, id);
  audit({ actorType: 'human', actorId: actor, action: `enablement.${state}`, subjectType: 'enablement', subjectId: id });
}

/** Immune rule: a weak eval should produce training, not just a red number. */
export function ruleEnablementFromEvals() {
  for (const e of q('SELECT * FROM eval_runs WHERE score < 0.7 ORDER BY id DESC LIMIT 5')) {
    if (one("SELECT id FROM enablement_plans WHERE agent_id = ? AND created_at >= datetime('now','-7 days')", e.agent_id)) continue;
    try { createEnablement({ agentId: e.agent_id, trigger: 'eval-fail', actor: 'system:enablement' }); } catch { /* skip */ }
  }
}

// ---------- shared sync tick ----------
export function syncDepartments() {
  const pull = (row) => {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', row.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) return null;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
    return { parsed, run };
  };

  for (const p of q("SELECT * FROM pricing_records WHERE run_id IS NOT NULL AND rationale IS NULL")) {
    const r = pull(p); if (!r) continue;
    exec('UPDATE pricing_records SET rationale = ? WHERE id = ?',
      r.parsed ? (r.parsed.markdown || r.parsed.summary || JSON.stringify(r.parsed).slice(0, 4000)) : `analysis failed: ${r.run.failure_reason || r.run.state}`, p.id);
  }

  for (const h of q("SELECT * FROM customer_health WHERE run_id IS NOT NULL AND notes IS NULL")) {
    const r = pull(h); if (!r) continue;
    const p = r.parsed || {};
    exec('UPDATE customer_health SET score = ?, stage = ?, notes = ?, next_step = ? WHERE id = ?',
      Math.min(5, Math.max(1, Number(p.score) || 3)),
      ['onboarding', 'adopting', 'healthy', 'at_risk', 'churn_risk'].includes(p.stage) ? p.stage : 'adopting',
      (p.signals || []).join(' · ') || r.run.failure_reason || 'no signals returned',
      p.nextStep || null, h.id);
    if (['at_risk', 'churn_risk'].includes(p.stage)) {
      const c = one('SELECT name, mrr_usd FROM customers WHERE id = ?', h.customer_id);
      notify({ level: 'warn', source: 'success', message: `${c?.name} is ${p.stage} ($${c?.mrr_usd}/mo) — ${p.nextStep || 'needs attention'}.`, subjectType: 'customer', subjectId: h.customer_id });
    }
  }

  for (const l of q("SELECT * FROM localizations WHERE state = 'translating' AND run_id IS NOT NULL")) {
    const r = pull(l); if (!r) continue;
    if (r.parsed?.translation) {
      exec("UPDATE localizations SET state = 'ready', output = ?, notes = COALESCE(notes,'') || ? WHERE id = ?",
        r.parsed.translation, (r.parsed.notes || []).length ? `\n${r.parsed.notes.join(' · ')}` : '', l.id);
      notify({ level: 'info', source: 'localization', message: `Translation ready: ${l.title} → ${l.target_lang}`, subjectType: 'localization', subjectId: l.id });
    } else exec("UPDATE localizations SET state = 'failed', notes = ? WHERE id = ?", r.run.failure_reason || r.run.state, l.id);
  }

  for (const c of q('SELECT * FROM competitors WHERE run_id IS NOT NULL AND brief IS NULL')) {
    const r = pull(c); if (!r) continue;
    const p = r.parsed || {};
    exec('UPDATE competitors SET brief = ?, last_checked = datetime(\'now\') WHERE id = ?',
      p.summary || p.markdown || (p.claims ? p.claims.map((x) => `- ${x.claim} (${x.source})`).join('\n') : null) || `research failed: ${r.run.failure_reason || r.run.state}`, c.id);
  }

  for (const e of q("SELECT * FROM enablement_plans WHERE state = 'analysing' AND run_id IS NOT NULL")) {
    const r = pull(e); if (!r) continue;
    const p = r.parsed || {};
    exec("UPDATE enablement_plans SET state = 'ready', findings = ?, plan = ? WHERE id = ?",
      (p.flags || []).join(' · ') || p.findings || null, p.draft || p.markdown || JSON.stringify(p).slice(0, 4000), e.id);
    notify({ level: 'info', source: 'enablement', message: `Improvement plan ready for ${e.agent_id} — review and apply it to the role spec.`, subjectType: 'enablement', subjectId: e.id });
  }
}
