'use client';

// Paid listing promotion — seller-facing SetupIntent → confirm flow.
//
// Mirrors BidBondPrompt / bid-bond money path:
//   1. Seller picks a tier from the server-mirrored pricebook (PROMOTION_TIERS)
//   2. POST /listings/{id}/promote → charge_id + SetupIntent client_secret
//   3. Stripe Elements confirmSetup (or dev sentinel short-circuit)
//   4. POST /listings/{id}/promote/confirm → gateway charges + flips is_promoted
//
// Fail closed: never paint "Promoted" from a client-side flag alone. The
// gateway only activates after ChargePromotion succeeds. Amounts always come
// from PROMOTION_TIERS / the promote response amount_cents — never free-typed.

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2, Megaphone } from 'lucide-react';
import { useMemo, useState } from 'react';

import { StripeNotConfigured } from '@/components/payments/StripeNotConfigured';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirmPromotion, useCreatePromotion } from '@/hooks/usePromoteListing';
import { getApiErrorMessage } from '@/lib/api';
import { isDevClientSecret } from '@/lib/payment-outcome';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { cn, formatCents } from '@/lib/utils';
import {
  LISTING_STATUS,
  PROMOTION_TIERS,
  type Listing,
  type PromoteListingResponse,
  type PromotionDurationHours,
} from '@/types';

interface PromoteListingButtonProps {
  listing: Pick<Listing, 'id' | 'status' | 'is_promoted' | 'promoted_until' | 'title'>;
  className?: string;
}

function isPromotionActive(listing: PromoteListingButtonProps['listing']): boolean {
  if (!listing.is_promoted || !listing.promoted_until) return false;
  const until = Date.parse(listing.promoted_until);
  if (Number.isNaN(until)) return false;
  return until > Date.now();
}

export function PromoteListingButton({ listing, className }: PromoteListingButtonProps) {
  const [open, setOpen] = useState(false);
  const [durationHours, setDurationHours] = useState<PromotionDurationHours>(24);
  const [charge, setCharge] = useState<PromoteListingResponse | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const create = useCreatePromotion(listing.id);
  const confirm = useConfirmPromotion(listing.id);

  const selectedTier = useMemo(() => {
    const found = PROMOTION_TIERS.find((t) => t.duration_hours === durationHours);
    // PROMOTION_TIERS is a non-empty const; fall back to the 24h row for exhaustiveness.
    return (
      found ?? {
        duration_hours: 24 as PromotionDurationHours,
        amount_cents: 500,
        label: '24 hours',
      }
    );
  }, [durationHours]);

  // Only active listings may be promoted (gateway enforces the same rule).
  if (listing.status !== LISTING_STATUS.ACTIVE) {
    return null;
  }

  const promotedNow = isPromotionActive(listing);

  function resetFlow() {
    setCharge(null);
    setStartError(null);
    create.reset();
    confirm.reset();
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      resetFlow();
    }
  }

  function handleStart() {
    setStartError(null);
    create.mutate(
      { duration_hours: durationHours },
      {
        onSuccess: (data) => {
          // Assert server pricebook matches the tier the seller picked.
          // A mismatch means client/server pricebooks drifted — refuse rather
          // than charging an unexpected amount.
          if (data.amount_cents !== selectedTier.amount_cents) {
            setStartError(
              'Promotion price changed. Close and try again so you see the current price.',
            );
            return;
          }
          if (data.duration_hours !== durationHours) {
            setStartError('Promotion duration mismatch. Close and try again.');
            return;
          }
          setCharge(data);
        },
        onError: (err) => {
          setStartError(getApiErrorMessage(err, 'Could not start promotion'));
        },
      },
    );
  }

  function handlePromoted() {
    handleOpenChange(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'min-h-[40px] flex-1 border-[var(--brand-gold)]/30 text-[var(--brand-gold)] hover:bg-[var(--brand-gold)]/10',
          className,
        )}
        data-testid="promote-listing-open"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Megaphone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        {promotedNow ? 'Boost again' : 'Promote'}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {promotedNow ? 'Extend promotion' : 'Promote listing'}
            </DialogTitle>
            <DialogDescription>
              Float <span className="font-medium text-foreground">{listing.title}</span> to
              the top of the marketplace scoreboard. You are charged only after card
              setup succeeds — the listing is never marked promoted without payment.
            </DialogDescription>
          </DialogHeader>

          {promotedNow && listing.promoted_until ? (
            <p
              className="rounded-md border border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 px-3 py-2 text-sm text-[var(--brand-gold)]"
              role="status"
            >
              Currently promoted until{' '}
              {new Date(listing.promoted_until).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              .
            </p>
          ) : null}

          {!charge ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-zinc-200">Choose a plan</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Promotion duration">
                  {PROMOTION_TIERS.map((tier) => {
                    const selected = tier.duration_hours === durationHours;
                    return (
                      <button
                        key={tier.duration_hours}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-testid={`promote-tier-${String(tier.duration_hours)}`}
                        className={cn(
                          'flex min-h-[44px] items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-[var(--brand-gold)]/50 bg-[var(--brand-gold)]/10'
                            : 'border-white/10 bg-zinc-900/40 hover:border-white/20',
                        )}
                        onClick={() => {
                          setDurationHours(tier.duration_hours);
                          setStartError(null);
                        }}
                      >
                        <span className="text-sm font-medium text-zinc-100">{tier.label}</span>
                        <span className="text-sm tabular-nums text-[var(--brand-gold)]">
                          {formatCents(tier.amount_cents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {startError ? (
                <p className="text-sm text-red-300" role="alert">
                  {startError}
                </p>
              ) : null}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    handleOpenChange(false);
                  }}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
                  data-testid="promote-listing-continue"
                  disabled={create.isPending}
                  onClick={handleStart}
                >
                  {create.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Starting…
                    </>
                  ) : (
                    <>Continue · {formatCents(selectedTier.amount_cents)}</>
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <PromotePaymentStep
              listingId={listing.id}
              charge={charge}
              confirmMutation={confirm}
              onPromoted={handlePromoted}
              onBack={() => {
                // Drop the pending charge view so the seller can pick another
                // tier. A new promote mint uses a fresh sticky idempotency key
                // (cleared on create success / different duration key).
                setCharge(null);
                setStartError(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface PromotePaymentStepProps {
  listingId: string;
  charge: PromoteListingResponse;
  confirmMutation: ReturnType<typeof useConfirmPromotion>;
  onPromoted: () => void;
  onBack: () => void;
}

function PromotePaymentStep({
  listingId,
  charge,
  confirmMutation,
  onPromoted,
  onBack,
}: PromotePaymentStepProps) {
  // Dev/sandbox stacks emit "dev_promote_<listingId>" (or other dev_*) when
  // Stripe is not wired. Skip Elements and call /confirm directly — the
  // gateway short-circuits ChargePromotion only in ENVIRONMENT=development.
  if (isDevClientSecret(charge.stripe_client_secret)) {
    return (
      <DevPromoteConfirm
        listingId={listingId}
        chargeId={charge.charge_id}
        amountCents={charge.amount_cents}
        confirmMutation={confirmMutation}
        onPromoted={onPromoted}
        onBack={onBack}
      />
    );
  }

  if (!isStripeConfigured()) {
    return (
      <div className="space-y-3">
        <StripeNotConfigured message="Promotions need payment processing, which isn't set up yet. A Stripe account must be connected before you can promote a listing. If you're the operator, set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY." />
        <Button type="button" variant="outline" className="min-h-[44px] w-full" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret: charge.stripe_client_secret,
        appearance: { theme: 'stripe', variables: { borderRadius: '0.5rem' } },
      }}
    >
      <PromoteConfirm
        listingId={listingId}
        chargeId={charge.charge_id}
        amountCents={charge.amount_cents}
        confirmMutation={confirmMutation}
        onPromoted={onPromoted}
        onBack={onBack}
      />
    </Elements>
  );
}

interface PromoteConfirmProps {
  listingId: string;
  chargeId: string;
  amountCents: number;
  confirmMutation: ReturnType<typeof useConfirmPromotion>;
  onPromoted: () => void;
  onBack: () => void;
}

function PromoteConfirm({
  listingId,
  chargeId,
  amountCents,
  confirmMutation,
  onPromoted,
  onBack,
}: PromoteConfirmProps) {
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
      setError(stripeErr.message ?? 'Card could not be confirmed');
      setSubmitting(false);
      return;
    }

    // Only after SetupIntent succeeds do we ask the gateway to charge and
    // activate. Confirm never fakes is_promoted on the client.
    confirmMutation.mutate(
      { charge_id: chargeId },
      {
        onSuccess: () => {
          onPromoted();
        },
        onError: (err) => {
          setError(getApiErrorMessage(err, 'Promotion payment failed'));
          setSubmitting(false);
        },
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="promote-elements-host">
      <p className="text-sm text-zinc-300">
        Save a card to pay{' '}
        <span className="font-semibold tabular-nums text-[var(--brand-gold)]">
          {formatCents(amountCents)}
        </span>
        . You are charged only when promotion activates.
      </p>
      <PaymentElement />
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          disabled={submitting || confirmMutation.isPending}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="button"
          className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
          data-testid="promote-listing-pay"
          disabled={!stripe || !elements || submitting || confirmMutation.isPending}
          onClick={() => {
            void handleSubmit();
          }}
        >
          {submitting || confirmMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Processing…
            </>
          ) : (
            <>Pay {formatCents(amountCents)} &amp; promote</>
          )}
        </Button>
      </div>
    </div>
  );
}

function DevPromoteConfirm({
  listingId,
  chargeId,
  amountCents,
  confirmMutation,
  onPromoted,
  onBack,
}: PromoteConfirmProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // listingId retained for parity with Stripe path / future logging.
  void listingId;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    confirmMutation.mutate(
      { charge_id: chargeId },
      {
        onSuccess: () => {
          onPromoted();
        },
        onError: (err) => {
          setError(getApiErrorMessage(err, 'Promotion confirmation failed'));
          setSubmitting(false);
        },
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="promote-dev-host">
      <p className="text-sm text-amber-100/80">
        Dev mode — no Stripe keys configured. Confirming will call the gateway
        confirm path ({formatCents(amountCents)}). Outside development the
        gateway refuses activation without a real charge.
      </p>
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          disabled={submitting || confirmMutation.isPending}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="button"
          className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
          data-testid="promote-listing-dev-confirm"
          disabled={submitting || confirmMutation.isPending}
          onClick={handleSubmit}
        >
          {submitting || confirmMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Confirming…
            </>
          ) : (
            <>Confirm promotion (dev)</>
          )}
        </Button>
      </div>
    </div>
  );
}
