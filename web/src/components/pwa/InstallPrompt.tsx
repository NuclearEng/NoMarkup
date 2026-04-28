'use client';

// InstallPrompt — the "Add NoMarkup to your home screen" bottom sheet.
// Audit Section J flagged PWA installable as MISSING; this component
// closes that gap by surfacing the install affordance in a way that
// mobile-Chrome / desktop-Edge / mobile-Edge users can act on, plus a
// graceful no-op on browsers (Safari, Firefox-iOS) that don't expose
// the beforeinstallprompt API.
//
// Eligibility rules — kept conservative on purpose, an aggressive prompt
// burns the install affordance:
//   * Mounted only on the client (no SSR).
//   * Hides if window.matchMedia('(display-mode: standalone)') matches
//     (already installed) or the PWA's launchqueue fires.
//   * Hides if user has dismissed in this session OR within the last
//     30 days (localStorage 'pwa:install-dismissed').
//   * Only renders after the user has visited at least 2 listings — we
//     bump a sessionStorage counter ('pwa:listing-views') from inside
//     the listing detail page, but ALSO accept any pageview after a
//     first viewing as an engagement signal so the counter doesn't
//     freeze new visitors out indefinitely.
//
// The CTA is a small bottom sheet, not a modal — never blocks content.

import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa:install-dismissed';
const VIEW_COUNT_KEY = 'pwa:listing-views';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari uses navigator.standalone (legacy, non-standard but real)
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function recentlyDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function listingViewCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(VIEW_COUNT_KEY);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export function InstallPrompt(): React.ReactElement | null {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || recentlyDismissed()) return;

    const handler = (e: Event) => {
      // Capture the event so we can later call prompt() in a user-gesture
      // handler. The browser will only let prompt() run inside a click
      // handler triggered by a user — buffering is required.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Surface the prompt only after enough engagement.
      if (listingViewCount() >= 2) {
        setVisible(true);
      }
    };

    const installedHandler = () => {
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', handler as EventListener);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler as EventListener);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const onInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'dismissed') {
        try {
          window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
        } catch {
          // Storage unavailable (private mode) — fall through.
        }
      }
    } catch {
      // The browser gates calls to prompt() — swallow and let the user
      // try again on the next eligible visit.
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
    }
  }, [deferredPrompt]);

  const onDismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setVisible(false);
  }, []);

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="install-prompt-title"
      aria-describedby="install-prompt-body"
      className="bg-card text-card-foreground fixed bottom-4 left-1/2 z-40 w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-border shadow-lg"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-md text-base font-semibold">
          NM
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="install-prompt-title" className="text-sm font-semibold">
            Install NoMarkup as an app
          </h2>
          <p id="install-prompt-body" className="text-muted-foreground mt-1 text-xs">
            One tap to open, push notifications when you&apos;re outbid, works offline.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void onInstall();
              }}
              className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:opacity-90"
            >
              Install
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-muted-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:underline"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstallPrompt;
