import { create } from 'zustand';

import type { AuctionBidEvent } from '@/types';
import {
  auctionWsManager,
  type AuctionConnectionStatus,
} from '@/lib/auction-websocket';
import { useAuthStore } from '@/stores/auth-store';

interface AuctionState {
  activeJobId: string | null;
  connectionStatus: AuctionConnectionStatus;
  events: AuctionBidEvent[];
  currentLowest: number;
  bidCount: number;
  auctionEndsAt: string | null;
  snipeExtensionCount: number;
}

interface AuctionActions {
  setActiveJob: (jobId: string, token: string) => void;
  clearActiveJob: () => void;
  addBidEvent: (event: AuctionBidEvent) => void;
  updateAuctionState: (state: {
    lowest_bid_cents: number;
    bid_count: number;
    auction_ends_at: string | null;
    snipe_extension_count: number;
  }) => void;
}

export const useAuctionStore = create<AuctionState & AuctionActions>((set, get) => ({
  activeJobId: null,
  connectionStatus: 'disconnected',
  events: [],
  currentLowest: 0,
  bidCount: 0,
  auctionEndsAt: null,
  snipeExtensionCount: 0,

  setActiveJob: (jobId: string, token: string) => {
    const current = get().activeJobId;
    if (current === jobId) return;

    set({
      activeJobId: jobId,
      events: [],
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
    });

    auctionWsManager.connect(jobId, token, () => useAuthStore.getState().accessToken);
  },

  clearActiveJob: () => {
    auctionWsManager.disconnect();
    set({
      activeJobId: null,
      connectionStatus: 'disconnected',
      events: [],
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
    });
  },

  addBidEvent: (event: AuctionBidEvent) => {
    set((state) => {
      const events = [...state.events, event];
      const currentLowest =
        event.event_type === 'bid_withdrawn'
          ? state.currentLowest
          : state.currentLowest === 0
            ? event.amount_cents
            : Math.min(state.currentLowest, event.amount_cents);
      return { events, currentLowest };
    });
  },

  updateAuctionState: (auctionState) => {
    set({
      currentLowest: auctionState.lowest_bid_cents,
      bidCount: auctionState.bid_count,
      auctionEndsAt: auctionState.auction_ends_at,
      snipeExtensionCount: auctionState.snipe_extension_count,
    });
  },
}));

// Wire up WebSocket status changes to store
auctionWsManager.onStatusChange((status) => {
  useAuctionStore.setState({ connectionStatus: status });
});
