import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub Stripe SDK before the component is imported.
type ConfirmSetupResult = { error?: { message?: string } };
type PaymentRequestStub = {
  canMakePayment: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};
const stripeStub: {
  confirmSetup: ReturnType<typeof vi.fn>;
  paymentRequest: ReturnType<typeof vi.fn>;
} = {
  confirmSetup: vi.fn<() => Promise<ConfirmSetupResult>>(),
  // Returns a PaymentRequest-shaped stub. By default `canMakePayment`
  // resolves to null so the wallet button stays hidden — most tests
  // don't care about wallet rendering and asserting against a button
  // that may or may not appear is brittle. Tests that DO care override
  // this in beforeEach or per-test.
  paymentRequest: vi.fn<() => PaymentRequestStub>(() => ({
    canMakePayment: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
  })),
};
let stripeAvailable = true;
let elementsAvailable = true;

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'stripe-elements' }, children),
  PaymentElement: () =>
    createElement('div', { 'data-testid': 'stripe-payment-element' }, 'PaymentElement'),
  PaymentRequestButtonElement: () =>
    createElement('div', { 'data-testid': 'stripe-payment-request-button' }),
  useStripe: () => (stripeAvailable ? stripeStub : null),
  useElements: () => (elementsAvailable ? { getElement: vi.fn() } : null),
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
    stripeAvailable = true;
    elementsAvailable = true;
    stripeStub.confirmSetup.mockReset();
    stripeStub.paymentRequest.mockReset();
    // Default: wallet unavailable. Tests that exercise the wallet button
    // override this on a per-case basis.
    stripeStub.paymentRequest.mockImplementation(() => ({
      canMakePayment: vi.fn().mockResolvedValue(null),
      on: vi.fn(),
    }));
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

  it('rejects invalid expiration month in the dev card form', async () => {
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

    await user.type(screen.getByLabelText(/Last 4 digits/), '4242');
    await user.type(screen.getByLabelText(/Exp month/), '13');
    await user.type(screen.getByLabelText(/Exp year/), '2030');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    expect(screen.getByText(/Expiration month must be 1/)).toBeDefined();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid expiration year in the dev card form', async () => {
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

    await user.type(screen.getByLabelText(/Last 4 digits/), '4242');
    await user.type(screen.getByLabelText(/Exp month/), '6');
    await user.type(screen.getByLabelText(/Exp year/), '1999');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    expect(screen.getByText(/Expiration year must be 2025/)).toBeDefined();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces a network error when the dev mutation rejects', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network down'));
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

    await user.type(screen.getByLabelText(/Last 4 digits/), '4242');
    await user.type(screen.getByLabelText(/Exp month/), '6');
    await user.type(screen.getByLabelText(/Exp year/), '2030');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    await waitFor(() => {
      expect(screen.getByText('network down')).toBeDefined();
    });
  });

  it('strips non-digit characters from the last-four input', async () => {
    const user = userEvent.setup();
    useDevAddMock.mockReturnValue({
      mutateAsync: vi.fn(),
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

    const last4 = screen.getByLabelText(/Last 4 digits/);
    await user.type(last4, 'a4b2c');
    if (!(last4 instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(last4.value).toBe('42');
  });

  it('disables Cancel and shows pending Save text while a dev card request is in-flight', async () => {
    const user = userEvent.setup();
    useDevAddMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useAddDevPaymentMethod>);
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_xyz' }),
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
    expect(screen.getByText('Saving...')).toBeDefined();
    const cancel = screen.getByRole('button', { name: /^Cancel$/ });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
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

  it('changes the dev brand select value', async () => {
    const user = userEvent.setup();
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_zzz' }),
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
    const brand = screen.getByLabelText(/Brand/);
    await user.selectOptions(brand, 'amex');
    if (!(brand instanceof HTMLSelectElement)) throw new Error('expected select element');
    expect(brand.value).toBe('amex');
  });

  it('cancels the dev card form via the dev Cancel button', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_xyz' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Last 4 digits/)).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fallback error message when the dev mutation rejects with a non-Error value', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockRejectedValue('plain string');
    useDevAddMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useAddDevPaymentMethod>);
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'dev_seti_str' }),
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

    await user.type(screen.getByLabelText(/Last 4 digits/), '4242');
    await user.type(screen.getByLabelText(/Exp month/), '6');
    await user.type(screen.getByLabelText(/Exp year/), '2030');
    await user.click(screen.getByRole('button', { name: /Save Dev Card/ }));

    await waitFor(() => {
      expect(screen.getByText('Failed to add card.')).toBeDefined();
    });
  });

  it('calls onSuccess after a successful Stripe confirmSetup', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    stripeStub.confirmSetup.mockResolvedValue({ error: undefined });
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'pi_real_secret' }),
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
      expect(screen.getByTestId('stripe-payment-element')).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /Save Payment Method/ }));

    await waitFor(() => {
      expect(stripeStub.confirmSetup).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the Stripe error message when confirmSetup returns an error with a message', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    stripeStub.confirmSetup.mockResolvedValue({ error: { message: 'card declined' } });
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'pi_real_secret' }),
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
      expect(screen.getByTestId('stripe-payment-element')).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /Save Payment Method/ }));

    await waitFor(() => {
      expect(screen.getByText('card declined')).toBeDefined();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows a fallback error message when confirmSetup returns an error without a message', async () => {
    const user = userEvent.setup();
    stripeStub.confirmSetup.mockResolvedValue({ error: {} });
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

    await user.click(screen.getByRole('button', { name: /Save Payment Method/ }));

    await waitFor(() => {
      expect(screen.getByText('An unexpected error occurred.')).toBeDefined();
    });
  });

  it('no-ops on submit when the Stripe SDK is not yet available', async () => {
    const user = userEvent.setup();
    stripeAvailable = false;
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

    // Save button should be disabled while stripe isn't loaded.
    const save = screen.getByRole('button', { name: /Save Payment Method/ });
    if (!(save instanceof HTMLButtonElement)) throw new Error('expected button element');
    expect(save.disabled).toBe(true);
    expect(stripeStub.confirmSetup).not.toHaveBeenCalled();
  });

  it('cancels the Stripe form via its Cancel button', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ client_secret: 'pi_real_secret' }),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));
    await waitFor(() => {
      expect(screen.getByTestId('stripe-payment-element')).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows an Initializing… indicator while the setup intent request is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: { client_secret: string }) => void) | undefined;
    const pending = new Promise<{ client_secret: string }>((resolve) => {
      resolveCreate = resolve;
    });
    useCreateSetupMock.mockReturnValue({
      mutateAsync: vi.fn().mockReturnValue(pending),
      isError: false,
    } as unknown as ReturnType<typeof useCreateSetupIntent>);

    render(
      createElement(AddPaymentMethodForm, {
        onSuccess: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    await user.click(screen.getByRole('button', { name: /Enter Payment Details/ }));

    expect(screen.getByText('Initializing...')).toBeDefined();

    resolveCreate?.({ client_secret: 'pi_done' });
    await waitFor(() => {
      expect(screen.queryByText('Initializing...')).toBeNull();
    });
  });

  it('renders the Apple Pay / Google Pay button when the wallet is available', async () => {
    const user = userEvent.setup();
    // Override the default null-canMakePayment so the wallet renders.
    stripeStub.paymentRequest.mockImplementation(() => ({
      canMakePayment: vi.fn().mockResolvedValue({ applePay: true }),
      on: vi.fn(),
    }));
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
      expect(screen.getByTestId('stripe-payment-request-button')).toBeDefined();
    });
    expect(stripeStub.paymentRequest).toHaveBeenCalled();
  });

  it('omits the wallet button when canMakePayment returns falsy', async () => {
    const user = userEvent.setup();
    // Default beforeEach returns null — keep it.
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
    // Allow the canMakePayment promise to resolve before asserting absence.
    await waitFor(() => {
      expect(screen.queryByTestId('stripe-payment-request-button')).toBeNull();
    });
  });
});
