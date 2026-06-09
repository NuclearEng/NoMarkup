'use client';

import { Calendar, MapPin, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn, formatCents, formatRelativeTime } from '@/lib/utils';
import type { Job } from '@/types';
import { JOB_STATUS } from '@/types';

import { AuctionTimer } from './AuctionTimer';
import { FairPriceWidget } from './FairPriceWidget';

interface JobCardProps {
  job: Job;
}

function getStatusVariant(
  status: string,
):
  | 'active'
  | 'draft'
  | 'awarded'
  | 'in-progress'
  | 'completed'
  | 'disputed'
  | 'cancelled'
  | 'secondary' {
  switch (status) {
    case JOB_STATUS.ACTIVE:
      return 'active';
    case JOB_STATUS.DRAFT:
      return 'draft';
    case JOB_STATUS.AWARDED:
    case JOB_STATUS.CONTRACT_PENDING:
      return 'awarded';
    case JOB_STATUS.IN_PROGRESS:
      return 'in-progress';
    case JOB_STATUS.COMPLETED:
    case JOB_STATUS.REVIEWED:
      return 'completed';
    case JOB_STATUS.SUSPENDED:
      return 'disputed';
    case JOB_STATUS.CANCELLED:
    case JOB_STATUS.EXPIRED:
      return 'cancelled';
    default:
      return 'secondary';
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

export const JobCard = memo(function JobCard({ job }: JobCardProps) {
  // Gates time-derived output (elapsed-% bar + relative timestamp) to post-mount.
  // Both read `Date.now()`/`new Date()`, so an SSR value differs from the client's
  // first render → hydration mismatch. Render neutral placeholders until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const _urgency = useMemo(() => getAuctionUrgency(job.auction_ends_at), [job.auction_ends_at]);

  const elapsedPercent = useMemo(
    () =>
      mounted
        ? getAuctionElapsedPercent(
            job.created_at,
            job.auction_ends_at,
            job.auction_duration_hours,
          )
        : 0,
    [mounted, job.created_at, job.auction_ends_at, job.auction_duration_hours],
  );

  return (
    <Link href={`/jobs/${job.id}` as Route} className="block">
      <Card
        variant="glass"
        className={cn(
          'glass-interactive glass-highlight relative overflow-hidden border border-l-[3px] border-[var(--brand-gold)]/10',
          getStatusBorderColor(job.status),
        )}
      >
        <CardHeader className="relative z-[2] pb-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 text-base leading-snug font-semibold break-words text-zinc-100">
              {job.title}
            </h3>
            <Badge variant={getStatusVariant(job.status)} className="shrink-0">
              {job.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="relative z-[2] space-y-3">
          {/* Category */}
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Tag className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
            <span>{job.category_name || 'Uncategorized'}</span>
          </div>

          {/* Location */}
          {job.location_address ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <MapPin className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
              <span className="truncate">{job.location_address}</span>
            </div>
          ) : null}

          {/* Schedule */}
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Calendar className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
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
            <div className="flex items-center gap-1.5 text-sm text-zinc-300">
              <Users className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
              <span className="font-medium">{String(job.bid_count)}</span>
              <span className="text-zinc-400">bid{job.bid_count !== 1 ? 's' : ''}</span>
            </div>
            {job.starting_bid_cents ? (
              <span className="text-sm font-medium text-zinc-300">
                From {formatCents(job.starting_bid_cents)}
              </span>
            ) : null}
          </div>

          {/* Lowest bid - prominent display with emerald glow */}
          {job.lowest_bid_cents ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-zinc-500">Lowest:</span>
              <span
                className="text-lg font-bold text-emerald-400 tabular-nums"
                style={{
                  textShadow: '0 0 16px rgba(16,185,129,0.3), 0 0 32px rgba(16,185,129,0.1)',
                }}
              >
                {formatCents(job.lowest_bid_cents)}
              </span>
            </div>
          ) : null}

          {/* Fair price widget */}
          <FairPriceWidget
            categoryId={job.category_id}
            currentLowestBidCents={job.lowest_bid_cents}
          />

          {/* Auction timer + posted time — glass divider above */}
          <div className="pt-3">
            <div className="glass-divider mb-3" aria-hidden="true" />
            <div className="flex items-center justify-between">
              {job.auction_ends_at ? (
                <AuctionTimer auctionEndsAt={job.auction_ends_at} compact />
              ) : (
                <span className="text-xs text-zinc-500">No auction</span>
              )}
              <span className="text-xs text-zinc-500" suppressHydrationWarning>
                {mounted ? formatRelativeTime(new Date(job.created_at)) : null}
              </span>
            </div>
          </div>
        </CardContent>

        {/* Auction elapsed progress bar at bottom */}
        {job.auction_ends_at && elapsedPercent > 0 ? (
          <div
            className="h-[3px] w-full bg-white/[0.06]"
            role="progressbar"
            aria-valuenow={elapsedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Auction ${String(elapsedPercent)}% elapsed`}
          >
            <div
              className={cn(
                'animate-auction-elapsed h-full rounded-r-full transition-colors duration-300',
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
});
