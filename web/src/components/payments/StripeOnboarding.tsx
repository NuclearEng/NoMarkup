'use client';

import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';

import { ConnectEmbeddedOnboarding } from '@/components/payments/ConnectEmbeddedOnboarding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCreateStripeAccount,
  useStripeAccountStatus,
  useStripeOnboardingLink,
} from '@/hooks/usePayments';
import { ApiError } from '@/lib/api';
import { isStripeConfigured } from '@/lib/stripe';

function StatusIndicator({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {enabled ? (
        <CheckCircle2 className="h-4 w-4 text-trust-high" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={enabled ? 'text-trust-high' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

/** Marketplace readiness: can receive separate-charges transfers (or legacy full Express). */
function isPayoutReady(status: {
  transfers_ready?: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  charges_enabled: boolean;
}): boolean {
  if (status.transfers_ready) {
    return true;
  }
  // Legacy Express accounts that predate Accounts v2 capability fields.
  return status.payouts_enabled && status.details_submitted;
}

export function StripeOnboarding() {
  const { data: accountStatus, isLoading, isError, error, refetch } = useStripeAccountStatus();
  const createAccount = useCreateStripeAccount();
  const onboardingLink = useStripeOnboardingLink({
    return_url: typeof window !== 'undefined' ? `${window.location.origin}/payments` : '',
    refresh_url: typeof window !== 'undefined' ? `${window.location.origin}/payments` : '',
  });
  const [showEmbedded, setShowEmbedded] = useState(false);
  const [preferRedirect, setPreferRedirect] = useState(false);

  const isNotFound =
    isError && error instanceof ApiError && error.status === 404;

  const canUseEmbedded = isStripeConfigured() && !preferRedirect;

  async function handleConnectStripe() {
    await createAccount.mutateAsync();
    if (canUseEmbedded) {
      setShowEmbedded(true);
      return;
    }
    const result = await onboardingLink.refetch();
    if (result.data?.url) {
      window.location.href = result.data.url;
    }
  }

  async function handleCompleteSetup() {
    if (canUseEmbedded) {
      setShowEmbedded(true);
      return;
    }
    const result = await onboardingLink.refetch();
    if (result.data?.url) {
      window.location.href = result.data.url;
    }
  }

  async function handleRedirectFallback() {
    setPreferRedirect(true);
    setShowEmbedded(false);
    const result = await onboardingLink.refetch();
    if (result.data?.url) {
      window.location.href = result.data.url;
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8" role="status" aria-label="Checking Stripe status">
          <span className="sr-only">Checking Stripe status...</span>
          <Skeleton className="mx-auto h-4 w-48" />
          <Skeleton className="mx-auto h-4 w-32" />
          <Skeleton className="mx-auto h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  // Embedded onboarding surface (after account create or mid-setup).
  // Do not require accountStatus — create + embedded is a single action and
  // status may still be refetching when we flip showEmbedded.
  if (showEmbedded && canUseEmbedded) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Complete Stripe setup</h3>
          <p className="text-sm text-muted-foreground">
            Secure onboarding stays in NoMarkup. Notification banner keeps requirements current.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConnectEmbeddedOnboarding
            onExit={() => {
              setShowEmbedded(false);
              void refetch();
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              void handleRedirectFallback();
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            Open Stripe-hosted setup instead
          </Button>
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
            onClick={() => {
              void handleConnectStripe();
            }}
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

  const ready = isPayoutReady(accountStatus);

  if (!ready) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Complete Stripe setup</h3>
          <p className="text-sm text-muted-foreground">
            Your Stripe account needs additional information before you can receive payouts.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <StatusIndicator enabled={accountStatus.details_submitted} label="Details submitted" />
            <StatusIndicator
              enabled={Boolean(accountStatus.transfers_ready)}
              label="Transfers ready"
            />
            <StatusIndicator enabled={accountStatus.payouts_enabled} label="Payouts enabled" />
          </div>

          {accountStatus.requirements && accountStatus.requirements.length > 0 ? (
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground">Pending requirements:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {accountStatus.requirements.map((req) => (
                  <li key={req}>{req.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-[44px]"
              disabled={onboardingLink.isFetching}
              onClick={() => {
                void handleCompleteSetup();
              }}
            >
              {onboardingLink.isFetching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading...
                </>
              ) : canUseEmbedded ? (
                'Continue setup'
              ) : (
                <>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  Complete setup
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fully connected for marketplace payouts
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-trust-high" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Stripe connected</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Your account is ready to receive payouts for completed work.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <StatusIndicator
            enabled={Boolean(accountStatus.transfers_ready) || accountStatus.payouts_enabled}
            label="Transfers ready"
          />
          <StatusIndicator enabled={accountStatus.payouts_enabled} label="Payouts enabled" />
          {accountStatus.accounts_api ? (
            <p className="text-xs text-muted-foreground">
              Connect API: {accountStatus.accounts_api}
              {accountStatus.dashboard ? ` · dashboard ${accountStatus.dashboard}` : ''}
            </p>
          ) : null}
        </div>
        {canUseEmbedded ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => {
              setShowEmbedded(true);
            }}
          >
            Manage account & requirements
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
