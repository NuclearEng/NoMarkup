'use client';

import { cn } from '@/lib/utils';

interface TickerItem {
  category: string;
  location: string;
  currentPrice: number;
  originalPrice?: number;
  bidCount?: number;
  timeRemaining?: string;
  status: 'active' | 'completed' | 'ending-soon';
}

interface MarketTickerStripProps {
  items: TickerItem[];
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
  const statusColor =
    item.status === 'completed'
      ? 'text-emerald-400'
      : item.status === 'ending-soon'
        ? 'text-amber-400'
        : 'text-slate-300';

  const priceColor =
    item.status === 'completed' ? 'text-emerald-400' : 'text-white';

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-4 text-sm">
      <span className="font-medium text-white/90">
        {item.category} in {item.location}
      </span>
      <span className="text-white/40">&mdash;</span>
      <span className={cn('font-semibold tabular-nums', priceColor)}>
        {formatPrice(item.currentPrice)}
      </span>
      {item.originalPrice ? (
        <span className="text-white/40 line-through tabular-nums text-xs">
          {formatPrice(item.originalPrice)}
        </span>
      ) : null}
      {item.status === 'completed' ? (
        <span className={cn('text-xs font-medium', statusColor)}>
          &#10003;
        </span>
      ) : null}
      {item.bidCount !== undefined ? (
        <span className="text-white/50 text-xs">
          {String(item.bidCount)} bids
        </span>
      ) : null}
      {item.timeRemaining ? (
        <span className={cn('text-xs', statusColor)}>
          {item.timeRemaining}
        </span>
      ) : null}
    </span>
  );
}

export function MarketTickerStrip({
  items,
  speed = 'normal',
  className,
}: MarketTickerStripProps) {
  const duration = SPEED_DURATION[speed];

  // Duplicate items for seamless infinite loop
  const allItems = [...items, ...items];

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
          <span key={`${item.category}-${item.location}-${String(i)}`} className="inline-flex items-center">
            <TickerItemDisplay item={item} />
            <span className="text-white/20 px-2" aria-hidden="true">
              &#x2022;
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
