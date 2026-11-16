// sentry-bridge — stamps gateway correlation ids onto the Sentry scope and
// wraps API calls in an http.client span. Pins which tags are set for which
// inputs, that a malformed traceparent is ignored, and that telemetry failures
// never break the request path.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachTraceToSentry, withClientApiSpan } from '@/lib/otel/sentry-bridge';

const setTag = vi.fn();
const setContext = vi.fn();
const getCurrentScope = vi.fn();
const startSpan = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: (): unknown => getCurrentScope(),
  startSpan: (options: unknown, fn: () => unknown): unknown => startSpan(options, fn),
}));

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

describe('sentry-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentScope.mockReturnValue({ setTag, setContext });
    startSpan.mockImplementation((_options: unknown, fn: () => unknown) => fn());
  });

  describe('attachTraceToSentry', () => {
    it('tags the request id and both OTel ids when everything is present', () => {
      attachTraceToSentry({ requestId: 'req-123', traceparent: TRACEPARENT });

      expect(setTag.mock.calls).toEqual([
        ['request_id', 'req-123'],
        ['otel_trace_id', TRACE_ID],
        ['otel_span_id', SPAN_ID],
      ]);
      expect(setContext.mock.calls).toEqual([['correlation', { request_id: 'req-123' }]]);
    });

    it('tags only the request id when there is no traceparent', () => {
      attachTraceToSentry({ requestId: 'req-123', traceparent: null });

      expect(setTag.mock.calls).toEqual([['request_id', 'req-123']]);
    });

    it('tags only the OTel ids when there is no request id', () => {
      attachTraceToSentry({ requestId: '', traceparent: TRACEPARENT });

      expect(setTag.mock.calls).toEqual([
        ['otel_trace_id', TRACE_ID],
        ['otel_span_id', SPAN_ID],
      ]);
      expect(setContext).not.toHaveBeenCalled();
    });

    it.each(['not-a-traceparent', `00-${TRACE_ID}-short-01`, `00-${TRACE_ID}-${SPAN_ID}`])(
      'ignores the malformed traceparent %j',
      (traceparent) => {
        attachTraceToSentry({ traceparent });

        expect(setTag).not.toHaveBeenCalled();
      },
    );

    it('sets nothing when called with no ids', () => {
      attachTraceToSentry({});

      expect(getCurrentScope).toHaveBeenCalledTimes(1);
      expect(setTag).not.toHaveBeenCalled();
      expect(setContext).not.toHaveBeenCalled();
    });

    it('swallows a Sentry failure instead of breaking the caller', () => {
      getCurrentScope.mockImplementation(() => {
        throw new Error('sentry not initialised');
      });

      expect(() => {
        attachTraceToSentry({ requestId: 'req-123', traceparent: TRACEPARENT });
      }).not.toThrow();
      expect(getCurrentScope).toHaveBeenCalledTimes(1);
      expect(setTag).not.toHaveBeenCalled();

      getCurrentScope.mockReturnValue({
        setTag: () => {
          throw new Error('scope frozen');
        },
        setContext,
      });
      expect(() => {
        attachTraceToSentry({ requestId: 'req-123' });
      }).not.toThrow();
      expect(setContext).not.toHaveBeenCalled();
    });
  });

  describe('withClientApiSpan', () => {
    it('opens an http.client span with route, request id and trace id, and returns the result', async () => {
      const fn = vi.fn().mockResolvedValue({ id: 'job-1' });

      const result = await withClientApiSpan(
        { method: 'POST', path: '/api/v1/jobs', requestId: 'req-9', traceparent: TRACEPARENT },
        fn,
      );

      expect(result).toEqual({ id: 'job-1' });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(startSpan).toHaveBeenCalledTimes(1);
      expect(startSpan.mock.calls[0]?.[0]).toStrictEqual({
        name: 'http.client POST /api/v1/jobs',
        op: 'http.client',
        attributes: {
          'http.request.method': 'POST',
          'http.route': '/api/v1/jobs',
          'request.id': 'req-9',
          'otel.trace_id': TRACE_ID,
        },
      });
      // The scope is tagged inside the span, before the call runs.
      expect(setTag.mock.calls).toEqual([
        ['request_id', 'req-9'],
        ['otel_trace_id', TRACE_ID],
        ['otel_span_id', SPAN_ID],
      ]);
    });

    it('omits the trace id attribute when the traceparent is malformed', async () => {
      await withClientApiSpan(
        { method: 'GET', path: '/api/v1/me', requestId: 'req-1', traceparent: 'garbage' },
        () => Promise.resolve(null),
      );

      expect(startSpan.mock.calls[0]?.[0]).toStrictEqual({
        name: 'http.client GET /api/v1/me',
        op: 'http.client',
        attributes: {
          'http.request.method': 'GET',
          'http.route': '/api/v1/me',
          'request.id': 'req-1',
        },
      });
      expect(setTag.mock.calls).toEqual([['request_id', 'req-1']]);
    });

    it('propagates the wrapped call\'s rejection unchanged', async () => {
      const failure = new Error('503');

      await expect(
        withClientApiSpan(
          { method: 'GET', path: '/api/v1/me', requestId: 'req-1', traceparent: TRACEPARENT },
          () => Promise.reject(failure),
        ),
      ).rejects.toBe(failure);
    });
  });
});
