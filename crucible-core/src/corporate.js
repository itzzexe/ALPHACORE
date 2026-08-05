// Corporate division — Legal & Compliance, Vendors/Procurement, People (HR),
// Knowledge Management, and Objectives (OKRs).
// Load-bearing rules made mechanical here: signing is HUMAN-only and named
// (Part 1 §6.1); knowledge verification is HUMAN-only (Part 3 §8); vendor
// renewals and legal review dates feed the immune system so nothing expires
// silently (Part 2 §3.6: surprise renewals = 0).
import { q, one, exec } from './db.js';
import { providersConfig, providerAvailable } from './env.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { archiveItem } from './data.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------- Legal & Compliance ----------
export function createContract({ kind = 'contract', title, counterparty, risk = null, reviewDue = null, vendorId = null, productId = null, decisionId = null, summary = null, actor }) {
  if (!title?.trim() || !counterparty?.trim()) throw new Error('title and counterparty required');
  exec('INSERT INTO contracts (kind, title, counterparty, risk, review_due, vendor_id, product_id, decision_id, summary) VALUES (?,?,?,?,?,?,?,?,?)',
    kind, title.trim(), counterparty.trim(), risk, reviewDue, vendorId, productId, decisionId, summary);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: 'human', actorId: actor, action: 'contract.created', subjectType: 'contract', subjectId: id, payload: { kind, title, counterparty } });
  return one('SELECT * FROM contracts WHERE id = ?', id);
}

export function listContracts() { return q('SELECT * FROM contracts ORDER BY id DESC LIMIT 100'); }

export function setContractState(id, { state, actor }) {
  const c = one('SELECT * FROM contracts WHERE id = ?', id);
  if (!c) throw new Error('contract not found');
  if (!['draft', 'under_review', 'signed', 'expired'].includes(state)) throw new Error('bad state');
  // Signing is never delegated: the signer is a named human, on the record.
  exec(`UPDATE contracts SET state = ?,
        signed_by = CASE WHEN ? = 'signed' THEN ? ELSE signed_by END,
        signed_at = CASE WHEN ? = 'signed' THEN datetime('now') ELSE signed_at END
        WHERE id = ?`, state, state, actor, state, id);
  audit({ actorType: 'human', actorId: actor, action: `contract.${state}`, subjectType: 'contract', subjectId: id, payload: { title: c.title } });
  const final = one('SELECT * FROM contracts WHERE id = ?', id);
  if (state === 'signed') {
    archiveItem({ title: `Signed: ${c.kind} — ${c.title}`, kind: 'contract', subjectType: 'contract', subjectId: id, snapshot: { counterparty: c.counterparty, signedBy: actor, signedAt: final.signed_at }, actor });
  }
  return final;
}

// ---------- Vendors / Procurement ----------
export function seedVendors() {
  // Model providers are vendors too — the register is born non-empty.
  for (const [name, p] of Object.entries(providersConfig.providers)) {
    if (p.kind === 'mock' || !providerAvailable(name)) continue;
    const id = slug(`provider-${name}`);
    if (!one('SELECT id FROM vendors WHERE id = ?', id)) {
      exec('INSERT INTO vendors (id, name, service, owner, source) VALUES (?,?,?,?,?)',
        id, name, 'model provider (A5 terms apply)', 'CTO', 'model-provider');
    }
  }
}

export function createVendor({ name, service, monthlyUsd = 0, renewalDate = null, owner = 'CEO', actor }) {
  if (!name?.trim() || !service?.trim()) throw new Error('name and service required');
  const id = slug(name);
  if (one('SELECT id FROM vendors WHERE id = ?', id)) throw new Error('vendor exists');
  exec('INSERT INTO vendors (id, name, service, monthly_usd, renewal_date, owner) VALUES (?,?,?,?,?,?)',
    id, name.trim(), service.trim(), Number(monthlyUsd) || 0, renewalDate, owner);
  audit({ actorType: 'human', actorId: actor, action: 'vendor.created', subjectType: 'vendor', subjectId: id, payload: { service, monthlyUsd } });
  return one('SELECT * FROM vendors WHERE id = ?', id);
}

export function listVendors() {
  return q('SELECT * FROM vendors ORDER BY state, name').map((v) => ({
    ...v,
    contracts: q('SELECT id, kind, title, state, review_due FROM contracts WHERE vendor_id = ?', v.id),
  }));
}

export function setVendorState(id, { state, actor }) {
  if (!one('SELECT id FROM vendors WHERE id = ?', id)) throw new Error('vendor not found');
  exec('UPDATE vendors SET state = ? WHERE id = ?', state, id);
  audit({ actorType: 'human', actorId: actor, action: `vendor.${state}`, subjectType: 'vendor', subjectId: id });
}

/** Immune rules: renewals inside 14 days and overdue legal reviews surface as alerts. */
export function ruleVendorAndLegalDates() {
  const soon = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const v of q("SELECT * FROM vendors WHERE state = 'active' AND renewal_date IS NOT NULL AND renewal_date <= ?", soon)) {
    notify({ level: 'warn', source: 'immune.vendor', message: `Vendor renewal inside 14 days: ${v.name} ($${v.monthly_usd}/mo) — surprise renewals must be 0.`, subjectType: 'vendor', subjectId: v.id });
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const c of q("SELECT * FROM contracts WHERE state IN ('draft','under_review','signed') AND review_due IS NOT NULL AND review_due < ?", today)) {
    notify({ level: 'warn', source: 'immune.legal', message: `Legal review overdue: ${c.kind} “${c.title}” (${c.counterparty}).`, subjectType: 'contract', subjectId: c.id });
  }
}

// ---------- People (HR) ----------
const FOUNDING_TEAM = [
  { id: 'founder', name: 'Founder', role: 'CEO / Product Owner', type: 'founder', actorId: 'human:founder', deputyId: 'cto' },
  { id: 'cto', name: 'CTO', role: 'CTO / Chief Engineer (CISO hat)', type: 'founder', actorId: 'human:CTO', deputyId: 'founder' },
  { id: 'ops', name: 'Ops Lead', role: 'Ops & Commercial Lead', type: 'founder', actorId: 'human:ops', deputyId: 'founder' },
  { id: 'counsel', name: 'External Counsel', role: 'Legal (fractional)', type: 'fractional', actorId: null, deputyId: null },
  { id: 'accountant', name: 'Accountant', role: 'Books & tax (fractional)', type: 'fractional', actorId: null, deputyId: null },
];

export function seedPeople() {
  for (const p of FOUNDING_TEAM) {
    if (!one('SELECT id FROM people WHERE id = ?', p.id)) {
      exec('INSERT INTO people (id, name, role, type, actor_id, deputy_id) VALUES (?,?,?,?,?,?)',
        p.id, p.name, p.role, p.type, p.actorId, p.deputyId);
    }
  }
}

/** Workload per human = the bus-factor view (Part 7 F6): who holds how much. */
export function listPeople() {
  return q('SELECT * FROM people ORDER BY type, id').map((p) => {
    const a = p.actor_id;
    return {
      ...p,
      load: a ? {
        approvals30d: one("SELECT COUNT(*) AS n FROM approvals WHERE approver_human = ? AND created_at >= datetime('now','-30 days')", a).n,
        auditActions30d: one("SELECT COUNT(*) AS n FROM audit_log WHERE actor_type = 'human' AND actor_id = ? AND occurred_at >= datetime('now','-30 days')", a).n,
        incidentsCommanded: one('SELECT COUNT(*) AS n FROM incidents WHERE commander = ?', a).n,
        agentsOwned: one('SELECT COUNT(*) AS n FROM agents WHERE human_owner = ? COLLATE NOCASE', p.id === 'founder' ? 'CEO' : p.id === 'cto' ? 'CTO' : 'OPS').n,
      } : null,
    };
  });
}

export function createPerson({ name, role, type = 'hire', actorId = null, deputyId = null, actor }) {
  if (!name?.trim() || !role?.trim()) throw new Error('name and role required');
  const id = slug(name);
  if (one('SELECT id FROM people WHERE id = ?', id)) throw new Error('person exists');
  exec('INSERT INTO people (id, name, role, type, actor_id, deputy_id) VALUES (?,?,?,?,?,?)', id, name.trim(), role.trim(), type, actorId, deputyId);
  audit({ actorType: 'human', actorId: actor, action: 'person.added', subjectType: 'person', subjectId: id, payload: { role, type } });
  return one('SELECT * FROM people WHERE id = ?', id);
}

// ---------- Knowledge Management ----------
export function listKnowledge() {
  return q('SELECT * FROM memory_entries ORDER BY id DESC LIMIT 200');
}

export function addKnowledge({ layer = 'org', content, sourceRef, classification = 'internal', createdBy }) {
  if (!content?.trim() || !sourceRef?.trim()) throw new Error('content and sourceRef required');
  exec('INSERT INTO memory_entries (layer, classification, content, source_ref, created_by) VALUES (?,?,?,?,?)',
    layer, classification, content.trim(), sourceRef.trim(), createdBy);
  const id = one('SELECT last_insert_rowid() AS id').id;
  audit({ actorType: createdBy.startsWith('human') ? 'human' : 'agent', actorId: createdBy, action: 'knowledge.added', subjectType: 'memory', subjectId: id, payload: { layer } });
  return id;
}

/** HUMAN-only transitions: unverified → verified, or → retracted. */
export function setKnowledgeVerification(id, { verification, actor }) {
  if (!['verified', 'retracted'].includes(verification)) throw new Error('verification must be verified|retracted');
  const m = one('SELECT * FROM memory_entries WHERE id = ?', id);
  if (!m) throw new Error('entry not found');
  exec('UPDATE memory_entries SET verification = ? WHERE id = ?', verification, id);
  audit({ actorType: 'human', actorId: actor, action: `knowledge.${verification}`, subjectType: 'memory', subjectId: id });
}

/** Cross-link: record an incident's lesson into organizational memory. */
export function lessonFromIncident(incidentId, { content, actor }) {
  const inc = one('SELECT * FROM incidents WHERE id = ?', incidentId);
  if (!inc) throw new Error('incident not found');
  if (!content?.trim()) throw new Error('lesson content required');
  const id = addKnowledge({ layer: 'lesson', content, sourceRef: `incident:${incidentId}`, createdBy: actor });
  // Human-recorded lessons are verified by that act (Part 5 §6.2 sign-off).
  exec("UPDATE memory_entries SET verification = 'verified' WHERE id = ?", id);
  return id;
}

// ---------- Objectives (OKRs) ----------
export function createObjective({ title, quarter, owner, productId = null, krs = [], actor }) {
  if (!title?.trim() || !quarter?.trim() || !owner?.trim()) throw new Error('title, quarter, owner required');
  const id = slug(`${quarter}-${title}`);
  if (one('SELECT id FROM objectives WHERE id = ?', id)) throw new Error('objective exists');
  exec('INSERT INTO objectives (id, title, quarter, owner, product_id, krs) VALUES (?,?,?,?,?,?)',
    id, title.trim(), quarter.trim(), owner.trim(), productId, JSON.stringify(krs));
  audit({ actorType: 'human', actorId: actor, action: 'objective.created', subjectType: 'objective', subjectId: id, payload: { quarter, owner } });
  return getObjective(id);
}

export function getObjective(id) {
  const o = one('SELECT * FROM objectives WHERE id = ?', id);
  return o ? { ...o, krs: JSON.parse(o.krs) } : null;
}

export function listObjectives() {
  return q('SELECT id FROM objectives ORDER BY quarter DESC, id').map((r) => getObjective(r.id));
}

export function updateObjective(id, { krs = null, state = null, actor }) {
  const o = getObjective(id);
  if (!o) throw new Error('objective not found');
  exec('UPDATE objectives SET krs = COALESCE(?, krs), state = COALESCE(?, state) WHERE id = ?',
    krs === null ? null : JSON.stringify(krs), state, id);
  audit({ actorType: 'human', actorId: actor, action: 'objective.updated', subjectType: 'objective', subjectId: id, payload: { state } });
  return getObjective(id);
}
