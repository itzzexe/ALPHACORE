// AI drafting for the governance floor — one way to ask an employee to write
// something, and one way to fold the answer back.
//
// Policies, audit programmes, ISO gap analyses, screenplays, copy, roadmaps,
// strategy briefs and AML reviews are all the same shape of work: a person
// asks, an employee writes, a person decides what to keep. The marker is
// [DRAFT:<kind>], which mock mode answers for every kind at once, and nothing
// here writes the draft into the department's own record — a person adopts it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { enqueueRun } from './workflow.js';
import { readRun } from './markets/fold.js';
import { companyContext } from './context.js';
import { laneFor, runNow } from './nightshift.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

export function requestDraft({ dept, subjectType, subjectId, kind, agentId, brief, lang = 'ar', actor, urgent = false, exclude = null }) {
  if (!actor) refuse('a draft has to name who asked for it');
  // The company's own rules and findings go in ahead of the brief, so the
  // writer builds on them and says which it used.
  const ctx = companyContext(`${kind} ${brief}`, { exclude });
  const prompt = `[DRAFT:${kind}] ${brief}
${ctx ? `\n${ctx}\n` : ''}
Write in ${lang === 'en' ? 'English' : 'Arabic'}. Use only what you are given; where something is missing, write [TO CONFIRM] rather than inventing it.
Output JSON: {"title":"","markdown":"","items":[],"openQuestions":[],"confidence":0.0}`;
  const { lane, notBefore } = laneFor({ urgent });
  const runId = enqueueRun({ agentId, taskType: `draft:${dept}:${kind}`, input: { prompt }, actor, lane, notBefore });
  const r = exec('INSERT INTO draft_jobs (dept, subject_type, subject_id, kind, run_id, created_by) VALUES (?,?,?,?,?,?)',
    dept, subjectType, String(subjectId), kind, runId, actor);
  audit({ actorType: String(actor).startsWith('human') ? 'human' : 'system', actorId: actor, action: `${dept}.draft_requested`, subjectType, subjectId: String(subjectId), payload: { kind, agentId } });
  return one('SELECT * FROM draft_jobs WHERE id = ?', Number(r.lastInsertRowid));
}

export function syncDraftJobs() {
  for (const d of q("SELECT id, run_id FROM draft_jobs WHERE state = 'thinking'")) {
    const r = readRun(d.run_id);
    if (!r.done) continue;
    if (r.failed) { exec("UPDATE draft_jobs SET state = 'failed', body = ? WHERE id = ?", JSON.stringify({ markdown: r.why || 'no answer came back' }), d.id); continue; }
    const body = r.parsed || { markdown: r.raw };
    exec("UPDATE draft_jobs SET state = 'ready', body = ?, served_by = ? WHERE id = ?",
      JSON.stringify({ ...body, lowConfidence: r.lowConfidence }).slice(0, 120_000), r.servedBy, d.id);
  }
}

export function draftsFor(dept, subjectType = null, subjectId = null, limit = 10) {
  syncDraftJobs();
  // The run's start time comes along, so a draft waiting for the night shift
  // says when it will be written rather than looking stuck.
  const rows = q(`SELECT d.*, CASE WHEN r.state = 'queued' THEN r.not_before END AS not_before, r.lane AS lane
                  FROM draft_jobs d LEFT JOIN runs r ON r.id = d.run_id
                  WHERE d.dept = ?1 AND (?2 IS NULL OR (d.subject_type = ?2 AND d.subject_id = ?3))
                  ORDER BY d.id DESC LIMIT ?4`, dept, subjectType, subjectType ? String(subjectId) : null, limit);
  return rows.map((r) => ({ ...r, body: r.body ? JSON.parse(r.body) : null }));
}

/** A draft waiting for the night shift, written now by the day model instead. */
export function draftNow(jobId, { actor }) {
  const d = one('SELECT * FROM draft_jobs WHERE id = ?', Number(jobId));
  if (!d) refuse('no such draft', 404);
  if (d.state !== 'thinking') refuse('that draft is already written');
  return runNow(d.run_id, { actor });
}
