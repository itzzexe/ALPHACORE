// Custody — العهد.
//
// Core 1 already has an asset register: what the company owns, what it renews,
// what it costs. That answers *what do we have*. It cannot answer the question
// that actually comes up — **who is holding it right now** — and that is the one
// somebody asks on the day an employee leaves, on the day a laptop is stolen,
// and on the day an auditor wants to know who had access to the signing key.
//
// So this is custody, not a second asset list. The asset stays in Core 1's
// table, one master as §2 requires; what lives here is the handover: issued to
// whom, when, in what condition, and what came back.
//
// Three things it refuses, each learned from how these registers go wrong:
//
//   - **an item cannot be in two hands.** Issuing something already out is
//     refused, naming who has it. A register where two people both hold the
//     same laptop is a register nobody trusts again.
//   - **a return is signed by somebody other than the holder.** Otherwise
//     "I gave it back" and the record saying so are the same act.
//   - **an employee cannot be marked as having left while still holding
//     things.** Not a warning after the fact: the list is the offboarding.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { notify } from '../notify.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

export const CONDITIONS = ['new', 'good', 'worn', 'damaged'];

/**
 * Hand something over.
 *
 * `assetId` points at Core 1's register when the thing is already on it. An
 * item that is not — a set of keys, an access card — is recorded by
 * description, because refusing to track it until somebody adds it to the asset
 * register means it does not get tracked at all.
 */
export function issue({
  employeeId, assetId = null, description = null,
  serial = null, condition = 'good', note = null, actor,
}) {
  if (!actor) refuse('a handover has to be signed');
  const emp = one(
    'SELECT e.id, e.state, p.display_name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ?',
    employeeId,
  );
  if (!emp) refuse('no such employee');
  if (emp.state !== 'active') refuse(`${emp.display_name} is ${emp.state} — issue nothing to somebody who has left`);
  if (!assetId && !description?.trim()) refuse('say which asset, or describe the thing');
  if (assetId && !one('SELECT id FROM assets WHERE id = ?', assetId)) refuse('no such asset in the register');
  if (!CONDITIONS.includes(condition)) refuse(`condition is one of: ${CONDITIONS.join(', ')}`);

  // One thing, one pair of hands.
  if (assetId) {
    const held = one(
      `SELECT c.*, p.display_name FROM cust_item c
         JOIN hr_employee e ON e.id = c.employee_id JOIN hr_person p ON p.id = e.person_id
        WHERE c.asset_id = ? AND c.returned_at IS NULL`, assetId,
    );
    if (held) refuse(`that asset is already with ${held.display_name} since ${String(held.issued_at).slice(0, 10)}`);
  }

  const id = Number(exec(
    `INSERT INTO cust_item (employee_id, asset_id, description, serial, condition_out, note, issued_by)
     VALUES (?,?,?,?,?,?,?)`,
    employeeId, assetId, description?.trim() || null, serial, condition, note, actor,
  ).lastInsertRowid);

  audit({
    actorType: 'human', actorId: actor, action: 'custody.issued',
    subjectType: 'employee', subjectId: String(employeeId),
    payload: { id, assetId, description: description?.slice(0, 120) || null, serial, condition },
  });
  return { ok: true, id };
}

/** Take it back. Signed by whoever received it, not by whoever held it. */
export function takeBack(id, { condition = 'good', note = null, actor }) {
  if (!actor) refuse('a return has to be signed');
  const item = one('SELECT * FROM cust_item WHERE id = ?', id);
  if (!item) { const e = new Error('no such handover'); e.status = 404; throw e; }
  if (item.returned_at) refuse('that was already returned');
  if (!CONDITIONS.includes(condition)) refuse(`condition is one of: ${CONDITIONS.join(', ')}`);

  // The holder confirming their own return is the same act as saying it, which
  // is not a record of anything.
  // The login hangs off users.person_id — a person may have no account at all,
  // which is the ordinary case for somebody who does not use the console.
  const holder = one(
    `SELECT u.username FROM hr_employee e JOIN users u ON u.person_id = e.person_id WHERE e.id = ?`,
    item.employee_id,
  );
  if (holder?.username && actor === `human:${holder.username}`) {
    refuse('somebody other than the holder has to sign the item back in');
  }

  exec(
    "UPDATE cust_item SET returned_at = datetime('now'), returned_to = ?, condition_in = ?, return_note = ? WHERE id = ?",
    actor, condition, note, id,
  );
  audit({
    actorType: 'human', actorId: actor, action: 'custody.returned',
    subjectType: 'employee', subjectId: String(item.employee_id),
    payload: { id, condition, wasIssued: item.condition_out, note },
  });
  // A thing that went out good and came back damaged is a fact somebody should
  // see at the time, not at the next stock count.
  if (condition === 'damaged' && item.condition_out !== 'damaged') {
    notify({
      level: 'warn', source: 'custody', subjectType: 'custody', subjectId: String(id),
      message: `An item came back damaged that was issued ${item.condition_out}`,
    });
  }
  return { ok: true, id };
}

/** What one person is holding. The offboarding list, and the leaving check. */
export function heldBy(employeeId) {
  return q(
    `SELECT c.*, a.name AS asset_name, a.kind AS asset_kind
       FROM cust_item c LEFT JOIN assets a ON a.id = c.asset_id
      WHERE c.employee_id = ? AND c.returned_at IS NULL ORDER BY c.issued_at`,
    employeeId,
  );
}

/**
 * May this person be marked as having left?
 *
 * Called by the leaving path. Answers with the list rather than a boolean,
 * because "no" is not something anybody can act on and "these four things" is.
 */
export function clearedToLeave(employeeId) {
  const held = heldBy(employeeId);
  if (!held.length) return { cleared: true };
  return {
    cleared: false,
    holding: held.map((h) => ({ id: h.id, what: h.asset_name || h.description, serial: h.serial, since: h.issued_at })),
    say: `Still holding ${held.length} item(s). Take them back, or record them as written off, before recording the leaving — `
      + 'an offboarding that closes over open custody is how a company finds out about its laptops a year later.',
  };
}

export function custodyOverview() {
  const out = q(
    `SELECT c.*, p.display_name, a.name AS asset_name, a.kind AS asset_kind
       FROM cust_item c
       JOIN hr_employee e ON e.id = c.employee_id JOIN hr_person p ON p.id = e.person_id
       LEFT JOIN assets a ON a.id = c.asset_id
      WHERE c.returned_at IS NULL ORDER BY c.issued_at`,
  );
  return {
    out: out.length,
    items: out,
    returned: one('SELECT COUNT(*) AS n FROM cust_item WHERE returned_at IS NOT NULL').n,
    damaged: one("SELECT COUNT(*) AS n FROM cust_item WHERE condition_in = 'damaged'").n,
    conditions: CONDITIONS,
    // The one that matters on any given Friday: somebody has left and still has
    // the company's things.
    withLeavers: q(
      `SELECT p.display_name, e.id AS employee_id, e.state, COUNT(*) AS items
         FROM cust_item c JOIN hr_employee e ON e.id = c.employee_id JOIN hr_person p ON p.id = e.person_id
        WHERE c.returned_at IS NULL AND e.state != 'active'
        GROUP BY e.id ORDER BY items DESC`,
    ),
    byKind: q(
      `SELECT COALESCE(a.kind, 'unlisted') AS kind, COUNT(*) AS n
         FROM cust_item c LEFT JOIN assets a ON a.id = c.asset_id
        WHERE c.returned_at IS NULL GROUP BY kind ORDER BY n DESC`,
    ),
    says: 'The asset register says what the company owns. This says who is holding it. '
      + 'An item cannot be in two hands, a return is signed by somebody other than the holder, '
      + 'and nobody is recorded as having left while still holding things.',
  };
}
