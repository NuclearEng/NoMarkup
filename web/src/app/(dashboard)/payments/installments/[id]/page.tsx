'use client';

import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { useInstallmentPlan } from '@/hooks/useInstallments';
import { cn, formatCents } from '@/lib/utils';
import type { InstallmentPlanStatus, ScheduledInstallmentStatus } from '@/types';
import { SCHEDULED_INSTALLMENT_STATUS } from '@/types';

const PLAN_STATUS_CLASSES: Record<InstallmentPlanStatus, string> = {
  active: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  completed: 'bg-green-500/10 text-green-300 border-green-500/30',
  defaulted: 'bg-red-500/10 text-red-300 border-red-500/30',
  cancelled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
};

const PLAN_STATUS_LABELS: Record<InstallmentPlanStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  defaulted: 'Defaulted',
  cancelled: 'Cancelled',
};

const INSTALLMENT_STATUS_CLASSES: Record<ScheduledInstallmentStatus, string> = {
  scheduled: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  processing: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  paid: 'bg-green-500/10 text-green-300 border-green-500/30',
  failed: 'bg-red-500/10 text-red-300 border-red-500/30',
  retrying: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

const INSTALLMENT_STATUS_LABELS: Record<ScheduledInstallmentStatus, string> = {
  scheduled: 'Scheduled',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  retrying: 'Retrying',
};

function StatusIcon({ status }: { status: ScheduledInstallmentStatus }) {
  switch (status) {
    case SCHEDULED_INSTALLMENT_STATUS.PAID:
      return <CheckCircle2 className="h-5 w-5 text-green-400" aria-hidden="true" />;
    case SCHEDULED_INSTALLMENT_STATUS.PROCESSING:
      return <Loader2 className="h-5 w-5 animate-spin text-blue-400" aria-hidden="true" />;
    case SCHEDULED_INSTALLMENT_STATUS.FAILED:
      return <XCircle className="h-5 w-5 text-red-400" aria-hidden="true" />;
    case SCHEDULED_INSTALLMENT_STATUS.RETRYING:
      return <RefreshCw className="h-5 w-5 text-amber-400" aria-hidden="true" />;
    default:
      return <Clock className="h-5 w-5 text-zinc-500" aria-hidden="true" />;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function InstallmentPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = params.id;
  const { data, isLoading, isError } = useInstallmentPlan(planId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={`skel-inst-${String(i)}`} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link
          href={'/payments' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Payments
        </Link>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load payment plan"
          description="Something went wrong. Please try again."
          className="glass border-destructive/30"
        />
      </div>
    );
  }

  const plan = data.plan;
  const paidCount = plan.installments.filter(
    (i) => i.status === SCHEDULED_INSTALLMENT_STATUS.PAID,
  ).length;
  const progressPercent = plan.installment_count > 0
    ? Math.round((paidCount / plan.installment_count) * 100)
    : 0;

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href={'/payments' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-zinc-300 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Payments
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="gold-text text-2xl font-bold tracking-tight">Payment Plan</h1>
              <Badge
                variant="outline"
                className={cn('text-xs', PLAN_STATUS_CLASSES[plan.status])}
              >
                {PLAN_STATUS_LABELS[plan.status]}
              </Badge>
            </div>
            <p className="mt-1 text-zinc-300">
              {String(plan.installment_count)} payments of {formatCents(plan.per_installment_cents)}
            </p>
          </div>
        </div>

        {/* Plan Overview */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">Plan Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Contract Total</span>
              <span className="text-sm font-bold tabular-nums">
                {formatCents(plan.total_amount_cents)}
              </span>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">
                BNPL Fee ({String(Math.round(plan.fee_rate * 100))}%)
              </span>
              <span className="text-sm tabular-nums text-zinc-300">
                {formatCents(plan.bnpl_fee_cents)}
              </span>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="font-medium">Total with Fee</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCents(plan.total_with_fee_cents)}
              </span>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Per Payment</span>
              <span className="text-sm font-bold tabular-nums">
                {formatCents(plan.per_installment_cents)}/mo
              </span>
            </div>

            {/* Progress bar */}
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Progress</span>
                <span className="tabular-nums">
                  {String(paidCount)} / {String(plan.installment_count)} paid
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-emerald-500/60 transition-all duration-500"
                  style={{ width: `${String(progressPercent)}%` }}
                  role="progressbar"
                  aria-valuenow={paidCount}
                  aria-valuemin={0}
                  aria-valuemax={plan.installment_count}
                  aria-label="Payment progress"
                />
              </div>
            </div>

            {/* Provider Paid */}
            {plan.provider_paid_at ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Provider paid on {formatDate(plan.provider_paid_at)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Installment Schedule */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-zinc-300" aria-hidden="true" />
              <CardTitle className="gold-text text-base">Payment Schedule</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {plan.installments.map((installment, index) => (
                <div
                  key={installment.id}
                  className="relative flex items-start gap-4 pb-6 last:pb-0"
                >
                  {/* Timeline connector */}
                  {index < plan.installments.length - 1 ? (
                    <div
                      className="absolute left-[9px] top-7 h-[calc(100%-16px)] w-px bg-white/10"
                      aria-hidden="true"
                    />
                  ) : null}

                  {/* Status icon */}
                  <div className="relative z-10 mt-0.5 shrink-0">
                    <StatusIcon status={installment.status} />
                  </div>

                  {/* Content */}
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white/80">
                        Payment {String(installment.installment_number)}
                      </p>
                      <p className="text-xs text-zinc-400">
                        Due: {formatDate(installment.due_date)}
                        {installment.paid_at
                          ? ` \u2022 Paid: ${formatDate(installment.paid_at)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold tabular-nums text-white/80">
                        {formatCents(installment.amount_cents)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          INSTALLMENT_STATUS_CLASSES[installment.status],
                        )}
                      >
                        {INSTALLMENT_STATUS_LABELS[installment.status]}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}
