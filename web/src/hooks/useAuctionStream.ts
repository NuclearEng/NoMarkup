'use client';

import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';

import { useAuctionStore } from '@/stores/auction-store';
import { auctionWsManager } from '@/lib/auction-websocket';
import { useAuthStore } from '@/stores/auth-store';
import type { AuctionBidEvent } from '@/types';

export function useAuctionStream(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  // Use shallow selectors to avoid re-rendering on unrelated store changes
  const { setActiveJob, clearActiveJob, addBidEvent, updateAuctionState } = useAuctionStore(
    useShallow((s) => ({
      setActiveJob: s.setActiveJob,
      clearActiveJob: s.clearActiveJob,
      addBidEvent: s.addBidEvent,
      updateAuctionState: s.updateAuctionState,
    })),
  );
  const events = useAuctionStore((s) => s.events);
  const connectionStatus = useAuctionStore((s) => s.connectionStatus);
  const currentLowest = useAuctionStore((s) => s.currentLowest);
  const bidCount = useAuctionStore((s) => s.bidCount);
  const auctionEndsAt = useAuctionStore((s) => s.auctionEndsAt);
  const snipeExtensionCount = useAuctionStore((s) => s.snipeExtensionCount);
  const orderBook = useAuctionStore((s) => s.orderBook);
  const priceHistory = useAuctionStore((s) => s.priceHistory);

  // Derive velocity/momentum/buckets from bidTimestamps with stable references
  const bidTimestamps = useAuctionStore((s) => s.bidTimestamps);

  const velocity = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return bidTimestamps.filter((t) => t >= cutoff).length;
  }, [bidTimestamps]);

  const momentum = useMemo(() => {
    const now = Date.now();
    const halfWindow = 30_000;
    let recent = 0;
    let older = 0;
    for (const ts of bidTimestamps) {
      const age = now - ts;
      if (age > 60_000) continue;
      if (age <= halfWindow) recent++;
      else older++;
    }
    if (recent > older + 1) return 'accelerating' as const;
    if (older > recent + 1) return 'decelerating' as const;
    return 'stable' as const;
  }, [bidTimestamps]);

  const velocityBuckets = useAuctionStore(
    useShallow((s) => {
      const now = Date.now();
      const buckets = [0, 0, 0, 0, 0, 0];
      for (const ts of s.bidTimestamps) {
        const age = now - ts;
        if (age > 60_000) continue;
        const idx = Math.min(5, Math.floor(age / 10_000));
        const bi = 5 - idx;
        if (buckets[bi] !== undefined) buckets[bi]++;
      }
      return buckets;
    }),
  );

  // Throttle query invalidation to avoid hammering TanStack Query on rapid bid events
  const lastInvalidateRef = useRef(0);
  const pendingInvalidateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bidCount', jobId] });
    void queryClient.invalidateQueries({ queryKey: ['bidsForJob', jobId] });
    void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    lastInvalidateRef.current = Date.now();
  }, [jobId, queryClient]);

  const throttledInvalidate = useCallback(() => {
    const elapsed = Date.now() - lastInvalidateRef.current;
    if (elapsed >= 2000) {
      invalidateQueries();
    } else if (!pendingInvalidateRef.current) {
      pendingInvalidateRef.current = setTimeout(() => {
        pendingInvalidateRef.current = null;
        invalidateQueries();
      }, 2000 - elapsed);
    }
  }, [invalidateQueries]);

  const handleMessage = useCallback(
    (message: {
      type: string;
      data?: { type: string; job_id: string; amount_cents: number; timestamp: string };
    }) => {
      if (message.type === 'bid_event' && message.data) {
        const event: AuctionBidEvent = {
          job_id: message.data.job_id,
          amount_cents: message.data.amount_cents,
          event_type: message.data.type as AuctionBidEvent['event_type'],
          created_at: message.data.timestamp,
        };
        addBidEvent(event);
        throttledInvalidate();
      }

      if (message.type === 'auction_state' && message.data) {
        updateAuctionState(message.data as unknown as Parameters<typeof updateAuctionState>[0]);
      }
    },
    [addBidEvent, updateAuctionState, throttledInvalidate],
  );

  useEffect(() => {
    if (!jobId || !accessToken) return;

    setActiveJob(jobId, accessToken);

    const unsubMessage = auctionWsManager.onMessage(handleMessage);

    return () => {
      unsubMessage();
      clearActiveJob();
    };
  }, [jobId, accessToken, setActiveJob, clearActiveJob, handleMessage]);

  return {
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    auctionEndsAt,
    snipeExtensionCount,
    isConnected: connectionStatus === 'connected',
    orderBook,
    priceHistory,
    velocity,
    momentum,
    velocityBuckets,
  };
}
