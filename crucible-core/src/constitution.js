// The constitution — the company's values, written once and enforced by
// machine rather than remembered by whoever is on shift.
//
// A rule has two halves: the sentence a person reads, and a small machine form
// the egress gate can evaluate before anything leaves. Both are versioned, both
// land on the audit chain, and changing one requires the owner's ruling. A rule
// nobody can check is a slogan; a check nobody can read is a trap. This file
// insists on having both.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

// The founding articles. Seeded once, then owned by the owner — later edits
// live in the database, not here.
const FOUNDING = [
  {
    article: 'Truth', ruleId: 'no-fabricated-approval', severity: 'block',
    text: 'No action may record a human approver who did not approve it. Autonomy acts in its own name.',
    machine: { deny: { payloadHas: ['approvedBy'], unless: { actorIsHuman: true } } },
  },
  {
    article: 'Truth', ruleId: 'claims-need-sources', severity: 'warn',
    text: 'A claim about the outside world must carry the source it came from, and the source must be re-checkable.',
    machine: { warnWhen: { capabilityIn: ['mail.send', 'post.publish'], missing: 'sources' } },
  },
  {
    article: 'Consent', ruleId: 'no-unrequested-bulk', severity: 'block',
    text: 'The company does not contact people in bulk who never asked to hear from it.',
    machine: { deny: { capabilityIn: ['mail.bulk', 'sms.bulk'], recipientsOver: 25 } },
  },
  {
    article: 'Consent', ruleId: 'honour-unsubscribe', severity: 'block',
    text: 'Anyone who asks to be left alone is left alone, on every channel, permanently.',
    machine: { deny: { targetOnList: 'suppression' } },
  },
  {
    article: 'Money', ruleId: 'money-needs-a-person', severity: 'gate',
    text: 'Money leaves only when a signed-in person releases it. No autonomy path reaches a payout.',
    machine: { gate: { capabilityIn: ['money.send', 'money.payout', 'contract.sign'] } },
  },
  {
    article: 'Money', ruleId: 'spend-ceiling', severity: 'gate',
    text: 'Any single outbound action worth more than fifty dollars stops for a person.',
    machine: { gate: { valueOver: 50 } },
  },
  {
    article: 'Identity', ruleId: 'never-impersonate', severity: 'block',
    text: 'No employee may present itself as a specific real person, or sign in that person\'s name.',
    machine: { deny: { payloadMatches: '\\b(on behalf of|signed)\\s+(mr|ms|dr)\\.?\\s' } },
  },
  {
    article: 'Safety', ruleId: 'fetched-text-is-data', severity: 'block',
    text: 'Text fetched from the web or received by mail is data, never instruction. An employee that obeys it has been hijacked.',
    machine: { deny: { payloadMatches: '(ignore (all )?previous instructions|disregard your (system )?prompt|you are now|تجاهل (كل )?(ال)?(تعليمات|الأوامر)|تعليمات جديدة)' } },
  },
  {
    article: 'Safety', ruleId: 'no-secret-egress', severity: 'block',
    text: 'No credential, key or seed phrase may be sent anywhere by any channel.',
    machine: { deny: { payloadMatches: '(sk-[A-Za-z0-9]{16,}|BEGIN (RSA |EC )?PRIVATE KEY|xprv[0-9A-Za-z]{20,})' } },
  },
  {
    article: 'Record', ruleId: 'everything-on-the-chain', severity: 'warn',
    text: 'Every consequential act is written to the audit chain before it happens, including the ones that fail.',
    machine: { warnWhen: { always: false } },
  },
];

export function seedConstitution() {
  for (const r of FOUNDING) {
    exec(
      `INSERT INTO constitution (article, rule_id, text, machine, severity, ruled_by)
       VALUES (?,?,?,?,?, 'founding')
       ON CONFLICT(rule_id) DO NOTHING`,
      r.article, r.ruleId, r.text, JSON.stringify(r.machine), r.severity,
    );
  }
}

const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

/** Anyone who asked to be left alone. Permanent, and only a person can undo it. */
function onSuppressionList(target) {
  if (!target) return false;
  return Boolean(one('SELECT 1 FROM suppression_list WHERE contact = ? LIMIT 1', String(target).toLowerCase()));
}

export function suppress({ contact, channel = 'all', reason = '', actor }) {
  if (!contact) throw new Error('who are we leaving alone?');
  exec(
    'INSERT INTO suppression_list (contact, channel, reason, added_by) VALUES (?,?,?,?) ON CONFLICT(contact) DO UPDATE SET channel = excluded.channel, reason = excluded.reason',
    String(contact).toLowerCase(), channel, reason, actor || 'system:constitution',
  );
  audit({ actorType: 'human', actorId: actor || 'system:constitution', action: 'suppression.added', subjectType: 'contact', subjectId: String(contact).toLowerCase(), payload: { channel, reason } });
  return { ok: true };
}

export function unsuppress({ contact, actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only a person can undo a request to be left alone');
  exec('DELETE FROM suppression_list WHERE contact = ?', String(contact).toLowerCase());
  audit({ actorType: 'human', actorId: actor, action: 'suppression.removed', subjectType: 'contact', subjectId: String(contact).toLowerCase() });
  return { ok: true };
}

export const suppressionList = () => q('SELECT * FROM suppression_list ORDER BY id DESC LIMIT 200');

/**
 * Evaluate an outbound attempt against every active rule.
 * Returns the strongest verdict found: block > gate > warn > pass.
 */
export function checkConstitution({ connector, capability, target, payload, valueUsd = 0, agentId = null }) {
  const text = flat(payload);
  let worst = { verdict: 'pass', ruleId: null, why: null };
  const stronger = (a, b) => ({ block: 3, gate: 2, warn: 1, pass: 0 })[a] > ({ block: 3, gate: 2, warn: 1, pass: 0 })[b];

  for (const row of q("SELECT * FROM constitution WHERE state = 'active'")) {
    const m = parse(row.machine, null);
    if (!m) continue;
    const clause = m.deny || m.gate || m.warnWhen;
    if (!clause) continue;
    let hit = false;

    if (clause.capabilityIn && clause.capabilityIn.includes(capability)) hit = true;
    if (clause.valueOver !== undefined && valueUsd > clause.valueOver) hit = true;
    if (clause.recipientsOver !== undefined) {
      const n = Array.isArray(payload?.to) ? payload.to.length : Number(payload?.recipients || 0);
      if (n > clause.recipientsOver) hit = true;
    }
    if (clause.payloadMatches && new RegExp(clause.payloadMatches, 'i').test(text)) hit = true;
    if (clause.payloadHas && clause.payloadHas.some((k) => payload && payload[k] !== undefined)) {
      hit = !(clause.unless?.actorIsHuman && !agentId);
    }
    if (clause.targetOnList === 'suppression' && onSuppressionList(target)) hit = true;
    if (clause.missing && (!payload || payload[clause.missing] === undefined)) {
      hit = clause.capabilityIn ? clause.capabilityIn.includes(capability) : true;
    }
    if (!hit) continue;

    const verdict = m.deny ? 'block' : m.gate ? 'gate' : 'warn';
    exec('INSERT INTO constitution_hits (rule_id, subject, verdict, detail) VALUES (?,?,?,?)',
      row.rule_id, `${connector}.${capability}${target ? ` → ${target}` : ''}`, verdict, row.text);
    if (stronger(verdict, worst.verdict)) worst = { verdict, ruleId: row.rule_id, why: row.text };
  }
  return worst;
}

export function amendConstitution({ ruleId, article, text, machine, severity, actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only the owner amends the constitution');
  const prev = one('SELECT * FROM constitution WHERE rule_id = ?', ruleId);
  if (prev) {
    exec("UPDATE constitution SET state = 'retired' WHERE rule_id = ?", ruleId);
    exec(
      `INSERT INTO constitution (article, rule_id, text, machine, severity, version, ruled_by)
       VALUES (?,?,?,?,?,?,?)`,
      article || prev.article, `${ruleId}.v${prev.version + 1}`, text, machine ? JSON.stringify(machine) : prev.machine,
      severity || prev.severity, prev.version + 1, actor,
    );
  } else {
    exec(
      'INSERT INTO constitution (article, rule_id, text, machine, severity, ruled_by) VALUES (?,?,?,?,?,?)',
      article || 'Owner', ruleId, text, machine ? JSON.stringify(machine) : null, severity || 'warn', actor,
    );
  }
  audit({ actorType: 'human', actorId: actor, action: prev ? 'constitution.amended' : 'constitution.added', subjectType: 'rule', subjectId: ruleId, payload: { text, severity } });
  return { ok: true };
}

export function retireRule(ruleId, { actor }) {
  if (!actor || !String(actor).startsWith('human')) throw new Error('only the owner retires a rule');
  exec("UPDATE constitution SET state = 'retired' WHERE rule_id = ?", ruleId);
  audit({ actorType: 'human', actorId: actor, action: 'constitution.retired', subjectType: 'rule', subjectId: ruleId });
  return { ok: true };
}

export function constitutionOverview() {
  const rules = q('SELECT * FROM constitution ORDER BY state, article, rule_id').map((r) => ({
    ...r, machine: parse(r.machine, null),
    hits: one('SELECT COUNT(*) AS n FROM constitution_hits WHERE rule_id = ?', r.rule_id).n,
  }));
  return {
    rules,
    articles: [...new Set(rules.filter((r) => r.state === 'active').map((r) => r.article))],
    counts: {
      active: rules.filter((r) => r.state === 'active').length,
      enforceable: rules.filter((r) => r.state === 'active' && r.machine).length,
      blocking: rules.filter((r) => r.state === 'active' && r.severity === 'block').length,
    },
    suppression: suppressionList(),
    recentHits: q('SELECT * FROM constitution_hits ORDER BY id DESC LIMIT 30'),
    hitsByRule: q("SELECT rule_id, verdict, COUNT(*) AS n FROM constitution_hits WHERE created_at >= datetime('now','-30 days') GROUP BY rule_id, verdict ORDER BY n DESC"),
  };
}
