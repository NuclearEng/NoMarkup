import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, clearIdempotencyKey, getApiErrorMessage, idempotencyHeader } from '@/lib/api';
import type { PaymentIntentEnvelope } from '@/lib/payment-outcome';
import type { Listing } from '@/types';

/**
 * Response shape from POST /api/v1/listings/{id}/buy-now.
 * Mirrors gateway/internal/handler/listings_bid.go::BuyItNow.
 *
 * The gateway creates the order in `escrow_status='pending_payment'` and then
 * calls ChargeListingWinner, which mints a PaymentIntent and returns its
 * `client_secret`. That secret used to be dropped on the floor here, so the
 * buyer was never asked to pay and escrow was never funded while the UI said
 * "Purchased". The envelope fields below are the money-critical part of the
 * response — treat `payment_required` as authoritative.
 */
export interface BuyNowResponse extends PaymentIntentEnvelope {
  order_id: string;
  listing: Listing | null;
}

/**
 * useBuyNow — fixed-price closeout. Skips the auction entirely; on success
 * the listing flips to status='sold' and a `listing_orders` row is created
 * in escrow_status='pending_payment'. The buyer must then complete the
 * PaymentIntent (see PaymentConfirmationDialog) before escrow is funded and
 * the pickup-confirmation flow can start.
 *
 * NOTE: this hook deliberately does NOT toast success. Creating the order is
 * not the same as paying for it, and the previous "Purchased — review pickup
 * details now" toast fired while the buyer still owed money. The caller
 * announces the real outcome after confirmation.
 *
 * Lives in its own file (rather than useListings.ts) to keep merge-blast
 * radius small while the marketplace surface evolves in parallel waves.
 */
export function useBuyNow(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<BuyNowResponse>(
        `/api/v1/listings/${listingId}/buy-now`,
        undefined,
        // MON-06/22: reuse one key per listing across double-tap / retries.
        idempotencyHeader(`buy-now:${listingId}`),
      ),
    onSuccess: () => {
      clearIdempotencyKey(`buy-now:${listingId}`);
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', 'search'] });
      void qc.invalidateQueries({ queryKey: ['listingBids', 'mine'] });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to complete purchase'));
    },
  });
}
