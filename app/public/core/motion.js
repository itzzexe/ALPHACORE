// Motion — the few movements that tell you something.
//
// A thread across the top while a page is on its way; the blocks of a page
// arriving in reading order when you navigate to it; a figure counting up to
// its value the first time you see it; the blocks below the fold arriving
// when they are scrolled to rather than all at once out of sight; a light that
// follows the pointer across the panel it is over, so the eye lands where the
// hand is. Only on a navigation: a page that
// refreshes itself every few seconds must not jump every few seconds, so a
// self-refresh is still. All of it stops for anybody whose system asks for
// less motion.
import { onRender } from './shell.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let bar = null;
let barTimer = 0;
function progressStart() {
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'm-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  }
  clearTimeout(barTimer);
  bar.classList.add('on');
  bar.style.width = '0';
  requestAnimationFrame(() => { bar.style.width = '72%'; });
}
function progressDone() {
  if (!bar) return;
  bar.style.width = '100%';
  barTimer = setTimeout(() => { bar.classList.remove('on'); bar.style.width = '0'; }, 380);
}

let io = null;
/** The direct blocks of a page, in the order a reader meets them; those out of sight wait to be scrolled to. */
function stagger(view) {
  let i = 0;
  io?.disconnect();
  io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const x of entries) {
      if (!x.isIntersecting) continue;
      io.unobserve(x.target);
      x.target.classList.remove('m-wait');
      x.target.style.setProperty('--i', '0');
      x.target.classList.add('m-in');
    }
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  const fold = window.innerHeight;
  for (const el of view.children) {
    if (el.matches('script, style, [hidden]')) continue;
    el.classList.remove('m-in', 'm-wait');
    if (io && el.getBoundingClientRect().top > fold) { el.classList.add('m-wait'); io.observe(el); continue; }
    el.style.setProperty('--i', String(Math.min(i++, 12)));
    // Restart the animation even when the same element class was already on.
    void el.offsetWidth;
    el.classList.add('m-in');
  }
}

/** A figure that is only a number (with an optional unit) counts up to itself. */
const NUM = /^([^\d-]*)(-?\d{1,3}(?:[,٬]\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(\s*[%A-Za-z؀-ۿ$€£]*)$/;
export function countUp(el, ms = 900) {
  if (el.children.length) return;
  const txt = el.textContent.trim();
  const m = txt.match(NUM);
  if (!m) return;
  const target = Number(m[2].replace(/[,٬]/g, ''));
  if (!Number.isFinite(target) || Math.abs(target) < 2) return;
  const decimals = (m[2].split('.')[1] || '').length;
  const grouped = /[,٬]/.test(m[2]);
  const fmt = (v) => {
    const s = decimals ? v.toFixed(decimals) : String(Math.round(v));
    return grouped ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
  };
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = `${m[1]}${fmt(target * e)}${m[3]}`;
    if (k < 1 && document.body.contains(el)) requestAnimationFrame(step);
    else el.textContent = txt;
  };
  requestAnimationFrame(step);
}

/**
 * The light under the pointer, and the slight turn of a place card toward it.
 * One listener for the whole console, at most once a frame; a mouse only, since
 * a finger has nothing to hover with.
 */
function pointerLight() {
  let lit = null; let ev = null; let raf = 0;
  const clear = () => { if (lit) { lit.classList.remove('m-lit'); lit.style.removeProperty('--rx'); lit.style.removeProperty('--ry'); lit = null; } };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = ev.target instanceof Element ? ev.target.closest('.panel') : null;
      if (el !== lit) clear();
      if (!el || reduced()) return;
      lit = el;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${Math.round(ev.clientX - r.left)}px`);
      el.style.setProperty('--my', `${Math.round(ev.clientY - r.top)}px`);
      el.classList.add('m-lit');
      if (el.classList.contains('ld-place')) {
        const x = (ev.clientX - r.left) / r.width - 0.5; const y = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--rx', `${(x * 7).toFixed(2)}deg`); el.style.setProperty('--ry', `${(-y * 7).toFixed(2)}deg`);
      }
    });
  }, { passive: true });
  document.addEventListener('pointerleave', clear);
}

export function initMotion() {
  pointerLight();
  window.addEventListener('hashchange', progressStart);
  onRender((view, fresh) => {
    progressDone();
    if (!fresh || reduced()) return;
    stagger(view);
    for (const el of view.querySelectorAll('.k-val, .tile .big, [data-count]')) countUp(el);
  });
}
