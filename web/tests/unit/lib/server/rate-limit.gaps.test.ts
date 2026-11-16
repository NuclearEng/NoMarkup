// rate-limit — a zero limit, Retry-After rounding, and correct decisions on
// both sides of the periodic stale-key prune (every 5 minutes).
//
// The prune only frees memory: an idle key is ignored on read anyway, so the
// deletion itself is not observable through the public API. These cases pin
// that pruning never changes a decision (an active key stays limited, an idle
// key starts fresh).
import { beforeEach, describe, expect, it } from 'vitest';

import { consumeRateLimit, resetRateLimit } from '@/lib/server/rate-limit';

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const OPTS = { limit: 2, windowMs: 10 * MINUTE };

beforeEach(() => {
  resetRateLimit();
});

describe('consumeRateLimit — zero limit', () => {
  it('always denies and asks the caller to wait a full window', () => {
    const options = { limit: 0, windowMs: 90_000 };

    expect(consumeRateLimit('k', options, T0)).toEqual({ allowed: false, retryAfterSeconds: 90 });
    expect(consumeRateLimit('k', options, T0 + 89_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 90,
    });
  });

  it('keeps denying a zero-limit key after a prune pass has run over it', () => {
    const options = { limit: 0, windowMs: MINUTE };
    consumeRateLimit('blocked', options, T0);

    // > 5 minutes later: the prune runs and meets the key with no timestamps.
    expect(consumeRateLimit('other', options, T0 + 6 * MINUTE).allowed).toBe(false);
    expect(consumeRateLimit('blocked', options, T0 + 6 * MINUTE + 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });
});

describe('consumeRateLimit — Retry-After', () => {
  it('counts down from the oldest request in the window, rounding up', () => {
    consumeRateLimit('k', OPTS, T0);
    consumeRateLimit('k', OPTS, T0 + 30_000);

    expect(consumeRateLimit('k', OPTS, T0 + 60_500).retryAfterSeconds).toBe(540);
    expect(consumeRateLimit('k', OPTS, T0 + 10 * MINUTE - 1).retryAfterSeconds).toBe(1);
  });

  it('frees exactly one slot when the oldest request ages out', () => {
    consumeRateLimit('k', OPTS, T0);
    consumeRateLimit('k', OPTS, T0 + 30_000);

    // The request at T0 falls out of the window at exactly T0 + windowMs.
    expect(consumeRateLimit('k', OPTS, T0 + 10 * MINUTE)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(consumeRateLimit('k', OPTS, T0 + 10 * MINUTE + 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});

describe('consumeRateLimit — across a prune', () => {
  it('still limits a key that was active inside the window', () => {
    // First call is itself > 5 min after module start, so it runs a prune.
    consumeRateLimit('active', OPTS, T0);
    consumeRateLimit('active', OPTS, T0 + 4 * MINUTE);

    // 6 minutes after the last prune → prune runs; `active` is 2 min old.
    expect(consumeRateLimit('bystander', OPTS, T0 + 6 * MINUTE).allowed).toBe(true);
    expect(consumeRateLimit('active', OPTS, T0 + 6 * MINUTE + 1).allowed).toBe(false);
  });

  it('gives an idle key a fresh allowance once its window has passed', () => {
    consumeRateLimit('idle', OPTS, T0);
    consumeRateLimit('idle', OPTS, T0 + 1);
    expect(consumeRateLimit('idle', OPTS, T0 + 2).allowed).toBe(false);

    // 11 minutes later: prune runs and `idle` (last hit 11 min ago) is stale.
    expect(consumeRateLimit('bystander', OPTS, T0 + 11 * MINUTE).allowed).toBe(true);
    expect(consumeRateLimit('idle', OPTS, T0 + 11 * MINUTE + 1)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(consumeRateLimit('idle', OPTS, T0 + 11 * MINUTE + 2).allowed).toBe(true);
    expect(consumeRateLimit('idle', OPTS, T0 + 11 * MINUTE + 3).allowed).toBe(false);
  });

  it('does not prune again within five minutes of the last pass', () => {
    consumeRateLimit('a', OPTS, T0);
    consumeRateLimit('a', OPTS, T0 + 1);

    // 4 min later (no prune): decisions are unchanged.
    expect(consumeRateLimit('a', OPTS, T0 + 4 * MINUTE).allowed).toBe(false);
    expect(consumeRateLimit('b', OPTS, T0 + 4 * MINUTE).allowed).toBe(true);
  });
});
