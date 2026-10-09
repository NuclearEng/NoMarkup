// Best-Offer surfaces: the depth-parity helper that decides which
// participant an offer awaits, plus the buyer (BuyerOfferCard) and seller
// (CounterOfferBanner) views that drive their actions off it.
//
// The depth rule mirrors gateway/internal/handler/offers.go: even chain
// depth → awaiting seller, odd → awaiting buyer. Buyers withdraw their own
// open proposal and accept/reject a seller's counter; sellers only ever see
// offers that await them.
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from '../../app/dashboard/_helpers';
import {
  awaitingPartyForDepth,
  computeOfferDepths,
} from '@/hooks/useOffers';
import type { Offer } from '@/types';

const mutate = vi.fn();
const offersState: {
  data: { offers: Offer[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('@/hooks/useOffers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOffers')>(
    '@/hooks/useOffers',
  );
  return {
    ...actual,
    useListingOffers: () => offersState,
    useUpdateOffer: () => ({ mutate, isPending: false }),
  };
});

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    createElement('a', {}, children),
}));

import { BuyerOfferCard } from '@/components/marketplace/BuyerOfferCard';
import { CounterOfferBanner } from '@/components/marketplace/CounterOfferBanner';

function offer(partial: Partial<Offer> & { id: string }): Offer {
  return {
    listing_id: 'l-1',
    buyer_id: 'buyer-1',
    amount_cents: 5000,
    status: 'pending',
    parent_offer_id: null,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    message: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...partial,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  offersState.data = undefined;
  offersState.isLoading = false;
  offersState.isError = false;
});

describe('offer chain depth helpers', () => {
  it('assigns depth 0 to a root offer and increments down the chain', () => {
    const root = offer({ id: 'a' });
    const counter = offer({ id: 'b', parent_offer_id: 'a' });
    const reCounter = offer({ id: 'c', parent_offer_id: 'b' });
    const depths = computeOfferDepths([reCounter, counter, root]);
    expect(depths.get('a')).toBe(0);
    expect(depths.get('b')).toBe(1);
    expect(depths.get('c')).toBe(2);
  });

  it('maps even depth → seller, odd depth → buyer (mirrors the gateway)', () => {
    expect(awaitingPartyForDepth(0)).toBe('seller');
    expect(awaitingPartyForDepth(1)).toBe('buyer');
    expect(awaitingPartyForDepth(2)).toBe('seller');
  });
});

describe('BuyerOfferCard', () => {
  it('renders Withdraw for the buyer\'s own open (seller-awaited) offer', () => {
    offersState.data = { offers: [offer({ id: 'a', amount_cents: 4200 })] };
    render(withQueryClient(createElement(BuyerOfferCard, { listingId: 'l-1' })));
    expect(screen.getByText('$42.00')).toBeDefined();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('renders Accept/Reject when the seller has countered (buyer-awaited)', () => {
    offersState.data = {
      offers: [
        offer({ id: 'b', parent_offer_id: 'a', amount_cents: 6000 }),
        offer({ id: 'a', status: 'countered', amount_cents: 4200 }),
      ],
    };
    render(withQueryClient(createElement(BuyerOfferCard, { listingId: 'l-1' })));
    expect(screen.getByText('$60.00')).toBeDefined();
    expect(screen.getByRole('button', { name: /accept counter/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });

  it('renders nothing when the buyer has no offers', () => {
    offersState.data = { offers: [] };
    const { container } = render(
      withQueryClient(createElement(BuyerOfferCard, { listingId: 'l-1' })),
    );
    expect(container.textContent).toBe('');
  });
});

describe('CounterOfferBanner', () => {
  it('shows a seller-awaited pending offer with Accept/Reject/Counter', () => {
    offersState.data = { offers: [offer({ id: 'a', amount_cents: 4200 })] };
    render(withQueryClient(createElement(CounterOfferBanner, { listingId: 'l-1' })));
    expect(screen.getByText('$42.00')).toBeDefined();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^counter$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeDefined();
  });

  it('hides a buyer-awaited (seller counter) pending offer from the seller view', () => {
    // After the seller counters: the new pending offer (depth 1) awaits the
    // buyer, and the original is 'countered'. The seller banner shows neither.
    offersState.data = {
      offers: [
        offer({ id: 'b', parent_offer_id: 'a', amount_cents: 6000 }),
        offer({ id: 'a', status: 'countered', amount_cents: 4200 }),
      ],
    };
    const { container } = render(
      withQueryClient(createElement(CounterOfferBanner, { listingId: 'l-1' })),
    );
    expect(container.textContent).toBe('');
  });
});
