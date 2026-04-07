'use client';

import { TrendingDown } from 'lucide-react';

import { formatCents } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface SavingsBadgeProps {
  lowestBidCents: number;
  marketMedianCents: number;
  className?: string;
}

/**
 * Shows a green pill badge when the current lowest bid is below the market median.
 * Renders null when there is no saving (i.e. lowestBid >= marketMedian).
 */
export function SavingsBadge({ lowestBidCents, marketMedianCents, className }: SavingsBadgeProps) {
  const savingsCents = marketMedianCents - lowestBidCents;

  if (savingsCents <= 0) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full',
        'border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1',
        'text-xs font-medium text-emerald-700 dark:text-emerald-400',
        className,
      )}
      aria-label={`Saves you ${formatCents(savingsCents)} versus market average`}
    >
      <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        Saves you {formatCents(savingsCents)} vs. market avg
      </span>
    </div>
  );
}
