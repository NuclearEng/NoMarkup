import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { InstallmentSchedule } from '@/components/payments/InstallmentSchedule';
import type { InstallmentInfo } from '@/types';

const installments: InstallmentInfo[] = [
  {
    installment_number: 1,
    total_installments: 3,
    amount_cents: 100_00,
    status: 'completed',
    paid_at: '2026-01-01T12:00:00Z',
  },
  {
    installment_number: 2,
    total_installments: 3,
    amount_cents: 100_00,
    status: 'pending',
    due_date: '2026-02-01T12:00:00Z',
  },
  {
    installment_number: 3,
    total_installments: 3,
    amount_cents: 100_00,
    status: 'scheduled',
  },
];

describe('InstallmentSchedule', () => {
  it('returns null when there are no installments', () => {
    const { container } = render(
      createElement(InstallmentSchedule, { installments: [] }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per installment with amounts', () => {
    render(createElement(InstallmentSchedule, { installments }));

    expect(screen.getByText('Payment Schedule')).toBeDefined();
    expect(screen.getByText('Payment 1 of 3')).toBeDefined();
    expect(screen.getByText('Payment 2 of 3')).toBeDefined();
    expect(screen.getByText('Payment 3 of 3')).toBeDefined();

    const amounts = screen.getAllByText('$100.00');
    expect(amounts.length).toBe(3);
  });

  it('shows "Paid" label for paid installments and "Due" for pending', () => {
    render(createElement(InstallmentSchedule, { installments }));

    expect(screen.getByText(/^Paid /)).toBeDefined();
    expect(screen.getByText(/^Due /)).toBeDefined();
    expect(screen.getByText('Upcoming')).toBeDefined();
  });

  it('exposes ARIA labels for each installment state', () => {
    render(createElement(InstallmentSchedule, { installments }));

    expect(screen.getByLabelText(/Installment 1: paid/)).toBeDefined();
    expect(screen.getByLabelText(/Installment 2: current/)).toBeDefined();
    expect(screen.getByLabelText(/Installment 3: upcoming/)).toBeDefined();
  });
});
