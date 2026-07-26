// Best-Offer / counter-offer chain — buyer + seller hooks.
//
// Pairs with the gateway handler at gateway/internal/handler/offers.go.
// Buyers create + withdraw their own offers; sellers list, accept,
// reject, and counter every offer on their listing.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { PaymentIntentEnvelope } from '@/lib/payment-outcome';
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

/**
 * Compute, for every offer in a listing's offer set, who the offer is
 * currently *awaiting* — mirroring the gateway's depth-parity rule in
 * handler/offers.go::offerParticipantsForDepth.
 *
 * A counter-chain alternates authorship: the root (depth 0) is the
 * buyer's opening offer and awaits the SELLER; the seller's counter
 * (depth 1) awaits the BUYER; the buyer's counter (depth 2) awaits the
 * seller; and so on. So even depth → awaiting seller, odd depth →
 * awaiting buyer. The author is always the other participant.
 *
 * The API never returns `depth` directly, but every row carries
 * `parent_offer_id`, so we reconstruct depth by walking parents. Returns
 * a Map keyed by offer id. Orphaned parents (the buyer only sees their
 * own rows, but a seller counter shares their `buyer_id` so the buyer
 * sees the whole chain) fall back to depth 0.
 */
export type AwaitingParty = 'buyer' | 'seller';

export function computeOfferDepths(offers: Offer[]): Map<string, number> {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const depths = new Map<string, number>();
  const depthOf = (offer: Offer, seen: Set<string>): number => {
    const cached = depths.get(offer.id);
    if (cached !== undefined) return cached;
    if (!offer.parent_offer_id || seen.has(offer.id)) {
      depths.set(offer.id, 0);
      return 0;
    }
    const parent = byId.get(offer.parent_offer_id);
    if (!parent) {
      depths.set(offer.id, 0);
      return 0;
    }
    seen.add(offer.id);
    const d = depthOf(parent, seen) + 1;
    depths.set(offer.id, d);
    return d;
  };
  for (const o of offers) depthOf(o, new Set());
  return depths;
}

/** Which participant an offer currently awaits, from its chain depth. */
export function awaitingPartyForDepth(depth: number): AwaitingParty {
  return depth % 2 === 1 ? 'buyer' : 'seller';
}

export type OfferAction = 'accept' | 'reject' | 'counter' | 'withdraw';

export interface UpdateOfferInput {
  offerId: string;
  action: OfferAction;
  counter_amount_cents?: number;
  message?: string;
}

/**
 * Response to PATCH /api/v1/offers/{id}. On `accept` the gateway also mints a
 * `listing_orders` row in `pending_payment` and calls ChargeListingWinner,
 * returning the buyer's PaymentIntent `client_secret` in the envelope fields.
 *
 * WHO MAY USE THE SECRET — this is the subtle part. The gateway authorizes
 * accept/reject/counter on *whoever the offer currently awaits*, which
 * alternates down the counter chain:
 *
 *   even depth (buyer's proposal)  → awaits the SELLER  → seller accepts
 *   odd depth  (seller's counter)  → awaits the BUYER   → buyer accepts
 *
 * The PaymentIntent always belongs to the BUYER. So the secret is only
 * confirmable in the browser when the accepting party IS the buyer (the
 * counter-accept case). When a seller accepts, the same field comes back but
 * must be ignored — the seller cannot authenticate the buyer's card, and the
 * buyer settles later from the order page. `CounterOfferBanner` (seller) and
 * `BuyerOfferCard` (buyer) branch on exactly this.
 */
export interface UpdateOfferResponse extends PaymentIntentEnvelope {
  offer: Offer | null;
  order_id?: string;
  parent_offer?: Offer | null;
}

/**
 * Universal PATCH for the four offer-state transitions. The gateway
 * authorizes per-action on the awaiting participant (see above);
 * withdraw is reserved for the offer's author. Accept additionally flips the
 * listing to 'sold' and mints a listing_orders row in the same transaction.
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
      api.patch<UpdateOfferResponse>(
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
          // Deliberately not "purchased"/"paid": accept only creates the
          // order. Payment is confirmed separately and announced there.
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
