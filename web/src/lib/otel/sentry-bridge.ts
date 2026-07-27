/**
 * Bridge gateway correlation ids into the existing Sentry client.
 *
 * C8 residual: full browser OTel SDK is heavy (bundle budget). Instead we:
 *   1. Mint X-Request-ID + traceparent on every api.ts hop (trace-context.ts)
 *   2. Tag the active Sentry scope with the gateway-echoed request id + W3C
 *      trace id so browser Performance transactions and server traces can be
 *      joined in Sentry / log search even without an OTLP browser exporter.
 *
 * Safe when Sentry is disabled / no DSN — setTag is a no-op on the default
 * hub. Never throws.
 */

import * as Sentry from '@sentry/nextjs';

import { parseTraceparent } from '@/lib/otel/trace-context';

/**
 * Stamp the current Sentry scope with request/trace correlation.
 * Prefer the gateway response `X-Request-ID` (authoritative) over the
 * client-minted value when both are available.
 */
export function attachTraceToSentry(opts: {
  requestId?: string | null;
  traceparent?: string | null;
}): void {
  try {
    const scope = Sentry.getCurrentScope();
    if (opts.requestId) {
      scope.setTag('request_id', opts.requestId);
      scope.setContext('correlation', {
        request_id: opts.requestId,
      });
    }
    if (opts.traceparent) {
      const parts = parseTraceparent(opts.traceparent);
      if (parts) {
        scope.setTag('otel_trace_id', parts.traceId);
        scope.setTag('otel_span_id', parts.spanId);
      }
    }
  } catch {
    // Telemetry must never break a request path.
  }
}

/**
 * Wrap an async API call in a Sentry http.client span carrying the same
 * request_id the gateway will log. When Sentry Performance is off this is
 * effectively free (no-op span).
 */
export async function withClientApiSpan<T>(
  opts: {
    method: string;
    path: string;
    requestId: string;
    traceparent: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const traceId = parseTraceparent(opts.traceparent)?.traceId;
  return Sentry.startSpan(
    {
      name: `http.client ${opts.method} ${opts.path}`,
      op: 'http.client',
      attributes: {
        'http.request.method': opts.method,
        'http.route': opts.path,
        'request.id': opts.requestId,
        ...(traceId ? { 'otel.trace_id': traceId } : {}),
      },
    },
    async () => {
      attachTraceToSentry({
        requestId: opts.requestId,
        traceparent: opts.traceparent,
      });
      return fn();
    },
  );
}
