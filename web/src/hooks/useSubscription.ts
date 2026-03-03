import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
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
        .post<{ subscription: Subscription }>('/api/v1/subscriptions', input)
        .then((res) => res.subscription),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CancelSubscriptionInput) =>
      api.delete<{ subscription: Subscription }>('/api/v1/subscriptions/me', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

export function useChangeTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangeTierInput) =>
      api
        .patch<{ subscription: Subscription }>('/api/v1/subscriptions/me/tier', input)
        .then((res) => res.subscription),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
    },
  });
}

export function useUsage() {
  return useQuery({
    queryKey: ['subscription-usage'],
    queryFn: () =>
      api.get<SubscriptionUsage>('/api/v1/subscriptions/me/usage'),
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ['subscription-invoices'],
    queryFn: () =>
      api.get<{ invoices: Invoice[] }>('/api/v1/subscriptions/me/invoices'),
  });
}
