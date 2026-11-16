// /marketplace/[id] — the async Server Component and generateMetadata (the
// client island has its own spec in marketplace-id.test.tsx). MOCKED:
// serverFetch, next/navigation notFound (throws, as Next's does) and the
// ListingDetailClient island. PROVEN: the fetch contract, 404 handling,
// metadata, and the Product/Offer JSON-LD including script-breakout escaping.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListingDetail } from '@/types';

type FetchInit = { next?: { revalidate?: number | false } } | undefined;

const { serverFetch, notFound } = vi.hoisted(() => ({
  serverFetch: vi.fn<(url: string, init?: FetchInit) => Promise<Response>>(),
  notFound: vi.fn<() => never>(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/server-fetch', () => ({ serverFetch }));
vi.mock('next/navigation', () => ({ notFound }));

interface ClientProps {
  listingId: string;
  initialListing: ListingDetail;
}

let clientProps: ClientProps | null = null;

vi.mock('@/components/marketplace/ListingDetailClient', () => ({
  ListingDetailClient: (props: ClientProps) => {
    clientProps = props;
    return createElement('div', { 'data-testid': 'detail-client' });
  },
}));

type PageModule = typeof import('@/app/(public)/marketplace/[id]/page');
let pageModule: PageModule;

function detail(overrides: Partial<ListingDetail> = {}): ListingDetail {
  return {
    id: 'l-1',
    seller_id: 's-1',
    category_id: 'c-1',
    category_name: 'Furniture',
    category_slug: 'furniture',
    title: 'Oak table',
    description: 'Solid oak dining table, seats six.',
    status: 'active',
    photos: [
      { id: 'p-1', url: 'https://cdn.test/p1.jpg', blur_hash: null, sort_order: 0 },
      { id: 'p-2', url: 'https://cdn.test/p2.jpg', blur_hash: null, sort_order: 1 },
    ],
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    pickup_address: null,
    pickup_lat: 37.75,
    pickup_lng: -122.41,
    starting_price_cents: 5000,
    current_bid_cents: 7550,
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
    seller_display_name: 'Sam S.',
    seller_member_since: '2025-01-01T00:00:00.000Z',
    seller_listings_count: 4,
    seller_trust_tier: null,
    seller_trust_score: null,
    seller_average_rating: null,
    seller_review_count: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function respondWith(listing: unknown) {
  serverFetch.mockResolvedValue(jsonResponse({ listing }));
}

interface JsonLd {
  '@context': string;
  '@type': string;
  name: string;
  description: string;
  category: string;
  image?: string[];
  offers: {
    '@type': string;
    url: string;
    priceCurrency: string;
    price: number;
    availability: string;
    itemCondition?: string;
  };
}

async function renderPage(id = 'l-1'): Promise<{ jsonLd: JsonLd; rawJsonLd: string; container: HTMLElement }> {
  clientProps = null;
  const element = await pageModule.default({ params: Promise.resolve({ id }) });
  const { container } = render(element);
  const script = container.querySelector('script[type="application/ld+json"]');
  if (!script) throw new Error('JSON-LD script not rendered');
  const rawJsonLd = script.innerHTML;
  return { jsonLd: JSON.parse(rawJsonLd) as JsonLd, rawJsonLd, container };
}

function metadataFor(id = 'l-1') {
  return pageModule.generateMetadata({ params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  vi.stubEnv('API_URL', 'http://gateway.test');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.test');
  vi.resetModules();
  pageModule = await import('@/app/(public)/marketplace/[id]/page');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  serverFetch.mockReset();
  notFound.mockClear();
  respondWith(detail());
});

describe('ListingDetailPage — fetch and seeding', () => {
  it('fetches the listing by id from the gateway with a 15 second cache', async () => {
    await renderPage('abc-123');
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith('http://gateway.test/api/v1/listings/abc-123', {
      next: { revalidate: 15 },
    });
  });

  it('seeds the client island with the id and the fetched listing', async () => {
    await renderPage('l-1');
    expect(clientProps?.listingId).toBe('l-1');
    expect(clientProps?.initialListing.title).toBe('Oak table');
    expect(clientProps?.initialListing.photos).toHaveLength(2);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('normalizes null photos to an empty array before seeding the client', async () => {
    respondWith({ ...detail(), photos: null });
    const { jsonLd } = await renderPage();
    expect(clientProps?.initialListing.photos).toEqual([]);
    expect(jsonLd).not.toHaveProperty('image');
  });
});

describe('ListingDetailPage — not found', () => {
  it('404s when the gateway answers with an error status', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
    await expect(pageModule.default({ params: Promise.resolve({ id: 'gone' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('404s when the body has no listing', async () => {
    respondWith(null);
    await expect(pageModule.default({ params: Promise.resolve({ id: 'gone' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('404s rather than crashing when the gateway is unreachable', async () => {
    serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(pageModule.default({ params: Promise.resolve({ id: 'l-1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe('ListingDetailPage — JSON-LD', () => {
  it('describes the listing as a schema.org Product with an in-stock USD offer', async () => {
    const { jsonLd } = await renderPage('l-1');
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('Product');
    expect(jsonLd.name).toBe('Oak table');
    expect(jsonLd.description).toBe('Solid oak dining table, seats six.');
    expect(jsonLd.category).toBe('Furniture');
    expect(jsonLd.image).toEqual(['https://cdn.test/p1.jpg', 'https://cdn.test/p2.jpg']);
    expect(jsonLd.offers).toEqual({
      '@type': 'Offer',
      url: 'https://site.test/marketplace/l-1',
      priceCurrency: 'USD',
      price: 75.5,
      availability: 'https://schema.org/InStock',
    });
  });

  it('prices the offer at the starting price while there are no bids', async () => {
    respondWith(detail({ current_bid_cents: 0, starting_price_cents: 5000 }));
    const { jsonLd } = await renderPage();
    expect(jsonLd.offers.price).toBe(50);
  });

  it('prices the offer at the buy-now price when one is set', async () => {
    respondWith(detail({ current_bid_cents: 7550, buy_now_price_cents: 12000 }));
    const { jsonLd } = await renderPage();
    expect(jsonLd.offers.price).toBe(120);
  });

  it('ignores a null buy-now price', async () => {
    respondWith(detail({ current_bid_cents: 7550, buy_now_price_cents: null }));
    const { jsonLd } = await renderPage();
    expect(jsonLd.offers.price).toBe(75.5);
  });

  it.each(['sold', 'ended', 'cancelled', 'draft'] as const)(
    'marks a %s listing as sold out',
    async (status) => {
      respondWith({ ...detail(), status });
      const { jsonLd } = await renderPage();
      expect(jsonLd.offers.availability).toBe('https://schema.org/SoldOut');
    },
  );

  it.each([
    ['new', 'https://schema.org/NewCondition'],
    ['like_new', 'https://schema.org/UsedCondition'],
    ['very_good', 'https://schema.org/UsedCondition'],
    ['good', 'https://schema.org/UsedCondition'],
    ['acceptable', 'https://schema.org/UsedCondition'],
    ['for_parts', 'https://schema.org/DamagedCondition'],
  ] as const)('maps condition %s to %s', async (condition, expected) => {
    respondWith(detail({ condition }));
    const { jsonLd } = await renderPage();
    expect(jsonLd.offers.itemCondition).toBe(expected);
  });

  it('omits itemCondition when the seller did not state one', async () => {
    respondWith(detail({ condition: null }));
    const { jsonLd } = await renderPage();
    expect(jsonLd.offers).not.toHaveProperty('itemCondition');
  });

  it('leaves photos with an empty URL out of the image list', async () => {
    respondWith(
      detail({
        photos: [
          { id: 'p-1', url: '', blur_hash: null, sort_order: 0 },
          { id: 'p-2', url: 'https://cdn.test/p2.jpg', blur_hash: null, sort_order: 1 },
        ],
      }),
    );
    const { jsonLd } = await renderPage();
    expect(jsonLd.image).toEqual(['https://cdn.test/p2.jpg']);
  });

  it('escapes seller text so a title cannot close the script block', async () => {
    const hostile = 'Table</script><img src=x onerror=alert(1)>';
    respondWith(detail({ title: hostile }));
    const { jsonLd, rawJsonLd, container } = await renderPage();
    expect(rawJsonLd).not.toContain('</script');
    expect(rawJsonLd).not.toContain('<img');
    expect(container.querySelector('img')).toBeNull();
    // Still decodes to the seller's exact text for structured-data consumers.
    expect(jsonLd.name).toBe(hostile);
  });
});

describe('generateMetadata', () => {
  it('builds title, canonical and openGraph from the listing', async () => {
    const meta = await metadataFor('l-1');
    expect(meta.title).toBe('Oak table · NoMarkup');
    expect(meta.description).toBe('Solid oak dining table, seats six.');
    expect(meta.alternates).toEqual({ canonical: '/marketplace/l-1' });
    expect(meta.openGraph).toEqual({
      title: 'Oak table',
      description: 'Solid oak dining table, seats six.',
      type: 'website',
      url: 'https://site.test/marketplace/l-1',
      images: [{ url: 'https://cdn.test/p1.jpg' }],
    });
  });

  it('truncates a long description to 157 characters plus an ellipsis', async () => {
    respondWith(detail({ description: 'x'.repeat(161) }));
    const meta = await metadataFor();
    expect(meta.description).toBe(`${'x'.repeat(157)}...`);
    expect(meta.description).toHaveLength(160);
  });

  it('keeps a description of exactly 160 characters intact', async () => {
    respondWith(detail({ description: 'y'.repeat(160) }));
    const meta = await metadataFor();
    expect(meta.description).toBe('y'.repeat(160));
  });

  it('omits the openGraph image when the listing has no photos', async () => {
    respondWith({ ...detail(), photos: null });
    const meta = await metadataFor();
    expect(meta.openGraph).not.toHaveProperty('images');
    expect(meta.openGraph?.title).toBe('Oak table');
  });

  it('returns not-found metadata when the listing cannot be fetched', async () => {
    serverFetch.mockResolvedValue(jsonResponse({}, 404));
    const meta = await metadataFor('gone');
    expect(meta).toEqual({
      title: 'Listing not found · NoMarkup',
      description: 'This listing could not be found.',
    });
    // Metadata must never 404 the request by itself.
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns not-found metadata when the fetch throws', async () => {
    serverFetch.mockRejectedValue(new Error('timeout'));
    const meta = await metadataFor();
    expect(meta.title).toBe('Listing not found · NoMarkup');
  });
});
