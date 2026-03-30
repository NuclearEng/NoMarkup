'use client';

import { Activity, Flame, Snowflake, Thermometer } from 'lucide-react';

import { cn } from '@/lib/utils';

const VELOCITY_LEVEL = {
  HOT: 'hot',
  HEATING: 'heating',
  COOLING: 'cooling',
  QUIET: 'quiet',
} as const;
type VelocityLevel = (typeof VELOCITY_LEVEL)[keyof typeof VELOCITY_LEVEL];

interface BidVelocityIndicatorProps {
  velocity: number; // bids per minute
  buckets: number[]; // recent activity buckets for sparkline
  className?: string;
}

function getVelocityLevel(velocity: number): VelocityLevel {
  if (velocity >= 6) return VELOCITY_LEVEL.HOT;
  if (velocity >= 3) return VELOCITY_LEVEL.HEATING;
  if (velocity >= 1) return VELOCITY_LEVEL.COOLING;
  return VELOCITY_LEVEL.QUIET;
}

const LEVEL_CONFIG = {
  [VELOCITY_LEVEL.HOT]: {
    label: 'Hot',
    Icon: Flame,
    textClass: 'text-red-400',
    barClass: 'bg-red-400',
    bgClass: 'bg-red-500/10',
    pulseClass: 'animate-pulse',
  },
  [VELOCITY_LEVEL.HEATING]: {
    label: 'Heating up',
    Icon: Thermometer,
    textClass: 'text-amber-400',
    barClass: 'bg-amber-400',
    bgClass: 'bg-amber-500/10',
    pulseClass: '',
  },
  [VELOCITY_LEVEL.COOLING]: {
    label: 'Cooling',
    Icon: Activity,
    textClass: 'text-blue-400',
    barClass: 'bg-blue-400',
    bgClass: 'bg-blue-500/10',
    pulseClass: '',
  },
  [VELOCITY_LEVEL.QUIET]: {
    label: 'Quiet',
    Icon: Snowflake,
    textClass: 'text-muted-foreground',
    barClass: 'bg-muted-foreground/40',
    bgClass: 'bg-muted/50',
    pulseClass: '',
  },
} as const;

/** Map velocity levels to glow shadow colors */
const GLOW_COLORS: Record<VelocityLevel, string> = {
  [VELOCITY_LEVEL.HOT]: 'rgba(248, 113, 113, 0.4)',
  [VELOCITY_LEVEL.HEATING]: 'rgba(251, 191, 36, 0.35)',
  [VELOCITY_LEVEL.COOLING]: 'rgba(96, 165, 250, 0.3)',
  [VELOCITY_LEVEL.QUIET]: 'transparent',
};

export function BidVelocityIndicator({
  velocity,
  buckets,
  className,
}: BidVelocityIndicatorProps) {
  const level = getVelocityLevel(velocity);
  const config = LEVEL_CONFIG[level];
  const { Icon } = config;
  const maxBucket = Math.max(1, ...buckets);
  const glowColor = GLOW_COLORS[level];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
        'border border-transparent',
        config.bgClass,
        config.pulseClass,
        className,
      )}
      style={{
        borderColor: level !== VELOCITY_LEVEL.QUIET
          ? `color-mix(in srgb, ${glowColor} 40%, transparent)`
          : undefined,
      }}
      role="status"
      aria-label={`Bid velocity: ${String(velocity)} bids per minute, ${config.label}`}
    >
      <Icon
        className={cn('h-3 w-3 shrink-0', config.textClass)}
        aria-hidden="true"
      />

      {/* Mini sparkline bars with glow */}
      <div className="flex items-end gap-px h-3" aria-hidden="true">
        {buckets.map((count, i) => {
          const barHeight = Math.max(2, (count / maxBucket) * 12);
          return (
            <div
              key={`bucket-${String(i)}`}
              className={cn('w-[2.5px] rounded-full transition-all duration-300', config.barClass)}
              style={{
                height: `${String(barHeight)}px`,
                opacity: 0.4 + (i / buckets.length) * 0.6,
                boxShadow: count > 0 ? `0 0 3px ${glowColor}` : undefined,
              }}
            />
          );
        })}
      </div>

      <span className={cn('text-[10px] font-bold tabular-nums leading-none', config.textClass)}>
        {String(velocity)}/m
      </span>
      <span
        className={cn(
          'text-[9px] font-extrabold uppercase tracking-wider leading-none',
          config.textClass,
          level === VELOCITY_LEVEL.HOT && 'tracking-widest',
        )}
      >
        {config.label}
      </span>
    </div>
  );
}
