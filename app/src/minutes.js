// RECORDINGS & MINUTES — a recording becomes a transcript, the transcript becomes
// minutes, and what was agreed becomes tasks with owners and dates.
//
// The recording is written down on this machine by whisper.cpp, after ffmpeg
// has turned it into the audio it reads. On two cores that takes about as
// long as the meeting did, so with the night shift on it waits for the quiet
// hours like any other heavy work. A transcript can also be pasted in.
//
// The minutes secretary drafts; a person records. Decisions and actions are
// what that person confirms, not what the model heard — and an action becomes
// a task only when it has been confirmed. A management review recorded here is
// the ISO department's management review too, so it is not written twice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { saveUpload, getUpload } from './uploads.js';
import { runTool } from './localtools.js';
import { enqueue } from './jobs.js';
import { laneFor } from './nightshift.js';
import { requestDraft, draftsFor } from './drafts.js';
import { createTask } from './pm.js';
import { holdReview } from './iso.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
export const KINDS = ['general', 'committee', 'board', 'management_review'];

/** How a recording becomes text. Replaceable, so the tests can transcribe without whisper. */
export const engines = {
  async transcribe(file) {
    const model = getSetting('WHISPER_MODEL');
    if (!model) throw Object.assign(new Error('no speech model is set (WHISPER_MODEL) — deploy/vps/tools-setup.sh downloads one'), { status: 503 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-'));
    try {
      const wav = path.join(dir, 'audio.wav');
      await runTool('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 30 * 60_000 });
      const out = path.join(dir, 'transcript');
      await runTool('whisper', ['-m', model, '-f', wav, '-l', getSetting('WHISPER_LANG') || 'auto', '-t', String(Math.max(1, os.cpus().length)), '-otxt', '-of', out, '-np'],
        { timeoutMs: 4 * 3600_000 });
      return fs.readFileSync(`${out}.txt`, 'utf8');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
};

export function createMeeting({ title, heldOn = null, kind = 'general', isoStandard = null, attendees = '', transcript = null, upload = null, actor }) {
  if (!isHuman(actor)) refuse('a person records a meeting', 403);
  if (!clean(title, 200)) refuse('the meeting needs a title');
  if (!KINDS.includes(kind)) refuse(`kind is one of: ${KINDS.join(', ')}`);
  if (kind === 'management_review' && !isoStandard) refuse('a management review names the standard it reviews');
  const up = upload ? saveUpload({ purpose: 'meeting', ...upload, actor }) : null;
  if (!up && !clean(transcript, 200_000)) refuse('a recording or the transcript');
  const r = exec(`INSERT INTO rec_meetings (title, held_on, kind, iso_standard, attendees, upload_id, transcript, state, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?)`, clean(title, 200), heldOn || new Date().toISOString().slice(0, 10), kind, isoStandard,
  clean(attendees, 1000) || null, up?.id || null, up ? null : clean(transcript, 200_000), up ? 'transcribing' : 'transcribed', actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'minutes.meeting_recorded', subjectType: 'rec_meeting', subjectId: id, payload: { kind, recording: Boolean(up) } });
  if (up) {
    // Writing down an hour of speech holds the machine for about an hour: the
    // night shift, when it is on, decides when.
    const { notBefore } = laneFor({});
    enqueue('meeting.transcribe', { id }, { idempotency: `meeting:${id}`, runAfter: notBefore, maxAttempts: 2 });
  } else requestMinutes(id, actor);
  return getMeeting(id);
}

/** The job: the recording, written down here, then handed to the minutes secretary. */
export async function transcribe(id) {
  const m = one('SELECT * FROM rec_meetings WHERE id = ?', Number(id));
  if (!m?.upload_id) return;
  try {
    const text = await engines.transcribe(getUpload(m.upload_id).path);
    exec("UPDATE rec_meetings SET transcript = ?, state = 'transcribed', error = NULL WHERE id = ?", clean(text, 200_000), m.id);
    requestMinutes(m.id, 'system:meetings');
  } catch (e) {
    exec("UPDATE rec_meetings SET state = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 300), m.id);
  }
}

function requestMinutes(id, actor) {
  const m = one('SELECT * FROM rec_meetings WHERE id = ?', id);
  return requestDraft({
    dept: 'minutes', subjectType: 'rec_meeting', subjectId: m.id, kind: 'minutes', agentId: 'AGT-MIN-001', actor,
    brief: `Minutes of “${m.title}” (${m.kind}, ${m.held_on}). Attendees: ${m.attendees || '[TO CONFIRM]'}.
In "markdown": a short summary, then the decisions taken, each on its own line starting "- ". In "items": every action agreed, as {task, owner, due} with due as YYYY-MM-DD or "". Record only what the transcript says was decided or agreed; a suggestion nobody took up is not a decision.

Transcript:
${String(m.transcript || '').slice(0, 9000)}`,
  });
}

/**
 * What a person confirms the meeting decided. Each action becomes a task with
 * its owner and date; a management review is recorded with ISO as well.
 */
export function recordMinutes({ id, summary, decisions, actions = [], actor }) {
  if (!isHuman(actor)) refuse('a person records the minutes', 403);
  const m = one('SELECT * FROM rec_meetings WHERE id = ?', Number(id));
  if (!m) refuse('no such meeting', 404);
  if (m.state === 'minuted') refuse('the minutes are already recorded');
  if (!clean(decisions) && !actions.length) refuse('minutes record decisions or actions — a meeting that decided nothing has no minutes');
  const list = Array.isArray(actions) ? actions.slice(0, 50) : [];
  for (const a of list) if (!clean(a.task, 300)) refuse('every action says what is to be done');
  exec("UPDATE rec_meetings SET summary = ?, decisions = ?, state = 'minuted', minuted_by = ?, minuted_at = datetime('now') WHERE id = ?",
    clean(summary, 4000) || null, clean(decisions, 8000) || null, actor, m.id);
  for (const a of list) {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(a.due || '')) ? a.due : null;
    const task = createTask({ title: clean(a.task, 300), details: `From the meeting “${m.title}” on ${m.held_on}.`, assigneeType: 'human', assigneeId: clean(a.owner, 80) || null, dueDate: due, actor });
    exec('INSERT INTO rec_actions (meeting_id, task, owner, due, task_id) VALUES (?,?,?,?,?)', m.id, clean(a.task, 300), clean(a.owner, 80) || null, due, task.id);
  }
  if (m.kind === 'management_review' && m.iso_standard) {
    holdReview({ standard: m.iso_standard, attendees: m.attendees || '', decisions: clean(decisions, 8000) || list.map((a) => a.task).join('; '), actor });
  }
  audit({ actorType: 'human', actorId: actor, action: 'minutes.recorded', subjectType: 'rec_meeting', subjectId: m.id, payload: { actions: list.length } });
  return getMeeting(m.id);
}

export function getMeeting(id) {
  const m = one('SELECT * FROM rec_meetings WHERE id = ?', Number(id));
  if (!m) refuse('no such meeting', 404);
  return { ...m, actions: q('SELECT * FROM rec_actions WHERE meeting_id = ? ORDER BY id', m.id), drafts: draftsFor('minutes', 'rec_meeting', m.id, 2) };
}

export function overview() {
  return {
    meetings: q('SELECT id, title, held_on, kind, state, error, (SELECT COUNT(*) FROM rec_actions a WHERE a.meeting_id = m.id) AS actions FROM rec_meetings m ORDER BY held_on DESC, id DESC LIMIT 100'),
    openActions: one("SELECT COUNT(*) AS n FROM rec_actions a JOIN tasks t ON t.id = a.task_id WHERE t.state NOT IN ('done','cancelled')").n,
    waiting: one("SELECT COUNT(*) AS n FROM rec_meetings WHERE state IN ('transcribing','transcribed')").n,
  };
}
