// Planning division — Projects, the Task tracker (tasks are delegable to AI
// agents: the agents ARE the workforce), the Risk register (seeded from the
// blueprint's Part 7 register), and Quality reviews.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------- Projects ----------
export function createProject({ name, description = null, owner, productId = null, actor }) {
  if (!name?.trim() || !owner?.trim()) throw new Error('name and owner required');
  const id = slug(name);
  if (one('SELECT id FROM projects WHERE id = ?', id)) throw new Error('project exists');
  exec('INSERT INTO projects (id, name, description, owner, product_id) VALUES (?,?,?,?,?)',
    id, name.trim(), description, owner.trim(), productId);
  audit({ actorType: 'human', actorId: actor, action: 'project.created', subjectType: 'project', subjectId: id, payload: { owner, productId } });
  return getProject(id);
}

export function getProject(id) {
  const p = one('SELECT * FROM projects WHERE id = ?', id);
  if (!p) return null;
  const t = one(`SELECT COUNT(*) AS total, SUM(state = 'done') AS done, SUM(state = 'blocked') AS blocked FROM tasks WHERE project_id = ?`, id);
  return { ...p, tasks: { total: t.total, done: t.done || 0, blocked: t.blocked || 0 } };
}

export function listProjects() {
  return q('SELECT id FROM projects ORDER BY created_at DESC LIMIT 100').map((r) => getProject(r.id));
}

export function setProjectState(id, { state, actor }) {
  if (!one('SELECT id FROM projects WHERE id = ?', id)) throw new Error('project not found');
  exec('UPDATE projects SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `project.${state}`, subjectType: 'project', subjectId: id });
}

// ---------- Tasks (agents are the workforce) ----------
export function createTask({ title, details = null, projectId = null, assigneeType = 'human', assigneeId = null, priority = 'normal', dueDate = null, actor }) {
  if (!title?.trim()) throw new Error('title required');
  exec('INSERT INTO tasks (title, details, project_id, assignee_type, assignee_id, priority, due_date, created_by) VALUES (?,?,?,?,?,?,?,?)',
    title.trim(), details, projectId, assigneeType, assigneeId, priority, dueDate, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  // Delegating to an agent enqueues real work immediately.
  if (assigneeType === 'agent' && assigneeId) {
    const runId = enqueueRun({
      agentId: assigneeId,
      taskType: `task:${id}`,
      input: { prompt: `Task: ${title}\n${details ? `Details:\n${details}\n` : ''}${projectId ? `Project: ${projectId}` : ''}` },
      actor,
    });
    exec("UPDATE tasks SET run_id = ?, state = 'doing' WHERE id = ?", runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'task.created', subjectType: 'task', subjectId: id, payload: { title: title.slice(0, 120), assigneeType, assigneeId, projectId } });
  return one('SELECT * FROM tasks WHERE id = ?', id);
}

export function listTasks() {
  return q(`SELECT * FROM tasks ORDER BY (state = 'done' OR state = 'cancelled'),
            CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, id DESC LIMIT 300`);
}

export function setTaskState(id, { state, actor }) {
  const t = one('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw new Error('task not found');
  exec(`UPDATE tasks SET state = ?, done_at = CASE WHEN ? = 'done' AND done_at IS NULL THEN datetime('now') ELSE done_at END WHERE id = ?`, state, state, id);
  audit({ actorType: 'human', actorId: actor, action: `task.${state}`, subjectType: 'task', subjectId: id });
  return one('SELECT * FROM tasks WHERE id = ?', id);
}

/** Server tick: agent-delegated tasks follow their runs. */
export function syncTasks() {
  for (const t of q("SELECT * FROM tasks WHERE state = 'doing' AND run_id IS NOT NULL")) {
    const run = one('SELECT state FROM runs WHERE id = ?', t.run_id);
    if (!run) continue;
    if (run.state === 'done') {
      exec("UPDATE tasks SET state = 'done', done_at = datetime('now') WHERE id = ?", t.id);
      notify({ level: 'info', source: 'tasks', message: `Agent completed task #${t.id}: ${t.title}`, subjectType: 'task', subjectId: t.id });
    } else if (run.state === 'awaiting_human') {
      exec("UPDATE tasks SET state = 'blocked' WHERE id = ?", t.id);
      notify({ level: 'warn', source: 'tasks', message: `Task #${t.id} blocked at the human gate: ${t.title}`, subjectType: 'task', subjectId: t.id });
    } else if (['failed', 'cancelled'].includes(run.state)) {
      exec("UPDATE tasks SET state = 'blocked' WHERE id = ?", t.id);
    }
  }
  // Blocked tasks whose runs got resolved resume/done.
  for (const t of q("SELECT * FROM tasks WHERE state = 'blocked' AND run_id IS NOT NULL")) {
    const run = one('SELECT state FROM runs WHERE id = ?', t.run_id);
    if (run?.state === 'done') exec("UPDATE tasks SET state = 'done', done_at = datetime('now') WHERE id = ?", t.id);
  }
}

// ---------- Risk register (Part 7 §1) ----------
const SEED_RISKS = [
  { title: 'Market: product nobody pays for (RK-01)', likelihood: 4, impact: 4, mitigation: 'Gates 1-2 payment-intent evidence; pre-registration; kill triggers', owner: 'CEO' },
  { title: 'Silent quality debt in agent output (RK-02)', likelihood: 3, impact: 4, mitigation: 'Cross-family review, human merge gate, canary evals, M6 metric', owner: 'CTO' },
  { title: 'Founder bottleneck / bus factor (RK-03)', likelihood: 4, impact: 3, mitigation: 'Risk tiering, deputies, break-glass, load targets (People page)', owner: 'CEO' },
  { title: 'Security incident via agent toolchain (RK-05)', likelihood: 2, impact: 5, mitigation: 'Injection posture, canary secrets, tool provenance, pentest', owner: 'CTO' },
  { title: 'Cost runaway — tokens, debates, retries (RK-06)', likelihood: 3, impact: 3, mitigation: 'Reservation-first budgets, freezes, governance ≤5%', owner: 'CEO' },
  { title: 'Review theater / RACI fiction (RK-08)', likelihood: 3, impact: 3, mitigation: 'Canary defects, cross-audit, decision-delta metric', owner: 'CEO' },
];

export function seedRisks() {
  if (one('SELECT id FROM risks LIMIT 1')) return;
  const review = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  for (const r of SEED_RISKS) {
    exec('INSERT INTO risks (title, likelihood, impact, mitigation, owner, review_date, source) VALUES (?,?,?,?,?,?,?)',
      r.title, r.likelihood, r.impact, r.mitigation, r.owner, review, 'blueprint');
  }
}

export function listRisks() {
  return q(`SELECT *, likelihood * impact AS score FROM risks ORDER BY state = 'closed', score DESC, id`);
}

export function createRisk({ title, likelihood, impact, mitigation = null, owner, subjectType = null, subjectId = null, reviewDate = null, actor }) {
  if (!title?.trim() || !owner?.trim()) throw new Error('title and owner required');
  const l = Math.min(5, Math.max(1, Number(likelihood) || 3));
  const i = Math.min(5, Math.max(1, Number(impact) || 3));
  exec('INSERT INTO risks (title, likelihood, impact, mitigation, owner, subject_type, subject_id, review_date) VALUES (?,?,?,?,?,?,?,?)',
    title.trim(), l, i, mitigation, owner.trim(), subjectType, subjectId, reviewDate);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'risk.created', subjectType: 'risk', subjectId: id, payload: { score: l * i, owner } });
  return id;
}

export function setRiskState(id, { state, actor }) {
  if (!one('SELECT id FROM risks WHERE id = ?', id)) throw new Error('risk not found');
  exec('UPDATE risks SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `risk.${state}`, subjectType: 'risk', subjectId: id });
}

/** Immune rule: risk reviews past due surface as alerts. */
export function ruleRiskReviews() {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of q("SELECT * FROM risks WHERE state = 'open' AND review_date IS NOT NULL AND review_date < ?", today)) {
    notify({ level: 'warn', source: 'immune.risk', message: `Risk review overdue: ${r.title} (score ${r.likelihood * r.impact}).`, subjectType: 'risk', subjectId: r.id });
  }
}

// ---------- Quality ----------
export function qualityDashboard() {
  const evalAvg = one('SELECT AVG(score) AS s FROM (SELECT score FROM eval_runs ORDER BY id DESC LIMIT 10)')?.s;
  return {
    evalAvg: evalAvg ?? null,
    canaryLast: one("SELECT score, created_at FROM eval_runs WHERE kind = 'canary' ORDER BY id DESC LIMIT 1") || null,
    failedRuns7d: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'failed' AND created_at >= datetime('now','-7 days')").n,
    openProblems: one("SELECT COUNT(*) AS n FROM problems WHERE state = 'open'").n,
    openIncidents: one("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'").n,
    reviews: q('SELECT * FROM quality_reviews ORDER BY id DESC LIMIT 50'),
  };
}

export function addQualityReview({ area, verdict, notes = null, actor }) {
  if (!area?.trim() || !['pass', 'fail'].includes(verdict)) throw new Error('area and verdict (pass|fail) required');
  exec('INSERT INTO quality_reviews (area, verdict, notes, reviewer) VALUES (?,?,?,?)', area.trim(), verdict, notes, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'quality.reviewed', subjectType: 'quality', subjectId: id, payload: { area, verdict } });
  if (verdict === 'fail') notify({ level: 'warn', source: 'quality', message: `Quality review FAILED: ${area}`, subjectType: 'quality', subjectId: id });
  return id;
}
