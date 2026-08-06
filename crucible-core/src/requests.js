// The Request Desk — the one place a person writes a sentence and the company
// does the rest.
//
// Journeys follow a fixed 14-department template. A request does not: the
// Intake Router reads what was actually asked and draws the route for that
// request, choosing which departments must each do one concrete thing. The
// desk then walks that route on its own — enqueuing real agent work, opening
// real records in other departments (an intelligence campaign, a design
// package, a financial report), pausing only where the platform requires a
// person — until there is a deliverable to hand back.
//
// Every step reports where it is, who is doing it, what came out, and what it
// cost, so "where is my request?" is answered by looking rather than asking.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { archiveItem } from './data.js';
import { createIntelQuery } from './intel.js';
import { createContent, createDesign, createPost } from './studio.js';
import { createBlueprint } from './systemdesign.js';
import { createInfraPlan } from './infra.js';
import { createFinReport } from './finreports.js';
import { createTask } from './pm.js';

const REQ_DIR = path.join(WS_ROOT, '_requests');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'request';

/**
 * What the router may route to. Each entry names the department, the agent who
 * does that kind of work, and — where the department can produce a real record
 * rather than just an opinion — the spawn that creates it.
 */
export const DEPARTMENTS = [
  { dept: 'research', agent: 'AGT-RES-001', does: 'Market, competitor and customer evidence with sources' },
  { dept: 'intel', agent: 'AGT-INT-001', does: 'Find real organizations and harvest their contact details', spawn: 'intel' },
  { dept: 'product', agent: 'AGT-PM-001', does: 'PRD, user stories, MVP boundary, roadmap' },
  { dept: 'analysis', agent: 'AGT-BA-001', does: 'Business requirements, business case, use cases, specifications' },
  { dept: 'architecture', agent: 'AGT-ARC-001', does: 'System architecture, ADRs, data model, API design' },
  { dept: 'systems', agent: 'AGT-BA-001', does: 'A COMPLETE design package: every document from BRD to an AI build brief', spawn: 'design' },
  { dept: 'engineering', agent: 'AGT-ENG-001', does: 'Implement code with tests' },
  { dept: 'review', agent: 'AGT-REV-001', does: 'Independent cross-family code review' },
  { dept: 'qa', agent: 'AGT-QA-001', does: 'Verify acceptance criteria, test plans' },
  { dept: 'security', agent: 'AGT-SEC-001', does: 'Threat model and security review — block authority' },
  { dept: 'infra', agent: 'AGT-INF-001', does: 'Infrastructure sizing, rate limits, CI/CD, DR, cost', spawn: 'infra' },
  { dept: 'release', agent: 'AGT-DEV-001', does: 'Release checklist and rollback plan' },
  { dept: 'content', agent: 'AGT-CNT-001', does: 'Articles, scripts, emails, landing copy', spawn: 'content' },
  { dept: 'design', agent: 'AGT-DES-001', does: 'Visual design delivered as a real SVG', spawn: 'designAsset' },
  { dept: 'social', agent: 'AGT-SMM-001', does: 'Platform-native posts — a human publishes', spawn: 'social' },
  { dept: 'marketing', agent: 'AGT-DOC-001', does: 'Campaign copy and positioning' },
  { dept: 'sales', agent: 'AGT-SLS-001', does: 'Proposals, pitches, objection handling' },
  { dept: 'relations', agent: 'AGT-RM-001', does: 'Partner, investor and government outreach drafts' },
  { dept: 'support', agent: 'AGT-SUP-001', does: 'Customer replies — a human sends' },
  { dept: 'finance', agent: 'AGT-FIN-001', does: 'Statements, budgets, company research, health assessment', spawn: 'finreport' },
  { dept: 'docs', agent: 'AGT-DOC-001', does: 'Documentation, release notes, summaries, the final written answer' },
  { dept: 'cost', agent: 'AGT-CST-001', does: 'Spend analysis and cost anomalies' },
  { dept: 'ops', agent: 'AGT-MON-001', does: 'Triage signals, classify severity' },
  { dept: 'delivery', agent: 'AGT-PM-001', does: 'Break work into tasks and assign them to agents', spawn: 'task' },
];
const DEPT_BY_NAME = Object.fromEntries(DEPARTMENTS.map((d) => [d.dept, d]));
const SPAWNS = new Set(DEPARTMENTS.filter((d) => d.spawn).map((d) => d.spawn));

// ---------- intake ----------
export function createRequest({ title, body, priority = 'normal', actor }) {
  if (!body?.trim()) throw new Error('write what you need');
  const t = title?.trim() || body.trim().split(/\n/)[0].slice(0, 90);
  exec('INSERT INTO requests (title, body, requester, priority) VALUES (?,?,?,?)', t, body.trim(), actor, priority);
  const id = one('SELECT last_insert_rowid() AS id').id;

  const runId = enqueueRun({
    agentId: 'AGT-REQ-001',
    taskType: `request:${id}`,
    input: {
      prompt: `A person has submitted this request to the company. Route it.

REQUEST (verbatim — it may be in Arabic):
"""
${body.trim()}
"""
Priority: ${priority}

DEPARTMENTS YOU MAY ROUTE TO — use the dept name exactly, and the agentId given:
${DEPARTMENTS.map((d) => `- ${d.dept} (agentId ${d.agent})${d.spawn ? ` [spawn: "${d.spawn}"]` : ''} — ${d.does}`).join('\n')}

Step kinds:
- "agent": that department's agent produces written work. Use this for most steps.
- "spawn": that department opens a REAL record and the desk waits for it to finish. Only for departments marked [spawn]. Use it when the request genuinely calls for that artefact — a design package, an intelligence campaign, a published-ready post, a financial report, an infrastructure plan, a visual, a content piece, or delegated tasks.
- "human": a person must act. Only for publishing, sending to a customer or partner, signing, approving spend, or a gate verdict.

Rules: 2 to 7 steps. Each step's brief must be actionable on its own, and must say what output it hands to the next step. Order matters — later steps receive the earlier outputs. Answer in the language the request was written in.`,
    },
    actor,
  });
  exec('UPDATE requests SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'request.submitted', subjectType: 'request', subjectId: id, payload: { title: t, priority } });
  notify({ level: 'info', source: 'requests', message: `New request #${id}: “${t}” — the intake router is planning its route.`, subjectType: 'request', subjectId: id });
  return getRequest(id);
}

export function getRequest(id) {
  const r = one('SELECT * FROM requests WHERE id = ?', id);
  if (!r) return null;
  const steps = q('SELECT * FROM request_steps WHERE request_id = ? ORDER BY seq', id);
  const done = steps.filter((s) => ['done', 'skipped'].includes(s.state)).length;
  const current = steps.find((s) => ['active', 'awaiting_human'].includes(s.state));
  return {
    ...r,
    steps,
    progress: {
      total: steps.length,
      done,
      pct: steps.length ? Math.round((done / steps.length) * 100) : 0,
      costUsd: steps.reduce((a, s) => a + (s.cost_usd || 0), 0),
      current: current ? { seq: current.seq, dept: current.dept, title: current.title, state: current.state, agent: current.agent_id } : null,
    },
  };
}

export function listRequests() {
  return q('SELECT id FROM requests ORDER BY id DESC LIMIT 60').map((r) => getRequest(r.id));
}

export function cancelRequest(id, actor) {
  if (!one('SELECT id FROM requests WHERE id = ?', id)) throw new Error('request not found');
  exec("UPDATE requests SET state = 'cancelled', ended_at = datetime('now') WHERE id = ?", id);
  exec("UPDATE request_steps SET state = 'skipped' WHERE request_id = ? AND state IN ('pending','active','awaiting_human')", id);
  audit({ actorType: 'human', actorId: actor, action: 'request.cancelled', subjectType: 'request', subjectId: id });
  return { ok: true };
}

/** A human clears the step that was waiting on them. */
export function signOffStep(requestId, { note = null, actor }) {
  const s = one("SELECT * FROM request_steps WHERE request_id = ? AND state = 'awaiting_human' ORDER BY seq LIMIT 1", requestId);
  if (!s) throw new Error('no step is waiting on a human');
  exec("UPDATE request_steps SET state = 'done', output = COALESCE(output, ?), note = COALESCE(?, note), ended_at = datetime('now') WHERE id = ?",
    `Signed off by ${actor}.`, note, s.id);
  exec("UPDATE requests SET state = 'running' WHERE id = ?", requestId);
  audit({ actorType: 'human', actorId: actor, action: 'request.step_signed', subjectType: 'request', subjectId: requestId, payload: { seq: s.seq, dept: s.dept } });
  return getRequest(requestId);
}

// ---------- spawning real work in other departments ----------
function spawnFor(kind, req, step, context) {
  const brief = `${step.brief || step.title}\n\nOriginating request #${req.id}: ${req.body.slice(0, 600)}${context ? `\n\nWhat earlier departments produced:\n${context.slice(0, 2500)}` : ''}`;
  switch (kind) {
    case 'intel': {
      const iq = createIntelQuery({ question: brief.slice(0, 900), targetCount: 8, rules: ['people-when-no-phone', 'ask-executives', 'derive-emails'], actor: 'system:requests' });
      return { kind: 'intelQuery', id: iq.id, href: '#/intel' };
    }
    case 'design': {
      const b = createBlueprint({ name: step.title.slice(0, 80), goal: brief.slice(0, 1200), actor: 'system:requests' });
      return { kind: 'blueprint', id: b.id, href: '#/systems' };
    }
    case 'infra': {
      const p = createInfraPlan({ name: step.title.slice(0, 80), section: 'full', spec: { notes: brief.slice(0, 800) }, actor: 'system:requests' });
      return { kind: 'infraPlan', id: p.id, href: '#/infra' };
    }
    case 'content': {
      const c = createContent({ kind: 'article', title: step.title.slice(0, 90), brief, actor: 'system:requests' });
      return { kind: 'content', id: c.id, href: '#/content' };
    }
    case 'designAsset': {
      const d = createDesign({ kind: 'social-visual', title: step.title.slice(0, 90), brief, actor: 'system:requests' });
      return { kind: 'design', id: d.id, href: '#/design' };
    }
    case 'social': {
      const p = createPost({ brief, kind: 'post', actor: 'system:requests' });
      return { kind: 'post', id: p.id, href: '#/social' };
    }
    case 'finreport': {
      const kindGuess = /balance/i.test(brief) ? 'balance-sheet' : /cash/i.test(brief) ? 'cash-flow' : /budget/i.test(brief) ? 'budget' : /annual/i.test(brief) ? 'annual-report' : /research|about\s+\w+\s+company/i.test(brief) ? 'company-research' : 'health-check';
      const r = createFinReport({ kind: kindGuess, title: step.title.slice(0, 90), actor: 'system:requests' });
      return { kind: 'finReport', id: r.id, href: '#/finreports' };
    }
    case 'task': {
      const t = createTask({ title: step.title.slice(0, 120), details: brief, assigneeType: 'agent', assigneeId: DEPT_BY_NAME[step.dept]?.agent || 'AGT-DOC-001', actor: 'system:requests' });
      return { kind: 'task', id: t.id, href: '#/tasks' };
    }
    default: throw new Error(`unknown spawn ${kind}`);
  }
}

/** Has the spawned record finished, and what did it produce? */
function spawnStatus(kind, id) {
  switch (kind) {
    case 'intelQuery': {
      const iq = one('SELECT state, summary FROM intel_queries WHERE id = ?', id);
      if (!iq) return { done: true, output: 'campaign disappeared' };
      const recs = q('SELECT name, email, phone, city, country FROM intel_records WHERE query_id = ? ORDER BY completeness DESC LIMIT 15', id);
      return iq.state === 'ready'
        ? { done: true, output: `${recs.length} organizations collected.\n${recs.map((r) => `- ${r.name} — ${[r.city, r.country].filter(Boolean).join(', ')} — ${r.email || '—'} ${r.phone || ''}`).join('\n')}` }
        : { done: false, note: `collecting (${iq.state})` };
    }
    case 'blueprint': {
      const b = one('SELECT state, name FROM blueprints WHERE id = ?', id);
      if (!b) return { done: true, output: 'package disappeared' };
      const docs = q("SELECT title, state FROM blueprint_docs WHERE blueprint_id = ?", id);
      const written = docs.filter((d) => d.state === 'done').length;
      return ['ready'].includes(b.state) || (docs.length && written === docs.length)
        ? { done: true, output: `Design package complete: ${written}/${docs.length} documents.\n${docs.map((d) => `- ${d.title}`).join('\n')}` }
        : { done: false, note: `${written}/${docs.length} documents written` };
    }
    case 'infraPlan': {
      const p = one('SELECT state, content FROM infra_plans WHERE id = ?', id);
      return p?.state === 'ready' ? { done: true, output: String(p.content || '').slice(0, 4000) } : { done: false, note: p?.state || 'drafting' };
    }
    case 'content': {
      const c = one('SELECT state, draft FROM content_items WHERE id = ?', id);
      return c && ['draft_ready', 'approved', 'published'].includes(c.state)
        ? { done: true, output: String(c.draft || '').slice(0, 4000) } : { done: false, note: c?.state || 'drafting' };
    }
    case 'design': {
      const d = one('SELECT state, spec, file_ref FROM designs WHERE id = ?', id);
      return d && ['draft_ready', 'approved'].includes(d.state)
        ? { done: true, output: `${d.spec || 'design delivered'}${d.file_ref ? `\nFile: ${d.file_ref}` : ''}` } : { done: false, note: d?.state || 'drafting' };
    }
    case 'post': {
      const p = one('SELECT state, draft FROM posts WHERE id = ?', id);
      return p && ['draft_ready', 'scheduled', 'published'].includes(p.state)
        ? { done: true, output: String(p.draft || '').slice(0, 2000) } : { done: false, note: p?.state || 'drafting' };
    }
    case 'finReport': {
      const r = one('SELECT state, content FROM fin_reports WHERE id = ?', id);
      return r && ['ready', 'approved'].includes(r.state)
        ? { done: true, output: String(r.content || '').slice(0, 4000) } : { done: false, note: r?.state || 'drafting' };
    }
    case 'task': {
      const t = one('SELECT state FROM tasks WHERE id = ?', id);
      return t && ['done', 'cancelled'].includes(t.state) ? { done: true, output: `Task ${t.state}.` } : { done: false, note: t?.state || 'todo' };
    }
    default: return { done: true, output: 'unknown spawn' };
  }
}

// ---------- the desk: walk the route ----------
function priorOutputs(requestId, seq) {
  return q("SELECT dept, title, output FROM request_steps WHERE request_id = ? AND seq < ? AND output IS NOT NULL ORDER BY seq", requestId, seq)
    .map((s) => `### ${s.dept} — ${s.title}\n${String(s.output).slice(0, 3000)}`).join('\n\n');
}

export function advanceRequests() {
  // 1. Triage results become the route.
  for (const r of q("SELECT * FROM requests WHERE state = 'triaging' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', r.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps.filter((s) => s?.dept && DEPT_BY_NAME[s.dept]) : [];
    if (!steps.length) {
      exec("UPDATE requests SET state = 'failed', plan_summary = ? WHERE id = ?",
        `could not route this request: ${run.failure_reason || 'the router returned no usable steps'}`, r.id);
      notify({ level: 'warn', source: 'requests', message: `Request #${r.id} could not be routed — rewrite it with more detail, or route it by hand.`, subjectType: 'request', subjectId: r.id });
      continue;
    }
    steps.slice(0, 8).forEach((s, i) => {
      const d = DEPT_BY_NAME[s.dept];
      const kind = ['agent', 'human', 'spawn'].includes(s.kind) ? s.kind : 'agent';
      const spawn = kind === 'spawn' && d.spawn && SPAWNS.has(d.spawn) ? d.spawn : null;
      exec('INSERT INTO request_steps (request_id, seq, dept, title, brief, kind, spawn_kind, agent_id) VALUES (?,?,?,?,?,?,?,?)',
        r.id, i + 1, s.dept, String(s.title || d.does).slice(0, 140), s.brief || null,
        spawn ? 'spawn' : kind, spawn, kind === 'human' ? null : (d.agent));
    });
    exec("UPDATE requests SET state = 'running', run_id = NULL, title = COALESCE(NULLIF(?,''), title), plan_summary = ?, deliverable = ? WHERE id = ?",
      String(parsed.title || '').slice(0, 140), parsed.summary || null, parsed.deliverable || null, r.id);
    audit({ actorType: 'agent', actorId: 'AGT-REQ-001', action: 'request.routed', subjectType: 'request', subjectId: r.id, payload: { steps: steps.length, depts: steps.map((s) => s.dept) } });
    notify({ level: 'info', source: 'requests', message: `Request #${r.id} routed through ${steps.length} department(s): ${steps.map((s) => s.dept).join(' → ')}.`, subjectType: 'request', subjectId: r.id });
  }

  // 2. Walk each running route, one step at a time.
  for (const r of q("SELECT * FROM requests WHERE state IN ('running','awaiting_human')")) {
    const active = one("SELECT * FROM request_steps WHERE request_id = ? AND state IN ('active','awaiting_human') ORDER BY seq LIMIT 1", r.id);

    if (active) {
      if (active.state === 'awaiting_human') continue;         // a person owns it now
      if (active.kind === 'spawn' && active.spawn_id) {
        const st = spawnStatus(active.spawn_kind === 'designAsset' ? 'design' : active.spawn_kind, active.spawn_id);
        if (st.done) finishStep(r, active, st.output || 'completed');
        else if (st.note !== active.note) exec('UPDATE request_steps SET note = ? WHERE id = ?', st.note, active.id);
        continue;
      }
      if (active.run_id) {
        const run = one('SELECT state, output, cost_usd, failure_reason FROM runs WHERE id = ?', active.run_id);
        if (!run || ['queued', 'leased', 'running'].includes(run?.state)) continue;
        const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
        const text = parsed
          ? (parsed.markdown || parsed.draft || parsed.summary || parsed.article || parsed.proposal || parsed.artifact || JSON.stringify(parsed).slice(0, 3000))
          : (run.failure_reason || 'no output');
        exec('UPDATE request_steps SET cost_usd = ? WHERE id = ?', run.cost_usd || 0, active.id);
        if (parsed) finishStep(r, active, String(text));
        else {
          exec("UPDATE request_steps SET state = 'awaiting_human', note = ? WHERE id = ?", `${active.dept} could not complete this: ${run.failure_reason || run.state}`, active.id);
          exec("UPDATE requests SET state = 'awaiting_human' WHERE id = ?", r.id);
          notify({ level: 'warn', source: 'requests', message: `Request #${r.id} stalled at ${active.dept} — sign off to skip it, or cancel.`, subjectType: 'request', subjectId: r.id });
        }
        continue;
      }
    }

    // 3. No active step — start the next pending one.
    const next = one("SELECT * FROM request_steps WHERE request_id = ? AND state = 'pending' ORDER BY seq LIMIT 1", r.id);
    if (!next) { if (!active) completeRequest(r); continue; }
    const context = priorOutputs(r.id, next.seq);
    exec("UPDATE request_steps SET state = 'active', started_at = datetime('now') WHERE id = ?", next.id);
    exec('UPDATE requests SET current_seq = ? WHERE id = ?', next.seq, r.id);

    if (next.kind === 'human') {
      exec("UPDATE request_steps SET state = 'awaiting_human' WHERE id = ?", next.id);
      exec("UPDATE requests SET state = 'awaiting_human' WHERE id = ?", r.id);
      notify({ level: 'warn', source: 'requests', message: `Request #${r.id} needs you at ${next.dept}: ${next.title}`, subjectType: 'request', subjectId: r.id });
      continue;
    }
    if (next.kind === 'spawn') {
      try {
        const sp = spawnFor(next.spawn_kind, r, next, context);
        exec('UPDATE request_steps SET spawn_kind = ?, spawn_id = ?, note = ? WHERE id = ?', sp.kind, String(sp.id), `opened ${sp.kind} #${sp.id} in that department`, next.id);
        audit({ actorType: 'system', actorId: 'system:requests', action: 'request.spawned', subjectType: 'request', subjectId: r.id, payload: { seq: next.seq, dept: next.dept, spawn: sp.kind, id: sp.id } });
      } catch (e) {
        exec("UPDATE request_steps SET state = 'awaiting_human', note = ? WHERE id = ?", `could not open the work: ${String(e.message).slice(0, 160)}`, next.id);
        exec("UPDATE requests SET state = 'awaiting_human' WHERE id = ?", r.id);
      }
      continue;
    }
    try {
      const runId = enqueueRun({
        agentId: next.agent_id,
        taskType: `reqstep:${r.id}:${next.seq}`,
        input: {
          prompt: `You are the ${next.dept} department handling one step of a request that is moving through the company.

THE ORIGINAL REQUEST (verbatim — answer in its language):
"""
${r.body}
"""

YOUR STEP (${next.seq} of ${one('SELECT COUNT(*) AS n FROM request_steps WHERE request_id = ?', r.id).n}): ${next.title}
What you must produce: ${next.brief || next.title}
${r.deliverable ? `\nThe request as a whole must end with: ${r.deliverable}` : ''}
${context ? `\nWhat earlier departments already produced — build on it, do not repeat it:\n\n${context}` : ''}

Produce the finished work for this step, not a plan to do it. Follow your role's output contract.`,
        },
        actor: 'system:requests',
      });
      exec('UPDATE request_steps SET run_id = ? WHERE id = ?', runId, next.id);
    } catch (e) {
      exec("UPDATE request_steps SET state = 'awaiting_human', note = ? WHERE id = ?", `could not start: ${String(e.message).slice(0, 160)}`, next.id);
      exec("UPDATE requests SET state = 'awaiting_human' WHERE id = ?", r.id);
    }
  }
}

function finishStep(req, step, output) {
  exec("UPDATE request_steps SET state = 'done', output = ?, ended_at = datetime('now') WHERE id = ?", String(output).slice(0, 20000), step.id);
  exec("UPDATE requests SET state = 'running' WHERE id = ?", req.id);
  audit({ actorType: 'agent', actorId: step.agent_id || 'system:requests', action: 'request.step_done', subjectType: 'request', subjectId: req.id, payload: { seq: step.seq, dept: step.dept } });
}

function completeRequest(r) {
  const req = getRequest(r.id);
  const body = [
    `# ${req.title}`,
    '',
    `**Requested by:** ${req.requester} · **Submitted:** ${req.created_at} · **Departments:** ${req.steps.length} · **Cost:** $${req.progress.costUsd.toFixed(4)}`,
    '',
    '## What was asked',
    req.body,
    '',
    req.plan_summary ? `## How it was routed\n${req.plan_summary}\n` : '',
    '## What each department produced',
    ...req.steps.map((s) => `\n### ${s.seq}. ${s.dept.toUpperCase()} — ${s.title}\n${s.agent_id ? `_${s.agent_id}_\n` : ''}\n${s.output || '_(no output)_'}\n`),
  ].join('\n');

  fs.mkdirSync(REQ_DIR, { recursive: true });
  const rel = `_requests/request-${r.id}-${slug(req.title)}.md`;
  fs.writeFileSync(path.join(WS_ROOT, rel), body, 'utf8');
  exec("UPDATE requests SET state = 'done', file_ref = ?, ended_at = datetime('now') WHERE id = ?", rel, r.id);
  archiveItem({
    title: `Request completed: ${req.title}`, kind: 'manual', subjectType: 'request', subjectId: r.id,
    snapshot: { departments: req.steps.map((s) => s.dept), costUsd: req.progress.costUsd }, fileRef: rel, actor: 'system:requests',
  });
  audit({ actorType: 'system', actorId: 'system:requests', action: 'request.completed', subjectType: 'request', subjectId: r.id, payload: { steps: req.steps.length, file: rel } });
  notify({ level: 'info', source: 'requests', message: `Request #${r.id} is done — “${req.title}” crossed ${req.steps.length} department(s). The deliverable is ready.`, subjectType: 'request', subjectId: r.id });
}

export function requestDeliverable(id) {
  const r = getRequest(id);
  if (!r) throw new Error('request not found');
  const body = r.file_ref && fs.existsSync(path.join(WS_ROOT, r.file_ref))
    ? fs.readFileSync(path.join(WS_ROOT, r.file_ref), 'utf8')
    : [`# ${r.title}`, '', r.body, '', ...r.steps.map((s) => `## ${s.dept} — ${s.title}\n${s.output || '_(pending)_'}`)].join('\n');
  return { body, filename: `request-${id}-${slug(r.title)}.md` };
}

export function requestsOverview() {
  const all = listRequests();
  return {
    total: all.length,
    open: all.filter((r) => ['triaging', 'running', 'awaiting_human'].includes(r.state)).length,
    done: all.filter((r) => r.state === 'done').length,
    needsHuman: all.filter((r) => r.state === 'awaiting_human').length,
    departmentsTouched: one('SELECT COUNT(DISTINCT dept) AS n FROM request_steps').n,
    stepsRun: one("SELECT COUNT(*) AS n FROM request_steps WHERE state = 'done'").n,
    requests: all,
  };
}
