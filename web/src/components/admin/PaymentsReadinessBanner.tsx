'use client';

import { AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { usePlatformBanking } from '@/hooks/useAdmin';
import { isStripeConfigured } from '@/lib/stripe';

/**
 * Persistent admin-only alert shown when the platform isn't payment-ready.
 *
 * Two failure modes are surfaced to the ADMIN (never the customer):
 *  1. No platform Stripe publishable key (`!isStripeConfigured()`) — Stripe
 *     Elements surfaces can't load at all.
 *  2. No platform payout bank account on file (`usePlatformBanking()` returns
 *     `account: null`) — collected fees have nowhere to route.
 *
 * Either condition means buyers/sellers will hit a dead payment widget, so the
 * admin must be told to fix it. Render this at the top of the admin surface;
 * it gates itself to nothing (returns null) once payments are fully set up.
 */
export function PaymentsReadinessBanner() {
  const stripeConfigured = isStripeConfigured();

  // Only query banking when Stripe is configured — if there's no publishable
  // key, the Stripe story is already broken and that's the headline issue.
  const { data, isLoading } = usePlatformBanking();
  const bankAccountMissing = stripeConfigured && !isLoading && !data?.account;

  if (stripeConfigured && !bankAccountMissing) {
    return null;
  }

  const reasons: string[] = [];
  if (!stripeConfigured) {
    reasons.push(
      'No Stripe publishable key is configured, so payment forms can’t load.',
    );
  }
  if (bankAccountMissing) {
    reasons.push(
      'No platform payout bank account is on file, so collected fees have nowhere to route.',
    );
  }

  return (
    <Card
      role="alert"
      className="border border-destructive/40 bg-destructive/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Payments are disabled — the platform isn&apos;t fully set up
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          <Link
            href="/admin/banking"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-[var(--brand-gold)] transition-colors hover:underline"
          >
            Set up platform payments
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
