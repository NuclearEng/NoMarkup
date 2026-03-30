'use client';

import { Coins, TrendingDown } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useSavings } from '@/hooks/useBids';

export function SavingsTracker() {
  const { data: savings, isLoading } = useSavings();

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <Skeleton variant="text" className="h-6 w-32" />
        <Skeleton variant="price" className="mt-4 h-10 w-48" />
      </div>
    );
  }

  if (!savings || savings.length === 0) {
    return null;
  }

  const totalSavingsCents = savings.reduce((sum, s) => sum + s.savings_cents, 0);
  const totalJobs = savings.length;

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-green-500" aria-hidden="true" />
        <h3 className="font-semibold">Your Savings</h3>
      </div>
      <p className="mt-3 text-3xl font-bold text-green-600 dark:text-emerald-400">
        {formatCurrency(totalSavingsCents)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        saved across {String(totalJobs)} {totalJobs === 1 ? 'job' : 'jobs'}
      </p>
      {totalSavingsCents > 0 ? (
        <div className="mt-3 flex items-center gap-1 text-sm text-green-600 dark:text-emerald-400">
          <TrendingDown className="h-4 w-4" aria-hidden="true" />
          <span>vs. market median</span>
        </div>
      ) : null}
    </div>
  );
}
