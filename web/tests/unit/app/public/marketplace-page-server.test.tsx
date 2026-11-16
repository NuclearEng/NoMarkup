// /marketplace — the async Server Component itself (the client island has its
// own spec in marketplace.test.tsx). MOCKED: serverFetch and the
// ListingBrowseClient island (a stub that records the props it was seeded
// with). PROVEN: how URL search params become the gateway query + the seeded
// filters, and that every failure mode degrades to an empty listing set
// instead of throwing.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Listing, ListingsResponse, SearchListingsParams } from '@/types';

type FetchInit = { next?: { revalidate?: number | false } } | undefined;

const { serverFetch } = vi.hoisted(() => ({
  serverFetch: vi.fn<(url: string, init?: FetchInit) => Promise<Response>>(),
}));

vi.mock('@/lib/server-fetch', () => ({ serverFetch }));

interface SeededProps {
  initialListings: ListingsResponse;
  initialFilters: SearchListingsParams;
}

const seededCalls: SeededProps[] = [];

vi.mock('@/components/marketplace/ListingBrowseClient', () => ({
  ListingBrowseClient: (props: SeededProps) => {
    seededCalls.push(props);
    return createElement('div', { 'data-testid': 'browse-client' });
  },
}));

type PageModule = typeof import('@/app/(public)/marketplace/page');
type RawSearch = Record<string, string | string[] | undefined>;

let pageModule: PageModule;

const EMPTY: ListingsResponse = {
  listings: [],
  pagination: { totalCount: 0, page: 1, pageSize: 60, totalPages: 0, hasNext: false },
};

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'l-1',
    seller_id: 's-1',
    category_id: 'c-1',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Oak table',
    description: 'Solid oak dining table, seats six.',
    status: 'active',
    photos: [{ id: 'p-1', url: 'https://cdn.test/p1.jpg', blur_hash: null, sort_order: 0 }],
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    pickup_address: null,
    pickup_lat: 37.75,
    pickup_lng: -122.41,
    starting_price_cents: 5000,
    current_bid_cents: 7500,
    min_increment_cents: 100,
    bidder_count: 2,
    bid_count: 3,
    auction_duration_hours: 48,
    auction_ends_at: '2026-03-03T12:00:00.000Z',
    snipe_extension_count: 0,
    distance_km: null,
    is_user_winning: false,
    was_outbid: false,
    created_at: '2026-03-01T12:00:00.000Z',
    updated_at: '2026-03-01T12:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderPage(search: RawSearch = {}, mod: PageModule = pageModule): Promise<SeededProps> {
  seededCalls.length = 0;
  const element = await mod.default({ searchParams: Promise.resolve(search) });
  render(element);
  const props = seededCalls.at(-1);
  if (!props) throw new Error('ListingBrowseClient was not rendered');
  return props;
}

function requestedUrl(): URL {
  const call = serverFetch.mock.calls[0];
  if (!call) throw new Error('serverFetch was not called');
  return new URL(call[0]);
}

function requestedQuery(): Record<string, string> {
  return Object.fromEntries(requestedUrl().searchParams.entries());
}

beforeAll(async () => {
  vi.stubEnv('API_URL', 'http://gateway.test');
  vi.resetModules();
  pageModule = await import('@/app/(public)/marketplace/page');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse(EMPTY));
});

describe('MarketplacePage — default browse', () => {
  it('fetches the first 60 listings ending soonest from the server-side gateway origin', async () => {
    await renderPage();
    expect(serverFetch).toHaveBeenCalledTimes(1);
    const url = requestedUrl();
    expect(url.origin).toBe('http://gateway.test');
    expect(url.pathname).toBe('/api/v1/listings');
    expect(requestedQuery()).toEqual({ sort_by: 'ending_soon', page: '1', page_size: '60' });
  });

  it('caches the browse fetch for 30 seconds', async () => {
    await renderPage();
    expect(serverFetch.mock.calls[0]?.[1]).toEqual({ next: { revalidate: 30 } });
  });

  it('seeds the client with the default filters', async () => {
    const props = await renderPage();
    expect(props.initialFilters).toEqual({ page: 1, page_size: 60, sort_by: 'ending_soon' });
  });

  it('passes the fetched listings and pagination through to the client', async () => {
    const pagination = { totalCount: 61, page: 1, pageSize: 60, totalPages: 2, hasNext: true };
    serverFetch.mockResolvedValue(jsonResponse({ listings: [listing()], pagination }));
    const props = await renderPage();
    expect(props.initialListings.listings.map((l) => l.id)).toEqual(['l-1']);
    expect(props.initialListings.listings[0]?.photos).toHaveLength(1);
    expect(props.initialListings.pagination).toEqual(pagination);
  });
});

describe('MarketplacePage — search params', () => {
  it('maps every supported param into the gateway query and the seeded filters', async () => {
    const props = await renderPage({
      q: 'oak table',
      category_id: 'cat-9',
      category_slug: 'furniture',
      pickup_zip: '94110',
      radius_km: '40',
      min_price_cents: '1000',
      max_price_cents: '50000',
      ending_soon: 'true',
      sort_by: 'lowest_price',
      page: '3',
      page_size: '24',
    });
    expect(requestedQuery()).toEqual({
      q: 'oak table',
      category_id: 'cat-9',
      category_slug: 'furniture',
      pickup_zip: '94110',
      radius_km: '40',
      min_price_cents: '1000',
      max_price_cents: '50000',
      ending_soon: 'true',
      sort_by: 'lowest_price',
      page: '3',
      page_size: '24',
    });
    expect(props.initialFilters).toEqual({
      query: 'oak table',
      category_id: 'cat-9',
      category_slug: 'furniture',
      pickup_zip: '94110',
      radius_km: 40,
      min_price_cents: 1000,
      max_price_cents: 50000,
      ending_soon: true,
      sort_by: 'lowest_price',
      page: 3,
      page_size: 24,
    });
  });

  it.each(['ending_soon', 'newest', 'lowest_price', 'highest_price', 'distance', 'trending'])(
    'accepts sort_by=%s',
    async (sort) => {
      const props = await renderPage({ sort_by: sort });
      expect(props.initialFilters.sort_by).toBe(sort);
      expect(requestedQuery()['sort_by']).toBe(sort);
    },
  );

  it('falls back to ending_soon for a sort the gateway does not support', async () => {
    const props = await renderPage({ sort_by: 'price; drop table listings' });
    expect(props.initialFilters.sort_by).toBe('ending_soon');
    expect(requestedQuery()['sort_by']).toBe('ending_soon');
  });

  it('uses the first value when a param is repeated in the URL', async () => {
    const props = await renderPage({
      q: ['sofa', 'chair'],
      page: ['2', '9'],
      sort_by: ['newest', 'trending'],
    });
    expect(props.initialFilters.query).toBe('sofa');
    expect(props.initialFilters.page).toBe(2);
    expect(props.initialFilters.sort_by).toBe('newest');
    expect(requestedQuery()).toMatchObject({ q: 'sofa', page: '2', sort_by: 'newest' });
  });

  it('drops a whitespace-only search query', async () => {
    const props = await renderPage({ q: '   ' });
    expect(props.initialFilters).not.toHaveProperty('query');
    expect(requestedUrl().searchParams.has('q')).toBe(false);
  });

  it('ignores numeric params that are empty or not numbers', async () => {
    const props = await renderPage({
      page: 'abc',
      page_size: '',
      radius_km: 'far',
      min_price_cents: '',
      max_price_cents: 'NaN',
    });
    expect(props.initialFilters).toEqual({ page: 1, page_size: 60, sort_by: 'ending_soon' });
    expect(requestedQuery()).toEqual({ sort_by: 'ending_soon', page: '1', page_size: '60' });
  });

  it('keeps a zero minimum price instead of treating it as unset', async () => {
    const props = await renderPage({ min_price_cents: '0', radius_km: '0' });
    expect(props.initialFilters.min_price_cents).toBe(0);
    expect(props.initialFilters.radius_km).toBe(0);
    expect(requestedQuery()).toMatchObject({ min_price_cents: '0', radius_km: '0' });
  });

  it.each(['false', '1', 'TRUE', ''])('does not enable ending_soon for %j', async (value) => {
    const props = await renderPage({ ending_soon: value });
    expect(props.initialFilters).not.toHaveProperty('ending_soon');
    expect(requestedUrl().searchParams.has('ending_soon')).toBe(false);
  });

  it('URL-encodes the search text sent to the gateway', async () => {
    await renderPage({ q: 'bed & frame' });
    const call = serverFetch.mock.calls[0];
    expect(call?.[0]).toContain('q=bed+%26+frame');
    expect(requestedQuery()['q']).toBe('bed & frame');
  });
});

describe('MarketplacePage — degraded responses', () => {
  it('seeds an empty listing set when the gateway answers with an error status', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 503));
    const props = await renderPage({ q: 'sofa' });
    expect(props.initialListings).toEqual(EMPTY);
    // The filters still reach the client so its own refetch asks the same question.
    expect(props.initialFilters.query).toBe('sofa');
  });

  it('seeds an empty listing set when the fetch itself throws', async () => {
    serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const props = await renderPage();
    expect(props.initialListings).toEqual(EMPTY);
  });

  it('seeds an empty listing set when the body is not JSON', async () => {
    serverFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
    const props = await renderPage();
    expect(props.initialListings).toEqual(EMPTY);
  });

  it('treats a null listings array as no listings but keeps the pagination', async () => {
    const pagination = { totalCount: 0, page: 4, pageSize: 60, totalPages: 3, hasNext: false };
    serverFetch.mockResolvedValue(jsonResponse({ listings: null, pagination }));
    const props = await renderPage();
    expect(props.initialListings.listings).toEqual([]);
    expect(props.initialListings.pagination).toEqual(pagination);
  });

  it('normalizes null photos to an empty array on each listing', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({
        listings: [{ ...listing({ id: 'l-null' }), photos: null }, listing({ id: 'l-ok' })],
        pagination: EMPTY.pagination,
      }),
    );
    const props = await renderPage();
    expect(props.initialListings.listings.map((l) => [l.id, l.photos.length])).toEqual([
      ['l-null', 0],
      ['l-ok', 1],
    ]);
  });

  it('falls back to empty pagination when the gateway omits or nulls it', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ listings: [listing()], pagination: null }));
    const withNull = await renderPage();
    expect(withNull.initialListings.pagination).toEqual(EMPTY.pagination);
    expect(withNull.initialListings.listings).toHaveLength(1);

    serverFetch.mockResolvedValue(jsonResponse({}));
    const omitted = await renderPage();
    expect(omitted.initialListings).toEqual(EMPTY);
  });
});

describe('MarketplacePage — metadata and API origin', () => {
  it('exports marketplace metadata including the buyer-fees disclosure', () => {
    const { metadata } = pageModule;
    expect(metadata.title).toBe('Marketplace · NoMarkup');
    expect(metadata.description).toContain('Local goods auctions with escrow.');
    expect(metadata.description).toContain(
      'You pay the item price plus disclosed fees and tax. The seller receives the item price.',
    );
    expect(metadata.openGraph?.title).toBe('The Live Marketplace · NoMarkup');
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL is not set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://public-gateway.test');
    vi.resetModules();
    const mod = await import('@/app/(public)/marketplace/page');
    await renderPage({}, mod);
    expect(requestedUrl().origin).toBe('http://public-gateway.test');
    vi.stubEnv('API_URL', 'http://gateway.test');
  });

  it('falls back to the local gateway when neither env var is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    vi.resetModules();
    const mod = await import('@/app/(public)/marketplace/page');
    await renderPage({}, mod);
    expect(requestedUrl().origin).toBe('http://localhost:8081');
    vi.stubEnv('API_URL', 'http://gateway.test');
  });
});
