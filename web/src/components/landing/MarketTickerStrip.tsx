'use client';

import { useMemo } from 'react';

import {
  usePricingOverview,
  type PricingOverviewCategory,
} from '@/hooks/usePricing';
import { cn } from '@/lib/utils';

import {
  pricingCategoriesToTickerItems,
  type TickerItem,
} from './ticker-items';

export type { TickerItem } from './ticker-items';
export { pricingCategoriesToTickerItems } from './ticker-items';

interface MarketTickerStripProps {
  /**
   * Optional pre-supplied items (RSC seed or story fixtures). When provided,
   * the strip skips the client pricing fetch so first paint is real ticker
   * content with no skeleton.
   */
  items?: TickerItem[];
  /**
   * Server-seeded pricing overview. Used when `items` is omitted so the
   * strip can hydrate from TanStack `initialData` without a loading flash.
   */
  initialPricing?: { categories: PricingOverviewCategory[] };
  speed?: 'slow' | 'normal' | 'fast';
  className?: string;
}

const SPEED_DURATION: Record<NonNullable<MarketTickerStripProps['speed']>, string> = {
  slow: '60s',
  normal: '40s',
  fast: '25s',
};

function formatPrice(cents: number): string {
  return `$${String(Math.round(cents / 100))}`;
}

function TickerItemDisplay({ item }: { item: TickerItem }) {
  const isCompleted = item.status === 'completed';
  const isEndingSoon = item.status === 'ending-soon';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 px-5 text-sm whitespace-nowrap',
        isEndingSoon && 'animate-ticker-pulse',
      )}
    >
      <span className="font-medium text-white/80">{item.category}</span>
      <span className="text-white/25">in</span>
      <span className="font-medium text-white/80">{item.location}</span>
      <span
        className={cn(
          'text-base font-bold tabular-nums',
          isCompleted ? 'text-emerald-400' : isEndingSoon ? 'text-amber-300' : 'text-white',
        )}
      >
        {formatPrice(item.currentPrice)}
      </span>
      {item.originalPrice ? (
        <span className="text-xs text-white/65 tabular-nums line-through">
          {formatPrice(item.originalPrice)}
        </span>
      ) : null}
      {isCompleted ? (
        <span className="inline-flex items-center justify-center rounded-full bg-emerald-500/15 p-0.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
          </svg>
        </span>
      ) : null}
      {item.bidCount !== undefined ? (
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/65 tabular-nums">
          {String(item.bidCount)} bids
        </span>
      ) : null}
      {item.timeRemaining ? (
        <span className="text-xs font-medium text-amber-400">{item.timeRemaining}</span>
      ) : null}
    </span>
  );
}

function TickerSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-black/30 backdrop-blur-md',
        'border-b border-white/5',
        className,
      )}
      // role="status" — a plain <div> has the generic role, which PROHIBITS
      // aria-label (axe: aria-prohibited-attr, WCAG 4.1.2). status permits the
      // label and is the right semantic for a transient loading region.
      role="status"
      aria-label="Loading marketplace activity"
      aria-busy="true"
    >
      <div className="flex items-center gap-6 py-2.5 px-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={`ticker-skel-${String(i)}`}
            className="inline-block h-3 w-32 shrink-0 rounded-full bg-white/[0.06]"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

export function MarketTickerStrip({
  items,
  initialPricing,
  speed = 'normal',
  className,
}: MarketTickerStripProps) {
  const duration = SPEED_DURATION[speed];

  // Skip the client fetch when the parent already supplied resolved items
  // (RSC seed path). When only a raw pricing snapshot is seeded, still run
  // the query with initialData so first paint is instant and background
  // refresh stays available for other consumers of the same key.
  const seededItems = items !== undefined;
  const { data, isLoading, isError } = usePricingOverview({
    enabled: !seededItems,
    ...(initialPricing !== undefined && !seededItems
      ? { initialData: initialPricing }
      : {}),
  });

  const resolvedItems = useMemo<TickerItem[]>(() => {
    if (items) return items;
    if (!data) return [];
    return pricingCategoriesToTickerItems(data.categories);
  }, [items, data]);

  // When the parent didn't supply items and the API failed (and we have no
  // initialData), hide the strip gracefully instead of crashing the hero.
  if (!seededItems && isError && !data) {
    return null;
  }

  // Loading only when unseeded and no initialData has landed yet.
  if (!seededItems && isLoading && !data) {
    return <TickerSkeleton className={className} />;
  }

  // No items to show after fetch — hide rather than render an empty marquee.
  if (resolvedItems.length === 0) {
    return null;
  }

  // Duplicate items for seamless infinite loop
  const allItems = [...resolvedItems, ...resolvedItems];

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-black/30 backdrop-blur-md',
        'border-b border-white/5',
        className,
      )}
      aria-label="Live marketplace activity"
      role="marquee"
    >
      <div
        className="ticker-track flex items-center py-2.5 hover:[animation-play-state:paused]"
        style={{
          animationDuration: duration,
        }}
      >
        {allItems.map((item, i) => (
          <span
            key={`${item.category}-${item.location}-${String(i)}`}
            className="inline-flex items-center"
          >
            <TickerItemDisplay item={item} />
            <span className="mx-1 inline-block h-3 w-px bg-white/15" aria-hidden="true" />
          </span>
        ))}
      </div>
    </div>
  );
}
