import type { Metadata } from 'next';

import { JobsSearchClient } from './JobsSearchClient';
import type { Job, JobsResponse, SearchJobsParams } from '@/types';

// Server-side API origin. Mirror marketplace browse: prefer server-only
// API_URL, fall back to public var, then localhost for dev. Jobs search is a
// public read (no auth/cookies).
const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';

const DEFAULT_PAGE_SIZE = 12;

export const metadata: Metadata = {
  title: 'Find Jobs · NoMarkup',
  description:
    'Browse open home-service jobs. Qualified providers compete in reverse auctions — fair market rates, not the markup.',
  openGraph: {
    title: 'Find Jobs · NoMarkup',
    description:
      'Reverse-auction home services. Providers compete on price. The market sets the rate — not the markup.',
    type: 'website',
  },
};

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

function paramsFromSearch(
  searchParams: Record<string, string | string[] | undefined>,
): SearchJobsParams {
  const out: SearchJobsParams = {
    page: parseIntParam(searchParams['page']) ?? 1,
    page_size: parseIntParam(searchParams['page_size']) ?? DEFAULT_PAGE_SIZE,
  };

  const q = first(searchParams['q']);
  if (q && q.trim().length > 0) out.query = q;

  const categoryId = first(searchParams['category_id']);
  if (categoryId) out.category_id = categoryId;

  const scheduleType = first(searchParams['schedule_type']);
  if (
    scheduleType === 'flexible' ||
    scheduleType === 'specific_date' ||
    scheduleType === 'date_range'
  ) {
    out.schedule_type = scheduleType;
  }

  const minPrice = parseIntParam(searchParams['min_price_cents']);
  if (minPrice !== undefined) out.min_price_cents = minPrice;

  const maxPrice = parseIntParam(searchParams['max_price_cents']);
  if (maxPrice !== undefined) out.max_price_cents = maxPrice;

  const radiusKm = parseIntParam(searchParams['radius_km']);
  if (radiusKm !== undefined) out.radius_km = radiusKm;

  if (first(searchParams['is_recurring']) === 'true') out.is_recurring = true;

  return out;
}

// Mirror useJobs.buildSearchParams so the server-seeded fetch and the client
// refetch hit identical URLs (TanStack cache key lines up).
function queryStringFor(params: SearchJobsParams): string {
  const sp = new URLSearchParams();
  if (params.category_id) sp.set('category_ids', params.category_id);
  if (params.query) sp.set('q', params.query);
  if (params.schedule_type) sp.set('schedule_type', params.schedule_type);
  if (params.is_recurring) sp.set('recurring_only', 'true');
  if (params.min_price_cents !== undefined)
    sp.set('min_price_cents', String(params.min_price_cents));
  if (params.max_price_cents !== undefined)
    sp.set('max_price_cents', String(params.max_price_cents));
  if (params.location_lat !== undefined) sp.set('latitude', String(params.location_lat));
  if (params.location_lng !== undefined) sp.set('longitude', String(params.location_lng));
  if (params.radius_km !== undefined) sp.set('radius_km', String(params.radius_km));
  if (params.sort_by) sp.set('sort', params.sort_by);
  if (params.sort_order) sp.set('sort_dir', params.sort_order);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.page_size !== undefined) sp.set('page_size', String(params.page_size));
  return sp.toString();
}

const EMPTY_RESPONSE: JobsResponse = {
  jobs: [],
  pagination: {
    totalCount: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalPages: 0,
    hasNext: false,
  },
};

/**
 * Server-fetch the public jobs list. 30s revalidate (CLAUDE.md §14) — long
 * enough for edge cache hits, short enough that first paint is not badly
 * stale. Client island refetches on filter change. Empty response on error
 * so the page never throws (graceful degrade).
 */
async function fetchJobs(queryString: string): Promise<JobsResponse> {
  try {
    const url = queryString
      ? `${API_URL}/api/v1/jobs?${queryString}`
      : `${API_URL}/api/v1/jobs`;
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return EMPTY_RESPONSE;
    const body = (await res.json()) as {
      jobs?: Job[] | null;
      pagination?: JobsResponse['pagination'] | null;
    };
    return {
      jobs: body.jobs ?? [],
      pagination: body.pagination ?? EMPTY_RESPONSE.pagination,
    };
  } catch {
    return EMPTY_RESPONSE;
  }
}

export default async function JobsSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialFilters = paramsFromSearch(sp);
  const initialJobs = await fetchJobs(queryStringFor(initialFilters));
  return (
    <JobsSearchClient initialJobs={initialJobs} initialFilters={initialFilters} />
  );
}
