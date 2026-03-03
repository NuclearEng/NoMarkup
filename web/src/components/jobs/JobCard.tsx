'use client';

import { Calendar, MapPin, Tag, Users } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatCents, formatRelativeTime } from '@/lib/utils';
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

export function JobCard({ job }: JobCardProps) {
  return (
    <Link href={`/jobs/${job.id}` as Route} className="block">
      <Card className="transition-shadow hover:shadow-md">
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {String(job.bid_count)} bid{job.bid_count !== 1 ? 's' : ''}
              </span>
            </div>
            {job.starting_bid_cents ? (
              <span className="text-sm font-medium">
                From {formatCents(job.starting_bid_cents)}
              </span>
            ) : null}
          </div>

          {/* Lowest bid */}
          {job.lowest_bid_cents ? (
            <div className="text-sm">
              <span className="text-muted-foreground">Lowest bid: </span>
              <span className="font-semibold text-green-600">
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
      </Card>
    </Link>
  );
}
