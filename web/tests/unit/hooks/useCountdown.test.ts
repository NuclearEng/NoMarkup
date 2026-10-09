import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCountdown } from '@/hooks/useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "now" to a stable epoch so end-time math is deterministic.
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the placeholder when endTime is null', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.timeLeft).toBe('--:--');
    expect(result.current.isExpired).toBe(true);
    expect(result.current.totalSeconds).toBe(0);
  });

  it('returns the placeholder when endTime is undefined', () => {
    const { result } = renderHook(() => useCountdown(undefined));
    expect(result.current.timeLeft).toBe('--:--');
    expect(result.current.isExpired).toBe(true);
  });

  it('formats minutes:seconds when under one hour remains', () => {
    // 5 minutes 30 seconds in the future
    const end = new Date(Date.now() + 5 * 60_000 + 30_000);
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.isExpired).toBe(false);
    expect(result.current.totalSeconds).toBe(5 * 60 + 30);
    expect(result.current.timeLeft).toBe('5:30');
  });

  it('formats hours and minutes when between one hour and one day', () => {
    // 2h 15m
    const end = new Date(Date.now() + 2 * 3600_000 + 15 * 60_000);
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.timeLeft).toBe('2h 15m');
    expect(result.current.isExpired).toBe(false);
  });

  it('formats days and hours when more than one day remains', () => {
    // 3 days 4 hours
    const end = new Date(Date.now() + 3 * 86400_000 + 4 * 3600_000);
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.timeLeft).toBe('3d 4h');
  });

  it('zero-pads single-digit seconds', () => {
    // 1 minute 5 seconds
    const end = new Date(Date.now() + 65_000);
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.timeLeft).toBe('1:05');
  });

  it('updates as time advances via the 1s interval', () => {
    const end = new Date(Date.now() + 5_000); // 5 seconds out
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.totalSeconds).toBe(5);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.totalSeconds).toBe(3);
    expect(result.current.timeLeft).toBe('0:03');
  });

  it('marks the countdown as expired once the end time passes', () => {
    const end = new Date(Date.now() + 1000);
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.isExpired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isExpired).toBe(true);
    expect(result.current.timeLeft).toBe('0:00');
    expect(result.current.totalSeconds).toBe(0);
  });

  it('accepts an ISO string for endTime', () => {
    const end = new Date(Date.now() + 30_000).toISOString();
    const { result } = renderHook(() => useCountdown(end));

    expect(result.current.totalSeconds).toBe(30);
    expect(result.current.timeLeft).toBe('0:30');
  });

  it('clears the interval on unmount', () => {
    const end = new Date(Date.now() + 60_000);
    const clearSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useCountdown(end));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
