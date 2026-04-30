'use client';

// Wave 5 — paid promotion hooks. Wraps the
// `POST /api/v1/listings/{id}/promote` and
// `POST /api/v1/listings/{id}/promote/confirm` endpoints.
//
// The promotion flow is two-step:
//   1. POST /promote → SetupIntent client_secret + charge_id (pending)
//   2. (Stripe Elements confirms client-side)
//   3. POST /promote/confirm → flips charge to 'succeeded' AND
//      listings.is_promoted=true / promoted_until = now() + duration.
//
// In production the webhook handler does step 3 from charge.success.
// Dev/sandbox stacks without a webhook plumb call /confirm directly.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type {
  ConfirmPromotionResponse,
  PromoteListingInput,
  PromoteListingResponse,
} from '@/types';

export function useCreatePromotion(listingId: string) {
  return useMutation<PromoteListingResponse, Error, PromoteListingInput>({
    mutationFn: (input) =>
      api.post<PromoteListingResponse>(`/api/v1/listings/${listingId}/promote`, input),
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.userMessage('Could not start promotion'));
        return;
      }
      toast.error('Could not start promotion');
    },
  });
}

export function useConfirmPromotion(listingId: string) {
  const qc = useQueryClient();
  return useMutation<ConfirmPromotionResponse, Error, { charge_id: string }>({
    mutationFn: (input) =>
      api.post<ConfirmPromotionResponse>(
        `/api/v1/listings/${listingId}/promote/confirm`,
        input,
      ),
    onSuccess: () => {
      // Invalidate listing/marketplace caches so the promoted pill
      // appears without a hard refresh.
      void qc.invalidateQueries({ queryKey: ['listing', listingId] });
      void qc.invalidateQueries({ queryKey: ['listings'] });
      void qc.invalidateQueries({ queryKey: ['my-listings'] });
      toast.success('Listing promoted');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.userMessage('Could not finalize promotion'));
        return;
      }
      toast.error('Could not finalize promotion');
    },
  });
}
