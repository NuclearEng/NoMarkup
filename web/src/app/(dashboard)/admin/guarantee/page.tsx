'use client';

import { useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const STATUS_CLASSES: Record<DisputeStatus, string> = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  investigating: 'bg-purple-100 text-purple-800 border-purple-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
  escalated: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_LABELS: Record<DisputeStatus, string> = {
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

export default function AdminGuaranteePage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  // We use the disputes endpoint and filter for guarantee claims on the client side
  // In production, the backend would accept a is_guarantee_claim filter
  const { data, isLoading, isError } = useAdminDisputes({
    status: statusFilter,
    page,
    page_size: 50,
  });

  // Filter for guarantee claims — in the real backend this would be a query param
  const guaranteeClaims = (data?.disputes ?? []).filter((d) =>
    d.reason.toLowerCase().includes('guarantee') ||
    d.reason.toLowerCase().includes('claim'),
  );

  const columns: Column<Dispute>[] = [
    {
      key: 'id',
      header: 'Claim',
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
      key: 'contract',
      header: 'Contract',
      render: (dispute) => (
        <Link
          href={`/admin/disputes/${dispute.id}` as Route}
          className="text-sm text-primary hover:underline"
        >
          {dispute.contract_id.slice(0, 8)}...
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (dispute) => (
        <span className="text-sm">
          {dispute.initiator_name ?? dispute.initiated_by.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Claim Type',
      render: (dispute) => (
        <span className="line-clamp-2 text-sm">{dispute.reason}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (dispute) => (
        <Badge
          variant="outline"
          className={cn('text-xs', STATUS_CLASSES[dispute.status])}
        >
          {STATUS_LABELS[dispute.status]}
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
      header: 'Filed',
      render: (dispute) => (
        <span className="text-muted-foreground">{formatDate(dispute.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (dispute) => (
        <Link href={`/admin/disputes/${dispute.id}` as Route}>
          <Button variant="outline" size="sm" className="min-h-[44px]">
            Review
          </Button>
        </Link>
      ),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Guarantee Claims</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load guarantee claims. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Guarantee Claims</h1>
        <p className="mt-1 text-muted-foreground">
          Review and resolve NoMarkup Guarantee claims filed by customers.
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
          <SelectTrigger className="w-[180px] min-h-[44px]" aria-label="Filter claims by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {Object.entries(DISPUTE_STATUS).map(([key, value]) => (
              <SelectItem key={key} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={guaranteeClaims}
        rowKey={(dispute) => dispute.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No guarantee claims found matching the current filters."
      />
    </div>
  );
}
