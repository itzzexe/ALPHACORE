// Artifacts — where agent output becomes real files on disk.
// Two paths in:
//   1. writeStepArtifact — automatic archive of every completed pipeline step
//      (markdown records under workspace/<pipeline>/_forge/).
//   2. applyRunFiles — HUMAN action: takes an Engineer-style output
//      (parsed.files[] with path+content) and writes the actual files.
// Every path is sandboxed to the workspace root: absolute paths, drive
// letters, and `..` traversal are rejected outright.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { one } from './db.js';
import { audit } from './audit.js';

export const WS_ROOT = path.join(ROOT, 'workspace');

function safeTarget(wsDir, rel) {
  const cleaned = String(rel).replace(/\\/g, '/');
  if (!cleaned || path.isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned) || cleaned.split('/').includes('..')) {
    throw new Error(`unsafe path rejected: ${rel}`);
  }
  const target = path.resolve(wsDir, cleaned);
  if (!target.startsWith(path.resolve(wsDir) + path.sep) && target !== path.resolve(wsDir)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return target;
}

/** Each workspace is an isolated project: its own package.json stops Node
 *  module-type (and other config) inheritance from crucible-core itself. */
function ensureWorkspace(wsName) {
  const wsDir = path.join(WS_ROOT, wsName);
  fs.mkdirSync(wsDir, { recursive: true });
  const pkg = path.join(wsDir, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({ name: wsName, private: true }, null, 2) + '\n', 'utf8');
  }
  return wsDir;
}

export function writeStepArtifact(workspace, name, content) {
  ensureWorkspace(workspace);
  const dir = path.join(WS_ROOT, workspace, '_forge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(safeTarget(dir, name), content, 'utf8');
}

/** Human-gated: write an Engineer run's files[] into the workspace. */
export function applyRunFiles(runId, actor) {
  const run = one('SELECT * FROM runs WHERE id = ?', runId);
  if (!run) throw new Error('run not found');
  if (run.state !== 'done') throw new Error(`run is ${run.state}; only done runs can be applied`);
  const output = run.output ? JSON.parse(run.output) : null;
  const files = output?.parsed?.files;
  if (!Array.isArray(files) || !files.length) throw new Error('run output has no files[]');

  const pipeline = run.pipeline_id ? one('SELECT workspace FROM pipelines WHERE id = ?', run.pipeline_id) : null;
  const wsName = pipeline?.workspace || 'adhoc';
  const wsDir = ensureWorkspace(wsName);

  const written = [];
  for (const f of files) {
    if (!f?.path || typeof f.content !== 'string') continue;
    const target = safeTarget(wsDir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, 'utf8');
    written.push(path.join(wsName, String(f.path).replace(/\\/g, '/')).replace(/\\/g, '/'));
  }
  if (!written.length) throw new Error('no valid files in output');
  audit({ actorType: 'human', actorId: actor, action: 'artifact.applied', subjectType: 'run', subjectId: runId, payload: { files: written } });
  return written;
}

export function listArtifacts() {
  const out = [];
  if (!fs.existsSync(WS_ROOT)) return out;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), r);
      else {
        const st = fs.statSync(path.join(dir, entry.name));
        out.push({ path: r, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  };
  walk(WS_ROOT, '');
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readArtifact(rel) {
  const target = safeTarget(WS_ROOT, rel);
  if (!fs.existsSync(target)) throw new Error('not found');
  const st = fs.statSync(target);
  if (st.size > 300 * 1024) throw new Error('file too large to preview');
  return { path: rel, size: st.size, content: fs.readFileSync(target, 'utf8') };
}
