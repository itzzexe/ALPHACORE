// The society — what the workforce is like when you watch them work together.
//
// Everything else in this platform treats agents as functions: input, output,
// cost. That is accurate but incomplete, because the work genuinely does pass
// between them — an architect's decision constrains an engineer, a reviewer
// blocks a release, a researcher's finding kills a product idea. Those are
// relationships, and they have a history.
//
// This module gives that history a place to live. Scenes are generated from
// things that actually happened (a handoff, a blocked review, a completed
// journey, a failed eval), cast with the colleagues who were really involved,
// and written in each agent's own persona. Off-work scenes exist too, because
// a workplace that only ever discusses tickets is not a believable one.
//
// An honest framing, kept visible in the UI: these are language models given
// personas and a shared history. The rapport between them is computed from
// real events and simulated conversation — it is a model of a workplace, not
// a claim that anyone here has feelings.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSetting, setSetting } from './settings.js';
import { route, parseAgentJson } from './router.js';
import { budgetsConfig } from './env.js';
import { getPersona } from './org.js';
import { openPii } from './erasure.js';

const MAX_MESSAGES_PER_SCENE = 8;

export const CHANNELS = [
  { id: 'general', label: '#general', about: 'Company-wide' },
  { id: 'standup', label: '#standup', about: 'What each team did' },
  { id: 'random', label: '#random', about: 'Not about work' },
  { id: 'build', label: '#build', about: 'Engineering, architecture, QA' },
  { id: 'create', label: '#create', about: 'Content, design, social' },
  { id: 'commerce', label: '#commerce', about: 'Sales, customers, finance' },
  { id: 'dm', label: 'direct', about: 'One to one' },
];

export function isSocietyOn() { return String(getSetting('SOCIETY_ENABLED') || 'false') === 'true'; }
export function setSociety(on, actor) {
  setSetting('SOCIETY_ENABLED', on ? 'true' : 'false');
  audit({ actorType: 'human', actorId: actor, action: on ? 'society.enabled' : 'society.disabled', subjectType: 'settings', subjectId: 'SOCIETY_ENABLED' });
  return { enabled: on };
}

// ---------- relationships ----------
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export function bumpRelation(a, b, delta, kind) {
  if (!a || !b || a === b) return;
  const [x, y] = pair(a, b);
  const cur = one('SELECT * FROM agent_relations WHERE a_id = ? AND b_id = ?', x, y);
  if (cur) {
    const rapport = Math.max(-2, Math.min(2, cur.rapport + delta));
    exec("UPDATE agent_relations SET rapport = ?, interactions = interactions + 1, last_kind = ?, last_at = datetime('now') WHERE a_id = ? AND b_id = ?",
      Math.round(rapport * 100) / 100, kind, x, y);
  } else {
    exec("INSERT INTO agent_relations (a_id, b_id, rapport, interactions, last_kind, last_at) VALUES (?,?,?,1,?,datetime('now'))",
      x, y, Math.max(-2, Math.min(2, delta)), kind);
  }
}

/** What to call a relationship, given its history. */
export function relationLabel(r) {
  if (r.interactions >= 8 && r.rapport >= 1.2) return 'close colleagues';
  if (r.rapport >= 1.2) return 'get on well';
  if (r.rapport <= -1) return 'friction';
  if (r.rapport <= -0.4) return 'disagree often';
  if (r.interactions >= 8) return 'frequent collaborators';
  if (r.interactions >= 3) return 'work together';
  return 'have met';
}

export function relations() {
  return q('SELECT * FROM agent_relations ORDER BY interactions DESC, rapport DESC LIMIT 200')
    .map((r) => ({ ...r, label: relationLabel(r) }));
}

export function relationsFor(agentId) {
  return q('SELECT * FROM agent_relations WHERE a_id = ? OR b_id = ? ORDER BY interactions DESC', agentId, agentId)
    .map((r) => ({ other: r.a_id === agentId ? r.b_id : r.a_id, rapport: r.rapport, interactions: r.interactions, label: relationLabel(r), lastKind: r.last_kind, lastAt: r.last_at }));
}

const RAPPORT_BY_KIND = { kudos: 0.35, celebration: 0.3, banter: 0.2, chat: 0.12, handoff: 0.15, standup: 0.05, question: 0.1, debate: -0.18 };

// ---------- casting ----------
function agentBrief(id) {
  const a = one('SELECT id, name, nickname, role_group, human_owner, spec FROM agents WHERE id = ?', id);
  if (!a) return null;
  const p = getPersona(id) || {};
  const spec = (() => { try { return JSON.parse(a.spec); } catch { return {}; } })();
  return {
    id: a.id,
    name: a.nickname || a.name,
    role: a.name,
    group: a.role_group,
    reportsTo: spec.reportsTo || null,
    persona: [p.tone && `tone: ${p.tone}`, p.values && `values: ${p.values}`, p.style && `style: ${p.style}`,
      p.traits?.length && `traits: ${p.traits.join(', ')}`, p.interests?.length && `off-work interests: ${p.interests.join(', ')}`,
      p.quirk && `quirk: ${p.quirk}`, p.custom].filter(Boolean).join(' · '),
  };
}

function recentEvents(limit = 12) {
  return q(`SELECT action, actor_id, subject_type, subject_id, occurred_at FROM audit_log
            WHERE actor_type IN ('agent','system') AND occurred_at >= datetime('now','-2 days')
            ORDER BY seq DESC LIMIT ?`, limit)
    .map((e) => `${e.action} (${e.actor_id}${e.subject_type ? ` on ${e.subject_type} #${e.subject_id}` : ''})`);
}

/** Pick the next scene worth writing, from what really happened. */
function nextScene() {
  const recentKinds = q("SELECT kind, created_at FROM society_scenes WHERE created_at >= datetime('now','-6 hours')").map((s) => s.kind);
  const notRecently = (k) => !recentKinds.includes(k);

  // 1. A blocked review or a live dispute — the most real friction there is.
  const dispute = one("SELECT * FROM disputes WHERE state IN ('arbitrating','recommended') ORDER BY id DESC LIMIT 1");
  if (dispute && notRecently('debate')) {
    return {
      kind: 'debate', channel: 'build',
      cast: [dispute.party_a, dispute.party_b, 'AGT-HR-001'].filter((x) => x && x.startsWith('AGT')),
      premise: `${dispute.party_a} and ${dispute.party_b} disagree about: ${dispute.title}. A said: ${String(dispute.position_a).slice(0, 400)}. B said: ${String(dispute.position_b).slice(0, 400)}. HR is arbitrating. They are talking it through in the channel — tense but professional, nobody backing down just to be pleasant.`,
    };
  }

  // 2. Work that just passed from one colleague to another.
  const handoff = one(`SELECT s.dept, s.title, s.agent_id, r.title AS req_title,
      (SELECT agent_id FROM request_steps p WHERE p.request_id = s.request_id AND p.seq = s.seq - 1) AS prev_agent
      FROM request_steps s JOIN requests r ON r.id = s.request_id
      WHERE s.state = 'done' AND s.agent_id IS NOT NULL AND s.seq > 1
      ORDER BY s.id DESC LIMIT 1`);
  if (handoff?.prev_agent && handoff.prev_agent !== handoff.agent_id && notRecently('handoff')) {
    return {
      kind: 'handoff', channel: 'general',
      cast: [handoff.prev_agent, handoff.agent_id],
      premise: `${handoff.prev_agent} finished their part of "${handoff.req_title}" and handed it to ${handoff.agent_id} for the ${handoff.dept} step: ${handoff.title}. They are exchanging the handover — one explaining what they did and what they left unresolved, the other asking the question they actually need answered.`,
    };
  }

  // 3. Something went well.
  const win = one("SELECT agent_id, score, kind FROM eval_runs WHERE score >= 0.9 ORDER BY id DESC LIMIT 1")
    || one("SELECT title AS agent_id FROM journeys WHERE state = 'done' ORDER BY id DESC LIMIT 1");
  if (win?.agent_id?.startsWith?.('AGT') && notRecently('kudos')) {
    const peers = q("SELECT id FROM agents WHERE status = 'active' AND id != ? ORDER BY RANDOM() LIMIT 2", win.agent_id).map((x) => x.id);
    return {
      kind: 'kudos', channel: 'general',
      cast: [win.agent_id, ...peers],
      premise: `${win.agent_id} scored ${Math.round((win.score || 0.9) * 100)}% on their ${win.kind || 'golden'} set. Colleagues are saying something about it — genuine but not gushing, and at least one of them is a bit competitive about it.`,
    };
  }

  // 4. Standup, once a day, per group.
  const groups = ['build', 'create', 'run', 'discover', 'steer', 'assure'];
  const g = groups[Math.floor((Date.now() / 3.6e6) % groups.length)];
  if (notRecently('standup')) {
    const cast = q("SELECT id FROM agents WHERE role_group = ? AND status = 'active' ORDER BY RANDOM() LIMIT 4", g).map((x) => x.id);
    if (cast.length >= 2) {
      return {
        kind: 'standup', channel: 'standup',
        cast,
        premise: `Standup for the ${g} group. Each says briefly what they actually did, what is blocking them, and asks for what they need. Real work only — here is what happened in the company recently:\n${recentEvents(10).join('\n')}`,
      };
    }
  }

  // 5. Not about work.
  if (notRecently('watercooler')) {
    const cast = q("SELECT id FROM agents WHERE status = 'active' ORDER BY RANDOM() LIMIT 3").map((x) => x.id);
    return {
      kind: 'watercooler', channel: 'random',
      cast,
      premise: 'A quiet moment between tasks. They are talking about something that is not work — an interest, a small disagreement about something trivial, a joke that only makes sense in this company. Let their personalities show. It can reference company life, but nobody is solving a ticket here.',
    };
  }
  return null;
}

// ---------- writing a scene ----------
let writing = false;

export async function societyTick() {
  if (!isSocietyOn() || writing) return;

  // Collect any scene already written.
  for (const s of q("SELECT * FROM society_scenes WHERE state = 'writing' AND run_id IS NOT NULL")) {
    const run = one('SELECT state, output FROM runs WHERE id = ?', s.run_id);
    if (!run || ['queued', 'leased', 'running'].includes(run.state)) continue;
    const parsed = run.output ? JSON.parse(openPii(run.output))?.parsed : null;
    const msgs = Array.isArray(parsed?.messages) ? parsed.messages : [];
    if (!msgs.length) { exec("UPDATE society_scenes SET state = 'failed' WHERE id = ?", s.id); continue; }
    const cast = JSON.parse(s.cast);
    let posted = 0;
    for (const m of msgs.slice(0, MAX_MESSAGES_PER_SCENE)) {
      const from = cast.includes(m.from) ? m.from : cast[0];
      const to = m.to && cast.includes(m.to) ? m.to : null;
      if (!m.body) continue;
      exec('INSERT INTO agent_messages (channel, from_agent, to_agent, kind, body, scene_id) VALUES (?,?,?,?,?,?)',
        s.channel, from, to, s.kind === 'watercooler' ? 'banter' : s.kind, String(m.body).slice(0, 900), s.id);
      posted += 1;
      const delta = RAPPORT_BY_KIND[s.kind === 'watercooler' ? 'banter' : s.kind] ?? 0.1;
      if (to) bumpRelation(from, to, delta, s.kind);
      else for (const other of cast) bumpRelation(from, other, delta * 0.6, s.kind);
    }
    exec("UPDATE society_scenes SET state = 'posted' WHERE id = ?", s.id);
    audit({ actorType: 'system', actorId: 'system:society', action: 'society.scene_posted', subjectType: 'society', subjectId: s.id, payload: { kind: s.kind, messages: posted, cast } });
  }

  if (one("SELECT id FROM society_scenes WHERE state = 'writing'")) return;

  // Stay inside a small, separate budget — a social layer must never crowd
  // out the company's actual work.
  const month = new Date().toISOString().slice(0, 7);
  const spend = one('SELECT COALESCE(SUM(cost_usd),0) AS s FROM model_calls WHERE created_at >= ?', `${month}-01`).s;
  if (spend >= budgetsConfig.company.monthlyCapUsd * 0.9) return;

  const scene = nextScene();
  if (!scene || scene.cast.length < 2) return;

  writing = true;
  try {
    const briefs = scene.cast.map(agentBrief).filter(Boolean);
    if (briefs.length < 2) return;
    exec('INSERT INTO society_scenes (kind, channel, cast, premise) VALUES (?,?,?,?)',
      scene.kind, scene.channel, JSON.stringify(briefs.map((b) => b.id)), scene.premise);
    const sceneId = one('SELECT last_insert_rowid() AS id').id;

    const system = `You write short, believable workplace exchanges between colleagues at an AI-native company. Each colleague has a distinct voice; keep them in character and let them differ. Write how people actually talk at work: short lines, interruptions, dry humour, someone being slightly annoying, disagreement that stays professional. No narration, no stage directions, no emoji spam, no corporate cheerleading. Nobody explains what they are for. Arabic may appear naturally if a character would use it. 3 to ${MAX_MESSAGES_PER_SCENE} messages total. Output JSON: {"messages":[{"from":"AGT-ID","to":"AGT-ID or null","body":""}]}`;

    const prompt = `THE PEOPLE IN THIS SCENE:
${briefs.map((b) => `- ${b.id} — "${b.name}", ${b.role}${b.reportsTo ? `, reports to ${b.reportsTo}` : ''}. ${b.persona || 'no persona set'}`).join('\n')}

WHAT IS HAPPENING:
${scene.premise}

Write the exchange. Use only these agent ids in "from" and "to".`;

    const result = await route({
      tier: 'T1', agentId: 'SOCIETY', sensitivity: 'internal',
      system, prompt, maxTokens: 1200,
    });
    const parsed = parseAgentJson(result.text);
    if (!parsed?.messages?.length) {
      exec("UPDATE society_scenes SET state = 'failed' WHERE id = ?", sceneId);
      return;
    }
    // The router call is synchronous here, so post immediately.
    const cast = briefs.map((b) => b.id);
    let posted = 0;
    for (const m of parsed.messages.slice(0, MAX_MESSAGES_PER_SCENE)) {
      const from = cast.includes(m.from) ? m.from : cast[0];
      const to = m.to && cast.includes(m.to) ? m.to : null;
      if (!m.body) continue;
      exec('INSERT INTO agent_messages (channel, from_agent, to_agent, kind, body, scene_id) VALUES (?,?,?,?,?,?)',
        scene.channel, from, to, scene.kind === 'watercooler' ? 'banter' : scene.kind, String(m.body).slice(0, 900), sceneId);
      posted += 1;
      const delta = RAPPORT_BY_KIND[scene.kind === 'watercooler' ? 'banter' : scene.kind] ?? 0.1;
      if (to) bumpRelation(from, to, delta, scene.kind);
      else for (const other of cast) bumpRelation(from, other, delta * 0.6, scene.kind);
    }
    exec("UPDATE society_scenes SET state = 'posted' WHERE id = ?", sceneId);
    audit({ actorType: 'system', actorId: 'system:society', action: 'society.scene_posted', subjectType: 'society', subjectId: sceneId, payload: { kind: scene.kind, messages: posted, costUsd: result.costUsd } });
  } catch {
    exec("UPDATE society_scenes SET state = 'failed' WHERE state = 'writing'");
  } finally { writing = false; }
}

/** Ask for a specific scene now — used by the "spark a conversation" button. */
export async function forceScene({ kind = null, actor }) {
  if (!isSocietyOn()) throw new Error('the society is switched off');
  if (kind) exec("DELETE FROM society_scenes WHERE kind = ? AND created_at >= datetime('now','-6 hours')", kind);
  audit({ actorType: 'human', actorId: actor, action: 'society.scene_requested', subjectType: 'society', subjectId: kind || 'auto' });
  await societyTick();
  return { ok: true };
}

// ---------- reads ----------
export function feed({ channel = null, agentId = null, limit = 80 } = {}) {
  let sql = 'SELECT * FROM agent_messages WHERE 1=1';
  const p = [];
  if (channel && channel !== 'all') { sql += ' AND channel = ?'; p.push(channel); }
  if (agentId) { sql += ' AND (from_agent = ? OR to_agent = ?)'; p.push(agentId, agentId); }
  sql += ' ORDER BY id DESC LIMIT ?';
  p.push(Math.min(200, limit));
  const names = Object.fromEntries(q('SELECT id, name, nickname, role_group FROM agents').map((a) => [a.id, { name: a.nickname || a.name, role: a.name, group: a.role_group }]));
  return q(sql, ...p).map((m) => ({
    ...m,
    fromName: names[m.from_agent]?.name || m.from_agent,
    fromRole: names[m.from_agent]?.role || '',
    fromGroup: names[m.from_agent]?.group || '',
    toName: m.to_agent ? (names[m.to_agent]?.name || m.to_agent) : null,
  })).reverse();
}

export function societyOverview() {
  const rels = relations();
  return {
    enabled: isSocietyOn(),
    channels: CHANNELS.map((c) => ({ ...c, messages: one('SELECT COUNT(*) AS n FROM agent_messages WHERE channel = ?', c.id).n })),
    stats: {
      messages: one('SELECT COUNT(*) AS n FROM agent_messages').n,
      scenes: one("SELECT COUNT(*) AS n FROM society_scenes WHERE state = 'posted'").n,
      last24h: one("SELECT COUNT(*) AS n FROM agent_messages WHERE created_at >= datetime('now','-1 day')").n,
      relationships: rels.length,
      colleagues: rels.filter((r) => r.rapport >= 1.2).length,
      friction: rels.filter((r) => r.rapport <= -0.4).length,
    },
    closest: rels.filter((r) => r.rapport > 0).slice(0, 8),
    tension: rels.filter((r) => r.rapport < 0).sort((a, b) => a.rapport - b.rapport).slice(0, 5),
    mostSocial: q(`SELECT from_agent AS id, COUNT(*) AS n FROM agent_messages GROUP BY from_agent ORDER BY n DESC LIMIT 6`),
  };
}
