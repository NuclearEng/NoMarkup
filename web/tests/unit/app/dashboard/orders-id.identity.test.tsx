// Order detail page — what a viewer sees before their identity has loaded.
// The page picks buyer vs seller actions by comparing the viewer's id with the
// order; with no id it used to fall through to the buyer's side.
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LISTING_ORDER_STATUS } from '@/types';
import type { ListingOrder } from '@/types';

const h = vi.hoisted(() => ({
  userId: undefined as string | undefined,
  order: undefined as unknown,
  confirmPickup: { mutate: vi.fn(), isPending: false },
  sellerConfirm: { mutate: vi.fn(), isPending: false },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'o-1' }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));
vi.mock('@/hooks/useListings', () => ({
  useListingOrder: () => ({ data: h.order, isLoading: false, isError: false, refetch: vi.fn() }),
  useConfirmPickup: () => h.confirmPickup,
  useSellerConfirm: () => h.sellerConfirm,
  useDisputeOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useReportOrderNoShow: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useOrderReviews', () => ({
  useListingOrderReviewEligibility: () => ({ data: undefined, isLoading: false }),
  useListingOrderReviews: () => ({ data: [] }),
}));
vi.mock('@/components/orders/OrderPaymentPrompt', () => ({
  OrderPaymentPrompt: () => createElement('div', { 'data-testid': 'order-payment-prompt' }),
}));
vi.mock('@/components/orders/OrderReviewForm', () => ({
  OrderReviewForm: () => createElement('div', { 'data-testid': 'order-review-form' }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: h.userId === undefined ? null : { id: h.userId } }),
}));

import OrderDetailPage from '@/app/(dashboard)/orders/[id]/page';

function makeOrder(overrides: Partial<ListingOrder> = {}): ListingOrder {
  return {
    id: 'o-1',
    listing_id: 'l-1',
    listing_title: 'Vintage bike',
    listing_photo_url: null,
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    seller_display_name: 'Jane Seller',
    pickup_address: '123 Main St',
    pickup_zip: '94110',
    pickup_city: 'San Francisco',
    pickup_state: 'CA',
    amount_cents: 12000,
    platform_fee_cents: 1200,
    status: LISTING_ORDER_STATUS.PAID,
    channel_id: 'ch-1',
    paid_at: '2026-11-01T00:00:00Z',
    picked_up_at: null,
    seller_confirmed_at: null,
    completed_at: null,
    dispute_window_ends_at: null,
    created_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('OrderDetailPage — viewer identity not loaded yet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId = undefined;
  });

  it('shows the loading state, not the buyer payment prompt, on an unpaid order', () => {
    h.order = makeOrder({ status: LISTING_ORDER_STATUS.PENDING });
    render(createElement(OrderDetailPage));

    expect(screen.getByRole('status', { name: 'Loading order' })).toBeInTheDocument();
    expect(screen.queryByTestId('order-payment-prompt')).toBeNull();
    expect(screen.queryByText('Vintage bike')).toBeNull();
  });

  it('offers no confirm, dispute or no-show action on a paid order', () => {
    h.order = makeOrder();
    render(createElement(OrderDetailPage));

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives the seller the seller view once identity arrives', () => {
    h.order = makeOrder({ status: LISTING_ORDER_STATUS.PENDING });
    const view = render(createElement(OrderDetailPage));
    expect(screen.queryByText('Awaiting buyer payment')).toBeNull();

    h.userId = 'seller-1';
    view.rerender(createElement(OrderDetailPage));

    expect(screen.getByText('Awaiting buyer payment')).toBeInTheDocument();
    expect(screen.queryByTestId('order-payment-prompt')).toBeNull();
  });

  it('gives the buyer the payment prompt once identity arrives', () => {
    h.userId = 'buyer-1';
    h.order = makeOrder({ status: LISTING_ORDER_STATUS.PENDING });
    render(createElement(OrderDetailPage));

    expect(screen.getByTestId('order-payment-prompt')).toBeInTheDocument();
  });
});
