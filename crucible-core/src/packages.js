// Department packages — a department as something you can install.
//
// The ninety-five departments in this company were each written by hand: a
// table or two, an employee, a permission, a place on the map, a rule that
// wires it to its neighbours. Written down, that shape is a manifest, and a
// manifest is installable. That is the difference between an application with
// a lot of features and a platform other people can extend.
//
// Installing is deliberately narrow. A package may create its own tables, hire
// its own employees, declare its own permissions and draw itself on the map. It
// may not run arbitrary code, touch another department's tables, or grant
// itself an existing permission — the three things that would turn "install a
// department" into "hand over the company".
import { q, one, exec, db } from './db.js';
import { audit } from './audit.js';
import { PERMS } from './auth.js';

const IDENT = /^[a-z][a-z0-9_]{1,40}$/;
const COLUMN_TYPES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB']);

/**
 * Read a manifest and say exactly what is wrong with it, if anything. Called
 * before install and offered on its own, because "why was this rejected" should
 * not require attempting the install.
 */
export function validateManifest(m) {
  const problems = [];
  const need = (cond, why) => { if (!cond) problems.push(why); };

  need(m && typeof m === 'object', 'the manifest must be an object');
  if (!m || typeof m !== 'object') return { ok: false, problems };

  need(IDENT.test(String(m.id || '')), 'id must be lower-case letters, digits and underscores');
  need(m.name, 'name is required');
  need(/^\d+\.\d+\.\d+$/.test(String(m.version || '')), 'version must look like 1.0.0');
  need(m.section && IDENT.test(String(m.section.id || '')), 'section.id is required and must be an identifier');
  need(m.section?.label, 'section.label is required — it is what appears on the map');
  need(m.section?.division, 'section.division is required — every department belongs to a district');

  // Tables must be namespaced to the package, so an install can never redefine
  // `customers` or `audit_log`.
  for (const t of m.tables || []) {
    need(IDENT.test(String(t.name || '')), `table name "${t.name}" is not an identifier`);
    need(String(t.name || '').startsWith(`${m.id}_`), `table "${t.name}" must start with "${m.id}_" — a package owns only its own tables`);
    need(Array.isArray(t.columns) && t.columns.length, `table "${t.name}" needs columns`);
    for (const c of t.columns || []) {
      need(IDENT.test(String(c.name || '')), `column "${c.name}" in "${t.name}" is not an identifier`);
      need(COLUMN_TYPES.has(String(c.type || '').toUpperCase()), `column "${c.name}" has type "${c.type}" — use TEXT, INTEGER, REAL or BLOB`);
    }
  }

  // Permissions must be new and namespaced: a package cannot quietly award
  // itself `users.manage` or `treasury.pay`.
  for (const p of m.permissions || []) {
    need(String(p).startsWith(`${m.section?.id}.`), `permission "${p}" must start with "${m.section?.id}."`);
    need(!PERMS.includes(p), `permission "${p}" already exists — a package may not claim an existing power`);
  }

  for (const a of m.agents || []) {
    need(/^AGT-[A-Z0-9-]{2,20}$/.test(String(a.id || '')), `employee id "${a.id}" must look like AGT-XYZ-001`);
    need(a.name && a.roleGroup, `employee "${a.id}" needs a name and a role group`);
  }

  for (const e of m.edges || []) {
    need(e.to && e.label, 'every relationship needs a target and a label');
  }

  return { ok: problems.length === 0, problems };
}

/** Register a package without installing it. */
export function addPackage({ manifest, actor }) {
  const v = validateManifest(manifest);
  if (!v.ok) throw new Error(`this manifest cannot be installed: ${v.problems.join('; ')}`);
  exec(
    `INSERT INTO packages (id, name, version, author, description, manifest, state)
     VALUES (?,?,?,?,?,?, 'available')
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version,
       author = excluded.author, description = excluded.description, manifest = excluded.manifest`,
    manifest.id, manifest.name, manifest.version, manifest.author || null,
    manifest.description || null, JSON.stringify(manifest),
  );
  audit({ actorType: 'human', actorId: actor, action: 'package.added', subjectType: 'package', subjectId: manifest.id, payload: { version: manifest.version } });
  return getPackage(manifest.id);
}

/**
 * Install: create the tables, hire the employees, and mark it live. Everything
 * happens in one transaction, so a package that fails halfway leaves nothing
 * behind.
 */
export function installPackage(id, { actor }) {
  const p = one('SELECT * FROM packages WHERE id = ?', id);
  if (!p) throw new Error('no such package');
  if (p.state === 'installed') throw new Error('that package is already installed');
  const m = JSON.parse(p.manifest);
  const v = validateManifest(m);
  if (!v.ok) throw new Error(`refusing to install: ${v.problems.join('; ')}`);

  db.exec('BEGIN');
  try {
    for (const t of m.tables || []) {
      const cols = t.columns.map((c) => `${c.name} ${c.type.toUpperCase()}${c.notNull ? ' NOT NULL' : ''}${c.default !== undefined ? ` DEFAULT ${typeof c.default === 'string' ? `'${c.default.replace(/'/g, "''")}'` : c.default}` : ''}`);
      db.exec(`CREATE TABLE IF NOT EXISTS ${t.name} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${cols.join(', ')}, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    }
    for (const a of m.agents || []) {
      // Re-installing has to bring the employee back. Uninstalling retires
      // rather than deletes, so DO NOTHING here left a package installed with
      // a retired workforce — installed, and unable to do anything.
      db.prepare(
        `INSERT INTO agents (id, name, role_group, spec, model_tier, status, human_owner, departments)
         VALUES (?,?,?,?,?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = 'active', name = excluded.name,
           role_group = excluded.role_group, spec = excluded.spec, departments = excluded.departments`,
      ).run(
        a.id, a.name, a.roleGroup,
        JSON.stringify({ role: a.name, tier: a.tier || 'T2', brief: a.brief || '', fromPackage: m.id }),
        a.tier || 'T2', actor, m.section.id,
      );
    }
    db.prepare("UPDATE packages SET state = 'installed', installed_at = datetime('now'), installed_by = ?, last_error = NULL WHERE id = ?").run(actor, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    exec("UPDATE packages SET state = 'failed', last_error = ? WHERE id = ?", String(err.message).slice(0, 400), id);
    throw new Error(`install failed and was rolled back: ${err.message}`);
  }

  audit({
    actorType: 'human', actorId: actor, action: 'package.installed',
    subjectType: 'package', subjectId: id,
    payload: { version: m.version, tables: (m.tables || []).length, agents: (m.agents || []).length, section: m.section.id },
  });
  return getPackage(id);
}

/**
 * Uninstall retires the employees and takes the department off the map, and
 * leaves the tables alone. Dropping somebody's data because they removed a
 * feature is the kind of helpfulness nobody asks for twice.
 */
export function uninstallPackage(id, { actor, dropData = false }) {
  const p = one('SELECT * FROM packages WHERE id = ?', id);
  if (!p) throw new Error('no such package');
  const m = JSON.parse(p.manifest);
  for (const a of m.agents || []) exec("UPDATE agents SET status = 'retired' WHERE id = ?", a.id);
  if (dropData) {
    if (!String(actor).startsWith('human')) throw new Error('only a person can delete a package\'s data');
    for (const t of m.tables || []) { try { db.exec(`DROP TABLE IF EXISTS ${t.name}`); } catch { /* keep going */ } }
  }
  exec("UPDATE packages SET state = 'removed' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'package.uninstalled', subjectType: 'package', subjectId: id, payload: { dropData } });
  return { ok: true, dataKept: !dropData };
}

/** What installed packages contribute to the map and the permission catalogue. */
export function installedSections() {
  return q("SELECT manifest FROM packages WHERE state = 'installed'").map((r) => {
    const m = JSON.parse(r.manifest);
    return {
      id: m.section.id, label: m.section.label, division: m.section.division,
      href: `#/pkg/${m.id}`, hint: m.section.hint || m.description || '',
      table: m.tables?.[0]?.name || null,
      edges: (m.edges || []).map((e) => ({ from: m.section.id, to: e.to, label: e.label, kind: e.kind || 'flow' })),
      permissions: m.permissions || [],
      packageId: m.id,
    };
  });
}

export function getPackage(id) {
  const p = one('SELECT * FROM packages WHERE id = ?', id);
  if (!p) return null;
  const m = JSON.parse(p.manifest);
  const rows = {};
  for (const t of m.tables || []) {
    try { rows[t.name] = one(`SELECT COUNT(*) AS n FROM ${t.name}`).n; } catch { rows[t.name] = null; }
  }
  return { ...p, manifest: m, rows };
}

/**
 * A worked example, shipped so the format is learned by reading rather than by
 * guessing. It is a real department: legal-hold requests on customer records.
 */
export const EXAMPLE_MANIFEST = {
  id: 'legalhold',
  name: 'Legal hold',
  version: '1.0.0',
  author: 'Crucible',
  description: 'Freeze a customer record against deletion while a dispute or investigation is open, and say who froze it and why.',
  section: { id: 'legalhold', label: 'Legal hold', division: 'operate', hint: 'Records frozen against deletion while a matter is open' },
  permissions: ['legalhold.view', 'legalhold.manage'],
  tables: [{
    name: 'legalhold_matters',
    columns: [
      { name: 'subject_type', type: 'TEXT', notNull: true },
      { name: 'subject_id', type: 'TEXT', notNull: true },
      { name: 'reason', type: 'TEXT', notNull: true },
      { name: 'state', type: 'TEXT', notNull: true, default: 'open' },
      { name: 'placed_by', type: 'TEXT', notNull: true },
      { name: 'released_at', type: 'TEXT' },
    ],
  }],
  agents: [{ id: 'AGT-HOLD-001', name: 'Legal hold clerk', roleGroup: 'assure', tier: 'T1', brief: 'Track what is frozen, why, and when it may be released.' }],
  edges: [
    { to: 'legal', label: 'holds arise from open matters', kind: 'flow' },
    { to: 'customers', label: 'the records a hold protects', kind: 'flow' },
    { to: 'compliance', label: 'a hold is an auditable control', kind: 'audit' },
  ],
};

export function packagesOverview() {
  const rows = q('SELECT id, name, version, author, description, state, installed_at, installed_by, last_error FROM packages ORDER BY state, name');
  return {
    packages: rows,
    counts: {
      installed: rows.filter((r) => r.state === 'installed').length,
      available: rows.filter((r) => r.state === 'available').length,
      failed: rows.filter((r) => r.state === 'failed').length,
    },
    sections: installedSections(),
    example: EXAMPLE_MANIFEST,
    rules: [
      'Tables must be prefixed with the package id — a package owns only its own data.',
      'Permissions must be new and namespaced — a package cannot claim an existing power.',
      'No code is executed: a manifest declares tables, employees, relationships and a place on the map.',
      'Install runs in one transaction; a failure leaves nothing behind.',
      'Uninstall retires the employees and keeps the data unless a person explicitly asks otherwise.',
    ],
  };
}

export function seedPackages() {
  if (one('SELECT id FROM packages WHERE id = ?', EXAMPLE_MANIFEST.id)) return;
  exec(
    `INSERT INTO packages (id, name, version, author, description, manifest, state)
     VALUES (?,?,?,?,?,?, 'available')`,
    EXAMPLE_MANIFEST.id, EXAMPLE_MANIFEST.name, EXAMPLE_MANIFEST.version,
    EXAMPLE_MANIFEST.author, EXAMPLE_MANIFEST.description, JSON.stringify(EXAMPLE_MANIFEST),
  );
}
