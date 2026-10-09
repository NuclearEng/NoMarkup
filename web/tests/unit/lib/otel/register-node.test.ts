import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetNodeOtelRegistrationForTests,
  resolveOtlpHttpTracesUrl,
} from '@/lib/otel/register-node';

describe('resolveOtlpHttpTracesUrl', () => {
  it('appends /v1/traces and rewrites gRPC 4317 → HTTP 4318', () => {
    expect(resolveOtlpHttpTracesUrl('http://localhost:4317')).toBe(
      'http://localhost:4318/v1/traces',
    );
    expect(resolveOtlpHttpTracesUrl('http://otel-collector:4317')).toBe(
      'http://otel-collector:4318/v1/traces',
    );
  });

  it('leaves an explicit 4318 endpoint alone (still adds path)', () => {
    expect(resolveOtlpHttpTracesUrl('http://localhost:4318')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('does not double-append /v1/traces', () => {
    expect(resolveOtlpHttpTracesUrl('http://localhost:4318/v1/traces')).toBe(
      'http://localhost:4318/v1/traces',
    );
  });

  it('adds http scheme when missing', () => {
    expect(resolveOtlpHttpTracesUrl('otel-collector:4317')).toBe(
      'http://otel-collector:4318/v1/traces',
    );
  });
});

describe('registerNodeOtel', () => {
  beforeEach(() => {
    __resetNodeOtelRegistrationForTests();
    vi.resetModules();
  });

  afterEach(() => {
    __resetNodeOtelRegistrationForTests();
    vi.doUnmock('@opentelemetry/sdk-trace-node');
    vi.doUnmock('@opentelemetry/exporter-trace-otlp-http');
    vi.doUnmock('@opentelemetry/resources');
    vi.doUnmock('@opentelemetry/semantic-conventions');
    vi.doUnmock('@opentelemetry/api');
    vi.doUnmock('@opentelemetry/core');
    vi.restoreAllMocks();
  });

  it('is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    const { registerNodeOtel } = await import('@/lib/otel/register-node');
    const result = await registerNodeOtel({ NODE_ENV: 'development' });
    expect(result).toEqual({ enabled: false, reason: 'unset' });
  });

  it('skips registration during next production build phase', async () => {
    const { registerNodeOtel } = await import('@/lib/otel/register-node');
    const result = await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
      NEXT_PHASE: 'phase-production-build',
    });
    expect(result).toEqual({ enabled: false, reason: 'build-phase' });
  });

  it('registers a TracerProvider when endpoint is set (mocked SDK)', async () => {
    const register = vi.fn();
    const setGlobalPropagator = vi.fn();
    const getTracer = vi.fn();

    vi.doMock('@opentelemetry/sdk-trace-node', () => ({
      NodeTracerProvider: class {
        constructor(_opts: unknown) {
          /* noop */
        }
        register = register;
      },
      BatchSpanProcessor: class {
        constructor(_exporter: unknown) {
          /* noop */
        }
      },
    }));
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: class {
        constructor(_opts: unknown) {
          /* noop */
        }
      },
    }));
    vi.doMock('@opentelemetry/resources', () => ({
      resourceFromAttributes: (attrs: unknown) => attrs,
    }));
    vi.doMock('@opentelemetry/semantic-conventions', () => ({
      ATTR_SERVICE_NAME: 'service.name',
    }));
    vi.doMock('@opentelemetry/api', () => ({
      trace: { getTracer },
      propagation: { setGlobalPropagator },
    }));
    vi.doMock('@opentelemetry/core', () => ({
      W3CTraceContextPropagator: class {},
    }));

    const { registerNodeOtel, __resetNodeOtelRegistrationForTests: reset } =
      await import('@/lib/otel/register-node');
    reset();

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
      OTEL_SERVICE_NAME: 'nomarkup-web-test',
    });

    expect(result).toEqual({
      enabled: true,
      serviceName: 'nomarkup-web-test',
      endpoint: 'http://localhost:4318/v1/traces',
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(setGlobalPropagator).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalled();
  });

  it('returns error result instead of throwing when SDK load fails', async () => {
    vi.doMock('@opentelemetry/sdk-trace-node', () => {
      throw new Error('simulated sdk load failure');
    });
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({}));
    vi.doMock('@opentelemetry/resources', () => ({}));
    vi.doMock('@opentelemetry/semantic-conventions', () => ({}));
    vi.doMock('@opentelemetry/api', () => ({}));
    vi.doMock('@opentelemetry/core', () => ({}));

    const { registerNodeOtel, __resetNodeOtelRegistrationForTests: reset } =
      await import('@/lib/otel/register-node');
    reset();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      registerNodeOtel({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
      }),
    ).resolves.toEqual({ enabled: false, reason: 'error' });
    expect(warnSpy).toHaveBeenCalled();
  });
});
