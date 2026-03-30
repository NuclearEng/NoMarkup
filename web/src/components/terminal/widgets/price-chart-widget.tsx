'use client';

import { PriceDropChart } from '@/components/bids/PriceDropChart';
import type { WidgetProps } from '../types';

export function PriceChartWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950/40 p-3">
      <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">
        Price History
      </h3>
      <div className="min-h-0 flex-1">
        <PriceDropChart events={sim.events} />
      </div>
    </div>
  );
}
