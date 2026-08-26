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
import { erasureOverview, TIER_A, isTierA, tierAUnreachable } from './erasure.js';

const clean = (s, n = 600) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const SENSITIVITIES = ['public', 'internal', 'confidential', 'personal', 'restricted'];

// Columns whose name is a strong signal. Used only to *propose* a
// classification for a person to confirm — never to decide one, because a
// regex that classifies personal data silently misclassifies it too.
const LOOKS_PERSONAL = /(^|_)(email|phone|mobile|whatsapp|address|contact|recipient|sender|caller|msisdn|from_number|to_number|transcript|recording|ip)(_|$)/i;

/**
 * A person's name is personal data, and this system said otherwise for a while.
 *
 * The pattern above deliberately omitted names, and the reasoning was sound as
 * far as it went: `products.name`, `assets.name` and `agents.name` are not
 * people, and there are 101 name-shaped columns in this schema. Calling them all
 * personal would produce a hundred false positives, and an inventory nobody
 * believes is an inventory nobody reads.
 *
 * But the omission left the opposite error in place — a review put it plainly,
 * that "the customer's name is not an identifier" is not true in general. A name
 * on its own identifies somebody often enough that every serious data-protection
 * regime treats it as personal.
 *
 * The way out is not a longer hand-maintained list. Eighteen tables already
 * carry `subject_ref`, the one-way reference erasure joins on — which is the
 * schema saying, in its own words, *this table is about people*. So a name-shaped
 * column is personal **when the table it sits in is about a person**, and that
 * is read from the schema rather than decided by somebody's judgement about
 * which tables count.
 */
const LOOKS_LIKE_A_NAME = /(^|_)(name|full_name|display_name|first|last|surname|customer)(_|$)/i;
const IS_A_REFERENCE = /(^|_)id$/i;

const PERSON_TABLES = () => {
  const out = new Set();
  for (const { table, column } of schemaColumns()) if (column === 'subject_ref') out.add(table);
  return out;
};
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
  const personTables = PERSON_TABLES();
  const erasure = erasureOverview();
  const reachable = new Set([...erasure.columnsCovered, ...(erasure.columnsCarried || [])]);

  let added = 0;
  let updated = 0;
  for (const { table, column } of schemaColumns()) {
    const key = `${table}.${column}`;
    const suggestedPersonal = (LOOKS_PERSONAL.test(column)
      // A name only counts on a table the schema says is about a person, and a
      // foreign key is a pointer rather than the name itself.
      || (personTables.has(table) && LOOKS_LIKE_A_NAME.test(column) && !IS_A_REFERENCE.test(column))) ? 1 : 0;
    const erasable = reachable.has(key) ? 1 : 0;
    // The tier is not a proposal the way `personal` is. It is read from the
    // list the sealing code itself uses, so the inventory cannot claim a column
    // is sealed at write while the write path leaves it in plaintext — the two
    // are the same fact read twice, not two facts kept in step by hand.
    const sealed = isTierA(table, column) ? 1 : 0;
    const existing = one('SELECT * FROM data_inventory WHERE table_name = ? AND column_name = ?', table, column);
    if (existing) {
      if (existing.erasable !== erasable || existing.sealed_at_write !== sealed) {
        exec('UPDATE data_inventory SET erasable = ?, sealed_at_write = ?, tier = ? WHERE id = ?',
          erasable, sealed, sealed ? 'A' : existing.tier, existing.id);
        updated++;
      }
      continue;
    }
    exec(`INSERT INTO data_inventory (table_name, column_name, class_name, personal, erasable, note, tier, sealed_at_write)
          VALUES (?,?,?,?,?,?,?,?)`,
    table, column,
    LOOKS_SECRET.test(column) ? 'credential' : (suggestedPersonal ? 'personal' : null),
    suggestedPersonal || sealed, erasable,
    suggestedPersonal && !erasable ? 'proposed as personal by its name; the erasure walk does not reach it' : null,
    sealed ? 'A' : null, sealed);
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

/**
 * The tiering, as a governance record with a name against it.
 *
 * The tier itself is derived — see rebuild() — so this does not decide
 * anything. What it does is put a person's name and a date beside a decision
 * that was previously only visible by reading two source files, and record the
 * act on the chain. A classification nobody signed is a comment.
 */
export function recordTiering({ actor, basis = 'encryption-at-write, phase 3' }) {
  if (!actor || !String(actor).startsWith('human:')) refuse('tiering is a judgement and carries a name');
  rebuild({ actor: 'system:datagov' });

  const gap = tierAUnreachable();
  // Failure-closed: signing a tiering that contains a column nobody can erase
  // would be signing the opposite of the promise.
  if (gap.length) refuse(`these Tier A columns are not reachable by erasure: ${gap.join(', ')}`);

  let signed = 0;
  for (const { table, column } of TIER_A) {
    const row = one('SELECT id FROM data_inventory WHERE table_name = ? AND column_name = ?', table, column);
    if (!row) continue;
    exec(`UPDATE data_inventory SET tier = 'A', sealed_at_write = 1, personal = 1, class_name = 'personal',
            reviewed_by = ?, reviewed_at = datetime('now'), note = ? WHERE id = ?`,
    actor, `Tier A: sealed at write under the person's own key (${basis})`, row.id);
    signed++;
  }
  audit({
    actorType: 'human', actorId: actor, action: 'datagov.tiering_recorded',
    subjectType: 'data_inventory', subjectId: 'tier-a',
    payload: { columns: signed, basis, unreachable: gap.length },
  });
  return { signed, tierA: TIER_A.length, unreachable: gap, ...coverage() };
}

/** Tier A, as the inventory has it, with what is sealed and what is reachable. */
export function tiering() {
  return {
    tierA: q(`SELECT table_name, column_name, tier, sealed_at_write, erasable, reviewed_by, reviewed_at
                FROM data_inventory WHERE tier = 'A' ORDER BY table_name, column_name`),
    declared: TIER_A.map((c) => `${c.table}.${c.column}`),
    unreachable: tierAUnreachable(),
    note: 'Tier A is sealed at write under the subject\'s own key; Tier B is plaintext by design because the company '
      + 'has to match on it, and its protection is disk encryption plus a master key from outside the disk. The split '
      + 'and what it does not protect against are set out in docs/THREAT-MODEL-PII.md.',
  };
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
    sealedAtWrite: n('SELECT COUNT(*) AS n FROM data_inventory WHERE sealed_at_write = 1'),
    // The number that must always be zero: a column sealed at write that the
    // erasure walk cannot reach is data nobody can delete.
    sealedButUnerasable: n('SELECT COUNT(*) AS n FROM data_inventory WHERE sealed_at_write = 1 AND erasable = 0'),
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
    tiering: tiering(),
    retention: retentionBreaches(),
    unreviewedPersonal: q(`SELECT table_name, column_name, note FROM data_inventory
                            WHERE personal = 1 AND reviewed_by IS NULL ORDER BY table_name LIMIT 100`),
    sensitivities: SENSITIVITIES,
    note: 'The inventory is discovered from the schema; the classification is not. A column proposed as personal by '
      + 'its name is a question for a person, and the answer is recorded with their name on it.',
  };
}
