'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface AuctionTimerProps {
  auctionEndsAt: string;
  compact?: boolean;
  className?: string;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

/** Urgency levels with progressive animations */
const URGENCY_LEVEL = {
  CALM: 'calm',
  ACTIVE: 'active',
  URGENT: 'urgent',
  CRITICAL: 'critical',
  FINAL: 'final',
} as const;
type UrgencyLevel = (typeof URGENCY_LEVEL)[keyof typeof URGENCY_LEVEL];

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

function getUrgencyLevel(totalMs: number): UrgencyLevel {
  const totalHours = totalMs / (1000 * 60 * 60);
  const totalMinutes = totalMs / (1000 * 60);

  if (totalHours > 24) return URGENCY_LEVEL.CALM;
  if (totalHours > 4) return URGENCY_LEVEL.ACTIVE;
  if (totalHours > 1) return URGENCY_LEVEL.URGENT;
  if (totalMinutes > 15) return URGENCY_LEVEL.CRITICAL;
  return URGENCY_LEVEL.FINAL;
}

const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  [URGENCY_LEVEL.CALM]: 'text-emerald-500',
  [URGENCY_LEVEL.ACTIVE]: 'text-blue-500',
  [URGENCY_LEVEL.URGENT]: 'text-amber-500',
  [URGENCY_LEVEL.CRITICAL]: 'text-orange-500',
  [URGENCY_LEVEL.FINAL]: 'text-red-500',
};

const URGENCY_RING_COLORS: Record<UrgencyLevel, string> = {
  [URGENCY_LEVEL.CALM]: 'stroke-emerald-500',
  [URGENCY_LEVEL.ACTIVE]: 'stroke-blue-500',
  [URGENCY_LEVEL.URGENT]: 'stroke-amber-500',
  [URGENCY_LEVEL.CRITICAL]: 'stroke-orange-500',
  [URGENCY_LEVEL.FINAL]: 'stroke-red-500',
};

const URGENCY_RING_TRACK: Record<UrgencyLevel, string> = {
  [URGENCY_LEVEL.CALM]: 'stroke-emerald-500/15',
  [URGENCY_LEVEL.ACTIVE]: 'stroke-blue-500/15',
  [URGENCY_LEVEL.URGENT]: 'stroke-amber-500/15',
  [URGENCY_LEVEL.CRITICAL]: 'stroke-orange-500/15',
  [URGENCY_LEVEL.FINAL]: 'stroke-red-500/15',
};

const URGENCY_GLOW_COLORS: Record<UrgencyLevel, string> = {
  [URGENCY_LEVEL.CALM]: '',
  [URGENCY_LEVEL.ACTIVE]: 'shadow-blue-500/20',
  [URGENCY_LEVEL.URGENT]: 'shadow-amber-500/20',
  [URGENCY_LEVEL.CRITICAL]: 'shadow-orange-500/25',
  [URGENCY_LEVEL.FINAL]: 'shadow-red-500/30',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Animated digit that rolls when the value changes */
function AnimatedDigit({ value, className }: { value: string; className?: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayValue(value);
        setIsAnimating(false);
      }, 150);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [value]);

  return (
    <span
      className={cn(
        'inline-block overflow-hidden transition-transform duration-200',
        isAnimating && 'translate-y-[-10%] opacity-70',
        className,
      )}
      aria-hidden="true"
    >
      {displayValue}
    </span>
  );
}

/** SVG circular progress ring that depletes as time runs out */
function TimerRing({
  progress,
  urgency,
  size = 80,
  strokeWidth = 3,
}: {
  progress: number; // 0..1, where 1 = full, 0 = depleted
  urgency: UrgencyLevel;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.max(0, Math.min(1, progress));
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="absolute inset-0 -rotate-90"
      aria-hidden="true"
    >
      {/* Track ring */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        className={URGENCY_RING_TRACK[urgency]}
        strokeWidth={strokeWidth}
      />
      {/* Filled ring */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        className={cn(URGENCY_RING_COLORS[urgency], 'transition-all duration-1000')}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${String(filled)} ${String(circumference - filled)}`}
      />
    </svg>
  );
}

export function AuctionTimer({
  auctionEndsAt,
  compact = false,
  className,
}: AuctionTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining>(() =>
    calculateTimeRemaining(auctionEndsAt),
  );

  // Calculate total auction duration for ring progress
  const auctionStartMs = useRef(Date.now());
  const totalDurationMs = useRef(
    Math.max(1, new Date(auctionEndsAt).getTime() - auctionStartMs.current),
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

  const urgency = useMemo(
    () => (timeRemaining.totalMs > 0 ? getUrgencyLevel(timeRemaining.totalMs) : URGENCY_LEVEL.FINAL),
    [timeRemaining.totalMs],
  );

  const ringProgress = timeRemaining.totalMs / totalDurationMs.current;

  // Closed state
  if (timeRemaining.totalMs <= 0) {
    return (
      <span
        className={cn(
          'font-medium text-muted-foreground',
          compact ? 'text-xs' : 'text-sm',
          className,
        )}
      >
        Auction Closed
      </span>
    );
  }

  const colorClass = URGENCY_COLORS[urgency];
  const isFinalMinute = timeRemaining.totalMs < 60_000;
  const isFinal15 = urgency === URGENCY_LEVEL.FINAL;
  const isCriticalOrAbove =
    urgency === URGENCY_LEVEL.CRITICAL || urgency === URGENCY_LEVEL.FINAL;

  // Determine animation classes based on urgency
  const animationClass = cn(
    urgency === URGENCY_LEVEL.URGENT && 'animate-urgency-pulse',
    urgency === URGENCY_LEVEL.CRITICAL &&
      'animate-urgency-pulse [animation-duration:1.5s]',
    urgency === URGENCY_LEVEL.FINAL && 'animate-urgency-breathe',
    isFinalMinute && 'animate-urgency-shake',
  );

  // Compact variant
  if (compact) {
    const { days, hours, minutes, seconds } = timeRemaining;
    let display: string;
    if (days > 0) {
      display = `${String(days)}d ${String(hours)}h`;
    } else if (hours > 0) {
      display = `${String(hours)}h ${String(minutes)}m`;
    } else {
      display = `${String(minutes)}m ${String(seconds)}s`;
    }

    return (
      <span
        className={cn(
          'text-xs font-medium transition-colors duration-500',
          colorClass,
          animationClass,
          className,
        )}
        aria-label={`Time remaining: ${display}`}
        role="timer"
      >
        {display}
      </span>
    );
  }

  // Full variant with ring and animated digits
  const { days, hours, minutes, seconds } = timeRemaining;
  const ringSize = 80;

  return (
    <div
      className={cn('relative', className)}
      role="timer"
      aria-label={`Auction time remaining: ${String(days)} days, ${String(hours)} hours, ${String(minutes)} minutes, ${String(seconds)} seconds`}
    >
      {/* Glow ring for final 15 minutes */}
      {isFinal15 ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full',
            'animate-urgency-glow',
            colorClass,
          )}
          aria-hidden="true"
        />
      ) : null}

      <div className="relative flex flex-col items-center">
        {/* SVG ring container */}
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          <TimerRing
            progress={ringProgress}
            urgency={urgency}
            size={ringSize}
            strokeWidth={3}
          />

          {/* Timer text inside ring */}
          <div
            className={cn(
              'absolute inset-0 flex flex-col items-center justify-center',
              'transition-colors duration-500',
              colorClass,
              animationClass,
            )}
          >
            {days > 0 ? (
              <span className="text-lg font-bold tabular-nums leading-tight">
                {String(days)}d {String(hours)}h
              </span>
            ) : isFinalMinute ? (
              // Final minute: large seconds display with animated digits
              <div className="flex items-baseline">
                <span className="text-2xl font-black tabular-nums">
                  <AnimatedDigit value={pad(seconds)} />
                </span>
                <span className="ml-0.5 text-xs font-medium opacity-70">s</span>
              </div>
            ) : (
              <div className="flex items-baseline tabular-nums">
                {hours > 0 ? (
                  <>
                    <span className="text-lg font-bold">
                      <AnimatedDigit value={pad(hours)} />
                    </span>
                    <span className="mx-0.5 text-sm font-medium opacity-50">:</span>
                  </>
                ) : null}
                <span className="text-lg font-bold">
                  <AnimatedDigit value={pad(minutes)} />
                </span>
                <span className="mx-0.5 text-sm font-medium opacity-50">:</span>
                <span className="text-lg font-bold">
                  <AnimatedDigit value={pad(seconds)} />
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Label below ring */}
        <p className="mt-1 text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
          {isCriticalOrAbove ? 'Ending Soon' : 'Time Left'}
        </p>

        {/* Glow background for critical/final */}
        {isFinal15 ? (
          <div
            className={cn(
              'pointer-events-none absolute -inset-2 -z-10 rounded-full opacity-20 blur-xl',
              urgency === URGENCY_LEVEL.FINAL ? 'bg-red-500' : 'bg-orange-500',
            )}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
