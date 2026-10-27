// The built-in engine's adapter — llama.cpp's server, started and supervised by
// src/engine.js, answering on a loopback port.
//
// One model is loaded at a time, so the model name in a chain step is not a
// choice here: the step says "engine", and whatever the engine has loaded
// answers. Switching models is an engine act (a restart), not something a
// single question should be able to cause.
import { fitPrompt, localTuning, withLocalSlot } from './ollama.js';

export async function call({ baseUrl, system, prompt, maxTokens = 1024 }) {
  const tune = localTuning();
  const reserve = Math.min(maxTokens, 2048) + Math.ceil(String(system || '').length / 3);
  const fitted = fitPrompt(prompt, tune.numCtx, reserve);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: fitted.text });
  const wantsJson = /Output JSON|respond with JSON|Return JSON/i.test(`${system}\n${prompt}`);

  return withLocalSlot(async (queuedMs) => {
    const t0 = Date.now();
    const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages,
        max_tokens: Math.min(maxTokens, 4096),
        temperature: tune.temperature,
        // Grammar-constrained JSON, for the same reason as on Ollama: a small
        // model drifts out of the contract halfway through a long answer.
        ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(tune.timeoutMs),
    });
    if (!res.ok) throw new Error(`engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('engine: empty completion');
    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - t0,
      local: {
        tokensPerSec: data.timings?.predicted_per_second ? Math.round(data.timings.predicted_per_second * 10) / 10 : null,
        promptPerSec: data.timings?.prompt_per_second ? Math.round(data.timings.prompt_per_second * 10) / 10 : null,
        loadMs: null,
        queuedMs,
        trimmedChars: fitted.trimmed,
      },
    };
  });
}
