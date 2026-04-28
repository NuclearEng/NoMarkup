import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { Listing } from '@/types';

/**
 * Response shape from POST /api/v1/listings/{id}/buy-now.
 * Mirrors gateway/internal/handler/listings_bid.go::BuyItNow.
 */
export interface BuyNowResponse {
  order_id: string;
  listing: Listing | null;
}

/**
 * useBuyNow — fixed-price closeout. Skips the auction entirely; on success
 * the listing flips to status='sold' and a `listing_orders` row is created
 * in escrow_status='held'. The pickup-confirmation flow takes over from
 * there.
 *
 * Lives in its own file (rather than useListings.ts) to keep merge-blast
 * radius small while the marketplace surface evolves in parallel waves.
 */
export function useBuyNow(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<BuyNowResponse>(`/api/v1/listings/${listingId}/buy-now`),
    onSuccess: () => {
      toast.success('Purchased — review pickup details now');
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
      void qc.invalidateQueries({ queryKey: ['listings', 'search'] });
      void qc.invalidateQueries({ queryKey: ['listingBids', 'mine'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.userMessage('Failed to complete purchase'));
        return;
      }
      toast.error('Failed to complete purchase');
    },
  });
}
