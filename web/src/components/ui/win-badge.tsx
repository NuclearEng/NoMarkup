'use client';

import { Check, DollarSign, Star, Trophy } from 'lucide-react';

import { cn } from '@/lib/utils';

const WIN_BADGE_TYPE = {
  AWARDED: 'awarded',
  LOWEST: 'lowest',
  BEST_VALUE: 'best-value',
  SAVINGS_MILESTONE: 'savings-milestone',
} as const;
type WinBadgeType = (typeof WIN_BADGE_TYPE)[keyof typeof WIN_BADGE_TYPE];

interface WinBadgeProps {
  type: WinBadgeType;
  label?: string;
  animate?: boolean;
  className?: string;
}

const BADGE_CONFIGS: Record<
  WinBadgeType,
  {
    defaultLabel: string;
    containerClasses: string;
    iconClasses: string;
  }
> = {
  [WIN_BADGE_TYPE.AWARDED]: {
    defaultLabel: 'Awarded',
    containerClasses:
      'gold-gradient text-white shadow-sm gold-glow relative overflow-hidden',
    iconClasses: 'text-white',
  },
  [WIN_BADGE_TYPE.LOWEST]: {
    defaultLabel: 'Lowest',
    containerClasses:
      'bg-emerald-600 text-white shadow-sm shadow-emerald-500/20',
    iconClasses: 'text-white',
  },
  [WIN_BADGE_TYPE.BEST_VALUE]: {
    defaultLabel: 'Best Value',
    containerClasses:
      'bg-blue-600 text-white shadow-sm shadow-blue-500/20',
    iconClasses: 'text-white',
  },
  [WIN_BADGE_TYPE.SAVINGS_MILESTONE]: {
    defaultLabel: 'Savings',
    containerClasses:
      'bg-amber-500 text-black shadow-sm shadow-amber-400/20',
    iconClasses: 'text-black',
  },
};

function BadgeIcon({ type, iconClasses }: { type: WinBadgeType; iconClasses: string }) {
  const iconSize = 'h-3.5 w-3.5';
  switch (type) {
    case WIN_BADGE_TYPE.AWARDED:
      return <Check className={cn(iconSize, iconClasses)} aria-hidden="true" />;
    case WIN_BADGE_TYPE.LOWEST:
      return <Trophy className={cn(iconSize, iconClasses)} aria-hidden="true" />;
    case WIN_BADGE_TYPE.BEST_VALUE:
      return <Star className={cn(iconSize, iconClasses)} aria-hidden="true" />;
    case WIN_BADGE_TYPE.SAVINGS_MILESTONE:
      return <DollarSign className={cn(iconSize, iconClasses)} aria-hidden="true" />;
  }
}

export function WinBadge({ type, label, animate = false, className }: WinBadgeProps) {
  const config = BADGE_CONFIGS[type];
  const displayLabel = label ?? config.defaultLabel;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide',
        config.containerClasses,
        animate && 'animate-celebration-scale-bounce',
        type === WIN_BADGE_TYPE.AWARDED &&
          'after:absolute after:inset-0 after:translate-x-[-100%] after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent after:animate-[shimmer-sweep_3s_ease-in-out_infinite]',
        className,
      )}
      role="status"
      aria-label={displayLabel}
    >
      <BadgeIcon type={type} iconClasses={config.iconClasses} />
      {displayLabel}
    </span>
  );
}

export { WIN_BADGE_TYPE };
export type { WinBadgeType, WinBadgeProps };
