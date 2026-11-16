'use client';

// ServiceWorkerRegistrar — SW lifecycle cleanup, run once on mount. Kept as
// its own client component so the root layout can stay async/server-rendered.
//
// IMPORTANT: registration of /sw.js is intentionally DISABLED in every
// environment while /public/sw.js is the temporary self-destruct
// ("kill-switch") build — see the header comment in web/public/sw.js.
// Registering that worker in production created an infinite hard-reload
// loop: register → install(skipWaiting) → activate → unregister +
// client.navigate() → page remounts → register again → ∞.
//
// The kill-switch's actual goal — evicting stuck old cache-first SWs and
// their stale chunk caches — is achieved here purely from the page, with no
// service worker in the loop: unregister every existing registration and
// purge every cache, in dev AND production alike.
//
// Re-introduce `navigator.serviceWorker.register('/sw.js', { scope: '/' })`
// (production-only) ONLY when a real PWA service worker (asset caching +
// Web Push) replaces the kill-switch build in web/public/sw.js.
//
// Failures are logged and swallowed: SW/cache cleanup must not crash the app
// (e.g. private-mode browsers, http://localhost without HTTPS in some
// configurations, browsers without serviceWorker support).

import { useEffect } from 'react';

export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Same cleanup in dev and prod: a cache-first SW serving stale JS chunks
    // (e.g. an old env-inlined token) past hard reloads is wrong in both.
    // This is the page-side equivalent of the kill-switch SW, minus the
    // forced navigation that caused the reload loop.
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        // Non-fatal — cleanup is best-effort.
      }
    })();
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;
