import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api, idempotencyHeader } from '@/lib/api';
import type {
  CancelSubscriptionInput,
  ChangeTierInput,
  CreateSubscriptionInput,
  Invoice,
  Subscription,
  SubscriptionTier,
  SubscriptionUsage,
} from '@/types';

export function useTiers() {
  return useQuery({
    queryKey: ['subscription-tiers'],
    queryFn: () =>
      api.get<{ tiers: SubscriptionTier[] }>('/api/v1/subscriptions/tiers'),
    staleTime: 60 * 60 * 1000, // 1 hour — tiers rarely change
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: () =>
      api.get<{ subscription: Subscription }>('/api/v1/subscriptions/me'),
  });
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSubscriptionInput) =>
      api
        .post<{ subscription: Subscription }>('/api/v1/subscriptions', input, idempotencyHeader())
        .then((res) => res.subscription),
    onSuccess: () => {
      toast.success('Subscription started');
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.userMessage('Failed to start subscription') : 'Failed to start subscription',
      );
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CancelSubscriptionInput) =>
      api.post<{ subscription: Subscription }>(
        '/api/v1/subscriptions/cancel',
        input,
        idempotencyHeader(),
      ),
    onSuccess: () => {
      toast.success('Subscription cancelled');
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.userMessage('Failed to cancel subscription') : 'Failed to cancel subscription',
      );
    },
  });
}

export function useChangeTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangeTierInput) =>
      api
        .post<{ subscription: Subscription }>(
          '/api/v1/subscriptions/change-tier',
          input,
          idempotencyHeader(),
        )
        .then((res) => res.subscription),
    onSuccess: () => {
      toast.success('Plan changed');
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.userMessage('Failed to change plan') : 'Failed to change plan',
      );
    },
  });
}

export function useUsage() {
  return useQuery({
    queryKey: ['subscription-usage'],
    queryFn: () =>
      api.get<SubscriptionUsage>('/api/v1/subscriptions/usage'),
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['subscription-invoices'],
    queryFn: () =>
      api.get<{ invoices: Invoice[] }>('/api/v1/subscriptions/invoices'),
  });
}
