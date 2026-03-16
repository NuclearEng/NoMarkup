import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api';
import type { AdvancesResponse, WorkingCapitalAdvance } from '@/types';

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

export function useRequestAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { contract_id: string; advance_amount_cents: number }) =>
      api
        .post<{ advance: WorkingCapitalAdvance }>('/api/v1/providers/me/advances', variables)
        .then((res) => res.advance),
    onSuccess: () => {
      toast.success('Advance request submitted');
      void queryClient.invalidateQueries({ queryKey: ['my-advances'] });
    },
    onError: () => {
      toast.error('Failed to request advance');
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
      approved: boolean;
      rejection_reason?: string;
    }) =>
      api.post<{ advance: WorkingCapitalAdvance }>(
        `/api/v1/admin/advances/${variables.advanceId}/review`,
        {
          approved: variables.approved,
          rejection_reason: variables.rejection_reason,
        },
      ),
    onSuccess: () => {
      toast.success('Advance reviewed');
      void queryClient.invalidateQueries({ queryKey: ['admin-advances'] });
    },
    onError: () => {
      toast.error('Failed to review advance');
    },
  });
}
