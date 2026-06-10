import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import type { PublicProvider } from '@/hooks/useProviders';

import { ProviderProfileClient } from './ProviderProfileClient';

// Server-side API origin. Mirror marketplace/[id] + jobs/[id]: prefer the
// server-only API_URL, fall back to the public var, then localhost for dev.
// Public read (provider profile needs no auth/cookies), so plain server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Public site origin — drives canonical + absolute openGraph URLs. Same
// resolution as layout.tsx / sitemap.ts / robots.ts.
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

/**
 * Server-fetch a provider profile for the detail page.
 *
 * Profiles change slowly (reviews/trust drift over hours), so a 60s revalidate
 * window comfortably absorbs crawler/duplicate hits while keeping the seeded
 * first paint fresh; the client island refetches anyway. The gateway returns
 * the provider at the top level (not wrapped). Returns null on 404 / not-ok /
 * network error so the caller can decide notFound() vs. metadata fallbacks.
 */
async function fetchProvider(id: string): Promise<PublicProvider | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/providers/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const provider = (await res.json()) as PublicProvider | null;
    // A valid profile always carries an id; guard against an empty/null body.
    if (!provider || !provider.id) return null;
    return provider;
  } catch {
    return null;
  }
}

/** Display name prefers the business name, falling back to the person name. */
function providerName(provider: PublicProvider): string {
  return provider.business_name ?? provider.display_name;
}

/** Clamp a description to a tidy meta length. */
function clampDescription(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const provider = await fetchProvider(id);

  if (!provider) {
    return {
      title: 'Provider not found',
      description: 'This provider could not be found.',
    };
  }

  const name = providerName(provider);
  const categories = provider.service_categories.map((c) => c.name).join(', ');
  const rating = provider.review_summary
    ? `Rated ${provider.review_summary.average_rating.toFixed(1)} from ${provider.review_summary.review_count.toString()} review${provider.review_summary.review_count === 1 ? '' : 's'}. `
    : '';
  const description = clampDescription(
    provider.bio ??
      `${rating}${categories ? `Services: ${categories}. ` : ''}${provider.jobs_completed.toString()} jobs completed on NoMarkup.`,
  );
  const canonical = `/providers/${id}`;
  const ogImage = provider.avatar_url ?? undefined;

  return {
    title: name,
    description,
    alternates: { canonical },
    openGraph: {
      title: name,
      description,
      type: 'profile',
      url: `${SITE_URL}${canonical}`,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
  };
}

/**
 * Build schema.org LocalBusiness JSON-LD for a provider.
 *
 * `aggregateRating` is only included when there are real reviews (schema.org
 * requires reviewCount > 0). `areaServed` lists the provider's service
 * categories so search engines understand what they do.
 */
function buildProviderJsonLd(provider: PublicProvider, url: string): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: providerName(provider),
    url,
  };

  if (provider.bio) {
    ld['description'] = provider.bio;
  }

  if (provider.avatar_url) {
    ld['image'] = provider.avatar_url;
  }

  if (provider.review_summary && provider.review_summary.review_count > 0) {
    ld['aggregateRating'] = {
      '@type': 'AggregateRating',
      ratingValue: provider.review_summary.average_rating,
      reviewCount: provider.review_summary.review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  if (provider.service_categories.length > 0) {
    ld['areaServed'] = provider.service_categories.map((c) => c.name);
  }

  return ld;
}

export default async function ProviderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const provider = await fetchProvider(id);

  if (!provider) {
    notFound();
  }

  const canonicalUrl = `${SITE_URL}/providers/${id}`;
  const jsonLd = buildProviderJsonLd(provider, canonicalUrl);

  return (
    <>
      {/* LocalBusiness structured data — server-rendered + crawlable. Safe:
          JSON.stringify of server-controlled data (the DOMPurify rule is for
          user HTML, not JSON-LD; this is the standard schema.org approach). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProviderProfileClient providerId={id} initialProvider={provider} />
    </>
  );
}
