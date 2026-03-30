'use client';

import { Clock, Shield, TrendingDown, Users } from 'lucide-react';

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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-zinc-900/90 border border-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_20px_50px_-12px_rgba(0,0,0,0.6)]">
      {/* Animated gold accent line at top */}
      <div className="hero-gold-line-animated h-[2px] shrink-0" />

      {/* Noise texture overlay */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{
          background: 'linear-gradient(to right, rgba(24,24,27,0.85), rgba(24,24,27,0.7), rgba(24,24,27,0.85))',
        }}
      >
        {/* Subtle noise texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
            backgroundSize: '128px 128px',
          }}
        />

        <div className="relative z-10 grid min-h-0 flex-1 gap-0 sm:grid-cols-[1fr_auto_auto_auto]">
          {/* Price cell */}
          <div className="relative flex items-center gap-5 px-6 py-4">
            <div className="flex-1">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="text-[11px] font-bold tracking-[0.15em] uppercase"
                  style={{
                    background: 'linear-gradient(135deg, var(--brand-gold-dim), var(--brand-gold-bright))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Current Lowest Bid
                </span>
                {sim.isRunning ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                      <span
                        className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"
                        style={{ boxShadow: '0 0 6px rgba(34,197,94,0.6), 0 0 12px rgba(34,197,94,0.3)' }}
                      />
                    </span>
                    <span className="text-[10px] font-bold tracking-wider text-green-400">LIVE</span>
                  </span>
                ) : null}
                {sim.velocity > 0 && (
                  <BidVelocityIndicator velocity={sim.velocity} buckets={sim.velocityBuckets} />
                )}
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-5xl font-black tracking-tight text-green-500 sm:text-6xl"
                  style={{
                    textShadow: '0 0 40px rgba(34,197,94,0.3), 0 0 80px rgba(34,197,94,0.1)',
                  }}
                >
                  {sim.currentLowest > 0 ? (
                    <AnimatedPrice cents={sim.currentLowest} formatCurrency={fmt} />
                  ) : (
                    <span className="text-zinc-600">Waiting...</span>
                  )}
                </span>
                {sim.currentLowest > 0 && (
                  <span className="text-sm tabular-nums text-zinc-400 line-through">
                    {fmt(startingPriceCents)}
                  </span>
                )}
              </div>
              {savingsCents > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-sm font-bold text-emerald-400">
                    Save {fmt(savingsCents)} ({String(savingsPct)}%)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Bids stat */}
          <div className="hero-stat-cell relative flex flex-col items-center justify-center px-6 py-3 sm:px-8" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="hero-stat-accent-blue absolute top-0 left-0 right-0 h-[2px]" />
            <div className="absolute top-0 bottom-0 left-0 w-px" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
            <Users className="mb-1 h-4 w-4 text-blue-400/70" />
            <p className="text-3xl font-black tabular-nums text-zinc-100">{String(sim.bidCount)}</p>
            <p className="text-[10px] font-semibold tracking-wider uppercase text-zinc-500">
              Bids
            </p>
          </div>

          {/* Timer */}
          <div className="hero-stat-cell relative flex flex-col items-center justify-center px-6 py-3 sm:px-8" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="hero-stat-accent-amber absolute top-0 left-0 right-0 h-[2px]" />
            <div className="absolute top-0 bottom-0 left-0 w-px" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
            <Clock className="mb-1 h-4 w-4 text-amber-400/70" />
            <AuctionTimer auctionEndsAt={auctionEndsAt} compact />
            <p className="mt-0.5 text-[10px] font-semibold tracking-wider uppercase text-zinc-500">
              Time Left
            </p>
          </div>

          {/* Snipe */}
          <div className="hero-stat-cell relative flex flex-col items-center justify-center px-6 py-3 sm:px-8" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="hero-stat-accent-violet absolute top-0 left-0 right-0 h-[2px]" />
            <div className="absolute top-0 bottom-0 left-0 w-px" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
            <Shield className="mb-1 h-4 w-4 text-violet-400/70" />
            <SnipeIndicator count={0} max={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
