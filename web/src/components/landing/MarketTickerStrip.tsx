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

export function MarketTickerStrip({ items, speed = 'normal', className }: MarketTickerStripProps) {
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
