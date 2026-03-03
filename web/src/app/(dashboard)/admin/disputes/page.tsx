'use client';

import { useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminDisputes } from '@/hooks/useAdmin';
import { cn, formatCents } from '@/lib/utils';
import type { Dispute, DisputeStatus } from '@/types';
import { DISPUTE_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const DISPUTE_STATUS_CLASSES: Record<DisputeStatus, string> = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  investigating: 'bg-purple-100 text-purple-800 border-purple-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
  escalated: 'bg-red-100 text-red-800 border-red-200',
};

const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminDisputesPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useAdminDisputes({
    status: statusFilter,
    page,
    page_size: 20,
  });

  const columns: Column<Dispute>[] = [
    {
      key: 'id',
      header: 'Dispute',
      render: (dispute) => (
        <Link
          href={`/admin/disputes/${dispute.id}` as Route}
          className="font-medium text-primary hover:underline"
        >
          {dispute.id.slice(0, 8)}...
        </Link>
      ),
    },
    {
      key: 'parties',
      header: 'Parties',
      render: (dispute) => (
        <div className="text-sm">
          <p>{dispute.initiator_name ?? dispute.initiated_by.slice(0, 8)}</p>
          <p className="text-xs text-muted-foreground">
            vs {dispute.respondent_name ?? 'Respondent'}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (dispute) => (
        <span className="line-clamp-2 text-sm">
          {dispute.reason}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (dispute) => (
        <Badge
          variant="outline"
          className={cn('text-xs', DISPUTE_STATUS_CLASSES[dispute.status])}
        >
          {DISPUTE_STATUS_LABELS[dispute.status]}
        </Badge>
      ),
    },
    {
      key: 'refund',
      header: 'Refund',
      render: (dispute) => (
        <span className="tabular-nums">
          {dispute.refund_amount_cents !== undefined && dispute.refund_amount_cents > 0
            ? formatCents(dispute.refund_amount_cents)
            : '--'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Opened',
      render: (dispute) => (
        <span className="text-muted-foreground">{formatDate(dispute.created_at)}</span>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dispute Management</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load disputes. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dispute Management</h1>
        <p className="mt-1 text-muted-foreground">
          Review and resolve contract disputes between customers and providers.
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
          <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter disputes by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(DISPUTE_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {DISPUTE_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.disputes ?? []}
        rowKey={(dispute) => dispute.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No disputes found matching the current filters."
      />
    </div>
  );
}
