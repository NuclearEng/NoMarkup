import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRateLimit } from '@/lib/server/rate-limit';
import { consumeSharedRateLimit } from '@/lib/server/rate-limit-shared';

const OPTS = { limit: 3, windowMs: 60_000 };

function redisReply(count: number, pttl: number) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify([{ result: count }, { result: 1 }, { result: pttl }]), {
        status: 200,
      }),
    ),
  ) as unknown as typeof fetch;
}

describe('consumeSharedRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('allows while the shared counter is within the limit and sends INCR/PEXPIRE NX/PTTL', async () => {
    const fetchImpl = redisReply(2, 59_000);
    const d = await consumeSharedRateLimit('k', OPTS, { fetchImpl, url: 'https://r.example/', token: 't' });
    expect(d).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://r.example/pipeline');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
    expect(JSON.parse(init.body as string)).toEqual([
      ['INCR', 'nm:web:rl:k'],
      ['PEXPIRE', 'nm:web:rl:k', '60000', 'NX'],
      ['PTTL', 'nm:web:rl:k'],
    ]);
  });

  it('blocks over the limit with Retry-After from PTTL', async () => {
    const d = await consumeSharedRateLimit('k', OPTS, { fetchImpl: redisReply(4, 12_300), url: 'u', token: 't' });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 13 });
  });

  it('falls back to the in-memory limiter when unconfigured', async () => {
    const onFallback = vi.fn();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (let i = 0; i < OPTS.limit; i += 1) {
      expect((await consumeSharedRateLimit('m', OPTS, { fetchImpl, url: '', token: '', onFallback, nowMs: 1000 + i })).allowed).toBe(true);
    }
    expect((await consumeSharedRateLimit('m', OPTS, { fetchImpl, url: '', token: '', onFallback, nowMs: 2000 })).allowed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith('unconfigured');
  });

  it('falls back (still limited, not fail-open) when Redis errors', async () => {
    const onFallback = vi.fn();
    const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    const results: boolean[] = [];
    for (let i = 0; i < OPTS.limit + 1; i += 1) {
      results.push((await consumeSharedRateLimit('e', OPTS, { fetchImpl, url: 'u', token: 't', onFallback, nowMs: 5000 + i })).allowed);
    }
    expect(results).toEqual([true, true, true, false]);
    expect(onFallback).toHaveBeenCalledWith('error');
  });

  it('falls back on non-2xx and malformed replies', async () => {
    const onFallback = vi.fn();
    const bad = vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch;
    await consumeSharedRateLimit('x', OPTS, { fetchImpl: bad, url: 'u', token: 't', onFallback });
    const malformed = vi.fn(() => Promise.resolve(new Response('{"a":1}', { status: 200 }))) as unknown as typeof fetch;
    await consumeSharedRateLimit('x', OPTS, { fetchImpl: malformed, url: 'u', token: 't', onFallback });
    expect(onFallback).toHaveBeenNthCalledWith(1, 'http_500');
    expect(onFallback).toHaveBeenNthCalledWith(2, 'bad_response');
  });
});
