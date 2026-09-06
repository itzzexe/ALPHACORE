// The company floor — where humans and AI employees talk in the same rooms.
//
// This is not a chatbot bolted onto a dashboard. It is the same workforce that
// runs the departments, reachable by name: mention an employee and it wakes up,
// reads the room, answers in the channel, and — if what you asked for is work
// rather than conversation — does it, within the actions its role allows.
//
// Three rules hold the thing together:
//   1. A mention is a summons. @AGT-DOC-001 puts that agent's run on the queue
//      with the last of the conversation as context; nobody else is woken.
//   2. An agent may only take actions its role is allowed to take. The catalogue
//      is per role group, checked here, and refused in the channel in the open
//      when it does not apply — a refusal everyone can read is a feature.
//   3. Everything said and done lands on the audit chain like any other work.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { DIVISIONS, sectionCatalog } from './links.js';
import { openPii } from './erasure.js';

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const J = (v, d = null) => { try { return JSON.parse(v); } catch { return d; } };
const clean = (s) => String(s || '').trim();

// ---------- who is in the building ----------
export function roster() {
  const agents = q("SELECT id, name, role_group, status, model_tier FROM agents ORDER BY id").map((a) => ({
    id: a.id, name: a.name, kind: 'agent', role: a.role_group, status: a.status,
    busy: one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state IN ('queued','leased','running')", a.id).n,
    can: allowedActions(a.id).map((x) => x.id),
  }));
  const humans = q("SELECT username, display_name, role, status FROM users ORDER BY id").map((u) => ({
    id: `human:${u.username}`, name: u.display_name || u.username, kind: 'human', role: u.role, status: u.status,
  }));
  return { humans, agents };
}

// ---------- what an employee may do from a conversation ----------
// Role groups earn different powers. This is deliberately narrower than what
// the department pages allow: a sentence in a chat window is a low-ceremony
// input, so it may start work and never, for example, sign or publish.
const ACTIONS = {
  'task.delegate': {
    roles: ['steer', 'run', 'assure', 'discover', 'build', 'create', '*'],
    describe: 'delegate a task to an AI employee — {title, details, agentId}',
    async run(p, ctx) {
      const { createTask } = await import('./pm.js');
      const t = createTask({ title: p.title, details: p.details || ctx.body, assigneeType: 'agent', assigneeId: p.agentId || ctx.author, priority: p.priority || 'normal', actor: ctx.actor });
      return { text: `task #${t.id} created for ${p.agentId || ctx.author}`, ref: { type: 'task', id: t.id, label: p.title } };
    },
  },
  'workstream.start': {
    roles: ['steer', 'discover', 'build', 'assure', '*'],
    describe: 'start an iterating workstream — {title, goal, route[], method}',
    async run(p, ctx) {
      const { createWorkstream } = await import('./cycles.js');
      const id = createWorkstream({
        title: p.title, goal: p.goal || ctx.body, method: p.method || 'kaizen',
        route: p.route || ['research', 'docs'], actor: ctx.actor,
      });
      return { text: `workstream #${id} started — produce → review → audit, on repeat`, ref: { type: 'workstream', id, label: p.title } };
    },
  },
  'audit.request': {
    roles: ['assure', 'steer', '*'],
    describe: 'send something to the independent auditor — {subjectType, subjectId}',
    async run(p, ctx) {
      const { requestAudit } = await import('./cycles.js');
      const id = requestAudit({ subjectType: p.subjectType, subjectId: p.subjectId, dept: p.dept || null, actor: ctx.actor });
      return { text: `audit #${id} opened on ${p.subjectType} #${p.subjectId}`, ref: { type: 'audit', id, label: 'audit' } };
    },
  },
  'eval.run': {
    roles: ['assure', 'steer', '*'],
    describe: 'run the golden/canary set on an employee — {agentId}',
    async run(p, ctx) {
      const { runEvalSet } = await import('./evals.js');
      const r = await runEvalSet(p.agentId, ctx.actor);
      return { text: `eval ${p.agentId}: ${Math.round(r.score * 100)}%`, ref: { type: 'eval', id: p.agentId, label: 'evals' } };
    },
  },
  'intel.campaign': {
    roles: ['discover', 'steer', '*'],
    describe: 'start an intelligence collection campaign — {question, targetCount}',
    async run(p, ctx) {
      const { createIntelQuery } = await import('./intel.js');
      const iq = createIntelQuery({ question: p.question || ctx.body, criteria: p.criteria || null, targetCount: Math.min(15, Number(p.targetCount) || 8), rules: [], actor: ctx.actor });
      return { text: `collection campaign #${iq.id} running`, ref: { type: 'intelQuery', id: iq.id, label: 'intelligence' } };
    },
  },
  'content.brief': {
    roles: ['create', 'steer', 'discover', '*'],
    describe: 'commission a written piece (draft only) — {kind, title, brief}',
    async run(p, ctx) {
      const { createContent } = await import('./studio.js');
      const c = createContent({ kind: p.kind || 'article', title: p.title, brief: p.brief || ctx.body, actor: ctx.actor });
      return { text: `content #${c.id} drafting`, ref: { type: 'content', id: c.id, label: p.title } };
    },
  },
  'memory.note': {
    roles: ['*'],
    describe: 'write something down so the workforce remembers it — {body}',
    async run(p, ctx) {
      const { remember } = await import('./memory.js');
      const id = remember({ kind: 'lesson', agentId: null, title: 'from the floor', body: p.body || ctx.body, sourceType: 'chat', createdBy: ctx.actor });
      return { text: `noted — lesson #${id} is now retrievable by everyone`, ref: { type: 'memory', id, label: 'memory' } };
    },
  },
  'invoice.create': {
    roles: ['run', 'steer', 'discover', '*'],
    describe: 'invoice a customer in crypto — {description, amount, chain, customerId, dealId}',
    async run(p, ctx) {
      const { createInvoice } = await import('./wallet.js');
      const inv = createInvoice({
        description: p.description || ctx.body, amount: p.amount, chain: p.chain || null,
        customerId: p.customerId || null, dealId: p.dealId || null, actor: ctx.actor,
      });
      return { text: `${inv.ref} issued — ${inv.amount} ${inv.asset} to ${inv.address}. It marks itself paid when the money lands.`, ref: { type: 'invoice', id: inv.id, label: inv.ref } };
    },
  },
  'call.schedule': {
    roles: ['run', 'steer', '*'],
    describe: 'call somebody — {toNumber, purpose, voice, language, customerId}',
    async run(p, ctx) {
      const { scheduleCall } = await import('./comms.js');
      const id = scheduleCall({
        toNumber: p.toNumber, purpose: p.purpose || ctx.body, voice: p.voice || 'ava',
        language: p.language || 'en', customerId: p.customerId || null, actor: ctx.actor,
      });
      return { text: `call #${id} queued to ${p.toNumber} — the script is being written, then a human presses dial`, ref: { type: 'call', id, label: 'contact centre' } };
    },
  },
  'message.send': {
    roles: ['run', 'steer', 'create', '*'],
    describe: 'text somebody — {toNumber, body, channel, customerId}',
    async run(p, ctx) {
      const { sendMessage } = await import('./comms.js');
      const id = sendMessage({
        toNumber: p.toNumber, body: p.body || null, channel: p.channel || 'sms',
        customerId: p.customerId || null, draftWith: p.body ? null : ctx.author, actor: ctx.actor,
      });
      return { text: `message #${id} queued to ${p.toNumber}`, ref: { type: 'sms', id, label: 'contact centre' } };
    },
  },
  'money.status': {
    roles: ['*'],
    describe: 'report the cash position and runway — {}',
    async run() {
      const { moneyDesk } = await import('./money.js');
      const d = moneyDesk();
      return { text: `Recurring $${d.position.recurringUsd}/mo against a burn of $${d.position.burnMonthlyUsd}/mo — runway ${d.position.runwayMonths ?? '∞'} months. ${d.alerts[0].text}`, ref: { type: 'money', id: 'desk', label: 'money desk' } };
    },
  },
  'treasury.check': {
    roles: ['*'],
    describe: 'report what the company has been paid — {}',
    async run(_p, _ctx) {
      const { treasuryOverview } = await import('./wallet.js');
      const t = treasuryOverview();
      const bal = t.wallets.map((w) => `${w.balance} ${w.asset}`).join(', ') || 'no wallets yet';
      return { text: `Treasury (${t.mode}): ${bal}. ${t.stats.paid} invoice(s) paid, ${t.stats.open} open${t.stats.unmatched ? `, ${t.stats.unmatched} unattributed payment(s)` : ''}.`, ref: { type: 'wallet', id: 'all', label: 'treasury' } };
    },
  },
  'incident.open': {
    roles: ['run', 'assure', 'steer', '*'],
    describe: 'open an incident — {title, sev}',
    async run(p, ctx) {
      const { openIncident } = await import('./incidents.js');
      const i = openIncident({ title: p.title || ctx.body, sev: p.sev || 'SEV3', actor: ctx.actor });
      return { text: `incident #${i.id} opened (${p.sev || 'SEV3'})`, ref: { type: 'incident', id: i.id, label: p.title } };
    },
  },
};

const roleOf = (agentId) => one('SELECT role_group FROM agents WHERE id = ?', agentId)?.role_group || '';
/** The executive stands in for the owner, so it inherits the whole catalogue. */
export const allowedActions = (agentId) => {
  const role = roleOf(agentId);
  // A free-form employee is an adviser, and the trade is explicit: it may
  // discuss anything, and it may do nothing. It answers in prose rather than
  // in an envelope, so there is nowhere for it to put an action in the first
  // place — this makes that a rule instead of a consequence of the format.
  let spec = {};
  try { spec = JSON.parse(one('SELECT spec FROM agents WHERE id = ?', agentId)?.spec || '{}'); } catch { /* defaults */ }
  if (spec.freeform) return [];
  const all = agentId === 'AGT-EXE-001' || agentId === 'AGT-ORC-001';
  return Object.entries(ACTIONS)
    .filter(([, a]) => all || a.roles.includes(role))
    .map(([id, a]) => ({ id, describe: a.describe }));
};

// ---------- rooms ----------
export function ensureChannels() {
  const add = (key, name, topic, kind, division = null) => {
    if (one('SELECT id FROM chat_channels WHERE key = ?', key)) return;
    exec('INSERT INTO chat_channels (key, name, topic, kind, division) VALUES (?,?,?,?,?)', key, name, topic, kind, division);
  };
  add('general', 'general', 'The whole company — humans and AI employees. Mention anyone by name to bring them in.', 'public');
  add('work', 'work', 'Ask for work to be started, follow what is running.', 'public');
  add('incidents', 'incidents', 'When something is broken, it is discussed here.', 'public');
  for (const d of DIVISIONS) add(`div-${d.id}`, d.label.toLowerCase(), `${d.label} division`, 'division', d.id);
}

export function listChannels(me) {
  return q("SELECT * FROM chat_channels WHERE archived = 0 ORDER BY kind = 'dm', id").map((c) => {
    const last = one('SELECT id, body, author_id, created_at FROM chat_messages WHERE channel_id = ? AND state != \'deleted\' ORDER BY id DESC LIMIT 1', c.id);
    const seen = one('SELECT last_seen FROM chat_reads WHERE channel_id = ? AND member_id = ?', c.id, me)?.last_seen || 0;
    return {
      ...c,
      last,
      unread: one('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ? AND id > ? AND author_id != ? AND state != \'deleted\'', c.id, seen, me).n,
    };
  });
}

export function openDm(me, otherId) {
  const pair = [me, otherId].sort().join('|');
  const key = `dm-${pair}`;
  let ch = one('SELECT * FROM chat_channels WHERE key = ?', key);
  if (!ch) {
    const label = otherId.startsWith('human:') ? otherId.replace('human:', '') : otherId;
    exec("INSERT INTO chat_channels (key, name, topic, kind) VALUES (?,?,?,'dm')", key, label, `Direct messages with ${label}`);
    ch = one('SELECT * FROM chat_channels WHERE key = ?', key);
    exec('INSERT OR IGNORE INTO chat_members (channel_id, member_id, kind) VALUES (?,?,?)', ch.id, me, 'human');
    exec('INSERT OR IGNORE INTO chat_members (channel_id, member_id, kind) VALUES (?,?,?)', ch.id, otherId, otherId.startsWith('human:') ? 'human' : 'agent');
  }
  return ch;
}

/** A channel bolted to a piece of work: the discussion lives with the thing. */
export function channelFor(subjectType, subjectId, name) {
  const key = `${subjectType}-${subjectId}`;
  let ch = one('SELECT * FROM chat_channels WHERE key = ?', key);
  if (!ch) {
    exec("INSERT INTO chat_channels (key, name, topic, kind, subject_type, subject_id) VALUES (?,?,?,'subject',?,?)",
      key, name || key, `Discussion about ${subjectType} #${subjectId}`, subjectType, String(subjectId));
    ch = one('SELECT * FROM chat_channels WHERE key = ?', key);
  }
  return ch;
}

export function messages(channelId, { since = 0, limit = 120 } = {}) {
  const rows = q(`SELECT * FROM chat_messages WHERE channel_id = ? AND id > ? ORDER BY id DESC LIMIT ?`, channelId, since, limit).reverse();
  return rows.map((m) => ({
    ...m,
    mentions: J(m.mentions, []),
    refs: J(m.refs, []),
    action: J(m.action, null),
    reactions: q('SELECT emoji, COUNT(*) AS n, GROUP_CONCAT(actor) AS who FROM chat_reactions WHERE message_id = ? GROUP BY emoji', m.id),
    replies: one('SELECT COUNT(*) AS n FROM chat_messages WHERE parent_id = ?', m.id).n,
  }));
}

// ---------- speaking ----------
const MENTION_RE = /@([A-Za-z0-9_.\-]+)/g;
function parseMentions(body) {
  const out = new Set();
  for (const m of String(body).matchAll(MENTION_RE)) {
    const raw = m[1];
    const agent = one('SELECT id FROM agents WHERE id = ? COLLATE NOCASE', raw)
      || one("SELECT id FROM agents WHERE replace(lower(name),' ','') = ? COLLATE NOCASE", raw.toLowerCase());
    if (agent) { out.add(agent.id); continue; }
    const user = one('SELECT username FROM users WHERE username = ? COLLATE NOCASE', raw);
    if (user) { out.add(`human:${user.username}`); continue; }
    if (['here', 'channel', 'everyone', 'all'].includes(raw.toLowerCase())) out.add('@channel');
  }
  return [...out];
}

export function post({ channelId, body, parentId = null, actor, authorKind = 'human', refs = null, action = null, runId = null, state = 'sent' }) {
  const text = clean(body);
  if (!text) throw new Error('a message needs words');
  if (!one('SELECT id FROM chat_channels WHERE id = ?', channelId)) throw new Error('no such channel');
  const mentions = parseMentions(text);
  exec(`INSERT INTO chat_messages (channel_id, parent_id, author_id, author_kind, body, mentions, refs, action, run_id, state)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    channelId, parentId, actor, authorKind, text, JSON.stringify(mentions),
    refs ? JSON.stringify(refs) : null, action ? JSON.stringify(action) : null, runId, state);
  const id = lastId();
  audit({ actorType: authorKind === 'human' ? 'human' : 'agent', actorId: actor, action: 'chat.posted', subjectType: 'chat', subjectId: id, payload: { channelId, mentions, chars: text.length } });

  for (const m of mentions) {
    if (m.startsWith('human:') && m !== actor) {
      notify({ level: 'info', source: 'chat', message: `${actor} mentioned you: ${text.slice(0, 120)}`, subjectType: 'chat', subjectId: id });
    }
  }
  // Only a person starts a conversation turn. An employee's own message never
  // wakes another one, which is what keeps two agents from talking forever.
  if (authorKind === 'human') {
    for (const who of respondersFor({ channelId, mentions, actor })) {
      wakeAgent(who, { channelId, messageId: id, body: text, actor });
    }
  }
  return one('SELECT * FROM chat_messages WHERE id = ?', id);
}

/**
 * Who answers this message.
 *
 * Naming somebody still summons exactly them. But a room where you must write
 * an ID before anyone will speak is not a conversation, so:
 *   • in a direct message the other party always answers;
 *   • @here brings in a few of the division's employees;
 *   • otherwise whoever spoke last keeps the thread, and if the room is cold
 *     the department that owns the channel picks it up.
 */
function respondersFor({ channelId, mentions, actor }) {
  const active = (id) => one("SELECT id FROM agents WHERE id = ? AND status = 'active'", id)?.id;
  const named = mentions.filter((m) => !m.startsWith('human:') && m !== '@channel').map(active).filter(Boolean);
  if (named.length) return [...new Set(named)];

  const ch = one('SELECT * FROM chat_channels WHERE id = ?', channelId);
  if (!ch) return [];

  // A direct message has exactly one counterpart, and it is always listening.
  if (ch.kind === 'dm') {
    const other = String(ch.key).replace(/^dm-/, '').split('|').find((x) => x !== actor);
    const a = other && !other.startsWith('human:') ? active(other) : null;
    return a ? [a] : [];
  }

  const inDivision = (div, limit) => q(
    `SELECT a.id FROM agents a WHERE a.status = 'active' AND a.id IN (
       SELECT id FROM agents WHERE role_group = ? ) ORDER BY a.id LIMIT ?`,
    DIV_ROLE[div] || 'steer', limit,
  ).map((r) => r.id);

  if (mentions.includes('@channel')) {
    const some = ch.division ? inDivision(ch.division, 3) : [];
    return some.length ? some : [host()].filter(Boolean);
  }

  // Continuity: if an employee spoke here recently, it owns the thread.
  const recent = one(`SELECT author_id FROM chat_messages
    WHERE channel_id = ? AND author_kind = 'agent' AND state = 'sent'
      AND created_at >= datetime('now','-45 minutes')
    ORDER BY id DESC LIMIT 1`, channelId);
  if (recent && active(recent.author_id)) return [recent.author_id];

  // Cold room: the division that owns it answers, or the executive hosts.
  const owner = ch.division ? inDivision(ch.division, 1)[0] : null;
  return [owner || host()].filter(Boolean);
}

/** Divisions map onto the role groups this workforce actually uses. */
const DIV_ROLE = {
  engine: 'run', build: 'build', decide: 'assure', data: 'discover', create: 'create',
  commerce: 'run', capital: 'steer', operate: 'run', talent: 'steer', trust: 'assure',
  exec: 'steer', govern: 'steer',
};
/** Whoever keeps the room when nobody else owns it. */
const host = () => one("SELECT id FROM agents WHERE id = 'AGT-EXE-001' AND status = 'active'")?.id
  || one("SELECT id FROM agents WHERE status = 'active' AND role_group = 'steer' ORDER BY id LIMIT 1")?.id
  || one("SELECT id FROM agents WHERE status = 'active' ORDER BY id LIMIT 1")?.id;

/** Put a mentioned employee on the queue with the room's recent context. */
function wakeAgent(agentId, { channelId, messageId, body, actor }) {
  const ch = one('SELECT * FROM chat_channels WHERE id = ?', channelId);
  const history = q(`SELECT author_id, body FROM chat_messages WHERE channel_id = ? AND state != 'deleted' AND id <= ? ORDER BY id DESC LIMIT 12`, channelId, messageId)
    .reverse().map((m) => `${m.author_id}: ${m.body}`).join('\n');
  const can = allowedActions(agentId);
  const who = one('SELECT name, role_group FROM agents WHERE id = ?', agentId);
  // "What are you doing?" deserves a true answer, so the employee is told what
  // it actually has open before it is asked to speak.
  const jobs = q("SELECT task_type, state FROM runs WHERE agent_id = ? AND state IN ('queued','leased','running','awaiting_human') ORDER BY id DESC LIMIT 4", agentId);
  const tasks = q("SELECT title FROM tasks WHERE assignee_id = ? AND state NOT IN ('done','cancelled') LIMIT 3", agentId);
  const load = [
    jobs.length ? `${jobs.length} run(s) in flight (${jobs.map((j) => `${j.task_type}:${j.state}`).join(', ')})` : null,
    tasks.length ? `open tasks: ${tasks.map((t) => t.title).join('; ')}` : null,
  ].filter(Boolean).join(' · ') || 'nothing in flight right now';
  // A free-form employee is asked for words, not for an envelope. It holds no
  // actions, so there is nothing for the JSON to carry, and demanding one is
  // the difference between an answer and a serialised object in the channel.
  let spec = {};
  try { spec = JSON.parse(one('SELECT spec FROM agents WHERE id = ?', agentId)?.spec || '{}'); } catch { /* defaults */ }
  if (spec.freeform) {
    const runId = enqueueRun({
      agentId,
      taskType: `chat:${channelId}:${messageId}`,
      input: {
        prompt: `You are in ${ch.kind === 'dm' ? 'a direct message' : `the #${ch.name} channel`} with ${actor.replace('human:', '')}.

RECENT CONVERSATION
${history}

Answer the last message. Write the answer itself — no JSON, no envelope, no preamble.`,
      },
      actor: `chat:${actor}`,
    });
    exec(`INSERT INTO chat_messages (channel_id, parent_id, author_id, author_kind, body, run_id, state)
          VALUES (?,?,?,'agent','…', ?, 'thinking')`, channelId, null, agentId, runId);
    return runId;
  }

  const runId = enqueueRun({
    agentId,
    taskType: `chat:${channelId}:${messageId}`,
    input: {
      prompt: `You are ${agentId}${who ? ` (${who.name}, ${who.role_group})` : ''}, and you work here. You are in ${ch.kind === 'dm' ? 'a direct message' : `the #${ch.name} channel`} with ${actor.replace('human:', '')}.

RECENT CONVERSATION
${history}

Answer the last message the way a colleague would in a chat window: in the person's own language, one or two sentences unless more is genuinely needed, no greeting boilerplate, no restating your job title, no bullet lists for a simple question. If they are making small talk, make small talk back. If they ask what you are doing, tell them what you actually have on: ${load}. If you do not know something, say so in one line.

If what they asked for is WORK rather than conversation, you may also take exactly one action from the list you are allowed:
${can.length ? can.map((a) => `- ${a.id}: ${a.describe}`).join('\n') : '(your role has no actions from chat — say so plainly if asked to do something)'}

Reply as JSON:
{"text": "<what you say in the channel>", "action": {"id": "<action id>", "params": {…}} or null}
Most messages are conversation, not instructions — leave action null unless you are genuinely being asked to start work. Never claim to have done something you did not do.`,
    },
    actor: `chat:${actor}`,
  });
  exec(`INSERT INTO chat_messages (channel_id, parent_id, author_id, author_kind, body, run_id, state)
        VALUES (?,?,?,'agent','…', ?, 'thinking')`, channelId, null, agentId, runId);
  return runId;
}

/**
 * What a stopped run says in the channel.
 *
 * Two things end a run at the human gate without producing a word: the budget
 * hard-stop and an exhausted router. Both are the company's problem rather
 * than the employee's, and both have a fix somebody can act on — so the
 * sentence names the cause and where to go, instead of a shrug.
 */
function stoppedText(run, out) {
  const why = clean(run.failure_reason);
  const raw = clean(out?.raw);
  if (/router exhausted/i.test(why)) {
    return 'I could not answer: no model provider is available to me right now. '
      + 'Settings → AI providers: add a key (DeepSeek, Anthropic, OpenAI…) or turn on a local model, and ask me again.';
  }
  if (/budget/i.test(why)) {
    return 'I could not answer: the spending cap for this period has been reached, so my run was stopped before it ran. '
      + 'Budgets holds the caps, and Approvals holds anything waiting on a person.';
  }
  // Everything else that lands at the gate did produce text — a refusal, or a
  // reply that failed its schema. The words are the answer; show them.
  if (raw) return raw.slice(0, 1200);
  return why ? `I stopped and this needs a person: ${why}` : 'I stopped and this needs a person.';
}

/**
 * The reply, out of whatever the employee actually returned.
 *
 * A model told to answer in one shape and asked for another will pick one, so
 * the reply may arrive as `text`, as a role field like `summary` or
 * `markdown`, or as plain prose that never was JSON. All three are answers.
 * What must never reach the channel is the JSON envelope itself: a person
 * asked a colleague a question and a serialised object is not a reply.
 */
function readReply(parsed, out, run) {
  const named = clean(parsed?.text || parsed?.reply || parsed?.answer || parsed?.draft
    || parsed?.body || parsed?.summary || parsed?.markdown || parsed?.article || parsed?.note);
  if (named) return named;

  // Prose that was never JSON — the free-form employee's whole output, and
  // what most models return when they ignore a schema they were given.
  const raw = clean(out?.raw);
  if (raw && !raw.startsWith('{') && !raw.startsWith('[')) return raw.slice(0, 4000);

  // JSON with nothing human in it. Say so rather than pasting the object.
  if (parsed && typeof parsed === 'object') {
    const fields = Object.keys(parsed).slice(0, 6).join(', ');
    return `I answered in my working format rather than in words${fields ? ` (${fields})` : ''} — the full output is on run ${run.id}.`;
  }
  if (raw) return raw.slice(0, 4000);
  return `I have nothing to show for that — run ${run.id} finished without output.`;
}

// ---------- the tick: land what employees came back with ----------
export async function syncChat() {
  for (const m of q("SELECT * FROM chat_messages WHERE state = 'thinking' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output, failure_reason FROM runs WHERE id = ?', m.run_id);
    if (!run) { exec("UPDATE chat_messages SET state='failed', body='(the run vanished)' WHERE id = ?", m.id); continue; }
    if (['queued', 'leased', 'running'].includes(run.state)) continue;
    if (['failed', 'cancelled'].includes(run.state)) {
      exec("UPDATE chat_messages SET state='failed', body=? WHERE id = ?", `I could not answer: ${run.failure_reason || run.state}`, m.id);
      continue;
    }
    let out = null;
    let parsed = null;
    try {
      out = JSON.parse(openPii(run.output) || 'null');
      parsed = out?.parsed || (typeof out?.raw === 'string' ? JSON.parse(out.raw) : null);
    } catch { /* falls through to the raw text below */ }

    // A run that stopped for a person is not an answer, and it used to arrive
    // in the channel as "(no answer)" — the two paths that end this way, a
    // budget hard-stop and an exhausted router, both set a reason and no
    // output at all. Somebody reading a chat window has no way to guess that
    // the company ran out of money or has no provider key, so it is said.
    if (run.state === 'awaiting_human') {
      exec("UPDATE chat_messages SET state='failed', body=? WHERE id = ?", stoppedText(run, out), m.id);
      continue;
    }

    const text = readReply(parsed, out, run);

    let action = null;
    let refs = null;
    const want = parsed?.action;
    if (want?.id) {
      const spec = ACTIONS[want.id];
      const may = allowedActions(m.author_id).some((a) => a.id === want.id);
      if (!spec) action = { id: want.id, ok: false, detail: 'no such action' };
      else if (!may) action = { id: want.id, ok: false, detail: `${m.author_id} is not allowed to do this from chat` };
      else {
        try {
          const res = await spec.run(want.params || {}, { actor: m.author_id, author: m.author_id, body: text });
          action = { id: want.id, ok: true, detail: res.text };
          refs = res.ref ? [res.ref] : null;
          audit({ actorType: 'agent', actorId: m.author_id, action: 'chat.acted', subjectType: 'chat', subjectId: m.id, payload: { action: want.id, detail: res.text } });
        } catch (e) {
          action = { id: want.id, ok: false, detail: String(e.message).slice(0, 200) };
        }
      }
    }
    exec("UPDATE chat_messages SET state='sent', body=?, action=?, refs=? WHERE id = ?",
      text, action ? JSON.stringify(action) : null, refs ? JSON.stringify(refs) : null, m.id);
  }
}

// ---------- the small courtesies a chat needs ----------
export function react(messageId, { emoji, actor }) {
  if (!one('SELECT id FROM chat_messages WHERE id = ?', messageId)) throw new Error('no such message');
  const had = one('SELECT id FROM chat_reactions WHERE message_id = ? AND actor = ? AND emoji = ?', messageId, actor, emoji);
  if (had) exec('DELETE FROM chat_reactions WHERE id = ?', had.id);
  else exec('INSERT INTO chat_reactions (message_id, actor, emoji) VALUES (?,?,?)', messageId, actor, emoji);
  return { on: !had };
}

export function editMessage(id, { body, actor }) {
  const m = one('SELECT * FROM chat_messages WHERE id = ?', id);
  if (!m) throw new Error('no such message');
  if (m.author_id !== actor) throw new Error('you can only edit what you wrote');
  exec("UPDATE chat_messages SET body = ?, mentions = ?, edited_at = datetime('now') WHERE id = ?", clean(body), JSON.stringify(parseMentions(body)), id);
  audit({ actorType: 'human', actorId: actor, action: 'chat.edited', subjectType: 'chat', subjectId: id });
}

export function deleteMessage(id, { actor, isOwner = false }) {
  const m = one('SELECT * FROM chat_messages WHERE id = ?', id);
  if (!m) throw new Error('no such message');
  if (m.author_id !== actor && !isOwner) throw new Error('you can only delete what you wrote');
  exec("UPDATE chat_messages SET state = 'deleted', body = '(deleted)' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'chat.deleted', subjectType: 'chat', subjectId: id });
}

export function pin(id, { actor }) {
  const m = one('SELECT pinned FROM chat_messages WHERE id = ?', id);
  if (!m) throw new Error('no such message');
  exec('UPDATE chat_messages SET pinned = ? WHERE id = ?', m.pinned ? 0 : 1, id);
  audit({ actorType: 'human', actorId: actor, action: m.pinned ? 'chat.unpinned' : 'chat.pinned', subjectType: 'chat', subjectId: id });
  return { pinned: !m.pinned };
}

export function markRead(channelId, { actor }) {
  const last = one('SELECT MAX(id) AS m FROM chat_messages WHERE channel_id = ?', channelId)?.m || 0;
  exec('INSERT INTO chat_reads (channel_id, member_id, last_seen) VALUES (?,?,?) ON CONFLICT(channel_id, member_id) DO UPDATE SET last_seen = excluded.last_seen', channelId, actor, last);
  return { lastSeen: last };
}

export function search(term, { limit = 40 } = {}) {
  const t = `%${clean(term)}%`;
  return q(`SELECT m.*, c.name AS channel FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id
            WHERE m.state != 'deleted' AND m.body LIKE ? ORDER BY m.id DESC LIMIT ?`, t, limit);
}

/** Everything a human needs to open the room: channels, roster, catalogue. */
export function chatOverview(me) {
  return {
    channels: listChannels(me),
    roster: roster(),
    actions: Object.entries(ACTIONS).map(([id, a]) => ({ id, describe: a.describe, roles: a.roles })),
    sections: sectionCatalog().map((s) => ({ id: s.id, label: s.label, href: s.href })),
    stats: {
      messages: one('SELECT COUNT(*) AS n FROM chat_messages').n,
      fromAgents: one("SELECT COUNT(*) AS n FROM chat_messages WHERE author_kind = 'agent'").n,
      actionsTaken: one("SELECT COUNT(*) AS n FROM chat_messages WHERE action IS NOT NULL").n,
      thinking: one("SELECT COUNT(*) AS n FROM chat_messages WHERE state = 'thinking'").n,
    },
  };
}
