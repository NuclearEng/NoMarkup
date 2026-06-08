// NoMarkup service worker — PWA shell + Web Push receiver.
//
// Three responsibilities:
//   1. Cache /_next/static/ + /icons/ assets stale-while-revalidate so the
//      app remains usable on a flaky connection (offline-first navigation
//      to already-visited pages).
//   2. Receive `push` events delivered by the browser's push service and
//      forward them to the OS via showNotification(). Payload shape is
//      controlled by services/notification/internal/service/web_push.go:
//      { title, body, url, tag }.
//   3. On `notificationclick`, focus an existing client at the target URL
//      or open a new one — matches Whatnot/eBay tap-to-deep-link behavior.
//
// skipWaiting + clients.claim are intentional: when we ship a new SW
// build we want it to take over immediately, otherwise users would need
// to close every tab to pick up notification handler changes. The cache
// version is bumped to invalidate stale entries.

const CACHE_VERSION = 'nomarkup-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any caches not matching the current version. Keeps the SW
      // storage budget bounded as we ship updates.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Stale-while-revalidate for /_next/static/ + /icons/. Everything else
// passes through to the network — we don't want to serve stale HTML or
// stale API responses, only immutable build artifacts.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json';

  if (!isStatic) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => undefined);
      return cached || (await networkPromise) || Response.error();
    })(),
  );
});

// Web Push receiver. Payload shape is set by web_push.go:
//   { title: string, body: string, url?: string, tag?: string }
// We default to a minimal notification when the payload is missing or
// malformed — the user still sees something so they know to open the app.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      try {
        data = { title: 'NoMarkup', body: event.data.text() };
      } catch {
        data = {};
      }
    }
  }

  const title = data.title || 'NoMarkup';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'nomarkup-default',
    data: { url: data.url || '/' },
    renotify: Boolean(data.tag),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap-to-deep-link. Reuses an open tab when one already points at the
// target URL; otherwise opens a fresh window. Matches the UX users
// expect from native apps.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetURL = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try {
          const clientURL = new URL(client.url);
          const target = new URL(targetURL, self.location.origin);
          if (clientURL.pathname === target.pathname && 'focus' in client) {
            return client.focus();
          }
        } catch {
          // ignore unparseable URLs
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetURL);
      }
      return undefined;
    })(),
  );
});
