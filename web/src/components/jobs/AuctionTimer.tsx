'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

interface AuctionTimerProps {
  auctionEndsAt: string;
  compact?: boolean;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

function calculateTimeRemaining(endsAt: string): TimeRemaining {
  const endDate = new Date(endsAt);
  const now = new Date();
  const totalMs = Math.max(0, endDate.getTime() - now.getTime());

  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, totalMs };
}

function getColorClass(totalMs: number): string {
  const totalHours = totalMs / (1000 * 60 * 60);
  if (totalHours > 24) return 'text-green-600';
  if (totalHours >= 1) return 'text-yellow-600';
  return 'text-red-600';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function AuctionTimer({ auctionEndsAt, compact = false }: AuctionTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(() =>
    calculateTimeRemaining(auctionEndsAt),
  );

  useEffect(() => {
    if (timeRemaining.totalMs <= 0) return;

    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining(auctionEndsAt);
      setTimeRemaining(remaining);
      if (remaining.totalMs <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => { clearInterval(interval); };
  }, [auctionEndsAt, timeRemaining.totalMs]);

  if (timeRemaining.totalMs <= 0) {
    return (
      <span className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
        Auction Closed
      </span>
    );
  }

  const colorClass = getColorClass(timeRemaining.totalMs);

  if (compact) {
    const { days, hours, minutes } = timeRemaining;
    let display: string;
    if (days > 0) {
      display = `${String(days)}d ${String(hours)}h`;
    } else if (hours > 0) {
      display = `${String(hours)}h ${String(minutes)}m`;
    } else {
      display = `${String(minutes)}m ${String(timeRemaining.seconds)}s`;
    }

    return (
      <span className={cn('text-xs font-medium', colorClass)} aria-label="Time remaining">
        {display}
      </span>
    );
  }

  const { days, hours, minutes, seconds } = timeRemaining;

  return (
    <div className={cn('font-medium', colorClass)} aria-label="Auction time remaining">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Time Remaining</p>
      <p className="text-lg tabular-nums">
        {days > 0 ? `${String(days)}d ` : ''}
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
    </div>
  );
}
