// The fleet — every machine the company runs software on.
//
// A server is reached one of two ways:
//
//   ssh     the system's own OpenSSH client, with a private key that lives in
//           the vault and touches the disk only for the length of one call, in
//           a file only this user can read, deleted in a finally.
//   local   this very machine — the box AlphaCore itself runs on. Useful on a
//           VPS where the console and the apps share a host.
//
// Every command that runs on a server is a row before it starts and a result
// after it ends, and an entry on the chain. A person running a command is a
// named human acting. An AI employee asking to run one is a request that waits
// for a person — the same rule as money: an agent may prepare, a human decides.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { putSecret, getSecret, hasSecret, dropSecret } from './vault.js';
import { enqueueRun } from './workflow.js';
import { openPii } from './erasure.js';
import { ROOT } from './env.js';

exec(`CREATE TABLE IF NOT EXISTS srv_servers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  transport    TEXT NOT NULL DEFAULT 'ssh',        -- ssh|local
  host         TEXT,
  port         INTEGER NOT NULL DEFAULT 22,
  username     TEXT,
  key_secret   TEXT,                               -- vault name of the private key
  environment  TEXT NOT NULL DEFAULT 'production', -- production|staging|development
  provider     TEXT,
  region       TEXT,
  notes        TEXT,
  state        TEXT NOT NULL DEFAULT 'unknown',    -- unknown|online|offline
  os           TEXT,
  last_seen    TEXT,
  last_error   TEXT,
  last_metrics TEXT,                               -- JSON
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)`);
exec(`CREATE TABLE IF NOT EXISTS srv_commands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id    INTEGER NOT NULL REFERENCES srv_servers(id),
  command      TEXT NOT NULL,
  purpose      TEXT,
  state        TEXT NOT NULL DEFAULT 'running',    -- awaiting_approval|running|ok|failed|refused
  exit_code    INTEGER,
  output       TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  approved_by  TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  duration_ms  INTEGER
)`);
exec(`CREATE TABLE IF NOT EXISTS srv_metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id  INTEGER NOT NULL REFERENCES srv_servers(id),
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  cpu_pct    REAL, mem_pct REAL, disk_pct REAL, load1 REAL
)`);
exec('CREATE INDEX IF NOT EXISTS srv_metrics_server ON srv_metrics (server_id, at)');
exec('CREATE INDEX IF NOT EXISTS srv_commands_server ON srv_commands (server_id, id)');

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const KNOWN_HOSTS = path.join(ROOT, 'data', 'known_hosts');

// ------------------------------------------------------------- transport --

/** Swappable for the tests, which have no server to talk to. */
let transportImpl = null;
export function setTransport(fn) { transportImpl = fn; }

// Asked once and remembered when the answer is yes: a busy machine can miss a
// short timeout, and "bash is not available" on the second call of a session
// that already used it is a lie.
let bashOk = false;
function bashAvailable() {
  if (bashOk) return true;
  try { bashOk = spawnSync('bash', ['-c', 'echo ok'], { windowsHide: true, timeout: 15_000, encoding: 'utf8' }).stdout.trim() === 'ok'; } catch { bashOk = false; }
  return bashOk;
}

/**
 * Run a bash script on a server. Resolves to {code, stdout, stderr}; never
 * rejects — a server that cannot be reached is an answer, not an exception.
 */
export function run(server, script, { timeoutMs = 120_000, input = null } = {}) {
  if (transportImpl) return Promise.resolve(transportImpl(server, script, { input }));
  return new Promise((resolve) => {
    let keyFile = null;
    let argv;
    let stdinPayload;
    if (server.transport === 'local') {
      if (!bashAvailable()) return resolve({ code: 127, stdout: '', stderr: 'bash is not available on this machine — a local server needs Linux, macOS or Git Bash' });
      argv = ['bash', ['-s']];
      stdinPayload = input ? null : script;
    } else {
      if (!server.host || !server.username) return resolve({ code: 255, stdout: '', stderr: 'host and username are required' });
      const key = server.key_secret ? getSecret(server.key_secret) : null;
      const args = ['-p', String(server.port || 22), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12',
        '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`, '-o', 'ServerAliveInterval=15'];
      if (key) {
        keyFile = path.join(os.tmpdir(), `ac-${crypto.randomBytes(8).toString('hex')}`);
        fs.writeFileSync(keyFile, key.endsWith('\n') ? key : `${key}\n`, { mode: 0o600 });
        if (process.platform === 'win32') {
          // OpenSSH on Windows refuses a key other users can read; the temp file
          // inherits the folder's ACL, so it is narrowed to this account.
          spawnSync('icacls', [keyFile, '/inheritance:r', '/grant:r', `${os.userInfo().username}:R`], { windowsHide: true });
        }
        args.push('-i', keyFile, '-o', 'IdentitiesOnly=yes');
      }
      // With input to upload, the script travels as the remote command and the
      // bytes travel on stdin; otherwise the script itself is stdin.
      args.push(`${server.username}@${server.host}`, input ? script : 'bash -s');
      argv = ['ssh', args];
      stdinPayload = input ? null : script;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const end = (code, extra = '') => {
      if (done) return;
      done = true;
      if (keyFile) { try { fs.rmSync(keyFile, { force: true }); } catch { /* best effort */ } }
      resolve({ code, stdout, stderr: stderr + extra });
    };
    let child;
    try {
      child = spawn(argv[0], argv[1], { windowsHide: true, env: { ...process.env, LC_ALL: 'C' } });
    } catch (e) { return end(127, e.message); }
    const timer = setTimeout(() => { child.kill(); end(124, `\n[timed out after ${Math.round(timeoutMs / 1000)}s]`); }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (d) => { stdout = (stdout + d).slice(-400_000); });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-100_000); });
    child.on('error', (e) => { clearTimeout(timer); end(127, e.code === 'ENOENT' ? `${argv[0]} is not installed on this machine` : e.message); });
    child.on('close', (code) => { clearTimeout(timer); end(code ?? -1); });
    child.stdin.on('error', () => { /* the far end closed early; the exit code says why */ });
    child.stdin.end(input ?? stdinPayload ?? '');
  });
}

/** Write bytes to a path on the server. */
export function upload(server, remotePath, buffer, { timeoutMs = 10 * 60_000 } = {}) {
  if (!/^[\w./-]+$/.test(remotePath)) refuse(`refused a remote path with unusual characters: ${remotePath}`);
  const script = `mkdir -p "$(dirname '${remotePath}')" && cat > '${remotePath}'`;
  if (server.transport === 'local' && !transportImpl) {
    fs.mkdirSync(path.dirname(remotePath), { recursive: true });
    fs.writeFileSync(remotePath, buffer);
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  }
  return run(server, script, { input: buffer, timeoutMs });
}

// ---------------------------------------------------------------- servers --

/** Deployment targets on a server. The table belongs to deploy.js, which may not have loaded yet. */
function targetsOn(id) {
  try { return q('SELECT id, name, domain, runtime, state FROM dep_targets WHERE server_id = ?', id); } catch { return []; }
}

const view = (s) => s && ({
  ...s,
  key_secret: undefined,
  hasKey: Boolean(s.key_secret && hasSecret(s.key_secret)),
  metrics: s.last_metrics ? JSON.parse(s.last_metrics) : null,
  last_metrics: undefined,
});

export function serverRow(id) {
  const s = one('SELECT * FROM srv_servers WHERE id = ?', Number(id));
  if (!s) refuse('no such server', 404);
  return s;
}

export function addServer({ name, transport = 'ssh', host = null, port = 22, username = null, privateKey = null, environment = 'production', provider = null, region = null, notes = null, actor }) {
  if (!String(name || '').trim()) refuse('a server needs a name');
  if (!['ssh', 'local'].includes(transport)) refuse('transport must be ssh or local');
  if (!['production', 'staging', 'development'].includes(environment)) refuse('environment must be production, staging or development');
  if (transport === 'ssh') {
    if (!/^[\w.:-]+$/.test(String(host || ''))) refuse('a host name or IP address is required');
    if (!/^[a-z_][\w.-]*$/i.test(String(username || ''))) refuse('a valid user name is required');
  }
  exec(`INSERT INTO srv_servers (name, transport, host, port, username, environment, provider, region, notes, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, String(name).trim().slice(0, 60), transport, host, Number(port) || 22, username, environment, provider, region, notes, actor);
  const s = one('SELECT * FROM srv_servers WHERE name = ?', String(name).trim().slice(0, 60));
  if (privateKey) setKey(s.id, { privateKey, actor });
  audit({ actorType: 'human', actorId: actor, action: 'servers.added', subjectType: 'fleetServer', subjectId: s.id, payload: { transport, host, environment } });
  return getServer(s.id);
}

export function setKey(id, { privateKey, actor }) {
  const s = serverRow(id);
  const key = String(privateKey || '').trim();
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) refuse('that does not look like a private key (it should start with -----BEGIN … PRIVATE KEY-----)');
  const name = `SERVER_${s.id}_SSH_KEY`;
  putSecret(name, key, { kind: 'ssh_key', note: `SSH key for ${s.name}`, actor });
  exec('UPDATE srv_servers SET key_secret = ? WHERE id = ?', name, s.id);
  return { ok: true };
}

export function updateServer(id, { name, host, port, username, environment, provider, region, notes, actor }) {
  const s = serverRow(id);
  if (environment && !['production', 'staging', 'development'].includes(environment)) refuse('unknown environment');
  if (host && !/^[\w.:-]+$/.test(host)) refuse('a host name or IP address is required');
  exec(`UPDATE srv_servers SET name = COALESCE(?, name), host = COALESCE(?, host), port = COALESCE(?, port), username = COALESCE(?, username),
        environment = COALESCE(?, environment), provider = COALESCE(?, provider), region = COALESCE(?, region), notes = COALESCE(?, notes) WHERE id = ?`,
  name || null, host || null, port ? Number(port) : null, username || null, environment || null, provider ?? null, region ?? null, notes ?? null, s.id);
  audit({ actorType: 'human', actorId: actor, action: 'servers.updated', subjectType: 'fleetServer', subjectId: s.id });
  return getServer(s.id);
}

export function removeServer(id, { actor }) {
  const s = serverRow(id);
  if (targetsOn(s.id).length) refuse('deployment targets still point at this server — remove them first');
  if (s.key_secret) { try { dropSecret(s.key_secret, { actor }); } catch { /* already gone */ } }
  exec('DELETE FROM srv_metrics WHERE server_id = ?', s.id);
  exec('DELETE FROM srv_commands WHERE server_id = ?', s.id);
  exec('DELETE FROM srv_servers WHERE id = ?', s.id);
  audit({ actorType: 'human', actorId: actor, action: 'servers.removed', subjectType: 'fleetServer', subjectId: s.id, payload: { name: s.name } });
  return { ok: true };
}

export function listServers() {
  return q('SELECT * FROM srv_servers ORDER BY environment, name').map(view);
}

export function getServer(id) {
  const s = serverRow(id);
  return {
    ...view(s),
    history: q("SELECT at, cpu_pct, mem_pct, disk_pct, load1 FROM srv_metrics WHERE server_id = ? AND at >= datetime('now','-1 day') ORDER BY at", s.id),
    commands: q('SELECT id, command, purpose, state, exit_code, requested_by, approved_by, started_at, duration_ms FROM srv_commands WHERE server_id = ? ORDER BY id DESC LIMIT 40', s.id),
    targets: targetsOn(s.id),
  };
}

// ---------------------------------------------------------------- metrics --

export const METRICS_SCRIPT = `
export LC_ALL=C
echo "hostname=$(hostname 2>/dev/null)"
echo "os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s)"
echo "kernel=$(uname -r)"
echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "cpus=$(nproc 2>/dev/null)"
read -r _ a b c d e f g h _ < /proc/stat; t1=$((a+b+c+d+e+f+g+h)); i1=$((d+e)); sleep 0.6
read -r _ a b c d e f g h _ < /proc/stat; t2=$((a+b+c+d+e+f+g+h)); i2=$((d+e))
echo "cpu=$(( (100*((t2-t1)-(i2-i1))) / ((t2-t1)>0?(t2-t1):1) ))"
awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/MemFree/{f=$2}END{print "mem_total_kb="t; print "mem_avail_kb="(a?a:f)}' /proc/meminfo 2>/dev/null
df -P / 2>/dev/null | awk 'NR==2{print "disk_total_kb="$2; print "disk_used_kb="$3}'
echo "failed_units=$(systemctl --failed --no-legend --plain 2>/dev/null | wc -l)"
command -v docker >/dev/null 2>&1 && docker ps --format 'docker={{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null | head -30
command -v nginx >/dev/null 2>&1 && echo "nginx=$(systemctl is-active nginx 2>/dev/null)"
ps -eo pid,comm,%cpu,%mem --sort=-%cpu 2>/dev/null | awk 'NR>1 && NR<=7{print "proc="$1"|"$2"|"$3"|"$4}'
`;

/** Parse the key=value lines above into one object. Exported for the tests. */
export function parseMetrics(text) {
  const m = { docker: [], procs: [] };
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k === 'docker') { const [name, status, image] = v.split('|'); m.docker.push({ name, status, image }); continue; }
    if (k === 'proc') { const [pid, cmd, cpu, mem] = v.split('|'); m.procs.push({ pid: Number(pid), cmd, cpu: Number(cpu), mem: Number(mem) }); continue; }
    m[k] = v;
  }
  const num = (x) => (x === undefined || x === '' ? null : Number(x));
  const memTotal = num(m.mem_total_kb);
  const memAvail = num(m.mem_avail_kb);
  const diskTotal = num(m.disk_total_kb);
  const diskUsed = num(m.disk_used_kb);
  return {
    hostname: m.hostname || null,
    os: m.os || null,
    kernel: m.kernel || null,
    uptimeS: num(m.uptime),
    load: m.load ? m.load.split(/\s+/).map(Number) : [],
    cpus: num(m.cpus),
    cpuPct: num(m.cpu),
    memTotalMb: memTotal ? Math.round(memTotal / 1024) : null,
    memPct: memTotal ? Math.round(((memTotal - (memAvail || 0)) / memTotal) * 1000) / 10 : null,
    diskTotalGb: diskTotal ? Math.round(diskTotal / 1048576 * 10) / 10 : null,
    diskPct: diskTotal ? Math.round((diskUsed / diskTotal) * 1000) / 10 : null,
    failedUnits: num(m.failed_units),
    nginx: m.nginx || null,
    docker: m.docker,
    procs: m.procs,
  };
}

/** Reach a server, read its vital signs, and record them. */
export async function collect(id) {
  const s = serverRow(id);
  const r = await run(s, METRICS_SCRIPT, { timeoutMs: 30_000 });
  if (r.code !== 0 && !r.stdout.includes('hostname=')) {
    const was = s.state;
    exec("UPDATE srv_servers SET state = 'offline', last_error = ? WHERE id = ?", (r.stderr || `exit ${r.code}`).slice(0, 500), s.id);
    if (was === 'online') notify({ level: 'error', source: 'servers', message: `${s.name} stopped answering: ${(r.stderr || '').split('\n')[0].slice(0, 160)}`, subjectType: 'fleetServer', subjectId: s.id });
    return { ok: false, error: (r.stderr || `exit ${r.code}`).trim() };
  }
  const m = parseMetrics(r.stdout);
  exec("UPDATE srv_servers SET state = 'online', os = ?, last_seen = datetime('now'), last_error = NULL, last_metrics = ? WHERE id = ?", m.os, JSON.stringify(m), s.id);
  exec('INSERT INTO srv_metrics (server_id, cpu_pct, mem_pct, disk_pct, load1) VALUES (?,?,?,?,?)', s.id, m.cpuPct, m.memPct, m.diskPct, m.load[0] ?? null);
  exec("DELETE FROM srv_metrics WHERE server_id = ? AND at < datetime('now','-7 days')", s.id);
  if (s.state !== 'online') audit({ actorType: 'system', actorId: 'system:servers', action: 'servers.reachable', subjectType: 'fleetServer', subjectId: s.id, payload: { os: m.os } });
  return { ok: true, metrics: m };
}

export async function testConnection(id) {
  const s = serverRow(id);
  const r = await run(s, 'echo "connected as $(whoami) on $(hostname)"; uname -srm', { timeoutMs: 25_000 });
  if (r.code === 0) exec("UPDATE srv_servers SET state = 'online', last_seen = datetime('now'), last_error = NULL WHERE id = ?", s.id);
  else exec("UPDATE srv_servers SET state = 'offline', last_error = ? WHERE id = ?", (r.stderr || `exit ${r.code}`).slice(0, 500), s.id);
  return { ok: r.code === 0, output: (r.stdout + r.stderr).trim() };
}

// --------------------------------------------------------------- commands --

async function execute(cmd, s) {
  const started = Date.now();
  exec("UPDATE srv_commands SET state = 'running', started_at = datetime('now') WHERE id = ?", cmd.id);
  const r = await run(s, cmd.command, { timeoutMs: 15 * 60_000 });
  const out = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim();
  exec("UPDATE srv_commands SET state = ?, exit_code = ?, output = ?, ended_at = datetime('now'), duration_ms = ? WHERE id = ?",
    r.code === 0 ? 'ok' : 'failed', r.code, out.slice(-200_000), Date.now() - started, cmd.id);
  audit({ actorType: 'system', actorId: 'system:servers', action: 'servers.command_finished', subjectType: 'fleetServer', subjectId: s.id, payload: { commandId: cmd.id, exit: r.code } });
  return one('SELECT * FROM srv_commands WHERE id = ?', cmd.id);
}

/**
 * Run a command on a server. A person runs it now; anybody else — an AI
 * employee, a standing order — files it for a person to approve.
 */
export async function runOnServer(id, { command, purpose = null, actor }) {
  const s = serverRow(id);
  const text = String(command || '').trim();
  if (!text) refuse('type a command');
  if (text.length > 20_000) refuse('that command is too long');
  const waiting = !isHuman(actor);
  exec('INSERT INTO srv_commands (server_id, command, purpose, state, requested_by, approved_by) VALUES (?,?,?,?,?,?)',
    s.id, text, purpose, waiting ? 'awaiting_approval' : 'running', actor, waiting ? null : actor);
  const cmd = one('SELECT * FROM srv_commands WHERE id = last_insert_rowid()');
  audit({ actorType: waiting ? 'agent' : 'human', actorId: actor, action: waiting ? 'servers.command_requested' : 'servers.command_started', subjectType: 'fleetServer', subjectId: s.id, payload: { commandId: cmd.id, command: text.slice(0, 300), environment: s.environment } });
  if (waiting) {
    notify({ level: 'warn', source: 'servers', message: `${actor} asks to run a command on ${s.name} (${s.environment}). A person must approve it.`, subjectType: 'fleetServer', subjectId: s.id });
    return cmd;
  }
  return execute(cmd, s);
}

export async function decideCommand(commandId, { approve, actor }) {
  if (!isHuman(actor)) refuse('only a person approves a command on a server');
  const cmd = one('SELECT * FROM srv_commands WHERE id = ?', Number(commandId));
  if (!cmd) refuse('no such command', 404);
  if (cmd.state !== 'awaiting_approval') refuse(`this command is ${cmd.state}`);
  if (!approve) {
    exec("UPDATE srv_commands SET state = 'refused', approved_by = ?, ended_at = datetime('now') WHERE id = ?", actor, cmd.id);
    audit({ actorType: 'human', actorId: actor, action: 'servers.command_refused', subjectType: 'fleetServer', subjectId: cmd.server_id, payload: { commandId: cmd.id } });
    return one('SELECT * FROM srv_commands WHERE id = ?', cmd.id);
  }
  exec('UPDATE srv_commands SET approved_by = ? WHERE id = ?', actor, cmd.id);
  audit({ actorType: 'human', actorId: actor, action: 'servers.command_approved', subjectType: 'fleetServer', subjectId: cmd.server_id, payload: { commandId: cmd.id } });
  return execute({ ...cmd, approved_by: actor }, serverRow(cmd.server_id));
}

export function getServerCommand(id) {
  const c = one('SELECT * FROM srv_commands WHERE id = ?', Number(id));
  if (!c) refuse('no such command', 404);
  return c;
}

export function pendingCommands() {
  return q(`SELECT c.id, c.command, c.purpose, c.requested_by, c.started_at, s.name AS server, s.environment, s.id AS server_id
            FROM srv_commands c JOIN srv_servers s ON s.id = c.server_id WHERE c.state = 'awaiting_approval' ORDER BY c.id`);
}

// ---------------------------------------------------------------- services --

const UNIT = /^[\w@.:-]+$/;
export async function services(id) {
  const s = serverRow(id);
  const r = await run(s, 'systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null | head -300', { timeoutMs: 30_000 });
  if (r.code !== 0) return { ok: false, error: (r.stderr || 'systemd is not available').trim(), units: [] };
  const units = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [unit, load, active, sub, ...desc] = l.split(/\s+/);
    return { unit, load, active, sub, description: desc.join(' ') };
  }).filter((u) => u.unit?.endsWith('.service'));
  return { ok: true, units };
}

export async function serviceAction(id, { unit, action, actor }) {
  if (!UNIT.test(String(unit || ''))) refuse('not a unit name');
  if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'status'].includes(action)) refuse('unknown action');
  const sudo = 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo -n);';
  const cmd = action === 'status' ? `systemctl status ${unit} --no-pager -n 30` : `${sudo} $SUDO systemctl ${action} ${unit} && systemctl is-active ${unit}`;
  return runOnServer(id, { command: cmd, purpose: `${action} ${unit}`, actor });
}

export async function serviceLogs(id, { unit, lines = 200 }) {
  if (!UNIT.test(String(unit || ''))) refuse('not a unit name');
  const s = serverRow(id);
  const n = Math.min(2000, Math.max(10, Number(lines) || 200));
  const r = await run(s, `journalctl -u ${unit} -n ${n} --no-pager 2>&1 || sudo -n journalctl -u ${unit} -n ${n} --no-pager 2>&1`, { timeoutMs: 30_000 });
  return { ok: r.code === 0, log: (r.stdout + r.stderr).trim() };
}

// -------------------------------------------------------------- provision --

const SUDO = 'SUDO=$([ "$(id -u)" = 0 ] || echo sudo -n)\nexport DEBIAN_FRONTEND=noninteractive\n';
export const RECIPES = {
  base: {
    label: 'Harden & update',
    hint: 'System updates, a firewall that allows only SSH and web traffic, fail2ban, and unattended security upgrades.',
    script: `${SUDO}set -e
$SUDO apt-get update -y
$SUDO apt-get upgrade -y
$SUDO apt-get install -y ufw fail2ban unattended-upgrades curl ca-certificates git
$SUDO ufw allow OpenSSH || $SUDO ufw allow 22/tcp
$SUDO ufw allow 80/tcp
$SUDO ufw allow 443/tcp
$SUDO ufw --force enable
$SUDO systemctl enable --now fail2ban
$SUDO dpkg-reconfigure -f noninteractive unattended-upgrades || true
echo "base: done"`,
  },
  node: {
    label: 'Node.js 22',
    hint: 'Installs Node.js 22 LTS from NodeSource.',
    script: `${SUDO}set -e
curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
$SUDO apt-get install -y nodejs
node --version && npm --version`,
  },
  python: {
    label: 'Python 3',
    hint: 'Python 3 with venv and pip.',
    script: `${SUDO}set -e
$SUDO apt-get update -y
$SUDO apt-get install -y python3 python3-venv python3-pip
python3 --version`,
  },
  nginx: {
    label: 'nginx',
    hint: 'The web server every deployment sits behind.',
    script: `${SUDO}set -e
$SUDO apt-get update -y
$SUDO apt-get install -y nginx
$SUDO systemctl enable --now nginx
nginx -v 2>&1`,
  },
  certbot: {
    label: 'HTTPS (certbot)',
    hint: "Let's Encrypt certificates, renewed automatically.",
    script: `${SUDO}set -e
$SUDO apt-get update -y
$SUDO apt-get install -y certbot python3-certbot-nginx
certbot --version 2>&1`,
  },
  docker: {
    label: 'Docker',
    hint: 'Docker Engine from the official convenience script.',
    script: `${SUDO}set -e
curl -fsSL https://get.docker.com | $SUDO sh
$SUDO systemctl enable --now docker
docker --version`,
  },
};

export async function provision(id, { recipe, actor }) {
  const r = RECIPES[recipe];
  if (!r) refuse(`recipe must be one of: ${Object.keys(RECIPES).join(', ')}`);
  return runOnServer(id, { command: r.script, purpose: `provision: ${r.label}`, actor });
}

// --------------------------------------------------------------- AI ops --

/** Ask the ops monitor to read a server's state and say what is wrong. */
export async function diagnose(id, { question = '', actor }) {
  const s = serverRow(id);
  const fresh = await collect(s.id).catch(() => null);
  const srv = serverRow(s.id);
  const failed = await run(srv, 'systemctl --failed --no-legend --plain 2>/dev/null | head -20; echo ---; journalctl -p err -n 60 --no-pager 2>/dev/null | tail -60', { timeoutMs: 30_000 });
  const runId = enqueueRun({
    agentId: 'AGT-MON-001',
    taskType: `servers:diagnose:${s.id}`,
    actor,
    input: {
      prompt: `Diagnose this server and recommend concrete, safe next steps. Never recommend a destructive command without saying what it destroys.
Server: ${s.name} (${s.environment}) ${s.os || ''}
${question ? `The operator asks: ${question}\n` : ''}
Vital signs: ${JSON.stringify(fresh?.metrics || JSON.parse(srv.last_metrics || 'null'))}

Failed units and recent errors:
${(failed.stdout || failed.stderr || '(could not read)').slice(0, 12_000)}

Output JSON: {"title":"","markdown":"","commands":[{"command":"","why":""}],"confidence":0.0}`,
    },
  });
  audit({ actorType: 'human', actorId: actor, action: 'servers.diagnose_requested', subjectType: 'fleetServer', subjectId: s.id, payload: { runId } });
  return { runId };
}

export function diagnosisFor(runId) {
  const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', runId);
  if (!run) refuse('no such run', 404);
  let parsed = null;
  try { parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null; } catch { parsed = null; }
  return { state: run.state, parsed, failure: run.failure_reason };
}

// ----------------------------------------------------------------- sweep --

let sweeping = false;
/** Every few minutes: read every server. Quiet when there are none. */
export async function serversTick() {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const s of q('SELECT id FROM srv_servers')) { await collect(s.id).catch(() => null); }
  } finally { sweeping = false; }
}

export function serversOverview() {
  const all = listServers();
  return {
    total: all.length,
    online: all.filter((s) => s.state === 'online').length,
    offline: all.filter((s) => s.state === 'offline').length,
    production: all.filter((s) => s.environment === 'production').length,
    pending: pendingCommands().length,
    hot: all.filter((s) => s.metrics && ((s.metrics.cpuPct ?? 0) > 85 || (s.metrics.memPct ?? 0) > 90 || (s.metrics.diskPct ?? 0) > 85)).map((s) => s.name),
    recipes: Object.entries(RECIPES).map(([id, r]) => ({ id, label: r.label, hint: r.hint })),
    sshClient: (() => { try { return spawnSync('ssh', ['-V'], { windowsHide: true, timeout: 5000 }).status === 0; } catch { return false; } })(),
  };
}
