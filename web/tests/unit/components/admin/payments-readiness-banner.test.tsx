import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformBankAccount } from '@/types';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const isStripeConfiguredMock = vi.fn<() => boolean>();
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => isStripeConfiguredMock(),
}));

interface BankingState {
  data: { account: PlatformBankAccount | null } | undefined;
  isLoading: boolean;
}
const bankingState: BankingState = { data: undefined, isLoading: false };
vi.mock('@/hooks/useAdmin', () => ({
  usePlatformBanking: () => bankingState,
}));

const { PaymentsReadinessBanner } = await import(
  '@/components/admin/PaymentsReadinessBanner'
);

function fakeAccount(): PlatformBankAccount {
  return {
    id: 'acct_1',
    bank_name: 'Test Bank',
    account_holder_name: 'NoMarkup',
    account_holder_type: 'company',
    last4: '6789',
    routing_last4: '4321',
    currency: 'usd',
    country: 'US',
    status: 'verified',
    is_default: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('PaymentsReadinessBanner', () => {
  beforeEach(() => {
    isStripeConfiguredMock.mockReset();
    bankingState.data = undefined;
    bankingState.isLoading = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when Stripe is configured AND a bank account exists', () => {
    isStripeConfiguredMock.mockReturnValue(true);
    bankingState.data = { account: fakeAccount() };
    const { container } = render(<PaymentsReadinessBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('warns when Stripe has no publishable key', () => {
    isStripeConfiguredMock.mockReturnValue(false);
    bankingState.data = { account: fakeAccount() };
    render(<PaymentsReadinessBanner />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Payments are disabled/i)).toBeDefined();
    expect(screen.getByText(/No Stripe publishable key/i)).toBeDefined();
    expect(screen.getByRole('link', { name: /Set up platform payments/i })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/banking'),
    );
  });

  it('warns when Stripe is configured but no bank account is on file', () => {
    isStripeConfiguredMock.mockReturnValue(true);
    bankingState.data = { account: null };
    render(<PaymentsReadinessBanner />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/No platform payout bank account/i)).toBeDefined();
  });

  it('does not warn about the bank account while the banking query is still loading', () => {
    isStripeConfiguredMock.mockReturnValue(true);
    bankingState.data = undefined;
    bankingState.isLoading = true;
    const { container } = render(<PaymentsReadinessBanner />);
    // Stripe is configured and we don't yet know the bank account state, so the
    // banner stays hidden rather than flashing a false "not set up" warning.
    expect(container.firstChild).toBeNull();
  });

  it('lists both reasons when Stripe and banking are both missing', () => {
    isStripeConfiguredMock.mockReturnValue(false);
    bankingState.data = { account: null };
    render(<PaymentsReadinessBanner />);
    expect(screen.getByText(/No Stripe publishable key/i)).toBeDefined();
    // When Stripe is unconfigured the banking query is gated off, so only the
    // Stripe reason shows. This documents that gating.
    expect(screen.queryByText(/No platform payout bank account/i)).toBeNull();
  });
});
