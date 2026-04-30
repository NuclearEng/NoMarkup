'use client';

// Wave 5 — paid promotion checkout button. Renders a Sparkles button
// that opens a dialog with three duration tiers ($5/24h, $12/72h,
// $25/7d). On click of "Promote", we mint a SetupIntent via
// /promote, confirm via Stripe Elements, then call /promote/confirm.
//
// In dev (gateway returns sentinel client_secret starting with
// 'dev_promote_'), we skip Stripe entirely and call /confirm directly
// — same dev fallback as BidBondPrompt.

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useConfirmPromotion, useCreatePromotion } from '@/hooks/usePromoteListing';
import { getStripe } from '@/lib/stripe';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import {
  PROMOTION_TIERS,
  type PromotionDurationHours,
} from '@/types';

interface PromoteListingButtonProps {
  listingId: string;
  /**
   * When the listing is already promoted (and not yet expired) the
   * parent passes promoted_until so we can render a passive "Promoted
   * until …" state instead of the upsell.
   */
  promotedUntil?: string | null;
  className?: string;
}

export function PromoteListingButton({
  listingId,
  promotedUntil,
  className,
}: PromoteListingButtonProps) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<PromotionDurationHours>(72);
  const create = useCreatePromotion(listingId);
  const confirm = useConfirmPromotion(listingId);
  const [stage, setStage] = useState<'pick' | 'paying'>('pick');
  const [chargeState, setChargeState] = useState<{
    chargeId: string;
    clientSecret: string;
  } | null>(null);

  // Already promoted? Show a passive pill instead of the upsell.
  if (promotedUntil && new Date(promotedUntil) > new Date()) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={cn('gap-2', className)}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Promoted until {new Date(promotedUntil).toLocaleDateString()}
      </Button>
    );
  }

  const handleStart = () => {
    create.mutate(
      { duration_hours: duration },
      {
        onSuccess: (resp) => {
          setChargeState({
            chargeId: resp.charge_id,
            clientSecret: resp.stripe_client_secret,
          });
          // Dev fallback: gateway returned a sentinel — skip Stripe.
          if (resp.stripe_client_secret.startsWith('dev_promote_')) {
            confirm.mutate(
              { charge_id: resp.charge_id },
              {
                onSuccess: () => {
                  setOpen(false);
                  setStage('pick');
                  setChargeState(null);
                },
              },
            );
            return;
          }
          setStage('paying');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-2', className)}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Promote
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote this listing</DialogTitle>
          <DialogDescription>
            Promoted listings appear at the top of the marketplace scoreboard
            with a gold pill.
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' ? (
          <div className="space-y-4">
            <ul className="space-y-2">
              {PROMOTION_TIERS.map((tier) => {
                const active = duration === tier.duration_hours;
                return (
                  <li key={tier.duration_hours}>
                    <button
                      type="button"
                      onClick={() => {
                        setDuration(tier.duration_hours);
                      }}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40',
                      )}
                    >
                      <div>
                        <p className="font-medium">{tier.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Top placement for {tier.label.toLowerCase()}
                        </p>
                      </div>
                      <p className="text-lg font-bold tabular-nums">
                        {formatCents(tier.amount_cents)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              onClick={handleStart}
              disabled={create.isPending}
              className="w-full"
            >
              {create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Continue to payment
            </Button>
          </div>
        ) : null}

        {stage === 'paying' && chargeState ? (
          <Elements
            stripe={getStripe()}
            options={{ clientSecret: chargeState.clientSecret }}
          >
            <PromotionPaymentForm
              chargeId={chargeState.chargeId}
              onConfirmed={() => {
                setOpen(false);
                setStage('pick');
                setChargeState(null);
              }}
            />
          </Elements>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stripe Elements payment form. Confirms the SetupIntent then hits the
 * gateway's /promote/confirm so the listing flips is_promoted=true.
 */
function PromotionPaymentForm({
  chargeId,
  onConfirmed,
}: {
  chargeId: string;
  onConfirmed: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const confirm = useConfirmPromotion('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (result.error) {
      setError(result.error.message ?? 'Payment failed');
      setSubmitting(false);
      return;
    }
    confirm.mutate(
      { charge_id: chargeId },
      {
        onSuccess: () => {
          setSubmitting(false);
          onConfirmed();
        },
        onError: () => {
          setSubmitting(false);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button
        type="button"
        onClick={() => {
          void handlePay();
        }}
        disabled={!stripe || submitting}
        className="w-full"
      >
        {submitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        Confirm and promote
      </Button>
    </div>
  );
}
