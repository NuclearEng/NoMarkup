'use client';

import { ArrowLeft, Loader2, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { CompletionFlow } from '@/components/contracts/CompletionFlow';
import { ContractAcceptance } from '@/components/contracts/ContractAcceptance';
import { getPaymentTimingLabel, getStatusLabel, getStatusVariant } from '@/components/contracts/ContractCard';
import { MilestoneTracker } from '@/components/contracts/MilestoneTracker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useApproveCompletion,
  useCancelContract,
  useContract,
  useMarkComplete,
  useStartWork,
} from '@/hooks/useContracts';
import { useReviewEligibility } from '@/hooks/useReviews';
import { formatCents } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { CHANGE_ORDER_STATUS, CONTRACT_STATUS, MILESTONE_STATUS } from '@/types';

function ChangeOrderStatusBadge({ status }: { status: string }) {
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
  switch (status) {
    case CHANGE_ORDER_STATUS.ACCEPTED:
      variant = 'default';
      break;
    case CHANGE_ORDER_STATUS.PROPOSED:
      variant = 'secondary';
      break;
    case CHANGE_ORDER_STATUS.REJECTED:
    case CHANGE_ORDER_STATUS.EXPIRED:
      variant = 'destructive';
      break;
  }
  return (
    <Badge variant={variant}>
      {status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
    </Badge>
  );
}

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>();
  const contractId = params.id;
  const { data, isLoading, isError } = useContract(contractId);
  const user = useAuthStore((state) => state.user);

  const startWork = useStartWork();
  const markComplete = useMarkComplete();
  const approveCompletion = useApproveCompletion();
  const cancelContract = useCancelContract();

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link
          href={'/contracts' as Route}
          className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Contracts
        </Link>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load contract details. Please try again.
        </div>
      </div>
    );
  }

  const { contract, change_orders } = data;
  const isCustomer = user?.id === contract.customer_id;
  const isProvider = user?.id === contract.provider_id;

  function handleStartWork() {
    startWork.mutate(contract.id);
  }

  function handleMarkComplete() {
    markComplete.mutate(contract.id);
  }

  function handleApproveCompletion() {
    approveCompletion.mutate(contract.id);
  }

  function handleCancel() {
    cancelContract.mutate(contract.id, {
      onSuccess: () => {
        setShowCancelConfirm(false);
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={'/contracts' as Route}
        className="flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Contracts
      </Link>

      {/* Contract header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{contract.contract_number}</h1>
            <Badge variant={getStatusVariant(contract.status)}>
              {getStatusLabel(contract.status)}
            </Badge>
          </div>
          <p className="mt-1 text-3xl font-bold">{formatCents(contract.amount_cents)}</p>
        </div>
      </div>

      {/* Contract info cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Party info */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-muted-foreground">Parties</h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Customer</span>
              <span className="text-sm font-medium">
                {contract.customer_id.slice(0, 8)}...
                {isCustomer ? ' (You)' : ''}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Provider</span>
              <span className="text-sm font-medium">
                {contract.provider_id.slice(0, 8)}...
                {isProvider ? ' (You)' : ''}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Contract details */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-muted-foreground">Details</h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Payment Timing</span>
              <span className="text-sm font-medium">
                {getPaymentTimingLabel(contract.payment_timing)}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Job</span>
              <Link
                href={`/jobs/${contract.job_id}` as Route}
                className="text-sm font-medium text-primary hover:underline"
              >
                {contract.job_id.slice(0, 8)}...
              </Link>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm font-medium">
                {new Date(contract.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
            {contract.accepted_at ? (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Accepted</span>
                  <span className="text-sm font-medium">
                    {new Date(contract.accepted_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </>
            ) : null}
            {contract.started_at ? (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Started</span>
                  <span className="text-sm font-medium">
                    {new Date(contract.started_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </>
            ) : null}
            {contract.completed_at ? (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Completed</span>
                  <span className="text-sm font-medium">
                    {new Date(contract.completed_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Contract Acceptance (for pending_acceptance status) */}
      {contract.status === CONTRACT_STATUS.PENDING_ACCEPTANCE ? (
        <ContractAcceptance contract={contract} />
      ) : null}

      {/* Milestone Tracker (for active status) */}
      {contract.status === CONTRACT_STATUS.ACTIVE ? (
        <MilestoneTracker
          milestones={contract.milestones}
          contractId={contract.id}
          customerId={contract.customer_id}
          providerId={contract.provider_id}
        />
      ) : null}

      {/* Completion Flow */}
      {contract.status === CONTRACT_STATUS.ACTIVE && (
        contract.milestones.length > 0 &&
        contract.milestones.every((m) => m.status === MILESTONE_STATUS.APPROVED) ||
        !!contract.completed_at
      ) ? (
        <CompletionFlow contract={contract} />
      ) : null}

      {/* Action buttons based on status and role */}
      {contract.status === CONTRACT_STATUS.ACTIVE && (isCustomer || isProvider) ? (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-muted-foreground">Actions</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Provider: Start Work */}
            {isProvider && !contract.started_at ? (
              <Button
                className="min-h-[44px] w-full"
                onClick={handleStartWork}
                disabled={startWork.isPending}
              >
                {startWork.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Start Work
              </Button>
            ) : null}

            {/* Provider: Mark Complete */}
            {isProvider && contract.started_at ? (
              <Button
                className="min-h-[44px] w-full"
                onClick={handleMarkComplete}
                disabled={markComplete.isPending}
              >
                {markComplete.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Mark as Complete
              </Button>
            ) : null}

            {/* Customer: Approve Completion */}
            {isCustomer ? (
              <Button
                variant="outline"
                className="min-h-[44px] w-full"
                onClick={handleApproveCompletion}
                disabled={approveCompletion.isPending}
              >
                {approveCompletion.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Approve Completion
              </Button>
            ) : null}

            {/* Cancel contract */}
            {showCancelConfirm ? (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm">
                  Are you sure you want to cancel this contract? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    className="min-h-[44px] flex-1"
                    onClick={handleCancel}
                    disabled={cancelContract.isPending}
                  >
                    {cancelContract.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Confirm Cancel
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => { setShowCancelConfirm(false); }}
                    disabled={cancelContract.isPending}
                  >
                    Keep Contract
                  </Button>
                </div>
                {cancelContract.isError ? (
                  <p className="text-sm text-destructive">
                    Failed to cancel contract. Please try again.
                  </p>
                ) : null}
              </div>
            ) : (
              <Button
                variant="outline"
                className="min-h-[44px] w-full text-destructive hover:bg-destructive/10"
                onClick={() => { setShowCancelConfirm(true); }}
              >
                Cancel Contract
              </Button>
            )}

            {/* Error messages for other mutations */}
            {startWork.isError ? (
              <p className="text-sm text-destructive">Failed to start work. Please try again.</p>
            ) : null}
            {markComplete.isError ? (
              <p className="text-sm text-destructive">Failed to mark complete. Please try again.</p>
            ) : null}
            {approveCompletion.isError ? (
              <p className="text-sm text-destructive">Failed to approve completion. Please try again.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Change Orders */}
      {change_orders.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Change Orders</h3>
          <div className="space-y-3">
            {change_orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{order.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Proposed by: {order.proposed_by.slice(0, 8)}...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <ChangeOrderStatusBadge status={order.status} />
                      <span className="text-sm font-bold">
                        {order.amount_delta_cents >= 0 ? '+' : ''}
                        {formatCents(order.amount_delta_cents)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* Reviews section (for completed contracts) */}
      {contract.status === CONTRACT_STATUS.COMPLETED && (isCustomer || isProvider) ? (
        <ReviewSection contractId={contract.id} />
      ) : null}
    </div>
  );
}

function ReviewSection({ contractId }: { contractId: string }) {
  const { data: eligibility, isLoading } = useReviewEligibility(contractId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </CardContent>
      </Card>
    );
  }

  if (!eligibility) return null;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Reviews</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibility.eligible && !eligibility.already_reviewed ? (
          <Link
            href={`/contracts/${contractId}/review` as Route}
            className="block"
          >
            <Button className="min-h-[44px] w-full gap-2">
              <Star className="h-4 w-4" aria-hidden="true" />
              Leave a Review
            </Button>
          </Link>
        ) : eligibility.already_reviewed ? (
          <div className="flex items-center gap-2 rounded-lg border bg-green-50 p-3 text-sm text-green-700">
            <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
            You have already reviewed this contract.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
            <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
            The review window for this contract has closed.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
