'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface BidPlacementPanelProps {
  currentLowest: number;
  startingPrice: number;
  onPlaceBid?: (amount: number) => void;
  isSubmitting?: boolean;
  className?: string;
}

export function BidPlacementPanel({
  currentLowest,
  startingPrice,
  onPlaceBid,
  isSubmitting = false,
  className,
}: BidPlacementPanelProps) {
  // Suggest a bid slightly below current lowest
  const suggestedBid = Math.max(Math.round(currentLowest * 0.95), 100);
  const [bidCents, setBidCents] = useState(suggestedBid);

  // Keep the bid in range when a competing provider underbids and the
  // refetched `currentLowest` drops below the (stale) suggested amount.
  // `useState(suggestedBid)` only seeds the initial value, so without this
  // the amount stays anchored to the old lowest — the submit button then
  // silently disables (bidCents > currentLowest) even though the provider
  // never touched it. Re-clamp down to a fresh ~5% under the new lowest.
  useEffect(() => {
    setBidCents((prev) => (prev > currentLowest ? Math.max(Math.round(currentLowest * 0.95), 100) : prev));
  }, [currentLowest]);

  const savings =
    startingPrice > 0 ? Math.round(((startingPrice - bidCents) / startingPrice) * 100) : 0;
  const isBelowCurrent = bidCents < currentLowest;
  const isValid = bidCents > 0 && bidCents <= currentLowest;

  function adjustBid(delta: number) {
    setBidCents((prev) => Math.max(100, prev + delta));
  }

  const quickAmounts = [
    { label: '-5%', value: Math.round(currentLowest * 0.95) },
    { label: '-10%', value: Math.round(currentLowest * 0.9) },
    { label: '-15%', value: Math.round(currentLowest * 0.85) },
  ];

  return (
    <div className={cn('bg-card rounded-2xl border p-6', className)}>
      <h3 className="mb-4 text-sm font-semibold">Place your bid</h3>

      {/* Amount input with +/- controls */}
      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          onClick={() => { adjustBid(-500); }}
          disabled={bidCents <= 500}
          aria-label="Decrease bid by $5"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg font-semibold">
            $
          </span>
          <input
            type="number"
            value={(bidCents / 100).toFixed(2)}
            onChange={(e) => { setBidCents(Math.round(Number(e.target.value) * 100)); }}
            className="bg-background focus:ring-primary/20 h-11 w-full rounded-xl border pr-3 pl-8 text-center text-lg font-bold tabular-nums focus:ring-2 focus:outline-none"
            aria-label="Bid amount in dollars"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          onClick={() => { adjustBid(500); }}
          aria-label="Increase bid by $5"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Quick amount pills */}
      <div className="mb-4 flex gap-2">
        {quickAmounts.map((qa) => (
          <button
            key={qa.label}
            onClick={() => { setBidCents(qa.value); }}
            className={cn(
              'flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              bidCents === qa.value
                ? 'border-primary bg-primary/5 text-primary'
                : 'text-muted-foreground hover:border-foreground/20',
            )}
          >
            {qa.label}
          </button>
        ))}
      </div>

      {/* Savings indicator */}
      <div className="bg-muted/50 mb-4 rounded-lg px-3 py-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Your savings</span>
          <span
            className={cn(
              'font-semibold',
              savings > 0 ? 'text-bid-winning dark:text-bid-winning' : 'text-muted-foreground',
            )}
          >
            {savings}% below starting price
          </span>
        </div>
        {isBelowCurrent && (
          <div className="mt-1 flex items-center gap-1 text-xs text-bid-winning dark:text-bid-winning">
            <Zap className="h-3 w-3" aria-hidden="true" />
            This would be the new lowest bid!
          </div>
        )}
      </div>

      {/* Submit button */}
      <Button
        onClick={() => onPlaceBid?.(bidCents)}
        disabled={!isValid || isSubmitting}
        className="h-12 w-full rounded-xl bg-bid-winning text-base font-semibold text-background hover:bg-bid-winning/90 active:scale-[0.98]"
      >
        {isSubmitting ? 'Placing bid...' : <>Place bid — ${(bidCents / 100).toFixed(2)}</>}
      </Button>

      {!isValid && bidCents > currentLowest && (
        <p className="text-destructive mt-2 text-center text-xs">
          Bid must be at or below current lowest (${(currentLowest / 100).toFixed(2)})
        </p>
      )}
    </div>
  );
}
