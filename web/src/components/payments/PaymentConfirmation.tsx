'use client';

// PaymentConfirmation — the reusable "you owe money, here is how to pay it"
// surface. Every path that receives a PaymentIntent `client_secret` from the
// gateway (buy-now, offer-accept, order pay-retry) renders this and nothing
// else.
//
// It owns the three decisions that must happen BEFORE Stripe Elements mounts,
// because mounting Elements with a bad secret throws an uncatchable
// IntegrationError and leaves a dead iframe:
//
//   1. dev sentinel secret  → explain, don't pretend the payment happened
//   2. unconfirmable secret → explain, don't mount Elements
//   3. no publishable key   → StripeNotConfigured (existing house component)
//
// Only in the remaining case does it lazy-load the Elements island. That
// import boundary is the reason Stripe stays out of the shared First Load
// chunk: `next/dynamic` puts `StripePaymentForm` (and both @stripe packages)
// in its own chunk fetched on demand.

import dynamic from 'next/dynamic';
import { AlertTriangle } from 'lucide-react';

import { StripeNotConfigured } from '@/components/payments/StripeNotConfigured';
import { Skeleton } from '@/components/ui/skeleton';
import {
  isConfirmablePaymentSecret,
  isDevClientSecret,
  type PaymentOutcome,
} from '@/lib/payment-outcome';
import { isStripeConfigured } from '@/lib/stripe';
import { cn } from '@/lib/utils';

const StripePaymentForm = dynamic(
  () => import('@/components/payments/StripePaymentForm'),
  {
    // Stripe.js cannot render on the server, and keeping it client-only means
    // the chunk is never part of any RSC payload either.
    ssr: false,
    loading: () => <PaymentFormSkeleton />,
  },
);

/** Skeleton, not a spinner — house rule (CLAUDE.md §4). */
function PaymentFormSkeleton() {
  return (
    <div className="space-y-3" data-testid="payment-form-skeleton">
      <Skeleton className="h-4 w-28" variant="text" />
      <Skeleton className="h-24 w-full" variant="card" />
      <Skeleton className="h-11 w-full" />
      <span className="sr-only" role="status">
        Loading secure payment form
      </span>
    </div>
  );
}

function PaymentUnavailable({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-trust-medium/30 bg-trust-medium/10 p-4 text-sm text-foreground"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-trust-medium"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-medium">This payment can&apos;t be completed here</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export interface PaymentConfirmationProps {
  /** The `client_secret` the gateway returned. */
  clientSecret: string;
  /** Button text, e.g. "Pay $42.00". */
  submitLabel: string;
  /** App-relative path Stripe returns the buyer to after a redirect method. */
  returnPath: string;
  /** Fired for every terminal outcome — success, SCA, decline, error. */
  onOutcome: (outcome: PaymentOutcome) => void;
  /** Fired when a confirmation attempt starts (hosts lock themselves). */
  onSubmitStart?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function PaymentConfirmation({
  clientSecret,
  submitLabel,
  returnPath,
  onOutcome,
  onSubmitStart,
  onCancel,
  className,
}: PaymentConfirmationProps) {
  // Dev stacks run without Stripe keys and hand back a `dev_…` sentinel. We
  // deliberately do NOT offer a "mark as paid" button here: there is no
  // dev-confirm endpoint for listing orders, so faking success would put the
  // UI back in the exact lie this whole feature exists to remove.
  if (isDevClientSecret(clientSecret)) {
    return (
      <div className={className}>
        <PaymentUnavailable message="This environment is running without Stripe keys, so the charge cannot be authorized. The order stays unpaid until payments are configured." />
      </div>
    );
  }

  if (!isConfirmablePaymentSecret(clientSecret)) {
    return (
      <div className={className}>
        <PaymentUnavailable message="We couldn't start a secure checkout for this order. Refresh and try again — if it keeps happening, contact support and quote your order number." />
      </div>
    );
  }

  if (!isStripeConfigured()) {
    return (
      <div className={className}>
        <StripeNotConfigured message="Completing this payment needs card processing, which isn't set up in this environment yet." />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <StripePaymentForm
        clientSecret={clientSecret}
        returnPath={returnPath}
        submitLabel={submitLabel}
        onOutcome={onOutcome}
        onSubmitStart={onSubmitStart}
        onCancel={onCancel}
      />
    </div>
  );
}
