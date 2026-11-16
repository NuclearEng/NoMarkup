import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// MOCKED: the gateway (`@/lib/api`) and PaymentConfirmation. PROVEN: the
// cancel-unpaid failure copy per HTTP status, that a failed cancel leaves the
// order payable, that dismissing the confirm dialog cancels nothing, and that
// backing out of the payment form returns to the "Complete payment" CTA.

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
  clearIdempotencyKey: vi.fn(),
  getApiErrorMessage: (err: unknown, fallback: string) =>
    err instanceof FakeApiError ? err.userMessage(fallback) : fallback,
  forbiddenTransactMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: FakeApiError,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: { onCancel?: () => void; submitLabel: string }) =>
    createElement(
      'div',
      { 'data-testid': 'payment-confirmation' },
      props.submitLabel,
      createElement(
        'button',
        { type: 'button', onClick: props.onCancel },
        'Back out of payment',
      ),
    ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const { OrderPaymentPrompt } = await import('@/components/orders/OrderPaymentPrompt');

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function renderPrompt(onCanceled?: () => void) {
  return render(
    <OrderPaymentPrompt
      orderId="order-1"
      amountCents={123456}
      platformFeeCents={0}
      onCanceled={onCanceled}
    />,
    { wrapper },
  );
}

async function confirmCancel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Cancel unpaid order' }));
  await user.click(screen.getByRole('button', { name: 'Confirm cancel unpaid order' }));
}

describe('OrderPaymentPrompt — cancel failures and backing out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats large and zero amounts as dollars', () => {
    renderPrompt();
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it.each([
    [409, /can no longer be canceled.*listing stays sold/i],
    [403, /only the buyer on this order can cancel it/i],
    [500, /could not cancel this unpaid order\. refresh the page/i],
  ])('explains a %i from cancel-unpaid and keeps the order payable', async (status, copy) => {
    post.mockRejectedValue(new FakeApiError(status, ''));
    const onCanceled = vi.fn();
    const user = userEvent.setup();
    renderPrompt(onCanceled);

    await confirmCancel(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(copy);
    expect(onCanceled).not.toHaveBeenCalled();
    // The prompt is still there, with the error wired to the cancel control.
    expect(screen.getByTestId('order-payment-prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel unpaid order' })).toHaveAttribute(
      'aria-describedby',
      alert.id,
    );
    expect(screen.getByRole('button', { name: /Complete payment/i })).toBeEnabled();
  });

  it('prefers the server reason over the canned copy', async () => {
    post.mockRejectedValue(new FakeApiError(409, 'order already paid'));
    const user = userEvent.setup();
    renderPrompt();
    await confirmCancel(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('order already paid');
  });

  it('uses the generic copy when the failure is not an API error', async () => {
    post.mockRejectedValue(new TypeError('network down'));
    const user = userEvent.setup();
    renderPrompt();
    await confirmCancel(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not cancel this unpaid order/i,
    );
  });

  it('clears a previous cancel error when the buyer tries again', async () => {
    post.mockRejectedValueOnce(new FakeApiError(500, ''));
    const user = userEvent.setup();
    renderPrompt();
    await confirmCancel(user);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Cancel unpaid order' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dismissing the confirm dialog cancels nothing', async () => {
    const user = userEvent.setup();
    renderPrompt();
    await user.click(screen.getByRole('button', { name: 'Cancel unpaid order' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel action' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByTestId('order-payment-prompt')).toBeInTheDocument();
  });

  it('returns to the Complete payment CTA when the buyer backs out of the form', async () => {
    post.mockResolvedValue({ client_secret: TOKEN, total_cents: 4632 });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: /Complete payment/i }));
    await screen.findByTestId('payment-confirmation');
    await user.click(screen.getByRole('button', { name: 'Back out of payment' }));

    expect(screen.queryByTestId('payment-confirmation')).toBeNull();
    expect(screen.getByRole('button', { name: /Complete payment/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
