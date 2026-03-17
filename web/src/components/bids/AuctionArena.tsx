'use client';

import { useEffect, useState } from 'react';
import { Shield, TrendingUp, Users, Zap } from 'lucide-react';

import { BidForm } from '@/components/bids/BidForm';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { SnipeIndicator } from '@/components/bids/SnipeIndicator';
import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { useAuctionStream } from '@/hooks/useAuctionStream';
import { useLiveAuctionState } from '@/hooks/useBids';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import type { JobDetail } from '@/types';

interface AuctionArenaProps {
  job: JobDetail;
  isProvider: boolean;
  isJobOwner: boolean;
}

function useCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  if (!endsAt) return { label: '--:--:--', urgency: 'normal' as const, totalSeconds: 0 };

  const diff = new Date(endsAt).getTime() - now;
  if (diff <= 0) return { label: 'ENDED', urgency: 'ended' as const, totalSeconds: 0 };

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  let label: string;
  if (hours > 0) {
    label = `${String(hours)}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    label = `${pad(minutes)}:${pad(seconds)}`;
  }

  let urgency: 'normal' | 'warning' | 'critical' | 'extreme';
  if (totalSeconds > 3600) {
    urgency = 'normal';
  } else if (totalSeconds > 900) {
    urgency = 'warning';
  } else if (totalSeconds > 300) {
    urgency = 'critical';
  } else {
    urgency = 'extreme';
  }

  return { label, urgency, totalSeconds };
}

function AnimatedPrice({
  cents,
  formatCurrency,
}: {
  cents: number;
  formatCurrency: (c: number) => string;
}) {
  const [displayCents, setDisplayCents] = useState(cents);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    if (cents !== displayCents) {
      setIsChanging(true);
      // Small delay so the flash is visible
      const timer = setTimeout(() => {
        setDisplayCents(cents);
        setIsChanging(false);
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [cents, displayCents]);

  return (
    <span
      className={`transition-all duration-300 ${isChanging ? 'scale-110 brightness-150' : ''}`}
      style={{
        display: 'inline-block',
        textShadow: '0 0 20px rgba(34, 197, 94, 0.4), 0 0 40px rgba(34, 197, 94, 0.15)',
      }}
    >
      {displayCents > 0 ? formatCurrency(displayCents) : '\u2014'}
    </span>
  );
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
  } = useAuctionStream(job.id);

  const { data: auctionState } = useLiveAuctionState(job.id);

  if (!ENABLE_LIVE_AUCTION) return null;

  // Use WebSocket data if connected, fall back to REST, then job data
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

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  return (
    <div className="border-border/50 bg-card overflow-hidden rounded-xl border shadow-lg">
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
      `}</style>

      {/* ── Premium header banner ── */}
      <div
        className="relative px-4 py-3 sm:px-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(10, 10, 10, 0.95) 0%, rgba(20, 20, 20, 0.8) 50%, transparent 100%)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="h-5 w-5 text-green-400" aria-hidden="true" />
            <h2 className="text-foreground text-sm font-bold tracking-widest uppercase">
              Live Auction
            </h2>
          </div>
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

      {/* ── Hero price display ── */}
      <div className="px-4 pt-5 pb-2 text-center sm:px-6 sm:pt-6">
        {startingPrice > 0 && displayLowest > 0 ? (
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Starting at {formatCurrency(startingPrice)}
          </p>
        ) : null}

        <div
          className="text-4xl font-black tracking-tight text-green-500 sm:text-5xl"
          role="status"
          aria-live="polite"
          aria-label={
            displayLowest > 0
              ? `Current lowest bid: ${formatCurrency(displayLowest)}`
              : 'No bids yet'
          }
        >
          <AnimatedPrice cents={displayLowest} formatCurrency={formatCurrency} />
        </div>

        <p className="text-muted-foreground mt-1 text-xs">Current Lowest Bid</p>

        {/* Savings pill */}
        {savingsCents > 0 ? (
          <div
            className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3.5 py-1.5"
            role="status"
            aria-label={`Saving ${formatCurrency(savingsCents)} versus market average`}
            style={{ animation: 'savingsPulse 3s ease-in-out infinite' }}
          >
            <TrendingUp className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
            <span className="text-xs font-bold text-green-400">
              Saving {formatCurrency(savingsCents)} vs market avg
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Stats row ── */}
      <div className="border-border/30 bg-border/20 mx-4 my-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border-y sm:mx-6">
        {/* Total Bids */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
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

        {/* Countdown */}
        <CountdownCell endsAt={displayEndsAt} />

        {/* Anti-snipe */}
        <div className="bg-card flex flex-col items-center justify-center px-3 py-3">
          <SnipeIndicator count={displaySnipeCount} max={3} />
        </div>
      </div>

      {/* ── Price History Chart ── */}
      <div className="px-4 pb-2 sm:px-6">
        <h3 className="text-muted-foreground/70 mb-2 text-xs font-medium tracking-wider uppercase">
          Price History
        </h3>
        <PriceDropChart events={displayEvents} />
      </div>

      {/* ── Market Intelligence ── */}
      {job.market_range && job.market_range.sample_size > 0 ? (
        <div className="px-4 pb-2 sm:px-6">
          <MarketRangeDisplay
            marketRange={job.market_range}
            currentBidCents={displayLowest > 0 ? displayLowest : undefined}
          />
        </div>
      ) : null}

      {/* ── Social proof ── */}
      {displayBidCount > 0 ? (
        <div className="px-4 pb-4 text-center sm:px-6">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-semibold">
              {String(displayBidCount)} provider{displayBidCount !== 1 ? 's' : ''}
            </span>{' '}
            competing for your job
          </p>
        </div>
      ) : null}

      {/* ── Bid form for providers ── */}
      {isProvider && !isJobOwner && job.status === 'active' ? (
        <div className="border-border/30 border-t px-4 py-4 sm:px-6">
          <BidForm
            jobId={job.id}
            existingBid={null}
            startingBidCents={job.starting_bid_cents}
            offerAcceptedCents={job.offer_accepted_cents}
            marketRange={job.market_range}
            auctionEndsAt={displayEndsAt}
          />
        </div>
      ) : null}
    </div>
  );
}

function CountdownCell({ endsAt }: { endsAt: string | null | undefined }) {
  const { label, urgency } = useCountdown(endsAt);

  const colorMap = {
    normal: 'text-foreground',
    warning: 'text-amber-400',
    critical: 'text-red-400',
    extreme: 'text-red-500',
    ended: 'text-muted-foreground',
  } as const;

  return (
    <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
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
