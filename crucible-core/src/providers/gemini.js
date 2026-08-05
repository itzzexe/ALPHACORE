// Google Gemini adapter — generateContent REST endpoint.
export async function call({ baseUrl, apiKey, model, system, prompt, maxTokens = 4096 }) {
  const t0 = Date.now();
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  const res = await fetch(`${baseUrl}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 400);
    throw new Error(`gemini ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const text = (parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`gemini: empty candidate (${data.candidates?.[0]?.finishReason || 'no candidates'})`);
  return {
    text,
    tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - t0,
  };
}
