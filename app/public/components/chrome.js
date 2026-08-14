// The furniture: who is signed in, whether this device can be told something
// is waiting, and the small widgets that turn up in four different surfaces.
// Apart from core/shell.js because that is navigation and this is furniture.

import { $, esc, toast, view } from '../core/dom.js';
import { api } from '../services/api.js';
import { currentUser } from '../state/session.js';
import { t } from '/i18n.js';

export function paintUser() {
  if (!currentUser) return;
  $('#who-avatar').textContent = (currentUser.displayName || currentUser.username).slice(0, 1).toUpperCase();
  $('#who-name').textContent = currentUser.displayName || currentUser.username;
  $('#who-role').textContent = currentUser.isOwner ? t('Owner') || 'Owner' : currentUser.role;
}

/* ---------- push ----------
   The company stops at a gate until a person answers, and a person who is not
   looking at a tab cannot answer. This is the only path to them. */
const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
/** What this browser can do about notifications right now. */
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, why: t('This browser cannot receive notifications') };
  }
  if (!window.isSecureContext) {
    // The single most common surprise: it works on localhost and silently
    // does not over a LAN address, because only localhost is a secure origin.
    return { supported: false, why: t('Notifications need HTTPS — over plain http only localhost counts as secure') };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, subscribed: Boolean(sub), subscription: sub, registration: reg };
}
export async function enablePush() {
  const state = await pushState();
  if (!state.supported) { toast(state.why, true); return false; }
  if (state.subscribed) return true;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast(t('Notifications were refused — the browser will not ask again until you clear it in site settings'), true);
    return false;
  }
  const { publicKey } = await api('/api/push/key');
  const sub = await state.registration.pushManager.subscribe({
    userVisibleOnly: true,               // required, and honest: every push shows
    applicationServerKey: b64ToBytes(publicKey),
  });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), userAgent: navigator.userAgent } });
  toast(t('This device will now be told when something is waiting on you'));
  return true;
}
export async function disablePush() {
  const state = await pushState();
  if (!state.subscribed) return;
  const endpoint = state.subscription.endpoint;
  await state.subscription.unsubscribe();
  try { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint } }); } catch { /* already gone */ }
  toast(t('This device will no longer be told'));
}
// ---------- shell status ----------
export async function refreshShell() {
  // Nobody signed in means nothing to refresh. Without this the timer below
  // kept firing five authenticated requests every seven seconds at the login
  // screen, filling the console with 401s and burying whatever the real
  // problem was — which is the moment you most need the console readable.
  if (!currentUser) return;
  try {
    const [health, chain, stats, notif, journeys] = await Promise.all([
      api('/api/health'), api('/api/audit/verify'), api('/api/stats'), api('/api/notifications?unread=1'),
      api('/api/journeys').catch(() => []),
    ]);
    const cc = $('#chain-chip');
    cc.textContent = chain.ok ? `${t('chain —').replace('—', '')}✓ ${chain.checked}` : `chain BROKEN @${chain.brokenAt}`;
    cc.className = 'chip ' + (chain.ok ? 'chip-ok' : 'chip-bad');
    cc.title = health.mockMode ? 'MOCK MODE — no provider keys' : 'LIVE';

    // The mode a machine says it is in belongs next to the chain, not buried in
    // Settings: it is the difference between a laptop and something the
    // internet can reach, and it changes what the platform refuses to do.
    const pc = $('#prod-chip');
    if (pc) {
      pc.hidden = !health.production;
      pc.textContent = t('PRODUCTION');
      pc.title = t('This install declares itself production: the master key must come from outside this disk, and the public address must be https behind a trusted proxy.');
    }
    // Everything waiting on a person surfaces on the rail, so a blocked item
    // is visible from any page without opening a menu.
    const waiting = stats.inboxTotal || stats.awaitingHuman || 0;
    const dot = document.querySelector('[data-div="approvals"] .rail-dot');
    if (dot) dot.textContent = waiting || '';
    // And on the bar itself, at every width. A count that only appears on a
    // phone is a count most people never see, and this is the one number the
    // whole design is about.
    const wchip = $('#waiting-chip');
    if (wchip) {
      wchip.hidden = !waiting;
      wchip.textContent = `${waiting} ${t(waiting === 1 ? 'waiting on you' : 'waiting on you')}`;
    }
    const alerts = notif.unread || 0;
    const gdot = document.querySelector('[data-div="company"] .rail-dot');
    if (gdot) gdot.textContent = alerts || '';
    const jdot = document.querySelector('[data-div="work"] .rail-dot');
    if (jdot) jdot.textContent = journeys.filter((j) => j.state === 'awaiting_human').length || '';
  } catch { /* server restarting */ }
}
setInterval(refreshShell, 7000);
export const DEPT_LABEL = {
  gate: 'Run gate', systems: 'System design', social: 'Social media', content: 'Content studio',
  design: 'Design studio', marketing: 'Marketing', relations: 'Relations', support: 'Support desk',
  journeys: 'Journeys', finreports: 'Financial reports', decisions: 'Decisions', legal: 'Legal',
  products: 'Product gates', intel: 'Intelligence', knowledge: 'Knowledge', governance: 'Governance',
  risks: 'Risks', harmony: 'Orchestrator',
};
// ---------- Expansion wave: 16 departments across TRUST/CAPITAL/TALENT/EXEC ----------
export const xbtn = (path, body, label, cls = '') =>
  `<button class="btn btn-sm ${cls}" data-xact="${encodeURIComponent(JSON.stringify({ path, body }))}">${esc(label)}</button>`;
export function wireXact(rerender) {
  view.querySelectorAll('[data-xact]').forEach((b) => b.addEventListener('click', async () => {
    let spec; try { spec = JSON.parse(decodeURIComponent(b.dataset.xact)); } catch { return; }
    b.disabled = true;
    try { await api(spec.path, { method: 'POST', body: spec.body || {} }); toast('Done'); rerender(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
export const preBody = (t) => `<div class="mono" style="white-space:pre-wrap;font-size:11px;color:var(--ink-mute);max-height:260px;overflow:auto;border-left:2px solid var(--edge);padding:6px 10px;margin-top:6px">${esc(t || '')}</div>`;
export const scoreChip = (s) => s == null ? '<span class="chip chip-dim">—</span>'
  : `<span class="chip ${s >= 0.85 ? 'chip-ok' : s >= 0.6 ? 'chip-warn' : 'chip-bad'}">${Math.round(s * 100)}%</span>`;
