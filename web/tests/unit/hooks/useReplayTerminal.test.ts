// useReplayTerminal is a heavy state-machine wrapper around useAuctionReplay.
// We mock the data hook and exercise the public API: initial state when no data,
// shape when data is present, and that the playback handlers (play/pause/restart/
// scrub/speed) all mutate the returned state correctly. Timer-driven scheduling
// is exercised by handlePlay → setCurrentEventIndex flow under fake timers.
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReplayTerminal, SPEED_OPTIONS } from '@/hooks/useReplayTerminal';
import type { ReplayData } from '@/hooks/useAuctionReplay';

const mockReplay: ReplayData = {
  job_title: 'Drywall patch',
  category: 'handyman',
  starting_bid_cents: 200000,
  winning_bid_cents: 90000,
  total_savings_cents: 110000,
  duration_seconds: 90,
  bid_count: 3,
  events: [
    { id: 'ev-1', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 150000, created_at: '2026-04-25T00:00:00Z' },
    { id: 'ev-2', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 120000, created_at: '2026-04-25T00:00:30Z' },
    { id: 'ev-3', job_id: 'job-1', event_type: 'bid_placed', amount_cents: 90000, created_at: '2026-04-25T00:01:00Z' },
  ],
};

const replayMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuctionReplay', () => ({
  useAuctionReplay: replayMock,
}));

describe('useReplayTerminal', () => {
  beforeEach(() => {
    replayMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns loading state when the replay query is still loading', () => {
    replayMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.jobTitle).toBe('');
    expect(result.current.totalLabel).toBe('0:00');
    expect(result.current.scrubValue).toBe(0);
    expect(result.current.sim.bids).toHaveLength(0);
  });

  it('hydrates fields from replay data when loaded', () => {
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    expect(result.current.jobTitle).toBe('Drywall patch');
    expect(result.current.category).toBe('handyman');
    expect(result.current.startingBidCents).toBe(200000);
    expect(result.current.winningBidCents).toBe(90000);
    expect(result.current.durationSeconds).toBe(90);
    expect(result.current.totalBidCount).toBe(3);
    expect(result.current.totalLabel).toBe('1:30');
    // Default playback state — nothing playing yet, no events visible.
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.speed).toBe(5);
    expect(result.current.sim.bids).toHaveLength(0);
  });

  it('handlePlay starts playback and reveals the first event', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.sim.bids).toHaveLength(1);
    expect(result.current.sim.bids[0]?.amount_cents).toBe(150000);
  });

  it('handlePause stops playback', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.handlePause();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it('handleRestart resets playback to the pre-play state', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });
    act(() => {
      result.current.handleRestart();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.sim.bids).toHaveLength(0);
    expect(result.current.scrubValue).toBe(0);
  });

  it('handleScrub jumps the cursor to the given percentage', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    // Scrub to 50% — index = round(0.5 * (3-1)) = 1, so 2 events visible.
    act(() => {
      result.current.handleScrub([50]);
    });

    expect(result.current.sim.bids).toHaveLength(2);
    expect(result.current.scrubValue).toBe(50);

    // Scrub to 100% — all 3 events visible.
    act(() => {
      result.current.handleScrub([100]);
    });
    expect(result.current.sim.bids).toHaveLength(3);
    expect(result.current.scrubValue).toBe(100);
  });

  it('handleSpeedChange updates the playback speed', () => {
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handleSpeedChange(10);
    });
    expect(result.current.speed).toBe(10);
  });

  it('exports the canonical SPEED_OPTIONS list', () => {
    expect(SPEED_OPTIONS).toEqual([1, 2, 5, 10]);
  });

  it('handlePlay is a noop when there is no replay data', () => {
    replayMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.sim.bids).toHaveLength(0);
  });

  it('handlePlay is a noop when the replay has zero events', () => {
    replayMock.mockReturnValue({
      data: { ...mockReplay, events: [] },
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it('flash timer clears the is_new flag after FLASH_DURATION_MS', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });

    // First event is flashing.
    expect(result.current.sim.bids[0]?.is_new).toBe(true);

    // Advance past FLASH_DURATION_MS to trigger the cleanup setFlashIds setter.
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(result.current.sim.bids[0]?.is_new).toBe(false);
  });

  it('replays from the start when handlePlay is called after completion', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    // Scrub to the last event so the replay is positioned at completion.
    act(() => {
      result.current.handleScrub([100]);
    });
    expect(result.current.sim.bids).toHaveLength(3);

    // Play from the end → schedules next; since nextIndex === events.length,
    // the engine sets isComplete=true on the next tick.
    act(() => {
      result.current.handlePlay();
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.isComplete).toBe(true);
    expect(result.current.isPlaying).toBe(false);

    // Now press play again — this hits the isComplete branch (lines 334-355):
    // resets to 0, restarts playback, and re-flashes the first event.
    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.isComplete).toBe(false);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.sim.bids).toHaveLength(1);
    expect(result.current.sim.bids[0]?.amount_cents).toBe(150000);
    expect(result.current.sim.bids[0]?.is_new).toBe(true);

    // Flash should clear after FLASH_DURATION_MS.
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.sim.bids[0]?.is_new).toBe(false);
  });

  it('scheduler advances to the next event when its timer fires', () => {
    vi.useFakeTimers();
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handlePlay();
    });
    expect(result.current.sim.bids).toHaveLength(1);

    // Real gap between event 1 and 2 is 30s; clamped to MAX_DELAY_MS = 3000ms.
    // Drain the schedule timer so the next event becomes visible (covers
    // the scheduleNextEvent setTimeout body — setCurrentEventIndex + flash).
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(result.current.sim.bids).toHaveLength(2);
    expect(result.current.sim.bids[1]?.amount_cents).toBe(120000);
    expect(result.current.sim.bids[1]?.is_new).toBe(true);

    // Drain the flash-clear timer for the second event.
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.sim.bids[1]?.is_new).toBe(false);
  });

  it('handleScrub is a noop without replay data', () => {
    replayMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handleScrub([50]);
    });

    expect(result.current.sim.bids).toHaveLength(0);
    expect(result.current.scrubValue).toBe(0);
  });

  it('handleScrub is a noop when given an empty value array', () => {
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handleScrub([]);
    });

    // currentEventIndex stayed at -1 → no events visible.
    expect(result.current.sim.bids).toHaveLength(0);
    expect(result.current.scrubValue).toBe(0);
  });

  it('drops bids older than 60s from the velocity-bucket window', () => {
    const longReplay = {
      ...mockReplay,
      duration_seconds: 240,
      bid_count: 4,
      events: [
        // First event is 90s before the latest → should fall outside 60s window.
        { id: 'ev-x1', job_id: 'job-1', event_type: 'bid_placed' as const, amount_cents: 200000, created_at: '2026-04-25T00:00:00Z' },
        { id: 'ev-x2', job_id: 'job-1', event_type: 'bid_placed' as const, amount_cents: 180000, created_at: '2026-04-25T00:00:30Z' },
        { id: 'ev-x3', job_id: 'job-1', event_type: 'bid_placed' as const, amount_cents: 150000, created_at: '2026-04-25T00:01:00Z' },
        { id: 'ev-x4', job_id: 'job-1', event_type: 'bid_placed' as const, amount_cents: 100000, created_at: '2026-04-25T00:01:30Z' },
      ],
    };
    replayMock.mockReturnValue({ data: longReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    act(() => {
      result.current.handleScrub([100]);
    });

    // 4 events span 90s. Velocity buckets cover the last 60s → first event age 90s
    // hits the `if (age > 60_000) continue` branch.
    const bucketsTotal = result.current.sim.velocityBuckets.reduce((s, n) => s + n, 0);
    expect(bucketsTotal).toBe(3);
    // Velocity counts events in the last 15s of replay time → only the latest event.
    expect(result.current.sim.velocity).toBe(1);
  });

  it('clamps the scrub index to the valid event range', () => {
    replayMock.mockReturnValue({ data: mockReplay, isLoading: false, isError: false });

    const { result } = renderHook(() => useReplayTerminal('job-1'));

    // Scrubbing far past 100% should clamp to the last event.
    act(() => {
      result.current.handleScrub([250]);
    });
    expect(result.current.sim.bids).toHaveLength(3);

    // Scrubbing well below 0% should clamp to -1 (no events visible).
    act(() => {
      result.current.handleScrub([-200]);
    });
    expect(result.current.sim.bids).toHaveLength(0);
  });

  it('reports scrubValue=0 when the replay has only one event', () => {
    const singleEventReplay = {
      ...mockReplay,
      bid_count: 1,
      events: [mockReplay.events[0]!],
    };
    replayMock.mockReturnValue({
      data: singleEventReplay,
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useReplayTerminal('job-1'));
    // events.length <= 1 short-circuit → scrubValue is always 0.
    expect(result.current.scrubValue).toBe(0);
  });
});
