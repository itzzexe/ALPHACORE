// The shell: the rail, the flyout, the phone drawer, the palette, and the
// router that decides what fills the page.
//
// Navigation and routing are one module because they are one loop. The router
// asks the shell which door to light; the shell asks the router where it is.
// Splitting them would mean two files importing each other to no benefit —
// a cycle ES modules would in fact tolerate, and a reader would not.
//
// Everything drawn here comes from the catalogue the server serves, so a new
// department appears in the rail, the flyout and the palette the moment it is
// declared. There is no list in this file to forget to update.

import { $, esc, money, view } from './dom.js';
import { TOKEN_KEY, currentUser, hasPermC, navPerm } from '../state/session.js';
import { api } from '../services/api.js';
import { routes } from '../router/registry.js';
import { t, lang, setLang, applyLang, translateDom, sectionName, divisionName } from '/i18n.js';

// ---------- shell v2: rail + flyout + command palette ----------
// The navigation is generated from the same catalogue the map draws, so a new
// department appears in the rail, the flyout and the palette the moment it is
// declared server-side — one source of truth, no list to forget to update.
const DIV_ORDER = ['engine', 'world', 'build', 'decide', 'data', 'marketing', 'commerce', 'capital', 'operate', 'talent', 'trust', 'exec', 'govern'];

/* ---------- the eight doors ----------
   A hundred and forty departments is the right number for a company and the
   wrong number for a menu. The rail now carries what somebody is trying to do
   rather than who owns the answer; the divisions above are still the org chart
   and still draw the map. Nothing was removed: every department keeps its page
   and its route, and appears under exactly one of these — checked by the launch
   audit, because a mapping that can rot silently will.

   The order is deliberate. Ask first because it is the answer to "I don't know
   where to look", and Approvals third because it is the one that carries a
   number somebody is waiting on. */
export const SURFACE_ORDER = ['ask', 'work', 'approvals', 'company', 'intelligence', 'money', 'people', 'world'];
const SURFACE_ICON = {
  ask: '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.3a2.7 2.7 0 015.2.9c0 1.8-2.6 2.2-2.6 4"/><path d="M12 17.2v.2"/>',
  work: '<path d="M3.5 7.5h17v11h-17z"/><path d="M9 7.5V5.6c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v1.9"/><path d="M3.5 12h17"/>',
  approvals: '<path d="M5 4.5h14v15l-7-3.2-7 3.2z"/><path d="M9 10.2l2.2 2.2 4-4.2"/>',
  company: '<path d="M4 20V6.5l7-3 7 3V20"/><path d="M8 20v-4.5h6V20"/><path d="M8 9h2M14 9h2M8 12.5h2M14 12.5h2"/>',
  intelligence: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L20.5 20.5"/><path d="M7.6 10.5h5.8M10.5 7.6v5.8"/>',
  money: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.7-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5S14.5 18.4 12 20.5c-2.5-2.1-3.8-5.4-3.8-8.5S9.5 6.1 12 3.5z"/>',
  // The ninth button, and not a surface: the way to the full list and the map,
  // so consolidating the menu never means losing the department you knew by name.
  all: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  // The enterprise core's five. Drawn in the same hand as the rest — a second
  // icon language would say "a different product" when it is one company.
  'e-people': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
  'e-time': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/>',
  'e-money': '<path d="M3.5 7.5h17v10h-17z"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6.5 12.5h.01M17.5 12.5h.01"/>',
  'e-records': '<path d="M6 3.5h9l4 4V20a.5.5 0 01-.5.5h-12A.5.5 0 016 20z"/><path d="M14.5 3.5v4.5H19"/><path d="M9 12.5h6M9 16h4"/>',
  'e-ops': '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M3 12h4M17 12h4"/>',
  'e-seam': '<circle cx="6.5" cy="12" r="3"/><circle cx="17.5" cy="12" r="3"/><path d="M9.5 12h5"/>',
};
export const SURFACE_LABEL = {
  ask: 'Ask AlphaCore', work: 'Work', approvals: 'Approvals', company: 'Company',
  intelligence: 'Intelligence', money: 'Money', people: 'People', world: 'World',
  all: 'All departments',
  'e-people': 'People & HR', 'e-time': 'Time & attendance', 'e-money': 'Payroll & spending', 'e-ops': 'Operations',
  'e-records': 'Documents & records', 'e-seam': 'The seam',
};

/* ---------- the two cores ----------
   §2 of the Core 2 directive keeps the galaxies apart in the data: the AI core
   thinks and acts, the enterprise core records what is true, and nothing
   crosses but the declared tunnels. The menu was the last place they were still
   mixed — an HR record and a run queue under one heading because both happened
   to involve people.

   So the rail shows one core at a time and a switch sits above it. Which core
   you are looking at follows the page you are on: opening a payroll screen from
   a search result switches the rail rather than leaving it pointing at the
   other galaxy. */
export const CORE_ORDER = ['core1', 'core2'];
export const CORE_LABEL = { core1: 'AI core', core2: 'Enterprise core' };
export const CORE2_SURFACE_ORDER = ['e-people', 'e-time', 'e-money', 'e-records', 'e-ops', 'e-seam'];
let openCore = localStorage.getItem('alphacore-core') || 'core1';
const DIV_ICON = {
  engine: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  build: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
  decide: '<path d="M12 3v18M5 7h14"/><path d="M5 7l-2.5 6h5zM19 7l-2.5 6h5z"/>',
  data: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  marketing: '<path d="M4 20l3.5-9 9-3.5L20 4"/><path d="M14 6l4 4"/><circle cx="7" cy="17" r="1.6"/>',
  commerce: '<path d="M3 7h13l-1.5 8H6z"/><circle cx="8" cy="19" r="1.4"/><circle cx="15" cy="19" r="1.4"/><path d="M3 7L2 4"/>',
  capital: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.7-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2"/>',
  operate: '<path d="M3 12h4l2.5 6 5-14 2.5 8h4"/>',
  talent: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 010 5.6M18 20c0-2.4-1-4.2-2.6-5.2"/>',
  trust: '<path d="M12 3l7.5 3v6c0 4.4-3 8.2-7.5 9.5C7.5 20.2 4.5 16.4 4.5 12V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  exec: '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"/>',
  govern: '<path d="M12 3l8 4v5c0 4.5-3.3 8.4-8 9.5-4.7-1.1-8-5-8-9.5V7z"/><path d="M12 8v5M12 15.5v.5"/>',
  // A globe with a door in it: everything that reaches past the front door.
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5S14.5 18.4 12 20.5c-2.5-2.1-3.8-5.4-3.8-8.5S9.5 6.1 12 3.5z"/>',
};
export let CATALOG = { sections: [], divisions: [], surfaces: [] };
let openDiv = null;
function railBtn(id, label, count = '') {
  return `<button class="rail-btn" type="button" data-div="${id}" aria-label="${esc(label)}">
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">${SURFACE_ICON[id] || DIV_ICON[id] || DIV_ICON.govern}</svg>
    <span class="rail-dot">${count || ''}</span>
    <span class="rail-tip">${esc(label)}</span>
  </button>`;
}
export const routeOf = (href) => String(href || '').replace(/^#\//, '').split('/')[0];
const visibleSections = () => CATALOG.sections.filter((s) => {
  const perm = navPerm[routeOf(s.href)];
  return !perm || hasPermC(perm);
});
/** Which door a department sits behind. Read from the server, never guessed. */
let SURFACE_OF = new Map();
function indexSurfaces() {
  SURFACE_OF = new Map();
  for (const s of CATALOG.surfaces || []) {
    for (const d of s.departments || []) SURFACE_OF.set(d.id, s.id);
  }
}
const surfaceOfSection = (id) => SURFACE_OF.get(id) || null;
/**
 * Point the rail at the core the current page belongs to.
 *
 * Without this, opening a payroll screen from a search result leaves the menu
 * showing the other galaxy — and the person concludes the page they are looking
 * at does not exist in the navigation.
 */
function followCore(sectionId) {
  const surface = surfaceOfSection(sectionId);
  if (!surface) return false;
  const core = coreOfSurface(surface);
  if (core === openCore) return false;
  openCore = core;
  localStorage.setItem('alphacore-core', core);
  return true;
}
const sectionsIn = (surfaceId) => visibleSections().filter((s) => surfaceOfSection(s.id) === surfaceId);
/** Which core a surface belongs to, read from the server rather than guessed. */
const coreOfSurface = (id) => (CATALOG.surfaces || []).find((x) => x.id === id)?.core || 'core1';
const surfacesOfCore = (core) => (core === 'core2' ? CORE2_SURFACE_ORDER : SURFACE_ORDER);

function buildCoreSwitch() {
  const host = $('#rail-cores');
  if (!host) return;
  // The index has to exist before anything can ask what is behind a surface.
  // Built here as well as in buildRail because this runs first, and reading an
  // empty index made every core look empty — so the switch hid itself.
  indexSurfaces();
  // Only offered when there is something behind both. A company that has not
  // switched the enterprise core on should not be asked to choose between two
  // things when it has one.
  const live = CORE_ORDER.filter((c) => surfacesOfCore(c).some((id) => sectionsIn(id).length));
  if (live.length < 2) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = live.map((c) => `<button class="core-btn${c === openCore ? ' on' : ''}" type="button"
      data-core="${c}" aria-pressed="${c === openCore}">${esc(t(CORE_LABEL[c]))}</button>`).join('');
  host.querySelectorAll('[data-core]').forEach((b) => b.addEventListener('click', () => {
    openCore = b.dataset.core;
    localStorage.setItem('alphacore-core', openCore);
    openDiv = null;
    buildCoreSwitch();
    buildRail();
    renderFlyout();
  }));
}

function buildRail() {
  const host = $('#rail-items');
  if (!host) return;
  indexSurfaces();
  // A door with nothing behind it that this person may see is not shown —
  // the permission filter has always worked that way and still does.
  const shown = surfacesOfCore(openCore).filter((id) => sectionsIn(id).length);
  host.innerHTML = shown.map((id) => railBtn(id, t(SURFACE_LABEL[id] || id))).join('')
    + railBtn('all', t(SURFACE_LABEL.all));
  host.querySelectorAll('[data-div]').forEach((b) => b.addEventListener('click', () => {
    // "All departments" is a page, not a drawer: it is where the full list and
    // the map live, so nothing is only reachable by remembering a URL.
    if (b.dataset.div === 'all') { openDiv = null; renderFlyout(); location.hash = '#/departments'; return; }
    toggleDiv(b.dataset.div);
  }));
  markActiveNav();
}
function toggleDiv(id) {
  openDiv = openDiv === id ? null : id;
  renderFlyout();
}
function renderFlyout() {
  const fly = $('#flyout');
  const app = $('#app');
  if (!fly) return;
  if (!openDiv) { fly.hidden = true; app.classList.remove('nav-open'); markActiveNav(); return; }
  const meta = (CATALOG.surfaces || []).find((x) => x.id === openDiv);
  const list = sectionsIn(openDiv);
  fly.innerHTML = `<a class="flyout-head" href="#/s/${openDiv}">
      <span>${esc(t(SURFACE_LABEL[openDiv] || openDiv))}</span><span class="fh-count">${list.length}</span></a>
    ${meta?.hint ? `<div class="flyout-hint">${esc(t(meta.hint))}</div>` : ''}
    ${list.map((s) => `<a href="${s.href}" data-route="${routeOf(s.href)}">
      <span>${esc(sectionName(s.id, s.label))}</span><span class="fly-n">${s.count}</span></a>`).join('')}
    <a href="#/departments" class="fly-all"><span>${esc(t('All departments'))}</span><span class="fly-n">${visibleSections().length}</span></a>`;
  fly.hidden = false;
  app.classList.add('nav-open');
  markActiveNav();
}

/* ---------- the phone ----------
   A rail you hover and a flyout that lives beside it are the wrong shape for a
   thumb. Below the breakpoint the same two elements slide in as a drawer, and
   the bar at the bottom of the screen becomes the way around: home, the
   departments, search, and who you are. Nothing here runs on a desktop except
   the media query that turns it off. */
const onPhone = () => window.matchMedia('(max-width: 860px)').matches;
function openMobileNav() {
  $('#tab-nav')?.setAttribute('aria-expanded', 'true');
  // A drawer that opens onto a bare strip of icons is a drawer that has to be
  // used twice. If no division is chosen it opens on the one you are already
  // standing in, so the list is there the moment it slides in.
  if (!openDiv) {
    const here = CATALOG.sections?.find((s) => routeOf(s.href) === currentRoute().key);
    const first = SURFACE_ORDER.find((id) => sectionsIn(id).length);
    openDiv = surfaceOfSection(here?.id) || first || null;
    if (openDiv) renderFlyout();
  }
  $('#app').classList.add('mnav');
  $('#nav-scrim').classList.add('on');
  $('#tab-nav')?.classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeMobileNav() {
  $('#tab-nav')?.setAttribute('aria-expanded', 'false');
  $('#app').classList.remove('mnav');
  $('#nav-scrim').classList.remove('on');
  $('#tab-nav')?.classList.remove('on');
  document.body.style.overflow = '';
}
function initMobileNav() {
  $('#nav-scrim')?.addEventListener('click', closeMobileNav);
  $('#tab-nav')?.addEventListener('click', () => {
    if ($('#app').classList.contains('mnav')) closeMobileNav();
    else openMobileNav();
  });
  $('#tab-search')?.addEventListener('click', () => { closeMobileNav(); openPalette(); });
  // The fourth tab is the account: who you are, and the way out.
  $('#tab-who')?.addEventListener('click', () => { closeMobileNav(); $('#who-chip')?.click(); });
  $('[data-tab="home"]')?.addEventListener('click', closeMobileNav);
  // Escape closes the drawer before anything else gets to see it.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#app').classList.contains('mnav')) { closeMobileNav(); e.stopPropagation(); }
  }, true);
  // Rotating a phone to landscape can cross the breakpoint; a drawer left open
  // there would be a panel floating over a layout that no longer expects it.
  window.matchMedia('(max-width: 860px)').addEventListener('change', closeMobileNav);
}
/** Mirror the shell's state onto the bar: which tab is lit, and what is waiting. */
function paintTabbar() {
  const bar = $('#tabbar');
  if (!bar) return;
  const home = currentRoute().key === 'home';
  $('[data-tab="home"]')?.classList.toggle('on', home);
  const label = $('#tab-who-label');
  if (label && currentUser) label.textContent = currentUser.displayName || currentUser.username;
  // One number, the same one the rail carries: everything stopped for a person.
  const waiting = document.querySelector('[data-div="approvals"] .rail-dot')?.textContent || '';
  const dot = $('#tab-dot');
  if (dot) dot.textContent = $('#app').classList.contains('mnav') ? '' : waiting;
}
function markActiveNav() {
  const here = currentRoute().key;
  document.querySelectorAll('#flyout a').forEach((a) => {
    const active = a.dataset.route === here;
    a.classList.toggle('active', active);
    // Colour alone says nothing to a screen reader, and nothing at all to
    // somebody who cannot distinguish these two greys.
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const sec = CATALOG.sections.find((s) => routeOf(s.href) === here);
  // Standing on a page belonging to the other core moves the rail to it, and
  // rebuilds it — otherwise the menu shows one galaxy while the page shows the
  // other, and the department you are reading looks like it does not exist.
  if (sec && followCore(sec.id)) { buildCoreSwitch(); buildRail(); }
  // The lit door is the one you are standing behind, or the one you opened.
  // On the full-list page it is the ninth button, which is not a surface.
  const litSurface = here === 'departments' ? 'all' : (openDiv || surfaceOfSection(sec?.id));
  document.querySelectorAll('#rail-items .rail-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.div === litSurface);
  });
  paintTabbar();
}
export async function loadCatalog() {
  try {
    const map = await api('/api/map');
    // The edges and the enterprise projection ride along: the band above
    // every department page and the seam on the atlas are drawn from them.
    // `core2` is the enterprise projection (divisions with their departments
    // resolved); the band reads it to say which side of the seam a page is on.
    CATALOG = { sections: map.sections, divisions: map.divisions, surfaces: map.surfaces || [], edges: map.edges || [], enterprise: map.core2 || map.enterprise || null };
  } catch {
    // A user without dashboard.view still needs to move around.
    const flat = Object.keys(navPerm).filter((k) => k).map((k) => ({ id: k, label: k, division: 'govern', href: `#/${k}`, count: '' }));
    // No map means no surface mapping either, so everything lands behind one
    // door rather than vanishing from the rail entirely.
    CATALOG = { sections: flat, divisions: [], surfaces: [{ id: 'company', label: 'Company', departments: flat }] };
  }
  buildCoreSwitch();
  buildRail();
}
// ---------- command palette ----------
let palIndex = 0;
let palHits = [];
function openPalette() {
  const p = $('#palette');
  p.hidden = false;
  const input = $('#pal-input');
  input.value = '';
  input.focus();
  palFilter('');
}
function closePalette() { $('#palette').hidden = true; }
function palFilter(qv) {
  const q = qv.trim().toLowerCase();
  const all = visibleSections().map((s) => ({
    ...s, ar: sectionName(s.id, ''), div: CATALOG.divisions.find((d) => d.id === s.division),
  }));
  palHits = (!q ? all : all.filter((s) => `${s.label} ${s.ar} ${s.id} ${s.hint || ''}`.toLowerCase().includes(q))).slice(0, 40);
  palIndex = 0;
  const list = $('#pal-list');
  list.innerHTML = palHits.length ? palHits.map((s, i) => `
    <div class="pal-item ${i === 0 ? 'sel' : ''}" data-href="${s.href}" data-i="${i}">
      <span class="pal-title">${esc(sectionName(s.id, s.label))}</span>
      <span class="pal-div" style="color:${s.div?.color || ''}">${esc(divisionName(s.division, s.div?.label || ''))}</span>
    </div>`).join('') : `<div class="pal-empty">${esc(t('Nothing found'))}</div>`;
  list.querySelectorAll('.pal-item').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.href; closePalette(); }));
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
  $('#open-palette')?.addEventListener('click', openPalette);
  $('#rail-search')?.addEventListener('click', openPalette);
  $('#pal-input')?.addEventListener('input', (e) => palFilter(e.target.value));
  $('#palette')?.addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ($('#palette').hidden) return;
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown') { e.preventDefault(); palMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palMove(-1); }
    else if (e.key === 'Enter') { const h = palHits[palIndex]; if (h) { location.hash = h.href; closePalette(); } }
  });

  // Two skins of one design: warm paper by day, the same paper after dark. The
  // choice is explicit and remembered — the operating system is not asked,
  // because somebody working at night on a bright machine means it, and being
  // overruled by a setting they did not make is worse than either default.
  // The parameter is not called `t`: that is the translation function, and
  // shadowing it here would turn every title into a call on a string.
  const applyTheme = (skin) => {
    if (skin === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    for (const btn of [$('#theme-toggle'), $('#login-theme')]) {
      if (!btn) continue;
      btn.textContent = skin === 'dark' ? '◑' : '◐';
      btn.setAttribute('aria-pressed', skin === 'dark' ? 'true' : 'false');
      btn.title = skin === 'dark' ? t('Back to daylight') : t('After dark');
    }
  };
  applyTheme(localStorage.getItem('alphacore-theme') === 'dark' ? 'dark' : 'light');
  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('alphacore-theme', next);
    applyTheme(next);
  });

  const flipLang = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
    location.reload(); // renderers bake their language in at build time
  };
  $('#lang-toggle')?.addEventListener('click', flipLang);
  $('#login-lang')?.addEventListener('click', flipLang);
  $('#login-theme')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('alphacore-theme', next);
    applyTheme(next);
  });
  $('#lang-toggle') && ($('#lang-toggle').textContent = lang === 'ar' ? 'EN' : 'ع');

  $('#who-chip')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* session gone anyway */ }
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
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
  if (Math.abs(window.scrollY - snap.win) > 2) window.scrollTo({ top: snap.win, behavior: 'instant' });
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
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, arg] = hash.split('/');
  if (seg === 'decisions' && arg) return { key: 'decision', arg };
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
  const sec = CATALOG.sections.find((s) => routeOf(s.href) === key);
  $('#page-title').textContent = sec ? sectionName(sec.id, r.title) : t(r.title);
  document.title = `${$('#page-title').textContent} · AlphaCore`;
  const perm = navPerm[key];
  if (perm && !hasPermC(perm)) {
    view.innerHTML = `<div class="panel"><div class="empty">You need the <span class="mono" style="color:var(--warn)">${esc(perm)}</span> permission for this section — ask the superadmin.</div></div>`;
    return;
  }
  markActiveNav();
  closeMobileNav();
  // Move the reading position to the content that just replaced everything.
  // Without this a screen reader stays where it was and announces nothing,
  // which reads as "the link did not work".
  if (document.activeElement?.closest('#flyout, #rail, #tabbar, #palette')) {
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
