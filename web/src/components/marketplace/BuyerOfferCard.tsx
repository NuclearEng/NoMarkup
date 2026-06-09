'use client';

// Buyer-side view of their own Best-Offer chain on a listing.
//
// Counterpart to the seller's CounterOfferBanner. The parent (listing
// detail page) gates rendering by checking `user?.id !== listing.seller_id`
// so only a non-seller (potential buyer) ever sees this. We surface the
// buyer's single live offer in the chain plus the right actions, keyed on
// who the offer currently awaits (mirrors the gateway authz):
//
//   - awaiting the SELLER (the buyer's own open proposal) → Withdraw only.
//   - awaiting the BUYER  (a seller counter)              → Accept / Reject.
//
// Terminal states (accepted / rejected / withdrawn / expired) render a
// read-only status line with no actions. On accept that returns an
// order_id we surface a link to the resulting order.

import { Loader2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  awaitingPartyForDepth,
  computeOfferDepths,
  useListingOffers,
  useUpdateOffer,
} from '@/hooks/useOffers';
import { formatCents, formatRelativeTime, humanizeStatus } from '@/lib/utils';
import type { Offer, OfferStatus } from '@/types';

interface BuyerOfferCardProps {
  listingId: string;
  className?: string;
}

/** Badge color per offer state. */
function statusBadgeVariant(
  status: OfferStatus,
): 'active' | 'secondary' | 'destructive' {
  switch (status) {
    case 'accepted':
      return 'active';
    case 'rejected':
    case 'withdrawn':
    case 'expired':
      return 'destructive';
    default:
      return 'secondary';
  }
}

/** Human-readable status line for terminal/pending offers. */
function statusLabel(status: OfferStatus, awaiting: 'buyer' | 'seller'): string {
  switch (status) {
    case 'pending':
      return awaiting === 'seller'
        ? 'Waiting for the seller to respond'
        : 'The seller countered — your move';
    case 'countered':
      return 'You countered this offer';
    case 'accepted':
      return 'Accepted — order created';
    case 'rejected':
      return 'The seller declined this offer';
    case 'withdrawn':
      return 'You withdrew this offer';
    case 'expired':
      return 'This offer expired';
    default:
      return status;
  }
}

export function BuyerOfferCard({ listingId, className }: BuyerOfferCardProps) {
  const offers = useListingOffers(listingId);
  const updateOffer = useUpdateOffer(listingId);

  // Captured from the accept response so we can deep-link the new order.
  const [orderId, setOrderId] = useState<string | null>(null);

  if (offers.isLoading) {
    return (
      <Card variant="glass" className={className}>
        <CardContent className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your offer…
        </CardContent>
      </Card>
    );
  }
  if (offers.isError) {
    return (
      <Card variant="glass" className={className}>
        <CardContent className="text-destructive p-4 text-sm">
          Failed to load your offer.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              void offers.refetch();
            }}
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const allOffers = offers.data?.offers ?? [];
  if (allOffers.length === 0) return null;

  const depths = computeOfferDepths(allOffers);

  // The "live" offer is the most recent non-terminal one (pending). If the
  // whole chain has resolved, show the most recent row so the buyer still
  // sees the outcome (accepted/rejected/etc.). Offers arrive newest-first.
  const liveOfferCandidate: Offer | undefined =
    allOffers.find((o) => o.status === 'pending') ?? allOffers[0];
  if (!liveOfferCandidate) return null;
  const liveOffer: Offer = liveOfferCandidate;

  const depth = depths.get(liveOffer.id) ?? 0;
  const awaiting = awaitingPartyForDepth(depth);
  const isPending = liveOffer.status === 'pending';
  const buyerCanAcceptReject = isPending && awaiting === 'buyer';
  const buyerCanWithdraw = isPending && awaiting === 'seller';

  function handleAccept() {
    updateOffer.mutate(
      { offerId: liveOffer.id, action: 'accept' },
      {
        onSuccess: (data) => {
          if (data.order_id) setOrderId(data.order_id);
        },
      },
    );
  }
  function handleReject() {
    updateOffer.mutate({ offerId: liveOffer.id, action: 'reject' });
  }
  function handleWithdraw() {
    updateOffer.mutate({ offerId: liveOffer.id, action: 'withdraw' });
  }

  return (
    <Card variant="glass" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-bold tabular-nums">
              {formatCents(liveOffer.amount_cents)}
            </p>
            <p className="text-muted-foreground text-xs">
              Sent {formatRelativeTime(new Date(liveOffer.created_at))}
            </p>
            {liveOffer.message ? (
              <p className="text-foreground/80 mt-1 text-sm">
                &ldquo;{liveOffer.message}&rdquo;
              </p>
            ) : null}
          </div>
          <Badge variant={statusBadgeVariant(liveOffer.status)}>
            {humanizeStatus(liveOffer.status)}
          </Badge>
        </div>

        <p className="text-muted-foreground text-sm" aria-live="polite">
          {statusLabel(liveOffer.status, awaiting)}
        </p>

        {orderId ? (
          <Link
            href={`/orders/${orderId}` as Route}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            View your order
          </Link>
        ) : null}

        {buyerCanAcceptReject ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-[44px]"
              onClick={handleAccept}
              disabled={updateOffer.isPending}
            >
              {updateOffer.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Accept counter'
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive min-h-[44px]"
              onClick={handleReject}
              disabled={updateOffer.isPending}
            >
              Reject
            </Button>
          </div>
        ) : null}

        {buyerCanWithdraw ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            onClick={handleWithdraw}
            disabled={updateOffer.isPending}
          >
            {updateOffer.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              'Withdraw offer'
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
