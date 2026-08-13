// Growth — moving a number on purpose, and knowing whether it moved.
//
// Different from Marketing operations, which runs the machine, and from
// Insights, which explains what happened. This department makes a claim in
// advance, changes one thing, and is willing to be wrong in public.
//
// Two rules do the work:
//
//   * A hypothesis is required *before* the result. Deciding what would count
//     as success after seeing the numbers is how every experiment succeeds.
//   * An experiment that concludes without a decision stays open. A winner
//     nobody shipped is a result, not an experiment, and a backlog of those is
//     how a growth team becomes a reporting team.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';

const clean = (s, n = 2000) => String(s ?? '').trim().slice(0, n);
const refuse = (m) => { const e = new Error(m); e.status = 400; throw e; };

export function start({
  name, hypothesis, metric, audience = null, baseline = null,
  variantA, variantB, productId = null, actor,
}) {
  if (!actor) refuse('an experiment has to name who started it');
  if (!name) refuse('an experiment needs a name');
  if (!hypothesis || clean(hypothesis).length < 15) {
    refuse('a hypothesis says what you expect and why — deciding that afterwards is not an experiment');
  }
  if (!metric) refuse('an experiment names the one number it is trying to move');
  if (!variantA || !variantB) refuse('two variants, or there is nothing to compare');
  exec(`INSERT INTO experiments (kind, name, hypothesis, metric, audience, baseline, variant_a, variant_b, product_id, created_by)
        VALUES ('growth',?,?,?,?,?,?,?,?,?)`,
  clean(name, 160), clean(hypothesis, 1000), clean(metric, 80), clean(audience, 200) || null,
  baseline === null || baseline === '' ? null : Number(baseline),
  clean(variantA, 2000), clean(variantB, 2000), clean(productId, 40) || null, actor);
  const e = one('SELECT * FROM experiments WHERE id = last_insert_rowid()');
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'growth.experiment_started', subjectType: 'experiment', subjectId: e.id,
    payload: { name: e.name, metric, audience, baseline },
  });
  return e;
}

export function record({ id, resultA, resultB, actor }) {
  if (!actor) refuse('a result has to be signed');
  const e = one("SELECT * FROM experiments WHERE id = ? AND kind = 'growth'", id);
  if (!e) refuse('no such growth experiment');
  const a = Number(resultA);
  const b = Number(resultB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) refuse('both results are numbers, or the comparison means nothing');
  const uplift = a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
  exec('UPDATE experiments SET result_a = ?, result_b = ?, uplift = ? WHERE id = ?', String(a), String(b), uplift, id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'growth.result_recorded', subjectType: 'experiment', subjectId: id,
    payload: { metric: e.metric, resultA: a, resultB: b, upliftPct: uplift },
  });
  return one('SELECT * FROM experiments WHERE id = ?', id);
}

/**
 * Conclude, and say what is being done about it.
 *
 * "Inconclusive" is a first-class answer and the most common honest one. What
 * is refused is concluding with no decision, because that is the state an
 * experiment sits in forever.
 */
export function conclude({ id, winner, decision, actor }) {
  if (!actor) refuse('a conclusion has to be signed');
  if (!['a', 'b', 'inconclusive'].includes(winner)) refuse("winner is 'a', 'b' or 'inconclusive'");
  if (!decision || clean(decision).length < 10) {
    refuse('an experiment ends with what happens next — ship it, drop it, or run it again bigger');
  }
  const e = one("SELECT * FROM experiments WHERE id = ? AND kind = 'growth'", id);
  if (!e) refuse('no such growth experiment');
  if (e.result_a === null || e.result_b === null) refuse('record both results before concluding');
  exec(`UPDATE experiments SET winner = ?, decision = ?, state = 'concluded', concluded_at = datetime('now') WHERE id = ?`,
    winner, clean(decision, 1000), id);
  audit({
    actorType: String(actor).startsWith('human:') ? 'human' : 'agent', actorId: actor,
    action: 'growth.experiment_concluded', subjectType: 'experiment', subjectId: id,
    payload: { name: e.name, metric: e.metric, winner, upliftPct: e.uplift, decision: clean(decision, 200) },
  });
  return one('SELECT * FROM experiments WHERE id = ?', id);
}

/** Running experiments with results already in and nobody deciding. */
export function awaitingDecision() {
  return q(`SELECT * FROM experiments WHERE kind = 'growth' AND state = 'running'
              AND result_a IS NOT NULL AND result_b IS NOT NULL ORDER BY id`);
}

export function overview() {
  const n = (sql, ...p) => one(sql, ...p).n;
  const shipped = q(`SELECT * FROM experiments WHERE kind = 'growth' AND state = 'concluded' AND winner <> 'inconclusive'`);
  return {
    experiments: q("SELECT * FROM experiments WHERE kind = 'growth' ORDER BY id DESC LIMIT 100"),
    running: n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND state = 'running'"),
    concluded: n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND state = 'concluded'"),
    inconclusive: n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND winner = 'inconclusive'"),
    awaitingDecision: awaitingDecision(),
    // The number that keeps a growth team honest: of everything concluded, how
    // much of it actually changed the product.
    winRate: shipped.length && n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND state = 'concluded'")
      ? Math.round((shipped.length / n("SELECT COUNT(*) AS n FROM experiments WHERE kind = 'growth' AND state = 'concluded'")) * 100)
      : 0,
    bestUplift: one("SELECT name, metric, uplift FROM experiments WHERE kind = 'growth' AND uplift IS NOT NULL ORDER BY uplift DESC LIMIT 1") || null,
    note: 'The Lab compares two prompts. This compares two things a customer sees. Same table, named apart.',
  };
}
