import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, ApiError, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
import type { AdvancesResponse, CreditLimit, WorkingCapitalAdvance } from '@/types';

export function useMyAdvances() {
  return useQuery({
    queryKey: ['my-advances'],
    queryFn: async () => {
      try {
        return await api.get<AdvancesResponse>('/api/v1/providers/me/advances');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useCreditLimit() {
  return useQuery({
    queryKey: ['credit-limit'],
    // The gateway wraps the payload in { credit_limit: {...} } — unwrap it so
    // consumers read the fields directly (previously everything fell through
    // to client-side fallbacks because the wrapper had no matching keys).
    queryFn: async () => {
      const res = await api.get<{ credit_limit: CreditLimit }>(
        '/api/v1/providers/me/credit-limit',
      );
      return res.credit_limit;
    },
  });
}

export function useRequestAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { contract_id: string; advance_amount_cents: number }) =>
      api
        .post<{ advance: WorkingCapitalAdvance }>(
          '/api/v1/providers/me/advances',
          {
            contract_id: variables.contract_id,
            amount_cents: variables.advance_amount_cents,
          },
          idempotencyHeader(),
        )
        .then((res) => res.advance),
    onSuccess: () => {
      toast.success('Advance request submitted');
      void queryClient.invalidateQueries({ queryKey: ['my-advances'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-limit'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to request advance'));
    },
  });
}

export function useRepayAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    // POST /api/v1/providers/me/advances/{id}/repay with { amount_cents }.
    // The gateway requires an Idempotency-Key on this payment mutation — the
    // api client attaches it via idempotencyHeader() (do NOT also add one).
    mutationFn: (variables: { advanceId: string; amount_cents: number }) =>
      api
        .post<{ advance: WorkingCapitalAdvance }>(
          `/api/v1/providers/me/advances/${variables.advanceId}/repay`,
          { amount_cents: variables.amount_cents },
          idempotencyHeader(),
        )
        .then((res) => res.advance),
    onSuccess: () => {
      toast.success('Repayment applied');
      void queryClient.invalidateQueries({ queryKey: ['my-advances'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-limit'] });
    },
    onError: (err) => {
      // Surfaces the gateway's real reason, e.g. the 422
      // "Repayment amount exceeds the outstanding balance".
      toast.error(getApiErrorMessage(err, 'Failed to apply repayment'));
    },
  });
}

export function useAdminAdvances(params?: { status?: string; page?: number; page_size?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();
  const path = `/api/v1/admin/advances${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['admin-advances', params?.status, params?.page, params?.page_size],
    queryFn: () => api.get<AdvancesResponse>(path),
  });
}

export function useReviewAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      advanceId: string;
      action: 'approve' | 'reject';
      reason?: string;
    }) =>
      api.post<{ advance: WorkingCapitalAdvance }>(
        `/api/v1/admin/advances/${variables.advanceId}/review`,
        {
          action: variables.action,
          reason: variables.reason,
        },
      ),
    onSuccess: () => {
      toast.success('Advance reviewed');
      void queryClient.invalidateQueries({ queryKey: ['admin-advances'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to review advance'));
    },
  });
}

export function useDisburseAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (advanceId: string) =>
      api
        .post<{ advance: WorkingCapitalAdvance }>(
          `/api/v1/admin/advances/${advanceId}/disburse`,
        )
        .then((res) => res.advance),
    onSuccess: () => {
      toast.success('Advance disbursed successfully');
      void queryClient.invalidateQueries({ queryKey: ['admin-advances'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to disburse advance'));
    },
  });
}
