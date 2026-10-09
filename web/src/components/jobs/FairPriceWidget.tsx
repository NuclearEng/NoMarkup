'use client';

import { useMarketRange } from '@/hooks/useAnalytics';
import { formatCents } from '@/lib/utils';

interface FairPriceWidgetProps {
  categoryId: string;
  currentLowestBidCents?: number | null;
}

function getBidPositionColor(
  lowestBidCents: number | null | undefined,
  lowCents: number,
  medianCents: number,
  highCents: number,
): string {
  if (!lowestBidCents) return 'text-zinc-400';
  if (lowestBidCents < medianCents) return 'text-bid-winning';
  if (lowestBidCents <= highCents) return 'text-trust-medium';
  return 'text-destructive';
}

export function FairPriceWidget({ categoryId, currentLowestBidCents }: FairPriceWidgetProps) {
  const { data: marketRange } = useMarketRange(categoryId);

  // Render nothing when there's no computed market data yet (has_data === false),
  // the request is still loading, or the sample is too small to be meaningful.
  // This is the normal empty state for a fresh category — not an error.
  if (!marketRange || !marketRange.has_data || marketRange.data_points < 3) {
    return null;
  }

  const { low_cents, median_cents, high_cents, data_points } = marketRange;
  const priceColor = getBidPositionColor(
    currentLowestBidCents,
    low_cents,
    median_cents,
    high_cents,
  );

  // Calculate where the lowest bid sits in the range for the bar indicator
  const rangeWidth = high_cents - low_cents;
  const indicatorPercent =
    currentLowestBidCents && rangeWidth > 0
      ? Math.min(100, Math.max(0, ((currentLowestBidCents - low_cents) / rangeWidth) * 100))
      : null;

  return (
    <div
      className="mt-2 rounded-md border border-[var(--brand-gold)]/10 bg-white/[0.03] p-2.5 space-y-1.5"
      aria-label="Fair market price range"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">Fair market</span>
        <span className={`font-mono text-xs font-semibold tabular-nums tracking-tight ${priceColor}`}>
          {formatCents(low_cents)} – {formatCents(high_cents)}
        </span>
      </div>

      {/* Range bar */}
      <div
        className="relative h-1 w-full rounded-full bg-white/[0.06] overflow-visible"
        role="presentation"
        aria-hidden="true"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-bid-winning/40 via-trust-medium/40 to-destructive/40" />
        {indicatorPercent !== null ? (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full bg-white border border-zinc-800 shadow"
            style={{ left: `${String(indicatorPercent)}%` }}
          />
        ) : null}
      </div>

      <p className="text-[10px] text-zinc-600">
        Based on {String(data_points)} local job{data_points !== 1 ? 's' : ''} · Median:{' '}
        <span className="font-mono tabular-nums tracking-tight">{formatCents(median_cents)}</span>
      </p>
    </div>
  );
}
