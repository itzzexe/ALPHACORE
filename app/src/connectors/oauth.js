// OAuth 2.0 — the handshake that lets the company act as an account without
// ever holding that account's password.
//
// The client secret and both tokens live in the vault, never in the connectors
// table. The state parameter is a signed nonce so a callback that did not start
// here is refused. Refresh happens on the job queue before expiry, not at the
// moment of use, so a token never dies mid-send.
import { createHmac, randomBytes } from 'node:crypto';
import { q, one, exec } from './../db.js';
import { audit } from './../audit.js';
import { getSecret, putSecret } from './../vault.js';
import { record as certRecord } from './../certification.js';
import { wire } from './wire.js';

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    extra: { access_type: 'offline', prompt: 'consent' },
  },
  github: { authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token' },
  slack: { authUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access' },
  linkedin: { authUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken' },
  x: { authUrl: 'https://twitter.com/i/oauth2/authorize', tokenUrl: 'https://api.twitter.com/2/oauth2/token', extra: { code_challenge: 'challenge', code_challenge_method: 'plain' } },
  notion: { authUrl: 'https://api.notion.com/v1/oauth/authorize', tokenUrl: 'https://api.notion.com/v1/oauth/token', extra: { owner: 'user' } },
};

const nonceKey = () => getSecret('OAUTH_STATE_KEY') || (() => {
  const k = randomBytes(32).toString('hex');
  putSecret('OAUTH_STATE_KEY', k, { kind: 'webhook', note: 'signs the OAuth state parameter', actor: 'system:oauth' });
  return k;
})();

const sign = (s) => createHmac('sha256', nonceKey()).update(s).digest('hex').slice(0, 24);

export function authorizeUrl({ connector, provider, clientId, scopes, redirectUri }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`no OAuth profile for ${provider}`);
  const nonce = randomBytes(8).toString('hex');
  const state = `${connector}.${nonce}.${sign(`${connector}.${nonce}`)}`;
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', Array.isArray(scopes) ? scopes.join(' ') : String(scopes || ''));
  u.searchParams.set('state', state);
  for (const [k, v] of Object.entries(p.extra || {})) u.searchParams.set(k, v);
  return u.toString();
}

export function verifyState(state) {
  const [connector, nonce, mac] = String(state || '').split('.');
  if (!connector || !nonce || !mac) return null;
  return sign(`${connector}.${nonce}`) === mac ? connector : null;
}

export async function exchangeCode({ connector, provider, code, clientId, clientSecret, redirectUri, account = 'default' }) {
  const p = PROVIDERS[provider];
  let tok;
  try {
    tok = await wire(p.tokenUrl, {
      method: 'POST', service: `${provider} oauth`,
      headers: { accept: 'application/json' },
      form: {
        grant_type: 'authorization_code', code, client_id: clientId,
        client_secret: clientSecret, redirect_uri: redirectUri,
        ...(provider === 'x' ? { code_verifier: 'challenge' } : {}),
      },
    });
  } catch (err) {
    // The certification matrix has an OAuth column, and this is the only place
    // in the system that can fill it. wire() always reaches the real provider —
    // there is no mock token endpoint — so anything that happens here is live.
    certRecord({ connector, capability: 'oauth', operation: 'authorization_code', mode: 'live', outcome: 'failed', detail: String(err.message) });
    throw err;
  }
  certRecord({ connector, capability: 'oauth', operation: 'authorization_code', mode: 'live', outcome: 'ok' });
  return storeTokens({ connector, account, tok, provider });
}

function storeTokens({ connector, account, tok, provider }) {
  const base = connector.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const accessName = `${base}_ACCESS`;
  const refreshName = `${base}_REFRESH`;
  const expires = tok.expires_in ? new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString() : null;
  putSecret(accessName, tok.access_token, { kind: 'oauth', connector, expiresAt: expires, actor: 'system:oauth' });
  if (tok.refresh_token) putSecret(refreshName, tok.refresh_token, { kind: 'oauth', connector, actor: 'system:oauth' });
  exec(
    `INSERT INTO connector_accounts (connector_id, account, secret_name, refresh_name, expires_at, meta)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(connector_id, account) DO UPDATE SET
       secret_name = excluded.secret_name, refresh_name = COALESCE(excluded.refresh_name, connector_accounts.refresh_name),
       expires_at = excluded.expires_at, state = 'active'`,
    connector, account, accessName, tok.refresh_token ? refreshName : null, expires,
    JSON.stringify({ provider, scope: tok.scope || null }),
  );
  exec("UPDATE connectors SET state = CASE WHEN state = 'disconnected' THEN 'dry' ELSE state END, connected_at = datetime('now') WHERE id = ?", connector);
  audit({ actorType: 'system', actorId: 'system:oauth', action: 'connector.authorized', subjectType: 'connector', subjectId: connector, payload: { account, provider, expires } });
  return { ok: true, connector, account, expires };
}

/** Refresh anything within ten minutes of expiring, before it is needed. */
export async function refreshExpiring() {
  const due = q(
    `SELECT connector_id, account FROM connector_accounts
     WHERE state = 'active' AND refresh_name IS NOT NULL
       AND expires_at IS NOT NULL AND expires_at < datetime('now','+10 minutes')`,
  );
  const done = [];
  for (const row of due) {
    try {
      await refreshAccount(row.connector_id, row.account);
      done.push(`${row.connector_id}/${row.account}`);
    } catch (err) {
      exec("UPDATE connectors SET health = 'failing' WHERE id = ?", row.connector_id);
      audit({ actorType: 'system', actorId: 'system:oauth', action: 'connector.refresh_failed', subjectType: 'connector', subjectId: row.connector_id, payload: { why: String(err.message).slice(0, 200) } });
    }
  }
  return done;
}

export async function refreshAccount(connectorId, account = 'default') {
  const row = one('SELECT * FROM connector_accounts WHERE connector_id = ? AND account = ?', connectorId, account);
  if (!row?.refresh_name) return { ok: false, why: 'no refresh token' };
  const conn = one('SELECT config FROM connectors WHERE id = ?', connectorId);
  const cfg = conn?.config ? JSON.parse(conn.config) : {};
  const provider = cfg.provider || 'google';
  const p = PROVIDERS[provider];
  const refresh = getSecret(row.refresh_name);
  const clientId = getSecret(`${connectorId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_ID`) || cfg.clientId;
  const clientSecret = getSecret(`${connectorId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_SECRET`);
  if (!refresh || !clientId) return { ok: false, why: 'missing refresh credentials' };
  let tok;
  try {
    tok = await wire(p.tokenUrl, {
      method: 'POST', service: `${provider} refresh`,
      form: { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) },
    });
  } catch (err) {
    // A revoked token noticed is the token-lifecycle column working, not
    // failing — but it is recorded as a failure because the renewal did fail,
    // and a matrix that hides that is the kind this one is meant to replace.
    certRecord({ connector: connectorId, capability: 'token_lifecycle', operation: 'refresh_token', mode: 'live', outcome: 'failed', detail: String(err.message) });
    throw err;
  }
  certRecord({ connector: connectorId, capability: 'token_lifecycle', operation: 'refresh_token', mode: 'live', outcome: 'ok' });
  return storeTokens({ connector: connectorId, account, tok: { ...tok, refresh_token: tok.refresh_token || refresh }, provider });
}

export { PROVIDERS };
