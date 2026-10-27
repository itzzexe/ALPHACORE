// The built-in engine and learning.
//
// No internet and no real model: a twenty-line script stands in for
// llama.cpp's server and a loopback HTTP server stands in for Ollama, so what
// is tested is what this code decides — how an archive is unpacked and what
// it refuses, how the engine is started, watched and restarted, which mistake
// becomes which lesson, what a guard stops, and when a model upgrade is
// allowed to happen and how it is undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-learning.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-learning-files/memory';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 17).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-learning.db${suffix}`)); } catch { /* first run */ }
}
const scratch = path.join(root, 'data', 'test-learning-files');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

const { one, q, exec } = await import('../src/db.js');
const { seedAgents, enqueueRun, leaseNext, executeRun } = await import('../src/workflow.js');
const { seedConnectors } = await import('../src/connectors/index.js');
const { verifyChain } = await import('../src/audit.js');
const { setSetting } = await import('../src/settings.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { unzip, untargz } = await import('../src/engine/archive.js');
const engine = await import('../src/engine.js');
const modelhub = (await import('../src/connectors/modelhub.js')).default;
const learning = await import('../src/learning.js');
const { recall, readPlaybook, ensurePlaybooks } = await import('../src/memory.js');
const { EXAM } = await import('../src/localeval.js');
const { route } = await import('../src/router.js');
const { sectionCatalog, connectivityAudit } = await import('../src/links.js');

seedAgents();
seedConnectors();
ensurePlaybooks();
const ME = 'human:owner';

async function drain() {
  for (let i = 0; i < 40; i++) {
    const run = leaseNext();
    if (!run) return;
    await executeRun(run);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); }
  return false;
}

// ---------------------------------------------------------------- archive --

/** A zip writer just big enough to test the reader with. */
function makeZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content, deflate] of entries) {
    const data = Buffer.from(content);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE((0o100755 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function makeTarGz(files) {
  const blocks = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0); h.write('0000755\0', 100); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('0', 156); h.write('ustar\0', 257);
    h.fill(' ', 148, 156);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

test('the engine archive is unpacked from a zip or a tar.gz, with nothing but zlib', () => {
  const out = path.join(scratch, 'zip');
  const written = unzip(makeZip([['build/bin/llama-server', '#!/bin/sh\necho hi\n', true], ['build/bin/README.txt', 'plain', false]]), out);
  assert.equal(written.length, 2);
  assert.equal(fs.readFileSync(path.join(out, 'build/bin/README.txt'), 'utf8'), 'plain');
  assert.match(fs.readFileSync(path.join(out, 'build/bin/llama-server'), 'utf8'), /echo hi/);
  const tgz = path.join(scratch, 'tgz');
  untargz(makeTarGz([['llama/llama-server', 'binary'], ['llama/lib.so', 'lib']]), tgz);
  assert.equal(fs.readFileSync(path.join(tgz, 'llama/lib.so'), 'utf8'), 'lib');
});

test('an archive entry that climbs out of its folder is refused before anything is written', () => {
  const out = path.join(scratch, 'slip');
  assert.throws(() => unzip(makeZip([['../../escaped.txt', 'x', false]]), out), /escapes/);
  assert.throws(() => unzip(makeZip([['/etc/passwd', 'x', false]]), out), /escapes/);
  assert.ok(!fs.existsSync(path.join(scratch, '..', 'escaped.txt')));
});

// ----------------------------------------------------------------- engine --

test('the engine knows which build fits, and how it will be started', () => {
  assert.ok(engine.assetPattern('linux', 'x64').test('llama-b6000-bin-ubuntu-x64.zip'));
  assert.ok(engine.assetPattern('win32', 'x64').test('llama-b6000-bin-win-cpu-x64.zip'));
  assert.ok(!engine.assetPattern('win32', 'x64').test('llama-b6000-bin-win-cuda-12.4-x64.zip'), 'the CPU build, not a GPU one');
  assert.equal(engine.assetPattern('sunos', 'sparc'), null);
  const args = engine.serverArgs({ file: '/m.gguf' });
  assert.deepEqual(args.slice(0, 6), ['-m', '/m.gguf', '--host', '127.0.0.1', '--port', '8090']);
  assert.ok(engine.serverArgs({ file: '/e.gguf', role: 'embed' }).includes('--embedding'));
});

test('models come from Hugging Face, land in the engine folder, and only a person asks for them', async () => {
  assert.throws(() => engine.downloadModel({ url: 'https://example.com/x.gguf', actor: ME }), /huggingface/);
  assert.throws(() => engine.downloadModel({ url: 'https://huggingface.co/a/b/resolve/main/readme.md', actor: ME }), /gguf/);
  assert.throws(() => engine.downloadModel({ name: 'qwen2.5-3b-instruct-q4_k_m', actor: 'agent:AGT-OPR-001' }), /a person/);
  const fetchFile = modelhub.ops['file.fetch'].run;
  await assert.rejects(() => fetchFile({ url: 'https://evil.example/x.gguf', dest: path.join(root, 'workspace', '_engine', 'models', 'x.gguf') }), /not a model source/);
  await assert.rejects(() => fetchFile({ url: 'https://huggingface.co/x.gguf', dest: path.join(root, 'data', 'x.gguf') }), /engine folder/);
});

// A stand-in for llama.cpp's server: the same endpoints, the same port flag.
const FAKE = `import http from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end('{"status":"ok"}');
    if (req.url === '/v1/embeddings') return res.end(JSON.stringify({ data: [{ embedding: [0.6, 0.8] }] }));
    if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ answer: 'from the engine', proposals: [], confidence: 0.9 }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 }, timings: { predicted_per_second: 9.5, prompt_per_second: 40 },
    }));
    res.statusCode = 404; res.end('{}');
  });
}).listen(port, '127.0.0.1');
`;

test('the engine starts a model, answers through the router, and is restarted when it dies', async () => {
  const fake = path.join(scratch, 'fake-llama.mjs');
  fs.writeFileSync(fake, FAKE);
  const gguf = path.join(scratch, 'tiny.gguf');
  fs.writeFileSync(gguf, 'GGUF');
  exec("INSERT INTO engine_models (name, url, file, role, state, size, received, created_by) VALUES ('tiny', 'https://huggingface.co/x/tiny.gguf', ?, 'chat', 'ready', 4, 4, ?)", gguf, ME);
  engine.start({ name: 'tiny', actor: ME, launcher: [process.execPath, fake] });
  assert.ok(await until(() => engine.status().chat?.state === 'ready'), `the engine never came up: ${JSON.stringify(engine.status().chat)}`);

  setSetting('ALPHACORE_MOCK', 'false');
  setSetting('LOCAL_FIRST', 'true');
  try {
    const r = await route({ tier: 'T2', agentId: 'AGT-OPR-001', system: 's', prompt: 'hello' });
    assert.equal(r.provider, 'engine');
    assert.match(r.text, /from the engine/);

    // Kill it the way an out-of-memory kill would; supervision brings it back.
    const before = engine.status().chat.restarts;
    process.kill(engine.status().chat.pid, 'SIGKILL');
    assert.ok(await until(() => engine.status().chat?.restarts > before && engine.status().chat?.state === 'ready', 15000), 'not restarted');
  } finally {
    setSetting('LOCAL_FIRST', '');
    setSetting('ALPHACORE_MOCK', 'true');
    engine.stopAll();
    setSetting('ENGINE_ENABLED', '');
  }
});

// ----------------------------------------------------------------- guards --

test('a guard stops a known mistake at a person, and the employee is told why', async () => {
  learning.seedGuards();
  assert.equal(one("SELECT COUNT(*) AS n FROM learn_guards WHERE agent_id = 'AGT-INV-001'").n, 1);
  // Mock answers always say [mock]; a guard against it trips every time.
  const g = learning.addGuard({ agentId: 'AGT-NEWS-001', pattern: '\\[mock\\]', why: 'test: no placeholder text', actor: ME });
  const runId = enqueueRun({ agentId: 'AGT-NEWS-001', taskType: 'news-digest:test', input: { prompt: '[NEWS-DIGEST] Write the brief.\n- [1] Something (Wire)' }, actor: ME });
  await drain();
  const run = one('SELECT state, failure_reason, flags FROM runs WHERE id = ?', runId);
  assert.equal(run.state, 'awaiting_human');
  assert.match(run.failure_reason, /repeat of a known mistake/);
  assert.match(run.flags, /guard-tripped/);
  assert.equal(one('SELECT hits FROM learn_guards WHERE id = ?', g.id).hits, 1);
  learning.harvest();
  assert.ok(one("SELECT id FROM mem_docs WHERE kind = 'lesson' AND agent_id = 'AGT-NEWS-001' AND source_type = 'learn:guard'"), 'the employee was not told');
  learning.setGuard({ id: g.id, state: 'off', actor: ME });
  assert.throws(() => learning.addGuard({ pattern: '(', why: 'broken', actor: ME }), /regular expression/);
});

// ---------------------------------------------------------------- lessons --

test('what went wrong becomes a lesson once, and the employee recalls it', () => {
  exec("INSERT INTO pf_accounts (name, kind, cash, start_cash, created_by) VALUES ('Paper', 'paper', 1000, 1000, ?)", ME);
  const acc = one('SELECT id FROM pf_accounts').id;
  exec(`INSERT INTO pf_orders (account_id, symbol, side, qty, proposed_by, state, decided_by, decision_note)
        VALUES (?, 'TSLA', 'buy', 5, 'agent:AGT-INV-001', 'rejected', ?, 'too concentrated in one name')`, acc, ME);
  for (let i = 0; i < 12; i++) {
    exec(`INSERT INTO mkt_forecasts (symbol, made_on, horizon_days, method, base_price, expected, due_on, actual, hit_direction, inside80)
          VALUES ('NVDA', ?, 5, 'test', 100, 101, '2026-01-01', 99, 0, 0)`, `2026-01-${String(i + 1).padStart(2, '0')}`);
  }
  const made = learning.harvest();
  assert.ok(made >= 3, `made ${made}`);
  assert.equal(learning.harvest(), 0, 'a lesson is written once');
  const mem = recall('AGT-INV-001', 'propose a trade in TSLA');
  assert.match(mem, /too concentrated/);
  assert.match(recall('AGT-INV-001', 'forecast for NVDA'), /worse than a coin/);
});

test('a person’s correction is verified on the spot, goes into the playbook, and can carry a guard', async () => {
  const ask = enqueueRun({ agentId: 'AGT-OPR-001', taskType: 'local-ask:1', input: { prompt: '[LOCAL-ASK] what is waiting?' }, actor: ME });
  exec("INSERT INTO local_asks (question, run_id, state, created_by) VALUES ('what is waiting?', ?, 'answered', ?)", ask, ME);
  const id = one('SELECT id FROM local_asks ORDER BY id DESC LIMIT 1').id;
  assert.throws(() => learning.correct({ subjectType: 'local_ask', subjectId: id, correction: 'x x x x', actor: 'agent:AGT-OPR-001' }), /a person/);
  const r = learning.correct({ subjectType: 'local_ask', subjectId: id, correction: 'Orders waiting for approval come first, always.', guard: { pattern: 'no orders are waiting' }, actor: ME });
  assert.equal(one('SELECT verification FROM mem_docs WHERE id = ?', r.lesson).verification, 'verified');
  assert.match(readPlaybook('AGT-OPR-001'), /Orders waiting for approval come first/);
  assert.equal(r.guard.agent_id, 'AGT-OPR-001');
});

// --------------------------------------------------------------- research --

test('trust starts from the source, and a note the writer was unsure of waits for a person', async () => {
  assert.equal(learning.domainTrust('en.wikipedia.org'), 0.7);
  assert.equal(learning.domainTrust('www.reuters.com'), 0.8);
  assert.equal(learning.domainTrust('random-blog.example'), 0.4);

  const topic = learning.addTopic({ topic: 'Small language models', actor: ME });
  assert.throws(() => learning.addTopic({ topic: 'Small language models', actor: ME }), /already/);
  const runId = enqueueRun({ agentId: 'AGT-RES-001', taskType: `learn-note:${topic.id}`, actor: 'system:learning',
    input: { prompt: '[LEARN-NOTE] Write a research note about: Small language models\n\nSOURCE 1: Small language model (https://en.wikipedia.org/wiki/SLM)\nA small language model has fewer parameters. It runs on modest hardware.\n\nOutput JSON: {"summary":"","claims":[],"confidence":0.0}' } });
  exec("INSERT INTO learn_notes (topic_id, run_id, sources) VALUES (?, ?, ?)", topic.id, runId, JSON.stringify([{ url: 'https://en.wikipedia.org/wiki/SLM', title: 'SLM', domain: 'en.wikipedia.org', trust: 0.7 }]));
  await drain();
  learning.syncNotes();
  const n = one('SELECT * FROM learn_notes WHERE run_id = ?', runId);
  assert.equal(n.state, 'pending', 'a low-confidence note became knowledge on its own');
  assert.ok(n.trust < 0.55);
  learning.accept({ id: n.id, actor: ME });
  const mem = one("SELECT * FROM mem_docs WHERE source_type = 'learn_note' AND source_id = ?", String(n.id));
  assert.equal(mem.verification, 'verified');
  assert.match(mem.title, /web · en\.wikipedia\.org · trust/);
  learning.reject({ id: n.id, actor: ME });
  assert.equal(one('SELECT verification FROM mem_docs WHERE id = ?', mem.id).verification, 'retracted');
});

test('research refuses to run with web reading off, and reading needs a person to switch it on', async () => {
  const t = one('SELECT id FROM learn_topics LIMIT 1');
  await assert.rejects(() => learning.research(t.id), /web reading is off/);
  assert.throws(() => learning.enableWeb({ actor: 'agent:AGT-RES-001' }), /a person/);
});

// --------------------------------------------------------------- upgrades --

/** The right answer to each exam question, for the fake "good" model. */
function goodAnswer(prompt) {
  const p = String(prompt);
  if (p.includes('17 + 25')) return { sum: 42 };
  if (p.includes('عاصمة العراق')) return { answer: 'بغداد' };
  if (p.includes('Invoice 4471')) return { invoice: '4471', vendor: 'Acme Ltd', total: 1250.5, due: '2026-11-30' };
  if (p.includes('plunged')) return { tone: 'negative' };
  if (p.includes('10 shares at 230')) return { total: 2900 };
  if (p.includes('closing price of AAPL')) return { answer: 'I do not know', known: false };
  if (p.includes('primary colours')) return { items: ['red', 'green', 'blue'] };
  if (p.includes('لخّص')) return { summary: 'ارتفعت الأسهم رغم التحذير من تباطؤ المبيعات.' };
  if (p.includes('"invoice" into Arabic')) return { arabic: 'فاتورة' };
  if (p.includes('2026-10-23')) return { date: '2026-11-02' };
  return {};
}

test('a newer model is promoted only when it does better on the exam, and rolled back by a person', async () => {
  assert.equal(EXAM.length, 10);
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const prompt = body.messages?.at(-1)?.content || '';
      const answer = body.model === 'good:1b' ? goodAnswer(prompt) : { sum: 1 };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ message: { content: JSON.stringify(answer) }, eval_count: 10, eval_duration: 1e9, prompt_eval_count: 5, prompt_eval_duration: 1e8 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  setSetting('OLLAMA_BASE_URL', `http://127.0.0.1:${server.address().port}`);
  setSetting('LOCAL_RUNTIME', 'ollama');
  setSetting('LOCAL_MODEL_T2', 'bad:1b');
  try {
    assert.throws(() => learning.setAutoUpgrade({ enabled: true, actor: 'system:learning' }), /a person/);
    learning.setAutoUpgrade({ enabled: true, candidates: ['good:1b'], actor: ME });
    const r = await learning.upgradeCheck({ actor: 'system:learning' });
    assert.equal(r.promoted, 'good:1b');
    assert.equal(learning.incumbent().model, 'good:1b');
    const ev = q("SELECT model, passed FROM learn_evals ORDER BY id");
    assert.equal(ev.find((e) => e.model === 'good:1b').passed, 10);
    assert.ok(ev.find((e) => e.model === 'bad:1b').passed <= 1);

    // Now the incumbent is the good one: the bad one must not win it back.
    learning.setAutoUpgrade({ enabled: true, candidates: ['bad:1b'], actor: ME });
    const again = await learning.upgradeCheck({ actor: 'system:learning' });
    assert.equal(again.kept, 'good:1b');

    const up = one("SELECT id FROM learn_upgrades WHERE state = 'promoted'");
    assert.throws(() => learning.rollback({ id: up.id, actor: 'system:learning' }), /a person/);
    learning.rollback({ id: up.id, actor: ME });
    assert.equal(learning.incumbent().model, 'bad:1b');
    assert.ok(q("SELECT action FROM audit_log WHERE action = 'learning.model_promoted'").length === 1);
  } finally {
    setSetting('LOCAL_RUNTIME', '');
    server.close();
  }
});

test('better means better: a higher score, or the same score a fifth faster, never under half the speed', () => {
  assert.equal(learning.better({ score: 0.8, tokPerSec: 5 }, { score: 0.7, tokPerSec: 5 }), true);
  assert.equal(learning.better({ score: 0.8, tokPerSec: 2 }, { score: 0.7, tokPerSec: 5 }), false, 'too slow to be worth it');
  assert.equal(learning.better({ score: 0.7, tokPerSec: 6.5 }, { score: 0.7, tokPerSec: 5 }), true);
  assert.equal(learning.better({ score: 0.7, tokPerSec: 5.5 }, { score: 0.7, tokPerSec: 5 }), false);
});

// ----------------------------------------------------------- the company --

test('learning is in the catalogue, joined to memory, and replacing the model is one template’s power', () => {
  assert.ok(sectionCatalog().some((s) => s.id === 'learning'));
  const c = connectivityAudit();
  assert.ok(!c.orphans.some((o) => o.id === 'learning'));
  assert.deepEqual(c.dangling, []);
  for (const p of ['learning.view', 'learning.manage', 'learning.upgrade']) assert.ok(PERMS.includes(p));
  const holders = ['observer', 'approver', 'operator', 'finance', 'security', 'marketing', 'engineering', 'platform'].filter((r) => expandTemplate(r).includes('learning.upgrade'));
  assert.deepEqual(holders, ['platform']);
});

test('the chain verifies after all of it', () => {
  assert.equal(verifyChain().ok, true);
  fs.rmSync(scratch, { recursive: true, force: true });
});
