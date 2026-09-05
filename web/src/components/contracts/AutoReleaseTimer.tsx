'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

interface AutoReleaseTimerProps {
  completedAt: string;
}

const AUTO_RELEASE_DAYS = 7;

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

function calculateTimeRemaining(completedAt: string): TimeRemaining {
  const completedDate = new Date(completedAt);
  const releaseDate = new Date(completedDate.getTime() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const totalMs = Math.max(0, releaseDate.getTime() - now.getTime());

  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, totalMs };
}

function getColorClass(totalMs: number): string {
  const totalHours = totalMs / (1000 * 60 * 60);
  if (totalHours > 72) return 'text-trust-medium';
  if (totalHours >= 24) return 'text-status-disputed';
  return 'text-destructive';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function AutoReleaseTimer({ completedAt }: AutoReleaseTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(() =>
    calculateTimeRemaining(completedAt),
  );
  // Gates the time-derived output to post-mount. A value computed during SSR via
  // `new Date()` differs from the client's first render → hydration mismatch.
  // Render a deterministic placeholder until mounted (see the early return below).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTimeRemaining(calculateTimeRemaining(completedAt));
  }, [completedAt]);

  useEffect(() => {
    if (!mounted) return;
    if (timeRemaining.totalMs <= 0) return;

    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining(completedAt);
      setTimeRemaining(remaining);
      if (remaining.totalMs <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => { clearInterval(interval); };
  }, [completedAt, mounted, timeRemaining.totalMs]);

  // Pre-mount: render a stable placeholder so SSR and the first client render
  // match. The effect above flips `mounted` and fills in the live time after.
  if (!mounted) {
    return (
      <div
        className="rounded-lg border border-trust-medium/30 bg-trust-medium/10 p-4"
        suppressHydrationWarning
      >
        <p className="text-sm font-medium text-trust-medium">Auto-Release Countdown</p>
      </div>
    );
  }

  if (timeRemaining.totalMs <= 0) {
    return (
      <div className="rounded-lg border border-status-completed/30 bg-status-completed/10 p-4">
        <p className="text-sm font-medium text-status-completed">
          Payment has been auto-released.
        </p>
      </div>
    );
  }

  const colorClass = getColorClass(timeRemaining.totalMs);
  const { days, hours, minutes, seconds } = timeRemaining;

  return (
    <div className="rounded-lg border border-trust-medium/30 bg-trust-medium/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', colorClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-trust-medium">Auto-Release Countdown</p>
          <p
            className={cn('mt-1 text-lg font-bold tabular-nums', colorClass)}
            aria-label="Auto-release countdown"
          >
            {days > 0 ? `${String(days)}d ` : ''}
            {pad(hours)}:{pad(minutes)}:{pad(seconds)}
          </p>
          <p className="mt-1 text-xs text-trust-medium">
            Payment will be automatically released to the provider if no action is taken within{' '}
            {String(AUTO_RELEASE_DAYS)} days of completion.
          </p>
        </div>
      </div>
    </div>
  );
}
