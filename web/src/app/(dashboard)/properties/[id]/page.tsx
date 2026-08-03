'use client';

import { ArrowLeft, Briefcase } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { JobCard } from '@/components/jobs/JobCard';
import { PreferredProvidersSection } from '@/components/properties/PreferredProvidersSection';
import { PropertySpendLabel } from '@/components/properties/PropertySpendLabel';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomerJobs } from '@/hooks/useJobs';
import { usePreferredProviders, useProperties } from '@/hooks/useProperties';
import type { Job } from '@/types';
import { JOB_STATUS } from '@/types';

const HISTORY_DATE_RANGES = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
] as const;

type HistoryDateRange = (typeof HISTORY_DATE_RANGES)[number]['value'];

function isActiveWork(job: Job): boolean {
  return job.status === JOB_STATUS.ACTIVE || job.status === JOB_STATUS.IN_PROGRESS;
}

function isUpcomingWork(job: Job): boolean {
  return job.status === JOB_STATUS.AWARDED || job.status === JOB_STATUS.CONTRACT_PENDING;
}

function isHistoryWork(job: Job): boolean {
  return !isActiveWork(job) && !isUpcomingWork(job);
}

/** Inclusive lower bound for created_at as ISO string; undefined = no bound. */
function dateFromForRange(range: HistoryDateRange): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export default function PropertyDetailPage() {
  const params = useParams();
  const propertyId = typeof params['id'] === 'string' ? params['id'] : '';

  const { data: properties, isLoading: propsLoading, isError: propsError, refetch } =
    useProperties();
  const property = properties?.find((p) => p.id === propertyId);

  const preferred = usePreferredProviders({
    propertyId,
    usePropertyPath: true,
    enabled: Boolean(propertyId),
  });

  // Unfiltered property jobs — keeps active/upcoming complete (FR-19.3).
  const jobsQuery = useCustomerJobs({
    property_id: propertyId || undefined,
    page_size: 100,
    enabled: Boolean(propertyId),
  });

  const [historyCategoryId, setHistoryCategoryId] = useState('');
  const [historyDateRange, setHistoryDateRange] = useState<HistoryDateRange>('all');

  const hasActiveHistoryFilters =
    historyCategoryId !== '' || historyDateRange !== 'all';
  const dateFrom = dateFromForRange(historyDateRange);

  // Server-filtered history when filters are active (soft-fail to client filter).
  const filteredHistoryQuery = useCustomerJobs({
    property_id: propertyId || undefined,
    category_id: historyCategoryId || undefined,
    date_from: dateFrom,
    page_size: 100,
    enabled: Boolean(propertyId) && hasActiveHistoryFilters,
  });

  const allJobs = jobsQuery.data?.jobs ?? [];
  const activeJobs = useMemo(() => allJobs.filter(isActiveWork), [allJobs]);
  const upcomingJobs = useMemo(() => allJobs.filter(isUpcomingWork), [allJobs]);
  const historyJobs = useMemo(() => allJobs.filter(isHistoryWork), [allJobs]);

  const historyCategoryOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const job of historyJobs) {
      const id = job.category_id?.trim() ?? '';
      const name = job.category_name?.trim() ?? '';
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, name || id);
      }
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [historyJobs]);

  const filteredHistoryJobs = useMemo(() => {
    let base: Job[];
    if (hasActiveHistoryFilters && filteredHistoryQuery.isSuccess && filteredHistoryQuery.data) {
      base = filteredHistoryQuery.data.jobs.filter(isHistoryWork);
    } else {
      base = historyJobs;
    }
    // Client re-apply so filters stay correct if server filter soft-fails.
    return base.filter((job) => {
      if (historyCategoryId) {
        if ((job.category_id ?? '') !== historyCategoryId) return false;
      }
      if (dateFrom) {
        const created = Date.parse(job.created_at);
        if (!Number.isFinite(created) || created < Date.parse(dateFrom)) return false;
      }
      return true;
    });
  }, [
    hasActiveHistoryFilters,
    filteredHistoryQuery.isSuccess,
    filteredHistoryQuery.data,
    historyJobs,
    historyCategoryId,
    dateFrom,
  ]);

  function clearHistoryFilters() {
    setHistoryCategoryId('');
    setHistoryDateRange('all');
  }

  if (propsLoading) {
    return (
      <PageTransition>
        <ContentLoader preset="contract-card" count={2} className="space-y-4" />
      </PageTransition>
    );
  }

  if (propsError) {
    return (
      <PageTransition>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load property"
          description="Something went wrong. Check your connection and try again."
          action={
            <Button
              className="min-h-[44px]"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          }
          className="glass border-destructive/30"
        />
      </PageTransition>
    );
  }

  if (!property) {
    return (
      <PageTransition>
        <EmptyState
          icon={<AnimatedIllustration type="no-properties" size="sm" />}
          title="Property not found"
          description="This property may have been removed or you don’t have access."
          action={
            <Link href={'/properties' as Route}>
              <Button className="min-h-[44px]">Back to properties</Button>
            </Link>
          }
          className="glass"
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Link
              href={'/properties' as Route}
              className="inline-flex min-h-11 items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All properties
            </Link>
            <div>
              <h1 className="gold-text text-2xl font-bold tracking-tight">
                {property.nickname}
              </h1>
              <p className="mt-1 text-sm text-zinc-300">
                {property.address.street}, {property.address.city}, {property.address.state}{' '}
                {property.address.zip_code}
              </p>
              {property.notes ? (
                <p className="mt-1 text-xs text-zinc-400">{property.notes}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {String(property.active_jobs ?? 0)} active job
              {(property.active_jobs ?? 0) !== 1 ? 's' : ''}
            </Badge>
            <PropertySpendLabel propertyId={property.id} />
          </div>
        </div>

        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-zinc-100">Spend · this property</CardTitle>
            <p className="text-xs text-zinc-400">
              Completed service payments for jobs linked to this address (trailing 12 months).
            </p>
          </CardHeader>
          <CardContent>
            <PropertySpendLabel propertyId={property.id} detailed />
          </CardContent>
        </Card>

        <PreferredProvidersSection
          providers={preferred.data?.providers}
          isLoading={preferred.isLoading}
          isError={preferred.isError}
          preferredThreshold={
            preferred.data?.preferred_threshold ?? undefined
          }
          scope="property"
        />

        {jobsQuery.isLoading ? (
          <ContentLoader preset="job-card" count={3} className="grid gap-4 sm:grid-cols-2" />
        ) : jobsQuery.isError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load jobs"
            description="Could not load jobs for this property."
            action={
              <Button
                className="min-h-[44px]"
                onClick={() => {
                  void jobsQuery.refetch();
                }}
              >
                Retry
              </Button>
            }
            className="glass border-destructive/30"
          />
        ) : allJobs.length === 0 ? (
          <EmptyState
            icon={<AnimatedIllustration type="no-jobs" size="sm" />}
            title="No jobs yet"
            description="No jobs linked to this property yet. Post a reverse-auction job and pick this address."
            action={
              <Link href={'/jobs/new' as Route}>
                <Button className="min-h-[44px]">
                  <Briefcase className="mr-2 h-4 w-4" aria-hidden="true" />
                  Post a job
                </Button>
              </Link>
            }
            className="glass"
          />
        ) : (
          <>
            {activeJobs.length > 0 ? (
              <JobSection title={`Active (${String(activeJobs.length)})`} jobs={activeJobs} />
            ) : null}
            {upcomingJobs.length > 0 ? (
              <JobSection
                title={`Upcoming (${String(upcomingJobs.length)})`}
                jobs={upcomingJobs}
              />
            ) : null}

            {historyJobs.length > 0 ? (
              <section className="space-y-4" aria-labelledby="history-heading">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 id="history-heading" className="text-lg font-semibold text-zinc-100">
                    {hasActiveHistoryFilters
                      ? `History (${String(filteredHistoryJobs.length)} of ${String(historyJobs.length)})`
                      : `History (${String(historyJobs.length)})`}
                  </h2>
                  {hasActiveHistoryFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={clearHistoryFilters}
                    >
                      Clear history filters
                    </Button>
                  ) : null}
                </div>

                <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-zinc-300">
                      Filter history
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="history-category">Category</Label>
                      <Select
                        value={historyCategoryId || 'all'}
                        onValueChange={(v) => {
                          setHistoryCategoryId(v === 'all' ? '' : v);
                        }}
                      >
                        <SelectTrigger
                          id="history-category"
                          className="min-h-[44px]"
                          aria-label="Filter history by category"
                        >
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All categories</SelectItem>
                          {historyCategoryOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="history-date">Date range</Label>
                      <Select
                        value={historyDateRange}
                        onValueChange={(v) => {
                          setHistoryDateRange(v as HistoryDateRange);
                        }}
                      >
                        <SelectTrigger
                          id="history-date"
                          className="min-h-[44px]"
                          aria-label="Filter history by date range"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HISTORY_DATE_RANGES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {filteredHistoryJobs.length === 0 ? (
                  <p className="text-sm text-zinc-400" role="status">
                    {hasActiveHistoryFilters
                      ? 'No history jobs match these filters. Clear category or date range to see all completed work.'
                      : 'No history jobs for this property.'}
                  </p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredHistoryJobs.map((job) => (
                      <JobCard key={job.id} job={job} />
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </PageTransition>
  );
}

function JobSection({ title, jobs }: { title: string; jobs: Job[] }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}
