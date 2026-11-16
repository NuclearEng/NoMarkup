// useReplayTerminal — one pending step at a time. A speed change mid-playback
// used to leave the previous step timer running: it still revealed an event
// after Pause and was left pending on unmount (both failed before the fix).
// The first test pins the 1x → 10x run to completion; it passed before the
// fix too and is here to keep that path from regressing.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplayData } from '@/hooks/useAuctionReplay';
import { useReplayTerminal } from '@/hooks/useReplayTerminal';

// 2s between events: 2000ms per step at 1x, 200ms at 10x.
const REPLAY: ReplayData = {
  job_title: 'Drywall patch',
  category: 'handyman',
  starting_bid_cents: 200000,
  winning_bid_cents: 90000,
  total_savings_cents: 110000,
  duration_seconds: 4,
  bid_count: 3,
  events: [
    { id: 'ev-1', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 150000, created_at: '2026-04-25T00:00:00Z' },
    { id: 'ev-2', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 120000, created_at: '2026-04-25T00:00:02Z' },
    { id: 'ev-3', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 90000, created_at: '2026-04-25T00:00:04Z' },
  ],
};

vi.mock('@/hooks/useAuctionReplay', () => ({
  useAuctionReplay: () => ({ data: REPLAY, isLoading: false, isError: false }),
}));

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useReplayTerminal timers', () => {
  it('stays complete at the last event after a switch from 1x to 10x', () => {
    const { result } = renderHook(() => useReplayTerminal('job-1'));
    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.sim.bidCount).toBe(1);

    act(() => {
      result.current.handleSpeedChange(10);
    });
    // 2000ms gaps at 10x are 200ms each: both remaining events, then complete.
    // One advance per step, so the hook's effect can schedule the next one.
    advance(200);
    advance(200);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.sim.bidCount).toBe(3);
    expect(result.current.scrubValue).toBe(100);

    // Well past the point the abandoned 1x step was due (2000ms).
    advance(5_000);
    expect(result.current.isComplete).toBe(true);
    expect(result.current.sim.bidCount).toBe(3);
    expect(result.current.scrubValue).toBe(100);
  });

  it('does not advance after pause that follows a speed change', () => {
    const { result } = renderHook(() => useReplayTerminal('job-1'));
    act(() => {
      result.current.handlePlay();
    });
    act(() => {
      result.current.handleSpeedChange(2);
    });
    act(() => {
      result.current.handlePause();
    });

    advance(10_000);

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.sim.bidCount).toBe(1);
  });

  it('leaves no step timer pending after unmount', () => {
    const { result, unmount } = renderHook(() => useReplayTerminal('job-1'));
    act(() => {
      result.current.handlePlay();
    });
    act(() => {
      result.current.handleSpeedChange(2);
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
