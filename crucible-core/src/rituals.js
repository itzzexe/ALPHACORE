// Governance calendar (Part 2 §9). No standing meetings — standing artifacts:
// completing a ritual requires a note, and the note is what the audit records.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { ROOT } from './env.js';
import { audit } from './audit.js';

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rituals.json'), 'utf8')).rituals;

function addPeriod(dateStr, cadence) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (cadence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (cadence === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function seedRituals() {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of config) {
    if (!one('SELECT id FROM rituals WHERE id = ?', r.id)) {
      exec('INSERT INTO rituals (id, title, cadence, description, next_due) VALUES (?,?,?,?,?)',
        r.id, r.title, r.cadence, r.description, today);
    }
  }
}

export function listRituals() {
  const today = new Date().toISOString().slice(0, 10);
  return q('SELECT * FROM rituals ORDER BY next_due ASC').map((r) => ({ ...r, overdue: r.next_due < today, dueToday: r.next_due === today }));
}

export function completeRitual(id, { note, actor }) {
  const r = one('SELECT * FROM rituals WHERE id = ?', id);
  if (!r) throw new Error('ritual not found');
  if (!note?.trim()) throw new Error('the artifact note is required — no artifact, no meeting');
  const today = new Date().toISOString().slice(0, 10);
  exec('UPDATE rituals SET last_done = ?, last_note = ?, next_due = ? WHERE id = ?',
    today, note.trim(), addPeriod(today, r.cadence), id);
  audit({ actorType: 'human', actorId: actor, action: 'ritual.completed', subjectType: 'ritual', subjectId: id, payload: { note: note.slice(0, 200) } });
  return one('SELECT * FROM rituals WHERE id = ?', id);
}
