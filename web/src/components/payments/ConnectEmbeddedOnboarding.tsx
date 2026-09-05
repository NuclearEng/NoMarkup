'use client';

import { loadConnectAndInitialize } from '@stripe/connect-js';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { isStripeConfigured } from '@/lib/stripe';

type ConnectInstance = ReturnType<typeof loadConnectAndInitialize>;

/**
 * In-app Stripe Connect onboarding via embedded components (Accounts v2 /
 * Express path). Uses AccountSession client_secrets from the payment service.
 *
 * Falls back is handled by the parent (Account Links redirect) when Stripe
 * publishable key is missing or Connect.js fails to initialize.
 */
export function ConnectEmbeddedOnboarding({
  onExit,
  className,
}: {
  /** Called when the provider finishes or exits the embedded flow. */
  onExit?: () => void;
  className?: string;
}) {
  const [connectInstance, setConnectInstance] = useState<ConnectInstance | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const fetchClientSecret = useCallback(async () => {
    const res = await api.post<{ client_secret: string }>(
      '/api/v1/providers/me/stripe/account-session',
    );
    if (!res.client_secret) {
      throw new Error('Account session missing client_secret');
    }
    return res.client_secret;
  }, []);

  useEffect(() => {
    if (!isStripeConfigured()) {
      setInitError('Stripe is not configured in this environment.');
      return;
    }
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
    let cancelled = false;
    try {
      const instance = loadConnectAndInitialize({
        publishableKey: pk,
        fetchClientSecret,
        appearance: {
          overlays: 'dialog',
          variables: {
            colorPrimary: '#0f172a',
          },
        },
      });
      if (!cancelled) {
        setConnectInstance(instance);
      }
    } catch {
      if (!cancelled) {
        setInitError('Could not start embedded Stripe onboarding.');
      }
    }
    return () => {
      cancelled = true;
    };
  }, [fetchClientSecret]);

  const content = useMemo(() => {
    if (initError) {
      return (
        <p className="text-sm text-destructive" role="alert">
          {initError}
        </p>
      );
    }
    if (!connectInstance) {
      return (
        <p className="text-sm text-muted-foreground" role="status">
          Loading secure Stripe setup…
        </p>
      );
    }
    return (
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <div className="space-y-4">
          <ConnectNotificationBanner />
          <ConnectAccountOnboarding
            onExit={() => {
              onExit?.();
            }}
          />
        </div>
      </ConnectComponentsProvider>
    );
  }, [connectInstance, initError, onExit]);

  return <div className={className}>{content}</div>;
}
