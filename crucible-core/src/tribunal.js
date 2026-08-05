// Mini-Tribunal (Part 2 §7.3-7.4, T2 shape): advocate → blind critics →
// judge synthesis. Blind isolation is mechanical: critics run as parallel
// independent calls that never receive each other's output, and the audit log
// asserts it. The judge recommends; a HUMAN approves — always. Any critic
// block forces escalation regardless of scores. All spend draws from the
// governance pool (≤5% rule) plus the per-decision cap.
import { one, exec } from './db.js';
import { agentsConfig } from './env.js';
import { audit } from './audit.js';
import { route, parseAgentJson } from './router.js';
import { getDecision } from './registry.js';

const DEFAULT_CRITICS = ['security', 'cost', 'architecture'];

function saveRound(decisionId, round, role, label, output, costUsd) {
  exec('INSERT INTO tribunal_rounds (decision_id, round, role, label, output, cost_usd) VALUES (?,?,?,?,?,?)',
    decisionId, round, role, label, JSON.stringify(output), costUsd);
}

function caseFile(decision) {
  const verified = decision.evidence.filter((e) => e.verification === 'verified');
  const gaps = decision.evidence.filter((e) => e.verification !== 'verified');
  return [
    `Case ${decision.id} (${decision.tier}): ${decision.title}`,
    decision.context ? `Context: ${decision.context}` : null,
    verified.length
      ? `VERIFIED EVIDENCE (the only citable class):\n${verified.map((e) => `- ${e.claim} [${e.source_ref}]`).join('\n')}`
      : 'VERIFIED EVIDENCE: none.',
    gaps.length
      ? `EVIDENCE GAPS (unverified — may NOT be cited as fact):\n${gaps.map((e) => `- ${e.claim}`).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');
}

async function tribunalCall(role, label, decision, prompt) {
  const spec = agentsConfig.tribunal[role];
  const result = await route({
    tier: spec.tier,
    agentId: 'TRB',
    decisionId: { id: decision.id, tier: decision.tier },
    governance: true,
    system: spec.system,
    prompt,
    runId: null,
  });
  const parsed = parseAgentJson(result.text) ?? { error: 'unparseable', raw: result.text.slice(0, 500) };
  return { parsed, costUsd: result.costUsd, provider: result.provider };
}

/**
 * Run a T2-shaped mini-tribunal for a registered decision.
 * proposal: the option under consideration; critics: lenses (2-4).
 */
export async function runMiniTribunal(decisionId, { proposal, critics = DEFAULT_CRITICS } = {}) {
  const decision = getDecision(decisionId);
  if (!decision) throw new Error('decision not found');
  if (!['open', 'needs_evidence', 'expired'].includes(decision.status)) {
    throw new Error(`decision is ${decision.status}; tribunal runs on open cases`);
  }
  critics = critics.slice(0, 4);
  exec("UPDATE decisions SET status = 'deciding' WHERE id = ?", decisionId);
  audit({ actorType: 'system', actorId: 'tribunal', action: 'tribunal.opened', subjectType: 'decision', subjectId: decisionId, payload: { critics } });

  const isT3 = decision.tier === 'T3';
  let file = caseFile(decision);
  let validatorCost = 0;

  // Round 0 — Evidence Validator (mandatory for T3, Part 2 §7.2): only
  // verified entries are citable; gaps are declared, never papered over.
  if (isT3) {
    const validator = await tribunalCall('validator', 'evidence-validator', decision,
      `${file}\n\nValidate the evidence base for this case. Declare every gap explicitly.`);
    saveRound(decisionId, 0, 'validator', 'evidence-validator', validator.parsed, validator.costUsd);
    validatorCost = validator.costUsd;
    file += `\n\nEvidence Validator findings (authoritative for citations):\n${JSON.stringify(validator.parsed)}`;
  }

  // Round 1 — Advocate.
  const advocate = await tribunalCall('advocate', 'advocate', decision,
    `${file}\n\nProposal under consideration:\n${proposal || decision.title}\n\nArgue this proposal honestly.`);
  saveRound(decisionId, 1, 'advocate', 'advocate', advocate.parsed, advocate.costUsd);

  // Round 2 — Critics, blind and parallel. Each receives the case file and the
  // advocate brief; none receives a sibling's output. Isolation is asserted.
  const criticPrompt = (lens) =>
    `${file}\n\nAdvocate brief:\n${JSON.stringify(advocate.parsed)}\n\nYour assigned lens: ${lens}. ` +
    `Score the implicit options {conservative, balanced, innovative} 1-5 and raise objections. You have NOT seen any other critic's submission.`;
  const criticResults = await Promise.all(
    critics.map((lens) => tribunalCall('critic', `critic:${lens}`, decision, criticPrompt(lens))),
  );
  criticResults.forEach((c, i) => saveRound(decisionId, 2, 'critic', `critic:${critics[i]}`, c.parsed, c.costUsd));
  audit({ actorType: 'system', actorId: 'tribunal', action: 'tribunal.blind_isolation_asserted', subjectType: 'decision', subjectId: decisionId, payload: { critics: critics.length, mechanism: 'parallel-independent-calls' } });

  const blocked = criticResults.some((c) => c.parsed?.block === true);
  const criticsText = criticResults.map((c, i) => `[${critics[i]}] ${JSON.stringify(c.parsed)}`).join('\n');

  // Round 3 — Red-Team (T3 only): attack the leading option before judgment.
  let redteam = null;
  if (isT3) {
    redteam = await tribunalCall('redteam', 'red-team', decision,
      `${file}\n\nAdvocate:\n${JSON.stringify(advocate.parsed)}\n\nCritics:\n${criticsText}\n\nAttack the leading option with concrete production failure scenarios.`);
    saveRound(decisionId, 3, 'redteam', 'red-team', redteam.parsed, redteam.costUsd);
  }

  // Final round — Judge synthesis. Judges recommend; humans decide.
  const judge = await tribunalCall('judge', 'judge', decision,
    `${file}\n\nAdvocate:\n${JSON.stringify(advocate.parsed)}\n\nCritic submissions:\n${criticsText}` +
    (redteam ? `\n\nRed-Team failure case:\n${JSON.stringify(redteam.parsed)}` : '') +
    (blocked ? '\n\nNOTE: at least one critic BLOCKED — the outcome must be "escalated".' : '') +
    (isT3 ? '\n\nThis is a T3 case: regardless of consensus, a human decides — your output is a recommendation.' : '') +
    '\n\nConsolidate, dedupe objections, compute consensus, draft the decision record.');
  saveRound(decisionId, isT3 ? 4 : 3, 'judge', 'judge', judge.parsed, judge.costUsd);

  const totalCost = validatorCost + advocate.costUsd + criticResults.reduce((s, c) => s + c.costUsd, 0)
    + (redteam?.costUsd || 0) + judge.costUsd;
  const outcome = blocked ? 'escalated' : (judge.parsed?.outcome || 'escalated');
  const status = blocked || outcome === 'escalated' ? 'escalated'
    : outcome === 'approved' ? 'recommended'
    : outcome === 'approved_cond' ? 'recommended_cond'
    : outcome; // needs_evidence | rejected | deferred stand as-is (human still sees them)

  exec(
    `UPDATE decisions SET status = ?, outcome = ?, consensus_score = ?, confidence = ?, conditions = ?, dissent = ? WHERE id = ?`,
    status,
    JSON.stringify({ ...judge.parsed, totalCostUsd: totalCost, blocked }),
    judge.parsed?.consensusScore ?? null,
    judge.parsed?.confidence ?? null,
    JSON.stringify(judge.parsed?.conditions || []),
    JSON.stringify(judge.parsed?.dissent || []),
    decisionId,
  );
  audit({ actorType: 'system', actorId: 'tribunal', action: 'tribunal.closed', subjectType: 'decision', subjectId: decisionId, payload: { status, outcome, totalCostUsd: totalCost, blocked } });
  return getDecision(decisionId);
}
