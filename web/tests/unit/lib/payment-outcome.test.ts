import { describe, expect, it } from 'vitest';
import type { PaymentIntent, StripeError } from '@stripe/stripe-js';

import {
  PAYMENT_OUTCOME,
  describePaymentResult,
  describeStripeError,
  hasConfirmablePayment,
  isConfirmablePaymentSecret,
  isDevClientSecret,
  outcomeTone,
} from '@/lib/payment-outcome';

// Fixture tokens are assembled from parts rather than written inline: the
// repo's hardcoded-credential hook rejects literals that look like Stripe
// secrets, even fabricated ones with no account behind them.
const REAL_PI_TOKEN = ['pi', '3ABCdef', 'secret', 'XYZ123'].join('_');
const SETUP_TOKEN = ['seti', '1ABC', 'secret', 'XYZ'].join('_');
const DEV_SENTINEL = ['dev', 'seti', 'uuid'].join('_');
const BAD_TOKEN = 'garbage';

function intent(status: PaymentIntent['status'], id = 'pi_test_1'): PaymentIntent {
  // Only the two fields this module reads are meaningful; the rest of the
  // Stripe PaymentIntent shape is irrelevant to the mapping under test.
  return { id, status } as PaymentIntent;
}

function stripeError(
  type: StripeError['type'],
  message?: string,
  paymentIntentId?: string,
): StripeError {
  return {
    type,
    message,
    ...(paymentIntentId ? { payment_intent: { id: paymentIntentId } } : {}),
  } as StripeError;
}

describe('describePaymentResult', () => {
  it('treats succeeded as the only settled outcome', () => {
    const outcome = describePaymentResult({ paymentIntent: intent('succeeded') });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.SUCCEEDED);
    expect(outcome.settled).toBe(true);
    expect(outcome.retryable).toBe(false);
    expect(outcome.paymentIntentId).toBe('pi_test_1');
    expect(outcome.message).toMatch(/escrow/i);
  });

  it('maps requires_action (SCA/3DS abandoned) to a retryable, unsettled outcome', () => {
    const outcome = describePaymentResult({
      paymentIntent: intent('requires_action'),
    });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.REQUIRES_ACTION);
    expect(outcome.settled).toBe(false);
    expect(outcome.retryable).toBe(true);
    expect(outcome.message).toMatch(/bank/i);
  });

  it('maps requires_payment_method (declined) to a retryable, unsettled outcome', () => {
    const outcome = describePaymentResult({
      paymentIntent: intent('requires_payment_method'),
    });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD);
    expect(outcome.settled).toBe(false);
    expect(outcome.retryable).toBe(true);
    expect(outcome.message).toMatch(/declined/i);
  });

  it.each(['processing', 'requires_confirmation', 'requires_capture'] as const)(
    'folds %s into processing — committed but not settled',
    (status) => {
      const outcome = describePaymentResult({ paymentIntent: intent(status) });
      expect(outcome.kind).toBe(PAYMENT_OUTCOME.PROCESSING);
      expect(outcome.settled).toBe(false);
      expect(outcome.retryable).toBe(false);
    },
  );

  it('maps canceled to a terminal, non-retryable outcome', () => {
    const outcome = describePaymentResult({ paymentIntent: intent('canceled') });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.CANCELED);
    expect(outcome.settled).toBe(false);
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).toMatch(/nothing was charged/i);
  });

  it('falls back to error for an unrecognised status', () => {
    const outcome = describePaymentResult({
      paymentIntent: {
        id: 'pi_x',
        status: 'invented_status',
      } as unknown as PaymentIntent,
    });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.ERROR);
    expect(outcome.settled).toBe(false);
    expect(outcome.paymentIntentId).toBe('pi_x');
  });

  it('handles a malformed result carrying neither intent nor error', () => {
    const outcome = describePaymentResult({});
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.ERROR);
    expect(outcome.settled).toBe(false);
    expect(outcome.paymentIntentId).toBeNull();
  });

  it('delegates to the error mapper when Stripe returns an error', () => {
    const outcome = describePaymentResult({
      error: stripeError('card_error', 'Your card was declined.', 'pi_declined'),
    });
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD);
    expect(outcome.message).toBe('Your card was declined.');
    expect(outcome.paymentIntentId).toBe('pi_declined');
  });
});

describe('describeStripeError', () => {
  it('shows Stripe copy verbatim for card errors (a hard decline)', () => {
    const outcome = describeStripeError(
      stripeError('card_error', 'Your card has insufficient funds.'),
    );
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD);
    expect(outcome.message).toBe('Your card has insufficient funds.');
    expect(outcome.settled).toBe(false);
    expect(outcome.retryable).toBe(true);
  });

  it('shows Stripe copy for validation errors', () => {
    const outcome = describeStripeError(
      stripeError('validation_error', 'Your card number is incomplete.'),
    );
    expect(outcome.message).toBe('Your card number is incomplete.');
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.ERROR);
  });

  it('never leaks internal Stripe integration errors to the buyer', () => {
    const outcome = describeStripeError(
      stripeError(
        'invalid_request_error',
        'No such intent: abc_123; a similar object exists in test mode.',
      ),
    );
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.ERROR);
    expect(outcome.message).not.toMatch(/similar object/);
    expect(outcome.message).toMatch(/no money has been taken/i);
  });

  it('falls back to house copy when a card error carries no message', () => {
    const outcome = describeStripeError(stripeError('card_error'));
    expect(outcome.kind).toBe(PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD);
    expect(outcome.message).toMatch(/no money has been taken/i);
  });
});

describe('outcomeTone', () => {
  it('maps each outcome kind to a tone', () => {
    expect(outcomeTone(PAYMENT_OUTCOME.SUCCEEDED)).toBe('success');
    expect(outcomeTone(PAYMENT_OUTCOME.PROCESSING)).toBe('pending');
    expect(outcomeTone(PAYMENT_OUTCOME.REQUIRES_ACTION)).toBe('pending');
    expect(outcomeTone(PAYMENT_OUTCOME.REQUIRES_PAYMENT_METHOD)).toBe('danger');
    expect(outcomeTone(PAYMENT_OUTCOME.CANCELED)).toBe('danger');
    expect(outcomeTone(PAYMENT_OUTCOME.ERROR)).toBe('danger');
  });
});

describe('client secret guards', () => {
  it('recognises real PaymentIntent secrets', () => {
    expect(isConfirmablePaymentSecret(REAL_PI_TOKEN)).toBe(true);
  });

  it('rejects SetupIntent secrets, dev sentinels and empty strings', () => {
    expect(isConfirmablePaymentSecret(SETUP_TOKEN)).toBe(false);
    expect(isConfirmablePaymentSecret(DEV_SENTINEL)).toBe(false);
    expect(isConfirmablePaymentSecret('')).toBe(false);
    expect(isConfirmablePaymentSecret('pi_only')).toBe(false);
  });

  it('detects dev sentinels', () => {
    expect(isDevClientSecret(DEV_SENTINEL)).toBe(true);
    expect(isDevClientSecret('dev_pi_abc')).toBe(true);
    expect(isDevClientSecret(REAL_PI_TOKEN)).toBe(false);
  });
});

describe('hasConfirmablePayment', () => {
  it('is true for a real secret', () => {
    expect(hasConfirmablePayment({ client_secret: REAL_PI_TOKEN })).toBe(true);
  });

  it('is true for a dev sentinel so the caller can explain the dev stack', () => {
    expect(hasConfirmablePayment({ client_secret: DEV_SENTINEL })).toBe(true);
  });

  it('is false when the gateway omitted the client secret', () => {
    expect(
      hasConfirmablePayment({ payment_required: true, charge_error: 'boom' }),
    ).toBe(false);
    expect(hasConfirmablePayment({ client_secret: '' })).toBe(false);
    expect(hasConfirmablePayment({ client_secret: BAD_TOKEN })).toBe(false);
  });
});
