// The money desk — what the company actually has, and what it may do with it.
//
// Finance reports what was spent. FinOps explains why it was spent. This desk
// answers the only question that decides whether the company survives: how
// long does the cash last, and is it being allocated the way we said it would
// be? It reads the live ledger — crypto received, model spend, vendor burn,
// purchase commitments — and holds the allocation policy against it.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const n = (sql, ...p) => one(sql, ...p)?.n || 0;
const r2 = (x) => Number(Number(x || 0).toFixed(2));

export function policy() {
  return one('SELECT * FROM money_policy ORDER BY id DESC LIMIT 1')
    || { reserve_pct: 40, opex_pct: 35, growth_pct: 25, min_runway_mo: 6, set_by: 'default', note: 'the starting policy until someone sets one' };
}

export function setPolicy({ reserve, opex, growth, minRunway, note = null, actor }) {
  const [rs, op, gr] = [Number(reserve), Number(opex), Number(growth)];
  if ([rs, op, gr].some((x) => !(x >= 0))) throw new Error('percentages must be zero or more');
  if (Math.round(rs + op + gr) !== 100) throw new Error(`the three buckets must add up to 100 — they add up to ${Math.round(rs + op + gr)}`);
  exec('INSERT INTO money_policy (reserve_pct, opex_pct, growth_pct, min_runway_mo, note, set_by) VALUES (?,?,?,?,?,?)',
    rs, op, gr, Number(minRunway) || 6, note, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'money.policy_set', subjectType: 'moneyPolicy', subjectId: id, payload: { reserve: rs, opex: op, growth: gr, minRunway } });
  return id;
}

export function recordMove({ kind, bucket = null, amount, asset = 'USD', reason, actor }) {
  if (!['allocation', 'transfer', 'writeoff', 'note'].includes(kind)) throw new Error('kind: allocation|transfer|writeoff|note');
  if (!reason?.trim()) throw new Error('a money move needs a stated reason');
  exec('INSERT INTO money_moves (kind, bucket, amount, asset, reason, decided_by) VALUES (?,?,?,?,?,?)',
    kind, bucket, Number(amount) || 0, asset, reason.trim(), actor);
  const id = lastId();
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'money.moved', subjectType: 'moneyMove', subjectId: id, payload: { kind, bucket, amount, asset } });
  return id;
}

/**
 * The position. Crypto is counted at face value in its own asset rather than
 * converted, because a made-up exchange rate is worse than an honest split.
 */
export function moneyDesk() {
  const p = policy();
  // In
  const crypto = q(`SELECT asset, ROUND(SUM(paid_amount), 8) AS total, COUNT(*) AS invoices
                    FROM invoices WHERE state = 'paid' GROUP BY asset`);
  const mrr = n("SELECT COALESCE(SUM(mrr_usd),0) AS n FROM customers WHERE state = 'active'");
  const pipeline = n("SELECT COALESCE(SUM(value_usd),0) AS n FROM deals WHERE stage NOT IN ('won','lost')");
  // Out — the three real cost lines this company has.
  const modelMonth = n("SELECT COALESCE(SUM(cost_usd),0) AS n FROM model_calls WHERE created_at >= datetime('now','start of month')");
  const model30 = n("SELECT COALESCE(SUM(cost_usd),0) AS n FROM model_calls WHERE created_at >= datetime('now','-30 days')");
  const vendorMonth = n("SELECT COALESCE(SUM(monthly_usd),0) AS n FROM vendors WHERE state = 'active'");
  const committed = n("SELECT COALESCE(SUM(amount_usd),0) AS n FROM purchase_requests WHERE state IN ('approved','ordered')");
  const payoutsPending = n("SELECT COALESCE(SUM(amount),0) AS n FROM payouts WHERE state IN ('prepared','approved')");

  const burnMonthly = r2(model30 + vendorMonth);
  const cashUsd = r2(mrr); // recurring revenue is the only cash line denominated in USD
  const runway = burnMonthly > 0 ? Number((cashUsd / burnMonthly).toFixed(1)) : null;

  const buckets = [
    { id: 'reserve', pct: p.reserve_pct, target: r2(cashUsd * p.reserve_pct / 100), why: 'the months of survival the company promised itself' },
    { id: 'opex', pct: p.opex_pct, target: r2(cashUsd * p.opex_pct / 100), why: 'models, vendors, the running of the place' },
    { id: 'growth', pct: p.growth_pct, target: r2(cashUsd * p.growth_pct / 100), why: 'anything that buys future revenue' },
  ].map((b) => ({
    ...b,
    allocated: r2(n("SELECT COALESCE(SUM(amount),0) AS n FROM money_moves WHERE bucket = ? AND kind = 'allocation'", b.id)),
  }));

  // Where the policy and reality disagree.
  const alerts = [];
  if (runway !== null && runway < p.min_runway_mo) {
    alerts.push({ level: 'crit', text: `Runway is ${runway} months against a floor of ${p.min_runway_mo}. Either revenue rises or the burn comes down.` });
  }
  if (burnMonthly > 0 && cashUsd === 0) {
    alerts.push({ level: 'crit', text: 'The company is spending and taking in nothing recurring. Every month here is pure loss.' });
  }
  if (committed > cashUsd) {
    alerts.push({ level: 'warn', text: `Approved purchases ($${committed}) exceed recurring revenue ($${cashUsd}).` });
  }
  if (payoutsPending > 0) {
    alerts.push({ level: 'warn', text: `${payoutsPending} in payouts is prepared and waiting for a signature.` });
  }
  const opexShare = cashUsd > 0 ? r2(burnMonthly / cashUsd * 100) : null;
  if (opexShare !== null && opexShare > p.opex_pct) {
    alerts.push({ level: 'warn', text: `Operating cost is ${opexShare}% of revenue against a policy of ${p.opex_pct}%.` });
  }
  if (!alerts.length) alerts.push({ level: 'info', text: 'Position is inside policy on every line checked.' });

  return {
    policy: p,
    position: {
      recurringUsd: cashUsd,
      pipelineUsd: r2(pipeline),
      cryptoReceived: crypto,
      burnMonthlyUsd: burnMonthly,
      modelMonthUsd: r2(modelMonth),
      vendorMonthlyUsd: r2(vendorMonth),
      committedUsd: r2(committed),
      payoutsPending: r2(payoutsPending),
      runwayMonths: runway,
    },
    buckets,
    alerts,
    moves: q('SELECT * FROM money_moves ORDER BY id DESC LIMIT 30'),
    history: q(`SELECT substr(created_at,1,10) AS day, ROUND(SUM(cost_usd),4) AS spend
                FROM model_calls GROUP BY day ORDER BY day DESC LIMIT 14`).reverse(),
  };
}

/** Runway breaching its floor is not a dashboard number; it is an alarm. */
export function moneyWatch() {
  const d = moneyDesk();
  for (const a of d.alerts.filter((x) => x.level === 'crit')) {
    notify({ level: 'crit', source: 'money', message: a.text, subjectType: 'money', subjectId: 'runway' });
  }
  return d.alerts.length;
}
