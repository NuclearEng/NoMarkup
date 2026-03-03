'use client';

import { cn } from '@/lib/utils';
import type { TrustTier } from '@/types';
import { TRUST_TIER } from '@/types';

const TIER_LABELS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: 'Under Review',
  [TRUST_TIER.NEW]: 'New',
  [TRUST_TIER.RISING]: 'Rising',
  [TRUST_TIER.TRUSTED]: 'Trusted',
  [TRUST_TIER.TOP_RATED]: 'Top Rated',
};

const TIER_COLORS: Record<TrustTier, { bg: string; text: string; border: string; icon: string }> = {
  [TRUST_TIER.UNDER_REVIEW]: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-gray-300 dark:border-gray-600',
    icon: 'text-gray-400',
  },
  [TRUST_TIER.NEW]: {
    bg: 'bg-sky-50 dark:bg-sky-950',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-300 dark:border-sky-700',
    icon: 'text-sky-500',
  },
  [TRUST_TIER.RISING]: {
    bg: 'bg-emerald-50 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700',
    icon: 'text-emerald-500',
  },
  [TRUST_TIER.TRUSTED]: {
    bg: 'bg-violet-50 dark:bg-violet-950',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-300 dark:border-violet-700',
    icon: 'text-violet-500',
  },
  [TRUST_TIER.TOP_RATED]: {
    bg: 'bg-amber-50 dark:bg-amber-950',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700',
    icon: 'text-amber-500',
  },
};

const TIER_ICONS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: '\u23F3', // hourglass
  [TRUST_TIER.NEW]: '\u2726',          // four-pointed star
  [TRUST_TIER.RISING]: '\u2191',       // up arrow
  [TRUST_TIER.TRUSTED]: '\u2713',      // check mark
  [TRUST_TIER.TOP_RATED]: '\u2605',    // filled star
};

interface TrustScoreBadgeProps {
  tier: TrustTier;
  score?: number; // 0.0-1.0, optional
  size?: 'sm' | 'md' | 'lg';
}

export function TrustScoreBadge({ tier, score, size = 'md' }: TrustScoreBadgeProps) {
  const colors = TIER_COLORS[tier];
  const label = TIER_LABELS[tier];
  const icon = TIER_ICONS[tier];

  const scorePercent = score !== undefined ? Math.round(score * 100) : undefined;

  if (size === 'sm') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
          colors.bg,
          colors.text,
          colors.border,
        )}
        aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
      >
        <span aria-hidden="true">{icon}</span>
        {label}
      </span>
    );
  }

  if (size === 'lg') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2.5 rounded-lg border px-4 py-2.5 font-semibold',
          colors.bg,
          colors.text,
          colors.border,
        )}
        aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
      >
        <span className="text-xl" aria-hidden="true">
          {icon}
        </span>
        <span className="flex flex-col">
          <span className="text-base leading-tight">{label}</span>
          {scorePercent !== undefined ? (
            <span className="text-sm font-normal opacity-80">
              {String(scorePercent)}% trust score
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  // md (default)
  return (
    <span
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold',
        colors.bg,
        colors.text,
        colors.border,
      )}
      aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
      {scorePercent !== undefined ? (
        <span className="ml-0.5 font-normal opacity-75">
          {String(scorePercent)}%
        </span>
      ) : null}
    </span>
  );
}
