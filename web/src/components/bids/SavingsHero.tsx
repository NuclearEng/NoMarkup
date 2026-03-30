'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Flame, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SavingsHeroProps {
  startingPriceCents: number;
  currentLowestCents: number;
  previousLowestCents?: number;
  className?: string;
}

/** Formats cents to a compact currency string without decimals */
function formatCompactCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Animated digit roller: each digit animates independently when it changes.
 * Uses CSS transitions rather than JS frame-by-frame animation for performance.
 */
function RollingDigits({ value, className }: { value: string; className?: string }) {
  const [displayChars, setDisplayChars] = useState<string[]>(() => value.split(''));
  const prevValue = useRef(value);
  const displayCharsRef = useRef(displayChars);
  displayCharsRef.current = displayChars;
  const [changingIndices, setChangingIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;

    const newChars = value.split('');
    const currentChars = displayCharsRef.current;
    const changed = new Set<number>();
    newChars.forEach((char, i) => {
      if (currentChars[i] !== char) {
        changed.add(i);
      }
    });

    if (changed.size > 0) {
      setChangingIndices(changed);
      const timer = setTimeout(() => {
        setDisplayChars(newChars);
        setChangingIndices(new Set());
      }, 200);
      return () => {
        clearTimeout(timer);
      };
    }

    setDisplayChars(newChars);
    return undefined;
  }, [value]);

  return (
    <span className={cn('inline-flex', className)} aria-hidden="true">
      {displayChars.map((char, i) => (
        <span
          key={`${String(i)}-pos`}
          className={cn(
            'inline-block transition-all duration-300',
            changingIndices.has(i) && 'translate-y-[-8%] scale-110 opacity-60',
          )}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

export function SavingsHero({
  startingPriceCents,
  currentLowestCents,
  previousLowestCents,
  className,
}: SavingsHeroProps) {
  const savingsCents =
    startingPriceCents > 0 && currentLowestCents > 0
      ? Math.max(0, startingPriceCents - currentLowestCents)
      : 0;

  const savingsPercent =
    startingPriceCents > 0 ? Math.round((savingsCents / startingPriceCents) * 100) : 0;

  // Trend: are savings increasing? (new lowest is lower than previous lowest)
  const trendUp =
    previousLowestCents !== undefined &&
    currentLowestCents > 0 &&
    currentLowestCents < previousLowestCents;

  const isGreatDeal = savingsPercent > 20;
  const isIncredibleDeal = savingsPercent > 40;

  // Animate in when savings first appear or change
  const [isAnimating, setIsAnimating] = useState(false);
  const prevSavings = useRef(savingsCents);

  useEffect(() => {
    if (prevSavings.current === savingsCents) return;
    prevSavings.current = savingsCents;
    if (savingsCents <= 0) return;
    setIsAnimating(true);
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [savingsCents]);

  // Don't render if no savings
  if (savingsCents <= 0 || startingPriceCents <= 0 || currentLowestCents <= 0) {
    return null;
  }

  const formattedSavings = formatCompactCents(savingsCents);
  const formattedStarting = formatCompactCents(startingPriceCents);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-4 sm:px-6 sm:py-5',
        isGreatDeal && 'animate-savings-sparkle',
        isAnimating && 'scale-[1.02] transition-transform duration-300',
        className,
      )}
      style={{
        boxShadow: 'inset 0 0 30px rgba(34,197,94,0.06), 0 0 20px rgba(34,197,94,0.08)',
      }}
      role="status"
      aria-label={`You are saving ${formattedSavings}, ${String(savingsPercent)} percent off the starting price of ${formattedStarting}`}
    >
      {/* Background shimmer for great deals */}
      {isGreatDeal ? (
        <div
          className="animate-shimmer pointer-events-none absolute inset-0 opacity-30"
          aria-hidden="true"
        />
      ) : null}

      {/* Subtle decorative trending-down arrow background */}
      <div
        className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 opacity-[0.04] sm:right-8"
        aria-hidden="true"
      >
        <ArrowDown className="h-24 w-24 text-emerald-500 sm:h-32 sm:w-32" strokeWidth={1.5} />
      </div>

      <div className="relative flex flex-col items-center gap-2 text-center">
        {/* Incredible deal badge with pulsing ring */}
        {isIncredibleDeal ? (
          <div className="relative inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3.5 py-1.5 text-xs font-bold text-orange-500">
            {/* Pulsing rings around badge */}
            <span
              className="animate-savings-ring-pulse absolute inset-0 rounded-full border border-orange-500/30"
              aria-hidden="true"
            />
            <span
              className="animate-savings-ring-pulse absolute -inset-1 rounded-full border border-orange-500/15"
              style={{ animationDelay: '0.3s' }}
              aria-hidden="true"
            />
            <Flame className="relative h-3.5 w-3.5" aria-hidden="true" />
            <span className="relative">Incredible Deal</span>
          </div>
        ) : null}

        {/* Main savings label */}
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-300">
          You&apos;re saving
        </p>

        {/* Hero savings amount with green glow */}
        <div className="flex items-baseline gap-2.5">
          <span
            className="text-3xl font-black tracking-tight text-emerald-400 sm:text-4xl"
            style={{
              textShadow: '0 0 20px rgba(34,197,94,0.5), 0 0 40px rgba(34,197,94,0.2)',
            }}
          >
            <RollingDigits value={formattedSavings} />
            <span className="sr-only">{formattedSavings}</span>
          </span>
          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-3 py-1 text-sm font-extrabold',
              'bg-emerald-500/25 text-emerald-600 dark:text-emerald-400',
              'border border-emerald-400/30',
            )}
          >
            {trendUp ? (
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {String(savingsPercent)}%
          </span>
        </div>

        {/* Comparison text */}
        <p className="text-xs text-zinc-400">
          vs. starting price of{' '}
          <span className="font-medium text-zinc-400 line-through">{formattedStarting}</span>
        </p>

        {/* Trend indicator */}
        {trendUp ? (
          <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Savings just increased — prices are dropping
          </p>
        ) : null}
      </div>
    </div>
  );
}
