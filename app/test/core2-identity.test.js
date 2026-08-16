// The identity spine, and the one rule it exists to make unbreakable.
//
// Core 1's constitution says no action may record a human approver who did not
// approve it. Core 2 extends that to the org chart: an AI employee must never
// appear in a reporting line, an employment record, or a person's row. The
// directive asks for that to be enforced "by constraint or trigger, not by
// convention", and asserted "the way the ledger tests assert an unbalanced entry
// is refused" — so every route an agent could take into a human slot is tried
// here, one at a time, and a real person is inserted as a control so that a
// blanket refusal cannot masquerade as a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-core2-identity.db';
// Its own master key: the rotation test rotates the shared file, and test files
// run concurrently. See test/sealing.test.js for the same reasoning.
process.env.ALPHACORE_MASTER_KEY = Buffer.alloc(48, 19).toString('base64');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data', 'test-core2-identity.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${DB}${suffix}`); } catch { /* first run */ }
}

const { one, q, exec, db } = await import('../src/db.js');
const { verifyChain } = await import('../src/audit.js');
const { seedAgents } = await import('../src/workflow.js');
const { TIER_A, tierAUnreachable, refFor, isSealed, eraseSubject, verifyErasure, findSubject } = await import('../src/erasure.js');
const {
  createPerson, getPerson, personDossier, linkUser, employ, getEmployee, listEmployees,
  reportingLine, orgChart, createOrgUnit, createPosition, createGrade, identityOverview, looksLikeAgent,
} = await import('../src/core2/identity.js');

seedAgents();
const AGENT = one('SELECT id, name FROM agents LIMIT 1');

/** Search the raw file the way somebody who stole the disk would. */
function diskContains(needle) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort */ }
  const hits = [];
  for (const suffix of ['', '-wal']) {
    const f = `${DB}${suffix}`;
    if (fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from(needle, 'utf8'))) hits.push(suffix || 'db');
  }
  return hits;
}

// --- a person can be any combination of the three ------------------------

test('a person can exist as candidate-only, employee-only, user-only, or all three', () => {
  // Candidate-only: a person with no employment and no login. This is the
  // combination most models cannot express, and the reason the person table is
  // the root rather than a column on the employee table.
  const candidate = createPerson({ displayName: 'Noor Abbas', personalEmail: 'noor@example.test', actor: 'human:test' });
  const d1 = personDossier(candidate.id);
  assert.equal(d1.employment.length, 0);
  assert.equal(d1.login, null);

  // Employee-only: employed, no way to log in. Every contractor, ever.
  const worker = createPerson({ displayName: 'Kareem Fadhil', personalEmail: 'kareem@example.test', actor: 'human:test' });
  employ({ personId: worker.id, employeeNo: 'E100', actor: 'human:test' });
  const d2 = personDossier(worker.id);
  assert.equal(d2.employment.length, 1);
  assert.equal(d2.login, null);

  // User-only: an administrator who is not an employee.
  const admin = createPerson({ displayName: 'Sara Jasim', personalEmail: 'sara@example.test', actor: 'human:test' });
  exec("INSERT INTO users (username, display_name, pass) VALUES ('sara', 'Sara Jasim', 'x')");
  linkUser(admin.id, one('SELECT id FROM users WHERE username = ?', 'sara').id, { actor: 'human:test' });
  const d3 = personDossier(admin.id);
  assert.equal(d3.employment.length, 0);
  assert.ok(d3.login);

  // All three.
  employ({ personId: admin.id, employeeNo: 'E101', actor: 'human:test' });
  const d4 = personDossier(admin.id);
  assert.equal(d4.employment.length, 1);
  assert.ok(d4.login);
});

// --- the agent bar --------------------------------------------------------

test('an agent cannot occupy a human slot, by any route', () => {
  const person = createPerson({ displayName: 'Hala Mahdi', personalEmail: 'hala@example.test', actor: 'human:test' });
  const emp = employ({ personId: person.id, employeeNo: 'E200', actor: 'human:test' });

  const routes = [
    ['an agent id as a reporting line', () => exec('UPDATE hr_employee SET manager_id = ? WHERE id = ?', AGENT.id, emp.id)],
    ['an agent id as the person employed', () => exec('INSERT INTO hr_employee (person_id, employee_no) VALUES (?,?)', AGENT.id, 'E999')],
    ['an agent id as a person', () => exec('INSERT INTO hr_person (display_name) VALUES (?)', AGENT.id)],
    ['an agent name as a person', () => exec('INSERT INTO hr_person (display_name) VALUES (?)', AGENT.name)],
    ['renaming a real person into an agent', () => exec('UPDATE hr_person SET display_name = ? WHERE id = ?', AGENT.name, person.id)],
    ['an agent-shaped id nobody registered', () => exec('INSERT INTO hr_person (display_name) VALUES (?)', 'AGT-XXX-999')],
  ];
  for (const [what, attempt] of routes) {
    assert.throws(attempt, undefined, `${what} was accepted`);
  }

  // The control. Without this, a table that refused everything would pass.
  assert.doesNotThrow(() => exec('INSERT INTO hr_person (display_name) VALUES (?)', 'Omar Kareem'));
  assert.ok(one('SELECT id FROM hr_person WHERE display_name = ?', 'Omar Kareem'));

  // And through the module, the refusal is a sentence rather than a constraint code.
  assert.throws(() => createPerson({ displayName: AGENT.id, actor: 'human:test' }), /agent cannot be recorded as a person/);
});

test('the bar is structural, not conventional', () => {
  // STRICT is what makes the integer columns refuse a TEXT agent id in every
  // code path, including ones written later by somebody who never read the
  // comment. If a table stops being STRICT, this test says so.
  for (const t of ['hr_person', 'hr_employee', 'hr_org_unit', 'hr_position', 'hr_grade', 'core2_log']) {
    const sql = one('SELECT sql FROM sqlite_master WHERE name = ?', t)?.sql || '';
    assert.match(sql, /STRICT/, `${t} is not STRICT, so an agent id can be stored in a person column`);
  }
  assert.equal(looksLikeAgent(AGENT.id), true);
  assert.equal(looksLikeAgent('Omar Kareem'), false);
});

// --- Tier A -------------------------------------------------------------

test('every Tier A column Core 2 introduces is reachable by erasure', () => {
  assert.deepEqual(tierAUnreachable(), []);
  const keys = TIER_A.map((c) => `${c.table}.${c.column}`);
  for (const k of [
    'hr_person.personal_email', 'hr_person.personal_phone', 'hr_person.national_id',
    'hr_person.emergency_contact', 'hr_employee.bank_account', 'hr_employee.base_salary',
  ]) {
    assert.ok(keys.includes(k), `${k} is not Tier A — it would be written in the clear`);
  }
});

test('a salary and a national id are not readable in the database file', () => {
  const NID = 'PLANTED-NID-7c21x national identity number';
  const SALARY = 'PLANTED-SALARY-4419';
  const p = createPerson({
    displayName: 'Zahra Naji', personalEmail: 'zahra.naji@example.test',
    nationalId: NID, emergencyContact: 'PLANTED-KIN-8830 next of kin', actor: 'human:test',
  });
  const e = employ({ personId: p.id, employeeNo: 'E300', baseSalary: SALARY, bankAccount: 'PLANTED-IBAN-5567', actor: 'human:test' });

  // Prove the search works before trusting what it does not find: the display
  // name is Tier B by design and must be findable in the raw bytes.
  assert.ok(diskContains('Zahra Naji').length, 'the control value must be findable, or this test proves nothing');

  for (const secret of [NID, SALARY, 'PLANTED-IBAN-5567', 'PLANTED-KIN-8830 next of kin']) {
    assert.deepEqual(diskContains(secret), [], `${secret.slice(0, 20)} is readable on the disk`);
  }

  // And the surface still answers, because that is the boundary the threat
  // model draws: the live process can read what it sealed; the disk cannot.
  assert.equal(getPerson(p.id).national_id, NID);
  assert.equal(getEmployee(e.id).base_salary, SALARY);
  assert.ok(isSealed(one('SELECT base_salary FROM hr_employee WHERE id = ?', e.id).base_salary));
});

test('erasing a person takes their salary with them, and the chain still verifies', () => {
  const email = 'to.erase@example.test';
  const p = createPerson({ displayName: 'Muhannad Saleh', personalEmail: email, nationalId: 'NID-ERASE-1', actor: 'human:test' });
  const e = employ({ personId: p.id, employeeNo: 'E400', baseSalary: '9999', actor: 'human:test' });

  // The employment row must be findable from the person's address alone —
  // that is what the carried reference is for.
  const found = findSubject({ kind: 'contact', identifier: email });
  assert.ok(found.records.some((r) => r.table === 'hr_employee'), 'erasure cannot reach the employment record');

  eraseSubject({ kind: 'contact', identifier: email, reason: 'test', actor: 'human:test' });

  assert.equal(getPerson(p.id).national_id, '[erased]');
  assert.equal(getEmployee(e.id).base_salary, '[erased]');
  const proof = verifyErasure({ kind: 'contact', identifier: email });
  assert.equal(proof.ok, true);
  assert.equal(proof.chainStillVerifies, true);
  assert.equal(verifyChain().ok, true);

  // What survives is that somebody was employed — the fact, not the terms.
  assert.equal(one('SELECT employee_no FROM hr_employee WHERE id = ?', e.id).employee_no, 'E400');
});

// --- the org chart --------------------------------------------------------

test('the org chart is a tree, and a cycle cannot hang it', () => {
  const unit = createOrgUnit({ name: 'Engineering', code: 'ENG', core1Section: 'systems', actor: 'human:test' });
  const grade = createGrade({ name: 'G5', rank: 5, bandMin: 3000, bandMax: 6000, actor: 'human:test' });
  createPosition({ title: 'Backend Developer', orgUnitId: unit.id, gradeId: grade.id, actor: 'human:test' });

  const boss = createPerson({ displayName: 'Rana Tariq', personalEmail: 'rana@example.test', actor: 'human:test' });
  const staff = createPerson({ displayName: 'Yusuf Amin', personalEmail: 'yusuf@example.test', actor: 'human:test' });
  const bossEmp = employ({ personId: boss.id, employeeNo: 'E500', orgUnitId: unit.id, actor: 'human:test' });
  const staffEmp = employ({ personId: staff.id, employeeNo: 'E501', orgUnitId: unit.id, managerId: bossEmp.id, actor: 'human:test' });

  const up = reportingLine(staffEmp.id);
  assert.equal(up.line.length, 2);
  assert.equal(up.cycle, false);

  // Somebody will eventually make two people each other's manager. An org chart
  // that hangs the server is worse than one that shows a wrong line.
  exec('UPDATE hr_employee SET manager_id = ? WHERE id = ?', staffEmp.id, bossEmp.id);
  const looped = reportingLine(staffEmp.id);
  assert.equal(looped.cycle, true);
  assert.ok(looped.line.length <= 3, 'the walk did not stop at the cycle');
  exec('UPDATE hr_employee SET manager_id = NULL WHERE id = ?', bossEmp.id);

  const chart = orgChart();
  assert.ok(chart.units.length >= 1);
  assert.ok(chart.employees >= 2);
});

test('a reporting line must point at somebody actually employed here', () => {
  const p = createPerson({ displayName: 'Dima Salim', personalEmail: 'dima@example.test', actor: 'human:test' });
  assert.throws(
    () => employ({ personId: p.id, employeeNo: 'E600', managerId: 999999, actor: 'human:test' }),
    /reporting line/,
  );
});

test('recording a person is an act that carries a name', () => {
  assert.throws(() => createPerson({ displayName: 'Nobody' }), /carries a name/);
  assert.throws(() => employ({ personId: 1, employeeNo: 'E700' }), /carries a name/);
});

test('the overview describes what is actually there', () => {
  const o = identityOverview();
  assert.ok(o.people >= 5);
  assert.ok(o.employees >= 1);
  assert.ok(o.withLogin >= 1);
  assert.match(o.note, /STRICT/);
});
