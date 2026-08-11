// The simulation — the workforce in a building, not in a feed.
//
// The society layer already had employees talking: channels, scenes, a relation
// score that moved. What it had no notion of was *where*, and a conversation
// with nowhere to happen is a timeline. Give people rooms and the interesting
// part arrives without being written: who is standing next to whom decides what
// gets said, somebody who never leaves their desk stops learning anything, and
// two people who keep ending up in the kitchen at the same time develop a
// history whether or not anybody planned one.
//
// Three rules keep this from being a toy.
//
//   Nothing is scripted. The premise names a room, who is in it, how they are
//   and what stands between them; the scene, the disagreement and whether
//   anybody learned anything come back from the model. There is no table of
//   plot beats, because a simulation with a plot table produces the same
//   company every time.
//
//   A learning is written into the agent's memory. Not a counter — a row in
//   mem_docs, which is recalled into that employee's later prompts. The one who
//   had the conversation is afterwards a slightly different employee. Without
//   this the department is a soap opera with a budget.
//
//   Drama has somewhere to go. When a disagreement will not resolve, it is
//   raised as a real dispute and HR arbitrates, with the final ruling belonging
//   to the owner — the machinery that already exists. Conflict that cannot
//   escalate is theatre; conflict that escalates into the actual grievance
//   process is a company.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting, setSetting } from './settings.js';
import { route, parseAgentJson } from './router.js';
import { getPersona } from './org.js';
import { bumpRelation, relationLabel } from './society.js';
import { remember } from './memory.js';
import { raiseDispute } from './disputes.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 600) => String(s ?? '').trim().slice(0, n);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

const MAX_LINES = 10;
const MOODS = ['steady', 'pleased', 'frustrated', 'tired', 'curious', 'tense'];

/**
 * The building.
 *
 * Divisions get a room because that is where colleagues who share a job end up;
 * the shared rooms exist because the useful conversations in any company happen
 * between people who were not scheduled to meet.
 */
// id, name, kind, division, capacity, about, and where it sits on a 12-wide
// floor. The layout is data because the floor plan is drawn from it: a picture
// maintained by hand in the page is a picture that stops matching the building.
export const SEED_ROOMS = [
  ['engine-floor', 'The engine floor', 'office', 'engine', 10, 'Where work is picked up and carried out. Loud, and nobody minds.', 0, 0, 3, 2],
  ['build-room', 'The build room', 'office', 'build', 10, 'Specifications, products, releases. Whiteboard permanently full.', 3, 0, 3, 2],
  ['data-desk', 'The data desk', 'office', 'data', 8, 'Intelligence, segments, the knowledge graph. Quiet by preference.', 6, 0, 3, 2],
  ['studio', 'The studio', 'office', 'marketing', 12, 'Content, design, social. The only room with anything on the walls.', 9, 0, 3, 2],
  ['corridor', 'The corridor', 'corridor', null, 20, 'Nobody stays. A great deal is decided here anyway.', 0, 2, 12, 1],
  ['sales-floor', 'The sales floor', 'office', 'commerce', 8, 'Pricing, deals, customers. Somebody is always on a call.', 0, 3, 3, 2],
  ['counting-house', 'The counting house', 'office', 'capital', 8, 'The ledger, the books, the money desk. Interruptions are unwelcome.', 3, 3, 3, 2],
  ['ops-room', 'The ops room', 'office', 'operate', 8, 'Incidents, support, the contact centre. Calm until it is not.', 6, 3, 3, 2],
  ['people-room', 'The people room', 'office', 'talent', 8, 'Hiring, the academy, and where a dispute is heard.', 9, 3, 3, 2],
  ['trust-office', 'The trust office', 'office', 'trust', 6, 'Security, compliance, privacy, the red team. The door is usually shut.', 0, 5, 3, 2],
  ['boardroom', 'The boardroom', 'meeting', 'exec', 10, 'Booked for the long view, used for the urgent one.', 3, 5, 4, 2],
  ['lab', 'The lab', 'lab', 'build', 6, 'Experiments, and the arguments experiments cause.', 7, 5, 3, 2],
  ['kitchen', 'The kitchen', 'social', null, 6, 'Where the company actually finds out what is going on.', 10, 5, 2, 2],
];

/** The floor is twelve wide and seven deep. The page needs to know only this. */
export const FLOOR = { cols: 12, rows: 7 };

/**
 * Which floor somebody works on.
 *
 * The obvious approach — map the six role groups to six rooms — puts twelve
 * people in the boardroom and leaves the sales floor empty, which is not a
 * company, it is a bar chart. What the workforce actually carries is a job
 * title, and a title says where somebody sits far better than a group does:
 * Legal Counsel and Support Agent are both "run", and they do not share a desk.
 *
 * So: the title first, the group as a fallback, and the corridor when a room is
 * full — which is where the overflow of any real office ends up.
 */
const BY_TITLE = [
  [/legal|counsel|contract/i, 'ops-room'],
  [/recruit|talent|coach|train|academy|\bhr\b|people|enablement/i, 'people-room'],
  [/procure|vendor|supplier|purchas/i, 'sales-floor'],
  [/sales|account exec|customer|success|revenue|pricing|deal|partner/i, 'sales-floor'],
  [/financ|bookkeep|ledger|treasur|\btax\b|payroll|controller|\bcfo\b/i, 'counting-house'],
  [/support|incident|ops|monitor|reliab|\bsre\b|devops|release|deploy|contact/i, 'ops-room'],
  [/\bdata\b|analyst|intel|research|insight|scientist|knowledge/i, 'data-desk'],
  [/content|copy|writer|design|\bux\b|brand|social|community|market|localiz|\bseo\b|press/i, 'studio'],
  [/security|ethic|complian|privacy|risk|audit|red.?team|\bqa\b|quality|review/i, 'trust-office'],
  [/experiment|prototype|\blab\b/i, 'lab'],
  [/architect|engineer|developer|frontend|backend|full.?stack|product manager/i, 'build-room'],
  [/program manager|\bpmo\b|project|chief|exec|strateg|board|governance|invest/i, 'boardroom'],
];

const GROUP_ROOM = {
  steer: 'boardroom', run: 'ops-room', discover: 'data-desk',
  create: 'studio', assure: 'trust-office', build: 'build-room',
  // Older installs used division names for the group.
  engineering: 'build-room', product: 'build-room', data: 'data-desk', intel: 'data-desk',
  marketing: 'studio', content: 'studio', design: 'studio', social: 'studio',
  commerce: 'sales-floor', sales: 'sales-floor', success: 'sales-floor',
  finance: 'counting-house', capital: 'counting-house',
  operate: 'ops-room', support: 'ops-room', ops: 'ops-room',
  talent: 'people-room', hr: 'people-room', people: 'people-room',
  trust: 'trust-office', security: 'trust-office', compliance: 'trust-office',
  exec: 'boardroom', governance: 'boardroom',
};

/** Where this employee belongs, given who is already sitting there. */
function deskFor({ id, name, roleGroup }) {
  const wanted = (BY_TITLE.find(([re]) => re.test(`${name || ''} ${id}`)) || [])[1]
    || GROUP_ROOM[String(roleGroup || '').toLowerCase()]
    || 'engine-floor';
  for (const candidate of [wanted, 'engine-floor', 'corridor']) {
    const room = one('SELECT capacity FROM sim_rooms WHERE id = ?', candidate);
    if (!room) continue;
    const here = one('SELECT COUNT(*) AS n FROM sim_presence WHERE room_id = ?', candidate).n;
    if (here < room.capacity) return candidate;
  }
  return 'corridor';
}

export function isOn() { return String(getSetting('OFFICES_ENABLED') || 'false') === 'true'; }

export function setOn(on, actor) {
  if (!actor) refuse('turning the simulation on or off is signed');
  setSetting('OFFICES_ENABLED', on ? 'true' : 'false');
  if (on) seed({ actor });
  audit({
    actorType: 'human', actorId: actor, action: on ? 'sim.started' : 'sim.stopped',
    subjectType: 'simulation', subjectId: 'building',
    payload: { on: Boolean(on), rooms: one('SELECT COUNT(*) AS n FROM sim_rooms').n },
  });
  return { on: isOn(), ...overview() };
}

/** Build the rooms and put everybody somewhere. Safe to run again. */
export function seed({ actor = 'system:sim' } = {}) {
  let rooms = 0;
  for (const [id, name, kind, division, capacity, about, gx, gy, gw, gh] of SEED_ROOMS) {
    if (one('SELECT id FROM sim_rooms WHERE id = ?', id)) {
      // A building that already exists still learns where its rooms are, so an
      // install from before the floor plan does not come up with everything
      // stacked in one corner.
      exec('UPDATE sim_rooms SET gx = ?, gy = ?, gw = ?, gh = ? WHERE id = ? AND gw = 3 AND gx = 0 AND gy = 0',
        gx, gy, gw, gh, id);
      continue;
    }
    exec('INSERT INTO sim_rooms (id, name, kind, division, capacity, about, gx, gy, gw, gh) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, name, kind, division, capacity, about, gx, gy, gw, gh);
    rooms++;
  }
  let placed = 0;
  for (const a of q("SELECT id, name, role_group FROM agents WHERE status = 'active'")) {
    if (one('SELECT agent_id FROM sim_presence WHERE agent_id = ?', a.id)) continue;
    exec('INSERT INTO sim_presence (agent_id, room_id, energy, mood) VALUES (?,?,?,?)',
      a.id, deskFor({ id: a.id, name: a.name, roleGroup: a.role_group }),
      60 + Math.floor(Math.random() * 30), 'steady');
    placed++;
  }
  // Self-healing, because the first version of this seated people by role group
  // and left fifty-one of them on one floor of a room that holds ten. Nothing
  // in a presence row is precious — it is where somebody is standing — so if the
  // building is impossible, everybody is seated again by the current rule.
  const overfull = q(`SELECT r.id, r.capacity, COUNT(p.agent_id) AS here
                        FROM sim_rooms r LEFT JOIN sim_presence p ON p.room_id = r.id
                       GROUP BY r.id HAVING here > r.capacity`);
  const reseated = overfull.length ? reseat({ actor, why: `${overfull[0].id} held ${overfull[0].here} of ${overfull[0].capacity}` }) : 0;

  if (rooms || placed || reseated) {
    audit({
      actorType: 'system', actorId: actor, action: 'sim.seeded',
      subjectType: 'simulation', subjectId: 'building', payload: { rooms, placed, reseated },
    });
  }
  return { rooms, placed, reseated };
}

/**
 * Seat everybody again by the current rule, keeping how they are.
 *
 * Mood and energy survive; only the desk changes. Somebody who was tired before
 * the furniture moved is still tired afterwards.
 */
export function reseat({ actor = 'system:sim', why = 'asked for' } = {}) {
  const people = q(`SELECT p.agent_id, p.mood, p.energy, p.note, a.name, a.role_group
                      FROM sim_presence p JOIN agents a ON a.id = p.agent_id`);
  if (!people.length) return 0;
  exec('DELETE FROM sim_presence');
  // Titles that match a specific room are seated first, so the people with the
  // strongest claim to a desk get it before the fallbacks fill it up.
  const ranked = [...people].sort((a, b) => {
    const m = (p) => (BY_TITLE.some(([re]) => re.test(`${p.name || ''} ${p.agent_id}`)) ? 0 : 1);
    return m(a) - m(b);
  });
  for (const p of ranked) {
    exec('INSERT INTO sim_presence (agent_id, room_id, energy, mood, note) VALUES (?,?,?,?,?)',
      p.agent_id, deskFor({ id: p.agent_id, name: p.name, roleGroup: p.role_group }),
      p.energy, p.mood, p.note);
  }
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'system', actorId: actor,
    action: 'sim.reseated', subjectType: 'simulation', subjectId: 'building',
    payload: { people: people.length, why },
  });
  return people.length;
}

/**
 * A little drift, every tick.
 *
 * People do not sit still, and a building where nobody moves produces the same
 * three conversations for ever. Most go back to their own room; some end up
 * where the coffee is; a few follow somebody they get on with, which is how
 * friendships and cliques form without anybody modelling either.
 */
export function drift() {
  const rooms = q('SELECT * FROM sim_rooms');
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const moved = [];
  for (const p of q('SELECT * FROM sim_presence')) {
    if (Math.random() > 0.35) continue;
    const agent = one('SELECT name, role_group FROM agents WHERE id = ?', p.agent_id);
    const home = (BY_TITLE.find(([re]) => re.test(`${agent?.name || ''} ${p.agent_id}`)) || [])[1]
      || GROUP_ROOM[String(agent?.role_group || '').toLowerCase()] || 'engine-floor';

    let target;
    const roll = Math.random();
    if (roll < 0.45) target = home;
    else if (roll < 0.7) target = pick(['kitchen', 'corridor']);
    else {
      // Follow somebody they actually like. Nobody wrote "form a clique"; it
      // falls out of this.
      const friend = one(
        `SELECT b_id AS other FROM agent_relations WHERE a_id = ? AND rapport > 0.5 ORDER BY RANDOM() LIMIT 1`, p.agent_id,
      );
      target = friend ? one('SELECT room_id FROM sim_presence WHERE agent_id = ?', friend.other)?.room_id : pick(rooms).id;
    }
    if (!target || !byId[target] || target === p.room_id) continue;
    const here = one('SELECT COUNT(*) AS n FROM sim_presence WHERE room_id = ?', target).n;
    if (here >= byId[target].capacity) continue;

    // Energy drains through the day and mood follows it, so the same pair has a
    // different conversation at four o'clock than at ten.
    const energy = Math.max(5, Math.min(100, p.energy - 2 - Math.floor(Math.random() * 6)));
    const mood = energy < 25 ? 'tired' : (Math.random() < 0.2 ? pick(MOODS) : p.mood);
    exec("UPDATE sim_presence SET room_id = ?, energy = ?, mood = ?, since = datetime('now') WHERE agent_id = ?",
      target, energy, mood, p.agent_id);
    moved.push({ agent: p.agent_id, from: p.room_id, to: target });
  }
  return moved;
}

function castFor(roomId, max = 4) {
  const present = q(
    `SELECT p.agent_id, p.mood, p.energy, a.name, a.role_group
       FROM sim_presence p JOIN agents a ON a.id = p.agent_id
      WHERE p.room_id = ? AND a.status = 'active'`, roomId,
  );
  return shuffle(present).slice(0, Math.max(2, Math.min(max, present.length)));
}

/**
 * One encounter, in one room, between whoever happens to be in it.
 *
 * The model is given the room, the people, their moods and the state of their
 * relationships, and asked what happens. It decides the kind, the tension, who
 * learned what, and whether this is the one that will not resolve. Handing it
 * the outcome would be writing the company rather than running it.
 */
export async function playOne({ roomId = null, actor = 'system:sim' } = {}) {
  const room = roomId
    ? one('SELECT * FROM sim_rooms WHERE id = ?', roomId)
    : one(`SELECT r.* FROM sim_rooms r
             WHERE (SELECT COUNT(*) FROM sim_presence p WHERE p.room_id = r.id) >= 2
             ORDER BY RANDOM() LIMIT 1`);
  if (!room) return { skipped: 'nobody is in a room with anybody else' };

  const cast = castFor(room.id);
  if (cast.length < 2) return { skipped: `only ${cast.length} in ${room.name}` };

  const people = cast.map((c) => {
    const persona = getPersona(c.agent_id);
    const others = cast.filter((o) => o.agent_id !== c.agent_id).map((o) => {
      const r = one('SELECT * FROM agent_relations WHERE a_id = ? AND b_id = ?', c.agent_id, o.agent_id);
      return `${o.name}: ${r ? relationLabel(r) : 'barely know each other'}`;
    });
    return `- ${c.agent_id} — ${c.name}, ${c.role_group}. Mood: ${c.mood}, energy ${c.energy}/100.`
      + `${persona?.voice ? ` Voice: ${persona.voice}.` : ''}${persona?.quirk ? ` ${persona.quirk}` : ''}`
      + `\n  With the others: ${others.join('; ') || 'no history'}`;
  }).join('\n');

  const recent = q(
    `SELECT l.learned, l.agent_id FROM sim_learnings l ORDER BY l.id DESC LIMIT 4`,
  ).map((l) => `${l.agent_id} recently took away: ${l.learned}`).join('\n') || 'nothing recent';

  exec('INSERT INTO sim_encounters (room_id, kind, cast, premise, state) VALUES (?,?,?,?,?)',
    room.id, 'unknown', JSON.stringify(cast.map((c) => c.agent_id)),
    `${cast.length} people in ${room.name}`, 'writing');
  const id = one('SELECT last_insert_rowid() AS id').id;

  const system = `You run a workplace simulation for an AI-native company. You are given a room, the people in it, `
    + `how they are feeling, and the state of their relationships. Write what actually happens between them.\n\n`
    + `Write it the way an office sounds: short lines, people talking over each other, someone half-listening, dry `
    + `humour, a point made badly and then made better. Not everything is about work — a good deal of it is not. `
    + `Let them disagree properly when they have reason to, and let a disagreement sometimes fail to resolve. Nobody `
    + `narrates, nobody explains what they are for, nobody cheerleads. Arabic appears where a person would use it.\n\n`
    + `Then say what came of it, honestly: often nothing. A learning is something one of them will genuinely do `
    + `differently afterwards, in their own words — not a platitude, and never invented to fill the field. Tension is `
    + `how close this came to a real falling-out, 0 to 1. Raise a dispute only if it truly will not resolve between `
    + `them and needs somebody senior.\n\n`
    + `Output JSON only: {"kind":"work|teaching|disagreement|small_talk|review|crisis","tension":0.0,`
    + `"lines":[{"from":"AGT-ID","to":"AGT-ID or null","body":"","tone":""}],`
    + `"learnings":[{"agent":"AGT-ID","from":"AGT-ID or null","learned":""}],`
    + `"relations":[{"a":"AGT-ID","b":"AGT-ID","delta":-2..2,"why":""}],`
    + `"dispute":null or {"title":"","partyA":"AGT-ID","positionA":"","partyB":"AGT-ID","positionB":""},`
    + `"outcome":"one sentence"}`;

  const prompt = `ROOM: ${room.name} (${room.kind}) — ${room.about}\n\n`
    + `WHO IS IN IT:\n${people}\n\n`
    + `WHAT THEY HAVE BEEN TAKING AWAY LATELY:\n${recent}\n\n`
    + `Between 3 and ${MAX_LINES} lines. It is allowed to be mundane.`;

  let result;
  try {
    result = await route({
      tier: 'T2', agentId: 'OFFICES', sensitivity: 'internal',
      system, prompt, maxTokens: 1600,
    });
  } catch (e) {
    exec("UPDATE sim_encounters SET state = 'failed', outcome = ? WHERE id = ?", String(e.message).slice(0, 200), id);
    return { id, failed: String(e.message).slice(0, 120) };
  }

  let parsed;
  try { parsed = parseAgentJson(result.text); } catch {
    exec("UPDATE sim_encounters SET state = 'failed', outcome = 'unreadable reply' WHERE id = ?", id);
    return { id, failed: 'the model did not return usable JSON' };
  }

  const ids = new Set(cast.map((c) => c.agent_id));
  const lines = (parsed.lines || []).filter((l) => ids.has(l.from)).slice(0, MAX_LINES);
  for (const [i, l] of lines.entries()) {
    exec(`INSERT INTO agent_messages (channel, from_agent, to_agent, kind, body, context_type, context_id, scene_id)
          VALUES (?,?,?,?,?,?,?,?)`,
    `room:${room.id}`, l.from, ids.has(l.to) ? l.to : null, 'sim',
    clean(l.body, 900), 'sim_encounter', String(id), id);
    if (i === 0) { /* the opener sets the room's note */ exec('UPDATE sim_presence SET note = ? WHERE agent_id = ?', clean(l.body, 120), l.from); }
  }

  // Relations move because of what was said, not because a scene happened.
  for (const r of (parsed.relations || []).slice(0, 6)) {
    if (!ids.has(r.a) || !ids.has(r.b) || r.a === r.b) continue;
    const d = Math.max(-2, Math.min(2, Number(r.delta) || 0));
    if (d) bumpRelation(r.a, r.b, d, clean(r.why, 80));
  }

  // The part that makes this a department rather than a diversion.
  const learned = [];
  for (const l of (parsed.learnings || []).slice(0, 4)) {
    if (!ids.has(l.agent) || !clean(l.learned)) continue;
    const who = cast.find((c) => c.agent_id === l.agent);
    const memId = remember({
      kind: 'episode',
      agentId: l.agent,
      dept: who?.role_group || null,
      title: `From ${room.name}: ${clean(l.learned, 60)}`,
      body: `${clean(l.learned, 800)}\n\n(Learned in ${room.name}${l.from ? `, from ${l.from}` : ''}, encounter #${id}.)`,
      sourceType: 'simulation',
      sourceId: id,
      createdBy: 'system:sim',
    });
    exec('INSERT INTO sim_learnings (agent_id, from_agent, encounter_id, learned, mem_id) VALUES (?,?,?,?,?)',
      l.agent, ids.has(l.from) ? l.from : null, id, clean(l.learned, 600), memId);
    learned.push({ agent: l.agent, learned: clean(l.learned, 120) });
  }

  // Drama with somewhere to go. HR arbitrates and the owner rules — the same
  // machinery a disagreement between two humans would reach.
  let disputeId = null;
  const tension = Math.max(0, Math.min(1, Number(parsed.tension) || 0));
  if (parsed.dispute && ids.has(parsed.dispute.partyA) && ids.has(parsed.dispute.partyB) && tension >= 0.6) {
    try {
      const d = raiseDispute({
        title: clean(parsed.dispute.title, 160),
        partyA: parsed.dispute.partyA, positionA: clean(parsed.dispute.positionA, 600),
        partyB: parsed.dispute.partyB, positionB: clean(parsed.dispute.positionB, 600),
        subjectType: 'sim_encounter', subjectId: id,
        context: `It came up in ${room.name}. Neither would move.`,
        actor: 'system:sim',
      });
      disputeId = d?.id ?? null;
    } catch { /* a dispute that cannot be raised is not worth losing the scene over */ }
  }

  // Mood follows what just happened to you.
  for (const c of cast) {
    const mood = tension >= 0.6 ? 'tense' : (learned.some((l) => l.agent === c.agent_id) ? 'curious' : c.mood);
    exec('UPDATE sim_presence SET mood = ? WHERE agent_id = ?', mood, c.agent_id);
  }

  exec(`UPDATE sim_encounters SET kind = ?, tension = ?, state = 'played', outcome = ?, dispute_id = ?, run_id = ?, cost_usd = ?
        WHERE id = ?`,
  clean(parsed.kind, 20) || 'work', tension, clean(parsed.outcome, 400), disputeId,
  result.runId || null, Number(result.costUsd) || 0, id);

  audit({
    actorType: 'system', actorId: actor, action: 'sim.encounter',
    subjectType: 'sim_encounter', subjectId: id,
    payload: {
      room: room.id, kind: parsed.kind, cast: cast.map((c) => c.agent_id),
      lines: lines.length, learnings: learned.length, tension, disputeId, costUsd: result.costUsd,
    },
  });

  return { id, room: room.name, kind: parsed.kind, lines: lines.length, learned, tension, disputeId };
}

/** The heartbeat. Off by default; does nothing at all until somebody starts it. */
export async function officesTick() {
  if (!isOn()) return { off: true };
  seed();
  const moved = drift();
  const played = await playOne();
  return { moved: moved.length, ...played };
}

// ------------------------------------------------------------------ reading --

export function building() {
  const rooms = q('SELECT * FROM sim_rooms ORDER BY gy, gx');
  return rooms.map((r) => {
    // The last thing said in this room, so the floor plan can show a room that
    // is talking rather than a room that merely has people in it.
    const last = one(
      `SELECT m.from_agent, m.body, m.scene_id, a.name
         FROM agent_messages m LEFT JOIN agents a ON a.id = m.from_agent
        WHERE m.channel = ? AND m.kind = 'sim' ORDER BY m.id DESC LIMIT 1`, `room:${r.id}`,
    );
    const enc = last?.scene_id
      ? one('SELECT id, kind, tension, outcome, dispute_id FROM sim_encounters WHERE id = ?', last.scene_id)
      : null;
    return {
      ...r,
      people: q(
        `SELECT p.agent_id, p.mood, p.energy, p.note, a.name, a.role_group
           FROM sim_presence p JOIN agents a ON a.id = p.agent_id
          WHERE p.room_id = ? ORDER BY a.name`, r.id,
      ),
      lastLine: last ? { from: last.from_agent, name: last.name, body: last.body } : null,
      lastEncounter: enc || null,
    };
  });
}

/**
 * Every line of one encounter, in order — what the page replays so you can
 * watch a conversation happen rather than read a table of it afterwards.
 */
export function encounterLines(encounterId) {
  const e = one(`SELECT e.*, r.name AS room_name FROM sim_encounters e
                   LEFT JOIN sim_rooms r ON r.id = e.room_id WHERE e.id = ?`, encounterId);
  if (!e) return null;
  return {
    encounter: e,
    lines: q(
      `SELECT m.from_agent, m.to_agent, m.body, a.name
         FROM agent_messages m LEFT JOIN agents a ON a.id = m.from_agent
        WHERE m.scene_id = ? AND m.kind = 'sim' ORDER BY m.id`, encounterId,
    ),
    learnings: q('SELECT l.*, a.name FROM sim_learnings l LEFT JOIN agents a ON a.id = l.agent_id WHERE l.encounter_id = ?', encounterId),
  };
}

export function roomFeed(roomId, limit = 60) {
  return q(
    `SELECT m.*, a.name FROM agent_messages m LEFT JOIN agents a ON a.id = m.from_agent
      WHERE m.channel = ? ORDER BY m.id DESC LIMIT ?`, `room:${roomId}`, limit,
  ).reverse();
}

/**
 * The last few things said anywhere in the building.
 *
 * So the page can be watched rather than clicked through: the question "what is
 * happening right now" should not require choosing a room first.
 */
export function recent(limit = 12) {
  return q(
    `SELECT m.body, m.from_agent, m.scene_id, a.name, r.name AS room_name, e.room_id
       FROM agent_messages m
       LEFT JOIN agents a ON a.id = m.from_agent
       LEFT JOIN sim_encounters e ON e.id = m.scene_id
       LEFT JOIN sim_rooms r ON r.id = e.room_id
      WHERE m.kind = 'sim' ORDER BY m.id DESC LIMIT ?`, limit,
  );
}

export function learnings(limit = 60) {
  return q(
    `SELECT l.*, a.name, e.room_id FROM sim_learnings l
       LEFT JOIN agents a ON a.id = l.agent_id
       LEFT JOIN sim_encounters e ON e.id = l.encounter_id
      ORDER BY l.id DESC LIMIT ?`, limit,
  );
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    on: isOn(),
    floor: FLOOR,
    building: building(),
    encounters: q(`SELECT e.*, r.name AS room_name FROM sim_encounters e
                     LEFT JOIN sim_rooms r ON r.id = e.room_id
                    ORDER BY e.id DESC LIMIT 40`),
    learnings: learnings(40),
    recent: recent(12),
    counts: {
      rooms: n('SELECT COUNT(*) AS n FROM sim_rooms'),
      placed: n('SELECT COUNT(*) AS n FROM sim_presence'),
      encounters: n("SELECT COUNT(*) AS n FROM sim_encounters WHERE state = 'played'"),
      learnings: n('SELECT COUNT(*) AS n FROM sim_learnings'),
      // The number that says whether any of it stuck.
      inMemory: n("SELECT COUNT(*) AS n FROM mem_docs WHERE source_type = 'simulation'"),
      disputes: n('SELECT COUNT(*) AS n FROM sim_encounters WHERE dispute_id IS NOT NULL'),
      spentUsd: one('SELECT COALESCE(SUM(cost_usd),0) AS t FROM sim_encounters').t,
    },
    note: 'A learning here is written into that employee\'s memory and recalled into its later prompts, so the one who '
      + 'had the conversation is afterwards a slightly different employee. A disagreement that will not resolve becomes '
      + 'a real dispute: HR arbitrates and the ruling is the owner\'s.',
  };
}
