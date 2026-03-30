'use client';

import { BidDepthChart } from '@/components/bids/BidDepthChart';
import type { WidgetProps } from '../types';

export function DepthChartWidget({ sim, startingPriceCents }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="glass-header -mx-3 -mt-3 mb-2 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Depth Chart
        </h3>
      </div>
      <div className="min-h-0 flex-1">
        <BidDepthChart
          bids={sim.depthBuckets}
          startingPrice={startingPriceCents}
          currentLowest={sim.currentLowest}
        />
      </div>
    </div>
  );
}
