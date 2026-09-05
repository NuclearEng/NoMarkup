import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentOutcome } from '@/lib/payment-outcome';

// MOCKED: the gateway (`@/lib/api`) and PaymentConfirmation. PROVEN: the
// auction-win recovery flow — that an unpaid order offers a way to pay, that
// every failure mode of the pay-retry endpoint produces an actionable
// message, and that only a settled outcome flips the surface to "paid".
// NOT PROVEN: that the backend route exists (it does not yet — see the
// report) or that Stripe accepts the confirmation.

const { post } = vi.hoisted(() => ({
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

class FakeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API error ${String(status)}`);
  }
  userMessage(fallback: string): string {
    return this.body || fallback;
  }
}

vi.mock('@/lib/api', () => ({
  api: { post },
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
  ApiError: FakeApiError,
}));

let capturedOnOutcome: ((outcome: PaymentOutcome) => void) | null = null;
vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: {
    onOutcome: (outcome: PaymentOutcome) => void;
    submitLabel: string;
  }) => {
    capturedOnOutcome = props.onOutcome;
    return createElement(
      'div',
      { 'data-testid': 'payment-confirmation' },
      props.submitLabel,
    );
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

const { OrderPaymentPrompt } = await import(
  '@/components/orders/OrderPaymentPrompt'
);

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function renderPrompt(onPaid?: () => void) {
  return render(
    <OrderPaymentPrompt
      orderId="order-1"
      amountCents={4000}
      platformFeeCents={400}
      onPaid={onPaid}
    />,
    { wrapper },
  );
}

describe('OrderPaymentPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnOutcome = null;
  });

  it('states the consequence of the unpaid order and itemises what is owed', () => {
    renderPrompt();
    expect(screen.getByText('Payment required')).toBeInTheDocument();
    expect(screen.getByTestId('order-payment-prompt')).toHaveTextContent(
      /nothing is held in escrow/i,
    );
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('$4.00')).toBeInTheDocument();
    // Sales tax is server-side, so we say so rather than printing a total.
    expect(screen.getByTestId('order-payment-prompt')).toHaveTextContent(
      /sales tax is calculated at checkout/i,
    );
  });

  it('points buyers at the saved-card surface to avoid the next failure', () => {
    renderPrompt();
    const link = screen.getByRole('link', { name: /Save a card on file/i });
    expect(link).toHaveAttribute('href', '/settings/payment-methods');
  });

  it('shows a skeleton, not a spinner, while checkout is being prepared', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    post.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    await waitFor(() => {
      expect(screen.getByTestId('order-payment-starting')).toBeInTheDocument();
    });

    resolve?.({ client_secret: TOKEN });
    await waitFor(() => {
      expect(screen.getByTestId('payment-confirmation')).toBeInTheDocument();
    });
  });

  it('mounts the payment form with the server total when one is returned', async () => {
    post.mockResolvedValue({ client_secret: TOKEN, total_cents: 4632 });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    const form = await screen.findByTestId('payment-confirmation');
    expect(form).toHaveTextContent('Pay $46.32');
    expect(post).toHaveBeenCalledWith(
      '/api/v1/orders/order-1/pay',
      undefined,
      expect.objectContaining({ 'Idempotency-Key': expect.any(String) as string }),
    );
  });

  it('degrades to "Pay now" when the server omits the total', async () => {
    post.mockResolvedValue({ client_secret: TOKEN });
    const user = userEvent.setup();
    renderPrompt();
    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    expect(await screen.findByTestId('payment-confirmation')).toHaveTextContent(
      'Pay now',
    );
  });

  it('explains a 200 that carries no usable secret instead of showing a dead form', async () => {
    post.mockResolvedValue({ payment_required: true, charge_error: 'nope' });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not open a secure checkout/i);
    expect(screen.queryByTestId('payment-confirmation')).toBeNull();
    // Error is wired to the retry control for screen readers.
    const retry = screen.getByRole('button', { name: /Try payment again/i });
    expect(retry).toHaveAttribute('aria-describedby', alert.id);
  });

  it('turns a missing backend route into guidance, not a raw 404', async () => {
    post.mockRejectedValue(new FakeApiError(404, 'not found'));
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not available yet/i,
    );
  });

  it('surfaces a decline from the pay-retry endpoint', async () => {
    post.mockRejectedValue(new FakeApiError(402, 'Your card was declined.'));
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your card was declined.',
    );
  });

  it('flips to a paid confirmation only on a settled outcome', async () => {
    post.mockResolvedValue({ client_secret: TOKEN });
    const onPaid = vi.fn();
    const user = userEvent.setup();
    renderPrompt(onPaid);

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    await screen.findByTestId('payment-confirmation');

    // A decline changes nothing on this surface.
    capturedOnOutcome?.({
      kind: 'requires_payment_method',
      settled: false,
      retryable: true,
      message: 'declined',
      paymentIntentId: null,
    });
    expect(onPaid).not.toHaveBeenCalled();
    expect(screen.getByTestId('payment-confirmation')).toBeInTheDocument();

    capturedOnOutcome?.({
      kind: 'succeeded',
      settled: true,
      retryable: false,
      message: 'ok',
      paymentIntentId: 'pi_1',
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/payment received/i);
    });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('order-payment-prompt')).toBeNull();
  });
});
