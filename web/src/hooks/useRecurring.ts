import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  ApiError,
  api,
  clearIdempotencyKey,
  getApiErrorMessage,
  idempotencyHeader,
} from '@/lib/api';
import {
  hasConfirmablePayment,
  isConfirmablePaymentSecret,
  isDevClientSecret,
} from '@/lib/payment-outcome';
import type {
  ContractRecurringConfig,
  ContractRecurringInstance,
  Payment,
  RecurringInstanceActionResult,
} from '@/types';

function explainFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

function recurringConfigKey(contractId: string) {
  return ['recurring', 'config', contractId] as const;
}

function recurringInstancesKey(contractId: string) {
  return ['recurring', 'instances', contractId] as const;
}

/** GET /api/v1/contracts/{id}/recurring — includes FR-16.7 payment_retry fields. */
export function useRecurringConfig(contractId: string, enabled = true) {
  return useQuery({
    queryKey: recurringConfigKey(contractId),
    queryFn: async () => {
      const res = await api.get<{ config: ContractRecurringConfig | null }>(
        `/api/v1/contracts/${contractId}/recurring`,
      );
      return res.config ?? null;
    },
    enabled: !!contractId && enabled,
    // 404 / no config is expected for non-recurring contracts — fail soft.
    retry: false,
  });
}

/** GET /api/v1/contracts/{id}/recurring/instances */
export function useRecurringInstances(contractId: string, enabled = true) {
  return useQuery({
    queryKey: recurringInstancesKey(contractId),
    queryFn: async () => {
      const res = await api.get<{ instances: ContractRecurringInstance[] }>(
        `/api/v1/contracts/${contractId}/recurring/instances?page=1&page_size=20`,
      );
      return res.instances ?? [];
    },
    enabled: !!contractId && enabled,
    retry: false,
  });
}

function invalidateRecurring(queryClient: ReturnType<typeof useQueryClient>, contractId: string) {
  void queryClient.invalidateQueries({ queryKey: recurringConfigKey(contractId) });
  void queryClient.invalidateQueries({ queryKey: recurringInstancesKey(contractId) });
  void queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
}

export function usePauseRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contractId: string) =>
      api.post<{ config: ContractRecurringConfig }>(
        `/api/v1/contracts/${contractId}/recurring/pause`,
      ),
    onSuccess: (data, contractId) => {
      toast.success('Recurring schedule paused');
      queryClient.setQueryData(recurringConfigKey(contractId), data.config);
      invalidateRecurring(queryClient, contractId);
    },
    onError: explainFailure('Failed to pause recurring schedule'),
  });
}

export function useResumeRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contractId: string) =>
      api.post<{ config: ContractRecurringConfig }>(
        `/api/v1/contracts/${contractId}/recurring/resume`,
      ),
    onSuccess: (data, contractId) => {
      toast.success('Recurring schedule resumed');
      queryClient.setQueryData(recurringConfigKey(contractId), data.config);
      invalidateRecurring(queryClient, contractId);
    },
    onError: explainFailure('Failed to resume recurring schedule'),
  });
}

export function useCancelRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contractId: string) =>
      api.post<{ config: ContractRecurringConfig }>(
        `/api/v1/contracts/${contractId}/recurring/cancel`,
      ),
    onSuccess: (data, contractId) => {
      toast.success('Recurring schedule cancelled');
      queryClient.setQueryData(recurringConfigKey(contractId), data.config);
      invalidateRecurring(queryClient, contractId);
    },
    onError: explainFailure('Failed to cancel recurring schedule'),
  });
}

/**
 * Normalize approve/complete response. Money fields only when gateway returned
 * them — never invent payment_id or client_secret.
 */
function parseInstanceActionResult(raw: Record<string, unknown>): RecurringInstanceActionResult {
  const instance = (raw.instance ?? {}) as ContractRecurringInstance;
  const payment = raw.payment as Payment | undefined;
  const topSecret =
    typeof raw.client_secret === 'string' ? raw.client_secret : undefined;
  const nestedSecret =
    payment && typeof (payment as Payment & { client_secret?: string }).client_secret === 'string'
      ? (payment as Payment & { client_secret?: string }).client_secret
      : undefined;
  const paymentId =
    (typeof raw.payment_id === 'string' && raw.payment_id) ||
    (payment?.id ? payment.id : undefined);

  return {
    instance,
    payment_id: paymentId,
    client_secret: topSecret ?? nestedSecret,
    payment_residual: typeof raw.payment_residual === 'string' ? raw.payment_residual : undefined,
    payment_error: typeof raw.payment_error === 'string' ? raw.payment_error : undefined,
    payment,
    off_session_charged: raw.off_session_charged === true,
    off_session_charge_residual:
      typeof raw.off_session_charge_residual === 'string'
        ? raw.off_session_charge_residual
        : undefined,
    recurring_paused: raw.recurring_paused === true,
    recurring_status: typeof raw.recurring_status === 'string' ? raw.recurring_status : undefined,
    recurring_config: raw.recurring_config as ContractRecurringConfig | undefined,
  };
}

/** True when gateway returned a confirmable (or dev) PaymentIntent secret. */
export function recurringResultHasPayCTA(result: RecurringInstanceActionResult): boolean {
  if (result.off_session_charged === true) return false;
  return hasConfirmablePayment({ client_secret: result.client_secret });
}

export function useCompleteRecurringInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: { contractId: string; instanceId: string }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/contracts/${variables.contractId}/recurring/instances/${variables.instanceId}/complete`,
      );
      return parseInstanceActionResult(raw);
    },
    onSuccess: (_data, variables) => {
      toast.success('Visit marked complete');
      invalidateRecurring(queryClient, variables.contractId);
    },
    onError: explainFailure('Failed to complete visit'),
  });
}

export function useApproveRecurringInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: { contractId: string; instanceId: string }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/contracts/${variables.contractId}/recurring/instances/${variables.instanceId}/approve`,
      );
      return parseInstanceActionResult(raw);
    },
    onSuccess: (_data, variables) => {
      toast.success('Visit approved');
      invalidateRecurring(queryClient, variables.contractId);
    },
    onError: explainFailure('Failed to approve visit'),
  });
}

function visitCreatePaymentOpKey(
  contractId: string,
  amountCents: number,
  instanceId: string,
): string {
  return `create-payment:${contractId}:${String(amountCents)}:${instanceId}`;
}

/**
 * Customer POST /payments for an auto-approved visit when approve/complete did
 * not leave a client_secret on this device. Amount MUST be server instance cents.
 */
export function useCreateVisitPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: {
      contractId: string;
      amountCents: number;
      instanceId: string;
      providerId?: string;
    }) => {
      if (variables.amountCents <= 0) {
        throw new Error('This visit has no server amount to charge.');
      }
      const opKey = visitCreatePaymentOpKey(
        variables.contractId,
        variables.amountCents,
        variables.instanceId,
      );
      const raw = await api.post<Payment & { client_secret?: string }>(
        '/api/v1/payments',
        {
          contract_id: variables.contractId,
          amount_cents: variables.amountCents,
          recurring_instance_id: variables.instanceId,
          provider_id: variables.providerId,
        },
        idempotencyHeader(opKey),
      );
      return raw;
    },
    onSuccess: () => {
      // Keep sticky key until process succeeds so retries soft-replay same PI.
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to start visit payment'));
    },
  });
}

export function clearVisitPaymentIdempotency(
  contractId: string,
  amountCents: number,
  instanceId: string,
): void {
  clearIdempotencyKey(visitCreatePaymentOpKey(contractId, amountCents, instanceId));
}

/** Capture after PaymentElement (or dev skip) — empty PM when intent already confirmed. */
export function useProcessVisitPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (paymentId: string) => {
      const raw = await api.post<Payment>(
        `/api/v1/payments/${paymentId}/process`,
        { payment_method_id: '' },
        idempotencyHeader(`process-payment:${paymentId}`),
      );
      return raw;
    },
    onSuccess: (_data, paymentId) => {
      clearIdempotencyKey(`process-payment:${paymentId}`);
      toast.success('Visit paid — funds held in escrow');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payment', paymentId] });
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Could not capture visit payment'));
    },
  });
}

export function isRecurringInstanceCompletable(instance: ContractRecurringInstance): boolean {
  const s = (instance.status ?? '').toLowerCase();
  return s === 'scheduled' || s === 'in_progress';
}

/**
 * Completed visits may be approved by the customer. Server approve is idempotent.
 * Auto-approved or already-approved visits hide the Approve CTA (Pay may remain).
 * Prefer `approved_at` on the wire for durable hide across reloads.
 */
export function isRecurringInstanceApprovable(instance: ContractRecurringInstance): boolean {
  if ((instance.status ?? '').toLowerCase() !== 'completed') return false;
  if (instance.auto_approved === true) return false;
  if (instance.approved_at?.trim()) return false;
  return true;
}

export function hasPaymentRetryInfo(config: ContractRecurringConfig): boolean {
  if ((config.payment_retry_count ?? 0) > 0) return true;
  const next = config.next_retry_at?.trim();
  return !!next;
}

export function formatRecurringFrequency(frequency: string | undefined): string {
  const f = (frequency ?? '').trim();
  if (!f) return 'Recurring';
  return f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatRecurringStatus(status: string | undefined): string {
  const s = (status ?? 'unknown').replace(/_/g, ' ');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export { isConfirmablePaymentSecret, isDevClientSecret, hasConfirmablePayment };
