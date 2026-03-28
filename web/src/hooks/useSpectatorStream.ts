'use client';

import { useEffect, useCallback, useState } from 'react';

import {
  spectatorWsManager,
  type SpectatorConnectionStatus,
  type SpectatorMessage,
} from '@/lib/spectator-websocket';
import type { AuctionBidEvent } from '@/types';

interface SpectatorStreamState {
  events: AuctionBidEvent[];
  connectionStatus: SpectatorConnectionStatus;
  currentLowest: number;
  bidCount: number;
  spectatorCount: number;
  isConnected: boolean;
  error: string | null;
}

export function useSpectatorStream(jobId: string | undefined): SpectatorStreamState {
  const [events, setEvents] = useState<AuctionBidEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<SpectatorConnectionStatus>('disconnected');
  const [currentLowest, setCurrentLowest] = useState(0);
  const [bidCount, setBidCount] = useState(0);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleMessage = useCallback((message: SpectatorMessage) => {
    if (message.type === 'bid_event' && message.data) {
      const event: AuctionBidEvent = {
        job_id: message.job_id,
        amount_cents: message.data.amount_cents,
        event_type: message.data.type as AuctionBidEvent['event_type'],
        created_at: message.data.timestamp,
      };

      setEvents((prev) => [...prev, event]);
      setBidCount((prev) => prev + 1);

      if (event.event_type !== 'bid_withdrawn') {
        setCurrentLowest((prev) =>
          prev === 0 ? event.amount_cents : Math.min(prev, event.amount_cents),
        );
      }
    }

    if (message.type === 'spectator_count' && message.spectator_count !== undefined) {
      setSpectatorCount(message.spectator_count);
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    // Reset state for new job.
    setEvents([]);
    setCurrentLowest(0);
    setBidCount(0);
    setSpectatorCount(0);

    spectatorWsManager.connect(jobId);

    setError(null);

    const unsubMessage = spectatorWsManager.onMessage(handleMessage);
    const unsubStatus = spectatorWsManager.onStatusChange((status) => {
      setConnectionStatus(status);
      if (status === 'error') {
        setError('WebSocket connection error');
      } else if (status === 'disconnected') {
        setError('WebSocket disconnected');
      } else if (status === 'connected') {
        setError(null);
      }
    });

    return () => {
      unsubMessage();
      unsubStatus();
      spectatorWsManager.disconnect();
    };
  }, [jobId, handleMessage]);

  return {
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    spectatorCount,
    isConnected: connectionStatus === 'connected',
    error,
  };
}
