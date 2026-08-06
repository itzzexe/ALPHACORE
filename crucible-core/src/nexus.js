// NEXUS — the cross-department nervous system. Departments don't just sit on
// parallel lines: events in one automatically create work in others, so the
// company runs itself with minimal human intervention. Humans keep only the
// load-bearing moments (publishing, signing, gate verdicts); everything else
// flows sideways on its own.
//
// Every rule is: WATCH a condition in department A → ACT in department B.
// Idempotent by design: nexus_log (rule_id, subject_key) guarantees a rule
// fires exactly once per subject. Rules are individually switchable from the
// Autopilot page, and every firing is on the audit chain as actor system:nexus.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';
import { createPost, createDesign, createContent } from './studio.js';
import { draftOutreach, logInteraction } from './relations.js';
import { createTask } from './pm.js';
import { createDecision } from './registry.js';
import { createCustomer } from './commercial.js';
import { createSegment, segmentToCampaign, datasetFromSource, transformDataset } from './data.js';
import { createDeal } from './sales.js';

const ACTOR = 'system:nexus';

/** Fire-once guard. Returns false if this rule already handled this subject. */
function once(ruleId, subjectKey, note) {
  try {
    exec('INSERT INTO nexus_log (rule_id, subject_key, note) VALUES (?,?,?)', ruleId, String(subjectKey), note);
    return true;
  } catch { return false; /* UNIQUE hit — already handled */ }
}

// ---------- the rule catalog: A → B, sideways ----------
export const RULES = [
  {
    id: 'campaign→social', name: 'Live campaign gets social posts',
    why: 'Marketing → Social Media: a campaign going live auto-briefs the SMM agent for every connected channel.',
    tick() {
      for (const c of q("SELECT * FROM campaigns WHERE state = 'live'")) {
        if (one('SELECT id FROM posts WHERE campaign_id = ? LIMIT 1', c.id)) continue;
        if (!once(this.id, `campaign:${c.id}`, `posts briefed for campaign "${c.name}"`)) continue;
        const channels = q("SELECT * FROM channels WHERE state = 'connected' LIMIT 2");
        if (!channels.length) {
          createPost({ brief: `Promote the now-live campaign "${c.name}". Copy reference:\n${String(c.draft || '').slice(0, 400)}`, campaignId: c.id, productId: c.product_id, actor: ACTOR });
        } else {
          for (const ch of channels) createPost({ channelId: ch.id, brief: `Promote the now-live campaign "${c.name}" on ${ch.platform}. Copy reference:\n${String(c.draft || '').slice(0, 400)}`, campaignId: c.id, productId: c.product_id, actor: ACTOR });
        }
        return `campaign "${c.name}" → ${Math.max(1, channels.length)} post brief(s)`;
      }
    },
  },
  {
    id: 'campaign→design', name: 'Live campaign gets a banner',
    why: 'Marketing → Design Studio: every live campaign auto-briefs the Designer for a visual.',
    tick() {
      for (const c of q("SELECT * FROM campaigns WHERE state = 'live'")) {
        if (one('SELECT id FROM designs WHERE campaign_id = ? LIMIT 1', c.id)) continue;
        if (!once(this.id, `campaign:${c.id}`, `banner briefed for "${c.name}"`)) continue;
        createDesign({ kind: 'banner', title: `Campaign banner — ${c.name}`, brief: `1200×630 social banner for the live "${c.channel}" campaign "${c.name}". Tone from approved copy:\n${String(c.draft || '').slice(0, 300)}`, campaignId: c.id, productId: c.product_id, actor: ACTOR });
        return `campaign "${c.name}" → banner brief`;
      }
    },
  },
  {
    id: 'incident→risk', name: 'Serious incident registers a risk',
    why: 'Operations → Risk: every open SEV1/SEV2 lands on the risk register automatically.',
    tick() {
      for (const i of q("SELECT * FROM incidents WHERE state != 'closed' AND sev IN ('SEV1','SEV2')")) {
        if (!once(this.id, `incident:${i.id}`, `risk registered for incident #${i.id}`)) continue;
        exec('INSERT INTO risks (title, likelihood, impact, mitigation, owner, subject_type, subject_id, source) VALUES (?,?,?,?,?,?,?,?)',
          `Recurrence of ${i.sev}: ${i.title}`, 3, i.sev === 'SEV1' ? 5 : 4, 'Postmortem actions + monitoring', i.commander, 'incident', String(i.id), 'nexus');
        audit({ actorType: 'system', actorId: ACTOR, action: 'nexus.incident_risk', subjectType: 'incident', subjectId: i.id });
        return `incident #${i.id} → risk registered`;
      }
    },
  },
  {
    id: 'incident→social', name: 'SEV1 prepares a status update',
    why: 'Operations → Social Media: a SEV1 auto-drafts a public status post — a human decides whether to publish.',
    tick() {
      for (const i of q("SELECT * FROM incidents WHERE state != 'closed' AND sev = 'SEV1'")) {
        if (!once(this.id, `incident:${i.id}`, `status draft for incident #${i.id}`)) continue;
        createPost({ kind: 'post', brief: `Status update about an ongoing service incident: "${i.title}". Honest, calm, no blame, no ETA promises. A human decides IF and when this is published.`, actor: ACTOR });
        return `SEV1 #${i.id} → status post drafted`;
      }
    },
  },
  {
    id: 'lead→relations', name: 'New lead gets a relationship touch',
    why: 'CRM → Relations: every new lead is logged in the interactions timeline so nothing starts cold.',
    tick() {
      for (const c of q("SELECT * FROM customers WHERE state = 'lead'")) {
        if (!once(this.id, `customer:${c.id}`, `welcome touch for lead ${c.name}`)) continue;
        logInteraction({ customerId: c.id, kind: 'note', summary: `Auto: new lead "${c.name}"${c.company ? ` (${c.company})` : ''} entered the CRM — first-touch follow-up is due.`, nextAction: 'first-touch follow-up', nextDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), actor: ACTOR });
        return `lead "${c.name}" → interaction logged`;
      }
    },
  },
  {
    id: 'deal→customer', name: 'Won deal becomes an active customer',
    why: 'Sales → CRM: winning a deal registers the customer automatically, valued at the deal size.',
    tick() {
      for (const d of q("SELECT * FROM deals WHERE stage = 'won' AND customer_id IS NULL")) {
        if (!once(this.id, `deal:${d.id}`, `customer created from deal "${d.name}"`)) continue;
        const cust = createCustomer({ name: d.name, plan: 'starter', mrrUsd: Math.round(d.value_usd / 12), state: 'active', productId: d.product_id, actor: ACTOR });
        exec('UPDATE deals SET customer_id = ? WHERE id = ?', cust.id, d.id);
        return `deal "${d.name}" → customer #${cust.id} active`;
      }
    },
  },
  {
    id: 'risk→decision', name: 'Critical risk opens a decision case',
    why: 'Risk → Decisions: any open risk scoring ≥16 forces a T2 mitigation decision — it cannot rot quietly.',
    tick() {
      for (const r of q("SELECT *, likelihood * impact AS score FROM risks WHERE state = 'open' AND likelihood * impact >= 16")) {
        if (!once(this.id, `risk:${r.id}`, `decision case for risk "${r.title}"`)) continue;
        createDecision({ title: `Mitigate critical risk: ${r.title}`, tier: 'T2', owner: r.owner, context: `Auto-opened by Nexus. Score ${r.score} (L${r.likelihood}×I${r.impact}). Current mitigation: ${r.mitigation || 'none recorded'}.`, actor: ACTOR });
        return `risk #${r.id} (score ${r.score}) → T2 decision case`;
      }
    },
  },
  {
    id: 'eval→task', name: 'Failing eval assigns an improvement task',
    why: 'Quality → Tasks: an agent scoring under 80% gets an improvement-plan task delegated to the Docs agent.',
    tick() {
      for (const e of q('SELECT * FROM eval_runs WHERE score < 0.8 ORDER BY id DESC LIMIT 10')) {
        if (!once(this.id, `eval:${e.id}`, `improvement task for ${e.agent_id}`)) continue;
        createTask({ title: `Improvement plan: ${e.agent_id} scored ${Math.round(e.score * 100)}% on ${e.kind}`, details: `Auto-created by Nexus from eval run #${e.id}. Analyze the failed cases and draft concrete spec/prompt improvements for human review.`, assigneeType: 'agent', assigneeId: 'AGT-DOC-001', priority: 'high', actor: ACTOR });
        return `eval #${e.id} (${e.agent_id}) → improvement task`;
      }
    },
  },
  {
    id: 'product→content', name: 'Launching product gets launch content',
    why: 'Product → Content Studio: a product reaching gate 7+ auto-briefs the launch article.',
    tick() {
      for (const p of q("SELECT * FROM products WHERE stage >= 7 AND state != 'retired'")) {
        if (one('SELECT id FROM content_items WHERE product_id = ? LIMIT 1', p.id)) continue;
        if (!once(this.id, `product:${p.id}`, `launch article briefed for ${p.name}`)) continue;
        createContent({ kind: 'article', title: `Launch: ${p.name}`, brief: `Launch announcement article for "${p.name}" (gate ${p.stage}/10). ${p.description || ''} Honest capabilities only — humans verify claims before publishing.`, productId: p.id, actor: ACTOR });
        return `product "${p.name}" → launch article brief`;
      }
    },
  },
  {
    id: 'journey→announce', name: 'Completed journey announces itself',
    why: 'Journeys → Social Media: a journey crossing all 14 departments auto-drafts the announcement.',
    tick() {
      for (const j of q("SELECT * FROM journeys WHERE state = 'done'")) {
        if (!once(this.id, `journey:${j.id}`, `announcement for journey "${j.title}"`)) continue;
        createPost({ kind: 'post', brief: `Announce that "${j.title}" shipped after passing every department gate: research, product, finance, legal, architecture, engineering, review, QA, security, release, marketing, support, governance. Build-in-public tone.`, productId: j.product_id, actor: ACTOR });
        return `journey "${j.title}" → announcement drafted`;
      }
    },
  },
  {
    id: 'partner→outreach', name: 'Fading relationship gets an outreach draft',
    why: 'Relations autopilot: a key/strategic partner with low health or 30 quiet days gets an RM draft waiting for a human to send.',
    tick() {
      for (const p of q(`SELECT p.*, MAX(i.created_at) AS last FROM partners p LEFT JOIN interactions i ON i.partner_id = p.id
                         WHERE p.state = 'active' AND p.tier IN ('strategic','key') AND p.draft IS NULL AND p.draft_run_id IS NULL
                         GROUP BY p.id HAVING p.health <= 2 OR last IS NULL OR last < datetime('now','-30 days')`)) {
        if (!once(this.id, `partner:${p.id}:${new Date().toISOString().slice(0, 7)}`, `outreach drafted for ${p.name}`)) continue;
        draftOutreach(p.id, ACTOR);
        return `partner "${p.name}" → outreach drafting`;
      }
    },
  },
  {
    id: 'intel→segment', name: 'Contactable records self-organize into a segment',
    why: 'Intelligence → Segments: once a campaign finishes with 3+ contactable records, they are grouped into a ready-to-target segment automatically.',
    tick() {
      for (const iq of q("SELECT * FROM intel_queries WHERE state = 'ready'")) {
        const rows = q('SELECT id, country FROM intel_records WHERE query_id = ? AND (email IS NOT NULL OR phone IS NOT NULL)', iq.id);
        if (rows.length < 3) continue;
        if (!once(this.id, `query:${iq.id}`, `segment built from campaign #${iq.id}`)) continue;
        const country = rows.find((r) => r.country)?.country;
        const segId = createSegment({ name: `Contactable — ${country || `campaign #${iq.id}`}`, description: `Auto-built by Nexus from intel campaign #${iq.id}: every record with a harvested email or phone.`, source: 'nexus', actor: ACTOR });
        for (const r of rows) exec('INSERT OR IGNORE INTO segment_members (segment_id, record_id) VALUES (?,?)', segId, r.id);
        return `campaign #${iq.id} → segment #${segId} (${rows.length} contactable)`;
      }
    },
  },
  {
    id: 'segment→campaign', name: 'A big contactable segment reaches Marketing',
    why: 'Segments → Marketing: any segment with 5+ contactable members is handed to Marketing as a drafted campaign, waiting for human approval.',
    tick() {
      for (const s of q('SELECT * FROM segments WHERE campaign_id IS NULL')) {
        const contactable = one(`SELECT COUNT(*) AS n FROM intel_records r JOIN segment_members m ON m.record_id = r.id
                                 WHERE m.segment_id = ? AND (r.email IS NOT NULL OR r.phone IS NOT NULL)`, s.id).n;
        if (contactable < 5) continue;
        if (!once(this.id, `segment:${s.id}`, `campaign drafted for segment "${s.name}"`)) continue;
        const c = segmentToCampaign(s.id, { channel: 'email', actor: ACTOR });
        return `segment "${s.name}" (${contactable} contactable) → campaign #${c.id}`;
      }
    },
  },
  {
    id: 'intel→deal', name: 'A strong targeted lead opens a deal',
    why: 'Intelligence → Sales: a lead created from a well-evidenced record (70%+ complete) opens a deal so it never stalls in the CRM.',
    tick() {
      for (const r of q('SELECT * FROM intel_records WHERE customer_id IS NOT NULL AND completeness >= 0.7')) {
        if (one('SELECT id FROM deals WHERE customer_id = ? LIMIT 1', r.customer_id)) continue;
        if (!once(this.id, `record:${r.id}`, `deal opened for ${r.name}`)) continue;
        createDeal({ name: `${r.name} — first conversation`, valueUsd: 0, customerId: r.customer_id, productId: null, owner: 'OPS', notes: `Auto-opened by Nexus from intel record #${r.id}. Contact: ${r.email || r.phone || 'see record'}. Completeness ${Math.round(r.completeness * 100)}%.`, actor: ACTOR });
        return `intel record "${r.name}" → deal opened`;
      }
    },
  },
  {
    id: 'tickets→dataset', name: 'Support volume becomes an analyzed dataset',
    why: 'Support → Data: every 10 tickets, the corpus is pulled into a dataset and summarized — the voice of the customer reaches the company as evidence, then lands in Knowledge.',
    tick() {
      const n = one('SELECT COUNT(*) AS n FROM tickets').n;
      if (n < 10) return;
      const bucket = Math.floor(n / 10);
      if (!once(this.id, `bucket:${bucket}`, `ticket corpus #${bucket} analyzed`)) return;
      const d = datasetFromSource({ source: 'tickets', name: `Voice of customer — ${n} tickets`, actor: ACTOR });
      transformDataset(d.id, { op: 'summarize', actor: ACTOR });
      return `${n} tickets → dataset #${d.id} summarizing`;
    },
  },
  {
    id: 'archive→knowledge', name: 'Completed journeys leave a lesson behind',
    why: 'Journeys → Knowledge: a finished journey records how it went into organizational memory, so the next one starts smarter.',
    tick() {
      for (const j of q("SELECT * FROM journeys WHERE state = 'done'")) {
        if (!once(this.id, `journey:${j.id}`, `lesson recorded from journey "${j.title}"`)) continue;
        const stages = q('SELECT dept, state, summary FROM journey_stages WHERE journey_id = ? ORDER BY seq', j.id);
        const blocked = stages.filter((s) => s.state === 'skipped').length;
        exec('INSERT INTO memory_entries (layer, classification, content, source_ref, created_by) VALUES (?,?,?,?,?)',
          'lesson', 'internal',
          `Journey "${j.title}" crossed ${stages.filter((s) => s.state === 'done').length}/${stages.length} departments${blocked ? `, ${blocked} skipped` : ''}. Stage outcomes: ${stages.map((s) => `${s.dept}=${s.state}`).join(', ')}.`,
          `journey:${j.id}`, ACTOR);
        return `journey "${j.title}" → lesson in Knowledge`;
      }
    },
  },
  {
    id: 'vendor→task', name: 'Vendor renewal spawns a review task',
    why: 'Procurement → Tasks: a renewal inside 14 days gets a value-review task delegated to the Cost Sentinel.',
    tick() {
      const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      for (const v of q("SELECT * FROM vendors WHERE state = 'active' AND renewal_date IS NOT NULL AND renewal_date <= ?", soon)) {
        if (!once(this.id, `vendor:${v.id}:${v.renewal_date}`, `renewal review for ${v.name}`)) continue;
        createTask({ title: `Renewal review: ${v.name} ($${v.monthly_usd}/mo) renews ${v.renewal_date}`, details: 'Auto-created by Nexus. Analyze spend vs value and recommend renew / renegotiate / cancel — a human decides.', assigneeType: 'agent', assigneeId: 'AGT-CST-001', priority: 'high', actor: ACTOR });
        return `vendor "${v.name}" → renewal review task`;
      }
    },
  },
];

// ---------- engine ----------
export function seedAutomations() {
  for (const r of RULES) {
    if (!one('SELECT id FROM automations WHERE id = ?', r.id)) exec('INSERT INTO automations (id) VALUES (?)', r.id);
  }
}

export function listAutomations() {
  const states = Object.fromEntries(q('SELECT * FROM automations').map((a) => [a.id, a]));
  return RULES.map((r) => ({
    id: r.id, name: r.name, why: r.why,
    enabled: states[r.id] ? Boolean(states[r.id].enabled) : true,
    runs: states[r.id]?.runs || 0,
    lastRun: states[r.id]?.last_run || null,
    recent: q('SELECT note, created_at FROM nexus_log WHERE rule_id = ? ORDER BY id DESC LIMIT 3', r.id),
  }));
}

export function setAutomation(id, { enabled, actor }) {
  if (!RULES.find((r) => r.id === id)) throw new Error('unknown rule');
  exec('UPDATE automations SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
  audit({ actorType: 'human', actorId: actor, action: enabled ? 'nexus.rule_enabled' : 'nexus.rule_disabled', subjectType: 'automation', subjectId: id });
}

export function nexusFeed(limit = 40) {
  return q('SELECT * FROM nexus_log ORDER BY id DESC LIMIT ?', limit);
}

/** Server tick — run every enabled rule; each firing is audited and deduped. */
export function nexusTick() {
  for (const r of RULES) {
    const st = one('SELECT enabled FROM automations WHERE id = ?', r.id);
    if (st && !st.enabled) continue;
    try {
      const acted = r.tick();
      if (acted) {
        exec("UPDATE automations SET runs = runs + 1, last_run = datetime('now') WHERE id = ?", r.id);
        audit({ actorType: 'system', actorId: ACTOR, action: 'nexus.fired', subjectType: 'automation', subjectId: r.id, payload: { note: acted } });
        notify({ level: 'info', source: 'nexus', message: `Autopilot · ${r.id}: ${acted}`, subjectType: 'automation', subjectId: r.id });
      }
    } catch { /* rule errors never break the tick; next pass retries */ }
  }
}
