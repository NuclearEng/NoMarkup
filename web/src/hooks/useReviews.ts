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
    mutationFn: (variables: { contractId: string; input: CreateReviewInput }) =>
      api
        .post<{ review: Review }>(
          `/api/v1/contracts/${variables.contractId}/reviews`,
          variables.input,
        )
        .then((res) => res.review),
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
    queryFn: () => api.get<{ review: Review }>(`/api/v1/reviews/${id}`).then((res) => res.review),
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
    queryKey: ['reviews', userId, params?.direction, params?.page, params?.per_page],
    queryFn: () => api.get<ReviewsForUserResponse>(path),
    enabled: !!userId,
  });
}

export function useRespondToReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { reviewId: string; comment: string }) =>
      api
        .post<{ review: Review }>(`/api/v1/reviews/${variables.reviewId}/respond`, {
          comment: variables.comment,
        })
        .then((res) => res.review),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useFlagReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { reviewId: string; reason: string }) =>
      api
        .post<{ review: Review }>(`/api/v1/reviews/${variables.reviewId}/flag`, {
          reason: variables.reason,
        })
        .then((res) => res.review),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}
