// Product portfolio — the SaaS Product Factory's Gates 1-10 (Part 4) as a
// tracked object. Advancing a gate is a HUMAN action with a note (the gate
// record); Gates 2 and 8 remind the approver of their special rules
// (payment-intent evidence; joint CEO+CTO go). Gate 10 outcomes may retire.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const GATE_TITLES = [
  'Opportunity', 'Validation', 'Definition', 'Architecture', 'Experience',
  'Build', 'Assurance', 'Launch', 'Operate', 'Evolve or Retire',
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function createProduct({ name, description = '', actor }) {
  if (!name?.trim()) throw new Error('name required');
  const id = slug(name);
  if (one('SELECT id FROM products WHERE id = ?', id)) throw new Error('product exists');
  const gates = GATE_TITLES.map((title, i) => ({
    gate: i + 1, title, status: i === 0 ? 'active' : 'pending', note: null, decisionId: null, date: null,
  }));
  exec('INSERT INTO products (id, name, description, gates) VALUES (?,?,?,?)', id, name.trim(), description, JSON.stringify(gates));
  audit({ actorType: 'human', actorId: actor, action: 'product.created', subjectType: 'product', subjectId: id });
  return getProduct(id);
}

export function getProduct(id) {
  const p = one('SELECT * FROM products WHERE id = ?', id);
  if (!p) return null;
  const gates = JSON.parse(p.gates);
  return {
    ...p,
    gates,
    related: {
      pipelines: q('SELECT id, name, state, workspace FROM pipelines WHERE product_id = ? ORDER BY created_at DESC LIMIT 10', id),
      incidents: q('SELECT id, sev, title, state FROM incidents WHERE product_id = ? ORDER BY id DESC LIMIT 10', id),
      tickets: q('SELECT id, subject, state FROM tickets WHERE product_id = ? ORDER BY id DESC LIMIT 10', id),
      gateDecisions: gates.filter((g) => g.decisionId).map((g) => ({ gate: g.gate, title: g.title, decisionId: g.decisionId })),
    },
  };
}

export function listProducts() {
  return q('SELECT id FROM products ORDER BY created_at DESC').map((r) => getProduct(r.id));
}

/** Human passes the active gate. Gate rules from Part 4 are enforced as reminders + audit payload. */
export function advanceGate(id, { note, decisionId = null, actor }) {
  const p = getProduct(id);
  if (!p) throw new Error('product not found');
  if (p.state === 'retired') throw new Error('product is retired');
  if (!note?.trim()) throw new Error('a gate note (the decision artifact) is required');
  const i = p.stage - 1;
  if (i >= 9) throw new Error('Gate 10 is a rotary — use the retire action or a new cycle, not advance');
  p.gates[i] = { ...p.gates[i], status: 'passed', note: note.trim(), decisionId, date: new Date().toISOString().slice(0, 10) };
  p.gates[i + 1] = { ...p.gates[i + 1], status: 'active' };
  const newStage = p.stage + 1;
  const newState = newStage >= 9 ? 'live' : newStage >= 3 ? 'building' : 'exploring';
  exec('UPDATE products SET gates = ?, stage = ?, state = ? WHERE id = ?', JSON.stringify(p.gates), newStage, newState, id);
  audit({
    actorType: 'human', actorId: actor, action: 'product.gate_passed', subjectType: 'product', subjectId: id,
    payload: { gate: p.stage, title: p.gates[i].title, decisionId, note: note.slice(0, 200) },
  });
  return getProduct(id);
}

export function retireProduct(id, { note, actor }) {
  const p = getProduct(id);
  if (!p) throw new Error('product not found');
  if (!note?.trim()) throw new Error('a retirement note (T3 record ref) is required');
  exec("UPDATE products SET state = 'retired' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'product.retired', subjectType: 'product', subjectId: id, payload: { note: note.slice(0, 200) } });
  return getProduct(id);
}
