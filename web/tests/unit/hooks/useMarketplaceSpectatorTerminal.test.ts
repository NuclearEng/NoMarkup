// useMarketplaceSpectatorTerminal adapts the goods listing (REST), its bid
// history (REST) and the marketplace spectator socket (last bid only) into the
// SimulationData the terminal grid renders. The three data hooks are replaced
// by controllable state so each adapter rule can be pinned: seeding once per
// listing, live-bid accumulation and de-duplication, the ascending-auction
// "currentLowest = current HIGH" alias, fallbacks when data is missing, and
// timer cleanup.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarketplaceSpectatorTerminal } from '@/hooks/useMarketplaceSpectatorTerminal';

interface ListingStub {
  title?: string;
  description?: string;
  category_name?: string;
  condition?: string;
  current_bid_cents?: number;
  starting_price_cents?: number;
  auction_ends_at?: string;
  snipe_extension_count?: number;
}

interface HistoryBidStub {
  id: string;
  listing_id: string;
  bidder_id: string;
  bidder_display_name: string;
  amount_cents: number;
  is_winning: boolean;
  created_at: string;
}

interface LiveBidStub {
  type: 'bid_placed';
  listing_id: string;
  amount_cents: number;
  snipe_extension: boolean;
  snipe_extension_count: number;
  new_auction_ends_at: string | null;
  timestamp: string;
}

const hooks = vi.hoisted(() => ({
  useListing: vi.fn(),
  useListingBids: vi.fn(),
  useMarketplaceSpectator: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/hooks/useListings', () => ({
  useListing: hooks.useListing,
  useListingBids: hooks.useListingBids,
}));

vi.mock('@/hooks/useMarketplaceSpectator', () => ({
  useMarketplaceSpectator: hooks.useMarketplaceSpectator,
}));

const NOW = new Date('2026-05-01T12:00:00Z');

function iso(secondsAgo: number): string {
  return new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
}

function historyBid(
  id: string,
  amount: number,
  secondsAgo: number,
  displayName = '',
): HistoryBidStub {
  return {
    id,
    listing_id: 'lst-1',
    bidder_id: `bidder-${id}`,
    bidder_display_name: displayName,
    amount_cents: amount,
    is_winning: false,
    created_at: iso(secondsAgo),
  };
}

function liveBid(amount: number, secondsAgo: number, extra: Partial<LiveBidStub> = {}): LiveBidStub {
  return {
    type: 'bid_placed',
    listing_id: 'lst-1',
    amount_cents: amount,
    snipe_extension: false,
    snipe_extension_count: 0,
    new_auction_ends_at: null,
    timestamp: iso(secondsAgo),
    ...extra,
  };
}

function setListing(
  listing: ListingStub | undefined,
  flags: { isLoading?: boolean; isError?: boolean; isFetching?: boolean } = {},
): void {
  hooks.useListing.mockReturnValue({
    data: listing,
    isLoading: flags.isLoading ?? false,
    isError: flags.isError ?? false,
    isFetching: flags.isFetching ?? false,
    refetch: hooks.refetch,
  });
}

function setHistory(bids: HistoryBidStub[] | undefined): void {
  hooks.useListingBids.mockReturnValue({
    data: bids === undefined ? undefined : { bids, current_bid_cents: 0, bidder_count: bids.length },
  });
}

function setSpectator(
  lastBid: LiveBidStub | null,
  opts: { isConnected?: boolean; watcherCount?: number } = {},
): void {
  hooks.useMarketplaceSpectator.mockReturnValue({
    isConnected: opts.isConnected ?? false,
    connectionStatus: opts.isConnected ? 'connected' : 'disconnected',
    lastBid,
    watcherCount: opts.watcherCount ?? 0,
  });
}

function mountWith(listingId: string | undefined) {
  return renderHook(({ id }: { id: string | undefined }) => useMarketplaceSpectatorTerminal(id), {
    initialProps: { id: listingId },
  });
}

function mount(listingId = 'lst-1') {
  return mountWith(listingId);
}

describe('useMarketplaceSpectatorTerminal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hooks.useListing.mockReset();
    hooks.useListingBids.mockReset();
    hooks.useMarketplaceSpectator.mockReset();
    hooks.refetch.mockReset();
    setListing(undefined);
    setHistory(undefined);
    setSpectator(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('without data', () => {
    it('queries with an empty id and returns neutral defaults when no listing is selected', () => {
      const { result } = mountWith(undefined);

      expect(hooks.useListing).toHaveBeenCalledWith('');
      expect(hooks.useListingBids).toHaveBeenCalledWith('');
      expect(hooks.useMarketplaceSpectator).toHaveBeenCalledWith(undefined);

      expect(result.current.sim.bids).toEqual([]);
      expect(result.current.sim.events).toEqual([]);
      expect(result.current.sim.currentLowest).toBe(0);
      expect(result.current.sim.previousLowest).toBeUndefined();
      expect(result.current.sim.sparklineBids).toEqual([]);
      expect(result.current.sim.velocity).toBe(0);
      expect(result.current.sim.velocityBuckets).toEqual([0, 0, 0, 0, 0, 0]);
      expect(result.current.sim.bidCount).toBe(0);
      expect(result.current.sim.isRunning).toBe(false);
      expect(result.current.sim.showCelebration).toBe(false);
      expect(result.current.auctionEndsAt).toBeNull();
      expect(result.current.startingPriceCents).toBe(0);
      expect(result.current.snipeExtensionCount).toBe(0);
      expect(result.current.jobTitle).toBe('');
      expect(result.current.jobDescription).toBe('');
      expect(result.current.jobCategory).toBe('');
      expect(result.current.providers).toHaveLength(8);
    });

    it('passes the listing id through to all three data hooks', () => {
      mount('lst-42');

      expect(hooks.useListing).toHaveBeenCalledWith('lst-42');
      expect(hooks.useListingBids).toHaveBeenCalledWith('lst-42');
      expect(hooks.useMarketplaceSpectator).toHaveBeenCalledWith('lst-42');
    });

    it('shows the listing current bid as the market price while there are no bid rows', () => {
      setListing({ current_bid_cents: 4200, starting_price_cents: 1000 });
      setHistory([]);

      const { result } = mount();

      expect(result.current.sim.currentLowest).toBe(4200);
      expect(result.current.sim.bidCount).toBe(0);
      // Starting price leads the sparkline even with no bids.
      expect(result.current.sim.sparklineBids).toEqual([1000]);
    });

    it('surfaces the listing query flags and wires retry to refetch', () => {
      setListing(undefined, { isLoading: true, isError: true, isFetching: true });

      const { result } = mount();

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isError).toBe(true);
      expect(result.current.isFetching).toBe(true);

      expect(hooks.refetch).not.toHaveBeenCalled();
      result.current.retry();
      expect(hooks.refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('listing metadata', () => {
    it('maps listing fields and prefers category_name over condition', () => {
      setListing({
        title: 'Table saw',
        description: 'Barely used',
        category_name: 'Tools',
        condition: 'good',
        starting_price_cents: 5000,
        auction_ends_at: '2026-05-02T00:00:00Z',
        snipe_extension_count: 2,
      });
      setSpectator(null, { isConnected: true, watcherCount: 7 });

      const { result } = mount();

      expect(result.current.jobTitle).toBe('Table saw');
      expect(result.current.jobDescription).toBe('Barely used');
      expect(result.current.jobCategory).toBe('Tools');
      expect(result.current.startingPriceCents).toBe(5000);
      expect(result.current.auctionEndsAt).toBe('2026-05-02T00:00:00Z');
      expect(result.current.snipeExtensionCount).toBe(2);
      expect(result.current.spectatorCount).toBe(7);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.sim.isRunning).toBe(true);
    });

    it('falls back to the condition when the listing has no category name', () => {
      setListing({ condition: 'like_new' });

      const { result } = mount();

      expect(result.current.jobCategory).toBe('like_new');
    });

    it('prefers the live snipe-extended end time and extension count over the listing', () => {
      setListing({ auction_ends_at: '2026-05-02T00:00:00Z', snipe_extension_count: 1 });
      setSpectator(
        liveBid(9000, 1, {
          snipe_extension: true,
          snipe_extension_count: 3,
          new_auction_ends_at: '2026-05-02T00:02:00Z',
        }),
      );

      const { result } = mount();

      expect(result.current.auctionEndsAt).toBe('2026-05-02T00:02:00Z');
      expect(result.current.snipeExtensionCount).toBe(3);
    });

    it('keeps the listing end time when the live bid did not extend the auction', () => {
      setListing({ auction_ends_at: '2026-05-02T00:00:00Z', snipe_extension_count: 1 });
      setSpectator(liveBid(9000, 1, { new_auction_ends_at: null, snipe_extension_count: 0 }));

      const { result } = mount();

      expect(result.current.auctionEndsAt).toBe('2026-05-02T00:00:00Z');
      // The live count is authoritative even at 0 (it is not "missing").
      expect(result.current.snipeExtensionCount).toBe(0);
    });
  });

  describe('seeding from REST bid history', () => {
    it('orders bids chronologically, names anonymous bidders, and treats the HIGH bid as the market price', () => {
      setListing({ starting_price_cents: 1000 });
      setHistory([
        historyBid('b-late', 3000, 5, 'Dana'),
        historyBid('b-early', 2000, 50),
        historyBid('b-mid', 3000, 20),
      ]);

      const { result } = mount();
      const { sim } = result.current;

      expect(sim.bids.map((b) => b.id)).toEqual(['b-early', 'b-mid', 'b-late']);
      expect(sim.bids.map((b) => b.providerIdx)).toEqual([0, 1, 2]);
      expect(sim.bids.every((b) => !b.is_new)).toBe(true);
      expect(sim.bidCount).toBe(3);
      expect(sim.currentLowest).toBe(3000);

      // Order book: highest first; the bidder's own name wins over the alias.
      expect(sim.orderBookBids.map((b) => [b.id, b.provider_name, b.amount_cents])).toEqual([
        ['b-mid', 'Bidder B', 3000],
        ['b-late', 'Dana', 3000],
        ['b-early', 'Bidder A', 2000],
      ]);
      expect(sim.orderBookBids[0]).toMatchObject({ trust_score: 90, trust_tier: 'top_rated' });
      expect(sim.depthBuckets).toEqual([
        { amount_cents: 3000, count: 2 },
        { amount_cents: 2000, count: 1 },
      ]);

      // Activity feed: newest first, every bid at the leading price is flagged.
      expect(sim.activities.map((a) => [a.id, a.providerName, a.amount, a.isLowest])).toEqual([
        ['b-late', 'Dana', 3000, true],
        ['b-mid', 'Bidder B', 3000, true],
        ['b-early', 'Bidder A', 2000, false],
      ]);

      expect(sim.sparklineBids).toEqual([1000, 2000, 3000, 3000]);
      expect(sim.events).toEqual([
        { job_id: 'lst-1', amount_cents: 2000, event_type: 'bid_placed', created_at: iso(50) },
        { job_id: 'lst-1', amount_cents: 3000, event_type: 'bid_placed', created_at: iso(20) },
        { job_id: 'lst-1', amount_cents: 3000, event_type: 'bid_placed', created_at: iso(5) },
      ]);
    });

    it('omits the starting price from the sparkline when the listing has none', () => {
      setListing({ starting_price_cents: 0 });
      setHistory([historyBid('b-1', 2000, 30), historyBid('b-2', 2500, 10)]);

      const { result } = mount();

      expect(result.current.sim.sparklineBids).toEqual([2000, 2500]);
    });

    it('wraps the anonymous bidder palette after eight bidders', () => {
      setHistory(Array.from({ length: 9 }, (_, i) => historyBid(`b-${String(i)}`, 1000 + i, 90 - i)));

      const { result } = mount();
      const ninth = result.current.sim.bids[8];

      expect(ninth?.providerIdx).toBe(0);
      expect(result.current.sim.orderBookBids.find((b) => b.id === 'b-8')?.provider_name).toBe(
        'Bidder A',
      );
    });

    it('counts velocity over the last 15s and buckets the last minute by 10s, dropping older bids', () => {
      setHistory([
        historyBid('b-old', 1000, 61),
        historyBid('b-60', 1100, 60),
        historyBid('b-25', 1200, 25),
        historyBid('b-15', 1300, 15),
        historyBid('b-9', 1400, 9),
        historyBid('b-0', 1500, 0),
      ]);

      const { result } = mount();

      // 15s cutoff is inclusive: bids at 15s, 9s and 0s.
      expect(result.current.sim.velocity).toBe(3);
      // Buckets run oldest → newest; the 61s bid is outside the window and the
      // 60s bid lands in the oldest bucket.
      expect(result.current.sim.velocityBuckets).toEqual([1, 0, 0, 1, 1, 2]);
    });

    it('seeds only once: a refetched history does not replace the accumulated rows', () => {
      setHistory([historyBid('b-1', 2000, 30)]);
      const { result, rerender } = mount();
      expect(result.current.sim.bids.map((b) => b.id)).toEqual(['b-1']);

      setHistory([historyBid('b-1', 2000, 30), historyBid('b-2', 9999, 10)]);
      rerender({ id: 'lst-1' });

      expect(result.current.sim.bids.map((b) => b.id)).toEqual(['b-1']);
      expect(result.current.sim.currentLowest).toBe(2000);
    });

    it('seeds when the history arrives after mount', () => {
      const { result, rerender } = mount();
      expect(result.current.sim.bids).toEqual([]);

      setHistory([historyBid('b-1', 2000, 30)]);
      rerender({ id: 'lst-1' });

      expect(result.current.sim.bids.map((b) => b.id)).toEqual(['b-1']);
    });

    it('drops the previous listing rows and re-seeds when the listing changes', () => {
      setHistory([historyBid('old-1', 2000, 30), historyBid('old-2', 2500, 10)]);
      const { result, rerender } = mount('lst-1');
      expect(result.current.sim.bidCount).toBe(2);

      setHistory([historyBid('new-1', 700, 5)]);
      rerender({ id: 'lst-2' });

      expect(result.current.sim.bids.map((b) => b.id)).toEqual(['new-1']);
      expect(result.current.sim.currentLowest).toBe(700);
      expect(result.current.sim.events[0]?.job_id).toBe('lst-2');
    });
  });

  describe('live bids from the spectator socket', () => {
    it('appends a live bid flagged new, then clears the flag after 2s', () => {
      setHistory([historyBid('b-1', 2000, 30)]);
      const { result, rerender } = mount();

      const live = liveBid(2600, 0);
      setSpectator(live, { isConnected: true });
      rerender({ id: 'lst-1' });

      const liveId = `live-${live.timestamp}-2600`;
      expect(result.current.sim.bids.map((b) => [b.id, b.is_new])).toEqual([
        ['b-1', false],
        [liveId, true],
      ]);
      expect(result.current.sim.currentLowest).toBe(2600);
      // The price before this bid is what the widgets animate from.
      expect(result.current.sim.previousLowest).toBe(2000);
      expect(result.current.sim.orderBookBids[0]).toMatchObject({ id: liveId, is_new: true });

      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(result.current.sim.bids[1]?.is_new).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.sim.bids[1]?.is_new).toBe(false);
    });

    it('un-flags the previous live bid as soon as the next one arrives', () => {
      const { result, rerender } = mount();

      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-1' });
      setSpectator(liveBid(1100, 1));
      rerender({ id: 'lst-1' });

      expect(result.current.sim.bids.map((b) => [b.amount_cents, b.is_new])).toEqual([
        [1000, false],
        [1100, true],
      ]);
      // Each accumulated live bid takes the next anonymous slot.
      expect(result.current.sim.bids.map((b) => b.providerIdx)).toEqual([1, 2]);
      expect(result.current.sim.activities.map((a) => a.providerName)).toEqual([
        'Bidder C',
        'Bidder B',
      ]);
    });

    it('ignores a re-delivered live bid (same timestamp and amount, new object)', () => {
      const { result, rerender } = mount();

      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-1' });
      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-1' });

      expect(result.current.sim.bidCount).toBe(1);
    });

    it('ignores a live bid that the REST history already contains', () => {
      setHistory([historyBid('b-1', 2000, 30)]);
      const { result, rerender } = mount();

      setSpectator(liveBid(2000, 30));
      rerender({ id: 'lst-1' });

      expect(result.current.sim.bids.map((b) => b.id)).toEqual(['b-1']);
    });

    it('accepts the same live bid again after switching to another listing', () => {
      const { result, rerender } = mount('lst-1');
      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-1' });
      expect(result.current.sim.bidCount).toBe(1);

      // New listing: rows and the de-duplication memory are both cleared.
      setSpectator(null);
      rerender({ id: 'lst-2' });
      expect(result.current.sim.bidCount).toBe(0);

      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-2' });
      expect(result.current.sim.bidCount).toBe(1);
    });

    it('cancels pending flash timers when the listing changes and on unmount', () => {
      const { rerender, unmount } = mount('lst-1');
      setSpectator(liveBid(1000, 2));
      rerender({ id: 'lst-1' });
      expect(vi.getTimerCount()).toBe(1);

      setSpectator(null);
      rerender({ id: 'lst-2' });
      expect(vi.getTimerCount()).toBe(0);

      setSpectator(liveBid(1200, 1));
      rerender({ id: 'lst-2' });
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('exposes inert playback controls: a live stream cannot be started, paused or reset', () => {
    setHistory([historyBid('b-1', 2000, 30)]);
    setSpectator(null, { isConnected: true });
    const { result } = mount();

    act(() => {
      result.current.sim.start();
      result.current.sim.pause();
      result.current.sim.reset();
      result.current.sim.setShowCelebration(true);
    });

    expect(result.current.sim.bidCount).toBe(1);
    expect(result.current.sim.isRunning).toBe(true);
    expect(result.current.sim.showCelebration).toBe(false);
  });
});
