// MEETINGS — what was decided, by whom, in front of whom.
//
// The participant list is the point of this module. It is integer employee ids
// in a STRICT table, which means an AI agent cannot be a meeting participant
// of record — an agent may draft the agenda or summarize the transcript
// through the bridge, but the record of who was in the room only holds
// humans. A decision list with a bot on it is a decision nobody made.
//
// The transcript is Tier A, sealed under the organizer's key. That is an
// honest compromise rather than a clean answer: a transcript is about
// everybody in the room, and per-subject sealing has one subject. Erasing the
// organizer erases the transcript; erasing a participant does not. The
// limitation is recorded in NEXT.md, not hidden here.
import { q, one, exec } from '../db.js';
import { sealForRef, openPii, isSealed } from '../erasure.js';
import { log } from './identity.js';
import { emit } from './bridge.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);

export function createMeeting({ title, agenda = null, scheduledAt, organizerEmployeeId, participantIds = [], actor }) {
  if (!actor) refuse('calling a meeting is an act and carries a name');
  if (!clean(title)) refuse('a meeting needs a title');
  const org = one(
    `SELECT e.id, p.subject_ref FROM hr_employee e JOIN hr_person p ON p.id = e.person_id
      WHERE e.id = ? AND e.state = 'active'`, Number(organizerEmployeeId),
  );
  if (!org) refuse('the organizer must be an active employee');

  exec(
    'INSERT INTO mtg_meeting (title, agenda, scheduled_at, organizer_employee_id, subject_ref) VALUES (?,?,?,?,?)',
    clean(title), agenda ? String(agenda).slice(0, 4000) : null, String(scheduledAt), org.id, org.subject_ref,
  );
  const id = one('SELECT last_insert_rowid() AS id').id;

  for (const pid of new Set([org.id, ...participantIds.map(Number)])) {
    if (!one("SELECT id FROM hr_employee WHERE id = ?", pid)) refuse(`participant ${pid} is not an employee`);
    exec('INSERT OR IGNORE INTO mtg_participant (meeting_id, employee_id) VALUES (?,?)', id, pid);
  }
  log({ entity: 'meeting', entityId: id, action: 'meeting.created', actor, detail: { participants: participantIds.length + 1 } });
  return getMeeting(id);
}

export function getMeeting(id) {
  const m = one('SELECT * FROM mtg_meeting WHERE id = ?', Number(id));
  if (!m) return null;
  return {
    ...m,
    transcript: openPii(m.transcript),
    transcriptSealed: isSealed(m.transcript),
    participants: q(
      `SELECT mp.employee_id, p.display_name, e.employee_no FROM mtg_participant mp
        JOIN hr_employee e ON e.id = mp.employee_id JOIN hr_person p ON p.id = e.person_id
       WHERE mp.meeting_id = ?`, m.id,
    ),
    actions: q('SELECT * FROM mtg_action WHERE meeting_id = ? ORDER BY id', m.id),
  };
}

export function setMeetingState(id, { state, transcript = null, actor }) {
  if (!actor) refuse('changing a meeting is an act and carries a name');
  const m = one('SELECT * FROM mtg_meeting WHERE id = ?', Number(id));
  if (!m) refuse('no such meeting');
  if (!['planned', 'running', 'completed', 'cancelled'].includes(state)) refuse('unknown state');
  // The transcript is sealed the moment it arrives — under the organizer's
  // key, which the row has carried since it was created.
  const sealed = transcript && m.subject_ref ? sealForRef(String(transcript), m.subject_ref) : (transcript || null);
  exec('UPDATE mtg_meeting SET state = ?, transcript = COALESCE(?, transcript) WHERE id = ?', state, sealed, m.id);
  log({ entity: 'meeting', entityId: m.id, action: `meeting.${state}`, actor });
  if (state === 'completed') emit('meeting.completed', { id: m.id });
  return getMeeting(m.id);
}

/** An action item or a decision. Owners are employees; agents need not apply. */
export function addAction(meetingId, { kind = 'action', what, ownerEmployeeId = null, due = null, actor }) {
  if (!actor) refuse('recording a decision is an act and carries a name');
  if (!one('SELECT id FROM mtg_meeting WHERE id = ?', Number(meetingId))) refuse('no such meeting');
  if (!clean(what)) refuse('an action item needs words');
  if (ownerEmployeeId && !one('SELECT id FROM hr_employee WHERE id = ?', Number(ownerEmployeeId))) {
    refuse('the owner must be an employee');
  }
  exec('INSERT INTO mtg_action (meeting_id, kind, what, owner_employee_id, due) VALUES (?,?,?,?,?)',
    Number(meetingId), kind === 'decision' ? 'decision' : 'action', clean(what, 500),
    ownerEmployeeId ? Number(ownerEmployeeId) : null, due || null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'meeting', entityId: Number(meetingId), action: `meeting.${kind}_added`, actor });
  return one('SELECT * FROM mtg_action WHERE id = ?', id);
}

export function listMeetings({ state = null, limit = 100 } = {}) {
  let sql = `SELECT m.id, m.title, m.scheduled_at, m.state, p.display_name AS organizer,
                    (SELECT COUNT(*) FROM mtg_participant mp WHERE mp.meeting_id = m.id) AS participants,
                    (SELECT COUNT(*) FROM mtg_action a WHERE a.meeting_id = m.id AND a.kind = 'decision') AS decisions
               FROM mtg_meeting m
               JOIN hr_employee e ON e.id = m.organizer_employee_id
               JOIN hr_person p ON p.id = e.person_id WHERE 1=1`;
  const params = [];
  if (state) { sql += ' AND m.state = ?'; params.push(state); }
  sql += ' ORDER BY m.scheduled_at DESC LIMIT ?';
  params.push(Number(limit));
  return q(sql, ...params);
}

export function meetingsOverview() {
  const n = (sql) => one(sql).n;
  return {
    planned: n("SELECT COUNT(*) AS n FROM mtg_meeting WHERE state = 'planned'"),
    completed: n("SELECT COUNT(*) AS n FROM mtg_meeting WHERE state = 'completed'"),
    openActions: n("SELECT COUNT(*) AS n FROM mtg_action WHERE kind = 'action' AND state = 'open'"),
    decisions: n("SELECT COUNT(*) AS n FROM mtg_action WHERE kind = 'decision'"),
    sealedTranscripts: n("SELECT COUNT(*) AS n FROM mtg_meeting WHERE transcript LIKE 'pii:1:%'"),
    note: 'Participants are employments, by number, in a STRICT table — an agent cannot be a participant of record. '
      + 'Transcripts are sealed under the organizer\'s key the moment they arrive; the multi-subject limitation that '
      + 'creates is written down in NEXT.md rather than hidden.',
  };
}
