// The consultant — المستشار.
//
// Every other employee here is a specialist with a contract: a tier, a
// sensitivity ceiling, a JSON shape it must answer in, and a department it
// belongs to. That is what makes the company auditable, and it is exactly
// what makes it useless for the ordinary question — "what does this Arabic
// clause mean", "write me a reply to this", "explain what a letter of credit
// is". Ask any of them that on the floor and you get a schema, or nothing.
//
// So this is one employee with the opposite contract: **no schema, no
// department, no subject it will not discuss.** It answers in the language it
// was asked in, at whatever length the question deserves, and its reply is
// the text itself rather than a field inside a JSON envelope.
//
// What it is NOT free of, and the screen says so:
//
//   - the audit chain. Every run it makes is recorded like any other.
//   - the budget. It reserves and settles against the same caps.
//   - the sensitivity router. DeepSeek is declared `dpa: false,
//     noTraining: false`, so customer_min and restricted content never reach
//     it — that rule is in providers.json and this module cannot override it.
//   - actions. It has no gateway tools. It can say what it thinks; it cannot
//     spend, write to a record, or message the outside world.
//
// The provider is pinned rather than routed: the point of this employee is
// that it uses the key the owner pasted in Settings, not whatever the tier
// chain happens to prefer today.
import { one, exec, q } from './db.js';
import { audit } from './audit.js';
import { getSetting, setSetting, getSecret } from './settings.js';
import { providersConfig } from './env.js';

export const ORACLE_ID = 'AGT-ORACLE-001';
const KEY = 'DEEPSEEK_API_KEY';

/** The models this employee may be pinned to, read from the provider file. */
export const ORACLE_MODELS = Object.keys(providersConfig.providers.deepseek?.models || {});

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
  const key = getSecret(KEY);
  const model = getSetting('ORACLE_MODEL') || ORACLE_MODELS[0] || 'deepseek-chat';
  return {
    id: ORACLE_ID,
    name: getSetting('ORACLE_NAME') || 'The Consultant',
    enabled: getSetting('ORACLE_ENABLED') === 'true',
    hired: Boolean(row),
    status: row?.status || null,
    model,
    models: ORACLE_MODELS,
    persona: getSetting('ORACLE_PERSONA') || DEFAULT_PERSONA,
    keyName: KEY,
    keyConfigured: Boolean(key),
    keyTail: key ? String(key).slice(-4) : null,
    // The two facts that decide whether it can actually answer.
    ready: Boolean(key) && getSetting('ORACLE_ENABLED') === 'true',
    baseUrl: providersConfig.providers.deepseek?.baseUrl || null,
    note: 'This employee answers anything, in any language, with no output schema — its reply is the text itself. '
      + 'It still passes the audit chain and the budget, it holds no gateway tools, and the sensitivity router keeps '
      + 'customer and restricted content away from DeepSeek, which is declared without a DPA and without a no-training '
      + 'guarantee. Treat what you type to it as leaving the building.',
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
    sensitivity: 'internal',
    // The two flags this employee exists for.
    freeform: true,
    chain: [{ provider: 'deepseek', model: s.model }],
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
    audit({ actorType: 'system', actorId: actor, action: 'agent.registered', subjectType: 'agent', subjectId: ORACLE_ID, payload: { freeform: true, provider: 'deepseek' } });
  }
  return oracleSettings();
}

/** Settings writes come through here so the roster row never drifts from them. */
export function setOracle({ enabled, model, persona, name, apiKey, actor }) {
  if (!actor) { const e = new Error('changing the consultant carries a name'); e.status = 400; throw e; }
  if (enabled !== undefined) setSetting('ORACLE_ENABLED', enabled ? 'true' : 'false');
  if (model !== undefined && model !== null && model !== '') {
    if (!ORACLE_MODELS.includes(model)) { const e = new Error(`unknown model: ${model}`); e.status = 400; throw e; }
    setSetting('ORACLE_MODEL', model);
  }
  if (persona !== undefined) setSetting('ORACLE_PERSONA', String(persona || '').slice(0, 6000) || null);
  if (name !== undefined) setSetting('ORACLE_NAME', String(name || '').slice(0, 60) || null);
  // The key is a secret like any other provider key: stored, never echoed.
  if (apiKey !== undefined && apiKey !== null && apiKey !== '') setSetting(KEY, String(apiKey).trim());
  if (apiKey === '') setSetting(KEY, null);

  const after = seedOracle({ actor });
  audit({
    actorType: 'human', actorId: actor, action: 'oracle.configured', subjectType: 'agent', subjectId: ORACLE_ID,
    // The key itself is never in the payload — only whether one is now present.
    payload: { enabled: after.enabled, model: after.model, keyConfigured: after.keyConfigured },
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
