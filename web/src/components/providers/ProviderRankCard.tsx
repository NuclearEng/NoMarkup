'use client';

import { Award, Flame, Trophy } from 'lucide-react';

import { useProviderStreaks } from '@/hooks/useBids';

export function ProviderRankCard() {
  const { data: streaks, isLoading } = useProviderStreaks();

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-6">
        <div className="bg-muted h-6 w-32 animate-pulse rounded" />
        <div className="bg-muted mt-4 h-10 w-48 animate-pulse rounded" />
      </div>
    );
  }

  if (!streaks || streaks.length === 0) {
    return null;
  }

  // Aggregate across categories
  const totalWins = streaks.reduce((sum, s) => sum + s.total_wins, 0);
  const maxStreak = Math.max(...streaks.map((s) => s.current_streak));
  const longestStreak = Math.max(...streaks.map((s) => s.longest_streak));
  const rankedStreaks = streaks.filter((s) => s.category_rank !== null);
  const bestRank =
    rankedStreaks.length > 0
      ? Math.min(...rankedStreaks.map((s) => s.category_rank as number))
      : null;

  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" />
        <h3 className="font-semibold">Win Stats</h3>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Total Wins</p>
          <div className="flex items-center gap-1">
            <Award className="text-primary h-4 w-4" aria-hidden="true" />
            <p className="text-2xl font-bold">{String(totalWins)}</p>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Win Streak</p>
          <div className="flex items-center gap-1">
            <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
            <p className="text-2xl font-bold">{String(maxStreak)}</p>
          </div>
          {longestStreak > maxStreak ? (
            <p className="text-muted-foreground text-xs">Best: {String(longestStreak)}</p>
          ) : null}
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Best Rank</p>
          <p className="text-2xl font-bold">
            {bestRank !== null ? `#${String(bestRank)}` : '\u2014'}
          </p>
        </div>
      </div>
    </div>
  );
}
