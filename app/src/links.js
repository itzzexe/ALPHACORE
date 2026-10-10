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
  const soft = (sql) => { try { return n(sql); } catch { return 0; } };
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
    S('economics', 'Unit economics', 'capital', '#/economics', n('SELECT COUNT(*) AS n FROM model_calls'), 'What each employee, department and customer costs, and what their work touched'),
    S('standing', 'Standing orders', 'govern', '#/standing', n("SELECT COUNT(*) AS n FROM standing_orders WHERE state != 'deleted'"), 'What the company keeps doing without being asked again — and what turns itself off'),
    S('deadletter', 'Dead work', 'operate', '#/deadletter', n('SELECT COUNT(*) AS n FROM dead_letter'), 'Work that failed for good: what died, why, what it cost, and whether to try again'),
    S('continuity', 'Continuity', 'operate', '#/continuity', n('SELECT COUNT(*) AS n FROM backups'), 'Draining, who can be reached at 3am, and whether a copy has ever left this machine'),
    // Operate
    // Build and run — the company writing, shipping and watching its own software.
    S('forge', 'Software factory', 'build', '#/forge', soft("SELECT COUNT(*) AS n FROM forge_projects WHERE state = 'active'"), 'Code repositories built by people and AI engineers — edit, run, commit, preview'),
    S('sites', 'Websites', 'build', '#/sites', soft("SELECT COUNT(*) AS n FROM forge_projects WHERE kind = 'website' AND state = 'active'"), 'A business website from a short brief, in English or Arabic, ready to publish'),
    // The engineering floor around the factory: an editor, a review board, the
    // repositories that live on GitHub, an app builder, and the numbers that
    // say whether any of it ships well.
    S('studio', 'Dev Studio', 'build', '#/studio', soft('SELECT COUNT(*) AS n FROM eng_assist'), 'An editor for every factory project: tabs, search, source control, a terminal, and an AI pair programmer'),
    S('reviews', 'Review board', 'build', '#/reviews', soft('SELECT COUNT(*) AS n FROM eng_reviews'), 'Security, tests, quality, performance, accessibility and dependencies — a scanner first, then reviewers from another model family'),
    S('github', 'GitHub', 'build', '#/github', soft('SELECT COUNT(*) AS n FROM gh_repos'), 'Repositories, pull requests, issues and Actions — cloned, reviewed and pushed through the one gate'),
    S('appbuilder', 'App builder', 'build', '#/appbuilder', soft('SELECT COUNT(*) AS n FROM app_builds'), 'From a paragraph to a running app: specification, architecture, milestones, tests and review, with a person at every gate'),
    S('engmetrics', 'Engineering metrics', 'build', '#/engmetrics', soft('SELECT COUNT(*) AS n FROM dep_releases'), 'Deployment frequency, lead time, change failure and time to restore — measured, with the quality gate per project'),
    S('servers', 'Servers', 'operate', '#/servers', soft('SELECT COUNT(*) AS n FROM srv_servers'), 'The fleet: VPS and machines over SSH — vital signs, services, commands, provisioning'),
    S('deploys', 'Deployments', 'operate', '#/deploys', soft('SELECT COUNT(*) AS n FROM dep_targets'), 'Ship a project to a server with nginx, HTTPS and one-click rollback'),
    S('monitors', 'Monitoring', 'operate', '#/monitors', soft('SELECT COUNT(*) AS n FROM mon_checks'), 'Uptime, latency, certificates and server thresholds — incidents opened when something falls over'),
    S('crew', 'Workforce command', 'talent', '#/crew', soft("SELECT COUNT(*) AS n FROM crew_assignments WHERE state NOT IN ('approved','cancelled','declined')"), 'The AI plans and dispatches work to human staff, tracks it and nudges — people keep the judgement'),
    S('incidents', 'Incidents', 'operate', '#/incidents', n('SELECT COUNT(*) AS n FROM incidents'), 'SEV lifecycle with postmortems'),
    S('support', 'Support', 'operate', '#/support', n('SELECT COUNT(*) AS n FROM tickets'), 'Tickets, AI drafts, human sends'),
    S('people', 'People', 'talent', '#/people', n('SELECT COUNT(*) AS n FROM people'), 'The human layer'),
    // Core 2 — the enterprise galaxy. These sit in Core 1's catalogue on
    // purpose: one map, one connectivity audit, one sweep. A second diagram for
    // the second core would be exactly the island the design refuses.
    S('workforce2', 'Employees', 'talent', '#/workforce2', n('SELECT COUNT(*) AS n FROM hr_person'),
      'The system of record: who is employed, on what terms, reporting to whom'),
    S('orgchart', 'Organization', 'talent', '#/orgchart', n('SELECT COUNT(*) AS n FROM hr_org_unit'),
      'Units, positions and grades — the shape of the company'),
    S('docs', 'Documents', 'data', '#/docs', n('SELECT COUNT(*) AS n FROM doc_document'),
      'The knowledge base: versioned, classified, and sealed where it is about a person'),
    S('files', 'Files', 'data', '#/files', n('SELECT COUNT(*) AS n FROM doc_file WHERE deleted_at IS NULL'),
      'Attachments whose bytes are sealed under the subject\'s own key, so erasing the person destroys the file'),
    S('records', 'Records & retention', 'trust', '#/records', n('SELECT COUNT(*) AS n FROM rec_class'),
      'How long each kind of record is kept, on whose authority, and the legal hold that outranks both the schedule and a request to be forgotten'),
    S('shifts', 'Shifts & overtime', 'talent', '#/shifts', n('SELECT COUNT(*) AS n FROM time_shift'),
      'Rosters, lateness measured against the shift in force that day, and extra minutes that are not overtime until somebody approves them'),
    S('payrules', 'Pay rules', 'capital', '#/payrules', n('SELECT COUNT(*) AS n FROM pay_rule WHERE active = 1'),
      'What is deducted from a slip and on whose authority — declared rules, never a zero standing in for an answer'),
    S('custody', 'Custody', 'operate', '#/custody', n('SELECT COUNT(*) AS n FROM cust_item WHERE returned_at IS NULL'),
      'Who is holding which laptop, key and card — the asset register says what we own, this says where it is'),
    S('joining', 'Joining & leaving', 'talent', '#/joining', n("SELECT COUNT(*) AS n FROM join_list WHERE state = 'open'"),
      'A first day and a last day as a checklist, where the steps that cost money cannot be skipped quietly'),
    S('time', 'Attendance & leave', 'talent', '#/time', n('SELECT COUNT(*) AS n FROM time_leave_request'),
      'Who is in, who is away, and the leave that waits on a manager'),
    S('meetings', 'Meetings', 'talent', '#/meetings', n('SELECT COUNT(*) AS n FROM mtg_meeting'),
      'Agendas, decisions and action items — with only humans in the room'),
    S('finops2', 'Finance ops', 'capital', '#/finops2', n('SELECT COUNT(*) AS n FROM fin_expense'),
      'Expenses, loans, cost centers and the payroll engine — slips sealed, totals in the ledger'),
    S('procure', 'Procurement ops', 'commerce', '#/procure', n('SELECT COUNT(*) AS n FROM proc_request'),
      'Request to payment without a skippable step, and the contract expiry watch'),
    S('talent2', 'People lifecycle', 'talent', '#/talent2', n('SELECT COUNT(*) AS n FROM rec_application'),
      'Recruitment, reviews, training and offboarding — with the judgments kept human'),
    S('map2', 'The two galaxies', 'govern', '#/map2', n('SELECT COUNT(*) AS n FROM connectors'),
      'The second map: the enterprise core beside the AI core, joined by the tunnels'),
    S('bridges', 'The bridges', 'govern', '#/bridges', n('SELECT COUNT(*) AS n FROM connectors'),
      'Everything that crosses between the AI core and the enterprise core, and what is gated'),
    // The rest of the enterprise core: time rules, compensation, the finance
    // sub-ledgers, the bank, operations, administration, and the page about you.
    S('hrops', 'Time rules', 'talent', '#/hrops', n('SELECT COUNT(*) AS n FROM time_overtime'),
      'Shifts, holidays, overtime and corrections — lateness and absence measured, never explained'),
    S('comp', 'Compensation', 'talent', '#/comp', n('SELECT COUNT(*) AS n FROM hr_salary_change'),
      'Allowances, benefits, salary history, movements, end of service and grievances — sealed where it is about one person'),
    S('budgets2', 'Budgets', 'capital', '#/budgets2', n('SELECT COUNT(*) AS n FROM fin_budget'),
      'Adopted by a person, measured against the posted journal, line by line'),
    S('payables', 'Payables', 'capital', '#/payables', n('SELECT COUNT(*) AS n FROM fin_ap_bill'),
      'Vendor bills from draft to paid, and what is overdue to whom'),
    S('receivables', 'Receivables', 'capital', '#/receivables', n('SELECT COUNT(*) AS n FROM fin_ar_invoice'),
      'Customer invoices in the fiat books, receipts against them, and the aging'),
    S('fixedassets', 'Fixed assets', 'capital', '#/fixedassets', n('SELECT COUNT(*) AS n FROM fin_fixed_asset'),
      'The register, straight-line depreciation each month, and disposal by a person'),
    S('bank', 'The bank', 'capital', '#/bank', n('SELECT COUNT(*) AS n FROM bank_account'),
      'Accounts and cash boxes, statements reconciled line by line, transfers, cheques and payment batches'),
    S('inventory', 'Inventory', 'operate', '#/inventory', n('SELECT COUNT(*) AS n FROM ops_stock_move'),
      'Warehouses, items and every move — a level is a sum, never a stored number'),
    S('facilities', 'Facilities & fleet', 'operate', '#/facilities', n('SELECT COUNT(*) AS n FROM ops_workorder'),
      'Work orders, vehicles and rooms — the physical company'),
    S('helpdesk', 'Help desk', 'operate', '#/helpdesk', n('SELECT COUNT(*) AS n FROM ops_ticket'),
      'The internal desk with an SLA clock, and workplace incidents kept apart from the technical ones'),
    S('secretariat', 'Secretariat', 'govern', '#/secretariat', n('SELECT COUNT(*) AS n FROM adm_letter'),
      'The correspondence register, committees and their resolutions'),
    S('legalcases', 'Legal cases', 'operate', '#/legalcases', n('SELECT COUNT(*) AS n FROM adm_case'),
      'Litigation, arbitration and claims — with the contract each one rests on'),
    S('regulatory', 'Regulatory', 'trust', '#/regulatory', n('SELECT COUNT(*) AS n FROM adm_obligation'),
      'The obligations calendar and the licences, each with a clock the sweep watches'),
    S('me', 'My workspace', 'talent', '#/me', n('SELECT COUNT(*) AS n FROM users WHERE person_id IS NOT NULL'),
      'The page about you: your day, your leave, your slips, your things, your tickets'),
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
    // The functions a company discovers it needed after somebody audited it.
    S('tax', 'Tax', 'capital', '#/tax', n('SELECT COUNT(*) AS n FROM tax_lines'), 'What was owed, where, and to whom — as entries in the same double-entry books, never a separate report'),
    S('privacy', 'Privacy & DPO', 'trust', '#/privacy', n("SELECT COUNT(*) AS n FROM dsr_requests WHERE state IN ('received','working')"), 'Not whether the data is safe but whether the company may hold it at all — the question the SOC does not ask'),
    S('ip', 'Intellectual property', 'operate', '#/ip', n('SELECT COUNT(*) AS n FROM ip_assets'), 'What the company owns that is not a thing, and the renewal date that loses it'),
    S('help', 'Help centre', 'operate', '#/help', n("SELECT COUNT(*) AS n FROM help_articles WHERE state = 'published'"), 'Documentation for the people who bought it — judged on the replies that never had to be written'),
    S('datagov', 'Data governance', 'govern', '#/datagov', n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1 AND erasable = 0'), 'What a column is, and whether an erasure could actually reach it — the cross-check neither module can make alone'),
    S('trustcentre', 'Trust centre', 'trust', '#/trust', n("SELECT COUNT(*) AS n FROM trust_documents WHERE state = 'published'"), 'What the company tells a prospect, with the live number behind every claim'),
    S('status', 'Status & SLA', 'operate', '#/status', n("SELECT COUNT(*) AS n FROM status_notices WHERE state <> 'resolved'"), 'What the company admits in public while it is happening, and the promise it made about how often'),
    S('partnerships', 'Partnerships', 'commerce', '#/partnerships', n('SELECT COUNT(*) AS n FROM partners'), 'Not sales: whether anything actually flows through the relationship'),
    S('growth', 'Growth', 'marketing', '#/growth', n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth'"), 'Moving one number on purpose, with the hypothesis written before the result'),
    S('offices', 'The offices', 'talent', '#/offices', n('SELECT COUNT(*) AS n FROM sim_learnings'), 'The workforce in a building rather than a feed — who is in which room, what was said, and what somebody walked away having learned'),
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

/**
 * The enterprise galaxy's own division structure — the directive's §2 table,
 * as data the second map draws from.
 *
 * This is a second PROJECTION, not a second diagram: the departments are the
 * same catalogue rows and the tunnels are the same declared edges the first
 * map draws and the connectivity audit checks. Two views of one truth cannot
 * disagree; two diagrams always eventually do.
 */
export const CORE2_DIVISIONS = [
  { id: 'e-people', label: 'PEOPLE', color: '#4f9cf0', departments: ['workforce2', 'orgchart', 'talent2', 'joining', 'comp', 'me'] },
  { id: 'e-time', label: 'TIME', color: '#78bf6d', departments: ['time', 'shifts', 'hrops'] },
  { id: 'e-finance', label: 'FINANCE', color: '#e8c547', departments: ['finops2', 'payrules', 'budgets2', 'payables', 'receivables', 'fixedassets'] },
  { id: 'e-bank', label: 'THE BANK', color: '#d9a441', departments: ['bank'] },
  { id: 'e-procure', label: 'PROCUREMENT & STOCK', color: '#e5533d', departments: ['procure', 'inventory', 'custody'] },
  { id: 'e-ops', label: 'OPERATIONS', color: '#ffb020', departments: ['facilities', 'helpdesk'] },
  { id: 'e-admin', label: 'ADMINISTRATION', color: '#948b7d', departments: ['secretariat', 'legalcases', 'regulatory'] },
  { id: 'e-collab', label: 'COLLABORATION', color: '#b78bff', departments: ['meetings', 'docs', 'files'] },
  { id: 'e-records', label: 'RECORDS', color: '#e07bd2', departments: ['records'] },
  { id: 'e-bridge', label: 'THE BRIDGES', color: '#2fd6a8', departments: ['bridges'] },
];

/**
 * The two galaxies and the tunnels between them, derived.
 *
 * Internal edges have both ends in Core 2; tunnels have exactly one, and the
 * far end keeps its Core 1 division so the drawing can say which part of the
 * thinking galaxy each tunnel lands in. Nothing here is typed by hand — a
 * tunnel with no declared edge behind it cannot exist, which is the point.
 */
export function core2Map({ sections: given = null, edges: givenEdges = null } = {}) {
  const mine = new Set(CORE2_DIVISIONS.flatMap((d) => d.departments));
  // The overview computes the catalogue and the matrix once for the whole
  // map; it hands them in so the seam is drawn from the same reading.
  const sections = given || sectionCatalog();
  const byId = new Map(sections.map((s) => [s.id, s]));
  const edges = (givenEdges || relationshipMatrix()).filter((e) => mine.has(e.from) || mine.has(e.to));

  const internal = edges.filter((e) => mine.has(e.from) && mine.has(e.to));
  const tunnels = edges.filter((e) => mine.has(e.from) !== mine.has(e.to)).map((e) => {
    const core2End = mine.has(e.from) ? e.from : e.to;
    const core1End = mine.has(e.from) ? e.to : e.from;
    return { ...e, core2End, core1End, core1Division: byId.get(core1End)?.division || 'govern' };
  });

  return {
    divisions: CORE2_DIVISIONS.map((d) => ({
      ...d,
      departments: d.departments.map((id) => byId.get(id)).filter(Boolean),
    })),
    internal,
    tunnels,
    core1: DIVISIONS.map((d) => ({
      ...d,
      count: sections.filter((s) => s.division === d.id && !mine.has(s.id)).length,
      touched: tunnels.some((t) => t.core1Division === d.id),
    })),
    audit: {
      // Every Core 2 department must be reachable across the seam: an
      // enterprise module with no tunnel is an island wearing a map.
      isolated: [...mine].filter((id) => byId.has(id) && !tunnels.some((t) => t.core2End === id) && !internal.some((e) => e.from === id || e.to === id)),
    },
  };
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
 * The eight surfaces — what somebody is trying to do, rather than which
 * department owns the answer.
 *
 * A hundred and forty departments is the right number for a company and the
 * wrong number for a menu. The divisions above are an org chart: they say who
 * something belongs to. These say what you came here for, which is a different
 * question and the only one a person actually asks. Nothing is removed and
 * nothing is renamed — every department keeps its page, its route and its
 * division, and gains one line saying which door you reach it through.
 *
 * The mapping is data rather than layout for one reason: a menu written in
 * markup can be edited to disagree with the catalogue and nobody finds out.
 * This can be counted. The launch audit checks that every department belongs
 * to exactly one surface, so a new department that nobody filed shows up as a
 * blocker rather than as a page you can only reach by typing its URL.
 */
/**
 * The two cores, as navigation.
 *
 * §2 of the Core 2 directive keeps the galaxies apart in the data: the AI core
 * thinks and acts, the enterprise core records what is true, and nothing
 * crosses but the declared tunnels. The menu was the last place they were still
 * mixed — an HR record and a run queue sitting under one heading because both
 * happened to involve people.
 *
 * So a surface belongs to exactly one core, and the rail shows one core at a
 * time. Not a cosmetic split: it is the same boundary the bridges enforce, made
 * visible to the person using it.
 */
export const CORES = [
  { id: 'core1', label: 'AI core', hint: 'Thinks and acts — the workforce, the work, and everything it reaches.' },
  { id: 'core2', label: 'Enterprise core', hint: 'Records what is true — people, time, money paid, and what is kept.' },
];

export const SURFACES = [
  {
    id: 'ask',
    core: 'core1',
    label: 'Ask AlphaCore',
    hint: 'Say what you need. The company works out which departments are involved.',
    // The three things an open-ended question can become. Ask routes to these
    // and nothing else — see src/ask.js for the rules.
    departments: ['requests', 'hunt', 'chat'],
  },
  {
    id: 'work',
    core: 'core1',
    label: 'Work',
    hint: 'Make something: the workforce, the queue, and everything being built.',
    departments: [
      'agents', 'workforce', 'runs', 'pipelines', 'providers', 'artifacts', 'capacity', 'workstreams', 'tiers',
      'systems', 'infra', 'products', 'journeys', 'projects', 'tasks', 'lab', 'releases', 'sprints', 'packages',
      'jobs', 'deadletter',
    ],
  },
  {
    id: 'engineering',
    core: 'core1',
    label: 'Engineering',
    hint: 'Write code, review it, keep it on GitHub, and build whole apps from a paragraph.',
    departments: ['forge', 'studio', 'appbuilder', 'reviews', 'github', 'engmetrics', 'sites'],
  },
  {
    id: 'ship',
    core: 'core1',
    label: 'Ship & run',
    hint: 'Put software on servers, keep it up, and know when it falls over.',
    departments: ['deploys', 'servers', 'monitors'],
  },
  {
    id: 'approvals',
    core: 'core1',
    label: 'Approvals',
    hint: 'Everything stopped, waiting for a person to decide.',
    departments: ['gate', 'decisions', 'budgets', 'risks', 'quality', 'evals', 'pmo', 'auditor', 'simulation', 'approvals'],
  },
  {
    id: 'company',
    core: 'core1',
    label: 'Company',
    hint: 'The company\'s own record: how it governs itself, and what it owes.',
    departments: [
      'standing', 'harmony', 'autopilot', 'governance', 'oversight', 'scorecard', 'users', 'settings', 'audit',
      'constitution', 'timemachine', 'observe', 'anchors', 'datagov', 'roles', 'observability', 'backups',
      'board', 'ir', 'comms', 'chief',
      'security', 'compliance', 'sustainability', 'provenance', 'redteam', 'erasure', 'privacy', 'trustcentre',
      'continuity', 'incidents', 'assets', 'legal', 'vendors', 'objectives', 'ip',
    ],
  },
  {
    id: 'intelligence',
    core: 'core1',
    label: 'Intelligence',
    hint: 'Find something out — about a market, a company, or your own records.',
    departments: ['intel', 'segments', 'data', 'archive', 'knowledge', 'insights', 'kgraph', 'embeddings'],
  },
  {
    id: 'money',
    core: 'core1',
    label: 'Money',
    hint: 'Money in, money out, and what everything cost.',
    departments: [
      'finance', 'finreports', 'ledger', 'bookkeeper', 'economics', 'finops', 'treasury', 'money', 'tax',
      'pricing', 'success', 'sales', 'customers', 'relations', 'procurement', 'revenue', 'partnerships',
    ],
  },
  {
    id: 'people',
    core: 'core1',
    label: 'People',
    hint: 'The workforce, human and synthetic — and how it gets better.',
    departments: ['crew', 'people', 'org', 'society', 'disputes', 'enablement', 'recruiting', 'academy', 'memory', 'skills', 'offices'],
  },
  {
    id: 'world',
    core: 'core1',
    label: 'World',
    hint: 'Anything that reaches a person outside this company.',
    departments: [
      'localization', 'social', 'content', 'design', 'marketing', 'marketwatch', 'mkt', 'brand', 'personas',
      'positioning', 'seo', 'paidmedia', 'lifecycle', 'calendar', 'events', 'press', 'community', 'attribution',
      'pages', 'mktops', 'growth',
      'browser', 'connectors', 'egress', 'vault', 'web', 'mcp', 'tenants', 'keys', 'webhooks',
      'support', 'contact', 'help', 'status', 'deliverability',
    ],
  },
];

/**
 * The enterprise core's surfaces.
 *
 * Grouped by what somebody is trying to do rather than by which module owns the
 * table: "who works here" is one errand whether it lands in the org chart or in
 * the talent pipeline. The bridges get their own heading because the seam is the
 * one thing about Core 2 that is worth looking at on purpose.
 */
export const CORE2_SURFACES = [
  {
    id: 'e-people',
    core: 'core2',
    label: 'People & HR',
    hint: 'Who works here, where they sit, and who is joining.',
    departments: ['workforce2', 'orgchart', 'talent2', 'comp', 'me'],
  },
  {
    id: 'e-time',
    core: 'core2',
    label: 'Time & attendance',
    hint: 'Who was here, who is on leave, and what was agreed.',
    departments: ['time', 'shifts', 'hrops', 'joining'],
  },
  {
    id: 'e-money',
    core: 'core2',
    label: 'Payroll & spending',
    hint: 'What people are paid, what they claimed, and what was bought.',
    departments: ['finops2', 'payrules', 'budgets2', 'payables', 'receivables', 'fixedassets', 'bank', 'procure', 'custody'],
  },
  {
    id: 'e-records',
    core: 'core2',
    label: 'Documents & records',
    hint: 'What is written down, what is attached to it, and how long it is kept.',
    departments: ['docs', 'files', 'records', 'meetings', 'secretariat', 'legalcases', 'regulatory'],
  },
  {
    id: 'e-ops',
    core: 'core2',
    label: 'Operations',
    hint: 'Stock, work orders, vehicles, rooms, and the desk you call when something breaks.',
    departments: ['inventory', 'facilities', 'helpdesk'],
  },
  {
    id: 'e-seam',
    core: 'core2',
    label: 'The seam',
    hint: 'The map of both cores, and everything that crosses between them.',
    departments: ['map2', 'bridges'],
  },
];

/** One catalogue. Two cores is a property of the rows, not two lists. */
export const ALL_SURFACES = [...SURFACES, ...CORE2_SURFACES];

const SURFACE_OF = new Map(ALL_SURFACES.flatMap((s) => s.departments.map((d) => [d, s.id])));

/** Which door does this department sit behind? */
export const surfaceOf = (deptId) => SURFACE_OF.get(deptId) || null;

/**
 * The check the launch audit runs, and the reason this is data.
 *
 * Two failures are possible and both are silent without this: a department in
 * the catalogue that no surface lists, which is a page reachable only by typing
 * its URL; and a department listed by two surfaces, which is a menu that
 * disagrees with itself. Packages install new sections at runtime, so this
 * cannot be a check that only runs at build time.
 */
export function surfaceAudit() {
  const sections = sectionCatalog();
  const listed = ALL_SURFACES.flatMap((s) => s.departments);
  const counts = new Map();
  for (const d of listed) counts.set(d, (counts.get(d) || 0) + 1);

  const known = new Set(sections.map((s) => s.id));
  return {
    departments: sections.length,
    surfaces: ALL_SURFACES.length,
    // Filed nowhere: reachable only by URL.
    unfiled: sections.filter((s) => !SURFACE_OF.has(s.id)).map((s) => s.id),
    // Filed twice: the menu disagrees with itself.
    duplicated: [...counts.entries()].filter(([, n]) => n > 1).map(([d]) => d),
    // Filed but gone: a surface pointing at a department that no longer exists.
    dangling: listed.filter((d) => !known.has(d)),
  };
}

/** The surfaces with their departments resolved, for the navigation to draw. */
export function surfaceCatalog() {
  const sections = sectionCatalog();
  const by = new Map(sections.map((s) => [s.id, s]));
  return ALL_SURFACES.map((s) => ({
    id: s.id,
    // Which core it belongs to. The console shows one at a time, and a surface
    // that did not say would land in whichever came first.
    core: s.core || 'core1',
    label: s.label,
    hint: s.hint,
    departments: s.departments.map((d) => by.get(d)).filter(Boolean),
    // The number people actually navigate by: how much is in there.
    count: s.departments.reduce((a, d) => a + (by.get(d)?.count || 0), 0),
  }));
}

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
  // An edge naming a department that does not exist contributes nothing to
  // anybody's degree and was, until it was measured, completely invisible: the
  // loop above skips unknown ids without a word. Five had accumulated. A map
  // that quietly drops the relationships it cannot resolve is worse than one
  // with none, because it looks complete.
  const known = new Set(sections.map((s) => s.id));
  const dangling = edges
    .filter((e) => e.from !== 'all' && e.to !== 'all')
    .filter((e) => !known.has(e.from) || !known.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, missing: !known.has(e.from) ? e.from : e.to, label: e.label }));

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
    dangling,
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
  const soft = (sql) => { try { return n(sql); } catch { return 0; } };

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
    'crew.plan': ['crew', 'drafts work plans for the human team'],
    'forge.change': ['forge', 'asks an engineer to change a project'],
    'monitor.watch': ['monitors', 'starts watching a site'],
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
    edge('forge', 'runs', 'engineers propose code as change sets', soft('SELECT COUNT(*) AS n FROM forge_changes'), '#/forge'),
    edge('sites', 'forge', 'websites built as factory projects', soft("SELECT COUNT(*) AS n FROM forge_projects WHERE kind = 'website'"), '#/sites'),
    edge('sites', 'deploys', 'websites published to a server', soft("SELECT COUNT(*) AS n FROM dep_targets t JOIN forge_projects p ON p.id = t.project_id WHERE p.kind = 'website'"), '#/deploys'),
    edge('forge', 'deploys', 'projects shipped to a server', soft('SELECT COUNT(*) AS n FROM dep_targets'), '#/deploys'),
    // The engineering floor. Each edge names something the code does.
    edge('studio', 'forge', 'files edited and committed with a message a person wrote', soft("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('forge.committed','forge.file_renamed','forge.branch_created')"), '#/studio'),
    edge('studio', 'runs', 'the pair programmer answers through the run queue', soft('SELECT COUNT(*) AS n FROM eng_assist WHERE run_id IS NOT NULL'), '#/studio'),
    edge('reviews', 'runs', 'reviewers from another model family read the code', soft('SELECT COUNT(*) AS n FROM eng_review_runs'), '#/reviews', 'review'),
    edge('reviews', 'forge', 'findings handed back to an engineer as a change set', soft('SELECT COUNT(*) AS n FROM eng_findings WHERE change_id IS NOT NULL'), '#/reviews', 'loop'),
    edge('reviews', 'deploys', 'the quality gate rides on every production release', soft("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('deploy.release_started','deploy.release_requested') AND payload LIKE '%\"gate\":{%'"), '#/reviews', 'gate'),
    edge('github', 'forge', 'repositories cloned into the factory', soft('SELECT COUNT(*) AS n FROM gh_repos WHERE project_id IS NOT NULL'), '#/github'),
    edge('github', 'reviews', 'pull requests read by the review board', soft('SELECT COUNT(*) AS n FROM gh_pulls WHERE review_id IS NOT NULL'), '#/github', 'review'),
    edge('github', 'egress', 'every call, clone and push through the one gate', soft("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'github'"), '#/egress', 'gate'),
    edge('appbuilder', 'runs', 'a product manager and an architect write the plan', soft("SELECT COUNT(*) AS n FROM runs WHERE task_type LIKE 'appbuild:%'"), '#/appbuilder'),
    edge('appbuilder', 'forge', 'apps built milestone by milestone as change sets', soft('SELECT COUNT(*) AS n FROM app_builds WHERE project_id IS NOT NULL'), '#/appbuilder'),
    edge('appbuilder', 'reviews', 'a finished app read by the board before it is called ready', soft('SELECT COUNT(*) AS n FROM app_builds WHERE review_id IS NOT NULL'), '#/appbuilder', 'review'),
    edge('engmetrics', 'deploys', 'release frequency and failure rate measured', soft('SELECT COUNT(*) AS n FROM dep_releases'), '#/engmetrics', 'review'),
    edge('engmetrics', 'incidents', 'time to restore measured from the incident log', soft('SELECT COUNT(*) AS n FROM incidents WHERE resolved_at IS NOT NULL'), '#/engmetrics', 'review'),
    edge('engmetrics', 'forge', 'lead time measured from change sets', soft("SELECT COUNT(*) AS n FROM forge_changes WHERE state = 'applied'"), '#/engmetrics', 'review'),
    edge('deploys', 'servers', 'releases landed on a machine', soft('SELECT COUNT(*) AS n FROM dep_releases'), '#/servers'),
    edge('deploys', 'monitors', 'live sites watched without being asked', soft('SELECT COUNT(*) AS n FROM mon_checks WHERE target_ref IS NOT NULL'), '#/monitors'),
    edge('monitors', 'servers', 'machines held to their thresholds', soft("SELECT COUNT(*) AS n FROM mon_checks WHERE kind = 'server'"), '#/monitors', 'review'),
    edge('monitors', 'incidents', 'outages opened as incidents', soft("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'monitor.down'"), '#/incidents'),
    edge('infra', 'servers', 'plans become machines', soft('SELECT COUNT(*) AS n FROM srv_servers'), '#/servers'),
    edge('servers', 'gate', 'an AI may ask to run a command; a person decides', soft("SELECT COUNT(*) AS n FROM srv_commands WHERE requested_by NOT LIKE 'human:%'"), '#/servers', 'gate'),
    edge('crew', 'people', 'human staff directed day to day', soft('SELECT COUNT(*) AS n FROM crew_assignments'), '#/crew'),
    edge('crew', 'runs', 'plans drafted by the program manager', soft('SELECT COUNT(*) AS n FROM crew_plans'), '#/crew'),
    edge('crew', 'workforce2', 'assignments go to employees on the roster', soft("SELECT COUNT(DISTINCT employee_id) AS n FROM crew_assignments"), '#/workforce2'),
    edge('systems', 'infra', 'infrastructure planned from a blueprint', n('SELECT COUNT(*) AS n FROM infra_plans WHERE blueprint_id IS NOT NULL'), '#/infra'),
    edge('systems', 'products', 'specification packages for products', n('SELECT COUNT(*) AS n FROM blueprints WHERE product_id IS NOT NULL'), '#/systems'),
    edge('systems', 'runs', 'blueprint documents written by agents', n('SELECT COUNT(*) AS n FROM blueprint_docs WHERE run_id IS NOT NULL'), '#/runs'),
    edge('finreports', 'finance', 'reports built on the live ledger', n("SELECT COUNT(*) AS n FROM fin_reports WHERE subject = 'own'"), '#/finance'),
    edge('bookkeeper', 'ledger', 'entries written by an AI employee', n("SELECT COUNT(*) AS n FROM journal WHERE created_by LIKE 'agent:%'"), '#/ledger'),
    edge('treasury', 'bookkeeper', 'invoices and payouts turned into entries', n("SELECT COUNT(*) AS n FROM ledger_marks WHERE source LIKE 'invoice%' OR source = 'payout'"), '#/bookkeeper'),
    edge('finance', 'bookkeeper', 'model spend accrued to the books', n("SELECT COUNT(*) AS n FROM ledger_marks WHERE source = 'model-spend'"), '#/bookkeeper'),
    edge('ledger', 'finreports', 'statements drawn from real entries', n("SELECT COUNT(*) AS n FROM journal WHERE state = 'posted'"), '#/finreports'),
    edge('ledger', 'audit', 'every posting on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'journal.%' OR action LIKE 'ledger.%'"), '#/audit'),
    edge('hunt', 'kgraph', 'the knowledge graph, asked every round', n('SELECT COUNT(*) AS n FROM hunt_rounds'), '#/graph'),
    edge('hunt', 'web', 'hunts that reached outside', n("SELECT COUNT(*) AS n FROM hunts WHERE max_usd > 0"), '#/web'),
    edge('hunt', 'memory', 'what the agents already knew', n('SELECT COUNT(*) AS n FROM hunts'), '#/memory'),
    edge('hunt', 'audit', 'every hunt recorded, found or not', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'hunt.finished'"), '#/audit'),
    edge('browser', 'web', 'pages the employees drove rather than read', n('SELECT COUNT(*) AS n FROM browser_steps'), '#/web'),
    edge('browser', 'approvals', 'steps stopped for a person to sign', n('SELECT COUNT(*) AS n FROM browser_steps WHERE gated = 1'), '#/approvals'),
    edge('browser', 'vault', 'credentials typed without passing through a model', n("SELECT COUNT(*) AS n FROM browser_steps WHERE action LIKE '%«%'"), '#/vault'),
    edge('browser', 'audit', 'every session and every signature on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'browser.%'"), '#/audit'),
    edge('hunt', 'browser', 'questions the open web could not answer by reading', n("SELECT COUNT(*) AS n FROM browser_sessions"), '#/browser'),

    // The new departments, joined to what they actually draw on.
    edge('economics', 'runs', 'every run priced, per employee', n('SELECT COUNT(*) AS n FROM runs WHERE cost_usd > 0'), '#/runs'),
    edge('economics', 'ledger', 'checked against the books, and it says when they disagree', n("SELECT COUNT(*) AS n FROM journal WHERE state = 'posted'"), '#/ledger'),
    edge('economics', 'customers', 'what each account costs to serve', n('SELECT COUNT(*) AS n FROM customers'), '#/customers'),
    edge('standing', 'hunt', 'questions asked on a schedule', n("SELECT COUNT(*) AS n FROM standing_orders WHERE kind = 'hunt'"), '#/hunt'),
    edge('standing', 'browser', 'web work done on a schedule, still stopping at the commit', n("SELECT COUNT(*) AS n FROM standing_orders WHERE kind = 'browse'"), '#/browser'),
    edge('standing', 'bookkeeper', 'the books kept up to date without being asked', n("SELECT COUNT(*) AS n FROM standing_orders WHERE kind = 'bookkeep'"), '#/bookkeeper'),
    edge('standing', 'requests', 'work opened at the desk on a schedule', n("SELECT COUNT(*) AS n FROM standing_orders WHERE kind = 'request'"), '#/requests'),
    edge('deadletter', 'runs', 'runs that failed for good', n('SELECT COUNT(*) AS n FROM dead_letter'), '#/runs'),
    edge('deadletter', 'jobs', 'what the queue could not finish', n('SELECT COUNT(*) AS n FROM dead_letter'), '#/jobs'),
    edge('continuity', 'backups', 'whether a copy has left this machine', n('SELECT COUNT(*) AS n FROM backups'), '#/backups'),
    edge('continuity', 'incidents', 'how a person is reached at 3am', n('SELECT COUNT(*) AS n FROM incidents'), '#/incidents'),

    // Thirteen pairs of divisions had no declared relationship at all. Each of
    // these is a link that already exists in the data and was simply never
    // written down — not a decoration added to make the map look connected.
    edge('economics', 'agents', 'what each employee costs to run', n("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"), '#/agents'),                                    // capital ↔ engine
    edge('finops', 'runs', 'spend traced back to the work that caused it', n('SELECT COUNT(*) AS n FROM model_calls WHERE run_id IS NOT NULL'), '#/runs'),                         // capital ↔ engine
    edge('economics', 'products', 'what a product costs to build and run', n('SELECT COUNT(*) AS n FROM products'), '#/products'),                                                 // build ↔ capital
    edge('quality', 'releases', 'nothing ships without its quality gate', n('SELECT COUNT(*) AS n FROM releases'), '#/releases'),                                                  // build ↔ trust
    edge('releases', 'board', 'what shipped, reported upward', n('SELECT COUNT(*) AS n FROM releases'), '#/board'),                                                                // build ↔ exec
    edge('releases', 'egress', 'a release is the company reaching the outside', n("SELECT COUNT(*) AS n FROM egress_log WHERE capability LIKE 'repo%' OR capability LIKE 'deploy%'"), '#/egress'), // build ↔ world
    edge('data', 'decisions', 'decisions standing on evidence somebody can re-check rather than on a summary', n('SELECT COUNT(*) AS n FROM decisions'), '#/decisions'),        // data ↔ decide
    edge('archive', 'evals', "yesterday's work, kept so today's can be scored against it", n('SELECT COUNT(*) AS n FROM archive_items'), '#/evals'),                              // data ↔ decide
    edge('releases', 'security', 'nothing ships without somebody looking at what it opens', n('SELECT COUNT(*) AS n FROM releases'), '#/security'),                              // build ↔ trust
    edge('products', 'compliance', 'what each product promises about the data it holds', n('SELECT COUNT(*) AS n FROM products'), '#/compliance'),                               // build ↔ trust
    edge('customers', 'people', 'who is answerable for which account, by name', n('SELECT COUNT(*) AS n FROM customers'), '#/people'),                                           // commerce ↔ talent
    edge('success', 'academy', 'what customers keep asking becomes what the company teaches', n('SELECT COUNT(*) AS n FROM customer_health'), '#/academy'),                      // commerce ↔ talent
    edge('incidents', 'people', 'who is on the hook when it breaks at 3am', n('SELECT COUNT(*) AS n FROM incidents'), '#/people'),                                               // operate ↔ talent
    edge('support', 'academy', 'the questions that keep coming back become training', n('SELECT COUNT(*) AS n FROM tickets'), '#/academy'),                                      // operate ↔ talent
    edge('customers', 'workforce', 'who is answerable for which account', n('SELECT COUNT(*) AS n FROM customers'), '#/workforce'),                                                // commerce ↔ talent
    edge('customers', 'compliance', 'what we promised each customer about their data', n('SELECT COUNT(*) AS n FROM contracts'), '#/compliance'),                                  // commerce ↔ trust
    edge('sales', 'board', 'the pipeline the board actually asks about', n("SELECT COUNT(*) AS n FROM deals WHERE stage NOT IN ('lost')"), '#/board'),                              // commerce ↔ exec
    edge('treasury', 'egress', 'money only leaves through the one door, signed by a person', n('SELECT COUNT(*) AS n FROM payouts'), '#/egress'),                                  // capital ↔ world
    edge('incidents', 'workforce', 'who is on the hook when it breaks', n('SELECT COUNT(*) AS n FROM incidents'), '#/workforce'),                                                  // operate ↔ talent
    edge('people', 'security', 'who holds which key, reviewed rather than assumed', n('SELECT COUNT(*) AS n FROM users'), '#/security'),                                           // talent ↔ trust
    edge('board', 'egress', 'what the company sent outside, where the board can see it', n('SELECT COUNT(*) AS n FROM egress_log'), '#/egress'),                                   // exec ↔ world
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

    // Core 2, joined to the company rather than floating beside it. Each of
    // these is a relationship the code actually carries out — a declared edge
    // with nothing behind it is the failure this audit exists to catch, and it
    // caught these three the first time they were added without them.
    edge('workforce2', 'people', 'the same human, once in the record and once on the roster', n('SELECT COUNT(*) AS n FROM hr_person'), '#/workforce2'),
    edge('workforce2', 'orgchart', 'every employment sits in a unit and under a reporting line', n('SELECT COUNT(*) AS n FROM hr_employee'), '#/orgchart'),
    edge('workforce2', 'erasure', 'a salary and a national id are sealed under the person\'s own key', n('SELECT COUNT(*) AS n FROM hr_person WHERE subject_ref IS NOT NULL'), '#/erasure'),
    edge('orgchart', 'users', 'a person may hold a login; a login always belongs to a person', n('SELECT COUNT(*) AS n FROM users WHERE person_id IS NOT NULL'), '#/users'),
    edge('bridges', 'egress', 'every call into the enterprise core passes the same gate as an outside one', n("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'enterprise-core'"), '#/egress'),
    edge('bridges', 'gate', 'a termination or a payroll approval waits for a person, whatever the amount', n("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'enterprise-core' AND verdict = 'gated'"), '#/gate'),
    edge('finops2', 'ledger', 'a closed run and a paid expense become balanced entries in the one ledger', n("SELECT COUNT(*) AS n FROM journal WHERE source = 'core2'"), '#/ledger'),
    edge('finops2', 'gate', 'approving payroll is categorically gated — amount is irrelevant', n("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'enterprise-core' AND verdict = 'gated'"), '#/gate'),
    edge('procure', 'vendors', 'every purchase names a vendor from the one vendor record', n('SELECT COUNT(*) AS n FROM proc_request WHERE vendor_id IS NOT NULL'), '#/vendors'),
    edge('procure', 'legal', 'the expiry watch announces a contract before it lapses', n('SELECT COUNT(*) AS n FROM contracts WHERE expires_at IS NOT NULL'), '#/legal'),
    edge('talent2', 'workforce2', 'hiring converts an application into an employment through the one door', n("SELECT COUNT(*) AS n FROM rec_application WHERE state = 'hired'"), '#/workforce2'),
    edge('talent2', 'recruiting', 'two species, two pipelines, one department of hiring', n('SELECT COUNT(*) AS n FROM rec_vacancy'), '#/recruiting'),
    edge('talent2', 'docs', 'CVs and disciplinary records are sealed documents, never columns', n('SELECT COUNT(*) AS n FROM rec_application WHERE doc_id IS NOT NULL'), '#/docs'),
    edge('time', 'workforce2', 'every request and every mark belongs to an employment', n('SELECT COUNT(*) AS n FROM time_leave_request'), '#/time'),
    edge('time', 'docs', 'a sick request points at a sealed document, never at a diagnosis', n('SELECT COUNT(*) AS n FROM time_leave_request WHERE doc_id IS NOT NULL'), '#/docs'),
    edge('meetings', 'workforce2', 'participants of record are employments — never agents', n('SELECT COUNT(*) AS n FROM mtg_participant'), '#/meetings'),
    edge('meetings', 'erasure', 'a transcript is sealed under its organizer and dies with their key', n("SELECT COUNT(*) AS n FROM mtg_meeting WHERE transcript LIKE 'pii:1:%'"), '#/erasure'),
    edge('docs', 'workforce2', 'a restricted document names the person it is about', n('SELECT COUNT(*) AS n FROM doc_document WHERE subject_person_id IS NOT NULL'), '#/docs'),
    edge('docs', 'erasure', 'sealed versions die with their subject`s key', n("SELECT COUNT(*) AS n FROM doc_version WHERE body LIKE 'pii:1:%'"), '#/erasure'),
    // `graph` is a surface, not a department, so an edge could not name it and
    // was silently dropped. The claim is still true and still checkable against
    // a department: the knowledge graph and this map are drawn from one
    // catalogue, so they cannot disagree. The link still opens the first map.
    edge('files', 'docs', 'the scan behind a document, rather than a retyped summary of it', n("SELECT COUNT(*) AS n FROM doc_file WHERE attach_type = 'document'"), '#/docs'),
    edge('files', 'erasure', 'erasing a person destroys their files, because the key went with them', n('SELECT COUNT(*) AS n FROM doc_file'), '#/erasure'),
    edge('files', 'workforce2', 'what is on an employee\'s file', n("SELECT COUNT(*) AS n FROM doc_file WHERE attach_type IN ('person','employee')"), '#/workforce2'),
    edge('records', 'erasure', 'a legal hold outranks a request to be forgotten, and says so in writing', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'erasure.refused_hold'"), '#/erasure'),
    edge('records', 'compliance', 'the schedule somebody has to be able to defend', n('SELECT COUNT(*) AS n FROM rec_class'), '#/compliance'),
    edge('records', 'files', 'files are disposed of under the same schedule as everything else', n('SELECT COUNT(*) AS n FROM rec_disposal'), '#/files'),
    edge('shifts', 'time', 'attendance judged against the roster in force that day', n('SELECT COUNT(*) AS n FROM time_shift_assignment'), '#/time'),
    edge('shifts', 'finops2', 'approved overtime is the only kind payroll sees', n("SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'approved'"), '#/finops2'),
    edge('payrules', 'finops2', 'every line on a slip comes from a declared rule', n('SELECT COUNT(*) AS n FROM pay_rule WHERE active = 1'), '#/finops2'),
    edge('payrules', 'workforce2', 'what somebody is owed when they leave', n("SELECT COUNT(*) AS n FROM hr_employee WHERE state != 'active'"), '#/workforce2'),
    edge('custody', 'assets', 'the register says what we own; this says who has it', n('SELECT COUNT(*) AS n FROM cust_item'), '#/assets'),
    edge('custody', 'joining', 'a leaving cannot close while anything is still out', n('SELECT COUNT(*) AS n FROM cust_item WHERE returned_at IS NULL'), '#/joining'),
    edge('joining', 'workforce2', 'a first day and a last day, per employee', n('SELECT COUNT(*) AS n FROM join_list'), '#/workforce2'),
    edge('joining', 'records', 'what is kept when somebody leaves, and for how long', n('SELECT COUNT(*) AS n FROM rec_class'), '#/records'),
    edge('records', 'audit', 'every hold, release and disposal on the chain', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'records.%'"), '#/audit'),
    edge('map2', 'kgraph', 'two projections of one catalogue — the maps cannot disagree', n('SELECT COUNT(*) AS n FROM graph_nodes'), '#/graph'),
    edge('map2', 'bridges', 'every tunnel drawn is a declared edge the audit checks', n("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'enterprise-core'"), '#/bridges'),
    edge('bridges', 'audit', 'the consequential subset of enterprise events is written to the chain', n("SELECT COUNT(*) AS n FROM core2_log WHERE chained = 1"), '#/audit'),

    // The rest of the enterprise core. Every department below has at least one
    // tunnel into the AI core and one internal edge, so the second map can
    // never show it as an island and the connectivity audit never as an orphan.
    edge('hrops', 'time', 'a shift is what lateness and absence are measured against', n('SELECT COUNT(*) AS n FROM time_shift_assignment'), '#/time'),
    edge('hrops', 'finops2', 'approved overtime is a line on the slip', n("SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'approved'"), '#/finops2'),
    edge('hrops', 'gate', 'an overtime claim and a correction wait for a manager', n("SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'pending'"), '#/gate', 'gate'),
    edge('comp', 'workforce2', 'a raise, a promotion and an end of service are facts about an employment', n('SELECT COUNT(*) AS n FROM hr_salary_change'), '#/workforce2'),
    edge('comp', 'finops2', 'allowances and plan contributions are lines the payroll formula reads', n('SELECT COUNT(*) AS n FROM hr_allowance'), '#/finops2'),
    edge('comp', 'payrules', 'the tax on a slip and the days owed at the end come from the declared rules', n('SELECT COUNT(*) AS n FROM hr_eos'), '#/payrules'),
    edge('comp', 'erasure', 'salary history and end of service are sealed under the person', n('SELECT COUNT(*) AS n FROM hr_salary_change WHERE subject_ref IS NOT NULL'), '#/erasure'),
    edge('comp', 'gate', 'changing a salary is categorically a human act', n("SELECT COUNT(*) AS n FROM egress_log WHERE connector = 'enterprise-core' AND verdict = 'gated'"), '#/gate', 'gate'),
    edge('comp', 'docs', 'a grievance is a sealed document with a state machine', n('SELECT COUNT(*) AS n FROM hr_grievance'), '#/docs'),
    edge('comp', 'custody', 'who holds which of the company\'s things is custody\'s register; a leaving reads it', n('SELECT COUNT(*) AS n FROM cust_item'), '#/custody'),
    edge('me', 'workforce2', 'the page about you is your employment, read through your login', n('SELECT COUNT(*) AS n FROM users WHERE person_id IS NOT NULL'), '#/workforce2'),
    edge('me', 'users', 'a login that is a person sees their own record and nobody else\'s', n('SELECT COUNT(*) AS n FROM users WHERE person_id IS NOT NULL'), '#/users'),
    edge('me', 'time', 'your day and your leave, from the same tables the manager sees', n('SELECT COUNT(*) AS n FROM time_attendance'), '#/time'),
    edge('budgets2', 'ledger', 'actuals are read from the posted journal, never re-typed', n('SELECT COUNT(*) AS n FROM fin_budget_line'), '#/ledger'),
    edge('budgets2', 'finops2', 'a cost-center line measures the spend the center records', n('SELECT COUNT(*) AS n FROM fin_budget_line WHERE cost_center_id IS NOT NULL'), '#/finops2'),
    edge('budgets2', 'gate', 'adopting a budget is a human act', n("SELECT COUNT(*) AS n FROM fin_budget WHERE state = 'approved'"), '#/gate', 'gate'),
    edge('payables', 'vendors', 'a bill names a vendor on Core 1\'s register', n('SELECT COUNT(*) AS n FROM fin_ap_bill'), '#/vendors'),
    edge('payables', 'ledger', 'approved is a debt; paid clears it — two entries through the bridge', n("SELECT COUNT(*) AS n FROM journal WHERE source = 'core2' AND source_id LIKE 'bill-%'"), '#/ledger'),
    edge('payables', 'bank', 'a bill is paid from an account, by cheque or in a batch', n("SELECT COUNT(*) AS n FROM bank_payment_item WHERE bill_id IS NOT NULL"), '#/bank'),
    edge('payables', 'procure', 'procurement invoices and vendor bills are two doors onto one liability', n('SELECT COUNT(*) AS n FROM proc_request WHERE state IN (\'invoiced\',\'paid\')'), '#/procure'),
    edge('receivables', 'customers', 'an invoice names a customer in Core 1\'s CRM', n('SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE customer_id IS NOT NULL'), '#/customers'),
    edge('receivables', 'ledger', 'issued is revenue owed; a receipt moves it to cash', n("SELECT COUNT(*) AS n FROM journal WHERE source = 'core2' AND source_id LIKE 'ar-%'"), '#/ledger'),
    edge('receivables', 'treasury', 'fiat invoices here, crypto invoices there — two kinds of money, two proofs', n('SELECT COUNT(*) AS n FROM invoices'), '#/treasury'),
    edge('receivables', 'tax', 'tax on an invoice lands in the same payable the tax desk files', n('SELECT COUNT(*) AS n FROM fin_ar_invoice WHERE tax > 0'), '#/tax'),
    edge('fixedassets', 'ledger', 'a month of depreciation is one balanced entry', n("SELECT COUNT(*) AS n FROM journal WHERE source = 'core2' AND source_id LIKE 'dep-%'"), '#/ledger'),
    edge('fixedassets', 'assets', 'a device on Core 1\'s register may also be a capitalised asset here', n('SELECT COUNT(*) AS n FROM fin_fixed_asset WHERE core1_asset_id IS NOT NULL'), '#/assets'),
    edge('fixedassets', 'facilities', 'a work order names the asset it maintains', n("SELECT COUNT(*) AS n FROM ops_workorder WHERE target_kind = 'fixed_asset'"), '#/facilities'),
    edge('fixedassets', 'gate', 'writing an asset off is a human act', n("SELECT COUNT(*) AS n FROM fin_fixed_asset WHERE state = 'disposed'"), '#/gate', 'gate'),
    edge('bank', 'ledger', 'each account is its own line under 1000 — the balance is the ledger\'s', n("SELECT COUNT(*) AS n FROM accounts WHERE parent_code = '1000' AND code LIKE '10__'"), '#/ledger'),
    edge('bank', 'finops2', 'a payroll run leaves the bank as a batch, one sealed line per slip', n("SELECT COUNT(*) AS n FROM bank_payment_batch WHERE kind = 'payroll'"), '#/finops2'),
    edge('bank', 'treasury', 'the fiat bank beside the crypto wallets — one cash position, two currencies of proof', n('SELECT COUNT(*) AS n FROM bank_account'), '#/treasury'),
    edge('bank', 'gate', 'opening an account, executing a transfer and releasing a batch are human acts', n("SELECT COUNT(*) AS n FROM bank_transfer WHERE state = 'executed'"), '#/gate', 'gate'),
    edge('bank', 'erasure', 'a payment line naming an employee is sealed under them', n('SELECT COUNT(*) AS n FROM bank_payment_item WHERE subject_ref IS NOT NULL'), '#/erasure'),
    edge('bank', 'audit', 'a released batch and an executed transfer are chained', n("SELECT COUNT(*) AS n FROM bank_payment_batch WHERE state = 'released'"), '#/audit', 'audit'),
    edge('inventory', 'procure', 'goods are received against a delivered procurement', n('SELECT COUNT(*) AS n FROM ops_stock_move WHERE proc_request_id IS NOT NULL'), '#/procure'),
    edge('inventory', 'oversight', 'an item below its minimum raises an event the company reacts to', n("SELECT COUNT(*) AS n FROM core2_log WHERE action = 'stock.low'"), '#/oversight'),
    edge('inventory', 'fixedassets', 'what is capitalised is not stock, and the two registers say which is which', n('SELECT COUNT(*) AS n FROM ops_item'), '#/fixedassets'),
    edge('facilities', 'meetings', 'a room booking may be a meeting\'s room', n('SELECT COUNT(*) AS n FROM ops_booking WHERE meeting_id IS NOT NULL'), '#/meetings'),
    edge('facilities', 'workforce2', 'a vehicle and a work order are held by an employment', n('SELECT COUNT(*) AS n FROM ops_vehicle WHERE assignee_employee_id IS NOT NULL'), '#/workforce2'),
    edge('facilities', 'incidents', 'a workplace incident is kept apart from a technical one — and both are incidents', n('SELECT COUNT(*) AS n FROM ops_incident'), '#/incidents'),
    edge('helpdesk', 'support', 'the internal desk beside the customer desk — two species of ticket', n('SELECT COUNT(*) AS n FROM ops_ticket'), '#/support'),
    edge('helpdesk', 'workforce2', 'requester and assignee are employments', n('SELECT COUNT(*) AS n FROM ops_ticket WHERE assignee_employee_id IS NOT NULL'), '#/workforce2'),
    edge('helpdesk', 'docs', 'an HR ticket\'s words are a document sealed under the requester', n('SELECT COUNT(*) AS n FROM ops_ticket WHERE doc_id IS NOT NULL'), '#/docs'),
    edge('helpdesk', 'oversight', 'a breached SLA is announced once', n('SELECT COUNT(*) AS n FROM ops_ticket WHERE breached = 1'), '#/oversight'),
    edge('secretariat', 'docs', 'every letter and resolution is a numbered document', n('SELECT COUNT(*) AS n FROM adm_letter WHERE doc_id IS NOT NULL'), '#/docs'),
    edge('secretariat', 'orgchart', 'a letter is routed to a unit; a committee is chaired by an employment', n('SELECT COUNT(*) AS n FROM adm_committee'), '#/orgchart'),
    edge('secretariat', 'board', 'an adopted resolution is a governance fact on the chain', n("SELECT COUNT(*) AS n FROM adm_resolution WHERE state = 'adopted'"), '#/board', 'audit'),
    edge('secretariat', 'decisions', 'a committee resolution and a registry decision are two records of one act', n('SELECT COUNT(*) AS n FROM adm_resolution'), '#/decisions'),
    edge('legalcases', 'legal', 'a case rests on a contract from Core 1\'s register', n('SELECT COUNT(*) AS n FROM adm_case WHERE contract_id IS NOT NULL'), '#/legal'),
    edge('legalcases', 'risks', 'open exposure is a risk with a number on it', n("SELECT COUNT(*) AS n FROM adm_case WHERE state IN ('open','hearing')"), '#/risks'),
    edge('legalcases', 'gate', 'concluding a case is a human act', n("SELECT COUNT(*) AS n FROM adm_case WHERE state IN ('settled','won','lost')"), '#/gate', 'gate'),
    edge('regulatory', 'compliance', 'the obligations calendar is what the compliance file is measured against', n('SELECT COUNT(*) AS n FROM adm_obligation'), '#/compliance'),
    edge('regulatory', 'assets', 'a company licence and a domain renewal are two clocks on one calendar', n('SELECT COUNT(*) AS n FROM adm_license'), '#/assets'),
    edge('regulatory', 'oversight', 'due and expiring are announced once a day', n("SELECT COUNT(*) AS n FROM core2_log WHERE action IN ('obligation.due','license.expiring')"), '#/oversight'),
    edge('regulatory', 'tax', 'a tax filing is an obligation with a due date', n("SELECT COUNT(*) AS n FROM adm_obligation WHERE authority LIKE '%tax%'"), '#/tax'),
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
    edge('auditor', 'governance', 'failed audits become problems to fix', n("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'fail'"), '#/governance', 'audit'),
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
    edge('constitution', 'users', 'only the owner amends the rules', n("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'constitution.%'"), '#/owner', 'gate'),
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
    edge('packages', 'kgraph', 'an installed department appears on the map like any other', n("SELECT COUNT(*) AS n FROM packages WHERE state = 'installed'"), '#/graph'),

    edge('anchors', 'audit', 'the height and hash a third party wrote down', n('SELECT COUNT(*) AS n FROM anchors WHERE ok = 1'), '#/audit', 'audit'),
    edge('anchors', 'egress', 'reaching a timestamping authority goes through the gate', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chain.anchored'"), '#/egress'),
    edge('anchors', 'oversight', 'a chain that no longer matches its witness is a finding, not a note', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chain.anchor_failed'"), '#/oversight', 'audit'),
    edge('erasure', 'vault', "each person's key is wrapped under the master key", n('SELECT COUNT(*) AS n FROM pii_subjects'), '#/vault'),
    edge('erasure', 'audit', 'the erasure is recorded; the identifier never is', n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pii.erased'"), '#/audit', 'audit'),
    edge('erasure', 'intel', 'the columns an erasure walks', n('SELECT COUNT(*) AS n FROM intel_records'), '#/intel'),
    edge('erasure', 'compliance', 'a request arrives there and is carried out here', n('SELECT COUNT(*) AS n FROM pii_subjects WHERE erased_at IS NOT NULL'), '#/compliance', 'gate'),
    // Declared only because the walk really reaches these columns. A department
    // that holds somebody's details and does not point here is a department
    // where an erasure quietly stops — which is how "a person can be forgotten"
    // becomes untrue without anybody editing the sentence that says it.
    edge('support', 'erasure', 'what somebody wrote in, and the address they wrote from', n('SELECT COUNT(*) AS n FROM tickets'), '#/erasure'),
    edge('contact', 'erasure', 'the number, the transcript and the recording of a voice', n('SELECT COUNT(*) AS n FROM calls') + n('SELECT COUNT(*) AS n FROM sms_messages'), '#/erasure'),
    edge('intel', 'erasure', 'harvested contacts are people who never asked to be on file', n('SELECT COUNT(*) AS n FROM intel_contacts'), '#/erasure'),

    // Every edge below names a code path that exists. Where one does not — the
    // obvious example is a contract review that ought to happen before a deal
    // is agreed — there is deliberately no line on the map, because a declared
    // relationship nothing enforces is the decoration this whole design is
    // supposed to refuse.
    edge('tax', 'ledger', 'a tax line is a journal entry in the same books, not a report beside them', n('SELECT COUNT(*) AS n FROM tax_lines WHERE entry_id IS NOT NULL'), '#/ledger'),
    edge('tax', 'money', 'the invoices it classifies', n('SELECT COUNT(*) AS n FROM invoices'), '#/money'),
    edge('tax', 'approvals', 'above the limit an employee drafts and a person posts', n("SELECT COUNT(*) AS n FROM tax_lines WHERE state = 'draft' OR treatment = 'unclassified'"), '#/approvals', 'gate'),
    edge('tax', 'bookkeeper', 'the same limit the bookkeeper obeys, for the same reason', n("SELECT COUNT(*) AS n FROM tax_lines WHERE state = 'posted'"), '#/bookkeeper'),

    edge('privacy', 'erasure', 'an erasure request is carried out there, not noted here', n("SELECT COUNT(*) AS n FROM dsr_requests WHERE kind = 'erasure'"), '#/erasure', 'gate'),
    edge('privacy', 'connectors', 'a flow names the connector that would carry it, before it carries anything', n('SELECT COUNT(*) AS n FROM privacy_flows WHERE connector IS NOT NULL'), '#/connectors', 'gate'),
    edge('privacy', 'approvals', 'a high-risk flow is decided by a person', n("SELECT COUNT(*) AS n FROM privacy_flows WHERE risk = 'high' AND state IN ('proposed','assessed')"), '#/approvals', 'gate'),
    edge('privacy', 'archive', 'the copy handed to somebody who asked for their data', n('SELECT COUNT(*) AS n FROM data_exports'), '#/archive'),

    edge('datagov', 'erasure', 'every column called personal, checked against the walk that must reach it', n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1'), '#/erasure', 'audit'),
    edge('datagov', 'privacy', 'a personal column an erasure cannot reach is a promise the DPO cannot keep', n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1 AND erasable = 0'), '#/privacy', 'audit'),
    edge('datagov', 'observability', 'retention: what is kept longer than its class allows', n('SELECT COUNT(*) AS n FROM data_classes WHERE retain_days > 0'), '#/observability'),

    edge('support', 'help', 'a question asked three times is a missing article, not a busy week', n("SELECT COUNT(*) AS n FROM help_gaps WHERE seen >= 3"), '#/help'),
    edge('help', 'runs', 'an employee drafts the article; a person publishes it', n("SELECT COUNT(*) AS n FROM help_articles WHERE run_id IS NOT NULL"), '#/runs'),
    edge('help', 'approvals', 'nothing reaches a customer until somebody signs it', n("SELECT COUNT(*) AS n FROM help_articles WHERE state IN ('draft','review')"), '#/approvals', 'gate'),

    edge('trustcentre', 'redteam', 'what got through last time, published as it is', n("SELECT COUNT(*) AS n FROM redteam_runs WHERE outcome = 'breached' AND fixed_at IS NULL"), '#/redteam', 'audit'),
    edge('trustcentre', 'anchors', 'how long since anybody outside this machine witnessed the record', n('SELECT COUNT(*) AS n FROM anchors WHERE ok = 1'), '#/anchors', 'audit'),
    edge('trustcentre', 'privacy', 'how many people are still waiting for an answer', n("SELECT COUNT(*) AS n FROM dsr_requests WHERE state IN ('received','working')"), '#/privacy'),
    edge('trustcentre', 'connectors', 'every processor that touches the data, named', n('SELECT COUNT(*) AS n FROM subprocessors'), '#/connectors'),

    edge('status', 'incidents', 'an incident nobody told the customers about', n("SELECT COUNT(*) AS n FROM incidents WHERE state <> 'closed'"), '#/incidents', 'gate'),
    edge('status', 'objectives', 'a promise is measured by the watchtower, not by the department that made it', n('SELECT COUNT(*) AS n FROM sla_terms WHERE objective IS NOT NULL'), '#/objectives', 'audit'),
    edge('status', 'trustcentre', 'the same numbers, said to somebody who has not bought yet', n('SELECT COUNT(*) AS n FROM status_components'), '#/trust'),

    edge('partnerships', 'sales', 'the deals a partner actually brought', n('SELECT COUNT(*) AS n FROM deals WHERE partner_id IS NOT NULL'), '#/sales'),
    edge('partnerships', 'relations', 'the outreach draft and the health score were already here', n('SELECT COUNT(*) AS n FROM interactions WHERE partner_id IS NOT NULL'), '#/relations'),
    edge('partnerships', 'egress', 'an outreach message leaves the way everything else does', n("SELECT COUNT(*) AS n FROM partners WHERE draft IS NOT NULL"), '#/egress', 'gate'),

    edge('growth', 'products', 'the thing being changed', n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND product_id IS NOT NULL"), '#/products'),
    edge('growth', 'lab', 'the Lab compares two prompts; this compares two things a customer sees', n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'lab'"), '#/lab'),
    edge('growth', 'insights', 'a result nobody decided on is a report, not an experiment', n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND state = 'running' AND result_a IS NOT NULL"), '#/insights'),

    // The offices are only worth having because of where what happens in them
    // goes. Each of these is a call this module actually makes.
    edge('offices', 'memory', 'what somebody walked away with is written into their memory, and recalled into their later prompts', n("SELECT COUNT(*) AS n FROM mem_docs WHERE source_type = 'simulation'"), '#/memory'),
    edge('offices', 'society', 'the same relationships the feed shows, moved by what was actually said', n('SELECT COUNT(*) AS n FROM agent_relations'), '#/society'),
    edge('offices', 'disputes', 'a disagreement that will not resolve is heard by HR, and the ruling is the owner\'s', n('SELECT COUNT(*) AS n FROM sim_encounters WHERE dispute_id IS NOT NULL'), '#/disputes', 'gate'),
    edge('offices', 'org', 'each employee arrives with their own voice, not a generic one', n('SELECT COUNT(*) AS n FROM sim_presence'), '#/org'),
    edge('offices', 'agents', 'everybody active has a desk', n("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'"), '#/agents'),
    edge('offices', 'chat', 'the room is a channel, so a conversation held in one can be read in the other', n("SELECT COUNT(*) AS n FROM agent_messages WHERE kind = 'sim'"), '#/chat'),

    edge('ip', 'products', 'shipped and never claimed', n('SELECT COUNT(*) AS n FROM products'), '#/products'),
    edge('ip', 'legal', 'a filing is legal work, and a lapse is a legal loss', n("SELECT COUNT(*) AS n FROM ip_assets WHERE state IN ('filed','granted','registered')"), '#/legal'),
    edge('ip', 'finance', 'filing and renewal cost money on a schedule', n('SELECT COUNT(*) AS n FROM ip_assets WHERE cost_usd > 0'), '#/finance'),
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
  forgeProject: 'forge', forgeCommand: 'forge', fleetServer: 'servers', deployTarget: 'deploys', monitor: 'monitors',
  engReview: 'reviews', ghRepo: 'github', appBuild: 'appbuilder',
  crewAssignment: 'crew', crewPlan: 'crew',
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
  forge: 'forge', sites: 'sites', servers: 'servers', deploy: 'deploys', monitor: 'monitors', crew: 'crew',
  eng: 'reviews', github: 'github', appbuild: 'appbuilder',
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
/**
 * What the map should be lit up about right now.
 *
 * The atlas has been a map of what *exists*. That is the right thing to show
 * somebody meeting the company for the first time and the wrong thing to show
 * them every morning afterwards, when the questions are all about today: what
 * is waiting on me, what failed, where did the work go.
 *
 * So three lenses, each derived from a real query rather than a heuristic:
 *
 *   waiting   things that have stopped and need a person. Every entry is a
 *             specific query against a specific table — not "count of rows in
 *             a state called pending", which would light up departments that
 *             merely have a queue.
 *   failing   things that went wrong and stayed wrong.
 *   active    what has actually happened today, attributed through the same
 *             subject→section map the activity feed uses.
 *
 * A department with no counter reports nothing rather than zero. The two look
 * identical on a screen and mean opposite things, and a map that shows a
 * confident zero for a department nobody wired is worse than one that leaves
 * it unlit.
 */
const WAITING = {
  gate: "SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'",
  approvals: "SELECT COUNT(*) AS n FROM approvals WHERE state = 'waiting'",
  decisions: "SELECT COUNT(*) AS n FROM decisions WHERE status = 'open'",
  requests: "SELECT COUNT(*) AS n FROM requests WHERE state IN ('new','routing')",
  egress: "SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'gated'",
  browser: "SELECT COUNT(*) AS n FROM browser_sessions WHERE state = 'waiting'",
  ledger: "SELECT COUNT(*) AS n FROM journal WHERE state = 'draft'",
  bookkeeper: "SELECT COUNT(*) AS n FROM journal WHERE state = 'draft' AND created_by LIKE 'agent:%'",
  shifts: "SELECT COUNT(*) AS n FROM time_overtime WHERE state = 'claimed'",
  time: "SELECT COUNT(*) AS n FROM time_leave_request WHERE state = 'requested'",
  finops2: "SELECT COUNT(*) AS n FROM fin_expense WHERE state = 'submitted'",
  procure: "SELECT COUNT(*) AS n FROM proc_request WHERE state = 'requested'",
  joining: "SELECT COUNT(*) AS n FROM join_step s JOIN join_list l ON l.id = s.list_id WHERE l.state = 'open' AND s.done_at IS NULL AND s.critical = 1",
  records: 'SELECT COUNT(*) AS n FROM rec_hold WHERE released_at IS NULL',
  support: "SELECT COUNT(*) AS n FROM tickets WHERE state = 'draft'",
  incidents: "SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'",
  treasury: "SELECT COUNT(*) AS n FROM payouts WHERE state = 'prepared'",
  standing: "SELECT COUNT(*) AS n FROM standing_orders WHERE state = 'paused'",
};

const FAILING = {
  deadletter: "SELECT COUNT(*) AS n FROM dead_letter d JOIN runs r ON r.id = d.run_id WHERE r.state = 'failed'",
  runs: "SELECT COUNT(*) AS n FROM runs WHERE state = 'failed'",
  redteam: "SELECT COUNT(*) AS n FROM redteam_findings WHERE state = 'open'",
  jobs: "SELECT COUNT(*) AS n FROM jobs WHERE state = 'failed'",
  incidents: "SELECT COUNT(*) AS n FROM incidents WHERE severity IN ('sev1','sev2') AND state != 'closed'",
  hunt: "SELECT COUNT(*) AS n FROM hunts WHERE state = 'not-found'",
};

const countOf = (sql) => { try { return one(sql)?.n || 0; } catch { return null; } };

export function mapState() {
  const waiting = {};
  const failing = {};
  for (const [id, sql] of Object.entries(WAITING)) {
    const n = countOf(sql);
    if (n) waiting[id] = n;
  }
  for (const [id, sql] of Object.entries(FAILING)) {
    const n = countOf(sql);
    if (n) failing[id] = n;
  }

  // What actually happened today, attributed the same way the activity feed
  // attributes it — so the map and the feed cannot disagree about who did what.
  const active = {};
  let rows = [];
  try {
    rows = q(`SELECT action, subject_type, COUNT(*) AS n FROM audit_log
              WHERE occurred_at >= datetime('now','-1 day') GROUP BY action, subject_type`);
  } catch { rows = []; }
  for (const r of rows) {
    const section = SUBJECT_SECTION[r.subject_type] || ACTION_SECTION[String(r.action).split('.')[0]] || null;
    if (section) active[section] = (active[section] || 0) + r.n;
  }

  return {
    waiting,
    failing,
    active,
    totals: {
      waiting: Object.values(waiting).reduce((a, b) => a + b, 0),
      failing: Object.values(failing).reduce((a, b) => a + b, 0),
      active: Object.values(active).reduce((a, b) => a + b, 0),
    },
    // Said plainly, because a lens that silently covers two thirds of the map
    // invites the reader to conclude the rest is fine.
    counted: { waiting: Object.keys(WAITING).length, failing: Object.keys(FAILING).length },
    note: 'Only departments with a declared counter can light up. A department with no counter is left unlit '
      + 'rather than shown as zero — the two look identical and mean opposite things.',
  };
}

export function activityFeed(since = 0) {
  const rows = q(`SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id
    FROM audit_log WHERE seq > ? ORDER BY seq DESC LIMIT 30`, since);
  return rows.map((r) => ({
    seq: r.seq, at: r.occurred_at, actorType: r.actor_type, actor: r.actor_id,
    action: r.action, subjectId: r.subject_id,
    section: SUBJECT_SECTION[r.subject_type] || ACTION_SECTION[String(r.action).split('.')[0]] || null,
  }));
}
