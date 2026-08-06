// Relations division — Relationship Management (RM). Partners, investors,
// government, media, and community relations, with a shared interactions log
// that also covers customers and vendors. The RM agent (AGT-RM-001) drafts
// outreach; a HUMAN always sends it — same load-bearing rule as support.
// Immune rule: an active relationship with no touch in 30 days goes stale
// loudly, never silently.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { enqueueRun } from './workflow.js';

const KINDS = ['partner', 'investor', 'government', 'media', 'community', 'strategic'];
const TIERS = ['strategic', 'key', 'standard'];

// ---------- partners ----------
export function createPartner({ name, kind = 'partner', tier = 'standard', owner, notes = null, actor }) {
  if (!name?.trim() || !owner?.trim()) throw new Error('name and owner required');
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join('|')}`);
  if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join('|')}`);
  exec('INSERT INTO partners (name, kind, tier, owner, notes) VALUES (?,?,?,?,?)',
    name.trim(), kind, tier, owner.trim(), notes);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'partner.created', subjectType: 'partner', subjectId: id, payload: { name: name.trim(), kind, tier } });
  return one('SELECT * FROM partners WHERE id = ?', id);
}

export function listPartners() {
  return q('SELECT * FROM partners ORDER BY state = \'ended\', CASE tier WHEN \'strategic\' THEN 0 WHEN \'key\' THEN 1 ELSE 2 END, id DESC LIMIT 200')
    .map((p) => {
      const last = one('SELECT kind, summary, created_at FROM interactions WHERE partner_id = ? ORDER BY id DESC LIMIT 1', p.id);
      const next = one("SELECT next_action, next_date FROM interactions WHERE partner_id = ? AND next_action IS NOT NULL ORDER BY id DESC LIMIT 1", p.id);
      return {
        ...p,
        touches: one('SELECT COUNT(*) AS n FROM interactions WHERE partner_id = ?', p.id).n,
        lastTouch: last || null,
        nextAction: next || null,
      };
    });
}

export function setPartnerState(id, { state, actor }) {
  if (!['prospect', 'active', 'dormant', 'ended'].includes(state)) throw new Error('bad state');
  if (!one('SELECT id FROM partners WHERE id = ?', id)) throw new Error('partner not found');
  exec('UPDATE partners SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `partner.${state}`, subjectType: 'partner', subjectId: id });
}

export function setPartnerHealth(id, { health, actor }) {
  const h = Math.min(5, Math.max(1, Number(health) || 3));
  if (!one('SELECT id FROM partners WHERE id = ?', id)) throw new Error('partner not found');
  exec('UPDATE partners SET health = ? WHERE id = ?', h, id);
  audit({ actorType: 'human', actorId: actor, action: 'partner.health', subjectType: 'partner', subjectId: id, payload: { health: h } });
}

// ---------- interactions (shared log: partners, customers, vendors) ----------
export function logInteraction({ partnerId = null, customerId = null, vendorId = null, kind = 'note', summary, nextAction = null, nextDate = null, actor }) {
  if (!summary?.trim()) throw new Error('summary required');
  if (!partnerId && !customerId && !vendorId) throw new Error('link the interaction to a partner, customer, or vendor');
  exec('INSERT INTO interactions (partner_id, customer_id, vendor_id, kind, summary, next_action, next_date, logged_by) VALUES (?,?,?,?,?,?,?,?)',
    partnerId, customerId, vendorId, kind, summary.trim(), nextAction, nextDate, actor);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'interaction.logged', subjectType: 'interaction', subjectId: id, payload: { partnerId, customerId, vendorId, kind } });
  return one('SELECT * FROM interactions WHERE id = ?', id);
}

export function listInteractions({ partnerId = null, customerId = null, vendorId = null } = {}) {
  if (partnerId) return q('SELECT * FROM interactions WHERE partner_id = ? ORDER BY id DESC LIMIT 100', partnerId);
  if (customerId) return q('SELECT * FROM interactions WHERE customer_id = ? ORDER BY id DESC LIMIT 100', customerId);
  if (vendorId) return q('SELECT * FROM interactions WHERE vendor_id = ? ORDER BY id DESC LIMIT 100', vendorId);
  return q('SELECT * FROM interactions ORDER BY id DESC LIMIT 100');
}

// ---------- overview ----------
export function relationsOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  return {
    byKind: Object.fromEntries(q("SELECT kind, COUNT(*) AS n FROM partners WHERE state != 'ended' GROUP BY kind").map((r) => [r.kind, r.n])),
    active: one("SELECT COUNT(*) AS n FROM partners WHERE state = 'active'").n,
    prospects: one("SELECT COUNT(*) AS n FROM partners WHERE state = 'prospect'").n,
    avgHealth: one("SELECT AVG(health) AS h FROM partners WHERE state = 'active'")?.h ?? null,
    upcoming: q(`SELECT i.next_action, i.next_date, i.partner_id, p.name FROM interactions i
                 JOIN partners p ON p.id = i.partner_id
                 WHERE i.next_action IS NOT NULL AND i.next_date IS NOT NULL AND i.next_date BETWEEN ? AND ?
                 ORDER BY i.next_date LIMIT 20`, today, soon),
    overdue: q(`SELECT i.next_action, i.next_date, i.partner_id, p.name FROM interactions i
                JOIN partners p ON p.id = i.partner_id
                WHERE i.next_action IS NOT NULL AND i.next_date IS NOT NULL AND i.next_date < ?
                ORDER BY i.next_date LIMIT 20`, today),
    stale: q(`SELECT p.id, p.name, p.tier, MAX(i.created_at) AS last FROM partners p
              LEFT JOIN interactions i ON i.partner_id = p.id
              WHERE p.state = 'active'
              GROUP BY p.id
              HAVING last IS NULL OR last < datetime('now','-30 days')
              LIMIT 20`),
    recent: q(`SELECT i.*, p.name AS partner_name FROM interactions i
               LEFT JOIN partners p ON p.id = i.partner_id ORDER BY i.id DESC LIMIT 15`),
  };
}

// ---------- AI outreach (draft only — a human sends) ----------
export function draftOutreach(partnerId, actor) {
  const p = one('SELECT * FROM partners WHERE id = ?', partnerId);
  if (!p) throw new Error('partner not found');
  const recent = q('SELECT kind, summary, created_at FROM interactions WHERE partner_id = ? ORDER BY id DESC LIMIT 5', partnerId);
  const runId = enqueueRun({
    agentId: 'AGT-RM-001',
    taskType: `outreach:${partnerId}`,
    input: {
      prompt: `Draft an outreach message for this relationship. A human will review and send it — never claim it was sent.
Partner: ${p.name} (kind: ${p.kind}, tier: ${p.tier}, state: ${p.state}, health: ${p.health}/5)
Notes: ${p.notes || '—'}
Recent interactions:\n${recent.map((r) => `- [${r.created_at}] ${r.kind}: ${r.summary}`).join('\n') || '- none yet'}
Output JSON: {"draft":"","channel":"email|call-script","goal":"","confidence":0.0}`,
    },
    actor,
  });
  exec('UPDATE partners SET draft = NULL, draft_run_id = ? WHERE id = ?', runId, partnerId);
  audit({ actorType: 'human', actorId: actor, action: 'partner.outreach_requested', subjectType: 'partner', subjectId: partnerId, payload: { runId } });
  return runId;
}

/** Server tick: completed outreach runs land as drafts on the partner card. */
export function syncOutreachDrafts() {
  for (const p of q('SELECT * FROM partners WHERE draft_run_id IS NOT NULL AND draft IS NULL')) {
    const run = one('SELECT state, output FROM runs WHERE id = ?', p.draft_run_id);
    if (!run) { exec('UPDATE partners SET draft_run_id = NULL WHERE id = ?', p.id); continue; }
    if (run.state === 'done') {
      const out = run.output ? JSON.parse(run.output) : {};
      const draft = out.parsed?.draft || out.parsed?.summary || null;
      if (draft) {
        exec('UPDATE partners SET draft = ? WHERE id = ?', draft, p.id);
        notify({ level: 'info', source: 'relations', message: `Outreach draft ready for ${p.name} — review and send it yourself.`, subjectType: 'partner', subjectId: p.id });
      } else {
        exec('UPDATE partners SET draft_run_id = NULL WHERE id = ?', p.id);
      }
    } else if (['failed', 'cancelled'].includes(run.state)) {
      exec('UPDATE partners SET draft_run_id = NULL WHERE id = ?', p.id);
    }
  }
}

/** A human sends the draft; the record shows who and when. */
export function markOutreachSent(partnerId, { body = null, actor }) {
  const p = one('SELECT * FROM partners WHERE id = ?', partnerId);
  if (!p) throw new Error('partner not found');
  const text = body || p.draft;
  if (!text) throw new Error('no draft to send');
  const edited = body !== null && body !== p.draft;
  const it = logInteraction({ partnerId, kind: 'email', summary: `Outreach sent${edited ? ' (edited)' : ''}: ${text.slice(0, 200)}`, actor });
  exec('UPDATE partners SET draft = NULL, draft_run_id = NULL WHERE id = ?', partnerId);
  audit({ actorType: 'human', actorId: actor, action: 'partner.outreach_sent', subjectType: 'partner', subjectId: partnerId, payload: { edited } });
  return it;
}

/** Immune rule: strategic/key active relationships never go quiet unnoticed. */
export function ruleStaleRelations() {
  for (const p of q(`SELECT p.id, p.name, p.tier, MAX(i.created_at) AS last FROM partners p
                     LEFT JOIN interactions i ON i.partner_id = p.id
                     WHERE p.state = 'active' AND p.tier IN ('strategic','key')
                     GROUP BY p.id
                     HAVING last IS NULL OR last < datetime('now','-30 days')`)) {
    notify({ level: 'warn', source: 'immune.relations', message: `Relationship gone quiet: ${p.name} (${p.tier}) — no interaction in 30+ days.`, subjectType: 'partner', subjectId: p.id });
  }
}
