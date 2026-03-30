'use client';

import { Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { WidgetProps } from '../types';

const TIER_COLORS = {
  top_rated: { bg: 'bg-amber-500/15', text: 'text-amber-500', ring: 'ring-amber-500/30' },
  trusted: { bg: 'bg-violet-500/15', text: 'text-violet-500', ring: 'ring-violet-500/30' },
  rising: { bg: 'bg-emerald-500/15', text: 'text-emerald-500', ring: 'ring-emerald-500/30' },
  new: { bg: 'bg-sky-500/15', text: 'text-sky-500', ring: 'ring-sky-500/30' },
} as const;

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function TopProvidersWidget({ sim, startingPriceCents, mockProviders }: WidgetProps) {
  if (sim.orderBookBids.length < 3) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-500 text-sm">Waiting for more bids...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 glass-header px-4 py-2.5">
        <h3 className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400">
          Top Providers
        </h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sim.orderBookBids.slice(0, 3).map((bid, idx) => {
          const provider = mockProviders.find((p) => p.name === bid.provider_name);
          const tierKey = (bid.trust_tier as keyof typeof TIER_COLORS) || 'new';
          const colors = TIER_COLORS[tierKey] ?? TIER_COLORS.new;
          const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
          const medal = medals[idx] ?? '';

          return (
            <div key={bid.id}>
              {idx > 0 && <div className="glass-divider mx-4" />}
              <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
              <span className="text-xl" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>{medal}</span>
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ${colors.bg} ${colors.text} ${colors.ring}`}
              >
                {provider?.initial ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">{bid.provider_name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-amber-400" style={{ filter: 'drop-shadow(0 0 3px rgba(245,158,11,0.4))' }} />
                  <span className="text-zinc-400 text-xs">
                    {String(bid.trust_score)}
                  </span>
                  <Badge variant="outline" className="border-zinc-700 px-1 py-0 text-[9px] text-zinc-400">
                    {bid.trust_tier.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-bold tabular-nums ${idx === 0 ? 'text-emerald-400' : 'text-zinc-200'}`}
                  style={idx === 0 ? { textShadow: '0 0 8px rgba(16,185,129,0.3)' } : undefined}
                >
                  {fmt(bid.amount_cents)}
                </p>
                <p className="text-[10px] text-emerald-400 tabular-nums">
                  {String(
                    Math.round(
                      ((startingPriceCents - bid.amount_cents) / startingPriceCents) * 100,
                    ),
                  )}
                  % off
                </p>
              </div>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
