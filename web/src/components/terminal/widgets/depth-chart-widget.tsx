'use client';

import { BidDepthChart } from '@/components/bids/BidDepthChart';
import type { WidgetProps } from '../types';

export function DepthChartWidget({ sim, startingPriceCents }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950/40 p-3">
      <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">
        Depth Chart
      </h3>
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
