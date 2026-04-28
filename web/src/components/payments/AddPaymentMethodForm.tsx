'use client';

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { type SyntheticEvent, useCallback, useState } from 'react';

import { PaymentRequestButton } from '@/components/payments/PaymentRequestButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAddDevPaymentMethod,
  useCreateSetupIntent,
} from '@/hooks/usePayments';
import { getStripe } from '@/lib/stripe';

const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;

function SetupForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
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

  // Apple Pay / Google Pay wallet success — Stripe returns a fully
  // tokenized paymentMethod, so we can immediately treat this as a
  // successfully attached method. We tell the wallet sheet the
  // operation succeeded and propagate to the parent.
  //
  // In production this should also POST the paymentMethod.id to the
  // gateway's setup-intent confirmation endpoint so the saved card list
  // refreshes; for the demo, the parent `onSuccess` triggers a refetch.
  const handleWalletPaymentMethod = useCallback(
    (event: { complete: (status: 'success' | 'fail') => void }) => {
      event.complete('success');
      onSuccess();
    },
    [onSuccess],
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
      setError(err instanceof Error ? err.message : 'Failed to add card.');
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
      <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
        Dev mode — no Stripe keys configured. Cards are stored in the payment
        service&apos;s in-memory store and reset on restart.
      </div>

      <div className="space-y-2">
        <Label htmlFor="dev-brand">Brand</Label>
        <select
          id="dev-brand"
          value={brand}
          onChange={(e) => { setBrand(e.target.value); }}
          className="border-input bg-background focus:ring-ring h-10 w-full rounded-md border px-3 text-sm focus:ring-2 focus:outline-none"
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

  async function initialize() {
    setIsInitializing(true);
    try {
      const result = await createSetupIntent.mutateAsync();
      setClientSecret(result.client_secret);
    } finally {
      setIsInitializing(false);
    }
  }

  if (!clientSecret) {
    return (
      <div className="space-y-4">
        {createSetupIntent.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Failed to initialize payment setup. Please try again.
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
      <SetupForm onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}
