import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SubscriptionTierComparison } from '@/components/payments/SubscriptionTierComparison';
import { BILLING_INTERVAL, type SubscriptionTier } from '@/types';

function makeTier(overrides: Partial<SubscriptionTier>): SubscriptionTier {
  return {
    id: 'tier-1',
    name: 'Basic',
    slug: 'basic',
    monthly_price_cents: 0,
    annual_price_cents: 0,
    fee_discount_percentage: 0,
    max_active_bids: 5,
    max_service_categories: 1,
    portfolio_image_limit: 5,
    featured_placement: false,
    analytics_access: false,
    priority_support: false,
    verified_badge_boost: false,
    instant_enabled: false,
    sort_order: 1,
    ...overrides,
  };
}

const tiers = [
  makeTier({ id: 'basic', name: 'Basic', slug: 'basic', sort_order: 1, monthly_price_cents: 0 }),
  makeTier({
    id: 'pro',
    name: 'Pro',
    // slug must track name — the display label resolves from slug first.
    slug: 'pro',
    sort_order: 2,
    monthly_price_cents: 49_00,
    annual_price_cents: 490_00,
    featured_placement: true,
    // fraction (0.10 = 10% off) — should render as "10%", not "0.1%".
    fee_discount_percentage: 0.1,
  }),
  makeTier({
    id: 'elite',
    name: 'Elite',
    slug: 'elite',
    sort_order: 3,
    monthly_price_cents: 99_00,
    annual_price_cents: 990_00,
    featured_placement: true,
    analytics_access: true,
    priority_support: true,
  }),
];

describe('SubscriptionTierComparison', () => {
  it('renders one column per tier sorted by sort_order', () => {
    render(
      createElement(SubscriptionTierComparison, {
        tiers,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelectTier: vi.fn(),
      }),
    );

    expect(screen.getByText('Basic')).toBeDefined();
    expect(screen.getByText('Pro')).toBeDefined();
    expect(screen.getByText('Elite')).toBeDefined();
  });

  it('renders the feature comparison rows', () => {
    render(
      createElement(SubscriptionTierComparison, {
        tiers,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelectTier: vi.fn(),
      }),
    );

    expect(screen.getByText('Max active bids')).toBeDefined();
    expect(screen.getByText('Service categories')).toBeDefined();
    expect(screen.getByText('Portfolio images')).toBeDefined();
    expect(screen.getByText('Fee discount')).toBeDefined();
    // The Pro tier's 0.10 fraction must display as a whole-number percent.
    expect(screen.getByText('10%')).toBeDefined();
  });

  it('marks the current tier and disables its CTA', () => {
    render(
      createElement(SubscriptionTierComparison, {
        tiers,
        currentTierId: 'pro',
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelectTier: vi.fn(),
      }),
    );

    // The "Current" badge in the header + the CTA label both render the word.
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0);
    const currentBtn = screen.getByRole('button', { name: /Current plan - Pro/ });
    expect(currentBtn.hasAttribute('disabled')).toBe(true);
  });

  it('calls onSelectTier with the tier id when a Select button is clicked', async () => {
    const user = userEvent.setup();
    const onSelectTier = vi.fn();

    render(
      createElement(SubscriptionTierComparison, {
        tiers,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelectTier,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Select Elite/ }));
    expect(onSelectTier).toHaveBeenCalledWith('elite');
  });
});
