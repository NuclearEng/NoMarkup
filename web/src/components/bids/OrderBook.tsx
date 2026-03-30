'use client';

import { useEffect, useRef } from 'react';
import { Award, Shield, Star, TrendingDown, User } from 'lucide-react';

import { cn } from '@/lib/utils';

interface OrderBookBid {
  id: string;
  provider_name: string;
  amount_cents: number;
  trust_score: number;
  trust_tier: string;
  created_at: string;
  is_new?: boolean;
}

interface OrderBookProps {
  jobId: string;
  bids: OrderBookBid[];
  startingPrice: number;
  className?: string;
}

const TRUST_TIER_CONFIG = {
  top_rated: { label: 'Top Rated', icon: Star, colorClass: 'text-amber-400' },
  trusted: { label: 'Trusted', icon: Shield, colorClass: 'text-emerald-400' },
  rising: { label: 'Rising', icon: TrendingDown, colorClass: 'text-blue-400' },
  new: { label: 'New', icon: User, colorClass: 'text-muted-foreground' },
  under_review: { label: 'Review', icon: User, colorClass: 'text-muted-foreground/60' },
} as const;

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${String(diffHr)}h ago`;
}

export function OrderBook({ jobId, bids, startingPrice, className }: OrderBookProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the top (winning) bid visible
  useEffect(() => {
    if (scrollRef.current && bids.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [bids.length]);

  // Sort by price ascending (lowest = best = first)
  const sortedBids = [...bids].sort((a, b) => a.amount_cents - b.amount_cents);
  const lowestAmount = sortedBids.length > 0 ? (sortedBids[0] as OrderBookBid).amount_cents : 0;

  if (sortedBids.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-border/50 bg-card p-6 text-center',
          className,
        )}
        role="region"
        aria-label={`Order book for job ${jobId}`}
      >
        <p className="text-sm text-muted-foreground">
          No bids yet. The order book will populate as providers compete.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn('rounded-xl border border-border/50 bg-card overflow-hidden', className)}
      role="region"
      aria-label={`Order book showing ${String(sortedBids.length)} bids for job`}
    >
      <style>{`
        @keyframes orderBookFlash {
          0% { background-color: rgba(34, 197, 94, 0.25); }
          100% { background-color: transparent; }
        }
        @keyframes lowestPulse {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.4); }
          50% { box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.7), 0 0 12px rgba(245, 158, 11, 0.15); }
        }
        @keyframes lowestBadgePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-muted-foreground/70">
          Order Book
        </h3>
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {String(sortedBids.length)} bid{sortedBids.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_auto_auto_auto] items-center gap-2 border-b border-border/20 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
        <span>#</span>
        <span>Provider</span>
        <span className="text-right">Trust</span>
        <span className="min-w-[4.5rem] text-right">Price</span>
        <span className="min-w-[3.5rem] text-right">Time</span>
      </div>

      {/* Bid rows */}
      <div
        ref={scrollRef}
        className="max-h-[360px] overflow-y-auto"
        role="list"
        aria-label="Bid entries sorted by price"
      >
        {sortedBids.map((bid, index) => {
          const isLowest = bid.amount_cents === lowestAmount;
          const barWidth =
            startingPrice > 0
              ? Math.max(5, Math.min(100, (bid.amount_cents / startingPrice) * 100))
              : 50;

          // Green gradient: lower price = darker green
          const greenIntensity =
            startingPrice > 0
              ? Math.max(0.04, 0.2 - (bid.amount_cents / startingPrice) * 0.16)
              : 0.08;

          const tierKey = bid.trust_tier as keyof typeof TRUST_TIER_CONFIG;
          const tierConfig = TRUST_TIER_CONFIG[tierKey] ?? TRUST_TIER_CONFIG.new;
          const TierIcon = tierConfig.icon;

          return (
            <div
              key={bid.id}
              className={cn(
                'relative grid grid-cols-[2rem_1fr_auto_auto_auto] items-center gap-2 px-4 py-2.5 transition-colors',
                isLowest && 'border-l-2 border-l-amber-500/60',
              )}
              style={{
                animation: bid.is_new ? 'orderBookFlash 2s ease-out forwards' : undefined,
                ...(isLowest
                  ? { animation: 'lowestPulse 3s ease-in-out infinite' }
                  : {}),
              }}
              role="listitem"
              aria-label={`Rank ${String(index + 1)}: ${bid.provider_name}, ${formatPrice(bid.amount_cents)}${isLowest ? ', current lowest bid' : ''}`}
            >
              {/* Depth bar background */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(90deg, rgba(34, 197, 94, ${String(greenIntensity)}) 0%, rgba(34, 197, 94, 0) ${String(barWidth)}%)`,
                }}
                aria-hidden="true"
              />

              {/* Rank */}
              <span
                className={cn(
                  'relative z-10 text-xs font-bold tabular-nums',
                  isLowest ? 'text-amber-400' : 'text-muted-foreground',
                )}
              >
                #{String(index + 1)}
              </span>

              {/* Provider */}
              <div className="relative z-10 flex items-center gap-2 min-w-0">
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                    isLowest
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <User className="h-3 w-3" aria-hidden="true" />
                </div>
                <span className="truncate text-xs font-medium">{bid.provider_name}</span>
                {isLowest && (
                  <span
                    className="inline-flex items-center gap-0.5 shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400"
                    style={{ animation: 'lowestBadgePulse 2s ease-in-out infinite' }}
                  >
                    <Award className="h-2.5 w-2.5" aria-hidden="true" />
                    Lowest
                  </span>
                )}
              </div>

              {/* Trust badge */}
              <div
                className={cn(
                  'relative z-10 flex items-center gap-1',
                  tierConfig.colorClass,
                )}
                title={`${tierConfig.label} (${String(bid.trust_score)})`}
              >
                <TierIcon className="h-3 w-3" aria-hidden="true" />
                <span className="text-[10px] font-medium tabular-nums">
                  {String(bid.trust_score)}
                </span>
              </div>

              {/* Price */}
              <span
                className={cn(
                  'relative z-10 min-w-[4.5rem] text-right text-xs font-bold tabular-nums',
                  isLowest ? 'text-green-400' : 'text-foreground',
                )}
              >
                {formatPrice(bid.amount_cents)}
              </span>

              {/* Time */}
              <span className="relative z-10 min-w-[3.5rem] text-right text-[10px] tabular-nums text-muted-foreground">
                {getTimeAgo(bid.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
