/**
 * Optional Node OpenTelemetry registration for the Next.js server runtime.
 *
 * Behaviour:
 *   - OTEL_EXPORTER_OTLP_ENDPOINT unset  → no-op (dev default; zero cost)
 *   - endpoint set                       → TracerProvider + OTLP/HTTP exporter
 *   - production-build phase             → no-op (workers must not open sockets)
 *
 * Collector listens on both 4317 (gRPC) and 4318 (HTTP). Gateway uses gRPC;
 * the web process uses OTLP/HTTP so we avoid a native gRPC dependency in the
 * Next.js bundle. When the configured URL ends in :4317 we rewrite to :4318
 * and append /v1/traces (OTLP HTTP path).
 *
 * Failures never throw — a misconfigured collector must not take the web
 * server down. Structured warn only (no console.log in prod paths).
 *
 * Server-only: imported dynamically from instrumentation.ts. Do not import
 * from client components.
 */

export type RegisterNodeOtelResult =
  | { enabled: false; reason: 'unset' | 'build-phase' | 'error' }
  | { enabled: true; serviceName: string; endpoint: string };

let registered = false;

/**
 * Normalize OTEL_EXPORTER_OTLP_ENDPOINT for the HTTP exporter.
 * Accepts bare host:port, http(s) URLs, and gRPC :4317 endpoints.
 */
export function resolveOtlpHttpTracesUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return trimmed;

  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }

  // gRPC default port → HTTP default port on the same collector.
  url = url.replace(/:4317(?=\/|$)/, ':4318');

  if (url.endsWith('/v1/traces')) return url;
  return `${url}/v1/traces`;
}

/**
 * Register a Node TracerProvider that exports to the collector when configured.
 * Idempotent — safe if Next reloads the instrumentation module.
 */
export async function registerNodeOtel(
  env: Record<string, string | undefined> = process.env,
): Promise<RegisterNodeOtelResult> {
  if (registered) {
    return {
      enabled: true,
      serviceName: env['OTEL_SERVICE_NAME'] ?? 'nomarkup-web',
      endpoint: env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '',
    };
  }

  const rawEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() ?? '';
  if (rawEndpoint === '') {
    return { enabled: false, reason: 'unset' };
  }

  // next build sets NODE_ENV=production and may load instrumentation in
  // workers; opening an exporter socket during static generation is pure waste.
  if (env['NEXT_PHASE'] === 'phase-production-build') {
    return { enabled: false, reason: 'build-phase' };
  }

  const serviceName = env['OTEL_SERVICE_NAME']?.trim() || 'nomarkup-web';
  const tracesUrl = resolveOtlpHttpTracesUrl(rawEndpoint);

  try {
    const [
      { NodeTracerProvider, BatchSpanProcessor },
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { trace, propagation },
      { W3CTraceContextPropagator },
    ] = await Promise.all([
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
      import('@opentelemetry/api'),
      import('@opentelemetry/core'),
    ]);

    const exporter = new OTLPTraceExporter({ url: tracesUrl });
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });

    provider.register();
    // Match the gateway: W3C Trace Context only (no B3).
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    // Keep a handle so TypeScript knows the provider is used; register() already
    // installed it as the global TracerProvider.
    void trace.getTracer(serviceName);

    registered = true;

    // Structured startup notice — same shape as env.ts / stripe.ts.
    // eslint-disable-next-line no-console -- server startup observability sink
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'web',
        message: 'OpenTelemetry tracing enabled',
        otel_service: serviceName,
        otel_endpoint: tracesUrl,
      }),
    );

    return { enabled: true, serviceName, endpoint: tracesUrl };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    // eslint-disable-next-line no-console -- server startup observability sink
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'web',
        message: 'OpenTelemetry registration failed; continuing without export',
        error: detail,
      }),
    );
    return { enabled: false, reason: 'error' };
  }
}

/** Test helper: allow re-registration across vitest cases. */
export function __resetNodeOtelRegistrationForTests(): void {
  registered = false;
}
