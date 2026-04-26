'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface AuctionDemoProps {
  className?: string;
}

interface BidEntry {
  name: string;
  price: number;
  trustScore: number;
  delay: number;
}

const BIDS: readonly [BidEntry, BidEntry, BidEntry] = [
  { name: "Mike's Plumbing", price: 210000, trustScore: 92, delay: 1500 },
  { name: 'ProBuild Co.', price: 180000, trustScore: 88, delay: 3000 },
  { name: 'Elite Renovations', price: 145000, trustScore: 95, delay: 4500 },
];

const STARTING_PRICE = 250000;
const CYCLE_DURATION = 8000;
const TIMER_START = 47;

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function TrustBadge({ score }: { score: number }) {
  const tier =
    score >= 95
      ? { label: 'Elite', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' }
      : score >= 90
        ? { label: 'High', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
        : { label: 'Good', className: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        tier.className,
      )}
    >
      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0l2.2 5.5L16 6.3l-4 3.7 1 5.5L8 12.8 2.9 15.5l1-5.5-4-3.7 5.9-.8z" />
      </svg>
      {String(score)}
    </span>
  );
}

export function AuctionDemo({ className }: AuctionDemoProps) {
  const [visibleBids, setVisibleBids] = useState<number>(0);
  const [currentPrice, setCurrentPrice] = useState(STARTING_PRICE);
  const [showSavings, setShowSavings] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [shimmerKey, setShimmerKey] = useState(0);
  const [rippleActive, setRippleActive] = useState(false);
  const [timer, setTimer] = useState(TIMER_START);
  const cycleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function runCycle() {
      // Reset state
      setVisibleBids(0);
      setCurrentPrice(STARTING_PRICE);
      setShowSavings(false);
      setFlashActive(false);
      setRippleActive(false);
      setTimer(TIMER_START);

      // Start countdown timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimer((prev) => (prev > 0 ? prev - 1 : prev));
      }, 1000);

      // Bid 1
      const t1 = setTimeout(() => {
        setVisibleBids(1);
        setCurrentPrice(BIDS[0].price);
        setFlashActive(true);
        setShimmerKey((k) => k + 1);
        setTimeout(() => { setFlashActive(false); }, 400);
      }, BIDS[0].delay);

      // Bid 2
      const t2 = setTimeout(() => {
        setVisibleBids(2);
        setCurrentPrice(BIDS[1].price);
        setFlashActive(true);
        setShimmerKey((k) => k + 1);
        setTimeout(() => { setFlashActive(false); }, 400);
      }, BIDS[1].delay);

      // Bid 3 — winning bid with ripple
      const t3 = setTimeout(() => {
        setVisibleBids(3);
        setCurrentPrice(BIDS[2].price);
        setFlashActive(true);
        setShimmerKey((k) => k + 1);
        setRippleActive(true);
        setTimeout(() => {
          setFlashActive(false);
          setShowSavings(true);
        }, 400);
      }, BIDS[2].delay);

      // Schedule next cycle
      cycleRef.current = setTimeout(runCycle, CYCLE_DURATION);

      return [t1, t2, t3];
    }

    const timers = runCycle();

    return () => {
      if (cycleRef.current) clearTimeout(cycleRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  const savingsPercent = Math.round(
    ((STARTING_PRICE - BIDS[2].price) / STARTING_PRICE) * 100,
  );

  const timerMinutes = Math.floor(timer / 60);
  const timerSeconds = timer % 60;

  return (
    <div
      className={cn(
        'relative w-full max-w-sm mx-auto',
        '[perspective:1000px]',
        className,
      )}
    >
      {/* Ripple rings on final bid */}
      {rippleActive ? (
        <>
          <div className="auction-ripple-ring pointer-events-none absolute inset-0 rounded-2xl border-2 border-[rgba(201,168,76,0.3)]" />
          <div
            className="auction-ripple-ring pointer-events-none absolute inset-0 rounded-2xl border border-[rgba(201,168,76,0.15)]"
            style={{ animationDelay: '150ms' }}
          />
        </>
      ) : null}

      <div
        className={cn(
          'relative rounded-2xl border border-white/[0.1] bg-zinc-900/80 p-5',
          'shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_50px_-12px_rgba(0,0,0,0.6)]',
          'transition-all duration-300',
          '[transform:rotateY(-2deg)_rotateX(1deg)]',
          'hover:[transform:rotateY(0deg)_rotateX(0deg)]',
        )}
      >
        {/* Green flash overlay on bid */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-400',
            'bg-emerald-500/10',
            flashActive ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Shimmer sweep across card on each bid */}
        <div
          key={shimmerKey}
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden rounded-2xl',
            shimmerKey > 0 ? 'opacity-100' : 'opacity-0',
          )}
        >
          {shimmerKey > 0 ? (
            <div
              className="auction-shimmer-sweep absolute inset-y-0 w-[60%] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
            />
          ) : null}
        </div>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/70">
              Live Auction
            </p>
            <h3 className="mt-1 text-base font-bold text-zinc-100">
              Kitchen Renovation
            </h3>
          </div>
          {/* Timer */}
          <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/80 px-2.5 py-1.5 text-xs tabular-nums text-zinc-400 border border-white/[0.06]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {String(timerMinutes)}:{String(timerSeconds).padStart(2, '0')}
          </div>
        </div>

        {/* Current price display — crisp, sharp */}
        <div className="mt-5 rounded-xl bg-zinc-800/60 p-4 border border-white/[0.06]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Current Best Price
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className={cn(
                'text-4xl font-black tabular-nums tracking-tight transition-all duration-500',
                flashActive ? 'text-emerald-400 scale-105' : 'text-zinc-50',
              )}
              style={{ transformOrigin: 'left bottom' }}
            >
              {formatDollars(currentPrice)}
            </span>
            {visibleBids > 0 ? (
              <span className="text-sm text-zinc-500 line-through tabular-nums">
                {formatDollars(STARTING_PRICE)}
              </span>
            ) : null}
          </div>

          {/* Savings badge — scale-bounce entrance */}
          {showSavings ? (
            <div className="mt-3">
              <span
                className="animate-savings-bounce inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                style={{
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(201,168,76,0.08))',
                  color: '#e4c566',
                  border: '1px solid rgba(201,168,76,0.35)',
                  boxShadow: '0 0 12px rgba(201,168,76,0.15)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
                {String(savingsPercent)}% savings!
              </span>
            </div>
          ) : null}
        </div>

        {/* Bid entries */}
        <div className="mt-4 space-y-2">
          {BIDS.map((bid, i) => {
            const isWinner = i === 2 && visibleBids > 2;
            const isLatest = i === visibleBids - 1;

            return (
              <div
                key={bid.name}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-500',
                  i < visibleBids
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-3 opacity-0 pointer-events-none',
                  isWinner
                    ? 'border border-[rgba(201,168,76,0.25)] ring-1 ring-[rgba(201,168,76,0.1)]'
                    : isLatest
                      ? 'bg-emerald-500/[0.06] border border-emerald-500/10'
                      : 'bg-white/[0.02] border border-transparent',
                )}
                style={isWinner ? {
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.1), rgba(201,168,76,0.03))',
                } : undefined}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isWinner
                      ? 'bg-[rgba(201,168,76,0.2)] text-[#e4c566] ring-1 ring-[rgba(201,168,76,0.3)]'
                      : 'bg-white/10 text-white/70',
                  )}
                >
                  {bid.name.charAt(0)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-sm font-medium',
                        isWinner ? 'text-[#e4c566]' : 'text-white/90',
                      )}
                    >
                      {bid.name}
                    </span>
                    <TrustBadge score={bid.trustScore} />
                  </div>
                </div>

                <span
                  className={cn(
                    'shrink-0 text-sm font-bold tabular-nums',
                    isWinner ? 'text-[#e4c566]' : 'text-emerald-400',
                  )}
                >
                  {formatDollars(bid.price)}
                </span>

                {/* Winner crown icon */}
                {isWinner ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#e4c566" aria-hidden="true" className="shrink-0">
                    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
                    <path d="M5 19h14v2H5z" />
                  </svg>
                ) : null}
              </div>
            );
          })}

          {/* Placeholder rows for bids not yet visible */}
          {visibleBids < 3 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-zinc-700/50 px-3 py-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-800/60" />
              <div className="flex-1">
                <div className="h-3 w-24 rounded bg-zinc-800/60" />
              </div>
              <div className="h-3 w-12 rounded bg-zinc-800/60" />
            </div>
          ) : null}
        </div>

        {/* Bottom label with animated down arrow */}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <span>Prices go down as providers compete</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="animate-arrow-bounce-down text-emerald-400/50"
          >
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </p>
      </div>
    </div>
  );
}
