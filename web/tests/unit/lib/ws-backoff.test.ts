import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectionStability,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  STABLE_CONNECTION_MS,
  backoffDelayMs,
  jitter,
} from '@/lib/ws-backoff';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('jitter', () => {
  it('stays within [delay/2, delay]', () => {
    for (const base of [1_000, 4_000, 30_000]) {
      for (let i = 0; i < 200; i++) {
        const got = jitter(base);
        expect(got).toBeGreaterThanOrEqual(base / 2);
        expect(got).toBeLessThanOrEqual(base);
      }
    }
  });

  it('actually spreads values out — a herd does not reconnect in lockstep', () => {
    const seen = new Set(Array.from({ length: 200 }, () => jitter(10_000)));
    // Without jitter every client computes the identical delay, so this set
    // would have exactly one member and they would all re-dial together.
    expect(seen.size).toBeGreaterThan(50);
  });

  it('never collapses a long backoff to near-zero', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(jitter(30_000)).toBe(15_000);
  });
});

describe('backoffDelayMs', () => {
  it('escalates with the attempt number', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // pin to the low edge
    expect(backoffDelayMs(0)).toBe(INITIAL_RECONNECT_DELAY_MS / 2);
    expect(backoffDelayMs(1)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(backoffDelayMs(2)).toBe(INITIAL_RECONNECT_DELAY_MS * 2);
  });

  it('caps at the maximum', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    for (const attempt of [10, 20, 50]) {
      expect(backoffDelayMs(attempt)).toBeLessThanOrEqual(MAX_RECONNECT_DELAY_MS);
    }
  });
});

describe('ConnectionStability', () => {
  it('treats an immediate open→close as NOT stable', () => {
    // This is the gateway accept-then-fail case: it accepts the upgrade before
    // dialing the backend, so during an outage the browser sees onopen and
    // then an instant onclose. Resetting backoff on that produced a ~1/s
    // reconnect hot loop.
    vi.useFakeTimers();
    const s = new ConnectionStability();
    s.opened();
    expect(s.closed()).toBe(false);
  });

  it('treats a connection held past the window as stable', () => {
    vi.useFakeTimers();
    const s = new ConnectionStability();
    s.opened();
    vi.advanceTimersByTime(STABLE_CONNECTION_MS + 1);
    expect(s.closed()).toBe(true);
  });

  it('is not stable one tick before the window elapses', () => {
    vi.useFakeTimers();
    const s = new ConnectionStability();
    s.opened();
    vi.advanceTimersByTime(STABLE_CONNECTION_MS - 1);
    expect(s.closed()).toBe(false);
  });

  it('returns false when it never opened', () => {
    expect(new ConnectionStability().closed()).toBe(false);
  });

  it('does not report the same open twice', () => {
    vi.useFakeTimers();
    const s = new ConnectionStability();
    s.opened();
    vi.advanceTimersByTime(STABLE_CONNECTION_MS + 1);
    expect(s.closed()).toBe(true);
    expect(s.closed()).toBe(false);
  });

  it('reset() discards an in-flight open', () => {
    vi.useFakeTimers();
    const s = new ConnectionStability();
    s.opened();
    vi.advanceTimersByTime(STABLE_CONNECTION_MS + 1);
    s.reset();
    expect(s.closed()).toBe(false);
  });
});
