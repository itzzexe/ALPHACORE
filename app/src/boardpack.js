// THE BOARD PACK — the month on a few pages, built from the record.
//
// Every figure in it already exists somewhere in the company: the books, the
// bank, the governance map, the risk register, the operations numbers. What
// did not exist was one place that read them together on the first of the
// month and froze the result, so a board reads what was true then rather than
// whatever a page shows when they open it.
//
// Two numbers are worked out rather than read: how many months the cash lasts
// at the recent burn, and how many it lasts if revenue falls by a fifth. They
// are arithmetic, never a model's guess, and the method is printed beside them.
// The executive employee may draft the covering summary; a person issues the
// pack, which makes it an official document with a code.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { incomeStatement } from './ledger.js';
import { cashPosition } from './core2/bank.js';
import { heatmap } from './assurance.js';
import { requestDraft, draftsFor } from './drafts.js';

const refuse = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
const isHuman = (a) => String(a || '').startsWith('human:');
const n = (sql, ...a) => { try { return one(sql, ...a)?.n ?? 0; } catch { return 0; } };
const round = (x) => Math.round(Number(x || 0) * 100) / 100;

/** The month before the given one, as YYYY-MM. */
export function previousPeriod(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
const back = (period, k) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7); };

/**
 * Months of cash: cash over the average monthly burn of the last three months.
 * No burn — the company earns more than it spends — is no runway figure at all,
 * rather than infinity printed as a number.
 */
export function runway(cash, months) {
  const burn = months.reduce((a, m) => a + (m.totalExpenses - m.totalRevenue), 0) / Math.max(1, months.length);
  const revenue = months.reduce((a, m) => a + m.totalRevenue, 0) / Math.max(1, months.length);
  const at = (b) => (b > 0 ? round(cash / b) : null);
  return { burn: round(burn), revenue: round(revenue), months: at(burn), monthsIfRevenueFalls20: at(burn + 0.2 * revenue),
    method: 'cash ÷ average monthly (expenses − revenue) over the last three months; the stress case adds a fifth of average revenue to the burn' };
}

export function snapshot(period) {
  const months = [0, 1, 2].map((k) => incomeStatement({ period: back(period, k) }));
  let cash = { total: 0, accounts: [] };
  try { cash = cashPosition(); } catch { /* no bank accounts registered yet */ }
  const now = months[0];
  return {
    period,
    builtAt: new Date().toISOString(),
    finance: {
      revenue: now.totalRevenue, expenses: now.totalExpenses, net: now.net, margin: now.margin,
      trend: months.map((m) => ({ period: m.period, revenue: m.totalRevenue, expenses: m.totalExpenses, net: m.net })).reverse(),
      cash: round(cash.total), accounts: (cash.accounts || []).length,
      receivablesOpen: round(n("SELECT COALESCE(SUM(amount + tax - paid_amount), 0) AS n FROM fin_ar_invoice WHERE state = 'issued'")),
      receivablesOverdue: round(n("SELECT COALESCE(SUM(amount + tax - paid_amount), 0) AS n FROM fin_ar_invoice WHERE state = 'issued' AND due < date('now')")),
      payablesNext30: round(n("SELECT COALESCE(SUM(amount + tax), 0) AS n FROM fin_ap_bill WHERE state = 'approved' AND due <= date('now','+30 days')")),
      runway: runway(cash.total || 0, months),
    },
    governance: heatmap().map((t) => ({ id: t.id, label: t.label, status: t.status })),
    risks: q("SELECT title, likelihood, impact, likelihood * impact AS score, owner, COALESCE(mitigation, '') AS mitigation FROM risks WHERE state = 'open' ORDER BY likelihood * impact DESC LIMIT 5"),
    overdue: {
      auditActions: n("SELECT COUNT(*) AS n FROM ia_findings WHERE state NOT IN ('implemented','verified') AND due < date('now')"),
      nonconformities: n("SELECT COUNT(*) AS n FROM iso_ncrs WHERE state <> 'closed'"),
      policiesPastReview: n("SELECT COUNT(*) AS n FROM pol_docs WHERE state = 'published' AND next_review < date('now')"),
      lateProcessSteps: n("SELECT COUNT(*) AS n FROM proc_steps WHERE state = 'active' AND due_at < datetime('now')"),
      amlAlerts: n("SELECT COUNT(*) AS n FROM aml_alerts WHERE state IN ('open','investigating')"),
    },
    operations: q("SELECT i.title, i.severity FROM ops_issues i WHERE i.state = 'open' ORDER BY CASE i.severity WHEN 'high' THEN 0 ELSE 1 END, i.id DESC LIMIT 8"),
    minutedMeetings: n("SELECT COUNT(*) AS n FROM rec_meetings WHERE state = 'minuted' AND substr(held_on, 1, 7) = ?", period),
  };
}

/** Build (or rebuild, while it is still a draft) the pack for a month. */
export function build({ period = previousPeriod(), actor }) {
  if (!/^\d{4}-\d{2}$/.test(String(period))) refuse('a month, as YYYY-MM');
  const existing = one('SELECT * FROM board_packs WHERE period = ?', period);
  if (existing?.state === 'issued') refuse('that month’s pack is issued — it is a record now, not a draft');
  const snap = snapshot(period);
  if (existing) exec('UPDATE board_packs SET snapshot = ?, created_by = ?, created_at = datetime(\'now\') WHERE id = ?', JSON.stringify(snap), String(actor), existing.id);
  else exec('INSERT INTO board_packs (period, snapshot, created_by) VALUES (?,?,?)', period, JSON.stringify(snap), String(actor));
  const pack = one('SELECT * FROM board_packs WHERE period = ?', period);
  audit({ actorType: isHuman(actor) ? 'human' : 'system', actorId: String(actor), action: 'boardpack.built', subjectType: 'board_pack', subjectId: pack.id, payload: { period } });
  return getPack(pack.id);
}

/** The covering summary, drafted from the figures — never the other way round. */
export function draftSummary({ id, actor }) {
  const p = getPack(id);
  const s = p.snapshot;
  const job = requestDraft({
    dept: 'boardpack', subjectType: 'board_pack', subjectId: p.id, kind: 'board-summary', agentId: 'AGT-EXE-001', actor,
    brief: `The covering note of the board pack for ${s.period}. Use only these figures, and say plainly what needs the board's attention: ${JSON.stringify({ finance: s.finance, governance: s.governance, risks: s.risks, overdue: s.overdue, operations: s.operations })}`,
  });
  exec('UPDATE board_packs SET draft_id = ? WHERE id = ?', job.id, p.id);
  return getPack(p.id);
}

/** The first of the month: last month's pack, built as a draft for a person to read and issue. */
export function monthlyTick(now = new Date()) {
  if (now.getUTCDate() !== 1 || now.getUTCHours() < 6) return null;
  const period = previousPeriod(now);
  if (one('SELECT id FROM board_packs WHERE period = ?', period)) return null;
  return build({ period, actor: 'system:boardpack' });
}

export function markIssued(id, code) {
  exec("UPDATE board_packs SET state = 'issued', issued_code = ? WHERE id = ?", code, Number(id));
}

export function getPack(id) {
  const p = one('SELECT * FROM board_packs WHERE id = ?', Number(id));
  if (!p) refuse('no such board pack', 404);
  return { ...p, snapshot: JSON.parse(p.snapshot), drafts: draftsFor('boardpack', 'board_pack', p.id, 2) };
}

export function overview() {
  return { packs: q('SELECT id, period, state, issued_code, created_by, created_at FROM board_packs ORDER BY period DESC LIMIT 36'), suggested: previousPeriod() };
}
