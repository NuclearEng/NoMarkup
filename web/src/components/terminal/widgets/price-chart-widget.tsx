'use client';

import { PriceDropChart } from '@/components/bids/PriceDropChart';
import type { WidgetProps } from '../types';

export function PriceChartWidget({ sim }: WidgetProps) {
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
            Price History
          </span>
        </h3>
      </div>
      <div className="min-h-0 flex-1">
        <PriceDropChart events={sim.events} />
      </div>
    </div>
  );
}
