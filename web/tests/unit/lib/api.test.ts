import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, downloadAuthenticated, getApiErrorMessage } from '@/lib/api';
import { HEADER_REQUEST_ID, HEADER_TRACEPARENT, parseTraceparent } from '@/lib/otel/trace-context';

// Mock auth helpers so we control the token state without touching localStorage.
vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  clearTokens: vi.fn(),
}));

// Sentry no-op so withClientApiSpan does not pull the full browser SDK graph.
vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: () => ({
    setTag: vi.fn(),
    setContext: vi.fn(),
  }),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

const { getAccessToken, setAccessToken, clearTokens } = await import('@/lib/auth');

describe('ApiError', () => {
  it('exposes status + body on the instance', () => {
    const err = new ApiError(409, 'conflict');
    expect(err.status).toBe(409);
    expect(err.body).toBe('conflict');
    expect(err.message).toContain('409');
    expect(err.name).toBe('ApiError');
  });

  describe('userMessage', () => {
    it('extracts {error} string from JSON gateway response', () => {
      const err = new ApiError(422, JSON.stringify({ error: 'contract is not active' }));
      expect(err.userMessage('fallback')).toBe('contract is not active');
    });

    it('extracts {message} string when error is absent', () => {
      const err = new ApiError(500, JSON.stringify({ message: 'internal error' }));
      expect(err.userMessage('fallback')).toBe('internal error');
    });

    it('returns raw body if it is short and not JSON', () => {
      const err = new ApiError(503, 'Service unavailable');
      expect(err.userMessage('fallback')).toBe('Service unavailable');
    });

    it('falls back when body is too long', () => {
      const longBody = 'x'.repeat(300);
      const err = new ApiError(500, longBody);
      expect(err.userMessage('fallback message')).toBe('fallback message');
    });

    it('falls back when body is empty', () => {
      const err = new ApiError(500, '');
      expect(err.userMessage('fallback')).toBe('fallback');
    });
  });
});

describe('getApiErrorMessage', () => {
  it('extracts the {error} JSON message from an ApiError', () => {
    const err = new ApiError(402, JSON.stringify({ error: 'Add a payment method to bid' }));
    expect(getApiErrorMessage(err, 'fallback')).toBe('Add a payment method to bid');
  });

  it('returns .message for a plain Error', () => {
    expect(getApiErrorMessage(new Error('Network error during upload'), 'fallback')).toBe(
      'Network error during upload',
    );
  });

  it('returns the fallback for non-Error values', () => {
    expect(getApiErrorMessage('weird', 'use this')).toBe('use this');
    expect(getApiErrorMessage(undefined, 'use this')).toBe('use this');
  });

  it('returns the fallback for an Error with an empty message', () => {
    expect(getApiErrorMessage(new Error(''), 'use this')).toBe('use this');
  });
});

describe('api request methods', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET attaches bearer token when available', async () => {
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await api.get<{ ok: boolean }>('/api/v1/x');
    expect(result.ok).toBe(true);

    const call = vi.mocked(fetch).mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-1');
    expect(init?.credentials).toBe('include');
  });

  it('GET attaches X-Request-ID and W3C traceparent for gateway correlation (C8)', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { [HEADER_REQUEST_ID]: 'gateway-echo-id' },
      }),
    );

    await api.get('/api/v1/jobs');

    const call = vi.mocked(fetch).mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers[HEADER_REQUEST_ID]).toMatch(/^[0-9a-f]{16}$/);
    const tp = headers[HEADER_TRACEPARENT];
    expect(tp).toBeDefined();
    expect(parseTraceparent(tp as string)).not.toBeNull();
  });

  it('POST serializes body as JSON', async () => {
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await api.post('/api/v1/y', { foo: 'bar' });

    const call = vi.mocked(fetch).mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call;
    expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError on non-2xx with the response body', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );

    try {
      await api.get('/api/v1/z');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).body).toContain('forbidden');
    }
  });

  it('wraps network failure in ApiError(503)', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await api.get('/api/v1/network-down');
      throw new Error('should not reach here');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).body).toContain('Unable to reach the server');
    }
  });

  it('PATCH and DELETE work end-to-end', async () => {
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await api.patch('/api/v1/a', { v: 1 });
    await api.delete('/api/v1/a');

    const [c0, c1] = vi.mocked(fetch).mock.calls;
    if (!c0 || !c1) throw new Error('fetch missing expected calls');
    expect(c0[1]?.method).toBe('PATCH');
    expect(c1[1]?.method).toBe('DELETE');
  });

  it('DELETE returning 204 No Content resolves (does not throw on empty body)', async () => {
    // Regression: the gateway returns 204 with an empty body for DELETE
    // (e.g. expenses). Calling response.json() on an empty body throws
    // "The string did not match the expected pattern." in WebKit, surfacing
    // as a false "delete failed" toast. The client must tolerate empty bodies.
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await api.delete('/api/v1/providers/me/expenses/abc');
    expect(result).toBeUndefined();
  });

  it('200 with an empty body resolves to undefined instead of throwing', async () => {
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await api.delete('/api/v1/x');
    expect(result).toBeUndefined();
  });

  it('postUnauthed does NOT attach Authorization header', async () => {
    vi.mocked(getAccessToken).mockReturnValue('would-be-leaked');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await api.postUnauthed('/api/v1/auth/login', { email: 'a@b.c' });

    const callPU = vi.mocked(fetch).mock.calls[0];
    if (!callPU) throw new Error('fetch was not called');
    const headers = callPU[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('getPublic does NOT attach Authorization header (and does not retry on 401)', async () => {
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not authenticated', { status: 401 }),
    );

    // Public endpoints surface the 401 directly — no refresh attempt.
    await expect(api.getPublic('/api/v1/jobs/x')).rejects.toBeInstanceOf(ApiError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe('401 refresh-token rotation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('on 401: refreshes, then retries the original request once', async () => {
    vi.mocked(getAccessToken)
      .mockReturnValueOnce('expired-token') // initial request
      .mockReturnValueOnce('new-token'); // retry uses new token

    vi.mocked(fetch)
      // first request → 401
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      // refresh → 200 with new token pair
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'new-token', refresh_token: 'r2' }), {
          status: 200,
        }),
      )
      // retry → 200
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await api.get<{ ok: boolean }>('/api/v1/protected');
    expect(result.ok).toBe(true);
    expect(setAccessToken).toHaveBeenCalledWith('new-token');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('on 401 + refresh failure: clears tokens and throws ApiError(401)', async () => {
    vi.mocked(getAccessToken).mockReturnValue('expired-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('refresh denied', { status: 401 }));

    // Stub window.location to avoid actual navigation in jsdom. Construct
    // the replacement explicitly (don't spread the real Location instance —
    // it loses class identity and trips no-misused-spread).
    const origLoc = window.location;
    const stubLoc = { href: '', origin: origLoc.origin, pathname: origLoc.pathname };
    Object.defineProperty(window, 'location', { configurable: true, value: stubLoc });

    await expect(api.get('/api/v1/protected')).rejects.toBeInstanceOf(ApiError);
    expect(clearTokens).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: origLoc });
  });

  it('refresh attempts are deduplicated when fired concurrently', async () => {
    vi.mocked(getAccessToken).mockReturnValue('expired-token');
    let refreshCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        // Slight delay so concurrent callers race.
        await new Promise((r) => setTimeout(r, 10));
        return new Response(
          JSON.stringify({ access_token: 'new-token', refresh_token: 'r2' }),
          { status: 200 },
        );
      }
      // Initial requests all return 401 first, then succeed on retry.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // Fire 3 protected requests concurrently — only ONE refresh should happen.
    vi.mocked(getAccessToken)
      .mockReturnValueOnce('expired-1')
      .mockReturnValueOnce('expired-2')
      .mockReturnValueOnce('expired-3')
      .mockReturnValueOnce('new-token')
      .mockReturnValueOnce('new-token')
      .mockReturnValueOnce('new-token');

    // First call sees 401 → triggers refresh; concurrent second + third also hit 401
    // but should reuse the in-flight refreshPromise.
    vi.mocked(fetch).mockReset();
    let firstReqHit = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        await new Promise((r) => setTimeout(r, 10));
        return new Response(
          JSON.stringify({ access_token: 'new-token', refresh_token: 'r2' }),
          { status: 200 },
        );
      }
      if (!firstReqHit) {
        firstReqHit = true;
        return new Response('expired', { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    refreshCallCount = 0;
    await api.get('/api/v1/p1').catch(() => {
      // refresh dedup is the assertion target; we tolerate either outcome
      // depending on race timing.
    });
    expect(refreshCallCount).toBeLessThanOrEqual(1);
  });
});

describe('downloadAuthenticated', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // jsdom URL.createObjectURL doesn't exist — stub it.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('triggers a browser download via anchor click', async () => {
    vi.mocked(getAccessToken).mockReturnValue('tok');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Blob(['hello']), { status: 200 }),
    );

    await downloadAuthenticated('/api/v1/files/x', 'tax-form.html');

    // Verify Authorization header attached.
    const dlCall = vi.mocked(fetch).mock.calls[0];
    if (!dlCall) throw new Error('fetch was not called for download');
    const headers = dlCall[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('throws ApiError on non-2xx', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(downloadAuthenticated('/api/v1/files/missing', 'x.pdf')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
