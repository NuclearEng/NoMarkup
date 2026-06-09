'use client';

// Seller-side banner: lists every pending Best-Offer on the seller's
// own listing with inline Accept / Reject / Counter actions.
//
// The parent (listing detail page) gates rendering by checking
// `user?.id === listing.seller_id` so only the seller ever sees this.
// Buyers viewing their own offer use a different surface (the offer
// drawer on the listing card).

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  awaitingPartyForDepth,
  computeOfferDepths,
  useListingOffers,
  useUpdateOffer,
} from '@/hooks/useOffers';
import { formatCents, formatRelativeTime } from '@/lib/utils';
import type { Offer } from '@/types';

interface CounterOfferBannerProps {
  listingId: string;
  className?: string;
}

export function CounterOfferBanner({ listingId, className }: CounterOfferBannerProps) {
  const offers = useListingOffers(listingId);
  const updateOffer = useUpdateOffer(listingId);

  // Track which offer is currently being countered + its dollar input.
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterDollars, setCounterDollars] = useState<string>('');

  if (offers.isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading offers…
        </CardContent>
      </Card>
    );
  }
  if (offers.isError) {
    return (
      <Card className={className}>
        <CardContent className="p-4 text-sm text-destructive">
          Failed to load offers.
        </CardContent>
      </Card>
    );
  }
  // Only surface offers that are actually awaiting the SELLER's response.
  // A seller's own counter (odd chain depth) is awaiting the BUYER, so it
  // must not render Accept/Reject/Counter here (the gateway would 403).
  const allOffers = offers.data?.offers ?? [];
  const depths = computeOfferDepths(allOffers);
  const open = allOffers.filter(
    (o) =>
      o.status === 'pending' &&
      awaitingPartyForDepth(depths.get(o.id) ?? 0) === 'seller',
  );
  if (open.length === 0) return null;

  function handleAccept(offerId: string) {
    updateOffer.mutate({ offerId, action: 'accept' });
  }
  function handleReject(offerId: string) {
    updateOffer.mutate({ offerId, action: 'reject' });
  }
  function startCounter(offerId: string, suggested: number) {
    setCounterFor(offerId);
    setCounterDollars((suggested / 100).toFixed(2));
  }
  function submitCounter(offerId: string) {
    const dollars = parseFloat(counterDollars);
    if (Number.isNaN(dollars) || dollars <= 0) return;
    updateOffer.mutate(
      { offerId, action: 'counter', counter_amount_cents: Math.round(dollars * 100) },
      {
        onSuccess: () => {
          setCounterFor(null);
          setCounterDollars('');
        },
      },
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Pending offers ({String(open.length)})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {open.map((offer) => (
          <OfferRow
            key={offer.id}
            offer={offer}
            isCountering={counterFor === offer.id}
            counterDollars={counterDollars}
            onCounterDollarsChange={setCounterDollars}
            onAccept={() => {
              handleAccept(offer.id);
            }}
            onReject={() => {
              handleReject(offer.id);
            }}
            onStartCounter={() => {
              startCounter(offer.id, offer.amount_cents);
            }}
            onCancelCounter={() => {
              setCounterFor(null);
              setCounterDollars('');
            }}
            onSubmitCounter={() => {
              submitCounter(offer.id);
            }}
            isPending={updateOffer.isPending}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface OfferRowProps {
  offer: Offer;
  isCountering: boolean;
  counterDollars: string;
  onCounterDollarsChange: (next: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onStartCounter: () => void;
  onCancelCounter: () => void;
  onSubmitCounter: () => void;
  isPending: boolean;
}

function OfferRow({
  offer,
  isCountering,
  counterDollars,
  onCounterDollarsChange,
  onAccept,
  onReject,
  onStartCounter,
  onCancelCounter,
  onSubmitCounter,
  isPending,
}: OfferRowProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold tabular-nums">
            {formatCents(offer.amount_cents)}
          </p>
          <p className="text-muted-foreground text-xs">
            Sent {formatRelativeTime(new Date(offer.created_at))}
          </p>
          {offer.message ? (
            <p className="mt-1 text-sm text-foreground/80">
              &ldquo;{offer.message}&rdquo;
            </p>
          ) : null}
        </div>
        <Badge variant={offer.status === 'pending' ? 'active' : 'secondary'}>
          {offer.status}
        </Badge>
      </div>

      {isCountering ? (
        <div className="mt-3 space-y-2">
          <Label htmlFor={`counter-${offer.id}`}>Counter amount (USD)</Label>
          <Input
            id={`counter-${offer.id}`}
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            value={counterDollars}
            onChange={(e) => {
              onCounterDollarsChange(e.target.value);
            }}
            className="min-h-[44px]"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-[44px] flex-1"
              onClick={onSubmitCounter}
              disabled={isPending || counterDollars === ''}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Send counter'
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-[44px]"
              onClick={onCancelCounter}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-[44px]"
            onClick={onAccept}
            disabled={isPending}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            onClick={onStartCounter}
            disabled={isPending}
          >
            Counter
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-[44px] text-destructive"
            onClick={onReject}
            disabled={isPending}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
