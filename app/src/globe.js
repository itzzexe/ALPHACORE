// The company on the globe — every country the record touches, and the money
// that crossed to it.
//
// Nothing here is placed for effect. A country lights because a counterparty,
// a beneficiary, a researched company or a phone number in the record says it
// is there; an arc is drawn because a payment message was written to it. The
// console owns the coordinates (public/components/geo.js) and the names (the
// browser's own Intl.DisplayNames), so this answers in ISO codes and counts.
import { q } from './db.js';
import { getSetting } from './settings.js';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const ISO = /^[A-Z]{2}$/;
const round = (x) => Math.round(Number(x || 0) * 100) / 100;

/** The country the company is run from: set during setup, or not at all. */
export function homeCountry() {
  const c = String(getSetting('COMPANY_COUNTRY') || '').trim().toUpperCase();
  return ISO.test(c) ? c : null;
}

export function overview() {
  const countries = new Map();
  const tie = (cc, kind, n = 1) => {
    const c = String(cc || '').trim().toUpperCase();
    if (!ISO.test(c)) return;
    if (!countries.has(c)) countries.set(c, { code: c, total: 0, parties: 0, beneficiaries: 0, researched: 0, numbers: 0, payments: 0, amounts: {} });
    const row = countries.get(c);
    row[kind] += n;
    row.total += n;
  };
  for (const r of safe(() => q('SELECT country, COUNT(*) AS n FROM aml_parties WHERE country IS NOT NULL GROUP BY country'), [])) tie(r.country, 'parties', r.n);
  for (const r of safe(() => q('SELECT country, COUNT(*) AS n FROM remit_beneficiary GROUP BY country'), [])) tie(r.country, 'beneficiaries', r.n);
  for (const r of safe(() => q('SELECT country, COUNT(*) AS n FROM intel_records WHERE country IS NOT NULL GROUP BY country'), [])) tie(r.country, 'researched', r.n);
  for (const r of safe(() => q("SELECT country, COUNT(*) AS n FROM phone_numbers WHERE country IS NOT NULL AND state = 'active' GROUP BY country"), [])) tie(r.country, 'numbers', r.n);

  // Money that left, by where it went. A cancelled message never crossed; a
  // draft is intent, drawn fainter by the console.
  const arcs = [];
  for (const r of safe(() => q(`SELECT b.country, m.currency, m.state, COUNT(*) AS n, SUM(m.amount) AS amount
      FROM remit_message m JOIN remit_beneficiary b ON b.id = m.beneficiary_id
      WHERE m.state <> 'cancelled' GROUP BY b.country, m.currency, m.state`), [])) {
    const c = String(r.country || '').toUpperCase();
    if (!ISO.test(c)) continue;
    tie(c, 'payments', r.n);
    const row = countries.get(c);
    row.amounts[r.currency] = round((row.amounts[r.currency] || 0) + r.amount);
    arcs.push({ to: c, currency: r.currency, state: r.state, count: r.n, amount: round(r.amount) });
  }
  const list = [...countries.values()].sort((a, b) => b.total - a.total);
  return {
    home: homeCountry(),
    countries: list,
    arcs,
    totals: {
      countries: list.length,
      ties: list.reduce((a, c) => a + c.total, 0),
      payments: arcs.reduce((a, x) => a + x.count, 0),
      released: arcs.filter((x) => x.state === 'released').reduce((a, x) => a + x.count, 0),
    },
  };
}
