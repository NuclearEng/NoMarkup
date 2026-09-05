'use client';

import { AlertTriangle, CreditCard, Download } from 'lucide-react';
import { useState } from 'react';

import { SubscriptionTierCard } from '@/components/payments/SubscriptionTierCard';
import { SubscriptionTierComparison } from '@/components/payments/SubscriptionTierComparison';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCancelSubscription,
  useChangeTier,
  useCreateSubscription,
  useInvoices,
  useSubscription,
  useTiers,
  useUsage,
} from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';
import { formatCents, humanizeStatus, subscriptionTierLabel } from '@/lib/utils';
import { BILLING_INTERVAL, SUBSCRIPTION_STATUS } from '@/types';
import type { BillingInterval } from '@/types';

function getStatusBadgeVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case SUBSCRIPTION_STATUS.ACTIVE:
    case SUBSCRIPTION_STATUS.TRIALING:
      return 'default';
    case SUBSCRIPTION_STATUS.PAST_DUE:
      return 'destructive';
    case SUBSCRIPTION_STATUS.CANCELLED:
    case SUBSCRIPTION_STATUS.EXPIRED:
      return 'secondary';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case SUBSCRIPTION_STATUS.ACTIVE:
      return 'Active';
    case SUBSCRIPTION_STATUS.PAST_DUE:
      return 'Past Due';
    case SUBSCRIPTION_STATUS.CANCELLED:
      return 'Cancelled';
    case SUBSCRIPTION_STATUS.EXPIRED:
      return 'Expired';
    case SUBSCRIPTION_STATUS.TRIALING:
      return 'Trial';
    default:
      return status;
  }
}

interface UsageBarProps {
  label: string;
  current: number;
  max: number;
}

function UsageBar({ label, current, max }: UsageBarProps) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            'tabular-nums',
            isNearLimit
              ? 'font-semibold text-amber-600 dark:text-amber-400'
              : 'text-zinc-300',
          )}
        >
          {String(current)} / {String(max)}
        </span>
      </div>
      <Progress value={percentage} aria-label={`${label}: ${String(current)} of ${String(max)}`} />
    </div>
  );
}

export default function SubscriptionPage() {
  const { data: subscriptionData, isLoading: subLoading, isError: subError } = useSubscription();
  const { data: tiersData, isLoading: tiersLoading } = useTiers();
  const { data: usageData } = useUsage();
  const { data: invoicesData } = useInvoices();
  const changeTier = useChangeTier();
  const createSubscription = useCreateSubscription();
  const cancelSubscription = useCancelSubscription();

  const [billingInterval, setBillingInterval] = useState<BillingInterval>(BILLING_INTERVAL.MONTHLY);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const subscription = subscriptionData?.subscription;
  const tiers = tiersData?.tiers ?? [];
  const usage = usageData;

  // Read proration off the mutation result here, where `data` is still typed
  // `... | undefined`. Inside the `isSuccess` branch below TanStack narrows
  // `data` to non-null, but in practice the success flag can flip a render
  // before `data` is populated, so we keep this nullable and default to 0.
  const prorationCents = changeTier.data?.proration_amount_cents ?? 0;
  const invoices = invoicesData?.invoices ?? [];

  function handleSelectTier(tierId: string) {
    if (!subscription) {
      // No active subscription yet — start one. Dev seeds a default payment
      // method; paid tiers complete via the returned client_secret/Stripe flow.
      void createSubscription.mutateAsync({
        tier_id: tierId,
        billing_interval: billingInterval,
        payment_method_id: '',
      });
      return;
    }
    void changeTier.mutateAsync({
      new_tier_id: tierId,
      billing_interval: billingInterval,
    });
  }

  function handleCancel() {
    void cancelSubscription.mutateAsync({
      reason: cancelReason,
      cancel_immediately: false,
    }).then(() => {
      setShowCancelConfirm(false);
      setCancelReason('');
    });
  }

  if (subLoading || tiersLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Subscription</h1>
          <p className="mt-1 text-zinc-300">
            Manage your plan, view usage, and billing history.
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="py-6">
                <div className="space-y-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (subError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Subscription</h1>
        </div>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load subscription details. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Subscription</h1>
        <p className="mt-1 text-zinc-300">
          Manage your plan, view usage, and billing history.
        </p>
      </div>

      {/* Current Plan */}
      {subscription ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="gold-text text-lg">Current Plan</CardTitle>
              <Badge variant={getStatusBadgeVariant(subscription.status)}>
                {getStatusLabel(subscription.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xl font-bold">{subscriptionTierLabel(subscription.tier)}</p>
                <p className="text-sm text-zinc-300">
                  {formatCents(subscription.current_price_cents)}/
                  {subscription.billing_interval === BILLING_INTERVAL.ANNUAL ? 'year' : 'month'}
                </p>
              </div>
              <div className="text-sm text-zinc-300">
                <p>
                  Current period:{' '}
                  {new Date(subscription.current_period_start).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  -{' '}
                  {new Date(subscription.current_period_end).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                {subscription.trial_end ? (
                  <p>
                    Trial ends:{' '}
                    {new Date(subscription.trial_end).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                ) : null}
                {subscription.cancelled_at ? (
                  <p className="text-destructive">
                    Cancels on:{' '}
                    {new Date(subscription.current_period_end).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-gold)]/10 border border-[var(--brand-gold)]/20">
              <CreditCard className="h-6 w-6 text-[var(--brand-gold)]" aria-hidden="true" />
            </div>
            <p className="text-lg font-medium">No active subscription</p>
            <p className="mt-1 text-sm text-zinc-300">
              Choose a plan below to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Usage */}
      {usage ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-lg">Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar
              label="Active Bids"
              current={usage.active_bids}
              max={usage.max_active_bids}
            />
            <UsageBar
              label="Service Categories"
              current={usage.service_categories}
              max={usage.max_service_categories}
            />
            <UsageBar
              label="Portfolio Images"
              current={usage.portfolio_images}
              max={usage.max_portfolio_images}
            />
            <div className="glass-divider" role="separator" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">Current platform fee</span>
              <span className="font-semibold">
                {(usage.current_fee_percentage * 100).toFixed(0)}%
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Tier Selection */}
      {tiers.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold">Plans</h2>
            <div className="flex items-center gap-3">
              {/* Billing interval toggle */}
              <Tabs
                value={billingInterval}
                onValueChange={(val) => { setBillingInterval(val as BillingInterval); }}
              >
                <TabsList className="glass glass-highlight">
                  <TabsTrigger value={BILLING_INTERVAL.MONTHLY} className="min-h-[44px]">
                    Monthly
                  </TabsTrigger>
                  <TabsTrigger value={BILLING_INTERVAL.ANNUAL} className="min-h-[44px]">
                    Annual
                    <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">
                      Save 20%
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* View mode toggle */}
              <div className="hidden items-center gap-1 sm:flex">
                <Button
                  variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => { setViewMode('cards'); }}
                  aria-label="View as cards"
                >
                  Cards
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => { setViewMode('table'); }}
                  aria-label="View as table"
                >
                  Table
                </Button>
              </div>
            </div>
          </div>

          {viewMode === 'cards' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...tiers]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((tier) => (
                  <SubscriptionTierCard
                    key={tier.id}
                    tier={tier}
                    currentTierId={subscription?.tier_id}
                    currentSortOrder={subscription?.tier.sort_order}
                    billingInterval={billingInterval}
                    onSelect={handleSelectTier}
                  />
                ))}
            </div>
          ) : (
            <SubscriptionTierComparison
              tiers={tiers}
              currentTierId={subscription?.tier_id}
              billingInterval={billingInterval}
              onSelectTier={handleSelectTier}
            />
          )}

          {changeTier.isError ? (
            <div className="rounded-lg border bg-destructive/10 p-3 text-sm text-destructive">
              Failed to change plan. Please try again.
            </div>
          ) : null}
          {changeTier.isSuccess ? (
            <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg p-3 text-sm">
              Plan changed successfully.
              {prorationCents > 0 ? (
                <>
                  {' '}
                  A prorated charge of{' '}
                  <span className="font-semibold">{formatCents(prorationCents)}</span> applies for
                  the rest of this billing period.
                </>
              ) : null}
              {prorationCents < 0 ? (
                <>
                  {' '}
                  A prorated credit of{' '}
                  <span className="font-semibold">{formatCents(Math.abs(prorationCents))}</span>{' '}
                  will be applied to your next invoice.
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Invoice History */}
      {invoices.length > 0 ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-lg">Invoice History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Header */}
              <div className="hidden items-center gap-4 px-2 py-1 text-xs font-medium uppercase text-zinc-300 sm:flex">
                <div className="flex-1">Period</div>
                <div className="w-24 text-right">Amount</div>
                <div className="w-20 text-center">Status</div>
                <div className="w-10" />
              </div>

              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex min-h-[44px] flex-col gap-2 rounded-md border border-white/5 px-3 py-2 sm:flex-row sm:items-center sm:gap-4 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex-1 text-sm">
                    {new Date(invoice.period_start).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    -{' '}
                    {new Date(invoice.period_end).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="w-24 text-right text-sm font-semibold">
                    {formatCents(invoice.amount_cents)}
                  </div>
                  <div className="w-20 text-center">
                    <Badge
                      variant={invoice.status === 'paid' ? 'default' : 'outline'}
                      className="text-xs"
                    >
                      {humanizeStatus(invoice.status)}
                    </Badge>
                  </div>
                  <div className="w-10">
                    {invoice.pdf_url ? (
                      <a
                        href={invoice.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-zinc-300 hover:text-foreground"
                        aria-label={`Download invoice for ${new Date(invoice.period_start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Cancel Subscription */}
      {subscription && !subscription.cancelled_at ? (
        <Card className="glass glass-highlight border border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              Cancel Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showCancelConfirm ? (
              <div>
                <p className="text-sm text-zinc-300">
                  You can cancel your subscription at any time. Your plan will remain active until
                  the end of the current billing period.
                </p>
                <Button
                  variant="destructive"
                  className="mt-4 min-h-[44px]"
                  onClick={() => { setShowCancelConfirm(true); }}
                >
                  Cancel Subscription
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-medium">
                  Are you sure? Your plan will remain active until{' '}
                  {new Date(subscription.current_period_end).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  .
                </p>
                <div>
                  <label
                    htmlFor="cancel-reason"
                    className="mb-1 block text-sm font-medium"
                  >
                    Reason for cancelling (optional)
                  </label>
                  <textarea
                    id="cancel-reason"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring dark:bg-white/[0.03] dark:border-white/10 dark:text-white dark:placeholder:text-white/30"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => { setCancelReason(e.target.value); }}
                    placeholder="Tell us why you are cancelling..."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="destructive"
                    className="min-h-[44px]"
                    onClick={handleCancel}
                    disabled={cancelSubscription.isPending}
                  >
                    {cancelSubscription.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => { setShowCancelConfirm(false); }}
                  >
                    Keep Subscription
                  </Button>
                </div>
                {cancelSubscription.isError ? (
                  <div className="rounded-lg border bg-destructive/10 p-3 text-sm text-destructive">
                    Failed to cancel subscription. Please try again.
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
