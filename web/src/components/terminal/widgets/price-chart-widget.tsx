'use client';

import { PriceDropChart } from '@/components/bids/PriceDropChart';
import type { WidgetProps } from '../types';

export function PriceChartWidget({ sim }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="glass-header -mx-3 -mt-3 mb-2 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Price History
        </h3>
      </div>
      <div className="min-h-0 flex-1">
        <PriceDropChart events={sim.events} />
      </div>
    </div>
  );
}
