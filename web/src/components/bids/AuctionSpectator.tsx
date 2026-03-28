'use client';

import Link from 'next/link';
import { Eye, TrendingUp, Users, Zap } from 'lucide-react';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';
import { PriceDropChart } from '@/components/bids/PriceDropChart';
import { useCountdown } from '@/hooks/useCountdown';
import { useSpectatorStream } from '@/hooks/useSpectatorStream';

interface AuctionSpectatorProps {
  jobId: string;
  jobTitle: string;
  categoryName: string;
  auctionEndsAt: string | null;
  startingBidCents: number | null;
}

function getUrgency(totalSeconds: number, isExpired: boolean) {
  if (isExpired) return 'ended' as const;
  if (totalSeconds > 3600) return 'normal' as const;
  if (totalSeconds > 900) return 'warning' as const;
  if (totalSeconds > 300) return 'critical' as const;
  return 'extreme' as const;
}

export function AuctionSpectator({
  jobId,
  jobTitle,
  categoryName,
  auctionEndsAt,
  startingBidCents,
}: AuctionSpectatorProps) {
  const {
    events,
    connectionStatus,
    currentLowest,
    bidCount,
    spectatorCount,
    isConnected,
  } = useSpectatorStream(jobId);

  const { timeLeft: countdownLabel, isExpired, totalSeconds } = useCountdown(auctionEndsAt);
  const urgency = getUrgency(totalSeconds, isExpired);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const savingsCents =
    startingBidCents && currentLowest > 0 ? startingBidCents - currentLowest : 0;

  const countdownColorMap = {
    normal: 'text-foreground',
    warning: 'text-amber-400',
    critical: 'text-red-400',
    extreme: 'text-red-500',
    ended: 'text-muted-foreground',
  } as const;

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

      {/* Header banner */}
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
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">
              SPECTATOR
            </span>
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

      {/* Job info */}
      <div className="border-border/30 border-b px-4 py-3 sm:px-6">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {categoryName}
        </p>
        <h3 className="text-foreground mt-0.5 text-base font-semibold leading-tight">
          {jobTitle}
        </h3>
      </div>

      {/* Hero price display */}
      <div className="px-4 pt-5 pb-2 text-center sm:px-6 sm:pt-6">
        {startingBidCents && startingBidCents > 0 && currentLowest > 0 ? (
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Starting at {formatCurrency(startingBidCents)}
          </p>
        ) : null}

        <div
          className="text-4xl font-black tracking-tight text-green-500 sm:text-5xl"
          role="status"
          aria-live="polite"
          aria-label={
            currentLowest > 0
              ? `Current lowest bid: ${formatCurrency(currentLowest)}`
              : 'No bids yet'
          }
        >
          <AnimatedPrice cents={currentLowest} formatCurrency={formatCurrency} />
        </div>

        <p className="text-muted-foreground mt-1 text-xs">Current Lowest Bid</p>

        {/* Savings pill */}
        {savingsCents > 0 ? (
          <div
            className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3.5 py-1.5"
            role="status"
            aria-label={`Saving ${formatCurrency(savingsCents)} versus starting price`}
            style={{ animation: 'savingsPulse 3s ease-in-out infinite' }}
          >
            <TrendingUp className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
            <span className="text-xs font-bold text-green-400">
              Saving {formatCurrency(savingsCents)} vs starting price
            </span>
          </div>
        ) : null}
      </div>

      {/* Stats row */}
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
            aria-label={`${String(bidCount)} total bids`}
          >
            {String(bidCount)}
          </p>
        </div>

        {/* Countdown */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
          <div className="flex items-center gap-1">
            <Zap className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Time Left
            </span>
          </div>
          <p
            className={`text-xl font-bold tabular-nums sm:text-2xl ${countdownColorMap[urgency]}`}
            role="timer"
            aria-live="polite"
            aria-label={`Time remaining: ${countdownLabel}`}
            style={
              urgency === 'extreme'
                ? { animation: 'countdownPulse 1s ease-in-out infinite' }
                : undefined
            }
          >
            {countdownLabel}
          </p>
        </div>

        {/* Spectator count */}
        <div className="bg-card flex flex-col items-center gap-0.5 px-3 py-3">
          <div className="flex items-center gap-1">
            <Eye className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
              Watching
            </span>
          </div>
          <p
            className="text-xl font-bold tabular-nums sm:text-2xl"
            role="status"
            aria-live="polite"
            aria-label={`${String(spectatorCount)} people watching`}
          >
            {String(spectatorCount)}
          </p>
        </div>
      </div>

      {/* Price History Chart */}
      <div className="px-4 pb-2 sm:px-6">
        <h3 className="text-muted-foreground/70 mb-2 text-xs font-medium tracking-wider uppercase">
          Price History
        </h3>
        <PriceDropChart events={events} />
      </div>

      {/* Social proof */}
      {bidCount > 0 ? (
        <div className="px-4 pb-4 text-center sm:px-6">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-semibold">
              {String(bidCount)} provider{bidCount !== 1 ? 's' : ''}
            </span>{' '}
            competing to offer the lowest price
          </p>
        </div>
      ) : null}

      {/* Delayed data notice */}
      <div className="border-border/30 border-t px-4 py-2 text-center sm:px-6">
        <p className="text-muted-foreground/60 text-[10px]">
          Spectator view &mdash; data delayed by 3 seconds. Provider identities hidden.
        </p>
      </div>

      {/* CTA */}
      <div className="border-border/30 border-t px-4 py-5 text-center sm:px-6">
        <p className="text-foreground mb-3 text-sm font-semibold">
          Want to save on your next project?
        </p>
        <Link
          href="/register"
          className="inline-flex items-center justify-center rounded-lg bg-green-500 px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-green-400 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          style={{ minHeight: '44px', minWidth: '44px' }}
        >
          Post Your Job &mdash; It&apos;s Free
        </Link>
        <p className="text-muted-foreground mt-2 text-xs">
          Providers compete, you save. Average savings of 23%.
        </p>
      </div>
    </div>
  );
}
