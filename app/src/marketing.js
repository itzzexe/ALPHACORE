// Marketing — a department, not a posting tool.
//
// The pieces were scattered across the company: campaigns in commerce, words
// in the content studio, pictures in design, rivals in market watch, identity
// in brand. What was missing is the part that makes them a department — who
// the audience is, what promise is being made, which channels are bought with
// what money, what gets published when, and whether any of it returned
// anything. That is what lives here, and every number is a real query.
//
// Its staff are real employees on the roster with their own specialities, so
// "the SEO lead" is someone you can mention in chat and give work to.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { companyName } from './settings.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const clean = (s) => String(s || '').trim();
const r2 = (x) => Number(Number(x || 0).toFixed(2));
const J = (v, d = null) => { try { return JSON.parse(v); } catch { return d; } };

// ---------- the team ----------
// A marketing department is a set of specialities, not one generalist. These
// are hired onto the same roster as everyone else, so they take work through
// tasks, chat and the request desk like any other employee.
const TEAM = [
  { id: 'AGT-MKT-001', name: 'Head of Marketing', speciality: 'strategy', tier: 'T3',
    mission: 'Owns positioning, the plan and the budget. Decides what the company says and to whom.' },
  { id: 'AGT-MKT-002', name: 'Brand & Positioning', speciality: 'positioning', tier: 'T2',
    mission: 'Sharpens the promise, the category and the proof until a stranger understands them in one line.' },
  { id: 'AGT-MKT-003', name: 'Content Strategist', speciality: 'content', tier: 'T2',
    mission: 'Plans the calendar against the funnel: what to publish, for whom, at which stage.' },
  { id: 'AGT-MKT-004', name: 'SEO Lead', speciality: 'seo', tier: 'T2',
    mission: 'Finds the searches worth winning and turns each into a brief a writer can execute.' },
  { id: 'AGT-MKT-005', name: 'Performance Marketer', speciality: 'paid', tier: 'T2',
    mission: 'Buys attention on measurable terms and kills what does not pay for itself.' },
  { id: 'AGT-MKT-006', name: 'Lifecycle & Email', speciality: 'email', tier: 'T2',
    mission: 'Writes the sequences that move a lead from curious to paying, and the ones that keep them.' },
  { id: 'AGT-MKT-007', name: 'Social & Community', speciality: 'social', tier: 'T1',
    mission: 'Runs the public voice day to day and reports what the audience actually reacts to.' },
  { id: 'AGT-MKT-008', name: 'Marketing Analyst', speciality: 'analytics', tier: 'T2',
    mission: 'Owns the funnel numbers and says plainly which channel earned its money and which did not.' },
  { id: 'AGT-MKT-009', name: 'Events Producer', speciality: 'events', tier: 'T2',
    mission: 'Books the room, writes the run-of-show, and makes sure somebody follows up the next morning.' },
  { id: 'AGT-MKT-010', name: 'Press & Media', speciality: 'press', tier: 'T2',
    mission: 'Writes what a journalist would actually print, and never a claim the ledger cannot support.' },
  { id: 'AGT-MKT-011', name: 'Community Lead', speciality: 'community', tier: 'T1',
    mission: 'Knows who advocates for us unpaid, who is unhappy, and what either group is saying today.' },
  { id: 'AGT-MKT-012', name: 'Marketing Operations', speciality: 'ops', tier: 'T2',
    mission: 'Owns the plumbing: tracking, lead scoring, naming conventions, and whether the numbers can be trusted.' },
];

export function seedMarketingTeam() {
  for (const m of TEAM) {
    if (one('SELECT id FROM agents WHERE id = ?', m.id)) continue;
    exec('INSERT INTO agents (id, name, role_group, spec, model_tier, human_owner) VALUES (?,?,?,?,?,?)',
      m.id, m.name, 'create', JSON.stringify({
        id: m.id, name: m.name, roleGroup: 'create', speciality: m.speciality,
        tier: m.tier, mission: m.mission, failMode: 'escalate', confidenceFloor: 0.6,
        system: `You are ${m.name} at ${companyName()}. ${m.mission} You write for a specific audience, you cite the evidence you were given, and you never invent a number.`,
      }), m.tier, 'CMO');
    audit({ actorType: 'system', actorId: 'marketing', action: 'agent.seeded', subjectType: 'agent', subjectId: m.id, payload: { speciality: m.speciality } });
  }
}

const specialist = (speciality) => {
  const m = TEAM.find((x) => x.speciality === speciality);
  return (m && one("SELECT id FROM agents WHERE id = ? AND status = 'active'", m.id)?.id)
    || one("SELECT id FROM agents WHERE status = 'active' AND role_group = 'create' ORDER BY id LIMIT 1")?.id;
};

/** Pull the written result out of a finished run. */
const runText = (runId) => {
  const r = one('SELECT state, output FROM runs WHERE id = ?', runId);
  if (r?.state !== 'done' || !r.output) return null;
  try {
    const o = JSON.parse(r.output);
    const p = o?.parsed || (typeof o?.raw === 'string' ? JSON.parse(o.raw) : null);
    return p || { text: String(o?.raw || '').slice(0, 4000) };
  } catch { return null; }
};

// ---------- who we are talking to ----------
export function createPersona({ name, segment = null, evidence = null, actor }) {
  if (!clean(name)) throw new Error('a persona needs a name');
  const agentId = specialist('strategy');
  // Personas are drafted from what the company actually knows — the customers
  // it has and the organisations intelligence has collected — not from thin air.
  const known = q('SELECT name, plan, mrr_usd FROM customers ORDER BY mrr_usd DESC LIMIT 6').map((c) => `${c.name} (${c.plan || 'no plan'}, $${c.mrr_usd}/mo)`).join('; ');
  const collected = q('SELECT name, sector, country FROM intel_records LIMIT 8').map((r) => `${r.name} — ${r.sector || '?'} ${r.country || ''}`).join('; ');
  const runId = agentId ? enqueueRun({
    agentId, taskType: `persona:${clean(name)}`,
    input: { prompt: `Write a buyer persona named "${clean(name)}"${segment ? ` for the ${segment} segment` : ''}.
Ground it in what this company already knows:
- Existing customers: ${known || 'none yet'}
- Organisations collected by intelligence: ${collected || 'none yet'}
${evidence ? `- Extra evidence given: ${evidence}` : ''}
Reply as JSON {"jobTitle":"...","pains":"...","gains":"...","objections":"...","channels":"where this person actually looks for solutions"}.
Be concrete and specific to this market. Do not invent statistics.` },
    actor,
  }) : null;
  exec('INSERT INTO personas (name, segment, evidence, run_id, created_by) VALUES (?,?,?,?,?)',
    clean(name), segment, evidence, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'marketing.persona_created', subjectType: 'persona', subjectId: id, payload: { name } });
  return id;
}

export function setPersonaState(id, { state, actor }) {
  if (!['draft', 'active', 'retired'].includes(state)) throw new Error('state: draft|active|retired');
  exec('UPDATE personas SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `marketing.persona_${state}`, subjectType: 'persona', subjectId: id });
}

// ---------- what we promise ----------
export function createPositioning({ audience, promise, productId = null, actor }) {
  if (!clean(audience) || !clean(promise)) throw new Error('audience and promise are both required');
  const agentId = specialist('positioning');
  const rivals = q('SELECT name, brief, pricing_note FROM competitors LIMIT 5').map((c) => `${c.name}: ${c.brief || ''} ${c.pricing_note || ''}`).join(' | ');
  const runId = agentId ? enqueueRun({
    agentId, taskType: 'positioning',
    input: { prompt: `Sharpen this positioning until it survives a sceptical reader.
Audience: ${audience}
Promise: ${promise}
Known alternatives in this market: ${rivals || 'none recorded'}
Reply as JSON {"category":"the category we compete in","proof":"why the promise is believable","alternatives":"what they do today instead","tagline":"one line, under 12 words","messages":["three message pillars"]}.
No superlatives without proof. Arabic-market context matters if the audience is Iraqi or Gulf.` },
    actor,
  }) : null;
  exec('INSERT INTO positioning (product_id, audience, promise, run_id, created_by) VALUES (?,?,?,?,?)',
    productId, clean(audience), clean(promise), runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'marketing.positioning_drafted', subjectType: 'positioning', subjectId: id });
  return id;
}

export function approvePositioning(id, { actor }) {
  const p = one('SELECT * FROM positioning WHERE id = ?', id);
  if (!p) throw new Error('no such positioning');
  if (!p.tagline) throw new Error('still being written');
  exec("UPDATE positioning SET state = 'approved' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'marketing.positioning_approved', subjectType: 'positioning', subjectId: id, payload: { tagline: p.tagline } });
}

// ---------- channels and money ----------
export function planChannel({ campaignId, channel, budgetUsd, notes = null, actor }) {
  if (!one('SELECT id FROM campaigns WHERE id = ?', campaignId)) throw new Error('no such campaign');
  exec('INSERT INTO campaign_channels (campaign_id, channel, budget_usd, notes) VALUES (?,?,?,?)',
    campaignId, clean(channel), Number(budgetUsd) || 0, notes);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'marketing.channel_planned', subjectType: 'channel', subjectId: id, payload: { campaignId, channel, budgetUsd } });
  return id;
}

export function recordChannelResult(id, { spent, impressions, clicks, leads, customers, state = null, actor }) {
  const c = one('SELECT * FROM campaign_channels WHERE id = ?', id);
  if (!c) throw new Error('no such channel');
  exec(`UPDATE campaign_channels SET spent_usd = COALESCE(?, spent_usd), impressions = COALESCE(?, impressions),
        clicks = COALESCE(?, clicks), leads = COALESCE(?, leads), customers = COALESCE(?, customers),
        state = COALESCE(?, state) WHERE id = ?`,
  spent ?? null, impressions ?? null, clicks ?? null, leads ?? null, customers ?? null, state, id);
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'marketing.channel_measured', subjectType: 'channel', subjectId: id, payload: { spent, leads, customers } });
}

// ---------- the calendar ----------
export function planContent({ title, channel = 'blog', stage = 'awareness', personaId = null, campaignId = null, dueDate = null, brief = null, actor }) {
  if (!clean(title)) throw new Error('a calendar entry needs a title');
  const owner = specialist(channel === 'email' ? 'email' : channel === 'social' ? 'social' : 'content');
  exec(`INSERT INTO content_calendar (title, channel, persona_id, campaign_id, stage, due_date, owner_agent, brief, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`,
  clean(title), channel, personaId, campaignId, stage, dueDate, owner, brief, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'marketing.content_planned', subjectType: 'calendar', subjectId: id, payload: { title, channel, stage } });
  return id;
}

/** Hand a calendar entry to the content studio and follow it from here. */
export async function commissionContent(id, { actor }) {
  const e = one('SELECT * FROM content_calendar WHERE id = ?', id);
  if (!e) throw new Error('no such calendar entry');
  if (e.content_id) throw new Error('already commissioned');
  const persona = e.persona_id ? one('SELECT * FROM personas WHERE id = ?', e.persona_id) : null;
  const pos = one("SELECT * FROM positioning WHERE state = 'approved' ORDER BY id DESC LIMIT 1");
  const { createContent } = await import('./studio.js');
  const c = createContent({
    kind: e.channel === 'social' ? 'post' : e.channel === 'email' ? 'email' : 'article',
    title: e.title,
    brief: [
      e.brief || `Write the ${e.channel} piece titled "${e.title}".`,
      `Funnel stage: ${e.stage}.`,
      persona ? `Audience: ${persona.name}${persona.job_title ? ` (${persona.job_title})` : ''}. Their pains: ${persona.pains || 'unknown'}. Their objections: ${persona.objections || 'unknown'}.` : null,
      pos ? `Our positioning: ${pos.promise} Tagline: ${pos.tagline || ''} Proof: ${pos.proof || ''}` : null,
    ].filter(Boolean).join('\n'),
    actor,
  });
  exec("UPDATE content_calendar SET content_id = ?, state = 'drafting' WHERE id = ?", c.id, id);
  audit({ actorType: 'human', actorId: actor, action: 'marketing.content_commissioned', subjectType: 'calendar', subjectId: id, payload: { contentId: c.id } });
  return { contentId: c.id };
}

// ---------- search ----------
export function researchKeywords({ topic, language = 'en', actor }) {
  if (!clean(topic)) throw new Error('give a topic to research');
  const agentId = specialist('seo');
  const runId = agentId ? enqueueRun({
    agentId, taskType: `seo:${clean(topic).slice(0, 30)}`,
    input: { prompt: `List the searches worth winning around "${topic}"${language === 'ar' ? ' for an Arabic-speaking market (write the keywords in Arabic)' : ''}.
For each: the intent (informational, commercial or transactional), a rough difficulty from 1-100, and why it is worth our time.
Do not fabricate search volumes — leave volume null unless you are given data.
Reply as JSON {"keywords":[{"keyword":"...","intent":"...","difficulty":40,"why":"..."}]} with 8 to 15 entries.` },
    actor,
  }) : null;
  audit({ actorType: 'human', actorId: actor, action: 'marketing.seo_research', subjectType: 'seo', subjectId: clean(topic), payload: { language } });
  return { runId, topic: clean(topic), language };
}

export function addKeyword({ keyword, language = 'en', intent = null, difficulty = null, targetUrl = null, actor }) {
  if (!clean(keyword)) throw new Error('a keyword is required');
  const diff = Number(difficulty) || 50;
  // Priority is deliberately simple and visible: easy and commercial first.
  const priority = r2(((100 - diff) / 100) * (intent === 'transactional' ? 1.4 : intent === 'commercial' ? 1.2 : 1));
  exec('INSERT INTO seo_keywords (keyword, language, intent, difficulty, priority, target_url, created_by) VALUES (?,?,?,?,?,?,?)',
    clean(keyword), language, intent, diff, priority, targetUrl, actor);
  return lastId();
}

// ---------- lifecycle ----------
export function createSequence({ name, goal, audience = null, actor }) {
  if (!clean(name)) throw new Error('a sequence needs a name');
  const agentId = specialist('email');
  const pos = one("SELECT * FROM positioning WHERE state = 'approved' ORDER BY id DESC LIMIT 1");
  const runId = agentId ? enqueueRun({
    agentId, taskType: `sequence:${clean(name)}`,
    input: { prompt: `Write a lifecycle email sequence called "${name}".
Goal: ${goal}
Audience: ${audience || 'people who signed up but have not bought'}
${pos ? `Our promise: ${pos.promise}. Proof: ${pos.proof || ''}` : ''}
Four to six emails. Each: the day it sends, a subject line under 60 characters, and a body under 140 words that earns the next one. No pressure tactics, no fake scarcity, and every claim must be one this company can actually stand behind.
Reply as JSON {"steps":[{"day":0,"subject":"...","body":"..."}]}.` },
    actor,
  }) : null;
  exec('INSERT INTO email_sequences (name, goal, audience, run_id, created_by) VALUES (?,?,?,?,?)',
    clean(name), clean(goal), audience, runId, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'marketing.sequence_drafted', subjectType: 'sequence', subjectId: id, payload: { name } });
  return id;
}

export function setSequenceState(id, { state, actor }) {
  if (!['draft', 'ready', 'live', 'retired'].includes(state)) throw new Error('state: draft|ready|live|retired');
  const s = one('SELECT * FROM email_sequences WHERE id = ?', id);
  if (!s) throw new Error('no such sequence');
  if (state !== 'draft' && !s.steps) throw new Error('the sequence has not been written yet');
  exec('UPDATE email_sequences SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `marketing.sequence_${state}`, subjectType: 'sequence', subjectId: id });
}

// ---------- the tick ----------
export function syncMarketing() {
  for (const p of q("SELECT id, run_id FROM personas WHERE run_id IS NOT NULL AND job_title IS NULL")) {
    const t = runText(p.run_id);
    if (!t) continue;
    exec("UPDATE personas SET job_title = ?, pains = ?, gains = ?, objections = ?, channels = ?, state = 'active' WHERE id = ?",
      t.jobTitle || null, t.pains || null, t.gains || null, t.objections || null, t.channels || null, p.id);
  }
  for (const p of q("SELECT id, run_id FROM positioning WHERE run_id IS NOT NULL AND tagline IS NULL")) {
    const t = runText(p.run_id);
    if (!t) continue;
    exec('UPDATE positioning SET category = ?, proof = ?, alternatives = ?, tagline = ?, messages = ? WHERE id = ?',
      t.category || null, t.proof || null, t.alternatives || null, t.tagline || null,
      t.messages ? JSON.stringify(t.messages) : null, p.id);
  }
  for (const s of q("SELECT id, run_id FROM email_sequences WHERE run_id IS NOT NULL AND steps IS NULL")) {
    const t = runText(s.run_id);
    if (!t?.steps) continue;
    exec("UPDATE email_sequences SET steps = ?, state = 'ready' WHERE id = ?", JSON.stringify(t.steps), s.id);
    notify({ level: 'info', source: 'marketing', message: `Sequence "${one('SELECT name FROM email_sequences WHERE id = ?', s.id).name}" is written and ready for a human to send.`, subjectType: 'sequence', subjectId: s.id });
  }
  // Calendar entries follow the studio piece they became.
  for (const e of q("SELECT id, content_id FROM content_calendar WHERE content_id IS NOT NULL AND state = 'drafting'")) {
    const c = one('SELECT state FROM content_items WHERE id = ?', e.content_id);
    if (c && ['draft_ready', 'approved', 'published'].includes(c.state)) {
      exec("UPDATE content_calendar SET state = ? WHERE id = ?", c.state === 'published' ? 'published' : 'ready', e.id);
    }
  }
  // Keywords harvested by the SEO lead land as tracked rows.
  for (const r of q("SELECT id, output FROM runs WHERE task_type LIKE 'seo:%' AND state = 'done'")) {
    const t = runText(r.id);
    if (!t?.keywords) continue;
    for (const k of t.keywords.slice(0, 20)) {
      if (!k?.keyword || one('SELECT id FROM seo_keywords WHERE keyword = ?', String(k.keyword).trim())) continue;
      addKeyword({ keyword: k.keyword, language: /[ء-ي]/.test(k.keyword) ? 'ar' : 'en', intent: k.intent, difficulty: k.difficulty, actor: 'agent:seo' });
    }
    exec("UPDATE runs SET task_type = ? WHERE id = ?", 'seo-done', r.id);
  }
}

// ---------- the funnel ----------
export function marketingDesk() {
  const ch = q('SELECT * FROM campaign_channels ORDER BY id DESC');
  const totals = ch.reduce((a, c) => ({
    budget: a.budget + c.budget_usd, spent: a.spent + c.spent_usd,
    impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks,
    leads: a.leads + c.leads, customers: a.customers + c.customers,
  }), { budget: 0, spent: 0, impressions: 0, clicks: 0, leads: 0, customers: 0 });

  const byChannel = Object.values(ch.reduce((acc, c) => {
    const k = c.channel;
    acc[k] ||= { channel: k, budget: 0, spent: 0, impressions: 0, clicks: 0, leads: 0, customers: 0 };
    for (const f of ['budget_usd', 'spent_usd', 'impressions', 'clicks', 'leads', 'customers']) {
      acc[k][f.replace('_usd', '')] += c[f];
    }
    return acc;
  }, {})).map((c) => ({
    ...c,
    ctr: c.impressions ? r2((c.clicks / c.impressions) * 100) : null,
    cpl: c.leads ? r2(c.spent / c.leads) : null,
    cac: c.customers ? r2(c.spent / c.customers) : null,
  })).sort((a, b) => b.spent - a.spent);

  const mrrFromCampaigns = one("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE campaign_id IS NOT NULL AND state = 'active'").n;
  const verdicts = byChannel.map((c) => {
    if (!c.spent) return { channel: c.channel, verdict: 'not started', detail: 'nothing spent yet' };
    if (!c.customers) return { channel: c.channel, verdict: 'unproven', detail: `$${r2(c.spent)} spent, ${c.leads} lead(s), no customer yet` };
    return { channel: c.channel, verdict: c.cac <= (mrrFromCampaigns / Math.max(1, totals.customers)) * 12 ? 'paying' : 'expensive',
      detail: `CAC $${c.cac} against ${r2(mrrFromCampaigns / Math.max(1, totals.customers))}/mo per customer` };
  });

  return {
    team: TEAM.map((m) => {
      const a = one('SELECT id, name, status FROM agents WHERE id = ?', m.id);
      return {
        ...m, hired: Boolean(a), status: a?.status || 'not hired',
        load: a ? one("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND state IN ('queued','leased','running')", m.id).n : 0,
      };
    }),
    personas: q('SELECT * FROM personas ORDER BY id DESC LIMIT 20'),
    positioning: q('SELECT * FROM positioning ORDER BY id DESC LIMIT 10').map((p) => ({ ...p, messages: J(p.messages, []) })),
    campaigns: q('SELECT id, name, channel, state, budget_usd FROM campaigns ORDER BY id DESC LIMIT 20').map((c) => ({
      ...c, channels: ch.filter((x) => x.campaign_id === c.id),
    })),
    channels: byChannel,
    verdicts,
    calendar: q(`SELECT c.*, p.name AS persona FROM content_calendar c LEFT JOIN personas p ON p.id = c.persona_id
                 ORDER BY COALESCE(c.due_date, '9999') , c.id DESC LIMIT 40`),
    keywords: q('SELECT * FROM seo_keywords ORDER BY priority DESC, id DESC LIMIT 40'),
    sequences: q('SELECT * FROM email_sequences ORDER BY id DESC LIMIT 20').map((s) => ({ ...s, steps: J(s.steps, []) })),
    funnel: {
      ...totals,
      budget: r2(totals.budget), spent: r2(totals.spent),
      ctr: totals.impressions ? r2((totals.clicks / totals.impressions) * 100) : null,
      leadRate: totals.clicks ? r2((totals.leads / totals.clicks) * 100) : null,
      closeRate: totals.leads ? r2((totals.customers / totals.leads) * 100) : null,
      cac: totals.customers ? r2(totals.spent / totals.customers) : null,
      mrrAttributed: r2(mrrFromCampaigns),
      paybackMonths: totals.customers && mrrFromCampaigns
        ? r2((totals.spent / totals.customers) / (mrrFromCampaigns / totals.customers)) : null,
    },
    stats: {
      personas: one("SELECT COUNT(*) AS n FROM personas WHERE state = 'active'").n,
      liveCampaigns: one("SELECT COUNT(*) AS n FROM campaigns WHERE state = 'live'").n,
      plannedContent: one("SELECT COUNT(*) AS n FROM content_calendar WHERE state != 'published'").n,
      keywords: one('SELECT COUNT(*) AS n FROM seo_keywords').n,
      sequencesLive: one("SELECT COUNT(*) AS n FROM email_sequences WHERE state = 'live'").n,
    },
  };
}

// ===========================================================================
// The rest of the department.
//
// Campaigns, content, design, brand, social and search were already here. What
// follows are the functions a marketing department has that none of those
// cover: the room it books, the journalist it calls, the people who advocate
// for it without being paid, where a customer actually came from, the page they
// land on, and the plumbing that makes any of it measurable.
//
// Each one is a real desk with a real table behind it, staffed by a named
// specialist who can be mentioned in chat and given work like anyone else.
// ===========================================================================

// ---------- events ----------
export function planEvent({ name, kind = 'webinar', format = 'online', startsAt = null, city = null, audience = null, goal = null, budgetUsd = 0, campaignId = null, actor }) {
  if (!clean(name)) throw new Error('an event needs a name');
  exec(
    `INSERT INTO mkt_events (name, kind, format, starts_at, city, audience, goal, budget_usd, campaign_id, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    clean(name), kind, format, startsAt, city, audience, goal, r2(budgetUsd), campaignId, actor,
  );
  const id = lastId();
  // The brief is written by the person who owns the audience, not by whoever
  // happened to book the room.
  const agent = specialist('content');
  if (agent) {
    const runId = enqueueRun({
      agentId: agent, taskType: 'event_brief', actor: `human:${actor}`,
      input: {
        instruction: 'Write the run-of-show for this event. Return JSON: {"promise": "the one sentence that makes someone attend", "agenda": [{"minutes": 0, "item": "..."}], "who_should_come": "...", "what_they_leave_with": "...", "follow_up": "the single thing we do the day after"}. No filler sessions.',
        event: { name, kind, format, audience, goal, city, startsAt },
        positioning: one('SELECT audience, promise, proof FROM positioning ORDER BY id DESC LIMIT 1') || null,
        personas: q('SELECT name, job_title, pains FROM personas LIMIT 3'),
      },
    });
    exec("UPDATE mkt_events SET run_id = ?, state = 'briefed' WHERE id = ?", runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'event.planned', subjectType: 'event', subjectId: id, payload: { name, kind, budgetUsd } });
  return one('SELECT * FROM mkt_events WHERE id = ?', id);
}

export function recordEvent(id, { registered = null, attended = null, leads = null, spent = null, state = null, actor }) {
  const e = one('SELECT * FROM mkt_events WHERE id = ?', id);
  if (!e) throw new Error('no such event');
  exec(
    `UPDATE mkt_events SET registered = COALESCE(?, registered), attended = COALESCE(?, attended),
       leads = COALESCE(?, leads), spent_usd = COALESCE(?, spent_usd), state = COALESCE(?, state) WHERE id = ?`,
    registered, attended, leads, spent === null ? null : r2(spent), state, id,
  );
  // An event that produced leads is a touch on each of them; recording it here
  // is what stops attribution being a guess later.
  if (leads) {
    exec("INSERT INTO mkt_touchpoints (subject, channel, source, campaign_id, event_id, weight) VALUES (?, 'event', ?, ?, ?, 1)",
      `event:${id}`, e.name, e.campaign_id, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'event.recorded', subjectType: 'event', subjectId: id, payload: { registered, attended, leads, spent } });
  return one('SELECT * FROM mkt_events WHERE id = ?', id);
}

// ---------- press and media ----------
export function draftPress({ kind = 'release', title, outlet = null, journalist = null, angle = null, actor }) {
  if (!clean(title)) throw new Error('a press item needs a title');
  exec('INSERT INTO mkt_press (kind, title, outlet, journalist, angle, created_by) VALUES (?,?,?,?,?,?)',
    kind, clean(title), outlet, journalist, angle, actor);
  const id = lastId();
  const agent = specialist('positioning');
  if (agent) {
    const runId = enqueueRun({
      agentId: agent, taskType: 'press_draft', actor: `human:${actor}`,
      input: {
        instruction: 'Write this as a journalist would want to receive it. Return JSON: {"headline": "...", "lede": "the first paragraph, which must contain the news", "body": "...", "quote": "one quote worth printing", "facts": ["verifiable claims only"], "why_this_outlet": "..."}. Every number must come from the evidence given; if a claim cannot be supported, leave it out.',
        item: { kind, title, outlet, journalist, angle },
        positioning: one('SELECT audience, promise, proof FROM positioning ORDER BY id DESC LIMIT 1') || null,
        evidence: {
          customers: one("SELECT COUNT(*) AS n FROM customers WHERE state = 'active'").n,
          mrrUsd: one("SELECT COALESCE(SUM(mrr_usd),0) AS v FROM customers WHERE state = 'active'").v,
          shipped: one("SELECT COUNT(*) AS n FROM releases WHERE state = 'published'")?.n ?? 0,
        },
      },
    });
    exec('UPDATE mkt_press SET run_id = ? WHERE id = ?', runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'press.drafted', subjectType: 'press', subjectId: id, payload: { kind, title, outlet } });
  return one('SELECT * FROM mkt_press WHERE id = ?', id);
}

/** Approving is a human act: a press release is the company speaking on record. */
export function approvePress(id, { actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person can put the company on record');
  exec("UPDATE mkt_press SET state = 'approved', approved_by = ? WHERE id = ?", actor, id);
  audit({ actorType: 'human', actorId: actor, action: 'press.approved', subjectType: 'press', subjectId: id });
  return one('SELECT * FROM mkt_press WHERE id = ?', id);
}

export function recordCoverage(id, { url, sentiment = 'neutral', actor }) {
  exec("UPDATE mkt_press SET state = 'published', url = ?, sentiment = ? WHERE id = ?", url, sentiment, id);
  const p = one('SELECT title, outlet FROM mkt_press WHERE id = ?', id);
  exec("INSERT INTO mkt_touchpoints (subject, channel, source, weight) VALUES (?, 'press', ?, 0.5)", `press:${id}`, p?.outlet || 'press');
  audit({ actorType: 'human', actorId: actor, action: 'press.covered', subjectType: 'press', subjectId: id, payload: { url, sentiment } });
  return { ok: true };
}

// ---------- community ----------
export function addCommunityMember({ handle, channel = 'other', role = 'member', reach = 0, notes = null, customerId = null, actor }) {
  if (!clean(handle)) throw new Error('who are we adding?');
  exec(
    `INSERT INTO mkt_community (handle, channel, role, reach, notes, customer_id, last_seen)
     VALUES (?,?,?,?,?,?, datetime('now'))`,
    clean(handle), channel, role, Number(reach) || 0, notes, customerId,
  );
  audit({ actorType: 'human', actorId: actor, action: 'community.added', subjectType: 'community', subjectId: lastId(), payload: { handle, channel, role } });
  return one('SELECT * FROM mkt_community WHERE id = ?', lastId());
}

export function setCommunityRole(id, { role, sentiment = null, actor }) {
  exec("UPDATE mkt_community SET role = ?, sentiment = COALESCE(?, sentiment), last_seen = datetime('now') WHERE id = ?", role, sentiment, id);
  audit({ actorType: 'human', actorId: actor, action: 'community.role', subjectType: 'community', subjectId: id, payload: { role } });
  return { ok: true };
}

// ---------- attribution ----------
export function recordTouch({ subject, channel, source = null, campaignId = null, contentId = null, eventId = null, weight = 1, valueUsd = 0 }) {
  if (!subject || !channel) throw new Error('a touch needs a subject and a channel');
  exec(
    `INSERT INTO mkt_touchpoints (subject, channel, source, campaign_id, content_id, event_id, weight, value_usd)
     VALUES (?,?,?,?,?,?,?,?)`,
    String(subject), channel, source, campaignId, contentId, eventId, Number(weight) || 1, r2(valueUsd),
  );
  return { ok: true };
}

/**
 * Credit, three ways, side by side. Last-touch is the number everybody quotes
 * and the one most likely to be wrong, so it is shown next to first-touch and
 * an even split rather than on its own.
 */
export function attribution() {
  const subjects = q('SELECT DISTINCT subject FROM mkt_touchpoints').map((r) => r.subject);
  const models = { first: {}, last: {}, even: {} };
  let credited = 0;
  for (const s of subjects) {
    const touches = q('SELECT * FROM mkt_touchpoints WHERE subject = ? ORDER BY occurred_at ASC, id ASC', s);
    if (!touches.length) continue;
    const value = touches.reduce((a, t) => a + (t.value_usd || 0), 0) || 1;
    credited += 1;
    const add = (model, channel, v) => { models[model][channel] = r2((models[model][channel] || 0) + v); };
    add('first', touches[0].channel, value);
    add('last', touches[touches.length - 1].channel, value);
    for (const t of touches) add('even', t.channel, value / touches.length);
  }
  const channels = [...new Set(Object.keys(models.first).concat(Object.keys(models.last), Object.keys(models.even)))];
  return {
    journeys: credited,
    touches: one('SELECT COUNT(*) AS n FROM mkt_touchpoints').n,
    byChannel: channels.map((c) => ({
      channel: c,
      first: models.first[c] || 0,
      last: models.last[c] || 0,
      even: models.even[c] || 0,
    })).sort((a, b) => b.even - a.even),
    // The honest caveat, printed rather than assumed.
    note: 'A journey with one recorded touch credits that touch three times over. The three columns disagreeing is the useful signal — it means the path had more than one step.',
    longest: q(`SELECT subject, COUNT(*) AS touches FROM mkt_touchpoints GROUP BY subject ORDER BY touches DESC LIMIT 8`),
  };
}

// ---------- landing pages ----------
export function draftPage({ slug, title, purpose = null, personaId = null, campaignId = null, actor }) {
  const s = clean(slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (!s) throw new Error('a page needs a slug');
  if (one('SELECT id FROM mkt_pages WHERE slug = ?', s)) throw new Error(`there is already a page at /${s}`);
  exec('INSERT INTO mkt_pages (slug, title, purpose, persona_id, campaign_id, created_by) VALUES (?,?,?,?,?,?)',
    s, clean(title) || s, purpose, personaId, campaignId, actor);
  const id = lastId();
  const agent = specialist('content');
  if (agent) {
    const persona = personaId ? one('SELECT * FROM personas WHERE id = ?', personaId) : one('SELECT * FROM personas ORDER BY id DESC LIMIT 1');
    const runId = enqueueRun({
      agentId: agent, taskType: 'page_draft', actor: `human:${actor}`,
      input: {
        instruction: 'Write this landing page. Return JSON: {"headline": "...", "subhead": "...", "body": "three short sections", "cta": "the one action", "objection_handled": "the thing that stops them, answered"}. Speak to the person described, not to everyone.',
        page: { slug: s, title, purpose },
        persona: persona ? { name: persona.name, job: persona.job_title, pains: persona.pains } : null,
        positioning: one('SELECT audience, promise, proof FROM positioning ORDER BY id DESC LIMIT 1') || null,
      },
    });
    exec('UPDATE mkt_pages SET run_id = ? WHERE id = ?', runId, id);
  }
  audit({ actorType: 'human', actorId: actor, action: 'page.drafted', subjectType: 'page', subjectId: id, payload: { slug: s } });
  return one('SELECT * FROM mkt_pages WHERE id = ?', id);
}

export function setPageState(id, { state, actor }) {
  if (!['draft', 'review', 'live', 'retired'].includes(state)) throw new Error('unknown state');
  if (state === 'live' && !String(actor).startsWith('human')) throw new Error('a person publishes a page');
  exec('UPDATE mkt_pages SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: 'page.state', subjectType: 'page', subjectId: id, payload: { state } });
  return { ok: true };
}

export function recordPageResult(id, { visits = null, conversions = null, actor }) {
  exec('UPDATE mkt_pages SET visits = COALESCE(?, visits), conversions = COALESCE(?, conversions) WHERE id = ?', visits, conversions, id);
  audit({ actorType: 'human', actorId: actor, action: 'page.measured', subjectType: 'page', subjectId: id, payload: { visits, conversions } });
  return { ok: true };
}

// ---------- marketing operations ----------
const OPS_SEED = [
  { kind: 'convention', name: 'UTM naming', detail: 'utm_source=channel, utm_medium=paid|organic|email, utm_campaign=<campaign id>-<slug>', value: 'enforced' },
  { kind: 'rule', name: 'Lead scoring', detail: 'visit 1 · content download 5 · event attended 15 · pricing page 20 · demo request 40. Over 50 goes to sales.', value: '50' },
  { kind: 'convention', name: 'One claim, one source', detail: 'No number appears in public copy without a query behind it. The auditor checks this.', value: 'enforced' },
  { kind: 'tracking', name: 'Touchpoints', detail: 'Every channel writes a row to mkt_touchpoints. Attribution is computed, never typed.', value: 'on' },
];

export function seedMarketingOps() {
  for (const o of OPS_SEED) {
    if (one('SELECT id FROM mkt_ops WHERE name = ?', o.name)) continue;
    exec('INSERT INTO mkt_ops (kind, name, detail, value, owner) VALUES (?,?,?,?,?)', o.kind, o.name, o.detail, o.value, 'AGT-MKT-008');
  }
}

export function setOpsEntry({ id = null, kind = 'tool', name, detail = null, value = null, state = 'active', actor }) {
  if (id) {
    exec('UPDATE mkt_ops SET kind = ?, name = ?, detail = ?, value = ?, state = ? WHERE id = ?', kind, name, detail, value, state, id);
  } else {
    exec('INSERT INTO mkt_ops (kind, name, detail, value, state, owner) VALUES (?,?,?,?,?,?)', kind, clean(name), detail, value, state, actor);
  }
  audit({ actorType: 'human', actorId: actor, action: 'mktops.set', subjectType: 'mktops', subjectId: id || lastId(), payload: { kind, name } });
  return { ok: true };
}

// ---------- the desks, each answering its own page ----------
export const eventsDesk = () => ({
  events: q('SELECT * FROM mkt_events ORDER BY COALESCE(starts_at, created_at) DESC LIMIT 60'),
  counts: {
    planned: one("SELECT COUNT(*) AS n FROM mkt_events WHERE state IN ('planned','briefed')").n,
    done: one("SELECT COUNT(*) AS n FROM mkt_events WHERE state = 'done'").n,
    leads: one('SELECT COALESCE(SUM(leads),0) AS n FROM mkt_events').n,
    spentUsd: one('SELECT COALESCE(ROUND(SUM(spent_usd),2),0) AS n FROM mkt_events').n,
  },
  // Cost per lead is the only number an event is really judged on.
  costPerLead: (() => {
    const r = one('SELECT COALESCE(SUM(spent_usd),0) AS s, COALESCE(SUM(leads),0) AS l FROM mkt_events');
    return r.l ? r2(r.s / r.l) : null;
  })(),
  campaigns: q("SELECT id, name FROM campaigns WHERE state != 'archived' ORDER BY id DESC LIMIT 20"),
});

export const pressDesk = () => ({
  items: q('SELECT * FROM mkt_press ORDER BY id DESC LIMIT 60'),
  counts: {
    drafts: one("SELECT COUNT(*) AS n FROM mkt_press WHERE state = 'draft'").n,
    awaiting: one("SELECT COUNT(*) AS n FROM mkt_press WHERE state = 'approved'").n,
    published: one("SELECT COUNT(*) AS n FROM mkt_press WHERE state = 'published'").n,
    outlets: one('SELECT COUNT(DISTINCT outlet) AS n FROM mkt_press WHERE outlet IS NOT NULL').n,
  },
  coverage: q("SELECT outlet, sentiment, COUNT(*) AS n FROM mkt_press WHERE state = 'published' GROUP BY outlet, sentiment ORDER BY n DESC"),
});

export const communityDesk = () => ({
  members: q('SELECT * FROM mkt_community ORDER BY reach DESC, id DESC LIMIT 80'),
  counts: {
    total: one('SELECT COUNT(*) AS n FROM mkt_community').n,
    advocates: one("SELECT COUNT(*) AS n FROM mkt_community WHERE role IN ('advocate','ambassador')").n,
    critics: one("SELECT COUNT(*) AS n FROM mkt_community WHERE role = 'critic'").n,
    reach: one('SELECT COALESCE(SUM(reach),0) AS n FROM mkt_community').n,
  },
  byChannel: q('SELECT channel, COUNT(*) AS n, COALESCE(SUM(reach),0) AS reach FROM mkt_community GROUP BY channel ORDER BY n DESC'),
});

export const pagesDesk = () => ({
  pages: q('SELECT * FROM mkt_pages ORDER BY id DESC LIMIT 60'),
  counts: {
    live: one("SELECT COUNT(*) AS n FROM mkt_pages WHERE state = 'live'").n,
    draft: one("SELECT COUNT(*) AS n FROM mkt_pages WHERE state IN ('draft','review')").n,
    visits: one('SELECT COALESCE(SUM(visits),0) AS n FROM mkt_pages').n,
    conversions: one('SELECT COALESCE(SUM(conversions),0) AS n FROM mkt_pages').n,
  },
  best: q("SELECT slug, title, visits, conversions, ROUND(CASE WHEN visits > 0 THEN conversions * 100.0 / visits ELSE 0 END, 1) AS rate FROM mkt_pages WHERE state = 'live' ORDER BY rate DESC LIMIT 10"),
  personas: q('SELECT id, name FROM personas ORDER BY id DESC LIMIT 20'),
});

export const opsDesk = () => ({
  entries: q('SELECT * FROM mkt_ops ORDER BY kind, name'),
  counts: {
    total: one('SELECT COUNT(*) AS n FROM mkt_ops').n,
    active: one("SELECT COUNT(*) AS n FROM mkt_ops WHERE state = 'active'").n,
    rules: one("SELECT COUNT(*) AS n FROM mkt_ops WHERE kind = 'rule'").n,
  },
  // The plumbing is only real if the things it claims to track have rows.
  health: {
    touchpoints: one('SELECT COUNT(*) AS n FROM mkt_touchpoints').n,
    keywords: one('SELECT COUNT(*) AS n FROM seo_keywords').n,
    channels: one('SELECT COUNT(*) AS n FROM campaign_channels').n,
    sequences: one('SELECT COUNT(*) AS n FROM email_sequences').n,
    calendar: one('SELECT COUNT(*) AS n FROM content_calendar').n,
  },
});

// ---------- the surfaced desks: tables that had no page of their own ----------
export const seoDesk = () => ({
  keywords: q('SELECT * FROM seo_keywords ORDER BY priority DESC, id DESC LIMIT 120'),
  counts: {
    total: one('SELECT COUNT(*) AS n FROM seo_keywords').n,
    targeted: one('SELECT COUNT(*) AS n FROM seo_keywords WHERE target_url IS NOT NULL').n,
    languages: one('SELECT COUNT(DISTINCT language) AS n FROM seo_keywords').n,
  },
  byIntent: q('SELECT COALESCE(intent, \'unknown\') AS intent, COUNT(*) AS n FROM seo_keywords GROUP BY intent ORDER BY n DESC'),
  // A keyword nobody has written for is a keyword nobody is winning.
  unwritten: q(`SELECT k.keyword, k.intent, k.difficulty FROM seo_keywords k
                WHERE NOT EXISTS (SELECT 1 FROM content_calendar c WHERE c.title LIKE '%' || k.keyword || '%')
                ORDER BY k.priority DESC LIMIT 15`),
});

export const paidDesk = () => ({
  channels: q(`SELECT ch.*, c.name AS campaign FROM campaign_channels ch
               LEFT JOIN campaigns c ON c.id = ch.campaign_id ORDER BY ch.id DESC LIMIT 60`),
  counts: {
    live: one("SELECT COUNT(*) AS n FROM campaign_channels WHERE state = 'live'").n,
    budgetUsd: one('SELECT COALESCE(ROUND(SUM(budget_usd),2),0) AS n FROM campaign_channels').n,
    spentUsd: one('SELECT COALESCE(ROUND(SUM(spent_usd),2),0) AS n FROM campaign_channels').n,
    leads: one('SELECT COALESCE(SUM(leads),0) AS n FROM campaign_channels').n,
  },
  verdicts: q(`SELECT channel,
                 COALESCE(SUM(spent_usd),0) AS spent, COALESCE(SUM(leads),0) AS leads,
                 COALESCE(SUM(customers),0) AS customers,
                 CASE WHEN SUM(leads) > 0 THEN ROUND(SUM(spent_usd) / SUM(leads), 2) END AS cost_per_lead
               FROM campaign_channels GROUP BY channel ORDER BY spent DESC`),
  campaigns: q("SELECT id, name FROM campaigns WHERE state != 'archived' ORDER BY id DESC LIMIT 20"),
});

export const lifecycleDesk = () => ({
  sequences: q('SELECT * FROM email_sequences ORDER BY id DESC LIMIT 40').map((s) => ({ ...s, steps: J(s.steps, []) })),
  counts: {
    live: one("SELECT COUNT(*) AS n FROM email_sequences WHERE state = 'live'").n,
    draft: one("SELECT COUNT(*) AS n FROM email_sequences WHERE state != 'live'").n,
    sent: one('SELECT COALESCE(SUM(sent),0) AS n FROM email_sequences').n,
  },
  // Sending is an outbound act, so it belongs to the gate rather than to us.
  gate: {
    connector: one("SELECT id, state FROM connectors WHERE id = 'gmail'") || null,
    note: 'A sequence going live queues sends through the egress gate, which checks the scope, the allowlist and the constitution before anything leaves.',
  },
});

export const calendarDesk = () => ({
  items: q(`SELECT c.*, p.name AS persona FROM content_calendar c
            LEFT JOIN personas p ON p.id = c.persona_id
            ORDER BY COALESCE(c.due_date, c.created_at) ASC LIMIT 80`),
  counts: {
    planned: one("SELECT COUNT(*) AS n FROM content_calendar WHERE state = 'planned'").n,
    inFlight: one("SELECT COUNT(*) AS n FROM content_calendar WHERE state IN ('briefed','drafting')").n,
    late: one("SELECT COUNT(*) AS n FROM content_calendar WHERE due_date IS NOT NULL AND due_date < date('now') AND state != 'published'").n,
    published: one("SELECT COUNT(*) AS n FROM content_calendar WHERE state = 'published'").n,
  },
  byStage: q('SELECT stage, COUNT(*) AS n FROM content_calendar GROUP BY stage ORDER BY n DESC'),
  personas: q('SELECT id, name FROM personas ORDER BY id DESC LIMIT 20'),
});
