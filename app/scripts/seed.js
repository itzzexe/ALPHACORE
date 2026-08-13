// Demo seed — populates the platform with sample activity so the dashboard is
// alive on first open. All content is clearly marked as sample data. Safe to
// run repeatedly (it appends new runs/decisions each time).
//
// Mock mode is forced BEFORE any module import (imports are hoisted in ESM,
// so these must be dynamic): the seed never spends real money, even when
// provider keys exist in the environment.
process.env.ALPHACORE_MOCK = 'true';

const { seedAgents, enqueueRun, leaseNext, executeRun } = await import('../src/workflow.js');
const { createDecision, addEvidence, verifyEvidence, getDecision } = await import('../src/registry.js');
const { runMiniTribunal } = await import('../src/tribunal.js');

seedAgents();
console.log('Agents seeded.');

const tasks = [
  ['AGT-DOC-001', 'release-note', 'Draft the release note for AlphaCore v0.1.'],
  ['AGT-RES-001', 'market-scan', 'Scan the renewal-tracking tool space for small MSPs; tag every claim.'],
  ['AGT-QA-001', 'qa-report', 'Verify the acceptance criteria for the run-queue feature.'],
  ['AGT-REV-001', 'code-review', 'Review the budget-reservation diff against the policy spec.'],
  ['AGT-SUP-001', 'ticket', 'Customer asks how to export their renewal data. Draft a reply.'],
  ['AGT-CST-001', 'spend-check', 'Analyze this week’s spend rollup for anomalies.'],
];
for (const [agentId, taskType, prompt] of tasks) {
  enqueueRun({ agentId, taskType, input: { prompt: `[sample] ${prompt}` }, actor: 'system:seed' });
}
let run;
while ((run = leaseNext())) await executeRun(run);
console.log(`Executed ${tasks.length} sample runs.`);

const d = createDecision({
  title: '[sample] Managed auth provider vs building auth for Product 1',
  tier: 'T2', owner: 'CTO',
  context: 'Product 1 needs authentication before beta. Build minimal email+password, adopt a managed provider, or go passwordless-only.',
  expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  actor: 'human:seed',
});
addEvidence(d.id, { claim: '[sample] Provider pricing page reviewed — free tier to 7,500 MAU', sourceRef: 'https://example.com/pricing', addedBy: 'human:CTO' });
addEvidence(d.id, { claim: '[sample] OWASP auth guidance favors managed providers at this team size', sourceRef: 'https://owasp.org', addedBy: 'agent:AGT-RES-001' });
const ev = getDecision(d.id).evidence[0];
verifyEvidence(ev.id, 'human:CTO');
await runMiniTribunal(d.id, { proposal: 'Adopt a managed auth provider with a documented exit path.', critics: ['security', 'cost', 'architecture'] });
console.log(`Tribunal complete on ${d.id}.`);
console.log('Seed done — open the dashboard.');
