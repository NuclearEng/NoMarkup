'use client';

// StripePaymentForm — the Stripe Elements island that actually confirms a
// PaymentIntent. This is the ONLY module in the app that imports
// `@stripe/react-stripe-js` for a *payment* (as opposed to a SetupIntent),
// which is what lets `PaymentConfirmation` lazy-load it and keep Stripe out
// of the shared First Load bundle (CLAUDE.md §8 / §14).
//
// It is deliberately dumb: it collects a payment method, calls
// `stripe.confirmPayment`, and reports the interpreted outcome upward. It
// does not know about orders, offers, or escrow.
//
// SCA / 3DS: `redirect: 'if_required'` lets Stripe run the 3DS challenge in a
// modal for card methods and only navigate away for redirect-based methods
// (iDEAL, Bancontact…). `return_url` is therefore still mandatory — Stripe
// rejects the call without it whenever a redirect method is selectable.
//
// PCI: no raw card data ever touches this component. Every input lives inside
// Stripe's cross-origin iframe.

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { type SyntheticEvent, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  describePaymentResult,
  outcomeTone,
  type PaymentOutcome,
} from '@/lib/payment-outcome';
import { getStripe } from '@/lib/stripe';
import { cn } from '@/lib/utils';

export interface StripePaymentFormProps {
  /** A real `pi_…_secret_…` PaymentIntent client secret. */
  clientSecret: string;
  /**
   * App-relative path Stripe returns the buyer to after a redirect-based
   * method (e.g. `/orders/abc`). Resolved against `window.location.origin` at
   * submit time — never at render — so this component stays SSR-safe.
   */
  returnPath: string;
  /** Call-to-action text, e.g. "Pay $42.00". */
  submitLabel: string;
  /** Fired for every terminal result — success, SCA, decline, error alike. */
  onOutcome: (outcome: PaymentOutcome) => void;
  /**
   * Fired the moment a confirmation attempt starts. Lets a host (e.g. a
   * modal) lock itself so the buyer cannot dismiss a payment mid-flight and
   * be left unsure whether they were charged.
   */
  onSubmitStart?: () => void;
  /** Optional secondary action (usually "Cancel"). */
  onCancel?: () => void;
  className?: string;
}

const TONE_CLASSES: Record<ReturnType<typeof outcomeTone>, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
};

function ConfirmPaymentForm({
  returnPath,
  submitLabel,
  onOutcome,
  onSubmitStart,
  onCancel,
  className,
}: Omit<StripePaymentFormProps, 'clientSecret'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);

  const baseId = useId();
  const fieldsId = `${baseId}-fields`;
  const legendId = `${baseId}-legend`;
  const statusId = `${baseId}-status`;

  // Stripe.js is still downloading (or the publishable key resolved to null).
  // Keep the button disabled rather than letting a click no-op silently.
  const ready = stripe !== null && elements !== null;

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || isSubmitting) return;

    setIsSubmitting(true);
    setOutcome(null);
    onSubmitStart?.();

    // `elements.submit()` runs Stripe's own client-side validation first so a
    // missing/invalid field is reported inline in the iframe instead of
    // burning a confirmation attempt.
    const submitResult = await elements.submit();
    if (submitResult.error) {
      const next = describePaymentResult({ error: submitResult.error });
      setOutcome(next);
      setIsSubmitting(false);
      onOutcome(next);
      return;
    }

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${returnPath}`,
      },
      redirect: 'if_required',
    });

    const next = describePaymentResult(result);
    setOutcome(next);
    // Leave the button disabled on success so a double-tap cannot re-enter a
    // settled payment; re-enable for anything the buyer can retry.
    setIsSubmitting(next.settled);
    onOutcome(next);
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      noValidate
      aria-busy={isSubmitting}
      className={cn('space-y-4', className)}
      data-testid="stripe-payment-form"
    >
      <div
        role="group"
        aria-labelledby={legendId}
        aria-describedby={outcome && !outcome.settled ? statusId : undefined}
        id={fieldsId}
      >
        <p id={legendId} className="mb-2 text-sm font-medium text-foreground">
          Payment details
        </p>
        <PaymentElement />
      </div>

      {/* Single live region for every async payment result. Screen readers
          hear "succeeded", "your bank needs to verify…", and declines here —
          the visual state is never the only channel (WCAG 2.2 AA, §4). */}
      <div aria-live="polite" role="status">
        {outcome ? (
          <p
            id={statusId}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              TONE_CLASSES[outcomeTone(outcome.kind)],
            )}
          >
            {outcome.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="submit"
          className="min-h-[44px] w-full sm:flex-1"
          disabled={!ready || isSubmitting}
          aria-describedby={outcome ? statusId : undefined}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Confirming payment…
            </>
          ) : (
            submitLabel
          )}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Mounts Stripe Elements against `clientSecret` and renders the confirmation
 * form. Callers should use `PaymentConfirmation` instead of this component
 * directly — it handles the dev-sentinel, missing-key, and lazy-load cases
 * that must be decided *before* Elements mounts.
 */
export default function StripePaymentForm({
  clientSecret,
  ...rest
}: StripePaymentFormProps) {
  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { borderRadius: '0.5rem' },
        },
      }}
    >
      <ConfirmPaymentForm {...rest} />
    </Elements>
  );
}
