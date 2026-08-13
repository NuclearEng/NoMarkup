'use client';

import { useMemo } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock,
  Gavel,
  Loader2,
  LogIn,
  MapPin,
  MessageSquare,
  Radio,
  Tag,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { toast } from 'sonner';

import { BidActivityFeed } from '@/components/bids/BidActivityFeed';
import { BidForm } from '@/components/bids/BidForm';
import { BidList } from '@/components/bids/BidList';
import { BidPriceChart } from '@/components/bids/BidPriceChart';
import { LiveBidTicker } from '@/components/bids/LiveBidTicker';
import { ReportButton } from '@/components/chat/ReportButton';
import { GradientMesh } from '@/components/landing/GradientMesh';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import { BidPushPrompt } from '@/components/jobs/BidPushPrompt';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { PermitIntelligenceBanner } from '@/components/jobs/PermitIntelligenceBanner';
import { SavingsBadge } from '@/components/jobs/SavingsBadge';
import { ViewerCount } from '@/components/jobs/ViewerCount';
import { TerminalToolbar } from '@/components/terminal/terminal-toolbar';
import { TerminalGrid } from '@/components/terminal/terminal-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useAuctionTerminal } from '@/hooks/useAuctionTerminal';
import { useBidCount, useBidsForJob } from '@/hooks/useBids';
import { useCreateChannel } from '@/hooks/useChannels';
import { useCountdown } from '@/hooks/useCountdown';
import { useCreateInstantMatch } from '@/hooks/useInstantMatch';
import { useJob } from '@/hooks/useJobs';
import { useSpectatorTerminal } from '@/hooks/useSpectatorTerminal';
import { useTerminalHotkeys } from '@/hooks/useTerminalHotkeys';
import { getApiErrorMessage } from '@/lib/api';
import { MonoPrice } from '@/components/ui/mono-price';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { JOB_STATUS, USER_ROLE } from '@/types';
import type { JobDetail, JobLiquidity, MarketRange } from '@/types';

function ownerLiquidityCopy(liq: JobLiquidity): string | null {
  if (liq.notified_count === 0 && liq.bid_count === 0) return null;
  const who =
    liq.notified_count === 1
      ? '1 provider notified'
      : `${String(liq.notified_count)} providers notified`;
  if (liq.minutes_to_first_bid != null && liq.first_bid_at) {
    return `${who} — first bid in ${String(liq.minutes_to_first_bid)} min`;
  }
  return `${who} — waiting for the first bid`;
}

const FALLBACK_MARKET_RANGE: MarketRange = {
  low_cents: 0,
  median_cents: 0,
  high_cents: 0,
  sample_size: 0,
};

interface JobDetailClientProps {
  jobId: string;
  initialJob: JobDetail;
}

export function JobDetailClient({ jobId, initialJob }: JobDetailClientProps) {
  // Seed the query cache with the server-fetched job so the first paint renders
  // real content (no skeleton). The query still refetches live in the background.
  const { data: job, isError, refetch } = useJob(jobId, { initialData: initialJob });
  const { data: bidCount } = useBidCount(jobId);
  const { timeLeft, isExpired: auctionExpired } = useCountdown(job?.auction_ends_at);
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const isProvider = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const isJobOwner = user !== null && job !== undefined && user.id === job.customer_id;

  // Fetch bids for this job — only when authenticated (endpoint requires auth)
  const { data: bidsData } = useBidsForJob(isAuthenticated ? jobId : '');
  // Find the current provider's existing bid (if any)
  const existingBid =
    isProvider && user && bidsData
      ? (bidsData.bids.find((b) => b.bid.provider_id === user.id)?.bid ?? null)
      : null;

  // Determine if the job is a live auction that should render the terminal layout.
  // Excludes expired auctions: once the timer is past, the WebSocket has nothing
  // to stream — keeping the live layout would show a misleading red "Disconnected"
  // badge for what is just a finished auction.
  const isLiveAuction =
    ENABLE_LIVE_AUCTION &&
    job?.auction_type === 'live' &&
    job.status === JOB_STATUS.ACTIVE &&
    !auctionExpired;

  // Participant auction WS is authz-gated (owner or bidder). Guests and
  // non-participants use the public delayed spectate stream (FR-1.1).
  const isAuctionParticipant =
    isLiveAuction && isAuthenticated && (isJobOwner || existingBid !== null);
  const isSpectatorFeed = isLiveAuction && !isAuctionParticipant;
  const participantTerminal = useAuctionTerminal(isAuctionParticipant ? jobId : undefined);
  const spectatorTerminal = useSpectatorTerminal(isSpectatorFeed ? jobId : undefined);
  const terminal = isAuctionParticipant
    ? {
        sim: participantTerminal.sim,
        providers: participantTerminal.providers,
        isConnected: participantTerminal.isConnected,
        error: participantTerminal.error,
        spectatorCount: 0,
        snipeExtensionCount: participantTerminal.snipeExtensionCount,
      }
    : {
        sim: spectatorTerminal.sim,
        providers: spectatorTerminal.providers,
        isConnected: spectatorTerminal.isConnected,
        error: spectatorTerminal.error,
        spectatorCount: spectatorTerminal.spectatorCount,
        // Spectator WS may lag REST; prefer job seed then stream when available.
        snipeExtensionCount: job?.snipe_extension_count ?? 0,
      };

  const auctionEndsAt = useMemo(
    () => job?.auction_ends_at ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    [job?.auction_ends_at],
  );

  const startingPriceCents = job?.starting_bid_cents ?? 0;
  const marketRange = job?.market_range ?? FALLBACK_MARKET_RANGE;

  // Determine if the job is in a state where bidding/awarding is possible
  const canBid = job?.status === JOB_STATUS.ACTIVE && isProvider && !isJobOwner;

  // Bloomberg keyboard layer on live terminal surfaces.
  useTerminalHotkeys({
    enabled: isLiveAuction,
    mode: isSpectatorFeed ? 'spectate' : 'live',
    live: { canBid, bidInputId: 'live-bid-amount' },
  });

  // FR-8.1 — providers (not the job owner) on an open auction can open a pre-bid
  // inquiry (or bid channel if they already have an active bid).
  const canAskQuestion = canBid;
  const createChannel = useCreateChannel();
  const router = useRouter();

  async function handleAskQuestion() {
    if (!canAskQuestion || createChannel.isPending) return;
    try {
      const channel = await createChannel.mutateAsync({
        job_id: jobId,
        channel_type: existingBid ? 'bid' : 'inquiry',
      });
      if (!channel?.id) {
        toast.error('Could not open chat — no channel returned.');
        return;
      }
      router.push(`/messages?channel=${encodeURIComponent(channel.id)}` as Route);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not open chat'));
    }
  }

  const canAward =
    isJobOwner &&
    job !== undefined &&
    (job.status === JOB_STATUS.ACTIVE || job.status === JOB_STATUS.CLOSED);

  // Customer owner can re-request instant match on an already-posted open job
  // when an accept-now price is set (POST /jobs/{id}/instant-match requires it).
  const canRequestInstantMatch =
    isJobOwner &&
    job?.status === JOB_STATUS.ACTIVE &&
    typeof job?.offer_accepted_cents === 'number' &&
    (job.offer_accepted_cents ?? 0) > 0;

  const createInstantMatch = useCreateInstantMatch(jobId);

  // The server already fetched the job (passed via initialData), so there is no
  // first-paint loading state. This error branch only fires if a background
  // refetch fails AND the cache was somehow cleared.
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
                  void refetch();
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
  const liquidityLine =
    isJobOwner && job.liquidity ? ownerLiquidityCopy(job.liquidity) : null;

  // ── Live auction: full terminal overlay ────────────────────────────────────
  if (isLiveAuction) {
    return (
      <div className="dark relative min-h-screen overflow-y-auto bg-background">
        {/* Animated gradient mesh */}
        <GradientMesh />

        {/* Cinematic vignette */}
        <div
          className="hero-vignette pointer-events-none absolute inset-0 z-[1]"
          aria-hidden="true"
        />

        {/* Sticky top bar */}
        <div className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-3">
              <Link
                href={`/jobs/${jobId}`}
                className="flex items-center gap-1.5 text-sm text-white/65 transition-colors hover:text-white/80"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Job Details</span>
              </Link>
              <div className="h-4 w-px bg-white/10" />
              {/* LIVE only when the active socket is open (participant or spectate). */}
              <Badge
                className={
                  terminal.isConnected
                    ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                    : terminal.error
                      ? 'gap-1 border-red-500/20 bg-red-500/10 text-xs text-red-400'
                      : 'gap-1 border-amber-500/20 bg-amber-500/10 text-xs text-amber-300'
                }
                aria-live="polite"
              >
                {terminal.isConnected ? (
                  <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3 w-3" aria-hidden="true" />
                )}
                {terminal.isConnected
                  ? isSpectatorFeed
                    ? 'LIVE · SPECTATE'
                    : 'LIVE'
                  : terminal.error
                    ? 'OFFLINE'
                    : 'CONNECTING'}
              </Badge>
              {isSpectatorFeed ? (
                <Link
                  href={`/auctions/${jobId}/spectate` as Route}
                  className="hidden text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline sm:inline"
                >
                  Full spectate
                </Link>
              ) : null}
              {isProvider && (
                <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-xs text-amber-400">
                  <Gavel className="h-3 w-3" />
                  {isJobOwner ? 'Owner' : 'Provider'}
                </Badge>
              )}
            </div>

            {/* Job info */}
            <div className="hidden items-center gap-3 text-sm md:flex">
              <h1 className="font-semibold text-white/90">{job.title}</h1>
              {liquidityLine ? (
                <p className="text-xs text-white/50" data-testid="job-liquidity-live">
                  {liquidityLine}
                </p>
              ) : null}
              {job.location_address && (
                <div className="flex items-center gap-2 text-white/60">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{job.location_address}</span>
                </div>
              )}
            </div>

            {/* Right side: connection status + spectator count when spectating */}
            <div className="flex items-center gap-3">
              {isSpectatorFeed && terminal.isConnected && terminal.spectatorCount > 0 ? (
                <div className="hidden items-center gap-1.5 text-xs text-white/60 sm:flex">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{String(terminal.spectatorCount)} watching</span>
                </div>
              ) : null}
              <div
                className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs ${
                  terminal.isConnected
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : terminal.error
                      ? 'border-red-500/20 bg-red-500/10 text-red-400'
                      : 'border-white/10 bg-white/5 text-white/65'
                }`}
                role="status"
                aria-label={
                  terminal.isConnected
                    ? isSpectatorFeed
                      ? 'Connected to live spectate stream'
                      : 'Connected to live auction'
                    : terminal.error
                      ? 'Connection error'
                      : 'Connecting to live auction'
                }
              >
                {terminal.isConnected ? (
                  <>
                    <Wifi className="h-3 w-3" />
                    <span className="hidden sm:inline">
                      {isSpectatorFeed ? 'Spectating' : 'Connected'}
                    </span>
                  </>
                ) : terminal.error ? (
                  <>
                    <WifiOff className="h-3 w-3" />
                    <span className="hidden sm:inline">Disconnected</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3 animate-pulse" />
                    <span className="hidden sm:inline">Connecting</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile job info row */}
          <div className="border-t border-white/[0.04] px-4 py-1.5 md:hidden">
            <p className="truncate text-xs font-medium text-white/70">{job.title}</p>
            {job.location_address && (
              <p className="flex items-center gap-1 text-[10px] text-white/40">
                <MapPin className="h-2.5 w-2.5" />
                {job.location_address}
              </p>
            )}
          </div>
        </div>

        {/* Terminal toolbar */}
        <div className="relative z-[2] mx-auto max-w-[1400px] px-4 pt-4 sm:px-6">
          <TerminalToolbar />
        </div>

        {/* Terminal grid */}
        <div className="relative z-[2] mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
          <TerminalGrid
            sim={terminal.sim}
            auctionEndsAt={auctionEndsAt}
            startingPriceCents={startingPriceCents}
            marketRange={marketRange}
            mockProviders={terminal.providers}
            jobId={jobId}
            snipeExtensionCount={
              Math.max(
                terminal.snipeExtensionCount,
                job.snipe_extension_count ?? 0,
              )
            }
            jobTitle={job.title}
            jobDescription={job.description}
            jobCategory={job.category_name}
          />
        </div>

        {/* Provider bid form — pinned to bottom for providers who can bid */}
        {canBid ? (
          <div className="sticky bottom-0 z-50 border-t border-white/[0.06] bg-background/95 backdrop-blur-md">
            <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-4 sm:px-6">
              <BidForm
                jobId={jobId}
                existingBid={existingBid}
                startingBidCents={job.starting_bid_cents}
                offerAcceptedCents={job.offer_accepted_cents}
                marketRange={job.market_range}
                auctionEndsAt={job.auction_ends_at}
                categorySlug={job.category_slug}
                variant="dock"
              />
              {/* FR-8.1 — pre-bid inquiry on live auctions too */}
              {canAskQuestion ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] w-full border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                  disabled={createChannel.isPending}
                  aria-busy={createChannel.isPending}
                  aria-label="Ask a question"
                  onClick={() => {
                    void handleAskQuestion();
                  }}
                >
                  {createChannel.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  )}
                  {createChannel.isPending ? 'Opening chat…' : 'Ask a question'}
                </Button>
              ) : null}
            </div>
          </div>
        ) : !isAuthenticated ? (
          <div className="sticky bottom-0 z-50 border-t border-white/[0.06] bg-background/95 backdrop-blur-md">
            <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-3 px-4 py-4 sm:px-6">
              <p className="text-sm text-white/65">Sign in to place a bid on this auction</p>
              <Link href={'/login' as Route}>
                <Button
                  variant="outline"
                  className="min-h-[44px] border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                >
                  <LogIn className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Sign in to bid
                </Button>
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Sealed bid / standard auction: normal job detail layout ────────────────
  return (
    <div className="animate-fade-in mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-muted-foreground mb-6 hidden items-center gap-1 text-sm sm:flex"
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
            {liquidityLine ? (
              <p
                className="text-muted-foreground mt-2 text-sm"
                data-testid="job-liquidity"
              >
                {liquidityLine}
              </p>
            ) : null}
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

          {/* Permit intelligence — shown for regulated categories */}
          <PermitIntelligenceBanner categorySlug={job.category_slug} />

          <Separator />

          {/* Details grid */}
          {/* Map preview when location exists */}
          {job.location_lat && job.location_lng && process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ? (
            <div className="relative mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
              <img
                src={`https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-l+d4a017(${String(job.location_lng)},${String(job.location_lat)})/${String(job.location_lng)},${String(job.location_lat)},13,0/800x200@2x?access_token=${process.env['NEXT_PUBLIC_MAPBOX_TOKEN']}`}
                alt={`Map showing approximate job location${job.location_address ? ` near ${job.location_address}` : ''}`}
                className="h-[160px] w-full object-cover"
                loading="lazy"
              />
              {job.location_address ? (
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur-sm">
                  <MapPin className="h-3 w-3 text-[var(--brand-gold)]" aria-hidden="true" />
                  {job.location_address}
                </div>
              ) : null}
            </div>
          ) : null}

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
                  <p className="text-sm font-medium text-bid-winning">
                    Lowest:{' '}
                    <MonoPrice cents={job.lowest_bid_cents} className="text-base font-bold" />
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Waiting · starting{' '}
                    <MonoPrice
                      cents={job.starting_bid_cents}
                      className="text-foreground font-medium"
                    />
                  </p>
                )}
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
          {/* Sealed bid auction UI — enhanced with Polymarket/Robinhood-style ticker */}
          <div className="space-y-4">
            {/* Live Bid Ticker — hero price display (starting bid when no bids yet) */}
            {job.starting_bid_cents ? (
              <LiveBidTicker
                currentBid={job.lowest_bid_cents ?? job.starting_bid_cents}
                startingPrice={job.starting_bid_cents}
                totalBids={displayBidCount}
                timeRemaining={!auctionExpired ? timeLeft : undefined}
              />
            ) : null}

            {/* Savings badge — shown when lowest bid beats market median */}
            {job.lowest_bid_cents && job.market_range?.median_cents ? (
              <SavingsBadge
                lowestBidCents={job.lowest_bid_cents}
                marketMedianCents={job.market_range.median_cents}
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
                <ViewerCount jobId={jobId} />
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
                    <MonoPrice
                      cents={job.starting_bid_cents}
                      className="text-lg font-semibold"
                    />
                  </div>
                ) : null}

                {job.offer_accepted_cents ? (
                  <div>
                    <p className="text-muted-foreground text-xs">Instant Accept Price</p>
                    <MonoPrice
                      cents={job.offer_accepted_cents}
                      className="text-lg font-semibold text-bid-winning"
                    />
                  </div>
                ) : null}

                {/* Bid count badge */}
                <div className="flex items-center gap-2">
                  <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
                  <span className="text-muted-foreground text-sm">
                    {String(displayBidCount)} bid{displayBidCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {liquidityLine ? (
                  <p className="text-muted-foreground text-xs" data-testid="job-liquidity-sidebar">
                    {liquidityLine}
                  </p>
                ) : null}

                {/* Owner: request (or re-request) instant match on an open job.
                    Post-job form can fire this at publish; this covers already-
                    posted jobs that still need a match fan-out. */}
                {canRequestInstantMatch ? (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      variant="urgent"
                      className="min-h-[44px] w-full"
                      disabled={createInstantMatch.isPending}
                      aria-busy={createInstantMatch.isPending}
                      onClick={() => {
                        createInstantMatch.mutate();
                      }}
                    >
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      {createInstantMatch.isPending
                        ? 'Requesting instant match…'
                        : 'Request Instant match'}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Sends an Instant offer at your Accept price (
                      {formatCents(job.offer_accepted_cents ?? 0)}) to providers with Instant
                      availability. Auction stays open until a provider accepts. Instant often
                      prices about 1.5–2× a typical auction for the same work — a soft range for
                      speed, not a hard formula.
                    </p>
                  </div>
                ) : null}

                {/* Bidding section based on user role. BidForm handles both
                    the first bid (existingBid === null) and lowering an
                    existing bid, so it must render for any provider who can
                    bid — not only when they already have a bid. Gating it on
                    `existingBid !== null` left providers with no way to place a
                    first bid on sealed jobs, where `lowest_bid_cents` is never
                    populated and so the BidPlacementPanel fallback below also
                    never rendered. */}
                {canBid ? (
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

                {/* FR-8.1 — pre-bid inquiry / bid channel */}
                {canAskQuestion ? (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] w-full"
                      disabled={createChannel.isPending}
                      aria-busy={createChannel.isPending}
                      aria-label="Ask a question"
                      onClick={() => {
                        void handleAskQuestion();
                      }}
                    >
                      {createChannel.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                      )}
                      {createChannel.isPending ? 'Opening chat…' : 'Ask a question'}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Opens a private pre-bid inquiry with the customer. Contact info stays
                      filtered until you explicitly share it.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* BidPlacementPanel was previously the only first-bid affordance,
                but it requires a `lowest_bid_cents` that sealed jobs never set,
                so it silently never rendered. The BidForm above now owns the
                place-a-bid flow for every can-bid case (and dedupes the UI), so
                this panel is intentionally removed rather than left as dead,
                never-true JSX. */}

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

            {/* Push notification opt-in — shown to job owner before first bid */}
            <BidPushPrompt
              jobId={jobId}
              isJobOwner={isJobOwner}
              bidCount={displayBidCount}
              status={job.status}
            />
          </div>

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
              {/* ASR-1.2.b — no job-level report API; user report on the poster. */}
              {isAuthenticated && !isJobOwner ? (
                <div className="pt-1">
                  <ReportButton
                    userId={job.customer_id}
                    displayName={job.customer_display_name}
                    className="text-muted-foreground hover:text-destructive"
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
