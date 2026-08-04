import type { Metadata } from 'next';

import {
  pricingCategoriesToTickerItems,
  type TickerItem,
} from '@/components/landing/ticker-items';
import type { PricingOverviewCategory } from '@/hooks/usePricing';

import { LandingPageClient } from './LandingPageClient';
import { serverFetch } from '@/lib/server-fetch';

// Server-side API origin. Mirror marketplace / jobs detail: prefer the
// server-only API_URL, fall back to the public var, then localhost for dev.
// Pricing overview is a public read (no auth/cookies).
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

export const metadata: Metadata = {
  title: 'NoMarkup — The Market Sets The Price',
  description:
    'Reverse-auction service marketplace. Customers post jobs, providers compete on price. Fair market rates — not the markup. Plus local goods with escrow.',
  openGraph: {
    title: 'NoMarkup — The Market Sets The Price. Not The Markup.',
    description:
      'Customers post home-service jobs. Qualified providers compete in real-time reverse auctions. Prices drop to fair market rates.',
    type: 'website',
  },
};

/**
 * Server-fetch Fair Price Index overview for the hero ticker.
 *
 * Category medians move slowly (materialized view), so a 60s revalidate is
 * safe — long enough for crawlers/first visitors to hit cache, short enough
 * the seeded first paint is never badly stale. Returns null on not-ok /
 * network error so the client island can fall back to its own fetch
 * (graceful degrade). Returns an empty categories list when the API is up
 * but has no rows (legitimate empty).
 */
async function fetchPricingOverview(): Promise<{
  categories: PricingOverviewCategory[];
} | null> {
  try {
    const res = await serverFetch(`${API_URL}/api/v1/pricing`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      categories?: PricingOverviewCategory[] | null;
    };
    return { categories: body.categories ?? [] };
  } catch {
    return null;
  }
}

/**
 * PERF-05: Server Component entry for `/`.
 *
 * - Exports static metadata (SEO).
 * - Server-fetches public pricing for the market ticker (heaviest public data
 *   on the landing page) and seeds the client island so first paint is real
 *   ticker content — no skeleton flash.
 * - Interactive UI (AuctionDemo, IntersectionObserver animations, counters)
 *   stays in LandingPageClient. Root layout still forces dynamic rendering via
 *   CSP nonce (`headers()`); the DATA fetch is revalidated independently.
 */
export default async function LandingPage() {
  const overview = await fetchPricingOverview();
  const initialTickerItems: TickerItem[] | undefined =
    overview !== null ? pricingCategoriesToTickerItems(overview.categories) : undefined;

  return (
    <LandingPageClient
      {...(initialTickerItems !== undefined ? { initialTickerItems } : {})}
    />
  );
}
