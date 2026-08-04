'use client';

import { OrderBook } from '@/components/bids/OrderBook';
import type { WidgetProps } from '../types';

export function OrderBookWidget({ sim, startingPriceCents, jobId }: WidgetProps) {
  return (
    <div className="h-full overflow-auto">
      <OrderBook
        jobId={jobId ?? 'unknown'}
        bids={sim.orderBookBids}
        startingPrice={startingPriceCents}
      />
    </div>
  );
}
