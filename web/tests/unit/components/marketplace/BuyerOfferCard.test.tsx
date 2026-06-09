// Tests for the buyer-side Best-Offer card (session-new offer/negotiation UI).
// Verifies loading / error (with retry) / empty states, and the core
// interaction wiring keyed on who the offer awaits:
//   - root offer (awaits seller)   → Withdraw, dispatches action 'withdraw'
//   - seller counter (awaits buyer) → Accept/Reject, dispatch 'accept'/'reject'
//   - on accept returning an order_id, the "View your order" deep link appears.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useListingOffers = vi.fn();
const updateMutate = vi.fn();
const updateState = { isPending: false };

vi.mock('@/hooks/useOffers', async () => {
  // Keep the real pure helpers (computeOfferDepths / awaitingPartyForDepth) so
  // the awaiting-party math under test is the real logic, not a stub.
  const actual = await vi.importActual<typeof import('@/hooks/useOffers')>('@/hooks/useOffers');
  return {
    ...actual,
    useListingOffers: (...args: unknown[]) => useListingOffers(...args),
    useUpdateOffer: () => ({ mutate: updateMutate, isPending: updateState.isPending }),
  };
});

import { BuyerOfferCard } from '@/components/marketplace/BuyerOfferCard';
import type { Offer } from '@/types';

function Wrapper({ children }: { children: ReactNode }) {
  return createElement('div', null, children);
}

function renderCard() {
  return render(createElement(BuyerOfferCard, { listingId: 'listing-1' }), { wrapper: Wrapper });
}

const rootOffer: Offer = {
  id: 'offer-root',
  listing_id: 'listing-1',
  buyer_id: 'buyer-1',
  amount_cents: 45000,
  status: 'pending',
  parent_offer_id: null, // depth 0 → awaits seller → buyer can withdraw
  expires_at: '2026-07-01T00:00:00Z',
  message: 'Would you take this?',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

// A seller counter is a child of the root → depth 1 → awaits buyer.
const sellerCounter: Offer = {
  ...rootOffer,
  id: 'offer-counter',
  amount_cents: 50000,
  parent_offer_id: 'offer-root',
  message: 'Best I can do.',
};

beforeEach(() => {
  vi.clearAllMocks();
  updateState.isPending = false;
});

afterEach(() => {
  useListingOffers.mockReset();
});

describe('BuyerOfferCard', () => {
  it('renders the loading state', () => {
    useListingOffers.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderCard();
    expect(screen.getByText(/Loading your offer/i)).toBeInTheDocument();
  });

  it('renders the error state with a working Retry', async () => {
    const refetch = vi.fn();
    useListingOffers.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch });
    const user = userEvent.setup();
    renderCard();
    expect(screen.getByText(/Failed to load your offer/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the buyer has no offers (empty)', () => {
    useListingOffers.mockReturnValue({ isLoading: false, isError: false, data: { offers: [] } });
    renderCard();
    // The component returns null when there are no offers — no card title rendered.
    expect(screen.queryByText('Your offer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading your offer/i)).not.toBeInTheDocument();
  });

  it('shows Withdraw for the buyer’s own open offer (awaits seller) and dispatches withdraw', async () => {
    useListingOffers.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [rootOffer] },
    });
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the seller to respond/i)).toBeInTheDocument();
    // No accept/reject when awaiting the seller.
    expect(screen.queryByRole('button', { name: /Accept counter/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Withdraw offer/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [vars] = updateMutate.mock.calls[0] as [{ offerId: string; action: string }];
    expect(vars).toMatchObject({ offerId: 'offer-root', action: 'withdraw' });
  });

  it('shows Accept/Reject for a seller counter (awaits buyer) and dispatches accept', async () => {
    useListingOffers.mockReturnValue({
      isLoading: false,
      isError: false,
      // newest-first: the live pending offer is the seller counter.
      data: { offers: [sellerCounter, rootOffer] },
    });
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText(/The seller countered/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw offer/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Accept counter/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [vars] = updateMutate.mock.calls[0] as [{ offerId: string; action: string }];
    expect(vars).toMatchObject({ offerId: 'offer-counter', action: 'accept' });
  });

  it('surfaces a "View your order" link when accept returns an order_id', async () => {
    useListingOffers.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [sellerCounter, rootOffer] },
    });
    // Drive the mutation's onSuccess with an order_id (the accept-creates-order path).
    updateMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess?: (d: { order_id?: string }) => void }) => {
        opts.onSuccess?.({ order_id: 'order-xyz' });
      },
    );
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /Accept counter/i }));
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /View your order/i });
      expect(link).toHaveAttribute('href', '/orders/order-xyz');
    });
  });

  it('renders a terminal (rejected) offer read-only with no actions', () => {
    useListingOffers.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [{ ...rootOffer, status: 'rejected' }] },
    });
    renderCard();
    expect(screen.getByText(/The seller declined this offer/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw offer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept counter/i })).not.toBeInTheDocument();
  });
});
