/**
 * Guards the browser Sentry entrypoint (`src/instrumentation-client.ts`).
 *
 * Two regressions this locks down:
 *   1. The file must actually call `Sentry.init()` on import — it is the only
 *      client init path now that `sentry.client.config.ts` is deleted.
 *   2. Session Replay must stay OFF. The old config set replay sample rates
 *      without registering `replayIntegration`, which read as "recording is on"
 *      while doing nothing. Enabling it for real would record PII (emails,
 *      phone numbers, pickup addresses) and money, ahead of the analytics
 *      consent gate. If someone re-adds the rates, this test fails and forces
 *      the privacy decision to be made explicitly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserOptions, ErrorEvent } from '@sentry/nextjs';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  init: mocks.init,
  captureRouterTransitionStart: mocks.captureRouterTransitionStart,
}));

async function loadClientInstrumentation() {
  vi.resetModules();
  return import('../../src/instrumentation-client');
}

function initOptions(): BrowserOptions {
  const call = mocks.init.mock.calls[0];
  expect(call).toBeDefined();
  return (call as [BrowserOptions])[0];
}

/** Same cookie name + JSON shape as useCompliance.writeConsentCookie. */
function setConsentCookie(analytics: boolean) {
  document.cookie = `nm:consent=${encodeURIComponent(JSON.stringify({ analytics }))}; path=/`;
}

function clearConsentCookie() {
  document.cookie = 'nm:consent=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

beforeEach(() => {
  vi.clearAllMocks();
  clearConsentCookie();
});

describe('instrumentation-client', () => {
  it('calls Sentry.init exactly once on import', async () => {
    await loadClientInstrumentation();

    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('enables the SDK only in production and keeps tracing sampled', async () => {
    await loadClientInstrumentation();
    const options = initOptions();

    expect(options.enabled).toBe(process.env.NODE_ENV === 'production');
    expect(options.tracesSampleRate).toBe(0.1);
  });

  it('does not configure Session Replay', async () => {
    await loadClientInstrumentation();
    const options = initOptions() as Record<string, unknown>;

    // Dead replay knobs are worse than none: they imply recording is on.
    expect(options['replaysSessionSampleRate']).toBeUndefined();
    expect(options['replaysOnErrorSampleRate']).toBeUndefined();
    expect(options['integrations']).toBeUndefined();
  });

  it('filters known browser non-issues', async () => {
    await loadClientInstrumentation();
    const options = initOptions();

    expect(options.ignoreErrors).toContain('ResizeObserver loop limit exceeded');
    expect(options.ignoreErrors).toContain('Non-Error promise rejection captured');
  });

  it('drops events outside production via beforeSend', async () => {
    await loadClientInstrumentation();
    const { beforeSend } = initOptions();
    expect(beforeSend).toBeTypeOf('function');

    const event = { event_id: 'abc' } as ErrorEvent;
    const result = beforeSend?.(event, {});

    // NODE_ENV is 'test' under vitest, so the guard must swallow the event.
    expect(result).toBeNull();
  });

  // Since e076df18 (ASR-5.1.1.ii / 5.1.2.i) Sentry is opt-in analytics:
  // production alone is not enough, the visitor must have accepted analytics
  // in the consent cookie.
  it('forwards events to Sentry in production once analytics consent is granted', async () => {
    setConsentCookie(true);
    await loadClientInstrumentation();
    const { beforeSend } = initOptions();
    expect(beforeSend).toBeTypeOf('function');

    vi.stubEnv('NODE_ENV', 'production');
    try {
      const event = { event_id: 'abc' } as ErrorEvent;
      expect(beforeSend?.(event, {})).toBe(event);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('drops events in production when analytics consent is missing or refused', async () => {
    await loadClientInstrumentation();
    const { beforeSend } = initOptions();
    expect(beforeSend).toBeTypeOf('function');

    vi.stubEnv('NODE_ENV', 'production');
    try {
      const event = { event_id: 'abc' } as ErrorEvent;
      // No cookie at all.
      expect(beforeSend?.(event, {})).toBeNull();
      // Explicit refusal — re-checked per event, so no reload is needed.
      setConsentCookie(false);
      expect(beforeSend?.(event, {})).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('exports onRouterTransitionStart so App Router navigations are traced', async () => {
    const { onRouterTransitionStart } = await loadClientInstrumentation();

    expect(onRouterTransitionStart).toBe(mocks.captureRouterTransitionStart);
  });
});
