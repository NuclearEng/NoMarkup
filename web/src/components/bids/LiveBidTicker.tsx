'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, Eye, Clock, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiveBidTickerProps {
  currentBid: number;
  previousBid?: number;
  startingPrice: number;
  timeRemaining?: string;
  totalBids: number;
  watcherCount?: number;
  className?: string;
}

export function LiveBidTicker({
  currentBid,
  previousBid,
  startingPrice,
  timeRemaining,
  totalBids,
  watcherCount = 0,
  className,
}: LiveBidTickerProps) {
  const savings =
    startingPrice > 0 ? Math.round(((startingPrice - currentBid) / startingPrice) * 100) : 0;
  const direction = previousBid
    ? currentBid < previousBid
      ? 'down'
      : currentBid > previousBid
        ? 'up'
        : 'flat'
    : 'flat';
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (previousBid && currentBid !== previousBid) {
      setFlash(true);
      const timer = setTimeout(() => { setFlash(false); }, 600);
      return () => { clearTimeout(timer); };
    }
  }, [currentBid, previousBid]);

  return (
    <div className={cn('bg-card rounded-2xl border p-6', className)}>
      {/* Price header */}
      <div className="text-muted-foreground mb-1 flex items-center gap-2 text-sm">
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Current lowest bid</span>
      </div>

      {/* Main price display */}
      <div className="flex items-baseline gap-3">
        <span
          className={cn(
            'text-4xl font-bold tracking-tight tabular-nums transition-colors duration-300 sm:text-5xl',
            flash && direction === 'down' && 'text-emerald-500',
            flash && direction === 'up' && 'text-red-500',
            !flash && 'text-foreground',
          )}
          role="status"
          aria-live="polite"
          aria-label={`Current lowest bid: $${(currentBid / 100).toFixed(2)}`}
        >
          ${(currentBid / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
        {direction !== 'flat' && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold',
              direction === 'down'
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
            )}
          >
            <TrendingDown
              className={cn('h-3.5 w-3.5', direction === 'up' && 'rotate-180')}
              aria-hidden="true"
            />
            {savings}% below ask
          </span>
        )}
      </div>

      {/* Starting price reference */}
      <p className="text-muted-foreground mt-1 text-sm">
        Starting price:{' '}
        <span className="line-through">
          ${(startingPrice / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      </p>

      {/* Stats bar */}
      <div className="text-muted-foreground mt-4 flex items-center gap-6 border-t pt-4 text-sm">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-foreground font-medium">{totalBids}</span> bids
        </div>
        {watcherCount > 0 && (
          <div className="flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground font-medium">{watcherCount}</span> watching
          </div>
        )}
        {timeRemaining && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground font-medium">{timeRemaining}</span> left
          </div>
        )}
      </div>
    </div>
  );
}
