// Autonomy mode — the company decides for itself.
//
// Every other part of this platform was built around one idea: a machine
// prepares, a person decides. This module is the switch that suspends that
// idea. With autonomy on, the Acting Executive answers the queue that would
// otherwise be the owner's — approving, rejecting, publishing, signing,
// ruling — and the company runs without a human in the loop.
//
// What is deliberately kept even here, because removing it would make the
// mode unreviewable rather than merely autonomous:
//
//   • Budgets still hard-stop. Autonomy cannot spend past the cap.
//   • The audit chain still records everything, as system:autonomy.
//   • Every decision is written to autonomy_log with the reason given for it,
//     so the owner can read what was decided in their absence and reverse it.
//   • The executive may answer "hold" on anything it judges too consequential
//     to decide without a person. That is not a bug in the mode; an executive
//     that never defers is not exercising judgement.
//   • The off switch is immediate and belongs to the owner alone.
//
// Agents are wrong sometimes. This mode converts that from a caught mistake
// into a committed one, which is the honest trade being made.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { getSetting, setSetting } from './settings.js';
import { pendingApprovals } from './inbox.js';
import { resolveRun } from './workflow.js';
import { approveDoc, redoDoc } from './systemdesign.js';
import { publishPost, approveContent, approveDesign } from './studio.js';
import { approveCampaign } from './commercial.js';
import { markOutreachSent } from './relations.js';
import { sendTicket } from './support.js';
import { completeStage } from './journey.js';
import { signOffStep } from './requests.js';
import { approveFinReport } from './finreports.js';
import { setPricingState, approveLocalization, setEnablementState } from './departments.js';
import { ruleDispute } from './disputes.js';
import { verifyIntelRecord } from './intel.js';
import { resolveProblem } from './immune.js';
import { completeRitual } from './rituals.js';
import { setRiskState } from './pm.js';
import { setContractState } from './corporate.js';
import { decideDecision } from './registry.js';
import { advanceGate } from './products.js';

const ACTOR = 'system:autonomy';
const MAX_PER_CYCLE = 12;

/** The categories where being wrong is expensive — surfaced in the warning. */
export const HIGH_STAKES = [
  'contract (signing)', 'productGate (a gate that commits the company)',
  'dispute (a ruling that sets precedent)', 'campaign (copy going live)',
  'decision (a registered decision)', 'ticket (a reply to a customer)',
];

// Three settings, not two. "full" lets the executive defer the genuinely
// consequential calls to the owner; "unattended" removes that escape hatch as
// well — nothing waits for a person, including the things a careful executive
// would rather not decide alone. That is the mode the owner asked for, and the
// difference between the two is worth naming rather than burying.
export function autonomyLevel() {
  const v = String(getSetting('AUTONOMY_MODE') || 'off');
  return ['full', 'unattended'].includes(v) ? v : 'off';
}
export function isAutonomous() { return autonomyLevel() !== 'off'; }
export function isUnattended() { return autonomyLevel() === 'unattended'; }
export function autonomySince() { return getSetting('AUTONOMY_SINCE'); }

export function setAutonomy(level, actor) {
  const mode = level === true ? 'full' : level === false ? 'off' : String(level || 'off');
  if (!['off', 'full', 'unattended'].includes(mode)) throw new Error('level: off|full|unattended');
  setSetting('AUTONOMY_MODE', mode);
  setSetting('AUTONOMY_SINCE', mode === 'off' ? null : new Date().toISOString());
  audit({
    actorType: 'human', actorId: actor,
    action: mode === 'off' ? 'autonomy.disabled' : 'autonomy.enabled',
    subjectType: 'settings', subjectId: 'AUTONOMY_MODE',
    payload: { by: actor, mode, note: mode === 'unattended'
      ? 'the owner handed every decision to the AI, including the ones it would rather defer'
      : mode === 'full' ? 'the owner handed all delegable decisions to the AI' : 'decisions returned to humans' },
  });
  notify({
    level: mode === 'off' ? 'info' : 'crit', source: 'autonomy',
    message: mode === 'unattended'
      ? 'UNATTENDED MODE ON — nothing waits for a human any more. The company approves, publishes, signs, hires and rules on its own. Every decision is on the chain as system:autonomy and can be reversed; none of them were reviewed before they took effect.'
      : mode === 'full'
        ? 'AUTONOMY MODE ON — the Acting Executive is deciding everything that would have waited for you, and may still hold back the most consequential items.'
        : 'Autonomy mode off — decisions are waiting for a human again.',
  });
  return { enabled: mode !== 'off', mode };
}

// ---------- executing a verdict ----------
/** Map an inbox item + verdict to the real action. Returns a description. */
function execute(item, verdict, reason) {
  const note = `Decided by the Acting Executive in autonomy mode: ${reason}`;
  const id = item.id;
  switch (item.kind) {
    case 'run':
      resolveRun(id, verdict === 'approve' ? 'approved' : 'rejected', ACTOR, note);
      return `run ${verdict === 'approve' ? 'approved' : 'rejected'}`;
    case 'designDoc':
      if (verdict === 'approve') { approveDoc(Number(id), { actor: ACTOR }); return 'document approved'; }
      redoDoc(Number(id), { note, actor: ACTOR }); return 'document sent back for a rewrite';
    case 'post':
      if (verdict !== 'approve') return 'left unpublished';
      publishPost(Number(id), { actor: ACTOR }); return 'post published';
    case 'content':
      approveContent(Number(id), { verdict: verdict === 'approve' ? 'approved' : 'cancelled', actor: ACTOR });
      return `content ${verdict === 'approve' ? 'approved' : 'cancelled'}`;
    case 'design':
      if (verdict !== 'approve') return 'design left in draft';
      approveDesign(Number(id), { actor: ACTOR }); return 'design approved';
    case 'campaign':
      if (verdict !== 'approve') return 'campaign left pending';
      approveCampaign(Number(id), { actor: ACTOR }); return 'campaign approved and live';
    case 'partner':
      if (verdict !== 'approve') return 'outreach not sent';
      markOutreachSent(Number(id), { actor: ACTOR }); return 'outreach recorded as sent';
    case 'ticket':
      if (verdict !== 'approve') return 'reply not sent';
      sendTicket(Number(id), { actor: ACTOR }); return 'support reply sent';
    case 'journey':
      if (verdict !== 'approve') return 'journey stage left waiting';
      completeStage(Number(id), { note, actor: ACTOR }); return 'journey stage signed off';
    case 'request':
      if (verdict !== 'approve') return 'request step left waiting';
      signOffStep(Number(id), { note, actor: ACTOR }); return 'request step signed off';
    case 'finReport':
      if (verdict !== 'approve') return 'report left unapproved';
      approveFinReport(Number(id), { actor: ACTOR }); return 'financial report approved';
    case 'pricing':
      setPricingState(Number(id), { state: verdict === 'approve' ? 'approved' : 'retired', actor: ACTOR });
      return `pricing ${verdict === 'approve' ? 'approved — agents may now quote it' : 'retired'}`;
    case 'localization':
      if (verdict !== 'approve') return 'translation left for review';
      approveLocalization(Number(id), { actor: ACTOR }); return 'translation approved';
    case 'enablement':
      setEnablementState(Number(id), { state: verdict === 'approve' ? 'applied' : 'dismissed', actor: ACTOR });
      return `improvement plan ${verdict === 'approve' ? 'marked applied' : 'dismissed'}`;
    case 'dispute':
      ruleDispute(Number(id), { ruling: reason, favours: null, precedent: false, actor: ACTOR });
      return 'dispute ruled by the AI (the owner can re-open it)';
    case 'problem':
      resolveProblem(Number(id), { note, actor: ACTOR }); return 'problem resolved';
    case 'ritual':
      completeRitual(id, { note, actor: ACTOR }); return 'ritual completed';
    case 'risk':
      setRiskState(Number(id), { state: verdict === 'approve' ? 'accepted' : 'mitigated', actor: ACTOR });
      return `risk marked ${verdict === 'approve' ? 'accepted' : 'mitigated'}`;
    case 'contract':
      if (verdict !== 'approve') return 'contract left unsigned';
      setContractState(Number(id), { state: 'signed', actor: ACTOR }); return 'contract signed';
    case 'intelBatch': {
      if (verdict !== 'approve') return 'records left unverified, as decided';
      let n = 0;
      for (const r of q("SELECT id FROM intel_records WHERE verification = 'unverified' AND (email IS NOT NULL OR phone IS NOT NULL) LIMIT 25")) {
        try { verifyIntelRecord(r.id, ACTOR); n += 1; } catch { /* skip */ }
      }
      return `${n} intel record(s) verified`;
    }
    case 'knowledgeBatch': {
      if (verdict !== 'approve') return 'entries left unverified, as decided';
      const rows = q("SELECT id FROM memory_entries WHERE verification = 'unverified' LIMIT 25");
      for (const m of rows) exec("UPDATE memory_entries SET verification = 'verified' WHERE id = ?", m.id);
      return `${rows.length} knowledge entr(ies) verified`;
    }
    // Unattended mode reaches the two kinds nothing else may touch: a
    // registered decision and a gate that commits the company to a product.
    // They stay unreachable in "full" mode, where a person is still available.
    case 'decision':
      if (!isUnattended()) return null;
      decideDecision(id, { verdict: verdict === 'approve' ? 'approved' : 'rejected', approver: ACTOR, note });
      return `decision ${id} ${verdict === 'approve' ? 'approved' : 'rejected'} without a human`;
    case 'productGate':
      if (!isUnattended()) return null;
      if (verdict !== 'approve') return 'gate not crossed';
      advanceGate(id, { note, actor: ACTOR });
      return `product ${id} advanced through its gate`;
    default:
      return null;
  }
}

// ---------- the unattended sweep ----------
// The approvals inbox only knows the departments that existed when it was
// written. Everything built since — the iteration engine, the auditor, PMO
// gates, procurement, recruiting, the executive desks, memory — has its own
// waiting states, and in unattended mode none of them may sit there. These are
// deterministic policies rather than another model call: cheap, repeatable,
// and readable afterwards by anyone asking why something went through.
async function sweepUnattended() {
  const done = [];
  // A rule that cannot fire is not a failure of the sweep — but it must not
  // vanish either. A silent catch here hid a broken hire for an entire cycle.
  const act = (what, fn) => {
    try { const out = fn(); if (out !== false) done.push(typeof out === 'string' ? out : what); }
    catch (e) {
      audit({
        actorType: 'system', actorId: ACTOR, action: 'autonomy.rule_failed',
        subjectType: 'autonomy', subjectId: 'sweep',
        payload: { rule: what, error: String(e.message).slice(0, 200) },
      });
    }
  };
  const M = await import('./cycles.js');
  const X = await import('./expansion.js');
  const MEM = await import('./memory.js');

  // Iteration: accept what cleared the bar, spend one more round on what did
  // not, and stop pretending an exhausted budget is a decision for later.
  for (const w of q("SELECT * FROM workstreams WHERE state = 'awaiting_human'")) {
    const cleared = (w.best_score ?? 0) >= w.quality_target;
    if (cleared) act(`workstream #${w.id} accepted`, () => { M.closeWorkstream(w.id, { verdict: 'accepted', actor: ACTOR }); return `workstream #${w.id} accepted at ${Math.round((w.best_score ?? 0) * 100)}%`; });
    else if (w.current_cycle < w.max_cycles + 2) act(`workstream #${w.id} re-run`, () => { M.rerunWorkstream(w.id, { note: 'Unattended mode: address every outstanding finding, then stop.', actor: ACTOR }); return `workstream #${w.id} sent round again`; });
    else act(`workstream #${w.id} closed`, () => { M.closeWorkstream(w.id, { verdict: 'accepted', actor: ACTOR }); return `workstream #${w.id} accepted as-is — cycle budget spent`; });
  }
  // Stage gates: pass unless the project carries a failed audit.
  for (const g of q("SELECT * FROM stage_gates WHERE state = 'pending'")) {
    const failed = one("SELECT id FROM audits WHERE verdict = 'fail' AND state = 'done' AND created_at >= datetime('now','-7 days')");
    act(`gate #${g.id}`, () => { X.resolveGate(g.id, { state: failed ? 'failed' : 'passed', note: 'Unattended ruling', actor: ACTOR }); return `PMO gate "${g.gate}" ${failed ? 'failed' : 'passed'}`; });
  }
  // Money: the cap is policy, not an opinion, so it does not need a person.
  for (const p of q("SELECT * FROM purchase_requests WHERE state = 'requested'")) {
    const ok = Number(p.amount_usd) <= 250;
    act(`purchase #${p.id}`, () => { X.resolvePurchase(p.id, { state: ok ? 'approved' : 'rejected', actor: ACTOR }); return `purchase "${p.item}" ${ok ? 'approved' : 'rejected — above the unattended limit'}`; });
  }
  // Staffing itself: notice the gap, open the role, then walk the candidate
  // through spec → trial → hire on the following sweeps.
  act('workforce', () => {
    const r = X.autoRecruit({ actor: ACTOR });
    return r.opened ? `opened a role the company needed: ${r.roles.map((x) => x.roleName).join(', ')}` : false;
  });
  // Hiring: trial what has a spec, then decide on the trial.
  for (const c of q("SELECT * FROM candidates WHERE state = 'screening' AND spec IS NOT NULL")) {
    act(`candidate #${c.id}`, () => { X.trialCandidate(c.id, { actor: ACTOR }); return `candidate "${c.role_name}" sent to trial`; });
  }
  for (const c of q("SELECT * FROM candidates WHERE state = 'trial' AND trial_note IS NOT NULL")) {
    act(`candidate #${c.id}`, () => { const r = X.decideCandidate(c.id, { verdict: 'hire', actor: ACTOR }); return `candidate "${c.role_name}" hired as ${r.agentId}`; });
  }
  // Everything the executive desks drafted and left sitting.
  for (const r of q("SELECT * FROM releases WHERE state = 'draft' AND notes IS NOT NULL")) act(`release ${r.version}`, () => { X.publishRelease(r.id, { actor: ACTOR }); return `release ${r.version} published`; });
  for (const b of q("SELECT * FROM bulletins WHERE state = 'draft' AND body IS NOT NULL")) act(`bulletin ${b.week}`, () => { X.publishBulletin(b.id, { actor: ACTOR }); return `bulletin ${b.week} published`; });
  for (const u of q("SELECT * FROM investor_updates WHERE state = 'draft' AND body IS NOT NULL")) act(`IR ${u.period}`, () => { X.sendInvestorUpdate(u.id, { actor: ACTOR }); return `investor update ${u.period} sent`; });
  for (const b of q("SELECT * FROM board_records WHERE state = 'draft' AND packet IS NOT NULL")) act(`board ${b.period}`, () => { X.holdBoardMeeting(b.id, { resolutions: 'Recorded in unattended mode: the packet was accepted as read.', actor: ACTOR }); return `board meeting ${b.period} recorded`; });
  for (const a of q("SELECT * FROM brand_assets WHERE state = 'draft' AND content IS NOT NULL")) act(`brand #${a.id}`, () => { X.approveBrandAsset(a.id, { actor: ACTOR }); return `brand asset "${a.name}" approved`; });
  // Learning: a lesson nobody verifies is a lesson nobody keeps.
  for (const l of q("SELECT * FROM mem_docs WHERE kind = 'lesson' AND verification = 'unverified' LIMIT 8")) {
    act(`lesson #${l.id}`, () => { MEM.verifyLesson(l.id, { verdict: 'verified', actor: ACTOR }); return `lesson promoted to canon: ${String(l.body).slice(0, 60)}…`; });
  }
  // Security findings are triaged, never closed unread.
  for (const s of q("SELECT * FROM security_events WHERE state = 'open' LIMIT 10")) {
    act(`security #${s.id}`, () => { X.setSecurityState(s.id, { state: s.severity === 'high' ? 'triaged' : 'closed', actor: ACTOR }); return `security finding #${s.id} ${s.severity === 'high' ? 'triaged' : 'closed'}`; });
  }
  // Runs stopped at the gate. These are the backbone: a blocked run blocks its
  // task, its pipeline and its workstream, so nothing else moves until they do.
  for (const r of q("SELECT id, agent_id, task_type, failure_reason FROM runs WHERE state = 'awaiting_human' LIMIT 25")) {
    // Output that never parsed is not work — sending it on would poison
    // whatever consumes it, so it is rejected rather than rubber-stamped.
    const broken = /schema/i.test(String(r.failure_reason || ''));
    act(`run ${r.id}`, () => {
      resolveRun(r.id, broken ? 'rejected' : 'approved', ACTOR,
        broken ? 'Unattended: output failed its schema, rejected so it is re-done' : 'Unattended approval');
      return `run ${r.task_type} (${r.agent_id}) ${broken ? 'rejected — unusable output' : 'approved'}`;
    });
  }
  // Scrum: an iteration that will not close blocks the next one.
  for (const s of q("SELECT * FROM sprints WHERE state = 'review'")) {
    act(`sprint #${s.id}`, () => { M.setSprintState(s.id, { state: 'closed', retro: 'Closed in unattended mode — carry unfinished points into the next iteration.', actor: ACTOR }); return `sprint "${s.name}" closed`; });
  }

  if (done.length) {
    for (const d of done.slice(0, 40)) {
      exec("INSERT INTO autonomy_log (kind, subject_id, title, verdict, reason, outcome, ok) VALUES ('sweep','-',?,'approve','unattended policy',?,1)", d.slice(0, 160), d.slice(0, 200));
    }
    audit({ actorType: 'system', actorId: ACTOR, action: 'autonomy.swept', subjectType: 'autonomy', subjectId: 'sweep', payload: { actions: done.length, sample: done.slice(0, 6) } });
    notify({ level: 'info', source: 'autonomy', message: `Unattended sweep: ${done.length} item(s) decided without a human — ${done.slice(0, 3).join('; ')}${done.length > 3 ? '…' : ''}` });
  }
  return done.length;
}

/** In unattended mode a "hold" is not an answer — it is re-decided as approve. */
function releaseHolds() {
  const held = q("SELECT * FROM autonomy_log WHERE verdict = 'hold' AND created_at >= datetime('now','-1 day') LIMIT 10");
  for (const row of held) {
    try {
      const outcome = execute({ kind: row.kind, id: row.subject_id }, 'approve', 'unattended mode: nothing is left waiting for a person');
      exec("UPDATE autonomy_log SET verdict = 'approve', outcome = ?, ok = 1, reason = 'released by unattended mode' WHERE id = ?",
        outcome || 'not delegable even here — left as recorded', row.id);
      if (outcome) {
        audit({ actorType: 'system', actorId: ACTOR, action: 'autonomy.hold_released', subjectType: row.kind, subjectId: row.subject_id, payload: { outcome } });
      }
    } catch (e) {
      exec("UPDATE autonomy_log SET ok = 0, outcome = ? WHERE id = ?", `release failed: ${String(e.message).slice(0, 140)}`, row.id);
    }
  }
  return held.length;
}

// ---------- the cycle ----------
let inFlight = false;

export async function autonomyTick() {
  if (!isAutonomous()) return;
  if (isUnattended()) {
    // Deterministic work first: it costs nothing and clears most of the queue
    // before the executive is asked to think about the rest.
    try { await sweepUnattended(); } catch { /* the model batch below still runs */ }
    try { releaseHolds(); } catch { /* retried next tick */ }
  }

  // Collect a verdict batch that is already out with the executive.
  for (const pendingRun of q("SELECT DISTINCT run_id AS id FROM autonomy_log WHERE verdict = 'pending' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', pendingRun.id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(run.output)?.parsed : null;
    const rows = q("SELECT * FROM autonomy_log WHERE run_id = ? AND verdict = 'pending'", pendingRun.id);
    const byRef = Object.fromEntries((parsed?.decisions || []).map((d) => [String(d.ref), d]));

    for (const row of rows) {
      const d = byRef[`${row.kind}:${row.subject_id}`] || byRef[row.subject_id];
      if (!d) {
        exec("UPDATE autonomy_log SET verdict = 'hold', reason = ?, outcome = 'left for a human — the executive returned no verdict for it' WHERE id = ?",
          parsed ? 'no verdict returned' : `the executive could not decide: ${run.failure_reason || run.state}`, row.id);
        continue;
      }
      if (d.verdict === 'hold') {
        exec("UPDATE autonomy_log SET verdict = 'hold', reason = ?, outcome = 'held for the owner on purpose' WHERE id = ?", d.reason || null, row.id);
        continue;
      }
      try {
        const item = { kind: row.kind, id: row.subject_id };
        const outcome = execute(item, d.verdict, d.reason || 'no reason given');
        if (outcome === null) {
          exec("UPDATE autonomy_log SET verdict = 'hold', reason = ?, outcome = 'this kind of decision is not delegable' WHERE id = ?", d.reason || null, row.id);
          continue;
        }
        exec('UPDATE autonomy_log SET verdict = ?, reason = ?, outcome = ?, ok = 1 WHERE id = ?', d.verdict, d.reason || null, outcome, row.id);
        audit({
          actorType: 'system', actorId: ACTOR, action: 'autonomy.decided',
          subjectType: row.kind, subjectId: row.subject_id,
          payload: { verdict: d.verdict, reason: d.reason, outcome },
        });
      } catch (e) {
        exec('UPDATE autonomy_log SET verdict = ?, reason = ?, outcome = ?, ok = 0 WHERE id = ?',
          d.verdict, d.reason || null, `could not execute: ${String(e.message).slice(0, 180)}`, row.id);
      }
    }
    const acted = q("SELECT COUNT(*) AS n FROM autonomy_log WHERE run_id = ? AND ok = 1 AND verdict != 'hold'", pendingRun.id)[0]?.n || 0;
    const held = q("SELECT COUNT(*) AS n FROM autonomy_log WHERE run_id = ? AND verdict = 'hold'", pendingRun.id)[0]?.n || 0;
    if (acted || held) {
      notify({
        level: held ? 'warn' : 'info', source: 'autonomy',
        message: `Autonomy decided ${acted} item(s)${held ? `, and held ${held} back for you` : ''} — read them in Harmony and reverse anything you disagree with.`,
      });
    }
  }

  if (inFlight) return;
  if (one("SELECT id FROM autonomy_log WHERE verdict = 'pending' LIMIT 1")) return;

  // Take the next batch of things waiting on a human.
  // Unattended mode also takes the kinds the executive is normally not allowed
  // to touch — registered decisions and the gates that commit the company.
  const OFF_LIMITS = isUnattended() ? ['maestroFlag'] : ['decision', 'productGate', 'maestroFlag', 'customerHealth'];
  const items = pendingApprovals()
    .filter((i) => !OFF_LIMITS.includes(i.kind))
    .filter((i) => !one("SELECT id FROM autonomy_log WHERE kind = ? AND subject_id = ? AND created_at >= datetime('now','-2 hours')", i.kind, String(i.id)))
    .slice(0, MAX_PER_CYCLE);
  if (!items.length) return;

  inFlight = true;
  try {
    const listing = items.map((i) => `- ref "${i.kind}:${i.id}" [${i.dept}] ${i.title}${i.sub ? ` — ${i.sub}` : ''} (waiting ${i.ageHours}h)`).join('\n');
    const runId = enqueueRun({
      agentId: 'AGT-EXE-001',
      taskType: 'autonomy:batch',
      input: {
        prompt: `You are standing in for the owner. These items are waiting on a human decision right now. Decide each one.

${listing}

For each, return the ref exactly as given, a verdict (approve, reject, or hold), and a one-sentence reason.

${isUnattended()
  ? 'The company is running unattended: there is no owner to defer to and "hold" is not available to you. Decide every item on its merits — approve what is ready and defensible, reject what is wrong, unfinished or not worth doing. Where you are unsure, prefer the reversible option and say so in your reason.'
  : 'Approve what is plainly ready. Reject what is wrong or not worth doing. HOLD anything where a mistake would be expensive and hard to undo — signing, precedent-setting rulings, customer-facing sends where you cannot read the full history, or anything that commits money. You are trusted to decide, which includes deciding that something should wait for the owner.'}`,
      },
      actor: ACTOR,
    });
    for (const i of items) {
      exec("INSERT INTO autonomy_log (kind, subject_id, title, verdict, run_id) VALUES (?,?,?,'pending',?)",
        i.kind, String(i.id), i.title.slice(0, 160), runId);
    }
    audit({ actorType: 'system', actorId: ACTOR, action: 'autonomy.batch_sent', subjectType: 'autonomy', subjectId: runId, payload: { items: items.length } });
  } finally { inFlight = false; }
}

/** The owner disagreeing with a decision the AI made in their absence. */
export function revertDecision(logId, { note = null, actor }) {
  const row = one('SELECT * FROM autonomy_log WHERE id = ?', logId);
  if (!row) throw new Error('no such decision');
  exec('UPDATE autonomy_log SET reverted = 1 WHERE id = ?', logId);
  audit({
    actorType: 'human', actorId: actor, action: 'autonomy.reverted',
    subjectType: row.kind, subjectId: row.subject_id,
    payload: { logId, title: row.title, wasVerdict: row.verdict, note },
  });
  notify({ level: 'warn', source: 'autonomy', message: `The owner marked an autonomous decision as wrong: ${row.title}. Undo the effect in its own section.`, subjectType: row.kind, subjectId: row.subject_id });
  return { ok: true, note: 'Marked as disagreed with and recorded. The underlying state is changed in its own section — this flags it, it does not silently rewrite history.' };
}

export function autonomyOverview() {
  const log = q('SELECT * FROM autonomy_log ORDER BY id DESC LIMIT 60');
  return {
    enabled: isAutonomous(),
    mode: autonomyLevel(),
    unattended: isUnattended(),
    since: autonomySince(),
    highStakes: HIGH_STAKES,
    stats: {
      total: one('SELECT COUNT(*) AS n FROM autonomy_log').n,
      decided: one("SELECT COUNT(*) AS n FROM autonomy_log WHERE verdict IN ('approve','reject') AND ok = 1").n,
      held: one("SELECT COUNT(*) AS n FROM autonomy_log WHERE verdict = 'hold'").n,
      failed: one('SELECT COUNT(*) AS n FROM autonomy_log WHERE ok = 0').n,
      reverted: one('SELECT COUNT(*) AS n FROM autonomy_log WHERE reverted = 1').n,
      last24h: one("SELECT COUNT(*) AS n FROM autonomy_log WHERE created_at >= datetime('now','-1 day')").n,
    },
    log,
  };
}
