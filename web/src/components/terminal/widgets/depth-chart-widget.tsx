'use client';

import { BidDepthChart } from '@/components/bids/BidDepthChart';
import type { WidgetProps } from '../types';

export function DepthChartWidget({ sim, startingPriceCents }: WidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="border-b border-white/[0.06] -mx-3 -mt-3 mb-2 px-4 py-2.5 rounded-t-2xl">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--brand-gold)', boxShadow: '0 0 4px rgba(201,168,76,0.5)' }}
          />
          <span
            style={{
              background: 'linear-gradient(135deg, var(--brand-gold-dim), var(--brand-gold-bright))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Depth Chart
          </span>
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
