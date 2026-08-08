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
const VERSION = 'alphacore-v1';

// Enough to paint the shell and reach the login screen offline.
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/i18n.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
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
