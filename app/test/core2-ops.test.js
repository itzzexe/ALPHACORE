// Operations — the part of the company with a warehouse key.
//
// A stock level is never stored, so it cannot be wrong without a move being
// wrong; an issue cannot take it below zero; goods are received only against
// a procurement that was delivered. A room refuses a clash. A ticket carries
// an SLA clock the sweep compares, and a breach is announced once. And an HR
// ticket's words are sealed under the person who raised them, while an IT
// ticket's are not — asserted by reading the raw file, with the IT ticket as
// the control that proves the check can see plaintext when it is there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-ops.db';
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 53).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-ops.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { seedAgents } = await import('../src/workflow.js');
const { seedConstitution } = await import('../src/constitution.js');
const { seedChart } = await import('../src/ledger.js');
const { createPerson, employ } = await import('../src/core2/identity.js');
const { seedBridge } = await import('../src/core2/bridge.js');
const { createProcurement, advanceProcurement } = await import('../src/core2/procure.js');
const O = await import('../src/core2/ops.js');

seedAgents();
seedConstitution();
seedChart();
seedBridge();
const AGENT = one('SELECT id FROM agents LIMIT 1').id;
const p1 = createPerson({ displayName: 'Huda Rashid', personalEmail: 'huda@example.test', actor: 'human:test' });
const e1 = employ({ personId: p1.id, employeeNo: 'E001', actor: 'human:test' });

function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  return fs.existsSync(DB) && fs.readFileSync(DB).includes(Buffer.from(needle, 'utf8'));
}

test('a level is the sum of its moves, cannot go below zero, and low stock is announced once a day', () => {
  const wh = O.createWarehouse({ name: 'Main store', code: 'MAIN', actor: 'human:test' });
  const item = O.createItem({ sku: 'paper-a4', name: 'A4 paper', minQty: 5, cost: 2, actor: 'human:test' });
  assert.equal(item.sku, 'PAPER-A4');
  O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 10, kind: 'receipt', actor: `agent:${AGENT}` });
  assert.equal(O.stockLevel(item.id), 10);
  assert.throws(() => O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 12, kind: 'issue', actor: 'human:test' }), /only 10/);
  O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 7, kind: 'issue', actor: 'human:test' });
  const level = O.stockLevels().find((r) => r.id === item.id);
  assert.equal(level.level, 3);
  assert.equal(level.low, true);
  assert.equal(level.value, 6);
  assert.ok(!q('PRAGMA table_info(ops_item)').some((c) => c.name === 'level' || c.name === 'qty'), 'a stored level is a number that can drift');
  O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 1, kind: 'issue', actor: 'human:test' });
  assert.equal(q("SELECT id FROM jobs WHERE kind = 'core2.event' AND payload LIKE '%stock.low%'").length, 1, 'low stock is one announcement a day, not one per move');
});

test('goods are received against a delivered procurement only, and a transfer is two moves', () => {
  const wh = one("SELECT id FROM ops_warehouse WHERE code = 'MAIN'");
  const wh2 = O.createWarehouse({ name: 'Site store', code: 'SITE', actor: 'human:test' });
  const item = one("SELECT id FROM ops_item WHERE sku = 'PAPER-A4'");
  const pr = createProcurement({ title: 'Paper', amount: 50, actor: 'human:test' });
  advanceProcurement(pr.id, { to: 'approved', actor: 'human:cfo' });
  advanceProcurement(pr.id, { to: 'po', actor: 'human:test' });
  assert.throws(() => O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 20, kind: 'receipt', procRequestId: pr.id, actor: 'human:test' }), /delivered procurement/);
  advanceProcurement(pr.id, { to: 'delivered', actor: 'human:test' });
  O.recordStockMove({ itemId: item.id, warehouseId: wh.id, qty: 20, kind: 'receipt', procRequestId: pr.id, actor: 'human:test' });
  assert.equal(O.stockLevel(item.id, wh.id), 22);
  O.transferStock({ itemId: item.id, fromWarehouseId: wh.id, toWarehouseId: wh2.id, qty: 5, actor: 'human:test' });
  assert.equal(O.stockLevel(item.id, wh.id), 17);
  assert.equal(O.stockLevel(item.id, wh2.id), 5);
  assert.equal(O.stockLevel(item.id), 22, 'a transfer changes nothing in total');
});

test('a room refuses a clash; a work order on a vehicle takes it out of service and back', () => {
  const room = O.createRoom({ name: 'Board room', capacity: 8, actor: 'human:test' });
  O.bookRoom({ roomId: room.id, employeeId: e1.id, starts: '2026-09-01 10:00:00', ends: '2026-09-01 11:00:00', actor: 'human:test' });
  assert.throws(() => O.bookRoom({ roomId: room.id, employeeId: e1.id, starts: '2026-09-01 10:30:00', ends: '2026-09-01 11:30:00', actor: 'human:test' }), /already booked/);
  O.bookRoom({ roomId: room.id, employeeId: e1.id, starts: '2026-09-01 11:00:00', ends: '2026-09-01 12:00:00', actor: 'human:test' });
  assert.equal(O.roomAvailability('2026-09-01')[0].bookings.length, 2);

  const v = O.addVehicle({ plate: 'bgd 1234', make: 'Toyota', model: 'Hilux', odometer: 1000, assigneeEmployeeId: e1.id, actor: 'human:test' });
  assert.equal(v.plate, 'BGD 1234');
  assert.throws(() => O.updateVehicle(v.id, { odometer: 900, actor: 'human:test' }), /does not go backwards/);
  const wo = O.createWorkOrder({ title: 'Service', targetKind: 'vehicle', targetId: v.id, priority: 'high', actor: `agent:${AGENT}` });
  assert.equal(one('SELECT state FROM ops_vehicle WHERE id = ?', v.id).state, 'in_service');
  O.setWorkOrderState(wo.id, { state: 'done', cost: 120, actor: 'human:test' });
  const after = one('SELECT * FROM ops_vehicle WHERE id = ?', v.id);
  assert.equal(after.state, 'active');
  assert.ok(after.next_service, 'a serviced vehicle has its next date');
  assert.throws(() => O.setWorkOrderState(wo.id, { state: 'open', actor: 'human:test' }), /already done/);
});

test('a ticket carries an SLA clock; a breach is announced once; an HR ticket seals its words', () => {
  const urgent = O.openTicket({ title: 'Server room too hot', category: 'facilities', priority: 'urgent', requesterEmployeeId: e1.id, actor: 'human:test' });
  assert.equal(urgent.ref, 'HD-2026-0001');
  const hours = (new Date(urgent.sla_due.replace(' ', 'T') + 'Z') - Date.now()) / 3600000;
  assert.ok(hours > 3.9 && hours <= 4, `urgent is four hours, got ${hours}`);
  assert.equal(O.slaSweep().breached, 0);
  exec("UPDATE ops_ticket SET sla_due = datetime('now', '-1 hour') WHERE id = ?", urgent.id);
  assert.equal(O.slaSweep().breached, 1);
  assert.equal(O.slaSweep().breached, 0, 'announced once');
  assert.equal(q("SELECT id FROM jobs WHERE kind = 'core2.event' AND payload LIKE '%ticket.breached%'").length, 1);

  const hr = O.openTicket({ title: 'Payslip question', category: 'hr', requesterEmployeeId: e1.id, body: 'PLANTED-HR-TICKET-4b2 a private matter', actor: 'human:test' });
  const it = O.openTicket({ title: 'Laptop', category: 'it', requesterEmployeeId: e1.id, body: 'PLANTED-IT-TICKET-4b2 a broken hinge', actor: 'human:test' });
  assert.equal(one('SELECT classification FROM doc_document WHERE id = ?', hr.doc_id).classification, 'restricted');
  assert.equal(one('SELECT classification FROM doc_document WHERE id = ?', it.doc_id).classification, 'internal');
  assert.ok(diskContains('PLANTED-IT-TICKET'), 'the control: an internal body is readable, so the check can see plaintext');
  assert.ok(!diskContains('PLANTED-HR-TICKET'), 'an HR ticket\'s words are readable on disk');

  O.assignTicket(it.id, { assigneeEmployeeId: e1.id, actor: 'human:test' });
  assert.equal(O.getTicket(it.id).state, 'in_progress');
  O.setTicketState(it.id, { state: 'resolved', actor: `agent:${AGENT}` });
  O.setTicketState(it.id, { state: 'closed', actor: 'human:test' });
  assert.throws(() => O.setTicketState(it.id, { state: 'open', actor: 'human:test' }), /stays closed/);
});

test('a severe incident is chained, and closing any incident is human', () => {
  const i = O.reportIncident({ kind: 'safety', severity: 1, title: 'Fall in stairwell B', action: 'Rail repaired', actor: `agent:${AGENT}` });
  assert.ok(one("SELECT action FROM audit_log WHERE action = 'incident.reported'"), 'severity 1 is consequential');
  assert.throws(() => O.setIncidentState(i.id, { state: 'closed', actor: `agent:${AGENT}` }), /human act/);
  O.setIncidentState(i.id, { state: 'investigating', actor: `agent:${AGENT}` });
  O.setIncidentState(i.id, { state: 'closed', actor: 'human:safety' });
  assert.equal(one('SELECT state FROM ops_incident WHERE id = ?', i.id).state, 'closed');
  // Workplace incidents never land in Core 1's SEV table.
  assert.equal(one('SELECT COUNT(*) AS n FROM incidents').n, 0);
});
