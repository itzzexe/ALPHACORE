// The service worker exists for one reason: so the app opens from a home
// screen without a network round trip, and shows something honest when there
// is no network at all. It is deliberately conservative.
//
// Network first, cache second. A cache-first worker is faster, and it is also
// how you end up serving last week's app.js to somebody who just upgraded and
// cannot work out why nothing changed. An operations console must never lie
// about which version you are looking at, so the network always gets the first
// word and the cache only speaks when the network cannot.
//
// Nothing under /api is cached, ever. A stale run count or a cached approval
// queue is worse than an error message — it looks like the truth.
const VERSION = 'alphacore-v3';

// Enough to paint the shell and reach the login screen offline.
//
// The console is native ES modules with no build step, so the browser fetches
// each one by name — and a precache list naming only /app.js would cache the
// entry point and none of what it imports, which is worse than caching nothing:
// the shell would load offline and then fail on its first import. Everything
// app.js reaches at start-up is listed.
//
// The department modules are *not* here on purpose. They are large, most
// people open a handful of the hundred and forty, and the fetch handler is
// network-first with a cache fallback — so a page you have visited is offline
// anyway, and one you never opened does not cost you the download.
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/app.js',
  '/i18n.js',
  '/core/dom.js',
  '/core/shell.js',
  '/state/session.js',
  '/services/api.js',
  '/router/registry.js',
  '/components/tile.js',
  '/components/common.js',
  '/components/chrome.js',
  '/components/bits.js',
  '/components/widgets.js',
  '/components/dept-page.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // addAll is all-or-nothing; one missing file would leave the app with no
      // worker at all, so each file is allowed to fail on its own.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live data, the websocket handshake, and the liveness probe all go straight
  // to the network. If they fail, they should fail visibly.
  if (url.pathname.startsWith('/api/') || url.pathname === '/live' || url.pathname === '/mcp') return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      // Only keep what came back whole. A 404 in the cache is a 404 forever.
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => { /* quota, private mode */ });
      }
      return fresh;
    } catch {
      const hit = await caches.match(request);
      if (hit) return hit;
      // A navigation with nothing cached still deserves the shell rather than
      // the browser's dinosaur: the app can then say what is wrong in its own
      // words, in the reader's own language.
      if (request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});

// ---------------------------------------------------------------------------
// Push.
//
// The company's throughput is bounded by how fast a human answers a gate, and
// a person who is not looking at a tab cannot answer one. This is the only
// part of the app that can reach them there.
//
// The payload carries a title, a line and a route — never a record. It is
// end-to-end encrypted and the push service cannot read it, but it still
// crosses a machine we do not own, and "an approval is waiting" is all anybody
// needs from a lock screen.
// ---------------------------------------------------------------------------
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { title: 'AlphaCore', body: e.data?.text?.() || '' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'AlphaCore', {
    body: msg.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Same tag replaces rather than stacks: five reminders about one approval
    // is how people learn to swipe the whole app away.
    tag: msg.tag || msg.route || 'alphacore',
    renotify: Boolean(msg.renotify),
    requireInteraction: msg.urgency === 'high',
    dir: 'auto',
    data: { route: msg.route || '/', at: Date.now() },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const route = e.notification.data?.route || '/';
  const url = new URL(route.startsWith('#') ? `/${route}` : route, self.location.origin).href;
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse the tab that is already open rather than piling up new ones.
    for (const c of windows) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// A subscription can expire on its own; when it does, ask for a new one and
// hand it back, so a phone does not go quietly deaf.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const key = await (await fetch('/api/push/key')).json();
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.publicKey,
      });
      await fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ old: e.oldSubscription?.endpoint || null, subscription: sub }),
      });
    } catch { /* the next sign-in will re-subscribe */ }
  })());
});
