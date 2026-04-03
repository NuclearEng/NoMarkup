'use client';

import { useState } from 'react';

import { Loader2 } from 'lucide-react';

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
import { useAdminAdvances, useReviewAdvance } from '@/hooks/useWorkingCapital';
import { ADVANCE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { AdvanceStatus, WorkingCapitalAdvance } from '@/types';
import { ADVANCE_STATUS } from '@/types';

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

function AdvanceActions({ advance }: { advance: WorkingCapitalAdvance }) {
  const reviewAdvance = useReviewAdvance();

  if (advance.status !== ADVANCE_STATUS.REQUESTED) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        className="min-h-[44px]"
        disabled={reviewAdvance.isPending}
        onClick={() => {
          reviewAdvance.mutate({ advanceId: advance.id, approved: true });
        }}
      >
        {reviewAdvance.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        Approve
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="min-h-[44px]"
        disabled={reviewAdvance.isPending}
        onClick={() => {
          reviewAdvance.mutate({
            advanceId: advance.id,
            approved: false,
            rejection_reason: 'Does not meet eligibility criteria',
          });
        }}
      >
        Reject
      </Button>
    </div>
  );
}

export default function AdminAdvancesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useAdminAdvances({
    status: statusFilter,
    page,
    page_size: 20,
  });

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
      render: (advance) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCents(advance.advance_amount_cents)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'Fee',
      render: (advance) => (
        <span className="text-sm tabular-nums">
          {formatCents(advance.fee_cents)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
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
      key: 'created_at',
      header: 'Date',
      render: (advance) => (
        <span className="text-sm text-muted-foreground">{formatDate(advance.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (advance) => <AdvanceActions advance={advance} />,
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
        <p className="mt-1 text-zinc-400">
          Review and manage provider working capital advance requests.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Status:</span>
        <Select
          value={statusFilter ?? ALL_FILTER}
          onValueChange={(v) => {
            setStatusFilter(v === ALL_FILTER ? undefined : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter advances by status">
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
    </div>
    </PageTransition>
  );
}
