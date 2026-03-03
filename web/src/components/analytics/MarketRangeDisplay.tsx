'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import type { AnalyticsMarketRange } from '@/types';

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'text-emerald-600 dark:text-emerald-400';
  if (confidence >= 0.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

interface MarketRangeDisplayProps {
  range: AnalyticsMarketRange;
  className?: string;
}

export function MarketRangeDisplay({ range, className }: MarketRangeDisplayProps) {
  const { low_cents, median_cents, high_cents } = range;
  const totalRange = high_cents - low_cents;
  const medianPosition = totalRange > 0 ? ((median_cents - low_cents) / totalRange) * 100 : 50;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Market Price Range</h4>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {range.source}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {String(range.data_points)} data point{range.data_points !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Bar visualization */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Low</span>
          <span>Median</span>
          <span>High</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400" />
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${String(medianPosition)}%` }}
            aria-label={`Median price at ${formatCents(median_cents)}`}
          />
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>{formatCents(low_cents)}</span>
          <span>{formatCents(median_cents)}</span>
          <span>{formatCents(high_cents)}</span>
        </div>
      </div>

      {/* Confidence indicator */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Confidence</span>
        <span className={cn('font-semibold', getConfidenceColor(range.confidence))}>
          {getConfidenceLabel(range.confidence)} ({String(Math.round(range.confidence * 100))}%)
        </span>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Computed {new Date(range.computed_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </p>
    </div>
  );
}
