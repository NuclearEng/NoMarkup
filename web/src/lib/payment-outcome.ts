// payment-outcome.ts — the single place that turns a Stripe confirmation
// result into something the UI (and a screen reader) can state truthfully.
//
// WHY THIS EXISTS
//   Before this module the web app never called `stripe.confirmPayment` at
//   all: buy-now and offer-accept received a PaymentIntent `client_secret`
//   from the gateway and threw it away, then toasted "Purchased". Escrow was
//   never funded. Every surface that confirms a payment now routes its result
//   through `describePaymentResult` so "succeeded" means succeeded and
//   nothing else does.
//
// WHY IT IS PURE
//   No React, no Stripe runtime import (the Stripe types are `import type`,
//   erased at build time). That keeps the decision logic testable without a
//   browser, an iframe, or a Stripe account — and keeps it out of any bundle
//   chunk that does not already load Stripe.

import type { PaymentIntent, StripeError } from '@stripe/stripe-js';

/**
 * The outcomes a buyer can actually end up in. These are NOT the raw Stripe
 * PaymentIntent statuses — `requires_confirmation` / `requires_capture` are
 * folded into `processing` because from the buyer's point of view they mean
 * the same thing: money is committed, nothing more to do right now.
 */
export const PAYMENT_OUTCOME = {
  /** Money captured. Escrow is funded. This is the ONLY success. */
  SUCCEEDED: 'succeeded',
  /** Accepted by Stripe, still settling (ACH, some wallets). */
  PROCESSING: 'processing',
  /** Strong Customer Authentication (3DS) or a bank redirect is pending. */
  REQUIRES_ACTION: 'requires_action',
  /** Card was declined / no usable method. The buyer must supply another. */
  REQUIRES_PAYMENT_METHOD: 'requires_payment_method',
  /** The intent was cancelled server-side or by Stripe. */
  CANCELED: 'canceled',
  /** Stripe returned an error, or we could not interpret the result. */
  ERROR: 'error',
} as const;

export type PaymentOutcomeKind =
  (typeof PAYMENT_OUTCOME)[keyof typeof PAYMENT_OUTCOME];

export interface PaymentOutcome {
  kind: PaymentOutcomeKind;
  /**
   * True only for `succeeded`. Callers gate "your order is paid" UI, cache
   * invalidation, and navigation on this — never on "the promise resolved".
   */
  settled: boolean;
  /**
   * True when re-submitting the same form can plausibly work (decline,
   * abandoned 3DS, transient Stripe error). False for canceled/succeeded.
   */
  retryable: boolean;
  /** Message written for the buyer. Safe to render and to announce. */
  message: string;
  /** Present whenever Stripe told us which intent this was. */
  paymentIntentId: string | null;
}

/** Tone token for the status region. Maps to semantic Tailwind classes. */
export type PaymentOutcomeTone = 'success' | 'pending' | 'danger';

export function outcomeTone(kind: PaymentOutcomeKind): PaymentOutcomeTone {
  switch (kind) {
    case PAYMENT_OUTCOME.SUCCEEDED:
      return 'success';
    case PAYMENT_OUTCOME.PROCESSING:
    case PAYMENT_OUTCOME.REQUIRES_ACTION:
      return 'pending';
    default:
      return 'danger';
  }
}

function outcome(
  kind: PaymentOutcomeKind,
  message: string,
  paymentIntentId: string | null,
  retryable: boolean,
): PaymentOutcome {
  return {
    kind,
    settled: kind === PAYMENT_OUTCOME.SUCCEEDED,
    retryable,
    message,
    paymentIntentId,
  };
}

/**
 * Turns a `StripeError` into a buyer-facing outcome.
 *
 * Stripe splits errors into ones that are safe to show verbatim
 * (`card_error`, `validation_error` — "Your card was declined.") and ones
 * that are internal (`api_error`, `invalid_request_error` — these leak
 * integration detail and must not reach a buyer, per CLAUDE.md §9). We show
 * Stripe's own copy only for the first group.
 */
export function describeStripeError(error: StripeError): PaymentOutcome {
  const intentId = error.payment_intent?.id ?? null;
  const showable = error.type === 'card_error' || error.type === 'validation_error';
  const message =
    showable && error.message
      ? error.message
      : 'We could not complete this payment. No money has been taken — please try again.';

  // A declined card leaves the intent in requires_payment_method; surfacing
  // that (rather than a generic error) is what lets the UI say "try a
  // different card" instead of "something went wrong".
  const declined = error.type === 'card_error';
  return outcome(
    declined
      ? PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD
      : PAYMENT_OUTCOME.ERROR,
    message,
    intentId,
    true,
  );
}

/**
 * Structural input for {@link describePaymentResult}.
 *
 * Deliberately looser than the SDK's `PaymentIntentResult` discriminated
 * union (which guarantees `paymentIntent` whenever `error` is absent). This
 * value crosses an origin boundary out of Stripe's iframe, so "neither field
 * is present" must be a handled outcome rather than an unchecked property
 * read. `PaymentIntentResult` and `elements.submit()`'s result are both
 * assignable to it, so callers keep full type safety.
 */
export interface ConfirmPaymentResultLike {
  paymentIntent?: PaymentIntent;
  error?: StripeError;
}

/**
 * Interprets the resolved value of `stripe.confirmPayment({ redirect:
 * 'if_required' })` (or `stripe.retrievePaymentIntent` after a redirect
 * return).
 *
 * Note the SCA case: `requires_action` here means the buyer dismissed or did
 * not finish the 3DS challenge. It is recoverable ONLY in the browser — an
 * off-session retry can never satisfy SCA, which is exactly why the order
 * page needs a "finish paying" surface.
 */
export function describePaymentResult(
  result: ConfirmPaymentResultLike,
): PaymentOutcome {
  if (result.error) {
    return describeStripeError(result.error);
  }

  const intent = result.paymentIntent;
  if (!intent) {
    return outcome(
      PAYMENT_OUTCOME.ERROR,
      'We could not confirm the payment status. Check your order before paying again.',
      null,
      true,
    );
  }

  switch (intent.status) {
    case 'succeeded':
      return outcome(
        PAYMENT_OUTCOME.SUCCEEDED,
        'Payment complete. Funds are held in escrow until you confirm pickup.',
        intent.id,
        false,
      );
    case 'processing':
    case 'requires_confirmation':
    case 'requires_capture':
      return outcome(
        PAYMENT_OUTCOME.PROCESSING,
        'Payment is processing. We will update your order as soon as it settles — no further action needed.',
        intent.id,
        false,
      );
    case 'requires_action':
      return outcome(
        PAYMENT_OUTCOME.REQUIRES_ACTION,
        'Your bank needs to verify this payment. Finish the verification step to complete your purchase.',
        intent.id,
        true,
      );
    case 'requires_payment_method':
      return outcome(
        PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD,
        'That payment method was declined. Try a different card to complete your purchase.',
        intent.id,
        true,
      );
    case 'canceled':
      return outcome(
        PAYMENT_OUTCOME.CANCELED,
        'This payment was cancelled. Nothing was charged.',
        intent.id,
        false,
      );
    default:
      return outcome(
        PAYMENT_OUTCOME.ERROR,
        'We could not confirm the payment status. Check your order before paying again.',
        intent.id,
        true,
      );
  }
}

// ── client_secret shape guards ─────────────────────────────────────────────
//
// The gateway hands back three different things depending on how the stack is
// configured, and Stripe Elements crashes ("IntegrationError") on two of them:
//
//   "pi_3Abc…_secret_XYZ"  real PaymentIntent secret     → confirmable
//   "dev_seti_<uuid>"      dev sentinel, no Stripe keys  → dev fallback
//   ""                     payment service not wired     → not confirmable
//
// Callers must branch on these BEFORE mounting <Elements>.

/** Dev-stack sentinel emitted by services/payment when Stripe is unconfigured. */
export function isDevClientSecret(clientSecret: string): boolean {
  return clientSecret.startsWith('dev_');
}

/**
 * Whether this string is a PaymentIntent client secret Stripe.js can confirm.
 * Deliberately strict: anything else gets an explanatory notice instead of a
 * broken iframe.
 */
export function isConfirmablePaymentSecret(clientSecret: string): boolean {
  return /^pi_[^_\s]+_secret_[^\s]+$/.test(clientSecret);
}

/**
 * Response fragment shared by every gateway endpoint that mints a listing
 * PaymentIntent (buy-now, offer-accept, and the order pay retry). Keeping one
 * type means a new money endpoint cannot silently omit the secret again.
 */
export interface PaymentIntentEnvelope {
  /** Stripe PaymentIntent client secret. Absent when the charge could not start. */
  client_secret?: string;
  payment_intent_id?: string;
  /**
   * Amount actually being charged (item + platform fee + sales tax), in cents.
   * Forwarded from ChargeListingWinner on buy-now, offer-accept (when the
   * acceptor is the buyer), and POST /orders/{id}/pay. Optional so older
   * responses without the field still degrade to a "Pay now" label rather than
   * showing the item price as if it were the total.
   */
  total_cents?: number;
  /** Gateway says the buyer still owes money — escrow is NOT funded. */
  payment_required?: boolean;
  /** Set when the gateway could not reach the payment service at all. */
  charge_error?: string;
  escrow_status?: string;
}

/**
 * True when the response carries a secret we can actually confirm in the
 * browser. Guards every "open the payment sheet" branch.
 */
export function hasConfirmablePayment(
  envelope: PaymentIntentEnvelope,
): envelope is PaymentIntentEnvelope & { client_secret: string } {
  const secret = envelope.client_secret;
  return (
    typeof secret === 'string' &&
    secret.length > 0 &&
    (isConfirmablePaymentSecret(secret) || isDevClientSecret(secret))
  );
}
