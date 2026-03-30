'use client';

import { BidPriceChart } from '@/components/bids/BidPriceChart';
import type { WidgetProps } from '../types';

export function BidTrendWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950/40 p-3">
      <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">
        Bid Trend
      </h3>
      <div className="min-h-0 flex-1">
        <BidPriceChart bids={sim.sparklineBids} height={180} />
      </div>
    </div>
  );
}
