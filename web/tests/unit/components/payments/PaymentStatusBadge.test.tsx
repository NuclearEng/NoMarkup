import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PaymentStatusBadge } from '@/components/payments/PaymentStatusBadge';
import { PAYMENT_STATUS } from '@/types';

describe('PaymentStatusBadge', () => {
  it('renders the human-readable label for known statuses', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.PENDING }));
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('renders Released for the released status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.RELEASED }));
    expect(screen.getByText('Released')).toBeDefined();
  });

  it('renders Partially Refunded for the partially_refunded status', () => {
    render(
      createElement(PaymentStatusBadge, {
        status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      }),
    );
    expect(screen.getByText('Partially Refunded')).toBeDefined();
  });

  it('falls back to a humanised version of unknown statuses', () => {
    render(createElement(PaymentStatusBadge, { status: 'super_weird_state' }));
    expect(screen.getByText('super weird state')).toBeDefined();
  });

  it('forwards custom className to the badge', () => {
    const { container } = render(
      createElement(PaymentStatusBadge, {
        status: PAYMENT_STATUS.COMPLETED,
        className: 'custom-class',
      }),
    );
    const badge = container.querySelector('.custom-class');
    expect(badge).not.toBeNull();
  });
});
