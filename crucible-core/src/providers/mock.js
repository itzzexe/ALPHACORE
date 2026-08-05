// Mock provider — deterministic zero-cost responses so the entire platform is
// demoable with no API keys. It inspects the role's requested JSON shape (from
// the system prompt) and returns a structurally valid answer, clearly marked.
function pick(system) {
  const s = system || '';
  if (s.includes('"verdict":"approve|request-changes|block"')) {
    return { verdict: 'approve', findings: [{ severity: 'low', claim: '[mock] Nit: naming could be clearer in one helper.', evidence: 'mock-review' }], confidence: 0.9 };
  }
  if (s.includes('"verdict":"pass|block"')) {
    return { verdict: 'pass', findings: [] };
  }
  if (s.includes('"verdict":"green|red"')) {
    return { report: [{ criterion: '[mock] All stated acceptance criteria', status: 'pass', evidence: 'mock-qa' }], verdict: 'green' };
  }
  if (s.includes('Tribunal Advocate')) {
    return { proposal: '[mock] Adopt the balanced option.', argument: '[mock] Lowest cost of reversal at comparable capability.', weaknesses: ['[mock] Vendor dependency'], evidenceCited: [] };
  }
  if (s.includes('Tribunal Critic')) {
    return { lens: 'mock', objections: [{ claim: '[mock] Exit path not yet documented.', severity: 'medium' }], scores: { conservative: 3, balanced: 4, innovative: 3 }, block: false };
  }
  if (s.includes('Tribunal Judge')) {
    return { outcome: 'approved_cond', consensusScore: 0.78, memo: '[mock] Balanced option approved with an exit-path condition.', conditions: ['[mock] Document exit path before GA'], dissent: ['[mock] Critic: vendor pricing risk past 5k MAU'], confidence: 0.8 };
  }
  if (s.includes('"classification"')) {
    return { classification: 'bug', severity: 'SEV3', dedupKey: 'mock-1', summary: '[mock] Minor impairment, workaround exists.' };
  }
  if (s.includes('"draft"') && s.includes('escalate')) {
    return { draft: '[mock] Thanks for reaching out — here is what we found…', triage: 'how-to', severity: 'low', escalate: false, confidence: 0.92 };
  }
  if (s.includes('"anomalies"')) {
    return { anomalies: [], summary: '[mock] Spend within expected bands.' };
  }
  if (s.includes('"claims"')) {
    return { claims: [{ claim: '[mock] Example market claim', source: '[Assumption]', verification: 'unverified', confidence: 0.5 }], summary: '[mock] Evidence pack placeholder.', confidence: 0.6 };
  }
  return { summary: '[mock] Task completed in mock mode — connect a provider key for real output.', confidence: 0.85 };
}

export async function call({ system, prompt }) {
  const obj = pick(system);
  const text = JSON.stringify(obj, null, 2);
  // Simulate plausible token counts so dashboards have something to show.
  const tokensIn = Math.ceil(((system || '').length + prompt.length) / 4);
  const tokensOut = Math.ceil(text.length / 4);
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
  return { text, tokensIn, tokensOut, latencyMs: 200 };
}
