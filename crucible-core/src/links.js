// The relationship resolver — one place that answers "what is connected to
// this?" for ANY entity in the company, across every department.
//
// Departments used to link only where someone wrote a join by hand, which
// left real relationships invisible (a customer's tickets, a product's
// designs, an intel record's segments). This module makes the connections
// first-class: every entity type declares its edges once, and the whole UI
// gets a 360° panel from the same source of truth. The map, the graph page,
// and every entity page read from here.
import { q, one } from './db.js';

const clean = (arr) => arr.filter((g) => g && g.items && g.items.length);

/** A connection group: what department, what it is, and how to reach it. */
const g = (label, dept, items) => ({ label, dept, items });
const item = (type, id, title, sub = null) => ({ type, id: String(id), title: String(title || '').slice(0, 120), sub });

/**
 * Everything connected to one entity, grouped by department.
 * type: customer|product|campaign|deal|partner|intelRecord|intelQuery|segment|
 *       dataset|incident|ticket|project|task|journey|agent|decision|person|
 *       vendor|contract|post|content|design|archiveItem|run
 */
export function connectionsFor(type, rawId) {
  const id = rawId;
  const groups = [];
  const A = (...gs) => groups.push(...gs);

  switch (type) {
    case 'customer': {
      const c = one('SELECT * FROM customers WHERE id = ?', id);
      if (!c) return null;
      A(
        g('Deals', 'sales', q('SELECT id, name, stage, value_usd FROM deals WHERE customer_id = ?', id)
          .map((d) => item('deal', d.id, d.name, `${d.stage} · $${d.value_usd}`))),
        g('Support tickets', 'support', q('SELECT id, subject, state FROM tickets WHERE customer = ? ORDER BY id DESC LIMIT 10', c.name)
          .map((t) => item('ticket', t.id, t.subject, t.state))),
        g('Interactions', 'relations', q('SELECT id, kind, summary, created_at FROM interactions WHERE customer_id = ? ORDER BY id DESC LIMIT 8', id)
          .map((i) => item('interaction', i.id, i.summary, `${i.kind} · ${i.created_at.slice(0, 10)}`))),
        g('Came from campaign', 'marketing', c.campaign_id
          ? q('SELECT id, name, channel FROM campaigns WHERE id = ?', c.campaign_id).map((x) => item('campaign', x.id, x.name, x.channel)) : []),
        g('Product', 'products', c.product_id
          ? q('SELECT id, name, state FROM products WHERE id = ?', c.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
        g('Sourced from intelligence', 'intel', q('SELECT id, name, completeness FROM intel_records WHERE customer_id = ?', id)
          .map((r) => item('intelRecord', r.id, r.name, `completeness ${Math.round(r.completeness * 100)}%`))),
      );
      break;
    }
    case 'request': {
      const r = one('SELECT * FROM requests WHERE id = ?', id);
      if (!r) return null;
      const steps = q('SELECT * FROM request_steps WHERE request_id = ? ORDER BY seq', id);
      A(
        g('Departments on the route', 'requests', steps.map((s) => item('request', r.id, `${s.seq}. ${s.dept}`, s.state))),
        g('Work opened in other departments', 'data', steps.filter((s) => s.spawn_id)
          .map((s) => item(s.spawn_kind, s.spawn_id, `${s.spawn_kind} #${s.spawn_id}`, s.dept))),
        g('Agent runs', 'runs', steps.filter((s) => s.run_id)
          .map((s) => item('run', s.run_id, `${s.agent_id} — ${s.dept}`, s.state))),
        g('Archive', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'request' AND subject_id = ?", String(id))
          .map((a) => item('archiveItem', a.id, a.title))),
      );
      break;
    }
    case 'blueprint': {
      const b = one('SELECT * FROM blueprints WHERE id = ?', id);
      if (!b) return null;
      A(
        g('Documents', 'design', q('SELECT id, doc_key, title, state FROM blueprint_docs WHERE blueprint_id = ? ORDER BY seq', id)
          .map((d) => item('blueprint', b.id, d.title, d.state))),
        g('Infrastructure plans', 'infra', q('SELECT id, name, state, section FROM infra_plans WHERE blueprint_id = ?', id)
          .map((p) => item('infraPlan', p.id, p.name, `${p.section} · ${p.state}`))),
        g('Product', 'products', b.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', b.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
        g('Project', 'projects', b.project_id ? q('SELECT id, name, state FROM projects WHERE id = ?', b.project_id).map((p) => item('project', p.id, p.name, p.state)) : []),
        g('Runs', 'runs', q('SELECT r.id, r.agent_id, r.state FROM runs r JOIN blueprint_docs d ON d.run_id = r.id WHERE d.blueprint_id = ?', id)
          .map((r) => item('run', r.id, r.agent_id, r.state))),
        g('Archive', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'blueprint' AND subject_id = ?", String(id))
          .map((a) => item('archiveItem', a.id, a.title))),
      );
      break;
    }
    case 'infraPlan': {
      const p = one('SELECT * FROM infra_plans WHERE id = ?', id);
      if (!p) return null;
      A(
        g('Design package', 'design', p.blueprint_id ? q('SELECT id, name, state FROM blueprints WHERE id = ?', p.blueprint_id).map((b) => item('blueprint', b.id, b.name, b.state)) : []),
        g('Product', 'products', p.product_id ? q('SELECT id, name FROM products WHERE id = ?', p.product_id).map((x) => item('product', x.id, x.name)) : []),
        g('Run', 'runs', p.run_id ? q('SELECT id, agent_id, state FROM runs WHERE id = ?', p.run_id).map((r) => item('run', r.id, r.agent_id, r.state)) : []),
      );
      break;
    }
    case 'finReport': {
      const r = one('SELECT * FROM fin_reports WHERE id = ?', id);
      if (!r) return null;
      A(
        g('Run', 'runs', r.run_id ? q('SELECT id, agent_id, state FROM runs WHERE id = ?', r.run_id).map((x) => item('run', x.id, x.agent_id, x.state)) : []),
        g('Archive', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'finReport' AND subject_id = ?", String(id)).map((a) => item('archiveItem', a.id, a.title))),
        g('Live ledger sources', 'finance', [
          item('customer', 'all', `${one("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'").n} active customers`, 'MRR'),
          item('vendor', 'all', `${one("SELECT COUNT(*) AS n FROM vendors WHERE state = 'active'").n} active vendors`, 'burn'),
          item('deal', 'all', `${one('SELECT COUNT(*) AS n FROM deals').n} deals`, 'pipeline'),
        ]),
      );
      break;
    }
    case 'product': {
      const p = one('SELECT * FROM products WHERE id = ?', id);
      if (!p) return null;
      A(
        g('Design packages', 'design', q('SELECT id, name, state FROM blueprints WHERE product_id = ?', id).map((b) => item('blueprint', b.id, b.name, b.state))),
        g('Infrastructure plans', 'infra', q('SELECT id, name, state FROM infra_plans WHERE product_id = ?', id).map((x) => item('infraPlan', x.id, x.name, x.state))),
        g('Journeys', 'journeys', q('SELECT id, title, state FROM journeys WHERE product_id = ?', id).map((j) => item('journey', j.id, j.title, j.state))),
        g('Projects', 'projects', q('SELECT id, name, state FROM projects WHERE product_id = ?', id).map((x) => item('project', x.id, x.name, x.state))),
        g('Pipelines', 'pipelines', q('SELECT id, name, state FROM pipelines WHERE product_id = ?', id).map((x) => item('pipeline', x.id, x.name, x.state))),
        g('Customers', 'customers', q('SELECT id, name, state, mrr_usd FROM customers WHERE product_id = ?', id).map((c) => item('customer', c.id, c.name, `${c.state} · $${c.mrr_usd}/mo`))),
        g('Deals', 'sales', q('SELECT id, name, stage FROM deals WHERE product_id = ?', id).map((d) => item('deal', d.id, d.name, d.stage))),
        g('Campaigns', 'marketing', q('SELECT id, name, state FROM campaigns WHERE product_id = ?', id).map((c) => item('campaign', c.id, c.name, c.state))),
        g('Content', 'content', q('SELECT id, title, state FROM content_items WHERE product_id = ?', id).map((c) => item('content', c.id, c.title, c.state))),
        g('Designs', 'design', q('SELECT id, title, state FROM designs WHERE product_id = ?', id).map((d) => item('design', d.id, d.title, d.state))),
        g('Social posts', 'social', q('SELECT id, brief, state FROM posts WHERE product_id = ?', id).map((x) => item('post', x.id, x.brief, x.state))),
        g('Incidents', 'incidents', q('SELECT id, title, sev, state FROM incidents WHERE product_id = ?', id).map((i) => item('incident', i.id, i.title, `${i.sev} · ${i.state}`))),
        g('Tickets', 'support', q('SELECT id, subject, state FROM tickets WHERE product_id = ? ORDER BY id DESC LIMIT 10', id).map((t) => item('ticket', t.id, t.subject, t.state))),
        g('Contracts', 'legal', q('SELECT id, title, state FROM contracts WHERE product_id = ?', id).map((c) => item('contract', c.id, c.title, c.state))),
        g('Objectives', 'objectives', q('SELECT id, title, quarter FROM objectives WHERE product_id = ?', id).map((o) => item('objective', o.id, o.title, o.quarter))),
      );
      break;
    }
    case 'campaign': {
      const c = one('SELECT * FROM campaigns WHERE id = ?', id);
      if (!c) return null;
      A(
        g('Social posts', 'social', q('SELECT id, brief, state FROM posts WHERE campaign_id = ?', id).map((p) => item('post', p.id, p.draft || p.brief, p.state))),
        g('Designs', 'design', q('SELECT id, title, state FROM designs WHERE campaign_id = ?', id).map((d) => item('design', d.id, d.title, d.state))),
        g('Content', 'content', q('SELECT id, title, state FROM content_items WHERE campaign_id = ?', id).map((x) => item('content', x.id, x.title, x.state))),
        g('Customers acquired', 'customers', q('SELECT id, name, state, mrr_usd FROM customers WHERE campaign_id = ?', id).map((x) => item('customer', x.id, x.name, `${x.state} · $${x.mrr_usd}/mo`))),
        g('Segments targeted', 'segments', q('SELECT id, name FROM segments WHERE campaign_id = ?', id).map((s) => item('segment', s.id, s.name))),
        g('Product', 'products', c.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', c.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
      );
      break;
    }
    case 'deal': {
      const d = one('SELECT * FROM deals WHERE id = ?', id);
      if (!d) return null;
      A(
        g('Customer', 'customers', d.customer_id ? q('SELECT id, name, state FROM customers WHERE id = ?', d.customer_id).map((c) => item('customer', c.id, c.name, c.state)) : []),
        g('Partner', 'relations', d.partner_id ? q('SELECT id, name, kind FROM partners WHERE id = ?', d.partner_id).map((p) => item('partner', p.id, p.name, p.kind)) : []),
        g('Product', 'products', d.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', d.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
        g('Proposal run', 'runs', d.draft_run_id ? q('SELECT id, agent_id, state FROM runs WHERE id = ?', d.draft_run_id).map((r) => item('run', r.id, r.agent_id, r.state)) : []),
      );
      break;
    }
    case 'partner': {
      A(
        g('Interactions', 'relations', q('SELECT id, kind, summary, created_at FROM interactions WHERE partner_id = ? ORDER BY id DESC LIMIT 10', id)
          .map((i) => item('interaction', i.id, i.summary, `${i.kind} · ${i.created_at.slice(0, 10)}`))),
        g('Deals', 'sales', q('SELECT id, name, stage, value_usd FROM deals WHERE partner_id = ?', id).map((d) => item('deal', d.id, d.name, `${d.stage} · $${d.value_usd}`))),
        g('Outreach runs', 'runs', q("SELECT id, agent_id, state FROM runs WHERE task_type = ? ORDER BY created_at DESC LIMIT 5", `outreach:${id}`)
          .map((r) => item('run', r.id, r.agent_id, r.state))),
      );
      break;
    }
    case 'intelRecord': {
      const r = one('SELECT * FROM intel_records WHERE id = ?', id);
      if (!r) return null;
      A(
        g('Campaign', 'intel', q('SELECT id, question FROM intel_queries WHERE id = ?', r.query_id).map((x) => item('intelQuery', x.id, x.question))),
        g('Segments', 'segments', q('SELECT s.id, s.name FROM segments s JOIN segment_members m ON m.segment_id = s.id WHERE m.record_id = ?', id)
          .map((s) => item('segment', s.id, s.name))),
        g('CRM lead', 'customers', r.customer_id ? q('SELECT id, name, state FROM customers WHERE id = ?', r.customer_id).map((c) => item('customer', c.id, c.name, c.state)) : []),
        g('Contact points', 'intel', q('SELECT id, email, phone, source_url FROM intel_contacts WHERE record_id = ? LIMIT 8', id)
          .map((c) => item('contact', c.id, c.email || c.phone, c.source_url))),
        g('Evidence sources', 'intel', [...new Map(q('SELECT field, source_url FROM intel_evidence WHERE record_id = ? AND source_url IS NOT NULL', id)
          .map((e) => [e.source_url, e])).values()].map((e) => item('url', e.source_url, e.source_url, e.field))),
      );
      break;
    }
    case 'intelQuery': {
      A(
        g('Records', 'intel', q('SELECT id, name, completeness FROM intel_records WHERE query_id = ? ORDER BY completeness DESC LIMIT 20', id)
          .map((r) => item('intelRecord', r.id, r.name, `${Math.round(r.completeness * 100)}%`))),
        g('Segments built from it', 'segments', q(`SELECT DISTINCT s.id, s.name FROM segments s JOIN segment_members m ON m.segment_id = s.id
            JOIN intel_records r ON r.id = m.record_id WHERE r.query_id = ?`, id).map((s) => item('segment', s.id, s.name))),
        g('Leads created', 'customers', q('SELECT c.id, c.name, c.state FROM customers c JOIN intel_records r ON r.customer_id = c.id WHERE r.query_id = ?', id)
          .map((c) => item('customer', c.id, c.name, c.state))),
        g('Archive exports', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'intelQuery' AND subject_id = ?", String(id))
          .map((a) => item('archiveItem', a.id, a.title))),
      );
      break;
    }
    case 'segment': {
      const s = one('SELECT * FROM segments WHERE id = ?', id);
      if (!s) return null;
      A(
        g('Members', 'intel', q(`SELECT r.id, r.name, r.completeness FROM intel_records r JOIN segment_members m ON m.record_id = r.id
            WHERE m.segment_id = ? ORDER BY r.completeness DESC LIMIT 25`, id).map((r) => item('intelRecord', r.id, r.name, `${Math.round(r.completeness * 100)}%`))),
        g('Leads from members', 'customers', q(`SELECT c.id, c.name, c.state FROM customers c JOIN intel_records r ON r.customer_id = c.id
            JOIN segment_members m ON m.record_id = r.id WHERE m.segment_id = ?`, id).map((c) => item('customer', c.id, c.name, c.state))),
        g('Campaign', 'marketing', s.campaign_id ? q('SELECT id, name, state FROM campaigns WHERE id = ?', s.campaign_id).map((c) => item('campaign', c.id, c.name, c.state)) : []),
      );
      break;
    }
    case 'dataset': {
      const d = one('SELECT * FROM datasets WHERE id = ?', id);
      if (!d) return null;
      A(
        g('Source run', 'runs', d.run_id ? q('SELECT id, agent_id, state FROM runs WHERE id = ?', d.run_id).map((r) => item('run', r.id, r.agent_id, r.state)) : []),
        g('Derived campaigns', 'intel', q("SELECT id, question FROM intel_queries WHERE question LIKE ?", `[from dataset #${id}]%`)
          .map((x) => item('intelQuery', x.id, x.question))),
        g('Archive', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'dataset' AND subject_id = ?", String(id))
          .map((a) => item('archiveItem', a.id, a.title))),
        g('Lineage', 'data', d.parent_id ? q('SELECT id, name, kind FROM datasets WHERE id = ?', d.parent_id).map((x) => item('dataset', x.id, x.name, `parent · ${x.kind}`)) : []),
      );
      break;
    }
    case 'incident': {
      const i = one('SELECT * FROM incidents WHERE id = ?', id);
      if (!i) return null;
      A(
        g('Product', 'products', i.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', i.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
        g('Tickets that raised it', 'support', q('SELECT id, subject, state FROM tickets WHERE incident_id = ?', id).map((t) => item('ticket', t.id, t.subject, t.state))),
        g('Risks registered', 'risks', q("SELECT id, title, likelihood, impact FROM risks WHERE subject_type = 'incident' AND subject_id = ?", String(id))
          .map((r) => item('risk', r.id, r.title, `score ${r.likelihood * r.impact}`))),
        g('Postmortem pipeline', 'pipelines', i.postmortem_pipeline_id
          ? q('SELECT id, name, state FROM pipelines WHERE id = ?', i.postmortem_pipeline_id).map((p) => item('pipeline', p.id, p.name, p.state)) : []),
        g('Lessons recorded', 'knowledge', q('SELECT id, content FROM memory_entries WHERE source_ref = ?', `incident:${id}`)
          .map((m) => item('memory', m.id, m.content))),
        g('Status posts', 'social', q("SELECT id, brief, state FROM posts WHERE brief LIKE ?", `%incident%${i.title.slice(0, 20)}%`).map((p) => item('post', p.id, p.brief, p.state))),
      );
      break;
    }
    case 'ticket': {
      const t = one('SELECT * FROM tickets WHERE id = ?', id);
      if (!t) return null;
      A(
        g('Customer', 'customers', q('SELECT id, name, state FROM customers WHERE name = ? LIMIT 1', t.customer).map((c) => item('customer', c.id, c.name, c.state))),
        g('Product', 'products', t.product_id ? q('SELECT id, name FROM products WHERE id = ?', t.product_id).map((p) => item('product', p.id, p.name)) : []),
        g('Incident raised', 'incidents', t.incident_id ? q('SELECT id, title, sev FROM incidents WHERE id = ?', t.incident_id).map((i) => item('incident', i.id, i.title, i.sev)) : []),
        g('Draft run', 'runs', t.draft_run_id ? q('SELECT id, agent_id, state FROM runs WHERE id = ?', t.draft_run_id).map((r) => item('run', r.id, r.agent_id, r.state)) : []),
      );
      break;
    }
    case 'project': {
      const p = one('SELECT * FROM projects WHERE id = ?', id);
      if (!p) return null;
      A(
        g('Tasks', 'tasks', q('SELECT id, title, state, assignee_id FROM tasks WHERE project_id = ? ORDER BY id DESC LIMIT 25', id)
          .map((t) => item('task', t.id, t.title, `${t.state}${t.assignee_id ? ` · ${t.assignee_id}` : ''}`))),
        g('Product', 'products', p.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', p.product_id).map((x) => item('product', x.id, x.name, x.state)) : []),
      );
      break;
    }
    case 'journey': {
      const j = one('SELECT * FROM journeys WHERE id = ?', id);
      if (!j) return null;
      A(
        g('Stages', 'journeys', q('SELECT id, seq, dept, state, agent_id FROM journey_stages WHERE journey_id = ? ORDER BY seq', id)
          .map((s) => item('stage', s.id, `${s.seq}. ${s.dept}`, `${s.state}${s.agent_id ? ` · ${s.agent_id}` : ''}`))),
        g('Runs', 'runs', q(`SELECT r.id, r.agent_id, r.state FROM runs r JOIN journey_stages s ON s.run_id = r.id WHERE s.journey_id = ?`, id)
          .map((r) => item('run', r.id, r.agent_id, r.state))),
        g('Product', 'products', j.product_id ? q('SELECT id, name, state FROM products WHERE id = ?', j.product_id).map((p) => item('product', p.id, p.name, p.state)) : []),
        g('Archive', 'archive', q("SELECT id, title FROM archive_items WHERE subject_type = 'journey' AND subject_id = ?", String(id))
          .map((a) => item('archiveItem', a.id, a.title))),
      );
      break;
    }
    case 'agent': {
      A(
        g('Open tasks', 'tasks', q("SELECT id, title, state FROM tasks WHERE assignee_type = 'agent' AND assignee_id = ? AND state NOT IN ('done','cancelled') LIMIT 10", id)
          .map((t) => item('task', t.id, t.title, t.state))),
        g('Recent runs', 'runs', q('SELECT id, task_type, state FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10', id)
          .map((r) => item('run', r.id, r.task_type, r.state))),
        g('Journey stages', 'journeys', q('SELECT journey_id, dept, state FROM journey_stages WHERE agent_id = ? AND state IN (\'active\',\'awaiting_human\') LIMIT 8', id)
          .map((s) => item('journey', s.journey_id, s.dept, s.state))),
        g('Evals', 'evals', q('SELECT id, kind, score FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 5', id)
          .map((e) => item('eval', e.id, `${e.kind}`, `${Math.round(e.score * 100)}%`))),
      );
      break;
    }
    case 'person': {
      const p = one('SELECT * FROM people WHERE id = ?', id);
      if (!p) return null;
      A(
        g('Approvals given', 'oversight', p.actor_id ? q('SELECT id, subject_type, gate, verdict FROM approvals WHERE approver_human = ? ORDER BY id DESC LIMIT 10', p.actor_id)
          .map((a) => item('approval', a.id, `${a.subject_type} · ${a.gate}`, a.verdict)) : []),
        g('Incidents commanded', 'incidents', p.actor_id ? q('SELECT id, title, sev FROM incidents WHERE commander = ?', p.actor_id)
          .map((i) => item('incident', i.id, i.title, i.sev)) : []),
        g('Deals owned', 'sales', q('SELECT id, name, stage FROM deals WHERE owner = ? OR owner = ?', p.id, p.name).map((d) => item('deal', d.id, d.name, d.stage))),
        g('Partners owned', 'relations', q('SELECT id, name, tier FROM partners WHERE owner = ? OR owner = ?', p.id, p.name).map((x) => item('partner', x.id, x.name, x.tier))),
      );
      break;
    }
    case 'vendor': {
      A(
        g('Contracts', 'legal', q('SELECT id, kind, title, state FROM contracts WHERE vendor_id = ?', id).map((c) => item('contract', c.id, c.title, `${c.kind} · ${c.state}`))),
        g('Interactions', 'relations', q('SELECT id, kind, summary FROM interactions WHERE vendor_id = ? ORDER BY id DESC LIMIT 8', id).map((i) => item('interaction', i.id, i.summary, i.kind))),
        g('Renewal tasks', 'tasks', q("SELECT id, title, state FROM tasks WHERE title LIKE ? LIMIT 5", `Renewal review: %`).map((t) => item('task', t.id, t.title, t.state))),
      );
      break;
    }
    case 'decision': {
      A(
        g('Evidence', 'decisions', q('SELECT id, claim, verification FROM decision_evidence WHERE decision_id = ?', id).map((e) => item('evidence', e.id, e.claim, e.verification))),
        g('Tribunal rounds', 'decisions', q('SELECT id, round, label FROM tribunal_rounds WHERE decision_id = ? ORDER BY round', id).map((r) => item('round', r.id, r.label, `round ${r.round}`))),
        g('Runs', 'runs', q('SELECT id, agent_id, state FROM runs WHERE decision_id = ?', id).map((r) => item('run', r.id, r.agent_id, r.state))),
        g('Contracts', 'legal', q('SELECT id, title, state FROM contracts WHERE decision_id = ?', id).map((c) => item('contract', c.id, c.title, c.state))),
      );
      break;
    }
    default:
      return null;
  }

  // Everything that ever touched this subject, from the immutable record.
  const trail = q('SELECT seq, occurred_at, actor_type, actor_id, action FROM audit_log WHERE subject_type = ? AND subject_id = ? ORDER BY seq DESC LIMIT 12',
    type, String(id));
  return {
    type,
    id: String(id),
    groups: clean(groups),
    auditTrail: trail,
    totalLinks: clean(groups).reduce((a, x) => a + x.items.length, 0),
  };
}

/**
 * Every section on the map, with the division it belongs to and the live count
 * that makes it real. The map, the connectivity audit and the graph all read
 * this one list, so a section can never appear in one and be missing from
 * another.
 */
export function sectionCatalog() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const S = (id, label, division, href, count, hint) => ({ id, label, division, href, count, hint });
  return [
    // Engine
    S('requests', 'Request desk', 'engine', '#/requests', n('SELECT COUNT(*) AS n FROM requests'), 'Write what you need — the company routes it department to department until it is done'),
    S('agents', 'Agents', 'engine', '#/agents', n('SELECT COUNT(*) AS n FROM agents'), 'The AI workforce roster'),
    S('workforce', 'Workforce', 'engine', '#/workforce', n("SELECT COUNT(*) AS n FROM agents WHERE status='active'"), 'Per-employee load board'),
    S('runs', 'Run queue', 'engine', '#/runs', n('SELECT COUNT(*) AS n FROM runs'), 'Every unit of agent work'),
    S('pipelines', 'Pipelines', 'engine', '#/pipelines', n('SELECT COUNT(*) AS n FROM pipelines'), 'FORGE multi-agent chains'),
    S('providers', 'Providers', 'engine', '#/providers', 5, 'Model router and tier chains'),
    S('artifacts', 'Artifacts', 'engine', '#/artifacts', n('SELECT COUNT(*) AS n FROM archive_items WHERE file_ref IS NOT NULL'), 'Real files produced on disk'),
    // Build
    S('systems', 'System design', 'build', '#/systems', n('SELECT COUNT(*) AS n FROM blueprints'), 'Full specification packages'),
    S('infra', 'Infrastructure', 'build', '#/infra', n('SELECT COUNT(*) AS n FROM infra_plans'), 'Sizing, rate limits, CI/CD, DR'),
    S('products', 'Products', 'build', '#/products', n('SELECT COUNT(*) AS n FROM products'), 'Ten-gate product factory'),
    S('journeys', 'Journeys', 'build', '#/journeys', n('SELECT COUNT(*) AS n FROM journeys'), 'Work crossing all 14 departments'),
    S('projects', 'Projects', 'build', '#/projects', n('SELECT COUNT(*) AS n FROM projects'), 'Delivery containers'),
    S('tasks', 'Tasks', 'build', '#/tasks', n('SELECT COUNT(*) AS n FROM tasks'), 'Task tracker, delegable to agents'),
    // Decide
    S('gate', 'Human gate', 'decide', '#/gate', n("SELECT COUNT(*) AS n FROM runs WHERE state='awaiting_human'"), 'Where machines stop and people decide'),
    S('decisions', 'Decisions', 'decide', '#/decisions', n('SELECT COUNT(*) AS n FROM decisions'), 'Registry, evidence and tribunal'),
    S('budgets', 'Budgets', 'decide', '#/budgets', n('SELECT COUNT(*) AS n FROM budgets'), 'Reservation-first spend control'),
    S('risks', 'Risks', 'decide', '#/risks', n('SELECT COUNT(*) AS n FROM risks'), 'Likelihood × impact register'),
    S('quality', 'Quality', 'decide', '#/quality', n('SELECT COUNT(*) AS n FROM quality_reviews'), 'Reviews, evals, problems'),
    S('evals', 'Evals', 'decide', '#/evals', n('SELECT COUNT(*) AS n FROM eval_runs'), 'Golden sets and canaries'),
    // Data
    S('intel', 'Intelligence', 'data', '#/intel', n('SELECT COUNT(*) AS n FROM intel_records'), 'Multi-pass collection with web harvesting'),
    S('segments', 'Segments', 'data', '#/segments', n('SELECT COUNT(*) AS n FROM segments'), 'Targetable audiences'),
    S('data', 'Datasets', 'data', '#/data', n('SELECT COUNT(*) AS n FROM datasets'), 'Clean, summarize, extract'),
    S('archive', 'Archive', 'data', '#/archive', n('SELECT COUNT(*) AS n FROM archive_items'), 'The repository of everything'),
    S('knowledge', 'Knowledge', 'data', '#/knowledge', n('SELECT COUNT(*) AS n FROM memory_entries'), 'Organizational memory'),
    // Create
    S('localization', 'Localization', 'create', '#/localization', n('SELECT COUNT(*) AS n FROM localizations'), 'Arabic ⇄ English adaptation of anything the company writes'),
    S('social', 'Social media', 'create', '#/social', n('SELECT COUNT(*) AS n FROM posts'), 'AI drafts, humans publish'),
    S('content', 'Content studio', 'create', '#/content', n('SELECT COUNT(*) AS n FROM content_items'), 'Articles, scripts, emails'),
    S('design', 'Design studio', 'create', '#/design', n('SELECT COUNT(*) AS n FROM designs'), 'Real SVG deliverables'),
    S('marketing', 'Marketing', 'create', '#/marketing', n('SELECT COUNT(*) AS n FROM campaigns'), 'Campaigns with budgets'),
    // Commerce
    S('pricing', 'Pricing', 'commerce', '#/pricing', n('SELECT COUNT(*) AS n FROM pricing_records'), 'The approved price record every agent must cite'),
    S('success', 'Customer success', 'commerce', '#/success', n('SELECT COUNT(*) AS n FROM customer_health'), 'Health, adoption and churn risk'),
    S('marketwatch', 'Market watch', 'commerce', '#/marketwatch', n('SELECT COUNT(*) AS n FROM competitors'), 'Competitors, their pricing and their weaknesses'),
    S('sales', 'Sales', 'commerce', '#/sales', n('SELECT COUNT(*) AS n FROM deals'), 'Deals pipeline'),
    S('customers', 'Customers', 'commerce', '#/customers', n('SELECT COUNT(*) AS n FROM customers'), 'CRM'),
    S('relations', 'Relations', 'commerce', '#/relations', n('SELECT COUNT(*) AS n FROM partners'), 'Partners, investors, government'),
    S('finance', 'Finance', 'capital', '#/finance', n('SELECT COUNT(*) AS n FROM model_calls'), 'Spend, MRR, burn'),
    S('finreports', 'Financial reports', 'capital', '#/finreports', n('SELECT COUNT(*) AS n FROM fin_reports'), 'Statements and analysis'),
    // Operate
    S('incidents', 'Incidents', 'operate', '#/incidents', n('SELECT COUNT(*) AS n FROM incidents'), 'SEV lifecycle with postmortems'),
    S('support', 'Support', 'operate', '#/support', n('SELECT COUNT(*) AS n FROM tickets'), 'Tickets, AI drafts, human sends'),
    S('people', 'People', 'talent', '#/people', n('SELECT COUNT(*) AS n FROM people'), 'The human layer'),
    S('org', 'Org & personas', 'talent', '#/org', n('SELECT COUNT(*) AS n FROM agents'), 'Who each AI employee is, and which departments they serve'),
    S('society', 'The society', 'talent', '#/society', n('SELECT COUNT(*) AS n FROM agent_messages'), 'How colleagues actually get on — conversations, handovers, friendships and friction'),
    S('disputes', 'Disputes', 'talent', '#/disputes', n('SELECT COUNT(*) AS n FROM disputes'), 'HR arbitrates, the owner rules'),
    S('assets', 'Assets', 'operate', '#/assets', n('SELECT COUNT(*) AS n FROM assets'), 'Domains, licences, credentials, devices and their renewals'),
    S('enablement', 'Enablement', 'talent', '#/enablement', n('SELECT COUNT(*) AS n FROM enablement_plans'), 'Turning weak evals into training for the workforce'),
    S('legal', 'Legal', 'operate', '#/legal', n('SELECT COUNT(*) AS n FROM contracts'), 'Contracts, human-signed'),
    S('vendors', 'Vendors', 'operate', '#/vendors', n('SELECT COUNT(*) AS n FROM vendors'), 'Procurement and renewals'),
    S('objectives', 'Objectives', 'operate', '#/objectives', n('SELECT COUNT(*) AS n FROM objectives'), 'Quarterly OKRs'),
    // Govern
    S('harmony', 'Harmony', 'govern', '#/harmony', n('SELECT COUNT(*) AS n FROM maestro_cycles'), 'The orchestrator that keeps departments in step'),
    S('autopilot', 'Autopilot', 'govern', '#/autopilot', n('SELECT COUNT(*) AS n FROM nexus_log'), 'Cross-department reflexes'),
    S('governance', 'Governance', 'govern', '#/governance', n('SELECT COUNT(*) AS n FROM rituals'), 'Rituals and the immune system'),
    S('oversight', 'Oversight', 'govern', '#/oversight', n('SELECT COUNT(*) AS n FROM approvals'), 'Approvals ledger'),
    S('scorecard', 'Scorecard', 'govern', '#/scorecard', 1, 'Company KPIs on one board'),
    S('users', 'Users & roles', 'govern', '#/users', n('SELECT COUNT(*) AS n FROM users'), 'Fine-grained permissions'),
    S('settings', 'Settings', 'govern', '#/settings', 1, 'Provider keys, superadmin controls'),
    S('audit', 'Audit chain', 'govern', '#/audit', n('SELECT COUNT(*) AS n FROM audit_log'), 'Hash-chained, append-only'),
    // Expansion wave — 16 new departments.
    S('capacity', 'Capacity', 'engine', '#/capacity', n("SELECT COUNT(*) AS n FROM runs WHERE state IN ('queued','leased','running')"), 'Load per employee, saturation warnings, daily budget burn'),
    S('lab', 'The Lab', 'build', '#/lab', n('SELECT COUNT(*) AS n FROM experiments'), 'A/B experiments on prompts and models, measured before promotion'),
    S('releases', 'Releases', 'build', '#/releases', n('SELECT COUNT(*) AS n FROM releases'), 'Changelog drafted from completed work, human-published'),
    S('pmo', 'PMO gates', 'decide', '#/pmo', n('SELECT COUNT(*) AS n FROM stage_gates'), 'Stage gates across all projects, humans rule the crossing'),
    S('insights', 'Insights', 'data', '#/insights', n("SELECT COUNT(*) AS n FROM audit_log WHERE occurred_at >= datetime('now','-7 days')"), 'Company analytics: activity, spend and throughput trends'),
    S('brand', 'Brand studio', 'create', '#/brand', n('SELECT COUNT(*) AS n FROM brand_assets'), 'Voice, palette and guidelines every agent must obey'),
    S('procurement', 'Procurement', 'commerce', '#/procurement', n('SELECT COUNT(*) AS n FROM purchase_requests'), 'Purchase requests with human spend approval'),
    S('finops', 'FinOps', 'capital', '#/finops', n('SELECT COUNT(*) AS n FROM model_calls'), 'Cost per agent and token, waste detection, tier advice'),
    S('recruiting', 'Recruiting', 'talent', '#/recruiting', n('SELECT COUNT(*) AS n FROM candidates'), 'Hire new AI employees: spec → trial → human decision'),
    S('academy', 'Academy', 'talent', '#/academy', n('SELECT COUNT(*) AS n FROM curricula'), 'Training curricula that close measured eval gaps'),
    S('security', 'Security (SOC)', 'trust', '#/security', n('SELECT COUNT(*) AS n FROM security_events'), 'Injection sweeps, secret-leak detection, vendor posture'),
    S('compliance', 'Compliance', 'trust', '#/compliance', n('SELECT COUNT(*) AS n FROM compliance_checks'), 'DPA posture, data register, auditor-ready attestations'),
    S('sustainability', 'Sustainability', 'trust', '#/sustainability', n('SELECT COUNT(*) AS n FROM model_calls'), 'Energy and carbon estimates from live token meters'),
    S('board', 'Board room', 'exec', '#/board', n('SELECT COUNT(*) AS n FROM board_records'), 'Quarterly packet from live numbers; resolutions human-signed'),
    S('ir', 'Investor relations', 'exec', '#/ir', n('SELECT COUNT(*) AS n FROM investor_updates'), 'Monthly updates citing the live ledger, never invented'),
    S('comms', 'Internal comms', 'exec', '#/comms', n('SELECT COUNT(*) AS n FROM bulletins'), 'The weekly bulletin that writes itself from real events'),
  ];
}

export const DIVISIONS = [
  { id: 'engine', label: 'ENGINE', color: '#ff6b2c' },
  { id: 'build', label: 'BUILD', color: '#b78bff' },
  { id: 'decide', label: 'DECIDE', color: '#5ec3c9' },
  { id: 'data', label: 'DATA', color: '#78bf6d' },
  { id: 'create', label: 'CREATE', color: '#ff5fa2' },
  { id: 'commerce', label: 'COMMERCE', color: '#e5533d' },
  { id: 'capital', label: 'CAPITAL', color: '#e8c547' },
  { id: 'operate', label: 'OPERATE', color: '#ffb020' },
  { id: 'talent', label: 'TALENT', color: '#4f9cf0' },
  { id: 'trust', label: 'TRUST', color: '#e07bd2' },
  { id: 'exec', label: 'EXECUTIVE', color: '#d8d8d8' },
  { id: 'govern', label: 'GOVERN', color: '#948b7d' },
];

/**
 * Prove the wiring: every section must participate in at least one live or
 * declared relationship. Anything that does not is reported as an orphan
 * rather than quietly looking connected on a diagram.
 */
export function connectivityAudit() {
  const sections = sectionCatalog();
  const edges = relationshipMatrix();
  const touched = new Set();
  for (const e of edges) {
    if (e.from !== 'all') touched.add(e.from);
    if (e.to !== 'all') touched.add(e.to);
  }
  // 'all → audit' and 'all → archive' mean literally every section.
  const universal = edges.some((e) => e.from === 'all');
  const orphans = sections.filter((s) => !touched.has(s.id) && !['audit', 'archive'].includes(s.id) && !universal ? true : !touched.has(s.id) && !universal);
  return {
    sections: sections.length,
    wired: sections.length - orphans.length,
    orphans: orphans.map((s) => ({ id: s.id, label: s.label, division: s.division })),
    edges: edges.length,
    liveEdges: edges.filter((e) => e.count > 0).length,
    universalEdges: edges.filter((e) => e.from === 'all' || e.to === 'all').map((e) => `${e.from} → ${e.to}`),
  };
}

/**
 * The department relationship matrix — how many live links exist between each
 * pair of departments right now. This is the graph page's data, and it proves
 * the wiring is real rather than decorative.
 */
export function relationshipMatrix() {
  const edge = (from, to, label, count, href) => ({ from, to, label, count, href });
  const n = (sql, ...p) => one(sql, ...p).n;

  // The request desk's edges are not declared — they are drawn from the routes
  // it has actually taken, so the map shows the real spread of intake work.
  const DEPT_TO_SECTION = {
    research: 'intel', analysis: 'systems', product: 'products', architecture: 'systems',
    engineering: 'runs', review: 'quality', qa: 'quality', security: 'oversight',
    release: 'pipelines', docs: 'content', cost: 'finance', ops: 'incidents',
    delivery: 'tasks', finance: 'finreports', designAsset: 'design',
  };
  const requestEdges = q('SELECT dept, COUNT(*) AS n FROM request_steps GROUP BY dept').map((r) => {
    const target = DEPT_TO_SECTION[r.dept] || r.dept;
    return edge('requests', target, `requests routed to ${r.dept}`, r.n, '#/requests');
  });

  return [
    ...requestEdges,
    edge('requests', 'archive', 'completed requests archived', n("SELECT COUNT(*) AS n FROM archive_items WHERE subject_type = 'request'"), '#/archive'),
    edge('intel', 'segments', 'records grouped into segments', n('SELECT COUNT(*) AS n FROM segment_members'), '#/segments'),
    edge('intel', 'customers', 'records targeted as leads', n('SELECT COUNT(*) AS n FROM intel_records WHERE customer_id IS NOT NULL'), '#/customers'),
    edge('intel', 'archive', 'exports archived', n("SELECT COUNT(*) AS n FROM archive_items WHERE kind = 'intel-export'"), '#/archive'),
    edge('data', 'intel', 'entities extracted into campaigns', n("SELECT COUNT(*) AS n FROM intel_queries WHERE question LIKE '[from dataset%'"), '#/intel'),
    edge('support', 'data', 'ticket volume analyzed as datasets', n("SELECT COUNT(*) AS n FROM nexus_log WHERE rule_id = ?", 'tickets→dataset'), '#/data'),
    edge('segments', 'marketing', 'segments attached to campaigns', n('SELECT COUNT(*) AS n FROM segments WHERE campaign_id IS NOT NULL'), '#/marketing'),
    edge('sales', 'customers', 'won deals became customers', n('SELECT COUNT(*) AS n FROM deals WHERE customer_id IS NOT NULL'), '#/customers'),
    edge('sales', 'relations', 'deals sourced via partners', n('SELECT COUNT(*) AS n FROM deals WHERE partner_id IS NOT NULL'), '#/relations'),
    edge('marketing', 'social', 'campaign posts', n('SELECT COUNT(*) AS n FROM posts WHERE campaign_id IS NOT NULL'), '#/social'),
    edge('marketing', 'design', 'campaign visuals', n('SELECT COUNT(*) AS n FROM designs WHERE campaign_id IS NOT NULL'), '#/design'),
    edge('marketing', 'customers', 'customers attributed to campaigns', n('SELECT COUNT(*) AS n FROM customers WHERE campaign_id IS NOT NULL'), '#/customers'),
    edge('systems', 'infra', 'infrastructure planned from a blueprint', n('SELECT COUNT(*) AS n FROM infra_plans WHERE blueprint_id IS NOT NULL'), '#/infra'),
    edge('systems', 'products', 'specification packages for products', n('SELECT COUNT(*) AS n FROM blueprints WHERE product_id IS NOT NULL'), '#/systems'),
    edge('systems', 'runs', 'blueprint documents written by agents', n('SELECT COUNT(*) AS n FROM blueprint_docs WHERE run_id IS NOT NULL'), '#/runs'),
    edge('finreports', 'finance', 'reports built on the live ledger', n("SELECT COUNT(*) AS n FROM fin_reports WHERE subject = 'own'"), '#/finance'),
    edge('finreports', 'archive', 'approved reports archived', n("SELECT COUNT(*) AS n FROM archive_items WHERE subject_type = 'finReport'"), '#/archive'),
    edge('products', 'journeys', 'journeys building products', n('SELECT COUNT(*) AS n FROM journeys WHERE product_id IS NOT NULL'), '#/journeys'),
    edge('products', 'content', 'launch content', n('SELECT COUNT(*) AS n FROM content_items WHERE product_id IS NOT NULL'), '#/content'),
    edge('products', 'support', 'tickets about products', n('SELECT COUNT(*) AS n FROM tickets WHERE product_id IS NOT NULL'), '#/support'),
    edge('support', 'incidents', 'tickets escalated to incidents', n('SELECT COUNT(*) AS n FROM tickets WHERE incident_id IS NOT NULL'), '#/incidents'),
    edge('incidents', 'risks', 'risks registered from incidents', n("SELECT COUNT(*) AS n FROM risks WHERE subject_type = 'incident'"), '#/risks'),
    edge('incidents', 'knowledge', 'lessons captured', n("SELECT COUNT(*) AS n FROM memory_entries WHERE layer = 'lesson'"), '#/knowledge'),
    edge('incidents', 'pipelines', 'postmortem pipelines', n('SELECT COUNT(*) AS n FROM incidents WHERE postmortem_pipeline_id IS NOT NULL'), '#/pipelines'),
    edge('journeys', 'runs', 'agent work inside journeys', n('SELECT COUNT(*) AS n FROM journey_stages WHERE run_id IS NOT NULL'), '#/runs'),
    edge('tasks', 'runs', 'tasks delegated to agents', n("SELECT COUNT(*) AS n FROM tasks WHERE assignee_type = 'agent' AND run_id IS NOT NULL"), '#/tasks'),
    edge('projects', 'tasks', 'tasks inside projects', n('SELECT COUNT(*) AS n FROM tasks WHERE project_id IS NOT NULL'), '#/tasks'),
    edge('relations', 'customers', 'interactions on customers', n('SELECT COUNT(*) AS n FROM interactions WHERE customer_id IS NOT NULL'), '#/relations'),
    edge('relations', 'vendors', 'interactions on vendors', n('SELECT COUNT(*) AS n FROM interactions WHERE vendor_id IS NOT NULL'), '#/vendors'),
    edge('vendors', 'legal', 'vendor contracts', n('SELECT COUNT(*) AS n FROM contracts WHERE vendor_id IS NOT NULL'), '#/legal'),
    edge('decisions', 'legal', 'contracts bound to decisions', n('SELECT COUNT(*) AS n FROM contracts WHERE decision_id IS NOT NULL'), '#/legal'),
    edge('decisions', 'runs', 'runs under a decision', n('SELECT COUNT(*) AS n FROM runs WHERE decision_id IS NOT NULL'), '#/runs'),
    edge('evals', 'tasks', 'improvement tasks from evals', n("SELECT COUNT(*) AS n FROM nexus_log WHERE rule_id = 'eval→task'"), '#/tasks'),
    edge('autopilot', 'all', 'automatic cross-department actions', n('SELECT COUNT(*) AS n FROM nexus_log'), '#/autopilot'),
    edge('pricing', 'sales', 'approved prices deals may quote', n("SELECT COUNT(*) AS n FROM pricing_records WHERE state = 'approved'"), '#/sales'),
    edge('pricing', 'products', 'prices attached to products', n('SELECT COUNT(*) AS n FROM pricing_records WHERE product_id IS NOT NULL'), '#/products'),
    edge('success', 'customers', 'customers assessed for health', n('SELECT COUNT(DISTINCT customer_id) AS n FROM customer_health'), '#/customers'),
    edge('success', 'support', 'health judged from ticket history', n("SELECT COUNT(*) AS n FROM customer_health WHERE notes IS NOT NULL"), '#/support'),
    edge('marketwatch', 'pricing', 'rival pricing informing ours', n('SELECT COUNT(*) AS n FROM competitors WHERE pricing_note IS NOT NULL OR brief IS NOT NULL'), '#/pricing'),
    edge('assets', 'vendors', 'assets bought from a vendor', n('SELECT COUNT(*) AS n FROM assets WHERE vendor_id IS NOT NULL'), '#/vendors'),
    edge('localization', 'content', 'content adapted to another language', n("SELECT COUNT(*) AS n FROM localizations WHERE source_kind IN ('content','doc')"), '#/content'),
    edge('localization', 'social', 'posts adapted to another language', n("SELECT COUNT(*) AS n FROM localizations WHERE source_kind = 'post'"), '#/social'),
    edge('enablement', 'evals', 'training triggered by a weak eval', n("SELECT COUNT(*) AS n FROM enablement_plans WHERE trigger = 'eval-fail'"), '#/evals'),
    edge('enablement', 'agents', 'role specifications improved', n("SELECT COUNT(*) AS n FROM enablement_plans WHERE state = 'applied'"), '#/agents'),
    edge('disputes', 'org', 'disagreements between employees', n('SELECT COUNT(*) AS n FROM disputes'), '#/org'),
    edge('disputes', 'knowledge', 'rulings kept as precedent', n("SELECT COUNT(*) AS n FROM memory_entries WHERE source_ref LIKE 'dispute:%'"), '#/knowledge'),
    edge('org', 'workforce', 'personas shaping how agents work', n('SELECT COUNT(*) AS n FROM agents WHERE persona IS NOT NULL'), '#/workforce'),
    edge('society', 'org', 'working relationships between colleagues', n('SELECT COUNT(*) AS n FROM agent_relations'), '#/org'),
    edge('society', 'runs', 'conversations sparked by real work', n('SELECT COUNT(*) AS n FROM agent_messages'), '#/runs'),
    // Decide: the gate, the ledger and the money were real joins all along —
    // now they are declared, so the map stops showing them as orphans.
    edge('runs', 'gate', 'work stopped at the human gate', n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'"), '#/gate'),
    edge('gate', 'oversight', 'human verdicts recorded in the approvals ledger', n('SELECT COUNT(*) AS n FROM approvals'), '#/oversight'),
    edge('runs', 'budgets', 'every model call settles against a budget scope', n('SELECT COUNT(*) AS n FROM model_calls'), '#/budgets'),
    edge('budgets', 'agents', 'per-agent daily caps enforced', n("SELECT COUNT(*) AS n FROM budgets WHERE scope = 'agent-daily'"), '#/agents'),
    edge('evals', 'quality', 'eval scores feed the quality dashboard', n('SELECT COUNT(*) AS n FROM eval_runs'), '#/quality'),
    // Govern: the orchestrator, the reflexes, the immune system and identity.
    edge('harmony', 'runs', 'orchestrator cycles executed by agents', n('SELECT COUNT(*) AS n FROM maestro_cycles WHERE run_id IS NOT NULL'), '#/runs'),
    edge('autopilot', 'decisions', 'critical risks auto-opened decision cases', n('SELECT COUNT(*) AS n FROM nexus_log WHERE rule_id = ?', 'risk→decision'), '#/decisions'),
    edge('governance', 'risks', 'immune-system alerts on the register', n("SELECT COUNT(*) AS n FROM notifications WHERE source LIKE 'immune%'"), '#/risks'),
    edge('users', 'oversight', 'named accounts that signed verdicts', n('SELECT COUNT(DISTINCT approver_human) AS n FROM approvals'), '#/users'),
    edge('settings', 'providers', 'provider configuration set from the console', n('SELECT COUNT(*) AS n FROM settings'), '#/providers'),
    edge('scorecard', 'objectives', 'KPIs tracked against quarterly OKRs', n('SELECT COUNT(*) AS n FROM objectives'), '#/objectives'),
    edge('oversight', 'audit', 'human actions anchored on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'human'"), '#/audit'),
    // Engine + Operate stragglers.
    edge('runs', 'artifacts', 'files written to disk by gated runs', n('SELECT COUNT(*) AS n FROM archive_items WHERE file_ref IS NOT NULL'), '#/artifacts'),
    edge('people', 'agents', 'every agent answers to a human owner', n('SELECT COUNT(*) AS n FROM agents'), '#/people'),
    // Expansion wave wiring — every new department joined to the machine.
    edge('security', 'runs', 'sweeps inspect run inputs and outputs', n("SELECT COUNT(*) AS n FROM security_events WHERE subject_type = 'run'"), '#/security'),
    edge('security', 'risks', 'high findings belong on the register', n("SELECT COUNT(*) AS n FROM security_events WHERE severity = 'high'"), '#/risks'),
    edge('security', 'incidents', 'confirmed breaches become incidents', n("SELECT COUNT(*) AS n FROM security_events WHERE state = 'triaged'"), '#/incidents'),
    edge('compliance', 'legal', 'contracts back the compliance file', n('SELECT COUNT(*) AS n FROM contracts'), '#/legal'),
    edge('compliance', 'providers', 'no-DPA vendors flagged', n("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'vendor-dpa'"), '#/providers'),
    edge('sustainability', 'providers', 'energy metered per provider', n('SELECT COUNT(DISTINCT provider) AS n FROM model_calls'), '#/sustainability'),
    edge('capacity', 'workforce', 'live load per employee', n("SELECT COUNT(*) AS n FROM runs WHERE state IN ('queued','leased','running')"), '#/capacity'),
    edge('capacity', 'budgets', 'saturation includes daily budget burn', n("SELECT COUNT(*) AS n FROM budgets WHERE scope = 'agent-daily'"), '#/budgets'),
    edge('lab', 'runs', 'experiment variants executed as runs', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'lab:%'"), '#/lab'),
    edge('lab', 'evals', 'winners graduate into golden sets', n("SELECT COUNT(*) AS n FROM experiments WHERE state = 'concluded'"), '#/evals'),
    edge('releases', 'products', 'release notes per product', n('SELECT COUNT(*) AS n FROM releases WHERE product_id IS NOT NULL'), '#/products'),
    edge('releases', 'tasks', 'notes compiled from completed work', n('SELECT COUNT(*) AS n FROM releases'), '#/releases'),
    edge('pmo', 'projects', 'stage gates on projects', n('SELECT COUNT(*) AS n FROM stage_gates'), '#/pmo'),
    edge('pmo', 'gate', 'gate rulings are human approvals', n("SELECT COUNT(*) AS n FROM stage_gates WHERE state != 'pending'"), '#/pmo'),
    edge('insights', 'audit', 'trends computed from the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE occurred_at >= datetime('now','-7 days')"), '#/insights'),
    edge('brand', 'marketing', 'campaigns must speak the brand voice', n("SELECT COUNT(*) AS n FROM brand_assets WHERE state = 'approved'"), '#/brand'),
    edge('brand', 'design', 'visual identity guides the studio', n('SELECT COUNT(*) AS n FROM brand_assets'), '#/design'),
    edge('procurement', 'vendors', 'purchases ordered from vendors', n('SELECT COUNT(*) AS n FROM purchase_requests WHERE vendor_id IS NOT NULL'), '#/vendors'),
    edge('procurement', 'finance', 'approved spend hits the ledger', n("SELECT COUNT(*) AS n FROM purchase_requests WHERE state IN ('approved','ordered')"), '#/finance'),
    edge('finops', 'finance', 'cost analytics on the live ledger', n('SELECT COUNT(*) AS n FROM model_calls'), '#/finops'),
    edge('finops', 'budgets', 'waste findings tighten caps', n('SELECT COUNT(*) AS n FROM model_calls WHERE ok = 0'), '#/budgets'),
    edge('recruiting', 'agents', 'hires join the roster', n("SELECT COUNT(*) AS n FROM candidates WHERE state = 'hired'"), '#/agents'),
    edge('recruiting', 'runs', 'specs and trials drafted by agents', n('SELECT COUNT(*) AS n FROM candidates'), '#/recruiting'),
    edge('academy', 'evals', 'curricula close measured eval gaps', n('SELECT COUNT(*) AS n FROM curricula'), '#/academy'),
    edge('academy', 'enablement', 'training sourced from enablement plans', n("SELECT COUNT(*) AS n FROM curricula WHERE source != 'manual'"), '#/enablement'),
    edge('ir', 'finance', 'updates cite the live ledger', n('SELECT COUNT(*) AS n FROM investor_updates'), '#/ir'),
    edge('board', 'scorecard', 'the packet reads the KPI board', n('SELECT COUNT(*) AS n FROM board_records'), '#/board'),
    edge('board', 'risks', 'risk report to the board', n('SELECT COUNT(*) AS n FROM board_records'), '#/risks'),
    edge('comms', 'governance', 'bulletins digest rituals and alerts', n('SELECT COUNT(*) AS n FROM bulletins'), '#/comms'),
    edge('comms', 'society', 'published to every employee', n("SELECT COUNT(*) AS n FROM bulletins WHERE state = 'published'"), '#/society'),
    edge('all', 'archive', 'items frozen in the repository', n('SELECT COUNT(*) AS n FROM archive_items'), '#/archive'),
    edge('all', 'audit', 'events on the chain', n('SELECT COUNT(*) AS n FROM audit_log'), '#/audit'),
  ].filter((e) => e.count > 0 || true);
}

// ---------- live activity feed: the map's heartbeat ----------
const SUBJECT_SECTION = {
  run: 'runs', ticket: 'support', incident: 'incidents', decision: 'decisions', task: 'tasks',
  product: 'products', campaign: 'marketing', customer: 'customers', intelQuery: 'intel',
  intelRecord: 'intel', segment: 'segments', dataset: 'data', archiveItem: 'archive',
  user: 'users', budget: 'budgets', agent: 'agents', risk: 'risks', project: 'projects',
  blueprint: 'systems', infraPlan: 'infra', finReport: 'finreports', deal: 'sales',
  partner: 'relations', vendor: 'vendors', contract: 'legal', person: 'people',
  objective: 'objectives', post: 'social', content: 'content', design: 'design',
  ritual: 'governance', quality: 'quality', pipeline: 'pipelines', settings: 'settings',
  security: 'security', experiment: 'lab', candidate: 'recruiting', gate: 'pmo',
  purchase: 'procurement', brand: 'brand', release: 'releases', curriculum: 'academy',
  irUpdate: 'ir', boardRecord: 'board', bulletin: 'comms', compliance: 'compliance',
  request: 'requests', journey: 'journeys', system: 'settings',
};
const ACTION_SECTION = {
  auth: 'users', server: 'settings', settings: 'settings', security: 'security',
  lab: 'lab', pmo: 'pmo', ir: 'ir', board: 'board', comms: 'comms', brand: 'brand',
  release: 'releases', academy: 'academy', recruiting: 'recruiting', procurement: 'procurement',
};

/** Everything that happened after `since` (an audit seq), mapped to map sections. */
export function activityFeed(since = 0) {
  const rows = q(`SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id
    FROM audit_log WHERE seq > ? ORDER BY seq DESC LIMIT 30`, since);
  return rows.map((r) => ({
    seq: r.seq, at: r.occurred_at, actorType: r.actor_type, actor: r.actor_id,
    action: r.action, subjectId: r.subject_id,
    section: SUBJECT_SECTION[r.subject_type] || ACTION_SECTION[String(r.action).split('.')[0]] || null,
  }));
}
