'use client';

import { useState } from 'react';

import { toast } from 'sonner';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AdminGoodsDispute,
  useAdminGoodsDisputes,
  useResolveGoodsDispute,
} from '@/hooks/useAdmin';
import { getApiErrorMessage } from '@/lib/api';
import { DISPUTE_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn, formatCents } from '@/lib/utils';

const ALL_FILTER = '__all__';

// The four server-accepted resolutions. `refund_partial` is the only one that
// reads the refund-amount field; the others ignore it (see the gateway handler
// ResolveGoodsDispute body contract).
const RESOLUTION = {
  REFUND_FULL: 'refund_full',
  REFUND_PARTIAL: 'refund_partial',
  RELEASE_TO_SELLER: 'release_to_seller',
  NO_ACTION: 'no_action',
} as const;
type Resolution = (typeof RESOLUTION)[keyof typeof RESOLUTION];

const RESOLUTION_LABELS: Record<Resolution, string> = {
  refund_full: 'Refund buyer in full',
  refund_partial: 'Partial refund',
  release_to_seller: 'Release funds to seller',
  no_action: 'No action',
};

// Goods disputes use the same lifecycle vocabulary as service disputes, so we
// reuse the shared badge classes and fall back to a neutral tint for any
// status not pre-mapped.
const GOODS_DISPUTE_STATUS_FILTERS = ['open', 'investigating', 'resolved', 'closed'] as const;

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// A terminal dispute can't be re-resolved (the gateway guards with a 409), so
// we hide the resolve form once it's resolved/closed.
function isTerminal(status: string): boolean {
  return status === 'resolved' || status === 'closed';
}

interface ResolveFormProps {
  dispute: AdminGoodsDispute;
}

function ResolveForm({ dispute }: ResolveFormProps) {
  const resolve = useResolveGoodsDispute();
  const [resolution, setResolution] = useState<Resolution>(RESOLUTION.REFUND_FULL);
  // Dollar string for the partial-refund amount; converted to cents on submit.
  const [refundDollars, setRefundDollars] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isPartial = resolution === RESOLUTION.REFUND_PARTIAL;

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    let refundCents = 0;
    if (isPartial) {
      const parsed = Number.parseFloat(refundDollars);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Enter a refund amount greater than $0 for a partial refund.');
        return;
      }
      refundCents = Math.round(parsed * 100);
      if (refundCents > dispute.amount_cents) {
        setError('Refund cannot exceed the order amount.');
        return;
      }
    }

    const label = RESOLUTION_LABELS[resolution];
    if (
      !window.confirm(
        `Resolve this goods dispute with “${label}”? This can move money and cannot be undone from this screen.`,
      )
    ) {
      return;
    }

    resolve.mutate(
      {
        disputeId: dispute.id,
        resolution,
        refund_to_buyer_cents: refundCents,
        // Releasing to the seller transfers the full order amount; the gateway
        // also derives this, but sending it keeps the intent explicit.
        transfer_to_seller_cents:
          resolution === RESOLUTION.RELEASE_TO_SELLER ? dispute.amount_cents : 0,
        notes: notes.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Dispute resolved');
          setNotes('');
          setRefundDollars('');
        },
        onError: (err) => {
          // 409 → "dispute already resolved": surface the server's reason so the
          // admin understands another action already settled this dispute.
          toast.error(getApiErrorMessage(err, 'Could not resolve dispute'));
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 border-t border-white/10 pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`resolution-${dispute.id}`}>Resolution</Label>
          <Select
            value={resolution}
            onValueChange={(v) => {
              setResolution(v as Resolution);
              setError(null);
            }}
          >
            <SelectTrigger
              id={`resolution-${dispute.id}`}
              className="min-h-[44px]"
              aria-label="Select a resolution"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(RESOLUTION).map((value) => (
                <SelectItem key={value} value={value}>
                  {RESOLUTION_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isPartial ? (
          <div className="space-y-1.5">
            <Label htmlFor={`refund-${dispute.id}`}>Refund to buyer ($)</Label>
            <Input
              id={`refund-${dispute.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="min-h-[44px]"
              value={refundDollars}
              onChange={(e) => {
                setRefundDollars(e.target.value);
                setError(null);
              }}
              placeholder="0.00"
              aria-describedby={error ? `resolve-error-${dispute.id}` : undefined}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`notes-${dispute.id}`}>Resolution notes</Label>
        <Input
          id={`notes-${dispute.id}`}
          type="text"
          className="min-h-[44px]"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); }}
          placeholder="Reason / internal note"
        />
      </div>

      {error ? (
        <p
          id={`resolve-error-${dispute.id}`}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" size="sm" className="min-h-[44px]" disabled={resolve.isPending}>
        {resolve.isPending ? 'Resolving...' : 'Resolve dispute'}
      </Button>
    </form>
  );
}

interface DisputeCardProps {
  dispute: AdminGoodsDispute;
}

function DisputeCard({ dispute }: DisputeCardProps) {
  return (
    <article className="glass-elevated rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-zinc-100">
            {dispute.listing_title || 'Untitled listing'}
          </h3>
          <p className="mt-0.5 text-sm text-zinc-300">
            Buyer:{' '}
            <span className="text-zinc-100">
              {dispute.opened_by_email || dispute.opened_by.slice(0, 8)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Opened {formatDate(dispute.created_at)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-xs',
            DISPUTE_STATUS_CLASSES[dispute.status] ??
              'bg-muted text-muted-foreground border-border',
          )}
        >
          {statusLabel(dispute.status)}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-400">Type</dt>
          <dd className="text-zinc-200">{statusLabel(dispute.dispute_type)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">Order amount</dt>
          <dd className="tabular-nums text-zinc-200">{formatCents(dispute.amount_cents)}</dd>
        </div>
        {dispute.refund_to_buyer_cents != null && dispute.refund_to_buyer_cents > 0 ? (
          <div>
            <dt className="text-xs text-zinc-400">Refunded</dt>
            <dd className="tabular-nums text-zinc-200">
              {formatCents(dispute.refund_to_buyer_cents)}
            </dd>
          </div>
        ) : null}
      </dl>

      {dispute.description ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">
          {dispute.description}
        </p>
      ) : null}

      {isTerminal(dispute.status) ? (
        <p className="mt-3 border-t border-white/10 pt-3 text-sm text-zinc-400">
          This dispute has already been resolved
          {dispute.resolved_at ? ` on ${formatDate(dispute.resolved_at)}` : ''}.
        </p>
      ) : (
        <ResolveForm dispute={dispute} />
      )}
    </article>
  );
}

export function GoodsDisputesPanel() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data, isLoading, isError, refetch } = useAdminGoodsDisputes({
    status: statusFilter,
    page: 1,
    page_size: 50,
  });

  const disputes = data?.disputes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-300">Status:</span>
        <Select
          value={statusFilter ?? ALL_FILTER}
          onValueChange={(v) => { setStatusFilter(v === ALL_FILTER ? undefined : v); }}
        >
          <SelectTrigger
            className="w-full min-h-[44px] sm:w-[180px]"
            aria-label="Filter goods disputes by status"
          >
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>All Statuses</SelectItem>
            {GOODS_DISPUTE_STATUS_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {statusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load goods disputes"
          description="Something went wrong while loading disputes. Check your connection and try again."
          action={
            <Button
              variant="default"
              className="min-h-[44px]"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading goods disputes">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : disputes.length === 0 ? (
        <EmptyState
          title="No goods disputes"
          description="Buyer-filed marketplace disputes will appear here for resolution."
        />
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => (
            <DisputeCard key={dispute.id} dispute={dispute} />
          ))}
        </div>
      )}
    </div>
  );
}
