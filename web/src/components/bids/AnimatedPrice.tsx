'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn, formatCents } from '@/lib/utils';

interface AnimatedPriceProps {
  cents: number;
  formatCurrency?: (cents: number) => string;
  className?: string;
}

interface CharState {
  char: string;
  key: string;
  isDigit: boolean;
  animating: boolean;
  exitChar: string | null;
}

const ANIMATION_DURATION_MS = 400;

function buildCharStates(formatted: string, keyPrefix: number): CharState[] {
  return formatted.split('').map((char, i) => ({
    char,
    key: `${String(keyPrefix)}-${String(i)}`,
    isDigit: /\d/.test(char),
    animating: false,
    exitChar: null,
  }));
}

export function AnimatedPrice({
  cents,
  formatCurrency = formatCents,
  className,
}: AnimatedPriceProps) {
  const prevCentsRef = useRef(cents);
  const keyCounterRef = useRef(0);
  const formatRef = useRef(formatCurrency);
  formatRef.current = formatCurrency;
  const [charStates, setCharStates] = useState<CharState[]>(() =>
    buildCharStates(cents > 0 ? formatCurrency(cents) : '\u2014', 0),
  );
  const [flashDirection, setFlashDirection] = useState<'green' | 'red' | null>(null);

  const animateTransition = useCallback(
    (prevCents: number, nextCents: number) => {
      if (nextCents <= 0) {
        keyCounterRef.current += 1;
        setCharStates(buildCharStates('\u2014', keyCounterRef.current));
        return;
      }

      const prevFormatted = prevCents > 0 ? formatRef.current(prevCents) : '';
      const nextFormatted = formatRef.current(nextCents);

      // Determine direction: price decrease = green (good for customer), increase = red
      const direction = nextCents < prevCents ? 'green' : 'red';
      setFlashDirection(direction);

      keyCounterRef.current += 1;
      const kp = keyCounterRef.current;

      // Pad the shorter string on the left so we align digits from the right
      const maxLen = Math.max(prevFormatted.length, nextFormatted.length);
      const prevPadded = prevFormatted.padStart(maxLen);
      const nextPadded = nextFormatted.padStart(maxLen);

      const newStates: CharState[] = nextPadded.split('').map((char, i) => {
        const prevChar = prevPadded[i];
        const isDigit = /\d/.test(char);
        const changed = prevChar !== undefined && prevChar !== char && isDigit;

        return {
          char,
          key: `${String(kp)}-${String(i)}`,
          isDigit,
          animating: changed,
          exitChar: changed && prevChar !== undefined ? prevChar : null,
        };
      });

      setCharStates(newStates);

      // Clear animation state after duration
      setTimeout(() => {
        setCharStates((prev) =>
          prev.map((s) => ({
            ...s,
            animating: false,
            exitChar: null,
          })),
        );
        setFlashDirection(null);
      }, ANIMATION_DURATION_MS + 100);
    },
    [],
  );

  useEffect(() => {
    if (cents !== prevCentsRef.current) {
      animateTransition(prevCentsRef.current, cents);
      prevCentsRef.current = cents;
    }
  }, [cents, animateTransition]);

  // Initialize on first render if cents > 0
  useEffect(() => {
    if (cents > 0 && charStates.length === 1 && charStates[0]?.char === '\u2014') {
      keyCounterRef.current += 1;
      setCharStates(buildCharStates(formatCurrency(cents), keyCounterRef.current));
    }
  }, [cents, charStates, formatCurrency]);

  const flashClass =
    flashDirection === 'green'
      ? 'animate-digit-flash-green'
      : flashDirection === 'red'
        ? 'animate-digit-flash-red'
        : '';

  return (
    <span
      className={cn('inline-flex items-baseline tabular-nums', flashClass, className)}
      aria-live="polite"
      aria-atomic="true"
    >
      {charStates.map((state) => {
        if (!state.isDigit || !state.animating) {
          // Static character: dollar sign, comma, period, or non-changing digit
          return (
            <span key={state.key} className="inline-block">
              {state.char}
            </span>
          );
        }

        // Animated digit: old slides out up, new slides in from bottom
        return (
          <span
            key={state.key}
            className="relative inline-block overflow-hidden"
            style={{ width: '0.65em', height: '1.2em' }}
          >
            {/* Exiting digit — slides up and out */}
            {state.exitChar !== null ? (
              <span
                className="absolute inset-x-0 top-0 inline-block text-center will-change-transform animate-digit-roll-up"
              >
                {state.exitChar}
              </span>
            ) : null}
            {/* Entering digit — slides in from below */}
            <span
              className="absolute inset-x-0 top-0 inline-block text-center will-change-transform animate-digit-roll-down"
            >
              {state.char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
