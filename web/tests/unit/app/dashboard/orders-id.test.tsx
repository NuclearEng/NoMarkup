// Order detail page — pickup confirmation, dispute flow.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';
import { LISTING_ORDER_STATUS } from '@/types';
import type { ListingOrder } from '@/types';

const orderState: {
  data: ListingOrder | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

const confirmPickup = { mutate: vi.fn(), isPending: false };
const sellerConfirm = { mutate: vi.fn(), isPending: false };
const disputeOrder = { mutate: vi.fn(), isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/orders/o-1',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ id: 'o-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useListings', () => ({
  useListingOrder: () => orderState,
  useConfirmPickup: () => confirmPickup,
  useSellerConfirm: () => sellerConfirm,
  useDisputeOrder: () => disputeOrder,
}));

// The page reads the current user to pick the buyer vs seller confirm action.
// Default to the buyer (matches the mock order's buyer_id) so existing assertions
// about the buyer "Confirm pickup" button hold.
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'me' } }),
}));

import OrderDetailPage from '@/app/(dashboard)/orders/[id]/page';

const mockOrder: ListingOrder = {
  id: 'o-1',
  listing_id: 'l-1',
  listing_title: 'Vintage bike',
  listing_photo_url: null,
  buyer_id: 'me',
  seller_id: 's-1',
  seller_display_name: 'Jane Seller',
  pickup_address: '123 Main St',
  pickup_zip: '94110',
  pickup_city: 'San Francisco',
  pickup_state: 'CA',
  amount_cents: 12000,
  platform_fee_cents: 1200,
  status: LISTING_ORDER_STATUS.PAID,
  channel_id: 'ch-1',
  paid_at: new Date().toISOString(),
  picked_up_at: null,
  completed_at: null,
  dispute_window_ends_at: null,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  orderState.data = undefined;
  orderState.isLoading = false;
  orderState.isError = false;
  orderState.refetch = vi.fn();
  confirmPickup.mutate = vi.fn();
  confirmPickup.isPending = false;
  disputeOrder.mutate = vi.fn();
  disputeOrder.isPending = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OrderDetailPage', () => {
  it('renders the loading skeleton', () => {
    orderState.isLoading = true;
    const { container } = render(withQueryClient(createElement(OrderDetailPage)));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the error state with Retry', () => {
    orderState.isError = true;
    render(withQueryClient(createElement(OrderDetailPage)));
    expect(screen.getByText(/Order not found/i)).toBeDefined();
  });

  it('renders order details', () => {
    orderState.data = mockOrder;
    render(withQueryClient(createElement(OrderDetailPage)));
    expect(screen.getAllByText('Vintage bike').length).toBeGreaterThan(0);
    expect(screen.getByText('123 Main St')).toBeDefined();
    expect(screen.getByText('Jane Seller')).toBeDefined();
  });

  it('renders the open chat link when channel_id is present', () => {
    orderState.data = mockOrder;
    render(withQueryClient(createElement(OrderDetailPage)));
    const chatLink = screen.getByText(/Open chat/i).closest('a');
    expect(chatLink?.getAttribute('href')).toBe('/messages?channel=ch-1');
  });

  it('clicking Confirm pickup invokes the mutation', () => {
    orderState.data = mockOrder;
    render(withQueryClient(createElement(OrderDetailPage)));
    const btn = screen.getByRole('button', { name: /Confirm pickup/i });
    fireEvent.click(btn);
    expect(confirmPickup.mutate).toHaveBeenCalledWith('o-1');
  });

  it('renders the order summary with formatted totals', () => {
    orderState.data = mockOrder;
    render(withQueryClient(createElement(OrderDetailPage)));
    expect(screen.getByText('$120.00')).toBeDefined();
    expect(screen.getByText('$12.00')).toBeDefined();
    expect(screen.getByText('$132.00')).toBeDefined();
  });

  it('disables the dispute button when not in PICKED_UP status', () => {
    orderState.data = { ...mockOrder, status: LISTING_ORDER_STATUS.PAID };
    render(withQueryClient(createElement(OrderDetailPage)));
    const btn = screen.getByRole('button', { name: /Open dispute/i });
    if (!(btn instanceof HTMLButtonElement)) throw new Error('expected button');
    expect(btn.disabled).toBe(true);
  });

  it('enables the dispute button when in PICKED_UP status with open window', () => {
    orderState.data = {
      ...mockOrder,
      status: LISTING_ORDER_STATUS.PICKED_UP,
      dispute_window_ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    render(withQueryClient(createElement(OrderDetailPage)));
    const btn = screen.getByRole('button', { name: /Open dispute/i });
    if (!(btn instanceof HTMLButtonElement)) throw new Error('expected button');
    expect(btn.disabled).toBe(false);
  });
});
