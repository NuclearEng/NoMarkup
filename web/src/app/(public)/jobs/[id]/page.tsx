'use client';

import { Calendar, ChevronRight, Clock, LogIn, MapPin, Tag, Users } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';

import { AuctionArena } from '@/components/bids/AuctionArena';
import { BidActivityFeed } from '@/components/bids/BidActivityFeed';
import { BidForm } from '@/components/bids/BidForm';
import { BidList } from '@/components/bids/BidList';
import { BidPlacementPanel } from '@/components/bids/BidPlacementPanel';
import { BidPriceChart } from '@/components/bids/BidPriceChart';
import { LiveBidTicker } from '@/components/bids/LiveBidTicker';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useBidCount, useBidsForJob, usePlaceBid } from '@/hooks/useBids';
import { useCountdown } from '@/hooks/useCountdown';
import { useJob } from '@/hooks/useJobs';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { JOB_STATUS, USER_ROLE } from '@/types';

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const { data: job, isLoading, isError } = useJob(jobId);
  const { data: bidCount } = useBidCount(jobId);
  const { timeLeft, isExpired: auctionExpired } = useCountdown(job?.auction_ends_at);
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isJobOwner = user !== null && job !== undefined && user.id === job.customer_id;

  // Fetch bids for this job — only when authenticated (endpoint requires auth)
  const { data: bidsData } = useBidsForJob(isAuthenticated ? jobId : '');
  const placeBid = usePlaceBid();

  // Find the current provider's existing bid (if any)
  const existingBid =
    isProvider && user && bidsData
      ? (bidsData.bids.find((b) => b.bid.provider_id === user.id)?.bid ?? null)
      : null;

  // Determine if the job is in a state where bidding/awarding is possible
  const canBid = job?.status === JOB_STATUS.ACTIVE && isProvider && !isJobOwner;

  const canAward =
    isJobOwner && (job.status === JOB_STATUS.ACTIVE || job.status === JOB_STATUS.CLOSED);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="bg-muted h-8 w-2/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-64 animate-pulse rounded-xl border" />
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect
                x="4"
                y="6"
                width="24"
                height="20"
                rx="3"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M10 14H22"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.4"
              />
              <path
                d="M10 18H18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.3"
              />
              <path d="M14 2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M18 2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
          title="Job not found"
          description="This job could not be loaded. It may have been removed, or there was a connection issue."
          action={
            <div className="flex items-center gap-3">
              <Button
                variant="default"
                className="min-h-[44px]"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Retry
              </Button>
              <Link href={'/jobs' as Route}>
                <Button variant="outline" className="min-h-[44px]">
                  Back to Jobs
                </Button>
              </Link>
            </div>
          }
        />
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
    <div className="animate-fade-in mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground mb-6 flex items-center gap-1 text-sm"
      >
        <Link
          href={'/jobs' as Route}
          className="hover:text-foreground inline-flex min-h-[44px] items-center px-1"
        >
          Jobs
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link
          href={'/jobs' as Route}
          className="hover:text-foreground inline-flex min-h-[44px] items-center px-1"
        >
          {job.category_name}
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground truncate">{job.title}</span>
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
                  job.status === 'active'
                    ? 'default'
                    : job.status === 'draft'
                      ? 'secondary'
                      : 'outline'
                }
                className="shrink-0"
              >
                {job.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Posted {formatRelativeTime(new Date(job.created_at))}
            </p>
          </div>

          {/* Category */}
          <div className="flex items-center gap-2 text-sm">
            <Tag className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            <span>{job.category_name}</span>
          </div>

          <Separator />

          {/* Description */}
          <div>
            <h2 className="mb-2 text-lg font-semibold">Description</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{job.description}</p>
          </div>

          <Separator />

          {/* Details grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Location */}
            <div className="flex items-start gap-3">
              <MapPin
                className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-medium">Location</h3>
                <p className="text-muted-foreground text-sm">
                  {job.location_address ?? 'Remote / Not specified'}
                </p>
              </div>
            </div>

            {/* Schedule */}
            <div className="flex items-start gap-3">
              <Calendar
                className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-medium">Schedule</h3>
                <p className="text-muted-foreground text-sm">{scheduleLabel}</p>
                {job.scheduled_date ? (
                  <p className="text-muted-foreground text-sm">
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
              <Users className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Bids</h3>
                <p className="text-muted-foreground text-sm">
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
              <Clock className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium">Auction Duration</h3>
                <p className="text-muted-foreground text-sm">
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
                <h2 className="mb-4 text-lg font-semibold">Bids</h2>
                <BidList
                  jobId={jobId}
                  canAward={canAward}
                  startingPriceCents={job.starting_bid_cents ?? undefined}
                  marketMedianCents={job.market_range?.median_cents}
                />
              </div>
            </>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {job.auction_type === 'live' && ENABLE_LIVE_AUCTION ? (
            <AuctionArena job={job} isProvider={isProvider} isJobOwner={isJobOwner} />
          ) : (
            /* Sealed bid auction UI — enhanced with Polymarket/Robinhood-style ticker */
            <div className="space-y-4">
              {/* Live Bid Ticker — hero price display */}
              {job.lowest_bid_cents && job.starting_bid_cents ? (
                <LiveBidTicker
                  currentBid={job.lowest_bid_cents}
                  startingPrice={job.starting_bid_cents}
                  totalBids={displayBidCount}
                  timeRemaining={!auctionExpired ? timeLeft : undefined}
                />
              ) : null}

              {/* Sparkline price chart — shows bid history trend */}
              {job.lowest_bid_cents && job.starting_bid_cents ? (
                <BidPriceChart
                  bids={[job.starting_bid_cents, job.lowest_bid_cents]}
                  height={80}
                  className="bg-card rounded-xl border p-3"
                />
              ) : null}

              {/* Original auction status card */}
              <Card className="ring-border shadow-sm ring-1">
                <CardHeader>
                  <CardTitle className="text-base">Auction Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {job.auction_ends_at ? (
                    <AuctionTimer auctionEndsAt={job.auction_ends_at} />
                  ) : (
                    <p className="text-muted-foreground text-sm">Auction not started</p>
                  )}

                  {job.starting_bid_cents ? (
                    <div>
                      <p className="text-muted-foreground text-xs">Starting Bid</p>
                      <p className="text-lg font-semibold">{formatCents(job.starting_bid_cents)}</p>
                    </div>
                  ) : null}

                  {job.offer_accepted_cents ? (
                    <div>
                      <p className="text-muted-foreground text-xs">Instant Accept Price</p>
                      <p className="text-lg font-semibold text-green-600">
                        {formatCents(job.offer_accepted_cents)}
                      </p>
                    </div>
                  ) : null}

                  {/* Bid count badge */}
                  <div className="flex items-center gap-2">
                    <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
                    <span className="text-muted-foreground text-sm">
                      {String(displayBidCount)} bid{displayBidCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Bidding section based on user role */}
                  {canBid && existingBid !== null ? (
                    <BidForm
                      jobId={jobId}
                      existingBid={existingBid}
                      startingBidCents={job.starting_bid_cents}
                      offerAcceptedCents={job.offer_accepted_cents}
                      marketRange={job.market_range}
                      auctionEndsAt={job.auction_ends_at}
                      categorySlug={job.category_slug}
                    />
                  ) : !isAuthenticated ? (
                    <Link href={'/login' as Route}>
                      <Button variant="outline" className="min-h-[44px] w-full">
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        Sign in to bid
                      </Button>
                    </Link>
                  ) : !isProvider && !isJobOwner ? (
                    <p className="text-muted-foreground text-sm">
                      Only providers can place bids on jobs.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {/* BidPlacementPanel — shown for providers placing a new bid */}
              {canBid && existingBid === null && job.lowest_bid_cents && job.starting_bid_cents ? (
                <BidPlacementPanel
                  currentLowest={job.lowest_bid_cents}
                  startingPrice={job.starting_bid_cents}
                  onPlaceBid={(amountCents) => {
                    placeBid.mutate({ jobId, input: { amount_cents: amountCents } });
                  }}
                  isSubmitting={placeBid.isPending}
                />
              ) : null}

              {/* Bid activity feed — historical bids for sealed auctions */}
              {bidsData && bidsData.bids.length > 0 ? (
                <BidActivityFeed
                  activities={bidsData.bids.map((b) => ({
                    id: b.bid.id,
                    providerName: b.provider_display_name || b.provider_business_name,
                    amount: b.bid.amount_cents,
                    timestamp: formatRelativeTime(new Date(b.bid.created_at)),
                    isLowest:
                      b.bid.amount_cents ===
                      Math.min(...bidsData.bids.map((x) => x.bid.amount_cents)),
                  }))}
                />
              ) : null}
            </div>
          )}

          {/* Customer info card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Posted By</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-medium">{job.customer_display_name}</p>
              <p className="text-muted-foreground text-sm">
                Member since{' '}
                {new Date(job.customer_member_since).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <p className="text-muted-foreground text-sm">
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
