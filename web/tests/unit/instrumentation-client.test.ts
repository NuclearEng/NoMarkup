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

beforeEach(() => {
  vi.clearAllMocks();
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

  it('forwards events to Sentry when running in production', async () => {
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

  it('exports onRouterTransitionStart so App Router navigations are traced', async () => {
    const { onRouterTransitionStart } = await loadClientInstrumentation();

    expect(onRouterTransitionStart).toBe(mocks.captureRouterTransitionStart);
  });
});
