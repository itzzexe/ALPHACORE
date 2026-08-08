// The iteration engine — work that goes around, not just through.
//
// Until now a task was a straight line: give it to an agent, get one answer.
// A real company circles: produce → peers review → an independent auditor
// scores → the work is revised with everything learned → and it goes round
// again until it is genuinely good, with a human able to drop a note into any
// lap that the next round must honour.
//
// Three methodologies, chosen per workstream (or per request):
//   waterfall — sequential departments, one pass each, gate between phases.
//               A failed audit does not silently re-loop: it stops for a human.
//   scrum     — fixed-length iterations (sprints) with a cycle budget; work
//               that misses the quality bar carries into the next iteration.
//   kaizen    — continuous improvement: loop until the audit score clears the
//               target or the cycle budget is spent. The default.
//
// Every round is: PRODUCE → PEER REVIEW (N independent agents) → AI AUDIT →
// decide. The auditor is universal: any department can send any output to it
// (requestAudit), so quality is judged in one place by one standard.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { parseAgentJson } from './router.js';

export const METHODS = {
  waterfall: { label: 'Waterfall', loops: false, defaultCycles: 1, note: 'One pass per department, gate between phases; a failed audit stops for a human.' },
  scrum: { label: 'Scrum', loops: true, defaultCycles: 3, note: 'Iterations with a cycle budget; unfinished quality carries to the next iteration.' },
  kaizen: { label: 'Agile · continuous improvement', loops: true, defaultCycles: 4, note: 'Loop until the audit clears the target or the budget is spent.' },
};

// Department → the agent that speaks for it. Resolved against the live roster,
// so a department whose specialist was retired still finds a stand-in.
const DEPT_AGENT = {
  research: 'AGT-RES-001', product: 'AGT-PM-001', analysis: 'AGT-BA-001',
  architecture: 'AGT-ARC-001', engineering: 'AGT-ENG-001', review: 'AGT-REV-001',
  qa: 'AGT-QA-001', security: 'AGT-SEC-001', docs: 'AGT-DOC-001',
  design: 'AGT-DES-001', content: 'AGT-CNT-001', data: 'AGT-DATA-001',
  intel: 'AGT-INT-001', finance: 'AGT-FIN-001', legal: 'AGT-LEG-001',
  ops: 'AGT-MON-001', support: 'AGT-SUP-001', localization: 'AGT-LOC-001',
  sales: 'AGT-SLS-001', marketing: 'AGT-SMM-001', infra: 'AGT-INF-001',
  pmo: 'AGT-PMO-001', ethics: 'AGT-ETH-001', hr: 'AGT-HR-001',
};
export const DEPARTMENTS = Object.keys(DEPT_AGENT);

const alive = (id) => Boolean(id) && Boolean(one("SELECT id FROM agents WHERE id = ? AND status = 'active'", id));
const anyAgent = (...prefer) => prefer.find(alive) || one("SELECT id FROM agents WHERE status = 'active' ORDER BY id LIMIT 1")?.id;
const agentFor = (dept) => anyAgent(DEPT_AGENT[dept], 'AGT-DOC-001');
/** The auditor: ethics/policy first, then QA, then the independent reviewer. */
const auditorAgent = () => anyAgent('AGT-ETH-001', 'AGT-QA-001', 'AGT-REV-001');
/** Peer reviewers: never the producer, prefer the cross-family reviewer. */
function reviewerAgents(exclude, want = 2) {
  const pool = ['AGT-REV-001', 'AGT-QA-001', 'AGT-SEC-001', 'AGT-ETH-001', 'AGT-ARC-001', 'AGT-BA-001']
    .filter((id) => id !== exclude && alive(id));
  if (pool.length >= want) return pool.slice(0, want);
  const extra = q("SELECT id FROM agents WHERE status = 'active' AND id != ? ORDER BY id", exclude)
    .map((a) => a.id).filter((id) => !pool.includes(id));
  return [...pool, ...extra].slice(0, Math.max(1, want));
}

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const J = (v, fallback = null) => { try { return JSON.parse(v); } catch { return fallback; } };

/**
 * Readable text out of a run that has produced something.
 *
 * `awaiting_human` counts: review roles are fail-closed by design, so their
 * output exists but the run waits at the gate. The cycle consumes that text
 * internally — nothing is published from it — while the run stays in the
 * approvals inbox and the workstream still ends on a human acceptance.
 */
function runOutput(runId) {
  const r = runId && one('SELECT state, output FROM runs WHERE id = ?', runId);
  if (!r || !['done', 'awaiting_human'].includes(r.state) || !r.output) return null;
  let o = J(r.output);
  // Agents that miss the JSON contract land as {raw:"..."} — often a fenced
  // block or JSON with prose around it. The router's extractor recovers those
  // rather than letting the wrapper leak into the artifact.
  if (o && typeof o.raw === 'string') o = J(o.raw) ?? parseAgentJson(o.raw) ?? { text: o.raw };
  if (!o) return String(r.output);
  return { obj: o, text: o.text || o.draft || o.body || o.content || o.summary || o.notes || JSON.stringify(o, null, 2) };
}
const runFailed = (runId) => {
  const s = runId && one('SELECT state FROM runs WHERE id = ?', runId)?.state;
  return ['failed', 'cancelled'].includes(s);
};
const runGated = (runId) => runId && one('SELECT state FROM runs WHERE id = ?', runId)?.state === 'awaiting_human';

// Scores may arrive as 0-1 or 0-100; normalise and clamp.
const norm = (v) => {
  let n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1) n /= 100;
  return Math.max(0, Math.min(1, n));
};

/**
 * Reviewers and auditors are independent specialists, not a form to fill in:
 * one returns {verdict:"request-changes", findings:[{severity,claim}]}, the
 * next returns {report:[{criterion,status,evidence}]}. Rather than forcing a
 * single schema and discarding whatever does not match, read the judgement out
 * of any reasonable shape — a lost finding is a defect that ships.
 */
const asFinding = (f) => {
  if (typeof f === 'string') return f;
  if (!f || typeof f !== 'object') return null;
  const head = f.claim || f.issue || f.finding || f.problem || f.detail || f.text || f.note || f.recommendation
    || (f.criterion ? `${f.criterion}: ${f.evidence || f.status || ''}` : null);
  if (!head) return null;
  const sev = f.severity || f.priority;
  return `${sev ? `[${sev}] ` : ''}${String(head).slice(0, 400)}`;
};

function readJudgement(o = {}) {
  const lists = [o.findings, o.issues, o.blockers, o.gaps, o.defects, o.problems].filter(Array.isArray);
  const findings = lists.flat().map(asFinding).filter(Boolean);
  // A criterion-by-criterion report doubles as findings and as a score.
  const report = Array.isArray(o.report) ? o.report : Array.isArray(o.criteria) ? o.criteria : [];
  const judged = report.filter((r) => r && typeof r === 'object' && r.status);
  for (const r of judged) {
    if (!/^(pass|ok|met|yes|true)$/i.test(String(r.status))) {
      const f = asFinding(r);
      if (f) findings.push(f);
    }
  }
  let score = norm(o.score ?? o.rating ?? o.quality);
  if (score == null && judged.length) {
    score = judged.filter((r) => /^(pass|ok|met|yes|true)$/i.test(String(r.status))).length / judged.length;
  }
  const raw = String(o.verdict || o.decision || o.recommendation || '').toLowerCase();
  const verdict = /accept|approve|^pass|ship|go\b/.test(raw) ? 'accept'
    : /reject|fail|block|no-go/.test(raw) ? 'reject'
    : raw ? 'revise'
    : score != null ? (score >= 0.85 ? 'accept' : score >= 0.6 ? 'revise' : 'reject')
    : 'revise';
  // No explicit number anywhere: infer from the verdict so a round still moves.
  if (score == null) score = verdict === 'accept' ? 0.9 : verdict === 'reject' ? 0.35 : 0.65;
  return { score, verdict, findings: findings.slice(0, 10), summary: o.summary || o.assessment || null };
}

// ---------- workstreams ----------
export function createWorkstream({
  title, goal, method = 'kaizen', route = null, qualityTarget = 0.85, maxCycles = null,
  reviewers = 2, subjectType = null, subjectId = null, actor,
}) {
  if (!title?.trim() || !goal?.trim()) throw new Error('title and goal required');
  if (!METHODS[method]) throw new Error(`method must be one of: ${Object.keys(METHODS).join('|')}`);
  const path = (Array.isArray(route) && route.length ? route : ['research', 'engineering', 'docs'])
    .map((d) => String(d).trim()).filter((d) => DEPT_AGENT[d]);
  if (!path.length) throw new Error('route must contain known departments');
  const cycles = Math.min(8, Math.max(1, Number(maxCycles) || METHODS[method].defaultCycles));
  exec(`INSERT INTO workstreams (title, goal, method, route, quality_target, max_cycles, reviewers, subject_type, subject_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    title.trim(), goal.trim(), method, JSON.stringify(path), Number(qualityTarget) || 0.85, cycles,
    Math.min(4, Math.max(1, Number(reviewers) || 2)), subjectType, subjectId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'workstream.created', subjectType: 'workstream', subjectId: id, payload: { title, method, route: path, qualityTarget, maxCycles: cycles } });
  startCycle(id, path[0], 1, null);
  return id;
}

/** Open a new round: the producer gets the goal plus everything learned so far. */
function startCycle(wsId, dept, seq, feedback) {
  const ws = one('SELECT * FROM workstreams WHERE id = ?', wsId);
  const agentId = agentFor(dept);
  if (!agentId) throw new Error('no active agent available to produce');
  const prev = feedback?.previous ? `\n\n--- PREVIOUS VERSION (improve it, do not restart) ---\n${feedback.previous}` : '';
  const peer = feedback?.reviews?.length
    ? `\n\n--- PEER REVIEW FINDINGS (address every one) ---\n${feedback.reviews.map((r, i) => `${i + 1}. [${r.reviewer}] score ${r.score ?? '—'}: ${(r.findings || []).join(' · ') || r.verdict || ''}`).join('\n')}` : '';
  const aud = feedback?.auditFindings?.length
    ? `\n\n--- AUDITOR FINDINGS (blocking) ---\n${feedback.auditFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '';
  const notes = feedback?.notes?.length
    ? `\n\n--- HUMAN INSTRUCTIONS (highest priority, obey exactly) ---\n${feedback.notes.map((n) => `• ${n}`).join('\n')}` : '';
  const handoff = feedback?.handoff
    ? `\n\nYou are the ${dept} department receiving this work from the ${feedback.handoff} department. Advance it with your specialty; keep what is already correct.` : '';

  const runId = enqueueRun({
    agentId,
    taskType: `cycle:${wsId}:${seq}:${dept}`,
    input: { prompt: `GOAL: ${ws.goal}\nTITLE: ${ws.title}\nDEPARTMENT: ${dept}\nROUND: ${seq} of up to ${ws.max_cycles}${handoff}${prev}${peer}${aud}${notes}\n\nProduce the best possible version of this work. Reply as JSON {"text": "<the full work product>", "changes": ["what you changed and why"]}.` },
    actor: ws.created_by,
  });
  exec('INSERT INTO cycles (workstream_id, seq, dept, phase, produce_run) VALUES (?,?,?,?,?)', wsId, seq, dept, 'produce', runId);
  exec("UPDATE workstreams SET current_cycle = ?, current_dept = ?, state = 'running' WHERE id = ?", seq, dept, wsId);
  audit({ actorType: 'system', actorId: 'cycles', action: 'cycle.started', subjectType: 'workstream', subjectId: wsId, payload: { seq, dept, agentId, hasFeedback: Boolean(feedback) } });
  return lastId();
}

/** The tick: move every live workstream one phase forward when its runs land. */
export function advanceWorkstreams() {
  for (const ws of q("SELECT * FROM workstreams WHERE state = 'running'")) {
    const c = one('SELECT * FROM cycles WHERE workstream_id = ? ORDER BY id DESC LIMIT 1', ws.id);
    if (!c || c.state !== 'running') continue;

    if (c.phase === 'produce') {
      if (runFailed(c.produce_run)) { pause(ws, c, 'The producing run failed.'); continue; }
      const out = runOutput(c.produce_run);
      if (!out) continue;
      exec('UPDATE cycles SET output = ?, phase = ?, gated = ? WHERE id = ?',
        out.text, 'review', runGated(c.produce_run) ? 1 : 0, c.id);
      const producer = one('SELECT agent_id FROM runs WHERE id = ?', c.produce_run)?.agent_id;
      const ids = reviewerAgents(producer, ws.reviewers).map((agentId) => enqueueRun({
        agentId,
        taskType: `cycle-review:${ws.id}:${c.seq}`,
        input: { prompt: `You are an independent peer reviewer. You did NOT write this. Review it against the goal and be specific and hard to please.\nGOAL: ${ws.goal}\n\n--- WORK UNDER REVIEW ---\n${out.text.slice(0, 12000)}\n\nReply as JSON {"score": 0.0-1.0, "verdict": "accept|revise|reject", "findings": ["concrete, actionable defect or gap", "..."]}.` },
        actor: ws.created_by,
      }));
      exec('UPDATE cycles SET review_runs = ? WHERE id = ?', JSON.stringify(ids), c.id);
      continue;
    }

    if (c.phase === 'review') {
      const ids = J(c.review_runs, []);
      const done = ids.map(runOutput);
      if (done.some((d, i) => !d && !runFailed(ids[i]))) continue; // still working
      if (ids.some(runGated)) exec('UPDATE cycles SET gated = 1 WHERE id = ?', c.id);
      const reviews = done.map((d, i) => {
        const reviewer = one('SELECT agent_id FROM runs WHERE id = ?', ids[i])?.agent_id || 'unknown';
        if (!d) return { reviewer, verdict: 'unavailable', score: null, findings: ['reviewer run failed'] };
        const j = readJudgement(d.obj || {});
        if (!j.findings.length && d.text) j.findings = [String(d.text).slice(0, 300)];
        return { reviewer, ...j };
      });
      exec('UPDATE cycles SET reviews = ?, phase = ? WHERE id = ?', JSON.stringify(reviews), 'audit', c.id);
      const auditId = requestAudit({
        subjectType: 'cycle', subjectId: c.id, dept: c.dept,
        title: `${ws.title} — round ${c.seq} (${c.dept})`,
        content: c.output || '',
        criteria: ['meets the stated goal', 'factually grounded — no invented specifics', 'complete, no unfinished sections', 'internally consistent', 'peer findings genuinely addressed'],
        context: `Peer findings this round:\n${reviews.flatMap((r) => r.findings).map((f) => `- ${f}`).join('\n') || '(none)'}`,
        actor: ws.created_by,
      });
      exec('UPDATE cycles SET audit_id = ? WHERE id = ?', auditId, c.id);
      continue;
    }

    if (c.phase === 'audit') {
      const a = one('SELECT * FROM audits WHERE id = ?', c.audit_id);
      if (!a) { pause(ws, c, 'The audit record vanished.'); continue; }
      if (a.state === 'running') { syncAudits(); continue; }
      if (a.state === 'failed') { pause(ws, c, 'The auditor could not complete.'); continue; }
      const score = a.score ?? 0;
      exec("UPDATE cycles SET audit_score = ?, audit_verdict = ?, state = 'done', phase = 'done' WHERE id = ?", score, a.verdict, c.id);
      exec('UPDATE workstreams SET best_score = MAX(COALESCE(best_score, 0), ?) WHERE id = ?', score, ws.id);
      decideNext(ws, c, a);
    }
  }
}

/** What happens after a round is judged — this is where the methodology lives. */
function decideNext(ws, c, a) {
  const route = J(ws.route, []);
  const idx = route.indexOf(c.dept);
  const passed = (a.score ?? 0) >= ws.quality_target && a.verdict !== 'fail';
  const method = METHODS[ws.method] || METHODS.kaizen;
  const nextDept = idx >= 0 && idx < route.length - 1 ? route[idx + 1] : null;

  if (passed) {
    if (nextDept) {
      // Cross-department hand-off: the next department continues the artifact.
      startCycle(ws.id, nextDept, 1, { previous: c.output, handoff: c.dept, notes: pendingNotes(ws.id) });
      notify({ level: 'info', source: 'workstream', message: `“${ws.title}” passed ${c.dept} (${Math.round((a.score ?? 0) * 100)}%) → handed to ${nextDept}.`, subjectType: 'workstream', subjectId: ws.id });
      return;
    }
    finish(ws, 'awaiting_human', `Quality target met (${Math.round((a.score ?? 0) * 100)}%). Waiting for a human to accept.`);
    return;
  }

  // Not good enough yet.
  if (!method.loops || c.seq >= ws.max_cycles) {
    finish(ws, 'awaiting_human',
      !method.loops
        ? `Waterfall: ${c.dept} did not clear the bar (${Math.round((a.score ?? 0) * 100)}%). A human decides — accept, add a note and re-run, or stop.`
        : `Cycle budget spent after ${c.seq} rounds; best ${Math.round((ws.best_score ?? 0) * 100)}%. A human decides.`);
    return;
  }
  // Loop: revise with peer findings + auditor findings + any human notes.
  startCycle(ws.id, c.dept, c.seq + 1, {
    previous: c.output,
    reviews: J(c.reviews, []),
    auditFindings: J(a.findings, []),
    notes: pendingNotes(ws.id),
  });
}

function pause(ws, c, why) {
  exec("UPDATE cycles SET state = 'blocked' WHERE id = ?", c.id);
  finish(ws, 'awaiting_human', why);
}

function finish(ws, state, why) {
  exec('UPDATE workstreams SET state = ?, note = ? WHERE id = ?', state, why, ws.id);
  notify({ level: state === 'awaiting_human' ? 'warn' : 'info', source: 'workstream', message: `“${ws.title}”: ${why}`, subjectType: 'workstream', subjectId: ws.id });
  audit({ actorType: 'system', actorId: 'cycles', action: `workstream.${state}`, subjectType: 'workstream', subjectId: ws.id, payload: { why } });
}

/** Human notes that have not yet been folded into a round. */
function pendingNotes(wsId) {
  const rows = q("SELECT id, body FROM workstream_notes WHERE workstream_id = ? AND applied = 0 ORDER BY id", wsId);
  for (const r of rows) exec('UPDATE workstream_notes SET applied = 1 WHERE id = ?', r.id);
  return rows.map((r) => r.body);
}

export function addWorkstreamNote(id, { body, actor }) {
  if (!body?.trim()) throw new Error('note required');
  if (!one('SELECT id FROM workstreams WHERE id = ?', id)) throw new Error('workstream not found');
  exec('INSERT INTO workstream_notes (workstream_id, body, author) VALUES (?,?,?)', id, body.trim(), actor);
  audit({ actorType: 'human', actorId: actor, action: 'workstream.note_added', subjectType: 'workstream', subjectId: id, payload: { body: body.slice(0, 200) } });
  return lastId();
}

/** Spin the wheel again — the human asks for another improvement round. */
export function rerunWorkstream(id, { note = null, dept = null, actor }) {
  const ws = one('SELECT * FROM workstreams WHERE id = ?', id);
  if (!ws) throw new Error('workstream not found');
  if (ws.state === 'done') throw new Error('workstream is closed — clone it instead');
  if (note?.trim()) addWorkstreamNote(id, { body: note, actor });
  const last = one('SELECT * FROM cycles WHERE workstream_id = ? ORDER BY id DESC LIMIT 1', id);
  const target = dept && DEPT_AGENT[dept] ? dept : (last?.dept || J(ws.route, ['research'])[0]);
  exec('UPDATE workstreams SET max_cycles = max_cycles + 1 WHERE id = ?', id);
  startCycle(id, target, (last?.seq || 0) + 1, {
    previous: last?.output || null,
    reviews: J(last?.reviews, []),
    auditFindings: last?.audit_id ? J(one('SELECT findings FROM audits WHERE id = ?', last.audit_id)?.findings, []) : [],
    notes: pendingNotes(id),
  });
  audit({ actorType: 'human', actorId: actor, action: 'workstream.rerun', subjectType: 'workstream', subjectId: id, payload: { dept: target } });
}

export function closeWorkstream(id, { verdict, actor }) {
  const ws = one('SELECT * FROM workstreams WHERE id = ?', id);
  if (!ws) throw new Error('workstream not found');
  if (!['accepted', 'cancelled'].includes(verdict)) throw new Error('verdict: accepted|cancelled');
  exec('UPDATE workstreams SET state = ? WHERE id = ?', verdict === 'accepted' ? 'done' : 'cancelled', id);
  exec('INSERT INTO approvals (subject_type, subject_id, gate, approver_human, verdict, note) VALUES (?,?,?,?,?,?)',
    'workstream', String(id), 'workstream-accept', actor, verdict === 'accepted' ? 'approved' : 'rejected', ws.title);
  audit({ actorType: 'human', actorId: actor, action: `workstream.${verdict}`, subjectType: 'workstream', subjectId: id, payload: { bestScore: ws.best_score } });
}

export function listWorkstreams() {
  return q('SELECT * FROM workstreams ORDER BY state != \'awaiting_human\', id DESC LIMIT 60').map((w) => ({
    ...w, route: J(w.route, []),
    cycles: one('SELECT COUNT(*) AS n FROM cycles WHERE workstream_id = ?', w.id).n,
    notes: one('SELECT COUNT(*) AS n FROM workstream_notes WHERE workstream_id = ?', w.id).n,
  }));
}

export function getWorkstream(id) {
  const w = one('SELECT * FROM workstreams WHERE id = ?', id);
  if (!w) return null;
  return {
    ...w, route: J(w.route, []),
    methods: METHODS,
    cycles: q('SELECT * FROM cycles WHERE workstream_id = ? ORDER BY id', id).map((c) => ({
      ...c, reviews: J(c.reviews, []),
      auditFindings: c.audit_id ? J(one('SELECT findings FROM audits WHERE id = ?', c.audit_id)?.findings, []) : [],
    })),
    notes: q('SELECT * FROM workstream_notes WHERE workstream_id = ? ORDER BY id', id),
  };
}

// ---------- the universal AI auditor ----------
// Any department, any artifact, one standard. Called by the cycle engine and
// directly from every department page.
export function requestAudit({ subjectType, subjectId, dept = null, title = null, content = null, criteria = null, context = null, actor }) {
  const body = content ?? pullSubjectText(subjectType, subjectId);
  if (!body) throw new Error('nothing to audit — no text found for that subject');
  const agentId = auditorAgent();
  if (!agentId) throw new Error('no active agent available to audit');
  const crit = criteria?.length ? criteria : ['factually grounded — nothing invented', 'complete and usable as delivered', 'internally consistent', 'safe: no secrets, no policy breach', 'fit for the department that produced it'];
  const runId = enqueueRun({
    agentId,
    taskType: `audit:${subjectType}:${subjectId}`,
    input: { prompt: `You are the company's independent quality auditor. You did not produce this work and you owe it no loyalty. Judge it strictly.\nSUBJECT: ${title || `${subjectType} #${subjectId}`}${dept ? ` (department: ${dept})` : ''}\nCRITERIA:\n${crit.map((c, i) => `${i + 1}. ${c}`).join('\n')}${context ? `\n\nCONTEXT:\n${context}` : ''}\n\n--- ARTIFACT ---\n${String(body).slice(0, 14000)}\n\nReply as JSON {"score": 0.0-1.0, "verdict": "pass|revise|fail", "findings": ["specific defect with where it is", "..."], "summary": "one paragraph"}.` },
    actor,
  });
  exec('INSERT INTO audits (subject_type, subject_id, dept, criteria, run_id, requested_by) VALUES (?,?,?,?,?,?)',
    subjectType, String(subjectId), dept, JSON.stringify(crit), runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'audit.requested', subjectType: 'audit', subjectId: id, payload: { subjectType, subjectId, dept } });
  return id;
}

/** Best-effort text for "audit this thing" from anywhere in the company. */
function pullSubjectText(type, id) {
  const pick = (sql, ...p) => one(sql, ...p);
  const map = {
    cycle: () => pick('SELECT output AS t FROM cycles WHERE id = ?', id),
    run: () => pick('SELECT output AS t FROM runs WHERE id = ?', id),
    ticket: () => pick('SELECT draft AS t FROM tickets WHERE id = ?', id),
    content: () => pick('SELECT body AS t FROM content_items WHERE id = ?', id),
    post: () => pick('SELECT body AS t FROM posts WHERE id = ?', id),
    bulletin: () => pick('SELECT body AS t FROM bulletins WHERE id = ?', id),
    irUpdate: () => pick('SELECT body AS t FROM investor_updates WHERE id = ?', id),
    boardRecord: () => pick('SELECT packet AS t FROM board_records WHERE id = ?', id),
    release: () => pick('SELECT notes AS t FROM releases WHERE id = ?', id),
    brand: () => pick('SELECT content AS t FROM brand_assets WHERE id = ?', id),
    finReport: () => pick('SELECT body AS t FROM fin_reports WHERE id = ?', id),
    campaign: () => pick('SELECT copy AS t FROM campaigns WHERE id = ?', id),
  };
  try { return map[type]?.()?.t || null; } catch { return null; }
}

/** Tick: land finished auditor runs into their audit rows. */
export function syncAudits() {
  for (const a of q("SELECT * FROM audits WHERE state = 'running'")) {
    if (runFailed(a.run_id)) { exec("UPDATE audits SET state = 'failed' WHERE id = ?", a.id); continue; }
    const out = runOutput(a.run_id);
    if (!out) continue;
    const j = readJudgement(out.obj || {});
    const score = j.score;
    const verdict = j.verdict === 'accept' ? 'pass' : j.verdict === 'reject' ? 'fail' : 'revise';
    exec("UPDATE audits SET state = 'done', score = ?, verdict = ?, findings = ?, summary = ? WHERE id = ?",
      score, verdict, JSON.stringify(j.findings), j.summary || out.text.slice(0, 600), a.id);
    audit({ actorType: 'agent', actorId: 'auditor', action: 'audit.completed', subjectType: 'audit', subjectId: a.id, payload: { verdict, score, subjectType: a.subject_type, subjectId: a.subject_id } });
    if (verdict === 'fail') notify({ level: 'warn', source: 'auditor', message: `Audit FAILED: ${a.subject_type} #${a.subject_id}${a.dept ? ` (${a.dept})` : ''} — ${Math.round(score * 100)}%.`, subjectType: 'audit', subjectId: a.id });
  }
}

export function auditorOverview() {
  const rows = q('SELECT * FROM audits ORDER BY id DESC LIMIT 80').map((a) => ({ ...a, findings: J(a.findings, []), criteria: J(a.criteria, []) }));
  const done = rows.filter((a) => a.state === 'done');
  return {
    stats: {
      total: one('SELECT COUNT(*) AS n FROM audits').n,
      running: one("SELECT COUNT(*) AS n FROM audits WHERE state = 'running'").n,
      failed: one("SELECT COUNT(*) AS n FROM audits WHERE verdict = 'fail'").n,
      avgScore: done.length ? Number((done.reduce((s, a) => s + (a.score || 0), 0) / done.length).toFixed(3)) : null,
    },
    byDept: q("SELECT dept, COUNT(*) AS n, ROUND(AVG(score), 3) AS avg FROM audits WHERE state = 'done' AND dept IS NOT NULL GROUP BY dept ORDER BY avg"),
    audits: rows,
  };
}

// ---------- Scrum: sprints over the task tracker ----------
export function listSprints() {
  return q('SELECT * FROM sprints ORDER BY id DESC LIMIT 30').map((s) => {
    const t = one("SELECT COUNT(*) AS total, SUM(state = 'done') AS done, SUM(COALESCE(points,1)) AS pts, SUM(CASE WHEN state = 'done' THEN COALESCE(points,1) ELSE 0 END) AS ptsDone FROM tasks WHERE sprint_id = ?", s.id);
    return { ...s, tasks: { total: t.total, done: t.done || 0, points: t.pts || 0, pointsDone: t.ptsDone || 0 } };
  });
}

export function createSprint({ name, goal = null, startsOn = null, endsOn = null, actor }) {
  if (!name?.trim()) throw new Error('name required');
  exec('INSERT INTO sprints (name, goal, starts_on, ends_on, created_by) VALUES (?,?,?,?,?)',
    name.trim(), goal, startsOn, endsOn, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'sprint.created', subjectType: 'sprint', subjectId: id, payload: { name, goal } });
  return id;
}

export function assignToSprint(sprintId, { taskId, points = 1, actor }) {
  if (!one('SELECT id FROM sprints WHERE id = ?', sprintId)) throw new Error('sprint not found');
  if (!one('SELECT id FROM tasks WHERE id = ?', taskId)) throw new Error('task not found');
  exec('UPDATE tasks SET sprint_id = ?, points = ? WHERE id = ?', sprintId, Math.max(1, Number(points) || 1), taskId);
  audit({ actorType: 'human', actorId: actor, action: 'sprint.task_assigned', subjectType: 'sprint', subjectId: sprintId, payload: { taskId, points } });
}

export function setSprintState(id, { state, retro = null, actor }) {
  const s = one('SELECT * FROM sprints WHERE id = ?', id);
  if (!s) throw new Error('sprint not found');
  if (!['active', 'review', 'closed'].includes(state)) throw new Error('state: active|review|closed');
  if (state === 'closed' && !retro?.trim()) throw new Error('a sprint cannot close without a retrospective — that is the whole point');
  const velocity = state === 'closed'
    ? one("SELECT COALESCE(SUM(COALESCE(points,1)),0) AS v FROM tasks WHERE sprint_id = ? AND state = 'done'", id).v : null;
  exec('UPDATE sprints SET state = ?, retro = COALESCE(?, retro), velocity = COALESCE(?, velocity) WHERE id = ?', state, retro, velocity, id);
  audit({ actorType: 'human', actorId: actor, action: `sprint.${state}`, subjectType: 'sprint', subjectId: id, payload: { velocity, retro: retro?.slice(0, 200) } });
  if (state === 'closed') notify({ level: 'info', source: 'scrum', message: `Sprint “${s.name}” closed — velocity ${velocity} points.`, subjectType: 'sprint', subjectId: id });
}
