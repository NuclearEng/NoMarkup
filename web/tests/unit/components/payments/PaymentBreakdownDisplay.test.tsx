import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PaymentBreakdownDisplay } from '@/components/payments/PaymentBreakdownDisplay';
import type { PaymentBreakdown } from '@/types';

const breakdown: PaymentBreakdown = {
  subtotal_cents: 100_00,
  platform_fee_cents: 10_00,
  guarantee_fee_cents: 5_00,
  total_cents: 115_00,
  provider_payout_cents: 90_00,
  fee_percentage: 10,
  guarantee_percentage: 5,
};

describe('PaymentBreakdownDisplay', () => {
  it('renders subtotal, fees and total', () => {
    render(createElement(PaymentBreakdownDisplay, { breakdown }));

    expect(screen.getByText('Subtotal')).toBeDefined();
    expect(screen.getByText('$100.00')).toBeDefined();
    expect(screen.getByText('$115.00')).toBeDefined();
    expect(screen.getByText('$90.00')).toBeDefined();
  });

  it('shows the fee percentages in the labels', () => {
    render(createElement(PaymentBreakdownDisplay, { breakdown }));

    expect(screen.getByText('Platform fee (10%)')).toBeDefined();
    expect(screen.getByText('Guarantee fee (5%)')).toBeDefined();
  });

  it('renders provider payout label', () => {
    render(createElement(PaymentBreakdownDisplay, { breakdown }));
    expect(screen.getByText('Provider receives')).toBeDefined();
  });
});
