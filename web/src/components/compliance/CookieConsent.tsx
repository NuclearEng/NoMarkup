'use client';

// Cookie consent banner — appears on first visit, hides after Save.
//
// Three categories:
//   - necessary  (always on; ePrivacy "strictly necessary")
//   - analytics  (Plausible/Sentry — opt-in)
//   - marketing  (push, retargeting — opt-in)
//
// Save POSTs to /api/v1/cookie-consent and writes the `nm:consent` cookie
// so the banner doesn't reappear. Reject-All is a Save with both opt-ins
// off; Accept-All is a Save with both opt-ins on.
//
// Mounted globally in app/layout.tsx, side-by-side with InstallPrompt.

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  hasConsentCookie,
  useLogCookieConsent,
  writeConsentCookie,
} from '@/hooks/useCompliance';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  // ASR-5.1.1.ii / ASR-5.1.2.i — analytics is opt-in (default off). Marketing too.
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const log = useLogCookieConsent();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!hasConsentCookie()) {
      setVisible(true);
    }
  }, []);

  function save(opts: { analytics: boolean; marketing: boolean }) {
    const payload = {
      necessary: true,
      analytics: opts.analytics,
      marketing: opts.marketing,
    };
    writeConsentCookie(payload);
    log.mutate(payload);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      aria-modal="false"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-3 z-[60] mx-auto max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md sm:inset-x-auto sm:left-6 sm:mx-0 sm:p-5"
      style={{
        // Clear iPhone home indicator + authenticated bottom tab bar when present
        bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <h2 className="mb-1 text-sm font-semibold text-white">Cookie preferences</h2>
      <p className="text-xs text-zinc-400">
        We use strictly necessary cookies to keep the site working. Analytics
        and marketing cookies are optional — your choice, anytime.
      </p>

      <div className="mt-3 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-300">
        <label className="flex min-h-[44px] items-center justify-between gap-3 py-1">
          <span>
            <span className="font-medium text-zinc-200">Necessary</span>
            <span className="ml-2 text-zinc-400">Required for sign-in & checkout</span>
          </span>
          <input
            type="checkbox"
            checked
            disabled
            aria-label="Necessary cookies (always on)"
            className="h-5 w-5 shrink-0 accent-[var(--brand-gold)]"
          />
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1">
          <span>
            <span className="font-medium text-zinc-200">Analytics</span>
            <span className="ml-2 text-zinc-400">Helps us improve the product</span>
          </span>
          <input
            type="checkbox"
            checked={analytics}
            aria-label="Allow analytics cookies"
            data-testid="cookie-consent-analytics"
            onChange={(e) => {
              setAnalytics(e.target.checked);
            }}
            className="h-5 w-5 shrink-0 accent-[var(--brand-gold)]"
          />
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1">
          <span>
            <span className="font-medium text-zinc-200">Marketing</span>
            <span className="ml-2 text-zinc-400">Personalized recommendations</span>
          </span>
          <input
            type="checkbox"
            checked={marketing}
            aria-label="Allow marketing cookies"
            data-testid="cookie-consent-marketing"
            onChange={(e) => {
              setMarketing(e.target.checked);
            }}
            className="h-5 w-5 shrink-0 accent-[var(--brand-gold)]"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] sm:min-w-[120px]"
          data-testid="cookie-consent-reject"
          onClick={() => {
            save({ analytics: false, marketing: false });
          }}
        >
          Reject all
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] sm:min-w-[120px]"
          data-testid="cookie-consent-save"
          onClick={() => {
            save({ analytics, marketing });
          }}
        >
          Save preferences
        </Button>
        <Button
          type="button"
          className="min-h-[44px] sm:min-w-[120px]"
          data-testid="cookie-consent-accept"
          onClick={() => {
            save({ analytics: true, marketing: true });
          }}
        >
          Accept all
        </Button>
      </div>
    </div>
  );
}
