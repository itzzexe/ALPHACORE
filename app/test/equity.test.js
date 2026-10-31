// The cap table: who owns the company, and what a round or an exit does.
//
// What is tested is the arithmetic a founder signs on — the vesting on the
// day of the cliff and the day before it, the pool that cannot be granted
// past its size, the price a SAFE converts at when the cap is the better deal
// and when the discount is, the investor's percentage after the pool shuffle,
// and who is paid what at an exit when the preference wins and when the
// preferred holders do better converting. And the rule that makes it a
// ledger: shares change only by rows a person writes, and the chain has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-equity.db';
process.env.ALPHACORE_MEMORY_DIR = 'data/test-equity-files/memory';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-equity.db${suffix}`)); } catch { /* first run */ }
}
fs.rmSync(path.join(root, 'data', 'test-equity-files'), { recursive: true, force: true });

const { one, q } = await import('../src/db.js');
const { PERMS } = await import('../src/auth.js');
const { expandTemplate } = await import('../src/approvals.js');
const { sectionCatalog, SURFACES } = await import('../src/links.js');
const { verifyChain } = await import('../src/audit.js');
const E = await import('../src/equity.js');

const ME = 'human:founder';
const h = {};

test('only a person changes who owns the company', () => {
  h.zaid = E.addHolder({ name: 'Zaid', kind: 'founder', actor: ME });
  h.sara = E.addHolder({ name: 'Sara', kind: 'founder', actor: ME });
  h.angel = E.addHolder({ name: 'Angel Fund', kind: 'investor', actor: ME });
  h.omar = E.addHolder({ name: 'Omar', kind: 'employee', actor: ME });
  assert.throws(() => E.issueShares({ holderId: h.zaid.id, shares: 10, actor: 'agent:AGT-CFO-001' }), (e) => e.status === 403);
  assert.throws(() => E.issueShares({ holderId: h.zaid.id, shares: 10, actor: 'system:x' }), (e) => e.status === 403);
  assert.throws(() => E.addHolder({ name: 'X', kind: 'wizard', actor: ME }), /kind/);
  assert.throws(() => E.issueShares({ holderId: h.zaid.id, shares: 1.5, actor: ME }), /whole number/);
});

test('shares move only as ledger rows, and a correction says why', () => {
  E.issueShares({ holderId: h.zaid.id, shares: 6_000_000, price: 0.0001, ref: 'Board resolution 1', actor: ME });
  E.issueShares({ holderId: h.sara.id, shares: 4_000_100, price: 0.0001, actor: ME });
  const common = one("SELECT id FROM eq_classes WHERE kind = 'common'").id;
  assert.throws(() => E.cancelShares({ holderId: h.sara.id, classId: common, shares: 100, actor: ME }), /why/);
  assert.throws(() => E.cancelShares({ holderId: h.sara.id, classId: common, shares: 9_000_000, note: 'typo', actor: ME }), (e) => e.status === 409);
  E.cancelShares({ holderId: h.sara.id, classId: common, shares: 100, note: 'typed one hundred too many', actor: ME });
  const rows = q('SELECT kind, shares FROM eq_ledger WHERE holder_id = ? ORDER BY id', h.sara.id);
  assert.deepEqual(rows.map((r) => [r.kind, r.shares]), [['issue', 4_000_100], ['cancel', -100]]);
  const t = E.capTable();
  assert.equal(t.totals.issued, 10_000_000);
  assert.equal(t.holders.find((x) => x.id === h.zaid.id).basicPct, 60);
});

test('options vest on the calendar: nothing the day before the cliff, a year of them on the day', () => {
  const g = { granted_on: '2025-01-15', shares: 4800, vest_months: 48, cliff_months: 12 };
  assert.equal(E.vestedOf(g, '2026-01-14'), 0);
  assert.equal(E.vestedOf(g, '2026-01-15'), 1200);
  assert.equal(E.vestedOf(g, '2026-02-14'), 1200);
  assert.equal(E.vestedOf(g, '2026-02-15'), 1300);
  assert.equal(E.vestedOf(g, '2031-01-01'), 4800);
  assert.equal(E.vestedOf(g, '2024-12-31'), 0);
});

test('the pool cannot be granted past its size, and an ended grant gives back what was not exercised', () => {
  assert.throws(() => E.grantOptions({ holderId: h.omar.id, shares: 10, actor: ME }), (e) => e.status === 409);
  E.setPool({ size: 1_000_000, actor: ME });
  const g = E.grantOptions({ holderId: h.omar.id, shares: 240_000, strike: 0.05, grantedOn: '2024-01-01', actor: ME });
  assert.throws(() => E.grantOptions({ holderId: h.omar.id, shares: 800_000, actor: ME }), /760000 options left/);
  assert.throws(() => E.setPool({ size: 100_000, actor: ME }), /already granted/);
  // Thirty-three months in: 165,000 vested.
  const vested = E.vestedOf(g);
  assert.ok(vested > 0 && vested < 240_000);
  assert.throws(() => E.exerciseOptions({ grantId: g.id, shares: vested + 1, actor: ME }), (e) => e.status === 409);
  E.exerciseOptions({ grantId: g.id, shares: 40_000, actor: ME });
  const ex = one("SELECT * FROM eq_ledger WHERE kind = 'exercise'");
  assert.equal(ex.shares, 40_000);
  assert.equal(ex.price, 0.05);
  E.cancelGrant({ grantId: g.id, note: 'left the company', actor: ME });
  const t = E.capTable();
  // 40,000 exercised stays used; the other 200,000 are back in the pool.
  assert.equal(t.totals.poolFree, 960_000);
  assert.equal(t.totals.options, 0);
  assert.equal(t.totals.issued, 10_040_000);
});

test('a round: the investor owns investment ÷ post-money, the pool is topped up before, and a SAFE converts at the better price', () => {
  E.addConvertible({ holderId: h.angel.id, kind: 'safe', principal: 250_000, cap: 5_000_000, discountPct: 20, actor: ME });
  const t = E.capTable();
  const base = t.totals.fullyDiluted;
  const r = E.modelRound({ preMoney: 12_000_000, investment: 3_000_000, poolPostPct: 15 });
  assert.ok(Math.abs(r.investorPct - 20) < 0.01, `investor ${r.investorPct}%`);
  assert.ok(Math.abs(r.postMoney - 15_000_000) < 50);
  const pool = r.rows.find((x) => x.kind === 'pool');
  assert.ok(Math.abs(pool.after - 15) < 0.01, `pool ${pool.after}%`);
  // The cap price (5M over the fully diluted base) beats 80 % of the round price.
  const c = r.conversions[0];
  assert.equal(c.via, 'cap');
  assert.ok(Math.abs(c.price - 5_000_000 / base) < 0.0001);
  assert.ok(Math.abs(r.rows.reduce((a, x) => a + x.after, 0) - 100) < 0.01);
  // At a low valuation the discount is the better deal.
  const low = E.modelRound({ preMoney: 4_000_000, investment: 1_000_000, poolPostPct: 0 });
  assert.equal(low.conversions[0].via, 'discount');
  assert.ok(Math.abs(low.conversions[0].price - low.price * 0.8) < 0.0001);
  assert.throws(() => E.modelRound({ preMoney: 0, investment: 1 }), /pre-money/);
});

test('an exit: preference first and most senior first, then each preferred class takes the better of its preference or converting', () => {
  const seed = E.addClass({ name: 'Seed preferred', kind: 'preferred', liqPref: 1, seniority: 1, actor: ME });
  const a = E.addClass({ name: 'Series A', kind: 'preferred', liqPref: 1, seniority: 2, participating: true, actor: ME });
  E.issueShares({ holderId: h.angel.id, classId: seed.id, shares: 2_000_000, price: 1, actor: ME });
  E.issueShares({ holderId: h.angel.id, classId: a.id, shares: 1_000_000, price: 3, actor: ME });
  // 4M: Series A is senior and owed 3M; Seed gets the 1M left; common nothing.
  let w = E.exitWaterfall({ value: 4_000_000 });
  const cls = (name) => w.classes.find((c) => c.name === name);
  assert.equal(cls('Series A').prefPaid, 3_000_000);
  assert.equal(cls('Seed preferred').prefPaid, 1_000_000);
  assert.equal(cls('Common').payout, 0);
  // 200M: seed converts (its 2M preference is far less than its share as
  // common); Series A participates, so it takes its 3M and shares as well.
  w = E.exitWaterfall({ value: 200_000_000 });
  assert.equal(cls('Seed preferred').converted, true);
  assert.equal(cls('Series A').prefPaid, 3_000_000);
  assert.ok(cls('Series A').share > 0);
  const total = w.classes.reduce((s, c) => s + c.payout, 0);
  assert.ok(Math.abs(total - 200_000_000) < 1, 'every dollar is paid to somebody');
  const zaid = w.holders.find((x) => x.id === h.zaid.id);
  assert.ok(zaid.payout > 0 && zaid.multiple > 1000);
});

test('a scenario is kept with its inputs, and keeping and removing are on the chain', () => {
  const s = E.saveScenario({ name: 'Seed at 12', params: { preMoney: 12_000_000, investment: 3_000_000, poolPostPct: 10 }, actor: ME });
  assert.ok(s.result.price > 0);
  const x = E.saveScenario({ name: 'Sale at 50', params: { kind: 'exit', value: 50_000_000 }, actor: ME });
  assert.equal(x.kind, 'exit');
  assert.throws(() => E.saveScenario({ name: 'n', params: {}, actor: 'agent:x' }), (e) => e.status === 403);
  E.removeScenario({ id: s.id, actor: ME });
  assert.equal(E.overview().scenarios.length, 1);
  const acts = q("SELECT action FROM audit_log WHERE action LIKE 'equity.%'").map((r) => r.action);
  for (const a of ['equity.issued', 'equity.cancelled', 'equity.granted', 'equity.exercised', 'equity.grant_cancelled', 'equity.convertible', 'equity.pool', 'equity.scenario', 'equity.scenario_removed']) {
    assert.ok(acts.includes(a), a);
  }
  assert.equal(verifyChain().ok, true);
});

test('the department is catalogued, placed once, and issuing is its own power', () => {
  for (const p of ['equity.view', 'equity.manage', 'equity.issue']) assert.ok(PERMS.includes(p), p);
  assert.ok(sectionCatalog().find((s) => s.id === 'equity'));
  assert.equal(SURFACES.filter((s) => s.departments.includes('equity')).length, 1);
  assert.ok(expandTemplate('finance').includes('equity.issue'));
  assert.ok(!expandTemplate('operator').includes('equity.issue'));
});
