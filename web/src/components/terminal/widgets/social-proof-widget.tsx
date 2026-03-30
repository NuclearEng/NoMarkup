'use client';

import type { WidgetProps } from '../types';

export function SocialProofWidget({ sim, startingPriceCents }: WidgetProps) {
  const savingsPct =
    sim.currentLowest > 0
      ? Math.round(
          ((startingPriceCents - sim.currentLowest) / startingPriceCents) * 100,
        )
      : 0;

  if (sim.bidCount === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Waiting for bids...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/5 to-transparent p-4 text-center">
      <p className="text-3xl font-black text-emerald-500 tabular-nums">
        {String(sim.bidCount)}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        providers competing for this job
      </p>
      {savingsPct > 0 && (
        <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          {String(savingsPct)}% below asking price
        </p>
      )}
    </div>
  );
}
