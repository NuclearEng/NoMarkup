'use client';

import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import { BILLING_INTERVAL } from '@/types';
import type { BillingInterval, SubscriptionTier } from '@/types';

interface FeatureItem {
  label: string;
  included: boolean;
}

function getFeatures(tier: SubscriptionTier): FeatureItem[] {
  return [
    {
      label: `Up to ${String(tier.max_active_bids)} active bids`,
      included: true,
    },
    {
      label: `${String(tier.max_service_categories)} service categories`,
      included: true,
    },
    {
      label: `${String(tier.portfolio_image_limit)} portfolio images`,
      included: true,
    },
    {
      label: `${String(tier.fee_discount_percentage)}% fee discount`,
      included: tier.fee_discount_percentage > 0,
    },
    { label: 'Featured placement', included: tier.featured_placement },
    { label: 'Analytics access', included: tier.analytics_access },
    { label: 'Priority support', included: tier.priority_support },
    { label: 'Verified badge boost', included: tier.verified_badge_boost },
    { label: 'Instant booking', included: tier.instant_enabled },
  ];
}

function getCtaLabel(
  tierId: string,
  currentTierId: string | undefined,
  tierSortOrder: number,
  currentSortOrder: number | undefined,
): string {
  if (!currentTierId) return 'Get Started';
  if (tierId === currentTierId) return 'Current Plan';
  if (currentSortOrder !== undefined && tierSortOrder > currentSortOrder) return 'Upgrade';
  return 'Downgrade';
}

interface SubscriptionTierCardProps {
  tier: SubscriptionTier;
  currentTierId?: string;
  currentSortOrder?: number;
  billingInterval: BillingInterval;
  onSelect: (tierId: string) => void;
}

export function SubscriptionTierCard({
  tier,
  currentTierId,
  currentSortOrder,
  billingInterval,
  onSelect,
}: SubscriptionTierCardProps) {
  const isCurrent = tier.id === currentTierId;
  const priceCents =
    billingInterval === BILLING_INTERVAL.ANNUAL
      ? tier.annual_price_cents
      : tier.monthly_price_cents;

  const monthlyEquivalent =
    billingInterval === BILLING_INTERVAL.ANNUAL
      ? tier.annual_price_cents / 12
      : tier.monthly_price_cents;

  const features = getFeatures(tier);
  const ctaLabel = getCtaLabel(tier.id, currentTierId, tier.sort_order, currentSortOrder);

  return (
    <Card
      className={cn(
        'relative flex flex-col',
        isCurrent && 'border-primary ring-2 ring-primary',
      )}
    >
      {isCurrent ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
          Current Plan
        </div>
      ) : null}

      <CardHeader className="text-center">
        <CardTitle className="text-lg">{tier.name}</CardTitle>
        <div className="mt-2">
          <span className="text-3xl font-bold">{formatCents(monthlyEquivalent)}</span>
          <span className="text-sm text-muted-foreground">/mo</span>
        </div>
        {billingInterval === BILLING_INTERVAL.ANNUAL ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCents(priceCents)} billed annually
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        <ul className="flex-1 space-y-3">
          {features.map((feature) => (
            <li key={feature.label} className="flex items-center gap-2 text-sm">
              {feature.included ? (
                <Check
                  className="h-4 w-4 shrink-0 text-emerald-500"
                  aria-hidden="true"
                />
              ) : (
                <X
                  className="h-4 w-4 shrink-0 text-muted-foreground/40"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  feature.included
                    ? 'text-foreground'
                    : 'text-muted-foreground line-through',
                )}
              >
                {feature.label}
              </span>
            </li>
          ))}
        </ul>

        <Button
          className="mt-6 min-h-[44px] w-full"
          variant={isCurrent ? 'outline' : 'default'}
          disabled={isCurrent}
          onClick={() => { onSelect(tier.id); }}
          aria-label={`${ctaLabel} - ${tier.name}`}
        >
          {ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
