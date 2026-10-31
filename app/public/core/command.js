// The command layer — what sits over every page so a person can run the
// company from wherever they are.
//
//   pins        the places they use most, starred from the page and kept on
//               the server so they follow the person, not the browser
//   broadcasts  a message to everyone, on top of every page until it is read
//   capture     a task, a risk, a note, a broadcast or a question, from any
//               page, without leaving it
//   keys        g-then-a-letter to go, n to capture, f to pin, ? for the list
//   wall        the console as an office screen: chosen pages in turn, the
//               chrome hidden, until somebody presses Escape
//   setup       the first-run journey: name the company, place it on the
//               globe, choose what matters first — then the deck
//
// Each of these writes through the same API a page would, as the person
// signed in; nothing here has powers of its own.
import { $, esc, toast } from './dom.js';
import { api } from '../services/api.js';
import { actor, currentUser, hasPermC } from '../state/session.js';
import { CATALOG, addPaletteCommands, onRender, openPalette, routeOf } from './shell.js';
import { routes } from '../router/registry.js';
import { t, lang, sectionName } from '/i18n.js';
import { allCountries } from '../components/geo.js';

let prefs = { pins: [], onboarded: true, focus: [], wall: [] };
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>';
const here = () => {
  const h = location.hash || '#/';
  return h === '#' ? '#/' : h.split('?')[0];
};

async function savePrefs(patch) {
  try { prefs = await api('/api/deck/prefs', { method: 'POST', body: patch }); } catch (e) { toast(e.message, true); }
  paintPins();
  paintStar();
}

// ------------------------------------------------------------------ pins --
/** Whether a pinned place is still a page the console can open. */
export const knownPlace = (href) => href === '#/' || Boolean(routes[routeOf(href)]);
/**
 * A place's name: the department's own name from the catalogue, in the
 * console's language; failing that, the page's title up to its dash. Never
 * the address — "deals" is a route, not a name.
 */
export function pinLabel(href) {
  const key = routeOf(href);
  if (!key) return t('Home');
  const sec = CATALOG.sections.find((x) => routeOf(x.href) === key);
  if (sec) return sectionName(sec.id, sec.label);
  const title = routes[key]?.title;
  return title ? t(title.split(' — ')[0]) : key;
}
function paintPins() {
  const host = $('#sx-pins');
  if (!host) return;
  const pins = prefs.pins.filter(knownPlace);
  host.innerHTML = pins.length ? `<div class="sx-sec"><span>${esc(t('Pinned'))}</span></div>${pins.map((h) => `
    <a class="sx-item" href="${esc(h)}" data-nav="pin" title="${esc(pinLabel(h))}"><svg class="sx-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg><span class="sx-label">${esc(pinLabel(h))}</span></a>`).join('')}` : '';
}
function paintStar() {
  let b = $('#m-star');
  if (!b) {
    b = document.createElement('button');
    b.id = 'm-star'; b.type = 'button'; b.className = 'm-star';
    b.innerHTML = STAR;
    b.addEventListener('click', togglePin);
    $('#open-palette')?.before(b);
  }
  const on = prefs.pins.includes(here());
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', t(on ? 'Unpin this page' : 'Pin this page'));
  b.title = `${t(on ? 'Unpin this page' : 'Pin this page')} (F)`;
}
function togglePin() {
  const h = here();
  const pins = prefs.pins.includes(h) ? prefs.pins.filter((x) => x !== h) : [...prefs.pins, h];
  savePrefs({ pins });
  toast(t(pins.includes(h) ? 'Pinned to the sidebar' : 'Unpinned'));
}

// ------------------------------------------------------------ broadcasts --
async function paintBroadcasts() {
  if (!hasPermC('broadcasts.view')) return;
  let items = [];
  try { items = await api('/api/deck/broadcasts'); } catch { return; }
  let host = $('#m-broadcasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'm-broadcasts';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', t('Broadcasts'));
    $('#sx-duty')?.after(host);
  }
  host.innerHTML = items.slice(0, 2).map((b) => `
    <div class="m-broadcast ${esc(b.level)}">
      <span class="m-tag">${esc(t(b.level === 'critical' ? 'Critical' : b.level === 'important' ? 'Important' : 'For everyone'))}</span>
      <div class="m-msg"><b dir="auto">${esc(b.title)}</b>${b.body ? `<small dir="auto">${esc(b.body)}</small>` : ''}</div>
      <button type="button" class="btn btn-sm" data-ack="${b.id}">${esc(t('Got it'))}</button>
    </div>`).join('');
  host.querySelectorAll('[data-ack]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await api(`/api/broadcasts/${btn.dataset.ack}/ack`, { method: 'POST', body: {} }); paintBroadcasts(); } catch (e) { toast(e.message, true); }
  }));
}

// ------------------------------------------------------------- overlays --
function overlay(html, { narrow = false, label = '' } = {}) {
  closeOverlay();
  const o = document.createElement('div');
  o.className = 'm-overlay';
  o.id = 'm-overlay';
  o.innerHTML = `<div class="m-sheet${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><button type="button" class="m-x" aria-label="${esc(t('Close'))}">×</button>${html}</div>`;
  document.body.appendChild(o);
  o.addEventListener('click', (e) => { if (e.target === o) closeOverlay(); });
  o.querySelector('.m-x').addEventListener('click', closeOverlay);
  setTimeout(() => o.querySelector('input, textarea, select, button:not(.m-x)')?.focus(), 60);
  return o;
}
function closeOverlay() { $('#m-overlay')?.remove(); }

// -------------------------------------------------------------- capture --
const KINDS = [
  { id: 'task', label: 'Task', perm: 'tasks.manage' },
  { id: 'risk', label: 'Risk', perm: 'risks.manage' },
  { id: 'note', label: 'Note for the company', perm: 'knowledge.manage' },
  { id: 'broadcast', label: 'Broadcast', perm: 'broadcasts.manage' },
  { id: 'ask', label: 'Question', perm: null },
];
export function openCapture(kind = null) {
  const kinds = KINDS.filter((k) => !k.perm || hasPermC(k.perm));
  let cur = kinds.find((k) => k.id === kind) || kinds[0];
  const o = overlay(`<h2>${esc(t('Capture'))}</h2><p>${esc(t('Write it down from here; it lands where it belongs.'))}</p>
    <div class="m-kinds" role="tablist">${kinds.map((k) => `<button type="button" role="tab" data-kind="${k.id}">${esc(t(k.label))}</button>`).join('')}</div>
    <form id="m-cap" class="m-stepbody"></form>`, { narrow: true, label: t('Capture') });
  const form = o.querySelector('#m-cap');
  const draw = () => {
    o.querySelectorAll('[data-kind]').forEach((b) => { b.classList.toggle('on', b.dataset.kind === cur.id); b.setAttribute('aria-selected', b.dataset.kind === cur.id ? 'true' : 'false'); });
    const title = cur.id === 'note' ? '' : `<label class="m-field"><span>${esc(t(cur.id === 'ask' ? 'Your question' : 'Title'))}</span><input name="title" required maxlength="160" dir="auto"></label>`;
    const extra = {
      task: `<label class="m-field"><span>${esc(t('Due'))}</span><input name="due" type="date"></label><label class="m-field"><span>${esc(t('Priority'))}</span><select name="priority"><option value="normal">${esc(t('normal'))}</option><option value="high">${esc(t('high'))}</option><option value="low">${esc(t('low'))}</option></select></label>`,
      risk: `<label class="m-field"><span>${esc(t('Likelihood (1–5)'))}</span><input name="likelihood" type="number" min="1" max="5" value="3"></label><label class="m-field"><span>${esc(t('Impact (1–5)'))}</span><input name="impact" type="number" min="1" max="5" value="3"></label>`,
      note: `<label class="m-field"><span>${esc(t('What everybody should know'))}</span><textarea name="content" rows="4" required dir="auto"></textarea></label>`,
      broadcast: `<label class="m-field"><span>${esc(t('Details'))}</span><textarea name="body" rows="3" dir="auto"></textarea></label><label class="m-field"><span>${esc(t('Level'))}</span><select name="level"><option value="info">${esc(t('For everyone'))}</option><option value="important">${esc(t('Important'))}</option><option value="critical">${esc(t('Critical'))}</option></select></label>`,
      ask: '',
    }[cur.id];
    form.innerHTML = `${title}${extra}<div class="m-nav"><span class="sub">${esc(t('Ctrl+Enter to save'))}</span><button class="btn btn-primary" type="submit">${esc(t(cur.id === 'ask' ? 'Ask' : 'Save'))}</button></div>`;
    form.querySelector('input, textarea')?.focus();
  };
  o.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { cur = kinds.find((k) => k.id === b.dataset.kind); draw(); }));
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    try {
      if (cur.id === 'task') await api('/api/tasks', { method: 'POST', body: { title: f.title, dueDate: f.due || null, priority: f.priority, assigneeType: 'human', assigneeId: currentUser?.username || null, actor: actor() } });
      else if (cur.id === 'risk') await api('/api/risks', { method: 'POST', body: { title: f.title, likelihood: Number(f.likelihood), impact: Number(f.impact), actor: actor() } });
      else if (cur.id === 'note') await api('/api/knowledge', { method: 'POST', body: { content: f.content, sourceRef: 'capture', actor: actor() } });
      else if (cur.id === 'broadcast') { await api('/api/broadcasts', { method: 'POST', body: { title: f.title, body: f.body || null, level: f.level } }); paintBroadcasts(); }
      else if (cur.id === 'ask') {
        closeOverlay();
        try { sessionStorage.setItem('alphacore-ask', f.title); } catch { /* fine */ }
        location.hash = '#/ask';
        return;
      }
      closeOverlay();
      toast(t('Captured'));
    } catch (err) { toast(err.message, true); }
  });
  draw();
}

// ----------------------------------------------------------------- keys --
const GO = { h: '#/', w: '#/approvals', m: '#/missions', g: '#/globe', a: '#/atlas', i: '#/healthindex', s: '#/whatif', b: '#/broadcasts', t: '#/tasks', y: '#/mywork' };
const GO_LABEL = { h: 'Home', w: 'Waiting on you', m: 'Missions', g: 'The globe', a: 'Company map', i: 'Health index', s: 'What if', b: 'Broadcasts', t: 'Tasks', y: 'My work' };
export function openKeys() {
  overlay(`<h2>${esc(t('Keyboard'))}</h2><p>${esc(t('Everything has a key. Press g, then a letter, to go somewhere.'))}</p>
    <div class="m-keys">
      <div><span>${esc(t('Search or ask'))}</span><kbd class="m-k">Ctrl K</kbd></div>
      <div><span>${esc(t('Capture'))}</span><kbd class="m-k">N</kbd></div>
      <div><span>${esc(t('Pin this page'))}</span><kbd class="m-k">F</kbd></div>
      <div><span>${esc(t('Wall mode'))}</span><kbd class="m-k">Shift W</kbd></div>
      <div><span>${esc(t('This list'))}</span><kbd class="m-k">?</kbd></div>
      ${Object.entries(GO).map(([k]) => `<div><span>${esc(t(GO_LABEL[k]))}</span><kbd class="m-k">G ${k.toUpperCase()}</kbd></div>`).join('')}
    </div>`, { label: t('Keyboard') });
}
let pendingG = 0;
function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
  if (e.key === 'Escape') { if ($('#m-overlay')) { closeOverlay(); return; } if (document.documentElement.classList.contains('m-wall')) { stopWall(); return; } }
  if ($('#m-overlay') || !$('#palette')?.hidden) return;
  if (pendingG && Date.now() - pendingG < 1200) {
    pendingG = 0;
    const to = GO[e.key.toLowerCase()];
    if (to) { e.preventDefault(); location.hash = to; }
    return;
  }
  if (e.key === 'g') { pendingG = Date.now(); return; }
  if (e.key === '?') { e.preventDefault(); openKeys(); return; }
  if (e.key === 'n') { e.preventDefault(); openCapture(); return; }
  if (e.key === 'f') { e.preventDefault(); togglePin(); return; }
  if (e.key === 'W') { e.preventDefault(); startWall(); return; }
  if (e.key === '/') { e.preventDefault(); openPalette(); }
}

// ----------------------------------------------------------------- wall --
let wallTimer = 0;
const WALL_SECONDS = 25;
export function startWall() {
  const pages = prefs.wall.length ? prefs.wall : ['#/', '#/healthindex', '#/globe', '#/atlas', '#/missions'];
  let i = Math.max(0, pages.indexOf(here()));
  document.documentElement.classList.add('m-wall');
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
  const bar = document.createElement('div');
  bar.className = 'm-wallbar'; bar.id = 'm-wallbar';
  bar.innerHTML = `<span>${esc(t('Wall mode'))}</span><i style="--d:${WALL_SECONDS}s"></i><button type="button" class="btn btn-sm">${esc(t('Stop'))} · Esc</button>`;
  document.body.appendChild(bar);
  bar.querySelector('button').addEventListener('click', stopWall);
  const next = () => {
    location.hash = pages[i % pages.length];
    i += 1;
    const fill = bar.querySelector('i');
    fill.replaceWith(fill.cloneNode());
  };
  next();
  wallTimer = setInterval(next, WALL_SECONDS * 1000);
}
export function stopWall() {
  clearInterval(wallTimer);
  document.documentElement.classList.remove('m-wall');
  $('#m-wallbar')?.remove();
  try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* fine */ }
}

// ---------------------------------------------------------------- setup --
const FOCUS = [
  { id: 'money', label: 'Money', pins: ['#/finance', '#/whatif'] },
  { id: 'engineering', label: 'Engineering', pins: ['#/forge', '#/reviews'] },
  { id: 'sales', label: 'Sales and customers', pins: ['#/customers', '#/sales'] },
  { id: 'governance', label: 'Governance', pins: ['#/policies', '#/risks'] },
  { id: 'people', label: 'People', pins: ['#/crew', '#/broadcasts'] },
  { id: 'markets', label: 'Markets', pins: ['#/markets'] },
  { id: 'operations', label: 'Operations', pins: ['#/opscenter', '#/incidents'] },
];
const CURRENCIES = ['IQD', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD', 'EGP', 'TRY'];
export async function openSetup() {
  const admin = hasPermC('settings.manage');
  let s = {};
  if (admin) { try { s = await api('/api/settings'); } catch { s = {}; } }
  const c = s.company || {};
  const val = (k) => ({ COMPANY_NAME: c.name, COMPANY_COUNTRY: c.country, COMPANY_CURRENCY: c.currency }[k] || '');
  const steps = admin ? ['welcome', 'company', 'focus', 'launch'] : ['welcome', 'focus', 'launch'];
  let at = 0;
  const data = { name: val('COMPANY_NAME'), country: val('COMPANY_COUNTRY'), currency: val('COMPANY_CURRENCY') || 'IQD', focus: prefs.focus.slice() };
  const o = overlay('<div class="m-steps"></div><div id="m-setup"></div>', { label: t('Set up the company') });
  const body = o.querySelector('#m-setup');
  const paint = () => {
    o.querySelector('.m-steps').innerHTML = steps.map((_, i) => `<i class="${i < at ? 'done' : i === at ? 'on' : ''}"></i>`).join('');
    const step = steps[at];
    const nav = (nextLabel = 'Continue') => `<div class="m-nav">${at ? `<button type="button" class="btn btn-ghost" data-back>${esc(t('Back'))}</button>` : '<span></span>'}<button type="submit" class="btn btn-primary">${esc(t(nextLabel))}</button></div>`;
    if (step === 'welcome') {
      body.innerHTML = `<form class="m-stepbody"><div class="m-launch"><div class="m-orbit" aria-hidden="true"><i></i><i></i><i></i></div></div>
        <h2>${esc(t('Welcome to the bridge'))}${currentUser?.displayName ? `, ${esc(currentUser.displayName)}` : ''}.</h2>
        <p>${esc(t('From here you run the whole company: the AI workforce on one side, the people who answer for it on the other, and the world it trades with on the globe. Two minutes to set it up.'))}</p>${nav('Begin')}</form>`;
    } else if (step === 'company') {
      body.innerHTML = `<form class="m-stepbody"><h2>${esc(t('Your company'))}</h2>
        <label class="m-field"><span>${esc(t('Its name'))}</span><input name="name" required maxlength="80" value="${esc(data.name)}" dir="auto"></label>
        <label class="m-field"><span>${esc(t('Where it is run from — it becomes home on the globe'))}</span><select name="country" required><option value="">—</option>${allCountries(lang).map((c) => `<option value="${c.code}" ${c.code === data.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="m-field"><span>${esc(t('Its currency'))}</span><select name="currency">${CURRENCIES.map((c) => `<option ${c === data.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>${nav()}</form>`;
    } else if (step === 'focus') {
      body.innerHTML = `<form class="m-stepbody"><h2>${esc(t('What matters first?'))}</h2><p>${esc(t('Your choices are pinned to the sidebar. Change them any time with the star at the top of a page.'))}</p>
        <div class="m-choices">${FOCUS.map((f) => `<label class="m-choice"><input type="checkbox" name="focus" value="${f.id}" ${data.focus.includes(f.id) ? 'checked' : ''}><span>${esc(t(f.label))}</span></label>`).join('')}</div>${nav()}</form>`;
    } else {
      body.innerHTML = `<form class="m-stepbody"><div class="m-launch"><div class="m-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
        <h2>${esc(t('Ready for launch'))}</h2><p>${esc(t('Your deck is waiting, with the globe, the day’s brief and your first missions. Press N anywhere to capture something, ? for every key.'))}</p></div>${nav('Enter the deck')}</form>`;
    }
    const form = body.querySelector('form');
    body.querySelector('[data-back]')?.addEventListener('click', () => { at -= 1; paint(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        if (step === 'company') {
          data.name = String(f.get('name') || '').trim(); data.country = String(f.get('country') || ''); data.currency = String(f.get('currency') || '');
          for (const [key, value] of [['COMPANY_NAME', data.name], ['COMPANY_COUNTRY', data.country], ['COMPANY_CURRENCY', data.currency]]) {
            await api('/api/settings', { method: 'POST', body: { key, value, actor: actor() } });
          }
        }
        if (step === 'focus') {
          data.focus = f.getAll('focus').map(String);
          const pins = [...new Set([...prefs.pins, ...FOCUS.filter((x) => data.focus.includes(x.id)).flatMap((x) => x.pins)])];
          await savePrefs({ focus: data.focus, pins });
        }
        if (step === 'launch') {
          await savePrefs({ onboarded: true });
          closeOverlay();
          location.hash = '#/';
          return;
        }
        at += 1;
        paint();
      } catch (err) { toast(err.message, true); }
    });
    form.querySelector('input, select, button[type="submit"]')?.focus();
  };
  paint();
}

// ---------------------------------------------------------------- start --
let started = false;
export async function startCommand() {
  try { prefs = await api('/api/deck/prefs'); } catch { /* the console works without them */ }
  paintPins();
  paintStar();
  paintBroadcasts();
  if (started) return;
  started = true;
  onRender(() => { paintStar(); });
  window.addEventListener('hashchange', paintStar);
  document.addEventListener('keydown', onKey);
  setInterval(paintBroadcasts, 60000);
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'm-capture-fab'; fab.id = 'm-capture';
  fab.setAttribute('aria-label', `${t('Capture')} (N)`);
  fab.title = `${t('Capture')} (N)`;
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';
  fab.addEventListener('click', () => openCapture());
  document.body.appendChild(fab);
  addPaletteCommands([
    { label: 'Capture something', kind: 'Do', keys: 'N', run: () => openCapture() },
    { label: 'Pin or unpin this page', kind: 'Do', keys: 'F', run: togglePin },
    { label: 'Keyboard shortcuts', kind: 'Do', keys: '?', run: openKeys },
    { label: 'Wall mode — the console as an office screen', kind: 'Do', keys: 'Shift W', run: startWall },
    { label: 'Day or night', kind: 'Do', run: () => $('#theme-toggle')?.click() },
    { label: 'العربية / English', kind: 'Do', run: () => $('#lang-toggle')?.click() },
    { label: 'Set up the company again', kind: 'Do', run: openSetup },
    { label: 'Tell everybody something', kind: 'Do', perm: 'broadcasts.manage', run: () => openCapture('broadcast') },
    { label: 'New task', kind: 'Create', perm: 'tasks.manage', run: () => openCapture('task') },
    { label: 'Register a risk', kind: 'Create', perm: 'risks.manage', run: () => openCapture('risk') },
  ]);
  if (!prefs.onboarded) setTimeout(openSetup, 600);
}
