// Ollama's native adapter — the model that runs on this machine, or on the
// VPS beside it.
//
// The OpenAI-compatible endpoint Ollama also offers ignores the three settings
// that decide whether a small server is usable at all: the context window, the
// thread count and how long the model stays in memory. On two vCPUs and 8 GB
// those are not tuning, they are the difference between an answer in twenty
// seconds and a server that swaps itself to a standstill. So this speaks
// /api/chat directly.
//
// One generation at a time. Two concurrent requests on two cores do not finish
// twice as fast — each runs at half speed, both hold a KV cache, and the second
// model load evicts the first. A queue in front of the call is what makes the
// box feel smooth rather than merely busy.
import { getSecret } from '../settings.js';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** Where the local model listens. A trailing /v1 from the old compat setting is forgiven. */
export function ollamaBase(fallback = 'http://127.0.0.1:11434') {
  const raw = getSecret('OLLAMA_BASE_URL') || getSecret('OLLAMA_URL') || fallback;
  return String(raw).replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** The knobs, read on every call so a change in Settings applies to the next one. */
export function localTuning() {
  return {
    numCtx: num(getSecret('LOCAL_NUM_CTX'), 4096),
    // Unset means Ollama picks; on a shared VPS it tends to pick every core,
    // which starves the Node process serving the console.
    numThread: num(getSecret('LOCAL_NUM_THREAD'), 0) || null,
    keepAlive: getSecret('LOCAL_KEEP_ALIVE') || '30m',
    concurrency: num(getSecret('LOCAL_CONCURRENCY'), 1),
    timeoutMs: num(getSecret('LOCAL_TIMEOUT_SEC'), 600) * 1000,
    temperature: Number(getSecret('LOCAL_TEMPERATURE') ?? 0.3),
  };
}

// ------------------------------------------------------------------ queue --

let active = 0;
const waiting = [];
const stats = { served: 0, failed: 0, waitedMs: 0, maxQueue: 0 };

function acquire(limit) {
  if (active < limit) { active++; return Promise.resolve(); }
  return new Promise((resolve) => {
    waiting.push(resolve);
    stats.maxQueue = Math.max(stats.maxQueue, waiting.length);
  });
}
function releaseSlot() {
  const next = waiting.shift();
  if (next) next(); else active = Math.max(0, active - 1);
}

export const queueState = () => ({ active, waiting: waiting.length, ...stats });

/**
 * One slot for every local model, whichever runtime serves it.
 *
 * Ollama and the built-in engine run on the same two cores. Two queues would
 * let each believe it had the machine to itself, which is the slowdown the
 * queue exists to prevent.
 */
export async function withLocalSlot(fn) {
  const queuedAt = Date.now();
  await acquire(localTuning().concurrency);
  stats.waitedMs += Date.now() - queuedAt;
  try {
    const out = await fn(Date.now() - queuedAt);
    stats.served++;
    return out;
  } catch (err) {
    stats.failed++;
    throw err;
  } finally {
    releaseSlot();
  }
}

/**
 * Keep the head and the tail of a prompt that will not fit.
 *
 * The head carries the instructions and the tail carries the task and the
 * output format; the middle is usually memory and context. Ollama would
 * otherwise truncate from the front silently and the model would answer a
 * question nobody asked. About three characters per token is pessimistic for
 * English and roughly right for Arabic.
 */
export function fitPrompt(text, numCtx, reserve = 1024) {
  const budget = Math.max(1000, (numCtx - reserve) * 3);
  const s = String(text || '');
  if (s.length <= budget) return { text: s, trimmed: 0 };
  const head = Math.floor(budget * 0.35);
  const tail = budget - head - 60;
  return {
    text: `${s.slice(0, head)}\n\n[… ${s.length - head - tail} characters left out to fit the local model's window …]\n\n${s.slice(-tail)}`,
    trimmed: s.length - head - tail,
  };
}

export async function call({ baseUrl, model, system, prompt, maxTokens = 1024 }) {
  const tune = localTuning();
  const base = String(baseUrl || ollamaBase()).replace(/\/+$/, '').replace(/\/v1$/, '');
  // The role description is short and survives whole; only the task part is
  // ever trimmed, with room kept for the system line and the answer.
  const reserve = Math.min(maxTokens, 2048) + Math.ceil(String(system || '').length / 3);
  const fitted = fitPrompt(prompt, tune.numCtx, reserve);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: fitted.text });

  const wantsJson = /Output JSON|respond with JSON|Return JSON/i.test(`${system}\n${prompt}`);
  // The night model is larger and slower: it gets longer to answer, and it is
  // let go of soon after, so it is not still holding memory when the day's
  // small model is wanted again.
  const night = getSecret('NIGHT_MODEL');
  if (night && model === night) {
    tune.timeoutMs = num(getSecret('NIGHT_TIMEOUT_SEC'), 2400) * 1000;
    tune.keepAlive = '2m';
  }
  const body = {
    model,
    messages,
    stream: false,
    keep_alive: tune.keepAlive,
    options: {
      num_ctx: tune.numCtx,
      num_predict: Math.min(maxTokens, 4096),
      temperature: tune.temperature,
      ...(tune.numThread ? { num_thread: tune.numThread } : {}),
    },
    // Small models drift out of JSON halfway through a long answer. The
    // grammar-constrained mode keeps them inside it, which is worth more than
    // the few percent of speed it costs.
    ...(wantsJson ? { format: 'json' } : {}),
  };

  return withLocalSlot(async (queuedMs) => {
    const t0 = Date.now();
    const headers = { 'content-type': 'application/json' };
    // A reverse proxy in front of a remote Ollama usually wants a bearer token.
    const auth = getSecret('OLLAMA_AUTH');
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(tune.timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data?.message?.content;
    if (!text) throw new Error('ollama: empty completion');
    return {
      text,
      tokensIn: data.prompt_eval_count ?? 0,
      tokensOut: data.eval_count ?? 0,
      latencyMs: Date.now() - t0,
      local: {
        // Durations come back in nanoseconds.
        tokensPerSec: data.eval_duration ? Math.round((data.eval_count / (data.eval_duration / 1e9)) * 10) / 10 : null,
        promptPerSec: data.prompt_eval_duration ? Math.round((data.prompt_eval_count / (data.prompt_eval_duration / 1e9)) * 10) / 10 : null,
        loadMs: data.load_duration ? Math.round(data.load_duration / 1e6) : null,
        queuedMs,
        trimmedChars: fitted.trimmed,
      },
    };
  });
}
