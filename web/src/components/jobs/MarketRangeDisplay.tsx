'use client';

import { formatCents } from '@/lib/utils';
import type { MarketRange } from '@/types';

interface MarketRangeDisplayProps {
  marketRange: MarketRange;
}

export function MarketRangeDisplay({ marketRange }: MarketRangeDisplayProps) {
  const { low_cents, median_cents, high_cents, sample_size } = marketRange;

  // Calculate median position as percentage between low and high
  const range = high_cents - low_cents;
  const medianPosition = range > 0 ? ((median_cents - low_cents) / range) * 100 : 50;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Market Range</h4>
        <span className="text-xs text-muted-foreground">
          Based on {String(sample_size)} similar job{sample_size !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Bar visualization */}
      <div className="relative pt-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Low</span>
          <span>Median</span>
          <span>High</span>
        </div>
        <div className="relative mt-1 h-3 w-full overflow-hidden rounded-full bg-muted">
          {/* Gradient bar */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400" />
          {/* Median indicator */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${String(medianPosition)}%` }}
            aria-label={`Median at ${formatCents(median_cents)}`}
          />
        </div>
        <div className="mt-1 flex justify-between text-sm font-medium">
          <span>{formatCents(low_cents)}</span>
          <span>{formatCents(median_cents)}</span>
          <span>{formatCents(high_cents)}</span>
        </div>
      </div>
    </div>
  );
}
