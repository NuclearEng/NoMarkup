import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from '@/hooks/useCountUp';

describe('useCountUp', () => {
  let rafCallbacks: Array<(timestamp: number) => void>;
  let rafIdCounter: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 0;
    cancelledIds = new Set();

    vi.stubGlobal('requestAnimationFrame', (cb: (timestamp: number) => void) => {
      rafIdCounter += 1;
      const id = rafIdCounter;
      rafCallbacks.push((ts: number) => {
        if (!cancelledIds.has(id)) {
          cb(ts);
        }
      });
      return id;
    });

    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledIds.add(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRAF(timestamp: number) {
    const pending = rafCallbacks.splice(0);
    for (const cb of pending) {
      cb(timestamp);
    }
  }

  it('returns 0 initially before any animation frame fires', () => {
    const { result } = renderHook(() => useCountUp(100));
    // Before any RAF callback fires, the value should be 0
    expect(result.current).toBe(0);
  });

  it('animates from 0 to the target value', () => {
    const duration = 600;
    const target = 100;
    const { result } = renderHook(() => useCountUp(target, duration));

    // First frame at t=0 — should start from 0
    act(() => { flushRAF(0); });
    expect(result.current).toBe(0);

    // Midway through animation — should be partially animated
    act(() => { flushRAF(300); });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(target);

    // At exactly the duration — should reach the target
    act(() => { flushRAF(600); });
    expect(result.current).toBe(target);
  });

  it('handles target=0 (stays at 0)', () => {
    const { result } = renderHook(() => useCountUp(0));

    act(() => { flushRAF(0); });
    expect(result.current).toBe(0);

    act(() => { flushRAF(300); });
    expect(result.current).toBe(0);

    act(() => { flushRAF(600); });
    expect(result.current).toBe(0);
  });

  it('cancels animation frame on unmount (no memory leak)', () => {
    const { unmount } = renderHook(() => useCountUp(100));

    // Fire the first frame so an animation is in progress
    act(() => { flushRAF(0); });

    // There should be a pending RAF at this point
    expect(rafCallbacks.length).toBeGreaterThan(0);

    // Unmount — the cleanup should call cancelAnimationFrame
    unmount();

    // The most recently scheduled RAF id should have been cancelled
    expect(cancelledIds.size).toBeGreaterThan(0);
  });

  it('uses ease-out cubic easing', () => {
    const duration = 600;
    const target = 1000;
    const { result } = renderHook(() => useCountUp(target, duration));

    // First frame to set start time
    act(() => { flushRAF(0); });

    // At 50% time, ease-out cubic = 1 - (1 - 0.5)^3 = 1 - 0.125 = 0.875
    // So value should be ~875
    act(() => { flushRAF(300); });
    expect(result.current).toBe(875);
  });

  it('respects custom duration', () => {
    const duration = 1000;
    const target = 200;
    const { result } = renderHook(() => useCountUp(target, duration));

    act(() => { flushRAF(0); });

    // At 500ms of 1000ms duration, progress=0.5, eased=0.875
    act(() => { flushRAF(500); });
    expect(result.current).toBe(175); // 200 * 0.875

    act(() => { flushRAF(1000); });
    expect(result.current).toBe(200);
  });
});
