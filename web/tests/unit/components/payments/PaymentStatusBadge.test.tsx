import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  PaymentStatusBadge,
  getStatusColor,
  getStatusLabel,
} from '@/components/payments/PaymentStatusBadge';
import { PAYMENT_STATUS } from '@/types';

describe('PaymentStatusBadge', () => {
  it('renders the human-readable label for known statuses', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.PENDING }));
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('renders Processing for the processing status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.PROCESSING }));
    expect(screen.getByText('Processing')).toBeDefined();
  });

  it('renders In Escrow for the escrow status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.ESCROW }));
    expect(screen.getByText('In Escrow')).toBeDefined();
  });

  it('renders Released for the released status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.RELEASED }));
    expect(screen.getByText('Released')).toBeDefined();
  });

  it('renders Completed for the completed status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.COMPLETED }));
    expect(screen.getByText('Completed')).toBeDefined();
  });

  it('renders Failed for the failed status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.FAILED }));
    expect(screen.getByText('Failed')).toBeDefined();
  });

  it('renders Refunded for the refunded status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.REFUNDED }));
    expect(screen.getByText('Refunded')).toBeDefined();
  });

  it('renders Partially Refunded for the partially_refunded status', () => {
    render(
      createElement(PaymentStatusBadge, {
        status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      }),
    );
    expect(screen.getByText('Partially Refunded')).toBeDefined();
  });

  it('renders Disputed for the disputed status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.DISPUTED }));
    expect(screen.getByText('Disputed')).toBeDefined();
  });

  it('renders Chargeback for the chargeback status', () => {
    render(createElement(PaymentStatusBadge, { status: PAYMENT_STATUS.CHARGEBACK }));
    expect(screen.getByText('Chargeback')).toBeDefined();
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

  it('exposes getStatusLabel returning matching strings for each status', () => {
    expect(getStatusLabel(PAYMENT_STATUS.PENDING)).toBe('Pending');
    expect(getStatusLabel(PAYMENT_STATUS.PROCESSING)).toBe('Processing');
    expect(getStatusLabel(PAYMENT_STATUS.ESCROW)).toBe('In Escrow');
    expect(getStatusLabel(PAYMENT_STATUS.RELEASED)).toBe('Released');
    expect(getStatusLabel(PAYMENT_STATUS.COMPLETED)).toBe('Completed');
    expect(getStatusLabel(PAYMENT_STATUS.FAILED)).toBe('Failed');
    expect(getStatusLabel(PAYMENT_STATUS.REFUNDED)).toBe('Refunded');
    expect(getStatusLabel(PAYMENT_STATUS.PARTIALLY_REFUNDED)).toBe('Partially Refunded');
    expect(getStatusLabel(PAYMENT_STATUS.DISPUTED)).toBe('Disputed');
    expect(getStatusLabel(PAYMENT_STATUS.CHARGEBACK)).toBe('Chargeback');
    expect(getStatusLabel('weird_unknown_state')).toBe('weird unknown state');
  });

  it('exposes getStatusColor with a default fallback for unknown statuses', () => {
    expect(getStatusColor('definitely-not-a-status').length).toBeGreaterThan(0);
    expect(typeof getStatusColor(PAYMENT_STATUS.PENDING)).toBe('string');
  });
});
