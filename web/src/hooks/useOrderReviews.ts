import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';
import type {
  CreateListingOrderReviewInput,
  ListingOrderReview,
  ListingOrderReviewEligibility,
  ListingOrderReviewsResponse,
} from '@/types';

export function useListingOrderReviewEligibility(orderId: string, enabled = true) {
  return useQuery({
    queryKey: ['listingOrderReviewEligibility', orderId],
    queryFn: () =>
      api.get<ListingOrderReviewEligibility>(
        `/api/v1/orders/${orderId}/reviews/eligibility`,
      ),
    enabled: !!orderId && enabled,
  });
}

export function useListingOrderReviews(orderId: string, enabled = true) {
  return useQuery({
    queryKey: ['listingOrderReviews', orderId],
    queryFn: () =>
      api
        .get<ListingOrderReviewsResponse>(`/api/v1/orders/${orderId}/reviews`)
        .then((res) => res.reviews ?? []),
    enabled: !!orderId && enabled,
  });
}

export function useCreateListingOrderReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      orderId: string;
      input: CreateListingOrderReviewInput;
    }) => {
      return api.post<ListingOrderReview>(
        `/api/v1/orders/${variables.orderId}/reviews`,
        variables.input,
      );
    },
    onSuccess: (_data, variables) => {
      toast.success('Review submitted');
      void queryClient.invalidateQueries({
        queryKey: ['listingOrderReviewEligibility', variables.orderId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['listingOrderReviews', variables.orderId],
      });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to submit review'));
    },
  });
}
