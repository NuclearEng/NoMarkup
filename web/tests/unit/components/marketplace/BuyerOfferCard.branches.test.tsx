// BuyerOfferCard — status wording, action gating and the post-accept payment
// sheet. Complements BuyerOfferCard.test.tsx (loading / error / basic wiring)
// and OfferAcceptPayment.test.tsx.
// MOCKED: the offers query + update mutation (real depth helpers are kept so
// the "who is this awaiting" maths is the real logic) and the payment dialog
// (a stub exposing the props it receives).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Offer, OfferStatus } from '@/types';

interface AcceptResponse {
  order_id?: string;
  client_secret?: string;
  total_cents?: number;
}

interface MutateOptions {
  onSuccess?: (data: AcceptResponse) => void;
}

const state: {
  offers: Offer[] | undefined;
  isPending: boolean;
  requestedListingIds: string[];
} = { offers: [], isPending: false, requestedListingIds: [] };

const mutate =
  vi.fn<(input: { offerId: string; action: string }, options?: MutateOptions) => void>();

vi.mock('@/hooks/useOffers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOffers')>('@/hooks/useOffers');
  return {
    ...actual,
    useListingOffers: (listingId: string) => {
      state.requestedListingIds.push(listingId);
      return {
        isLoading: false,
        isError: false,
        data: state.offers ? { offers: state.offers } : undefined,
        refetch: vi.fn(),
      };
    },
    useUpdateOffer: () => ({ mutate, isPending: state.isPending }),
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

interface DialogProps {
  open: boolean;
  clientSecret: string;
  amountCents?: number;
  itemPriceCents?: number;
  returnPath: string;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSucceeded: () => void;
}

let dialog: DialogProps | null = null;
vi.mock('@/components/payments/PaymentConfirmationDialog', () => ({
  PaymentConfirmationDialog: (props: DialogProps) => {
    dialog = props;
    return createElement('div', { role: 'dialog', 'aria-label': props.title });
  },
}));

import { BuyerOfferCard } from '@/components/marketplace/BuyerOfferCard';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function offer(over: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-root',
    listing_id: 'listing-1',
    buyer_id: 'buyer-1',
    amount_cents: 45000,
    status: 'pending',
    parent_offer_id: null,
    expires_at: '2026-07-01T00:00:00Z',
    message: 'Would you take this?',
    created_at: '2026-06-01T11:00:00.000Z',
    updated_at: '2026-06-01T11:00:00.000Z',
    ...over,
  };
}

/** Newest-first chain: the seller's counter (depth 1) on top of the buyer's root. */
function counterChain(): Offer[] {
  return [
    offer({
      id: 'offer-counter',
      parent_offer_id: 'offer-root',
      amount_cents: 50000,
      message: 'Best I can do.',
    }),
    offer({ id: 'offer-root', status: 'countered' }),
  ];
}

function acceptWith(response: AcceptResponse) {
  fireEvent.click(screen.getByRole('button', { name: 'Accept counter' }));
  const options = mutate.mock.calls.at(-1)?.[1];
  if (!options?.onSuccess) throw new Error('accept was not sent with an onSuccess handler');
  const { onSuccess } = options;
  act(() => {
    onSuccess(response);
  });
}

function currentDialog(): DialogProps {
  if (!dialog) throw new Error('payment dialog was not rendered');
  return dialog;
}

// A dev-stack secret: accepted by hasConfirmablePayment without looking like
// a real Stripe credential.
const DEV_SECRET = ['dev', 'offer', 'accept'].join('_');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.offers = [];
  state.isPending = false;
  state.requestedListingIds = [];
  mutate.mockReset();
  dialog = null;
  return () => {
    vi.useRealTimers();
  };
});

describe('BuyerOfferCard — what is shown', () => {
  it('renders nothing when the buyer has made no offers', () => {
    const { container } = render(<BuyerOfferCard listingId="listing-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(state.requestedListingIds).toContain('listing-1');
  });

  it('renders nothing when the query settles without data', () => {
    state.offers = undefined;
    const { container } = render(<BuyerOfferCard listingId="listing-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the amount, quoted message and status of an open offer', () => {
    state.offers = [offer()];
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.getByText('Your offer')).toBeInTheDocument();
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('“Would you take this?”')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText(/^Sent /)).toBeInTheDocument();
  });

  it('omits the quote when the offer has no message', () => {
    state.offers = [offer({ message: null })];
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.queryByText(/“/)).toBeNull();
  });

  it('shows the pending offer rather than a newer resolved one', () => {
    state.offers = [
      offer({ id: 'newer-rejected', status: 'rejected', amount_cents: 99900 }),
      offer({ id: 'still-open', amount_cents: 45000 }),
    ];
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.queryByText('$999.00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw offer' })).toBeInTheDocument();
  });

  it.each([
    ['accepted', 'Accepted', 'Accepted — order created'],
    ['rejected', 'Rejected', 'The seller declined this offer'],
    ['withdrawn', 'Withdrawn', 'You withdrew this offer'],
    ['expired', 'Expired', 'This offer expired'],
    ['countered', 'Countered', 'You countered this offer'],
  ] satisfies [OfferStatus, string, string][])(
    'a %s offer is read-only with its outcome spelled out',
    (status, badge, line) => {
      state.offers = [offer({ status })];
      render(<BuyerOfferCard listingId="listing-1" />);
      expect(screen.getByText(badge)).toBeInTheDocument();
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('falls back to the most recent offer when the whole chain has resolved', () => {
    state.offers = [
      offer({ id: 'latest', status: 'expired', amount_cents: 52000 }),
      offer({ id: 'older', status: 'rejected', amount_cents: 45000 }),
    ];
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.getByText('$520.00')).toBeInTheDocument();
    expect(screen.getByText('This offer expired')).toBeInTheDocument();
  });
});

describe('BuyerOfferCard — actions follow who the offer awaits', () => {
  it("the buyer's own open offer can only be withdrawn", () => {
    state.offers = [offer()];
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.getByText('Waiting for the seller to respond')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept counter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw offer' }));
    expect(mutate).toHaveBeenCalledWith({ offerId: 'offer-root', action: 'withdraw' });
  });

  it("a seller's counter can be accepted or rejected, not withdrawn", () => {
    state.offers = counterChain();
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.getByText('The seller countered — your move')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw offer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(mutate).toHaveBeenCalledWith({ offerId: 'offer-counter', action: 'reject' });
  });

  it('disables Withdraw and drops its label while a request is in flight', () => {
    state.offers = [offer()];
    state.isPending = true;
    render(<BuyerOfferCard listingId="listing-1" />);
    expect(screen.queryByRole('button', { name: 'Withdraw offer' })).toBeNull();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disables both Accept and Reject while a request is in flight', () => {
    state.offers = counterChain();
    state.isPending = true;
    render(<BuyerOfferCard listingId="listing-1" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Accept counter' })).toBeNull();
  });
});

describe('BuyerOfferCard — accepting a counter', () => {
  beforeEach(() => {
    state.offers = counterChain();
  });

  it('sends accept for the counter offer', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Accept counter' }));
    expect(mutate.mock.calls[0]?.[0]).toEqual({ offerId: 'offer-counter', action: 'accept' });
  });

  it('opens the payment sheet with the secret, charged total and item price', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: DEV_SECRET, total_cents: 54321 });
    expect(screen.getByRole('dialog', { name: 'Pay for your accepted offer' })).toBeInTheDocument();
    expect(currentDialog()).toMatchObject({
      open: true,
      clientSecret: DEV_SECRET,
      amountCents: 54321,
      itemPriceCents: 50000,
      returnPath: '/orders/order-7',
    });
    expect(screen.getByRole('link', { name: 'View your order' })).toHaveAttribute(
      'href',
      '/orders/order-7',
    );
  });

  it('passes no total when the gateway did not send one', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: DEV_SECRET });
    expect(currentDialog().amountCents).toBeUndefined();
  });

  it('links to the order without a payment sheet when there is no secret to confirm', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'View your order' })).toHaveAttribute(
      'href',
      '/orders/order-7',
    );
  });

  it('does not open a payment sheet for a secret the browser cannot confirm', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: 'not-a-payment-secret' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows neither a link nor a payment sheet when no order came back', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ client_secret: DEV_SECRET });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('link', { name: 'View your order' })).toBeNull();
  });

  it('closes the sheet but keeps the order link when the buyer dismisses payment', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: DEV_SECRET });
    act(() => {
      currentDialog().onOpenChange(false);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'View your order' })).toBeInTheDocument();
  });

  it('keeps the sheet open when the dialog reports it is (still) open', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: DEV_SECRET });
    act(() => {
      currentDialog().onOpenChange(true);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the sheet once payment succeeds', () => {
    render(<BuyerOfferCard listingId="listing-1" />);
    acceptWith({ order_id: 'order-7', client_secret: DEV_SECRET });
    act(() => {
      currentDialog().onSucceeded();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'View your order' })).toBeInTheDocument();
  });
});
