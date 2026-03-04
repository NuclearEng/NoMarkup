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
    queryFn: () => api.get<{ payment: Payment }>(`/api/v1/payments/${id}`),
    enabled: !!id,
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePaymentInput) =>
      api.post<{ payment: Payment }>('/api/v1/payments', input).then((res) => res.payment),
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
    mutationFn: (variables: { paymentId: string; payment_method_id: string }) =>
      api
        .post<{ payment: Payment }>(`/api/v1/payments/${variables.paymentId}/process`, {
          payment_method_id: variables.payment_method_id,
        })
        .then((res) => res.payment),
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
    queryFn: () => api.get<{ payment_methods: PaymentMethod[] }>('/api/v1/payments/methods'),
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
    mutationFn: () =>
      api.post<{ account_id: string }>('/api/v1/providers/me/stripe/account'),
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

export function useStripeOnboardingLink(params: StripeOnboardingLinkParams) {
  const searchParams = new URLSearchParams();
  searchParams.set('return_url', params.return_url);
  searchParams.set('refresh_url', params.refresh_url);
  const query = searchParams.toString();

  return useQuery({
    queryKey: ['stripe-onboarding-link', params.return_url, params.refresh_url],
    queryFn: () =>
      api.get<{ url: string }>(`/api/v1/providers/me/stripe/onboarding?${query}`),
    enabled: false, // Only fetch when explicitly triggered via refetch
  });
}
