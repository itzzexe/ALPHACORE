// Local AI — the model that runs on the company's own server.
//
// The router already knew how to call Ollama. What it did not have was a
// place to see whether the model is up, which ones are installed and loaded,
// how fast this machine actually is, and a switch that puts the local model at
// the head of every chain instead of at the tail. That is this department.
//
// On a 2 vCPU / 8 GB VPS the arithmetic is unforgiving and the page says it
// plainly: a 3B model answers in seconds, a 7B in tens of seconds, two at once
// is slower than one after the other, and a 14B model does not fit beside the
// console. The defaults follow from that rather than from ambition.
//
// The operator answers questions about the company from a snapshot and
// proposes work as requests. It does not act; the request desk and the people
// at its gates do.
import os from 'node:os';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret, setSetting, localOnly, getSetting } from './settings.js';
import { enqueueRun } from './workflow.js';
import { createRequest } from './requests.js';
import { localFirst, localModelFor, localRuntime, reviewModel, lineage } from './router.js';
import { call as ollamaCall, ollamaBase, localTuning, queueState } from './providers/ollama.js';
import { providersConfig } from './env.js';
import { readRun } from './markets/fold.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const MODEL = /^[\w.:\-/]{2,80}$/;
const base = () => ollamaBase(providersConfig.providers?.ollama?.baseUrl);

/**
 * What fits, and what it is for, on a small server.
 *
 * RAM is the model file plus its KV cache at a 4K window; speeds are measured
 * figures for two modern vCPUs at Q4, rounded down. The page shows the
 * machine's own benchmark beside them, which is the number to believe.
 */
export const CATALOGUE = [
  { model: 'qwen2.5:3b', sizeGb: 1.9, ramGb: 3, speed: '8–12 tok/s', role: 'fast', use: 'Triage, tagging, short answers, chat. Good Arabic for its size.' },
  { model: 'llama3.2:3b', sizeGb: 2.0, ramGb: 3, speed: '8–12 tok/s', role: 'fast', use: 'Fast English. Weak in Arabic.' },
  { model: 'qwen3:4b', sizeGb: 2.6, ramGb: 4, speed: '5–8 tok/s', role: 'balanced', use: 'Strong reasoning for its size. Slower with thinking on.' },
  { model: 'gemma3:4b', sizeGb: 3.3, ramGb: 5, speed: '5–7 tok/s', role: 'balanced', use: 'Balanced and multilingual.' },
  { model: 'qwen2.5:7b', sizeGb: 4.7, ramGb: 6.5, speed: '3–5 tok/s', role: 'deep', use: 'The best quality that fits 8 GB: briefs, analysis, Arabic writing.' },
  { model: 'qwen2.5-coder:7b', sizeGb: 4.7, ramGb: 6.5, speed: '3–5 tok/s', role: 'deep', use: 'Code: the factory and the review board.' },
  { model: 'nomic-embed-text', sizeGb: 0.3, ramGb: 0.5, speed: 'fast', role: 'embed', use: 'Search that understands meaning. Set it as EMBEDDING_MODEL.' },
  { model: 'qwen2.5:14b', sizeGb: 9.0, ramGb: 11, speed: '1–2 tok/s', role: 'deep', use: 'Needs 16 GB. Listed so the reason it is missing is on the page.' },
];

function hardware() {
  const ramGb = Number(getSecret('VPS_RAM_GB')) || Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const cpus = Number(getSecret('VPS_CPUS')) || os.cpus().length;
  return { ramGb, cpus, freeGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10, platform: `${os.platform()} ${os.arch()}`, measuredHere: !getSecret('VPS_RAM_GB') };
}

/** Is the address this machine or a private network? A model across the internet is not "local". */
export function addressKind(url) {
  let h;
  try { h = new URL(url).hostname; } catch { return 'invalid'; }
  if (/^(localhost|127\.|\[?::1\]?$)/.test(h)) return 'loopback';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) || h.endsWith('.internal') || h.endsWith('.lan')) return 'private';
  return 'public';
}

async function probe(path, { method = 'GET', body = null, timeoutMs = 3000 } = {}) {
  const headers = { 'content-type': 'application/json' };
  const auth = getSecret('OLLAMA_AUTH');
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`${base()}${path}`, { method, headers, body: body ? JSON.stringify(body) : null, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : {};
}

export async function status() {
  syncAsks();
  const enabled = String(getSecret('OLLAMA_ENABLED') || '').toLowerCase() === 'true';
  const out = {
    enabled,
    base: base(),
    address: addressKind(base()),
    reachable: false,
    version: null,
    installed: [],
    loaded: [],
    error: null,
    localFirst: localFirst(),
    runtime: localRuntime(),
    runtimePinned: getSecret('LOCAL_RUNTIME') || null,
    models: { T1: localModelFor('T1'), T2: localModelFor('T2'), T3: localModelFor('T3'), TL: localModelFor('TL') },
    embedding: getSecret('EMBEDDING_MODEL') || null,
    localOnly: localOnly(),
    reviewModel: reviewModel(),
    operator: operatorSettings(),
    handover: handover(),
    tuning: localTuning(),
    queue: queueState(),
    hardware: hardware(),
  };
  try {
    out.version = (await probe('/api/version')).version || null;
    out.reachable = true;
    out.installed = ((await probe('/api/tags')).models || []).map((m) => ({
      name: m.name, sizeGb: Math.round((m.size / 1024 ** 3) * 10) / 10, family: m.details?.family || null,
      params: m.details?.parameter_size || null, quant: m.details?.quantization_level || null, modified: m.modified_at,
    }));
    out.loaded = ((await probe('/api/ps')).models || []).map((m) => ({ name: m.name, sizeGb: Math.round((m.size / 1024 ** 3) * 10) / 10, until: m.expires_at }));
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
  }
  const have = new Set(out.installed.map((m) => m.name));
  const room = out.hardware.ramGb - 1.5; // the OS and the console have to live somewhere
  out.catalogue = CATALOGUE.map((c) => ({ ...c, installed: have.has(c.model) || have.has(`${c.model}:latest`), fits: c.ramGb <= room }));
  out.usage = one(`SELECT COUNT(*) AS calls, SUM(ok) AS ok, ROUND(AVG(latency_ms)) AS avgMs, SUM(tokens_out) AS tokensOut, SUM(latency_ms) AS ms
                   FROM model_calls WHERE provider IN ('ollama','engine') AND created_at >= datetime('now','-1 day')`);
  out.usage.tokPerSec = out.usage.ms ? Math.round((out.usage.tokensOut / (out.usage.ms / 1000)) * 10) / 10 : null;
  out.share = one(`SELECT COUNT(*) AS n, SUM(CASE WHEN provider IN ('ollama','engine') THEN 1 ELSE 0 END) AS local FROM model_calls WHERE created_at >= datetime('now','-1 day') AND provider <> 'mock'`);
  out.bench = q('SELECT * FROM local_bench ORDER BY id DESC LIMIT 12');
  out.pulls = q('SELECT * FROM local_pulls ORDER BY id DESC LIMIT 10');
  out.asks = q('SELECT * FROM local_asks ORDER BY id DESC LIMIT 10').map((a) => ({ ...a, proposals: a.proposals ? JSON.parse(a.proposals) : [] }));
  return out;
}

// ----------------------------------------------------------------- config --

/**
 * Settings for the local brain. Each is a setting rather than a file edit, so
 * the next `git pull` cannot quietly undo it, and each change is on the chain.
 */
export function configure({ enabled, runtime = null, baseUrl, localFirst: lf, localOnly: lo = null, reviewModel: rv = null, operatorMode = null, roundHour = null, maxActionsDay = null, modelT1, modelT2, modelT3, numCtx, numThread, keepAlive, concurrency, embedding, actor }) {
  if (!isHuman(actor)) refuse('a person configures the local model', 403);
  const changed = {};
  const put = (k, v) => { setSetting(k, v); changed[k] = v; };
  if (enabled != null) put('OLLAMA_ENABLED', enabled ? 'true' : '');
  if (baseUrl != null) {
    if (baseUrl && addressKind(baseUrl) === 'invalid') refuse('that is not an address');
    put('OLLAMA_BASE_URL', String(baseUrl).trim());
  }
  if (lf != null) put('LOCAL_FIRST', lf ? 'true' : '');
  if (runtime != null) {
    if (!['auto', 'engine', 'ollama'].includes(runtime)) refuse('runtime is auto, engine or ollama');
    put('LOCAL_RUNTIME', runtime === 'auto' ? '' : runtime);
  }
  for (const [k, v] of [['LOCAL_MODEL_T1', modelT1], ['LOCAL_MODEL_T2', modelT2], ['LOCAL_MODEL_T3', modelT3], ['LOCAL_MODEL_TL', modelT3], ['EMBEDDING_MODEL', embedding]]) {
    if (v == null) continue;
    if (v && !MODEL.test(v)) refuse(`${v} is not a model name`);
    put(k, v);
  }
  if (numCtx != null) { const n = Number(numCtx); if (!(n >= 1024 && n <= 32768)) refuse('context between 1024 and 32768 tokens'); put('LOCAL_NUM_CTX', n); }
  if (numThread != null) { const n = Number(numThread); if (!(n >= 0 && n <= 64)) refuse('threads between 0 (automatic) and 64'); put('LOCAL_NUM_THREAD', n || ''); }
  if (keepAlive != null) { if (keepAlive && !/^(-1|\d+[smh]?)$/.test(keepAlive)) refuse('keep-alive like 30m, 2h, or -1 for always'); put('LOCAL_KEEP_ALIVE', keepAlive); }
  if (concurrency != null) { const n = Number(concurrency); if (!(n >= 1 && n <= 4)) refuse('one to four at a time'); put('LOCAL_CONCURRENCY', n); }
  if (lo != null) {
    // Switching every hosted provider off with no local model to take over
    // would leave the company with no AI at all, so it is refused rather than
    // allowed to fail quietly on the next run.
    const on = Boolean(lo);
    if (on && String(getSecret('OLLAMA_ENABLED') || enabled || '').toLowerCase() !== 'true' && String(getSecret('ENGINE_ENABLED') || '').toLowerCase() !== 'true' && enabled !== true) {
      refuse('switch the local model on first — local only with no local model leaves the company with no AI');
    }
    put('LOCAL_ONLY', on ? 'true' : '');
    if (on) put('LOCAL_FIRST', 'true');
  }
  if (rv != null) { if (rv && !MODEL.test(rv)) refuse(`${rv} is not a model name`); put('LOCAL_REVIEW_MODEL', rv); }
  if (operatorMode != null) { if (!['propose', 'act'].includes(operatorMode)) refuse('propose or act'); put('LOCAL_OPERATOR_MODE', operatorMode); }
  if (roundHour != null) { const h = Number(roundHour); if (!(Number.isInteger(h) && h >= -1 && h <= 23)) refuse('an hour 0–23 UTC, or -1 for no daily round'); put('LOCAL_OPERATOR_ROUND_HOUR', h); }
  if (maxActionsDay != null) { const n = Number(maxActionsDay); if (!(Number.isInteger(n) && n >= 0 && n <= 50)) refuse('0 to 50 requests a day'); put('LOCAL_OPERATOR_MAX_DAY', n); }
  audit({ actorType: 'human', actorId: actor, action: 'localai.configured', subjectType: 'localai', subjectId: 'config', payload: changed });
  return { ok: true, changed };
}

// ----------------------------------------------------------------- models --

/** Download a model onto the server. Minutes, so it runs on and is checked back. */
export function pull({ model, actor }) {
  if (!isHuman(actor)) refuse('a person decides what is installed on the server', 403);
  if (!MODEL.test(String(model || ''))) refuse('that is not a model name');
  if (one("SELECT id FROM local_pulls WHERE model = ? AND state = 'pulling'", model)) refuse('that model is already downloading', 409);
  const r = exec('INSERT INTO local_pulls (model, requested_by) VALUES (?,?)', model, actor);
  const id = Number(r.lastInsertRowid);
  audit({ actorType: 'human', actorId: actor, action: 'localai.pull', subjectType: 'local_model', subjectId: model });
  probe('/api/pull', { method: 'POST', body: { model, stream: false }, timeoutMs: 60 * 60_000 })
    .then((res) => exec("UPDATE local_pulls SET state = ?, detail = ?, finished_at = datetime('now') WHERE id = ?", res.status === 'success' ? 'done' : 'failed', String(res.status || res.error || '').slice(0, 300), id))
    .catch((e) => exec("UPDATE local_pulls SET state = 'failed', detail = ?, finished_at = datetime('now') WHERE id = ?", String(e.message || e).slice(0, 300), id));
  return one('SELECT * FROM local_pulls WHERE id = ?', id);
}

export async function remove({ model, actor }) {
  if (!isHuman(actor)) refuse('a person decides what is installed on the server', 403);
  if (!MODEL.test(String(model || ''))) refuse('that is not a model name');
  await probe('/api/delete', { method: 'DELETE', body: { model }, timeoutMs: 30_000 });
  audit({ actorType: 'human', actorId: actor, action: 'localai.removed', subjectType: 'local_model', subjectId: model });
  return { ok: true };
}

/** Load a model into memory now, so the first real question does not pay for it. */
export async function warm({ model, actor }) {
  if (!MODEL.test(String(model || ''))) refuse('that is not a model name');
  await probe('/api/generate', { method: 'POST', body: { model, prompt: '', keep_alive: localTuning().keepAlive }, timeoutMs: 180_000 });
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'localai.warmed', subjectType: 'local_model', subjectId: model });
  return { ok: true };
}

/** The same short task every time, so two numbers on this page can be compared. */
export async function benchmark({ model, actor }) {
  if (!MODEL.test(String(model || ''))) refuse('that is not a model name');
  const t0 = Date.now();
  try {
    const r = await ollamaCall({
      baseUrl: base(), model, maxTokens: 160,
      system: 'You are concise.',
      prompt: 'In four short sentences, explain why a small company might run its own language model on a small server, and one honest drawback.',
    });
    exec('INSERT INTO local_bench (model, tokens_per_sec, prompt_per_sec, load_ms, latency_ms, ok, created_by) VALUES (?,?,?,?,?,1,?)',
      model, r.local?.tokensPerSec ?? null, r.local?.promptPerSec ?? null, r.local?.loadMs ?? null, r.latencyMs, actor);
    audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'localai.benchmarked', subjectType: 'local_model', subjectId: model, payload: { tokPerSec: r.local?.tokensPerSec } });
    return { ok: true, ...r.local, latencyMs: r.latencyMs, sample: r.text.slice(0, 600) };
  } catch (e) {
    exec('INSERT INTO local_bench (model, latency_ms, ok, error, created_by) VALUES (?,?,0,?,?)', model, Date.now() - t0, String(e.message || e).slice(0, 300), actor);
    refuse(`the model did not answer: ${String(e.message || e).slice(0, 200)}`, 502);
  }
}

// --------------------------------------------------------------- operator --

const soft = (sql, ...p) => { try { return one(sql, ...p); } catch { return null; } };

/** The company on one screen of text — what the operator reads before it answers. */
export function snapshot() {
  const runs = Object.fromEntries(q("SELECT state, COUNT(*) AS n FROM runs WHERE created_at >= datetime('now','-1 day') GROUP BY state").map((r) => [r.state, r.n]));
  const lines = [
    `Date: ${new Date().toISOString().slice(0, 16)} UTC`,
    `Work in the last day: ${Object.entries(runs).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `Waiting on a person at the egress gate: ${soft("SELECT COUNT(*) AS n FROM egress_log WHERE verdict = 'gated'")?.n ?? 0}`,
    `Open requests: ${soft("SELECT COUNT(*) AS n FROM requests WHERE state NOT IN ('done','failed','cancelled')")?.n ?? 0}`,
    `Open incidents: ${soft("SELECT COUNT(*) AS n FROM incidents WHERE state IN ('open','mitigated')")?.n ?? 0}`,
    `Open decisions: ${soft("SELECT COUNT(*) AS n FROM decisions WHERE status = 'open'")?.n ?? 0}`,
    `Unread notifications: ${soft('SELECT COUNT(*) AS n FROM notifications WHERE read = 0')?.n ?? 0}`,
    `Orders waiting for approval: ${soft("SELECT COUNT(*) AS n FROM pf_orders WHERE state = 'proposed'")?.n ?? 0}`,
  ];
  const movers = q('SELECT symbol, price, change_pct, source FROM mkt_quotes ORDER BY ABS(COALESCE(change_pct,0)) DESC LIMIT 5');
  if (movers.length) lines.push(`Biggest moves (${movers[0].source}): ${movers.map((m) => `${m.symbol} ${m.change_pct != null ? `${m.change_pct.toFixed(2)}%` : '—'}`).join(', ')}`);
  const brief = soft("SELECT summary FROM mkt_briefs WHERE state = 'ready' ORDER BY id DESC LIMIT 1");
  if (brief?.summary) lines.push(`Latest markets brief: ${brief.summary.slice(0, 400)}`);
  const heads = q('SELECT title, category FROM news_items WHERE flagged = 0 ORDER BY id DESC LIMIT 6');
  if (heads.length) lines.push(`Latest headlines (untrusted): ${heads.map((h) => `[${h.category}] ${h.title}`).join(' | ')}`);
  const failed = q("SELECT agent_id, failure_reason FROM runs WHERE state = 'failed' AND created_at >= datetime('now','-1 day') ORDER BY created_at DESC LIMIT 3");
  if (failed.length) lines.push(`Recent failures: ${failed.map((f) => `${f.agent_id}: ${String(f.failure_reason || '').slice(0, 80)}`).join(' | ')}`);
  return lines.join('\n');
}

export function ask({ question, actor }) {
  if (!actor) refuse('a question has to name who asked it');
  const qText = String(question || '').trim();
  if (!qText) refuse('ask something');
  const r = exec('INSERT INTO local_asks (question, created_by) VALUES (?,?)', qText.slice(0, 2000), actor);
  const id = Number(r.lastInsertRowid);
  const runId = enqueueRun({
    agentId: 'AGT-OPR-001',
    taskType: `local-ask:${id}`,
    actor,
    input: {
      prompt: `[LOCAL-ASK] A person running the company asks:
"""
${qText.slice(0, 2000)}
"""

THE COMPANY RIGHT NOW:
${snapshot()}

Answer from the snapshot. If something should be done, propose it as a request (title, one-paragraph body, and the department that should take it). Do not claim to have done anything.
Output JSON: {"answer":"","proposals":[{"title":"","body":"","department":""}],"confidence":0.0}`,
    },
  });
  exec('UPDATE local_asks SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'localai.asked', subjectType: 'local_ask', subjectId: id });
  return one('SELECT * FROM local_asks WHERE id = ?', id);
}

export function syncAsks() {
  for (const a of q("SELECT id, run_id FROM local_asks WHERE state = 'thinking' AND run_id IS NOT NULL")) {
    const r = readRun(a.run_id);
    if (!r.done) continue;
    if (r.failed) { exec("UPDATE local_asks SET state = 'failed', answer = ? WHERE id = ?", r.why || 'no answer came back', a.id); continue; }
    const p = r.parsed || { answer: r.raw };
    exec("UPDATE local_asks SET state = 'answered', answer = ?, proposals = ?, served_by = ? WHERE id = ?",
      String(p.answer || '').slice(0, 8000) + (r.lowConfidence ? '\n\n(low confidence)' : ''),
      JSON.stringify((Array.isArray(p.proposals) ? p.proposals : []).slice(0, 5)), r.servedBy, a.id);
    // Only the operator's own rounds are acted on: a person who asked a
    // question gets proposals to file themselves, which is what they asked for.
    const ask = one('SELECT created_by FROM local_asks WHERE id = ?', a.id);
    if (ask?.created_by === ROUND_ACTOR && operatorSettings().mode === 'act' && !r.lowConfidence) actOnProposals(a.id);
  }
}

// ------------------------------------------------------------- the round --

const ROUND_ACTOR = 'system:operator';
const OPERATOR = 'agent:AGT-OPR-001';
const ROUND_QUESTION = 'Morning round. Read the company as it is now. What is stuck, failing, overdue or waiting, and what should be done today? Propose at most three concrete requests, each for one department, and say plainly if nothing needs doing.';

export function operatorSettings() {
  const n = (k, d) => { const v = getSecret(k); return v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v); };
  return {
    mode: getSecret('LOCAL_OPERATOR_MODE') === 'act' ? 'act' : 'propose',
    roundHour: n('LOCAL_OPERATOR_ROUND_HOUR', 5),
    maxPerDay: n('LOCAL_OPERATOR_MAX_DAY', 5),
    filedToday: one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'localai.proposal_filed' AND actor_id = ? AND occurred_at >= date('now')", OPERATOR).n,
    lastRound: one('SELECT created_at FROM local_asks WHERE created_by = ? ORDER BY id DESC LIMIT 1', ROUND_ACTOR)?.created_at || null,
  };
}

/**
 * File a round's proposals as real requests, up to the day's cap.
 *
 * A request is internal work: the request desk routes it to departments, and
 * every step there that would reach a customer, spend money or sign anything
 * still stops for a person. That is why acting here is safe to allow, and why
 * the cap exists anyway — a small model that misreads the snapshot should
 * cost five wrong requests, not fifty.
 */
function actOnProposals(askId) {
  const s = operatorSettings();
  const props = JSON.parse(one('SELECT proposals FROM local_asks WHERE id = ?', askId)?.proposals || '[]');
  let filed = s.filedToday;
  for (let i = 0; i < props.length && filed < s.maxPerDay; i++) {
    const p = props[i];
    if (!p?.title && !p?.body) continue;
    try {
      const req = createRequest({ title: p.title, body: `${p.body || p.title}\n\n(Filed by the local operator on its morning round${p.department ? `; suggested department: ${p.department}` : ''}.)`, actor: OPERATOR });
      audit({ actorType: 'agent', actorId: OPERATOR, action: 'localai.proposal_filed', subjectType: 'local_ask', subjectId: askId, payload: { request: req.id, index: i, round: true } });
      filed++;
    } catch { /* a malformed proposal is skipped, not retried */ }
  }
}

let lastRoundDay = null;
/** Once a day after the configured hour, the operator looks at the company unprompted. */
export function operatorTick() {
  syncAsks();
  const s = operatorSettings();
  if (s.roundHour < 0) return;
  const today = new Date().toISOString().slice(0, 10);
  if (lastRoundDay === today || new Date().getUTCHours() < s.roundHour) return;
  if (s.lastRound && s.lastRound.slice(0, 10) === today) { lastRoundDay = today; return; }
  const usable = localOnly() || localFirst();
  if (!usable) return; // the round is the local model's; without it there is nobody to do it
  lastRoundDay = today;
  try { ask({ question: ROUND_QUESTION, actor: ROUND_ACTOR }); } catch { /* the next day tries again */ }
}

/**
 * The whole picture of who runs the company: the model, the operator, the
 * planner and the decider. The last two have their own pages and their own
 * owner-only switches; this only reports them, so there is one place to see
 * how much has been handed over.
 */
export function handover() {
  const hosted = Object.entries(providersConfig.providers).filter(([, p]) => p.family !== 'local' && p.kind !== 'mock');
  const configured = hosted.filter(([, p]) => (p.kind === 'claude-cli' ? getSecret(p.enabledEnv) : p.keyEnv && getSecret(p.keyEnv))).map(([n]) => n);
  return {
    hostedConfigured: configured,
    hostedInUse: localOnly() ? [] : configured,
    reviewIndependent: Boolean(reviewModel() && lineage(reviewModel()) !== lineage(localModelFor('T3'))),
    maestro: String(getSetting('MAESTRO_ENABLED') || 'false') === 'true',
    autonomy: String(getSetting('AUTONOMY_MODE') || 'off'),
  };
}

/** A person turns one of the operator's proposals into a real request. */
export function fileProposal({ askId, index, actor }) {
  if (!isHuman(actor)) refuse('a person files the request', 403);
  const a = one('SELECT * FROM local_asks WHERE id = ?', Number(askId));
  if (!a) refuse('no such question', 404);
  const p = JSON.parse(a.proposals || '[]')[Number(index)];
  if (!p) refuse('no such proposal', 404);
  const req = createRequest({ title: p.title, body: `${p.body || p.title}\n\n(Proposed by the local operator in answer to: “${a.question.slice(0, 200)}”${p.department ? `; suggested department: ${p.department}` : ''})`, actor });
  audit({ actorType: 'human', actorId: actor, action: 'localai.proposal_filed', subjectType: 'local_ask', subjectId: a.id, payload: { request: req.id, index: Number(index) } });
  return req;
}
