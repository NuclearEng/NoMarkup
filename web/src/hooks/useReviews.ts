import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CreateReviewInput,
  Review,
  ReviewEligibility,
  ReviewsForUserResponse,
} from '@/types';

export function useReviewEligibility(contractId: string) {
  return useQuery({
    queryKey: ['reviewEligibility', contractId],
    queryFn: () =>
      api.get<ReviewEligibility>(`/api/v1/contracts/${contractId}/reviews/eligibility`),
    enabled: !!contractId,
  });
}

export function useCreateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns the review at the top level, not wrapped in { review }.
    mutationFn: async (variables: { contractId: string; input: CreateReviewInput }) => {
      const raw = await api.post<Record<string, unknown>>(
        `/api/v1/contracts/${variables.contractId}/reviews`,
        variables.input,
      );
      return raw as unknown as Review;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['reviewEligibility', variables.contractId] });
      void queryClient.invalidateQueries({ queryKey: ['contract', variables.contractId] });
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useReview(id: string) {
  return useQuery({
    queryKey: ['review', id],
    queryFn: async () => {
      const raw = await api.get<Record<string, unknown>>(`/api/v1/reviews/${id}`);
      return raw as unknown as Review;
    },
    enabled: !!id,
  });
}

interface ReviewsForUserParams {
  direction?: string;
  page?: number;
  per_page?: number;
}

export function useReviewsForUser(userId: string, params?: ReviewsForUserParams) {
  const searchParams = new URLSearchParams();
  if (params?.direction) searchParams.set('direction', params.direction);
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.per_page !== undefined) searchParams.set('per_page', String(params.per_page));
  const query = searchParams.toString();
  const path = `/api/v1/users/${userId}/reviews${query ? `?${query}` : ''}`;

  return useQuery({
    // Public read: a logged-out visitor on the public provider profile
    // (/providers/{id}) reads reviews as social proof. Use getPublic so an
    // anonymous fetch never triggers the auth interceptor's 401 → clearTokens
    // → redirect-to-/login path that would bounce a visitor off a public page.
    // The gateway route is public; signed-in callers don't need a bearer here.
    queryKey: ['reviews', userId, params?.direction, params?.page, params?.per_page],
    queryFn: () => api.getPublic<ReviewsForUserResponse>(path),
    enabled: !!userId,
  });
}

export function useRespondToReview() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns the response object (not the review) flat. Callers only
    // use this to invalidate, so an unknown body is fine.
    mutationFn: (variables: { reviewId: string; comment: string }) =>
      api.post<Record<string, unknown>>(`/api/v1/reviews/${variables.reviewId}/respond`, {
        comment: variables.comment,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useFlagReview() {
  const queryClient = useQueryClient();

  return useMutation({
    // Gateway returns { flag_id }, not the review. Callers only invalidate.
    mutationFn: (variables: { reviewId: string; reason: string }) =>
      api.post<{ flag_id: string }>(`/api/v1/reviews/${variables.reviewId}/flag`, {
        reason: variables.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}
