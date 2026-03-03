'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useTrustHistory } from '@/hooks/useTrustScore';
import { cn } from '@/lib/utils';
import type { TrustScoreSnapshot, TrustTier } from '@/types';
import { TRUST_TIER } from '@/types';

const TIER_LABELS: Record<TrustTier, string> = {
  [TRUST_TIER.UNDER_REVIEW]: 'Under Review',
  [TRUST_TIER.NEW]: 'New',
  [TRUST_TIER.RISING]: 'Rising',
  [TRUST_TIER.TRUSTED]: 'Trusted',
  [TRUST_TIER.TOP_RATED]: 'Top Rated',
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface SnapshotEntryProps {
  snapshot: TrustScoreSnapshot;
  isLast: boolean;
}

function SnapshotEntry({ snapshot, isLast }: SnapshotEntryProps) {
  const currentScore = snapshot.score.overall_score;
  const previousScore = snapshot.previous_overall;
  const delta = currentScore - previousScore;
  const deltaPercent = Math.round(delta * 100);
  const currentPercent = Math.round(currentScore * 100);

  const tierChanged = snapshot.score.tier !== snapshot.previous_tier;

  const isPositive = delta > 0;
  const isNegative = delta < 0;
  const isNeutral = delta === 0;

  return (
    <div className="flex gap-3">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'mt-1 flex h-3 w-3 shrink-0 rounded-full',
            isPositive && 'bg-emerald-500',
            isNegative && 'bg-red-500',
            isNeutral && 'bg-muted-foreground/40',
          )}
        />
        {!isLast ? <div className="w-px flex-1 bg-border" /> : null}
      </div>

      {/* Content */}
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Score with delta */}
          <span className="text-sm font-semibold tabular-nums">{String(currentPercent)}%</span>
          {!isNeutral ? (
            <span
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
                isPositive && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
                isNegative && 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
              )}
            >
              {isPositive ? '\u2191' : '\u2193'}
              {isPositive ? '+' : ''}{String(deltaPercent)}%
            </span>
          ) : null}

          {/* Tier change indicator */}
          {tierChanged ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              {TIER_LABELS[snapshot.previous_tier]}
              {' \u2192 '}
              {TIER_LABELS[snapshot.score.tier]}
            </span>
          ) : null}
        </div>

        {/* Reason */}
        <p className="mt-1 text-sm text-muted-foreground">{snapshot.change_reason}</p>

        {/* Date */}
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          {formatDate(snapshot.recorded_at)} at {formatTime(snapshot.recorded_at)}
        </p>
      </div>
    </div>
  );
}

interface TrustScoreHistoryProps {
  userId: string;
  className?: string;
}

export function TrustScoreHistory({ userId, className }: TrustScoreHistoryProps) {
  const { data, isLoading, isError, error } = useTrustHistory(userId, 1, 20);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Score History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="mt-1 h-3 w-3 animate-pulse rounded-full bg-muted" />
                  {i < 2 ? <div className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="flex-1 space-y-2 pb-6">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to load score history';

    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Score History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed p-4">
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const snapshots = data?.snapshots ?? [];

  if (snapshots.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Score History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">No score history available yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pagination = data?.pagination;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Score History</CardTitle>
          {pagination ? (
            <span className="text-xs text-muted-foreground">
              {String(pagination.totalCount)} change{pagination.totalCount !== 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {/* Score range summary bar */}
        {snapshots.length > 1 ? (
          <>
            <ScoreRangeSummary snapshots={snapshots} />
            <Separator className="my-4" />
          </>
        ) : null}

        {/* Timeline */}
        <div className="space-y-0">
          {snapshots.map((snapshot, index) => (
            <SnapshotEntry
              key={snapshot.recorded_at}
              snapshot={snapshot}
              isLast={index === snapshots.length - 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ScoreRangeSummaryProps {
  snapshots: TrustScoreSnapshot[];
}

function ScoreRangeSummary({ snapshots }: ScoreRangeSummaryProps) {
  const scores = snapshots.map((s) => s.score.overall_score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const latestScore = scores[0] ?? 0;
  const oldestScore = scores[scores.length - 1] ?? 0;
  const netChange = latestScore - oldestScore;
  const netPercent = Math.round(netChange * 100);

  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          Range: {String(Math.round(minScore * 100))}% &ndash; {String(Math.round(maxScore * 100))}%
        </span>
      </div>
      <span
        className={cn(
          'text-xs font-medium tabular-nums',
          netChange > 0 && 'text-emerald-600 dark:text-emerald-400',
          netChange < 0 && 'text-red-600 dark:text-red-400',
          netChange === 0 && 'text-muted-foreground',
        )}
      >
        Net: {netChange > 0 ? '+' : ''}{String(netPercent)}%
      </span>
    </div>
  );
}
