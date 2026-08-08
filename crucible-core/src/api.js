// REST API — thin JSON layer over the modules. Human actions (approvals,
// evidence verification, decisions, freezes) require an `actor` field naming
// the human; the audit log records it. No agent path can reach these handlers.
import { q, one } from './db.js';
import { verifyChain, audit } from './audit.js';
import { providersConfig, budgetsConfig } from './env.js';
import { isProviderAvailable as providerAvailable, isMockMode as mockMode, settingsOverview, setSetting } from './settings.js';
import { PERMS, hasPerm, listUsers, createUser, updateUser, verifyPassword } from './auth.js';
import { wipeSystem } from './wipe.js';
import { activityFeed } from './links.js';
import {
  treasuryOverview, addWallet, retireWallet, createInvoice, cancelInvoice,
  preparePayout, resolvePayout,
} from './wallet.js';
import {
  commsOverview, addNumber, scheduleCall, placeCall, dispositionCall,
  sendMessage, deliverMessage,
} from './comms.js';
import { moneyDesk, setPolicy, recordMove } from './money.js';
import {
  marketingDesk, createPersona, setPersonaState, createPositioning, approvePositioning,
  planChannel, recordChannelResult, planContent, commissionContent, researchKeywords,
  createSequence, setSequenceState,
  // The rest of the department: the six desks that had no page of their own,
  // and the six functions the company did not have at all.
  planEvent, recordEvent, eventsDesk,
  draftPress, approvePress, recordCoverage, pressDesk,
  addCommunityMember, setCommunityRole, communityDesk,
  recordTouch, attribution,
  draftPage, setPageState, recordPageResult, pagesDesk,
  setOpsEntry, opsDesk,
  seoDesk, paidDesk, lifecycleDesk, calendarDesk,
} from './marketing.js';
import {
  chatOverview, messages as chatMessages, post as chatPost, markRead as chatMarkRead,
  openDm as chatOpenDm, react as chatReact, editMessage as chatEdit, pin as chatPin,
  deleteMessage as chatDelete, search as chatSearch,
} from './chat.js';
import {
  METHODS, DEPARTMENTS as CYCLE_DEPARTMENTS, createWorkstream, listWorkstreams, getWorkstream,
  addWorkstreamNote, rerunWorkstream, closeWorkstream,
  requestAudit, auditorOverview,
  listSprints, createSprint, assignToSprint, setSprintState,
} from './cycles.js';
import {
  memoryOverview, agentMemory, search as memSearch, remember, forget,
  readPlaybook, writePlaybook, startReflection, verifyLesson,
} from './memory.js';
import {
  securityOverview, securityScan, setSecurityState,
  complianceOverview, addComplianceCheck, sustainabilityOverview, capacityOverview,
  listExperiments, createExperiment, concludeExperiment,
  listReleases, draftRelease, publishRelease,
  pmoOverview, createGate, resolveGate, insightsOverview,
  listBrandAssets, createBrandAsset, approveBrandAsset,
  listPurchases, createPurchase, resolvePurchase, finopsOverview,
  listCandidates, createOpening, trialCandidate, decideCandidate, workforceGaps, autoRecruit,
  academyOverview, createCurriculum, setCurriculumState,
  listInvestorUpdates, generateInvestorUpdate, sendInvestorUpdate,
  listBoardRecords, generateBoardPacket, holdBoardMeeting,
  listBulletins, generateBulletin, publishBulletin,
} from './expansion.js';
import {
  createProject, listProjects, setProjectState,
  createTask, listTasks, setTaskState,
  listRisks, createRisk, setRiskState,
  qualityDashboard, addQualityReview,
} from './pm.js';
import { setFrozen } from './policy.js';
// The outside world.
import { listSecrets, putSecret, dropSecret, getSecret as vaultGet } from './vault.js';
import {
  DRIVERS, addConnector, connect, setConnectorState, setAllowlist,
  getConnector, connectorsOverview, callConnector,
} from './connectors/index.js';
import { authorizeUrl } from './connectors/oauth.js';
import { getSetting } from './settings.js';
import { egressOverview, releaseGated, denyGated, grantScope, revokeScope, scopesFor } from './egress.js';
import { jobsOverview, retryJob, cancelJob } from './jobs.js';
import { webOverview, readFetch, fetchPage, searchWeb, browsePage } from './web.js';
import { mcpOverview, registerServer, syncServer, callTool, allTools, CRUCIBLE_TOOLS } from './mcp.js';
import { constitutionOverview, amendConstitution, retireRule } from './constitution.js';
import { provenanceOverview, sealFinishedWork, verifyStored, verifyReceipt } from './provenance.js';
import { timeMachineOverview, takeSnapshot, standAt, replay, reopenDecision } from './timemachine.js';
import { simulationOverview, readSimulation, startSimulation, discardSimulation } from './simulation.js';
import { skillsOverview, proposeSkill, trialSkill, inviteProposals, runTournament } from './skills.js';
import { redteamOverview, runRedTeam, markFixed } from './redteam.js';
import { graphOverview, rebuildGraph, semanticSearch, neighbourhood } from './graph.js';
import { revenueOverview, sourceFromIntel, revenueTick, sendOutreach, invoiceDeal } from './revenue.js';
// The platform.
import { tenantsOverview, getTenant, createTenant, startTenant, stopTenant, deleteTenant } from './tenants.js';
import { apiKeysOverview, createKey, revokeKey } from './apikeys.js';
import { webhooksOverview, addWebhook, setWebhookState, removeWebhook } from './webhooks.js';
import { packagesOverview, getPackage, addPackage, validateManifest, installPackage, uninstallPackage } from './packages.js';
import { chiefOverview, chiefTick } from './chief.js';
import { observeOverview, observeTick } from './observe.js';
import { backupsOverview, takeBackup, verifyBackup, restoreBackup, exportAll } from './backup.js';
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
  createSegment, listSegments, getSegment, addToSegment, removeFromSegment, buildSegment, segmentToCampaign, autoSegment,
  createDataset, listDatasets, getDataset, transformDataset, datasetFromSource, listInternalSources,
  listArchive, getArchiveItem, archiveItem, archiveStats,
} from './data.js';
import { connectionsFor, relationshipMatrix, sectionCatalog, DIVISIONS, connectivityAudit, flowStats } from './links.js';
import { maestroOverview, startCycle, getCycle, setEnabled as setMaestro, setMode as setMaestroMode, assessCompany, harmonyScore, remediations, boostHarmony } from './maestro.js';
import {
  createPricing, listPricing, setPricingState, approvedPricing,
  assessCustomer, listCustomerHealth, successOverview,
  createAsset, listAssets, setAssetState,
  createLocalization, listLocalizations, approveLocalization,
  addCompetitor, listCompetitors, setCompetitorThreat, checkCompetitorSite,
  createEnablement, listEnablement, setEnablementState,
} from './departments.js';
import { orgDirectory, updateAgentProfile } from './org.js';
import { raiseDispute, listDisputes, getDispute, ruleDispute, withdrawDispute, disputesOverview } from './disputes.js';
import { societyOverview, feed as societyFeed, relations as societyRelations, relationsFor, setSociety, forceScene, CHANNELS } from './society.js';
import { inboxSummary, inboxCount } from './inbox.js';
import { autonomyOverview, setAutonomy, revertDecision } from './autonomy.js';
import { DEPARTMENTS, createRequest, listRequests, getRequest, cancelRequest, signOffStep, requestDeliverable, requestsOverview } from './requests.js';
import {
  createIntelQuery, listIntelQueries, getIntelQuery, getIntelRecord, listIntelRecords,
  verifyIntelRecord, editIntelRecord, reEnrichRecord, targetIntelRecord, bulkTarget,
  exportIntelCsv, intelOverview, RULE_CATALOG, rerunRules, verifyContact,
} from './intel.js';
import {
  createContract, listContracts, setContractState,
  createVendor, listVendors, setVendorState,
  listPeople, createPerson,
  listKnowledge, addKnowledge, setKnowledgeVerification, lessonFromIncident,
  createObjective, listObjectives, updateObjective,
} from './corporate.js';
import {
  createPartner, listPartners, setPartnerState, setPartnerHealth,
  logInteraction, listInteractions, relationsOverview,
  draftOutreach, markOutreachSent,
} from './relations.js';
import { createJourney, listJourneys, getJourney, completeStage, cancelJourney, JOURNEY_STAGES } from './journey.js';
import { workforceBoard } from './workforce.js';
import {
  createChannel, listChannels, updateChannel,
  createPost, listPosts, schedulePost, publishPost, updatePostMetrics, cancelPost,
  createContent, listContent, approveContent,
  createDesign, listDesigns, approveDesign,
  studioOverview,
} from './studio.js';
import { createDeal, listDeals, setDealStage, draftProposal } from './sales.js';
import {
  DOC_CATALOG, createBlueprint, listBlueprints, getBlueprint, cancelBlueprint,
  redoDoc, approveDoc, buildBundle, buildAgentBrief,
} from './systemdesign.js';
import { INFRA_SECTIONS, createInfraPlan, listInfraPlans, getInfraPlan, infraOverview } from './infra.js';
import { REPORT_KINDS, createFinReport, listFinReports, getFinReport, approveFinReport, finReportsOverview, ownFinancials } from './finreports.js';
import { listAutomations, setAutomation, nexusFeed } from './nexus.js';

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

  // Everything in the company that is waiting on a person, in one queue.
  ['GET', /^\/api\/inbox$/, () => inboxSummary()],

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
      inboxTotal: inboxCount(),
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
  // --- Live map activity: the board's heartbeat ---
  ['GET', /^\/api\/map\/activity$/, (_p, _b, url) => activityFeed(Number(url.searchParams.get('since') || 0))],

  // --- Contact centre: numbers, voices, calls, messages ---
  ['GET', /^\/api\/contact$/, () => commsOverview()],
  ['POST', /^\/api\/contact\/numbers$/, (_p, body) => ({ id: addNumber({ number: need(body, 'number'), label: body.label || null, country: body.country || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/contact\/calls$/, (_p, body) => ({ id: scheduleCall({
    toNumber: need(body, 'toNumber'), purpose: need(body, 'purpose'), customerId: body.customerId || null,
    agentId: body.agentId || null, voice: body.voice || 'ava', language: body.language || 'en', actor: need(body, 'actor'),
  }) })],
  ['POST', /^\/api\/contact\/calls\/(\d+)\/place$/, ([id], body) => placeCall(Number(id), { actor: need(body, 'actor') })],
  ['POST', /^\/api\/contact\/calls\/(\d+)\/disposition$/, ([id], body) => { dispositionCall(Number(id), { outcome: need(body, 'outcome'), followUp: body.followUp || null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/contact\/messages$/, (_p, body) => ({ id: sendMessage({
    toNumber: need(body, 'toNumber'), body: body.body || null, channel: body.channel || 'sms',
    customerId: body.customerId || null, draftWith: body.draftWith || null, actor: need(body, 'actor'),
  }) })],
  ['POST', /^\/api\/contact\/messages\/(\d+)\/send$/, ([id], body) => deliverMessage(Number(id), { actor: need(body, 'actor') })],

  // --- Marketing: audience, promise, channels, calendar, search, lifecycle ---
  ['GET', /^\/api\/mkt$/, () => marketingDesk()],
  ['POST', /^\/api\/mkt\/personas$/, (_p, body) => ({ id: createPersona({ name: need(body, 'name'), segment: body.segment || null, evidence: body.evidence || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/mkt\/personas\/(\d+)\/state$/, ([id], body) => { setPersonaState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/mkt\/positioning$/, (_p, body) => ({ id: createPositioning({ audience: need(body, 'audience'), promise: need(body, 'promise'), productId: body.productId || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/mkt\/positioning\/(\d+)\/approve$/, ([id], body) => { approvePositioning(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/mkt\/channels$/, (_p, body) => ({ id: planChannel({ campaignId: need(body, 'campaignId'), channel: need(body, 'channel'), budgetUsd: body.budgetUsd || 0, notes: body.notes || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/mkt\/channels\/(\d+)$/, ([id], body) => { recordChannelResult(Number(id), { ...body, actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/mkt\/calendar$/, (_p, body) => ({ id: planContent({
    title: need(body, 'title'), channel: body.channel || 'blog', stage: body.stage || 'awareness',
    personaId: body.personaId || null, campaignId: body.campaignId || null, dueDate: body.dueDate || null,
    brief: body.brief || null, actor: need(body, 'actor'),
  }) })],
  ['POST', /^\/api\/mkt\/calendar\/(\d+)\/commission$/, ([id], body) => commissionContent(Number(id), { actor: need(body, 'actor') })],
  ['POST', /^\/api\/mkt\/seo$/, (_p, body) => researchKeywords({ topic: need(body, 'topic'), language: body.language || 'en', actor: need(body, 'actor') })],
  ['POST', /^\/api\/mkt\/sequences$/, (_p, body) => ({ id: createSequence({ name: need(body, 'name'), goal: need(body, 'goal'), audience: body.audience || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/mkt\/sequences\/(\d+)\/state$/, ([id], body) => { setSequenceState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],

  // --- The money desk: position, runway, allocation policy ---
  ['GET', /^\/api\/money$/, () => moneyDesk()],
  ['POST', /^\/api\/money\/policy$/, (_p, body) => ({ id: setPolicy({
    reserve: need(body, 'reserve'), opex: need(body, 'opex'), growth: need(body, 'growth'),
    minRunway: body.minRunway || 6, note: body.note || null, actor: need(body, 'actor'),
  }) })],
  ['POST', /^\/api\/money\/moves$/, (_p, body) => ({ id: recordMove({
    kind: need(body, 'kind'), bucket: body.bucket || null, amount: body.amount || 0,
    asset: body.asset || 'USD', reason: need(body, 'reason'), actor: need(body, 'actor'),
  }) })],

  // --- Treasury: watch-only wallets, invoices, incoming payments ---
  ['GET', /^\/api\/treasury$/, () => treasuryOverview()],
  ['POST', /^\/api\/treasury\/wallets$/, (_p, body) => ({ id: addWallet({
    label: need(body, 'label'), chain: need(body, 'chain'), address: need(body, 'address'),
    asset: body.asset || null, kind: body.kind || 'receiving', actor: need(body, 'actor'),
  }) })],
  ['POST', /^\/api\/treasury\/wallets\/(\d+)\/retire$/, ([id], body) => { retireWallet(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/treasury\/invoices$/, (_p, body) => createInvoice({
    description: need(body, 'description'), amount: need(body, 'amount'), chain: body.chain || null,
    walletId: body.walletId || null, customerId: body.customerId || null, dealId: body.dealId || null,
    expiresHours: body.expiresHours || 72, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/treasury\/invoices\/(\d+)\/cancel$/, ([id], body) => { cancelInvoice(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/treasury\/payouts$/, (_p, body) => ({ id: preparePayout({
    toAddress: need(body, 'toAddress'), chain: need(body, 'chain'), asset: body.asset || null,
    amount: need(body, 'amount'), reason: need(body, 'reason'), actor: need(body, 'actor'),
  }) })],
  // Releasing money is the one action an agent identity can never perform: the
  // caller must be a signed-in person, not the autonomy loop.
  ['POST', /^\/api\/treasury\/payouts\/(\d+)\/resolve$/, ([id], body, _u, user) => {
    resolvePayout(Number(id), {
      state: need(body, 'state'), txHash: body.txHash || null,
      actor: need(body, 'actor'), isHuman: Boolean(user?.username),
    });
    return { ok: true };
  }],

  // --- The floor: humans and AI employees in the same rooms ---
  ['GET', /^\/api\/chat$/, (_p, _b, url) => chatOverview(url.searchParams.get('actor'))],
  ['GET', /^\/api\/chat\/(\d+)$/, ([id], _b, url) => ({
    channel: one('SELECT * FROM chat_channels WHERE id = ?', Number(id)),
    messages: chatMessages(Number(id), { since: Number(url.searchParams.get('since') || 0) }),
  })],
  ['POST', /^\/api\/chat\/(\d+)$/, ([id], body) => chatPost({
    channelId: Number(id), body: need(body, 'body'), parentId: body.parentId || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/chat\/(\d+)\/read$/, ([id], body) => chatMarkRead(Number(id), { actor: need(body, 'actor') })],
  ['POST', /^\/api\/chat\/dm$/, (_p, body) => chatOpenDm(need(body, 'actor'), need(body, 'with'))],
  ['POST', /^\/api\/chat\/msg\/(\d+)\/react$/, ([id], body) => chatReact(Number(id), { emoji: need(body, 'emoji'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/chat\/msg\/(\d+)\/edit$/, ([id], body) => { chatEdit(Number(id), { body: need(body, 'body'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/chat\/msg\/(\d+)\/pin$/, ([id], body) => chatPin(Number(id), { actor: need(body, 'actor') })],
  ['POST', /^\/api\/chat\/msg\/(\d+)\/delete$/, ([id], body, _u, user) => { chatDelete(Number(id), { actor: need(body, 'actor'), isOwner: Boolean(user?.isOwner) }); return { ok: true }; }],
  ['GET', /^\/api\/chat\/search$/, (_p, _b, url) => chatSearch(url.searchParams.get('q') || '')],

  // --- The iteration engine: workstreams, the universal auditor, sprints ---
  ['GET', /^\/api\/workstreams$/, () => ({ methods: METHODS, departments: CYCLE_DEPARTMENTS, workstreams: listWorkstreams() })],
  ['POST', /^\/api\/workstreams$/, (_p, body) => ({ id: createWorkstream({
    title: need(body, 'title'), goal: need(body, 'goal'), method: body.method || 'kaizen',
    route: body.route || null, qualityTarget: body.qualityTarget, maxCycles: body.maxCycles,
    reviewers: body.reviewers, subjectType: body.subjectType || null, subjectId: body.subjectId || null,
    actor: need(body, 'actor'),
  }) })],
  ['GET', /^\/api\/workstreams\/(\d+)$/, ([id]) => getWorkstream(Number(id)) || (() => { throw new HttpError(404, 'no such workstream'); })()],
  ['POST', /^\/api\/workstreams\/(\d+)\/note$/, ([id], body) => ({ id: addWorkstreamNote(Number(id), { body: need(body, 'body'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/workstreams\/(\d+)\/rerun$/, ([id], body) => { rerunWorkstream(Number(id), { note: body.note || null, dept: body.dept || null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/workstreams\/(\d+)\/close$/, ([id], body) => { closeWorkstream(Number(id), { verdict: need(body, 'verdict'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/auditor$/, () => auditorOverview()],
  ['POST', /^\/api\/auditor$/, (_p, body) => ({ id: requestAudit({
    subjectType: need(body, 'subjectType'), subjectId: need(body, 'subjectId'),
    dept: body.dept || null, title: body.title || null, content: body.content || null,
    criteria: body.criteria || null, context: body.context || null, actor: need(body, 'actor'),
  }) })],
  ['GET', /^\/api\/sprints$/, () => listSprints()],
  ['POST', /^\/api\/sprints$/, (_p, body) => ({ id: createSprint({ name: need(body, 'name'), goal: body.goal || null, startsOn: body.startsOn || null, endsOn: body.endsOn || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/sprints\/(\d+)\/assign$/, ([id], body) => { assignToSprint(Number(id), { taskId: Number(need(body, 'taskId')), points: body.points, actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/sprints\/(\d+)\/state$/, ([id], body) => { setSprintState(Number(id), { state: need(body, 'state'), retro: body.retro || null, actor: need(body, 'actor') }); return { ok: true }; }],

  // --- Agent memory: episodes, retrieval, playbooks, reflection ---
  ['GET', /^\/api\/memory$/, () => memoryOverview()],
  ['GET', /^\/api\/memory\/search$/, (_p, _b, url) => memSearch(url.searchParams.get('q') || '', {
    limit: Math.min(20, Number(url.searchParams.get('limit')) || 8),
    agentId: url.searchParams.get('agent') || null,
  })],
  ['GET', /^\/api\/memory\/agent\/([\w.-]+)$/, ([id]) => agentMemory(id)],
  ['GET', /^\/api\/memory\/playbook\/([\w.-]+)$/, ([id]) => ({ agentId: id, body: readPlaybook(id) })],
  ['POST', /^\/api\/memory\/playbook\/([\w.-]+)$/, ([id], body) => { writePlaybook(id, need(body, 'body'), { actor: need(body, 'actor'), reason: 'human edit' }); return { ok: true }; }],
  ['POST', /^\/api\/memory\/reflect\/([\w.-]+)$/, async ([id], body) => ({ id: await startReflection(id, { actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/memory\/(\d+)\/verify$/, ([id], body) => { verifyLesson(Number(id), { verdict: need(body, 'verdict'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/memory\/(\d+)\/forget$/, ([id], body) => { forget(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/memory$/, (_p, body) => ({ id: remember({
    kind: 'lesson', agentId: body.agentId || null, title: body.title || 'human note',
    body: need(body, 'body'), sourceType: 'human', verification: 'verified', createdBy: need(body, 'actor'),
  }) })],

  // --- Expansion wave: TRUST / CAPITAL / TALENT / EXEC + friends ---
  ['GET', /^\/api\/security$/, () => securityOverview()],
  ['POST', /^\/api\/security\/scan$/, (_p, body) => securityScan({ actor: need(body, 'actor') })],
  ['POST', /^\/api\/security\/(\d+)\/state$/, ([id], body) => { setSecurityState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/compliance$/, () => complianceOverview()],
  ['POST', /^\/api\/compliance\/check$/, (_p, body) => ({ id: addComplianceCheck({ area: need(body, 'area'), status: need(body, 'status'), note: body.note || null, actor: need(body, 'actor') }) })],
  ['GET', /^\/api\/sustainability$/, () => sustainabilityOverview()],
  ['GET', /^\/api\/capacity$/, () => capacityOverview()],
  ['GET', /^\/api\/lab$/, () => listExperiments()],
  ['POST', /^\/api\/lab$/, (_p, body) => ({ id: createExperiment({ name: need(body, 'name'), hypothesis: body.hypothesis || null, variantA: need(body, 'variantA'), variantB: need(body, 'variantB'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/lab\/(\d+)\/conclude$/, ([id], body) => { concludeExperiment(Number(id), { winner: need(body, 'winner'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/releases$/, () => listReleases()],
  ['POST', /^\/api\/releases$/, (_p, body) => ({ id: draftRelease({ version: need(body, 'version'), productId: body.productId || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/releases\/(\d+)\/publish$/, ([id], body) => { publishRelease(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/pmo$/, () => pmoOverview()],
  ['POST', /^\/api\/pmo$/, (_p, body) => ({ id: createGate({ projectId: need(body, 'projectId'), gate: need(body, 'gate'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/pmo\/(\d+)\/resolve$/, ([id], body) => { resolveGate(Number(id), { state: need(body, 'state'), note: body.note || null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/insights$/, () => insightsOverview()],
  ['GET', /^\/api\/brand$/, () => listBrandAssets()],
  ['POST', /^\/api\/brand$/, (_p, body) => ({ id: createBrandAsset({ kind: need(body, 'kind'), name: need(body, 'name'), content: body.content || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/brand\/(\d+)\/approve$/, ([id], body) => { approveBrandAsset(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/procurement$/, () => listPurchases()],
  ['POST', /^\/api\/procurement$/, (_p, body) => ({ id: createPurchase({ item: need(body, 'item'), vendorId: body.vendorId || null, amountUsd: body.amountUsd || 0, justification: body.justification || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/procurement\/(\d+)\/resolve$/, ([id], body) => { resolvePurchase(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/finops$/, () => finopsOverview()],
  ['GET', /^\/api\/recruiting$/, () => ({ candidates: listCandidates(), gaps: workforceGaps() })],
  ['POST', /^\/api\/recruiting\/auto$/, (_p, body) => autoRecruit({ actor: need(body, 'actor') })],
  ['POST', /^\/api\/recruiting$/, (_p, body) => ({ id: createOpening({ roleName: need(body, 'roleName'), brief: need(body, 'brief'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/recruiting\/(\d+)\/trial$/, ([id], body) => { trialCandidate(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/recruiting\/(\d+)\/decide$/, ([id], body) => decideCandidate(Number(id), { verdict: need(body, 'verdict'), actor: need(body, 'actor') })],
  ['GET', /^\/api\/academy$/, () => academyOverview()],
  ['POST', /^\/api\/academy$/, (_p, body) => ({ id: createCurriculum({ agentId: need(body, 'agentId'), title: need(body, 'title'), source: body.source || 'manual', actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/academy\/(\d+)\/state$/, ([id], body) => { setCurriculumState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/ir$/, () => listInvestorUpdates()],
  ['POST', /^\/api\/ir$/, (_p, body) => ({ id: generateInvestorUpdate({ period: need(body, 'period'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/ir\/(\d+)\/send$/, ([id], body) => { sendInvestorUpdate(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/board$/, () => listBoardRecords()],
  ['POST', /^\/api\/board$/, (_p, body) => ({ id: generateBoardPacket({ period: need(body, 'period'), actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/board\/(\d+)\/hold$/, ([id], body) => { holdBoardMeeting(Number(id), { resolutions: need(body, 'resolutions'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/comms$/, () => listBulletins()],
  ['POST', /^\/api\/comms$/, (_p, body) => ({ id: generateBulletin({ actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/comms\/(\d+)\/publish$/, ([id], body) => { publishBulletin(Number(id), { actor: need(body, 'actor') }); return { ok: true }; }],

  // Factory reset — superadmin only, re-authenticated, typed confirmation.
  ['POST', /^\/api\/system\/wipe$/, (_p, body, _url, user) => {
    if (user?.role !== 'superadmin') { const e = new Error('superadmin only'); e.status = 403; throw e; }
    if (body?.confirm !== 'WIPE ALL DATA') { const e = new Error('type the exact phrase: WIPE ALL DATA'); e.status = 400; throw e; }
    if (!verifyPassword(user.id, body.password)) { const e = new Error('password incorrect'); e.status = 403; throw e; }
    return wipeSystem({ actor: body.actor, full: Boolean(body.full), workspace: Boolean(body.workspace) });
  }],

  ['GET', /^\/api\/settings$/, () => settingsOverview()],
  ['POST', /^\/api\/settings$/, (_p, body) => {
    setSetting(need(body, 'key'), body.value ?? null);
    audit({ actorType: 'human', actorId: need(body, 'actor'), action: 'settings.updated', subjectType: 'settings', subjectId: body.key, payload: { cleared: !body.value } });
    return settingsOverview();
  }],

  // --- Data Division: Intelligence (multi-pass campaigns + web enrichment) ---
  ['GET', /^\/api\/intel$/, () => listIntelQueries()],
  ['GET', /^\/api\/intel\/overview$/, () => intelOverview()],
  ['GET', /^\/api\/intel\/rules$/, () => RULE_CATALOG],
  ['GET', /^\/api\/intel\/records$/, (_p, _b, url) => listIntelRecords({
    country: url.searchParams.get('country'), sector: url.searchParams.get('sector'),
    minCompleteness: url.searchParams.get('minCompleteness'),
    hasContact: url.searchParams.get('hasContact') === '1',
    verified: url.searchParams.get('verified') === '1',
  })],
  ['GET', /^\/api\/intel\/records\/(\d+)$/, ([id]) => getIntelRecord(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['GET', /^\/api\/intel\/(\d+)$/, ([id]) => getIntelQuery(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/intel$/, (_p, body) => createIntelQuery({ question: body.question || null, criteria: body.criteria || null, targetCount: body.targetCount || 15, rules: body.rules || null, constraints: body.constraints || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/records\/(\d+)\/rerun-rules$/, ([id], body) => rerunRules(Number(id), need(body, 'actor'))],
  ['POST', /^\/api\/intel\/contacts\/(\d+)\/verify$/, ([id], body) => verifyContact(Number(id), { verification: body.verification || 'verified', actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/records\/(\d+)\/verify$/, ([id], body) => { verifyIntelRecord(Number(id), need(body, 'actor')); return { ok: true }; }],
  ['POST', /^\/api\/intel\/records\/(\d+)\/edit$/, ([id], body) => editIntelRecord(Number(id), { email: body.email ?? null, phone: body.phone ?? null, address: body.address ?? null, website: body.website ?? null, linkedin: body.linkedin ?? null, notes: body.notes ?? null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/records\/(\d+)\/enrich$/, ([id], body) => reEnrichRecord(Number(id), { website: body.website || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/records\/(\d+)\/target$/, ([id], body) => targetIntelRecord(Number(id), { productId: body.productId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/bulk-target$/, (_p, body) => bulkTarget({ queryId: body.queryId || null, segmentId: body.segmentId || null, minCompleteness: body.minCompleteness || 0, verifiedOnly: body.verifiedOnly !== false, productId: body.productId || null, actor: need(body, 'actor') })],
  ['GET', /^\/api\/intel\/export$/, (_p, _b, url) => {
    const r = exportIntelCsv({
      queryId: url.searchParams.get('queryId') ? Number(url.searchParams.get('queryId')) : null,
      segmentId: url.searchParams.get('segmentId') ? Number(url.searchParams.get('segmentId')) : null,
      format: url.searchParams.get('format') || 'csv',
      actor: url.searchParams.get('actor') || 'human:admin',
    });
    return { __raw: { contentType: r.mime, filename: r.filename, body: r.body } };
  }],

  // --- Data Division: Segments ---
  ['GET', /^\/api\/segments$/, () => listSegments()],
  ['GET', /^\/api\/segments\/(\d+)$/, ([id]) => getSegment(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/segments$/, (_p, body) => ({ id: createSegment({ name: need(body, 'name'), description: body.description || null, actor: need(body, 'actor') }) })],
  ['POST', /^\/api\/segments\/build$/, (_p, body) => buildSegment({
    name: need(body, 'name'), description: body.description || null, country: body.country || null, sector: body.sector || null,
    minCompleteness: body.minCompleteness || null, contactableOnly: Boolean(body.contactableOnly), verifiedOnly: Boolean(body.verifiedOnly),
    queryId: body.queryId || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/segments\/(\d+)\/members$/, ([id], body) => { addToSegment(Number(id), Number(need(body, 'recordId')), need(body, 'actor')); return { ok: true }; }],
  ['POST', /^\/api\/segments\/(\d+)\/members\/remove$/, ([id], body) => { removeFromSegment(Number(id), Number(need(body, 'recordId')), need(body, 'actor')); return { ok: true }; }],
  ['POST', /^\/api\/segments\/(\d+)\/campaign$/, ([id], body) => segmentToCampaign(Number(id), { name: body.name || null, channel: body.channel || 'email', budgetUsd: body.budgetUsd || 0, actor: need(body, 'actor') })],
  ['POST', /^\/api\/intel\/(\d+)\/auto-segment$/, ([id], body) => ({ runId: autoSegment(Number(id), need(body, 'actor')) })],

  // --- Data Division: Datasets ---
  ['GET', /^\/api\/datasets$/, () => listDatasets()],
  ['GET', /^\/api\/datasets\/sources$/, () => listInternalSources()],
  ['GET', /^\/api\/datasets\/(\d+)$/, ([id]) => { const d = getDataset(Number(id)); if (!d) throw new HttpError(404, 'not found'); return { ...d, result: d.result ? JSON.parse(d.result) : null }; }],
  ['POST', /^\/api\/datasets$/, (_p, body) => createDataset({ name: need(body, 'name'), raw: need(body, 'raw'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/datasets\/from-source$/, (_p, body) => datasetFromSource({ source: need(body, 'source'), name: body.name || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/datasets\/(\d+)\/transform$/, ([id], body) => transformDataset(Number(id), { op: need(body, 'op'), actor: need(body, 'actor') })],

  // --- Connections: what links to what, anywhere in the company ---
  ['GET', /^\/api\/links\/([\w-]+)\/([\w.-]+)$/, ([type, id]) => connectionsFor(type, /^\d+$/.test(id) ? Number(id) : id) || (() => { throw new HttpError(404, 'no such entity type'); })()],
  ['GET', /^\/api\/graph$/, () => relationshipMatrix()],
  ['GET', /^\/api\/map$/, () => ({
    divisions: DIVISIONS,
    sections: sectionCatalog(),
    edges: relationshipMatrix(),
    audit: connectivityAudit(),
    flow: flowStats(),
    harmony: harmonyScore(),
  })],

  // --- Pricing: the record every other agent must cite ---
  ['GET', /^\/api\/pricing$/, () => ({ records: listPricing(), approved: approvedPricing() })],
  ['POST', /^\/api\/pricing$/, (_p, body) => createPricing({ name: need(body, 'name'), productId: body.productId || null, plan: body.plan || 'standard', currency: body.currency || 'USD', amount: body.amount || 0, unit: body.unit || 'per month', rationale: body.rationale || null, draftWithAi: body.draftWithAi !== false, actor: need(body, 'actor') })],
  ['POST', /^\/api\/pricing\/(\d+)\/state$/, ([id], body) => setPricingState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') })],

  // --- Customer success ---
  ['GET', /^\/api\/success$/, () => successOverview()],
  ['POST', /^\/api\/success\/(\d+)\/assess$/, ([id], body) => assessCustomer(Number(id), { actor: need(body, 'actor') })],

  // --- Assets ---
  ['GET', /^\/api\/assets$/, () => listAssets()],
  ['POST', /^\/api\/assets$/, (_p, body) => createAsset({ name: need(body, 'name'), kind: body.kind || 'license', owner: body.owner || need(body, 'actor'), vendorId: body.vendorId || null, costUsd: body.costUsd || 0, renewalDate: body.renewalDate || null, sensitivity: body.sensitivity || 'internal', notes: body.notes || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/assets\/(\d+)\/state$/, ([id], body) => { setAssetState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],

  // --- Localization ---
  ['GET', /^\/api\/localization$/, () => listLocalizations()],
  ['POST', /^\/api\/localization$/, (_p, body) => createLocalization({ sourceKind: body.sourceKind || 'manual', sourceId: body.sourceId || null, title: body.title || null, sourceText: body.sourceText || null, targetLang: body.targetLang || 'ar', notes: body.notes || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/localization\/(\d+)\/approve$/, ([id], body) => approveLocalization(Number(id), { output: body.output ?? null, actor: need(body, 'actor') })],

  // --- Market watch ---
  ['GET', /^\/api\/marketwatch$/, () => listCompetitors()],
  ['POST', /^\/api\/marketwatch$/, (_p, body) => addCompetitor({ name: need(body, 'name'), website: body.website || null, segment: body.segment || null, researchNow: body.researchNow !== false, actor: need(body, 'actor') })],
  ['POST', /^\/api\/marketwatch\/(\d+)\/threat$/, ([id], body) => { setCompetitorThreat(Number(id), { threat: need(body, 'threat'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/marketwatch\/(\d+)\/check$/, async ([id], body) => checkCompetitorSite(Number(id), need(body, 'actor'))],

  // --- Enablement (training the workforce) ---
  ['GET', /^\/api\/enablement$/, () => listEnablement()],
  ['POST', /^\/api\/enablement$/, (_p, body) => createEnablement({ agentId: need(body, 'agentId'), trigger: body.trigger || 'manual', actor: need(body, 'actor') })],
  ['POST', /^\/api\/enablement\/(\d+)\/state$/, ([id], body) => { setEnablementState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],

  // --- The org: who the employees are ---
  ['GET', /^\/api\/org$/, () => orgDirectory()],
  ['POST', /^\/api\/org\/([\w-]+)$/, ([id], body) => updateAgentProfile(id, { nickname: body.nickname ?? null, persona: body.persona ?? null, departments: body.departments ?? null, actor: need(body, 'actor') })],

  // --- The society: colleagues, in and out of work ---
  ['GET', /^\/api\/society$/, () => societyOverview()],
  ['GET', /^\/api\/society\/channels$/, () => CHANNELS],
  ['GET', /^\/api\/society\/feed$/, (_p, _b, url) => societyFeed({
    channel: url.searchParams.get('channel'), agentId: url.searchParams.get('agent'), limit: Number(url.searchParams.get('limit')) || 80,
  })],
  ['GET', /^\/api\/society\/relations$/, () => societyRelations()],
  ['GET', /^\/api\/society\/relations\/([\w-]+)$/, ([id]) => relationsFor(id)],
  ['POST', /^\/api\/society\/toggle$/, (_p, body) => setSociety(Boolean(body.enabled), need(body, 'actor'))],
  ['POST', /^\/api\/society\/scene$/, async (_p, body) => forceScene({ kind: body.kind || null, actor: need(body, 'actor') })],

  // --- Disputes: HR frames, the owner rules ---
  ['GET', /^\/api\/disputes$/, () => disputesOverview()],
  ['GET', /^\/api\/disputes\/(\d+)$/, ([id]) => getDispute(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/disputes$/, (_p, body) => raiseDispute({ title: need(body, 'title'), partyA: need(body, 'partyA'), positionA: need(body, 'positionA'), partyB: need(body, 'partyB'), positionB: need(body, 'positionB'), subjectType: body.subjectType || null, subjectId: body.subjectId || null, context: body.context || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/disputes\/(\d+)\/rule$/, ([id], body) => ruleDispute(Number(id), { ruling: need(body, 'ruling'), favours: body.favours || null, precedent: Boolean(body.precedent), actor: need(body, 'actor') })],
  ['POST', /^\/api\/disputes\/(\d+)\/withdraw$/, ([id], body) => withdrawDispute(Number(id), need(body, 'actor'))],

  // --- Request desk: write it once, the company routes it ---
  ['GET', /^\/api\/requests$/, () => requestsOverview()],
  ['GET', /^\/api\/requests\/departments$/, () => DEPARTMENTS],
  ['GET', /^\/api\/requests\/(\d+)$/, ([id]) => getRequest(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/requests$/, (_p, body) => createRequest({ title: body.title || null, body: need(body, 'body'), priority: body.priority || 'normal', actor: need(body, 'actor') })],
  ['POST', /^\/api\/requests\/(\d+)\/signoff$/, ([id], body) => signOffStep(Number(id), { note: body.note || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/requests\/(\d+)\/cancel$/, ([id], body) => cancelRequest(Number(id), need(body, 'actor'))],
  ['GET', /^\/api\/requests\/(\d+)\/export$/, ([id]) => {
    const r = requestDeliverable(Number(id));
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: r.filename, body: r.body } };
  }],

  // --- Harmony (Maestro orchestration) ---
  ['GET', /^\/api\/harmony$/, () => maestroOverview()],
  ['GET', /^\/api\/harmony\/(\d+)$/, ([id]) => getCycle(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['GET', /^\/api\/harmony\/snapshot$/, () => assessCompany()],
  ['POST', /^\/api\/harmony\/cycle$/, (_p, body) => startCycle({ trigger: 'manual', actor: need(body, 'actor') })],
  ['POST', /^\/api\/harmony\/toggle$/, (_p, body) => { setMaestro(Boolean(body.enabled), need(body, 'actor')); return { ok: true, enabled: Boolean(body.enabled) }; }],
  ['POST', /^\/api\/harmony\/mode$/, (_p, body) => { setMaestroMode(need(body, 'mode'), need(body, 'actor')); return { ok: true }; }],
  // --- Autonomy: the company decides for itself ---
  ['GET', /^\/api\/autonomy$/, () => autonomyOverview()],
  // level: off | full | unattended. `enabled` is still accepted so the old
  // toggle keeps working.
  ['POST', /^\/api\/autonomy\/toggle$/, (_p, body) => setAutonomy(
    body.level !== undefined ? body.level : Boolean(body.enabled), need(body, 'actor'),
  )],
  ['POST', /^\/api\/autonomy\/(\d+)\/revert$/, ([id], body) => revertDecision(Number(id), { note: body.note || null, actor: need(body, 'actor') })],

  ['GET', /^\/api\/harmony\/remediations$/, () => remediations()],
  ['POST', /^\/api\/harmony\/boost$/, async (_p, body) => boostHarmony({ actor: need(body, 'actor') })],

  // --- Data Division: Archive ---
  ['GET', /^\/api\/archive$/, (_p, _b, url) => ({
    stats: archiveStats(),
    items: listArchive({ kind: url.searchParams.get('kind'), search: url.searchParams.get('search'), subjectType: url.searchParams.get('subjectType') }),
  })],
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

  // --- Relations (RM) ---
  ['GET', /^\/api\/relations$/, () => relationsOverview()],
  ['GET', /^\/api\/partners$/, () => listPartners()],
  ['POST', /^\/api\/partners$/, (_p, body) => createPartner({ name: need(body, 'name'), kind: body.kind || 'partner', tier: body.tier || 'standard', owner: body.owner || need(body, 'actor'), notes: body.notes || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/partners\/(\d+)\/state$/, ([id], body) => { setPartnerState(Number(id), { state: need(body, 'state'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/partners\/(\d+)\/health$/, ([id], body) => { setPartnerHealth(Number(id), { health: need(body, 'health'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/partners\/(\d+)\/outreach$/, ([id], body) => ({ runId: draftOutreach(Number(id), need(body, 'actor')) })],
  ['POST', /^\/api\/partners\/(\d+)\/send$/, ([id], body) => markOutreachSent(Number(id), { body: body.body ?? null, actor: need(body, 'actor') })],
  ['GET', /^\/api\/interactions$/, (_p, _b, url) => listInteractions({
    partnerId: url.searchParams.get('partnerId') ? Number(url.searchParams.get('partnerId')) : null,
    customerId: url.searchParams.get('customerId') ? Number(url.searchParams.get('customerId')) : null,
    vendorId: url.searchParams.get('vendorId') || null,
  })],
  ['POST', /^\/api\/interactions$/, (_p, body) => logInteraction({ partnerId: body.partnerId || null, customerId: body.customerId || null, vendorId: body.vendorId || null, kind: body.kind || 'note', summary: need(body, 'summary'), nextAction: body.nextAction || null, nextDate: body.nextDate || null, actor: need(body, 'actor') })],

  // --- Company Journeys (the value chain) ---
  ['GET', /^\/api\/journey-template$/, () => JOURNEY_STAGES],
  ['GET', /^\/api\/journeys$/, () => listJourneys()],
  ['GET', /^\/api\/journeys\/(\d+)$/, ([id]) => getJourney(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/journeys$/, (_p, body) => createJourney({ title: need(body, 'title'), productId: body.productId || null, autopilot: Boolean(body.autopilot), actor: need(body, 'actor') })],
  ['POST', /^\/api\/journeys\/(\d+)\/complete-stage$/, ([id], body) => completeStage(Number(id), { note: body.note || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/journeys\/(\d+)\/cancel$/, ([id], body) => cancelJourney(Number(id), need(body, 'actor'))],

  // --- Workforce (agents as employees) ---
  ['GET', /^\/api\/workforce$/, () => workforceBoard()],

  // --- Creative: Social Media ---
  ['GET', /^\/api\/studio$/, () => studioOverview()],
  ['GET', /^\/api\/channels$/, () => listChannels()],
  ['POST', /^\/api\/channels$/, (_p, body) => createChannel({ platform: need(body, 'platform'), handle: need(body, 'handle'), followers: body.followers || 0, notes: body.notes || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/channels\/(\d+)\/update$/, ([id], body) => { updateChannel(Number(id), { state: body.state ?? null, followers: body.followers ?? null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['GET', /^\/api\/posts$/, () => listPosts()],
  ['POST', /^\/api\/posts$/, (_p, body) => createPost({ channelId: body.channelId || null, kind: body.kind || 'post', brief: need(body, 'brief'), campaignId: body.campaignId || null, productId: body.productId || null, scheduleAt: body.scheduleAt || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/posts\/(\d+)\/schedule$/, ([id], body) => { schedulePost(Number(id), { scheduleAt: need(body, 'scheduleAt'), actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/posts\/(\d+)\/publish$/, ([id], body) => publishPost(Number(id), { body: body.body ?? null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/posts\/(\d+)\/metrics$/, ([id], body) => { updatePostMetrics(Number(id), { likes: body.likes ?? null, comments: body.comments ?? null, shares: body.shares ?? null, reach: body.reach ?? null, actor: need(body, 'actor') }); return { ok: true }; }],
  ['POST', /^\/api\/posts\/(\d+)\/cancel$/, ([id], body) => { cancelPost(Number(id), need(body, 'actor')); return { ok: true }; }],

  // --- Creative: Content Studio ---
  ['GET', /^\/api\/content$/, () => listContent()],
  ['POST', /^\/api\/content$/, (_p, body) => createContent({ kind: body.kind || 'article', title: need(body, 'title'), brief: need(body, 'brief'), productId: body.productId || null, campaignId: body.campaignId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/content\/(\d+)\/verdict$/, ([id], body) => approveContent(Number(id), { verdict: need(body, 'verdict'), body: body.body ?? null, actor: need(body, 'actor') })],

  // --- Creative: Design Studio ---
  ['GET', /^\/api\/designs$/, () => listDesigns()],
  ['POST', /^\/api\/designs$/, (_p, body) => createDesign({ kind: body.kind || 'social-visual', title: need(body, 'title'), brief: need(body, 'brief'), productId: body.productId || null, campaignId: body.campaignId || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/designs\/(\d+)\/approve$/, ([id], body) => approveDesign(Number(id), { actor: need(body, 'actor') })],

  // --- Sales (deals pipeline) ---
  ['GET', /^\/api\/deals$/, () => listDeals()],
  ['POST', /^\/api\/deals$/, (_p, body) => createDeal({ name: need(body, 'name'), valueUsd: body.valueUsd || 0, customerId: body.customerId || null, partnerId: body.partnerId || null, productId: body.productId || null, owner: body.owner || need(body, 'actor'), notes: body.notes || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/deals\/(\d+)\/stage$/, ([id], body) => setDealStage(Number(id), { stage: need(body, 'stage'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/deals\/(\d+)\/proposal$/, ([id], body) => ({ runId: draftProposal(Number(id), need(body, 'actor')) })],

  // --- Autopilot (Nexus) ---
  ['GET', /^\/api\/autopilot$/, () => ({ rules: listAutomations(), feed: nexusFeed() })],
  ['POST', /^\/api\/autopilot\/rule$/, (_p, body) => { setAutomation(need(body, 'id'), { enabled: Boolean(body.enabled), actor: need(body, 'actor') }); return { ok: true }; }],

  // --- Company scorecard (BI) ---
  ['GET', /^\/api\/scorecard$/, () => {
    const month = new Date().toISOString().slice(0, 7);
    const dealTotals = listDeals();
    return {
      revenue: {
        mrr: one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'").n,
        customersActive: one("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'").n,
        pipelineValue: dealTotals.openValue, wonValue: dealTotals.wonValue,
        dealsOpen: dealTotals.pipeline.lead.n + dealTotals.pipeline.qualified.n + dealTotals.pipeline.proposal.n,
      },
      creative: {
        postsPublished: one("SELECT COUNT(*) AS n FROM posts WHERE state = 'published'").n,
        followers: one("SELECT COALESCE(SUM(followers),0) AS n FROM channels WHERE state = 'connected'").n,
        contentPublished: one("SELECT COUNT(*) AS n FROM content_items WHERE state = 'published'").n,
        designsApproved: one("SELECT COUNT(*) AS n FROM designs WHERE state = 'approved'").n,
        campaignsLive: one("SELECT COUNT(*) AS n FROM campaigns WHERE state = 'live'").n,
      },
      production: {
        journeysDone: one("SELECT COUNT(*) AS n FROM journeys WHERE state = 'done'").n,
        journeysMoving: one("SELECT COUNT(*) AS n FROM journeys WHERE state IN ('running','awaiting_human')").n,
        runsDone7d: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'done' AND created_at >= datetime('now','-7 days')").n,
        tasksDone7d: one("SELECT COUNT(*) AS n FROM tasks WHERE state = 'done' AND done_at >= datetime('now','-7 days')").n,
        productsLive: one("SELECT COUNT(*) AS n FROM products WHERE state = 'live'").n,
        artifactsNote: null,
      },
      trust: {
        incidentsOpen: one("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'").n,
        risksCritical: one("SELECT COUNT(*) AS n FROM risks WHERE state = 'open' AND likelihood * impact >= 16").n,
        evalAvg: one('SELECT AVG(score) AS s FROM (SELECT score FROM eval_runs ORDER BY id DESC LIMIT 10)')?.s ?? null,
        awaitingHuman: one("SELECT COUNT(*) AS n FROM runs WHERE state = 'awaiting_human'").n,
        chainEntries: one('SELECT COUNT(*) AS n FROM audit_log').n,
      },
      autopilot: {
        actions7d: one("SELECT COUNT(*) AS n FROM nexus_log WHERE created_at >= datetime('now','-7 days')").n,
        actionsTotal: one('SELECT COUNT(*) AS n FROM nexus_log').n,
        agentActions7d: one("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'agent' AND occurred_at >= datetime('now','-7 days')").n,
        humanActions7d: one("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'human' AND occurred_at >= datetime('now','-7 days')").n,
      },
      relations: {
        partnersActive: one("SELECT COUNT(*) AS n FROM partners WHERE state = 'active'").n,
        interactions30d: one("SELECT COUNT(*) AS n FROM interactions WHERE created_at >= datetime('now','-30 days')").n,
      },
      spendMonth: one('SELECT COALESCE(SUM(cost_usd),0) AS n FROM model_calls WHERE created_at >= ?', `${month}-01`).n,
    };
  }],

  // --- System Design studio ---
  ['GET', /^\/api\/design\/catalog$/, () => DOC_CATALOG.map((d) => ({ key: d.key, title: d.title, agent: d.agent, needs: d.needs, brief: d.brief }))],
  ['GET', /^\/api\/design$/, () => listBlueprints()],
  ['GET', /^\/api\/design\/(\d+)$/, ([id]) => getBlueprint(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/design$/, (_p, body) => createBlueprint({
    name: need(body, 'name'), goal: need(body, 'goal'), docKeys: body.docKeys || null,
    productId: body.productId || null, projectId: body.projectId || null, context: body.context || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/design\/(\d+)\/cancel$/, ([id], body) => cancelBlueprint(Number(id), need(body, 'actor'))],
  ['POST', /^\/api\/design\/docs\/(\d+)\/redo$/, ([id], body) => redoDoc(Number(id), { note: body.note || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/design\/docs\/(\d+)\/approve$/, ([id], body) => approveDoc(Number(id), { content: body.content ?? null, actor: need(body, 'actor') })],
  ['GET', /^\/api\/design\/(\d+)\/bundle$/, ([id]) => {
    const r = buildBundle(Number(id));
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: r.filename, body: r.body } };
  }],
  ['GET', /^\/api\/design\/(\d+)\/build-brief$/, ([id]) => {
    const r = buildAgentBrief(Number(id));
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: r.filename, body: r.body } };
  }],

  // --- Infrastructure ---
  ['GET', /^\/api\/infra$/, () => ({ overview: infraOverview(), plans: listInfraPlans() })],
  ['GET', /^\/api\/infra\/sections$/, () => Object.entries(INFRA_SECTIONS).map(([id, s]) => ({ id, label: s.label }))],
  ['GET', /^\/api\/infra\/(\d+)$/, ([id]) => getInfraPlan(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/infra$/, (_p, body) => createInfraPlan({
    name: need(body, 'name'), section: body.section || 'full', spec: body.spec || {},
    blueprintId: body.blueprintId || null, productId: body.productId || null, actor: need(body, 'actor'),
  })],
  ['GET', /^\/api\/infra\/(\d+)\/export$/, ([id]) => {
    const p = getInfraPlan(Number(id));
    if (!p?.content) throw new HttpError(404, 'plan not ready');
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: `infra-plan-${id}.md`, body: p.content } };
  }],

  // --- Financial reporting ---
  ['GET', /^\/api\/finreports$/, () => ({ overview: finReportsOverview(), reports: listFinReports() })],
  ['GET', /^\/api\/finreports\/ledger$/, (_p, _b, url) => ownFinancials(url.searchParams.get('period'))],
  ['GET', /^\/api\/finreports\/(\d+)$/, ([id]) => getFinReport(Number(id)) || (() => { throw new HttpError(404, 'not found'); })()],
  ['POST', /^\/api\/finreports$/, (_p, body) => createFinReport({
    kind: need(body, 'kind'), title: body.title || null, subject: body.subject || 'own',
    period: body.period || null, inputs: body.inputs || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/finreports\/(\d+)\/approve$/, ([id], body) => approveFinReport(Number(id), { actor: need(body, 'actor') })],
  ['GET', /^\/api\/finreports\/(\d+)\/export$/, ([id]) => {
    const r = getFinReport(Number(id));
    if (!r?.content) throw new HttpError(404, 'report not ready');
    return { __raw: { contentType: 'text/markdown; charset=utf-8', filename: `${r.kind}-${r.period}.md`, body: r.content } };
  }],

  ['GET', /^\/api\/memory$/, () => q('SELECT * FROM memory_entries ORDER BY id DESC LIMIT 200')],
  ['POST', /^\/api\/memory$/, (_p, body) => {
    exec('INSERT INTO memory_entries (layer, classification, content, source_ref, created_by) VALUES (?,?,?,?,?)',
      body.layer || 'org', body.classification || 'internal', need(body, 'content'), need(body, 'sourceRef'), body.createdBy || 'human:admin');
    return { ok: true };
  }],

  // ==========================================================================
  // The outside world.
  // ==========================================================================

  // --- the vault: secrets in, never out ---
  ['GET', /^\/api\/vault$/, () => listSecrets()],
  ['POST', /^\/api\/vault$/, (_p, body) => putSecret(need(body, 'name'), need(body, 'value'), {
    kind: body.kind, connector: body.connector, note: body.note, expiresAt: body.expiresAt, actor: body.actor,
  })],
  ['DELETE', /^\/api\/vault\/([A-Za-z0-9_.-]+)$/, ([name], _b, url) => dropSecret(name, { actor: url.searchParams.get('actor') })],

  // --- connectors: the services the company can reach ---
  ['GET', /^\/api\/connectors$/, () => connectorsOverview()],
  ['GET', /^\/api\/connectors\/([a-z0-9:_-]+)$/, ([id]) => getConnector(id) || (() => { throw new HttpError(404, 'no such connector'); })()],
  ['POST', /^\/api\/connectors$/, (_p, body) => addConnector({
    id: need(body, 'id'), driver: need(body, 'driver'), label: body.label,
    config: body.config || {}, allowlist: body.allowlist || [], scopes: body.scopes, quotaDay: body.quotaDay, actor: body.actor,
  })],
  ['POST', /^\/api\/connectors\/([a-z0-9:_-]+)\/connect$/, ([id], body) => connect(id, {
    secret: body.secret, account: body.account || 'default', meta: body.meta || {}, actor: body.actor,
  })],
  ['POST', /^\/api\/connectors\/([a-z0-9:_-]+)\/state$/, ([id], body) => setConnectorState(id, need(body, 'state'), { actor: body.actor })],
  ['POST', /^\/api\/connectors\/([a-z0-9:_-]+)\/allowlist$/, ([id], body) => setAllowlist(id, body.allowlist || [], { actor: body.actor })],
  ['POST', /^\/api\/connectors\/([a-z0-9:_-]+)\/call$/, ([id], body) => callConnector({
    connector: id, capability: need(body, 'capability'), args: body.args || {},
    actor: body.actor, reason: body.reason || 'called by hand from the console',
  })],
  // Start an OAuth handshake: the client id and secret go straight to the vault.
  ['POST', /^\/api\/connectors\/([a-z0-9:_-]+)\/authorize$/, ([id], body, url) => {
    const base = id.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    if (body.clientId) putSecret(`${base}_CLIENT_ID`, body.clientId, { kind: 'oauth', connector: id, actor: body.actor });
    if (body.clientSecret) putSecret(`${base}_CLIENT_SECRET`, body.clientSecret, { kind: 'oauth', connector: id, actor: body.actor });
    const driver = DRIVERS[one('SELECT driver FROM connectors WHERE id = ?', id)?.driver];
    if (!driver?.auth?.provider) throw new HttpError(400, 'that connector does not use OAuth');
    exec('UPDATE connectors SET config = ? WHERE id = ?', JSON.stringify({ provider: driver.auth.provider }), id);
    const origin = getSetting('PUBLIC_BASE_URL') || url.origin;
    return {
      url: authorizeUrl({
        connector: id, provider: driver.auth.provider,
        clientId: body.clientId || vaultGet(`${base}_CLIENT_ID`),
        scopes: body.scopes || driver.auth.scopes,
        redirectUri: `${origin}/oauth/callback`,
      }),
      redirectUri: `${origin}/oauth/callback`,
    };
  }],

  // --- the gate: every attempt to touch anything outside ---
  ['GET', /^\/api\/egress$/, () => egressOverview()],
  ['POST', /^\/api\/egress\/(\d+)\/release$/, ([id], body) => releaseGated(Number(id), { actor: need(body, 'actor') })],
  ['POST', /^\/api\/egress\/(\d+)\/deny$/, ([id], body) => denyGated(Number(id), { actor: need(body, 'actor'), why: body.why || '' })],
  ['GET', /^\/api\/scopes\/([A-Za-z0-9-]+)$/, ([agentId]) => scopesFor(agentId)],
  ['POST', /^\/api\/scopes$/, (_p, body) => grantScope({
    agentId: need(body, 'agentId'), connector: need(body, 'connector'), capability: need(body, 'capability'),
    constraint: body.constraint || null, expiresAt: body.expiresAt || null, actor: body.actor,
  })],
  ['POST', /^\/api\/scopes\/revoke$/, (_p, body) => revokeScope({
    agentId: need(body, 'agentId'), connector: need(body, 'connector'), capability: need(body, 'capability'), actor: body.actor,
  })],

  // --- the queue ---
  ['GET', /^\/api\/jobs$/, () => jobsOverview()],
  ['POST', /^\/api\/jobs\/(\d+)\/retry$/, ([id], body) => retryJob(Number(id), { actor: body.actor })],
  ['POST', /^\/api\/jobs\/(\d+)\/cancel$/, ([id], body) => cancelJob(Number(id), { actor: body.actor })],

  // --- the web ---
  ['GET', /^\/api\/web$/, () => webOverview()],
  ['GET', /^\/api\/web\/(\d+)$/, ([id]) => readFetch(Number(id))],
  ['POST', /^\/api\/web\/fetch$/, (_p, body) => fetchPage(need(body, 'url'), { agentId: body.agentId || null })],
  ['POST', /^\/api\/web\/search$/, (_p, body) => searchWeb(need(body, 'query'), { agentId: body.agentId || null })],
  ['POST', /^\/api\/web\/browse$/, (_p, body) => browsePage(need(body, 'url'), { agentId: body.agentId || null, screenshot: Boolean(body.screenshot) })],

  // --- MCP ---
  ['GET', /^\/api\/mcp$/, () => mcpOverview()],
  ['POST', /^\/api\/mcp$/, (_p, body) => registerServer({
    id: need(body, 'id'), label: body.label, transport: body.transport || 'stdio',
    command: body.command, args: body.args || [], url: body.url, envNames: body.envNames || [], actor: body.actor,
  })],
  ['POST', /^\/api\/mcp\/([a-z0-9:_-]+)\/sync$/, ([id]) => syncServer(id)],
  ['POST', /^\/api\/mcp\/([a-z0-9:_-]+)\/call$/, ([id], body) => callTool({
    serverId: id, tool: need(body, 'tool'), args: body.args || {}, agentId: body.agentId || null,
  })],
  ['GET', /^\/api\/mcp\/tools$/, () => ({ tools: allTools(), exposed: CRUCIBLE_TOOLS })],

  // --- the constitution ---
  ['GET', /^\/api\/constitution$/, () => constitutionOverview()],
  ['POST', /^\/api\/constitution$/, (_p, body) => amendConstitution({
    ruleId: need(body, 'ruleId'), article: body.article, text: need(body, 'text'),
    machine: body.machine || null, severity: body.severity, actor: body.actor,
  })],
  ['POST', /^\/api\/constitution\/([A-Za-z0-9.-]+)\/retire$/, ([ruleId], body) => retireRule(ruleId, { actor: body.actor })],

  // --- provenance ---
  ['GET', /^\/api\/provenance$/, () => provenanceOverview()],
  ['POST', /^\/api\/provenance\/seal$/, () => ({ sealed: sealFinishedWork() })],
  ['POST', /^\/api\/provenance\/(\d+)\/verify$/, ([id], body) => verifyStored(Number(id), body.content ?? null)],
  ['POST', /^\/api\/provenance\/verify$/, (_p, body) => verifyReceipt({ receipt: need(body, 'receipt'), content: body.content ?? null })],

  // --- the time machine ---
  ['GET', /^\/api\/timemachine$/, () => timeMachineOverview()],
  ['POST', /^\/api\/timemachine\/snapshot$/, (_p, body) => takeSnapshot({ label: need(body, 'label'), actor: body.actor })],
  ['GET', /^\/api\/timemachine\/at\/(\d+)$/, ([seq]) => standAt(Number(seq))],
  ['GET', /^\/api\/timemachine\/replay\/(\d+)\/(\d+)$/, ([from, to]) => replay(Number(from), Number(to))],
  ['POST', /^\/api\/timemachine\/reopen$/, (_p, body) => reopenDecision({
    decisionId: need(body, 'decisionId'), why: need(body, 'why'), actor: body.actor,
  })],

  // --- the shadow company ---
  ['GET', /^\/api\/simulation$/, () => simulationOverview()],
  ['GET', /^\/api\/simulation\/(\d+)$/, ([id]) => readSimulation(Number(id))],
  ['POST', /^\/api\/simulation$/, (_p, body) => startSimulation({
    name: need(body, 'name'), question: need(body, 'question'),
    changes: body.changes || [], horizon: body.horizon, actor: body.actor,
  })],
  ['DELETE', /^\/api\/simulation\/(\d+)$/, ([id], _b, url) => discardSimulation(Number(id), { actor: url.searchParams.get('actor') })],

  // --- skills and tournaments ---
  ['GET', /^\/api\/skills$/, () => skillsOverview()],
  ['POST', /^\/api\/skills$/, (_p, body) => proposeSkill({
    title: need(body, 'title'), taskType: need(body, 'taskType'), body: need(body, 'body'),
    proposedBy: body.proposedBy || body.actor, actor: body.actor,
  })],
  ['POST', /^\/api\/skills\/(\d+)\/trial$/, ([id], body) => trialSkill(Number(id), { actor: body.actor })],
  ['POST', /^\/api\/skills\/invite$/, () => ({ asked: inviteProposals(2) })],
  ['POST', /^\/api\/tournaments$/, (_p, body) => runTournament(need(body, 'taskType'), { actor: body.actor })],

  // --- the red team ---
  ['GET', /^\/api\/redteam$/, () => redteamOverview()],
  ['POST', /^\/api\/redteam\/run$/, (_p, body) => runRedTeam({ only: body.only || null, actor: body.actor })],
  ['POST', /^\/api\/redteam\/(\d+)\/fixed$/, ([id], body) => markFixed(Number(id), { actor: body.actor })],

  // --- the knowledge graph ---
  ['GET', /^\/api\/kgraph$/, () => graphOverview()],
  ['POST', /^\/api\/kgraph\/rebuild$/, () => rebuildGraph()],
  ['GET', /^\/api\/kgraph\/search$/, (_p, _b, url) => ({ results: semanticSearch(url.searchParams.get('q') || '', { k: 12, kind: url.searchParams.get('kind') || null }) })],
  ['GET', /^\/api\/kgraph\/node\/(.+)$/, ([id]) => neighbourhood(decodeURIComponent(id)) || (() => { throw new HttpError(404, 'no such node'); })()],

  // --- the revenue loop ---
  ['GET', /^\/api\/revenue$/, () => revenueOverview()],
  ['POST', /^\/api\/revenue\/source$/, (_p, body) => ({ created: sourceFromIntel({ limit: body.limit || 3 }) })],
  ['POST', /^\/api\/revenue\/tick$/, () => ({ moved: revenueTick() })],
  ['POST', /^\/api\/revenue\/(\d+)\/outreach$/, ([id], body) => sendOutreach({
    dealId: Number(id), connector: body.connector || 'gmail', to: need(body, 'to'),
    agentId: body.agentId || null, actor: body.actor,
  })],
  ['POST', /^\/api\/revenue\/(\d+)\/invoice$/, ([id], body) => invoiceDeal({
    dealId: Number(id), amountUsd: Number(need(body, 'amountUsd')), actor: body.actor,
  })],

  // ==========================================================================
  // The platform: many companies, a programmatic surface, installable
  // departments, and the rhythm that runs it all.
  // ==========================================================================

  // --- tenants ---
  ['GET', /^\/api\/tenants$/, () => tenantsOverview()],
  ['GET', /^\/api\/tenants\/([a-z0-9-]+)$/, ([id]) => getTenant(id) || (() => { throw new HttpError(404, 'no such company'); })()],
  ['POST', /^\/api\/tenants$/, (_p, body) => createTenant({
    id: body.id, name: need(body, 'name'), ownerEmail: body.ownerEmail,
    plan: body.plan, locale: body.locale, monthlyCapUsd: body.monthlyCapUsd, actor: body.actor,
  })],
  ['POST', /^\/api\/tenants\/([a-z0-9-]+)\/start$/, ([id], body) => startTenant(id, { actor: body.actor })],
  ['POST', /^\/api\/tenants\/([a-z0-9-]+)\/stop$/, ([id], body) => stopTenant(id, { actor: body.actor })],
  ['DELETE', /^\/api\/tenants\/([a-z0-9-]+)$/, ([id], _b, url) => deleteTenant(id, {
    confirm: url.searchParams.get('confirm'), actor: url.searchParams.get('actor'),
  })],

  // --- API keys ---
  ['GET', /^\/api\/keys$/, () => apiKeysOverview()],
  ['POST', /^\/api\/keys$/, (_p, body) => createKey({
    name: need(body, 'name'), scopes: body.scopes || [], expiresAt: body.expiresAt || null,
    ratePerMin: body.ratePerMin || 120, tenantId: body.tenantId || null, actor: body.actor,
  })],
  ['POST', /^\/api\/keys\/(\d+)\/revoke$/, ([id], body) => revokeKey(Number(id), { actor: body.actor })],

  // --- webhooks out ---
  ['GET', /^\/api\/webhooks$/, () => webhooksOverview()],
  ['POST', /^\/api\/webhooks$/, (_p, body) => addWebhook({ url: need(body, 'url'), events: body.events || ['*'], actor: body.actor })],
  ['POST', /^\/api\/webhooks\/(\d+)\/state$/, ([id], body) => setWebhookState(Number(id), need(body, 'state'), { actor: body.actor })],
  ['DELETE', /^\/api\/webhooks\/(\d+)$/, ([id], _b, url) => removeWebhook(Number(id), { actor: url.searchParams.get('actor') })],

  // --- department packages ---
  ['GET', /^\/api\/packages$/, () => packagesOverview()],
  ['GET', /^\/api\/packages\/([a-z0-9_]+)$/, ([id]) => getPackage(id) || (() => { throw new HttpError(404, 'no such package'); })()],
  ['POST', /^\/api\/packages$/, (_p, body) => addPackage({ manifest: need(body, 'manifest'), actor: body.actor })],
  ['POST', /^\/api\/packages\/validate$/, (_p, body) => validateManifest(need(body, 'manifest'))],
  ['POST', /^\/api\/packages\/([a-z0-9_]+)\/install$/, ([id], body) => installPackage(id, { actor: body.actor })],
  ['POST', /^\/api\/packages\/([a-z0-9_]+)\/uninstall$/, ([id], body) => uninstallPackage(id, { actor: body.actor, dropData: Boolean(body.dropData) })],

  // --- the operating rhythm ---
  ['GET', /^\/api\/chief$/, () => chiefOverview()],
  ['POST', /^\/api\/chief\/turn$/, (_p, body) => chiefTick({ force: body.force || 'day' })],

  // --- observability and self-healing ---
  ['GET', /^\/api\/observe$/, () => observeOverview()],
  ['POST', /^\/api\/observe\/check$/, () => ({ applied: observeTick() })],

  // --- backups ---
  ['GET', /^\/api\/backups$/, () => backupsOverview()],
  ['POST', /^\/api\/backups$/, (_p, body) => takeBackup({ kind: 'manual', actor: body.actor })],
  ['POST', /^\/api\/backups\/(\d+)\/verify$/, ([id]) => verifyBackup(Number(id))],
  ['POST', /^\/api\/backups\/(\d+)\/restore$/, ([id], body) => restoreBackup(Number(id), { confirm: body.confirm, actor: body.actor })],
  // ==========================================================================
  // Marketing, department by department.
  // ==========================================================================
  ['GET', /^\/api\/mkt\/events$/, () => eventsDesk()],
  ['POST', /^\/api\/mkt\/events$/, (_p, body) => planEvent({
    name: need(body, 'name'), kind: body.kind, format: body.format, startsAt: body.startsAt,
    city: body.city, audience: body.audience, goal: body.goal,
    budgetUsd: body.budgetUsd, campaignId: body.campaignId || null, actor: body.actor,
  })],
  ['POST', /^\/api\/mkt\/events\/(\d+)$/, ([id], body) => recordEvent(Number(id), {
    registered: body.registered ?? null, attended: body.attended ?? null,
    leads: body.leads ?? null, spent: body.spent ?? null, state: body.state || null, actor: body.actor,
  })],

  ['GET', /^\/api\/mkt\/press$/, () => pressDesk()],
  ['POST', /^\/api\/mkt\/press$/, (_p, body) => draftPress({
    kind: body.kind, title: need(body, 'title'), outlet: body.outlet,
    journalist: body.journalist, angle: body.angle, actor: body.actor,
  })],
  ['POST', /^\/api\/mkt\/press\/(\d+)\/approve$/, ([id], body) => approvePress(Number(id), { actor: body.actor })],
  ['POST', /^\/api\/mkt\/press\/(\d+)\/coverage$/, ([id], body) => recordCoverage(Number(id), {
    url: need(body, 'url'), sentiment: body.sentiment, actor: body.actor,
  })],

  ['GET', /^\/api\/mkt\/community$/, () => communityDesk()],
  ['POST', /^\/api\/mkt\/community$/, (_p, body) => addCommunityMember({
    handle: need(body, 'handle'), channel: body.channel, role: body.role,
    reach: body.reach, notes: body.notes, customerId: body.customerId || null, actor: body.actor,
  })],
  ['POST', /^\/api\/mkt\/community\/(\d+)$/, ([id], body) => setCommunityRole(Number(id), {
    role: need(body, 'role'), sentiment: body.sentiment, actor: body.actor,
  })],

  ['GET', /^\/api\/mkt\/attribution$/, () => attribution()],
  ['POST', /^\/api\/mkt\/attribution$/, (_p, body) => recordTouch({
    subject: need(body, 'subject'), channel: need(body, 'channel'), source: body.source,
    campaignId: body.campaignId || null, contentId: body.contentId || null,
    eventId: body.eventId || null, weight: body.weight, valueUsd: body.valueUsd,
  })],

  ['GET', /^\/api\/mkt\/pages$/, () => pagesDesk()],
  ['POST', /^\/api\/mkt\/pages$/, (_p, body) => draftPage({
    slug: need(body, 'slug'), title: body.title, purpose: body.purpose,
    personaId: body.personaId || null, campaignId: body.campaignId || null, actor: body.actor,
  })],
  ['POST', /^\/api\/mkt\/pages\/(\d+)\/state$/, ([id], body) => setPageState(Number(id), { state: need(body, 'state'), actor: body.actor })],
  ['POST', /^\/api\/mkt\/pages\/(\d+)\/result$/, ([id], body) => recordPageResult(Number(id), {
    visits: body.visits ?? null, conversions: body.conversions ?? null, actor: body.actor,
  })],

  ['GET', /^\/api\/mkt\/ops$/, () => opsDesk()],
  ['POST', /^\/api\/mkt\/ops$/, (_p, body) => setOpsEntry({
    id: body.id || null, kind: body.kind, name: need(body, 'name'),
    detail: body.detail, value: body.value, state: body.state, actor: body.actor,
  })],

  // The four tables that were buried inside the marketing desk with no page.
  ['GET', /^\/api\/mkt\/seo$/, () => seoDesk()],
  ['GET', /^\/api\/mkt\/paid$/, () => paidDesk()],
  ['GET', /^\/api\/mkt\/lifecycle$/, () => lifecycleDesk()],
  ['GET', /^\/api\/mkt\/calendar$/, () => calendarDesk()],

  ['GET', /^\/api\/backups\/export$/, () => ({
    __raw: {
      contentType: 'application/json; charset=utf-8',
      filename: `crucible-export-${new Date().toISOString().slice(0, 10)}.json`,
      body: JSON.stringify(exportAll(), null, 1),
    },
  })],
];

/** Path → permission key. One permission per capability; superadmin holds "*". */
function permFor(m, path) {
  const is = (re) => re.test(path);
  if (['/api/health', '/api/stats', '/api/audit/verify', '/api/notifications', '/api/inbox'].includes(path)) return 'dashboard.view';
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
  if (path === '/api/workforce') return 'workforce.view';
  // Exact prefix: /api/designs is the visual Design Studio, a different section.
  if (path === '/api/design' || path.startsWith('/api/design/')) return m === 'GET' ? 'systems.view' : 'systems.manage';
  if (path.startsWith('/api/infra')) return m === 'GET' ? 'infra.view' : 'infra.manage';
  if (path.startsWith('/api/finreports')) return m === 'GET' ? 'finreports.view' : 'finreports.manage';
  if (path === '/api/scorecard' || path === '/api/graph' || path === '/api/map' || path.startsWith('/api/links/')) return 'dashboard.view';
  if (path.startsWith('/api/harmony')) return m === 'GET' ? 'harmony.view' : 'harmony.manage';
  // Handing the company's decisions to the AI, and taking them back, is the
  // owner's call alone — it is not a management permission.
  if (path === '/api/autonomy') return 'harmony.view';
  if (path.startsWith('/api/autonomy')) return 'owner.rule';
  if (path.startsWith('/api/requests')) return m === 'GET' ? 'requests.view' : 'requests.create';
  if (path.startsWith('/api/pricing')) return m === 'GET' ? 'pricing.view' : 'pricing.manage';
  if (path.startsWith('/api/success')) return m === 'GET' ? 'success.view' : 'success.manage';
  if (path.startsWith('/api/assets')) return m === 'GET' ? 'assets.view' : 'assets.manage';
  if (path.startsWith('/api/localization')) return m === 'GET' ? 'localization.view' : 'localization.manage';
  if (path.startsWith('/api/marketwatch')) return m === 'GET' ? 'marketwatch.view' : 'marketwatch.manage';
  if (path.startsWith('/api/enablement')) return m === 'GET' ? 'enablement.view' : 'enablement.manage';
  if (path.startsWith('/api/org')) return m === 'GET' ? 'org.view' : 'org.manage';
  if (path.startsWith('/api/society')) return m === 'GET' ? 'org.view' : 'org.manage';
  // A ruling is the owner's alone; raising a dispute is not.
  if (/^\/api\/disputes\/\d+\/rule$/.test(path)) return 'owner.rule';
  if (path.startsWith('/api/disputes')) return m === 'GET' ? 'disputes.view' : 'disputes.raise';
  if (path === '/api/datasets/sources' || path === '/api/datasets/from-source') return m === 'GET' ? 'datasets.view' : 'datasets.manage';
  if (path.startsWith('/api/segments') && /\/campaign$/.test(path)) return 'marketing.manage';
  if (path.startsWith('/api/deals')) return m === 'GET' ? 'sales.view' : 'sales.manage';
  if (path.startsWith('/api/autopilot')) return m === 'GET' ? 'autopilot.view' : 'autopilot.manage';
  if (path === '/api/studio' || path.startsWith('/api/channels') || path.startsWith('/api/posts')) return m === 'GET' ? 'social.view' : 'social.manage';
  if (path.startsWith('/api/content')) return m === 'GET' ? 'content.view' : 'content.manage';
  if (path.startsWith('/api/designs')) return m === 'GET' ? 'design.view' : 'design.manage';
  if (path.startsWith('/api/relations') || path.startsWith('/api/partners') || path.startsWith('/api/interactions')) return m === 'GET' ? 'relations.view' : 'relations.manage';
  if (path === '/api/journey-template' || path.startsWith('/api/journeys')) return m === 'GET' ? 'journeys.view' : 'journeys.manage';
  if (path === '/api/perms' || path.startsWith('/api/users')) return 'users.manage';
  if (path.startsWith('/api/settings') || path === '/api/system/wipe') return 'settings.manage';
  if (path === '/api/map/activity') return 'dashboard.view';
  if (path.startsWith('/api/chat')) return m === 'GET' ? 'chat.view' : 'chat.post';
  // Money leaving the company is its own permission, held apart from invoicing.
  if (path.startsWith('/api/comms')) return m === 'GET' ? 'comms.view' : 'comms.manage';
  if (path.startsWith('/api/money')) return m === 'GET' ? 'money.view' : 'money.manage';
  if (path.startsWith('/api/mkt')) return m === 'GET' ? 'marketing.view' : 'marketing.manage';
  if (/^\/api\/treasury\/payouts\/\d+\/resolve$/.test(path)) return 'treasury.pay';
  if (path.startsWith('/api/treasury')) return m === 'GET' ? 'treasury.view' : 'treasury.manage';
  if (path.startsWith('/api/memory')) return m === 'GET' ? 'memory.view' : 'memory.manage';
  if (path.startsWith('/api/workstreams')) return m === 'GET' ? 'workstreams.view' : 'workstreams.manage';
  if (path.startsWith('/api/auditor')) return m === 'GET' ? 'auditor.view' : 'auditor.request';
  if (path.startsWith('/api/sprints')) return m === 'GET' ? 'sprints.view' : 'sprints.manage';
  if (path.startsWith('/api/security')) return m === 'GET' ? 'security.view' : 'security.manage';
  if (path.startsWith('/api/compliance')) return m === 'GET' ? 'compliance.view' : 'compliance.manage';
  if (path === '/api/sustainability') return 'sustainability.view';
  if (path === '/api/capacity') return 'capacity.view';
  if (path.startsWith('/api/lab')) return m === 'GET' ? 'lab.view' : 'lab.manage';
  if (path.startsWith('/api/releases')) return m === 'GET' ? 'releases.view' : 'releases.manage';
  if (path.startsWith('/api/pmo')) return m === 'GET' ? 'pmo.view' : 'pmo.manage';
  if (path === '/api/insights') return 'insights.view';
  if (path.startsWith('/api/brand')) return m === 'GET' ? 'brand.view' : 'brand.manage';
  if (path.startsWith('/api/procurement')) return m === 'GET' ? 'procurement.view' : 'procurement.manage';
  if (path === '/api/finops') return 'finops.view';
  if (path.startsWith('/api/recruiting')) return m === 'GET' ? 'recruiting.view' : 'recruiting.manage';
  if (path.startsWith('/api/academy')) return m === 'GET' ? 'academy.view' : 'academy.manage';
  if (path.startsWith('/api/ir')) return m === 'GET' ? 'ir.view' : 'ir.manage';
  if (path.startsWith('/api/board')) return m === 'GET' ? 'board.view' : 'board.manage';
  if (path.startsWith('/api/comms')) return m === 'GET' ? 'comms.view' : 'comms.manage';
  // The outside world. Reading a ledger and arming a connector are different
  // powers, so they are different permissions.
  if (path.startsWith('/api/vault')) return 'vault.manage';
  if (path.startsWith('/api/connectors')) return m === 'GET' ? 'connectors.view' : 'connectors.manage';
  if (path.startsWith('/api/scopes')) return m === 'GET' ? 'egress.view' : 'scopes.grant';
  if (is(/^\/api\/egress\/\d+\/(release|deny)$/)) return 'egress.release';
  if (path.startsWith('/api/egress')) return 'egress.view';
  if (path.startsWith('/api/jobs')) return m === 'GET' ? 'jobs.view' : 'jobs.manage';
  if (path.startsWith('/api/web')) return m === 'GET' ? 'web.view' : 'web.use';
  if (path.startsWith('/api/mcp')) return m === 'GET' ? 'mcp.view' : 'mcp.manage';
  if (path.startsWith('/api/constitution')) return m === 'GET' ? 'constitution.view' : 'constitution.amend';
  if (path.startsWith('/api/provenance')) return m === 'GET' ? 'provenance.view' : 'provenance.issue';
  if (is(/^\/api\/timemachine\/reopen$/)) return 'owner.rule';
  if (path.startsWith('/api/timemachine')) return m === 'GET' ? 'timemachine.view' : 'timemachine.snapshot';
  if (path.startsWith('/api/simulation')) return m === 'GET' ? 'simulation.view' : 'simulation.run';
  if (path.startsWith('/api/skills') || path.startsWith('/api/tournaments')) return m === 'GET' ? 'skills.view' : 'skills.manage';
  if (path.startsWith('/api/redteam')) return m === 'GET' ? 'redteam.view' : 'redteam.run';
  if (path.startsWith('/api/kgraph')) return m === 'GET' ? 'graph.view' : 'graph.manage';
  if (is(/^\/api\/revenue\/\d+\/invoice$/)) return 'revenue.invoice';
  if (path.startsWith('/api/revenue')) return m === 'GET' ? 'revenue.view' : 'revenue.manage';
  // The platform. Creating a company, minting a key and restoring a database
  // are each their own power — none of them is implied by being able to look.
  if (is(/^\/api\/mkt\/press\/\d+\/approve$/)) return 'press.approve';
  if (path.startsWith('/api/mkt/')) return m === 'GET' ? 'marketing.view' : 'marketing.manage';
  if (path.startsWith('/api/tenants')) return m === 'GET' ? 'tenants.view' : 'tenants.manage';
  if (path.startsWith('/api/keys')) return m === 'GET' ? 'keys.view' : 'keys.manage';
  if (path.startsWith('/api/webhooks')) return m === 'GET' ? 'webhooks.view' : 'webhooks.manage';
  if (path.startsWith('/api/packages')) return m === 'GET' ? 'packages.view' : 'packages.install';
  if (path.startsWith('/api/chief')) return m === 'GET' ? 'chief.view' : 'chief.run';
  if (path.startsWith('/api/observe')) return m === 'GET' ? 'observe.view' : 'observe.run';
  if (is(/^\/api\/backups\/\d+\/restore$/)) return 'backups.restore';
  if (path.startsWith('/api/backups')) return m === 'GET' ? 'backups.view' : 'backups.take';
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
      const result = await handler(m.slice(1), body, url, user);
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
