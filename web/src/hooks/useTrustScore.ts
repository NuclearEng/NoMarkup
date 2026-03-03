import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  TierRequirementsResponse,
  TrustScore,
  TrustScoreHistoryResponse,
} from '@/types';

export function useTrustScore(userId: string) {
  return useQuery({
    queryKey: ['trust-score', userId],
    queryFn: () =>
      api.get<{ score: TrustScore }>(`/api/v1/users/${userId}/trust-score`),
    enabled: !!userId,
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
    queryFn: () => api.get<TrustScoreHistoryResponse>(path),
    enabled: !!userId,
  });
}

export function useTierRequirements() {
  return useQuery({
    queryKey: ['tier-requirements'],
    queryFn: () => api.get<TierRequirementsResponse>('/api/v1/trust/tiers'),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours — tier requirements rarely change
  });
}
