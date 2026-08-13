// Which integrations actually work, and how we know.
//
// The usual answer to that question is a table in a README with ticks in it,
// maintained by whoever last cared. This one cannot be maintained, because
// there is nothing to maintain: `connector_certification` is a SQLite view over
// evidence the egress layer writes on every call it makes, successful or not.
// Inserting a certification is not refused — there is nowhere to insert it.
//
// Two consequences worth stating, because both are the point:
//
//   A cell can go down. If the only live success was in March and a live call
//   failed yesterday, the state still reads live-verified — that is what the
//   evidence says — but the failure and its date sit beside it. A matrix that
//   only ever climbs is a matrix that is lying by omission.
//
//   A cell nobody can observe says so. This platform has no sandbox notion at
//   all, so `sandbox-verified` is a rung on the ladder that nothing can
//   currently reach; and a connector that does not do OAuth can never produce
//   OAuth evidence. Those read "not yet observable" rather than a tick or a
//   cross, because both of those would be claims.
import { q, one, exec } from './db.js';

/**
 * The six dimensions. Each is here because the platform can actually observe
 * it — not because it would look thorough in a table.
 */
export const CAPABILITIES = [
  { id: 'read', label: 'Read', about: 'fetching something without changing it' },
  { id: 'write', label: 'Write', about: 'changing something on the other side' },
  { id: 'oauth', label: 'OAuth flow', about: 'a code exchanged for a token' },
  { id: 'failure', label: 'Failure handling', about: 'the call failed and was handled rather than crashing' },
  { id: 'rate_limit', label: 'Rate limit', about: 'a limit was hit — theirs or ours — and respected' },
  { id: 'token_lifecycle', label: 'Token refresh', about: 'an expiring token renewed, or a revoked one noticed' },
];

/** Only these can produce OAuth evidence; the rest carry a static credential. */
const OAUTH_DRIVERS = new Set(['gmail', 'gcalendar', 'github', 'slack', 'linkedin', 'x', 'notion']);

const STATES = ['untested', 'mock-only', 'paper-verified', 'sandbox-verified', 'live-verified'];

/**
 * One observation. Called by the egress layer for every attempt it resolves,
 * and by the OAuth code for the two things only it sees.
 *
 * It never throws: a certification that can break a connector call is worse
 * than no certification. Evidence is a by-product, not a dependency.
 */
export function record({ connector, capability, operation = null, mode, outcome, detail = null, egressId = null }) {
  try {
    if (!connector || !capability || !mode || !outcome) return null;
    exec(`INSERT INTO connector_evidence (connector, capability, operation, mode, outcome, detail, egress_id)
          VALUES (?,?,?,?,?,?,?)`,
    String(connector), String(capability), operation ? String(operation).slice(0, 80) : null,
    mode, outcome, detail ? String(detail).slice(0, 400) : null, egressId);
    return true;
  } catch { return null; }
}

/**
 * What an egress verdict means in ladder terms.
 *
 * `dry` is a connector that runs the whole path and sends nothing, which proves
 * the plumbing and nothing about the other side — that is mock. `paper` reads
 * the real world and declines to change it. `allowed` really left the machine.
 * There is no sandbox rung because nothing in this platform has a sandbox.
 */
export function modeForVerdict(verdict) {
  if (verdict === 'dry') return 'mock';
  if (verdict === 'paper') return 'paper';
  if (verdict === 'allowed') return 'live';
  return null;   // blocked, gated, refused — nothing was exercised
}

/** Does the platform have any code path that could produce this evidence? */
export function observable(connector, capability) {
  if (capability === 'oauth' || capability === 'token_lifecycle') {
    const c = one('SELECT driver FROM connectors WHERE id = ?', connector);
    return OAUTH_DRIVERS.has(String(c?.driver || connector).toLowerCase());
  }
  return true;
}

/**
 * The matrix, derived. Every connector on file × every dimension, whether or
 * not evidence exists — an absent row is the most important cell on the page.
 */
export function matrix() {
  const connectors = q("SELECT id, driver, label, state FROM connectors ORDER BY id");
  const rows = q('SELECT * FROM connector_certification');
  const byKey = new Map(rows.map((r) => [`${r.connector}|${r.capability}`, r]));

  return connectors.map((c) => ({
    connector: c.id,
    label: c.label,
    driver: c.driver,
    connectorState: c.state,
    cells: CAPABILITIES.map((cap) => {
      const e = byKey.get(`${c.id}|${cap.id}`);
      if (!observable(c.id, cap.id)) {
        return { capability: cap.id, state: 'not yet observable', why: `${c.label} does not use ${cap.id === 'oauth' ? 'OAuth' : 'refreshable tokens'}` };
      }
      if (!e) return { capability: cap.id, state: 'untested', observations: 0 };
      return {
        capability: cap.id,
        state: e.state,
        observations: e.observations,
        successes: e.successes,
        failures: e.failures,
        blocked: e.blocked,
        lastSeenAt: e.last_seen_at,
        lastFailureAt: e.last_failure_at,
        lastFailure: e.last_failure,
      };
    }),
  }));
}

export function overview() {
  const m = matrix();
  const cells = m.flatMap((c) => c.cells);
  const count = (s) => cells.filter((c) => c.state === s).length;
  return {
    capabilities: CAPABILITIES,
    states: STATES,
    connectors: m,
    counts: {
      connectors: m.length,
      cells: cells.length,
      untested: count('untested'),
      mockOnly: count('mock-only'),
      paperVerified: count('paper-verified'),
      sandboxVerified: count('sandbox-verified'),
      liveVerified: count('live-verified'),
      notObservable: count('not yet observable'),
      withRecentFailure: cells.filter((c) => c.lastFailureAt).length,
    },
    evidence: one('SELECT COUNT(*) AS n FROM connector_evidence').n,
    note: 'Nothing on this page is typed by anybody. It is a view over evidence the gate writes on every call, so a '
      + 'certification with no call behind it cannot exist — there is no table to put one in. "sandbox-verified" is a '
      + 'rung nothing can currently reach: this platform has no sandbox, and a tick there would be a claim rather than '
      + 'a reading.',
  };
}
