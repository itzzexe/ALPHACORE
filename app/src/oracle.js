// The consultant — المستشار.
//
// Every other employee here is a specialist with a contract: a tier, a
// sensitivity ceiling, a JSON shape it must answer in, and a department it
// belongs to. That is what makes the company auditable, and it is exactly
// what makes it useless for the ordinary question — "what does this Arabic
// clause mean", "write me a reply to this", "explain what a letter of credit
// is". Ask any of them that on the floor and you get a schema, or nothing.
//
// So this is one employee with the opposite contract, and the platform puts
// nothing in its way:
//
//   - **no output schema.** Its reply is the prose itself.
//   - **no subject scope.** No topic list, no department, no allow-list.
//   - **no tools.** It cannot spend, write, or reach outside — which is why
//     it needs no permission gate on what it discusses.
//   - **any provider, any model.** Pin it to a hosted API, or to a model
//     running on this machine through Ollama, by typing the name you pulled.
//     A local model is also the only provider cleared for every sensitivity
//     level, because nothing leaves the building to reach it.
//
// What the platform still does is record: every run it makes is on the audit
// chain and against the budget, like anybody else's. That is bookkeeping, not
// a restriction on what it may say.
//
// The one limit this file cannot lift is the model's own: a hosted model
// brings its own training and will decline what it declines. Choosing the
// model is how that is decided, and that choice is now a field.
import { one, exec, q } from './db.js';
import { audit } from './audit.js';
import { getSetting, setSetting, getSecret } from './settings.js';
import { providersConfig } from './env.js';

export const ORACLE_ID = 'AGT-ORACLE-001';

/** Every provider the router can actually call, minus the demo one. */
const PROVIDERS = Object.entries(providersConfig.providers)
  .filter(([, p]) => p.kind !== 'mock')
  .map(([name, p]) => ({
    name,
    kind: p.kind,
    family: p.family,
    keyName: p.kind === 'claude-cli' ? p.enabledEnv : p.keyEnv,
    baseUrlDefault: p.baseUrl || null,
    models: Object.keys(p.models || {}),
    // A flag, not a secret: Ollama and the Claude CLI are switched on rather
    // than authenticated, so the screen offers a switch instead of a password.
    isFlag: /_ENABLED$/.test(String(p.kind === 'claude-cli' ? p.enabledEnv : p.keyEnv || '')),
    // The wire format takes whatever model string it is handed, so a local
    // model you pulled yourself is a name you type rather than a list to
    // choose from. Anthropic and Gemini pin their own model ids.
    anyModel: p.kind === 'openai-compat',
    dpa: Boolean(p.dpa),
    noTraining: Boolean(p.noTraining),
    local: p.family === 'local',
  }));

const providerDef = (name) => PROVIDERS.find((p) => p.name === name) || null;
const DEFAULT_PROVIDER = 'deepseek';
const urlKey = (provider) => `${provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;

export const DEFAULT_PERSONA = [
  'You are the Consultant — a general adviser inside a company\'s operating platform, talking to somebody in a chat window.',
  '',
  'How you answer:',
  '- Answer the question that was actually asked, directly, in the first sentence. No preamble, no restating the question, no "great question".',
  '- Reply in the language the person used. If they wrote Arabic, answer in Arabic — including Iraqi dialect if that is what they used.',
  '- Any subject is in scope: law, medicine, code, religion, history, money, translation, personal advice, or plain conversation. You are not limited to this company\'s departments.',
  '- Length follows the question. A greeting gets a line. A real question gets as much as it needs, with the reasoning visible.',
  '- When you are not certain, say what you are confident about and what you are guessing, rather than refusing.',
  '- You are talking, not filing a report: no JSON, no headings unless the answer genuinely needs them.',
].join('\n');

/** What Settings shows and edits. */
export function oracleSettings() {
  const row = one('SELECT id, name, status FROM agents WHERE id = ?', ORACLE_ID);
  const provider = getSetting('ORACLE_PROVIDER') || DEFAULT_PROVIDER;
  const def = providerDef(provider) || providerDef(DEFAULT_PROVIDER);
  const key = def?.keyName ? getSecret(def.keyName) : null;
  const model = getSetting('ORACLE_MODEL') || def?.models[0] || '';
  const override = def ? getSetting(urlKey(def.name)) : null;
  return {
    id: ORACLE_ID,
    name: getSetting('ORACLE_NAME') || 'The Consultant',
    enabled: getSetting('ORACLE_ENABLED') === 'true',
    hired: Boolean(row),
    status: row?.status || null,
    provider: def?.name || provider,
    providers: PROVIDERS,
    model,
    models: def?.models || [],
    anyModel: Boolean(def?.anyModel),
    local: Boolean(def?.local),
    persona: getSetting('ORACLE_PERSONA') || DEFAULT_PERSONA,
    keyName: def?.keyName || null,
    isFlag: Boolean(def?.isFlag),
    keyConfigured: Boolean(key),
    keyTail: key && !def?.isFlag ? String(key).slice(-4) : null,
    // The two facts that decide whether it can actually answer.
    ready: Boolean(key) && Boolean(model) && getSetting('ORACLE_ENABLED') === 'true',
    // Where the calls go. The provider file holds the default; an install
    // behind a company proxy, using a regional mirror, or running a model on
    // this machine points it somewhere else without touching the code.
    baseUrl: override || def?.baseUrlDefault || null,
    baseUrlDefault: def?.baseUrlDefault || null,
    baseUrlOverridden: Boolean(override),
    note: 'This employee has no output schema, no subject scope and no tools: it answers anything, in any language, '
      + 'and its reply is the text itself. Pin it to whichever model you want — including one running on this machine '
      + 'through Ollama, which is also the only provider cleared for every sensitivity level, because nothing leaves '
      + 'the building to reach it. A hosted model still brings its own training and will decline what it declines; '
      + 'choosing the model is how that is decided. Its runs are recorded on the audit chain and against the budget.',
  };
}

/**
 * Write the employee into the roster, or take it off.
 *
 * Hiring is an INSERT into the same table every other employee lives in, so it
 * appears on the floor, in the workforce, in the audit log and in the run
 * queue exactly like the rest — there is no second kind of employee.
 */
export function seedOracle({ actor = 'system:seed' } = {}) {
  const s = oracleSettings();
  const spec = {
    id: ORACLE_ID,
    name: s.name,
    group: 'steer',
    tier: 'T2',
    owner: 'CEO',
    failMode: 'stop-human',
    confidenceFloor: 0,
    // A local model is cleared for everything; a hosted one is not, and that
    // ceiling belongs to the provider file rather than to this employee.
    sensitivity: s.local ? 'restricted' : 'internal',
    // The two flags this employee exists for.
    freeform: true,
    chain: s.model ? [{ provider: s.provider, model: s.model }] : [],
    system: s.persona,
  };
  const status = s.enabled ? 'active' : 'paused';
  const existing = one('SELECT id, status FROM agents WHERE id = ?', ORACLE_ID);
  if (existing) {
    exec('UPDATE agents SET name = ?, role_group = ?, spec = ?, model_tier = ?, status = ? WHERE id = ?',
      s.name, 'steer', JSON.stringify(spec), 'T2', status, ORACLE_ID);
  } else {
    exec('INSERT INTO agents (id, name, role_group, spec, model_tier, human_owner, status) VALUES (?,?,?,?,?,?,?)',
      ORACLE_ID, s.name, 'steer', JSON.stringify(spec), 'T2', 'CEO', status);
    audit({ actorType: 'system', actorId: actor, action: 'agent.registered', subjectType: 'agent', subjectId: ORACLE_ID, payload: { freeform: true, provider: s.provider } });
  }
  return oracleSettings();
}

/** Settings writes come through here so the roster row never drifts from them. */
export function setOracle({ enabled, provider, model, persona, name, apiKey, baseUrl, actor }) {
  if (!actor) { const e = new Error('changing the consultant carries a name'); e.status = 400; throw e; }
  if (enabled !== undefined) setSetting('ORACLE_ENABLED', enabled ? 'true' : 'false');

  if (provider !== undefined && provider !== null && provider !== '') {
    const def = providerDef(provider);
    if (!def) { const e = new Error(`unknown provider: ${provider}`); e.status = 400; throw e; }
    const before = getSetting('ORACLE_PROVIDER') || DEFAULT_PROVIDER;
    setSetting('ORACLE_PROVIDER', provider);
    // Moving to another provider drops a model name that belonged to the old
    // one, unless this same call names a new one. A model string from the
    // wrong provider is a 404 at call time and a puzzle on screen.
    if (provider !== before && (model === undefined || model === null || model === '')) {
      setSetting('ORACLE_MODEL', def.models[0] || null);
    }
  }

  const def = providerDef(getSetting('ORACLE_PROVIDER') || DEFAULT_PROVIDER);
  if (model !== undefined && model !== null && model !== '') {
    const wanted = String(model).trim().slice(0, 120);
    // A provider whose wire format passes the model name through takes any
    // name — that is how a model you pulled yourself is reachable. One that
    // pins its own ids is held to the list.
    if (!def?.anyModel && def?.models.length && !def.models.includes(wanted)) {
      const e = new Error(`${def.name} has no model called ${wanted}`); e.status = 400; throw e;
    }
    setSetting('ORACLE_MODEL', wanted);
  }

  if (persona !== undefined) setSetting('ORACLE_PERSONA', String(persona || '').slice(0, 6000) || null);
  if (name !== undefined) setSetting('ORACLE_NAME', String(name || '').slice(0, 60) || null);

  // The key is a secret like any other provider key: stored, never echoed. For
  // a provider that is switched on rather than authenticated, anything truthy
  // becomes the flag the availability check looks for.
  if (apiKey !== undefined && def?.keyName) {
    const v = String(apiKey ?? '').trim();
    if (!v) setSetting(def.keyName, null);
    else setSetting(def.keyName, def.isFlag ? 'true' : v);
  }

  if (baseUrl !== undefined && def) {
    const url = String(baseUrl || '').trim();
    if (url) {
      // A typo here sends the key somewhere unintended, so it is parsed rather
      // than trusted, and only over a real transport.
      let parsed;
      try { parsed = new URL(url); } catch { const e = new Error('that is not a URL'); e.status = 400; throw e; }
      if (!['http:', 'https:'].includes(parsed.protocol)) { const e = new Error('the address must be http or https'); e.status = 400; throw e; }
      setSetting(urlKey(def.name), url.replace(/\/+$/, ''));
    } else setSetting(urlKey(def.name), null);
  }

  const after = seedOracle({ actor });
  audit({
    actorType: 'human', actorId: actor, action: 'oracle.configured', subjectType: 'agent', subjectId: ORACLE_ID,
    // The key itself is never in the payload — only whether one is now present.
    payload: { enabled: after.enabled, provider: after.provider, model: after.model, keyConfigured: after.keyConfigured },
  });
  return after;
}

/** Recent conversations, for the Settings panel to show it is actually working. */
export function oracleActivity({ limit = 5 } = {}) {
  return q(
    `SELECT id, state, task_type, created_at, cost_usd, failure_reason
       FROM runs WHERE agent_id = ? ORDER BY rowid DESC LIMIT ?`, ORACLE_ID, Number(limit),
  );
}
