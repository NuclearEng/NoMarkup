// NoMarkup service worker — TEMPORARY self-destruct ("kill-switch") build.
//
// Why: a previous cache-first SW (nomarkup-v1/v2) cached /_next/static/ chunks
// stale-while-revalidate. In dev that pinned an old env-inlined Mapbox token
// (the 401 dark-v11 errors) past hard reloads, because the SW kept serving the
// stale bundle. A version bump alone wasn't enough to evict a stuck SW, so this
// build actively unregisters itself and purges every cache.
//
// IMPORTANT — reload-loop guard: this worker must NEVER be registered by the
// app while it is the kill-switch build (ServiceWorkerRegistrar.tsx no longer
// registers it; the page performs the unregister + cache purge itself).
// Registering it caused an infinite hard-reload loop in production:
// register → install(skipWaiting) → activate → unregister + client.navigate()
// → page remounts → register again → ∞.
//
// As a second belt, the force-navigate step below only runs when this worker
// actually REPLACED a predecessor SW (the genuine kill-switch case, where open
// tabs are still controlled by a stale worker and need a clean reload). When
// it was registered fresh onto a page with no prior SW — the accidental case —
// it still purges caches and unregisters, but does NOT navigate clients, so no
// loop is possible.
//
// The PWA SW (asset caching + Web Push) will be reintroduced behind a
// production-only registration once the stale caches are cleared everywhere.

// True when, at install time, an older SW was active for this registration —
// i.e. this kill-switch build is genuinely replacing a stuck predecessor.
let hadPredecessor = false;

self.addEventListener('install', () => {
  // self.registration.active is the OLD worker (if any) while this one is
  // still installing. Record it before skipWaiting() swaps us in.
  hadPredecessor = Boolean(self.registration.active);
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

      // 3. ONLY when we replaced a stale predecessor: reload any open window
      //    so it re-fetches the fresh build directly from the server, no SW in
      //    the path. Skipped on accidental fresh registration (no predecessor)
      //    to make a register → activate → reload → register loop impossible.
      if (!hadPredecessor) return;

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
