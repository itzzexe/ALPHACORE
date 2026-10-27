// Set up the built-in engine from a terminal — for a server with no browser
// open yet, which is every server on the day it is installed.
//
//   node --experimental-sqlite scripts/engine-setup.mjs [model ...]
//   node --experimental-sqlite scripts/engine-setup.mjs qwen2.5-3b-instruct-q4_k_m nomic-embed-text-v1.5-q8_0
//
// Does what the Local AI page does — downloads llama.cpp for this machine and
// the named models through the egress gate — and records the person at the
// keyboard as `human:console`, the same actor the other operator scripts use.
// The first chat model and the first embedding model named become the ones
// the server starts at boot.
const { status, installBinary, downloadModel, GGUF } = await import('../src/engine.js');
const { one } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');

const actor = 'human:console';
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen2.5-3b-instruct-q4_k_m', 'nomic-embed-text-v1.5-q8_0'];
const say = (s) => process.stdout.write(`${s}\n`);

if (!status().binary) {
  say('Installing the engine (llama.cpp) for this machine…');
  const r = await installBinary({ actor });
  say(`  ${r.version} → ${r.binary}`);
} else {
  say(`Engine already installed: ${status().binary}`);
}

for (const name of names) {
  const known = GGUF.find((g) => g.name === name);
  const row = one('SELECT state FROM engine_models WHERE name = ?', name);
  if (row?.state === 'ready') { say(`${name}: already here`); continue; }
  say(`Downloading ${name}${known ? ` (${known.sizeGb} GB)` : ''}…`);
  downloadModel(known ? { name, actor } : { url: name, actor });
  let last = -1;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const m = one('SELECT state, received, size, detail FROM engine_models WHERE name = ? OR url = ?', name, name);
    if (m.state === 'failed') { say(`  failed: ${m.detail}`); process.exit(1); }
    const pct = m.size ? Math.floor((m.received / m.size) * 100) : 0;
    if (pct !== last && pct % 10 === 0) { say(`  ${pct}%`); last = pct; }
    if (m.state === 'ready') break;
  }
}

const chat = names.map((n) => GGUF.find((g) => g.name === n)).find((g) => g?.role === 'chat');
const embed = names.map((n) => GGUF.find((g) => g.name === n)).find((g) => g?.role === 'embed');
if (chat) setSetting('ENGINE_CHAT_MODEL', chat.name);
if (embed) setSetting('ENGINE_EMBED_MODEL', embed.name);
setSetting('ENGINE_ENABLED', 'true');
say(`\nReady. The engine starts with AlphaCore${chat ? ` and serves ${chat.name}` : ''}.`);
process.exit(0);
