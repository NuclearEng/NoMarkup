'use client';

import { Calendar, MapPin, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { Job } from '@/types';
import { JOB_STATUS } from '@/types';

import { AuctionTimer } from './AuctionTimer';

interface JobCardProps {
  job: Job;
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case JOB_STATUS.ACTIVE:
      return 'default';
    case JOB_STATUS.DRAFT:
      return 'secondary';
    case JOB_STATUS.CANCELLED:
    case JOB_STATUS.EXPIRED:
      return 'destructive';
    default:
      return 'outline';
  }
}

/** Left border color by job status */
function getStatusBorderColor(status: string): string {
  switch (status) {
    case JOB_STATUS.ACTIVE:
      return 'border-l-emerald-500 dark:border-l-emerald-400';
    case JOB_STATUS.AWARDED:
    case JOB_STATUS.CONTRACT_PENDING:
      return 'border-l-blue-500 dark:border-l-blue-400';
    case JOB_STATUS.IN_PROGRESS:
      return 'border-l-amber-500 dark:border-l-amber-400';
    case JOB_STATUS.COMPLETED:
    case JOB_STATUS.REVIEWED:
      return 'border-l-emerald-600 dark:border-l-emerald-500';
    case JOB_STATUS.CANCELLED:
    case JOB_STATUS.EXPIRED:
      return 'border-l-red-400 dark:border-l-red-500';
    default:
      return 'border-l-border';
  }
}

/** Determine if the auction is ending soon (< 4 hours) */
function getAuctionUrgency(auctionEndsAt: string | null): 'none' | 'warning' | 'critical' {
  if (!auctionEndsAt) return 'none';
  const remaining = new Date(auctionEndsAt).getTime() - Date.now();
  if (remaining <= 0) return 'none';
  if (remaining < 60 * 60 * 1000) return 'critical'; // < 1 hour
  if (remaining < 4 * 60 * 60 * 1000) return 'warning'; // < 4 hours
  return 'none';
}

/** Calculate auction elapsed percentage */
function getAuctionElapsedPercent(
  createdAt: string,
  auctionEndsAt: string | null,
  auctionDurationHours: number,
): number {
  if (!auctionEndsAt) return 0;
  const now = Date.now();
  const endMs = new Date(auctionEndsAt).getTime();
  // Compute start from duration
  const startMs = endMs - auctionDurationHours * 60 * 60 * 1000;
  const totalDuration = endMs - startMs;
  if (totalDuration <= 0) return 100;
  const elapsed = now - startMs;
  return Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
}

export function JobCard({ job }: JobCardProps) {
  const urgency = useMemo(
    () => getAuctionUrgency(job.auction_ends_at),
    [job.auction_ends_at],
  );

  const elapsedPercent = useMemo(
    () => getAuctionElapsedPercent(job.created_at, job.auction_ends_at, job.auction_duration_hours),
    [job.created_at, job.auction_ends_at, job.auction_duration_hours],
  );

  const urgencyBgTint = cn(
    urgency === 'critical' && 'bg-red-500/[0.03] dark:bg-red-500/[0.05]',
    urgency === 'warning' && 'bg-amber-500/[0.02] dark:bg-amber-500/[0.04]',
  );

  return (
    <Link href={`/jobs/${job.id}` as Route} className="block">
      <Card
        className={cn(
          'relative overflow-hidden border-l-[3px] transition-all duration-200',
          'hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg',
          getStatusBorderColor(job.status),
          urgencyBgTint,
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-base font-semibold leading-snug">{job.title}</h3>
            <Badge variant={getStatusVariant(job.status)} className="shrink-0">
              {job.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Category */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{job.category_name}</span>
          </div>

          {/* Location */}
          {job.location_address ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="truncate">{job.location_address}</span>
            </div>
          ) : null}

          {/* Schedule */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {job.schedule_type === 'specific_date' && job.scheduled_date
                ? new Date(job.scheduled_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : job.schedule_type === 'flexible'
                  ? 'Flexible Schedule'
                  : 'Date Range'}
            </span>
            {job.is_recurring ? (
              <Badge variant="outline" className="text-xs">
                Recurring
              </Badge>
            ) : null}
          </div>

          {/* Bid count and starting bid */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-medium">
                {String(job.bid_count)}
              </span>
              <span>
                bid{job.bid_count !== 1 ? 's' : ''}
              </span>
            </div>
            {job.starting_bid_cents ? (
              <span className="text-sm font-medium text-muted-foreground">
                From {formatCents(job.starting_bid_cents)}
              </span>
            ) : null}
          </div>

          {/* Lowest bid - prominent display */}
          {job.lowest_bid_cents ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Lowest:</span>
              <span
                className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                style={{ textShadow: '0 0 12px rgba(16,185,129,0.15)' }}
              >
                {formatCents(job.lowest_bid_cents)}
              </span>
            </div>
          ) : null}

          {/* Auction timer + posted time */}
          <div className="flex items-center justify-between border-t pt-3">
            {job.auction_ends_at ? (
              <AuctionTimer auctionEndsAt={job.auction_ends_at} compact />
            ) : (
              <span className="text-xs text-muted-foreground">No auction</span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(new Date(job.created_at))}
            </span>
          </div>
        </CardContent>

        {/* Auction elapsed progress bar at bottom */}
        {job.auction_ends_at && elapsedPercent > 0 ? (
          <div
            className="h-[3px] w-full bg-muted/60"
            role="progressbar"
            aria-valuenow={elapsedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Auction ${String(elapsedPercent)}% elapsed`}
          >
            <div
              className={cn(
                'h-full animate-auction-elapsed rounded-r-full transition-colors duration-300',
                elapsedPercent >= 80
                  ? 'bg-red-500/70'
                  : elapsedPercent >= 50
                    ? 'bg-amber-500/60'
                    : 'bg-emerald-500/50',
              )}
              style={{ width: `${String(elapsedPercent)}%` }}
            />
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
