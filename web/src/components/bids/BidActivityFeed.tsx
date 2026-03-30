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
          'bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm',
          className,
        )}
      >
        No bids yet. Be the first to bid!
      </div>
    );
  }

  return (
    <div className={cn('bg-card', showHeader && 'rounded-xl border', className)}>
      <style>{`
        @keyframes activityFlashIn {
          0% { background-color: rgba(34, 197, 94, 0.18); }
          100% { background-color: transparent; }
        }
      `}</style>
      {showHeader && (
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Live Activity</h3>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            Live
          </span>
        </div>
      )}
      <div
        className={cn('divide-y overflow-y-auto', showHeader && 'max-h-[320px]')}
        role="log"
        aria-label="Bid activity feed"
      >
        {activities.map((activity, index) => (
          <div
            key={activity.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 transition-colors',
              'hover:bg-muted/30',
            )}
            style={{
              animation: index === 0 ? 'activityFlashIn 1.5s ease-out forwards' : undefined,
            }}
          >
            <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <User className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{activity.providerName}</span>
                {activity.isLowest && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500 ring-1 ring-emerald-500/20">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                    Lowest
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-xs">{activity.timestamp}</span>
            </div>
            <span
              className="text-sm font-semibold"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              ${(activity.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
