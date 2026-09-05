'use client';

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import type { PaymentRequestPaymentMethodEvent } from '@stripe/stripe-js';
import { Loader2 } from 'lucide-react';
import { type SyntheticEvent, useCallback, useState } from 'react';

import { PaymentRequestButton } from '@/components/payments/PaymentRequestButton';
import { StripeNotConfigured } from '@/components/payments/StripeNotConfigured';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAddDevPaymentMethod,
  useCreateSetupIntent,
} from '@/hooks/usePayments';
import { getApiErrorMessage } from '@/lib/api';
import { getStripe, isStripeConfigured } from '@/lib/stripe';

const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;

function SetupForm({
  clientSecret,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/settings/payment-methods`,
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMessage(error.message ?? 'An unexpected error occurred.');
      setIsSubmitting(false);
    } else {
      onSuccess();
    }
  }

  // Apple Pay / Google Pay returns a tokenized PaymentMethod. Attach it
  // to the existing SetupIntent before dismissing the wallet sheet —
  // complete('success') without confirmSetup leaves the method unattached.
  const handleWalletPaymentMethod = useCallback(
    (event: PaymentRequestPaymentMethodEvent) => {
      void (async () => {
        if (!stripe) {
          event.complete('fail');
          return;
        }
        try {
          const { error } = await stripe.confirmSetup({
            clientSecret,
            confirmParams: {
              payment_method: event.paymentMethod.id,
              return_url: `${window.location.origin}/settings/payment-methods`,
            },
            redirect: 'if_required',
          });
          if (error) {
            event.complete('fail');
            setErrorMessage(error.message ?? 'An unexpected error occurred.');
            return;
          }
          event.complete('success');
          onSuccess();
        } catch {
          event.complete('fail');
          setErrorMessage('An unexpected error occurred.');
        }
      })();
    },
    [stripe, clientSecret, onSuccess],
  );

  // We render the wallet button at a token $1 amount for the "save
  // payment method" UX — Stripe's PaymentRequest API requires a
  // positive total to enumerate available wallets, but the actual
  // settlement happens via the SetupIntent below. Real bid/BuyItNow
  // checkout flows pass the bid amount instead and route the wallet
  // success straight to the relevant gateway endpoint.
  const walletPreauthCents = 100;

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
      {/* Apple Pay / Google Pay express checkout. Renders only when the
          visitor's browser has a usable wallet; falls back silently to
          the card form below otherwise. */}
      <PaymentRequestButton
        amountCents={walletPreauthCents}
        label="Save payment method"
        onPaymentMethod={handleWalletPaymentMethod}
      />
      <PaymentElement />
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button
          type="submit"
          className="min-h-[44px] flex-1"
          disabled={!stripe || !elements || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Saving...
            </>
          ) : (
            'Save Payment Method'
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// DevCardForm is rendered when the backend is running without Stripe keys.
// It stores a mock card in the payment service's in-memory dev store, so the
// rest of the payment UI has something to list, delete, and reference.
function DevCardForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const addDev = useAddDevPaymentMethod();
  const [brand, setBrand] = useState<string>('visa');
  const [lastFour, setLastFour] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!/^\d{4}$/.test(lastFour)) {
      setError('Last four must be exactly 4 digits.');
      return;
    }
    const month = parseInt(expMonth, 10);
    const year = parseInt(expYear, 10);
    if (!month || month < 1 || month > 12) {
      setError('Expiration month must be 1–12.');
      return;
    }
    if (!year || year < 2025 || year > 2099) {
      setError('Expiration year must be 2025–2099.');
      return;
    }

    try {
      await addDev.mutateAsync({
        brand,
        last_four: lastFour,
        exp_month: month,
        exp_year: year,
      });
      onSuccess();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to add card.'));
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
      <div className="rounded-md border border-trust-medium/30 bg-trust-medium/10 px-3 py-2 text-xs text-trust-medium">
        Dev mode — no Stripe keys configured. Cards are stored in the payment
        service&apos;s in-memory store and reset on restart.
      </div>

      <div className="space-y-2">
        <Label htmlFor="dev-brand">Brand</Label>
        <select
          id="dev-brand"
          value={brand}
          onChange={(e) => { setBrand(e.target.value); }}
          className="border-input bg-background focus:ring-ring h-10 w-full rounded-md border px-3 text-sm focus:ring-2 focus:outline-none [&>option]:bg-background [&>option]:text-foreground"
        >
          {CARD_BRANDS.map((b) => (
            <option key={b} value={b}>
              {b.charAt(0).toUpperCase() + b.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dev-last4">Last 4 digits</Label>
        <Input
          id="dev-last4"
          inputMode="numeric"
          maxLength={4}
          value={lastFour}
          onChange={(e) => { setLastFour(e.target.value.replace(/\D/g, '')); }}
          placeholder="4242"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="dev-exp-month">Exp month</Label>
          <Input
            id="dev-exp-month"
            inputMode="numeric"
            maxLength={2}
            value={expMonth}
            onChange={(e) => { setExpMonth(e.target.value.replace(/\D/g, '')); }}
            placeholder="12"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dev-exp-year">Exp year</Label>
          <Input
            id="dev-exp-year"
            inputMode="numeric"
            maxLength={4}
            value={expYear}
            onChange={(e) => { setExpYear(e.target.value.replace(/\D/g, '')); }}
            placeholder="2030"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button
          type="submit"
          className="min-h-[44px] flex-1"
          disabled={addDev.isPending}
        >
          {addDev.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Saving...
            </>
          ) : (
            'Save Dev Card'
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={onCancel}
          disabled={addDev.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddPaymentMethodForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const createSetupIntent = useCreateSetupIntent();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  async function initialize() {
    setIsInitializing(true);
    setInitError(null);
    try {
      const result = await createSetupIntent.mutateAsync();
      setClientSecret(result.client_secret);
    } catch (err) {
      setInitError(
        getApiErrorMessage(err, 'Could not start payment setup. Please try again.'),
      );
    } finally {
      setIsInitializing(false);
    }
  }

  if (!clientSecret) {
    return (
      <div className="space-y-4">
        {initError ? (
          <p className="text-sm text-destructive" role="alert">
            {initError}
          </p>
        ) : null}
        <Button
          className="min-h-[44px] w-full"
          onClick={() => { void initialize(); }}
          disabled={isInitializing}
        >
          {isInitializing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Initializing...
            </>
          ) : (
            'Enter Payment Details'
          )}
        </Button>
        <Button
          variant="outline"
          className="min-h-[44px] w-full"
          onClick={onCancel}
          disabled={isInitializing}
        >
          Cancel
        </Button>
      </div>
    );
  }

  // Dev-mode sentinel: the backend returns "dev_seti_<uuid>" when Stripe isn't
  // configured. Fall back to a manual card form backed by the dev store.
  if (clientSecret.startsWith('dev_seti_')) {
    return <DevCardForm onSuccess={onSuccess} onCancel={onCancel} />;
  }

  // Real SetupIntent but no browser publishable key → Elements can't render.
  if (!isStripeConfigured()) {
    return (
      <StripeNotConfigured message="Saving a card needs payment processing, which isn't set up yet. A Stripe account must be connected first." />
    );
  }

  return (
    <Elements
      stripe={getStripe()}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            borderRadius: '0.5rem',
          },
        },
      }}
    >
      <SetupForm clientSecret={clientSecret} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}
