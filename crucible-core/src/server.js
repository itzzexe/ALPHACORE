// Crucible Core server — one process: HTTP API + static dashboard + worker
// loop + scheduled sweeps. No framework; node:http is enough at this scale.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
import { seedAdmin, login, logout, userForToken } from './auth.js';
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
import { handleApi } from './api.js';

seedAgents();
seedRituals();
seedVendors();
seedPeople();
seedAdmin();
seedRisks();
seedAutomations();
seedPersonas();
startWorkers();
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

      // Auth endpoints — the only unauthenticated surface.
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        try { return json(200, login(body?.username, body?.password)); }
        catch (e) { return json(401, { error: e.message }); }
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        if (token) logout(token);
        return json(200, { ok: true });
      }

      const user = userForToken(token);
      if (!user) return json(401, { error: 'authentication required' });
      if (url.pathname === '/api/auth/me') return json(200, { user });

      const handled = await handleApi(req, res, url, body, user);
      if (!handled) json(404, { error: 'no such endpoint' });
      return;
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message) }));
  }
});

server.listen(PORT, () => {
  audit({ actorType: 'system', actorId: 'server', action: 'server.started', payload: { port: PORT, mockMode: mockMode() } });
  console.log(`Crucible Core running on http://localhost:${PORT} ${mockMode() ? '(mock mode — no provider keys configured)' : ''}`);
});
