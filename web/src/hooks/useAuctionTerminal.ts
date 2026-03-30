'use client';

import { useEffect, useMemo, useRef } from 'react';

import { useAuctionStream } from '@/hooks/useAuctionStream';
import { useBidsForJob } from '@/hooks/useBids';
import type { SimulationData } from '@/components/terminal/types';
import type { AuctionBidEvent } from '@/types';

/** Provider display info extracted from real bid data. */
interface AuctionProvider {
  name: string;
  trust: number;
  tier: string;
  initial: string;
}

/** Fallback anonymous providers when real bid data is not yet available. */
const ANONYMOUS_PROVIDERS: readonly AuctionProvider[] = [
  { name: 'Provider A', trust: 85, tier: 'trusted', initial: 'PA' },
  { name: 'Provider B', trust: 90, tier: 'top_rated', initial: 'PB' },
  { name: 'Provider C', trust: 78, tier: 'rising', initial: 'PC' },
  { name: 'Provider D', trust: 92, tier: 'top_rated', initial: 'PD' },
  { name: 'Provider E', trust: 82, tier: 'trusted', initial: 'PE' },
  { name: 'Provider F', trust: 88, tier: 'trusted', initial: 'PF' },
  { name: 'Provider G', trust: 74, tier: 'rising', initial: 'PG' },
  { name: 'Provider H', trust: 95, tier: 'top_rated', initial: 'PH' },
] as const;

interface AuctionTerminalResult {
  /** Data shaped to satisfy the `SimulationData` interface consumed by TerminalGrid. */
  sim: SimulationData;
  /** Provider roster — real names when available, anonymous fallback otherwise. */
  providers: readonly AuctionProvider[];
  /** Whether the WebSocket is connected. */
  isConnected: boolean;
  /** Connection error string, if any. */
  error: string | null;
  /** Number of snipe extensions triggered. */
  snipeExtensionCount: number;
}

/**
 * Adapts the authenticated auction WebSocket stream into the `SimulationData`
 * shape that `TerminalGrid` expects. This is the authenticated counterpart of
 * `useSpectatorTerminal` — it uses `useAuctionStream` (which requires an auth
 * token) and enriches the order book with real provider names from `useBidsForJob`.
 */
export function useAuctionTerminal(jobId: string | undefined): AuctionTerminalResult {
  const stream = useAuctionStream(jobId);
  const { data: bidsData } = useBidsForJob(jobId ?? '');

  const previousLowest = useRef<number | undefined>(undefined);

  // Build providers list from real bid data when available
  const providers: readonly AuctionProvider[] = useMemo(() => {
    if (!bidsData?.bids || bidsData.bids.length === 0) return ANONYMOUS_PROVIDERS;

    const seen = new Set<string>();
    const result: AuctionProvider[] = [];
    for (const b of bidsData.bids) {
      const providerId = b.bid.provider_id;
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      const name = b.provider_business_name || b.provider_display_name;
      const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');
      result.push({
        name,
        trust: b.trust_score?.overall_score ?? 0,
        tier: b.trust_score?.tier ?? 'new',
        initial: initials || 'P?',
      });
    }
    // Pad with anonymous providers if we have fewer than 8
    while (result.length < ANONYMOUS_PROVIDERS.length) {
      const fallback = ANONYMOUS_PROVIDERS[result.length];
      if (fallback) result.push({ ...fallback });
    }
    return result;
  }, [bidsData]);

  // Build bids array from stream events for the SimulationData interface
  const bids = useMemo(() => {
    const priceEvents = stream.events.filter(
      (e: AuctionBidEvent) => e.event_type === 'bid_placed' || e.event_type === 'bid_updated',
    );
    return priceEvents.map((event, idx) => ({
      id: `auction-bid-${String(idx)}`,
      providerIdx: idx % providers.length,
      amount_cents: event.amount_cents,
      created_at: event.created_at,
      // Mark the last 3 bids as "new" for flash animation
      is_new: idx >= priceEvents.length - 3,
    }));
  }, [stream.events, providers.length]);

  const currentLowest = useMemo(() => {
    if (bids.length === 0) return stream.currentLowest;
    return Math.min(...bids.map((b) => b.amount_cents));
  }, [bids, stream.currentLowest]);

  useEffect(() => {
    if (currentLowest > 0 && currentLowest !== previousLowest.current) {
      previousLowest.current = currentLowest;
    }
  }, [currentLowest]);

  // Build order book from real bids data (with provider names/trust scores)
  const orderBookBids = useMemo(() => {
    if (bidsData?.bids && bidsData.bids.length > 0) {
      // Use real bid data with provider info
      const wsFlashIds = new Set(
        stream.orderBook.filter((e) => e.is_new).map((e) => e.id),
      );

      return bidsData.bids
        .filter((b) => b.bid.status === 'active')
        .map((b) => ({
          id: b.bid.id,
          provider_name: b.provider_business_name || b.provider_display_name,
          amount_cents: b.bid.amount_cents,
          trust_score: b.trust_score?.overall_score ?? 0,
          trust_tier: b.trust_score?.tier ?? 'new',
          created_at: b.bid.created_at,
          is_new: wsFlashIds.has(b.bid.id),
        }))
        .sort((a, b) => a.amount_cents - b.amount_cents);
    }

    // Fallback: build from stream events with anonymous providers
    return bids
      .map((b) => {
        const p = providers[b.providerIdx];
        return {
          id: b.id,
          provider_name: p?.name ?? '',
          amount_cents: b.amount_cents,
          trust_score: p?.trust ?? 0,
          trust_tier: p?.tier ?? 'new',
          created_at: b.created_at,
          is_new: b.is_new,
        };
      })
      .sort((a, b) => a.amount_cents - b.amount_cents);
  }, [bidsData, stream.orderBook, bids, providers]);

  const depthBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of orderBookBids) {
      m.set(b.amount_cents, (m.get(b.amount_cents) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([amount_cents, count]) => ({ amount_cents, count }))
      .sort((a, b) => a.amount_cents - b.amount_cents);
  }, [orderBookBids]);

  const activities = useMemo(
    () =>
      [...bids].reverse().map((b) => {
        const p = providers[b.providerIdx];
        return {
          id: b.id,
          providerName: p?.name ?? '',
          amount: b.amount_cents,
          timestamp: new Date(b.created_at).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          }),
          isLowest: b.amount_cents === currentLowest,
        };
      }),
    [bids, currentLowest, providers],
  );

  const sparklineBids = useMemo(() => bids.map((b) => b.amount_cents), [bids]);

  const velocity = stream.velocity;
  const velocityBuckets = stream.velocityBuckets;

  // No-op functions for the simulation control interface since this is a live stream
  const noop = () => {
    /* live auction — no simulation controls */
  };

  const sim: SimulationData = useMemo(
    () => ({
      bids,
      events: stream.events,
      currentLowest,
      previousLowest: previousLowest.current,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      bidCount: stream.bidCount || bids.length,
      isRunning: stream.isConnected,
      showCelebration: false,
      setShowCelebration: noop,
      start: noop,
      pause: noop,
      reset: noop,
    }),
    [
      bids,
      stream.events,
      currentLowest,
      orderBookBids,
      depthBuckets,
      activities,
      sparklineBids,
      velocity,
      velocityBuckets,
      stream.bidCount,
      stream.isConnected,
    ],
  );

  return {
    sim,
    providers,
    isConnected: stream.isConnected,
    error: stream.isConnected ? null : stream.connectionStatus === 'disconnected' ? 'WebSocket disconnected' : null,
    snipeExtensionCount: stream.snipeExtensionCount,
  };
}
