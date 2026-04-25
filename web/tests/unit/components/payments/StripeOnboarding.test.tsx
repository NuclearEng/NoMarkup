import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { StripeOnboarding } from '@/components/payments/StripeOnboarding';
import { ApiError } from '@/lib/api';

vi.mock('@/hooks/usePayments', () => ({
  useStripeAccountStatus: vi.fn(),
  useCreateStripeAccount: vi.fn(),
  useStripeOnboardingLink: vi.fn(),
}));

const {
  useStripeAccountStatus,
  useCreateStripeAccount,
  useStripeOnboardingLink,
} = await import('@/hooks/usePayments');

const useStatus = vi.mocked(useStripeAccountStatus);
const useCreate = vi.mocked(useCreateStripeAccount);
const useLink = vi.mocked(useStripeOnboardingLink);

function defaultCreate() {
  return {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCreateStripeAccount>;
}

function defaultLink() {
  return {
    refetch: vi.fn().mockResolvedValue({ data: undefined }),
    isFetching: false,
  } as unknown as ReturnType<typeof useStripeOnboardingLink>;
}

describe('StripeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreate.mockReturnValue(defaultCreate());
    useLink.mockReturnValue(defaultLink());
  });

  it('shows loading state while fetching status', () => {
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText(/Checking Stripe status/)).toBeDefined();
  });

  it('shows the Connect with Stripe CTA when no account exists', () => {
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not found'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    // "Connect with Stripe" appears in both the heading and the button label.
    expect(screen.getAllByText('Connect with Stripe').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Connect with Stripe/ })).toBeDefined();
  });

  it('shows incomplete state when charges/payouts are not enabled', () => {
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: ['legal_entity.verification.document'],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText('Complete Stripe Setup')).toBeDefined();
    expect(screen.getByText(/Pending requirements/)).toBeDefined();
    expect(screen.getByText(/legal entity.verification.document/)).toBeDefined();
  });

  it('shows fully connected state when everything is enabled', () => {
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText('Stripe Connected')).toBeDefined();
    expect(screen.getByText('Charges enabled')).toBeDefined();
    expect(screen.getByText('Payouts enabled')).toBeDefined();
  });
});
