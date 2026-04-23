'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Users, Zap } from 'lucide-react';

import { cn } from '@/lib/utils';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';
import { BidActivityFeed } from '@/components/bids/BidActivityFeed';
import { BidDepthChart } from '@/components/bids/BidDepthChart';
import { BidForm } from '@/components/bids/BidForm';
import { BidPriceChart } from '@/components/bids/BidPriceChart';
import { BidVelocityIndicator } from '@/components/bids/BidVelocityIndicator';
import { OrderBook } from '@/components/bids/OrderBook';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { SavingsHero } from '@/components/bids/SavingsHero';
import { SnipeIndicator } from '@/components/bids/SnipeIndicator';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { SavingsCelebration } from '@/components/ui/SavingsCelebration';
import { useAuctionStream } from '@/hooks/useAuctionStream';
import { useBidsForJob, useLiveAuctionState } from '@/hooks/useBids';
import { useCountdown } from '@/hooks/useCountdown';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import type { AuctionBidEvent, JobDetail } from '@/types';

interface AuctionArenaProps {
  job: JobDetail;
  isProvider: boolean;
  isJobOwner: boolean;
}

const VISUALIZATION_TAB = {
  PRICE_HISTORY: 'price_history',
  DEPTH_CHART: 'depth_chart',
} as const;
type VisualizationTab = (typeof VISUALIZATION_TAB)[keyof typeof VISUALIZATION_TAB];

function getUrgency(totalSeconds: number, isExpired: boolean) {
  if (isExpired) return 'ended' as const;
  if (totalSeconds > 3600) return 'normal' as const;
  if (totalSeconds > 900) return 'warning' as const;
  if (totalSeconds > 300) return 'critical' as const;
  return 'extreme' as const;
}

export function AuctionArena({ job, isProvider, isJobOwner }: AuctionArenaProps) {
  const {
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    auctionEndsAt,
    snipeExtensionCount,
    isConnected,
    orderBook,
    velocity,
    velocityBuckets,
  } = useAuctionStream(job.id);

  // Compute displayEndsAt early so we can pass it to adaptive polling
  const displayEndsAtForPolling = auctionEndsAt || job.auction_ends_at;
  const { data: auctionState } = useLiveAuctionState(job.id, displayEndsAtForPolling);

  // Fetch real bid data for the order book (with provider names, trust scores)
  const { data: bidsData } = useBidsForJob(job.id);

  const [showCelebration, setShowCelebration] = useState(false);
  const [activeTab, setActiveTab] = useState<VisualizationTab>(VISUALIZATION_TAB.PRICE_HISTORY);
  const celebrationShownRef = useRef(false);
  const previousLowestRef = useRef<number | undefined>(undefined);

  const handleCloseCelebration = useCallback(() => {
    setShowCelebration(false);
  }, []);

  // Compute derived auction data (before early return so hooks stay stable)
  const displayLowest =
    currentLowest || auctionState?.lowest_bid_cents || job.lowest_bid_cents || 0;
  const displayBidCount = bidCount || auctionState?.bid_count || job.bid_count || 0;
  const displayEndsAt = auctionEndsAt || auctionState?.auction_ends_at || job.auction_ends_at;
  const displaySnipeCount =
    snipeExtensionCount || auctionState?.snipe_extension_count || job.snipe_extension_count || 0;
  const displayEvents = events.length > 0 ? events : auctionState?.recent_events || [];

  const startingPrice = job.starting_bid_cents || 0;
  const medianPrice = job.market_range?.median_cents || 0;
  const savingsCents = medianPrice > 0 && displayLowest > 0 ? medianPrice - displayLowest : 0;

  // Build order book entries from bidsData (real provider info) merged with WS flash state
  const orderBookBids = useMemo(() => {
    if (!bidsData?.bids) return [];

    const wsFlashIds = new Set(
      orderBook.filter((e) => e.is_new).map((e) => e.id),
    );

    return bidsData.bids
      .filter((b) => b.bid.status === 'active')
      .map((b) => ({
        id: b.bid.id,
        provider_name: b.provider_business_name || b.provider_display_name,
        amount_cents: b.bid.amount_cents,
        trust_score: b.trust_score?.overall_score ?? 0,
        trust_tier: b.trust_score?.tier ?? 'new',
        created_at: b.bid.created_at,
        is_new: wsFlashIds.has(b.bid.id),
      }));
  }, [bidsData, orderBook]);

  // Build depth chart data: bucket bids by amount
  const depthBuckets = useMemo(() => {
    if (orderBookBids.length === 0) return [];

    const bucketMap = new Map<number, number>();
    for (const bid of orderBookBids) {
      const existing = bucketMap.get(bid.amount_cents) ?? 0;
      bucketMap.set(bid.amount_cents, existing + 1);
    }

    return Array.from(bucketMap.entries())
      .map(([amount_cents, count]) => ({ amount_cents, count }))
      .sort((a, b) => a.amount_cents - b.amount_cents);
  }, [orderBookBids]);

  // Track the previous lowest bid for SavingsHero trend
  const previousLowest = previousLowestRef.current;
  useEffect(() => {
    if (displayLowest > 0 && displayLowest !== previousLowestRef.current) {
      previousLowestRef.current = displayLowest;
    }
  }, [displayLowest]);

  // Map displayEvents to BidActivity[] for the activity feed (reverse chronological)
  const bidActivities = useMemo(() => {
    const priceEvents = displayEvents.filter(
      (e: AuctionBidEvent) => e.event_type === 'bid_placed' || e.event_type === 'bid_updated',
    );
    const lowestAmount =
      priceEvents.length > 0
        ? Math.min(...priceEvents.map((e: AuctionBidEvent) => e.amount_cents))
        : 0;

    return [...priceEvents].reverse().map((event: AuctionBidEvent, index: number) => ({
      id: `${event.created_at}-${String(priceEvents.length - 1 - index)}`,
      providerName: `Provider ${String(priceEvents.length - index)}`,
      amount: event.amount_cents,
      timestamp: new Date(event.created_at).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }),
      isLowest: event.amount_cents === lowestAmount,
    }));
  }, [displayEvents]);

  // Map displayEvents to bid amounts for the sparkline chart (chronological)
  const sparklineBids = useMemo(
    () =>
      displayEvents
        .filter(
          (e: AuctionBidEvent) => e.event_type === 'bid_placed' || e.event_type === 'bid_updated',
        )
        .map((e: AuctionBidEvent) => e.amount_cents),
    [displayEvents],
  );

  // Trigger savings celebration when the auction ends and the customer has savings
  useEffect(() => {
    if (celebrationShownRef.current) return;
    if (!isJobOwner || savingsCents <= 0) return;

    const auctionHasEnded =
      displayEndsAt != null && new Date(displayEndsAt).getTime() <= Date.now();
    const jobAwarded = job.status === 'awarded' || job.status === 'completed';

    if (auctionHasEnded || jobAwarded) {
      celebrationShownRef.current = true;
      setShowCelebration(true);
    }
  }, [isJobOwner, savingsCents, displayEndsAt, job.status]);

  if (!ENABLE_LIVE_AUCTION) return null;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl shadow-lg',
        'bg-card',
        isConnected && 'arena-live-border',
      )}
    >
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6); }
          50% { opacity: 0.8; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
        }
        @keyframes savingsPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        @keyframes countdownPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes arenaBorderGlow {
          0%, 100% {
            border-color: rgba(34, 197, 94, 0.25);
            box-shadow: 0 0 12px rgba(34, 197, 94, 0.08), inset 0 1px 0 rgba(255,255,255,0.03);
          }
          50% {
            border-color: rgba(34, 197, 94, 0.45);
            box-shadow: 0 0 24px rgba(34, 197, 94, 0.15), 0 0 48px rgba(34, 197, 94, 0.05), inset 0 1px 0 rgba(255,255,255,0.06);
          }
        }
        .arena-live-border {
          border: 1px solid rgba(34, 197, 94, 0.25);
          animation: arenaBorderGlow 4s ease-in-out infinite;
        }
        .arena-live-border:not(.arena-live-border) {
          border: 1px solid var(--border);
        }
      `}</style>

      {/* Dormant border when not connected */}
      {!isConnected && (
        <div className="absolute inset-0 rounded-xl border border-border/50 pointer-events-none" aria-hidden="true" />
      )}

      {/* ── Gold accent line at very top ── */}
      <div
        className="h-[2px] w-full"
        style={{
          background: 'linear-gradient(90deg, transparent 5%, var(--brand-gold-dim) 20%, var(--brand-gold-bright) 50%, var(--brand-gold-dim) 80%, transparent 95%)',
        }}
        aria-hidden="true"
      />

      {/* ── Premium header banner ── */}
      <div className="relative bg-muted/60 px-5 py-3.5 sm:px-6">
        {/* Subtle top gradient shimmer */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, transparent 100%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="h-5 w-5 text-green-400" aria-hidden="true" />
            <h2 className="text-foreground text-sm font-bold tracking-widest uppercase">
              Live Auction
            </h2>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Bid velocity indicator */}
            {velocity > 0 && (
              <BidVelocityIndicator
                velocity={velocity}
                buckets={velocityBuckets}
              />
            )}
            {/* Connection status */}
            <div
              className="flex items-center gap-2"
              role="status"
              aria-label={
                isConnected ? 'Live connection active' : `Connection status: ${connectionStatus}`
              }
            >
              {isConnected ? (
                <>
                  <div
                    className="h-2 w-2 rounded-full bg-green-500"
                    style={{ animation: 'livePulse 2s ease-in-out infinite' }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-medium text-green-400">LIVE</span>
                </>
              ) : (
                <>
                  <div className="bg-muted-foreground/40 h-2 w-2 rounded-full" aria-hidden="true" />
                  <span className="text-muted-foreground text-xs font-medium">
                    {connectionStatus === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* -- Hero price display -- */}
      <div className="px-5 pt-6 pb-3 text-center sm:px-6 sm:pt-8">
        {startingPrice > 0 && displayLowest > 0 ? (
          <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide">
            Starting at {formatCurrency(startingPrice)}
          </p>
        ) : null}

        <div
          className="text-3xl font-black tracking-tight text-green-500 sm:text-4xl lg:text-5xl"
          role="status"
          aria-live="polite"
          aria-label={
            displayLowest > 0
              ? `Current lowest bid: ${formatCurrency(displayLowest)}`
              : 'No bids yet'
          }
          style={{
            textShadow: displayLowest > 0
              ? '0 0 30px rgba(34, 197, 94, 0.25), 0 0 60px rgba(34, 197, 94, 0.1)'
              : undefined,
          }}
        >
          <AnimatedPrice cents={displayLowest} formatCurrency={formatCurrency} />
        </div>

        <p className="text-muted-foreground mt-1.5 text-[11px] font-medium tracking-wider uppercase">
          Current Lowest Bid
        </p>
      </div>

      {/* ── Savings Hero ── */}
      {startingPrice > 0 && displayLowest > 0 && displayLowest < startingPrice ? (
        <div className="px-5 pb-3 sm:px-6">
          <SavingsHero
            startingPriceCents={startingPrice}
            currentLowestCents={displayLowest}
            previousLowestCents={previousLowest}
          />
        </div>
      ) : null}

      {/* ── Section divider ── */}
      <div className="mx-5 sm:mx-6" aria-hidden="true">
        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      </div>

      {/* ── Stats row ── */}
      <div className="bg-border/20 mx-3 my-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/30 sm:mx-6">
        {/* Total Bids */}
        <div className="bg-card flex flex-col items-center gap-1 px-3 py-3.5">
          <div className="flex items-center gap-1">
            <Users className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Bids
            </span>
          </div>
          <p
            className="text-xl font-bold tabular-nums sm:text-2xl"
            role="status"
            aria-live="polite"
            aria-label={`${String(displayBidCount)} total bids`}
          >
            {String(displayBidCount)}
          </p>
        </div>

        {/* Countdown — center cell gets subtle side borders via gap-px trick */}
        <CountdownCell endsAt={displayEndsAt} />

        {/* Anti-snipe */}
        <div className="bg-card flex flex-col items-center justify-center px-3 py-3.5">
          <SnipeIndicator count={displaySnipeCount} max={3} />
        </div>
      </div>

      {/* ── Section divider ── */}
      <div className="mx-5 sm:mx-6" aria-hidden="true">
        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      </div>

      {/* -- Visualization tabs: Price History / Depth Chart -- */}
      <div className="px-5 pt-5 sm:px-6">
        <div className="relative flex items-center gap-1 mb-3" role="tablist" aria-label="Chart visualization">
          {/* Tab underline track */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-border/30" aria-hidden="true" />

          <button
            role="tab"
            aria-selected={activeTab === VISUALIZATION_TAB.PRICE_HISTORY}
            onClick={() => { setActiveTab(VISUALIZATION_TAB.PRICE_HISTORY); }}
            className={cn(
              'relative min-h-[44px] px-3 pb-2.5 pt-1 text-xs font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/40',
              activeTab === VISUALIZATION_TAB.PRICE_HISTORY
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80',
            )}
          >
            Price History
            {/* Active underline indicator */}
            {activeTab === VISUALIZATION_TAB.PRICE_HISTORY && (
              <span
                className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-green-500"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === VISUALIZATION_TAB.DEPTH_CHART}
            onClick={() => { setActiveTab(VISUALIZATION_TAB.DEPTH_CHART); }}
            className={cn(
              'relative min-h-[44px] px-3 pb-2.5 pt-1 text-xs font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/40',
              activeTab === VISUALIZATION_TAB.DEPTH_CHART
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80',
            )}
          >
            Depth Chart
            {activeTab === VISUALIZATION_TAB.DEPTH_CHART && (
              <span
                className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-green-500"
                aria-hidden="true"
              />
            )}
          </button>
        </div>

        {/* Tab panels */}
        <div role="tabpanel" aria-label={activeTab === VISUALIZATION_TAB.PRICE_HISTORY ? 'Price history chart' : 'Bid depth chart'}>
          {activeTab === VISUALIZATION_TAB.PRICE_HISTORY ? (
            <PriceDropChart events={displayEvents} />
          ) : (
            <BidDepthChart
              bids={depthBuckets}
              startingPrice={startingPrice}
              currentLowest={displayLowest}
            />
          )}
        </div>
      </div>

      {/* ── Section divider ── */}
      <div className="mx-5 mt-3 sm:mx-6" aria-hidden="true">
        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      </div>

      {/* -- Sparkline + Activity Feed -- */}
      <div className="px-5 pt-5 pb-3 sm:px-6">
        <h3 className="mb-3 text-[11px] font-semibold tracking-widest uppercase text-muted-foreground/60">
          Bid Trend
        </h3>
        <BidPriceChart bids={sparklineBids} height={100} className="mb-4" />
        <BidActivityFeed activities={bidActivities} />
      </div>

      {/* ── Section divider ── */}
      {orderBookBids.length > 0 && (
        <div className="mx-5 sm:mx-6" aria-hidden="true">
          <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        </div>
      )}

      {/* -- Order Book -- */}
      {orderBookBids.length > 0 && (
        <div className="px-5 pt-5 pb-3 sm:px-6">
          <OrderBook
            jobId={job.id}
            bids={orderBookBids}
            startingPrice={startingPrice}
          />
        </div>
      )}

      {/* ── Section divider ── */}
      {job.market_range && job.market_range.sample_size > 0 ? (
        <div className="mx-5 sm:mx-6" aria-hidden="true">
          <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        </div>
      ) : null}

      {/* -- Market Intelligence -- */}
      {job.market_range && job.market_range.sample_size > 0 ? (
        <div className="px-5 pt-5 pb-3 sm:px-6">
          <MarketRangeDisplay
            marketRange={job.market_range}
            currentBidCents={displayLowest > 0 ? displayLowest : undefined}
          />
        </div>
      ) : null}

      {/* -- Social proof -- */}
      {displayBidCount > 0 ? (
        <div className="px-5 pt-3 pb-6 text-center sm:px-6">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-semibold">
              {String(displayBidCount)} provider{displayBidCount !== 1 ? 's' : ''}
            </span>{' '}
            competing for your job
          </p>
        </div>
      ) : null}

      {/* -- Bid form for providers -- */}
      {isProvider && !isJobOwner && job.status === 'active' ? (
        <div className="border-border/30 border-t px-5 py-5 sm:px-6">
          <BidForm
            jobId={job.id}
            existingBid={null}
            startingBidCents={job.starting_bid_cents}
            offerAcceptedCents={job.offer_accepted_cents}
            marketRange={job.market_range}
            auctionEndsAt={displayEndsAt}
            categorySlug={job.category_slug}
          />
        </div>
      ) : null}

      {/* -- Savings celebration overlay -- */}
      {showCelebration && savingsCents > 0 ? (
        <SavingsCelebration
          savingsCents={savingsCents}
          jobTitle={job.title}
          onClose={handleCloseCelebration}
        />
      ) : null}
    </div>
  );
}

function CountdownCell({ endsAt }: { endsAt: string | null | undefined }) {
  const { timeLeft: label, isExpired, totalSeconds } = useCountdown(endsAt);
  const urgency = getUrgency(totalSeconds, isExpired);

  const colorMap = {
    normal: 'text-foreground',
    warning: 'text-amber-400',
    critical: 'text-red-400',
    extreme: 'text-red-500',
    ended: 'text-muted-foreground',
  } as const;

  return (
    <div className="bg-card flex flex-col items-center gap-1 px-3 py-3.5">
      <div className="flex items-center gap-1">
        <Shield className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          Time Left
        </span>
      </div>
      <p
        className={`text-xl font-bold tabular-nums sm:text-2xl ${colorMap[urgency]}`}
        role="timer"
        aria-live="polite"
        aria-label={`Time remaining: ${label}`}
        style={
          urgency === 'extreme'
            ? { animation: 'countdownPulse 1s ease-in-out infinite' }
            : undefined
        }
      >
        {label}
      </p>
    </div>
  );
}
