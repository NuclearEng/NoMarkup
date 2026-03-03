'use client';

import { Clock, FileText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatCents } from '@/lib/utils';
import type { Contract } from '@/types';
import { CONTRACT_STATUS, MILESTONE_STATUS, PAYMENT_TIMING } from '@/types';

import { AcceptanceCountdown } from './AcceptanceCountdown';

interface ContractCardProps {
  contract: Contract;
}

function getStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
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

export function ContractCard({ contract }: ContractCardProps) {
  const approvedCount = contract.milestones.filter(
    (m) => m.status === MILESTONE_STATUS.APPROVED,
  ).length;
  const totalMilestones = contract.milestones.length;
  const progressPercent = totalMilestones > 0 ? Math.round((approvedCount / totalMilestones) * 100) : 0;

  return (
    <Link href={`/contracts/${contract.id}` as Route} className="block">
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h3 className="truncate text-base font-semibold">{contract.contract_number}</h3>
            </div>
            <Badge variant={getStatusVariant(contract.status)} className="shrink-0">
              {getStatusLabel(contract.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Amount and payment timing */}
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-bold">{formatCents(contract.amount_cents)}</p>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {getPaymentTimingLabel(contract.payment_timing)}
            </div>
          </div>

          {/* Milestone progress */}
          {totalMilestones > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Milestones</span>
                <span>
                  {String(approvedCount)} / {String(totalMilestones)} completed
                </span>
              </div>
              <Progress value={progressPercent} />
            </div>
          ) : null}

          {/* Acceptance deadline for pending contracts */}
          {contract.status === CONTRACT_STATUS.PENDING_ACCEPTANCE ? (
            <AcceptanceCountdown deadline={contract.acceptance_deadline} />
          ) : null}

          {/* Job ID reference */}
          <p className="text-xs text-muted-foreground">
            Job: {contract.job_id.slice(0, 8)}...
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export { getStatusLabel, getStatusVariant, getPaymentTimingLabel };
