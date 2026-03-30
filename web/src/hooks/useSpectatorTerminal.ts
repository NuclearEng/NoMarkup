'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useSpectatorStream } from '@/hooks/useSpectatorStream';
import type { SimulationData } from '@/components/terminal/types';

/**
 * Internal bid representation that tracks provider info and "new" flash state
 * for driving the terminal grid widgets from real spectator WebSocket data.
 */
interface SpectatorBid {
  id: string;
  providerIdx: number;
  amount_cents: number;
  created_at: string;
  is_new: boolean;
}

/** Placeholder provider names assigned round-robin to incoming bids. */
const ANONYMOUS_PROVIDERS = [
  { name: 'Provider A', trust: 85, tier: 'trusted', initial: 'PA' },
  { name: 'Provider B', trust: 90, tier: 'top_rated', initial: 'PB' },
  { name: 'Provider C', trust: 78, tier: 'rising', initial: 'PC' },
  { name: 'Provider D', trust: 92, tier: 'top_rated', initial: 'PD' },
  { name: 'Provider E', trust: 82, tier: 'trusted', initial: 'PE' },
  { name: 'Provider F', trust: 88, tier: 'trusted', initial: 'PF' },
  { name: 'Provider G', trust: 74, tier: 'rising', initial: 'PG' },
  { name: 'Provider H', trust: 95, tier: 'top_rated', initial: 'PH' },
] as const;

interface SpectatorTerminalResult {
  /** Data shaped to satisfy the `SimulationData` interface consumed by TerminalGrid. */
  sim: SimulationData;
  /** Anonymous provider roster used for display. */
  providers: typeof ANONYMOUS_PROVIDERS;
  /** Number of people currently watching. */
  spectatorCount: number;
  /** Whether the WebSocket is connected. */
  isConnected: boolean;
  /** Connection error message, if any. */
  error: string | null;
}

/**
 * Adapts the live spectator WebSocket stream into the `SimulationData` shape
 * that `TerminalGrid` expects, performing the same derived-data computations
 * as the demo page's `useAuctionSimulation` hook.
 */
export function useSpectatorTerminal(jobId: string | undefined): SpectatorTerminalResult {
  const stream = useSpectatorStream(jobId);

  // Local bid array with `is_new` flash tracking
  const [bids, setBids] = useState<SpectatorBid[]>([]);
  const bidCounterRef = useRef(0);
  const previousLowest = useRef<number | undefined>(undefined);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Map from event timestamp+amount to a stable providerIdx
  const providerMapRef = useRef(new Map<string, number>());
  const nextProviderIdx = useRef(0);

  // Sync incoming events into our local bids array
  useEffect(() => {
    if (stream.events.length === 0) {
      // Stream reset (e.g. new jobId) — clear local state
      setBids([]);
      bidCounterRef.current = 0;
      providerMapRef.current = new Map();
      nextProviderIdx.current = 0;
      previousLowest.current = undefined;
      flashTimers.current.forEach(clearTimeout);
      flashTimers.current = [];
      return;
    }

    // Only process events we haven't seen yet
    const existingCount = bidCounterRef.current;
    const newEvents = stream.events.slice(existingCount);
    if (newEvents.length === 0) return;

    bidCounterRef.current = stream.events.length;

    const newBids: SpectatorBid[] = newEvents.map((event, i) => {
      const bidId = `spectator-bid-${String(existingCount + i)}`;

      // Assign a stable provider index per unique event key
      const eventKey = `${event.created_at}-${String(event.amount_cents)}`;
      let provIdx = providerMapRef.current.get(eventKey);
      if (provIdx === undefined) {
        provIdx = nextProviderIdx.current % ANONYMOUS_PROVIDERS.length;
        nextProviderIdx.current++;
        providerMapRef.current.set(eventKey, provIdx);
      }

      return {
        id: bidId,
        providerIdx: provIdx,
        amount_cents: event.amount_cents,
        created_at: event.created_at,
        is_new: true,
      };
    });

    setBids((prev) => [
      ...prev.map((b) => ({ ...b, is_new: false })),
      ...newBids,
    ]);

    // Clear the "new" flash after 2 seconds
    for (const bid of newBids) {
      const timer = setTimeout(() => {
        setBids((prev) =>
          prev.map((b) => (b.id === bid.id ? { ...b, is_new: false } : b)),
        );
      }, 2000);
      flashTimers.current.push(timer);
    }

    return () => {
      // Cleanup only on unmount; individual timers self-clear
    };
  }, [stream.events]);

  // Clean up flash timers on unmount
  useEffect(() => {
    return () => {
      flashTimers.current.forEach(clearTimeout);
    };
  }, []);

  const currentLowest = useMemo(() => {
    if (bids.length === 0) return 0;
    return Math.min(...bids.map((b) => b.amount_cents));
  }, [bids]);

  useEffect(() => {
    if (currentLowest > 0 && currentLowest !== previousLowest.current) {
      previousLowest.current = currentLowest;
    }
  }, [currentLowest]);

  const orderBookBids = useMemo(
    () =>
      bids
        .map((b) => {
          const p = ANONYMOUS_PROVIDERS[b.providerIdx];
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
        .sort((a, b) => a.amount_cents - b.amount_cents),
    [bids],
  );

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
        const p = ANONYMOUS_PROVIDERS[b.providerIdx];
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
    [bids, currentLowest],
  );

  const sparklineBids = useMemo(() => bids.map((b) => b.amount_cents), [bids]);

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

  // No-op functions for the simulation control interface since this is a live stream
  const noop = () => {
    /* live stream — no simulation controls */
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
      bidCount: bids.length,
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
      stream.isConnected,
    ],
  );

  return {
    sim,
    providers: ANONYMOUS_PROVIDERS,
    spectatorCount: stream.spectatorCount,
    isConnected: stream.isConnected,
    error: stream.error,
  };
}
