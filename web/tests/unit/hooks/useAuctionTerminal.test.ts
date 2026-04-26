// useAuctionTerminal adapts useAuctionStream + useBidsForJob into the
// SimulationData shape consumed by TerminalGrid. We mock both data hooks and
// verify the projection: providers fall back to anonymous when no real bids,
// real bids enrich the order book with names/trust scores, and stream events
// drive the bids/activities arrays.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuctionTerminal } from '@/hooks/useAuctionTerminal';
import type { AuctionBidEvent } from '@/types';

const streamMock = vi.hoisted(() => vi.fn());
const bidsMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuctionStream', () => ({
  useAuctionStream: streamMock,
}));

vi.mock('@/hooks/useBids', () => ({
  useBidsForJob: bidsMock,
}));

interface StreamShape {
  events: AuctionBidEvent[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  currentLowest: number;
  bidCount: number;
  auctionEndsAt: string | null;
  snipeExtensionCount: number;
  isConnected: boolean;
  orderBook: { id: string; is_new: boolean }[];
  priceHistory: unknown[];
  velocity: number;
  momentum: 'accelerating' | 'decelerating' | 'stable';
  velocityBuckets: number[];
}

function buildStream(overrides: Partial<StreamShape> = {}): StreamShape {
  return {
    events: [],
    connectionStatus: 'disconnected',
    currentLowest: 0,
    bidCount: 0,
    auctionEndsAt: null,
    snipeExtensionCount: 0,
    isConnected: false,
    orderBook: [],
    priceHistory: [],
    velocity: 0,
    momentum: 'stable',
    velocityBuckets: [0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe('useAuctionTerminal', () => {
  beforeEach(() => {
    streamMock.mockReset();
    bidsMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to anonymous providers when there are no real bids', () => {
    streamMock.mockReturnValue(buildStream());
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.providers).toHaveLength(8);
    expect(result.current.providers[0]?.name).toBe('Provider A');
    expect(result.current.sim.bids).toEqual([]);
    expect(result.current.sim.orderBookBids).toEqual([]);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.snipeExtensionCount).toBe(0);
  });

  it('builds a real-provider roster when useBidsForJob returns bids', () => {
    streamMock.mockReturnValue(buildStream());
    bidsMock.mockReturnValue({
      data: {
        bids: [
          {
            bid: {
              id: 'b-1',
              provider_id: 'p-1',
              status: 'active',
              amount_cents: 50000,
              created_at: '2026-04-25T00:00:00Z',
            },
            provider_business_name: 'Acme Roofing',
            provider_display_name: 'Acme',
            trust_score: { overall_score: 92, tier: 'top_rated' },
          },
          {
            bid: {
              id: 'b-2',
              provider_id: 'p-2',
              status: 'active',
              amount_cents: 60000,
              created_at: '2026-04-25T00:00:01Z',
            },
            provider_business_name: '',
            provider_display_name: 'Bob Smith',
            trust_score: { overall_score: 80, tier: 'trusted' },
          },
        ],
      },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    // First two slots are real providers; the rest pad with anonymous fallback.
    expect(result.current.providers).toHaveLength(8);
    expect(result.current.providers[0]?.name).toBe('Acme Roofing');
    expect(result.current.providers[0]?.trust).toBe(92);
    expect(result.current.providers[1]?.name).toBe('Bob Smith');

    // Order book is sorted ascending by amount and reflects real bid metadata.
    expect(result.current.sim.orderBookBids).toHaveLength(2);
    expect(result.current.sim.orderBookBids[0]?.provider_name).toBe('Acme Roofing');
    expect(result.current.sim.orderBookBids[0]?.amount_cents).toBe(50000);
    expect(result.current.sim.orderBookBids[1]?.amount_cents).toBe(60000);
  });

  it('projects stream bid events into sim.bids and computes currentLowest', () => {
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 80000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
      { job_id: 'job-1', amount_cents: 70000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:01Z' },
      { job_id: 'job-1', amount_cents: 60000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:02Z' },
    ];
    streamMock.mockReturnValue(
      buildStream({ events, isConnected: true, connectionStatus: 'connected', bidCount: 3 }),
    );
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.sim.bids).toHaveLength(3);
    expect(result.current.sim.currentLowest).toBe(60000);
    expect(result.current.sim.activities).toHaveLength(3);
    expect(result.current.sim.bidCount).toBe(3);
    expect(result.current.sim.isRunning).toBe(true);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns null error when the stream is disconnected (matches hook behavior)', () => {
    // Hook shorthand: error is only computed via stream.connectionStatus, but the
    // ternary chain currently always produces null. Lock that in so any future
    // refactor that breaks the contract surfaces in tests.
    streamMock.mockReturnValue(buildStream({ connectionStatus: 'connecting' }));
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('forwards snipeExtensionCount from the stream', () => {
    streamMock.mockReturnValue(buildStream({ snipeExtensionCount: 4 }));
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.snipeExtensionCount).toBe(4);
  });

  it('exposes inert simulation control no-ops on sim (live stream)', () => {
    // The hook returns no-op `start`, `pause`, `reset`, and `setShowCelebration`
    // since this is a live auction stream rather than a simulation. Invoke them
    // to verify they don't throw and to cover the noop function body.
    streamMock.mockReturnValue(buildStream());
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(() => {
      result.current.sim.start();
      result.current.sim.pause();
      result.current.sim.reset();
      result.current.sim.setShowCelebration(true);
    }).not.toThrow();
    expect(result.current.sim.showCelebration).toBe(false);
  });

  it('uses real-bid orderBook with WS flash IDs and filters non-active bids', () => {
    // Covers the path where bidsData.bids exist AND we look up flash IDs from
    // the WS orderBook to mark fresh real-bid rows.
    streamMock.mockReturnValue(
      buildStream({
        orderBook: [
          { id: 'b-1', is_new: true },
          { id: 'b-2', is_new: false },
        ],
      }),
    );
    bidsMock.mockReturnValue({
      data: {
        bids: [
          {
            bid: {
              id: 'b-1',
              provider_id: 'p-1',
              status: 'active',
              amount_cents: 50000,
              created_at: '2026-04-25T00:00:00Z',
            },
            provider_business_name: 'Acme',
            provider_display_name: 'Acme',
            trust_score: { overall_score: 90, tier: 'top_rated' },
          },
          {
            bid: {
              id: 'b-2',
              provider_id: 'p-2',
              status: 'withdrawn', // filtered out
              amount_cents: 60000,
              created_at: '2026-04-25T00:00:01Z',
            },
            provider_business_name: 'Other',
            provider_display_name: 'Other',
            trust_score: null,
          },
        ],
      },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    // Only the active bid is in the order book.
    expect(result.current.sim.orderBookBids).toHaveLength(1);
    expect(result.current.sim.orderBookBids[0]?.id).toBe('b-1');
    expect(result.current.sim.orderBookBids[0]?.is_new).toBe(true);
  });

  it('falls back to provider trust defaults when trust_score is null', () => {
    streamMock.mockReturnValue(buildStream());
    bidsMock.mockReturnValue({
      data: {
        bids: [
          {
            bid: {
              id: 'b-1',
              provider_id: 'p-1',
              status: 'active',
              amount_cents: 50000,
              created_at: '2026-04-25T00:00:00Z',
            },
            provider_business_name: '',
            provider_display_name: 'Z X', // initials → "ZX"
            trust_score: null,
          },
        ],
      },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.providers[0]?.trust).toBe(0);
    expect(result.current.providers[0]?.tier).toBe('new');
    expect(result.current.providers[0]?.initial).toBe('ZX');
  });

  it('uses fallback "P?" initials when provider name produces an empty initial set', () => {
    streamMock.mockReturnValue(buildStream());
    bidsMock.mockReturnValue({
      data: {
        bids: [
          {
            bid: {
              id: 'b-1',
              provider_id: 'p-1',
              status: 'active',
              amount_cents: 50000,
              created_at: '2026-04-25T00:00:00Z',
            },
            provider_business_name: '',
            // A name made entirely of whitespace → split produces empty tokens
            // → join('') is '' → fallback 'P?' kicks in.
            provider_display_name: '   ',
            trust_score: { overall_score: 50, tier: 'rising' },
          },
        ],
      },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));
    expect(result.current.providers[0]?.initial).toBe('P?');
  });

  it('filters out non-bid_placed/bid_updated events from sim.bids', () => {
    const events: AuctionBidEvent[] = [
      { job_id: 'job-1', amount_cents: 80000, event_type: 'bid_placed', created_at: '2026-04-25T00:00:00Z' },
      // Synthetic non-price event — should be filtered out.
      { job_id: 'job-1', amount_cents: 0, event_type: 'auction_ended' as AuctionBidEvent['event_type'], created_at: '2026-04-25T00:00:01Z' },
      { job_id: 'job-1', amount_cents: 60000, event_type: 'bid_updated', created_at: '2026-04-25T00:00:02Z' },
    ];
    streamMock.mockReturnValue(buildStream({ events }));
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.sim.bids).toHaveLength(2);
    expect(result.current.sim.currentLowest).toBe(60000);
  });
});
