'use client';

import { Calendar, Pause, Play, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCancelJob, useCustomerJobs, useUpdateJob } from '@/hooks/useJobs';
import { formatCents } from '@/lib/utils';
import type { Job } from '@/types';

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

function getNextOccurrence(job: Job): string {
  if (!job.scheduled_date) return 'Not scheduled';

  const scheduled = new Date(job.scheduled_date);
  const now = new Date();

  if (scheduled > now) {
    return scheduled.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // Calculate next occurrence based on frequency
  const freq = job.recurrence_frequency;
  const nextDate = new Date(scheduled);

  while (nextDate <= now) {
    switch (freq) {
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'biweekly':
        nextDate.setDate(nextDate.getDate() + 14);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      default:
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
    }
  }

  return nextDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function RecurringJobCard({ job }: { job: Job }) {
  const [isPaused, setIsPaused] = useState(false);
  const updateJob = useUpdateJob();
  const cancelJob = useCancelJob();

  const statusBadge = isPaused ? (
    <Badge variant="secondary">Paused</Badge>
  ) : (
    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      Active
    </Badge>
  );

  function handleTogglePause() {
    const newPaused = !isPaused;
    setIsPaused(newPaused);
    updateJob.mutate(
      { id: job.id, input: { is_recurring: !newPaused } },
      { onError: () => { setIsPaused(!newPaused); } },
    );
  }

  function handleCancel() {
    cancelJob.mutate(job.id);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/jobs/${job.id}`}
                className="truncate text-base font-semibold hover:underline"
              >
                {job.title}
              </Link>
              {statusBadge}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{job.category_name}</p>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                <span>{FREQUENCY_LABELS[job.recurrence_frequency ?? ''] ?? 'Unknown'}</span>
              </div>
              <span className="text-muted-foreground">
                Next: {getNextOccurrence(job)}
              </span>
              {job.starting_bid_cents ? (
                <span className="font-medium">
                  {formatCents(job.starting_bid_cents)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={handleTogglePause}
              disabled={updateJob.isPending}
              aria-label={isPaused ? 'Resume recurring job' : 'Pause recurring job'}
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? (
                <Play className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pause className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-destructive hover:text-destructive"
              onClick={handleCancel}
              disabled={cancelJob.isPending}
              aria-label="Cancel recurring job"
              title="Cancel"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecurringJobsPage() {
  const { data, isLoading, isError } = useCustomerJobs({ page: 1, page_size: 50 });

  // Filter to recurring jobs only
  const recurringJobs = data?.jobs.filter((job) => job.is_recurring) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recurring Jobs</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your recurring job schedules, pause, or cancel them.
          </p>
        </div>
        <Link href="/jobs/new">
          <Button className="min-h-[44px]">
            Post New Job
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-${String(i)}`} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-destructive">
              Failed to load recurring jobs. Please try again.
            </p>
          </CardContent>
        </Card>
      ) : recurringJobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto mb-3 h-12 w-12 text-muted-foreground" aria-hidden="true" />
            <p className="text-lg font-medium">No recurring jobs</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When you post a job and mark it as recurring, it will appear here.
            </p>
            <Link href="/jobs/new" className="mt-4 inline-block">
              <Button variant="outline" className="min-h-[44px]">
                Post a Recurring Job
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Recurring
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">{String(recurringJobs.length)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-emerald-400">
                  {String(recurringJobs.filter((j) => j.status === 'active' || j.status === 'in_progress').length)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Most Common
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {(() => {
                    const freqs = recurringJobs.map((j) => j.recurrence_frequency).filter(Boolean);
                    if (freqs.length === 0) return '--';
                    const counts = freqs.reduce<Record<string, number>>((acc, f) => {
                      if (f) acc[f] = (acc[f] ?? 0) + 1;
                      return acc;
                    }, {});
                    const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                    return mostCommon ? (FREQUENCY_LABELS[mostCommon[0]] ?? mostCommon[0]) : '--';
                  })()}
                </p>
                <p className="text-xs text-muted-foreground">frequency</p>
              </CardContent>
            </Card>
          </div>

          {/* Job list */}
          {recurringJobs.map((job) => (
            <RecurringJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
