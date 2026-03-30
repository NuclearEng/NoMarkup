'use client';

import { BidActivityFeed } from '@/components/bids/BidActivityFeed';
import type { WidgetProps } from '../types';

export function ActivityFeedWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/30 flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-muted-foreground/70 text-xs font-semibold tracking-wider uppercase">
          Live Activity
        </h3>
        <span className="flex items-center gap-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
          </span>
          <span className="text-[10px] font-medium text-green-400">Live</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BidActivityFeed activities={sim.activities} />
      </div>
    </div>
  );
}
