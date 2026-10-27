// The built-in engine — the model runs inside AlphaCore's own care, with no
// other program to install.
//
// AlphaCore downloads llama.cpp's server for this platform, downloads GGUF
// model files, and starts the server as a child process it supervises: bound
// to 127.0.0.1, one model in memory, restarted with backoff if it dies,
// stopped when AlphaCore stops. The console never knows the difference.
//
// Why a child process and not the model inside this one: a native addon is a
// second dependency and a build step on every platform, and a model that
// crashes the process takes the whole company down with it. A child that
// crashes is restarted; the company keeps answering from its other providers
// in the meantime.
//
// What goes out: the release archive from GitHub and model files from Hugging
// Face, through the gate (connector `modelhub`), on a person's say-so. What
// runs: the binary, with an argument list and no shell.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret, setSetting } from './settings.js';
import { callConnector, connect, setConnectorState } from './connectors/index.js';
import { ENGINE_DIR } from './connectors/modelhub.js';
import { unzip, untargz } from './engine/archive.js';
import { localTuning } from './providers/ollama.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const BIN_DIR = path.join(ENGINE_DIR, 'bin');
const MODEL_DIR = path.join(ENGINE_DIR, 'models');
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
const NAME = /^[\w.\-]{2,80}$/;

/**
 * The models worth downloading on a small server, as GGUF files at Q4_K_M —
 * the quantisation that keeps most of the quality at about a quarter of the
 * size. Any other huggingface.co .gguf link can be added by hand.
 */
export const GGUF = [
  { name: 'qwen2.5-3b-instruct-q4_k_m', role: 'chat', sizeGb: 1.9, ramGb: 3, url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf', use: 'Triage, tagging, short answers, chat. Good Arabic for its size.' },
  { name: 'qwen2.5-7b-instruct-q4_k_m', role: 'chat', sizeGb: 4.7, ramGb: 6.5, url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf', use: 'The best quality that fits 8 GB: briefs, analysis, Arabic writing.' },
  { name: 'qwen3-4b-q4_k_m', role: 'chat', sizeGb: 2.5, ramGb: 4, url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf', use: 'Strong reasoning for its size. Slower with thinking on.' },
  { name: 'gemma-3-4b-it-q4_k_m', role: 'chat', sizeGb: 2.5, ramGb: 4.5, url: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf', use: 'Balanced and multilingual.' },
  { name: 'llama-3.2-3b-instruct-q4_k_m', role: 'chat', sizeGb: 2.0, ramGb: 3, url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf', use: 'Fast English. Weak in Arabic.' },
  { name: 'nomic-embed-text-v1.5-q8_0', role: 'embed', sizeGb: 0.15, ramGb: 0.5, url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf', use: 'Search that understands meaning.' },
];

// ---------------------------------------------------------------- binary --

/** Which release archive fits this machine. */
export function assetPattern(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return /-bin-win-cpu-x64\.zip$/;
  if (platform === 'linux' && arch === 'x64') return /-bin-ubuntu-x64\.(zip|tar\.gz)$/;
  if (platform === 'linux' && arch === 'arm64') return /-bin-ubuntu-arm64\.(zip|tar\.gz)$/;
  if (platform === 'darwin' && arch === 'arm64') return /-bin-macos-arm64\.(zip|tar\.gz)$/;
  if (platform === 'darwin' && arch === 'x64') return /-bin-macos-x64\.(zip|tar\.gz)$/;
  return null;
}

function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === EXE) return p;
    if (e.isDirectory()) { const hit = findExe(p); if (hit) return hit; }
  }
  return null;
}

/** The server binary: a path a person set (ENGINE_BIN), or the one downloaded here. */
export function binaryPath() {
  const set = getSecret('ENGINE_BIN');
  if (set && fs.existsSync(set)) return set;
  return findExe(BIN_DIR);
}

let installing = null;

/**
 * Download and unpack llama.cpp's server for this platform.
 *
 * A person asks for it; the connector is armed by the same act and recorded.
 * The previous build is kept until the new one has unpacked, so a failed
 * download never leaves the company without an engine.
 */
export async function installBinary({ actor }) {
  if (!isHuman(actor)) refuse('a person decides what runs on the server', 403);
  if (installing) refuse('already installing', 409);
  const pattern = assetPattern();
  if (!pattern) refuse(`no prebuilt engine for ${process.platform}/${process.arch} — build llama.cpp and set ENGINE_BIN`);
  armHub(actor);
  installing = { state: 'finding the release', at: Date.now() };
  try {
    const rel = await callConnector({ connector: 'modelhub', capability: 'release.fetch', actor, reason: 'find the engine release' });
    if (rel.verdict !== 'allowed') refuse(`the gate said ${rel.verdict}: ${rel.why || ''}`, 409);
    const asset = (rel.result.assets || []).find((a) => pattern.test(a.name));
    if (!asset) refuse(`release ${rel.result.tag} has no build matching ${pattern}`);
    installing = { state: `downloading ${asset.name}`, at: Date.now(), total: asset.size, got: 0 };
    const dest = path.join(ENGINE_DIR, 'downloads', asset.name);
    const dl = await callConnector({
      connector: 'modelhub', capability: 'file.fetch', actor, reason: `engine ${rel.result.tag}`,
      args: { url: asset.url, dest, onProgress: (got, total) => { installing.got = got; installing.total = total; } },
    });
    if (dl.verdict !== 'allowed') refuse(`the gate said ${dl.verdict}: ${dl.why || ''}`, 409);
    installing.state = 'unpacking';
    const staging = path.join(ENGINE_DIR, `bin-${Date.now()}`);
    const buf = fs.readFileSync(dl.result.file);
    if (asset.name.endsWith('.zip')) unzip(buf, staging); else untargz(buf, staging);
    if (!findExe(staging)) { fs.rmSync(staging, { recursive: true, force: true }); refuse(`${asset.name} has no ${EXE} in it`); }
    stopAll();
    fs.rmSync(BIN_DIR, { recursive: true, force: true });
    fs.renameSync(staging, BIN_DIR);
    fs.rmSync(dl.result.file, { force: true });
    const exe = findExe(BIN_DIR);
    if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
    setSetting('ENGINE_VERSION', rel.result.tag);
    audit({ actorType: 'human', actorId: actor, action: 'engine.installed', subjectType: 'engine', subjectId: rel.result.tag, payload: { asset: asset.name, sha256: dl.result.sha256, bytes: dl.result.bytes } });
    return { version: rel.result.tag, binary: exe };
  } finally {
    installing = null;
  }
}

function armHub(actor) {
  const c = one("SELECT state FROM connectors WHERE id = 'modelhub'");
  if (c?.state === 'live') return;
  connect('modelhub', { actor });
  setConnectorState('modelhub', 'live', { actor });
}

// ---------------------------------------------------------------- models --

/** Start downloading a model. Gigabytes, so it runs on and the page watches it. */
export function downloadModel({ name = null, url = null, role = null, actor }) {
  if (!isHuman(actor)) refuse('a person decides what is installed on the server', 403);
  const known = name ? GGUF.find((g) => g.name === name) : null;
  const src = known?.url || String(url || '').trim();
  let u;
  try { u = new URL(src); } catch { refuse('give a catalogue name or a huggingface.co link to a .gguf file'); }
  if (u.hostname !== 'huggingface.co' || !/\.gguf$/i.test(u.pathname)) refuse('a model is a .gguf file on huggingface.co');
  const n = known?.name || path.basename(u.pathname).replace(/\.gguf$/i, '').toLowerCase().replace(/[^\w.\-]/g, '-').slice(0, 80);
  if (!NAME.test(n)) refuse('that file name will not do');
  const existing = one('SELECT * FROM engine_models WHERE name = ?', n);
  if (existing?.state === 'downloading') refuse('already downloading', 409);
  if (existing?.state === 'ready') refuse('already here', 409);
  const file = path.join(MODEL_DIR, `${n}.gguf`);
  const r = existing
    ? (exec("UPDATE engine_models SET state = 'downloading', received = 0, detail = NULL WHERE id = ?", existing.id), existing.id)
    : Number(exec('INSERT INTO engine_models (name, url, file, role, created_by) VALUES (?,?,?,?,?)', n, src, file, known?.role || (role === 'embed' ? 'embed' : 'chat'), actor).lastInsertRowid);
  armHub(actor);
  audit({ actorType: 'human', actorId: actor, action: 'engine.model_download', subjectType: 'engine_model', subjectId: n, payload: { url: src } });
  callConnector({
    connector: 'modelhub', capability: 'file.fetch', actor, reason: `model ${n}`,
    args: { url: src, dest: file, onProgress: (got, total) => exec('UPDATE engine_models SET received = ?, size = COALESCE(?, size) WHERE id = ?', got, total, r) },
  }).then((res) => {
    if (res.verdict !== 'allowed') { exec("UPDATE engine_models SET state = 'failed', detail = ? WHERE id = ?", `${res.verdict}: ${res.why || ''}`, r); return; }
    exec("UPDATE engine_models SET state = 'ready', size = ?, received = ?, sha256 = ? WHERE id = ?", res.result.bytes, res.result.bytes, res.result.sha256, r);
    audit({ actorType: 'system', actorId: 'system:engine', action: 'engine.model_ready', subjectType: 'engine_model', subjectId: n, payload: { sha256: res.result.sha256, bytes: res.result.bytes } });
  }).catch((e) => exec("UPDATE engine_models SET state = 'failed', detail = ? WHERE id = ?", String(e.message || e).slice(0, 300), r));
  return one('SELECT * FROM engine_models WHERE id = ?', r);
}

export function removeModel({ name, actor }) {
  if (!isHuman(actor)) refuse('a person decides what is installed on the server', 403);
  const m = one('SELECT * FROM engine_models WHERE name = ?', name);
  if (!m) refuse('no such model', 404);
  for (const role of ['chat', 'embed']) if (procs[role]?.model === name) stop(role);
  try { fs.rmSync(m.file, { force: true }); } catch { /* already gone */ }
  exec('DELETE FROM engine_models WHERE id = ?', m.id);
  audit({ actorType: 'human', actorId: actor, action: 'engine.model_removed', subjectType: 'engine_model', subjectId: name });
  return { ok: true };
}

// --------------------------------------------------------------- process --

const procs = { chat: null, embed: null };
export const PORTS = { chat: 8090, embed: 8091 };

export function chatBase() { return getSecret('ENGINE_BASE_URL') || `http://127.0.0.1:${PORTS.chat}`; }
export function embedBase() { return procs.embed?.state === 'ready' ? `http://127.0.0.1:${PORTS.embed}` : null; }

/** The argument list, built in one place so it can be read and tested. */
export function serverArgs({ file, role = 'chat', port = PORTS[role] }) {
  const tune = localTuning();
  const args = ['-m', file, '--host', '127.0.0.1', '--port', String(port), '-c', String(role === 'embed' ? 2048 : tune.numCtx)];
  if (tune.numThread) args.push('-t', String(tune.numThread));
  if (role === 'embed') args.push('--embedding');
  return args;
}

/**
 * Start a server for one model and keep it up.
 *
 * `launcher` replaces the binary and is for the tests, which stand in a small
 * script for llama.cpp. It is not reachable from the API.
 */
export function start({ name, role = 'chat', actor = 'system:engine', launcher = null }) {
  const m = one("SELECT * FROM engine_models WHERE name = ? AND state = 'ready'", name);
  if (!m) refuse('that model is not downloaded yet');
  if (m.role !== role) refuse(`${name} is a ${m.role} model`);
  const bin = launcher ? launcher[0] : binaryPath();
  if (!bin) refuse('the engine is not installed — install it first');
  stop(role);
  const p = { model: name, role, port: PORTS[role], state: 'starting', startedAt: Date.now(), restarts: 0, log: [], wanted: true, child: null, bin, pre: launcher ? launcher.slice(1) : [], file: m.file };
  procs[role] = p;
  launch(p);
  setSetting(role === 'chat' ? 'ENGINE_CHAT_MODEL' : 'ENGINE_EMBED_MODEL', name);
  if (role === 'chat') setSetting('ENGINE_ENABLED', 'true');
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'engine.started', subjectType: 'engine_model', subjectId: name, payload: { role } });
  return status();
}

function launch(p) {
  const dir = path.dirname(p.bin);
  const child = spawn(p.bin, [...p.pre, ...serverArgs({ file: p.file, role: p.role, port: p.port })], {
    cwd: dir,
    env: { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  p.child = child;
  p.state = 'starting';
  const keep = (b) => { for (const line of String(b).split(/\r?\n/)) if (line.trim()) { p.log.push(line.slice(0, 300)); if (p.log.length > 60) p.log.shift(); } };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    if (p.child !== child) return;
    p.child = null;
    if (!p.wanted) { p.state = 'stopped'; return; }
    p.state = 'crashed';
    p.lastExit = code;
    // Backoff: 2, 4, 8, 16, 32 seconds, then stop trying and say so. A model
    // that dies on load will die on every load; retrying forever is noise.
    if (p.restarts >= 5) { p.state = 'failed'; return; }
    p.restarts++;
    setTimeout(() => { if (p.wanted && procs[p.role] === p) launch(p); }, 2 ** p.restarts * 1000).unref?.();
  });
  waitHealthy(p, child);
}

async function waitHealthy(p, child) {
  for (let i = 0; i < 240 && p.child === child; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p.port}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { p.state = 'ready'; p.readyAt = Date.now(); return; }
    } catch { /* still loading */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function stop(role = 'chat', { actor = null } = {}) {
  const p = procs[role];
  if (!p) return { ok: true };
  p.wanted = false;
  try { p.child?.kill(); } catch { /* already gone */ }
  procs[role] = null;
  if (actor) audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: actor, action: 'engine.stopped', subjectType: 'engine_model', subjectId: p.model, payload: { role } });
  return { ok: true };
}

export function stopAll() { stop('chat'); stop('embed'); }

/** Called at boot: bring back what was running before, if it still can. */
export function bootEngine() {
  if (String(getSecret('ENGINE_ENABLED') || '').toLowerCase() !== 'true' || !binaryPath()) return;
  for (const [role, key] of [['chat', 'ENGINE_CHAT_MODEL'], ['embed', 'ENGINE_EMBED_MODEL']]) {
    const name = getSecret(key);
    if (name && one("SELECT id FROM engine_models WHERE name = ? AND state = 'ready'", name)) {
      try { start({ name, role }); } catch { /* the page says why */ }
    }
  }
}

/** Switch the engine off entirely: the router goes back to Ollama or the hosted chain. */
export function disable({ actor }) {
  if (!isHuman(actor)) refuse('a person switches the engine off', 403);
  stopAll();
  setSetting('ENGINE_ENABLED', '');
  audit({ actorType: 'human', actorId: actor, action: 'engine.disabled', subjectType: 'engine', subjectId: 'engine' });
  return status();
}

function version(bin) {
  if (!bin) return null;
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, cwd: path.dirname(bin), windowsHide: true, shell: false });
    return String(r.stdout || r.stderr || '').split(/\r?\n/).find((l) => /version/i.test(l))?.trim().slice(0, 120) || null;
  } catch { return null; }
}

let cachedVersion = { bin: null, v: null };
export function status() {
  const bin = binaryPath();
  if (cachedVersion.bin !== bin) cachedVersion = { bin, v: version(bin) };
  const view = (p) => (p ? { model: p.model, state: p.state, port: p.port, pid: p.child?.pid || null, restarts: p.restarts, upSeconds: p.readyAt ? Math.round((Date.now() - p.readyAt) / 1000) : null, log: p.log.slice(-12) } : null);
  const have = new Map(q('SELECT * FROM engine_models ORDER BY id').map((m) => [m.name, m]));
  return {
    enabled: String(getSecret('ENGINE_ENABLED') || '').toLowerCase() === 'true',
    supported: Boolean(assetPattern()) || Boolean(getSecret('ENGINE_BIN')),
    binary: bin ? path.relative(ENGINE_DIR, bin) || bin : null,
    version: getSecret('ENGINE_VERSION') || cachedVersion.v,
    installing,
    chat: view(procs.chat),
    embed: view(procs.embed),
    models: [...have.values()].map((m) => ({ ...m, file: undefined, pct: m.size ? Math.round((m.received / m.size) * 100) : null })),
    catalogue: GGUF.map((g) => ({ ...g, have: have.get(g.name)?.state || null })),
  };
}
