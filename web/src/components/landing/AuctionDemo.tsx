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

const BIDS: BidEntry[] = [
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
      setTimer(TIMER_START);

      // Start countdown timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimer((prev) => (prev > 0 ? prev - 1 : prev));
      }, 1000);

      // Bid 1
      const t1 = setTimeout(() => {
        setVisibleBids(1);
        setCurrentPrice(BIDS[0]?.price ?? STARTING_PRICE);
        setFlashActive(true);
        setTimeout(() => { setFlashActive(false); }, 400);
      }, BIDS[0]?.delay ?? 1500);

      // Bid 2
      const t2 = setTimeout(() => {
        setVisibleBids(2);
        setCurrentPrice(BIDS[1]?.price ?? STARTING_PRICE);
        setFlashActive(true);
        setTimeout(() => { setFlashActive(false); }, 400);
      }, BIDS[1]?.delay ?? 3000);

      // Bid 3 — winning bid
      const t3 = setTimeout(() => {
        setVisibleBids(3);
        setCurrentPrice(BIDS[2]?.price ?? STARTING_PRICE);
        setFlashActive(true);
        setTimeout(() => {
          setFlashActive(false);
          setShowSavings(true);
        }, 400);
      }, BIDS[2]?.delay ?? 4500);

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
    ((STARTING_PRICE - (BIDS[2]?.price ?? STARTING_PRICE)) / STARTING_PRICE) * 100,
  );

  const timerMinutes = Math.floor(timer / 60);
  const timerSeconds = timer % 60;

  return (
    <div
      className={cn(
        'relative w-full max-w-sm mx-auto',
        // Floating card with perspective
        '[perspective:1000px]',
        className,
      )}
    >
      <div
        className={cn(
          'relative rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl shadow-2xl shadow-black/40',
          'transition-all duration-300',
          // Subtle 3D tilt
          '[transform:rotateY(-2deg)_rotateX(1deg)]',
          'hover:[transform:rotateY(0deg)_rotateX(0deg)]',
        )}
      >
        {/* Green flash overlay */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-400',
            'bg-emerald-500/10',
            flashActive ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Live Auction
            </p>
            <h3 className="mt-1 text-base font-bold text-white">
              Kitchen Renovation
            </h3>
          </div>
          {/* Timer */}
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs tabular-nums text-white/70">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {String(timerMinutes)}:{String(timerSeconds).padStart(2, '0')}
          </div>
        </div>

        {/* Current price display */}
        <div className="mt-4 rounded-xl bg-white/[0.04] p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">
            Current Best Price
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                'text-3xl font-extrabold tabular-nums transition-all duration-500',
                flashActive ? 'text-emerald-400 scale-105' : 'text-white',
              )}
              style={{ transformOrigin: 'left bottom' }}
            >
              {formatDollars(currentPrice)}
            </span>
            {visibleBids > 0 ? (
              <span className="text-sm text-white/30 line-through tabular-nums">
                {formatDollars(STARTING_PRICE)}
              </span>
            ) : null}
          </div>

          {/* Savings badge */}
          <div
            className={cn(
              'mt-2 transition-all duration-500',
              showSavings
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0 pointer-events-none',
            )}
          >
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{
                background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.05))',
                color: '#e4c566',
                border: '1px solid rgba(201,168,76,0.3)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              {String(savingsPercent)}% savings!
            </span>
          </div>
        </div>

        {/* Bid entries */}
        <div className="mt-4 space-y-2">
          {BIDS.map((bid, i) => (
            <div
              key={bid.name}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-500',
                i < visibleBids
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-3 opacity-0 pointer-events-none',
                i === visibleBids - 1 && i === 2
                  ? 'bg-[rgba(201,168,76,0.08)] border border-[rgba(201,168,76,0.15)]'
                  : i === visibleBids - 1
                    ? 'bg-emerald-500/[0.06] border border-emerald-500/10'
                    : 'bg-white/[0.02] border border-transparent',
              )}
            >
              {/* Avatar placeholder */}
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  i === 2
                    ? 'bg-[rgba(201,168,76,0.15)] text-[#e4c566]'
                    : 'bg-white/10 text-white/70',
                )}
              >
                {bid.name.charAt(0)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white/90">
                    {bid.name}
                  </span>
                  <TrustBadge score={bid.trustScore} />
                </div>
              </div>

              <span
                className={cn(
                  'shrink-0 text-sm font-bold tabular-nums',
                  i === 2 ? 'text-[#e4c566]' : 'text-emerald-400',
                )}
              >
                {formatDollars(bid.price)}
              </span>
            </div>
          ))}

          {/* Placeholder rows for bids not yet visible */}
          {visibleBids < 3 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/5 px-3 py-2">
              <div className="h-8 w-8 shrink-0 rounded-full bg-white/[0.03]" />
              <div className="flex-1">
                <div className="h-3 w-24 rounded bg-white/[0.04]" />
              </div>
              <div className="h-3 w-12 rounded bg-white/[0.04]" />
            </div>
          ) : null}
        </div>

        {/* Bottom label */}
        <p className="mt-4 text-center text-[10px] text-white/30">
          Prices go down as providers compete
        </p>
      </div>
    </div>
  );
}
