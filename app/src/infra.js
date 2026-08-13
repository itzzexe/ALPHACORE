// Infrastructure division — what an application actually needs to run, sized
// from stated load rather than guessed. A plan can be generated whole, or one
// section at a time when only the rate limits or the CI/CD design are wanted.
//
// Plans attach to a design blueprint or a product, so the infrastructure is
// never designed in a vacuum: the architecture and stack documents are fed in
// as context when they exist.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { archiveItem } from './data.js';

const INFRA_DIR = path.join(WS_ROOT, '_infra');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'plan';

export const INFRA_SECTIONS = {
  full: {
    label: 'Full infrastructure plan',
    brief: `Cover every layer, in this order, with headings:
1. Environments (local, CI, staging, production) and what differs between them.
2. Deployment topology with a mermaid diagram.
3. Compute sizing — instance classes and counts derived from the stated load, with the arithmetic shown (requests/sec → CPU/memory → instances, plus headroom).
4. Data layer — database engine and size, replicas, connection pooling, cache, object storage, retention.
5. Networking — DNS, TLS, load balancing, CDN, WAF, egress, private networking.
6. Asynchronous work — queues, workers, scheduled jobs, idempotency and retry policy with backoff.
7. Rate limiting — a table of tier, limit, window, burst, 429 behaviour and headers; plus abuse protection.
8. Scaling — horizontal and vertical rules, thresholds, cold-start behaviour, load-shedding.
9. CI/CD — pipeline stages, gates, artefacts, environment promotion, migrations, rollback.
10. Observability — SLIs/SLOs, metrics, logs, traces, dashboards, alert rules and who they page.
11. Security posture of the infrastructure — secrets, IAM least privilege, network isolation, patching, image scanning.
12. Backup and disaster recovery — schedule, RPO, RTO, restore drill, failover procedure.
13. Cost estimate — a table of every line item with monthly USD and the total, plus the three biggest cost risks.
14. Scale-up path — what changes at 10× the stated load.`,
  },
  sizing: { label: 'Compute & capacity sizing', brief: 'Size compute, memory, storage and database from the stated load. Show every step of the arithmetic, state the headroom factor, and give a table of instance classes and counts per environment.' },
  ratelimits: { label: 'Rate limits & abuse protection', brief: 'A complete rate-limiting design: limit classes per endpoint type, a table of tier/limit/window/burst, the algorithm (token bucket vs sliding window) with justification, 429 response format and headers, quota accounting, and abuse/bot protection.' },
  cicd: { label: 'CI/CD pipeline', brief: 'Branching model, every pipeline stage and what fails the build there, test gates, artefact and image strategy, environment promotion, database migration handling, secret injection, rollback, and a working pipeline file skeleton for the chosen platform.' },
  observability: { label: 'Observability & SLOs', brief: 'SLIs, SLOs and error budgets; the structured log schema; the metric catalogue; tracing spans; dashboards; and an alert table with thresholds, severity and who is paged.' },
  dr: { label: 'Backup & disaster recovery', brief: 'Backup schedule and storage, RPO and RTO per data class, restore procedure step by step, drill cadence, regional failover plan, and the data-loss scenarios that remain unmitigated.' },
  cost: { label: 'Cost model', brief: 'A detailed monthly cost table for every line item at the stated load, the same table at 10× load, the unit economics (cost per user, per request), and the three levers that most reduce cost.' },
};

export function createInfraPlan({ name, section = 'full', spec = {}, blueprintId = null, productId = null, actor }) {
  if (!name?.trim()) throw new Error('name required');
  if (!INFRA_SECTIONS[section]) throw new Error(`section must be one of: ${Object.keys(INFRA_SECTIONS).join(', ')}`);
  exec('INSERT INTO infra_plans (name, blueprint_id, product_id, spec, section, created_by) VALUES (?,?,?,?,?,?)',
    name.trim(), blueprintId, productId, JSON.stringify(spec || {}), section, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;

  // Feed the design package in when one exists — infrastructure that ignores
  // the architecture it serves is just a shopping list.
  let designContext = '';
  if (blueprintId) {
    const docs = q("SELECT title, content FROM blueprint_docs WHERE blueprint_id = ? AND doc_key IN ('architecture','tech-stack','srs') AND content IS NOT NULL", blueprintId);
    if (docs.length) designContext = `\n\nThe system is already designed. Stay consistent with these approved documents:\n${docs.map((d) => `### ${d.title}\n${String(d.content).slice(0, 5000)}`).join('\n\n')}`;
  }
  const s = spec || {};
  const specLines = [
    s.users ? `Expected users: ${s.users}` : null,
    s.rps ? `Peak requests/sec: ${s.rps}` : null,
    s.dataGb ? `Data volume: ${s.dataGb} GB, growing ${s.growth || 'unknown'}` : null,
    s.budgetUsd ? `Monthly budget ceiling: $${s.budgetUsd}` : null,
    s.cloud ? `Cloud / hosting preference: ${s.cloud}` : null,
    s.regions ? `Regions: ${s.regions}` : null,
    s.availability ? `Availability target: ${s.availability}` : null,
    s.compliance ? `Compliance: ${s.compliance}` : null,
    s.stack ? `Stack: ${s.stack}` : null,
    s.notes ? `Notes: ${s.notes}` : null,
  ].filter(Boolean).join('\n');

  const runId = enqueueRun({
    agentId: 'AGT-INF-001',
    taskType: `infra:${id}`,
    input: {
      prompt: `Design the infrastructure for: ${name.trim()}

STATED LOAD AND CONSTRAINTS:
${specLines || '(none given — state every assumption you make and size for a small production launch)'}

Document: ${INFRA_SECTIONS[section].label}
What it must contain:
${INFRA_SECTIONS[section].brief}

Use tables for anything numeric and mermaid for topology. Where a figure was not given, size it from a stated assumption and label it [Assumption]. Never present a guess as a measurement.${designContext}`,
    },
    actor,
  });
  exec('UPDATE infra_plans SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'infra.plan_requested', subjectType: 'infraPlan', subjectId: id, payload: { section, blueprintId, productId } });
  return getInfraPlan(id);
}

export function getInfraPlan(id) {
  const p = one('SELECT * FROM infra_plans WHERE id = ?', id);
  if (!p) return null;
  return {
    ...p,
    spec: p.spec ? JSON.parse(p.spec) : {},
    costTable: p.cost_table ? JSON.parse(p.cost_table) : [],
    blueprint: p.blueprint_id ? one('SELECT id, name FROM blueprints WHERE id = ?', p.blueprint_id) : null,
  };
}

export function listInfraPlans() {
  return q('SELECT id FROM infra_plans ORDER BY id DESC LIMIT 50').map((r) => getInfraPlan(r.id));
}

/** Server tick — fold finished infrastructure runs into their plans. */
export function syncInfraPlans() {
  for (const p of q("SELECT * FROM infra_plans WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', p.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
    if (parsed?.markdown) {
      const body = `# ${parsed.title || p.name}\n\n${parsed.markdown}${run.state !== 'done' ? `\n\n> **Held for review by the platform:** ${run.failure_reason || run.state}` : ''}`;
      fs.mkdirSync(INFRA_DIR, { recursive: true });
      const rel = `_infra/${slug(p.name)}-${p.section}-${p.id}.md`;
      fs.writeFileSync(path.join(WS_ROOT, rel), body, 'utf8');
      exec("UPDATE infra_plans SET state = 'ready', content = ?, cost_table = ?, file_ref = ? WHERE id = ?",
        body, JSON.stringify(parsed.costTable || []), rel, p.id);
      archiveItem({ title: `Infrastructure plan: ${p.name} (${p.section})`, kind: 'manual', subjectType: 'infraPlan', subjectId: p.id, snapshot: { section: p.section, monthlyUsd: (parsed.costTable || []).reduce((a, c) => a + (Number(c.monthlyUsd) || 0), 0) }, fileRef: rel, actor: 'system:infra' });
      notify({ level: 'info', source: 'infra', message: `Infrastructure plan ready: ${p.name} (${INFRA_SECTIONS[p.section]?.label || p.section}).`, subjectType: 'infraPlan', subjectId: p.id });
    } else if (['failed', 'cancelled', 'awaiting_human'].includes(run.state)) {
      exec("UPDATE infra_plans SET state = 'failed', content = ? WHERE id = ?", run.failure_reason || `run ${run.state}`, p.id);
    }
  }
}

export function infraOverview() {
  const plans = listInfraPlans();
  return {
    total: plans.length,
    ready: plans.filter((p) => p.state === 'ready').length,
    drafting: plans.filter((p) => p.state === 'drafting').length,
    estimatedMonthlyUsd: plans.filter((p) => p.state === 'ready')
      .reduce((a, p) => a + p.costTable.reduce((x, c) => x + (Number(c.monthlyUsd) || 0), 0), 0),
    sections: Object.entries(INFRA_SECTIONS).map(([id, s]) => ({ id, label: s.label })),
  };
}
