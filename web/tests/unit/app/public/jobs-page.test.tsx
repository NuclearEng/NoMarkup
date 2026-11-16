// `/jobs` Server Component (page.tsx) — the async RSC entry, as opposed to the
// JobsSearchClient island covered by jobs.test.tsx. Asserts the searchParams →
// SearchJobsParams parsing (bad input, arrays, aliases), the exact upstream URL
// the server fetch hits, and the null-vs-empty seeding contract on failure.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job, JobsResponse, SearchJobsParams } from '@/types';

const serverFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/server-fetch', () => ({
  serverFetch: (url: string, init?: RequestInit) => serverFetch(url, init),
}));

interface IslandProps {
  initialJobs: JobsResponse | null;
  initialFilters: SearchJobsParams;
}

const islandProps: IslandProps[] = [];
vi.mock('@/app/(public)/jobs/JobsSearchClient', () => ({
  JobsSearchClient: (props: IslandProps) => {
    islandProps.push(props);
    return createElement('div', { 'data-testid': 'jobs-island' });
  },
}));

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_PAGINATION: JobsResponse['pagination'] = {
  totalCount: 0,
  page: 1,
  pageSize: 12,
  totalPages: 0,
  hasNext: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadPage() {
  vi.resetModules();
  return import('@/app/(public)/jobs/page');
}

/** Render the RSC and return what it handed the client island. */
async function renderPage(searchParams: SearchParams): Promise<IslandProps> {
  const { default: JobsSearchPage } = await loadPage();
  const element = await JobsSearchPage({ searchParams: Promise.resolve(searchParams) });
  render(element);
  expect(screen.getByTestId('jobs-island')).toBeInTheDocument();
  const props = islandProps.at(-1);
  if (!props) throw new Error('JobsSearchClient was not rendered');
  return props;
}

function fetchedUrl(): URL {
  const url = serverFetch.mock.calls.at(-1)?.[0];
  if (url === undefined) throw new Error('serverFetch was not called');
  return new URL(url);
}

function fetchedQuery(): Record<string, string> {
  return Object.fromEntries(fetchedUrl().searchParams.entries());
}

beforeEach(() => {
  islandProps.length = 0;
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(jsonResponse({ jobs: [], pagination: DEFAULT_PAGINATION }));
  vi.stubEnv('API_URL', 'http://gateway.internal:8081');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/jobs page — upstream origin', () => {
  it('prefers the server-only API_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage({});
    expect(fetchedUrl().origin).toBe('http://gateway.internal:8081');
    expect(fetchedUrl().pathname).toBe('/api/v1/jobs');
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL is unset', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://public.example.com');
    await renderPage({});
    expect(fetchedUrl().origin).toBe('https://public.example.com');
  });

  it('falls back to localhost when neither is set', async () => {
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    await renderPage({});
    expect(fetchedUrl().origin).toBe('http://localhost:8081');
  });

  it('requests a 30s revalidate window', async () => {
    await renderPage({});
    expect(serverFetch.mock.calls[0]?.[1]).toEqual({ next: { revalidate: 30 } });
  });
});

describe('/jobs page — searchParams parsing', () => {
  it('defaults to page 1 / page_size 12 with no filters', async () => {
    const { initialFilters } = await renderPage({});
    expect(initialFilters).toEqual({ page: 1, page_size: 12 });
    expect(fetchedQuery()).toEqual({ page: '1', page_size: '12' });
  });

  it('maps every supported filter onto the gateway query names', async () => {
    const { initialFilters } = await renderPage({
      q: 'leaky faucet',
      category_id: 'cat-plumbing',
      schedule_type: 'date_range',
      min_price_cents: '5000',
      max_price_cents: '25000',
      radius_km: '40',
      latitude: '47.61',
      longitude: '-122.33',
      is_recurring: 'true',
      page: '3',
      page_size: '24',
    });

    expect(initialFilters).toEqual({
      page: 3,
      page_size: 24,
      query: 'leaky faucet',
      category_id: 'cat-plumbing',
      schedule_type: 'date_range',
      min_price_cents: 5000,
      max_price_cents: 25000,
      radius_km: 40,
      location_lat: 47.61,
      location_lng: -122.33,
      is_recurring: true,
    });
    // Renamed on the wire: category_id→category_ids, is_recurring→recurring_only,
    // location_lat/lng→latitude/longitude.
    expect(fetchedQuery()).toEqual({
      category_ids: 'cat-plumbing',
      q: 'leaky faucet',
      schedule_type: 'date_range',
      recurring_only: 'true',
      min_price_cents: '5000',
      max_price_cents: '25000',
      latitude: '47.61',
      longitude: '-122.33',
      radius_km: '40',
      page: '3',
      page_size: '24',
    });
  });

  it('takes the first value of a repeated param', async () => {
    const { initialFilters } = await renderPage({
      q: ['roof', 'gutter'],
      page: ['2', '9'],
      category_id: ['cat-a', 'cat-b'],
    });
    expect(initialFilters).toEqual({ page: 2, page_size: 12, query: 'roof', category_id: 'cat-a' });
  });

  it('falls back to defaults for non-numeric and empty numeric params', async () => {
    const { initialFilters } = await renderPage({
      page: 'abc',
      page_size: '',
      min_price_cents: 'cheap',
      max_price_cents: 'Infinity',
      radius_km: '',
    });
    expect(initialFilters).toEqual({ page: 1, page_size: 12 });
  });

  it('keeps a zero price bound rather than treating it as absent', async () => {
    const { initialFilters } = await renderPage({ min_price_cents: '0' });
    expect(initialFilters.min_price_cents).toBe(0);
    expect(fetchedQuery()['min_price_cents']).toBe('0');
  });

  it('drops a whitespace-only query and an empty category', async () => {
    const { initialFilters } = await renderPage({ q: '   ', category_id: '' });
    expect(initialFilters).toEqual({ page: 1, page_size: 12 });
  });

  it.each(['flexible', 'specific_date', 'date_range'] as const)(
    'accepts schedule_type=%s',
    async (scheduleType) => {
      const { initialFilters } = await renderPage({ schedule_type: scheduleType });
      expect(initialFilters.schedule_type).toBe(scheduleType);
    },
  );

  it('rejects an unknown schedule_type', async () => {
    const { initialFilters } = await renderPage({ schedule_type: 'whenever' });
    expect(initialFilters).not.toHaveProperty('schedule_type');
    expect(fetchedQuery()).not.toHaveProperty('schedule_type');
  });

  it('accepts the location_lat / location_lng aliases', async () => {
    const { initialFilters } = await renderPage({ location_lat: '30.27', location_lng: '-97.74' });
    expect(initialFilters.location_lat).toBe(30.27);
    expect(initialFilters.location_lng).toBe(-97.74);
    expect(fetchedQuery()).toMatchObject({ latitude: '30.27', longitude: '-97.74' });
  });

  it.each<[string, SearchParams]>([
    ['latitude only', { latitude: '47.6' }],
    ['longitude only', { longitude: '-122.3' }],
    ['empty latitude', { latitude: '', longitude: '-122.3' }],
    ['empty longitude', { latitude: '47.6', longitude: '' }],
    ['non-numeric latitude', { latitude: 'north', longitude: '-122.3' }],
    ['non-numeric longitude', { latitude: '47.6', longitude: 'west' }],
  ])('sets no location for %s', async (_label, params) => {
    const { initialFilters } = await renderPage(params);
    expect(initialFilters).not.toHaveProperty('location_lat');
    expect(initialFilters).not.toHaveProperty('location_lng');
    expect(fetchedQuery()).not.toHaveProperty('latitude');
    expect(fetchedQuery()).not.toHaveProperty('longitude');
  });

  it('only treats is_recurring=true as recurring', async () => {
    const { initialFilters } = await renderPage({ is_recurring: '1' });
    expect(initialFilters).not.toHaveProperty('is_recurring');
    expect(fetchedQuery()).not.toHaveProperty('recurring_only');
  });
});

describe('/jobs page — seeding the client island', () => {
  const job = { id: 'job-1', title: 'Fix sink' } as Job;
  const pagination: JobsResponse['pagination'] = {
    totalCount: 1,
    page: 1,
    pageSize: 12,
    totalPages: 1,
    hasNext: false,
  };

  it('seeds the fetched jobs and pagination', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ jobs: [job], pagination }));
    const { initialJobs } = await renderPage({});
    expect(initialJobs).toEqual({ jobs: [job], pagination });
  });

  it('normalises a 200 body with null jobs / pagination to an empty catalog', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ jobs: null, pagination: null }));
    const { initialJobs } = await renderPage({});
    expect(initialJobs).toEqual({ jobs: [], pagination: DEFAULT_PAGINATION });
  });

  it('normalises a 200 body with the fields missing', async () => {
    serverFetch.mockResolvedValue(jsonResponse({}));
    const { initialJobs } = await renderPage({});
    expect(initialJobs).toEqual({ jobs: [], pagination: DEFAULT_PAGINATION });
  });

  it('seeds null — not an empty catalog — on a non-OK response', async () => {
    serverFetch.mockResolvedValue(jsonResponse({ error: 'down' }, 503));
    const { initialJobs, initialFilters } = await renderPage({ q: 'roof' });
    expect(initialJobs).toBeNull();
    // Filters still reach the island so the client retry hits the same query.
    expect(initialFilters.query).toBe('roof');
  });

  it('seeds null when the fetch throws', async () => {
    serverFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const { initialJobs } = await renderPage({});
    expect(initialJobs).toBeNull();
  });

  it('seeds null when the body is not JSON', async () => {
    serverFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 200 }));
    const { initialJobs } = await renderPage({});
    expect(initialJobs).toBeNull();
  });
});

describe('/jobs page — metadata', () => {
  it('exports matching page and Open Graph titles with the fee promise in the description', async () => {
    const { metadata } = await loadPage();
    const { BUYER_PAYS_AGREED_PRICE } = await import('@/lib/constants');

    expect(metadata.title).toBe('Find Jobs · NoMarkup');
    expect(metadata.openGraph?.title).toBe('Find Jobs · NoMarkup');
    expect(metadata.description).toContain(BUYER_PAYS_AGREED_PRICE);
    expect(metadata.openGraph?.description).toContain(BUYER_PAYS_AGREED_PRICE);
  });
});
