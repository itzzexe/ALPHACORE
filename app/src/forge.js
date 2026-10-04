// The software factory — where the company writes, runs and ships its own code.
//
// A project is a real directory under workspace/_apps/<slug>, a real git
// repository, and a real process when it is previewed. Nothing here simulates
// building software: the files on disk are the product.
//
// Three hands can touch a project, and each one is recorded:
//
//   a person      edits a file in the console, runs a command, commits.
//   an engineer   (an AI employee) proposes a change set — whole files, never
//                 patches — which waits for a person to apply it, unless the
//                 project has been put on autopilot by somebody allowed to.
//   the platform  scaffolds templates, packages releases, serves previews.
//
// Commands run on this machine, so they are held to an allowlist of build
// tools and never pass through a shell on POSIX. On Windows the package
// managers are .cmd files and must go through cmd.exe, so there every argument
// is refused if it carries a character cmd.exe would interpret.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { WS_ROOT } from './artifacts.js';
import { openPii } from './erasure.js';
import { getSetting } from './settings.js';
import { ROOT } from './env.js';

// Overridable so the tests build their projects in a scratch directory rather
// than beside the company's real ones.
export const APPS_ROOT = process.env.ALPHACORE_APPS_ROOT ? path.resolve(ROOT, process.env.ALPHACORE_APPS_ROOT) : path.join(WS_ROOT, '_apps');

exec(`CREATE TABLE IF NOT EXISTS forge_projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'blank',      -- blank|static-site|node-api|fullstack|python-api|website
  description TEXT,
  meta        TEXT,                               -- JSON: website brief, theme, anything kind-specific
  repo_url    TEXT,
  autopilot   INTEGER NOT NULL DEFAULT 0,         -- 1 = AI change sets apply themselves
  state       TEXT NOT NULL DEFAULT 'active',     -- active|archived
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec(`CREATE TABLE IF NOT EXISTS forge_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES forge_projects(id),
  prompt      TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  run_id      TEXT,
  state       TEXT NOT NULL DEFAULT 'drafting',   -- drafting|proposed|applied|rejected|failed
  summary     TEXT,
  files       TEXT,                               -- JSON [{path, content}]
  deletes     TEXT,                               -- JSON [path]
  commands    TEXT,                               -- JSON [string] suggested, never auto-run
  gaps        TEXT,                               -- JSON [string]
  commit_sha  TEXT,
  created_by  TEXT NOT NULL,
  decided_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
)`);
exec(`CREATE TABLE IF NOT EXISTS forge_commands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES forge_projects(id),
  command     TEXT NOT NULL,                      -- as displayed: secrets already redacted
  state       TEXT NOT NULL DEFAULT 'running',    -- running|ok|failed|killed
  exit_code   INTEGER,
  output      TEXT NOT NULL DEFAULT '',
  started_by  TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  duration_ms INTEGER
)`);
exec('CREATE INDEX IF NOT EXISTS forge_changes_project ON forge_changes (project_id, id)');
exec('CREATE INDEX IF NOT EXISTS forge_commands_project ON forge_commands (project_id, id)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const now = () => new Date().toISOString();
const IS_WIN = process.platform === 'win32';

export const KINDS = {
  blank: { label: 'Blank repository', hint: 'An empty repository and a README — start from nothing.' },
  'static-site': { label: 'Static website', hint: 'HTML, CSS and a little JavaScript. Deploys anywhere.' },
  'node-api': { label: 'Node.js API', hint: 'A JSON API on node:http with tests. No dependencies.' },
  fullstack: { label: 'Full-stack web app', hint: 'A Node server with an API and a browser front end.' },
  'python-api': { label: 'Python API', hint: 'A JSON API on the standard library, with tests.' },
  website: { label: 'Business website', hint: 'Made by the website builder from a brief.' },
};

// ------------------------------------------------------------------ paths --

export function projectDir(p) { return path.join(APPS_ROOT, p.slug); }

/** Resolve a path inside a project, refusing anything that would leave it. */
function inside(p, rel) {
  const clean = String(rel || '').replace(/\\/g, '/');
  if (clean.startsWith('/') || /^[a-z]:/i.test(clean)) refuse(`not a path inside the project: ${rel}`);
  if (!clean || clean.split('/').some((s) => s === '..' || s === '')) refuse(`not a path inside the project: ${rel}`);
  if (clean === '.git' || clean.startsWith('.git/')) refuse('the repository internals are not editable here');
  const root = projectDir(p);
  const full = path.resolve(root, clean);
  if (!full.startsWith(root + path.sep)) refuse(`path escapes the project: ${rel}`);
  return { full, rel: clean };
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', '.cache']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.html', '.htm', '.css', '.scss',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.sh', '.yml', '.yaml', '.toml', '.ini', '.env', '.sql', '.xml', '.svg',
  '.gitignore', '.dockerignore', '.vue', '.svelte', '.cs', '.kt', '.swift', '.c', '.h', '.cpp', '']);
const isText = (f) => TEXT_EXT.has(path.extname(f).toLowerCase()) || /^(Dockerfile|Makefile|Procfile|LICENSE|README)$/i.test(path.basename(f));

/** Every file in the project, relative, sorted — skipping dependency folders. */
export function walk(p, { limit = 2000 } = {}) {
  const root = projectDir(p);
  const out = [];
  const go = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(full); continue; }
      const st = fs.statSync(full);
      out.push({ path: path.relative(root, full).replace(/\\/g, '/'), size: st.size, text: isText(e.name) });
    }
  };
  go(root);
  return out;
}

// -------------------------------------------------------------- templates --

const gitignore = 'node_modules/\n.env\n.env.*\n!.env.example\ndist/\n__pycache__/\n.venv/\n*.log\n';

function template(kind, { name, description }) {
  const title = name;
  const blurb = description || `${name} — built in the AlphaCore software factory.`;
  const readme = (extra) => `# ${title}\n\n${blurb}\n\n${extra}\n`;
  switch (kind) {
    case 'static-site':
      return {
        'README.md': readme('## Run it\n\nOpen `index.html`, or preview it from the factory.\n\n## Deploy\n\nAny static host or an nginx server: the factory deploys it for you.'),
        'index.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="top"><strong>${title}</strong><nav><a href="#about">About</a><a href="#contact">Contact</a></nav></header>
<main>
  <section class="hero"><h1>${title}</h1><p>${blurb}</p><a class="btn" href="#contact">Get in touch</a></section>
  <section id="about"><h2>About</h2><p>Replace this with what you do and who it is for.</p></section>
  <section id="contact"><h2>Contact</h2><p><a href="mailto:hello@example.com">hello@example.com</a></p></section>
</main>
<footer>© <span id="year"></span> ${title}</footer>
<script src="script.js"></script>
</body>
</html>
`,
        'styles.css': `:root{--bg:#0f172a;--ink:#e2e8f0;--accent:#38bdf8}*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
.top{display:flex;justify-content:space-between;align-items:center;padding:16px 24px}.top nav a{color:var(--ink);margin-inline-start:16px;text-decoration:none}
main{max-width:880px;margin:0 auto;padding:24px}.hero{padding:72px 0}.hero h1{font-size:clamp(32px,6vw,56px);margin:0 0 12px}
.btn{display:inline-block;background:var(--accent);color:#04121c;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
section{padding:32px 0}footer{text-align:center;padding:32px;opacity:.7}
`,
        'script.js': "document.getElementById('year').textContent = new Date().getFullYear();\n",
        '.gitignore': gitignore,
      };
    case 'node-api':
      return {
        'README.md': readme('## Run it\n\n```\nnpm start        # http://localhost:3000\nnpm test\n```\n\nEndpoints: `GET /health`, `GET/POST /api/items`, `DELETE /api/items/:id`.'),
        'package.json': JSON.stringify({ name: slugify(name) || 'app', version: '0.1.0', private: true, type: 'module', scripts: { start: 'node src/server.js', test: 'node --test' }, engines: { node: '>=20' } }, null, 2) + '\n',
        'src/app.js': `import http from 'node:http';

/** An in-memory store. Swap for a database when the app earns one. */
export function createApp() {
  const items = new Map();
  let seq = 0;
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname === '/api/items' && req.method === 'GET') return send(res, 200, [...items.values()]);
    if (url.pathname === '/api/items' && req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'body must be JSON' }); }
      if (!body.name) return send(res, 400, { error: 'name is required' });
      const item = { id: ++seq, name: String(body.name), createdAt: new Date().toISOString() };
      items.set(item.id, item);
      return send(res, 201, item);
    }
    const m = url.pathname.match(/^\\/api\\/items\\/(\\d+)$/);
    if (m && req.method === 'DELETE') {
      return items.delete(Number(m[1])) ? send(res, 204, {}) : send(res, 404, { error: 'not found' });
    }
    send(res, 404, { error: 'not found' });
  });
}
`,
        'src/server.js': `import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(\`listening on http://localhost:\${port}\`));
`,
        'test/app.test.js': `import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('health answers and items can be created', async () => {
  const server = createApp().listen(0);
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  try {
    assert.equal((await fetch(\`\${base}/health\`)).status, 200);
    const made = await fetch(\`\${base}/api/items\`, { method: 'POST', body: JSON.stringify({ name: 'first' }) });
    assert.equal(made.status, 201);
    const list = await (await fetch(\`\${base}/api/items\`)).json();
    assert.equal(list.length, 1);
  } finally { server.close(); }
});
`,
        Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev\nCOPY . .\nENV PORT=3000\nEXPOSE 3000\nCMD ["npm","start"]\n',
        '.gitignore': gitignore,
      };
    case 'fullstack':
      return {
        'README.md': readme('## Run it\n\n```\nnpm start   # http://localhost:3000\nnpm test\n```'),
        'package.json': JSON.stringify({ name: slugify(name) || 'app', version: '0.1.0', private: true, type: 'module', scripts: { start: 'node server.js', test: 'node --test' }, engines: { node: '>=20' } }, null, 2) + '\n',
        'server.js': `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const notes = [];

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (url.pathname === '/api/notes') {
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const text = String(JSON.parse(raw || '{}').text || '').slice(0, 500);
      if (text) notes.unshift({ text, at: new Date().toISOString() });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(notes.slice(0, 50)));
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(\`listening on http://localhost:\${port}\`));
}
`,
        'public/index.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="styles.css"></head>
<body><main><h1>${title}</h1><p>${blurb}</p>
<form id="f"><input id="t" placeholder="Write a note" aria-label="Note"><button>Save note</button></form>
<ul id="list"></ul></main><script src="app.js"></script></body></html>
`,
        'public/styles.css': 'body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:640px;margin:48px auto;padding:0 16px}form{display:flex;gap:8px}input{flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:8px}button{padding:10px 16px;border:0;border-radius:8px;background:#0f172a;color:#fff}li{padding:8px 0;border-bottom:1px solid #e2e8f0}\n',
        'public/app.js': `const list = document.getElementById('list');
const draw = (notes) => { list.innerHTML = notes.map((n) => \`<li>\${n.text.replace(/</g, '&lt;')}</li>\`).join(''); };
fetch('api/notes').then((r) => r.json()).then(draw);
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = document.getElementById('t');
  const r = await fetch('api/notes', { method: 'POST', body: JSON.stringify({ text: t.value }) });
  draw(await r.json()); t.value = '';
});
`,
        'test/server.test.js': `import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.js';

test('serves health and notes', async () => {
  server.listen(0);
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  try {
    assert.equal((await fetch(\`\${base}/health\`)).status, 200);
    const r = await fetch(\`\${base}/api/notes\`, { method: 'POST', body: JSON.stringify({ text: 'hi' }) });
    assert.equal((await r.json())[0].text, 'hi');
  } finally { server.close(); }
});
`,
        Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nENV PORT=3000\nEXPOSE 3000\nCMD ["node","server.js"]\n',
        '.gitignore': gitignore,
      };
    case 'python-api':
      return {
        'README.md': readme('## Run it\n\n```\npython app.py          # http://localhost:8000\npython -m unittest\n```'),
        'app.py': `"""A JSON API on the standard library. No dependencies to install."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ITEMS = []


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        if self.path == "/api/items":
            return self._send(200, ITEMS)
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/items":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if not body.get("name"):
            return self._send(400, {"error": "name is required"})
        item = {"id": len(ITEMS) + 1, "name": str(body["name"])}
        ITEMS.append(item)
        self._send(201, item)


def serve(port=None):
    port = int(port or os.environ.get("PORT", 8000))
    return ThreadingHTTPServer(("0.0.0.0", port), Handler)


if __name__ == "__main__":
    srv = serve()
    print(f"listening on http://localhost:{srv.server_port}")
    srv.serve_forever()
`,
        'test_app.py': `import json
import threading
import unittest
import urllib.request

import app


class AppTest(unittest.TestCase):
    def test_health(self):
        srv = app.serve(0)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{srv.server_port}/health") as r:
                self.assertEqual(json.loads(r.read())["ok"], True)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
`,
        'requirements.txt': '# standard library only\n',
        Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nENV PORT=8000\nEXPOSE 8000\nCMD ["python","app.py"]\n',
        '.gitignore': gitignore,
      };
    default:
      return { 'README.md': readme('Start here. Ask an engineer to build the first version, or write it yourself.'), '.gitignore': gitignore };
  }
}

// ------------------------------------------------------------------- git --

let gitOk = null;
export function gitAvailable() {
  if (gitOk === null) {
    try { gitOk = spawnSync('git', ['--version'], { windowsHide: true, timeout: 8000 }).status === 0; } catch { gitOk = false; }
  }
  return gitOk;
}
const GIT_ID = ['-c', 'user.name=AlphaCore', '-c', 'user.email=forge@alphacore.local', '-c', 'commit.gpgsign=false'];
function git(p, args, { timeout = 30_000 } = {}) {
  if (!gitAvailable()) return { ok: false, out: 'git is not installed on this machine' };
  const r = spawnSync('git', [...GIT_ID, ...args], { cwd: projectDir(p), windowsHide: true, timeout, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
export function commitAll(p, message, actor) {
  if (!gitAvailable()) return null;
  git(p, ['add', '-A']);
  const r = git(p, ['commit', '-m', `${message}\n\nBy: ${actor}`]);
  if (!r.ok) return null;
  return git(p, ['rev-parse', '--short', 'HEAD']).out || null;
}
export function gitLog(p, n = 20) {
  const r = git(p, ['log', `-n${n}`, '--pretty=format:%h\x1f%an\x1f%ad\x1f%s', '--date=iso']);
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean).map((l) => { const [sha, author, date, subject] = l.split('\x1f'); return { sha, author, date, subject }; });
}
export function gitStatus(p) {
  const r = git(p, ['status', '--porcelain']);
  return r.ok ? r.out.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3) })) : [];
}

// --------------------------------------------------------------- projects --

export function createProject({ name, kind = 'blank', description = '', meta = null, files = null, actor }) {
  if (!String(name || '').trim()) refuse('a project needs a name');
  if (!KINDS[kind]) refuse(`kind must be one of: ${Object.keys(KINDS).join(', ')}`);
  let slug = slugify(name) || `app-${Date.now().toString(36)}`;
  for (let i = 2; one('SELECT id FROM forge_projects WHERE slug = ?', slug) || fs.existsSync(path.join(APPS_ROOT, slug)); i++) slug = `${slugify(name) || 'app'}-${i}`;
  exec('INSERT INTO forge_projects (slug, name, kind, description, meta, created_by) VALUES (?,?,?,?,?,?)',
    slug, String(name).trim().slice(0, 80), kind, String(description || '').slice(0, 2000), meta ? JSON.stringify(meta) : null, actor);
  const p = one('SELECT * FROM forge_projects WHERE slug = ?', slug);
  const dir = projectDir(p);
  fs.mkdirSync(dir, { recursive: true });
  const tree = files || template(kind, { name: p.name, description: p.description });
  for (const [rel, content] of Object.entries(tree)) {
    const { full } = inside(p, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  if (gitAvailable()) { git(p, ['init', '-q', '-b', 'main']); commitAll(p, `Scaffold ${KINDS[kind].label.toLowerCase()}`, actor); }
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'forge.project_created', subjectType: 'forgeProject', subjectId: p.id, payload: { slug, kind } });
  return getProject(p.id);
}

export function listProjects() {
  return q("SELECT * FROM forge_projects WHERE state = 'active' ORDER BY updated_at DESC").map((p) => ({
    ...p,
    meta: p.meta ? JSON.parse(p.meta) : null,
    files: fs.existsSync(projectDir(p)) ? walk(p, { limit: 5000 }).length : 0,
    pending: one("SELECT COUNT(*) AS n FROM forge_changes WHERE project_id = ? AND state IN ('drafting','proposed')", p.id).n,
    preview: previewState(p),
    lastCommit: gitLog(p, 1)[0] || null,
  }));
}

export function projectRow(idOrSlug) {
  const p = /^\d+$/.test(String(idOrSlug))
    ? one('SELECT * FROM forge_projects WHERE id = ?', Number(idOrSlug))
    : one('SELECT * FROM forge_projects WHERE slug = ?', String(idOrSlug));
  if (!p) refuse('no such project', 404);
  return p;
}

export function getProject(id) {
  const p = projectRow(id);
  return {
    ...p,
    meta: p.meta ? JSON.parse(p.meta) : null,
    kindLabel: KINDS[p.kind]?.label || p.kind,
    tree: walk(p),
    git: { available: gitAvailable(), log: gitLog(p), status: gitStatus(p) },
    changes: q('SELECT id, prompt, agent_id, state, summary, files, deletes, commands, gaps, commit_sha, created_by, decided_by, created_at, decided_at FROM forge_changes WHERE project_id = ? ORDER BY id DESC LIMIT 30', p.id)
      .map((c) => ({ ...c, files: JSON.parse(c.files || '[]').map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content || ''), content: f.content })), deletes: JSON.parse(c.deletes || '[]'), commands: JSON.parse(c.commands || '[]'), gaps: JSON.parse(c.gaps || '[]') })),
    commands: q('SELECT id, command, state, exit_code, started_by, started_at, ended_at, duration_ms FROM forge_commands WHERE project_id = ? ORDER BY id DESC LIMIT 30', p.id),
    preview: previewState(p),
    scripts: scriptsOf(p),
  };
}

export function updateProject(id, { name, description, repoUrl, autopilot, archived, actor }) {
  const p = projectRow(id);
  if (autopilot !== undefined && !String(actor).startsWith('human:')) refuse('only a person can put a project on autopilot');
  exec(`UPDATE forge_projects SET name = COALESCE(?, name), description = COALESCE(?, description), repo_url = COALESCE(?, repo_url),
        autopilot = COALESCE(?, autopilot), state = COALESCE(?, state), updated_at = datetime('now') WHERE id = ?`,
  name ? String(name).slice(0, 80) : null, description ?? null, repoUrl ?? null,
  autopilot === undefined ? null : (autopilot ? 1 : 0), archived === undefined ? null : (archived ? 'archived' : 'active'), p.id);
  audit({ actorType: 'human', actorId: actor, action: 'forge.project_updated', subjectType: 'forgeProject', subjectId: p.id, payload: { autopilot, archived } });
  return getProject(p.id);
}

const touch = (p) => exec("UPDATE forge_projects SET updated_at = datetime('now') WHERE id = ?", p.id);

// ------------------------------------------------------------------ files --

export function readProjectFile(id, rel) {
  const p = projectRow(id);
  const { full, rel: clean } = inside(p, rel);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) refuse('no such file', 404);
  const st = fs.statSync(full);
  if (!isText(full) || st.size > 1_000_000) return { path: clean, size: st.size, binary: true, content: null };
  return { path: clean, size: st.size, binary: false, content: fs.readFileSync(full, 'utf8') };
}

export function writeProjectFile(id, { path: rel, content, commit = true, actor }) {
  const p = projectRow(id);
  const { full, rel: clean } = inside(p, rel);
  if (typeof content !== 'string') refuse('content must be text');
  if (Buffer.byteLength(content) > 2_000_000) refuse('a file over 2 MB is not edited here');
  const existed = fs.existsSync(full);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  touch(p);
  const sha = commit ? commitAll(p, `${existed ? 'Edit' : 'Add'} ${clean}`, actor) : null;
  audit({ actorType: 'human', actorId: actor, action: existed ? 'forge.file_edited' : 'forge.file_added', subjectType: 'forgeProject', subjectId: p.id, payload: { path: clean, bytes: Buffer.byteLength(content), commit: sha } });
  return { path: clean, commit: sha };
}

export function deleteProjectFile(id, { path: rel, actor }) {
  const p = projectRow(id);
  const { full, rel: clean } = inside(p, rel);
  if (!fs.existsSync(full)) refuse('no such file', 404);
  fs.rmSync(full, { recursive: true, force: true });
  touch(p);
  const sha = commitAll(p, `Delete ${clean}`, actor);
  audit({ actorType: 'human', actorId: actor, action: 'forge.file_deleted', subjectType: 'forgeProject', subjectId: p.id, payload: { path: clean, commit: sha } });
  return { path: clean, commit: sha };
}

// --------------------------------------------------------- AI change sets --

const MARK = '[FORGE-CHANGE]';
/** Which employee writes for which kind of project. */
const ENGINEER = { website: 'AGT-ENG-002', 'static-site': 'AGT-ENG-002', fullstack: 'AGT-ENG-001' };

function contextFor(p, budget = 60_000) {
  const tree = walk(p);
  const priority = (f) => (/^(README|package\.json|requirements\.txt)/i.test(f.path) ? 0 : /^(src|app|server|public|index)/.test(f.path) ? 1 : 2);
  let used = 0;
  const bodies = [];
  for (const f of [...tree].filter((x) => x.text && x.size < 60_000).sort((a, b) => priority(a) - priority(b))) {
    if (used + f.size > budget) continue;
    used += f.size;
    bodies.push(`--- ${f.path}\n${fs.readFileSync(path.join(projectDir(p), f.path), 'utf8')}`);
  }
  return { listing: tree.map((f) => f.path).join('\n'), bodies: bodies.join('\n\n') };
}

/**
 * Ask an engineer for a change. What comes back is a proposal — whole files —
 * that a person applies, unless the project is on autopilot.
 */
export function requestChange({ projectId, prompt, agentId = null, actor }) {
  const p = projectRow(projectId);
  if (!String(prompt || '').trim()) refuse('say what should change');
  const agent = agentId || ENGINEER[p.kind] || 'AGT-ENG-001';
  const ctx = contextFor(p);
  const meta = p.meta ? JSON.parse(p.meta) : null;
  exec('INSERT INTO forge_changes (project_id, prompt, agent_id, created_by) VALUES (?,?,?,?)', p.id, String(prompt).slice(0, 8000), agent, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  const runId = enqueueRun({
    agentId: agent,
    taskType: `forge:${id}`,
    actor,
    input: {
      prompt: `${MARK} You are working inside a real code repository: "${p.name}" (${KINDS[p.kind]?.label || p.kind}).
${p.description ? `What it is: ${p.description}\n` : ''}${meta?.brief ? `Brief: ${JSON.stringify(meta.brief)}\n` : ''}
THE CHANGE REQUESTED:
${String(prompt).trim()}

RULES:
- Return the COMPLETE content of every file you create or change — never a diff, never "rest unchanged".
- Keep the project runnable. Prefer the standard library over new dependencies; if you add one, add it to the manifest.
- Add or update tests where the project has them.
- Paths are relative to the repository root. Do not touch .git.
- If something cannot be done properly, say so in knownGaps rather than faking it.

FILES IN THE REPOSITORY:
${ctx.listing || '(empty)'}

CURRENT CONTENTS (most relevant first):
${ctx.bodies || '(none)'}

Output JSON: {"summary":"","files":[{"path":"","content":""}],"deletes":[],"commands":["npm test"],"knownGaps":[],"confidence":0.0}`,
    },
  });
  exec('UPDATE forge_changes SET run_id = ? WHERE id = ?', runId, id);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'forge.change_requested', subjectType: 'forgeProject', subjectId: p.id, payload: { changeId: id, agent } });
  return { id, runId, agent };
}

const cleanFiles = (files) => (Array.isArray(files) ? files : [])
  .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
  .slice(0, 80)
  .map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\.?\/+/, ''), content: f.content.slice(0, 600_000) }));

/** Server tick: fold finished engineer runs into proposals. */
export function syncForge() {
  for (const c of q("SELECT * FROM forge_changes WHERE state = 'drafting' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', c.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    let parsed = null;
    try { parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null; } catch { parsed = null; }
    const files = cleanFiles(parsed?.files);
    if (!files.length && !(parsed?.deletes || []).length) {
      exec("UPDATE forge_changes SET state = 'failed', summary = ? WHERE id = ?",
        parsed?.summary || run.failure_reason || `the engineer returned no files (${run.state})`, c.id);
      continue;
    }
    exec("UPDATE forge_changes SET state = 'proposed', summary = ?, files = ?, deletes = ?, commands = ?, gaps = ? WHERE id = ?",
      String(parsed.summary || '').slice(0, 4000), JSON.stringify(files), JSON.stringify((parsed.deletes || []).filter((x) => typeof x === 'string').slice(0, 40)),
      JSON.stringify((parsed.commands || []).filter((x) => typeof x === 'string').slice(0, 6)), JSON.stringify((parsed.knownGaps || []).slice(0, 20)), c.id);
    const p = one('SELECT * FROM forge_projects WHERE id = ?', c.project_id);
    if (p?.autopilot) {
      try { applyChange(c.id, { actor: `system:forge-autopilot` }); } catch (e) { notify({ level: 'warn', source: 'forge', message: `Autopilot could not apply change #${c.id} to ${p.name}: ${e.message}` }); }
    } else {
      notify({ level: 'info', source: 'forge', message: `An engineer proposed ${files.length} file(s) for ${p?.name}: review and apply.`, subjectType: 'forgeProject', subjectId: c.project_id });
    }
  }
}

export function applyChange(id, { actor }) {
  const c = one('SELECT * FROM forge_changes WHERE id = ?', Number(id));
  if (!c) refuse('no such change', 404);
  if (c.state !== 'proposed') refuse(`this change is ${c.state}, not waiting to be applied`);
  const p = projectRow(c.project_id);
  const files = JSON.parse(c.files || '[]');
  const deletes = JSON.parse(c.deletes || '[]');
  // Validate every path before writing any of them: half a change set is worse than none.
  const targets = files.map((f) => ({ ...inside(p, f.path), content: f.content }));
  const gone = deletes.map((d) => inside(p, d));
  for (const t of targets) { fs.mkdirSync(path.dirname(t.full), { recursive: true }); fs.writeFileSync(t.full, t.content, 'utf8'); }
  for (const g of gone) fs.rmSync(g.full, { force: true, recursive: true });
  const sha = commitAll(p, `AI change #${c.id}: ${String(c.summary || c.prompt).split('\n')[0].slice(0, 70)}`, `${actor} (proposed by ${c.agent_id})`);
  exec("UPDATE forge_changes SET state = 'applied', commit_sha = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?", sha, actor, c.id);
  touch(p);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'forge.change_applied', subjectType: 'forgeProject', subjectId: p.id, payload: { changeId: c.id, files: targets.map((t) => t.rel), deletes: gone.map((g) => g.rel), commit: sha } });
  return { ok: true, commit: sha, files: targets.length };
}

export function rejectChange(id, { note = null, actor }) {
  const c = one('SELECT * FROM forge_changes WHERE id = ?', Number(id));
  if (!c) refuse('no such change', 404);
  if (!['proposed', 'drafting'].includes(c.state)) refuse(`this change is ${c.state}`);
  exec("UPDATE forge_changes SET state = 'rejected', decided_by = ?, decided_at = datetime('now'), summary = COALESCE(summary, '') || ? WHERE id = ?",
    actor, note ? `\n\nRejected: ${String(note).slice(0, 500)}` : '', c.id);
  audit({ actorType: 'human', actorId: actor, action: 'forge.change_rejected', subjectType: 'forgeProject', subjectId: c.project_id, payload: { changeId: c.id } });
  return { ok: true };
}

// --------------------------------------------------------------- commands --

const BASE_BINS = ['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'git', 'python', 'python3', 'pip', 'pip3', 'go', 'cargo', 'dotnet', 'docker', 'make', 'tsc'];
export function allowedBins() {
  const extra = String(getSetting('FORGE_EXTRA_BINS') || '').split(/[\s,]+/).filter((b) => /^[a-z0-9._-]+$/i.test(b));
  return [...new Set([...BASE_BINS, ...extra])];
}

/** Split a command line into words, honouring quotes. No expansion of any kind. */
export function parseCommand(line) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const ch of String(line || '').trim()) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started || cur) { out.push(cur); cur = ''; started = false; } continue; }
    cur += ch; started = true;
  }
  if (quote) refuse('a quote is never closed');
  if (started || cur) out.push(cur);
  return out;
}

export function checkCommand(argv) {
  if (!argv.length) refuse('type a command');
  const bin = argv[0];
  if (!allowedBins().includes(bin)) refuse(`"${bin}" is not on the factory's list of build tools (${allowedBins().join(', ')}). An owner can add one with FORGE_EXTRA_BINS.`);
  const bad = argv.find((a) => /[\r\n\0]/.test(a) || (IS_WIN && /["&|<>^%!]/.test(a)));
  if (bad !== undefined) refuse(`refused an argument that a shell would interpret: ${bad.slice(0, 40)}`);
  return true;
}

const running = new Map();   // command id → child
const OUTPUT_CAP = 200_000;

/**
 * Start a command in a project. Returns at once with an id; the output fills
 * in as it arrives and the console polls it.
 */
export function runCommand({ projectId, command, argv = null, display = null, env = {}, timeoutMs = 15 * 60_000, actor }) {
  const p = projectRow(projectId);
  const words = argv || parseCommand(command);
  checkCommand(words);
  const shown = display || words.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(' ');
  exec('INSERT INTO forge_commands (project_id, command, started_by) VALUES (?,?,?)', p.id, shown.slice(0, 1000), actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: actor.startsWith('human') ? 'human' : 'system', actorId: actor, action: 'forge.command_started', subjectType: 'forgeProject', subjectId: p.id, payload: { commandId: id, command: shown.slice(0, 300) } });
  const started = Date.now();
  let buf = '';
  let flushed = 0;
  const flush = () => {
    if (buf.length === flushed) return;
    exec('UPDATE forge_commands SET output = ? WHERE id = ?', buf.length > OUTPUT_CAP ? `…(earlier output trimmed)\n${buf.slice(-OUTPUT_CAP)}` : buf, id);
    flushed = buf.length;
  };
  let child;
  try {
    child = spawn(words[0], words.slice(1), {
      cwd: projectDir(p), windowsHide: true, shell: IS_WIN,
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true', ...env },
    });
  } catch (e) {
    exec("UPDATE forge_commands SET state = 'failed', output = ?, ended_at = datetime('now'), duration_ms = 0 WHERE id = ?", String(e.message), id);
    return { id, state: 'failed' };
  }
  running.set(id, child);
  const take = (d) => { buf += d.toString('utf8'); if (buf.length > OUTPUT_CAP * 2) buf = buf.slice(-OUTPUT_CAP); };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  const ticker = setInterval(flush, 700);
  ticker.unref?.();
  const killer = setTimeout(() => { buf += `\n[stopped: ran longer than ${Math.round(timeoutMs / 60000)} min]`; child.kill(); }, timeoutMs);
  killer.unref?.();
  const finish = (code, err) => {
    if (!running.has(id)) return;
    running.delete(id);
    clearInterval(ticker); clearTimeout(killer);
    if (err) buf += `\n${err.message}`;
    flush();
    const killed = one('SELECT state FROM forge_commands WHERE id = ?', id)?.state === 'killed';
    const state = killed ? 'killed' : code === 0 ? 'ok' : 'failed';
    exec("UPDATE forge_commands SET state = ?, exit_code = ?, ended_at = datetime('now'), duration_ms = ? WHERE id = ?", state, code ?? -1, Date.now() - started, id);
    touch(p);
  };
  child.on('error', (e) => finish(-1, e));
  child.on('close', (code) => finish(code));
  return { id, state: 'running' };
}

export function getCommand(id) {
  const c = one('SELECT * FROM forge_commands WHERE id = ?', Number(id));
  if (!c) refuse('no such command', 404);
  return c;
}

export function killCommand(id, { actor }) {
  const child = running.get(Number(id));
  if (!child) refuse('that command is not running');
  exec("UPDATE forge_commands SET state = 'killed' WHERE id = ?", Number(id));
  child.kill();
  audit({ actorType: 'human', actorId: actor, action: 'forge.command_killed', subjectType: 'forgeCommand', subjectId: Number(id) });
  return { ok: true };
}

/** Run to completion — for the platform's own steps (tests, packaging checks). */
export function runCommandSync(p, argv, { timeoutMs = 120_000 } = {}) {
  checkCommand(argv);
  const r = spawnSync(argv[0], argv.slice(1), { cwd: projectDir(p), windowsHide: true, shell: IS_WIN, timeout: timeoutMs, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function scriptsOf(p) {
  const pkg = path.join(projectDir(p), 'package.json');
  if (fs.existsSync(pkg)) {
    try { return Object.keys(JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {}).map((s) => (s === 'start' || s === 'test' ? `npm ${s}` : `npm run ${s}`)); } catch { return []; }
  }
  if (fs.existsSync(path.join(projectDir(p), 'requirements.txt'))) return ['python -m unittest', 'pip install -r requirements.txt'];
  return [];
}

// ------------------------------------------------------------------- push --

/**
 * Push to the project's remote. A GitHub token in the vault is spliced into the
 * URL for this one call and never written anywhere: the command row shows the
 * URL without it.
 */
export async function pushProject(id, { actor, token = null }) {
  const p = projectRow(id);
  if (!p.repo_url) refuse('set the repository URL first');
  if (!/^https:\/\/[\w.-]+\/[\w./-]+$/.test(p.repo_url)) refuse('the repository URL must be an https URL');
  const url = token ? p.repo_url.replace(/^https:\/\//, `https://x-access-token:${token}@`) : p.repo_url;
  return runCommand({ projectId: p.id, argv: ['git', 'push', url, 'HEAD:main'], display: `git push ${p.repo_url} HEAD:main`, actor });
}

// --------------------------------------------------------------- packaging --

/** A minimal ustar writer. Enough for source trees; no links, no devices. */
export function tarGz(entries) {
  const blocks = [];
  const field = (buf, off, len, str) => { buf.write(String(str).slice(0, len), off, len, 'utf8'); };
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  for (const { name, data, mode = 0o644 } of entries) {
    let base = name;
    let prefix = '';
    if (Buffer.byteLength(base) > 100) {
      const cut = name.lastIndexOf('/', 154);
      if (cut < 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`path too long for a tar header: ${name}`);
      prefix = name.slice(0, cut); base = name.slice(cut + 1);
    }
    const h = Buffer.alloc(512, 0);
    field(h, 0, 100, base);
    field(h, 100, 8, octal(mode, 8));
    field(h, 108, 8, octal(0, 8));
    field(h, 116, 8, octal(0, 8));
    field(h, 124, 12, octal(data.length, 12));
    field(h, 136, 12, octal(Math.floor(Date.now() / 1000), 12));
    h.fill(' ', 148, 156);
    field(h, 156, 1, '0');
    field(h, 257, 6, 'ustar\0');
    field(h, 263, 2, '00');
    field(h, 345, 155, prefix);
    let sum = 0;
    for (const b of h) sum += b;
    field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(h, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

/** Read a tar.gz back into {name, data} — used by tests and the release viewer. */
export function untarGz(buf) {
  const raw = zlib.gunzipSync(buf);
  const out = [];
  for (let off = 0; off + 512 <= raw.length;) {
    const h = raw.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const prefix = str(345, 500);
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    out.push({ name, data: raw.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const PACK_SKIP = /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv)(\/|$)|(^|\/)\.env(\..*)?$/;
export function packageProject(id) {
  const p = projectRow(id);
  const files = walk(p, { limit: 20_000 }).filter((f) => !PACK_SKIP.test(f.path) || f.path.endsWith('.env.example'));
  const entries = files.map((f) => ({ name: f.path, data: fs.readFileSync(path.join(projectDir(p), f.path)), mode: /\.(sh)$/.test(f.path) ? 0o755 : 0o644 }));
  return { buffer: tarGz(entries), files: entries.length, commit: gitLog(p, 1)[0]?.sha || null };
}

// ---------------------------------------------------------------- preview --

const previews = new Map();   // slug → { child, port, log, startedAt, command }
const PREVIEW_SECRET = crypto.randomBytes(32);

export function previewToken(slug, hours = 12) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const mac = crypto.createHmac('sha256', PREVIEW_SECRET).update(`${slug}:${exp}`).digest('base64url').slice(0, 32);
  return `${exp}.${mac}`;
}
export function checkPreviewToken(slug, token) {
  const [exp, mac] = String(token || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  const want = crypto.createHmac('sha256', PREVIEW_SECRET).update(`${slug}:${exp}`).digest('base64url').slice(0, 32);
  return want.length === mac.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac));
}

function staticRoot(p) {
  const dir = projectDir(p);
  for (const sub of ['dist', 'build', 'public', 'site', '']) {
    if (fs.existsSync(path.join(dir, sub, 'index.html'))) return path.join(dir, sub);
  }
  return dir;
}

export function previewState(p) {
  const pv = previews.get(p.slug);
  const live = pv && pv.child.exitCode === null;
  return {
    mode: live ? 'process' : (['static-site', 'website', 'blank'].includes(p.kind) || fs.existsSync(path.join(staticRoot(p), 'index.html')) ? 'static' : 'none'),
    running: Boolean(live),
    port: live ? pv.port : null,
    command: live ? pv.command : null,
    startedAt: live ? pv.startedAt : null,
    url: `/preview/${p.slug}/?pt=${previewToken(p.slug)}`,
  };
}

function freePort(start = 4610) {
  return new Promise((resolve) => {
    const tryPort = (n) => {
      const s = net.createServer();
      s.once('error', () => tryPort(n + 1));
      s.once('listening', () => s.close(() => resolve(n)));
      s.listen(n, '127.0.0.1');
    };
    tryPort(start);
  });
}

function startCommandFor(p) {
  const dir = projectDir(p);
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    const scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {};
    if (scripts.dev) return ['npm', 'run', 'dev'];
    if (scripts.start) return ['npm', 'start'];
  }
  if (fs.existsSync(path.join(dir, 'app.py'))) return ['python', 'app.py'];
  if (fs.existsSync(path.join(dir, 'main.py'))) return ['python', 'main.py'];
  return null;
}

export async function startPreview(id, { actor }) {
  const p = projectRow(id);
  stopPreview(id, { actor, quiet: true });
  const argv = startCommandFor(p);
  if (!argv) return previewState(p);      // static: served straight from disk
  checkCommand(argv);
  const port = await freePort();
  const child = spawn(argv[0], argv.slice(1), { cwd: projectDir(p), windowsHide: true, shell: IS_WIN, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' } });
  const pv = { child, port, log: '', startedAt: now(), command: argv.join(' ') };
  const take = (d) => { pv.log = (pv.log + d.toString('utf8')).slice(-40_000); };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  child.on('error', (e) => take(`\n${e.message}`));
  previews.set(p.slug, pv);
  audit({ actorType: 'human', actorId: actor, action: 'forge.preview_started', subjectType: 'forgeProject', subjectId: p.id, payload: { port, command: pv.command } });
  return previewState(p);
}

export function stopPreview(id, { actor, quiet = false }) {
  const p = projectRow(id);
  const pv = previews.get(p.slug);
  if (pv) {
    try { pv.child.kill(); } catch { /* already gone */ }
    previews.delete(p.slug);
    if (!quiet) audit({ actorType: 'human', actorId: actor, action: 'forge.preview_stopped', subjectType: 'forgeProject', subjectId: p.id });
  }
  return previewState(p);
}

export function previewLog(id) {
  const p = projectRow(id);
  return { ...previewState(p), log: previews.get(p.slug)?.log || '' };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

/**
 * GET /preview/<slug>/<path>. Authenticated by a signed token in the query the
 * first time and a cookie scoped to this preview after that, because an iframe
 * cannot send the console's header and its assets cannot carry a query.
 */
export function servePreview(req, res, url) {
  const m = url.pathname.match(/^\/preview\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return false;
  const slug = m[1];
  const rest = m[2] || '/';
  const cookie = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`acpv_${slug.replace(/-/g, '_')}=`))?.split('=')[1];
  const token = url.searchParams.get('pt') || cookie;
  if (!checkPreviewToken(slug, token)) { res.writeHead(401, { 'content-type': 'text/plain' }); res.end('preview link expired — open it again from the factory'); return true; }
  if (!m[2]) { res.writeHead(302, { location: `/preview/${slug}/${url.search}` }); res.end(); return true; }
  const headers = { 'set-cookie': `acpv_${slug.replace(/-/g, '_')}=${token}; Path=/preview/${slug}/; HttpOnly; SameSite=Strict; Max-Age=43200`, 'x-robots-tag': 'noindex', 'cache-control': 'no-store' };
  const p = one('SELECT * FROM forge_projects WHERE slug = ?', slug);
  if (!p) { res.writeHead(404); res.end('no such project'); return true; }
  const pv = previews.get(slug);
  if (pv && pv.child.exitCode === null) {
    const search = new URLSearchParams(url.search); search.delete('pt');
    const up = http.request({ host: '127.0.0.1', port: pv.port, method: req.method, path: rest + (search.toString() ? `?${search}` : ''), headers: { ...req.headers, host: `127.0.0.1:${pv.port}` } }, (r) => {
      res.writeHead(r.statusCode || 502, { ...r.headers, ...headers });
      r.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain', ...headers }); res.end(`the preview process is not answering yet: ${e.message}`); } });
    req.pipe(up);
    return true;
  }
  const root = staticRoot(p);
  let file = path.resolve(root, `.${decodeURIComponent(rest)}`);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return true; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (fs.existsSync(path.join(root, '404.html'))) file = path.join(root, '404.html');
    else { res.writeHead(404, { 'content-type': 'text/plain', ...headers }); res.end('not found'); return true; }
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ...headers });
  res.end(fs.readFileSync(file));
  return true;
}

export function stopAllPreviews() {
  for (const pv of previews.values()) { try { pv.child.kill(); } catch { /* gone */ } }
  previews.clear();
  for (const child of running.values()) { try { child.kill(); } catch { /* gone */ } }
}

// --------------------------------------------------------------- overview --

export function forgeOverview() {
  const n = (sql, ...a) => one(sql, ...a).n;
  return {
    projects: n("SELECT COUNT(*) AS n FROM forge_projects WHERE state = 'active'"),
    proposed: n("SELECT COUNT(*) AS n FROM forge_changes WHERE state = 'proposed'"),
    drafting: n("SELECT COUNT(*) AS n FROM forge_changes WHERE state = 'drafting'"),
    applied: n("SELECT COUNT(*) AS n FROM forge_changes WHERE state = 'applied'"),
    commandsToday: n("SELECT COUNT(*) AS n FROM forge_commands WHERE started_at >= date('now')"),
    failingToday: n("SELECT COUNT(*) AS n FROM forge_commands WHERE started_at >= date('now') AND state = 'failed'"),
    previews: [...previews.values()].filter((pv) => pv.child.exitCode === null).length,
    git: gitAvailable(),
    kinds: Object.entries(KINDS).map(([id, k]) => ({ id, ...k })),
    bins: allowedBins(),
  };
}
