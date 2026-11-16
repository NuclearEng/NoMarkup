'use client';

// One-shot service escrow. Customer of a non-recurring awarded contract pays
// the server contract amount through POST /api/v1/payments + PaymentElement
// + POST /payments/{id}/process. No second checkout and no client-typed amount.

import { CreditCard } from 'lucide-react';
import { useState } from 'react';

import { PaymentConfirmation } from '@/components/payments/PaymentConfirmation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreatePayment, usePayments, useProcessPayment } from '@/hooks/usePayments';
import { getApiErrorMessage } from '@/lib/api';
import {
  contractPaymentsFor,
  oneShotAlreadyPaid,
  oneShotInFlight,
} from '@/lib/contract-one-shot-pay';
import {
  hasConfirmablePayment,
  isDevClientSecret,
  type PaymentOutcome,
} from '@/lib/payment-outcome';
import { cn, formatCents } from '@/lib/utils';

interface Checkout {
  paymentId: string;
  clientSecret: string;
}

export interface ContractOneShotPayProps {
  contractId: string;
  providerId: string;
  /** Integer cents from the contract record. Never an editable override. */
  amountCents: number;
  className?: string;
}

export function ContractOneShotPay({
  contractId,
  providerId,
  amountCents,
  className,
}: ContractOneShotPayProps) {
  const paymentsQuery = usePayments({ per_page: 50 });
  const createPayment = useCreatePayment();
  const processPayment = useProcessPayment();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [paid, setPaid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rows = contractPaymentsFor(paymentsQuery.data?.payments, contractId);
  const alreadyPaid = oneShotAlreadyPaid(rows);
  const inFlight = oneShotInFlight(rows);
  const amountLabel = formatCents(amountCents);
  const busy = createPayment.isPending || processPayment.isPending;

  async function capture(paymentId: string): Promise<void> {
    setErrorMessage(null);
    try {
      await processPayment.mutateAsync({ paymentId, payment_method_id: '' });
      setCheckout(null);
      setShowForm(false);
      setPaid(true);
    } catch (err: unknown) {
      setErrorMessage(getApiErrorMessage(err, 'Could not capture payment. Try again.'));
    }
  }

  async function startPay(): Promise<void> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setErrorMessage('This contract has no server amount to charge.');
      return;
    }
    setErrorMessage(null);
    try {
      const created = await createPayment.mutateAsync({
        contract_id: contractId,
        provider_id: providerId,
        amount_cents: amountCents,
      });
      const secret = created.client_secret ?? '';
      const paymentId = created.id;
      if (paymentId.trim().length === 0) {
        setErrorMessage('Payment was created without an id. Try again.');
        return;
      }
      if (isDevClientSecret(secret)) {
        await capture(paymentId);
        return;
      }
      if (!hasConfirmablePayment({ client_secret: secret })) {
        setErrorMessage(
          'Payment created but no confirmable client_secret was returned. Try again, or check Stripe configuration.',
        );
        return;
      }
      setCheckout({ paymentId, clientSecret: secret });
      setShowForm(true);
    } catch (err: unknown) {
      setErrorMessage(getApiErrorMessage(err, 'Could not start payment. Try again.'));
    }
  }

  function handleOutcome(outcome: PaymentOutcome): void {
    if (!checkout) return;
    if (outcome.settled || outcome.kind === 'processing') {
      void capture(checkout.paymentId);
      return;
    }
    setErrorMessage('Payment not completed. Use the form below to try again.');
  }

  if (paid) {
    return (
      <Card variant="glass" className={className} data-testid="contract-one-shot-paid">
        <CardContent className="p-4">
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-status-completed/30 bg-status-completed/10 px-3 py-2 text-sm text-status-completed"
          >
            Payment complete — {amountLabel} is held in escrow. Release it after you approve the
            work.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (paymentsQuery.isLoading) {
    return (
      <Card variant="glass" className={className} data-testid="contract-one-shot-loading">
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-5 w-40" variant="text" />
          <Skeleton className="h-11 w-full" />
          <span className="sr-only" role="status">
            Checking whether this contract can be paid
          </span>
        </CardContent>
      </Card>
    );
  }

  if (paymentsQuery.isError) {
    return (
      <Card variant="glass" className={cn('border-destructive/40', className)}>
        <CardContent className="space-y-3 p-4">
          <p role="alert" className="text-sm text-destructive">
            Could not check existing payments for this contract. Try again before paying so you are
            not charged twice.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              void paymentsQuery.refetch();
            }}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (alreadyPaid) return null;

  if (checkout && showForm) {
    return (
      <Card variant="glass" className={className} data-testid="contract-one-shot-pay">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pay and hold escrow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Charges the server contract amount ({amountLabel}). Funds stay in escrow until you
            release them after approving the work.
          </p>
          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          {busy ? (
            <div className="space-y-3" data-testid="contract-one-shot-capturing">
              <Skeleton className="h-11 w-full" />
              <span className="sr-only" role="status">
                Capturing payment into escrow
              </span>
            </div>
          ) : (
            <PaymentConfirmation
              clientSecret={checkout.clientSecret}
              submitLabel={`Pay ${amountLabel}`}
              returnPath={`/contracts/${contractId}`}
              onOutcome={handleOutcome}
              onCancel={() => {
                setShowForm(false);
                setErrorMessage(null);
              }}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  if (inFlight && !checkout) {
    return (
      <Card variant="glass" className={className} data-testid="contract-one-shot-inflight">
        <CardContent className="space-y-3 p-4">
          <p role="status" className="text-sm text-muted-foreground">
            A payment for this contract is already in progress. Refresh to see if escrow is funded.
            Another charge is not started while that payment is still open.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              void paymentsQuery.refetch();
            }}
          >
            Refresh payment status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const payLabel = errorMessage
    ? `Try payment again · ${amountLabel}`
    : checkout
      ? `Continue payment · ${amountLabel}`
      : `Pay and hold escrow · ${amountLabel}`;

  return (
    <Card variant="glass" className={className} data-testid="contract-one-shot-pay">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pay and hold escrow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Pay the contract amount to hold funds in escrow. The charge is the server total (
          {amountLabel}), not a typed amount.
        </p>
        {errorMessage ? (
          <p id={`contract-pay-error-${contractId}`} role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        {busy ? (
          <div className="space-y-3" data-testid="contract-one-shot-starting">
            <Skeleton className="h-24 w-full" variant="card" />
            <Skeleton className="h-11 w-full" />
            <span className="sr-only" role="status">
              Preparing secure checkout
            </span>
          </div>
        ) : (
          <Button
            type="button"
            className="min-h-11 w-full"
            aria-describedby={errorMessage ? `contract-pay-error-${contractId}` : undefined}
            onClick={() => {
              if (checkout) {
                setShowForm(true);
                setErrorMessage(null);
                return;
              }
              void startPay();
            }}
          >
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            {payLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
