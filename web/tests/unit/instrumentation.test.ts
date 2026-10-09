/**
 * Guards the Next.js server instrumentation hook.
 *
 * The bug this locks down: @sentry/nextjs v9+ stopped auto-injecting the
 * server/edge `Sentry.init()` files, so `register()` must import them itself.
 * When it doesn't, the app compiles and boots perfectly while every Server
 * Component / route handler / server action error is dropped on the floor.
 * "It type-checks" proves nothing here, so these tests assert the side effect:
 * the config module is actually evaluated, and `onRequestError` is exported and
 * wired to the SDK's request-error handler.
 *
 * `vi.doMock` (not `vi.mock`) is deliberate: hoisted `vi.mock` factories are
 * evaluated once per test FILE, so they cannot tell us whether a given
 * `register()` call reached the import. `vi.resetModules()` + `vi.doMock`
 * re-runs the factory for every load, making evaluation observable per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  serverConfigEvaluated: vi.fn(),
  edgeConfigEvaluated: vi.fn(),
  validateServerEnv: vi.fn(),
  captureRequestError: vi.fn(),
  registerNodeOtel: vi.fn().mockResolvedValue({ enabled: false, reason: 'unset' }),
};

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;
const ORIGINAL_PHASE = process.env['NEXT_PHASE'];

function setEnv(runtime: string | undefined, phase?: string): void {
  if (runtime === undefined) {
    delete process.env.NEXT_RUNTIME;
  } else {
    process.env.NEXT_RUNTIME = runtime;
  }
  if (phase === undefined) {
    delete process.env['NEXT_PHASE'];
  } else {
    process.env['NEXT_PHASE'] = phase;
  }
}

async function loadInstrumentation() {
  vi.resetModules();
  vi.doMock('../../sentry.server.config', () => {
    mocks.serverConfigEvaluated();
    return {};
  });
  vi.doMock('../../sentry.edge.config', () => {
    mocks.edgeConfigEvaluated();
    return {};
  });
  vi.doMock('../../src/lib/server/env', () => ({
    validateServerEnv: mocks.validateServerEnv,
  }));
  vi.doMock('../../src/lib/otel/register-node', () => ({
    registerNodeOtel: mocks.registerNodeOtel,
  }));
  vi.doMock('@sentry/nextjs', () => ({
    captureRequestError: mocks.captureRequestError,
  }));
  return import('../../src/instrumentation');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setEnv(ORIGINAL_RUNTIME, ORIGINAL_PHASE);
});

describe('instrumentation register()', () => {
  it('initializes the Sentry Node SDK on the nodejs runtime', async () => {
    setEnv('nodejs');
    const { register } = await loadInstrumentation();

    await register();

    expect(mocks.serverConfigEvaluated).toHaveBeenCalledTimes(1);
    expect(mocks.edgeConfigEvaluated).not.toHaveBeenCalled();
  });

  it('validates server env after Sentry init on the nodejs runtime', async () => {
    setEnv('nodejs');
    const { register } = await loadInstrumentation();

    await register();

    expect(mocks.validateServerEnv).toHaveBeenCalledTimes(1);
  });

  it('registers optional Node OpenTelemetry after Sentry on the nodejs runtime', async () => {
    setEnv('nodejs');
    const { register } = await loadInstrumentation();

    await register();

    expect(mocks.registerNodeOtel).toHaveBeenCalledTimes(1);
    // Env validation still runs — OTel failures must not skip it.
    expect(mocks.validateServerEnv).toHaveBeenCalledTimes(1);
  });

  it('initializes the Sentry Edge SDK on the edge runtime and skips env validation', async () => {
    setEnv('edge');
    const { register } = await loadInstrumentation();

    await register();

    expect(mocks.edgeConfigEvaluated).toHaveBeenCalledTimes(1);
    expect(mocks.serverConfigEvaluated).not.toHaveBeenCalled();
    // The edge runtime has its own restricted env — the full server set does
    // not apply and must never be enforced there.
    expect(mocks.validateServerEnv).not.toHaveBeenCalled();
  });

  it('does nothing on an unknown runtime (browser/build tooling)', async () => {
    setEnv(undefined);
    const { register } = await loadInstrumentation();

    await register();

    expect(mocks.serverConfigEvaluated).not.toHaveBeenCalled();
    expect(mocks.edgeConfigEvaluated).not.toHaveBeenCalled();
    expect(mocks.validateServerEnv).not.toHaveBeenCalled();
    expect(mocks.registerNodeOtel).not.toHaveBeenCalled();
  });

  it('still initializes Sentry during the production build phase but skips env validation', async () => {
    setEnv('nodejs', 'phase-production-build');
    const { register } = await loadInstrumentation();

    await register();

    // Build-time static generation errors should still reach Sentry...
    expect(mocks.serverConfigEvaluated).toHaveBeenCalledTimes(1);
    // ...but env validation is a runtime gate; build workers must not trip it.
    expect(mocks.validateServerEnv).not.toHaveBeenCalled();
    // OTel must not open exporter sockets in build workers either.
    expect(mocks.registerNodeOtel).not.toHaveBeenCalled();
  });

  it('propagates a fatal env validation failure instead of swallowing it', async () => {
    setEnv('nodejs');
    mocks.validateServerEnv.mockImplementationOnce(() => {
      throw new Error('missing API_URL');
    });
    const { register } = await loadInstrumentation();

    await expect(register()).rejects.toThrow('missing API_URL');
    // Sentry was initialized first, so its global handlers can report the throw.
    expect(mocks.serverConfigEvaluated).toHaveBeenCalledTimes(1);
  });
});

describe('instrumentation onRequestError', () => {
  it('is exported and delegates to the Sentry request-error handler', async () => {
    setEnv('nodejs');
    const { onRequestError } = await loadInstrumentation();

    // Next.js will only report RSC/route-handler errors if this export exists.
    expect(onRequestError).toBe(mocks.captureRequestError);
  });
});
