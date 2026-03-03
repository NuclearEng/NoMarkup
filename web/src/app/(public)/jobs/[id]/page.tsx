'use client';

import { Calendar, ChevronRight, Clock, LogIn, MapPin, Tag, Users } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';

import { BidForm } from '@/components/bids/BidForm';
import { BidList } from '@/components/bids/BidList';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useBidCount } from '@/hooks/useBids';
import { useJob } from '@/hooks/useJobs';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { JOB_STATUS, USER_ROLE } from '@/types';

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const { data: job, isLoading, isError } = useJob(jobId);
  const { data: bidCount } = useBidCount(jobId);
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isJobOwner = user !== null && job !== undefined && user.id === job.customer_id;

  // Determine if the job is in a state where bidding/awarding is possible
  const canBid =
    job?.status === JOB_STATUS.ACTIVE &&
    isProvider &&
    !isJobOwner;

  const canAward =
    isJobOwner &&
    (job.status === JOB_STATUS.ACTIVE || job.status === JOB_STATUS.CLOSED);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-xl border bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold">Job Not Found</h1>
        <p className="mt-2 text-muted-foreground">
          This job may have been removed or does not exist.
        </p>
        <Link href={'/jobs' as Route}>
          <Button variant="outline" className="mt-4 min-h-[44px]">
            Back to Jobs
          </Button>
        </Link>
      </div>
    );
  }

  const scheduleLabel =
    job.schedule_type === 'specific_date'
      ? 'Specific Date'
      : job.schedule_type === 'date_range'
        ? 'Date Range'
        : 'Flexible';

  const displayBidCount = bidCount ?? job.bid_count;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={'/jobs' as Route} className="min-h-[44px] px-1 hover:text-foreground inline-flex items-center">
          Jobs
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link href={'/jobs' as Route} className="min-h-[44px] px-1 hover:text-foreground inline-flex items-center">
          {job.category_name}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="truncate text-foreground">{job.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
              <Badge
                variant={
                  job.status === 'active' ? 'default' : job.status === 'draft' ? 'secondary' : 'outline'
                }
                className="shrink-0"
              >
                {job.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Posted {formatRelativeTime(new Date(job.created_at))}
            </p>
          </div>

          {/* Category */}
          <div className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{job.category_name}</span>
          </div>

          <Separator />

          {/* Description */}
          <div>
            <h2 className="mb-2 text-lg font-semibold">Description</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
          </div>

          <Separator />

          {/* Details grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Location */}
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Location</h3>
                <p className="text-sm text-muted-foreground">
                  {job.location_address ?? 'Remote / Not specified'}
                </p>
              </div>
            </div>

            {/* Schedule */}
            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Schedule</h3>
                <p className="text-sm text-muted-foreground">{scheduleLabel}</p>
                {job.scheduled_date ? (
                  <p className="text-sm text-muted-foreground">
                    {new Date(job.scheduled_date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                ) : null}
                {job.is_recurring && job.recurrence_frequency ? (
                  <Badge variant="outline" className="mt-1">
                    Recurring: {job.recurrence_frequency}
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* Bids */}
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Bids</h3>
                <p className="text-sm text-muted-foreground">
                  {String(displayBidCount)} bid{displayBidCount !== 1 ? 's' : ''} placed
                </p>
                {job.lowest_bid_cents ? (
                  <p className="text-sm font-medium text-green-600">
                    Lowest: {formatCents(job.lowest_bid_cents)}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Auction duration */}
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Auction Duration</h3>
                <p className="text-sm text-muted-foreground">
                  {String(job.auction_duration_hours)} hours
                </p>
              </div>
            </div>
          </div>

          {/* Market range */}
          {job.market_range && job.market_range.sample_size > 0 ? (
            <>
              <Separator />
              <MarketRangeDisplay marketRange={job.market_range} />
            </>
          ) : null}

          {/* Bids section for job owner */}
          {isJobOwner ? (
            <>
              <Separator />
              <div>
                <h2 className="mb-4 text-lg font-semibold">
                  Bids ({String(displayBidCount)})
                </h2>
                <BidList jobId={jobId} canAward={canAward} />
              </div>
            </>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Auction timer card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auction Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.auction_ends_at ? (
                <AuctionTimer auctionEndsAt={job.auction_ends_at} />
              ) : (
                <p className="text-sm text-muted-foreground">Auction not started</p>
              )}

              {job.starting_bid_cents ? (
                <div>
                  <p className="text-xs text-muted-foreground">Starting Bid</p>
                  <p className="text-lg font-semibold">{formatCents(job.starting_bid_cents)}</p>
                </div>
              ) : null}

              {job.offer_accepted_cents ? (
                <div>
                  <p className="text-xs text-muted-foreground">Instant Accept Price</p>
                  <p className="text-lg font-semibold text-green-600">
                    {formatCents(job.offer_accepted_cents)}
                  </p>
                </div>
              ) : null}

              {/* Bid count badge */}
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">
                  {String(displayBidCount)} bid{displayBidCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Bidding section based on user role */}
              {canBid ? (
                <BidForm
                  jobId={jobId}
                  existingBid={null}
                  startingBidCents={job.starting_bid_cents}
                  offerAcceptedCents={job.offer_accepted_cents}
                  marketRange={job.market_range}
                  auctionEndsAt={job.auction_ends_at}
                />
              ) : !isAuthenticated ? (
                <Link href={'/login' as Route}>
                  <Button variant="outline" className="min-h-[44px] w-full">
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                    Sign in to bid
                  </Button>
                </Link>
              ) : !isProvider && !isJobOwner ? (
                <p className="text-sm text-muted-foreground">
                  Only providers can place bids on jobs.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Customer info card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Posted By</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-medium">{job.customer_display_name}</p>
              <p className="text-sm text-muted-foreground">
                Member since{' '}
                {new Date(job.customer_member_since).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {String(job.customer_jobs_posted)} job{job.customer_jobs_posted !== 1 ? 's' : ''}{' '}
                posted
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
