import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ListingDetailClient } from '@/components/marketplace/ListingDetailClient';
import type { ListingDetail, ListingPhoto } from '@/types';

// Server-side API origin. Mirror next.config.ts: prefer the server-only
// API_URL, fall back to the public var, then localhost for dev. Public read
// (listing detail needs no auth/cookies), so this is plain server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

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

  return {
    title: `${listing.title} · NoMarkup`,
    description,
    openGraph: {
      title: listing.title,
      description,
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
  };
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

  return <ListingDetailClient listingId={id} initialListing={listing} />;
}
