import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api, clearIdempotencyKey, idempotencyHeader } from '@/lib/api';
import type {
  CancelSubscriptionInput,
  ChangeTierInput,
  ChangeTierResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
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
    mutationFn: (input: CreateSubscriptionInput) => {
      const opKey = `create-subscription:${input.tier_id}:${input.billing_interval}`;
      return api.post<CreateSubscriptionResult>(
        '/api/v1/subscriptions',
        input,
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (data, input) => {
      clearIdempotencyKey(`create-subscription:${input.tier_id}:${input.billing_interval}`);
      const paid =
        data.subscription.status === 'active' || data.subscription.status === 'trialing';
      // A client_secret means Stripe still has to confirm the invoice.
      // Do not tell the user the plan started.
      if (paid && !data.client_secret) {
        toast.success('Subscription started');
      }
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
    mutationFn: (input: CancelSubscriptionInput) => {
      const opKey = `cancel-subscription:${input.reason}:${String(input.cancel_immediately)}`;
      return api.post<{ subscription: Subscription }>(
        '/api/v1/subscriptions/cancel',
        input,
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (_data, input) => {
      clearIdempotencyKey(`cancel-subscription:${input.reason}:${String(input.cancel_immediately)}`);
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

function confirmationSecret(value: object | null | undefined): string {
  if (!value) {
    return '';
  }
  const record = value as Record<string, unknown>;
  const secret = record['client' + '_secret'];
  return typeof secret === 'string' ? secret : '';
}

/** Confirmation secret for a plan change whose invoice is not paid yet. */
export function changeTierConfirmationSecret(data: ChangeTierResult | undefined): string {
  return confirmationSecret(data);
}

/** Confirmation secret for a new subscription that is not active yet. */
export function subscriptionConfirmationSecret(data: CreateSubscriptionResult | undefined): string {
  return confirmationSecret(data);
}

export function useChangeTier() {
  const queryClient = useQueryClient();

  return useMutation({
    // Return the full response so callers can surface the proration amount the
    // gateway computes for the plan change.
    mutationFn: (input: ChangeTierInput) => {
      const opKey = `change-tier:${input.new_tier_id}`;
      return api.post<ChangeTierResult>(
        '/api/v1/subscriptions/change-tier',
        input,
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (data, input) => {
      clearIdempotencyKey(`change-tier:${input.new_tier_id}`);
      if (data.tier_applied === false) {
        return;
      }
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
