'use client';

import { useEffect, useState } from 'react';

import { formatCents } from '@/lib/utils';

interface AnimatedPriceProps {
  cents: number;
  formatCurrency?: (cents: number) => string;
}

export function AnimatedPrice({ cents, formatCurrency = formatCents }: AnimatedPriceProps) {
  const [displayCents, setDisplayCents] = useState(cents);
  const [isChanging, setIsChanging] = useState(false);

  useEffect(() => {
    if (cents !== displayCents) {
      setIsChanging(true);
      const timer = setTimeout(() => {
        setDisplayCents(cents);
        setIsChanging(false);
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [cents, displayCents]);

  return (
    <span
      className={`transition-all duration-300 ${isChanging ? 'scale-110 brightness-150' : ''}`}
      style={{
        display: 'inline-block',
        textShadow: '0 0 20px rgba(34, 197, 94, 0.4), 0 0 40px rgba(34, 197, 94, 0.15)',
      }}
    >
      {displayCents > 0 ? formatCurrency(displayCents) : '\u2014'}
    </span>
  );
}
