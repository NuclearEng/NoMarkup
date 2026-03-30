'use client';

import { Clock, Shield, TrendingDown, Users, Zap } from 'lucide-react';

import { AnimatedPrice } from '@/components/bids/AnimatedPrice';
import { BidVelocityIndicator } from '@/components/bids/BidVelocityIndicator';
import { SnipeIndicator } from '@/components/bids/SnipeIndicator';
import { AuctionTimer } from '@/components/jobs/AuctionTimer';
import type { WidgetProps } from '../types';

function fmt(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function PriceHeroWidget({ sim, auctionEndsAt, startingPriceCents }: WidgetProps) {
  const savingsCents = startingPriceCents - sim.currentLowest;
  const savingsPct =
    sim.currentLowest > 0 ? Math.round((savingsCents / startingPriceCents) * 100) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="h-0.5 shrink-0"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--brand-gold-dim), var(--brand-gold), var(--brand-gold-bright), transparent)',
        }}
      />
      <div className="divide-border/30 grid min-h-0 flex-1 gap-0 divide-x sm:grid-cols-[1fr_auto_auto_auto]">
        {/* Price cell */}
        <div className="relative flex items-center gap-5 px-6 py-4">
          <div className="flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-400" />
              <span className="text-muted-foreground text-[11px] font-bold tracking-widest uppercase">
                Current Lowest Bid
              </span>
              {sim.isRunning ? (
                <span className="flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <span className="text-[10px] font-medium text-green-400">LIVE</span>
                </span>
              ) : null}
              {sim.velocity > 0 && (
                <BidVelocityIndicator velocity={sim.velocity} buckets={sim.velocityBuckets} />
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <span
                className="text-4xl font-black tracking-tight text-green-500 sm:text-5xl"
                style={{ textShadow: '0 0 30px rgba(34,197,94,0.2)' }}
              >
                {sim.currentLowest > 0 ? (
                  <AnimatedPrice cents={sim.currentLowest} formatCurrency={fmt} />
                ) : (
                  <span className="text-muted-foreground/40">Waiting...</span>
                )}
              </span>
              {sim.currentLowest > 0 && (
                <span className="text-muted-foreground text-sm tabular-nums line-through">
                  {fmt(startingPriceCents)}
                </span>
              )}
            </div>
            {savingsCents > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  Save {fmt(savingsCents)} ({String(savingsPct)}%)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bids stat */}
        <div className="flex flex-col items-center justify-center px-6 py-3 sm:px-8">
          <Users className="text-muted-foreground mb-1 h-4 w-4" />
          <p className="text-2xl font-bold tabular-nums">{String(sim.bidCount)}</p>
          <p className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Bids
          </p>
        </div>

        {/* Timer */}
        <div className="flex flex-col items-center justify-center px-6 py-3 sm:px-8">
          <Clock className="text-muted-foreground mb-1 h-4 w-4" />
          <AuctionTimer auctionEndsAt={auctionEndsAt} compact />
          <p className="text-muted-foreground mt-0.5 text-[10px] font-medium tracking-wider uppercase">
            Time Left
          </p>
        </div>

        {/* Snipe */}
        <div className="flex flex-col items-center justify-center px-6 py-3 sm:px-8">
          <Shield className="text-muted-foreground mb-1 h-4 w-4" />
          <SnipeIndicator count={0} max={3} />
        </div>
      </div>
    </div>
  );
}
