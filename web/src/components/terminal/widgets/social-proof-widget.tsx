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
        <p className="text-zinc-500 text-sm">Waiting for bids...</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col items-center justify-center p-4 text-center"
      style={{
        background: 'linear-gradient(180deg, rgba(34,197,94,0.03) 0%, transparent 100%)',
      }}
    >
      <style>{`
        @keyframes socialGlow {
          0%, 100% { text-shadow: 0 0 15px rgba(34, 197, 94, 0.4); }
          50% { text-shadow: 0 0 20px rgba(34, 197, 94, 0.5), 0 0 40px rgba(34, 197, 94, 0.25); }
        }
      `}</style>
      <p
        className="text-4xl font-black text-emerald-400 tabular-nums"
        style={{ animation: 'socialGlow 3s ease-in-out infinite', textShadow: '0 0 20px rgba(34,197,94,0.5)' }}
      >
        {String(sim.bidCount)}
      </p>
      <p className="text-zinc-400 mt-1 text-xs">
        providers competing for this job
      </p>
      {savingsPct > 0 && (
        <p
          className="mt-2 text-sm font-semibold text-emerald-300"
          style={{ textShadow: '0 0 10px rgba(34,197,94,0.3)' }}
        >
          {String(savingsPct)}% below asking price
        </p>
      )}
    </div>
  );
}
