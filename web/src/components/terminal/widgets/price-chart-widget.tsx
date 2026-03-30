'use client';

import { PriceDropChart } from '@/components/bids/PriceDropChart';
import type { WidgetProps } from '../types';

export function PriceChartWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
        Price History
      </h3>
      <div className="min-h-0 flex-1">
        <PriceDropChart events={sim.events} />
      </div>
    </div>
  );
}
