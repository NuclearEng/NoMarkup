'use client';

import { Loader2, ShieldCheck, Undo2, Zap } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { BidBondPrompt } from '@/components/compliance/BidBondPrompt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LISTING_BID_RETRACT_WINDOW_MS } from '@/lib/listing-bid-retract';
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
  /**
   * The user's standing confidential max-bid for this listing (only set
   * when they are the current high bidder). When provided, the panel
   * surfaces an "Auto-bidding active up to $X" badge so the bidder
   * remembers the auction is defending them automatically.
   */
  userMaxBidCents?: number | null;
  /**
   * Listing id, required when `bidBondRequirement` is non-null so the
   * inline bond flow knows where to POST.
   */
  listingId?: string;
  /**
   * Set when the most recent placeBid call returned 402 with a
   * `requires_bid_bond` envelope. The panel renders the bond prompt
   * + Stripe Elements; once the bond is authorized, `onBidBondAuthorized`
   * fires and the parent retries the bid.
   */
  bidBondRequirement?: { bond_amount_cents: number } | null;
  /**
   * Called after the bid bond is successfully authorized. Parents should
   * retry the place-bid mutation with the same amount/maxBid.
   */
  onBidBondAuthorized?: () => void;
  /**
   * Place a bid. `maxBidCents` is the buyer's confidential ceiling for
   * eBay-style proxy bidding; omit (undefined) when the bid is exactly
   * `amountCents` with no autobid headroom.
   */
  onPlaceBid: (amountCents: number, maxBidCents?: number) => void;
  /**
   * eBay-style 60s retract for the caller's current high bid (detail parity
   * with My Bids). When set with `onRetractBid`, a Retract control is shown
   * while the server window remains open.
   */
  retractableBid?: { bidId: string; createdAt: string } | null;
  isRetracting?: boolean;
  onRetractBid?: () => void;
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
  userMaxBidCents,
  listingId,
  bidBondRequirement,
  onBidBondAuthorized,
  onPlaceBid,
  retractableBid,
  isRetracting = false,
  onRetractBid,
  className,
}: ListingBidPanelProps) {
  const minBidCents = useMemo(
    () => currentBidCents + Math.max(100, minIncrementCents),
    [currentBidCents, minIncrementCents],
  );

  const [bidDollars, setBidDollars] = useState<number>(minBidCents / 100);
  // Confidential max-bid (proxy ceiling). Initialized to match the
  // visible bid; the user can raise it independently. Cannot fall below
  // the visible bid — see the merging logic below.
  const [maxDollars, setMaxDollars] = useState<number>(minBidCents / 100);
  const [error, setError] = useState<string | null>(null);

  // Tick while a retract window may still be open (matches MyListingBidCard).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!retractableBid || !isUserWinning || isAuctionExpired) {
      setNowMs(null);
      return;
    }
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [retractableBid, isUserWinning, isAuctionExpired]);

  const retractRemainingMs = useMemo(() => {
    if (!retractableBid || nowMs === null) return 0;
    const created = Date.parse(retractableBid.createdAt);
    if (!Number.isFinite(created)) return 0;
    return Math.max(0, created + LISTING_BID_RETRACT_WINDOW_MS - nowMs);
  }, [retractableBid, nowMs]);
  const canRetract =
    Boolean(retractableBid) &&
    isUserWinning &&
    !isAuctionExpired &&
    retractRemainingMs > 0 &&
    typeof onRetractBid === 'function';
  const retractRemainingSec = Math.ceil(retractRemainingMs / 1000);

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
    setMaxDollars((m) => {
      const cents = Math.round(m * 100);
      if (cents < minBidCents) return minBidCents / 100;
      return m;
    });
  }, [minBidCents]);

  // The max ceiling can never sit below the visible bid amount.
  useEffect(() => {
    const bidCents = Math.round(bidDollars * 100);
    setMaxDollars((m) => {
      const maxCents = Math.round(m * 100);
      if (maxCents < bidCents) return bidDollars;
      return m;
    });
  }, [bidDollars]);

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
    const maxCents = Math.round(maxDollars * 100);
    if (Number.isFinite(maxCents) && maxCents < cents) {
      setError('Max bid cannot be below your bid');
      return;
    }
    setError(null);
    // Only forward maxBidCents when it strictly exceeds the visible bid.
    // Equal max == no autobid headroom, which is the same as omitting it.
    if (Number.isFinite(maxCents) && maxCents > cents) {
      onPlaceBid(cents, maxCents);
    } else {
      onPlaceBid(cents);
    }
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
          <Link href={'/login' as Route}>Sign in to bid</Link>
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
          className="flex items-center gap-2 rounded-md border border-trust-medium/30 bg-trust-medium/10 px-2.5 py-1.5 text-xs text-trust-medium"
          data-testid="snipe-extension-flash"
        >
          <Zap className="h-3.5 w-3.5 text-trust-medium" aria-hidden="true" />
          <span className="font-semibold">+30s — auction extended</span>
        </div>
      ) : null}

      {/* Bid bond pre-auth (first-time bidders) — renders when the parent's
          place-bid mutation returned 402. The prompt mints a SetupIntent,
          collects payment via Stripe Elements, and confirms the bond. On
          success the parent retries the bid via onBidBondAuthorized. */}
      {bidBondRequirement && listingId ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-trust-medium/30 bg-trust-medium/5 p-3 text-xs text-trust-medium"
          data-testid="bid-bond-prompt-host"
        >
          <div className="mb-2 flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-trust-medium" aria-hidden="true" />
            <div>
              <p className="font-semibold text-trust-medium">
                One-time bid bond ({formatCents(bidBondRequirement.bond_amount_cents)})
              </p>
              <p className="mt-1 text-trust-medium/80">
                First-time bidders post a small bond to keep auctions honest.
                Refunded the moment you complete or lose the auction.
              </p>
            </div>
          </div>
          <BidBondPrompt
            listingId={listingId}
            intendedBidCents={Math.round(bidDollars * 100)}
            onAuthorized={() => {
              if (onBidBondAuthorized) onBidBondAuthorized();
            }}
          />
        </div>
      ) : null}

      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          Place your bid
        </p>
        {isUserWinning ? (
          <span
            className="inline-flex items-center rounded-full bg-bid-winning/15 px-2 py-0.5 text-[11px] font-semibold text-bid-winning"
            role="status"
          >
            You&rsquo;re winning
          </span>
        ) : null}
      </div>

      {isUserWinning && typeof userMaxBidCents === 'number' && userMaxBidCents > currentBidCents ? (
        <div
          className="flex items-center gap-2 rounded-md border border-bid-winning/20 bg-bid-winning/5 px-2.5 py-1.5 text-xs text-bid-winning"
          data-testid="autobid-active-label"
          aria-live="polite"
        >
          <Zap className="h-3.5 w-3.5 text-bid-winning" aria-hidden="true" />
          <span>Auto-bidding active up to {formatCents(userMaxBidCents)}</span>
        </div>
      ) : null}

      {canRetract ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] w-full gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={isRetracting || isSubmitting}
          onClick={() => {
            onRetractBid?.();
          }}
          aria-label={`Retract bid (${String(retractRemainingSec)} seconds remaining)`}
          data-testid="listing-retract-bid"
        >
          {isRetracting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Retracting…
            </>
          ) : (
            <>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Retract bid ({String(retractRemainingSec)}s)
            </>
          )}
        </Button>
      ) : null}

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

      <div className="space-y-2">
        <Label htmlFor="listing-max-bid" className="text-xs text-zinc-400">
          Set max bid (optional)
        </Label>
        <Input
          id="listing-max-bid"
          type="number"
          min={Math.max(minBidCents, Math.round(bidDollars * 100)) / 100}
          step="0.01"
          variant="glass"
          inputMode="decimal"
          value={Number.isFinite(maxDollars) ? maxDollars : ''}
          aria-describedby="listing-max-bid-help"
          onChange={(e) => {
            const v = Number(e.target.value);
            setMaxDollars(Number.isFinite(v) ? v : 0);
            if (error) setError(null);
          }}
        />
        <p id="listing-max-bid-help" className="text-[11px] text-zinc-500">
          We&rsquo;ll auto-bid for you up to this amount, only as much as needed to keep you on top.
        </p>
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
        <p id="listing-bid-error" className="text-sm text-destructive" role="alert">
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
