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
  response_time_label?: string;
  /** Whether the authenticated caller already follows this seller. */
  is_following?: boolean;
  /** Live follower count for social proof. */
  follower_count?: number;
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
      api.getPublic<SearchProvidersResponse>(`/api/v1/providers/search${query ? `?${query}` : ''}`),
  });
}

export function usePublicProviderProfile(
  id: string,
  options?: { initialData?: PublicProvider },
) {
  return useQuery({
    queryKey: ['provider', id],
    // Gateway returns the provider at the top level (with response_time_label
    // merged in), not wrapped in { profile }.
    queryFn: async () => {
      const raw = await api.getPublic<Record<string, unknown>>(`/api/v1/providers/${id}`);
      return raw as unknown as PublicProvider;
    },
    enabled: !!id,
    // Optional server-seeded profile (the RSC page passes its fetch result) so
    // SSR + client first paint render the same data — no skeleton, no refetch
    // flash. Mirrors useListing / the marketplace detail pattern.
    ...(options?.initialData ? { initialData: options.initialData } : {}),
  });
}
