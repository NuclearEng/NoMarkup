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
