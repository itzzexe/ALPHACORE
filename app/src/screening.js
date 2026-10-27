// Name screening — is this name close enough to a listed one to stop and look?
//
// Pure: no database, no network. Used by AML on Core 1 and by remittances on
// Core 2, which may share a function but not a table.
//
// Names are folded before they are compared — case, Latin accents, Arabic
// diacritics and the alif/ya/ta-marbuta variants, and the honorifics and
// company suffixes that make two spellings of one person look different. Then
// two measures, either of which can raise a hit: the share of name tokens in
// common, and an edit-distance ratio on the whole string. A screening hit is a
// question for a person, never a verdict.
const AR_DIACRITICS = /[ً-ٰٟـ]/g;
const NOISE = new Set(['mr', 'mrs', 'ms', 'dr', 'al', 'el', 'bin', 'ibn', 'abu', 'ltd', 'llc', 'inc', 'co', 'company', 'corp', 'sa', 'plc', 'gmbh', 'the', 'and',
  'ال', 'بن', 'ابن', 'ابو', 'شركة', 'مؤسسة', 'محدودة']);

export function fold(name) {
  return String(name || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(AR_DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).map((t) => t.replace(/^ال(?=\S{3,})/, '')).filter((t) => t && !NOISE.has(t))
    .join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** The two measures on already-folded names, apart, for a caller that weighs them differently. */
export function compareFolded(fa, fb) {
  if (!fa || !fb) return { common: 0, minTokens: 0, tokens: 0, edit: 0 };
  const ta = new Set(fa.split(' ')); const tb = new Set(fb.split(' '));
  const common = [...ta].filter((t) => tb.has(t)).length;
  const minTokens = Math.min(ta.size, tb.size);
  return { common, minTokens, tokens: common / minTokens, edit: 1 - levenshtein(fa, fb) / Math.max(fa.length, fb.length) };
}

/** 0..1 — how alike two names are after folding. */
export function similarity(a, b) {
  const { common, minTokens, tokens, edit } = compareFolded(fold(a), fold(b));
  return Math.round(Math.max(tokens * (common >= 2 || minTokens === 1 ? 1 : 0.8), edit) * 100) / 100;
}

/** Every listed name at or above the threshold, best first. */
export function screen(name, list, threshold = 0.85) {
  return list.map((l) => ({ ...l, score: similarity(name, l.name) }))
    .filter((l) => l.score >= threshold).sort((x, y) => y.score - x.score).slice(0, 5);
}
