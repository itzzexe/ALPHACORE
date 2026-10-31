// What can be read out of a document's text without a model: pure functions.
//
// The machine-readable zone on a passport or a national ID card is the gift
// here — it carries its own check digits, so a field either checks out or is
// known to be misread. An invoice has no such thing, so its fields are a best
// guess from the words around them, and a person confirms them before
// anything is created from them.
import { parseAmount, parseDay } from '../core2/statements.js';

/** Arabic-Indic and Persian digits, and the Arabic decimal and thousands marks, as ASCII. */
export function normalizeDigits(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.').replace(/٬/g, ',');
}

// ---------------------------------------------------------------- MRZ --

const VALUE = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
export const checkDigit = (s) => String([...s].reduce((sum, c, i) => sum + VALUE(c) * [7, 3, 1][i % 3], 0) % 10);

const yymmdd = (s, future) => {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const now = new Date().getUTCFullYear() % 100;
  const century = future ? 2000 : (yy > now ? 1900 : 2000);
  return parseDay(`${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`);
};
const names = (field) => {
  const [surname, given = ''] = field.split('<<');
  return { surname: surname.replace(/</g, ' ').trim(), given: given.replace(/</g, ' ').trim() };
};

/** Find and read a passport (TD3) or ID-card (TD1) zone; every check digit is reported. */
export function parseMrz(text) {
  const lines = String(text || '').toUpperCase().replace(/[«‹]/g, '<').split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '')).filter((l) => /^[A-Z0-9<]{28,46}$/.test(l));
  for (let i = 0; i + 1 < lines.length; i++) {
    const [a, b] = [lines[i], lines[i + 1]];
    if (a.length === 44 && b.length === 44 && a[0] === 'P') {
      const checks = {
        number: checkDigit(b.slice(0, 9)) === b[9],
        birth: checkDigit(b.slice(13, 19)) === b[19],
        expiry: checkDigit(b.slice(21, 27)) === b[27],
        composite: checkDigit(b.slice(0, 10) + b.slice(13, 20) + b.slice(21, 43)) === b[43],
      };
      return {
        format: 'TD3', type: 'passport', issuer: a.slice(2, 5).replace(/</g, ''), ...names(a.slice(5)),
        number: b.slice(0, 9).replace(/</g, ''), nationality: b.slice(10, 13).replace(/</g, ''),
        birth: yymmdd(b.slice(13, 19), false), sex: b[20] === '<' ? null : b[20], expiry: yymmdd(b.slice(21, 27), true),
        checks, valid: Object.values(checks).every(Boolean),
      };
    }
    const c = lines[i + 2];
    if (a.length === 30 && b.length === 30 && c?.length === 30) {
      const checks = {
        number: checkDigit(a.slice(5, 14)) === a[14],
        birth: checkDigit(b.slice(0, 6)) === b[6],
        expiry: checkDigit(b.slice(8, 14)) === b[14],
        composite: checkDigit(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29)) === b[29],
      };
      return {
        format: 'TD1', type: 'id-card', issuer: a.slice(2, 5).replace(/</g, ''), ...names(c),
        number: a.slice(5, 14).replace(/</g, ''), nationality: b.slice(15, 18).replace(/</g, ''),
        birth: yymmdd(b.slice(0, 6), false), sex: b[7] === '<' ? null : b[7], expiry: yymmdd(b.slice(8, 14), true),
        checks, valid: Object.values(checks).every(Boolean),
      };
    }
  }
  return null;
}

// ------------------------------------------------------------- invoices --

const AMOUNT = /\(?-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\)?|\(?-?\d+(?:[.,]\d{1,2})?\)?/g;
const DATE = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g;

const amountsIn = (line) => (line.match(AMOUNT) || []).map(parseAmount).filter((n) => n != null && Math.abs(n) >= 1);
const firstDate = (line) => { for (const m of line.matchAll(DATE)) { const d = parseDay(m[1]); if (d) return d; } return null; };

/** The fields an invoice usually states, each found by the words around it. */
export function parseInvoice(raw) {
  const text = normalizeDigits(raw);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const find = (re) => lines.find((l) => re.test(l));
  const number = (text.match(/(?:invoice\s*(?:no\.?|number|#)|inv\s*#|رقم\s*الفاتورة|فاتورة\s*رقم)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]{1,30})/i) || [])[1] || null;
  const issuedLine = find(/(invoice\s*date|date\s*of\s*issue|^date|تاريخ\s*الفاتورة|تاريخ\s*الإصدار|^التاريخ)/i);
  const dueLine = find(/(due\s*date|payment\s*due|pay\s*by|تاريخ\s*الاستحقاق|يستحق)/i);
  const totalLines = lines.filter((l) => /(grand\s*total|total\s*due|amount\s*due|balance\s*due|\btotal\b|الإجمالي|المجموع|المبلغ\s*الإجمالي|الصافي|المستحق)/i.test(l) && !/sub\s*-?\s*total|المجموع\s*الفرعي/i.test(l));
  const taxLine = find(/(\bvat\b|\btax\b|ضريبة)/i);
  const all = lines.flatMap(amountsIn);
  const total = totalLines.flatMap(amountsIn).reduce((m, n) => Math.max(m, n), 0) || (all.length ? Math.max(...all) : null);
  const tax = taxLine ? (amountsIn(taxLine).filter((n) => n < (total || Infinity)).pop() ?? null) : null;
  const currency = /\bIQD\b|دينار|د\.ع/i.test(text) ? 'IQD' : /\bEUR\b|€/.test(text) ? 'EUR' : /\bUSD\b|\$|دولار/i.test(text) ? 'USD' : null;
  // \W without the Unicode flag counts every Arabic letter as punctuation, so
  // "has letters" is asked of \p{L}, or an Arabic supplier would never be found.
  const supplier = lines.find((l) => /\p{L}/u.test(l) && !/(invoice|فاتورة|tax|ضريبة|date|تاريخ)/i.test(l) && l.length >= 3 && l.length <= 80 && !amountsIn(l).length) || null;
  return {
    number, supplier, currency,
    issued: issuedLine ? firstDate(issuedLine) : firstDate(text),
    due: dueLine ? firstDate(dueLine) : null,
    total: total || null, tax,
  };
}

/** A contract: the parties named after "between", the dates and the sums it mentions. */
export function parseContract(raw) {
  const text = normalizeDigits(raw);
  const between = text.match(/between\s+(.{2,80}?)\s+(?:and|&)\s+(.{2,80}?)(?:[,.(\n]|$)/i)
    || text.match(/بين\s+(.{2,80}?)\s+و\s*(.{2,80}?)(?:[،,.(\n]|$)/);
  const dates = [...new Set([...text.matchAll(DATE)].map((m) => parseDay(m[1])).filter(Boolean))].slice(0, 10);
  // A sum is a number beside its currency; any other number on the line — a
  // date, a clause, a count of days — is not money.
  const CUR = '(?:USD|IQD|EUR|\\$|دينار|دولار)';
  const sums = [...new Set([...text.replace(DATE, ' ').matchAll(new RegExp(`${CUR}\\s*([\\d.,]+\\d)|([\\d.,]*\\d)\\s*${CUR}`, 'g'))]
    .map((m) => parseAmount(m[1] || m[2])).filter((v) => v != null && v > 0))].slice(0, 10);
  return { parties: between ? [between[1].trim(), between[2].trim()] : [], dates, sums };
}

export function extract(kind, text) {
  if (kind === 'id') return { mrz: parseMrz(text) };
  if (kind === 'invoice') return parseInvoice(text);
  if (kind === 'contract') return parseContract(text);
  return {};
}
