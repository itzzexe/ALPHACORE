// REST API — thin JSON layer over the modules. Human actions (approvals,
// evidence verification, decisions, freezes) require an `actor` field naming
// the human; the audit log records it. No agent path can reach these handlers.
import { q, one } from './db.js';
import { verifyChain, audit } from './audit.js';
import { providersConfig, budgetsConfig } from './env.js';
import { isProviderAvailable as providerAvailable, isMockMode as mockMode, settingsOverview, setSetting } from './settings.js';
import { PERMS, hasPerm, listUsers, createUser, updateUser } from './auth.js';
import {
  createProject, listProjects, setProjectState,
  createTask, listTasks, setTaskState,
  listRisks, createRisk, setRiskState,
  qualityDashboard, addQualityReview,
} from './pm.js';
import { setFrozen } from './policy.js';
import { enqueueRun, resolveRun, queueStats, getAgentSpec } from './workflow.js';
import {
  createDecision, listDecisions, getDecision, addEvidence, verifyEvidence,
  decideDecision, expirySweep,
} from './registry.js';
import { runMiniTribunal } from './tribunal.js';
import { route } from './router.js';
import { exec } from './db.js';
import { listTemplates, createPipeline, listPipelines, getPipeline, cancelPipeline } from './pipelines.js';
import { applyRunFiles, listArtifacts, readArtifact } from './artifacts.js';
import { createProduct, listProducts, getProduct, advanceGate, retireProduct } from './products.js';
import { declareIncident, listIncidents, addIncidentUpdate, setIncidentState, startPostmortemPipeline } from './incidents.js';
import { createTicket, listTickets, sendTicket, closeTicket, supportStats, raiseIncidentFromTicket } from './support.js';
import { listSets, listEvalRuns, runEvalSet, accuracyFactor } from './evals.js';
import { listProblems, resolveProblem } from './immune.js';
import { listRituals, completeRitual } from './rituals.js';
import { financeReport, exportFinanceReport } from './finance.js';
import { listNotifications, unreadCount, markAllRead } from './notify.js';
import {
  createCampaign, listCampaigns, approveCampaign, updateCampaign,
  createCustomer, listCustomers, updateCustomer, crmStats,
} from './commercial.js';
import {
  createIntelQuery, listIntelQueries, getIntelQuery, verifyIntelRecord, targetIntelRecord, exportIntelCsv,
  createSegment, listSegments, addToSegment, autoSegment,
  createDataset, listDatasets, getDataset, transformDataset,
  listArchive, getArchiveItem, archiveItem,
} from './data.js';
import {
  createContract, listContracts, setContractState,
  createVendor, listVendors, setVendorState,
  listPeople, createPerson,
  listKnowledge, addKnowledge, setKnowledgeVerification, lessonFromIncident,
  createObjective, listObjectives, updateObjective,
} from './corporate.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const need = (obj, key) => {
  if (obj?.[key] === undefined || obj?.[key] === null || obj?.[key] === '') throw new HttpError(400, `missing field: ${key}`);
  return obj[key];
};

// route table: [method, pattern, handler(params, body, url)]
const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true, mockMode: mockMode(), now: new Date().toISOString() })],

  ['GET', /^\/api\/stats$/, () => {
    const month = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const spendMonth = one("SELECT COALESCE(SUM(cost_usd),0) AS s, COALESCE(SUM(tokens_in),0) AS ti, COALESCE(SUM(tokens_out),0) AS toks FROM model_calls WHERE created_at >= ?", `${month}-01`);
    const spendToday = one("SELECT COALESCE(SUM(cost_usd),0) AS s, COUNT(*) AS calls FROM model_calls WHERE date(created_at) = ?", today);
    const gov = one("SELECT COALESCE(SUM(spent_usd),0) AS s, COALESCE(MAX(cap_usd),0) AS cap FROM budgets WHERE scope = 'governance' AND period_key = ?", month);
    const byProvider = q("SELECT provider, COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS calls, SUM(ok = 0) AS errors FROM model_calls GROUP BY provider ORDER BY cost DESC");
    const byAgent = q(`SELECT r.agent_id, COUNT(*) AS runs, COALESCE(SUM(r.cost_usd),0) AS cost FROM runs r GROUP BY r.agent_id ORDER BY cost DESC`);
    const spendSeries = q("SELECT date(created_at) AS d, COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS calls FROM model_calls WHERE created_at >= datetime('now','-14 days') GROUP BY d ORDER BY d");
    const decisions = q('SELECT status, COUNT(*) AS n FROM decisions GROUP BY status');
    const gate = q("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'");
    return {
      queue: queueStats(),
      spend: {
        monthUsd: spendMonth.s, monthTokensIn: spendMonth.ti, monthTokensOut: spendMonth.toks,
        todayUsd: spendToday.s, todayCalls: spendToday.calls,
        companyCapUsd: budgetsConfig.company.monthlyCapUsd,
        governanceUsd: gov.s, governanceCapUsd: gov.cap || budgetsConfig.governance.monthlyCapUsd,
      },
      byProvider, byAgent, spendSeries,
      decisions: Object.fromEntries(decisions.map((r) => [r.status, r.n])),
      awaitingHuman: gate[0].n,
      mockMode: mockMode(),
    };
  }],

  ['GET', /^\/api\/providers$/, () => ({
    mockMode: mockMode(),
    providers: Object.entries(providersConfig.providers).map(([name, p]) => ({
      name, family: p.family, kind: p.kind,
      available: providerAvailable(name),
      keyEnv: p.keyEnv, models: Object.keys(p.models),
      dpa: p.dpa, noTraining: p.noTraining,
    })),
    tiers: providersConfig.tiers,
  })],

  ['POST', /^\/api\/providers\/test$/, async (_p, body) => {
    const result = await route({
      tier: body.tier || 'T1', agentId: 'AGT-CST-001',
      system: 'You are a connectivity probe. Reply with JSON: {"ok":true,"note":"<ten words on who you are>"}',
      prompt: 'Confirm connectivity.', maxTokens: 200,
    });
    return { ok: true, provider: result.provider, model: result.model, costUsd: result.costUsd, text: result.text.slice(0, 400), flags: result.flags };
  }],

  ['GET', /^\/api\/agents$/, () => q('SELECT id, name, role_group, model_tier, status, human_owner FROM agents ORDER BY role_group, id')
    .map((a) => ({ ...a, spec: getAgentSpec(a.id), accuracy: accuracyFactor(a.id) }))],

  ['POST', /^\/api\/agents\/([\w-]+)\/status$/, ([id], body) => {
    const status = need(body, 'status');
    const actor = need(body, 'actor');
    if (!['active', 'suspended'].includes(status)) throw new HttpError(400, 'status must be active|suspended');
    exec('UPDATE agents SET status = ? WHERE id = ?', status, id);
    audit({ actorType: 'human', actorId: actor, action: `agent.${status}`, subjectType: 'agent', subjectId: id });
    return { ok: true };
  }],

  ['GET', /^\/api\/runs$/, (_p, _b, url) => {
    const state = url.searchParams.get('state');
    const rows = state
      ? q('SELECT * FROM runs WHERE state = ? ORDER BY created_at DESC LIMIT 200', state)
      : q('SELECT * FROM runs ORDER BY created_at DESC LIMIT 200');
    return rows.map((r) => ({ ...r, input: r.input ? JSON.parse(r.input) : null, output: r.output ? JSON.parse(r.output) : null, flags: r.flags ? JSON.parse(r.flags) : [] }));
  }],

  ['POST', /^\/api\/runs$/, (_p, body) => {
    const id = enqueueRun({
      agentId: need(body, 'agentId'),
      taskType: need(body, 'taskType'),
      input: { prompt: need(body, 'prompt'), context: body.context || null },
      decisionId: body.decisionId || null,
      actor: body.actor || 'human:admin',
    });
    return { ok: true, runId: id };
  }],

  ['POST', /^\/api\/runs\/([\w-]+)\/resolve$/, ([id], body) =>
    resolveRun(id, need(body, 'verdict'), need(body, 'actor'), body.note || null)],

  ['GET', /^\/api\/decisions$/, () => listDecisions()],
  ['GET', /^\/api\/decisions\/([\w-]+)$/, ([id]) => getDecision(id) || (() => { throw new HttpError(404, 'not found'); })()],

  ['POST', /^\/api\/decisions$/, (_p, body) => createDecision({
    title: need(body, 'title'), tier: need(body, 'tier'), owner: need(body, 'owner'),
    context: body.context || null, deadline: body.deadline || null, expiresAt: body.expiresAt || null,
    actor: body.actor || 'human:admin',
  })],

  ['POST', /^\/api\/decisions\/([\w-]+)\/evidence$/, ([id], body) => {
    addEvidence(id, { claim: need(body, 'claim'), sourceRef: need(body, 'sourceRef'), expiresAt: body.expiresAt || null, addedBy: body.addedBy || 'human:admin' });
    return getDecision(id);
  }],

  ['POST', /^\/api\/evidence\/(\d+)\/verify$/, ([id], body) => {
    verifyEvidence(Number(id), need(body, 'actor'));
    return { ok: true };
  }],

  ['POST', /^\/api\/decisions\/([\w-]+)\/tribunal$/, async ([id], body) =>
    runMiniTribunal(id, { proposal: body.proposal, critics: body.critics })],

  ['POST', /^\/api\/decisions\/([\w-]+)\/decide$/, ([id], body) =>
    decideDecision(id, { verdict: need(body, 'verdict'), approver: need(body, 'actor'), note: body.note || null })],

  ['POST', /^\/api\/sweep$/, () => expirySweep()],

  ['GET', /^\/api\/budgets$/, () => q('SELECT * FROM budgets ORDER BY scope, scope_id, period_key DESC')],
  ['POST', /^\/api\/budgets\/freeze$/, (_p, body) => {
    setFrozen(need(body, 'scope'), need(body, 'scopeId'), Boolean(body.frozen), need(body, 'actor'));
    return { ok: true };
  }],

  ['GET', /^\/api\/audit$/, (_p, _b, url) => {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    return q('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?', limit)
      .map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null }));
  }],
  ['GET', /^\/api\/audit\/verify$/, () => verifyChain()],

  ['GET', /^\/api\/pipeline-templates$/, () => listTemplates()],
  ['GET', /^\/api\/pipelines$/, () => listPipelines()],
  ['GET', /^\/api\/pipelines\/([\w-]+)$/, ([id]) => getPipeline(id) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/pipelines$/, (_p, body) => createPipeline({
    template: need(body, 'template'), goal: need(body, 'goal'), productId: body.productId || null, actor: body.actor || 'human:admin',
  })],
  ['POST', /^\/api\/pipelines\/([\w-]+)\/cancel$/, ([id], body) => cancelPipeline(id, need(body, 'actor'))],

  ['POST', /^\/api\/runs\/([\w-]+)\/apply$/, ([id], body) => ({ written: applyRunFiles(id, need(body, 'actor')) })],
  ['GET', /^\/api\/artifacts$/, () => listArtifacts()],
  ['GET', /^\/api\/artifacts\/file$/, (_p, _b, url) => readArtifact(url.searchParams.get('path') || '')],

  // --- Product Factory ---
  ['GET', /^\/api\/products$/, () => listProducts()],
  ['POST', /^\/api\/products$/, (_p, body) => createProduct({ name: need(body, 'name'), description: body.description || '', actor: need(body, 'actor') })],
  ['GET', /^\/api\/products\/([\w-]+)$/, ([id]) => getProduct(id) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/products\/([\w-]+)\/advance$/, ([id], body) => advanceGate(id, { note: need(body, 'note'), decisionId: body.decisionId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/products\/([\w-]+)\/retire$/, ([id], body) => retireProduct(id, { note: need(body, 'note'), actor: need(body, 'actor') })],

  // --- Incidents ---
  ['GET', /^\/api\/incidents$/, () => listIncidents()],
  ['POST', /^\/api\/incidents$/, (_p, body) => declareIncident({ sev: need(body, 'sev'), title: need(body, 'title'), commander: need(body, 'commander'), productId: body.productId || null, note: body.note || '', actor: need(body, 'actor') })],
  ['POST', /^\/api\/incidents\/(\d+)\/update$/, ([id], body) => addIncidentUpdate(Number(id), { note: need(body, 'note'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/incidents\/(\d+)\/state$/, ([id], body) => setIncidentState(Number(id), { state: need(body, 'state'), postmortem: body.postmortem || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/incidents\/(\d+)\/postmortem-pipeline$/, ([id], body) => startPostmortemPipeline(Number(id), need(body, 'actor'))],

  // --- Support desk ---
  ['GET', /^\/api\/tickets$/, () => listTickets()],
  ['POST', /^\/api\/tickets$/, (_p, body) => createTicket({ customer: need(body, 'customer'), category: body.category || 'general', subject: need(body, 'subject'), body: need(body, 'body'), productId: body.productId || null })],
  ['POST', /^\/api\/tickets\/(\d+)\/incident$/, ([id], body) => raiseIncidentFromTicket(Number(id), { sev: need(body, 'sev'), commander: need(body, 'commander'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/tickets\/(\d+)\/send$/, ([id], body) => sendTicket(Number(id), { body: body.body ?? null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/tickets\/(\d+)\/close$/, ([id], body) => closeTicket(Number(id), { actor: need(body, 'actor') })],
  ['GET', /^\/api\/support\/stats$/, () => supportStats()],

  // --- Evals & reputation ---
  ['GET', /^\/api\/evals$/, () => ({ sets: listSets(), runs: listEvalRuns() })],
  ['POST', /^\/api\/evals\/run$/, async (_p, body) => runEvalSet(need(body, 'agentId'), need(body, 'actor'))],

  // --- Immune system / problems ---
  ['GET', /^\/api\/problems$/, () => listProblems()],
  ['POST', /^\/api\/problems\/(\d+)\/resolve$/, ([id], body) => { resolveProblem(Number(id), { note: body.note || null, actor: need(body, 'actor') }); return { ok: true }; }],

  // --- Governance calendar ---
  ['GET', /^\/api\/rituals$/, () => listRituals()],
  ['POST', /^\/api\/rituals\/([\w-]+)\/complete$/, ([id], body) => completeRitual(id, { note: need(body, 'note'), actor: need(body, 'actor') })],

  // --- Finance ---
  ['GET', /^\/api\/finance$/, (_p, _b, url) => financeReport(url.searchParams.get('month'))],
  ['POST', /^\/api\/finance\/export$/, (_p, body) => exportFinanceReport(need(body, 'actor'))],

  // --- Notifications ---
  ['GET', /^\/api\/notifications$/, (_p, _b, url) => ({ unread: unreadCount(), items: listNotifications({ unreadOnly: url.searchParams.get('unread') === '1' }) })],
  ['POST', /^\/api\/notifications\/read$/, () => { markAllRead(); return { ok: true }; }],

  // --- Planning: Projects / Tasks / Risks / Quality ---
  ['GET', /^\/api\/projects$/, () => listProjects()],
  ['POST', /^\/api\/projects$/, (_p, body) => createProject({ name: need(body, 'name'), description: body.description || null, owner: body.owner || need(body, 'actor'), productId: body.productId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/projects\/([\w-]+)\/state$/, ([id], body) => { setProjectState(id, { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/tasks$/, () => listTasks()],
  ['POST', /^\/api\/tasks$/, (_p, body) => createTask({ title: need(body, 'title'), details: body.details || null, projectId: body.projectId || null, assigneeType: body.assigneeType || 'human', assigneeId: body.assigneeId || null, priority: body.priority || 'normal', dueDate: body.dueDate || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/tasks\/(\d+)\/state$/, ([id], body) => setTaskState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') })],
  ['GET', /^\/api\/risks$/, () => listRisks()],
  ['POST', /^\/api\/risks$/, (_p, body) => ({ id: createRisk({ title: need(body, 'title'), likelihood: body.likelihood, impact: body.impact, mitigation: body.mitigation || null, owner: body.owner || need(body, 'actor'), reviewDate: body.reviewDate || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/risks\/(\d+)\/state$/, ([id], body) => { setRiskState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/quality$/, () => qualityDashboard()],
  ['POST', /^\/api\/quality\/review$/, (_p, body) => ({ id: addQualityReview({ area: need(body, 'area'), verdict: need(body, 'verdict'), notes: body.notes || null, actor: need(body, 'actor') }) })],

  // --- Admin: Users & Settings (superadmin-grade permissions) ---
  ['GET', /^\/api\/oversight$/, () => ({
    approvals: q(`SELECT a.*, r.agent_id FROM approvals a LEFT JOIN runs r ON r.id = a.subject_id AND a.subject_type = 'run' ORDER BY a.id DESC LIMIT 100`),
    suspendedAgents: q("SELECT id, name, human_owner FROM agents WHERE status = 'suspended'"),
    frozenBudgets: q('SELECT scope, scope_id, period_key, spent_usd, cap_usd FROM budgets WHERE frozen = 1'),
    humanActions7d: q(`SELECT actor_id, COUNT(*) AS n FROM audit_log WHERE actor_type = 'human' AND occurred_at >= datetime('now','-7 days') GROUP BY actor_id ORDER BY n DESC`),
    chain: verifyChain(),
  })],
  ['GET', /^\/api\/perms$/, () => PERMS],
  ['GET', /^\/api\/users$/, () => listUsers()],
  ['POST', /^\/api\/users$/, (_p, body) => ({ id: createUser({ username: need(body, 'username'), displayName: body.displayName || null, password: need(body, 'password'), perms: body.perms || [], actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/users\/(\d+)\/update$/, ([id], body) => { updateUser(Number(id), { perms: body.perms ?? null, status: body.status ?? null, password: body.password ?? null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/settings$/, () => settingsOverview()],
  ['POST', /^\/api\/settings$/, (_p, body) => {
    setSetting(need(body, 'key'), body.value ?? null);
    audit({ actorType: 'human', actorId: need(body, 'actor'), action: 'settings.updated', subjectType: 'settings', subjectId: body.key, payload: { cleared: !body.value } });
    return settingsOverview();
  }],

  // --- Data Division: Intelligence ---
  ['GET', /^\/api\/intel$/, () => listIntelQueries()],
  ['GET', /^\/api\/intel\/(\d+)$/, ([id]) => getIntelQuery(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/intel$/, (_p, body) => createIntelQuery({ question: need(body, 'question'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/records\/(\d+)\/verify$/, ([id], body) => { verifyIntelRecord(Number(id), need(body, 'actor')); return { ok: true }; }],
  ['POST', /^\/api\/intel\/records\/(\d+)\/target$/, ([id], body) => targetIntelRecord(Number(id), { productId: body.productId || null, actor: need(body, 'actor') })],
  ['GET', /^\/api\/intel\/export$/, (_p, _b, url) => {
    const r = exportIntelCsv({
      queryId: url.searchParams.get('queryId') ? Number(url.searchParams.get('queryId')) : null,
      segmentId: url.searchParams.get('segmentId') ? Number(url.searchParams.get('segmentId')) : null,
      actor: url.searchParams.get('actor') || 'human:admin',
    });
    return { __raw: { contentType: 'text/csv; charset=utf-8', filename: r.filename, body: r.csv } };
  }],

  // --- Data Division: Segments ---
  ['GET', /^\/api\/segments$/, () => listSegments()],
  ['POST', /^\/api\/segments$/, (_p, body) => ({ id: createSegment({ name: need(body, 'name'), description: body.description || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/segments\/(\d+)\/members$/, ([id], body) => { addToSegment(Number(id), Number(need(body, 'recordId')), need(body, 'actor')); return { ok: true }; }],
  ['POST', /^\/api\/intel\/(\d+)\/auto-segment$/, ([id], body) => ({ runId: autoSegment(Number(id), need(body, 'actor')) })],

  // --- Data Division: Datasets ---
  ['GET', /^\/api\/datasets$/, () => listDatasets()],
  ['GET', /^\/api\/datasets\/(\d+)$/, ([id]) => { const d = getDataset(Number(id)); if (!d) throw new HttpError(404, 'not found'); return { ...d, result: d.result ? JSON.parse(d.result) : null }; }],
  ['POST', /^\/api\/datasets$/, (_p, body) => createDataset({ name: need(body, 'name'), raw: need(body, 'raw'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/datasets\/(\d+)\/transform$/, ([id], body) => transformDataset(Number(id), { op: need(body, 'op'), actor: need(body, 'actor') })],

  // --- Data Division: Archive ---
  ['GET', /^\/api\/archive$/, () => listArchive()],
  ['GET', /^\/api\/archive\/(\d+)$/, ([id]) => getArchiveItem(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/archive$/, (_p, body) => ({ id: archiveItem({ title: need(body, 'title'), kind: 'manual', snapshot: body.snapshot || null, actor: need(body, 'actor') }) })],

  // --- Marketing ---
  ['GET', /^\/api\/campaigns$/, () => listCampaigns()],
  ['POST', /^\/api\/campaigns$/, (_p, body) => createCampaign({ name: need(body, 'name'), channel: body.channel || 'landing', productId: body.productId || null, budgetUsd: body.budgetUsd || 0, brief: need(body, 'brief'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/campaigns\/(\d+)\/approve$/, ([id], body) => approveCampaign(Number(id), { copy: body.copy ?? null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/campaigns\/(\d+)\/update$/, ([id], body) => updateCampaign(Number(id), { state: body.state ?? null, spentUsd: body.spentUsd ?? null, signups: body.signups ?? null, qualified: body.qualified ?? null, actor: need(body, 'actor') })],

  // --- Customers (CRM) ---
  ['GET', /^\/api\/customers$/, () => ({ stats: crmStats(), items: listCustomers() })],
  ['POST', /^\/api\/customers$/, (_p, body) => createCustomer({ name: need(body, 'name'), company: body.company || null, plan: body.plan || 'trial', mrrUsd: body.mrrUsd || 0, state: body.state || 'lead', productId: body.productId || null, campaignId: body.campaignId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/customers\/(\d+)\/update$/, ([id], body) => updateCustomer(Number(id), { state: body.state ?? null, plan: body.plan ?? null, mrrUsd: body.mrrUsd ?? null, actor: need(body, 'actor') })],

  // --- Legal & Compliance ---
  ['GET', /^\/api\/contracts$/, () => listContracts()],
  ['POST', /^\/api\/contracts$/, (_p, body) => createContract({ kind: body.kind || 'contract', title: need(body, 'title'), counterparty: need(body, 'counterparty'), risk: body.risk || null, reviewDue: body.reviewDue || null, vendorId: body.vendorId || null, productId: body.productId || null, decisionId: body.decisionId || null, summary: body.summary || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/contracts\/(\d+)\/state$/, ([id], body) => setContractState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') })],

  // --- Vendors ---
  ['GET', /^\/api\/vendors$/, () => listVendors()],
  ['POST', /^\/api\/vendors$/, (_p, body) => createVendor({ name: need(body, 'name'), service: need(body, 'service'), monthlyUsd: body.monthlyUsd || 0, renewalDate: body.renewalDate || null, owner: body.owner || 'CEO', actor: need(body, 'actor') })],
  ['POST', /^\/api\/vendors\/([\w-]+)\/state$/, ([id], body) => { setVendorState(id, { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],

  // --- People (HR) ---
  ['GET', /^\/api\/people$/, () => listPeople()],
  ['POST', /^\/api\/people$/, (_p, body) => createPerson({ name: need(body, 'name'), role: need(body, 'role'), type: body.type || 'hire', actorId: body.actorId || null, deputyId: body.deputyId || null, actor: need(body, 'actor') })],

  // --- Knowledge ---
  ['GET', /^\/api\/knowledge$/, () => listKnowledge()],
  ['POST', /^\/api\/knowledge$/, (_p, body) => ({ id: addKnowledge({ layer: body.layer || 'org', content: need(body, 'content'), sourceRef: need(body, 'sourceRef'), classification: body.classification || 'internal', createdBy: need(body, 'actor') }) })],
  ['POST', /^\/api\/knowledge\/(\d+)\/verification$/, ([id], body) => { setKnowledgeVerification(Number(id), { verification: need(body, 'verification'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/incidents\/(\d+)\/lesson$/, ([id], body) => ({ id: lessonFromIncident(Number(id), { content: need(body, 'content'), actor: need(body, 'actor') }) })],

  // --- Objectives (OKRs) ---
  ['GET', /^\/api\/objectives$/, () => listObjectives()],
  ['POST', /^\/api\/objectives$/, (_p, body) => createObjective({ title: need(body, 'title'), quarter: need(body, 'quarter'), owner: need(body, 'owner'), productId: body.productId || null, krs: body.krs || [], actor: need(body, 'actor') })],
  ['POST', /^\/api\/objectives\/([\w-]+)\/update$/, ([id], body) => updateObjective(id, { krs: body.krs ?? null, state: body.state ?? null, actor: need(body, 'actor') })],

  ['GET', /^\/api\/memory$/, () => q('SELECT * FROM memory_entries ORDER BY id DESC LIMIT 200')],
  ['POST', /^\/api\/memory$/, (_p, body) => {
    exec('INSERT INTO memory_entries (layer, classification, content, source_ref, created_by) VALUES (?,?,?,?,?)',
      body.layer || 'org', body.classification || 'internal', need(body, 'content'), need(body, 'sourceRef'), body.createdBy || 'human:admin');
    return { ok: true };
  }],
];

/** Path → permission key. One permission per capability; superadmin holds "*". */
function permFor(m, path) {
  const is = (re) => re.test(path);
  if (['/api/health', '/api/stats', '/api/audit/verify', '/api/notifications'].includes(path)) return 'dashboard.view';
  if (path === '/api/notifications/read') return 'notifications.read';
  if (path === '/api/providers') return 'providers.view';
  if (path === '/api/providers/test') return 'providers.test';
  if (is(/^\/api\/agents\/[\w-]+\/status$/)) return 'agents.manage';
  if (path === '/api/agents') return 'agents.view';
  if (is(/^\/api\/runs\/[\w-]+\/resolve$/)) return 'gate.resolve';
  if (is(/^\/api\/runs\/[\w-]+\/apply$/)) return 'runs.apply';
  if (path === '/api/runs') return m === 'GET' ? 'runs.view' : 'runs.create';
  if (path === '/api/pipeline-templates') return 'pipelines.view';
  if (is(/^\/api\/pipelines\/[\w-]+\/cancel$/)) return 'pipelines.cancel';
  if (path.startsWith('/api/pipelines')) return m === 'GET' ? 'pipelines.view' : 'pipelines.create';
  if (is(/\/tribunal$/)) return 'decisions.tribunal';
  if (is(/^\/api\/decisions\/[\w-]+\/decide$/)) return 'decisions.decide';
  if (is(/^\/api\/decisions\/[\w-]+\/evidence$/)) return 'decisions.evidence';
  if (is(/^\/api\/evidence\/\d+\/verify$/)) return 'decisions.verify';
  if (path.startsWith('/api/decisions') || path === '/api/sweep') return m === 'GET' ? 'decisions.view' : 'decisions.create';
  if (path === '/api/budgets') return 'budgets.view';
  if (path === '/api/budgets/freeze') return 'budgets.freeze';
  if (path.startsWith('/api/audit')) return 'audit.view';
  if (path.startsWith('/api/products')) return m === 'GET' ? 'products.view' : 'products.manage';
  if (is(/^\/api\/incidents\/\d+\/lesson$/)) return 'knowledge.manage';
  if (path.startsWith('/api/incidents')) return m === 'GET' ? 'incidents.view' : 'incidents.manage';
  if (path === '/api/support/stats') return 'support.view';
  if (path.startsWith('/api/tickets')) return m === 'GET' ? 'support.view' : 'support.manage';
  if (path === '/api/evals/run') return 'evals.run';
  if (path === '/api/evals') return 'evals.view';
  if (is(/^\/api\/problems\/\d+\/resolve$/)) return 'problems.resolve';
  if (path === '/api/problems') return 'oversight.view';
  if (is(/^\/api\/rituals\/[\w-]+\/complete$/)) return 'rituals.complete';
  if (path === '/api/rituals') return 'governance.view';
  if (path === '/api/finance/export') return 'finance.export';
  if (path === '/api/finance') return 'finance.view';
  if (path.startsWith('/api/campaigns')) return m === 'GET' ? 'marketing.view' : 'marketing.manage';
  if (path.startsWith('/api/customers')) return m === 'GET' ? 'customers.view' : 'customers.manage';
  if (path.startsWith('/api/contracts')) return m === 'GET' ? 'legal.view' : 'legal.manage';
  if (path.startsWith('/api/vendors')) return m === 'GET' ? 'vendors.view' : 'vendors.manage';
  if (path.startsWith('/api/people')) return m === 'GET' ? 'people.view' : 'people.manage';
  if (path.startsWith('/api/knowledge') || path.startsWith('/api/memory')) return m === 'GET' ? 'knowledge.view' : 'knowledge.manage';
  if (path.startsWith('/api/objectives')) return m === 'GET' ? 'objectives.view' : 'objectives.manage';
  if (path === '/api/intel/export') return 'intel.view';
  if (is(/\/auto-segment$/)) return 'segments.manage';
  if (path.startsWith('/api/intel')) return m === 'GET' ? 'intel.view' : 'intel.manage';
  if (path.startsWith('/api/segments')) return m === 'GET' ? 'segments.view' : 'segments.manage';
  if (path.startsWith('/api/datasets')) return m === 'GET' ? 'datasets.view' : 'datasets.manage';
  if (path.startsWith('/api/archive')) return m === 'GET' ? 'archive.view' : 'archive.manage';
  if (path.startsWith('/api/projects')) return m === 'GET' ? 'projects.view' : 'projects.manage';
  if (path.startsWith('/api/tasks')) return m === 'GET' ? 'tasks.view' : 'tasks.manage';
  if (path.startsWith('/api/risks')) return m === 'GET' ? 'risks.view' : 'risks.manage';
  if (path.startsWith('/api/quality')) return m === 'GET' ? 'quality.view' : 'quality.manage';
  if (path === '/api/perms' || path.startsWith('/api/users')) return 'users.manage';
  if (path.startsWith('/api/settings')) return 'settings.manage';
  return 'dashboard.view';
}

export async function handleApi(req, res, url, body, user) {
  const perm = permFor(req.method, url.pathname);
  if (perm && !hasPerm(user, perm)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `permission required: ${perm}` }));
    return true;
  }
  // Identity is never client-supplied: the session decides who acted.
  const actorId = `human:${user.username}`;
  if (body && typeof body === 'object') body.actor = actorId;
  url.searchParams.set('actor', actorId);

  for (const [method, pattern, handler] of routes) {
    if (req.method !== method) continue;
    const m = url.pathname.match(pattern);
    if (!m) continue;
    try {
      const result = await handler(m.slice(1), body, url);
      if (result?.__raw) {
        res.writeHead(200, {
          'content-type': result.__raw.contentType,
          'content-disposition': `attachment; filename="${result.__raw.filename}"`,
        });
        res.end(result.__raw.body);
        return true;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const status = err.status || (err.name === 'BudgetExceeded' ? 402 : 500);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
