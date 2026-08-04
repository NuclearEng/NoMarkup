'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { SimulationData } from '@/components/terminal/types';
import { useListing, useListingBids } from '@/hooks/useListings';
import { useMarketplaceSpectator } from '@/hooks/useMarketplaceSpectator';
import type { AuctionBidEvent, ListingBid } from '@/types';

/**
 * Internal bid row for goods terminal widgets.
 * `currentLowest` on SimulationData is aliased to the **current high** (ascending).
 */
interface GoodsBid {
  id: string;
  providerIdx: number;
  amount_cents: number;
  created_at: string;
  is_new: boolean;
  display_name: string;
}

const ANONYMOUS_PROVIDERS = [
  { name: 'Bidder A', trust: 85, tier: 'trusted', initial: 'BA' },
  { name: 'Bidder B', trust: 90, tier: 'top_rated', initial: 'BB' },
  { name: 'Bidder C', trust: 78, tier: 'rising', initial: 'BC' },
  { name: 'Bidder D', trust: 92, tier: 'top_rated', initial: 'BD' },
  { name: 'Bidder E', trust: 82, tier: 'trusted', initial: 'BE' },
  { name: 'Bidder F', trust: 88, tier: 'trusted', initial: 'BF' },
  { name: 'Bidder G', trust: 74, tier: 'rising', initial: 'BG' },
  { name: 'Bidder H', trust: 95, tier: 'top_rated', initial: 'BH' },
] as const;

function listingBidToGoods(b: ListingBid, idx: number): GoodsBid {
  return {
    id: b.id,
    providerIdx: idx % ANONYMOUS_PROVIDERS.length,
    amount_cents: b.amount_cents,
    created_at: b.created_at,
    is_new: false,
    display_name: b.bidder_display_name || ANONYMOUS_PROVIDERS[idx % ANONYMOUS_PROVIDERS.length]?.name || 'Bidder',
  };
}

export interface MarketplaceSpectatorTerminalResult {
  sim: SimulationData;
  providers: typeof ANONYMOUS_PROVIDERS;
  spectatorCount: number;
  isConnected: boolean;
  auctionEndsAt: string | null;
  startingPriceCents: number;
  snipeExtensionCount: number;
  jobTitle: string;
  jobDescription: string;
  jobCategory: string;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Adapts goods listing REST bid history + marketplace spectator WS into
 * `SimulationData` for TerminalGrid. No new APIs.
 *
 * Note: `sim.currentLowest` holds the **leading (high) bid** so existing
 * reverse-auction widgets show the live market price without field renames.
 */
export function useMarketplaceSpectatorTerminal(
  listingId: string | undefined,
): MarketplaceSpectatorTerminalResult {
  const { data: listing, isLoading, isError } = useListing(listingId ?? '');
  const { data: bidHistory } = useListingBids(listingId ?? '');
  const { isConnected, lastBid, watcherCount } = useMarketplaceSpectator(listingId);

  const [bids, setBids] = useState<GoodsBid[]>([]);
  const previousHigh = useRef<number | undefined>(undefined);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seenLiveKeys = useRef(new Set<string>());
  const seededRef = useRef(false);

  // Seed from REST bid history once per listing.
  useEffect(() => {
    seededRef.current = false;
    setBids([]);
    seenLiveKeys.current = new Set();
    previousHigh.current = undefined;
    flashTimers.current.forEach(clearTimeout);
    flashTimers.current = [];
  }, [listingId]);

  useEffect(() => {
    if (!bidHistory?.bids || seededRef.current) return;
    const chrono = [...bidHistory.bids].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    setBids(chrono.map((b, i) => listingBidToGoods(b, i)));
    seededRef.current = true;
    for (const b of chrono) {
      seenLiveKeys.current.add(`${b.created_at}-${String(b.amount_cents)}`);
    }
  }, [bidHistory]);

  // Accumulate live bid_events (WS only keeps lastBid on the hook).
  useEffect(() => {
    if (!lastBid) return;
    const key = `${lastBid.timestamp}-${String(lastBid.amount_cents)}`;
    if (seenLiveKeys.current.has(key)) return;
    seenLiveKeys.current.add(key);

    const id = `live-${key}`;
    const providerIdx = seenLiveKeys.current.size % ANONYMOUS_PROVIDERS.length;
    const row: GoodsBid = {
      id,
      providerIdx,
      amount_cents: lastBid.amount_cents,
      created_at: lastBid.timestamp,
      is_new: true,
      display_name: ANONYMOUS_PROVIDERS[providerIdx]?.name ?? 'Bidder',
    };

    setBids((prev) => [...prev.map((b) => ({ ...b, is_new: false })), row]);

    const timer = setTimeout(() => {
      setBids((prev) => prev.map((b) => (b.id === id ? { ...b, is_new: false } : b)));
    }, 2000);
    flashTimers.current.push(timer);
  }, [lastBid]);

  useEffect(() => {
    return () => {
      flashTimers.current.forEach(clearTimeout);
    };
  }, []);

  // Ascending auction: "currentLowest" field = current HIGH (widget alias).
  const currentHigh = useMemo(() => {
    if (bids.length === 0) return listing?.current_bid_cents ?? 0;
    return Math.max(...bids.map((b) => b.amount_cents));
  }, [bids, listing?.current_bid_cents]);

  useEffect(() => {
    if (currentHigh > 0) {
      previousHigh.current = currentHigh;
    }
  }, [currentHigh]);

  const orderBookBids = useMemo(
    () =>
      [...bids]
        .map((b) => {
          const p = ANONYMOUS_PROVIDERS[b.providerIdx];
          return {
            id: b.id,
            provider_name: b.display_name || p?.name || '',
            amount_cents: b.amount_cents,
            trust_score: p?.trust ?? 0,
            trust_tier: p?.tier ?? 'new',
            created_at: b.created_at,
            is_new: b.is_new,
          };
        })
        // Goods: high bids first
        .sort((a, b) => b.amount_cents - a.amount_cents),
    [bids],
  );

  const depthBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of orderBookBids) {
      m.set(b.amount_cents, (m.get(b.amount_cents) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([amount_cents, count]) => ({ amount_cents, count }))
      .sort((a, b) => b.amount_cents - a.amount_cents);
  }, [orderBookBids]);

  const activities = useMemo(
    () =>
      [...bids].reverse().map((b) => ({
        id: b.id,
        providerName: b.display_name,
        amount: b.amount_cents,
        timestamp: new Date(b.created_at).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        }),
        // isLowest reused as "is leading" for goods
        isLowest: b.amount_cents === currentHigh,
      })),
    [bids, currentHigh],
  );

  const sparklineBids = useMemo(() => {
    const start = listing?.starting_price_cents ?? 0;
    const series = bids.map((b) => b.amount_cents);
    return start > 0 ? [start, ...series] : series;
  }, [bids, listing?.starting_price_cents]);

  const velocity = useMemo(() => {
    const cutoff = Date.now() - 15_000;
    return bids.filter((b) => new Date(b.created_at).getTime() >= cutoff).length;
  }, [bids]);

  const velocityBuckets = useMemo(() => {
    const now = Date.now();
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const b of bids) {
      const age = now - new Date(b.created_at).getTime();
      if (age > 60_000) continue;
      const bi = 5 - Math.min(5, Math.floor(age / 10_000));
      if (buckets[bi] !== undefined) buckets[bi]++;
    }
    return buckets;
  }, [bids]);

  const events: AuctionBidEvent[] = useMemo(
    () =>
      bids.map((b) => ({
        job_id: listingId ?? '',
        amount_cents: b.amount_cents,
        event_type: 'bid_placed' as const,
        created_at: b.created_at,
      })),
    [bids, listingId],
  );

  const noop = () => {
    /* live goods stream */
  };

  const sim: SimulationData = useMemo(
    () => ({
      bids: bids.map((b) => ({
        id: b.id,
        providerIdx: b.providerIdx,
        amount_cents: b.amount_cents,
        created_at: b.created_at,
        is_new: b.is_new,
      })),
      events,
      currentLowest: currentHigh,
      previousLowest: previousHigh.current,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      bidCount: bids.length,
      isRunning: isConnected,
      showCelebration: false,
      setShowCelebration: noop,
      start: noop,
      pause: noop,
      reset: noop,
    }),
    [
      bids,
      events,
      currentHigh,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      isConnected,
    ],
  );

  const liveEnds = lastBid?.new_auction_ends_at ?? listing?.auction_ends_at ?? null;

  return {
    sim,
    providers: ANONYMOUS_PROVIDERS,
    spectatorCount: watcherCount,
    isConnected,
    auctionEndsAt: liveEnds,
    startingPriceCents: listing?.starting_price_cents ?? 0,
    snipeExtensionCount:
      lastBid?.snipe_extension_count ?? listing?.snipe_extension_count ?? 0,
    jobTitle: listing?.title ?? '',
    jobDescription: listing?.description ?? '',
    jobCategory: listing?.category_name ?? listing?.condition ?? '',
    isLoading,
    isError,
  };
}
