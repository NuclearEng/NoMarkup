'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSearchJobs } from '@/hooks/useJobs';
import { formatCents } from '@/lib/utils';
import type { SearchJobsParams } from '@/types';

export default function JobsMapPage() {
  const [filters] = useState<SearchJobsParams>({
    page: 1,
    page_size: 20,
    status: 'active',
  });

  const { data, isLoading, isError } = useSearchJobs(filters);

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

      {/* Map placeholder */}
      <div className="mb-8 flex min-h-[400px] items-center justify-center rounded-xl border-2 border-dashed bg-muted/50">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">
            Interactive Map
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure NEXT_PUBLIC_MAPBOX_TOKEN to enable the interactive job map
          </p>
        </div>
      </div>

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
