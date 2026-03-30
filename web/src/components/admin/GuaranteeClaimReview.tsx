'use client';

import { CheckCircle, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';
import Image from 'next/image';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useReviewGuaranteeClaim } from '@/hooks/useGuarantee';
import { cn, formatCents } from '@/lib/utils';
import type { Dispute, DisputeStatus } from '@/types';

const STATUS_CLASSES: Record<DisputeStatus, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  investigating: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  escalated: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  under_review: 'Under Review',
  resolved: 'Resolved',
  escalated: 'Escalated',
  closed: 'Closed',
};

const OUTCOME_LABELS: Record<string, string> = {
  refund: 'Refund Issued',
  replacement_provider: 'Replacement Provider Assigned',
  denied: 'Claim Denied',
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

interface GuaranteeClaimReviewProps {
  claim: Dispute;
  contractAmountCents?: number;
  onResolved?: () => void;
  className?: string;
}

export function GuaranteeClaimReview({
  claim,
  contractAmountCents,
  onResolved,
  className,
}: GuaranteeClaimReviewProps) {
  const reviewMutation = useReviewGuaranteeClaim();

  const [resolutionNotes, setResolutionNotes] = useState('');
  const [payoutDollars, setPayoutDollars] = useState('');
  const [formError, setFormError] = useState('');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isResolved = claim.status === 'resolved' || (claim.status as string) === 'closed';

  // Parse evidence URLs from the claim description or evidence_urls field.
  const evidenceUrls: string[] = [];
  if (
    'evidence_urls' in claim &&
    Array.isArray((claim as Record<string, unknown>)['evidence_urls'])
  ) {
    evidenceUrls.push(...((claim as Record<string, unknown>)['evidence_urls'] as string[]));
  }

  async function handleApprove() {
    if (!resolutionNotes.trim()) {
      setFormError('Resolution notes are required');
      return;
    }
    const payoutCents = payoutDollars ? Math.round(parseFloat(payoutDollars) * 100) : 0;
    if (payoutCents <= 0) {
      setFormError('Payout amount must be greater than $0.00 for approval');
      return;
    }
    setFormError('');

    await reviewMutation.mutateAsync({
      claimId: claim.id,
      approved: true,
      resolution_notes: resolutionNotes,
      payout_cents: payoutCents,
    });
    onResolved?.();
  }

  function openRejectDialog() {
    setRejectReason('');
    setRejectDialogOpen(true);
  }

  async function handleRejectConfirm() {
    if (!rejectReason.trim()) {
      return;
    }
    setFormError('');

    const combinedNotes = resolutionNotes.trim()
      ? `${resolutionNotes.trim()}\n\nRejection reason: ${rejectReason.trim()}`
      : rejectReason.trim();

    await reviewMutation.mutateAsync({
      claimId: claim.id,
      approved: false,
      resolution_notes: combinedNotes,
    });
    setRejectDialogOpen(false);
    onResolved?.();
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Claim Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-primary h-5 w-5" aria-hidden="true" />
          <h2 className="text-xl font-bold tracking-tight">Guarantee Claim</h2>
        </div>
        <Badge variant="outline" className={cn('w-fit text-sm', STATUS_CLASSES[claim.status])}>
          {STATUS_LABELS[claim.status] ?? claim.status}
        </Badge>
      </div>

      {/* Claim Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claim Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Claim ID</span>
              <p className="mt-1 font-mono text-xs">{claim.id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Contract</span>
              <p className="mt-1">
                <Link
                  href={`/admin/disputes/${claim.id}` as Route}
                  className="text-primary font-mono text-xs hover:underline"
                >
                  {claim.contract_id.slice(0, 12)}...
                </Link>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Customer</span>
              <p className="mt-1">{claim.initiator_name ?? claim.initiated_by.slice(0, 12)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Filed</span>
              <p className="mt-1">{formatDate(claim.created_at)}</p>
            </div>
            {contractAmountCents !== undefined ? (
              <div>
                <span className="text-muted-foreground">Contract Value</span>
                <p className="mt-1 font-medium tabular-nums">{formatCents(contractAmountCents)}</p>
              </div>
            ) : null}
            {claim.resolved_at ? (
              <div>
                <span className="text-muted-foreground">Resolved</span>
                <p className="mt-1">{formatDate(claim.resolved_at)}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <span className="text-muted-foreground text-sm">Claim Type</span>
            <p className="mt-1 text-sm font-medium">{claim.reason}</p>
          </div>

          <div className="mt-4">
            <span className="text-muted-foreground text-sm">Description</span>
            <p className="mt-1 text-sm whitespace-pre-wrap">{claim.reason}</p>
          </div>

          {claim.guarantee_outcome ? (
            <div className="mt-4">
              <span className="text-muted-foreground text-sm">Outcome</span>
              <p className="mt-1 text-sm font-medium">
                {OUTCOME_LABELS[claim.guarantee_outcome] ?? claim.guarantee_outcome}
              </p>
            </div>
          ) : null}

          {claim.resolution_notes ? (
            <div className="mt-4">
              <span className="text-muted-foreground text-sm">Resolution Notes</span>
              <p className="mt-1 text-sm">{claim.resolution_notes}</p>
            </div>
          ) : null}

          {claim.refund_amount_cents !== undefined && claim.refund_amount_cents > 0 ? (
            <div className="mt-4">
              <span className="text-muted-foreground text-sm">Payout Amount</span>
              <p className="mt-1 text-sm font-medium tabular-nums">
                {formatCents(claim.refund_amount_cents)}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Evidence Photos */}
      {evidenceUrls.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evidence Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {evidenceUrls.map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-md border transition-shadow hover:shadow-md"
                >
                  <Image
                    src={url}
                    alt={`Evidence photo ${String(index + 1)}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <ExternalLink
                      className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Chat History Link */}
      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <span className="text-muted-foreground text-sm">
            Review the chat history between customer and provider for additional context.
          </span>
          <Link href={`/admin/disputes/${claim.id}` as Route}>
            <Button variant="outline" size="sm" className="min-h-[44px]">
              View Full Dispute
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Review Actions */}
      {!isResolved ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="guarantee-notes">Resolution Notes</Label>
              <Textarea
                id="guarantee-notes"
                placeholder="Describe your findings and the rationale for your decision..."
                value={resolutionNotes}
                onChange={(e) => {
                  setResolutionNotes(e.target.value);
                }}
                rows={4}
                aria-describedby={formError ? 'review-error' : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="guarantee-payout">Payout Amount (USD, only if approving)</Label>
              <Input
                id="guarantee-payout"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={payoutDollars}
                onChange={(e) => {
                  setPayoutDollars(e.target.value);
                }}
                className="min-h-[44px]"
              />
              {contractAmountCents !== undefined ? (
                <p className="text-muted-foreground text-xs">
                  Contract value: {formatCents(contractAmountCents)}
                </p>
              ) : null}
            </div>

            {formError ? (
              <p id="review-error" className="text-destructive text-sm" role="alert">
                {formError}
              </p>
            ) : null}

            {reviewMutation.isError ? (
              <p className="text-destructive text-sm" role="alert">
                Failed to submit review. Please try again.
              </p>
            ) : null}

            <div className="flex gap-3">
              <Button
                className="min-h-[44px] flex-1 gap-2"
                disabled={reviewMutation.isPending}
                onClick={() => {
                  void handleApprove();
                }}
              >
                <CheckCircle className="h-4 w-4" aria-hidden="true" />
                {reviewMutation.isPending ? 'Processing...' : 'Approve Claim'}
              </Button>
              <Button
                variant="destructive"
                className="min-h-[44px] flex-1 gap-2"
                disabled={reviewMutation.isPending}
                onClick={openRejectDialog}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Reject Claim
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Reject Reason Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Guarantee Claim</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this claim. The customer will be notified with your
              explanation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Rejection Reason</Label>
              <Textarea
                id="reject-reason"
                placeholder="Explain why this claim is being rejected..."
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                }}
                rows={4}
                autoFocus
              />
            </div>
            {reviewMutation.isError ? (
              <p className="text-destructive text-sm" role="alert">
                Failed to reject claim. Please try again.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                setRejectDialogOpen(false);
              }}
              disabled={reviewMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="min-h-[44px] gap-2"
              disabled={!rejectReason.trim() || reviewMutation.isPending}
              onClick={() => {
                void handleRejectConfirm();
              }}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              {reviewMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
