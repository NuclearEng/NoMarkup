// useSpectatorTerminal — an event that repeats an earlier (timestamp, amount)
// pair keeps the same anonymous provider, the provider roster wraps after 8,
// and bids dated in the future (clock skew) are left out of the velocity bars.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSpectatorTerminal } from '@/hooks/useSpectatorTerminal';
import type { AuctionBidEvent } from '@/types';

const streamMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSpectatorStream', () => ({
  useSpectatorStream: streamMock,
}));

const NOW = new Date('2026-04-25T12:00:00Z');

function stream(events: AuctionBidEvent[]) {
  return {
    events,
    connectionStatus: 'connected' as const,
    currentLowest: 0,
    bidCount: events.length,
    spectatorCount: 0,
    isConnected: true,
    error: null,
  };
}

function event(amount: number, offsetMs: number): AuctionBidEvent {
  return {
    job_id: 'job-1',
    amount_cents: amount,
    event_type: 'bid_placed',
    created_at: new Date(NOW.getTime() + offsetMs).toISOString(),
  };
}

beforeEach(() => {
  streamMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSpectatorTerminal — anonymous provider assignment', () => {
  it('gives a repeated (timestamp, amount) event the provider of the first occurrence', () => {
    const first = event(50_000, -5_000);
    const other = event(40_000, -4_000);
    streamMock.mockReturnValue(stream([first, other]));
    const { result, rerender } = renderHook(() => useSpectatorTerminal('job-1'));

    // The server replays the first event (same timestamp and amount).
    streamMock.mockReturnValue(stream([first, other, { ...first }]));
    act(() => {
      rerender();
    });

    const bids = result.current.sim.bids;
    expect(bids).toHaveLength(3);
    expect(bids[2]?.providerIdx).toBe(bids[0]?.providerIdx);
    expect(bids[1]?.providerIdx).not.toBe(bids[0]?.providerIdx);
    // Ids stay unique even though the provider is shared.
    expect(new Set(bids.map((b) => b.id)).size).toBe(3);
    const names = result.current.sim.orderBookBids
      .filter((b) => b.amount_cents === 50_000)
      .map((b) => b.provider_name);
    expect(names).toEqual(['Provider A', 'Provider A']);
  });

  it('wraps back to the first anonymous provider after eight distinct bidders', () => {
    const events = Array.from({ length: 9 }, (_, i) => event(90_000 - i * 1_000, -9_000 + i * 1_000));
    streamMock.mockReturnValue(stream(events));

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));

    expect(result.current.sim.bids.map((b) => b.providerIdx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
    const cheapest = result.current.sim.orderBookBids[0];
    expect(cheapest?.amount_cents).toBe(82_000);
    expect(cheapest?.provider_name).toBe('Provider A');
  });
});

describe('useSpectatorTerminal — velocity buckets', () => {
  it('places bids by age (newest bucket last) and leaves out future-dated and stale bids', () => {
    streamMock.mockReturnValue(
      stream([
        event(50_000, -2_000), // 0-10s old → last bucket
        event(49_000, -15_000), // 10-20s old
        event(48_000, -59_000), // 50-60s old → first bucket
        event(47_000, -61_000), // older than a minute → dropped
        event(46_000, 30_000), // 30s in the future (skewed clock) → dropped
      ]),
    );

    const { result } = renderHook(() => useSpectatorTerminal('job-1'));

    expect(result.current.sim.velocityBuckets).toEqual([1, 0, 0, 0, 1, 1]);
    // The 15s velocity counter (inclusive cutoff, no upper bound) counts the
    // 2s-old bid, the exactly-15s-old bid and the future-dated one.
    expect(result.current.sim.velocity).toBe(3);
  });
});
