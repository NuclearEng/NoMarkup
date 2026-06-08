'use client';

import { useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

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
import { useAdminGuaranteeClaims } from '@/hooks/useGuarantee';
import { GUARANTEE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { Dispute, DisputeStatus } from '@/types';
import { DISPUTE_STATUS } from '@/types';

const ALL_FILTER = '__all__';

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

// The contract service identifies the filer as `opened_by`; older responses
// aliased it as `initiated_by`. Read whichever is present, null-safe.
function disputeInitiator(claim: Dispute): string {
  return claim.opened_by ?? claim.initiated_by ?? '';
}

// The contract service describes a dispute via `description` (with `dispute_type`
// as a fallback); `reason` is the legacy alias.
function disputeReason(claim: Dispute): string {
  return claim.reason ?? claim.description ?? claim.dispute_type ?? '';
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
          className="text-[var(--brand-gold)] font-medium hover:underline"
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
          href={`/contracts/${claim.contract_id}` as Route}
          className="text-[var(--brand-gold)] font-mono text-xs hover:underline"
        >
          {claim.contract_id.slice(0, 8)}...
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (claim) => (
        <span className="text-sm">{claim.initiator_name ?? disputeInitiator(claim).slice(0, 8)}</span>
      ),
    },
    {
      key: 'reason',
      header: 'Claim Type',
      render: (claim) => <span className="line-clamp-2 text-sm">{disputeReason(claim)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (claim) => (
        <Badge variant="outline" className={cn('text-xs', GUARANTEE_STATUS_CLASSES[claim.status])}>
          {STATUS_LABELS[claim.status]}
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
        <span className="text-zinc-300">{formatDate(claim.created_at)}</span>
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
        <h1 className="gold-text text-2xl font-bold tracking-tight">Guarantee Claims</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load guarantee claims"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Guarantee Claims</h1>
        <p className="text-zinc-300 mt-1">
          Review and resolve NoMarkup Guarantee claims filed by customers.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-300 text-sm font-medium">Status:</span>
        <Select
          value={statusFilter ?? ALL_FILTER}
          onValueChange={(v) => {
            setStatusFilter(v === ALL_FILTER ? undefined : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="min-h-[44px] w-full sm:w-[180px]" aria-label="Filter claims by status">
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
        rowKey={(claim) => claim.id}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        loading={isLoading}
        emptyMessage="No guarantee claims found matching the current filters."
      />
    </div>
    </PageTransition>
  );
}
