import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { PaginationResponse, ReviewSummary, TrustScoreSummary } from '@/types';

export interface PublicProvider {
  id: string;
  user_id: string;
  display_name: string;
  business_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  service_categories: { id: string; name: string }[];
  trust_score: TrustScoreSummary | null;
  review_summary: ReviewSummary | null;
  jobs_completed: number;
  member_since: string;
  verified: boolean;
}

export interface SearchProvidersParams {
  query?: string;
  category_id?: string;
  min_rating?: number;
  trust_tier?: string;
  verified?: boolean;
  page?: number;
  page_size?: number;
}

interface SearchProvidersResponse {
  providers: PublicProvider[];
  pagination: PaginationResponse;
}

export function useSearchProviders(params: SearchProvidersParams) {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('query', params.query);
  if (params.category_id) searchParams.set('category_id', params.category_id);
  if (params.min_rating !== undefined) searchParams.set('min_rating', String(params.min_rating));
  if (params.trust_tier) searchParams.set('trust_tier', params.trust_tier);
  if (params.verified !== undefined) searchParams.set('verified', String(params.verified));
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.page_size !== undefined) searchParams.set('page_size', String(params.page_size));
  const query = searchParams.toString();

  return useQuery({
    queryKey: ['providers', params],
    queryFn: () =>
      api.get<SearchProvidersResponse>(
        `/api/v1/providers/search${query ? `?${query}` : ''}`,
      ),
  });
}

export function usePublicProviderProfile(id: string) {
  return useQuery({
    queryKey: ['provider', id],
    queryFn: () =>
      api
        .get<{ profile: PublicProvider }>(`/api/v1/providers/${id}`)
        .then((res) => res.profile),
    enabled: !!id,
  });
}
