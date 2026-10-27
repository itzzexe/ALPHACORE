// The production studio — films, adverts, series and podcasts from the first
// line to delivery, and the copywriting desk beside it.
//
// A script is kept in Fountain, the plain-text screenplay format: a scene
// heading starts with INT. or EXT., a character cue is a line in capitals,
// and the dialogue follows it. That plain text is enough to break a script
// down without a model — scenes, locations, day or night, who speaks and how
// much, and the page count that decides the shooting days (about a page a
// minute on screen). The breakdown is what a line producer schedules from.
//
// Delivery puts the finished production in the archive, where the rest of the
// company's work already lives. Publishing it anywhere outside is still the
// marketing desk's act, through a person.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const clean = (s, n = 1000) => String(s ?? '').trim().slice(0, n);
export const KINDS = ['film', 'series', 'ad', 'corporate', 'podcast', 'social'];
export const STAGES = ['development', 'preproduction', 'production', 'post', 'delivered'];

// ---------------------------------------------------------------- script --

const HEADING = /^(?:\.(?!\.)|(?:INT|EXT|EST|INT\.\/EXT|I\/E|داخلي|خارجي)[.\s])/i;

/** Read a Fountain script into scenes, characters and an estimated running time. */
export function breakdown(script) {
  const lines = String(script || '').replace(/\r/g, '').split('\n');
  const scenes = [];
  const characters = new Map();
  let cur = null;
  let words = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    words += line.split(/\s+/).length;
    if (HEADING.test(line)) {
      const heading = line.replace(/^\./, '').trim();
      const time = (heading.match(/[-–—]\s*([^-–—]+)$/) || [])[1]?.trim() || null;
      const loc = heading.replace(/^(INT\.\/EXT|INT|EXT|EST|I\/E|داخلي|خارجي)[.\s]*/i, '').replace(/[-–—][^-–—]*$/, '').trim();
      cur = { n: scenes.length + 1, heading, location: loc, time, interior: /^(\.)?(INT|داخلي)/i.test(heading), characters: new Set(), lines: 0 };
      scenes.push(cur);
      continue;
    }
    // A character cue: a short line in capitals (or prefixed with @), followed by dialogue.
    const cue = line.startsWith('@') ? line.slice(1) : (line === line.toUpperCase() && /[A-Z]/.test(line) && line.length <= 40 && !line.endsWith('TO:') ? line : null);
    if (cue && lines[i + 1]?.trim()) {
      const name = cue.replace(/\(.*\)/, '').trim();
      const c = characters.get(name) || { name, lines: 0, scenes: new Set() };
      c.lines += 1;
      if (cur) { c.scenes.add(cur.n); cur.characters.add(name); cur.lines += 1; }
      characters.set(name, c);
    }
  }
  const pages = Math.max(scenes.length ? 0.1 : 0, Math.round((words / 180) * 10) / 10);
  return {
    scenes: scenes.map((s) => ({ ...s, characters: [...s.characters] })),
    characters: [...characters.values()].map((c) => ({ name: c.name, lines: c.lines, scenes: [...c.scenes] })).sort((a, b) => b.lines - a.lines),
    locations: [...new Set(scenes.map((s) => s.location).filter(Boolean))],
    pages,
    minutes: Math.round(pages),
    nightScenes: scenes.filter((s) => /night|ليل/i.test(s.time || '')).length,
  };
}

// ----------------------------------------------------------- productions --

export function createProduction({ title, kind = 'ad', logline = '', budget = 0, due = null, owner = null, actor }) {
  if (!clean(title, 200)) refuse('a production has a title');
  if (!KINDS.includes(kind)) refuse(`kind must be one of: ${KINDS.join(', ')}`);
  const r = exec('INSERT INTO media_productions (title, kind, logline, budget, due, owner, created_by) VALUES (?,?,?,?,?,?,?)',
    clean(title, 200), kind, clean(logline, 500), Math.max(0, Number(budget) || 0), due, clean(owner, 80) || null, actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'production.created', subjectType: 'media_production', subjectId: Number(r.lastInsertRowid), payload: { title, kind } });
  return getProduction(Number(r.lastInsertRowid));
}

export function saveScript({ id, script, actor }) {
  const p = one('SELECT * FROM media_productions WHERE id = ?', Number(id));
  if (!p) refuse('no such production', 404);
  if (p.stage === 'delivered') refuse('a delivered production is archived — open a new version instead');
  exec("UPDATE media_productions SET script = ?, updated_at = datetime('now') WHERE id = ?", String(script || '').slice(0, 400_000), p.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'production.script_saved', subjectType: 'media_production', subjectId: p.id, payload: { chars: String(script || '').length } });
  return getProduction(p.id);
}

export function advance({ id, spent = null, actor }) {
  const p = one('SELECT * FROM media_productions WHERE id = ?', Number(id));
  if (!p) refuse('no such production', 404);
  const next = STAGES[STAGES.indexOf(p.stage) + 1];
  if (!next) refuse('already delivered');
  if (next === 'preproduction' && !p.script.trim() && ['film', 'series', 'ad'].includes(p.kind)) refuse('pre-production starts from a script');
  if (next === 'delivered') {
    if (!isHuman(actor)) refuse('signing off delivery is a person’s act', 403);
    // Into the archive the rest of the company already searches.
    const b = breakdown(p.script);
    const a = exec("INSERT INTO archive_items (title, kind, subject_type, subject_id, snapshot, created_by) VALUES (?, 'production', 'media_production', ?, ?, ?)",
      p.title, String(p.id), JSON.stringify({ kind: p.kind, logline: p.logline, scenes: b.scenes.length, minutes: b.minutes, characters: b.characters.map((c) => c.name), budget: p.budget, spent: p.spent, script: p.script.slice(0, 200_000) }), actor);
    exec('UPDATE media_productions SET archive_id = ? WHERE id = ?', Number(a.lastInsertRowid), p.id);
  }
  exec("UPDATE media_productions SET stage = ?, spent = COALESCE(?, spent), updated_at = datetime('now') WHERE id = ?", next, spent == null ? null : Number(spent), p.id);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: `production.${next}`, subjectType: 'media_production', subjectId: p.id });
  return getProduction(p.id);
}

export function writeScenes({ id, instructions = '', lang = 'ar', actor }) {
  const p = getProduction(id);
  const brief = `Screenplay pages in Fountain format for the ${p.kind} "${p.title}". Logline: ${p.logline || '[TO CONFIRM]'}.
Scene headings as INT./EXT. LOCATION - DAY/NIGHT, character names in capitals on their own line, dialogue under them. Keep it shootable on the budget of ${p.budget || '[TO CONFIRM]'}.
${instructions ? `The person asking adds: ${instructions}` : ''}
${p.script ? `Continue from the script so far (last part):\n${p.script.slice(-4000)}` : 'Start from the opening scene.'}
Put the Fountain text in "markdown".`;
  return requestDraft({ dept: 'production', subjectType: 'media_production', subjectId: p.id, kind: 'screenplay', agentId: 'AGT-SCR-001', brief, lang, actor });
}

export function getProduction(id) {
  const p = one('SELECT * FROM media_productions WHERE id = ?', Number(id));
  if (!p) refuse('no such production', 404);
  return { ...p, breakdown: breakdown(p.script), drafts: draftsFor('production', 'media_production', p.id, 5) };
}

// ------------------------------------------------------------------- copy --

export function addBrief({ product, audience = '', goal = '', channel = '', tone = '', lang = 'ar', actor }) {
  if (!clean(product, 200)) refuse('what is the copy for?');
  const r = exec('INSERT INTO copy_briefs (product, audience, goal, channel, tone, lang, created_by) VALUES (?,?,?,?,?,?,?)',
    clean(product, 200), clean(audience, 300), clean(goal, 300), clean(channel, 80), clean(tone, 80), lang === 'en' ? 'en' : 'ar', actor);
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: 'production.copy_brief', subjectType: 'copy_brief', subjectId: Number(r.lastInsertRowid) });
  const b = one('SELECT * FROM copy_briefs WHERE id = ?', Number(r.lastInsertRowid));
  requestDraft({
    dept: 'production', subjectType: 'copy_brief', subjectId: b.id, kind: 'copy', agentId: 'AGT-CNT-002', lang: b.lang, actor,
    brief: `Copy for ${b.product}. Audience: ${b.audience || '[TO CONFIRM]'}. Goal: ${b.goal || '[TO CONFIRM]'}. Channel: ${b.channel || 'any'}. Tone: ${b.tone || 'plain and confident'}.
Write five distinct variants. Each: a headline under 10 words, a body under 40 words, and a call to action. No claim that cannot be evidenced, no invented prices. Put them in "items" as {headline, body, cta}.`,
  });
  return b;
}

/** A person picks the line that goes out. The pick is what the rest of the company may use. */
export function chooseCopy({ id, text, actor }) {
  if (!isHuman(actor)) refuse('choosing the copy is a person’s act', 403);
  const b = one('SELECT * FROM copy_briefs WHERE id = ?', Number(id));
  if (!b) refuse('no such brief', 404);
  if (!clean(text)) refuse('choose a variant');
  exec("UPDATE copy_briefs SET chosen = ?, state = 'chosen' WHERE id = ?", clean(text, 2000), b.id);
  audit({ actorType: 'human', actorId: actor, action: 'production.copy_chosen', subjectType: 'copy_brief', subjectId: b.id });
  return one('SELECT * FROM copy_briefs WHERE id = ?', b.id);
}

export function overview() {
  const prods = q('SELECT id, title, kind, stage, budget, spent, due, owner, updated_at, length(script) AS chars FROM media_productions ORDER BY CASE stage WHEN \'delivered\' THEN 1 ELSE 0 END, id DESC LIMIT 60');
  return {
    productions: prods,
    byStage: Object.fromEntries(STAGES.map((s) => [s, prods.filter((p) => p.stage === s).length])),
    overBudget: prods.filter((p) => p.budget > 0 && p.spent > p.budget).length,
    briefs: q('SELECT * FROM copy_briefs ORDER BY id DESC LIMIT 30').map((b) => ({ ...b, drafts: draftsFor('production', 'copy_brief', b.id, 2) })),
  };
}
