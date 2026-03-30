'use client';

import { Clock, FileText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn, formatCents } from '@/lib/utils';
import type { Contract } from '@/types';
import { CONTRACT_STATUS, MILESTONE_STATUS, PAYMENT_TIMING } from '@/types';

import { AcceptanceCountdown } from './AcceptanceCountdown';

interface ContractCardProps {
  contract: Contract;
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case CONTRACT_STATUS.ACTIVE:
      return 'default';
    case CONTRACT_STATUS.PENDING_ACCEPTANCE:
      return 'secondary';
    case CONTRACT_STATUS.COMPLETED:
      return 'default';
    case CONTRACT_STATUS.CANCELLED:
    case CONTRACT_STATUS.VOIDED:
    case CONTRACT_STATUS.ABANDONED:
      return 'destructive';
    case CONTRACT_STATUS.DISPUTED:
    case CONTRACT_STATUS.SUSPENDED:
      return 'outline';
    default:
      return 'outline';
  }
}

/** Background tint colors for status badges to add visual weight */
function getStatusBadgeTint(status: string): string {
  switch (status) {
    case CONTRACT_STATUS.ACTIVE:
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case CONTRACT_STATUS.PENDING_ACCEPTANCE:
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case CONTRACT_STATUS.COMPLETED:
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case CONTRACT_STATUS.CANCELLED:
    case CONTRACT_STATUS.VOIDED:
    case CONTRACT_STATUS.ABANDONED:
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    case CONTRACT_STATUS.DISPUTED:
      return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case CONTRACT_STATUS.SUSPENDED:
      return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
    default:
      return '';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case CONTRACT_STATUS.PENDING_ACCEPTANCE:
      return 'Pending Acceptance';
    case CONTRACT_STATUS.ACTIVE:
      return 'Active';
    case CONTRACT_STATUS.COMPLETED:
      return 'Completed';
    case CONTRACT_STATUS.CANCELLED:
      return 'Cancelled';
    case CONTRACT_STATUS.VOIDED:
      return 'Voided';
    case CONTRACT_STATUS.DISPUTED:
      return 'Disputed';
    case CONTRACT_STATUS.ABANDONED:
      return 'Abandoned';
    case CONTRACT_STATUS.SUSPENDED:
      return 'Suspended';
    default:
      return status.replace(/_/g, ' ');
  }
}

function getPaymentTimingLabel(timing: string): string {
  switch (timing) {
    case PAYMENT_TIMING.UPFRONT:
      return 'Upfront';
    case PAYMENT_TIMING.MILESTONE:
      return 'Milestone';
    case PAYMENT_TIMING.COMPLETION:
      return 'On Completion';
    case PAYMENT_TIMING.PAYMENT_PLAN:
      return 'Payment Plan';
    case PAYMENT_TIMING.RECURRING:
      return 'Recurring';
    default:
      return timing.replace(/_/g, ' ');
  }
}

/** Gradient color for progress bar based on completion */
function getProgressGradient(percent: number): string {
  if (percent >= 100) return 'bg-gradient-to-r from-emerald-500 to-emerald-400';
  if (percent >= 60) return 'bg-gradient-to-r from-blue-500 to-emerald-500';
  return 'bg-gradient-to-r from-blue-500 to-blue-400';
}

export function ContractCard({ contract }: ContractCardProps) {
  const approvedCount = contract.milestones.filter(
    (m) => m.status === MILESTONE_STATUS.APPROVED,
  ).length;
  const totalMilestones = contract.milestones.length;
  const progressPercent =
    totalMilestones > 0 ? Math.round((approvedCount / totalMilestones) * 100) : 0;

  return (
    <Link href={`/contracts/${contract.id}` as Route} className="block">
      <Card className="glass glass-interactive glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader className="relative z-[2] pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
              <h3 className="truncate text-base font-semibold text-zinc-100">
                {contract.contract_number}
              </h3>
            </div>
            <Badge
              variant="outline"
              className={cn('shrink-0 border font-medium', getStatusBadgeTint(contract.status))}
            >
              {getStatusLabel(contract.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="relative z-[2] space-y-3">
          {/* Amount and payment timing */}
          <div className="flex items-baseline justify-between">
            <p
              className="text-2xl font-bold tracking-tight text-zinc-100 tabular-nums"
              style={{ textShadow: '0 0 16px rgba(16,185,129,0.15)' }}
            >
              {formatCents(contract.amount_cents)}
            </p>
            <div className="flex items-center gap-1 text-sm text-zinc-400">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {getPaymentTimingLabel(contract.payment_timing)}
            </div>
          </div>

          {/* Milestone progress with gradient bar on glass */}
          {totalMilestones > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-medium">Milestones</span>
                <span className="flex items-center gap-1.5">
                  <span>
                    {String(approvedCount)} / {String(totalMilestones)} completed
                  </span>
                  <span className="font-semibold text-zinc-200">{String(progressPercent)}%</span>
                </span>
              </div>
              {/* Progress bar with glow against glass */}
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    getProgressGradient(progressPercent),
                  )}
                  style={{
                    width: `${String(progressPercent)}%`,
                    boxShadow:
                      progressPercent >= 100
                        ? '0 0 8px rgba(16, 185, 129, 0.4)'
                        : '0 0 6px rgba(59, 130, 246, 0.3)',
                  }}
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
                {/* Glow dot at the progress edge */}
                {progressPercent > 0 && progressPercent < 100 ? (
                  <div
                    className="progress-glow-dot absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(59,130,246,0.5)]"
                    style={{ left: `calc(${String(progressPercent)}% - 6px)` }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Acceptance deadline for pending contracts */}
          {contract.status === CONTRACT_STATUS.PENDING_ACCEPTANCE ? (
            <AcceptanceCountdown deadline={contract.acceptance_deadline} />
          ) : null}

          {/* Job title reference */}
          <p className="truncate text-xs text-zinc-400">
            {contract.job_title || `Job: ${contract.job_id.slice(0, 8)}...`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export { getStatusLabel, getStatusVariant, getPaymentTimingLabel };
