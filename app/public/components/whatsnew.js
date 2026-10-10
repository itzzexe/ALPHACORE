// What is new — so a release is something people find, not something they
// are told about once and then hunt for.
//
// A panel at the top of the home page with one card per new place, a "new"
// mark beside each one in the menu until it has been opened, and the group
// they live in opened once on its own. All of it remembered per browser and
// forgotten without harm: a private window simply sees the panel again.
import { esc } from '../core/dom.js';
import { t } from '/i18n.js';

const RELEASE = 'engineering-1';
const SEEN_KEY = `alphacore-seen-${RELEASE}`;
const HIDE_KEY = `alphacore-whatsnew-hidden-${RELEASE}`;
const OPENED_KEY = `alphacore-whatsnew-opened-${RELEASE}`;

/** The new places, in the order somebody would want to try them. */
export const NEW_PLACES = [
  { route: 'studio', icon: '⌨', title: 'Dev Studio', body: 'Edit any project like in VS Code: tabs, search, source control, a terminal, and an AI pair programmer.', perm: 'forge.view' },
  { route: 'appbuilder', icon: '✦', title: 'App builder', body: 'Describe an app in a paragraph. Agents write the spec, the design, the code and the tests — you approve each step.', perm: 'appbuilder.view' },
  { route: 'reviews', icon: '🛡', title: 'Review board', body: 'Security, tests, quality, performance, accessibility and dependencies — reviewed by a scanner and AI reviewers.', perm: 'reviews.view' },
  { route: 'github', icon: '⎇', title: 'GitHub', body: 'Clone your repositories, review pull requests, and push — every call through the gate.', perm: 'github.view' },
  { route: 'engmetrics', icon: '◔', title: 'Engineering metrics', body: 'How often you ship, how long changes take, how often they fail — measured.', perm: 'engmetrics.view' },
];
const NEW_ROUTES = new Set(NEW_PLACES.map((p) => p.route));

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

const seen = () => new Set(read(SEEN_KEY, []));
export const isNew = (route) => NEW_ROUTES.has(route) && !seen().has(route);

/** Called on every navigation: opening a new place takes its mark away. */
export function markSeen(route) {
  if (!NEW_ROUTES.has(route)) return false;
  const s = seen();
  if (s.has(route)) return false;
  s.add(route);
  write(SEEN_KEY, [...s]);
  return true;
}

/** The first time, open the menu group the new places live in. Once only. */
export function openOnce(openGroups, save) {
  if (read(OPENED_KEY, false)) return;
  write(OPENED_KEY, true);
  openGroups.add('engineering');
  save();
}

export const newMark = (route) => (isNew(route) ? `<span class="sx-new">${esc(t('New'))}</span>` : '');

/** The panel for the home page; empty once dismissed. */
export function whatsNewPanel(can) {
  if (read(HIDE_KEY, false)) return '';
  const places = NEW_PLACES.filter((p) => !p.perm || can(p.perm));
  if (!places.length) return '';
  return `
  <section class="wn" aria-labelledby="wn-title">
    <div class="wn-head">
      <div><span class="wn-tag">${esc(t('New'))}</span><h3 id="wn-title">${esc(t('The engineering floor is here'))}</h3>
        <p>${esc(t('Five new places, all under Engineering in the menu on the side.'))}</p></div>
      <button type="button" class="btn btn-sm" id="wn-hide">${esc(t('Got it, hide this'))}</button>
    </div>
    <div class="wn-cards">${places.map((p) => `
      <a class="wn-card ${isNew(p.route) ? 'unseen' : ''}" href="#/${p.route}">
        <span class="wn-ico" aria-hidden="true">${p.icon}</span>
        <b>${esc(t(p.title))}</b>
        <span>${esc(t(p.body))}</span>
        <em>${esc(t('Open'))} →</em>
      </a>`).join('')}</div>
  </section>`;
}

export function wireWhatsNew(root) {
  root.querySelector('#wn-hide')?.addEventListener('click', () => {
    write(HIDE_KEY, true);
    root.querySelector('.wn')?.remove();
  });
}
