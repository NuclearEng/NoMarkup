import { describe, expect, it } from 'vitest';

import {
  HEADER_REQUEST_ID,
  HEADER_TRACEPARENT,
  buildOutboundTraceHeaders,
  generateRequestId,
  generateTraceparent,
  parseTraceparent,
  randomHex,
  traceIdFromTraceparent,
} from '@/lib/otel/trace-context';

describe('randomHex', () => {
  it('returns empty string for non-positive lengths', () => {
    expect(randomHex(0)).toBe('');
    expect(randomHex(-1)).toBe('');
  });

  it('returns 2 hex chars per byte', () => {
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('generateRequestId', () => {
  it('matches gateway NewRequestID shape (16 hex chars)', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is unique across calls', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });
});

describe('generateTraceparent / parseTraceparent', () => {
  it('round-trips a valid sampled traceparent', () => {
    const tp = generateTraceparent(true);
    const parts = parseTraceparent(tp);
    expect(parts).not.toBeNull();
    if (!parts) throw new Error('expected parse');
    expect(parts.version).toBe('00');
    expect(parts.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parts.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parts.flags).toBe('01');
    expect(`00-${parts.traceId}-${parts.spanId}-${parts.flags}`).toBe(tp);
  });

  it('marks unsampled traces with flags 00', () => {
    const parts = parseTraceparent(generateTraceparent(false));
    expect(parts?.flags).toBe('00');
  });

  it('rejects malformed and all-zero ids', () => {
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(
      parseTraceparent(
        '00-00000000000000000000000000000000-0000000000000000-01',
      ),
    ).toBeNull();
    expect(
      parseTraceparent(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
      ),
    ).toBeNull();
  });

  it('extracts trace id via traceIdFromTraceparent', () => {
    const tp = generateTraceparent();
    const id = traceIdFromTraceparent(tp);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdFromTraceparent('bad')).toBeNull();
  });
});

describe('buildOutboundTraceHeaders', () => {
  it('returns both correlation headers', () => {
    const headers = buildOutboundTraceHeaders();
    expect(headers[HEADER_REQUEST_ID]).toMatch(/^[0-9a-f]{16}$/);
    expect(parseTraceparent(headers[HEADER_TRACEPARENT])).not.toBeNull();
  });

  it('reuses a caller-supplied request id (capped at 64 chars)', () => {
    const headers = buildOutboundTraceHeaders('abc123');
    expect(headers[HEADER_REQUEST_ID]).toBe('abc123');

    const long = 'x'.repeat(80);
    const capped = buildOutboundTraceHeaders(long);
    expect(capped[HEADER_REQUEST_ID]).toHaveLength(64);
  });
});
