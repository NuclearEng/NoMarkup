'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

interface CountdownClockProps {
  endsAt: string | null;
  className?: string;
}

/**
 * Live auction countdown that re-renders every second.
 * Color shifts at 10min (gold→amber) and 60s (amber→red urgency).
 * Returns "Ended" once the deadline passes.
 *
 * Uses setInterval rather than rAF so we don't fight the browser when
 * many cards render at once on the scoreboard. One tick per second is
 * enough — sub-second precision isn't visible to the user.
 */
export function CountdownClock({ endsAt, className }: CountdownClockProps) {
  // `now` starts null so the SSR render and the first client render are
  // deterministic (no Date.now() during initial render). It's filled in after
  // mount; otherwise the time computed on the server differs from the client a
  // moment later → React hydration mismatch. Mirrors useCountdown.ts.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now()); // first live value, post-mount
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  if (!endsAt) {
    return (
      <span className={cn('font-mono text-sm text-zinc-500', className)}>—:—:—</span>
    );
  }

  // Pre-mount placeholder — identical on server and first client render.
  if (now === null) {
    return (
      <span className={cn('font-mono text-sm text-zinc-500', className)}>—:—:—</span>
    );
  }

  const end = new Date(endsAt).getTime();
  const ms = end - now;

  if (ms <= 0) {
    return (
      <span className={cn('font-mono text-sm font-semibold text-zinc-500', className)}>
        Ended
      </span>
    );
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const urgency =
    ms < 60_000 ? 'critical' : ms < 600_000 ? 'urgent' : 'normal';

  const color =
    urgency === 'critical'
      ? 'text-red-300 animate-pulse'
      : urgency === 'urgent'
        ? 'text-amber-300'
        : 'text-emerald-300';

  const display =
    hours > 0
      ? `${String(hours)}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
      : minutes > 0
        ? `${String(minutes)}:${String(seconds).padStart(2, '0')}`
        : `${String(seconds)}s`;

  return (
    <span
      className={cn('font-mono text-base font-semibold tabular-nums', color, className)}
      aria-live={urgency === 'critical' ? 'polite' : 'off'}
    >
      {display}
    </span>
  );
}
