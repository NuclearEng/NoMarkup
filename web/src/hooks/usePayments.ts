import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  parseProofOfWorkMissing,
  proofOfWorkBlockedMessage,
} from '@/hooks/useWorkEvidence';
import { api, clearIdempotencyKey, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
import type {
  CreatePaymentInput,
  FeeCalculationInput,
  Payment,
  PaymentBreakdown,
  PaymentMethod,
  PaymentsResponse,
  StripeAccountStatus,
} from '@/types';

interface PaymentsParams {
  status?: string;
  page?: number;
  per_page?: number;
}

export function usePayments(params?: PaymentsParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.per_page !== undefined) searchParams.set('per_page', String(params.per_page));
  const query = searchParams.toString();
  const path = `/api/v1/payments${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['payments', params?.status, params?.page, params?.per_page],
    queryFn: () => api.get<PaymentsResponse>(path),
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: ['payment', id],
    // Gateway returns a flat payment object (with breakdown merged in).
    queryFn: async () => {
      const raw = await api.get<Payment>(`/api/v1/payments/${id}`);
      return { payment: raw };
    },
    enabled: !!id,
  });
}

function createPaymentOpKey(input: CreatePaymentInput): string {
  // Sticky per contract+amount+instance so retries soft-replay the same PI.
  // Instance-scoped for FR-18 visits (matches iOS create-payment key shape).
  const inst = input.recurring_instance_id ?? input.milestone_id ?? '';
  return `create-payment:${input.contract_id ?? ''}:${String(input.amount_cents)}:${inst}`;
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const opKey = createPaymentOpKey(input);
      const raw = await api.post<Record<string, unknown> & { client_secret?: string }>(
        '/api/v1/payments',
        input,
        idempotencyHeader(opKey),
      );
      return raw as unknown as Payment & { client_secret?: string };
    },
    onSuccess: (_data, input) => {
      // Keep sticky key until process/capture succeeds for visit pays; clear for
      // one-shot creates so a later intentional re-attempt mints a new key.
      if (!input.recurring_instance_id) {
        clearIdempotencyKey(createPaymentOpKey(input));
      }
      toast.success('Payment created');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to create payment'));
    },
  });
}

/** Clear sticky create-payment key after visit escrow capture (or intentional retry). */
export function clearCreatePaymentIdempotency(input: CreatePaymentInput): void {
  clearIdempotencyKey(createPaymentOpKey(input));
}

export function useProcessPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      paymentId: string;
      /** Optional when PaymentElement already confirmed the PI (pass empty). */
      payment_method_id?: string;
    }) => {
      const pm = variables.payment_method_id ?? '';
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/payments/${variables.paymentId}/process`,
        { payment_method_id: pm },
        idempotencyHeader(`process-payment:${variables.paymentId}`),
      );
      return raw as unknown as Payment;
    },
    onSuccess: (_data, variables) => {
      clearIdempotencyKey(`process-payment:${variables.paymentId}`);
      toast.success('Payment processed');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payment', variables.paymentId] });
      // FR-18.8: process may resume paused recurring — refresh schedule.
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Payment failed — please try again'));
    },
  });
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const res = await api.get<{ methods: PaymentMethod[] }>('/api/v1/payments/methods');
      return { payment_methods: res.methods };
    },
  });
}

export function useDeletePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/api/v1/payments/methods/${id}`),
    onSuccess: () => {
      toast.success('Payment method removed');
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to remove payment method'));
    },
  });
}

export function useSetDefaultPaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.put<{ is_default: boolean }>(
        `/api/v1/payments/methods/${id}/default`,
        undefined,
        idempotencyHeader(`set-default-pm:${id}`),
      ),
    onSuccess: (_data, id) => {
      clearIdempotencyKey(`set-default-pm:${id}`);
      toast.success('Default payment method updated');
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to set default payment method'));
    },
  });
}

export function useCreateSetupIntent() {
  return useMutation({
    mutationFn: () =>
      api.post<{ client_secret: string }>(
        '/api/v1/payments/setup-intent',
        undefined,
        idempotencyHeader(),
      ),
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to initialize payment setup'));
    },
  });
}

export interface DevPaymentMethodInput {
  brand: string;
  last_four: string;
  exp_month: number;
  exp_year: number;
}

export function useAddDevPaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DevPaymentMethodInput) =>
      api.post<PaymentMethod>('/api/v1/payments/dev/methods', input, idempotencyHeader()),
    onSuccess: () => {
      toast.success('Payment method added (dev mode)');
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to add payment method'));
    },
  });
}

export function useCalculateFees() {
  return useMutation({
    mutationFn: (input: FeeCalculationInput) =>
      api.post<PaymentBreakdown>('/api/v1/payments/calculate-fees', input, idempotencyHeader()),
  });
}

export function useStripeAccountStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['stripe-account-status'],
    queryFn: () => api.get<StripeAccountStatus>('/api/v1/providers/me/stripe/status'),
    // This is the PROVIDER payout (Stripe Connect) account status — a
    // provider-only endpoint. Callers must gate it on the provider role so
    // customers (who have saved cards for paying, not a payout account) don't
    // fire a guaranteed 403.
    enabled: options?.enabled ?? true,
  });
}

export function useCreateStripeAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns { stripe_account_id }. Normalize to { account_id } so
    // legacy consumers reading res.account_id keep working.
    mutationFn: async () => {
      const res = await api.post<{ stripe_account_id: string }>(
        '/api/v1/providers/me/stripe/account',
      );
      return { account_id: res.stripe_account_id };
    },
    onSuccess: () => {
      toast.success('Stripe account created');
      void queryClient.invalidateQueries({ queryKey: ['stripe-account-status'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to create Stripe account'));
    },
  });
}

export interface StripeOnboardingLinkParams {
  return_url: string;
  refresh_url: string;
}

export interface InstantPayoutResponse {
  payout_id: string;
  amount_cents: number;
  estimated_arrival: string;
}

export interface InstantPayoutSummary {
  /** Net withdrawable balance: gross cleared earnings − prior instant payouts. */
  available_cents: number;
  gross_eligible_cents: number;
  paid_out_cents: number;
}

/**
 * Net instant-payout balance for the current provider. This is the authoritative
 * withdrawable amount (gross cleared earnings minus what was already paid out) —
 * NOT gross total earnings, which would let a provider withdraw the same cleared
 * earnings repeatedly. The mutation enforces the same formula server-side.
 */
export function useInstantPayoutSummary(enabled = true) {
  return useQuery({
    queryKey: ['instant-payout-summary'],
    enabled,
    queryFn: async () => {
      try {
        return await api.get<InstantPayoutSummary>('/api/v1/payments/instant-payout/summary');
      } catch {
        // Feature flag off / non-provider / transient error: fall back to no
        // advertised balance rather than crashing the dashboard.
        return null;
      }
    },
  });
}

export function useInstantPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (amountCents: number) => {
      const opKey = `instant-payout:${String(amountCents)}`;
      return api.post<InstantPayoutResponse>(
        '/api/v1/payments/instant-payout',
        { amount_cents: amountCents },
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (_data, amountCents) => {
      clearIdempotencyKey(`instant-payout:${String(amountCents)}`);
      toast.success('Payout initiated — funds arriving within minutes');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-earnings'] });
      void queryClient.invalidateQueries({ queryKey: ['instant-payout-summary'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Instant payout failed — please try again'));
    },
  });
}

export function useStripeOnboardingLink(params: StripeOnboardingLinkParams) {
  const searchParams = new URLSearchParams();
  searchParams.set('return_url', params.return_url);
  searchParams.set('refresh_url', params.refresh_url);
  const query = searchParams.toString();

  return useQuery({
    queryKey: ['stripe-onboarding-link', params.return_url, params.refresh_url],
    // Gateway returns { onboarding_url }. Normalize to { url } so the previous
    // shape survives — callers redirect to res.url.
    queryFn: async () => {
      const res = await api.get<{ onboarding_url: string }>(
        `/api/v1/providers/me/stripe/onboarding?${query}`,
      );
      return { url: res.onboarding_url };
    },
    enabled: false, // Only fetch when explicitly triggered via refetch
  });
}

/**
 * Mint a Connect AccountSession client_secret for embedded onboarding /
 * notification banner. Secrets are single-use and short-lived — call again
 * when Connect.js needs a fresh one (fetchClientSecret pattern).
 */
export function useCreateStripeAccountSession() {
  return useMutation({
    mutationFn: () =>
      api.post<{ client_secret: string; expires_at?: string }>(
        '/api/v1/providers/me/stripe/account-session',
      ),
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to start embedded Stripe setup'));
    },
  });
}

/**
 * POST /payments/{id}/release — customer (or admin) releases held escrow.
 * 409 proof-of-work is mapped to the blocked-release copy; never toast success.
 */
export function useReleaseEscrow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { paymentId: string; reason?: string }) => {
      const raw = await api.post<Payment>(
        `/api/v1/payments/${variables.paymentId}/release`,
        { reason: variables.reason ?? 'customer approved completion' },
        idempotencyHeader(`payment-release:${variables.paymentId}`),
      );
      return raw;
    },
    onSuccess: (_data, variables) => {
      clearIdempotencyKey(`payment-release:${variables.paymentId}`);
      toast.success('Escrow released to the provider');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payment', variables.paymentId] });
      void queryClient.invalidateQueries({ queryKey: ['work-evidence'] });
    },
    onError: (err) => {
      const missing = parseProofOfWorkMissing(err);
      if (missing !== null) {
        toast.error(proofOfWorkBlockedMessage(missing));
        return;
      }
      toast.error(getApiErrorMessage(err, 'Failed to release escrow'));
    },
  });
}
