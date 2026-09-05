import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// MOCKED: `next/dynamic` (resolved eagerly to a stub so we can assert the
// island *would* mount with the right props without pulling Stripe into the
// test) and `@/lib/stripe`'s configuration probe.
//
// PROVEN: the three pre-mount guards. Mounting Stripe Elements with a bad
// client secret throws an uncatchable IntegrationError and leaves a dead
// iframe, so "which secrets never reach Elements" is the thing that matters.
//
// NOT PROVEN: that a good secret really initialises Elements (needs Stripe).

vi.mock('next/dynamic', () => ({
  default: () =>
    function LazyStripeForm(props: Record<string, unknown>) {
      return createElement('div', {
        'data-testid': 'lazy-stripe-form',
        'data-submit-label': String(props.submitLabel),
        'data-return-path': String(props.returnPath),
      });
    },
}));

let stripeConfigured = true;
vi.mock('@/lib/stripe', () => ({
  getStripe: () => Promise.resolve(null),
  isStripeConfigured: () => stripeConfigured,
}));

const { PaymentConfirmation } = await import(
  '@/components/payments/PaymentConfirmation'
);

const REAL_TOKEN = ['pi', '3Test', 'secret', 'abc123'].join('_');
const DEV_TOKEN = ['dev', 'seti', 'abc'].join('_');

function renderWith(clientSecret: string) {
  return render(
    <PaymentConfirmation
      clientSecret={clientSecret}
      submitLabel="Pay $10.00"
      returnPath="/orders/o1"
      onOutcome={vi.fn()}
      className="custom-class"
    />,
  );
}

describe('PaymentConfirmation', () => {
  beforeEach(() => {
    stripeConfigured = true;
  });

  it('lazy-loads the Elements island for a real PaymentIntent secret', () => {
    renderWith(REAL_TOKEN);
    const island = screen.getByTestId('lazy-stripe-form');
    expect(island.dataset.submitLabel).toBe('Pay $10.00');
    expect(island.dataset.returnPath).toBe('/orders/o1');
  });

  it('accepts a className so hosts can position it', () => {
    const { container } = renderWith(REAL_TOKEN);
    expect(container.querySelector('.custom-class')).not.toBeNull();
  });

  it('explains a dev-sentinel secret instead of faking a completed payment', () => {
    renderWith(DEV_TOKEN);
    expect(screen.queryByTestId('lazy-stripe-form')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/without Stripe keys/i);
    // Must not offer any "mark as paid" affordance — that is the exact lie
    // this feature exists to remove.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('refuses to mount Elements on an unconfirmable secret', () => {
    renderWith('not-a-real-secret');
    expect(screen.queryByTestId('lazy-stripe-form')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/secure checkout/i);
  });

  it('falls back to the house notice when no publishable key is configured', () => {
    stripeConfigured = false;
    renderWith(REAL_TOKEN);
    expect(screen.queryByTestId('lazy-stripe-form')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/aren't set up yet/i);
  });
});
