// Bank statement files — CSV from an online banking export, SWIFT MT940, and
// ISO 20022 camt.053 — read into the lines the bank module imports.
//
// Pure: text in, lines out. Nothing is imported here. The console shows what
// was read and a person imports it, because a statement parsed wrongly and
// imported silently becomes a reconciliation that balances against fiction.
// Every line is { day: 'YYYY-MM-DD', amount: signed, money in positive, ref }.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * An amount as banks write it: "1,234.56", "1.234,56", "(1,200.00)", "-50",
 * "1200.00 DR". The last separator followed by one or two digits is the
 * decimal point; every other separator is grouping.
 */
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\b(DR|D|DB|مدين)\s*$/i.test(s)) { sign = -1; s = s.replace(/\b(DR|D|DB|مدين)\s*$/i, ''); }
  s = s.replace(/\b(CR|C|دائن)\s*$/i, '').replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) { sign *= -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const dec = s.match(/[.,](\d{1,2})$/);
  const whole = dec ? s.slice(0, -dec[0].length) : s;
  const n = Number(`${whole.replace(/[.,]/g, '')}${dec ? `.${dec[1]}` : ''}`);
  return Number.isFinite(n) && whole !== '' ? round2(sign * n) : null;
}

/** A date as banks write it, day first when it is ambiguous — as it is everywhere this platform is used. */
export function parseDay(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return iso(m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  return null;
}
function iso(y, mo, d) {
  const day = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== day ? null : day;
}

// ------------------------------------------------------------------ CSV --

const H = {
  day: /^(date|booking ?date|posting ?date|value ?date|transaction ?date|تاريخ|التاريخ|تاريخ الحركة|تاريخ القيد)$/i,
  amount: /^(amount|amt|المبلغ|مبلغ)$/i,
  debit: /^(debit|withdrawal|withdrawals|paid out|money out|مدين|سحب|سحوبات)$/i,
  credit: /^(credit|deposit|deposits|paid in|money in|دائن|إيداع|ايداع|إيداعات)$/i,
  ref: /^(description|reference|ref|details|narrative|memo|particulars|البيان|الوصف|المرجع|التفاصيل)$/i,
};

function splitCsv(line, sep) {
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === sep) { cells.push(cur.trim()); cur = ''; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseCsv(text) {
  const rows = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) return { lines: [], skipped: 0 };
  const sep = [';', '\t', ','].map((c) => [c, splitCsv(rows[0], c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitCsv(rows[0], sep);
  const col = {};
  head.forEach((h, i) => { for (const [k, re] of Object.entries(H)) if (col[k] == null && re.test(h.trim())) col[k] = i; });
  const hasHeader = col.day != null && (col.amount != null || col.debit != null || col.credit != null);
  if (!hasHeader) Object.assign(col, { day: 0, amount: 1, ref: 2 });
  const lines = []; let skipped = 0;
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const c = splitCsv(row, sep);
    const day = parseDay(c[col.day]);
    let amount = col.amount != null ? parseAmount(c[col.amount]) : null;
    if (amount == null && (col.debit != null || col.credit != null)) {
      const dr = parseAmount(c[col.debit]); const cr = parseAmount(c[col.credit]);
      amount = (cr ? Math.abs(cr) : 0) - (dr ? Math.abs(dr) : 0);
    }
    if (!day || !amount) { skipped++; continue; }
    lines.push({ day, amount: round2(amount), ref: col.ref != null ? (c[col.ref] || '').slice(0, 80) : '' });
  }
  return { lines, skipped };
}

// ---------------------------------------------------------------- MT940 --

/**
 * MT940: each :61: is a movement — value date, optional entry date, the mark
 * (C, D, or RC/RD for a reversal), the amount with a decimal comma, the
 * transaction type — and the :86: after it says what it was.
 */
export function parseMt940(text) {
  const src = String(text).replace(/\r/g, '');
  const fields = [];
  for (const raw of src.split('\n')) {
    const m = raw.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) fields.push({ tag: m[1], value: m[2] });
    else if (fields.length && raw.trim() && !/^-}?$/.test(raw.trim()) && !raw.startsWith('{')) fields[fields.length - 1].value += `\n${raw}`;
  }
  const lines = []; let skipped = 0; let currency = null;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.tag === '60F' || f.tag === '60M') currency = (f.value.match(/^[CD]\d{6}([A-Z]{3})/) || [])[1] || currency;
    if (f.tag !== '61') continue;
    const m = f.value.match(/^(\d{2})(\d{2})(\d{2})(\d{4})?(RC|RD|C|D)[A-Z]?(\d+,\d{0,2})(?:[NSF][A-Z0-9]{3})?([^\n]*)/);
    if (!m) { skipped++; continue; }
    const day = iso(`20${m[1]}`, m[2], m[3]);
    const amount = Number(m[6].replace(',', '.'));
    const sign = m[5] === 'C' || m[5] === 'RD' ? 1 : -1;
    const next = fields[i + 1]?.tag === '86' ? fields[i + 1].value.replace(/\s*\n\s*/g, ' ').replace(/\?\d{2}/g, ' ').trim() : '';
    const custRef = m[7].split('//')[0].trim();
    if (!day || !amount) { skipped++; continue; }
    lines.push({ day, amount: round2(sign * amount), ref: (next || (custRef && custRef !== 'NONREF' ? custRef : '')).slice(0, 80) });
  }
  return { lines, skipped, currency };
}

// ------------------------------------------------------------- camt.053 --

const strip = (xml) => String(xml).replace(/<(\/?)[A-Za-z0-9_]+:/g, '<$1');
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : null; };
const xmlText = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();

/** camt.053: every <Ntry> is a booked movement; DBIT is money out, and a reversal flips it. */
export function parseCamt053(xml) {
  const src = strip(xml);
  const lines = []; let skipped = 0;
  const currency = (src.match(/<Acct>[\s\S]*?<Ccy>([A-Z]{3})<\/Ccy>/) || [])[1] || null;
  for (const m of src.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g)) {
    const b = m[1];
    const amount = Number(tag(b, 'Amt'));
    const dbit = tag(b, 'CdtDbtInd') === 'DBIT';
    const reversal = tag(b, 'RvslInd') === 'true';
    const booking = tag(b, 'BookgDt') || tag(b, 'ValDt') || '';
    const day = parseDay(tag(booking, 'Dt') || tag(booking, 'DtTm') || '');
    const ref = xmlText(tag(b, 'Ustrd') || tag(b, 'EndToEndId') || tag(b, 'AddtlNtryInf') || tag(b, 'NtryRef') || tag(b, 'AcctSvcrRef') || '');
    if (!day || !Number.isFinite(amount) || !amount) { skipped++; continue; }
    lines.push({ day, amount: round2((dbit !== reversal ? -1 : 1) * amount), ref: ref === 'NOTPROVIDED' ? '' : ref.slice(0, 80) });
  }
  return { lines, skipped, currency };
}

/** Which format a file is, from its contents rather than its name. */
export function detectFormat(text) {
  const head = String(text).slice(0, 4000);
  if (/camt\.053|<BkToCstmrStmt>|<[A-Za-z0-9_]+:BkToCstmrStmt>/.test(head)) return 'camt053';
  if (/^:20:|\n:20:|\{4:\s*\n:20:/.test(head) || /\n:61:/.test(String(text))) return 'mt940';
  return 'csv';
}

export function parseStatement(text, format = null) {
  if (String(text || '').length > 5_000_000) { const e = new Error('that file is larger than a statement should be'); e.status = 400; throw e; }
  const f = format || detectFormat(text);
  const out = f === 'camt053' ? parseCamt053(text) : f === 'mt940' ? parseMt940(text) : parseCsv(text);
  return { format: f, ...out };
}
