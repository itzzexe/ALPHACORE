// Organizational Immune System — the boring MVP (Part 5 §12): scheduled
// queries + threshold rules over data already collected. Containment is
// REVERSIBLE only (freeze spend, suspend to inactive, open a problem record,
// raise a notification). It may never fire anyone, delete anything, or expand
// any authority. Resumption is always a human decision.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { setFrozen } from './policy.js';
import { ruleCampaignOverspend } from './commercial.js';
import { ruleVendorAndLegalDates } from './corporate.js';

function ruleSpendAnomaly() {
  const rows = q(`
    SELECT agent_id,
           SUM(CASE WHEN date(created_at) = date('now') THEN cost_usd ELSE 0 END) AS today,
           SUM(CASE WHEN date(created_at) < date('now') THEN cost_usd ELSE 0 END) / 14.0 AS avg14
    FROM runs WHERE created_at >= datetime('now', '-14 days') GROUP BY agent_id`);
  for (const r of rows) {
    if (r.today > 1 && r.avg14 > 0 && r.today > 2 * r.avg14) {
      const frozen = one("SELECT frozen FROM budgets WHERE scope='agent' AND scope_id=? AND period_key=date('now')", r.agent_id);
      if (frozen?.frozen) continue;
      setFrozen('agent', r.agent_id, true, 'immune-system');
      notify({ level: 'crit', source: 'immune.spend', message: `Spend anomaly: ${r.agent_id} at $${r.today.toFixed(2)} today (>2× trailing median). Budget frozen — resumption is a human decision.`, subjectType: 'agent', subjectId: r.agent_id });
    }
  }
}

function ruleFailureCluster() {
  const rows = q(`
    SELECT agent_id, COUNT(*) AS n FROM runs
    WHERE state = 'failed' AND created_at >= datetime('now', '-7 days')
    GROUP BY agent_id HAVING n >= 3`);
  for (const r of rows) {
    const sig = `agent-failures:${r.agent_id}`;
    const open = one("SELECT id FROM problems WHERE signature = ? AND state = 'open'", sig);
    if (open) {
      exec("UPDATE problems SET count = ?, updated_at = datetime('now') WHERE id = ?", r.n, open.id);
      continue;
    }
    exec('INSERT INTO problems (signature, agent_id, count, note) VALUES (?,?,?,?)',
      sig, r.agent_id, r.n, `${r.n} failed runs in 7 days — root-cause work goes ahead of features (Part 5 §6.3).`);
    notify({ level: 'warn', source: 'immune.failures', message: `Problem opened: ${r.agent_id} failed ${r.n} runs in 7 days.`, subjectType: 'agent', subjectId: r.agent_id });
    audit({ actorType: 'system', actorId: 'immune', action: 'problem.opened', subjectType: 'agent', subjectId: r.agent_id, payload: { signature: sig, count: r.n } });
  }
}

function ruleEvalRegression() {
  const agents = q('SELECT DISTINCT agent_id FROM eval_runs');
  for (const a of agents) {
    const last2 = q('SELECT score FROM eval_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 2', a.agent_id);
    if (last2.length < 2) continue;
    const [latest, prev] = last2;
    if (prev.score > 0 && latest.score < 0.9 * prev.score) {
      const agent = one('SELECT status FROM agents WHERE id = ?', a.agent_id);
      if (agent?.status === 'active') {
        exec("UPDATE agents SET status = 'suspended' WHERE id = ?", a.agent_id);
        audit({ actorType: 'system', actorId: 'immune', action: 'agent.suspended', subjectType: 'agent', subjectId: a.agent_id, payload: { reason: 'eval-regression', latest: latest.score, prev: prev.score } });
        notify({ level: 'crit', source: 'immune.eval', message: `Eval regression: ${a.agent_id} dropped ${prev.score.toFixed(2)} → ${latest.score.toFixed(2)}. Agent suspended — owner review required.`, subjectType: 'agent', subjectId: a.agent_id });
      }
    }
  }
}

function ruleStaleGate() {
  const rows = q(`SELECT id, agent_id FROM runs WHERE state = 'awaiting_human' AND created_at < datetime('now', '-24 hours')`);
  for (const r of rows) {
    notify({ level: 'warn', source: 'immune.gate', message: `Run by ${r.agent_id} has waited at the human gate for over 24h.`, subjectType: 'run', subjectId: r.id });
  }
}

function ruleStaleSev1() {
  const rows = q(`SELECT id, title, timeline FROM incidents WHERE state = 'open' AND sev = 'SEV1'`);
  for (const r of rows) {
    const timeline = JSON.parse(r.timeline);
    const lastT = new Date(timeline.at(-1)?.t || 0).getTime();
    if (Date.now() - lastT > 60 * 60 * 1000) {
      notify({ level: 'crit', source: 'immune.sev1', message: `SEV1 #${r.id} (“${r.title}”) has had no timeline update for over an hour.`, subjectType: 'incident', subjectId: r.id });
    }
  }
}

function ruleOverdueRituals() {
  const rows = q("SELECT id, title FROM rituals WHERE next_due < date('now')");
  for (const r of rows) {
    notify({ level: 'warn', source: 'immune.ritual', message: `Governance ritual overdue: ${r.title} — no artifact means the meeting did not happen.`, subjectType: 'ritual', subjectId: r.id });
  }
}

export function immuneTick() {
  ruleSpendAnomaly();
  ruleFailureCluster();
  ruleEvalRegression();
  ruleStaleGate();
  ruleStaleSev1();
  ruleOverdueRituals();
  // Corporate rules live with their modules; the tick runs the whole immune system.
  ruleCampaignOverspend();
  ruleVendorAndLegalDates();
}

export function listProblems() {
  return q("SELECT * FROM problems ORDER BY state = 'resolved', updated_at DESC LIMIT 50");
}

export function resolveProblem(id, { note, actor }) {
  const p = one('SELECT * FROM problems WHERE id = ?', id);
  if (!p) throw new Error('problem not found');
  exec("UPDATE problems SET state = 'resolved', note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ?", note || null, id);
  audit({ actorType: 'human', actorId: actor, action: 'problem.resolved', subjectType: 'agent', subjectId: p.agent_id, payload: { signature: p.signature } });
}
