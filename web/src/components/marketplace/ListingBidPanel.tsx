'use client';

import { Loader2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatCents } from '@/lib/utils';

interface ListingBidPanelProps {
  currentBidCents: number;
  minIncrementCents: number;
  isAuthenticated: boolean;
  isOwnListing: boolean;
  isUserWinning: boolean;
  isSubmitting: boolean;
  isAuctionExpired: boolean;
  /** ISO timestamp of the most recent live bid event from the spectator socket. */
  lastLiveBidTimestamp?: string | null;
  /** Whether the most recent live bid extended the auction (snipe extension). */
  lastLiveBidExtended?: boolean;
  onPlaceBid: (amountCents: number) => void;
  className?: string;
}

/** Window during which a fresh live bid pulses + extension banner shows (ms). */
const LIVE_BID_HIGHLIGHT_MS = 3_000;

const QUICK_INCREMENTS = [500, 1000, 2000, 5000];

export function ListingBidPanel({
  currentBidCents,
  minIncrementCents,
  isAuthenticated,
  isOwnListing,
  isUserWinning,
  isSubmitting,
  isAuctionExpired,
  lastLiveBidTimestamp,
  lastLiveBidExtended,
  onPlaceBid,
  className,
}: ListingBidPanelProps) {
  const minBidCents = useMemo(
    () => currentBidCents + Math.max(100, minIncrementCents),
    [currentBidCents, minIncrementCents],
  );

  const [bidDollars, setBidDollars] = useState<number>(minBidCents / 100);
  const [error, setError] = useState<string | null>(null);

  // Pulse highlight + snipe banner are visible for LIVE_BID_HIGHLIGHT_MS after
  // a fresh bid_event arrives via the spectator socket.
  const [highlightLive, setHighlightLive] = useState<boolean>(false);
  useEffect(() => {
    if (!lastLiveBidTimestamp) return;
    setHighlightLive(true);
    const t = setTimeout(() => {
      setHighlightLive(false);
    }, LIVE_BID_HIGHLIGHT_MS);
    return () => {
      clearTimeout(t);
    };
  }, [lastLiveBidTimestamp]);

  useEffect(() => {
    setBidDollars((d) => {
      const cents = Math.round(d * 100);
      if (cents < minBidCents) return minBidCents / 100;
      return d;
    });
  }, [minBidCents]);

  function applyIncrement(deltaCents: number) {
    const nextCents = Math.max(minBidCents, Math.round(bidDollars * 100) + deltaCents);
    setBidDollars(nextCents / 100);
    setError(null);
  }

  function submit() {
    const cents = Math.round(bidDollars * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a bid amount');
      return;
    }
    if (cents < minBidCents) {
      setError(`Bid must be at least ${formatCents(minBidCents)}`);
      return;
    }
    setError(null);
    onPlaceBid(cents);
  }

  if (isOwnListing) {
    return (
      <div
        className={cn(
          'rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-400',
          className,
        )}
      >
        You are the seller. You cannot place a bid on your own listing.
      </div>
    );
  }

  if (isAuctionExpired) {
    return (
      <div
        className={cn(
          'rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-400',
          className,
        )}
      >
        Auction has ended. Bidding is closed.
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className={cn(
          'rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-300',
          className,
        )}
      >
        <p className="mb-3">Sign in to place a bid on this listing.</p>
        <Button asChild className="min-h-[44px] w-full">
          <a href="/login">Sign in to bid</a>
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border border-[var(--brand-gold)]/20 bg-white/[0.03] p-4 transition-colors duration-500',
        highlightLive && 'animate-pulse border-[var(--brand-gold)]/70 bg-[var(--brand-gold)]/10',
        className,
      )}
      data-live-pulse={highlightLive ? 'true' : 'false'}
    >
      {highlightLive && lastLiveBidExtended ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-100"
          data-testid="snipe-extension-flash"
        >
          <Zap className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
          <span className="font-semibold">+30s — auction extended</span>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          Place your bid
        </p>
        {isUserWinning ? (
          <span
            className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300"
            role="status"
          >
            You&rsquo;re winning
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="listing-bid-amount" className="text-xs text-zinc-400">
          Bid amount (min {formatCents(minBidCents)})
        </Label>
        <Input
          id="listing-bid-amount"
          type="number"
          min={minBidCents / 100}
          step="0.01"
          variant="glass"
          inputMode="decimal"
          value={Number.isFinite(bidDollars) ? bidDollars : ''}
          aria-invalid={error !== null}
          aria-describedby={error ? 'listing-bid-error' : undefined}
          onChange={(e) => {
            const v = Number(e.target.value);
            setBidDollars(Number.isFinite(v) ? v : 0);
            if (error) setError(null);
          }}
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {QUICK_INCREMENTS.map((cents) => (
          <Button
            key={cents}
            type="button"
            variant="outline"
            className="min-h-[44px] border-[var(--brand-gold)]/30 bg-white/[0.04] text-zinc-100 hover:bg-[var(--brand-gold)]/15"
            onClick={() => {
              applyIncrement(cents);
            }}
          >
            +${(cents / 100).toFixed(0)}
          </Button>
        ))}
      </div>

      {error ? (
        <p id="listing-bid-error" className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        className="min-h-[48px] w-full bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
        disabled={isSubmitting}
        onClick={submit}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Placing bid...
          </>
        ) : (
          <>Bid {formatCents(Math.max(minBidCents, Math.round(bidDollars * 100)))}</>
        )}
      </Button>
    </div>
  );
}
