'use client';

// RecurringSchedule — FR-18 visit timeline + FR-16.7 payment retry status on
// contract detail. Mirrors iOS ContractDetailView.recurringSection:
//   - Config: frequency, status, rate, next, auto-approve, payment_retry_*
//   - Pause / Resume / Cancel schedule
//   - Provider: Mark visit complete
//   - Customer: Approve visit · Pay visit (PaymentElement) when client_secret
//     or CreatePayment for auto-approved residual
// Security: Pay CTAs are customer-only; amounts always come from the server
// instance — never client fee math.

import { AlertTriangle, CreditCard, Loader2, Pause, Play, XCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  clearVisitPaymentIdempotency,
  formatRecurringFrequency,
  formatRecurringStatus,
  hasPaymentRetryInfo,
  isRecurringInstanceApprovable,
  isRecurringInstanceCompletable,
  recurringResultHasPayCTA,
  useApproveRecurringInstance,
  useCancelRecurring,
  useCompleteRecurringInstance,
  useCreateVisitPayment,
  usePauseRecurring,
  useProcessVisitPayment,
  useRecurringConfig,
  useRecurringInstances,
  useResumeRecurring,
} from '@/hooks/useRecurring';
import {
  hasConfirmablePayment,
  isDevClientSecret,
  type PaymentOutcome,
} from '@/lib/payment-outcome';
import { formatCents } from '@/lib/utils';
import type {
  ContractRecurringConfig,
  ContractRecurringInstance,
  RecurringInstanceActionResult,
} from '@/types';

export interface RecurringScheduleProps {
  contractId: string;
  customerId: string;
  providerId: string;
  isCustomer: boolean;
  isProvider: boolean;
  /** Embedded config from GetContract when present (fallback seed). */
  embeddedConfig?: ContractRecurringConfig | null;
}

interface PendingVisitPay {
  instanceId: string;
  paymentId: string;
  clientSecret: string;
  amountCents: number;
}

function formatOccurrenceDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRetryAt(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusBadgeVariant(
  status: string | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return 'default';
    case 'paused':
      return 'secondary';
    case 'cancelled':
    case 'canceled':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function RecurringSchedule({
  contractId,
  customerId: _customerId,
  providerId,
  isCustomer,
  isProvider,
  embeddedConfig,
}: RecurringScheduleProps) {
  // Always try dedicated endpoints when we have a contract id. Embedded config
  // is a seed; 404/empty means non-recurring and we hide the section.
  const configQuery = useRecurringConfig(contractId, true);
  const config: ContractRecurringConfig | null =
    configQuery.data ?? embeddedConfig ?? null;
  const hasConfig = !!config?.id;

  const instancesQuery = useRecurringInstances(contractId, hasConfig);
  const instances = instancesQuery.data ?? [];

  const pauseRecurring = usePauseRecurring();
  const resumeRecurring = useResumeRecurring();
  const cancelRecurring = useCancelRecurring();
  const completeInstance = useCompleteRecurringInstance();
  const approveInstance = useApproveRecurringInstance();
  const createVisitPayment = useCreateVisitPayment();
  const processVisitPayment = useProcessVisitPayment();

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actingInstanceId, setActingInstanceId] = useState<string | null>(null);
  const [pendingPay, setPendingPay] = useState<PendingVisitPay | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  // Optimistic hide for Approve until the list refetch carries approved_at.
  const [approvedInstanceIds, setApprovedInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const configBusy =
    pauseRecurring.isPending || resumeRecurring.isPending || cancelRecurring.isPending;

  const applyMoneyResult = useCallback(
    (result: RecurringInstanceActionResult, source: 'approve' | 'complete') => {
      const amountLabel = formatCents(result.instance.amount_cents ?? 0);

      if (result.off_session_charged === true) {
        setPendingPay(null);
        setStatusIsError(false);
        setStatusMessage(
          source === 'approve'
            ? `Visit approved. Saved card charged off-session — ${amountLabel} held in escrow.`
            : `Visit complete and auto-approved. Saved card charged off-session — ${amountLabel} held in escrow.`,
        );
        return;
      }

      if (recurringResultHasPayCTA(result) && result.client_secret && result.payment_id) {
        // Customer-only pay surface; store for PaymentElement / dev process.
        if (isCustomer) {
          setPendingPay({
            instanceId: result.instance.id,
            paymentId: result.payment_id,
            clientSecret: result.client_secret,
            amountCents: result.instance.amount_cents ?? 0,
          });
          const residual =
            result.off_session_charge_residual?.trim()
              ? ` (on-session residual: ${result.off_session_charge_residual})`
              : '';
          setStatusIsError(false);
          setStatusMessage(
            source === 'approve'
              ? `Visit approved. Complete payment for ${amountLabel} to hold escrow.${residual}`
              : `Visit complete and auto-approved. Pay visit when ready to hold escrow (${amountLabel}).${residual}`,
          );
          return;
        }
        // Provider completed with auto-approve PI — customer pays on their session.
        setStatusIsError(false);
        setStatusMessage(
          source === 'complete' && result.instance.auto_approved
            ? `Visit complete and auto-approved. Customer can pay ${amountLabel} to hold escrow.`
            : `Visit marked complete.`,
        );
        return;
      }

      if (result.payment_residual) {
        setPendingPay(null);
        setStatusIsError(false);
        setStatusMessage(
          result.payment_error ??
            (source === 'approve'
              ? `Visit approved; escrow PaymentIntent was not created (${result.payment_residual}). Use Pay visit when ready.`
              : `Visit complete; escrow PaymentIntent was not created (${result.payment_residual}). Customer can use Pay visit.`),
        );
        return;
      }

      setPendingPay(null);
      setStatusIsError(false);
      setStatusMessage(source === 'approve' ? 'Visit approved.' : 'Visit marked complete.');
    },
    [isCustomer],
  );

  const captureVisitPayment = useCallback(
    async (paymentId: string, instanceId: string, amountCents: number) => {
      try {
        await processVisitPayment.mutateAsync(paymentId);
        clearVisitPaymentIdempotency(contractId, amountCents, instanceId);
        setPendingPay(null);
        setStatusIsError(false);
        setStatusMessage(
          `Visit paid — ${formatCents(amountCents)} held in escrow. Release after work is done.`,
        );
      } catch {
        // Error toast from hook; keep pending CTA for retry.
        setStatusIsError(true);
        setStatusMessage('Could not capture visit payment. Tap Pay visit to retry.');
      }
    },
    [contractId, processVisitPayment],
  );

  const handlePayWithSecret = useCallback(
    async (pending: PendingVisitPay) => {
      if (!isCustomer) {
        setStatusIsError(true);
        setStatusMessage('Only the customer can fund visit escrow.');
        return;
      }
      setActingInstanceId(pending.instanceId);

      // Dev sentinel: skip Elements (PaymentConfirmation would refuse) and process.
      if (isDevClientSecret(pending.clientSecret)) {
        await captureVisitPayment(pending.paymentId, pending.instanceId, pending.amountCents);
        setActingInstanceId(null);
        return;
      }

      // Real secret: PaymentConfirmation mounts Elements; onOutcome handles process.
      // If somehow not confirmable, surface residual without inventing money.
      if (!hasConfirmablePayment({ client_secret: pending.clientSecret })) {
        setStatusIsError(true);
        setStatusMessage(
          'Payment created but no confirmable client_secret was returned. Retry shortly, or check Stripe configuration.',
        );
        setActingInstanceId(null);
      }
      // When confirmable, the PaymentConfirmation form is already shown for pendingPay.
      setActingInstanceId(null);
    },
    [captureVisitPayment, isCustomer],
  );

  const handlePaymentOutcome = useCallback(
    (outcome: PaymentOutcome) => {
      if (!pendingPay) return;
      // Services escrow uses manual capture: confirmPayment often leaves the
      // intent in requires_capture → outcome.kind === 'processing' (not settled).
      // ProcessPayment then captures into escrow. Marketplace automatic capture
      // yields settled instead — both paths must capture server-side for visits.
      const readyToCapture =
        outcome.settled || outcome.kind === 'processing';
      if (readyToCapture) {
        void captureVisitPayment(
          pendingPay.paymentId,
          pendingPay.instanceId,
          pendingPay.amountCents,
        );
        return;
      }
      // Decline / abandoned SCA / canceled — keep Pay CTA; do not invent success.
      setStatusIsError(false);
      setStatusMessage(
        'Payment not completed. Tap Pay visit to retry; approve already used a sticky server idempotency key.',
      );
    },
    [captureVisitPayment, pendingPay],
  );

  /** Auto-approved visit residual: CreatePayment with server instance amount. */
  async function handlePayAutoApproved(instance: ContractRecurringInstance) {
    if (!isCustomer) {
      setStatusIsError(true);
      setStatusMessage('Only the customer can fund visit escrow.');
      return;
    }
    const amountCents = instance.amount_cents ?? 0;
    if (amountCents <= 0) {
      setStatusIsError(true);
      setStatusMessage('This visit has no server amount to charge.');
      return;
    }

    setActingInstanceId(instance.id);
    setStatusMessage(null);
    setStatusIsError(false);
    try {
      const created = await createVisitPayment.mutateAsync({
        contractId,
        amountCents,
        instanceId: instance.id,
        providerId,
      });
      const secret = created.client_secret ?? '';
      if (!hasConfirmablePayment({ client_secret: secret })) {
        setStatusIsError(true);
        setStatusMessage(
          'Payment created but no confirmable client_secret was returned. Retry shortly, or check Stripe configuration.',
        );
        return;
      }
      setPendingPay({
        instanceId: instance.id,
        paymentId: created.id,
        clientSecret: secret,
        amountCents,
      });
      if (isDevClientSecret(secret)) {
        await captureVisitPayment(created.id, instance.id, amountCents);
      } else {
        setStatusIsError(false);
        setStatusMessage(`Complete payment for ${formatCents(amountCents)} to hold escrow.`);
      }
    } catch {
      setStatusIsError(true);
      setStatusMessage('Could not start visit payment. Please try again.');
    } finally {
      setActingInstanceId(null);
    }
  }

  async function handleComplete(instance: ContractRecurringInstance) {
    setActingInstanceId(instance.id);
    setStatusMessage(null);
    setStatusIsError(false);
    try {
      const result = await completeInstance.mutateAsync({
        contractId,
        instanceId: instance.id,
      });
      applyMoneyResult(result, 'complete');
    } catch {
      setStatusIsError(true);
      setStatusMessage('Failed to complete visit. Please try again.');
    } finally {
      setActingInstanceId(null);
    }
  }

  async function handleApprove(instance: ContractRecurringInstance) {
    setActingInstanceId(instance.id);
    setStatusMessage(null);
    setStatusIsError(false);
    try {
      const result = await approveInstance.mutateAsync({
        contractId,
        instanceId: instance.id,
      });
      setApprovedInstanceIds((prev) => {
        const next = new Set(prev);
        next.add(result.instance.id);
        return next;
      });
      applyMoneyResult(result, 'approve');
    } catch {
      setStatusIsError(true);
      setStatusMessage('Failed to approve visit. Please try again.');
    } finally {
      setActingInstanceId(null);
    }
  }

  // Still loading first config fetch and no embed — show skeleton only when
  // we might have recurring (embedded present) or query is pending without 404 yet.
  if (configQuery.isLoading && !embeddedConfig) {
    // Avoid flashing a section on every non-recurring contract: only show
    // skeleton when the contract already hinted at recurring via payment_timing
    // or embed. Without either, stay silent until we know.
    return null;
  }

  // Explicit fetch error with no embed → not a recurring contract (or forbidden).
  if (!hasConfig) {
    if (embeddedConfig?.id) {
      // Keep showing seed while refetch fails soft.
    } else {
      return null;
    }
  }

  const resolved = config ?? embeddedConfig;
  if (!resolved?.id) return null;

  const status = (resolved.status ?? '').toLowerCase();
  const isActive = status === 'active';
  const isPaused = status === 'paused';
  const isCancelled = status === 'cancelled' || status === 'canceled';
  const retryInfo = hasPaymentRetryInfo(resolved);
  const retryCount = resolved.payment_retry_count ?? 0;
  const retryThreshold = resolved.payment_retry_threshold ?? 3;

  return (
    <Card
      className="glass glass-highlight border border-[var(--brand-gold)]/10"
      data-testid="recurring-schedule"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="gold-text text-sm font-medium">Recurring schedule</h3>
          <Badge variant={statusBadgeVariant(resolved.status)}>
            {formatRecurringStatus(resolved.status)}
          </Badge>
        </div>
        <p className="text-xs text-zinc-400">
          {retryInfo
            ? 'Payment setup failed previously; the platform retries CreatePayment on a day-3/day-7 schedule (pauses at 3 failures). Pause stops new visits; cancel ends after the next occurrence notice. Money is never invented client-side.'
            : 'Pause stops new visits; cancel ends the schedule after the next occurrence notice. Approving a visit may open checkout for that visit’s server amount (held escrow). Money is never invented client-side.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Config summary */}
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-300">Frequency</dt>
            <dd className="font-medium">{formatRecurringFrequency(resolved.frequency)}</dd>
          </div>
          <div className="glass-divider" role="separator" />
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-300">Rate</dt>
            <dd className="font-medium tabular-nums">
              {formatCents(resolved.rate_cents ?? 0)}
            </dd>
          </div>
          {resolved.next_occurrence ? (
            <>
              <div className="glass-divider" role="separator" />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-300">Next occurrence</dt>
                <dd className="font-medium">{formatOccurrenceDate(resolved.next_occurrence)}</dd>
              </div>
            </>
          ) : null}
          {resolved.auto_approve ? (
            <>
              <div className="glass-divider" role="separator" />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-300">Auto-approve</dt>
                <dd className="font-medium">On</dd>
              </div>
            </>
          ) : null}
          {retryInfo ? (
            <>
              {retryCount > 0 ? (
                <>
                  <div className="glass-divider" role="separator" />
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-zinc-300">Payment retries</dt>
                    <dd
                      className={`font-semibold tabular-nums ${
                        retryCount >= retryThreshold ? 'text-destructive' : 'text-amber-400'
                      }`}
                      aria-label={`Payment retries ${String(retryCount)} of ${String(retryThreshold)}`}
                    >
                      {retryCount} of {retryThreshold}
                    </dd>
                  </div>
                </>
              ) : null}
              {resolved.next_retry_at ? (
                <>
                  <div className="glass-divider" role="separator" />
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-zinc-300">Next auto-retry</dt>
                    <dd
                      className="text-amber-400 text-sm"
                      aria-label={`Next automatic payment retry ${formatRetryAt(resolved.next_retry_at)}`}
                    >
                      {formatRetryAt(resolved.next_retry_at)}
                    </dd>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </dl>

        {/* Schedule controls — either party (server enforces). */}
        {!isCancelled && (isCustomer || isProvider) ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {isActive ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] gap-2"
                disabled={configBusy}
                onClick={() => {
                  pauseRecurring.mutate(contractId);
                }}
              >
                {pauseRecurring.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden="true" />
                )}
                Pause schedule
              </Button>
            ) : null}
            {isPaused ? (
              <Button
                type="button"
                className="min-h-[44px] gap-2"
                disabled={configBusy}
                onClick={() => {
                  resumeRecurring.mutate(contractId);
                }}
              >
                {resumeRecurring.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
                Resume schedule
              </Button>
            ) : null}
            {showCancelConfirm ? (
              <div className="w-full space-y-2 rounded-lg border border-destructive/30 p-3">
                <p className="text-sm">
                  Cancel this recurring schedule? Takes effect after the next scheduled occurrence
                  (1-visit notice). Completed visits stay on the timeline.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-[44px]"
                    disabled={configBusy}
                    onClick={() => {
                      cancelRecurring.mutate(contractId, {
                        onSuccess: () => {
                          setShowCancelConfirm(false);
                        },
                      });
                    }}
                  >
                    {cancelRecurring.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Confirm cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={configBusy}
                    onClick={() => {
                      setShowCancelConfirm(false);
                    }}
                  >
                    Keep schedule
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 min-h-[44px] gap-2"
                disabled={configBusy}
                onClick={() => {
                  setShowCancelConfirm(true);
                }}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Cancel schedule
              </Button>
            )}
          </div>
        ) : null}

        {statusMessage ? (
          <p
            role={statusIsError ? 'alert' : 'status'}
            aria-live="polite"
            className={
              statusIsError
                ? 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                : 'rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'
            }
          >
            {statusMessage}
          </p>
        ) : null}

        {/* Instances */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-200">Visits</h4>
          {instancesQuery.isLoading ? (
            <div className="space-y-2" data-testid="recurring-instances-loading">
              <Skeleton className="h-16 w-full" variant="card" />
              <Skeleton className="h-16 w-full" variant="card" />
            </div>
          ) : instances.length === 0 ? (
            <p className="text-zinc-400 text-sm">
              No occurrences yet. The first instance is created when both parties accept a recurring
              job.
            </p>
          ) : (
            <ul className="space-y-3">
              {instances.map((instance) => {
                const pendingForInstance =
                  pendingPay?.instanceId === instance.id ? pendingPay : null;
                const showPendingPay =
                  isCustomer &&
                  pendingForInstance !== null &&
                  hasConfirmablePayment({ client_secret: pendingForInstance.clientSecret });
                const showAutoApprovePay =
                  isCustomer &&
                  instance.auto_approved === true &&
                  (instance.status ?? '').toLowerCase() === 'completed' &&
                  !showPendingPay &&
                  pendingForInstance === null;
                const amountLabel = formatCents(instance.amount_cents ?? 0);
                const acting = actingInstanceId === instance.id;
                const busy =
                  acting ||
                  completeInstance.isPending ||
                  approveInstance.isPending ||
                  createVisitPayment.isPending ||
                  processVisitPayment.isPending;

                return (
                  <li
                    key={instance.id}
                    className="rounded-lg border border-[var(--brand-gold)]/10 bg-zinc-900/40 p-3"
                    data-testid={`recurring-instance-${instance.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {formatOccurrenceDate(instance.occurrence_date)}
                        </p>
                        <p className="text-zinc-300 mt-0.5 text-xs">
                          {formatRecurringStatus(instance.status)}
                          {instance.auto_approved
                            ? ' · Auto-approved'
                            : instance.approved_at || approvedInstanceIds.has(instance.id)
                              ? ' · Approved'
                              : ''}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-[var(--brand-gold)]">
                        {amountLabel}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      {/* Provider: Mark visit complete */}
                      {isProvider && isRecurringInstanceCompletable(instance) ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px] w-full"
                          disabled={busy}
                          onClick={() => {
                            void handleComplete(instance);
                          }}
                        >
                          {acting && completeInstance.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Mark visit complete
                        </Button>
                      ) : null}

                      {/* Customer: Approve visit (hide when auto/approved_at/session optimistic) */}
                      {isCustomer &&
                      isRecurringInstanceApprovable(instance) &&
                      !approvedInstanceIds.has(instance.id) ? (
                        <Button
                          type="button"
                          className="min-h-[44px] w-full"
                          disabled={busy}
                          onClick={() => {
                            void handleApprove(instance);
                          }}
                        >
                          {acting && approveInstance.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Approve visit
                        </Button>
                      ) : null}

                      {/* Customer: Pay with existing client_secret from approve/complete */}
                      {showPendingPay && pendingForInstance ? (
                        <div className="space-y-3" data-testid="recurring-pay-form">
                          {!isDevClientSecret(pendingForInstance.clientSecret) ? (
                            <PaymentConfirmation
                              clientSecret={pendingForInstance.clientSecret}
                              submitLabel={`Pay visit · ${amountLabel}`}
                              returnPath={`/contracts/${contractId}`}
                              onOutcome={handlePaymentOutcome}
                              onCancel={() => {
                                toast.message(
                                  'Payment canceled. Tap Pay visit to retry; create uses a sticky Idempotency-Key.',
                                );
                              }}
                            />
                          ) : (
                            <Button
                              type="button"
                              className="min-h-[44px] w-full gap-2"
                              disabled={busy}
                              onClick={() => {
                                void handlePayWithSecret(pendingForInstance);
                              }}
                            >
                              {processVisitPayment.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <CreditCard className="h-4 w-4" aria-hidden="true" />
                              )}
                              Pay visit · {amountLabel}
                            </Button>
                          )}
                        </div>
                      ) : null}

                      {/* Customer: auto-approved residual without pending secret */}
                      {showAutoApprovePay ? (
                        <Button
                          type="button"
                          className="min-h-[44px] w-full gap-2"
                          disabled={busy}
                          onClick={() => {
                            void handlePayAutoApproved(instance);
                          }}
                          aria-label={`Pay visit ${amountLabel}`}
                        >
                          {acting && createVisitPayment.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <CreditCard className="h-4 w-4" aria-hidden="true" />
                          )}
                          Pay visit · {amountLabel}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {retryCount >= retryThreshold ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Payment setup failed {String(retryThreshold)} times — the schedule may be paused.
              Pay an open visit or resume after fixing your payment method.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
