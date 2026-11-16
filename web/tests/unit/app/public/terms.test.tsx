import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

import TermsOfServicePage from '@/app/(public)/terms/page';

describe('Terms of Service — F5 bid authorization', () => {
  it('ships bid-authorization under payments with tos-2026-08-12-bid-auth', () => {
    render(<TermsOfServicePage />);

    const payments = document.getElementById('payments');
    expect(payments).not.toBeNull();
    expect(payments?.getAttribute('data-tos-version')).toBe('tos-2026-08-12-bid-auth');

    expect(
      screen.getByText(/placing a bid or using Buy it now/i),
    ).toBeDefined();
    expect(
      screen.getByText(/authorizes NoMarkup to charge the payment method saved/i),
    ).toBeDefined();
    expect(
      screen.getByText(/winning amount plus disclosed platform fees and applicable tax/i),
    ).toBeDefined();
    expect(screen.getByText(/complete payment from the order page/i)).toBeDefined();
    expect(
      screen.getByText(
        /if payment has not been captured, you can cancel the unpaid order from the order page and the listing goes back on sale/i,
      ),
    ).toBeDefined();
    expect(
      screen.getByText(/a payment that can still be captured cannot be canceled that way/i),
    ).toBeDefined();
    expect(
      screen.getByText(/a paid plan renews at the price and interval shown until you cancel/i),
    ).toBeDefined();
    expect(screen.getByText(/Cancel in Settings → Subscription/)).toBeDefined();
    expect(
      screen.getByText(/sales tax is added only when the pickup state is configured for collection/i),
    ).toBeDefined();

    const marked = document.querySelector('[data-tos-version="tos-2026-08-12-bid-auth"]');
    expect(marked).not.toBeNull();
  });
});
