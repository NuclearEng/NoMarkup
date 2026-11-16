// Seller-side pending-offers banner. OfferSurfaces.test.tsx already proves
// which offers the seller sees (chain-depth parity) and OfferAcceptPayment
// proves accept never opens a payment sheet. This file covers the rest:
// loading / error+retry, the accept / reject / counter payloads, the inline
// counter editor, and the pending lock.
// MOCKED: useListingOffers + useUpdateOffer (depth helpers stay real).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Offer } from '@/types';

interface UpdateOfferInput {
  offerId: string;
  action: string;
  counter_amount_cents?: number;
}

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<(input: UpdateOfferInput, callbacks?: { onSuccess?: () => void }) => void>(),
  refetch: vi.fn<() => Promise<void>>(),
  state: {
    offers: undefined as Offer[] | undefined,
    isLoading: false,
    isError: false,
    isPending: false,
    listingIds: [] as string[],
  },
}));

vi.mock('@/hooks/useOffers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOffers')>('@/hooks/useOffers');
  return {
    ...actual,
    useListingOffers: (listingId: string) => {
      mocks.state.listingIds.push(listingId);
      return {
        data: mocks.state.offers ? { offers: mocks.state.offers } : undefined,
        isLoading: mocks.state.isLoading,
        isError: mocks.state.isError,
        refetch: mocks.refetch,
      };
    },
    useUpdateOffer: () => ({ mutate: mocks.mutate, isPending: mocks.state.isPending }),
  };
});

import { CounterOfferBanner } from '@/components/marketplace/CounterOfferBanner';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function offer(partial: Partial<Offer> & { id: string }): Offer {
  return {
    listing_id: 'l-1',
    buyer_id: 'buyer-1',
    amount_cents: 4200,
    status: 'pending',
    parent_offer_id: null,
    expires_at: '2026-06-02T10:00:00.000Z',
    message: null,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    ...partial,
  };
}

/** The card for one offer, found by its (unique) formatted amount. */
function rowFor(amount: string): HTMLElement {
  const row = screen.getByText(amount).closest('.rounded-lg');
  if (!(row instanceof HTMLElement)) throw new Error(`no offer row for ${amount}`);
  return row;
}

function renderBanner() {
  return render(<CounterOfferBanner listingId="l-1" />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.mutate.mockReset();
  mocks.refetch.mockReset();
  mocks.refetch.mockResolvedValue(undefined);
  mocks.state.offers = undefined;
  mocks.state.isLoading = false;
  mocks.state.isError = false;
  mocks.state.isPending = false;
  mocks.state.listingIds = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CounterOfferBanner — query states', () => {
  it('loads the offers of the listing it was given', () => {
    mocks.state.offers = [];
    render(<CounterOfferBanner listingId="l-77" />);
    expect(mocks.state.listingIds).toContain('l-77');
  });

  it('shows a loading line while offers are being fetched', () => {
    mocks.state.isLoading = true;
    renderBanner();
    expect(screen.getByText('Loading offers…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('shows the failure with a Retry that refetches', () => {
    mocks.state.isError = true;
    renderBanner();
    expect(screen.getByText(/Failed to load offers\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the query settled without data', () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every offer is already resolved', () => {
    mocks.state.offers = [
      offer({ id: 'a', status: 'rejected' }),
      offer({ id: 'b', status: 'accepted' }),
    ];
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CounterOfferBanner — offer rows', () => {
  it('counts only the offers that await the seller', () => {
    mocks.state.offers = [
      offer({ id: 'a', amount_cents: 4200 }),
      offer({ id: 'b', amount_cents: 5100, buyer_id: 'buyer-2' }),
      offer({ id: 'c', amount_cents: 9900, status: 'rejected' }),
    ];
    renderBanner();
    expect(screen.getByText('Pending offers (2)')).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
    expect(screen.getByText('$51.00')).toBeInTheDocument();
    expect(screen.queryByText('$99.00')).toBeNull();
  });

  it("shows a buyer's re-counter (depth 2) but not the seller's own counter (depth 1)", () => {
    mocks.state.offers = [
      offer({ id: 'a', amount_cents: 4000, status: 'countered' }),
      offer({ id: 'b', amount_cents: 6000, status: 'countered', parent_offer_id: 'a' }),
      offer({ id: 'c', amount_cents: 5000, parent_offer_id: 'b' }),
    ];
    renderBanner();
    expect(screen.getByText('Pending offers (1)')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.queryByText('$60.00')).toBeNull();
  });

  it('shows when the offer was sent, its status, and the buyer note in quotes', () => {
    mocks.state.offers = [
      offer({ id: 'a', message: 'Can pick up tonight' }),
    ];
    renderBanner();
    const row = rowFor('$42.00');
    expect(within(row).getByText('Sent 2h ago')).toBeInTheDocument();
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(within(row).getByText('“Can pick up tonight”')).toBeInTheDocument();
  });

  it('omits the note when the buyer wrote none', () => {
    mocks.state.offers = [offer({ id: 'a', message: null })];
    renderBanner();
    expect(rowFor('$42.00').textContent).not.toContain('“');
  });

  it('warns that accepting bills the buyer and to wait for payment', () => {
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    expect(
      screen.getByText(/Accepting closes the listing and bills the buyer\./),
    ).toBeInTheDocument();
  });
});

describe('CounterOfferBanner — accept and reject', () => {
  it('accepts the offer whose Accept button was pressed', () => {
    mocks.state.offers = [
      offer({ id: 'a', amount_cents: 4200 }),
      offer({ id: 'b', amount_cents: 5100, buyer_id: 'buyer-2' }),
    ];
    renderBanner();
    fireEvent.click(within(rowFor('$51.00')).getByRole('button', { name: 'Accept' }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({ offerId: 'b', action: 'accept' });
  });

  it('rejects the offer whose Reject button was pressed', () => {
    mocks.state.offers = [
      offer({ id: 'a', amount_cents: 4200 }),
      offer({ id: 'b', amount_cents: 5100, buyer_id: 'buyer-2' }),
    ];
    renderBanner();
    fireEvent.click(within(rowFor('$42.00')).getByRole('button', { name: 'Reject' }));
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({ offerId: 'a', action: 'reject' });
  });

  it('locks every action while a response is being sent', () => {
    mocks.state.isPending = true;
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Counter' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });
});

describe('CounterOfferBanner — countering', () => {
  it('opens an editor prefilled with the offer amount, in place of the action buttons', () => {
    mocks.state.offers = [offer({ id: 'a', amount_cents: 4250 })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));

    expect(screen.getByLabelText('Counter amount (USD)')).toHaveValue(42.5);
    expect(screen.getByLabelText('Counter amount (USD)')).toHaveDisplayValue('42.50');
    expect(screen.getByRole('button', { name: 'Send counter' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('only opens the editor on the row being countered', () => {
    mocks.state.offers = [
      offer({ id: 'a', amount_cents: 4200 }),
      offer({ id: 'b', amount_cents: 5100, buyer_id: 'buyer-2' }),
    ];
    renderBanner();
    fireEvent.click(within(rowFor('$51.00')).getByRole('button', { name: 'Counter' }));

    expect(within(rowFor('$51.00')).getByLabelText('Counter amount (USD)')).toHaveValue(51);
    expect(within(rowFor('$42.00')).queryByLabelText('Counter amount (USD)')).toBeNull();
    expect(within(rowFor('$42.00')).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('sends the counter as integer cents for the right offer', () => {
    mocks.state.offers = [offer({ id: 'a', amount_cents: 4200 })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.change(screen.getByLabelText('Counter amount (USD)'), {
      target: { value: '55.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      offerId: 'a',
      action: 'counter',
      counter_amount_cents: 5510,
    });
  });

  it('closes the editor once the counter is sent', () => {
    mocks.mutate.mockImplementation((_input, callbacks) => {
      callbacks?.onSuccess?.();
    });
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));

    expect(screen.queryByLabelText('Counter amount (USD)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('keeps the editor open with the typed amount when the counter has not succeeded', () => {
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.change(screen.getByLabelText('Counter amount (USD)'), {
      target: { value: '60' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));

    expect(screen.getByLabelText('Counter amount (USD)')).toHaveValue(60);
  });

  it.each(['0', '-10'])('does not send a counter of %s', (typed) => {
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.change(screen.getByLabelText('Counter amount (USD)'), {
      target: { value: typed },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('disables Send while the amount is empty', () => {
    mocks.state.offers = [offer({ id: 'a' })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.change(screen.getByLabelText('Counter amount (USD)'), {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: 'Send counter' })).toBeDisabled();
  });

  it('Cancel closes the editor without sending, and reopening starts from the offer amount again', () => {
    mocks.state.offers = [offer({ id: 'a', amount_cents: 4200 })];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    fireEvent.change(screen.getByLabelText('Counter amount (USD)'), {
      target: { value: '99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Counter amount (USD)')).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    expect(screen.getByLabelText('Counter amount (USD)')).toHaveValue(42);
  });

  it('locks the editor buttons while the counter is being sent', () => {
    mocks.state.offers = [offer({ id: 'a' })];
    const { rerender } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));

    mocks.state.isPending = true;
    rerender(<CounterOfferBanner listingId="l-1" />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send counter' })).toBeNull();
    const row = rowFor('$42.00');
    const disabled = within(row)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(disabled).toHaveLength(2);
  });
});
