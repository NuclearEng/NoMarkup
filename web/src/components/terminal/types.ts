import type { AuctionBidEvent, MarketRange } from '@/types';

// ── Shared simulation data passed to all widgets ──

interface OrderBookBid {
  id: string;
  provider_name: string;
  amount_cents: number;
  trust_score: number;
  trust_tier: string;
  created_at: string;
  is_new: boolean;
}

interface DepthBucket {
  amount_cents: number;
  count: number;
}

interface BidActivity {
  id: string;
  providerName: string;
  amount: number;
  timestamp: string;
  isLowest: boolean;
}

interface MockProvider {
  name: string;
  trust: number;
  tier: string;
  initial: string;
}

export interface SimulationData {
  bids: Array<{
    id: string;
    providerIdx: number;
    amount_cents: number;
    created_at: string;
    is_new: boolean;
  }>;
  events: AuctionBidEvent[];
  currentLowest: number;
  previousLowest: number | undefined;
  orderBookBids: OrderBookBid[];
  depthBuckets: DepthBucket[];
  activities: BidActivity[];
  sparklineBids: number[];
  velocity: number;
  velocityBuckets: number[];
  bidCount: number;
  isRunning: boolean;
  showCelebration: boolean;
  setShowCelebration: (v: boolean) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
}

export interface WidgetProps {
  sim: SimulationData;
  auctionEndsAt: string;
  startingPriceCents: number;
  marketRange: MarketRange;
  mockProviders: readonly MockProvider[];
  /** Real job id for a11y / deep links — never "demo" on live surfaces. */
  jobId?: string;
  /** Snipe extensions triggered this auction (stream or REST). */
  snipeExtensionCount?: number;
  /** Job body for the details widget (empty → honest empty state). */
  jobDescription?: string;
  /** Display title when description is short. */
  jobTitle?: string;
  /** Category label for badges. */
  jobCategory?: string;
}
