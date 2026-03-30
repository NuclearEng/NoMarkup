'use client';

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useAuctionStore,
  getBidVelocity,
  getMomentum,
  getVelocityBuckets,
} from '@/stores/auction-store';
import { auctionWsManager } from '@/lib/auction-websocket';
import { useAuthStore } from '@/stores/auth-store';
import type { AuctionBidEvent } from '@/types';

export function useAuctionStream(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  const {
    setActiveJob,
    clearActiveJob,
    addBidEvent,
    updateAuctionState,
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    auctionEndsAt,
    snipeExtensionCount,
    orderBook,
    priceHistory,
  } = useAuctionStore();

  const velocity = useAuctionStore(getBidVelocity);
  const momentum = useAuctionStore(getMomentum);
  const velocityBuckets = useAuctionStore(getVelocityBuckets);

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

        // Invalidate related queries
        void queryClient.invalidateQueries({ queryKey: ['bidCount', jobId] });
        void queryClient.invalidateQueries({ queryKey: ['bidsForJob', jobId] });
        void queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      }

      if (message.type === 'auction_state' && message.data) {
        updateAuctionState(message.data as unknown as Parameters<typeof updateAuctionState>[0]);
      }
    },
    [jobId, addBidEvent, updateAuctionState, queryClient],
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
