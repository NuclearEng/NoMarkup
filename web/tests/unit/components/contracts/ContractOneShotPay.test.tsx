import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import type { PaymentOutcome } from '@/lib/payment-outcome';
import type { Payment } from '@/types';

// MOCKED: the payment hooks (`@/hooks/usePayments`) and PaymentConfirmation
// (Stripe Elements). PROVEN: which surface the customer sees for each payment
// state, the exact payload sent to create/process, that only a settled or
// processing outcome captures into escrow, and every error message.
// NOT PROVEN: that Stripe accepts the confirmation or the gateway routes exist.

interface CreateInput {
  contract_id: string;
  provider_id: string;
  amount_cents: number;
}
interface ProcessInput {
  paymentId: string;
  payment_method_id: string;
}
interface Created {
  id: string;
  client_secret?: string;
}

const hooks = vi.hoisted(() => ({
  listParams: vi.fn<(params: unknown) => void>(),
  payments: {
    data: undefined as { payments: unknown[] } | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn<() => Promise<unknown>>(),
  },
  create: {
    mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
    isPending: false,
  },
  process: {
    mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
    isPending: false,
  },
}));

vi.mock('@/hooks/usePayments', () => ({
  usePayments: (params: unknown) => {
    hooks.listParams(params);
    return hooks.payments;
  },
  useCreatePayment: () => hooks.create,
  useProcessPayment: () => hooks.process,
}));

let capturedOnOutcome: ((outcome: PaymentOutcome) => void) | null = null;
vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: {
    clientSecret: string;
    submitLabel: string;
    returnPath: string;
    onOutcome: (outcome: PaymentOutcome) => void;
    onCancel: () => void;
  }) => {
    capturedOnOutcome = props.onOutcome;
    return createElement(
      'div',
      {
        'data-testid': 'payment-confirmation',
        'data-secret': props.clientSecret,
        'data-return-path': props.returnPath,
      },
      createElement('span', null, props.submitLabel),
      createElement('button', { type: 'button', onClick: props.onCancel }, 'Cancel payment'),
    );
  },
}));

const { ContractOneShotPay } = await import('@/components/contracts/ContractOneShotPay');

const REAL_SECRET = ['pi', '3Test', 'secret', 'abc'].join('_');
const DEV_SECRET = 'dev_secret_1';

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 'pay-1',
    contract_id: 'contract-1',
    customer_id: 'cust-1',
    provider_id: 'prov-1',
    amount_cents: 123456,
    platform_fee_cents: 0,
    guarantee_fee_cents: 0,
    provider_payout_cents: 0,
    status: 'pending',
    refund_amount_cents: 0,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function outcome(overrides: Partial<PaymentOutcome>): PaymentOutcome {
  return {
    kind: 'succeeded',
    settled: true,
    retryable: false,
    message: 'ok',
    paymentIntentId: 'pi_3Test',
    ...overrides,
  };
}

function created(value: Created): Promise<Created> {
  return Promise.resolve(value);
}

function renderPay(amountCents = 123456) {
  return render(
    <ContractOneShotPay
      contractId="contract-1"
      providerId="prov-1"
      amountCents={amountCents}
      className="extra-class"
    />,
  );
}

async function openCheckout(user: ReturnType<typeof userEvent.setup>) {
  hooks.create.mutateAsync.mockReturnValue(created({ id: 'pay-9', client_secret: REAL_SECRET }));
  await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
  await screen.findByTestId('payment-confirmation');
}

beforeEach(() => {
  hooks.listParams.mockReset();
  hooks.payments.data = { payments: [] };
  hooks.payments.isLoading = false;
  hooks.payments.isError = false;
  hooks.payments.refetch.mockReset();
  hooks.payments.refetch.mockResolvedValue(undefined);
  hooks.create.mutateAsync.mockReset();
  hooks.create.isPending = false;
  hooks.process.mutateAsync.mockReset();
  hooks.process.mutateAsync.mockResolvedValue({});
  hooks.process.isPending = false;
  capturedOnOutcome = null;
});

describe('ContractOneShotPay — existing payment states', () => {
  it('asks for the 50 most recent payments so an existing charge is found', () => {
    renderPay();
    expect(hooks.listParams).toHaveBeenCalledWith({ per_page: 50 });
  });

  it('shows a skeleton with a spoken status while payments are loading', () => {
    hooks.payments.data = undefined;
    hooks.payments.isLoading = true;
    renderPay();
    expect(screen.getByTestId('contract-one-shot-loading')).toHaveClass('extra-class');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking whether this contract can be paid',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('refuses to offer payment when existing payments cannot be checked, and retries on request', async () => {
    const user = userEvent.setup();
    hooks.payments.data = undefined;
    hooks.payments.isError = true;
    renderPay();
    expect(screen.getByRole('alert')).toHaveTextContent(/so you are\s+not charged twice/);
    expect(screen.queryByRole('button', { name: /Pay and hold escrow/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hooks.payments.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(['escrow', 'released', 'completed', 'partially_refunded'])(
    'renders nothing once this contract has a %s payment',
    (status) => {
      hooks.payments.data = { payments: [payment({ status })] };
      const { container } = renderPay();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('ignores funded payments that belong to a different contract', () => {
    hooks.payments.data = {
      payments: [payment({ contract_id: 'contract-other', status: 'escrow' })],
    };
    renderPay();
    expect(screen.getByRole('button', { name: /Pay and hold escrow · \$1,234\.56/ })).toBeEnabled();
  });

  it.each(['pending', 'processing'])(
    'blocks a second charge while a %s payment is open and offers a refresh',
    async (status) => {
      const user = userEvent.setup();
      hooks.payments.data = { payments: [payment({ status })] };
      renderPay();
      expect(screen.getByTestId('contract-one-shot-inflight')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/already in progress/);
      expect(screen.queryByRole('button', { name: /Pay and hold escrow/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Refresh payment status' }));
      expect(hooks.payments.refetch).toHaveBeenCalledTimes(1);
      expect(hooks.create.mutateAsync).not.toHaveBeenCalled();
    },
  );

  it('offers payment again after a failed attempt', () => {
    hooks.payments.data = { payments: [payment({ status: 'failed' })] };
    renderPay();
    expect(screen.getByRole('button', { name: /Pay and hold escrow/ })).toBeEnabled();
  });
});

describe('ContractOneShotPay — starting a payment', () => {
  it('states the server amount and creates the payment with the contract values only', async () => {
    const user = userEvent.setup();
    renderPay();
    expect(screen.getByTestId('contract-one-shot-pay')).toHaveTextContent(
      /The charge is the server total \(\s*\$1,234\.56\), not a typed amount/,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    await openCheckout(user);

    expect(hooks.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(hooks.create.mutateAsync).toHaveBeenCalledWith({
      contract_id: 'contract-1',
      provider_id: 'prov-1',
      amount_cents: 123456,
    } satisfies CreateInput);
    const form = screen.getByTestId('payment-confirmation');
    expect(form).toHaveAttribute('data-secret', REAL_SECRET);
    expect(form).toHaveAttribute('data-return-path', '/contracts/contract-1');
    expect(form).toHaveTextContent('Pay $1,234.56');
    expect(hooks.process.mutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 0, '$0.00'],
    ['negative', -500, '-$5.00'],
    ['fractional', 1000.5, '$10.01'],
  ])('never creates a payment for a %s amount', async (_label, amount, formatted) => {
    const user = userEvent.setup();
    renderPay(amount);
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This contract has no server amount to charge.');
    expect(hooks.create.mutateAsync).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: `Try payment again · ${formatted}` });
    expect(retry).toHaveAttribute('aria-describedby', alert.id);
    expect(alert.id).toBe('contract-pay-error-contract-1');
  });

  it('captures straight away for the dev-stack secret and confirms escrow', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockReturnValue(created({ id: 'pay-dev', client_secret: DEV_SECRET }));
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    const done = await screen.findByTestId('contract-one-shot-paid');
    expect(hooks.process.mutateAsync).toHaveBeenCalledWith({
      paymentId: 'pay-dev',
      payment_method_id: '',
    } satisfies ProcessInput);
    expect(done).toHaveTextContent('Payment complete — $1,234.56 is held in escrow.');
    expect(done).toHaveClass('extra-class');
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reports a dev-stack capture failure with the server reason and lets the customer retry', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockReturnValue(created({ id: 'pay-dev', client_secret: DEV_SECRET }));
    hooks.process.mutateAsync.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: 'contract is not active' })),
    );
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('contract is not active');
    expect(screen.queryByTestId('contract-one-shot-paid')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try payment again · \$1,234\.56/ })).toBeEnabled();
  });

  it('rejects a payment that came back without an id', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockReturnValue(created({ id: '   ', client_secret: REAL_SECRET }));
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payment was created without an id. Try again.',
    );
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    expect(hooks.process.mutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['is missing', undefined],
    ['is not a PaymentIntent secret', 'seti_123_secret_abc'],
  ])('does not open checkout when the client secret %s', async (_label, secret) => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockReturnValue(created({ id: 'pay-9', client_secret: secret }));
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no confirmable client_secret was returned/,
    );
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    expect(hooks.process.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the gateway reason in dollars when creating the payment fails', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockRejectedValue(
      new ApiError(422, JSON.stringify({ error: 'amount must be at least 500 cents' })),
    );
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('amount must be at least $5.00');
  });

  it('falls back to a generic message when the failure is not an Error', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockImplementation(() =>
      Promise.reject({ reason: 'offline' } as unknown as Error),
    );
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start payment. Try again.',
    );
  });

  it('clears the previous error when the customer tries again', async () => {
    const user = userEvent.setup();
    hooks.create.mutateAsync.mockRejectedValueOnce(new Error('gateway timeout'));
    renderPay();
    await user.click(screen.getByRole('button', { name: /Pay and hold escrow/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('gateway timeout');

    hooks.create.mutateAsync.mockReturnValue(created({ id: 'pay-9', client_secret: REAL_SECRET }));
    await user.click(screen.getByRole('button', { name: /Try payment again/ }));
    await screen.findByTestId('payment-confirmation');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('replaces the pay button with a spoken skeleton while the payment is being created', () => {
    hooks.create.isPending = true;
    renderPay();
    expect(screen.getByTestId('contract-one-shot-starting')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing secure checkout');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ContractOneShotPay — confirming in the payment form', () => {
  it('captures into escrow after a settled confirmation', async () => {
    const user = userEvent.setup();
    renderPay();
    await openCheckout(user);

    capturedOnOutcome?.(outcome({ kind: 'succeeded', settled: true }));

    expect(await screen.findByTestId('contract-one-shot-paid')).toHaveTextContent(
      /\$1,234\.56 is held in escrow\. Release it after you approve the\s+work\./,
    );
    expect(hooks.process.mutateAsync).toHaveBeenCalledWith({
      paymentId: 'pay-9',
      payment_method_id: '',
    } satisfies ProcessInput);
  });

  it('captures a manual-capture intent that reports processing', async () => {
    const user = userEvent.setup();
    renderPay();
    await openCheckout(user);

    capturedOnOutcome?.(outcome({ kind: 'processing', settled: false }));

    await screen.findByTestId('contract-one-shot-paid');
    expect(hooks.process.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['requires_payment_method', 'requires_action', 'canceled', 'error'] as const)(
    'does not capture or claim success for a %s outcome',
    async (kind) => {
      const user = userEvent.setup();
      renderPay();
      await openCheckout(user);

      capturedOnOutcome?.(outcome({ kind, settled: false, retryable: true }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Payment not completed. Use the form below to try again.',
      );
      expect(hooks.process.mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByTestId('payment-confirmation')).toBeInTheDocument();
      expect(screen.queryByTestId('contract-one-shot-paid')).not.toBeInTheDocument();
    },
  );

  it('keeps the form open with the reason when capture fails after confirmation', async () => {
    const user = userEvent.setup();
    hooks.process.mutateAsync.mockRejectedValue('nope');
    renderPay();
    await openCheckout(user);

    capturedOnOutcome?.(outcome({ kind: 'succeeded', settled: true }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not capture payment. Try again.',
    );
    expect(screen.getByTestId('payment-confirmation')).toBeInTheDocument();
    expect(screen.queryByTestId('contract-one-shot-paid')).not.toBeInTheDocument();
  });

  it('swaps the form for a spoken skeleton while the capture is in flight', async () => {
    const user = userEvent.setup();
    const view = renderPay();
    await openCheckout(user);

    hooks.process.isPending = true;
    view.rerender(
      <ContractOneShotPay contractId="contract-1" providerId="prov-1" amountCents={123456} />,
    );

    expect(screen.getByTestId('contract-one-shot-capturing')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Capturing payment into escrow');
    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
  });

  it('reopens the same checkout after cancelling instead of creating a second payment', async () => {
    const user = userEvent.setup();
    renderPay();
    await openCheckout(user);
    capturedOnOutcome?.(outcome({ kind: 'canceled', settled: false }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Cancel payment' }));

    expect(screen.queryByTestId('payment-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const resume = screen.getByRole('button', { name: /Continue payment · \$1,234\.56/ });
    expect(resume).not.toHaveAttribute('aria-describedby');

    await user.click(resume);

    await waitFor(() => {
      expect(screen.getByTestId('payment-confirmation')).toHaveAttribute(
        'data-secret',
        REAL_SECRET,
      );
    });
    expect(hooks.create.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the open checkout visible even if the payment list now shows it as pending', async () => {
    const user = userEvent.setup();
    const view = renderPay();
    await openCheckout(user);

    hooks.payments.data = { payments: [payment({ id: 'pay-9', status: 'pending' })] };
    view.rerender(
      <ContractOneShotPay contractId="contract-1" providerId="prov-1" amountCents={123456} />,
    );

    expect(screen.getByTestId('payment-confirmation')).toBeInTheDocument();
    expect(screen.queryByTestId('contract-one-shot-inflight')).not.toBeInTheDocument();
  });
});
