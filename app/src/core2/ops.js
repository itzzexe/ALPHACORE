// OPERATIONS — stock, work orders, the fleet, the rooms, the internal help
// desk, and workplace incidents.
//
// This is the part of a company that has a warehouse key and a first-aid box.
// Core 1's incidents are SEV1s on a server; these are a forklift and a wet
// floor. Core 1's tickets are customers writing in; these are an employee
// whose laptop will not start. Different species, and kept apart so a report
// on either is not a blend of both.
//
// Stock levels are never stored. They are the sum of the moves, so a level
// that is wrong has a move behind it that can be found.
import { q, one, exec } from '../db.js';
import { log } from './identity.js';
import { emit } from './bridge.js';
import { createDocument } from './documents.js';
import { nextRef } from './finance.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const clean = (s, n = 120) => String(s ?? '').trim().slice(0, n);
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const employeeOk = (id) => {
  if (id == null) return null;
  if (!one("SELECT id FROM hr_employee WHERE id = ? AND state = 'active'", Number(id))) refuse('no such active employee');
  return Number(id);
};

// ------------------------------------------------------------------- stock --

export function createWarehouse({ name, code, actor }) {
  if (!actor) refuse('a warehouse is opened by somebody');
  exec('INSERT INTO ops_warehouse (name, code) VALUES (?,?)', clean(name) || 'Warehouse', clean(code, 12).toUpperCase() || `WH${Date.now() % 1000}`);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'warehouse', entityId: id, action: 'warehouse.created', actor });
  return one('SELECT * FROM ops_warehouse WHERE id = ?', id);
}

export function createItem({ sku, name, unit = 'each', minQty = 0, cost = 0, actor }) {
  if (!actor) refuse('an item is catalogued by somebody');
  if (!clean(sku, 40)) refuse('an item needs a SKU');
  exec('INSERT INTO ops_item (sku, name, unit, min_qty, cost) VALUES (?,?,?,?,?)', clean(sku, 40).toUpperCase(), clean(name) || clean(sku, 40), clean(unit, 12), Number(minQty) || 0, round2(Number(cost) || 0));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'item', entityId: id, action: 'item.created', actor });
  return one('SELECT * FROM ops_item WHERE id = ?', id);
}

export function recordStockMove({ itemId, warehouseId, qty, kind = 'adjust', ref = null, procRequestId = null, actor }) {
  if (!actor) refuse('a stock move carries a name');
  const item = one("SELECT * FROM ops_item WHERE id = ? AND state = 'active'", Number(itemId));
  if (!item) refuse('no such item');
  const wh = one("SELECT * FROM ops_warehouse WHERE id = ? AND state = 'active'", Number(warehouseId));
  if (!wh) refuse('no such warehouse');
  let n = Number(qty);
  if (!n) refuse('a move has a quantity');
  if (['receipt', 'transfer_in'].includes(kind)) n = Math.abs(n);
  if (['issue', 'transfer_out'].includes(kind)) n = -Math.abs(n);
  if (!['receipt', 'issue', 'transfer_in', 'transfer_out', 'adjust'].includes(kind)) refuse('kind is receipt, issue, transfer_in, transfer_out or adjust');
  const level = stockLevel(item.id, wh.id);
  if (level + n < -0.0001) refuse(`only ${level} ${item.unit} of ${item.sku} in ${wh.code}`);
  if (procRequestId && !one("SELECT id FROM proc_request WHERE id = ? AND state IN ('delivered','invoiced','paid')", Number(procRequestId))) refuse('goods are received against a delivered procurement');
  exec('INSERT INTO ops_stock_move (item_id, warehouse_id, qty, kind, ref, proc_request_id, created_by) VALUES (?,?,?,?,?,?,?)',
    item.id, wh.id, n, kind, ref ? clean(ref, 80) : null, procRequestId ? Number(procRequestId) : null, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'stock_move', entityId: id, action: `stock.${kind}`, actor, detail: { sku: item.sku, qty: n } });
  const total = stockLevel(item.id);
  if (item.min_qty > 0 && total < item.min_qty) emit('stock.low', { id: item.id, sku: item.sku, level: total }, { idempotency: `stock-low-${item.id}-${today()}` });
  return one('SELECT * FROM ops_stock_move WHERE id = ?', id);
}

/** Two moves, one act: out of one warehouse and into another. */
export function transferStock({ itemId, fromWarehouseId, toWarehouseId, qty, actor }) {
  if (Number(fromWarehouseId) === Number(toWarehouseId)) refuse('a transfer needs two warehouses');
  const ref = `XFER-${Date.now()}`;
  recordStockMove({ itemId, warehouseId: fromWarehouseId, qty, kind: 'transfer_out', ref, actor });
  return recordStockMove({ itemId, warehouseId: toWarehouseId, qty, kind: 'transfer_in', ref, actor });
}

export const stockLevel = (itemId, warehouseId = null) => Number(one(
  'SELECT COALESCE(SUM(qty), 0) AS n FROM ops_stock_move WHERE item_id = ? AND (? IS NULL OR warehouse_id = ?)', Number(itemId), warehouseId, warehouseId,
).n);

export function stockLevels() {
  return q(`SELECT i.id, i.sku, i.name, i.unit, i.min_qty, i.cost,
      COALESCE((SELECT SUM(qty) FROM ops_stock_move m WHERE m.item_id = i.id), 0) AS level
    FROM ops_item i WHERE i.state = 'active' ORDER BY i.sku`).map((r) => ({
    ...r, level: round2(r.level), low: r.min_qty > 0 && r.level < r.min_qty, value: round2(r.level * r.cost),
    byWarehouse: q('SELECT w.code, w.name, SUM(m.qty) AS level FROM ops_stock_move m JOIN ops_warehouse w ON w.id = m.warehouse_id WHERE m.item_id = ? GROUP BY w.id HAVING SUM(m.qty) != 0', r.id),
  }));
}

export const lowStock = () => stockLevels().filter((r) => r.low);

// ------------------------------------------------------------- work orders --

export function createWorkOrder({ title, targetKind = 'other', targetId = null, priority = 'normal', assigneeEmployeeId = null, due = null, actor }) {
  if (!actor) refuse('a work order is raised by somebody');
  if (!clean(title)) refuse('a work order says what needs doing');
  if (!['fixed_asset', 'vehicle', 'room', 'other'].includes(targetKind)) refuse('target is fixed_asset, vehicle, room or other');
  if (!['low', 'normal', 'high', 'urgent'].includes(priority)) refuse('priority is low, normal, high or urgent');
  const table = { fixed_asset: 'fin_fixed_asset', vehicle: 'ops_vehicle', room: 'ops_room' }[targetKind];
  if (table && targetId && !one(`SELECT id FROM ${table} WHERE id = ?`, Number(targetId))) refuse(`no such ${targetKind}`);
  exec(`INSERT INTO ops_workorder (title, target_kind, target_id, priority, assignee_employee_id, due, created_by) VALUES (?,?,?,?,?,?,?)`,
    clean(title, 200), targetKind, targetId ? Number(targetId) : null, priority, employeeOk(assigneeEmployeeId), due, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  if (targetKind === 'vehicle' && targetId) exec("UPDATE ops_vehicle SET state = 'in_service' WHERE id = ?", Number(targetId));
  log({ entity: 'workorder', entityId: id, action: 'workorder.created', actor, detail: { targetKind, priority } });
  emit('workorder.created', { id, priority });
  return one('SELECT * FROM ops_workorder WHERE id = ?', id);
}

export function setWorkOrderState(id, { state, cost = null, assigneeEmployeeId = null, actor }) {
  if (!actor) refuse('moving a work order carries a name');
  const w = one('SELECT * FROM ops_workorder WHERE id = ?', Number(id));
  if (!w) refuse('no such work order');
  if (!['open', 'in_progress', 'done', 'cancelled'].includes(state)) refuse('state is open, in_progress, done or cancelled');
  if (['done', 'cancelled'].includes(w.state)) refuse(`already ${w.state}`);
  exec(`UPDATE ops_workorder SET state = ?, cost = COALESCE(?, cost), assignee_employee_id = COALESCE(?, assignee_employee_id),
        closed_at = CASE WHEN ? IN ('done','cancelled') THEN datetime('now') ELSE closed_at END WHERE id = ?`,
  state, cost == null ? null : round2(Number(cost)), employeeOk(assigneeEmployeeId), state, w.id);
  if (state === 'done' && w.target_kind === 'vehicle' && w.target_id) {
    exec("UPDATE ops_vehicle SET state = 'active', next_service = date('now', '+6 month') WHERE id = ?", w.target_id);
  }
  log({ entity: 'workorder', entityId: w.id, action: `workorder.${state}`, actor });
  return one('SELECT * FROM ops_workorder WHERE id = ?', w.id);
}

export const listWorkOrders = ({ state = null } = {}) => q(`SELECT w.*, p.display_name AS assignee FROM ops_workorder w
  LEFT JOIN hr_employee e ON e.id = w.assignee_employee_id LEFT JOIN hr_person p ON p.id = e.person_id
  WHERE (? IS NULL OR w.state = ?) ORDER BY w.state IN ('done','cancelled'), w.priority = 'urgent' DESC, w.id DESC LIMIT 200`, state, state);

// ------------------------------------------------------------------- fleet --

export function addVehicle({ plate, make, model = null, year = null, odometer = 0, assigneeEmployeeId = null, nextService = null, actor }) {
  if (!actor) refuse('a vehicle is registered by somebody');
  if (!clean(plate, 20)) refuse('a vehicle has a plate');
  exec(`INSERT INTO ops_vehicle (plate, make, model, year, odometer, assignee_employee_id, next_service) VALUES (?,?,?,?,?,?,?)`,
    clean(plate, 20).toUpperCase(), clean(make, 40) || 'Unknown', model ? clean(model, 40) : null, year ? Number(year) : null, Math.max(0, Math.round(Number(odometer) || 0)), employeeOk(assigneeEmployeeId), nextService);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'vehicle', entityId: id, action: 'vehicle.added', actor });
  return one('SELECT * FROM ops_vehicle WHERE id = ?', id);
}

export function updateVehicle(id, { odometer = null, assigneeEmployeeId = null, nextService = null, state = null, actor }) {
  if (!actor) refuse('updating a vehicle carries a name');
  const v = one('SELECT * FROM ops_vehicle WHERE id = ?', Number(id));
  if (!v) refuse('no such vehicle');
  if (odometer != null && Number(odometer) < v.odometer) refuse('an odometer does not go backwards');
  if (state && !['active', 'in_service', 'retired'].includes(state)) refuse('state is active, in_service or retired');
  exec(`UPDATE ops_vehicle SET odometer = COALESCE(?, odometer), assignee_employee_id = COALESCE(?, assignee_employee_id),
        next_service = COALESCE(?, next_service), state = COALESCE(?, state) WHERE id = ?`,
  odometer == null ? null : Math.round(Number(odometer)), employeeOk(assigneeEmployeeId), nextService, state, v.id);
  log({ entity: 'vehicle', entityId: v.id, action: 'vehicle.updated', actor });
  return one('SELECT * FROM ops_vehicle WHERE id = ?', v.id);
}

export const fleet = () => q(`SELECT v.*, p.display_name AS assignee FROM ops_vehicle v
  LEFT JOIN hr_employee e ON e.id = v.assignee_employee_id LEFT JOIN hr_person p ON p.id = e.person_id ORDER BY v.state, v.plate`);

// ------------------------------------------------------------------- rooms --

export function createRoom({ name, building = null, capacity = 4, actor }) {
  if (!actor) refuse('a room is listed by somebody');
  exec('INSERT INTO ops_room (name, building, capacity) VALUES (?,?,?)', clean(name) || 'Room', building ? clean(building) : null, Math.max(1, Math.round(Number(capacity) || 4)));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'room', entityId: id, action: 'room.created', actor });
  return one('SELECT * FROM ops_room WHERE id = ?', id);
}

export function bookRoom({ roomId, employeeId, starts, ends, meetingId = null, actor }) {
  if (!actor) refuse('a booking carries a name');
  const room = one("SELECT * FROM ops_room WHERE id = ? AND state = 'active'", Number(roomId));
  if (!room) refuse('no such room');
  const who = employeeOk(employeeId);
  if (!who) refuse('a booking belongs to an employee');
  if (!(starts < ends)) refuse('a booking ends after it starts');
  if (meetingId && !one('SELECT id FROM mtg_meeting WHERE id = ?', Number(meetingId))) refuse('no such meeting');
  const clash = one("SELECT id FROM ops_booking WHERE room_id = ? AND state = 'booked' AND starts < ? AND ends > ?", room.id, ends, starts);
  if (clash) refuse(`${room.name} is already booked then (#${clash.id})`);
  exec('INSERT INTO ops_booking (room_id, employee_id, starts, ends, meeting_id) VALUES (?,?,?,?,?)', room.id, who, starts, ends, meetingId ? Number(meetingId) : null);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'booking', entityId: id, action: 'room.booked', actor, detail: { roomId: room.id } });
  return one('SELECT * FROM ops_booking WHERE id = ?', id);
}

export function cancelBooking(id, { actor }) {
  if (!actor) refuse('cancelling carries a name');
  const b = one("SELECT * FROM ops_booking WHERE id = ? AND state = 'booked'", Number(id));
  if (!b) refuse('no such booking');
  exec("UPDATE ops_booking SET state = 'cancelled' WHERE id = ?", b.id);
  log({ entity: 'booking', entityId: b.id, action: 'room.cancelled', actor });
  return one('SELECT * FROM ops_booking WHERE id = ?', b.id);
}

export function roomAvailability(day = today()) {
  return q("SELECT * FROM ops_room WHERE state = 'active' ORDER BY name").map((r) => ({
    ...r,
    bookings: q(`SELECT b.id, b.starts, b.ends, b.meeting_id, p.display_name FROM ops_booking b JOIN hr_employee e ON e.id = b.employee_id JOIN hr_person p ON p.id = e.person_id
      WHERE b.room_id = ? AND b.state = 'booked' AND substr(b.starts, 1, 10) = ? ORDER BY b.starts`, r.id, day),
  }));
}

// --------------------------------------------------------------- help desk --

const SLA_HOURS = { urgent: 4, high: 8, normal: 24, low: 72 };

export function openTicket({ category = 'it', priority = 'normal', title, requesterEmployeeId = null, body = null, actor }) {
  if (!actor) refuse('a ticket is opened by somebody');
  if (!clean(title)) refuse('a ticket says what is wrong');
  if (!SLA_HOURS[priority]) refuse('priority is low, normal, high or urgent');
  if (!['it', 'facilities', 'hr', 'finance', 'other'].includes(category)) refuse('category is it, facilities, hr, finance or other');
  const who = employeeOk(requesterEmployeeId);
  let docId = null;
  if (body) {
    // An HR ticket is about the person who raised it; the words are sealed under them.
    const person = category === 'hr' && who ? one('SELECT person_id FROM hr_employee WHERE id = ?', who)?.person_id : null;
    const doc = createDocument({ title: `Ticket — ${clean(title, 80)}`, classification: person ? 'restricted' : 'internal', subjectPersonId: person, body, actor });
    docId = doc.id;
  }
  const due = new Date(Date.now() + SLA_HOURS[priority] * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  exec(`INSERT INTO ops_ticket (ref, category, priority, title, requester_employee_id, sla_due, doc_id) VALUES (?,?,?,?,?,?,?)`,
    nextRef('ops_ticket', 'HD'), category, priority, clean(title, 200), who, due, docId);
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'ticket', entityId: id, action: 'ticket.opened', actor, detail: { category, priority } });
  emit('ticket.opened', { id, category, priority });
  return getTicket(id);
}

export function assignTicket(id, { assigneeEmployeeId, actor }) {
  if (!actor) refuse('assigning carries a name');
  const t = one('SELECT * FROM ops_ticket WHERE id = ?', Number(id));
  if (!t) refuse('no such ticket');
  exec("UPDATE ops_ticket SET assignee_employee_id = ?, state = CASE WHEN state = 'open' THEN 'in_progress' ELSE state END WHERE id = ?", employeeOk(assigneeEmployeeId), t.id);
  log({ entity: 'ticket', entityId: t.id, action: 'ticket.assigned', actor });
  return getTicket(t.id);
}

export function setTicketState(id, { state, actor }) {
  if (!actor) refuse('moving a ticket carries a name');
  const t = one('SELECT * FROM ops_ticket WHERE id = ?', Number(id));
  if (!t) refuse('no such ticket');
  if (!['open', 'in_progress', 'waiting', 'resolved', 'closed'].includes(state)) refuse('state is open, in_progress, waiting, resolved or closed');
  if (t.state === 'closed') refuse('a closed ticket stays closed — open a new one');
  exec(`UPDATE ops_ticket SET state = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END,
        closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END WHERE id = ?`, state, state, state, t.id);
  log({ entity: 'ticket', entityId: t.id, action: `ticket.${state}`, actor });
  return getTicket(t.id);
}

export const getTicket = (id) => one(`SELECT t.*, pr.display_name AS requester, pa.display_name AS assignee FROM ops_ticket t
  LEFT JOIN hr_employee er ON er.id = t.requester_employee_id LEFT JOIN hr_person pr ON pr.id = er.person_id
  LEFT JOIN hr_employee ea ON ea.id = t.assignee_employee_id LEFT JOIN hr_person pa ON pa.id = ea.person_id WHERE t.id = ?`, Number(id));

export const listTickets = ({ state = null, limit = 200 } = {}) => q(`SELECT t.*, pr.display_name AS requester, pa.display_name AS assignee FROM ops_ticket t
  LEFT JOIN hr_employee er ON er.id = t.requester_employee_id LEFT JOIN hr_person pr ON pr.id = er.person_id
  LEFT JOIN hr_employee ea ON ea.id = t.assignee_employee_id LEFT JOIN hr_person pa ON pa.id = ea.person_id
  WHERE (? IS NULL OR t.state = ?) ORDER BY t.state IN ('resolved','closed'), t.sla_due LIMIT ?`, state, state, Number(limit));

/** Past the SLA and still open: marked once, announced once. */
export function slaSweep() {
  const late = q("SELECT id, ref, priority FROM ops_ticket WHERE breached = 0 AND state NOT IN ('resolved','closed') AND sla_due < datetime('now')");
  for (const t of late) {
    exec('UPDATE ops_ticket SET breached = 1 WHERE id = ?', t.id);
    emit('ticket.breached', { id: t.id, ref: t.ref, priority: t.priority }, { idempotency: `sla-${t.id}` });
  }
  return { breached: late.length };
}

// --------------------------------------------------------------- incidents --

export function reportIncident({ kind = 'safety', severity = 3, title, occurredAt = null, action = null, body = null, actor }) {
  if (!actor) refuse('an incident is reported by somebody');
  if (!['safety', 'quality', 'security', 'environment'].includes(kind)) refuse('kind is safety, quality, security or environment');
  const sev = Math.round(Number(severity));
  if (!(sev >= 1 && sev <= 4)) refuse('severity is 1 to 4');
  if (!clean(title)) refuse('an incident has a title');
  const docId = body ? createDocument({ title: `Incident — ${clean(title, 80)}`, classification: 'confidential', body, actor }).id : null;
  exec(`INSERT INTO ops_incident (kind, severity, title, occurred_at, action, doc_id, reported_by) VALUES (?,?,?,?,?,?,?)`,
    kind, sev, clean(title, 200), occurredAt || new Date().toISOString().slice(0, 19).replace('T', ' '), action ? clean(action, 400) : null, docId, String(actor));
  const id = one('SELECT last_insert_rowid() AS id').id;
  log({ entity: 'ops_incident', entityId: id, action: 'incident.reported', actor, detail: { kind, severity: sev }, chain: sev <= 2 });
  emit('workplace.incident', { id, kind, severity: sev });
  return one('SELECT * FROM ops_incident WHERE id = ?', id);
}

export function setIncidentState(id, { state, action = null, actor }) {
  if (!actor) refuse('moving an incident carries a name');
  const i = one('SELECT * FROM ops_incident WHERE id = ?', Number(id));
  if (!i) refuse('no such incident');
  if (!['open', 'investigating', 'closed'].includes(state)) refuse('state is open, investigating or closed');
  if (state === 'closed' && !String(actor).startsWith('human:')) refuse('closing an incident is a human act');
  exec("UPDATE ops_incident SET state = ?, action = COALESCE(?, action), closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END WHERE id = ?",
    state, action ? clean(action, 400) : null, state, i.id);
  log({ entity: 'ops_incident', entityId: i.id, action: `incident.${state}`, actor, chain: state === 'closed' });
  return one('SELECT * FROM ops_incident WHERE id = ?', i.id);
}

export const listIncidents = () => q('SELECT * FROM ops_incident ORDER BY state = \'closed\', severity, id DESC LIMIT 100');

// ----------------------------------------------------------------- overview --

export function opsOverview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const levels = stockLevels();
  return {
    warehouses: q('SELECT * FROM ops_warehouse ORDER BY code'),
    items: levels,
    lowStock: levels.filter((r) => r.low).length,
    stockValue: round2(levels.reduce((a, r) => a + r.value, 0)),
    workOrders: listWorkOrders(),
    workOrdersOpen: n("SELECT COUNT(*) AS n FROM ops_workorder WHERE state IN ('open','in_progress')"),
    fleet: fleet(),
    rooms: roomAvailability(),
    tickets: listTickets(),
    ticketsOpen: n("SELECT COUNT(*) AS n FROM ops_ticket WHERE state NOT IN ('resolved','closed')"),
    ticketsBreached: n("SELECT COUNT(*) AS n FROM ops_ticket WHERE breached = 1 AND state NOT IN ('resolved','closed')"),
    incidents: listIncidents(),
    incidentsOpen: n("SELECT COUNT(*) AS n FROM ops_incident WHERE state != 'closed'"),
    note: 'A stock level is the sum of its moves and is never stored. A help-desk ticket has an SLA clock the sweep compares; '
      + 'an HR ticket\'s words are sealed under the person who raised it. Workplace incidents are kept apart from Core 1\'s '
      + 'technical incidents because a wet floor and a failed deploy should never share a graph.',
  };
}
