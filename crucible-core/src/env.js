// Environment + config loader. Reads .env (if present) into process.env,
// loads the JSON config files, and computes provider availability.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env parser — no dependency needed.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export const providersConfig = loadJson('config/providers.json');
export const budgetsConfig = loadJson('config/budgets.json');
export const agentsConfig = loadJson('config/agents.json');
export const pipelinesConfig = loadJson('config/pipelines.json');

export const PORT = Number(process.env.PORT || 8484);
export const MOCK_FORCED = String(process.env.CRUCIBLE_MOCK || '').toLowerCase() === 'true';
// NOTE: runtime provider availability now lives in settings.js (DB-backed,
// superadmin-editable); the env-based helpers below remain for boot paths
// that must not touch the database.

/** A provider is available if forced-mock is off and its key (or enable flag) is set. */
export function providerAvailable(name) {
  const p = providersConfig.providers[name];
  if (!p) return false;
  if (p.kind === 'mock') return true;
  if (MOCK_FORCED) return false;
  if (p.kind === 'claude-cli') {
    return String(process.env[p.enabledEnv] || '').toLowerCase() === 'true';
  }
  return Boolean(p.keyEnv && process.env[p.keyEnv]);
}

/** True when no real provider is configured — the whole platform runs on the mock provider. */
export function mockMode() {
  return !Object.keys(providersConfig.providers)
    .filter((n) => n !== 'mock')
    .some(providerAvailable);
}
