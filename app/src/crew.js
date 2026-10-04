// Workforce command — the AI runs the work; people do it and keep the judgment.
//
// This is where the company directs its human staff day to day: what each
// person is working on, what is late, what is blocked, who is overloaded, who
// has not checked in. An AI program manager drafts the plan — who should do
// what, by when — and dispatches it, nudges on what slips, reviews what comes
// back and writes the evidence of how the work went.
//
// What it cannot do is the part a person must be able to be asked about. It
// never rates a person (talent.js refuses that), never changes pay, never ends
// an employment: those stay categorically human elsewhere in the enterprise
// core, and nothing here reaches around them. A plan drafted by the AI is
// dispatched by a person, unless an owner has switched dispatch to autopilot —
// and even then the employee can push back, which a manager then rules on.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { openPii } from './erasure.js';
import { getSetting, setSetting } from './settings.js';

exec(`CREATE TABLE IF NOT EXISTS crew_assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES hr_employee(id),
  title        TEXT NOT NULL,
  details      TEXT,
  priority     TEXT NOT NULL DEFAULT 'normal',      -- low|normal|high|critical
  due_at       TEXT,
  estimate_h   REAL,
  state        TEXT NOT NULL DEFAULT 'assigned',    -- assigned|accepted|in_progress|blocked|submitted|approved|returned|declined|cancelled
  progress     INTEGER NOT NULL DEFAULT 0,
  blocker      TEXT,
  submission   TEXT,
  review_note  TEXT,
  ai_review    TEXT,
  source       TEXT NOT NULL DEFAULT 'manager',     -- manager|ai
  plan_id      INTEGER,
  assigned_by  TEXT NOT NULL,
  reviewed_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  closed_at    TEXT
)`);
exec(`CREATE TABLE IF NOT EXISTS crew_checkins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employee(id),
  day         TEXT NOT NULL,
  plan        TEXT,
  done        TEXT,
  blockers    TEXT,
  energy      INTEGER,                               -- 1..5, self-reported
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, day)
)`);
exec(`CREATE TABLE IF NOT EXISTS crew_nudges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES hr_employee(id),
  assignment_id INTEGER,
  kind          TEXT NOT NULL,                       -- overdue|blocked|stale|no_checkin|escalated
  message       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at       TEXT
)`);
exec(`CREATE TABLE IF NOT EXISTS crew_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  goal        TEXT NOT NULL,
  run_id      TEXT,
  state       TEXT NOT NULL DEFAULT 'drafting',      -- drafting|proposed|dispatched|discarded|failed
  proposal    TEXT,                                  -- JSON [{employeeId, title, details, priority, dueDays, estimateH, why}]
  rationale   TEXT,
  created_by  TEXT NOT NULL,
  decided_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
)`);
exec('CREATE INDEX IF NOT EXISTS crew_assign_emp ON crew_assignments (employee_id, state)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const PRIORITIES = ['low', 'normal', 'high', 'critical'];
const OPEN = ['assigned', 'accepted', 'in_progress', 'blocked', 'returned'];
const clean = (s, n = 4000) => String(s ?? '').trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);

export const autopilot = () => String(getSetting('CREW_AUTOPILOT') || 'false') === 'true';
export function setAutopilot(on, { actor }) {
  if (!isHuman(actor)) refuse('only a person switches dispatch to autopilot');
  setSetting('CREW_AUTOPILOT', on ? 'true' : 'false');
  audit({ actorType: 'human', actorId: actor, action: on ? 'crew.autopilot_on' : 'crew.autopilot_off', subjectType: 'crew', subjectId: 'dispatch' });
  return { autopilot: autopilot() };
}

// ----------------------------------------------------------------- roster --

export function roster() {
  return q(`SELECT e.id, e.employee_no, e.employment, e.manager_id, p.display_name AS name, pos.title AS position, u.name AS unit
            FROM hr_employee e JOIN hr_person p ON p.id = e.person_id
            LEFT JOIN hr_position pos ON pos.id = e.position_id
            LEFT JOIN hr_org_unit u ON u.id = e.org_unit_id
            WHERE e.state = 'active' ORDER BY p.display_name`);
}

function employee(id) {
  const e = one(`SELECT e.id, e.manager_id, p.display_name AS name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ? AND e.state = 'active'`, Number(id));
  if (!e) refuse('no such active employee');
  return e;
}

/** The employee a signed-in account belongs to, if any. */
export function employeeForUser(user) {
  if (!user) return null;
  const pid = one('SELECT person_id FROM users WHERE id = ?', user.id)?.person_id;
  if (!pid) return null;
  return one("SELECT id FROM hr_employee WHERE person_id = ? AND state = 'active' ORDER BY id DESC LIMIT 1", pid)?.id || null;
}

// ------------------------------------------------------------- assignments --

export function assign({ employeeId, title, details = null, priority = 'normal', dueAt = null, estimateH = null, source = null, planId = null, actor }) {
  const e = employee(employeeId);
  if (!clean(title, 200)) refuse('an assignment needs a title');
  if (!PRIORITIES.includes(priority)) refuse(`priority must be one of: ${PRIORITIES.join(', ')}`);
  if (dueAt && Number.isNaN(Date.parse(dueAt))) refuse('the due date is not a date');
  exec(`INSERT INTO crew_assignments (employee_id, title, details, priority, due_at, estimate_h, source, plan_id, assigned_by)
        VALUES (?,?,?,?,?,?,?,?,?)`, e.id, clean(title, 200), clean(details) || null, priority, dueAt || null,
  estimateH ? Number(estimateH) : null, source || (isHuman(actor) ? 'manager' : 'ai'), planId, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'crew.assigned', subjectType: 'crewAssignment', subjectId: id, payload: { employeeId: e.id, priority, dueAt } });
  return getAssignment(id);
}

export function getAssignment(id) {
  const a = one(`SELECT a.*, p.display_name AS employee FROM crew_assignments a JOIN hr_employee e ON e.id = a.employee_id
                 JOIN hr_person p ON p.id = e.person_id WHERE a.id = ?`, Number(id));
  if (!a) refuse('no such assignment', 404);
  return { ...a, overdue: Boolean(a.due_at && OPEN.includes(a.state) && a.due_at < new Date().toISOString()) };
}

export function listAssignments({ employeeId = null, state = null, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (employeeId) { where.push('a.employee_id = ?'); params.push(Number(employeeId)); }
  if (state === 'open') { where.push(`a.state IN (${OPEN.map(() => '?').join(',')})`); params.push(...OPEN); }
  else if (state) { where.push('a.state = ?'); params.push(state); }
  return q(`SELECT a.*, p.display_name AS employee FROM crew_assignments a JOIN hr_employee e ON e.id = a.employee_id
            JOIN hr_person p ON p.id = e.person_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(a.due_at, '9999'), a.id DESC LIMIT ?`, ...params, limit)
    .map((a) => ({ ...a, overdue: Boolean(a.due_at && OPEN.includes(a.state) && a.due_at < new Date().toISOString()) }));
}

const MOVES = {
  accept: { from: ['assigned', 'returned'], to: 'accepted', who: 'employee' },
  start: { from: ['assigned', 'accepted', 'returned', 'blocked'], to: 'in_progress', who: 'employee' },
  block: { from: ['assigned', 'accepted', 'in_progress', 'returned'], to: 'blocked', who: 'employee' },
  decline: { from: ['assigned'], to: 'declined', who: 'employee' },
  submit: { from: ['accepted', 'in_progress', 'returned', 'blocked'], to: 'submitted', who: 'employee' },
  approve: { from: ['submitted'], to: 'approved', who: 'manager' },
  return: { from: ['submitted'], to: 'returned', who: 'manager' },
  cancel: { from: OPEN.concat(['submitted', 'declined']), to: 'cancelled', who: 'manager' },
  reassign: { from: OPEN.concat(['declined']), to: 'assigned', who: 'manager' },
};

/**
 * Move an assignment. The employee moves their own work; a manager — a person
 * with crew.manage — approves, returns, cancels and reassigns. An AI may
 * reassign and cancel what it dispatched, but never approves its own plan's
 * output as done: approval is a person looking at the work.
 */
export function move(id, { action, note = null, progress = null, submission = null, toEmployeeId = null, actor, asManager = false, selfEmployeeId = null }) {
  const a = getAssignment(id);
  const m = MOVES[action];
  if (!m) refuse(`unknown action: ${action}`);
  if (m.who === 'employee' && !asManager && selfEmployeeId !== a.employee_id) refuse('only the person it is assigned to can do that', 403);
  if (m.who === 'manager' && !asManager) refuse('that needs a manager', 403);
  if (!m.from.includes(a.state)) refuse(`cannot ${action} an assignment that is ${a.state}`);
  if (action === 'approve' && !isHuman(actor)) refuse('work is approved by a person who looked at it');
  if (action === 'block' && !clean(note)) refuse('say what is blocking it');
  if (action === 'decline' && !clean(note)) refuse('say why it is being declined');
  if (action === 'submit' && !clean(submission || note)) refuse('describe what was done, or link to it');
  let employeeId = a.employee_id;
  if (action === 'reassign') { employeeId = employee(toEmployeeId).id; }
  exec(`UPDATE crew_assignments SET state = ?, employee_id = ?, updated_at = datetime('now'),
        blocker = CASE WHEN ? = 'blocked' THEN ? WHEN ? IN ('in_progress','submitted') THEN NULL ELSE blocker END,
        submission = COALESCE(?, submission), review_note = CASE WHEN ? IN ('approved','returned') THEN ? ELSE review_note END,
        progress = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 'submitted' THEN 100 ELSE progress END,
        submitted_at = CASE WHEN ? = 'submitted' THEN datetime('now') ELSE submitted_at END,
        reviewed_by = CASE WHEN ? IN ('approved','returned') THEN ? ELSE reviewed_by END,
        closed_at = CASE WHEN ? IN ('approved','cancelled','declined') THEN datetime('now') ELSE NULL END WHERE id = ?`,
  m.to, employeeId, m.to, clean(note) || null, m.to,
  action === 'submit' ? clean(submission || note) : null, m.to, clean(note) || null,
  progress, progress == null ? null : Math.max(0, Math.min(100, Number(progress))), m.to,
  m.to, m.to, actor, m.to, a.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `crew.${action}`, subjectType: 'crewAssignment', subjectId: a.id, payload: { from: a.state, to: m.to } });
  if (action === 'block') {
    notify({ level: 'warn', source: 'crew', message: `${a.employee} is blocked on "${a.title}": ${clean(note, 160)}`, subjectType: 'crewAssignment', subjectId: a.id });
  }
  if (action === 'decline') {
    notify({ level: 'warn', source: 'crew', message: `${a.employee} declined "${a.title}": ${clean(note, 160)} — a manager decides what happens next.`, subjectType: 'crewAssignment', subjectId: a.id });
  }
  if (action === 'submit') reviewSubmission(a.id, actor);
  return getAssignment(a.id);
}

export function setProgress(id, { progress, selfEmployeeId, asManager = false, actor }) {
  const a = getAssignment(id);
  if (!asManager && selfEmployeeId !== a.employee_id) refuse('only the person it is assigned to can do that', 403);
  if (!OPEN.includes(a.state)) refuse(`this assignment is ${a.state}`);
  const pct = Math.max(0, Math.min(100, Number(progress) || 0));
  exec("UPDATE crew_assignments SET progress = ?, state = CASE WHEN state IN ('assigned','accepted') THEN 'in_progress' ELSE state END, updated_at = datetime('now') WHERE id = ?", pct, a.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'crew.progress', subjectType: 'crewAssignment', subjectId: a.id, payload: { progress: pct } });
  return getAssignment(a.id);
}

/** The reviewer reads what came back and writes evidence — never a verdict on the person. */
function reviewSubmission(id, actor) {
  const a = getAssignment(id);
  try {
    const runId = enqueueRun({
      agentId: 'AGT-QA-001',
      taskType: `crew:review:${a.id}`,
      actor,
      input: {
        prompt: `[CREW-REVIEW] Review submitted work against what was asked. Comment on the WORK only — completeness, gaps, risks, next steps. Never grade or judge the person.
Asked: ${a.title}
Details: ${a.details || '(none)'}
Submitted: ${a.submission || '(see note)'}
Output JSON: {"verdict":"green|red","report":[{"criterion":"","status":"pass|fail|unclear","evidence":""}],"summary":"","confidence":0.0}`,
      },
    });
    exec('UPDATE crew_assignments SET ai_review = ? WHERE id = ?', JSON.stringify({ runId, state: 'drafting' }), a.id);
  } catch { /* the reviewer is optional; a manager can still decide */ }
}

// ----------------------------------------------------------------- check-ins --

export function checkIn({ employeeId, plan = null, done = null, blockers = null, energy = null, actor }) {
  const e = employee(employeeId);
  const day = today();
  exec(`INSERT INTO crew_checkins (employee_id, day, plan, done, blockers, energy) VALUES (?,?,?,?,?,?)
        ON CONFLICT(employee_id, day) DO UPDATE SET plan = COALESCE(excluded.plan, plan), done = COALESCE(excluded.done, done),
        blockers = COALESCE(excluded.blockers, blockers), energy = COALESCE(excluded.energy, energy)`,
  e.id, day, clean(plan) || null, clean(done) || null, clean(blockers) || null, energy ? Math.max(1, Math.min(5, Number(energy))) : null);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'crew.checkin', subjectType: 'employee', subjectId: e.id, payload: { day } });
  if (clean(blockers)) notify({ level: 'warn', source: 'crew', message: `${e.name} reports a blocker: ${clean(blockers, 160)}`, subjectType: 'employee', subjectId: e.id });
  return one('SELECT * FROM crew_checkins WHERE employee_id = ? AND day = ?', e.id, day);
}

export function checkinsFor({ day = null, employeeId = null } = {}) {
  if (employeeId) return q('SELECT * FROM crew_checkins WHERE employee_id = ? ORDER BY day DESC LIMIT 30', Number(employeeId));
  return q(`SELECT c.*, p.display_name AS employee FROM crew_checkins c JOIN hr_employee e ON e.id = c.employee_id
            JOIN hr_person p ON p.id = e.person_id WHERE c.day = ? ORDER BY p.display_name`, day || today());
}

// --------------------------------------------------------------- scorecard --

/**
 * What the record says about how the work went. Facts, not a rating: counts,
 * rates and times a manager can read and question. The rating stays human.
 */
export function workload(employeeId = null) {
  const people = employeeId ? [employee(employeeId)] : roster();
  const nowIso = new Date().toISOString();
  return people.map((p) => {
    const rows = q("SELECT state, due_at, estimate_h, created_at, submitted_at, closed_at FROM crew_assignments WHERE employee_id = ? AND created_at >= datetime('now','-90 days')", p.id);
    const open = rows.filter((r) => OPEN.includes(r.state));
    const finished = rows.filter((r) => r.state === 'approved');
    const onTime = finished.filter((r) => !r.due_at || (r.submitted_at || r.closed_at) <= r.due_at.replace('T', ' ').slice(0, 19));
    const cycle = finished.map((r) => (Date.parse(`${r.submitted_at || r.closed_at}Z`) - Date.parse(`${r.created_at}Z`)) / 36e5).filter((h) => h >= 0);
    const att = one("SELECT COUNT(*) AS days, COALESCE(SUM(minutes),0) AS minutes FROM time_attendance WHERE employee_id = ? AND day >= date('now','-30 days')", p.id);
    const checkins = one("SELECT COUNT(*) AS n FROM crew_checkins WHERE employee_id = ? AND day >= date('now','-14 days')", p.id).n;
    const loadH = open.reduce((s, r) => s + (Number(r.estimate_h) || 4), 0);
    return {
      employeeId: p.id,
      name: p.name,
      position: p.position || null,
      unit: p.unit || null,
      open: open.length,
      overdue: open.filter((r) => r.due_at && r.due_at < nowIso).length,
      blocked: open.filter((r) => r.state === 'blocked').length,
      awaitingReview: rows.filter((r) => r.state === 'submitted').length,
      approved90: finished.length,
      onTimeRate: finished.length ? Math.round((onTime.length / finished.length) * 100) : null,
      avgCycleH: cycle.length ? Math.round(cycle.reduce((a, b) => a + b, 0) / cycle.length) : null,
      loadH,
      attendanceDays30: att.days,
      attendanceHours30: Math.round(att.minutes / 60),
      checkins14: checkins,
      signal: open.filter((r) => r.due_at && r.due_at < nowIso).length ? 'late' : open.some((r) => r.state === 'blocked') ? 'blocked' : loadH > 40 ? 'overloaded' : open.length === 0 ? 'free' : 'ok',
    };
  });
}

// -------------------------------------------------------------- AI dispatch --

/** Ask the program manager to plan who should do what. */
export function planWork({ goal, horizonDays = 7, actor }) {
  if (!clean(goal)) refuse('say what the team should achieve');
  const team = workload();
  if (!team.length) refuse('there is nobody on the roster yet — add employees in the enterprise core first');
  exec('INSERT INTO crew_plans (goal, created_by) VALUES (?,?)', clean(goal), actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-PMO-001',
    taskType: `crew:plan:${id}`,
    actor,
    input: {
      prompt: `[CREW-PLAN] You are dispatching work to a team of HUMAN employees. Break the goal into concrete assignments a person can finish, and give each to the best-placed person given role and current load. Do not overload anyone past ~40 hours of open work. Never assign anything about pay, discipline, hiring or firing.
Goal: ${clean(goal)}
Horizon: ${Number(horizonDays) || 7} days
Team (employeeId, name, position, unit, open items, open hours, overdue):
${team.map((t) => `${t.employeeId} | ${t.name} | ${t.position || '-'} | ${t.unit || '-'} | ${t.open} | ${t.loadH}h | ${t.overdue}`).join('\n')}
Output JSON: {"assignments":[{"employeeId":0,"title":"","details":"","priority":"low|normal|high|critical","dueDays":3,"estimateH":4,"why":""}],"rationale":"","confidence":0.0}`,
    },
  });
  exec('UPDATE crew_plans SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'crew.plan_requested', subjectType: 'crewPlan', subjectId: id, payload: { runId } });
  return getPlan(id);
}

export function getPlan(id) {
  const p = one('SELECT * FROM crew_plans WHERE id = ?', Number(id));
  if (!p) refuse('no such plan', 404);
  const names = new Map(roster().map((r) => [r.id, r.name]));
  return { ...p, proposal: JSON.parse(p.proposal || '[]').map((x) => ({ ...x, employee: names.get(Number(x.employeeId)) || `#${x.employeeId}` })) };
}

export function listPlans() {
  return q('SELECT id FROM crew_plans ORDER BY id DESC LIMIT 20').map((r) => getPlan(r.id));
}

/** Dispatch a proposed plan: every line becomes an assignment. */
export function dispatchPlan(id, { only = null, actor }) {
  const p = getPlan(id);
  if (p.state !== 'proposed') refuse(`this plan is ${p.state}`);
  if (!isHuman(actor) && !autopilot()) refuse('dispatch is a person\'s decision unless an owner has switched it to autopilot');
  const ids = new Set(roster().map((r) => r.id));
  const made = [];
  p.proposal.forEach((x, i) => {
    if (only && !only.includes(i)) return;
    if (!ids.has(Number(x.employeeId))) return;
    const due = x.dueDays ? new Date(Date.now() + Number(x.dueDays) * 864e5).toISOString() : null;
    made.push(assign({ employeeId: Number(x.employeeId), title: x.title, details: [x.details, x.why ? `Why you: ${x.why}` : null].filter(Boolean).join('\n\n'), priority: PRIORITIES.includes(x.priority) ? x.priority : 'normal', dueAt: due, estimateH: x.estimateH || null, source: 'ai', planId: p.id, actor }).id);
  });
  exec("UPDATE crew_plans SET state = 'dispatched', decided_by = ?, decided_at = datetime('now') WHERE id = ?", actor, p.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'crew.plan_dispatched', subjectType: 'crewPlan', subjectId: p.id, payload: { assignments: made.length } });
  return { ok: true, assignments: made };
}

export function discardPlan(id, { actor }) {
  const p = getPlan(id);
  if (!['proposed', 'drafting'].includes(p.state)) refuse(`this plan is ${p.state}`);
  exec("UPDATE crew_plans SET state = 'discarded', decided_by = ?, decided_at = datetime('now') WHERE id = ?", actor, p.id);
  return { ok: true };
}

const parsedOf = (runId) => {
  const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', runId);
  if (!run || ['queued', 'leased', 'running'].includes(run.state)) return { pending: true };
  try { return { run, parsed: run.output ? JSON.parse(openPii(run.output))?.parsed : null }; } catch { return { run, parsed: null }; }
};

/** Server tick: plans and reviews coming back, and the nudges. */
export function syncCrew() {
  for (const p of q("SELECT * FROM crew_plans WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const r = parsedOf(p.run_id);
    if (r.pending) continue;
    const list = Array.isArray(r.parsed?.assignments) ? r.parsed.assignments.filter((x) => x && x.title && x.employeeId).slice(0, 40) : [];
    if (!list.length) { exec("UPDATE crew_plans SET state = 'failed', rationale = ? WHERE id = ?", r.parsed?.rationale || r.run?.failure_reason || 'the planner returned no assignments', p.id); continue; }
    exec("UPDATE crew_plans SET state = 'proposed', proposal = ?, rationale = ? WHERE id = ?", JSON.stringify(list), clean(r.parsed.rationale), p.id);
    if (autopilot()) { try { dispatchPlan(p.id, { actor: 'agent:AGT-PMO-001' }); } catch { /* left proposed */ } }
    else notify({ level: 'info', source: 'crew', message: `A work plan is ready: ${list.length} assignment(s) for "${p.goal.slice(0, 60)}". Review and dispatch.`, subjectType: 'crewPlan', subjectId: p.id });
  }
  for (const a of q("SELECT id, ai_review FROM crew_assignments WHERE ai_review LIKE '%\"drafting\"%'")) {
    const meta = JSON.parse(a.ai_review);
    const r = parsedOf(meta.runId);
    if (r.pending) continue;
    exec('UPDATE crew_assignments SET ai_review = ? WHERE id = ?', JSON.stringify({ runId: meta.runId, state: 'done', verdict: r.parsed?.verdict || null, summary: r.parsed?.summary || null, report: r.parsed?.report || [] }), a.id);
  }
}

/** Hourly: say what is slipping, once per thing per day, to the person and then up the line. */
export function crewSweep() {
  const nowIso = new Date().toISOString();
  const already = (empId, assignmentId, kind) => one("SELECT id FROM crew_nudges WHERE employee_id = ? AND COALESCE(assignment_id,0) = ? AND kind = ? AND created_at >= date('now')", empId, assignmentId || 0, kind);
  const nudge = (empId, assignmentId, kind, message) => {
    if (already(empId, assignmentId, kind)) return 0;
    exec('INSERT INTO crew_nudges (employee_id, assignment_id, kind, message) VALUES (?,?,?,?)', empId, assignmentId, kind, message);
    return 1;
  };
  let sent = 0;
  for (const a of listAssignments({ state: 'open' })) {
    if (a.due_at && a.due_at < nowIso) {
      sent += nudge(a.employee_id, a.id, 'overdue', `"${a.title}" was due ${a.due_at.slice(0, 10)}. Update it, ask for more time, or say what is in the way.`);
      const days = (Date.now() - Date.parse(a.due_at)) / 864e5;
      if (days > 2 && nudge(a.employee_id, a.id, 'escalated', `"${a.title}" is ${Math.floor(days)} days late — escalated to the manager.`)) {
        sent++;
        notify({ level: 'warn', source: 'crew', message: `${a.employee}: "${a.title}" is ${Math.floor(days)} days overdue.`, subjectType: 'crewAssignment', subjectId: a.id });
      }
    }
    if (a.state === 'blocked' && (Date.now() - Date.parse(`${a.updated_at}Z`)) > 864e5) {
      sent += nudge(a.employee_id, a.id, 'blocked', `"${a.title}" has been blocked for over a day: ${a.blocker || ''}`);
    }
    if (['assigned'].includes(a.state) && (Date.now() - Date.parse(`${a.created_at}Z`)) > 2 * 864e5) {
      sent += nudge(a.employee_id, a.id, 'stale', `"${a.title}" was assigned two days ago and has not been picked up.`);
    }
  }
  const hour = new Date().getHours();
  if (hour >= Number(getSetting('CREW_CHECKIN_HOUR') || 11)) {
    for (const p of roster()) {
      if (one('SELECT id FROM crew_checkins WHERE employee_id = ? AND day = ?', p.id, today())) continue;
      if (!one(`SELECT id FROM crew_assignments WHERE employee_id = ? AND state IN (${OPEN.map(() => '?').join(',')})`, p.id, ...OPEN)) continue;
      sent += nudge(p.id, null, 'no_checkin', 'No check-in yet today: a line on what you plan, what is done, and anything blocking.');
    }
  }
  return { sent };
}

export function nudgesFor(employeeId) {
  return q('SELECT * FROM crew_nudges WHERE employee_id = ? ORDER BY id DESC LIMIT 30', Number(employeeId));
}
export function seeNudges(employeeId) {
  exec("UPDATE crew_nudges SET seen_at = datetime('now') WHERE employee_id = ? AND seen_at IS NULL", Number(employeeId));
  return { ok: true };
}

/** One employee's own view: their work, their nudges, their check-ins. */
export function mine(employeeId) {
  if (!employeeId) return { linked: false, assignments: [], nudges: [], checkins: [] };
  return {
    linked: true,
    employeeId,
    assignments: listAssignments({ employeeId }).filter((a) => !['cancelled'].includes(a.state)).slice(0, 60),
    nudges: nudgesFor(employeeId),
    checkins: checkinsFor({ employeeId }),
    today: one('SELECT * FROM crew_checkins WHERE employee_id = ? AND day = ?', employeeId, today()) || null,
    workload: workload(employeeId)[0],
  };
}

export function crewOverview() {
  const team = workload();
  const n = (sql, ...a) => one(sql, ...a).n;
  return {
    people: team.length,
    open: team.reduce((s, t) => s + t.open, 0),
    overdue: team.reduce((s, t) => s + t.overdue, 0),
    blocked: team.reduce((s, t) => s + t.blocked, 0),
    awaitingReview: team.reduce((s, t) => s + t.awaitingReview, 0),
    checkedInToday: n('SELECT COUNT(*) AS n FROM crew_checkins WHERE day = ?', today()),
    plansWaiting: n("SELECT COUNT(*) AS n FROM crew_plans WHERE state = 'proposed'"),
    aiAssigned30: n("SELECT COUNT(*) AS n FROM crew_assignments WHERE source = 'ai' AND created_at >= datetime('now','-30 days')"),
    autopilot: autopilot(),
  };
}
