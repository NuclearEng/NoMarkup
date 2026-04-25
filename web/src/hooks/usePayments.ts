import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api } from '@/lib/api';
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

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const raw = await api.post<Record<string, unknown>>('/api/v1/payments', input);
      return raw as unknown as Payment;
    },
    onSuccess: () => {
      toast.success('Payment created');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => {
      toast.error('Failed to create payment');
    },
  });
}

export function useProcessPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: { paymentId: string; payment_method_id: string }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/payments/${variables.paymentId}/process`,
        { payment_method_id: variables.payment_method_id },
      );
      return raw as unknown as Payment;
    },
    onSuccess: (_data, variables) => {
      toast.success('Payment processed');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payment', variables.paymentId] });
    },
    onError: () => {
      toast.error('Payment failed — please try again');
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
    onError: () => {
      toast.error('Failed to remove payment method');
    },
  });
}

export function useCreateSetupIntent() {
  return useMutation({
    mutationFn: () =>
      api.post<{ client_secret: string }>('/api/v1/payments/setup-intent'),
    onError: () => {
      toast.error('Failed to initialize payment setup');
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
      api.post<PaymentMethod>('/api/v1/payments/dev/methods', input),
    onSuccess: () => {
      toast.success('Payment method added (dev mode)');
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: () => {
      toast.error('Failed to add payment method');
    },
  });
}

export function useCalculateFees() {
  return useMutation({
    mutationFn: (input: FeeCalculationInput) =>
      api.post<PaymentBreakdown>('/api/v1/payments/calculate-fees', input),
  });
}

export function useStripeAccountStatus() {
  return useQuery({
    queryKey: ['stripe-account-status'],
    queryFn: () => api.get<StripeAccountStatus>('/api/v1/providers/me/stripe/status'),
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
    onError: () => {
      toast.error('Failed to create Stripe account');
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

export function useInstantPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (amountCents: number) =>
      api.post<InstantPayoutResponse>('/api/v1/payments/instant-payout', {
        amount_cents: amountCents,
      }),
    onSuccess: () => {
      toast.success('Payout initiated — funds arriving within minutes');
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-earnings'] });
    },
    onError: () => {
      toast.error('Instant payout failed — please try again');
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
