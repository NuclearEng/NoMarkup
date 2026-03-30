'use client';

import { SavingsHero } from '@/components/bids/SavingsHero';
import type { WidgetProps } from '../types';

export function SavingsWidget({ sim, startingPriceCents }: WidgetProps) {
  if (sim.currentLowest <= 0 || sim.currentLowest >= startingPriceCents) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-500 text-sm">Waiting for bids...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-1">
      <SavingsHero
        startingPriceCents={startingPriceCents}
        currentLowestCents={sim.currentLowest}
        previousLowestCents={sim.previousLowest}
      />
    </div>
  );
}
