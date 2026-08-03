'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  Heart,
  Loader2,
  Play,
  Shield,
  ShieldCheck,
  Star,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { CompletionFlow } from '@/components/contracts/CompletionFlow';
import { ContractAcceptance } from '@/components/contracts/ContractAcceptance';
import { GuaranteeCoverage } from '@/components/contracts/GuaranteeCoverage';
import { RecurringSchedule } from '@/components/contracts/RecurringSchedule';
import { InsuranceSelector } from '@/components/insurance/InsuranceSelector';
import { InstallmentPlanSelector } from '@/components/payments/InstallmentPlanSelector';
import { InstallmentSchedule } from '@/components/payments/InstallmentSchedule';
import {
  getPaymentTimingLabel,
  getStatusLabel,
  getStatusVariant,
  TipWidget,
} from '@/components/contracts/ContractCard';
import { MilestoneTracker } from '@/components/contracts/MilestoneTracker';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PageTransition } from '@/components/ui/page-transition';
import { ShareSavingsCard } from '@/components/ui/ShareSavingsCard';
import {
  useAcceptanceExpired,
  useApproveCompletion,
  useCancelContract,
  useContract,
  useMarkComplete,
  useProposeChangeOrder,
  useRespondToChangeOrder,
  useStartWork,
} from '@/hooks/useContracts';
import { useSavings } from '@/hooks/useBids';
import { useContractInstallmentPlan, useInstallmentSchedule } from '@/hooks/useInstallments';
import { useReviewEligibility } from '@/hooks/useReviews';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { api } from '@/lib/api';
import { printAuthenticatedDocument } from '@/lib/print';
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
  const proposeChangeOrder = useProposeChangeOrder();
  const respondToChangeOrder = useRespondToChangeOrder();
  const { installments } = useInstallmentSchedule(contractId);
  const { hasPlan: hasInstallmentPlan } = useContractInstallmentPlan(contractId);
  const { data: allSavings } = useSavings();
  const competitiveInsuranceEnabled = useFeatureFlag('insurance_competition');
  const bnplEnabled = useFeatureFlag('customer_bnpl');

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showChangeOrderForm, setShowChangeOrderForm] = useState(false);
  const [changeOrderDescription, setChangeOrderDescription] = useState('');
  const [changeOrderAmount, setChangeOrderAmount] = useState('');
  const [docAction, setDocAction] = useState<'document' | 'invoice' | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  // Called unconditionally (hooks rule) — safe before data loads: returns false
  // for a missing/non-pending contract. True only when the acceptance window
  // has closed, which flips the header badge to a muted "Expired".
  const acceptanceExpired = useAcceptanceExpired(
    data?.contract.status ?? '',
    data?.contract.acceptance_deadline,
  );

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading contract">
        <Skeleton className="h-4 w-32" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link
          href={'/contracts' as Route}
          className="text-zinc-300 hover:text-foreground flex min-h-[44px] items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Contracts
        </Link>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load contract"
          description="Something went wrong loading contract details. Please try again."
          className="glass border-destructive/30"
        />
      </div>
    );
  }

  const { contract, change_orders } = data;
  const isCustomer = user?.id === contract.customer_id;
  const isProvider = user?.id === contract.provider_id;

  // Find savings for this contract's job (for the share card)
  const jobSavings = allSavings?.find((s) => s.job_id === contract.job_id);
  const contractSavingsCents = jobSavings?.savings_cents ?? 0;

  async function handleDownloadDocument() {
    setDocError(null);
    setDocAction('document');
    try {
      await printAuthenticatedDocument(`/api/v1/contracts/${contract.id}/document.pdf`);
    } catch {
      setDocError('Failed to open contract document. Please try again.');
    } finally {
      setDocAction(null);
    }
  }

  async function handleDownloadInvoice() {
    setDocError(null);
    setDocAction('invoice');
    try {
      // Ensure an invoice row exists (idempotent create), then print HTML body.
      try {
        await api.post<{ invoice_url: string }>(`/api/v1/contracts/${contract.id}/invoice`);
      } catch {
        // Already generated or not yet payable — still try download.
      }
      await printAuthenticatedDocument(`/api/v1/contracts/${contract.id}/invoice/download`);
    } catch {
      setDocError('Failed to open invoice. It may require a completed payment first.');
    } finally {
      setDocAction(null);
    }
  }

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

  function handleProposeChangeOrder() {
    // Parse the dollar amount to integer cents. The server re-validates the
    // delta (non-zero, within bounds, keeps the contract amount positive), so
    // a bad value is rejected server-side regardless of this client check.
    const dollars = Number.parseFloat(changeOrderAmount);
    if (!Number.isFinite(dollars) || dollars === 0) {
      return;
    }
    const amountDeltaCents = Math.round(dollars * 100);
    proposeChangeOrder.mutate(
      {
        contractId: contract.id,
        description: changeOrderDescription.trim(),
        amount_delta_cents: amountDeltaCents,
      },
      {
        onSuccess: () => {
          setShowChangeOrderForm(false);
          setChangeOrderDescription('');
          setChangeOrderAmount('');
        },
      },
    );
  }

  function handleRespondToChangeOrder(changeOrderId: string, accepted: boolean) {
    respondToChangeOrder.mutate({ contractId: contract.id, changeOrderId, accepted });
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={'/contracts' as Route}
        className="text-zinc-300 hover:text-foreground flex min-h-[44px] items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Contracts
      </Link>

      {/* Contract header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="gold-text text-2xl font-bold tracking-tight">{contract.contract_number}</h1>
            {acceptanceExpired ? (
              <Badge
                variant="secondary"
                className="border-zinc-500/30 bg-zinc-500/15 text-zinc-400"
              >
                Expired
              </Badge>
            ) : (
              <Badge variant={getStatusVariant(contract.status)}>
                {getStatusLabel(contract.status)}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-3xl font-bold">{formatCents(contract.amount_cents)}</p>
        </div>
      </div>

      {/* Contract info cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Party info */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <h3 className="gold-text text-sm font-medium">Parties</h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 text-sm">Customer</span>
              <span className="text-sm font-medium">
                {contract.customer_name ?? `${contract.customer_id.slice(0, 8)}...`}
                {isCustomer ? ' (You)' : ''}
              </span>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 text-sm">Provider</span>
              <span className="text-sm font-medium">
                {contract.provider_name ?? `${contract.provider_id.slice(0, 8)}...`}
                {isProvider ? ' (You)' : ''}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Contract details */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <h3 className="gold-text text-sm font-medium">Details</h3>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 text-sm">Payment Timing</span>
              <span className="text-sm font-medium">
                {getPaymentTimingLabel(contract.payment_timing)}
              </span>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 text-sm">Job</span>
              <Link
                href={`/jobs/${contract.job_id}` as Route}
                className="text-primary text-sm font-medium hover:underline"
              >
                {contract.job_title || `${contract.job_id.slice(0, 8)}...`}
              </Link>
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 text-sm">Created</span>
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
                <div className="glass-divider" role="separator" />
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300 text-sm">Accepted</span>
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
                <div className="glass-divider" role="separator" />
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300 text-sm">Started</span>
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
                <div className="glass-divider" role="separator" />
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300 text-sm">Completed</span>
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

      {/* FR-5.4: agreed local terms from chat Accept (or award residual bind). */}
      {contract.local_terms && Object.keys(contract.local_terms).length > 0 ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="gold-text text-sm font-medium">Agreed local terms</h3>
              {contract.local_terms.bound_at === 'award' ? (
                <Badge variant="outline" className="border-[var(--brand-gold)]/40 text-[var(--brand-gold)]">
                  Applied at award
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-zinc-400">
              {contract.local_terms.bound_at === 'award'
                ? 'Payment terms accepted in chat and applied when the contract was created (award residual bind).'
                : 'Payment terms accepted in chat.'}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {contract.local_terms.payment_timing || contract.local_terms.payment_type ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-300 text-sm">Payment type</span>
                <span className="text-sm font-medium text-right">
                  {getPaymentTimingLabel(
                    contract.local_terms.payment_timing ??
                      contract.local_terms.payment_type ??
                      '',
                  )}
                </span>
              </div>
            ) : null}
            {contract.local_terms.amount ? (
              <>
                <div className="glass-divider" role="separator" />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-300 text-sm">Amount notes</span>
                  <span className="text-sm font-medium text-right tabular-nums">
                    {contract.local_terms.amount}
                  </span>
                </div>
              </>
            ) : null}
            {contract.local_terms.milestones ? (
              <>
                <div className="glass-divider" role="separator" />
                <div className="flex items-start justify-between gap-4">
                  <span className="text-zinc-300 text-sm shrink-0">Milestones</span>
                  <span className="text-sm font-medium text-right whitespace-pre-wrap">
                    {contract.local_terms.milestones}
                  </span>
                </div>
              </>
            ) : null}
            {contract.local_terms.description ? (
              <>
                <div className="glass-divider" role="separator" />
                <div className="flex items-start justify-between gap-4">
                  <span className="text-zinc-300 text-sm shrink-0">Notes</span>
                  <span className="text-sm font-medium text-right whitespace-pre-wrap">
                    {contract.local_terms.description}
                  </span>
                </div>
              </>
            ) : null}
            {contract.local_terms.accepted_at ? (
              <>
                <div className="glass-divider" role="separator" />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-300 text-sm">Accepted at</span>
                  <span className="text-sm font-medium">
                    {new Date(contract.local_terms.accepted_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </>
            ) : null}
            {/* Residual honesty: empty display fields still leave a note when only metadata bound. */}
            {!contract.local_terms.payment_timing &&
            !contract.local_terms.payment_type &&
            !contract.local_terms.amount &&
            !contract.local_terms.milestones &&
            !contract.local_terms.description &&
            !contract.local_terms.accepted_at ? (
              <p className="text-sm text-zinc-400">
                Local terms were bound for this contract, but no payment-type or notes fields were
                stored on the snapshot.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
      {contract.status === CONTRACT_STATUS.ACTIVE &&
      ((contract.milestones.length > 0 &&
        contract.milestones.every((m) => m.status === MILESTONE_STATUS.APPROVED)) ||
        !!contract.completed_at) ? (
        <CompletionFlow contract={contract} />
      ) : null}

      {/* Guarantee Coverage */}
      <GuaranteeCoverage contract={contract} />

      {/* FR-18 recurring schedule + visit approve/complete + FR-16.7 retry UX.
          Self-hides when the contract has no recurring config. Pay visit is
          customer-only; amounts come from server instance rows. */}
      {(isCustomer || isProvider) ? (
        <RecurringSchedule
          contractId={contract.id}
          customerId={contract.customer_id}
          providerId={contract.provider_id}
          isCustomer={isCustomer}
          isProvider={isProvider}
          embeddedConfig={contract.recurring}
          jobTitle={contract.job_title}
          jobId={contract.job_id}
          amountCents={contract.amount_cents}
        />
      ) : null}

      {/* BNPL: let the customer split this contract's payment into installments.
          Shown only on an ACTIVE contract, to the customer, when the customer_bnpl
          flag is on AND no plan exists yet (the gateway also enforces the flag).
          Once a plan is created the schedule below replaces this selector. */}
      {contract.status === CONTRACT_STATUS.ACTIVE &&
      isCustomer &&
      bnplEnabled &&
      !hasInstallmentPlan &&
      installments.length === 0 ? (
        <InstallmentPlanSelector
          totalCents={contract.amount_cents}
          contractId={contract.id}
          providerId={contract.provider_id}
        />
      ) : null}

      {/* Installment Schedule */}
      {installments.length > 0 ? <InstallmentSchedule installments={installments} /> : null}

      {/* Per-job insurance: let the customer buy optional coverage for this
          contract. Shown to the customer on an ACTIVE (payable) contract; the
          selector self-gates on the per_job_insurance flag (and resolves the
          customer's default payment method internally), and the gateway derives
          the premium/provider server-side after an ownership check. */}
      {contract.status === CONTRACT_STATUS.ACTIVE && isCustomer ? (
        <InsuranceSelector contractId={contract.id} />
      ) : null}

      {/* Action buttons based on status and role */}
      {contract.status === CONTRACT_STATUS.ACTIVE && (isCustomer || isProvider) ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <h3 className="gold-text text-sm font-medium">Actions</h3>
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
                    onClick={() => {
                      setShowCancelConfirm(false);
                    }}
                    disabled={cancelContract.isPending}
                  >
                    Keep Contract
                  </Button>
                </div>
                {cancelContract.isError ? (
                  <p className="text-destructive text-sm">
                    Failed to cancel contract. Please try again.
                  </p>
                ) : null}
              </div>
            ) : (
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 min-h-[44px] w-full"
                onClick={() => {
                  setShowCancelConfirm(true);
                }}
              >
                Cancel Contract
              </Button>
            )}

            {/* Customer: File Guarantee Claim */}
            {isCustomer ? (
              <Link href={`/contracts/${contract.id}/guarantee-claim` as Route}>
                <Button variant="outline" className="min-h-[44px] w-full gap-2">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  File Guarantee Claim
                </Button>
              </Link>
            ) : null}

            {/* Customer: Compare competing insurance quotes for this contract.
                Gated by the insurance_competition flag (UX layer; the gateway
                also enforces it). Additive — does not affect the fixed-product
                InsuranceSelector used at checkout. */}
            {isCustomer && competitiveInsuranceEnabled ? (
              <Link
                href={
                  `/insurance/quotes?contractId=${contract.id}&coverageCents=${String(
                    contract.amount_cents,
                  )}` as Route
                }
              >
                <Button variant="outline" className="min-h-[44px] w-full gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Compare Insurance Quotes
                </Button>
              </Link>
            ) : null}

            {/* File a Dispute */}
            <Link href={`/disputes/new?contractId=${contract.id}` as Route}>
              <Button variant="outline" className="min-h-[44px] w-full gap-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border-orange-500/30">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                File a Dispute
              </Button>
            </Link>

            {/* Error messages for other mutations */}
            {startWork.isError ? (
              <p className="text-destructive text-sm">Failed to start work. Please try again.</p>
            ) : null}
            {markComplete.isError ? (
              <p className="text-destructive text-sm">Failed to mark complete. Please try again.</p>
            ) : null}
            {approveCompletion.isError ? (
              <p className="text-destructive text-sm">
                Failed to approve completion. Please try again.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Change Orders */}
      {change_orders.length > 0 || (isProvider && contract.status === CONTRACT_STATUS.ACTIVE) ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="gold-text text-lg font-semibold">Change Orders</h3>
            {isProvider && contract.status === CONTRACT_STATUS.ACTIVE ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => {
                  setShowChangeOrderForm((v) => !v);
                }}
              >
                {showChangeOrderForm ? 'Cancel' : 'Propose Change Order'}
              </Button>
            ) : null}
          </div>

          {/* Provider: propose a new change order */}
          {isProvider && contract.status === CONTRACT_STATUS.ACTIVE && showChangeOrderForm ? (
            <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={changeOrderDescription}
                    onChange={(e) => {
                      setChangeOrderDescription(e.target.value);
                    }}
                    placeholder="Describe the scope change and why the price needs to adjust."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="co-amount">Amount change (USD)</Label>
                  <Input
                    id="co-amount"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={changeOrderAmount}
                    onChange={(e) => {
                      setChangeOrderAmount(e.target.value);
                    }}
                    placeholder="e.g. 250 to add $250, or -100 to reduce"
                  />
                  <p className="text-zinc-300 text-xs">
                    Use a negative number to reduce the contract amount. The customer must approve
                    before the contract amount changes.
                  </p>
                </div>
                <Button
                  className="min-h-[44px]"
                  onClick={handleProposeChangeOrder}
                  disabled={
                    proposeChangeOrder.isPending ||
                    changeOrderDescription.trim().length === 0 ||
                    changeOrderAmount.trim().length === 0 ||
                    Number.parseFloat(changeOrderAmount) === 0 ||
                    !Number.isFinite(Number.parseFloat(changeOrderAmount))
                  }
                >
                  {proposeChangeOrder.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    'Submit Change Order'
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-3">
            {change_orders.map((order) => (
              <Card key={order.id} className="glass glass-highlight border border-[var(--brand-gold)]/10">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{order.description}</p>
                      <p className="text-zinc-300 mt-1 text-xs">
                        Proposed by: {order.proposed_by.slice(0, 8)}...
                      </p>
                      <p className="text-zinc-300 text-xs">
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

                  {/* Customer: approve or reject a pending change order */}
                  {isCustomer && order.status === CHANGE_ORDER_STATUS.PROPOSED ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => {
                          handleRespondToChangeOrder(order.id, true);
                        }}
                        disabled={respondToChangeOrder.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => {
                          handleRespondToChangeOrder(order.id, false);
                        }}
                        disabled={respondToChangeOrder.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* Auction Replay link (for completed contracts) */}
      {contract.status === CONTRACT_STATUS.COMPLETED ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <h3 className="gold-text text-sm font-semibold">Auction Replay</h3>
              <p className="text-zinc-300 text-xs">
                Watch how providers competed for this job
              </p>
            </div>
            <Link href={`/auctions/${contract.job_id}/replay` as Route}>
              <Button variant="outline" className="min-h-[44px] gap-2">
                <Play className="h-4 w-4" aria-hidden="true" />
                Watch Replay
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Documents — authenticated HTML contract summary + invoice */}
      {(isCustomer || isProvider) ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <h3 className="gold-text flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Documents
            </h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-zinc-300 text-xs">
              Download a printable contract summary or invoice. Opens the system print dialog for
              Save as PDF / print.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] flex-1 gap-2"
                disabled={docAction !== null}
                onClick={() => {
                  void handleDownloadDocument();
                }}
              >
                {docAction === 'document' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Contract document
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] flex-1 gap-2"
                disabled={docAction !== null}
                onClick={() => {
                  void handleDownloadInvoice();
                }}
              >
                {docAction === 'invoice' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                Invoice
              </Button>
            </div>
            {docError ? (
              <p className="text-destructive text-sm" role="alert">
                {docError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Tip the provider (for completed contracts, customer only).
          Mirrors the list-card affordance so a customer who lands on the
          detail page after completion can tip from here too. Shows the
          composer when untipped; a thank-you acknowledgment once recorded. */}
      {contract.status === CONTRACT_STATUS.COMPLETED && isCustomer ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <h3 className="gold-text flex items-center gap-2 text-sm font-semibold">
              <Heart className="h-4 w-4 text-rose-400" aria-hidden="true" />
              Tip your provider
            </h3>
          </CardHeader>
          <CardContent>
            {(contract.tip_amount_cents ?? 0) > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                <Heart className="h-4 w-4 shrink-0" aria-hidden="true" />
                You tipped {formatCents(contract.tip_amount_cents ?? 0)} — thanks for the love.
              </div>
            ) : (
              <TipWidget
                contractId={contract.id}
                suggestedAmountCents={contract.amount_cents}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Reviews section (for completed contracts) */}
      {contract.status === CONTRACT_STATUS.COMPLETED && (isCustomer || isProvider) ? (
        <ReviewSection contractId={contract.id} />
      ) : null}

      {/* Share savings card (for completed contracts with savings) */}
      {contract.status === CONTRACT_STATUS.COMPLETED && isCustomer && contractSavingsCents > 0 ? (
        <ShareSavingsCard
          savingsCents={contractSavingsCents}
          jobTitle={contract.job_title}
          category={contract.job_title}
        />
      ) : null}
    </div>
    </PageTransition>
  );
}

function ReviewSection({ contractId }: { contractId: string }) {
  const { data: eligibility, isLoading, isError } = useReviewEligibility(contractId);

  if (isLoading) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardContent className="space-y-3 py-6" role="status" aria-label="Loading reviews">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !eligibility) {
    return (
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <h3 className="gold-text text-lg font-semibold">Reviews</h3>
        </CardHeader>
        <CardContent>
          <Link href={`/contracts/${contractId}/review` as Route} className="block">
            <Button className="min-h-[44px] w-full gap-2">
              <Star className="h-4 w-4" aria-hidden="true" />
              Leave a Review
            </Button>
          </Link>
          <p className="text-zinc-400 mt-2 text-xs">
            Could not check eligibility — open the form and the server will enforce the 90-day window.
          </p>
        </CardContent>
      </Card>
    );
  }

  const windowClosed =
    !eligibility.eligible &&
    !eligibility.already_reviewed &&
    !!eligibility.review_window_closes_at &&
    new Date(eligibility.review_window_closes_at) < new Date();

  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardHeader>
        <h3 className="gold-text text-lg font-semibold">Reviews</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibility.eligible && !eligibility.already_reviewed ? (
          <Link href={`/contracts/${contractId}/review` as Route} className="block">
            <Button className="min-h-[44px] w-full gap-2">
              <Star className="h-4 w-4" aria-hidden="true" />
              Leave a Review
            </Button>
          </Link>
        ) : eligibility.already_reviewed ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
            You have already reviewed this contract.
          </div>
        ) : windowClosed ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-300">
            <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
            The 90-day review window for this contract has closed.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-300">
            <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
            Not eligible yet — the contract must be completed and within 90 days of completion.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
