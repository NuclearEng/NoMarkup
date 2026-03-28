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
import { useAdminGuaranteeClaims } from '@/hooks/useGuarantee';
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

  const { data, isLoading, isError } = useAdminGuaranteeClaims({
    status: statusFilter,
    page,
    page_size: 20,
  });

  const guaranteeClaims = data?.guarantee_claims ?? [];

  const columns: Column<Dispute>[] = [
    {
      key: 'id',
      header: 'Claim',
      render: (claim) => (
        <Link
          href={`/admin/guarantee/${claim.id}` as Route}
          className="font-medium text-primary hover:underline"
        >
          {claim.id.slice(0, 8)}...
        </Link>
      ),
    },
    {
      key: 'contract',
      header: 'Contract',
      render: (claim) => (
        <Link
          href={`/admin/disputes/${claim.id}` as Route}
          className="font-mono text-xs text-primary hover:underline"
        >
          {claim.contract_id.slice(0, 8)}...
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (claim) => (
        <span className="text-sm">
          {claim.initiator_name ?? claim.initiated_by.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Claim Type',
      render: (claim) => (
        <span className="line-clamp-2 text-sm">{claim.reason}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (claim) => (
        <Badge
          variant="outline"
          className={cn('text-xs', STATUS_CLASSES[claim.status])}
        >
          {STATUS_LABELS[claim.status] ?? claim.status}
        </Badge>
      ),
    },
    {
      key: 'refund',
      header: 'Payout',
      render: (claim) => (
        <span className="tabular-nums">
          {claim.refund_amount_cents !== undefined && claim.refund_amount_cents > 0
            ? formatCents(claim.refund_amount_cents)
            : '--'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Filed',
      render: (claim) => (
        <span className="text-muted-foreground">{formatDate(claim.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (claim) => (
        <Link href={`/admin/guarantee/${claim.id}` as Route}>
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
                {STATUS_LABELS[value] ?? value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={guaranteeClaims}
        rowKey={(claim) => claim.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No guarantee claims found matching the current filters."
      />
    </div>
  );
}
