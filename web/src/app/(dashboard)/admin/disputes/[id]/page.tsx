'use client';

import { useState } from 'react';

import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAdminDispute, useResolveDispute } from '@/hooks/useAdmin';
import { cn, formatCents } from '@/lib/utils';
import type { DisputeResolutionType, DisputeStatus } from '@/types';
import { DISPUTE_RESOLUTION_TYPE, DISPUTE_STATUS } from '@/types';

const DISPUTE_STATUS_CLASSES: Record<DisputeStatus, string> = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  investigating: 'bg-purple-100 text-purple-800 border-purple-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
  escalated: 'bg-red-100 text-red-800 border-red-200',
};

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
    router.push('/admin/disputes' as Route);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !dispute) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dispute Detail</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load dispute details.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dispute Detail</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {dispute.id}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn('w-fit text-sm', DISPUTE_STATUS_CLASSES[dispute.status])}
        >
          {dispute.status.charAt(0).toUpperCase() + dispute.status.slice(1)}
        </Badge>
      </div>

      {/* Dispute Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispute Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Contract ID</span>
              <p className="mt-1 font-mono text-xs">{dispute.contract_id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Initiated By</span>
              <p className="mt-1">
                {dispute.initiator_name ?? dispute.initiated_by.slice(0, 12)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Respondent</span>
              <p className="mt-1">
                {dispute.respondent_name ? dispute.respondent_name : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Opened</span>
              <p className="mt-1">{formatDate(dispute.created_at)}</p>
            </div>
            {dispute.resolved_at ? (
              <div>
                <span className="text-muted-foreground">Resolved</span>
                <p className="mt-1">{formatDate(dispute.resolved_at)}</p>
              </div>
            ) : null}
            {dispute.refund_amount_cents !== undefined && dispute.refund_amount_cents > 0 ? (
              <div>
                <span className="text-muted-foreground">Refund Amount</span>
                <p className="mt-1 font-medium tabular-nums">
                  {formatCents(dispute.refund_amount_cents)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <span className="text-sm text-muted-foreground">Reason</span>
            <p className="mt-1 text-sm">{dispute.reason}</p>
          </div>

          {dispute.resolution_notes ? (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Resolution Notes</span>
              <p className="mt-1 text-sm">{dispute.resolution_notes}</p>
            </div>
          ) : null}

          {dispute.resolution_type ? (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Resolution</span>
              <p className="mt-1 text-sm font-medium">
                {RESOLUTION_LABELS[dispute.resolution_type]}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Resolution Form */}
      {!isResolved ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolve Dispute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dispute-resolution-type">Resolution Type</Label>
              <Select
                value={resolutionType}
                onValueChange={setResolutionType}
              >
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
                onChange={(e) => { setNotes(e.target.value); }}
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
                onChange={(e) => { setRefundCents(e.target.value); }}
                className="min-h-[44px]"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="dispute-guarantee"
                type="checkbox"
                checked={guaranteeClaim}
                onChange={(e) => { setGuaranteeClaim(e.target.checked); }}
                className="h-5 w-5 rounded border-gray-300"
              />
              <Label htmlFor="dispute-guarantee" className="cursor-pointer">
                File guarantee claim
              </Label>
            </div>

            <Button
              className="min-h-[44px]"
              disabled={!resolutionType || resolveMutation.isPending}
              onClick={() => { void handleResolve(); }}
            >
              {resolveMutation.isPending ? 'Resolving...' : 'Resolve Dispute'}
            </Button>

            {resolveMutation.isError ? (
              <p className="text-sm text-destructive">
                Failed to resolve dispute. Please try again.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
