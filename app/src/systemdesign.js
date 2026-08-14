// System Design studio — turns one sentence about a product into the complete
// document set an engineering team can build from, then packages that set as a
// single brief any AI coding agent can execute end to end.
//
// The documents are not independent essays: each one is written with the
// approved output of its dependencies in context, in the order a real design
// process follows — business first, then requirements, then architecture, then
// the operational reality. That ordering is what stops the architecture from
// contradicting the requirements, which is the usual failure of generated
// "documentation packs".
//
// Every document is a real file under workspace/_blueprints/<slug>/, so the
// output is a folder you can hand to a developer, a client, or an agent.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { archiveItem } from './data.js';
import { openPii } from './erasure.js';

const BP_ROOT = path.join(WS_ROOT, '_blueprints');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'blueprint';

/**
 * The document catalog. `needs` names the documents whose content is fed to
 * this one, which is also what defines the writing order.
 */
export const DOC_CATALOG = [
  { key: 'vision', title: 'Vision & Problem Statement', agent: 'AGT-BA-001', needs: [],
    brief: 'The problem, who has it, why now, what success looks like, and what is explicitly out of scope. Include measurable success criteria.' },
  { key: 'business-case', title: 'Business Case & ROI', agent: 'AGT-BA-001', needs: ['vision'],
    brief: 'Cost of building vs cost of not building. Revenue or saving model, pricing hypothesis, break-even estimate, payback period, and the three assumptions the case rests on. Show the arithmetic in a table.' },
  { key: 'stakeholders', title: 'Stakeholders & RACI', agent: 'AGT-BA-001', needs: ['vision'],
    brief: 'Every stakeholder group, what they need from the system, and a RACI table for the build and for operation. Name the single accountable person per area.' },
  { key: 'brd', title: 'Business Requirements Document (BRD)', agent: 'AGT-BA-001', needs: ['vision', 'business-case', 'stakeholders'],
    brief: 'Formal BRD: background, business objectives, scope in/out, business rules (BR-n), process flows as mermaid, constraints, assumptions, dependencies, and acceptance criteria at business level.' },
  { key: 'prd', title: 'Product Requirements (PRD)', agent: 'AGT-PM-001', needs: ['brd'],
    brief: 'Personas, jobs to be done, the MVP boundary, feature list with priority (MoSCoW), user stories with Given/When/Then acceptance criteria, and what is deliberately deferred to v2.' },
  { key: 'srs', title: 'Software Requirements Specification (SRS)', agent: 'AGT-BA-001', needs: ['prd', 'brd'],
    brief: 'IEEE-style SRS: numbered functional requirements (FR-n) each traceable to a business rule, and non-functional requirements (NFR-n) with hard numbers for performance, availability, scalability, usability, and accessibility.' },
  { key: 'use-cases', title: 'Use Cases & User Journeys', agent: 'AGT-BA-001', needs: ['prd'],
    brief: 'Primary use cases in full form (actor, preconditions, main flow, alternate flows, exceptions, postconditions) plus end-to-end journey diagrams as mermaid.' },
  { key: 'data-model', title: 'Data Model & ERD', agent: 'AGT-ARC-001', needs: ['srs'],
    brief: 'Entities, attributes with types, keys, relationships and cardinality, an ERD as a mermaid erDiagram, indexing strategy, retention and archival policy, and the migration approach.' },
  { key: 'architecture', title: 'System Architecture', agent: 'AGT-ARC-001', needs: ['srs', 'data-model'],
    brief: 'Component architecture with a mermaid diagram, request lifecycle, synchronous vs asynchronous boundaries, state management, failure modes with the behaviour on each, and ADRs for the three decisions that are expensive to reverse — each with rejected options and an exit path.' },
  { key: 'tech-stack', title: 'Technology Stack & Languages', agent: 'AGT-ARC-001', needs: ['architecture'],
    brief: 'Exact stack: languages and versions, frameworks, database, cache, queue, storage, auth, key libraries — each with the reason it was chosen, the alternative rejected, and its licence. Include a table of every dependency category.' },
  { key: 'api-spec', title: 'API Specification', agent: 'AGT-ARC-001', needs: ['architecture', 'data-model'],
    brief: 'Every endpoint: method, path, auth scope, request and response schemas with examples, status codes, error format, idempotency, pagination, versioning policy, and rate-limit class per endpoint.' },
  { key: 'ui-ux', title: 'UI/UX Specification', agent: 'AGT-DES-001', needs: ['prd', 'use-cases'],
    brief: 'Screen inventory, navigation map as mermaid, per-screen layout and states (empty, loading, error, success), design tokens (colour, type, spacing), responsive rules, RTL/Arabic support, and accessibility requirements.' },
  { key: 'security', title: 'Security Design & Threat Model', agent: 'AGT-SEC-001', needs: ['architecture', 'api-spec', 'data-model'],
    brief: 'STRIDE threat model as a table (threat, asset, mitigation, residual risk), authentication and authorization model with the permission matrix, secret management, encryption in transit and at rest, input validation posture, dependency and supply-chain policy, and the security tests that prove each control.' },
  { key: 'compliance', title: 'Data Protection & Compliance', agent: 'AGT-BA-001', needs: ['data-model', 'security'],
    brief: 'Data inventory by sensitivity, lawful basis, residency, retention schedule, subject rights handling, processor list and DPA needs, audit logging requirements, and the compliance regimes that apply with the specific obligations each imposes.' },
  { key: 'infrastructure', title: 'Infrastructure & Deployment Topology', agent: 'AGT-INF-001', needs: ['architecture', 'tech-stack'],
    brief: 'Environments, deployment topology diagram as mermaid, compute and storage sizing derived from the stated load with the arithmetic shown, networking, CDN, scaling rules, and the monthly cost estimate table.' },
  { key: 'cicd', title: 'CI/CD Pipeline & Environments', agent: 'AGT-INF-001', needs: ['tech-stack', 'infrastructure'],
    brief: 'Branching model, pipeline stages with what fails the build at each, artefact and image strategy, environment promotion, migration handling, secret injection, rollback procedure, and a ready-to-use pipeline file skeleton.' },
  { key: 'observability', title: 'Observability & SLOs', agent: 'AGT-INF-001', needs: ['architecture', 'infrastructure'],
    brief: 'SLIs and SLOs with error budgets, structured log schema, the metric set, tracing plan, dashboard inventory, alert rules with thresholds and who they page, and the on-call rotation.' },
  { key: 'performance', title: 'Performance, Rate Limits & Capacity', agent: 'AGT-INF-001', needs: ['api-spec', 'infrastructure'],
    brief: 'Latency and throughput budgets per endpoint class, the rate-limit table (tier, limit, window, burst, 429 behaviour, headers), caching layers with TTLs, capacity model with headroom, and the load-test plan.' },
  { key: 'test-plan', title: 'Test Strategy & QA Plan', agent: 'AGT-QA-001', needs: ['srs', 'api-spec'],
    brief: 'Test pyramid with coverage targets, per-requirement test cases traceable to FR/NFR ids, test data strategy, environment needs, security and performance testing, UAT plan, and the definition of done.' },
  { key: 'runbook', title: 'Operations Runbook & DR', agent: 'AGT-DEV-001', needs: ['infrastructure', 'observability'],
    brief: 'Deploy and rollback steps, common failure playbooks, backup schedule with RPO/RTO, restore drill procedure, incident severities with response expectations, and the maintenance calendar.' },
  { key: 'roadmap', title: 'Delivery Roadmap & Estimates', agent: 'AGT-PM-001', needs: ['prd', 'architecture', 'test-plan'],
    brief: 'Phased delivery with milestones, work breakdown to task level with estimates in engineer-days, critical path, dependencies, staffing shape, and the risks that would move the dates.' },
  { key: 'risks', title: 'Build Risk Register', agent: 'AGT-BA-001', needs: ['architecture', 'roadmap'],
    brief: 'Risk register table: risk, likelihood 1-5, impact 1-5, score, owner, mitigation, trigger that means it is happening, and contingency.' },
  { key: 'build-prompt', title: 'Agent Build Brief — hand this to an AI coder', agent: 'AGT-ARC-001', needs: ['prd', 'srs', 'data-model', 'architecture', 'tech-stack', 'api-spec', 'security', 'test-plan'],
    brief: `A single self-contained instruction set that an autonomous coding agent can execute without access to any other document. It must contain: the exact stack and versions; the full directory layout to create; every file to write with its responsibility; the complete data schema as DDL; every endpoint with request/response shapes; the auth and permission rules; validation and error handling conventions; the coding standards; the test suite to write; setup, run and deploy commands; and a numbered build order where each step is independently verifiable. Write it as direct imperative instructions to the agent, not as description.` },
];

const DOC_BY_KEY = Object.fromEntries(DOC_CATALOG.map((d) => [d.key, d]));
export const DOC_KEYS = DOC_CATALOG.map((d) => d.key);

// ---------- creation ----------
export function createBlueprint({ name, goal, docKeys = null, productId = null, projectId = null, context = null, actor }) {
  if (!name?.trim() || !goal?.trim()) throw new Error('name and goal required');
  const keys = Array.isArray(docKeys) && docKeys.length ? DOC_KEYS.filter((k) => docKeys.includes(k)) : DOC_KEYS;
  const ws = `${slug(name)}-${Date.now().toString(36)}`;
  exec('INSERT INTO blueprints (name, goal, product_id, project_id, context, workspace, created_by) VALUES (?,?,?,?,?,?,?)',
    name.trim(), goal.trim(), productId, projectId, context ? JSON.stringify(context) : null, ws, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  keys.forEach((k, i) => {
    const d = DOC_BY_KEY[k];
    exec('INSERT INTO blueprint_docs (blueprint_id, doc_key, title, seq, agent_id) VALUES (?,?,?,?,?)',
      id, k, d.title, i + 1, d.agent);
  });
  audit({ actorType: 'human', actorId: actor, action: 'blueprint.created', subjectType: 'blueprint', subjectId: id, payload: { name: name.trim(), docs: keys.length, productId } });
  notify({ level: 'info', source: 'design', message: `System design started: “${name.trim()}” — ${keys.length} documents queued.`, subjectType: 'blueprint', subjectId: id });
  return getBlueprint(id);
}

export function getBlueprint(id) {
  const b = one('SELECT * FROM blueprints WHERE id = ?', id);
  if (!b) return null;
  const docs = q('SELECT * FROM blueprint_docs WHERE blueprint_id = ? ORDER BY seq', id).map((d) => ({
    ...d,
    openQuestions: d.open_questions ? JSON.parse(d.open_questions) : [],
    needs: DOC_BY_KEY[d.doc_key]?.needs || [],
    brief: DOC_BY_KEY[d.doc_key]?.brief || null,
  }));
  return {
    ...b,
    context: b.context ? JSON.parse(b.context) : null,
    docs,
    progress: {
      total: docs.length,
      done: docs.filter((d) => d.state === 'done').length,
      writing: docs.filter((d) => d.state === 'writing').length,
      blocked: docs.filter((d) => d.state === 'awaiting_human').length,
      words: docs.reduce((a, d) => a + (d.content ? d.content.split(/\s+/).length : 0), 0),
      costUsd: docs.reduce((a, d) => a + (d.cost_usd || 0), 0),
      openQuestions: docs.reduce((a, d) => a + (d.openQuestions?.length || 0), 0),
    },
  };
}

export function listBlueprints() {
  return q('SELECT id FROM blueprints ORDER BY id DESC LIMIT 50').map((r) => {
    const b = getBlueprint(r.id);
    return { ...b, docs: b.docs.map((d) => ({ id: d.id, doc_key: d.doc_key, title: d.title, state: d.state, seq: d.seq })) };
  });
}

export function cancelBlueprint(id, actor) {
  if (!one('SELECT id FROM blueprints WHERE id = ?', id)) throw new Error('blueprint not found');
  exec("UPDATE blueprints SET state = 'cancelled', ended_at = datetime('now') WHERE id = ?", id);
  exec("UPDATE blueprint_docs SET state = 'skipped' WHERE blueprint_id = ? AND state IN ('pending','writing')", id);
  audit({ actorType: 'human', actorId: actor, action: 'blueprint.cancelled', subjectType: 'blueprint', subjectId: id });
  return { ok: true };
}

/** Rewrite one document — after an edit upstream, or because it came back thin. */
export function redoDoc(docId, { note = null, actor }) {
  const d = one('SELECT * FROM blueprint_docs WHERE id = ?', docId);
  if (!d) throw new Error('document not found');
  exec("UPDATE blueprint_docs SET state = 'pending', run_id = NULL, content = NULL WHERE id = ?", docId);
  exec("UPDATE blueprints SET state = 'drafting' WHERE id = ?", d.blueprint_id);
  audit({ actorType: 'human', actorId: actor, action: 'blueprint.doc_redo', subjectType: 'blueprint', subjectId: d.blueprint_id, payload: { doc: d.doc_key, note } });
  return { ok: true };
}

/** A human accepts a document as final. */
export function approveDoc(docId, { content = null, actor }) {
  const d = one('SELECT * FROM blueprint_docs WHERE id = ?', docId);
  if (!d) throw new Error('document not found');
  exec("UPDATE blueprint_docs SET approved_by = ?, content = COALESCE(?, content), state = 'done' WHERE id = ?", actor, content, docId);
  if (content) writeDocFile(d.blueprint_id, d.doc_key, content);
  audit({ actorType: 'human', actorId: actor, action: 'blueprint.doc_approved', subjectType: 'blueprint', subjectId: d.blueprint_id, payload: { doc: d.doc_key, edited: Boolean(content) } });
  return { ok: true };
}

// ---------- the writing flow ----------
function writeDocFile(blueprintId, docKey, content) {
  const b = one('SELECT * FROM blueprints WHERE id = ?', blueprintId);
  if (!b) return null;
  const dir = path.join(BP_ROOT, b.workspace);
  fs.mkdirSync(dir, { recursive: true });
  const seq = String(one('SELECT seq FROM blueprint_docs WHERE blueprint_id = ? AND doc_key = ?', blueprintId, docKey)?.seq || 0).padStart(2, '0');
  const rel = `_blueprints/${b.workspace}/${seq}-${docKey}.md`;
  fs.writeFileSync(path.join(WS_ROOT, rel), content, 'utf8');
  exec('UPDATE blueprint_docs SET file_ref = ? WHERE blueprint_id = ? AND doc_key = ?', rel, blueprintId, docKey);
  return rel;
}

function contextFor(b, doc) {
  const needs = DOC_BY_KEY[doc.doc_key]?.needs || [];
  if (!needs.length) return '';
  const parts = [];
  for (const k of needs) {
    const dep = one('SELECT title, content, state FROM blueprint_docs WHERE blueprint_id = ? AND doc_key = ?', b.id, k);
    if (dep?.content) parts.push(`### ${dep.state === 'done' ? 'APPROVED' : 'WRITTEN (pending review)'} — ${dep.title}\n${String(dep.content).slice(0, 6000)}`);
  }
  return parts.length ? `\n\nThese documents already exist. Stay strictly consistent with them; do not restate them at length, build on them:\n\n${parts.join('\n\n')}` : '';
}

/** Server tick — writes documents in dependency order, one per blueprint. */
export function advanceBlueprints() {
  for (const b of q("SELECT * FROM blueprints WHERE state IN ('drafting','awaiting_human')")) {
    const writing = one("SELECT * FROM blueprint_docs WHERE blueprint_id = ? AND state = 'writing'", b.id);
    if (writing) {
      const run = writing.run_id ? one('SELECT state, output, cost_usd, failure_reason FROM runs WHERE id = ?', writing.run_id) : null;
      if (!run) { exec("UPDATE blueprint_docs SET state = 'pending' WHERE id = ?", writing.id); continue; }
      if (['queued', 'leased', 'running'].includes(run.state)) continue;
      const parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null;
      if (parsed?.markdown) {
        // A run held at the human gate — below its confidence floor, say —
        // still produced the document. Keep the text and route it to review
        // rather than throwing away work that was already paid for.
        const heldForReview = run.state !== 'done';
        const body = `# ${parsed.title || writing.title}\n\n${parsed.markdown}`;
        exec(`UPDATE blueprint_docs SET state = ?, content = ?, open_questions = ?, cost_usd = ?, ended_at = datetime('now') WHERE id = ?`,
          heldForReview ? 'awaiting_human' : 'done', body,
          JSON.stringify(heldForReview
            ? [`held for review: ${run.failure_reason || run.state}`, ...(parsed.openQuestions || [])]
            : (parsed.openQuestions || [])),
          run.cost_usd || 0, writing.id);
        writeDocFile(b.id, writing.doc_key, body);
        audit({ actorType: 'agent', actorId: writing.agent_id, action: heldForReview ? 'blueprint.doc_for_review' : 'blueprint.doc_written', subjectType: 'blueprint', subjectId: b.id, payload: { doc: writing.doc_key, words: body.split(/\s+/).length } });
        if (heldForReview) {
          exec("UPDATE blueprints SET state = 'awaiting_human' WHERE id = ?", b.id);
          notify({ level: 'warn', source: 'design', message: `“${b.name}” — ${writing.title} is written but held for your review (${run.failure_reason || run.state}). Read it, then approve or rewrite.`, subjectType: 'blueprint', subjectId: b.id });
        }
      } else {
        exec("UPDATE blueprint_docs SET state = 'awaiting_human', open_questions = ? WHERE id = ?",
          JSON.stringify([run.failure_reason || `run ${run.state}`]), writing.id);
        exec("UPDATE blueprints SET state = 'awaiting_human' WHERE id = ?", b.id);
        notify({ level: 'warn', source: 'design', message: `“${b.name}” stalled on ${writing.title} — approve, edit, or retry it.`, subjectType: 'blueprint', subjectId: b.id });
      }
      continue;
    }

    // Pick the next document whose dependencies are all written.
    const pending = q("SELECT * FROM blueprint_docs WHERE blueprint_id = ? AND state = 'pending' ORDER BY seq", b.id);
    if (!pending.length) {
      if (b.state !== 'ready' && !one("SELECT id FROM blueprint_docs WHERE blueprint_id = ? AND state IN ('pending','writing')", b.id)) {
        finishBlueprint(b);
      }
      continue;
    }
    // A dependency awaiting review still has usable text, so the package keeps
    // moving; the human catches up on approvals in parallel.
    const ready = pending.find((d) => (DOC_BY_KEY[d.doc_key]?.needs || [])
      .every((k) => {
        const dep = one('SELECT state, content FROM blueprint_docs WHERE blueprint_id = ? AND doc_key = ?', b.id, k);
        return !dep || dep.state === 'done' || dep.state === 'skipped' || (dep.state === 'awaiting_human' && dep.content);
      }));
    if (!ready) continue;

    const ctx = b.context ? JSON.parse(b.context) : {};
    const ctxLines = Object.entries(ctx).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    try {
      const runId = enqueueRun({
        agentId: ready.agent_id,
        taskType: `blueprint:${b.id}:${ready.doc_key}`,
        input: {
          prompt: `You are writing one document in the design package for a software product. Write it in full — this document will be handed to engineers and to autonomous coding agents as-is.

PRODUCT: ${b.name}
GOAL: ${b.goal}
${ctxLines ? `CONTEXT:\n${ctxLines}` : ''}

Document: ${ready.title}
What it must contain: ${DOC_BY_KEY[ready.doc_key]?.brief}

Rules: be specific and complete, use tables and mermaid diagrams where they carry the meaning, number every requirement so it can be referenced, and mark anything you had to assume as [Assumption] and anything unresolved as [Open question]. No filler, no "TBD" without saying who decides it.${contextFor(b, ready)}`,
        },
        actor: 'system:design',
      });
      exec("UPDATE blueprint_docs SET state = 'writing', run_id = ? WHERE id = ?", runId, ready.id);
      exec("UPDATE blueprints SET state = 'drafting', current_seq = ? WHERE id = ?", ready.seq, b.id);
    } catch {
      exec("UPDATE blueprint_docs SET state = 'awaiting_human', open_questions = ? WHERE id = ?",
        JSON.stringify(['could not start — agent suspended or budget exhausted']), ready.id);
      exec("UPDATE blueprints SET state = 'awaiting_human' WHERE id = ?", b.id);
    }
  }
}

function finishBlueprint(b) {
  const done = one("SELECT COUNT(*) AS n FROM blueprint_docs WHERE blueprint_id = ? AND state = 'done'", b.id).n;
  exec("UPDATE blueprints SET state = 'ready', ended_at = datetime('now') WHERE id = ?", b.id);
  const bundle = buildBundle(b.id);
  audit({ actorType: 'system', actorId: 'system:design', action: 'blueprint.completed', subjectType: 'blueprint', subjectId: b.id, payload: { docs: done, file: bundle.fileRef } });
  archiveItem({
    title: `Design package: ${b.name} — ${done} documents`, kind: 'manual',
    subjectType: 'blueprint', subjectId: b.id, snapshot: { docs: done, workspace: b.workspace },
    fileRef: bundle.fileRef, actor: 'system:design',
  });
  notify({ level: 'info', source: 'design', message: `Design package ready: “${b.name}” — ${done} documents, bundled at ${bundle.fileRef}.`, subjectType: 'blueprint', subjectId: b.id });
}

// ---------- export ----------
/** One Markdown file containing the whole package, with a table of contents. */
export function buildBundle(id) {
  const b = getBlueprint(id);
  if (!b) throw new Error('blueprint not found');
  const written = b.docs.filter((d) => d.content);
  const toc = written.map((d) => `${d.seq}. [${d.title}](#${slug(d.title)})`).join('\n');
  const open = written.flatMap((d) => (d.openQuestions || []).map((qn) => `- **${d.title}:** ${qn}`));
  const body = [
    `# ${b.name} — Complete Design Package`,
    '',
    `**Goal:** ${b.goal}`,
    b.product_id ? `**Product:** ${b.product_id}` : null,
    `**Documents:** ${written.length}/${b.docs.length} · **Generated:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    'This package was produced by AlphaCore. Each document was written with its',
    'dependencies in context, so the architecture, requirements and operations sections',
    'are consistent with one another. Hand the final section to an AI coding agent to',
    'build the system, or hand the whole file to an engineering team.',
    '',
    '## Contents',
    toc,
    '',
    open.length ? `## Open questions across the package\n${open.join('\n')}\n` : '',
    '---',
    '',
    ...written.map((d) => `${d.content}\n\n---\n`),
  ].filter((x) => x !== null).join('\n');

  const dir = path.join(BP_ROOT, b.workspace);
  fs.mkdirSync(dir, { recursive: true });
  const rel = `_blueprints/${b.workspace}/00-COMPLETE-PACKAGE.md`;
  fs.writeFileSync(path.join(WS_ROOT, rel), body, 'utf8');
  return { body, fileRef: rel, filename: `${slug(b.name)}-design-package.md`, docs: written.length };
}

/** Just the agent build brief — the file you paste into a coding agent. */
export function buildAgentBrief(id) {
  const b = getBlueprint(id);
  if (!b) throw new Error('blueprint not found');
  const brief = b.docs.find((d) => d.doc_key === 'build-prompt' && d.content);
  const support = b.docs.filter((d) => ['tech-stack', 'data-model', 'api-spec', 'security'].includes(d.doc_key) && d.content);
  const body = [
    `# BUILD THIS: ${b.name}`,
    '',
    `## Objective\n${b.goal}`,
    '',
    brief ? brief.content : '## Build instructions\n_The build brief has not been written yet — run the package to completion first._',
    '',
    '---',
    '## Reference sections',
    ...support.map((d) => d.content),
  ].join('\n');
  return { body, filename: `${slug(b.name)}-BUILD-BRIEF.md` };
}
