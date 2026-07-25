import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ListingDetailClient } from '@/components/marketplace/ListingDetailClient';
import { sanitizeJsonLd } from '@/lib/json-ld';
import type { ListingDetail, ListingPhoto } from '@/types';

// Server-side API origin. Mirror next.config.ts: prefer the server-only
// API_URL, fall back to the public var, then localhost for dev. Public read
// (listing detail needs no auth/cookies), so this is plain server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Public site origin — drives canonical + absolute openGraph/JSON-LD URLs.
// Same resolution as layout.tsx / sitemap.ts / robots.ts.
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

/**
 * Server-fetch a listing for the detail page.
 *
 * Auctions move fast, so we use a short edge revalidate window (15s) — long
 * enough to absorb crawler/duplicate hits and serve cacheable HTML, short
 * enough that the seeded first paint is never badly stale. The client island
 * refetches live anyway. Returns null on 404 / not-ok / network error so the
 * caller can decide between notFound() and metadata fallbacks.
 */
async function fetchListing(id: string): Promise<ListingDetail | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/listings/${id}`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    // The API can return null photos at runtime even though ListingDetail
    // types them non-nullable; widen the parsed shape so we can normalize.
    const body = (await res.json()) as {
      listing?: (Omit<ListingDetail, 'photos'> & { photos: ListingPhoto[] | null }) | null;
    };
    const listing = body.listing;
    if (!listing) return null;
    // Normalize null photos at the server boundary so the carousel and OG
    // image logic never see null (same fix used elsewhere).
    return { ...listing, photos: listing.photos ?? [] };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) {
    return {
      title: 'Listing not found · NoMarkup',
      description: 'This listing could not be found.',
    };
  }

  const description =
    listing.description.length > 160
      ? `${listing.description.slice(0, 157)}...`
      : listing.description;
  const ogImage = listing.photos[0]?.url;
  const canonical = `/marketplace/${id}`;

  return {
    title: `${listing.title} · NoMarkup`,
    description,
    alternates: { canonical },
    openGraph: {
      title: listing.title,
      description,
      type: 'website',
      url: `${SITE_URL}${canonical}`,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
  };
}

/**
 * Map our listing condition grade to a schema.org OfferItemCondition URL.
 * Undefined/null ("seller didn't say") → no condition emitted.
 */
function schemaCondition(condition: ListingDetail['condition']): string | undefined {
  switch (condition) {
    case 'new':
      return 'https://schema.org/NewCondition';
    case 'like_new':
    case 'very_good':
    case 'good':
    case 'acceptable':
      return 'https://schema.org/UsedCondition';
    case 'for_parts':
      return 'https://schema.org/DamagedCondition';
    default:
      return undefined;
  }
}

/**
 * Build schema.org Product + Offer JSON-LD for a marketplace listing.
 *
 * Money is integer cents in the API → convert to dollars for schema.org.
 * The current high bid (or starting price when no bids) is the live offer
 * price; a `buy_now_price_cents`, when set, is the fixed closeout price.
 */
function buildListingJsonLd(listing: ListingDetail, url: string): Record<string, unknown> {
  const priceCents =
    listing.current_bid_cents > 0 ? listing.current_bid_cents : listing.starting_price_cents;
  const condition = schemaCondition(listing.condition);

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url,
    priceCurrency: 'USD',
    price: (listing.buy_now_price_cents ?? priceCents) / 100,
    availability:
      listing.status === 'active'
        ? 'https://schema.org/InStock'
        : 'https://schema.org/SoldOut',
  };
  if (condition) {
    offer['itemCondition'] = condition;
  }

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description,
    category: listing.category_name,
    offers: offer,
  };

  const images = listing.photos.map((p) => p.url).filter(Boolean);
  if (images.length > 0) {
    ld['image'] = images;
  }

  return ld;
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) {
    notFound();
  }

  const canonicalUrl = `${SITE_URL}/marketplace/${id}`;
  const jsonLd = buildListingJsonLd(listing, canonicalUrl);

  return (
    <>
      {/* Product structured data — server-rendered + crawlable. The payload
          carries seller-controlled free text (title, description), so it goes
          through sanitizeJsonLd: plain JSON.stringify leaves `<` and `>`
          intact and a title containing a closing script tag would break out of
          this block into live markup. See web/src/lib/json-ld.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: sanitizeJsonLd(jsonLd) }}
      />
      <ListingDetailClient listingId={id} initialListing={listing} />
    </>
  );
}
