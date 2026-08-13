// OpenAI-compatible chat-completions adapter — serves both OpenAI (ChatGPT
// models) and DeepSeek, which exposes the same wire format.
export async function call({ baseUrl, apiKey, model, system, prompt, maxTokens = 4096 }) {
  const t0 = Date.now();
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = { model, messages };
  // gpt-5-family models on api.openai.com require max_completion_tokens;
  // DeepSeek (and most compat servers) take max_tokens.
  if (baseUrl.includes('openai.com')) body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 400);
    throw new Error(`${new URL(baseUrl).hostname} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error(`${new URL(baseUrl).hostname}: empty completion`);
  return {
    text: choice.message.content,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}
