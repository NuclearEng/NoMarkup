'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  marketplaceSpectatorClient,
  type MarketplaceBidEventData,
  type MarketplaceConnectionStatus,
} from '@/lib/marketplace-spectator-websocket';

export interface MarketplaceSpectatorState {
  /** True when the WebSocket is currently open. */
  isConnected: boolean;
  /** Last status reported by the underlying client. */
  connectionStatus: MarketplaceConnectionStatus;
  /** Most recent live bid_event (already 3-second-delayed by the server). */
  lastBid: MarketplaceBidEventData | null;
  /** Most recent spectator_count broadcast (every 10s while connected). */
  watcherCount: number;
}

/**
 * Subscribe to the marketplace spectator WebSocket for a listing.
 *
 * - Auto-disconnects on unmount or when listingId changes.
 * - Pauses the connection while the tab is hidden (visibilitychange).
 *   When the tab becomes visible again, the connection is re-established.
 */
export function useMarketplaceSpectator(
  listingId: string | undefined,
): MarketplaceSpectatorState {
  const [connectionStatus, setConnectionStatus] =
    useState<MarketplaceConnectionStatus>('disconnected');
  const [lastBid, setLastBid] = useState<MarketplaceBidEventData | null>(null);
  const [watcherCount, setWatcherCount] = useState<number>(0);

  const handleBid = useCallback((event: MarketplaceBidEventData) => {
    setLastBid(event);
  }, []);

  const handleSpectatorCount = useCallback((count: number) => {
    setWatcherCount(count);
  }, []);

  const handleConnection = useCallback((status: MarketplaceConnectionStatus) => {
    setConnectionStatus(status);
  }, []);

  useEffect(() => {
    if (!listingId) return;

    // Reset per-listing state.
    setLastBid(null);
    setWatcherCount(0);

    const offBid = marketplaceSpectatorClient.on('bid', handleBid);
    const offCount = marketplaceSpectatorClient.on('spectator_count', handleSpectatorCount);
    const offConn = marketplaceSpectatorClient.on('connection', handleConnection);

    const isHidden =
      typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!isHidden) {
      marketplaceSpectatorClient.connect(listingId);
    }

    function onVisibilityChange() {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        marketplaceSpectatorClient.disconnect();
      } else if (listingId) {
        marketplaceSpectatorClient.connect(listingId);
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      offBid();
      offCount();
      offConn();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      marketplaceSpectatorClient.disconnect();
    };
  }, [listingId, handleBid, handleSpectatorCount, handleConnection]);

  return {
    isConnected: connectionStatus === 'connected',
    connectionStatus,
    lastBid,
    watcherCount,
  };
}
