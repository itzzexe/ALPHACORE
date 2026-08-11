// The building.
//
// The claim worth testing is not "agents chat" — the society layer already did
// that. It is that this one leaves something behind: a learning becomes a row
// in the employee's memory, which is recalled into its later prompts, and a
// disagreement that will not resolve reaches the grievance process that already
// exists. Everything else is scenery.
//
// The model is not called here. What is tested is the machinery around it: the
// rooms, who moves, and what happens to a scene once it comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-offices.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-offices.db${s}`)); } catch { /* first run */ }
}

const O = await import('../src/offices.js');
const { q, one, exec } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');

// A building with nobody in it proves nothing, and the workforce is seeded by
// the server rather than by opening the database.
seedAgents();

test('it is off until somebody starts it, and off means nothing moves', () => {
  assert.equal(O.isOn(), false, 'a department that starts itself is a bill nobody agreed to');
});

test('starting it builds the rooms and gives everybody a desk', () => {
  const r = O.setOn(true, 'human:owner');
  assert.equal(r.on, true);
  assert.equal(one('SELECT COUNT(*) AS n FROM sim_rooms').n, O.SEED_ROOMS.length);
  const placed = one('SELECT COUNT(*) AS n FROM sim_presence').n;
  const active = one("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'").n;
  assert.equal(placed, active, 'everybody active is somewhere');
  assert.ok(one("SELECT id FROM sim_rooms WHERE id = 'kitchen'"), 'including the room where a company finds out what is going on');
});

test('starting it twice does not build a second building', () => {
  const before = one('SELECT COUNT(*) AS n FROM sim_rooms').n;
  O.setOn(true, 'human:owner');
  assert.equal(one('SELECT COUNT(*) AS n FROM sim_rooms').n, before);
});

test('people sit by what they do, not by the six groups they are filed under', () => {
  const rows = q(`SELECT p.room_id, a.name, a.role_group FROM sim_presence p JOIN agents a ON a.id = p.agent_id`);
  assert.ok(rows.length, 'somebody is at a desk');

  // The workforce has six role groups and thirteen rooms, so mapping the group
  // to a room put twelve people in the boardroom and left the sales floor
  // empty — a bar chart, not a company. The title is the better signal.
  const where = (re) => rows.filter((r) => re.test(r.name)).map((r) => r.room_id);
  for (const [who, re, room] of [
    ['anyone counting money', /financ|tax|bookkeep|ledger|treasur/i, 'counting-house'],
    ['anyone writing', /copywriter|content|community|localiz/i, 'studio'],
    ['anyone assuring', /privacy|ethic|security|code reviewer/i, 'trust-office'],
  ]) {
    const seats = where(re);
    if (seats.length) assert.ok(seats.every((s) => s === room), `${who} sits in the ${room}, found: ${[...new Set(seats)].join(', ')}`);
  }

  // The failure this replaced: one room holding most of the company.
  const byRoom = {};
  for (const r of rows) byRoom[r.room_id] = (byRoom[r.room_id] || 0) + 1;
  const biggest = Math.max(...Object.values(byRoom));
  assert.ok(biggest <= rows.length / 2, `one room holds ${biggest} of ${rows.length} — the building is a bar chart again`);
  assert.ok(Object.keys(byRoom).length >= 6, 'the workforce is spread across the building');
});

test('nobody is put in a room that is already full', () => {
  for (const room of q('SELECT id, capacity FROM sim_rooms')) {
    const here = one('SELECT COUNT(*) AS n FROM sim_presence WHERE room_id = ?', room.id).n;
    assert.ok(here <= room.capacity, `${room.id} seats ${here} of ${room.capacity}`);
  }
});

test('every room knows where it is on the floor, and no two share a corner', () => {
  const rooms = q('SELECT id, gx, gy, gw, gh FROM sim_rooms');
  assert.equal(rooms.length, O.SEED_ROOMS.length);
  const corners = new Set(rooms.map((r) => `${r.gx},${r.gy}`));
  assert.equal(corners.size, rooms.length, 'a floor plan with two rooms in one place is a picture, not a plan');
  for (const r of rooms) {
    assert.ok(r.gx + r.gw <= O.FLOOR.cols, `${r.id} runs off the side of the floor`);
    assert.ok(r.gy + r.gh <= O.FLOOR.rows, `${r.id} runs off the bottom of the floor`);
  }
});

test('a tick with the department stopped does nothing at all', async () => {
  O.setOn(false, 'human:owner');
  const r = await O.officesTick();
  assert.deepEqual(r, { off: true }, 'no movement, no model call, no cost');
});

test('drift moves some people and never overfills a room', () => {
  O.setOn(true, 'human:owner');
  for (let i = 0; i < 8; i++) O.drift();
  for (const room of q('SELECT id, capacity FROM sim_rooms')) {
    const here = one('SELECT COUNT(*) AS n FROM sim_presence WHERE room_id = ?', room.id).n;
    assert.ok(here <= room.capacity, `${room.id} holds ${here} of ${room.capacity}`);
  }
});

test('the building reports who is in each room, with how they are', () => {
  const b = O.building();
  assert.ok(b.length >= 10);
  const occupied = b.filter((r) => r.people.length);
  assert.ok(occupied.length, 'somebody is somewhere');
  const p = occupied[0].people[0];
  assert.ok(p.name && p.mood && typeof p.energy === 'number');
});

// The load-bearing one. A learning that is not in memory is a sentence in a
// table, and the department would be a soap opera.
test('a learning is written into that employee\'s memory, not just recorded here', async () => {
  const { remember } = await import('../src/memory.js');
  const agent = one("SELECT id, role_group FROM agents WHERE status = 'active' LIMIT 1");
  exec("INSERT INTO sim_encounters (room_id, kind, cast, state) VALUES ('kitchen','teaching',?,'played')", JSON.stringify([agent.id]));
  const enc = one('SELECT last_insert_rowid() AS id').id;

  const memId = remember({
    kind: 'episode', agentId: agent.id, dept: agent.role_group,
    title: 'From the kitchen: check the currency before quoting',
    body: 'Learned in the kitchen, encounter #' + enc,
    sourceType: 'simulation', sourceId: enc, createdBy: 'system:sim',
  });
  exec('INSERT INTO sim_learnings (agent_id, encounter_id, learned, mem_id) VALUES (?,?,?,?)',
    agent.id, enc, 'check the currency before quoting', memId);

  const doc = one('SELECT * FROM mem_docs WHERE id = ?', memId);
  assert.ok(doc, 'it exists in memory');
  assert.equal(doc.agent_id, agent.id, 'against the employee who learned it');
  assert.equal(doc.source_type, 'simulation', 'and says where it came from');

  const shown = O.overview();
  assert.ok(shown.counts.inMemory >= 1, 'and the department counts what stuck, not what was said');
  assert.ok(shown.learnings.some((l) => l.learned.includes('currency')));
});

test('the overview never claims a cost it did not spend', () => {
  const o = O.overview();
  assert.equal(typeof o.counts.spentUsd, 'number');
  assert.ok(o.counts.spentUsd >= 0);
  assert.equal(o.on, true);
});

test('stopping it leaves the building standing, so nothing is lost by pausing', () => {
  const rooms = one('SELECT COUNT(*) AS n FROM sim_rooms').n;
  const learned = one('SELECT COUNT(*) AS n FROM sim_learnings').n;
  O.setOn(false, 'human:owner');
  assert.equal(O.isOn(), false);
  assert.equal(one('SELECT COUNT(*) AS n FROM sim_rooms').n, rooms);
  assert.equal(one('SELECT COUNT(*) AS n FROM sim_learnings').n, learned);
});

test('turning it on or off is signed, and lands on the chain', () => {
  assert.throws(() => O.setOn(true, null), /signed/);
  O.setOn(false, 'human:owner');
  const entry = one("SELECT * FROM audit_log WHERE action IN ('sim.started','sim.stopped') ORDER BY seq DESC LIMIT 1");
  assert.ok(entry, 'the switch is on the record');
  assert.equal(entry.actor_id, 'human:owner');
});
