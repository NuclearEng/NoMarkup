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
});
