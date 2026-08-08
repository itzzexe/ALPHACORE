// Smoke tests — run against a throwaway DB in mock mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolate: force mock mode and a fresh database before importing modules.
// The database is named explicitly rather than defaulted, because this file
// deletes it — and the default is the running company.
process.env.CRUCIBLE_MOCK = 'true';
process.env.CRUCIBLE_DB = 'data/test.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'data', 'test.db');
try { fs.rmSync(dbFile); } catch { /* first run */ }
try { fs.rmSync(dbFile + '-wal'); } catch { /* ok */ }
try { fs.rmSync(dbFile + '-shm'); } catch { /* ok */ }

const { audit, verifyChain } = await import('../src/audit.js');
const { reserve, settle, BudgetExceeded } = await import('../src/policy.js');
const { seedAgents, enqueueRun, leaseNext, executeRun } = await import('../src/workflow.js');
const { createDecision, addEvidence, verifyEvidence, getDecision } = await import('../src/registry.js');
const { runMiniTribunal } = await import('../src/tribunal.js');
const { one } = await import('../src/db.js');

test('audit chain is append-only and verifiable', () => {
  audit({ actorType: 'system', actorId: 'test', action: 'test.one' });
  audit({ actorType: 'system', actorId: 'test', action: 'test.two', payload: { a: 1 } });
  const v = verifyChain();
  assert.equal(v.ok, true);
  assert.ok(v.checked >= 2);
});

test('budget reservation blocks over-cap spend before the call', () => {
  // Cost Sentinel daily cap is $5; a $10 reservation must hard-stop.
  assert.throws(() => reserve({ agentId: 'AGT-CST-001', estUsd: 10 }), BudgetExceeded);
  const r = reserve({ agentId: 'AGT-CST-001', estUsd: 0.4 });
  settle(r, 0.1);
  const row = one("SELECT * FROM budgets WHERE scope='agent' AND scope_id='AGT-CST-001'");
  assert.ok(Math.abs(row.spent_usd - 0.1) < 1e-9);
  assert.equal(row.reserved_usd, 0);
});

test('run lifecycle: enqueue → lease → execute (mock) → done', async () => {
  seedAgents();
  const id = enqueueRun({ agentId: 'AGT-DOC-001', taskType: 'draft', input: { prompt: 'Draft a release note for v0.1.' } });
  const leased = leaseNext();
  assert.equal(leased.id, id);
  const done = await executeRun(leased);
  assert.equal(done.state, 'done');
  const output = JSON.parse(done.output);
  assert.ok(output.parsed.confidence >= 0.7);
});

test('reviewer family separation is enforced in config', async () => {
  const spec = one("SELECT spec FROM agents WHERE id = 'AGT-REV-001'");
  assert.equal(JSON.parse(spec.spec).familyNot, 'anthropic');
});

test('mini-tribunal: blind critics, judge recommendation, human still decides', async () => {
  const d = createDecision({ title: 'Managed auth provider vs building auth', tier: 'T2', owner: 'CTO', context: 'Product 1 needs authentication.' });
  addEvidence(d.id, { claim: 'Provider pricing page reviewed', sourceRef: 'https://example.com/pricing', addedBy: 'human:CTO' });
  const ev = getDecision(d.id).evidence[0];
  verifyEvidence(ev.id, 'human:CTO');
  const result = await runMiniTribunal(d.id, { proposal: 'Adopt a managed auth provider', critics: ['security', 'cost'] });
  assert.ok(result.rounds.length >= 4); // advocate + 2 critics + judge
  assert.ok(['recommended', 'recommended_cond', 'escalated', 'needs_evidence', 'rejected', 'deferred'].includes(result.status));
  // Tribunal spend drew from the governance pool.
  const gov = one("SELECT * FROM budgets WHERE scope = 'governance'");
  assert.ok(gov, 'governance budget row exists');
});
