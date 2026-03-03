'use client';

import { useState } from 'react';

import { JobCard } from '@/components/jobs/JobCard';
import { JobSearchFilters } from '@/components/jobs/JobSearchFilters';
import { Button } from '@/components/ui/button';
import { useSearchJobs } from '@/hooks/useJobs';
import type { SearchJobsParams } from '@/types';

const DEFAULT_PAGE_SIZE = 12;

export default function JobsSearchPage() {
  const [filters, setFilters] = useState<SearchJobsParams>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    status: 'active',
  });

  const { data, isLoading, isError } = useSearchJobs(filters);

  const currentPage = filters.page ?? 1;
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Find Jobs</h1>
        <p className="mt-1 text-muted-foreground">
          Browse available jobs and place your bids
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Filters sidebar */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="sticky top-6 rounded-lg border p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Filters
            </h2>
            <JobSearchFilters filters={filters} onChange={setFilters} />
          </div>
        </aside>

        {/* Results */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={`skeleton-${String(i)}`}
                  className="h-64 animate-pulse rounded-xl border bg-muted"
                />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/50 p-8 text-center">
              <p className="text-destructive">Failed to load jobs. Please try again.</p>
              <Button
                variant="outline"
                className="mt-4 min-h-[44px]"
                onClick={() => { setFilters({ ...filters }); }}
              >
                Retry
              </Button>
            </div>
          ) : !data?.jobs.length ? (
            <div className="rounded-lg border p-8 text-center">
              <p className="text-muted-foreground">
                No jobs found matching your criteria.
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-[44px]"
                onClick={() => {
                  setFilters({ page: 1, page_size: DEFAULT_PAGE_SIZE, status: 'active' });
                }}
              >
                Clear Filters
              </Button>
            </div>
          ) : (
            <>
              {/* Results count */}
              <p className="mb-4 text-sm text-muted-foreground">
                {String(data.pagination.totalCount)} job{data.pagination.totalCount !== 1 ? 's' : ''}{' '}
                found
              </p>

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
                    className="min-h-[44px]"
                  >
                    Previous
                  </Button>
                  <span className="px-4 text-sm text-muted-foreground">
                    Page {String(currentPage)} of {String(totalPages)}
                  </span>
                  <Button
                    variant="outline"
                    disabled={!data.pagination.hasNext}
                    onClick={() => {
                      setFilters({ ...filters, page: currentPage + 1 });
                    }}
                    className="min-h-[44px]"
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
