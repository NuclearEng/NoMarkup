'use client';

// Bid bond Stripe Elements flow. Rendered inline by ListingBidPanel when
// the place-bid mutation returns 402 with a `requires_bid_bond` envelope.
//
// Flow:
//   1. Parent calls /listings/{id}/bid-bond → SetupIntent client_secret + bond_id
//   2. Stripe Elements collects payment method (PaymentElement)
//   3. Submit → stripe.confirmSetup(elements) — Stripe authorizes the card
//   4. POST /listings/{id}/bid-bond/confirm → flips 'pending'→'authorized'
//   5. onAuthorized → parent retries the bid
//
// Dev fallback: when the gateway returns a sentinel client_secret starting
// with `dev_bond_seti_`, we skip Stripe entirely and call /confirm
// directly (matches the dev fallback in payment.go).

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { StripeNotConfigured } from '@/components/payments/StripeNotConfigured';
import { useConfirmBidBond, useCreateBidBond } from '@/hooks/useCompliance';
import { getStripe, isStripeConfigured } from '@/lib/stripe';

interface BidBondPromptProps {
  listingId: string;
  intendedBidCents: number;
  onAuthorized: () => void;
}

export function BidBondPrompt({
  listingId,
  intendedBidCents,
  onAuthorized,
}: BidBondPromptProps) {
  const create = useCreateBidBond();
  const confirm = useConfirmBidBond();
  const [bondState, setBondState] = useState<{
    bondId: string;
    clientSecret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mint the bond on mount. Only runs once per listing+intent — if the
  // user changes the bid amount the parent will dismiss this component
  // and re-mount it.
  useEffect(() => {
    if (bondState) return;
    if (create.isPending) return;
    create.mutate(
      { listingId, input: { intended_bid_cents: intendedBidCents } },
      {
        onSuccess: (data) => {
          setBondState({ bondId: data.bond_id, clientSecret: data.setup_intent_client_secret });
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to start bond');
        },
      },
    );
  }, [bondState, create, intendedBidCents, listingId]);

  if (!bondState) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-100/80" data-testid="bid-bond-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>Preparing bond…</span>
        {error ? (
          <span className="text-red-300" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  // Dev fallback: no Stripe keys configured → skip Elements entirely.
  if (bondState.clientSecret.startsWith('dev_bond_seti_')) {
    return (
      <DevBondConfirm
        listingId={listingId}
        bondId={bondState.bondId}
        onAuthorized={onAuthorized}
        confirmMutation={confirm}
      />
    );
  }

  // The backend issued a real Stripe SetupIntent but the browser has no
  // publishable key, so Elements can't render. Show an intuitive message
  // instead of crashing with "IntegrationError: empty string".
  if (!isStripeConfigured()) {
    return (
      <StripeNotConfigured message="Bid bonds need payment processing, which isn't set up yet. A Stripe account must be connected before you can post a bond. If you're the operator, set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY." />
    );
  }

  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret: bondState.clientSecret,
        appearance: { theme: 'stripe', variables: { borderRadius: '0.5rem' } },
      }}
    >
      <BondConfirm
        listingId={listingId}
        bondId={bondState.bondId}
        onAuthorized={onAuthorized}
        confirmMutation={confirm}
      />
    </Elements>
  );
}

interface BondConfirmProps {
  listingId: string;
  bondId: string;
  onAuthorized: () => void;
  confirmMutation: ReturnType<typeof useConfirmBidBond>;
}

function BondConfirm({ listingId, bondId, onAuthorized, confirmMutation }: BondConfirmProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: stripeErr } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (stripeErr) {
      setError(stripeErr.message ?? 'Card could not be authorized');
      setSubmitting(false);
      return;
    }

    confirmMutation.mutate(
      { listingId, bondId },
      {
        onSuccess: () => {
          onAuthorized();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Bond confirmation failed');
          setSubmitting(false);
        },
      },
    );
  }

  return (
    <div className="space-y-2" data-testid="bid-bond-elements-host">
      <PaymentElement />
      {error ? (
        <p className="text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        className="min-h-[44px] w-full"
        data-testid="bid-bond-authorize"
        disabled={!stripe || !elements || submitting}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Authorizing bond…
          </>
        ) : (
          'Authorize bond'
        )}
      </Button>
    </div>
  );
}

// DevBondConfirm short-circuits Stripe — used when the gateway returns a
// `dev_bond_seti_` sentinel because no Stripe keys are configured.
function DevBondConfirm({
  listingId,
  bondId,
  onAuthorized,
  confirmMutation,
}: BondConfirmProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    confirmMutation.mutate(
      { listingId, bondId },
      {
        onSuccess: () => {
          onAuthorized();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Bond confirmation failed');
          setSubmitting(false);
        },
      },
    );
  }

  return (
    <div className="space-y-2" data-testid="bid-bond-dev-host">
      <p className="text-amber-100/80">
        Dev mode — no Stripe keys configured. Click below to mark the bond
        authorized.
      </p>
      {error ? (
        <p className="text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        className="min-h-[44px] w-full"
        data-testid="bid-bond-dev-authorize"
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Authorizing…
          </>
        ) : (
          'Authorize (dev)'
        )}
      </Button>
    </div>
  );
}
