/**
 * Pure W3C + gateway correlation helpers for web → gateway hops.
 *
 * No @opentelemetry/* runtime dependency here so the browser and server
 * client can share the same header minting path without pulling the SDK
 * into the client bundle. Gateway middleware honours:
 *   - X-Request-ID  (observability.HeaderRequestID, ≤64 printable ASCII)
 *   - traceparent   (W3C Trace Context; gateway Tracing extracts it)
 *
 * Format of NewRequestID on the gateway is 16 hex chars; we match that so
 * client-minted ids look like gateway-minted ones in logs.
 */

export const HEADER_REQUEST_ID = 'X-Request-ID';
export const HEADER_TRACEPARENT = 'traceparent';

/** Outbound headers every web→gateway fetch should attach. */
export type OutboundTraceHeaders = {
  [HEADER_REQUEST_ID]: string;
  [HEADER_TRACEPARENT]: string;
};

export type TraceparentParts = {
  version: string;
  traceId: string;
  spanId: string;
  /** Two-char hex flags; bit 0 = sampled. */
  flags: string;
};

/**
 * Cryptographically random hex string of `byteLength` bytes (2× chars).
 * Falls back to Math.random only when crypto is unavailable (tests / odd runtimes).
 */
export function randomHex(byteLength: number): string {
  if (byteLength <= 0) return '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic-quality is not required for the Math.random fallback; it is
  // only reached in environments without Web Crypto (very old browsers / some
  // test harnesses). Correlation still works; uniqueness is best-effort.
  let out = '';
  for (let i = 0; i < byteLength; i += 1) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/** 16-hex-char request id matching gateway observability.NewRequestID. */
export function generateRequestId(): string {
  return randomHex(8);
}

/**
 * Build a W3C `traceparent` value for a new root span.
 * https://www.w3.org/TR/trace-context/#traceparent-header
 *
 * `sampled` defaults true so the gateway span is retained when the collector
 * is up; sample rate is still controlled by the backend TracerProvider.
 */
export function generateTraceparent(sampled = true): string {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Parse a W3C traceparent. Returns null when the value is malformed so callers
 * can mint a fresh one rather than forward garbage to the gateway.
 */
export function parseTraceparent(value: string): TraceparentParts | null {
  // version-traceid-spanid-flags — four hyphen-separated fields, fixed lengths.
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const version = match[1];
  const traceId = match[2];
  const spanId = match[3];
  const flags = match[4];
  if (
    version === undefined ||
    traceId === undefined ||
    spanId === undefined ||
    flags === undefined
  ) {
    return null;
  }
  // All-zero trace/span ids are invalid per the W3C spec.
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return {
    version: version.toLowerCase(),
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    flags: flags.toLowerCase(),
  };
}

/**
 * Extract the 32-char trace id from a valid traceparent, or null.
 * Useful for tagging Sentry events with the same id the gateway logs.
 */
export function traceIdFromTraceparent(value: string): string | null {
  return parseTraceparent(value)?.traceId ?? null;
}

/**
 * Mint the pair of headers every outbound API call should carry.
 * Callers that already hold a request id (e.g. retry of the same logical
 * attempt) can pass it so the gateway reuses the correlation id.
 */
export function buildOutboundTraceHeaders(
  existingRequestId?: string,
): OutboundTraceHeaders {
  const requestId =
    existingRequestId !== undefined && existingRequestId.length > 0
      ? existingRequestId.slice(0, 64)
      : generateRequestId();
  return {
    [HEADER_REQUEST_ID]: requestId,
    [HEADER_TRACEPARENT]: generateTraceparent(true),
  };
}
