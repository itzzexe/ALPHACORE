// PROCESSES THAT RUN — a published process document, walked step by step.
//
// The policies department writes a process as steps, each with who does it,
// what goes in and out, and the control that catches a mistake. Until now that
// was a document people followed somewhere else. Here it is the thing itself:
// starting a run copies the steps of the version in force, and each step waits
// for its role, with a due time.
//
// Two rules make it worth more than a checklist. A step with a control is done
// only when the person says the control was satisfied, and says how. And the
// person who did a step does not do the next step that carries a control —
// segregation of duties, enforced rather than hoped for. Every refusal, every
// late step and every control exception is on the record, so the audit of a
// process reads its runs instead of interviewing people about them.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { getSetting } from './settings.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);

/** Hours a step may take before it is late; one setting for the company, not per step yet. */
const stepHours = () => { const n = Number(getSetting('PROCESS_STEP_HOURS')); return Number.isFinite(n) && n > 0 ? n : 48; };
const dueFrom = () => new Date(Date.now() + stepHours() * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

export function startRun({ docId, title = '', actor }) {
  if (!isHuman(actor)) refuse('a person starts a process', 403);
  const d = one('SELECT * FROM pol_docs WHERE id = ?', Number(docId));
  if (!d) refuse('no such document', 404);
  if (d.state !== 'published') refuse('only a process in force can be run — publish it first');
  const steps = d.steps ? JSON.parse(d.steps) : [];
  if (!steps.length) refuse('this document has no steps to run');
  const r = exec('INSERT INTO proc_runs (doc_id, doc_code, version, title, created_by) VALUES (?,?,?,?,?)',
    d.id, d.code, d.version, clean(title, 200) || `${d.code} · ${d.title}`, actor);
  const id = Number(r.lastInsertRowid);
  steps.forEach((s, i) => exec('INSERT INTO proc_steps (run_id, idx, step, role, input, output, control) VALUES (?,?,?,?,?,?,?)',
    id, i, s.step, s.role, s.input || null, s.output || null, s.control || null));
  activate(id, 0);
  audit({ actorType: 'human', actorId: actor, action: 'process.started', subjectType: 'proc_run', subjectId: id, payload: { doc: d.code, version: d.version, steps: steps.length } });
  return getRun(id);
}

function activate(runId, idx) {
  exec("UPDATE proc_steps SET state = 'active', due_at = ? WHERE run_id = ? AND idx = ?", dueFrom(), runId, idx);
  exec('UPDATE proc_runs SET current = ? WHERE id = ?', idx, runId);
}

/** Take a step: the person says it is theirs, so the others know. */
export function claim({ runId, actor }) {
  if (!isHuman(actor)) refuse('a person takes a step', 403);
  const s = one("SELECT * FROM proc_steps WHERE run_id = ? AND state = 'active'", Number(runId));
  if (!s) refuse('nothing is waiting in this run');
  if (s.assignee && s.assignee !== actor) refuse(`${s.assignee.replace(/^human:/, '')} has already taken this step`);
  exec('UPDATE proc_steps SET assignee = ? WHERE id = ?', actor, s.id);
  return getRun(runId);
}

/**
 * Finish the active step. Where the step names a control, the person confirms
 * it held and says how; where the previous step's doer would be checking their
 * own work, they are refused.
 */
export function complete({ runId, note = '', controlOk = null, actor }) {
  if (!isHuman(actor)) refuse('a person completes a step', 403);
  const run = one('SELECT * FROM proc_runs WHERE id = ?', Number(runId));
  if (!run) refuse('no such run', 404);
  if (run.state !== 'open') refuse(`this run is ${run.state}`);
  const s = one("SELECT * FROM proc_steps WHERE run_id = ? AND state = 'active'", run.id);
  if (s.assignee && s.assignee !== actor) refuse(`this step is ${s.assignee.replace(/^human:/, '')}'s`);
  if (s.control) {
    const prev = s.idx > 0 ? one('SELECT done_by FROM proc_steps WHERE run_id = ? AND idx = ?', run.id, s.idx - 1) : null;
    if (prev?.done_by === actor) refuse('segregation of duties: whoever did the previous step does not perform the control on it');
    if (controlOk !== true) refuse(`confirm the control — “${s.control}” — or reject the step`);
    if (!clean(note)) refuse('say how the control was satisfied');
  }
  exec("UPDATE proc_steps SET state = 'done', done_by = ?, done_at = datetime('now'), note = ?, control_ok = ? WHERE id = ?",
    actor, clean(note, 2000) || null, s.control ? 1 : null, s.id);
  const next = one('SELECT idx FROM proc_steps WHERE run_id = ? AND idx = ?', run.id, s.idx + 1);
  if (next) activate(run.id, next.idx);
  else exec("UPDATE proc_runs SET state = 'done', closed_at = datetime('now') WHERE id = ?", run.id);
  audit({ actorType: 'human', actorId: actor, action: next ? 'process.step_done' : 'process.done', subjectType: 'proc_run', subjectId: run.id, payload: { step: s.idx + 1, control: Boolean(s.control) } });
  return getRun(run.id);
}

/** The control failed, or the step cannot be done: the run stops here, with the reason. */
export function reject({ runId, reason, actor }) {
  if (!isHuman(actor)) refuse('a person rejects a step', 403);
  if (!clean(reason)) refuse('say why');
  const run = one("SELECT * FROM proc_runs WHERE id = ? AND state = 'open'", Number(runId));
  if (!run) refuse('no such open run', 404);
  const s = one("SELECT * FROM proc_steps WHERE run_id = ? AND state = 'active'", run.id);
  exec("UPDATE proc_steps SET state = 'rejected', done_by = ?, done_at = datetime('now'), note = ?, control_ok = ? WHERE id = ?",
    actor, clean(reason, 2000), s.control ? 0 : null, s.id);
  exec("UPDATE proc_runs SET state = 'rejected', closed_at = datetime('now') WHERE id = ?", run.id);
  audit({ actorType: 'human', actorId: actor, action: 'process.rejected', subjectType: 'proc_run', subjectId: run.id, payload: { step: s.idx + 1, control: Boolean(s.control), reason: clean(reason, 200) } });
  return getRun(run.id);
}

export function cancel({ runId, reason, actor }) {
  if (!isHuman(actor)) refuse('a person cancels a run', 403);
  if (!clean(reason)) refuse('say why');
  const r = exec("UPDATE proc_runs SET state = 'cancelled', closed_at = datetime('now') WHERE id = ? AND state = 'open'", Number(runId));
  if (!r.changes) refuse('no such open run', 404);
  audit({ actorType: 'human', actorId: actor, action: 'process.cancelled', subjectType: 'proc_run', subjectId: Number(runId), payload: { reason: clean(reason, 200) } });
  return getRun(runId);
}

/** Steps past their due time are announced once each. */
export function lateSweep() {
  const late = q("SELECT s.*, r.title FROM proc_steps s JOIN proc_runs r ON r.id = s.run_id WHERE s.state = 'active' AND s.due_at < datetime('now') AND s.late_noted = 0");
  for (const s of late) {
    exec('UPDATE proc_steps SET late_noted = 1 WHERE id = ?', s.id);
    notify({ level: 'warn', source: 'procruns', message: `“${s.step}” in ${s.title} is late (${s.role})`, subjectType: 'proc_run', subjectId: s.run_id });
  }
  return { late: late.length };
}

export function getRun(id) {
  const r = one('SELECT * FROM proc_runs WHERE id = ?', Number(id));
  if (!r) refuse('no such run', 404);
  return { ...r, steps: q('SELECT * FROM proc_steps WHERE run_id = ? ORDER BY idx', r.id) };
}

export function overview({ actor = null } = {}) {
  const runs = q(`SELECT r.*, s.step AS active_step, s.role AS active_role, s.assignee AS active_assignee, s.due_at AS active_due, s.control AS active_control
                  FROM proc_runs r LEFT JOIN proc_steps s ON s.run_id = r.id AND s.state = 'active'
                  ORDER BY CASE r.state WHEN 'open' THEN 0 ELSE 1 END, r.id DESC LIMIT 100`);
  const processes = q(`SELECT d.id, d.code, d.title, d.version,
      (SELECT COUNT(*) FROM proc_runs r WHERE r.doc_id = d.id) AS runs,
      (SELECT COUNT(*) FROM proc_runs r WHERE r.doc_id = d.id AND r.state = 'rejected') AS rejected,
      (SELECT ROUND(AVG((julianday(r.closed_at) - julianday(r.created_at)) * 24), 1) FROM proc_runs r WHERE r.doc_id = d.id AND r.state = 'done') AS avg_hours
    FROM pol_docs d WHERE d.state = 'published' AND d.steps IS NOT NULL ORDER BY d.code`);
  return {
    runs,
    processes,
    mine: actor ? runs.filter((r) => r.state === 'open' && (!r.active_assignee || r.active_assignee === actor)).length : 0,
    late: one("SELECT COUNT(*) AS n FROM proc_steps WHERE state = 'active' AND due_at < datetime('now')").n,
    exceptions: one("SELECT COUNT(*) AS n FROM proc_steps WHERE control IS NOT NULL AND control_ok = 0").n,
    stepHours: stepHours(),
  };
}
