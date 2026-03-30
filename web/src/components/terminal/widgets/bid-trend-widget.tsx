'use client';

import { BidPriceChart } from '@/components/bids/BidPriceChart';
import type { WidgetProps } from '../types';

export function BidTrendWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="border-b border-white/[0.06] -mx-3 -mt-3 mb-2 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Bid Trend
        </h3>
      </div>
      <div className="min-h-0 flex-1">
        <BidPriceChart bids={sim.sparklineBids} height={180} />
      </div>
    </div>
  );
}
