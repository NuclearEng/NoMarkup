'use client';

import { Calendar, MapPin, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MonoPrice } from '@/components/ui/mono-price';
import { cn, formatRelativeTime } from '@/lib/utils';
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
      return 'border-l-trust-high';
    case JOB_STATUS.AWARDED:
    case JOB_STATUS.CONTRACT_PENDING:
      return 'border-l-trust-elite';
    case JOB_STATUS.IN_PROGRESS:
      return 'border-l-status-in-progress';
    case JOB_STATUS.COMPLETED:
    case JOB_STATUS.REVIEWED:
      return 'border-l-status-completed';
    case JOB_STATUS.CANCELLED:
    case JOB_STATUS.EXPIRED:
      return 'border-l-destructive';
    default:
      return 'border-l-border';
  }
}

/**
 * Scoreboard urgency — aligned with marketplace ScoreboardCard bands so dual-rail
 * browse feels like one market (critical &lt;10m, urgent &lt;60m).
 */
function getAuctionUrgency(
  auctionEndsAt: string | null,
): 'none' | 'urgent' | 'critical' {
  if (!auctionEndsAt) return 'none';
  const remaining = new Date(auctionEndsAt).getTime() - Date.now();
  if (remaining <= 0) return 'none';
  if (remaining < 10 * 60 * 1000) return 'critical';
  if (remaining < 60 * 60 * 1000) return 'urgent';
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

  // Post-mount only — Date.now() would otherwise SSR/client-mismatch the glow.
  const urgency = useMemo(
    () => (mounted ? getAuctionUrgency(job.auction_ends_at) : 'none'),
    [mounted, job.auction_ends_at],
  );

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

  // FR-10.7: server distance_km when browse was geo-scoped (market / lat-lng).
  const distanceLabel = useMemo(() => {
    const km = job.distance_km;
    if (km === null || km === undefined || !Number.isFinite(km)) return null;
    const miles = km * 0.621371;
    if (miles < 0.1) return 'less than 0.1 mi';
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${String(Math.round(miles))} mi`;
  }, [job.distance_km]);

  const urgencyBorder =
    urgency === 'critical'
      ? 'border-destructive/50 shadow-[0_0_30px_hsl(var(--status-disputed)/0.18)]'
      : urgency === 'urgent'
        ? 'border-brand-gold/40 shadow-[0_0_24px_var(--brand-gold-glow)]'
        : 'border-[var(--brand-gold)]/10';

  return (
    <Link href={`/jobs/${job.id}` as Route} className="block min-w-0">
      <Card
        variant="glass"
        className={cn(
          // min-w-0 + w-full so the card shrinks to its grid/flex track instead of
          // refusing below its min-content (a grid item defaults to min-width:auto),
          // which pushed a 2px horizontal scroll at 320px. overflow-hidden +
          // truncation below handle the clipped content.
          'w-full min-w-0 glass-interactive glass-highlight relative overflow-hidden border border-l-[3px]',
          urgencyBorder,
          getStatusBorderColor(job.status),
        )}
      >
        {urgency !== 'none' ? (
          <span
            className={cn(
              'absolute top-2 right-2 z-[3] inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
              urgency === 'critical'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-brand-gold text-background',
            )}
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  urgency === 'critical' ? 'bg-destructive/60' : 'bg-brand-gold-dim',
                )}
              />
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  urgency === 'critical' ? 'bg-destructive/40' : 'bg-brand-gold-dim',
                )}
              />
            </span>
            {urgency === 'critical' ? 'Ending now' : 'Closing soon'}
          </span>
        ) : null}
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

          {/* Location + optional distance (FR-10.7) */}
          {job.location_address || distanceLabel ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <MapPin className="h-3.5 w-3.5 text-[var(--brand-gold)]/60" aria-hidden="true" />
              {job.location_address ? (
                <span className="truncate">{job.location_address}</span>
              ) : null}
              {distanceLabel ? (
                <span className="shrink-0 text-xs text-zinc-500">
                  {job.location_address ? `· ${distanceLabel}` : distanceLabel}
                </span>
              ) : null}
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
                From{' '}
                <MonoPrice cents={job.starting_bid_cents} className="text-zinc-200" />
              </span>
            ) : null}
          </div>

          {/* Lowest bid - prominent mono display with emerald glow */}
          {job.lowest_bid_cents ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-zinc-500">Lowest:</span>
              <MonoPrice
                cents={job.lowest_bid_cents}
                className="text-lg font-bold text-bid-winning [text-shadow:0_0_16px_hsl(var(--bid-winning)/0.3)]"
              />
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
                  ? 'bg-destructive/70'
                  : elapsedPercent >= 50
                    ? 'bg-trust-medium/60'
                    : 'bg-bid-winning/50',
              )}
              style={{ width: `${String(elapsedPercent)}%` }}
            />
          </div>
        ) : null}
      </Card>
    </Link>
  );
});
