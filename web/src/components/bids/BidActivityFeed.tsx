'use client';

import { cn } from '@/lib/utils';
import { User } from 'lucide-react';

interface BidActivity {
  id: string;
  providerName: string;
  amount: number;
  timestamp: string;
  isLowest?: boolean;
}

interface BidActivityFeedProps {
  activities: BidActivity[];
  className?: string;
  /** Whether to render the built-in header. Defaults to true for backward compat. */
  showHeader?: boolean;
}

export function BidActivityFeed({
  activities,
  className,
  showHeader = true,
}: BidActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div
        className={cn(
          'glass text-zinc-500 p-6 text-center text-sm',
          className,
        )}
      >
        No bids yet. Be the first to bid!
      </div>
    );
  }

  return (
    <div className={cn('bg-transparent', showHeader && 'glass', className)}>
      <style>{`
        @keyframes activityFlashIn {
          0% { background-color: rgba(34, 197, 94, 0.18); }
          100% { background-color: transparent; }
        }
        @keyframes lowestGlow {
          0%, 100% { box-shadow: 0 0 4px rgba(16, 185, 129, 0.3); }
          50% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.5); }
        }
      `}</style>
      {showHeader && (
        <div className="flex items-center justify-between glass-header px-4 py-2.5">
          <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">Live Activity</h3>
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500"
              aria-hidden="true"
            />
            Live
          </span>
        </div>
      )}
      <div
        className={cn('overflow-y-auto', showHeader && 'max-h-[320px]')}
        role="log"
        aria-label="Bid activity feed"
      >
        {activities.map((activity, index) => {
          const dollars = activity.amount / 100;
          const priceStr = Number.isInteger(dollars)
            ? `$${dollars.toLocaleString('en-US')}`
            : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

          return (
            <div key={activity.id}>
              {index > 0 && <div className="glass-divider mx-4" />}
            <div
              className={cn(
                'flex items-center gap-3 px-4 py-3 transition-colors',
                'hover:bg-white/[0.03]',
              )}
              style={{
                animation: index === 0 ? 'activityFlashIn 1.5s ease-out forwards' : undefined,
              }}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                <User className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{activity.providerName}</span>
                  {activity.isLowest && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full glass-tinted-green border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400"
                      style={{ animation: 'lowestGlow 3s ease-in-out infinite' }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                      Lowest
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-500">{activity.timestamp}</span>
              </div>
              <span
                className="text-sm font-semibold text-zinc-200"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {priceStr}
              </span>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
