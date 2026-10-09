'use client';

// InstallPrompt — PWA "Add to home screen" affordance.
//
// FE-05 / PERF-04: DISABLED while web/public/sw.js is the temporary
// kill-switch build and ServiceWorkerRegistrar intentionally does NOT
// register a real PWA worker (asset caching + Web Push). Browsers only
// fire `beforeinstallprompt` when a controlling SW + valid manifest exist;
// advertising install without a real SW would be dishonest.
//
// When a production PWA service worker replaces the kill-switch and
// ServiceWorkerRegistrar re-enables `navigator.serviceWorker.register`,
// restore the install UI (see git history for the full beforeinstallprompt
// + engagement-gated bottom-sheet implementation). Until then this
// component is a documented no-op so layout can keep the mount point.

/**
 * PWA install UI is gated off until a real service worker ships.
 * Always returns null.
 */
export function InstallPrompt(): null {
  return null;
}

export default InstallPrompt;
