import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub Stripe SDK before the component is imported.
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'stripe-elements' }, children),
  PaymentElement: () =>
    createElement('div', { 'data-testid': 'stripe-payment-element' }, 'PaymentElement'),
  useStripe: () => ({ confirmSetup: vi.fn() }),
  useElements: () => ({ getElement: vi.fn() }),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => Promise.resolve(null),
}));

vi.mock('@/hooks/usePayments', () => ({
  useCreateSetupIntent: vi.fn(),
  useAddDevPaymentMethod: vi.fn(),
}));

const { useCreateSetupIntent, useAddDevPaymentMethod } = await import(
  '@/hooks/usePayments'
);
const { AddPaymentMethodForm } = await import(
  '@/components/payments/AddPaymentMethodForm'
);

const useCreateSetupMock = vi.mocked(useCreateSetupIntent);
const useDevAddMock = vi.mocked(useAddDevPaymentMethod);

function defaultDevAdd() {
  return {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  } as unknown as ReturnType<typeof useAddDevPaymentMethod>;
}

describe('AddPaymentMethodForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDevAddMock.mockReturnValue(defaultDevAdd());
  });

  it('renders the initial Enter Payment Details CTA', () => {
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(screen.getByRole('button', { name: /Enter Payment Details/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeDefined();
  });

  it('shows an error message when setup intent creation fails', () => {
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('boom')),
      isError: true,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(screen.getByText(/Failed to initialize payment setup/)).toBeDefined();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel,
      }),
    );

    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the Stripe PaymentElement after a real client_secret is fetched', async () => {
    const user = userEvent.setup();
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'pi_real_secret' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));

    await waitFor(() => {
      expect(screen.getByTestId('stripe-payment-element')).toBeDefined();
    });
  });

  it('falls back to the dev card form when client_secret is a dev sentinel', async () => {
    const user = userEvent.setup();
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_abc-123' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Brand/)).toBeDefined();
    });
    expect(screen.getByLabelText(/Last 4 digits/)).toBeDefined();
  });

  it('rejects invalid last-four digits in the dev card form', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    useDevAddMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useAddDevPaymentMethod>);
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_abc' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Last 4 digits/)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/Last 4 digits/), '12');
    await user.type(screen.getByLabelText(/Exp month/), '12');
    await user.type(screen.getByLabelText(/Exp year/), '2030');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    expect(screen.getByText(/Last four must be exactly 4 digits/)).toBeDefined();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('submits the dev card form with valid input', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue({});
    useDevAddMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useAddDevPaymentMethod>);
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_xyz' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess,
        onCancel: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Last 4 digits/)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/Last 4 digits/), '4242');
    await user.type(screen.getByLabelText(/Exp month/), '12');
    await user.type(screen.getByLabelText(/Exp year/), '2030');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        brand: 'visa',
        last_four: '4242',
        exp_month: 12,
        exp_year: 2030,
      });
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
