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
});
