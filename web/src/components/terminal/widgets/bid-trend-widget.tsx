'use client';

import { BidPriceChart } from '@/components/bids/BidPriceChart';
import type { WidgetProps } from '../types';

export function BidTrendWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Bid Trend
      </h3>
      <div className="min-h-0 flex-1">
        <BidPriceChart bids={sim.sparklineBids} height={180} />
      </div>
    </div>
  );
}
