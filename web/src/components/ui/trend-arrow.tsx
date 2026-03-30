'use client';

import { cn } from '@/lib/utils';

const SIZE_MAP = {
  sm: { icon: 'h-3.5 w-3.5', text: 'text-xs' },
  md: { icon: 'h-4 w-4', text: 'text-sm' },
  lg: { icon: 'h-5 w-5', text: 'text-base' },
} as const;

type TrendSize = keyof typeof SIZE_MAP;

interface TrendArrowProps {
  value: number;
  label?: string;
  size?: TrendSize;
  className?: string;
}

export function TrendArrow({ value, label, size = 'sm', className }: TrendArrowProps) {
  const sizeConfig = SIZE_MAP[size];

  const isPositive = value > 0;
  const isNeutral = value === 0;

  // Positive trend = green (e.g. savings going up), negative = red
  const colorClass = isNeutral
    ? 'text-muted-foreground'
    : isPositive
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';

  // Rotation: up arrow for positive, down arrow for negative, horizontal dash for neutral
  const rotation = isNeutral ? 0 : isPositive ? -90 : 90;

  return (
    <span
      className={cn('inline-flex items-center gap-1', colorClass, className)}
      aria-label={
        isNeutral
          ? 'No change'
          : `${isPositive ? 'Positive' : 'Negative'} trend${label ? `: ${label}` : ''}`
      }
    >
      {isNeutral ? (
        <svg
          className={cn(sizeConfig.icon)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ) : (
        <svg
          className={cn(sizeConfig.icon, 'animate-trend-bounce')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            ['--trend-rotation' as string]: `${String(rotation)}deg`,
            willChange: 'transform',
          }}
        >
          {/* Arrow pointing right, rotated via CSS custom property */}
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      )}
      {label ? <span className={cn(sizeConfig.text, 'font-medium')}>{label}</span> : null}
    </span>
  );
}
