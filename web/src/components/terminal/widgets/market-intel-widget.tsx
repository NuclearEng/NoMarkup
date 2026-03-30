'use client';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import type { WidgetProps } from '../types';

export function MarketIntelWidget({ sim, marketRange }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="glass-header -mx-4 -mt-4 mb-3 px-4 py-2.5 rounded-t-2xl">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Market Intelligence
        </h3>
      </div>
      <MarketRangeDisplay
        marketRange={marketRange}
        currentBidCents={sim.currentLowest > 0 ? sim.currentLowest : undefined}
      />
    </div>
  );
}
