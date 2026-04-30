'use client';

// "Make an offer" modal — buyer-facing entry point for the Best-Offer
// flow. Posts to POST /api/v1/listings/{id}/offers via useCreateOffer.
//
// Surfacing rules (enforced by the parent page, not this component):
//  - Only render when listing.status === 'active'
//  - Only render when bid_count === 0 (an active auction with bids takes
//    priority — Best-Offer is for "buy below asking" behavior)
//  - Hidden when the seller has disabled offers (a future flag)

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateOffer } from '@/hooks/useOffers';
import { formatCents } from '@/lib/utils';

interface OfferModalProps {
  listingId: string;
  /** Current listing price (asking or current bid) — shown as a reference. */
  currentPriceCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OfferModal({
  listingId,
  currentPriceCents,
  open,
  onOpenChange,
}: OfferModalProps) {
  // Track the input as a string so we can preserve the "type" experience
  // (decimals, partial entries, etc.) without coercing to NaN.
  const [amountDollars, setAmountDollars] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  const createOffer = useCreateOffer(listingId);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const dollars = parseFloat(amountDollars);
    if (Number.isNaN(dollars) || dollars <= 0) return;
    const cents = Math.round(dollars * 100);
    createOffer.mutate(
      { amount_cents: cents, message: message.trim() || undefined },
      {
        onSuccess: () => {
          setAmountDollars('');
          setMessage('');
          onOpenChange(false);
        },
      },
    );
  }

  const askingLabel = formatCents(currentPriceCents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make an offer</DialogTitle>
          <DialogDescription>
            Submit a price below the {askingLabel} asking price. The seller has 24
            hours to accept, reject, or counter your offer.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="offer-amount">Your offer (USD)</Label>
            <Input
              id="offer-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              autoComplete="off"
              required
              value={amountDollars}
              onChange={(e) => {
                setAmountDollars(e.target.value);
              }}
              placeholder="e.g. 95.00"
              className="min-h-[44px]"
              disabled={createOffer.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offer-message">Message (optional)</Label>
            <Textarea
              id="offer-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
              }}
              placeholder="Add a note explaining your offer."
              maxLength={500}
              rows={3}
              disabled={createOffer.isPending}
            />
            <p className="text-muted-foreground text-xs">
              {String(message.length)} / 500
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={createOffer.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={createOffer.isPending || amountDollars === ''}
            >
              {createOffer.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Sending…
                </>
              ) : (
                'Send offer'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
