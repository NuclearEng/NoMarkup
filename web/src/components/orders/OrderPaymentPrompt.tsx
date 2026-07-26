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

import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  describeOrderPaymentFailure,
  useOrderPaymentIntent,
} from '@/hooks/useOrderPayment';
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
  className?: string;
}

export function OrderPaymentPrompt({
  orderId,
  amountCents,
  platformFeeCents,
  onPaid,
  className,
}: OrderPaymentPromptProps) {
  const startPayment = useOrderPaymentIntent(orderId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [totalCents, setTotalCents] = useState<number | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

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

  if (paid) {
    return (
      <Card variant="glass" className={className}>
        <CardContent className="p-4">
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            Payment received. Funds are held in escrow until you confirm pickup.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="glass"
      className={cn('border-amber-500/30', className)}
      data-testid="order-payment-prompt"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-amber-200">
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
      </CardContent>
    </Card>
  );
}
