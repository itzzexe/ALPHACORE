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
    S('localization', 'Localization', 'marketing', '#/localization', n('SELECT COUNT(*) AS n FROM localizations'), 'Arabic ⇄ English adaptation of anything the company writes'),
    S('social', 'Social media', 'marketing', '#/social', n('SELECT COUNT(*) AS n FROM posts'), 'AI drafts, humans publish'),
    S('content', 'Content studio', 'marketing', '#/content', n('SELECT COUNT(*) AS n FROM content_items'), 'Articles, scripts, emails'),
    S('design', 'Design studio', 'marketing', '#/design', n('SELECT COUNT(*) AS n FROM designs'), 'Real SVG deliverables'),
    S('marketing', 'Marketing', 'marketing', '#/marketing', n('SELECT COUNT(*) AS n FROM campaigns'), 'Campaigns with budgets'),
    // Commerce
    S('pricing', 'Pricing', 'commerce', '#/pricing', n('SELECT COUNT(*) AS n FROM pricing_records'), 'The approved price record every agent must cite'),
    S('success', 'Customer success', 'commerce', '#/success', n('SELECT COUNT(*) AS n FROM customer_health'), 'Health, adoption and churn risk'),
    S('marketwatch', 'Market watch', 'marketing', '#/marketwatch', n('SELECT COUNT(*) AS n FROM competitors'), 'Competitors, their pricing and their weaknesses'),
    S('sales', 'Sales', 'commerce', '#/sales', n('SELECT COUNT(*) AS n FROM deals'), 'Deals pipeline'),
    S('customers', 'Customers', 'commerce', '#/customers', n('SELECT COUNT(*) AS n FROM customers'), 'CRM'),
    S('relations', 'Relations', 'commerce', '#/relations', n('SELECT COUNT(*) AS n FROM partners'), 'Partners, investors, government'),
    S('finance', 'Finance', 'capital', '#/finance', n('SELECT COUNT(*) AS n FROM model_calls'), 'Spend, MRR, burn'),
    S('finreports', 'Financial reports', 'capital', '#/finreports', n('SELECT COUNT(*) AS n FROM fin_reports'), 'Statements and analysis'),
    S('ledger', 'Ledger', 'capital', '#/ledger', n("SELECT COUNT(*) AS n FROM journal WHERE state = 'posted'"), 'Double-entry books: journal, trial balance, and the entry behind every number'),
    S('bookkeeper', 'Bookkeeping', 'capital', '#/bookkeeper', n('SELECT COUNT(*) AS n FROM ledger_marks'), 'The AI employees who write the entries, and the limit above which they stop'),
    S('hunt', 'Deep search', 'data', '#/hunt', n('SELECT COUNT(*) AS n FROM hunts'), 'Asks every source, follows what it learns, and keeps going until it finds it or says it did not'),
    S('browser', 'The browser', 'world', '#/browser', n('SELECT COUNT(*) AS n FROM browser_sessions'), 'A real browser the employees drive: look, decide, act — with every step and its screenshot kept'),
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
    S('mkt', 'Marketing department', 'marketing', '#/mkt', n('SELECT COUNT(*) AS n FROM content_calendar') + n('SELECT COUNT(*) AS n FROM personas'), 'Personas, positioning, channel spend, editorial calendar, search and lifecycle — with its own eight specialists'),
    S('brand', 'Brand studio', 'marketing', '#/brand', n('SELECT COUNT(*) AS n FROM brand_assets'), 'Voice, palette and guidelines every agent must obey'),
    // The department, in full. Six of these were tables buried inside the
    // marketing desk with no page of their own, and six are functions a real
    // marketing department has that this company simply did not.
    S('personas', 'Personas', 'marketing', '#/personas', n('SELECT COUNT(*) AS n FROM personas'), 'Who we are actually talking to — grounded in real customers and real intel, not invented'),
    S('positioning', 'Positioning', 'marketing', '#/positioning', n('SELECT COUNT(*) AS n FROM positioning'), 'The promise, the category and the proof, sharpened until a stranger gets it in one line'),
    S('seo', 'Search', 'marketing', '#/seo', n('SELECT COUNT(*) AS n FROM seo_keywords'), 'The searches worth winning, and which of them nobody has written for yet'),
    S('paidmedia', 'Paid media', 'marketing', '#/paidmedia', n('SELECT COUNT(*) AS n FROM campaign_channels'), 'Attention bought on measurable terms, with the cost per lead beside every channel'),
    S('lifecycle', 'Lifecycle email', 'marketing', '#/lifecycle', n('SELECT COUNT(*) AS n FROM email_sequences'), 'The sequences that move a lead from curious to paying — and every send passes the gate'),
    S('calendar', 'Editorial calendar', 'marketing', '#/calendar', n('SELECT COUNT(*) AS n FROM content_calendar'), 'What gets published when, for whom, at which stage of the funnel'),
    S('events', 'Events', 'marketing', '#/events', n('SELECT COUNT(*) AS n FROM mkt_events'), 'Webinars and rooms, judged on cost per lead and on whether anybody followed up'),
    S('press', 'Press & media', 'marketing', '#/press', n('SELECT COUNT(*) AS n FROM mkt_press'), 'What a journalist would actually print — and no claim the ledger cannot support'),
    S('community', 'Community', 'marketing', '#/community', n('SELECT COUNT(*) AS n FROM mkt_community'), 'Who advocates for us unpaid, who is unhappy, and what either is saying today'),
    S('attribution', 'Attribution', 'marketing', '#/attribution', n('SELECT COUNT(*) AS n FROM mkt_touchpoints'), 'Where customers actually came from, as a chain of touches rather than one field somebody typed'),
    S('pages', 'Landing pages', 'marketing', '#/pages', n('SELECT COUNT(*) AS n FROM mkt_pages'), 'The page the campaign points at, written for one person and measured on one action'),
    S('mktops', 'Marketing operations', 'marketing', '#/mktops', n('SELECT COUNT(*) AS n FROM mkt_ops'), 'The plumbing: tracking, lead scoring, naming conventions, and whether the numbers can be trusted'),
    S('procurement', 'Procurement', 'commerce', '#/procurement', n('SELECT COUNT(*) AS n FROM purchase_requests'), 'Purchase requests with human spend approval'),
    S('finops', 'FinOps', 'capital', '#/finops', n('SELECT COUNT(*) AS n FROM model_calls'), 'Cost per agent and token, waste detection, tier advice'),
    S('treasury', 'Treasury (crypto)', 'capital', '#/treasury', n('SELECT COUNT(*) AS n FROM invoices'), 'Watch-only wallets, crypto invoices that settle themselves, and payouts a human must sign'),
    S('money', 'Money desk', 'capital', '#/money', n('SELECT COUNT(*) AS n FROM money_moves'), 'Cash position, runway, and the allocation policy the company holds itself to'),
    S('contact', 'Contact centre', 'operate', '#/contact', n('SELECT COUNT(*) AS n FROM calls') + n('SELECT COUNT(*) AS n FROM sms_messages'), 'Calls out and in, SMS and WhatsApp, seven voices in Arabic and English'),
    S('recruiting', 'Recruiting', 'talent', '#/recruiting', n('SELECT COUNT(*) AS n FROM candidates'), 'Hire new AI employees: spec → trial → human decision'),
    S('academy', 'Academy', 'talent', '#/academy', n('SELECT COUNT(*) AS n FROM curricula'), 'Training curricula that close measured eval gaps'),
    S('security', 'Security (SOC)', 'trust', '#/security', n('SELECT COUNT(*) AS n FROM security_events'), 'Injection sweeps, secret-leak detection, vendor posture'),
    S('compliance', 'Compliance', 'trust', '#/compliance', n('SELECT COUNT(*) AS n FROM compliance_checks'), 'DPA posture, data register, auditor-ready attestations'),
    S('sustainability', 'Sustainability', 'trust', '#/sustainability', n('SELECT COUNT(*) AS n FROM model_calls'), 'Energy and carbon estimates from live token meters'),
    S('board', 'Board room', 'exec', '#/board', n('SELECT COUNT(*) AS n FROM board_records'), 'Quarterly packet from live numbers; resolutions human-signed'),
    S('ir', 'Investor relations', 'exec', '#/ir', n('SELECT COUNT(*) AS n FROM investor_updates'), 'Monthly updates citing the live ledger, never invented'),
    S('comms', 'Internal comms', 'exec', '#/comms', n('SELECT COUNT(*) AS n FROM bulletins'), 'The weekly bulletin that writes itself from real events'),
    // The iteration engine — work that circles until it is genuinely good.
    S('workstreams', 'Workstreams', 'engine', '#/workstreams', n('SELECT COUNT(*) AS n FROM workstreams'), 'Produce → peer review → AI audit → revise, round after round, across departments'),
    S('auditor', 'AI Auditor', 'decide', '#/auditor', n('SELECT COUNT(*) AS n FROM audits'), 'One independent standard judging output from every department'),
    S('sprints', 'Sprints (Scrum)', 'build', '#/sprints', n('SELECT COUNT(*) AS n FROM sprints'), 'Iterations, story points, velocity and a mandatory retrospective'),
    S('memory', 'Agent memory', 'talent', '#/memory', n('SELECT COUNT(*) AS n FROM mem_docs'), 'Episodes, retrieval, Markdown playbooks and lessons the workforce actually learns'),
    S('chat', 'The floor (chat)', 'talent', '#/chat', n('SELECT COUNT(*) AS n FROM chat_messages'), 'Humans and AI employees in the same rooms — mention one by name and it answers, or starts the work'),
    // The outside world — everything that lets the company touch anything that
    // is not itself, and the machinery that keeps that honest.
    S('connectors', 'Integrations', 'world', '#/connectors', n('SELECT COUNT(*) AS n FROM connectors'), 'Every service the company can reach — Gmail, GitHub, Slack, Stripe or any API you describe'),
    S('egress', 'The gate', 'world', '#/egress', n('SELECT COUNT(*) AS n FROM egress_log'), 'Every attempt to affect anything outside this machine, allowed or refused, with the rule that decided'),
    S('vault', 'The vault', 'world', '#/vault', n('SELECT COUNT(*) AS n FROM vault_secrets'), 'Credentials encrypted at rest — the plaintext leaves only for the connector making the call'),
    S('web', 'The open web', 'world', '#/web', n('SELECT COUNT(*) AS n FROM web_fetches'), 'Fetch, search and a real browser — every page kept with its hash so a claim can be traced to a source'),
    S('mcp', 'MCP', 'world', '#/mcp', n('SELECT COUNT(*) AS n FROM mcp_servers'), 'Any MCP server becomes tools the workforce can use, and AlphaCore itself is one that others can drive'),
    S('jobs', 'The queue', 'world', '#/jobs', n('SELECT COUNT(*) AS n FROM jobs'), 'Durable work: attempts, backoff, idempotency and a shelf for whatever never succeeded'),
    S('revenue', 'Revenue loop', 'commerce', '#/revenue', n('SELECT COUNT(*) AS n FROM deals'), 'Name on a list to money in the account: source, approach, meeting, proposal, invoice, deliver'),
    S('constitution', 'The constitution', 'govern', '#/constitution', n("SELECT COUNT(*) AS n FROM constitution WHERE state = 'active'"), 'The rules the company must obey, written once and enforced by machine at the gate'),
    S('provenance', 'Provenance', 'trust', '#/provenance', n('SELECT COUNT(*) AS n FROM provenance'), 'A signed receipt for every artifact: who made it, with which model, reviewed by whom, at what cost'),
    S('redteam', 'Red team', 'trust', '#/redteam', n('SELECT COUNT(*) AS n FROM redteam_runs'), 'We attack ourselves on a timer — injection, exfiltration, tampering — and record what got through'),
    S('timemachine', 'Time machine', 'govern', '#/timemachine', n('SELECT COUNT(*) AS n FROM snapshots'), 'Stand at any hour of the company\'s life, replay what happened, reopen a decision with what is known now'),
    S('simulation', 'Shadow company', 'decide', '#/simulation', n('SELECT COUNT(*) AS n FROM simulations'), 'Fork reality, pull a lever, run it forward and compare — an answer instead of an opinion'),
    S('skills', 'Skill market', 'talent', '#/skills', n('SELECT COUNT(*) AS n FROM skills'), 'An employee writes down how it works, the method is scored against the incumbent, the winner is adopted'),
    S('kgraph', 'Knowledge graph', 'data', '#/kgraph', n('SELECT COUNT(*) AS n FROM graph_nodes'), 'Everything the company knows about one thing, in one hop — entities, edges and local embeddings'),
    // The platform: this installation running more than itself, and the rhythm
    // that keeps it running without anybody present.
    S('chief', 'Operating rhythm', 'exec', '#/chief', n('SELECT COUNT(*) AS n FROM periods'), 'The company deciding what to work on, reviewing what happened and correcting — day, week and quarter'),
    S('observe', 'Watchtower', 'govern', '#/observe', n('SELECT COUNT(*) AS n FROM slos'), 'What the company promised itself, whether it is keeping it, and the remedy it applies when it is not'),
    S('tenants', 'Companies', 'world', '#/tenants', n('SELECT COUNT(*) AS n FROM tenants'), 'More than one company on this installation — each with its own database file and its own process'),
    S('keys', 'API keys', 'world', '#/keys', n("SELECT COUNT(*) AS n FROM api_keys WHERE state = 'active'"), 'How other software talks to this company: scoped keys, rate limits and a call ledger'),
    S('webhooks', 'Webhooks', 'world', '#/webhooks', n("SELECT COUNT(*) AS n FROM webhooks WHERE state = 'active'"), 'The company telling other software what just happened, signed so the receiver can prove it came from here'),
    S('packages', 'Department packages', 'build', '#/packages', n('SELECT COUNT(*) AS n FROM packages'), 'A department as an installable manifest — tables, employees, permissions and a place on the map'),
    S('anchors', 'Anchors', 'govern', '#/anchors', n('SELECT COUNT(*) AS n FROM anchors WHERE ok = 1'), 'The chain answering to a witness outside this machine — the one check a rewritten history cannot pass'),
    S('erasure', 'Erasure', 'trust', '#/erasure', n('SELECT COUNT(*) AS n FROM pii_subjects WHERE erased_at IS NOT NULL'), 'Forgetting a person inside a record that cannot forget: the key is destroyed and every hash still verifies'),
    S('approvals', 'The desk', 'decide', '#/approvals', n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'"), 'Everything waiting on a person, ordered by what it blocks rather than by who asked'),
    S('roles', 'Roles', 'govern', '#/roles', n('SELECT COUNT(*) AS n FROM users'), 'Jobs instead of 204 checkboxes, with each irreversible power in exactly one of them'),
    S('tiers', 'Model chains', 'engine', '#/tiers', n('SELECT COUNT(*) AS n FROM tier_proposals'), 'Which model does the work, and the canary that has to pass before that changes'),
    S('embeddings', 'Recall', 'data', '#/embeddings', n('SELECT COUNT(*) AS n FROM graph_nodes'), 'Whether search understands a question phrased differently, or only matches its letters'),
    S('deliverability', 'Deliverability', 'operate', '#/deliverability', n("SELECT COUNT(*) AS n FROM settings WHERE k = 'DKIM_PUBLIC'"), 'Whether mail arrives or silently goes to spam, and whether a recording is lawful'),
    S('observability', 'Instruments', 'govern', '#/observability', n('SELECT COUNT(*) AS n FROM metrics'), 'Size, retention, and how late the event loop is — the number that explains "the server was down"'),
    S('backups', 'Backups', 'govern', '#/backups', n('SELECT COUNT(*) AS n FROM backups'), 'Copies taken from a checkpointed database, hashed, verified by opening them again'),
    ...packageSections(),
  ];
}

/**
 * Sections contributed by installed packages. They appear on the map and in the
 * navigation exactly like the built-in ones — that is what makes a package a
 * department rather than a plugin bolted to the side.
 */
function packageSections() {
  try {
    return q("SELECT manifest FROM packages WHERE state = 'installed'").map((r) => {
      const m = JSON.parse(r.manifest);
      let count = 0;
      try { count = one(`SELECT COUNT(*) AS n FROM ${m.tables?.[0]?.name}`).n; } catch { count = 0; }
      return {
        id: m.section.id, label: m.section.label, division: m.section.division,
        href: `#/pkg/${m.id}`, count,
        hint: m.section.hint || m.description || 'installed as a package',
      };
    });
  } catch { return []; }
}

export const DIVISIONS = [
  { id: 'engine', label: 'ENGINE', color: '#ff6b2c' },
  { id: 'build', label: 'BUILD', color: '#b78bff' },
  { id: 'decide', label: 'DECIDE', color: '#5ec3c9' },
  { id: 'data', label: 'DATA', color: '#78bf6d' },
  { id: 'marketing', label: 'MARKETING', color: '#ff5fa2' },
  { id: 'commerce', label: 'COMMERCE', color: '#e5533d' },
  { id: 'capital', label: 'CAPITAL', color: '#e8c547' },
  { id: 'operate', label: 'OPERATE', color: '#ffb020' },
  { id: 'talent', label: 'TALENT', color: '#4f9cf0' },
  { id: 'trust', label: 'TRUST', color: '#e07bd2' },
  { id: 'exec', label: 'EXECUTIVE', color: '#d8d8d8' },
  { id: 'govern', label: 'GOVERN', color: '#948b7d' },
  // Everything that reaches past the front door lives in its own district, so
  // you can see at a glance how much of the company can touch the world.
  { id: 'world', label: 'THE WORLD', color: '#2fd6a8' },
];

/**
 * Prove the wiring: every section must participate in at least one live or
 * declared relationship. Anything that does not is reported as an orphan
 * rather than quietly looking connected on a diagram.
 */
export function connectivityAudit() {
  const sections = sectionCatalog();
  const edges = relationshipMatrix();
  // Degree counts specific, declared relationships only. The universal rules
  // ("the auditor may audit anything") are true of every department and so say
  // nothing about any particular one.
  const degree = Object.fromEntries(sections.map((s) => [s.id, 0]));
  for (const e of edges) {
    if (e.from === 'all' || e.to === 'all') continue;
    if (degree[e.from] !== undefined) degree[e.from] += 1;
    if (degree[e.to] !== undefined) degree[e.to] += 1;
  }
  // This used to short-circuit on the existence of any `all` edge, which meant
  // that from the moment the auditor was wired to everything, the orphan check
  // returned an empty list without checking anything. A department with no
  // declared relationship is an orphan, whatever the universal rules say.
  const orphans = sections.filter((s) => degree[s.id] === 0)
    .map((s) => ({ id: s.id, label: s.label }));
  const weak = sections.filter((s) => degree[s.id] <= 1)
    .map((s) => ({ id: s.id, label: s.label, degree: degree[s.id] }));
  return {
    sections: sections.length,
    wired: sections.length - orphans.length,
    orphans: orphans.map((s) => ({ id: s.id, label: s.label, division: s.division })),
    edges: edges.length,
    liveEdges: edges.filter((e) => e.count > 0).length,
    weak,
    minDegree: Math.min(...Object.values(degree)),
    avgDegree: Number((Object.values(degree).reduce((a, b) => a + b, 0) / sections.length).toFixed(1)),
    universalEdges: edges.filter((e) => e.from === 'all' || e.to === 'all').map((e) => `${e.from} → ${e.to}`),
  };
}

/**
 * The department relationship matrix — how many live links exist between each
 * pair of departments right now. This is the graph page's data, and it proves
 * the wiring is real rather than decorative.
 */
export function relationshipMatrix() {
  // Every relationship also declares what KIND of movement it is. A hand-off
  // forward, a revision going back, an independent review, an audit verdict and
  // a governance record are five different things; drawing them identically was
  // hiding how the company actually operates.
  const edge = (from, to, label, count, href, kind = 'flow') => ({ from, to, label, count, href, kind });
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

  // Workstream routes are not declared either — they are read back from the
  // rounds that actually ran, so the map shows the paths the company took,
  // including the departments a piece of work was handed on to.
  const CYCLE_DEPT = {
    research: 'intel', product: 'products', analysis: 'insights', architecture: 'systems',
    engineering: 'runs', review: 'quality', qa: 'quality', security: 'security', docs: 'content',
    design: 'design', content: 'content', data: 'data', intel: 'intel', finance: 'finance',
    legal: 'legal', ops: 'incidents', support: 'support', localization: 'localization',
    sales: 'sales', marketing: 'marketing', infra: 'infra', pmo: 'pmo', ethics: 'auditor', hr: 'people',
  };
  const cycleEdges = q('SELECT dept, COUNT(*) AS n FROM cycles GROUP BY dept').map((r) =>
    edge('workstreams', CYCLE_DEPT[r.dept] || r.dept, `rounds produced by ${r.dept}`, r.n, '#/workstreams', 'flow'));
  // And every department the auditor has actually judged.
  const auditEdges = q("SELECT dept, COUNT(*) AS n FROM audits WHERE dept IS NOT NULL GROUP BY dept").map((r) =>
    edge('auditor', CYCLE_DEPT[r.dept] || r.dept, `audited ${r.dept} output`, r.n, '#/auditor', 'audit'));
  // Which employees the memory layer has actually fed.
  const memEdges = q('SELECT agent_id, COUNT(*) AS n FROM mem_usage WHERE agent_id IS NOT NULL GROUP BY agent_id LIMIT 1')
    .map((r) => edge('memory', 'agents', `memory recalled by ${r.agent_id} and peers`, r.n, '#/agents', 'memory'));

  // The orchestrator's reach. Its action catalogue names exactly which
  // department each move lands in, so Harmony's edges are the reach it is
  // actually allowed to have — declared where it may act, weighted by what it
  // has dispatched. Anything it cannot do has no line.
  const MAESTRO_REACH = {
    'task.delegate': ['tasks', 'delegates work to an AI employee'],
    'intel.campaign': ['intel', 'starts a collection campaign'],
    'segment.build': ['segments', 'groups contactable records'],
    'content.brief': ['content', 'commissions a draft'],
    'social.brief': ['social', 'commissions a post draft'],
    'design.brief': ['design', 'commissions a visual'],
    'relations.outreach': ['relations', 'drafts outreach to a quiet partner'],
    'sales.proposal': ['sales', 'drafts a stalled proposal'],
    'quality.eval': ['evals', 'runs the golden set on an unproven agent'],
    'finance.report': ['finreports', 'prepares a statement from the ledger'],
    'design.package': ['systems', 'starts a specification package'],
    'infra.plan': ['infra', 'plans infrastructure'],
    'journey.launch': ['journeys', 'launches a cross-department journey'],
    'human.flag': ['gate', 'raises what only a human may decide'],
  };
  const dispatched = Object.fromEntries(
    q('SELECT action, COUNT(*) AS n FROM maestro_actions WHERE ok = 1 GROUP BY action').map((r) => [r.action, r.n]),
  );
  const harmonyEdges = Object.entries(MAESTRO_REACH).map(([action, [target, label]]) =>
    edge('harmony', target, label, dispatched[action] || 0, '#/harmony',
      action === 'human.flag' ? 'gate' : 'flow'));
  // What it reads before it acts, and what constrains it.
  harmonyEdges.push(
    edge('harmony', 'runs', 'cycles executed by agents', n('SELECT COUNT(*) AS n FROM maestro_cycles WHERE run_id IS NOT NULL'), '#/runs'),
    edge('harmony', 'scorecard', 'reads the company state before planning', n('SELECT COUNT(*) AS n FROM maestro_cycles'), '#/scorecard', 'review'),
    edge('budgets', 'harmony', 'the governance pool caps what it may spend', n("SELECT COUNT(*) AS n FROM budgets WHERE scope = 'governance'"), '#/budgets', 'gate'),
    edge('harmony', 'audit', 'every dispatch lands on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'maestro.%'"), '#/audit', 'audit'),
    edge('harmony', 'autopilot', 'reflexes it does not need to plan', n('SELECT COUNT(*) AS n FROM nexus_log'), '#/autopilot'),
    edge('harmony', 'workstreams', 'iteration it can start and watch', n('SELECT COUNT(*) AS n FROM workstreams'), '#/workstreams'),
  );

  return [
    ...requestEdges, ...cycleEdges, ...auditEdges, ...memEdges, ...harmonyEdges,
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
    edge('bookkeeper', 'ledger', 'entries written by an AI employee', n("SELECT COUNT(*) AS n FROM journal WHERE created_by LIKE 'agent:%'"), '#/ledger'),
    edge('treasury', 'bookkeeper', 'invoices and payouts turned into entries', n("SELECT COUNT(*) AS n FROM ledger_marks WHERE source LIKE 'invoice%' OR source = 'payout'"), '#/bookkeeper'),
    edge('finance', 'bookkeeper', 'model spend accrued to the books', n("SELECT COUNT(*) AS n FROM ledger_marks WHERE source = 'model-spend'"), '#/bookkeeper'),
    edge('ledger', 'finreports', 'statements drawn from real entries', n("SELECT COUNT(*) AS n FROM journal WHERE state = 'posted'"), '#/finreports'),
    edge('ledger', 'audit', 'every posting on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'journal.%' OR action LIKE 'ledger.%'"), '#/audit'),
    edge('hunt', 'graph', 'the knowledge graph, asked every round', n('SELECT COUNT(*) AS n FROM hunt_rounds'), '#/graph'),
    edge('hunt', 'web', 'hunts that reached outside', n("SELECT COUNT(*) AS n FROM hunts WHERE max_usd > 0"), '#/web'),
    edge('hunt', 'memory', 'what the agents already knew', n('SELECT COUNT(*) AS n FROM hunts'), '#/memory'),
    edge('hunt', 'audit', 'every hunt recorded, found or not', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'hunt.finished'"), '#/audit'),
    edge('browser', 'web', 'pages the employees drove rather than read', n('SELECT COUNT(*) AS n FROM browser_steps'), '#/web'),
    edge('browser', 'approvals', 'steps stopped for a person to sign', n('SELECT COUNT(*) AS n FROM browser_steps WHERE gated = 1'), '#/approvals'),
    edge('browser', 'vault', 'credentials typed without passing through a model', n("SELECT COUNT(*) AS n FROM browser_steps WHERE action LIKE '%«%'"), '#/vault'),
    edge('browser', 'audit', 'every session and every signature on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'browser.%'"), '#/audit'),
    edge('hunt', 'browser', 'questions the open web could not answer by reading', n("SELECT COUNT(*) AS n FROM browser_sessions"), '#/browser'),
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
    // Govern: the reflexes, the immune system and identity. (Harmony's own
    // reach is derived from its action catalogue above.)
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
    // The iteration engine touches every department it routes through.
    edge('workstreams', 'runs', 'produce rounds executed by agents', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'cycle:%'"), '#/runs'),
    edge('workstreams', 'auditor', 'every round is scored by the auditor', n("SELECT COUNT(*) AS n FROM audits WHERE subject_type = 'cycle'"), '#/auditor', 'audit'),
    edge('workstreams', 'gate', 'rounds that stop for a human decision', n("SELECT COUNT(*) AS n FROM workstreams WHERE state = 'awaiting_human'"), '#/gate', 'gate'),
    edge('workstreams', 'quality', 'cycle scores feed the quality picture', n('SELECT COUNT(*) AS n FROM cycles WHERE audit_score IS NOT NULL'), '#/quality'),
    // The loop itself: revisions that went back and were produced again.
    edge('workstreams', 'workstreams', 'revision rounds — work sent back and improved', n('SELECT COUNT(*) AS n FROM cycles WHERE seq > 1'), '#/workstreams', 'loop'),
    edge('auditor', 'workstreams', 'findings returned for revision', n("SELECT COUNT(*) AS n FROM audits WHERE subject_type = 'cycle' AND verdict != 'pass'"), '#/workstreams', 'loop'),
    edge('agents', 'workstreams', 'independent peer reviewers on each round', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'cycle-review:%'"), '#/workstreams', 'review'),
    edge('auditor', 'all', 'any department can be audited to one standard', n('SELECT COUNT(*) AS n FROM audits'), '#/auditor', 'audit'),
    edge('auditor', 'oversight', 'audit verdicts recorded for humans', n("SELECT COUNT(*) AS n FROM audits WHERE state = 'done'"), '#/oversight', 'audit'),
    edge('auditor', 'problems', 'failed audits become problems to fix', n("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'fail'"), '#/governance', 'audit'),
    edge('gate', 'runs', 'rejected work goes back to the agent', n("SELECT COUNT(*) AS n FROM approvals WHERE verdict = 'rejected'"), '#/runs', 'loop'),
    // The contact centre reaches people, and what it hears comes back inside.
    edge('contact', 'customers', 'calls and messages to known customers', n('SELECT COUNT(*) AS n FROM calls WHERE customer_id IS NOT NULL'), '#/customers'),
    edge('contact', 'support', 'inbound contact that turns into a ticket', n("SELECT COUNT(*) AS n FROM sms_messages WHERE direction = 'in'"), '#/support'),
    edge('contact', 'runs', 'employees write every script and reply', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'call:%' OR task_type LIKE 'sms%'"), '#/runs'),

    // ---- the outside world -------------------------------------------------
    // Everything that leaves the machine converges on one door, so the gate has
    // more relationships than anything else on the map. That is the point: if a
    // line here disappears, something found another way out.
    edge('connectors', 'egress', 'every call passes the gate first', n('SELECT COUNT(*) AS n FROM egress_log'), '#/egress', 'gate'),
    edge('vault', 'connectors', 'credentials handed out only at the moment of a call', n('SELECT COUNT(*) AS n FROM vault_secrets WHERE connector IS NOT NULL'), '#/connectors'),
    edge('vault', 'providers', 'model keys live here too, not in a settings row', n("SELECT COUNT(*) AS n FROM vault_secrets WHERE name LIKE '%API_KEY'"), '#/providers'),
    edge('vault', 'security', 'a key nobody has touched in ninety days is a liability', n('SELECT COUNT(*) AS n FROM vault_secrets WHERE last_used IS NULL'), '#/security', 'audit'),
    edge('vault', 'provenance', 'the signing identity that makes a receipt verifiable', n("SELECT COUNT(*) AS n FROM vault_secrets WHERE name LIKE 'PROVENANCE%'"), '#/provenance'),
    edge('egress', 'constitution', 'the rules the gate cannot be talked out of', n('SELECT COUNT(*) AS n FROM constitution_hits'), '#/constitution', 'audit'),
    edge('egress', 'gate', 'irreversible actions stop for a person', n("SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'gated'"), '#/gate', 'gate'),
    edge('egress', 'audit', 'intent and result, both on the chain', n('SELECT COUNT(*) AS n FROM egress_log'), '#/audit', 'audit'),
    edge('egress', 'agents', 'each employee holds named scopes, never a wildcard', n('SELECT COUNT(*) AS n FROM agent_scopes'), '#/agents'),
    edge('jobs', 'connectors', 'outbound work retried with backoff, never repeated blindly', n("SELECT COUNT(*) AS n FROM jobs WHERE kind LIKE 'connector%'"), '#/connectors'),
    edge('jobs', 'oversight', 'work that died after every attempt', n("SELECT COUNT(*) AS n FROM jobs WHERE state = 'dead'"), '#/oversight'),
    edge('web', 'egress', 'reading the open web is an outbound act too', n('SELECT COUNT(*) AS n FROM web_fetches'), '#/egress', 'gate'),
    edge('web', 'intel', 'pages become evidence in the intelligence file', n('SELECT COUNT(*) AS n FROM web_fetches'), '#/intel'),
    edge('web', 'redteam', 'a hostile page is an attack, and is filed as one', n("SELECT COUNT(*) AS n FROM redteam_runs WHERE attack = 'prompt-injection'"), '#/redteam', 'audit'),
    edge('web', 'memory', 'what was read is kept with the hash of what it said', n('SELECT COUNT(*) AS n FROM web_fetches WHERE content_hash IS NOT NULL'), '#/memory', 'memory'),
    edge('mcp', 'agents', 'outside tools become things employees can do', n('SELECT COUNT(*) AS n FROM mcp_calls'), '#/agents'),
    edge('mcp', 'egress', 'a tool call is a call to somebody else', n('SELECT COUNT(*) AS n FROM mcp_calls'), '#/egress', 'gate'),
    edge('mcp', 'requests', 'an outside agent can put work on the desk', n('SELECT COUNT(*) AS n FROM mcp_calls'), '#/requests'),

    // The revenue loop: every hop is a real department doing its own job.
    edge('intel', 'revenue', 'qualified companies become deals', n("SELECT COUNT(*) AS n FROM deals WHERE notes LIKE 'Sourced from intelligence%'"), '#/revenue'),
    edge('revenue', 'relations', 'the approach is drafted before it is sent', n("SELECT COUNT(*) AS n FROM runs WHERE task_type = 'outreach_draft'"), '#/relations'),
    edge('revenue', 'connectors', 'the approach leaves through a real mailbox', n("SELECT COUNT(*) AS n FROM egress_log WHERE reason LIKE 'first approach%'"), '#/connectors'),
    edge('revenue', 'sales', 'proposals written by the sales desk', n("SELECT COUNT(*) AS n FROM runs WHERE task_type = 'proposal_draft'"), '#/sales'),
    edge('revenue', 'treasury', 'agreed work becomes an invoice', n('SELECT COUNT(*) AS n FROM invoices WHERE deal_id IS NOT NULL'), '#/treasury'),
    edge('revenue', 'gate', 'signing and taking money wait for a person', n("SELECT COUNT(*) AS n FROM deals WHERE stage IN ('proposal','agreed')"), '#/gate', 'gate'),
    edge('revenue', 'workstreams', 'paid work becomes delivery', n("SELECT COUNT(*) AS n FROM deals WHERE stage IN ('delivering','delivered')"), '#/workstreams'),
    edge('revenue', 'customers', 'delivered work becomes a customer', n("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'"), '#/customers'),

    // Governance of the new machinery.
    edge('constitution', 'auditor', 'the auditor judges against the same rules', n("SELECT COUNT(*) AS n FROM constitution WHERE state = 'active'"), '#/auditor', 'audit'),
    edge('constitution', 'owner', 'only the owner amends the rules', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'constitution.%'"), '#/owner', 'gate'),
    edge('provenance', 'artifacts', 'every artifact leaves with a signed receipt', n('SELECT COUNT(*) AS n FROM provenance'), '#/artifacts'),
    edge('provenance', 'audit', 'the receipt names the chain entry it was made at', n('SELECT COUNT(*) AS n FROM provenance WHERE chain_hash IS NOT NULL'), '#/audit', 'audit'),
    edge('provenance', 'runs', 'a run receipt names its model and its reviewers', n("SELECT COUNT(*) AS n FROM provenance WHERE subject_type = 'run'"), '#/runs'),
    edge('redteam', 'security', 'what got through becomes a security finding', n("SELECT COUNT(*) AS n FROM redteam_runs WHERE outcome = 'breached'"), '#/security', 'audit'),
    edge('redteam', 'egress', 'the gate is the thing most worth attacking', n("SELECT COUNT(*) AS n FROM redteam_runs WHERE target LIKE '%gate%'"), '#/egress', 'audit'),
    edge('redteam', 'constitution', 'a rule that cannot be enforced is found here first', n('SELECT COUNT(*) AS n FROM redteam_runs'), '#/constitution', 'audit'),
    edge('timemachine', 'audit', 'the chain is what makes the past readable', n('SELECT COUNT(*) AS n FROM snapshots'), '#/audit'),
    edge('timemachine', 'decisions', 'a decision reopened cites the one it replaces', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'decision.reopened'"), '#/decisions', 'loop'),
    edge('simulation', 'decisions', 'an answer before the decision, not after', n('SELECT COUNT(*) AS n FROM simulations'), '#/decisions'),
    edge('simulation', 'budgets', 'the levers are the ones that cost money', n("SELECT COUNT(*) AS n FROM simulations WHERE changes LIKE '%budget%'"), '#/budgets'),
    edge('simulation', 'scorecard', 'the fork is judged on the same numbers as the company', n('SELECT COUNT(*) AS n FROM simulations'), '#/scorecard'),
    edge('skills', 'memory', 'a lesson is a sentence; a skill is a procedure', n('SELECT COUNT(*) AS n FROM skills'), '#/memory', 'memory'),
    edge('skills', 'evals', 'a method is adopted on a score, never on confidence', n("SELECT COUNT(*) AS n FROM skills WHERE score IS NOT NULL"), '#/evals', 'audit'),
    edge('skills', 'agents', 'the adopted method goes into the next prompt', n("SELECT COUNT(*) AS n FROM skills WHERE state = 'adopted'"), '#/agents'),
    edge('skills', 'providers', 'tournaments re-rank the models per kind of work', n('SELECT COUNT(*) AS n FROM tournaments'), '#/providers'),
    edge('kgraph', 'memory', 'the graph is the shape memory implies', n('SELECT COUNT(*) AS n FROM graph_nodes'), '#/memory', 'memory'),
    edge('kgraph', 'intel', 'organisations, people and what connects them', n("SELECT COUNT(*) AS n FROM graph_nodes WHERE kind = 'organisation'"), '#/intel'),
    edge('kgraph', 'customers', 'everything known about one customer, in one hop', n("SELECT COUNT(*) AS n FROM graph_nodes WHERE kind = 'customer'"), '#/customers'),
// ---- marketing, as one department -------------------------------------
    // The desk is the hub: everything in the district reports to it, and the
    // district as a whole is judged on one thing — whether the company is
    // understood by people outside it.
    edge('mkt', 'personas', 'who we decided we are talking to', n('SELECT COUNT(*) AS n FROM personas'), '#/personas'),
    edge('mkt', 'positioning', 'the promise the whole department repeats', n('SELECT COUNT(*) AS n FROM positioning'), '#/positioning'),
    edge('mkt', 'marketing', 'campaigns carry the promise to a channel', n('SELECT COUNT(*) AS n FROM campaigns'), '#/marketing'),
    edge('mkt', 'calendar', 'what gets published, when, for whom', n('SELECT COUNT(*) AS n FROM content_calendar'), '#/calendar'),
    edge('mkt', 'seo', 'the searches worth winning', n('SELECT COUNT(*) AS n FROM seo_keywords'), '#/seo'),
    edge('mkt', 'paidmedia', 'attention bought on measurable terms', n('SELECT COUNT(*) AS n FROM campaign_channels'), '#/paidmedia'),
    edge('mkt', 'lifecycle', 'the sequences that move a lead along', n('SELECT COUNT(*) AS n FROM email_sequences'), '#/lifecycle'),
    edge('mkt', 'events', 'rooms booked and rooms filled', n('SELECT COUNT(*) AS n FROM mkt_events'), '#/events'),
    edge('mkt', 'press', 'what the company says on record', n('SELECT COUNT(*) AS n FROM mkt_press'), '#/press'),
    edge('mkt', 'community', 'the people who speak for us unpaid', n('SELECT COUNT(*) AS n FROM mkt_community'), '#/community'),
    edge('mkt', 'attribution', 'and whether any of it actually worked', n('SELECT COUNT(*) AS n FROM mkt_touchpoints'), '#/attribution', 'audit'),
    edge('mkt', 'mktops', 'the plumbing that makes the numbers trustworthy', n('SELECT COUNT(*) AS n FROM mkt_ops'), '#/mktops'),
    edge('mkt', 'marketwatch', 'positioning is against somebody, not in a vacuum', n('SELECT COUNT(*) AS n FROM competitors'), '#/marketwatch'),

    // The producers: three studios that exist to make what the department says
    // legible, seen and readable in two languages.
    edge('calendar', 'content', 'a planned piece becomes a brief for a writer', n("SELECT COUNT(*) AS n FROM content_calendar WHERE state != 'planned'"), '#/content'),
    edge('marketing', 'design', 'every live campaign gets a visual', n('SELECT COUNT(*) AS n FROM designs WHERE campaign_id IS NOT NULL'), '#/design'),
    edge('marketing', 'social', 'and a post on every connected channel', n('SELECT COUNT(*) AS n FROM posts WHERE campaign_id IS NOT NULL'), '#/social'),
    edge('brand', 'content', 'the voice every writer has to obey', n("SELECT COUNT(*) AS n FROM brand_assets WHERE state = 'approved'"), '#/content'),
    edge('brand', 'design', 'and the palette every designer has to obey', n("SELECT COUNT(*) AS n FROM brand_assets WHERE state = 'approved'"), '#/design'),
    edge('brand', 'positioning', 'identity and promise have to agree', n('SELECT COUNT(*) AS n FROM positioning'), '#/positioning'),
    edge('content', 'localization', 'anything published in one language is owed the other', n('SELECT COUNT(*) AS n FROM localizations'), '#/localization'),
    edge('social', 'localization', 'the public voice speaks Arabic too', n("SELECT COUNT(*) AS n FROM localizations WHERE source_kind = 'post'"), '#/localization'),
    edge('seo', 'content', 'a keyword nobody wrote for is a keyword nobody won', n('SELECT COUNT(*) AS n FROM seo_keywords WHERE target_url IS NOT NULL'), '#/content', 'loop'),
    edge('personas', 'pages', 'a page is written for one person, not for everyone', n('SELECT COUNT(*) AS n FROM mkt_pages WHERE persona_id IS NOT NULL'), '#/pages'),
    edge('pages', 'marketing', 'the campaign has to point somewhere', n('SELECT COUNT(*) AS n FROM mkt_pages WHERE campaign_id IS NOT NULL'), '#/marketing'),
    edge('events', 'content', 'the run-of-show is written before the room opens', n("SELECT COUNT(*) AS n FROM mkt_events WHERE state != 'planned'"), '#/content'),

    // Every touch a channel makes is written down, which is the only reason
    // attribution can be computed rather than typed.
    edge('paidmedia', 'attribution', 'paid touches, recorded as they happen', n("SELECT COUNT(*) AS n FROM mkt_touchpoints WHERE channel = 'paid'"), '#/attribution'),
    edge('events', 'attribution', 'a room full of people is a set of touches', n("SELECT COUNT(*) AS n FROM mkt_touchpoints WHERE channel = 'event'"), '#/attribution'),
    edge('press', 'attribution', 'coverage counts, at half weight', n("SELECT COUNT(*) AS n FROM mkt_touchpoints WHERE channel = 'press'"), '#/attribution'),
    edge('pages', 'attribution', 'the page that converted is the touch that mattered', n('SELECT COUNT(*) AS n FROM mkt_pages WHERE conversions > 0'), '#/attribution'),
    edge('mktops', 'attribution', 'lead scoring and tracking, or the numbers are fiction', n("SELECT COUNT(*) AS n FROM mkt_ops WHERE kind IN ('rule','tracking')"), '#/attribution', 'audit'),

    // ---- and out, to the rest of the company -------------------------------
    edge('intel', 'personas', 'personas are grounded in real companies, not invented', n("SELECT COUNT(*) AS n FROM personas WHERE evidence IS NOT NULL"), '#/personas'),
    edge('segments', 'lifecycle', 'a segment is who a sequence is sent to', n('SELECT COUNT(*) AS n FROM segments'), '#/lifecycle'),
    edge('marketwatch', 'pricing', 'what rivals charge is an input to what we charge', n('SELECT COUNT(*) AS n FROM competitors'), '#/pricing'),
    edge('attribution', 'revenue', 'a credited touch is the front of the revenue loop', n('SELECT COUNT(*) AS n FROM mkt_touchpoints'), '#/revenue'),
    edge('attribution', 'customers', 'and the back of it is a customer with an origin', n("SELECT COUNT(*) AS n FROM customers WHERE campaign_id IS NOT NULL"), '#/customers'),
    edge('lifecycle', 'egress', 'every send passes the gate before it leaves', n("SELECT COUNT(*) AS n FROM egress_log WHERE capability LIKE 'mail%'"), '#/egress', 'gate'),
    edge('social', 'connectors', 'publishing is an outbound act like any other', n("SELECT COUNT(*) AS n FROM egress_log WHERE capability LIKE 'post%'"), '#/connectors', 'gate'),
    edge('press', 'gate', 'the company goes on record only when a person says so', n("SELECT COUNT(*) AS n FROM mkt_press WHERE state = 'approved'"), '#/gate', 'gate'),
    edge('paidmedia', 'budgets', 'buying attention spends real money', n('SELECT COUNT(*) AS n FROM campaign_channels'), '#/budgets'),
    edge('events', 'finance', 'a room costs what a room costs', n('SELECT COUNT(*) AS n FROM mkt_events WHERE spent_usd > 0'), '#/finance'),
    edge('mkt', 'sales', 'a lead over the scoring threshold belongs to sales', n('SELECT COUNT(*) AS n FROM deals'), '#/sales'),
    edge('community', 'success', 'an advocate is usually a customer who was looked after', n('SELECT COUNT(*) AS n FROM mkt_community WHERE customer_id IS NOT NULL'), '#/success'),
    edge('community', 'support', 'and a critic is usually a ticket nobody closed', n("SELECT COUNT(*) AS n FROM mkt_community WHERE role = 'critic'"), '#/support', 'loop'),
    edge('mkt', 'chief', 'the quarter tells marketing what it is for', n("SELECT COUNT(*) AS n FROM objectives WHERE state = 'active'"), '#/chief'),
    edge('mkt', 'quality', 'public copy is reviewed by somebody who did not write it', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'mkt_%' OR task_type IN ('press_draft','page_draft','event_brief')"), '#/quality', 'review'),
    edge('press', 'constitution', 'no claim the ledger cannot support', n("SELECT COUNT(*) AS n FROM constitution WHERE rule_id = 'claims-need-sources'"), '#/constitution', 'audit'),
    edge('mkt', 'provenance', 'anything published leaves with a signed receipt', n("SELECT COUNT(*) AS n FROM provenance WHERE subject_type = 'run'"), '#/provenance'),
    edge('mkt', 'kgraph', 'campaigns, customers and content, joined up', n("SELECT COUNT(*) AS n FROM graph_nodes WHERE kind = 'campaign'"), '#/kgraph'),
    edge('mkt', 'memory', 'what worked last time, before planning this time', n("SELECT COUNT(*) AS n FROM mem_docs"), '#/memory', 'memory'),
    edge('mkt', 'agents', 'twelve specialists, not one generalist', n("SELECT COUNT(*) AS n FROM agents WHERE id LIKE 'AGT-MKT-%'"), '#/agents'),

    edge('kgraph', 'knowledge', 'semantic search across the whole company', n('SELECT COUNT(*) AS n FROM graph_edges'), '#/knowledge'),

    // ---- the platform ------------------------------------------------------
    // The rhythm is the management layer, so it touches whatever it decides
    // about — and everything it decides is written down as a period.
    edge('chief', 'objectives', 'the quarter sets the company its own goals', n("SELECT COUNT(*) AS n FROM objectives WHERE owner = 'system:chief'"), '#/objectives'),
    edge('chief', 'runs', 'the daily turn unblocks what is stuck', n("SELECT COUNT(*) AS n FROM periods WHERE kind = 'day'"), '#/runs', 'loop'),
    edge('chief', 'budgets', 'the quarter divides the money across the goals', n("SELECT COUNT(*) AS n FROM periods WHERE kind = 'quarter'"), '#/budgets'),
    edge('chief', 'workforce', 'load is spread off whoever is carrying too much', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chief.turn'"), '#/workforce'),
    edge('chief', 'audit', 'every turn is written down with the numbers it decided from', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'period.%' OR action = 'chief.turn'"), '#/audit', 'audit'),
    edge('chief', 'autopilot', 'the rhythm only runs while autonomy is on', n("SELECT COUNT(*) AS n FROM periods"), '#/autopilot', 'gate'),
    edge('chief', 'observe', 'what the rhythm sees becomes a measurement', n("SELECT COUNT(*) AS n FROM metrics WHERE at >= datetime('now','-1 day')"), '#/observe'),

    edge('observe', 'runs', 'a stalled item is put back rather than left', n("SELECT COUNT(*) AS n FROM remedies WHERE action = 'requeue-stuck'"), '#/runs', 'loop'),
    edge('observe', 'quality', 'too many failed audits and the quality desk is asked why', n("SELECT COUNT(*) AS n FROM remedies WHERE action = 'ask-quality'"), '#/quality'),
    edge('observe', 'oversight', 'what it cannot fix safely, it pages a person about', n("SELECT COUNT(*) AS n FROM remedies WHERE action = 'page-a-person'"), '#/oversight', 'gate'),
    edge('observe', 'budgets', 'speculative work is held near the cap', n("SELECT COUNT(*) AS n FROM remedies WHERE action = 'throttle-discretionary'"), '#/budgets'),
    edge('observe', 'jobs', 'dead work is a measurement, not a mystery', n("SELECT COUNT(*) AS n FROM jobs WHERE state = 'dead'"), '#/jobs'),

    edge('tenants', 'audit', 'starting and stopping a company is on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'tenant.%'"), '#/audit', 'audit'),
    edge('tenants', 'budgets', 'a company past its cap is paused, not billed', n("SELECT COUNT(*) AS n FROM tenants WHERE state = 'paused'"), '#/budgets', 'gate'),
    edge('tenants', 'backups', 'each company is its own file, so each is its own backup', n('SELECT COUNT(*) AS n FROM tenants'), '#/backups'),

    edge('keys', 'egress', 'a key is another way in, and it is scoped like everything else', n("SELECT COUNT(*) AS n FROM api_keys WHERE state = 'active'"), '#/egress', 'gate'),
    edge('keys', 'users', 'a key can only hold permissions that exist', n('SELECT COUNT(*) AS n FROM api_keys'), '#/users'),
    edge('keys', 'observe', 'the error rate on the API is something the company promised', n("SELECT COUNT(*) AS n FROM api_calls WHERE created_at >= datetime('now','-1 day')"), '#/observe'),

    edge('webhooks', 'audit', 'the chain is the event source, so nothing can be announced that did not happen', n('SELECT COUNT(*) AS n FROM webhook_deliveries'), '#/audit', 'audit'),
    edge('webhooks', 'jobs', 'a receiver that is down costs a retry, not an event', n("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'webhook.deliver'"), '#/jobs'),
    edge('webhooks', 'vault', 'each subscription signs with its own secret', n('SELECT COUNT(*) AS n FROM webhooks'), '#/vault'),

    edge('packages', 'agents', 'a package hires its own employees', n("SELECT COUNT(*) AS n FROM agents WHERE spec LIKE '%fromPackage%'"), '#/agents'),
    edge('packages', 'users', 'and declares its own permissions, which must be new', n("SELECT COUNT(*) AS n FROM packages WHERE state = 'installed'"), '#/users'),
    edge('packages', 'graph', 'an installed department appears on the map like any other', n("SELECT COUNT(*) AS n FROM packages WHERE state = 'installed'"), '#/graph'),

    edge('anchors', 'audit', 'the height and hash a third party wrote down', n('SELECT COUNT(*) AS n FROM anchors WHERE ok = 1'), '#/audit', 'audit'),
    edge('anchors', 'egress', 'reaching a timestamping authority goes through the gate', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chain.anchored'"), '#/egress'),
    edge('anchors', 'oversight', 'a chain that no longer matches its witness is a finding, not a note', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chain.anchor_failed'"), '#/oversight', 'audit'),
    edge('erasure', 'vault', "each person's key is wrapped under the master key", n('SELECT COUNT(*) AS n FROM pii_subjects'), '#/vault'),
    edge('erasure', 'audit', 'the erasure is recorded; the identifier never is', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pii.erased'"), '#/audit', 'audit'),
    edge('erasure', 'intel', 'the columns an erasure walks', n('SELECT COUNT(*) AS n FROM intel_records'), '#/intel'),
    edge('erasure', 'compliance', 'a request arrives there and is carried out here', n('SELECT COUNT(*) AS n FROM pii_subjects WHERE erased_at IS NOT NULL'), '#/compliance', 'gate'),
    edge('approvals', 'gate', 'runs that stopped for a person', n("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'"), '#/gate', 'gate'),
    edge('approvals', 'decisions', 'decisions nobody has ruled on', n("SELECT COUNT(*) AS n FROM decisions WHERE status IN ('proposed','deliberating')"), '#/decisions', 'gate'),
    edge('approvals', 'treasury', 'money waiting on a signature outranks everything else', n("SELECT COUNT(*) AS n FROM payouts WHERE state = 'prepared'"), '#/treasury', 'gate'),
    edge('approvals', 'egress', 'calls the gate held', n("SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'gate'"), '#/egress', 'gate'),
    edge('approvals', 'users', 'delegation, bounded in time', n('SELECT COUNT(*) AS n FROM delegations'), '#/users'),
    edge('roles', 'users', 'a template applied to an account', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.role_applied'"), '#/users'),
    edge('roles', 'treasury', 'treasury.pay lives in one template and no other', 1, '#/treasury', 'gate'),
    edge('roles', 'egress', 'so does egress.release', 1, '#/egress', 'gate'),
    edge('roles', 'vault', 'and vault.manage', 1, '#/vault', 'gate'),
    edge('tiers', 'providers', 'the chain a tier resolves to', n('SELECT COUNT(*) AS n FROM tier_proposals'), '#/providers'),
    edge('tiers', 'runs', 'every employee on a tier changes together', n('SELECT COUNT(*) AS n FROM runs WHERE model IS NOT NULL'), '#/runs'),
    edge('tiers', 'evals', 'the canary is a regression check, not a benchmark', n("SELECT COUNT(*) AS n FROM tier_proposals WHERE state != 'proposed'"), '#/evals', 'review'),
    edge('tiers', 'gate', 'promoting is a human act, and an untested chain is refused', n("SELECT COUNT(*) AS n FROM tier_proposals WHERE state = 'promoted'"), '#/gate', 'gate'),
    edge('embeddings', 'kgraph', 'the vectors the graph searches with', n('SELECT COUNT(*) AS n FROM graph_nodes'), '#/kgraph'),
    edge('embeddings', 'memory', 'and what a playbook is recalled by', n('SELECT COUNT(*) AS n FROM memory_entries'), '#/memory', 'memory'),
    edge('embeddings', 'providers', 'a local model, or string overlap', 1, '#/providers'),
    edge('deliverability', 'contact', 'signed mail, and whether a call may be recorded', n('SELECT COUNT(*) AS n FROM calls'), '#/contact'),
    edge('deliverability', 'egress', 'signing is not sending; sending goes through the gate', n("SELECT COUNT(*) AS n FROM egress_log WHERE capability LIKE 'mail%'"), '#/egress'),
    edge('deliverability', 'compliance', 'recording consent is a legal question before it is a technical one', n('SELECT COUNT(*) AS n FROM calls'), '#/compliance', 'gate'),
    edge('observability', 'audit', "the chain's height and the age of its last witness", n('SELECT COUNT(*) AS n FROM audit_log'), '#/audit', 'audit'),
    edge('observability', 'runs', 'queue depth, spend, and which model answered', n('SELECT COUNT(*) AS n FROM runs'), '#/runs'),
    edge('observability', 'archive', 'what retention deletes, and what it never touches', n('SELECT COUNT(*) AS n FROM metrics'), '#/archive'),
    edge('observability', 'incidents', 'a breached objective becomes an incident', n("SELECT COUNT(*) AS n FROM slos WHERE state = 'breached'"), '#/incidents'),

    edge('backups', 'audit', 'a backup records the chain tip it was taken at', n('SELECT COUNT(*) AS n FROM backups'), '#/audit', 'audit'),
    edge('backups', 'archive', 'what is kept, and for how long', n('SELECT COUNT(*) AS n FROM backups'), '#/archive'),
    edge('backups', 'gate', 'restoring over a live company waits for a person', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup.restore_staged'"), '#/gate', 'gate'),
    edge('contact', 'sales', 'outbound calls chasing deals', n("SELECT COUNT(*) AS n FROM calls WHERE direction = 'out'"), '#/sales'),
    // The money desk reads every other ledger before it says anything.
    edge('money', 'treasury', 'crypto received is the cash line', n("SELECT COUNT(*) AS n FROM invoices WHERE state = 'paid'"), '#/treasury'),
    edge('money', 'finance', 'model spend is the burn line', n('SELECT COUNT(*) AS n FROM model_calls'), '#/finance'),
    edge('money', 'vendors', 'recurring vendor cost', n("SELECT COUNT(*) AS n FROM vendors WHERE state = 'active'"), '#/vendors'),
    edge('money', 'procurement', 'approved purchases are committed cash', n("SELECT COUNT(*) AS n FROM purchase_requests WHERE state IN ('approved','ordered')"), '#/procurement'),
    edge('money', 'budgets', 'the policy sets what the caps mean', n('SELECT COUNT(*) AS n FROM money_policy'), '#/budgets'),
    edge('money', 'board', 'runway is a board number', n('SELECT COUNT(*) AS n FROM board_records'), '#/board'),
    // Treasury: money arriving is the one loop the company closes by itself.
    edge('treasury', 'customers', 'a paid invoice makes the customer active', n('SELECT COUNT(*) AS n FROM invoices WHERE customer_id IS NOT NULL'), '#/customers'),
    edge('treasury', 'sales', 'a paid invoice wins the deal', n('SELECT COUNT(*) AS n FROM invoices WHERE deal_id IS NOT NULL'), '#/sales'),
    edge('treasury', 'finance', 'settled payments are revenue', n("SELECT COUNT(*) AS n FROM invoices WHERE state = 'paid'"), '#/finance'),
    edge('treasury', 'gate', 'money leaving always waits for a person', n("SELECT COUNT(*) AS n FROM payouts WHERE state IN ('prepared','approved')"), '#/gate', 'gate'),
    edge('chat', 'treasury', 'employees invoice from the conversation', n("SELECT COUNT(*) AS n FROM chat_messages WHERE action LIKE '%invoice.create%'"), '#/treasury'),
    edge('treasury', 'audit', 'every payment and payout on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'invoice.%' OR action LIKE 'wallet.%' OR action LIKE 'payout.%'"), '#/audit', 'audit'),
    // Marketing reaches into what it needs and reports what it returned.
    edge('mkt', 'marketing', 'campaigns the department plans and buys', n('SELECT COUNT(*) AS n FROM campaign_channels'), '#/marketing'),
    edge('mkt', 'content', 'calendar entries commissioned as real pieces', n('SELECT COUNT(*) AS n FROM content_calendar WHERE content_id IS NOT NULL'), '#/content'),
    edge('mkt', 'customers', 'customers attributed to a campaign', n('SELECT COUNT(*) AS n FROM customers WHERE campaign_id IS NOT NULL'), '#/customers'),
    edge('mkt', 'intel', 'personas grounded in collected organisations', n('SELECT COUNT(*) AS n FROM personas'), '#/intel'),
    edge('mkt', 'marketwatch', 'positioning written against real rivals', n('SELECT COUNT(*) AS n FROM positioning'), '#/marketwatch', 'review'),
    edge('mkt', 'brand', 'everything published speaks the brand voice', n('SELECT COUNT(*) AS n FROM brand_assets'), '#/brand'),
    edge('mkt', 'finops', 'channel spend judged against what it returned', n('SELECT COUNT(*) AS n FROM campaign_channels WHERE spent_usd > 0'), '#/finops', 'audit'),
    edge('mkt', 'agents', 'its own eight specialists', 8, '#/agents'),
    // The floor: a mention is a summons, and some of them turn into work.
    edge('chat', 'agents', 'employees summoned by name', n("SELECT COUNT(*) AS n FROM chat_messages WHERE author_kind = 'agent'"), '#/agents', 'review'),
    edge('chat', 'runs', 'a mention puts a run on the queue', n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'chat:%'"), '#/runs'),
    edge('chat', 'tasks', 'work started from a conversation', n("SELECT COUNT(*) AS n FROM chat_messages WHERE action LIKE '%task.delegate%'"), '#/tasks'),
    edge('chat', 'workstreams', 'iteration started from a conversation', n("SELECT COUNT(*) AS n FROM chat_messages WHERE action LIKE '%workstream.start%'"), '#/workstreams'),
    edge('chat', 'audit', 'every word is on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'chat.%'"), '#/audit', 'audit'),
    edge('memory', 'runs', 'lessons recalled into new work', n('SELECT COUNT(DISTINCT run_id) AS n FROM mem_usage'), '#/memory', 'memory'),
    edge('runs', 'memory', 'experience kept from finished work', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'episode'"), '#/memory', 'memory'),
    edge('sprints', 'tasks', 'tasks committed to an iteration', n('SELECT COUNT(*) AS n FROM tasks WHERE sprint_id IS NOT NULL'), '#/tasks'),
    edge('sprints', 'projects', 'iterations delivering projects', n('SELECT COUNT(*) AS n FROM sprints'), '#/projects'),
    edge('sprints', 'knowledge', 'retrospectives kept as lessons', n("SELECT COUNT(*) AS n FROM sprints WHERE retro IS NOT NULL"), '#/knowledge'),
    // Memory feeds every run and is fed by every outcome.
    edge('memory', 'runs', 'runs that worked with recalled memory', n('SELECT COUNT(DISTINCT run_id) AS n FROM mem_usage'), '#/runs'),
    edge('runs', 'memory', 'episodes kept from finished work', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'episode'"), '#/memory'),
    edge('memory', 'agents', 'playbooks the workforce reads before working', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'playbook'"), '#/agents'),
    edge('memory', 'knowledge', 'verified lessons become organizational truth', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson' AND verification = 'verified'"), '#/knowledge'),
    edge('memory', 'academy', 'weak areas become training', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson'"), '#/academy'),
    edge('auditor', 'memory', 'audit scores grade past experience', n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'episode' AND quality IS NOT NULL"), '#/memory'),
    // Thinly-wired departments. Riding only on the universal "everything lands
    // on the chain" rule made them look connected while hiding how they are
    // actually reached; these are the joins that were real but undeclared.
    edge('pipelines', 'artifacts', 'each finished step writes a file', n('SELECT COUNT(*) AS n FROM archive_items WHERE file_ref IS NOT NULL'), '#/artifacts'),
    edge('pipelines', 'products', 'pipelines building a product', n('SELECT COUNT(*) AS n FROM pipelines WHERE product_id IS NOT NULL'), '#/products'),
    edge('pipelines', 'gate', 'a gated step pauses the whole chain', n("SELECT COUNT(*) AS n FROM runs WHERE pipeline_id IS NOT NULL AND state = 'awaiting_human'"), '#/gate', 'gate'),
    edge('artifacts', 'products', 'what the factory actually produced', n("SELECT COUNT(*) AS n FROM archive_items WHERE kind LIKE '%forge%' OR file_ref IS NOT NULL"), '#/products'),
    edge('requests', 'workstreams', 'an intake that needs iteration becomes a workstream', n('SELECT COUNT(*) AS n FROM workstreams'), '#/workstreams'),
    edge('requests', 'gate', 'steps that stop for a human sign-off', n("SELECT COUNT(*) AS n FROM request_steps WHERE state = 'awaiting_human'"), '#/gate', 'gate'),
    edge('people', 'oversight', 'the humans who signed the approvals', n('SELECT COUNT(DISTINCT approver_human) AS n FROM approvals'), '#/oversight'),
    edge('people', 'disputes', 'HR arbitrates what the workforce cannot settle', n('SELECT COUNT(*) AS n FROM disputes'), '#/disputes'),
    edge('people', 'tasks', 'work assigned to a person rather than an agent', n("SELECT COUNT(*) AS n FROM tasks WHERE assignee_type = 'human'"), '#/tasks'),
    edge('objectives', 'scorecard', 'the KPI board reads the quarterly objectives', n('SELECT COUNT(*) AS n FROM objectives'), '#/scorecard'),
    edge('objectives', 'projects', 'projects that serve an objective', n('SELECT COUNT(*) AS n FROM projects'), '#/projects'),
    edge('assets', 'security', 'credentials and domains are attack surface', n("SELECT COUNT(*) AS n FROM assets WHERE kind IN ('credential','domain')"), '#/security', 'review'),
    edge('assets', 'finance', 'renewals are recurring cost', n('SELECT COUNT(*) AS n FROM assets WHERE renewal_date IS NOT NULL'), '#/finance'),
    edge('insights', 'scorecard', 'trends behind the headline numbers', 1, '#/scorecard'),
    edge('insights', 'finops', 'spend trends drive the cost review', n('SELECT COUNT(*) AS n FROM model_calls'), '#/finops'),
    edge('marketwatch', 'sales', 'rival intelligence arms the deal desk', n('SELECT COUNT(*) AS n FROM competitors'), '#/sales'),
    edge('marketwatch', 'marketing', 'positioning answers the competition', n('SELECT COUNT(*) AS n FROM competitors WHERE brief IS NOT NULL'), '#/marketing'),
    edge('ir', 'board', 'the same numbers brief investors and the board', n('SELECT COUNT(*) AS n FROM investor_updates'), '#/board'),
    edge('ir', 'archive', 'sent updates are frozen as a record', n("SELECT COUNT(*) AS n FROM investor_updates WHERE state = 'sent'"), '#/archive'),
    edge('sustainability', 'finops', 'energy per token sits beside cost per token', n('SELECT COUNT(DISTINCT provider) AS n FROM model_calls'), '#/finops'),
    edge('sustainability', 'board', 'reported alongside the financials', n('SELECT COUNT(*) AS n FROM board_records'), '#/board'),
    edge('users', 'audit', 'every account action is on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'user.%' OR action LIKE 'auth.%'"), '#/audit', 'audit'),
    edge('users', 'security', 'over-broad grants are a finding', n("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'anomaly'"), '#/security', 'review'),
    edge('settings', 'security', 'a provider without a DPA is flagged here', n("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'vendor-dpa'"), '#/security', 'review'),
    edge('settings', 'budgets', 'mock mode and keys decide what may be spent', n('SELECT COUNT(*) AS n FROM settings'), '#/budgets', 'gate'),
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
  workstream: 'workstreams', cycle: 'workstreams', audit: 'auditor', sprint: 'sprints', memory: 'memory',
  request: 'requests', journey: 'journeys', system: 'settings',
};
const ACTION_SECTION = {
  auth: 'users', server: 'settings', settings: 'settings', security: 'security',
  lab: 'lab', pmo: 'pmo', ir: 'ir', board: 'board', comms: 'comms', brand: 'brand',
  release: 'releases', academy: 'academy', recruiting: 'recruiting', procurement: 'procurement',
};

/**
 * Proof that the company branches, loops and double-checks — measured, not
 * asserted. The map header reads these numbers straight from the work that ran.
 */
export function flowStats() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    workstreams: n('SELECT COUNT(*) AS n FROM workstreams'),
    rounds: n('SELECT COUNT(*) AS n FROM cycles'),
    revisions: n('SELECT COUNT(*) AS n FROM cycles WHERE seq > 1'),
    handoffs: n('SELECT COUNT(*) AS n FROM (SELECT workstream_id, dept FROM cycles GROUP BY workstream_id, dept)') - n('SELECT COUNT(*) AS n FROM workstreams'),
    departmentsTouched: n('SELECT COUNT(DISTINCT dept) AS n FROM cycles'),
    peerReviews: n("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'cycle-review:%'"),
    reviewersInvolved: n("SELECT COUNT(DISTINCT agent_id) AS n FROM runs WHERE task_type LIKE 'cycle-review:%'"),
    audits: n('SELECT COUNT(*) AS n FROM audits'),
    auditedDepartments: n('SELECT COUNT(DISTINCT dept) AS n FROM audits WHERE dept IS NOT NULL'),
    sentBack: n("SELECT COUNT(*) AS n FROM audits WHERE verdict != 'pass' AND state = 'done'"),
    humanGates: n("SELECT COUNT(*) AS n FROM approvals"),
    memoryRecalls: n('SELECT COUNT(DISTINCT run_id) AS n FROM mem_usage'),
    lessonsLearned: n("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson'"),
  };
}

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
