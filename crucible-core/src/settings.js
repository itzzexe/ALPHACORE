// Runtime settings — DB-backed overrides for provider keys and flags, editable
// by the superadmin from the Settings page. Precedence: DB setting → process
// env. Keys live in the local SQLite file: fine for a local single-machine
// deployment; a real multi-host deployment moves them to a secret manager
// (Part 3 §6.3) — stated honestly, not hidden.
import { one, exec, q } from './db.js';
import { providersConfig } from './env.js';

export function getSetting(k) {
  return one('SELECT v FROM settings WHERE k = ?', k)?.v ?? null;
}

export function setSetting(k, v) {
  if (v === null || v === undefined || v === '') exec('DELETE FROM settings WHERE k = ?', k);
  else exec('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
}

export function getSecret(name) {
  if (!name) return null;
  return getSetting(name) || process.env[name] || null;
}

export function isProviderAvailable(name) {
  const p = providersConfig.providers[name];
  if (!p) return false;
  if (p.kind === 'mock') return true;
  if (String(getSecret('CRUCIBLE_MOCK') || '').toLowerCase() === 'true') return false;
  if (p.kind === 'claude-cli') return String(getSecret(p.enabledEnv) || '').toLowerCase() === 'true';
  return Boolean(p.keyEnv && getSecret(p.keyEnv));
}

export function isMockMode() {
  return !Object.keys(providersConfig.providers)
    .filter((n) => n !== 'mock')
    .some(isProviderAvailable);
}

/** Masked view for the Settings page — secrets are never echoed back. */
export function settingsOverview() {
  const dbKeys = new Set(q('SELECT k FROM settings').map((r) => r.k));
  const rows = [];
  for (const [name, p] of Object.entries(providersConfig.providers)) {
    if (p.kind === 'mock') continue;
    const keyName = p.kind === 'claude-cli' ? p.enabledEnv : p.keyEnv;
    const val = getSecret(keyName);
    rows.push({
      provider: name, kind: p.kind, keyName,
      configured: Boolean(val),
      source: dbKeys.has(keyName) ? 'settings' : (process.env[keyName] ? 'env' : null),
      tail: val && p.kind !== 'claude-cli' ? String(val).slice(-4) : null,
      available: isProviderAvailable(name),
    });
  }
  return { providers: rows, mockForced: String(getSecret('CRUCIBLE_MOCK') || '').toLowerCase() === 'true', mockMode: isMockMode() };
}
