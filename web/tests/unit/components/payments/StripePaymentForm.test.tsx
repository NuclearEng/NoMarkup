import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── What is mocked, and what that leaves unproven ─────────────────────────
//
// MOCKED: the entire Stripe SDK. `@stripe/react-stripe-js` is replaced with
// plain divs, and `stripe.confirmPayment` / `elements.submit` are vi.fn()s
// returning hand-written PaymentIntentResult shapes.
//
// PROVEN here: our own decision logic — that a `succeeded` intent is the only
// thing treated as paid, that `requires_action` (SCA) and a hard decline stay
// unsettled and re-enable retry, that the buyer sees the right message, and
// that the confirmation call is shaped the way the installed SDK's types
// require (`elements` + `redirect: 'if_required'` + a `return_url`).
//
// NOT PROVEN here: that Stripe accepts those arguments over the wire, that a
// real 3DS challenge renders, or that a real card is declined as expected.
// Those need Stripe test keys and a browser; see the report.

type StripeResult = {
  paymentIntent?: { id: string; status: string };
  error?: { type: string; message?: string };
};

interface ConfirmPaymentArgs {
  elements: unknown;
  redirect: string;
  confirmParams: { return_url: string };
}

const stripeStub = {
  confirmPayment: vi.fn<(args: ConfirmPaymentArgs) => Promise<StripeResult>>(),
};
const elementsStub = {
  submit: vi.fn<() => Promise<{ error?: { type: string; message?: string } }>>(),
};

let stripeAvailable = true;
let elementsAvailable = true;

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'stripe-elements' }, children),
  PaymentElement: () =>
    createElement('div', { 'data-testid': 'stripe-payment-element' }),
  useStripe: () => (stripeAvailable ? stripeStub : null),
  useElements: () => (elementsAvailable ? elementsStub : null),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => Promise.resolve(null),
  isStripeConfigured: () => true,
}));

const { default: StripePaymentForm } = await import(
  '@/components/payments/StripePaymentForm'
);

const CLIENT_TOKEN = ['pi', '3Test', 'secret', 'abc123'].join('_');

function renderForm(overrides?: {
  onOutcome?: (outcome: unknown) => void;
  onSubmitStart?: () => void;
  onCancel?: () => void;
}) {
  const onOutcome = overrides?.onOutcome ?? vi.fn();
  render(
    <StripePaymentForm
      clientSecret={CLIENT_TOKEN}
      returnPath="/orders/order-1"
      submitLabel="Pay $42.00"
      onOutcome={onOutcome}
      onSubmitStart={overrides?.onSubmitStart}
      onCancel={overrides?.onCancel}
    />,
  );
  return { onOutcome };
}

describe('StripePaymentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeAvailable = true;
    elementsAvailable = true;
    elementsStub.submit.mockResolvedValue({});
    stripeStub.confirmPayment.mockReset();
  });

  it('renders the payment element behind an accessible submit control', () => {
    renderForm();
    expect(screen.getByTestId('stripe-payment-element')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Pay $42.00' });
    expect(button).toBeEnabled();
    // 44px minimum touch target (WCAG 2.2 AA / CLAUDE.md §4).
    expect(button.className).toContain('min-h-[44px]');
    expect(screen.getByRole('group', { name: 'Payment details' })).toBeInTheDocument();
  });

  it('keeps submit disabled until Stripe.js has loaded', () => {
    stripeAvailable = false;
    renderForm();
    expect(screen.getByRole('button', { name: 'Pay $42.00' })).toBeDisabled();
  });

  it('confirms with the contract the installed SDK requires', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      paymentIntent: { id: 'pi_1', status: 'succeeded' },
    });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    await waitFor(() => {
      expect(stripeStub.confirmPayment).toHaveBeenCalledTimes(1);
    });
    // elements.submit() must run first so invalid fields are reported inline
    // instead of burning a confirmation attempt.
    expect(elementsStub.submit).toHaveBeenCalledTimes(1);

    const args = stripeStub.confirmPayment.mock.calls[0]?.[0];
    expect(args).toBeDefined();
    if (!args) throw new Error('confirmPayment was not called');
    expect(args.elements).toBe(elementsStub);
    expect(args.redirect).toBe('if_required');
    // return_url is mandatory for redirect-based methods even under
    // 'if_required', and is resolved at submit time (SSR-safe).
    expect(args.confirmParams.return_url).toBe(
      `${window.location.origin}/orders/order-1`,
    );
  });

  it('SUCCESS: announces settlement and reports a settled outcome', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      paymentIntent: { id: 'pi_ok', status: 'succeeded' },
    });
    const user = userEvent.setup();
    const { onOutcome } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/payment complete/i);
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'succeeded', settled: true }),
    );
    // Stays disabled after success so a double-tap can't re-enter a settled
    // payment.
    expect(screen.getByRole('button', { name: /Confirming payment/ })).toBeDisabled();
  });

  it('SCA: requires_action is surfaced as unsettled and retryable', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      paymentIntent: { id: 'pi_sca', status: 'requires_action' },
    });
    const user = userEvent.setup();
    const { onOutcome } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/bank needs to verify/i);
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'requires_action',
        settled: false,
        retryable: true,
      }),
    );
    // Re-enabled: the buyer must be able to try the challenge again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pay $42.00' })).toBeEnabled();
    });
  });

  it('HARD DECLINE: shows the issuer reason and never claims success', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      error: { type: 'card_error', message: 'Your card was declined.' },
    });
    const user = userEvent.setup();
    const { onOutcome } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Your card was declined.');
    expect(status).not.toHaveTextContent(/complete/i);
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'requires_payment_method',
        settled: false,
        retryable: true,
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pay $42.00' })).toBeEnabled();
    });
  });

  it('never leaks an internal Stripe error to the buyer', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      error: {
        type: 'invalid_request_error',
        message: 'No such intent: xyz; check your integration.',
      },
    });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    const status = await screen.findByRole('status');
    expect(status).not.toHaveTextContent(/integration/i);
    expect(status).toHaveTextContent(/no money has been taken/i);
  });

  it('reports a client-side validation failure without calling confirmPayment', async () => {
    elementsStub.submit.mockResolvedValue({
      error: { type: 'validation_error', message: 'Your card number is incomplete.' },
    });
    const user = userEvent.setup();
    const { onOutcome } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Your card number is incomplete.');
    expect(stripeStub.confirmPayment).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ settled: false }),
    );
  });

  it('notifies the host when an attempt starts so it can lock itself', async () => {
    stripeStub.confirmPayment.mockResolvedValue({
      paymentIntent: { id: 'pi_ok', status: 'succeeded' },
    });
    const onSubmitStart = vi.fn();
    const user = userEvent.setup();
    renderForm({ onSubmitStart });

    await user.click(screen.getByRole('button', { name: 'Pay $42.00' }));
    await waitFor(() => {
      expect(onSubmitStart).toHaveBeenCalledTimes(1);
    });
  });

  it('renders a cancel action only when the host supplies one', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderForm({ onCancel });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('omits cancel when no handler is given', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
