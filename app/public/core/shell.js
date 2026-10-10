// The shell: the sidebar, the phone drawer, the palette, and the router that
// decides what fills the page.
//
// Navigation and routing are one module because they are one loop. The router
// asks the shell which item to light; the shell asks the router where it is.
//
// Everything drawn here comes from the catalogue the server serves, so a new
// department appears in the sidebar and the palette the moment it is declared.
// There is no list of departments in this file to forget to update — only the
// order the groups are shown in, and an icon for each.

import { $, esc, view } from './dom.js';
import { TOKEN_KEY, currentUser, hasPermC, navPerm } from '../state/session.js';
import { api } from '../services/api.js';
import { isNew, markSeen, newMark, openOnce } from '../components/whatsnew.js';
import { routes } from '../router/registry.js';
import { t, lang, setLang, applyLang, translateDom, sectionName, divisionName } from '/i18n.js';

/* ---------- the groups ----------
   A hundred and seventy departments is the right number for a company and the
   wrong number for a menu. The sidebar carries what somebody is trying to do;
   every department keeps its page and its route, and sits behind exactly one
   group — checked by the launch audit, because a mapping that can rot will. */
export const SURFACE_ORDER = ['ask', 'engineering', 'ship', 'work', 'approvals', 'company', 'intelligence', 'money', 'people', 'world'];
export const CORE2_SURFACE_ORDER = ['e-people', 'e-time', 'e-money', 'e-records', 'e-ops', 'e-seam'];
const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  mywork: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  waiting: '<path d="M5 4.5h14v15l-7-3.2-7 3.2z"/><path d="M9 10.2l2.2 2.2 4-4.2"/>',
  ask: '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.3a2.7 2.7 0 015.2.9c0 1.8-2.6 2.2-2.6 4"/><path d="M12 17.2v.2"/>',
  engineering: '<path d="M8 4l-5 8 5 8"/><path d="M16 4l5 8-5 8"/><path d="M13.5 4.5l-3 15"/>',
  ship: '<path d="M12 3c3.5 2.5 5 6 5 10l-2.5 3h-5L7 13c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16l-2 4.5 3-1.5M14.5 16l2 4.5-3-1.5"/>',
  work: '<path d="M3.5 7.5h17v11h-17z"/><path d="M9 7.5V5.6c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v1.9"/><path d="M3.5 12h17"/>',
  approvals: '<path d="M12 3v18M5 7h14"/><path d="M5 7l-2.5 6h5zM19 7l-2.5 6h5z"/>',
  company: '<path d="M4 20V6.5l7-3 7 3V20"/><path d="M8 20v-4.5h6V20"/><path d="M8 9h2M14 9h2M8 12.5h2M14 12.5h2"/>',
  intelligence: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L20.5 20.5"/><path d="M7.6 10.5h5.8M10.5 7.6v5.8"/>',
  money: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.7-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5S14.5 18.4 12 20.5c-2.5-2.1-3.8-5.4-3.8-8.5S9.5 6.1 12 3.5z"/>',
  'e-people': '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
  'e-time': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/>',
  'e-money': '<path d="M3.5 7.5h17v10h-17z"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6.5 12.5h.01M17.5 12.5h.01"/>',
  'e-records': '<path d="M6 3.5h9l4 4V20a.5.5 0 01-.5.5h-12A.5.5 0 016 20z"/><path d="M14.5 3.5v4.5H19"/><path d="M9 12.5h6M9 16h4"/>',
  'e-ops': '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M3 12h4M17 12h4"/>',
  'e-seam': '<circle cx="6.5" cy="12" r="3"/><circle cx="17.5" cy="12" r="3"/><path d="M9.5 12h5"/>',
  all: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  atlas: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
};
const ico = (id) => `<svg class="sx-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[id] || ICON.all}</svg>`;
const CHEV = '<svg class="sx-chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

export const SURFACE_LABEL = {
  ask: 'Ask AlphaCore', engineering: 'Engineering', ship: 'Ship & run', work: 'Work', approvals: 'Decisions & gates', company: 'Company',
  intelligence: 'Intelligence', money: 'Money', people: 'People', world: 'World',
  all: 'All departments',
  'e-people': 'People & HR', 'e-time': 'Time & attendance', 'e-money': 'Payroll & spending', 'e-ops': 'Operations',
  'e-records': 'Documents & records', 'e-seam': 'The seam',
};

export let CATALOG = { sections: [], divisions: [], surfaces: [] };
export const routeOf = (href) => String(href || '').replace(/^#\//, '').split('/')[0];
const visibleSections = () => CATALOG.sections.filter((s) => {
  const perm = navPerm[routeOf(s.href)];
  return !perm || hasPermC(perm);
});
let SURFACE_OF = new Map();
function indexSurfaces() {
  SURFACE_OF = new Map();
  for (const s of CATALOG.surfaces || []) for (const d of s.departments || []) SURFACE_OF.set(d.id, s.id);
}
const surfaceOfSection = (id) => SURFACE_OF.get(id) || null;
const sectionsIn = (surfaceId) => visibleSections().filter((s) => surfaceOfSection(s.id) === surfaceId);

/* ---------- which groups are open ----------
   Remembered per browser. The group holding the page you are on always opens,
   so following a link never lands you somewhere the menu does not show. */
const OPEN_KEY = 'alphacore-open-groups';
const readOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '["engineering"]')); } catch { return new Set(['engineering']); } };
let openGroups = readOpen();
const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openGroups])); } catch { /* private window */ } };
// A browser that remembered its groups from before a release would keep the
// new one shut, and the new places would be there and unfound.
openOnce(openGroups, saveOpen);

function groupHtml(id) {
  const list = sectionsIn(id);
  if (!list.length) return '';
  const label = t(SURFACE_LABEL[id] || id);
  return `<details class="sx-group" data-group="${id}" ${openGroups.has(id) ? 'open' : ''}>
    <summary data-div="${id}" title="${esc(label)}">${ico(id)}<span class="sx-label">${esc(label)}</span>${list.some((s) => isNew(routeOf(s.href))) ? `<span class="sx-new" data-group-new>${esc(t('New'))}</span>` : ''}<span class="sx-badge rail-dot"></span>${CHEV}</summary>
    <div class="sx-sub">
      ${list.map((s) => `<a href="${s.href}" data-route="${routeOf(s.href)}"><span>${esc(sectionName(s.id, s.label))}${newMark(routeOf(s.href))}</span><span class="n">${s.count ?? ''}</span></a>`).join('')}
      <a class="sx-all" href="#/s/${id}"><span>${esc(t('Overview of this group'))}</span></a>
    </div>
  </details>`;
}

function buildNav() {
  const host = $('#sx-nav');
  if (!host) return;
  indexSurfaces();
  const item = (href, id, label, badge = '', extra = '') => `<a class="sx-item" href="${href}" data-nav="${id}" ${extra} title="${esc(label)}">${ico(id)}<span class="sx-label">${esc(label)}</span>${badge}</a>`;
  const core1 = SURFACE_ORDER.filter((id) => id !== 'ask').map(groupHtml).join('');
  const core2 = CORE2_SURFACE_ORDER.map(groupHtml).join('');
  host.innerHTML = `
    ${item('#/', 'home', t('Home'))}
    ${item('#/approvals', 'waiting', t('Waiting on you'), '<span class="sx-badge" id="nav-waiting"></span>', 'data-div="approvals-top"')}
    ${item('#/ask', 'ask', t('Ask the company'))}
    ${item('#/mywork', 'mywork', t('My work'), '<span class="sx-badge ai" id="nav-mywork"></span>')}
    ${core1 ? `<div class="sx-sec"><span>${esc(t('AI core'))}</span></div>${core1}` : ''}
    ${core2 ? `<div class="sx-sec enterprise"><span>${esc(t('Enterprise core'))}</span></div>${core2}` : ''}
    <div class="sx-sec"><span>${esc(t('Everything'))}</span></div>
    ${item('#/departments', 'all', t('All departments'))}
    ${item('#/atlas', 'atlas', t('Company map'))}`;
  host.querySelectorAll('details.sx-group').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) openGroups.add(d.dataset.group); else openGroups.delete(d.dataset.group);
    saveOpen();
  }));
  markActiveNav();
}

/* ---------- the phone ----------
   Below the breakpoint the sidebar slides in as a drawer and a bar at the
   bottom of the screen takes over: home, what is waiting, search, the menu. */
const onPhone = () => window.matchMedia('(max-width: 900px)').matches;
function openDrawer() {
  $('#app').classList.add('drawer');
  $('#tab-nav')?.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  $('#app').classList.remove('drawer');
  $('#tab-nav')?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
function initMobileNav() {
  $('#nav-scrim')?.addEventListener('click', closeDrawer);
  const toggle = () => ($('#app').classList.contains('drawer') ? closeDrawer() : openDrawer());
  $('#tab-nav')?.addEventListener('click', toggle);
  $('#tab-menu')?.addEventListener('click', toggle);
  $('#tab-search')?.addEventListener('click', () => { closeDrawer(); openPalette(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#app').classList.contains('drawer')) { closeDrawer(); e.stopPropagation(); }
  }, true);
  window.matchMedia('(max-width: 900px)').addEventListener('change', closeDrawer);
}

/* ---------- collapsing ----------
   On a desktop the sidebar folds to its icons and remembers that it did. */
function applyCollapsed(on) {
  $('#app')?.classList.toggle('collapsed', on);
  document.documentElement.classList.toggle('side-collapsed', on);
  const b = $('#side-collapse');
  if (b) { b.setAttribute('aria-label', t(on ? 'Expand the sidebar' : 'Collapse the sidebar')); b.title = t(on ? 'Expand' : 'Collapse'); }
}

function markActiveNav() {
  const { key } = currentRoute();
  const navKey = { '': 'home', approvals: 'waiting', ask: 'ask', mywork: 'mywork', departments: 'all', atlas: 'atlas' }[key];
  document.querySelectorAll('#sx-nav .sx-item').forEach((a) => {
    const on = a.dataset.nav === navKey;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Detail pages light their department: a project lights the factory.
  const deptKey = { forgeProject: 'forge', studioProject: 'studio', review: 'reviews', appBuild: 'appbuilder', server: 'servers', deployTarget: 'deploys', decision: 'decisions', journey: 'journeys', request: 'requests', workstream: 'workstreams', system: 'systems' }[key] || key;
  let litGroup = null;
  document.querySelectorAll('#sx-nav .sx-sub a[data-route]').forEach((a) => {
    const on = a.dataset.route === deptKey && !navKey;
    a.classList.toggle('on', on);
    if (on) { a.setAttribute('aria-current', 'page'); litGroup = a.closest('details'); } else a.removeAttribute('aria-current');
  });
  if (litGroup && !litGroup.open) litGroup.open = true;
  document.querySelectorAll('.sx-tab[data-tab]').forEach((tab) => tab.classList.toggle('on', (tab.dataset.tab === 'home' && key === '') || (tab.dataset.tab === 'approvals' && key === 'approvals')));
}

/** The line above the title: which group and which core a page belongs to. */
function paintCrumb(key, sec) {
  const host = $('#sx-crumb');
  if (!host) return;
  const surface = sec ? surfaceOfSection(sec.id) : null;
  const core = surface && (CATALOG.surfaces || []).find((s) => s.id === surface)?.core;
  const parent = { forgeProject: ['#/forge', 'Software factory'], server: ['#/servers', 'Servers'], deployTarget: ['#/deploys', 'Deployments'], studioProject: ['#/studio', 'Dev Studio'], review: ['#/reviews', 'Review board'], appBuild: ['#/appbuilder', 'App builder'] }[key];
  host.innerHTML = [
    core ? `<span>${esc(t(core === 'core2' ? 'Enterprise core' : 'AI core'))}</span>` : '',
    surface ? `<a href="#/s/${esc(surface)}">${esc(t(SURFACE_LABEL[surface] || surface))}</a>` : '',
    parent ? `<a href="${parent[0]}">${esc(sectionName(parent[0].slice(2), t(parent[1])))}</a>` : '',
  ].filter(Boolean).join('<span aria-hidden="true">›</span>');
}

export async function loadCatalog() {
  try {
    const map = await api('/api/map');
    CATALOG = { sections: map.sections, divisions: map.divisions, surfaces: map.surfaces || [], edges: map.edges || [], enterprise: map.core2 || map.enterprise || null };
  } catch {
    // A user without dashboard.view still needs to move around.
    const flat = Object.keys(navPerm).filter((k) => k).map((k) => ({ id: k, label: k, division: 'govern', href: `#/${k}`, count: '' }));
    CATALOG = { sections: flat, divisions: [], surfaces: [{ id: 'company', core: 'core1', label: 'Company', departments: flat }] };
  }
  buildNav();
}

// ---------- command palette ----------
/* Departments, a handful of actions, and — always last — "ask the company",
   so typing a question and pressing Enter does what it says. */
let palIndex = 0;
let palHits = [];
const ACTIONS = [
  { label: 'New software project', href: '#/forge?new=1', kind: 'Create', perm: 'forge.manage' },
  { label: 'Build an app from an idea', href: '#/appbuilder', kind: 'Create', perm: 'appbuilder.manage' },
  { label: 'Review a project', href: '#/reviews', kind: 'Create', perm: 'reviews.run' },
  { label: 'Open Dev Studio', href: '#/studio', kind: 'Go', perm: 'forge.view' },
  { label: 'Build a website', href: '#/sites?new=1', kind: 'Create', perm: 'sites.manage' },
  { label: 'Add a server', href: '#/servers?new=1', kind: 'Create', perm: 'servers.manage' },
  { label: 'Watch a site or server', href: '#/monitors?new=1', kind: 'Create', perm: 'monitors.manage' },
  { label: 'Plan work for the team', href: '#/crew?plan=1', kind: 'Create', perm: 'crew.manage' },
  { label: 'Everything waiting on me', href: '#/approvals', kind: 'Go' },
  { label: 'My work', href: '#/mywork', kind: 'Go' },
];
function openPalette() {
  const p = $('#palette');
  p.hidden = false;
  const input = $('#pal-input');
  input.value = '';
  input.focus();
  palFilter('');
}
function closePalette() { $('#palette').hidden = true; }
function go(hit) {
  closePalette();
  if (hit.ask) {
    try { sessionStorage.setItem('alphacore-ask', hit.ask); } catch { /* fine */ }
    if (location.hash === '#/ask') navigate(); else location.hash = '#/ask';
    return;
  }
  location.hash = hit.href;
}
function palFilter(qv) {
  const q = qv.trim().toLowerCase();
  const depts = visibleSections().map((s) => ({ href: s.href, title: sectionName(s.id, s.label), sub: t(SURFACE_LABEL[surfaceOfSection(s.id)] || ''), hay: `${s.label} ${sectionName(s.id, '')} ${s.id} ${s.hint || ''}`.toLowerCase() }));
  const acts = ACTIONS.filter((a) => !a.perm || hasPermC(a.perm)).map((a) => ({ href: a.href, title: t(a.label), sub: t(a.kind), hay: `${a.label} ${t(a.label)}`.toLowerCase() }));
  const pool = [...acts, ...depts];
  palHits = (!q ? pool : pool.filter((x) => x.hay.includes(q))).slice(0, 30);
  if (q.length > 2) palHits.push({ ask: qv.trim(), title: `${t('Ask the company')}: “${qv.trim()}”`, sub: t('Ask') });
  palIndex = 0;
  const list = $('#pal-list');
  list.innerHTML = palHits.length ? palHits.map((s, i) => `
    <div class="pal-item ${i === 0 ? 'sel' : ''} ${s.ask ? 'ask' : ''}" data-i="${i}" role="option">
      <span class="pal-title">${esc(s.title)}</span>
      <span class="pal-kind">${esc(s.sub || '')}</span>
    </div>`).join('') : `<div class="pal-empty empty">${esc(t('Nothing found'))}</div>`;
  list.querySelectorAll('.pal-item').forEach((el) => el.addEventListener('click', () => go(palHits[Number(el.dataset.i)])));
}
function palMove(step) {
  if (!palHits.length) return;
  palIndex = (palIndex + step + palHits.length) % palHits.length;
  const items = [...document.querySelectorAll('.pal-item')];
  items.forEach((el, i) => el.classList.toggle('sel', i === palIndex));
  items[palIndex]?.scrollIntoView({ block: 'nearest' });
}

export function initShell() {
  initMobileNav();
  let collapsed = false;
  try { collapsed = localStorage.getItem('alphacore-side') === 'collapsed'; } catch { /* default */ }
  applyCollapsed(collapsed && !onPhone());
  $('#side-collapse')?.addEventListener('click', () => {
    const next = !$('#app').classList.contains('collapsed');
    try { localStorage.setItem('alphacore-side', next ? 'collapsed' : 'open'); } catch { /* fine */ }
    applyCollapsed(next);
  });
  $('#open-palette')?.addEventListener('click', openPalette);
  $('#pal-input')?.addEventListener('input', (e) => palFilter(e.target.value));
  $('#palette')?.addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ($('#palette').hidden) return;
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
    else if (e.key === 'Enter') { const h = palHits[palIndex]; if (h) go(h); }
  });

  // Day and night. A stored choice wins; without one the page follows the
  // operating system — decided in index.html before the first paint.
  const applyTheme = (skin) => {
    document.documentElement.dataset.theme = skin;
    for (const btn of [$('#theme-toggle'), $('#login-theme')]) {
      if (!btn) continue;
      btn.setAttribute('aria-pressed', skin === 'dark' ? 'true' : 'false');
      btn.title = skin === 'dark' ? t('Back to daylight') : t('After dark');
    }
    document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
  };
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const flipTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('alphacore-theme', next); } catch { /* private window */ }
    applyTheme(next);
  };
  $('#theme-toggle')?.addEventListener('click', flipTheme);
  $('#login-theme')?.addEventListener('click', flipTheme);

  const flipLang = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
    location.reload(); // renderers bake their language in at build time
  };
  $('#lang-toggle')?.addEventListener('click', flipLang);
  $('#login-lang')?.addEventListener('click', flipLang);
  if ($('#lang-toggle')) $('#lang-toggle').textContent = lang === 'ar' ? 'EN' : 'ع';

  // The account button opens a small menu rather than signing out on a single
  // click — the old behaviour lost more than one afternoon's form.
  $('#who-chip')?.addEventListener('click', () => {
    const existing = $('#who-menu');
    if (existing) { existing.remove(); return; }
    const m = document.createElement('div');
    m.id = 'who-menu';
    m.className = 'panel';
    m.setAttribute('role', 'menu');
    m.style.cssText = 'position:fixed;bottom:64px;inset-inline-start:12px;z-index:60;min-width:220px;padding:8px;display:grid;gap:2px';
    m.innerHTML = `
      <a class="btn btn-ghost" style="justify-content:flex-start" href="#/mywork" role="menuitem">${esc(t('My work'))}</a>
      <a class="btn btn-ghost" style="justify-content:flex-start" href="#/me" role="menuitem">${esc(t('My workspace'))}</a>
      <a class="btn btn-ghost" style="justify-content:flex-start" href="#/settings" role="menuitem">${esc(t('Settings'))}</a>
      <button class="btn btn-ghost" style="justify-content:flex-start;color:var(--sx-bad)" id="who-out" type="button" role="menuitem">${esc(t('Sign out'))}</button>`;
    document.body.appendChild(m);
    const close = (e) => { if (!m.contains(e.target) && e.target.closest('#who-chip') === null) { m.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true));
    m.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => m.remove()));
    $('#who-out').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* session gone anyway */ }
      localStorage.removeItem(TOKEN_KEY);
      location.reload();
    });
  });
  applyLang();
}

// ---------- router ----------
let pollTimer = null;
/* ---------- the eight subsystems that had an API and no way in ----------
   Each was built, tested and reachable only by curl. In a design whose whole
   claim is that the map is the company, a department nobody can open does not
   exist — so these are pages, not panels bolted onto Settings. */
// ---------- auto-refresh guard ----------
// Live pages re-render themselves on a timer, which replaces the whole view.
// That must never happen while someone is filling a form: it would steal
// focus and wipe what they typed. Polling pauses whenever a field is focused
// or holds unsaved input, and resumes by itself once the form is clean.
function isEditingField() {
  const el = document.activeElement;
  if (!el || !view.contains(el)) return false;
  return el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
function hasUnsavedInput() {
  for (const el of view.querySelectorAll('input, textarea')) {
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
    else if (el.value !== el.defaultValue) return true;
  }
  for (const el of view.querySelectorAll('select')) {
    for (const o of el.options) if (o.selected !== o.defaultSelected) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Keeping your place.
//
// Ninety-six pages refresh themselves on a timer, and the guard below used to
// protect only somebody *typing*. Reading was not protected at all: you would
// scroll up through a conversation and the page would rebuild underneath you,
// throwing you back to the top mid-sentence. On a page whose whole purpose is
// watching a conversation, that is not a rough edge, it is the page not working.
//
// Three things now hold a refresh off, and a fourth puts you back where you
// were when one does happen.
// ---------------------------------------------------------------------------
/** Feeds long enough to scroll. A page may add its own with data-keep-scroll. */
const SCROLLERS = '.chat, .chat-log, .of-lines, .pal-list, [data-keep-scroll]';
/** Anything a page must not be interrupted during — a replay, an animation. */
const pollHolds = new Set();
export function holdPoll(reason, on) {
  if (on) pollHolds.add(reason); else pollHolds.delete(reason);
}
/**
 * Is somebody reading?
 *
 * Selected text means they are reading or copying it. A feed scrolled up away
 * from the bottom means they have gone back through the history deliberately —
 * whereas a feed sitting at the bottom is somebody waiting for the next line,
 * who does want the refresh.
 */
function isReading() {
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && sel.toString().trim() && view.contains(sel.anchorNode)) return true;
  // The page itself is a scroller, and it was the one this never checked. The
  // chip has always said "scroll back to the bottom and it resumes"; only the
  // inner boxes ever implemented that, so a long department page re-rendered
  // under somebody halfway down it — and a fresh innerHTML is momentarily
  // shorter than what it replaced, so the browser clamped them to the top.
  // That is the jump: not a scroll bug, a refresh that should not have run.
  const doc = document.documentElement;
  if (doc.scrollHeight - window.innerHeight > 24) {
    const atTop = window.scrollY < 24;
    const atBottom = doc.scrollHeight - window.scrollY - window.innerHeight < 40;
    if (!atTop && !atBottom) return true;
  }
  for (const el of view.querySelectorAll(SCROLLERS)) {
    const scrollable = el.scrollHeight - el.clientHeight > 12;
    // Anywhere but the bottom means reading. The first version of this also
    // required scrollTop > 8, which excluded the most obvious case of all:
    // somebody who scrolled right to the top to read from the beginning.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (scrollable && !atBottom) return true;
  }
  return false;
}
/** Where everything was, so a refresh can put it back. */
function snapshotScroll() {
  const boxes = [];
  view.querySelectorAll(SCROLLERS).forEach((el, i) => boxes.push([`${el.className}#${i}`, el.scrollTop]));
  return { win: window.scrollY, boxes };
}
function restoreScroll(snap) {
  if (!snap) return;
  const want = new Map(snap.boxes);
  view.querySelectorAll(SCROLLERS).forEach((el, i) => {
    const top = want.get(`${el.className}#${i}`);
    if (top !== undefined) el.scrollTop = top;
  });
  // The page itself, too: a table that gained a row must not shift what you
  // were looking at up the screen.
  //
  // Once is not enough. Content that has just been assigned has not been laid
  // out yet, so the document is briefly shorter than it will be, and a
  // scrollTo past the current height is silently clamped — which lands the
  // reader near the top and looks like the page threw them there. So it is
  // re-applied over the next few frames, until the height exists to hold it.
  const target = snap.win;
  if (Math.abs(window.scrollY - target) <= 2) return;
  let tries = 0;
  const put = () => {
    if (Math.abs(window.scrollY - target) <= 2) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.min(target, max), behavior: 'instant' });
    // Only while the page is still too short to reach it. If the reader has
    // scrolled further down themselves in the meantime, they are left alone.
    if (++tries < 6 && window.scrollY < target - 2) requestAnimationFrame(put);
  };
  requestAnimationFrame(put);
}
export function pollPaused() {
  return document.hidden || isEditingField() || hasUnsavedInput() || pollHolds.size > 0 || isReading();
}
function showPollState(paused) {
  const chip = $('#poll-chip');
  if (!chip) return;
  chip.hidden = !paused;
}
export function currentRoute() {
  // A query after the route (#/forge?new=1) is for the page, not the router.
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [seg, arg] = hash.split('/');
  if (seg === 'decisions' && arg) return { key: 'decision', arg };
  if (seg === 'forge' && arg) return { key: 'forgeProject', arg: decodeURIComponent(arg) };
  if (seg === 'studio' && arg) return { key: 'studioProject', arg: decodeURIComponent(arg) };
  if (seg === 'reviews' && arg) return { key: 'review', arg };
  if (seg === 'appbuilder' && arg) return { key: 'appBuild', arg };
  if (seg === 'servers' && arg) return { key: 'server', arg };
  if (seg === 'deploys' && arg) return { key: 'deployTarget', arg };
  if (seg === 'journeys' && arg) return { key: 'journey', arg };
  if (seg === 'systems' && arg) return { key: 'system', arg: hash.split('/').slice(1).join('/') };
  if (seg === 'requests' && arg) return { key: 'request', arg };
  if (seg === 'workstreams' && arg) return { key: 'workstream', arg };
  if (seg === 'artifacts' && arg) return { key: 'artifacts', arg: decodeURIComponent(arg) };
  // The eight doors live under their own prefix so that `#/people` keeps
  // meaning the People department it has always meant.
  if (seg === 's' && arg) return { key: 'surface', arg };
  return { key: routes[seg] ? seg : '', arg: null };
}
/**
 * Which navigation is current.
 *
 * `clearInterval` stops the next poll; it does nothing about the one already
 * in flight, and nothing at all about an `await r.render()` that is halfway
 * through when somebody clicks elsewhere. Both of those finish, and both then
 * write into a page that has already been replaced — the symptom is a handler
 * setting `.disabled` on a button that no longer exists, or an error box
 * appearing on whichever department happened to be open when the previous
 * one's fetch came back.
 *
 * It is a race, so it shows up as one render in a thousand failing on a
 * different page each time, which is the hardest kind of bug to believe in.
 * The sweep found it because a sweep is a thousand navigations in a row.
 */
export let navGeneration = 0;
export async function navigate() {
  const gen = ++navGeneration;
  clearInterval(pollTimer);
  showPollState(false);
  if (!currentUser) return;
  const { key, arg } = currentRoute();
  const r = routes[key];
  const deptKey = { forgeProject: 'forge', server: 'servers', deployTarget: 'deploys', studioProject: 'studio', review: 'reviews', appBuild: 'appbuilder' }[key] || key;
  const sec = CATALOG.sections.find((s) => routeOf(s.href) === deptKey);
  $('#page-title').textContent = sec && deptKey === key ? sectionName(sec.id, r.title) : t(r.title);
  paintCrumb(key, sec);
  document.title = `${$('#page-title').textContent} · AlphaCore`;
  const perm = navPerm[key];
  if (perm && !hasPermC(perm)) {
    view.innerHTML = `<div class="panel"><div class="empty">You need the <span class="mono" style="color:var(--warn)">${esc(perm)}</span> permission for this section — ask the superadmin.</div></div>`;
    return;
  }
  markActiveNav();
  closeDrawer();
  // Opening a new place takes its mark off the menu.
  if (markSeen(deptKey)) buildNav();
  // Move the reading position to the content that just replaced everything.
  // Without this a screen reader stays where it was and announces nothing,
  // which reads as "the link did not work".
  if (document.activeElement?.closest('#side, #tabbar, #palette')) {
    requestAnimationFrame(() => view.focus({ preventScroll: true }));
  }
  view.innerHTML = `<div class="empty">${esc(t('Loading…'))}</div>`;
  try {
    await r.render(arg);
    // Somebody navigated while this was fetching. Whatever it drew belongs to
    // a page nobody is looking at any more, and the page they *are* looking at
    // has already drawn itself.
    if (gen !== navGeneration) return;
    afterRender();
  } catch (e) {
    if (gen !== navGeneration) return;
    view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
  if (r.poll) {
    pollTimer = setInterval(() => {
      // Never re-render out from under somebody who is typing, reading, or
      // watching something play out.
      if (pollPaused()) { showPollState(true); return; }
      showPollState(false);
      const place = snapshotScroll();
      r.render(arg).then(() => {
        if (gen !== navGeneration) return;
        afterRender();
        restoreScroll(place);
      }).catch(() => {});
    }, r.poll);
  }
}
/**
 * Everything the shell owes a freshly rendered page: the Arabic pass, and a
 * scroll box around anything that cannot reflow.
 *
 * Ninety renderers write tables, and none of them should have to know that a
 * phone exists. A table is the one element that genuinely cannot be made
 * narrower without lying about the data, so it gets to keep its width and
 * scroll inside its own box instead of pushing the whole document sideways.
 */
let labelSeq = 0;

/**
 * The band above every department page: which door, which district, which
 * core, and what it is joined to. Read from the catalogue and the edge list
 * the map is drawn from, so a page and the map cannot disagree about where
 * a department sits. Nothing to say on the overview, on detail pages, or for
 * a login that never received the catalogue.
 */
function paintBand() {
  const key = currentRoute().key;
  const sec = key ? CATALOG.sections.find((s) => routeOf(s.href) === key) : null;
  if (!sec || view.querySelector('.dept-band')) return;
  const entDivs = CATALOG.enterprise?.divisions || [];
  const ent = entDivs.find((d) => d.departments.some((x) => x.id === sec.id));
  const div = ent || CATALOG.divisions.find((d) => d.id === sec.division);
  const door = surfaceOfSection(sec.id);
  const byId = new Map(CATALOG.sections.map((s) => [s.id, s]));
  const seen = new Set();
  const joined = (CATALOG.edges || [])
    .filter((e) => (e.from === sec.id || e.to === sec.id) && e.from !== 'all' && e.to !== 'all')
    .map((e) => ({ id: e.from === sec.id ? e.to : e.from, count: e.count }))
    .filter((x) => byId.has(x.id) && !seen.has(x.id) && seen.add(x.id))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const band = document.createElement('div');
  band.className = 'dept-band';
  band.innerHTML = `
    <span class="band-dot" style="background:${esc(div?.color || 'var(--ink-faint)')}"></span>
    ${door ? `<a class="crumb" href="#/s/${esc(door)}">${esc(t(SURFACE_LABEL[door] || door))}</a><span class="crumb-sep">›</span>` : ''}
    <span class="crumb">${esc(ent ? t(ent.label) : divisionName(sec.division, div?.label || sec.division))}</span>
    <span class="core-tag ${ent ? 'enterprise' : ''}">${esc(t(ent ? 'Enterprise core' : 'AI core'))}</span>
    ${sec.hint ? `<span class="band-hint">${esc(t(sec.hint))}</span>` : ''}
    ${joined.length ? `<span class="band-links"><span class="lk">${esc(t('joined to'))}</span>${joined.map((x) => `<a href="${esc(byId.get(x.id).href)}">${esc(sectionName(x.id, byId.get(x.id).label))}<span class="n">${x.count}</span></a>`).join('')}</span>` : ''}`;
  view.prepend(band);
}

export function afterRender() {
  try { paintBand(); } catch { /* the band is a courtesy; the page is the point */ }
  translateDom(view);

  // Ninety renderers write `<label class="fl" for="x">Name</label><input id="x">`:
  // adjacent, and unconnected. A sighted person reads the label; a screen
  // reader announces "edit text, blank" and the form is unusable. Linking them
  // here covers every page at once, which is the only way this gets done —
  // asking ninety call sites to remember a `for` attribute does not work, and
  // the browser sweep now fails when one is missed.
  for (const label of view.querySelectorAll('label.fl:not([for])')) {
    let control = label.nextElementSibling;
    // Skip past a wrapper or a hint line to reach the actual control.
    while (control && !/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) {
      control = control.querySelector?.('input, select, textarea') || control.nextElementSibling;
      if (control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) break;
      if (control && control.tagName === 'LABEL') { control = null; break; }
    }
    if (!control || !/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) continue;
    if (control.type === 'hidden') continue;
    if (!control.id) control.id = `fld-${++labelSeq}`;
    label.setAttribute('for', control.id);
  }

  for (const table of view.querySelectorAll('table')) {
    if (table.parentElement?.classList.contains('tscroll')) continue;
    const box = document.createElement('div');
    box.className = 'tscroll';
    table.replaceWith(box);
    box.appendChild(table);
  }
}
window.addEventListener('hashchange', navigate);

// Update the paused indicator as soon as the form goes clean or dirty, so the
// state is never a surprise — it reacts to typing, not just to the next tick.
for (const evt of ['input', 'focusin', 'focusout', 'change']) {
  view.addEventListener(evt, () => showPollState(Boolean(routes[currentRoute().key]?.poll) && pollPaused()));
}
// Scrolling now decides whether a page refreshes itself, so it has to move the
// chip too — otherwise the timer goes quiet with nothing on screen saying why.
// Coalesced into a frame: this fires on every wheel notch.
let scrollChipQueued = false;
window.addEventListener('scroll', () => {
  if (scrollChipQueued) return;
  scrollChipQueued = true;
  requestAnimationFrame(() => {
    scrollChipQueued = false;
    showPollState(Boolean(routes[currentRoute().key]?.poll) && pollPaused());
  });
}, { passive: true });
