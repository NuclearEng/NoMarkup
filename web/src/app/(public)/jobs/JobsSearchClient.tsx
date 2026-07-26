'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { JobCard } from '@/components/jobs/JobCard';
import { JobSearchFilters } from '@/components/jobs/JobSearchFilters';
import { SeasonalDemandBanner } from '@/components/jobs/SeasonalDemandBanner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { useSearchJobs } from '@/hooks/useJobs';
import type { JobsResponse, SearchJobsParams } from '@/types';

const DEFAULT_PAGE_SIZE = 12;

function SearchIllustration() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="22"
        cy="22"
        r="14"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M32 32L42 42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M16 22H28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M16 17H24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.3"
      />
      <path
        d="M16 27H22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}

export interface JobsSearchClientProps {
  /** Server-seeded first page (RSC) so first paint skips the skeleton. */
  initialJobs?: JobsResponse;
  /** Filters used for the server seed — keeps TanStack query key aligned. */
  initialFilters?: SearchJobsParams;
}

export function JobsSearchClient({
  initialJobs,
  initialFilters,
}: JobsSearchClientProps) {
  const [filters, setFilters] = useState<SearchJobsParams>(
    initialFilters ?? {
      page: 1,
      page_size: DEFAULT_PAGE_SIZE,
    },
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Seed only when the query key still matches the server-fetched filters
  // (same pattern as marketplace ListingBrowseClient).
  const seedMatches =
    initialJobs !== undefined &&
    initialFilters !== undefined &&
    filters.page === initialFilters.page &&
    filters.page_size === initialFilters.page_size &&
    filters.query === initialFilters.query &&
    filters.category_id === initialFilters.category_id &&
    filters.schedule_type === initialFilters.schedule_type &&
    filters.min_price_cents === initialFilters.min_price_cents &&
    filters.max_price_cents === initialFilters.max_price_cents &&
    filters.radius_km === initialFilters.radius_km &&
    filters.is_recurring === initialFilters.is_recurring;

  const { data, isLoading, isError, refetch } = useSearchJobs(
    filters,
    // `seedMatches` already requires initialJobs !== undefined, and TS narrows
    // through the const boolean alias, so re-checking it here is redundant.
    seedMatches ? { initialData: initialJobs } : undefined,
  );

  const currentPage = filters.page ?? 1;
  const totalPages = data?.pagination.totalPages ?? 1;

  const hasActiveFilters =
    filters.query !== undefined ||
    filters.category_id !== undefined ||
    filters.schedule_type !== undefined ||
    filters.min_price_cents !== undefined ||
    filters.max_price_cents !== undefined ||
    filters.radius_km !== undefined ||
    filters.is_recurring !== undefined;

  // With server seed, TanStack treats initialData as settled — isLoading is
  // false on first paint. Without seed, show skeletons while loading.
  const showSkeleton = isLoading && !data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="animate-fade-in-up mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100">
          Find <span className="gold-text">Jobs</span>
        </h1>
        <p className="mt-2 text-lg text-zinc-300">
          Reverse auctions for home services. Providers compete — fair market rates, not the markup.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Mobile filter toggle */}
        <div className="lg:hidden">
          <Button
            variant="outline"
            className="min-h-[44px] w-full justify-between border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
            onClick={() => {
              setFiltersOpen(!filtersOpen);
            }}
            aria-expanded={filtersOpen}
            aria-controls="job-filters-panel"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters
              {hasActiveFilters ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[10px] font-semibold text-black">
                  !
                </span>
              ) : null}
            </span>
            {filtersOpen ? <X className="h-4 w-4" aria-hidden="true" /> : null}
          </Button>
        </div>

        {/* Filters sidebar */}
        <aside
          id="job-filters-panel"
          className={`w-full shrink-0 lg:block lg:w-72 ${filtersOpen ? 'block' : 'hidden'}`}
        >
          <div className="glass glass-highlight animate-fade-in sticky top-6 rounded-xl border border-[var(--brand-gold)]/10 p-4">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Filters
            </h2>
            <div className="stagger-children">
              <JobSearchFilters filters={filters} onChange={setFilters} />
            </div>
          </div>
        </aside>

        {/* Results */}
        <div className="flex-1">
          {showSkeleton ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`skeleton-${String(i)}`}
                  className="glass glass-highlight animate-pulse rounded-xl border border-[var(--brand-gold)]/10 p-5"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="h-5 w-16 rounded-full bg-white/[0.06]" />
                    <div className="h-4 w-12 rounded bg-white/[0.06]" />
                  </div>
                  <div className="mb-2 h-5 w-3/4 rounded bg-white/[0.06]" />
                  <div className="mb-4 space-y-2">
                    <div className="h-3 w-full rounded bg-white/[0.06]" />
                    <div className="h-3 w-5/6 rounded bg-white/[0.06]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-white/[0.06]" />
                    <div className="h-3 w-24 rounded bg-white/[0.06]" />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-white/[0.06]" />
                    <div className="h-3 w-20 rounded bg-white/[0.06]" />
                  </div>
                  <div className="glass-divider mt-4 mb-3" />
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-20 rounded bg-white/[0.06]" />
                    <div className="h-3 w-16 rounded bg-white/[0.06]" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError && !data ? (
            <EmptyState
              icon={
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M12 12L20 20M20 12L12 20"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
              title="Failed to load jobs"
              description="Something went wrong while fetching jobs. Check your connection and try again."
              action={
                <Button
                  variant="default"
                  className="min-h-[44px]"
                  onClick={() => {
                    void refetch();
                  }}
                >
                  Retry
                </Button>
              }
              className="border-destructive/30"
            />
          ) : !data?.jobs.length ? (
            <EmptyState
              icon={<SearchIllustration />}
              title="No jobs found"
              description={
                hasActiveFilters
                  ? 'No jobs match your current filters. Try broadening your search or clearing some filters.'
                  : 'No open jobs right now. Check back soon — or post one and let the market set the price.'
              }
              action={
                hasActiveFilters ? (
                  <Button
                    variant="default"
                    className="min-h-[44px]"
                    onClick={() => {
                      setFilters({ page: 1, page_size: DEFAULT_PAGE_SIZE });
                    }}
                  >
                    Clear All Filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              {/* Results count */}
              <p className="mb-4 text-sm text-zinc-400">
                {String(data.pagination.totalCount)} job
                {data.pagination.totalCount !== 1 ? 's' : ''} found
              </p>

              {/* Seasonal demand banner — derived from first result's category slug */}
              {data.jobs[0]?.category_slug ? (
                <div className="mb-4">
                  <SeasonalDemandBanner categorySlug={data.jobs[0].category_slug} />
                </div>
              ) : null}

              {/* Job cards grid */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 ? (
                <nav
                  aria-label="Search results pagination"
                  className="mt-8 flex items-center justify-center gap-2"
                >
                  <Button
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => {
                      setFilters({ ...filters, page: currentPage - 1 });
                    }}
                    className="min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                  >
                    Previous
                  </Button>
                  <span className="px-4 text-sm text-zinc-400">
                    Page {String(currentPage)} of {String(totalPages)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={!data.pagination.hasNext}
                    onClick={() => {
                      setFilters({ ...filters, page: currentPage + 1 });
                    }}
                    className="min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                  >
                    Next
                  </Button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default JobsSearchClient;
