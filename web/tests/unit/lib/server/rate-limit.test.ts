import { beforeEach, describe, expect, it } from 'vitest';

import { consumeRateLimit, resetRateLimit } from '@/lib/server/rate-limit';

const OPTS = { limit: 10, windowMs: 60_000 };
const T0 = 1_750_000_000_000;

describe('consumeRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('allows up to the limit within a window', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      const decision = consumeRateLimit('user-1', OPTS, T0 + i * 100);
      expect(decision.allowed).toBe(true);
      expect(decision.retryAfterSeconds).toBe(0);
    }
  });

  it('blocks the (N+1)th request with a positive Retry-After', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      consumeRateLimit('user-1', OPTS, T0 + i * 100);
    }
    const blocked = consumeRateLimit('user-1', OPTS, T0 + 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Oldest request was at T0; the window frees up at T0 + 60s → 59s away.
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('refills after the window slides past old requests', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      consumeRateLimit('user-1', OPTS, T0 + i * 100);
    }
    expect(consumeRateLimit('user-1', OPTS, T0 + 2_000).allowed).toBe(false);

    // Just past the oldest timestamp + window: exactly one slot frees up.
    const afterWindow = T0 + OPTS.windowMs + 1;
    expect(consumeRateLimit('user-1', OPTS, afterWindow).allowed).toBe(true);
  });

  it('blocked requests do not extend the window (no penalty creep)', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      consumeRateLimit('user-1', OPTS, T0);
    }
    // Hammering while blocked must not push the refill time out.
    for (let i = 0; i < 5; i += 1) {
      expect(consumeRateLimit('user-1', OPTS, T0 + 10_000 + i).allowed).toBe(false);
    }
    expect(consumeRateLimit('user-1', OPTS, T0 + OPTS.windowMs + 1).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      consumeRateLimit('user-1', OPTS, T0);
    }
    expect(consumeRateLimit('user-1', OPTS, T0 + 1).allowed).toBe(false);
    expect(consumeRateLimit('user-2', OPTS, T0 + 1).allowed).toBe(true);
  });

  it('resetRateLimit clears all state', () => {
    for (let i = 0; i < OPTS.limit; i += 1) {
      consumeRateLimit('user-1', OPTS, T0);
    }
    expect(consumeRateLimit('user-1', OPTS, T0 + 1).allowed).toBe(false);
    resetRateLimit();
    expect(consumeRateLimit('user-1', OPTS, T0 + 2).allowed).toBe(true);
  });
});
