// Best-Offer / counter-offer chain — buyer + seller hooks.
//
// Pairs with the gateway handler at gateway/internal/handler/offers.go.
// Buyers create + withdraw their own offers; sellers list, accept,
// reject, and counter every offer on their listing.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { Offer, OffersResponse } from '@/types';

function explainOfferFailure(fallback: string): (err: unknown) => void {
  return (err: unknown) => {
    if (err instanceof ApiError) {
      toast.error(err.userMessage(fallback));
      return;
    }
    toast.error(fallback);
  };
}

/**
 * List every offer visible to the caller for a given listing. Sellers
 * see all offers; buyers see only their own (gateway enforces). Returns
 * the offers ordered newest-first.
 */
export function useListingOffers(listingId: string) {
  return useQuery<OffersResponse>({
    queryKey: ['offers', 'listing', listingId],
    queryFn: () => api.get<OffersResponse>(`/api/v1/listings/${listingId}/offers`),
    enabled: !!listingId,
    staleTime: 30_000,
  });
}

export interface CreateOfferInput {
  amount_cents: number;
  message?: string;
}

/**
 * Buyer flow — submit a new Best-Offer. The server validates that the
 * listing is active and that the buyer is not the seller; offers expire
 * after 24h if the seller hasn't acted.
 */
export function useCreateOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOfferInput) =>
      api.post<{ offer: Offer }>(`/api/v1/listings/${listingId}/offers`, {
        amount_cents: input.amount_cents,
        message: input.message ?? '',
      }),
    onSuccess: () => {
      toast.success('Offer sent — the seller has 24 hours to respond');
      void qc.invalidateQueries({ queryKey: ['offers', 'listing', listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
    },
    onError: explainOfferFailure('Failed to send offer'),
  });
}

export type OfferAction = 'accept' | 'reject' | 'counter' | 'withdraw';

export interface UpdateOfferInput {
  offerId: string;
  action: OfferAction;
  counter_amount_cents?: number;
  message?: string;
}

/**
 * Universal PATCH for the four offer-state transitions. The gateway
 * authorizes per-action: seller-only for accept/reject/counter,
 * buyer-only for withdraw. Accept additionally flips the listing to
 * 'sold' and mints a listing_orders row in the same transaction.
 */
export function useUpdateOffer(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      offerId,
      action,
      counter_amount_cents,
      message,
    }: UpdateOfferInput) =>
      api.patch<{ offer: Offer | null; order_id?: string; parent_offer?: Offer | null }>(
        `/api/v1/offers/${offerId}`,
        {
          action,
          counter_amount_cents: counter_amount_cents ?? 0,
          message: message ?? '',
        },
      ),
    onSuccess: (_data, variables) => {
      switch (variables.action) {
        case 'accept':
          toast.success('Offer accepted — order created');
          break;
        case 'reject':
          toast.success('Offer rejected');
          break;
        case 'counter':
          toast.success('Counter-offer sent');
          break;
        case 'withdraw':
          toast.success('Offer withdrawn');
          break;
      }
      void qc.invalidateQueries({ queryKey: ['offers', 'listing', listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
    },
    onError: explainOfferFailure('Failed to update offer'),
  });
}
