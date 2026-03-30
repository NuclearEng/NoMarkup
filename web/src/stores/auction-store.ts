import { create } from 'zustand';

import type { AuctionBidEvent } from '@/types';
import {
  auctionWsManager,
  type AuctionConnectionStatus,
} from '@/lib/auction-websocket';
import { useAuthStore } from '@/stores/auth-store';

// ── Order book entry ──
interface OrderBookEntry {
  id: string;
  provider_name: string;
  amount_cents: number;
  trust_score: number;
  trust_tier: string;
  created_at: string;
  is_new: boolean;
}

// ── Price history data point ──
interface PriceHistoryPoint {
  timestamp: number;
  amount_cents: number;
  running_min: number;
}

// ── Momentum indicator ──
const MOMENTUM = {
  ACCELERATING: 'accelerating',
  DECELERATING: 'decelerating',
  STABLE: 'stable',
} as const;
type Momentum = (typeof MOMENTUM)[keyof typeof MOMENTUM];

// ── Velocity window configuration ──
const VELOCITY_WINDOW_MS = 60_000; // 1 minute rolling window
const VELOCITY_BUCKET_MS = 10_000; // 10-second buckets for sparkline
const VELOCITY_BUCKET_COUNT = 6; // 6 buckets = 1 minute of history
const FLASH_DURATION_MS = 2_000; // how long a bid stays "new"

interface AuctionState {
  activeJobId: string | null;
  connectionStatus: AuctionConnectionStatus;
  events: AuctionBidEvent[];
  currentLowest: number;
  bidCount: number;
  auctionEndsAt: string | null;
  snipeExtensionCount: number;

  // Order book
  orderBook: OrderBookEntry[];

  // Price history time series
  priceHistory: PriceHistoryPoint[];

  // Bid velocity tracking
  bidTimestamps: number[]; // timestamps of recent bids for velocity calc

  // Flash timers (bid ids that should be cleared)
  flashTimers: Record<string, ReturnType<typeof setTimeout>>;
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
  addOrderBookEntry: (entry: Omit<OrderBookEntry, 'is_new'>) => void;
  clearFlash: (id: string) => void;
}

// ── Selectors (exported as standalone functions) ──

/** Returns order book sorted by price ascending (lowest/best first) */
export function getOrderBook(state: AuctionState): OrderBookEntry[] {
  return state.orderBook;
}

/** Computes bids-per-minute over the rolling window */
export function getBidVelocity(state: AuctionState): number {
  const now = Date.now();
  const cutoff = now - VELOCITY_WINDOW_MS;
  const recentCount = state.bidTimestamps.filter((t) => t >= cutoff).length;
  return recentCount; // bids in the last 60 seconds = bids per minute
}

/** Returns velocity bucketed into sparkline-friendly data */
export function getVelocityBuckets(state: AuctionState): number[] {
  const now = Date.now();
  const buckets: number[] = Array.from({ length: VELOCITY_BUCKET_COUNT }, () => 0);

  for (const ts of state.bidTimestamps) {
    const age = now - ts;
    if (age > VELOCITY_WINDOW_MS) continue;
    const bucketIndex = Math.min(
      VELOCITY_BUCKET_COUNT - 1,
      Math.floor(age / VELOCITY_BUCKET_MS),
    );
    const idx = buckets[VELOCITY_BUCKET_COUNT - 1 - bucketIndex];
    if (idx !== undefined) {
      buckets[VELOCITY_BUCKET_COUNT - 1 - bucketIndex] = idx + 1;
    }
  }
  return buckets;
}

/** Computes momentum: compares recent half of window vs older half */
export function getMomentum(state: AuctionState): Momentum {
  const now = Date.now();
  const halfWindow = VELOCITY_WINDOW_MS / 2;

  let recentHalf = 0;
  let olderHalf = 0;

  for (const ts of state.bidTimestamps) {
    const age = now - ts;
    if (age > VELOCITY_WINDOW_MS) continue;
    if (age <= halfWindow) {
      recentHalf++;
    } else {
      olderHalf++;
    }
  }

  // If the recent half has significantly more bids, accelerating
  if (recentHalf > olderHalf + 1) return MOMENTUM.ACCELERATING;
  if (olderHalf > recentHalf + 1) return MOMENTUM.DECELERATING;
  return MOMENTUM.STABLE;
}

/** Returns price history as time series */
export function getPriceHistory(state: AuctionState): PriceHistoryPoint[] {
  return state.priceHistory;
}

export const useAuctionStore = create<AuctionState & AuctionActions>((set, get) => ({
  activeJobId: null,
  connectionStatus: 'disconnected',
  events: [],
  currentLowest: 0,
  bidCount: 0,
  auctionEndsAt: null,
  snipeExtensionCount: 0,
  orderBook: [],
  priceHistory: [],
  bidTimestamps: [],
  flashTimers: {},

  setActiveJob: (jobId: string, token: string) => {
    const current = get().activeJobId;
    if (current === jobId) return;

    // Clear any existing flash timers
    const { flashTimers } = get();
    for (const timer of Object.values(flashTimers)) {
      clearTimeout(timer);
    }

    set({
      activeJobId: jobId,
      events: [],
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      orderBook: [],
      priceHistory: [],
      bidTimestamps: [],
      flashTimers: {},
    });

    auctionWsManager.connect(jobId, token, () => useAuthStore.getState().accessToken);
  },

  clearActiveJob: () => {
    // Clear flash timers
    const { flashTimers } = get();
    for (const timer of Object.values(flashTimers)) {
      clearTimeout(timer);
    }

    auctionWsManager.disconnect();
    set({
      activeJobId: null,
      connectionStatus: 'disconnected',
      events: [],
      currentLowest: 0,
      bidCount: 0,
      auctionEndsAt: null,
      snipeExtensionCount: 0,
      orderBook: [],
      priceHistory: [],
      bidTimestamps: [],
      flashTimers: {},
    });
  },

  addBidEvent: (event: AuctionBidEvent) => {
    const now = Date.now();
    const eventTimestamp = new Date(event.created_at).getTime();

    set((state) => {
      const events = [...state.events, event];

      const currentLowest =
        event.event_type === 'bid_withdrawn'
          ? state.currentLowest
          : state.currentLowest === 0
            ? event.amount_cents
            : Math.min(state.currentLowest, event.amount_cents);

      // Update price history
      let priceHistory = state.priceHistory;
      if (event.event_type === 'bid_placed' || event.event_type === 'bid_updated') {
        const runningMin =
          priceHistory.length > 0
            ? Math.min(
                (priceHistory[priceHistory.length - 1] as PriceHistoryPoint).running_min,
                event.amount_cents,
              )
            : event.amount_cents;

        priceHistory = [
          ...priceHistory,
          {
            timestamp: eventTimestamp,
            amount_cents: event.amount_cents,
            running_min: runningMin,
          },
        ];
      }

      // Update bid timestamps for velocity tracking (prune old entries)
      const cutoff = now - VELOCITY_WINDOW_MS * 2; // Keep 2x window for momentum calc
      const bidTimestamps = [
        ...state.bidTimestamps.filter((t) => t >= cutoff),
        now,
      ];

      return { events, currentLowest, priceHistory, bidTimestamps };
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

  addOrderBookEntry: (entry) => {
    const id = entry.id;

    set((state) => {
      // Add entry with flash flag
      const newEntry: OrderBookEntry = { ...entry, is_new: true };

      // Remove existing entry with same id (bid update) or add new
      const filtered = state.orderBook.filter((e) => e.id !== id);
      const updated = [...filtered, newEntry].sort(
        (a, b) => a.amount_cents - b.amount_cents,
      );

      return { orderBook: updated };
    });

    // Set timer to clear flash
    const timer = setTimeout(() => {
      get().clearFlash(id);
    }, FLASH_DURATION_MS);

    set((state) => ({
      flashTimers: { ...state.flashTimers, [id]: timer },
    }));
  },

  clearFlash: (id: string) => {
    set((state) => {
      const orderBook = state.orderBook.map((entry) =>
        entry.id === id ? { ...entry, is_new: false } : entry,
      );
      const { [id]: _removed, ...remainingTimers } = state.flashTimers;
      return { orderBook, flashTimers: remainingTimers };
    });
  },
}));

// Wire up WebSocket status changes to store
auctionWsManager.onStatusChange((status) => {
  useAuctionStore.setState({ connectionStatus: status });
});
