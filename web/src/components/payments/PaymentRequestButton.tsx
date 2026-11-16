'use client';

import {
  PaymentRequestButtonElement,
  useStripe,
} from '@stripe/react-stripe-js';
import type { PaymentRequest, PaymentRequestPaymentMethodEvent } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';

/**
 * PaymentRequestButton — wallet checkout (Apple Pay / Google Pay /
 * browser-saved cards) backed by Stripe's PaymentRequest API.
 *
 * Stripe automatically resolves to whichever wallet the visitor's
 * browser supports (Apple Pay on Safari iOS/macOS with a verified
 * merchant ID, Google Pay on Chrome with a saved card). When neither
 * wallet is available, `canMakePayment()` resolves to a falsy value and
 * the component renders nothing — callers should keep their card-form
 * fallback visible.
 *
 * The button is intentionally read-only with respect to Stripe state:
 * the parent owns the `amountCents` (e.g. the bid amount or the
 * buy-now price) and the success callback is invoked only after Stripe
 * acknowledges the wallet payment-method event. Final settlement is the
 * caller's responsibility — typically posting the resulting
 * paymentMethod.id to the gateway's bid/buy-now endpoint, which creates
 * the underlying PaymentIntent server-side.
 *
 * Apple Pay specifically requires a one-time domain-association cert at
 * /.well-known/apple-developer-merchantid-domain-association. Without
 * that, Apple Pay falls back gracefully (Google Pay or browser cards
 * still render). See web/public/.well-known/... for the placeholder.
 */
export interface PaymentRequestButtonProps {
  /** Total in cents to charge the wallet. Owned by the parent. */
  amountCents: number;
  /** Country code for the merchant (defaults to US). */
  country?: string;
  /** ISO 4217 currency code (defaults to usd). */
  currency?: string;
  /** Display label shown in the wallet sheet. */
  label?: string;
  /**
   * Invoked when the wallet successfully resolves a payment method.
   * Implementations should hand the paymentMethod.id to the gateway and
   * call event.complete('success' | 'fail' | 'invalid_payer_*') so the
   * sheet dismisses. The event itself is forwarded so callers can
   * decide their own completion semantics (in particular, success must
   * be reported AFTER server confirmation, not optimistically).
   */
  onPaymentMethod: (event: PaymentRequestPaymentMethodEvent) => void;
}

export function PaymentRequestButton({
  amountCents,
  country = 'US',
  currency = 'usd',
  label = 'NoMarkup',
  onPaymentMethod,
}: PaymentRequestButtonProps) {
  const stripe = useStripe();
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);

  useEffect(() => {
    if (!stripe || amountCents <= 0) {
      setPaymentRequest(null);
      return;
    }
    const pr = stripe.paymentRequest({
      country,
      currency,
      total: { label, amount: amountCents },
      requestPayerName: true,
      requestPayerEmail: true,
    });
    let cancelled = false;
    pr.canMakePayment()
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setPaymentRequest(pr);
        } else {
          setPaymentRequest(null);
        }
      })
      .catch(() => {
        if (!cancelled) setPaymentRequest(null);
      });
    pr.on('paymentmethod', onPaymentMethod);
    return () => {
      cancelled = true;
      // Stripe's PaymentRequest doesn't expose an explicit teardown for
      // the listener; the Promise short-circuit above is the only thing
      // we need to undo on amount/currency change.
    };
  }, [stripe, amountCents, country, currency, label, onPaymentMethod]);

  if (!paymentRequest) {
    return null;
  }

  return (
    <div data-testid="payment-request-wrapper" className="w-full">
      <PaymentRequestButtonElement
        options={{
          paymentRequest,
          style: {
            paymentRequestButton: {
              type: 'default',
              theme: 'dark',
              height: '44px',
            },
          },
        }}
      />
    </div>
  );
}
