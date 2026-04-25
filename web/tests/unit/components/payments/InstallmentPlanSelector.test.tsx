import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InstallmentPlanSelector } from '@/components/payments/InstallmentPlanSelector';

describe('InstallmentPlanSelector', () => {
  it('renders the three installment plan options', () => {
    render(
      createElement(InstallmentPlanSelector, {
        totalCents: 100_00,
        onSelect: vi.fn(),
      }),
    );

    expect(screen.getByText('Pay in Full')).toBeDefined();
    expect(screen.getByText('3 Payments')).toBeDefined();
    expect(screen.getByText('6 Payments')).toBeDefined();
  });

  it('shows financing fee labels for the multi-payment plans', () => {
    render(
      createElement(InstallmentPlanSelector, {
        totalCents: 100_00,
        onSelect: vi.fn(),
      }),
    );

    expect(screen.getByText('3% financing fee')).toBeDefined();
    expect(screen.getByText('5% financing fee')).toBeDefined();
  });

  it('defaults to "Pay in Full" being pressed', () => {
    render(
      createElement(InstallmentPlanSelector, {
        totalCents: 100_00,
        onSelect: vi.fn(),
      }),
    );

    const payInFull = screen.getByRole('button', { name: /Pay in Full/ });
    expect(payInFull.getAttribute('aria-pressed')).toBe('true');
  });

  it('invokes onSelect with the selected plan when a button is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      createElement(InstallmentPlanSelector, {
        totalCents: 100_00,
        onSelect,
      }),
    );

    const threePlan = screen.getByRole('button', { name: /3 Payments/ });
    await user.click(threePlan);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0]?.[0] as
      | { installments: number; perPaymentCents: number }
      | undefined;
    expect(arg?.installments).toBe(3);
    expect(arg?.perPaymentCents).toBeGreaterThan(0);
  });
});
