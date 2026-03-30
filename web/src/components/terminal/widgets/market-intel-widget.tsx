'use client';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import type { WidgetProps } from '../types';

export function MarketIntelWidget({ sim, marketRange }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-auto bg-zinc-950/40 p-4">
      <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400 mb-3">
        Market Intelligence
      </h3>
      <MarketRangeDisplay
        marketRange={marketRange}
        currentBidCents={sim.currentLowest > 0 ? sim.currentLowest : undefined}
      />
    </div>
  );
}
