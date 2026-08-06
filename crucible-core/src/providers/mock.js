// Mock provider — deterministic zero-cost responses so the entire platform is
// demoable with no API keys. It inspects the role's requested JSON shape (from
// the system prompt) and returns a structurally valid answer, clearly marked.
function pick(system, prompt) {
  const s = (system || '') + '\n' + (prompt || '');
  // Intelligence campaign shapes — keyed off the task brief, not the role.
  if (s.includes('"decisions"') && s.includes('approve|reject|hold')) {
    return { decisions: [], note: '[mock] Autonomy needs a real model to judge — connect a provider key.', confidence: 0.3 };
  }
  if (s.includes('"whereTheyDisagree"')) {
    return { whereTheyDisagree: '[mock] The parties disagree on an unstated assumption.', assessmentA: '[mock] Position A is partly supported.', assessmentB: '[mock] Position B raises a valid constraint.', recommendation: '[mock] Connect a provider key for real arbitration.', reasoning: '[mock] Placeholder.', needsOwnerDecision: true, confidence: 0.3 };
  }
  if (s.includes('"translation"')) {
    return { translation: '[mock] الترجمة التجريبية — أضف مفتاح مزوّد للحصول على ترجمة حقيقية.', notes: ['[mock] placeholder'], confidence: 0.3 };
  }
  if (s.includes('"stage":"onboarding')) {
    return { score: 3, stage: 'adopting', signals: ['[mock] placeholder signal'], nextStep: '[mock] Connect a provider key for a real assessment.', confidence: 0.3 };
  }
  if (s.includes('"deliverable"') && s.includes('"steps"')) {
    return {
      title: '[mock] Routed request',
      summary: '[mock] Mock routing — connect a provider key and the router reads the request properly.',
      deliverable: '[mock] A short written answer.',
      steps: [
        { dept: 'research', title: 'Gather context', brief: '[mock] Collect what is known.', kind: 'agent', agentId: 'AGT-RES-001' },
        { dept: 'docs', title: 'Write the answer', brief: '[mock] Draft the deliverable.', kind: 'agent', agentId: 'AGT-DOC-001' },
      ],
      confidence: 0.3,
    };
  }
  if (s.includes('"plan"') && s.includes('"assessment"')) {
    return { plan: [], assessment: '[mock] Orchestration runs on a real model — connect a provider key and the planner will dispatch work.', flagsForHumans: [], confidence: 0.3 };
  }
  if (s.includes('"markdown"')) {
    const t = (prompt || '').match(/Document:\s*([^\n]+)/)?.[1] || 'Document';
    return {
      title: `[mock] ${t}`,
      markdown: `# [mock] ${t}\n\nThis is a structurally valid placeholder so the document flow is demoable at zero cost.\n\n## Scope\n- [mock] Item one\n- [mock] Item two\n\n## Requirements\n| ID | Requirement | Priority |\n|---|---|---|\n| R-1 | [mock] Placeholder requirement | must |\n\n> Connect a provider key and this becomes a real, complete document.`,
      openQuestions: ['[mock] Connect a provider key for real content'],
      costTable: [{ item: '[mock] compute', monthlyUsd: 0 }],
      metrics: {},
      flags: ['[mock] placeholder — not a real analysis'],
      confidence: 0.3,
    };
  }
  if (s.includes('"orgs"')) {
    return { orgs: [], summary: '[mock] No executives known in mock mode — connect a provider key so the agent can name real people.' };
  }
  if (s.includes('"fixes"')) {
    return { fixes: [], summary: '[mock] No better domains known in mock mode — connect a provider key.' };
  }
  if (s.includes('"records"') && s.includes('"domain"')) {
    const seed = (prompt || '').length;
    return {
      records: [
        { name: '[mock] Example Energy Services', nameAr: '[تجريبي] شركة الطاقة', kind: 'company', sector: 'energy', country: null, city: null, region: null, sizeHint: 'SME', profile: '[mock] Placeholder candidate — mock mode returns a structurally valid record so the pipeline is demoable. Connect a provider key for real candidates.', domain: 'example.com', confidence: 0.3 },
        { name: `[mock] Sample Holding ${seed % 97}`, nameAr: null, kind: 'company', sector: null, country: null, city: null, region: null, sizeHint: null, profile: '[mock] Second placeholder candidate.', domain: 'iana.org', confidence: 0.25 },
      ],
      summary: '[mock] Mock candidates only — real collection needs a provider key. Web enrichment below still runs for real against these domains.',
      confidence: 0.3,
    };
  }
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
  if (s.includes('"posts"')) {
    return { posts: [
      { platform: 'linkedin', text: '[mock] Building in public: our platform now routes every AI decision through a human gate. Here is why that matters →', hashtags: ['#AI', '#SaaS', '#BuildInPublic'], bestTime: 'Tue 10:00' },
      { platform: 'x', text: '[mock] Ship fast, audit everything. New: hash-chained decision log. 🔥', hashtags: ['#buildinpublic'], bestTime: 'Wed 17:00' },
    ], confidence: 0.85 };
  }
  if (s.includes('"svg"')) {
    return {
      spec: '[mock] Dark graphite field, ember-orange triangle mark, tight letter-spaced wordmark. 1200×630 social banner ratio.',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315"><rect width="600" height="315" fill="#16130f"/><polygon points="300,70 380,220 220,220" fill="#ff6b2c"/><text x="300" y="262" fill="#e8e0d4" font-family="sans-serif" font-size="26" letter-spacing="8" text-anchor="middle">CRUCIBLE</text><text x="300" y="286" fill="#8d8477" font-family="monospace" font-size="11" letter-spacing="4" text-anchor="middle">MOCK DESIGN — CONNECT A KEY</text></svg>',
      confidence: 0.8,
    };
  }
  if (s.includes('"nextSteps"')) {
    return { proposal: '[mock] Proposal draft: scoped pilot, 30-day success criteria, month-to-month terms. Pricing pending an approved pricing record — placeholder only.', nextSteps: ['[mock] Human reviews & sends proposal', '[mock] Book demo call'], confidence: 0.8 };
  }
  if (s.includes('"article"')) {
    return { title: '[mock] Why every AI action needs a human gate', article: '[mock] Draft article body — three sections: the problem with silent automation, the reservation-first budget model, and what an append-only audit chain buys you. Connect a provider key for real prose.', seoKeywords: ['ai governance', 'human in the loop', 'audit'], confidence: 0.8 };
  }
  return { summary: '[mock] Task completed in mock mode — connect a provider key for real output.', confidence: 0.85 };
}

export async function call({ system, prompt }) {
  const obj = pick(system, prompt);
  const text = JSON.stringify(obj, null, 2);
  // Simulate plausible token counts so dashboards have something to show.
  const tokensIn = Math.ceil(((system || '').length + prompt.length) / 4);
  const tokensOut = Math.ceil(text.length / 4);
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 300));
  return { text, tokensIn, tokensOut, latencyMs: 200 };
}
