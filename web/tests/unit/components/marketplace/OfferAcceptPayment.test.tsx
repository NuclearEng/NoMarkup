import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Offer } from '@/types';

// Offer-accept used to discard the PaymentIntent client_secret exactly like
// buy-now did. The asymmetry that matters here: the gateway authorizes accept
// on whoever the offer AWAITS, so a buyer accepting a seller's counter is the
// payer (secret usable in-browser), while a seller accepting a buyer's offer
// is not (the secret belongs to the buyer's card and 3DS would be impossible).
//
// MOCKED: gateway + payment dialog. PROVEN: the buyer path opens a payment
// surface; the seller path never does. NOT PROVEN: Stripe behaviour.

const { patch, get } = vi.hoisted(() => ({
  patch: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', () => ({
  api: { patch, get },
  ApiError: class extends Error {
    userMessage(fallback: string) {
      return fallback;
    }
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

let dialogProps: {
  clientSecret: string;
  itemPriceCents?: number;
  returnPath: string;
} | null = null;

vi.mock('@/components/payments/PaymentConfirmationDialog', () => ({
  PaymentConfirmationDialog: (props: {
    clientSecret: string;
    itemPriceCents?: number;
    returnPath: string;
  }) => {
    dialogProps = props;
    return createElement('div', { 'data-testid': 'payment-dialog' });
  },
}));

const { BuyerOfferCard } = await import(
  '@/components/marketplace/BuyerOfferCard'
);
const { CounterOfferBanner } = await import(
  '@/components/marketplace/CounterOfferBanner'
);

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

/**
 * A seller counter: depth 1 in the chain, therefore awaiting the BUYER, so
 * BuyerOfferCard renders "Accept counter" and the buyer is the payer.
 */
function counterChain(): Offer[] {
  return [
    {
      id: 'offer-2',
      listing_id: 'listing-1',
      buyer_id: 'buyer-1',
      amount_cents: 4500,
      status: 'pending',
      parent_offer_id: 'offer-1',
      message: '',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    {
      id: 'offer-1',
      listing_id: 'listing-1',
      buyer_id: 'buyer-1',
      amount_cents: 4000,
      status: 'countered',
      parent_offer_id: null,
      message: '',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  ] as unknown as Offer[];
}

/** A root buyer offer: depth 0, awaiting the SELLER. */
function buyerProposal(): Offer[] {
  return [
    {
      id: 'offer-1',
      listing_id: 'listing-1',
      buyer_id: 'buyer-1',
      amount_cents: 4000,
      status: 'pending',
      parent_offer_id: null,
      message: '',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  ] as unknown as Offer[];
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('offer accept payment wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogProps = null;
  });

  it('BUYER accepting a counter opens the payment surface with the secret', async () => {
    get.mockResolvedValue({ offers: counterChain() });
    patch.mockResolvedValue({
      offer: null,
      order_id: 'order-77',
      client_secret: TOKEN,
      payment_required: true,
    });
    const user = userEvent.setup();
    render(<BuyerOfferCard listingId="listing-1" />, { wrapper });

    const accept = await screen.findByRole('button', { name: /Accept counter/i });
    await user.click(accept);

    expect(await screen.findByTestId('payment-dialog')).toBeInTheDocument();
    expect(dialogProps?.clientSecret).toBe(TOKEN);
    expect(dialogProps?.returnPath).toBe('/orders/order-77');
    expect(dialogProps?.itemPriceCents).toBe(4500);
  });

  it('BUYER accept without a usable secret still surfaces the order link', async () => {
    get.mockResolvedValue({ offers: counterChain() });
    patch.mockResolvedValue({
      offer: null,
      order_id: 'order-78',
      payment_required: true,
      charge_error: 'payment setup failed',
    });
    const user = userEvent.setup();
    render(<BuyerOfferCard listingId="listing-1" />, { wrapper });

    await user.click(await screen.findByRole('button', { name: /Accept counter/i }));

    const link = await screen.findByRole('link', { name: /View your order/i });
    expect(link).toHaveAttribute('href', '/orders/order-78');
    expect(screen.queryByTestId('payment-dialog')).toBeNull();
  });

  it('SELLER accepting never opens a payment surface with the buyer’s secret', async () => {
    get.mockResolvedValue({ offers: buyerProposal() });
    patch.mockResolvedValue({
      offer: null,
      order_id: 'order-79',
      client_secret: TOKEN,
      payment_required: true,
    });
    const user = userEvent.setup();
    render(<CounterOfferBanner listingId="listing-1" />, { wrapper });

    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('payment-dialog')).toBeNull();
  });

  it('warns the seller that accepting only bills the buyer', async () => {
    get.mockResolvedValue({ offers: buyerProposal() });
    render(<CounterOfferBanner listingId="listing-1" />, { wrapper });
    expect(
      await screen.findByText(/Wait until the order shows as paid/i),
    ).toBeInTheDocument();
  });
});
