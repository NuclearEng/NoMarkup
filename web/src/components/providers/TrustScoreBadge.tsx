'use client';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
    bg: 'gold-gradient',
    text: 'text-white dark:text-white',
    border: 'border-[var(--brand-gold)] dark:border-[var(--brand-gold)]',
    icon: 'text-white',
  },
};

const TIER_ICONS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: '\u23F3', // hourglass
  [TRUST_TIER.NEW]: '\u2726',          // four-pointed star
  [TRUST_TIER.RISING]: '\u2191',       // up arrow
  [TRUST_TIER.TRUSTED]: '\u2713',      // check mark
  [TRUST_TIER.TOP_RATED]: '\u2605',    // filled star
};

const TIER_DESCRIPTIONS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: 'Account under review. Scores are locked until identity and license verification completes.',
  [TRUST_TIER.NEW]: 'New provider. Account verified — actively building a track record on the platform.',
  [TRUST_TIER.RISING]: 'Consistently delivering quality work. Ranks in the top 40% of new providers by completion and ratings.',
  [TRUST_TIER.TRUSTED]: 'Top 20% of providers platform-wide. Verified track record of quality completions and strong customer ratings.',
  [TRUST_TIER.TOP_RATED]: 'Top 5% platform-wide. Exceptional and consistent performance across all trust dimensions.',
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
  const description = TIER_DESCRIPTIONS[tier];

  const scorePercent = score !== undefined ? Math.round(score * 100) : undefined;

  const tooltipContent = (
    <>
      <p>{description}</p>
      {scorePercent !== undefined && (
        <p className="mt-1 text-zinc-400">{scorePercent}% composite score</p>
      )}
    </>
  );

  if (size === 'sm') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex cursor-default items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
              colors.bg,
              colors.text,
              colors.border,
            )}
            aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
            tabIndex={0}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }

  if (size === 'lg') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex cursor-default items-center gap-2.5 rounded-lg border px-4 py-2.5 font-semibold',
              colors.bg,
              colors.text,
              colors.border,
            )}
            aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
            tabIndex={0}
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
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    );
  }

  // md (default)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex min-h-[44px] cursor-default items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold',
            colors.bg,
            colors.text,
            colors.border,
          )}
          aria-label={`Trust tier: ${label}${scorePercent !== undefined ? `, score: ${String(scorePercent)}%` : ''}`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable for tooltip accessibility
          tabIndex={0}
        >
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
          {scorePercent !== undefined ? (
            <span className="ml-0.5 font-normal opacity-75">
              {String(scorePercent)}%
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}
