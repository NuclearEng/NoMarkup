import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    useCreate.mockReturnValue(defaultCreate());
    useLink.mockReturnValue(defaultLink());

    // Replace window.location with a writable stub so we can spy on href setters.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/payments', origin: 'http://localhost' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
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

  it('shows the create-account error message when create mutation errors', () => {
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not found'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);
    useCreate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useCreateStripeAccount>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText(/Failed to create Stripe account/)).toBeDefined();
  });

  it('shows the Setting up... indicator while create or link calls are in flight', () => {
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not found'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);
    useCreate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useCreateStripeAccount>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText('Setting up...')).toBeDefined();
    const button = screen.getByRole('button', { name: /Setting up/ });
    expect(button.disabled).toBe(true);
  });

  it('redirects to the Stripe-hosted onboarding URL when Connect with Stripe is clicked', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    const refetch = vi.fn().mockResolvedValue({
      data: { url: 'https://stripe.example/onboard' },
    });
    useCreate.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCreateStripeAccount>);
    useLink.mockReturnValue({
      refetch,
      isFetching: false,
    } as unknown as ReturnType<typeof useStripeOnboardingLink>);
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not found'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    await user.click(screen.getByRole('button', { name: /Connect with Stripe/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(window.location.href).toBe('https://stripe.example/onboard');
    });
  });

  it('does not redirect when the onboarding link refetch returns no URL', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    useCreate.mockReturnValue({
      mutateAsync,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCreateStripeAccount>);
    useLink.mockReturnValue({
      refetch,
      isFetching: false,
    } as unknown as ReturnType<typeof useStripeOnboardingLink>);
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not found'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    const before = window.location.href;
    await user.click(screen.getByRole('button', { name: /Connect with Stripe/ }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    expect(window.location.href).toBe(before);
  });

  it('renders no requirements section when the requirements array is empty', () => {
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.queryByText(/Pending requirements/)).toBeNull();
    expect(screen.getByRole('button', { name: /Complete Setup/ })).toBeDefined();
  });

  it('redirects via Complete Setup when an onboarding URL is returned', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue({
      data: { url: 'https://stripe.example/complete' },
    });
    useLink.mockReturnValue({
      refetch,
      isFetching: false,
    } as unknown as ReturnType<typeof useStripeOnboardingLink>);
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: ['external_account'],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    await user.click(screen.getByRole('button', { name: /Complete Setup/ }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(window.location.href).toBe('https://stripe.example/complete');
    });
  });

  it('does not redirect from Complete Setup when no URL is returned', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    useLink.mockReturnValue({
      refetch,
      isFetching: false,
    } as unknown as ReturnType<typeof useStripeOnboardingLink>);
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: ['external_account'],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    const before = window.location.href;
    await user.click(screen.getByRole('button', { name: /Complete Setup/ }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    expect(window.location.href).toBe(before);
  });

  it('shows the Loading... indicator while the onboarding link is fetching', () => {
    useLink.mockReturnValue({
      refetch: vi.fn(),
      isFetching: true,
    } as unknown as ReturnType<typeof useStripeOnboardingLink>);
    useStatus.mockReturnValue({
      data: {
        account_id: 'acct_123',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.getByText('Loading...')).toBeDefined();
    const button = screen.getByRole('button', { name: /Loading/ });
    expect(button.disabled).toBe(true);
  });

  it('shows the Connect CTA when status is errored without 404', () => {
    // isError true but error is not an ApiError 404 — the !accountStatus branch
    // still triggers the Connect view.
    useStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
    } as unknown as ReturnType<typeof useStripeAccountStatus>);

    render(createElement(StripeOnboarding));
    expect(screen.getByRole('button', { name: /Connect with Stripe/ })).toBeDefined();
  });
});
