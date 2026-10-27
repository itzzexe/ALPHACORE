// Model router (ADR-005) — the single gate between agents and providers.
// Enforces: tier chains with pinned models, family separation (author ≠
// reviewer), sensitivity ceilings, reservation-first budgets, fail-closed
// semantics for review roles, and full metering into model_calls.
import { providersConfig } from './env.js';
import { getSecret, isProviderAvailable as providerAvailable, isMockMode as mockMode, localOnly } from './settings.js';
import * as anthropic from './providers/anthropic.js';
import * as claudeCli from './providers/claude-cli.js';
import * as openaiCompat from './providers/openai-compat.js';
import * as gemini from './providers/gemini.js';
import * as ollama from './providers/ollama.js';
import * as engine from './providers/engine.js';
import * as mock from './providers/mock.js';
import { reserve, settle, release, providerAllowedFor, perTaskCap, BudgetExceeded } from './policy.js';
import { exec } from './db.js';
import { tierChain } from './canary.js';

export class RouterExhausted extends Error {
  constructor(tier, mode, tried) {
    super(`Router exhausted for ${tier} (${mode}); tried: ${tried.join(', ') || 'nothing eligible'}`);
    this.name = 'RouterExhausted';
    this.mode = mode; // queue | stop-human | fail-closed
  }
}
export { BudgetExceeded };

const adapters = {
  anthropic: anthropic.call,
  'claude-cli': claudeCli.call,
  'openai-compat': openaiCompat.call,
  gemini: gemini.call,
  ollama: ollama.call,
  engine: engine.call,
  mock: mock.call,
};

function meter({ runId, provider, model, tokensIn = 0, tokensOut = 0, costUsd = 0, latencyMs = null, ok = true, error = null }) {
  exec(
    `INSERT INTO model_calls (run_id, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, provider, model, tokensIn, tokensOut, costUsd, latencyMs, ok ? 1 : 0, error,
  );
}

function costOf(providerName, model, tokensIn, tokensOut) {
  const price = providersConfig.providers[providerName]?.models?.[model];
  if (!price) return 0;
  return (tokensIn / 1e6) * price.priceIn + (tokensOut / 1e6) * price.priceOut;
}

/**
 * Local-first: the server's own model goes to the head of every chain.
 *
 * This is the switch that makes the VPS the company's brain rather than its
 * last resort. Hosted providers stay behind it, so a question the small model
 * cannot answer in time still gets answered — and the serving model is on
 * every run, so which one actually did the work is never a guess. A canary's
 * chain is left alone: it exists to test exactly the chain it names.
 */
export const localFirst = () => localOnly() || String(getSecret('LOCAL_FIRST') || '').toLowerCase() === 'true';

/**
 * Which family a local model belongs to — Qwen, Llama, Gemma — rather than
 * "local". Two Qwens on one machine are one opinion asked twice; a Llama
 * checking a Qwen is a second opinion, even on the same hardware. This is what
 * keeps reviewer independence honest when every provider is local.
 */
export function lineage(model) {
  const m = String(model || '').toLowerCase().split('/').pop();
  const hit = m.match(/^(qwen|llama|gemma|mistral|mixtral|phi|deepseek|granite|smollm|olmo|falcon|command|yi|nemotron|hermes)/);
  return hit ? (hit[1] === 'mixtral' ? 'mistral' : hit[1]) : (m.split(/[:.\-_\d]/)[0] || 'unknown');
}
const familyOf = (provider, model) => (providersConfig.providers[provider]?.family === 'local' ? `local:${lineage(model)}` : providersConfig.providers[provider]?.family);

/** The model a reviewer runs on when everything is local: a different family from the author's, if one is installed. */
export const reviewModel = () => getSecret('LOCAL_REVIEW_MODEL') || null;

/**
 * Which local runtime answers: the built-in engine when it is switched on,
 * Ollama otherwise. LOCAL_RUNTIME pins it when both are present.
 */
export function localRuntime() {
  const pinned = String(getSecret('LOCAL_RUNTIME') || '');
  if (pinned === 'engine' || pinned === 'ollama') return pinned;
  return String(getSecret('ENGINE_ENABLED') || '').toLowerCase() === 'true' ? 'engine' : 'ollama';
}

export function localModelFor(tier) {
  return getSecret(`LOCAL_MODEL_${tier}`) || getSecret('LOCAL_MODEL')
    || (tier === 'T3' || tier === 'TL' ? 'qwen2.5:7b' : 'qwen2.5:3b');
}

function eligibleChain(tier, { sensitivity = 'internal', familyNot = null, chainOverride = null } = {}) {
  if (mockMode()) return [{ provider: 'mock', model: 'mock-large' }];
  // A promoted chain beats the file. Editing providers.json to change a tier is
  // a change that the next `git pull` silently reverts, so a decision that was
  // canaried and signed lives in settings instead.
  let chain = chainOverride || tierChain(tier) || providersConfig.tiers[tier]?.chain || [];
  if (!chainOverride && (tier === 'TL' || localFirst())) {
    // A reviewer (an employee that must not share its author's family) gets
    // the review model on Ollama, which can hold more than one model; the
    // engine serves one, so there a review is the same model and is flagged.
    const local = localRuntime() === 'engine'
      ? { provider: 'engine', model: 'loaded' }
      : { provider: 'ollama', model: (familyNot && reviewModel()) || localModelFor(tier) };
    chain = [local, ...(tier === 'TL' ? [] : chain.filter((s) => s.provider !== 'ollama' && s.provider !== 'engine'))];
  }
  return chain.filter((step) => {
    const p = providersConfig.providers[step.provider];
    if (!p || !providerAvailable(step.provider)) return false;
    if (familyNot && p.family === familyNot) return false;
    if (!providerAllowedFor(step.provider, sensitivity)) return false;
    return true;
  });
}

async function callStep(step, { system, prompt, maxTokens, runId }) {
  const p = providersConfig.providers[step.provider];
  const adapter = adapters[p.kind];
  const t0 = Date.now();
  try {
    const result = await adapter({
      // The address may be overridden per provider — a regional mirror, a
      // company proxy, or a gateway in front of the same wire format. The
      // provider file stays the default; a setting beats it when one exists.
      baseUrl: getSecret(`${step.provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`) || p.baseUrl,
      apiKey: p.keyEnv ? getSecret(p.keyEnv) : null,
      model: step.model,
      system, prompt, maxTokens,
    });
    const costUsd = result.subscription ? 0 : costOf(step.provider, step.model, result.tokensIn, result.tokensOut);
    meter({ runId, provider: step.provider, model: step.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd, latencyMs: result.latencyMs });
    return { ...result, provider: step.provider, model: step.model, costUsd, family: familyOf(step.provider, step.model) };
  } catch (err) {
    meter({ runId, provider: step.provider, model: step.model, latencyMs: Date.now() - t0, ok: false, error: String(err.message).slice(0, 300) });
    throw err;
  }
}

/**
 * Route one call through the tier chain. Reservation-first; on chain
 * exhaustion the tier's onExhausted policy decides: queue, degrade with a
 * flag (generator tiers only), or stop for a human (fail closed).
 */
export async function route({
  tier, agentId, decisionId = null, governance = false,
  sensitivity = 'internal', familyNot = null,
  system, prompt, maxTokens = 4096, runId = null, _degraded = false,
  // A canary names the chain it wants to test, because the point is to try one
  // that is not in service yet.
  chainOverride = null,
}) {
  const reservation = reserve({ agentId, decisionId, estUsd: perTaskCap(agentId), governance });
  const tried = [];
  try {
    const chain = eligibleChain(tier, { sensitivity, familyNot, chainOverride });
    let lastErr = null;
    for (const step of chain) {
      tried.push(`${step.provider}/${step.model}`);
      try {
        const result = await callStep(step, { system, prompt, maxTokens, runId });
        settle(reservation, result.costUsd);
        const flags = [];
        if (_degraded) flags.push('degraded-tier');
        if (result.subscription) flags.push('subscription-served');
        return { ...result, flags };
      } catch (err) {
        lastErr = err;
      }
    }
    // Chain exhausted — apply the tier policy.
    release(reservation);
    const mode = providersConfig.tiers[tier]?.onExhausted || 'stop-human';
    if (mode === 'degrade-T1-with-flag' && !_degraded) {
      return route({ tier: 'T1', agentId, decisionId, governance, sensitivity, familyNot, system, prompt, maxTokens, runId, _degraded: true });
    }
    const ex = new RouterExhausted(tier, mode, tried);
    if (lastErr) ex.cause = lastErr;
    throw ex;
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    if (err instanceof RouterExhausted) throw err;
    release(reservation);
    throw err;
  }
}

/**
 * T4 critical cross-check: two independent families answer in parallel.
 * Returns both results plus a naive agreement signal (JSON verdict equality
 * where present). Any failure fails closed — no silent single-family pass.
 */
export async function routePair({ agentId, decisionId = null, sensitivity = 'internal', system, prompt, maxTokens = 4096, runId = null }) {
  if (mockMode()) {
    const a = await route({ tier: 'T1', agentId, decisionId, sensitivity, system, prompt, maxTokens, runId });
    return { a, b: a, agreement: true, mock: true };
  }
  // Everything local: the pair is the reasoning model and the review model,
  // and only if they come from different families. Otherwise the check fails
  // closed and a person decides — the same answer as with no second provider.
  if (localOnly()) {
    const a = localModelFor('T3'); const b = reviewModel();
    if (localRuntime() === 'engine' || !b || lineage(a) === lineage(b)) {
      throw new RouterExhausted('T4', 'fail-closed', [`local cross-check needs two model families (have ${lineage(a)}${b ? ` and ${lineage(b)}` : ' only'})`]);
    }
    const reservation = reserve({ agentId, decisionId, estUsd: 0 });
    try {
      const [ra, rb] = await Promise.all([{ provider: 'ollama', model: a }, { provider: 'ollama', model: b }].map((st) => callStep(st, { system, prompt, maxTokens, runId })));
      settle(reservation, 0);
      let agreement = null;
      try {
        const ja = parseAgentJson(ra.text); const jb = parseAgentJson(rb.text);
        if (ja?.verdict && jb?.verdict) agreement = ja.verdict === jb.verdict;
      } catch { /* leave null — humans compare */ }
      return { a: ra, b: rb, agreement, local: true };
    } catch (err) {
      release(reservation);
      throw err;
    }
  }
  const pairs = [providersConfig.tiers.T4.pair, providersConfig.tiers.T4.pairFallback];
  for (const pair of pairs) {
    const ok = pair.every((s) => providerAvailable(s.provider) && providerAllowedFor(s.provider, sensitivity));
    if (!ok) continue;
    const reservation = reserve({ agentId, decisionId, estUsd: perTaskCap(agentId) * 2 });
    try {
      const [a, b] = await Promise.all(pair.map((s) => callStep(s, { system, prompt, maxTokens, runId })));
      settle(reservation, a.costUsd + b.costUsd);
      let agreement = null;
      try {
        const ja = parseAgentJson(a.text); const jb = parseAgentJson(b.text);
        if (ja?.verdict && jb?.verdict) agreement = ja.verdict === jb.verdict;
      } catch { /* leave null — humans compare */ }
      return { a, b, agreement };
    } catch {
      release(reservation);
    }
  }
  throw new RouterExhausted('T4', 'fail-closed', ['no eligible independent pair']);
}

/** Tolerant JSON extraction from a model reply (fences, prose, embedded code). */
export function parseAgentJson(text) {
  if (!text) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { const r = tryParse(fenced[1].trim()); if (r && typeof r === 'object') return r; }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) { const r = tryParse(text.slice(start, end + 1)); if (r) return r; }

  // Balanced-brace scan: walks candidate openings and matches the closing
  // brace while respecting string literals and escapes — survives prose and
  // code blocks with stray braces around the real JSON object.
  let attempts = 0;
  for (let i = start; i !== -1 && attempts < 25; i = text.indexOf('{', i + 1), attempts++) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const r = tryParse(text.slice(i, j + 1));
          if (r) return r;
          break;
        }
      }
    }
  }
  return null;
}
