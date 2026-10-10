// The pair programmer — a question about the code in front of you, answered
// by an engineer who has read the rest of the repository.
//
// An answer here is advice, never an edit. If the answer carries code, the
// editor offers to turn it into a change set, and a change set is what the
// factory already knows how to review, apply and undo. So there is exactly one
// way for a model's words to become a file, and it is the one with a person
// in it.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { enqueueRun } from '../workflow.js';
import { openPii } from '../erasure.js';
import { projectRow, contextFor, readProjectFile } from '../forge.js';

exec(`CREATE TABLE IF NOT EXISTS eng_assist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES forge_projects(id),
  path        TEXT,
  selection   TEXT,
  question    TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'ask',     -- ask|explain|tests|refactor|review
  run_id      TEXT,
  answer      TEXT,
  code        TEXT,
  state       TEXT NOT NULL DEFAULT 'thinking',-- thinking|answered|failed
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const MODES = {
  ask: 'Answer the question.',
  explain: 'Explain what this code does, step by step, and anything surprising about it.',
  tests: 'Write tests for this code, in the runner the project already uses. Put the test file in "code".',
  refactor: 'Propose a clearer version of the selected code that behaves identically. Put the replacement in "code".',
  review: 'Review this code: bugs first, then security, then clarity. Be specific about lines.',
};

export function ask({ projectId, path = null, selection = null, question = '', mode = 'ask', actor }) {
  const p = projectRow(projectId);
  if (!MODES[mode]) refuse(`mode is one of ${Object.keys(MODES).join(', ')}`);
  const qText = String(question || '').trim() || MODES[mode];
  let file = null;
  if (path) { try { file = readProjectFile(p.id, path); } catch { file = null; } }
  const ctx = contextFor(p, 24_000);
  exec('INSERT INTO eng_assist (project_id, path, selection, question, mode, created_by) VALUES (?,?,?,?,?,?)',
    p.id, path, selection ? String(selection).slice(0, 20_000) : null, qText.slice(0, 4000), mode, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: 'AGT-ENG-001',
    taskType: `eng-assist:${id}`,
    actor,
    input: {
      prompt: `[ENG-ASSIST] You are pairing with a person in their editor on "${p.name}". ${MODES[mode]}

THEIR QUESTION: ${qText}
${path ? `\nTHE FILE THEY HAVE OPEN: ${path}\n${file?.content ? file.content.slice(0, 30_000) : '(not readable)'}` : ''}
${selection ? `\nTHE SELECTED CODE:\n${String(selection).slice(0, 8000)}` : ''}

THE REST OF THE REPOSITORY (for context):
${ctx.listing}

Answer in plain words, short paragraphs, the way a senior colleague would. Put any code you suggest in "code" (one block, complete enough to paste); leave it empty when no code is needed. If you are not sure, say so.

Output JSON: {"answer":"","code":"","confidence":0.0}`,
    },
  });
  exec('UPDATE eng_assist SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'eng.assist_asked', subjectType: 'forgeProject', subjectId: p.id, payload: { assist: id, mode, path } });
  return getAnswer(id);
}

/** Server tick and poll both: fold a finished run into the answer. */
export function syncAssist() {
  for (const a of q("SELECT id, run_id FROM eng_assist WHERE state = 'thinking' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', a.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    let parsed = null;
    let raw = '';
    try { const o = run.output ? JSON.parse(openPii(run.output)) : null; parsed = o?.parsed || null; raw = o?.raw || ''; } catch { parsed = null; }
    const answer = parsed?.answer || (raw && !parsed ? raw.slice(0, 8000) : null);
    if (!answer && !parsed?.code) {
      exec("UPDATE eng_assist SET state = 'failed', answer = ? WHERE id = ?", run.failure_reason || 'no answer came back', a.id);
      continue;
    }
    exec("UPDATE eng_assist SET state = 'answered', answer = ?, code = ? WHERE id = ?", String(answer || '').slice(0, 12_000), parsed?.code ? String(parsed.code).slice(0, 60_000) : null, a.id);
  }
}

export function getAnswer(id) {
  syncAssist();
  const a = one('SELECT * FROM eng_assist WHERE id = ?', Number(id));
  if (!a) refuse('no such question', 404);
  return a;
}

export function history(projectId, { limit = 20 } = {}) {
  const p = projectRow(projectId);
  syncAssist();
  return q('SELECT id, path, question, mode, state, answer, code, created_at FROM eng_assist WHERE project_id = ? ORDER BY id DESC LIMIT ?', p.id, limit);
}
