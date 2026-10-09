'use client';

// OrderPaymentPrompt — the "you still owe money on this order" surface.
//
// Rendered on the order page whenever the order is in `pending_payment`
// (web status `pending`). That state is reached three ways:
//
//   1. Auction win — services/payment charged the winner OFF-SESSION and the
//      charge failed: no card on file, a decline, or (critically) the issuer
//      demanded Strong Customer Authentication. SCA can NEVER be satisfied
//      off-session; the cardholder must be present. This component is the
//      only way that order can ever be paid.
//   2. Buy-It-Now / accepted offer where the buyer dismissed the payment
//      sheet, or the gateway returned `charge_error`.
//   3. Payment service unreachable when the order was minted.
//
// It is deliberately blunt about the consequence — an unpaid order is not a
// purchase, the seller is not obliged to hold the item, and pickup cannot be
// confirmed until escrow is funded.

import { AlertTriangle, CreditCard } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCancelUnpaidOrder } from '@/hooks/useListings';
import {
  describeOrderPaymentFailure,
  useOrderPaymentIntent,
} from '@/hooks/useOrderPayment';
import { ApiError } from '@/lib/api';
import {
  hasConfirmablePayment,
  type PaymentOutcome,
} from '@/lib/payment-outcome';
import { cn, formatCents } from '@/lib/utils';

export interface OrderPaymentPromptProps {
  orderId: string;
  /** Item amount from the order record (context only, not the charged total). */
  amountCents: number;
  /** Platform fee from the order record. Sales tax is added server-side. */
  platformFeeCents: number;
  /** Called once the PaymentIntent reaches `succeeded`, to refetch the order. */
  onPaid?: () => void;
  /** Called after an unpaid order is canceled, so the parent can refetch. */
  onCanceled?: () => void;
  className?: string;
}

function describeCancelUnpaidFailure(err: unknown): string {
  const fallback =
    'Could not cancel this unpaid order. Refresh the page and try again.';
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 409) {
    return err.userMessage(
      'This order can no longer be canceled. If payment already went through, the listing stays sold.',
    );
  }
  if (err.status === 403) {
    return err.userMessage('Only the buyer on this order can cancel it.');
  }
  return err.userMessage(fallback);
}

export function OrderPaymentPrompt({
  orderId,
  amountCents,
  platformFeeCents,
  onPaid,
  onCanceled,
  className,
}: OrderPaymentPromptProps) {
  const startPayment = useOrderPaymentIntent(orderId);
  const cancelUnpaid = useCancelUnpaidOrder();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [totalCents, setTotalCents] = useState<number | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelFailure, setCancelFailure] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [paid, setPaid] = useState(false);
  const [canceled, setCanceled] = useState(false);

  function handleStart() {
    setFailure(null);
    startPayment.mutate(undefined, {
      onSuccess: (data) => {
        if (hasConfirmablePayment(data)) {
          setClientSecret(data.client_secret);
          setTotalCents(data.total_cents);
          return;
        }
        // A 200 with no usable secret is a backend gap, not a user error —
        // say so plainly instead of rendering a payment form that can't work.
        setFailure(
          'We could not open a secure checkout for this order. Please try again, or contact support with your order number.',
        );
      },
      onError: (err: unknown) => {
        setFailure(describeOrderPaymentFailure(err));
      },
    });
  }

  function handleOutcome(outcome: PaymentOutcome) {
    if (outcome.settled) {
      setPaid(true);
      setClientSecret(null);
      onPaid?.();
    }
    // Non-settled outcomes (decline, abandoned SCA, processing) stay in the
    // form's own live region — re-announcing here would double-speak.
  }

  function handleConfirmCancel() {
    setCancelFailure(null);
    cancelUnpaid.mutate(orderId, {
      onSuccess: () => {
        setCancelOpen(false);
        setCanceled(true);
        onCanceled?.();
      },
      onError: (err: unknown) => {
        setCancelFailure(describeCancelUnpaidFailure(err));
        setCancelOpen(false);
      },
    });
  }

  if (paid) {
    return (
      <Card variant="glass" className={className}>
        <CardContent className="p-4">
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-status-completed/30 bg-status-completed/10 px-3 py-2 text-sm text-status-completed"
          >
            Payment received. Funds are held in escrow until you confirm pickup.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (canceled) {
    return (
      <Card variant="glass" className={className}>
        <CardContent className="p-4">
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-status-completed/30 bg-status-completed/10 px-3 py-2 text-sm text-status-completed"
          >
            Unpaid order canceled. The listing is for sale again.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="glass"
      className={cn('border-trust-medium/30', className)}
      data-testid="order-payment-prompt"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-trust-medium">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Payment required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            This order is not paid yet, so nothing is held in escrow and pickup
            can&apos;t be confirmed. If you won an auction, your saved card was
            declined, missing, or your bank asked for extra verification — which
            only you can complete.
          </p>
          <dl className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <dt>Item</dt>
              <dd className="tabular-nums text-foreground">
                {formatCents(amountCents)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>Platform fee</dt>
              <dd className="tabular-nums text-foreground">
                {formatCents(platformFeeCents)}
              </dd>
            </div>
          </dl>
          <p className="text-xs">
            Sales tax is calculated at checkout; your exact total is shown in the
            payment form.
          </p>
        </div>

        {clientSecret ? (
          <PaymentConfirmation
            clientSecret={clientSecret}
            submitLabel={
              totalCents === undefined ? 'Pay now' : `Pay ${formatCents(totalCents)}`
            }
            returnPath={`/orders/${orderId}`}
            onOutcome={handleOutcome}
            onCancel={() => {
              setClientSecret(null);
            }}
          />
        ) : startPayment.isPending ? (
          <div className="space-y-3" data-testid="order-payment-starting">
            <Skeleton className="h-24 w-full" variant="card" />
            <Skeleton className="h-11 w-full" />
            <span className="sr-only" role="status">
              Preparing secure checkout
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {failure ? (
              <p
                id={`order-payment-error-${orderId}`}
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {failure}
              </p>
            ) : null}
            <Button
              type="button"
              className="min-h-[44px] w-full"
              onClick={handleStart}
              aria-describedby={
                failure ? `order-payment-error-${orderId}` : undefined
              }
            >
              <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
              {failure ? 'Try payment again' : 'Complete payment'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Want auctions to settle automatically next time?{' '}
              <Link
                href={'/settings/payment-methods' as Route}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Save a card on file
              </Link>{' '}
              before the auction closes.
            </p>
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Canceling stops payment and puts the listing back on sale. A payment
            that already went through cannot be canceled here.
          </p>
          {cancelFailure ? (
            <p
              id={`order-cancel-error-${orderId}`}
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {cancelFailure}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] w-full"
            disabled={cancelUnpaid.isPending}
            aria-busy={cancelUnpaid.isPending}
            aria-describedby={
              cancelFailure ? `order-cancel-error-${orderId}` : undefined
            }
            onClick={() => {
              setCancelFailure(null);
              setCancelOpen(true);
            }}
          >
            Cancel unpaid order
          </Button>
        </div>
      </CardContent>
      <ActionConfirmDialog
        open={cancelOpen}
        onClose={() => {
          if (!cancelUnpaid.isPending) setCancelOpen(false);
        }}
        onConfirm={handleConfirmCancel}
        title="Cancel this unpaid order?"
        description="Canceling stops payment and puts the listing back on sale. A payment that already went through cannot be canceled here."
        confirmLabel="Confirm cancel unpaid order"
        destructive
        loading={cancelUnpaid.isPending}
      />
    </Card>
  );
}
