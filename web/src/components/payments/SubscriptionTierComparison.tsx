'use client';

import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/utils';
import { BILLING_INTERVAL } from '@/types';
import type { BillingInterval, SubscriptionTier } from '@/types';

interface FeatureRow {
  label: string;
  getValue: (tier: SubscriptionTier) => string | boolean;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    label: 'Max active bids',
    getValue: (t) => String(t.max_active_bids),
  },
  {
    label: 'Service categories',
    getValue: (t) => String(t.max_service_categories),
  },
  {
    label: 'Portfolio images',
    getValue: (t) => String(t.portfolio_image_limit),
  },
  {
    label: 'Fee discount',
    getValue: (t) =>
      t.fee_discount_percentage > 0
        ? `${String(t.fee_discount_percentage)}%`
        : '-',
  },
  {
    label: 'Featured placement',
    getValue: (t) => t.featured_placement,
  },
  {
    label: 'Analytics access',
    getValue: (t) => t.analytics_access,
  },
  {
    label: 'Priority support',
    getValue: (t) => t.priority_support,
  },
  {
    label: 'Verified badge boost',
    getValue: (t) => t.verified_badge_boost,
  },
  {
    label: 'Instant booking',
    getValue: (t) => t.instant_enabled,
  },
];

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="mx-auto h-4 w-4 text-emerald-500" aria-label="Included" />
    ) : (
      <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="Not included" />
    );
  }
  return <span className="text-sm">{value}</span>;
}

interface SubscriptionTierComparisonProps {
  tiers: SubscriptionTier[];
  currentTierId?: string;
  billingInterval: BillingInterval;
  onSelectTier: (tierId: string) => void;
}

export function SubscriptionTierComparison({
  tiers,
  currentTierId,
  billingInterval,
  onSelectTier,
}: SubscriptionTierComparisonProps) {
  const sortedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-background p-3 text-sm font-medium text-muted-foreground">
              Feature
            </th>
            {sortedTiers.map((tier) => {
              const isCurrent = tier.id === currentTierId;
              const priceCents =
                billingInterval === BILLING_INTERVAL.ANNUAL
                  ? tier.annual_price_cents
                  : tier.monthly_price_cents;
              const monthlyEquivalent =
                billingInterval === BILLING_INTERVAL.ANNUAL
                  ? tier.annual_price_cents / 12
                  : tier.monthly_price_cents;

              return (
                <th
                  key={tier.id}
                  className={cn(
                    'min-w-[140px] p-3 text-center',
                    isCurrent && 'bg-primary/5',
                  )}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{tier.name}</p>
                    <p className="text-lg font-bold">{formatCents(monthlyEquivalent)}</p>
                    <p className="text-xs text-muted-foreground">
                      {billingInterval === BILLING_INTERVAL.ANNUAL
                        ? `${formatCents(priceCents)}/yr`
                        : '/mo'}
                    </p>
                    {isCurrent ? (
                      <span className="inline-block rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        Current
                      </span>
                    ) : null}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {FEATURE_ROWS.map((row, idx) => (
            <tr
              key={row.label}
              className={cn(idx % 2 === 0 ? 'bg-muted/30' : 'bg-background')}
            >
              <td className="sticky left-0 z-10 bg-inherit p-3 text-sm font-medium">
                {row.label}
              </td>
              {sortedTiers.map((tier) => {
                const isCurrent = tier.id === currentTierId;
                return (
                  <td
                    key={tier.id}
                    className={cn(
                      'p-3 text-center',
                      isCurrent && 'bg-primary/5',
                    )}
                  >
                    <CellValue value={row.getValue(tier)} />
                  </td>
                );
              })}
            </tr>
          ))}
          {/* CTA row */}
          <tr>
            <td className="sticky left-0 z-10 bg-background p-3" />
            {sortedTiers.map((tier) => {
              const isCurrent = tier.id === currentTierId;
              return (
                <td key={tier.id} className="p-3 text-center">
                  <Button
                    className="min-h-[44px]"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent}
                    onClick={() => { onSelectTier(tier.id); }}
                    aria-label={
                      isCurrent
                        ? `Current plan - ${tier.name}`
                        : `Select ${tier.name}`
                    }
                  >
                    {isCurrent ? 'Current' : 'Select'}
                  </Button>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
