'use client';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import type { WidgetProps } from '../types';

export function MarketIntelWidget({ sim, marketRange }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <MarketRangeDisplay
        marketRange={marketRange}
        currentBidCents={sim.currentLowest > 0 ? sim.currentLowest : undefined}
      />
    </div>
  );
}
