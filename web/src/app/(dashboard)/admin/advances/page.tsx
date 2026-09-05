'use client';

import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminAdvances, useDisburseAdvance, useReviewAdvance } from '@/hooks/useWorkingCapital';
import { ADVANCE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { AdvanceStatus, WorkingCapitalAdvance } from '@/types';
import { ADVANCE_STATUS } from '@/types';

type PendingAction =
  | { kind: 'approve' | 'reject' | 'disburse'; advance: WorkingCapitalAdvance }
  | null;

const ALL_FILTER = '__all__';

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  disbursed: 'Disbursed',
  repaying: 'Repaying',
  repaid: 'Repaid',
  defaulted: 'Defaulted',
  rejected: 'Rejected',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AdvanceActions({
  advance,
  onRequest,
  pending,
}: {
  advance: WorkingCapitalAdvance;
  onRequest: (action: NonNullable<PendingAction>) => void;
  pending: boolean;
}) {
  if (advance.status === ADVANCE_STATUS.REQUESTED) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="min-h-[44px]"
          disabled={pending}
          onClick={() => {
            onRequest({ kind: 'approve', advance });
          }}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="min-h-[44px]"
          disabled={pending}
          onClick={() => {
            onRequest({ kind: 'reject', advance });
          }}
        >
          Reject
        </Button>
      </div>
    );
  }

  if (advance.status === ADVANCE_STATUS.APPROVED) {
    return (
      <Button
        size="sm"
        className="min-h-[44px]"
        disabled={pending}
        onClick={() => {
          onRequest({ kind: 'disburse', advance });
        }}
      >
        Disburse
      </Button>
    );
  }

  return null;
}

export default function AdminAdvancesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const { data, isLoading, isError } = useAdminAdvances({
    status: statusFilter,
    page,
    page_size: 20,
  });
  const reviewAdvance = useReviewAdvance();
  const disburseAdvance = useDisburseAdvance();
  const actionPending = reviewAdvance.isPending || disburseAdvance.isPending;

  function confirmPendingAction() {
    if (!pendingAction) return;
    const { kind, advance } = pendingAction;
    if (kind === 'approve') {
      reviewAdvance.mutate(
        { advanceId: advance.id, action: 'approve' },
        { onSettled: () => { setPendingAction(null); } },
      );
      return;
    }
    if (kind === 'reject') {
      reviewAdvance.mutate(
        {
          advanceId: advance.id,
          action: 'reject',
          reason: 'Does not meet eligibility criteria',
        },
        { onSettled: () => { setPendingAction(null); } },
      );
      return;
    }
    disburseAdvance.mutate(advance.id, {
      onSettled: () => { setPendingAction(null); },
    });
  }

  const columns: Column<WorkingCapitalAdvance>[] = [
    {
      key: 'provider',
      header: 'Provider',
      render: (advance) => (
        <span className="text-sm font-medium">{advance.provider_id.slice(0, 8)}...</span>
      ),
    },
    {
      key: 'contract',
      header: 'Contract',
      render: (advance) => (
        <span className="text-sm">
          {advance.contract_number ?? advance.contract_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'whitespace-nowrap',
      render: (advance) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCents(advance.advance_amount_cents)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      className: 'whitespace-nowrap',
      render: (advance) => (
        <span className="text-sm tabular-nums">
          {formatCents(advance.fee_cents)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (advance) => (
        <Badge
          variant="outline"
          className={cn('text-xs', ADVANCE_STATUS_CLASSES[advance.status])}
        >
          {STATUS_LABELS[advance.status]}
        </Badge>
      ),
    },
    {
      key: 'transfer',
      header: 'Transfer ID',
      render: (advance) => (
        <span className="text-xs text-zinc-400 font-mono">
          {advance.stripe_transfer_id ? advance.stripe_transfer_id.slice(0, 16) : '\u2014'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Date',
      className: 'whitespace-nowrap',
      render: (advance) => (
        <span className="text-sm text-zinc-300">{formatDate(advance.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      sticky: true,
      header: 'Actions',
      className: 'whitespace-nowrap',
      render: (advance) => (
        <AdvanceActions
          advance={advance}
          pending={actionPending}
          onRequest={setPendingAction}
        />
      ),
    },
  ];

  if (isError) {
    return (
      <PageTransition>
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Working Capital Advances</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load advances"
          description="Please try refreshing the page."
        />
      </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Working Capital Advances</h1>
        <p className="mt-1 text-zinc-300">
          Review and manage provider working capital advance requests.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-300">Status:</span>
        <Select
          value={statusFilter ?? ALL_FILTER}
          onValueChange={(v) => {
            setStatusFilter(v === ALL_FILTER ? undefined : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full min-h-[44px] sm:w-[180px]" aria-label="Filter advances by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(ADVANCE_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.advances ?? []}
        rowKey={(advance) => advance.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No advances found matching the current filters."
      />

      <ActionConfirmDialog
        open={pendingAction !== null}
        onClose={() => {
          if (!actionPending) setPendingAction(null);
        }}
        onConfirm={confirmPendingAction}
        title={
          pendingAction?.kind === 'approve'
            ? 'Approve working capital advance?'
            : pendingAction?.kind === 'reject'
              ? 'Reject working capital advance?'
              : 'Disburse working capital advance?'
        }
        description={
          pendingAction
            ? `${pendingAction.kind === 'disburse' ? 'Disburse' : pendingAction.kind === 'approve' ? 'Approve' : 'Reject'} ${formatCents(pendingAction.advance.advance_amount_cents)} for provider ${pendingAction.advance.provider_id.slice(0, 8)}… This is a money-moving action.`
            : ''
        }
        confirmLabel={
          pendingAction?.kind === 'approve'
            ? 'Approve'
            : pendingAction?.kind === 'reject'
              ? 'Reject'
              : 'Disburse'
        }
        destructive={pendingAction?.kind === 'reject' || pendingAction?.kind === 'disburse'}
        loading={actionPending}
      />
    </div>
    </PageTransition>
  );
}
