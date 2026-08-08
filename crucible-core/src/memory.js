// Memory — how the workforce stops repeating itself.
//
// Four layers, deliberately different in kind, because one store cannot be
// fast, durable, human-editable and searchable at once:
//
//   1. EPISODIC   every finished run leaves a compact episode: what was asked,
//                 what came back, what it cost, and what the auditor thought.
//                 Raw experience, cheap to write, never edited.
//   2. SEMANTIC   a lexical retrieval index (BM25) over every episode, lesson,
//                 knowledge entry and archived artifact — Arabic and English.
//                 This is the RAG layer: real retrieval, no embedding service,
//                 no network, works offline and stays inspectable.
//   3. PLAYBOOK   one Markdown file per employee at workspace/_memory/<ID>.md —
//                 the agent's own working notes. Humans read and edit them by
//                 hand; the agent reads its playbook before every single run.
//   4. PROCEDURAL distilled lessons with provenance and confidence. Promoted
//                 from repeated episodes by a curator agent; a lesson only
//                 becomes canon when a human verifies it (Part 3 rule:
//                 unverified claims never become organizational truth).
//
// Every run gets a recall block assembled from 3 + 4 + top-k from 2, and every
// use is recorded — so we can later ask which memory actually helped.
import fs from 'node:fs';
import path from 'node:path';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { ROOT } from './env.js';
// workflow.js pulls recall() from here, so the run queue is loaded lazily
// inside startReflection rather than creating an import cycle at module load.

const MEM_DIR = path.join(ROOT, 'workspace', '_memory');
const lastId = () => one('SELECT last_insert_rowid() AS id').id;

// ---------- tokenizer (Arabic + English) ----------
// Arabic arrives with diacritics, alef variants and attached prefixes; folding
// those is the difference between retrieval that works for the user's own
// language and retrieval that only works for English.
const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'not', 'but',
  'you', 'your', 'our', 'its', 'they', 'them', 'their', 'what', 'when', 'which', 'into', 'than', 'then',
  'a', 'an', 'of', 'in', 'on', 'to', 'is', 'it', 'be', 'as', 'at', 'by', 'or', 'if', 'do', 'we',
  'في', 'من', 'الى', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'كان', 'كانت',
  'ان', 'أن', 'إن', 'او', 'أو', 'ثم', 'قد', 'لا', 'ما', 'هو', 'هي', 'كل', 'بعد', 'قبل', 'حتى', 'يكون',
]);

export function tokenize(text) {
  const norm = String(text || '')
    .toLowerCase()
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه');
  const out = [];
  for (let t of norm.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) || []) {
    if (t.length > 3 && /^[ء-ي]+$/.test(t)) t = t.replace(/^(وال|بال|فال|كال|ال|و|ب|ف|ك|ل)/, '') || t;
    if (t.length > 5 && /^[a-z]+$/.test(t)) t = t.replace(/(ing|ed|es|s)$/, '') || t;
    if (t.length >= 2 && !STOP.has(t)) out.push(t);
  }
  return out;
}

// ---------- the index (layer 2) ----------
function indexDoc(docId, text) {
  exec('DELETE FROM mem_index WHERE doc_id = ?', docId);
  const tf = new Map();
  const toks = tokenize(text);
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  for (const [term, n] of tf) exec('INSERT INTO mem_index (term, doc_id, tf) VALUES (?,?,?)', term, docId, n);
  exec('UPDATE mem_docs SET tokens = ? WHERE id = ?', toks.length, docId);
}

export function remember({ kind, agentId = null, dept = null, title, body, sourceType = null, sourceId = null, quality = null, verification = 'unverified', createdBy = 'system' }) {
  if (!body?.trim()) return null;
  exec(`INSERT INTO mem_docs (kind, agent_id, dept, title, body, source_type, source_id, quality, verification, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    kind, agentId, dept, String(title || '').slice(0, 200), body.trim(), sourceType, sourceId ? String(sourceId) : null, quality, verification, createdBy);
  const id = lastId();
  indexDoc(id, `${title || ''} ${body}`);
  return id;
}

/**
 * BM25 over the memory index. Lexical, offline, and explainable — you can see
 * exactly why a document was recalled, which matters more here than the last
 * few points of semantic recall.
 */
export function search(query, { limit = 6, kinds = null, agentId = null, minQuality = null } = {}) {
  const terms = [...new Set(tokenize(query))].slice(0, 24);
  if (!terms.length) return [];
  const N = one('SELECT COUNT(*) AS n FROM mem_docs').n || 1;
  const avgLen = one('SELECT AVG(tokens) AS a FROM mem_docs').a || 60;
  const k1 = 1.4, b = 0.72;
  const scores = new Map();
  for (const term of terms) {
    const rows = q('SELECT i.doc_id, i.tf, d.tokens FROM mem_index i JOIN mem_docs d ON d.id = i.doc_id WHERE i.term = ?', term);
    if (!rows.length) continue;
    const idf = Math.log(1 + (N - rows.length + 0.5) / (rows.length + 0.5));
    for (const r of rows) {
      const len = r.tokens || avgLen;
      const s = idf * ((r.tf * (k1 + 1)) / (r.tf + k1 * (1 - b + b * (len / avgLen))));
      scores.set(r.doc_id, (scores.get(r.doc_id) || 0) + s);
    }
  }
  if (!scores.size) return [];
  const ids = [...scores.keys()];
  const docs = q(`SELECT * FROM mem_docs WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return docs
    .filter((d) => d.verification !== 'retracted')
    .filter((d) => !kinds || kinds.includes(d.kind))
    .filter((d) => !agentId || !d.agent_id || d.agent_id === agentId)
    .filter((d) => minQuality == null || d.quality == null || d.quality >= minQuality)
    .map((d) => {
      let s = scores.get(d.id);
      // Verified canon and high-scoring experience outrank raw episodes.
      if (d.verification === 'verified') s *= 1.6;
      if (d.kind === 'lesson') s *= 1.35;
      if (d.quality != null) s *= 0.75 + d.quality * 0.5;
      return { ...d, score: Number(s.toFixed(3)) };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// ---------- playbooks: Markdown the humans can edit (layer 3) ----------
const playbookPath = (agentId) => path.join(MEM_DIR, `${String(agentId).replace(/[^A-Za-z0-9_-]/g, '')}.md`);

export function readPlaybook(agentId) {
  const f = playbookPath(agentId);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8');
}

export function writePlaybook(agentId, body, { actor, reason = 'edited' }) {
  fs.mkdirSync(MEM_DIR, { recursive: true });
  const f = playbookPath(agentId);
  fs.writeFileSync(f, body, 'utf8');
  const existing = one("SELECT id FROM mem_docs WHERE kind = 'playbook' AND agent_id = ?", agentId);
  if (existing) {
    exec('UPDATE mem_docs SET body = ?, created_by = ? WHERE id = ?', body, actor, existing.id);
    indexDoc(existing.id, body);
  } else {
    remember({ kind: 'playbook', agentId, title: `${agentId} playbook`, body, sourceType: 'file', sourceId: `_memory/${agentId}.md`, verification: 'verified', createdBy: actor });
  }
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'memory.playbook_written', subjectType: 'agent', subjectId: agentId, payload: { reason, bytes: body.length } });
}

const SEED_PLAYBOOK = (agentId, name) => `# ${name} — working notes (${agentId})

*This file is my memory. I read it before every task. Humans may edit it directly;
what is written here outranks anything I infer on my own.*

## How I work here
- State assumptions explicitly; never invent specifics I was not given.
- Reply with the JSON contract I was asked for — nothing before or after it.
- When I lack information, I say so and name what is missing instead of filling the gap.

## What I have learned
_(the curator appends verified lessons here — newest last)_
`;

export function ensurePlaybooks() {
  fs.mkdirSync(MEM_DIR, { recursive: true });
  for (const a of q("SELECT id, name FROM agents WHERE status = 'active'")) {
    if (!fs.existsSync(playbookPath(a.id))) writePlaybook(a.id, SEED_PLAYBOOK(a.id, a.name), { actor: 'system:memory', reason: 'seeded' });
  }
}

// ---------- recall: what an agent is told before it works ----------
export function recall(agentId, taskText, { runId = null, k = 4 } = {}) {
  // The intake router judges each request on its own words. Feeding it what
  // somebody asked for last week made an old instruction colour a new one —
  // a legitimate request was read as a continuation of a refused one.
  if (agentId === 'AGT-REQ-001') return null;
  const parts = [];
  const used = [];
  const playbook = readPlaybook(agentId);
  if (playbook) {
    const trimmed = playbook.length > 2600 ? `${playbook.slice(0, 2600)}\n…(playbook truncated)` : playbook;
    parts.push(`YOUR PLAYBOOK (${agentId}.md — your own standing notes):\n${trimmed}`);
  }
  const hits = search(taskText, { limit: k + 2, kinds: ['lesson', 'episode', 'knowledge', 'artifact'], agentId })
    .filter((h) => h.kind !== 'playbook').slice(0, k);
  if (hits.length) {
    parts.push(`RELEVANT MEMORY (retrieved from ${hits.length} past record${hits.length > 1 ? 's' : ''} — treat verified items as company truth):\n${
      hits.map((h, i) => `${i + 1}. [${h.kind}${h.verification === 'verified' ? ' · verified' : ''}${h.quality != null ? ` · quality ${Math.round(h.quality * 100)}%` : ''}] ${h.title ? `${h.title}: ` : ''}${String(h.body).slice(0, 700)}`).join('\n')
    }`);
    used.push(...hits.map((h) => h.id));
  }
  if (runId) for (const docId of used) exec('INSERT INTO mem_usage (doc_id, run_id, agent_id) VALUES (?,?,?)', docId, runId, agentId);
  if (!parts.length) return null;
  return `--- MEMORY ---\n${parts.join('\n\n')}\n--- END MEMORY ---`;
}

// ---------- episodic capture (layer 1) ----------
/** Called when a run lands: keep the experience, compactly. */
export function captureEpisode(run) {
  if (!run || one("SELECT id FROM mem_docs WHERE kind = 'episode' AND source_type = 'run' AND source_id = ?", String(run.id))) return null;
  let input = {}; let output = null;
  try { input = JSON.parse(run.input || '{}'); } catch { /* keep going */ }
  try {
    const o = JSON.parse(run.output || 'null');
    output = o?.parsed || o;
    if (output && typeof output.raw === 'string') output = { text: output.raw };
  } catch { /* keep going */ }
  const task = String(input.prompt || input.task || run.task_type).slice(0, 900);
  const result = String(output?.text || output?.draft || output?.summary || JSON.stringify(output || {})).slice(0, 1200);
  return remember({
    kind: 'episode', agentId: run.agent_id, dept: String(run.task_type).split(':')[0],
    title: `${run.agent_id} · ${run.task_type}`,
    body: `TASK: ${task}\n\nOUTCOME (${run.state}): ${result}`,
    sourceType: 'run', sourceId: run.id,
    quality: null, createdBy: 'system:memory',
  });
}

/** Audit verdicts are the honest quality signal — attach them to the episode. */
export function gradeEpisodes() {
  for (const a of q("SELECT * FROM audits WHERE state = 'done' AND subject_type = 'cycle'")) {
    const c = one('SELECT produce_run FROM cycles WHERE id = ?', a.subject_id);
    if (!c?.produce_run) continue;
    const d = one("SELECT id, quality FROM mem_docs WHERE kind = 'episode' AND source_type = 'run' AND source_id = ?", String(c.produce_run));
    if (d && d.quality == null) exec('UPDATE mem_docs SET quality = ? WHERE id = ?', a.score, d.id);
  }
}

/** Knowledge and archived artifacts belong in the same index as experience. */
export function syncExternalMemory() {
  for (const m of q("SELECT * FROM memory_entries WHERE verification != 'retracted' ORDER BY id DESC LIMIT 200")) {
    if (one("SELECT id FROM mem_docs WHERE kind = 'knowledge' AND source_type = 'memory_entry' AND source_id = ?", String(m.id))) continue;
    remember({
      kind: 'knowledge', title: `${m.layer} · ${m.source_ref}`, body: m.content,
      sourceType: 'memory_entry', sourceId: m.id, verification: m.verification, createdBy: m.created_by,
    });
  }
  for (const a of q('SELECT * FROM archive_items ORDER BY id DESC LIMIT 120')) {
    if (!a.summary && !a.title) continue;
    if (one("SELECT id FROM mem_docs WHERE kind = 'artifact' AND source_type = 'archive' AND source_id = ?", String(a.id))) continue;
    remember({
      kind: 'artifact', title: a.title, body: `${a.title}\n${a.summary || ''}`.slice(0, 2000),
      sourceType: 'archive', sourceId: a.id, createdBy: 'system:memory',
    });
  }
}

// ---------- reflection: turning experience into lessons (layer 4) ----------
const CURATOR = () => one("SELECT id FROM agents WHERE status = 'active' AND id = 'AGT-DOC-001'")?.id
  || one("SELECT id FROM agents WHERE status = 'active' ORDER BY id LIMIT 1")?.id;

/**
 * Ask an agent to distil its own recent experience into durable lessons.
 * The lesson lands unverified: a human promotes it to canon, exactly like
 * evidence in the decision registry.
 */
export async function startReflection(agentId, { actor }) {
  const eps = q("SELECT title, body, quality FROM mem_docs WHERE kind = 'episode' AND agent_id = ? ORDER BY id DESC LIMIT 12", agentId);
  if (eps.length < 2) throw new Error('not enough experience yet — needs at least 2 episodes');
  const curator = CURATOR();
  if (!curator) throw new Error('no active agent to curate');
  const { enqueueRun } = await import('./workflow.js');
  const runId = enqueueRun({
    agentId: curator,
    taskType: `reflect:${agentId}`,
    input: { prompt: `You are the memory curator. Read ${agentId}'s recent work and distil what should be REMEMBERED so the same mistakes are not repeated and what worked is repeated on purpose.\n\n${eps.map((e, i) => `--- EPISODE ${i + 1}${e.quality != null ? ` (audited ${Math.round(e.quality * 100)}%)` : ''} ---\n${e.body.slice(0, 900)}`).join('\n\n')}\n\nRules: only lessons supported by the episodes above — no generic advice. Each lesson must be one actionable sentence.\nReply as JSON {"lessons": ["...", "..."], "playbookAppend": "markdown bullet list to append to the agent's playbook"}.` },
    actor,
  });
  exec('INSERT INTO reflections (agent_id, run_id, episodes, created_by) VALUES (?,?,?,?)', agentId, runId, eps.length, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'memory.reflection_started', subjectType: 'agent', subjectId: agentId, payload: { episodes: eps.length } });
  return id;
}

/** Tick: land finished reflections as unverified lessons + a playbook draft. */
export function syncReflections() {
  for (const r of q("SELECT * FROM reflections WHERE state = 'running'")) {
    const run = one('SELECT state, output FROM runs WHERE id = ?', r.run_id);
    if (!run) { exec("UPDATE reflections SET state = 'failed' WHERE id = ?", r.id); continue; }
    if (!['done', 'awaiting_human'].includes(run.state)) {
      if (['failed', 'cancelled'].includes(run.state)) exec("UPDATE reflections SET state = 'failed' WHERE id = ?", r.id);
      continue;
    }
    let parsed = null;
    try {
      const o = JSON.parse(run.output || 'null');
      parsed = o?.parsed || (typeof o?.raw === 'string' ? JSON.parse(o.raw) : null);
    } catch { /* handled below */ }
    const lessons = Array.isArray(parsed?.lessons) ? parsed.lessons.filter((l) => typeof l === 'string' && l.trim()) : [];
    let made = 0;
    for (const l of lessons.slice(0, 8)) {
      const id = remember({ kind: 'lesson', agentId: r.agent_id, title: `lesson · ${r.agent_id}`, body: l.trim(), sourceType: 'reflection', sourceId: r.id, createdBy: 'agent:curator' });
      if (id) made++;
    }
    exec("UPDATE reflections SET state = 'done', lessons = ?, playbook_draft = ? WHERE id = ?",
      JSON.stringify(lessons), parsed?.playbookAppend || null, r.id);
    audit({ actorType: 'agent', actorId: 'curator', action: 'memory.reflected', subjectType: 'agent', subjectId: r.agent_id, payload: { lessons: made } });
  }
}

/** A human turns a candidate lesson into company truth — and into the playbook. */
export function verifyLesson(id, { verdict, actor }) {
  const d = one("SELECT * FROM mem_docs WHERE id = ? AND kind = 'lesson'", id);
  if (!d) throw new Error('lesson not found');
  if (!['verified', 'retracted'].includes(verdict)) throw new Error('verdict: verified|retracted');
  exec('UPDATE mem_docs SET verification = ? WHERE id = ?', verdict, id);
  if (verdict === 'verified' && d.agent_id) {
    const pb = readPlaybook(d.agent_id) || SEED_PLAYBOOK(d.agent_id, d.agent_id);
    if (!pb.includes(d.body)) {
      writePlaybook(d.agent_id, `${pb.trimEnd()}\n- ${d.body}  \n  <sub>verified by ${actor}</sub>\n`, { actor, reason: 'lesson promoted' });
    }
    exec("INSERT INTO memory_entries (layer, content, source_ref, verification, created_by) VALUES ('lesson', ?, ?, 'verified', ?)",
      d.body, `mem:${id}`, actor);
  }
  audit({ actorType: 'human', actorId: actor, action: `memory.lesson_${verdict}`, subjectType: 'memory', subjectId: id, payload: { agentId: d.agent_id } });
}

export function forget(id, { actor }) {
  const d = one('SELECT * FROM mem_docs WHERE id = ?', id);
  if (!d) throw new Error('not found');
  exec("UPDATE mem_docs SET verification = 'retracted' WHERE id = ?", id);
  exec('DELETE FROM mem_index WHERE doc_id = ?', id);
  audit({ actorType: 'human', actorId: actor, action: 'memory.forgotten', subjectType: 'memory', subjectId: id, payload: { kind: d.kind } });
}

// ---------- the view ----------
export function memoryOverview() {
  const byKind = q('SELECT kind, COUNT(*) AS n FROM mem_docs GROUP BY kind');
  const agents = q("SELECT id, name FROM agents WHERE status = 'active' ORDER BY id").map((a) => ({
    ...a,
    episodes: one("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'episode' AND agent_id = ?", a.id).n,
    lessons: one("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson' AND agent_id = ?", a.id).n,
    verified: one("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson' AND agent_id = ? AND verification = 'verified'", a.id).n,
    avgQuality: one("SELECT ROUND(AVG(quality), 3) AS q FROM mem_docs WHERE kind = 'episode' AND agent_id = ? AND quality IS NOT NULL", a.id).q,
    playbookBytes: (readPlaybook(a.id) || '').length,
  }));
  return {
    stats: {
      documents: one('SELECT COUNT(*) AS n FROM mem_docs').n,
      terms: one('SELECT COUNT(DISTINCT term) AS n FROM mem_index').n,
      recalls: one('SELECT COUNT(*) AS n FROM mem_usage').n,
      verifiedLessons: one("SELECT COUNT(*) AS n FROM mem_docs WHERE kind = 'lesson' AND verification = 'verified'").n,
      byKind,
    },
    agents,
    pendingLessons: q("SELECT * FROM mem_docs WHERE kind = 'lesson' AND verification = 'unverified' ORDER BY id DESC LIMIT 40"),
    reflections: q('SELECT * FROM reflections ORDER BY id DESC LIMIT 20'),
    // Does memory actually help? Compare audited quality with and without recall.
    impact: (() => {
      const withMem = one(`SELECT ROUND(AVG(d.quality), 3) AS q, COUNT(*) AS n FROM mem_docs d
        WHERE d.kind = 'episode' AND d.quality IS NOT NULL AND EXISTS (SELECT 1 FROM mem_usage u WHERE u.run_id = d.source_id)`);
      const without = one(`SELECT ROUND(AVG(d.quality), 3) AS q, COUNT(*) AS n FROM mem_docs d
        WHERE d.kind = 'episode' AND d.quality IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mem_usage u WHERE u.run_id = d.source_id)`);
      return { withMemory: withMem, withoutMemory: without };
    })(),
  };
}

export function agentMemory(agentId) {
  return {
    agentId,
    playbook: readPlaybook(agentId),
    lessons: q("SELECT * FROM mem_docs WHERE kind = 'lesson' AND agent_id = ? ORDER BY id DESC LIMIT 50", agentId),
    episodes: q("SELECT id, title, quality, created_at, substr(body, 1, 400) AS body FROM mem_docs WHERE kind = 'episode' AND agent_id = ? ORDER BY id DESC LIMIT 25", agentId),
    recalls: one('SELECT COUNT(*) AS n FROM mem_usage WHERE agent_id = ?', agentId).n,
  };
}
