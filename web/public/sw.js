// NoMarkup service worker — TEMPORARY self-destruct ("kill-switch") build.
//
// Why: a previous cache-first SW (nomarkup-v1/v2) cached /_next/static/ chunks
// stale-while-revalidate. In dev that pinned an old env-inlined Mapbox token
// (the 401 dark-v11 errors) past hard reloads, because the SW kept serving the
// stale bundle. A version bump alone wasn't enough to evict a stuck SW, so this
// build actively unregisters itself and purges every cache, then force-reloads
// any open tab onto the fresh network build.
//
// The PWA SW (asset caching + Web Push) will be reintroduced behind a
// production-only registration once the stale caches are cleared everywhere.

self.addEventListener('install', () => {
  // Take over immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete every cache this origin holds (drops the stale chunk cache).
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));

      // 2. Take control of open clients, then unregister this worker so no SW
      //    intercepts fetches anymore — the browser goes straight to network.
      await self.clients.claim();
      await self.registration.unregister();

      // 3. Reload any open window so it re-fetches the fresh build (with the
      //    correct token) directly from the dev/prod server, no SW in the path.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        if ('navigate' in client) {
          try {
            await client.navigate(client.url);
          } catch {
            // ignore — best effort
          }
        }
      }
    })(),
  );
});

// No fetch/push/notification handlers: this worker exists only to evict itself.
