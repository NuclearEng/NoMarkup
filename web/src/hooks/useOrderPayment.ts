'use client';

// useOrderPayment — obtains a fresh PaymentIntent client secret for a
// marketplace order that is still `pending_payment`.
//
// WHY THIS IS NEEDED (the auction-win case)
//   An auction winner is charged OFF-SESSION by services/payment
//   (ChargeListingWinner, driven by the auction-close cron). Off-session
//   charging fails in three ways the buyer must be able to recover from:
//
//     no card on file  → nothing to charge; buyer must save one first
//     hard decline     → buyer must present a different card
//     SCA / 3DS        → *cannot* be satisfied off-session, by design. The
//                        issuer requires the cardholder to be present. The
//                        buyer MUST return to the site and authenticate.
//
//   The third case is why a client-side pay surface is mandatory rather than
//   nice-to-have: no amount of backend retrying can complete an SCA payment.
//
// CONTRACT (gateway ListingOrdersHandler.PayOrder):
//   POST /api/v1/orders/{id}/pay
//     → 200 { client_secret, payment_intent_id, total_cents, amount_cents,
//             fee_cents, tax_cents, escrow_status, order_id }
//   Re-enters ChargeListingWinner, which is idempotent per order and re-reads
//   ClientSecret from Stripe (or the dev store) on retry so SCA / dismissed-
//   sheet recovery works.
//
//   Empty client_secret on a 200 is treated as failure by hasConfirmablePayment
//   and the gateway now fails closed with 503 instead of returning one. 404 /
//   405 / 501 still map to "not available yet" for older deploys.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, idempotencyHeader } from '@/lib/api';
import type { PaymentIntentEnvelope } from '@/lib/payment-outcome';

export interface OrderPaymentIntentResponse extends PaymentIntentEnvelope {
  order_id?: string;
}

/**
 * Maps a failure from the pay-retry endpoint to something a buyer can act on.
 * Exported for testing and so the order surface and any future surface stay
 * consistent.
 */
export function describeOrderPaymentFailure(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 404:
      case 405:
      case 501:
        return 'Paying for this order online is not available yet. Contact support with your order number and we will take payment.';
      case 402:
        return err.userMessage(
          'Your card was declined. Add a different payment method and try again.',
        );
      case 409:
        return err.userMessage(
          'This order is no longer awaiting payment. Refresh to see its current status.',
        );
      case 403:
        return 'Only the buyer on this order can pay for it.';
      case 503:
        return 'Payments are temporarily unavailable. Please try again in a few minutes.';
      default:
        return err.userMessage('We could not start the payment. Please try again.');
    }
  }
  return 'We could not start the payment. Please try again.';
}

/**
 * Starts (or resumes) payment for a `pending_payment` listing order.
 *
 * Deliberately toast-free: the calling surface renders the failure inline and
 * the success path hands straight to Stripe Elements, so a toast would either
 * duplicate or pre-empt the real outcome.
 */
export function useOrderPaymentIntent(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<OrderPaymentIntentResponse>(
        `/api/v1/orders/${orderId}/pay`,
        undefined,
        // Money mutation: never let a double-tap mint a second PaymentIntent.
        idempotencyHeader(),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
    },
  });
}
