// AlphaCore server — one process: HTTP API + static dashboard + worker
// loop + scheduled sweeps. No framework; node:http is enough at this scale.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PORT, ROOT, mockMode } from './env.js';
import './db.js';
import { audit } from './audit.js';
import { seedAgents, startWorkers } from './workflow.js';
import { expirySweep } from './registry.js';
import { advancePipelines } from './pipelines.js';
import { syncDrafts } from './support.js';
import { immuneTick } from './immune.js';
import { seedRituals } from './rituals.js';
import { syncCampaignDrafts } from './commercial.js';
import { syncDataRuns } from './data.js';
import { syncIntel } from './intel.js';
import { seedVendors, seedPeople } from './corporate.js';
import { seedAdmin, login, logout, userForToken, changeOwnPassword } from './auth.js';
import { seedRisks, syncTasks, ruleRiskReviews } from './pm.js';
import { advanceJourneys } from './journey.js';
import { syncOutreachDrafts, ruleStaleRelations } from './relations.js';
import { syncStudioRuns } from './studio.js';
import { syncProposalDrafts } from './sales.js';
import { seedAutomations, nexusTick } from './nexus.js';
import { advanceBlueprints } from './systemdesign.js';
import { syncInfraPlans } from './infra.js';
import { syncFinReports } from './finreports.js';
import { maestroTick } from './maestro.js';
import { advanceRequests } from './requests.js';
import { syncDepartments, ruleAssetRenewals, ruleEnablementFromEvals } from './departments.js';
import { syncDisputes, ruleAutoDisputes } from './disputes.js';
import { seedPersonas } from './org.js';
import { autonomyTick } from './autonomy.js';
import { societyTick } from './society.js';
import { syncExpansion } from './expansion.js';
import { advanceWorkstreams, syncAudits } from './cycles.js';
import { ensurePlaybooks, syncReflections, syncExternalMemory, gradeEpisodes } from './memory.js';
import { ensureChannels, syncChat } from './chat.js';
import { walletTick } from './wallet.js';
import { commsTick, verifyWebhook, receiveMessage, receiveCall, twiml } from './comms.js';
import { moneyWatch } from './money.js';
import { seedMarketingTeam, seedMarketingOps, syncMarketing } from './marketing.js';
// The outside world: credentials, connectors, the gate, the queue, and the
// systems that keep all of it honest.
import { seedConnectors, callConnector } from './connectors/index.js';
import { verifyState, exchangeCode, refreshExpiring } from './connectors/oauth.js';
import { handle as handleJob, enqueue as enqueueJob, jobsTick, reclaimStuck } from './jobs.js';
import { seedConstitution } from './constitution.js';
import { vaultSweep, getSecret } from './vault.js';
import { sealFinishedWork } from './provenance.js';
import { runRedTeam } from './redteam.js';
import { rebuildGraph } from './graph.js';
import { syncSkills, harvestProposals, inviteProposals } from './skills.js';
import { revenueTick, sourceFromIntel } from './revenue.js';
import { handleMcp } from './mcp.js';
import { handleUpgrade, liveTick } from './live.js';
// The platform: many companies, a programmatic surface, installable
// departments, and the rhythm that runs all of it without somebody present.
import { superviseTenants, collectUsage, stopAll as stopTenants } from './tenants.js';
import { authenticateKey, recordCall as recordApiCall } from './apikeys.js';
import { webhookTick } from './webhooks.js';
import { seedPackages } from './packages.js';
import { chiefTick } from './chief.js';
import { seedSlos, observeTick, trimMetrics } from './observe.js';
import { takeBackup } from './backup.js';
import { mcpTools } from './mcptools.js';
import { one, exec, q } from './db.js';
import { getSetting, setSetting } from './settings.js';

const PUBLIC_BASE = () => getSetting('PUBLIC_BASE_URL');

// Read once from the manifest rather than kept in a second place that drifts.
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version;
import { handleApi } from './api.js';

seedAgents();
seedRituals();
seedVendors();
seedPeople();
seedAdmin();
seedRisks();
seedAutomations();
seedPersonas();
ensurePlaybooks();
ensureChannels();
seedMarketingTeam();
seedMarketingOps();
seedConnectors();
seedConstitution();
seedPackages();
seedSlos();

// Where the outside world should call us back. A blank here silently breaks
// OAuth returns and carrier webhooks, so first run writes the only value it
// can honestly know — this machine — and anyone deploying further out changes
// it in Settings. A wrong-looking localhost URL on a callback screen is far
// easier to notice than an empty one.
if (!getSetting('PUBLIC_BASE_URL')) setSetting('PUBLIC_BASE_URL', `http://localhost:${PORT}`);

// The first-run password is printed once and kept only as a hash. If that line
// was missed — window closed, output swallowed by a service manager, scrolled
// past — the account is unreachable and nothing on screen says what to do. So
// every boot that still finds an unclaimed account names the way back in.
{
  const waiting = q('SELECT username FROM users WHERE must_change = 1').map((u) => u.username);
  if (waiting.length) {
    console.log(`\n  ${waiting.join(', ')} ${waiting.length > 1 ? 'have' : 'has'} not chosen a password yet.`);
    console.log('  Lost the one printed at first run?  npm run reset-password\n');
  }
}

startWorkers();

// A tenant process must never try to be a control plane too: it runs one
// company, on the database file it was handed.
const IS_TENANT = Boolean(process.env.ALPHACORE_TENANT);

// ---------------------------------------------------------------------------
// The outside world runs on the job queue rather than on bare timers, because
// anything that leaves this machine can fail halfway and must be retried
// rather than repeated blindly.
// ---------------------------------------------------------------------------
handleJob('connector.call', async (p) => {
  const r = await callConnector(p);
  return { audit: { actorType: 'system', actorId: 'system:jobs', action: 'connector.called', subjectType: 'connector', subjectId: p.connector, payload: { capability: p.capability, verdict: r.verdict } } };
});
handleJob('oauth.refresh', async () => { await refreshExpiring(); });
handleJob('provenance.seal', async () => { sealFinishedWork(); });
handleJob('graph.rebuild', async () => { rebuildGraph(); });
handleJob('redteam.sweep', async () => { await runRedTeam(); });
handleJob('revenue.chase', async ({ dealId }) => {
  const paid = one("SELECT id FROM invoices WHERE deal_id = ? AND state = 'paid'", dealId);
  if (paid) return {};
  const deal = one('SELECT name FROM deals WHERE id = ?', dealId);
  return { audit: { actorType: 'system', actorId: 'system:revenue', action: 'revenue.unpaid', subjectType: 'deal', subjectId: dealId, payload: { name: deal?.name, waitingDays: 7 } } };
});

// One job of each recurring kind at a time: the idempotency key means a slow
// sweep is never queued behind three copies of itself.
const enqueue0 = (kind) => {
  try { enqueueJob(kind, {}, { idempotency: `${kind}:${Math.floor(Date.now() / 60_000)}` }); }
  catch { /* already queued this minute */ }
};

// The queue drains continuously; everything below only decides what to put on it.
setInterval(() => { jobsTick().catch(() => { /* the queue retries on its own */ }); }, 2000).unref?.();
setInterval(() => { try { reclaimStuck(); } catch { /* next sweep */ } }, 5 * 60_000).unref?.();
setInterval(() => { enqueue0('oauth.refresh'); }, 5 * 60_000).unref?.();
setInterval(() => { enqueue0('provenance.seal'); }, 90_000).unref?.();
setInterval(() => { enqueue0('graph.rebuild'); }, 10 * 60_000).unref?.();
// The red team runs nightly-ish rather than constantly: it is a check, not a load.
setInterval(() => { enqueue0('redteam.sweep'); }, 6 * 3600 * 1000).unref?.();
setInterval(() => { try { vaultSweep(); } catch { /* next sweep */ } }, 12 * 3600 * 1000).unref?.();
// The revenue loop: source, then move every deal as far as its evidence allows.
setInterval(() => { try { revenueTick(); } catch { /* next tick */ } }, 20_000).unref?.();
setInterval(() => { try { sourceFromIntel({ limit: 2 }); } catch { /* next tick */ } }, 10 * 60_000).unref?.();
// Skills: ask, harvest, settle. Slow on purpose — a method is not a hot path.
setInterval(() => { try { syncSkills(); harvestProposals(); } catch { /* next tick */ } }, 60_000).unref?.();
setInterval(() => { try { inviteProposals(1); } catch { /* next tick */ } }, 4 * 3600 * 1000).unref?.();

// ---------------------------------------------------------------------------
// The platform layer.
// ---------------------------------------------------------------------------
// The rhythm: the company deciding what to work on, reviewing what happened,
// and correcting — the layer a person used to be. Each clock only acts when its
// period has actually turned over, so calling this often is cheap.
setInterval(() => { try { chiefTick(); } catch { /* the next turn tries again */ } }, 60_000).unref?.();
// Watch itself, and apply the remedy rather than waiting to be noticed.
setInterval(() => { try { observeTick(); } catch { /* next pass */ } }, 30_000).unref?.();
setInterval(() => { try { trimMetrics(); } catch { /* next pass */ } }, 6 * 3600 * 1000).unref?.();
// Tell other software what happened, off the same chain the dashboard reads.
setInterval(() => { try { webhookTick(); } catch { /* the queue retries */ } }, 4000).unref?.();
// A backup every six hours, and one on the way out.
setInterval(() => { try { takeBackup({ kind: 'scheduled', actor: 'system:backup' }); } catch { /* next window */ } }, 6 * 3600 * 1000).unref?.();

// Only the control plane runs other companies.
if (!IS_TENANT) {
  setInterval(() => { try { superviseTenants(); } catch { /* next sweep */ } }, 30_000).unref?.();
  setInterval(() => { try { collectUsage(); } catch { /* next sweep */ } }, 5 * 60_000).unref?.();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { try { stopTenants(); } catch { /* going down anyway */ } process.exit(0); });
  }
}
setInterval(() => { try { syncMarketing(); } catch { /* next tick retries */ } }, 4000).unref?.();
// Employees answer in the room they were mentioned in, as soon as their run lands.
setInterval(() => { syncChat().catch(() => { /* next tick retries */ }); }, 2500).unref?.();
// The treasury watches the chain: balances, incoming payments, invoices closing
// themselves. Reading only — nothing here can move money.
setInterval(() => { walletTick().catch(() => { /* next tick retries */ }); }, 20_000).unref?.();
// Scripts and replies land as soon as the employee finishes writing them.
setInterval(() => { commsTick().catch(() => { /* next tick retries */ }); }, 3000).unref?.();
setInterval(() => { try { moneyWatch(); } catch { /* next tick retries */ } }, 30 * 60 * 1000).unref?.();
setInterval(() => { try { syncTasks(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { try { ruleRiskReviews(); } catch { /* next tick retries */ } }, 6 * 3600 * 1000).unref?.();
setInterval(() => { try { advancePipelines(); } catch { /* next tick retries */ } }, 2000).unref?.();
setInterval(() => { try { syncDrafts(); syncCampaignDrafts(); syncDataRuns(); syncOutreachDrafts(); syncStudioRuns(); syncProposalDrafts(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { try { nexusTick(); } catch { /* next tick retries */ } }, 5000).unref?.();
setInterval(() => { try { syncIntel(); } catch { /* next tick retries */ } }, 3500).unref?.();
setInterval(() => { try { advanceBlueprints(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { try { syncInfraPlans(); syncFinReports(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { maestroTick().catch(() => { /* next tick retries */ }); }, 20_000).unref?.();
setInterval(() => { autonomyTick().catch(() => { /* next tick retries */ }); }, 15_000).unref?.();
// The social layer runs slowly on purpose — a workplace does not talk constantly.
setInterval(() => { societyTick().catch(() => { /* next tick retries */ }); }, 8 * 60_000).unref?.();
setInterval(() => { try { advanceRequests(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { try { syncExpansion(); } catch { /* next tick retries */ } }, 3500).unref?.();
// The iteration engine: audits land first, then workstreams move a phase.
setInterval(() => { try { syncAudits(); advanceWorkstreams(); } catch { /* next tick retries */ } }, 3000).unref?.();
// Memory: land reflections quickly; fold in knowledge and audit grades slowly.
setInterval(() => { try { syncReflections(); } catch { /* next tick retries */ } }, 4000).unref?.();
setInterval(() => { try { syncExternalMemory(); gradeEpisodes(); } catch { /* next tick retries */ } }, 60_000).unref?.();
setInterval(() => { try { syncDepartments(); syncDisputes(); } catch { /* next tick retries */ } }, 3000).unref?.();
setInterval(() => { try { ruleAssetRenewals(); ruleEnablementFromEvals(); ruleAutoDisputes(); } catch { /* next tick retries */ } }, 6 * 3600 * 1000).unref?.();
setInterval(() => { try { advanceJourneys(); } catch { /* next tick retries */ } }, 2500).unref?.();
setInterval(() => { try { ruleStaleRelations(); } catch { /* next tick retries */ } }, 6 * 3600 * 1000).unref?.();
setInterval(() => { try { immuneTick(); } catch { /* next tick retries */ } }, 60_000).unref?.();
setInterval(() => { try { expirySweep(); } catch { /* logged via audit on success */ } }, 60 * 60 * 1000).unref?.();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // The manifest must arrive as JSON or the browser will not read it, and a
  // service worker served as anything but JavaScript is refused outright.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const publicDir = path.join(ROOT, 'public');

function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // SPA fallback
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(fs.readFileSync(index));
      return;
    }
    res.writeHead(404); res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // Carrier callbacks. These cannot carry a session token — the phone network
    // is calling us — so they are authenticated by the carrier's own signature
    // instead, and they are the only unauthenticated write surface.
    if (url.pathname.startsWith('/webhooks/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const params = Object.fromEntries(new URLSearchParams(raw));
      const full = `${PUBLIC_BASE() || `http://localhost:${PORT}`}${req.url}`;
      if (!verifyWebhook(full, params, req.headers['x-twilio-signature'])) {
        res.writeHead(403); res.end('signature check failed');
        return;
      }
      const xml = (body) => { res.writeHead(200, { 'content-type': 'text/xml' }); res.end(body); };
      if (url.pathname === '/webhooks/sms') {
        receiveMessage({ from: params.From, to: params.To, body: params.Body, sid: params.MessageSid, channel: String(params.From || '').startsWith('whatsapp:') ? 'whatsapp' : 'sms' });
        return xml('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      }
      if (url.pathname === '/webhooks/voice') {
        return xml(receiveCall({ from: params.From, to: params.To, sid: params.CallSid }).twiml);
      }
      if (url.pathname === '/webhooks/voice/twiml') {
        const call = one('SELECT * FROM calls WHERE id = ?', Number(url.searchParams.get('call')));
        return xml(call ? twiml(call) : '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
      }
      if (url.pathname === '/webhooks/voice/status' || url.pathname === '/webhooks/voice/transcript') {
        const id = Number(url.searchParams.get('call'));
        if (id) {
          exec(`UPDATE calls SET state = CASE WHEN ? IN ('completed','failed','busy','no-answer') THEN 'completed' ELSE state END,
                outcome = COALESCE(?, outcome), duration_s = COALESCE(?, duration_s),
                transcript = COALESCE(?, transcript), recording = COALESCE(?, recording),
                ended_at = COALESCE(ended_at, datetime('now')) WHERE id = ?`,
          params.CallStatus || null, params.CallStatus === 'completed' ? 'reached' : params.CallStatus || null,
          params.CallDuration ? Number(params.CallDuration) : null,
          params.TranscriptionText || null, params.RecordingUrl || null, id);
        }
        return xml('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      }
      res.writeHead(404); res.end('no such webhook');
      return;
    }
    // The OAuth callback. It cannot carry a session token either — the identity
    // provider is redirecting a browser here — so it is authenticated by the
    // signed state parameter that this server issued minutes earlier.
    if (url.pathname === '/oauth/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const connector = verifyState(state);
      const page = (msg, ok) => {
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>AlphaCore</title>
          <body style="font:15px system-ui;padding:40px;background:#0e0e11;color:#eee">
          <h2 style="color:${ok ? '#6fc487' : '#f0685a'}">${msg}</h2>
          <p>You can close this tab and go back to the Integrations page.</p>`);
      };
      if (!connector || !code) return page('That callback did not come from here.', false);
      const conn = one('SELECT config FROM connectors WHERE id = ?', connector);
      const cfg = conn?.config ? JSON.parse(conn.config) : {};
      const base = connector.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      try {
        await exchangeCode({
          connector, provider: cfg.provider || 'google', code,
          clientId: getSecret(`${base}_CLIENT_ID`) || cfg.clientId,
          clientSecret: getSecret(`${base}_CLIENT_SECRET`),
          redirectUri: `${PUBLIC_BASE() || `http://localhost:${PORT}`}/oauth/callback`,
        });
        return page(`${connector} is connected — in dry-run until you arm it.`, true);
      } catch (err) {
        return page(`Could not finish the handshake: ${String(err.message).slice(0, 200)}`, false);
      }
    }

    // AlphaCore as an MCP server: an outside agent drives the company through
    // the same permissions a person would have, using that person's token.
    if (url.pathname === '/mcp') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const token = req.headers['x-auth-token'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = userForToken(token);
      const send = (obj) => {
        res.writeHead(obj ? 200 : 202, { 'content-type': 'application/json' });
        res.end(obj ? JSON.stringify(obj) : '');
      };
      if (!user) return send({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'authentication required — send a AlphaCore token' } });
      let body;
      try { body = JSON.parse(raw); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'that was not JSON' } }); }
      return send(await handleMcp(body, { user, tools: mcpTools }));
    }

    if (url.pathname.startsWith('/api/')) {
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw ? JSON.parse(raw) : {};
      }

      const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const token = req.headers['x-auth-token'] || null;

      // Liveness — the only other unauthenticated surface, and deliberately
      // the dullest endpoint in the system: it answers "is this process
      // alive and can it read its own database", and nothing about the
      // company. Load balancers, container healthchecks and CI need a probe
      // that does not carry a credential; /api/health does carry one.
      if (url.pathname === '/api/ping') {
        let dbOk = true;
        try { one('SELECT 1 AS ok'); } catch { dbOk = false; }
        return json(dbOk ? 200 : 503, {
          ok: dbOk,
          name: 'alphacore',
          version: VERSION,
          uptimeSeconds: Math.round(process.uptime()),
        });
      }

      // Auth endpoints — the only unauthenticated surface.
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        try { return json(200, login(body?.username, body?.password)); }
        catch (e) { return json(401, { error: e.message }); }
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        if (token) logout(token);
        return json(200, { ok: true });
      }

      // Two ways in. A session token belongs to a person at a keyboard; an API
      // key belongs to another piece of software and carries only the scopes it
      // was granted. Everything downstream treats them identically, which is
      // the point — a key cannot reach anything a person with the same
      // permissions could not.
      let user = userForToken(token);
      let keyId = null;
      if (!user) {
        const presented = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const asKey = authenticateKey(presented);
        if (asKey?.rateLimited) {
          return json(429, { error: `this key is limited to ${asKey.limit} calls a minute`, retryAfterSeconds: 60 });
        }
        if (asKey) { user = asKey; keyId = asKey.keyId; }
      }
      if (!user) return json(401, { error: 'authentication required' });
      if (url.pathname === '/api/auth/me') return json(200, { user });

      // An account still carrying its generated password can do exactly two
      // things: look at itself, and replace that password. Enforced here rather
      // than asked for in the interface, because a prompt the client can skip
      // is not a requirement.
      if (user.mustChangePassword && url.pathname !== '/api/auth/password') {
        return json(403, {
          error: 'this account is still using the password generated at first run — change it before anything else',
          mustChangePassword: true,
        });
      }
      if (url.pathname === '/api/auth/password' && req.method === 'POST') {
        try {
          return json(200, changeOwnPassword(user.id, {
            current: body?.current, next: body?.next, actor: `human:${user.username}`,
          }));
        } catch (e) { return json(400, { error: e.message }); }
      }

      const started = Date.now();
      const handled = await handleApi(req, res, url, body, user);
      if (!handled) json(404, { error: 'no such endpoint' });
      if (keyId) {
        recordApiCall({
          keyId, method: req.method, path: url.pathname,
          status: res.statusCode, ms: Date.now() - started,
          ip: req.socket?.remoteAddress || null,
        });
      }
      return;
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message) }));
  }
});

// Live presence: the chain is the event source, so the feed can never invent an
// event that did not happen.
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname === '/live') handleUpgrade(req, socket, head);
  else socket.destroy();
});
setInterval(() => { try { liveTick(); } catch { /* a dropped socket costs a nicety, never a fact */ } }, 1500).unref?.();

server.listen(PORT, () => {
  audit({ actorType: 'system', actorId: 'server', action: 'server.started', payload: { port: PORT, mockMode: mockMode() } });
  console.log(`AlphaCore running on http://localhost:${PORT} ${mockMode() ? '(mock mode — no provider keys configured)' : ''}`);

  // The console is built for a phone as well as a desktop, and a phone cannot
  // reach "localhost" — it needs this machine's address on the network. The
  // server already listens on every interface; it just never said so.
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  if (lan.length) {
    console.log(`  on this network:  ${lan.map((a) => `http://${a}:${PORT}`).join('   ')}`);
    console.log('  (adding it to a home screen needs HTTPS — over plain http only localhost counts as secure)');
  }
});
