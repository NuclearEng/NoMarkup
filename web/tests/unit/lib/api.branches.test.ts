// api — the residual branches api.test.ts / api-idempotency.test.ts leave out:
// the download 401 -> refresh -> retry hop, a refreshed request that ends up
// with no token, timing without the Performance API, the idempotency-key
// fallback without crypto.randomUUID, and the money-message rewrite.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  __resetIdempotencyKeysForTests,
  api,
  downloadAuthenticated,
  getApiErrorMessage,
  idempotencyHeader,
} from '@/lib/api';
import { __resetClientActionsForTests, listClientActions } from '@/lib/client-action-log';

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  clearTokens: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  getCurrentScope: () => ({
    setTag: vi.fn(),
    setContext: vi.fn(),
  }),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

const { getAccessToken, setAccessToken } = await import('@/lib/auth');

const createObjectURL = vi.fn(() => 'blob:mock');
const revokeObjectURL = vi.fn();

function fetchCall(index: number): { url: unknown; headers: Record<string, string> } {
  const call = vi.mocked(fetch).mock.calls[index];
  if (!call) throw new Error(`fetch call ${String(index)} was not made`);
  return { url: call[0], headers: call[1]?.headers as Record<string, string> };
}

describe('api residual branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createObjectURL.mockImplementation(() => 'blob:mock');
    vi.stubGlobal('fetch', vi.fn());
    __resetClientActionsForTests();
    __resetIdempotencyKeysForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('downloadAuthenticated on an expired token', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL,
        revokeObjectURL,
      });
    });

    it('refreshes once and retries the download with the new token', async () => {
      vi.mocked(getAccessToken).mockReturnValueOnce('stale').mockReturnValue('fresh');
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'fresh' }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(new Blob(['pdf']), { status: 200 }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

      await downloadAuthenticated('/api/v1/files/1099', '1099.pdf');

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
      expect(fetchCall(0).headers['Authorization']).toBe('Bearer stale');
      expect(fetchCall(1).url).toBe('/api/v1/auth/refresh');
      expect(fetchCall(2).url).toBe('/api/v1/files/1099');
      expect(fetchCall(2).headers['Authorization']).toBe('Bearer fresh');
      expect(vi.mocked(setAccessToken)).toHaveBeenCalledWith('fresh');
      expect(click).toHaveBeenCalledTimes(1);
      // The temporary anchor is removed and the blob URL released.
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('surfaces the 401 without retrying when the refresh fails', async () => {
      vi.mocked(getAccessToken).mockReturnValue('stale');
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('expired', { status: 401 }))
        .mockResolvedValueOnce(new Response('', { status: 401 }));

      const failure = await downloadAuthenticated('/api/v1/files/1099', '1099.pdf').catch(
        (err: unknown) => err,
      );

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(401);
      expect((failure as ApiError).body).toBe('expired');
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('still revokes the blob URL when the anchor click throws', async () => {
      vi.mocked(getAccessToken).mockReturnValue(null);
      vi.mocked(fetch).mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        throw new Error('popup blocked');
      });

      await expect(downloadAuthenticated('/api/v1/files/x', 'x.pdf')).rejects.toThrow(
        'popup blocked',
      );

      expect(fetchCall(0).headers['Authorization']).toBeUndefined();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });
  });

  describe('request()', () => {
    it('retries after a refresh without an Authorization header when no token came back', async () => {
      // First read: stale token attached. After the refresh the store is empty
      // (cookie-only session) — the retry must not send "Bearer null".
      vi.mocked(getAccessToken).mockReturnValueOnce('stale').mockReturnValue(null);
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: '' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await expect(api.get<{ ok: boolean }>('/api/v1/me')).resolves.toEqual({ ok: true });

      expect(fetchCall(0).headers['Authorization']).toBe('Bearer stale');
      expect(fetchCall(2).headers['Authorization']).toBeUndefined();
      expect(fetchCall(2).headers['Content-Type']).toBe('application/json');
    });

    it('times the call with Date.now when the Performance API is unavailable', async () => {
      vi.stubGlobal('performance', undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(1250);
      vi.mocked(getAccessToken).mockReturnValue(null);
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await api.getPublic('/api/v1/flags?x=1');

      const logged = listClientActions().find((event) => event.path === '/api/v1/flags');
      expect(logged?.durationMs).toBe(250);
      expect(logged?.status).toBe(200);
    });

    it('never attempts a refresh for an unauthenticated call that gets a 401', async () => {
      vi.mocked(getAccessToken).mockReturnValue('tok');
      vi.mocked(fetch).mockResolvedValueOnce(new Response('bad credentials', { status: 401 }));

      const failure = await api
        .postUnauthed('/api/v1/auth/login', { email: 'a@b.co' })
        .catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).body).toBe('bad credentials');
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(fetchCall(0).headers['Authorization']).toBeUndefined();
    });
  });

  describe('idempotencyHeader', () => {
    it.each<[string, unknown]>([
      ['crypto has no randomUUID', {}],
      ['crypto is undefined', undefined],
    ])('falls back to a timestamp + random key when %s', (_label, cryptoStub) => {
      vi.stubGlobal('crypto', cryptoStub);
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      vi.spyOn(Math, 'random').mockReturnValue(0.25);
      const expected = `1700000000000-${(0.25).toString(36).slice(2)}`;

      expect(idempotencyHeader('order-pay:o-1')).toEqual({ 'Idempotency-Key': expected });
      // An empty operation key is treated like "no key": minted, never stored.
      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      expect(idempotencyHeader('')['Idempotency-Key']).not.toBe(expected);
      expect(idempotencyHeader('order-pay:o-1')['Idempotency-Key']).toBe(expected);
    });
  });

  describe('getApiErrorMessage money rewrite', () => {
    it.each<[string, string]>([
      ['bid must be at least 17200 cents', 'bid must be at least $172.00'],
      ['minimum is 5 CENTS, maximum 100000cents', 'minimum is $0.05, maximum $1,000.00'],
      ['two percent of the total', 'two percent of the total'],
    ])('%j -> %j', (message, expected) => {
      expect(getApiErrorMessage(new Error(message), 'fallback')).toBe(expected);
      expect(getApiErrorMessage(new ApiError(400, JSON.stringify({ error: message })), 'fallback')).toBe(
        expected,
      );
    });

    it('leaves an absurdly long digit run (not a finite number) untouched', () => {
      const message = `limit is ${'9'.repeat(400)} cents`;
      expect(getApiErrorMessage(new Error(message), 'fallback')).toBe(message);
    });

    it.each<[string, unknown]>([
      ['an Error with an empty message', new Error('')],
      ['a string', 'boom'],
      ['null', null],
    ])('uses the fallback for %s', (_label, thrown) => {
      expect(getApiErrorMessage(thrown, 'Could not place bid')).toBe('Could not place bid');
    });
  });
});
