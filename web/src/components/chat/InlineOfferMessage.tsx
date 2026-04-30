'use client';

// Chat-side inline composer for offers. Closes audit Section F's "no
// negotiate-in-chat" gap. Wave 5 / Agent P.
//
// Two surfaces:
//
//   - InlineOfferComposer — small button + popover that POSTs to Agent
//     O's `POST /api/v1/listings/{id}/offers` endpoint. Gracefully
//     degrades (renders nothing) when the `marketplace_offers` feature
//     flag is off or the offers endpoint isn't wired up yet.
//
//   - InlineOfferMessage — bubble shown inside the message thread when a
//     PROPOSED_TERMS-style offer message arrives. Renders Accept /
//     Reject / Counter buttons; mutations land on Agent O's endpoint.
//
// Both shell to Agent O's API. We don't import Agent O's hook directly
// because that file may not exist yet; instead we hit the well-known URLs
// behind a feature flag.

import { DollarSign, Loader2, Send } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface InlineOfferComposerProps {
  /** The listing id this offer is for. */
  listingId: string;
  /** Disabled when null/undefined — listings without offers (e.g. service jobs). */
  enabled?: boolean;
  className?: string;
}

/**
 * Small "Make an offer" button + dollar-input popover. Posts to Agent
 * O's offers endpoint. Hidden when the marketplace_offers feature flag
 * is off (default false in dev).
 */
export function InlineOfferComposer({
  listingId,
  enabled = true,
  className,
}: InlineOfferComposerProps) {
  const offersFlag = useFeatureFlag('marketplace_offers' as never);
  const canMakeOffers = enabled && offersFlag;

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canMakeOffers) {
    return null;
  }

  async function handleSubmit() {
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post<unknown>(`/api/v1/listings/${listingId}/offers`, {
        amount_cents: cents,
      });
      setOpen(false);
      setAmount('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Failed to send offer.'));
      } else {
        setError('Failed to send offer.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('gap-1.5', className)}
        onClick={() => {
          setOpen(true);
        }}
        aria-label="Make an offer"
      >
        <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
        Make an offer
      </Button>
    );
  }

  return (
    <Card className={cn('border-primary/30', className)}>
      <CardContent className="flex flex-col gap-2 p-3">
        <label
          htmlFor="inline-offer-amount"
          className="text-xs font-medium text-muted-foreground"
        >
          Offer amount ($)
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="inline-offer-amount"
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            placeholder="0.00"
            className="min-h-[44px] flex-1"
            aria-label="Offer amount in dollars"
          />
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!amount || isSubmitting}
            aria-label="Send offer"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setAmount('');
              setError(null);
            }}
            aria-label="Cancel offer"
          >
            Cancel
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface InlineOfferMessageProps {
  /** The offer id (Agent O's PATCH /offers/{id} target). */
  offerId: string;
  /** Pre-formatted dollar string, e.g. "$45.00". */
  amountLabel: string;
  /** Show Accept/Reject only when the viewer is the seller. */
  isRecipient: boolean;
  /** When status !== 'pending', hide the buttons. */
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';
  className?: string;
}

/**
 * Inline bubble for offer messages already in the thread. Accept /
 * Reject mutations land on Agent O's `PATCH /api/v1/offers/{id}`
 * endpoint. Counter opens a fresh InlineOfferComposer (left to the
 * caller — pass a counterListingId via context).
 */
export function InlineOfferMessage({
  offerId,
  amountLabel,
  isRecipient,
  status,
  className,
}: InlineOfferMessageProps) {
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: 'accept' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      await api.patch<unknown>(`/api/v1/offers/${offerId}`, { action });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Failed to update offer.'));
      } else {
        setError('Failed to update offer.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      className={cn('border-primary/30 bg-primary/5', className)}
      data-testid="inline-offer-message"
    >
      <CardContent className="space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Offer
        </p>
        <p className="text-lg font-semibold">{amountLabel}</p>
        {status !== 'pending' ? (
          <p className="text-xs capitalize text-muted-foreground">
            {status}
          </p>
        ) : null}
        {status === 'pending' && isRecipient ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void respond('accept');
              }}
              disabled={busy !== null}
            >
              {busy === 'accept' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void respond('reject');
              }}
              disabled={busy !== null}
            >
              {busy === 'reject' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Reject
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
