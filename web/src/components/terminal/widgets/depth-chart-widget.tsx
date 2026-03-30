'use client';

import { BidDepthChart } from '@/components/bids/BidDepthChart';
import type { WidgetProps } from '../types';

export function DepthChartWidget({ sim, startingPriceCents }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
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
