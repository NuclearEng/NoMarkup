import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PaymentHistory } from '@/components/payments/PaymentHistory';
import type { Payment } from '@/types';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pmt-1',
    contract_id: 'contract-abcdef1234',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    amount_cents: 100_00,
    platform_fee_cents: 10_00,
    guarantee_fee_cents: 5_00,
    provider_payout_cents: 85_00,
    status: 'completed',
    refund_amount_cents: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PaymentHistory', () => {
  it('shows empty state when there are no payments', () => {
    render(createElement(PaymentHistory, { payments: [] }));
    expect(screen.getByText('No payments found.')).toBeDefined();
  });

  it('renders one row per payment with amount and status', () => {
    render(
      createElement(PaymentHistory, {
        payments: [
          makePayment({ id: 'p1', amount_cents: 100_00 }),
          makePayment({ id: 'p2', amount_cents: 250_00, status: 'pending' }),
        ],
      }),
    );

    expect(screen.getByText('$100.00')).toBeDefined();
    expect(screen.getByText('$250.00')).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
    // "Completed" appears as the badge label
    expect(screen.getByText('Completed')).toBeDefined();
  });

  it('expands a payment row to reveal breakdown when clicked', async () => {
    const user = userEvent.setup();
    render(
      createElement(PaymentHistory, {
        payments: [
          makePayment({
            id: 'p1',
            amount_cents: 100_00,
            platform_fee_cents: 10_00,
            guarantee_fee_cents: 5_00,
            provider_payout_cents: 85_00,
          }),
        ],
      }),
    );

    const row = screen.getByRole('button');
    await user.click(row);

    expect(screen.getByText('Platform fee')).toBeDefined();
    expect(screen.getByText('Guarantee fee')).toBeDefined();
    expect(screen.getByText('Provider payout')).toBeDefined();
    expect(screen.getByText('View Contract')).toBeDefined();
  });

  it('shows refund info when a refund has been issued', async () => {
    const user = userEvent.setup();
    render(
      createElement(PaymentHistory, {
        payments: [
          makePayment({
            refund_amount_cents: 50_00,
            refund_reason: 'Customer cancelled',
          }),
        ],
      }),
    );

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Refunded')).toBeDefined();
    expect(screen.getByText('Customer cancelled')).toBeDefined();
  });

  it('shows failure_reason when payment failed', async () => {
    const user = userEvent.setup();
    render(
      createElement(PaymentHistory, {
        payments: [
          makePayment({
            status: 'failed',
            failure_reason: 'Card declined by issuer',
          }),
        ],
      }),
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Failure reason')).toBeDefined();
    expect(screen.getByText('Card declined by issuer')).toBeDefined();
  });

  it('shows installment info when payment is part of an installment plan', async () => {
    const user = userEvent.setup();
    render(
      createElement(PaymentHistory, {
        payments: [
          makePayment({
            installment_number: 2,
            total_installments: 4,
          }),
        ],
      }),
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Installment')).toBeDefined();
    expect(screen.getByText(/2 of 4/)).toBeDefined();
  });

  it('collapses the row when clicked twice', async () => {
    const user = userEvent.setup();
    render(
      createElement(PaymentHistory, {
        payments: [makePayment({})],
      }),
    );
    const row = screen.getByRole('button');
    await user.click(row);
    expect(screen.getByText('Platform fee')).toBeDefined();
    await user.click(row);
    expect(screen.queryByText('Platform fee')).toBeNull();
  });
});
