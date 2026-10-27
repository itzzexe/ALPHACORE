// Local only — every subscription replaced by the model on this server.
//
// A fake Ollama on a loopback port answers with whichever model it was asked
// for, so each test can see which model really served the work: the author,
// the reviewer from another family, the two halves of the critical check, the
// operator on its morning round.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-localonly.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-localonly-memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 23).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-localonly.db${suffix}`)); } catch { /* first run */ }
}

const { one, q } = await import('../src/db.js');
const { seedAgents, enqueueRun, leaseNext, executeRun } = await import('../src/workflow.js');
const { setSetting, isProviderAvailable } = await import('../src/settings.js');
const { route, routePair, RouterExhausted, lineage } = await import('../src/router.js');
const localai = await import('../src/localai.js');

seedAgents();
const ME = 'human:owner';
const asked = [];
let proposals = [];
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    asked.push(body.model);
    const content = JSON.stringify({
      verdict: 'pass', findings: [], summary: `by ${body.model}`, answer: `by ${body.model}`, proposals, confidence: 0.9,
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { content }, eval_count: 5, eval_duration: 1e9, prompt_eval_count: 5, prompt_eval_duration: 1e8 }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

async function drain() {
  for (let i = 0; i < 40; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}

test('local only is refused when there is no local model to take over', () => {
  assert.throws(() => localai.configure({ localOnly: true, actor: ME }), /switch the local model on first/);
});

test('with local only on, no hosted provider is asked, whatever keys are saved', async () => {
  setSetting('ALPHACORE_MOCK', 'false');
  setSetting('ANTHROPIC_API_KEY', 'sk-test-not-real');
  setSetting('CLAUDE_CLI_ENABLED', 'true');
  setSetting('OLLAMA_BASE_URL', `http://127.0.0.1:${port}`);
  localai.configure({ enabled: true, localOnly: true, modelT3: 'qwen2.5:3b', modelT1: 'qwen2.5:3b', modelT2: 'qwen2.5:3b', actor: ME });
  assert.equal(isProviderAvailable('anthropic'), false);
  assert.equal(isProviderAvailable('claude-subscription'), false);
  assert.equal(isProviderAvailable('ollama'), true);
  for (const tier of ['T1', 'T2', 'T3']) {
    const r = await route({ tier, agentId: 'AGT-OPR-001', system: 's', prompt: 'p' });
    assert.equal(r.provider, 'ollama', `${tier} went to ${r.provider}`);
    assert.equal(r.family, 'local:qwen');
  }
  assert.deepEqual(localai.handover().hostedInUse, []);
  assert.ok(localai.handover().hostedConfigured.includes('anthropic'), 'the keys are kept, only unused');
});

test('a reviewer runs on a model from another family, so the review is a second opinion', async () => {
  assert.equal(lineage('llama3.2:3b'), 'llama');
  localai.configure({ reviewModel: 'llama3.2:3b', actor: ME });
  assert.equal(localai.handover().reviewIndependent, true);
  const id = enqueueRun({ agentId: 'AGT-REV-001', taskType: 'review:test', input: { prompt: 'Review this. Output JSON: {"verdict":"pass","findings":[]}' }, actor: ME });
  await drain();
  const run = one('SELECT provider, model, model_family FROM runs WHERE id = ?', id);
  assert.equal(run.model, 'llama3.2:3b');
  assert.equal(run.model_family, 'local:llama');
});

test('the critical cross-check needs two local families, and fails closed without them', async () => {
  asked.length = 0;
  const r = await routePair({ agentId: 'AGT-EXE-001', system: 's', prompt: 'Output JSON: {"verdict":""}' });
  assert.deepEqual(asked.sort(), ['llama3.2:3b', 'qwen2.5:3b']);
  assert.equal(r.agreement, true);
  localai.configure({ reviewModel: 'qwen2.5:1.5b', actor: ME });
  await assert.rejects(() => routePair({ agentId: 'AGT-EXE-001', system: 's', prompt: 'x' }), RouterExhausted);
  localai.configure({ reviewModel: 'llama3.2:3b', actor: ME });
});

test('on "propose" the morning round only advises; on "act" it files requests, as itself, up to the cap', async () => {
  proposals = [
    { title: 'Retry the failed brief', body: 'The daily brief failed twice.', department: 'research' },
    { title: 'Clear the approval queue', body: 'Three items are waiting.', department: 'ops' },
    { title: 'A third thing', body: 'Over the cap.', department: 'ops' },
  ];
  localai.configure({ operatorMode: 'propose', roundHour: 0, maxActionsDay: 2, actor: ME });
  localai.operatorTick();
  await drain();
  localai.syncAsks();
  assert.equal(one('SELECT COUNT(*) AS n FROM requests').n, 0, 'proposing filed something');

  // A new day for the round: the test forgets that one ran.
  q("UPDATE local_asks SET created_at = datetime('now','-1 day') WHERE created_by = 'system:operator'");
  localai.configure({ operatorMode: 'act', actor: ME });
  localai.ask({ question: 'round', actor: 'system:operator' });
  await drain();
  localai.syncAsks();
  const reqs = q('SELECT requester FROM requests');
  assert.equal(reqs.length, 2, 'the cap was not respected');
  assert.ok(reqs.every((r) => r.requester === 'agent:AGT-OPR-001'));
  const submitted = q("SELECT actor_type FROM audit_log WHERE action = 'request.submitted'");
  assert.ok(submitted.every((a) => a.actor_type === 'agent'), 'an employee’s request was recorded as a person’s');
  assert.equal(localai.operatorSettings().filedToday, 2);
});

test('a question a person asks gets proposals to file, never automatic requests', async () => {
  const before = one('SELECT COUNT(*) AS n FROM requests').n;
  localai.ask({ question: 'what should I do?', actor: ME });
  await drain();
  localai.syncAsks();
  assert.equal(one('SELECT COUNT(*) AS n FROM requests').n, before);
});

test('switching local only off brings the hosted providers back', () => {
  localai.configure({ localOnly: false, actor: ME });
  assert.equal(isProviderAvailable('anthropic'), true);
  setSetting('ANTHROPIC_API_KEY', '');
  setSetting('CLAUDE_CLI_ENABLED', '');
  setSetting('ALPHACORE_MOCK', 'true');
  server.close();
  fs.rmSync(path.join(root, 'data', 'test-localonly-memory'), { recursive: true, force: true });
});
