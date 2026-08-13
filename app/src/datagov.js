// Data governance — what a column *is*, as a governance fact.
//
// DATA is about finding things out. This is about what the company is allowed
// to keep, for how long, and who says so. They are different jobs and the
// second one is invisible until somebody asks for a data map, at which point
// the honest answer is usually "we would have to look".
//
// The inventory is discovered from the schema rather than hand-listed, for the
// same reason deep search discovers its tables: a list somebody maintains is
// out of date the week after the next feature. What is *not* discovered is the
// classification — that is a judgement, and it is recorded with a name against
// it.
//
// The point of the whole department is one cross-check: a column marked
// personal that the erasure walk cannot reach is a promise the company cannot
// keep. That comparison is run here, against the real walk, not against a
// description of it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { erasureOverview } from './erasure.js';

const clean = (s, n = 600) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const SENSITIVITIES = ['public', 'internal', 'confidential', 'personal', 'restricted'];

// Columns whose name is a strong signal. Used only to *propose* a
// classification for a person to confirm — never to decide one, because a
// regex that classifies personal data silently misclassifies it too.
const LOOKS_PERSONAL = /(^|_)(email|phone|mobile|whatsapp|address|contact|recipient|sender|caller|msisdn|from_number|to_number|transcript|recording|ip)(_|$)/i;
const LOOKS_SECRET = /(^|_)(pass|password|secret|token|key|wrapped_key|p256dh|auth|hash|ciphertext)(_|$)/i;

export const SEED_CLASSES = [
  ['public', 'public', 'Anybody may see it. Publishing it changes nothing.', 0],
  ['operational', 'internal', 'How the company runs. Dull to an outsider, useful to a competitor.', 0],
  ['commercial', 'confidential', 'Prices, terms, pipeline. Damaging in the open.', 0],
  ['personal', 'personal', 'About an identifiable person. Subject to erasure and access requests.', 730],
  ['credential', 'restricted', 'Opens a door. Never displayed, never exported, never logged.', 0],
];

export function seedClasses({ actor = 'system:datagov' } = {}) {
  let made = 0;
  for (const [name, sensitivity, definition, retain] of SEED_CLASSES) {
    if (one('SELECT id FROM data_classes WHERE name = ?', name)) continue;
    exec('INSERT INTO data_classes (name, sensitivity, definition, retain_days, owner) VALUES (?,?,?,?,?)',
      name, sensitivity, definition, retain, 'DPO');
    made++;
  }
  return { made, total: one('SELECT COUNT(*) AS n FROM data_classes').n };
}

export function classes() {
  return q('SELECT * FROM data_classes ORDER BY CASE sensitivity '
    + "WHEN 'restricted' THEN 0 WHEN 'personal' THEN 1 WHEN 'confidential' THEN 2 WHEN 'internal' THEN 3 ELSE 4 END, name");
}

export function defineClass({ name, sensitivity, definition, retainDays = 0, basis = null, owner, actor }) {
  if (!actor) refuse('a class has to name who defined it');
  if (!SENSITIVITIES.includes(sensitivity)) refuse(`sensitivity must be one of: ${SENSITIVITIES.join(', ')}`);
  if (!name || !definition) refuse('a class without a definition is a label');
  exec(`INSERT INTO data_classes (name, sensitivity, definition, retain_days, basis, owner)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET sensitivity=excluded.sensitivity, definition=excluded.definition,
          retain_days=excluded.retain_days, basis=excluded.basis, owner=excluded.owner`,
  clean(name, 40), sensitivity, clean(definition, 1000), Number(retainDays) || 0,
  clean(basis, 200) || null, clean(owner, 80));
  audit({
    actorType: 'human', actorId: actor, action: 'datagov.class_defined',
    subjectType: 'data_class', subjectId: clean(name, 40), payload: { sensitivity, retainDays },
  });
  return one('SELECT * FROM data_classes WHERE name = ?', clean(name, 40));
}

// ---------------------------------------------------------------- inventory --

/** Every column in the database, as the database reports it. */
function schemaColumns() {
  const out = [];
  for (const t of q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    let cols = [];
    try { cols = q(`PRAGMA table_info(${t.name})`); } catch { continue; }
    for (const c of cols) out.push({ table: t.name, column: c.name });
  }
  return out;
}

/**
 * Rebuild the inventory from the schema, keeping every classification a person
 * already made. New columns arrive unclassified, which is the correct state for
 * something nobody has looked at.
 */
export function rebuild({ actor = 'system:datagov' } = {}) {
  const erasure = erasureOverview();
  const reachable = new Set([...erasure.columnsCovered, ...(erasure.columnsCarried || [])]);

  let added = 0;
  let updated = 0;
  for (const { table, column } of schemaColumns()) {
    const key = `${table}.${column}`;
    const suggestedPersonal = LOOKS_PERSONAL.test(column) ? 1 : 0;
    const erasable = reachable.has(key) ? 1 : 0;
    const existing = one('SELECT * FROM data_inventory WHERE table_name = ? AND column_name = ?', table, column);
    if (existing) {
      if (existing.erasable !== erasable) {
        exec('UPDATE data_inventory SET erasable = ? WHERE id = ?', erasable, existing.id);
        updated++;
      }
      continue;
    }
    exec(`INSERT INTO data_inventory (table_name, column_name, class_name, personal, erasable, note)
          VALUES (?,?,?,?,?,?)`,
    table, column,
    LOOKS_SECRET.test(column) ? 'credential' : (suggestedPersonal ? 'personal' : null),
    suggestedPersonal, erasable,
    suggestedPersonal && !erasable ? 'proposed as personal by its name; the erasure walk does not reach it' : null);
    added++;
  }
  audit({
    actorType: 'system', actorId: actor, action: 'datagov.inventory_rebuilt',
    subjectType: 'data_inventory', subjectId: 'all',
    payload: { added, updated, columns: schemaColumns().length },
  });
  return { added, updated, ...coverage() };
}

/** A person confirms or corrects what the sweep proposed. */
export function classifyColumn({ table, column, className, personal, note = null, actor }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('classifying data is a judgement and carries a name');
  const row = one('SELECT * FROM data_inventory WHERE table_name = ? AND column_name = ?', table, column);
  if (!row) refuse('that column is not in the inventory — rebuild it first');
  exec(`UPDATE data_inventory SET class_name = ?, personal = ?, note = COALESCE(?, note),
          reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
  clean(className, 40) || null, personal ? 1 : 0, clean(note, 600) || null, actor, row.id);
  audit({
    actorType: 'human', actorId: actor, action: 'datagov.column_classified',
    subjectType: 'data_column', subjectId: `${table}.${column}`,
    payload: { className, personal: Boolean(personal) },
  });
  return one('SELECT * FROM data_inventory WHERE id = ?', row.id);
}

/**
 * The finding this department exists to produce.
 *
 * A column somebody classified as personal, which the erasure walk cannot
 * reach, means "a person can be forgotten" is untrue for whatever is in it.
 * There is no way to see that by reading either module on its own.
 */
export function unerasablePersonal() {
  return q(`SELECT table_name, column_name, class_name, reviewed_by, note
              FROM data_inventory WHERE personal = 1 AND erasable = 0
              ORDER BY table_name, column_name`);
}

export function coverage() {
  const n = (sql, ...p) => one(sql, ...p).n;
  return {
    columns: n('SELECT COUNT(*) AS n FROM data_inventory'),
    classified: n('SELECT COUNT(*) AS n FROM data_inventory WHERE class_name IS NOT NULL'),
    reviewed: n('SELECT COUNT(*) AS n FROM data_inventory WHERE reviewed_by IS NOT NULL'),
    personal: n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1'),
    erasable: n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1 AND erasable = 1'),
    gap: n('SELECT COUNT(*) AS n FROM data_inventory WHERE personal = 1 AND erasable = 0'),
  };
}

/** Rows past the retention their class allows — reported, never deleted here. */
export function retentionBreaches() {
  const out = [];
  for (const c of q('SELECT * FROM data_classes WHERE retain_days > 0')) {
    const tables = q('SELECT DISTINCT table_name FROM data_inventory WHERE class_name = ?', c.name);
    for (const t of tables) {
      let n = 0;
      try {
        n = one(`SELECT COUNT(*) AS n FROM ${t.table_name} WHERE created_at IS NOT NULL
                  AND date(created_at) < date('now', ?)`, `-${c.retain_days} days`).n;
      } catch { continue; }
      if (n) out.push({ table: t.table_name, class: c.name, retainDays: c.retain_days, older: n });
    }
  }
  return out;
}

export function overview() {
  return {
    classes: classes(),
    ...coverage(),
    unerasable: unerasablePersonal(),
    retention: retentionBreaches(),
    unreviewedPersonal: q(`SELECT table_name, column_name, note FROM data_inventory
                            WHERE personal = 1 AND reviewed_by IS NULL ORDER BY table_name LIMIT 100`),
    sensitivities: SENSITIVITIES,
    note: 'The inventory is discovered from the schema; the classification is not. A column proposed as personal by '
      + 'its name is a question for a person, and the answer is recorded with their name on it.',
  };
}
