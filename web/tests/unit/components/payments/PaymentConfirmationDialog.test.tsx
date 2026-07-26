import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentOutcome } from '@/lib/payment-outcome';

// MOCKED: PaymentConfirmation (replaced by buttons that fire a chosen
// outcome) and sonner. PROVEN: that only a settled outcome closes the dialog
// and runs the success callback, and that a decline leaves the buyer in the
// flow. NOT PROVEN: anything about Stripe itself.

let capturedOnOutcome: ((outcome: PaymentOutcome) => void) | null = null;
let capturedOnSubmitStart: (() => void) | null = null;

vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: (props: {
    onOutcome: (outcome: PaymentOutcome) => void;
    onSubmitStart?: () => void;
    onCancel?: () => void;
    submitLabel: string;
  }) => {
    capturedOnOutcome = props.onOutcome;
    capturedOnSubmitStart = props.onSubmitStart ?? null;
    return createElement(
      'div',
      { 'data-testid': 'payment-confirmation' },
      createElement('span', { 'data-testid': 'submit-label' }, props.submitLabel),
      props.onCancel
        ? createElement(
            'button',
            { type: 'button', onClick: props.onCancel },
            'Cancel',
          )
        : null,
    );
  },
}));

const { toastSuccess, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, info: toastInfo, error: vi.fn() },
}));

const { PaymentConfirmationDialog } = await import(
  '@/components/payments/PaymentConfirmationDialog'
);

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

function outcome(over: Partial<PaymentOutcome>): PaymentOutcome {
  return {
    kind: 'error',
    settled: false,
    retryable: true,
    message: 'msg',
    paymentIntentId: null,
    ...over,
  };
}

function renderDialog(props?: {
  amountCents?: number;
  itemPriceCents?: number;
  onOpenChange?: (open: boolean) => void;
  onSucceeded?: (o: PaymentOutcome) => void;
}) {
  const onOpenChange = props?.onOpenChange ?? vi.fn();
  const onSucceeded = props?.onSucceeded ?? vi.fn();
  render(
    <PaymentConfirmationDialog
      open
      onOpenChange={onOpenChange}
      clientSecret={TOKEN}
      amountCents={props?.amountCents}
      itemPriceCents={props?.itemPriceCents}
      returnPath="/orders/o1"
      onSucceeded={onSucceeded}
    />,
  );
  return { onOpenChange, onSucceeded };
}

describe('PaymentConfirmationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnOutcome = null;
    capturedOnSubmitStart = null;
  });

  it('labels the button with the server total when the API supplied one', () => {
    renderDialog({ amountCents: 4200 });
    expect(screen.getByTestId('submit-label')).toHaveTextContent('Pay $42.00');
    expect(screen.getByRole('dialog')).toHaveTextContent("You're paying $42.00");
  });

  it('never prints a total the server did not confirm', () => {
    // The gateway currently omits total_cents from buy-now/offer-accept, so
    // the item price must NOT be presented as the amount being charged.
    renderDialog({ itemPriceCents: 4000 });
    expect(screen.getByTestId('submit-label')).toHaveTextContent('Pay now');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Item price $40.00');
    expect(dialog).toHaveTextContent(/plus the platform fee/i);
  });

  it('falls back to neutral copy when neither figure is known', () => {
    renderDialog();
    expect(screen.getByTestId('submit-label')).toHaveTextContent('Pay now');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      /total is shown in the payment form/i,
    );
  });

  it('closes and reports success only on a settled outcome', () => {
    const { onOpenChange, onSucceeded } = renderDialog({ amountCents: 1000 });
    const settled = outcome({ kind: 'succeeded', settled: true, retryable: false });
    capturedOnOutcome?.(settled);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSucceeded).toHaveBeenCalledWith(settled);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('stays open on a hard decline so the buyer can retry', () => {
    const { onOpenChange, onSucceeded } = renderDialog({ amountCents: 1000 });
    capturedOnOutcome?.(
      outcome({ kind: 'requires_payment_method', message: 'Your card was declined.' }),
    );

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSucceeded).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('stays open on abandoned SCA', () => {
    const { onOpenChange, onSucceeded } = renderDialog({ amountCents: 1000 });
    capturedOnOutcome?.(outcome({ kind: 'requires_action' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it('acknowledges a processing payment without claiming it settled', () => {
    const { onSucceeded } = renderDialog({ amountCents: 1000 });
    capturedOnOutcome?.(outcome({ kind: 'processing', retryable: false }));
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it('cannot be dismissed while a confirmation is in flight', () => {
    const { onOpenChange } = renderDialog({ amountCents: 1000 });
    act(() => {
      capturedOnSubmitStart?.();
    });
    // Cancel is withdrawn mid-flight, so the buyer cannot walk away unsure
    // whether their card was charged.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    // Once the attempt resolves the exit reopens, but a failed attempt must
    // not close the dialog on its own.
    act(() => {
      capturedOnOutcome?.(outcome({ kind: 'requires_payment_method' }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('offers cancel when idle', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ amountCents: 1000 });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
