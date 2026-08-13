// Production mode, and the two things it refuses to start without.
//
// Everything in this platform is safe to run on a laptop with the master key in
// a file next to the database and the console on plain HTTP. Neither of those is
// safe on a machine the internet can reach, and both are the kind of default
// that survives all the way to production because nothing ever complains.
//
// So production mode complains. It is not a different code path — the platform
// behaves identically — it is a declaration that this install is somewhere real,
// and two boot gates that hold it to that.
//
// Each gate can be overridden, deliberately and loudly: the override is an
// environment variable whose value is a sentence you have to mean, and using one
// writes an entry to the audit chain at startup under `system:boot`. An
// operator who accepts a risk should be able to; nobody should be able to accept
// one silently.
//
// The checks live here rather than in server.js so they can be tested as
// functions — a boot gate that can only be exercised by starting a process is a
// boot gate nobody covers.
import { getSetting } from './settings.js';
import { keySource } from './masterkey.js';

export const ACCEPT = 'I-UNDERSTAND';

/**
 * Settings over environment, the same precedence the rest of the platform uses:
 * a machine can be configured before it first starts, and after that the console
 * owns it.
 */
export function isProduction() {
  const setting = getSetting('PRODUCTION_MODE');
  if (setting !== null && setting !== undefined && setting !== '') return String(setting) === 'true';
  return String(process.env.ALPHACORE_ENV || '').toLowerCase() === 'production';
}

/**
 * The master key gate.
 *
 * `data/master.key` beside the database means theft of the disk is theft of
 * both — the encryption at rest protects against nothing that got the file. In
 * production the key comes from a secret manager or from the environment.
 */
export function masterKeyGate({ production = isProduction() } = {}) {
  let source = 'unknown';
  try { source = keySource().source; } catch { source = 'unreadable'; }

  const acceptable = source === 'command' || source === 'environment';
  const overridden = String(process.env.ALPHACORE_ACCEPT_LOCAL_MASTER_KEY || '') === ACCEPT;

  if (acceptable) return { ok: true, source, overridden: false, severity: 'ok' };

  const why = 'the master key is a file on this disk, so anybody who takes the disk takes the key with it. '
    + 'Set ALPHACORE_MASTER_KEY_COMMAND to fetch it from a secret manager, or ALPHACORE_MASTER_KEY to pass it in.';

  if (!production) return { ok: true, source, overridden: false, severity: 'warn', why };
  if (overridden) return { ok: true, source, overridden: true, severity: 'accepted', why };
  return { ok: false, source, overridden: false, severity: 'blocker', why };
}

/**
 * The HTTPS gate.
 *
 * The server speaks plain HTTP on purpose — TLS belongs in a proxy in front of
 * it, which is also what makes `X-Forwarded-For` believable for rate limiting.
 * So the gate is not "is TLS on" but "is this deployed the supported way":
 * a public address that is https, and TRUST_PROXY set to say something is
 * terminating it.
 */
export function httpsGate({ production = isProduction() } = {}) {
  const base = getSetting('PUBLIC_BASE_URL') || process.env.PUBLIC_BASE_URL || '';
  const secure = /^https:\/\//i.test(base);
  const trusted = String(process.env.TRUST_PROXY || getSetting('TRUST_PROXY') || '').toLowerCase() === 'true';
  const overridden = String(process.env.ALPHACORE_ACCEPT_PLAIN_HTTP || '') === ACCEPT;

  if (secure && trusted) return { ok: true, base, secure, trusted, overridden: false, severity: 'ok' };

  const missing = [];
  if (!secure) missing.push(base ? `PUBLIC_BASE_URL is ${base}, which is not https` : 'PUBLIC_BASE_URL is not set');
  if (!trusted) missing.push('TRUST_PROXY is not true, so nothing says a proxy is terminating TLS');
  const why = `${missing.join('; ')}. Sessions and the master password would cross the network in the clear.`;

  if (!production) return { ok: true, base, secure, trusted, overridden: false, severity: 'warn', why };
  if (overridden) return { ok: true, base, secure, trusted, overridden: true, severity: 'accepted', why };
  return { ok: false, base, secure, trusted, overridden: false, severity: 'blocker', why };
}

/** Both gates, for the boot check, the launch audit and the header alike. */
export function gates({ production = isProduction() } = {}) {
  return { production, masterKey: masterKeyGate({ production }), https: httpsGate({ production }) };
}

/**
 * What server.js calls before it listens.
 *
 * Returns the lines to print and whether to stop. It does not print, exit or
 * audit itself — a function that calls process.exit cannot be tested, and this
 * one is the whole point of the phase.
 */
export function bootCheck({ production = isProduction() } = {}) {
  const g = gates({ production });
  const refusals = [];
  const accepted = [];

  for (const [name, gate, variable] of [
    ['master key', g.masterKey, 'ALPHACORE_ACCEPT_LOCAL_MASTER_KEY'],
    ['HTTPS', g.https, 'ALPHACORE_ACCEPT_PLAIN_HTTP'],
  ]) {
    if (gate.severity === 'blocker') refusals.push({ name, why: gate.why, variable });
    if (gate.severity === 'accepted') accepted.push({ name, why: gate.why, variable });
  }

  return {
    production,
    stop: refusals.length > 0,
    refusals,
    accepted,
    gates: g,
    message: refusals.length
      ? [
        '',
        'AlphaCore is in production mode and will not start:',
        '',
        ...refusals.flatMap((r) => [`  ${r.name}: ${r.why}`, `  To accept this risk anyway: ${r.variable}=${ACCEPT}`, '']),
        'Turn production mode off in Settings if this machine is not production.',
        '',
      ].join('\n')
      : '',
  };
}
