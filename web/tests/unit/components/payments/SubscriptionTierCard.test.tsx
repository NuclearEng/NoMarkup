import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SubscriptionTierCard } from '@/components/payments/SubscriptionTierCard';
import { BILLING_INTERVAL, type SubscriptionTier } from '@/types';

const tier: SubscriptionTier = {
  id: 'tier-pro',
  name: 'Pro',
  slug: 'pro',
  monthly_price_cents: 49_00,
  annual_price_cents: 490_00,
  fee_discount_percentage: 5,
  max_active_bids: 50,
  max_service_categories: 5,
  portfolio_image_limit: 25,
  featured_placement: true,
  analytics_access: true,
  priority_support: false,
  verified_badge_boost: true,
  instant_enabled: true,
  sort_order: 2,
};

describe('SubscriptionTierCard', () => {
  it('renders the tier name and monthly price', () => {
    render(
      createElement(SubscriptionTierCard, {
        tier,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelect: vi.fn(),
      }),
    );

    expect(screen.getByText('Pro')).toBeDefined();
    expect(screen.getByText('$49.00')).toBeDefined();
  });

  it('renders the annual equivalent and total when billed annually', () => {
    render(
      createElement(SubscriptionTierCard, {
        tier,
        billingInterval: BILLING_INTERVAL.ANNUAL,
        onSelect: vi.fn(),
      }),
    );

    // monthly equivalent of $490/year = ~$40.83
    expect(screen.getByText(/billed annually/)).toBeDefined();
  });

  it('shows feature list including limits and toggles', () => {
    render(
      createElement(SubscriptionTierCard, {
        tier,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelect: vi.fn(),
      }),
    );

    expect(screen.getByText('Up to 50 active bids')).toBeDefined();
    expect(screen.getByText('5 service categories')).toBeDefined();
    expect(screen.getByText('25 portfolio images')).toBeDefined();
    expect(screen.getByText('5% fee discount')).toBeDefined();
  });

  it('renders Current Plan label and disabled CTA when this tier is current', () => {
    render(
      createElement(SubscriptionTierCard, {
        tier,
        currentTierId: 'tier-pro',
        currentSortOrder: 2,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelect: vi.fn(),
      }),
    );

    // "Current Plan" appears both as a banner and as the CTA label
    expect(screen.getAllByText('Current Plan').length).toBeGreaterThan(0);
    const cta = screen.getByRole('button', { name: /Current Plan - Pro/ });
    expect(cta.hasAttribute('disabled')).toBe(true);
  });

  it('calls onSelect with the tier id when CTA is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      createElement(SubscriptionTierCard, {
        tier,
        currentTierId: 'tier-basic',
        currentSortOrder: 1,
        billingInterval: BILLING_INTERVAL.MONTHLY,
        onSelect,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Upgrade - Pro/ }));
    expect(onSelect).toHaveBeenCalledWith('tier-pro');
  });
});
