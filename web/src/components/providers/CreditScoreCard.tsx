'use client';

import { Clock, ShieldCheck, TrendingUp } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useCreditLimit } from '@/hooks/useWorkingCapital';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCents } from '@/lib/utils';

// The three factors below mirror businessCreditScore() in the gateway
// (gateway/internal/handler/advance_pricing.go), which is itself a mirror of
// the payment service's authoritative scoring. Keep the weights and guidance in
// sync with that formula — do not invent factors the model does not use.
const SCORE_FACTORS = [
  {
    icon: Clock,
    title: 'Repayment history',
    weight: 'Up to 50%',
    description:
      'Repay every working-capital advance on time. This is the single largest factor. Providers with no advance history start from a neutral baseline (grade D) and climb as they build a clean repayment record.',
  },
  {
    icon: TrendingUp,
    title: 'Completed jobs',
    weight: 'Up to 30%',
    description:
      'Complete more contracts. Your score increases with each finished job up to 20 completed jobs, where this factor is maxed out.',
  },
  {
    icon: ShieldCheck,
    title: 'Total earnings',
    weight: 'Up to 20%',
    description:
      'Grow your lifetime earnings on the platform. Higher cumulative earnings raise this factor in tiers, rewarding consistent, higher-value work.',
  },
] as const;

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

  // Normalize every numeric field — the upstream payment service can return a
  // zero/absent limit (e.g. grade-D providers with no remaining headroom), and
  // a missing field must never produce NaN in the UI.
  const maxAdvanceCents = Number.isFinite(creditLimit.max_advance_cents)
    ? creditLimit.max_advance_cents
    : 0;
  const outstandingCents = Number.isFinite(creditLimit.total_outstanding_cents)
    ? creditLimit.total_outstanding_cents
    : 0;
  // Prefer the authoritative available figure from the service; only derive it
  // (clamped at >= 0) when the API didn't send a finite value.
  const availableCents = Number.isFinite(creditLimit.available_cents)
    ? creditLimit.available_cents
    : Math.max(0, maxAdvanceCents - outstandingCents);
  const riskScore = Number.isFinite(creditLimit.risk_score) ? creditLimit.risk_score : 1;

  // Fully utilized = no headroom left to borrow. This is true both when the
  // limit is reached (outstanding >= max) AND when there is simply no limit at
  // all (maxAdvanceCents === 0, e.g. a grade-D provider). In every "0 available"
  // case the bar must read as FULL and clearly labeled, never as a blank track —
  // an empty bar next to "$0 available" reads as broken.
  const fullyUtilized = availableCents <= 0;
  const utilizationRatio =
    maxAdvanceCents > 0 ? outstandingCents / maxAdvanceCents : fullyUtilized ? 1 : 0;
  // Render the bar full (100%) whenever credit is exhausted, even if the raw
  // ratio is 0 because the limit itself is 0.
  const utilizationPercent = fullyUtilized
    ? 100
    : Math.min(100, Math.round(utilizationRatio * 100));
  const colors = getUtilizationColor(fullyUtilized ? 1 : utilizationRatio);
  const grade = getRiskGrade(riskScore);

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
            aria-label={`Credit limit: ${formatCents(maxAdvanceCents)}`}
          >
            {formatCents(maxAdvanceCents)}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">Maximum advance limit</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{fullyUtilized ? 'Fully utilized' : 'Utilized'}</span>
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
              aria-label={
                fullyUtilized
                  ? 'Credit fully utilized: 100% used, $0 available'
                  : `Credit utilization: ${String(utilizationPercent)}%`
              }
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{formatCents(outstandingCents)} used</span>
            <span>
              {fullyUtilized ? '$0 available' : `${formatCents(availableCents)} available`}
            </span>
          </div>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="rounded-sm text-xs text-[var(--brand-gold)] hover:underline focus:outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              How to improve your score &rarr;
            </button>
          </DialogTrigger>
          {/*
            glass-elevated + explicit bg-card: opaque, lifted surface over the
            bg-black/80 overlay even where backdrop-filter is unsupported, so the
            dialog never renders as a transparent panel (mirrors RepayDialog).
            Radix handles focus trapping + restore and Escape-to-close.
          */}
          <DialogContent className="glass-elevated max-w-md bg-card">
            <DialogHeader>
              <DialogTitle className="text-white/90">
                How to improve your NoMarkup Credit Score
              </DialogTitle>
              <DialogDescription className="text-white/50">
                Your score (0&ndash;100) sets your credit grade and the rate on working-capital
                advances. It is built from three factors:
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-4">
              {SCORE_FACTORS.map((factor) => (
                <li key={factor.title} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-gold)]/10"
                    aria-hidden="true"
                  >
                    <factor.icon className="h-4 w-4 text-[var(--brand-gold)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-white/80">{factor.title}</p>
                      <span className="shrink-0 text-xs font-semibold text-[var(--brand-gold)] tabular-nums">
                        {factor.weight}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">
                      {factor.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="text-xs leading-relaxed text-white/40">
              Scores update automatically as your repayment, job, and earnings history change. A
              higher score raises your grade (A&ndash;F) and lowers your advance APR.
            </p>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
