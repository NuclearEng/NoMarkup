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
        <p className="text-muted-foreground text-sm">Waiting for more bids...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border/30 shrink-0 border-b px-4 py-2.5">
        <h3 className="text-muted-foreground/70 text-xs font-semibold tracking-wider uppercase">
          Top Providers
        </h3>
      </div>
      <div className="divide-border/20 min-h-0 flex-1 divide-y overflow-y-auto">
        {sim.orderBookBids.slice(0, 3).map((bid, idx) => {
          const provider = mockProviders.find((p) => p.name === bid.provider_name);
          const tierKey = (bid.trust_tier as keyof typeof TIER_COLORS) || 'new';
          const colors = TIER_COLORS[tierKey] ?? TIER_COLORS.new;
          const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
          const medal = medals[idx] ?? '';

          return (
            <div key={bid.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-lg">{medal}</span>
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ${colors.bg} ${colors.text} ${colors.ring}`}
              >
                {provider?.initial ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{bid.provider_name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-amber-400" />
                  <span className="text-muted-foreground text-xs">
                    {String(bid.trust_score)}
                  </span>
                  <Badge variant="outline" className="px-1 py-0 text-[9px]">
                    {bid.trust_tier.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-bold tabular-nums ${idx === 0 ? 'text-emerald-500' : ''}`}
                >
                  {fmt(bid.amount_cents)}
                </p>
                <p className="text-[10px] text-emerald-600 tabular-nums dark:text-emerald-400">
                  {String(
                    Math.round(
                      ((startingPriceCents - bid.amount_cents) / startingPriceCents) * 100,
                    ),
                  )}
                  % off
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
