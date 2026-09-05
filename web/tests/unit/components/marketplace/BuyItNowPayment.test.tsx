import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LISTING_STATUS, type Listing } from '@/types';

// The regression this file guards: buy-now used to route to the order page
// and toast "Purchased" while the returned client_secret was discarded, so
// escrow was never funded. MOCKED: the gateway and the payment dialog.
// PROVEN: the secret is carried into a payment surface, navigation waits for
// a settled payment, and the no-secret path still lands the buyer on the
// unpaid order. NOT PROVEN: Stripe behaviour.

const { post } = vi.hoisted(() => ({
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@/lib/api', () => ({
  api: { post },
  idempotencyHeader: () => ({ 'Idempotency-Key': 'test-key' }),
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
  ApiError: class extends Error {},
}));

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let dialogProps: {
  clientSecret: string;
  amountCents?: number;
  itemPriceCents?: number;
  returnPath: string;
  onSucceeded: (outcome: unknown) => void;
  onOpenChange: (open: boolean) => void;
} | null = null;

vi.mock('@/components/payments/PaymentConfirmationDialog', () => ({
  PaymentConfirmationDialog: (props: {
    clientSecret: string;
    amountCents?: number;
    itemPriceCents?: number;
    returnPath: string;
    onSucceeded: (outcome: unknown) => void;
    onOpenChange: (open: boolean) => void;
  }) => {
    dialogProps = props;
    return createElement('div', { 'data-testid': 'payment-dialog' });
  },
}));

const authState = { isAuthenticated: true, user: { id: 'buyer-1' } };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

const { BuyItNowButton } = await import(
  '@/components/marketplace/BuyItNowButton'
);

const TOKEN = ['pi', '3Test', 'secret', 'abc'].join('_');

const listing = {
  id: 'listing-1',
  seller_id: 'seller-1',
  status: LISTING_STATUS.ACTIVE,
  buy_now_price_cents: 5000,
  auction_ends_at: null,
} as unknown as Pick<
  Listing,
  'id' | 'seller_id' | 'status' | 'buy_now_price_cents' | 'auction_ends_at'
>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

async function buyNow() {
  const user = userEvent.setup();
  render(<BuyItNowButton listing={listing} />, { wrapper });
  await user.click(screen.getByRole('button', { name: /Buy now/i }));
  // Confirmation modal, then the real mutation. The pinned CTA and the modal
  // CTA share a label, so target the last one (the modal's).
  const confirms = screen.getAllByRole('button', { name: /Buy now \$50\.00/i });
  const modalConfirm = confirms.at(-1);
  if (!modalConfirm) throw new Error('confirm button not rendered');
  await user.click(modalConfirm);
}

describe('BuyItNowButton payment wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogProps = null;
  });

  it('shows bid-authorization disclosure before the buy-now submit', () => {
    render(<BuyItNowButton listing={listing} />, { wrapper });
    const disclosure = screen.getByTestId('bid-auth-disclosure');
    expect(disclosure.textContent).toMatch(/authorizes NoMarkup to charge your saved payment method/i);
    expect(disclosure.textContent).toMatch(/if the charge fails, you can pay from the order page/i);
    const submit = screen.getByRole('button', { name: 'Buy now for $50.00' });
    expect(
      disclosure.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('sends the Idempotency-Key the gateway requires on buy-now', async () => {
    post.mockResolvedValue({ order_id: 'order-1', client_secret: TOKEN });
    await buyNow();
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/v1/listings/listing-1/buy-now',
        undefined,
        expect.objectContaining({
          'Idempotency-Key': expect.any(String) as string,
        }),
      );
    });
  });

  it('opens the payment surface instead of navigating on success', async () => {
    post.mockResolvedValue({
      order_id: 'order-1',
      client_secret: TOKEN,
      payment_required: true,
    });
    await buyNow();

    expect(await screen.findByTestId('payment-dialog')).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
    expect(dialogProps?.clientSecret).toBe(TOKEN);
    expect(dialogProps?.returnPath).toBe('/orders/order-1');
    // No server total today, so only the item price is passed as context.
    expect(dialogProps?.amountCents).toBeUndefined();
    expect(dialogProps?.itemPriceCents).toBe(5000);
  });

  it('forwards a server-supplied total when the gateway starts sending one', async () => {
    post.mockResolvedValue({
      order_id: 'order-1',
      client_secret: TOKEN,
      total_cents: 5750,
    });
    await buyNow();
    await screen.findByTestId('payment-dialog');
    expect(dialogProps?.amountCents).toBe(5750);
  });

  it('navigates to the order only once the payment settles', async () => {
    post.mockResolvedValue({ order_id: 'order-1', client_secret: TOKEN });
    await buyNow();
    await screen.findByTestId('payment-dialog');

    dialogProps?.onSucceeded({});
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/orders/order-1');
    });
  });

  it('sends a buyer who dismisses payment to the unpaid order', async () => {
    post.mockResolvedValue({ order_id: 'order-1', client_secret: TOKEN });
    await buyNow();
    await screen.findByTestId('payment-dialog');

    dialogProps?.onOpenChange(false);
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/orders/order-1');
    });
  });

  it('falls back to the order page when the gateway could not mint a PaymentIntent', async () => {
    post.mockResolvedValue({
      order_id: 'order-2',
      payment_required: true,
      charge_error: 'payment setup failed; retry charge for this order',
    });
    await buyNow();

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/orders/order-2');
    });
    expect(screen.queryByTestId('payment-dialog')).toBeNull();
  });
});
