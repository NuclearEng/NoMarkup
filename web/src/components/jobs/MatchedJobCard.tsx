'use client';

import { MapPin, Tag, Zap } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn, formatCents } from '@/lib/utils';
import type { Job } from '@/types';

import { AuctionTimer } from './AuctionTimer';

interface MatchedJobCardProps {
  job: Job;
  matchScorePct: number;
  distanceKm: number;
}

function getMatchLabel(score: number): string {
  if (score >= 90) return 'Excellent Match';
  if (score >= 75) return 'Strong Match';
  if (score >= 60) return 'Good Match';
  return 'Match';
}

function getMatchColor(score: number): string {
  if (score >= 90) return 'bg-green-500';
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  return 'bg-muted-foreground';
}

function formatDistance(km: number): string {
  if (km < 1) {
    return `${String(Math.round(km * 1000))}m away`;
  }
  if (km < 10) {
    return `${km.toFixed(1)}km away`;
  }
  return `${String(Math.round(km))}km away`;
}

export function MatchedJobCard({ job, matchScorePct, distanceKm }: MatchedJobCardProps) {
  return (
    <Card className="relative overflow-hidden border-primary/20 transition-shadow hover:shadow-md">
      {/* Match indicator banner */}
      <div className="flex items-center gap-2 bg-primary/5 px-4 py-2">
        <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold text-primary">
          You were matched!
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {getMatchLabel(matchScorePct)}
          </span>
          {/* Match score bar */}
          <div
            className="flex h-5 w-12 items-center overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuenow={matchScorePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Match score: ${String(matchScorePct)}%`}
          >
            <div
              className={cn('h-full rounded-full transition-all', getMatchColor(matchScorePct))}
              style={{ width: `${String(matchScorePct)}%` }}
            />
          </div>
          <span className="text-xs font-bold tabular-nums text-foreground">
            {String(matchScorePct)}%
          </span>
        </div>
      </div>

      <CardHeader className="pb-3">
        <h3 className="line-clamp-2 text-base font-semibold leading-snug">
          {job.title}
        </h3>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Category */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Tag className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{job.category_name}</span>
        </div>

        {/* Distance */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{formatDistance(distanceKm)}</span>
        </div>

        {/* Budget range */}
        {job.starting_bid_cents !== null || job.offer_accepted_cents !== null ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Budget:</span>
            <span className="font-medium">
              {job.offer_accepted_cents !== null
                ? formatCents(job.offer_accepted_cents)
                : job.starting_bid_cents !== null
                  ? `Up to ${formatCents(job.starting_bid_cents)}`
                  : 'Open'}
            </span>
          </div>
        ) : null}

        {/* Recurrence badge */}
        {job.is_recurring ? (
          <Badge variant="outline" className="text-xs">
            Recurring{job.recurrence_frequency ? ` (${job.recurrence_frequency})` : ''}
          </Badge>
        ) : null}

        {/* Auction timer */}
        {job.auction_ends_at ? (
          <div className="border-t pt-3">
            <AuctionTimer auctionEndsAt={job.auction_ends_at} compact />
          </div>
        ) : null}

        {/* CTA */}
        <Button asChild className="mt-2 min-h-[44px] w-full">
          <Link href={`/jobs/${job.id}/bid` as Route}>
            Bid Now
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
