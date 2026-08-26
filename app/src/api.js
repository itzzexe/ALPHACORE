// REST API — thin JSON layer over the modules. Human actions (approvals,
// evidence verification, decisions, freezes) require an `actor` field naming
// the human; the audit log records it. No agent path can reach these handlers.
import { q, one, atomically } from './db.js';
import { verifyChain, audit } from './audit.js';
import { providersConfig, budgetsConfig } from './env.js';
import { isProviderAvailable as providerAvailable, isMockMode as mockMode, settingsOverview, setSetting } from './settings.js';
import {
  vapidKeys, pushOverview, subscribe as pushSubscribe,
  unsubscribe as pushUnsubscribe, deliver as pushDeliver,
} from './push.js';
import { anchorNow, anchorsOverview, verifyAnchors, anchorEvidence } from './anchor.js';
import { isProduction } from './production.js';
import { openPii, erasureOverview, findSubject, eraseSubject, verifyErasure } from './erasure.js';
import { startBackfill, backfillOverview } from './backfill.js';
// Aliased: Core 1s corporate module already exports createPerson and
// listPeople for its own founder roster. Two galaxies, two meanings, one
// import list — so the Core 2 ones say which core they belong to.
import {
  createPerson as c2CreatePerson, listPeople as c2ListPeople, personDossier, linkUser,
  employ, getEmployee, listEmployees, reportingLine, orgChart,
  createOrgUnit, createPosition, createGrade, identityOverview,
} from './core2/identity.js';
import { bridgeOverview, seedBridge, verbCoverage } from './core2/bridge.js';
import { storeFile, readFile, deleteFile, filesFor, filesOverview } from './core2/files.js';
import {
  createShift, assignShift, shiftOn, judgeDay, claimOvertime, decideOvertime, shiftsOverview,
} from './core2/shifts.js';
import { setRule, rules, computeDeductions, endOfService, payRulesOverview } from './core2/payrules.js';
import { issue, takeBack, heldBy, clearedToLeave, custodyOverview } from './core2/custody.js';
import { start as startList, tick as tickStep, close as closeList, listDetail, joiningOverview } from './core2/joining.js';
import {
  seedClasses, setClass, placeHold, releaseHold, liveHolds, dueForDisposition,
  recordDisposal, recordsOverview,
} from './core2/records.js';
import {
  createDocument, addVersion, getDocument, listDocuments, archiveDocument,
  searchDocuments, documentsOverview, READ_PERMISSION,
} from './core2/documents.js';
import {
  checkIn, checkOut, createPolicy, requestLeave, decideLeave, listLeave, timeOverview,
} from './core2/time.js';
import {
  createMeeting, getMeeting, setMeetingState, addAction, listMeetings, meetingsOverview,
} from './core2/meetings.js';
import {
  createCostCenter, submitExpense, decideExpense, payExpense, listExpenses, createLoan,
  draftPayroll, approvePayrollRun, closePayrollRun, getRun, payopsOverview,
} from './core2/payops.js';
import {
  createProcurement, advanceProcurement, listProcurement, listExpiring, procureOverview,
} from './core2/procure.js';
import {
  openVacancy, apply, advanceApplication, hire, listVacancies, listApplications,
  tasksFor, completeTask, setObjective, writeReviewEvidence, setRating, getReview,
  createCourse, grantCertificate, competencyMatrix, terminateEmployee, recordDisciplinary, talentOverview,
} from './core2/talent.js';
import * as hrplus from './core2/hrplus.js';
import * as fin2 from './core2/finance.js';
import * as bank from './core2/bank.js';
import * as ops from './core2/ops.js';
import * as adm from './core2/admin.js';
import {
  overview as taxOverview, addJurisdiction, classify as taxClassify, recordLine as recordTaxLine,
  sweep as taxSweep, buildReturn, fileReturn, postDraft as postTaxDraft,
} from './tax.js';
import {
  overview as privacyOverview, proposeFlow, decideFlow, logRequest, buildExport, answerRequest,
} from './privacy.js';
import { overview as ipOverview, register as registerIp, advance as advanceIp } from './ip.js';
import {
  overview as helpOverview, sweepTickets, draftForGap, write as writeArticle, publish as publishArticle,
} from './helpcentre.js';
import {
  overview as datagovOverview, rebuild as rebuildInventory, defineClass, classifyColumn,
  recordTiering, tiering,
} from './datagov.js';
import {
  overview as trustOverview, publishDocument as publishTrustDocument,
  retireDocument as retireTrustDocument, addSubprocessor,
} from './trustcentre.js';
import {
  overview as statusOverview, seedComponents, setComponent, postNotice, updateNotice, addTerm as addSlaTerm,
} from './statuspage.js';
import { overview as partnershipsOverview, setIntegration } from './partnerships.js';
import {
  overview as officesOverview, setOn as setOfficesOn, playOne as officesPlay,
  roomFeed as officesRoomFeed, seed as officesSeed, encounterLines as officesLines,
} from './offices.js';
import {
  overview as growthOverview, start as startExperiment, record as recordResult,
  conclude as concludeExperiment2,
} from './growth.js';
// Aliased: securityOverview already means the SOC department in this file,
// and an account's own second factor is a different thing entirely.
import {
  securityOverview as accountSecurity, beginTotp, confirmTotp, disableTotp, endOtherSessions,
} from './auth.js';
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
import { listSecrets, putSecret, dropSecret, getSecret as vaultGet, keyHealth } from './vault.js';
import { lifecycleOverview, alert } from './lifecycle.js';
import { observabilityOverview, applyRetention } from './observability.js';
import { canaryOverview, promptHistory, proposeChain, runCanary, promoteChain, revertChain } from './canary.js';
import { approvalsOverview, roleTemplates, applyTemplate, delegate, endDelegation } from './approvals.js';
import { embeddingsOverview, reindex } from './embeddings.js';
import { deliverabilityOverview, preflight, recordingRule } from './deliverability.js';
import {
  DRIVERS, addConnector, connect, setConnectorState, setAllowlist,
  getConnector, connectorsOverview, callConnector,
} from './connectors/index.js';
import { overview as certificationOverview } from './certification.js';
import { authorizeUrl } from './connectors/oauth.js';
import { getSetting } from './settings.js';
import { egressOverview, releaseGated, denyGated, grantScope, revokeScope, scopesFor } from './egress.js';
import { jobsOverview, retryJob, cancelJob } from './jobs.js';
import { webOverview, readFetch, fetchPage, searchWeb, browsePage } from './web.js';
import { mcpOverview, registerServer, syncServer, callTool, allTools, ALPHACORE_TOOLS } from './mcp.js';
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
import {
  chart, addAccount, journalEntry, postEntry, reverseEntry, journalList, ledgerFor,
  trialBalance, incomeStatement, balanceSheet, cashFlow, ledgerOverview,
  closePeriod, reopenPeriod,
} from './ledger.js';
import { bookkeep, reconcile, closeMonth, bookkeeperOverview } from './bookkeeper.js';
import { hunt, lookup, huntsList, huntDetail, huntOverview } from './hunt.js';
import {
  drive, approveStep, refuseStep, stopSession, sessionDetail, sessionsList, browserOverview,
} from './browser.js';
import { economicsOverview, unitEconomics, agentEconomics, customerEconomics } from './economics.js';
import {
  createOrder, pauseOrder, resumeOrder, deleteOrder, fireOrder, ordersList, orderDetail, standingOverview,
} from './standing.js';
import { deadLetters, deadLetterOverview, reviveRun } from './workflow.js';
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
import {
  connectionsFor, relationshipMatrix, sectionCatalog, DIVISIONS, connectivityAudit, flowStats,
  SURFACES, surfaceCatalog, surfaceAudit, core2Map, CORE2_DIVISIONS, CORES, mapState,
} from './links.js';
import { ask, askRules } from './ask.js';
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
  ['GET', /^\/api\/health$/, () => ({ ok: true, mockMode: mockMode(), production: isProduction(), now: new Date().toISOString() })],

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
    return rows.map((r) => ({ ...r, input: r.input ? JSON.parse(r.input) : null, output: r.output ? JSON.parse(openPii(r.output)) : null, flags: r.flags ? JSON.parse(r.flags) : [] }));
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

  // --- The ledger: the books themselves ---
  ['GET', /^\/api\/ledger$/, () => ledgerOverview()],
  ['GET', /^\/api\/ledger\/chart$/, () => ({ accounts: chart() })],
  ['POST', /^\/api\/ledger\/chart$/, (_p, body) => addAccount({ ...body, actor: need(body, 'actor') })],
  ['GET', /^\/api\/ledger\/journal$/, (_p, _b, url) => ({
    entries: journalList({
      period: url.searchParams.get('period'), state: url.searchParams.get('state'),
      account: url.searchParams.get('account'), q: url.searchParams.get('q'),
    }),
  })],
  ['POST', /^\/api\/ledger\/journal$/, (_p, body) => journalEntry({ ...body, actor: need(body, 'actor') })],
  ['POST', /^\/api\/ledger\/journal\/(\d+)\/post$/, ([id], body) => postEntry({ id: Number(id), actor: need(body, 'actor') })],
  ['POST', /^\/api\/ledger\/journal\/(\d+)\/reverse$/, ([id], body) => reverseEntry({
    id: Number(id), actor: need(body, 'actor'), reason: need(body, 'reason'),
  })],
  ['GET', /^\/api\/ledger\/account\/([\w.-]+)$/, ([code], _b, url) => ledgerFor({ account: code, period: url.searchParams.get('period') })],
  ['GET', /^\/api\/ledger\/trial-balance$/, (_p, _b, url) => trialBalance({ period: url.searchParams.get('period') })],
  ['GET', /^\/api\/ledger\/income$/, (_p, _b, url) => incomeStatement({ period: url.searchParams.get('period') })],
  ['GET', /^\/api\/ledger\/balance-sheet$/, (_p, _b, url) => balanceSheet({ asOf: url.searchParams.get('asOf') })],
  ['GET', /^\/api\/ledger\/cash-flow$/, (_p, _b, url) => cashFlow({ period: url.searchParams.get('period') })],
  ['POST', /^\/api\/ledger\/period\/close$/, (_p, body) => closePeriod({ period: need(body, 'period'), actor: need(body, 'actor') })],
  ['POST', /^\/api\/ledger\/period\/reopen$/, (_p, body) => reopenPeriod({
    period: need(body, 'period'), actor: need(body, 'actor'), reason: need(body, 'reason'),
  })],

  // --- The AI employees who keep them ---
  ['GET', /^\/api\/bookkeeper$/, () => bookkeeperOverview()],
  ['POST', /^\/api\/bookkeeper\/sweep$/, (_p, body) => bookkeep({ actor: body?.actor || 'agent:AGT-FIN-001' })],
  ['GET', /^\/api\/bookkeeper\/reconcile$/, (_p, _b, url) => reconcile({ period: url.searchParams.get('period') })],
  ['POST', /^\/api\/bookkeeper\/close$/, (_p, body) => closeMonth({
    period: body?.period || null, actor: need(body, 'actor'), force: body?.force === true,
  })],

  // --- Finding things: one pass, or a hunt that keeps going ---
  ['GET', /^\/api\/hunt$/, () => huntOverview()],
  ['GET', /^\/api\/hunt\/lookup$/, (_p, _b, url) => lookup(url.searchParams.get('q'))],
  ['GET', /^\/api\/hunt\/list$/, () => ({ hunts: huntsList({}) })],
  ['GET', /^\/api\/hunt\/(\d+)$/, ([id]) => huntDetail(Number(id))],
  ['POST', /^\/api\/hunt$/, (_p, body) => hunt({
    question: need(body, 'question'), actor: need(body, 'actor'),
    rounds: body?.rounds ? Number(body.rounds) : undefined,
    maxUsd: body?.maxUsd ? Number(body.maxUsd) : undefined,
    allowWeb: body?.allowWeb !== false,
    sources: Array.isArray(body?.sources) ? body.sources : null,
  })],

  // --- The browser the employees drive ---
  ['GET', /^\/api\/browser$/, () => browserOverview()],
  ['GET', /^\/api\/browser\/list$/, () => ({ sessions: sessionsList({}) })],
  ['GET', /^\/api\/browser\/(\d+)$/, ([id]) => sessionDetail(Number(id))],
  ['POST', /^\/api\/browser$/, (_p, body) => drive({
    goal: need(body, 'goal'), actor: need(body, 'actor'),
    startUrl: body?.startUrl || null,
    maxSteps: body?.maxSteps ? Number(body.maxSteps) : undefined,
    maxUsd: body?.maxUsd ? Number(body.maxUsd) : undefined,
  })],
  // Approving is its own permission and its own act: the signature is for the
  // step that was shown, never for the session.
  ['POST', /^\/api\/browser\/(\d+)\/approve$/, ([id], body) => approveStep({
    id: Number(id), actor: need(body, 'actor'), note: body?.note || null,
  })],
  ['POST', /^\/api\/browser\/(\d+)\/refuse$/, ([id], body) => refuseStep({
    id: Number(id), actor: need(body, 'actor'), why: body?.why || '',
  })],
  ['POST', /^\/api\/browser\/(\d+)\/stop$/, ([id], body) => stopSession({ id: Number(id), actor: need(body, 'actor') })],

  // --- Does the workforce earn its keep ---
  ['GET', /^\/api\/economics$/, (_p, _b, url) => economicsOverview({ month: url.searchParams.get('month') })],
  ['GET', /^\/api\/economics\/unit$/, (_p, _b, url) => unitEconomics({ month: url.searchParams.get('month') })],
  ['GET', /^\/api\/economics\/agents$/, (_p, _b, url) => ({ agents: agentEconomics({ month: url.searchParams.get('month') }) })],
  ['GET', /^\/api\/economics\/customers$/, () => ({ customers: customerEconomics() })],

  // --- Things the company keeps doing without being asked again ---
  ['GET', /^\/api\/standing$/, () => standingOverview()],
  ['GET', /^\/api\/standing\/(\d+)$/, ([id]) => orderDetail(Number(id))],
  ['POST', /^\/api\/standing$/, (_p, body) => createOrder({
    goal: need(body, 'goal'), kind: need(body, 'kind'), schedule: need(body, 'schedule'),
    reason: need(body, 'reason'), actor: need(body, 'actor'),
    target: body?.target || null,
    maxUsdPerRun: body?.maxUsdPerRun ? Number(body.maxUsdPerRun) : undefined,
    lifetimeUsd: body?.lifetimeUsd ? Number(body.lifetimeUsd) : undefined,
    expiresAt: body?.expiresAt || null,
  })],
  ['POST', /^\/api\/standing\/(\d+)\/pause$/, ([id], body) => pauseOrder({ id: Number(id), actor: need(body, 'actor'), why: body?.why || '' })],
  ['POST', /^\/api\/standing\/(\d+)\/resume$/, ([id], body) => resumeOrder({ id: Number(id), actor: need(body, 'actor') })],
  ['POST', /^\/api\/standing\/(\d+)\/delete$/, ([id], body) => deleteOrder({ id: Number(id), actor: need(body, 'actor') })],
  ['POST', /^\/api\/standing\/(\d+)\/fire$/, ([id], body) => fireOrder(Number(id), { manual: true, actor: need(body, 'actor') })],

  // --- Work that failed for good, and was written down and never read ---
  ['GET', /^\/api\/deadletter$/, () => deadLetterOverview()],
  ['GET', /^\/api\/deadletter\/list$/, () => ({ dead: deadLetters({}) })],
  ['POST', /^\/api\/deadletter\/([\w-]+)\/revive$/, ([runId], body) => reviveRun(runId, {
    actor: need(body, 'actor'), why: body?.why || '',
  })],

  // --- Notifications ---
  ['GET', /^\/api\/notifications$/, (_p, _b, url) => ({ unread: unreadCount(), items: listNotifications({ unreadOnly: url.searchParams.get('unread') === '1' }) })],
  ['POST', /^\/api\/notifications\/read$/, () => { markAllRead(); return { ok: true }; }],

  // --- Push: the only way to reach somebody who is not looking at a tab ---
  ['GET', /^\/api\/push\/key$/, () => ({ publicKey: vapidKeys().publicKey })],
  ['GET', /^\/api\/push$/, () => pushOverview()],

  // --- Your own account: second factor, sessions, attempts ---
  // Under /api/account, not /api/security: the latter is the SOC department,
  // and sharing the prefix shadowed its overview route and would have dragged
  // its permission rule down with these.
  ['GET', /^\/api\/account\/security$/, (_p, _b, _u, user) => accountSecurity(user.id)],
  ['POST', /^\/api\/account\/totp\/begin$/, (_p, _b, _u, user) => beginTotp(user.id)],
  ['POST', /^\/api\/account\/totp\/confirm$/, (_p, body, _u, user) => confirmTotp(user.id, need(body, 'code'))],
  ['POST', /^\/api\/account\/totp\/disable$/, (_p, body, _u, user) => disableTotp(user.id, need(body, 'password'))],
  ['POST', /^\/api\/account\/sessions\/end-others$/, (_p, body, _u, user) => endOtherSessions(user.id, body.keep || null)],

  // Whether mail arrives, and whether a recording is lawful.
  ['GET', /^\/api\/deliverability$/, () => deliverabilityOverview()],
  ['GET', /^\/api\/deliverability\/preflight$/, () => preflight({})],
  ['POST', /^\/api\/deliverability\/consent$/, (_p, body) => recordingRule({
    country: need(body, 'country'), region: body.region || null,
  })],

  // Recall, and which of the two kinds of it is in use.
  ['GET', /^\/api\/embeddings$/, () => embeddingsOverview()],
  ['POST', /^\/api\/embeddings\/reindex$/, () => reindex()],

  // Everything waiting on a person, and who may sit at that desk.
  ['GET', /^\/api\/approvals$/, (_p, _b, _u, user) => approvalsOverview(user)],
  ['GET', /^\/api\/roles$/, () => ({ templates: roleTemplates() })],
  ['POST', /^\/api\/roles\/(\d+)$/, ([userId], body) => applyTemplate({
    userId: Number(userId), template: need(body, 'template'),
    replace: body.replace !== false, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/delegations$/, (_p, body, _u, user) => delegate({
    fromUserId: body.fromUserId ? Number(body.fromUserId) : user.id,
    toUserId: Number(need(body, 'toUserId')),
    untilHours: body.hours, reason: body.reason || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/delegations\/(\d+)\/end$/, ([id], body) => endDelegation({ id: Number(id), actor: need(body, 'actor') })],

  // Prompt versions, and not changing a model chain on a hunch.
  ['GET', /^\/api\/tiers$/, () => canaryOverview()],
  ['GET', /^\/api\/prompts\/([\w-]+)$/, ([agentId]) => ({ agentId, versions: promptHistory(agentId) })],
  ['POST', /^\/api\/tiers\/propose$/, (_p, body) => proposeChain({
    tier: need(body, 'tier'), chain: need(body, 'chain'), note: body.note || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/tiers\/(\d+)\/canary$/, ([id]) => runCanary({ proposalId: Number(id), route })],
  ['POST', /^\/api\/tiers\/(\d+)\/promote$/, ([id], body) => promoteChain({
    proposalId: Number(id), actor: need(body, 'actor'), acceptRegressions: Boolean(body.acceptRegressions),
  })],
  ['POST', /^\/api\/tiers\/revert$/, (_p, body) => revertChain({ tier: need(body, 'tier'), actor: need(body, 'actor') })],

  // Size, retention, and how late the event loop is running.
  ['GET', /^\/api\/observability$/, () => observabilityOverview()],
  ['POST', /^\/api\/observability\/retention$/, (_p, body) => applyRetention({ actor: need(body, 'actor'), dryRun: body.dryRun !== false })],

  // Draining, alerting, and whether a backup has ever left this machine.
  ['GET', /^\/api\/lifecycle$/, () => lifecycleOverview()],
  ['POST', /^\/api\/lifecycle\/alert-test$/, (_p, body) => alert({
    level: 'info', subject: 'A test from AlphaCore',
    text: 'If you are reading this, alerts reach you.', channel: body.channel || null,
  })],

  // Where the master key comes from, and whether everything still reads.
  // Rotation itself is not here: it belongs at a terminal, because the
  // authority it needs is the key file, not a browser session.
  ['GET', /^\/api\/vault\/key$/, () => keyHealth()],

  // --- Core 2: the enterprise galaxy ---
  //
  // Everything below reads or writes the system of record. Note what is absent:
  // no route here lets an agent through. An agent reaching Core 2 goes via the
  // command gateway in src/core2/bridge.js, which is a different code path with
  // a human gate on it — these are the routes a *person* uses.
  ['GET', /^\/api\/core2$/, () => ({ identity: identityOverview(), bridges: bridgeOverview() })],
  ['GET', /^\/api\/core2\/people$/, (_p, _b, url) => ({
    people: c2ListPeople({ limit: Number(url.searchParams.get('limit')) || 200 }),
    overview: identityOverview(),
  })],
  ['GET', /^\/api\/core2\/people\/(\d+)$/, ([id]) => personDossier(Number(id))
    || (() => { throw new HttpError(404, 'no such person'); })()],
  ['POST', /^\/api\/core2\/people$/, (_p, body, _u, user) => c2CreatePerson({
    displayName: need(body, 'displayName'),
    personalEmail: body.personalEmail || null, personalPhone: body.personalPhone || null,
    nationalId: body.nationalId || null, emergencyContact: body.emergencyContact || null,
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/people\/(\d+)\/link-user$/, ([id], body, _u, user) => linkUser(
    Number(id), need(body, 'userId'), { actor: `human:${user.username}` },
  )],

  ['GET', /^\/api\/core2\/employees$/, (_p, _b, url) => ({
    employees: listEmployees({
      state: url.searchParams.get('state'), orgUnitId: url.searchParams.get('orgUnitId'), limit: 500,
    }),
  })],
  ['GET', /^\/api\/core2\/employees\/(\d+)$/, ([id]) => getEmployee(Number(id))
    || (() => { throw new HttpError(404, 'no such employee'); })()],
  ['GET', /^\/api\/core2\/employees\/(\d+)\/line$/, ([id]) => reportingLine(Number(id))],
  ['POST', /^\/api\/core2\/employees$/, (_p, body, _u, user) => employ({
    personId: need(body, 'personId'), employeeNo: body.employeeNo,
    orgUnitId: body.orgUnitId || null, positionId: body.positionId || null, gradeId: body.gradeId || null,
    managerId: body.managerId || null, employment: body.employment || 'full-time',
    baseSalary: body.baseSalary ?? null, bankAccount: body.bankAccount || null,
    currency: body.currency || 'USD', hiredAt: body.hiredAt || null,
    actor: `human:${user.username}`,
  })],

  ['GET', /^\/api\/core2\/org$/, () => orgChart()],
  ['POST', /^\/api\/core2\/org\/unit$/, (_p, body, _u, user) => createOrgUnit({
    name: need(body, 'name'), code: body.code || null, parentId: body.parentId || null,
    core1Section: body.core1Section || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/org\/position$/, (_p, body, _u, user) => createPosition({
    title: need(body, 'title'), orgUnitId: body.orgUnitId || null, gradeId: body.gradeId || null,
    headcount: body.headcount || 1, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/org\/grade$/, (_p, body, _u, user) => createGrade({
    name: need(body, 'name'), rank: body.rank || 1, bandMin: body.bandMin ?? null,
    bandMax: body.bandMax ?? null, currency: body.currency || 'USD', actor: `human:${user.username}`,
  })],

  // The bridges, as a page rather than a claim: what crosses, what is gated,
  // and whether the identity bar still holds.
  ['GET', /^\/api\/core2\/bridges$/, () => bridgeOverview()],
  ['GET', /^\/api\/core2\/verbs$/, () => ({ modules: verbCoverage() })],
  // The two-galaxies map. Derived from the same catalogue and edge list as the
  // first map — see core2Map() in links.js — so a tunnel drawn here is always a
  // declared relationship, never an illustration.
  ['GET', /^\/api\/core2\/map$/, () => core2Map()],

  // --- HR, the rest: time rules, compensation, movements, end of service ---
  ['GET', /^\/api\/core2\/hrops$/, () => hrplus.hrplusOverview()],
  ['POST', /^\/api\/core2\/hrops\/holiday$/, (_p, body, _u, user) => hrplus.addHoliday({ day: need(body, 'day'), name: body.name, actor: `human:${user.username}` })],
  // Shifts and overtime are shifts.js's routes (/api/core2/shifts…); these
  // are the corrections and the calendar that sit beside them.
  ['POST', /^\/api\/core2\/hrops\/correction$/, (_p, body, _u, user) => hrplus.requestCorrection({ employeeId: need(body, 'employeeId'), day: need(body, 'day'), inAt: body.inAt, outAt: body.outAt, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/hrops\/correction\/(\d+)\/decide$/, ([id], body, _u, user) => hrplus.decideCorrection(Number(id), { approve: Boolean(body.approve), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/hrops\/exceptions$/, (_p, _b, url) => hrplus.attendanceExceptions({ period: url.searchParams.get('period') || undefined })],
  ['GET', /^\/api\/core2\/comp$/, () => ({
    plans: hrplus.listBenefitPlans(), grievances: hrplus.listGrievances(),
  })],
  ['POST', /^\/api\/core2\/comp\/allowance$/, (_p, body, _u, user) => hrplus.addAllowance({ employeeId: need(body, 'employeeId'), kind: need(body, 'kind'), amount: need(body, 'amount'), currency: body.currency, starts: body.starts, ends: body.ends, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/plan$/, (_p, body, _u, user) => hrplus.createBenefitPlan({ name: need(body, 'name'), kind: body.kind, employerShare: body.employerShare, employeeShare: body.employeeShare, provider: body.provider, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/enroll$/, (_p, body, _u, user) => hrplus.enroll({ employeeId: need(body, 'employeeId'), planId: need(body, 'planId'), starts: body.starts, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/enroll\/(\d+)\/end$/, ([id], _b, _u, user) => hrplus.endEnrollment(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/salary$/, (_p, body, _u, user) => hrplus.changeSalary({ employeeId: need(body, 'employeeId'), newSalary: need(body, 'newSalary'), effective: body.effective, actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/comp\/salary\/(\d+)$/, ([id]) => ({ history: hrplus.salaryHistory(Number(id)) })],
  ['POST', /^\/api\/core2\/comp\/movement$/, (_p, body, _u, user) => hrplus.recordMovement({ employeeId: need(body, 'employeeId'), kind: need(body, 'kind'), toUnit: body.toUnit, toPosition: body.toPosition, toGrade: body.toGrade, effective: body.effective, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/eos\/(\d+)$/, ([id], _b, _u, user) => hrplus.computeEos({ employeeId: Number(id), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/comp\/eos\/(\d+)$/, ([id]) => hrplus.eosFor(Number(id))],
  ['POST', /^\/api\/core2\/comp\/eos\/(\d+)\/pay$/, ([id], _b, _u, user) => hrplus.payEos(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/grievance$/, (_p, body, _u, user) => hrplus.openGrievance({ employeeId: need(body, 'employeeId'), title: need(body, 'title'), body: need(body, 'body'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/comp\/grievance\/(\d+)\/decide$/, ([id], body, _u, user) => hrplus.decideGrievance(Number(id), { state: need(body, 'state'), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/employees\/(\d+)\/movements$/, ([id]) => ({ movements: hrplus.movementsFor(Number(id)) })],
  ['POST', /^\/api\/core2\/employees\/(\d+)\/letter$/, ([id], _b, _u, user) => hrplus.employmentLetter({ employeeId: Number(id), actor: `human:${user.username}` })],

  // --- Finance sub-ledgers: budgets, payables, receivables, fixed assets, FX ---
  ['GET', /^\/api\/core2\/finance$/, () => ({ ...fin2.financeOverview(), bills: fin2.listBills(), invoices: fin2.listInvoices(), assets: fin2.listFixedAssets() })],
  ['POST', /^\/api\/core2\/budgets$/, (_p, body, _u, user) => fin2.createBudget({ name: body.name, period: need(body, 'period'), lines: need(body, 'lines'), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/budgets\/(\d+)$/, ([id]) => fin2.budgetVariance(Number(id))],
  ['POST', /^\/api\/core2\/budgets\/(\d+)\/approve$/, ([id], _b, _u, user) => fin2.approveBudget(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/budgets\/(\d+)\/close$/, ([id], _b, _u, user) => fin2.closeBudget(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bills$/, (_p, body, _u, user) => fin2.createBill({ vendorId: need(body, 'vendorId'), ref: body.ref, amount: need(body, 'amount'), tax: body.tax, currency: body.currency, accountCode: body.accountCode || '5100', issued: body.issued, due: body.due, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bills\/(\d+)\/approve$/, ([id], _b, _u, user) => fin2.approveBill(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bills\/(\d+)\/pay$/, ([id], body, _u, user) => fin2.payBill(Number(id), { actor: `human:${user.username}`, bankAccountId: body.bankAccountId || null })],
  ['POST', /^\/api\/core2\/bills\/(\d+)\/void$/, ([id], _b, _u, user) => fin2.voidBill(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ar$/, (_p, body, _u, user) => fin2.createInvoice({ customerId: body.customerId, description: need(body, 'description'), amount: need(body, 'amount'), tax: body.tax, currency: body.currency, due: body.due, actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/ar\/(\d+)$/, ([id]) => fin2.getInvoice(Number(id))],
  ['POST', /^\/api\/core2\/ar\/(\d+)\/issue$/, ([id], _b, _u, user) => fin2.issueInvoice(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ar\/(\d+)\/receipt$/, ([id], body, _u, user) => fin2.recordReceipt(Number(id), { amount: need(body, 'amount'), bankAccountId: body.bankAccountId || null, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ar\/(\d+)\/void$/, ([id], _b, _u, user) => fin2.voidInvoice(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/fixed-assets$/, (_p, body, _u, user) => fin2.registerFixedAsset({ name: need(body, 'name'), category: body.category, cost: need(body, 'cost'), salvage: body.salvage, lifeMonths: need(body, 'lifeMonths'), acquired: body.acquired, costCenterId: body.costCenterId, core1AssetId: body.core1AssetId, actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/fixed-assets\/(\d+)$/, ([id]) => fin2.getFixedAsset(Number(id))],
  ['POST', /^\/api\/core2\/fixed-assets\/(\d+)\/dispose$/, ([id], _b, _u, user) => fin2.disposeAsset(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/depreciation$/, (_p, body, _u, user) => fin2.runDepreciation({ period: body.period || undefined, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/fx$/, (_p, body, _u, user) => fin2.setFxRate({ currency: need(body, 'currency'), rateToUsd: need(body, 'rateToUsd'), day: body.day, actor: `human:${user.username}` })],

  // --- The bank ---
  ['GET', /^\/api\/core2\/bank$/, () => bank.bankOverview()],
  ['POST', /^\/api\/core2\/bank\/accounts$/, (_p, body, _u, user) => bank.createBankAccount({ name: need(body, 'name'), bank: body.bank, kind: body.kind, currency: body.currency, iban: body.iban, openingBalance: body.openingBalance, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/accounts\/(\d+)\/close$/, ([id], _b, _u, user) => bank.closeBankAccount(Number(id), { actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/bank\/accounts\/(\d+)\/reconcile$/, ([id]) => bank.reconciliation(Number(id))],
  ['POST', /^\/api\/core2\/bank\/accounts\/(\d+)\/statement$/, ([id], body, _u, user) => bank.importStatement({ accountId: Number(id), label: body.label, lines: need(body, 'lines'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/accounts\/(\d+)\/automatch$/, ([id], _b, _u, user) => bank.autoMatch(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/lines\/(\d+)\/match$/, ([id], body, _u, user) => bank.matchLine(Number(id), { journalLineId: need(body, 'journalLineId'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/lines\/(\d+)\/exclude$/, ([id], _b, _u, user) => bank.excludeLine(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/transfers$/, (_p, body, _u, user) => bank.createTransfer({ fromAccountId: need(body, 'fromAccountId'), toAccountId: body.toAccountId, beneficiary: body.beneficiary, purposeCode: body.purposeCode || '5900', amount: need(body, 'amount'), fee: body.fee, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/transfers\/(\d+)\/approve$/, ([id], _b, _u, user) => bank.approveTransfer(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/transfers\/(\d+)\/execute$/, ([id], _b, _u, user) => bank.executeTransfer(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/cheques$/, (_p, body, _u, user) => bank.issueCheque({ accountId: need(body, 'accountId'), number: need(body, 'number'), direction: body.direction, payee: need(body, 'payee'), amount: need(body, 'amount'), day: body.day, billId: body.billId, invoiceId: body.invoiceId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/cheques\/(\d+)\/state$/, ([id], body, _u, user) => bank.setChequeState(Number(id), { state: need(body, 'state'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/batches\/payroll$/, (_p, body, _u, user) => bank.buildPayrollBatch({ runId: need(body, 'runId'), accountId: need(body, 'accountId'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/batches\/ap$/, (_p, body, _u, user) => bank.buildApBatch({ billIds: need(body, 'billIds'), accountId: need(body, 'accountId'), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/bank\/batches\/(\d+)$/, ([id]) => bank.getBatch(Number(id))],
  ['POST', /^\/api\/core2\/bank\/batches\/(\d+)\/approve$/, ([id], _b, _u, user) => bank.approveBatch(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/bank\/batches\/(\d+)\/release$/, ([id], _b, _u, user) => bank.releaseBatch(Number(id), { actor: `human:${user.username}` })],

  // --- Operations ---
  ['GET', /^\/api\/core2\/ops$/, () => ops.opsOverview()],
  ['POST', /^\/api\/core2\/ops\/warehouse$/, (_p, body, _u, user) => ops.createWarehouse({ name: need(body, 'name'), code: body.code, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/item$/, (_p, body, _u, user) => ops.createItem({ sku: need(body, 'sku'), name: body.name, unit: body.unit, minQty: body.minQty, cost: body.cost, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/stock$/, (_p, body, _u, user) => ops.recordStockMove({ itemId: need(body, 'itemId'), warehouseId: need(body, 'warehouseId'), qty: need(body, 'qty'), kind: body.kind, ref: body.ref, procRequestId: body.procRequestId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/stock\/transfer$/, (_p, body, _u, user) => ops.transferStock({ itemId: need(body, 'itemId'), fromWarehouseId: need(body, 'fromWarehouseId'), toWarehouseId: need(body, 'toWarehouseId'), qty: need(body, 'qty'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/workorder$/, (_p, body, _u, user) => ops.createWorkOrder({ title: need(body, 'title'), targetKind: body.targetKind, targetId: body.targetId, priority: body.priority, assigneeEmployeeId: body.assigneeEmployeeId, due: body.due, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/workorder\/(\d+)\/state$/, ([id], body, _u, user) => ops.setWorkOrderState(Number(id), { state: need(body, 'state'), cost: body.cost, assigneeEmployeeId: body.assigneeEmployeeId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/vehicle$/, (_p, body, _u, user) => ops.addVehicle({ plate: need(body, 'plate'), make: need(body, 'make'), model: body.model, year: body.year, odometer: body.odometer, assigneeEmployeeId: body.assigneeEmployeeId, nextService: body.nextService, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/vehicle\/(\d+)$/, ([id], body, _u, user) => ops.updateVehicle(Number(id), { odometer: body.odometer, assigneeEmployeeId: body.assigneeEmployeeId, nextService: body.nextService, state: body.state, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/room$/, (_p, body, _u, user) => ops.createRoom({ name: need(body, 'name'), building: body.building, capacity: body.capacity, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/booking$/, (_p, body, _u, user) => ops.bookRoom({ roomId: need(body, 'roomId'), employeeId: need(body, 'employeeId'), starts: need(body, 'starts'), ends: need(body, 'ends'), meetingId: body.meetingId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/booking\/(\d+)\/cancel$/, ([id], _b, _u, user) => ops.cancelBooking(Number(id), { actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/helpdesk$/, (_p, _b, url) => ({ tickets: ops.listTickets({ state: url.searchParams.get('state') || null }), incidents: ops.listIncidents(), open: ops.opsOverview().ticketsOpen, breached: ops.opsOverview().ticketsBreached })],
  ['POST', /^\/api\/core2\/helpdesk$/, (_p, body, _u, user) => ops.openTicket({ category: body.category, priority: body.priority, title: need(body, 'title'), requesterEmployeeId: body.requesterEmployeeId, body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/helpdesk\/(\d+)\/assign$/, ([id], body, _u, user) => ops.assignTicket(Number(id), { assigneeEmployeeId: need(body, 'assigneeEmployeeId'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/helpdesk\/(\d+)\/state$/, ([id], body, _u, user) => ops.setTicketState(Number(id), { state: need(body, 'state'), actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/incident$/, (_p, body, _u, user) => ops.reportIncident({ kind: body.kind, severity: body.severity, title: need(body, 'title'), occurredAt: body.occurredAt, action: body.action, body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/ops\/incident\/(\d+)\/state$/, ([id], body, _u, user) => ops.setIncidentState(Number(id), { state: need(body, 'state'), action: body.action, actor: `human:${user.username}` })],

  // --- Administration ---
  ['GET', /^\/api\/core2\/admin$/, () => adm.adminOverview()],
  ['POST', /^\/api\/core2\/admin\/letter$/, (_p, body, _u, user) => adm.registerLetter({ direction: body.direction, subject: need(body, 'subject'), counterparty: body.counterparty, orgUnitId: body.orgUnitId, day: body.day, body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/letter\/(\d+)\/state$/, ([id], body, _u, user) => adm.setLetterState(Number(id), { state: need(body, 'state'), orgUnitId: body.orgUnitId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/committee$/, (_p, body, _u, user) => adm.createCommittee({ name: need(body, 'name'), chairEmployeeId: body.chairEmployeeId, memberIds: body.memberIds, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/resolution$/, (_p, body, _u, user) => adm.proposeResolution({ committeeId: need(body, 'committeeId'), title: need(body, 'title'), body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/resolution\/(\d+)\/decide$/, ([id], body, _u, user) => adm.decideResolution(Number(id), { state: need(body, 'state'), actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/legalcases$/, () => ({ cases: adm.listCases() })],
  ['POST', /^\/api\/core2\/legalcases$/, (_p, body, _u, user) => adm.openCase({ kind: body.kind, counterparty: need(body, 'counterparty'), court: body.court, contractId: body.contractId, nextHearing: body.nextHearing, exposure: body.exposure, body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/legalcases\/(\d+)\/state$/, ([id], body, _u, user) => adm.setCaseState(Number(id), { state: need(body, 'state'), nextHearing: body.nextHearing, exposure: body.exposure, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/obligation$/, (_p, body, _u, user) => adm.addObligation({ title: need(body, 'title'), authority: body.authority, due: need(body, 'due'), recurrence: body.recurrence, orgUnitId: body.orgUnitId, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/obligation\/(\d+)\/done$/, ([id], _b, _u, user) => adm.completeObligation(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/license$/, (_p, body, _u, user) => adm.addLicense({ name: need(body, 'name'), authority: body.authority, number: body.number, issued: body.issued, expires: need(body, 'expires'), body: body.body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/admin\/license\/(\d+)\/renew$/, ([id], body, _u, user) => adm.renewLicense(Number(id), { expires: need(body, 'expires'), actor: `human:${user.username}` })],
  // Anybody may acknowledge a policy — for themselves. Only admin.manage may
  // record one on somebody else's behalf; everybody else's employeeId is
  // whatever their own login resolves to, whatever the body says.
  ['POST', /^\/api\/core2\/admin\/policy-ack$/, (_p, body, _u, user) => {
    const own = adm.myWorkspace(user)?.employee?.id || null;
    const employeeId = hasPerm(user, 'admin.manage') ? (body.employeeId || own) : own;
    if (!employeeId) throw new HttpError(400, 'this login is not linked to an employment');
    return adm.acknowledgePolicy({ docId: need(body, 'docId'), employeeId, actor: `human:${user.username}` });
  }],
  ['GET', /^\/api\/core2\/admin\/policy-ack\/(\d+)$/, ([id]) => adm.policyAckStatus(Number(id))],

  // The page about you. No permission beyond being signed in: it shows only
  // what is yours, and a login with no person behind it is told so.
  ['GET', /^\/api\/core2\/me$/, (_p, _b, _u, user) => adm.myWorkspace(user)],
  // --- Files: sealed bytes, not a path in a sealed column ---
  ['GET', /^\/api\/core2\/files$/, () => filesOverview()],
  ['GET', /^\/api\/core2\/files\/for\/([a-z]+)\/(\d+)$/, ([kind, id]) => ({ files: filesFor(kind, Number(id)) })],
  ['POST', /^\/api\/core2\/files$/, (_p, body, _u, user) => storeFile({
    bytes: need(body, 'bytes'), filename: need(body, 'filename'), mime: body.mime || null,
    subjectKind: body.subjectKind || 'company', subjectId: body.subjectId || 'company',
    attachType: body.attachType || null, attachId: body.attachId ? Number(body.attachId) : null,
    note: body.note || null, actor: `human:${user.username}`,
  })],
  // Returned as base64 rather than a stream: the bytes are decrypted in this
  // process and a download URL that bypasses the permission check is exactly
  // the hole this module exists to avoid.
  ['GET', /^\/api\/core2\/files\/(\d+)$/, ([id], _b, _u, user) => {
    const f = readFile(Number(id), { actor: `human:${user.username}` });
    return { ...f, content: f.content ? f.content.toString('base64') : null };
  }],
  ['POST', /^\/api\/core2\/files\/(\d+)\/delete$/, ([id], body, _u, user) => deleteFile(Number(id), {
    actor: `human:${user.username}`, why: body?.why || '',
  })],

  // --- Shifts, and the extra minutes that are not overtime until signed ---
  ['GET', /^\/api\/core2\/shifts$/, (_p, _b, url) => shiftsOverview({ period: url.searchParams.get('period') })],
  ['POST', /^\/api\/core2\/shifts$/, (_p, body, _u, user) => createShift({
    name: need(body, 'name'), starts: need(body, 'starts'), ends: need(body, 'ends'),
    days: body.days || undefined, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/shifts\/assign$/, (_p, body, _u, user) => assignShift({
    employeeId: Number(need(body, 'employeeId')), shiftId: Number(need(body, 'shiftId')),
    from: need(body, 'from'), to: body.to || null, actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/shifts\/day\/(\d+)\/([\d-]+)$/, ([id, day]) => judgeDay(Number(id), day)],
  ['GET', /^\/api\/core2\/shifts\/on\/(\d+)\/([\d-]+)$/, ([id, day]) => shiftOn(Number(id), day) || {}],
  ['POST', /^\/api\/core2\/overtime$/, (_p, body, _u, user) => claimOvertime({
    employeeId: Number(need(body, 'employeeId')), day: need(body, 'day'),
    minutes: need(body, 'minutes'), reason: need(body, 'reason'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/overtime\/(\d+)\/decide$/, ([id], body, _u, user) => decideOvertime(Number(id), {
    approve: body?.approve === true, note: body?.note || '', actor: `human:${user.username}`,
  })],

  // --- What a company deducts, and what it owes when somebody leaves ---
  ['GET', /^\/api\/core2\/payrules$/, () => payRulesOverview()],
  ['POST', /^\/api\/core2\/payrules$/, (_p, body, _u, user) => setRule({
    code: need(body, 'code'), label: need(body, 'label'), kind: body.kind || 'tax',
    base: body.base || 'gross', paidBy: body.paidBy || 'employee',
    percent: body.percent ?? null, bands: body.bands || null,
    capAmount: body.capAmount ?? null, floorAmount: body.floorAmount ?? null,
    basis: need(body, 'basis'), active: body.active !== false, actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/payrules\/preview$/, (_p, _b, url) => computeDeductions({
    gross: Number(url.searchParams.get('gross') || 0),
    basic: Number(url.searchParams.get('basic') || 0),
    deductions: Number(url.searchParams.get('deductions') || 0),
  })],
  ['GET', /^\/api\/core2\/endofservice\/(\d+)$/, ([id], _b, url) => endOfService({
    employeeId: Number(id), lastDay: url.searchParams.get('lastDay'), reason: url.searchParams.get('reason') || 'resigned',
  })],

  // --- Who is holding what ---
  ['GET', /^\/api\/core2\/custody$/, () => custodyOverview()],
  ['GET', /^\/api\/core2\/custody\/(\d+)$/, ([id]) => ({ held: heldBy(Number(id)), cleared: clearedToLeave(Number(id)) })],
  ['POST', /^\/api\/core2\/custody$/, (_p, body, _u, user) => issue({
    employeeId: Number(need(body, 'employeeId')), assetId: body.assetId ? Number(body.assetId) : null,
    description: body.description || null, serial: body.serial || null,
    condition: body.condition || 'good', note: body.note || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/custody\/(\d+)\/return$/, ([id], body, _u, user) => takeBack(Number(id), {
    condition: body?.condition || 'good', note: body?.note || null, actor: `human:${user.username}`,
  })],

  // --- A first day and a last day, as a checklist ---
  ['GET', /^\/api\/core2\/joining$/, () => joiningOverview()],
  ['GET', /^\/api\/core2\/joining\/(\d+)$/, ([id]) => listDetail(Number(id))],
  ['POST', /^\/api\/core2\/joining$/, (_p, body, _u, user) => startList({
    employeeId: Number(need(body, 'employeeId')), kind: need(body, 'kind'),
    on: body.on || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/joining\/step\/(\d+)$/, ([id], body, _u, user) => tickStep(Number(id), {
    note: body?.note || null, skip: body?.skip === true, why: body?.why || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/joining\/(\d+)\/close$/, ([id], _b, _u, user) => closeList(Number(id), { actor: `human:${user.username}` })],

  // --- Records: how long a thing is kept, and what freezes it ---
  ['GET', /^\/api\/core2\/records$/, () => recordsOverview()],
  ['GET', /^\/api\/core2\/records\/schedule$/, () => ({ classes: dueForDisposition() })],
  ['GET', /^\/api\/core2\/records\/holds$/, () => ({ holds: liveHolds() })],
  ['POST', /^\/api\/core2\/records\/seed$/, (_p, _b, _u, user) => ({ seeded: seedClasses({ actor: `human:${user.username}` }) })],
  ['POST', /^\/api\/core2\/records\/class$/, (_p, body, _u, user) => setClass({
    code: need(body, 'code'), label: need(body, 'label'), keepMonths: need(body, 'keepMonths'),
    disposition: body.disposition || 'destroy', basis: need(body, 'basis'),
    appliesTo: body.appliesTo || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/records\/hold$/, (_p, body, _u, user) => placeHold({
    scopeKind: need(body, 'scopeKind'), scopeId: body.scopeId ?? null,
    reason: need(body, 'reason'), matter: body.matter || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/records\/hold\/(\d+)\/release$/, ([id], body, _u, user) => releaseHold({
    id: Number(id), actor: `human:${user.username}`, note: body?.note || '',
  })],
  ['POST', /^\/api\/core2\/records\/disposal$/, (_p, body, _u, user) => recordDisposal({
    classCode: need(body, 'classCode'), what: need(body, 'what'), ref: body.ref || null,
    action: body.action || 'destroyed', count: body.count || 1, actor: `human:${user.username}`,
  })],

  // --- time: attendance and leave ---
  ['GET', /^\/api\/core2\/time$/, () => timeOverview()],
  ['POST', /^\/api\/core2\/time\/checkin$/, (_p, body, _u, user) => checkIn(need(body, 'employeeId'), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/time\/checkout$/, (_p, body, _u, user) => checkOut(need(body, 'employeeId'), { actor: `human:${user.username}` })],
  ['GET', /^\/api\/core2\/leave$/, (_p, _b, url) => ({
    requests: listLeave({ state: url.searchParams.get('state') || null }),
  })],
  ['POST', /^\/api\/core2\/leave$/, (_p, body, _u, user) => requestLeave({
    employeeId: need(body, 'employeeId'), policyId: need(body, 'policyId'),
    starts: need(body, 'starts'), ends: need(body, 'ends'), docId: body.docId || null,
    actor: `human:${user.username}`,
  })],
  // Deciding is a human act: the actor is the signed-in person, and no gateway
  // command exists that reaches this function.
  ['POST', /^\/api\/core2\/leave\/(\d+)\/decide$/, ([id], body, _u, user) => decideLeave(Number(id), {
    approve: Boolean(body.approve), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/leave\/policy$/, (_p, body, _u, user) => createPolicy({
    name: need(body, 'name'), leaveType: need(body, 'leaveType'),
    daysPerYear: body.daysPerYear || 0, carryForwardMax: body.carryForwardMax || 0,
    needsDocument: Boolean(body.needsDocument), actor: `human:${user.username}`,
  })],

  // --- finance ops: expenses, loans, cost centers, payroll ---
  ['GET', /^\/api\/core2\/finops$/, () => payopsOverview()],
  ['GET', /^\/api\/core2\/expenses$/, (_p, _b, url) => ({ expenses: listExpenses({ state: url.searchParams.get('state') || null }) })],
  ['POST', /^\/api\/core2\/expenses$/, (_p, body, _u, user) => submitExpense({
    employeeId: need(body, 'employeeId'), kind: body.kind || 'expense', category: body.category || 'other',
    amount: need(body, 'amount'), costCenterId: body.costCenterId || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/expenses\/(\d+)\/decide$/, ([id], body, _u, user) => decideExpense(Number(id), {
    approve: Boolean(body.approve), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/expenses\/(\d+)\/pay$/, ([id], _b, _u, user) => payExpense(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/costcenter$/, (_p, body, _u, user) => createCostCenter({
    name: need(body, 'name'), code: need(body, 'code'), budgetUsd: body.budgetUsd || 0, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/loans$/, (_p, body, _u, user) => createLoan({
    employeeId: need(body, 'employeeId'), principal: need(body, 'principal'), monthly: need(body, 'monthly'),
    actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/payroll\/(\d+)$/, ([id]) => getRun(Number(id))
    || (() => { throw new HttpError(404, 'no such run'); })()],
  ['POST', /^\/api\/core2\/payroll\/draft$/, (_p, body, _u, user) => draftPayroll({
    period: need(body, 'period'), actor: `human:${user.username}`,
  })],
  // Approving and closing payroll are human acts: the actor is the signed-in
  // person, and the gateway's categorical list means no agent path exists.
  ['POST', /^\/api\/core2\/payroll\/(\d+)\/approve$/, ([id], _b, _u, user) => approvePayrollRun(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/payroll\/(\d+)\/close$/, ([id], _b, _u, user) => closePayrollRun(Number(id), { actor: `human:${user.username}` })],

  // --- procurement & the contract watch ---
  ['GET', /^\/api\/core2\/procurement$/, () => ({ requests: listProcurement({}), overview: procureOverview() })],
  ['POST', /^\/api\/core2\/procurement$/, (_p, body, _u, user) => createProcurement({
    title: need(body, 'title'), amount: body.amount || 0, vendorId: body.vendorId || null,
    costCenterId: body.costCenterId || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/procurement\/(\d+)\/advance$/, ([id], body, _u, user) => advanceProcurement(Number(id), {
    to: need(body, 'to'), actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/contracts\/expiring$/, (_p, _b, url) => ({
    contracts: listExpiring({ horizonDays: Number(url.searchParams.get('horizonDays')) || 90 }),
  })],

  // --- people lifecycle: recruitment, performance, training, the way out ---
  ['GET', /^\/api\/core2\/talent$/, () => ({
    overview: talentOverview(), vacancies: listVacancies(), applications: listApplications({}),
    matrix: competencyMatrix(),
  })],
  ['POST', /^\/api\/core2\/vacancies$/, (_p, body, _u, user) => openVacancy({
    title: need(body, 'title'), positionId: body.positionId || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/applications$/, (_p, body, _u, user) => apply({
    vacancyId: need(body, 'vacancyId'), personId: need(body, 'personId'), docId: body.docId || null,
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/applications\/(\d+)\/advance$/, ([id], body, _u, user) => advanceApplication(Number(id), {
    to: need(body, 'to'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/applications\/(\d+)\/hire$/, ([id], body, _u, user) => hire(Number(id), {
    employeeNo: body.employeeNo || null, orgUnitId: body.orgUnitId || null,
    positionId: body.positionId || null, baseSalary: body.baseSalary ?? null,
    actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/employees\/(\d+)\/tasks$/, ([id], _b, url) => ({
    tasks: tasksFor(Number(id), url.searchParams.get('kind') || null),
  })],
  ['POST', /^\/api\/core2\/tasks\/(\d+)\/done$/, ([id], _b, _u, user) => completeTask(Number(id), { actor: `human:${user.username}` })],
  ['POST', /^\/api\/core2\/objectives$/, (_p, body, _u, user) => setObjective({
    employeeId: need(body, 'employeeId'), title: need(body, 'title'), due: body.due || null,
    actor: `human:${user.username}`,
  })],
  ['GET', /^\/api\/core2\/reviews\/(\d+)\/([\w-]+)$/, ([id, period]) => getReview(Number(id), period)
    || (() => { throw new HttpError(404, 'no such review'); })()],
  ['POST', /^\/api\/core2\/reviews\/evidence$/, (_p, body, _u, user) => writeReviewEvidence({
    employeeId: need(body, 'employeeId'), period: need(body, 'period'), evidence: need(body, 'evidence'),
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/reviews\/rate$/, (_p, body, _u, user) => setRating({
    employeeId: need(body, 'employeeId'), period: need(body, 'period'), rating: need(body, 'rating'),
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/courses$/, (_p, body, _u, user) => createCourse({
    name: need(body, 'name'), expiresMonths: body.expiresMonths || 0, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/certificates$/, (_p, body, _u, user) => grantCertificate({
    employeeId: need(body, 'employeeId'), courseId: need(body, 'courseId'), earnedAt: body.earnedAt || null,
    actor: `human:${user.username}`,
  })],
  // The way out and the record nobody wants: both human acts, both chained.
  ['POST', /^\/api\/core2\/employees\/(\d+)\/terminate$/, ([id], _b, _u, user) => terminateEmployee({
    employeeId: Number(id), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/disciplinary$/, (_p, body, _u, user) => recordDisciplinary({
    personId: need(body, 'personId'), title: body.title || null, body: need(body, 'body'),
    actor: `human:${user.username}`,
  })],

  // --- meetings ---
  ['GET', /^\/api\/core2\/meetings$/, (_p, _b, url) => ({
    meetings: listMeetings({ state: url.searchParams.get('state') || null }),
    overview: meetingsOverview(),
  })],
  ['GET', /^\/api\/core2\/meetings\/(\d+)$/, ([id]) => getMeeting(Number(id))
    || (() => { throw new HttpError(404, 'no such meeting'); })()],
  ['POST', /^\/api\/core2\/meetings$/, (_p, body, _u, user) => createMeeting({
    title: need(body, 'title'), agenda: body.agenda || null, scheduledAt: need(body, 'scheduledAt'),
    organizerEmployeeId: need(body, 'organizerEmployeeId'), participantIds: body.participantIds || [],
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/meetings\/(\d+)\/state$/, ([id], body, _u, user) => setMeetingState(Number(id), {
    state: need(body, 'state'), transcript: body.transcript || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/meetings\/(\d+)\/action$/, ([id], body, _u, user) => addAction(Number(id), {
    kind: body.kind || 'action', what: need(body, 'what'),
    ownerEmployeeId: body.ownerEmployeeId || null, due: body.due || null,
    actor: `human:${user.username}`,
  })],

  // --- documents & knowledge base ---
  //
  // The path permission gets everybody with docs.view through the door; the
  // classification check happens per-document in the handler, because a route
  // pattern cannot know whether /docs/7 is an internal runbook or a
  // disciplinary note. Reading a guarded one without docs.confidential is a
  // 403 with the reason named, not a silent empty page.
  ['GET', /^\/api\/core2\/docs$/, (_p, _b, url) => ({
    documents: listDocuments({ classification: url.searchParams.get('classification') || null }),
    overview: documentsOverview(),
  })],
  ['GET', /^\/api\/core2\/docs\/search$/, (_p, _b, url) => ({ hits: searchDocuments(url.searchParams.get('q') || '') })],
  ['GET', /^\/api\/core2\/docs\/(\d+)$/, ([id], _b, _u, user) => {
    const doc = getDocument(Number(id));
    if (!doc) throw new HttpError(404, 'no such document');
    const needs = READ_PERMISSION[doc.classification];
    if (needs && !(user.role === 'superadmin' || user.perms.includes('*') || user.perms.includes(needs))) {
      throw new HttpError(403, `a ${doc.classification} document needs the ${needs} permission`);
    }
    return doc;
  }],
  ['POST', /^\/api\/core2\/docs$/, (_p, body, _u, user) => createDocument({
    title: need(body, 'title'), classification: body.classification || 'internal',
    subjectPersonId: body.subjectPersonId || null, body: body.body ?? null, note: body.note || null,
    actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/docs\/(\d+)\/version$/, ([id], body, _u, user) => addVersion(Number(id), {
    body: need(body, 'body'), note: body.note || null, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/core2\/docs\/(\d+)\/archive$/, ([id], _b, _u, user) => archiveDocument(Number(id), {
    actor: `human:${user.username}`,
  })],

  // --- Erasure: the right to be forgotten, against a record that cannot forget ---
  ['GET', /^\/api\/erasure$/, () => erasureOverview()],
  // A lookup is itself a use of the identifier, so it is a POST and it is
  // audited by the permission layer like anything else — not a GET whose
  // subject sits in a URL, a log line and a browser history.
  ['POST', /^\/api\/erasure\/find$/, (_p, body) => findSubject({ kind: body.kind || 'contact', identifier: need(body, 'identifier') })],
  ['POST', /^\/api\/erasure\/erase$/, (_p, body) => eraseSubject({
    kind: body.kind || 'contact', identifier: need(body, 'identifier'),
    reason: body.reason || null, actor: need(body, 'actor'),
  })],
  ['POST', /^\/api\/erasure\/verify$/, (_p, body) => verifyErasure({
    kind: body.kind || 'contact', identifier: body.identifier || null, ref: body.ref || null,
  })],
  // Sealing what was written before there was sealing. A queue job rather than
  // a script, so it resumes where it stopped and says so on the chain.
  ['GET', /^\/api\/erasure\/backfill$/, () => backfillOverview()],
  ['POST', /^\/api\/erasure\/backfill$/, (_p, _b, user) => startBackfill({ actor: `human:${user.username}` })],

  // --- Anchoring: the record answering to something other than itself ---
  ['GET', /^\/api\/anchors$/, () => anchorsOverview()],
  ['GET', /^\/api\/anchors\/verify$/, () => verifyAnchors()],
  ['GET', /^\/api\/anchors\/(\d+)\/evidence$/, ([id]) => anchorEvidence(Number(id))],
  ['POST', /^\/api\/anchors$/, (_p, body) => anchorNow({ kind: body.witness || null, actor: need(body, 'actor') })],
  ['POST', /^\/api\/push\/subscribe$/, (_p, body, _u, user) =>
    pushSubscribe({ userId: user.id, subscription: need(body, 'subscription'), agent: body.userAgent })],
  ['POST', /^\/api\/push\/unsubscribe$/, (_p, body, _u, user) =>
    pushUnsubscribe({ userId: user.id, endpoint: need(body, 'endpoint') })],
  ['POST', /^\/api\/push\/resubscribe$/, (_p, body, _u, user) => {
    // The browser rotated the subscription on its own; drop the old row first
    // so a dead endpoint is not retried forever.
    if (body.old) pushUnsubscribe({ userId: user.id, endpoint: body.old });
    return pushSubscribe({ userId: user.id, subscription: need(body, 'subscription'), agent: body.userAgent });
  }],
  // Sending one to yourself is the only honest way to find out whether the
  // whole path works: permission, browser, push service, lock screen.
  ['POST', /^\/api\/push\/test$/, async (_p, _b, _u, user) => {
    const subs = q('SELECT * FROM push_subscriptions WHERE user_id = ? AND retired_at IS NULL', user.id);
    if (!subs.length) throw new HttpError(400, 'this account has no subscribed browser');
    const results = await Promise.all(subs.map((sub) => pushDeliver(sub, {
      title: 'AlphaCore', body: 'This is what an approval will look like.', route: '#/gate',
    })));
    return { tried: results.length, delivered: results.filter((r) => r.ok).length, results };
  }],

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
  // What the map should be lit up about right now, rather than what exists.
  ['GET', /^\/api\/map\/state$/, () => mapState()],
  ['GET', /^\/api\/atomicity$/, () => atomicity()],
  ['GET', /^\/api\/map$/, () => ({
    divisions: DIVISIONS,
    // The enterprise core's own districts, and the tunnels across the seam.
    // Sent with the same payload so the map is one drawing of one catalogue:
    // two endpoints would eventually disagree, and a map that disagrees with
    // itself is worse than no map.
    core2Divisions: CORE2_DIVISIONS,
    core2: core2Map(),
    sections: sectionCatalog(),
    // The eight doors, and which departments sit behind each. The console's
    // navigation is drawn from this rather than from a list in the markup, so
    // a department that nobody filed cannot quietly become unreachable.
    surfaces: surfaceCatalog(),
    surfaceAudit: surfaceAudit(),
    edges: relationshipMatrix(),
    audit: connectivityAudit(),
    flow: flowStats(),
    harmony: harmonyScore(),
  })],
  ['GET', /^\/api\/surfaces$/, () => ({ surfaces: surfaceCatalog(), audit: surfaceAudit(), declared: SURFACES.length })],

  // --- Ask AlphaCore: one input in front of a hundred and forty departments ---
  ['GET', /^\/api\/ask$/, () => askRules()],
  ['POST', /^\/api\/ask$/, (_p, body, _url, user) => ask(need(body, 'q'), { actor: `human:${user.username}` })],

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
  // Above the :id route deliberately — "certification" is a legal connector id
  // as far as that pattern is concerned, and first match wins.
  ['GET', /^\/api\/connectors\/certification$/, () => certificationOverview()],
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
  ['GET', /^\/api\/mcp\/tools$/, () => ({ tools: allTools(), exposed: ALPHACORE_TOOLS })],

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
      filename: `alphacore-export-${new Date().toISOString().slice(0, 10)}.json`,
      body: JSON.stringify(exportAll(), null, 1),
    },
  })],

  // ---- Tax --------------------------------------------------------------
  ['GET', /^\/api\/tax$/, () => taxOverview()],
  ['POST', /^\/api\/tax\/jurisdiction$/, (_p, body, user) => addJurisdiction({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/tax\/classify$/, (_p, body) => taxClassify({
    jurisdiction: need(body, 'jurisdiction'), basis: Number(body.basis) || 0, kind: body.kind || 'invoice',
  })],
  ['POST', /^\/api\/tax\/line$/, (_p, body, user) => recordTaxLine({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/tax\/sweep$/, (_p, _b, user) => taxSweep({ actor: `human:${user.username}` })],
  ['POST', /^\/api\/tax\/return$/, (_p, body, user) => buildReturn({
    jurisdiction: need(body, 'jurisdiction'), periodStart: need(body, 'periodStart'),
    periodEnd: need(body, 'periodEnd'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/tax\/return\/(\d+)\/file$/, (p, _b, user) => fileReturn({ id: Number(p[0]), actor: `human:${user.username}` })],
  ['POST', /^\/api\/tax\/line\/(\d+)\/post$/, (p, _b, user) => postTaxDraft({ id: Number(p[0]), actor: `human:${user.username}` })],

  // ---- Privacy ----------------------------------------------------------
  ['GET', /^\/api\/privacy$/, () => privacyOverview()],
  ['POST', /^\/api\/privacy\/flow$/, (_p, body, user) => proposeFlow({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/privacy\/flow\/(\d+)\/decide$/, (p, body, user) => decideFlow({
    id: Number(p[0]), verdict: need(body, 'verdict'), assessment: need(body, 'assessment'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/privacy\/request$/, (_p, body, user) => logRequest({
    kind: need(body, 'kind'), identifier: need(body, 'identifier'),
    channel: body.channel, note: body.note, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/privacy\/request\/(\d+)\/export$/, (p, body, user) => buildExport({
    id: Number(p[0]), identifier: need(body, 'identifier'), format: body.format || 'json', actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/privacy\/request\/(\d+)\/answer$/, (p, body, user) => answerRequest({
    id: Number(p[0]), identifier: body.identifier || null, outcome: need(body, 'outcome'), actor: `human:${user.username}`,
  })],

  // ---- Intellectual property --------------------------------------------
  ['GET', /^\/api\/ip$/, () => ipOverview()],
  ['POST', /^\/api\/ip$/, (_p, body, user) => registerIp({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/ip\/(\d+)\/advance$/, (p, body, user) => advanceIp({
    id: Number(p[0]), state: need(body, 'state'), reference: body.reference,
    renewalAt: body.renewalAt, note: body.note, actor: `human:${user.username}`,
  })],

  // ---- Help centre ------------------------------------------------------
  ['GET', /^\/api\/help$/, () => helpOverview()],
  ['POST', /^\/api\/help\/sweep$/, () => sweepTickets()],
  ['POST', /^\/api\/help\/gap\/(\d+)\/draft$/, (p, _b, user) => draftForGap({ id: Number(p[0]), actor: `human:${user.username}` })],
  ['POST', /^\/api\/help\/article$/, (_p, body, user) => writeArticle({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/help\/article\/(\d+)\/publish$/, (p, _b, user) => publishArticle({ id: Number(p[0]), actor: `human:${user.username}` })],

  // ---- Data governance --------------------------------------------------
  ['GET', /^\/api\/datagov$/, () => datagovOverview()],
  ['POST', /^\/api\/datagov\/rebuild$/, (_p, _b, user) => rebuildInventory({ actor: `human:${user.username}` })],
  // Which columns are sealed at write, and the signature under that decision.
  ['GET', /^\/api\/datagov\/tiering$/, () => tiering()],
  ['POST', /^\/api\/datagov\/tiering$/, (_p, body, user) => recordTiering({ actor: `human:${user.username}`, basis: body.basis })],
  ['POST', /^\/api\/datagov\/class$/, (_p, body, user) => defineClass({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/datagov\/classify$/, (_p, body, user) => classifyColumn({
    table: need(body, 'table'), column: need(body, 'column'), className: body.className,
    personal: body.personal, note: body.note, actor: `human:${user.username}`,
  })],

  // ---- Trust centre -----------------------------------------------------
  ['GET', /^\/api\/trust$/, () => trustOverview()],
  ['POST', /^\/api\/trust\/document$/, (_p, body, user) => publishTrustDocument({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/trust\/document\/(\d+)\/retire$/, (p, _b, user) => retireTrustDocument({ id: Number(p[0]), actor: `human:${user.username}` })],
  ['POST', /^\/api\/trust\/subprocessor$/, (_p, body, user) => addSubprocessor({ ...body, actor: `human:${user.username}` })],

  // ---- Status and SLA ---------------------------------------------------
  ['GET', /^\/api\/status$/, () => statusOverview()],
  ['POST', /^\/api\/status\/seed$/, (_p, _b, user) => seedComponents({ actor: `human:${user.username}` })],
  ['POST', /^\/api\/status\/component$/, (_p, body, user) => setComponent({
    name: need(body, 'name'), state: need(body, 'state'), objective: body.objective, actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/status\/notice$/, (_p, body, user) => postNotice({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/status\/notice\/(\d+)$/, (p, body, user) => updateNotice({
    id: Number(p[0]), state: need(body, 'state'), body: need(body, 'body'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/status\/sla$/, (_p, body, user) => addSlaTerm({ ...body, actor: `human:${user.username}` })],

  // ---- Partnerships -----------------------------------------------------
  ['GET', /^\/api\/partnerships$/, () => partnershipsOverview()],
  ['POST', /^\/api\/partnerships\/(\d+)\/integration$/, (p, body, user) => setIntegration({
    id: Number(p[0]), integration: need(body, 'integration'), agreementRef: body.agreementRef, actor: `human:${user.username}`,
  })],

  // ---- The simulation: the workforce in a building ------------------------
  ['GET', /^\/api\/sim$/, () => officesOverview()],
  ['POST', /^\/api\/sim\/start$/, (_p, _b, user) => setOfficesOn(true, `human:${user.username}`)],
  ['POST', /^\/api\/sim\/stop$/, (_p, _b, user) => setOfficesOn(false, `human:${user.username}`)],
  ['POST', /^\/api\/sim\/seed$/, (_p, _b, user) => officesSeed({ actor: `human:${user.username}` })],
  ['POST', /^\/api\/sim\/play$/, (_p, body, user) => officesPlay({ roomId: body?.roomId || null, actor: `human:${user.username}` })],
  ['GET', /^\/api\/sim\/room\/([a-z0-9-]+)$/, (p) => ({ room: p[0], feed: officesRoomFeed(p[0]) })],
  ['GET', /^\/api\/sim\/encounter\/(\d+)$/, (p) => officesLines(Number(p[0]))],

  // ---- Growth -----------------------------------------------------------
  ['GET', /^\/api\/growth$/, () => growthOverview()],
  ['POST', /^\/api\/growth$/, (_p, body, user) => startExperiment({ ...body, actor: `human:${user.username}` })],
  ['POST', /^\/api\/growth\/(\d+)\/result$/, (p, body, user) => recordResult({
    id: Number(p[0]), resultA: need(body, 'resultA'), resultB: need(body, 'resultB'), actor: `human:${user.username}`,
  })],
  ['POST', /^\/api\/growth\/(\d+)\/conclude$/, (p, body, user) => concludeExperiment2({
    id: Number(p[0]), winner: need(body, 'winner'), decision: need(body, 'decision'), actor: `human:${user.username}`,
  })],
];

/** Path → permission key. One permission per capability; superadmin holds "*". */
function permFor(m, path) {
  const is = (re) => re.test(path);
  if (['/api/health', '/api/stats', '/api/audit/verify', '/api/notifications', '/api/inbox'].includes(path)) return 'dashboard.view';
  if (path === '/api/notifications/read') return 'notifications.read';
  // Your own browser's subscription is your own business — any signed-in
  // account may manage it. Seeing everybody's is not.
  // Nobody needs a permission to protect their own account, and requiring one
  // would mean the accounts most worth protecting are the last able to. The
  // namespace matters: /api/security is the SOC department, and putting these
  // there unauthenticated its entire prefix.
  if (path.startsWith('/api/account/')) return null;
  // Erasing somebody is irreversible by design, so it sits with the powers
  // that are given on purpose rather than with ordinary record management.
  if (path === '/api/vault/key') return 'vault.manage';
  if (path.startsWith('/api/lifecycle')) return m === 'GET' ? 'observe.view' : 'settings.manage';
  if (path.startsWith('/api/observability')) return m === 'GET' ? 'observe.view' : 'settings.manage';
  // Changing which model serves a tier changes every employee on it at once,
  // so it sits with providers rather than with ordinary settings.
  if (path.startsWith('/api/tiers') || path.startsWith('/api/prompts')) return m === 'GET' ? 'providers.view' : 'providers.test';
  // Reading your own queue needs nothing beyond a session — it only ever shows
  // what you personally could act on. Handing out a role is users.manage.
  if (path.startsWith('/api/embeddings')) return m === 'GET' ? 'graph.view' : 'graph.manage';
  if (path.startsWith('/api/deliverability')) return 'comms.view';
  if (path === '/api/approvals') return null;
  if (path.startsWith('/api/roles')) return m === 'GET' ? 'users.manage' : 'users.manage';
  if (path.startsWith('/api/delegations')) return null;
  if (path === '/api/erasure' || path === '/api/erasure/find' || path === '/api/erasure/verify') return 'compliance.view';
  // Reading how much is left to seal is a view; starting the backfill rewrites
  // every Tier A row in the database, which is not.
  if (path === '/api/erasure/backfill') return m === 'GET' ? 'compliance.view' : 'compliance.manage';
  if (path === '/api/erasure/erase') return 'compliance.manage';

  // The read and the irreversible act are never the same key. Looking at the
  // tax ledger is not filing a return; reading an article is not publishing it.
  if (path === '/api/tax') return 'tax.view';
  if (path === '/api/tax/file' || /^\/api\/tax\/return\/\d+\/file$/.test(path)) return 'tax.file';
  if (path.startsWith('/api/tax')) return 'tax.classify';
  if (path === '/api/privacy') return 'privacy.view';
  if (/^\/api\/privacy\/request\/\d+\/(answer|export)$/.test(path)) return 'privacy.respond';
  if (path.startsWith('/api/privacy')) return 'privacy.assess';
  if (path === '/api/ip' && m === 'GET') return 'ip.view';
  if (path.startsWith('/api/ip')) return 'ip.manage';
  if (path === '/api/help') return 'help.view';
  if (/^\/api\/help\/article\/\d+\/publish$/.test(path)) return 'help.publish';
  if (path.startsWith('/api/help')) return 'help.write';
  if (path === '/api/datagov') return 'datagov.view';
  // Reading the tiering is a view. Signing it is the classification act.
  if (path === '/api/datagov/tiering' && m === 'GET') return 'datagov.view';
  if (path.startsWith('/api/datagov')) return 'datagov.classify';
  if (path === '/api/trust') return 'trust.view';
  if (path.startsWith('/api/trust')) return 'trust.publish';
  if (path === '/api/status') return 'status.view';
  if (path.startsWith('/api/status')) return 'status.post';
  if (path === '/api/partnerships') return 'partners.view';
  if (path.startsWith('/api/partnerships')) return 'partners.manage';
  // `simulation.*` is the shadow company, which forks the database. This is the
  // building the workforce walks around in — a different thing, so a different key.
  // Reading a room or a transcript is not the same power as making people meet.
  if (path === '/api/sim' || path.startsWith('/api/sim/room') || path.startsWith('/api/sim/encounter')) return 'sim.view';
  if (path.startsWith('/api/sim')) return 'sim.run';
  if (path === '/api/growth' && m === 'GET') return 'growth.view';
  if (path.startsWith('/api/growth')) return 'growth.run';
  if (path === '/api/anchors/verify') return 'audit.view';
  if (path.startsWith('/api/anchors')) return m === 'GET' ? 'audit.view' : 'settings.manage';
  if (path === '/api/push') return 'users.manage';
  if (path.startsWith('/api/push/')) return null;
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
  // Reading the books and writing to them are different jobs, and closing a
  // period is a third — the person who can look at a number should not
  // automatically be able to seal the month it came from.
  if (path === '/api/ledger/period/close' || path === '/api/ledger/period/reopen') return 'ledger.close';
  if (path === '/api/bookkeeper/close') return 'ledger.close';
  if (path.startsWith('/api/ledger') || path.startsWith('/api/bookkeeper')) return m === 'GET' ? 'ledger.view' : 'ledger.post';
  // A hunt spends money and reaches outside; reading one that already ran does
  // neither. Different permissions for genuinely different acts.
  if (path.startsWith('/api/hunt')) return m === 'GET' ? 'hunt.view' : 'hunt.run';
  // Watching a browser session, steering one, and signing off the step that
  // leaves the building are three different amounts of authority.
  if (/^\/api\/browser\/\d+\/(approve|refuse)$/.test(path)) return 'browser.approve';
  if (path.startsWith('/api/browser')) return m === 'GET' ? 'browser.view' : 'browser.drive';
  if (path.startsWith('/api/economics')) return 'economics.view';
  if (path.startsWith('/api/standing')) return m === 'GET' ? 'standing.view' : 'standing.manage';
  // Reading what died and putting it back on the queue are different acts: the
  // second spends money again on work that has already failed four times.
  if (/^\/api\/deadletter\/[\w-]+\/revive$/.test(path)) return 'deadletter.revive';
  if (path.startsWith('/api/deadletter')) return 'deadletter.view';
  if (path.startsWith('/api/lifecycle')) return m === 'GET' ? 'lifecycle.view' : 'lifecycle.manage';
  if (path.startsWith('/api/campaigns')) return m === 'GET' ? 'marketing.view' : 'marketing.manage';
  if (path.startsWith('/api/customers')) return m === 'GET' ? 'customers.view' : 'customers.manage';
  if (path.startsWith('/api/contracts')) return m === 'GET' ? 'legal.view' : 'legal.manage';
  if (path.startsWith('/api/vendors')) return m === 'GET' ? 'vendors.view' : 'vendors.manage';
  // Core 2. The org routes need the org permission and the people routes the
  // people one — the same catalogue Core 1 uses, so a screen and a bridge tool
  // cannot end up guarded differently for the same act.
  if (path.startsWith('/api/core2/org')) return m === 'GET' ? 'org.view' : 'org.manage';
  if (path === '/api/core2/map') return 'dashboard.view';
  // The page about you: any signed-in account; the handler shows only what is theirs.
  if (path === '/api/core2/me') return null;
  // Salary changes and end of service are money about one person: finance.export
  // to write, and reading the history needs the same.
  if (/^\/api\/core2\/comp\/(salary|eos|tax)/.test(path)) return 'finance.export';
  if (path.startsWith('/api/core2/comp') || path.startsWith('/api/core2/hrops')) return m === 'GET' ? 'people.view' : 'people.manage';
  if (path.startsWith('/api/core2/bank')) return m === 'GET' ? 'bank.view' : 'bank.manage';
  if (/^\/api\/core2\/(finance|budgets|bills|ar|fixed-assets|depreciation|fx)/.test(path)) return m === 'GET' ? 'finance.view' : 'finance.export';
  if (path.startsWith('/api/core2/helpdesk') && m === 'POST' && /^\/api\/core2\/helpdesk$/.test(path)) return 'ops.view';   // anybody may raise a ticket
  if (path.startsWith('/api/core2/ops') || path.startsWith('/api/core2/helpdesk')) return m === 'GET' ? 'ops.view' : 'ops.manage';
  if (path.startsWith('/api/core2/legalcases')) return m === 'GET' ? 'legal.view' : 'legal.manage';
  if (path === '/api/core2/admin/policy-ack' && m === 'POST') return null;   // your own acknowledgement; scoped in the handler
  if (path.startsWith('/api/core2/admin')) return m === 'GET' ? 'admin.view' : 'admin.manage';
  if (path.startsWith('/api/core2/docs')) return m === 'GET' ? 'docs.view' : 'docs.manage';
  // Reading a file, putting one there, and destroying one are three different
  // amounts of authority over somebody else's data.
  if (/^\/api\/core2\/files\/\d+\/delete$/.test(path)) return 'files.delete';
  if (path.startsWith('/api/core2/files')) return m === 'GET' ? 'files.view' : 'files.upload';
  // A legal hold is the one act here that overrides a person's right to
  // erasure, so it is not the same permission as editing the schedule.
  // Approving overtime is money, so it is not the same permission as editing a
  // roster. Same reasoning as the legal hold sitting apart from the schedule.
  if (/^\/api\/core2\/overtime\/\d+\/decide$/.test(path)) return 'overtime.approve';
  if (path.startsWith('/api/core2/shifts') || path.startsWith('/api/core2/overtime')) return m === 'GET' ? 'shifts.view' : 'shifts.manage';
  if (path.startsWith('/api/core2/payrules') || path.startsWith('/api/core2/endofservice')) return m === 'GET' ? 'payrules.view' : 'payrules.manage';
  if (path.startsWith('/api/core2/custody')) return m === 'GET' ? 'custody.view' : 'custody.manage';
  if (path.startsWith('/api/core2/joining')) return m === 'GET' ? 'joining.view' : 'joining.manage';
  if (/^\/api\/core2\/records\/hold/.test(path)) return 'records.hold';
  if (path.startsWith('/api/core2/records')) return m === 'GET' ? 'records.view' : 'records.manage';
  if (/^\/api\/core2\/(finops|expenses|costcenter|loans|payroll|procurement)/.test(path)) return m === 'GET' ? 'finance.view' : 'finance.export';
  if (path.startsWith('/api/core2/contracts')) return 'legal.view';
  if (path.startsWith('/api/core2')) return m === 'GET' ? 'people.view' : 'people.manage';
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
  // The eight doors are the navigation itself: anybody who may see a dashboard
  // may see which departments exist and which surface they sit behind.
  if (path === '/api/surfaces') return 'dashboard.view';
  // Ask reads across every table in one pass, so it is guarded by the same
  // permission as the deep search it delegates to — not by a weaker one just
  // because the box it sits in is friendlier.
  if (path === '/api/ask') return 'hunt.view';
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

/**
 * Handlers that cannot be held inside a transaction.
 *
 * Decided from the function itself rather than from a list somebody maintains:
 * an async handler awaits something — a model, a network call — and a
 * transaction spanning that await would let another request interleave between
 * the mutation and the commit. Calling that a transaction would be a comment.
 *
 * Computed once at load, because doing it per request would be a constructor
 * lookup on every call for an answer that cannot change.
 */
const ASYNC_HANDLERS = new Set(
  routes.filter(([, , h]) => h?.constructor?.name === 'AsyncFunction').map(([, , h]) => h),
);

/** How much of the write surface is atomic — a number rather than a claim. */
export function atomicity() {
  const writes = routes.filter(([m]) => m !== 'GET');
  const notAtomic = writes.filter(([, , h]) => ASYNC_HANDLERS.has(h));
  return {
    writeRoutes: writes.length,
    atomic: writes.length - notAtomic.length,
    notAtomic: notAtomic.length,
    // Named, so "most of it is atomic" is checkable rather than reassuring.
    reaching: notAtomic.map(([, p]) => String(p).slice(0, 70)).sort(),
    says: 'A write and its chain entry are one act where the handler is synchronous. Where it awaits a model or '
      + 'a network call, a transaction cannot span the await without letting another request interleave — those '
      + 'are counted here rather than treated as if they were atomic.',
  };
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
      // A write and its chain entry have to be one act or the other.
      //
      // The constitution says every consequential act is written to the chain
      // *before it happens*. That was not quite true: a handler mutated a table
      // and then wrote the record, so a failed chain write left the act done and
      // unrecorded — the exact outcome the design exists to prevent. Nothing was
      // swallowing the error; there was simply nothing holding the two together.
      //
      // A transaction cannot be held across an `await` — another request would
      // interleave between the mutation and the commit, and calling that a
      // transaction would be a comment rather than a guarantee. So the ones that
      // can be atomic are, and the ones that cannot are counted rather than
      // quietly treated as if they were. `GET /api/atomicity` reports both.
      const atomic = req.method !== 'GET' && !ASYNC_HANDLERS.has(handler);
      const result = atomic
        ? atomically(() => handler(m.slice(1), body, url, user))
        : await handler(m.slice(1), body, url, user);
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
      // A constraint the caller tripped is the caller's error, not a fault in
      // the server. Left as a 500 it pages somebody at three in the morning
      // because two cost centres were given the same code — and it buries the
      // real 500s in noise. SQLite reports these with a distinguishable code,
      // so they are translated once here rather than guarded at every route.
      const constraint = err.code === 'ERR_SQLITE_ERROR' && /constraint failed/i.test(err.message || '');
      const status = err.status
        || (err.name === 'BudgetExceeded' ? 402 : (constraint ? 400 : 500));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
  return false;
}
