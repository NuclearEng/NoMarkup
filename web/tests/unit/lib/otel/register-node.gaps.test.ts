// register-node — endpoint normalization edge cases, the already-registered
// short-circuit (and what it reports), the service-name default, and a
// registration failure that is not an Error instance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetNodeOtelRegistrationForTests,
  registerNodeOtel,
  resolveOtlpHttpTracesUrl,
} from '@/lib/otel/register-node';

const sdk = vi.hoisted(() => ({
  register: vi.fn(),
  exporterUrls: [] as string[],
  resourceAttributes: [] as Record<string, unknown>[],
  setGlobalPropagator: vi.fn(),
  getTracer: vi.fn(),
  /** When set, constructing the exporter throws this value. */
  exporterFailure: { value: undefined as unknown, armed: false },
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: class {
    register = sdk.register;
  },
  BatchSpanProcessor: class {
    readonly kind = 'batch-span-processor';
  },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    readonly kind = 'otlp-http-exporter';

    constructor(options: { url: string }) {
      if (sdk.exporterFailure.armed) {
        // May be a non-Error on purpose: the source has a branch for that.
        throw sdk.exporterFailure.value as Error;
      }
      sdk.exporterUrls.push(options.url);
    }
  },
}));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attributes: Record<string, unknown>) => {
    sdk.resourceAttributes.push(attributes);
    return attributes;
  },
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
}));

vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: sdk.getTracer },
  propagation: { setGlobalPropagator: sdk.setGlobalPropagator },
}));

vi.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: class {
    readonly kind = 'w3c-propagator';
  },
}));

let info: { mock: { calls: unknown[][] } };
let warn: { mock: { calls: unknown[][] } };

function logged(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

beforeEach(() => {
  __resetNodeOtelRegistrationForTests();
  vi.clearAllMocks();
  sdk.exporterUrls.length = 0;
  sdk.resourceAttributes.length = 0;
  sdk.exporterFailure.armed = false;
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  __resetNodeOtelRegistrationForTests();
  vi.restoreAllMocks();
});

describe('resolveOtlpHttpTracesUrl', () => {
  it.each(['', '   ', '///'])('returns an empty string for %j (nothing to export to)', (raw) => {
    expect(resolveOtlpHttpTracesUrl(raw)).toBe('');
  });

  it.each([
    ['trailing slashes', 'http://collector:4318///', 'http://collector:4318/v1/traces'],
    ['surrounding whitespace', '  https://otel.example.com  ', 'https://otel.example.com/v1/traces'],
    ['4317 before a path', 'http://collector:4317/otlp', 'http://collector:4318/otlp/v1/traces'],
    ['a port that only starts with 4317', 'http://collector:43170', 'http://collector:43170/v1/traces'],
    ['an upper-case scheme', 'HTTPS://otel.example.com', 'HTTPS://otel.example.com/v1/traces'],
  ])('%s', (_name, raw, expected) => {
    expect(resolveOtlpHttpTracesUrl(raw)).toBe(expected);
  });
});

describe('registerNodeOtel', () => {
  it('treats a whitespace-only endpoint as unset', async () => {
    await expect(registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' })).resolves.toEqual({
      enabled: false,
      reason: 'unset',
    });
    expect(sdk.register).not.toHaveBeenCalled();
  });

  it('registers once with the default service name and the normalized exporter URL', async () => {
    const result = await registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4317' });

    expect(result).toEqual({
      enabled: true,
      serviceName: 'nomarkup-web',
      endpoint: 'http://collector:4318/v1/traces',
    });
    expect(sdk.exporterUrls).toEqual(['http://collector:4318/v1/traces']);
    expect(sdk.resourceAttributes).toEqual([{ 'service.name': 'nomarkup-web' }]);
    expect(sdk.register).toHaveBeenCalledTimes(1);
    expect(sdk.setGlobalPropagator).toHaveBeenCalledTimes(1);
    expect(sdk.getTracer).toHaveBeenCalledWith('nomarkup-web');
    expect(logged(info)).toEqual([
      {
        level: 'info',
        service: 'web',
        message: 'OpenTelemetry tracing enabled',
        otel_service: 'nomarkup-web',
        otel_endpoint: 'http://collector:4318/v1/traces',
      },
    ]);
  });

  it('uses a trimmed OTEL_SERVICE_NAME, and the default when it is blank', async () => {
    await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_SERVICE_NAME: '  web-canary  ',
    });
    __resetNodeOtelRegistrationForTests();
    await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_SERVICE_NAME: '   ',
    });

    expect(sdk.resourceAttributes).toEqual([
      { 'service.name': 'web-canary' },
      { 'service.name': 'nomarkup-web' },
    ]);
  });

  it('does not register a second provider; the repeat call reports the env it was given', async () => {
    await registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });

    const withEnv = await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://other:4317',
      OTEL_SERVICE_NAME: 'web-2',
    });
    const withoutEnv = await registerNodeOtel({});

    expect(sdk.register).toHaveBeenCalledTimes(1);
    expect(sdk.exporterUrls).toEqual(['http://collector:4318/v1/traces']);
    // Raw env values, not the normalized ones from the first registration.
    expect(withEnv).toEqual({ enabled: true, serviceName: 'web-2', endpoint: 'http://other:4317' });
    expect(withoutEnv).toEqual({ enabled: true, serviceName: 'nomarkup-web', endpoint: '' });
  });

  it('stays registered even during a later build-phase call', async () => {
    await registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });

    const result = await registerNodeOtel({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      NEXT_PHASE: 'phase-production-build',
    });

    expect(result).toMatchObject({ enabled: true });
  });

  it.each([
    ['an Error', new Error('exporter rejected the URL'), 'exporter rejected the URL'],
    ['a thrown string', 'boom', 'unknown error'],
    ['a thrown object', { code: 'EBADURL' }, 'unknown error'],
  ])('continues without export when the SDK throws %s, and can be retried', async (_name, thrown, detail) => {
    sdk.exporterFailure.value = thrown;
    sdk.exporterFailure.armed = true;

    const failed = await registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });

    expect(failed).toEqual({ enabled: false, reason: 'error' });
    expect(sdk.register).not.toHaveBeenCalled();
    expect(logged(warn)).toEqual([
      {
        level: 'warn',
        service: 'web',
        message: 'OpenTelemetry registration failed; continuing without export',
        error: detail,
      },
    ]);

    // A failure does not latch: the next call attempts registration again.
    sdk.exporterFailure.armed = false;
    const retried = await registerNodeOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' });
    expect(retried).toMatchObject({ enabled: true });
    expect(sdk.register).toHaveBeenCalledTimes(1);
  });
});
