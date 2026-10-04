// The small parts the new pages are built from. Each one returns HTML and
// takes plain values, so a page reads as a description of what is on it.
import { esc } from '../core/dom.js';
import { t } from '/i18n.js';

/** A figure with a label. `tone` is ai | human | ok | bad, or nothing. */
export const kpi = (label, value, sub = '', tone = '', href = null) => {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="kpi ${tone}"${href ? ` href="${esc(href)}"` : ''}>
    <div class="k-label">${esc(t(label))}</div>
    <div class="k-val">${value ?? '—'}</div>
    ${sub ? `<div class="k-sub">${sub}</div>` : ''}
  </${tag}>`;
};

export const dot = (state) => `<span class="dot ${esc(state || '')}" aria-hidden="true"></span>`;
export const stateTag = (s) => `<span class="state state-${esc(s)}">${esc(t(String(s || '').replace(/_/g, ' ')))}</span>`;

/** Who did something: a machine is a square, a person a circle, the platform grey. */
export function who(actor) {
  const a = String(actor || '');
  const name = a.replace(/^(human|agent|system):/, '');
  if (a.startsWith('human:')) return `<span class="who-human" title="${esc(name)}">${esc(name.slice(0, 2).toUpperCase())}</span>`;
  if (a.startsWith('agent:') || /^AGT-/.test(name)) return `<span class="who-ai" title="${esc(name)}">AI</span>`;
  return `<span class="who-sys" title="${esc(name)}">⚙</span>`;
}

/** A thin bar with a label and a figure. */
export function bar(label, pct, { warn = 75, bad = 90, suffix = '%' } = {}) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return `<div class="bar2"><div class="b-top"><span>${esc(t(label))}</span><b>—</b></div><div class="b-track"></div></div>`;
  }
  const v = Math.max(0, Math.min(100, Number(pct)));
  return `<div class="bar2"><div class="b-top"><span>${esc(t(label))}</span><b>${Math.round(Number(pct) * 10) / 10}${suffix}</b></div>
    <div class="b-track"><div class="b-fill ${v >= bad ? 'bad' : v >= warn ? 'warn' : ''}" style="width:${v}%"></div></div></div>`;
}

/** Twenty-four hours of a check, one cell per hour. */
export const strip = (cells = []) => `<div class="strip" role="img" aria-label="${esc(t('Last 24 hours'))}">${cells.map((c) => `<i class="${esc(c.state)}" title="${esc(c.hour)}:00 — ${esc(t(c.state))}"></i>`).join('')}</div>`;

/** A sparkline from a list of numbers. */
export function spark(values = [], { max = null } = {}) {
  const vs = values.map((v) => (v == null ? null : Number(v)));
  const real = vs.filter((v) => v != null);
  if (real.length < 2) return '<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"></svg>';
  const top = max ?? Math.max(...real, 1);
  const step = 100 / (vs.length - 1);
  const pts = vs.map((v, i) => [i * step, 28 - ((v ?? 0) / top) * 26]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${line} L100 30 L0 30 Z"/><path class="line" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
}

/** An empty state that says what to do, with the button to do it. */
export const emptyCta = (title, body, action = '') => `<div class="empty-cta"><h3>${esc(t(title))}</h3><p>${esc(t(body))}</p>${action}</div>`;

/** Segmented tabs; the page wires the clicks. */
export const tabs = (items, current, attr = 'data-tab') => `<div class="tabs" role="tablist">${items.map(([id, label, n]) =>
  `<button type="button" role="tab" ${attr}="${esc(id)}" class="${id === current ? 'on' : ''}" aria-selected="${id === current}">${esc(t(label))}${n != null && n !== '' ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;

export const glyph = (paths) => `<span class="glyph" aria-hidden="true"><svg viewBox="0 0 24 24">${paths}</svg></span>`;
export const GLYPH = {
  code: '<path d="M8 6l-5 6 5 6"/><path d="M16 6l5 6-5 6"/>',
  site: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  rocket: '<path d="M12 3c3 2 5 5.5 5 9.5L14.5 15h-5L7 12.5C7 8.5 9 5 12 3z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 15 8 20l4-2 4 2-1.5-5"/>',
  pulse: '<path d="M3 12h4l2.5 6 5-14 2.5 8h4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
};

/** "3 minutes ago" from an SQLite or ISO timestamp, in either language. */
export function ago(ts) {
  if (!ts) return '—';
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${String(ts).replace(' ', 'T')}Z`);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(s)) return esc(ts);
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(-s, 'second');
  if (abs < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

export const bytes = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const dur = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);

/** Read ?key=value from the current hash. */
export function hashParam(key) {
  const q = location.hash.split('?')[1] || '';
  return new URLSearchParams(q).get(key);
}

/** Wire every [data-act] button in a root: POST, toast, rerender. */
export function wireActs(root, api, toast, rerender) {
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    let spec;
    try { spec = JSON.parse(b.dataset.act); } catch { return; }
    if (spec.confirm && !window.confirm(t(spec.confirm))) return;
    b.disabled = true;
    try {
      await api(spec.path, { method: 'POST', body: spec.body || {} });
      if (spec.done) toast(t(spec.done));
      rerender();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
export const act = (path, label, { body = {}, cls = 'btn-sm', confirm = null, done = null } = {}) =>
  `<button type="button" class="btn ${cls}" data-act='${esc(JSON.stringify({ path, body, confirm, done }))}'>${esc(t(label))}</button>`;
