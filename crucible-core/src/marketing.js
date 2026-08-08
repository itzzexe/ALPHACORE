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
];

export function seedMarketingTeam() {
  for (const m of TEAM) {
    if (one('SELECT id FROM agents WHERE id = ?', m.id)) continue;
    exec('INSERT INTO agents (id, name, role_group, spec, model_tier, human_owner) VALUES (?,?,?,?,?,?)',
      m.id, m.name, 'create', JSON.stringify({
        id: m.id, name: m.name, roleGroup: 'create', speciality: m.speciality,
        tier: m.tier, mission: m.mission, failMode: 'escalate', confidenceFloor: 0.6,
        system: `You are ${m.name} at Crucible Systems. ${m.mission} You write for a specific audience, you cite the evidence you were given, and you never invent a number.`,
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
