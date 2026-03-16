'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSearchJobs } from '@/hooks/useJobs';
import { formatCents } from '@/lib/utils';
import type { Job, SearchJobsParams } from '@/types';

// Dynamic import with ssr: false — Mapbox GL needs browser APIs
const JobMap = dynamic(
  () => import('@/components/maps/JobMap').then((mod) => mod.JobMap),
  { ssr: false },
);

export default function JobsMapPage() {
  const [filters] = useState<SearchJobsParams>({
    page: 1,
    page_size: 50,
    status: 'active',
  });

  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { data, isLoading, isError } = useSearchJobs(filters);

  const handleJobSelect = useCallback((job: Job) => {
    setSelectedJob(job);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job Map</h1>
          <p className="mt-1 text-muted-foreground">
            Browse jobs by location
          </p>
        </div>
        <Link href="/jobs">
          <Button variant="outline" className="min-h-[44px]">
            List View
          </Button>
        </Link>
      </div>

      {/* Map */}
      {isLoading ? (
        <div className="mb-8 flex min-h-[400px] items-center justify-center rounded-xl border bg-muted/50">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-2 text-sm text-muted-foreground">Loading jobs...</p>
          </div>
        </div>
      ) : isError ? (
        <div className="mb-8 flex min-h-[400px] items-center justify-center rounded-xl border border-destructive/50 bg-destructive/5">
          <p className="text-destructive">Failed to load job data for the map.</p>
        </div>
      ) : (
        <JobMap
          jobs={data?.jobs ?? []}
          className="mb-8"
          onJobSelect={handleJobSelect}
        />
      )}

      {/* Selected job detail */}
      {selectedJob ? (
        <div className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Selected Job</h2>
          <Link href={`/jobs/${selectedJob.id}`} className="block">
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold">{selectedJob.title}</h3>
                    <p className="text-sm text-muted-foreground">{selectedJob.category_name}</p>
                    {selectedJob.location_address ? (
                      <p className="mt-1 text-sm text-muted-foreground">{selectedJob.location_address}</p>
                    ) : null}
                    <p className="mt-2 line-clamp-2 text-sm">{selectedJob.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="secondary">
                      {String(selectedJob.bid_count)} bid{selectedJob.bid_count !== 1 ? 's' : ''}
                    </Badge>
                    {selectedJob.starting_bid_cents ? (
                      <span className="text-sm font-semibold">
                        {formatCents(selectedJob.starting_bid_cents)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      ) : null}

      {/* Job list fallback */}
      <h2 className="mb-4 text-xl font-bold">Jobs Near You</h2>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="h-32 animate-pulse rounded-xl border bg-muted"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/50 p-8 text-center">
          <p className="text-destructive">Failed to load jobs.</p>
        </div>
      ) : !data?.jobs.length ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">No active jobs found.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <h3 className="font-semibold">{job.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {job.category_name}
                  </p>
                  {job.location_address ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {job.location_address}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="secondary">
                      {String(job.bid_count)} bid{job.bid_count !== 1 ? 's' : ''}
                    </Badge>
                    {job.starting_bid_cents ? (
                      <span className="text-sm font-medium">
                        Up to {formatCents(job.starting_bid_cents)}
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
