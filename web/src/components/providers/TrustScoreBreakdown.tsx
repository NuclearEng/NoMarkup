'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { TierRequirement, TrustScore, TrustTier } from '@/types';
import { TRUST_TIER } from '@/types';

import { TrustScoreBadge } from './TrustScoreBadge';

const TIER_ORDER: TrustTier[] = [
  TRUST_TIER.UNDER_REVIEW,
  TRUST_TIER.NEW,
  TRUST_TIER.RISING,
  TRUST_TIER.TRUSTED,
  TRUST_TIER.TOP_RATED,
];

const TIER_LABELS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: 'Under Review',
  [TRUST_TIER.NEW]: 'New',
  [TRUST_TIER.RISING]: 'Rising',
  [TRUST_TIER.TRUSTED]: 'Trusted',
  [TRUST_TIER.TOP_RATED]: 'Top Rated',
};

interface Dimension {
  key: keyof Pick<TrustScore, 'feedback_score' | 'volume_score' | 'risk_score' | 'fraud_score'>;
  label: string;
  weight: number;
}

const DIMENSIONS: Dimension[] = [
  { key: 'feedback_score', label: 'Feedback', weight: 35 },
  { key: 'volume_score', label: 'Volume', weight: 20 },
  { key: 'risk_score', label: 'Safety', weight: 25 },
  { key: 'fraud_score', label: 'Account Health', weight: 20 },
];

function getScoreColor(value: number): string {
  if (value >= 0.7) return 'bg-emerald-500';
  if (value >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

function getScoreTextColor(value: number): string {
  if (value >= 0.7) return 'text-emerald-600 dark:text-emerald-400';
  if (value >= 0.4) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

interface ScoreBarProps {
  label: string;
  weight: number;
  value: number;
}

function ScoreBar({ label, weight, value }: ScoreBarProps) {
  const percentage = Math.round(value * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {label}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({String(weight)}%)
          </span>
        </span>
        <span className={cn('font-semibold tabular-nums', getScoreTextColor(value))}>
          {String(percentage)}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', getScoreColor(value))}
          style={{ width: `${String(percentage)}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${String(percentage)}%`}
        />
      </div>
    </div>
  );
}

function findNextTier(
  currentTier: TrustTier,
  tierRequirements: TierRequirement[],
): TierRequirement | null {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) return null;

  const nextTierValue = TIER_ORDER[currentIndex + 1];
  if (!nextTierValue) return null;

  return tierRequirements.find((req) => req.tier === nextTierValue) ?? null;
}

interface TrustScoreBreakdownProps {
  score: TrustScore;
  tierRequirements?: TierRequirement[];
  className?: string;
}

export function TrustScoreBreakdown({
  score,
  tierRequirements,
  className,
}: TrustScoreBreakdownProps) {
  const overallPercent = Math.round(score.overall_score * 100);
  const nextTier = tierRequirements ? findNextTier(score.tier, tierRequirements) : null;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Trust Score</CardTitle>
          <TrustScoreBadge tier={score.tier} score={score.overall_score} size="sm" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall score display */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-current"
            style={{
              color:
                score.overall_score >= 0.7
                  ? 'var(--color-emerald-500, #10b981)'
                  : score.overall_score >= 0.4
                    ? 'var(--color-amber-500, #f59e0b)'
                    : 'var(--color-red-500, #ef4444)',
            }}
          >
            <span className="text-xl font-bold text-foreground">{String(overallPercent)}</span>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Overall Score</p>
            <p className="text-2xl font-bold">{String(overallPercent)}%</p>
            <p className="text-xs text-muted-foreground">
              Based on {String(score.data_points)} data point{score.data_points !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <Separator />

        {/* Dimension bars */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">Score Breakdown</h4>
          {DIMENSIONS.map((dim) => (
            <ScoreBar
              key={dim.key}
              label={dim.label}
              weight={dim.weight}
              value={score[dim.key]}
            />
          ))}
        </div>

        {/* Next tier requirements */}
        {nextTier ? (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                Requirements for {TIER_LABELS[nextTier.tier]}
              </h4>
              <p className="text-xs text-muted-foreground">{nextTier.description}</p>
              <ul className="space-y-2 text-sm">
                <TierCheckItem
                  label={`Overall score ${String(Math.round(nextTier.min_overall_score * 100))}%+`}
                  met={score.overall_score >= nextTier.min_overall_score}
                />
                <TierCheckItem
                  label={`${String(nextTier.min_completed_jobs)}+ completed jobs`}
                  met={false}
                  indeterminate
                />
                <TierCheckItem
                  label={`${String(nextTier.min_reviews)}+ reviews`}
                  met={false}
                  indeterminate
                />
                <TierCheckItem
                  label={`${String(nextTier.min_rating)}+ average rating`}
                  met={false}
                  indeterminate
                />
                {nextTier.requires_verification ? (
                  <TierCheckItem
                    label="Identity verification required"
                    met={false}
                    indeterminate
                  />
                ) : null}
              </ul>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface TierCheckItemProps {
  label: string;
  met: boolean;
  indeterminate?: boolean;
}

function TierCheckItem({ label, met, indeterminate }: TierCheckItemProps) {
  return (
    <li className="flex items-center gap-2">
      {indeterminate ? (
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground"
          aria-label="Status unknown"
        >
          ?
        </span>
      ) : met ? (
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white"
          aria-label="Requirement met"
        >
          {'\u2713'}
        </span>
      ) : (
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground"
          aria-label="Requirement not met"
        >
          {'\u2717'}
        </span>
      )}
      <span className={cn(met ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </li>
  );
}
