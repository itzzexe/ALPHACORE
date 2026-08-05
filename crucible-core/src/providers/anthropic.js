// Anthropic provider adapter — official SDK, Messages API.
// Note: no temperature/top_p (removed on Opus 5-class models); thinking is
// adaptive by default on claude-opus-5. We check stop_reason before reading
// content — a refusal must surface as an error, never as an empty answer.
import Anthropic from '@anthropic-ai/sdk';

export async function call({ apiKey, model, system, prompt, maxTokens = 4096 }) {
  const t0 = Date.now();
  const client = new Anthropic(apiKey ? { apiKey } : undefined);
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') {
    const cat = response.stop_details?.category ?? 'unspecified';
    throw new Error(`anthropic refusal (category: ${cat})`);
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    text,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    latencyMs: Date.now() - t0,
  };
}
