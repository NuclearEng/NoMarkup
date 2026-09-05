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
  // Percentages travel the wire as 0..1 fractions; the component renders them
  // as whole percents.
  fee_percentage: 0.1,
  guarantee_percentage: 0.05,
  lead_gen_fee_cents: 0,
  lead_gen_percentage: 0,
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

  it('hides the lead-gen fee row when it is zero', () => {
    render(createElement(PaymentBreakdownDisplay, { breakdown }));
    expect(screen.queryByText(/Lead-gen fee/)).toBeNull();
  });

  it('renders the lead-gen fee row when greater than zero', () => {
    const withLeadGen: PaymentBreakdown = {
      ...breakdown,
      lead_gen_fee_cents: 12_00,
      lead_gen_percentage: 0.12,
    };
    render(createElement(PaymentBreakdownDisplay, { breakdown: withLeadGen }));
    expect(screen.getByText('Lead-gen fee (12%)')).toBeDefined();
    expect(screen.getByText('$12.00')).toBeDefined();
  });
});
