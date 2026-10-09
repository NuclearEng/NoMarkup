/**
 * Browser-side Sentry initialization.
 *
 * WHY THIS FILE AND NOT `sentry.client.config.ts`:
 *   Verified against the installed SDK (@sentry/nextjs 10.49.0). Its build
 *   plugin (`build/cjs/config/webpack.js`) injects the browser init file into
 *   the `main-app` / `pages/_app` webpack entrypoints, and it looks for BOTH
 *   `sentry.client.config.{ts,js}` and `{src/,}instrumentation-client.{ts,js}` —
 *   injecting every match, so keeping both files would call `Sentry.init()`
 *   twice. It also logs a deprecation warning for `sentry.client.config.*` and
 *   states plainly that the file "will no longer work" under Turbopack.
 *
 *   This project runs `next dev --turbopack` (package.json), so the legacy file
 *   was dead in development. `instrumentation-client.ts` is a first-class
 *   Next.js file convention since 15.3 (this repo is on 15.5.19), loaded by the
 *   framework itself under both webpack and Turbopack. `sentry.client.config.ts`
 *   has been deleted so exactly one init path exists.
 *
 * CONSENT GATE (ASR-5.1.1.ii / ASR-5.1.2.i):
 *   Sentry is classified as opt-in analytics in CookieConsent. We read the
 *   `nm:consent` cookie (same JSON shape as useCompliance.writeConsentCookie).
 *   When missing or analytics=false, Sentry stays disabled and beforeSend
 *   drops every event. When analytics=true, production behavior is unchanged.
 *   Keep cookie name + JSON fields in lockstep with useCompliance.ts.
 *
 * SESSION REPLAY IS DELIBERATELY NOT ENABLED.
 *   The previous config set `replaysSessionSampleRate` / `replaysOnErrorSampleRate`
 *   without ever registering `replayIntegration`, so those numbers were inert —
 *   dead configuration that read as if session recording were on. Rather than
 *   make them real, they are removed. Three reasons:
 *     1. Privacy: this app renders PII (emails, phone numbers, pickup addresses)
 *        and money on nearly every authenticated route. Replay would need
 *        `maskAllText` + `blockAllMedia` at minimum, and CLAUDE.md §6 treats PII
 *        as encrypted-at-rest — shipping raw session recordings of it by default
 *        contradicts that posture.
 *     2. Consent: `components/compliance/CookieConsent.tsx` classifies Sentry as
 *        opt-in analytics. Recording sessions before that opt-in is honored is
 *        not something to enable silently.
 *     3. Budget: the Replay integration adds a large chunk to the client bundle,
 *        and CLAUDE.md §8 caps initial JS at 200 KB gz against a shared First
 *        Load already ~183 KB.
 *   If Replay is wanted later it must land behind the analytics consent gate,
 *   with `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })`
 *   and session sampling at 0 (errors-only), plus a measured bundle delta.
 */
import * as Sentry from '@sentry/nextjs';

/** Mirrors `CONSENT_COOKIE_NAME` in hooks/useCompliance.ts — do not drift. */
const CONSENT_COOKIE_NAME = 'nm:consent';

/**
 * Parse `nm:consent` for analytics opt-in. Defaults to false (opt-in posture).
 * ASR-5.1.1.ii / ASR-5.1.2.i.
 */
function hasAnalyticsConsentFromCookie(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!match) return false;
  const raw = match.slice(`${CONSENT_COOKIE_NAME}=`.length);
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { analytics?: boolean };
    return parsed.analytics === true;
  } catch {
    return false;
  }
}

const analyticsConsentGranted = hasAnalyticsConsentFromCookie();

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Production + explicit analytics consent only (ASR-5.1.1.ii / 5.1.2.i).
  enabled: process.env.NODE_ENV === 'production' && analyticsConsentGranted,

  // Performance monitoring — sample 10% of transactions when enabled.
  tracesSampleRate: 0.1,

  // Filter out known non-issues.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
  ],

  beforeSend(event: Sentry.ErrorEvent) {
    // Defense in depth: even if enabled flips later in-session, re-check
    // consent on every event so Reject-all after Accept-all cannot leave
    // residual telemetry until reload.
    if (process.env.NODE_ENV !== 'production') {
      return null;
    }
    if (!hasAnalyticsConsentFromCookie()) {
      return null;
    }
    return event;
  },
});

/**
 * App Router navigation instrumentation. Without this export, client-side route
 * transitions are missing from traces (the SDK cannot hook Next's router
 * otherwise) — it is the documented companion to `instrumentation-client.ts`.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
