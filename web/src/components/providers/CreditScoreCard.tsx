'use client';

import Link from 'next/link';

import { useCreditLimit } from '@/hooks/useWorkingCapital';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCents } from '@/lib/utils';

function getRiskGrade(riskScore: number): string {
  if (riskScore < 0.3) return 'A';
  if (riskScore < 0.5) return 'B';
  if (riskScore < 0.7) return 'C';
  return 'D';
}

function getUtilizationColor(utilizationRatio: number): {
  bar: string;
  grade: string;
} {
  if (utilizationRatio < 0.5) {
    return { bar: 'bg-emerald-500', grade: 'text-emerald-400' };
  }
  if (utilizationRatio < 0.75) {
    return { bar: 'bg-amber-500', grade: 'text-amber-400' };
  }
  return { bar: 'bg-red-500', grade: 'text-red-400' };
}

export function CreditScoreCard() {
  const { data: creditLimit, isLoading } = useCreditLimit();

  if (isLoading) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-zinc-300 text-sm font-medium">NoMarkup Credit Score</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-36" />
        </CardContent>
      </Card>
    );
  }

  if (!creditLimit) {
    return null;
  }

  const utilizationRatio =
    creditLimit.max_advance_cents > 0
      ? creditLimit.total_outstanding_cents / creditLimit.max_advance_cents
      : 0;
  const utilizationPercent = Math.min(100, Math.round(utilizationRatio * 100));
  const colors = getUtilizationColor(utilizationRatio);
  const grade = getRiskGrade(creditLimit.risk_score);

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-zinc-300 text-sm font-medium">NoMarkup Credit Score</CardTitle>
        <span
          className={`text-2xl font-bold tabular-nums ${colors.grade}`}
          aria-label={`Risk grade: ${grade}`}
        >
          {grade}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p
            className="text-3xl font-bold tabular-nums text-zinc-100"
            aria-label={`Credit limit: ${formatCents(creditLimit.max_advance_cents)}`}
          >
            {formatCents(creditLimit.max_advance_cents)}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">Maximum advance limit</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Utilized</span>
            <span>{String(utilizationPercent)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
              style={{ width: `${String(utilizationPercent)}%` }}
              role="progressbar"
              aria-valuenow={utilizationPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Credit utilization: ${String(utilizationPercent)}%`}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{formatCents(creditLimit.total_outstanding_cents)} used</span>
            <span>{formatCents(creditLimit.available_cents)} available</span>
          </div>
        </div>

        <Link
          href="/provider/advances"
          className="text-xs text-[var(--brand-gold)] hover:underline focus:outline-none focus-visible:underline"
        >
          How to improve your score &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}
