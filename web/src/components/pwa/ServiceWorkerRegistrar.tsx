'use client';

// ServiceWorkerRegistrar — registers /sw.js once on mount. Kept as its
// own client component so the root layout can stay async/server-rendered.
// Failures are logged and swallowed: a missing SW must not crash the app
// (e.g. private-mode browsers, http://localhost without HTTPS in some
// configurations, browsers without serviceWorker support).

import { useEffect } from 'react';

export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // In development a cache-first SW serves stale JS chunks (e.g. an old env-
    // inlined token) past hard reloads, which is confusing to debug. Only run
    // the PWA SW in production; in dev, actively unregister any existing SW and
    // purge its caches so the dev bundle is always fresh.
    if (process.env.NODE_ENV !== 'production') {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {
          // Non-fatal — dev cleanup is best-effort.
        }
      })();
      return;
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // Non-fatal: PWA features degrade, the app still works. The
        // failure surfaces in the browser DevTools "Application" panel
        // when developers debug locally.
      }
    };
    void register();
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;
