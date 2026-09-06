// The consultant, and the silence it was hired to end.
//
// Two things are proved here, and the first is the bug that started it: a run
// that stops at the human gate — the budget hard-stop and the exhausted
// router both do, with a reason and no output — used to reach the floor as
// "(no answer)". A person reading a chat window cannot act on that. Now the
// channel says which of the two happened and where the fix is.
//
// The second is the employee itself: pinned to DeepSeek's wire format (served
// here by a stub, so the path is real without a key), free of the JSON
// contract every other employee answers in, and free of subject scope. What
// it is not free of is checked too — the audit chain records its run, its key
// is never echoed back, and it holds no gateway tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_DB = 'data/test-oracle.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 61).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-oracle.db${suffix}`)); } catch { /* first run */ }
}

// A stand-in for api.deepseek.com, speaking the same wire format. It records
// what it was sent, which is how the system prompt and the pin are checked.
const seen = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const sent = JSON.parse(body || '{}');
    seen.push({ url: req.url, auth: req.headers.authorization, model: sent.model, messages: sent.messages });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: 'الجواب: نعم، وهذه هي الأسباب الثلاثة.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubUrl = `http://127.0.0.1:${stub.address().port}/v1`;

const { one, q, exec } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
const { seedAgents, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { ensureChannels, post, syncChat } = await import('../src/chat.js');
const { seedOracle, setOracle, oracleSettings, ORACLE_ID, DEFAULT_PERSONA } = await import('../src/oracle.js');

seedAgents();
seedConstitution();
ensureChannels();
seedOracle();
const CHANNEL = one('SELECT id FROM chat_channels LIMIT 1').id;
const drain = async () => { let r; while ((r = leaseNext())) await executeRun(r); await syncChat(); };
const lastAgentMessage = () => one("SELECT * FROM chat_messages WHERE author_kind = 'agent' ORDER BY id DESC LIMIT 1");

test.after(() => stub.close());

// --- the silence -------------------------------------------------------------

test('a run stopped at the gate says which wall it hit, never "(no answer)"', async () => {
  const other = one("SELECT id FROM agents WHERE id != ? AND status = 'active' ORDER BY id LIMIT 1", ORACLE_ID).id;
  post({ channelId: CHANNEL, body: `@${other} are we on track?`, actor: 'human:zaid' });
  await drain();
  const msg = lastAgentMessage();
  const run = one('SELECT id FROM runs WHERE id = ?', msg.run_id);
  assert.ok(run, 'the question produced a run');

  for (const [reason, expect] of [
    ['router exhausted (stop-human): Router exhausted for T2 (stop-human); tried: nothing eligible', /no model provider is available/i],
    ['budget hard-stop: company monthly cap reached', /spending cap/i],
  ]) {
    exec("UPDATE runs SET state = 'awaiting_human', output = NULL, failure_reason = ? WHERE id = ?", reason, run.id);
    exec("UPDATE chat_messages SET state = 'thinking' WHERE id = ?", msg.id);
    await syncChat();
    const after = one('SELECT body, state FROM chat_messages WHERE id = ?', msg.id);
    assert.match(after.body, expect);
    assert.ok(!/no answer/i.test(after.body), `the channel still says "no answer": ${after.body}`);
    assert.ok(/settings|budget/i.test(after.body), 'a stopped run names where the fix is');
  }
});

test('a reply that arrives in the role\'s own shape is read, not pasted as JSON', async () => {
  const other = one("SELECT id FROM agents WHERE id != ? AND status = 'active' ORDER BY id LIMIT 1", ORACLE_ID).id;
  post({ channelId: CHANNEL, body: `@${other} status?`, actor: 'human:zaid' });
  await drain();
  const msg = lastAgentMessage();
  // What a model does when it obeys its role prompt instead of the chat one.
  exec("UPDATE runs SET state = 'done', failure_reason = NULL, output = ? WHERE id = ?",
    JSON.stringify({ raw: '{"summary":"Two things are late and one is blocked."}', parsed: { summary: 'Two things are late and one is blocked.' } }), msg.run_id);
  exec("UPDATE chat_messages SET state = 'thinking' WHERE id = ?", msg.id);
  await syncChat();
  const after = one('SELECT body FROM chat_messages WHERE id = ?', msg.id);
  assert.equal(after.body, 'Two things are late and one is blocked.');
  assert.ok(!after.body.includes('{'), 'a serialised object reached the channel');
});

// --- the employee ------------------------------------------------------------

test('it is hired from settings, pinned to DeepSeek, and its key is never echoed back', () => {
  const before = oracleSettings();
  assert.equal(before.enabled, false);
  assert.equal(one('SELECT status FROM agents WHERE id = ?', ORACLE_ID).status, 'paused', 'unhired means paused, not missing');

  // The address is a setting too: a mirror or a company proxy in front of the
  // same wire format. Here it points at the stub, which is what makes the
  // whole path testable without a key.
  assert.throws(() => setOracle({ baseUrl: 'not a url', actor: 'human:zaid' }), /not a URL/);
  assert.throws(() => setOracle({ baseUrl: 'ftp://example.test/v1', actor: 'human:zaid' }), /http or https/);
  const after = setOracle({ enabled: true, model: 'deepseek-chat', apiKey: 'sk-secret-value-1234', baseUrl: `${stubUrl}/`, actor: 'human:zaid' });
  assert.equal(after.baseUrl, stubUrl, 'a trailing slash is trimmed rather than sent as a double slash');
  assert.equal(after.baseUrlOverridden, true);
  assert.equal(after.ready, true);
  assert.equal(after.keyTail, '1234');
  assert.ok(!JSON.stringify(after).includes('sk-secret-value-1234'), 'the key came back to the screen');
  assert.equal(one('SELECT status FROM agents WHERE id = ?', ORACLE_ID).status, 'active');

  const spec = JSON.parse(one('SELECT spec FROM agents WHERE id = ?', ORACLE_ID).spec);
  assert.deepEqual(spec.chain, [{ provider: 'deepseek', model: 'deepseek-chat' }], 'it must use the key that was pasted, not the tier chain');
  assert.equal(spec.freeform, true);
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'oracle.configured'"), 'hiring is on the chain');
  assert.ok(!q("SELECT payload FROM audit_log WHERE action = 'oracle.configured'").some((r) => String(r.payload).includes('sk-secret')), 'the key reached the chain');
});

test('it answers in prose, in the language it was asked in, with no schema to fail', async () => {
  seen.length = 0;
  post({ channelId: CHANNEL, body: `@${ORACLE_ID} اشرح لي شنو يعني اعتماد مستندي؟`, actor: 'human:zaid' });
  await drain();

  const msg = lastAgentMessage();
  assert.equal(msg.author_id, ORACLE_ID);
  assert.equal(msg.state, 'sent');
  assert.equal(msg.body, 'الجواب: نعم، وهذه هي الأسباب الثلاثة.', 'the prose is the reply, verbatim');

  const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', msg.run_id);
  assert.equal(run.state, 'done', 'prose is this employee\'s shape — it must not stop at the gate as a schema failure');
  assert.equal(JSON.parse(run.output).parsed, null);
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'run.done' AND actor_id = ?", ORACLE_ID), 'its work is on the chain like anybody else\'s');

  // The call itself: the pinned model, the key, and a system prompt with no
  // output schema in it.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'deepseek-chat');
  assert.equal(seen[0].auth, 'Bearer sk-secret-value-1234');
  const system = seen[0].messages.find((x) => x.role === 'system').content;
  assert.ok(!/Output JSON/i.test(system), 'the consultant was handed an output schema');
  assert.match(system, /any subject is in scope/i);
  const user = seen[0].messages.find((x) => x.role === 'user').content;
  assert.ok(!/Reply as JSON/i.test(user), 'the consultant was asked for an envelope');
  assert.match(user, /اعتماد مستندي/);
});

test('it can be pinned to any provider and any model name, including one on this machine', async () => {
  const s = oracleSettings();
  assert.ok(s.providers.length >= 5, 'the panel offers every provider the router can call');
  assert.ok(s.providers.some((p) => p.local && p.name === 'ollama'), 'a model on this machine must be one of them');
  assert.throws(() => setOracle({ provider: 'nonesuch', actor: 'human:zaid' }), /unknown provider/);

  // A local model is switched on rather than authenticated, takes whatever
  // name was pulled, and is cleared for every sensitivity level because
  // nothing leaves the building to reach it.
  const local = setOracle({ provider: 'ollama', model: 'dolphin-mixtral:8x7b', apiKey: 'true', actor: 'human:zaid' });
  assert.equal(local.provider, 'ollama');
  assert.equal(local.model, 'dolphin-mixtral:8x7b', 'a model name this list never heard of is still accepted');
  assert.equal(local.isFlag, true);
  assert.equal(local.keyConfigured, true);
  assert.equal(local.ready, true);
  const spec = JSON.parse(one('SELECT spec FROM agents WHERE id = ?', ORACLE_ID).spec);
  assert.deepEqual(spec.chain, [{ provider: 'ollama', model: 'dolphin-mixtral:8x7b' }]);
  assert.equal(spec.sensitivity, 'restricted', 'a local model may see anything — it is the only provider cleared for it');

  // A provider that pins its own ids is held to them.
  assert.throws(() => setOracle({ provider: 'anthropic', model: 'not-a-real-model', actor: 'human:zaid' }), /no model called/);

  // Back to the hosted default for the rest of the file, and moving provider
  // must not carry a model name that belonged to the old one.
  const back = setOracle({ provider: 'deepseek', actor: 'human:zaid' });
  assert.equal(back.model, 'deepseek-chat');
  assert.equal(JSON.parse(one('SELECT spec FROM agents WHERE id = ?', ORACLE_ID).spec).sensitivity, 'internal');
  setOracle({ apiKey: 'sk-secret-value-1234', actor: 'human:zaid' });
  setSetting('DEEPSEEK_BASE_URL', stubUrl);
});

test('the default prompt can be restored, and the persona is what is actually sent', async () => {
  setOracle({ persona: 'You answer only in haiku.', actor: 'human:zaid' });
  assert.match(JSON.parse(one('SELECT spec FROM agents WHERE id = ?', ORACLE_ID).spec).system, /haiku/);
  seen.length = 0;
  post({ channelId: CHANNEL, body: `@${ORACLE_ID} hello`, actor: 'human:zaid' });
  await drain();
  assert.match(seen[0].messages.find((x) => x.role === 'system').content, /haiku/, 'the edited prompt is what the model receives');

  setOracle({ persona: '', actor: 'human:zaid' });
  assert.equal(oracleSettings().persona, DEFAULT_PERSONA);
});

test('it holds no tools: it may say anything and do nothing', async () => {
  const { allowedActions } = await import('../src/chat.js');
  assert.equal(allowedActions(ORACLE_ID).length, 0, 'the consultant was given actions from chat');
  // Its role group would otherwise earn several — the emptiness is the rule,
  // not an accident of which group it happens to sit in.
  const peer = one("SELECT id FROM agents WHERE role_group = 'steer' AND id != ? AND status = 'active' ORDER BY id LIMIT 1", ORACLE_ID);
  if (peer) assert.ok(allowedActions(peer.id).length > 0, 'the control is wrong: steer agents have no actions either');
  assert.equal(q("SELECT seq FROM audit_log WHERE actor_id = ? AND action = 'chat.acted'", ORACLE_ID).length, 0, 'the consultant took an action');
});
