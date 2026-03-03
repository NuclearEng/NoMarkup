'use client';

import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  useCreateStripeAccount,
  useStripeAccountStatus,
  useStripeOnboardingLink,
} from '@/hooks/usePayments';
import { ApiError } from '@/lib/api';

function StatusIndicator({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {enabled ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={enabled ? 'text-green-700' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

export function StripeOnboarding() {
  const { data: accountStatus, isLoading, isError, error } = useStripeAccountStatus();
  const createAccount = useCreateStripeAccount();
  const onboardingLink = useStripeOnboardingLink({
    return_url: typeof window !== 'undefined' ? `${window.location.origin}/payments` : '',
    refresh_url: typeof window !== 'undefined' ? `${window.location.origin}/payments` : '',
  });

  const isNotFound =
    isError && error instanceof ApiError && error.status === 404;

  async function handleConnectStripe() {
    await createAccount.mutateAsync();
    const result = await onboardingLink.refetch();
    if (result.data?.url) {
      window.location.href = result.data.url;
    }
  }

  async function handleCompleteSetup() {
    const result = await onboardingLink.refetch();
    if (result.data?.url) {
      window.location.href = result.data.url;
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Checking Stripe status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No Stripe account yet
  if (isNotFound || !accountStatus) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Connect with Stripe</h3>
          <p className="text-sm text-muted-foreground">
            Connect your Stripe account to receive payments for completed work.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            className="min-h-[44px]"
            disabled={createAccount.isPending || onboardingLink.isFetching}
            onClick={() => { void handleConnectStripe(); }}
          >
            {createAccount.isPending || onboardingLink.isFetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Setting up...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                Connect with Stripe
              </>
            )}
          </Button>
          {createAccount.isError ? (
            <p className="mt-2 text-sm text-destructive">
              Failed to create Stripe account. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // Account exists but setup is incomplete
  const isComplete =
    accountStatus.charges_enabled &&
    accountStatus.payouts_enabled &&
    accountStatus.details_submitted;

  if (!isComplete) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Complete Stripe Setup</h3>
          <p className="text-sm text-muted-foreground">
            Your Stripe account needs additional information before you can receive payments.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <StatusIndicator enabled={accountStatus.details_submitted} label="Details submitted" />
            <StatusIndicator enabled={accountStatus.charges_enabled} label="Charges enabled" />
            <StatusIndicator enabled={accountStatus.payouts_enabled} label="Payouts enabled" />
          </div>

          {accountStatus.requirements.length > 0 ? (
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground">Pending requirements:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {accountStatus.requirements.map((req) => (
                  <li key={req}>{req.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button
            className="min-h-[44px]"
            disabled={onboardingLink.isFetching}
            onClick={() => { void handleCompleteSetup(); }}
          >
            {onboardingLink.isFetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                Complete Setup
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Fully connected
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Stripe Connected</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Your Stripe account is fully set up and ready to receive payments.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <StatusIndicator enabled={accountStatus.charges_enabled} label="Charges enabled" />
          <StatusIndicator enabled={accountStatus.payouts_enabled} label="Payouts enabled" />
        </div>
      </CardContent>
    </Card>
  );
}
