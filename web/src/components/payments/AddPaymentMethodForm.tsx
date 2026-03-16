'use client';

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { type SyntheticEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCreateSetupIntent } from '@/hooks/usePayments';
import { getStripe } from '@/lib/stripe';

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

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
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
