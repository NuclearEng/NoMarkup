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
  if (totalHours > 72) return 'text-yellow-600';
  if (totalHours >= 24) return 'text-orange-600';
  return 'text-red-600';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function AutoReleaseTimer({ completedAt }: AutoReleaseTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(() =>
    calculateTimeRemaining(completedAt),
  );

  useEffect(() => {
    if (timeRemaining.totalMs <= 0) return;

    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining(completedAt);
      setTimeRemaining(remaining);
      if (remaining.totalMs <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => { clearInterval(interval); };
  }, [completedAt, timeRemaining.totalMs]);

  if (timeRemaining.totalMs <= 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-700">
          Payment has been auto-released.
        </p>
      </div>
    );
  }

  const colorClass = getColorClass(timeRemaining.totalMs);
  const { days, hours, minutes, seconds } = timeRemaining;

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn('h-5 w-5 shrink-0 mt-0.5', colorClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-yellow-800">Auto-Release Countdown</p>
          <p className={cn('text-lg font-bold tabular-nums mt-1', colorClass)} aria-label="Auto-release countdown">
            {days > 0 ? `${String(days)}d ` : ''}
            {pad(hours)}:{pad(minutes)}:{pad(seconds)}
          </p>
          <p className="mt-1 text-xs text-yellow-700">
            Payment will be automatically released to the provider if no action is taken within{' '}
            {String(AUTO_RELEASE_DAYS)} days of completion.
          </p>
        </div>
      </div>
    </div>
  );
}
