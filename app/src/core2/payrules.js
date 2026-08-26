// Payroll rules — الضرائب والاستقطاعات ونهاية الخدمة.
//
// The pay slip has carried `taxes = 0; contributions = 0` since Phase 3, with an
// honest comment saying jurisdiction-specific. That was the right call at the
// time and it is the wrong thing to ship: a slip that prints a tax line of zero
// looks computed, and somebody will eventually pay against it.
//
// The fix is not to guess a jurisdiction. It is to let a company state its own
// rules and then apply them exactly, so the number on the slip is either
// **computed from a rule somebody wrote down**, or **absent and labelled as
// absent**. There is no third state where a zero means "we did not get to it".
//
// Two shapes cover almost every payroll on earth:
//
//   flat        a percentage of a base, optionally capped   — most social
//               insurance, most pension contributions
//   progressive bands, each taxing only the slice inside it — almost every
//               income tax
//
// Both are declared as data with a stated basis, and both are applied to a base
// the rule names: gross, or basic, or taxable-after-deductions. Getting that
// base wrong is the most common payroll error there is, so it is a field rather
// than an assumption.
//
// End of service is here too, for the same reason: it is a formula every
// employment law states differently and every company owes eventually.
import { q, one, exec } from '../db.js';
import { audit } from '../audit.js';
import { getSetting } from '../settings.js';

const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const BASES = ['gross', 'basic', 'taxable'];
export const KINDS = ['tax', 'contribution'];
export const PAID_BY = ['employee', 'employer'];

/**
 * Declare a rule.
 *
 * `basis` is required for the same reason it is required on a retention class:
 * a deduction nobody can cite is one the employee is entitled to dispute and
 * the company cannot defend.
 */
export function setRule({
  code, label, kind = 'tax', base = 'gross', paidBy = 'employee',
  percent = null, bands = null, capAmount = null, floorAmount = null,
  basis, active = true, actor,
}) {
  if (!actor) refuse('a payroll rule has to be signed');
  if (!code?.trim() || !label?.trim()) refuse('a rule needs a code and a name');
  if (!KINDS.includes(kind)) refuse(`a rule is one of: ${KINDS.join(', ')}`);
  if (!BASES.includes(base)) refuse(`a rule applies to one of: ${BASES.join(', ')}`);
  if (!PAID_BY.includes(paidBy)) refuse(`somebody pays it: ${PAID_BY.join(' or ')}`);
  if (!basis?.trim()) refuse('say what says so — a deduction nobody can cite is one nobody can defend');

  const flat = percent !== null && percent !== undefined;
  if (flat === Boolean(bands)) refuse('a rule is either a flat percentage or a set of bands, not both and not neither');

  if (flat) {
    if (!Number.isFinite(Number(percent)) || Number(percent) < 0 || Number(percent) > 100) refuse('a percentage is 0 to 100');
  } else {
    if (!Array.isArray(bands) || !bands.length) refuse('bands is a list');
    let last = -1;
    for (const [i, b] of bands.entries()) {
      if (!Number.isFinite(Number(b.upTo)) && b.upTo !== null) refuse(`band ${i + 1} needs an upper limit, or null for the top one`);
      if (!Number.isFinite(Number(b.percent))) refuse(`band ${i + 1} needs a percentage`);
      const up = b.upTo === null ? Infinity : Number(b.upTo);
      // Bands that overlap or leave a gap are the classic way a payroll is
      // quietly wrong in the middle of the range and right at both ends.
      if (up <= last) refuse(`band ${i + 1} does not start where the one before it ended`);
      last = up;
    }
    if (bands[bands.length - 1].upTo !== null) refuse('the top band has no upper limit — write null');
  }

  const existed = one('SELECT code FROM pay_rule WHERE code = ?', code);
  exec(
    `INSERT INTO pay_rule (code, label, kind, base, paid_by, percent, bands, cap_amount, floor_amount, basis, active, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label, kind = excluded.kind, base = excluded.base,
       paid_by = excluded.paid_by, percent = excluded.percent, bands = excluded.bands,
       cap_amount = excluded.cap_amount, floor_amount = excluded.floor_amount,
       basis = excluded.basis, active = excluded.active`,
    code.trim(), label.trim(), kind, base, paidBy,
    flat ? Number(percent) : null, flat ? null : JSON.stringify(bands),
    capAmount ?? null, floorAmount ?? null, basis.trim(), active ? 1 : 0, actor,
  );
  audit({
    actorType: 'human', actorId: actor, action: existed ? 'payrule.changed' : 'payrule.added',
    subjectType: 'payrule', subjectId: code,
    payload: { label, kind, base, paidBy, percent, bands: bands ? bands.length : null, basis: basis.slice(0, 160) },
  });
  return { ok: true, code };
}

export const rules = ({ activeOnly = true } = {}) => q(
  `SELECT * FROM pay_rule ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY kind, code`,
).map((r) => ({ ...r, bands: (() => { try { return JSON.parse(r.bands || 'null'); } catch { return null; } })() }));

/** One rule against one base. Progressive means each band taxes only its slice. */
function applyRule(rule, amount) {
  let taxable = Math.max(0, Number(amount) || 0);
  if (rule.floor_amount && taxable < Number(rule.floor_amount)) return 0;
  if (rule.cap_amount) taxable = Math.min(taxable, Number(rule.cap_amount));

  if (rule.percent !== null && rule.percent !== undefined) return round2((taxable * Number(rule.percent)) / 100);

  let owed = 0;
  let floor = 0;
  for (const b of rule.bands || []) {
    const ceiling = b.upTo === null ? Infinity : Number(b.upTo);
    // Only the slice inside this band. Taxing the whole amount at the band's
    // rate is the single most common progressive-tax bug, and it always
    // overcharges the person who just crossed a threshold.
    const slice = Math.max(0, Math.min(taxable, ceiling) - floor);
    owed += (slice * Number(b.percent)) / 100;
    floor = ceiling;
    if (taxable <= ceiling) break;
  }
  return round2(owed);
}

/**
 * What a slip owes, itemised.
 *
 * Returns the lines rather than a total, because a slip that shows one
 * "deductions" figure is a slip somebody will ask you to break down, and by
 * then the run is closed.
 */
export function computeDeductions({ gross, basic, deductions = 0 }) {
  const live = rules({});
  if (!live.length) {
    // The honest empty state. Not zeros — an absence, labelled.
    return {
      configured: false,
      lines: [],
      employeeTotal: null,
      employerTotal: null,
      says: 'No payroll rules have been declared, so tax and contributions are not computed. '
        + 'They are shown as unknown rather than as zero: a slip printing a tax line of zero looks computed, '
        + 'and somebody eventually pays against it.',
    };
  }
  const taxable = round2(Number(gross) - Number(deductions || 0));
  const baseOf = { gross: Number(gross) || 0, basic: Number(basic) || 0, taxable };

  const lines = live.map((r) => ({
    code: r.code,
    label: r.label,
    kind: r.kind,
    paidBy: r.paid_by,
    base: r.base,
    on: round2(baseOf[r.base]),
    amount: applyRule(r, baseOf[r.base]),
    basis: r.basis,
  }));

  return {
    configured: true,
    lines,
    // Split by who actually pays: an employer contribution is a company cost,
    // never a deduction from the person, and adding them together is how a slip
    // ends up understating somebody's net pay.
    employeeTotal: round2(lines.filter((l) => l.paidBy === 'employee').reduce((n, l) => n + l.amount, 0)),
    employerTotal: round2(lines.filter((l) => l.paidBy === 'employer').reduce((n, l) => n + l.amount, 0)),
  };
}

/**
 * Whole and part calendar years between two dates.
 *
 * The anniversary is a date, not an average of one.
 */
function completedYears(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let whole = ty - fy;
  const beforeAnniversary = tm < fm || (tm === fm && td < fd);
  if (beforeAnniversary) whole -= 1;
  // The remainder, measured against the length of the year it falls in, so a
  // leap year is not silently a day longer than the rule intended.
  const lastAnniversary = Date.UTC(fy + whole, fm - 1, fd);
  const nextAnniversary = Date.UTC(fy + whole + 1, fm - 1, fd);
  const part = (Date.UTC(ty, tm - 1, td) - lastAnniversary) / (nextAnniversary - lastAnniversary);
  return whole + part;
}

// ------------------------------------------------------------ end of service --

/**
 * What is owed when somebody leaves.
 *
 * The formula differs by jurisdiction and often by reason for leaving, so it is
 * declared as settings rather than assumed — days of pay per year for the first
 * N years, days per year after that, and whether resigning reduces it.
 *
 * Returns `configured: false` when nothing has been set, for the same reason as
 * above: a gratuity of zero and a gratuity nobody configured look identical on
 * a screen and are opposite in a tribunal.
 */
export function endOfService({ employeeId, lastDay = null, reason = 'resigned' }) {
  const e = one(
    `SELECT e.*, p.display_name FROM hr_employee e JOIN hr_person p ON p.id = e.person_id WHERE e.id = ?`, employeeId,
  );
  if (!e) { const err = new Error('no such employee'); err.status = 404; throw err; }

  const perYearFirst = Number(getSetting('EOS_DAYS_PER_YEAR_FIRST') || 0);
  const perYearAfter = Number(getSetting('EOS_DAYS_PER_YEAR_AFTER') || 0);
  const threshold = Number(getSetting('EOS_THRESHOLD_YEARS') || 5);
  const resignFactor = Number(getSetting('EOS_RESIGN_FACTOR') ?? 1);

  const start = String(e.hired_at || e.created_at).slice(0, 10);
  const end = lastDay || new Date().toISOString().slice(0, 10);
  // Counted in calendar years, not by dividing days by 365.25. Somebody hired
  // on 5 January has their seventh anniversary on 5 January, and every
  // employment law is written in those terms — an average puts 7.0011 years on
  // a slip and invites an argument about the decimal.
  const years = Math.max(0, completedYears(start, end));

  if (!perYearFirst && !perYearAfter) {
    return {
      employeeId, name: e.display_name, years: round2(years), configured: false,
      says: 'End-of-service pay is not configured. Set EOS_DAYS_PER_YEAR_FIRST, EOS_DAYS_PER_YEAR_AFTER and '
        + 'EOS_THRESHOLD_YEARS to the rule in force where this company employs people. It is shown as '
        + 'unconfigured rather than as zero, because those two look identical on a screen and are opposite '
        + 'in front of a tribunal.',
    };
  }

  const first = Math.min(years, threshold);
  const after = Math.max(0, years - threshold);
  const days = first * perYearFirst + after * perYearAfter;
  const factor = reason === 'resigned' ? resignFactor : 1;

  // The salary is sealed, so this deliberately does not compute the money here:
  // opening it belongs to payops, which already holds the key handling. What is
  // returned is the *entitlement in days*, which is the part the rule decides.
  return {
    employeeId,
    name: e.display_name,
    from: start,
    to: end,
    years: round2(years),
    configured: true,
    reason,
    days: round2(days * factor),
    workingFrom: { perYearFirst, perYearAfter, threshold, resignFactor: factor },
    says: `${round2(days * factor)} days of pay, from ${round2(years)} years of service`
      + `${factor !== 1 ? ` reduced to ${factor * 100}% because the reason recorded is resignation` : ''}.`,
  };
}

export function payRulesOverview() {
  const live = rules({});
  const all = rules({ activeOnly: false });
  return {
    rules: all,
    active: live.length,
    configured: live.length > 0,
    bases: BASES,
    kinds: KINDS,
    paidBy: PAID_BY,
    endOfService: {
      configured: Boolean(Number(getSetting('EOS_DAYS_PER_YEAR_FIRST') || 0) || Number(getSetting('EOS_DAYS_PER_YEAR_AFTER') || 0)),
      perYearFirst: Number(getSetting('EOS_DAYS_PER_YEAR_FIRST') || 0),
      perYearAfter: Number(getSetting('EOS_DAYS_PER_YEAR_AFTER') || 0),
      thresholdYears: Number(getSetting('EOS_THRESHOLD_YEARS') || 5),
      resignFactor: Number(getSetting('EOS_RESIGN_FACTOR') ?? 1),
    },
    // A worked example, so the bands can be checked by somebody who does not
    // read code. Run against the declared rules on a round number.
    example: live.length ? computeDeductions({ gross: 5000, basic: 4000, deductions: 0 }) : null,
    says: live.length
      ? 'Every line on a slip comes from a rule declared here, with the authority for it stated beside the number.'
      : 'Nothing is declared, so tax and contributions are reported as unknown rather than as zero.',
  };
}
