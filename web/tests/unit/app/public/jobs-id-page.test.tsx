// `/jobs/[id]` Server Component (page.tsx) — the async RSC entry, as opposed to
// the JobDetailClient island covered by jobs-id.test.tsx. Asserts the upstream
// URL fetched, the not_found-vs-unavailable split (404 page vs. thrown error),
// generateMetadata per branch, and the sanitised JobPosting JSON-LD.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDetail } from '@/types';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

const notFound = vi.fn<() => never>();
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

interface IslandProps {
  jobId: string;
  initialJob: JobDetail;
}

const islandProps: IslandProps[] = [];
vi.mock('@/app/(public)/jobs/[id]/JobDetailClient', () => ({
  JobDetailClient: (props: IslandProps) => {
    islandProps.push(props);
    return createElement('div', { 'data-testid': 'job-island' });
  },
}));

function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1',
    customer_id: 'cust-1',
    category_id: 'cat-1',
    category_name: 'Plumbing',
    category_slug: 'plumbing',
    title: 'Fix leaking kitchen sink',
    description: 'The trap under the kitchen sink drips whenever the tap runs.',
    status: 'active',
    schedule_type: 'flexible',
    scheduled_date: null,
    is_recurring: false,
    recurrence_frequency: null,
    location_address: 'Ballard, Seattle, WA',
    location_lat: null,
    location_lng: null,
    starting_bid_cents: 25050,
    offer_accepted_cents: null,
    auction_duration_hours: 48,
    auction_ends_at: '2026-12-01T00:00:00Z',
    bid_count: 0,
    lowest_bid_cents: null,
    market_range: null,
    auction_type: 'live',
    snipe_extension_count: 0,
    original_auction_ends_at: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    customer_display_name: 'Casey C.',
    customer_avatar_url: null,
    customer_member_since: '2025-01-01T00:00:00Z',
    customer_jobs_posted: 3,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/jobs/[id]/page');
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function renderPage(id: string): Promise<{
  island: IslandProps;
  rawLd: string;
  ld: Record<string, unknown>;
}> {
  const { default: JobDetailPage } = await loadPage();
  const element = await JobDetailPage(params(id));
  const { container } = render(element);
  expect(screen.getByTestId('job-island')).toBeInTheDocument();
  const island = islandProps.at(-1);
  if (!island) throw new Error('JobDetailClient was not rendered');
  const script = container.querySelector('script[type="application/ld+json"]');
  if (!script) throw new Error('JSON-LD script was not rendered');
  const rawLd = script.innerHTML;
  return { island, rawLd, ld: JSON.parse(rawLd) as Record<string, unknown> };
}

async function metadataFor(id: string) {
  const { generateMetadata } = await loadPage();
  return generateMetadata(params(id));
}

beforeEach(() => {
  islandProps.length = 0;
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse({ job: makeJob() }));
  notFound.mockReset();
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  vi.stubEnv('API_URL', 'http://gateway.internal:8081');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/jobs/[id] page — upstream fetch', () => {
  it('fetches the job from the server-only API_URL with a 15s revalidate', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage('job-1');
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith('http://gateway.internal:8081/api/v1/jobs/job-1', {
      next: { revalidate: 15 },
    });
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL is unset', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage('job-7');
    expect(serverFetch.mock.calls[0]?.[0]).toBe('https://public.example.com/api/v1/jobs/job-7');
  });

  it('falls back to localhost when neither origin is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage('job-1');
    expect(serverFetch.mock.calls[0]?.[0]).toBe('http://localhost:8081/api/v1/jobs/job-1');
  });
});

describe('/jobs/[id] page — rendering', () => {
  it('seeds the client island with the route id and the unwrapped job', async () => {
    const job = makeJob();
    serverFetch.mockResolvedValue(jsonResponse({ job }));
    const { island } = await renderPage('job-1');
    expect(island).toEqual({ jobId: 'job-1', initialJob: job });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('emits JobPosting JSON-LD with location, a dollar base salary and validThrough', async () => {
    const { ld } = await renderPage('job-1');
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Fix leaking kitchen sink',
      description: 'The trap under the kitchen sink drips whenever the tap runs.',
      datePosted: '2026-11-01T00:00:00Z',
      url: 'https://site.example.com/jobs/job-1',
      hiringOrganization: {
        '@type': 'Organization',
        name: 'NoMarkup',
        sameAs: 'https://site.example.com',
      },
      employmentType: 'CONTRACTOR',
      industry: 'Plumbing',
      jobLocation: {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', name: 'Ballard, Seattle, WA' },
      },
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'USD',
        // 25050 integer cents → 250.5 dollars.
        value: { '@type': 'QuantitativeValue', value: 250.5, unitText: 'JOB' },
      },
      validThrough: '2026-12-01T00:00:00Z',
    });
  });

  it('omits jobLocation, baseSalary and validThrough when the job has none', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({
        job: makeJob({ location_address: null, starting_bid_cents: null, auction_ends_at: null }),
      }),
    );
    const { ld } = await renderPage('job-1');
    expect(ld).not.toHaveProperty('jobLocation');
    expect(ld).not.toHaveProperty('baseSalary');
    expect(ld).not.toHaveProperty('validThrough');
    expect(ld['title']).toBe('Fix leaking kitchen sink');
  });

  it('treats a zero starting bid and an empty address as absent', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({ job: makeJob({ location_address: '', starting_bid_cents: 0 }) }),
    );
    const { ld } = await renderPage('job-1');
    expect(ld).not.toHaveProperty('jobLocation');
    expect(ld).not.toHaveProperty('baseSalary');
  });

  it('escapes customer-controlled markup so it cannot close the script block', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({ job: makeJob({ title: '</script><script>alert(1)</script> & co' }) }),
    );
    const { rawLd, ld } = await renderPage('job-1');
    expect(rawLd).not.toContain('<');
    expect(rawLd).not.toContain('>');
    expect(rawLd).not.toContain('&');
    expect(ld['title']).toBe('</script><script>alert(1)</script> & co');
  });

  it('uses the production origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const { ld } = await renderPage('job-1');
    expect(ld['url']).toBe('https://no-markup.com/jobs/job-1');
    expect(ld['hiringOrganization']).toMatchObject({ sameAs: 'https://no-markup.com' });
  });
});

describe('/jobs/[id] page — missing vs. unavailable', () => {
  it.each<[string, () => void]>([
    [
      'an HTTP 404',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
      },
    ],
    [
      'a 200 body with job: null',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ job: null }));
      },
    ],
    [
      'a 200 body with no job field',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({}));
      },
    ],
  ])('calls notFound() on %s', async (_label, arrange) => {
    arrange();
    const { default: JobDetailPage } = await loadPage();
    await expect(JobDetailPage(params('job-missing'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(islandProps).toHaveLength(0);
  });

  it.each<[string, () => void]>([
    [
      'a 503',
      () => {
        serverFetch.mockResolvedValue(jsonResponse({ error: 'down' }, 503));
      },
    ],
    [
      'a network error',
      () => {
        serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      },
    ],
    [
      'a non-JSON 200 body',
      () => {
        serverFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
      },
    ],
  ])('throws to the error boundary — not a 404 — on %s', async (_label, arrange) => {
    arrange();
    const { default: JobDetailPage } = await loadPage();
    await expect(JobDetailPage(params('job-1'))).rejects.toThrow('The catalog could not be loaded');
    expect(notFound).not.toHaveBeenCalled();
    expect(islandProps).toHaveLength(0);
  });
});

describe('/jobs/[id] page — generateMetadata', () => {
  it('returns the not-found metadata for a missing job', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));
    expect(await metadataFor('job-missing')).toEqual({
      title: 'Job not found',
      description: 'This job could not be found.',
    });
    expect(serverFetch.mock.calls[0]?.[0]).toBe(
      'http://gateway.internal:8081/api/v1/jobs/job-missing',
    );
  });

  it('returns the unavailable metadata when the catalog is down', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'down' }, 500));
    expect(await metadataFor('job-1')).toEqual({
      title: 'Job unavailable',
      description: 'The catalog could not be loaded.',
    });
  });

  it('returns the unavailable metadata when the fetch throws', async () => {
    serverFetch.mockRejectedValue(new Error('ETIMEDOUT'));
    expect((await metadataFor('job-1')).title).toBe('Job unavailable');
  });

  it('builds title, description, canonical and Open Graph from the job', async () => {
    expect(await metadataFor('job-1')).toEqual({
      title: 'Fix leaking kitchen sink',
      description: 'The trap under the kitchen sink drips whenever the tap runs.',
      alternates: { canonical: '/jobs/job-1' },
      openGraph: {
        title: 'Fix leaking kitchen sink',
        description: 'The trap under the kitchen sink drips whenever the tap runs.',
        type: 'website',
        url: 'https://site.example.com/jobs/job-1',
      },
    });
  });

  it('trims and clamps a long description to 160 characters with an ellipsis', async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({ job: makeJob({ description: `\n ${'d'.repeat(300)} \n` }) }),
    );
    const metadata = await metadataFor('job-1');
    expect(metadata.description).toBe(`${'d'.repeat(157)}...`);
    expect(metadata.openGraph?.description).toBe(`${'d'.repeat(157)}...`);
  });

  it('builds the Open Graph URL on the production origin when NEXT_PUBLIC_SITE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    const metadata = await metadataFor('job-1');
    expect(metadata.openGraph?.url).toBe('https://no-markup.com/jobs/job-1');
  });
});
