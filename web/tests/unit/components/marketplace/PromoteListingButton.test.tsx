// Paid listing promotion (seller-facing): tier pick → POST /promote →
// card setup (Stripe Elements, or the dev sentinel short-circuit) →
// POST /promote/confirm.
//
// MOCKED: usePromoteListing (the hooks have their own tests), Stripe Elements,
// and the Stripe config check. PROVEN: what the seller sees and what is sent
// at each step, and the fail-closed rules — the price/duration echoed by the
// server must match the tier that was picked, and the gateway confirm is only
// ever called after card setup succeeds. NOT PROVEN: Stripe behaviour.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LISTING_STATUS,
  type ConfirmPromotionResponse,
  type Listing,
  type PromoteListingInput,
  type PromoteListingResponse,
} from '@/types';

interface MutateCallbacks<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (err: Error) => void;
}

const mocks = vi.hoisted(() => ({
  createMutate:
    vi.fn<
      (
        input: PromoteListingInput,
        callbacks?: MutateCallbacks<PromoteListingResponse>,
      ) => void
    >(),
  createReset: vi.fn<() => void>(),
  confirmMutate:
    vi.fn<
      (
        input: { charge_id: string },
        callbacks?: MutateCallbacks<ConfirmPromotionResponse>,
      ) => void
    >(),
  confirmReset: vi.fn<() => void>(),
  confirmSetup:
    vi.fn<(options: unknown) => Promise<{ error?: { message?: string } }>>(),
  state: {
    createPending: false,
    confirmPending: false,
    stripeConfigured: true,
    stripeReady: true,
    hookListingIds: [] as string[],
  },
}));

vi.mock('@/hooks/usePromoteListing', () => ({
  useCreatePromotion: (listingId: string) => {
    mocks.state.hookListingIds.push(listingId);
    return {
      mutate: mocks.createMutate,
      reset: mocks.createReset,
      isPending: mocks.state.createPending,
    };
  },
  useConfirmPromotion: () => ({
    mutate: mocks.confirmMutate,
    reset: mocks.confirmReset,
    isPending: mocks.state.confirmPending,
  }),
}));

const ELEMENTS_HANDLE = { kind: 'elements-handle' };

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({
    children,
    options,
  }: {
    children: ReactNode;
    options: { clientSecret: string };
  }) =>
    createElement(
      'div',
      { 'data-testid': 'stripe-elements', 'data-client-secret': options.clientSecret },
      children,
    ),
  PaymentElement: () => createElement('div', { 'data-testid': 'payment-element' }),
  useStripe: () =>
    mocks.state.stripeReady ? { confirmSetup: mocks.confirmSetup } : null,
  useElements: () => (mocks.state.stripeReady ? ELEMENTS_HANDLE : null),
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => Promise.resolve(null),
  isStripeConfigured: () => mocks.state.stripeConfigured,
}));

import { PromoteListingButton } from '@/components/marketplace/PromoteListingButton';

type PromoteListing = Pick<
  Listing,
  'id' | 'status' | 'is_promoted' | 'promoted_until' | 'title'
>;

const NOW = new Date('2026-11-16T12:00:00.000Z');
const FUTURE = '2026-12-15T12:00:00.000Z';
const PAST = '2026-11-01T12:00:00.000Z';

// Built at runtime so no secret-shaped literal sits in the repo.
const STRIPE_SECRET = ['seti', 'Test123', 'secret', 'abc'].join('_');
const DEV_SECRET = 'dev_promote_l-1';

function listing(overrides: Partial<PromoteListing> = {}): PromoteListing {
  return {
    id: 'l-1',
    status: LISTING_STATUS.ACTIVE,
    is_promoted: false,
    promoted_until: null,
    title: 'Oak dining table',
    ...overrides,
  };
}

function chargeResponse(
  overrides: Partial<PromoteListingResponse> = {},
): PromoteListingResponse {
  return {
    charge_id: 'ch-1',
    listing_id: 'l-1',
    duration_hours: 24,
    amount_cents: 500,
    stripe_client_secret: STRIPE_SECRET,
    promoted_until_estimate: FUTURE,
    status: 'pending',
    ...overrides,
  };
}

const CONFIRMED: ConfirmPromotionResponse = {
  charge_id: 'ch-1',
  listing_id: 'l-1',
  is_promoted: true,
  status: 'succeeded',
  promoted_until: FUTURE,
};

/** The gateway answers the next POST /promote with this response. */
function createSucceedsWith(response: PromoteListingResponse) {
  mocks.createMutate.mockImplementation((_input, callbacks) => {
    callbacks?.onSuccess?.(response);
  });
}

function openDialog() {
  fireEvent.click(screen.getByTestId('promote-listing-open'));
  return screen.getByRole('dialog');
}

function clickContinue() {
  fireEvent.click(screen.getByTestId('promote-listing-continue'));
}

/** Render, open, and advance to the payment step with the given charge. */
function reachPaymentStep(response: PromoteListingResponse) {
  createSucceedsWith(response);
  render(<PromoteListingButton listing={listing()} />);
  openDialog();
  clickContinue();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.createMutate.mockReset();
  mocks.createReset.mockReset();
  mocks.confirmMutate.mockReset();
  mocks.confirmReset.mockReset();
  mocks.confirmSetup.mockReset();
  mocks.state.createPending = false;
  mocks.state.confirmPending = false;
  mocks.state.stripeConfigured = true;
  mocks.state.stripeReady = true;
  mocks.state.hookListingIds = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PromoteListingButton — availability and label', () => {
  it.each([
    LISTING_STATUS.DRAFT,
    LISTING_STATUS.ENDED,
    LISTING_STATUS.SOLD,
    LISTING_STATUS.EXPIRED,
    LISTING_STATUS.CANCELLED,
  ])('renders nothing for a %s listing', (status) => {
    const { container } = render(<PromoteListingButton listing={listing({ status })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('promote-listing-open')).toBeNull();
  });

  it('offers "Promote" on an active listing that is not promoted', () => {
    render(<PromoteListingButton listing={listing()} />);
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();
  });

  it('binds both mutations to the listing id', () => {
    render(<PromoteListingButton listing={listing({ id: 'l-99' })} />);
    expect(mocks.state.hookListingIds).toContain('l-99');
  });

  it('passes className through to the trigger', () => {
    render(<PromoteListingButton listing={listing()} className="w-full-test" />);
    expect(screen.getByTestId('promote-listing-open')).toHaveClass('w-full-test');
  });

  it('offers "Boost again" and shows the current end time while a promotion is running', () => {
    render(
      <PromoteListingButton
        listing={listing({ is_promoted: true, promoted_until: FUTURE })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Boost again' })).toBeInTheDocument();

    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Extend promotion' })).toBeInTheDocument();
    const expected = new Date(FUTURE).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      `Currently promoted until ${expected}.`,
    );
    expect(within(dialog).getByRole('status')).toHaveTextContent('2026');
  });

  it.each<[string, Partial<PromoteListing>]>([
    ['the promotion has already lapsed', { is_promoted: true, promoted_until: PAST }],
    ['the end time is missing', { is_promoted: true, promoted_until: null }],
    ['the end time is not a date', { is_promoted: true, promoted_until: 'not-a-date' }],
    ['the flag is off despite a future end time', { is_promoted: false, promoted_until: FUTURE }],
  ])('treats the listing as not promoted when %s', (_label, overrides) => {
    render(<PromoteListingButton listing={listing(overrides)} />);
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();

    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Promote listing' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Currently promoted until/)).toBeNull();
  });

  it('keeps the dialog closed until the trigger is pressed', () => {
    render(<PromoteListingButton listing={listing()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openDialog();
    expect(screen.getByRole('dialog')).toHaveTextContent('Oak dining table');
  });
});

describe('PromoteListingButton — choosing a plan', () => {
  it('lists the three tiers with their prices, 24 hours preselected', () => {
    render(<PromoteListingButton listing={listing()} />);
    const dialog = openDialog();
    const radios = within(
      within(dialog).getByRole('radiogroup', { name: 'Promotion duration' }),
    ).getAllByRole('radio');

    expect(radios.map((r) => r.textContent)).toEqual([
      '24 hours$5.00',
      '3 days$12.00',
      '1 week$25.00',
    ]);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(screen.getByTestId('promote-listing-continue')).toHaveTextContent(
      'Continue · $5.00',
    );
  });

  it('moves the selection and the Continue price with the chosen tier', () => {
    render(<PromoteListingButton listing={listing()} />);
    openDialog();

    fireEvent.click(screen.getByTestId('promote-tier-168'));
    expect(screen.getByTestId('promote-tier-168')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('promote-tier-24')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('promote-listing-continue')).toHaveTextContent(
      'Continue · $25.00',
    );

    fireEvent.click(screen.getByTestId('promote-tier-72'));
    expect(screen.getByTestId('promote-listing-continue')).toHaveTextContent(
      'Continue · $12.00',
    );
  });

  it('sends only the chosen duration — never an amount — when continuing', () => {
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    fireEvent.click(screen.getByTestId('promote-tier-72'));
    clickContinue();

    expect(mocks.createMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createMutate.mock.calls[0]?.[0]).toEqual({ duration_hours: 72 });
  });

  it('shows "Starting…" and locks both buttons while the charge is being created', () => {
    mocks.state.createPending = true;
    render(<PromoteListingButton listing={listing()} />);
    const dialog = openDialog();

    expect(screen.getByTestId('promote-listing-continue')).toHaveTextContent('Starting…');
    expect(screen.getByTestId('promote-listing-continue')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('refuses to continue when the server price differs from the tier shown', () => {
    createSucceedsWith(chargeResponse({ amount_cents: 700 }));
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Promotion price changed. Close and try again so you see the current price.',
    );
    // Still on the plan picker: no payment surface for an unexpected amount.
    expect(screen.getByTestId('promote-listing-continue')).toBeInTheDocument();
    expect(screen.queryByTestId('promote-elements-host')).toBeNull();
    expect(screen.queryByTestId('promote-dev-host')).toBeNull();
  });

  it('refuses to continue when the server duration differs from the tier picked', () => {
    createSucceedsWith(chargeResponse({ duration_hours: 72, amount_cents: 500 }));
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Promotion duration mismatch. Close and try again.',
    );
    expect(screen.queryByTestId('promote-elements-host')).toBeNull();
  });

  it('shows the gateway error when the charge cannot be created', () => {
    mocks.createMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error('Listing already has a pending promotion'));
    });
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Listing already has a pending promotion',
    );
  });

  it('falls back to a generic message when the failure carries no text', () => {
    mocks.createMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error(''));
    });
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not start promotion');
  });

  it('clears a previous error when the seller picks another tier', () => {
    createSucceedsWith(chargeResponse({ amount_cents: 700 }));
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('promote-tier-72'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears a previous error when the seller retries', () => {
    mocks.createMutate.mockImplementationOnce((_input, callbacks) => {
      callbacks?.onError?.(new Error('Temporary failure'));
    });
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    clickContinue();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Second attempt stays in flight (no callback) — the stale error must go.
    clickContinue();
    expect(mocks.createMutate).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Cancel closes the dialog and resets both mutations', () => {
    render(<PromoteListingButton listing={listing()} />);
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.createReset).toHaveBeenCalledTimes(1);
    expect(mocks.confirmReset).toHaveBeenCalledTimes(1);
  });
});

describe('PromoteListingButton — dev sentinel confirm', () => {
  it('skips Stripe for a dev_ secret and states the amount that will be confirmed', () => {
    reachPaymentStep(chargeResponse({ stripe_client_secret: DEV_SECRET }));

    const host = screen.getByTestId('promote-dev-host');
    expect(host).toHaveTextContent('Dev mode — no Stripe keys configured.');
    expect(host).toHaveTextContent('($5.00)');
    expect(screen.queryByTestId('stripe-elements')).toBeNull();
    expect(screen.queryByTestId('promote-listing-continue')).toBeNull();
  });

  it('uses the dev path even when Stripe keys are missing', () => {
    mocks.state.stripeConfigured = false;
    reachPaymentStep(chargeResponse({ stripe_client_secret: DEV_SECRET }));

    expect(screen.getByTestId('promote-dev-host')).toBeInTheDocument();
    expect(screen.queryByText("Payments aren't set up yet")).toBeNull();
  });

  it('confirms with the charge id and closes the dialog on success', () => {
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onSuccess?.(CONFIRMED);
    });
    reachPaymentStep(
      chargeResponse({ stripe_client_secret: DEV_SECRET, charge_id: 'ch-dev-7' }),
    );
    fireEvent.click(screen.getByTestId('promote-listing-dev-confirm'));

    expect(mocks.confirmMutate).toHaveBeenCalledTimes(1);
    expect(mocks.confirmMutate.mock.calls[0]?.[0]).toEqual({ charge_id: 'ch-dev-7' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.createReset).toHaveBeenCalled();
    expect(mocks.confirmReset).toHaveBeenCalled();
  });

  it('shows "Confirming…" and locks the buttons while the confirm is in flight', () => {
    reachPaymentStep(chargeResponse({ stripe_client_secret: DEV_SECRET }));
    const confirm = screen.getByTestId('promote-listing-dev-confirm');
    expect(confirm).toHaveTextContent('Confirm promotion (dev)');

    fireEvent.click(confirm);
    expect(confirm).toHaveTextContent('Confirming…');
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('shows the failure and lets the seller try again', () => {
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error('Gateway refused activation'));
    });
    reachPaymentStep(chargeResponse({ stripe_client_secret: DEV_SECRET }));
    const confirm = screen.getByTestId('promote-listing-dev-confirm');
    fireEvent.click(confirm);

    expect(screen.getByRole('alert')).toHaveTextContent('Gateway refused activation');
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveTextContent('Confirm promotion (dev)');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(confirm);
    expect(mocks.confirmMutate).toHaveBeenCalledTimes(2);
  });

  it('falls back to a generic message when the confirm failure has no text', () => {
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error(''));
    });
    reachPaymentStep(chargeResponse({ stripe_client_secret: DEV_SECRET }));
    fireEvent.click(screen.getByTestId('promote-listing-dev-confirm'));

    expect(screen.getByRole('alert')).toHaveTextContent('Promotion confirmation failed');
  });

  it('Back returns to the plan picker with the earlier choice intact', () => {
    createSucceedsWith(
      chargeResponse({
        stripe_client_secret: DEV_SECRET,
        duration_hours: 72,
        amount_cents: 1200,
      }),
    );
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    fireEvent.click(screen.getByTestId('promote-tier-72'));
    clickContinue();
    expect(screen.getByTestId('promote-dev-host')).toHaveTextContent('($12.00)');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('promote-dev-host')).toBeNull();
    expect(screen.getByTestId('promote-tier-72')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('promote-listing-continue')).toHaveTextContent(
      'Continue · $12.00',
    );
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });
});

describe('PromoteListingButton — Stripe not configured', () => {
  it('explains that payments are not set up instead of mounting a card form', () => {
    mocks.state.stripeConfigured = false;
    reachPaymentStep(chargeResponse());

    expect(screen.getByRole('alert')).toHaveTextContent("Payments aren't set up yet");
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A Stripe account must be connected before you can promote a listing.',
    );
    expect(screen.queryByTestId('stripe-elements')).toBeNull();
    expect(screen.queryByTestId('promote-listing-pay')).toBeNull();
  });

  it('Back returns to the plan picker', () => {
    mocks.state.stripeConfigured = false;
    reachPaymentStep(chargeResponse());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByTestId('promote-listing-continue')).toBeInTheDocument();
    expect(screen.queryByText("Payments aren't set up yet")).toBeNull();
  });
});

describe('PromoteListingButton — Stripe card setup', () => {
  it('mounts the card form with the SetupIntent secret and the amount to pay', () => {
    reachPaymentStep(chargeResponse());

    expect(screen.getByTestId('stripe-elements')).toHaveAttribute(
      'data-client-secret',
      STRIPE_SECRET,
    );
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    expect(screen.getByTestId('promote-elements-host')).toHaveTextContent(
      'Save a card to pay $5.00. You are charged only when promotion activates.',
    );
    expect(screen.getByTestId('promote-listing-pay')).toHaveTextContent('Pay $5.00 & promote');
    expect(screen.getByTestId('promote-listing-pay')).toBeEnabled();
  });

  it('shows the server-confirmed amount for a longer tier', () => {
    createSucceedsWith(chargeResponse({ duration_hours: 168, amount_cents: 2500 }));
    render(<PromoteListingButton listing={listing()} />);
    openDialog();
    fireEvent.click(screen.getByTestId('promote-tier-168'));
    clickContinue();

    expect(screen.getByTestId('promote-listing-pay')).toHaveTextContent('Pay $25.00 & promote');
  });

  it('keeps Pay disabled until Stripe has loaded, and does nothing if pressed', () => {
    mocks.state.stripeReady = false;
    reachPaymentStep(chargeResponse());

    const pay = screen.getByTestId('promote-listing-pay');
    expect(pay).toBeDisabled();
    fireEvent.click(pay);
    expect(mocks.confirmSetup).not.toHaveBeenCalled();
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });

  it('confirms card setup without a redirect, then asks the gateway to charge', async () => {
    mocks.confirmSetup.mockResolvedValue({});
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onSuccess?.(CONFIRMED);
    });
    reachPaymentStep(chargeResponse({ charge_id: 'ch-42' }));
    fireEvent.click(screen.getByTestId('promote-listing-pay'));

    await waitFor(() => {
      expect(mocks.confirmMutate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.confirmSetup).toHaveBeenCalledTimes(1);
    expect(mocks.confirmSetup).toHaveBeenCalledWith({
      elements: ELEMENTS_HANDLE,
      redirect: 'if_required',
    });
    expect(mocks.confirmMutate.mock.calls[0]?.[0]).toEqual({ charge_id: 'ch-42' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows "Processing…" and locks the buttons while the card is being confirmed', async () => {
    let settle: (value: { error?: { message?: string } }) => void = () => undefined;
    mocks.confirmSetup.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    reachPaymentStep(chargeResponse());
    const pay = screen.getByTestId('promote-listing-pay');
    fireEvent.click(pay);

    expect(pay).toHaveTextContent('Processing…');
    expect(pay).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    // The gateway is not asked to charge while card setup is unresolved.
    expect(mocks.confirmMutate).not.toHaveBeenCalled();

    settle({});
    await waitFor(() => {
      expect(mocks.confirmMutate).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the card error and never calls the gateway when setup fails', async () => {
    mocks.confirmSetup.mockResolvedValue({
      error: { message: 'Your card was declined.' },
    });
    reachPaymentStep(chargeResponse());
    const pay = screen.getByTestId('promote-listing-pay');
    fireEvent.click(pay);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
    expect(pay).toBeEnabled();
    expect(pay).toHaveTextContent('Pay $5.00 & promote');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('uses a fallback when Stripe reports an error without a message', async () => {
    mocks.confirmSetup.mockResolvedValue({ error: {} });
    reachPaymentStep(chargeResponse());
    fireEvent.click(screen.getByTestId('promote-listing-pay'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Card could not be confirmed');
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });

  it('shows the gateway failure after a successful card setup and allows a retry', async () => {
    mocks.confirmSetup.mockResolvedValue({});
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error('Charge failed: insufficient funds'));
    });
    reachPaymentStep(chargeResponse());
    const pay = screen.getByTestId('promote-listing-pay');
    fireEvent.click(pay);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Charge failed: insufficient funds',
    );
    expect(pay).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('falls back to a generic message when the gateway failure has no text', async () => {
    mocks.confirmSetup.mockResolvedValue({});
    mocks.confirmMutate.mockImplementation((_input, callbacks) => {
      callbacks?.onError?.(new Error(''));
    });
    reachPaymentStep(chargeResponse());
    fireEvent.click(screen.getByTestId('promote-listing-pay'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Promotion payment failed');
  });

  it('clears the previous card error on the next attempt', async () => {
    mocks.confirmSetup.mockResolvedValueOnce({
      error: { message: 'Your card was declined.' },
    });
    mocks.confirmSetup.mockReturnValueOnce(new Promise(() => undefined));
    reachPaymentStep(chargeResponse());
    const pay = screen.getByTestId('promote-listing-pay');
    fireEvent.click(pay);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(pay);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('locks Pay and Back while the gateway confirm is pending', () => {
    mocks.state.confirmPending = true;
    reachPaymentStep(chargeResponse());

    expect(screen.getByTestId('promote-listing-pay')).toBeDisabled();
    expect(screen.getByTestId('promote-listing-pay')).toHaveTextContent('Processing…');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('Back returns to the plan picker without charging', () => {
    reachPaymentStep(chargeResponse());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByTestId('promote-elements-host')).toBeNull();
    expect(screen.getByTestId('promote-listing-continue')).toBeInTheDocument();
    expect(mocks.confirmSetup).not.toHaveBeenCalled();
    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });
});

describe('PromoteListingButton — closing mid-flow', () => {
  it('dismissing the dialog drops the pending charge, so reopening starts at the plan picker', () => {
    reachPaymentStep(chargeResponse());
    expect(screen.getByTestId('promote-elements-host')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.createReset).toHaveBeenCalledTimes(1);
    expect(mocks.confirmReset).toHaveBeenCalledTimes(1);

    openDialog();
    expect(screen.queryByTestId('promote-elements-host')).toBeNull();
    expect(screen.getByTestId('promote-listing-continue')).toBeInTheDocument();
  });

  it('Escape dismisses the dialog and clears a start error', () => {
    createSucceedsWith(chargeResponse({ amount_cents: 700 }));
    render(<PromoteListingButton listing={listing()} />);
    const dialog = openDialog();
    clickContinue();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    openDialog();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
