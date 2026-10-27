// The model hub — where the built-in engine and its models come from.
//
// Two places only: llama.cpp's own releases on GitHub, and model files on
// Hugging Face. Anything else is refused by the driver before the gate even
// sees it, because a model file is several gigabytes of something that will
// be executed against every prompt the company writes, and "any URL a person
// pasted" is the wrong supply chain for that.
//
// Downloads stream to disk with a running SHA-256, so a 5 GB file never sits
// in memory and the hash is known the moment the last byte lands.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { wire } from './wire.js';
import { userAgent } from '../robots.js';
import { ROOT } from '../env.js';

export const ENGINE_DIR = path.join(ROOT, 'workspace', '_engine');
const HOSTS = /^(github\.com|api\.github\.com|huggingface\.co)$/i;

function checkUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('downloads are https only');
  if (!HOSTS.test(u.hostname)) throw new Error(`${u.hostname} is not a model source this platform trusts — GitHub releases and Hugging Face only`);
  return u;
}

function checkDest(dest) {
  const out = path.resolve(dest);
  if (!out.startsWith(path.resolve(ENGINE_DIR) + path.sep)) throw new Error('a download may only land in the engine folder');
  return out;
}

async function download({ url, dest, onProgress = null }) {
  checkUrl(url);
  const out = checkDest(dest);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetch(url, { headers: { 'user-agent': userAgent() }, redirect: 'follow', signal: AbortSignal.timeout(6 * 3600_000) });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  const tmp = `${out}.part`;
  const file = fs.createWriteStream(tmp);
  const hash = createHash('sha256');
  let got = 0; let lastTick = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!file.write(chunk)) await new Promise((r) => file.once('drain', r));
      if (onProgress && Date.now() - lastTick > 1000) { lastTick = Date.now(); onProgress(got, total); }
    }
    await new Promise((r, j) => file.end((e) => (e ? j(e) : r())));
  } catch (e) {
    file.destroy();
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    throw e;
  }
  if (total && got !== total) { fs.rmSync(tmp, { force: true }); throw new Error(`the download stopped at ${got} of ${total} bytes`); }
  fs.renameSync(tmp, out);
  if (onProgress) onProgress(got, total);
  return { file: out, bytes: got, sha256: hash.digest('hex') };
}

export default {
  id: 'modelhub',
  label: 'Model hub — llama.cpp releases and Hugging Face models',
  auth: { kind: 'none' },
  docs: 'Downloads the built-in engine from github.com/ggml-org/llama.cpp and GGUF models from huggingface.co. Nothing else.',
  quotaDay: 50,
  capabilities: ['release.fetch', 'file.fetch'],
  ops: {
    'release.fetch': {
      target: () => 'api.github.com',
      run: async () => {
        const d = await wire('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', { headers: { 'user-agent': userAgent() }, service: 'github' });
        return { tag: d.tag_name, assets: (d.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
      },
    },
    'file.fetch': {
      target: (a) => { try { return new URL(a.url).hostname; } catch { return null; } },
      run: (a) => download(a),
    },
  },
};
