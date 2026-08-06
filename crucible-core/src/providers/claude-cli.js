// Claude subscription adapter — shells out to the Claude Code CLI in print
// mode, which authenticates with the user's claude.ai Pro/Max subscription
// instead of a metered API key. Zero marginal cash cost; tokens still metered.
// The prompt travels over stdin (never through a shell string), so no
// injection surface; the argument list is static.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TIMEOUT_MS = 180_000;

// The CLI is not always on PATH (Windows installs land in ~/.local/bin, and
// service processes often inherit a trimmed PATH). Resolve it once: explicit
// CLAUDE_CLI_PATH wins, then the known install locations, then bare `claude`.
let resolved = null;
function resolveCli() {
  if (resolved) return resolved;
  const win = process.platform === 'win32';
  const home = os.homedir();
  const candidates = [
    process.env.CLAUDE_CLI_PATH?.trim(),
    path.join(home, '.local', 'bin', win ? 'claude.exe' : 'claude'),
    path.join(home, '.claude', 'local', win ? 'claude.cmd' : 'claude'),
    win && process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'claude.cmd') : null,
    win ? null : '/usr/local/bin/claude',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        // A real executable path is spawned directly — no shell, so spaces in
        // the path are safe. Only .cmd/.bat shims need the shell.
        resolved = { cmd: c, shell: /\.(cmd|bat)$/i.test(c) };
        return resolved;
      }
    } catch { /* try the next candidate */ }
  }
  resolved = { cmd: 'claude', shell: win };
  return resolved;
}

/** Where the adapter will look — surfaced in Settings so a bad path is visible. */
export function cliLocation() {
  const r = resolveCli();
  return { path: r.cmd, resolved: r.cmd !== 'claude', fromEnv: Boolean(process.env.CLAUDE_CLI_PATH) };
}

export async function call({ model, system, prompt, maxTokens }) {
  const t0 = Date.now();
  const stdinBody = system
    ? `System instructions (authoritative):\n${system}\n\n---\nTask:\n${prompt}\n\n---\nOUTPUT CONTRACT: Reply with ONLY the JSON object required by the system instructions — no prose before or after, no markdown fences. Your reply must start with { and end with }.`
    : prompt;

  // Model aliases (haiku|sonnet|opus) come from our own config file — static
  // values, never user input — so they are safe to place on the arg list.
  const args = ['-p', '--output-format', 'json'];
  if (model && model !== 'cli-default' && /^[a-z0-9.-]+$/i.test(model)) {
    args.push('--model', model);
  }

  const cli = resolveCli();
  const out = await new Promise((resolve, reject) => {
    const child = spawn(cli.cmd, args, {
      shell: cli.shell,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude CLI timeout'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude CLI exit ${code}: ${stderr.slice(0, 400)}`));
      else resolve(stdout);
    });
    child.stdin.write(stdinBody);
    child.stdin.end();
  });

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    // Some CLI versions wrap the JSON with log lines — take the last JSON object.
    const m = out.match(/\{[\s\S]*\}\s*$/);
    if (!m) throw new Error('claude CLI: unparseable output');
    parsed = JSON.parse(m[0]);
  }
  if (parsed.is_error) throw new Error(`claude CLI error: ${String(parsed.result).slice(0, 400)}`);
  return {
    text: typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result),
    tokensIn: parsed.usage?.input_tokens ?? 0,
    tokensOut: parsed.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
    subscription: true,
  };
}
