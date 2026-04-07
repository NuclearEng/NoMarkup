'use client';

import { useState } from 'react';

import { Loader2 } from 'lucide-react';

import type { Column } from '@/components/admin/DataTable';
import { DataTable } from '@/components/admin/DataTable';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTransition } from '@/components/ui/page-transition';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminInsuranceClaims, useReviewInsuranceClaim } from '@/hooks/useInsurance';
import { cn, formatCents } from '@/lib/utils';
import type { InsuranceClaim, InsuranceClaimStatus } from '@/types';
import { INSURANCE_CLAIM_STATUS } from '@/types';

const ALL_FILTER = '__all__';

const CLAIM_STATUS_CLASSES: Record<InsuranceClaimStatus, string> = {
  filed: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  under_review: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  approved: 'bg-green-500/10 text-green-300 border-green-500/30',
  denied: 'bg-red-500/10 text-red-300 border-red-500/30',
  paid: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
};

const CLAIM_STATUS_LABELS: Record<InsuranceClaimStatus, string> = {
  filed: 'Filed',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ClaimActions({ claim }: { claim: InsuranceClaim }) {
  const reviewClaim = useReviewInsuranceClaim();
  const [approveAmount, setApproveAmount] = useState('');
  const [denyReason, setDenyReason] = useState('');
  const [showApprove, setShowApprove] = useState(false);
  const [showDeny, setShowDeny] = useState(false);

  const claimStatus = claim.status as InsuranceClaimStatus;
  if (
    claimStatus !== INSURANCE_CLAIM_STATUS.FILED &&
    claimStatus !== INSURANCE_CLAIM_STATUS.UNDER_REVIEW
  ) {
    return null;
  }

  if (showApprove) {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Approved $"
          value={approveAmount}
          onChange={(e) => {
            setApproveAmount(e.target.value);
          }}
          className="min-h-[44px] w-24"
          aria-label="Approved amount in dollars"
        />
        <Button
          size="sm"
          className="min-h-[44px]"
          disabled={reviewClaim.isPending || !approveAmount}
          onClick={() => {
            const amountCents = Math.round(parseFloat(approveAmount) * 100);
            reviewClaim.mutate(
              {
                claimId: claim.id,
                action: 'approve',
                approved_amount_cents: amountCents,
              },
              {
                onSuccess: () => {
                  setShowApprove(false);
                },
              },
            );
          }}
        >
          {reviewClaim.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          Confirm
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-[44px]"
          onClick={() => {
            setShowApprove(false);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (showDeny) {
    return (
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Reason"
          value={denyReason}
          onChange={(e) => {
            setDenyReason(e.target.value);
          }}
          className="min-h-[44px] w-32"
          aria-label="Denial reason"
        />
        <Button
          size="sm"
          variant="destructive"
          className="min-h-[44px]"
          disabled={reviewClaim.isPending || !denyReason}
          onClick={() => {
            reviewClaim.mutate(
              {
                claimId: claim.id,
                action: 'deny',
                denial_reason: denyReason,
              },
              {
                onSuccess: () => {
                  setShowDeny(false);
                },
              },
            );
          }}
        >
          {reviewClaim.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          Deny
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-[44px]"
          onClick={() => {
            setShowDeny(false);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        className="min-h-[44px]"
        onClick={() => {
          setShowApprove(true);
        }}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="destructive"
        className="min-h-[44px]"
        onClick={() => {
          setShowDeny(true);
        }}
      >
        Deny
      </Button>
    </div>
  );
}

export default function AdminInsuranceClaimsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useAdminInsuranceClaims({
    status: statusFilter,
    page,
    page_size: 20,
  });

  const columns: Column<InsuranceClaim>[] = [
    {
      key: 'claim_number',
      header: 'Claim #',
      render: (claim) => (
        <span className="text-sm font-medium font-mono">{claim.claim_number}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (claim) => (
        <span className="text-sm">
          {claim.claim_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      ),
    },
    {
      key: 'claimed',
      header: 'Claimed',
      render: (claim) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCents(claim.claimed_amount_cents)}
        </span>
      ),
    },
    {
      key: 'approved',
      header: 'Approved',
      render: (claim) => (
        <span className="text-sm tabular-nums">
          {claim.approved_amount_cents !== null
            ? formatCents(claim.approved_amount_cents)
            : '\u2014'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (claim) => {
        const status = claim.status as InsuranceClaimStatus;
        return (
          <Badge
            variant="outline"
            className={cn('text-xs', CLAIM_STATUS_CLASSES[status])}
          >
            {CLAIM_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Filed',
      render: (claim) => (
        <span className="text-sm text-zinc-300">{formatDate(claim.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (claim) => <ClaimActions claim={claim} />,
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="gold-text text-2xl font-bold tracking-tight">Insurance Claims</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load claims"
          description="Please try refreshing the page."
        />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Insurance Claims</h1>
          <p className="mt-1 text-zinc-300">
            Review and manage insurance claims filed by customers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="claim-status-filter" className="text-sm font-medium text-zinc-300">Status:</Label>
          <Select
            value={statusFilter ?? ALL_FILTER}
            onValueChange={(v) => {
              setStatusFilter(v === ALL_FILTER ? undefined : v);
              setPage(1);
            }}
          >
            <SelectTrigger id="claim-status-filter" className="w-[180px] min-h-[44px]" aria-label="Filter claims by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
              {Object.entries(INSURANCE_CLAIM_STATUS).map(([key, value]) => (
                <SelectItem key={key} value={value}>
                  {CLAIM_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={data?.claims ?? []}
          rowKey={(claim) => claim.id}
          pagination={data?.pagination}
          page={page}
          onPageChange={setPage}
          loading={isLoading}
          emptyMessage="No insurance claims found matching the current filters."
        />
      </div>
    </PageTransition>
  );
}
