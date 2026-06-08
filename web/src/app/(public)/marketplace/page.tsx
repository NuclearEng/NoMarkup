import type { Metadata } from 'next';

import { ListingBrowseClient } from '@/components/marketplace/ListingBrowseClient';
import type { Listing, ListingsResponse } from '@/types';

// Server-side API origin. Mirror next.config.ts / the detail page: prefer the
// server-only API_URL, fall back to the public var, then localhost for dev.
// Marketplace browse is a public read (no auth/cookies), so this is a plain
// server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Default browse view: page 1, 60 results, ending-soonest first. MUST match
// the DEFAULT_FILTERS in ListingBrowseClient so the seeded query key lines up
// and first paint renders from this server-fetched set (no skeleton).
const DEFAULT_QUERY = 'page=1&page_size=60&sort_by=ending_soon';

const EMPTY_RESPONSE: ListingsResponse = {
  listings: [],
  pagination: { totalCount: 0, page: 1, pageSize: 60, totalPages: 0, hasNext: false },
};

export const metadata: Metadata = {
  title: 'Marketplace · NoMarkup',
  description:
    'Browse live local auctions on NoMarkup. Highest bidder wins on the clock — bid on furniture, electronics, and more for local pickup near you.',
  openGraph: {
    title: 'The Live Marketplace · NoMarkup',
    description:
      'Auctions are watched, not posted. Bid on local goods and win on the clock.',
    type: 'website',
  },
};

/**
 * Server-fetch the default browse listing set.
 *
 * Browse default is less time-sensitive than a single auction, so we use a 30s
 * edge revalidate window (per CLAUDE.md §14) — long enough to serve cacheable
 * HTML to crawlers and first-time visitors, short enough that the seeded first
 * paint is never badly stale. The client island refetches live on filter/sort
 * change anyway. Returns the empty response on not-ok / network error so the
 * page never throws — the client still mounts and refetches (graceful degrade).
 */
async function fetchDefaultListings(): Promise<ListingsResponse> {
  try {
    const res = await fetch(`${API_URL}/api/v1/listings?${DEFAULT_QUERY}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return EMPTY_RESPONSE;
    // Widen the parsed shape: the API can return null arrays at runtime even
    // though ListingsResponse types them non-nullable. Normalize defensively.
    const body = (await res.json()) as {
      listings?: (Omit<Listing, 'photos'> & { photos: Listing['photos'] | null })[] | null;
      pagination?: ListingsResponse['pagination'] | null;
    };
    const listings = (body.listings ?? []).map((l) => ({ ...l, photos: l.photos ?? [] }));
    return {
      listings,
      pagination: body.pagination ?? EMPTY_RESPONSE.pagination,
    };
  } catch {
    return EMPTY_RESPONSE;
  }
}

export default async function MarketplacePage() {
  const initialListings = await fetchDefaultListings();
  return <ListingBrowseClient initialListings={initialListings} />;
}
