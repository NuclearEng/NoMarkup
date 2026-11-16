// useAuctionTerminal — no job id yet, a provider with several bids appearing
// once in the roster, and an empty bids list falling back to anonymous names.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuctionTerminal } from '@/hooks/useAuctionTerminal';

const streamMock = vi.hoisted(() => vi.fn());
const bidsMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuctionStream', () => ({
  useAuctionStream: streamMock,
}));

vi.mock('@/hooks/useBids', () => ({
  useBidsForJob: bidsMock,
}));

function stream(overrides: Record<string, unknown> = {}) {
  return {
    events: [],
    connectionStatus: 'connected',
    currentLowest: 0,
    bidCount: 0,
    auctionEndsAt: null,
    snipeExtensionCount: 0,
    isConnected: true,
    orderBook: [],
    priceHistory: [],
    velocity: 0,
    momentum: 'stable',
    velocityBuckets: [0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

function bid(id: string, providerId: string, name: string, amount: number) {
  return {
    bid: {
      id,
      provider_id: providerId,
      status: 'active',
      amount_cents: amount,
      created_at: '2026-04-25T00:00:00Z',
    },
    provider_business_name: name,
    provider_display_name: `${name} (display)`,
    trust_score: { overall_score: 90, tier: 'trusted' },
  };
}

beforeEach(() => {
  streamMock.mockReset();
  bidsMock.mockReset();
});

describe('useAuctionTerminal', () => {
  it('asks for bids with an empty job id (disabled query) while the job id is unknown', () => {
    streamMock.mockReturnValue(stream({ connectionStatus: 'disconnected', isConnected: false }));
    bidsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useAuctionTerminal(undefined));

    expect(streamMock).toHaveBeenCalledWith(undefined);
    expect(bidsMock).toHaveBeenCalledWith('');
    expect(result.current.providers.map((p) => p.name)).toEqual([
      'Provider A',
      'Provider B',
      'Provider C',
      'Provider D',
      'Provider E',
      'Provider F',
      'Provider G',
      'Provider H',
    ]);
  });

  it('lists a provider once even when they have several bids, then pads to eight with anonymous names', () => {
    streamMock.mockReturnValue(stream());
    bidsMock.mockReturnValue({
      data: {
        bids: [
          bid('b-1', 'p-1', 'Acme Roofing', 50_000),
          bid('b-2', 'p-1', 'Acme Roofing', 45_000),
          bid('b-3', 'p-2', 'Bolt Electric', 47_000),
        ],
      },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.providers).toHaveLength(8);
    expect(result.current.providers.slice(0, 3).map((p) => p.name)).toEqual([
      'Acme Roofing',
      'Bolt Electric',
      'Provider C',
    ]);
    expect(result.current.providers[0]).toEqual({
      name: 'Acme Roofing',
      trust: 90,
      tier: 'trusted',
      initial: 'AR',
    });
    // Both of the provider's bids still appear in the order book, cheapest first.
    expect(result.current.sim.orderBookBids.map((b) => [b.provider_name, b.amount_cents])).toEqual([
      ['Acme Roofing', 45_000],
      ['Bolt Electric', 47_000],
      ['Acme Roofing', 50_000],
    ]);
  });

  it('uses the display name when there is no business name', () => {
    streamMock.mockReturnValue(stream());
    bidsMock.mockReturnValue({
      data: { bids: [{ ...bid('b-1', 'p-1', '', 50_000), provider_display_name: 'jo smith' }] },
    });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.providers[0]).toMatchObject({ name: 'jo smith', initial: 'JS' });
  });

  it('keeps the anonymous roster for an empty bids list', () => {
    streamMock.mockReturnValue(stream());
    bidsMock.mockReturnValue({ data: { bids: [] } });

    const { result } = renderHook(() => useAuctionTerminal('job-1'));

    expect(result.current.providers[0]?.name).toBe('Provider A');
    expect(result.current.sim.orderBookBids).toEqual([]);
  });
});
