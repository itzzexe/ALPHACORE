// Dev Studio — the factory's projects, opened the way an engineer opens them.
//
// The factory page is for looking at a project; this is for working in one.
// Tabs, an explorer, search across the repository, source control with a
// message somebody wrote, a terminal underneath, the review board's findings
// in the gutter, and a pair programmer on the side. Every write still goes
// through the same routes the factory uses, so the studio adds no new way for
// anything to change — only a better place to stand while changing it.
//
// Unsaved work survives navigating away and back (it is held per project in
// this module), and the browser asks before a tab with unsaved files closes.
import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { hasPermC } from '../state/session.js';
import { navGeneration } from '../core/shell.js';
import { t } from '/i18n.js';
import { stateTag, ago, bytes, dur, emptyCta, glyph, GLYPH, kpi, hashParam } from '../components/ui.js';
import { createEditor, languageOf, languageLabel, outline, renderDiff, highlight } from '../components/editor.js';

const sessions = new Map();
const sessionFor = (slug) => {
  if (!sessions.has(slug)) {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(`alphacore-studio-${slug}`) || '{}'); } catch { saved = {}; }
    sessions.set(slug, {
      tabs: Array.isArray(saved.tabs) ? saved.tabs : [], active: saved.active || null, side: saved.side || 'explorer',
      bottomOpen: saved.bottomOpen !== false, collapsed: new Set(saved.collapsed || []),
      buffers: new Map(), history: [], histIdx: -1, liveCommand: null,
    });
  }
  return sessions.get(slug);
};
const persist = (slug, s) => {
  try { sessionStorage.setItem(`alphacore-studio-${slug}`, JSON.stringify({ tabs: s.tabs, active: s.active, side: s.side, bottomOpen: s.bottomOpen, collapsed: [...s.collapsed] })); } catch { /* private window */ }
};
const anyDirty = () => [...sessions.values()].some((s) => [...s.buffers.values()].some((b) => b.value !== b.clean));
let unloadWired = false;

const ICONS = {
  explorer: '<path d="M4 5h6l2 2h8v12H4z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  scm: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3-3 3.6-6 4.2-2.3.4-4.4 1-5.3 2"/>',
  ai: '<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  problems: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  outline: '<path d="M5 6h14M8 10.5h11M8 15h11M5 19.5h14"/>',
};
const SIDES = [['explorer', 'Explorer'], ['search', 'Search'], ['scm', 'Source control'], ['ai', 'AI pair'], ['problems', 'Problems'], ['outline', 'Outline']];
const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${p}</svg>`;
const EXT_TAG = { js: 'JS', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX', jsx: 'JSX', json: '{}', md: 'MD', html: '<>', css: '#', py: 'PY', sql: 'SQL', yml: 'YML', yaml: 'YML', sh: '$', svg: 'SVG', go: 'GO', rs: 'RS' };
const fileTag = (p) => { const e = p.split('.').pop().toLowerCase(); return EXT_TAG[e] || (p.includes('.') ? e.slice(0, 3).toUpperCase() : '·'); };

// ============================================================== landing ==

export async function renderStudio() {
  const { overview: o, projects } = await api('/api/forge');
  const recent = projects.slice(0, 24);
  view.innerHTML = `
  <div class="pg-head">
    <p>${esc(t('An editor for every project in the factory: tabs, search, source control, a terminal, the review board in the gutter and an AI pair programmer — in the browser, with nothing loaded from anywhere else.'))}</p>
    <div class="pg-actions">
      ${hasPermC('forge.manage') ? `<a class="btn" href="#/forge?new=1">＋ ${esc(t('New project'))}</a>` : ''}
      ${hasPermC('github.view') ? `<a class="btn" href="#/github">${esc(t('Clone from GitHub'))}</a>` : ''}
      ${hasPermC('appbuilder.manage') ? `<a class="btn btn-primary" href="#/appbuilder">${esc(t('Build an app from an idea'))}</a>` : ''}
    </div>
  </div>
  <div class="kpis">
    ${kpi('Projects', o.projects, '', '')}
    ${kpi('Changes to review', o.proposed, esc(t('proposed by engineers')), o.proposed ? 'human' : '')}
    ${kpi('Commands today', o.commandsToday, o.failingToday ? `${o.failingToday} ${esc(t('failed'))}` : esc(t('none failed')), o.failingToday ? 'bad' : '')}
    ${kpi('Unsaved here', [...sessions.values()].reduce((a, s) => a + [...s.buffers.values()].filter((b) => b.value !== b.clean).length, 0), esc(t('files across open projects')), '')}
  </div>
  ${recent.length ? `<div class="cards">${recent.map((p) => `
    <a class="card" href="#/studio/${esc(p.slug)}">
      <div class="card-top">${glyph(GLYPH.code)}<div class="card-title">${esc(p.name)}</div>${p.pending ? `<span class="chip chip-warn">${p.pending}</span>` : ''}</div>
      <div class="card-meta">${esc(p.description || p.kind)}</div>
      <div class="card-foot"><span>${p.files} ${esc(t('files'))}</span><span class="mono">${p.lastCommit ? esc(p.lastCommit.sha) : ''}</span></div>
    </a>`).join('')}</div>` : emptyCta('No projects yet', 'Start one in the factory, clone one from GitHub, or let the app builder make one.')}
  <div class="panel" style="margin-top:16px">
    <div class="panel-title">${esc(t('Keyboard'))}</div>
    <div class="st-keys">${[
    ['Ctrl+P', 'Open a file by name'], ['Ctrl+Shift+P', 'Every command'], ['Ctrl+S', 'Save'], ['Ctrl+F / Ctrl+H', 'Find / replace in the file'],
    ['Ctrl+Shift+F', 'Search the repository'], ['Ctrl+G', 'Go to line'], ['Ctrl+/', 'Comment lines'], ['Alt+↑ / Alt+↓', 'Move lines'],
    ['Shift+Alt+↓', 'Duplicate lines'], ['Ctrl+D', 'Select the next match'], ['Ctrl+`', 'Show or hide the terminal'], ['Ctrl+B', 'Show or hide the side bar'],
  ].map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t(d))}</span></div>`).join('')}</div>
  </div>`;
}

// =========================================================== the studio ==

export async function renderStudioProject(slug) {
  const gen = navGeneration;
  const S = sessionFor(slug);
  let p = await api(`/api/forge/${encodeURIComponent(slug)}`);
  if (gen !== navGeneration) return;
  const canM = hasPermC('forge.manage');
  const canRun = hasPermC('forge.run');
  document.getElementById('page-title').textContent = p.name;
  if (!unloadWired) {
    unloadWired = true;
    window.addEventListener('beforeunload', (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });
  }
  // Forget tabs whose files are gone.
  const exists = new Set(p.tree.map((f) => f.path));
  S.tabs = S.tabs.filter((x) => exists.has(x) || S.buffers.has(x));
  if (S.active && !S.tabs.includes(S.active)) S.active = S.tabs[0] || null;
  if (!S.tabs.length) {
    const first = p.tree.find((f) => /^README/i.test(f.path)) || p.tree.find((f) => f.text);
    if (first) { S.tabs = [first.path]; S.active = first.path; }
  }

  let review = null;
  let branch = { current: null, branches: [] };
  const loadReview = async () => {
    if (!hasPermC('reviews.view')) return;
    try {
      const { reviews } = await api(`/api/reviews?project=${encodeURIComponent(slug)}`);
      const last = reviews.find((r) => r.subject === 'project');
      review = last ? await api(`/api/reviews/${last.id}`) : null;
    } catch { review = null; }
  };
  const loadBranches = async () => { try { branch = await api(`/api/forge/${slug}/branches`); } catch { branch = { current: null, branches: [] }; } };
  await Promise.all([loadReview(), loadBranches()]);
  if (gen !== navGeneration) return;

  view.innerHTML = `
  <div class="studio ${S.bottomOpen ? '' : 'no-bottom'} ${S.side ? '' : 'no-side'}" id="st">
    <nav class="st-act" aria-label="${esc(t('Studio views'))}">
      ${SIDES.map(([id, label]) => `<button type="button" data-side="${id}" class="${S.side === id ? 'on' : ''}" aria-label="${esc(t(label))}" title="${esc(t(label))}">${svg(ICONS[id])}<span class="st-badge" data-badge="${id}" hidden></span></button>`).join('')}
      <span class="grow"></span>
      <a href="#/forge/${esc(slug)}" aria-label="${esc(t('Open in the factory'))}" title="${esc(t('Open in the factory'))}">${svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>')}</a>
    </nav>
    <aside class="st-side" aria-label="${esc(t('Side bar'))}">
      <div class="st-side-head"><b id="st-side-title"></b><span class="grow"></span><span id="st-side-tools" class="inline"></span></div>
      <div class="st-side-body" id="st-side" data-keep-scroll></div>
    </aside>
    <section class="st-main">
      <div class="st-tabs" role="tablist" aria-label="${esc(t('Open files'))}" id="st-tabs"></div>
      <div class="st-crumb">
        <span class="mono ltr grow" id="st-path"></span>
        <span class="inline" id="st-file-tools"></span>
      </div>
      <div class="st-center">
        <div id="st-editor" class="st-editor"></div>
        <div id="st-diff" class="st-diffwrap" hidden></div>
        <div id="st-welcome" class="st-welcome" hidden></div>
      </div>
      <div class="st-bottom" id="st-bottom">
        <div class="st-bottom-head">
          <b>${esc(t('Terminal'))}</b><span class="muted">${esc(t('runs in the project folder'))}</span><span class="grow"></span>
          <span class="inline" id="st-quick">${p.scripts.slice(0, 5).map((s) => `<button class="btn btn-sm" type="button" data-quick="${esc(s)}">▶ ${esc(s)}</button>`).join('')}</span>
          <button class="btn btn-sm" type="button" id="st-term-hide" aria-label="${esc(t('Hide the terminal'))}">✕</button>
        </div>
        <div class="term st-term" id="st-term-out" data-keep-scroll>${esc(t('Pick a script, or type a command below.'))}</div>
        ${canRun ? `<form class="term-line" id="st-term-form"><input id="st-term-in" placeholder="npm test" autocomplete="off" aria-label="${esc(t('Command'))}"><button class="btn btn-primary" type="submit">${esc(t('Run'))}</button><button class="btn btn-bad" type="button" id="st-term-kill" hidden>${esc(t('Stop'))}</button></form>` : ''}
      </div>
    </section>
    <footer class="st-status" id="st-status"></footer>
  </div>
  <div class="st-quickopen" id="st-qo" hidden role="dialog" aria-modal="true" aria-label="${esc(t('Quick open'))}">
    <div class="st-qo-box"><input id="st-qo-in" autocomplete="off" aria-label="${esc(t('Type a file name, > for a command, : for a line'))}" placeholder="${esc(t('Type a file name, > for a command, : for a line'))}"><div id="st-qo-list" role="listbox" aria-label="${esc(t('Results'))}"></div></div>
  </div>`;

  // ------------------------------------------------------------ editor --
  let cur = { line: 1, col: 1, selected: 0, lang: 'text', indent: 'Spaces: 2' };
  const ed = createEditor($('#st-editor'), {
    readOnly: !canM,
    onChange: (value) => {
      const b = S.buffers.get(S.active);
      if (b) b.value = value;
      paintTabs(); paintStatus();
      if (S.side === 'outline') paintSide();
    },
    onSave: () => save(S.active),
    onCursor: (c) => { cur = c; paintStatus(); },
    onCommand: (k) => command(k),
  });
  const showPane = (which) => {
    $('#st-editor').hidden = which !== 'editor';
    $('#st-diff').hidden = which !== 'diff';
    $('#st-welcome').hidden = which !== 'welcome';
  };

  const markersFor = (path) => (review?.findings || [])
    .filter((f) => f.state === 'open' && f.file === path && f.line)
    .map((f) => ({ line: f.line, severity: f.severity, title: `${f.severity}: ${f.title}` }));

  async function open(path, { line = null, col = 1 } = {}) {
    if (!path) return;
    const prev = S.buffers.get(S.active);
    if (prev && S.active !== path) prev.scroll = ed.scrollState();
    if (!S.buffers.has(path)) {
      try {
        const f = await api(`/api/forge/${slug}/file?path=${encodeURIComponent(path)}`);
        if (gen !== navGeneration) return;
        S.buffers.set(path, { value: f.binary ? '' : f.content, clean: f.binary ? '' : f.content, binary: f.binary, size: f.size, scroll: null });
      } catch (e) { toast(e.message, true); return; }
    }
    if (!S.tabs.includes(path)) S.tabs.push(path);
    S.active = path;
    persist(slug, S);
    const b = S.buffers.get(path);
    if (b.binary) {
      showPane('welcome');
      $('#st-welcome').innerHTML = `<div class="empty">${esc(t('(binary file — not shown)'))} · ${bytes(b.size)}</div>`;
    } else {
      showPane('editor');
      ed.setPath(path);
      ed.setValue(b.value, { asClean: false });
      ed.setMarkers(markersFor(path));
      if (line) ed.goto(line, col); else ed.restoreScroll(b.scroll);
      ed.focus();
    }
    paintTabs(); paintCrumb(); paintStatus();
    if (S.side === 'explorer' || S.side === 'outline') paintSide();
  }

  async function save(path) {
    if (!canM || !path) return;
    const b = S.buffers.get(path);
    if (!b || b.binary) return;
    if (path === S.active) b.value = ed.getValue();
    try {
      await api(`/api/forge/${slug}/file`, { method: 'POST', body: { path, content: b.value, commit: false } });
      b.clean = b.value;
      toast(`${t('Saved')} · ${path}`);
      paintTabs(); paintStatus();
      refreshProject();
    } catch (e) { toast(e.message, true); }
  }
  const saveAll = async () => { for (const [path, b] of S.buffers) if (b.value !== b.clean) await save(path); };

  function close(path) {
    const b = S.buffers.get(path);
    if (b && b.value !== b.clean && !confirm(`${t('Discard the unsaved changes?')} ${path}`)) return;
    S.buffers.delete(path);
    const i = S.tabs.indexOf(path);
    S.tabs = S.tabs.filter((x) => x !== path);
    if (S.active === path) S.active = S.tabs[Math.max(0, i - 1)] || null;
    persist(slug, S);
    if (S.active) open(S.active); else { showPane('welcome'); paintWelcome(); paintTabs(); paintCrumb(); paintStatus(); }
  }

  async function refreshProject() {
    try { p = await api(`/api/forge/${encodeURIComponent(slug)}`); } catch { return; }
    if (gen !== navGeneration) return;
    paintBadges();
    if (['explorer', 'scm', 'ai'].includes(S.side)) paintSide();
    paintStatus();
  }

  // ------------------------------------------------------------- tabs --
  function paintTabs() {
    $('#st-tabs').innerHTML = S.tabs.map((path) => {
      const b = S.buffers.get(path);
      const dirty = b && b.value !== b.clean;
      return `<div class="st-tab ${path === S.active ? 'on' : ''}" role="tab" aria-selected="${path === S.active}">
        <button type="button" data-tab="${esc(path)}" title="${esc(path)}"><span class="st-ft">${esc(fileTag(path))}</span>${esc(path.split('/').pop())}</button>
        <button type="button" class="st-x ${dirty ? 'dirty' : ''}" data-close="${esc(path)}" aria-label="${esc(t('Close'))} ${esc(path)}">${dirty ? '●' : '✕'}</button>
      </div>`;
    }).join('');
  }
  $('#st-tabs').addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { close(c.dataset.close); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) open(tb.dataset.tab);
  });
  $('#st-tabs').addEventListener('auxclick', (e) => { const tb = e.target.closest('[data-tab]'); if (tb && e.button === 1) close(tb.dataset.tab); });

  function paintCrumb() {
    $('#st-path').innerHTML = S.active ? S.active.split('/').map((x) => esc(x)).join('<span class="muted"> › </span>') : '';
    const has = Boolean(S.active && !S.buffers.get(S.active)?.binary);
    $('#st-file-tools').innerHTML = has ? `
      ${canM ? `<button class="btn btn-sm" type="button" data-ft="save">${esc(t('Save'))}</button>` : ''}
      <button class="btn btn-sm" type="button" data-ft="diff">${esc(t('Changes since last commit'))}</button>
      ${canM ? `<button class="btn btn-sm" type="button" data-ft="ask">✦ ${esc(t('Ask about this'))}</button>` : ''}` : '';
  }
  $('#st-file-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ft]');
    if (!b) return;
    if (b.dataset.ft === 'save') save(S.active);
    if (b.dataset.ft === 'diff') showHeadDiff(S.active);
    if (b.dataset.ft === 'ask') { S.side = 'ai'; persist(slug, S); paintSideFrame(); setTimeout(() => $('#st-ai-q')?.focus(), 30); }
  });

  // ------------------------------------------------------------ status --
  function paintStatus() {
    const dirty = [...S.buffers.values()].filter((b) => b.value !== b.clean).length;
    const open = (review?.findings || []).filter((f) => f.state === 'open');
    const crit = open.filter((f) => ['critical', 'high'].includes(f.severity)).length;
    $('#st-status').innerHTML = `
      <button type="button" data-st="branch" title="${esc(t('Branch'))}">⎇ ${esc(branch.current || 'main')}${p.git.status.length ? ` · ${p.git.status.length}✱` : ''}</button>
      <button type="button" data-st="problems" class="${crit ? 'bad' : ''}">${crit ? '⛔' : '✓'} ${open.length} ${esc(t('problems'))}${review ? ` · ${esc(String(review.verdict || review.state).toUpperCase())} ${review.score ?? ''}` : ''}</button>
      ${dirty ? `<span class="warn">● ${dirty} ${esc(t('unsaved'))}</span>` : ''}
      <span class="grow"></span>
      ${S.active ? `<span>${esc(t('Ln'))} ${cur.line}, ${esc(t('Col'))} ${cur.col}${cur.selected ? ` (${cur.selected} ${esc(t('selected'))})` : ''}</span><span>${esc(cur.indent)}</span><span>UTF-8</span><span>${esc(languageLabel(languageOf(S.active)))}</span>` : ''}
      <button type="button" data-st="terminal">${esc(t('Terminal'))}</button>`;
  }
  $('#st-status').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    if (b.dataset.st === 'branch') { S.side = 'scm'; paintSideFrame(); }
    if (b.dataset.st === 'problems') { S.side = 'problems'; paintSideFrame(); }
    if (b.dataset.st === 'terminal') toggleBottom();
  });

  function paintBadges() {
    const set = (id, n) => { const el = view.querySelector(`[data-badge="${id}"]`); if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); } };
    set('scm', p.git.status.length);
    set('problems', (review?.findings || []).filter((f) => f.state === 'open' && f.severity !== 'info').length);
    set('ai', p.changes.filter((c) => c.state === 'proposed').length);
  }

  // -------------------------------------------------------------- side --
  function paintSideFrame() {
    view.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === S.side));
    $('#st').classList.toggle('no-side', !S.side);
    persist(slug, S);
    paintSide();
  }
  view.querySelector('.st-act').addEventListener('click', (e) => {
    const b = e.target.closest('[data-side]');
    if (!b) return;
    S.side = S.side === b.dataset.side ? null : b.dataset.side;
    paintSideFrame();
  });

  function paintSide() {
    const body = $('#st-side');
    const title = $('#st-side-title');
    const tools = $('#st-side-tools');
    if (!S.side) return;
    title.textContent = t(SIDES.find(([id]) => id === S.side)[1]);
    tools.innerHTML = '';
    ({ explorer: sideExplorer, search: sideSearch, scm: sideScm, ai: sideAi, problems: sideProblems, outline: sideOutline })[S.side](body, tools);
  }

  // ---- explorer ----
  function sideExplorer(body, tools) {
    tools.innerHTML = `${canM ? `<button class="st-ib" type="button" data-ex="new" aria-label="${esc(t('New file'))}" title="${esc(t('New file'))}">＋</button>` : ''}
      <button class="st-ib" type="button" data-ex="refresh" aria-label="${esc(t('Refresh'))}" title="${esc(t('Refresh'))}">⟳</button>
      <button class="st-ib" type="button" data-ex="collapse" aria-label="${esc(t('Collapse all'))}" title="${esc(t('Collapse all'))}">⊟</button>`;
    const status = new Map(p.git.status.map((s) => [s.path.replace(/^"|"$/g, ''), s.code]));
    // Build the tree from the flat list.
    const root = { dirs: new Map(), files: [] };
    for (const f of p.tree) {
      const parts = f.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts.slice(0, i + 1).join('/');
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { key, dirs: new Map(), files: [] });
        node = node.dirs.get(parts[i]);
      }
      node.files.push(f);
    }
    const draw = (node, depth) => [
      ...[...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, d]) => {
        const shut = S.collapsed.has(d.key);
        return `<button type="button" class="st-tr st-dir" data-dir="${esc(d.key)}" aria-expanded="${!shut}" style="--d:${depth}">${shut ? '▸' : '▾'} ${esc(name)}</button>${shut ? '' : draw(d, depth + 1)}`;
      }),
      ...node.files.map((f) => {
        const code = status.get(f.path);
        const dirty = S.buffers.get(f.path) && S.buffers.get(f.path).value !== S.buffers.get(f.path).clean;
        return `<button type="button" class="st-tr ${f.path === S.active ? 'on' : ''}" data-file="${esc(f.path)}" style="--d:${depth}" title="${esc(f.path)} · ${bytes(f.size)}">
          <span class="st-ft">${esc(fileTag(f.path))}</span><span class="grow">${esc(f.path.split('/').pop())}</span>${dirty ? '<i class="st-dot"></i>' : ''}${code ? `<em class="st-git g-${esc(code.replace('?', 'U'))}">${esc(code === '??' ? 'U' : code)}</em>` : ''}</button>`;
      }),
    ].join('');
    body.innerHTML = `<div class="st-tree" role="tree" aria-label="${esc(t('Files'))}">${draw(root, 0) || `<div class="empty">${esc(t('Empty'))}</div>`}</div>
      ${canM ? `<div class="hint" style="padding:8px 12px">${esc(t('Right-click a file to rename or delete it. F2 renames the focused file.'))}</div>` : ''}`;
  }
  $('#st-side-tools').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    if (b.dataset.ex === 'refresh') { await refreshProject(); paintSide(); }
    if (b.dataset.ex === 'collapse') { p.tree.forEach((f) => { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) S.collapsed.add(parts.slice(0, i).join('/')); }); persist(slug, S); paintSide(); }
    if (b.dataset.ex === 'new') newFile();
  });
  async function newFile(dir = '') {
    const path = prompt(t('Path of the new file, e.g. src/routes/users.js'), dir ? `${dir}/` : '');
    if (!path) return;
    try {
      await api(`/api/forge/${slug}/file`, { method: 'POST', body: { path, content: '', commit: false } });
      await refreshProject();
      open(path.replace(/\\/g, '/').replace(/^\.?\/+/, ''));
    } catch (err) { toast(err.message, true); }
  }
  async function renameFile(from) {
    const to = prompt(t('New path'), from);
    if (!to || to === from) return;
    try {
      await api(`/api/forge/${slug}/file/rename`, { method: 'POST', body: { from, to } });
      const b = S.buffers.get(from);
      if (b) { S.buffers.delete(from); S.buffers.set(to, b); }
      S.tabs = S.tabs.map((x) => (x === from ? to : x));
      if (S.active === from) S.active = to;
      persist(slug, S);
      await refreshProject();
      if (S.active === to) open(to);
      paintTabs();
    } catch (err) { toast(err.message, true); }
  }
  async function deleteFile(path) {
    if (!confirm(`${t('Delete')} ${path}?`)) return;
    try {
      await api(`/api/forge/${slug}/file/delete`, { method: 'POST', body: { path } });
      S.buffers.delete(path);
      S.tabs = S.tabs.filter((x) => x !== path);
      if (S.active === path) S.active = S.tabs[0] || null;
      persist(slug, S);
      await refreshProject();
      if (S.active) open(S.active); else { showPane('welcome'); paintWelcome(); paintTabs(); paintCrumb(); }
    } catch (err) { toast(err.message, true); }
  }

  // A small menu where a right-click lands. Keyboard users get F2 and Delete.
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  $('#st-side').addEventListener('contextmenu', (e) => {
    const f = e.target.closest('[data-file], [data-dir]');
    if (!f || !canM) return;
    e.preventDefault();
    closeMenu();
    const path = f.dataset.file || f.dataset.dir;
    const isDir = Boolean(f.dataset.dir);
    menu = document.createElement('div');
    menu.className = 'st-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = isDir
      ? `<button type="button" role="menuitem" data-m="new">${esc(t('New file here'))}</button>`
      : `<button type="button" role="menuitem" data-m="open">${esc(t('Open'))}</button><button type="button" role="menuitem" data-m="rename">${esc(t('Rename'))}</button><button type="button" role="menuitem" data-m="copy">${esc(t('Copy path'))}</button><button type="button" role="menuitem" data-m="explain">✦ ${esc(t('Explain this file'))}</button><button type="button" role="menuitem" data-m="delete" class="bad">${esc(t('Delete'))}</button>`;
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
    document.body.appendChild(menu);
    menu.querySelector('button')?.focus();
    menu.addEventListener('click', (ev) => {
      const m = ev.target.closest('[data-m]')?.dataset.m;
      closeMenu();
      if (m === 'new') newFile(path);
      if (m === 'open') open(path);
      if (m === 'rename') renameFile(path);
      if (m === 'delete') deleteFile(path);
      if (m === 'copy') navigator.clipboard?.writeText(path).then(() => toast(t('Copied')));
      if (m === 'explain') askAi({ mode: 'explain', path, question: '' });
    });
  });
  const onDocClick = (e) => {
    if (gen !== navGeneration) { document.removeEventListener('click', onDocClick, true); return; }
    if (menu && !menu.contains(e.target)) closeMenu();
  };
  document.addEventListener('click', onDocClick, true);
  $('#st-side').addEventListener('click', (e) => {
    const d = e.target.closest('[data-dir]');
    if (d) { const k = d.dataset.dir; if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k); persist(slug, S); paintSide(); return; }
    const f = e.target.closest('[data-file]');
    if (f && S.side === 'explorer') open(f.dataset.file);
  });
  $('#st-side').addEventListener('keydown', (e) => {
    const f = e.target.closest?.('[data-file]');
    if (!f || !canM || S.side !== 'explorer') return;
    if (e.key === 'F2') { e.preventDefault(); renameFile(f.dataset.file); }
    if (e.key === 'Delete') { e.preventDefault(); deleteFile(f.dataset.file); }
  });

  // ---- search ----
  let lastSearch = { q: '', regex: false, cs: false, result: null };
  function sideSearch(body) {
    body.innerHTML = `
      <form class="st-search" id="st-sf">
        <input id="st-sq" value="${esc(lastSearch.q)}" placeholder="${esc(t('Search the repository'))}" aria-label="${esc(t('Search the repository'))}" autocomplete="off">
        <label class="st-chk"><input type="checkbox" id="st-scs" ${lastSearch.cs ? 'checked' : ''}> Aa</label>
        <label class="st-chk"><input type="checkbox" id="st-sre" ${lastSearch.regex ? 'checked' : ''}> .*</label>
      </form>
      <div id="st-sres">${lastSearch.result ? searchHtml(lastSearch.result) : `<div class="hint" style="padding:10px 12px">${esc(t('Press Enter to search every text file.'))}</div>`}</div>`;
    $('#st-sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      lastSearch = { q: $('#st-sq').value, cs: $('#st-scs').checked, regex: $('#st-sre').checked, result: null };
      if (!lastSearch.q) return;
      try {
        lastSearch.result = await api(`/api/forge/${slug}/search?q=${encodeURIComponent(lastSearch.q)}&regex=${lastSearch.regex ? 1 : 0}&case=${lastSearch.cs ? 1 : 0}`);
        $('#st-sres').innerHTML = searchHtml(lastSearch.result);
      } catch (err) { toast(err.message, true); }
    });
    setTimeout(() => $('#st-sq')?.focus(), 10);
  }
  const searchHtml = (r) => {
    if (!r.hits.length) return `<div class="empty">${esc(t('No results'))}</div>`;
    const by = new Map();
    for (const h of r.hits) { if (!by.has(h.path)) by.set(h.path, []); by.get(h.path).push(h); }
    return `<div class="hint" style="padding:6px 12px">${r.hits.length} ${esc(t('results in'))} ${r.files} ${esc(t('files'))}${r.truncated ? ` · ${esc(t('more not shown'))}` : ''}</div>
      ${[...by.entries()].map(([path, hits]) => `<div class="st-sgroup"><div class="st-spath mono ltr">${esc(path)} <span class="muted">${hits.length}</span></div>
        ${hits.map((h) => {
          const before = esc(h.text.slice(Math.max(0, h.col - 1 - 30), h.col - 1));
          const hit = esc(h.text.slice(h.col - 1, h.col - 1 + h.length));
          const after = esc(h.text.slice(h.col - 1 + h.length, h.col - 1 + h.length + 60));
          return `<button type="button" class="st-shit mono ltr" data-goto="${esc(path)}" data-line="${h.line}" data-col="${h.col}"><span class="muted">${h.line}</span> ${before}<mark>${hit}</mark>${after}</button>`;
        }).join('')}</div>`).join('')}`;
  };
  $('#st-side').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) open(g.dataset.goto, { line: Number(g.dataset.line), col: Number(g.dataset.col || 1) });
  });

  // ---- source control ----
  function sideScm(body) {
    const changes = p.git.status;
    body.innerHTML = `
      <div class="st-pad">
        <label class="fl" for="st-br">${esc(t('Branch'))}</label>
        <div class="inline">
          <select id="st-br" class="grow" ${canM ? '' : 'disabled'}>${(branch.branches.length ? branch.branches : [{ name: branch.current || 'main', current: true }]).map((b) => `<option ${b.current ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          ${canM ? `<button class="btn btn-sm" type="button" id="st-nbr">＋ ${esc(t('Branch'))}</button>` : ''}
        </div>
      </div>
      ${canM ? `<form class="st-pad" id="st-commit">
        <label class="fl" for="st-msg">${esc(t('Commit message'))}</label>
        <textarea id="st-msg" rows="3" placeholder="${esc(t('Say what changed and why, as a sentence'))}"></textarea>
        <div class="inline" style="margin-top:6px"><button class="btn btn-primary btn-sm" type="submit" ${changes.length ? '' : 'disabled'}>${esc(t('Commit'))} ${changes.length ? `(${changes.length})` : ''}</button>
        ${[...S.buffers.values()].some((b) => b.value !== b.clean) ? `<span class="hint">${esc(t('Unsaved files are not included — save them first.'))}</span>` : ''}</div>
      </form>` : ''}
      <div class="st-pad"><div class="fl">${esc(t('Changes'))}</div>
        ${changes.length ? changes.map((c) => `<div class="st-chg"><em class="st-git g-${esc(c.code.replace('?', 'U'))}">${esc(c.code === '??' ? 'U' : c.code)}</em>
          <button type="button" class="grow mono ltr st-link" data-hdiff="${esc(c.path)}" title="${esc(t('Show the change'))}">${esc(c.path)}</button>
          ${canM ? `<button type="button" class="st-ib" data-discard="${esc(c.path)}" aria-label="${esc(t('Discard'))} ${esc(c.path)}" title="${esc(t('Discard'))}">↺</button>` : ''}</div>`).join('') : `<div class="hint">${esc(t('Nothing uncommitted.'))}</div>`}
      </div>
      <div class="st-pad"><div class="fl">${esc(t('History'))}</div>
        ${p.git.log.slice(0, 15).map((c) => `<div class="st-log"><span class="mono">${esc(c.sha)}</span> <span>${esc(c.subject)}</span><span class="muted">${esc(ago(c.date))}</span></div>`).join('') || `<div class="hint">${esc(t('No commits yet.'))}</div>`}
      </div>
      ${p.repo_url && hasPermC('github.view') ? `<div class="st-pad"><a class="btn btn-sm" href="#/github">${esc(t('Push and pull on GitHub'))}</a></div>` : ''}`;
    $('#st-br')?.addEventListener('change', async (e) => {
      try { branch = await api(`/api/forge/${slug}/branch`, { method: 'POST', body: { name: e.target.value } }); S.buffers.clear(); await refreshProject(); if (S.active) open(S.active); toast(t('Switched branch')); }
      catch (err) { toast(err.message, true); e.target.value = branch.current; }
    });
    $('#st-nbr')?.addEventListener('click', async () => {
      const name = prompt(t('Name of the new branch'), 'feature/');
      if (!name) return;
      try { branch = await api(`/api/forge/${slug}/branch`, { method: 'POST', body: { name, create: true } }); await refreshProject(); paintSide(); }
      catch (err) { toast(err.message, true); }
    });
    $('#st-commit')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api(`/api/forge/${slug}/commit`, { method: 'POST', body: { message: $('#st-msg').value } }); toast(`${t('Committed')} · ${r.commit}`); await refreshProject(); paintSide(); }
      catch (err) { toast(err.message, true); }
    });
    body.querySelectorAll('[data-hdiff]').forEach((b) => b.addEventListener('click', () => showHeadDiff(b.dataset.hdiff)));
    body.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`${t('Throw away the uncommitted change to')} ${b.dataset.discard}?`)) return;
      try { await api(`/api/forge/${slug}/discard`, { method: 'POST', body: { path: b.dataset.discard } }); S.buffers.delete(b.dataset.discard); await refreshProject(); if (S.active === b.dataset.discard) open(S.active); paintSide(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  async function showHeadDiff(path) {
    if (!path) return;
    try {
      const head = await api(`/api/forge/${slug}/head?path=${encodeURIComponent(path)}`);
      const buf = S.buffers.get(path);
      let now = buf ? (path === S.active ? ed.getValue() : buf.value) : null;
      if (now === null) { try { now = (await api(`/api/forge/${slug}/file?path=${encodeURIComponent(path)}`)).content || ''; } catch { now = ''; } }
      showDiff(`${path} — ${t('last commit → now')}`, head.content, now, path, `<button class="btn btn-sm" type="button" data-dv="edit">${esc(t('Back to the editor'))}</button>`);
    } catch (err) { toast(err.message, true); }
  }
  function showDiff(title, before, after, path, actions = '') {
    const d = renderDiff(before, after, path);
    $('#st-diff').innerHTML = `<div class="st-diffhead"><b class="mono ltr grow">${esc(title)}</b><span class="df-add-n">+${d.added}</span><span class="df-del-n">−${d.removed}</span>${actions}</div>${d.html}`;
    showPane('diff');
  }
  $('#st-diff').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dv]');
    if (!b) return;
    if (b.dataset.dv === 'edit') { if (S.active) open(S.active); else { showPane('welcome'); paintWelcome(); } }
    if (b.dataset.dv === 'apply' || b.dataset.dv === 'reject') {
      try {
        await api(`/api/forge/changes/${b.dataset.change}/${b.dataset.dv}`, { method: 'POST', body: {} });
        toast(t(b.dataset.dv === 'apply' ? 'Applied' : 'Rejected'));
        // Applied files changed on disk; drop clean buffers so they reload.
        for (const [k, v] of S.buffers) if (v.value === v.clean) S.buffers.delete(k);
        await refreshProject();
        if (S.active) open(S.active);
      } catch (err) { toast(err.message, true); }
    }
  });

  // ---- AI pair ----
  let answers = null;
  async function askAi({ mode = 'ask', path = S.active, question = '', selection = null }) {
    S.side = 'ai';
    paintSideFrame();
    try {
      const a = await api(`/api/forge/${slug}/assist`, { method: 'POST', body: { mode, path, question, selection: selection ?? (path === S.active ? ed.selection() : null) } });
      answers = [a, ...(answers || [])];
      paintSide();
      pollAnswer(a.id);
    } catch (err) { toast(err.message, true); }
  }
  function pollAnswer(id) {
    const tick = async () => {
      if (gen !== navGeneration) return;
      const a = await api(`/api/forge/assist/${id}`).catch(() => null);
      if (!a) return;
      if (answers) answers = answers.map((x) => (x.id === id ? a : x));
      if (S.side === 'ai') paintSide();
      if (a.state === 'thinking') setTimeout(tick, 2000);
    };
    setTimeout(tick, 1500);
  }
  function sideAi(body) {
    if (!answers) {
      body.innerHTML = `<div class="empty">${esc(t('Loading…'))}</div>`;
      api(`/api/forge/${slug}/assist`).then((list) => { answers = list; if (S.side === 'ai') paintSide(); list.filter((a) => a.state === 'thinking').forEach((a) => pollAnswer(a.id)); }).catch(() => { answers = []; });
      return;
    }
    const proposed = p.changes.filter((c) => ['proposed', 'drafting'].includes(c.state));
    body.innerHTML = `
      ${canM ? `<form class="st-pad" id="st-ai">
        <div class="inline"><select id="st-ai-mode" aria-label="${esc(t('What kind of help'))}">
          <option value="ask">${esc(t('Ask'))}</option><option value="explain">${esc(t('Explain'))}</option><option value="review">${esc(t('Review'))}</option>
          <option value="tests">${esc(t('Write tests'))}</option><option value="refactor">${esc(t('Refactor'))}</option></select>
          <span class="hint grow">${esc(S.active ? `${t('about')} ${S.active.split('/').pop()}` : t('about the project'))}</span></div>
        <textarea id="st-ai-q" rows="3" placeholder="${esc(t('Ask about the open file or the selected code…'))}" aria-label="${esc(t('Your question'))}"></textarea>
        <div class="inline" style="margin-top:6px"><button class="btn btn-primary btn-sm" type="submit">✦ ${esc(t('Ask the pair programmer'))}</button></div>
        <div class="hint">${esc(t('Answers are advice. Code becomes a file only through a change set you apply.'))}</div>
      </form>
      <form class="st-pad" id="st-chg">
        <label class="fl" for="st-chg-q">${esc(t('Ask an engineer for a change'))}</label>
        <textarea id="st-chg-q" rows="2" placeholder="${esc(t('e.g. Add input validation to every POST route, with tests'))}"></textarea>
        <div class="inline" style="margin-top:6px"><button class="btn btn-sm" type="submit">${esc(t('Request a change set'))}</button></div>
      </form>` : ''}
      ${proposed.length ? `<div class="st-pad"><div class="fl">${esc(t('Change sets'))}</div>${proposed.map((c) => `
        <div class="st-card">
          <div class="inline">${stateTag(c.state)}<b class="grow">${esc(c.prompt.split('\n')[0].slice(0, 90))}</b></div>
          ${c.summary ? `<div class="hint" style="white-space:pre-wrap">${esc(c.summary.slice(0, 400))}</div>` : ''}
          ${c.files.map((f, i) => `<button type="button" class="st-link mono ltr" data-cdiff="${c.id}:${i}">± ${esc(f.path)}</button>`).join('')}
          ${c.state === 'proposed' && canM ? `<div class="inline"><button class="btn btn-sm btn-bad" type="button" data-cact="reject" data-cid="${c.id}">${esc(t('Reject'))}</button><button class="btn btn-sm btn-human" type="button" data-cact="apply" data-cid="${c.id}">${esc(t('Apply & commit'))}</button></div>` : ''}
        </div>`).join('')}</div>` : ''}
      <div class="st-pad">${answers.length ? answers.map((a) => `
        <div class="st-card">
          <div class="inline"><span class="chip">${esc(t(a.mode))}</span><span class="grow hint">${esc(a.path || '')}</span><span class="muted">${esc(ago(a.created_at))}</span></div>
          <div class="st-q">${esc(a.question)}</div>
          ${a.state === 'thinking' ? `<div class="muted">${esc(t('Reading the code…'))}</div>` : `<div class="st-ans">${esc(a.answer || '')}</div>`}
          ${a.code ? `<pre class="st-code ltr" data-no-i18n>${highlight(a.code, languageOf(a.path || ''))}</pre>
            <div class="inline">${canM ? `<button class="btn btn-sm" type="button" data-ains="${a.id}">${esc(t('Insert at cursor'))}</button>` : ''}<button class="btn btn-sm" type="button" data-acopy="${a.id}">${esc(t('Copy'))}</button>${canM ? `<button class="btn btn-sm btn-primary" type="button" data-apropose="${a.id}">${esc(t('Make it a change set'))}</button>` : ''}</div>` : ''}
        </div>`).join('') : `<div class="hint">${esc(t('Nothing asked yet.'))}</div>`}</div>`;
    $('#st-ai')?.addEventListener('submit', (e) => { e.preventDefault(); askAi({ mode: $('#st-ai-mode').value, question: $('#st-ai-q').value }); });
    $('#st-chg')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = $('#st-chg-q').value.trim();
      if (!prompt) return;
      try { await api(`/api/forge/${slug}/ask`, { method: 'POST', body: { prompt } }); toast(t('The engineer is on it')); await refreshProject(); pollChanges(); }
      catch (err) { toast(err.message, true); }
    });
    body.querySelectorAll('[data-cdiff]').forEach((b) => b.addEventListener('click', async () => {
      const [cid, i] = b.dataset.cdiff.split(':');
      const c = p.changes.find((x) => String(x.id) === cid);
      const f = c.files[Number(i)];
      let before = '';
      try { before = (await api(`/api/forge/${slug}/file?path=${encodeURIComponent(f.path)}`)).content || ''; } catch { before = ''; }
      showDiff(`${f.path} — ${t('proposed by')} ${c.agent_id}`, before, f.content, f.path,
        `<button class="btn btn-sm" type="button" data-dv="edit">${esc(t('Back to the editor'))}</button>${c.state === 'proposed' && canM ? `<button class="btn btn-sm btn-bad" type="button" data-dv="reject" data-change="${c.id}">${esc(t('Reject'))}</button><button class="btn btn-sm btn-human" type="button" data-dv="apply" data-change="${c.id}">${esc(t('Apply & commit'))}</button>` : ''}`);
    }));
    body.querySelectorAll('[data-cact]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/forge/changes/${b.dataset.cid}/${b.dataset.cact}`, { method: 'POST', body: {} });
        toast(t(b.dataset.cact === 'apply' ? 'Applied' : 'Rejected'));
        for (const [k, v] of S.buffers) if (v.value === v.clean) S.buffers.delete(k);
        await refreshProject();
        if (S.active) open(S.active);
      } catch (err) { toast(err.message, true); }
    }));
    const byId = (id) => answers.find((a) => String(a.id) === String(id));
    body.querySelectorAll('[data-ains]').forEach((b) => b.addEventListener('click', () => { const a = byId(b.dataset.ains); if (a?.code && S.active) { showPane('editor'); ed.insert(a.code); } }));
    body.querySelectorAll('[data-acopy]').forEach((b) => b.addEventListener('click', () => { const a = byId(b.dataset.acopy); navigator.clipboard?.writeText(a?.code || '').then(() => toast(t('Copied'))); }));
    body.querySelectorAll('[data-apropose]').forEach((b) => b.addEventListener('click', async () => {
      const a = byId(b.dataset.apropose);
      try {
        await api(`/api/forge/${slug}/ask`, { method: 'POST', body: { prompt: `Apply this suggestion${a.path ? ` to ${a.path}` : ''}. Change nothing else.\n\nThe question was: ${a.question}\n\nThe advice:\n${a.answer}\n\nThe code:\n${a.code}` } });
        toast(t('The engineer is on it'));
        await refreshProject();
        pollChanges();
      } catch (err) { toast(err.message, true); }
    }));
  }
  function pollChanges() {
    const tick = async () => {
      if (gen !== navGeneration) return;
      await refreshProject();
      if (p.changes.some((c) => c.state === 'drafting')) setTimeout(tick, 4000);
    };
    setTimeout(tick, 3000);
  }

  // ---- problems ----
  function sideProblems(body) {
    const canRev = hasPermC('reviews.run');
    const open = (review?.findings || []).filter((f) => f.state === 'open');
    body.innerHTML = `
      <div class="st-pad">
        ${review ? `<div class="inline"><span class="chip ${review.verdict === 'fail' ? 'chip-bad' : review.verdict === 'warn' ? 'chip-warn' : 'chip-ok'}">${esc(String(review.verdict || review.state).toUpperCase())} ${review.score ?? ''}</span>
          <a class="grow hint" href="#/reviews/${review.id}">${esc(t('Review'))} #${review.id} · ${esc(ago(review.created_at))}</a></div>` : `<div class="hint">${esc(t('This project has not been reviewed yet.'))}</div>`}
        ${canRev ? `<div class="inline" style="margin-top:8px"><button class="btn btn-sm btn-primary" type="button" id="st-rev">${esc(t('Review now'))}</button>
          ${review && open.some((f) => f.severity !== 'info') && hasPermC('reviews.decide') ? `<button class="btn btn-sm" type="button" id="st-fixall">${esc(t('Fix with an engineer'))}</button>` : ''}</div>` : ''}
      </div>
      <div class="st-pad">${open.length ? open.map((f) => `
        <button type="button" class="st-prob sev-${esc(f.severity)}" ${f.file ? `data-goto="${esc(f.file)}" data-line="${f.line || 1}"` : ''}>
          <span class="st-sev">${esc(f.severity)}</span><span class="grow"><b>${esc(f.title)}</b><span class="hint mono ltr">${esc(f.file || '')}${f.line ? `:${f.line}` : ''} · ${esc(f.dimension)}</span></span>
        </button>`).join('') : (review ? `<div class="hint">${esc(t('No open problems.'))}</div>` : '')}</div>`;
    $('#st-rev')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await api('/api/reviews', { method: 'POST', body: { project: slug, runTests: hasPermC('forge.run') } });
        toast(t('The review board is reading it'));
        review = r;
        const tick = async () => {
          if (gen !== navGeneration) return;
          review = await api(`/api/reviews/${r.id}`).catch(() => review);
          paintBadges(); paintStatus();
          if (S.side === 'problems') paintSide();
          if (S.active) ed.setMarkers(markersFor(S.active));
          if (review.state === 'running') setTimeout(tick, 3000);
        };
        tick();
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    });
    $('#st-fixall')?.addEventListener('click', async () => {
      try { const r = await api(`/api/reviews/${review.id}/fix`, { method: 'POST', body: {} }); toast(`${t('An engineer is fixing')} ${r.findings}`); await refreshProject(); pollChanges(); }
      catch (err) { toast(err.message, true); }
    });
  }

  // ---- outline ----
  function sideOutline(body) {
    if (!S.active) { body.innerHTML = `<div class="empty">${esc(t('Open a file to see its outline.'))}</div>`; return; }
    const items = outline(ed.getValue(), languageOf(S.active));
    body.innerHTML = items.length ? `<div class="st-pad">${items.map((o) => `<button type="button" class="st-tr mono ltr" style="--d:${Math.min(o.depth, 6)}" data-oline="${o.line}"><span class="muted">${o.line}</span> ${esc(o.name)}</button>`).join('')}</div>`
      : `<div class="empty">${esc(t('No functions or headings found in this file.'))}</div>`;
    body.querySelectorAll('[data-oline]').forEach((b) => b.addEventListener('click', () => ed.goto(Number(b.dataset.oline))));
  }

  // ---------------------------------------------------------- welcome --
  function paintWelcome() {
    $('#st-welcome').innerHTML = `<div class="st-welcome-in">
      <h3>${esc(p.name)}</h3><p class="muted">${esc(p.description || p.kindLabel)}</p>
      <div class="st-keys">${[['Ctrl+P', 'Open a file by name'], ['Ctrl+Shift+P', 'Every command'], ['Ctrl+Shift+F', 'Search the repository'], ['Ctrl+`', 'Show or hide the terminal']].map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t(d))}</span></div>`).join('')}</div>
    </div>`;
  }

  // --------------------------------------------------------- terminal --
  function toggleBottom() { S.bottomOpen = !S.bottomOpen; $('#st').classList.toggle('no-bottom', !S.bottomOpen); persist(slug, S); if (S.bottomOpen) $('#st-term-in')?.focus(); }
  $('#st-term-hide').addEventListener('click', toggleBottom);
  const out = $('#st-term-out');
  const showCommand = (id) => {
    S.liveCommand = id;
    const tick = async () => {
      if (gen !== navGeneration || S.liveCommand !== id) return;
      const c = await api(`/api/forge/commands/${id}`).catch(() => null);
      if (!c) return;
      const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 30;
      out.innerHTML = `<span class="t-cmd">$ ${esc(c.command)}</span>\n${esc(c.output || '')}${c.state === 'running' ? '\n▍' : `\n<span class="${c.state === 'ok' ? 't-ok' : 't-bad'}">— ${esc(c.state)} (exit ${c.exit_code ?? '?'}, ${dur(c.duration_ms)})</span>`}`;
      if (atBottom) out.scrollTop = out.scrollHeight;
      const kill = $('#st-term-kill');
      if (kill) { kill.hidden = c.state !== 'running'; kill.onclick = () => api(`/api/forge/commands/${id}/kill`, { method: 'POST', body: {} }).catch((e) => toast(e.message, true)); }
      if (c.state === 'running') setTimeout(tick, 700);
      else if (/test/.test(c.command)) refreshProject();
    };
    tick();
  };
  const runCmd = async (command) => {
    if (!canRun) return;
    if (!S.bottomOpen) toggleBottom();
    S.history = [command, ...S.history.filter((h) => h !== command)].slice(0, 50);
    S.histIdx = -1;
    try { const r = await api(`/api/forge/${slug}/run`, { method: 'POST', body: { command } }); showCommand(r.id); }
    catch (e) { toast(e.message, true); }
  };
  $('#st-term-form')?.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#st-term-in').value.trim(); if (v) { runCmd(v); $('#st-term-in').value = ''; } });
  $('#st-term-in')?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    S.histIdx = Math.max(-1, Math.min(S.history.length - 1, S.histIdx + (e.key === 'ArrowUp' ? 1 : -1)));
    e.target.value = S.histIdx === -1 ? '' : S.history[S.histIdx];
  });
  view.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => runCmd(b.dataset.quick)));
  if (S.liveCommand) showCommand(S.liveCommand); else if (p.commands[0]) showCommand(p.commands[0].id);

  // ------------------------------------------- quick open and commands --
  const COMMANDS = [
    ['Save', 'Ctrl+S', () => save(S.active), canM],
    ['Save all', '', saveAll, canM],
    ['Close the file', '', () => S.active && close(S.active), true],
    ['Find in the file', 'Ctrl+F', () => ed.openFind(false), true],
    ['Replace in the file', 'Ctrl+H', () => ed.openFind(true), canM],
    ['Search the repository', 'Ctrl+Shift+F', () => { S.side = 'search'; paintSideFrame(); }, true],
    ['Go to line', 'Ctrl+G', () => { const l = prompt(t('Go to line')); if (l) ed.goto(...l.split(':')); }, true],
    ['Show the explorer', 'Ctrl+Shift+E', () => { S.side = 'explorer'; paintSideFrame(); }, true],
    ['Show source control', '', () => { S.side = 'scm'; paintSideFrame(); }, true],
    ['Show the outline', 'Ctrl+Shift+O', () => { S.side = 'outline'; paintSideFrame(); }, true],
    ['Show problems', '', () => { S.side = 'problems'; paintSideFrame(); }, true],
    ['Ask the pair programmer', '', () => { S.side = 'ai'; paintSideFrame(); setTimeout(() => $('#st-ai-q')?.focus(), 30); }, canM],
    ['Explain the selection', '', () => askAi({ mode: 'explain' }), canM],
    ['Write tests for this file', '', () => askAi({ mode: 'tests' }), canM],
    ['Show or hide the terminal', 'Ctrl+`', toggleBottom, true],
    ['Show or hide the side bar', 'Ctrl+B', () => { S.side = S.side ? null : 'explorer'; paintSideFrame(); }, true],
    ['Changes since last commit', '', () => showHeadDiff(S.active), true],
    ['New file', '', () => newFile(), canM],
    ...p.scripts.map((s) => [`Run: ${s}`, '', () => runCmd(s), canRun]),
    ['Review this project', '', () => { S.side = 'problems'; paintSideFrame(); setTimeout(() => $('#st-rev')?.click(), 30); }, hasPermC('reviews.run')],
    ['Start the preview', '', async () => { try { await api(`/api/forge/${slug}/preview/start`, { method: 'POST', body: {} }); window.open(p.preview.url, '_blank', 'noopener'); } catch (e) { toast(e.message, true); } }, canRun],
    ['Open in the factory', '', () => { location.hash = `#/forge/${slug}`; }, true],
    ['Deploy', '', () => { location.hash = `#/deploys?project=${p.id}`; }, hasPermC('deploys.manage')],
  ].filter((c) => c[3]);

  let qoItems = [];
  let qoIdx = 0;
  const fuzzy = (needle, hay) => {
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();
    if (!n) return 1;
    let i = 0;
    let score = 0;
    let last = -1;
    for (const ch of n) {
      const j = h.indexOf(ch, last + 1);
      if (j === -1) return 0;
      score += j === last + 1 ? 3 : 1;
      if (j === h.lastIndexOf('/') + 1) score += 2;
      last = j;
      i += 1;
    }
    return score + (h.endsWith(n) ? 5 : 0) - h.length / 100;
  };
  function qoFilter() {
    const v = $('#st-qo-in').value;
    if (v.startsWith('>')) {
      const n = v.slice(1).trim();
      qoItems = COMMANDS.map((c) => ({ label: t(c[0]), hint: c[1], run: c[2], s: fuzzy(n, t(c[0])) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    } else if (v.startsWith(':')) {
      const [l, c] = v.slice(1).split(':');
      qoItems = [{ label: `${t('Go to line')} ${l || ''}${c ? `:${c}` : ''}`, hint: '', run: () => ed.goto(Number(l) || 1, Number(c) || 1) }];
    } else {
      qoItems = p.tree.filter((f) => f.text).map((f) => ({ label: f.path, hint: bytes(f.size), run: () => open(f.path), s: fuzzy(v, f.path) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60);
    }
    qoIdx = 0;
    paintQo();
  }
  function paintQo() {
    $('#st-qo-list').innerHTML = qoItems.map((x, i) => `<button type="button" role="option" aria-selected="${i === qoIdx}" class="${i === qoIdx ? 'on' : ''}" data-qo="${i}"><span class="${x.label.includes('/') || x.label.includes('.') ? 'mono ltr' : ''}">${esc(x.label)}</span><span class="muted">${esc(x.hint || '')}</span></button>`).join('') || `<div class="empty">${esc(t('No results'))}</div>`;
    $('#st-qo-list').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function openQo(prefix = '') {
    $('#st-qo').hidden = false;
    const inp = $('#st-qo-in');
    inp.value = prefix;
    qoFilter();
    inp.focus();
  }
  const closeQo = () => { $('#st-qo').hidden = true; if (S.active) ed.focus(); };
  $('#st-qo-in').addEventListener('input', qoFilter);
  $('#st-qo-in').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); qoIdx = Math.min(qoItems.length - 1, qoIdx + 1); paintQo(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); qoIdx = Math.max(0, qoIdx - 1); paintQo(); }
    if (e.key === 'Escape') { e.preventDefault(); closeQo(); }
    if (e.key === 'Enter') { e.preventDefault(); const it = qoItems[qoIdx]; closeQo(); it?.run(); }
  });
  $('#st-qo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-qo]');
    if (b) { const it = qoItems[Number(b.dataset.qo)]; closeQo(); it?.run(); return; }
    if (e.target.id === 'st-qo') closeQo();
  });

  function command(k) {
    if (k === 'p') openQo('');
    else if (k === 'shift+p') openQo('>');
    else if (k === '`') toggleBottom();
    else if (k === 'b') { S.side = S.side ? null : 'explorer'; paintSideFrame(); }
    else if (k === 'shift+f') { S.side = 'search'; paintSideFrame(); }
    else if (k === 'shift+e') { S.side = 'explorer'; paintSideFrame(); }
    else if (k === 'shift+o') { S.side = 'outline'; paintSideFrame(); }
  }
  // The same keys work when the focus is not in the editor. Removed the
  // moment this page is no longer the one on screen.
  const onKey = (e) => {
    if (gen !== navGeneration || !document.getElementById('st')) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('.ed')) return; // the editor handles its own
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(S.active); return; }
    if (k === 'p' || k === '`' || k === 'b' || (e.shiftKey && ['f', 'e', 'o'].includes(k))) { e.preventDefault(); command(e.shiftKey ? `shift+${k}` : k); }
  };
  document.addEventListener('keydown', onKey);

  // -------------------------------------------------------------- go --
  paintSideFrame();
  paintBadges();
  paintTabs();
  paintCrumb();
  paintStatus();
  // A link from a finding or a search lands on the line it names.
  const deep = hashParam('file');
  if (deep && exists.has(deep)) await open(deep, { line: Number(hashParam('line')) || null });
  else if (S.active) await open(S.active); else { showPane('welcome'); paintWelcome(); }
  if (p.changes.some((c) => c.state === 'drafting')) pollChanges();
}
