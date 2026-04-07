'use client';

import { useEffect, useRef } from 'react';
import { Shield, Star, TrendingDown, User } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

/** Grid column template — wider provider column to show full names */
const GRID_COLS = 'grid-cols-[2rem_minmax(8rem,1fr)_4.5rem_4.5rem]';
const GRID_COLS_SM = 'sm:grid-cols-[2rem_minmax(8rem,1fr)_3.5rem_5rem_3.5rem]';

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
          'rounded-xl border border-white/[0.06] bg-zinc-900/60 p-6 text-center',
          className,
        )}
        role="region"
        aria-label={`Order book for job ${jobId}`}
      >
        <p className="text-sm text-zinc-500">
          No bids yet. The order book will populate as providers compete.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn('overflow-hidden rounded-xl', className)}
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
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-zinc-900/40 px-4 py-2.5">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Order Book
        </h3>
        <span className="text-[10px] font-medium tabular-nums text-zinc-500">
          {String(sortedBids.length)} bid{sortedBids.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Column headers — mobile hides Trust, desktop shows all 5 */}
      <div
        className={cn(
          'grid items-center gap-3 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500',
          'border-b border-white/[0.06]',
          GRID_COLS,
          GRID_COLS_SM,
        )}
      >
        <span>#</span>
        <span>Provider</span>
        {/* Trust — hidden on mobile */}
        <span className="hidden text-right sm:block">Trust</span>
        <span className="text-right">Price</span>
        {/* Time — hidden on mobile, visible sm+ */}
        <span className="hidden text-right sm:block">Time</span>
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

          // Green gradient: lower price = more vibrant green against dark bg
          const greenIntensity =
            startingPrice > 0
              ? Math.max(0.08, 0.4 - (bid.amount_cents / startingPrice) * 0.32)
              : 0.12;

          const tierKey = bid.trust_tier as keyof typeof TRUST_TIER_CONFIG;
          const tierConfig = TRUST_TIER_CONFIG[tierKey] ?? TRUST_TIER_CONFIG.new;
          const TierIcon = tierConfig.icon;

          return (
            <div
              key={bid.id}
              className={cn(
                'relative grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]',
                GRID_COLS,
                GRID_COLS_SM,
                isLowest && 'border-l-2 border-l-[var(--brand-gold)] glass-tinted-amber',
                !isLowest && 'border-b border-b-white/[0.04]',
              )}
              style={{
                animation: bid.is_new ? 'orderBookFlash 2s ease-out forwards' : undefined,
                ...(isLowest
                  ? { animation: 'lowestPulse 3s ease-in-out infinite', boxShadow: 'inset 0 0 20px rgba(201,168,76,0.08)' }
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
                  isLowest ? 'text-[var(--brand-gold)]' : 'text-zinc-300',
                )}
                style={{ textShadow: isLowest ? '0 0 8px rgba(201,168,76,0.4)' : '0 1px 2px rgba(0,0,0,0.3)' }}
              >
                #{String(index + 1)}
              </span>

              {/* Provider — name gets full width, badge floats above */}
              <div className="relative z-10 flex items-center gap-2 min-w-0">
                <div className="relative shrink-0">
                  <div
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full',
                      isLowest
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-zinc-800 text-zinc-400',
                    )}
                  >
                    <User className="h-3 w-3" aria-hidden="true" />
                  </div>
                  {isLowest && (
                    <span
                      className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[7px] font-black text-black"
                      style={{ animation: 'lowestBadgePulse 2s ease-in-out infinite' }}
                      aria-label="Lowest bid"
                    >
                      1
                    </span>
                  )}
                </div>
                <span
                  className="text-xs font-medium min-w-0 break-words leading-tight text-zinc-100"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                >
                  {bid.provider_name}
                </span>
              </div>

              {/* Trust badge — hidden on mobile to save space */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'relative z-10 hidden cursor-default items-center justify-end gap-1 sm:flex',
                      tierConfig.colorClass,
                    )}
                    aria-label={`Trust tier: ${tierConfig.label}, score: ${String(bid.trust_score)}`}
                    tabIndex={0}
                  >
                    <TierIcon className="h-3 w-3" aria-hidden="true" />
                    <span
                      className="text-[10px] font-medium tabular-nums"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
                    >
                      {String(bid.trust_score)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-semibold">{tierConfig.label}</p>
                  <p className="mt-0.5 text-zinc-400">Trust score: {String(bid.trust_score)}/100</p>
                </TooltipContent>
              </Tooltip>

              {/* Price */}
              <span
                className={cn(
                  'relative z-10 text-right text-xs font-bold tabular-nums',
                  isLowest ? 'text-emerald-400' : 'text-zinc-100',
                )}
                style={{ textShadow: isLowest ? '0 0 8px rgba(34,197,94,0.4)' : '0 1px 2px rgba(0,0,0,0.2)' }}
              >
                {formatPrice(bid.amount_cents)}
              </span>

              {/* Time — hidden on mobile */}
              <span
                className="relative z-10 hidden text-right text-[10px] tabular-nums text-zinc-500 sm:block"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
              >
                {getTimeAgo(bid.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
