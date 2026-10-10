// Deployments — a project from the factory, put on a server, kept running.
//
// A target says where a project lives: which server, which directory, which
// runtime, which domain. A release is one trip there: the project is packaged
// here, carried over the same connection the fleet uses, unpacked into a
// directory of its own, and only then does the `current` link move. So a
// release that fails halfway leaves the previous one serving, and a rollback is
// moving a link back — not rebuilding anything.
//
// The script that runs on the server is generated here and shown before it
// runs. Nothing about a deployment is hidden in a template on the far side.
//
// A release to a production server asked for by anybody but a person waits
// for a person. Staging and development do not wait.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { seal, open } from './vault.js';
import { projectRow, packageProject, walk } from './forge.js';
import { serverRow, run, upload } from './servers.js';
import { ensureMonitorForTarget } from './monitor.js';
import { getSetting, setSetting } from './settings.js';
import { qualityGate } from './engineering/reviews.js';

exec(`CREATE TABLE IF NOT EXISTS dep_targets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  project_id    INTEGER NOT NULL REFERENCES forge_projects(id),
  server_id     INTEGER NOT NULL REFERENCES srv_servers(id),
  runtime       TEXT NOT NULL DEFAULT 'node',      -- node|python|static|docker
  remote_dir    TEXT NOT NULL,
  domain        TEXT,
  port          INTEGER,
  start_command TEXT,
  health_path   TEXT NOT NULL DEFAULT '/',
  env_sealed    TEXT,                              -- KEY=VALUE lines, sealed by the vault key
  ssl           INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'new',       -- new|live|failed|deploying
  current_release INTEGER,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec(`CREATE TABLE IF NOT EXISTS dep_releases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id    INTEGER NOT NULL REFERENCES dep_targets(id),
  version      TEXT NOT NULL,
  commit_sha   TEXT,
  kind         TEXT NOT NULL DEFAULT 'deploy',     -- deploy|rollback
  state        TEXT NOT NULL DEFAULT 'running',    -- awaiting_approval|running|live|failed|superseded|refused
  log          TEXT NOT NULL DEFAULT '',
  bytes        INTEGER,
  requested_by TEXT NOT NULL,
  approved_by  TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  duration_ms  INTEGER
)`);
exec('CREATE INDEX IF NOT EXISTS dep_releases_target ON dep_releases (target_id, id)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
// One Let's Encrypt account per company, kept as a setting rather than a column
// on every target: it is the company's address for expiry notices.
const acmeEmail = () => getSetting('ACME_EMAIL') || null;
function rememberAcme(email) {
  if (!email) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) refuse("that is not an email address for Let's Encrypt");
  setSetting('ACME_EMAIL', String(email).trim());
}
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
export const RUNTIMES = {
  node: { label: 'Node.js (systemd)', port: 3000 },
  python: { label: 'Python (systemd)', port: 8000 },
  static: { label: 'Static files (nginx)', port: null },
  docker: { label: 'Docker container', port: 3000 },
};

// ---------------------------------------------------------------- targets --

function parseEnv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of lines) if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)) refuse(`not a KEY=VALUE line: ${l.slice(0, 40)}`);
  return lines.join('\n');
}

export function targetRow(id) {
  const t = one('SELECT * FROM dep_targets WHERE id = ?', Number(id));
  if (!t) refuse('no such deployment target', 404);
  return t;
}

const view = (t) => {
  const envKeys = t.env_sealed ? (() => { try { return open(t.env_sealed).split('\n').map((l) => l.split('=')[0]).filter(Boolean); } catch { return ['(sealed under another key)']; } })() : [];
  const project = one('SELECT id, slug, name, kind FROM forge_projects WHERE id = ?', t.project_id);
  const server = one('SELECT id, name, environment, host, state FROM srv_servers WHERE id = ?', t.server_id);
  return { ...t, env_sealed: undefined, envKeys, project, server, url: t.domain ? `${t.ssl ? 'https' : 'http'}://${t.domain}` : null };
};

export function createTarget({ name, projectId, serverId, runtime = 'node', remoteDir = null, domain = null, port = null, startCommand = null, healthPath = '/', env = '', ssl = false, sslEmail = null, actor }) {
  const p = projectRow(projectId);
  const s = serverRow(serverId);
  if (!RUNTIMES[runtime]) refuse(`runtime must be one of: ${Object.keys(RUNTIMES).join(', ')}`);
  if (domain && !/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) refuse('that is not a domain name');
  const dir = remoteDir || `/srv/apps/${p.slug}`;
  if (!/^\/[\w./-]+$/.test(dir) || dir.includes('..')) refuse('the remote directory must be an absolute path of plain characters');
  const prt = runtime === 'static' ? null : Number(port || RUNTIMES[runtime].port);
  if (prt !== null && !(prt > 1023 && prt < 65536)) refuse('the port must be between 1024 and 65535');
  if (ssl && !domain) refuse('HTTPS needs a domain');
  if (ssl) rememberAcme(sslEmail);
  if (ssl && !acmeEmail()) refuse("HTTPS needs an email address for Let's Encrypt");
  if (startCommand && /[\n\r]/.test(startCommand)) refuse('the start command is one line');
  if (!/^\/[\w./?=&-]*$/.test(healthPath || '/')) refuse('the health path must start with /');
  const envText = parseEnv(env);
  exec(`INSERT INTO dep_targets (name, project_id, server_id, runtime, remote_dir, domain, port, start_command, health_path, env_sealed, ssl, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  String(name || `${p.name} on ${s.name}`).slice(0, 80), p.id, s.id, runtime, dir, domain ? domain.toLowerCase() : null, prt, startCommand || null,
  healthPath || '/', envText ? seal(envText) : null, ssl ? 1 : 0, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'deploy.target_created', subjectType: 'deployTarget', subjectId: id, payload: { project: p.slug, server: s.name, runtime, domain } });
  return getTarget(id);
}

export function updateTarget(id, { domain, port, startCommand, healthPath, env, ssl, sslEmail, actor }) {
  const t = targetRow(id);
  if (domain && !/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) refuse('that is not a domain name');
  const envText = env === undefined ? undefined : parseEnv(env);
  if (sslEmail) rememberAcme(sslEmail);
  exec(`UPDATE dep_targets SET domain = COALESCE(?, domain), port = COALESCE(?, port), start_command = COALESCE(?, start_command),
        health_path = COALESCE(?, health_path), env_sealed = CASE WHEN ? THEN ? ELSE env_sealed END, ssl = COALESCE(?, ssl) WHERE id = ?`,
  domain || null, port ? Number(port) : null, startCommand || null, healthPath || null, envText === undefined ? 0 : 1, envText ? seal(envText) : null,
  ssl === undefined ? null : (ssl ? 1 : 0), t.id);
  audit({ actorType: 'human', actorId: actor, action: 'deploy.target_updated', subjectType: 'deployTarget', subjectId: t.id, payload: { envChanged: envText !== undefined } });
  return getTarget(t.id);
}

export function removeTarget(id, { actor }) {
  const t = targetRow(id);
  exec('DELETE FROM dep_releases WHERE target_id = ?', t.id);
  exec('DELETE FROM dep_targets WHERE id = ?', t.id);
  audit({ actorType: 'human', actorId: actor, action: 'deploy.target_removed', subjectType: 'deployTarget', subjectId: t.id, payload: { name: t.name } });
  return { ok: true, note: 'The files and the service on the server are left in place — remove them there if they should go.' };
}

export function listTargets() {
  return q('SELECT * FROM dep_targets ORDER BY id DESC').map((t) => ({
    ...view(t),
    last: one('SELECT id, version, state, kind, started_at, requested_by FROM dep_releases WHERE target_id = ? ORDER BY id DESC LIMIT 1', t.id) || null,
  }));
}

export function getTarget(id) {
  const t = targetRow(id);
  return {
    ...view(t),
    releases: q('SELECT id, version, commit_sha, kind, state, bytes, requested_by, approved_by, started_at, ended_at, duration_ms FROM dep_releases WHERE target_id = ? ORDER BY id DESC LIMIT 30', t.id),
    plan: plan(t),
  };
}

export function getRelease(id) {
  const r = one('SELECT * FROM dep_releases WHERE id = ?', Number(id));
  if (!r) refuse('no such release', 404);
  return r;
}

// -------------------------------------------------------------- the plan --

const svcName = (p) => `ac-${p.slug}`;

/** Where a static site's files are inside the project. */
function staticSubdir(p) {
  const files = new Set(walk(p, { limit: 20_000 }).map((f) => f.path));
  for (const sub of ['dist', 'build', 'public', 'site']) if (files.has(`${sub}/index.html`)) return sub;
  return '';
}

function unitFile(t, p, s) {
  const dir = t.remote_dir;
  const start = t.start_command
    || (t.runtime === 'python' ? `${dir}/current/.venv/bin/python ${dir}/current/app.py` : '/usr/bin/env npm start');
  const user = s.transport === 'ssh' && s.username && s.username !== 'root' ? `User=${s.username}\n` : '';
  return `[Unit]
Description=${p.name} (deployed by AlphaCore)
After=network.target

[Service]
Type=simple
WorkingDirectory=${dir}/current
EnvironmentFile=-${dir}/current/.env
Environment=PORT=${t.port}
Environment=NODE_ENV=production
ExecStart=${start}
Restart=always
RestartSec=3
${user}
[Install]
WantedBy=multi-user.target
`;
}

function nginxConf(t, p) {
  const name = t.domain || '_';
  if (t.runtime === 'static') {
    const sub = staticSubdir(p);
    return `server {
    listen 80;
    server_name ${name};
    root ${t.remote_dir}/current${sub ? `/${sub}` : ''};
    index index.html;
    location / { try_files $uri $uri/ $uri.html /index.html; }
    location ~* \\.(css|js|svg|png|jpg|jpeg|gif|webp|woff2)$ { expires 7d; add_header Cache-Control "public"; }
}
`;
  }
  return `server {
    listen 80;
    server_name ${name};
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:${t.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

/** The script that runs on the server for one release. Shown before it runs. */
export function releaseScript(t, p, s, version, envText = '') {
  const dir = t.remote_dir;
  const svc = svcName(p);
  const lines = [
    'set -e',
    'SUDO=$([ "$(id -u)" = 0 ] || echo sudo -n)',
    `DIR='${dir}'`,
    `REL="$DIR/releases/${version}"`,
    'echo "→ unpacking $REL"',
    'mkdir -p "$REL"',
    'tar xzf "$REL.tar.gz" -C "$REL" && rm -f "$REL.tar.gz"',
  ];
  if (envText) lines.push(`echo '${b64(envText)}' | base64 -d > "$REL/.env"`, 'chmod 600 "$REL/.env"');
  if (t.runtime === 'node') {
    lines.push(
      'cd "$REL"',
      'if [ -f package.json ]; then',
      '  if grep -q \'"build"\' package.json; then echo "→ building"; npm install --no-audit --no-fund && npm run build; fi',
      '  echo "→ installing production dependencies"',
      '  if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi',
      'fi',
    );
  }
  if (t.runtime === 'python') {
    lines.push('cd "$REL"', 'echo "→ creating virtualenv"', 'python3 -m venv .venv', '[ -f requirements.txt ] && .venv/bin/pip install -q -r requirements.txt || true');
  }
  lines.push('ln -sfn "$REL" "$DIR/current.next" && mv -Tf "$DIR/current.next" "$DIR/current"', 'echo "→ current is now $(readlink "$DIR/current")"');
  if (t.runtime === 'node' || t.runtime === 'python') {
    lines.push(
      `echo '${b64(unitFile(t, p, s))}' | base64 -d | $SUDO tee /etc/systemd/system/${svc}.service >/dev/null`,
      '$SUDO systemctl daemon-reload',
      `$SUDO systemctl enable ${svc} >/dev/null 2>&1 || true`,
      `$SUDO systemctl restart ${svc}`,
      `echo "→ ${svc} restarted"`,
    );
  }
  if (t.runtime === 'docker') {
    lines.push(
      'cd "$REL"',
      `$SUDO docker build -t ${svc}:${version} .`,
      `$SUDO docker rm -f ${svc} >/dev/null 2>&1 || true`,
      `$SUDO docker run -d --name ${svc} --restart unless-stopped ${envText ? '--env-file "$REL/.env" ' : ''}-e PORT=${t.port} -p 127.0.0.1:${t.port}:${t.port} ${svc}:${version}`,
      `echo "→ container ${svc} running ${version}"`,
    );
  }
  if (t.domain || t.runtime === 'static') {
    lines.push(
      'if command -v nginx >/dev/null 2>&1; then',
      `  echo '${b64(nginxConf(t, p))}' | base64 -d | $SUDO tee /etc/nginx/sites-available/${svc}.conf >/dev/null`,
      `  $SUDO ln -sfn /etc/nginx/sites-available/${svc}.conf /etc/nginx/sites-enabled/${svc}.conf`,
      '  $SUDO nginx -t && $SUDO systemctl reload nginx && echo "→ nginx reloaded"',
      'else echo "! nginx is not installed — provision it from the server page to serve a domain"; fi',
    );
  }
  if (t.ssl && t.domain) {
    lines.push(
      `if command -v certbot >/dev/null 2>&1; then $SUDO certbot --nginx -d ${t.domain} --non-interactive --agree-tos -m ${acmeEmail()} --redirect --keep-until-expiring || echo "! certbot could not issue a certificate yet (is DNS pointing here?)"; else echo "! certbot is not installed"; fi`,
    );
  }
  const probe = t.runtime === 'static'
    ? `curl -fsS -o /dev/null -w '%{http_code}' -H 'Host: ${t.domain || 'localhost'}' http://127.0.0.1/`
    : `curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:${t.port}${t.health_path || '/'}`;
  lines.push(
    'echo "→ health check"',
    'ok=""',
    `for i in $(seq 1 20); do code=$(${probe} 2>/dev/null || true); if [ -n "$code" ] && [ "$code" -lt 500 ]; then ok=1; echo "  answered $code"; break; fi; sleep 2; done`,
    `[ -n "$ok" ] || { echo "! no healthy answer after 40s"; ${t.runtime === 'docker' ? `$SUDO docker logs --tail 40 ${svc} 2>&1 || true;` : t.runtime === 'static' ? '' : `$SUDO journalctl -u ${svc} -n 40 --no-pager 2>&1 || true;`} exit 7; }`,
    'ls -1dt "$DIR"/releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf',
    'echo "AC-RELEASE-OK"',
  );
  return lines.join('\n');
}

export function plan(t) {
  const p = projectRow(t.project_id);
  const s = serverRow(t.server_id);
  return {
    script: releaseScript(t, p, s, 'YYYYMMDDHHMMSS', t.env_sealed ? '(sealed environment)' : ''),
    unit: ['node', 'python'].includes(t.runtime) ? unitFile(t, p, s) : null,
    nginx: t.domain || t.runtime === 'static' ? nginxConf(t, p) : null,
    service: svcName(p),
  };
}

// --------------------------------------------------------------- releases --

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
function appendLog(id, text) {
  exec('UPDATE dep_releases SET log = substr(log || ?, -200000) WHERE id = ?', `${text}\n`, id);
}

/**
 * Deploy the project's current state. A person's release starts now; anybody
 * else's to a production server waits for a person.
 */
export async function deploy(targetId, { actor }) {
  const t = targetRow(targetId);
  const s = serverRow(t.server_id);
  if (one("SELECT id FROM dep_releases WHERE target_id = ? AND state = 'running'", t.id)) refuse('a release to this target is already running');
  // The review board's verdict travels with every production release. In
  // `enforce` it can stop one; in `warn` it is only written down — but written
  // down on the chain, so "we shipped it knowing" is a fact rather than a memory.
  const gate = s.environment === 'production' ? qualityGate(t.project_id) : null;
  if (gate && !gate.ok) refuse(`the quality gate holds this release: ${gate.why}. Fix or dismiss the findings, review again, then deploy.`, 409);
  const waiting = s.environment === 'production' && !isHuman(actor);
  exec('INSERT INTO dep_releases (target_id, version, state, requested_by) VALUES (?,?,?,?)', t.id, stamp(), waiting ? 'awaiting_approval' : 'running', actor);
  const rel = one('SELECT * FROM dep_releases WHERE id = last_insert_rowid()');
  audit({ actorType: isHuman(actor) ? 'human' : 'agent', actorId: actor, action: waiting ? 'deploy.release_requested' : 'deploy.release_started', subjectType: 'deployTarget', subjectId: t.id, payload: { releaseId: rel.id, server: s.name, environment: s.environment, gate: gate ? { mode: gate.mode, state: gate.state, reviewId: gate.reviewId || null } : null } });
  if (waiting) {
    notify({ level: 'warn', source: 'deploy', message: `${actor} wants to release ${t.name} to production (${s.name}). A person must approve it.`, subjectType: 'deployTarget', subjectId: t.id });
    return rel;
  }
  // Runs on; the console polls the release for its log.
  perform(rel.id).catch(() => { /* recorded on the row */ });
  return rel;
}

export async function decideRelease(releaseId, { approve, actor }) {
  if (!isHuman(actor)) refuse('only a person approves a production release');
  const r = getRelease(releaseId);
  if (r.state !== 'awaiting_approval') refuse(`this release is ${r.state}`);
  if (!approve) {
    exec("UPDATE dep_releases SET state = 'refused', approved_by = ?, ended_at = datetime('now') WHERE id = ?", actor, r.id);
    audit({ actorType: 'human', actorId: actor, action: 'deploy.release_refused', subjectType: 'deployTarget', subjectId: r.target_id, payload: { releaseId: r.id } });
    return getRelease(r.id);
  }
  exec("UPDATE dep_releases SET state = 'running', approved_by = ?, started_at = datetime('now') WHERE id = ?", actor, r.id);
  audit({ actorType: 'human', actorId: actor, action: 'deploy.release_approved', subjectType: 'deployTarget', subjectId: r.target_id, payload: { releaseId: r.id } });
  perform(r.id).catch(() => { /* recorded */ });
  return getRelease(r.id);
}

async function perform(releaseId) {
  const rel = getRelease(releaseId);
  const t = targetRow(rel.target_id);
  const p = projectRow(t.project_id);
  const s = serverRow(t.server_id);
  const started = Date.now();
  exec("UPDATE dep_targets SET state = 'deploying' WHERE id = ?", t.id);
  const fail = (why) => {
    appendLog(rel.id, `✗ ${why}`);
    exec("UPDATE dep_releases SET state = 'failed', ended_at = datetime('now'), duration_ms = ? WHERE id = ?", Date.now() - started, rel.id);
    exec("UPDATE dep_targets SET state = CASE WHEN current_release IS NULL THEN 'failed' ELSE 'live' END WHERE id = ?", t.id);
    notify({ level: 'error', source: 'deploy', message: `Release of ${t.name} failed: ${why.slice(0, 160)}`, subjectType: 'deployTarget', subjectId: t.id });
    audit({ actorType: 'system', actorId: 'system:deploy', action: 'deploy.release_failed', subjectType: 'deployTarget', subjectId: t.id, payload: { releaseId: rel.id } });
  };
  try {
    appendLog(rel.id, `→ packaging ${p.name}`);
    const pkg = packageProject(p.id);
    exec('UPDATE dep_releases SET commit_sha = ?, bytes = ? WHERE id = ?', pkg.commit, pkg.buffer.length, rel.id);
    appendLog(rel.id, `  ${pkg.files} files, ${(pkg.buffer.length / 1024).toFixed(1)} KB${pkg.commit ? `, commit ${pkg.commit}` : ''}`);
    appendLog(rel.id, `→ uploading to ${s.name}:${t.remote_dir}/releases/${rel.version}.tar.gz`);
    const up = await upload(s, `${t.remote_dir}/releases/${rel.version}.tar.gz`, pkg.buffer);
    if (up.code !== 0) return fail(`upload failed: ${(up.stderr || '').trim().slice(0, 400)}`);
    const envText = t.env_sealed ? open(t.env_sealed) : '';
    const r = await run(s, releaseScript(t, p, s, rel.version, envText), { timeoutMs: 20 * 60_000 });
    appendLog(rel.id, `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim());
    if (r.code !== 0 || !r.stdout.includes('AC-RELEASE-OK')) return fail(`the release script stopped (exit ${r.code})`);
    exec("UPDATE dep_releases SET state = 'superseded' WHERE target_id = ? AND state = 'live'", t.id);
    exec("UPDATE dep_releases SET state = 'live', ended_at = datetime('now'), duration_ms = ? WHERE id = ?", Date.now() - started, rel.id);
    exec("UPDATE dep_targets SET state = 'live', current_release = ? WHERE id = ?", rel.id, t.id);
    appendLog(rel.id, '✓ live');
    audit({ actorType: 'system', actorId: 'system:deploy', action: 'deploy.release_live', subjectType: 'deployTarget', subjectId: t.id, payload: { releaseId: rel.id, version: rel.version, commit: pkg.commit } });
    notify({ level: 'info', source: 'deploy', message: `${t.name} is live (${rel.version}).`, subjectType: 'deployTarget', subjectId: t.id });
    try { ensureMonitorForTarget(targetRow(t.id)); } catch { /* monitoring is a courtesy */ }
  } catch (e) {
    fail(e.message || String(e));
  }
}

/** Move `current` back to the release before it and restart. */
export async function rollback(targetId, { actor }) {
  if (!isHuman(actor)) refuse('only a person rolls a release back');
  const t = targetRow(targetId);
  const p = projectRow(t.project_id);
  const s = serverRow(t.server_id);
  const svc = svcName(p);
  exec("INSERT INTO dep_releases (target_id, version, kind, state, requested_by, approved_by) VALUES (?,?, 'rollback', 'running', ?, ?)", t.id, stamp(), actor, actor);
  const rel = one('SELECT * FROM dep_releases WHERE id = last_insert_rowid()');
  const restart = t.runtime === 'docker'
    ? `V=$(basename "$PREV"); $SUDO docker rm -f ${svc} >/dev/null 2>&1 || true; $SUDO docker run -d --name ${svc} --restart unless-stopped -e PORT=${t.port} -p 127.0.0.1:${t.port}:${t.port} ${svc}:$V`
    : t.runtime === 'static' ? '$SUDO systemctl reload nginx || true' : `$SUDO systemctl restart ${svc}`;
  const script = `set -e
SUDO=$([ "$(id -u)" = 0 ] || echo sudo -n)
DIR='${t.remote_dir}'
CUR=$(readlink -f "$DIR/current")
PREV=$(ls -1dt "$DIR"/releases/*/ | sed 's:/$::' | while read -r d; do [ "$(readlink -f "$d")" = "$CUR" ] && continue; echo "$d"; break; done)
[ -n "$PREV" ] || { echo "! there is no earlier release to go back to"; exit 3; }
ln -sfn "$PREV" "$DIR/current.next" && mv -Tf "$DIR/current.next" "$DIR/current"
${restart}
echo "→ current is now $PREV"
echo "AC-RELEASE-OK"`;
  audit({ actorType: 'human', actorId: actor, action: 'deploy.rollback_started', subjectType: 'deployTarget', subjectId: t.id, payload: { releaseId: rel.id } });
  const started = Date.now();
  const r = await run(s, script, { timeoutMs: 5 * 60_000 });
  appendLog(rel.id, `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim());
  const ok = r.code === 0 && r.stdout.includes('AC-RELEASE-OK');
  if (ok) exec("UPDATE dep_releases SET state = 'superseded' WHERE target_id = ? AND state = 'live'", t.id);
  exec("UPDATE dep_releases SET state = ?, ended_at = datetime('now'), duration_ms = ? WHERE id = ?", ok ? 'live' : 'failed', Date.now() - started, rel.id);
  if (ok) exec('UPDATE dep_targets SET current_release = ? WHERE id = ?', rel.id, t.id);
  notify({ level: ok ? 'info' : 'error', source: 'deploy', message: ok ? `${t.name} rolled back.` : `Rollback of ${t.name} failed.`, subjectType: 'deployTarget', subjectId: t.id });
  return getRelease(rel.id);
}

export function pendingReleases() {
  return q(`SELECT r.id, r.version, r.requested_by, r.started_at, t.name AS target, t.id AS target_id, s.name AS server
            FROM dep_releases r JOIN dep_targets t ON t.id = r.target_id JOIN srv_servers s ON s.id = t.server_id
            WHERE r.state = 'awaiting_approval' ORDER BY r.id`);
}

export function deployOverview() {
  const n = (sql) => one(sql).n;
  return {
    targets: n('SELECT COUNT(*) AS n FROM dep_targets'),
    live: n("SELECT COUNT(*) AS n FROM dep_targets WHERE state = 'live'"),
    failing: n("SELECT COUNT(*) AS n FROM dep_targets WHERE state = 'failed'"),
    releasesWeek: n("SELECT COUNT(*) AS n FROM dep_releases WHERE started_at >= datetime('now','-7 days')"),
    failedWeek: n("SELECT COUNT(*) AS n FROM dep_releases WHERE started_at >= datetime('now','-7 days') AND state = 'failed'"),
    running: n("SELECT COUNT(*) AS n FROM dep_releases WHERE state = 'running'"),
    pending: pendingReleases().length,
    runtimes: Object.entries(RUNTIMES).map(([id, r]) => ({ id, ...r })),
  };
}
