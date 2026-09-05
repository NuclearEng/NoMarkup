// Shared mock data fixtures for terminal widget tests.
// Not a *.test.ts file — vitest skips it. Imported by sibling tests for
// realistic SimulationData / WidgetProps shapes.

import type { SimulationData, WidgetProps } from '@/components/terminal/types';
import type { MarketRange } from '@/types';

export const mockProviders = [
  { name: 'Alice Plumbing', trust: 92, tier: 'top_rated', initial: 'A' },
  { name: 'Bob Builders', trust: 81, tier: 'trusted', initial: 'B' },
  { name: 'Carol Co.', trust: 65, tier: 'rising', initial: 'C' },
  { name: 'Dan Fix', trust: 30, tier: 'new', initial: 'D' },
] as const;

export function makeSim(overrides: Partial<SimulationData> = {}): SimulationData {
  return {
    bids: [],
    events: [],
    currentLowest: 25000,
    previousLowest: 30000,
    orderBookBids: [
      {
        id: 'ob-1',
        provider_name: 'Alice Plumbing',
        amount_cents: 25000,
        trust_score: 92,
        trust_tier: 'top_rated',
        created_at: '2026-04-01T00:00:00Z',
        is_new: false,
      },
      {
        id: 'ob-2',
        provider_name: 'Bob Builders',
        amount_cents: 27500,
        trust_score: 81,
        trust_tier: 'trusted',
        created_at: '2026-04-01T00:00:00Z',
        is_new: false,
      },
      {
        id: 'ob-3',
        provider_name: 'Carol Co.',
        amount_cents: 29000,
        trust_score: 65,
        trust_tier: 'rising',
        created_at: '2026-04-01T00:00:00Z',
        is_new: false,
      },
    ],
    depthBuckets: [
      { amount_cents: 25000, count: 1 },
      { amount_cents: 27500, count: 1 },
      { amount_cents: 29000, count: 1 },
    ],
    activities: [
      {
        id: 'a-1',
        providerName: 'Alice Plumbing',
        amount: 25000,
        timestamp: '2026-04-01T00:00:00Z',
        isLowest: true,
      },
    ],
    sparklineBids: [30000, 28000, 27000, 26000, 25000],
    velocity: 4,
    velocityBuckets: [1, 2, 3, 2, 4],
    bidCount: 3,
    isRunning: true,
    showCelebration: false,
    setShowCelebration: () => {
      // no-op for tests
    },
    start: () => {
      // no-op for tests
    },
    pause: () => {
      // no-op for tests
    },
    reset: () => {
      // no-op for tests
    },
    ...overrides,
  };
}

export function makeMarketRange(): MarketRange {
  return {
    low_cents: 22000,
    median_cents: 28000,
    high_cents: 35000,
    sample_size: 42,
  };
}

export function makeWidgetProps(overrides: Partial<WidgetProps> = {}): WidgetProps {
  return {
    sim: makeSim(),
    auctionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    startingPriceCents: 50000,
    marketRange: makeMarketRange(),
    mockProviders,
    ...overrides,
  };
}
