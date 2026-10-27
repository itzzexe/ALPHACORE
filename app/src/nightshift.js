// THE NIGHT SHIFT — heavy writing done by a larger model while nobody waits.
//
// On a two-core server the small model answers in seconds and writes a policy
// badly; a 7B model writes it well and takes ten minutes, during which nothing
// else can use the machine. So the work is split by when it is needed rather
// than by who asked: questions are answered now by the small model, and drafts
// — policies, audit programmes, gap analyses, briefs — wait for the night
// window and are written by the larger one. A person who cannot wait presses
// "write it now" and gets the small model straight away.
//
// Hours are UTC, as everything stored is; the page shows them in local time.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret, setSetting } from './settings.js';
import { localRuntime } from './router.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const hour = (v, d) => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };

export function nightConfig() {
  return {
    on: String(getSecret('NIGHT_SHIFT') || '').toLowerCase() === 'true',
    model: getSecret('NIGHT_MODEL') || 'qwen2.5:7b',
    // 22:00–03:00 UTC is 01:00–06:00 in Baghdad.
    start: hour(getSecret('NIGHT_START'), 22),
    end: hour(getSecret('NIGHT_END'), 3),
  };
}

export function inWindow(now = new Date(), cfg = nightConfig()) {
  const h = now.getUTCHours();
  return cfg.start <= cfg.end ? h >= cfg.start && h < cfg.end : h >= cfg.start || h < cfg.end;
}

const sqlTime = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

/** When the next window opens, as SQLite writes times. */
export function nextWindowStart(now = new Date(), cfg = nightConfig()) {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(cfg.start);
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return sqlTime(d);
}

/**
 * The lane and start time for a piece of heavy work. Off, or already inside
 * the window, it runs now; otherwise it waits for the window to open.
 */
export function laneFor({ urgent = false } = {}, now = new Date()) {
  const cfg = nightConfig();
  if (!cfg.on || urgent) return { lane: null, notBefore: null };
  return { lane: 'night', notBefore: inWindow(now, cfg) ? null : nextWindowStart(now, cfg) };
}

/**
 * The chain a night run is sent down: the night model on Ollama. The built-in
 * engine holds one model at a time, so there the night shift only reschedules
 * the work and the loaded model writes it.
 */
export function nightChain(run) {
  const cfg = nightConfig();
  if (run?.lane !== 'night' || !cfg.on) return null;
  if (localRuntime() !== 'ollama') return null;
  return [{ provider: 'ollama', model: cfg.model }];
}

/** "I cannot wait for tonight" — the run goes now, to the day model. */
export function runNow(runId, { actor }) {
  if (!isHuman(actor)) refuse('a person decides it cannot wait', 403);
  const r = one('SELECT id, state, lane, not_before FROM runs WHERE id = ?', String(runId));
  if (!r) refuse('no such run', 404);
  if (r.state !== 'queued') refuse(`that run is ${r.state} — it is no longer waiting`);
  exec('UPDATE runs SET not_before = NULL, lane = NULL WHERE id = ?', r.id);
  audit({ actorType: 'human', actorId: actor, action: 'run.brought_forward', subjectType: 'run', subjectId: r.id, payload: { was: r.not_before } });
  return { ok: true };
}

export function configure({ on = null, model = null, start = null, end = null, actor }) {
  if (!isHuman(actor)) refuse('a person sets the night shift', 403);
  if (model != null && !/^[\w.:/-]{2,80}$/.test(String(model))) refuse('that does not look like a model name');
  if (start != null && hour(start, null) == null) refuse('the start is an hour from 0 to 23');
  if (end != null && hour(end, null) == null) refuse('the end is an hour from 0 to 23');
  if (on != null) setSetting('NIGHT_SHIFT', on ? 'true' : 'false');
  if (model != null) setSetting('NIGHT_MODEL', String(model));
  if (start != null) setSetting('NIGHT_START', String(Number(start)));
  if (end != null) setSetting('NIGHT_END', String(Number(end)));
  audit({ actorType: 'human', actorId: actor, action: 'nightshift.configured', subjectType: 'settings', subjectId: 'night_shift', payload: { on, model, start, end } });
  return nightOverview();
}

export function nightOverview() {
  const cfg = nightConfig();
  return {
    ...cfg,
    runtime: localRuntime(),
    inWindow: inWindow(new Date(), cfg),
    nextStart: nextWindowStart(new Date(), cfg),
    waiting: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'queued' AND lane = 'night'").n,
    recent: q("SELECT id, agent_id, task_type, state, model, created_at FROM runs WHERE lane = 'night' ORDER BY created_at DESC LIMIT 10"),
  };
}
