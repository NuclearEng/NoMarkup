'use client';

// PaymentConfirmationDialog — modal shell around PaymentConfirmation, used by
// the two flows that mint a PaymentIntent as a side effect of another action
// (buy-now closeout, buyer accepting a seller's counter-offer). Both used to
// discard the `client_secret` and toast "Purchased"; this dialog is what makes
// the buyer actually pay.
//
// Behaviour on outcome:
//   succeeded  → success toast, dialog closes, `onSucceeded` runs (navigate).
//   anything   → dialog STAYS OPEN with the reason in the form's live region,
//   else         so the buyer can retry or read what their bank needs. A
//                declined card must never look like a completed purchase.
//
// The dialog is intentionally not dismissible-by-accident while a
// confirmation is in flight — Radix closes on Escape/overlay click, so we
// disable those handlers until the attempt resolves.

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAYMENT_OUTCOME, type PaymentOutcome } from '@/lib/payment-outcome';
import { formatCents } from '@/lib/utils';

export interface PaymentConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PaymentIntent client secret from the gateway. */
  clientSecret: string;
  /**
   * Server-calculated total being charged, in cents. Omit when the API has
   * not told us the total — we then show a neutral "Pay now" rather than
   * printing an item price the card will not actually be charged (the
   * platform fee and sales tax are added server-side; see the
   * `total_cents` gateway gap noted on PaymentIntentEnvelope).
   */
  amountCents?: number;
  /** Item price, shown as context only — never presented as the total. */
  itemPriceCents?: number;
  /** Path Stripe returns to for redirect-based methods. */
  returnPath: string;
  title?: string;
  description?: string;
  /** Runs once the PaymentIntent actually reaches `succeeded`. */
  onSucceeded: (outcome: PaymentOutcome) => void;
  className?: string;
}

export function PaymentConfirmationDialog({
  open,
  onOpenChange,
  clientSecret,
  amountCents,
  itemPriceCents,
  returnPath,
  title = 'Complete your payment',
  description,
  onSucceeded,
  className,
}: PaymentConfirmationDialogProps) {
  const [inFlight, setInFlight] = useState(false);

  const handleOutcome = useCallback(
    (outcome: PaymentOutcome) => {
      setInFlight(false);
      if (outcome.settled) {
        toast.success('Payment complete — funds are held in escrow');
        onOpenChange(false);
        onSucceeded(outcome);
        return;
      }
      if (outcome.kind === PAYMENT_OUTCOME.PROCESSING) {
        toast.info('Payment is processing — we will update your order shortly');
        return;
      }
      // Declines, abandoned SCA, and errors stay on screen: the form's own
      // aria-live region already carries the reason, so a second toast would
      // just double-announce it to a screen reader.
    },
    [onOpenChange, onSucceeded],
  );

  // Only put a number on the button when the SERVER told us the total. Any
  // other figure would be a guess about someone's money.
  const submitLabel =
    amountCents === undefined ? 'Pay now' : `Pay ${formatCents(amountCents)}`;

  const defaultDescription =
    amountCents !== undefined
      ? `You're paying ${formatCents(amountCents)}. Funds are held in escrow and only released to the seller once you confirm pickup.`
      : itemPriceCents !== undefined
        ? `Item price ${formatCents(itemPriceCents)}, plus the platform fee and any sales tax. Your exact total is shown in the payment form. Funds are held in escrow until you confirm pickup.`
        : 'Your total is shown in the payment form. Funds are held in escrow and only released to the seller once you confirm pickup.';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (inFlight && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={className}
        onEscapeKeyDown={(event) => {
          if (inFlight) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (inFlight) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? defaultDescription}</DialogDescription>
        </DialogHeader>

        <PaymentConfirmation
          clientSecret={clientSecret}
          submitLabel={submitLabel}
          returnPath={returnPath}
          onOutcome={handleOutcome}
          onSubmitStart={() => {
            setInFlight(true);
          }}
          onCancel={
            inFlight
              ? undefined
              : () => {
                  onOpenChange(false);
                }
          }
        />
      </DialogContent>
    </Dialog>
  );
}
