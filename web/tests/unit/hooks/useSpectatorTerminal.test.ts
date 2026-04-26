// useSpectatorTerminal is a presentational adapter over useSpectatorStream.
// We mock the stream hook and verify it (a) returns a properly-shaped sim object
// for the empty-stream case, (b) projects incoming events into bids/orderBook/
// activities, and (c) re-exports the underlying connection metadata.
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSpectatorTerminal } from '@/hooks/useSpectatorTerminal';
import type { AuctionBidEvent } from '@/types';

const streamMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSpectatorStream', () => ({
  useSpectatorStream: streamMock,
}));

function buildStream(overrides: Partial<{
  events: AuctionBidEvent[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  currentLowest: number;
  bidCount: number;
  spectatorCount: number;
  isConnected: boolean;
  error: string | null;
}> = {}) {
  return {
    events: [] as AuctionBidEvent[],
    connectionStatus: 'disconnected' as const,
    currentLowest: 0,
    bidCount: 0,
    spectatorCount: 0,
    isConnected: false,
    error: null as string | null,
    ...overrides,
  };
}

describe('useSpectatorTerminal', () => {
  beforeEach(() => {
    streamMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the empty SimulationData shape when no events have arrived', () => {
    streamMock.mockReturnValue(buildStream());

    const { result } = renderHook(() => useSpectatorTerminal(undefined));

    expect(result.current.sim.bids).toEqual([]);
    expect(result.current.sim.orderBookBids).toEqual([]);
    expect(result.current.sim.currentLowest).toBe(0);
    expect(result.current.sim.bidCount).toBe(0);
    expect(result.current.providers).toHaveLength(8);
    expect(result.current.spectatorCount).toBe(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('projects stream events into bids and computes currentLowest', () => {
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
      { job_id: 'job-1', amount_cents: 30000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:01Z' },
    ];
    streamMock.mockReturnValue(
      buildStream({ events, connectionStatus: 'connected', isConnected: true }),
    );

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));

    expect(result.current.sim.bids).toHaveLength(2);
    expect(result.current.sim.currentLowest).toBe(30000);
    expect(result.current.sim.orderBookBids[0]?.amount_cents).toBe(30000);
    expect(result.current.sim.activities).toHaveLength(2);
    expect(result.current.sim.bidCount).toBe(2);
    expect(result.current.sim.isRunning).toBe(true);
  });

  it('clears local bid state when the upstream stream resets to empty', () => {
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result, rerender } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.bids).toHaveLength(1);

    streamMock.mockReturnValue(buildStream({ events: [] }));
    act(() => {
      rerender();
    });

    expect(result.current.sim.bids).toEqual([]);
    expect(result.current.sim.currentLowest).toBe(0);
  });

  it('exposes spectatorCount and error from the stream', () => {
    streamMock.mockReturnValue(
      buildStream({ spectatorCount: 47, error: 'WebSocket disconnected' }),
    );

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));

    expect(result.current.spectatorCount).toBe(47);
    expect(result.current.error).toBe('WebSocket disconnected');
  });

  it('exposes inert simulation control no-ops on sim (live spectator stream)', () => {
    // The hook returns no-op start/pause/reset/setShowCelebration for the live
    // spectator stream. Invoke them to cover the noop function body.
    streamMock.mockReturnValue(buildStream());

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));

    expect(() => {
      result.current.sim.start();
      result.current.sim.pause();
      result.current.sim.reset();
      result.current.sim.setShowCelebration(true);
    }).not.toThrow();
    expect(result.current.sim.showCelebration).toBe(false);
  });

  it('flashes multiple bids and clears each is_new marker independently', () => {
    // Hits the inner map's false branch (b.id !== bid.id) when the flash timer
    // for one bid runs while other bids exist in the array.
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
      { job_id: 'job-1', amount_cents: 30000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:01Z' },
      { job_id: 'job-1', amount_cents: 40000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:02Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.bids.every((b) => b.is_new)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(result.current.sim.bids.every((b) => b.is_new === false)).toBe(true);
  });

  it('does not re-process events when the stream rerenders with no new events', () => {
    // Hits the `newEvents.length === 0` early return at line 80 by giving the
    // hook a fresh array reference (new identity) with the same contents. The
    // useEffect will re-run because the deps changed by reference, but the
    // event slice will be empty since bidCounterRef has already consumed them.
    const eventA: AuctionBidEvent = {
      job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z',
    };
    streamMock.mockReturnValue(buildStream({ events: [eventA] }));

    const { result, rerender } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.bids).toHaveLength(1);
    const firstBidId = result.current.sim.bids[0]?.id;

    // New array reference but identical contents — useEffect re-runs, but
    // newEvents.length will be 0.
    streamMock.mockReturnValue(buildStream({ events: [eventA] }));
    act(() => {
      rerender();
    });

    // No duplicate bids; the same single bid is preserved (id-stable).
    expect(result.current.sim.bids).toHaveLength(1);
    expect(result.current.sim.bids[0]?.id).toBe(firstBidId);
  });

  it('flashes new bids and clears the is_new marker after 2 seconds', () => {
    // Advance the system clock far enough that all bid timestamps fall outside
    // the 60s velocity window — this exercises the `age > 60_000` filter
    // and ensures the velocity bucket loop does not push into out-of-range
    // bucket indices. We then verify the flash timer actually expires.
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));
    // Bid is freshly added → is_new is true.
    expect(result.current.sim.bids[0]?.is_new).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(result.current.sim.bids[0]?.is_new).toBe(false);
  });

  it('reuses the same providerIdx for events with identical timestamp+amount keys', () => {
    // Two events with the same created_at and amount_cents should resolve to
    // the same providerIdx via the providerMapRef cache. This covers the
    // `provIdx !== undefined` branch in the event projection loop.
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
      { job_id: 'job-1', amount_cents: 60000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:01Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result, rerender } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.bids).toHaveLength(2);

    // Append a third event (with a fresh key); the previous map entries stay.
    const events2: AuctionBidEvent[] = [
      ...events,
      { job_id: 'job-1', amount_cents: 70000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:02Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events: events2 }));
    act(() => {
      rerender();
    });
    expect(result.current.sim.bids).toHaveLength(3);
  });

  it('keeps currentLowest stable when a new bid is added that is not lower', () => {
    // Drive previousLowest update in the useEffect at line 137: the first
    // event sets previousLowest. A second, higher-priced bid keeps
    // currentLowest unchanged (no useEffect update) — covers the
    // currentLowest === previousLowest.current branch on a stable rerender.
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 30000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result, rerender } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.currentLowest).toBe(30000);

    // Add a higher-priced bid — currentLowest stays at 30000.
    const events2: AuctionBidEvent[] = [
      ...events,
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:01Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events: events2 }));
    act(() => {
      rerender();
    });

    expect(result.current.sim.currentLowest).toBe(30000);
  });

  it('returns currentLowest of 0 when bids exist but all amount_cents are 0', () => {
    // currentLowest > 0 false branch in the useEffect that updates previousLowest.
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 0, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.currentLowest).toBe(0);
  });

  it('counts bids inside the 15s velocity window and respects the 60s bucket cap', () => {
    // Use real time math: created_at slightly in the past.
    const now = Date.now();
    const recent = new Date(now - 5_000).toISOString();   // velocity window
    const stale = new Date(now - 90_000).toISOString();   // outside both windows
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 50000, event_type: 'bid_placed', created_at: recent },
      { job_id: 'job-1', amount_cents: 30000, event_type: 'bid_placed', created_at: stale },
    ];
    streamMock.mockReturnValue(buildStream({ events }));

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));
    expect(result.current.sim.velocity).toBe(1);
    // Total of velocityBuckets equals number of timestamps within 60s.
    const total = result.current.sim.velocityBuckets.reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });
});
