// The code editor — a textarea that types, and a picture of the same text
// behind it that is coloured.
//
// The console loads nothing from anywhere but its own server, so there is no
// Monaco and no CodeMirror; and it has no build step, so there is nothing to
// vendor them through. What there is instead is the oldest trick in the book,
// done carefully: the textarea keeps every native behaviour that is hard to
// get right — selection, IME, spell-free typing, the browser's own undo — and
// its text is made transparent over a <pre> that is re-painted with colour.
// Both use the same font, the same padding and the same line height, so a
// caret in one is exactly over the character in the other.
//
// Edits made by a key binding go through insertText, which the browser files
// in its undo history; a setRangeText would work once and make Ctrl+Z forget
// it. Highlighting is a single pass of one regular expression per language,
// which is fast enough for a 200 KB file and honest about what it is: colour,
// not a parser. Past that size the picture stays plain.
import { esc } from '../core/dom.js';
import { t } from '/i18n.js';

const LINE = 20;
const PAD = 10;
const MAX_HIGHLIGHT = 200_000;

// ------------------------------------------------------------- languages --

const words = (s) => s.split(/\s+/).filter(Boolean).join('|');
const JS_KW = words(`await break case catch class const continue debugger default delete do else export extends finally for from function
  get if import in instanceof let new of return set static super switch throw try typeof var void while with yield async as interface type
  enum implements private public protected readonly declare namespace abstract keyof satisfies`);
const PY_KW = words(`and as assert async await break class continue def del elif else except finally for from global if import in is lambda
  nonlocal not or pass raise return try while with yield match case self cls`);
const C_KW = words(`if else for while do switch case default break continue return goto struct union enum typedef sizeof static const
  extern volatile register void int long short char float double unsigned signed bool class public private protected new delete this
  namespace using template typename virtual override final package import func go defer chan map range type var interface select fallthrough
  fn let mut impl trait pub use mod crate match loop where as dyn move ref self Self async await val fun object when is in
  throws throw try catch finally extends implements instanceof synchronized`);
const SQL_KW = words(`select from where insert into values update set delete create table index view drop alter add column primary key
  foreign references not null unique default check and or in is like between join left right inner outer full on group by order having
  limit offset as distinct union all exists case when then else end begin commit rollback transaction returning with recursive asc desc
  integer text real blob boolean varchar int serial timestamp date`);

/** Each language is one alternation; the group that matched names the colour. */
const LANGS = {
  js: {
    label: 'JavaScript', comment: '//',
    re: new RegExp([
      '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',                           // 1 comment
      '(`(?:\\\\[\\s\\S]|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')', // 2 string
      '(\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?)\\b)', // 3 number
      `(\\b(?:${JS_KW})\\b)`,                                                // 4 keyword
      '(\\b(?:true|false|null|undefined|this|NaN|Infinity)\\b)',            // 5 literal
      '(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())',                                  // 6 function
      '(@[\\w.]+)',                                                         // 7 decorator
      '(\\b[A-Z][\\w$]*\\b)',                                               // 8 type
    ].join('|'), 'g'),
    classes: [null, 'c', 's', 'n', 'k', 'l', 'f', 'd', 'y'],
  },
  py: {
    label: 'Python', comment: '#',
    re: new RegExp([
      '(#[^\\n]*)',
      '([rbfu]{0,2}"""[\\s\\S]*?"""|[rbfu]{0,2}\'\'\'[\\s\\S]*?\'\'\'|[rbfu]{0,2}"(?:\\\\.|[^"\\\\\\n])*"|[rbfu]{0,2}\'(?:\\\\.|[^\'\\\\\\n])*\')',
      '(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?j?\\b)',
      `(\\b(?:${PY_KW})\\b)`,
      '(\\b(?:True|False|None)\\b)',
      '(\\b[A-Za-z_]\\w*(?=\\s*\\())',
      '(@[\\w.]+)',
      '(\\b[A-Z]\\w*\\b)',
    ].join('|'), 'g'),
    classes: [null, 'c', 's', 'n', 'k', 'l', 'f', 'd', 'y'],
  },
  c: {
    label: 'Code', comment: '//',
    re: new RegExp([
      '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|#(?:include|define|if|ifdef|ifndef|endif|pragma)[^\\n]*)',
      '("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`[^`]*`)',
      '(\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[fdluFDLU]*)\\b)',
      `(\\b(?:${C_KW})\\b)`,
      '(\\b(?:true|false|null|nil|None|nullptr)\\b)',
      '(\\b[A-Za-z_]\\w*(?=\\s*\\())',
      '(@\\w+)',
      '(\\b[A-Z]\\w*\\b)',
    ].join('|'), 'g'),
    classes: [null, 'c', 's', 'n', 'k', 'l', 'f', 'd', 'y'],
  },
  json: {
    label: 'JSON', comment: null,
    re: /("(?:\\.|[^"\\\n])*"(?=\s*:))|("(?:\\.|[^"\\\n])*")|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b(?:true|false|null)\b)/gi,
    classes: [null, 'a', 's', 'n', 'l'],
  },
  css: {
    label: 'CSS', comment: null,
    re: /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|(#[\da-f]{3,8}\b)|(-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?\b)|([\w-]+(?=\s*:[^:{]*[;}\n]))|(var(?=\())|(![\w]+)/gi,
    classes: [null, 'c', 's', 'd', 'n', 'n', 'p', 'f', 'k'],
  },
  html: {
    label: 'HTML', comment: null,
    re: /(<!--[\s\S]*?-->)|(<\/?[\w:-]+|\/?>)|(\s[\w:@.-]+(?==))|("[^"]*"|'[^']*')|(&[\w#]+;)/g,
    classes: [null, 'c', 't', 'a', 's', 'l'],
  },
  md: {
    label: 'Markdown', comment: null,
    re: /(^#{1,6} [^\n]*)|(```[\s\S]*?```|`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[[^\]\n]+\]\([^)\n]+\))|(^\s*(?:[-*+]|\d+\.) )|(^>[^\n]*)/gm,
    classes: [null, 'h', 's', 'k', 'f', 'd', 'c'],
  },
  sh: {
    label: 'Shell', comment: '#',
    re: /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\$\{?[\w@#?*!-]+\}?)|(\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|export|local|set|unset|echo|cd|exit)\b)|(^\s*[\w.-]+(?=\s*[:=]))|(\b\d+(?:\.\d+)?\b)|(\b(?:true|false|null|yes|no|on|off)\b)/gm,
    classes: [null, 'c', 's', 'f', 'k', 'a', 'n', 'l'],
  },
  sql: {
    label: 'SQL', comment: '--',
    re: new RegExp(`(--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|('(?:''|[^'])*')|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:${SQL_KW})\\b)|(\\b[A-Za-z_]\\w*(?=\\s*\\())`, 'gi'),
    classes: [null, 'c', 's', 'n', 'k', 'f'],
  },
  text: { label: 'Plain text', comment: null, re: null, classes: [] },
};

const EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', vue: 'html', svelte: 'html',
  py: 'py', json: 'json', webmanifest: 'json', css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', md: 'md', markdown: 'md',
  sh: 'sh', bash: 'sh', yml: 'sh', yaml: 'sh', toml: 'sh', ini: 'sh', env: 'sh', gitignore: 'sh', dockerignore: 'sh', conf: 'sh',
  sql: 'sql', go: 'c', rs: 'c', java: 'c', c: 'c', h: 'c', cpp: 'c', cs: 'c', kt: 'c', swift: 'c', php: 'c', rb: 'py',
};
export function languageOf(path) {
  const base = String(path || '').split('/').pop();
  if (/^(Dockerfile|Makefile|Procfile)$/i.test(base) || /^\.env/.test(base)) return 'sh';
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return EXT[ext] || 'text';
}
export const languageLabel = (id) => LANGS[id]?.label || id;

/** Text to coloured HTML, in one pass. Pure, so the diff view can use it too. */
export function highlight(text, lang) {
  const L = LANGS[lang];
  if (!L?.re || text.length > MAX_HIGHLIGHT) return esc(text);
  const re = new RegExp(L.re.source, L.re.flags);
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    let g = 1;
    while (g < m.length && m[g] === undefined) g += 1;
    const cls = L.classes[g];
    out += esc(text.slice(last, m.index));
    out += cls ? `<span class="tk-${cls}">${esc(m[0])}</span>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** Functions, classes and headings — the outline an editor shows on the side. */
export function outline(text, lang) {
  const rules = {
    js: [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/, /^\s*(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/, /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/, /^\s{2,}(?:async\s+)?(?!if\b|for\b|while\b|switch\b|catch\b|return\b)([\w$]+)\s*\([^)]*\)\s*\{\s*$/],
    py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
    c: [/^\s*(?:func|fn|def|fun)\s+(?:\([^)]*\)\s*)?(\w+)/, /^\s*(?:pub\s+)?(?:struct|class|interface|trait|enum|impl)\s+(\w+)/],
    md: [/^(#{1,6} .+)$/],
    css: [/^([^\s@{][^{]*)\{/],
  }[lang] || [];
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < 400; i++) {
    for (const r of rules) {
      const m = lines[i].match(r);
      if (m) { out.push({ line: i + 1, name: m[1].trim().slice(0, 80), depth: (lines[i].match(/^\s*/)[0].length / 2) | 0 }); break; }
    }
  }
  return out;
}

// --------------------------------------------------------------- the diff --

/**
 * Myers' diff over lines: the shortest edit script, so a diff shows what a
 * person would say changed rather than the first alignment that happens to
 * work. Bounded, because a diff of two unrelated 50,000-line files is not a
 * diff anybody reads.
 */
export function diffLines(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const N = A.length;
  const M = B.length;
  const MAX = Math.min(N + M, 2000);
  const V = new Map([[1, 0]]);
  const trace = [];
  let found = false;
  for (let d = 0; d <= MAX && !found; d++) {
    trace.push(new Map(V));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && (V.get(k - 1) ?? -1) < (V.get(k + 1) ?? -1))) ? (V.get(k + 1) ?? 0) : (V.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x += 1; y += 1; }
      V.set(k, x);
      if (x >= N && y >= M) { found = true; break; }
    }
  }
  if (!found) return [...A.map((l, i) => ({ op: '-', a: i + 1, text: l })), ...B.map((l, i) => ({ op: '+', b: i + 1, text: l }))];
  const out = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { out.push({ op: ' ', a: x, b: y, text: A[x - 1] }); x -= 1; y -= 1; }
    if (d > 0) {
      if (x === prevX) out.push({ op: '+', b: y, text: B[y - 1] });
      else out.push({ op: '-', a: x, text: A[x - 1] });
    }
    x = prevX; y = prevY;
  }
  return out.reverse();
}

/** A unified diff, folded so unchanged stretches collapse to a line that says so. */
export function renderDiff(before, after, path, { context = 3 } = {}) {
  const lang = languageOf(path);
  const rows = diffLines(before, after);
  const keep = rows.map((r, i) => r.op !== ' ' || rows.slice(Math.max(0, i - context), i + context + 1).some((x) => x.op !== ' '));
  const added = rows.filter((r) => r.op === '+').length;
  const removed = rows.filter((r) => r.op === '-').length;
  let html = '';
  let skipped = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) { skipped += 1; return; }
    if (skipped) { html += `<div class="df-fold">⋯ ${skipped} ${esc(t('unchanged lines'))}</div>`; skipped = 0; }
    html += `<div class="df-row df-${r.op === '+' ? 'add' : r.op === '-' ? 'del' : 'eq'}"><span class="df-n">${r.a ?? ''}</span><span class="df-n">${r.b ?? ''}</span><span class="df-op">${r.op === ' ' ? '' : r.op}</span><code>${highlight(r.text, lang) || ' '}</code></div>`;
  });
  if (skipped) html += `<div class="df-fold">⋯ ${skipped} ${esc(t('unchanged lines'))}</div>`;
  return { html: `<div class="df" data-no-i18n>${html || `<div class="df-fold">${esc(t('No differences'))}</div>`}</div>`, added, removed };
}

// ------------------------------------------------------------- the editor --

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);

/**
 * Mount an editor in `host`. Returns a small handle; everything else is
 * private. `onSave` is called with the text on Ctrl+S, `onChange` on every
 * edit, `onCursor` with {line, col, selected} as the caret moves.
 */
export function createEditor(host, { value = '', path = '', readOnly = false, onChange = null, onSave = null, onCursor = null, onCommand = null } = {}) {
  let lang = languageOf(path);
  let clean = value;
  let markers = [];
  let find = { open: false, query: '', regex: false, caseSensitive: false, index: -1, hits: [] };

  host.innerHTML = `
  <div class="ed" data-no-i18n>
    <div class="ed-gutter" aria-hidden="true"><div class="ed-gutter-in"></div></div>
    <div class="ed-scroll">
      <div class="ed-layer">
        <div class="ed-line" aria-hidden="true"></div>
        <pre class="ed-marks" aria-hidden="true"></pre>
        <pre class="ed-hl" aria-hidden="true"></pre>
      </div>
      <textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="${esc(t('Code editor'))}: ${esc(path)}" ${readOnly ? 'readonly' : ''}></textarea>
    </div>
    <form class="ed-find" hidden>
      <input class="ed-find-q" placeholder="${esc(t('Find'))}" aria-label="${esc(t('Find'))}" autocomplete="off">
      <button type="button" class="ed-tog" data-tog="case" aria-label="${esc(t('Match case'))}" title="${esc(t('Match case'))}">Aa</button>
      <button type="button" class="ed-tog" data-tog="regex" aria-label="${esc(t('Regular expression'))}" title="${esc(t('Regular expression'))}">.*</button>
      <span class="ed-find-n" aria-live="polite"></span>
      <button type="button" data-find="prev" aria-label="${esc(t('Previous match'))}">↑</button>
      <button type="button" data-find="next" aria-label="${esc(t('Next match'))}">↓</button>
      ${readOnly ? '' : `<input class="ed-find-r" placeholder="${esc(t('Replace'))}" aria-label="${esc(t('Replace'))}" autocomplete="off">
      <button type="button" data-find="one">${esc(t('Replace'))}</button>
      <button type="button" data-find="all">${esc(t('All'))}</button>`}
      <button type="button" data-find="close" aria-label="${esc(t('Close'))}">✕</button>
    </form>
  </div>`;
  const root = host.querySelector('.ed');
  const ta = root.querySelector('.ed-ta');
  const hl = root.querySelector('.ed-hl');
  const marks = root.querySelector('.ed-marks');
  const layer = root.querySelector('.ed-layer');
  const lineBar = root.querySelector('.ed-line');
  const gutter = root.querySelector('.ed-gutter-in');
  const findBox = root.querySelector('.ed-find');
  const fq = root.querySelector('.ed-find-q');
  const fr = root.querySelector('.ed-find-r');
  ta.value = value;

  const indentUnit = () => (/^\t/m.test(ta.value) && !/^ {2}/m.test(ta.value) ? '\t' : '  ');

  // ---- painting ----
  let paintQueued = false;
  const paint = () => {
    paintQueued = false;
    const text = ta.value;
    hl.innerHTML = `${highlight(text, lang)}\n`;
    const n = text.split('\n').length;
    const byLine = new Map(markers.map((m) => [m.line, m]));
    let g = '';
    for (let i = 1; i <= n; i++) {
      const mk = byLine.get(i);
      g += mk ? `<div class="ed-ln mk-${esc(mk.severity)}" title="${esc(mk.title)}">${i}</div>` : `<div class="ed-ln">${i}</div>`;
    }
    gutter.innerHTML = g;
    if (find.open) paintFind();
    sync();
    cursor();
  };
  const queuePaint = () => { if (!paintQueued) { paintQueued = true; requestAnimationFrame(paint); } };
  const sync = () => {
    layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const lineOf = (pos) => ta.value.slice(0, pos).split('\n').length;
  const cursor = () => {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    lineBar.style.top = `${PAD + (line - 1) * LINE}px`;
    onCursor?.({ line, col, selected: Math.abs(ta.selectionEnd - ta.selectionStart), lines: ta.value.split('\n').length, lang, indent: indentUnit() === '\t' ? 'Tabs' : 'Spaces: 2' });
  };

  // ---- editing primitives ----
  /** Replace [from, to) with text, through the browser's undo history. */
  const replaceRange = (from, to, text, selFrom = null, selTo = null) => {
    ta.focus();
    ta.setSelectionRange(from, to);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) ta.setRangeText(text, from, to, 'end');
    if (selFrom !== null) ta.setSelectionRange(selFrom, selTo ?? selFrom);
    changed();
  };
  const changed = () => { queuePaint(); onChange?.(ta.value, ta.value !== clean); };
  const lineStart = (pos) => ta.value.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = (pos) => { const i = ta.value.indexOf('\n', pos); return i === -1 ? ta.value.length : i; };
  /** The full lines a selection touches, as [start, end) offsets. */
  const selectedLines = () => {
    const s = ta.selectionStart;
    let e = ta.selectionEnd;
    if (e > s && ta.value[e - 1] === '\n') e -= 1;
    return [lineStart(s), lineEnd(e)];
  };

  const indentLines = (out) => {
    const unit = indentUnit();
    const [a, b] = selectedLines();
    const block = ta.value.slice(a, b);
    const next = block.split('\n').map((l) => (out ? l.replace(new RegExp(`^(${unit === '\t' ? '\\t' : ' {1,2}'})`), '') : unit + l)).join('\n');
    const s0 = ta.selectionStart;
    const delta = next.split('\n')[0].length - block.split('\n')[0].length;
    replaceRange(a, b, next, Math.max(a, s0 + delta), a + next.length);
  };

  const toggleComment = () => {
    const c = LANGS[lang]?.comment;
    const [a, b] = selectedLines();
    const block = ta.value.slice(a, b);
    const lines = block.split('\n');
    if (!c) {
      // Languages with only block comments get a block around the lines.
      const wrap = lang === 'html' || lang === 'md' ? ['<!-- ', ' -->'] : ['/* ', ' */'];
      const on = block.trimStart().startsWith(wrap[0].trim());
      const next = on ? block.replace(wrap[0], '').replace(wrap[1], '') : `${wrap[0]}${block}${wrap[1]}`;
      replaceRange(a, b, next, a, a + next.length);
      return;
    }
    const all = lines.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(c));
    const minIndent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), 1e9);
    const next = lines.map((l) => {
      if (!l.trim()) return l;
      if (all) return l.replace(new RegExp(`^(\\s*)${c.replace(/[/*]/g, '\\$&')} ?`), '$1');
      return `${l.slice(0, minIndent === 1e9 ? 0 : minIndent)}${c} ${l.slice(minIndent === 1e9 ? 0 : minIndent)}`;
    }).join('\n');
    replaceRange(a, b, next, a, a + next.length);
  };

  const moveLines = (dir) => {
    const [a, b] = selectedLines();
    const text = ta.value;
    if (dir < 0 && a === 0) return;
    if (dir > 0 && b >= text.length) return;
    const block = text.slice(a, b);
    if (dir < 0) {
      const pa = lineStart(a - 1);
      const prev = text.slice(pa, a - 1);
      replaceRange(pa, b, `${block}\n${prev}`, pa, pa + block.length);
    } else {
      const nb = lineEnd(b + 1);
      const next = text.slice(b + 1, nb);
      replaceRange(a, nb, `${next}\n${block}`, a + next.length + 1, a + next.length + 1 + block.length);
    }
  };

  const duplicateLines = () => {
    const [a, b] = selectedLines();
    const block = ta.value.slice(a, b);
    replaceRange(b, b, `\n${block}`, b + 1, b + 1 + block.length);
  };

  /** Select the word under the caret, or the next occurrence of what is selected. */
  const selectNext = () => {
    const v = ta.value;
    let s = ta.selectionStart;
    let e = ta.selectionEnd;
    if (s === e) {
      while (s > 0 && /[\w$]/.test(v[s - 1])) s -= 1;
      while (e < v.length && /[\w$]/.test(v[e])) e += 1;
      ta.setSelectionRange(s, e);
      return;
    }
    const word = v.slice(s, e);
    let i = v.indexOf(word, e);
    if (i === -1) i = v.indexOf(word);
    if (i !== -1) { ta.setSelectionRange(i, i + word.length); reveal(i); }
  };

  const reveal = (pos) => {
    const line = lineOf(pos);
    const top = PAD + (line - 1) * LINE;
    if (top < ta.scrollTop + LINE || top > ta.scrollTop + ta.clientHeight - LINE * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    sync();
  };

  const goto = (line, col = 1) => {
    const lines = ta.value.split('\n');
    const L = Math.max(1, Math.min(lines.length, Number(line) || 1));
    let pos = 0;
    for (let i = 0; i < L - 1; i++) pos += lines[i].length + 1;
    pos += Math.max(0, Math.min(lines[L - 1].length, (Number(col) || 1) - 1));
    ta.focus();
    ta.setSelectionRange(pos, pos);
    reveal(pos);
    cursor();
  };

  // ---- find & replace ----
  const findRe = () => {
    if (!find.query) return null;
    try { return new RegExp(find.regex ? find.query : find.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), find.caseSensitive ? 'g' : 'gi'); } catch { return null; }
  };
  const paintFind = () => {
    const re = findRe();
    const text = ta.value;
    find.hits = [];
    if (re) {
      let m;
      while ((m = re.exec(text)) && find.hits.length < 5000) {
        if (m[0] === '') { re.lastIndex += 1; continue; }
        find.hits.push([m.index, m.index + m[0].length]);
      }
    }
    let html = '';
    let last = 0;
    find.hits.forEach(([a, b], i) => { html += `${esc(text.slice(last, a))}<mark class="${i === find.index ? 'on' : ''}">${esc(text.slice(a, b))}</mark>`; last = b; });
    marks.innerHTML = `${html}${esc(text.slice(last))}\n`;
    root.querySelector('.ed-find-n').textContent = find.query ? (find.hits.length ? `${find.index + 1 || '?'}/${find.hits.length}` : t('No results')) : '';
  };
  const findStep = (dir) => {
    paintFind();
    if (!find.hits.length) return;
    const pos = ta.selectionEnd;
    if (dir > 0) find.index = find.hits.findIndex(([a]) => a >= (find.index >= 0 ? find.hits[find.index][0] + 1 : pos));
    else { const back = [...find.hits].reverse().findIndex(([a]) => a < (find.index >= 0 ? find.hits[find.index][0] : pos)); find.index = back === -1 ? -1 : find.hits.length - 1 - back; }
    if (find.index < 0) find.index = dir > 0 ? 0 : find.hits.length - 1;
    const [a, b] = find.hits[find.index];
    ta.setSelectionRange(a, b);
    reveal(a);
    paintFind();
  };
  const openFind = (replace = false) => {
    find.open = true;
    findBox.hidden = false;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n')) fq.value = sel;
    find.query = fq.value;
    marks.hidden = false;
    paintFind();
    (replace && fr ? fr : fq).focus();
    fq.select();
  };
  const closeFind = () => { find.open = false; findBox.hidden = true; marks.hidden = true; marks.innerHTML = ''; ta.focus(); };
  // As you type, the nearest match at or after the caret is selected — so the
  // counter reads "1/4" rather than "?/4", and Enter goes on from there.
  fq.addEventListener('input', () => {
    find.query = fq.value;
    find.index = -1;
    paintFind();
    if (!find.hits.length) return;
    const from = ta.selectionStart;
    const i = find.hits.findIndex(([a]) => a >= from);
    find.index = i < 0 ? 0 : i;
    const [a, b] = find.hits[find.index];
    ta.setSelectionRange(a, b);
    reveal(a);
    paintFind();
  });
  fq.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  fr?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  findBox.addEventListener('submit', (e) => e.preventDefault());
  findBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tog) {
      find[b.dataset.tog === 'case' ? 'caseSensitive' : 'regex'] = !find[b.dataset.tog === 'case' ? 'caseSensitive' : 'regex'];
      b.classList.toggle('on');
      find.index = -1;
      paintFind();
      return;
    }
    const act = b.dataset.find;
    if (act === 'close') closeFind();
    if (act === 'next') findStep(1);
    if (act === 'prev') findStep(-1);
    if (act === 'one' && find.hits[find.index]) {
      const [a, z] = find.hits[find.index];
      const re = findRe();
      const rep = find.regex && re ? ta.value.slice(a, z).replace(new RegExp(re.source, re.flags.replace('g', '')), fr.value) : fr.value;
      replaceRange(a, z, rep);
      findStep(1);
    }
    if (act === 'all') {
      const re = findRe();
      if (!re) return;
      const next = ta.value.replace(re, find.regex ? fr.value : () => fr.value);
      if (next !== ta.value) replaceRange(0, ta.value.length, next, 0);
      paintFind();
    }
  });

  // ---- keys ----
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); onSave?.(ta.value); return; }
    if (mod && k.toLowerCase() === 'f') { e.preventDefault(); openFind(false); return; }
    if (mod && k.toLowerCase() === 'h') { e.preventDefault(); openFind(true); return; }
    if (mod && k.toLowerCase() === 'g') { e.preventDefault(); const l = prompt(t('Go to line'), String(lineOf(ta.selectionStart))); if (l) goto(...l.split(':')); return; }
    if (k === 'F3') { e.preventDefault(); find.open ? findStep(e.shiftKey ? -1 : 1) : openFind(false); return; }
    if (k === 'Escape' && find.open) { e.preventDefault(); closeFind(); return; }
    // Everything else either belongs to the page (palette, quick open) or edits.
    if (onCommand && mod && (k.toLowerCase() === 'p' || k === '`' || k.toLowerCase() === 'b' || (e.shiftKey && ['f', 'e', 'o'].includes(k.toLowerCase())))) {
      e.preventDefault(); onCommand(e.shiftKey ? `shift+${k.toLowerCase()}` : k.toLowerCase()); return;
    }
    if (readOnly) return;
    if (k === 'Tab') { e.preventDefault(); if (ta.selectionStart !== ta.selectionEnd || e.shiftKey) indentLines(e.shiftKey); else replaceRange(ta.selectionStart, ta.selectionEnd, indentUnit()); return; }
    if (mod && k === '/') { e.preventDefault(); toggleComment(); return; }
    if (mod && k === ']') { e.preventDefault(); indentLines(false); return; }
    if (mod && k === '[') { e.preventDefault(); indentLines(true); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); selectNext(); return; }
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      if (e.shiftKey) duplicateLines(); else moveLines(k === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (mod && e.shiftKey && k.toLowerCase() === 'k') { e.preventDefault(); const [a, b] = selectedLines(); replaceRange(a, Math.min(ta.value.length, b + 1), '', a); return; }
    if (k === 'Enter' && !mod) {
      e.preventDefault();
      const s = ta.selectionStart;
      const ls = lineStart(s);
      const cur = ta.value.slice(ls, s);
      const indent = cur.match(/^\s*/)[0];
      const prevCh = cur.trimEnd().slice(-1);
      const nextCh = ta.value[ta.selectionEnd];
      const opens = '{[('.includes(prevCh) || (lang === 'py' && prevCh === ':');
      if (opens && PAIRS[prevCh] === nextCh) {
        const inner = `\n${indent}${indentUnit()}`;
        replaceRange(s, ta.selectionEnd, `${inner}\n${indent}`, s + inner.length);
      } else replaceRange(s, ta.selectionEnd, `\n${indent}${opens ? indentUnit() : ''}`);
      return;
    }
    if (k === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      const s = ta.selectionStart;
      const a = ta.value[s - 1];
      if (a && PAIRS[a] && PAIRS[a] === ta.value[s]) { e.preventDefault(); replaceRange(s - 1, s + 1, ''); return; }
    }
    if (PAIRS[k] && !mod && !e.altKey) {
      const s = ta.selectionStart;
      const z = ta.selectionEnd;
      if (s !== z) { e.preventDefault(); const inner = ta.value.slice(s, z); replaceRange(s, z, `${k}${inner}${PAIRS[k]}`, s + 1, z + 1); return; }
      // A quote only pairs where a quote could start something.
      const after = ta.value[s] || '';
      const before = ta.value[s - 1] || '';
      if (CLOSERS.has(k) && after === k) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); cursor(); return; }
      if (`"'\``.includes(k) && /[\w$]/.test(before)) return;
      if (!after || /[\s)\]};,]/.test(after)) { e.preventDefault(); replaceRange(s, z, `${k}${PAIRS[k]}`, s + 1); return; }
    }
    if (CLOSERS.has(k) && ta.value[ta.selectionStart] === k && ta.selectionStart === ta.selectionEnd && !mod) {
      e.preventDefault(); ta.setSelectionRange(ta.selectionStart + 1, ta.selectionStart + 1); cursor();
    }
  });
  ta.addEventListener('input', changed);
  ta.addEventListener('scroll', sync, { passive: true });
  ta.addEventListener('keyup', cursor);
  ta.addEventListener('click', cursor);
  ta.addEventListener('select', cursor);
  ta.addEventListener('focus', () => root.classList.add('focus'));
  ta.addEventListener('blur', () => root.classList.remove('focus'));
  paint();

  return {
    el: root,
    textarea: ta,
    getValue: () => ta.value,
    setValue(v, { asClean = true } = {}) { ta.value = v; if (asClean) clean = v; paint(); },
    isDirty: () => ta.value !== clean,
    markClean() { clean = ta.value; onChange?.(ta.value, false); },
    setPath(p) { path = p; lang = languageOf(p); ta.setAttribute('aria-label', `${t('Code editor')}: ${p}`); paint(); },
    setMarkers(list) { markers = Array.isArray(list) ? list : []; paint(); },
    selection: () => ta.value.slice(ta.selectionStart, ta.selectionEnd),
    insert(text) { replaceRange(ta.selectionStart, ta.selectionEnd, text); },
    goto,
    focus: () => ta.focus(),
    openFind,
    language: () => lang,
    scrollState: () => ({ top: ta.scrollTop, left: ta.scrollLeft, start: ta.selectionStart, end: ta.selectionEnd }),
    restoreScroll(s) { if (!s) return; ta.scrollTop = s.top; ta.scrollLeft = s.left; try { ta.setSelectionRange(s.start, s.end); } catch { /* text changed */ } sync(); cursor(); },
  };
}
