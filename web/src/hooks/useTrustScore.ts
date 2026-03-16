import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import type {
  TierRequirementsResponse,
  TrustScore,
  TrustScoreHistoryResponse,
} from '@/types';

export function useTrustScore(userId: string) {
  return useQuery({
    queryKey: ['trust-score', userId],
    queryFn: async () => {
      try {
        return await api.get<{ score: TrustScore }>(`/api/v1/users/${userId}/trust-score`);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    enabled: !!userId,
    retry: false,
  });
}

export function useTrustHistory(userId: string, page?: number, pageSize?: number) {
  const searchParams = new URLSearchParams();
  if (page !== undefined) searchParams.set('page', String(page));
  if (pageSize !== undefined) searchParams.set('page_size', String(pageSize));
  const query = searchParams.toString();
  const path = `/api/v1/users/${userId}/trust-history${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['trust-history', userId, page, pageSize],
    queryFn: async () => {
      try {
        return await api.get<TrustScoreHistoryResponse>(path);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    enabled: !!userId,
    retry: false,
  });
}

export function useTierRequirements() {
  return useQuery({
    queryKey: ['tier-requirements'],
    queryFn: async () => {
      try {
        return await api.get<TierRequirementsResponse>('/api/v1/trust/tiers');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 500)) return null;
        throw error;
      }
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
