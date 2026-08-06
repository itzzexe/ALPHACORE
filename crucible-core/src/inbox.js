// The approvals inbox — one queue for everything in the company that is
// waiting on a person.
//
// The platform deliberately stops at a human in a dozen different places:
// publishing, sending, signing, gate verdicts, evidence verification, design
// review. Each of those used to live only on its own page, so the Human Gate
// could honestly say "nothing waiting" while a written document sat blocked
// somewhere else. That is the failure this module removes: every department
// that can hold work for a human reports it here, with the same shape, a deep
// link home, and — where the action is a single unambiguous yes — a button.
import { q, one } from './db.js';

const hoursSince = (ts) => {
  if (!ts) return 0;
  const r = one("SELECT (julianday('now') - julianday(?)) * 24 AS h", ts);
  return Math.max(0, Math.round((r?.h || 0) * 10) / 10);
};

/**
 * One waiting item. `action` is filled only when a single POST with no extra
 * input is a complete, safe answer; anything needing judgement or typed input
 * links to its section instead.
 */
const item = ({ kind, dept, id, title, sub = null, href, at = null, severity = 'normal', action = null, actionLabel = null, secondary = null }) => ({
  kind, dept, id: String(id), title: String(title || '').slice(0, 160), sub, href,
  ageHours: hoursSince(at), at, severity, action, actionLabel, secondary,
});

export function pendingApprovals() {
  const items = [];

  // --- the run gate: the original queue ---
  for (const r of q("SELECT * FROM runs WHERE state = 'awaiting_human' ORDER BY created_at LIMIT 40")) {
    items.push(item({
      kind: 'run', dept: 'gate', id: r.id,
      title: `${r.agent_id} — ${r.task_type}`,
      sub: r.failure_reason || 'held for a human verdict',
      href: '#/gate', at: r.created_at, severity: 'high',
      action: { method: 'POST', path: `/api/runs/${r.id}/resolve`, body: { verdict: 'approved' } },
      actionLabel: 'Approve',
      secondary: { method: 'POST', path: `/api/runs/${r.id}/resolve`, body: { verdict: 'rejected' }, label: 'Reject' },
    }));
  }

  // --- system design: documents written but held for review ---
  for (const d of q(`SELECT d.*, b.name AS bp_name FROM blueprint_docs d JOIN blueprints b ON b.id = d.blueprint_id
                     WHERE d.state = 'awaiting_human' ORDER BY d.id LIMIT 30`)) {
    const written = Boolean(d.content);
    items.push(item({
      kind: 'designDoc', dept: 'systems', id: d.id,
      title: `${d.bp_name} — ${d.title}`,
      sub: written ? 'written and waiting for your approval' : (JSON.parse(d.open_questions || '[]')[0] || 'could not be written — retry or rewrite'),
      href: `#/systems/${d.blueprint_id}/${d.doc_key}`, at: d.created_at,
      severity: written ? 'normal' : 'high',
      action: written ? { method: 'POST', path: `/api/design/docs/${d.id}/approve`, body: {} } : null,
      actionLabel: written ? 'Approve' : null,
      secondary: { method: 'POST', path: `/api/design/docs/${d.id}/redo`, body: {}, label: 'Rewrite' },
    }));
  }

  // --- social: a human publishes, always ---
  for (const p of q("SELECT p.*, c.platform, c.handle FROM posts p LEFT JOIN channels c ON c.id = p.channel_id WHERE p.state IN ('draft_ready','scheduled') ORDER BY p.id LIMIT 30")) {
    items.push(item({
      kind: 'post', dept: 'social', id: p.id,
      title: `${p.platform ? `${p.platform} @${p.handle}` : 'Social post'} — ${String(p.draft || p.brief).slice(0, 90)}`,
      sub: p.state === 'scheduled' ? `scheduled for ${p.schedule_at}` : 'draft ready — only a human can publish',
      href: '#/social', at: p.created_at,
      action: { method: 'POST', path: `/api/posts/${p.id}/publish`, body: {} }, actionLabel: 'Publish',
    }));
  }

  // --- content studio ---
  for (const c of q("SELECT * FROM content_items WHERE state IN ('draft_ready','approved') ORDER BY id LIMIT 30")) {
    items.push(item({
      kind: 'content', dept: 'content', id: c.id,
      title: `${c.kind} — ${c.title}`,
      sub: c.state === 'approved' ? 'approved — publish when ready' : 'drafted, awaiting your approval',
      href: '#/content', at: c.created_at,
      action: { method: 'POST', path: `/api/content/${c.id}/verdict`, body: { verdict: c.state === 'approved' ? 'published' : 'approved' } },
      actionLabel: c.state === 'approved' ? 'Publish' : 'Approve',
    }));
  }

  // --- design studio ---
  for (const d of q("SELECT * FROM designs WHERE state = 'draft_ready' ORDER BY id LIMIT 20")) {
    items.push(item({
      kind: 'design', dept: 'design', id: d.id,
      title: `${d.kind} — ${d.title}`, sub: 'design delivered, awaiting approval',
      href: '#/design', at: d.created_at,
      action: { method: 'POST', path: `/api/designs/${d.id}/approve`, body: {} }, actionLabel: 'Approve',
    }));
  }

  // --- marketing: copy goes live only by a human hand ---
  for (const c of q("SELECT * FROM campaigns WHERE state = 'pending_approval' ORDER BY id LIMIT 20")) {
    items.push(item({
      kind: 'campaign', dept: 'marketing', id: c.id,
      title: `Campaign — ${c.name}`, sub: 'copy drafted; approving puts it live',
      href: '#/marketing', at: c.created_at, severity: 'high',
      action: { method: 'POST', path: `/api/campaigns/${c.id}/approve`, body: {} }, actionLabel: 'Approve → live',
    }));
  }

  // --- relations: outreach drafts wait for a person to send ---
  for (const p of q('SELECT * FROM partners WHERE draft IS NOT NULL ORDER BY id LIMIT 20')) {
    items.push(item({
      kind: 'partner', dept: 'relations', id: p.id,
      title: `Outreach to ${p.name}`, sub: String(p.draft).slice(0, 120),
      href: '#/relations', at: p.created_at,
      action: { method: 'POST', path: `/api/partners/${p.id}/send`, body: {} }, actionLabel: 'Mark sent by me',
    }));
  }

  // --- support: never AI-sent ---
  for (const t of q("SELECT * FROM tickets WHERE state IN ('draft_ready','escalated') ORDER BY id LIMIT 30")) {
    items.push(item({
      kind: 'ticket', dept: 'support', id: t.id,
      title: `${t.customer} — ${t.subject}`,
      sub: t.state === 'escalated' ? 'escalated: a human must write and send this' : 'reply drafted, awaiting your send',
      href: '#/support', at: t.created_at, severity: t.state === 'escalated' ? 'high' : 'normal',
      action: t.state === 'draft_ready' ? { method: 'POST', path: `/api/tickets/${t.id}/send`, body: {} } : null,
      actionLabel: t.state === 'draft_ready' ? 'Send' : null,
    }));
  }

  // --- requests stopped at a department that needs a person ---
  for (const r of q("SELECT * FROM requests WHERE state = 'awaiting_human' ORDER BY id LIMIT 20")) {
    const step = one("SELECT seq, dept, title, note FROM request_steps WHERE request_id = ? AND state = 'awaiting_human' ORDER BY seq LIMIT 1", r.id);
    items.push(item({
      kind: 'request', dept: 'requests', id: r.id,
      title: `${r.title} — ${step ? step.dept.toUpperCase() : 'stalled'}`,
      sub: step ? (step.note || step.title) : 'the route is waiting on you',
      href: `#/requests/${r.id}`, at: r.created_at, severity: 'high',
      action: { method: 'POST', path: `/api/requests/${r.id}/signoff`, body: {} }, actionLabel: 'Sign off & continue',
    }));
  }

  // --- journeys stopped at a human stage ---
  for (const j of q("SELECT * FROM journeys WHERE state = 'awaiting_human' ORDER BY id LIMIT 20")) {
    const stage = one("SELECT dept, title FROM journey_stages WHERE journey_id = ? AND state IN ('active','awaiting_human') ORDER BY seq LIMIT 1", j.id);
    items.push(item({
      kind: 'journey', dept: 'journeys', id: j.id,
      title: `${j.title} — ${stage ? stage.dept.toUpperCase() : 'stage'}`,
      sub: stage ? stage.title : 'a stage needs your sign-off',
      href: `#/journeys/${j.id}`, at: j.created_at, severity: 'high',
      action: { method: 'POST', path: `/api/journeys/${j.id}/complete-stage`, body: {} }, actionLabel: 'Sign off',
    }));
  }

  // --- financial reports awaiting approval ---
  for (const r of q("SELECT * FROM fin_reports WHERE state = 'ready' ORDER BY id LIMIT 20")) {
    const flags = r.flags ? JSON.parse(r.flags) : [];
    items.push(item({
      kind: 'finReport', dept: 'finreports', id: r.id,
      title: r.title, sub: flags.length ? `⚑ ${flags[0]}` : 'prepared, awaiting your approval',
      href: '#/finreports', at: r.created_at, severity: flags.length ? 'high' : 'normal',
      action: { method: 'POST', path: `/api/finreports/${r.id}/approve`, body: {} }, actionLabel: 'Approve',
    }));
  }

  // --- disputes: HR has framed it, only the owner may rule ---
  for (const d of q("SELECT * FROM disputes WHERE state = 'recommended' ORDER BY id LIMIT 20")) {
    items.push(item({
      kind: 'dispute', dept: 'disputes', id: d.id,
      title: `Ruling needed: ${d.title}`,
      sub: `${d.party_a} vs ${d.party_b} — HR recommends: ${String(d.recommendation || '').slice(0, 120)}`,
      href: '#/disputes', at: d.created_at, severity: 'high',
    }));
  }

  // --- pricing: a number becomes quotable only when a human approves it ---
  for (const p of q("SELECT * FROM pricing_records WHERE state = 'draft' ORDER BY id LIMIT 15")) {
    items.push(item({
      kind: 'pricing', dept: 'pricing', id: p.id,
      title: `Pricing draft: ${p.name} — ${p.amount} ${p.currency} ${p.unit}`,
      sub: 'agents may not quote a price until this is approved',
      href: '#/pricing', at: p.created_at,
      action: { method: 'POST', path: `/api/pricing/${p.id}/state`, body: { state: 'approved' } }, actionLabel: 'Approve',
    }));
  }

  // --- localization awaiting sign-off ---
  for (const l of q("SELECT * FROM localizations WHERE state = 'ready' ORDER BY id LIMIT 15")) {
    items.push(item({
      kind: 'localization', dept: 'localization', id: l.id,
      title: `Translation ready: ${l.title} → ${l.target_lang}`,
      sub: 'review the adaptation before it is used',
      href: '#/localization', at: l.created_at,
      action: { method: 'POST', path: `/api/localization/${l.id}/approve`, body: {} }, actionLabel: 'Approve',
    }));
  }

  // --- enablement plans waiting to be applied to a role spec ---
  for (const e of q("SELECT * FROM enablement_plans WHERE state = 'ready' ORDER BY id LIMIT 15")) {
    items.push(item({
      kind: 'enablement', dept: 'enablement', id: e.id,
      title: `Improvement plan for ${e.agent_id}`,
      sub: String(e.findings || 'read the plan and apply it to the role specification').slice(0, 120),
      href: '#/enablement', at: e.created_at, severity: 'low',
    }));
  }

  // --- customers the success desk has flagged ---
  for (const h of q(`SELECT h.*, c.name FROM customer_health h JOIN customers c ON c.id = h.customer_id
                     WHERE h.stage IN ('at_risk','churn_risk') AND h.id IN (SELECT MAX(id) FROM customer_health GROUP BY customer_id) LIMIT 10`)) {
    items.push(item({
      kind: 'customerHealth', dept: 'success', id: h.customer_id,
      title: `${h.name} is ${h.stage.replace('_', ' ')}`,
      sub: h.next_step || String(h.notes || '').slice(0, 120),
      href: '#/success', at: h.created_at, severity: 'high',
    }));
  }

  // --- decisions: humans decide, always ---
  for (const d of q("SELECT * FROM decisions WHERE status = 'open' ORDER BY tier DESC, created_at LIMIT 20")) {
    items.push(item({
      kind: 'decision', dept: 'decisions', id: d.id,
      title: `${d.id} — ${d.title}`, sub: `${d.tier} · owner ${d.owner_human}${d.deadline ? ` · due ${d.deadline}` : ''}`,
      href: `#/decisions/${d.id}`, at: d.created_at, severity: ['T2', 'T3'].includes(d.tier) ? 'high' : 'normal',
    }));
  }

  // --- legal: signing is never delegated ---
  for (const c of q("SELECT * FROM contracts WHERE state IN ('draft','under_review') ORDER BY id LIMIT 20")) {
    items.push(item({
      kind: 'contract', dept: 'legal', id: c.id,
      title: `${c.kind} — ${c.title}`, sub: `${c.counterparty} · ${c.state}${c.review_due ? ` · review due ${c.review_due}` : ''}`,
      href: '#/legal', at: c.created_at,
    }));
  }

  // --- product gates ---
  for (const p of q("SELECT * FROM products WHERE state NOT IN ('retired')")) {
    const gates = JSON.parse(p.gates || '[]');
    const active = gates.find((g) => g.status === 'active');
    if (!active) continue;
    items.push(item({
      kind: 'productGate', dept: 'products', id: p.id,
      title: `${p.name} — Gate ${active.gate}: ${active.title}`,
      sub: 'a gate verdict needs a note and a named human',
      href: '#/products', at: p.created_at, severity: active.gate === 2 || active.gate === 8 ? 'high' : 'normal',
    }));
  }

  // --- intelligence: verification before outreach ---
  const unverified = one("SELECT COUNT(*) AS n FROM intel_records WHERE verification = 'unverified' AND (email IS NOT NULL OR phone IS NOT NULL)").n;
  if (unverified) {
    items.push(item({
      kind: 'intelBatch', dept: 'intel', id: 'batch',
      title: `${unverified} contactable intel record(s) unverified`,
      sub: 'verification is a human act — outreach should not start without it',
      href: '#/intel', severity: 'low',
    }));
  }

  // --- knowledge: only a human makes something organizational truth ---
  const unverifiedKnowledge = one("SELECT COUNT(*) AS n FROM memory_entries WHERE verification = 'unverified'").n;
  if (unverifiedKnowledge) {
    items.push(item({
      kind: 'knowledgeBatch', dept: 'knowledge', id: 'batch',
      title: `${unverifiedKnowledge} knowledge entr(ies) unverified`,
      sub: 'unverified claims never become company truth',
      href: '#/knowledge', severity: 'low',
    }));
  }

  // --- immune system and governance ---
  for (const p of q("SELECT * FROM problems WHERE state = 'open' ORDER BY id LIMIT 15")) {
    items.push(item({
      kind: 'problem', dept: 'governance', id: p.id,
      title: `Problem: ${p.signature}`, sub: `seen ${p.count}× · ${String(p.note || '').slice(0, 90)}`,
      href: '#/governance', at: p.created_at, severity: 'high',
      action: { method: 'POST', path: `/api/problems/${p.id}/resolve`, body: {} }, actionLabel: 'Resolve',
    }));
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const r of q('SELECT * FROM rituals WHERE next_due <= ? ORDER BY next_due LIMIT 10', today)) {
    items.push(item({
      kind: 'ritual', dept: 'governance', id: r.id,
      title: `Ritual due: ${r.title}`, sub: `${r.cadence} · due ${r.next_due} — no artifact, no meeting`,
      href: '#/governance', severity: r.next_due < today ? 'high' : 'normal',
    }));
  }
  for (const r of q("SELECT *, likelihood * impact AS score FROM risks WHERE state = 'open' AND (likelihood * impact >= 16 OR (review_date IS NOT NULL AND review_date < ?)) ORDER BY score DESC LIMIT 10", today)) {
    items.push(item({
      kind: 'risk', dept: 'risks', id: r.id,
      title: `Risk (${r.score}): ${r.title}`,
      sub: r.review_date && r.review_date < today ? `review overdue since ${r.review_date}` : 'critical score — needs an owner decision',
      href: '#/risks', severity: 'high',
    }));
  }

  // --- what the orchestrator escalated ---
  const cycle = one("SELECT * FROM maestro_cycles WHERE flags IS NOT NULL AND flags != '[]' ORDER BY id DESC LIMIT 1");
  if (cycle) {
    for (const f of JSON.parse(cycle.flags)) {
      items.push(item({
        kind: 'maestroFlag', dept: 'harmony', id: `${cycle.id}`,
        title: String(f), sub: `raised by the orchestrator in cycle #${cycle.id}`,
        href: '#/harmony', at: cycle.created_at, severity: 'low',
      }));
    }
  }

  const order = { high: 0, normal: 1, low: 2 };
  items.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.ageHours - a.ageHours));
  return items;
}

export function inboxSummary() {
  const items = pendingApprovals();
  const byDept = {};
  for (const i of items) byDept[i.dept] = (byDept[i.dept] || 0) + 1;
  return {
    total: items.length,
    high: items.filter((i) => i.severity === 'high').length,
    oldestHours: items.reduce((a, i) => Math.max(a, i.ageHours), 0),
    actionable: items.filter((i) => i.action).length,
    byDept,
    items,
  };
}

/** Just the number, for the shell badge — cheap enough to poll. */
export function inboxCount() {
  return pendingApprovals().length;
}
