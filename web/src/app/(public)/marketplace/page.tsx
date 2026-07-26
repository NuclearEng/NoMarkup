import type { Metadata } from 'next';

import { ListingBrowseClient } from '@/components/marketplace/ListingBrowseClient';
import type { Listing, ListingsResponse, SearchListingsParams } from '@/types';

// Server-side API origin. Mirror next.config.ts / the detail page: prefer the
// server-only API_URL, fall back to the public var, then localhost for dev.
// Marketplace browse is a public read (no auth/cookies), so this is a plain
// server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

const DEFAULT_PAGE_SIZE = 60;

const SORT_VALUES = new Set<NonNullable<SearchListingsParams['sort_by']>>([
  'ending_soon',
  'newest',
  'lowest_price',
  'highest_price',
  'distance',
  'trending',
]);

// Read a single value from a Next.js searchParams entry (string | string[]).
function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseIntParam(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Translate the page's ?q=&category_id=&… searchParams into a normalized
// SearchListingsParams. This is the single source of truth the page uses both
// to server-fetch the seeded set AND to seed the client's filter state, so a
// deep-linked / shared / SearchBar-submitted URL renders the right results on
// first paint instead of the default browse view.
function paramsFromSearch(
  searchParams: Record<string, string | string[] | undefined>,
): SearchListingsParams {
  const out: SearchListingsParams = {
    page: parseIntParam(searchParams['page']) ?? 1,
    page_size: parseIntParam(searchParams['page_size']) ?? DEFAULT_PAGE_SIZE,
  };

  const q = first(searchParams['q']);
  if (q && q.trim().length > 0) out.query = q;

  const categoryId = first(searchParams['category_id']);
  if (categoryId) out.category_id = categoryId;

  const categorySlug = first(searchParams['category_slug']);
  if (categorySlug) out.category_slug = categorySlug;

  const pickupZip = first(searchParams['pickup_zip']);
  if (pickupZip) out.pickup_zip = pickupZip;

  const radiusKm = parseIntParam(searchParams['radius_km']);
  if (radiusKm !== undefined) out.radius_km = radiusKm;

  const minPrice = parseIntParam(searchParams['min_price_cents']);
  if (minPrice !== undefined) out.min_price_cents = minPrice;

  const maxPrice = parseIntParam(searchParams['max_price_cents']);
  if (maxPrice !== undefined) out.max_price_cents = maxPrice;

  if (first(searchParams['ending_soon']) === 'true') out.ending_soon = true;

  const sortBy = first(searchParams['sort_by']);
  if (sortBy && SORT_VALUES.has(sortBy as NonNullable<SearchListingsParams['sort_by']>)) {
    out.sort_by = sortBy as SearchListingsParams['sort_by'];
  } else {
    out.sort_by = 'ending_soon';
  }

  return out;
}

// Build the gateway query string from a normalized SearchListingsParams. Mirrors
// web/src/hooks/useListings.ts::buildSearchParams so the server-seeded fetch and
// the client refetch hit identical URLs (and the TanStack cache key lines up).
function queryStringFor(params: SearchListingsParams): string {
  const sp = new URLSearchParams();
  if (params.query) sp.set('q', params.query);
  if (params.category_id) sp.set('category_id', params.category_id);
  if (params.category_slug) sp.set('category_slug', params.category_slug);
  if (params.pickup_zip) sp.set('pickup_zip', params.pickup_zip);
  if (params.radius_km !== undefined) sp.set('radius_km', String(params.radius_km));
  if (params.min_price_cents !== undefined)
    sp.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined)
    sp.set('max_price_cents', String(params.max_price_cents));
  if (params.ending_soon) sp.set('ending_soon', 'true');
  if (params.sort_by) sp.set('sort_by', params.sort_by);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.page_size !== undefined) sp.set('page_size', String(params.page_size));
  return sp.toString();
}

const EMPTY_RESPONSE: ListingsResponse = {
  listings: [],
  pagination: { totalCount: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, totalPages: 0, hasNext: false },
};

export const metadata: Metadata = {
  title: 'Marketplace · NoMarkup',
  description:
    'Local goods auctions with escrow. Bid ascending — the market sets the price, not the markup. Furniture, electronics, and more for pickup near you.',
  openGraph: {
    title: 'The Live Marketplace · NoMarkup',
    description:
      'Local auctions with escrow. Bid up — the market sets the price. Highest bidder wins on the clock.',
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
async function fetchListings(queryString: string): Promise<ListingsResponse> {
  try {
    const res = await fetch(`${API_URL}/api/v1/listings?${queryString}`, {
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

export default async function MarketplacePage({
  searchParams,
}: {
  // Next.js 15: searchParams is a Promise in async Server Components.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialFilters = paramsFromSearch(sp);
  const initialListings = await fetchListings(queryStringFor(initialFilters));
  return (
    <ListingBrowseClient
      initialListings={initialListings}
      initialFilters={initialFilters}
    />
  );
}
