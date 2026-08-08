// The expansion wave — sixteen departments across four new divisions:
// TRUST   security, compliance, sustainability
// CAPITAL finops (finance/finreports live in capital too)
// TALENT  recruiting, academy (people/org/society/disputes/enablement join them)
// EXEC    board room, investor relations, internal comms
// plus capacity (engine), lab + releases (build), pmo (decide), insights (data),
// brand (create), procurement (commerce).
//
// Everything here follows the house rules: agents draft, humans publish;
// every state change is audited; counts on the map are real queries.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { providersConfig } from './env.js';

const writerAgent = () =>
  one("SELECT id FROM agents WHERE status = 'active' AND (id LIKE 'AGT-DOC%' OR role_group = 'docs') LIMIT 1")?.id
  || one("SELECT id FROM agents WHERE status = 'active' LIMIT 1")?.id;
const assureAgent = () =>
  one("SELECT id FROM agents WHERE status = 'active' AND role_group = 'assure' LIMIT 1")?.id || writerAgent();

/** Pull readable text out of a finished run's JSON output. */
const runText = (runId) => {
  const r = one('SELECT state, output FROM runs WHERE id = ?', runId);
  if (r?.state !== 'done' || !r.output) return null;
  try {
    let o = JSON.parse(r.output);
    // Some agents return { raw: "<json-string>" } — unwrap before extracting.
    if (o && typeof o.raw === 'string') {
      try { o = JSON.parse(o.raw); } catch { return o.raw; }
    }
    return o.text || o.draft || o.body || o.summary || o.content || o.notes || JSON.stringify(o, null, 2);
  } catch { return String(r.output); }
};
const lastId = () => one('SELECT last_insert_rowid() AS id').id;

/**
 * A run returns an envelope — {raw, parsed, provider, model} — and the role
 * specification is inside it. Storing the envelope made every automatic hire
 * fail silently, because the id it needs was one level down.
 */
function extractSpec(runId) {
  const r = one('SELECT state, output FROM runs WHERE id = ?', runId);
  if (r?.state !== 'done' || !r.output) return null;
  let o;
  try { o = JSON.parse(r.output); } catch { return null; }
  let spec = o?.parsed ?? o;
  if (spec && typeof spec.raw === 'string') {
    try { spec = JSON.parse(spec.raw); } catch { /* fall through to the check below */ }
  }
  return spec && typeof spec === 'object' && spec.id ? spec : null;
}

// ---------- TRUST · Security (SOC) ----------
export function securityOverview() {
  return {
    stats: {
      open: one("SELECT COUNT(*) AS n FROM security_events WHERE state = 'open'").n,
      high: one("SELECT COUNT(*) AS n FROM security_events WHERE severity = 'high' AND state != 'closed'").n,
      total: one('SELECT COUNT(*) AS n FROM security_events').n,
    },
    events: q('SELECT * FROM security_events ORDER BY id DESC LIMIT 60'),
  };
}

/** A real sweep over real data — no theatre. */
export function securityScan({ actor }) {
  const found = [];
  const add = (kind, severity, summary, st = null, sid = null) => {
    if (one('SELECT id FROM security_events WHERE kind = ? AND summary = ?', kind, summary)) return;
    exec('INSERT INTO security_events (kind, severity, summary, subject_type, subject_id) VALUES (?,?,?,?,?)',
      kind, severity, summary, st, sid);
    found.push(summary);
  };
  // 1. Prompt-injection phrases inside run inputs.
  for (const r of q(`SELECT id FROM runs WHERE lower(input) LIKE '%ignore previous instructions%'
                     OR lower(input) LIKE '%disregard your rules%' OR lower(input) LIKE '%reveal your system prompt%' LIMIT 20`)) {
    add('injection', 'high', `Injection phrasing found in run ${r.id} input`, 'run', r.id);
  }
  // 2. Secret-looking material inside run outputs.
  for (const r of q(`SELECT id FROM runs WHERE output LIKE '%sk-ant-%' OR output LIKE '%-----BEGIN%'
                     OR output LIKE '%AKIA%' LIMIT 20`)) {
    add('secret-leak', 'high', `Secret-shaped string in run ${r.id} output`, 'run', r.id);
  }
  // 3. Providers configured without a DPA.
  for (const [name, p] of Object.entries(providersConfig.providers || {})) {
    if (p.dpa === false) add('vendor-dpa', 'medium', `Provider ${name} has no DPA — keep customer data away from it`);
  }
  // 4. Users carrying broad grants who are not the superadmin.
  for (const u of q("SELECT username, perms FROM users WHERE role != 'superadmin'")) {
    try { if (JSON.parse(u.perms).includes('*')) add('anomaly', 'high', `Non-superadmin '${u.username}' holds the * grant`); } catch { /* unreadable perms JSON is its own finding below */ }
  }
  audit({ actorType: 'human', actorId: actor, action: 'security.scanned', subjectType: 'security', subjectId: 'sweep', payload: { newFindings: found.length } });
  if (found.length) notify({ level: 'warn', source: 'security', message: `Security sweep: ${found.length} new finding(s).`, subjectType: 'security', subjectId: 'sweep' });
  return { newFindings: found.length, findings: found };
}

export function setSecurityState(id, { state, actor }) {
  if (!one('SELECT id FROM security_events WHERE id = ?', id)) throw new Error('event not found');
  exec('UPDATE security_events SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `security.${state}`, subjectType: 'security', subjectId: id });
}

// ---------- TRUST · Compliance ----------
export function complianceOverview() {
  const providers = Object.entries(providersConfig.providers || {})
    .filter(([n]) => n !== 'mock')
    .map(([name, p]) => ({ name, dpa: p.dpa !== false, noTraining: p.noTraining !== false }));
  return {
    providers,
    contracts: q('SELECT state, COUNT(*) AS n FROM contracts GROUP BY state'),
    dataRegister: [
      { store: 'SQLite (data/crucible.db)', contains: 'company records, customer names, intel records', basis: 'contract' },
      { store: 'workspace/ files', contains: 'agent-produced documents and exports', basis: 'legitimate interest' },
      { store: 'provider APIs', contains: 'prompts routed by sensitivity ceiling', basis: 'DPA-gated' },
    ],
    checks: q('SELECT * FROM compliance_checks ORDER BY id DESC LIMIT 40'),
  };
}

export function addComplianceCheck({ area, status, note = null, actor }) {
  if (!area?.trim() || !['ok', 'gap', 'na'].includes(status)) throw new Error('area and status (ok|gap|na) required');
  exec('INSERT INTO compliance_checks (area, status, note, checked_by) VALUES (?,?,?,?)', area.trim(), status, note, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'compliance.checked', subjectType: 'compliance', subjectId: id, payload: { area, status } });
  return id;
}

// ---------- TRUST · Sustainability ----------
const WH_PER_1K_TOKENS = { anthropic: 0.30, 'claude-subscription': 0.30, openai: 0.30, deepseek: 0.25, google: 0.28, mock: 0 };
export function sustainabilityOverview() {
  const rows = q('SELECT provider, SUM(tokens_in + tokens_out) AS tok, SUM(cost_usd) AS cost FROM model_calls GROUP BY provider');
  const byProvider = rows.map((r) => {
    const kwh = (r.tok / 1000) * (WH_PER_1K_TOKENS[r.provider] ?? 0.3) / 1000;
    return { provider: r.provider, tokens: r.tok, kwh: Number(kwh.toFixed(4)), gco2: Number((kwh * 400).toFixed(1)), cost: r.cost };
  });
  const totalKwh = byProvider.reduce((a, b) => a + b.kwh, 0);
  return {
    byProvider,
    totalKwh: Number(totalKwh.toFixed(4)),
    totalGco2: Number((totalKwh * 400).toFixed(1)),
    note: 'Estimates: ~0.3 Wh per 1k tokens, 400 gCO2/kWh grid average.',
    tips: [
      'Subscription-first tier chains already make marginal calls near-free — keep them first.',
      'Batch small tasks into one run instead of many short calls.',
      'Golden-set evals catch quality early — cheaper than re-running failed work.',
    ],
  };
}

// ---------- ENGINE · Capacity planning ----------
export function capacityOverview() {
  const today = new Date().toISOString().slice(0, 10);
  return q("SELECT id, name, role_group FROM agents WHERE status = 'active' ORDER BY id").map((a) => {
    const active = one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state IN ('queued','leased','running')", a.id).n;
    const waiting = one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state = 'awaiting_human'", a.id).n;
    const done7 = one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state = 'done' AND created_at >= datetime('now','-7 days')", a.id).n;
    const b = one("SELECT spent_usd, cap_usd FROM budgets WHERE scope = 'agent-daily' AND scope_id = ? AND period_key = ?", a.id, today);
    const budgetPct = b ? Math.round((b.spent_usd / b.cap_usd) * 100) : 0;
    return { ...a, active, waiting, done7, budgetPct, saturated: active > 3 || budgetPct > 80 };
  });
}

// ---------- BUILD · The Lab (A/B experiments) ----------
export function listExperiments() { return q('SELECT * FROM experiments ORDER BY id DESC LIMIT 50'); }

export function createExperiment({ name, hypothesis = null, variantA, variantB, actor }) {
  if (!name?.trim() || !variantA?.trim() || !variantB?.trim()) throw new Error('name, variantA, variantB required');
  const agentId = writerAgent();
  if (!agentId) throw new Error('no active agent to run the experiment');
  const runA = enqueueRun({ agentId, taskType: 'lab:variant-a', input: { prompt: variantA }, actor });
  const runB = enqueueRun({ agentId, taskType: 'lab:variant-b', input: { prompt: variantB }, actor });
  exec('INSERT INTO experiments (name, hypothesis, variant_a, variant_b, agent_id, run_a, run_b, created_by) VALUES (?,?,?,?,?,?,?,?)',
    name.trim(), hypothesis, variantA, variantB, agentId, runA, runB, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'lab.experiment_started', subjectType: 'experiment', subjectId: id, payload: { name, agentId } });
  return id;
}

export function concludeExperiment(id, { winner, actor }) {
  if (!['a', 'b', 'inconclusive'].includes(winner)) throw new Error('winner: a|b|inconclusive');
  if (!one('SELECT id FROM experiments WHERE id = ?', id)) throw new Error('experiment not found');
  exec("UPDATE experiments SET winner = ?, state = 'concluded' WHERE id = ?", winner, id);
  audit({ actorType: 'human', actorId: actor, action: 'lab.concluded', subjectType: 'experiment', subjectId: id, payload: { winner } });
}

// ---------- BUILD · Releases / changelog ----------
export function listReleases() { return q('SELECT * FROM releases ORDER BY id DESC LIMIT 50'); }

export function draftRelease({ version, productId = null, actor }) {
  if (!version?.trim()) throw new Error('version required');
  const doneTasks = q("SELECT title FROM tasks WHERE state = 'done' ORDER BY id DESC LIMIT 12").map((t) => t.title);
  const donePipes = q("SELECT name FROM pipelines WHERE state = 'done' ORDER BY id DESC LIMIT 6").map((p) => p.name);
  const agentId = writerAgent();
  const runId = agentId ? enqueueRun({
    agentId, taskType: `release:${version}`,
    input: { prompt: `Write concise release notes for version ${version}.\nCompleted tasks:\n${doneTasks.join('\n') || '(none)'}\nCompleted pipelines:\n${donePipes.join('\n') || '(none)'}\nGroup into Added/Fixed/Changed. Reply as JSON {"text": "..."}.` },
    actor,
  }) : null;
  exec('INSERT INTO releases (version, product_id, run_id, created_by) VALUES (?,?,?,?)', version.trim(), productId, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'release.drafted', subjectType: 'release', subjectId: id, payload: { version } });
  return id;
}

export function publishRelease(id, { actor }) {
  const r = one('SELECT * FROM releases WHERE id = ?', id);
  if (!r) throw new Error('release not found');
  if (!r.notes) throw new Error('notes still drafting — wait for the agent, then publish');
  exec("UPDATE releases SET state = 'published' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'release.published', subjectType: 'release', subjectId: id, payload: { version: r.version } });
}

// ---------- DECIDE · PMO (stage gates) ----------
export function pmoOverview() {
  return {
    stats: {
      pending: one("SELECT COUNT(*) AS n FROM stage_gates WHERE state = 'pending'").n,
      passed: one("SELECT COUNT(*) AS n FROM stage_gates WHERE state = 'passed'").n,
      failed: one("SELECT COUNT(*) AS n FROM stage_gates WHERE state = 'failed'").n,
    },
    gates: q(`SELECT g.*, p.name AS project_name FROM stage_gates g LEFT JOIN projects p ON p.id = g.project_id ORDER BY g.state = 'pending' DESC, g.id DESC LIMIT 60`),
  };
}

export function createGate({ projectId, gate, actor }) {
  if (!projectId || !gate?.trim()) throw new Error('projectId and gate required');
  if (!one('SELECT id FROM projects WHERE id = ?', projectId)) throw new Error('project not found');
  exec('INSERT INTO stage_gates (project_id, gate) VALUES (?,?)', projectId, gate.trim());
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'pmo.gate_created', subjectType: 'gate', subjectId: id, payload: { projectId, gate } });
  return id;
}

export function resolveGate(id, { state, note = null, actor }) {
  if (!['passed', 'failed'].includes(state)) throw new Error('state: passed|failed');
  if (!one('SELECT id FROM stage_gates WHERE id = ?', id)) throw new Error('gate not found');
  exec('UPDATE stage_gates SET state = ?, note = ?, approver = ? WHERE id = ?', state, note, actor, id);
  audit({ actorType: 'human', actorId: actor, action: `pmo.gate_${state}`, subjectType: 'gate', subjectId: id });
}

// ---------- DATA · Insights ----------
export function insightsOverview() {
  return {
    activityByDay: q(`SELECT substr(occurred_at,1,10) AS day, COUNT(*) AS n FROM audit_log GROUP BY day ORDER BY day DESC LIMIT 14`).reverse(),
    runsByState: q('SELECT state, COUNT(*) AS n FROM runs GROUP BY state'),
    topSubjects: q('SELECT subject_type, COUNT(*) AS n FROM audit_log WHERE subject_type IS NOT NULL GROUP BY subject_type ORDER BY n DESC LIMIT 10'),
    spendByDay: q(`SELECT substr(created_at,1,10) AS day, ROUND(SUM(cost_usd),4) AS usd FROM model_calls GROUP BY day ORDER BY day DESC LIMIT 14`).reverse(),
    busiestAgents: q(`SELECT agent_id, COUNT(*) AS runs FROM runs GROUP BY agent_id ORDER BY runs DESC LIMIT 8`),
  };
}

// ---------- CREATE · Brand studio ----------
export function listBrandAssets() { return q('SELECT * FROM brand_assets ORDER BY id DESC LIMIT 50'); }

export function createBrandAsset({ kind, name, content = null, actor }) {
  if (!kind?.trim() || !name?.trim()) throw new Error('kind and name required');
  let runId = null;
  if (!content) {
    const agentId = writerAgent();
    if (agentId) runId = enqueueRun({
      agentId, taskType: `brand:${kind}`,
      input: { prompt: `Draft a ${kind} brand asset named "${name}" for Crucible Systems — an AI-native company where agents are the workforce and humans hold the gates. Industrial, precise, ember-and-graphite identity. Reply as JSON {"text": "..."}.` },
      actor,
    });
  }
  exec('INSERT INTO brand_assets (kind, name, content, run_id, created_by) VALUES (?,?,?,?,?)', kind.trim(), name.trim(), content, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'brand.asset_created', subjectType: 'brand', subjectId: id, payload: { kind, name, drafted: !content } });
  return id;
}

export function approveBrandAsset(id, { actor }) {
  const a = one('SELECT * FROM brand_assets WHERE id = ?', id);
  if (!a) throw new Error('asset not found');
  if (!a.content) throw new Error('still drafting');
  exec("UPDATE brand_assets SET state = 'approved' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'brand.asset_approved', subjectType: 'brand', subjectId: id });
}

// ---------- COMMERCE · Procurement ----------
export function listPurchases() {
  return q(`SELECT pr.*, v.name AS vendor_name FROM purchase_requests pr LEFT JOIN vendors v ON v.id = pr.vendor_id ORDER BY pr.state = 'requested' DESC, pr.id DESC LIMIT 60`);
}

export function createPurchase({ item, vendorId = null, amountUsd = 0, justification = null, actor }) {
  if (!item?.trim()) throw new Error('item required');
  exec('INSERT INTO purchase_requests (item, vendor_id, amount_usd, justification, created_by) VALUES (?,?,?,?,?)',
    item.trim(), vendorId, Number(amountUsd) || 0, justification, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'procurement.requested', subjectType: 'purchase', subjectId: id, payload: { item, amountUsd } });
  return id;
}

export function resolvePurchase(id, { state, actor }) {
  if (!['approved', 'rejected', 'ordered'].includes(state)) throw new Error('state: approved|rejected|ordered');
  const p = one('SELECT * FROM purchase_requests WHERE id = ?', id);
  if (!p) throw new Error('request not found');
  exec('UPDATE purchase_requests SET state = ?, approver = ? WHERE id = ?', state, actor, id);
  audit({ actorType: 'human', actorId: actor, action: `procurement.${state}`, subjectType: 'purchase', subjectId: id, payload: { item: p.item, amountUsd: p.amount_usd } });
}

// ---------- CAPITAL · FinOps ----------
export function finopsOverview() {
  const byAgent = q(`SELECT r.agent_id, COUNT(DISTINCT r.id) AS runs, ROUND(SUM(m.cost_usd),4) AS usd,
      SUM(m.tokens_in + m.tokens_out) AS tokens
    FROM model_calls m JOIN runs r ON r.id = m.run_id GROUP BY r.agent_id ORDER BY usd DESC LIMIT 12`);
  const wasted = one(`SELECT ROUND(COALESCE(SUM(m.cost_usd),0),4) AS usd, COUNT(DISTINCT r.id) AS runs
    FROM model_calls m JOIN runs r ON r.id = m.run_id WHERE r.state IN ('failed','cancelled')`);
  const retries = one('SELECT COUNT(*) AS n FROM model_calls WHERE ok = 0').n;
  const recommendations = [];
  for (const a of byAgent.slice(0, 5)) {
    const tier = one('SELECT model_tier FROM agents WHERE id = ?', a.agent_id)?.model_tier;
    if (tier === 'T3' && a.usd > 0.5) recommendations.push(`${a.agent_id} runs on T3 ($${a.usd}) — review whether T2 passes its golden set.`);
  }
  if (wasted.usd > 0) recommendations.push(`$${wasted.usd} burned inside ${wasted.runs} failed/cancelled runs — inspect the dead letter queue.`);
  if (!recommendations.length) recommendations.push('No waste detected — subscription-first routing is doing its job.');
  return { byAgent, wasted, retries, recommendations };
}

// ---------- TALENT · Recruiting ----------
export function listCandidates() { return q('SELECT * FROM candidates ORDER BY id DESC LIMIT 50'); }

export function createOpening({ roleName, brief, actor }) {
  if (!roleName?.trim() || !brief?.trim()) throw new Error('roleName and brief required');
  const agentId = writerAgent();
  if (!agentId) throw new Error('no active agent to draft the spec');
  const runId = enqueueRun({
    agentId, taskType: `recruit:${roleName}`,
    input: { prompt: `Draft a role specification for a NEW AI agent employee: "${roleName}".\nBrief: ${brief}\nReply as JSON: {"id":"AGT-XXX-001","name":"...","roleGroup":"execute|assure|docs|research","modelTier":"T1|T2|T3","mission":"...","outputs":["..."],"failMode":"escalate|retry","confidenceFloor":0.7}. The id must be unused and start with AGT-.` },
    actor,
  });
  exec('INSERT INTO candidates (role_name, brief, spec_run, created_by) VALUES (?,?,?,?)', roleName.trim(), brief, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'recruiting.opened', subjectType: 'candidate', subjectId: id, payload: { roleName } });
  return id;
}

export function trialCandidate(id, { actor }) {
  const c = one('SELECT * FROM candidates WHERE id = ?', id);
  if (!c) throw new Error('candidate not found');
  if (!c.spec) throw new Error('spec still drafting');
  const agentId = assureAgent();
  const runId = enqueueRun({
    agentId, taskType: `recruit-trial:${id}`,
    input: { prompt: `You are the hiring reviewer. Assess this drafted agent role spec for clarity, safety (fail mode, confidence floor) and overlap with existing roles. Spec:\n${c.spec}\nReply as JSON {"text":"verdict and reasoning", "score": 0.0-1.0}.` },
    actor,
  });
  exec("UPDATE candidates SET state = 'trial', trial_run = ? WHERE id = ?", runId, id);
  audit({ actorType: 'human', actorId: actor, action: 'recruiting.trial_started', subjectType: 'candidate', subjectId: id });
}

export function decideCandidate(id, { verdict, actor }) {
  const c = one('SELECT * FROM candidates WHERE id = ?', id);
  if (!c) throw new Error('candidate not found');
  if (verdict === 'reject') {
    exec("UPDATE candidates SET state = 'rejected' WHERE id = ?", id);
    audit({ actorType: 'human', actorId: actor, action: 'recruiting.rejected', subjectType: 'candidate', subjectId: id });
    return { hired: false };
  }
  if (verdict !== 'hire') throw new Error('verdict: hire|reject');
  if (!c.spec) throw new Error('no spec to hire from');
  let spec;
  try { spec = JSON.parse(c.spec); } catch { throw new Error('spec is not valid JSON — reject and re-open'); }
  // Older candidates stored the run envelope; unwrap rather than refuse them.
  if (spec && !spec.id) spec = extractSpec(c.spec_run) || spec;
  const agentId = String(spec.id || '').toUpperCase();
  if (!/^AGT-[A-Z]{2,5}-\d{3}$/.test(agentId)) throw new Error('spec.id must look like AGT-XXX-001');
  if (one('SELECT id FROM agents WHERE id = ?', agentId)) throw new Error(`${agentId} already exists`);
  exec('INSERT INTO agents (id, name, role_group, spec, model_tier, human_owner) VALUES (?,?,?,?,?,?)',
    agentId, spec.name || c.role_name, spec.roleGroup || 'execute', JSON.stringify(spec), spec.modelTier || 'T1', actor.replace('human:', ''));
  exec("UPDATE candidates SET state = 'hired', agent_id = ? WHERE id = ?", agentId, id);
  audit({ actorType: 'human', actorId: actor, action: 'recruiting.hired', subjectType: 'agent', subjectId: agentId, payload: { candidate: id, roleName: c.role_name } });
  notify({ level: 'info', source: 'recruiting', message: `New employee hired: ${agentId} (${c.role_name}).`, subjectType: 'agent', subjectId: agentId });
  return { hired: true, agentId };
}

// ---------- TALENT · Recruiting itself ----------
// A company that cannot staff itself is not autonomous, only obedient. This
// looks for the shapes of understaffing that show up in the data — work
// queued behind saturated employees, whole role groups missing, departments
// taking requests nobody is assigned to — and opens the role. The existing
// pipeline then drafts the spec, trials it, and hires. Nobody is asked.
//
// The limits are deliberate: hiring costs money on every future run, so the
// company may not grow without bound, and a role it just opened may not be
// opened again while that candidate is still moving.
const HIRE_CAP = 60;          // total active employees this may grow to
const OPENINGS_PER_SWEEP = 1; // never more than one new role at a time
const ROLE_COOLDOWN_H = 6;

export function workforceGaps() {
  const gaps = [];
  const roleLoad = q(`SELECT a.role_group,
      COUNT(DISTINCT a.id) AS staff,
      COALESCE(SUM(CASE WHEN r.state IN ('queued','leased','running') THEN 1 ELSE 0 END), 0) AS inflight
    FROM agents a LEFT JOIN runs r ON r.agent_id = a.id
    WHERE a.status = 'active' GROUP BY a.role_group`);
  for (const r of roleLoad) {
    const perHead = r.staff ? r.inflight / r.staff : 0;
    if (perHead >= 3) {
      gaps.push({
        role: r.role_group, severity: perHead,
        why: `${r.role_group} is carrying ${r.inflight} live items across ${r.staff} employee(s) — ${perHead.toFixed(1)} each, which is where quality starts slipping.`,
      });
    }
  }
  // Work waiting on a human because nobody in the role can take it.
  const stuck = one("SELECT COUNT(*) AS n FROM tasks WHERE state = 'blocked'").n;
  if (stuck >= 3) gaps.push({ role: 'run', severity: stuck, why: `${stuck} tasks are blocked; the delivery side is undermanned.` });
  // A department taking intake with nobody mapped to it.
  for (const d of q(`SELECT dept, COUNT(*) AS n FROM request_steps GROUP BY dept HAVING n >= 2`)) {
    const covered = one("SELECT id FROM agents WHERE status = 'active' AND lower(name) LIKE ?", `%${String(d.dept).toLowerCase()}%`);
    if (!covered) gaps.push({ role: 'run', dept: d.dept, severity: d.n, why: `${d.n} requests have been routed to "${d.dept}" and no employee is named for it.` });
  }
  return gaps.sort((a, b) => b.severity - a.severity);
}

/** Open the most pressing role, once, with the evidence attached. */
export function autoRecruit({ actor = 'system:autonomy' } = {}) {
  const staff = one("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'").n;
  if (staff >= HIRE_CAP) return { opened: 0, reason: `at the ${HIRE_CAP}-employee cap` };
  const moving = one("SELECT COUNT(*) AS n FROM candidates WHERE state IN ('drafting','screening','trial')").n;
  if (moving) return { opened: 0, reason: `${moving} candidate(s) already in the pipeline` };

  const gaps = workforceGaps();
  if (!gaps.length) return { opened: 0, reason: 'no gap in the data' };

  const opened = [];
  for (const g of gaps.slice(0, OPENINGS_PER_SWEEP)) {
    const roleName = g.dept ? `${g.dept} specialist` : `${g.role} capacity`;
    const recent = one("SELECT id FROM candidates WHERE role_name = ? AND created_at >= datetime('now', ?)", roleName, `-${ROLE_COOLDOWN_H} hours`);
    if (recent) continue;
    try {
      const id = createOpening({
        roleName,
        brief: `${g.why} Design an employee that absorbs this specific load: what it takes on, what it must refuse, and how its output is checked. Keep the scope narrow enough that it does not overlap an existing role.`,
        actor,
      });
      opened.push({ id, roleName, why: g.why });
      audit({
        actorType: 'system', actorId: actor, action: 'recruiting.auto_opened',
        subjectType: 'candidate', subjectId: id, payload: { roleName, evidence: g.why, staff },
      });
      notify({
        level: 'info', source: 'recruiting',
        message: `The company opened a role for itself: ${roleName}. ${g.why}`,
        subjectType: 'candidate', subjectId: id,
      });
    } catch (e) {
      audit({ actorType: 'system', actorId: actor, action: 'recruiting.auto_failed', subjectType: 'candidate', subjectId: 'auto', payload: { error: String(e.message).slice(0, 160) } });
    }
  }
  return { opened: opened.length, roles: opened };
}

// ---------- TALENT · Academy ----------
export function academyOverview() {
  const weak = q(`SELECT agent_id, MIN(score) AS worst FROM eval_runs GROUP BY agent_id HAVING worst < 0.8`);
  return {
    curricula: q('SELECT * FROM curricula ORDER BY id DESC LIMIT 50'),
    suggestions: weak.filter((w) => !one("SELECT id FROM curricula WHERE agent_id = ? AND state != 'done'", w.agent_id))
      .map((w) => ({ agentId: w.agent_id, reason: `worst eval score ${w.worst}` })),
  };
}

export function createCurriculum({ agentId, title, source = 'manual', actor }) {
  if (!agentId || !title?.trim()) throw new Error('agentId and title required');
  const before = one('SELECT AVG(score) AS s FROM (SELECT score FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 5)', agentId)?.s;
  exec('INSERT INTO curricula (agent_id, title, source, score_before) VALUES (?,?,?,?)', agentId, title.trim(), source, before);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'academy.curriculum_created', subjectType: 'curriculum', subjectId: id, payload: { agentId, title } });
  return id;
}

export function setCurriculumState(id, { state, actor }) {
  if (!['active', 'done'].includes(state)) throw new Error('state: active|done');
  const c = one('SELECT * FROM curricula WHERE id = ?', id);
  if (!c) throw new Error('curriculum not found');
  const after = state === 'done'
    ? one('SELECT AVG(score) AS s FROM (SELECT score FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 5)', c.agent_id)?.s : null;
  exec('UPDATE curricula SET state = ?, score_after = COALESCE(?, score_after) WHERE id = ?', state, after, id);
  audit({ actorType: 'human', actorId: actor, action: `academy.${state}`, subjectType: 'curriculum', subjectId: id });
}

// ---------- EXEC · Investor relations, Board room, Internal comms ----------
const companySnapshot = () => ({
  mrr: one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'").n,
  customers: one("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'").n,
  pipeline: one("SELECT COALESCE(SUM(value_usd),0) AS n FROM deals WHERE stage NOT IN ('won','lost')").n,
  spendMonth: one("SELECT COALESCE(ROUND(SUM(cost_usd),4),0) AS n FROM model_calls WHERE created_at >= datetime('now','start of month')").n,
  agents: one("SELECT COUNT(*) AS n FROM agents WHERE status = 'active'").n,
  products: one('SELECT COUNT(*) AS n FROM products').n,
  incidents: one("SELECT COUNT(*) AS n FROM incidents WHERE state != 'closed'").n,
  auditEvents: one('SELECT COUNT(*) AS n FROM audit_log').n,
});

export function listInvestorUpdates() { return q('SELECT * FROM investor_updates ORDER BY id DESC LIMIT 30'); }

export function generateInvestorUpdate({ period, actor }) {
  if (!period?.trim()) throw new Error('period required (e.g. 2026-08)');
  const s = companySnapshot();
  const agentId = writerAgent();
  const runId = agentId ? enqueueRun({
    agentId, taskType: `ir:${period}`,
    input: { prompt: `Write a concise monthly investor update for ${period} for Crucible Systems.\nLive numbers: MRR $${s.mrr}, ${s.customers} active customers, pipeline $${s.pipeline}, model spend this month $${s.spendMonth}, ${s.agents} active AI employees, ${s.products} products, ${s.incidents} open incidents.\nSections: Highlights, Numbers, Lowlights, Asks. Honest tone; no invented facts beyond these numbers. Reply as JSON {"text": "..."}.` },
    actor,
  }) : null;
  exec('INSERT INTO investor_updates (period, run_id, created_by) VALUES (?,?,?)', period.trim(), runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'ir.update_drafted', subjectType: 'irUpdate', subjectId: id, payload: { period } });
  return id;
}

export function sendInvestorUpdate(id, { actor }) {
  const u = one('SELECT * FROM investor_updates WHERE id = ?', id);
  if (!u) throw new Error('update not found');
  if (!u.body) throw new Error('still drafting');
  exec("UPDATE investor_updates SET state = 'sent' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'ir.update_sent', subjectType: 'irUpdate', subjectId: id, payload: { period: u.period } });
}

export function listBoardRecords() { return q('SELECT * FROM board_records ORDER BY id DESC LIMIT 20'); }

export function generateBoardPacket({ period, actor }) {
  if (!period?.trim()) throw new Error('period required (e.g. 2026-Q3)');
  const s = companySnapshot();
  const risks = q("SELECT title, likelihood * impact AS score FROM risks WHERE state = 'open' ORDER BY score DESC LIMIT 5");
  const agentId = writerAgent();
  const runId = agentId ? enqueueRun({
    agentId, taskType: `board:${period}`,
    input: { prompt: `Prepare a board packet for ${period}.\nNumbers: MRR $${s.mrr}, customers ${s.customers}, pipeline $${s.pipeline}, month spend $${s.spendMonth}, workforce ${s.agents} agents, open incidents ${s.incidents}, audit events ${s.auditEvents}.\nTop risks: ${risks.map((r) => `${r.title} (${r.score})`).join('; ') || 'none open'}.\nSections: State of the company, Financials, Risk report, Decisions requested. Reply as JSON {"text": "..."}.` },
    actor,
  }) : null;
  exec('INSERT INTO board_records (period, run_id, created_by) VALUES (?,?,?)', period.trim(), runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'board.packet_drafted', subjectType: 'boardRecord', subjectId: id, payload: { period } });
  return id;
}

export function holdBoardMeeting(id, { resolutions, actor }) {
  const b = one('SELECT * FROM board_records WHERE id = ?', id);
  if (!b) throw new Error('record not found');
  if (!resolutions?.trim()) throw new Error('resolutions required — a board meeting without decisions did not happen');
  exec("UPDATE board_records SET state = 'held', resolutions = ? WHERE id = ?", resolutions.trim(), id);
  audit({ actorType: 'human', actorId: actor, action: 'board.meeting_held', subjectType: 'boardRecord', subjectId: id, payload: { period: b.period } });
}

export function listBulletins() { return q('SELECT * FROM bulletins ORDER BY id DESC LIMIT 30'); }

export function generateBulletin({ actor }) {
  const week = new Date().toISOString().slice(0, 10);
  const events = q(`SELECT action, COUNT(*) AS n FROM audit_log WHERE occurred_at >= datetime('now','-7 days') GROUP BY action ORDER BY n DESC LIMIT 12`);
  const notes = q(`SELECT message FROM notifications WHERE created_at >= datetime('now','-7 days') ORDER BY id DESC LIMIT 8`).map((n) => n.message);
  const agentId = writerAgent();
  const runId = agentId ? enqueueRun({
    agentId, taskType: `comms:${week}`,
    input: { prompt: `Write this week's internal bulletin for the whole company (humans + AI employees).\nEvent volume by action: ${events.map((e) => `${e.action}×${e.n}`).join(', ') || 'quiet week'}.\nNotable notifications: ${notes.join(' | ') || 'none'}.\nSections: What shipped, What broke, What needs a human. Warm but factual. Reply as JSON {"text": "..."}.` },
    actor,
  }) : null;
  exec('INSERT INTO bulletins (week, run_id, created_by) VALUES (?,?,?)', week, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'comms.bulletin_drafted', subjectType: 'bulletin', subjectId: id, payload: { week } });
  return id;
}

export function publishBulletin(id, { actor }) {
  const b = one('SELECT * FROM bulletins WHERE id = ?', id);
  if (!b) throw new Error('bulletin not found');
  if (!b.body) throw new Error('still drafting');
  exec("UPDATE bulletins SET state = 'published' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'comms.bulletin_published', subjectType: 'bulletin', subjectId: id });
}

// ---------- shared sync tick: pull finished agent drafts into their rows ----------
export function syncExpansion() {
  const pull = (table, bodyCol) => {
    for (const r of q(`SELECT id, run_id FROM ${table} WHERE run_id IS NOT NULL AND ${bodyCol} IS NULL AND state = 'draft'`)) {
      const text = runText(r.run_id);
      if (text) exec(`UPDATE ${table} SET ${bodyCol} = ? WHERE id = ?`, text, r.id);
    }
  };
  pull('investor_updates', 'body');
  pull('board_records', 'packet');
  pull('bulletins', 'body');
  pull('releases', 'notes');
  pull('brand_assets', 'content');
  for (const c of q("SELECT id, spec_run FROM candidates WHERE state = 'drafting' AND spec_run IS NOT NULL")) {
    const spec = extractSpec(c.spec_run);
    if (spec) exec("UPDATE candidates SET spec = ?, state = 'screening' WHERE id = ?", JSON.stringify(spec, null, 2), c.id);
  }
  for (const c of q("SELECT id, trial_run FROM candidates WHERE state = 'trial' AND trial_run IS NOT NULL AND trial_note IS NULL")) {
    const text = runText(c.trial_run);
    if (text) exec('UPDATE candidates SET trial_note = ? WHERE id = ?', text, c.id);
  }
  for (const e of q("SELECT * FROM experiments WHERE state = 'running'")) {
    const ta = e.result_a || runText(e.run_a);
    const tb = e.result_b || runText(e.run_b);
    if (ta && !e.result_a) exec('UPDATE experiments SET result_a = ? WHERE id = ?', ta, e.id);
    if (tb && !e.result_b) exec('UPDATE experiments SET result_b = ? WHERE id = ?', tb, e.id);
  }
}
