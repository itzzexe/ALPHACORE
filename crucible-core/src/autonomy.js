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

const ACTOR = 'system:autonomy';
const MAX_PER_CYCLE = 12;

/** The categories where being wrong is expensive — surfaced in the warning. */
export const HIGH_STAKES = [
  'contract (signing)', 'productGate (a gate that commits the company)',
  'dispute (a ruling that sets precedent)', 'campaign (copy going live)',
  'decision (a registered decision)', 'ticket (a reply to a customer)',
];

export function isAutonomous() { return String(getSetting('AUTONOMY_MODE') || 'off') === 'full'; }
export function autonomySince() { return getSetting('AUTONOMY_SINCE'); }

export function setAutonomy(on, actor) {
  setSetting('AUTONOMY_MODE', on ? 'full' : 'off');
  setSetting('AUTONOMY_SINCE', on ? new Date().toISOString() : null);
  audit({
    actorType: 'human', actorId: actor,
    action: on ? 'autonomy.enabled' : 'autonomy.disabled',
    subjectType: 'settings', subjectId: 'AUTONOMY_MODE',
    payload: { by: actor, note: on ? 'the owner handed all decisions to the AI' : 'decisions returned to humans' },
  });
  notify({
    level: on ? 'crit' : 'info', source: 'autonomy',
    message: on
      ? 'AUTONOMY MODE ON — the Acting Executive is now deciding everything that would have waited for you. Every decision is logged and reversible; mistakes are committed rather than caught.'
      : 'Autonomy mode off — decisions are waiting for a human again.',
  });
  return { enabled: on };
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
    default:
      return null; // decisions, product gates and anything else stay with a person
  }
}

// ---------- the cycle ----------
let inFlight = false;

export async function autonomyTick() {
  if (!isAutonomous()) return;

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
  const items = pendingApprovals()
    .filter((i) => !['decision', 'productGate', 'maestroFlag', 'customerHealth'].includes(i.kind))
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

Approve what is plainly ready. Reject what is wrong or not worth doing. HOLD anything where a mistake would be expensive and hard to undo — signing, precedent-setting rulings, customer-facing sends where you cannot read the full history, or anything that commits money. You are trusted to decide, which includes deciding that something should wait for the owner.`,
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
