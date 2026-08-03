'use client';

// Wave 5 — paid promotion hooks. Wraps the
// `POST /api/v1/listings/{id}/promote` and
// `POST /api/v1/listings/{id}/promote/confirm` endpoints.
//
// The promotion flow is two-step:
//   1. POST /promote → SetupIntent client_secret + charge_id (pending)
//   2. (Stripe Elements confirms client-side via confirmSetup)
//   3. POST /promote/confirm → charges the server-side tier price and
//      only then flips listings.is_promoted=true / promoted_until.
//
// Never trust a client-side "promoted" flag — the gateway fails closed
// until ChargePromotion succeeds (see promoted_listings.go).
//
// Both mutations send sticky Idempotency-Key headers (MON-06/22), matching
// the bid-bond pattern. Retries of the same logical operation reuse the key.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api, clearIdempotencyKey, idempotencyHeader } from '@/lib/api';
import type {
  ConfirmPromotionResponse,
  PromoteListingInput,
  PromoteListingResponse,
} from '@/types';

export function useCreatePromotion(listingId: string) {
  return useMutation<PromoteListingResponse, Error, PromoteListingInput>({
    mutationFn: (input) => {
      // Gateway RequireIdempotencyKey on POST /listings/{id}/promote (MON-06/22).
      const opKey = `promote:${listingId}:${String(input.duration_hours)}`;
      return api.post<PromoteListingResponse>(
        `/api/v1/listings/${listingId}/promote`,
        input,
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (_data, variables) => {
      clearIdempotencyKey(`promote:${listingId}:${String(variables.duration_hours)}`);
    },
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
    mutationFn: (input) => {
      // Gateway RequireIdempotencyKey on POST /listings/{id}/promote/confirm.
      const opKey = `promote-confirm:${listingId}:${input.charge_id}`;
      return api.post<ConfirmPromotionResponse>(
        `/api/v1/listings/${listingId}/promote/confirm`,
        input,
        idempotencyHeader(opKey),
      );
    },
    onSuccess: (_data, variables) => {
      clearIdempotencyKey(`promote-confirm:${listingId}:${variables.charge_id}`);
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
