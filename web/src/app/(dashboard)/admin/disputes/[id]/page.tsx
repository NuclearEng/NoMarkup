'use client';

import { useState } from 'react';

import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAdminDispute, useResolveDispute } from '@/hooks/useAdmin';
import { DISPUTE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';
import type { Dispute, DisputeResolutionType } from '@/types';
import { DISPUTE_RESOLUTION_TYPE, DISPUTE_STATUS } from '@/types';

const RESOLUTION_LABELS: Record<DisputeResolutionType, string> = {
  favor_customer: 'Favor Customer',
  favor_provider: 'Favor Provider',
  split: 'Split',
  dismissed: 'Dismissed',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// The contract service identifies the filer as `opened_by`; older responses
// aliased it as `initiated_by`. Read whichever is present, null-safe.
function disputeInitiator(dispute: Dispute): string {
  return dispute.opened_by ?? dispute.initiated_by ?? '';
}

// The contract service describes a dispute via `description` (with `dispute_type`
// as a fallback); `reason` is the legacy alias.
function disputeReason(dispute: Dispute): string {
  return dispute.reason ?? dispute.description ?? dispute.dispute_type ?? '';
}

export default function AdminDisputeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const disputeId = params.id as string;

  const { data, isLoading, isError } = useAdminDispute(disputeId);
  const resolveMutation = useResolveDispute();

  const [resolutionType, setResolutionType] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [refundCents, setRefundCents] = useState('');
  const [guaranteeClaim, setGuaranteeClaim] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const dispute = data?.dispute;
  const isResolved = dispute?.status === DISPUTE_STATUS.RESOLVED;

  async function handleResolve() {
    if (!dispute || !resolutionType) return;
    const parsedRefund = refundCents ? Math.round(parseFloat(refundCents) * 100) : undefined;
    await resolveMutation.mutateAsync({
      disputeId: dispute.id,
      resolution_type: resolutionType,
      resolution_notes: notes,
      refund_amount_cents: parsedRefund,
      guarantee_claim: guaranteeClaim,
    });
    setConfirmOpen(false);
    router.push('/admin/disputes' as Route);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton variant="text" className="h-4 w-72" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton variant="text" className="h-3 w-20" />
                  <Skeleton variant="text" className="h-4 w-32" />
                </div>
              ))}
            </div>
            <Skeleton variant="text" className="mt-4 h-3 w-16" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-36" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !dispute) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Admin', href: '/admin' },
            { label: 'Disputes', href: '/admin/disputes' },
            { label: 'Detail' },
          ]}
        />
        <h1 className="gold-text text-2xl font-bold tracking-tight">Dispute Detail</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load dispute details"
        />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Admin', href: '/admin' },
          { label: 'Disputes', href: '/admin/disputes' },
          { label: `${dispute.id.slice(0, 8)}...` },
        ]}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Dispute Detail</h1>
          <p className="text-zinc-300 mt-1 font-mono text-sm">{dispute.id}</p>
        </div>
        <Badge
          variant="outline"
          className={cn('w-fit text-sm', DISPUTE_STATUS_CLASSES[dispute.status])}
        >
          {dispute.status.charAt(0).toUpperCase() + dispute.status.slice(1)}
        </Badge>
      </div>

      {/* Dispute Info */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text text-base">Dispute Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-zinc-300">Contract ID</span>
              <p className="mt-1 font-mono text-xs">{dispute.contract_id}</p>
            </div>
            <div>
              <span className="text-zinc-300">Initiated By</span>
              <p className="mt-1">{dispute.initiator_name ?? disputeInitiator(dispute).slice(0, 12)}</p>
            </div>
            <div>
              <span className="text-zinc-300">Respondent</span>
              <p className="mt-1">{dispute.respondent_name ? dispute.respondent_name : 'N/A'}</p>
            </div>
            <div>
              <span className="text-zinc-300">Opened</span>
              <p className="mt-1">{formatDate(dispute.created_at)}</p>
            </div>
            {dispute.resolved_at ? (
              <div>
                <span className="text-zinc-300">Resolved</span>
                <p className="mt-1">{formatDate(dispute.resolved_at)}</p>
              </div>
            ) : null}
            {dispute.refund_amount_cents !== undefined && dispute.refund_amount_cents > 0 ? (
              <div>
                <span className="text-zinc-300">Refund Amount</span>
                <p className="mt-1 font-medium tabular-nums">
                  {formatCents(dispute.refund_amount_cents)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <span className="text-zinc-300 text-sm">Reason</span>
            <p className="mt-1 text-sm">{disputeReason(dispute)}</p>
          </div>

          {dispute.resolution_notes ? (
            <div className="mt-4">
              <span className="text-zinc-300 text-sm">Resolution Notes</span>
              <p className="mt-1 text-sm">{dispute.resolution_notes}</p>
            </div>
          ) : null}

          {dispute.resolution_type ? (
            <div className="mt-4">
              <span className="text-zinc-300 text-sm">Resolution</span>
              <p className="mt-1 text-sm font-medium">
                {RESOLUTION_LABELS[dispute.resolution_type]}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Resolution Form */}
      {!isResolved ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">Resolve Dispute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dispute-resolution-type">Resolution Type</Label>
              <Select value={resolutionType} onValueChange={setResolutionType}>
                <SelectTrigger id="dispute-resolution-type" className="min-h-[44px]">
                  <SelectValue placeholder="Select resolution type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DISPUTE_RESOLUTION_TYPE).map(([key, value]) => (
                    <SelectItem key={key} value={value}>
                      {RESOLUTION_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dispute-notes">Resolution Notes</Label>
              <Textarea
                id="dispute-notes"
                placeholder="Describe the resolution and rationale..."
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dispute-refund">Refund Amount (USD)</Label>
              <Input
                id="dispute-refund"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={refundCents}
                onChange={(e) => {
                  setRefundCents(e.target.value);
                }}
                className="min-h-[44px]"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="dispute-guarantee"
                type="checkbox"
                checked={guaranteeClaim}
                onChange={(e) => {
                  setGuaranteeClaim(e.target.checked);
                }}
                className="h-5 w-5 rounded border-white/20 bg-white/5 accent-[var(--brand-gold)]"
              />
              <Label htmlFor="dispute-guarantee" className="cursor-pointer">
                File guarantee claim
              </Label>
            </div>

            <Button
              className="min-h-[44px]"
              disabled={!resolutionType || resolveMutation.isPending}
              onClick={() => {
                setConfirmOpen(true);
              }}
            >
              {resolveMutation.isPending ? 'Resolving...' : 'Resolve Dispute'}
            </Button>

            {resolveMutation.isError ? (
              <p className="text-red-400 text-sm">
                Failed to resolve dispute. Please try again.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ActionConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (!resolveMutation.isPending) setConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleResolve();
        }}
        title="Resolve this dispute?"
        description={
          refundCents
            ? `This will apply resolution “${resolutionType}” with a refund of $${refundCents}. Money movement cannot be undone from this screen.`
            : `This will apply resolution “${resolutionType || '—'}”. Money and guarantee actions cannot be undone from this screen.`
        }
        confirmLabel="Resolve dispute"
        destructive
        loading={resolveMutation.isPending}
        confirmDisabled={!resolutionType}
      />
    </div>
    </PageTransition>
  );
}
