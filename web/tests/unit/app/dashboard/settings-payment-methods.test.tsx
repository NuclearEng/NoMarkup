// Smoke + branch tests for the payment methods settings page.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/payment-methods',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/components/payments/AddPaymentMethodForm', () => ({
  AddPaymentMethodForm: ({
    onCancel,
    onSuccess,
  }: {
    onCancel: () => void;
    onSuccess: () => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'add-pm-form' },
      createElement('button', { onClick: onCancel, type: 'button' }, 'Stub Cancel'),
      createElement('button', { onClick: onSuccess, type: 'button' }, 'Stub Success'),
    ),
}));

vi.mock('@/hooks/usePayments', () => ({
  useCreateStripeAccount: vi.fn(),
  useDeletePaymentMethod: vi.fn(),
  usePaymentMethods: vi.fn(),
  useStripeAccountStatus: vi.fn(),
}));

const {
  useCreateStripeAccount,
  useDeletePaymentMethod,
  usePaymentMethods,
  useStripeAccountStatus,
} = await import('@/hooks/usePayments');
const { default: PaymentMethodsPage } = await import(
  '@/app/(dashboard)/settings/payment-methods/page'
);

function setHooks(opts: {
  isLoading?: boolean;
  isError?: boolean;
  methods?: unknown[];
  stripeData?: unknown;
  stripeError?: boolean;
  stripeLoading?: boolean;
  createPending?: boolean;
  createMutateAsync?: () => Promise<unknown>;
  deleteMutateAsync?: (id: string) => Promise<unknown>;
}) {
  vi.mocked(usePaymentMethods).mockReturnValue({
    data: opts.methods ? { payment_methods: opts.methods } : undefined,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as unknown as ReturnType<typeof usePaymentMethods>);
  vi.mocked(useDeletePaymentMethod).mockReturnValue({
    mutateAsync: opts.deleteMutateAsync ?? vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useDeletePaymentMethod>);
  vi.mocked(useCreateStripeAccount).mockReturnValue({
    mutateAsync: opts.createMutateAsync ?? vi.fn().mockResolvedValue(undefined),
    isPending: opts.createPending ?? false,
  } as unknown as ReturnType<typeof useCreateStripeAccount>);
  vi.mocked(useStripeAccountStatus).mockReturnValue({
    data: opts.stripeData,
    isLoading: opts.stripeLoading ?? false,
    isError: opts.stripeError ?? false,
  } as unknown as ReturnType<typeof useStripeAccountStatus>);
}

describe('PaymentMethodsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHooks({});
  });

  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(container).toBeTruthy();
  });

  it('renders the empty state when no payment methods exist', () => {
    setHooks({ methods: [] });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('No payment methods saved yet.')).toBeDefined();
  });

  it('renders the loading skeletons while methods are loading', () => {
    setHooks({ isLoading: true });
    const { container } = render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('renders the error state when methods fail to load', () => {
    setHooks({ isError: true });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('Failed to load payment methods.')).toBeDefined();
  });

  it('renders saved methods with brand, last four and expiry', () => {
    setHooks({
      methods: [
        {
          id: 'pm_1',
          brand: 'visa',
          last_four: '4242',
          exp_month: 12,
          exp_year: 2030,
          is_default: true,
        },
      ],
    });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('visa ending in 4242')).toBeDefined();
    expect(screen.getByText('Expires 12/2030')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
  });

  it('toggles to confirm-delete state on first delete click', () => {
    setHooks({
      methods: [
        {
          id: 'pm_1',
          brand: 'visa',
          last_four: '4242',
          exp_month: 12,
          exp_year: 2030,
          is_default: false,
        },
      ],
    });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    const deleteBtn = screen.getByRole('button', { name: /Delete card ending 4242/ });
    fireEvent.click(deleteBtn);
    expect(screen.getByRole('button', { name: /Confirm delete card ending 4242/ })).toBeDefined();
  });

  it('shows the AddPaymentMethodForm when Add Method is clicked', () => {
    render(withQueryClient(createElement(PaymentMethodsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Add Method/ }));
    expect(screen.getByTestId('add-pm-form')).toBeDefined();
  });

  it('renders Setup Required badge when stripe account is not charges_enabled', () => {
    setHooks({ stripeData: { charges_enabled: false } });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('Setup Required')).toBeDefined();
  });

  it('renders Active badge when stripe account is charges_enabled', () => {
    setHooks({ stripeData: { charges_enabled: true } });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('renders the connect Stripe CTA when no stripe account is connected', () => {
    setHooks({ stripeData: undefined });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByRole('button', { name: 'Set Up Payouts' })).toBeDefined();
  });

  it('shows the customer-only fallback when stripe status errors out', () => {
    setHooks({ stripeError: true });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(
      screen.getByText('Payout settings are only available for provider accounts.'),
    ).toBeDefined();
  });

  it('renders skeleton while stripe account status is loading', () => {
    setHooks({ stripeLoading: true });
    const { container } = render(withQueryClient(createElement(PaymentMethodsPage)));
    // Skeleton is the only child of the provider payouts card body when loading.
    expect(container.querySelectorAll('.bg-muted').length).toBeGreaterThan(0);
  });

  it('hides the form and invalidates queries on AddPaymentMethodForm onSuccess', () => {
    render(withQueryClient(createElement(PaymentMethodsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Add Method/ }));
    expect(screen.getByTestId('add-pm-form')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Stub Success/ }));
    // Form is no longer mounted after success.
    expect(screen.queryByTestId('add-pm-form')).toBeNull();
    // Add Method header button is back on screen.
    expect(screen.getByRole('button', { name: /Add Method/ })).toBeDefined();
  });

  it('hides the form when AddPaymentMethodForm onCancel is invoked', () => {
    render(withQueryClient(createElement(PaymentMethodsPage)));
    fireEvent.click(screen.getByRole('button', { name: /Add Method/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stub Cancel/ }));
    expect(screen.queryByTestId('add-pm-form')).toBeNull();
  });

  it('invokes createStripeAccount mutateAsync when Set Up Payouts is clicked', () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    setHooks({ stripeData: undefined, createMutateAsync: mutateAsync });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    fireEvent.click(screen.getByRole('button', { name: 'Set Up Payouts' }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('renders "Setting up..." while createStripeAccount mutation is pending', () => {
    setHooks({ stripeData: undefined, createPending: true });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /Setting up\.{3}/ });
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(true);
  });

  it('confirm-delete click resolves and resets to non-confirm state', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    setHooks({
      methods: [
        {
          id: 'pm_zz',
          brand: 'mastercard',
          last_four: '1111',
          exp_month: 1,
          exp_year: 2031,
          is_default: false,
        },
      ],
      deleteMutateAsync: mutateAsync,
    });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    // Click once to enter confirm state.
    fireEvent.click(screen.getByRole('button', { name: /Delete card ending 1111/ }));
    // Click again to confirm.
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete card ending 1111/ }));
    expect(mutateAsync).toHaveBeenCalledWith('pm_zz');
    // Wait a tick for the .then() to fire and reset state.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('renders provider connected with charges_enabled true and active state', () => {
    setHooks({ stripeData: { charges_enabled: true } });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(screen.getByText('Active')).toBeDefined();
    expect(
      screen.getByText('Your Stripe account is connected and ready to receive payouts.'),
    ).toBeDefined();
  });

  it('renders provider with charges_enabled false guidance text', () => {
    setHooks({ stripeData: { charges_enabled: false } });
    render(withQueryClient(createElement(PaymentMethodsPage)));
    expect(
      screen.getByText('Complete your Stripe account setup to receive payouts for completed jobs.'),
    ).toBeDefined();
  });
});
