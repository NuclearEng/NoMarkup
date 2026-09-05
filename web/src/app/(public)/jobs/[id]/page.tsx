import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { sanitizeJsonLd } from '@/lib/json-ld';
import { serverFetch } from '@/lib/server-fetch';
import type { JobDetail } from '@/types';

import { JobDetailClient } from './JobDetailClient';

// Server-side API origin. Mirror marketplace/[id]: prefer the server-only
// API_URL, fall back to the public var, then localhost for dev. Public read
// (job detail needs no auth/cookies), so this is a plain server fetch.
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

// Public site origin — drives canonical + absolute openGraph URLs. Same
// resolution as layout.tsx / sitemap.ts / robots.ts.
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

/**
 * Server-fetch a job for the detail page.
 *
 * Auctions move fast, so we use a short edge revalidate window (15s) — long
 * enough to absorb crawler/duplicate hits and serve cacheable HTML, short
 * enough that the seeded first paint is never badly stale. The client island
 * refetches live anyway. Returns null on 404 / not-ok / network error so the
 * caller can decide between notFound() and metadata fallbacks.
 */
async function fetchJob(id: string): Promise<JobDetail | null> {
  try {
    const res = await serverFetch(`${API_URL}/api/v1/jobs/${id}`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { job?: JobDetail | null };
    return body.job ?? null;
  } catch {
    return null;
  }
}

/** Clamp a description to a tidy meta length without cutting mid-tag. */
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
  const job = await fetchJob(id);

  if (!job) {
    return {
      title: 'Job not found',
      description: 'This job could not be found.',
    };
  }

  const description = clampDescription(job.description);
  const canonical = `/jobs/${id}`;

  return {
    title: job.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: job.title,
      description,
      type: 'website',
      url: `${SITE_URL}${canonical}`,
    },
  };
}

/**
 * Build the schema.org JobPosting JSON-LD for a job.
 *
 * Money is integer cents in the API → convert to dollars for schema.org's
 * `MonetaryAmount`. We advertise the starting bid (what providers compete
 * down from) as the `baseSalary`, since it's the public price anchor.
 */
function buildJobPostingJsonLd(job: JobDetail, url: string): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    datePosted: job.created_at,
    url,
    hiringOrganization: {
      '@type': 'Organization',
      name: 'NoMarkup',
      sameAs: SITE_URL,
    },
    employmentType: 'CONTRACTOR',
    industry: job.category_name,
  };

  if (job.location_address) {
    ld['jobLocation'] = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', name: job.location_address },
    };
  }

  if (job.starting_bid_cents) {
    ld['baseSalary'] = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        value: job.starting_bid_cents / 100,
        unitText: 'JOB',
      },
    };
  }

  if (job.auction_ends_at) {
    ld['validThrough'] = job.auction_ends_at;
  }

  return ld;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await fetchJob(id);

  if (!job) {
    notFound();
  }

  const canonicalUrl = `${SITE_URL}/jobs/${id}`;
  const jsonLd = buildJobPostingJsonLd(job, canonicalUrl);

  return (
    <>
      {/* JobPosting structured data — server-rendered + crawlable. The payload
          carries customer-controlled free text (title, description,
          location_address), so it goes through sanitizeJsonLd: plain
          JSON.stringify leaves `<` and `>` intact and a title containing a
          closing script tag would break out of this block into live markup.
          See web/src/lib/json-ld.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: sanitizeJsonLd(jsonLd) }}
      />
      <JobDetailClient jobId={id} initialJob={job} />
    </>
  );
}
